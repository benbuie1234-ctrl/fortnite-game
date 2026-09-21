import assert from 'node:assert/strict';
import { World } from '../shared/src/world';
import { resolvePlacement,BUILD_CONE,BUILD_FLOOR,BUILD_RAMP,BUILD_WALL } from '../shared/src/placement';
import { makePiece,SLOT_RAMP,SLOT_WALL_Z,SLOT_FLOOR } from '../shared/src/build';
import { cameraPose } from '../shared/src/camera';
import { ServerPlayer } from '../server/src/player';
import { resolveFire,tryPlace,finishReloads } from '../server/src/combat';
import { EV_HIT } from '../shared/src/protocol';
import type { GameEvent } from '../shared/src/snapshot';
const p={x:1.5,y:0,z:1.5,yaw:0,pitch:0,buildSlot:BUILD_CONE};
assert.equal(resolvePlacement(p)!.gy,0,'cones sit on ground');
assert.equal(resolvePlacement({...p,pitch:-1,buildSlot:BUILD_FLOOR})!.gz,0,'look down builds underfoot');
assert.ok(resolvePlacement({...p,pitch:1,buildSlot:BUILD_WALL})!.gy>0,'look up builds upper walls');
const world=new World();world.set(makePiece(0,0,0,SLOT_RAMP,0,1,0,0));
for(const buildSlot of [BUILD_FLOOR,BUILD_RAMP]) {
 const target=resolvePlacement({...p,y:2,z:2,buildSlot},world)!;
 assert.equal(target.gy,1,'ramp exit continues at next level');assert.equal(target.gz,1,'next tile is beyond ramp');
}
for(let layer=0;layer<5;layer++) {
 const target=resolvePlacement({...p,y:layer*3+.25,buildSlot:BUILD_FLOOR},new World())!;
 assert.equal(target.gy,layer,'upper floors retain their layer');
}
function player(id:number) {return new ServerPlayer(id,'test',{} as WebSocket);}
const builder=player(0);Object.assign(builder,p,{buildSlot:BUILD_CONE});
const builds:GameEvent[]=[];assert.ok(tryPlace(new World(),builder,1,1000,builds),'ground cone accepted by server');
// An aimed zero-spread sniper must hit the target centered on the shoulder camera ray.
for(const yaw of [0,.7,Math.PI/2,Math.PI]) {
 const w=new World();const shooter=player(0);Object.assign(shooter,{x:0,y:0,z:0,yaw,pitch:0,aiming:true,weaponIdx:4});
 const pose=cameraPose(shooter,true,w,10);const target=player(1);
 target.x=pose.origin[0]+pose.forward[0]*15;target.z=pose.origin[2]+pose.forward[2]*15;
 target.y=.18;const events:GameEvent[]=[];
 resolveFire(w,shooter,[shooter,target],10,10000,events);
 assert.ok(events.some(e=>e.kind===EV_HIT),'crosshair hits target at heading '+yaw);
 assert.equal(shooter.ammo[4],0,'one shot consumes one round');
 const count=events.length;resolveFire(w,shooter,[shooter,target],10.01,10010,events);
 assert.equal(events.length,count,'cooldown prevents extra shots');
 finishReloads(shooter,13);assert.equal(shooter.ammo[4],1,'reload restores magazine');
}
// Cover between shooter and opponent blocks damage.
{
 const w=new World();w.set(makePiece(-1,0,1,SLOT_WALL_Z,2,0,255,0));w.set(makePiece(0,0,1,SLOT_WALL_Z,2,0,255,0));
 const shooter=player(0);shooter.weaponIdx=4;shooter.aiming=true;
 const target=player(1);target.z=10;const events:GameEvent[]=[];
 resolveFire(w,shooter,[shooter,target],10,10000,events);
 assert.equal(events.filter(e=>e.kind===EV_HIT).length,0,'cannot shoot through cover');
}
// Floors can share a grid cell with a ramp without blocking placement.
{
 const w=new World();const b=player(0);Object.assign(b,{x:1.5,z:1.5,buildSlot:BUILD_FLOOR});
 const target=resolvePlacement(b,w)!;w.set(makePiece(target.gx,target.gy,target.gz,SLOT_RAMP,0,1,0,0));
 assert.ok(tryPlace(w,b,1,1000,[]));assert.ok(w.get(target.gx,target.gy,target.gz,SLOT_FLOOR));
}
console.log('PASS: ground cones, underfoot floors, five build layers, ramp continuations, crosshair hits, ammo, reloads, cover and floor/ramp coexistence.');
