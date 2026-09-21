import assert from 'node:assert/strict';
import {World} from '../shared/src/world';
import {makePiece,SLOT_RAMP} from '../shared/src/build';
import {stepPlayer,BTN_JUMP} from '../shared/src/sim';
import {TILE} from '../shared/src/constants';
const world=new World();world.set(makePiece(0,0,0,SLOT_RAMP,0,0,0,0));
const cmd={seq:1,moveX:0,moveZ:0,yaw:0,pitch:0,buttons:0,slot:2};
const player=(x:number,y:number,z:number)=>({x,y,z,vx:0,vy:0,vz:0,yaw:0,pitch:0,grounded:true,lastLandingSpeed:0});
for(const [z,direction] of [[-1,1],[TILE+1,-1]]) {
 const p=player(TILE-.4,0,z);
 for(let i=0;i<45;i++)stepPlayer(p,{...cmd,moveZ:direction},world);
 assert.ok(z<0?p.z<0:p.z>TILE,'cannot walk through either tall side');
}
const back=player(TILE+1,0,TILE/2);
for(let i=0;i<45;i++)stepPlayer(back,{...cmd,moveX:1},world);
assert.ok(back.x>TILE,'cannot walk through the high back face');
const jumper=player(TILE/2,TILE/2,TILE/2);
stepPlayer(jumper,{...cmd,buttons:BTN_JUMP},world);
assert.ok(jumper.y>TILE/2,'jump leaves the slope');
for(let i=0;i<90;i++)stepPlayer(jumper,cmd,world);
assert.ok(jumper.y>=TILE/2-.01,'jump lands back on ramp');
assert.ok(jumper.grounded);
console.log('PASS: jump landing and solid ramp side/back faces.');
