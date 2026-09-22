import * as THREE from 'three';
import { BUILDINGS, ROADS, SCENERY, terrainHeight, buildingFootprint, onRoad } from '@shared/map';
import { TILE } from '@shared/constants';
import { InstancedModel, type ModelLibrary, type ModelId } from './models';

/**
 * Everything in the world that is a real model rather than a box.
 *
 * The buildings here are not shells with art bolted on: they are made of the
 * same destructible grid pieces players build with, so they are open floor
 * plates with a doorway in the middle of the front and back walls, window
 * gaps every third cell, and a stairwell that alternates columns as it climbs.
 * Furniture has to be laid out around all of that, which is why this walks the
 * same cells buildArena does rather than dropping props at random and hoping.
 *
 * None of it collides. That is a deliberate first step, not an oversight: the
 * arena's doorways and stairwells are the only way through a building, and a
 * wardrobe that lands in one would turn a route the whole map depends on into
 * a dead end. The props that DO block -- the ones in map.ts -- keep their
 * bounds and simply get a model instead of a box.
 */
interface Placement { id: ModelId; x: number; y: number; z: number; yaw: number; }

/** Which wall of a cell a piece is pushed against. */
type Wall = 'x0' | 'x1' | 'z0' | 'z1';
/** Facing for each wall, so a piece always looks into the room. */
const FACING: Record<Wall, number> = { x0: Math.PI / 2, x1: -Math.PI / 2, z0: 0, z1: Math.PI };

/** Deterministic, so a building is furnished the same way every load. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * A themed set of furniture for one six-metre cell.
 *
 * Coordinates are local to the wall the cell is placed against: `along` runs
 * left-to-right across the wall from its centre and `into` runs into the room.
 * Writing it this way means one layout serves all four walls, and a piece can
 * never end up with its back to the room.
 */
interface Item { id: ModelId; along: number; into: number; turn?: number; }
const ROOMS: Record<string, Item[]> = {
  living: [
    { id: 'sofa', along: 0, into: 0.7 }, { id: 'rug', along: 0, into: 2.4 },
    { id: 'coffee_table', along: 0, into: 2.4 }, { id: 'floor_lamp', along: -1.9, into: 0.6 },
    { id: 'bookcase', along: 2.0, into: 0.5 }, { id: 'potted_plant', along: -2.3, into: 2.6 },
  ],
  lounge: [
    { id: 'sofa_long', along: -0.4, into: 0.8 }, { id: 'armchair', along: 2.0, into: 2.2, turn: -0.9 },
    { id: 'tv_cabinet', along: 0, into: 4.4, turn: Math.PI }, { id: 'tv', along: 0, into: 4.4, turn: Math.PI },
    { id: 'rug_round', along: 0.4, into: 2.6 }, { id: 'speaker', along: -2.2, into: 4.3 },
  ],
  kitchen: [
    { id: 'fridge', along: -2.2, into: 0.5 }, { id: 'stove', along: -1.0, into: 0.5 },
    { id: 'kitchen_sink', along: 0.0, into: 0.5 }, { id: 'cabinet', along: 1.0, into: 0.5 },
    { id: 'cabinet_drawer', along: 2.0, into: 0.5 }, { id: 'cabinet_upper', along: 1.0, into: 0.4 },
    { id: 'microwave', along: 2.0, into: 0.5 }, { id: 'coffee_machine', along: -1.0, into: 0.5 },
  ],
  dining: [
    { id: 'dining_table', along: 0, into: 2.6 },
    { id: 'chair', along: -1.1, into: 2.6, turn: Math.PI / 2 }, { id: 'chair', along: 1.1, into: 2.6, turn: -Math.PI / 2 },
    { id: 'chair', along: 0, into: 1.5 }, { id: 'chair', along: 0, into: 3.7, turn: Math.PI },
    { id: 'potted_plant', along: 2.3, into: 0.6 },
  ],
  bedroom: [
    { id: 'bed_double', along: 0, into: 1.6 }, { id: 'nightstand', along: -1.4, into: 0.5 },
    { id: 'table_lamp', along: -1.4, into: 0.5 }, { id: 'bookcase_closed', along: 2.1, into: 0.5 },
    { id: 'rug', along: 0, into: 3.6 },
  ],
  bunkroom: [
    { id: 'bed_bunk', along: -1.5, into: 1.5 }, { id: 'bed_single', along: 1.6, into: 1.5 },
    { id: 'nightstand', along: 0.1, into: 0.5 }, { id: 'coat_rack', along: 2.4, into: 0.6 },
  ],
  bathroom: [
    { id: 'bathtub', along: -1.4, into: 0.7 }, { id: 'toilet', along: 0.9, into: 0.6 },
    { id: 'bath_sink', along: 2.0, into: 0.5 }, { id: 'shower', along: -2.2, into: 2.6 },
  ],
  laundry: [
    { id: 'washer', along: -1.3, into: 0.6 }, { id: 'dryer', along: -0.3, into: 0.6 },
    { id: 'box_closed', along: 1.4, into: 0.7 }, { id: 'trashcan', along: 2.3, into: 0.6 },
  ],
  office: [
    { id: 'desk', along: 0, into: 0.8 }, { id: 'desk_chair', along: 0, into: 1.9, turn: Math.PI },
    { id: 'monitor', along: 0, into: 0.7 }, { id: 'laptop', along: 0.9, into: 0.9 },
    { id: 'bookcase', along: 2.1, into: 0.5 }, { id: 'trashcan', along: -2.1, into: 0.6 },
  ],
  storage: [
    { id: 'crate_large', along: -2.0, into: 0.7 }, { id: 'crate_wood', along: -0.9, into: 0.7 },
    { id: 'box_closed', along: -0.9, into: 1.7 }, { id: 'box_open', along: 0.2, into: 0.8 },
    { id: 'pallet', along: 1.6, into: 1.0 }, { id: 'barrel', along: 2.4, into: 0.6 },
  ],
  workshop: [
    { id: 'workbench', along: -1.4, into: 0.8 }, { id: 'barrel_open', along: 0.6, into: 0.7 },
    { id: 'planks', along: 2.0, into: 0.9, turn: Math.PI / 2 }, { id: 'chest', along: -2.6, into: 0.7 },
    { id: 'bucket', along: 1.4, into: 1.8 },
  ],
};

/** Room mix per building style, indexed by floor. Ground floors are public
 *  rooms because that is where a doorway puts you. */
const PLANS: Record<string, string[][]> = {
  house: [['living', 'kitchen', 'dining'], ['bedroom', 'bathroom', 'bunkroom']],
  cabin: [['lounge', 'kitchen', 'workshop'], ['bunkroom', 'storage']],
  city: [['lounge', 'office', 'dining'], ['office', 'bedroom', 'laundry'], ['office', 'storage', 'lounge']],
  warehouse: [['storage', 'workshop'], ['storage', 'office']],
};

export function createFurnishings(scene: THREE.Scene, models: ModelLibrary): number {
  const placements: Placement[] = [];
  furnishBuildings(placements);
  dressStreets(placements);
  dressYards(placements);
  buildCemetery(placements);
  return instance(scene, models, placements);
}

function furnishBuildings(out: Placement[]): void {
  BUILDINGS.forEach((b, index) => {
    const random = rng(0x9e3779b9 ^ (index * 2654435761));
    const plan = PLANS[b.style] ?? PLANS.house;
    const doorCol = Math.floor(b.w / 2);
    const stairCol = (level: number) => (level % 2 === 0 ? 0 : b.w - 1);

    for (let level = 0; level < b.floors; level++) {
      const y = (b.base + level) * TILE;
      const rooms = plan[Math.min(level, plan.length - 1)];
      for (let cx = 0; cx < b.w; cx++) for (let cz = 0; cz < b.d; cz++) {
        // The two things a player must always be able to use: the doorway on
        // the ground floor, and the stairwell on every floor. The flight
        // climbs from z=0 toward +Z, so the cell in front of it has to stay
        // clear as well or the first stride out of it walks into a wardrobe.
        if (level === 0 && cz === 0 && cx === doorCol) continue;
        if (level === 0 && cz === b.d - 1 && cx === doorCol) continue;
        if (cz <= 1 && cx === stairCol(level)) continue;
        if (level > 0 && cz <= 1 && cx === stairCol(level - 1)) continue;

        // Only cells against an outside wall are furnished. The middle of a
        // floor plate is where the fighting happens, and a room laid out in
        // open space with nothing to back onto reads as clutter.
        const walls: Wall[] = [];
        if (cx === 0) walls.push('x0');
        if (cx === b.w - 1) walls.push('x1');
        if (cz === 0) walls.push('z0');
        if (cz === b.d - 1) walls.push('z1');
        if (walls.length === 0) continue;

        const wall = walls[Math.floor(random() * walls.length)];
        const room = rooms[Math.floor(random() * rooms.length)];
        const cellX = (b.x + cx + 0.5) * TILE;
        const cellZ = (b.z + cz + 0.5) * TILE;
        for (const item of ROOMS[room]) {
          const jitter = (random() - 0.5) * 0.25;
          const { x, z } = fromWall(cellX, cellZ, wall, item.along + jitter, item.into);
          out.push({ id: item.id, x, y, z, yaw: FACING[wall] + (item.turn ?? 0) });
        }
        // A ceiling fixture, hung from the slab above rather than sat on the
        // floor -- the one thing in a room whose Y is not the floor's.
        if (random() < 0.45) {
          out.push({
            id: random() < 0.5 ? 'ceiling_fan' : 'ceiling_lamp',
            x: cellX, y: y + TILE - 0.5, z: cellZ, yaw: 0,
          });
        }
      }
    }
  });
}

/** World position of a local (along, into) offset against one wall of a cell. */
function fromWall(cx: number, cz: number, wall: Wall, along: number, into: number): { x: number; z: number } {
  const half = TILE / 2;
  switch (wall) {
    case 'x0': return { x: cx - half + into, z: cz + along };
    case 'x1': return { x: cx + half - into, z: cz - along };
    case 'z0': return { x: cx + along, z: cz - half + into };
    case 'z1': return { x: cx - along, z: cz + half - into };
  }
}

/**
 * Street furniture along the roads.
 *
 * Spaced by distance rather than dropped per road so a short spur and a
 * two-hundred-metre avenue end up with the same density, and offset to the
 * kerb rather than the centreline so nothing stands in the road.
 */
function dressStreets(out: Placement[]): void {
  const random = rng(0x5bf03635);
  ROADS.forEach((road, index) => {
    const dx = road.x2 - road.x1, dz = road.z2 - road.z1;
    const length = Math.hypot(dx, dz);
    if (length < 1) return;
    const ux = dx / length, uz = dz / length;
    // Perpendicular, for stepping out to the kerb.
    const px = -uz, pz = ux;
    const spacing = 26;
    for (let t = spacing * 0.5; t < length; t += spacing) {
      for (const side of [-1, 1]) {
        const kerb = road.width / 2 + 1.6;
        const x = road.x1 + ux * t + px * kerb * side;
        const z = road.z1 + uz * t + pz * kerb * side;
        if (insideBuilding(x, z, 2)) continue;
        const y = terrainHeight(x, z);
        if (y < 0.05) continue; // the lake, and the shoreline it eats
        // Lights face across the road; everything else faces along it.
        const across = Math.atan2(-px * side, -pz * side);
        const roll = random();
        if (roll < 0.5) {
          out.push({ id: index < 2 ? 'street_light_double' : 'street_light', x, y, z, yaw: across });
        } else if (roll < 0.66) {
          out.push({ id: 'street_bench', x, y, z, yaw: across });
        } else if (roll < 0.78) {
          out.push({ id: 'trashcan', x, y, z, yaw: across });
        } else if (roll < 0.86) {
          out.push({ id: 'dumpster', x, y, z, yaw: Math.atan2(ux, uz) });
        } else if (roll < 0.93) {
          out.push({ id: 'barrier', x, y, z, yaw: Math.atan2(ux, uz) });
        } else {
          out.push({ id: 'signpost', x, y, z, yaw: across });
        }
      }
    }
  });
}

/** True when a point is inside any building's footprint, with a margin. */
function insideBuilding(x: number, z: number, pad: number): boolean {
  return BUILDINGS.some(b => {
    const f = buildingFootprint(b, pad);
    return x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1;
  });
}

/**
 * Gardens, yards and the clutter that makes a district look inhabited.
 *
 * Placed around the outside of every building rather than only the houses:
 * a warehouse with pallets and barrels stacked against it reads as a working
 * building, and it is the same loop.
 */
function dressYards(out: Placement[]): void {
  const random = rng(0x2545f491);
  const domestic: ModelId[] = ['potted_plant', 'plant_small', 'street_bench', 'bucket', 'crate_wood'];
  const industrial: ModelId[] = ['pallet', 'pallet_small', 'barrel', 'barrel_open', 'crate_large', 'planks', 'dumpster'];
  BUILDINGS.forEach((b) => {
    const f = buildingFootprint(b);
    const y = b.base * TILE;
    const homely = b.style === 'house' || b.style === 'cabin';
    const set = homely ? domestic : industrial;
    for (let i = 0; i < (homely ? 7 : 9); i++) {
      // Along a random side, a metre or two out from the wall.
      const side = Math.floor(random() * 4);
      const out_ = 1.4 + random() * 2.2;
      const t = random();
      const x = side === 0 ? f.x0 - out_ : side === 1 ? f.x1 + out_ : f.x0 + (f.x1 - f.x0) * t;
      const z = side === 2 ? f.z0 - out_ : side === 3 ? f.z1 + out_ : f.z0 + (f.z1 - f.z0) * t;
      // Never in a doorway, and never in the street.
      const doorX = (b.x + Math.floor(b.w / 2) + 0.5) * TILE;
      if ((side === 2 || side === 3) && Math.abs(x - doorX) < 2.6) continue;
      if (onRoad(x, z, 1.5)) continue;
      out.push({ id: set[Math.floor(random() * set.length)], x, y, z, yaw: random() * Math.PI * 2 });
    }
  });
}

/**
 * A small cemetery on the wooded ridge.
 *
 * The map is four districts and a mesa, and every one of them is somewhere
 * people live or work. A named place with no building in it at all gives the
 * forest a reason to be crossed.
 */
const CEMETERY = { x: 52, z: 148, rows: 5, cols: 7 };
function buildCemetery(out: Placement[]): void {
  const random = rng(0x27d4eb2f);
  const stones: ModelId[] = ['gravestone', 'gravestone_cross', 'gravestone_round'];
  for (let r = 0; r < CEMETERY.rows; r++) for (let c = 0; c < CEMETERY.cols; c++) {
    const x = CEMETERY.x + (c - (CEMETERY.cols - 1) / 2) * 3.4 + (random() - 0.5) * 0.5;
    const z = CEMETERY.z + (r - (CEMETERY.rows - 1) / 2) * 4.2 + (random() - 0.5) * 0.5;
    if (insideBuilding(x, z, 3) || onRoad(x, z, 3)) continue;
    out.push({
      id: stones[Math.floor(random() * stones.length)],
      x, y: terrainHeight(x, z), z, yaw: Math.PI + (random() - 0.5) * 0.18,
    });
  }
  const halfX = (CEMETERY.cols * 3.4) / 2 + 2.6, halfZ = (CEMETERY.rows * 4.2) / 2 + 2.6;
  // Railings around it, with lamps at the corners and the crypt at the head.
  for (let s = -halfX; s <= halfX; s += 2) for (const side of [-1, 1]) {
    const x = CEMETERY.x + s, z = CEMETERY.z + halfZ * side;
    out.push({ id: 'iron_fence', x, y: terrainHeight(x, z), z, yaw: 0 });
  }
  for (let s = -halfZ; s <= halfZ; s += 2) for (const side of [-1, 1]) {
    const x = CEMETERY.x + halfX * side, z = CEMETERY.z + s;
    out.push({ id: 'iron_fence', x, y: terrainHeight(x, z), z, yaw: Math.PI / 2 });
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = CEMETERY.x + halfX * sx, z = CEMETERY.z + halfZ * sz;
    out.push({ id: 'lamp_post', x, y: terrainHeight(x, z), z, yaw: 0 });
  }
  out.push({ id: 'crypt', x: CEMETERY.x, y: terrainHeight(CEMETERY.x, CEMETERY.z - halfZ - 5), z: CEMETERY.z - halfZ - 5, yaw: 0 });
  for (const [dx, dz] of [[-6, 2], [7, -3], [-8, -6], [9, 6]]) {
    const x = CEMETERY.x + dx, z = CEMETERY.z + dz;
    out.push({ id: random() < 0.5 ? 'dead_tree' : 'pumpkin', x, y: terrainHeight(x, z), z, yaw: random() * 6.28 });
  }
  // Keep the trees generated in map.ts from growing through the railings.
  for (let i = SCENERY.length - 1; i >= 0; i--) {
    const s = SCENERY[i];
    if (Math.abs(s.x - CEMETERY.x) < halfX + 2 && Math.abs(s.z - CEMETERY.z) < halfZ + 6) SCENERY.splice(i, 1);
  }
}

/** One InstancedMesh set per model, so a thousand chairs cost one draw call. */
function instance(scene: THREE.Scene, models: ModelLibrary, placements: Placement[]): number {
  const byId = new Map<ModelId, Placement[]>();
  for (const p of placements) {
    const list = byId.get(p.id);
    if (list) list.push(p); else byId.set(p.id, [p]);
  }
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let placed = 0;
  for (const [id, list] of byId) {
    const source = models.get(id);
    if (!source) continue; // art missing: that prop simply is not there
    const batch = new InstancedModel(source, list.length);
    if (!batch.valid) continue;
    list.forEach((p, i) => {
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
      batch.setMatrixAt(i, matrix.compose(position.set(p.x, p.y, p.z), quaternion, one));
    });
    batch.addTo(scene);
    placed += list.length;
  }
  return placed;
}
