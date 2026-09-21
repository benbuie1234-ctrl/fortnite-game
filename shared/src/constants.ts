// Single source of truth for anything the client and server must agree on.
// If a number lives here, prediction and authority stay in sync. If it gets
// duplicated somewhere else, they drift and the game feels broken.

/** Server simulation rate. Inputs are stamped and replayed at this rate. */
export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

/** How often the client flushes queued inputs. 2 input frames per message.
 *  This is the single biggest driver of Cloudflare billing (20 msgs = 1 request),
 *  so it is deliberately half the sim rate. */
export const SEND_HZ = 15;
export const INPUTS_PER_MESSAGE = TICK_HZ / SEND_HZ;

/** How often the server broadcasts a snapshot. */
export const SNAPSHOT_HZ = 15;

/** Remote players render this far in the past so interpolation always has
 *  two snapshots to blend between. ~2 snapshot intervals. */
export const INTERP_DELAY_MS = 133;

/** How far back the server will rewind bodies to validate a shot. */
export const MAX_LAG_COMP_MS = 250;

// ---------------------------------------------------------------------------
// World / grid
// ---------------------------------------------------------------------------

/** Edge length of one build cell, in metres. Walls are one tile tall. */
export const TILE = 6.0;
export const PIECE_THICKNESS = 0.25;

export const GRID_MIN_XZ = -512;
export const GRID_MAX_XZ = 511;
export const GRID_MIN_Y = -8;
export const GRID_MAX_Y = 119;

// ---------------------------------------------------------------------------
// Player physics. Tuned for Fortnite-ish snap, not realism.
// ---------------------------------------------------------------------------

export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.35;
export const EYE_HEIGHT = 1.62;
export const PLAYER_MAX_HP = 100;
export const PLAYER_MAX_SHIELD = 100;

export const GRAVITY = -26.0;
export const JUMP_VELOCITY = 8.5;
export const MOVE_SPEED = 7.0;
export const GROUND_ACCEL = 90.0;
export const AIR_ACCEL = 22.0;
export const GROUND_FRICTION = 11.0;
export const MAX_FALL_SPEED = -60.0;

/** Vertical lip the player walks over without jumping (ramp seams, piece edges). */
export const STEP_HEIGHT = 0.55;

/** Fall damage starts past this impact speed, and scales from there. */
export const FALL_DAMAGE_THRESHOLD = 18.0;
export const FALL_DAMAGE_PER_MPS = 4.0;

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

export const BUILD_RANGE = 24.0;
export const EDIT_RANGE = 16.0;
/** Minimum seconds between placements, so holding the button is not a firehose. */
export const BUILD_COOLDOWN = 0.115;
/** A freshly placed piece starts at this fraction of max HP and grows in. */
export const BUILD_SPAWN_HP_FRACTION = 0.3;

export const MAT_WOOD = 0;
export const MAT_BRICK = 1;
export const MAT_METAL = 2;

export interface MaterialDef {
  readonly id: number;
  readonly name: string;
  readonly maxHp: number;
  /** Seconds for the piece to grow from spawn HP to full HP. */
  readonly buildTime: number;
  readonly cost: number;
  readonly color: number;
}

export const MATERIALS: readonly MaterialDef[] = [
  { id: MAT_WOOD,  name: "Wood",  maxHp: 150, buildTime: 0.6, cost: 10, color: 0xc08a4a },
  { id: MAT_BRICK, name: "Brick", maxHp: 300, buildTime: 1.2, cost: 10, color: 0x9a9a9a },
  { id: MAT_METAL, name: "Metal", maxHp: 500, buildTime: 2.0, cost: 10, color: 0x6f7d8c },
];

export const START_MATS = 500;
export const MAX_MATS = 999;

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

export const MAX_PLAYERS_PER_MATCH = 4;
export const RESPAWN_DELAY_S = 3.0;
export const ROUND_WIN_SCORE = 5;
