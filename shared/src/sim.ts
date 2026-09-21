import {
  TICK_DT, PLAYER_HEIGHT, PLAYER_RADIUS, GRAVITY, JUMP_VELOCITY, MOVE_SPEED,
  GROUND_ACCEL, AIR_ACCEL, GROUND_FRICTION, MAX_FALL_SPEED, STEP_HEIGHT,
  EYE_HEIGHT, PLAYER_MAX_HP,
  BACKPEDAL_SPEED_MULT, BACKPEDAL_AIR_SPEED_MULT, STRAFE_SPEED_MULT, SPRINT_SPEED_MULT,
  CROUCH_HEIGHT, CROUCH_EYE_HEIGHT, CROUCH_SPEED_MULT, CROUCH_TRANSITION_SPEED,
  SLIDE_MIN_SPEED, SLIDE_BOOST_SPEED, SLIDE_SPRINT_BOOST_SPEED, SLIDE_FRICTION,
  SLIDE_END_SPEED, SLIDE_MAX_SPEED, SLIDE_COOLDOWN, SLIDE_STEER_RATE,
  SPRINT_STAMINA_MAX, SPRINT_REGEN_DELAY, SPRINT_REGEN_RATE, SPRINT_MIN_TO_START,
  MANTLE_REACH, MANTLE_FORWARD, MANTLE_SPEED,
  FALL_SAFE_HEIGHT, FALL_LETHAL_HEIGHT, FALL_MIN_IMPACT_SPEED,
} from "./constants";
import type { Box, Piece } from "./build";
import type { World } from "./world";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const BTN_JUMP   = 1 << 0;
export const BTN_FIRE   = 1 << 1;
export const BTN_AIM    = 1 << 2;
export const BTN_CROUCH = 1 << 3;
export const BTN_RELOAD = 1 << 4;
export const BTN_EDIT   = 1 << 5;
export const BTN_RESET  = 1 << 6;
export const BTN_SPRINT = 1 << 7;
/** Development aim lock. Travels in the button field because the shot cone is
 *  built on the server, so steering the client's view alone cannot stop a
 *  round scattering on bloom or dropping under the target. */
export const BTN_AIMBOT = 1 << 8;

export interface InputCommand {
  seq: number;
  /** -1, 0 or 1. Strafe and forward, in the player's local frame. */
  moveX: number;
  moveZ: number;
  /** Already quantised to wire precision before prediction runs, so the client
   *  predicts with the exact value the server will receive. */
  yaw: number;
  pitch: number;
  buttons: number;
  /** 0-4 weapon slot, or 5-8 build piece; see protocol. */
  slot: number;
}

export interface MovementState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  grounded: boolean;
  /** Downward speed at the moment of landing. Drives the landing sound and the
   *  camera dip; fall DAMAGE is driven by lastFallHeight instead. */
  lastLandingSpeed: number;
  /** 0 = standing, 1 = fully crouched. Interpolated so the capsule and the eye
   *  travel smoothly rather than snapping. Part of the reconciled state. */
  crouch: number;
  /** True while a slide is in progress. */
  sliding: boolean;
  /** Seconds left before another slide may be started. */
  slideLockout: number;
  /** Whether crouch was down last tick. A slide needs a fresh PRESS: keyed off
   *  the held state instead, holding crouch while running re-entered a slide
   *  the instant each lockout expired, which is an infinite slide with a
   *  stutter in it rather than a movement option. */
  crouchHeld: boolean;
  /** Highest point reached since last leaving the ground. */
  fallPeakY: number;
  /** True while actually sprinting -- which needs the button, forward input and
   *  stamina, so it is not the same thing as holding shift. */
  sprinting: boolean;
  /** Seconds of sprint left. */
  stamina: number;
  /** Seconds since sprinting stopped, for the regeneration delay. */
  staminaIdle: number;
  /** Height of the fall that ended on this tick, or 0. Fall damage reads this
   *  instead of an impact speed: several code paths (ramp snap, step-up settle,
   *  ground clamp) all produce an impact speed, which is exactly why fall
   *  damage used to feel random. Height fallen has one meaning. */
  lastFallHeight: number;
}

/** Capsule height at the player's current stance. */
export function playerHeight(crouch: number): number {
  return PLAYER_HEIGHT + (CROUCH_HEIGHT - PLAYER_HEIGHT) * clamp01(crouch);
}

/** Eye offset above the feet at the player's current stance. */
export function eyeHeightFor(crouch: number): number {
  return EYE_HEIGHT + (CROUCH_EYE_HEIGHT - EYE_HEIGHT) * clamp01(crouch);
}

function clamp01(v: number): number {
  // Written so a NaN or a missing field falls to 0 rather than poisoning every
  // height derived from it. A stance that is not a number is a standing player.
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

/**
 * Damage for a completed fall.
 *
 * Quadratic in the height dropped, which is the quantity a player can actually
 * judge by eye, with a free zone at the bottom and a guaranteed kill at the
 * top. The impact-speed gate throws out "landings" that a surface snap
 * produced rather than a real fall.
 */
export function fallDamage(height: number, impactSpeed: number): number {
  if (height <= FALL_SAFE_HEIGHT) return 0;
  if (impactSpeed < FALL_MIN_IMPACT_SPEED) return 0;
  const span = FALL_LETHAL_HEIGHT - FALL_SAFE_HEIGHT;
  const t = Math.min(1, (height - FALL_SAFE_HEIGHT) / span);
  return PLAYER_MAX_HP * t * t;
}

/** A fresh movement state, so every caller agrees on the new fields. */
export function newMovementState(): MovementState {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0, grounded: false, lastLandingSpeed: 0,
    crouch: 0, sliding: false, slideLockout: 0, crouchHeld: false,
    sprinting: false, stamina: SPRINT_STAMINA_MAX, staminaIdle: 0,
    fallPeakY: 0, lastFallHeight: 0,
  };
}

// Scratch buffers reused every step. The solver runs 30x/sec per player on the
// server and up to ~200x/sec on the client during reconciliation, so it must
// not allocate.
const EPS = 1e-4;
const scratchBoxes: Box[] = [];
const scratchRamps: Piece[] = [];

function overlaps(
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
  b: Box,
): boolean {
  return (
    minX < b[3] && maxX > b[0] &&
    minY < b[4] && maxY > b[1] &&
    minZ < b[5] && maxZ > b[2]
  );
}

/**
 * Advance one player by exactly one tick.
 *
 * Deterministic given (state, input, world): the client replays this over its
 * unacknowledged inputs after every snapshot, and must land on the same result
 * the server did or the player will visibly rubber-band.
 */
export function stepPlayer(
  s: MovementState,
  input: InputCommand,
  world: World,
  dt: number = TICK_DT,
): void {
  s.yaw = input.yaw;
  s.pitch = input.pitch;
  s.lastLandingSpeed = 0;
  s.lastFallHeight = 0;
  if (s.slideLockout > 0) s.slideLockout = Math.max(0, s.slideLockout - dt);

  const wantsCrouch = (input.buttons & BTN_CROUCH) !== 0;
  const sprinting = (input.buttons & BTN_SPRINT) !== 0;
  const planarSpeed = Math.hypot(s.vx, s.vz);

  // --- slide ---------------------------------------------------------------
  //
  // Crouch at speed to slide. A slide is not a movement mode with its own
  // controls; it is ordinary movement with the friction turned most of the way
  // off and one shove to start it, which is what makes it feel like momentum
  // rather than an animation you are locked into.
  if (s.sliding) {
    if (!wantsCrouch || !s.grounded || planarSpeed < SLIDE_END_SPEED) {
      s.sliding = false;
      s.slideLockout = SLIDE_COOLDOWN;
    }
  } else if (
    wantsCrouch && !s.crouchHeld && s.grounded &&
    s.slideLockout <= 0 && planarSpeed >= SLIDE_MIN_SPEED
  ) {
    s.sliding = true;
    // s.sprinting still holds LAST tick's value here, which is the question
    // being asked: were you sprinting at the moment you hit crouch? Sliding out
    // of a jog gives a small shove; sliding out of a sprint gives a real one.
    const target = s.sprinting ? SLIDE_SPRINT_BOOST_SPEED : SLIDE_BOOST_SPEED;
    // Never below the speed you arrived with -- a slide must not brake you.
    const boost = Math.max(1, target / Math.max(planarSpeed, 1e-4));
    s.vx *= boost;
    s.vz *= boost;
  }
  s.crouchHeld = wantsCrouch;

  // --- stance --------------------------------------------------------------
  const previousCrouch = s.crouch;
  const crouchTarget = wantsCrouch || s.sliding ? 1 : 0;
  const crouchStep = CROUCH_TRANSITION_SPEED * dt;
  s.crouch = crouchTarget > s.crouch
    ? Math.min(crouchTarget, s.crouch + crouchStep)
    : Math.max(crouchTarget, s.crouch - crouchStep);

  // --- sprint stamina ------------------------------------------------------
  //
  // Sprinting is a resource, not a modifier you can hold forever. It drains
  // while held and only begins to come back after a pause, so a chase has a
  // shape to it. The minimum-to-restart floor stops an empty bar being tapped
  // back on the instant it leaves zero.
  const wantsSprint = sprinting && input.moveZ > 0 && s.crouch < 0.5 && !s.sliding;
  const threshold = s.sprinting ? 0 : SPRINT_MIN_TO_START;
  if (wantsSprint && s.stamina > threshold) {
    s.sprinting = true;
    s.stamina = Math.max(0, s.stamina - dt);
    s.staminaIdle = 0;
  } else {
    s.sprinting = false;
    s.staminaIdle += dt;
    if (s.staminaIdle >= SPRINT_REGEN_DELAY) {
      s.stamina = Math.min(SPRINT_STAMINA_MAX, s.stamina + SPRINT_REGEN_RATE * dt);
    }
  }

  // --- desired horizontal direction, in world space ---
  const sin = Math.sin(s.yaw);
  const cos = Math.cos(s.yaw);
  let wishX = -input.moveX * cos - input.moveZ * sin;
  let wishZ = -input.moveX * sin + input.moveZ * cos;
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 1e-6) {
    wishX /= wishLen;
    wishZ /= wishLen;
  }

  // --- jump ----------------------------------------------------------------
  //
  // Deliberately BEFORE acceleration. It used to come after, so the tick you
  // jumped on had already picked GROUND_ACCEL while the jump then cleared the
  // grounded flag -- one free tick of ground acceleration applied in mid-air,
  // every single jump. That is the "jumping gives you a speed boost" bug, and
  // it read as a backwards boost because backpedalling had no speed cap of its
  // own to hide it.
  const jumped = s.grounded && (input.buttons & BTN_JUMP) !== 0 && !s.sliding;
  if (jumped) {
    s.vy = JUMP_VELOCITY;
    s.grounded = false;
  }

  const accel = s.grounded ? GROUND_ACCEL : AIR_ACCEL;

  // Friction first, and only on the ground, so air control stays floaty. A
  // slide keeps its speed by barely rubbing at all.
  if (s.grounded) {
    const friction = s.sliding ? SLIDE_FRICTION : GROUND_FRICTION;
    const speed = Math.hypot(s.vx, s.vz);
    if (speed > 1e-4) {
      const drop = speed * friction * dt;
      const scale = Math.max(0, speed - drop) / speed;
      s.vx *= scale;
      s.vz *= scale;
    }
  }

  if (wishLen > 1e-6 && !s.sliding) {
    // Quake-style: only accelerate up to the projection deficit, which keeps
    // diagonal movement from exceeding max speed.
    const add = Math.min(speedLimitFor(input, s), accel * dt);
    if (add > 0) {
      s.vx += wishX * add;
      s.vz += wishZ * add;
    }
  }

  // Sliding still steers, but steering ROTATES the momentum rather than adding
  // to it. Adding to it meant the steering input balanced the slide friction
  // at around 6 m/s, so a player holding forward slid forever and the slide
  // became a movement mode instead of a burst.
  if (wishLen > 1e-6 && s.sliding) {
    const speed = Math.hypot(s.vx, s.vz);
    if (speed > 1e-4) {
      const k = Math.min(1, SLIDE_STEER_RATE * dt);
      const nx = s.vx / speed + wishX * k;
      const nz = s.vz / speed + wishZ * k;
      const n = Math.hypot(nx, nz) || 1;
      s.vx = (nx / n) * speed;
      s.vz = (nz / n) * speed;
    }
  }

  // A slide down a slope still gathers speed from gravity, so it needs a cap.
  if (s.sliding) {
    const speed = Math.hypot(s.vx, s.vz);
    if (speed > SLIDE_MAX_SPEED) {
      s.vx *= SLIDE_MAX_SPEED / speed;
      s.vz *= SLIDE_MAX_SPEED / speed;
    }
  }

  s.vy += GRAVITY * dt;
  if (s.vy < MAX_FALL_SPEED) s.vy = MAX_FALL_SPEED;

  moveAndCollide(s, world, dt, input, previousCrouch);
}

/**
 * How much more speed this input is allowed to add along the wish direction.
 *
 * Returned as a deficit rather than a limit so the caller stays a one-liner.
 * Backwards and sideways travel are capped below forward travel, which is both
 * how every shooter of this kind behaves and what stops a jump backwards from
 * carrying more speed than a jump forwards.
 */
function speedLimitFor(input: InputCommand, s: MovementState): number {
  let limit = MOVE_SPEED;
  const crouched = s.crouch > 0.5;
  // s.sprinting, not the button: holding shift on an empty stamina bar must
  // not still pay out the sprint speed.
  if (s.sprinting && !crouched) limit *= SPRINT_SPEED_MULT;
  if (crouched) limit *= CROUCH_SPEED_MULT;
  if (input.moveZ < 0) {
    // On the ground, backing up is slow. In the air it is the fastest way to
    // disengage -- a deliberate movement option rather than the accidental one
    // a mis-ordered jump used to produce, and the reason retreating rewards a
    // jump instead of a sideways shuffle.
    limit *= s.grounded ? BACKPEDAL_SPEED_MULT : BACKPEDAL_AIR_SPEED_MULT;
  } else if (input.moveZ === 0 && input.moveX !== 0) {
    limit *= STRAFE_SPEED_MULT;
  }
  return limit - projected(s, input);
}

/** Current speed along the input's wish direction. */
function projected(s: MovementState, input: InputCommand): number {
  const sin = Math.sin(s.yaw);
  const cos = Math.cos(s.yaw);
  let wx = -input.moveX * cos - input.moveZ * sin;
  let wz = -input.moveX * sin + input.moveZ * cos;
  const len = Math.hypot(wx, wz);
  if (len < 1e-6) return 0;
  wx /= len; wz /= len;
  return s.vx * wx + s.vz * wz;
}

function queryAround(s: MovementState, world: World, pad: number): void {
  world.collidersNear(
    s.x - PLAYER_RADIUS - pad, s.y - pad, s.z - PLAYER_RADIUS - pad,
    s.x + PLAYER_RADIUS + pad, s.y + playerHeight(s.crouch) + pad + 2, s.z + PLAYER_RADIUS + pad,
    scratchBoxes, scratchRamps, s.y,
  );
}

function moveAndCollide(
  s: MovementState, world: World, dt: number, input: InputCommand, previousCrouch: number,
): void {
  const wasGrounded = s.grounded;
  s.grounded = false;

  const dx = s.vx * dt;
  const dy = s.vy * dt;
  const dz = s.vz * dt;

  // Query once with enough padding to cover the whole sweep for this tick.
  // Pad by the standing height too, so a stand-up test has the ceiling boxes
  // it needs even while the capsule is still short.
  const pad = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) + 0.5;
  queryAround(s, world, pad + (PLAYER_HEIGHT - CROUCH_HEIGHT));

  // Standing up under a ledge must not push the head through it. The stance
  // already moved in stepPlayer, so if the taller capsule is now overlapping,
  // put it back and stay crouched for this tick.
  if (s.crouch < previousCrouch && collidesAt(s)) s.crouch = previousCrouch;

  const startX = s.x;
  const startZ = s.z;
  const startY = s.y;

  // --- horizontal, axis at a time ---
  const blockedX = sweepAxis(s, 0, dx);
  const blockedZ = sweepAxis(s, 2, dz);

  // --- step up: if a horizontal move was blocked while grounded, try again
  //     from STEP_HEIGHT higher and settle back down. Makes piece seams and
  //     ramp bases walkable instead of sticky.
  if ((blockedX || blockedZ) && wasGrounded) {
    const savedX = s.x, savedZ = s.z, savedVx = s.vx, savedVz = s.vz;
    s.x = startX; s.z = startZ; s.y = startY + STEP_HEIGHT;

    if (!collidesAt(s)) {
      sweepAxis(s, 0, dx);
      sweepAxis(s, 2, dz);
      // Settle back onto whatever we stepped onto.
      let drop = 0;
      const maxDrop = STEP_HEIGHT + 0.02;
      while (drop < maxDrop) {
        s.y -= 0.02;
        drop += 0.02;
        if (collidesAt(s)) { s.y += 0.02; break; }
      }
      const gainedGround = Math.hypot(s.x - startX, s.z - startZ) >
                           Math.hypot(savedX - startX, savedZ - startZ) + 1e-4;
      if (gainedGround) {
        s.grounded = true;
      } else {
        s.x = savedX; s.z = savedZ; s.y = startY;
        s.vx = savedVx; s.vz = savedVz;
      }
    } else {
      s.x = savedX; s.z = savedZ; s.y = startY;
    }
  }

  // Hold jump and forward at a reachable ledge to pull up.
  //
  // Airborne counts as well as blocked. Requiring a blocked horizontal move
  // meant you could only climb things wide enough to walk into and stop
  // against -- fine for a wall, useless for a tree, whose trunk is 56 cm
  // across and which you slide straight past. Jumping at a ledge and catching
  // it is also what "almost at the top of the block" should do.
  const reaching = blockedX || blockedZ || !s.grounded;
  if (reaching && input.moveZ > 0 && (input.buttons & BTN_JUMP) !== 0) {
    const ledge = findLedge(s, input);
    if (ledge !== null) {
      s.y = Math.min(ledge.top + 0.02, s.y + MANTLE_SPEED * dt);
      s.vy = 0;
      s.grounded = false;
      if (s.y >= ledge.top) { s.x = ledge.x; s.z = ledge.z; s.grounded = true; }
      // Pulling yourself onto a ledge is not a fall. Re-base the peak so the
      // climb cannot be charged as one on the tick it completes.
      s.fallPeakY = s.y;
      s.lastFallHeight = 0;
      return;
    }
  }

  // --- vertical ---
  const hitVertical = sweepAxis(s, 1, dy);
  if (hitVertical && dy < 0) {
    s.grounded = true;
    s.lastLandingSpeed = Math.abs(s.vy);
    s.vy = 0;
  } else if (hitVertical && dy > 0) {
    s.vy = 0;
  }

  // --- ramps: treat the slope as a floor we snap onto ---
  if (scratchRamps.length > 0) {
    const reach = wasGrounded ? STEP_HEIGHT : 0.05;
    const surface = world.rampSurfaceAt(scratchRamps, s.x, s.z, Math.max(startY, s.y) + reach);
    if (surface > -Infinity && s.y <= surface + reach && Math.max(startY, s.y) >= surface - reach) {
      if (s.vy <= 0.001) {
        if (!s.grounded && s.vy < 0) s.lastLandingSpeed = Math.abs(s.vy);
        s.y = surface;
        s.vy = 0;
        s.grounded = true;
      }
    }
  }

  // --- arena floor ---
  const ground = world.groundAt(s.x,s.z);
  if (s.y <= ground) {
    if (!s.grounded && s.vy < 0) s.lastLandingSpeed = Math.abs(s.vy);
    s.y = ground;
    s.vy = 0;
    s.grounded = true;
  }

  // Grounded players get a small downward bias so they stick to slopes and
  // do not bunny-hop off every seam.
  if (!s.grounded && wasGrounded && s.vy <= 0) {
    const probeY = s.y;
    s.y -= STEP_HEIGHT * 0.5;
    if (collidesAt(s)) {
      s.y = probeY;
      s.grounded = true;
      s.vy = 0;
    } else {
      s.y = probeY;
    }
  }

  // --- fall tracking -------------------------------------------------------
  //
  // One number, written in one place. Every grounding path above converges
  // here, so a ramp snap, a step-up settle and a real drop all report the same
  // thing: how far the player actually fell.
  if (s.grounded) {
    if (!wasGrounded) s.lastFallHeight = Math.max(0, s.fallPeakY - s.y);
    s.fallPeakY = s.y;
  } else if (wasGrounded) {
    s.fallPeakY = startY;
  } else if (s.y > s.fallPeakY) {
    s.fallPeakY = s.y;
  }
}

/**
 * The ledge in front of the player that can actually be climbed onto, or null.
 *
 * The old version took the MINIMUM box top in front of the player -- the
 * lowest surface above the feet -- and tried only that one. Any low box in the
 * way shadowed the real ledge behind it: a ramp's first stair step, the lip of
 * a floor slab, a cone's bottom tier. The single candidate then failed its
 * headroom test (because the thing it belonged to was still in the way) and
 * the whole mantle was abandoned, which is why climbing worked against a bare
 * wall and almost nothing else.
 *
 * Every distinct surface height in front is now collected and tried from the
 * lowest upward, and the first one with room to stand on wins. That is also
 * what makes the back of a ramp climbable: its low steps are all rejected for
 * having the rest of the ramp above them, so the search walks up to the top
 * step, which is clear.
 */
const ledgeHeights: number[] = [];
function findLedge(
  s: MovementState, input: InputCommand,
): { top: number; x: number; z: number } | null {
  const fx = -Math.sin(input.yaw);
  const fz = Math.cos(input.yaw);
  const tx = s.x + fx * MANTLE_FORWARD;
  const tz = s.z + fz * MANTLE_FORWARD;
  const height = playerHeight(s.crouch);

  ledgeHeights.length = 0;
  for (const b of scratchBoxes) {
    if (tx <= b[0] - PLAYER_RADIUS || tx >= b[3] + PLAYER_RADIUS) continue;
    if (tz <= b[2] - PLAYER_RADIUS || tz >= b[5] + PLAYER_RADIUS) continue;
    const surface = b[4];
    if (surface <= s.y + 0.05 || surface - s.y > MANTLE_REACH) continue;
    // Only things the player is actually alongside. A box whose underside is
    // above your head is a ceiling, not a ledge -- without this, standing
    // under a floor and holding jump pulled you straight up through it.
    if (b[1] >= s.y + height || b[4] <= s.y + 0.05) continue;
    if (!ledgeHeights.includes(surface)) ledgeHeights.push(surface);
  }
  if (ledgeHeights.length === 0) return null;
  ledgeHeights.sort((a, b) => a - b);

  for (const top of ledgeHeights) {
    let clear = true;
    for (const b of scratchBoxes) {
      if (overlaps(
        tx - PLAYER_RADIUS, top + 0.02, tz - PLAYER_RADIUS,
        tx + PLAYER_RADIUS, top + height, tz + PLAYER_RADIUS, b,
      )) { clear = false; break; }
    }
    if (clear) return { top, x: tx, z: tz };
  }
  return null;
}

/** Move on one axis and push out of anything hit. Returns true if blocked. */
function sweepAxis(s: MovementState, axis: 0 | 1 | 2, delta: number): boolean {
  if (delta === 0) return false;
  const before = axis === 0 ? s.x : axis === 1 ? s.y : s.z;
  const low=[s.x-PLAYER_RADIUS,s.y,s.z-PLAYER_RADIUS];
  const high=[s.x+PLAYER_RADIUS,s.y+playerHeight(s.crouch),s.z+PLAYER_RADIUS];
  let allowed=delta;
  let blocked = false;
  for (const b of scratchBoxes) {
    // Sweep the entire travelled interval, not just the destination. Thin
    // floors must still catch a fast fall even when a tick crosses them fully.
    const a=(axis+1)%3,c=(axis+2)%3;
    if(high[a]<=b[a]||low[a]>=b[a+3]||high[c]<=b[c]||low[c]>=b[c+3])continue;
    if(delta>0) {
      const gap=b[axis]-high[axis];
      if(gap>=-EPS&&gap<allowed){allowed=Math.max(0,gap-EPS);blocked=true;}
    } else {
      const gap=b[axis+3]-low[axis];
      if(gap<=EPS&&gap>allowed){allowed=Math.min(0,gap+EPS);blocked=true;}
      // Recover a shallow floor penetration upward only. An overlapping
      // ceiling must never launch the player onto its roof.
      if(axis===1&&gap>EPS&&gap<=STEP_HEIGHT&&low[axis]>=b[axis]) {
        allowed=Math.max(allowed,gap+EPS);blocked=true;
      }
    }
  }
  if(axis===0){s.x=before+allowed;if(blocked)s.vx=0;}
  else if(axis===1)s.y=before+allowed;
  else {s.z=before+allowed;if(blocked)s.vz=0;}
  return blocked;
}

function collidesAt(s: MovementState): boolean {
  const minX = s.x - PLAYER_RADIUS, maxX = s.x + PLAYER_RADIUS;
  const minY = s.y,                 maxY = s.y + playerHeight(s.crouch);
  const minZ = s.z - PLAYER_RADIUS, maxZ = s.z + PLAYER_RADIUS;
  for (const b of scratchBoxes) {
    if (overlaps(minX, minY, minZ, maxX, maxY, maxZ, b)) return true;
  }
  return false;
}
