import assert from 'node:assert/strict';
import { World } from '../shared/src/world';
import { makePiece,currentHp,SLOT_RAMP,SLOT_WALL_Z,SLOT_FLOOR } from '../shared/src/build';
import { stepPlayer,BTN_JUMP,MovementState } from '../shared/src/sim';
const fresh=()=>({x:1.5,y:0,z:1.5,vx:0,vy:0,vz:0,yaw:0,pitch:0,grounded:true,lastLandingSpeed:0});
const command={seq:1,moveX:0,moveZ:1,yaw:0,pitch:0,buttons:BTN_JUMP,slot:2};
{
 const w=new World();w.set(makePiece(0,1,0,SLOT_RAMP,0,1,0,0));
 const s=fresh();stepPlayer(s,{...command,moveZ:0,buttons:0},w);
 assert.equal(s.y,0,'no teleport from below elevated ramps');
}
{
 const piece=makePiece(0,0,0,SLOT_WALL_Z,0,0,0,10);
 assert.equal(currentHp(piece,10),45);assert.equal(currentHp(piece,11),150,'build reaches full health');
 piece.hp=70;assert.equal(currentHp(piece,12),70,'damage persists');
}
{
 const w=new World();w.addObstacle([0,0,3,3,3,3.25],-50);
 const s:MovementState=fresh();let highest=0;
 for(let i=0;i<90;i++) {const before=s.y;stepPlayer(s,command,w);highest=Math.max(highest,s.y);assert.ok(s.y-before<.6,'climb has no vertical teleport');}
 assert.ok(highest>=3,'jump and forward mantles a reachable wall');
}
{
 const w=new World();w.addObstacle([0,0,3,3,3,3.25],-50);w.addObstacle([0,3,0,3,3.25,6],-51);
 const s=fresh();let highest=0;
 for(let i=0;i<60;i++){stepPlayer(s,command,w);highest=Math.max(highest,s.y);}
 assert.ok(highest<3,'ceiling blocks mantle');
}
console.log('PASS: no elevated-ramp teleport, build health growth and damage, gradual mantle and blocked headroom.');
