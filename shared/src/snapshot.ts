import {
  Writer, Reader, S_SNAPSHOT,
  EV_PIECE_ADD, EV_PIECE_REMOVE, EV_PIECE_DAMAGE,
  EV_SHOT, EV_HIT, EV_DEATH, EV_RESPAWN, EV_SOUND, EV_FOLIAGE,
} from "./protocol";

/** Authoritative state for the player receiving this snapshot. Full precision:
 *  it is the base the client rewinds to before replaying pending inputs, so
 *  quantisation error here would show up as permanent jitter. */
export interface SelfState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  flags: number;
  hp: number; shield: number; mats: number;
  weapon: number; ammo: number;
  buildSlot: number; material: number; reloadMs: number;
  /** Crouch fraction, 0-255. Part of the reconciled state: the capsule height
   *  and the eye height both depend on it, so the client cannot simply keep
   *  its own copy or replay would diverge from the server every snapshot. */
  stance: number;
  /** Sprint stamina, 0-255. Reconciled like the stance: the speed cap depends
   *  on it, so the client cannot keep its own copy without drifting. */
  stamina: number;
}

/** Everyone else, quantised. They are interpolated, so 3 cm is invisible. */
export interface OtherState {
  id: number;
  flags: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  hpPct: number;
  weapon: number;
}

export type GameEvent =
  | { kind: typeof EV_PIECE_ADD; key: number; mat: number; facing: number; owner: number; placedAtMs: number }
  | { kind: typeof EV_PIECE_REMOVE; key: number }
  | { kind: typeof EV_PIECE_DAMAGE; key: number; hp: number }
  | { kind: typeof EV_SHOT; shooter: number; weapon: number; ox: number; oy: number; oz: number; ex: number; ey: number; ez: number; hit: number }
  | { kind: typeof EV_HIT; target: number; shooter: number; damage: number; headshot: number }
  | { kind: typeof EV_DEATH; victim: number; killer: number; weapon: number }
  | { kind: typeof EV_RESPAWN; id: number; x: number; y: number; z: number }
  | { kind: typeof EV_SOUND; sound: number; x: number; y: number; z: number }
  | { kind: typeof EV_FOLIAGE; index: number };

export interface Snapshot {
  serverTimeMs: number;
  ackSeq: number;
  selfId: number;
  self: SelfState;
  others: OtherState[];
  events: GameEvent[];
}

export function writeSnapshot(w: Writer, s: Snapshot): void {
  w.u8(S_SNAPSHOT);
  w.u32(s.serverTimeMs >>> 0);
  w.u16(s.ackSeq);
  w.u8(s.selfId);

  const self = s.self;
  w.f32(self.x); w.f32(self.y); w.f32(self.z);
  w.f32(self.vx); w.f32(self.vy); w.f32(self.vz);
  w.u8(self.flags);
  w.u16(Math.max(0, Math.round(self.hp)));
  w.u16(Math.max(0, Math.round(self.shield)));
  w.u16(Math.max(0, Math.round(self.mats)));
  w.u8(self.weapon);
  w.u16(Number.isFinite(self.ammo) ? Math.max(0, Math.round(self.ammo)) : 0xffff);
  w.u8(self.buildSlot);
  w.u8(self.material);
  w.u16(Math.max(0, Math.min(65535, Math.round(self.reloadMs))));
  w.u8(Math.max(0, Math.min(255, Math.round(self.stance))));
  w.u8(Math.max(0, Math.min(255, Math.round(self.stamina))));

  w.u8(s.others.length);
  for (const o of s.others) {
    w.u8(o.id);
    w.u8(o.flags);
    w.pos(o.x); w.pos(o.y); w.pos(o.z);
    w.yaw(o.yaw); w.pitch(o.pitch);
    w.u8(Math.max(0, Math.min(255, Math.round(o.hpPct))));
    w.u8(o.weapon);
  }

  w.u16(s.events.length);
  for (const e of s.events) {
    w.u8(e.kind);
    switch (e.kind) {
      case EV_PIECE_ADD:
        w.u32(e.key); w.u8(e.mat); w.u8(e.facing); w.u8(e.owner); w.u32(e.placedAtMs >>> 0);
        break;
      case EV_PIECE_REMOVE:
        w.u32(e.key);
        break;
      case EV_PIECE_DAMAGE:
        w.u32(e.key); w.u16(Math.max(0, Math.round(e.hp)));
        break;
      case EV_SHOT:
        w.u8(e.shooter); w.u8(e.weapon);
        w.pos(e.ox); w.pos(e.oy); w.pos(e.oz);
        w.pos(e.ex); w.pos(e.ey); w.pos(e.ez);
        // 0 = hit nothing, 1 = hit a build piece, 2 = hit a player. Without
        // this the client cannot tell a miss from a hit, and was drawing an
        // impact spark in mid-air at max range every time anyone missed.
        w.u8(e.hit);
        break;
      case EV_HIT:
        w.u8(e.target); w.u8(e.shooter); w.u16(Math.round(e.damage)); w.u8(e.headshot);
        break;
      case EV_DEATH:
        w.u8(e.victim); w.u8(e.killer); w.u8(e.weapon);
        break;
      case EV_RESPAWN:
        w.u8(e.id); w.pos(e.x); w.pos(e.y); w.pos(e.z);
        break;
      case EV_SOUND:
        w.u8(e.sound); w.pos(e.x); w.pos(e.y); w.pos(e.z);
        break;
      case EV_FOLIAGE:
        w.u16(e.index);
        break;
    }
  }
}

export function readSnapshot(r: Reader): Snapshot {
  const serverTimeMs = r.u32();
  const ackSeq = r.u16();
  const selfId = r.u8();

  const self: SelfState = {
    x: r.f32(), y: r.f32(), z: r.f32(),
    vx: r.f32(), vy: r.f32(), vz: r.f32(),
    flags: r.u8(),
    hp: r.u16(), shield: r.u16(), mats: r.u16(),
    weapon: r.u8(), ammo: r.u16(),
    buildSlot: r.u8(), material: r.u8(), reloadMs: r.u16(),
    stance: r.u8(),
    stamina: r.u8(),
  };
  if (self.ammo === 0xffff) self.ammo = Infinity;

  const otherCount = r.u8();
  const others: OtherState[] = [];
  for (let i = 0; i < otherCount; i++) {
    others.push({
      id: r.u8(),
      flags: r.u8(),
      x: r.pos(), y: r.pos(), z: r.pos(),
      yaw: r.yaw(), pitch: r.pitch(),
      hpPct: r.u8(),
      weapon: r.u8(),
    });
  }

  const eventCount = r.u16();
  const events: GameEvent[] = [];
  for (let i = 0; i < eventCount; i++) {
    const kind = r.u8();
    switch (kind) {
      case EV_PIECE_ADD:
        events.push({ kind: EV_PIECE_ADD, key: r.u32(), mat: r.u8(), facing: r.u8(), owner: r.u8(), placedAtMs: r.u32() });
        break;
      case EV_PIECE_REMOVE:
        events.push({ kind: EV_PIECE_REMOVE, key: r.u32() });
        break;
      case EV_PIECE_DAMAGE:
        events.push({ kind: EV_PIECE_DAMAGE, key: r.u32(), hp: r.u16() });
        break;
      case EV_SHOT:
        events.push({
          kind: EV_SHOT, shooter: r.u8(), weapon: r.u8(),
          ox: r.pos(), oy: r.pos(), oz: r.pos(),
          ex: r.pos(), ey: r.pos(), ez: r.pos(),
          hit: r.u8(),
        });
        break;
      case EV_HIT:
        events.push({ kind: EV_HIT, target: r.u8(), shooter: r.u8(), damage: r.u16(), headshot: r.u8() });
        break;
      case EV_DEATH:
        events.push({ kind: EV_DEATH, victim: r.u8(), killer: r.u8(), weapon: r.u8() });
        break;
      case EV_RESPAWN:
        events.push({ kind: EV_RESPAWN, id: r.u8(), x: r.pos(), y: r.pos(), z: r.pos() });
        break;
      case EV_SOUND:
        events.push({ kind: EV_SOUND, sound: r.u8(), x: r.pos(), y: r.pos(), z: r.pos() });
        break;
      case EV_FOLIAGE:
        events.push({ kind: EV_FOLIAGE, index: r.u16() });
        break;
      default:
        // Unknown event kind: the rest of the buffer is no longer parseable.
        return { serverTimeMs, ackSeq, selfId, self, others, events };
    }
  }

  return { serverTimeMs, ackSeq, selfId, self, others, events };
}
