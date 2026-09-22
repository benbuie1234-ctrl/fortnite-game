import { load } from './bundle.mjs';
const m = await load('shared/src/map.ts');
for (const b of m.BUILDINGS) {
  const f = m.buildingFootprint(b, 3);
  let hit = null;
  for (const r of m.ROADS) {
    const steps = Math.ceil(Math.hypot(r.x2-r.x1, r.z2-r.z1)/2);
    for (let i=0;i<=steps;i++){
      const t=i/steps, x=r.x1+(r.x2-r.x1)*t, z=r.z1+(r.z2-r.z1)*t;
      if (x>f.x0&&x<f.x1&&z>f.z0&&z<f.z1) { hit = `${r.kind} (${r.x1},${r.z1})->(${r.x2},${r.z2})`; break; }
    }
    if (hit) break;
  }
  if (hit) console.log(`${b.name.padEnd(28)} sits on ${hit}`);
}
