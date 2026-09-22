/**
 * The island holds together.
 *
 * Everything here is an invariant the level design rests on and that nothing
 * else checks: a building standing on its own pad, a doorway you can actually
 * walk through, a room you can actually get into, water shallow enough to wade.
 * They are cheap to assert and expensive to discover by walking there.
 */
import assert from 'node:assert/strict';
import { World } from '../shared/src/world';
import { buildArena } from '../shared/src/arena';
import {
  BUILDINGS, BLUEPRINTS, SCENERY, PROPS, CARS, LOCATIONS, ROADS, BRIDGES,
  terrainHeight, buildingFootprint, blocksEntrance,
  riverDistance, riverSurface, riverWidth, waterLevelAt, lakeReach, LAKE, MAP_HALF,
} from '../shared/src/map';
import { TILE } from '../shared/src/constants';
import { stepPlayer, newMovementState } from '../shared/src/sim';
import { placementIssue, BUILD_FLOOR, resolvePlacement } from '../shared/src/placement';
import { SLOT_FLOOR, SLOT_CONE } from '../shared/src/build';

const world = new World();
buildArena(world);

// --- the island has enough in it -------------------------------------------
assert.ok(SCENERY.length > 600, `the island is planted (${SCENERY.length} trees and rocks)`);
assert.ok(BUILDINGS.length >= 40, `enough places to go (${BUILDINGS.length} buildings)`);
assert.ok(LOCATIONS.length >= 6, 'enough named districts');
assert.ok(BRIDGES.length >= 3, 'the river has crossings');
const rooms = BLUEPRINTS.reduce((n, bp) => n + bp.rooms.length, 0);
assert.ok(rooms > 200, `buildings have interiors (${rooms} rooms)`);

// --- every building stands on its own ground -------------------------------
// Too low and the ground floor is buried, too high and the whole block floats.
// This is the invariant the district layout rests on and nothing else checks it.
for (const b of BUILDINGS) {
  const f = buildingFootprint(b);
  for (const [x, z] of [[f.x0, f.z0], [f.x1, f.z0], [f.x0, f.z1], [f.x1, f.z1], [(f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2]]) {
    const drop = b.base * TILE - terrainHeight(x, z);
    assert.ok(Math.abs(drop) < TILE * 0.35,
      `${b.name} sits ${drop.toFixed(1)}m off its ground`);
  }
}

// --- interiors are connected -----------------------------------------------
// The room planner splits a floor with a wall and puts one doorway in it. A
// split that ever lost its doorway would seal a room off completely, and from
// the outside the building would look entirely normal.
for (const bp of BLUEPRINTS) {
  for (const run of bp.walls) {
    if (run.exterior || run.parapet) continue;
    assert.ok(run.openings.length > 0,
      `${bp.b.name} has an interior wall with no way through it`);
  }
  // And every building can be got into and, if it has floors, up.
  const exteriorDoors = bp.walls.filter(w => w.exterior && w.openings.some(o => o.kind === 'door'));
  assert.ok(exteriorDoors.length >= 2, `${bp.b.name} has fewer than two ways in`);
  if (bp.b.floors > 1) {
    assert.ok(bp.stairs.length >= bp.b.floors - 1, `${bp.b.name} cannot be climbed`);
  }
}

// --- nothing is parked in a doorway ----------------------------------------
for (const p of PROPS) {
  assert.ok(!blocksEntrance(p.x, p.z, p.w / 2, p.d / 2), `a ${p.kind} is blocking a doorway`);
}
for (const c of CARS) {
  assert.ok(!blocksEntrance(c.x, c.z, 3, 3), 'a car is parked across a doorway');
}

// --- cover works -----------------------------------------------------------
const tree = SCENERY.find(p => p.kind === 'tree')!;
const hit = world.raycast(tree.x - 2, tree.y + 1, tree.z, 1, 0, 0, 4, 10);
assert.ok(hit && hit.piece.key < -1, 'tree stops a shot');
const state = { ...newMovementState(), x: tree.x - 2, y: tree.y, z: tree.z, yaw: -Math.PI / 2, grounded: true };
for (let i = 0; i < 60; i++) stepPlayer(state, { seq: i, moveX: 0, moveZ: 1, yaw: -Math.PI / 2, pitch: 0, buttons: 0, slot: 2 }, world);
assert.ok(state.x < tree.x - 0.3, 'tree collision blocks walking');

// Into the south face of the Crestview mesa, which stands about twenty metres
// proud of the ground in front of it. Against the bare landscape, so what is
// being measured is the terrain and not whichever tree happens to be in the way.
const bare = new World();
bare.terrainEnabled = true;
const hill = bare.raycast(96, 24, -80, 0, -0.1, -1, 90, 10);
assert.ok(hill && hill.piece.key === -1, 'hillsides block bullets and camera rays');

// --- the water can be crossed ----------------------------------------------
// There is no swimming in this game, so every stretch of open water a player
// can walk into has to be wadeable. Anything deeper is a trench they walk
// along the bottom of, blind.
let deepest = 0, deepestAt = '';
for (let x = -MAP_HALF; x <= MAP_HALF; x += 3) {
  for (let z = -MAP_HALF; z <= MAP_HALF; z += 3) {
    const r = riverDistance(x, z);
    if (r.d > riverWidth(r.t)) continue;
    // The lake it empties into is deliberately deep in the middle; that is the
    // one body of water you are meant to go round rather than through.
    if (lakeReach(x, z) < 1.1) continue;
    const depth = riverSurface(r.t) - terrainHeight(x, z);
    if (depth > deepest) { deepest = depth; deepestAt = `${x},${z}`; }
  }
}
assert.ok(deepest < 1.6, `the river is wadeable (deepest ${deepest.toFixed(2)}m at ${deepestAt})`);

// And the lake has a shelf you can stand on all the way round, so walking into
// it is a decision rather than an accident.
let shelf = 0;
for (let a = 0; a < 32; a++) {
  const angle = (a / 32) * Math.PI * 2;
  const x = LAKE.x + Math.cos(angle) * LAKE.rx * 0.9;
  const z = LAKE.z + Math.sin(angle) * LAKE.rz * 0.9;
  if (LAKE.surface - terrainHeight(x, z) > 1.5) shelf++;
}
assert.ok(shelf === 0, `the lake shore can be waded (${shelf} of 32 samples too deep)`);

// --- roads go somewhere ----------------------------------------------------
// A road that climbs faster than a player can sprint up is a road nobody uses.
// Mountain tracks are allowed to be steeper than the highways, but not so steep
// that the route they describe is a lie.
const onBridge = (x: number, z: number): boolean =>
  BRIDGES.some(b => Math.hypot(x - b.x, z - b.z) < b.length / 2 + 8);

let steepest = 0, steepestAt = '';
for (const r of ROADS) {
  const len = Math.hypot(r.x2 - r.x1, r.z2 - r.z1);
  for (let t = 0; t < len; t += 3) {
    const a = t / len, b = Math.min(1, (t + 3) / len);
    const x1 = r.x1 + (r.x2 - r.x1) * a, z1 = r.z1 + (r.z2 - r.z1) * a;
    const x2 = r.x1 + (r.x2 - r.x1) * b, z2 = r.z1 + (r.z2 - r.z1) * b;
    // Where a road meets the river it is carried by a bridge, and the ground
    // underneath it is the riverbank -- which is supposed to be steep.
    if (onBridge(x1, z1) || onBridge(x2, z2)) continue;
    const grade = Math.abs(terrainHeight(x2, z2) - terrainHeight(x1, z1)) / ((b - a) * len || 1);
    if (grade > steepest) { steepest = grade; steepestAt = `${r.x1},${r.z1} -> ${r.x2},${r.z2}`; }
  }
}
assert.ok(steepest < 0.85, `roads stay walkable (worst grade ${steepest.toFixed(2)} on ${steepestAt})`);

// --- a bridge meets its own approach roads ---------------------------------
// A deck sitting a metre above the road at either end is a kerb the width of
// the river, and the only way to find it is to walk onto it.
for (const b of BRIDGES) {
  for (const [x, z] of b.ends) {
    const step = Math.abs(terrainHeight(x, z) - b.y);
    assert.ok(step < 1.3, `${b.name} is ${step.toFixed(1)}m off the road at one end`);
  }
}

// --- building is still legal where it should be ----------------------------
assert.equal(placementIssue({ x: TILE / 2, y: 0, z: TILE / 2 }, { gx: 0, gy: 0, gz: 0, slot: SLOT_CONE, facing: 0 }, new World()), 'Move clear of the piece');
const feet = { x: TILE / 2, y: 0, z: TILE / 2, yaw: 0, pitch: -1, buildSlot: BUILD_FLOOR };
assert.equal(placementIssue(feet, resolvePlacement(feet)!, new World()), null, 'low floor can be placed underfoot');
assert.equal(placementIssue({ x: 156, y: 18, z: 156 }, { gx: 52, gy: 0, gz: 52, slot: SLOT_FLOOR, facing: 0 }, world), 'Out of reach');

// --- the shoreline is a shoreline, not a cliff into the sea ----------------
let drowning = 0;
for (let a = 0; a < 64; a++) {
  const angle = (a / 64) * Math.PI * 2;
  const x = Math.cos(angle) * (MAP_HALF - 6), z = Math.sin(angle) * (MAP_HALF - 6);
  // The lake reaches the ring in the south-west, and it is the one body of
  // water on the island that is meant to be out of your depth.
  if (lakeReach(x, z) < 1) continue;
  const level = waterLevelAt(x, z);
  if (level !== null && level - terrainHeight(x, z) > 2.0) drowning++;
}
assert.ok(drowning === 0, `the sea inside the boundary can be waded (${drowning} of 64 samples too deep)`);

console.log('PASS: pads, interiors, doorways, cover, wadeable water, walkable roads and legal builds.');
