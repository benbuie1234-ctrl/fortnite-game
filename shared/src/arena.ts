import { TILE } from './constants';
import { Piece, Slot, SLOT_FLOOR, SLOT_RAMP, Facing, packKey } from './build';
import { World } from './world';
import {
  MAP_HALF, BLUEPRINTS, SCENERY, PROPS, CARS, CAR_LENGTH, CAR_WIDTH, CAR_HEIGHT,
  terrainHeight, DECKS, BRIDGES, wallBoxes, insideBuilding, waterLevelAt,
} from './map';

export const ARENA_OWNER = 255;
export const ARENA_HALF_TILES = MAP_HALF / TILE;
export const ARENA_WALL_HEIGHT = 0;
export function isArenaPiece(p: Piece): boolean { return p.ownerId === ARENA_OWNER; }

/** Cars are keyed from here downward, clear of scenery (-2 down) and props
 *  (-10000 down), so a collider can always be traced back to what it is. */
export const CAR_KEY_BASE = -20000;
/** Building walls, which are boxes rather than grid pieces so that a doorway
 *  can be a door-sized hole instead of a whole missing cell. */
export const WALL_KEY_BASE = -40000;
/** Bridges, piers and the other structures that are not buildings. */
export const STRUCTURE_KEY_BASE = -60000;

/** Scenery obstacles are keyed negatively; recover the SCENERY index. */
export function sceneryIndexFromKey(key: number): number { return -key - 2; }
/** The SCENERY index of the tree this collider belongs to, or -1. Props are
 *  keyed from -10000 down, so the range check separates them from scenery. */
export function treeIndexFromKey(key: number): number {
  if (key > -2 || key <= -10000) return -1;
  const i = sceneryIndexFromKey(key);
  return SCENERY[i]?.kind === 'tree' ? i : -1;
}

function place(w: World, x: number, y: number, z: number, slot: Slot, facing: Facing = 0): void {
  const key = packKey(x, y, z, slot);
  w.set({ key, gx: x, gy: y, gz: z, slot, facing, mat: 2, hp: Infinity, maxHp: Infinity, placedAt: -1e9, ownerId: ARENA_OWNER });
}

/**
 * Turn the island into colliders.
 *
 * Buildings come straight off their blueprints, which is the whole point of
 * having blueprints: the wall with a window in it that the renderer draws is
 * the same wall, with the same hole in it, that the server collides against.
 * Floors and stair flights stay grid pieces, because the movement code already
 * knows how to walk up a ramp and how to let a climb through the slab above it.
 * Walls are boxes instead, because a door should be door-sized.
 */
export function buildArena(world: World, _seed = 1): void {
  world.terrainEnabled = true;

  let wallKey = WALL_KEY_BASE;
  for (const bp of BLUEPRINTS) {
    for (const f of bp.floors) place(world, f.gx, f.gy, f.gz, SLOT_FLOOR);
    for (const s of bp.stairs) place(world, s.gx, s.gy, s.gz, SLOT_RAMP, s.facing);
    for (const r of bp.roofRamps) place(world, r.gx, r.gy, r.gz, SLOT_RAMP, r.facing);
    for (const run of bp.walls) {
      for (const box of wallBoxes(run)) world.addObstacle(box, wallKey--);
    }
    for (const s of bp.solids) {
      world.addObstacle(
        [s.x - s.w / 2, s.y - s.h / 2, s.z - s.d / 2, s.x + s.w / 2, s.y + s.h / 2, s.z + s.d / 2],
        wallKey--,
      );
    }
  }

  SCENERY.forEach((p, i) => {
    const r = p.kind === 'tree' ? 0.34 : p.size * 0.34;
    const h = p.kind === 'tree' ? p.size : p.size * 0.55;
    world.addObstacle([p.x - r, p.y, p.z - r, p.x + r, p.y + h, p.z + r], -i - 2);
  });

  PROPS.forEach((p, i) => world.addObstacle(
    [p.x - p.w / 2, p.y, p.z - p.d / 2, p.x + p.w / 2, p.y + p.h, p.z + p.d / 2], -10000 - i,
  ));

  // Cars. The collider is an axis-aligned box sized to whichever way round the
  // car is parked: the collision system has no rotated boxes, and a body-sized
  // box that ignored the yaw would let you walk through the front of half of
  // them. Squaring it up costs a little air at the corners and is honest from
  // every side, which is the trade the ramps and cones already make.
  CARS.forEach((c, i) => {
    const cos = Math.abs(Math.cos(c.yaw)), sin = Math.abs(Math.sin(c.yaw));
    const length = c.kind === 'truck' ? CAR_LENGTH * 1.25 : CAR_LENGTH;
    const halfX = (length * sin + CAR_WIDTH * cos) / 2;
    const halfZ = (length * cos + CAR_WIDTH * sin) / 2;
    const y = terrainHeight(c.x, c.z);
    world.addObstacle([c.x - halfX, y, c.z - halfZ, c.x + halfX, y + CAR_HEIGHT, c.z + halfZ], CAR_KEY_BASE - i);
  });

  let structureKey = STRUCTURE_KEY_BASE;

  // Piers and decking: a slab you can walk out on, with rails at the edges so
  // nobody backs off one in a fight without meaning to.
  for (const deck of DECKS) {
    world.addObstacle([deck.x0, deck.y - 0.35, deck.z0, deck.x1, deck.y, deck.z1], structureKey--);
    if (!deck.rails) continue;
    for (const x of [deck.x0, deck.x1]) {
      world.addObstacle([x - 0.14, deck.y, deck.z0, x + 0.14, deck.y + 1.1, deck.z1], structureKey--);
    }
  }

  // Bridges. The deck is one slab and the parapets are two more, rotated to the
  // roadway -- approximated as an axis-aligned box, since a bridge is only ever
  // a few degrees off an axis here and the collision system has no rotation.
  for (const bridge of BRIDGES) {
    const cos = Math.abs(Math.cos(bridge.yaw)), sin = Math.abs(Math.sin(bridge.yaw));
    const halfX = (bridge.width * cos + bridge.length * sin) / 2;
    const halfZ = (bridge.width * sin + bridge.length * cos) / 2;
    world.addObstacle(
      [bridge.x - halfX, bridge.y - 0.6, bridge.z - halfZ, bridge.x + halfX, bridge.y, bridge.z + halfZ],
      structureKey--,
    );
    // Parapets run along the span, on whichever axis the bridge mostly follows.
    const alongZ = cos > sin;
    for (const s of [-1, 1]) {
      world.addObstacle(alongZ
        ? [bridge.x + s * (halfX - 0.3), bridge.y, bridge.z - halfZ, bridge.x + s * (halfX + 0.3), bridge.y + 1.2, bridge.z + halfZ]
        : [bridge.x - halfX, bridge.y, bridge.z + s * (halfZ - 0.3), bridge.x + halfX, bridge.y + 1.2, bridge.z + s * (halfZ + 0.3)],
        structureKey--);
    }
  }
}

export function arenaSpawns(): Array<{ x: number; y: number; z: number; yaw: number }> {
  // Around the central village, facing inward. Close together on purpose: the
  // districts are somewhere to go, not somewhere to start, and a round that
  // opens with four people walking apart is a round that takes too long.
  //
  // Each one walks outward along its bearing until it finds ground that is dry
  // and clear of the village buildings, rather than being a hand-placed spot
  // that silently ends up inside a wall the next time the square is rearranged.
  return [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([dx, dz]) => {
    let x = dx * 26, z = dz * 26;
    for (let r = 26; r <= 70; r += 2) {
      x = dx * r; z = dz * r;
      if (insideBuilding(x, z, 4)) continue;
      if (waterLevelAt(x, z) !== null) continue;
      break;
    }
    return { x, y: terrainHeight(x, z) + 0.05, z, yaw: Math.atan2(x, -z) };
  });
}

export function isOutOfBounds(x: number, y: number, z: number): boolean {
  return Math.abs(x) > MAP_HALF + 12 || Math.abs(z) > MAP_HALF + 12 || y < -20 || y > 220;
}
