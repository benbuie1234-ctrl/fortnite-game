import assert from 'node:assert/strict';
import { cameraPose, CAMERA_RADIUS, easeCameraDistance } from '../shared/src/camera';
import { World } from '../shared/src/world';
import { EYE_HEIGHT } from '../shared/src/constants';

const player={x:0,y:0,z:0,yaw:0,pitch:0};
const open=cameraPose(player,false,new World(),0);
assert.ok(open.origin[2]<-3,'open space keeps the full third-person boom');
const room=new World();
room.addObstacle([-4,0,-1.1,4,4,-1],-2);
for(const aiming of [false,true]) {
  const pose=cameraPose(player,aiming,room,0);
  assert.ok(pose.origin[2]>=-1+CAMERA_RADIUS,'camera stays inside the room');
}
// A wall beside the boom misses the centre ray but clips the near-plane edge.
const side=new World();
side.addObstacle([.7,0,-4,1,4,0],-3);
assert.ok(cameraPose(player,false,side,0).origin[0]<.7-CAMERA_RADIUS);
const ceiling=new World();
ceiling.addObstacle([-4,2.4,-4,4,2.6,4],-4);
const up=cameraPose({...player,pitch:-.7},false,ceiling,0);
assert.ok(up.origin[1]<=2.4-CAMERA_RADIUS);
assert.ok(up.origin[1]>=EYE_HEIGHT);
const down=cameraPose({...player,pitch:.8},false,new World(),0);
assert.ok(down.origin[1]>=CAMERA_RADIUS,'camera stays above ground');
assert.equal(easeCameraDistance(3.4,.4,1/60),.4,'obstructions retract instantly');
const recovering=easeCameraDistance(.4,3.4,1/60);
assert.ok(recovering>.4&&recovering<1,'cleared walls restore distance gradually');
console.log('PASS: camera room walls, near-plane edges, ceiling, ground, and smooth recovery.');
