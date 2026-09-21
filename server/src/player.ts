import {
  PLAYER_MAX_HP, PLAYER_MAX_SHIELD, START_MATS, MAX_MATS, PLAYER_RADIUS,
  SPRINT_STAMINA_MAX,
} from "@shared/constants";
import type { MovementState, InputCommand } from "@shared/sim";
import { ARENA_LOADOUT, weaponById } from "@shared/weapons";
import type { Box } from "@shared/build";
import { playerHeight } from "@shared/sim";

/** One position sample, kept so the server can rewind for lag compensation. */
export interface HistorySample {
  t: number;
  x: number; y: number; z: number;
}

const HISTORY_LEN = 32; // ~1s at 30Hz

export class ServerPlayer implements MovementState {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  yaw = 0; pitch = 0;
  grounded = false;
  lastLandingSpeed = 0;
  crouch = 0;
  sliding = false;
  slideLockout = 0;
  crouchHeld = false;
  sprinting = false;
  stamina = SPRINT_STAMINA_MAX;
  staminaIdle = 0;
  fallPeakY = 0;
  lastFallHeight = 0;
  bloom = 0;


  /** Wins across rounds, for the leaderboard. Survives endRound, unlike kills. */
  wins = 0;

  hp = PLAYER_MAX_HP;
  shield = 0;
  mats = START_MATS;
  alive = true;
  respawnAt = 0;

  /** 0-4 selects a weapon from the loadout; 5-8 selects a build piece. */
  weaponIdx = 2;
  buildSlot = -1;
  material = 0;

  readonly ammo: number[] = ARENA_LOADOUT.map((w) => weaponById(w).magSize);
  reloadEndAt = 0;
  nextFireAt = 0;
  lastBuildAt = 0;
  wasFiring = false;
  aiming = false;

  /** One shield per match. Deliberately NOT reset in resetForSpawn: a
   *  per-life shield would be a shield in every fight, which is a different
   *  and much stronger item than the one that was asked for. Cleared when a
   *  round ends. */
  shieldUsed = false;

  kills = 0;
  deaths = 0;
  /** Attribution for the kill feed, and for who gets credit on a bleed-out. */
  lastDamagedBy = -1;
  lastDamagedAt = 0;

  inputQueue: InputCommand[] = [];
  lastSeq = 0;
  lastReceivedSeq = 0;
  receivedInput = false;
  lastInputAtMs = 0;
  rttMs = 60;

  private history: HistorySample[] = [];
  private historyHead = 0;

  constructor(
    readonly id: number,
    readonly name: string,
    readonly socket: WebSocket,
  ) {}

  get weaponId(): number {
    return ARENA_LOADOUT[this.weaponIdx] ?? ARENA_LOADOUT[0];
  }

  get inBuildMode(): boolean {
    return this.buildSlot >= 0;
  }

  recordHistory(t: number): void {
    const sample = { t, x: this.x, y: this.y, z: this.z };
    if (this.history.length < HISTORY_LEN) {
      this.history.push(sample);
    } else {
      this.history[this.historyHead] = sample;
    }
    this.historyHead = (this.historyHead + 1) % HISTORY_LEN;
  }

  /** Interpolated position at a past time, for lag-compensated hit checks. */
  positionAt(t: number): { x: number; y: number; z: number } {
    if (this.history.length === 0) return { x: this.x, y: this.y, z: this.z };

    let before: HistorySample | null = null;
    let after: HistorySample | null = null;
    for (const s of this.history) {
      if (s.t <= t && (!before || s.t > before.t)) before = s;
      if (s.t >= t && (!after || s.t < after.t)) after = s;
    }
    if (before && after && after.t > before.t) {
      const f = (t - before.t) / (after.t - before.t);
      return {
        x: before.x + (after.x - before.x) * f,
        y: before.y + (after.y - before.y) * f,
        z: before.z + (after.z - before.z) * f,
      };
    }
    const s = before ?? after;
    return s ? { x: s.x, y: s.y, z: s.z } : { x: this.x, y: this.y, z: this.z };
  }

  resetForSpawn(x: number, y: number, z: number, yaw: number): void {
    this.x = x; this.y = y; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = yaw; this.pitch = 0;
    this.grounded = true;
    this.crouch = 0;
    this.sliding = false;
    this.slideLockout = 0;
    this.crouchHeld = false;
    this.sprinting = false;
    this.stamina = SPRINT_STAMINA_MAX;
    this.staminaIdle = 0;
    this.fallPeakY = y;
    this.lastFallHeight = 0;
    this.bloom = 0;
    this.hp = PLAYER_MAX_HP;
    this.shield = PLAYER_MAX_SHIELD * 0.5;
    this.mats = START_MATS;
    this.alive = true;
    this.weaponIdx = 2;
    this.buildSlot = -1;
    this.reloadEndAt = 0;
    this.nextFireAt = 0;
    for (let i = 0; i < this.ammo.length; i++) {
      this.ammo[i] = weaponById(ARENA_LOADOUT[i]).magSize;
    }
    this.history.length = 0;
    this.historyHead = 0;
  }

  addMats(n: number): void {
    this.mats = Math.min(MAX_MATS, this.mats + n);
  }
}

/**
 * Body and head boxes at an arbitrary position, for hit registration.
 *
 * Stance-aware: crouching has to actually shrink the target, or it is a
 * disadvantage with no upside.
 */
export function hitBoxes(
  x: number, y: number, z: number, crouch = 0,
): { body: Box; head: Box } {
  const r = PLAYER_RADIUS;
  const height = playerHeight(crouch);
  const headBottom = y + height - 0.28;
  return {
    body: [x - r, y, z - r, x + r, headBottom, z + r],
    head: [x - 0.24, headBottom, z - 0.24, x + 0.24, y + height, z + 0.24],
  };
}
