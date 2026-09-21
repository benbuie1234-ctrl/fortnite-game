import assert from 'node:assert/strict';
import * as THREE from 'three';
import { forwardVector, rightVector } from '../shared/src/vec';
import { stepPlayer, newMovementState } from '../shared/src/sim';
import { World } from '../shared/src/world';
for (const yaw of [0, .7, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  const camera = new THREE.PerspectiveCamera();
  camera.rotation.order = 'YXZ';
  camera.rotation.set(.3, Math.PI - yaw, 0);
  const forward = camera.getWorldDirection(new THREE.Vector3());
  assert.ok(forward.distanceTo(new THREE.Vector3(...forwardVector(yaw, .3))) < 1e-10);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  assert.ok(right.distanceTo(new THREE.Vector3(...rightVector(yaw))) < 1e-10);
  for (const [x,z] of [[0,1],[0,-1],[1,0],[-1,0]]) {
    const state = {...newMovementState(),yaw,grounded:true};
    stepPlayer(state,{seq:1,moveX:x,moveZ:z,yaw,pitch:0,buttons:0,slot:2},new World());
    const want = new THREE.Vector3(...forwardVector(yaw,0)).multiplyScalar(z).addScaledVector(right,x).normalize();
    assert.ok(new THREE.Vector3(state.vx,0,state.vz).normalize().distanceTo(want) < 1e-10);
  }
}
console.log('Camera, aim and WASD agree at five headings; all four movement directions pass.');
