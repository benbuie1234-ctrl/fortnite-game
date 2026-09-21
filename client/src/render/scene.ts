import * as THREE from "three";
import { createLandscape } from "./landscape";

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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fc4e8);
  scene.fog = new THREE.Fog(0x8fc4e8, 120, 370);

  const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 850);

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
  const reach = 60;
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

  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  createLandscape(scene);

  function resize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", resize);

  return {
    renderer, scene, camera,
    maxAnisotropy: anisotropy,
    render: () => {
      sun.position.set(camera.position.x+38,camera.position.y+62,camera.position.z+26);
      sun.target.position.set(camera.position.x,camera.position.y,camera.position.z);
      renderer.render(scene,camera);
    },
    resize,
    setFov(fov: number) {
      if (Math.abs(camera.fov - fov) < 0.01) return;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    },
  };
}
