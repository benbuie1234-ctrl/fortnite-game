import * as THREE from "three";
import { createLandscape } from "./landscape";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/** Sky and fog share one colour so the horizon dissolves instead of banding. */
const SKY_COLOR = 0x9fd0f5;

export interface Renderer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  render(): void;
  resize(): void;
  setFov(fov: number): void;
  /** Bloom costs a fullscreen pass; off on low quality. */
  setBloom(enabled: boolean): void;
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

  // Filmic highlight rolloff. Without it, anything bright clips straight to
  // flat white -- the sky and sunlit grass were doing exactly that, which is
  // most of why the scene read as "untextured prototype" rather than "game".
  // ACES darkens the midtones, so every light below is brighter to compensate.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, 120, 370);

  const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 850);

  // --- lighting -------------------------------------------------------------
  //
  // The whole look rests on a warm/cool split. Sunlight is warm; everything
  // filling the shadows is COOL BLUE, never white. That single choice is what
  // separates a stylised game from a grey prototype: in Fortnite a shadow is
  // blue, not a darker version of the surface colour. Nothing is ever allowed
  // to fall to black.
  const hemi = new THREE.HemisphereLight(0xa8d4ff, 0x7a8a5c, 0.9);
  scene.add(hemi);

  // Cool fill so faces turned away from the sun stay readable and tinted
  // rather than going dead grey. This used to be white, which is what made
  // the inside of a built box look muddy.
  //
  // Kept deliberately low. Fill light is what kills contrast, and without
  // contrast there is no shadow for the warm/cool split to show up in -- the
  // first pass at these numbers came out flat and milky.
  scene.add(new THREE.AmbientLight(0x7d9ecb, 0.28));

  const sun = new THREE.DirectionalLight(0xfff0cc, 3.0);
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

  // --- bloom ----------------------------------------------------------------
  //
  // Kept deliberately subtle: threshold is high so only genuinely bright
  // pixels glow, which is roughly how much bloom a stylised game wants.
  // Turning the whole scene hazy is the usual way this effect gets abused.
  //
  // Tone mapping is safe here. Three only applies it when rendering to the
  // canvas (currentRenderTarget === null), so RenderPass writes linear colour,
  // bloom operates on linear colour, and OutputPass tone maps exactly once at
  // the end. Rendering the composer AND leaving renderer.toneMapping set does
  // not double-apply.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.28, // strength
    0.5,  // radius
    0.85, // threshold
  ));
  composer.addPass(new OutputPass());

  let bloomEnabled = true;

  function resize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", resize);

  return {
    renderer, scene, camera,
    maxAnisotropy: anisotropy,
    render: () => {
      sun.position.set(camera.position.x+38,camera.position.y+62,camera.position.z+26);
      sun.target.position.set(camera.position.x,camera.position.y,camera.position.z);
      if (bloomEnabled) composer.render();
      else renderer.render(scene, camera);
    },
    resize,
    setBloom(enabled: boolean) {
      bloomEnabled = enabled;
    },
    setFov(fov: number) {
      if (Math.abs(camera.fov - fov) < 0.01) return;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    },
  };
}
