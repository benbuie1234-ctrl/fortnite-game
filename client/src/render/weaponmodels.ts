import * as THREE from "three";
import { W_AR, W_SHOTGUN, W_SNIPER, W_SMG, W_PISTOL, W_PICKAXE } from "@shared/weapons";

/**
 * Procedural weapon models.
 *
 * Every weapon used to be the same featureless box, which is a problem because
 * the gun in your hands is on screen in literally every frame of the game. It
 * is the single most-looked-at object and it had no shape at all.
 *
 * These are built from primitives rather than loaded from files, so they cost
 * nothing to download and each weapon reads differently at a glance --
 * silhouette is what tells you what you are holding, long before any texture
 * would.
 *
 * Local space convention: the weapon points along +Z (forward), the grip is
 * near the origin, and +Y is up. The character rig positions the whole group.
 */

const METAL = new THREE.MeshStandardMaterial({
  color: 0x2b3038, roughness: 0.42, metalness: 0.75, envMapIntensity: 0.9,
});
const POLYMER = new THREE.MeshStandardMaterial({
  color: 0x1f242b, roughness: 0.78, metalness: 0.05, envMapIntensity: 0.85,
});
const WOOD = new THREE.MeshStandardMaterial({
  color: 0x6b4526, roughness: 0.8, metalness: 0, envMapIntensity: 0.85,
});
const ACCENT = new THREE.MeshStandardMaterial({
  color: 0x8a939e, roughness: 0.35, metalness: 0.8, envMapIntensity: 1.0,
});
const GLASS = new THREE.MeshStandardMaterial({
  color: 0x6fb6d8, roughness: 0.1, metalness: 0.3, envMapIntensity: 1.6,
});

/** Add a box part. Sizes and position are in metres, in weapon-local space. */
function part(
  group: THREE.Group, material: THREE.Material,
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  rotX = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  if (rotX !== 0) mesh.rotation.x = rotX;
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

function cylinder(
  group: THREE.Group, material: THREE.Material,
  radius: number, length: number,
  x: number, y: number, z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), material);
  // Cylinders are built along +Y; lay it along +Z to point forward.
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

/**
 * Build the model for a weapon id. Each silhouette is exaggerated a little,
 * the way stylised games do, so it is readable at a distance and in a
 * third-person camera where the gun is small on screen.
 */
export function createWeaponModel(weaponId: number): THREE.Group {
  const g = new THREE.Group();

  switch (weaponId) {
    case W_SHOTGUN: {
      // Short, fat, wooden. Reads as heavy.
      cylinder(g, METAL, 0.045, 0.62, 0, 0.02, 0.30);
      cylinder(g, METAL, 0.038, 0.60, 0, -0.045, 0.29); // under-barrel tube
      part(g, WOOD, 0.075, 0.09, 0.26, 0, -0.01, 0.06);   // receiver
      part(g, WOOD, 0.06, 0.16, 0.10, 0, -0.10, -0.06);   // grip
      part(g, WOOD, 0.065, 0.10, 0.28, 0, -0.03, -0.24);  // stock
      part(g, POLYMER, 0.05, 0.05, 0.10, 0, -0.06, 0.20); // pump
      break;
    }
    case W_SNIPER: {
      // Very long barrel and a big scope: unmistakable in silhouette.
      cylinder(g, METAL, 0.026, 0.95, 0, 0.02, 0.48);
      part(g, POLYMER, 0.07, 0.10, 0.34, 0, -0.01, 0.05);
      part(g, POLYMER, 0.055, 0.16, 0.09, 0, -0.10, -0.06);
      part(g, POLYMER, 0.06, 0.12, 0.30, 0, -0.02, -0.26);
      // Scope, raised on rings.
      cylinder(g, METAL, 0.032, 0.30, 0, 0.115, 0.10);
      part(g, METAL, 0.02, 0.05, 0.02, 0, 0.07, 0.00);
      part(g, METAL, 0.02, 0.05, 0.02, 0, 0.07, 0.20);
      const lens = cylinder(g, GLASS, 0.028, 0.02, 0, 0.115, 0.25);
      lens.castShadow = false;
      break;
    }
    case W_SMG: {
      // Compact, boxy, with a long magazine hanging down.
      cylinder(g, METAL, 0.024, 0.26, 0, 0.015, 0.20);
      part(g, POLYMER, 0.06, 0.10, 0.26, 0, 0, 0.04);
      part(g, POLYMER, 0.05, 0.15, 0.07, 0, -0.10, -0.03);
      part(g, POLYMER, 0.045, 0.20, 0.05, 0, -0.13, 0.08); // magazine
      part(g, METAL, 0.035, 0.035, 0.16, 0, 0.055, -0.10); // folding stock
      break;
    }
    case W_PISTOL: {
      cylinder(g, METAL, 0.018, 0.14, 0, 0.015, 0.11);
      part(g, POLYMER, 0.045, 0.075, 0.20, 0, 0.01, 0.03);
      part(g, POLYMER, 0.042, 0.15, 0.06, 0, -0.09, -0.03);
      part(g, ACCENT, 0.012, 0.018, 0.012, 0, 0.055, 0.11); // front sight
      break;
    }
    case W_PICKAXE: {
      // A tool, not a gun: long handle with a wedge head across the top.
      cylinder(g, WOOD, 0.022, 0.72, 0, 0.02, 0.18);
      const head = part(g, ACCENT, 0.30, 0.055, 0.07, 0, 0.03, 0.50);
      head.rotation.z = 0.12;
      part(g, ACCENT, 0.09, 0.05, 0.05, 0.13, 0.03, 0.50);
      break;
    }
    case W_AR:
    default: {
      // Mid-length barrel, carry handle, angled magazine. The default read.
      cylinder(g, METAL, 0.024, 0.46, 0, 0.02, 0.33);
      part(g, POLYMER, 0.065, 0.10, 0.34, 0, 0, 0.06);      // receiver
      part(g, POLYMER, 0.055, 0.15, 0.08, 0, -0.10, -0.05); // grip
      part(g, POLYMER, 0.06, 0.11, 0.26, 0, 0.005, -0.26);  // stock
      const mag = part(g, POLYMER, 0.045, 0.19, 0.07, 0, -0.12, 0.10);
      mag.rotation.x = -0.28;                                // angled magazine
      part(g, METAL, 0.03, 0.045, 0.22, 0, 0.075, 0.06);    // carry handle
      part(g, ACCENT, 0.012, 0.03, 0.012, 0, 0.055, 0.30);  // front sight
      break;
    }
  }

  return g;
}

/** Dispose a model's geometry. Materials are shared and deliberately kept. */
export function disposeWeaponModel(group: THREE.Group): void {
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) node.geometry.dispose();
  });
}
