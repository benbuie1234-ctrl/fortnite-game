// Climbing, ramp exits, sprint stamina and tree trunks.
import { World } from "../shared/src/world";
import {
  stepPlayer, newMovementState,
  BTN_JUMP, BTN_CROUCH, BTN_SPRINT,
  type InputCommand, type MovementState,
} from "../shared/src/sim";
import {
  makePiece, SLOT_RAMP, SLOT_FLOOR, SLOT_WALL_Z,
} from "../shared/src/build";
import {
  TILE, TICK_DT, MANTLE_REACH, SPRINT_STAMINA_MAX, SPRINT_REGEN_DELAY,
  SPRINT_MIN_TO_START,
} from "../shared/src/constants";
import { buildArena, treeIndexFromKey } from "../shared/src/arena";
import { SCENERY } from "../shared/src/map";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

function input(moveX: number, moveZ: number, buttons = 0): InputCommand {
  return { seq: 0, moveX, moveZ, yaw: 0, pitch: 0, buttons, slot: 2 };
}
/** Run and report the highest point reached, which is what a climb produces. */
function climb(s: MovementState, w: World, cmd: InputCommand, ticks: number): number {
  let highest = s.y;
  for (let i = 0; i < ticks; i++) {
    stepPlayer(s, cmd, w, TICK_DT);
    highest = Math.max(highest, s.y);
  }
  return highest;
}

// ---------------------------------------------------------------------------
console.log("mantling");
{
  // A plain one-tile wall. The baseline: if this stops working nothing else
  // below means anything.
  const w = new World();
  w.set(makePiece(0, 0, 1, SLOT_WALL_Z, 0, 0, 1, 0));
  const p = { ...newMovementState(), x: TILE / 2, y: 0, z: TILE / 2, grounded: true };
  check("a one-tile wall can be climbed",
    climb(p, w, input(0, 1, BTN_JUMP), 90) >= TILE - 0.05, `${p.y.toFixed(2)}`);
}
{
  // The reported bug. A ramp's back is a stack of steps, and the old search
  // took the LOWEST surface in front of it -- the first 37 cm step -- which
  // then failed its headroom test against the rest of the ramp, so the climb
  // was abandoned entirely.
  const w = new World();
  w.set(makePiece(0, 0, 1, SLOT_RAMP, 0, 3, 1, 0)); // rises toward -Z: tall face at +Z
  const p = { ...newMovementState(), x: TILE / 2, y: 0, z: TILE * 1.87, grounded: true };
  const highest = climb(p, w, input(0, -1, BTN_JUMP), 120);
  check("the back of a ramp can be climbed", highest > TILE * 0.73, `reached ${highest.toFixed(2)}`);
}
{
  // Two walls stacked. The lower top is occupied by the upper wall, so there
  // is nowhere to stand, and the upper top is out of reach.
  const w = new World();
  w.set(makePiece(0, 0, 1, SLOT_WALL_Z, 0, 0, 1, 0));
  w.set(makePiece(0, 1, 1, SLOT_WALL_Z, 0, 0, 1, 0));
  const p = { ...newMovementState(), x: TILE / 2, y: 0, z: TILE / 2, grounded: true };
  check("but not one with no room to stand on top",
    climb(p, w, input(0, 1, BTN_JUMP), 90) < TILE - 0.1, `${p.y.toFixed(2)}`);
}
{
  // A floor overhead is a ceiling, not a ledge. Holding jump under one used to
  // pull the player straight up through the slab.
  const w = new World();
  w.set(makePiece(0, 0, 1, SLOT_WALL_Z, 0, 0, 1, 0));
  w.set(makePiece(0, 2, 0, SLOT_FLOOR, 0, 0, 1, 0)); // surface two tiles up
  const p = { ...newMovementState(), x: TILE / 2, y: 0, z: TILE / 2, grounded: true };
  const highest = climb(p, w, input(0, 1, BTN_JUMP), 90);
  check("a ceiling is never mistaken for a ledge", highest < TILE * 2, `${highest.toFixed(2)}`);
}
{
  check("reach covers a full tile", MANTLE_REACH >= TILE);
}

// ---------------------------------------------------------------------------
console.log("a ramp is walked up, never climbed");
{
  // A ramp is approximated by sixteen 37 cm stairs and rises at 45 degrees, so
  // the stair a stride in front of the player is always about 75 cm above
  // their feet -- a perfectly good ledge by every other test in findLedge.
  // Holding forward and jump up one therefore used to grab a new "ledge" every
  // tick and drag the player up the whole ramp at MANTLE_SPEED with vy pinned
  // at zero, losing all horizontal speed to the stairs it flew into on the way.
  // That is the uphill judder, and it is also why jump did nothing on a slope.
  const w = new World();
  for (let i = 0; i < 4; i++) w.set(makePiece(i, i, 0, SLOT_RAMP, 0, 0, 1, 0));

  const climbing = { ...newMovementState(), x: 0.5, y: 0.5, z: TILE / 2, grounded: true };
  let posed = 0, peakVy = 0;
  for (let i = 0; i < 60; i++) {
    stepPlayer(climbing, input(0, 1, BTN_JUMP), w, TICK_DT);
    if (climbing.mantling || climbing.vaulting) posed++;
    peakVy = Math.max(peakVy, climbing.vy);
  }
  check("holding jump up a ramp jumps", peakVy > 5, `peak vy ${peakVy.toFixed(1)}`);
  check("and never grabs the ramp as a ledge", posed === 0, `${posed} climbing ticks`);

  // The other half: a jump taken on a ramp flies into the next approximation
  // stair, which is a lip a few centimetres above the feet. The sweep zeroed
  // the whole horizontal velocity against it, so jumping uphill stopped you
  // dead and dropped you on the spot.
  const running = { ...newMovementState(), x: 0.5, y: 0.5, z: TILE / 2, grounded: true };
  for (let i = 0; i < 30; i++) stepPlayer(running, input(0, 1, 0), w, TICK_DT);
  const cruising = Math.hypot(running.vx, running.vz);
  let slowest = cruising;
  for (let i = 0; i < 30; i++) {
    stepPlayer(running, input(0, 1, BTN_JUMP), w, TICK_DT);
    slowest = Math.min(slowest, Math.hypot(running.vx, running.vz));
  }
  check("and a jump on a ramp keeps its momentum",
    slowest > cruising * 0.8, `${cruising.toFixed(1)} down to ${slowest.toFixed(1)}`);
}

// ---------------------------------------------------------------------------
console.log("ramp exits through the floor above");
{
  // A ramp rises to exactly the surface of the floor in the cell above it, so
  // the last quarter metre of the climb runs through that floor's slab.
  const w = new World();
  w.set(makePiece(0, 0, 0, SLOT_RAMP, 0, 1, 1, 0));   // rises toward +Z
  w.set(makePiece(0, 1, 0, SLOT_FLOOR, 0, 0, 1, 0));  // directly above it
  const p = { ...newMovementState(), x: TILE / 2, y: 0, z: TILE * 0.05, grounded: true };
  const highest = climb(p, w, input(0, 1), 90);
  check("a ramp can be walked all the way to the top",
    highest >= TILE - 0.1, `reached ${highest.toFixed(2)} of ${TILE}`);

  // ...and the same floor is still solid from above, or it would just be a
  // hole everyone falls through.
  const stander = { ...newMovementState(), x: TILE / 2, y: TILE + 1.5, z: TILE / 2 };
  for (let i = 0; i < 60; i++) stepPlayer(stander, input(0, 0), w, TICK_DT);
  check("and is still solid to stand on from above",
    Math.abs(stander.y - TILE) < 0.05, `y=${stander.y.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
console.log("sprint stamina");
{
  const w = new World();
  const p = { ...newMovementState(), x: TILE / 2, y: 0, z: TILE / 2, grounded: true };
  check("starts full", p.stamina === SPRINT_STAMINA_MAX);

  // The first continuous burst, which is the number the player experiences.
  // Keep holding past it and the bar does recover and let you sprint again --
  // that is the intended rhythm, so it must not be counted as one long sprint.
  let firstBurst = 0;
  for (let i = 0; i < 300; i++) {
    stepPlayer(p, input(0, 1, BTN_SPRINT), w, TICK_DT);
    if (p.sprinting) firstBurst++;
    else if (firstBurst > 0) break;
  }
  const seconds = firstBurst * TICK_DT;
  check("one burst lasts roughly its budget",
    Math.abs(seconds - SPRINT_STAMINA_MAX) < 0.2, `sprinted ${seconds.toFixed(2)}s`);
  check("and holding the key does not keep sprinting", p.sprinting === false);
  check("the bar is empty", p.stamina < 0.01, `${p.stamina.toFixed(3)}`);

  // Releasing does not refill instantly: there is a pause first.
  p.staminaIdle = 0;
  for (let i = 0; i < Math.floor(SPRINT_REGEN_DELAY / TICK_DT) - 2; i++) {
    stepPlayer(p, input(0, 1), w, TICK_DT);
  }
  check("nothing comes back during the delay", p.stamina < 0.01, `${p.stamina.toFixed(3)}`);

  for (let i = 0; i < 300; i++) stepPlayer(p, input(0, 1), w, TICK_DT);
  check("then it refills", p.stamina > SPRINT_STAMINA_MAX - 0.01, `${p.stamina.toFixed(2)}`);

  // An empty bar cannot be tapped straight back on.
  p.stamina = SPRINT_MIN_TO_START * 0.5;
  p.staminaIdle = 0;
  stepPlayer(p, input(0, 1, BTN_SPRINT), w, TICK_DT);
  check("a nearly empty bar cannot restart a sprint", p.sprinting === false);
}

// ---------------------------------------------------------------------------
console.log("slide tiers");
{
  const w = new World();

  function slideDistance(sprintFirst: boolean): number {
    const p = { ...newMovementState(), x: TILE / 2, y: 0, z: TILE / 2, grounded: true };
    const run = input(0, 1, sprintFirst ? BTN_SPRINT : 0);
    for (let i = 0; i < 40; i++) stepPlayer(p, run, w, TICK_DT);
    const startZ = p.z;
    // One press, then hold: the press is what starts the slide.
    for (let i = 0; i < 120; i++) {
      stepPlayer(p, input(0, 1, (sprintFirst ? BTN_SPRINT : 0) | BTN_CROUCH), w, TICK_DT);
    }
    return p.z - startZ;
  }

  const walkSlide = slideDistance(false);
  const sprintSlide = slideDistance(true);
  check("crouching while running slides", walkSlide > 2, `${walkSlide.toFixed(2)} m`);
  check("sliding out of a sprint goes further",
    sprintSlide > walkSlide + 1, `walk ${walkSlide.toFixed(2)} sprint ${sprintSlide.toFixed(2)}`);

  // Holding crouch must not chain slides forever. Counted as separate RUNS
  // rather than as a tick budget: how long one slide lasts is a tuning
  // question (it tracks the entry boost, which tracks sprint speed), but how
  // many slides one held key is worth is the actual rule, and it is one.
  const p = { ...newMovementState(), x: TILE / 2, y: 0, z: TILE / 2, grounded: true };
  for (let i = 0; i < 40; i++) stepPlayer(p, input(0, 1, BTN_SPRINT), w, TICK_DT);
  let runs = 0, slidingTicks = 0, wasSliding = false;
  for (let i = 0; i < 300; i++) {
    stepPlayer(p, input(0, 1, BTN_SPRINT | BTN_CROUCH), w, TICK_DT);
    if (p.sliding) slidingTicks++;
    if (p.sliding && !wasSliding) runs++;
    wasSliding = p.sliding;
  }
  check("holding crouch does not chain slides",
    runs === 1, `${runs} slides, ${slidingTicks} ticks sliding out of 300`);
}

// ---------------------------------------------------------------------------
console.log("trees");
{
  const treeIndex = SCENERY.findIndex(p => p.kind === "tree");
  check("a tree collider maps back to its scenery entry",
    treeIndexFromKey(-treeIndex - 2) === treeIndex);
  const rockIndex = SCENERY.findIndex(p => p.kind === "rock");
  check("a rock does not", treeIndexFromKey(-rockIndex - 2) === -1);
  check("nor does a prop", treeIndexFromKey(-10000) === -1);
}

{
  // A point outside the trunk must fall to the ground, never land on an invisible disc.
  const w = new World(); buildArena(w);
  const tree = SCENERY.find(p => p.kind === 'tree')!;
  const p = { ...newMovementState(), x: tree.x + 1.3, y: tree.y + 5, z: tree.z };
  for (let i = 0; i < 150; i++) stepPlayer(p, input(0, 0), w, TICK_DT);
  check('no floating tree platform remains', p.grounded && p.y < tree.y + 1);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
