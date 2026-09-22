import * as THREE from 'three';
import {
  MAP_HALF, SEA_LEVEL, SHORE_HEIGHT, LAKE, RIVER,
  terrainHeight, riverSurface, riverWidth, riverDistance, lakeReach,
  SCENERY, ROADS, onRoad, insideBuilding,
  type TreeSpecies,
} from '@shared/map';
import { getTextures, planarUVs } from './textures';
import { createCars } from './cars';
import { createEnvironment } from './environment';
import { createFurnishings } from './furnishings';
import { InstancedModel, type ModelLibrary, type ModelId } from './models';

export interface Landscape {
  update(time: number): void;
  /** Fade one tree, addressed by its index in SCENERY. 1 = fully solid. */
  setTreeAlpha(sceneryIndex: number, alpha: number): void;
}

/**
 * Foliage gets its own material with a per-instance alpha attribute.
 *
 * Trees have to be able to fade one at a time -- the one you are hiding in, for
 * you, and any tree somebody has shot the leaves off, for everybody. An
 * InstancedMesh shares a single material across every instance, so the alpha
 * has to travel as instance data and be applied in the shader; there is no
 * per-instance opacity otherwise, short of a draw call per tree.
 */
function makeFoliageMaterial(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const material = base.clone();
  material.transparent = true;
  material.depthWrite = true;
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float aAlpha;\nvarying float vAlpha;\n'
      + shader.vertexShader.replace('void main() {', 'void main() {\n\tvAlpha = aAlpha;');
    shader.fragmentShader = 'varying float vAlpha;\n'
      + shader.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n\tgl_FragColor.a *= vAlpha;');
  };
  return material;
}

function addAlphaAttribute(geometry: THREE.BufferGeometry, count: number): THREE.InstancedBufferAttribute {
  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1);
  geometry.setAttribute('aAlpha', attribute);
  return attribute;
}

/** Which model stands in for each tree species. */
const SPECIES_MODEL: Record<TreeSpecies, ModelId> = {
  pine: 'tree', oak: 'tree_oak', autumn: 'tree_autumn', dead: 'dead_tree',
};

export function createLandscape(scene: THREE.Scene, models?: ModelLibrary, anisotropy = 4): Landscape {
  const tex = getTextures(anisotropy);

  // -------------------------------------------------------------------------
  // Terrain
  // -------------------------------------------------------------------------
  const size = MAP_HALF * 2;
  const segments = 320;                      // a vertex every metre and a half
  const ground = new THREE.PlaneGeometry(size, size, segments, segments);
  ground.rotateX(-Math.PI / 2);
  const positions = ground.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, terrainHeight(positions.getX(i), positions.getZ(i)));
  }
  ground.computeVertexNormals();

  // Biome colouring. The rules are deliberately few and readable from the air:
  // sand at the waterline, grass on the flat, rock where it is steep, and a
  // pale scree cap on the mountain. Everything else is a blend between them.
  const normals = ground.getAttribute('normal');
  const colors = new Float32Array(positions.count * 3);
  const c = new THREE.Color();
  const sand = new THREE.Color(0xd9c391);
  const wetSand = new THREE.Color(0xa8926a);
  const grass = new THREE.Color(0x6f9f4a);
  const lushGrass = new THREE.Color(0x5b8f3e);
  const dryGrass = new THREE.Color(0x9aa356);
  const rock = new THREE.Color(0x7d7970);
  const darkRock = new THREE.Color(0x5e5b55);
  const scree = new THREE.Color(0xb9b4a8);
  const silt = new THREE.Color(0x8a8560);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const flat = normals.getY(i);
    const noise = Math.sin(x * 0.13) * Math.cos(z * 0.17) * 0.05 + Math.sin(x * 0.4 + z * 0.31) * 0.025;

    const river = riverDistance(x, z);
    const nearRiver = river.d < riverWidth(river.t) + 6;
    const nearLake = lakeReach(x, z) < 1.12;

    if (y < SHORE_HEIGHT + 0.3 && (y < SEA_LEVEL + 2.4 || nearLake || nearRiver)) {
      // Beach and riverbed: wet and dark below the line, dry and pale above it.
      const wet = y < (nearRiver ? riverSurface(river.t) : nearLake ? LAKE.surface : SEA_LEVEL);
      c.copy(wet ? wetSand : sand).lerp(silt, nearRiver ? 0.35 : 0);
    } else if (flat < 0.62) {
      c.copy(darkRock).lerp(rock, flat / 0.62);
    } else if (flat < 0.8) {
      c.copy(rock).lerp(y > 30 ? scree : grass, (flat - 0.62) / 0.18);
    } else if (y > 33) {
      c.copy(scree).lerp(rock, 0.35);
    } else if (y > 24) {
      c.copy(dryGrass).lerp(rock, (y - 24) / 14);
    } else {
      // Lower, wetter ground is greener; the exposed shelves are drier.
      const damp = Math.max(0, 1 - Math.abs(y - 6) / 14);
      c.copy(grass).lerp(lushGrass, damp).lerp(dryGrass, Math.max(0, (y - 12) / 24));
    }
    c.multiplyScalar(0.95 + noise);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  ground.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  planarUVs(ground, 5);
  const terrain = new THREE.Mesh(ground, new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: tex.grass,
    normalMap: tex.terrainNormal,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: tex.terrainRoughness,
    roughness: 0.92,
    metalness: 0.01,
    envMapIntensity: 0.8,
  }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // -------------------------------------------------------------------------
  // Water: one material, three bodies
  // -------------------------------------------------------------------------
  const waterTime = { value: 0 };
  const water = (color: number, opacity: number): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({
      color, transparent: true, opacity,
      roughness: 0.1, metalness: 0.2,
      normalMap: tex.waterNormal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      envMapIntensity: 1.25,
      side: THREE.DoubleSide,
    });
    m.onBeforeCompile = shader => {
      shader.uniforms.uWaterTime = waterTime;
      shader.vertexShader = 'varying vec3 vWaterPosition;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWaterPosition=(modelMatrix*vec4(position,1.0)).xyz;',
      );
      shader.fragmentShader = 'uniform float uWaterTime; varying vec3 vWaterPosition;\n'
        + shader.fragmentShader.replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
           normal = normalize(normal + vec3(
             sin(vWaterPosition.x * 1.1 + uWaterTime * 0.9) * 0.12,
             cos(vWaterPosition.z * 0.9 + uWaterTime * 0.7) * 0.12, 0.0));`,
        );
    };
    m.customProgramCacheKey = () => 'water-v2';
    return m;
  };

  // The sea, well past the island so the horizon is water rather than an edge.
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600, 1, 1), water(0x2a7f9e, 0.9));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = SEA_LEVEL;
  scene.add(sea);

  // The lake.
  const lake = new THREE.Mesh(new THREE.CircleGeometry(1, 72), water(0x2f8f96, 0.86));
  lake.rotation.x = -Math.PI / 2;
  lake.scale.set(LAKE.rx, LAKE.rz, 1);
  lake.position.set(LAKE.x, LAKE.surface, LAKE.z);
  scene.add(lake);

  // The river, as a ribbon that follows the centreline and widens downstream.
  {
    const verts: number[] = [], index: number[] = [];
    const steps = 160;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const at = t * (RIVER.length - 1);
      const seg = Math.min(RIVER.length - 2, Math.floor(at));
      const f = at - seg;
      const x = RIVER[seg][0] + (RIVER[seg + 1][0] - RIVER[seg][0]) * f;
      const z = RIVER[seg][1] + (RIVER[seg + 1][1] - RIVER[seg][1]) * f;
      const dx = RIVER[seg + 1][0] - RIVER[seg][0], dz = RIVER[seg + 1][1] - RIVER[seg][1];
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len;
      const w = riverWidth(t) + 1.2;
      const y = riverSurface(t) + 0.02;
      verts.push(x + nx * w, y, z + nz * w, x - nx * w, y, z - nz * w);
      if (i < steps) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    planarUVs(geo, 8);
    scene.add(new THREE.Mesh(geo, water(0x3f9aa6, 0.8)));
  }

  // -------------------------------------------------------------------------
  // Roads
  // -------------------------------------------------------------------------
  const roadMaterials = new Map<string, THREE.MeshStandardMaterial>();
  const roadMaterial = (kind: string): THREE.MeshStandardMaterial => {
    let m = roadMaterials.get(kind);
    if (m) return m;
    const asphalt = kind === 'asphalt';
    m = new THREE.MeshStandardMaterial({
      color: asphalt ? 0x9fa2a6 : kind === 'cobble' ? 0xcfc6b4 : kind === 'gravel' ? 0xcfcabb : 0xc2a785,
      map: asphalt ? tex.concrete : tex.roadTexture,
      normalMap: tex.roadNormal,
      normalScale: new THREE.Vector2(asphalt ? 0.5 : 0.95, asphalt ? 0.5 : 0.95),
      roughnessMap: tex.roadRoughness,
      roughness: asphalt ? 0.88 : 0.96,
      side: THREE.DoubleSide,
    });
    roadMaterials.set(kind, m);
    return m;
  };

  for (const r of ROADS) {
    const length = Math.hypot(r.x2 - r.x1, r.z2 - r.z1);
    const nx = -(r.z2 - r.z1) / length, nz = (r.x2 - r.x1) / length;
    const verts: number[] = [], indices: number[] = [];
    const steps = Math.ceil(length / 2), across = Math.max(2, Math.ceil(r.width / 2));
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= across; j++) {
        const t = i / steps, side = (j / across - 0.5) * r.width;
        const x = r.x1 + (r.x2 - r.x1) * t + nx * side;
        const z = r.z1 + (r.z2 - r.z1) * t + nz * side;
        verts.push(x, terrainHeight(x, z) + 0.05, z);
      }
    }
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < across; j++) {
        const a = i * (across + 1) + j, b = a + across + 1;
        // Stop the surface where a building stands on it: the road runs up to
        // the wall rather than through the shop.
        if ([a, a + 1, b, b + 1].some(v => insideBuilding(verts[v * 3], verts[v * 3 + 2], 0.2))) continue;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    planarUVs(geo, r.kind === 'cobble' ? 3 : 5);
    const mesh = new THREE.Mesh(geo, roadMaterial(r.kind));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // -------------------------------------------------------------------------
  // Trees and rocks
  // -------------------------------------------------------------------------
  const treeList = SCENERY.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === 'tree');
  const rockList = SCENERY.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === 'rock');
  const treeSlot = new Map<number, number>();
  treeList.forEach(({ i }, slot) => treeSlot.set(i, slot));

  const detail = tex.detail;
  const solidMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, map: detail, roughness: 0.9, metalness: 0, envMapIntensity: 0.9 });
  const foliageMaterial = makeFoliageMaterial(solidMaterial);

  const matrix = new THREE.Object3D();
  const batches = new Map<number, { batch: InstancedModel; slot: number }>();

  // One instanced batch per species. Anything the model pack does not have
  // falls back to the built-in cone-and-trunk below, so the game still runs
  // with no art at all.
  const missing: Array<{ p: typeof SCENERY[number]; i: number }> = [];
  for (const species of ['pine', 'oak', 'autumn', 'dead'] as TreeSpecies[]) {
    const list = treeList.filter(({ p }) => (p.species ?? 'oak') === species);
    if (!list.length) continue;
    const model = models?.get(SPECIES_MODEL[species]);
    if (!model) { missing.push(...list); continue; }
    const batch = new InstancedModel(model, list.length, true);
    if (!batch.valid) { missing.push(...list); continue; }
    list.forEach(({ p, i }, slot) => {
      matrix.position.set(p.x, p.y, p.z);
      matrix.scale.setScalar(p.size * (species === 'dead' ? 0.34 : 0.42));
      matrix.rotation.set(0, i * 2.399, 0);
      matrix.updateMatrix();
      batch.setMatrixAt(slot, matrix.matrix);
      batches.set(treeSlot.get(i)!, { batch, slot });
    });
    batch.addTo(scene);
  }
  matrix.rotation.set(0, 0, 0);

  // Procedural fallback trees, only for the species with no model.
  const trunkGeo = new THREE.CylinderGeometry(0.19, 0.32, 1, 6);
  const leafGeo = new THREE.ConeGeometry(1, 1, 7);
  const trunks = new THREE.InstancedMesh(trunkGeo, foliageMaterial, Math.max(1, missing.length));
  const leaves = new THREE.InstancedMesh(leafGeo, foliageMaterial, Math.max(1, missing.length * 3));
  const trunkAlpha = addAlphaAttribute(trunkGeo, Math.max(1, missing.length));
  const leafAlpha = addAlphaAttribute(leafGeo, Math.max(1, missing.length * 3));
  const fallbackSlot = new Map<number, number>();
  missing.forEach(({ p, i }, n) => {
    fallbackSlot.set(treeSlot.get(i)!, n);
    matrix.position.set(p.x, p.y + p.size / 2, p.z);
    matrix.scale.set(1, p.size, 1);
    matrix.updateMatrix();
    trunks.setMatrixAt(n, matrix.matrix);
    trunks.setColorAt(n, new THREE.Color(0x806445));
    for (let tier = 0; tier < 3; tier++) {
      const spread = p.size * (0.66 - tier * 0.17);
      matrix.position.set(p.x, p.y + p.size * (0.72 + tier * 0.34), p.z);
      matrix.scale.set(spread, p.size * 0.82, spread);
      matrix.rotation.set(0, (n * 1.7 + tier * 0.9) % (Math.PI * 2), 0);
      matrix.updateMatrix();
      leaves.setMatrixAt(n * 3 + tier, matrix.matrix);
      leaves.setColorAt(n * 3 + tier, new THREE.Color(n % 3 === 0 ? 0x3f6f4e : 0x4f7f47).multiplyScalar(0.82 + tier * 0.16));
    }
    matrix.rotation.set(0, 0, 0);
  });
  if (missing.length) {
    for (const mesh of [trunks, leaves]) {
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }

  // Rocks: the model pack has three, used in rotation for variety.
  const rockIds: ModelId[] = ['rock_a', 'rock_b', 'rock_c'];
  const rockBuckets = rockIds.map(id => ({ id, list: [] as typeof rockList }));
  rockList.forEach((entry, n) => rockBuckets[n % rockBuckets.length].list.push(entry));
  let rockFallback: typeof rockList = [];
  for (const bucket of rockBuckets) {
    const model = models?.get(bucket.id) ?? models?.get('rock');
    if (!model || !bucket.list.length) { rockFallback = rockFallback.concat(bucket.list); continue; }
    const batch = new InstancedModel(model, bucket.list.length);
    if (!batch.valid) { rockFallback = rockFallback.concat(bucket.list); continue; }
    bucket.list.forEach(({ p, i }, slot) => {
      matrix.position.set(p.x, p.y - p.size * 0.12, p.z);
      matrix.scale.setScalar(p.size * 0.55);
      matrix.rotation.set(0, i * 1.13, 0);
      matrix.updateMatrix();
      batch.setMatrixAt(slot, matrix.matrix);
    });
    batch.addTo(scene);
  }
  if (rockFallback.length) {
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.62, 0), solidMaterial, rockFallback.length);
    rockFallback.forEach(({ p }, n) => {
      matrix.position.set(p.x, p.y + p.size * 0.2, p.z);
      matrix.scale.set(p.size * 0.6, p.size * 0.5, p.size * 0.6);
      matrix.rotation.set(0, n, 0);
      matrix.updateMatrix();
      rocks.setMatrixAt(n, matrix.matrix);
      rocks.setColorAt(n, new THREE.Color(0x85928b));
    });
    rocks.computeBoundingSphere();
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    scene.add(rocks);
  }
  matrix.rotation.set(0, 0, 0);

  // -------------------------------------------------------------------------
  const environment = createEnvironment(scene, anisotropy);
  createGroundCover(scene, models);
  if (models) createFurnishings(scene, models);
  createHorizon(scene);
  createCars(scene);

  return {
    update(time) {
      waterTime.value = time;
      environment.update(time);
    },
    setTreeAlpha(sceneryIndex, alpha) {
      const slot = treeSlot.get(sceneryIndex);
      if (slot === undefined) return;
      const clamped = Math.max(0.12, Math.min(1, alpha));
      const model = batches.get(slot);
      if (model) { model.batch.setAlphaAt(model.slot, Math.max(0.08, clamped)); return; }
      const n = fallbackSlot.get(slot);
      if (n === undefined) return;
      if (trunkAlpha.getX(n) === clamped) return;
      trunkAlpha.setX(n, clamped);
      trunkAlpha.needsUpdate = true;
      // Leaves fade harder than the trunk: the canopy is what blocks the view,
      // and a trunk you can see straight through reads as a bug rather than cover.
      for (let tier = 0; tier < 3; tier++) {
        leafAlpha.setX(n * 3 + tier, clamped === 1 ? 1 : Math.max(0.08, clamped * 0.72));
      }
      leafAlpha.needsUpdate = true;
    },
  };
}

/**
 * Small plants, in their thousands.
 *
 * Decorative only -- no invisible colliders in the grass -- and clustered into
 * spatial batches so a meadow does not cost one draw call per tuft.
 */
function createGroundCover(scene: THREE.Scene, models?: ModelLibrary): void {
  let seed = 81731;
  const rand = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const groups = new Map<string, { id: ModelId; points: Array<{ x: number; y: number; z: number; s: number; r: number }> }>();
  for (let i = 0; i < 16000; i++) {
    const x = (rand() - 0.5) * MAP_HALF * 1.96, z = (rand() - 0.5) * MAP_HALF * 1.96;
    const y = terrainHeight(x, z);
    if (y < SHORE_HEIGHT + 0.2) continue;
    if (onRoad(x, z, 1.2)) continue;
    if (insideBuilding(x, z, 2)) continue;
    // Bare patches, so the ground is not a uniform carpet.
    if (Math.sin(x * 0.045) * Math.cos(z * 0.053) < -0.2) continue;
    const river = riverDistance(x, z);
    const damp = river.d < riverWidth(river.t) + 14 || lakeReach(x, z) < 1.3;
    // Mostly grass. Flowers read as strong colour at any distance, so a few go
    // a long way and a lot turns a meadow purple.
    const id: ModelId = damp && rand() < 0.45 ? 'fern'
      : i % 23 === 0 ? 'bush'
        : i % 17 === 0 ? 'flower'
          : i % 5 === 0 ? 'fern' : 'grass';
    const key = `${id},${Math.floor(x / 48)},${Math.floor(z / 48)}`;
    const g = groups.get(key) ?? { id, points: [] };
    g.points.push({ x, y, z, s: 0.7 + rand() * 1.1, r: rand() * 6.28 });
    groups.set(key, g);
  }
  const obj = new THREE.Object3D();
  for (const g of groups.values()) {
    const model = models?.get(g.id);
    if (!model) continue;
    const batch = new InstancedModel(model, g.points.length);
    if (!batch.valid) continue;
    g.points.forEach((p, i) => {
      obj.position.set(p.x, p.y, p.z);
      obj.scale.setScalar(p.s);
      obj.rotation.set(0, p.r, 0);
      obj.updateMatrix();
      batch.setMatrixAt(i, obj.matrix);
    });
    batch.addTo(scene, false);
  }
}

/**
 * The world beyond the island: layered headlands out at sea.
 *
 * Deliberately unchanged in spirit from the map this replaces -- the distant
 * silhouettes and the sky are what sell the scale, and they were already right.
 */
function createHorizon(scene: THREE.Scene): void {
  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI * 2 / 24 + ring * 0.16;
      const geo = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const pos = geo.getAttribute('position');
      const shades: number[] = [];
      for (let j = 0; j < pos.count; j++) {
        const vx = pos.getX(j), vy = pos.getY(j), vz = pos.getZ(j);
        const noise = 1 + 0.18 * Math.sin(vx * 8 + i) * Math.cos(vz * 9 + i * 2);
        pos.setXYZ(j, vx * (55 + i % 4 * 10), vy * (30 + i % 5 * 11) * noise, vz * (50 + i % 3 * 9));
        const c = new THREE.Color(ring ? 0x7d9aa4 : 0x6a8285).multiplyScalar(0.85 + vy * 0.25);
        shades.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
      geo.computeVertexNormals();
      const mountain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
      mountain.position.set(Math.cos(a) * (MAP_HALF + 185 + ring * 120), SEA_LEVEL - 6, Math.sin(a) * (MAP_HALF + 185 + ring * 120));
      scene.add(mountain);
    }
  }
}
