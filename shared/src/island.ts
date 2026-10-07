/**
 * What is actually ON the island: the districts, every building, the road
 * network, the bridges, the scenery and the cover.
 *
 * This is the level design. `terrain.ts` says what shape the ground is,
 * `blueprint.ts` says how a building is put together, and this file decides
 * where things go and why -- which landmark pulls players across the map, what
 * you can see from the ridge, where the fight happens when two squads land on
 * the same roof.
 *
 * Layout principles, so the next edit keeps them:
 *
 *   - Seven named districts around one central village, each with its own
 *     silhouette (mesa, mountain, harbour, farm, forest, quarry, lake) so you
 *     always know where you are from the skyline alone.
 *   - The river is the island's spine. Crossing it costs you either a detour to
 *     a bridge or a wade in the open, so bridges are worth holding.
 *   - Every high POI has one walkable approach and steep sides everywhere else.
 *   - Roads connect districts, tracks connect landmarks, and nothing important
 *     is further than about eighty metres from cover.
 */
import { TILE } from './constants';
import {
  MAP_HALF, SEA_LEVEL, SHORE_HEIGHT, LAKE,
  rawTerrain, riverDistance, riverSurface, riverWidth, lakeReach, landMask, smooth,
} from './terrain';
import { blueprintFor, type Blueprint, type Building } from './blueprint';

export { MAP_HALF } from './terrain';

/** Cell index a metre coordinate falls in. */
export const cell = (metres: number): number => Math.round(metres / TILE);

// ---------------------------------------------------------------------------
// Palette
//
// Saturated enough to read at two hundred metres, muted enough not to look like
// plastic up close. Every building body colour comes from here.
// ---------------------------------------------------------------------------

const C = {
  cream: 0xe8dcc0, sand: 0xd8c49a, clay: 0xc4795c, rust: 0xa8412f,
  barn: 0xa93226, sage: 0x93a884, moss: 0x6f7f5c, teal: 0x4f8b8b,
  sky: 0x7ba7c4, navy: 0x3c5a72, plum: 0x8a6a86, mustard: 0xd8a63c,
  stone: 0x9a968c, palestone: 0xb6b1a4, concrete: 0x9fa4a2, steel: 0x6d7a80,
  timber: 0x8a6a4a, darkTimber: 0x5d4632, whitewash: 0xf0ead8,
  brickRed: 0xa65d47, slate: 0x4d5a63, olive: 0x7d8a5c, coral: 0xd8836a,
} as const;

const ROOF = {
  shingle: 0x6b4b3c, slate: 0x45525c, tile: 0x9c4f3a, green: 0x4d6b52,
  tin: 0x8e9aa0, tar: 0x3b3f42, thatch: 0xa8894f, copper: 0x5f9c8a,
} as const;

// ---------------------------------------------------------------------------
// Districts
// ---------------------------------------------------------------------------

export interface Location {
  name: string;
  x: number;
  z: number;
  /** Ground height at the centre, for the map and for tests. */
  height: number;
  color: number;
  description: string;
  /** Where the walkable approach starts. A route from here reaches the top. */
  approach: [number, number];
  /** Rough radius, for naming the ground a player is standing on. */
  radius: number;
}

export const LOCATIONS: Location[] = [
  {
    name: 'MILLSTONE CROSSING', x: -4, z: -16, height: 0, color: 0xd8a63c,
    description: 'The village at the ford · mill, market, clock tower',
    approach: [-4, -70], radius: 62,
  },
  {
    name: 'CRESTVIEW HEIGHTS', x: 96, z: -140, height: 0, color: 0x7ba7c4,
    description: 'Town on the mesa · rooftops and stairwells',
    approach: [92, -206], radius: 66,
  },
  {
    name: 'THUNDERHEAD PEAK', x: 174, z: 4, height: 0, color: 0xb6b1a4,
    description: 'The mountain · fire lookout over the whole island',
    approach: [206, 76], radius: 58,
  },
  {
    name: 'SALTWOOD SHORES', x: -116, z: -150, height: 0, color: 0x4f8b8b,
    description: 'Fishing village · pier, boathouse, cannery',
    approach: [-116, -100], radius: 58,
  },
  {
    name: 'HAYSEED FLATS', x: 78, z: 124, height: 0, color: 0xa93226,
    description: 'Farmland · barn, silos, windmill, open fields',
    approach: [30, 96], radius: 62,
  },
  {
    name: 'GREENWOOD HOLLOW', x: -78, z: 132, height: 0, color: 0x4d6b52,
    description: 'Deep forest · ruined chapel and the old graveyard',
    approach: [-68, 70], radius: 58,
  },
  {
    name: 'GRAVELPIT FOUNDRY', x: -164, z: -44, height: 0, color: 0x6d7a80,
    description: 'Quarry and works · warehouses, crane, gravel terraces',
    approach: [-120, -30], radius: 56,
  },
  {
    name: 'MISTY LAKE', x: -170, z: 178, height: 0, color: 0x4f8b8b,
    description: 'Still water · angler pier and the island ruin',
    approach: [-140, 150], radius: 52,
  },
];

/** Smaller named places, for the location readout and for exploration. */
const LANDMARKS: ReadonlyArray<{ name: string; x: number; z: number; r: number }> = [
  { name: 'PUMP & PANTRY', x: -44, z: -74, r: 26 },
  { name: 'RESTWELL MOTEL', x: 46, z: -68, r: 26 },
  { name: 'THE DRIVE-IN', x: 128, z: -48, r: 26 },
  { name: 'RELAY KNOLL', x: 154, z: -76, r: 22 },
  { name: "CROW'S NEST LIGHT", x: -196, z: -182, r: 24 },
  { name: 'MILLSTONE BRIDGE', x: 2, z: 46, r: 20 },
  { name: 'COVERED BRIDGE', x: -64, z: 72, r: 20 },
  { name: 'THUNDER FALLS', x: 146, z: 28, r: 24 },
  { name: 'CAMP KINDLING', x: -112, z: 160, r: 22 },
  { name: 'ANGLERS PIER', x: -180, z: 146, r: 22 },
  { name: 'THE STANDING STONES', x: 196, z: 142, r: 24 },
  { name: 'SUNKEN BARGE', x: 214, z: -158, r: 24 },
  { name: 'BEEKEEPERS ROW', x: 132, z: 112, r: 20 },
  { name: 'HOLLOW OAK', x: -34, z: 176, r: 20 },
  { name: 'THE FORD', x: -124, z: 102, r: 22 },
  { name: 'ORCHARD ROW', x: 30, z: 160, r: 26 },
  { name: 'SALT FLATS', x: -212, z: 96, r: 26 },
  { name: 'THE OVERLOOK', x: 208, z: -112, r: 22 },
];

export function locationAt(x: number, z: number): string {
  for (const l of LANDMARKS) if (Math.hypot(x - l.x, z - l.z) < l.r) return l.name;
  for (const l of LOCATIONS) if (Math.hypot(x - l.x, z - l.z) < l.radius) return l.name;
  const river = riverDistance(x, z);
  if (river.d < riverWidth(river.t) + 6) return 'THE RIVER';
  if (landMask(x, z) < 0.6) return 'THE SHORELINE';
  return 'THE BACKCOUNTRY';
}

// ---------------------------------------------------------------------------
// Ground levelling
//
// Every building stands on a pad cut into the landscape. The pad is what keeps
// a house from floating at one corner and being buried at the other, and the
// blend is wide enough that the cut reads as a graded shelf rather than a step.
// ---------------------------------------------------------------------------

interface Pad { x0: number; z0: number; x1: number; z1: number; h: number; blend: number; }
const PAD_CELL = 48;
const PAD_INDEX = new Map<number, Pad[]>();
/** Numeric cell key. String keys would allocate on every terrain sample, and
 *  terrain sampling is the hottest thing the game does. */
const cellKey = (x: number, z: number): number =>
  (Math.floor(x / PAD_CELL) + 256) * 512 + Math.floor(z / PAD_CELL) + 256;

function indexPad(pad: Pad): void {
  for (let cx = pad.x0 - pad.blend; cx <= pad.x1 + pad.blend + PAD_CELL; cx += PAD_CELL) {
    for (let cz = pad.z0 - pad.blend; cz <= pad.z1 + pad.blend + PAD_CELL; cz += PAD_CELL) {
      const key = cellKey(Math.min(cx, pad.x1 + pad.blend), Math.min(cz, pad.z1 + pad.blend));
      const list = PAD_INDEX.get(key);
      if (list === undefined) PAD_INDEX.set(key, [pad]);
      else if (!list.includes(pad)) list.push(pad);
    }
  }
}

function padAt(x: number, z: number): { h: number; w: number } | null {
  const list = PAD_INDEX.get(cellKey(x, z));
  if (list === undefined) return null;
  let weight = 0, height = 0;
  for (const pad of list) {
    const dx = Math.max(pad.x0 - x, 0, x - pad.x1);
    const dz = Math.max(pad.z0 - z, 0, z - pad.z1);
    const w = 1 - smooth(Math.hypot(dx, dz) / pad.blend);
    if (w > weight) { weight = w; height = pad.h; }
  }
  return weight > 0 ? { h: height, w: weight } : null;
}

/** Buildings bucketed by cell, so scattering does not test all of them. */
const BUILDING_INDEX = new Map<number, Building[]>();
function indexBuildings(): void {
  for (const b of BUILDINGS) {
    for (let x = b.x * TILE - PAD_CELL; x <= (b.x + b.w) * TILE + PAD_CELL; x += PAD_CELL) {
      for (let z = b.z * TILE - PAD_CELL; z <= (b.z + b.d) * TILE + PAD_CELL; z += PAD_CELL) {
        const key = cellKey(x, z);
        const list = BUILDING_INDEX.get(key);
        if (list === undefined) BUILDING_INDEX.set(key, [b]);
        else if (!list.includes(b)) list.push(b);
      }
    }
  }
}

function insideAnyBuilding(x: number, z: number, pad: number): boolean {
  const list = BUILDING_INDEX.get(cellKey(x, z));
  if (list === undefined) return false;
  for (const b of list) {
    if (x > b.x * TILE - pad && x < (b.x + b.w) * TILE + pad &&
      z > b.z * TILE - pad && z < (b.z + b.d) * TILE + pad) return true;
  }
  return false;
}

/**
 * Ground height with the island's earthworks applied.
 *
 * The roadway is graded in first, then building pads are cut on top, so a
 * building always stands exactly on its own level even where a street runs
 * past its door. The two do not fight, because the road's design profile is
 * sampled from the padded ground in the first place -- where a road crosses a
 * town square, its design height IS the square's level.
 */
export function terrainHeight(x: number, z: number): number {
  let h = rawTerrain(x, z);
  const road = roadCutAt(x, z);
  const wr = road === null ? 0 : road.w;
  if (road !== null) h += (road.h - h) * wr;
  const pad = padAt(x, z);
  if (pad === null) return h;
  // A pad owns its own footprint outright, but out in its blend it gives way
  // to a roadway passing beneath. Without that, a cabin eight metres up the
  // bank drags the track below it uphill, and the track is what the grading
  // was for.
  const wp = pad.w;
  return h + (pad.h - h) * wp * (1 - wr * (1 - wp));
}

// ---------------------------------------------------------------------------
// Roads
// ---------------------------------------------------------------------------

export interface Bridge {
  name: string;
  /** Centre of the span. */
  x: number; z: number;
  /** Bearing of the roadway, in radians. */
  yaw: number;
  length: number;
  width: number;
  /** Deck height. */
  y: number;
  style: 'stone' | 'covered' | 'timber' | 'iron';
  /** Where the roadway actually meets each end of the span. */
  ends: [[number, number], [number, number]];
}

/**
 * Every road that meets the river gets one, and each is a different shape, so
 * "which bridge" is something players can say to each other and be understood.
 */
export const BRIDGES: Bridge[] = [];

export interface Road { x1: number; z1: number; x2: number; z2: number; width: number; color: number; kind: 'asphalt' | 'gravel' | 'dirt' | 'cobble'; }

export const ROADS: Road[] = [];

/**
 * A graded stretch of roadway.
 *
 * Roads are cut and filled into the landscape rather than draped over it. Left
 * draped, a highway crossing the skirt of a mountain inherits every bump and
 * every one-in-one pitch underneath it, which looks like a road nobody built
 * and plays like a wall. Grading gives the corridor its own smooth profile and
 * blends the land into it either side, exactly as an earthmover would.
 */
interface RoadCut { x1: number; z1: number; x2: number; z2: number; y1: number; y2: number; half: number; blend: number; bridged: boolean; }
const ROAD_CUTS: RoadCut[] = [];
const ROAD_INDEX = new Map<number, RoadCut[]>();

function indexCut(cut: RoadCut): void {
  ROAD_CUTS.push(cut);
  const reach = cut.half + cut.blend;
  const x0 = Math.min(cut.x1, cut.x2) - reach, x1 = Math.max(cut.x1, cut.x2) + reach;
  const z0 = Math.min(cut.z1, cut.z2) - reach, z1 = Math.max(cut.z1, cut.z2) + reach;
  for (let cx = x0; cx <= x1 + PAD_CELL; cx += PAD_CELL) {
    for (let cz = z0; cz <= z1 + PAD_CELL; cz += PAD_CELL) {
      const key = cellKey(Math.min(cx, x1), Math.min(cz, z1));
      const list = ROAD_INDEX.get(key);
      if (list === undefined) ROAD_INDEX.set(key, [cut]);
      else if (!list.includes(cut)) list.push(cut);
    }
  }
}

/** The roadway height and how strongly it claims the ground at a point. */
function sampleCuts(x: number, z: number, includeBridged: boolean): { h: number; w: number } | null {
  const list = ROAD_INDEX.get(cellKey(x, z));
  if (list === undefined) return null;
  let weight = 0, height = 0;
  for (const c of list) {
    if (c.bridged && !includeBridged) continue;
    const dx = c.x2 - c.x1, dz = c.z2 - c.z1;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - c.x1) * dx + (z - c.z1) * dz) / len2));
    const d = Math.hypot(x - (c.x1 + dx * t), z - (c.z1 + dz * t));
    const w = 1 - smooth((d - c.half) / c.blend);
    if (w > weight) { weight = w; height = c.y1 + (c.y2 - c.y1) * t; }
  }
  return weight > 0 ? { h: height, w: weight } : null;
}

/** The roadway height where the ground is actually cut to it. */
function roadCutAt(x: number, z: number): { h: number; w: number } | null {
  return sampleCuts(x, z, false);
}

/**
 * The roadway height the route was DESIGNED to, including the stretches carried
 * by a bridge. The profile runs straight across the river even though the
 * ground is left alone there, which is what lets a bridge deck sit exactly in
 * line with the road at both ends.
 */
export function roadDeckAt(x: number, z: number): number | null {
  const s = sampleCuts(x, z, true);
  return s === null || s.w < 0.35 ? null : s.h;
}

/**
 * Lay a route: resample it, grade the profile, and record both the drawable
 * segments and the earthworks.
 */
interface Laid { fine: Array<[number, number]>; y: number[]; width: number; }

/**
 * A route as authored, before any earthworks.
 *
 * Roads are laid TWICE. The first pass grades them against the bare land, and
 * that profile is what tells each building beside a road what level to stand
 * at. The second pass re-grades them once the buildings exist, this time
 * holding the road to the level of every pad it runs across. One pass cannot do
 * both: a building needs the road's height to choose its own, and the road
 * needs the building's height to avoid arriving at a wall.
 */
interface Route {
  points: ReadonlyArray<[number, number]>;
  width: number;
  kind: Road['kind'];
  bridge?: { name: string; style: Bridge['style']; width?: number };
}
const ROUTES: Route[] = [];

/** Author a route. Laying it out happens later, in two passes. */
function route(points: ReadonlyArray<[number, number]>, width: number, kind: Road['kind']): Route {
  const r: Route = { points, width, kind };
  ROUTES.push(r);
  return r;
}

/** Mark that a route's river crossing carries a bridge. */
function bridgeOn(r: Route, name: string, style: Bridge['style'], width?: number): void {
  r.bridge = { name, style, width };
}

function lay(r: Route, settled: boolean): Laid {
  const { points, width, kind } = r;

  // Resample every ten metres, so the design profile can follow a long hill
  // without following every hummock on it.
  const fine: Array<[number, number]> = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, z1] = points[i], [x2, z2] = points[i + 1];
    const steps = Math.max(1, Math.round(Math.hypot(x2 - x1, z2 - z1) / 10));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      fine.push([x1 + (x2 - x1) * t, z1 + (z2 - z1) * t]);
    }
  }
  fine.push(points[points.length - 1]);

  // Where the route runs over a building platform, the platform's level IS the
  // design height -- otherwise the road is graded to one height, the pad cuts
  // it to another, and there is a step across the road where they meet.
  // Two things this route has to agree with and cannot move: a road already
  // laid where they meet, and the level of any building platform it runs
  // across. Both are pinned; everything between them is free to be graded.
  // 0 = free to be graded, 1 = held firmly (a level crossing), and in between
  // a spring: junctions and platforms pull hard but can give a little. A hard
  // pin that the land cannot reach produces a cliff at the junction instead of
  // a slightly-off kerb, and a cliff is the worse failure by far.
  const pinned: number[] = [];
  const y = fine.map(([x, z]) => {
    const existing = roadCutAt(x, z);
    if (existing !== null && existing.w > 0.6) { pinned.push(0.8); return existing.h; }
    // Only where the platform properly owns the ground. Pinning out in its
    // blend would leave the road no room to ramp up to it.
    const pad = settled ? padAt(x, z) : null;
    if (pad !== null && pad.w > 0.85) { pinned.push(0.8); return pad.h; }
    pinned.push(0);
    return rawTerrain(x, z);
  });
  // Smooth, then limit the gradient. Relaxation rather than a single pass: a
  // steep pitch has to be paid for by raising the ground before it and lowering
  // the ground after it, and that cost has to propagate along the route.
  // A building stands on a six-metre build level and a road does not, so a road
  // arriving at one has up to three metres to make up in the width of the
  // platform's blend. These limits are what makes that always possible; they
  // are steeper than a real highway and still comfortably walkable.
  const maxGrade = kind === 'asphalt' ? 0.30 : kind === 'cobble' ? 0.30 : 0.42;
  const held = y.slice();
  const restore = (): void => {
    for (let i = 0; i < y.length; i++) if (pinned[i] > 0) y[i] += (held[i] - y[i]) * pinned[i];
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < y.length - 1; i++) y[i] = (y[i - 1] + y[i] * 2 + y[i + 1]) / 4;
    restore();
  }
  relax();

  // A crossing is level. Flatten the profile over the water and for a few
  // metres either side, so the bridge deck is one height and the approaches
  // ramp down to meet it instead of the deck meeting a hillside halfway up.
  // Measured ALONG the route, not as the crow flies: a track crossing at an
  // angle is much further along its own length than it is from the water, and
  // the level stretch has to reach as far as the bridge deck does.
  const overWater = fine.map(([x, z]) => {
    const r = riverDistance(x, z);
    return r.d < riverWidth(r.t) + 1;
  });
  const level = overWater.slice();
  for (let i = 0; i < fine.length; i++) {
    if (!overWater[i]) continue;
    for (const step of [-1, 1]) {
      let j = i, travelled = 0;
      while (travelled < 17) {
        const k = j + step;
        if (k < 0 || k >= fine.length) break;
        travelled += Math.hypot(fine[k][0] - fine[j][0], fine[k][1] - fine[j][1]);
        level[k] = true;
        j = k;
      }
    }
  }
  for (let i = 0; i < y.length; i++) {
    if (!level[i]) continue;
    let j = i;
    while (j + 1 < y.length && level[j + 1]) j++;
    let sum = 0;
    for (let k = i; k <= j; k++) sum += y[k];
    const deck = sum / (j - i + 1);
    for (let k = i; k <= j; k++) { y[k] = deck; pinned[k] = 1; held[k] = deck; }
    i = j;
  }
  relax();

  function relax(): void {
  for (let pass = 0; pass < 600; pass++) {
    let moved = false;
    for (let i = 0; i < y.length - 1; i++) {
      const len = Math.hypot(fine[i + 1][0] - fine[i][0], fine[i + 1][1] - fine[i][1]) || 1;
      const limit = maxGrade * len;
      const d = y[i + 1] - y[i];
      if (Math.abs(d) <= limit) continue;
      const fix = (Math.abs(d) - limit) / 2 * Math.sign(d);
      y[i] += fix; y[i + 1] -= fix;
      moved = true;
    }
    restore();
    if (!moved) break;
  }
  }

  const half = width / 2;
  for (let i = 0; i < fine.length - 1; i++) {
    // A road never grades the riverbed: the bridge spans that, and filling the
    // channel would dam the river. Only the channel itself is left alone -- the
    // deck always reaches further than this, so its ends rest on graded ground.
    const mx = (fine[i][0] + fine[i + 1][0]) / 2, mz = (fine[i][1] + fine[i + 1][1]) / 2;
    const river = riverDistance(mx, mz);
    indexCut({
      x1: fine[i][0], z1: fine[i][1], x2: fine[i + 1][0], z2: fine[i + 1][1],
      y1: y[i], y2: y[i + 1], half, blend: half + 7,
      bridged: river.d < riverWidth(river.t) + 2,
    });
  }
  return { fine, y, width };
}

/** Grade every authored route, and record the drawable segments once. */
function layAll(settled: boolean): void {
  ROAD_CUTS.length = 0;
  ROAD_INDEX.clear();
  if (settled) { ROADS.length = 0; BRIDGES.length = 0; }
  for (const r of ROUTES) {
    const laid = lay(r, settled);
    if (!settled) continue;
    const color = r.kind === 'asphalt' ? 0x4f5358 : r.kind === 'cobble' ? 0x8d8577 : r.kind === 'gravel' ? 0x9a9384 : 0x8a7358;
    for (let i = 0; i < r.points.length - 1; i++) {
      ROADS.push({
        x1: r.points[i][0], z1: r.points[i][1], x2: r.points[i + 1][0], z2: r.points[i + 1][1],
        width: r.width, color, kind: r.kind,
      });
    }
    if (r.bridge) addBridge(laid, r.bridge.name, r.bridge.style, r.bridge.width);
  }
}

/**
 * Put a bridge where a route crosses the river.
 *
 * Worked out from the route rather than placed by hand, so the deck lands at
 * the height the road was graded to and the span is long enough to reach dry
 * bank at both ends. A bridge positioned by eye is a bridge with a step at one
 * end of it, and the only way to find that is to walk there.
 */
function addBridge(laid: Laid, name: string, style: Bridge['style'], width?: number): void {
  let best = -1, bestD = Infinity;
  laid.fine.forEach(([x, z], i) => {
    const d = riverDistance(x, z).d;
    if (d < bestD) { bestD = d; best = i; }
  });
  if (best < 0 || bestD > 24) return;
  const [x, z] = laid.fine[best];
  const r = riverDistance(x, z);
  const y = Math.max(riverSurface(r.t) + 2.2, laid.y[best]);
  // The span reaches to where the roadway stops being level, which is where the
  // approach ramps begin. That is the whole trick to a bridge that meets its
  // own road: the road is graded flat across the crossing first, and the deck
  // is simply the flat part of it.
  const reach = riverWidth(r.t) + 8;
  // Follow the route out to each end rather than striking off in a straight
  // line: a track crossing on a bend leaves the road entirely within ten metres
  // of the span, and then the "bridge" lands in a field.
  const walk = (step: number): [number, number] => {
    let i = best, travelled = 0;
    for (;;) {
      const j = i + step;
      if (j < 0 || j >= laid.fine.length) return laid.fine[i];
      const span = Math.hypot(laid.fine[j][0] - laid.fine[i][0], laid.fine[j][1] - laid.fine[i][1]);
      if (travelled + span >= reach) {
        // Land exactly at the reach rather than at the next vertex: the
        // resampling is ten metres apart, and rounding up to it would put the
        // end of the span halfway up the approach ramp.
        const t = (reach - travelled) / (span || 1);
        return [
          laid.fine[i][0] + (laid.fine[j][0] - laid.fine[i][0]) * t,
          laid.fine[i][1] + (laid.fine[j][1] - laid.fine[i][1]) * t,
        ];
      }
      travelled += span;
      i = j;
    }
  };
  const ends: [[number, number], [number, number]] = [walk(-1), walk(1)];
  const yaw = Math.atan2(ends[1][0] - ends[0][0], ends[1][1] - ends[0][1]);
  const length = Math.hypot(ends[1][0] - ends[0][0], ends[1][1] - ends[0][1]);
  BRIDGES.push({ name, x: (ends[0][0] + ends[1][0]) / 2, z: (ends[0][1] + ends[1][1]) / 2, yaw, length, width: width ?? laid.width, y, style, ends });
}

// The two highways. They cross at the village, which is why the village is
// where it is.
bridgeOn(route([[24, -212], [20, -172], [14, -132], [6, -84], [-2, -38], [-2, 0], [0, 26], [2, 46], [8, 72], [20, 98], [34, 126], [48, 170], [54, 208]], 11, 'asphalt'), 'Millstone Bridge', 'stone');
// It stops at the foot of the falls: the mountain's west face is a cliff, and
// the way up is the long south-eastern shoulder instead.
route([[-216, -30], [-182, -36], [-142, -28], [-102, -24], [-62, -22], [-26, -18], [2, -12], [42, -6], [84, 2], [120, 6], [148, 12]], 11, 'asphalt');
// North coast road, out to the lighthouse headland and round to Crestview.
route([[-178, -166], [-152, -168], [-122, -158], [-96, -150], [-66, -152], [-36, -162], [-4, -174], [32, -180], [64, -188], [90, -192]], 9, 'asphalt');
// No road up to the lighthouse: the stack is nineteen metres of rock and the
// one side that is not a cliff is a scramble, which is the point of it.
// The climb onto the mesa, which is the only road up.
route([[90, -192], [96, -180], [96, -160], [96, -146]], 9, 'asphalt');
// Crestview streets.
route([[62, -142], [132, -142]], 8, 'asphalt');
route([[96, -172], [96, -116]], 8, 'asphalt');
// Millstone village streets.
route([[-44, -16], [34, -16]], 7, 'cobble');
route([[-4, -44], [-4, 14]], 7, 'cobble');
// The farm road, east across the river plain and out to the orchard.
route([[20, 98], [48, 112], [78, 124], [112, 140], [142, 168]], 7, 'dirt');
// Forest track through the covered bridge and out to the bluff above the lake.
// It stops at the top: the last twenty metres down to the water is an
// escarpment, and a track pretending to descend it would be a lie.
bridgeOn(route([[-62, -22], [-70, 10], [-72, 40], [-66, 58], [-64, 72], [-70, 96], [-78, 130], [-98, 152], [-114, 164]], 6, 'dirt'), 'Covered Bridge', 'covered', 7.5);
// The river footpath: the east highway down to the farm, over the old timber
// crossing. It is the only quick way between the east side and the fields.
bridgeOn(route([[84, 2], [74, 20], [64, 38], [56, 62], [50, 86], [48, 112]], 5, 'dirt'), 'Anglers Footbridge', 'timber', 3.4);
// The west link: the foundry down to the hollow, over the old iron span.
// The foundry track south, stopping where the river plain begins. It does NOT
// cross: from here south the river is thirty metres of shallows with the
// Greenwood escarpment standing straight up behind it, and there is nowhere on
// that bank a road could honestly land. Getting across here is a wade, which
// is the point -- the west bank is the quiet side of the island.
route([[-150, -16], [-140, 20], [-132, 56], [-126, 84], [-124, 100]], 6, 'dirt');
// Quarry haul road.
route([[-182, -36], [-188, -62], [-178, -88], [-160, -104]], 8, 'gravel');
// Saltwood quay lane.
route([[-148, -168], [-152, -136], [-134, -122], [-104, -128]], 7, 'cobble');
// The long way up Thunderhead: the farm road carries on round the south-east
// shoulder, which is the only side of the mountain a road can climb.
route([[142, 168], [176, 150], [200, 112], [210, 72], [206, 40], [192, 16], [180, 6]], 5, 'dirt');
// Lakeshore lane, down the western shore from the salt flats to the pier.
route([[-208, 98], [-202, 126], [-186, 138], [-166, 132]], 5, 'dirt');
// Hayseed farmyard lane.
route([[56, 120], [78, 108], [102, 112]], 6, 'dirt');
// Spur to the drive-in and the relay knoll.
route([[120, 6], [128, -24], [130, -50], [146, -68], [154, -78]], 6, 'gravel');
// Spur to the gas station and motel.
route([[-26, -18], [-40, -52], [-46, -76]], 7, 'asphalt');
route([[6, -84], [30, -80], [48, -72]], 7, 'asphalt');

// First pass: grade every route against the bare land. This is the profile the
// buildings beside a road read their own level from.
layAll(false);

/**
 * Is this point on (or within `pad` of) a roadway?
 *
 * Answered from the corridor index rather than by testing every road segment:
 * this is called once per scattered tree and once per tuft of grass, tens of
 * thousands of times at load, and a linear scan over eighty segments made it
 * the single most expensive thing the map did.
 */
export function onRoad(x: number, z: number, pad: number): boolean {
  const list = ROAD_INDEX.get(cellKey(x, z));
  if (list === undefined) return false;
  for (const c of list) {
    const dx = c.x2 - c.x1, dz = c.z2 - c.z1, len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - c.x1) * dx + (z - c.z1) * dz) / len2));
    const ox = x - (c.x1 + dx * t), oz = z - (c.z1 + dz * t);
    if (ox * ox + oz * oz < (c.half + pad) * (c.half + pad)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Bridges
//
// Every road that meets the river gets one, and each is a different shape, so
// "which bridge" is a thing players can actually say to each other.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export const BUILDINGS: Building[] = [];

type Spec = Omit<Building, 'x' | 'z' | 'w' | 'd' | 'base'> & { base?: number };

/**
 * A district platform: one piece of level ground that a whole cluster of
 * buildings shares.
 *
 * Without this, each building rounds its own ground to the nearest build level
 * independently, and two neighbours whose ground differs by a few centimetres
 * can round to levels six metres apart -- which puts a cliff down the middle of
 * a town square. Everything standing on a platform is forced onto its level.
 */
interface Platform {
  name: string;
  x: number; z: number;
  hw: number; hd: number;
  /** How far the cut grades out into the surrounding land. */
  blend: number;
  /** Filled in once the buildings on it are known. */
  level: number;
  members: Building[];
}

const PLATFORMS: Platform[] = ([
  ['Crestview plaza', 96, -144, 34, 32, 14],
  ['Millstone square', -4, -14, 30, 26, 14],
  ['Foundry yard', -164, -50, 28, 28, 14],
  ['Hayseed farmyard', 74, 124, 30, 26, 16],
  ['Saltwood quay', -134, -150, 28, 28, 14],
  ['Motel forecourt', 51, -72, 20, 12, 10],
] as const).map(([name, x, z, hw, hd, blend]) => ({ name, x, z, hw, hd, blend, level: 0, members: [] }));

function platformAt(x: number, z: number): Platform | undefined {
  return PLATFORMS.find(p => Math.abs(x - p.x) <= p.hw && Math.abs(z - p.z) <= p.hd);
}

/** Place a building by the world position of its centre. */
function put(cx: number, cz: number, w: number, d: number, spec: Spec): Building {
  const x = Math.round(cx / TILE - w / 2);
  const z = Math.round(cz / TILE - d / 2);
  const mx = (x + w / 2) * TILE, mz = (z + d / 2) * TILE;
  // Sample the corners too: a pad that only matches the middle leaves one
  // corner of a building buried in a slope.
  let sum = 0;
  const probes: Array<[number, number]> = [
    [mx, mz], [x * TILE, z * TILE], [(x + w) * TILE, z * TILE],
    [x * TILE, (z + d) * TILE], [(x + w) * TILE, (z + d) * TILE],
  ];
  for (const [px, pz] of probes) sum += rawTerrain(px, pz);
  // A building beside a road stands at the road's level, not the level of the
  // land the road was cut through. Otherwise the forecourt of a garage sits
  // four metres below the forecourt, which is a wall where the door should be.
  const deck = roadDeckAt(mx, mz);
  const ground = deck ?? sum / probes.length;
  const base = spec.base ?? Math.round(ground / TILE);
  const b: Building = { ...spec, x, z, w, d, base };
  BUILDINGS.push(b);
  platformAt(mx, mz)?.members.push(b);
  return b;
}

// --- MILLSTONE CROSSING ----------------------------------------------------
// The crossroads village everyone walks through. Low, dense, and built around
// a square, so the fights here are short-range and full of doorways.
put(-6, -36, 3, 3, {
  name: 'Millstone Town Hall', archetype: 'apartment', style: 'city', floors: 3,
  roof: 'flat', surface: 'stone', color: C.palestone, trim: C.whitewash,
  roofColor: ROOF.tar, door: 1, sign: 'TOWN HALL',
});
put(-42, -30, 3, 3, {
  name: 'Millstone General', archetype: 'shop', style: 'city', floors: 2,
  roof: 'gable', surface: 'siding', color: C.mustard, trim: C.whitewash,
  roofColor: ROOF.shingle, door: 1, storefront: true, attic: true, sign: 'GENERAL STORE',
});
put(30, -28, 3, 3, {
  name: 'The Grindstone Inn', archetype: 'townhouse', style: 'city', floors: 2,
  roof: 'gable', surface: 'plaster', color: C.cream, trim: C.darkTimber,
  roofColor: ROOF.tile, door: 2, balcony: true, attic: true, sign: 'THE GRINDSTONE',
});
put(-34, 10, 2, 3, {
  name: 'Crossing Post Office', archetype: 'shop', style: 'city', floors: 2,
  roof: 'hip', surface: 'brick', color: C.brickRed, trim: C.whitewash,
  roofColor: ROOF.slate, door: 0, storefront: true, sign: 'POST OFFICE',
});
put(20, 8, 3, 3, {
  name: 'Ford Street Row', archetype: 'townhouse', style: 'city', floors: 3,
  roof: 'gable', surface: 'siding', color: C.sky, trim: C.whitewash,
  roofColor: ROOF.slate, door: 2, attic: true,
});
put(-16, 2, 3, 2, {
  name: 'Millstone Cottage', archetype: 'cottage', style: 'house', floors: 2,
  roof: 'hip', surface: 'siding', color: C.sage, trim: C.whitewash,
  roofColor: ROOF.shingle, door: 0,
});
put(56, -6, 2, 2, {
  name: 'Crossing Garage', archetype: 'depot', style: 'warehouse', floors: 1,
  roof: 'shed', surface: 'metal', color: C.steel, trim: C.mustard,
  roofColor: ROOF.tin, door: 0,
});
// The mill itself, down on the riverbank below the village.
put(18, 38, 3, 3, {
  name: 'The Old Watermill', archetype: 'mill', style: 'warehouse', floors: 2,
  roof: 'gable', surface: 'stone', color: C.stone, trim: C.darkTimber,
  roofColor: ROOF.shingle, door: 0, attic: true, sign: 'MILLSTONE MILL',
});

// --- CRESTVIEW HEIGHTS -----------------------------------------------------
// The one genuinely vertical district: flat roofs, parapets, stairwells that
// run all the way up, and a plaza in the middle to funnel people together.
put(68, -164, 3, 3, {
  name: 'Crestview Apartments A', archetype: 'apartment', style: 'city', floors: 4,
  roof: 'flat', surface: 'plaster', color: C.coral, trim: C.whitewash,
  roofColor: ROOF.tar, door: 1,
});
put(120, -166, 3, 3, {
  name: 'Crestview Apartments B', archetype: 'apartment', style: 'city', floors: 3,
  roof: 'flat', surface: 'brick', color: C.brickRed, trim: C.cream,
  roofColor: ROOF.tar, door: 1,
});
put(66, -120, 3, 4, {
  name: 'Heights Office Block', archetype: 'apartment', style: 'city', floors: 3,
  roof: 'flat', surface: 'concrete', color: C.concrete, trim: C.whitewash,
  roofColor: ROOF.tar, door: 3, sign: 'HEIGHTS CHAMBERS',
});
put(112, -122, 4, 2, {
  name: 'Mesa Street Shops', archetype: 'shop', style: 'city', floors: 2,
  roof: 'flat', surface: 'plaster', color: C.teal, trim: C.whitewash,
  roofColor: ROOF.tar, door: 0, storefront: true, sign: 'MESA STREET',
});
put(140, -136, 2, 3, {
  name: 'Crestview Deli', archetype: 'shop', style: 'city', floors: 2,
  roof: 'flat', surface: 'siding', color: C.plum, trim: C.whitewash,
  roofColor: ROOF.tar, door: 2, storefront: true, sign: 'DELI',
});
put(96, -186, 3, 2, {
  name: 'North Gate Depot', archetype: 'depot', style: 'warehouse', floors: 1,
  roof: 'shed', surface: 'metal', color: C.steel, trim: C.mustard,
  roofColor: ROOF.tin, door: 1,
});

// --- SALTWOOD SHORES -------------------------------------------------------
// Working harbour. Long low sheds against the water, cottages stepping up the
// bluff behind them, and a pier that is the only reason to be out in the open.
put(-146, -166, 4, 3, {
  name: 'Saltwood Cannery', archetype: 'warehouse', style: 'warehouse', floors: 2,
  roof: 'shed', surface: 'metal', color: C.teal, trim: C.cream,
  roofColor: ROOF.tin, door: 3, mezzanine: true, sign: 'SALTWOOD CANNERY',
});
put(-160, -128, 3, 2, {
  name: 'The Boathouse', archetype: 'warehouse', style: 'warehouse', floors: 1,
  roof: 'gable', surface: 'siding', color: C.navy, trim: C.whitewash,
  roofColor: ROOF.shingle, door: 3,
});
put(-102, -174, 3, 3, {
  name: 'Harbourmaster Cottage', archetype: 'cottage', style: 'house', floors: 2,
  roof: 'gable', surface: 'siding', color: C.whitewash, trim: C.navy,
  roofColor: ROOF.slate, door: 1, attic: true,
});
put(-92, -136, 2, 2, {
  name: 'Netmakers House', archetype: 'cottage', style: 'house', floors: 1,
  roof: 'gable', surface: 'siding', color: C.coral, trim: C.whitewash,
  roofColor: ROOF.shingle, door: 0,
});
put(-128, -118, 3, 3, {
  name: 'Shoreline Tavern', archetype: 'townhouse', style: 'house', floors: 2,
  roof: 'gable', surface: 'plaster', color: C.sand, trim: C.darkTimber,
  roofColor: ROOF.shingle, door: 1, attic: true, sign: 'THE SALTED OAR',
});
put(-196, -182, 2, 3, {
  name: "Crow's Nest Light", archetype: 'lighthouse', style: 'city', floors: 3,
  roof: 'flat', surface: 'plaster', color: C.whitewash, trim: C.rust,
  roofColor: ROOF.tar, door: 3,
});

// --- HAYSEED FLATS ---------------------------------------------------------
// Big readable volumes on open ground. The barn is the landmark you can see
// from the mountain; the fields around it are the most exposed ground on the
// island, which is what makes the fence lines and hay bales matter.
put(56, 112, 4, 3, {
  name: 'Hayseed Barn', archetype: 'barn', style: 'warehouse', floors: 2,
  roof: 'gambrel', surface: 'siding', color: C.barn, trim: C.whitewash,
  roofColor: ROOF.tin, door: 0, attic: true, sign: 'HAYSEED FARM',
});
put(100, 104, 3, 3, {
  name: 'Hayseed Farmhouse', archetype: 'farmhouse', style: 'house', floors: 2,
  roof: 'gable', surface: 'siding', color: C.whitewash, trim: C.moss,
  roofColor: ROOF.shingle, door: 2, attic: true, balcony: true,
});
put(48, 148, 3, 2, {
  name: 'Tractor Shed', archetype: 'warehouse', style: 'warehouse', floors: 1,
  roof: 'shed', surface: 'metal', color: C.moss, trim: C.mustard,
  roofColor: ROOF.tin, door: 1,
});
put(92, 146, 2, 2, {
  name: 'Feed Store', archetype: 'shop', style: 'house', floors: 1,
  roof: 'gable', surface: 'siding', color: C.mustard, trim: C.whitewash,
  roofColor: ROOF.shingle, door: 1, sign: 'FEED & SEED',
});
put(132, 118, 2, 2, {
  name: 'Beekeepers Hut', archetype: 'cabin', style: 'cabin', floors: 1,
  roof: 'gable', surface: 'log', color: C.timber, trim: C.cream,
  roofColor: ROOF.thatch, door: 2,
});

// --- GREENWOOD HOLLOW ------------------------------------------------------
// Canopy, cabins and a roofless chapel. Sightlines here are five metres long,
// so it plays completely differently from the farm next door.
put(-96, 152, 3, 4, {
  name: 'Greenwood Chapel', archetype: 'chapel', style: 'city', floors: 1,
  roof: 'gable', surface: 'stone', color: C.stone, trim: C.palestone,
  roofColor: ROOF.slate, door: 0, roofless: true,
});
put(-58, 118, 2, 2, {
  name: 'Woodcutters Cabin', archetype: 'cabin', style: 'cabin', floors: 1,
  roof: 'gable', surface: 'log', color: C.timber, trim: C.darkTimber,
  roofColor: ROOF.shingle, door: 0,
});
put(-120, 122, 3, 3, {
  name: 'Hollow Lodge', archetype: 'cabin', style: 'cabin', floors: 2,
  roof: 'gable', surface: 'log', color: C.darkTimber, trim: C.cream,
  roofColor: ROOF.green, door: 1, attic: true,
});
put(-46, 162, 2, 2, {
  name: 'Hermits Shack', archetype: 'cabin', style: 'cabin', floors: 1,
  roof: 'shed', surface: 'log', color: C.moss, trim: C.timber,
  roofColor: ROOF.thatch, door: 3,
});
put(-136, 148, 2, 3, {
  name: 'Lakeside Cabin', archetype: 'cabin', style: 'cabin', floors: 2,
  roof: 'gable', surface: 'log', color: C.timber, trim: C.whitewash,
  roofColor: ROOF.green, door: 3,
});

// --- GRAVELPIT FOUNDRY -----------------------------------------------------
// Two big empty volumes with mezzanines, which is the best interior shape the
// game has: long sightlines inside, high ground you have to climb to.
put(-176, -66, 4, 3, {
  name: 'Foundry Shed One', archetype: 'warehouse', style: 'warehouse', floors: 2,
  roof: 'flat', surface: 'metal', color: C.steel, trim: C.mustard,
  roofColor: ROOF.tin, door: 0, mezzanine: true, sign: 'FOUNDRY 1',
});
put(-144, -70, 3, 3, {
  name: 'Foundry Shed Two', archetype: 'warehouse', style: 'warehouse', floors: 2,
  roof: 'shed', surface: 'metal', color: C.rust, trim: C.cream,
  roofColor: ROOF.tin, door: 3, mezzanine: true,
});
put(-184, -22, 2, 3, {
  name: 'Pit Foremans Office', archetype: 'depot', style: 'city', floors: 2,
  roof: 'flat', surface: 'concrete', color: C.concrete, trim: C.mustard,
  roofColor: ROOF.tar, door: 3, sign: 'SITE OFFICE',
});
put(-150, -16, 3, 2, {
  name: 'Aggregate Store', archetype: 'warehouse', style: 'warehouse', floors: 1,
  roof: 'shed', surface: 'concrete', color: C.palestone, trim: C.steel,
  roofColor: ROOF.tin, door: 1,
});

// --- THUNDERHEAD PEAK ------------------------------------------------------
put(174, 2, 3, 3, {
  name: 'Thunderhead Lookout', archetype: 'tower', style: 'city', floors: 3,
  roof: 'hip', surface: 'siding', color: C.moss, trim: C.cream,
  roofColor: ROOF.tin, door: 1, sign: 'FIRE LOOKOUT',
});
put(202, 56, 2, 3, {
  name: 'Ranger Station', archetype: 'cabin', style: 'cabin', floors: 2,
  roof: 'gable', surface: 'log', color: C.timber, trim: C.mustard,
  roofColor: ROOF.green, door: 2,
});
put(164, 44, 2, 2, {
  name: 'Falls Pump House', archetype: 'bunker', style: 'warehouse', floors: 1,
  roof: 'flat', surface: 'concrete', color: C.concrete, trim: C.steel,
  roofColor: ROOF.tar, door: 2,
});

// --- ROADSIDE LANDMARKS ----------------------------------------------------
put(-48, -78, 2, 2, {
  name: 'Pump & Pantry', archetype: 'gas', style: 'city', floors: 1,
  roof: 'flat', surface: 'plaster', color: C.whitewash, trim: C.rust,
  roofColor: ROOF.tar, door: 1, storefront: true, sign: 'PUMP & PANTRY',
});
put(48, -70, 5, 2, {
  name: 'Restwell Motel', archetype: 'motel', style: 'house', floors: 1,
  roof: 'shed', surface: 'plaster', color: C.sand, trim: C.teal,
  roofColor: ROOF.tile, door: 0, sign: 'RESTWELL MOTEL',
});
put(24, -96, 2, 2, {
  name: 'Motel Office', archetype: 'shop', style: 'house', floors: 1,
  roof: 'gable', surface: 'plaster', color: C.teal, trim: C.whitewash,
  roofColor: ROOF.tile, door: 0, storefront: true, sign: 'OFFICE',
});
put(154, -76, 2, 2, {
  name: 'Relay Station', archetype: 'bunker', style: 'warehouse', floors: 1,
  roof: 'flat', surface: 'concrete', color: C.concrete, trim: C.rust,
  roofColor: ROOF.tar, door: 2,
});
put(206, -114, 2, 2, {
  name: 'The Overlook Hut', archetype: 'cabin', style: 'cabin', floors: 1,
  roof: 'gable', surface: 'log', color: C.darkTimber, trim: C.cream,
  roofColor: ROOF.shingle, door: 1,
});
put(-208, 98, 2, 2, {
  name: 'Salt Flats Shack', archetype: 'cabin', style: 'cabin', floors: 1,
  roof: 'shed', surface: 'siding', color: C.sand, trim: C.teal,
  roofColor: ROOF.tin, door: 3,
});
put(30, 166, 3, 2, {
  name: 'Orchard Packing Shed', archetype: 'warehouse', style: 'warehouse', floors: 1,
  roof: 'gable', surface: 'siding', color: C.sage, trim: C.whitewash,
  roofColor: ROOF.tin, door: 0,
});
put(196, 146, 2, 2, {
  name: 'Standing Stones Ruin', archetype: 'ruin', style: 'city', floors: 1,
  roof: 'flat', surface: 'stone', color: C.stone, trim: C.stone,
  roofColor: ROOF.slate, door: 0, roofless: true,
});
put(-138, 76, 2, 2, {
  name: 'The Ford Shelter', archetype: 'bunker', style: 'warehouse', floors: 1,
  roof: 'flat', surface: 'concrete', color: C.concrete, trim: C.moss,
  roofColor: ROOF.tar, door: 0,
});
put(128, -52, 2, 2, {
  name: 'Drive-In Projection Booth', archetype: 'depot', style: 'city', floors: 1,
  roof: 'flat', surface: 'plaster', color: C.plum, trim: C.mustard,
  roofColor: ROOF.tar, door: 1, sign: 'PROJECTION',
});

// District platforms first: every building standing on one is forced onto its
// level, so the square is flat and the pads under the buildings agree with it.
for (const p of PLATFORMS) {
  const levels = p.members.map(b => b.base);
  p.level = levels.length
    ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length)
    : Math.round(rawTerrain(p.x, p.z) / TILE);
  for (const b of p.members) b.base = p.level;
  // Stretch the platform to enclose every footprint standing on it. A building
  // whose corner hangs over the edge would otherwise sit on graded ground at
  // that corner and level ground everywhere else.
  let x0 = p.x - p.hw, x1 = p.x + p.hw, z0 = p.z - p.hd, z1 = p.z + p.hd;
  for (const b of p.members) {
    x0 = Math.min(x0, b.x * TILE - 3); x1 = Math.max(x1, (b.x + b.w) * TILE + 3);
    z0 = Math.min(z0, b.z * TILE - 3); z1 = Math.max(z1, (b.z + b.d) * TILE + 3);
  }
  indexPad({ x0, z0, x1, z1, h: p.level * TILE, blend: p.blend });
}

// Then a pad under each building that is not on a platform.
for (const b of BUILDINGS) {
  if (PLATFORMS.some(p => p.members.includes(b))) continue;
  const m = TILE * 0.45;
  indexPad({
    x0: b.x * TILE - m, z0: b.z * TILE - m,
    x1: (b.x + b.w) * TILE + m, z1: (b.z + b.d) * TILE + m,
    h: b.base * TILE, blend: 8,
  });
}

indexBuildings();

// Second pass: re-grade the roads now that the buildings have chosen their
// levels, holding each road to the level of every platform it crosses. This is
// also when the drawable road segments and the bridges are recorded.
layAll(true);

// ---------------------------------------------------------------------------
// Blueprints
//
// Resolved here, next to the building list, because everything that places
// something on the island needs to know where the doors are.
// ---------------------------------------------------------------------------

export const BLUEPRINTS: readonly Blueprint[] = BUILDINGS.map((b, i) => blueprintFor(b, i));

/**
 * True when a box would sit in a doorway.
 *
 * A dumpster parked across the front door, or a field fence running through the
 * barn entrance, is invisible in the data and obvious the moment somebody walks
 * up to it. Everything placed on the island is checked against this.
 */
export function blocksEntrance(x: number, z: number, halfW: number, halfD: number): boolean {
  return BLUEPRINTS.some(bp => {
    const e = bp.entrance;
    // Five metres either side of the threshold, and a little wider than the
    // door itself so nothing is placed where it would snag a sprint.
    const alongZ = e.side === 0 || e.side === 1;
    const x0 = alongZ ? e.x - 2.8 - halfW : e.x - 5.5 - halfW;
    const x1 = alongZ ? e.x + 2.8 + halfW : e.x + 5.5 + halfW;
    const z0 = alongZ ? e.z - 5.5 - halfD : e.z - 2.8 - halfD;
    const z1 = alongZ ? e.z + 5.5 + halfD : e.z + 2.8 + halfD;
    return x > x0 && x < x1 && z > z0 && z < z1;
  });
}

// ---------------------------------------------------------------------------
// Piers and decking
// ---------------------------------------------------------------------------

export interface Deck { x0: number; z0: number; x1: number; z1: number; y: number; rails: boolean; }

/** Walk out from a point until the ground drops below the waterline. */
function shorelineAlong(x: number, z: number, dx: number, dz: number): [number, number] {
  let out: [number, number] = [x, z];
  for (let t = 0; t < 120; t += 1.5) {
    const px = x + dx * t, pz = z + dz * t;
    if (rawTerrain(px, pz) < SHORE_HEIGHT - 0.7) return out;
    out = [px, pz];
  }
  return out;
}

const saltwoodShore = shorelineAlong(-140, -172, -0.25, -0.97);
export const DECKS: readonly Deck[] = [
  // The harbour pier at Saltwood, running out over the water.
  {
    x0: saltwoodShore[0] - 5, z0: saltwoodShore[1] - 34, x1: saltwoodShore[0] + 5, z1: saltwoodShore[1] + 2,
    y: SEA_LEVEL + 1.7, rails: true,
  },
  // The angler's pier on Misty Lake.
  { x0: -184, z0: 134, x1: -176, z1: 164, y: LAKE.surface + 1.2, rails: true },
  // The mill's loading stage over the river.
  { x0: 8, z0: 44, x1: 26, z1: 50, y: riverSurface(riverDistance(16, 46).t) + 2.4, rails: false },
];

/** Kept for compatibility with the old harbour: the main pier. */
export const DOCK = DECKS[0];

// ---------------------------------------------------------------------------
// Scenery: trees and rocks
// ---------------------------------------------------------------------------

export type TreeSpecies = 'pine' | 'oak' | 'autumn' | 'dead';
export interface Scenery {
  x: number; z: number; y: number; size: number;
  kind: 'tree' | 'rock';
  species?: TreeSpecies;
}
export const SCENERY: Scenery[] = [];

let seed = 20260921;
function random(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}

/** How thickly this part of the island is wooded, 0..1, and with what. */
function forestAt(x: number, z: number): { density: number; species: TreeSpecies } {
  // Greenwood Hollow: proper forest, and the densest cover on the island. You
  // should not be able to see thirty metres in here.
  const hollow = (1 - smooth((Math.hypot((x + 78) / 1.3, z - 132) - 44) / 42)) * 0.95;
  // The mountain's wooded skirt, thinning out toward the bare summit.
  const slopes = (1 - smooth((Math.hypot(x - 168, (z - 10) / 1.2) - 42) / 48)) * (1 - smooth((rawTerrain(x, z) - 26) / 12)) * 0.8;
  // River gallery woodland: a ribbon of trees marking the water from a distance.
  const river = riverDistance(x, z);
  const gallery = (1 - smooth((river.d - riverWidth(river.t) - 8) / 18)) * 0.5;
  // Shelter belts around the lake, and the orchard rows in the south.
  const lake = (1 - smooth((lakeReach(x, z) - 1.2) / 0.55)) * 0.45;
  const orchard = (1 - smooth((Math.hypot(x - 30, z - 162) - 22) / 14)) * 0.7;
  // The open farm shelf is deliberately bare: it is the most exposed ground on
  // the island and that is what makes its fence lines matter.
  const farm = 1 - smooth((Math.hypot((x - 78) / 1.2, z - 128) - 46) / 30) * 0.9;
  const density = Math.max(hollow, slopes, gallery, lake, orchard, 0.16) * farm;
  const species: TreeSpecies = hollow > 0.35 || slopes > 0.3
    ? (random() < 0.85 ? 'pine' : 'oak')
    : orchard > 0.3
      ? 'autumn'
      : gallery > 0.25 || lake > 0.2
        ? (random() < 0.4 ? 'autumn' : 'oak')
        : 'oak';
  return { density, species };
}

{
  const tries = 90000;
  for (let i = 0; i < tries; i++) {
    const x = (random() - 0.5) * MAP_HALF * 2.02;
    const z = (random() - 0.5) * MAP_HALF * 2.02;
    const ground = rawTerrain(x, z);
    if (ground < SHORE_HEIGHT + 0.4) continue;              // no trees on the beach or in the water
    if (onRoad(x, z, 4)) continue;
    if (insideAnyBuilding(x, z, 8) || blocksEntrance(x, z, 2, 2)) continue;
    const rock = random() < 0.13;
    if (rock) {
      // Rocks cluster on steep and high ground, where they read as outcrops.
      const steep = Math.abs(rawTerrain(x + 2, z) - rawTerrain(x - 2, z)) / 4
        + Math.abs(rawTerrain(x, z + 2) - rawTerrain(x, z - 2)) / 4;
      if (random() > 0.18 + steep * 2.2 + (ground > 26 ? 0.35 : 0)) continue;
      SCENERY.push({ x, z, y: ground, size: 1.6 + random() * 3.4, kind: 'rock' });
      continue;
    }
    const { density, species } = forestAt(x, z);
    if (random() > density) continue;
    SCENERY.push({
      x, z, y: ground,
      size: species === 'pine' ? 5.5 + random() * 4.5 : 4.5 + random() * 3.5,
      kind: 'tree', species,
    });
  }
  // A few dead trees where the ground is poor, for silhouette variety.
  for (let i = 0; i < 160; i++) {
    const x = (random() - 0.5) * MAP_HALF * 1.9;
    const z = (random() - 0.5) * MAP_HALF * 1.9;
    const ground = rawTerrain(x, z);
    if (ground < SHORE_HEIGHT + 1 || onRoad(x, z, 5) || insideAnyBuilding(x, z, 10) || blocksEntrance(x, z, 2, 2)) continue;
    SCENERY.push({ x, z, y: ground, size: 5 + random() * 2, kind: 'tree', species: 'dead' });
  }
}


// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export interface Car { x: number; z: number; yaw: number; color: number; kind: 'car' | 'truck' | 'wreck'; }
export const CAR_LENGTH = 5.6;
export const CAR_WIDTH = 2.4;
export const CAR_HEIGHT = 1.55;
export const CARS: Car[] = [];

{
  const palette = [0xd8323c, 0xf0c020, 0x2a6fd0, 0x1d1f24, 0xe8eaee, 0x2fb56b, 0xff7a1a, 0x6f4f9c];
  const spots: Array<[number, number, number, Car['kind']]> = [
    // Crestview car park, in bays.
    [80, -148, 0, 'car'], [86, -148, 0, 'car'], [92, -148, 0, 'car'],
    [80, -138, Math.PI, 'car'], [86, -138, Math.PI, 'truck'], [92, -138, Math.PI, 'car'],
    [128, -158, 1.55, 'car'], [118, -132, 0.2, 'car'],
    // Millstone square and the garage.
    [-22, -12, 1.57, 'car'], [-22, -22, 1.57, 'truck'], [20, -18, -1.57, 'car'], [52, -14, 0.5, 'wreck'],
    // Motel forecourt.
    [34, -64, 0.1, 'car'], [42, -64, 0.1, 'car'], [56, -64, 0.1, 'truck'],
    // Gas station pumps.
    [-54, -70, 1.57, 'car'], [-42, -70, 1.57, 'truck'],
    // Saltwood quay.
    [-140, -150, 0.35, 'truck'], [-128, -134, 2.1, 'car'], [-112, -128, 1.1, 'wreck'],
    // Foundry yard.
    [-166, -52, 0.4, 'truck'], [-158, -44, 2.4, 'truck'], [-186, -30, 1.2, 'wreck'],
    // Hayseed farmyard.
    [70, 132, 0.9, 'truck'], [84, 120, 2.6, 'car'], [44, 142, 1.4, 'wreck'],
    // Drive-in, facing the screen.
    [124, -40, 3.14, 'car'], [132, -40, 3.14, 'car'], [128, -32, 3.14, 'truck'],
    // Lay-bys and breakdowns out on the highways.
    [8, -100, 0.15, 'wreck'], [-92, -24, 3.0, 'car'], [92, 4, 0.1, 'truck'],
    [-70, 20, 0.4, 'wreck'], [30, 128, 2.2, 'truck'],
  ];
  const clearance = Math.hypot(CAR_LENGTH, CAR_WIDTH) / 2;
  for (const [x, z, yaw, kind] of spots) {
    if (insideAnyBuilding(x, z, clearance) || blocksEntrance(x, z, clearance, clearance)) continue;
    CARS.push({ x, z, yaw, color: palette[CARS.length % palette.length], kind });
  }
}

// ---------------------------------------------------------------------------
// Cover props
//
// Only things worth taking cover behind live here, because everything in this
// list becomes a collider. Decoration without collision is placed by the
// renderer instead, which is much cheaper.
// ---------------------------------------------------------------------------

export interface Prop {
  x: number; y: number; z: number;
  w: number; h: number; d: number;
  color: number;
  kind: 'crate' | 'fence' | 'bench' | 'planter' | 'barrel' | 'dumpster' | 'haybale' | 'barrier' | 'container' | 'rock' | 'sign' | 'well' | 'tank';
}
export const PROPS: Prop[] = [];

function prop(x: number, z: number, w: number, h: number, d: number, color: number, kind: Prop['kind'], y?: number): void {
  if (blocksEntrance(x, z, w / 2, d / 2)) return;
  PROPS.push({ x, y: y ?? terrainHeight(x, z), z, w, h, d, color, kind });
}

/** A run of fence between two points. */
function fenceLine(x1: number, z1: number, x2: number, z2: number, color = 0xe6dcc4): void {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const steps = Math.max(1, Math.round(len / 6));
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const ax = x1 + (x2 - x1) * t0, az = z1 + (z2 - z1) * t0;
    const bx = x1 + (x2 - x1) * t1, bz = z1 + (z2 - z1) * t1;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    prop(mx, mz, alongX ? Math.abs(bx - ax) : 0.28, 1.35, alongX ? 0.28 : Math.abs(bz - az), color, 'fence');
  }
}

// Foundry: shipping containers and spoil, the best hard cover on the island.
for (let i = 0; i < 9; i++) {
  const x = -196 + (i % 3) * 14, z = -96 + Math.floor(i / 3) * 10;
  prop(x, z, 12, 5.4, 5, [0x9a5b4a, 0x4a6f9a, 0x6f8f5a][i % 3], 'container');
}
for (const [x, z] of [[-160, -58], [-154, -50], [-168, -44], [-150, -66]] as const) {
  prop(x, z, 2.2, 2.4, 2.2, 0xb8a98c, 'barrel');
}
// Quarry gravel heaps read as rock, and are climbable.
for (const [x, z, r] of [[-190, -72, 7], [-176, -96, 6], [-158, -90, 5]] as const) {
  prop(x, z, r * 2, r * 0.9, r * 2, 0x8d8779, 'rock');
}

// Hayseed: hay bales, field fences and a water tank.
for (let i = 0; i < 14; i++) {
  const x = 40 + (i % 7) * 7 + (i % 2) * 2, z = 136 + Math.floor(i / 7) * 8;
  prop(x, z, 2.6, 2.2, 2.6, 0xd6b45c, 'haybale');
}
fenceLine(26, 104, 118, 96, 0xe8dfc8);
fenceLine(118, 96, 126, 152, 0xe8dfc8);
fenceLine(26, 104, 22, 150, 0xe8dfc8);
prop(112, 128, 5, 6.5, 5, 0x8e9aa0, 'tank');

// Millstone: square furniture and the old well.
prop(-4, -14, 3.2, 1.6, 3.2, 0xa8a296, 'well');
for (const [x, z] of [[-18, -6], [10, -6], [-18, -26], [12, -26]] as const) prop(x, z, 2.4, 1.0, 1.0, 0x8a6a4a, 'bench');
for (const [x, z] of [[-24, -16], [18, -16]] as const) prop(x, z, 2.0, 1.2, 2.0, 0x9a7d5c, 'planter');

// Crestview: street clutter and rooftop-adjacent cover.
for (const [x, z] of [[62, -152], [108, -152], [130, -134], [70, -128]] as const) {
  prop(x, z, 2.6, 2.0, 1.8, 0x3f5b52, 'dumpster');
}
for (const [x, z] of [[96, -152], [96, -132]] as const) prop(x, z, 2.2, 1.1, 2.2, 0x9a7d5c, 'planter');

// Saltwood: crab pots, crates and a barrier along the quay.
for (let i = 0; i < 8; i++) prop(-150 + (i % 4) * 4, -158 + Math.floor(i / 4) * 5, 2.2, 2.2, 2.2, 0x9a7a5a, 'crate');
fenceLine(-158, -150, -120, -144, 0xcfc4a8);

// Greenwood: a stone wall around the chapel and mossy boulders.
fenceLine(-112, 138, -78, 140, 0xa8a89c);
fenceLine(-112, 138, -114, 166, 0xa8a89c);
for (const [x, z, r] of [[-86, 128, 3], [-66, 146, 2.6], [-100, 170, 3.4]] as const) {
  prop(x, z, r * 2, r * 1.2, r * 2, 0x869080, 'rock');
}

// Roadside barriers where the highway runs along a drop.
for (let i = 0; i < 6; i++) prop(96 - 24 + i * 9, -176, 6, 1.0, 0.6, 0xd8d2c4, 'barrier');
for (let i = 0; i < 5; i++) prop(182 + i * 6, 30 + i * 3, 5, 1.0, 0.6, 0xd8d2c4, 'barrier');

// Drive-in screen: a genuine wall of cover in the open.
prop(128, -22, 22, 12, 1.4, 0xe8e4d8, 'sign');

// Mountain: boulders for the climb.
for (const [x, z, r] of [[188, 22, 4], [166, 32, 3.4], [200, 8, 3], [158, -6, 3.6], [180, -18, 4.2]] as const) {
  prop(x, z, r * 2, r * 1.5, r * 2, 0x8f8d86, 'rock');
}

// ---------------------------------------------------------------------------
// Finishing up
//
// District heights are read from the finished ground -- after the platforms are
// cut and the roads are graded -- because that is the ground players stand on.
// ---------------------------------------------------------------------------

for (const l of LOCATIONS) {
  l.height = l.name === 'MISTY LAKE' ? LAKE.surface : terrainHeight(l.x, l.z);
}
