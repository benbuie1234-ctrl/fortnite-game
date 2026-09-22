/**
 * Can you actually get around the world, and does it hold you up?
 *
 * The screenshot-and-walk-around loop only ever covers the few metres you
 * happen to walk, and "falling through solid builds" is exactly the kind of
 * bug that hides in the spots nobody happens to stand on. This drops a player
 * across the whole map, walks the routes between the districts and climbs
 * every style of building, and asserts the world caught them every time.
 */
import { World } from "../shared/src/world";
import { buildArena, arenaSpawns } from "../shared/src/arena";
import {
  BUILDINGS, BLUEPRINTS, LOCATIONS, MAP_HALF, terrainHeight,
  CARS, CAR_LENGTH, CAR_WIDTH, CAR_HEIGHT,
} from "../shared/src/map";
import { makePiece, SLOT_FLOOR, SLOT_RAMP, SLOT_CONE, SLOT_WALL_X, SLOT_WALL_Z, type Slot } from "../shared/src/build";
import { stepPlayer, newMovementState, BTN_JUMP, type InputCommand, type MovementState } from "../shared/src/sim";
import { TILE, TICK_DT, PLAYER_HEIGHT } from "../shared/src/constants";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}
function cmd(over: Partial<InputCommand> = {}): InputCommand {
  return { seq: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, slot: 2, ...over };
}
function run(s: MovementState, w: World, c: InputCommand, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepPlayer(s, c, w, TICK_DT);
}

const world = new World();
buildArena(world);

// ---------------------------------------------------------------------------
console.log("the ground catches you, everywhere");
{
  // A coarse sweep of the whole playable area. Each sample is dropped from
  // well above the terrain and has to end up resting on something at or above
  // the landscape -- a player who ends below it has fallen through the world.
  let dropped = 0, worst = 0, worstAt = "";
  let airborne = 0;
  const STEP = 17;
  for (let x = -MAP_HALF + 9; x <= MAP_HALF - 9; x += STEP) {
    for (let z = -MAP_HALF + 9; z <= MAP_HALF - 9; z += STEP) {
      const ground = terrainHeight(x, z);
      const p = { ...newMovementState(), x, y: ground + 30, z };
      run(p, world, cmd(), 150);
      const below = ground - p.y;
      if (below > 0.3) { dropped++; if (below > worst) { worst = below; worstAt = `${x},${z}`; } }
      if (!p.grounded) airborne++;
    }
  }
  check("nothing falls through the landscape", dropped === 0,
    `${dropped} sample(s), worst ${worst.toFixed(2)}m at ${worstAt}`);
  check("and everything comes to rest", airborne === 0, `${airborne} still falling`);
}

// ---------------------------------------------------------------------------
console.log("build pieces hold a player up");
{
  // Every piece type, landed on from a real fall rather than placed on gently,
  // and then stood on for two more seconds. Sinking through a piece you have
  // already landed on is the reported "falling through solid builds".
  const cases: Array<[string, Slot, number]> = [
    ["a floor", SLOT_FLOOR, TILE],
    ["a ramp", SLOT_RAMP, TILE],
    ["a cone", SLOT_CONE, TILE * 0.5],
    ["a wall top", SLOT_WALL_X, TILE * 2],
    ["a wall top (Z)", SLOT_WALL_Z, TILE * 2],
  ];
  for (const [name, slot, expect] of cases) {
    const w = new World();
    // Cell (0,1,0) for the floor, (0,0,0) for everything that stands up from
    // the ground, so each surface sits about a tile above the arena floor.
    const gy = slot === SLOT_FLOOR ? 1 : slot === SLOT_WALL_X || slot === SLOT_WALL_Z ? 1 : 0;
    w.set(makePiece(0, gy, 0, slot, 2, slot === SLOT_RAMP ? 0 : 0, 1, 0));
    if (slot === SLOT_WALL_X || slot === SLOT_WALL_Z) w.set(makePiece(0, 0, 0, slot, 2, 0, 1, 0));
    // Ramps are a slope, so aim at the middle of the cell and expect the
    // slope height there rather than the top.
    const target = slot === SLOT_RAMP ? TILE * 0.5 : expect;
    const x = slot === SLOT_WALL_X ? 0 : TILE / 2;
    const z = slot === SLOT_WALL_Z ? 0 : TILE / 2;
    const p = { ...newMovementState(), x, y: target + 14, z };
    run(p, w, cmd(), 120);
    const landed = p.y;
    run(p, w, cmd(), 60);
    check(`${name} holds after a fall`, p.grounded && Math.abs(p.y - landed) < 0.05,
      `landed ${landed.toFixed(2)} then ${p.y.toFixed(2)}`);
    check(`${name} is at the height it looks`, Math.abs(p.y - target) < 0.35,
      `y=${p.y.toFixed(2)} expected ${target.toFixed(2)}`);
  }
}

// ---------------------------------------------------------------------------
console.log("a stack of builds is solid all the way down");
{
  // Five floors above one another, landed on from the top. A one-way rule that
  // is too eager turns a tower into a chimney.
  const w = new World();
  for (let gy = 1; gy <= 5; gy++) w.set(makePiece(0, gy, 0, SLOT_FLOOR, 2, 0, 1, 0));
  const p = { ...newMovementState(), x: TILE / 2, y: TILE * 5 + 20, z: TILE / 2 };
  run(p, w, cmd(), 200);
  check("lands on the top floor, not the bottom", Math.abs(p.y - TILE * 5) < 0.05, `y=${p.y.toFixed(2)}`);

  // The same stack, but with a ramp under each floor -- the shape that makes a
  // floor one-way so a climb can pass through it.
  const r = new World();
  for (let gy = 1; gy <= 5; gy++) {
    r.set(makePiece(0, gy, 0, SLOT_FLOOR, 2, 0, 1, 0));
    r.set(makePiece(0, gy - 1, 0, SLOT_RAMP, 2, 1, 1, 0));
  }
  const q = { ...newMovementState(), x: TILE / 2, y: TILE * 5 + 20, z: TILE * 0.98 };
  run(q, r, cmd(), 200);
  check("a ramped tower is still solid from above", Math.abs(q.y - TILE * 5) < 0.05, `y=${q.y.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
console.log("the districts can be reached on foot");
{
  // Against the bare landscape, deliberately. There are no stairs cut into the
  // plateaus -- the slope IS the route -- so what has to hold is that the
  // falloffs are gentle enough to walk up. Running this against the built world
  // instead would measure whichever piece of roadside cover happens to sit on
  // the chosen bearing, which is a level-design question and not this one.
  //
  // Each district declares where its walkable approach starts, because the
  // whole design of the high ground is that it is steep everywhere EXCEPT one
  // side. Walking at it from an arbitrary bearing tests the cliff, not the path.
  const bare = new World();
  bare.terrainEnabled = true;

  for (const poi of LOCATIONS) {
    if (poi.height <= 4) continue;
    const [sx, sz] = poi.approach;
    const p = { ...newMovementState(), x: sx, z: sz, grounded: true };
    p.y = terrainHeight(p.x, p.z);
    const climbed = p.y;
    const yaw = Math.atan2(-(poi.x - p.x), poi.z - p.z);
    // Deliberately NOT holding jump: airborne acceleration is Quake-style, so
    // a bunny-hopping player saturates their speed along one axis and then
    // travels in a straight line whatever they steer, which says nothing about
    // whether the hill is walkable.
    // Peak, not final: holding forward long enough to be sure of arriving also
    // walks straight over the top and down the far side.
    let peak = p.y;
    for (let i = 0; i < 900; i++) {
      stepPlayer(p, cmd({ moveZ: 1, yaw }), bare, TICK_DT);
      peak = Math.max(peak, p.y);
    }
    check(`${poi.name} can be walked up to`, peak > poi.height - 1.5,
      `${climbed.toFixed(1)}m -> ${peak.toFixed(1)}m of ${poi.height.toFixed(1)}m`);
  }
}

// ---------------------------------------------------------------------------
console.log("buildings can be entered and climbed");
{
  // Every building, not a sample of one per style: the blueprint generator
  // decides where the door and the stair shaft go per building, so a bug in it
  // shows up on one house and not its neighbour.
  let unenterable = 0, unclimbable = 0, worstEntry = "", worstClimb = "";
  for (const bp of BLUEPRINTS) {
    const b = bp.b;
    // Walk in through the front door, starting five metres outside it.
    const side = bp.entrance.side;
    const inward: [number, number] =
      side === 0 ? [0, 1] : side === 1 ? [0, -1] : side === 2 ? [1, 0] : [-1, 0];
    const start = {
      ...newMovementState(),
      x: bp.entrance.x - inward[0] * 5,
      y: b.base * TILE + 0.05,
      z: bp.entrance.z - inward[1] * 5,
      grounded: true,
    };
    const yaw = Math.atan2(-inward[0], inward[1]);
    run(start, world, cmd({ moveZ: 1, yaw }), 60);
    // Two metres past the threshold counts as inside.
    const got = (start.x - bp.entrance.x) * inward[0] + (start.z - bp.entrance.z) * inward[1];
    if (got < 2) { unenterable++; worstEntry = `${b.name} reached ${got.toFixed(1)}m in`; }

    // Then climb every flight of the stairwell, one at a time.
    for (const flight of bp.stairs) {
      const along = 0.3;
      const dir: [number, number] =
        flight.facing === 0 ? [1, 0] : flight.facing === 1 ? [0, 1] : flight.facing === 2 ? [-1, 0] : [0, -1];
      // Start part way up the slope: dropping the player in at the very foot
      // puts them inside the first collision step of the ramp, which tests the
      // embedding recovery rather than the climb.
      const foot: [number, number] = [
        flight.facing === 0 ? flight.gx : flight.facing === 2 ? flight.gx + 1 : flight.gx + 0.5,
        flight.facing === 1 ? flight.gz : flight.facing === 3 ? flight.gz + 1 : flight.gz + 0.5,
      ];
      const up = {
        ...newMovementState(),
        x: (foot[0] + dir[0] * along) * TILE,
        y: flight.gy * TILE + TILE * along + 0.05,
        z: (foot[1] + dir[1] * along) * TILE,
        grounded: true,
      };
      // Peak height, not final: holding forward for long enough to climb also
      // walks off the far side, and where they land says nothing about the climb.
      let peak = up.y;
      for (let i = 0; i < 150; i++) {
        stepPlayer(up, cmd({ moveZ: 1, yaw: Math.atan2(-dir[0], dir[1]) }), world, TICK_DT);
        peak = Math.max(peak, up.y);
      }
      const want = (flight.gy + 1) * TILE;
      if (peak < want - 0.5) {
        unclimbable++;
        worstClimb = `${b.name} flight at level ${flight.gy} reached ${peak.toFixed(1)} of ${want.toFixed(1)}`;
      }
    }
  }
  check("every building can be walked into", unenterable === 0, `${unenterable} of ${BLUEPRINTS.length}: ${worstEntry}`);
  check("every stair flight reaches the floor above", unclimbable === 0, `${unclimbable} failed: ${worstClimb}`);

  // A multi-storey building with no stairs at all is a box with a lid.
  const stranded = BLUEPRINTS.filter(bp => bp.b.floors > 1 && bp.stairs.length < bp.b.floors - 1);
  check("no upper floor is unreachable", stranded.length === 0,
    stranded.map(bp => bp.b.name).join(", "));
}

// ---------------------------------------------------------------------------
console.log("cars are parked, not embedded");
{
  let inBuilding = 0, standable = 0;
  const reach = Math.max(CAR_LENGTH, CAR_WIDTH) / 2;
  for (const c of CARS) {
    if (BUILDINGS.some(b =>
      c.x + reach > b.x * TILE && c.x - reach < (b.x + b.w) * TILE &&
      c.z + reach > b.z * TILE && c.z - reach < (b.z + b.d) * TILE)) inBuilding++;

    // Drop onto the roof and see if it holds.
    const ground = terrainHeight(c.x, c.z);
    const p = { ...newMovementState(), x: c.x, y: ground + CAR_HEIGHT + 9, z: c.z };
    run(p, world, cmd(), 120);
    if (p.grounded && p.y > ground + CAR_HEIGHT - 0.2) standable++;
  }
  check("no car is parked inside a building", inBuilding === 0, `${inBuilding} of ${CARS.length}`);
  check("every car can be stood on", standable === CARS.length, `${standable} of ${CARS.length}`);
}

// ---------------------------------------------------------------------------
console.log("spawns are safe");
{
  for (const [i, s] of arenaSpawns().entries()) {
    const p = { ...newMovementState(), x: s.x, y: s.y, z: s.z };
    run(p, world, cmd(), 90);
    check(`spawn ${i} stands on solid ground`,
      p.grounded && Math.abs(p.y - terrainHeight(s.x, s.z)) < 0.5,
      `y=${p.y.toFixed(2)} terrain ${terrainHeight(s.x, s.z).toFixed(2)}`);
    // And is not inside the Citadel's walls.
    const clear = !BUILDINGS.some(b =>
      s.x > b.x * TILE && s.x < (b.x + b.w) * TILE &&
      s.z > b.z * TILE && s.z < (b.z + b.d) * TILE &&
      s.y + PLAYER_HEIGHT > b.base * TILE && s.y < (b.base + b.floors) * TILE);
    check(`spawn ${i} is not inside a building`, clear);
  }
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
