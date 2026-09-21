import { terrainHeight } from "./map";
import { TILE } from "./constants";
import {
  Piece, Box, Slot, SLOT_COUNT, SLOT_RAMP,
  packKey, pieceBox, pieceBoxes, rampUnderBox, rampHeightAt, inGridBounds, currentHp,
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
  private obstacles=new Map<string, Array<{box:Box;piece:Piece}>>();
  addObstacle(box:Box,key:number):void {
    const item={box,piece:{key,gx:0,gy:0,gz:0,slot:0 as Slot,facing:0 as const,mat:2,hp:Infinity,maxHp:Infinity,placedAt:-1e9,ownerId:255}};
    for(let x=Math.floor(box[0]/TILE);x<=Math.floor(box[3]/TILE);x++)for(let z=Math.floor(box[2]/TILE);z<=Math.floor(box[5]/TILE);z++) {
      const cell=`${x},${z}`,list=this.obstacles.get(cell)??[];list.push(item);this.obstacles.set(cell,list);
    }
  }
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
    this.obstacles.clear();
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
    const found=new Set<Box>();
    for(let x=cx0;x<=cx1;x++)for(let z=cz0;z<=cz1;z++)for(const item of this.obstacles.get(`${x},${z}`)??[]) {
      if(!found.has(item.box)&&item.box[4]>=minY&&item.box[1]<=maxY){outBoxes.push(item.box);found.add(item.box);}
    }

    for (let gx = cx0; gx <= cx1; gx++) {
      for (let gy = cy0; gy <= cy1; gy++) {
        for (let gz = cz0; gz <= cz1; gz++) {
          if (!inGridBounds(gx, gy, gz)) continue;
          for (let slot = 0; slot < SLOT_COUNT; slot++) {
            const piece = this.pieces.get(packKey(gx, gy, gz, slot as Slot));
            if (!piece) continue;
            // Ramps still register for the surface snap, which is what makes
            // walking up one smooth -- but they now ALSO contribute solid
            // boxes. Previously they contributed none at all, which is why a
            // ramp could be walked through from the side and fallen through
            // from above.
            if (piece.slot === SLOT_RAMP) outRamps.push(piece);
            for (const box of pieceBoxes(piece)) outBoxes.push(box);
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
    let best: RayHit | null = this.terrainEnabled ? this.terrainRay(ox,oy,oz,dx,dy,dz,maxDist) : null;
    // Neighbour cells too: a wall on a cell face belongs to the +X/+Z cell.
    for (let guard = 0; guard < 512 && travelled <= maxDist; guard++) {
      for(const item of this.obstacles.get(`${gx},${gz}`)??[]) {
        const hit=rayVsBox(item.box,ox,oy,oz,dx,dy,dz);
        if(hit&&hit.t<=maxDist&&(!best||hit.t<best.t))best={...hit,piece:item.piece};
      }

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

  private terrainRay(ox:number,oy:number,oz:number,dx:number,dy:number,dz:number,max:number):RayHit|null {
    if(oy<this.groundAt(ox,oz)-.05)return null;
    for(let t=.5;t<=max+.5;t+=.5) {
      const end=Math.min(max,t);
      if(oy+dy*end>this.groundAt(ox+dx*end,oz+dz*end))continue;
      let lo=Math.max(0,t-.5),hi=end;
      for(let n=0;n<10;n++){const mid=(lo+hi)/2;if(oy+dy*mid>this.groundAt(ox+dx*mid,oz+dz*mid))lo=mid;else hi=mid;}
      return {t:hi,point:[ox+dx*hi,oy+dy*hi,oz+dz*hi],normal:[0,1,0],piece:{key:-1,gx:0,gy:0,gz:0,slot:0,facing:0,mat:2,hp:Infinity,maxHp:Infinity,placedAt:-1e9,ownerId:255}};
    }
    return null;
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
  const b=rampUnderBox(piece),n=rampNormal(piece);
  const h=rampHeightAt(piece,b[0],b[2])!;
  const planes:Array<[number,number,number,number]>=[
    [-1,0,0,-b[0]],[1,0,0,b[3]],[0,-1,0,-b[1]],
    [0,0,-1,-b[2]],[0,0,1,b[5]],
    [n[0],n[1],n[2],n[0]*b[0]+n[1]*h+n[2]*b[2]],
  ];
  let enter=0,exit=Infinity;
  let normal:[number,number,number]=[0,1,0];
  for(const [nx,ny,nz,limit] of planes) {
    const distance=limit-nx*ox-ny*oy-nz*oz,rate=nx*dx+ny*dy+nz*dz;
    if(Math.abs(rate)<1e-9){if(distance<0)return null;continue;}
    const t=distance/rate;
    if(rate<0){if(t>enter){enter=t;normal=[nx,ny,nz];}}
    else exit=Math.min(exit,t);
    if(enter>exit)return null;
  }
  return {t:enter,point:[ox+dx*enter,oy+dy*enter,oz+dz*enter],normal};
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
