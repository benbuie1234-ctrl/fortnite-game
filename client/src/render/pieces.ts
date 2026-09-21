import { buildingAt } from "@shared/map";
import * as THREE from "three";
import { TILE, PIECE_THICKNESS, MATERIALS } from "@shared/constants";
import {
  SLOT_FLOOR, SLOT_RAMP, SLOT_WALL_X, SLOT_WALL_Z,
  Slot, Facing, currentHp, type Piece,
} from "@shared/build";
import type { World } from "@shared/world";
import { ARENA_OWNER } from "@shared/arena";
import { getTextures, planarUVs } from "./textures";

const T = PIECE_THICKNESS;

/** One texture tile per metre of world space, on every piece. */
const METERS_PER_TILE = 1.0;

// ---------------------------------------------------------------------------
// Geometry, built once and shared by every piece of that shape. UVs are baked
// per geometry so a single shared texture tiles at the same density on a 3 m
// wall and a 0.25 m floor slab.
// ---------------------------------------------------------------------------

const geoFloor = buildPieceBox(TILE, T, TILE);
const geoWallX = buildPieceBox(T, TILE, TILE);
const geoWallZ = buildPieceBox(TILE, TILE, T);

/**
 * A box for one build piece: subdivided, UV-mapped in world space, and with
 * soft occlusion baked into its vertex colours.
 *
 * The subdivision exists purely so the occlusion has somewhere to live. A
 * plain BoxGeometry has nothing but corner vertices, and every corner is an
 * edge, so a darkening pass would flatten the whole piece uniformly instead of
 * shading a border.
 */
function buildPieceBox(w: number, h: number, d: number): THREE.BufferGeometry {
  // Roughly one segment every 40 cm, which is enough to resolve the falloff
  // below without adding vertices that never get used.
  const seg = (n: number) => Math.max(1, Math.min(8, Math.round(n / 0.4)));
  const geo = new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d));
  // Project UVs from position rather than scaling the stock 0..1 set: the
  // stock layout assumes exactly four vertices per face, which subdivision
  // breaks.
  planarUVs(geo, METERS_PER_TILE);
  bakeEdgeAO(geo);
  return geo;
}

/**
 * Darken vertices near the border of each face, fading to full brightness
 * toward the middle.
 *
 * This is the cheap stand-in for screen-space ambient occlusion, and it is how
 * stylised games have always done it: the shading lives in the mesh, costs
 * nothing at runtime, and -- unlike painting shadow into the texture -- it
 * survives a texture that tiles several times across one piece. It also gives
 * every piece a soft dark seam against its neighbours, which is what makes a
 * built structure read as separate pieces rather than one blob.
 */
function bakeEdgeAO(geo: THREE.BufferGeometry, falloff = 0.45, minShade = 0.62): void {
  const pos = geo.getAttribute("position");
  const normal = geo.getAttribute("normal");
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb || !normal) return;

  const half = [
    (bb.max.x - bb.min.x) / 2,
    (bb.max.y - bb.min.y) / 2,
    (bb.max.z - bb.min.z) / 2,
  ];

  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const n = [Math.abs(normal.getX(i)), Math.abs(normal.getY(i)), Math.abs(normal.getZ(i))];

    // Which axis this face points along; the other two span the face.
    let axis = 0;
    if (n[1] >= n[0] && n[1] >= n[2]) axis = 1;
    else if (n[2] >= n[0]) axis = 2;

    // Distance to the nearest face border, along whichever tangent axis is
    // closest to one.
    let edgeDist = Infinity;
    for (let a = 0; a < 3; a++) {
      if (a === axis) continue;
      edgeDist = Math.min(edgeDist, half[a] - Math.abs(p[a]));
    }

    const t = Math.max(0, Math.min(1, edgeDist / falloff));
    const eased = t * t * (3 - 2 * t); // smoothstep
    const shade = minShade + (1 - minShade) * eased;
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

/** Vertical gradient for shapes that have no flat faces to border-shade. */
function bakeVerticalAO(geo: THREE.BufferGeometry, minShade = 0.66): void {
  const pos = geo.getAttribute("position");
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return;

  const span = Math.max(1e-6, bb.max.y - bb.min.y);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - bb.min.y) / span;
    const shade = minShade + (1 - minShade) * t;
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

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
  // The wedge has no UVs of its own; project them from the dominant axis.
  planarUVs(geo, METERS_PER_TILE);
  // Only six vertices, all of them corners, so border shading has nowhere to
  // go. A base-to-top gradient reads correctly on a slope anyway.
  bakeVerticalAO(geo);
  return geo;
}

function makeConeGeometry(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(TILE * 0.72, TILE * 0.5, 4, 1);
  // ConeGeometry is centred on its own height and rotated 45 degrees off the
  // grid; square it up and sit it on the cell floor.
  geo.rotateY(Math.PI / 4);
  geo.translate(0, TILE * 0.25, 0);
  planarUVs(geo, METERS_PER_TILE);
  bakeVerticalAO(geo);
  return geo;
}

// ---------------------------------------------------------------------------
// Materials
//
// Damage reads as darkening. Rather than cloning a material per piece (which
// would allocate one material for every wall on the map), pieces are bucketed
// into a few damage levels that share pre-built materials. 3 materials x 4
// buckets = 12 total, no matter how much anyone builds.
// ---------------------------------------------------------------------------

const DAMAGE_BUCKETS = [1.0, 0.82, 0.63, 0.45];

/**
 * Physical surface response per build material, indexed to MATERIALS.
 *
 * This is what a switch to MeshStandardMaterial actually buys: metal can be
 * genuinely metallic and catch a highlight off the sky, while wood and brick
 * stay matte. Under MeshLambertMaterial all three were the same flat surface
 * wearing different colours.
 */
const SURFACE = [
  { roughness: 0.82, metalness: 0.0 },  // wood
  { roughness: 0.95, metalness: 0.0 },  // brick
  { roughness: 0.38, metalness: 0.75 }, // metal
];

interface MaterialPool {
  build: THREE.MeshStandardMaterial[][]; // [materialId][bucket]
  arena: THREE.MeshStandardMaterial;
}

let pool: MaterialPool | null = null;

function materials(anisotropy: number): MaterialPool {
  if (pool) return pool;
  const tex = getTextures(anisotropy);

  pool = {
    build: MATERIALS.map((_def, i) =>
      DAMAGE_BUCKETS.map((mul) =>
        new THREE.MeshStandardMaterial({
          map: tex.build[i] ?? tex.build[0],
          // Multiplies the baked occlusion in bakeEdgeAO over the texture.
          vertexColors: true,
          // The texture already carries the material's colour, so the tint
          // here must start at white and only darken for damage. Multiplying
          // by def.color would apply the colour twice.
          color: new THREE.Color(0xffffff).multiplyScalar(mul),
          roughness: SURFACE[i]?.roughness ?? 0.9,
          metalness: SURFACE[i]?.metalness ?? 0,
          envMapIntensity: 0.85,
        }),
      ),
    ),
    arena: new THREE.MeshStandardMaterial({
      map: tex.concrete, color: 0xffffff, vertexColors: true,
      roughness: 0.92, metalness: 0, envMapIntensity: 0.8,
    }),
  };
  return pool;
}

function bucketFor(hpFrac: number): number {
  if (hpFrac > 0.75) return 0;
  if (hpFrac > 0.5) return 1;
  if (hpFrac > 0.25) return 2;
  return 3;
}

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
function placeMesh(mesh: THREE.Object3D, piece: {
  gx: number; gy: number; gz: number; slot: Slot; facing: Facing;
}): void {
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
  private staticReady=false;
  private staticChunks:THREE.Group[]=[];
  private meshes = new Map<number, THREE.Mesh>();
  private flashes = new Map<number, number>();
  private flashMaterial=new THREE.MeshLambertMaterial({color:0xffb266});
  flash(key:number):void { this.flashes.set(key,performance.now()+140); }
  private buckets = new Map<number, number>();
  private group = new THREE.Group();
  private pool: MaterialPool;

  constructor(scene: THREE.Scene, anisotropy: number) {
    this.pool = materials(anisotropy);
    scene.add(this.group);
  }

  private buildStatic(world:World):void {
    const batches=new Map<string,Piece[]>();
    for(const p of world.pieces.values()) {
      if(p.ownerId!==ARENA_OWNER)continue;
      const key=`${Math.floor(p.gx/16)},${Math.floor(p.gz/16)},${p.slot}`;
      const list=batches.get(key)??[];list.push(p);batches.set(key,list);
    }
    const transform=new THREE.Object3D();
    // Physical, not Lambert. Lambert takes no light from the environment map,
    // so every map building was lit by the hemisphere term alone and any face
    // turned away from the sun crushed to black.
    const material=new THREE.MeshStandardMaterial({
      color:0xffffff, roughness:0.9, metalness:0, envMapIntensity:0.95,
    });
    for(const list of batches.values()) {
      const batch=new THREE.InstancedMesh(geometryFor(list[0].slot),material,list.length);
      list.forEach((p,i)=>{
        transform.rotation.set(0,0,0);placeMesh(transform,p);transform.updateMatrix();batch.setMatrixAt(i,transform.matrix);
        const building=buildingAt(p.gx,p.gz);
        let color=building?.color??0x648e91;
        if(p.slot===SLOT_FLOOR)color=0xd5cfb8;
        if(p.slot===SLOT_RAMP)color=building&&(building.style==='house'||building.style==='cabin')&&p.gy>=building.base+building.floors?0x985943:0x9a9d98;
        batch.setColorAt(i,new THREE.Color(color));
      });
      batch.instanceMatrix.needsUpdate=true;
      batch.computeBoundingSphere();batch.receiveShadow=true;batch.castShadow=true;
      const chunk=new THREE.Group();chunk.add(batch);this.staticChunks.push(chunk);this.group.add(chunk);
    }
    this.staticReady=true;
  }
  updateVisibility(x:number,z:number):void {
    for(const chunk of this.staticChunks) {
      const mesh=chunk.children[0] as THREE.InstancedMesh;
      const center=mesh.boundingSphere!.center;
      const distance=Math.hypot(center.x-x,center.z-z);
      chunk.visible=distance<300+mesh.boundingSphere!.radius;
      mesh.castShadow=distance<75;
    }
  }
  sync(world: World, nowSec: number): void {
    if(!this.staticReady)this.buildStatic(world);
    // Add or update.
    for (const [key, piece] of world.pieces) {
      if(piece.ownerId===ARENA_OWNER)continue;
      let mesh = this.meshes.get(key);
      const isArena = piece.ownerId === ARENA_OWNER;

      if (!mesh) {
        mesh = new THREE.Mesh(
          geometryFor(piece.slot),
          isArena ? this.pool.arena : (this.pool.build[piece.mat] ?? this.pool.build[0])[0],
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        placeMesh(mesh, piece);
        this.group.add(mesh);
        this.meshes.set(key, mesh);
        this.buckets.set(key, 0);
      }

      if (isArena) continue;

      // Keep the visible shape aligned with its full-size collision from placement.
      mesh.scale.setScalar(1);

      // Swap to a darker shared material only when the damage bucket changes.
      const hpFrac = Math.max(0, Math.min(1, currentHp(piece, nowSec) / piece.maxHp));
      const bucket = bucketFor(hpFrac);
      {
        this.buckets.set(key, bucket);
        mesh.material = (this.flashes.get(key)??0)>performance.now()?this.flashMaterial:(this.pool.build[piece.mat] ?? this.pool.build[0])[bucket];
        if((this.flashes.get(key)??0)<=performance.now())this.flashes.delete(key);
      }
    }

    // Remove. Geometry and materials are shared, so nothing is disposed here.
    for (const [key, mesh] of this.meshes) {
      if (world.pieces.has(key)) continue;
      this.group.remove(mesh);
      this.meshes.delete(key);
      this.flashes.delete(key);
      this.buckets.delete(key);
    }
  }
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

  show(
    target: { gx: number; gy: number; gz: number; slot: Slot; facing: Facing },
    blocked: boolean,
  ): void {
    if (this.currentSlot !== target.slot) {
      this.mesh.geometry = geometryFor(target.slot);
      this.currentSlot = target.slot;
    }
    this.mesh.rotation.set(0, 0, 0);
    placeMesh(this.mesh, target);
    (this.mesh.material as THREE.MeshBasicMaterial).color.setHex(blocked ? 0xff5a5a : 0xffc53d);
    this.mesh.visible = true;
  }
}
