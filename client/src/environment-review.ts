// Development-only environment review: the real terrain, art and collisions,
// with a camera you can put anywhere. This is how the island gets looked at
// without walking to every corner of it in a live match.
import { createRenderer } from './render/scene';
import { loadModels } from './render/models';
import { PieceRenderer } from './render/pieces';
import { World } from '@shared/world';
import { buildArena } from '@shared/arena';
import { LOCATIONS, terrainHeight } from '@shared/map';

const models = await loadModels();
const view = createRenderer(document.getElementById('app')!, models);
const world = new World();
buildArena(world);
const pieces = new PieceRenderer(view.scene, view.maxAnisotropy);
pieces.sync(world, 0);

const select = document.getElementById('place') as unknown as HTMLSelectElement;
const distance = document.getElementById('distance') as HTMLInputElement;
const angle = document.getElementById('angle') as HTMLInputElement;
const height = document.getElementById('height') as HTMLInputElement;
LOCATIONS.forEach((l, i) => {
  const option = document.createElement('option');
  option.value = String(i);
  option.textContent = l.name;
  select.appendChild(option);
});

/** Set by the console to override the orbit camera entirely. */
let fixed: { from: [number, number, number]; at: [number, number, number] } | null = null;
let frames = 0, previous = performance.now();

function frame(t: number): void {
  requestAnimationFrame(frame);
  if (fixed) {
    view.camera.position.set(...fixed.from);
    view.camera.lookAt(...fixed.at);
  } else {
    const p = LOCATIONS[Number(select.value)] ?? LOCATIONS[0];
    const h = terrainHeight(p.x, p.z);
    const d = Number(distance.value), a = Number(angle.value) / 100;
    const lift = Number(height.value) / 100;
    view.camera.position.set(p.x + Math.sin(a) * d, h + d * lift + 3, p.z + Math.cos(a) * d);
    view.camera.lookAt(p.x, h + 6, p.z);
  }
  pieces.updateVisibility(view.camera.position.x, view.camera.position.z);
  view.render();
  frames++;
  if (t - previous > 1000) {
    const info = view.renderer.info;
    document.getElementById('metrics')!.textContent =
      `${models.size} models · ${Math.round(frames * 1000 / (t - previous))} fps · ${info.render.calls} draw calls · ${info.memory.geometries} geometries`;
    previous = t;
    frames = 0;
  }
}
requestAnimationFrame(frame);

interface ReviewApi {
  look(fx: number, fy: number, fz: number, tx: number, ty: number, tz: number): void;
  orbit(): void;
  ground(x: number, z: number): number;
  view: typeof view;
}
(window as unknown as { review: ReviewApi }).review = {
  look: (fx, fy, fz, tx, ty, tz) => { fixed = { from: [fx, fy, fz], at: [tx, ty, tz] }; },
  orbit: () => { fixed = null; },
  ground: (x, z) => terrainHeight(x, z),
  view,
};
