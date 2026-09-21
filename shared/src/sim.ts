import {
  TICK_DT, PLAYER_HEIGHT, PLAYER_RADIUS, GRAVITY, JUMP_VELOCITY, MOVE_SPEED,
  GROUND_ACCEL, AIR_ACCEL, GROUND_FRICTION, MAX_FALL_SPEED, STEP_HEIGHT,
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
  /** Downward speed at the moment of landing, for fall damage. */
  lastLandingSpeed: number;
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

  // --- desired horizontal direction, in world space ---
  const sin = Math.sin(s.yaw);
  const cos = Math.cos(s.yaw);
  let wishX = input.moveX * cos - input.moveZ * sin;
  let wishZ = input.moveX * sin + input.moveZ * cos;
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 1e-6) {
    wishX /= wishLen;
    wishZ /= wishLen;
  }

  const accel = s.grounded ? GROUND_ACCEL : AIR_ACCEL;

  // Friction first, and only on the ground, so air control stays floaty.
  if (s.grounded) {
    const speed = Math.hypot(s.vx, s.vz);
    if (speed > 1e-4) {
      const drop = speed * GROUND_FRICTION * dt;
      const scale = Math.max(0, speed - drop) / speed;
      s.vx *= scale;
      s.vz *= scale;
    }
  }

  if (wishLen > 1e-6) {
    // Quake-style: only accelerate up to the projection deficit, which keeps
    // diagonal movement from exceeding max speed.
    const current = s.vx * wishX + s.vz * wishZ;
    const add = Math.min(MOVE_SPEED - current, accel * dt);
    if (add > 0) {
      s.vx += wishX * add;
      s.vz += wishZ * add;
    }
  }

  if (s.grounded && (input.buttons & BTN_JUMP) !== 0) {
    s.vy = JUMP_VELOCITY;
    s.grounded = false;
  }

  s.vy += GRAVITY * dt;
  if (s.vy < MAX_FALL_SPEED) s.vy = MAX_FALL_SPEED;

  moveAndCollide(s, world, dt);
}

function queryAround(s: MovementState, world: World, pad: number): void {
  world.collidersNear(
    s.x - PLAYER_RADIUS - pad, s.y - pad, s.z - PLAYER_RADIUS - pad,
    s.x + PLAYER_RADIUS + pad, s.y + PLAYER_HEIGHT + pad, s.z + PLAYER_RADIUS + pad,
    scratchBoxes, scratchRamps,
  );
}

function moveAndCollide(s: MovementState, world: World, dt: number): void {
  const wasGrounded = s.grounded;
  s.grounded = false;

  const dx = s.vx * dt;
  const dy = s.vy * dt;
  const dz = s.vz * dt;

  // Query once with enough padding to cover the whole sweep for this tick.
  const pad = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) + 0.5;
  queryAround(s, world, pad);

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
    const surface = world.rampSurfaceAt(scratchRamps, s.x, s.z, s.y + reach + PLAYER_HEIGHT);
    if (surface > -Infinity && s.y <= surface + reach && s.y >= surface - 4.0) {
      if (s.vy <= 0.001) {
        if (!s.grounded && s.vy < 0) s.lastLandingSpeed = Math.abs(s.vy);
        s.y = surface;
        s.vy = 0;
        s.grounded = true;
      }
    }
  }

  // --- arena floor ---
  if (s.y <= world.groundY) {
    if (!s.grounded && s.vy < 0) s.lastLandingSpeed = Math.abs(s.vy);
    s.y = world.groundY;
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
}

/** Move on one axis and push out of anything hit. Returns true if blocked. */
function sweepAxis(s: MovementState, axis: 0 | 1 | 2, delta: number): boolean {
  if (delta === 0) return false;
  if (axis === 0) s.x += delta;
  else if (axis === 1) s.y += delta;
  else s.z += delta;

  let blocked = false;
  // Bounds are recomputed per box: resolving against one collider can push us
  // into another, and grid geometry routinely stacks two at a seam.
  for (const b of scratchBoxes) {
    const minX = s.x - PLAYER_RADIUS, maxX = s.x + PLAYER_RADIUS;
    const minY = s.y,                 maxY = s.y + PLAYER_HEIGHT;
    const minZ = s.z - PLAYER_RADIUS, maxZ = s.z + PLAYER_RADIUS;
    if (!overlaps(minX, minY, minZ, maxX, maxY, maxZ, b)) continue;
    blocked = true;
    if (axis === 0) {
      s.x = delta > 0 ? b[0] - PLAYER_RADIUS - EPS : b[3] + PLAYER_RADIUS + EPS;
      s.vx = 0;
    } else if (axis === 1) {
      // delta > 0 means we rose into the underside of a piece; otherwise we
      // landed on top of one.
      s.y = delta > 0 ? b[1] - PLAYER_HEIGHT - EPS : b[4] + EPS;
    } else {
      s.z = delta > 0 ? b[2] - PLAYER_RADIUS - EPS : b[5] + PLAYER_RADIUS + EPS;
      s.vz = 0;
    }
  }
  return blocked;
}

function collidesAt(s: MovementState): boolean {
  const minX = s.x - PLAYER_RADIUS, maxX = s.x + PLAYER_RADIUS;
  const minY = s.y,                 maxY = s.y + PLAYER_HEIGHT;
  const minZ = s.z - PLAYER_RADIUS, maxZ = s.z + PLAYER_RADIUS;
  for (const b of scratchBoxes) {
    if (overlaps(minX, minY, minZ, maxX, maxY, maxZ, b)) return true;
  }
  return false;
}
