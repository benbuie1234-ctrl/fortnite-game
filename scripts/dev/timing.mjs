/** Dev only: where the map's time goes. */
import { load } from './bundle.mjs';

const t0 = performance.now();
const m = await load('shared/src/map.ts');
console.log(`map module init: ${(performance.now() - t0).toFixed(0)} ms   scenery ${m.SCENERY.length}`);

const N = 120000;
const xs = new Float64Array(N), zs = new Float64Array(N);
let seed = 12345;
for (let i = 0; i < N; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  xs[i] = (seed / 4294967296 - 0.5) * 480;
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  zs[i] = (seed / 4294967296 - 0.5) * 480;
}

function bench(name, fn) {
  fn(); // warm
  const t = performance.now();
  let acc = 0;
  for (let i = 0; i < N; i++) acc += fn(xs[i], zs[i]) ?? 0;
  const ms = performance.now() - t;
  console.log(`  ${name.padEnd(18)} ${(N / ms / 1000).toFixed(2)}M/s   ${(ms * 1000 / N).toFixed(2)} us   (${acc.toFixed(0)})`);
}

bench('landMask', (x = 0, z = 0) => m.landMask(x, z));
bench('riverDistance', (x = 0, z = 0) => m.riverDistance(x, z).d);
bench('rawTerrain', (x = 0, z = 0) => m.rawTerrain(x, z));
bench('terrainHeight', (x = 0, z = 0) => m.terrainHeight(x, z));
