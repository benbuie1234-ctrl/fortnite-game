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
export const TILE = 3.0;
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

/** Backpedalling is slower than advancing. Without this, jumping backwards was
 *  a free speed boost, because a jump kept whatever speed it left the ground
 *  with and nothing ever capped reverse travel. */
export const BACKPEDAL_SPEED_MULT = 0.78;
export const STRAFE_SPEED_MULT = 0.92;
export const SPRINT_SPEED_MULT = 1.28;

// --- crouch and slide ------------------------------------------------------

/** Standing height is PLAYER_HEIGHT; crouching shrinks the capsule to this. */
export const CROUCH_HEIGHT = 1.15;
export const CROUCH_EYE_HEIGHT = 1.0;
export const CROUCH_SPEED_MULT = 0.52;
/** How fast the capsule grows/shrinks between the two heights, in m/s. */
export const CROUCH_TRANSITION_SPEED = 6.5;

/** Crouching above this speed starts a slide at all. */
export const SLIDE_MIN_SPEED = 3.2;
/** Speed a slide is kicked to from an ordinary run. */
export const SLIDE_BOOST_SPEED = 8.6;
/** Speed a slide is kicked to when it comes out of a sprint. Sprinting into a
 *  slide is the version worth setting up, so it has to travel further. */
export const SLIDE_SPRINT_BOOST_SPEED = 12.4;
/** Friction during a slide. Much lower than walking, which is the whole point. */
export const SLIDE_FRICTION = 1.7;
/** How fast a slide can be steered, in radians per second. Steering only
 *  redirects the momentum you already have; it cannot add any, or holding
 *  forward would balance the friction and the slide would never end. */
export const SLIDE_STEER_RATE = 2.2;
/** A slide ends once it decays below this, or when crouch is released. */
export const SLIDE_END_SPEED = 4.2;
/** Hard cap so a slide down a ramp cannot accelerate forever. */
export const SLIDE_MAX_SPEED = 15.0;
/** Seconds before another slide can be started, so it is not a hop-slide loop. */
export const SLIDE_COOLDOWN = 0.75;

// --- sprint ----------------------------------------------------------------

/** Seconds of continuous sprint available from full. */
export const SPRINT_STAMINA_MAX = 4.2;
/** Seconds of not sprinting before stamina starts coming back. */
export const SPRINT_REGEN_DELAY = 1.1;
/** Seconds of stamina restored per second, once regeneration starts. */
export const SPRINT_REGEN_RATE = 0.85;
/** Below this, sprinting cannot be restarted -- so an empty bar has to recover
 *  a little rather than being tapped back on the instant it leaves zero. */
export const SPRINT_MIN_TO_START = 0.6;

// --- mantling --------------------------------------------------------------

/**
 * How far above the feet a ledge can be and still be climbed.
 *
 * A full tile plus a margin, deliberately: every ledge in this game is built on
 * the same grid, so anything less than a tile means some perfectly ordinary
 * wall or ramp back is arbitrarily unclimbable.
 */
export const MANTLE_REACH = TILE + 0.15;
/** How far in front of the player a ledge is looked for. */
export const MANTLE_FORWARD = 0.75;
/** Climb speed while pulling up, in m/s. */
export const MANTLE_SPEED = 5.2;

// --- trees -----------------------------------------------------------------

/** Trees carry a standable platform in the canopy. Height is a fraction of the
 *  tree's size, clamped so the lowest branch is always within mantle reach. */
export const TREE_PERCH_MIN_HEIGHT = 1.7;
export const TREE_PERCH_MAX_HEIGHT = 2.8;
/** Half-width and thickness of that platform. */
export const TREE_PERCH_RADIUS = 1.15;
export const TREE_PERCH_THICKNESS = 0.3;

// --- fall damage -----------------------------------------------------------
//
// Previously a single linear term off a raw impact speed that several different
// code paths wrote to, which is why it felt random: a ramp snap, a step-up
// settle and a real fall could all report wildly different speeds for the same
// drop. The curve below is quadratic in the height fallen, which is the number
// a player can actually perceive, and it is clamped at both ends so a short
// hop is always free and a long fall is always lethal.

/** Falls shorter than this never hurt. Roughly a two-storey drop. */
export const FALL_SAFE_HEIGHT = 6.0;
/** A fall of this height or more is always lethal. */
export const FALL_LETHAL_HEIGHT = 26.0;
/** Impact speeds below this are landings, not falls, whatever produced them. */
export const FALL_MIN_IMPACT_SPEED = 11.0;

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

export const BUILD_RANGE = 12.0;
/** Lowest layer a player may build on. Negative so the lake basin and any
 *  terrain that dips below y=0 is still buildable; it used to be clamped at 0,
 *  which is why whole areas silently refused every placement. */
export const BUILD_MIN_LAYER = -4;
export const EDIT_RANGE = 8.0;
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

// ---------------------------------------------------------------------------
// Weapon bloom
//
// Spread is not a constant per weapon any more. It grows while you move and
// while you fire, and settles back toward the weapon's floor when you stand
// still. Both sides compute it from the same state so the cone the server
// traces is the cone the crosshair draws.
// ---------------------------------------------------------------------------

/** Bloom added per second at full movement speed. */
export const BLOOM_MOVE_RATE = 2.1;
/** Bloom added by a single shot, as a multiple of the weapon's hip spread. */
export const BLOOM_PER_SHOT = 0.55;
/** Bloom recovered per second while standing still. */
export const BLOOM_RECOVER_RATE = 2.6;
/** Standing perfectly still recovers this much faster again. */
export const BLOOM_STILL_BONUS = 1.9;
/** Ceiling, as a multiple of the weapon's hip spread. */
export const BLOOM_MAX = 2.4;
/** Speed below which the player counts as fully stopped. */
export const BLOOM_STILL_SPEED = 0.35;

// ---------------------------------------------------------------------------
// Bullet drop
// ---------------------------------------------------------------------------

/** Shots travel flat until this far out, then begin to drop. */
export const BULLET_DROP_START = 45.0;
/**
 * Curvature past the flat zone, per metre of flight.
 *
 * Applied as a change in the direction's vertical component per metre, so the
 * DROP it produces grows with the cube of the distance beyond the flat zone:
 * about 7 cm at 100 m, 1.5 m at 200 m and 11 m at 350 m. Small-looking number,
 * large effect at sniper range -- which is the point.
 */
export const BULLET_DROP_RATE = 2.4e-6;
/** Segment length the drop is integrated over. Shared, so client tracers and
 *  server hit traces follow the exact same path. */
export const BULLET_SEGMENT = 6.0;
