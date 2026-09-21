import assert from 'node:assert/strict';
import { World } from '../shared/src/world';
import { makePiece,SLOT_FLOOR,SLOT_WALL_Z } from '../shared/src/build';
import { stepPlayer, newMovementState } from '../shared/src/sim';
import { TILE, PIECE_THICKNESS } from '../shared/src/constants';
import { cameraPose } from '../shared/src/camera';
import { ServerPlayer } from '../server/src/player';
import { resolveFire } from '../server/src/combat';
import { EV_HIT } from '../shared/src/protocol';
import type { GameEvent } from '../shared/src/snapshot';
// A floor intersection must settle vertically, never throw us to a tile edge.
// The slab hangs below its cell line, so a floor at cell y=1 has its surface at
// y=TILE and its body in the thickness just under that; starting inside that
// body is what the recovery has to handle.
const mid=TILE/2, inside=TILE-PIECE_THICKNESS*0.25;
for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
 const w=new World();w.set(makePiece(0,1,0,SLOT_FLOOR,2,0,255,0));
 const p={...newMovementState(),x:mid,y:inside,z:mid,yaw,grounded:true};
 stepPlayer(p,{seq:1,moveX:0,moveZ:1,yaw,pitch:0,buttons:0,slot:2},w);
 assert.ok(Math.hypot(p.x-mid,p.z-mid)<.4,'floor overlap cannot eject player');
 assert.ok(p.y>TILE-0.05,`feet settle above the floor (y=${p.y})`);
}
const wall=new World();wall.set(makePiece(0,0,1,SLOT_WALL_Z,2,0,255,0));
const walker={...newMovementState(),x:mid,y:0,z:TILE*0.33,grounded:true};
for(let i=0;i<60;i++)stepPlayer(walker,{seq:i,moveX:0,moveZ:1,yaw:0,pitch:0,buttons:0,slot:2},wall);
assert.ok(walker.z<TILE,'ordinary walls still stop movement');
// The scope fires straight down its own sightline. Ranges here stay inside the
// flat part of the trajectory, so this checks scope alignment and nothing else.
for(const distance of [5,50,200])for(const yaw of [0,.7,Math.PI/2]) {
 const w=new World();const shooter=new ServerPlayer(0,'test',{} as WebSocket);
 Object.assign(shooter,{x:0,y:0,z:0,yaw,pitch:0,aiming:true,weaponIdx:4});
 const pose=cameraPose(shooter,true,w,10,true);
 assert.equal(pose.origin[0],shooter.x);assert.equal(pose.origin[2],shooter.z);
 const target=new ServerPlayer(1,'target',{} as WebSocket);
 target.x=pose.origin[0]+pose.forward[0]*distance;
 target.z=pose.origin[2]+pose.forward[2]*distance;
 const events:GameEvent[]=[];
 resolveFire(w,shooter,[shooter,target],10,10000,events);
 assert.ok(events.some(e=>e.kind===EV_HIT),`scope hits at ${distance}m and ${yaw}`);
}

// Bullet drop: a flat 350 m shot falls short, and the same shot aimed high
// connects. If both of these ever pass or fail together, drop has stopped
// mattering.
function shootAt(pitch:number, distance:number):GameEvent[] {
 const w=new World();const shooter=new ServerPlayer(0,'test',{} as WebSocket);
 Object.assign(shooter,{x:0,y:0,z:0,yaw:0,pitch,aiming:true,weaponIdx:4,nextFireAt:0});
 const target=new ServerPlayer(1,'target',{} as WebSocket);
 target.x=0;target.z=distance;
 const events:GameEvent[]=[];
 resolveFire(w,shooter,[shooter,target],10,10000,events);
 return events;
}
assert.ok(!shootAt(0,350).some(e=>e.kind===EV_HIT),'a flat 350 m shot drops under the target');
assert.ok(shootAt(.032,350).some(e=>e.kind===EV_HIT),'aiming high at 350 m connects');

console.log('PASS: embedded floor recovery, solid walls, scoped hits to 200 m, and bullet drop at 350 m.');
