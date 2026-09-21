import assert from 'node:assert/strict';
import { World } from '../shared/src/world';
import { buildArena } from '../shared/src/arena';
import { BUILDINGS,SCENERY,PROPS,terrainHeight,buildingFootprint } from '../shared/src/map';
import { TILE } from '../shared/src/constants';
import { stepPlayer, newMovementState } from '../shared/src/sim';
import { placementIssue,BUILD_FLOOR,resolvePlacement } from '../shared/src/placement';
import { SLOT_FLOOR,SLOT_CONE } from '../shared/src/build';
const world=new World();buildArena(world);
assert.ok(SCENERY.length>200,'routes contain substantial shared scenery');
assert.ok(BUILDINGS.filter(b=>b.style==='cabin').length>=10,'cover between the districts');
// Every building's base cell has to match the ground it stands on, or the
// district plateaus and the structures on them drift apart: too low and the
// ground floor is buried, too high and the whole block floats. This is the
// invariant the whole map layout rests on, and nothing else checks it.
for(const b of BUILDINGS) {
 const f=buildingFootprint(b);
 for(const [x,z] of [[f.x0,f.z0],[f.x1,f.z0],[f.x0,f.z1],[f.x1,f.z1],[(f.x0+f.x1)/2,(f.z0+f.z1)/2]]) {
  const drop=b.base*TILE-terrainHeight(x,z);
  assert.ok(drop>-TILE*0.55&&drop<TILE*0.9,
   `${b.style} at cell ${b.x},${b.z} sits ${drop.toFixed(1)}m off its ground`);
 }
}
const tree=SCENERY.find(p=>p.kind==='tree')!;
const hit=world.raycast(tree.x-2,tree.y+1,tree.z,1,0,0,4,10);
assert.ok(hit&&hit.piece.key< -1,'tree stops a shot');
const state={...newMovementState(),x:tree.x-2,y:tree.y,z:tree.z,yaw:-Math.PI/2,grounded:true};
for(let i=0;i<60;i++)stepPlayer(state,{seq:i,moveX:0,moveZ:1,yaw:-Math.PI/2,pitch:0,buttons:0,slot:2},world);
assert.ok(state.x<tree.x-.28,'tree collision blocks walking');
// Into the side of the Pinewatch plateau, which stands about five tiles proud
// of the ground between the districts.
const hill=world.raycast(40,34,108,1,-.22,0,120,10);
assert.ok(hill&&hill.piece.key===-1,'hills block bullets and camera rays');
assert.equal(placementIssue({x:TILE/2,y:0,z:TILE/2},{gx:0,gy:0,gz:0,slot:SLOT_CONE,facing:0},new World()),'Move clear of the piece');
const feet={x:TILE/2,y:0,z:TILE/2,yaw:0,pitch:-1,buildSlot:BUILD_FLOOR};
assert.equal(placementIssue(feet,resolvePlacement(feet)!,new World()),null,'low floor can be placed underfoot');
assert.equal(placementIssue({x:156,y:18,z:156},{gx:52,gy:0,gz:52,slot:SLOT_FLOOR,facing:0},world),'Out of reach');
// buildArena leaves a doorway at the middle cell of BOTH the -Z and +Z walls,
// so both have to stay walkable and both have to stay clear of furniture.
for(const house of BUILDINGS.filter(b=>b.style==='house')) {
 const doorX=(house.x+Math.floor(house.w/2)+.5)*TILE;
 const y=house.base*TILE+.05;
 for(const [z0,dir] of [[house.z*TILE-3,1],[(house.z+house.d)*TILE+3,-1]] as const) {
  const p={...newMovementState(),x:doorX,y,z:z0,yaw:dir>0?0:Math.PI,grounded:true};
  for(let i=0;i<30;i++)stepPlayer(p,{seq:i,moveX:0,moveZ:1,yaw:dir>0?0:Math.PI,pitch:0,buttons:0,slot:2},world);
  assert.ok(dir>0?p.z>house.z*TILE+1:p.z<(house.z+house.d)*TILE-1,
   `house entrance remains walkable (z=${p.z.toFixed(1)})`);
 }
 for(const doorZ of [house.z*TILE,(house.z+house.d)*TILE]) {
  assert.ok(!PROPS.some(prop=>Math.abs(prop.x-doorX)<2&&Math.abs(prop.z-doorZ)<2),'door is clear of furnishing');
 }
}
console.log('PASS: tree cover and collision, hill ray blocking, safe builds, and every town entrance.');
