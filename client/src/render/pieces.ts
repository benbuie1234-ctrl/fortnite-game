import * as THREE from "three";
import { TILE, PIECE_THICKNESS, MATERIALS } from "@shared/constants";
import {
  Piece, SLOT_FLOOR, SLOT_RAMP, SLOT_WALL_X, SLOT_WALL_Z,
  Slot, Facing, currentHp,
} from "@shared/build";
import type { World } from "@shared/world";
import { ARENA_OWNER } from "@shared/arena";

const T = PIECE_THICKNESS;

// ---------------------------------------------------------------------------
// Geometry, built once and shared by every piece of that shape.
// ---------------------------------------------------------------------------

const geoFloor = new THREE.BoxGeometry(TILE, T, TILE);
const geoWallX = new THREE.BoxGeometry(T, TILE, TILE);
const geoWallZ = new THREE.BoxGeometry(TILE, TILE, T);
const geoRamp = makeRampGeometry();
// Half-height pyramid, matching the collision box in build.ts exactly. A cone
// you can shoot over but not walk through.
const geoCone = makeConeGeometry();

/**
 * Triangular prism rising toward +X, centred horizontally on the cell so it
 * can be rotated about its own vertical axis for the other three facings.
 */
function makeRampGeometry(): THREE.BufferGeometry {
  const h = TILE / 2;
  // Cross-section corners, in cell-local space shifted to centre on XZ.
  const A: [number, number, number] = [-h, 0, -h];
  const B: [number, number, number] = [h, 0, -h];
  const C: [number, number, number] = [h, TILE, -h];
  const D: [number, number, number] = [-h, 0, h];
  const E: [number, number, number] = [h, 0, h];
  const F: [number, number, number] = [h, TILE, h];

  const tris: Array<[number, number, number][]> = [
    [A, B, E], [A, E, D],   // underside
    [B, C, F], [B, F, E],   // vertical back face
    [A, D, F], [A, F, C],   // the walkable slope
    [A, C, B],              // side at -Z
    [D, E, F],              // side at +Z
  ];

  const positions: number[] = [];
  for (const tri of tris) for (const v of tri) positions.push(v[0], v[1], v[2]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeConeGeometry(): THREE.BufferGeometry {
  const h = TILE / 2;
  const geo = new THREE.ConeGeometry(TILE * 0.72, TILE * 0.5, 4, 1);
  // ConeGeometry is centred on its own height and rotated 45 degrees off the
  // grid; square it up and sit it on the cell floor.
  geo.rotateY(Math.PI / 4);
  geo.translate(0, TILE * 0.25, 0);
  void h;
  return geo;
}

// ---------------------------------------------------------------------------
// Materials, one per build material plus the arena's own.
// ---------------------------------------------------------------------------

const pieceMaterials = MATERIALS.map((m) =>
  new THREE.MeshLambertMaterial({ color: m.color }),
);
const arenaMaterial = new THREE.MeshLambertMaterial({ color: 0x77808e });

const FACING_ANGLE: Record<Facing, number> = {
  0: 0,             // +X, as authored
  1: -Math.PI / 2,  // +Z
  2: Math.PI,       // -X
  3: Math.PI / 2,   // -Z
};

function geometryFor(slot: Slot): THREE.BufferGeometry {
  switch (slot) {
    case SLOT_FLOOR: return geoFloor;
    case SLOT_WALL_X: return geoWallX;
    case SLOT_WALL_Z: return geoWallZ;
    case SLOT_RAMP: return geoRamp;
    default: return geoCone;
  }
}

/** Mesh centre for a piece, matching the collision boxes in build.ts. */
function placeMesh(mesh: THREE.Object3D, piece: Piece): void {
  const x0 = piece.gx * TILE;
  const y0 = piece.gy * TILE;
  const z0 = piece.gz * TILE;

  switch (piece.slot) {
    case SLOT_FLOOR:
      mesh.position.set(x0 + TILE / 2, y0 + T / 2, z0 + TILE / 2);
      break;
    case SLOT_WALL_X:
      mesh.position.set(x0, y0 + TILE / 2, z0 + TILE / 2);
      break;
    case SLOT_WALL_Z:
      mesh.position.set(x0 + TILE / 2, y0 + TILE / 2, z0);
      break;
    case SLOT_RAMP:
      mesh.position.set(x0 + TILE / 2, y0, z0 + TILE / 2);
      mesh.rotation.y = FACING_ANGLE[piece.facing];
      break;
    default: // cone
      mesh.position.set(x0 + TILE / 2, y0, z0 + TILE / 2);
      break;
  }
}

/**
 * Keeps the Three.js scene in step with the authoritative piece map. Called
 * every frame; only touches meshes whose piece actually changed.
 */
export class PieceRenderer {
  private meshes = new Map<number, THREE.Mesh>();
  private group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  sync(world: World, nowSec: number): void {
    // Add or update.
    for (const [key, piece] of world.pieces) {
      let mesh = this.meshes.get(key);
      if (!mesh) {
        const isArena = piece.ownerId === ARENA_OWNER;
        mesh = new THREE.Mesh(
          geometryFor(piece.slot),
          isArena ? arenaMaterial : pieceMaterials[piece.mat] ?? pieceMaterials[0],
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        placeMesh(mesh, piece);
        this.group.add(mesh);
        this.meshes.set(key, mesh);
      }

      if (piece.ownerId === ARENA_OWNER) continue;

      // Grow-in: a freshly placed piece scales up over its build time, which
      // is also the window where it is weakest.
      const def = MATERIALS[piece.mat] ?? MATERIALS[0];
      const age = nowSec - piece.placedAt;
      const t = Math.min(1, Math.max(0, age / def.buildTime));
      const grow = 0.2 + 0.8 * easeOutCubic(t);
      mesh.scale.setScalar(grow);

      // Damage reads as darkening, so you can tell at a glance which wall to
      // keep shooting.
      const hpFrac = Math.max(0, Math.min(1, currentHp(piece, nowSec) / piece.maxHp));
      const mat = mesh.material as THREE.MeshLambertMaterial;
      if (mat !== pieceMaterials[piece.mat]) {
        mesh.material = pieceMaterials[piece.mat].clone();
      }
      const base = new THREE.Color(def.color);
      (mesh.material as THREE.MeshLambertMaterial).color
        .copy(base)
        .multiplyScalar(0.45 + 0.55 * hpFrac);
    }

    // Remove.
    for (const [key, mesh] of this.meshes) {
      if (world.pieces.has(key)) continue;
      this.group.remove(mesh);
      if (mesh.material !== arenaMaterial && !pieceMaterials.includes(mesh.material as THREE.MeshLambertMaterial)) {
        (mesh.material as THREE.Material).dispose();
      }
      this.meshes.delete(key);
    }
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Translucent preview of where the current build piece would land. */
export class BuildGhost {
  private mesh: THREE.Mesh;
  private currentSlot: Slot | null = null;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(
      geoWallX,
      new THREE.MeshBasicMaterial({
        color: 0xffc53d, transparent: true, opacity: 0.32,
        depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  hide(): void { this.mesh.visible = false; }

  show(target: { gx: number; gy: number; gz: number; slot: Slot; facing: Facing }, blocked: boolean): void {
    if (this.currentSlot !== target.slot) {
      this.mesh.geometry = geometryFor(target.slot);
      this.currentSlot = target.slot;
    }
    this.mesh.rotation.set(0, 0, 0);
    placeMesh(this.mesh, {
      ...target, key: 0, mat: 0, hp: 1, maxHp: 1, placedAt: 0, ownerId: 0,
    } as Piece);
    (this.mesh.material as THREE.MeshBasicMaterial).color.setHex(blocked ? 0xff5a5a : 0xffc53d);
    this.mesh.visible = true;
  }
}
