/**
 * Dev only: render the island to a PNG so the whole map can be read at a
 * glance -- hypsometric tint with hill shading, water, roads, bridges,
 * buildings and scenery.
 *
 *   node scripts/dev/map-preview.mjs out.png
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { load } from './bundle.mjs';

const outPng = process.argv[2] ?? '/tmp/island.png';
const m = await load('shared/src/map.ts');

const N = 900;
const span = m.MAP_HALF * 2 + 40;
const px = (v) => Math.round((v + span / 2) * (N / span));
const buf = Buffer.alloc(N * N * 3);
const put = (ix, iz, r, g, b) => {
  if (ix < 0 || iz < 0 || ix >= N || iz >= N) return;
  const o = (iz * N + ix) * 3;
  buf[o] = r; buf[o + 1] = g; buf[o + 2] = b;
};

let min = 1e9, max = -1e9;
for (let iz = 0; iz < N; iz++) {
  for (let ix = 0; ix < N; ix++) {
    const x = (ix / N) * span - span / 2;
    const z = (iz / N) * span - span / 2;
    const h = m.terrainHeight(x, z);
    min = Math.min(min, h); max = Math.max(max, h);
    const hx = m.terrainHeight(x + 1.2, z) - m.terrainHeight(x - 1.2, z);
    const hz = m.terrainHeight(x, z + 1.2) - m.terrainHeight(x, z - 1.2);
    const shade = Math.max(0.35, Math.min(1.35, 1 - (hx * 0.55 + hz * 0.35)));
    const water = m.waterLevelAt(x, z);
    let c;
    if (water !== null) {
      const depth = water - h;
      c = depth > 2.5 ? [38, 88, 128] : depth > 1.2 ? [56, 124, 150] : [92, 168, 182];
    } else if (h < m.SHORE_HEIGHT) c = [224, 206, 152];
    else if (h < 10) c = [118, 170, 84];
    else if (h < 18) c = [96, 148, 70];
    else if (h < 28) c = [130, 150, 84];
    else if (h < 38) c = [142, 132, 108];
    else c = [200, 200, 194];
    put(ix, iz, ...c.map(v => Math.max(0, Math.min(255, Math.round(v * shade)))));
  }
}

for (const r of m.ROADS) {
  const steps = Math.ceil(Math.hypot(r.x2 - r.x1, r.z2 - r.z1) * 2);
  const shade = r.kind === 'asphalt' ? [62, 62, 66] : r.kind === 'cobble' ? [124, 116, 104] : [146, 130, 104];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = r.x1 + (r.x2 - r.x1) * t, z = r.z1 + (r.z2 - r.z1) * t;
    const w = Math.max(1, Math.round(r.width / 2 * (N / span)));
    for (let dx = -w; dx <= w; dx++) for (let dz = -w; dz <= w; dz++) put(px(x) + dx, px(z) + dz, ...shade);
  }
}

for (const b of m.BRIDGES) {
  const ax = Math.sin(b.yaw), az = Math.cos(b.yaw);
  for (let t = -b.length / 2; t <= b.length / 2; t += 0.5) {
    for (let w = -b.width / 2; w <= b.width / 2; w += 0.5) {
      put(px(b.x + ax * t + az * w), px(b.z + az * t - ax * w), 246, 214, 86);
    }
  }
}

for (const s of m.SCENERY) {
  const c = s.kind === 'rock' ? [110, 108, 104]
    : s.species === 'pine' ? [22, 68, 40]
      : s.species === 'autumn' ? [150, 96, 40]
        : s.species === 'dead' ? [96, 86, 72] : [44, 104, 52];
  put(px(s.x), px(s.z), ...c);
  put(px(s.x) + 1, px(s.z), ...c);
}

for (const b of m.BUILDINGS) {
  const f = m.buildingFootprint(b);
  for (let x = px(f.x0); x <= px(f.x1); x++) {
    for (let z = px(f.z0); z <= px(f.z1); z++) {
      const edge = x <= px(f.x0) + 1 || x >= px(f.x1) - 1 || z <= px(f.z0) + 1 || z >= px(f.z1) - 1;
      put(x, z, edge ? 30 : 244, edge ? 24 : 132, edge ? 24 : 96);
    }
  }
}

for (const c of m.CARS) {
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) put(px(c.x) + dx, px(c.z) + dz, 250, 250, 255);
}

// Play boundary.
for (let i = 0; i < N; i++) {
  for (const v of [-m.MAP_HALF, m.MAP_HALF]) {
    put(i, px(v), 255, 40, 40);
    put(px(v), i, 255, 40, 40);
  }
}

writeFileSync('/tmp/island.ppm', Buffer.concat([Buffer.from(`P6\n${N} ${N}\n255\n`), buf]));
execFileSync('sips', ['-s', 'format', 'png', '/tmp/island.ppm', '--out', outPng]);
console.log(`${outPng}  ${min.toFixed(1)}..${max.toFixed(1)}m  ${m.BUILDINGS.length} buildings, ${m.ROADS.length} road segments, ${m.BRIDGES.length} bridges, ${m.SCENERY.length} scenery`);
