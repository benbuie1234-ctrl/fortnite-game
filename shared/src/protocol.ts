import type { InputCommand } from "./sim";

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export const C_HELLO = 1;
export const C_INPUT = 2;
export const C_PING = 3;
export const C_CHAT = 4;

export const S_WELCOME = 10;
export const S_SNAPSHOT = 11;
export const S_PONG = 12;
export const S_FULL_WORLD = 13;
export const S_MATCH = 14;
export const S_CHAT = 15;
export const S_KICK = 16;

// Event kinds inside a snapshot
export const EV_PIECE_ADD = 1;
export const EV_PIECE_REMOVE = 2;
export const EV_PIECE_DAMAGE = 3;
export const EV_SHOT = 4;
export const EV_HIT = 5;
export const EV_DEATH = 6;
export const EV_RESPAWN = 7;
export const EV_SOUND = 8;
/** A tree took a hit and lost its leaves. Carries the SCENERY index, so every
 *  client can strip the same tree without the server sending geometry. */
export const EV_FOLIAGE = 9;
/** A bird or a fish was shot down. Carries the index into CRITTERS, so every
 *  client removes the same one without the server ever sending its position. */
export const EV_CRITTER = 10;

// ---------------------------------------------------------------------------
// Quantisation
//
// Positions travel as i16 at 1/32 m (3.1 cm), giving +/-1023 m of range. Angles
// use the full u16 / i16 span. The client quantises look angles BEFORE running
// prediction, so it predicts with exactly the value the server will decode.
// ---------------------------------------------------------------------------

export const POS_SCALE = 32;
const YAW_SCALE = 65536 / (Math.PI * 2);
const PITCH_SCALE = 32767 / (Math.PI / 2);

export function quantizeYaw(yaw: number): number {
  let y = yaw % (Math.PI * 2);
  if (y > Math.PI) y -= Math.PI * 2;
  if (y < -Math.PI) y += Math.PI * 2;
  return Math.round(y * YAW_SCALE) / YAW_SCALE;
}

export function quantizePitch(pitch: number): number {
  const clamped = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
  return Math.round(clamped * PITCH_SCALE) / PITCH_SCALE;
}

// ---------------------------------------------------------------------------
// Buffer helpers
// ---------------------------------------------------------------------------

export class Writer {
  private view: DataView;
  private buf: ArrayBuffer;
  private off = 0;

  constructor(capacity = 8192) {
    this.buf = new ArrayBuffer(capacity);
    this.view = new DataView(this.buf);
  }

  private ensure(bytes: number): void {
    if (this.off + bytes <= this.buf.byteLength) return;
    let cap = this.buf.byteLength * 2;
    while (cap < this.off + bytes) cap *= 2;
    const next = new ArrayBuffer(cap);
    new Uint8Array(next).set(new Uint8Array(this.buf, 0, this.off));
    this.buf = next;
    this.view = new DataView(next);
  }

  u8(v: number): this { this.ensure(1); this.view.setUint8(this.off, v & 0xff); this.off += 1; return this; }
  i8(v: number): this { this.ensure(1); this.view.setInt8(this.off, v); this.off += 1; return this; }
  u16(v: number): this { this.ensure(2); this.view.setUint16(this.off, v & 0xffff); this.off += 2; return this; }
  i16(v: number): this { this.ensure(2); this.view.setInt16(this.off, clampI16(v)); this.off += 2; return this; }
  u32(v: number): this { this.ensure(4); this.view.setUint32(this.off, v >>> 0); this.off += 4; return this; }
  f32(v: number): this { this.ensure(4); this.view.setFloat32(this.off, v); this.off += 4; return this; }

  pos(v: number): this { return this.i16(Math.round(v * POS_SCALE)); }
  yaw(v: number): this { return this.u16(Math.round(((v + Math.PI) % (Math.PI * 2)) * YAW_SCALE)); }
  pitch(v: number): this { return this.i16(Math.round(v * PITCH_SCALE)); }

  str(s: string): this {
    const bytes = new TextEncoder().encode(s);
    this.u16(bytes.length);
    this.ensure(bytes.length);
    new Uint8Array(this.buf).set(bytes, this.off);
    this.off += bytes.length;
    return this;
  }

  /** Patch a u16 written earlier (used for counts filled in after the fact). */
  patchU16(at: number, v: number): void { this.view.setUint16(at, v & 0xffff); }
  patchU8(at: number, v: number): void { this.view.setUint8(at, v & 0xff); }
  get offset(): number { return this.off; }

  finish(): ArrayBuffer { return this.buf.slice(0, this.off); }
}

function clampI16(v: number): number {
  return v < -32768 ? -32768 : v > 32767 ? 32767 : Math.round(v);
}

export class Reader {
  private view: DataView;
  private off = 0;

  constructor(buf: ArrayBuffer) { this.view = new DataView(buf); }

  get remaining(): number { return this.view.byteLength - this.off; }
  get offset(): number { return this.off; }

  u8(): number { const v = this.view.getUint8(this.off); this.off += 1; return v; }
  i8(): number { const v = this.view.getInt8(this.off); this.off += 1; return v; }
  u16(): number { const v = this.view.getUint16(this.off); this.off += 2; return v; }
  i16(): number { const v = this.view.getInt16(this.off); this.off += 2; return v; }
  u32(): number { const v = this.view.getUint32(this.off); this.off += 4; return v; }
  f32(): number { const v = this.view.getFloat32(this.off); this.off += 4; return v; }

  pos(): number { return this.i16() / POS_SCALE; }
  yaw(): number { return this.u16() / YAW_SCALE - Math.PI; }
  pitch(): number { return this.i16() / PITCH_SCALE; }

  str(): string {
    const len = this.u16();
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.off, len);
    this.off += len;
    return new TextDecoder().decode(bytes);
  }
}

// ---------------------------------------------------------------------------
// Client -> server: batched input
//
// 7 bytes per command, 2 commands per message at 15 Hz. That is the whole
// upstream budget: ~330 B/s per player, and half the billed message count of
// sending every tick.
// ---------------------------------------------------------------------------

export function writeInputBatch(
  w: Writer, commands: readonly InputCommand[], clientTimeMs: number,
): void {
  w.u8(C_INPUT);
  w.u32(clientTimeMs >>> 0);
  w.u16(commands.length > 0 ? commands[0].seq & 0xffff : 0);
  w.u8(commands.length);
  for (const c of commands) {
    w.u16(c.buttons);
    w.u8(((c.moveX + 1) & 0x3) | (((c.moveZ + 1) & 0x3) << 2) | ((c.slot & 0xf) << 4));
    w.yaw(c.yaw);
    w.pitch(c.pitch);
  }
}

export interface InputBatch {
  clientTimeMs: number;
  commands: InputCommand[];
}

export function readInputBatch(r: Reader): InputBatch {
  const clientTimeMs = r.u32();
  const baseSeq = r.u16();
  const count = r.u8();
  const commands: InputCommand[] = [];
  for (let i = 0; i < count; i++) {
    const buttons = r.u16();
    const packed = r.u8();
    const yaw = r.yaw();
    const pitch = r.pitch();
    commands.push({
      seq: (baseSeq + i) & 0xffff,
      moveX: (packed & 0x3) - 1,
      moveZ: ((packed >> 2) & 0x3) - 1,
      slot: (packed >> 4) & 0xf,
      buttons,
      yaw,
      pitch,
    });
  }
  return { clientTimeMs, commands };
}

// ---------------------------------------------------------------------------
// Player flags carried in snapshots
// ---------------------------------------------------------------------------

export const PF_ALIVE = 1 << 0;
export const PF_GROUNDED = 1 << 1;
export const PF_AIMING = 1 << 2;
export const PF_CROUCH = 1 << 3;
export const PF_FIRING = 1 << 4;
export const PF_MOVING = 1 << 5;
export const PF_SLIDING = 1 << 6;
/** The player's one shield block for this match has been placed. Only ever
 *  set on your own state; nobody else's spent shield is your business. */
export const PF_SHIELD_SPENT = 1 << 7;
