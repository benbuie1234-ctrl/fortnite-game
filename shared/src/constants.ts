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

/**
 * Edge length of one build cell, in metres. Walls are one tile tall.
 *
 * Doubled from 3 m. The player is unchanged, so every structure, building and
 * piece of terrain is now twice the size relative to them: a wall is a real
 * wall rather than a hurdle, and a building has room to have an inside.
 *
 * Changing this used to be impossible because the figure 3 was written out by
 * hand in the map data and the renderer, and several tuned constants assumed a
 * tile they could fit in. Everything that depends on the tile now DERIVES from
 * it (see MANTLE_REACH, MANTLE_SPEED, BUILD_RANGE, RAMP_STEPS in build.ts), so
 * this is a single number again and setting it back to 3.0 restores the old
 * scale exactly.
 *
 * The honest trade: a bigger cell is a coarser cell. Doubling makes the world
 * larger and more imposing, but each cell can hold half as much detail, so
 * fine structure has to come from props and terrain rather than from the grid.
 */
export const TILE = 6.0;
export const PIECE_THICKNESS = 0.4;

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

/** Backpedalling on the ground is slower than advancing. */
export const BACKPEDAL_SPEED_MULT = 0.78;
export const STRAFE_SPEED_MULT = 0.92;
/**
 * Backpedalling in the AIR, as a multiple of base speed.
 *
 * Above 1 on purpose. Walking backwards stays slow, but a backwards jump is a
 * deliberate movement option: it is the quickest way to break off a fight, and
 * it costs you your forward momentum and your aim stability to use. Strafing
 * is what it is -- the point is that retreating should reward the jump rather
 * than a sideways shuffle.
 */
export const BACKPEDAL_AIR_SPEED_MULT = 1.26;
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
 * wall or ramp back is arbitrarily unclimbable. That argument is about the
 * grid, not about metres, so it survives the tile getting bigger -- the reach
 * has to grow with it or half the map stops being navigable.
 */
export const MANTLE_REACH = TILE + 0.15;
/** How far in front of the player a ledge is looked for. Absolute: this is the
 *  player's arm, not the world's grid. */
export const MANTLE_FORWARD = 0.75;
/** Climb speed while pulling up, in m/s. Scaled off the tile so a one-tile
 *  clamber takes the same ~0.6 s however big a tile is. */
export const MANTLE_SPEED = TILE * 1.73;

// --- trees -----------------------------------------------------------------

/**
 * Trees carry a standable platform in the canopy. Height is a fraction of the
 * tree's size, clamped so the lowest branch is always within mantle reach.
 *
 * Raised along with the world scale. At the old limits a perch topped out at
 * 2.8 m, which is below the top of a single wall -- so sitting in a tree put
 * you level with the cover everyone was already standing behind, which is not
 * a vantage point. The ceiling is still comfortably inside MANTLE_REACH, so a
 * tree remains a one-move climb.
 */
export const TREE_PERCH_MIN_HEIGHT = 2.6;
export const TREE_PERCH_MAX_HEIGHT = 5.0;
/** Half-width and thickness of that platform. */
export const TREE_PERCH_RADIUS = 1.5;
export const TREE_PERCH_THICKNESS = 0.35;

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
// Weapon bloom
//
// Spread grows while you move and settles once you stop. An earlier version of
// this was removed because it tripled the cone at its ceiling and dragged the
// crosshair open with it, so every gun felt wildly inaccurate. The numbers here
// are deliberately a fraction of that: a moving player's cone grows by most of
// itself again, not by two more of itself, and the crosshair only tracks part
// of the growth.
//
// The settle is ASYMMETRIC on purpose. Bloom climbs about twice as fast as it
// falls, and because the fall is a constant rate from wherever it got to, the
// moment you stop the cone shrinks noticeably, then keeps tightening for
// another half-second before it reaches its floor -- moving, just stopped, and
// properly set are three distinguishable states rather than two.
// ---------------------------------------------------------------------------

/** Cone growth at full bloom, as a fraction of the weapon's own spread. */
export const BLOOM_SPREAD_HIP = 0.7;
/** The same, while aiming. Aiming should stay the accurate option. */
export const BLOOM_SPREAD_ADS = 0.32;
/** Bloom gained per second at full speed, and shed per second once still. */
export const BLOOM_RISE_RATE = 3.2;
export const BLOOM_FALL_RATE = 1.35;
/** Airborne never counts as steady, however slowly you happen to be drifting. */
export const BLOOM_AIR_FLOOR = 0.85;
/** Crouching is the steady stance, so it earns a real reduction. */
export const BLOOM_CROUCH_MULT = 0.55;
/** Below this planar speed the player counts as stationary. Friction decays
 *  speed exponentially and never reaches zero, so without a floor the cone
 *  would only ever approach its minimum. */
export const BLOOM_STILL_SPEED = 0.2;

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/** Reach for placing a piece. Measured to the target cell's centre, so it has
 *  to clear roughly two and a half cells or legal placements get rejected. */
export const BUILD_RANGE = TILE * 2.8;
/** Lowest layer a player may build on. Negative so the lake basin and any
 *  terrain that dips below y=0 is still buildable; it used to be clamped at 0,
 *  which is why whole areas silently refused every placement. */
export const BUILD_MIN_LAYER = -4;
export const EDIT_RANGE = TILE * 1.6;
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

// ---------------------------------------------------------------------------
// Shield block
//
// One per player per match: a panel that throws bullets back at whoever fired
// them. It is deliberately free (a resource cost would make it a thing you
// save for ever and never use) and deliberately temporary. An indestructible
// mirror you can park in a doorway for the rest of the round is not a tool,
// it is a wall nobody can shoot through, so it expires on its own.
// ---------------------------------------------------------------------------

/** Seconds a placed shield stands before it fades out. */
export const SHIELD_LIFETIME_S = 45;
/** Bullets bounce off it, so this only ever comes off a pickaxe. Two or three
 *  swings, which is what stops it being an answer to a close-range push. */
export const SHIELD_MAX_HP = 55;

export const START_MATS = 500;
export const MAX_MATS = 999;

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

export const MAX_PLAYERS_PER_MATCH = 4;
export const RESPAWN_DELAY_S = 3.0;
export const ROUND_WIN_SCORE = 5;

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
