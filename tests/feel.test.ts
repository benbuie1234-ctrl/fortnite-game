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
  FALL_SAFE_HEIGHT, FALL_LETHAL_HEIGHT, BLOOM_MAX, MATERIALS,
} from "../shared/src/constants";
import {
  weaponById, spreadFor, stepBloom, pieceDamage, W_SNIPER, W_AR,
} from "../shared/src/weapons";

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
console.log("jumping does not grant speed");
{
  // The bug: acceleration picked GROUND_ACCEL, then the jump cleared the
  // grounded flag in the same tick, so every jump spent one tick of ground
  // acceleration in mid-air. Backwards, where nothing capped reverse travel,
  // it was most obvious.
  const world = new World();

  const runner = { ...newMovementState(), y: 0, grounded: true };
  const runFlat = topSpeed(runner, world, input(0, -1), 40);

  const jumper = { ...newMovementState(), y: 0, grounded: true };
  const runJump = topSpeed(jumper, world, input(0, -1, BTN_JUMP), 40);

  check("a backwards jump is no faster than backwards running",
    runJump <= runFlat + 0.02, `run ${runFlat.toFixed(3)} jump ${runJump.toFixed(3)}`);

  const forward = { ...newMovementState(), y: 0, grounded: true };
  const forwardSpeed = topSpeed(forward, world, input(0, 1), 40);
  check("backwards is slower than forwards",
    runFlat < forwardSpeed - 0.3, `back ${runFlat.toFixed(2)} fwd ${forwardSpeed.toFixed(2)}`);
  check("forwards still reaches full speed",
    Math.abs(forwardSpeed - MOVE_SPEED) < 0.2, `${forwardSpeed.toFixed(3)}`);
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
console.log("weapon bloom");
{
  const ar = weaponById(W_AR);
  check("no bloom means the weapon's own spread",
    spreadFor(ar, false, 0) === ar.spreadHip);
  check("bloom widens the cone", spreadFor(ar, false, 1) > spreadFor(ar, false, 0));
  check("aiming is always tighter than hip at the same bloom",
    spreadFor(ar, true, 0.5) < spreadFor(ar, false, 0.5));

  let bloom = 0;
  for (let i = 0; i < 60; i++) bloom = stepBloom(bloom, MOVE_SPEED, TICK_DT);
  const moving = bloom;
  check("moving grows it", moving > 0.2, `${moving.toFixed(3)}`);
  check("it is capped", moving <= BLOOM_MAX + 1e-9);

  let walking = moving;
  for (let i = 0; i < 20; i++) walking = stepBloom(walking, MOVE_SPEED * 0.3, TICK_DT);
  let stopped = moving;
  for (let i = 0; i < 20; i++) stopped = stepBloom(stopped, 0, TICK_DT);
  check("slowing recovers some of it", walking < moving, `${walking.toFixed(3)}`);
  check("stopping recovers more", stopped < walking, `${stopped.toFixed(3)} vs ${walking.toFixed(3)}`);
  check("and it bottoms out at zero", stepBloom(0.001, 0, 1) === 0);
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
