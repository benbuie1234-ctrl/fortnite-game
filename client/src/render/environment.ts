import * as THREE from 'three';
import {
  BLUEPRINTS, BRIDGES, DECKS, PROPS, ROADS, LAKE, WATERFALL,
  terrainHeight, wallBoxes,
  type Blueprint, type Building, type Room, type Surface, type WallRun,
} from '@shared/map';
import { TILE } from '@shared/constants';
import { getTextures } from './textures';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Everything the island is built out of.
 *
 * The buildings are not decorated boxes: each one is drawn from its blueprint,
 * which is the same description the server collides against. A window here is a
 * window there, a doorway you can see is a doorway you can walk through, and a
 * room with a floor of its own is a room the furnisher can furnish.
 *
 * All of it goes through one instanced kit. A house is something like four
 * hundred separate pieces -- clapboards, frames, sills, shutters, rafters,
 * shingles, treads -- and drawing those as objects would cost more draw calls
 * than the rest of the game put together. Batching by material and by a
 * forty-eight metre cell keeps the call count in the low hundreds while letting
 * every piece carry its own colour and its own texture density.
 */

// ---------------------------------------------------------------------------
// The kit
// ---------------------------------------------------------------------------

type Shape = 'box' | 'round' | 'cyl' | 'cone' | 'stone' | 'plate';
type Finish =
  | 'plaster' | 'siding' | 'brick' | 'stone' | 'log' | 'metal' | 'concrete'
  | 'wood' | 'glass' | 'shingle' | 'tin' | 'pantile' | 'tar'
  | 'floorboard' | 'floorTile' | 'carpet' | 'dirt' | 'paint';

interface Part {
  shape?: Shape;
  finish?: Finish;
  yaw?: number;
  pitch?: number;
  roll?: number;
  /** Texture repeats across the piece. Defaults to one repeat per 2 metres. */
  uv?: number;
}

interface Batch {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  matrices: THREE.Matrix4[];
  colors: THREE.Color[];
  uvs: number[];
}

const SURFACE_FINISH: Record<Surface, Finish> = {
  siding: 'siding', plaster: 'plaster', brick: 'brick', stone: 'stone',
  log: 'log', metal: 'metal', concrete: 'concrete',
};

class Kit {
  private batches = new Map<string, Batch>();
  private shapes: Record<Shape, THREE.BufferGeometry>;
  private materials: Record<Finish, THREE.Material>;
  private scratch = { q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3() };

  constructor(anisotropy: number) {
    const t = getTextures(anisotropy);
    this.shapes = {
      box: new THREE.BoxGeometry(1, 1, 1),
      // Rounded boxes for anything hand-made: posts, rails, furniture. The
      // softened edge is most of what separates "carpentry" from "primitive".
      round: new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
      cone: new THREE.ConeGeometry(0.5, 1, 12),
      stone: new THREE.IcosahedronGeometry(0.5, 1),
      plate: new THREE.BoxGeometry(1, 1, 1),
    };
    const make = (
      map: THREE.Texture | null, roughness: number, metalness: number,
      normalMap: THREE.Texture | null = null, extra: Partial<THREE.MeshStandardMaterialParameters> = {},
    ): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({
      color: 0xffffff, map, normalMap,
      normalScale: normalMap ? new THREE.Vector2(0.8, 0.8) : undefined,
      roughness, metalness, envMapIntensity: 0.85, ...extra,
    });
    this.materials = {
      plaster: make(t.plaster, 0.94, 0),
      siding: make(t.siding, 0.88, 0, t.sidingNormal),
      brick: make(t.build[1], 0.95, 0),
      stone: make(t.rubble, 0.96, 0, t.rubbleNormal),
      log: make(t.log, 0.92, 0),
      metal: make(t.corrugated, 0.46, 0.55, t.corrugatedNormal),
      concrete: make(t.concrete, 0.93, 0),
      wood: make(t.build[0], 0.84, 0),
      shingle: make(t.shingle, 0.9, 0, t.shingleNormal),
      tin: make(t.tin, 0.42, 0.62),
      pantile: make(t.pantile, 0.86, 0),
      tar: make(t.detail, 0.95, 0),
      floorboard: make(t.floorboard, 0.78, 0),
      floorTile: make(t.floorTile, 0.5, 0.02),
      carpet: make(t.carpet, 0.99, 0),
      dirt: make(t.sandTexture, 0.98, 0),
      // Painted joinery: trim, frames, doors. Smooth enough to catch a
      // highlight, which is what makes a window frame read as painted wood
      // rather than as more wall.
      paint: make(t.detail, 0.62, 0.02),
      glass: make(null, 0.08, 0.1, null, {
        transparent: true, opacity: 0.32, envMapIntensity: 1.6,
        color: 0xbfe0e6, side: THREE.DoubleSide, depthWrite: false,
      }),
    };
  }

  add(
    x: number, y: number, z: number,
    w: number, h: number, d: number,
    color: number, part: Part = {},
  ): void {
    const shape = part.shape ?? 'box';
    const finish = part.finish ?? 'plaster';
    const key = `${Math.floor(x / 48)},${Math.floor(z / 48)},${shape},${finish}`;
    let b = this.batches.get(key);
    if (b === undefined) {
      b = { geo: this.shapes[shape], mat: this.materials[finish], matrices: [], colors: [], uvs: [] };
      this.batches.set(key, b);
    }
    const { q, e, p, s } = this.scratch;
    e.set(part.pitch ?? 0, part.yaw ?? 0, part.roll ?? 0);
    q.setFromEuler(e);
    b.matrices.push(new THREE.Matrix4().compose(p.set(x, y, z), q, s.set(w, h, d)));
    b.colors.push(new THREE.Color(color));
    // Texture density in repeats, taken from the piece's own size so a six
    // metre wall and a twenty centimetre sill show the same size of grain.
    const per = part.uv ?? 0.5;
    b.uvs.push(Math.max(w, d) * per, Math.max(h, shape === 'plate' ? d : h) * per);
  }

  /** A box between two corners, which is how most architecture is described. */
  span(
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    color: number, part: Part = {},
  ): void {
    this.add((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2,
      Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), color, part);
  }

  finish(scene: THREE.Scene): number {
    let calls = 0;
    for (const b of this.batches.values()) {
      const geo = b.geo.clone();
      const uv = new Float32Array(b.uvs);
      geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 2));
      const mat = (b.mat as THREE.Material).clone() as THREE.MeshStandardMaterial;
      perInstanceUv(mat);
      const mesh = new THREE.InstancedMesh(geo, mat, b.matrices.length);
      for (let i = 0; i < b.matrices.length; i++) {
        mesh.setMatrixAt(i, b.matrices[i]);
        mesh.setColorAt(i, b.colors[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      calls++;
    }
    return calls;
  }
}

/**
 * Let each instance scale its own texture.
 *
 * An InstancedMesh shares one geometry, so it shares one set of UVs, and a
 * clapboard texture stretched over a six metre wall and squeezed onto a sill
 * would be two completely different materials. Carrying the repeat count as
 * instance data and multiplying it into the UV in the vertex shader is the only
 * way to keep both in one draw call.
 */
function perInstanceUv(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute vec2 aUv;\n' + shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      #ifdef USE_MAP
        vMapUv *= aUv;
      #endif
      #ifdef USE_NORMALMAP
        vNormalMapUv *= aUv;
      #endif
      #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv *= aUv;
      #endif`,
    );
  };
  material.customProgramCacheKey = () => 'per-instance-uv-v1';
}

// ---------------------------------------------------------------------------
// Shared colours
// ---------------------------------------------------------------------------

const IRON = 0x3a4249;
const DARK_IRON = 0x22282d;
const GLASS_TINT = 0xd6ecf2;
const TIMBER = 0x7a5c40;
const DARK_TIMBER = 0x4e3a29;
const CONCRETE = 0xa8a8a2;

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

/** Where a wall run's outward-facing side is, as a unit offset. */
function outward(bp: Blueprint, run: WallRun): [number, number] {
  if (!run.exterior) return [0, 0];
  if (run.axis === 'x') return [run.at <= bp.x0 + 0.01 ? -1 : 1, 0];
  return [0, run.at <= bp.z0 + 0.01 ? -1 : 1];
}

function drawWall(k: Kit, bp: Blueprint, run: WallRun): void {
  const b = bp.b;
  const finish: Finish = run.exterior ? SURFACE_FINISH[run.surface] : 'plaster';
  const trim = b.trim ?? 0xf1e9da;
  const half = run.thick / 2;
  const [ox, oz] = outward(bp, run);
  const alongX = run.axis === 'z';

  // The wall itself, with every opening already cut out of it by the blueprint.
  for (const box of wallBoxes(run)) {
    k.span(box[0], box[1], box[2], box[3], box[4], box[5], run.color, { finish, uv: 0.4 });
  }

  if (run.parapet) {
    // A coping stone along the top, which is what stops a parapet reading as an
    // unfinished wall.
    const cap = run.y + run.h;
    if (alongX) k.span(run.u0 - 0.1, cap, run.at - half - 0.12, run.u1 + 0.1, cap + 0.16, run.at + half + 0.12, trim, { finish: 'concrete', uv: 0.6 });
    else k.span(run.at - half - 0.12, cap, run.u0 - 0.1, run.at + half + 0.12, cap + 0.16, run.u1 + 0.1, trim, { finish: 'concrete', uv: 0.6 });
    return;
  }

  if (!run.exterior) {
    // Skirting board, so an interior wall meets the floor properly.
    const s = 0.18;
    if (alongX) k.span(run.u0, run.y, run.at - half - 0.03, run.u1, run.y + s, run.at + half + 0.03, trim, { finish: 'paint', uv: 1 });
    else k.span(run.at - half - 0.03, run.y, run.u0, run.at + half + 0.03, run.y + s, run.u1, trim, { finish: 'paint', uv: 1 });
  }

  // A face-relative placer: `u` along the run, `v` up it, `out` proud of it.
  const face = (u: number, v: number, out: number, su: number, sv: number, so: number, color: number, part: Part = {}): void => {
    if (alongX) k.add(u, run.y + v, run.at + (ox || oz ? oz : 1) * 0 + out * (oz || 1), su, sv, so, color, part);
    else k.add(run.at + out * (ox || 1), run.y + v, u, so, sv, su, color, part);
  };

  if (run.exterior) {
    // Plinth at the bottom of the ground floor, and a belt course at the top of
    // every storey. Both are what give a facade a horizontal rhythm; without
    // them a three storey building is one tall box.
    const proud = half + 0.1;
    if (run.level === 0 && b.archetype !== 'ruin') {
      face((run.u0 + run.u1) / 2, 0.42, proud, run.u1 - run.u0 + 0.3, 0.84, 0.3, shade(run.color, 0.72), { finish: 'concrete', uv: 0.5 });
    }
    if (!b.roofless) {
      face((run.u0 + run.u1) / 2, run.h - 0.22, proud, run.u1 - run.u0 + 0.36, 0.3, 0.32, trim, { finish: 'paint', uv: 0.8 });
      face((run.u0 + run.u1) / 2, run.h - 0.46, proud - 0.06, run.u1 - run.u0 + 0.2, 0.14, 0.24, shade(trim, 0.86), { finish: 'paint', uv: 1 });
    }
    // Corner boards.
    for (const u of [run.u0 + 0.16, run.u1 - 0.16]) {
      face(u, run.h / 2, proud - 0.02, 0.34, run.h, 0.26, trim, { finish: 'paint', uv: 0.8 });
    }
  }

  for (const o of run.openings) {
    const u = o.u, sill = run.y + o.sill, top = run.y + Math.min(o.top, run.h);
    const h = top - sill;
    if (h <= 0.05) continue;
    drawOpening(k, bp, run, o.kind, u, sill, h, o.w, alongX, ox || oz);
  }
}

/** One window, door, shopfront or garage opening, with all of its joinery. */
function drawOpening(
  k: Kit, bp: Blueprint, run: WallRun,
  kind: string, u: number, sill: number, h: number, w: number,
  alongX: boolean, side: number,
): void {
  const b = bp.b;
  const trim = b.trim ?? 0xf1e9da;
  const half = run.thick / 2;
  const at = run.at;
  const dir = side || 1;

  /** Place a piece in the opening's frame: u along, y absolute, out from the wall. */
  const put = (du: number, y: number, out: number, su: number, sv: number, so: number, color: number, part: Part = {}): void => {
    if (alongX) k.add(u + du, y, at + out * dir, su, sv, so, color, part);
    else k.add(at + out * dir, y, u + du, so, sv, su, color, part);
  };

  const mid = sill + h / 2;
  const frame = 0.16;

  if (kind === 'door') {
    // Frame, then a door leaf set back in it.
    for (const s of [-1, 1]) put(s * (w / 2 + frame / 2), mid, half + 0.04, frame, h + frame, 0.26, trim, { finish: 'paint', uv: 1.4 });
    put(0, sill + h + frame / 2, half + 0.04, w + frame * 2, frame, 0.3, trim, { finish: 'paint', uv: 1.4 });
    put(0, mid, half - 0.06, w - 0.06, h - 0.06, 0.12, shade(trim, 0.7), { finish: 'paint', uv: 1.2 });
    // Panels and a handle, so the door is a door at two metres as well as twenty.
    for (const y of [sill + h * 0.28, sill + h * 0.68]) {
      put(0, y, half + 0.02, w - 0.6, h * 0.24, 0.05, shade(trim, 0.58), { finish: 'paint', uv: 2 });
    }
    put(w * 0.32, sill + h * 0.45, half + 0.06, 0.1, 0.1, 0.1, 0xc9a24a, { shape: 'round', finish: 'paint', uv: 4 });
    // Threshold step outside, and a lamp over the opening.
    put(0, sill - 0.06, half + 0.5, w + 0.5, 0.14, 1.0, CONCRETE, { finish: 'concrete', uv: 0.9 });
    put(0, sill + h + 0.5, half + 0.16, 0.24, 0.3, 0.22, IRON, { shape: 'round', finish: 'paint', uv: 3 });
    put(0, sill + h + 0.3, half + 0.16, 0.2, 0.22, 0.2, 0xffe6a8, { shape: 'round', finish: 'paint', uv: 3 });
    return;
  }

  if (kind === 'shop') {
    // A shopfront is mostly glass: stallriser, big panes, slim mullions.
    put(0, sill - 0.2, half + 0.06, w + 0.4, 0.4, 0.22, shade(trim, 0.8), { finish: 'paint', uv: 1 });
    put(0, mid, half - 0.02, w, h, 0.1, GLASS_TINT, { finish: 'glass' });
    for (const s of [-1, 1]) put(s * (w / 2 + 0.08), mid, half + 0.04, 0.18, h + 0.2, 0.24, trim, { finish: 'paint', uv: 1.4 });
    for (const s of [-1, 1]) put(s * w * 0.17, mid, half + 0.03, 0.1, h, 0.2, trim, { finish: 'paint', uv: 2 });
    put(0, sill + h + 0.1, half + 0.05, w + 0.4, 0.2, 0.26, trim, { finish: 'paint', uv: 1.2 });
    // Striped canvas awning over the pavement.
    const stripes = Math.max(3, Math.round(w / 0.55));
    for (let i = 0; i < stripes; i++) {
      const dx = -w / 2 + (i + 0.5) * (w / stripes);
      put(dx, sill + h + 0.42, half + 0.85, w / stripes * 0.96, 0.5, 1.5, i % 2 ? shade(b.color, 1.12) : 0xf2ece0,
        { finish: 'paint', pitch: alongX ? -0.32 * dir : 0, roll: alongX ? 0 : 0.32 * dir, uv: 1.4 });
    }
    return;
  }

  if (kind === 'garage') {
    // Roller shutter: slats, a guide either side, and a lintel over it.
    const slats = Math.max(5, Math.round(h / 0.42));
    for (let i = 0; i < slats; i++) {
      put(0, sill + (i + 0.5) * (h / slats), half + 0.02, w, h / slats * 0.88, 0.14, 0xb9bcbd, { finish: 'metal', uv: 1.6 });
    }
    for (const s of [-1, 1]) put(s * (w / 2 + 0.12), mid, half + 0.06, 0.24, h + 0.2, 0.26, DARK_IRON, { finish: 'metal', uv: 1.4 });
    put(0, sill + h + 0.18, half + 0.06, w + 0.6, 0.36, 0.3, DARK_IRON, { finish: 'metal', uv: 1 });
    return;
  }

  if (kind === 'arch') {
    // Stepped voussoirs standing in for an arch, and a stone reveal.
    for (const s of [-1, 1]) put(s * (w / 2 + 0.1), mid, half + 0.03, 0.2, h, 0.24, shade(run.color, 1.1), { finish: 'stone', uv: 1.2 });
    for (let i = 0; i < 3; i++) {
      put(0, sill + h - 0.1 + i * 0.16, half + 0.03, w + 0.4 - i * 0.22, 0.18, 0.26, shade(run.color, 1.14), { finish: 'stone', uv: 1.2 });
    }
    if (!b.roofless) put(0, mid, half - 0.02, w - 0.1, h - 0.2, 0.08, 0x9fd0cc, { finish: 'glass' });
    return;
  }

  // An ordinary window: frame, sash bars, glass, sill, and shutters at home.
  put(0, mid, half - 0.02, w, h, 0.1, GLASS_TINT, { finish: 'glass' });
  for (const s of [-1, 1]) put(s * (w / 2 + frame / 2), mid, half + 0.05, frame, h + frame * 2, 0.26, trim, { finish: 'paint', uv: 1.6 });
  for (const s of [-1, 1]) put(0, mid + s * (h / 2 + frame / 2), half + 0.05, w + frame * 2, frame, 0.26, trim, { finish: 'paint', uv: 1.6 });
  put(0, mid, half + 0.03, 0.08, h, 0.2, trim, { finish: 'paint', uv: 2.4 });
  put(0, mid, half + 0.03, w, 0.08, 0.2, trim, { finish: 'paint', uv: 2.4 });
  // Sill, projecting and with a drip, plus a lintel over the head.
  put(0, sill - 0.12, half + 0.16, w + 0.5, 0.16, 0.48, trim, { finish: 'paint', uv: 1 });
  put(0, sill + h + 0.16, half + 0.08, w + 0.44, 0.18, 0.32, shade(trim, 0.92), { finish: 'paint', uv: 1 });

  if (b.style === 'house' || b.archetype === 'cottage' || b.archetype === 'farmhouse') {
    const shutter = shade(b.color, 0.62);
    for (const s of [-1, 1]) {
      put(s * (w / 2 + 0.34), mid, half + 0.1, 0.56, h, 0.12, shutter, { finish: 'paint', uv: 1.6 });
      for (let i = 0; i < 5; i++) {
        put(s * (w / 2 + 0.34), sill + (i + 0.5) * (h / 5), half + 0.15, 0.5, h / 5 * 0.6, 0.05, shade(shutter, 1.2), { finish: 'paint', uv: 2.4 });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Roofs
// ---------------------------------------------------------------------------

function roofFinishFor(b: Building): Finish {
  if (b.roof === 'flat') return 'tar';
  const c = b.roofColor ?? 0x6b4b3c;
  // The map picks a roof colour from a small palette; each one has a material
  // it obviously is.
  if (c === 0x8e9aa0) return 'tin';
  if (c === 0x9c4f3a) return 'pantile';
  return 'shingle';
}

function drawRoof(k: Kit, bp: Blueprint): void {
  const b = bp.b;
  if (b.roofless) {
    // A ruin gets a broken wall head instead of a roof: uneven capping stones
    // and a course of rubble, which is what makes it read as fallen in rather
    // than as unfinished.
    for (const run of bp.walls) {
      if (!run.exterior) continue;
      const top = run.y + run.h;
      const len = run.u1 - run.u0;
      const steps = Math.max(2, Math.round(len / 2.2));
      for (let i = 0; i < steps; i++) {
        const u = run.u0 + (i + 0.5) * (len / steps);
        const drop = (i % 3) * 0.5 + ((i * 7) % 5) * 0.22;
        if (run.axis === 'z') k.add(u, top - drop, run.at, len / steps * 0.9, 0.5, run.thick + 0.2, shade(run.color, 1.06), { shape: 'stone', finish: 'stone', uv: 0.8 });
        else k.add(run.at, top - drop, u, run.thick + 0.2, 0.5, len / steps * 0.9, shade(run.color, 1.06), { shape: 'stone', finish: 'stone', uv: 0.8 });
      }
    }
    return;
  }

  const finish = roofFinishFor(b);
  const color = b.roofColor ?? 0x6b4b3c;
  const trim = b.trim ?? 0xf1e9da;

  if (b.roof === 'flat') {
    // A tarred deck, with the fall to a gutter suggested by a slight taper.
    k.span(bp.x0, bp.topLevel * 0 + (b.base + bp.topLevel) * TILE, bp.z0,
      bp.x1, (b.base + bp.topLevel) * TILE + 0.1, bp.z1, 0x4a4d50, { finish: 'tar', uv: 0.35 });
    const y = (b.base + bp.topLevel) * TILE + 0.12;
    // Roof furniture: plant, ducts and a stair hut over the shaft.
    k.add(bp.x0 + (bp.x1 - bp.x0) * 0.3, y + 1.0, bp.z0 + (bp.z1 - bp.z0) * 0.32, 3.0, 1.9, 2.2, 0x9aa3a6, { shape: 'round', finish: 'metal', uv: 0.8 });
    for (const dx of [-0.8, 0.8]) {
      k.add(bp.x0 + (bp.x1 - bp.x0) * 0.3 + dx, y + 2.05, bp.z0 + (bp.z1 - bp.z0) * 0.32, 1.1, 0.16, 1.1, DARK_IRON, { shape: 'cyl', finish: 'metal', uv: 2 });
    }
    k.add(bp.x0 + (bp.x1 - bp.x0) * 0.72, y + 0.5, bp.z0 + (bp.z1 - bp.z0) * 0.7, 2.4, 1.0, 1.4, 0x8d9498, { finish: 'metal', uv: 1 });
    if (bp.shaft) {
      const sx = (bp.shaft.x0 + bp.shaft.x1) / 2, sz = (bp.shaft.z0 + bp.shaft.z1) / 2;
      k.add(sx, y + 1.5, sz, 3.4, 3.0, 3.4, shade(b.color, 0.94), { finish: SURFACE_FINISH[b.surface], uv: 0.5 });
      k.add(sx, y + 3.1, sz, 3.8, 0.2, 3.8, trim, { finish: 'paint', uv: 0.8 });
    }
    return;
  }

  // Pitched: one sloped slab per roof cell, overhanging the walls, with a
  // ridge cap along the top and fascia boards under the eaves.
  const slope = Math.PI / 4;
  const overhang = 0.55;
  for (const r of bp.roofRamps) {
    const x0 = r.gx * TILE, z0 = r.gz * TILE, y0 = r.gy * TILE;
    const cx = x0 + TILE / 2, cz = z0 + TILE / 2;
    const alongX = r.facing === 0 || r.facing === 2;
    const rise = TILE;
    const run = TILE;
    const length = Math.hypot(rise, run);
    // The slab sits on the diagonal of its cell, which is exactly the surface
    // the collision ramp presents.
    const cy = y0 + rise / 2;
    const thick = 0.32;
    // Rotations: a roll about Z tips the slab's length up toward +X, and a
    // pitch about X tips it DOWN toward +Z, which is why the two signs differ.
    // The slab is also dropped half its thickness down the slope normal so its
    // top face lands exactly on the surface the ramp collider presents.
    const drop = thick / 2 / Math.SQRT2;
    if (alongX) {
      const sign = r.facing === 0 ? 1 : -1;
      k.add(cx + sign * drop, cy - drop, cz, length + (isEdge(bp, r, 'x') ? overhang : 0), thick, TILE + 0.02, color,
        { finish, roll: sign * slope, uv: 0.45 });
      // Fascia along the eaves, at the low end of the slope.
      k.add(x0 + (sign > 0 ? -overhang * 0.5 : TILE + overhang * 0.5), y0 + 0.05, cz, 0.6, 0.44, TILE, trim, { finish: 'paint', uv: 0.9 });
    } else {
      const sign = r.facing === 1 ? 1 : -1;
      k.add(cx, cy - drop, cz + sign * drop, TILE + 0.02, thick, length + (isEdge(bp, r, 'z') ? overhang : 0), color,
        { finish, pitch: -sign * slope, uv: 0.45 });
      k.add(cx, y0 + 0.05, z0 + (sign > 0 ? -overhang * 0.5 : TILE + overhang * 0.5), TILE, 0.44, 0.6, trim, { finish: 'paint', uv: 0.9 });
    }
  }

  // Ridge cap, running the length of the highest roof cells.
  const top = Math.max(...bp.roofRamps.map(r => r.gy));
  const ridge = bp.roofRamps.filter(r => r.gy === top);
  for (const r of ridge) {
    const alongX = r.facing === 0 || r.facing === 2;
    k.add(r.gx * TILE + TILE / 2, (r.gy + 1) * TILE + 0.16, r.gz * TILE + TILE / 2,
      alongX ? 0.62 : TILE + 0.1, 0.34, alongX ? TILE + 0.1 : 0.62,
      shade(color, 0.86), { shape: 'round', finish, uv: 1 });
  }

  // A brick chimney on anything with a hearth.
  if (b.style === 'house' || b.style === 'cabin' || b.archetype === 'farmhouse' || b.archetype === 'townhouse') {
    const cx = bp.x0 + (bp.x1 - bp.x0) * 0.22;
    const cz = bp.z0 + (bp.z1 - bp.z0) * 0.7;
    const stackTop = (top + 1) * TILE + 2.6;
    k.span(cx - 0.75, b.base * TILE, cz - 0.75, cx + 0.75, stackTop, cz + 0.75, 0xa2604c, { finish: 'brick', uv: 0.7 });
    k.add(cx, stackTop + 0.14, cz, 1.9, 0.28, 1.9, CONCRETE, { finish: 'concrete', uv: 1.2 });
    for (const dx of [-0.32, 0.32]) k.add(cx + dx, stackTop + 0.5, cz, 0.36, 0.7, 0.36, DARK_IRON, { shape: 'cyl', finish: 'metal', uv: 2 });
  }
}

/** Is this roof cell on the edge of the building, where the eaves overhang? */
function isEdge(bp: Blueprint, r: { gx: number; gz: number }, axis: 'x' | 'z'): boolean {
  const b = bp.b;
  return axis === 'x' ? r.gx === b.x || r.gx === b.x + b.w - 1 : r.gz === b.z || r.gz === b.z + b.d - 1;
}

// ---------------------------------------------------------------------------
// Floors, ceilings and stairs
// ---------------------------------------------------------------------------

const FLOOR_FINISH: Record<string, Finish> = {
  wood: 'floorboard', tile: 'floorTile', carpet: 'carpet', concrete: 'concrete', dirt: 'dirt', hay: 'dirt',
};

function drawFloors(k: Kit, bp: Blueprint): void {
  const rooms = bp.rooms;
  for (const f of bp.floors) {
    const x = f.gx * TILE, z = f.gz * TILE, y = f.gy * TILE;
    // The structural slab, seen from below as a ceiling.
    k.span(x, y - 0.34, z, x + TILE, y - 0.02, z + TILE, 0xd8d2c4, { finish: 'concrete', uv: 0.4 });
    // And the floor finish on top, taken from whichever room covers this cell.
    const room = roomAt(rooms, x + TILE / 2, z + TILE / 2, f.gy - bp.b.base);
    const finish = FLOOR_FINISH[room?.finish ?? 'concrete'] ?? 'concrete';
    const tone = room?.finish === 'carpet' ? 0xb9a894 : room?.finish === 'tile' ? 0xe8e6de : 0xd9c8ad;
    k.span(x + 0.02, y - 0.02, z + 0.02, x + TILE - 0.02, y + 0.03, z + TILE - 0.02, tone, { finish, uv: 0.45 });
  }
}

function roomAt(rooms: readonly Room[], x: number, z: number, level: number): Room | undefined {
  return rooms.find(r => r.level === level && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
}

function drawStairs(k: Kit, bp: Blueprint): void {
  const trim = bp.b.trim ?? 0xf1e9da;
  for (const s of bp.stairs) {
    const x0 = s.gx * TILE, z0 = s.gz * TILE, y0 = s.gy * TILE;
    const steps = 10;
    const alongX = s.facing === 0 || s.facing === 2;
    const sign = s.facing === 0 || s.facing === 1 ? 1 : -1;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const along = sign > 0 ? t : 1 - t;
      const h = y0 + TILE * ((i + 1) / steps);
      const tread = TILE / steps;
      if (alongX) {
        // Riser and tread, drawn as one block per step under the ramp surface.
        k.span(x0 + along * TILE - tread / 2, y0, z0 + 0.5, x0 + along * TILE + tread / 2, h, z0 + TILE - 0.5, 0xc9b79a, { finish: 'floorboard', uv: 1 });
      } else {
        k.span(x0 + 0.5, y0, z0 + along * TILE - tread / 2, x0 + TILE - 0.5, h, z0 + along * TILE + tread / 2, 0xc9b79a, { finish: 'floorboard', uv: 1 });
      }
    }
    // A handrail up the open side, sloping with the flight.
    const railY = y0 + TILE / 2 + 0.95;
    const yaw = alongX ? 0 : Math.PI / 2;
    const tilt = -sign * Math.PI / 4;
    const cx = x0 + TILE / 2, cz = z0 + TILE / 2;
    const off = 0.4;
    for (const sideSign of [-1, 1]) {
      const rx = alongX ? cx : cx + sideSign * (TILE / 2 - off);
      const rz = alongX ? cz + sideSign * (TILE / 2 - off) : cz;
      k.add(rx, railY, rz, alongX ? TILE * 1.42 : 0.1, 0.1, alongX ? 0.1 : TILE * 1.42, trim,
        { shape: 'round', finish: 'paint', yaw, roll: alongX ? tilt : 0, pitch: alongX ? 0 : tilt, uv: 2 });
      for (let i = 1; i < steps; i += 2) {
        const t = (i + 0.5) / steps;
        const along = sign > 0 ? t : 1 - t;
        const y = y0 + TILE * ((i + 1) / steps);
        k.add(alongX ? x0 + along * TILE : rx, y + 0.45, alongX ? rz : z0 + along * TILE,
          0.07, 0.9, 0.07, trim, { shape: 'round', finish: 'paint', uv: 3 });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Per-archetype character
// ---------------------------------------------------------------------------

function drawCharacter(k: Kit, bp: Blueprint): void {
  const b = bp.b;
  const y = b.base * TILE;
  const cx = (bp.x0 + bp.x1) / 2, cz = (bp.z0 + bp.z1) / 2;
  const trim = b.trim ?? 0xf1e9da;
  const top = (b.base + b.floors) * TILE;

  switch (b.archetype) {
    case 'barn': {
      // A grain silo beside the barn, and a hay hood over the loft door.
      const sx = bp.x1 + 5.5, sz = cz;
      const sh = 16;
      k.add(sx, y + sh / 2, sz, 7.2, sh, 7.2, 0xb9bec0, { shape: 'cyl', finish: 'metal', uv: 0.35 });
      for (let i = 1; i < 5; i++) k.add(sx, y + i * (sh / 5), sz, 7.5, 0.2, 7.5, 0x9aa1a4, { shape: 'cyl', finish: 'metal', uv: 1 });
      k.add(sx, y + sh + 1.6, sz, 7.4, 3.4, 7.4, 0x8d9497, { shape: 'cone', finish: 'tin', uv: 0.6 });
      k.add(sx, y + sh + 3.6, sz, 0.5, 1.2, 0.5, DARK_IRON, { shape: 'cyl', finish: 'metal', uv: 2 });
      // Loft hood and pulley on the gable end.
      k.add(cx, top + TILE * 0.5, bp.z0 - 1.4, 2.6, 0.3, 3.0, shade(b.roofColor ?? 0x8e9aa0, 0.9), { finish: 'tin', uv: 0.8 });
      k.add(cx, top + TILE * 0.5 - 0.5, bp.z0 - 2.6, 0.16, 0.9, 0.16, DARK_IRON, { shape: 'cyl', finish: 'metal', uv: 2 });
      break;
    }
    case 'chapel': {
      // Buttresses down the nave, and a bell frame where the roof fell in.
      for (let z = bp.z0 + 3; z < bp.z1 - 1; z += 6) {
        for (const x of [bp.x0 - 0.6, bp.x1 + 0.6]) {
          k.add(x, y + TILE * 0.45, z, 1.3, TILE * 0.9, 1.6, shade(b.color, 0.94), { finish: 'stone', uv: 0.6 });
          k.add(x, y + TILE * 0.9, z, 1.5, 0.4, 1.8, shade(b.color, 1.1), { finish: 'stone', uv: 1 });
        }
      }
      k.add(cx, y + TILE + 1.4, bp.z0 + 1.6, 0.4, 3.2, 0.4, DARK_TIMBER, { shape: 'round', finish: 'wood', uv: 1.5 });
      k.add(cx, y + TILE + 3.0, bp.z0 + 1.6, 2.6, 0.35, 0.35, DARK_TIMBER, { shape: 'round', finish: 'wood', uv: 1.5 });
      k.add(cx, y + TILE + 2.4, bp.z0 + 1.6, 1.1, 1.2, 1.1, 0x8a7534, { shape: 'cone', finish: 'metal', roll: Math.PI, uv: 1.4 });
      break;
    }
    case 'gas': {
      // Forecourt canopy on steel legs, two pump islands, and a price totem.
      const canW = (bp.x1 - bp.x0) + 7, canD = 10;
      const canZ = bp.z1 + 7.5, canY = y + 5.4;
      k.add(cx, canY, canZ, canW, 0.5, canD, 0xf0ece2, { finish: 'metal', uv: 0.4 });
      k.add(cx, canY + 0.5, canZ, canW + 0.2, 0.5, canD + 0.2, 0xd8352c, { finish: 'paint', uv: 0.5 });
      k.add(cx, canY + 0.9, canZ, canW - 0.4, 0.3, canD - 0.4, 0xf2c033, { finish: 'paint', uv: 0.5 });
      for (const dx of [-canW * 0.32, canW * 0.32]) {
        for (const dz of [-canD * 0.28, canD * 0.28]) {
          k.add(cx + dx, y + 2.7, canZ + dz, 0.5, 5.4, 0.5, 0xd9d5cc, { shape: 'round', finish: 'metal', uv: 1 });
        }
      }
      for (const dx of [-canW * 0.32, canW * 0.32]) {
        k.add(cx + dx, y + 0.22, canZ, 1.8, 0.44, 4.4, CONCRETE, { shape: 'round', finish: 'concrete', uv: 0.8 });
        for (const dz of [-1.2, 1.2]) {
          k.add(cx + dx, y + 1.3, canZ + dz, 0.8, 1.7, 1.0, 0xd8352c, { shape: 'round', finish: 'paint', uv: 1.2 });
          k.add(cx + dx, y + 1.7, canZ + dz - 0.52, 0.5, 0.4, 0.06, 0x14181b, { finish: 'glass' });
          k.add(cx + dx + 0.5, y + 1.5, canZ + dz, 0.1, 0.1, 0.5, DARK_IRON, { shape: 'cyl', finish: 'metal', pitch: Math.PI / 2, uv: 2 });
        }
      }
      k.add(bp.x0 - 5, y + 4.0, canZ, 0.46, 8.0, 0.46, DARK_IRON, { shape: 'cyl', finish: 'metal', uv: 1 });
      k.add(bp.x0 - 5, y + 7.0, canZ, 3.2, 2.4, 0.5, 0xf2c033, { shape: 'round', finish: 'paint', uv: 0.8 });
      k.add(bp.x0 - 5, y + 5.2, canZ, 2.6, 1.0, 0.55, 0xd8352c, { shape: 'round', finish: 'paint', uv: 1 });
      break;
    }
    case 'lighthouse': {
      // A tapered tower, a lantern room and a gallery you can see the light from.
      const h = (b.floors + 1) * TILE;
      for (let i = 0; i < 7; i++) {
        const t = i / 7;
        const r = 5.6 - t * 1.8;
        k.add(cx, y + h * (t + 0.5 / 7), cz, r, h / 7, r, i % 2 ? 0xe8e2d6 : 0xd8453a, { shape: 'cyl', finish: 'plaster', uv: 0.5 });
      }
      k.add(cx, y + h + 0.3, cz, 6.4, 0.5, 6.4, 0xe8e2d6, { shape: 'cyl', finish: 'concrete', uv: 0.8 });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        k.add(cx + Math.cos(a) * 3.0, y + h + 1.1, cz + Math.sin(a) * 3.0, 0.12, 1.2, 0.12, DARK_IRON, { shape: 'round', finish: 'metal', uv: 3 });
      }
      k.add(cx, y + h + 1.7, cz, 6.2, 0.14, 6.2, DARK_IRON, { shape: 'cyl', finish: 'metal', uv: 1.6 });
      k.add(cx, y + h + 2.6, cz, 3.6, 2.6, 3.6, 0xfff0c0, { shape: 'cyl', finish: 'glass' });
      k.add(cx, y + h + 4.2, cz, 4.0, 1.6, 4.0, 0x2c3238, { shape: 'cone', finish: 'metal', uv: 1 });
      break;
    }
    case 'tower': {
      // A fire lookout stands on legs, with a stair skirt and a railed deck.
      for (const dx of [bp.x0 + 1.2, bp.x1 - 1.2]) {
        for (const dz of [bp.z0 + 1.2, bp.z1 - 1.2]) {
          k.span(dx - 0.3, y - 1, dz - 0.3, dx + 0.3, y + b.floors * TILE, dz + 0.3, DARK_TIMBER, { finish: 'wood', uv: 0.8 });
        }
      }
      for (let level = 1; level < b.floors; level++) {
        const ly = y + level * TILE;
        for (const dz of [bp.z0 + 1.2, bp.z1 - 1.2]) {
          k.span(bp.x0 + 1.2, ly, dz - 0.2, bp.x1 - 1.2, ly + 0.3, dz + 0.2, DARK_TIMBER, { finish: 'wood', uv: 1 });
        }
      }
      // Gallery around the top floor.
      const gy = (b.base + b.floors - 1) * TILE;
      for (const [ax, az, w, d] of [
        [cx, bp.z0 - 1.2, bp.x1 - bp.x0 + 2.4, 0.16],
        [cx, bp.z1 + 1.2, bp.x1 - bp.x0 + 2.4, 0.16],
        [bp.x0 - 1.2, cz, 0.16, bp.z1 - bp.z0 + 2.4],
        [bp.x1 + 1.2, cz, 0.16, bp.z1 - bp.z0 + 2.4],
      ] as const) {
        k.add(ax, gy - 0.1, az, w, 0.2, d, TIMBER, { finish: 'wood', uv: 0.8 });
        k.add(ax, gy + 1.0, az, w, 0.12, d, trim, { shape: 'round', finish: 'paint', uv: 1.4 });
      }
      break;
    }
    case 'mill': {
      // The waterwheel, on the side of the mill facing the river.
      const wx = bp.x1 + 1.4, wy = y + 2.6, wz = cz;
      k.add(wx, wy, wz, 1.0, 7.6, 7.6, DARK_TIMBER, { shape: 'cyl', finish: 'wood', pitch: 0, roll: Math.PI / 2, uv: 0.8 });
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        k.add(wx + 0.6, wy + Math.sin(a) * 3.4, wz + Math.cos(a) * 3.4, 1.6, 1.1, 0.24, TIMBER, { finish: 'wood', pitch: -a, uv: 1.4 });
      }
      k.add(wx, wy, wz, 0.4, 0.4, 9.2, DARK_IRON, { shape: 'cyl', finish: 'metal', roll: Math.PI / 2, uv: 1.4 });
      // The sluice that feeds it.
      k.span(wx - 1, wy + 3.6, wz - 1.2, wx + 6, wy + 4.0, wz + 1.2, TIMBER, { finish: 'wood', uv: 0.6 });
      break;
    }
    case 'motel': {
      // A covered walkway the length of the room doors, with a neon-ish sign.
      const side = bp.z0 - 2.4;
      k.span(bp.x0, y + 3.6, side - 0.4, bp.x1, y + 3.9, bp.z0, shade(b.roofColor ?? 0x9c4f3a, 1.0), { finish: 'pantile', uv: 0.5 });
      for (let x = bp.x0 + 1.5; x <= bp.x1 - 1; x += 6) {
        k.add(x, y + 1.9, side, 0.26, 3.8, 0.26, trim, { shape: 'round', finish: 'paint', uv: 1.2 });
      }
      k.add(bp.x0 - 3.5, y + 4.5, bp.z0, 0.4, 9, 0.4, DARK_IRON, { shape: 'cyl', finish: 'metal', uv: 1 });
      k.add(bp.x0 - 3.5, y + 7.6, bp.z0, 4.4, 3.2, 0.5, 0x2f7f8c, { shape: 'round', finish: 'paint', uv: 0.7 });
      k.add(bp.x0 - 3.5, y + 7.6, bp.z0 - 0.3, 3.6, 2.4, 0.1, 0xffe9a8, { finish: 'paint', uv: 1 });
      break;
    }
    case 'warehouse': {
      // A loading dock along one side, with a bumper and a canopy.
      const z = bp.z1 + 1.8;
      k.span(bp.x0, y, bp.z1, bp.x1, y + 1.2, z + 1.6, CONCRETE, { finish: 'concrete', uv: 0.4 });
      k.span(bp.x0, y + 0.8, z + 1.5, bp.x1, y + 1.1, z + 1.7, 0x2c3034, { finish: 'metal', uv: 1 });
      k.span(bp.x0 - 0.5, y + 5.0, bp.z1, bp.x1 + 0.5, y + 5.3, z + 1.2, shade(b.roofColor ?? 0x8e9aa0, 0.95), { finish: 'tin', uv: 0.5 });
      for (let x = bp.x0 + 2; x <= bp.x1 - 1; x += 7) {
        k.add(x, y + 3.1, z + 1.0, 0.2, 4.0, 0.2, DARK_IRON, { shape: 'round', finish: 'metal', uv: 1.4 });
      }
      break;
    }
    case 'bunker': {
      // Half-buried: an earth berm round the walls and a blast hood over the door.
      for (const [ax, az, w, d] of [
        [cx, bp.z0 - 1.6, bp.x1 - bp.x0 + 3.2, 3.2],
        [cx, bp.z1 + 1.6, bp.x1 - bp.x0 + 3.2, 3.2],
        [bp.x0 - 1.6, cz, 3.2, bp.z1 - bp.z0 + 3.2],
        [bp.x1 + 1.6, cz, 3.2, bp.z1 - bp.z0 + 3.2],
      ] as const) {
        k.add(ax, y + 1.0, az, w, 2.0, d, 0x7f8a63, { shape: 'round', finish: 'dirt', uv: 0.4 });
      }
      k.add(bp.entrance.x, y + 3.4, bp.entrance.z + (bp.entrance.side === 0 ? -1.2 : 1.2), 4.0, 0.5, 2.6, CONCRETE, { finish: 'concrete', uv: 0.7 });
      break;
    }
    case 'farmhouse':
    case 'cottage':
    case 'townhouse': {
      // A porch over the front door, which is the single thing that most makes
      // a box read as somebody's house.
      const s = bp.entrance.side;
      const out = s === 0 ? [0, -1] : s === 1 ? [0, 1] : s === 2 ? [-1, 0] : [1, 0];
      const px = bp.entrance.x + out[0] * 1.8, pz = bp.entrance.z + out[1] * 1.8;
      const alongX = s === 0 || s === 1;
      k.add(px, y + 0.12, pz, alongX ? 6.0 : 3.6, 0.28, alongX ? 3.6 : 6.0, 0xd6c6a8, { finish: 'floorboard', uv: 0.8 });
      k.add(px, y + 3.5, pz, alongX ? 6.4 : 4.2, 0.28, alongX ? 4.2 : 6.4, shade(b.roofColor ?? 0x6b4b3c, 1.05), { finish: roofFinishFor(b), uv: 0.7 });
      for (const su of [-1, 1]) {
        const qx = px + (alongX ? su * 2.6 : out[0] * 1.5);
        const qz = pz + (alongX ? out[1] * 1.5 : su * 2.6);
        k.add(qx, y + 1.8, qz, 0.24, 3.4, 0.24, trim, { shape: 'round', finish: 'paint', uv: 1.2 });
        k.add(qx, y + 1.0, qz, alongX ? 0.1 : 2.8, 0.1, alongX ? 2.8 : 0.1, trim, { shape: 'round', finish: 'paint', uv: 2 });
      }
      break;
    }
    default:
      break;
  }

  // A signboard over the door, for anything that advertises itself.
  if (b.sign) signBoard(k, bp, b.sign);
}

// ---------------------------------------------------------------------------
// Signs
// ---------------------------------------------------------------------------

const signCache = new Map<string, THREE.Texture>();

function signTexture(text: string, bg: number): THREE.Texture {
  const key = `${text}|${bg}`;
  const hit = signCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const c = cv.getContext('2d')!;
  c.fillStyle = `#${bg.toString(16).padStart(6, '0')}`;
  c.fillRect(0, 0, 512, 128);
  c.strokeStyle = 'rgba(255,248,230,.85)';
  c.lineWidth = 6;
  c.strokeRect(10, 10, 492, 108);
  c.fillStyle = '#fff6e2';
  c.font = '700 54px Georgia, serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const size = Math.min(54, 54 * 13 / Math.max(13, text.length));
  c.font = `700 ${Math.round(size)}px Georgia, serif`;
  c.fillText(text, 256, 70);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  signCache.set(key, tex);
  return tex;
}

const signs: Array<{ text: string; bg: number; x: number; y: number; z: number; yaw: number; w: number; h: number }> = [];

function signBoard(k: Kit, bp: Blueprint, text: string): void {
  const b = bp.b;
  const s = bp.entrance.side;
  const out = s === 0 ? [0, -1] : s === 1 ? [0, 1] : s === 2 ? [-1, 0] : [1, 0];
  const y = b.base * TILE + (b.storefront ? TILE - 0.6 : TILE - 0.9);
  const x = bp.entrance.x + out[0] * 0.55;
  const z = bp.entrance.z + out[1] * 0.55;
  const w = Math.min(7.5, Math.max(3.5, text.length * 0.42));
  const yaw = s === 0 ? Math.PI : s === 1 ? 0 : s === 2 ? Math.PI / 2 : -Math.PI / 2;
  // A board with a frame around it, hung off the wall.
  k.add(x, y, z, s === 0 || s === 1 ? w + 0.3 : 0.24, 1.5, s === 0 || s === 1 ? 0.24 : w + 0.3,
    b.trim ?? 0xf1e9da, { finish: 'paint', uv: 1 });
  signs.push({ text, bg: shade(b.color, 0.55), x: x + out[0] * 0.2, y, z: z + out[1] * 0.2, yaw, w, h: 1.2 });
}

function placeSigns(scene: THREE.Scene): void {
  for (const s of signs) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(s.w, s.h),
      new THREE.MeshStandardMaterial({ map: signTexture(s.text, s.bg), roughness: 0.7, envMapIntensity: 0.7 }),
    );
    mesh.position.set(s.x, s.y, s.z);
    mesh.rotation.y = s.yaw;
    scene.add(mesh);
  }
  signs.length = 0;
}

// ---------------------------------------------------------------------------
// Structures that are not buildings
// ---------------------------------------------------------------------------

function drawBridges(k: Kit): void {
  for (const bridge of BRIDGES) {
    const { x, z, y, yaw, length, width, style } = bridge;
    const ax = Math.sin(yaw), az = Math.cos(yaw);
    const nx = az, nz = -ax;
    const deck = (dx: number, dz: number, w: number, h: number, d: number, color: number, part: Part = {}): void => {
      k.add(x + ax * dz + nx * dx, y + h / 2 - 0.3, z + az * dz + nz * dx, w, h, d, color, { yaw, ...part });
    };

    if (style === 'stone') {
      // Arched masonry: a solid spandrel with the arch voids stepped out of it.
      deck(0, 0, width + 1.4, 0.7, length, 0xb0a696, { finish: 'stone', uv: 0.35 });
      for (const s of [-1, 1]) {
        deck(s * (width / 2 + 0.4), 0.85, 0.7, 1.3, length, 0xb8aea0, { finish: 'stone', uv: 0.6 });
        deck(s * (width / 2 + 0.4), 1.6, 0.9, 0.24, length, 0xc6bdad, { finish: 'concrete', uv: 0.8 });
      }
      for (const t of [-length * 0.24, length * 0.24]) {
        for (let i = 0; i < 5; i++) {
          const drop = 1.2 + i * 0.7;
          const w = length * 0.3 * Math.cos(i * 0.28);
          deck(0, t, width + 1.2, 0.7, w, shade(0xb0a696, 0.92 - i * 0.03), { finish: 'stone', uv: 0.5 });
          void drop;
        }
        deck(0, t, width + 1.6, 3.2, 2.2, 0x9e9486, { finish: 'stone', uv: 0.5 });
      }
    } else if (style === 'covered') {
      deck(0, 0, width + 1.0, 0.5, length, 0x8a6b4c, { finish: 'wood', uv: 0.5 });
      for (const s of [-1, 1]) {
        deck(s * (width / 2 + 0.2), 2.2, 0.35, 4.0, length, 0xa03a2c, { finish: 'siding', uv: 0.5 });
        // Window slots down the side, so the inside is not pitch dark.
        for (let t = -length / 2 + 4; t < length / 2 - 2; t += 4) {
          deck(s * (width / 2 + 0.28), 2.8, 0.45, 1.2, 2.0, 0x3a2b20, { finish: 'wood', uv: 1.2 });
        }
      }
      deck(0, 0, width + 2.2, 0.4, length + 1.0, 0x6d4f38, { finish: 'shingle', uv: 0.5, });
      k.add(x, y + 4.6, z, width + 2.4, 1.6, length + 1.2, 0x5d4530, { yaw, shape: 'round', finish: 'shingle', uv: 0.45 });
      for (const s of [-1, 1]) {
        for (let t = -length / 2; t <= length / 2; t += 4) {
          deck(s * (width / 2 + 0.2), t, 0.4, 4.2, 0.4, 0x6a4a34, { finish: 'wood', uv: 1 });
        }
      }
    } else if (style === 'iron') {
      deck(0, 0, width + 0.8, 0.45, length, 0x8f8a80, { finish: 'concrete', uv: 0.5 });
      for (const s of [-1, 1]) {
        deck(s * (width / 2 + 0.3), 1.6, 0.3, 0.3, length, 0x6d7a62, { finish: 'metal', uv: 1 });
        deck(s * (width / 2 + 0.3), 3.0, 0.3, 0.3, length, 0x6d7a62, { finish: 'metal', uv: 1 });
        for (let t = -length / 2; t <= length / 2; t += 3.2) {
          deck(s * (width / 2 + 0.3), t, 0.26, 3.0, 0.26, 0x6d7a62, { finish: 'metal', uv: 1.4 });
          // Diagonal bracing, which is the whole look of a truss.
          deck(s * (width / 2 + 0.3), t + 1.6, 0.2, 0.2, 4.2, 0x5e6a55, { finish: 'metal', pitch: 0.75, uv: 1.4 });
        }
      }
    } else {
      // A plank footbridge on trestles.
      for (let t = -length / 2; t < length / 2; t += 0.5) {
        deck(0, t, width, 0.16, 0.42, 0x9a7a55, { finish: 'wood', uv: 1.6 });
      }
      for (const s of [-1, 1]) {
        deck(s * (width / 2 + 0.1), 1.0, 0.1, 0.1, length, 0x7d5f42, { shape: 'round', finish: 'wood', uv: 2 });
        for (let t = -length / 2; t <= length / 2; t += 2.5) {
          deck(s * (width / 2 + 0.1), t, 0.12, 1.2, 0.12, 0x7d5f42, { shape: 'round', finish: 'wood', uv: 2.4 });
        }
      }
    }

    // Piers down into the water, at the ends and the middle.
    for (const t of [-length * 0.3, 0, length * 0.3]) {
      const px = x + ax * t, pz = z + az * t;
      const ground = terrainHeight(px, pz);
      if (y - ground < 1) continue;
      k.span(px - width * 0.3, ground - 0.5, pz - width * 0.3, px + width * 0.3, y - 0.5, pz + width * 0.3,
        style === 'timber' ? 0x6d5138 : 0x9a938a, { finish: style === 'timber' ? 'wood' : 'stone', uv: 0.5 });
    }
  }
}

function drawDecks(k: Kit): void {
  for (const deck of DECKS) {
    // Planked decking, laid across the run.
    const alongZ = deck.z1 - deck.z0 > deck.x1 - deck.x0;
    for (let t = alongZ ? deck.z0 : deck.x0; t < (alongZ ? deck.z1 : deck.x1); t += 0.55) {
      if (alongZ) k.span(deck.x0, deck.y - 0.22, t, deck.x1, deck.y, t + 0.45, 0x9c8058, { finish: 'wood', uv: 1.4 });
      else k.span(t, deck.y - 0.22, deck.z0, t + 0.45, deck.y, deck.z1, 0x9c8058, { finish: 'wood', uv: 1.4 });
    }
    // Bearers and piles.
    for (let x = deck.x0; x <= deck.x1; x += 3.4) {
      for (let z = deck.z0; z <= deck.z1; z += 3.4) {
        const ground = terrainHeight(x, z);
        k.span(x - 0.2, ground - 1, z - 0.2, x + 0.2, deck.y - 0.2, z + 0.2, 0x63523a, { finish: 'wood', uv: 1 });
      }
    }
    if (!deck.rails) continue;
    for (const x of [deck.x0, deck.x1]) {
      k.span(x - 0.08, deck.y, deck.z0, x + 0.08, deck.y + 1.1, deck.z1, 0x8a6c49, { shape: 'round', finish: 'wood', uv: 1.2 });
      for (let z = deck.z0; z <= deck.z1; z += 2.2) {
        k.add(x, deck.y + 0.55, z, 0.16, 1.1, 0.16, 0x7a5f40, { shape: 'round', finish: 'wood', uv: 2 });
      }
    }
  }
}

/** The waterfall off the mountain's west face, and the rocks around its pool. */
function drawWaterfall(k: Kit, scene: THREE.Scene): { update(t: number): void } {
  const { x, z, top, pool } = WATERFALL;
  const fallMat = new THREE.MeshStandardMaterial({
    color: 0xdff2f6, roughness: 0.14, metalness: 0.05,
    transparent: true, opacity: 0.66, side: THREE.DoubleSide,
  });
  const scroll = { value: 0 };
  fallMat.onBeforeCompile = shader => {
    shader.uniforms.uFall = scroll;
    shader.vertexShader = 'uniform float uFall;\n' + shader.vertexShader;
    shader.fragmentShader = 'uniform float uFall;\n' + shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       float streak = 0.72 + 0.28 * sin(vViewPosition.y * 5.0 + uFall * 9.0);
       gl_FragColor.rgb *= streak;`,
    );
  };
  const height = top - pool;
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(13, height, 1, 8), fallMat);
  curtain.position.set(x + 7, pool + height / 2, z - 1);
  curtain.rotation.y = -Math.PI / 2.2;
  scene.add(curtain);

  // Rocks at the lip and around the plunge pool.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = 9 + (i % 4) * 2.4;
    const rx = x + Math.cos(a) * r, rz = z + Math.sin(a) * r;
    k.add(rx, terrainHeight(rx, rz) + 0.4, rz, 2.6 + (i % 3), 1.8 + (i % 2), 2.4 + (i % 3) * 0.8,
      0x8d8b84, { shape: 'stone', finish: 'stone', yaw: i, uv: 0.7 });
  }
  return { update: t => { scroll.value = t; } };
}

/** Roadside furniture: guard rails on the drops, and poles along the highways. */
function drawRoadside(k: Kit): void {
  for (const road of ROADS) {
    if (road.kind !== 'asphalt') continue;
    const len = Math.hypot(road.x2 - road.x1, road.z2 - road.z1);
    const dx = (road.x2 - road.x1) / len, dz = (road.z2 - road.z1) / len;
    const yaw = Math.atan2(dx, dz);
    for (let t = 6; t < len - 6; t += 24) {
      // A pole on one side, leaning slightly, with a crossarm.
      const px = road.x1 + dx * t - dz * (road.width / 2 + 2.6);
      const pz = road.z1 + dz * t + dx * (road.width / 2 + 2.6);
      const ground = terrainHeight(px, pz);
      k.add(px, ground + 4.6, pz, 0.32, 9.2, 0.32, 0x6d5943, { shape: 'cyl', finish: 'wood', uv: 0.8 });
      k.add(px, ground + 8.4, pz, 2.4, 0.18, 0.18, 0x6d5943, { shape: 'round', finish: 'wood', yaw, uv: 1.4 });
    }
    // Centre line.
    for (let t = 3; t < len - 3; t += 7) {
      const cx = road.x1 + dx * t, cz = road.z1 + dz * t;
      k.add(cx, terrainHeight(cx, cz) + 0.08, cz, 0.22, 0.03, 2.4, 0xe8d98a, { shape: 'plate', finish: 'paint', yaw, uv: 1 });
    }
  }
}

/** Physical cover, drawn to match what the collision actually is. */
function drawProps(k: Kit): void {
  for (const p of PROPS) {
    const { x, y, z, w, h, d, color } = p;
    switch (p.kind) {
      case 'fence': {
        const alongX = w > d;
        const len = alongX ? w : d;
        for (let t = -len / 2 + 0.2; t < len / 2; t += 1.9) {
          k.add(alongX ? x + t : x, y + h / 2, alongX ? z : z + t, alongX ? 0.16 : 0.24, h, alongX ? 0.24 : 0.16,
            color, { shape: 'round', finish: 'paint', uv: 1.6 });
        }
        for (const v of [0.34, 0.72]) {
          k.add(x, y + h * v, z, alongX ? len : 0.12, 0.14, alongX ? 0.12 : len, shade(color, 0.94), { finish: 'paint', uv: 1 });
        }
        break;
      }
      case 'haybale':
        k.add(x, y + h / 2, z, w, h, d, color, { shape: 'cyl', finish: 'dirt', roll: Math.PI / 2, uv: 1.2 });
        break;
      case 'container':
        k.add(x, y + h / 2, z, w, h, d, color, { finish: 'metal', uv: 0.5 });
        k.add(x, y + h / 2, z + d / 2 + 0.06, w * 0.98, h * 0.9, 0.1, shade(color, 0.85), { finish: 'metal', uv: 1 });
        for (let i = 0; i < 6; i++) {
          k.add(x - w / 2 + (i + 0.5) * (w / 6), y + h / 2, z + d / 2 + 0.1, 0.12, h, 0.1, shade(color, 0.7), { finish: 'metal', uv: 2 });
        }
        break;
      case 'barrel':
        k.add(x, y + h / 2, z, w, h, d, color, { shape: 'cyl', finish: 'metal', uv: 1.2 });
        for (const v of [0.2, 0.8]) k.add(x, y + h * v, z, w * 1.05, 0.1, d * 1.05, shade(color, 0.7), { shape: 'cyl', finish: 'metal', uv: 2 });
        break;
      case 'rock':
        k.add(x, y + h * 0.45, z, w, h * 1.2, d, color, { shape: 'stone', finish: 'stone', yaw: x * 0.7, uv: 0.5 });
        break;
      case 'well':
        k.add(x, y + h / 2, z, w, h, d, 0x9a948a, { shape: 'cyl', finish: 'stone', uv: 1 });
        k.add(x, y + h + 0.1, z, w * 1.15, 0.2, d * 1.15, 0xaaa396, { shape: 'cyl', finish: 'stone', uv: 1.4 });
        for (const s of [-1, 1]) k.add(x + s * w * 0.4, y + h + 1.2, z, 0.16, 2.2, 0.16, TIMBER, { shape: 'round', finish: 'wood', uv: 2 });
        k.add(x, y + h + 2.3, z, w * 1.5, 0.7, d * 1.5, 0x6b4b3c, { shape: 'cone', finish: 'shingle', uv: 1 });
        break;
      case 'tank':
        k.add(x, y + h * 0.7, z, w, h * 0.6, d, 0x9aa2a4, { shape: 'cyl', finish: 'metal', uv: 0.8 });
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          k.add(x + Math.cos(a) * w * 0.35, y + h * 0.2, z + Math.sin(a) * d * 0.35, 0.22, h * 0.4, 0.22, DARK_IRON, { shape: 'round', finish: 'metal', uv: 1.4 });
        }
        break;
      case 'sign':
        k.add(x, y + h / 2, z, w, h, d, color, { finish: 'plaster', uv: 0.35 });
        for (const s of [-1, 1]) k.add(x + s * w * 0.4, y + h * 0.3, z + d, 0.4, h * 0.6, 0.4, DARK_IRON, { shape: 'round', finish: 'metal', uv: 1 });
        break;
      case 'dumpster':
        k.add(x, y + h * 0.45, z, w, h * 0.9, d, color, { finish: 'metal', uv: 1 });
        k.add(x, y + h * 0.95, z, w * 1.05, h * 0.12, d * 1.05, shade(color, 0.8), { shape: 'round', finish: 'metal', uv: 1.2 });
        break;
      case 'barrier':
        k.add(x, y + h * 0.75, z, w, h * 0.3, d, color, { shape: 'round', finish: 'metal', uv: 1 });
        for (const s of [-1, 1]) k.add(x + s * w * 0.35, y + h * 0.4, z, 0.2, h * 0.8, 0.2, DARK_IRON, { shape: 'round', finish: 'metal', uv: 1.4 });
        break;
      case 'planter':
        k.add(x, y + h * 0.5, z, w, h, d, color, { shape: 'round', finish: 'concrete', uv: 1 });
        k.add(x, y + h + 0.2, z, w * 0.8, 0.5, d * 0.8, 0x5d7f4a, { shape: 'stone', finish: 'dirt', uv: 1.2 });
        break;
      case 'bench':
        k.add(x, y + h * 0.85, z, w, 0.14, d, color, { shape: 'round', finish: 'wood', uv: 1.4 });
        k.add(x, y + h * 1.25, z - d * 0.4, w, 0.5, 0.12, color, { shape: 'round', finish: 'wood', uv: 1.4 });
        for (const s of [-1, 1]) k.add(x + s * w * 0.38, y + h * 0.42, z, 0.12, h * 0.85, d * 0.8, DARK_IRON, { finish: 'metal', uv: 1.4 });
        break;
      default:
        k.add(x, y + h / 2, z, w, h, d, color, { finish: 'wood', uv: 1 });
    }
  }
}

// ---------------------------------------------------------------------------

function shade(hex: number, mul: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * mul));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * mul));
  const b = Math.min(255, Math.round((hex & 0xff) * mul));
  return (r << 16) | (g << 8) | b;
}

export interface Environment {
  update(time: number): void;
}

export function createEnvironment(scene: THREE.Scene, anisotropy = 4): Environment {
  const k = new Kit(anisotropy);

  for (const bp of BLUEPRINTS) {
    for (const run of bp.walls) drawWall(k, bp, run);
    for (const s of bp.solids) {
      k.add(s.x, s.y, s.z, s.w, s.h, s.d, s.color ?? 0xd8d2c4,
        { finish: s.surface ? SURFACE_FINISH[s.surface] : 'wood', uv: 0.8 });
    }
    drawFloors(k, bp);
    drawStairs(k, bp);
    drawRoof(k, bp);
    drawCharacter(k, bp);
  }

  drawBridges(k);
  drawDecks(k);
  drawRoadside(k);
  drawProps(k);
  const falls = drawWaterfall(k, scene);

  k.finish(scene);
  placeSigns(scene);
  void LAKE;

  return { update: t => falls.update(t) };
}
