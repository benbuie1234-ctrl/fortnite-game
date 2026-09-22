/**
 * The map, as everything else sees it.
 *
 * This file is deliberately thin. The island is built in three layers, each of
 * which can be reasoned about on its own:
 *
 *   `terrain.ts`    what shape the ground is
 *   `blueprint.ts`  how a building is put together, down to the room
 *   `island.ts`     where everything goes, and why
 *
 * Everything below is the shared surface those three present to collision,
 * rendering, navigation, spawning and the tests. Keeping it in one place is
 * what stops the renderer and the server from inventing two different islands.
 */
import { TILE } from './constants';
import { footprintOf, type Blueprint, type Building } from './blueprint';
import { LAKE, SEA_LEVEL, riverDistance, riverSurface, riverWidth, lakeReach } from './terrain';
import { BUILDINGS, BLUEPRINTS, terrainHeight } from './island';

export {
  MAP_HALF, SEA_LEVEL, SHORE_HEIGHT, RIVER, WATERFALL, LAKE,
  rawTerrain, riverDistance, riverSurface, riverWidth, lakeReach, landMask,
} from './terrain';

export {
  BUILDINGS, BLUEPRINTS, CARS, PROPS, ROADS, SCENERY, LOCATIONS, DECKS, BRIDGES, DOCK,
  CAR_HEIGHT, CAR_LENGTH, CAR_WIDTH, cell, locationAt, onRoad, terrainHeight, blocksEntrance, roadDeckAt,
} from './island';

export type { Road, Scenery, Car, Prop, Deck, Bridge, Location, TreeSpecies } from './island';
export type {
  Building, Blueprint, WallRun, Room, RoomKind, Opening, Surface, RoofStyle, Archetype,
} from './blueprint';
export { wallBoxes, footprintOf } from './blueprint';

/** Water surface of the lake. Named for the fish and the renderer. */
export const LAKE_SURFACE = LAKE.surface;
/** Lake extent, in the shape the critter system expects. */
export const LAKE_SHAPE = { x: LAKE.x, z: LAKE.z, rx: LAKE.rx, rz: LAKE.rz };

const BLUEPRINT_BY_BUILDING = new Map<Building, (typeof BLUEPRINTS)[number]>();
for (const bp of BLUEPRINTS) BLUEPRINT_BY_BUILDING.set(bp.b, bp);

export function blueprintOf(b: Building): Blueprint | undefined {
  return BLUEPRINT_BY_BUILDING.get(b);
}

/** The building covering a grid cell, if any. */
export function buildingAt(gx: number, gz: number): Building | undefined {
  return BUILDINGS.find(b => gx >= b.x && gx < b.x + b.w && gz >= b.z && gz < b.z + b.d);
}

/** World-space footprint of a building, optionally padded. */
export function buildingFootprint(b: Building, pad = 0): { x0: number; z0: number; x1: number; z1: number } {
  return footprintOf(b, pad);
}

/** True when a point is inside any building's footprint. */
export function insideBuilding(x: number, z: number, pad = 0): boolean {
  return BUILDINGS.some(b => {
    const f = footprintOf(b, pad);
    return x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1;
  });
}

/**
 * Height of open water at a point, or null on dry land.
 *
 * One answer for the sea, the river and the lake, so the renderer can draw
 * them with one rule and gameplay code can ask "is this wet" without knowing
 * which body of water it is standing in.
 */
export function waterLevelAt(x: number, z: number): number | null {
  const ground = terrainHeight(x, z);
  const river = riverDistance(x, z);
  if (river.d < riverWidth(river.t) + 2) {
    const surface = riverSurface(river.t);
    if (ground < surface) return surface;
  }
  if (lakeReach(x, z) < 1.02 && ground < LAKE.surface) return LAKE.surface;
  if (ground < SEA_LEVEL) return SEA_LEVEL;
  return null;
}

/** Grid level a building's floor sits on, for placement checks. */
export const levelOf = (metres: number): number => Math.round(metres / TILE);
