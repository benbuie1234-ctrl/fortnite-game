import assert from 'node:assert/strict';
import { World } from '../shared/src/world';
import { buildArena } from '../shared/src/arena';
import { BUILDINGS,SCENERY,PROPS } from '../shared/src/map';
import { stepPlayer, newMovementState } from '../shared/src/sim';
import { placementIssue,BUILD_FLOOR,resolvePlacement } from '../shared/src/placement';
import { SLOT_FLOOR,SLOT_CONE } from '../shared/src/build';
const world=new World();buildArena(world);
assert.ok(SCENERY.length>200,'routes contain substantial shared scenery');
assert.ok(BUILDINGS.filter(b=>b.style==='cabin'&&b.base===0).length>=8);
const tree=SCENERY.find(p=>p.kind==='tree')!;
const hit=world.raycast(tree.x-2,tree.y+1,tree.z,1,0,0,4,10);
assert.ok(hit&&hit.piece.key< -1,'tree stops a shot');
const state={...newMovementState(),x:tree.x-2,y:tree.y,z:tree.z,yaw:-Math.PI/2,grounded:true};
for(let i=0;i<60;i++)stepPlayer(state,{seq:i,moveX:0,moveZ:1,yaw:-Math.PI/2,pitch:0,buttons:0,slot:2},world);
assert.ok(state.x<tree.x-.28,'tree collision blocks walking');
const hill=world.raycast(100,20,156,1,-.2,0,100,10);
assert.ok(hill&&hill.piece.key===-1,'hills block bullets and camera rays');
assert.equal(placementIssue({x:1.5,y:0,z:1.5},{gx:0,gy:0,gz:0,slot:SLOT_CONE,facing:0},new World()),'Move clear of the piece');
const feet={x:1.5,y:0,z:1.5,yaw:0,pitch:-1,buildSlot:BUILD_FLOOR};
assert.equal(placementIssue(feet,resolvePlacement(feet)!,new World()),null,'low floor can be placed underfoot');
assert.equal(placementIssue({x:156,y:18,z:156},{gx:52,gy:0,gz:52,slot:SLOT_FLOOR,facing:0},world),'Out of reach');
for(const house of BUILDINGS.filter(b=>b.style==='house')) {
 const p={...newMovementState(),x:(house.x+Math.floor(house.w/2)+.5)*3,y:.05,z:house.z*3-2,grounded:true};
 for(let i=0;i<24;i++)stepPlayer(p,{seq:i,moveX:0,moveZ:1,yaw:0,pitch:0,buttons:0,slot:2},world);
 assert.ok(p.z>house.z*3+1,'house entrance remains walkable');
 assert.ok(!PROPS.some(prop=>Math.abs(prop.x-(house.x+Math.floor(house.w/2)+.5)*3)<1&&Math.abs(prop.z-house.z*3)<1),'door is clear of furnishing');
}
console.log('PASS: tree cover and collision, hill ray blocking, safe builds, and every town entrance.');
