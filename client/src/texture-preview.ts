// Dev-only page: renders every procedural texture tiled 2x2 so seams are
// obvious, then renders real build pieces through the actual PieceRenderer so
// UV scaling and materials are verified on the geometry the game ships.
// Not part of the production build (Vite only builds index.html).
import * as THREE from "three";
import { getTextures } from "./render/textures";
import { PieceRenderer } from "./render/pieces";
import { World } from "@shared/world";
import {
  makePiece, SLOT_FLOOR, SLOT_RAMP, SLOT_CONE, SLOT_WALL_X, type Slot,
} from "@shared/build";
import { MATERIALS } from "@shared/constants";
import { ARENA_LOADOUT, weaponById } from "@shared/weapons";
import { Sound } from "./audio/sound";

// ---------------------------------------------------------------------------
// Flat swatches
// ---------------------------------------------------------------------------

const grid = document.getElementById("grid")!;
const tex = getTextures(1);

const swatches: Array<[string, HTMLCanvasElement]> = [
  ["wood", tex.build[0].image as HTMLCanvasElement],
  ["brick", tex.build[1].image as HTMLCanvasElement],
  ["metal", tex.build[2].image as HTMLCanvasElement],
  ["grass", tex.grass.image as HTMLCanvasElement],
  ["concrete", tex.concrete.image as HTMLCanvasElement],
];

for (const [name, src] of swatches) {
  const fig = document.createElement("figure");
  const out = document.createElement("canvas");
  const size = 220;
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d")!;
  // Draw the source four times to expose any seam at the wrap point.
  for (let x = 0; x < 2; x++) {
    for (let y = 0; y < 2; y++) {
      ctx.drawImage(src, (x * size) / 2, (y * size) / 2, size / 2, size / 2);
    }
  }
  const cap = document.createElement("figcaption");
  cap.textContent = `${name} — ${src.width}x${src.height}, tiled 2x2`;
  fig.appendChild(out);
  fig.appendChild(cap);
  grid.appendChild(fig);
}

// ---------------------------------------------------------------------------
// Live 3D: one of every piece, in every material
// ---------------------------------------------------------------------------

const mount = document.getElementById("scene")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(mount.clientWidth, 460);
renderer.outputColorSpace = THREE.SRGBColorSpace;
mount.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc4e8);
scene.add(new THREE.HemisphereLight(0xbfdcf5, 0x4a5a48, 1.15));
scene.add(new THREE.AmbientLight(0xffffff, 0.42));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
sun.position.set(38, 62, 26);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshLambertMaterial({ map: tex.grass }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / 460, 0.1, 400);

// Build one row per material, one column per piece type, through the real
// World + PieceRenderer path the game uses.
const world = new World();
const slots: Slot[] = [SLOT_WALL_X, SLOT_FLOOR, SLOT_RAMP, SLOT_CONE];
for (let mat = 0; mat < MATERIALS.length; mat++) {
  for (let i = 0; i < slots.length; i++) {
    // placedAt far in the past so the grow-in animation is already complete.
    world.set(makePiece(i * 2, 0, mat * 2, slots[i], mat, 0, 1, -1000));
  }
}

const pieces = new PieceRenderer(scene, renderer.capabilities.getMaxAnisotropy());
pieces.sync(world, 0);

const labels = document.getElementById("labels")!;
labels.textContent = MATERIALS.map((m) => m.name).join("  /  ")
  + "   rows, front to back   ·   wall, floor, ramp, cone   columns, left to right";

const centre = new THREE.Vector3(9, 1.5, 3);
let angle = 0.6;
function loop(): void {
  requestAnimationFrame(loop);
  // This page used to spin and redraw forever, heating the machine even while
  // nobody was looking at it. Skip the work whenever the tab is hidden.
  if (document.hidden) return;
  angle += 0.0035;
  const r = 24;
  camera.position.set(
    centre.x + Math.sin(angle) * r,
    12,
    centre.z + Math.cos(angle) * r,
  );
  camera.lookAt(centre);
  renderer.render(scene, camera);
}
loop();

// ---------------------------------------------------------------------------
// Audio test bench
//
// Every sound is synthesised, so there is nothing to listen to in a file
// browser. These buttons are the only practical way to audition and tune them.
// ---------------------------------------------------------------------------


const sound = new Sound();
const audioPanel = document.getElementById("audio")!;
const status = document.getElementById("audioStatus")!;

function refreshStatus(): void {
  status.textContent = `AudioContext: ${sound.state}${sound.isMuted ? " (muted)" : ""}`;
}
refreshStatus();

function button(label: string, fn: () => void): void {
  const b = document.createElement("button");
  b.textContent = label;
  b.addEventListener("click", () => {
    // Every button doubles as a user gesture, so audio can start from any of them.
    sound.init();
    if (sound.isMuted) sound.setMuted(false);
    sound.setListener(0, 0, 0, 0);
    fn();
    refreshStatus();
  });
  audioPanel.appendChild(b);
}

for (const id of ARENA_LOADOUT) {
  button(weaponById(id).name, () => sound.shot(id, 0, 0, 3));
}
button("build", () => sound.build(0, 0, 3));
button("destroy", () => sound.destroy(0, 0, 3));
button("hitmarker", () => sound.hitmarker(false));
button("headshot", () => sound.hitmarker(true));
button("damage", () => sound.damage());
button("step", () => sound.step(0, 0, 2));
button("jump", () => sound.jump(0, 0, 2));
button("land (soft)", () => sound.land(0, 0, 2, 6));
button("land (hard)", () => sound.land(0, 0, 2, 20));
button("death", () => sound.death(0, 0, 4));
button("respawn", () => sound.respawn());
button("round win", () => sound.win());

// Panning check: the same sound from the left, centre and right.
button("pan L-C-R", () => {
  sound.shot(0, -12, 0, 0);
  setTimeout(() => sound.shot(0, 0, 0, 12), 380);
  setTimeout(() => sound.shot(0, 12, 0, 0), 760);
});
