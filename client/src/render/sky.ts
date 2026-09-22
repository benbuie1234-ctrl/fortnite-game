import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

/**
 * Sky, atmosphere and image-based lighting.
 *
 * This replaces `scene.background = <one flat colour>`, which was the single
 * biggest thing making the game look cheap: the sky is a third of every
 * outdoor frame, and a solid rectangle of one colour reads as cardboard no
 * matter how good everything under it is.
 *
 * Three things come out of here, and the second one matters more than the
 * first:
 *
 *  1. A physically-modelled sky gradient with a real sun and horizon haze.
 *  2. An environment map baked from that sky, so every surface is lit by the
 *     *whole sky* rather than by one directional light plus a constant fudge.
 *     Ambient light that varies by direction is what gives objects form --
 *     blue from above, warm bounce from below.
 *  3. A drifting cloud layer, so the sky has something in it.
 */

/** Sun angle. Low enough to rake across the world and throw long shadows,
 *  high enough that you can still see where you are going. */
/**
 * How much to dim the *visible* sky dome.
 *
 * The Sky shader outputs true HDR radiance -- values far above 1 -- because a
 * real sky genuinely is that much brighter than the ground under it. Fed
 * straight into ACES at the exposure the ground needs, the whole sky clips to
 * flat white.
 *
 * So the two are decoupled on purpose: the dome you look at gets an artistic
 * exposure, while the copy baked into the environment map keeps its full
 * energy so image-based lighting stays strong. Physically inconsistent,
 * correct for a game.
 */
const VISIBLE_SKY_INTENSITY = 0.2;

export const SUN_ELEVATION_DEG = 26;
export const SUN_AZIMUTH_DEG = 145;

export interface SkySystem {
  /** Unit vector pointing at the sun; the directional light must agree. */
  readonly sunDirection: THREE.Vector3;
  /** Sampled horizon colour, for fog that actually dissolves into the sky. */
  readonly horizonColor: THREE.Color;
  update(dt: number, camera: THREE.Camera): void;
  dispose(): void;
}

export function createSky(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
): SkySystem {
  const sky = new Sky();
  sky.scale.setScalar(20000);

  const u = sky.material.uniforms;
  u.turbidity.value = 4.5;       // haze; higher is dustier
  u.rayleigh.value = 2.0;        // blue scattering; drives how deep the zenith is
  u.mieCoefficient.value = 0.006;
  u.mieDirectionalG.value = 0.82; // tightness of the glow around the sun

  const sunDirection = directionFromAngles(SUN_ELEVATION_DEG, SUN_AZIMUTH_DEG);
  u.sunPosition.value.copy(sunDirection);
  dimVisibleSky(sky, VISIBLE_SKY_INTENSITY);

  scene.add(sky);

  // --- image-based lighting -------------------------------------------------
  // Bake the sky into a prefiltered environment map. Assigning it to
  // scene.environment means every physical material picks up light from the
  // whole hemisphere instead of a single flat ambient term.
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileCubemapShader();

  const skyScene = new THREE.Scene();
  const skyClone = new Sky();
  skyClone.scale.setScalar(20000);
  const cu = skyClone.material.uniforms;
  cu.turbidity.value = u.turbidity.value;
  cu.rayleigh.value = u.rayleigh.value;
  cu.mieCoefficient.value = u.mieCoefficient.value;
  cu.mieDirectionalG.value = u.mieDirectionalG.value;
  cu.sunPosition.value.copy(sunDirection);
  skyScene.add(skyClone);

  // The clone is deliberately NOT dimmed: it carries the sky's real energy
  // into the environment map. environmentIntensity then scales the ambient
  // contribution independently of how the sky looks.
  const envTarget = pmrem.fromScene(skyScene, 0.02, 0.1, 40000);
  scene.environment = envTarget.texture;
  // Sky light is the primary ambient source, so it carries real weight.
  // Deliberately small. The environment map is baked from the UNDIMMED sky,
  // whose radiance is many times greater than 1 -- so even a modest-looking
  // intensity here floods the scene with ambient and drowns out the sun's
  // contrast. That flood is what "bright and washed out" actually was.
  scene.environmentIntensity = 0.22;

  // --- fog colour -----------------------------------------------------------
  // Sample the sky just above the horizon rather than guessing, so distant
  // geometry fades into exactly the colour behind it and the horizon line
  // disappears instead of banding.
  const horizonColor = sampleSkyColor(renderer, skyScene, 0.045);

  skyClone.geometry.dispose();
  skyClone.material.dispose();

  // --- clouds ---------------------------------------------------------------
  const clouds = createCloudLayer();
  scene.add(clouds.mesh);

  return {
    sunDirection,
    horizonColor,
    update(dt: number, camera: THREE.Camera) {
      clouds.update(dt, camera);
    },
    dispose() {
      scene.remove(sky, clouds.mesh);
      sky.geometry.dispose();
      sky.material.dispose();
      clouds.dispose();
      envTarget.dispose();
      pmrem.dispose();
    },
  };
}

/**
 * Scale the sky shader's output in place. Sky is a ShaderMaterial and each
 * instance owns its own shader source, so patching the string before first
 * compile is safe and avoids an onBeforeCompile hook.
 */
function dimVisibleSky(sky: Sky, intensity: number): void {
  const marker = "gl_FragColor = vec4( retColor, 1.0 );";
  const material = sky.material as THREE.ShaderMaterial;
  if (!material.fragmentShader.includes(marker)) return; // upstream changed; leave it alone
  material.fragmentShader = material.fragmentShader.replace(
    marker,
    `gl_FragColor = vec4( retColor * ${intensity.toFixed(3)}, 1.0 );`,
  );
  material.needsUpdate = true;
}

/** Convert elevation/azimuth in degrees to a unit direction. */
function directionFromAngles(elevationDeg: number, azimuthDeg: number): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
  const theta = THREE.MathUtils.degToRad(azimuthDeg);
  return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
}

/**
 * Render the sky into a 1-pixel target looking at a given elevation and read
 * the colour back. Cheap, runs once, and beats hand-tuning a fog colour that
 * never quite matches.
 */
function sampleSkyColor(
  renderer: THREE.WebGLRenderer, skyScene: THREE.Scene, elevation: number,
): THREE.Color {
  // Renders the throwaway sky built for the environment bake. Sampling the
  // live one would mean reparenting it into a temporary scene, and in Three
  // `add()` removes an object from its previous parent -- which silently
  // orphans the real sky and leaves the game with a black background.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const cam = new THREE.PerspectiveCamera(10, 1, 0.1, 40000);
  cam.position.set(0, 0, 0);
  cam.lookAt(
    Math.sin(THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG + 90)) * 100,
    elevation * 100,
    Math.cos(THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG + 90)) * 100,
  );

  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(skyScene, cam);

  const buffer = new Uint16Array(4);
  let color = new THREE.Color(0xa9c9e4);
  try {
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, buffer);
    color = new THREE.Color(
      halfToFloat(buffer[0]),
      halfToFloat(buffer[1]),
      halfToFloat(buffer[2]),
    );
    // The sky is HDR; bring it into a sane range for fog and keep it from
    // going neon after tone mapping.
    const peak = Math.max(color.r, color.g, color.b, 1e-4);
    if (peak > 1) color.multiplyScalar(1 / peak);
  } catch {
    // Readback unsupported on this driver; the fallback above is close enough.
  }

  renderer.setRenderTarget(prevTarget);
  target.dispose();
  return color;
}

/** Decode an IEEE 754 half-precision float. */
function halfToFloat(h: number): number {
  const sign = (h & 0x8000) >> 15;
  const exponent = (h & 0x7c00) >> 10;
  const fraction = h & 0x03ff;
  let value: number;
  if (exponent === 0) value = fraction / 1024 * Math.pow(2, -14);
  else if (exponent === 31) value = fraction ? NaN : Infinity;
  else value = (1 + fraction / 1024) * Math.pow(2, exponent - 15);
  return sign ? -value : value;
}

// ---------------------------------------------------------------------------
// Clouds
// ---------------------------------------------------------------------------

interface CloudLayer {
  mesh: THREE.Mesh;
  update(dt: number, camera: THREE.Camera): void;
  dispose(): void;
}

/**
 * A flattened dome of cloud, locked to the camera.
 *
 * This was a flat 9 km plane parked at y = 900. The camera's far plane is 850,
 * so the plane was cut by it: looking up you saw cloud stop dead at a hard
 * circular edge partway to the zenith, with clear sky beyond -- clouds sitting
 * "slightly out of the field of view". Moving the plane closer would only have
 * moved the edge, because a finite horizontal plane always ends somewhere.
 *
 * A dome has no edge to find. It rides with the camera, so it is effectively
 * infinitely far away while staying well inside the far plane, and it is
 * squashed vertically so the clouds still read as a high flat ceiling rather
 * than a bowl.
 */
function createCloudLayer(): CloudLayer {
  const texture = cloudTexture();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Repeat is baked into the UVs below instead, so that the drift offset still
  // works on top of a projection this code controls.
  texture.repeat.set(1, 1);

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
    // Seen from the inside.
    side: THREE.BackSide,
    // Clouds must not receive fog, or they fade out along with the terrain.
    fog: false,
  });

  // Zenith down to just under the horizon, so there is no gap where the dome
  // meets the skyline.
  const geometry = new THREE.SphereGeometry(RADIUS, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.54);
  projectCloudUVs(geometry);
  // Fade out at the horizon, where planar UVs otherwise stretch into vertical curtains.
  const pos=geometry.getAttribute('position');const shades=[];
  for(let i=0;i<pos.count;i++){const a=THREE.MathUtils.smoothstep(pos.getY(i)/RADIUS,.12,.5);shades.push(1,1,1,a);}
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(shades,4));
  material.vertexColors=true;
  const mesh = new THREE.Mesh(geometry, material);
  // Flattened hard: a hemisphere of cloud would wrap down around the player.
  mesh.scale.set(1, 0.34, 1);
  mesh.renderOrder = -1;
  // Never culled: its bounding sphere is centred on the camera, which the
  // frustum test does not handle gracefully.
  mesh.frustumCulled = false;

  return {
    mesh,
    update(dt: number, camera: THREE.Camera) {
      texture.offset.x += dt * 0.0035;
      texture.offset.y += dt * 0.0012;
      // Ride with the camera so the dome can never be reached or clipped.
      mesh.position.copy(camera.position);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

/** Comfortably inside the camera's 850 m far plane. */
const RADIUS = 560;

/** Metres of sky per repeat of the cloud texture. */
const CLOUD_TILE = 210;

/**
 * Re-project the dome's UVs straight down from above.
 *
 * A sphere's own UVs converge on its pole, so every cloud tile met at the
 * zenith in a visible starburst -- look straight up and the sky had a seam
 * exactly where the eye goes. Projecting from the XZ plane instead has no
 * singularity anywhere, and it is also what clouds should look like: a flat
 * ceiling seen in perspective, stretching as it approaches the horizon.
 */
function projectCloudUVs(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute("position");
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) / CLOUD_TILE;
    uv[i * 2 + 1] = position.getZ(i) / CLOUD_TILE;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/** Soft, seamless cumulus-ish blobs on transparent background. */
function cloudTexture(): THREE.CanvasTexture {
  const SIZE = 512;
  const cv = document.createElement("canvas");
  cv.width = SIZE;
  cv.height = SIZE;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");

  ctx.clearRect(0, 0, SIZE, SIZE);

  let seed = 0x51ade;
  const rand = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 0x100000000;
  };

  // Each cloud is a cluster of soft radial blobs, drawn with wraparound so the
  // texture tiles without a visible seam across the sky.
  const clouds = 9;
  for (let c = 0; c < clouds; c++) {
    const cx = rand() * SIZE;
    const cy = rand() * SIZE;
    const scale = 0.55 + rand() * 0.9;
    const puffs = 7 + Math.floor(rand() * 7);

    for (let p = 0; p < puffs; p++) {
      const ox = (rand() - 0.5) * 120 * scale;
      const oy = (rand() - 0.5) * 55 * scale;
      const r = (22 + rand() * 40) * scale;
      const alpha = 0.16 + rand() * 0.2;

      for (let wx = -1; wx <= 1; wx++) {
        for (let wy = -1; wy <= 1; wy++) {
          const px = cx + ox + wx * SIZE;
          const py = cy + oy + wy * SIZE;
          if (px < -r * 2 || px > SIZE + r * 2 || py < -r * 2 || py > SIZE + r * 2) continue;
          const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
          grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
          grad.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.55})`);
          grad.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
