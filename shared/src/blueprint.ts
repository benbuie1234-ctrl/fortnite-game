/**
 * Building blueprints: one description of a structure, used by everything.
 *
 * The old buildings were a shell -- four walls, a floor per storey, one stair
 * column -- because the collision generator and the renderer each invented
 * their own idea of the same building from the same four numbers. Nothing knew
 * where a room was, so nothing could furnish one, and an "interior" was a single
 * six-metre-deep hall with the furniture shoved against the outside walls.
 *
 * A blueprint is that missing middle. It is computed once, in shared code, from
 * the building record, and it says exactly where every wall, doorway, window,
 * stair flight, floor slab and ROOM is. The server turns it into colliders, the
 * renderer turns it into geometry, and the furnisher walks its rooms. Because
 * all three read the same structure, a doorway you can see is a doorway you can
 * walk through and a room with a bed in it is a room with walls around it.
 *
 * Everything here is deterministic: same building record in, same blueprint out,
 * on every client and on the server.
 */
import { TILE } from './constants';
import type { Facing } from './build';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type RoofStyle = 'gable' | 'hip' | 'gambrel' | 'flat' | 'shed' | 'spire' | 'open';

/** Surface finish of a wall. Drives both the texture and the trim detailing. */
export type Surface =
  | 'siding'     // painted horizontal clapboard: houses
  | 'plaster'    // rendered masonry: town shops, motels
  | 'brick'
  | 'stone'      // rubble stone: chapel, ruins, mill
  | 'log'        // stacked timber: cabins
  | 'metal'      // corrugated industrial sheeting
  | 'concrete';

export type RoomKind =
  | 'living' | 'kitchen' | 'dining' | 'bed' | 'bath' | 'hall' | 'office'
  | 'shop' | 'storage' | 'garage' | 'attic' | 'cellar' | 'workshop'
  | 'nave' | 'lobby' | 'bunk' | 'bar' | 'stall' | 'empty';

export type Finish = 'wood' | 'tile' | 'carpet' | 'concrete' | 'dirt' | 'hay';

export type Archetype =
  | 'townhouse' | 'apartment' | 'shop' | 'farmhouse' | 'cottage' | 'barn'
  | 'warehouse' | 'cabin' | 'chapel' | 'gas' | 'motel' | 'mill' | 'tower'
  | 'lighthouse' | 'bunker' | 'ruin' | 'depot' | 'silo';

/**
 * A building, as the map lays it out.
 *
 * Position and size are in build cells so the structure lands squarely on the
 * grid the players build in -- a wall they put up lines up with a wall the map
 * put up, which is what makes building against a house feel deliberate.
 */
export interface Building {
  /** Grid cell of the -X/-Z corner. */
  x: number;
  z: number;
  /** Footprint in cells. */
  w: number;
  d: number;
  /** Habitable storeys above the ground floor level. */
  floors: number;
  /** Grid level of the lowest floor slab. */
  base: number;
  /** Coarse class, kept for the systems that only need "what kind of place". */
  style: 'city' | 'house' | 'warehouse' | 'cabin';
  archetype: Archetype;
  /** Body colour. */
  color: number;
  /** Trim, frames and fascia. */
  trim?: number;
  roof: RoofStyle;
  roofColor?: number;
  surface: Surface;
  name: string;
  /** Side the main entrance is on: 0 = -Z, 1 = +Z, 2 = -X, 3 = +X. */
  door?: 0 | 1 | 2 | 3;
  /** Lowest level is a semi-buried cellar or garage at grade. */
  cellar?: boolean;
  /** Partial upper floor, for tall single-volume buildings. */
  mezzanine?: boolean;
  /** Habitable roof space under a pitched roof. */
  attic?: boolean;
  /** A balcony hung off the upper floor, on the door side. */
  balcony?: boolean;
  /** Shopfront glazing on the ground floor. */
  storefront?: boolean;
  /** Skip the roof entirely -- ruins and open sheds. */
  roofless?: boolean;
  /** Sign text, if the building advertises itself. */
  sign?: string;
}

export interface Opening {
  /** Centre along the wall run, in world metres. */
  u: number;
  w: number;
  /** Bottom and top, relative to the wall's own base. */
  sill: number;
  top: number;
  kind: 'door' | 'window' | 'shop' | 'garage' | 'arch' | 'hatch' | 'louvre';
}

/**
 * A straight run of wall.
 *
 * `axis` names the plane, not the direction of travel: an 'x' wall is a plane of
 * constant x and therefore runs along z. Openings are cut out of it, so the same
 * data makes both the colliders and the geometry, and a window is a hole in both
 * or in neither.
 */
export interface WallRun {
  axis: 'x' | 'z';
  at: number;
  u0: number;
  u1: number;
  y: number;
  h: number;
  thick: number;
  exterior: boolean;
  surface: Surface;
  color: number;
  level: number;
  openings: Opening[];
  /** Low wall: parapet, balcony edge, stair guard. Not a room divider. */
  parapet?: boolean;
}

export interface Room {
  level: number;
  kind: RoomKind;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Floor height. */
  y: number;
  finish: Finish;
}

export interface CellRef { gx: number; gy: number; gz: number; }
export interface RampRef extends CellRef { facing: Facing; }

export interface SolidBox {
  x: number; y: number; z: number;
  w: number; h: number; d: number;
  /** Purely visual solids are still collided with; this only picks a texture. */
  surface?: Surface;
  color?: number;
}

export interface Blueprint {
  b: Building;
  /** World-space footprint. */
  x0: number; z0: number; x1: number; z1: number;
  /** Every floor slab cell, including the roof deck or attic floor. */
  floors: CellRef[];
  /** Stair flights, lowest first. */
  stairs: RampRef[];
  /** Roof wedges, for pitched roofs. */
  roofRamps: RampRef[];
  walls: WallRun[];
  rooms: Room[];
  solids: SolidBox[];
  /** The stair shaft, so nothing else is placed in it. */
  shaft: { x0: number; z0: number; x1: number; z1: number } | null;
  /** Level index of the topmost walkable slab. */
  topLevel: number;
  /** Where the main door is, in world space, and which way it faces. */
  entrance: { x: number; z: number; side: 0 | 1 | 2 | 3 };
}

// ---------------------------------------------------------------------------
// Deterministic per-building randomness
// ---------------------------------------------------------------------------

function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Opening shapes
// ---------------------------------------------------------------------------

const DOOR = { w: 2.2, sill: 0, top: 3.4 };
const WINDOW = { w: 2.4, sill: 1.7, top: 4.2 };
const TALL_WINDOW = { w: 2.0, sill: 0.9, top: 4.5 };
const SHOPFRONT = { w: 4.4, sill: 0.8, top: 4.6 };
const SLIT = { w: 1.6, sill: 3.6, top: 4.8 };

/** Solid boxes for one wall run, with every opening cut out of it. */
export function wallBoxes(run: WallRun): Array<[number, number, number, number, number, number]> {
  const half = run.thick / 2;
  const out: Array<[number, number, number, number, number, number]> = [];
  const push = (a: number, b: number, y0: number, y1: number): void => {
    if (b - a < 0.02 || y1 - y0 < 0.02) return;
    out.push(run.axis === 'x'
      ? [run.at - half, y0, a, run.at + half, y1, b]
      : [a, y0, run.at - half, b, y1, run.at + half]);
  };
  const top = run.y + run.h;
  // Openings, left to right, clipped to the run.
  const holes = run.openings
    .map(o => ({ a: o.u - o.w / 2, b: o.u + o.w / 2, y0: run.y + o.sill, y1: run.y + Math.min(o.top, run.h) }))
    .filter(o => o.b > run.u0 && o.a < run.u1)
    .sort((p, q) => p.a - q.a);
  let cursor = run.u0;
  for (const h of holes) {
    const a = Math.max(run.u0, h.a);
    const b = Math.min(run.u1, h.b);
    push(cursor, a, run.y, top);
    // Sill below and header above the hole.
    if (h.y0 > run.y) push(a, b, run.y, h.y0);
    if (h.y1 < top) push(a, b, h.y1, top);
    cursor = Math.max(cursor, b);
  }
  push(cursor, run.u1, run.y, top);
  return out;
}

// ---------------------------------------------------------------------------
// Room plan
//
// A binary split of the footprint, which is how a floor plan actually reads:
// rooms of unequal size, off a hallway or off each other, each with one door.
// A tree of splits is automatically connected -- put one door in every split
// wall and every room can be reached from every other.
// ---------------------------------------------------------------------------

interface Rect { x0: number; z0: number; x1: number; z1: number; }

interface Plan {
  rooms: Rect[];
  /** Interior partitions produced by the splits. */
  walls: Array<{ axis: 'x' | 'z'; at: number; u0: number; u1: number; door: number }>;
}

const overlaps = (a0: number, a1: number, b0: number, b1: number): boolean =>
  a0 < b1 - 0.01 && a1 > b0 + 0.01;

/**
 * Split a rectangle into rooms, leaving `keep` alone.
 *
 * `keep` holds the stair shaft and a short apron inside each exterior door: no
 * partition may cross one and no doorway may open into one, which is what stops
 * a floor plan from walling off its own staircase or putting a wall a metre
 * inside the front door.
 */
function planRooms(rect: Rect, keep: Rect[], rand: () => number, minSide: number, depth: number): Plan {
  const w = rect.x1 - rect.x0, d = rect.z1 - rect.z0;
  if (depth <= 0 || (w < minSide * 2 + 0.3 && d < minSide * 2 + 0.3)) return { rooms: [rect], walls: [] };

  // Split the long way, so rooms stay squarish rather than becoming corridors.
  const axes: Array<'x' | 'z'> = w >= d ? ['x', 'z'] : ['z', 'x'];
  for (const axis of axes) {
    const span = axis === 'x' ? w : d;
    if (span < minSide * 2 + 0.3) continue;
    const lo = (axis === 'x' ? rect.x0 : rect.z0) + minSide;
    const hi = (axis === 'x' ? rect.x1 : rect.z1) - minSide;
    const choices: number[] = [];
    for (let t = lo; t <= hi + 1e-6; t += 0.5) choices.push(Math.round(t * 2) / 2);
    const usable = choices.filter(at => keep.every(k => {
      if (axis === 'x') return !(at > k.x0 - 0.4 && at < k.x1 + 0.4 && overlaps(rect.z0, rect.z1, k.z0, k.z1));
      return !(at > k.z0 - 0.4 && at < k.z1 + 0.4 && overlaps(rect.x0, rect.x1, k.x0, k.x1));
    }));
    if (usable.length === 0) continue;
    // Off-centre, for rooms of different sizes.
    const at = usable[Math.floor(rand() * usable.length * 0.999)];

    const a: Rect = axis === 'x' ? { ...rect, x1: at } : { ...rect, z1: at };
    const b: Rect = axis === 'x' ? { ...rect, x0: at } : { ...rect, z0: at };
    const u0 = axis === 'x' ? rect.z0 : rect.x0;
    const u1 = axis === 'x' ? rect.z1 : rect.x1;

    // Doorway: the widest stretch of the partition that misses everything
    // protected, so the two rooms are always connected.
    const blocked: Array<[number, number]> = [];
    for (const k of keep) {
      const k0 = axis === 'x' ? k.z0 : k.x0;
      const k1 = axis === 'x' ? k.z1 : k.x1;
      if (overlaps(u0, u1, k0, k1)) blocked.push([k0 - 0.3, k1 + 0.3]);
    }
    blocked.sort((p, q) => p[0] - q[0]);
    const clear: Array<[number, number]> = [];
    let cursor = u0 + 1.3;
    for (const [b0, b1] of blocked) {
      if (b0 > cursor) clear.push([cursor, Math.min(b0, u1 - 1.3)]);
      cursor = Math.max(cursor, b1);
    }
    if (cursor < u1 - 1.3) clear.push([cursor, u1 - 1.3]);
    const best = clear.filter(([c0, c1]) => c1 - c0 > 0.1).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
    // Nowhere to put a door means this split would seal a room off. Do not make it.
    if (!best) continue;
    const door = best[0] + (best[1] - best[0]) * (0.3 + rand() * 0.4);

    const left = planRooms(a, keep, rand, minSide, depth - 1);
    const right = planRooms(b, keep, rand, minSide, depth - 1);
    return {
      rooms: [...left.rooms, ...right.rooms],
      walls: [...left.walls, ...right.walls, { axis, at, u0, u1, door }],
    };
  }
  return { rooms: [rect], walls: [] };
}

// ---------------------------------------------------------------------------
// Room programme per archetype
// ---------------------------------------------------------------------------

const PROGRAMME: Record<Archetype, RoomKind[][]> = {
  //            ground floor                     upper floors
  farmhouse: [['living', 'kitchen', 'dining', 'hall'], ['bed', 'bed', 'bath', 'hall']],
  cottage: [['living', 'kitchen', 'bed', 'bath'], ['bed', 'bath', 'storage']],
  townhouse: [['shop', 'storage', 'hall'], ['living', 'kitchen', 'bed', 'bath']],
  apartment: [['lobby', 'hall', 'storage'], ['living', 'kitchen', 'bed', 'bath']],
  shop: [['shop', 'shop', 'storage', 'office']],
  motel: [['bed', 'bath', 'bed', 'bath'], ['bed', 'bath', 'bed', 'bath']],
  barn: [['stall', 'storage', 'workshop'], ['attic', 'storage']],
  warehouse: [['storage', 'workshop', 'office'], ['storage', 'office']],
  cabin: [['living', 'bunk', 'kitchen'], ['bunk', 'storage']],
  chapel: [['nave', 'nave', 'office'], ['storage']],
  gas: [['shop', 'storage', 'bath', 'office']],
  mill: [['workshop', 'storage'], ['workshop', 'storage', 'office']],
  tower: [['storage'], ['office'], ['office']],
  lighthouse: [['storage'], ['office']],
  bunker: [['bunk', 'storage', 'workshop']],
  ruin: [['empty', 'empty']],
  depot: [['office', 'storage']],
  silo: [['storage']],
};

const FINISH: Record<RoomKind, Finish> = {
  living: 'wood', kitchen: 'tile', dining: 'wood', bed: 'carpet', bath: 'tile',
  hall: 'wood', office: 'carpet', shop: 'tile', storage: 'concrete',
  garage: 'concrete', attic: 'wood', cellar: 'concrete', workshop: 'concrete',
  nave: 'tile', lobby: 'tile', bunk: 'wood', bar: 'wood', stall: 'hay', empty: 'dirt',
};

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

/**
 * Where the stairwell goes, or null when the building has only one level.
 *
 * A switchback, in two adjacent cells, with a landing in the cell beyond each
 * end. Flight one climbs away from you in the left-hand cell, you step across
 * the landing, and flight two climbs back over the right-hand cell. That shape
 * is what real buildings use and it is the only one that works here: a flight
 * stacked directly over the flight below turns the cell into a wedge-shaped
 * ceiling that a climbing player's head runs into two thirds of the way up.
 *
 * Under a pitched roof the LAST flight must also finish in a cell under the
 * ridge, or it climbs into the underside of the roof. Which of the two cells
 * the last flight lands in is a matter of parity, so the two are simply ordered
 * to come out right.
 */
interface Shaft {
  /** Direction flights travel and reverse along. */
  axis: 'x' | 'z';
  /** Cell index along `axis` that both flights occupy. */
  row: number;
  /** The two cell indices across from each other, in climb order. */
  cols: [number, number];
}

function chooseShaft(
  b: Building, flights: number, ridgeAxis: 'x' | 'z' | null,
  ridgeFrom: number, ridgeSpan: number, doorSide: 0 | 1 | 2 | 3,
): Shaft | null {
  if (flights < 1) return null;
  // Flights run along the ridge, so the attic they end in is the strip with
  // headroom. With no ridge, they run along whichever way the building is long.
  const axis: 'x' | 'z' = ridgeAxis ?? (b.w >= b.d ? 'x' : 'z');
  const along = axis === 'x' ? b.w : b.d;
  const across = axis === 'x' ? b.d : b.w;
  // Three cells to climb through (flight plus a landing at each end) and two
  // to switch back between.
  if (along < 3 || across < 2) return null;
  const alongBase = axis === 'x' ? b.x : b.z;
  const acrossBase = axis === 'x' ? b.z : b.x;

  // Which wall the front door is in, expressed on each axis: +1 means the door
  // is at the high end, -1 the low end, 0 means that axis does not face it.
  const doorAlong = axis === 'x'
    ? (doorSide === 2 ? -1 : doorSide === 3 ? 1 : 0)
    : (doorSide === 0 ? -1 : doorSide === 1 ? 1 : 0);
  const doorAcross = axis === 'x'
    ? (doorSide === 0 ? -1 : doorSide === 1 ? 1 : 0)
    : (doorSide === 2 ? -1 : doorSide === 3 ? 1 : 0);

  // Put the stairwell at the back of the building, away from the door. Walking
  // in through the front and finding the stairs at the far end of the hall is
  // both how houses work and what keeps the threshold clear.
  const row = doorAlong > 0 ? alongBase + 1 : alongBase + along - 2;

  // Candidate pairs of adjacent cells across the shaft. Under a pitched roof
  // the pair has to include a ridge cell, because the last flight ends in one.
  const ridgeCells = ridgeAxis === null ? null : [ridgeFrom, ridgeFrom + ridgeSpan - 1];
  let best: [number, number] | null = null, bestScore = -Infinity;
  for (let a = acrossBase; a <= acrossBase + across - 2; a++) {
    const pair: [number, number] = [a, a + 1];
    if (ridgeCells && !pair.some(c => c >= ridgeCells[0] && c <= ridgeCells[1])) continue;
    const middle = a + 0.5 - (acrossBase + (across - 1) / 2);
    const score = doorAcross === 0 ? -Math.abs(middle) : -doorAcross * middle;
    if (score > bestScore) { bestScore = score; best = pair; }
  }
  if (!best) return null;

  // Which of the two the last flight ends in is a matter of parity, and the
  // last one has to be the ridge cell, so order them to come out right.
  const wantLast = ridgeCells
    ? (best.find(c => c >= ridgeCells[0] && c <= ridgeCells[1]) ?? best[0])
    : best[0];
  const other = wantLast === best[0] ? best[1] : best[0];
  const cols: [number, number] = (flights - 1) % 2 === 0 ? [wantLast, other] : [other, wantLast];
  return { axis, row, cols };
}

/** True when a cell is one of the two the stairwell's flights occupy. */
function inShaft(shaft: Shaft | null, gx: number, gz: number): boolean {
  if (!shaft) return false;
  const along = shaft.axis === 'x' ? gx : gz;
  const across = shaft.axis === 'x' ? gz : gx;
  return along === shaft.row && (across === shaft.cols[0] || across === shaft.cols[1]);
}

export function blueprintFor(b: Building, index: number): Blueprint {
  const rand = seeded(index * 7919 + b.x * 131 + b.z * 17 + 13);
  const x0 = b.x * TILE, z0 = b.z * TILE;
  const x1 = (b.x + b.w) * TILE, z1 = (b.z + b.d) * TILE;
  const trim = b.trim ?? 0xf1e9da;
  const side = b.door ?? 0;

  const floors: CellRef[] = [];
  const stairs: RampRef[] = [];
  const roofRamps: RampRef[] = [];
  const walls: WallRun[] = [];
  const rooms: Room[] = [];
  const solids: SolidBox[] = [];

  const pitched = b.roof === 'gable' || b.roof === 'hip' || b.roof === 'gambrel';
  // The ridge runs along the building's LONG axis, as a roof does. 'z' means the
  // ridge line runs north-south, so the roof slopes away in x and the cells with
  // headroom under it are the middle COLUMNS.
  const ridgeAxis: 'x' | 'z' | null = !pitched || b.roofless ? null : b.w >= b.d ? 'x' : 'z';
  const storeys = Math.max(1, b.floors);

  // Ridge columns (or rows): the strip with full headroom under a pitched roof.
  const ridgeSpan = ridgeAxis === null ? 0 : (ridgeAxis === 'z' ? b.w : b.d) % 2 === 0 ? 2 : 1;
  const ridgeFrom = ridgeAxis === 'z'
    ? b.x + Math.floor((b.w - ridgeSpan) / 2)
    : b.z + Math.floor((b.d - ridgeSpan) / 2);
  const ridgeWide = ridgeAxis === 'z' ? b.w >= 3 : b.d >= 3;

  /** Highest slab. Roofless walls stop at the top storey; everything else is capped. */
  const slabTop = b.roofless ? storeys - 1 : storeys;
  const flatRoof = b.roof === 'flat' && !b.roofless;

  // --- protected ground: the shaft, and an apron inside each entrance ------
  const faces: Array<{ axis: 'x' | 'z'; at: number; u0: number; u1: number; side: 0 | 1 | 2 | 3; cells: number; inward: number }> = [
    { axis: 'z', at: z0, u0: x0, u1: x1, side: 0, cells: b.w, inward: 1 },
    { axis: 'z', at: z1, u0: x0, u1: x1, side: 1, cells: b.w, inward: -1 },
    { axis: 'x', at: x0, u0: z0, u1: z1, side: 2, cells: b.d, inward: 1 },
    { axis: 'x', at: x1, u0: z0, u1: z1, side: 3, cells: b.d, inward: -1 },
  ];
  const doorFace = faces.find(f => f.side === side)!;
  // A back door, so no building is a one-way trap in a firefight.
  const backSide = (side === 0 ? 1 : side === 1 ? 0 : side === 2 ? 3 : 2) as 0 | 1 | 2 | 3;
  const backFace = faces.find(f => f.side === backSide)!;

  const apron = (face: typeof faces[number], u: number): Rect => {
    const reach = 4.0;
    return face.axis === 'z'
      ? { x0: u - 1.6, x1: u + 1.6, z0: Math.min(face.at, face.at + face.inward * reach), z1: Math.max(face.at, face.at + face.inward * reach) }
      : { z0: u - 1.6, z1: u + 1.6, x0: Math.min(face.at, face.at + face.inward * reach), x1: Math.max(face.at, face.at + face.inward * reach) };
  };

  // Flights needed to reach every walkable level, including the attic or the
  // flat roof deck. Worked out before the shaft, because which cell the last
  // flight lands in depends on how many there are.
  const wantFlights = (storeys - 1) + (b.attic && pitched && !b.roofless && ridgeWide ? 1 : 0) + (flatRoof ? 1 : 0);
  const shaft = chooseShaft(b, wantFlights, ridgeAxis, ridgeFrom, ridgeSpan, side);
  const hasAttic = !!b.attic && pitched && !b.roofless && ridgeWide && shaft !== null;

  // The doorway goes in the middle of its wall unless that would open straight
  // onto the side of a stair flight, which is a doorway you cannot walk through.
  const doorCell = (() => {
    const cells = doorFace.cells;
    const order = Array.from({ length: cells }, (_, i) => i)
      .sort((p, q) => Math.abs(p - (cells - 1) / 2) - Math.abs(q - (cells - 1) / 2));
    for (const c of order) {
      const gx = doorFace.axis === 'z' ? b.x + c : (side === 2 ? b.x : b.x + b.w - 1);
      const gz = doorFace.axis === 'z' ? (side === 0 ? b.z : b.z + b.d - 1) : b.z + c;
      if (!inShaft(shaft, gx, gz)) return c;
    }
    return Math.floor(cells / 2);
  })();
  const doorU = doorFace.u0 + (doorCell + 0.5) * TILE;
  const backCell = (() => {
    const cells = backFace.cells;
    const order = Array.from({ length: cells }, (_, i) => i)
      .sort((p, q) => Math.abs(p - doorCell) - Math.abs(q - doorCell));
    for (const c of order.reverse()) {
      const gx = backFace.axis === 'z' ? b.x + c : (backSide === 2 ? b.x : b.x + b.w - 1);
      const gz = backFace.axis === 'z' ? (backSide === 0 ? b.z : b.z + b.d - 1) : b.z + c;
      if (!inShaft(shaft, gx, gz)) return c;
    }
    return Math.floor(cells / 2);
  })();
  const backU = backFace.u0 + (backCell + 0.5) * TILE;
  const roomLevels = storeys + (hasAttic ? 1 : 0);
  const flights = shaft ? wantFlights : 0;

  // The stairwell, plus a landing at each end of it: no partition may be
  // planned across any of it or the climb is walled off from its own building.
  // A flight ends exactly on the cell line, and so does the foot of the flight
  // coming back the other way beside it, so the landing is a step ACROSS that
  // line rather than a walk out into the next room. Protecting a metre either
  // side of it is enough, and leaves a small house somewhere to put its rooms.
  const LANDING = 1.3;
  const shaftRect = shaft
    ? shaft.axis === 'x'
      ? {
        x0: shaft.row * TILE - LANDING, x1: (shaft.row + 1) * TILE + LANDING,
        z0: Math.min(shaft.cols[0], shaft.cols[1]) * TILE, z1: (Math.max(shaft.cols[0], shaft.cols[1]) + 1) * TILE,
      }
      : {
        z0: shaft.row * TILE - LANDING, z1: (shaft.row + 1) * TILE + LANDING,
        x0: Math.min(shaft.cols[0], shaft.cols[1]) * TILE, x1: (Math.max(shaft.cols[0], shaft.cols[1]) + 1) * TILE,
      }
    : null;

  // --- stair flights -------------------------------------------------------
  // Each flight rises one whole cell and the slab above it is left open, so a
  // climb from the ground floor to the roof never passes through a floor.
  const holes = new Set<string>();
  for (let level = 0; level < flights; level++) {
    const col = shaft!.cols[level % 2];
    const forward = level % 2 === 0;
    const gx = shaft!.axis === 'x' ? shaft!.row : col;
    const gz = shaft!.axis === 'x' ? col : shaft!.row;
    const facing: Facing = shaft!.axis === 'x' ? (forward ? 0 : 2) : (forward ? 1 : 3);
    stairs.push({ gx, gy: b.base + level, gz, facing });
    holes.add(`${gx},${b.base + level + 1},${gz}`);
  }

  // --- floor slabs ---------------------------------------------------------
  for (let level = 0; level <= slabTop; level++) {
    const gy = b.base + level;
    for (let dx = 0; dx < b.w; dx++) {
      for (let dz = 0; dz < b.d; dz++) {
        const gx = b.x + dx, gz = b.z + dz;
        if (holes.has(`${gx},${gy},${gz}`)) continue;
        // A mezzanine is a half floor: the rest of the level is open to below.
        if (b.mezzanine && level === 1 && dx < Math.ceil(b.w / 2)) continue;
        floors.push({ gx, gy, gz });
      }
    }
  }

  // --- rooms and interior partitions --------------------------------------
  const programme = PROGRAMME[b.archetype] ?? PROGRAMME.cottage;
  for (let level = 0; level < roomLevels; level++) {
    const y = (b.base + level) * TILE;
    const isAttic = hasAttic && level === storeys;
    const bounds: Rect = isAttic
      ? ridgeAxis === 'z'
        ? { x0: ridgeFrom * TILE + 0.35, x1: (ridgeFrom + ridgeSpan) * TILE - 0.35, z0: z0 + 0.35, z1: z1 - 0.35 }
        : { z0: ridgeFrom * TILE + 0.35, z1: (ridgeFrom + ridgeSpan) * TILE - 0.35, x0: x0 + 0.35, x1: x1 - 0.35 }
      : { x0: x0 + 0.35, z0: z0 + 0.35, x1: x1 - 0.35, z1: z1 - 0.35 };
    if (b.mezzanine && level === 1) bounds.x0 = (b.x + Math.ceil(b.w / 2)) * TILE + 0.35;

    const keep: Rect[] = [];
    if (shaftRect) keep.push(shaftRect);
    if (level === 0) {
      keep.push(apron(doorFace, doorU));
      keep.push(apron(backFace, backU));
    }

    const kinds: RoomKind[] = isAttic
      ? ['attic']
      : (programme[Math.min(level, programme.length - 1)] ?? ['empty']);
    const area = Math.max(0, (bounds.x1 - bounds.x0)) * Math.max(0, (bounds.z1 - bounds.z0));
    const depth = isAttic ? 1 : area > 420 ? 4 : area > 230 ? 3 : area > 110 ? 2 : 1;
    const open = b.archetype === 'warehouse' || b.archetype === 'barn' || b.archetype === 'chapel' || b.archetype === 'mill';
    const minSide = open ? 8.5 : 4.6;
    const plan = planRooms(bounds, keep, rand, minSide, depth);

    // Biggest room takes the programme's headline use.
    plan.rooms
      .map(r => ({ r, area: (r.x1 - r.x0) * (r.z1 - r.z0) }))
      .sort((p, q) => q.area - p.area)
      .forEach(({ r }, n) => {
        const kind = kinds[n % kinds.length] ?? 'empty';
        rooms.push({ level, kind, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, y, finish: FINISH[kind] });
      });

    const wallH = isAttic ? TILE - 1.6 : TILE - 0.3;
    for (const p of plan.walls) {
      walls.push({
        axis: p.axis, at: p.at, u0: p.u0, u1: p.u1, y, h: wallH, thick: 0.28,
        exterior: false, surface: open ? 'concrete' : 'plaster',
        color: open ? 0xbfc3c0 : 0xeae3d4, level,
        openings: [{ u: p.door, w: 2.0, sill: 0, top: 3.3, kind: 'door' }],
      });
    }
  }

  // --- exterior walls -----------------------------------------------------
  for (const f of faces) {
    for (let level = 0; level < roomLevels; level++) {
      const y = (b.base + level) * TILE;
      const isAttic = hasAttic && level === storeys;
      if (isAttic) {
        // Only the gable ends are walls up here; the long sides are roof.
        const gableEnd = ridgeAxis === 'z' ? f.axis === 'z' : f.axis === 'x';
        if (!gableEnd) continue;
        const from = ridgeFrom * TILE, to = (ridgeFrom + ridgeSpan) * TILE;
        walls.push({
          axis: f.axis, at: f.at, u0: from, u1: to, y, h: TILE, thick: 0.45,
          exterior: true, surface: b.surface, color: b.color, level,
          openings: [{ u: (from + to) / 2, w: 2.0, sill: 1.2, top: 3.6, kind: 'window' }],
        });
        continue;
      }
      const openings: Opening[] = [];
      for (let c = 0; c < f.cells; c++) {
        const u = f.u0 + (c + 0.5) * TILE;
        if (level === 0 && f.side === side && c === doorCell) {
          openings.push({ u, w: DOOR.w, sill: 0, top: DOOR.top, kind: 'door' });
          continue;
        }
        if (level === 0 && f.side === backSide && c === backCell) {
          openings.push({ u, w: DOOR.w, sill: 0, top: DOOR.top, kind: 'door' });
          continue;
        }
        if (b.archetype === 'bunker') {
          if (c % 2 === 0) openings.push({ u, w: SLIT.w, sill: SLIT.sill, top: SLIT.top, kind: 'window' });
          continue;
        }
        if (b.archetype === 'warehouse' && level === 0 && f.side !== side && f.side !== backSide && c % 2 === 1) {
          openings.push({ u, w: 5.0, sill: 0, top: 4.6, kind: 'garage' });
          continue;
        }
        if (b.storefront && level === 0) {
          openings.push({ u, w: SHOPFRONT.w, sill: SHOPFRONT.sill, top: SHOPFRONT.top, kind: 'shop' });
          continue;
        }
        if (b.archetype === 'chapel') {
          openings.push({ u, w: 1.8, sill: 1.4, top: 4.8, kind: 'arch' });
          continue;
        }
        if (b.roofless) {
          // A ruin is mostly holes; leave the wall broken rather than windowed.
          if (rand() < 0.45) openings.push({ u, w: 3.0 + rand() * 2, sill: rand() * 1.6, top: TILE, kind: 'arch' });
          continue;
        }
        // A blank panel here and there is what stops a facade reading as a
        // spreadsheet, so not every cell gets a window.
        if (rand() < 0.15) continue;
        const shape = b.archetype === 'apartment' || b.archetype === 'townhouse' ? TALL_WINDOW : WINDOW;
        openings.push({ u, w: shape.w, sill: shape.sill, top: shape.top, kind: 'window' });
      }
      walls.push({
        axis: f.axis, at: f.at, u0: f.u0, u1: f.u1, y, h: TILE, thick: 0.45,
        exterior: true, surface: b.surface, color: b.color, level, openings,
      });
    }
  }

  // --- roof ---------------------------------------------------------------
  const roofBase = b.base + slabTop;
  if (!b.roofless) {
    if (pitched) {
      for (let dx = 0; dx < b.w; dx++) {
        for (let dz = 0; dz < b.d; dz++) {
          const rx = Math.min(dx, b.w - 1 - dx);
          const rz = Math.min(dz, b.d - 1 - dz);
          const rise = b.roof === 'hip' ? Math.min(rx, rz) : ridgeAxis === 'z' ? rx : rz;
          let facing: Facing;
          if (b.roof === 'hip' && rz < rx) facing = dz < b.d / 2 ? 1 : 3;
          else if (ridgeAxis === 'z') facing = dx < b.w / 2 ? 0 : 2;
          else facing = dz < b.d / 2 ? 1 : 3;
          roofRamps.push({ gx: b.x + dx, gy: roofBase + rise, gz: b.z + dz, facing });
        }
      }
    } else if (b.roof === 'shed') {
      for (let dx = 0; dx < b.w; dx++) for (let dz = 0; dz < b.d; dz++) {
        roofRamps.push({ gx: b.x + dx, gy: roofBase + dz, gz: b.z + dz, facing: 1 });
      }
    } else if (flatRoof) {
      // Parapet, so the roof is a fighting platform rather than a bare ledge.
      const y = roofBase * TILE;
      for (const f of faces) {
        walls.push({
          axis: f.axis, at: f.at, u0: f.u0, u1: f.u1, y, h: 1.3, thick: 0.42,
          exterior: true, surface: b.surface, color: b.color, level: slabTop,
          openings: [], parapet: true,
        });
      }
    }
  }

  // --- balcony ------------------------------------------------------------
  if (b.balcony && storeys >= 2 && (side === 0 || side === 1)) {
    const y = (b.base + 1) * TILE;
    const reach = 2.8;
    const at = side === 0 ? z0 - reach : z1 + reach;
    const edge = side === 0 ? z0 : z1;
    const bx0 = Math.max(x0, doorU - TILE * 0.85), bx1 = Math.min(x1, doorU + TILE * 0.85);
    solids.push({
      x: (bx0 + bx1) / 2, y: y - 0.18, z: (at + edge) / 2,
      w: bx1 - bx0, h: 0.36, d: reach, surface: 'siding', color: trim,
    });
    walls.push({ axis: 'z', at, u0: bx0, u1: bx1, y, h: 1.2, thick: 0.2, exterior: true, surface: 'siding', color: trim, level: 1, openings: [], parapet: true });
    for (const ax of [bx0, bx1]) {
      walls.push({ axis: 'x', at: ax, u0: Math.min(at, edge), u1: Math.max(at, edge), y, h: 1.2, thick: 0.2, exterior: true, surface: 'siding', color: trim, level: 1, openings: [], parapet: true });
    }
    // A door out onto it, replacing whatever window was in that bay.
    const run = walls.find(w => w.exterior && w.level === 1 && w.axis === 'z' && Math.abs(w.at - edge) < 0.01 && !w.parapet);
    if (run) {
      run.openings = run.openings.filter(o => Math.abs(o.u - doorU) > TILE * 0.45);
      run.openings.push({ u: doorU, w: 2.2, sill: 0, top: 3.6, kind: 'door' });
    }
  }

  const entrance = doorFace.axis === 'z'
    ? { x: doorU, z: doorFace.at, side }
    : { x: doorFace.at, z: doorU, side };

  return {
    b, x0, z0, x1, z1, floors, stairs, roofRamps, walls, rooms, solids,
    shaft: shaftRect, topLevel: slabTop, entrance,
  };
}

/** World-space footprint of a building, optionally padded. */
export function footprintOf(b: Building, pad = 0): { x0: number; z0: number; x1: number; z1: number } {
  return { x0: b.x * TILE - pad, z0: b.z * TILE - pad, x1: (b.x + b.w) * TILE + pad, z1: (b.z + b.d) * TILE + pad };
}
