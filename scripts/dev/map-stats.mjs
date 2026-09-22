import { load } from './bundle.mjs';
const m = await load('shared/src/map.ts');
const a = await load('shared/src/arena.ts');
console.log(`buildings ${m.BUILDINGS.length}  blueprints ${m.BLUEPRINTS.length}  roads ${m.ROADS.length}  scenery ${m.SCENERY.length}  props ${m.PROPS.length}  cars ${m.CARS.length}`);
let walls=0, rooms=0, floors=0, stairs=0, roofs=0, boxes=0;
for (const bp of m.BLUEPRINTS) {
  walls += bp.walls.length; rooms += bp.rooms.length; floors += bp.floors.length;
  stairs += bp.stairs.length; roofs += bp.roofRamps.length;
  for (const w of bp.walls) boxes += m.wallBoxes(w).length;
}
console.log(`walls ${walls} -> ${boxes} boxes   rooms ${rooms}   floor cells ${floors}   stair flights ${stairs}   roof wedges ${roofs}`);
// overlap check
let overlap = 0;
for (let i=0;i<m.BUILDINGS.length;i++) for (let j=i+1;j<m.BUILDINGS.length;j++) {
  const A=m.buildingFootprint(m.BUILDINGS[i],1), B=m.buildingFootprint(m.BUILDINGS[j],1);
  if (A.x0<B.x1&&A.x1>B.x0&&A.z0<B.z1&&A.z1>B.z0) { overlap++; console.log('OVERLAP', m.BUILDINGS[i].name, m.BUILDINGS[j].name); }
}
// pad fit
let worst=0, worstName='';
for (const b of m.BUILDINGS) {
  const f=m.buildingFootprint(b);
  for (const [x,z] of [[f.x0,f.z0],[f.x1,f.z0],[f.x0,f.z1],[f.x1,f.z1],[(f.x0+f.x1)/2,(f.z0+f.z1)/2]]) {
    const drop=b.base*6-m.terrainHeight(x,z);
    if (Math.abs(drop)>Math.abs(worst)) { worst=drop; worstName=`${b.name} @(${x},${z})`; }
  }
}
console.log(`overlaps ${overlap}   worst pad mismatch ${worst.toFixed(2)}m at ${worstName}`);
// room mix
const kinds={}; for (const bp of m.BLUEPRINTS) for (const r of bp.rooms) kinds[r.kind]=(kinds[r.kind]??0)+1;
console.log('rooms by kind:', Object.entries(kinds).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(' '));
// buildings with no stairs but multiple floors
for (const bp of m.BLUEPRINTS) {
  const want = bp.b.floors - 1 + ((bp.b.attic && ['gable','hip','gambrel'].includes(bp.b.roof)) || bp.b.roof==='flat' ? 1 : 0);
  if (bp.stairs.length < want) console.log(`  !! ${bp.b.name}: ${bp.stairs.length} flights, wanted ${want} (w${bp.b.w} d${bp.b.d} f${bp.b.floors} ${bp.b.roof})`);
}
