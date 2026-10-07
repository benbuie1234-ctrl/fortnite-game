/**
 * Birds and fish: small moving targets that pay out health when you hit one.
 *
 * Deliberately NOT networked as entities. Every critter's position is a pure
 * function of (index, time), so the server and every client derive the same
 * path from the same clock without a single byte crossing the wire. The only
 * thing that has to be transmitted is the fact that one has been shot, which
 * is a single event, and that keeps a feature with two dozen moving objects
 * off a per-message budget that is deliberately tight (SEND_HZ is half the
 * tick rate for exactly this reason).
 *
 * The cost of that choice is that both sides must evaluate the path at the
 * SAME instant, or the client would draw a bird somewhere the server will not
 * accept a hit on. Both use the lag-compensated render time that remote
 * players already use -- see `critterAt` callers.
 */
import { LAKE_SHAPE, LAKE_SURFACE, terrainHeight } from "./map";

export const CRITTER_BIRD = 0;
export const CRITTER_FISH = 1;

/** Health restored by one hit. A bird is a real heal; a fish is a top-up. */
export const BIRD_HEAL = 15;
export const FISH_HEAL = 5;

/** How long a downed critter stays gone. Long enough that clearing the sky is
 *  worth something, short enough that a long round does not run out. */
export const CRITTER_RESPAWN_S = 42;

/** Half-extent of the box a shot has to pass through, in metres. Generous on
 *  purpose: these are small, they move, and missing a bird by four centimetres
 *  is not an interesting way to lose a heal. */
const BIRD_RADIUS = 0.8;
const FISH_RADIUS = 0.6;

export interface Critter {
  readonly kind: typeof CRITTER_BIRD | typeof CRITTER_FISH;
  /** Centre of the loop, in metres. */
  readonly cx: number;
  readonly cz: number;
  /** Radius of the loop, and how fast it is travelled, in radians/second. */
  readonly r: number;
  readonly rate: number;
  /** Where on the loop it starts. */
  readonly phase: number;
  /** Height above the ground under the loop's centre (birds), or below the
   *  water surface (fish). */
  readonly height: number;
  /** Ground height under the loop centre, resolved once at module load so the
   *  per-frame path costs nothing. */
  readonly base: number;
  readonly radius: number;
}

export const CRITTERS: Critter[] = [];

// A small deterministic generator, so every client lays the flock out
// identically without shipping a table.
let seed = 20260921;
function random(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}

/**
 * Highest ground anywhere under a circular path.
 *
 * Sampling only the centre is not enough: a loop thirty metres across next to
 * a plateau has the centre in the valley and half the circle inside the
 * hillside, so the bird flew through solid ground for part of every lap.
 * Clearance has to be measured against the highest point it passes over.
 */
function highestUnder(cx: number, cz: number, r: number): number {
  let highest = terrainHeight(cx, cz);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    highest = Math.max(highest, terrainHeight(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
  }
  return highest;
}

// --- birds -----------------------------------------------------------------
//
// Spread over the map, circling well above head height but inside the range of
// anything except a pistol.
for (let i = 0; i < 16; i++) {
  const cx = (random() - 0.5) * 380;
  const cz = (random() - 0.5) * 380;
  const r = 14 + random() * 22;
  CRITTERS.push({
    kind: CRITTER_BIRD,
    cx, cz, r,
    rate: 0.16 + random() * 0.2,
    phase: random() * Math.PI * 2,
    height: 16 + random() * 14,
    base: highestUnder(cx, cz, r),
    radius: BIRD_RADIUS,
  });
}

// --- fish ------------------------------------------------------------------
//
// Confined to the lake, cruising just under the surface and breaking it as
// they go round -- see the bob in critterAt. A fish that never surfaces is a
// fish nobody can shoot.
for (let i = 0; i < 12; i++) {
  const angle = random() * Math.PI * 2;
  const spread = 0.35 + random() * 0.3;
  const cx = LAKE_SHAPE.x + Math.cos(angle) * LAKE_SHAPE.rx * spread;
  const cz = LAKE_SHAPE.z + Math.sin(angle) * LAKE_SHAPE.rz * spread;
  CRITTERS.push({
    kind: CRITTER_FISH,
    cx, cz,
    r: 5 + random() * 9,
    rate: 0.3 + random() * 0.35,
    phase: random() * Math.PI * 2,
    height: 0,
    base: LAKE_SURFACE,
    radius: FISH_RADIUS,
  });
}

/** Where a critter is at a given time, in seconds. */
export function critterAt(index: number, t: number): { x: number; y: number; z: number } | null {
  const c = CRITTERS[index];
  if (c === undefined) return null;
  const a = c.phase + t * c.rate;
  const x = c.cx + Math.cos(a) * c.r;
  const z = c.cz + Math.sin(a) * c.r;
  const y = c.kind === CRITTER_BIRD
    // A slow rise and fall around the cruising height, so a bird is never a
    // target that only needs one horizontal lead to solve.
    ? c.base + c.height + Math.sin(a * 2.3) * 2.4
    // Fish porpoise through the surface: mostly under it, clear of it for
    // about a third of each loop.
    : c.base + Math.sin(a * 1.7) * 0.75 - 0.15;
  return { x, y, z };
}

/** Health a hit on this critter is worth. */
export function critterHeal(index: number): number {
  return CRITTERS[index]?.kind === CRITTER_FISH ? FISH_HEAL : BIRD_HEAL;
}

/**
 * Nearest critter a ray segment passes through, or null.
 *
 * `alive` answers whether a given index is still up; the caller owns that,
 * because the server is authoritative over it and the client only mirrors it.
 */
export function critterHit(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number, t: number,
  alive: (index: number) => boolean,
): { index: number; t: number } | null {
  let best: { index: number; t: number } | null = null;
  for (let i = 0; i < CRITTERS.length; i++) {
    if (!alive(i)) continue;
    const p = critterAt(i, t);
    if (p === null) continue;
    const r = CRITTERS[i].radius;
    // Ray against the critter's bounding sphere: cheaper than a box, and for
    // something this small the difference is not perceptible.
    const mx = p.x - ox, my = p.y - oy, mz = p.z - oz;
    const along = mx * dx + my * dy + mz * dz;
    if (along < 0 || along > maxDist) continue;
    const offX = mx - dx * along, offY = my - dy * along, offZ = mz - dz * along;
    if (offX * offX + offY * offY + offZ * offZ > r * r) continue;
    if (best === null || along < best.t) best = { index: i, t: along };
  }
  return best;
}

/**
 * Which critters are currently down.
 *
 * Both sides run this: the server owns the truth and the client mirrors it
 * from EV_CRITTER. Because the respawn delay is a shared constant and the
 * clocks are synchronised, the mirror stays correct without the server ever
 * having to re-send the state -- a client that joins mid-round sees at worst a
 * bird it cannot hit for a few seconds, which self-corrects the moment
 * somebody shoots at it.
 */
export class CritterState {
  private downUntil = new Float64Array(CRITTERS.length);

  alive(index: number, now: number): boolean {
    return index >= 0 && index < CRITTERS.length && now >= this.downUntil[index];
  }

  down(index: number, now: number): void {
    if (index < 0 || index >= CRITTERS.length) return;
    this.downUntil[index] = now + CRITTER_RESPAWN_S;
  }

  reset(): void { this.downUntil.fill(0); }
}
