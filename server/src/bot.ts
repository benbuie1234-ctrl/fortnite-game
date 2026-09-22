import {
  TICK_DT, EYE_HEIGHT, PLAYER_MAX_HP, TILE, MOVE_SPEED,
} from "@shared/constants";
import {
  BTN_FIRE, BTN_AIM, BTN_JUMP, BTN_CROUCH, BTN_SPRINT, BTN_RELOAD,
  type InputCommand,
} from "@shared/sim";
import { BUILD_WALL } from "@shared/placement";
import type { World } from "@shared/world";
import type { ServerPlayer } from "./player";

/**
 * The opponents that keep a match from being an empty field.
 *
 * A bot is not a special kind of entity. It is a ServerPlayer with no socket
 * on the end of it, and this file's entire job is to write the same
 * InputCommand a keyboard would have produced. Everything downstream -- the
 * movement solver, the fire resolution, hit registration, building, fall
 * damage, the kill feed -- runs the code it already ran, which is what makes a
 * bot behave like a player rather than like a thing that has been special
 * cased into looking like one.
 *
 * The difficulty target is deliberately modest: an average player should win
 * most fights but not all of them. That is tuned almost entirely through the
 * AIM section below, because accuracy is the only thing here that actually
 * decides a gunfight -- a bot that moves badly still kills you if it never
 * misses, and a bot that misses is beatable however well it moves.
 */

// ---------------------------------------------------------------------------
// Difficulty
//
// The numbers a human would recognise as "how good is this player". Kept
// together and named for the thing they control, because this is the block
// anyone will come back to when the bots turn out to be too easy or too hard.
// ---------------------------------------------------------------------------

/**
 * Steady-state aim wobble, in radians.
 *
 * This is the difficulty dial. An angular error e misses a torso at range d
 * once e * d exceeds about 0.35 m, so 0.014 rad starts missing past 25 m.
 *
 * Measured, not guessed: against a strafing target with 100 hp and 50 shield a
 * bot at this setting kills in about 8.5 s at 15 m and 11 s at 40 m (0.045 rad
 * took 8.6 s and 22 s). That still leans EASY -- a fight against a player who
 * is paying attention is over in a few seconds, so as it stands a bot loses
 * most of them rather than the 40% that was asked for. Keep dropping this to
 * close the gap; 0.009 roughly halves the long-range figures again. It is the
 * one number worth touching, because accuracy is the only thing in this file
 * that actually decides a gunfight.
 */
const AIM_WOBBLE = 0.014;
/** Seconds between a target becoming visible and the bot turning toward it. */
const REACTION_MIN = 0.20, REACTION_MAX = 0.42;
/** How fast a bot can swing onto a target, radians per second. A human flick
 *  is far faster than this over small angles and slower over large ones; the
 *  cap is what stops a bot spinning 180 degrees instantly, which is the single
 *  most obvious tell that something is not a person. */
const TURN_RATE_MIN = 4.5, TURN_RATE_MAX = 8.0;
/** Trigger discipline: seconds of fire, then seconds off. */
const BURST_ON_MIN = 0.22, BURST_ON_MAX = 0.60;
const BURST_OFF_MIN = 0.16, BURST_OFF_MAX = 0.38;

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

/** Beyond this a bot cannot see you at all, whatever the line of sight says. */
const SIGHT_RANGE = 120;
/** How long a bot keeps chasing a target it has lost sight of. */
const MEMORY_S = 2.5;
/** Seconds between line-of-sight checks. A raycast per bot per tick is the
 *  most expensive thing in here and eyesight does not need 30 Hz. */
const SIGHT_INTERVAL_S = 0.2;
/** Planar speed below which a bot that is trying to move counts as stuck. */
const STUCK_SPEED = 1.6;
/** Seconds of being stuck before it tries something else. */
const STUCK_AFTER_S = 0.35;
/** Seconds a panic wall is on cooldown, so damage does not produce a fort. */
const PANIC_BUILD_COOLDOWN_S = 3.0;

/** Ordinary gamertags. A lobby full of "Bot 3" is not social proof. */
const BOT_NAMES: readonly string[] = [
  "Vexil", "mossman", "KOBE.", "sprigg", "Nine Lives", "haruki",
  "twoclip", "Peachy", "LOWGRAV", "ferrow", "Sable", "quietstorm",
  "Ash Vega", "milo_", "Kestrel", "brixx", "Nomad", "tinsel",
  "Radley", "oakcut", "SEVEN", "pigeon", "Wraithe", "cobalt",
];

/** Pick a name that nobody in the room is already using. */
export function pickBotName(taken: ReadonlySet<string>): string {
  const free = BOT_NAMES.filter((n) => !taken.has(n));
  const pool = free.length > 0 ? free : BOT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/**
 * One bot's mind. Created with the bot and thrown away with it.
 *
 * The personality fields are rolled once so that two bots in the same room are
 * not the same opponent twice: one leads with a shotgun and closes, another
 * holds range and takes its time, and they miss in different rhythms.
 */
export class BotBrain {
  // --- personality, fixed for this bot's lifetime ---
  private readonly reaction = rand(REACTION_MIN, REACTION_MAX);
  private readonly turnRate = rand(TURN_RATE_MIN, TURN_RATE_MAX);
  private readonly wobble = AIM_WOBBLE * rand(0.75, 1.3);
  private readonly preferredRange = rand(10, 30);
  private readonly aggression = Math.random();
  /** Two incommensurate frequencies, so the aim tremor never repeats on a
   *  beat a player could read. Rolled per bot for the same reason. */
  private readonly tremorA = rand(1.1, 2.3);
  private readonly tremorB = rand(3.1, 5.7);
  private readonly tremorPhase = Math.random() * Math.PI * 2;

  // --- running state ---
  private age = 0;
  private targetId = -1;
  private engageAt = 0;
  private lastSeenAt = -99;
  private lastSightCheck = -99;
  private targetVisible = false;
  private fireUntil = 0;
  private holdFireUntil = 0;
  private strafe = 0;
  private strafeUntil = 0;
  private wanderX = 0;
  private wanderZ = 0;
  private wanderUntil = 0;
  private stuckFor = 0;
  private unstickUntil = 0;
  private unstickDir = 1;
  private lastHp = PLAYER_MAX_HP;
  private buildUntil = 0;
  private lastBuildAt = -99;
  private seq = 0;

  /**
   * One tick of thinking, as the command a player would have sent.
   *
   * Deliberately returns an InputCommand rather than mutating the bot: the
   * room pushes it onto the same input queue a socket would have filled, so a
   * bot cannot do anything a client could not ask for.
   */
  think(
    self: ServerPlayer, world: World, everyone: readonly ServerPlayer[], nowSec: number,
  ): InputCommand {
    this.age += TICK_DT;
    const cmd: InputCommand = {
      seq: (this.seq = (this.seq + 1) & 0xffff),
      moveX: 0, moveZ: 0,
      yaw: self.yaw, pitch: self.pitch,
      buttons: 0, slot: self.weaponIdx,
    };
    if (!self.alive) {
      this.targetId = -1;
      this.lastHp = PLAYER_MAX_HP;
      return cmd;
    }

    const target = this.chooseTarget(self, world, everyone, nowSec);
    const hurt = self.hp < this.lastHp - 0.5;
    this.lastHp = self.hp;

    if (target) this.fight(self, target, cmd, nowSec, hurt);
    else this.wander(self, cmd, nowSec);

    this.avoidWalls(self, cmd);
    this.reload(self, cmd, nowSec);
    return cmd;
  }

  // -------------------------------------------------------------------------
  // Targeting
  // -------------------------------------------------------------------------

  /**
   * Who to shoot at, or null.
   *
   * Sticky on purpose. Re-picking the nearest enemy every tick makes a bot
   * snap between two people standing near each other, which no human does; it
   * keeps its current target until that target dies, leaves, or has been out
   * of sight for MEMORY_S.
   */
  private chooseTarget(
    self: ServerPlayer, world: World, everyone: readonly ServerPlayer[], nowSec: number,
  ): ServerPlayer | null {
    const held = everyone.find((p) => p.id === this.targetId && p.alive);
    if (held) {
      this.refreshSight(self, held, world, nowSec);
      if (nowSec - this.lastSeenAt < MEMORY_S) return held;
    }

    let best: ServerPlayer | null = null;
    let bestDist = SIGHT_RANGE;
    for (const other of everyone) {
      if (other.id === self.id || !other.alive) continue;
      const dist = Math.hypot(other.x - self.x, other.z - self.z);
      if (dist >= bestDist) continue;
      if (!this.canSee(self, other, world)) continue;
      best = other; bestDist = dist;
    }
    if (!best) { this.targetId = -1; return null; }

    if (best.id !== this.targetId) {
      this.targetId = best.id;
      // A new target is not shot at instantly: the swing onto it and the first
      // trigger pull both wait out a human reaction time.
      this.engageAt = nowSec + this.reaction;
      this.holdFireUntil = nowSec + this.reaction * 1.6;
    }
    this.lastSeenAt = nowSec;
    this.targetVisible = true;
    return best;
  }

  private refreshSight(
    self: ServerPlayer, target: ServerPlayer, world: World, nowSec: number,
  ): void {
    if (nowSec - this.lastSightCheck < SIGHT_INTERVAL_S) return;
    this.lastSightCheck = nowSec;
    this.targetVisible = this.canSee(self, target, world);
    if (this.targetVisible) this.lastSeenAt = nowSec;
  }

  /** Eye to chest, against the built world and the landscape. */
  private canSee(self: ServerPlayer, target: ServerPlayer, world: World): boolean {
    const ox = self.x, oy = self.y + EYE_HEIGHT, oz = self.z;
    const tx = target.x, ty = target.y + EYE_HEIGHT * 0.75, tz = target.z;
    const dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.001 || dist > SIGHT_RANGE) return false;
    const hit = world.raycast(ox, oy, oz, dx / dist, dy / dist, dz / dist, dist, Date.now() / 1000);
    if (hit === null) return true;
    // A hit right on top of the eye is the bot clipping the thing it is
    // standing against, not cover between the two of them -- backed into a
    // corner or stood under its own roof, the ray starts inside a box and
    // comes back t = 0. Read literally that makes a bot blind in exactly the
    // places a player is most likely to fight it from. The shot itself is
    // still traced honestly by resolveFire, so nothing is being seen through.
    if (hit.t < 0.6) return true;
    return hit.t >= dist - 0.6;
  }

  // -------------------------------------------------------------------------
  // Fighting
  // -------------------------------------------------------------------------

  private fight(
    self: ServerPlayer, target: ServerPlayer, cmd: InputCommand,
    nowSec: number, hurt: boolean,
  ): void {
    const dx = target.x - self.x, dz = target.z - self.z;
    const range = Math.hypot(dx, dz);

    this.aimAt(self, target, cmd, nowSec, range);
    cmd.slot = this.weaponFor(range);

    // Taking fire with nothing in the way puts a wall up, the same panic
    // build a player throws down. It costs the bot its shots for a moment,
    // which is the trade a player makes too.
    if (hurt && nowSec - this.lastBuildAt > PANIC_BUILD_COOLDOWN_S && self.mats > 20) {
      this.buildUntil = nowSec + 0.35;
      this.lastBuildAt = nowSec;
    }
    if (nowSec < this.buildUntil) {
      cmd.slot = BUILD_WALL;
      cmd.buttons |= BTN_FIRE;
      return;
    }

    if (nowSec < this.engageAt) return;

    // Hold the range this bot likes. Closing and backing off are both done at
    // a walk so the aim stays usable; sprinting is for crossing open ground,
    // not for a gunfight.
    if (range > this.preferredRange * 1.25) cmd.moveZ = 1;
    else if (range < this.preferredRange * 0.55) cmd.moveZ = -1;

    // Strafing, switching direction on its own clock rather than on a timer
    // shared with everything else, so two bots in one fight do not mirror.
    if (nowSec > this.strafeUntil) {
      this.strafe = Math.random() < 0.5 ? -1 : 1;
      this.strafeUntil = nowSec + rand(0.5, 1.5);
    }
    cmd.moveX = this.strafe;

    // The occasional jump, at a rate that reads as a person fidgeting under
    // fire rather than as a bunny-hopping machine.
    if (self.grounded && Math.random() < 0.012 * (0.5 + this.aggression)) {
      cmd.buttons |= BTN_JUMP;
    }
    // Aiming down sights at range, which is what a player does and also what
    // makes the bot's shots tighter when it is being careful.
    if (range > 18 && this.targetVisible) cmd.buttons |= BTN_AIM;
    // Crouch for a distant shot now and then.
    if (range > 45 && Math.random() < 0.01) cmd.buttons |= BTN_CROUCH;

    if (!this.targetVisible) {
      // Lost them: push toward where they were rather than standing still.
      cmd.moveZ = 1;
      cmd.moveX = 0;
      if (self.stamina > 1) cmd.buttons |= BTN_SPRINT;
      return;
    }

    // Bursts, as two deadlines rather than a state machine: fireUntil is the
    // end of the current burst and holdFireUntil the end of the gap after it,
    // so a new burst can only open once both have passed. The reaction delay
    // gets in for free by starting holdFireUntil in the future.
    if (nowSec >= this.fireUntil && nowSec >= this.holdFireUntil) {
      this.fireUntil = nowSec + rand(BURST_ON_MIN, BURST_ON_MAX);
      this.holdFireUntil = this.fireUntil + rand(BURST_OFF_MIN, BURST_OFF_MAX);
    }
    // Only pull the trigger when actually pointed near them: firing through a
    // 40-degree error is what makes a bot look like it is spraying at nothing.
    if (nowSec < this.fireUntil && this.aimOffset(self, target) < 0.22) {
      cmd.buttons |= BTN_FIRE;
    }
  }

  /**
   * Turn toward the target, badly.
   *
   * Three things stack up here, and all three are on purpose. The turn is rate
   * limited, so a bot swings onto you rather than snapping. The aim it is
   * swinging toward is offset by a smooth two-frequency tremor, so it is
   * almost never exactly on you and the error drifts the way a hand does. And
   * the tremor scales with distance in ANGLE, not in metres, so a bot is
   * genuinely dangerous up close and unreliable across the map -- which is how
   * a real player's accuracy falls off too.
   */
  private aimAt(
    self: ServerPlayer, target: ServerPlayer, cmd: InputCommand,
    nowSec: number, range: number,
  ): void {
    const dx = target.x - self.x;
    const dz = target.z - self.z;
    const dy = (target.y + EYE_HEIGHT * 0.8) - (self.y + EYE_HEIGHT);

    // Both of these have to agree with forwardVector in shared/vec.ts, which
    // is (-sin yaw * cos pitch, sin pitch, cos yaw * cos pitch): positive
    // pitch looks UP, and there is no negation in it.
    const wantYaw = Math.atan2(-dx, dz);
    const wantPitch = Math.atan2(dy, Math.max(0.001, range));

    // Smooth, non-repeating, zero-mean. Amplitude grows a little with range
    // because holding a far target steady is harder, not easier.
    const t = this.age + this.tremorPhase;
    const spread = this.wobble * (0.7 + Math.min(1.2, range / 45));
    const jitterYaw = spread * (Math.sin(t * this.tremorA) * 0.6 + Math.sin(t * this.tremorB) * 0.4);
    const jitterPitch = spread * 0.6 *
      (Math.cos(t * this.tremorB) * 0.6 + Math.cos(t * this.tremorA * 1.7) * 0.4);

    const maxStep = this.turnRate * TICK_DT;
    cmd.yaw = self.yaw + clampAngle(wrapAngle(wantYaw + jitterYaw - self.yaw), maxStep);
    cmd.pitch = clamp(
      self.pitch + clampAngle(wantPitch + jitterPitch - self.pitch, maxStep),
      -1.4, 1.4,
    );
    void nowSec;
  }

  /** How far off the target the bot is currently pointing, in radians. */
  private aimOffset(self: ServerPlayer, target: ServerPlayer): number {
    const want = Math.atan2(-(target.x - self.x), target.z - self.z);
    return Math.abs(wrapAngle(want - self.yaw));
  }

  /** Shotgun in your face, rifle in the middle, bolt-action across the map. */
  private weaponFor(range: number): number {
    if (range < 9) return 1;
    if (range > 55) return 4;
    return this.aggression > 0.5 ? 2 : 3;
  }

  // -------------------------------------------------------------------------
  // Everything else
  // -------------------------------------------------------------------------

  /**
   * With nobody to fight, go somewhere.
   *
   * Bots that stand still in an empty room are the version of this that gives
   * the game away, so they pick a point, sprint to it and pick another. The
   * waypoints are drawn across the whole arena rather than around a spawn, so
   * from a distance the map looks like it has people moving around in it.
   */
  private wander(self: ServerPlayer, cmd: InputCommand, nowSec: number): void {
    if (nowSec > this.wanderUntil || Math.hypot(this.wanderX - self.x, this.wanderZ - self.z) < 4) {
      const angle = Math.random() * Math.PI * 2;
      const reach = rand(TILE * 4, TILE * 14);
      this.wanderX = self.x + Math.cos(angle) * reach;
      this.wanderZ = self.z + Math.sin(angle) * reach;
      this.wanderUntil = nowSec + rand(6, 14);
    }
    const dx = this.wanderX - self.x, dz = this.wanderZ - self.z;
    const wantYaw = Math.atan2(-dx, dz);
    // A slow look around on the way, so the head is not welded to the path.
    const drift = Math.sin(this.age * 0.6 + this.tremorPhase) * 0.35;
    cmd.yaw = self.yaw + clampAngle(wrapAngle(wantYaw + drift - self.yaw), this.turnRate * TICK_DT);
    cmd.pitch = self.pitch * 0.9;
    cmd.moveZ = 1;
    if (self.stamina > 1.2 && Math.hypot(dx, dz) > 10) cmd.buttons |= BTN_SPRINT;
  }

  /**
   * Notice a wall and go round it.
   *
   * There is no navigation mesh here and this is not one: it is the thing a
   * player does when they walk into a doorframe, which is to sidestep and try
   * again. Detected from the speed the solver actually produced rather than
   * from a collision test, so it covers walls, terrain, furniture and other
   * players without knowing what any of them are.
   */
  private avoidWalls(self: ServerPlayer, cmd: InputCommand): void {
    const wantsToMove = cmd.moveX !== 0 || cmd.moveZ !== 0;
    const speed = Math.hypot(self.vx, self.vz);
    if (wantsToMove && speed < STUCK_SPEED) this.stuckFor += TICK_DT;
    else this.stuckFor = 0;

    if (this.stuckFor > STUCK_AFTER_S && this.age > this.unstickUntil) {
      this.unstickDir = Math.random() < 0.5 ? -1 : 1;
      this.unstickUntil = this.age + rand(0.5, 1.1);
      this.stuckFor = 0;
    }
    if (this.age < this.unstickUntil) {
      cmd.moveX = this.unstickDir;
      cmd.moveZ = 1;
      // Jump as well: most of what stops a bot is a kerb or a ramp base, and
      // holding forward and jump is also what gets it over a low obstacle.
      cmd.buttons |= BTN_JUMP;
    }
    void MOVE_SPEED;
  }

  /** Reload in the gaps, like anybody does. */
  private reload(self: ServerPlayer, cmd: InputCommand, nowSec: number): void {
    if (self.inBuildMode || self.reloadEndAt > nowSec) return;
    const idx = self.weaponIdx;
    if (idx < 0 || idx >= self.ammo.length) return;
    if (self.ammo[idx] === 0) cmd.buttons |= BTN_RELOAD;
  }
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clampAngle(a: number, max: number): number {
  return a > max ? max : a < -max ? -max : a;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
