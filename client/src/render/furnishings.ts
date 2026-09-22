import * as THREE from 'three';
import { BUILDINGS, ROADS, SCENERY, terrainHeight, buildingFootprint, onRoad } from '@shared/map';
import { TILE } from '@shared/constants';
import { InstancedModel, type ModelLibrary, type ModelId } from './models';

interface Placement {
  id: ModelId;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface Item {
  id: ModelId;
  dx: number;
  dz: number;
  yOffset?: number;
  yaw: number;
}

// ---------------------------------------------------------------------------
// Room Sets: rich, fully dressed 6m x 6m layouts with proper vertical stacking
// ---------------------------------------------------------------------------

const LIVING_ROOM: Item[] = [
  // Seating & focal lounge
  { id: 'sofa_long', dx: -1.9, dz: 0.0, yaw: Math.PI / 2 },
  { id: 'armchair', dx: -0.2, dz: 1.9, yaw: Math.PI * 0.82 },
  { id: 'coffee_table', dx: -0.2, dz: 0.0, yaw: 0 },
  { id: 'rug', dx: -0.2, dz: 0.0, yaw: 0 },
  // Media center against opposite wall
  { id: 'tv_cabinet', dx: 2.1, dz: 0.0, yaw: -Math.PI / 2 },
  { id: 'tv', dx: 2.1, dz: 0.0, yOffset: 0.62, yaw: -Math.PI / 2 },
  { id: 'speaker', dx: 2.1, dz: -1.4, yaw: -Math.PI / 2 },
  { id: 'speaker', dx: 2.1, dz: 1.4, yaw: -Math.PI / 2 },
  // Storage, plants and lighting
  { id: 'bookcase', dx: -2.1, dz: -2.0, yaw: Math.PI / 2 },
  { id: 'books', dx: -2.1, dz: -2.0, yOffset: 0.77, yaw: Math.PI / 2 },
  { id: 'floor_lamp', dx: -2.2, dz: 2.1, yaw: 0 },
  { id: 'potted_plant', dx: 1.8, dz: 2.1, yaw: 0 },
  { id: 'ceiling_fan', dx: 0.0, dz: 0.0, yOffset: 5.45, yaw: 0 },
];

const KITCHEN_AND_DINING: Item[] = [
  // Full kitchen run along back wall
  { id: 'fridge_large', dx: -2.2, dz: -2.3, yaw: 0 },
  { id: 'kitchen_sink', dx: -1.2, dz: -2.3, yaw: 0 },
  { id: 'cabinet_drawer', dx: -0.2, dz: -2.3, yaw: 0 },
  { id: 'coffee_machine', dx: -0.2, dz: -2.3, yOffset: 0.90, yaw: 0 },
  { id: 'stove', dx: 0.8, dz: -2.3, yaw: 0 },
  { id: 'microwave', dx: 0.8, dz: -2.3, yOffset: 0.90, yaw: 0 },
  { id: 'cabinet', dx: 1.8, dz: -2.3, yaw: 0 },
  // Wall-mounted upper cabinets
  { id: 'cabinet_upper', dx: -1.2, dz: -2.3, yOffset: 1.95, yaw: 0 },
  { id: 'cabinet_upper', dx: 0.8, dz: -2.3, yOffset: 1.95, yaw: 0 },
  { id: 'cabinet_upper', dx: 1.8, dz: -2.3, yOffset: 1.95, yaw: 0 },
  { id: 'trashcan', dx: 2.4, dz: -1.5, yaw: 0 },
  // Dining suite
  { id: 'dining_table', dx: 0.0, dz: 1.2, yaw: 0 },
  { id: 'chair_cushion', dx: -0.9, dz: 0.8, yaw: Math.PI / 2 },
  { id: 'chair_cushion', dx: -0.9, dz: 1.6, yaw: Math.PI / 2 },
  { id: 'chair_cushion', dx: 0.9, dz: 0.8, yaw: -Math.PI / 2 },
  { id: 'chair_cushion', dx: 0.9, dz: 1.6, yaw: -Math.PI / 2 },
  { id: 'ceiling_lamp', dx: 0.0, dz: 1.2, yOffset: 5.25, yaw: 0 },
];

const MASTER_BEDROOM: Item[] = [
  // Bed suite
  { id: 'bed_double', dx: 0.0, dz: -1.6, yaw: 0 },
  { id: 'nightstand', dx: -1.6, dz: -2.2, yaw: 0 },
  { id: 'table_lamp', dx: -1.6, dz: -2.2, yOffset: 0.77, yaw: 0 },
  { id: 'nightstand', dx: 1.6, dz: -2.2, yaw: 0 },
  { id: 'table_lamp', dx: 1.6, dz: -2.2, yOffset: 0.77, yaw: 0 },
  { id: 'rug', dx: 0.0, dz: -0.5, yaw: 0 },
  // Wardrobe
  { id: 'bookcase_closed', dx: -2.2, dz: 1.2, yaw: Math.PI / 2 },
  // Study nook
  { id: 'desk', dx: 2.0, dz: 1.2, yaw: -Math.PI / 2 },
  { id: 'monitor', dx: 2.0, dz: 1.2, yOffset: 0.77, yaw: -Math.PI / 2 },
  { id: 'laptop', dx: 2.0, dz: 1.7, yOffset: 0.77, yaw: -Math.PI / 2 },
  { id: 'desk_chair', dx: 1.1, dz: 1.2, yaw: Math.PI / 2 },
  { id: 'potted_plant', dx: 2.2, dz: -2.2, yaw: 0 },
  { id: 'ceiling_fan', dx: 0.0, dz: 0.0, yOffset: 5.45, yaw: 0 },
];

const GUEST_BEDROOM: Item[] = [
  { id: 'bed_bunk', dx: -1.6, dz: -1.5, yaw: 0 },
  { id: 'bed_single', dx: 1.6, dz: -1.5, yaw: 0 },
  { id: 'nightstand', dx: 0.0, dz: -2.2, yaw: 0 },
  { id: 'table_lamp', dx: 0.0, dz: -2.2, yOffset: 0.77, yaw: 0 },
  { id: 'coat_rack', dx: 2.3, dz: 1.8, yaw: 0 },
  { id: 'round_table', dx: 0.0, dz: 1.2, yaw: 0 },
  { id: 'chair', dx: -0.7, dz: 1.2, yaw: Math.PI / 2 },
  { id: 'chair', dx: 0.7, dz: 1.2, yaw: -Math.PI / 2 },
  { id: 'rug_round', dx: 0.0, dz: 1.2, yaw: 0 },
  { id: 'box_closed', dx: -2.1, dz: 1.6, yaw: 0 },
  { id: 'box_open', dx: -1.4, dz: 1.6, yaw: 0 },
  { id: 'ceiling_lamp', dx: 0.0, dz: 0.0, yOffset: 5.25, yaw: 0 },
];

const BATHROOM_AND_LAUNDRY: Item[] = [
  { id: 'bathtub', dx: -1.6, dz: -1.8, yaw: 0 },
  { id: 'shower', dx: -2.1, dz: 1.4, yaw: Math.PI / 2 },
  { id: 'toilet', dx: 0.2, dz: -2.3, yaw: 0 },
  { id: 'bath_sink', dx: 1.8, dz: -2.3, yaw: 0 },
  { id: 'washer', dx: 1.8, dz: 1.2, yaw: -Math.PI / 2 },
  { id: 'dryer', dx: 1.8, dz: 2.1, yaw: -Math.PI / 2 },
  { id: 'trashcan', dx: 0.8, dz: -2.3, yaw: 0 },
  { id: 'box_closed', dx: 0.8, dz: 2.1, yaw: 0 },
  { id: 'ceiling_lamp', dx: 0.0, dz: 0.0, yOffset: 5.25, yaw: 0 },
];

const ENTRY_FOYER: Item[] = [
  // Doorway corridor (-1.0 < dx < 1.0, dz < 0) kept clear
  { id: 'bench_cushion', dx: 1.8, dz: -1.2, yaw: -Math.PI / 2 },
  { id: 'coat_rack', dx: 2.2, dz: -2.2, yaw: 0 },
  { id: 'rug_round', dx: 0.0, dz: -0.8, yaw: 0 },
  { id: 'potted_plant', dx: -2.2, dz: -2.2, yaw: 0 },
  { id: 'cabinet', dx: -2.2, dz: 0.5, yaw: Math.PI / 2 },
  { id: 'radio', dx: -2.2, dz: 0.5, yOffset: 0.90, yaw: Math.PI / 2 },
  { id: 'bookcase', dx: 2.2, dz: 1.2, yaw: -Math.PI / 2 },
  { id: 'ceiling_lamp', dx: 0.0, dz: -0.8, yOffset: 5.25, yaw: 0 },
];

const OFFICE_SUITE: Item[] = [
  { id: 'desk', dx: 0.0, dz: -0.5, yaw: 0 },
  { id: 'desk_chair', dx: 0.0, dz: -1.4, yaw: 0 },
  { id: 'monitor', dx: -0.3, dz: -0.5, yOffset: 0.77, yaw: 0 },
  { id: 'monitor', dx: 0.3, dz: -0.5, yOffset: 0.77, yaw: 0 },
  { id: 'laptop', dx: 0.8, dz: -0.5, yOffset: 0.77, yaw: 0 },
  { id: 'chair', dx: -0.8, dz: 0.8, yaw: Math.PI },
  { id: 'chair', dx: 0.8, dz: 0.8, yaw: Math.PI },
  { id: 'bookcase', dx: -2.2, dz: -1.5, yaw: Math.PI / 2 },
  { id: 'bookcase_closed', dx: -2.2, dz: 0.2, yaw: Math.PI / 2 },
  { id: 'books', dx: -2.2, dz: -1.5, yOffset: 0.77, yaw: Math.PI / 2 },
  { id: 'floor_lamp', dx: -2.2, dz: 1.8, yaw: 0 },
  { id: 'potted_plant', dx: 2.2, dz: 2.0, yaw: 0 },
  { id: 'trashcan', dx: -1.0, dz: -0.5, yaw: 0 },
  { id: 'ceiling_lamp', dx: 0.0, dz: 0.0, yOffset: 5.25, yaw: 0 },
];

const CAFE_LOUNGE: Item[] = [
  { id: 'kitchen_bar', dx: -1.8, dz: -2.0, yaw: 0 },
  { id: 'coffee_machine', dx: -1.8, dz: -2.0, yOffset: 0.90, yaw: 0 },
  { id: 'bar_stool', dx: -1.8, dz: -1.1, yaw: Math.PI },
  { id: 'bar_stool', dx: -1.0, dz: -1.1, yaw: Math.PI },
  { id: 'round_table', dx: 1.2, dz: -1.2, yaw: 0 },
  { id: 'chair', dx: 0.5, dz: -1.2, yaw: Math.PI / 2 },
  { id: 'chair', dx: 1.9, dz: -1.2, yaw: -Math.PI / 2 },
  { id: 'round_table', dx: 1.2, dz: 1.2, yaw: 0 },
  { id: 'chair', dx: 0.5, dz: 1.2, yaw: Math.PI / 2 },
  { id: 'chair', dx: 1.9, dz: 1.2, yaw: -Math.PI / 2 },
  { id: 'armchair_relax', dx: -1.8, dz: 1.5, yaw: Math.PI / 2 },
  { id: 'floor_lamp', dx: -2.2, dz: 2.2, yaw: 0 },
  { id: 'ceiling_fan', dx: 0.0, dz: 0.0, yOffset: 5.45, yaw: 0 },
];

const CABIN_HEARTH: Item[] = [
  { id: 'campfire', dx: 0.0, dz: 0.0, yaw: 0 },
  { id: 'log', dx: -1.6, dz: 0.0, yaw: Math.PI / 2 },
  { id: 'log', dx: 1.6, dz: 0.0, yaw: -Math.PI / 2 },
  { id: 'stump', dx: 0.0, dz: 1.6, yaw: 0 },
  { id: 'armchair_relax', dx: -1.8, dz: -1.8, yaw: Math.PI / 4 },
  { id: 'chest', dx: 2.0, dz: -1.8, yaw: -Math.PI / 2 },
  { id: 'bucket', dx: 2.2, dz: -1.0, yaw: 0 },
  { id: 'bed_double', dx: -1.6, dz: 1.8, yaw: Math.PI },
  { id: 'nightstand', dx: -0.3, dz: 2.2, yaw: Math.PI },
  { id: 'table_lamp', dx: -0.3, dz: 2.2, yOffset: 0.77, yaw: Math.PI },
  { id: 'workbench', dx: 1.8, dz: 1.6, yaw: -Math.PI / 2 },
  { id: 'barrel', dx: 2.2, dz: 0.5, yaw: 0 },
];

const WORKSHOP_WAREHOUSE: Item[] = [
  { id: 'workbench', dx: -1.6, dz: -2.0, yaw: 0 },
  { id: 'chest', dx: 0.6, dz: -2.2, yaw: 0 },
  { id: 'bucket', dx: 1.8, dz: -2.2, yaw: 0 },
  { id: 'pallet', dx: 1.8, dz: 0.0, yaw: 0 },
  { id: 'planks', dx: 1.8, dz: 0.0, yOffset: 0.18, yaw: 0 },
  { id: 'crate_large', dx: 1.8, dz: 1.6, yaw: 0 },
  { id: 'crate_wood', dx: 0.6, dz: 1.8, yaw: 0 },
  { id: 'barrel_open', dx: -2.0, dz: 1.2, yaw: 0 },
  { id: 'barrel', dx: -1.2, dz: 1.8, yaw: 0 },
  { id: 'dumpster_open', dx: -1.8, dz: -0.2, yaw: Math.PI / 2 },
  { id: 'ceiling_lamp', dx: 0.0, dz: 0.0, yOffset: 5.25, yaw: 0 },
];

export function createFurnishings(scene: THREE.Scene, models: ModelLibrary): number {
  const placements: Placement[] = [];
  furnishBuildings(placements);
  dressStreets(placements);
  dressYards(placements);
  buildCemetery(placements);
  return instance(scene, models, placements);
}

function furnishBuildings(out: Placement[]): void {
  BUILDINGS.forEach((b) => {
    for (let level = 0; level < b.floors; level++) {
      const baseY = (b.base + level) * TILE;
      const doorCol = Math.floor(b.w / 2);
      const stairCol = level % 2 === 0 ? 0 : b.w - 1;
      const hasStairs = level < b.floors - 1;

      for (let cx = 0; cx < b.w; cx++) {
        for (let cz = 0; cz < b.d; cz++) {
          const cellX = (b.x + cx + 0.5) * TILE;
          const cellZ = (b.z + cz + 0.5) * TILE;

          // Check if this specific cell contains the stair run
          const isStairCell = hasStairs && cx === stairCol && cz === 0;

          let roomItems: Item[];

          if (b.style === 'house') {
            if (level === 0) {
              if (cx === doorCol && cz === 0) {
                roomItems = ENTRY_FOYER;
              } else if (cx === 0 && cz === 0) {
                roomItems = isStairCell ? GUEST_BEDROOM : LIVING_ROOM;
              } else if (cz >= 1 && cx === 0) {
                roomItems = KITCHEN_AND_DINING;
              } else if (cz >= 1 && cx === 1) {
                roomItems = BATHROOM_AND_LAUNDRY;
              } else {
                roomItems = LIVING_ROOM;
              }
            } else {
              // Level 1+ upstairs
              if (cx === 0 && cz === 0) {
                roomItems = MASTER_BEDROOM;
              } else if (cx >= 1 && cz === 0) {
                roomItems = isStairCell ? OFFICE_SUITE : GUEST_BEDROOM;
              } else if (cz >= 1 && cx === 0) {
                roomItems = GUEST_BEDROOM;
              } else {
                roomItems = BATHROOM_AND_LAUNDRY;
              }
            }
          } else if (b.style === 'cabin') {
            roomItems = CABIN_HEARTH;
          } else if (b.style === 'warehouse') {
            roomItems = WORKSHOP_WAREHOUSE;
          } else {
            // City commercial / office block
            if (level === 0) {
              roomItems = (cx + cz) % 2 === 0 ? CAFE_LOUNGE : ENTRY_FOYER;
            } else {
              roomItems = (cx + cz) % 2 === 0 ? OFFICE_SUITE : MASTER_BEDROOM;
            }
          }

          // Place the items with exact world coordinates and vertical elevation
          for (const item of roomItems) {
            // If this is a stair cell, keep the stair run lane clear
            if (isStairCell && Math.abs(item.dx) < 1.0) continue;

            out.push({
              id: item.id,
              x: cellX + item.dx,
              y: baseY + (item.yOffset ?? 0),
              z: cellZ + item.dz,
              yaw: item.yaw,
            });
          }
        }
      }
    }
  });
}

/**
 * Street furniture along the roads.
 */
function dressStreets(out: Placement[]): void {
  ROADS.forEach((road, index) => {
    const dx = road.x2 - road.x1, dz = road.z2 - road.z1;
    const length = Math.hypot(dx, dz);
    if (length < 1) return;
    const ux = dx / length, uz = dz / length;
    const px = -uz, pz = ux;
    const spacing = 24;

    for (let t = spacing * 0.5; t < length; t += spacing) {
      for (const side of [-1, 1]) {
        const kerb = road.width / 2 + 1.5;
        const x = road.x1 + ux * t + px * kerb * side;
        const z = road.z1 + uz * t + pz * kerb * side;
        if (insideBuilding(x, z, 2.5)) continue;
        const y = terrainHeight(x, z);
        if (y < 0.05) continue;

        const across = Math.atan2(-px * side, -pz * side);
        const alongYaw = Math.atan2(ux, uz);
        const step = Math.floor(t / spacing);

        if (step % 5 === 0) {
          out.push({ id: index < 2 ? 'street_light_double' : 'street_light', x, y, z, yaw: across });
        } else if (step % 5 === 1) {
          out.push({ id: 'street_bench', x, y, z, yaw: across });
        } else if (step % 5 === 2) {
          out.push({ id: 'trashcan', x, y, z, yaw: across });
        } else if (step % 5 === 3) {
          out.push({ id: 'dumpster', x, y, z, yaw: alongYaw });
        } else {
          out.push({ id: 'signpost', x, y, z, yaw: across });
        }
      }
    }
  });
}

function insideBuilding(x: number, z: number, pad: number): boolean {
  return BUILDINGS.some(b => {
    const f = buildingFootprint(b, pad);
    return x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1;
  });
}

/**
 * Yards, back patios, and exterior district dressings.
 */
function dressYards(out: Placement[]): void {
  BUILDINGS.forEach((b) => {
    const f = buildingFootprint(b);
    const y = b.base * TILE;
    const doorX = (b.x + Math.floor(b.w / 2) + 0.5) * TILE;

    if (b.style === 'house') {
      // Front yard: planters and porch lighting
      out.push({ id: 'potted_plant', x: doorX - 2.2, y: y + 0.36, z: f.z0 - 1.2, yaw: 0 });
      out.push({ id: 'potted_plant', x: doorX + 2.2, y: y + 0.36, z: f.z0 - 1.2, yaw: 0 });

      // Back yard patio suite: outdoor table with parasol and patio chairs
      const patioX = (f.x0 + f.x1) / 2;
      const patioZ = f.z1 + 3.2;
      if (!onRoad(patioX, patioZ, 2.0)) {
        out.push({ id: 'round_table', x: patioX, y, z: patioZ, yaw: 0 });
        out.push({ id: 'parasol', x: patioX, y, z: patioZ, yaw: 0 });
        out.push({ id: 'chair', x: patioX - 1.1, y, z: patioZ, yaw: Math.PI / 2 });
        out.push({ id: 'chair', x: patioX + 1.1, y, z: patioZ, yaw: -Math.PI / 2 });
        out.push({ id: 'chair', x: patioX, y, z: patioZ - 1.1, yaw: 0 });
        out.push({ id: 'chair', x: patioX, y, z: patioZ + 1.1, yaw: Math.PI });
        out.push({ id: 'street_bench', x: patioX - 3.2, y, z: patioZ, yaw: Math.PI / 2 });
      }
    } else if (b.style === 'cabin') {
      // Campfire with log seats outside cabin
      const campX = f.x0 - 4.5;
      const campZ = (f.z0 + f.z1) / 2;
      if (!onRoad(campX, campZ, 2.0)) {
        out.push({ id: 'campfire', x: campX, y, z: campZ, yaw: 0 });
        out.push({ id: 'log', x: campX - 1.6, y, z: campZ, yaw: Math.PI / 2 });
        out.push({ id: 'log', x: campX + 1.6, y, z: campZ, yaw: -Math.PI / 2 });
        out.push({ id: 'stump', x: campX, y, z: campZ + 1.6, yaw: 0 });
        out.push({ id: 'bucket', x: campX + 2.2, y, z: campZ - 1.0, yaw: 0 });
        out.push({ id: 'tent', x: campX - 4.0, y, z: campZ + 2.0, yaw: 0.8 });
      }
    } else if (b.style === 'warehouse') {
      // Industrial loading yard
      const yardZ = f.z0 - 2.6;
      out.push({ id: 'pallet', x: f.x0 + 2.0, y, z: yardZ, yaw: 0 });
      out.push({ id: 'planks', x: f.x0 + 2.0, y: y + 0.18, z: yardZ, yaw: 0 });
      out.push({ id: 'crate_large', x: f.x0 + 4.5, y, z: yardZ, yaw: 0 });
      out.push({ id: 'crate_wood', x: f.x0 + 6.2, y, z: yardZ, yaw: 0 });
      out.push({ id: 'barrel_open', x: f.x1 - 2.0, y, z: yardZ, yaw: 0 });
      out.push({ id: 'barrel', x: f.x1 - 3.2, y, z: yardZ, yaw: 0 });
      out.push({ id: 'scaffold', x: f.x1 + 1.8, y, z: (f.z0 + f.z1) / 2, yaw: 0 });
    }
  });
}

/**
 * Landmark cemetery on the ridge.
 */
const CEMETERY = { x: 52, z: 148, rows: 5, cols: 7 };
function buildCemetery(out: Placement[]): void {
  const stones: ModelId[] = ['gravestone', 'gravestone_cross', 'gravestone_round'];
  for (let r = 0; r < CEMETERY.rows; r++) {
    for (let c = 0; c < CEMETERY.cols; c++) {
      const x = CEMETERY.x + (c - (CEMETERY.cols - 1) / 2) * 3.4;
      const z = CEMETERY.z + (r - (CEMETERY.rows - 1) / 2) * 4.2;
      if (insideBuilding(x, z, 3) || onRoad(x, z, 3)) continue;
      out.push({
        id: stones[(r * 7 + c) % stones.length],
        x,
        y: terrainHeight(x, z),
        z,
        yaw: Math.PI,
      });
    }
  }

  const halfX = (CEMETERY.cols * 3.4) / 2 + 2.6;
  const halfZ = (CEMETERY.rows * 4.2) / 2 + 2.6;

  // Railings around perimeter
  for (let s = -halfX; s <= halfX; s += 2) {
    for (const side of [-1, 1]) {
      const x = CEMETERY.x + s, z = CEMETERY.z + halfZ * side;
      out.push({ id: 'iron_fence', x, y: terrainHeight(x, z), z, yaw: 0 });
    }
  }
  for (let s = -halfZ; s <= halfZ; s += 2) {
    for (const side of [-1, 1]) {
      const x = CEMETERY.x + halfX * side, z = CEMETERY.z + s;
      out.push({ id: 'iron_fence', x, y: terrainHeight(x, z), z, yaw: Math.PI / 2 });
    }
  }
  // Corner lanterns and crypt
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = CEMETERY.x + halfX * sx, z = CEMETERY.z + halfZ * sz;
    out.push({ id: 'lamp_post', x, y: terrainHeight(x, z), z, yaw: 0 });
  }
  out.push({
    id: 'crypt',
    x: CEMETERY.x,
    y: terrainHeight(CEMETERY.x, CEMETERY.z - halfZ - 5),
    z: CEMETERY.z - halfZ - 5,
    yaw: 0,
  });

  for (const [dx, dz] of [[-6, 2], [7, -3], [-8, -6], [9, 6]]) {
    const x = CEMETERY.x + dx, z = CEMETERY.z + dz;
    out.push({ id: 'dead_tree', x, y: terrainHeight(x, z), z, yaw: 0 });
    out.push({ id: 'pumpkin', x: x + 1.2, y: terrainHeight(x + 1.2, z + 0.8), z: z + 0.8, yaw: 0.5 });
  }

  for (let i = SCENERY.length - 1; i >= 0; i--) {
    const s = SCENERY[i];
    if (Math.abs(s.x - CEMETERY.x) < halfX + 2 && Math.abs(s.z - CEMETERY.z) < halfZ + 6) {
      SCENERY.splice(i, 1);
    }
  }
}

/**
 * GPU Instanced batching: thousands of props drawn in ~30 draw calls total.
 */
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
    if (!source) continue;
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
