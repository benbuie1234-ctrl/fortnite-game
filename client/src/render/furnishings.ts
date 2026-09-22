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

export function createFurnishings(scene: THREE.Scene, models: ModelLibrary): number {
  const placements: Placement[] = [];
  dressStreets(placements);
  dressYards(placements);
  buildCemetery(placements);
  return instance(scene, models, placements);
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
      out.push({ id: 'potted_plant', x: doorX - 2.2, y: y + 0.36, z: f.z0 - 1.2, yaw: 0 });
      out.push({ id: 'potted_plant', x: doorX + 2.2, y: y + 0.36, z: f.z0 - 1.2, yaw: 0 });

      const patioX = (f.x0 + f.x1) / 2;
      const patioZ = f.z1 + 3.2;
      if (!onRoad(patioX, patioZ, 2.0)) {
        out.push({ id: 'round_table', x: patioX, y, z: patioZ, yaw: 0 });
        out.push({ id: 'parasol', x: patioX, y, z: patioZ, yaw: 0 });
        out.push({ id: 'chair', x: patioX - 1.1, y, z: patioZ, yaw: Math.PI / 2 });
        out.push({ id: 'chair', x: patioX + 1.1, y, z: patioZ, yaw: -Math.PI / 2 });
      }
    } else if (b.style === 'cabin') {
      const campX = f.x0 - 4.5;
      const campZ = (f.z0 + f.z1) / 2;
      if (!onRoad(campX, campZ, 2.0)) {
        out.push({ id: 'campfire', x: campX, y, z: campZ, yaw: 0 });
        out.push({ id: 'log', x: campX - 1.6, y, z: campZ, yaw: Math.PI / 2 });
        out.push({ id: 'log', x: campX + 1.6, y, z: campZ, yaw: -Math.PI / 2 });
        out.push({ id: 'tent', x: campX - 4.0, y, z: campZ + 2.0, yaw: 0.8 });
      }
    } else if (b.style === 'warehouse') {
      const yardZ = f.z0 - 2.6;
      out.push({ id: 'pallet', x: f.x0 + 2.0, y, z: yardZ, yaw: 0 });
      out.push({ id: 'planks', x: f.x0 + 2.0, y: y + 0.18, z: yardZ, yaw: 0 });
      out.push({ id: 'crate_large', x: f.x0 + 4.5, y, z: yardZ, yaw: 0 });
      out.push({ id: 'barrel', x: f.x1 - 3.2, y, z: yardZ, yaw: 0 });
    }
  });
}

/**
 * Landmark cemetery on the ridge.
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
        yaw: Math.PI,
      });
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
  out.push({
    id: 'crypt',
    x: CEMETERY.x,
    y: terrainHeight(CEMETERY.x, CEMETERY.z - halfZ - 4),
    z: CEMETERY.z - halfZ - 4,
    yaw: 0,
  });

  for (let i = SCENERY.length - 1; i >= 0; i--) {
    const s = SCENERY[i];
    if (Math.abs(s.x - CEMETERY.x) < halfX + 2 && Math.abs(s.z - CEMETERY.z) < halfZ + 6) {
      SCENERY.splice(i, 1);
    }
  }
}

/**
 * GPU Instanced batching.
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
