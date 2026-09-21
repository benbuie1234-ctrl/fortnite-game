import * as THREE from "three";
import { CARS, CAR_LENGTH, CAR_WIDTH, CAR_HEIGHT, terrainHeight } from "@shared/map";

/**
 * Parked sports cars.
 *
 * Built from primitives rather than loaded, like everything else in this
 * project -- there are no binary assets, so a car has to be a shape the code
 * can describe. A low wedge with a cab set back, fat wheels and a small
 * spoiler is enough silhouette to read as "sports car" at the distance anyone
 * will actually see one from.
 *
 * One instanced mesh per part, so the whole car park is six draw calls however
 * many cars the map has. Body parts take the car's colour per instance; glass
 * and rubber are shared.
 */
export function createCars(scene: THREE.Scene): void {
  if (CARS.length === 0) return;

  const L = CAR_LENGTH, W = CAR_WIDTH, H = CAR_HEIGHT;

  // Car-local space: +Z is forward, +Y up, sitting on y=0.
  const hull = new THREE.BoxGeometry(W, H * 0.42, L);
  const nose = new THREE.BoxGeometry(W * 0.88, H * 0.2, L * 0.34);
  const cabin = new THREE.BoxGeometry(W * 0.8, H * 0.34, L * 0.4);
  const glass = new THREE.BoxGeometry(W * 0.74, H * 0.3, L * 0.38);
  const spoiler = new THREE.BoxGeometry(W * 0.92, H * 0.06, L * 0.1);
  const wheel = new THREE.CylinderGeometry(H * 0.32, H * 0.32, W * 0.16, 14);
  wheel.rotateZ(Math.PI / 2);

  const paint = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.28, metalness: 0.55, envMapIntensity: 1.2,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.9, metalness: 0 });
  const tint = new THREE.MeshStandardMaterial({
    color: 0x1b2833, roughness: 0.12, metalness: 0.3, envMapIntensity: 1.5,
  });

  const painted: Array<[THREE.BufferGeometry, THREE.Vector3]> = [
    [hull, new THREE.Vector3(0, H * 0.34, 0)],
    [nose, new THREE.Vector3(0, H * 0.2, L * 0.31)],
    [cabin, new THREE.Vector3(0, H * 0.7, -L * 0.06)],
    [spoiler, new THREE.Vector3(0, H * 0.72, -L * 0.47)],
  ];

  const car = new THREE.Object3D();
  const part = new THREE.Object3D();

  const meshes: THREE.InstancedMesh[] = [];
  for (const [geometry, offset] of painted) {
    const mesh = new THREE.InstancedMesh(geometry, paint, CARS.length);
    CARS.forEach((c, i) => {
      placeCar(car, c);
      part.position.copy(offset);
      part.rotation.set(0, 0, 0);
      part.updateMatrix();
      mesh.setMatrixAt(i, car.matrix.clone().multiply(part.matrix));
      mesh.setColorAt(i, new THREE.Color(c.color));
    });
    meshes.push(mesh);
  }

  const glassMesh = new THREE.InstancedMesh(glass, tint, CARS.length);
  CARS.forEach((c, i) => {
    placeCar(car, c);
    part.position.set(0, H * 0.72, -L * 0.06);
    part.rotation.set(0, 0, 0);
    part.updateMatrix();
    glassMesh.setMatrixAt(i, car.matrix.clone().multiply(part.matrix));
  });
  meshes.push(glassMesh);

  // Four wheels per car, all in one batch.
  const wheels = new THREE.InstancedMesh(wheel, dark, CARS.length * 4);
  CARS.forEach((c, i) => {
    placeCar(car, c);
    let slot = 0;
    for (const dz of [L * 0.33, -L * 0.33]) {
      for (const dx of [W * 0.46, -W * 0.46]) {
        part.position.set(dx, H * 0.32, dz);
        part.rotation.set(0, 0, 0);
        part.updateMatrix();
        wheels.setMatrixAt(i * 4 + slot, car.matrix.clone().multiply(part.matrix));
        slot++;
      }
    }
  });
  meshes.push(wheels);

  for (const mesh of meshes) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
}

/** Put the car's own frame on the ground at its map position. */
function placeCar(car: THREE.Object3D, c: { x: number; z: number; yaw: number }): void {
  car.position.set(c.x, terrainHeight(c.x, c.z), c.z);
  car.rotation.set(0, c.yaw, 0);
  car.updateMatrix();
}
