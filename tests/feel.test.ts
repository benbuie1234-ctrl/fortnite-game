// Regressions for the reported feel bugs: the backwards-jump speed boost, the
// random-feeling fall damage, weapon bloom, crouch and slide, the sniper's
// material rule, and the floor/ramp height mismatch.
import { World } from "../shared/src/world";
import {
  stepPlayer, newMovementState, fallDamage, playerHeight, eyeHeightFor,
  BTN_JUMP, BTN_CROUCH, BTN_SPRINT,
  type InputCommand, type MovementState,
} from "../shared/src/sim";
import { makePiece, pieceBox, SLOT_FLOOR, SLOT_RAMP, rampHeightAt } from "../shared/src/build";
import {
  TILE, TICK_DT, MOVE_SPEED, PLAYER_MAX_HP, CROUCH_HEIGHT, PLAYER_HEIGHT,
  FALL_SAFE_HEIGHT, FALL_LETHAL_HEIGHT, MATERIALS,
  SPRINT_SPEED_MULT, GROUND_ACCEL, GROUND_FRICTION, SLIDE_MIN_SPEED,
} from "../shared/src/constants";
import { terrainHeight } from "../shared/src/map";
import { weaponById, spreadFor, pieceDamage, W_SNIPER, W_AR } from "../shared/src/weapons";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

function input(moveX: number, moveZ: number, buttons = 0): InputCommand {
  return { seq: 0, moveX, moveZ, yaw: 0, pitch: 0, buttons, slot: 2 };
}
function run(s: MovementState, w: World, cmd: InputCommand, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepPlayer(s, cmd, w, TICK_DT);
}
function topSpeed(s: MovementState, w: World, cmd: InputCommand, ticks: number): number {
  let best = 0;
  for (let i = 0; i < ticks; i++) {
    stepPlayer(s, cmd, w, TICK_DT);
    best = Math.max(best, Math.hypot(s.vx, s.vz));
  }
  return best;
}

// ---------------------------------------------------------------------------
console.log("jumping, backwards and sideways");
{
  const world = new World();

  // The original bug: acceleration picked GROUND_ACCEL and the jump then
  // cleared the grounded flag in the same tick, spending one tick of ground
  // acceleration in mid-air. Forward has no air bonus of its own, so it is
  // where that leak would still show.
  const runner = { ...newMovementState(), y: 0, grounded: true };
  const forwardRun = topSpeed(runner, world, input(0, 1), 40);
  const jumper = { ...newMovementState(), y: 0, grounded: true };
  const forwardJump = topSpeed(jumper, world, input(0, 1, BTN_JUMP), 40);
  check("a forward jump grants no free speed",
    forwardJump <= forwardRun + 0.02, `run ${forwardRun.toFixed(3)} jump ${forwardJump.toFixed(3)}`);
  check("and forwards still reaches full speed",
    Math.abs(forwardRun - MOVE_SPEED) < 0.2, `${forwardRun.toFixed(3)}`);

  // Backwards is the opposite case, and deliberately so: slow on the ground,
  // quick in the air, so breaking off a fight rewards a jump.
  const backer = { ...newMovementState(), y: 0, grounded: true };
  const backRun = topSpeed(backer, world, input(0, -1), 40);
  const backJumper = { ...newMovementState(), y: 0, grounded: true };
  const backJump = topSpeed(backJumper, world, input(0, -1, BTN_JUMP), 60);

  check("backing up on the ground is slower than advancing",
    backRun < forwardRun - 0.3, `back ${backRun.toFixed(2)} fwd ${forwardRun.toFixed(2)}`);
  check("but a backwards jump is faster than backing up",
    backJump > backRun + 1, `run ${backRun.toFixed(2)} jump ${backJump.toFixed(2)}`);

  const strafer = { ...newMovementState(), y: 0, grounded: true };
  const strafe = topSpeed(strafer, world, input(1, 0, BTN_JUMP), 60);
  check("and faster than strafing, which is the point",
    backJump > strafe + 1, `strafe ${strafe.toFixed(2)} back-jump ${backJump.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
console.log("fall damage is a readable curve");
{
  check("a short drop is free", fallDamage(FALL_SAFE_HEIGHT - 0.5, 20) === 0);
  check("a long drop is lethal",
    fallDamage(FALL_LETHAL_HEIGHT + 5, 40) >= PLAYER_MAX_HP,
    `${fallDamage(FALL_LETHAL_HEIGHT + 5, 40)}`);
  check("it rises monotonically",
    fallDamage(12, 25) < fallDamage(18, 30) && fallDamage(18, 30) < fallDamage(24, 35));
  // The old version keyed off impact speed alone, which several surface snaps
  // also produce; a snap must never be charged as a fall.
  check("a surface snap is not a fall", fallDamage(20, 2) === 0);

  // And the height itself has to be measured, not inferred.
  const world = new World();
  const faller = { ...newMovementState(), x: 1.5, y: 20, z: 1.5 };
  let reported = 0;
  let reportedTicks = 0;
  for (let i = 0; i < 120; i++) {
    stepPlayer(faller, input(0, 0), world, TICK_DT);
    if (faller.lastFallHeight > 0) { reported = faller.lastFallHeight; reportedTicks++; }
  }
  check("a real drop reports its height",
    Math.abs(reported - 20) < 0.6, `${reported.toFixed(2)}`);
  // It has to be a one-shot signal, or the server would charge the same fall
  // once per tick for as long as the player stayed on the ground.
  check("and only on the tick it lands", reportedTicks === 1, `${reportedTicks} ticks`);
}

// ---------------------------------------------------------------------------
console.log("crouch and slide");
{
  const world = new World();
  const p = { ...newMovementState(), x: 1.5, y: 0, z: 1.5, grounded: true };
  run(p, world, input(0, 0, BTN_CROUCH), 30);
  check("crouching shrinks the capsule",
    Math.abs(playerHeight(p.crouch) - CROUCH_HEIGHT) < 0.02, `${playerHeight(p.crouch).toFixed(2)}`);
  check("and lowers the eye", eyeHeightFor(p.crouch) < eyeHeightFor(0) - 0.4);
  run(p, world, input(0, 0), 30);
  check("standing back up restores it",
    Math.abs(playerHeight(p.crouch) - PLAYER_HEIGHT) < 0.02);

  // A slide needs speed: crouching from a standstill must not launch anybody.
  const still = { ...newMovementState(), x: 1.5, y: 0, z: 1.5, grounded: true };
  run(still, world, input(0, 0, BTN_CROUCH | BTN_SPRINT), 10);
  check("crouching while stationary does not slide", still.sliding === false);

  const sprinter = { ...newMovementState(), x: 1.5, y: 0, z: 1.5, grounded: true };
  run(sprinter, world, input(0, 1, BTN_SPRINT), 30);
  const beforeSlide = Math.hypot(sprinter.vx, sprinter.vz);
  stepPlayer(sprinter, input(0, 1, BTN_SPRINT | BTN_CROUCH), world, TICK_DT);
  check("crouching at sprint speed starts a slide", sprinter.sliding === true);
  check("and the slide is faster than the sprint",
    Math.hypot(sprinter.vx, sprinter.vz) > beforeSlide,
    `${beforeSlide.toFixed(2)} -> ${Math.hypot(sprinter.vx, sprinter.vz).toFixed(2)}`);
  run(sprinter, world, input(0, 1, BTN_SPRINT | BTN_CROUCH), 90);
  check("a slide eventually ends", sprinter.sliding === false);
}

// ---------------------------------------------------------------------------
console.log("spread is the weapon's own figure");
{
  const ar = weaponById(W_AR);
  check("hip spread is the weapon's hip spread", spreadFor(ar, false) === ar.spreadHip);
  check("aimed spread is the weapon's aimed spread", spreadFor(ar, true) === ar.spreadAds);
  check("and aiming is always tighter", spreadFor(ar, true) < spreadFor(ar, false));
}

// ---------------------------------------------------------------------------
console.log("sniper versus materials");
{
  const sniper = weaponById(W_SNIPER);
  const [wood, brick, metal] = MATERIALS;

  check("one shot takes wood down", pieceDamage(sniper, wood.id) > wood.maxHp,
    `${pieceDamage(sniper, wood.id)} vs ${wood.maxHp}`);

  const brickLeft = brick.maxHp - pieceDamage(sniper, brick.id);
  check("brick survives one shot", brickLeft > 0, `${brickLeft.toFixed(1)} left`);
  check("but only just", brickLeft <= brick.maxHp * 0.02, `${brickLeft.toFixed(1)} left`);

  const metalDamage = pieceDamage(sniper, metal.id);
  check("metal takes half", Math.abs(metalDamage - metal.maxHp / 2) < 1,
    `${metalDamage} vs ${metal.maxHp / 2}`);

  // Structure damage must not fall off, or a sniper stops one-shotting wood at
  // exactly the range a sniper is for. pieceDamage() takes no distance at all,
  // which is the guarantee; an AR is still scaled by its own buildDamage.
  const ar = weaponById(W_AR);
  check("an ordinary weapon uses its own build multiplier",
    Math.abs(pieceDamage(ar, wood.id) - ar.damage * ar.buildDamage) < 1e-9);
}

// ---------------------------------------------------------------------------
console.log("sprinting is actually faster");
{
  // The multiplier only means anything if acceleration can beat the friction
  // at the speed it asks for. It could not: friction sheds
  // GROUND_FRICTION * TICK_DT of the current speed every tick while
  // acceleration can only put back GROUND_ACCEL * TICK_DT, which pinned the
  // real top speed at GROUND_ACCEL / GROUND_FRICTION however high the
  // multiplier went -- 8.2 m/s against a claimed 11.2, so sprint was worth 17%
  // instead of 60% and felt like nothing.
  check("acceleration can sustain the sprint speed it advertises",
    GROUND_ACCEL > MOVE_SPEED * SPRINT_SPEED_MULT * GROUND_FRICTION,
    `${GROUND_ACCEL} vs ${(MOVE_SPEED * SPRINT_SPEED_MULT * GROUND_FRICTION).toFixed(0)} needed`);

  const w = new World();
  const walker = { ...newMovementState(), x: TILE / 2, y: 0, z: TILE / 2, grounded: true };
  const sprinter = { ...newMovementState(), x: TILE / 2, y: 0, z: TILE / 2, grounded: true };
  const walk = topSpeed(walker, w, input(0, 1), 60);
  const sprint = topSpeed(sprinter, w, input(0, 1, BTN_SPRINT), 60);
  check("walking reaches its own cap", Math.abs(walk - MOVE_SPEED) < 0.05, `${walk.toFixed(2)}`);
  check("and sprinting reaches its own",
    Math.abs(sprint - MOVE_SPEED * SPRINT_SPEED_MULT) < 0.05,
    `${sprint.toFixed(2)} of ${(MOVE_SPEED * SPRINT_SPEED_MULT).toFixed(2)}`);
  check("so a sprint is a real difference, not a nudge",
    sprint > walk * 1.4, `walk ${walk.toFixed(1)} sprint ${sprint.toFixed(1)}`);
}

// ---------------------------------------------------------------------------
console.log("crouch crouches; sliding is for speed and hills");
{
  // The rule a player actually holds in their head is "crouch unless I am
  // going fast or going downhill". It used to be "crouch above 3.2 m/s", which
  // is under half of walking pace -- so crouch slid whenever you were moving
  // and the game had no working crouch at all.
  check("the flat-ground slide threshold is above walking pace",
    SLIDE_MIN_SPEED > MOVE_SPEED, `${SLIDE_MIN_SPEED} vs ${MOVE_SPEED}`);

  const flat = new World();
  function crouchAt(w: World, x: number, z: number, yaw: number, sprint: boolean): MovementState {
    const s = { ...newMovementState(), x, y: w.groundAt(x, z), z, yaw, grounded: true };
    const cmd: InputCommand = { seq: 0, moveX: 0, moveZ: 1, yaw, pitch: 0, buttons: sprint ? BTN_SPRINT : 0, slot: 2 };
    for (let i = 0; i < 40; i++) stepPlayer(s, cmd, w, TICK_DT);
    stepPlayer(s, { ...cmd, buttons: cmd.buttons | BTN_CROUCH }, w, TICK_DT);
    return s;
  }
  check("a jog then crouch is a crouch", crouchAt(flat, 0, 0, 0, false).sliding === false);
  check("a sprint then crouch is a slide", crouchAt(flat, 0, 0, 0, true).sliding === true);

  const standing = { ...newMovementState(), x: 0, y: 0, z: 0, grounded: true };
  stepPlayer(standing, input(0, 0, BTN_CROUCH), flat, TICK_DT);
  check("and standing still then crouch is a crouch", standing.sliding === false);

  // The hill is the exception, and it is measured off the surface rather than
  // off the speed, so it holds for terrain and for built ramps alike.
  const hills = new World();
  hills.terrainEnabled = true;
  let hill = { x: 0, z: 0, grade: 0 };
  for (let x = -230; x < 230; x += 2) {
    for (let z = -230; z < 230; z += 6) {
      const grade = (terrainHeight(x + 1, z) - terrainHeight(x - 1, z)) / 2;
      // Under 0.62 keeps this on a hillside rather than on a plateau edge,
      // where running "downhill" means walking off a cliff.
      if (grade > hill.grade && grade < 0.62) hill = { x, z, grade };
    }
  }
  const WEST = Math.PI / 2, EAST = -Math.PI / 2;
  check("a jog DOWNHILL then crouch is a slide",
    crouchAt(hills, hill.x + 10, hill.z, WEST, false).sliding === true,
    `grade ${hill.grade.toFixed(2)}`);
  check("and the same jog uphill is a crouch",
    crouchAt(hills, hill.x - 10, hill.z, EAST, false).sliding === false);
}

// ---------------------------------------------------------------------------
console.log("floors and ramps meet");
{
  const floor = makePiece(0, 1, 0, SLOT_FLOOR, 0, 0, 1, 0);
  const box = pieceBox(floor)!;
  check("a floor's surface is its own cell line", box[4] === TILE, `${box[4]}`);

  // A ramp anchored to the cell below has to arrive exactly at that surface.
  const ramp = makePiece(0, 0, 0, SLOT_RAMP, 0, 0, 1, 0);
  const rampTop = rampHeightAt(ramp, TILE - 1e-6, TILE / 2)!;
  check("and a ramp below it arrives at the same height",
    Math.abs(rampTop - box[4]) < 1e-3, `ramp ${rampTop.toFixed(3)} floor ${box[4]}`);

  // Walking off the top of a ramp onto the floor above must not be a step.
  const rampBase = rampHeightAt(makePiece(0, 1, 0, SLOT_RAMP, 0, 0, 1, 0), 1e-6, TILE / 2)!;
  check("and a ramp above it starts at the same height",
    Math.abs(rampBase - box[4]) < 1e-3, `ramp ${rampBase.toFixed(3)} floor ${box[4]}`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
