import { terrainHeight } from "./map";
import { TILE } from "./constants";
import {
  Piece, Box, Slot, SLOT_COUNT, SLOT_RAMP,
  packKey, pieceBox, rampUnderBox, rampHeightAt, inGridBounds, currentHp,
} from "./build";

export interface RayHit {
  t: number;              // distance along the ray
  point: [number, number, number];
  normal: [number, number, number];
  piece: Piece;
}

/**
 * The built world. Deliberately plain: a flat map of pieces keyed by packed
 * grid key. Both the authoritative server and the predicting client run this
 * exact class, so placement and collision cannot disagree.
 */
export class World {
  readonly pieces = new Map<number, Piece>();
  /** Flat arena floor sits at y=0; below that is the void. */
  readonly groundY = 0;
  terrainEnabled=false;
  groundAt(x:number,z:number):number { return this.terrainEnabled?terrainHeight(x,z):this.groundY; }

  get(gx: number, gy: number, gz: number, slot: Slot): Piece | undefined {
    return this.pieces.get(packKey(gx, gy, gz, slot));
  }

  set(piece: Piece): void {
    this.pieces.set(piece.key, piece);
  }

  remove(key: number): boolean {
    return this.pieces.delete(key);
  }

  clear(): void {
    this.pieces.clear();
  }

  /**
   * Collision boxes overlapping an AABB, plus any ramps whose footprint it
   * covers. Walks only the cells the box actually touches.
   */
  collidersNear(
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    outBoxes: Box[], outRamps: Piece[],
  ): void {
    outBoxes.length = 0;
    outRamps.length = 0;

    // Pad by one cell: walls live on cell faces and can reach in from a neighbour.
    const cx0 = Math.floor(minX / TILE) - 1;
    const cx1 = Math.floor(maxX / TILE) + 1;
    const cy0 = Math.floor(minY / TILE) - 1;
    const cy1 = Math.floor(maxY / TILE) + 1;
    const cz0 = Math.floor(minZ / TILE) - 1;
    const cz1 = Math.floor(maxZ / TILE) + 1;

    for (let gx = cx0; gx <= cx1; gx++) {
      for (let gy = cy0; gy <= cy1; gy++) {
        for (let gz = cz0; gz <= cz1; gz++) {
          if (!inGridBounds(gx, gy, gz)) continue;
          for (let slot = 0; slot < SLOT_COUNT; slot++) {
            const piece = this.pieces.get(packKey(gx, gy, gz, slot as Slot));
            if (!piece) continue;
            if (piece.slot === SLOT_RAMP) {
              outRamps.push(piece);
              continue;
            }
            const box = pieceBox(piece);
            if (box) outBoxes.push(box);
          }
        }
      }
    }
  }

  /** Highest ramp surface under a point, or -Infinity. */
  rampSurfaceAt(ramps: readonly Piece[], x: number, z: number, maxY: number): number {
    let best = -Infinity;
    for (const ramp of ramps) {
      const h = rampHeightAt(ramp, x, z);
      if (h !== null && h <= maxY && h > best) best = h;
    }
    return best;
  }

  /**
   * Raycast against built pieces using a 3D DDA so we only test cells the ray
   * actually enters. Returns the nearest hit within maxDist.
   */
  raycast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number,
    now: number,
  ): RayHit | null {
    let gx = Math.floor(ox / TILE);
    let gy = Math.floor(oy / TILE);
    let gz = Math.floor(oz / TILE);

    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;

    const invDx = dx !== 0 ? 1 / dx : Infinity;
    const invDy = dy !== 0 ? 1 / dy : Infinity;
    const invDz = dz !== 0 ? 1 / dz : Infinity;

    const tDeltaX = Math.abs(TILE * invDx);
    const tDeltaY = Math.abs(TILE * invDy);
    const tDeltaZ = Math.abs(TILE * invDz);

    const nextBoundary = (g: number, step: number) => (step > 0 ? (g + 1) * TILE : g * TILE);
    let tMaxX = dx !== 0 ? (nextBoundary(gx, stepX) - ox) * invDx : Infinity;
    let tMaxY = dy !== 0 ? (nextBoundary(gy, stepY) - oy) * invDy : Infinity;
    let tMaxZ = dz !== 0 ? (nextBoundary(gz, stepZ) - oz) * invDz : Infinity;

    let travelled = 0;
    let best: RayHit | null = null;
    // Neighbour cells too: a wall on a cell face belongs to the +X/+Z cell.
    for (let guard = 0; guard < 512 && travelled <= maxDist; guard++) {

      for (let ox2 = 0; ox2 <= 1; ox2++) {
        for (let oz2 = 0; oz2 <= 1; oz2++) {
          const cgx = gx + ox2;
          const cgz = gz + oz2;
          if (!inGridBounds(cgx, gy, cgz)) continue;
          for (let slot = 0; slot < SLOT_COUNT; slot++) {
            const piece = this.pieces.get(packKey(cgx, gy, cgz, slot as Slot));
            if (!piece || currentHp(piece, now) <= 0) continue;
            const hit = piece.slot === SLOT_RAMP
              ? rayVsRamp(piece, ox, oy, oz, dx, dy, dz)
              : rayVsBox(pieceBox(piece), ox, oy, oz, dx, dy, dz);
            if (hit && hit.t <= maxDist && (!best || hit.t < best.t)) {
              best = { ...hit, piece };
            }
          }
        }
      }
      const nearest = best as RayHit | null;
      if (nearest && nearest.t <= Math.min(tMaxX, tMaxY, tMaxZ) + 1e-6) return nearest;

      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        gx += stepX; travelled = tMaxX; tMaxX += tDeltaX;
      } else if (tMaxY < tMaxZ) {
        gy += stepY; travelled = tMaxY; tMaxY += tDeltaY;
      } else {
        gz += stepZ; travelled = tMaxZ; tMaxZ += tDeltaZ;
      }
    }
    return best;
  }
}

/** Slab test. Returns entry distance and face normal, or null. */
export function rayVsBox(
  box: Box | null,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
): Omit<RayHit, "piece"> | null {
  if (!box) return null;
  const [minX, minY, minZ, maxX, maxY, maxZ] = box;

  let tMin = -Infinity;
  let tMax = Infinity;
  let axis = 0;
  let sign = 1;

  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const lo = [minX, minY, minZ];
  const hi = [maxX, maxY, maxZ];

  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (lo[i] - o[i]) * inv;
    let t2 = (hi[i] - o[i]) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tMin) { tMin = t1; axis = i; sign = s; }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }
  if (tMax < 0) return null;
  const t = tMin < 0 ? 0 : tMin;

  const normal: [number, number, number] = [0, 0, 0];
  normal[axis] = sign;
  return { t, point: [ox + dx * t, oy + dy * t, oz + dz * t], normal };
}

/** Ray against a ramp's sloped surface, clipped to the cell footprint. */
export function rayVsRamp(
  piece: Piece,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
): Omit<RayHit, "piece"> | null {
  // The wedge's bounding box gives us the entry/exit window to search in.
  const bounds = rayVsBox(rampUnderBox(piece), ox, oy, oz, dx, dy, dz);
  if (!bounds) return null;

  // March the short span inside the cell and find where the ray crosses the
  // slope surface. The span is at most one tile, so this stays cheap and exact
  // enough that players never shoot through a ramp they are standing on.
  const steps = 12;
  const span = TILE * 1.75;
  let prevAbove: boolean | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = bounds.t + (span * i) / steps;
    const px = ox + dx * t;
    const py = oy + dy * t;
    const pz = oz + dz * t;
    const h = rampHeightAt(piece, px, pz);
    if (h === null) { prevAbove = null; continue; }
    const above = py > h;
    if (prevAbove === true && !above) {
      const nrm = rampNormal(piece);
      return { t, point: [px, py, pz], normal: nrm };
    }
    prevAbove = above;
  }
  return null;
}

function rampNormal(piece: Piece): [number, number, number] {
  // 45 degree slope, so the horizontal and vertical components are equal.
  const k = Math.SQRT1_2;
  switch (piece.facing) {
    case 0: return [-k, k, 0];
    case 1: return [0, k, -k];
    case 2: return [k, k, 0];
    default: return [0, k, k];
  }
}
