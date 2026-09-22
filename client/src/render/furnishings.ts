import * as THREE from 'three';
import { BUILDINGS, ROADS, SCENERY, DOCK, LAKE_SHAPE, terrainHeight, buildingFootprint, onRoad } from '@shared/map';
import { TILE } from '@shared/constants';
import { InstancedModel, type ModelLibrary, type ModelId } from './models';

export interface Placement {
  id: ModelId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale?: number;
}

export function createFurnishings(scene: THREE.Scene, models: ModelLibrary): number {
  const placements: Placement[] = [];
  furnishKeyPoints(placements);
  dressStreets(placements);
  dressYards(placements);
  dressSkylineCity(placements);
  dressTidalWorksHarbor(placements);
  dressPinewatchRidge(placements);
  dressTheCitadel(placements);
  dressIntermediateOutposts(placements);
  buildCemetery(placements);
  dressWildernessLandmarks(placements);
  dressNaturalFoliage(placements);
  dressExplorationSecrets(placements);
  dressMountainTrails(placements);
  dressLandmarkPoiInteriors(placements);
  return instance(scene, models, placements);
}

/** Check if a point falls within any building footprint with an optional padding. */
function insideBuilding(x: number, z: number, pad = 0): boolean {
  return BUILDINGS.some(b => {
    const f = buildingFootprint(b, pad);
    return x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1;
  });
}

/** Keep door approaches clear so navigation and player movement are never obstructed. */
function nearDoorway(x: number, z: number, pad = 2.4): boolean {
  return BUILDINGS.some(b => {
    const doorX = (b.x + Math.floor(b.w / 2) + 0.5) * TILE;
    const f = buildingFootprint(b);
    return Math.abs(x - doorX) < pad && (Math.abs(z - f.z0) < pad || Math.abs(z - f.z1) < pad);
  });
}

/** Check if a point is within the lake boundary. */
function inLake(x: number, z: number, pad = 0): boolean {
  const dx = (x - LAKE_SHAPE.x) / (LAKE_SHAPE.rx + pad);
  const dz = (z - LAKE_SHAPE.z) / (LAKE_SHAPE.rz + pad);
  return dx * dx + dz * dz < 1;
}

/**
 * Detailed, lived-in indoor furnishings and rooftops.
 * Items are placed strictly against interior walls and in corners, keeping
 * the central doorway corridors and stairwells completely open for fluid combat.
 */
function furnishKeyPoints(out: Placement[]): void {
  BUILDINGS.forEach((b, bIdx) => {
    const x0 = b.x * TILE, z0 = b.z * TILE;
    const wM = b.w * TILE, dM = b.d * TILE;
    const y0 = b.base * TILE;

    if (b.style === 'house') {
      // --- Ground Floor: Living Room & Kitchen ---
      // Living room zone in the far corner (+X, +Z)
      out.push({ id: bIdx % 2 === 0 ? 'sofa_long' : 'sofa', x: x0 + wM - 1.4, y: y0, z: z0 + dM - 1.2, yaw: Math.PI });
      out.push({ id: bIdx % 2 === 0 ? 'coffee_table_glass' : 'coffee_table', x: x0 + wM - 1.4, y: y0, z: z0 + dM - 2.5, yaw: Math.PI });
      out.push({ id: 'rug', x: x0 + wM - 1.4, y: y0 + 0.01, z: z0 + dM - 2.5, yaw: 0 });
      out.push({ id: 'tv_cabinet', x: x0 + wM - 0.6, y: y0, z: z0 + dM - 2.5, yaw: -Math.PI / 2 });
      out.push({ id: bIdx % 2 === 0 ? 'tv' : 'tv_vintage', x: x0 + wM - 0.6, y: y0 + 0.62, z: z0 + dM - 2.5, yaw: -Math.PI / 2 });
      out.push({ id: 'floor_lamp', x: x0 + wM - 0.6, y: y0, z: z0 + dM - 0.8, yaw: 0 });
      out.push({ id: 'bookcase', x: x0 + wM - 0.6, y: y0, z: z0 + 1.6, yaw: -Math.PI / 2 });
      out.push({ id: 'books', x: x0 + wM - 0.6, y: y0 + 0.88, z: z0 + 1.6, yaw: -Math.PI / 2 });
      out.push({ id: bIdx % 2 === 0 ? 'speaker' : 'radio', x: x0 + wM - 0.6, y: y0, z: z0 + dM - 3.8, yaw: -Math.PI / 2 });

      // Kitchen zone near side (-X, +Z)
      out.push({ id: 'fridge_large', x: x0 + 1.2, y: y0, z: z0 + dM - 1.0, yaw: 0 });
      out.push({ id: 'kitchen_sink', x: x0 + 2.4, y: y0, z: z0 + dM - 0.8, yaw: 0 });
      out.push({ id: 'stove', x: x0 + 3.6, y: y0, z: z0 + dM - 0.8, yaw: 0 });
      out.push({ id: 'coffee_machine', x: x0 + 2.4, y: y0 + 0.98, z: z0 + dM - 0.8, yaw: 0 });
      out.push({ id: 'cabinet_upper', x: x0 + 3.6, y: y0 + 2.0, z: z0 + dM - 0.4, yaw: 0 });

      // --- Second Floor (Bedrooms & Bathrooms) ---
      if (b.floors > 1) {
        const y1 = (b.base + 1) * TILE;
        // Master Bedroom
        out.push({ id: 'bed_double', x: x0 + 1.8, y: y1, z: z0 + dM - 1.6, yaw: 0 });
        out.push({ id: 'nightstand', x: x0 + 0.6, y: y1, z: z0 + dM - 1.6, yaw: Math.PI / 2 });
        out.push({ id: 'table_lamp', x: x0 + 0.6, y: y1 + 0.77, z: z0 + dM - 1.6, yaw: 0 });
        out.push({ id: 'rug_round', x: x0 + 1.8, y: y1 + 0.01, z: z0 + dM - 3.2, yaw: 0 });
        out.push({ id: 'coat_rack', x: x0 + 0.6, y: y1, z: z0 + dM - 3.2, yaw: 0 });

        // Kids / Guest Room or Study
        out.push({ id: 'desk', x: x0 + wM - 1.4, y: y1, z: z0 + 1.6, yaw: 0 });
        out.push({ id: 'desk_chair', x: x0 + wM - 1.4, y: y1, z: z0 + 2.4, yaw: Math.PI });
        out.push({ id: 'laptop', x: x0 + wM - 1.4, y: y1 + 0.77, z: z0 + 1.6, yaw: 0 });
        out.push({ id: 'chest', x: x0 + wM - 1.2, y: y1, z: z0 + dM - 1.2, yaw: -Math.PI / 4 });

        // Bathroom fixtures
        out.push({ id: 'bathtub', x: x0 + 1.4, y: y1, z: z0 + 2.0, yaw: Math.PI / 2 });
        out.push({ id: 'toilet', x: x0 + 2.8, y: y1, z: z0 + 1.0, yaw: 0 });
        out.push({ id: 'bath_sink', x: x0 + 4.0, y: y1, z: z0 + 1.0, yaw: 0 });
        out.push({ id: 'washer', x: x0 + wM - 1.2, y: y1, z: z0 + dM - 3.0, yaw: -Math.PI / 2 });
      }
    } else if (b.style === 'city') {
      // --- Skyline City High-Rise Interiors & Rooftops ---
      // Ground Floor: Corporate reception & lobby
      out.push({ id: 'desk', x: x0 + 1.6, y: y0, z: z0 + dM / 2, yaw: Math.PI / 2 });
      out.push({ id: 'desk_chair', x: x0 + 0.9, y: y0, z: z0 + dM / 2, yaw: Math.PI / 2 });
      out.push({ id: 'monitor', x: x0 + 1.6, y: y0 + 0.77, z: z0 + dM / 2, yaw: Math.PI / 2 });
      out.push({ id: 'laptop', x: x0 + 1.6, y: y0 + 0.77, z: z0 + dM / 2 + 0.45, yaw: Math.PI / 2 });
      out.push({ id: 'potted_plant', x: x0 + 0.8, y: y0, z: z0 + dM - 1.0, yaw: 0 });

      // Waiting lounge in lobby
      out.push({ id: 'sofa_corner', x: x0 + wM - 1.8, y: y0, z: z0 + dM - 1.8, yaw: Math.PI });
      out.push({ id: 'coffee_table_glass', x: x0 + wM - 2.2, y: y0, z: z0 + dM - 2.8, yaw: Math.PI });
      out.push({ id: 'bookcase_closed', x: x0 + wM - 0.7, y: y0, z: z0 + 1.8, yaw: -Math.PI / 2 });
      out.push({ id: 'books', x: x0 + wM - 0.7, y: y0 + 0.9, z: z0 + 1.8, yaw: -Math.PI / 2 });
      out.push({ id: 'trashcan', x: x0 + 0.6, y: y0, z: z0 + 1.2, yaw: 0 });

      // Middle floors: Office work desks
      for (let floor = 1; floor < b.floors; floor++) {
        const yF = (b.base + floor) * TILE;
        out.push({ id: 'desk', x: x0 + 1.6, y: yF, z: z0 + dM - 2.0, yaw: 0 });
        out.push({ id: 'desk_chair', x: x0 + 1.6, y: yF, z: z0 + dM - 2.8, yaw: Math.PI });
        out.push({ id: 'monitor', x: x0 + 1.6, y: yF + 0.77, z: z0 + dM - 2.0, yaw: 0 });
        out.push({ id: 'cabinet_drawer', x: x0 + 0.6, y: yF, z: z0 + dM - 2.0, yaw: Math.PI / 2 });
        out.push({ id: 'armchair', x: x0 + wM - 1.4, y: yF, z: z0 + dM - 1.4, yaw: Math.PI });
        out.push({ id: 'coffee_machine', x: x0 + wM - 0.7, y: yF + 0.9, z: z0 + 2.0, yaw: -Math.PI / 2 });
        out.push({ id: 'fridge', x: x0 + wM - 0.7, y: yF, z: z0 + 2.0, yaw: -Math.PI / 2 });
        out.push({ id: 'chest', x: x0 + wM - 1.2, y: yF, z: z0 + 1.2, yaw: -Math.PI / 4 });
      }

      // --- High-Rise Rooftop Terraces (The Ultimate High-Ground Arena) ---
      const roofY = (b.base + b.floors) * TILE;
      // Rooftop Penthouse Chill Zone
      out.push({ id: 'sofa_long', x: x0 + 2.2, y: roofY, z: z0 + dM - 2.0, yaw: Math.PI });
      out.push({ id: 'coffee_table_glass', x: x0 + 2.2, y: roofY, z: z0 + dM - 3.2, yaw: Math.PI });
      out.push({ id: 'parasol', x: x0 + 2.2, y: roofY, z: z0 + dM - 3.2, yaw: 0 });
      out.push({ id: 'chair_cushion', x: x0 + 1.0, y: roofY, z: z0 + dM - 3.2, yaw: Math.PI / 2 });
      out.push({ id: 'chair_cushion', x: x0 + 3.4, y: roofY, z: z0 + dM - 3.2, yaw: -Math.PI / 2 });
      out.push({ id: 'potted_plant', x: x0 + 0.8, y: roofY, z: z0 + dM - 0.8, yaw: 0 });
      out.push({ id: 'speaker', x: x0 + 3.8, y: roofY, z: z0 + dM - 0.8, yaw: 0 });

      // Rooftop staging / sniper nest
      out.push({ id: 'scaffold', x: x0 + wM - 2.2, y: roofY, z: z0 + 2.2, yaw: 0 });
      out.push({ id: 'planks', x: x0 + wM - 3.8, y: roofY + 0.1, z: z0 + 2.0, yaw: 0.2 });
      out.push({ id: 'pallet', x: x0 + wM - 3.8, y: roofY, z: z0 + 2.0, yaw: 0 });
      out.push({ id: 'barrier', x: x0 + wM - 1.2, y: roofY, z: z0 + dM / 2, yaw: Math.PI / 2 });
      out.push({ id: 'chest', x: x0 + wM - 1.4, y: roofY, z: z0 + 1.2, yaw: -Math.PI / 4 });
      out.push({ id: 'radio', x: x0 + wM - 2.2, y: roofY + 2.0, z: z0 + 2.2, yaw: 0 });
    } else if (b.style === 'warehouse') {
      // --- Tidal Works Industrial Warehouses ---
      out.push({ id: 'pallet', x: x0 + 1.6, y: y0, z: z0 + dM - 1.6, yaw: 0 });
      out.push({ id: 'crate_large', x: x0 + 1.6, y: y0, z: z0 + dM - 1.6, yaw: 0 });
      out.push({ id: 'crate_wood', x: x0 + 1.6, y: y0 + 1.0, z: z0 + dM - 1.6, yaw: 0.1 });
      out.push({ id: 'pallet_small', x: x0 + 3.2, y: y0, z: z0 + dM - 1.6, yaw: 0.4 });
      out.push({ id: 'planks', x: x0 + 3.2, y: y0 + 0.2, z: z0 + dM - 1.6, yaw: 0.4 });

      // Heavy workshop bay
      out.push({ id: 'workbench', x: x0 + wM - 1.8, y: y0, z: z0 + 1.8, yaw: -Math.PI / 2 });
      out.push({ id: 'bucket', x: x0 + wM - 1.0, y: y0, z: z0 + 2.8, yaw: 0 });
      out.push({ id: 'barrel_open', x: x0 + wM - 1.2, y: y0, z: z0 + dM - 1.2, yaw: 0 });
      out.push({ id: 'barrel', x: x0 + wM - 2.0, y: y0, z: z0 + dM - 1.2, yaw: 0 });
      out.push({ id: 'chest', x: x0 + wM - 1.2, y: y0, z: z0 + dM - 2.2, yaw: 0 });
      out.push({ id: 'radio', x: x0 + wM - 1.8, y: y0 + 1.28, z: z0 + 1.8, yaw: -Math.PI / 2 });

      // Warehouse break room corner
      out.push({ id: 'desk', x: x0 + 1.6, y: y0, z: z0 + 1.6, yaw: 0 });
      out.push({ id: 'desk_chair', x: x0 + 1.6, y: y0, z: z0 + 2.4, yaw: Math.PI });
      out.push({ id: 'coffee_machine', x: x0 + 1.6, y: y0 + 0.77, z: z0 + 1.6, yaw: 0 });
      out.push({ id: 'fridge', x: x0 + 0.7, y: y0, z: z0 + 3.2, yaw: Math.PI / 2 });
      out.push({ id: 'trashcan', x: x0 + 2.8, y: y0, z: z0 + 1.2, yaw: 0 });
    } else if (b.style === 'cabin') {
      // --- Alpine & Intermediate Cabins ---
      out.push({ id: 'bed_bunk', x: x0 + 1.4, y: y0, z: z0 + dM - 1.6, yaw: 0 });
      out.push({ id: 'nightstand', x: x0 + 0.6, y: y0, z: z0 + dM - 1.6, yaw: Math.PI / 2 });
      out.push({ id: 'table_lamp', x: x0 + 0.6, y: y0 + 0.77, z: z0 + dM - 1.6, yaw: 0 });

      // Hearth / rustic study corner
      out.push({ id: 'log', x: x0 + wM - 1.4, y: y0, z: z0 + dM - 1.6, yaw: Math.PI / 2 });
      out.push({ id: 'stump', x: x0 + wM - 1.4, y: y0, z: z0 + dM - 2.8, yaw: 0 });
      out.push({ id: 'chest', x: x0 + wM - 1.2, y: y0, z: z0 + 1.4, yaw: -Math.PI / 4 });
      out.push({ id: 'workbench', x: x0 + 1.6, y: y0, z: z0 + 1.6, yaw: 0 });
      out.push({ id: 'radio', x: x0 + 1.6, y: y0 + 1.28, z: z0 + 1.6, yaw: 0 });
      out.push({ id: 'bucket', x: x0 + 0.6, y: y0, z: z0 + 2.8, yaw: 0 });
    }
  });
}

/**
 * Street furniture along every road, with boulevard lighting, traffic signals,
 * pedestrian benches, trash cans, and dumpster stations.
 */
function dressStreets(out: Placement[]): void {
  ROADS.forEach((road, index) => {
    const dx = road.x2 - road.x1, dz = road.z2 - road.z1;
    const length = Math.hypot(dx, dz);
    if (length < 1) return;
    const ux = dx / length, uz = dz / length;
    const px = -uz, pz = ux;
    const spacing = 18; // Denser and richer roadside streetscape

    for (let t = spacing * 0.4; t < length - 6; t += spacing) {
      for (const side of [-1, 1]) {
        const kerb = road.width / 2 + 1.6;
        const x = road.x1 + ux * t + px * kerb * side;
        const z = road.z1 + uz * t + pz * kerb * side;
        if (insideBuilding(x, z, 2.5) || nearDoorway(x, z, 3.0) || inLake(x, z, 1.0)) continue;
        const y = terrainHeight(x, z);
        if (y < 0.05) continue;

        const across = Math.atan2(-px * side, -pz * side);
        const alongYaw = Math.atan2(ux, uz);
        const step = Math.floor(t / spacing);

        if (step % 6 === 0) {
          out.push({ id: index < 2 ? 'street_light_double' : 'street_light', x, y, z, yaw: across });
        } else if (step % 6 === 1) {
          out.push({ id: 'street_bench', x, y, z, yaw: across });
        } else if (step % 6 === 2) {
          out.push({ id: 'trashcan', x, y, z, yaw: across });
          out.push({ id: 'plant_small', x: x + px * 0.8 * side, y, z: z + pz * 0.8 * side, yaw: 0 });
        } else if (step % 6 === 3) {
          out.push({ id: step % 2 === 0 ? 'dumpster' : 'dumpster_open', x, y, z, yaw: alongYaw });
        } else if (step % 6 === 4) {
          out.push({ id: 'signpost', x, y, z, yaw: across });
        } else {
          // Roadside barrier / guard rail on steep or open segments
          out.push({ id: 'barrier_strong', x, y, z, yaw: alongYaw });
        }
      }
    }
  });

  // Major road intersections get traffic lights
  const intersections = [
    { x: 0, z: 0 },
    { x: -108, z: -108 },
    { x: 108, z: -108 },
    { x: -108, z: 108 },
    { x: 108, z: 108 },
    { x: 0, z: -108 },
    { x: 0, z: 108 },
    { x: -108, z: 0 },
    { x: 108, z: 0 },
  ];
  for (const { x, z } of intersections) {
    for (const [ox, oz, yaw] of [[-7, -7, 0.8], [7, -7, -0.8], [-7, 7, 2.4], [7, 7, -2.4]]) {
      const ix = x + ox, iz = z + oz;
      if (!insideBuilding(ix, iz, 2.5) && !nearDoorway(ix, iz, 3.0) && !inLake(ix, iz, 1.0)) {
        const iy = terrainHeight(ix, iz);
        if (iy > 0.05) out.push({ id: 'traffic_light', x: ix, y: iy, z: iz, yaw });
      }
    }
  }
}

/**
 * Sunny Meadows suburban yards, front porches, garden fences and back patios.
 */
function dressYards(out: Placement[]): void {
  BUILDINGS.filter(b => b.style === 'house').forEach((b, idx) => {
    const f = buildingFootprint(b);
    const y = b.base * TILE;
    const doorX = (b.x + Math.floor(b.w / 2) + 0.5) * TILE;

    // --- Front Porch & Entrance Garden ---
    out.push({ id: 'potted_plant', x: doorX - 2.4, y: y + 0.36, z: f.z0 - 1.2, yaw: 0 });
    out.push({ id: 'potted_plant', x: doorX + 2.4, y: y + 0.36, z: f.z0 - 1.2, yaw: 0 });
    out.push({ id: 'bench_cushion', x: doorX - 3.4, y, z: f.z0 - 1.2, yaw: 0 });
    out.push({ id: 'pumpkin', x: doorX + 1.8, y, z: f.z0 - 1.0, yaw: 0.4 });
    out.push({ id: 'awning', x: doorX, y: y + 3.0, z: f.z0 - 0.2, yaw: 0 });

    // Front yard decorative iron fence running along the flank
    for (let s = -2; s <= 2; s += 2.0) {
      const fx = doorX - 4.5;
      const fz = f.z0 - 2.5 + s;
      if (!nearDoorway(fx, fz, 2.0) && !onRoad(fx, fz, 1.5)) {
        out.push({ id: 'iron_fence', x: fx, y: terrainHeight(fx, fz), z: fz, yaw: Math.PI / 2 });
      }
    }

    // --- Backyard Patio, BBQ, and Dining ---
    const patioX = (f.x0 + f.x1) / 2 + (idx % 2 === 0 ? 1.5 : -1.5);
    const patioZ = f.z1 + 3.5;
    if (!onRoad(patioX, patioZ, 2.0) && !nearDoorway(patioX, patioZ, 2.2)) {
      out.push({ id: 'dining_table', x: patioX, y, z: patioZ, yaw: 0 });
      out.push({ id: 'parasol', x: patioX, y, z: patioZ, yaw: 0 });
      out.push({ id: 'chair_cushion', x: patioX - 1.2, y, z: patioZ, yaw: Math.PI / 2 });
      out.push({ id: 'chair_cushion', x: patioX + 1.2, y, z: patioZ, yaw: -Math.PI / 2 });

      // Backyard campfire / firepit & log benches
      const fireX = patioX + 3.2;
      const fireZ = patioZ + 1.2;
      if (!onRoad(fireX, fireZ, 1.5)) {
        out.push({ id: 'campfire', x: fireX, y, z: fireZ, yaw: 0 });
        out.push({ id: 'log', x: fireX - 1.4, y, z: fireZ, yaw: Math.PI / 2 });
        out.push({ id: 'log', x: fireX + 1.4, y, z: fireZ, yaw: -Math.PI / 2 });
        out.push({ id: 'stump', x: fireX, y, z: fireZ + 1.4, yaw: 0 });
      }
    }
  });
}

/**
 * Skyline City: Storefront cafes, urban back alleys, construction scaffolds,
 * dumpsters, and modern streetscapes.
 */
function dressSkylineCity(out: Placement[]): void {
  BUILDINGS.filter(b => b.style === 'city' && b.x < 0).forEach((b) => {
    const f = buildingFootprint(b);
    const y = b.base * TILE;
    const doorX = (b.x + Math.floor(b.w / 2) + 0.5) * TILE;

    // --- Sidewalk Cafe & Storefront ---
    const cafeX = f.x1 + 2.4;
    const cafeZ = (f.z0 + f.z1) / 2;
    if (!onRoad(cafeX, cafeZ, 1.0) && !nearDoorway(cafeX, cafeZ, 2.4)) {
      out.push({ id: 'round_table', x: cafeX, y, z: cafeZ, yaw: 0 });
      out.push({ id: 'parasol', x: cafeX, y, z: cafeZ, yaw: 0 });
      out.push({ id: 'chair_cushion', x: cafeX - 0.9, y, z: cafeZ, yaw: Math.PI / 2 });
      out.push({ id: 'chair_cushion', x: cafeX + 0.9, y, z: cafeZ, yaw: -Math.PI / 2 });
      out.push({ id: 'potted_plant', x: cafeX, y, z: cafeZ - 1.8, yaw: 0 });
      out.push({ id: 'awning_wide', x: f.x1 + 0.2, y: y + 3.2, z: cafeZ, yaw: Math.PI / 2 });
    }

    // --- Service Alley & Backlot ---
    const alleyX = f.x0 - 2.8;
    const alleyZ = (f.z0 + f.z1) / 2;
    if (!nearDoorway(alleyX, alleyZ, 2.4)) {
      out.push({ id: 'dumpster_open', x: alleyX, y, z: alleyZ - 2.0, yaw: Math.PI / 2 });
      out.push({ id: 'dumpster', x: alleyX, y, z: alleyZ + 2.0, yaw: Math.PI / 2 });
      out.push({ id: 'trashcan', x: alleyX + 0.8, y, z: alleyZ, yaw: 0 });
      out.push({ id: 'pallet', x: alleyX, y, z: alleyZ, yaw: 0 });
      out.push({ id: 'pallet_small', x: alleyX, y: y + 0.2, z: alleyZ, yaw: 0.3 });
      out.push({ id: 'box_closed', x: alleyX + 0.6, y: y + 0.4, z: alleyZ, yaw: 0.2 });
      out.push({ id: 'box_open', x: alleyX - 0.4, y: y + 0.4, z: alleyZ, yaw: -0.3 });
      out.push({ id: 'scaffold', x: alleyX + 0.5, y, z: f.z1 - 1.5, yaw: 0 });
      out.push({ id: 'planks', x: alleyX + 0.5, y: y + 0.1, z: f.z1 - 3.5, yaw: 0.4 });
      out.push({ id: 'barrel', x: alleyX + 1.2, y, z: f.z0 + 1.5, yaw: 0 });
    }

    // Avenues flanking the buildings
    const avenueZ = f.z0 - 3.2;
    if (!nearDoorway(doorX, avenueZ, 2.5) && !onRoad(f.x0 + 1.5, avenueZ, 0.5)) {
      out.push({ id: 'street_bench', x: f.x0 + 2.0, y, z: avenueZ, yaw: 0 });
      out.push({ id: 'street_light_double', x: f.x1 - 1.5, y, z: avenueZ, yaw: 0 });
      out.push({ id: 'barrier_strong', x: f.x1 + 1.5, y, z: avenueZ, yaw: Math.PI / 2 });
    }
  });
}

/**
 * Tidal Works Harbor & Lake Docks: Cargo shipping containers, pallets,
 * industrial workshops, fuel depots, and fishermen's wharves.
 */
function dressTidalWorksHarbor(out: Placement[]): void {
  // --- The Great Wooden Docks & Wharves (DOCK) ---
  // Length runs from DOCK.x0 (-198m) to DOCK.x1 (-144m), z between 102m and 114m, deck height y=0.05
  const deckY = 0.05;
  const midZ = (DOCK.z0 + DOCK.z1) / 2;

  // Stacks of freight crates and pallets along the dock spine
  for (let x = DOCK.x0 + 6; x <= DOCK.x1 - 6; x += 9) {
    const side = (x % 2 === 0 ? 1 : -1);
    const z = midZ + side * 2.8;

    out.push({ id: 'crate_large', x, y: deckY, z, yaw: (x * 0.1) % Math.PI });
    out.push({ id: 'crate_wood', x: x + 0.8, y: deckY + 1.0, z, yaw: (x * 0.2) % Math.PI });
    out.push({ id: 'pallet', x: x - 1.6, y: deckY, z, yaw: 0 });
    out.push({ id: 'pallet_small', x: x - 1.6, y: deckY + 0.2, z, yaw: 0.3 });
    out.push({ id: 'planks', x: x - 1.6, y: deckY + 0.45, z, yaw: 0.3 });

    // Fueling barrels and maintenance
    out.push({ id: 'barrel', x: x + 2.4, y: deckY, z, yaw: 0 });
    out.push({ id: 'barrel_open', x: x + 3.2, y: deckY, z, yaw: 0 });
    out.push({ id: 'bucket', x: x + 2.4, y: deckY, z: z - side * 1.2, yaw: 0 });
  }

  // Fishermen's spots and dock lighting along the outer water edge
  for (let x = DOCK.x0 + 8; x <= DOCK.x1 - 8; x += 12) {
    out.push({ id: 'lamp_post', x, y: deckY, z: DOCK.z0 + 0.6, yaw: 0 });
    out.push({ id: 'street_bench', x: x + 3, y: deckY, z: DOCK.z0 + 0.8, yaw: 0 });
    out.push({ id: 'lamp_post', x: x + 6, y: deckY, z: DOCK.z1 - 0.6, yaw: Math.PI });
    out.push({ id: 'chair', x: x + 4, y: deckY, z: DOCK.z1 - 0.8, yaw: Math.PI });
    out.push({ id: 'bucket', x: x + 4.8, y: deckY, z: DOCK.z1 - 0.8, yaw: 0 });
  }

  // Harbor crane / scaffold staging on the dockhead
  out.push({ id: 'scaffold', x: DOCK.x0 + 4, y: deckY, z: midZ, yaw: 0 });
  out.push({ id: 'workbench', x: DOCK.x0 + 4, y: deckY, z: midZ - 2.8, yaw: Math.PI / 2 });
  out.push({ id: 'chest', x: DOCK.x0 + 4, y: deckY, z: midZ + 2.8, yaw: -Math.PI / 2 });

  // --- Warehouse Yards & Perimeter Security ---
  BUILDINGS.filter(b => b.style === 'warehouse').forEach((b) => {
    const f = buildingFootprint(b);
    const y = b.base * TILE;

    // Loading bay staging in front
    const bayZ = f.z0 - 3.2;
    if (!nearDoorway((f.x0 + f.x1) / 2, bayZ, 2.5)) {
      out.push({ id: 'pallet', x: f.x0 + 1.8, y, z: bayZ, yaw: 0 });
      out.push({ id: 'crate_large', x: f.x0 + 1.8, y, z: bayZ, yaw: 0 });
      out.push({ id: 'planks', x: f.x0 + 3.8, y: y + 0.1, z: bayZ, yaw: 0.2 });
      out.push({ id: 'dumpster_open', x: f.x1 - 2.2, y, z: bayZ, yaw: 0 });
      out.push({ id: 'barrier_strong', x: f.x1 + 1.2, y, z: bayZ + 1.5, yaw: Math.PI / 2 });
    }

    // Industrial scrap side yard
    const scrapX = f.x1 + 2.5;
    const scrapZ = (f.z0 + f.z1) / 2;
    if (!onRoad(scrapX, scrapZ, 1.5)) {
      out.push({ id: 'barrel', x: scrapX, y, z: scrapZ - 1.4, yaw: 0 });
      out.push({ id: 'barrel_open', x: scrapX, y, z: scrapZ - 0.6, yaw: 0 });
      out.push({ id: 'workbench', x: scrapX, y, z: scrapZ + 1.2, yaw: Math.PI / 2 });
      out.push({ id: 'scaffold', x: scrapX, y, z: scrapZ + 3.5, yaw: 0 });
      out.push({ id: 'dumpster', x: scrapX + 1.5, y, z: scrapZ - 1.0, yaw: 0 });
    }
  });
}

/**
 * Pinewatch Ridge: High alpine trails, lookout camps, loggers' caches,
 * survival tents, campfires, and mountain boulders.
 */
function dressPinewatchRidge(out: Placement[]): void {
  // Summit Campsites & Wilderness Cabins
  BUILDINGS.filter(b => b.style === 'cabin' && b.x > 0 && b.z > 0).forEach((b, idx) => {
    const f = buildingFootprint(b);
    const y = b.base * TILE;

    const campX = f.x0 - 4.8;
    const campZ = (f.z0 + f.z1) / 2;
    if (!onRoad(campX, campZ, 2.0) && !nearDoorway(campX, campZ, 2.2)) {
      out.push({ id: 'campfire', x: campX, y, z: campZ, yaw: 0 });
      out.push({ id: 'tent', x: campX - 3.8, y, z: campZ + 1.8, yaw: 0.8 + idx * 0.4 });
      out.push({ id: 'log', x: campX - 1.6, y, z: campZ, yaw: Math.PI / 2 });
      out.push({ id: 'log', x: campX + 1.6, y, z: campZ, yaw: -Math.PI / 2 });
      out.push({ id: 'stump', x: campX, y, z: campZ + 1.6, yaw: 0 });
      out.push({ id: 'bucket', x: campX + 1.8, y, z: campZ + 1.6, yaw: 0 });
      out.push({ id: 'chest', x: campX - 2.8, y, z: campZ - 1.6, yaw: 0.3 });
      out.push({ id: 'workbench', x: campX - 1.2, y, z: campZ - 2.8, yaw: 0 });
      out.push({ id: 'rock_a', x: campX - 5.5, y, z: campZ - 3.0, yaw: 1.2 });
      out.push({ id: 'rock_b', x: campX + 4.2, y, z: campZ + 3.5, yaw: 2.1 });
    }
  });

  // The Pinewatch Summit Lookout (Top city block at x: FAR-1, z: FAR)
  const summitCity = BUILDINGS.find(b => b.style === 'city' && b.x > 0 && b.z > 0);
  if (summitCity) {
    const f = buildingFootprint(summitCity);
    const roofY = (summitCity.base + summitCity.floors) * TILE;
    out.push({ id: 'scaffold', x: f.x0 + 2.5, y: roofY, z: f.z0 + 2.5, yaw: 0 });
    out.push({ id: 'signpost', x: f.x1 - 1.5, y: roofY, z: f.z0 + 1.5, yaw: -0.8 });
    out.push({ id: 'chest', x: f.x1 - 1.5, y: roofY, z: f.z1 - 1.5, yaw: -Math.PI / 4 });
    out.push({ id: 'radio', x: f.x0 + 2.5, y: roofY + 2.0, z: f.z0 + 2.5, yaw: 0 });
    out.push({ id: 'street_bench', x: (f.x0 + f.x1) / 2, y: roofY, z: f.z1 - 1.2, yaw: Math.PI });
  }
}

/**
 * The Citadel: Central Mesa arena plaza, tactical military barricades,
 * formal clock plaza, and intense combat cover.
 */
function dressTheCitadel(out: Placement[]): void {
  const mesaY = TILE * 2; // 12m height of central mesa

  // --- Formal Plaza around the Central Clock Tower (x:0, z:0) ---
  for (const [dx, dz, yaw] of [
    [-6, -6, 0.78], [6, -6, -0.78], [-6, 6, 2.35], [6, 6, -2.35]
  ]) {
    out.push({ id: 'street_bench', x: dx, y: mesaY, z: dz, yaw });
    out.push({ id: 'street_light_double', x: dx * 1.5, y: mesaY, z: dz * 1.5, yaw });
    out.push({ id: 'potted_plant', x: dx * 0.6, y: mesaY, z: dz * 0.6, yaw: 0 });
  }

  // --- Tactical Combat Barricades & Fortifications in the Central Courtyards ---
  const barriers: Array<[number, number, number, ModelId]> = [
    [-14, 0, Math.PI / 2, 'barrier_strong'],
    [14, 0, Math.PI / 2, 'barrier_strong'],
    [0, -14, 0, 'barrier_strong'],
    [0, 14, 0, 'barrier_strong'],
    [-12, -12, 0.78, 'barrier'],
    [12, -12, -0.78, 'barrier'],
    [-12, 12, 2.35, 'barrier'],
    [12, 12, -2.35, 'barrier'],
    [-18, -4, 0, 'crate_large'],
    [-18, -4, 0, 'crate_wood'],
    [18, 4, 0, 'crate_large'],
    [4, 18, 0, 'crate_wood'],
    [-4, -18, 0, 'crate_large'],
    [16, -16, 0, 'dumpster'],
    [-16, 16, 0, 'dumpster_open'],
    [8, -8, 0, 'chest'],
    [-8, 8, 0, 'chest'],
  ];

  for (const [x, z, yaw, id] of barriers) {
    if (!insideBuilding(x, z, 1.5) && !nearDoorway(x, z, 2.5)) {
      out.push({ id, x, y: mesaY, z, yaw });
    }
  }

  // Pavilion rooftops get vantage points and tactical sandbags
  BUILDINGS.filter(b => b.style === 'city' && Math.abs(b.x) <= 6 && Math.abs(b.z) <= 6).forEach((b) => {
    const f = buildingFootprint(b);
    const roofY = (b.base + b.floors) * TILE;
    out.push({ id: 'barrier', x: f.x0 + 1.5, y: roofY, z: f.z0 + 1.5, yaw: 0.78 });
    out.push({ id: 'crate_wood', x: f.x1 - 1.5, y: roofY, z: f.z1 - 1.5, yaw: 0 });
    out.push({ id: 'chest', x: (f.x0 + f.x1) / 2, y: roofY, z: f.z1 - 1.2, yaw: Math.PI });
  });
}

/**
 * The 12 Intermediate Outposts between districts:
 * Each one is given a distinct theme, backstory, and exploration atmosphere!
 */
function dressIntermediateOutposts(out: Placement[]): void {
  const intermediateCabins = BUILDINGS.filter(b => b.style === 'cabin' && (Math.abs(b.x) > 6 || Math.abs(b.z) > 6) && (Math.abs(b.x) < 40 || Math.abs(b.z) < 40));

  intermediateCabins.forEach((b) => {
    const mx = (b.x + 1) * TILE;
    const mz = (b.z + 1) * TILE;
    const y = b.base * TILE;
    const f = buildingFootprint(b);

    // 1. Abandoned Construction Site (near [-58, -16])
    if (Math.hypot(mx - (-58), mz - (-16)) < 15) {
      out.push({ id: 'scaffold', x: f.x0 - 3.5, y, z: f.z0 - 2.0, yaw: 0 });
      out.push({ id: 'planks', x: f.x0 - 3.5, y: y + 0.1, z: f.z1 + 1.5, yaw: 0.4 });
      out.push({ id: 'pallet', x: f.x0 - 3.5, y, z: f.z1 + 1.5, yaw: 0 });
      out.push({ id: 'barrier', x: f.x1 + 2.5, y, z: f.z0, yaw: Math.PI / 2 });
      out.push({ id: 'dumpster_open', x: f.x1 + 2.8, y, z: f.z1, yaw: 0 });
      out.push({ id: 'barrel', x: f.x0 - 1.5, y, z: f.z1 + 3.0, yaw: 0 });
    }
    // 2. Whispering Grove / Glade (near [54, -18])
    else if (Math.hypot(mx - 54, mz - (-18)) < 15) {
      out.push({ id: 'rock_a', x: f.x0 - 4.2, y, z: f.z0 - 2.0, yaw: 1.1 });
      out.push({ id: 'rock_b', x: f.x1 + 3.5, y, z: f.z1 + 2.0, yaw: 2.3 });
      out.push({ id: 'pumpkin', x: f.x0 - 2.0, y, z: f.z0 - 1.5, yaw: 0.5 });
      out.push({ id: 'bench_cushion', x: f.x1 + 2.2, y, z: f.z0 - 1.0, yaw: -Math.PI / 2 });
      out.push({ id: 'chest', x: f.x0 - 2.8, y, z: f.z1 + 2.0, yaw: 0.4 });
    }
    // 3. Citadel Forward Military Checkpoint (near [-16, -56])
    else if (Math.hypot(mx - (-16), mz - (-56)) < 15) {
      out.push({ id: 'barrier_strong', x: f.x0 - 3.2, y, z: f.z0 - 1.5, yaw: 0 });
      out.push({ id: 'barrier', x: f.x1 + 3.2, y, z: f.z0 - 1.5, yaw: 0 });
      out.push({ id: 'traffic_light', x: f.x0 - 4.5, y, z: f.z0 - 2.5, yaw: 0.8 });
      out.push({ id: 'crate_large', x: f.x1 + 2.5, y, z: f.z1 + 1.5, yaw: 0 });
      out.push({ id: 'crate_wood', x: f.x1 + 2.5, y: y + 1.0, z: f.z1 + 1.5, yaw: 0.1 });
      out.push({ id: 'signpost', x: f.x0 - 2.2, y, z: f.z0 - 3.2, yaw: 0 });
    }
    // 4. Ranger Waystation & Trailhead (near [-18, 52])
    else if (Math.hypot(mx - (-18), mz - 52) < 15) {
      out.push({ id: 'signpost', x: f.x0 - 3.0, y, z: f.z0 - 2.5, yaw: 0.3 });
      out.push({ id: 'bench_cushion', x: f.x1 + 2.5, y, z: f.z0 - 1.0, yaw: -Math.PI / 2 });
      out.push({ id: 'log', x: f.x0 - 3.5, y, z: f.z1 + 2.0, yaw: 0 });
      out.push({ id: 'stump', x: f.x0 - 3.5, y, z: f.z1 + 3.5, yaw: 0 });
      out.push({ id: 'bucket', x: f.x0 - 2.2, y, z: f.z1 + 2.0, yaw: 0 });
    }
    // 5. Ancient Archeological Ruin Dig Site (near [-62, -62])
    else if (Math.hypot(mx - (-62), mz - (-62)) < 15) {
      out.push({ id: 'rock_a', x: f.x0 - 4.5, y, z: f.z0 - 3.0, yaw: 0.5 });
      out.push({ id: 'rock_b', x: f.x0 - 5.5, y, z: f.z1 + 2.0, yaw: 1.8 });
      out.push({ id: 'rock_c', x: f.x1 + 4.0, y, z: f.z0 - 2.0, yaw: 2.7 });
      out.push({ id: 'gravestone_cross', x: f.x1 + 3.2, y, z: f.z1 + 2.5, yaw: Math.PI });
      out.push({ id: 'lamp_post', x: f.x0 - 2.5, y, z: f.z0 - 3.0, yaw: 0 });
      out.push({ id: 'chest', x: f.x0 - 3.2, y, z: f.z1 + 1.0, yaw: 0.6 });
      out.push({ id: 'workbench', x: f.x1 + 2.5, y, z: f.z0 - 1.5, yaw: Math.PI / 2 });
    }
    // 6. Survivalist Prepper Bunker (near [58, -60])
    else if (Math.hypot(mx - 58, mz - (-60)) < 15) {
      out.push({ id: 'tent', x: f.x0 - 4.5, y, z: f.z0 + 2.0, yaw: 0.6 });
      out.push({ id: 'campfire', x: f.x0 - 3.2, y, z: f.z0 - 2.0, yaw: 0 });
      out.push({ id: 'crate_large', x: f.x1 + 3.0, y, z: f.z1 + 1.5, yaw: 0 });
      out.push({ id: 'barrel', x: f.x1 + 3.0, y, z: f.z0 - 1.5, yaw: 0 });
      out.push({ id: 'barrel_open', x: f.x1 + 3.8, y, z: f.z0 - 1.5, yaw: 0 });
      out.push({ id: 'box_closed', x: f.x1 + 2.2, y, z: f.z1 + 1.5, yaw: 0.3 });
    }
    // 7. Hermit's Lakeside Haven (near [-60, 58])
    else if (Math.hypot(mx - (-60), mz - 58) < 15) {
      out.push({ id: 'round_table', x: f.x0 - 3.5, y, z: f.z0 - 1.5, yaw: 0 });
      out.push({ id: 'chair', x: f.x0 - 4.5, y, z: f.z0 - 1.5, yaw: Math.PI / 2 });
      out.push({ id: 'armchair_relax', x: f.x1 + 2.5, y, z: f.z0 - 1.0, yaw: -Math.PI / 2 });
      out.push({ id: 'log', x: f.x0 - 3.5, y, z: f.z1 + 2.5, yaw: 0 });
      out.push({ id: 'bucket', x: f.x0 - 2.2, y, z: f.z1 + 2.5, yaw: 0 });
      out.push({ id: 'flower', x: f.x1 + 3.0, y, z: f.z1 + 2.0, yaw: 0 });
    }
    // 8. The Lumberjack Sawmill (near [60, 62])
    else if (Math.hypot(mx - 60, mz - 62) < 15) {
      out.push({ id: 'log', x: f.x0 - 3.5, y, z: f.z0 - 2.0, yaw: 0 });
      out.push({ id: 'log', x: f.x0 - 3.5, y: y + 0.5, z: f.z0 - 2.0, yaw: 0.1 });
      out.push({ id: 'log', x: f.x0 - 3.5, y, z: f.z1 + 2.0, yaw: Math.PI / 2 });
      out.push({ id: 'stump', x: f.x0 - 2.2, y, z: f.z0 - 3.5, yaw: 0 });
      out.push({ id: 'stump', x: f.x0 - 4.8, y, z: f.z0 - 3.5, yaw: 0 });
      out.push({ id: 'workbench', x: f.x1 + 2.5, y, z: f.z0 - 1.0, yaw: Math.PI / 2 });
      out.push({ id: 'planks', x: f.x1 + 3.0, y: y + 0.1, z: f.z1 + 1.5, yaw: 0 });
      out.push({ id: 'pallet', x: f.x1 + 3.0, y, z: f.z1 + 1.5, yaw: 0 });
      out.push({ id: 'crate_wood', x: f.x1 + 1.8, y, z: f.z1 + 3.0, yaw: 0.2 });
      out.push({ id: 'bucket', x: f.x1 + 1.8, y, z: f.z0 - 2.5, yaw: 0 });
    }
    // 9. North Highway Gas & Repair Depot (near [0, -92])
    else if (Math.hypot(mx - 0, mz - (-92)) < 15) {
      out.push({ id: 'traffic_light', x: f.x0 - 4.5, y, z: f.z0 - 3.0, yaw: 0.7 });
      out.push({ id: 'barrier_strong', x: f.x0 - 3.5, y, z: f.z0 - 1.5, yaw: 0 });
      out.push({ id: 'barrel', x: f.x1 + 2.8, y, z: f.z0 - 1.5, yaw: 0 });
      out.push({ id: 'barrel_open', x: f.x1 + 3.6, y, z: f.z0 - 1.5, yaw: 0 });
      out.push({ id: 'workbench', x: f.x1 + 2.5, y, z: f.z1 + 1.5, yaw: Math.PI / 2 });
      out.push({ id: 'dumpster', x: f.x0 - 3.5, y, z: f.z1 + 2.0, yaw: 0 });
      out.push({ id: 'trashcan', x: f.x1 + 1.5, y, z: f.z0 - 3.0, yaw: 0 });
      out.push({ id: 'signpost', x: f.x0 - 2.0, y, z: f.z0 - 3.5, yaw: 0 });
    }
    // 10. South Highway Scenic Valley Overlook (near [0, 92])
    else if (Math.hypot(mx - 0, mz - 92) < 15) {
      out.push({ id: 'round_table', x: f.x0 - 3.5, y, z: f.z0 - 2.0, yaw: 0 });
      out.push({ id: 'parasol', x: f.x0 - 3.5, y, z: f.z0 - 2.0, yaw: 0 });
      out.push({ id: 'chair_cushion', x: f.x0 - 4.5, y, z: f.z0 - 2.0, yaw: Math.PI / 2 });
      out.push({ id: 'chair_cushion', x: f.x0 - 2.5, y, z: f.z0 - 2.0, yaw: -Math.PI / 2 });
      out.push({ id: 'street_bench', x: f.x1 + 2.5, y, z: f.z0 - 1.0, yaw: -Math.PI / 2 });
      out.push({ id: 'trashcan', x: f.x1 + 2.5, y, z: f.z0 - 2.5, yaw: 0 });
      out.push({ id: 'potted_plant', x: f.x1 + 2.5, y, z: f.z1 + 1.5, yaw: 0 });
    }
    // 11. West Highway Lakeside Fishery (near [-92, 0])
    else if (Math.hypot(mx - (-92), mz - 0) < 15) {
      out.push({ id: 'tent', x: f.x0 - 4.2, y, z: f.z0 + 2.0, yaw: 0.9 });
      out.push({ id: 'campfire', x: f.x0 - 3.5, y, z: f.z0 - 1.5, yaw: 0 });
      out.push({ id: 'chair', x: f.x1 + 2.5, y, z: f.z0 - 1.0, yaw: -Math.PI / 2 });
      out.push({ id: 'bucket', x: f.x1 + 2.5, y, z: f.z0 - 2.0, yaw: 0 });
      out.push({ id: 'barrel', x: f.x1 + 3.2, y, z: f.z1 + 1.5, yaw: 0 });
      out.push({ id: 'workbench', x: f.x0 - 3.5, y, z: f.z1 + 2.5, yaw: 0 });
      out.push({ id: 'chest', x: f.x1 + 2.0, y, z: f.z1 + 3.0, yaw: 0.5 });
      out.push({ id: 'signpost', x: f.x0 - 2.0, y, z: f.z0 - 3.5, yaw: 0 });
    }
    // 12. East Highway Hilltop Comms Relay (near [92, 0])
    else if (Math.hypot(mx - 92, mz - 0) < 15) {
      out.push({ id: 'scaffold', x: f.x0 - 3.5, y, z: f.z0 - 2.0, yaw: 0 });
      out.push({ id: 'desk', x: f.x1 + 2.5, y, z: f.z0 - 1.0, yaw: -Math.PI / 2 });
      out.push({ id: 'desk_chair', x: f.x1 + 3.2, y, z: f.z0 - 1.0, yaw: -Math.PI / 2 });
      out.push({ id: 'monitor', x: f.x1 + 2.5, y: y + 0.77, z: f.z0 - 1.0, yaw: -Math.PI / 2 });
      out.push({ id: 'laptop', x: f.x1 + 2.5, y: y + 0.77, z: f.z0 - 0.5, yaw: -Math.PI / 2 });
      out.push({ id: 'radio', x: f.x0 - 3.5, y: y + 2.0, z: f.z0 - 2.0, yaw: 0 });
      out.push({ id: 'speaker', x: f.x1 + 2.5, y, z: f.z1 + 1.5, yaw: 0 });
      out.push({ id: 'chest', x: f.x0 - 3.0, y, z: f.z1 + 2.0, yaw: 0.2 });
      out.push({ id: 'barrier', x: f.x0 - 2.0, y, z: f.z0 - 3.5, yaw: 0 });
    }
  });
}

/**
 * The Haunted Whispering Pines Cemetery on the Ridge (x: 52, z: 148).
 * Enhanced with ancient crypt, diverse tombstones, twisted dead trees,
 * glowing pumpkins, iron fence perimeter, and Victorian lamp posts.
 */
const CEMETERY = { x: 52, z: 148, rows: 4, cols: 5 };
function buildCemetery(out: Placement[]): void {
  const stones: ModelId[] = ['gravestone', 'gravestone_cross', 'gravestone_round'];
  for (let r = 0; r < CEMETERY.rows; r++) {
    for (let c = 0; c < CEMETERY.cols; c++) {
      const x = CEMETERY.x + (c - (CEMETERY.cols - 1) / 2) * 3.4;
      const z = CEMETERY.z + (r - (CEMETERY.rows - 1) / 2) * 4.2;
      if (insideBuilding(x, z, 3) || onRoad(x, z, 3)) continue;
      out.push({
        id: stones[(r * 5 + c) % stones.length],
        x,
        y: terrainHeight(x, z),
        z,
        yaw: Math.PI + (c % 2 === 0 ? 0.08 : -0.08),
      });

      // Pumpkins scattered between ancient graves
      if ((r + c) % 3 === 0) {
        out.push({
          id: 'pumpkin',
          x: x + 0.8,
          y: terrainHeight(x + 0.8, z + 0.5),
          z: z + 0.5,
          yaw: (r * 1.7) % Math.PI,
        });
      }
    }
  }

  const halfX = (CEMETERY.cols * 3.4) / 2 + 2.6;
  const halfZ = (CEMETERY.rows * 4.2) / 2 + 2.6;

  // Railings around perimeter
  for (let s = -halfX; s <= halfX; s += 2.5) {
    for (const side of [-1, 1]) {
      const x = CEMETERY.x + s, z = CEMETERY.z + halfZ * side;
      out.push({ id: 'iron_fence', x, y: terrainHeight(x, z), z, yaw: 0 });
    }
  }
  for (let s = -halfZ; s <= halfZ; s += 2.5) {
    for (const side of [-1, 1]) {
      const x = CEMETERY.x + halfX * side, z = CEMETERY.z + s;
      out.push({ id: 'iron_fence', x, y: terrainHeight(x, z), z, yaw: Math.PI / 2 });
    }
  }

  // Ancient Crypt at the head of the cemetery
  const cryptZ = CEMETERY.z - halfZ - 4.2;
  out.push({
    id: 'crypt',
    x: CEMETERY.x,
    y: terrainHeight(CEMETERY.x, cryptZ),
    z: cryptZ,
    yaw: 0,
  });

  // Victorian lanterns flanking the crypt entrance
  out.push({ id: 'lamp_post', x: CEMETERY.x - 3.2, y: terrainHeight(CEMETERY.x - 3.2, cryptZ + 2.5), z: cryptZ + 2.5, yaw: 0 });
  out.push({ id: 'lamp_post', x: CEMETERY.x + 3.2, y: terrainHeight(CEMETERY.x + 3.2, cryptZ + 2.5), z: cryptZ + 2.5, yaw: 0 });

  // Twisted dead trees at the corners of the graveyard
  for (const cx of [-halfX - 1.5, halfX + 1.5]) {
    for (const cz of [-halfZ - 1.5, halfZ + 1.5]) {
      out.push({ id: 'dead_tree', x: CEMETERY.x + cx, y: terrainHeight(CEMETERY.x + cx, CEMETERY.z + cz), z: CEMETERY.z + cz, yaw: (cx + cz) % Math.PI });
    }
  }

  for (let i = SCENERY.length - 1; i >= 0; i--) {
    const s = SCENERY[i];
    if (Math.abs(s.x - CEMETERY.x) < halfX + 2 && Math.abs(s.z - CEMETERY.z) < halfZ + 7) {
      SCENERY.splice(i, 1);
    }
  }
}

/**
 * Natural wilderness landmarks across the rolling hills:
 * Scenic boulder formations, fallen timber, tree stumps, and secret explorer camps.
 */
function dressWildernessLandmarks(out: Placement[]): void {
  // Deterministic seed for wilderness landmarks
  let seed = 48291;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // 1. Natural Boulders & Rock Clusters on hilltops and ridges
  for (let i = 0; i < 48; i++) {
    const x = (rand() - 0.5) * 400;
    const z = (rand() - 0.5) * 400;
    if (insideBuilding(x, z, 10) || onRoad(x, z, 8) || inLake(x, z, 6) || Math.hypot(x, z) < 40) continue;
    const y = terrainHeight(x, z);
    if (y < 1.0) continue;

    const rockType: ModelId = i % 3 === 0 ? 'rock_a' : i % 3 === 1 ? 'rock_b' : 'rock_c';
    out.push({ id: rockType, x, y, z, yaw: rand() * Math.PI * 2 });

    // Cluster with a fallen log or stump
    if (rand() > 0.4) {
      const lx = x + (rand() - 0.5) * 4;
      const lz = z + (rand() - 0.5) * 4;
      out.push({ id: rand() > 0.5 ? 'log' : 'stump', x: lx, y: terrainHeight(lx, lz), z: lz, yaw: rand() * Math.PI });
    }
  }

  // 2. Secret Explorer Campsites hidden in the hills
  const secretCamps = [
    { x: -140, z: -40 },
    { x: 140, z: 40 },
    { x: -40, z: 140 },
    { x: 40, z: -140 },
    { x: -130, z: 50 },
    { x: 130, z: -50 },
  ];

  for (const { x, z } of secretCamps) {
    if (insideBuilding(x, z, 8) || onRoad(x, z, 8) || inLake(x, z, 5)) continue;
    const y = terrainHeight(x, z);
    if (y < 0.5) continue;

    out.push({ id: 'tent', x: x - 2.5, y, z: z + 1.2, yaw: 0.6 });
    out.push({ id: 'campfire', x, y, z, yaw: 0 });
    out.push({ id: 'log', x: x + 1.6, y, z, yaw: Math.PI / 2 });
    out.push({ id: 'log', x: x - 1.6, y, z, yaw: -Math.PI / 2 });
    out.push({ id: 'chest', x: x + 1.8, y, z: z + 1.8, yaw: 0.3 });
    out.push({ id: 'bucket', x: x - 1.8, y, z: z - 1.8, yaw: 0 });
  }

  // 3. Lakeside Shoreline Driftwood & Fishing Stashes
  for (let a = 0; a < Math.PI * 2; a += 0.45) {
    const rx = LAKE_SHAPE.rx + 2.5 + rand() * 4;
    const rz = LAKE_SHAPE.rz + 2.5 + rand() * 4;
    const x = LAKE_SHAPE.x + Math.cos(a) * rx;
    const z = LAKE_SHAPE.z + Math.sin(a) * rz;
    if (insideBuilding(x, z, 8) || onRoad(x, z, 6)) continue;
    const y = terrainHeight(x, z);
    if (y < -0.2) continue;

    if (rand() > 0.4) {
      out.push({ id: rand() > 0.5 ? 'log' : 'stump', x, y, z, yaw: rand() * Math.PI });
    } else {
      out.push({ id: 'rock_c', x, y, z, yaw: rand() * Math.PI });
    }
  }
}

/**
 * Dynamic biome-based natural flora & ground cover:
 * Plants lush ferns, wildflowers, 3D grass clumps, mountain rocks, pumpkins,
 * and fallen logs across the island, giving every area a distinct, lively feel.
 */
function dressNaturalFoliage(out: Placement[]): void {
  let seed = 739182;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // 1. Lush 3D Grass Clumps and Wildflowers along roads, meadows, and clearings
  for (let i = 0; i < 320; i++) {
    const x = (rand() - 0.5) * 440;
    const z = (rand() - 0.5) * 440;
    if (insideBuilding(x, z, 5) || onRoad(x, z, 2.5) || inLake(x, z, 4)) continue;
    const y = terrainHeight(x, z);
    if (y < 0.2) continue;

    // Grass clumps everywhere, flowers concentrated in Sunny Meadows & lowlands
    const inMeadows = Math.hypot(x - 108, z - (-108)) < 70;
    const id: ModelId = inMeadows && rand() > 0.4 ? 'flower' : rand() > 0.65 ? 'fern' : 'grass';
    out.push({
      id,
      x,
      y,
      z,
      yaw: rand() * Math.PI * 2,
      scale: 0.8 + rand() * 0.4,
    });
  }

  // 2. Bushes and Hedges along path borders and residential perimeters
  for (let i = 0; i < 180; i++) {
    const x = (rand() - 0.5) * 420;
    const z = (rand() - 0.5) * 420;
    if (insideBuilding(x, z, 4) || onRoad(x, z, 3) || inLake(x, z, 4)) continue;
    const y = terrainHeight(x, z);
    if (y < 0.2) continue;

    out.push({
      id: rand() > 0.3 ? 'bush' : 'plant_small',
      x,
      y,
      z,
      yaw: rand() * Math.PI * 2,
      scale: 0.85 + rand() * 0.45,
    });
  }

  // 3. Dense Highland Ferns & Mossy Timber in Pinewatch Ridge
  for (let i = 0; i < 140; i++) {
    const r = rand() * 75;
    const theta = rand() * Math.PI * 2;
    const x = 108 + Math.cos(theta) * r;
    const z = 108 + Math.sin(theta) * r;
    if (insideBuilding(x, z, 5) || onRoad(x, z, 3) || inLake(x, z, 4)) continue;
    const y = terrainHeight(x, z);
    if (y < 15) continue;

    const fernOrLog: ModelId = rand() > 0.6 ? 'fern' : rand() > 0.3 ? 'log' : 'stump';
    out.push({
      id: fernOrLog,
      x,
      y,
      z,
      yaw: rand() * Math.PI * 2,
      scale: 0.9 + rand() * 0.35,
    });
  }

  // 4. Rugged Boulder Formations on Mountain Slopes & Ridge Shoulders
  for (let i = 0; i < 110; i++) {
    const x = (rand() - 0.5) * 440;
    const z = (rand() - 0.5) * 440;
    if (insideBuilding(x, z, 8) || onRoad(x, z, 5) || inLake(x, z, 6)) continue;
    const y = terrainHeight(x, z);
    if (y < 6) continue;

    const rockId: ModelId = rand() > 0.66 ? 'rock_a' : rand() > 0.33 ? 'rock_b' : 'rock_c';
    out.push({
      id: rockId,
      x,
      y,
      z,
      yaw: rand() * Math.PI * 2,
      scale: 0.8 + rand() * 0.6,
    });
  }

  // 5. Pumpkin Patches near cabins and suburban yards
  for (let p = 0; p < 45; p++) {
    const x = (rand() - 0.5) * 380;
    const z = (rand() - 0.5) * 380;
    if (insideBuilding(x, z, 4) || onRoad(x, z, 3) || inLake(x, z, 4)) continue;
    const y = terrainHeight(x, z);
    if (y < 1.0) continue;

    out.push({
      id: 'pumpkin',
      x,
      y,
      z,
      yaw: rand() * Math.PI * 2,
      scale: 0.8 + rand() * 0.5,
    });
  }
}

/**
 * 12 Secret Exploration Caches:
 * Rewarding exploration hotspots with golden supply chests hidden across high
 * towers, deep crypts, crane scaffolds, and hidden cave clearings!
 */
function dressExplorationSecrets(out: Placement[]): void {
  // 1. Skyline Penthouse Rooftop Vault (Tallest skyscraper in the city)
  const skyTower = BUILDINGS.find(b => b.style === 'city' && b.floors >= 4);
  if (skyTower) {
    const f = buildingFootprint(skyTower);
    const roofY = (skyTower.base + skyTower.floors) * TILE;
    out.push({ id: 'chest', x: (f.x0 + f.x1) / 2, y: roofY, z: (f.z0 + f.z1) / 2, yaw: 0 });
    out.push({ id: 'scaffold', x: f.x0 + 1.8, y: roofY, z: f.z0 + 1.8, yaw: 0 });
    out.push({ id: 'radio', x: f.x0 + 1.8, y: roofY + 1.8, z: f.z0 + 1.8, yaw: 0.4 });
    out.push({ id: 'barrier', x: f.x1 - 1.2, y: roofY, z: f.z0 + 1.2, yaw: Math.PI / 4 });
  }

  // 2. Whispering Pines Crypt Secret Inner Chamber (x: 52, z: 125)
  out.push({ id: 'chest', x: 52, y: terrainHeight(52, 125), z: 125, yaw: 0 });
  out.push({ id: 'books', x: 52.8, y: terrainHeight(52.8, 125) + 0.1, z: 125.4, yaw: 0.3 });
  out.push({ id: 'pumpkin', x: 51.2, y: terrainHeight(51.2, 125.6), z: 125.6, yaw: 0.8 });

  // 3. Tidal Works Harbor Crane Scaffold (x: -188, z: 108)
  out.push({ id: 'chest', x: -188, y: 3.6, z: 108, yaw: Math.PI / 2 });
  out.push({ id: 'scaffold', x: -188, y: 0, z: 108, yaw: 0 });
  out.push({ id: 'scaffold', x: -188, y: 1.8, z: 108, yaw: 0 });
  out.push({ id: 'barrel_open', x: -188, y: 3.6, z: 109.5, yaw: 0 });

  // 4. Pinewatch Summit Peak Lookout (x: 135, z: 135)
  const summitY = terrainHeight(135, 135);
  out.push({ id: 'chest', x: 135, y: summitY, z: 135, yaw: -Math.PI / 4 });
  out.push({ id: 'signpost', x: 133.5, y: summitY, z: 136.5, yaw: 0.8 });
  out.push({ id: 'street_bench', x: 136.5, y: summitY, z: 133.5, yaw: -Math.PI / 4 });
  out.push({ id: 'campfire', x: 133, y: summitY, z: 133, yaw: 0 });

  // 5. Shattered Quarry Cave Cache (x: -56, z: -14)
  const quarryY = terrainHeight(-56, -14);
  out.push({ id: 'chest', x: -56, y: quarryY, z: -14, yaw: 1.2 });
  out.push({ id: 'rock_c', x: -54.5, y: quarryY, z: -14, yaw: 0 });
  out.push({ id: 'rock_a', x: -57.5, y: quarryY, z: -13.5, yaw: 1.5 });
  out.push({ id: 'workbench', x: -56, y: quarryY, z: -16, yaw: 0 });

  // 6. Survivor's Hidden Bunker Cache (x: 60, z: -58)
  const bunkerY = terrainHeight(60, -58);
  out.push({ id: 'chest', x: 60, y: bunkerY, z: -58, yaw: 0.5 });
  out.push({ id: 'box_closed', x: 61, y: bunkerY, z: -57.5, yaw: 0.2 });
  out.push({ id: 'crate_wood', x: 59.2, y: bunkerY, z: -58.5, yaw: 0 });

  // 7. Hermit's Island Stash (x: -62, z: 60)
  const hermitY = terrainHeight(-62, 60);
  out.push({ id: 'chest', x: -62, y: hermitY, z: 60, yaw: -0.8 });
  out.push({ id: 'barrel', x: -61, y: hermitY, z: 61, yaw: 0 });
  out.push({ id: 'bucket', x: -62.5, y: hermitY, z: 61.2, yaw: 0 });

  // 8. Forgotten Ruins Altar (x: -60, z: -64)
  const ruinY = terrainHeight(-60, -64);
  out.push({ id: 'chest', x: -60, y: ruinY, z: -64, yaw: 0 });
  out.push({ id: 'gravestone_cross', x: -58.5, y: ruinY, z: -64, yaw: Math.PI });
  out.push({ id: 'rock_b', x: -61.5, y: ruinY, z: -64, yaw: 2.1 });

  // 9. Scenic Valley Overlook (x: 2, z: 94)
  const overlookY = terrainHeight(2, 94);
  out.push({ id: 'chest', x: 2, y: overlookY, z: 94, yaw: Math.PI });
  out.push({ id: 'parasol', x: 0.5, y: overlookY, z: 94, yaw: 0 });
  out.push({ id: 'chair_cushion', x: 0.5, y: overlookY, z: 93, yaw: Math.PI / 2 });

  // 10. Sunny Meadows Attic Treasure (In northeastern residential manor)
  const manor = BUILDINGS.find(b => b.style === 'house' && b.floors >= 2);
  if (manor) {
    const f = buildingFootprint(manor);
    const atticY = (manor.base + manor.floors) * TILE;
    out.push({ id: 'chest', x: f.x0 + 2.5, y: atticY, z: f.z0 + 2.5, yaw: 0.5 });
    out.push({ id: 'box_closed', x: f.x0 + 1.5, y: atticY, z: f.z0 + 2.5, yaw: 0 });
    out.push({ id: 'books', x: f.x0 + 2.5, y: atticY + 0.5, z: f.z0 + 1.8, yaw: 0.2 });
  }

  // 11. Docks Cargo Sea Container Rafters (x: -180, z: 116)
  out.push({ id: 'chest', x: -180, y: 5.0, z: 116, yaw: 0 });
  out.push({ id: 'pallet', x: -180, y: 5.0, z: 116, yaw: 0 });
  out.push({ id: 'barrel_open', x: -181.5, y: 5.0, z: 116, yaw: 0 });

  // 12. Deep Mountain Woods Hidden Stump (x: 125, z: 85)
  const forestY = terrainHeight(125, 85);
  out.push({ id: 'chest', x: 125, y: forestY, z: 85, yaw: 0.3 });
  out.push({ id: 'stump', x: 125, y: forestY, z: 86.5, yaw: 0 });
  out.push({ id: 'fern', x: 124, y: forestY, z: 84.5, yaw: 0.6 });
}

/**
 * Mountain trails, scenic lookout points, and street lighting:
 * Connects the map with recognizable guide lanterns, benches, and trail markers.
 */
function dressMountainTrails(out: Placement[]): void {
  // Roadside street lights along central highways
  for (let z = -160; z <= 160; z += 40) {
    if (Math.abs(z) < 25) continue; // Leave central plaza open
    out.push({ id: 'street_light_double', x: 7.5, y: terrainHeight(7.5, z), z, yaw: Math.PI / 2 });
    out.push({ id: 'street_light_double', x: -7.5, y: terrainHeight(-7.5, z), z, yaw: -Math.PI / 2 });
  }
  for (let x = -160; x <= 160; x += 40) {
    if (Math.abs(x) < 25) continue;
    out.push({ id: 'street_light_double', x, y: terrainHeight(x, 7.5), z: 7.5, yaw: 0 });
    out.push({ id: 'street_light_double', x, y: terrainHeight(x, -7.5), z: -7.5, yaw: Math.PI });
  }

  // Trail signposts and rest benches along hill ascents
  const trailStops = [
    { x: -50, z: -50, yaw: 0.78 },
    { x: 50, z: -50, yaw: -0.78 },
    { x: -50, z: 50, yaw: 2.35 },
    { x: 50, z: 50, yaw: -2.35 },
  ];
  for (const { x, z, yaw } of trailStops) {
    const y = terrainHeight(x, z);
    out.push({ id: 'signpost', x, y, z, yaw });
    out.push({ id: 'street_bench', x: x + Math.cos(yaw) * 3, y: terrainHeight(x + Math.cos(yaw) * 3, z + Math.sin(yaw) * 3), z: z + Math.sin(yaw) * 3, yaw: yaw + Math.PI / 2 });
    out.push({ id: 'trashcan', x: x - Math.sin(yaw) * 2, y, z: z + Math.cos(yaw) * 2, yaw });
  }
}

/**
 * Detailed lived-in furnishings for iconic rural and countryside POIs:
 * Anarchy Red Barn, Retail Gas & Go Mini-Mart, Haunted Chapel, River Covered Bridge,
 * and the Summit Fire Lookout Tower.
 */
function dressLandmarkPoiInteriors(out: Placement[]): void {
  // 1. Anarchy Acres Red Barn
  const barn = BUILDINGS.find(b => b.theme === 'red_barn');
  if (barn) {
    const bx = barn.x * TILE, bz = barn.z * TILE, by = barn.base * TILE;
    const bw = barn.w * TILE, bd = barn.d * TILE;
    // Ground floor stables & workshop
    out.push({ id: 'workbench', x: bx + bw - 2.0, y: by, z: bz + 2.0, yaw: -Math.PI / 2 });
    out.push({ id: 'bucket', x: bx + bw - 1.2, y: by, z: bz + 3.0, yaw: 0 });
    out.push({ id: 'pallet', x: bx + 2.2, y: by, z: bz + bd - 2.2, yaw: 0 });
    out.push({ id: 'crate_wood', x: bx + 2.2, y: by + 0.2, z: bz + bd - 2.2, yaw: 0.1 });
    out.push({ id: 'barrel', x: bx + 3.8, y: by, z: bz + bd - 2.0, yaw: 0 });
    out.push({ id: 'barrel_open', x: bx + 4.6, y: by, z: bz + bd - 2.0, yaw: 0 });
    out.push({ id: 'planks', x: bx + bw - 2.5, y: by, z: bz + bd - 2.2, yaw: 0.3 });
    // Upper Hayloft (Floor 2)
    const loftY = (barn.base + 1) * TILE;
    out.push({ id: 'chest', x: bx + bw - 2.2, y: loftY, z: bz + bd - 2.2, yaw: -Math.PI / 4 });
    out.push({ id: 'bed_single', x: bx + 2.0, y: loftY, z: bz + bd - 2.2, yaw: 0 });
    out.push({ id: 'box_closed', x: bx + 2.0, y: loftY, z: bz + 2.2, yaw: 0 });
    out.push({ id: 'crate_large', x: bx + bw - 2.2, y: loftY, z: bz + 2.2, yaw: 0 });
    // Exterior Farmstead
    out.push({ id: 'pumpkin', x: bx - 2.5, y: by, z: bz - 2.0, yaw: 0.5 });
    out.push({ id: 'pumpkin', x: bx - 3.2, y: by, z: bz - 1.2, yaw: 1.2 });
    out.push({ id: 'log', x: bx - 4.0, y: by, z: bz + 3.0, yaw: Math.PI / 2 });
  }

  // 2. Retail Gas & Go Mini-Mart
  const gas = BUILDINGS.find(b => b.theme === 'gas_station');
  if (gas) {
    const gx = gas.x * TILE, gz = gas.z * TILE, gy = gas.base * TILE;
    const gw = gas.w * TILE, gd = gas.d * TILE;
    // Checkout Counter & Register
    out.push({ id: 'kitchen_bar', x: gx + 2.2, y: gy, z: gz + gd / 2, yaw: Math.PI / 2 });
    out.push({ id: 'monitor', x: gx + 2.2, y: gy + 0.85, z: gz + gd / 2, yaw: Math.PI / 2 });
    out.push({ id: 'coffee_machine', x: gx + 2.2, y: gy + 0.85, z: gz + gd / 2 + 0.6, yaw: Math.PI / 2 });
    out.push({ id: 'bar_stool', x: gx + 1.2, y: gy, z: gz + gd / 2, yaw: Math.PI / 2 });
    // Beverage Coolers & Snack Aisles
    out.push({ id: 'fridge_large', x: gx + gw - 1.2, y: gy, z: gz + gd - 1.0, yaw: 0 });
    out.push({ id: 'bookcase_closed', x: gx + gw - 1.2, y: gy, z: gz + 2.0, yaw: -Math.PI / 2 });
    out.push({ id: 'microwave', x: gx + 3.4, y: gy + 0.85, z: gz + gd - 1.0, yaw: 0 });
    out.push({ id: 'trashcan', x: gx + 1.0, y: gy, z: gz + 1.2, yaw: 0 });
    // Gas station restroom
    out.push({ id: 'toilet', x: gx + gw - 1.2, y: gy, z: gz + gd - 3.2, yaw: Math.PI / 2 });
    out.push({ id: 'bath_sink', x: gx + gw - 1.2, y: gy, z: gz + gd - 4.4, yaw: Math.PI / 2 });
    // Secret Safe Chest
    out.push({ id: 'chest', x: gx + 1.2, y: gy, z: gz + gd - 1.2, yaw: Math.PI / 4 });
  }

  // 3. Haunted Chapel & Cemetery
  const church = BUILDINGS.find(b => b.theme === 'church');
  if (church) {
    const cx = church.x * TILE, cz = church.z * TILE, cy = church.base * TILE;
    const cw = church.w * TILE, cd = church.d * TILE;
    // Pews along the nave
    for (let pz = cz + 3.0; pz <= cz + cd - 4.0; pz += 2.8) {
      out.push({ id: 'street_bench', x: cx + 3.2, y: cy, z: pz, yaw: 0 });
      out.push({ id: 'street_bench', x: cx + cw - 3.2, y: cy, z: pz, yaw: 0 });
    }
    // Altar in front
    out.push({ id: 'dining_table', x: cx + cw / 2, y: cy, z: cz + cd - 2.2, yaw: 0 });
    out.push({ id: 'table_lamp', x: cx + cw / 2 - 0.6, y: cy + 0.68, z: cz + cd - 2.2, yaw: 0 });
    out.push({ id: 'table_lamp', x: cx + cw / 2 + 0.6, y: cy + 0.68, z: cz + cd - 2.2, yaw: 0 });
    // Belfry upper secret chest
    const belfryY = (church.base + church.floors) * TILE;
    out.push({ id: 'chest', x: cx + cw / 2, y: belfryY, z: cz + 2.5, yaw: 0 });
    out.push({ id: 'radio', x: cx + cw / 2 + 1.0, y: belfryY, z: cz + 2.5, yaw: 0.2 });
    // Cemetery surrounding grounds
    for (const [gx, gz, id] of [
      [cx - 5.0, cz + 2.0, 'gravestone'],
      [cx - 7.5, cz + 4.5, 'gravestone_cross'],
      [cx - 5.5, cz + 7.5, 'gravestone_round'],
      [cx - 8.0, cz + 9.0, 'crypt'],
      [cx - 5.2, cz + 13.0, 'gravestone'],
      [cx - 7.2, cz + 15.5, 'gravestone_cross'],
    ] as const) {
      const gy = terrainHeight(gx, gz);
      out.push({ id, x: gx, y: gy, z: gz, yaw: Math.PI / 2 });
    }
    out.push({ id: 'dead_tree', x: cx - 11.0, y: terrainHeight(cx - 11.0, cz + 8.0), z: cz + 8.0, yaw: 0.8 });
  }

  // 4. Summit Fire Lookout Tower
  const lookout = BUILDINGS.find(b => b.theme === 'lookout_tower');
  if (lookout) {
    const lx = lookout.x * TILE, lz = lookout.z * TILE;
    const lw = lookout.w * TILE, ld = lookout.d * TILE;
    const topY = (lookout.base + lookout.floors - 1) * TILE;
    out.push({ id: 'desk', x: lx + lw / 2, y: topY, z: lz + ld - 1.5, yaw: Math.PI });
    out.push({ id: 'chair', x: lx + lw / 2, y: topY, z: lz + ld - 2.4, yaw: 0 });
    out.push({ id: 'radio', x: lx + lw / 2 - 0.5, y: topY + 0.77, z: lz + ld - 1.5, yaw: Math.PI });
    out.push({ id: 'laptop', x: lx + lw / 2 + 0.4, y: topY + 0.77, z: lz + ld - 1.5, yaw: Math.PI });
    out.push({ id: 'chest', x: lx + 1.2, y: topY, z: lz + 1.2, yaw: Math.PI / 4 });
  }

  // 5. River Covered Bridge Secret Cache
  const bridgeX = -25, bridgeZ = 40;
  const brY = terrainHeight(bridgeX, bridgeZ) + 0.5;
  out.push({ id: 'chest', x: bridgeX, y: brY, z: bridgeZ, yaw: 0.8 });
  out.push({ id: 'barrel_open', x: bridgeX + 1.4, y: brY, z: bridgeZ + 1.2, yaw: 0 });
  out.push({ id: 'lamp_post', x: bridgeX - 4.5, y: brY, z: bridgeZ - 3.5, yaw: 0.8 });
  out.push({ id: 'lamp_post', x: bridgeX + 4.5, y: brY, z: bridgeZ + 3.5, yaw: 0.8 });
}

/**
 * GPU Instanced batching:
 * Efficiently aggregates hundreds of placed assets by model ID into single-draw-call
 * InstancedMesh batches for maximum 60fps+ rendering performance.
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
  const scaleVec = new THREE.Vector3(1, 1, 1);
  let placed = 0;

  for (const [id, list] of byId) {
    const source = models.get(id);
    if (!source) continue;
    const batch = new InstancedModel(source, list.length);
    if (!batch.valid) continue;
    list.forEach((p, i) => {
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
      const s = p.scale ?? 1;
      scaleVec.set(s, s, s);
      batch.setMatrixAt(i, matrix.compose(position.set(p.x, p.y, p.z), quaternion, scaleVec));
    });
    batch.addTo(scene);
    placed += list.length;
  }
  return placed;
}
