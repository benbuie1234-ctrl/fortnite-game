import { TILE } from "./constants";
import {
  Piece, Slot, SLOT_FLOOR, SLOT_WALL_X, SLOT_WALL_Z, SLOT_RAMP, Facing, packKey,
} from "./build";
import { World } from "./world";

/** Pieces owned by the arena itself. Indestructible, never sent over the wire. */
export const ARENA_OWNER = 255;
const ARENA_HP = Number.POSITIVE_INFINITY;

export const ARENA_HALF_TILES = 7;   // 15x15 tiles of playable floor
export const ARENA_WALL_HEIGHT = 5;  // tiles

export function isArenaPiece(p: Piece): boolean {
  return p.ownerId === ARENA_OWNER;
}

function place(
  world: World, gx: number, gy: number, gz: number,
  slot: Slot, facing: Facing = 0,
): void {
  const key = packKey(gx, gy, gz, slot);
  world.pieces.set(key, {
    key, slot, gx, gy, gz,
    mat: 2, facing,
    hp: ARENA_HP, maxHp: ARENA_HP,
    placedAt: -1e9, // long since fully built
    ownerId: ARENA_OWNER,
  });
}

/**
 * Deterministic small-map arena: a walled box with a raised centre platform and
 * ramps up to it. Client and server both call this with the same seed, so the
 * static geometry never needs to be transmitted or reconciled.
 */
export function buildArena(world: World, _seed = 1): void {
  const H = ARENA_HALF_TILES;

  // Boundary walls. Walls are canonicalised onto the -X / -Z face of a cell,
  // so the far edges are placed on the cell one past the playable area.
  for (let g = -H; g <= H; g++) {
    for (let y = 0; y < ARENA_WALL_HEIGHT; y++) {
      place(world, -H, y, g, SLOT_WALL_X);
      place(world, H + 1, y, g, SLOT_WALL_X);
      place(world, g, y, -H, SLOT_WALL_Z);
      place(world, g, y, H + 1, SLOT_WALL_Z);
    }
  }

  // Centre platform: 3x3 tiles one storey up, with ramps on two sides.
  for (let gx = -1; gx <= 1; gx++) {
    for (let gz = -1; gz <= 1; gz++) {
      place(world, gx, 1, gz, SLOT_FLOOR);
    }
  }
  place(world, -2, 0, 0, SLOT_RAMP, 0); // rises toward +X
  place(world, 2, 0, 0, SLOT_RAMP, 2);  // rises toward -X

  // Four corner cover blocks: a wall pair each, so there is something to
  // fight around before anyone starts building.
  const corners: Array<[number, number]> = [[-4, -4], [4, -4], [-4, 4], [4, 4]];
  for (const [cx, cz] of corners) {
    for (let y = 0; y < 2; y++) {
      place(world, cx, y, cz, SLOT_WALL_X);
      place(world, cx, y, cz, SLOT_WALL_Z);
    }
  }
}

/** Spawn points, spread around the ring so nobody spawns on top of anyone. */
export function arenaSpawns(): Array<{ x: number; y: number; z: number; yaw: number }> {
  const r = (ARENA_HALF_TILES - 1.5) * TILE;
  return [
    { x: 0, y: 0.05, z: -r, yaw: 0 },
    { x: 0, y: 0.05, z: r, yaw: Math.PI },
    // forwardVector(yaw) is (-sin yaw, 0, cos yaw), so the west spawn needs
    // -PI/2 to look toward +X and the east spawn +PI/2 to look toward -X.
    { x: -r, y: 0.05, z: 0, yaw: -Math.PI / 2 },
    { x: r, y: 0.05, z: 0, yaw: Math.PI / 2 },
  ];
}

/** Outside this, a player has escaped the map and is teleported back. */
export function isOutOfBounds(x: number, y: number, z: number): boolean {
  const limit = (ARENA_HALF_TILES + 2) * TILE;
  return x < -limit || x > limit || z < -limit || z > limit || y < -20 || y > 200;
}
