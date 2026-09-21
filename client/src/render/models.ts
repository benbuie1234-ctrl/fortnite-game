import * as THREE from "three";

/**
 * Optional 3D models, loaded from `client/public/models/`.
 *
 * The whole point of this module is that it is **optional**. The game renders
 * perfectly well with no models at all -- it falls back to the procedural
 * boxes and cones it has always used -- and each model you drop in replaces
 * one of them. That means you can add art one piece at a time and never have
 * a broken build in between.
 *
 * Files are plain .glb, which is what every free asset site hands you and what
 * Blender exports by default. Nothing needs converting.
 *
 * To add art:
 *   1. Download a free pack (kenney.nl, quaternius.com, poly.pizza).
 *   2. Drop the .glb files into client/public/models/.
 *   3. List them in client/public/models/manifest.json.
 *
 * Without a manifest the loader does nothing at all, at the cost of a single
 * 404, and the game looks exactly as it does today.
 */

/** Logical slots the game knows how to use. Anything else is ignored. */
export type ModelId =
  | "tree" | "rock" | "house" | "crate" | "barrel"
  | "weapon_ar" | "weapon_shotgun" | "weapon_sniper" | "weapon_smg" | "weapon_pistol";

interface Manifest {
  /** Maps a logical slot to a .glb filename inside the models directory. */
  models?: Partial<Record<ModelId, string>>;
  /**
   * Per-model scale correction. Free packs vary wildly in units -- some are
   * in centimetres, some are a metre tall, some are 0.01. Rather than editing
   * files, correct it here.
   */
  scale?: Partial<Record<ModelId, number>>;
  /** Y offset, for models whose origin is not at their base. */
  offsetY?: Partial<Record<ModelId, number>>;
}

const MODELS_PATH = "/models";

export class ModelLibrary {
  private items = new Map<ModelId, THREE.Object3D>();

  constructor(private manifest: Manifest = {}) {}

  has(id: ModelId): boolean { return this.items.has(id); }

  /** A fresh clone, ready to place. Null when that slot has no model. */
  get(id: ModelId): THREE.Object3D | null {
    const source = this.items.get(id);
    if (!source) return null;
    const clone = source.clone(true);
    // Clone shares geometry and materials, which is what we want -- the cost
    // of an extra instance is a transform, not another copy of the mesh.
    return clone;
  }

  /** Count of slots actually filled, for logging and the loading indicator. */
  get size(): number { return this.items.size; }

  set(id: ModelId, object: THREE.Object3D): void {
    const scale = this.manifest.scale?.[id] ?? 1;
    const offsetY = this.manifest.offsetY?.[id] ?? 0;

    // Normalise into a wrapper so callers can scale and position the wrapper
    // without fighting whatever transform the artist baked into the file.
    const wrapper = new THREE.Group();
    object.scale.setScalar(scale);
    object.position.y += offsetY;
    wrapper.add(object);

    wrapper.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = true;
      node.receiveShadow = true;
      // Free packs frequently ship unlit or basic materials. Anything that
      // cannot take light from the environment map would sit in the scene
      // looking pasted on, so convert it.
      const mat = node.material as THREE.Material | THREE.Material[];
      node.material = Array.isArray(mat)
        ? mat.map(toPhysical)
        : toPhysical(mat);
    });

    this.items.set(id, wrapper);
  }
}

/** Convert whatever material a file shipped with into one that reacts to the scene. */
function toPhysical(material: THREE.Material): THREE.Material {
  if (material instanceof THREE.MeshStandardMaterial) {
    material.envMapIntensity = 0.9;
    return material;
  }
  const source = material as THREE.MeshBasicMaterial & { map?: THREE.Texture | null };
  const replacement = new THREE.MeshStandardMaterial({
    color: source.color ?? new THREE.Color(0xffffff),
    map: source.map ?? null,
    roughness: 0.85,
    metalness: 0,
    envMapIntensity: 0.9,
  });
  material.dispose();
  return replacement;
}

/**
 * Load whatever art is present. Never throws and never blocks the game: a
 * missing manifest, a missing file or a corrupt file all resolve to "that slot
 * keeps its procedural fallback".
 */
export async function loadModels(): Promise<ModelLibrary> {
  let manifest: Manifest;
  try {
    const res = await fetch(`${MODELS_PATH}/manifest.json`, { cache: "no-cache" });
    if (!res.ok) return new ModelLibrary();
    manifest = (await res.json()) as Manifest;
  } catch {
    // No manifest, offline, or invalid JSON. Procedural art it is.
    return new ModelLibrary();
  }

  const library = new ModelLibrary(manifest);
  const entries = Object.entries(manifest.models ?? {}) as Array<[ModelId, string]>;
  if (entries.length === 0) return library;

  // Imported dynamically so the glTF loader is only downloaded when there is
  // actually art to load. With no manifest the game stays at its original
  // bundle size and nobody pays for a feature they are not using.
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const loader = new GLTFLoader();
  await Promise.all(entries.map(async ([id, file]) => {
    try {
      const gltf = await loader.loadAsync(`${MODELS_PATH}/${file}`);
      library.set(id, gltf.scene);
    } catch {
      // One bad file must not take the rest of the art down with it.
      console.warn(`[models] could not load "${file}" for "${id}"; using the built-in shape`);
    }
  }));

  return library;
}

/**
 * An instanced copy of a loaded model.
 *
 * A forest needs thousands of trees, and drawing each as its own object would
 * cost thousands of draw calls. InstancedMesh draws them in one -- but it only
 * handles a single geometry, and a model is usually several (a trunk and a
 * canopy with different materials).
 *
 * So this builds one InstancedMesh per sub-mesh and drives them together. Each
 * sub-mesh's own transform within the model is baked into its geometry up
 * front, so a single placement matrix positions every part correctly.
 */
export class InstancedModel {
  private parts: THREE.InstancedMesh[] = [];

  constructor(model: THREE.Object3D, count: number) {
    model.updateWorldMatrix(true, true);
    model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const geometry = node.geometry.clone();
      // Bake the sub-mesh's position within the model into its vertices.
      geometry.applyMatrix4(node.matrixWorld);
      const material = Array.isArray(node.material) ? node.material[0] : node.material;
      const inst = new THREE.InstancedMesh(geometry, material, count);
      inst.castShadow = true;
      inst.receiveShadow = true;
      this.parts.push(inst);
    });
  }

  get valid(): boolean { return this.parts.length > 0; }

  setMatrixAt(index: number, matrix: THREE.Matrix4): void {
    for (const part of this.parts) part.setMatrixAt(index, matrix);
  }

  /** Per-instance tint, for colour variation across a forest. */
  setColorAt(index: number, color: THREE.Color): void {
    for (const part of this.parts) part.setColorAt(index, color);
  }

  addTo(scene: THREE.Scene): void {
    for (const part of this.parts) {
      part.instanceMatrix.needsUpdate = true;
      if (part.instanceColor) part.instanceColor.needsUpdate = true;
      part.computeBoundingSphere();
      scene.add(part);
    }
  }
}
