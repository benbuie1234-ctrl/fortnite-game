import { unwrapTime } from "@shared/clock";
import {
  TICK_DT, INTERP_DELAY_MS, INPUTS_PER_MESSAGE, SPRINT_STAMINA_MAX,
} from "@shared/constants";
import {
  Writer, Reader, writeInputBatch, C_PING, C_CHAT,
  S_WELCOME, S_SNAPSHOT, S_PONG, S_FULL_WORLD, S_MATCH, S_CHAT, S_KICK,
  EV_PIECE_ADD, EV_PIECE_REMOVE, EV_PIECE_DAMAGE,
  PF_ALIVE, PF_SLIDING, PF_SHIELD_SPENT,
} from "@shared/protocol";
import { readSnapshot, type GameEvent, type OtherState } from "@shared/snapshot";
import { World } from "@shared/world";
import { buildArena } from "@shared/arena";
import { stepPlayer, newMovementState, type InputCommand, type MovementState } from "@shared/sim";
import { makePiece, type Slot, type Facing, unpackKey } from "@shared/build";

export interface MatchPlayerInfo {
  id: number; name: string; kills: number; deaths: number;
  wins?: number; ping?: number;
}

/** Locally predicted state for the player at this keyboard. */
export interface ClientSelf extends MovementState {
  hp: number;
  shield: number;
  mats: number;
  weapon: number;
  ammo: number;
  buildSlot: number;
  material: number;
  reloadMs: number;
  alive: boolean;
  /** Whether this match's one shield block has already been placed. */
  shieldUsed: boolean;
}

interface RemoteSample {
  t: number;
  state: OtherState;
}

/** A remote player's recent snapshots, rendered on a delay so there is always
 *  a pair to interpolate between. */
class RemoteBuffer {
  samples: RemoteSample[] = [];
  latest: OtherState;

  constructor(state: OtherState, t: number) {
    this.latest = state;
    this.samples.push({ t, state });
  }

  push(state: OtherState, t: number): void {
    this.latest = state;
    this.samples.push({ t, state });
    // Two seconds is far more than the interpolation delay ever needs.
    while (this.samples.length > 2 && t - this.samples[0].t > 2000) {
      this.samples.shift();
    }
  }

  /** Interpolated pose at a past server time. */
  at(renderTime: number): { x: number; y: number; z: number; yaw: number; pitch: number; state: OtherState } {
    const s = this.samples;
    if (s.length === 0) {
      const l = this.latest;
      return { x: l.x, y: l.y, z: l.z, yaw: l.yaw, pitch: l.pitch, state: l };
    }
    if (s.length === 1 || renderTime <= s[0].t) {
      const l = s[0].state;
      return { x: l.x, y: l.y, z: l.z, yaw: l.yaw, pitch: l.pitch, state: l };
    }

    for (let i = s.length - 1; i > 0; i--) {
      if (s[i - 1].t <= renderTime && renderTime <= s[i].t) {
        const a = s[i - 1];
        const b = s[i];
        const span = b.t - a.t;
        const f = span > 0 ? (renderTime - a.t) / span : 0;
        return {
          x: lerp(a.state.x, b.state.x, f),
          y: lerp(a.state.y, b.state.y, f),
          z: lerp(a.state.z, b.state.z, f),
          yaw: lerpAngle(a.state.yaw, b.state.yaw, f),
          pitch: lerp(a.state.pitch, b.state.pitch, f),
          state: b.state,
        };
      }
    }

    // Render time ran past the newest sample: hold the last pose rather than
    // extrapolating, which would rubber-band on a hitch.
    const l = s[s.length - 1].state;
    return { x: l.x, y: l.y, z: l.z, yaw: l.yaw, pitch: l.pitch, state: l };
  }
}

export interface ConnectionHandlers {
  onWelcome(id: number, name: string): void;
  onEvents(events: GameEvent[]): void;
  onMatchState(msg: Record<string, unknown>): void;
  onChat(name: string, text: string): void;
  onClose(reason: string): void;
}

export class Connection {
  readonly world = new World();
  readonly others = new Map<number, RemoteBuffer>();
  readonly self: ClientSelf = {
    ...newMovementState(),
    hp: 100, shield: 0, mats: 0, weapon: 0, ammo: 0,
    buildSlot: -1, material: 0, reloadMs: 0, alive: true, shieldUsed: false,
  };

  selfId = -1;
  rttMs = 60;
  /** serverNow - clientNow, smoothed. */
  private clockOffset = 0;
  private clockInitialised = false;

  private ws: WebSocket | null = null;
  private pending: InputCommand[] = [];
  private unsent: InputCommand[] = [];
  private snapshotCount = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private handlers: ConnectionHandlers) {
    buildArena(this.world);
  }

  connect(url: string): void {
    this.disconnect();
    this.pending.length=0; this.unsent.length=0; this.others.clear();
    this.world.clear(); buildArena(this.world);
    this.clockInitialised=false; this.snapshotCount=0;
    Object.assign(this.self, newMovementState(), { hp:100, shield:0, mats:0, weapon:0, ammo:0, buildSlot:-1, material:0, reloadMs:0, alive:true, shieldUsed:false });
    this.selfId = -1; this.clockOffset = 0;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.addEventListener("message", (ev) => { if(this.ws===ws) this.onMessage(ev.data); });
    ws.addEventListener("close", (ev) => {
      if(this.ws!==ws)return;
      this.stopPing();
      this.handlers.onClose(ev.reason || "connection closed");
    });
    ws.addEventListener("error", () => {
      if(this.ws!==ws)return;
      this.handlers.onClose("could not reach the server");
    });
    ws.addEventListener("open", () => { if (this.ws === ws) this.startPing(); });
  }

  disconnect(): void {
    this.stopPing();
    try { this.ws?.close(); } catch { /* already closing */ }
    this.ws = null;
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  get canAcceptInput():boolean {return this.connected&&this.pending.length<90;}

  sendChat(text: string): void {
    if (!this.connected) return;
    this.ws!.send(JSON.stringify({ t: C_CHAT, text }));
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.connected) return;
      const w = new Writer(8);
      w.u8(C_PING).u32(Date.now() >>> 0);
      this.ws!.send(w.finish());
    }, 2000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /** Server time right now, in the server's clock. */
  serverNow(): number {
    return Date.now() + this.clockOffset;
  }

  /** The past instant remote players are drawn at. */
  renderTime(): number {
    return this.serverNow() - INTERP_DELAY_MS;
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  /**
   * Apply one input locally (prediction) and queue it for the server. Batched
   * at INPUTS_PER_MESSAGE so we send at half the tick rate, which halves the
   * billed message count.
   */
  pushInput(cmd: InputCommand): void {
    if (!this.connected || this.pending.length >= 90) return;
    if (this.self.alive) {
      stepPlayer(this.self, cmd, this.world, TICK_DT);
    }
    this.pending.push(cmd);
    this.unsent.push(cmd);
    // Bound the replay list if the server goes quiet, so a stall cannot turn
    // into an unbounded replay when it comes back.
    // Stop prediction during a prolonged outage rather than deleting replay
    // history and continuing to walk farther from the server's position.

    if (this.unsent.length >= INPUTS_PER_MESSAGE) this.flush();
  }

  private flush(): void {
    if (!this.connected || this.unsent.length === 0) return;
    const w = new Writer(64);
    writeInputBatch(w, this.unsent, Date.now());
    this.ws!.send(w.finish());
    this.unsent.length = 0;
  }

  // -------------------------------------------------------------------------
  // Receiving
  // -------------------------------------------------------------------------

  private onMessage(data: unknown): void {
    if (typeof data === "string") {
      this.onJson(JSON.parse(data) as Record<string, unknown>);
      return;
    }
    if (!(data instanceof ArrayBuffer)) return;

    const r = new Reader(data);
    const type = r.u8();
    switch (type) {
      case S_SNAPSHOT: this.onSnapshot(r); break;
      case S_FULL_WORLD: this.onFullWorld(r); break;
      case S_PONG: {
        const sent = r.u32();
        const serverTime = r.u32();
        const rtt = ((Date.now() >>> 0) - sent) >>> 0;
        if (rtt >= 0 && rtt < 2000) {
          this.rttMs = this.rttMs * 0.75 + rtt * 0.25;
          this.syncClock(unwrapTime(serverTime) + this.rttMs / 2);
        }
        break;
      }
      default: break;
    }
  }

  private onJson(msg: Record<string, unknown>): void {
    switch (msg.t) {
      case S_WELCOME:
        this.selfId = msg.id as number;
        this.self.x = Number(msg.x); this.self.y = Number(msg.y); this.self.z = Number(msg.z);
        this.self.yaw = Number(msg.yaw);
        this.handlers.onWelcome(msg.id as number, msg.name as string);
        break;
      case S_MATCH:
        if (msg.roundOver) {
          this.pending.length = 0;
          this.unsent.length = 0;
        }
        this.handlers.onMatchState(msg);
        break;
      case S_CHAT:
        this.handlers.onChat(msg.name as string, msg.text as string);
        break;
      case S_KICK:
        this.handlers.onClose((msg.reason as string) ?? "disconnected");
        break;
      default: break;
    }
  }

  private syncClock(estimatedServerNow: number): void {
    const offset = estimatedServerNow - Date.now();
    if (!this.clockInitialised) {
      this.clockOffset = offset;
      this.clockInitialised = true;
    } else {
      this.clockOffset = this.clockOffset * 0.9 + offset * 0.1;
    }
  }

  private onFullWorld(r: Reader): void {
    const count = r.u16();
    const nowSec = Date.now() / 1000;
    for (let i = 0; i < count; i++) {
      const key = r.u32();
      const mat = r.u8();
      const facing = r.u8() as Facing;
      const owner = r.u8();
      const hp = r.u16();
      const ageMs = r.u32();

      const { gx, gy, gz, slot } = unpackKey(key);
      const piece = makePiece(gx, gy, gz, slot as Slot, mat, facing, owner, nowSec - ageMs / 1000);
      piece.hp = hp;
      this.world.set(piece);
    }
  }

  private onSnapshot(r: Reader): void {
    const snap = readSnapshot(r);
    snap.serverTimeMs = unwrapTime(snap.serverTimeMs, this.serverNow());
    this.snapshotCount++;
    this.selfId = snap.selfId;

    if (!this.clockInitialised) this.syncClock(snap.serverTimeMs + this.rttMs / 2);

    this.applyWorldEvents(snap.events);

    // --- reconcile the local player -----------------------------------------
    const s = this.self;
    s.hp = snap.self.hp;
    s.shield = snap.self.shield;
    s.mats = snap.self.mats;
    s.weapon = snap.self.weapon;
    s.ammo = snap.self.ammo;
    s.buildSlot = snap.self.buildSlot;
    s.material = snap.self.material;
    s.reloadMs = snap.self.reloadMs;
    s.alive = (snap.self.flags & PF_ALIVE) !== 0;
    s.shieldUsed = (snap.self.flags & PF_SHIELD_SPENT) !== 0;

    // Snap to authority, then replay everything the server has not seen yet.
    // Without the replay the player would visibly jump back by their ping
    // every single snapshot.
    s.x = snap.self.x; s.y = snap.self.y; s.z = snap.self.z;
    s.vx = snap.self.vx; s.vy = snap.self.vy; s.vz = snap.self.vz;
    s.grounded = (snap.self.flags & 2) !== 0;
    s.crouch = snap.self.stance / 255;
    s.stamina = (snap.self.stamina / 255) * SPRINT_STAMINA_MAX;
    s.bloom = snap.self.bloom / 255;
    s.sliding = (snap.self.flags & PF_SLIDING) !== 0;
    s.slideLockout = snap.self.slideLockout ?? 0;
    s.slideTime = snap.self.slideTime ?? 0;
    s.crouchHeld = snap.self.crouchHeld ?? false;
    s.fallPeakY = snap.self.fallPeakY ?? s.y;
    s.staminaIdle = snap.self.staminaIdle ?? 0;

    dropAcknowledged(this.pending, snap.ackSeq);
    if (s.alive) {
      for (const cmd of this.pending) {
        stepPlayer(s, cmd, this.world, TICK_DT);
      }
    }

    // --- remote players ------------------------------------------------------
    const seen = new Set<number>();
    for (const o of snap.others) {
      seen.add(o.id);
      const buf = this.others.get(o.id);
      if (buf) buf.push(o, snap.serverTimeMs);
      else this.others.set(o.id, new RemoteBuffer(o, snap.serverTimeMs));
    }
    for (const id of [...this.others.keys()]) {
      if (!seen.has(id)) this.others.delete(id);
    }

    // --- world events --------------------------------------------------------
    this.handlers.onEvents(snap.events);
  }

  private applyWorldEvents(events: readonly GameEvent[]): void {
    const nowSec = Date.now() / 1000;
    for (const e of events) {
      switch (e.kind) {
        case EV_PIECE_ADD: {
          const { gx, gy, gz, slot } = unpackKey(e.key);
          // Placed pieces are timed against the local clock so the grow-in
          // animation runs smoothly regardless of clock skew.
          this.world.set(makePiece(gx, gy, gz, slot as Slot, e.mat, e.facing as Facing, e.owner, nowSec));
          break;
        }
        case EV_PIECE_REMOVE:
          this.world.remove(e.key);
          break;
        case EV_PIECE_DAMAGE: {
          const piece = this.world.pieces.get(e.key);
          if (piece) piece.hp = e.hp;
          break;
        }
        default: break;
      }
    }
  }

  /** Interpolated poses for everyone else, at the current render time. */
  remotePoses(): Array<{ id: number; x: number; y: number; z: number; yaw: number; pitch: number; state: OtherState }> {
    const t = this.renderTime();
    const out = [];
    for (const [id, buf] of this.others) {
      const p = buf.at(t);
      out.push({ id, ...p });
    }
    return out;
  }

  get pendingInputCount(): number { return this.pending.length; }
  get snapshotsReceived(): number { return this.snapshotCount; }
}

/** Remove inputs the server has already applied, handling u16 seq wraparound. */
function dropAcknowledged(pending: InputCommand[], ackSeq: number): void {
  let cut = 0;
  for (let i = 0; i < pending.length; i++) {
    // Distance forward from ack to this command, modulo the 16-bit space. A
    // small value means the command is still ahead of the server.
    const ahead = (pending[i].seq - ackSeq) & 0xffff;
    if (ahead === 0 || ahead > 0x8000) cut = i + 1;
    else break;
  }
  if (cut > 0) pending.splice(0, cut);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
