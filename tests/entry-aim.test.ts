import assert from 'node:assert/strict';
import { World } from '../shared/src/world';
import { makePiece,SLOT_FLOOR,SLOT_WALL_Z } from '../shared/src/build';
import { stepPlayer } from '../shared/src/sim';
import { cameraPose } from '../shared/src/camera';
import { ServerPlayer } from '../server/src/player';
import { resolveFire } from '../server/src/combat';
import { EV_HIT } from '../shared/src/protocol';
import type { GameEvent } from '../shared/src/snapshot';
// A floor intersection must settle vertically, never throw us to a tile edge.
for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
 const w=new World();w.set(makePiece(0,0,0,SLOT_FLOOR,2,0,255,0));
 const p={x:1.5,y:.1,z:1.5,vx:0,vy:0,vz:0,yaw,pitch:0,grounded:true,lastLandingSpeed:0};
 stepPlayer(p,{seq:1,moveX:0,moveZ:1,yaw,pitch:0,buttons:0,slot:2},w);
 assert.ok(Math.hypot(p.x-1.5,p.z-1.5)<.4,'floor overlap cannot eject player');
 assert.ok(p.y>.1,'feet settle above the floor');
}
const wall=new World();wall.set(makePiece(0,0,1,SLOT_WALL_Z,2,0,255,0));
const walker={x:1.5,y:0,z:1,vx:0,vy:0,vz:0,yaw:0,pitch:0,grounded:true,lastLandingSpeed:0};
for(let i=0;i<60;i++)stepPlayer(walker,{seq:i,moveX:0,moveZ:1,yaw:0,pitch:0,buttons:0,slot:2},wall);
assert.ok(walker.z<3,'ordinary walls still stop movement');
for(const distance of [5,50,200,350])for(const yaw of [0,.7,Math.PI/2]) {
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
console.log('PASS: embedded floor recovery, solid walls, and scoped hits from 5–350 metres.');
