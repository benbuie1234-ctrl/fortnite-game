import * as THREE from "three";
import { createLandscape } from "./landscape";
import { createSky } from "./sky";
import { createGradePass } from "./grade";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/** How far the sun sits from the player; also sizes the shadow frustum. */
const SUN_DISTANCE = 170;

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
  // Pulled down from 1.0. The image was sitting almost entirely in the upper
  // midtones, which is what made it look milky. Exposure controls overall
  // brightness; the ambient floor below controls how dark the darkest parts
  // are allowed to get. Those are separate problems and need separate knobs --
  // dimming the fill to fix washout is what produced black shadows last time.
  renderer.toneMappingExposure = 0.95;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // Sky, atmosphere and image-based lighting. Must exist before the fog, which
  // samples the real horizon colour out of it.
  const skySystem = createSky(renderer, scene);

  // Exponential fog, tuned so distance actually reads. The old linear fog
  // started at 120m and barely engaged, which is why far hills looked exactly
  // as solid as near ones -- no aerial perspective, no depth. Colour comes
  // from the sky itself, so the horizon line dissolves instead of banding.
  scene.fog = new THREE.FogExp2(skySystem.horizonColor.getHex(), 0.0022);

  const clock = new THREE.Clock();
  const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 850);

  // --- lighting -------------------------------------------------------------
  //
  // The whole look rests on a warm/cool split. Sunlight is warm; everything
  // filling the shadows is COOL BLUE, never white. That single choice is what
  // separates a stylised game from a grey prototype: in Fortnite a shadow is
  // blue, not a darker version of the surface colour. Nothing is ever allowed
  // to fall to black.
  // Only a whisper of hemisphere now. scene.environment carries the real
  // ambient, and it varies by direction -- blue from the sky above, warm
  // bounce from the ground below -- which a constant term never could. Leaving
  // the old values in would double-count and flatten it straight back out.
  // A real ambient floor, not a whisper. Two reasons it has to be this high:
  // image-based lighting only reaches physical materials, so anything else
  // depends entirely on this; and more importantly, shade should be *lit* --
  // cool and full of colour -- rather than an absence of light. Blacking out
  // every surface facing away from the sun is not contrast, it is missing
  // information.
  const hemi = new THREE.HemisphereLight(0xa8d4ff, 0x8a7a5c, 0.32);
  scene.add(hemi);


  // Contrast comes from how bright the LIT surfaces are, not from how dark the
  // shadows get. Pushing the sun and keeping a real ambient floor gives depth
  // and readable shade at the same time; darkening the fill would only trade
  // one problem for the other.
  const sun = new THREE.DirectionalLight(0xffeec4, 2.7);
  // Positioned along the sky's own sun direction, so the light and the sun you
  // can see in the sky agree. A low raking angle throws long shadows and gives
  // vertical surfaces form; the old near-overhead angle flattened everything.
  const sunDir = skySystem.sunDirection;
  sun.position.copy(sunDir).multiplyScalar(SUN_DISTANCE);
  sun.castShadow = true;
  // The arena is small and fixed, so the shadow frustum can wrap it tightly.
  // That keeps a 1024 map looking sharp instead of blocky.
  // A tight frustum that follows the player. 90m across a 2048 map is ~4.4cm
  // per texel, against ~12cm before -- the difference between a blob under
  // your feet and an actual shadow.
  const reach = 45;
  sun.shadow.camera.left = -reach;
  sun.shadow.camera.right = reach;
  sun.shadow.camera.top = reach;
  sun.shadow.camera.bottom = -reach;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = SUN_DISTANCE * 2.4;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
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
  // Grading runs last, on display-referred colour after tone mapping.
  composer.addPass(createGradePass());

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
      // Keep the shadow frustum centred on the player while holding the sun's
      // true direction, so shadows stay crisp wherever you are on the map.
      sun.position.set(
        camera.position.x + sunDir.x * SUN_DISTANCE,
        camera.position.y + sunDir.y * SUN_DISTANCE,
        camera.position.z + sunDir.z * SUN_DISTANCE,
      );
      sun.target.position.copy(camera.position);
      skySystem.update(clock.getDelta());
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
