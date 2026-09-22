/**
 * The island heightfield.
 *
 * One analytic function, shared by the server's collision, the client's terrain
 * mesh, road tessellation, scenery scattering and every placement decision in
 * the map. If it lives here, the ground you can see and the ground you stand on
 * are the same ground -- that is the whole reason this is a function and not a
 * baked heightmap.
 *
 * The shape is built from four layers:
 *
 *   1. a coastline mask, which turns the square play area into an island with
 *      beaches and puts ocean outside it;
 *   2. rolling countryside, from smooth value noise -- large, readable swells
 *      rather than uniform bumpiness;
 *   3. landmark relief: named plateaus and hills, each with one deliberately
 *      gentle side so every high POI can be walked up without building;
 *   4. water carving: the river canyon, its plunge pool, and the lake basin.
 *
 * Building pads are cut last, by `map.ts`, on top of all of it.
 */

/** Half-width of the playable island, in metres. */
export const MAP_HALF = 240;

/** The ocean surface. Everything below this is underwater. */
export const SEA_LEVEL = -2.4;

/** Where the beach stops and grass starts, in metres. */
export const SHORE_HEIGHT = 1.6;

export const smooth = (t: number): number => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Deterministic value noise
//
// Every client and the server must agree on the ground to the millimetre, so
// nothing here may touch Math.random. Hash -> lattice -> smooth interpolation,
// which is the cheapest thing that produces natural-looking swells.
// ---------------------------------------------------------------------------

function hash2(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise in [-1, 1] on a lattice of `scale` metres. */
function noise(x: number, z: number, scale: number): number {
  const fx = x / scale, fz = z / scale;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = smooth(fx - ix), tz = smooth(fz - iz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (lerp(lerp(a, b, tx), lerp(c, d, tx), tz) - 0.5) * 2;
}

/** Layered noise. Amplitude halves as the features shrink. */
function fbm(x: number, z: number, scale: number, octaves: number): number {
  let sum = 0, amp = 1, norm = 0, s = scale;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x + i * 131.7, z - i * 57.3, s) * amp;
    norm += amp;
    amp *= 0.5;
    s *= 0.5;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// Coastline
// ---------------------------------------------------------------------------

/**
 * 1 well inland, 0 out at sea, with a wobbling coast in between.
 *
 * The island is squarish rather than round: a circular island wastes the
 * corners of a square play area, and the corners are where the quiet
 * exploration pockets live.
 */
export function landMask(x: number, z: number): number {
  const nx = Math.abs(x) / (MAP_HALF - 6);
  const nz = Math.abs(z) / (MAP_HALF - 6);
  // Well inland there is no coastline to work out, and this is on the hot path.
  if (nx < 0.6 && nz < 0.6) return 1;
  // A high exponent keeps the island squarish, so the corners of the play area
  // are dry land and can hold the quiet exploration pockets.
  const d = Math.pow(Math.pow(nx, 5) + Math.pow(nz, 5), 1 / 5);
  // Bays and headlands, so no stretch of coast is a straight line.
  const wobble = fbm(x * 0.7, z * 0.7, 150, 2) * 0.07 + noise(x, z, 46) * 0.018;
  return 1 - smooth((d + wobble - 0.93) / 0.17);
}

// ---------------------------------------------------------------------------
// Landmark relief
// ---------------------------------------------------------------------------

/**
 * A raised landform.
 *
 * `f` is how far the slope takes to fall away; small values make cliffs, large
 * ones make hills. `rampDir` marks one compass bearing whose slope is stretched
 * to `rampF` instead -- the walkable approach. Every high POI has exactly one,
 * which is what makes the map climbable on foot and still leaves the high
 * ground a defensible edge everywhere else.
 */
export interface Mound {
  x: number; z: number;
  /** Flat-top radius. */
  r: number;
  /** Slope width away from the flat top. */
  f: number;
  /** Height of the flat top above the surrounding land. */
  h: number;
  /** Bearing of the gentle side, in radians (atan2(dz, dx)). */
  rampDir?: number;
  /** Slope width along the gentle side. */
  rampF?: number;
  /** Angular half-width of the gentle sector, in radians. */
  rampArc?: number;
  /** Stretches the mound along x/z, for ridges rather than domes. */
  sx?: number;
  sz?: number;
  /** Rotation of the stretch, in radians. */
  rot?: number;
}

/**
 * How far from a mound's centre its influence can possibly reach.
 *
 * Cached per mound so `rawTerrain` can reject the twenty landforms it is not
 * standing on with two subtractions each. That matters: this function is on the
 * hot path of collision, of every terrain vertex, and of every road sample.
 */
export function moundRange(m: Mound): number {
  return (m.r + Math.max(m.f, m.rampF ?? 0)) * Math.max(m.sx ?? 1, m.sz ?? 1);
}

/** 0..1 coverage of this mound at a point: 1 on the flat top, 0 beyond. */
export function moundReach(m: Mound, x: number, z: number): number {
  if (Math.abs(x - m.x) > moundRange(m) || Math.abs(z - m.z) > moundRange(m)) return 0;
  let dx = x - m.x, dz = z - m.z;
  if (m.rot !== undefined) {
    const c = Math.cos(m.rot), s = Math.sin(m.rot);
    const rx = dx * c + dz * s;
    dz = -dx * s + dz * c;
    dx = rx;
  }
  if (m.sx !== undefined) dx /= m.sx;
  if (m.sz !== undefined) dz /= m.sz;
  const dist = Math.hypot(dx, dz);
  let f = m.f;
  if (m.rampDir !== undefined && m.rampF !== undefined) {
    let a = Math.atan2(dz, dx) - m.rampDir;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    const arc = m.rampArc ?? 0.85;
    f = lerp(m.f, m.rampF, 1 - smooth((Math.abs(a) - arc) / 0.8));
  }
  return 1 - smooth((dist - m.r) / f);
}

// ---------------------------------------------------------------------------
// The island's landforms
//
// Bearings: -Z is north, +X is east, so rampDir = Math.PI / 2 is a gentle slope
// on the SOUTH side.
// ---------------------------------------------------------------------------

export const MOUNDS: readonly Mound[] = [
  // THUNDERHEAD PEAK -- the eastern mountain. Cliffs west, over the river;
  // the trail climbs the long south-east shoulder.
  { x: 170, z: 10, r: 24, f: 78, h: 34, sx: 1.15, sz: 1.35, rampDir: 1.05, rampF: 132, rampArc: 1.1 },
  // Its summit cap, the small flat the fire lookout stands on.
  { x: 174, z: 4, r: 13, f: 26, h: 7, rampDir: 1.35, rampF: 46, rampArc: 0.95 },
  // CRESTVIEW HEIGHTS -- the town on the north-east mesa. Steep on the south
  // and west faces you fight up, road-graded from the north.
  { x: 96, z: -140, r: 50, f: 30, h: 21, sx: 1.25, sz: 1.0, rampDir: -1.7, rampF: 86, rampArc: 0.75 },
  // GREENWOOD RISE -- the wooded shoulder above the hollow, south of centre.
  // Its gentle side faces north-west, which is where both the forest track and
  // the river crossing come in from; every other side is a bank.
  { x: -78, z: 132, r: 34, f: 54, h: 13, sx: 1.3, sz: 1.1, rot: 0.5, rampDir: -1.85, rampF: 104, rampArc: 1.05 },
  // MILLSTONE BENCH -- the shelf the central village sits on. Deliberately low:
  // the highway has to get off it and down to the ford in the space between the
  // last house and the riverbank, and a tall bench turns that into a cliff.
  { x: -4, z: -16, r: 42, f: 58, h: 4, sx: 1.2, sz: 1.0 },
  // HAYSEED FLATS -- the broad, near-level farm shelf in the south.
  { x: 78, z: 128, r: 56, f: 64, h: 9, sx: 1.2, sz: 0.95 },
  // FOUNDRY SHELF -- the industrial terrace on the west coast.
  { x: -164, z: -36, r: 38, f: 38, h: 8, sx: 1.05, sz: 1.3, rampDir: 0.3, rampF: 76 },
  // SALTWOOD BLUFF -- the low headland the northern shore town climbs over.
  { x: -116, z: -144, r: 32, f: 50, h: 6, sx: 1.25, sz: 1.0 },
  // CROW'S NEST -- the sharp coastal stack the lighthouse stands on.
  { x: -196, z: -182, r: 10, f: 18, h: 19, rampDir: 0.8, rampF: 36, rampArc: 0.7 },
  // RELAY KNOLL -- the radio mast hill, a mid-map vantage point.
  { x: 154, z: -76, r: 12, f: 32, h: 13, rampDir: 2.4, rampF: 52 },
  // Rolling knolls that break up the sightlines between districts.
  { x: 18, z: -82, r: 15, f: 36, h: 7 },
  { x: -68, z: -74, r: 14, f: 34, h: 6 },
  { x: 40, z: 56, r: 16, f: 38, h: 6 },
  { x: -58, z: 24, r: 13, f: 32, h: 5 },
  { x: 122, z: 76, r: 15, f: 36, h: 7 },
  { x: -182, z: 64, r: 17, f: 40, h: 8 },
  { x: -28, z: 170, r: 20, f: 46, h: 9 },
  { x: 178, z: 172, r: 22, f: 48, h: 11, rampDir: -2.2, rampF: 70 },
  { x: 208, z: -112, r: 16, f: 42, h: 10 },
  { x: -214, z: 152, r: 14, f: 36, h: 7 },
];

/**
 * The landforms again, flattened into typed arrays.
 *
 * Not premature: the authored list above is objects of a dozen different shapes
 * (some have a ramp, some a stretch, some a rotation), and reading a property
 * off twenty differently-shaped objects inside the hottest loop in the game
 * costs an order of magnitude more than the arithmetic does. Flat arrays make
 * the loop monomorphic. The authored list stays the source of truth.
 */
const COUNT = MOUNDS.length;
const M_X = new Float64Array(COUNT), M_Z = new Float64Array(COUNT);
const M_R = new Float64Array(COUNT), M_F = new Float64Array(COUNT), M_H = new Float64Array(COUNT);
const M_RANGE = new Float64Array(COUNT);
const M_SX = new Float64Array(COUNT), M_SZ = new Float64Array(COUNT), M_ROT = new Float64Array(COUNT);
const M_RDIR = new Float64Array(COUNT), M_RF = new Float64Array(COUNT), M_RARC = new Float64Array(COUNT);
const M_FLAGS = new Uint8Array(COUNT); // 1 = ramped, 2 = stretched, 4 = rotated
MOUNDS.forEach((m, i) => {
  M_X[i] = m.x; M_Z[i] = m.z; M_R[i] = m.r; M_F[i] = m.f; M_H[i] = m.h;
  M_RANGE[i] = moundRange(m);
  M_SX[i] = m.sx ?? 1; M_SZ[i] = m.sz ?? 1; M_ROT[i] = m.rot ?? 0;
  M_RDIR[i] = m.rampDir ?? 0; M_RF[i] = m.rampF ?? 0; M_RARC[i] = m.rampArc ?? 0.85;
  M_FLAGS[i] = (m.rampDir !== undefined && m.rampF !== undefined ? 1 : 0)
    | (m.sx !== undefined || m.sz !== undefined ? 2 : 0)
    | (m.rot !== undefined ? 4 : 0);
});

/** Total lift from every landform at a point. Combined by max, so overlapping
 *  landforms merge into one hillside rather than stacking into a spike. */
function relief(x: number, z: number): number {
  let best = 0;
  for (let i = 0; i < COUNT; i++) {
    const range = M_RANGE[i];
    let dx = x - M_X[i];
    if (dx > range || dx < -range) continue;
    let dz = z - M_Z[i];
    if (dz > range || dz < -range) continue;
    const flags = M_FLAGS[i];
    if (flags & 4) {
      const c = Math.cos(M_ROT[i]), sn = Math.sin(M_ROT[i]);
      const rx = dx * c + dz * sn;
      dz = -dx * sn + dz * c;
      dx = rx;
    }
    if (flags & 2) { dx /= M_SX[i]; dz /= M_SZ[i]; }
    const dist = Math.sqrt(dx * dx + dz * dz);
    let f = M_F[i];
    if (flags & 1) {
      let a = Math.atan2(dz, dx) - M_RDIR[i];
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      const w = 1 - smooth((Math.abs(a) - M_RARC[i]) / 0.8);
      f += (M_RF[i] - f) * w;
    }
    const lift = M_H[i] * (1 - smooth((dist - M_R[i]) / f));
    if (lift > best) best = lift;
  }
  return best;
}

// ---------------------------------------------------------------------------
// The river
//
// A single watercourse from the mountain's west face to the lake, so water on
// this island always flows one way and the map has a readable spine. Carving is
// in metres below whatever the land would otherwise be, so the canyon follows
// the terrain rather than flattening it.
// ---------------------------------------------------------------------------

/**
 * Centreline of the river, mountain first.
 *
 * Deliberately sinuous. A straight channel reads as a canal and gives every
 * bridge the same approach; the meanders make river bends that are worth
 * fighting over and put the far bank at a different angle at every crossing.
 */
export const RIVER: readonly [number, number][] = [
  [146, 28], [132, 22], [118, 32], [104, 26], [88, 38],
  [70, 42], [54, 32], [38, 28], [22, 34], [6, 44],
  [-10, 50], [-26, 46], [-42, 52], [-58, 64], [-72, 78],
  [-88, 86], [-102, 98], [-116, 116], [-132, 136], [-148, 158],
];

/** Where the mountain stream drops off the cliff into the valley. */
export const WATERFALL = { x: 146, z: 28, top: 24.0, pool: 5.0 };

// The river is nineteen segments and every terrain sample used to test all of
// them. Bucketing them means a point out on the farm tests none.
const RIVER_CELL = 64;
const RIVER_INDEX = new Map<number, number[]>();
const riverKey = (x: number, z: number): number =>
  (Math.floor(x / RIVER_CELL) + 512) * 4096 + Math.floor(z / RIVER_CELL) + 512;
for (let i = 0; i < RIVER.length - 1; i++) {
  const [x1, z1] = RIVER[i];
  const [x2, z2] = RIVER[i + 1];
  const steps = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 8);
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const px = x1 + (x2 - x1) * t, pz = z1 + (z2 - z1) * t;
    for (let cx = -1; cx <= 1; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        const key = riverKey(px + cx * RIVER_CELL, pz + cz * RIVER_CELL);
        const list = RIVER_INDEX.get(key);
        if (list === undefined) RIVER_INDEX.set(key, [i]);
        else if (!list.includes(i)) list.push(i);
      }
    }
  }
}

/**
 * Distance from a point to the river centreline, and the fraction along it.
 *
 * Returns a large distance for anywhere more than a cell or so from the water,
 * which is all any caller needs: they all ask "am I in or near the river", and
 * the surface height that goes with `t` is only meaningful when the answer is
 * yes.
 */
export function riverDistance(x: number, z: number): { d: number; t: number } {
  const list = RIVER_INDEX.get(riverKey(x, z));
  if (list === undefined) return { d: 1e9, t: 0 };
  let best = 1e9, bestT = 0;
  for (const i of list) {
    const [x1, z1] = RIVER[i];
    const [x2, z2] = RIVER[i + 1];
    const dx = x2 - x1, dz = z2 - z1;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((x - x1) * dx + (z - z1) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ox = x - (x1 + dx * t), oz = z - (z1 + dz * t);
    const d = Math.sqrt(ox * ox + oz * oz);
    if (d < best) { best = d; bestT = (i + t) / (RIVER.length - 1); }
  }
  return { d: best, t: bestT };
}

/** The lake the river empties into, in the south-west. */
export const LAKE = { x: -170, z: 178, rx: 46, rz: 40, surface: 1.0, depth: 3.4 };

/** Normalised distance from the lake centre: under 1 is in the water. */
export function lakeReach(x: number, z: number): number {
  const dx = (x - LAKE.x) / LAKE.rx;
  const dz = (z - LAKE.z) / LAKE.rz;
  return Math.hypot(dx, dz) + noise(x, z, 34) * 0.06;
}

/** Surface height of the river a fraction of the way along it. */
export function riverSurface(t: number): number {
  return lerp(WATERFALL.pool, LAKE.surface, smooth(t * 1.08));
}

/**
 * Half-width of the open water a fraction of the way along the river.
 *
 * Grows downstream, as a river does, and breathes in and out along the way so
 * there are natural fords at the pinches and pools at the swells.
 */
export function riverWidth(t: number): number {
  return lerp(6.5, 13.0, smooth(t)) * (1 + Math.sin(t * 17.0) * 0.16);
}

/**
 * How far below the surface the deepest part of the channel runs.
 *
 * Capped at just over a metre on purpose: there is no swimming in this game, so
 * anything deeper would be a trench players walk along the bottom of, blind.
 * Wadeable water still slows a crossing and still makes a bridge worth taking.
 */
export const RIVER_DEPTH = 1.15;

// ---------------------------------------------------------------------------
// The heightfield
// ---------------------------------------------------------------------------

/**
 * The land before any building pad is cut into it.
 *
 * Kept separate from `terrainHeight` because pad cutting needs to know what the
 * ground would have been, and because scenery placement wants the natural shape
 * rather than the levelled one.
 */
export function rawTerrain(x: number, z: number): number {
  const land = landMask(x, z);

  // --- rolling countryside ------------------------------------------------
  // Two scales only. Long swells carry the shape of the island; the short one
  // stays under half a metre so it reads as texture and never as an obstacle
  // that trips a sprint or bumps a road.
  const swell = fbm(x, z, 190, 2) * 5.8 + fbm(x + 400, z - 250, 76, 2) * 2.4;
  let h = 6.0 + swell + noise(x, z, 17) * 0.32;

  // --- landmark relief ----------------------------------------------------
  // Combined by max so overlapping landforms merge into one hillside instead of
  // stacking into a spike, and so the flat tops stay flat.
  h += relief(x, z);

  // --- coastline ----------------------------------------------------------
  // Beach, then a wadeable shelf. The shelf is shallow all the way to the edge
  // of the play area so walking into the sea is a paddle rather than a drowning;
  // the real drop-off happens outside the boundary, where it is scenery.
  if (land < 1) {
    const beach = SHORE_HEIGHT - 0.8 + noise(x, z, 24) * 0.5;
    const shelf = SEA_LEVEL - 1.1 + noise(x, z, 30) * 0.35;
    h = lerp(shelf, lerp(beach, h, smooth((land - 0.34) / 0.52)), smooth(land / 0.42));
  }

  // --- the river ----------------------------------------------------------
  const river = riverDistance(x, z);
  const width = river.d < 60 ? riverWidth(river.t) : 0;
  if (river.d < width + 14) {
    const surface = riverSurface(river.t);
    // Inner channel cut below the water line, so the river is wadeable at the
    // edges and properly deep in the middle; banks pulled down to meet it.
    const channel = 1 - smooth((river.d - width * 0.4) / (width * 0.6));
    const bank = 1 - smooth((river.d - width) / 14);
    h = lerp(h, Math.min(h, surface + 1.5), bank * 0.85);
    h = lerp(h, surface - lerp(0.35, RIVER_DEPTH, channel), channel);
  }

  // The plunge pool at the foot of the waterfall, scooped out of the cliff.
  const fall = Math.abs(x - WATERFALL.x) > 18 || Math.abs(z - WATERFALL.z) > 18
    ? 99 : Math.hypot(x - WATERFALL.x, z - WATERFALL.z);
  if (fall < 18) h = lerp(h, WATERFALL.pool - 1.5, (1 - smooth((fall - 6) / 12)) * 0.9);

  // --- the lake -----------------------------------------------------------
  // Shallow around the whole shore and only properly deep in the middle, so the
  // edge can be waded and the centre is a place you do not go rather than a
  // pit you fall into.
  const lake = Math.abs(x - LAKE.x) > LAKE.rx * 1.5 || Math.abs(z - LAKE.z) > LAKE.rz * 1.5
    ? 9 : lakeReach(x, z);
  if (lake < 1.4) {
    const shore = 1 - smooth((lake - 0.75) / 0.45);
    const deep = 1 - smooth((lake - 0.15) / 0.5);
    h = lerp(h, LAKE.surface - 1.1, shore);
    h = lerp(h, LAKE.surface - LAKE.depth, deep);
  }

  // --- deep ocean ---------------------------------------------------------
  // Outside the play boundary only: it exists to be looked at, not swum in.
  const outside = Math.max(Math.abs(x), Math.abs(z));
  if (outside > 242) h = lerp(h, SEA_LEVEL - 20, smooth((outside - 242) / 26));

  return h;
}

/** Steepest gradient of a heightfield at a point, as rise over run. */
export function terrainGrade(
  height: (x: number, z: number) => number, x: number, z: number, step = 1.5,
): number {
  const gx = (height(x + step, z) - height(x - step, z)) / (step * 2);
  const gz = (height(x, z + step) - height(x, z - step)) / (step * 2);
  return Math.hypot(gx, gz);
}
