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
  BUILDINGS, LOCATIONS, MAP_HALF, terrainHeight,
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
  const bare = new World();
  bare.terrainEnabled = true;

  for (const poi of LOCATIONS) {
    if (poi.height <= 0) continue;
    const p = { ...newMovementState(), x: poi.x * 0.62, z: poi.z * 0.62, grounded: true };
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
    for (let i = 0; i < 600; i++) {
      stepPlayer(p, cmd({ moveZ: 1, yaw }), bare, TICK_DT);
      peak = Math.max(peak, p.y);
    }
    check(`${poi.name} can be walked up to`, peak > poi.height - 0.5,
      `${climbed.toFixed(1)}m -> ${peak.toFixed(1)}m of ${poi.height}m`);
  }
}

// ---------------------------------------------------------------------------
console.log("buildings can be entered and climbed");
{
  const styles = new Map<string, typeof BUILDINGS[number]>();
  for (const b of BUILDINGS) if (!styles.has(b.style)) styles.set(b.style, b);

  for (const [style, b] of styles) {
    // In through the middle of the -Z wall, which is where buildArena leaves
    // the ground-floor doorway.
    const doorX = (b.x + Math.floor(b.w / 2) + 0.5) * TILE;
    const p = {
      ...newMovementState(),
      x: doorX, y: b.base * TILE + 0.05, z: b.z * TILE - 4, grounded: true,
    };
    run(p, world, cmd({ moveZ: 1 }), 40);
    check(`a ${style} can be entered`, p.z > b.z * TILE + 1, `z=${p.z.toFixed(1)}`);
    check(`and the ground floor holds`, p.grounded && p.y > b.base * TILE - 0.3,
      `y=${p.y.toFixed(2)} floor ${(b.base * TILE).toFixed(2)}`);

    // Every flight, not just the first. A flight has a solid ceiling over it
    // unless the level above puts its own ramp in the other column, and that
    // only shows up from the second floor onward.
    if (b.floors >= 2) {
      check(`a ${b.floors}-floor ${style} is wide enough for a switchback`, b.w >= 3,
        `w=${b.w}`);
    }
    // A pitched roof leaves no attic, so those buildings have no top flight.
    const pitched = style === "house" || style === "cabin";
    const flights = pitched ? b.floors - 1 : b.floors;
    for (let level = 0; level < flights; level++) {
      const col = level % 2 === 0 ? 0 : b.w - 1;
      // Start part way up the slope. Dropping the player in at the very foot
      // puts them inside the first collision step of the ramp, which tests the
      // embedding recovery rather than the climb.
      const along = 0.3;
      const up = {
        ...newMovementState(),
        x: (b.x + col + 0.5) * TILE,
        y: (b.base + level) * TILE + TILE * along + 0.05,
        z: (b.z + along) * TILE,
        grounded: true,
      };
      // Peak height, not final: holding forward for long enough to climb also
      // walks off the far side of the roof, and where they land afterwards
      // says nothing about whether the flight worked.
      let peak = up.y;
      for (let i = 0; i < 120; i++) {
        stepPlayer(up, cmd({ moveZ: 1 }), world, TICK_DT);
        peak = Math.max(peak, up.y);
      }
      check(`a ${style}'s flight ${level + 1} reaches the next floor`,
        peak > (b.base + level + 1) * TILE - 0.5,
        `reached ${peak.toFixed(1)}, wanted ${((b.base + level + 1) * TILE).toFixed(1)}`);
    }
  }
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
