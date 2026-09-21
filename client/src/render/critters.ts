import * as THREE from "three";
import {
  CRITTERS, CRITTER_BIRD, critterAt, CritterState,
} from "@shared/critters";

/**
 * Birds and fish.
 *
 * Nothing here is networked. Every position comes from the shared path
 * function evaluated at the render clock, which is the same instant the server
 * validates shots at -- so what you see is what you can hit. The only state
 * that arrives from outside is which ones are currently down.
 *
 * Two instanced meshes, one draw call each. A flock of thirty objects that
 * each cost a draw call is thirty draw calls of nothing.
 */
export interface Critters {
  /** Advance the flock. `t` is the render time in seconds, on the server clock. */
  update(t: number, now: number): void;
  /** Mirror of the server's downed set, so a shot bird disappears. */
  readonly state: CritterState;
  /** World position of one critter right now, for hit sparks. */
  positionOf(index: number, t: number): THREE.Vector3 | null;
}

/** A bird: a body with two swept wings, built as one geometry so the whole
 *  flock is a single instanced mesh. */
function birdGeometry(): THREE.BufferGeometry {
  const body = new THREE.ConeGeometry(0.16, 0.82, 5);
  body.rotateX(Math.PI / 2);
  const wing = new THREE.BoxGeometry(1.5, 0.05, 0.34);
  const parts = [body, wing];
  return mergeGeometries(parts, [
    new THREE.Matrix4(),
    new THREE.Matrix4().makeTranslation(0, 0.05, -0.05),
  ]);
}

/** A fish: a tapered body and a tail fin. */
function fishGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.26, 8, 6);
  body.scale(0.55, 0.8, 1.7);
  const tail = new THREE.ConeGeometry(0.22, 0.4, 3);
  tail.rotateX(-Math.PI / 2);
  return mergeGeometries([body, tail], [
    new THREE.Matrix4(),
    new THREE.Matrix4().makeTranslation(0, 0, -0.5),
  ]);
}

/**
 * Minimal geometry merge.
 *
 * three/examples ships BufferGeometryUtils, but pulling an example module in
 * for two shapes costs more than the twenty lines it replaces, and this only
 * ever has to handle non-indexed position+normal geometry.
 */
function mergeGeometries(parts: THREE.BufferGeometry[], transforms: THREE.Matrix4[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  parts.forEach((part, i) => {
    const source = part.index ? part.toNonIndexed() : part;
    const pos = source.getAttribute("position");
    const nor = source.getAttribute("normal");
    const m = transforms[i];
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(m);
      positions.push(v.x, v.y, v.z);
      n.fromBufferAttribute(nor, k).applyMatrix3(normalMatrix).normalize();
      normals.push(n.x, n.y, n.z);
    }
    if (source !== part) source.dispose();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geo;
}

export function createCritters(scene: THREE.Scene): Critters {
  const birds = CRITTERS.map((c, i) => ({ c, i })).filter(e => e.c.kind === CRITTER_BIRD);
  const fish = CRITTERS.map((c, i) => ({ c, i })).filter(e => e.c.kind !== CRITTER_BIRD);

  const birdMesh = new THREE.InstancedMesh(
    birdGeometry(),
    new THREE.MeshStandardMaterial({ color: 0x2f3742, roughness: 0.85, metalness: 0 }),
    Math.max(1, birds.length),
  );
  const fishMesh = new THREE.InstancedMesh(
    fishGeometry(),
    new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.3, metalness: 0.45 }),
    Math.max(1, fish.length),
  );
  // Frustum culling off: the bounding sphere is computed from the geometry at
  // the origin, not from where the instances actually are, so leaving it on
  // makes the whole flock vanish depending on where you look.
  for (const mesh of [birdMesh, fishMesh]) {
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    scene.add(mesh);
  }

  const state = new CritterState();
  const dummy = new THREE.Object3D();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  /** Point the model along its own path and write its instance matrix. */
  function place(mesh: THREE.InstancedMesh, slot: number, index: number, t: number, flap: number): void {
    const p = critterAt(index, t);
    if (p === null) { mesh.setMatrixAt(slot, hidden); return; }
    // Heading comes from the path a moment later, so the model always faces
    // the way it is actually travelling without needing a stored velocity.
    const next = critterAt(index, t + 0.12)!;
    dummy.position.set(p.x, p.y, p.z);
    dummy.lookAt(next.x, next.y, next.z);
    // A wingbeat, as a roll. Cheap, and enough to read as alive at range.
    dummy.rotation.z = flap;
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    mesh.setMatrixAt(slot, dummy.matrix);
  }

  return {
    state,
    update(t, now) {
      birds.forEach((entry, slot) => {
        if (!state.alive(entry.i, now)) { birdMesh.setMatrixAt(slot, hidden); return; }
        place(birdMesh, slot, entry.i, t, Math.sin(t * 7 + entry.i) * 0.55);
      });
      fish.forEach((entry, slot) => {
        if (!state.alive(entry.i, now)) { fishMesh.setMatrixAt(slot, hidden); return; }
        place(fishMesh, slot, entry.i, t, Math.sin(t * 5 + entry.i) * 0.22);
      });
      birdMesh.instanceMatrix.needsUpdate = true;
      fishMesh.instanceMatrix.needsUpdate = true;
    },
    positionOf(index, t) {
      const p = critterAt(index, t);
      return p === null ? null : new THREE.Vector3(p.x, p.y, p.z);
    },
  };
}
