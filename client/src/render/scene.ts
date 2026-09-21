import * as THREE from "three";
import { TILE } from "@shared/constants";
import { ARENA_HALF_TILES } from "@shared/arena";
import { getTextures } from "./textures";

export interface Renderer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  render(): void;
  resize(): void;
  setFov(fov: number): void;
  /** Passed to the texture builder; depends on the GPU. */
  maxAnisotropy: number;
}

export function createRenderer(mount: HTMLElement): Renderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  // Cap at 2: school laptops with high-DPI screens will otherwise render 4x
  // the pixels for no visible gain.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fc4e8);
  scene.fog = new THREE.Fog(0x8fc4e8, 60, 190);

  const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 400);

  // --- lighting -------------------------------------------------------------
  // Hemisphere for cheap ambient bounce, one directional for shape and shadow.
  const hemi = new THREE.HemisphereLight(0xbfdcf5, 0x4a5a48, 1.15);
  scene.add(hemi);

  // Without this, wall faces turned away from the sun read as near-black and
  // the inside of a built box becomes unreadable.
  scene.add(new THREE.AmbientLight(0xffffff, 0.42));

  const sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
  sun.position.set(38, 62, 26);
  sun.castShadow = true;
  // The arena is small and fixed, so the shadow frustum can wrap it tightly.
  // That keeps a 1024 map looking sharp instead of blocky.
  const reach = (ARENA_HALF_TILES + 3) * TILE;
  sun.shadow.camera.left = -reach;
  sun.shadow.camera.right = reach;
  sun.shadow.camera.top = reach;
  sun.shadow.camera.bottom = -reach;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 180;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  // --- ground ---------------------------------------------------------------
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const tex = getTextures(anisotropy);

  const groundSize = (ARENA_HALF_TILES + 1) * TILE * 2;
  const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
  // A PlaneGeometry's UVs span 0..1 across the whole plane, so scale them to
  // get one grass tile every couple of metres instead of one enormous stretch.
  tileUVs(groundGeo, groundSize, groundSize, 2.5);
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshLambertMaterial({ map: tex.grass }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // A subtle grid makes the build lattice readable, which matters a lot when
  // you are learning where a wall is about to land.
  const grid = new THREE.GridHelper(
    groundSize, groundSize / TILE, 0x4e6b3f, 0x5c7a4b,
  );
  grid.position.y = 0.02;
  (grid.material as THREE.Material).opacity = 0.16;
  (grid.material as THREE.Material).transparent = true;
  scene.add(grid);

  // Skirt beyond the arena so the horizon is not an abrupt edge.
  const skirtGeo = new THREE.PlaneGeometry(900, 900);
  tileUVs(skirtGeo, 900, 900, 2.5);
  const skirt = new THREE.Mesh(
    skirtGeo,
    new THREE.MeshLambertMaterial({ map: tex.grass, color: 0xbfc9b4 }),
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = -0.4;
  scene.add(skirt);

  function resize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", resize);

  return {
    renderer, scene, camera,
    maxAnisotropy: anisotropy,
    render: () => renderer.render(scene, camera),
    resize,
    setFov(fov: number) {
      if (Math.abs(camera.fov - fov) < 0.01) return;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    },
  };
}

/** Scale a plane's 0..1 UVs so one texture tile covers `metersPerTile`. */
function tileUVs(
  geo: THREE.BufferGeometry, w: number, h: number, metersPerTile: number,
): void {
  const uv = geo.getAttribute("uv");
  if (!uv) return;
  const ru = w / metersPerTile;
  const rv = h / metersPerTile;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
  }
  uv.needsUpdate = true;
}
