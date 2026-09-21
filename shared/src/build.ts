import {
  TILE, PIECE_THICKNESS, GRID_MIN_XZ, GRID_MAX_XZ, GRID_MIN_Y, GRID_MAX_Y,
  MATERIALS, BUILD_SPAWN_HP_FRACTION,
} from "./constants";

// ---------------------------------------------------------------------------
// Slots
//
// A cell owns at most one of each slot. Walls are shared between neighbouring
// cells, so every wall placement is canonicalised onto the cell that sits on
// its +X / +Z side. That way two players aiming at opposite faces of the same
// wall address the same piece instead of stacking two coincident walls.
// ---------------------------------------------------------------------------

export const SLOT_FLOOR = 0;
export const SLOT_RAMP = 1;
export const SLOT_CONE = 2;
export const SLOT_WALL_X = 3; // wall on the cell's -X face (the YZ plane)
export const SLOT_WALL_Z = 4; // wall on the cell's -Z face (the XY plane)
export const SLOT_COUNT = 5;

export type Slot = 0 | 1 | 2 | 3 | 4;

/** Ramp/cone facing. 0=+X, 1=+Z, 2=-X, 3=-Z */
export type Facing = 0 | 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Key packing: gx(10) | gz(10) | gy(7) | slot(3) = 30 bits, so it stays a
// safe positive int32 and bitwise ops are valid.
// ---------------------------------------------------------------------------

export function packKey(gx: number, gy: number, gz: number, slot: Slot): number {
  return (
    ((gx - GRID_MIN_XZ) << 20) |
    ((gz - GRID_MIN_XZ) << 10) |
    ((gy - GRID_MIN_Y) << 3) |
    slot
  );
}

export function unpackKey(key: number): { gx: number; gy: number; gz: number; slot: Slot } {
  return {
    gx: ((key >>> 20) & 0x3ff) + GRID_MIN_XZ,
    gz: ((key >>> 10) & 0x3ff) + GRID_MIN_XZ,
    gy: ((key >>> 3) & 0x7f) + GRID_MIN_Y,
    slot: (key & 0x7) as Slot,
  };
}

export function inGridBounds(gx: number, gy: number, gz: number): boolean {
  return (
    gx >= GRID_MIN_XZ && gx <= GRID_MAX_XZ &&
    gz >= GRID_MIN_XZ && gz <= GRID_MAX_XZ &&
    gy >= GRID_MIN_Y && gy <= GRID_MAX_Y
  );
}

/** World position -> containing cell. Floor division so negatives behave. */
export function worldToCell(x: number, y: number, z: number) {
  return {
    gx: Math.floor(x / TILE),
    gy: Math.floor(y / TILE),
    gz: Math.floor(z / TILE),
  };
}

// ---------------------------------------------------------------------------
// Piece state
// ---------------------------------------------------------------------------

export interface Piece {
  key: number;
  slot: Slot;
  gx: number;
  gy: number;
  gz: number;
  mat: number;
  facing: Facing;
  hp: number;
  maxHp: number;
  /** Server time (seconds) the piece was placed; drives the grow-in ramp. */
  placedAt: number;
  ownerId: number;
}

export function makePiece(
  gx: number, gy: number, gz: number, slot: Slot,
  mat: number, facing: Facing, ownerId: number, now: number,
): Piece {
  const def = MATERIALS[mat] ?? MATERIALS[0];
  return {
    key: packKey(gx, gy, gz, slot),
    slot, gx, gy, gz, mat, facing,
    hp: def.maxHp,
    maxHp: def.maxHp,
    placedAt: now,
    ownerId,
  };
}

/** Pieces grow in after placement; a fresh wall is weak for a moment. */
export function currentHp(piece: Piece, now: number): number {
  const def = MATERIALS[piece.mat] ?? MATERIALS[0];
  const t = Math.max(0, Math.min(1, (now - piece.placedAt) / def.buildTime));
  const grown = def.maxHp * (BUILD_SPAWN_HP_FRACTION + (1 - BUILD_SPAWN_HP_FRACTION) * t);
  // hp tracks damage taken, so the effective value is whichever is lower.
  return Math.min(piece.hp, grown);
}

// ---------------------------------------------------------------------------
// Collision geometry
//
// Every piece resolves to one or more axis-aligned boxes, except ramps, which
// are handled as a height function in the movement solver. Boxes are returned
// as [minX, minY, minZ, maxX, maxY, maxZ].
// ---------------------------------------------------------------------------

export type Box = [number, number, number, number, number, number];

const T = PIECE_THICKNESS;

export function pieceBox(piece: Piece): Box | null {
  const x0 = piece.gx * TILE;
  const y0 = piece.gy * TILE;
  const z0 = piece.gz * TILE;

  switch (piece.slot) {
    case SLOT_FLOOR:
      return [x0, y0, z0, x0 + TILE, y0 + T, z0 + TILE];
    case SLOT_WALL_X:
      return [x0 - T * 0.5, y0, z0, x0 + T * 0.5, y0 + TILE, z0 + TILE];
    case SLOT_WALL_Z:
      return [x0, y0, z0 - T * 0.5, x0 + TILE, y0 + TILE, z0 + T * 0.5];
    case SLOT_CONE:
      // Approximated as a low box; the visual mesh is a pyramid. Close enough
      // for movement, and it keeps cones from being free cover.
      return [x0, y0, z0, x0 + TILE, y0 + TILE * 0.5, z0 + TILE];
    case SLOT_RAMP:
      return null; // handled by rampHeightAt
    default:
      return null;
  }
}

/**
 * Surface height of a ramp at a world XZ, or null if outside its footprint.
 * Ramps rise a full tile across the cell in their facing direction.
 */
export function rampHeightAt(piece: Piece, x: number, z: number): number | null {
  if (piece.slot !== SLOT_RAMP) return null;
  const x0 = piece.gx * TILE;
  const y0 = piece.gy * TILE;
  const z0 = piece.gz * TILE;
  if (x < x0 || x > x0 + TILE || z < z0 || z > z0 + TILE) return null;

  const u = (x - x0) / TILE; // 0..1
  const v = (z - z0) / TILE; // 0..1
  let t: number;
  switch (piece.facing) {
    case 0: t = u; break;
    case 1: t = v; break;
    case 2: t = 1 - u; break;
    default: t = 1 - v; break;
  }
  return y0 + t * TILE;
}

/** Ramps are solid underneath, so you cannot walk through the wedge. */
export function rampUnderBox(piece: Piece): Box {
  const x0 = piece.gx * TILE;
  const y0 = piece.gy * TILE;
  const z0 = piece.gz * TILE;
  return [x0, y0, z0, x0 + TILE, y0 + TILE, z0 + TILE];
}
