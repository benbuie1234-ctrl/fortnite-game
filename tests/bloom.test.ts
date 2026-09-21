/**
 * Weapon bloom: the cone has to open while you move, settle in stages once you
 * stop, and never reach the runaway width that got the first version removed.
 */
import { World } from "../shared/src/world";
import {
  stepPlayer, newMovementState, BTN_SPRINT, BTN_JUMP, BTN_CROUCH,
  type InputCommand, type MovementState,
} from "../shared/src/sim";
import { spreadFor, weaponById, W_AR, W_SNIPER } from "../shared/src/weapons";
import { TICK_DT } from "../shared/src/constants";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

const world = new World();
function cmd(over: Partial<InputCommand> = {}): InputCommand {
  return { seq: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, slot: 2, ...over };
}
function run(s: MovementState, c: InputCommand, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepPlayer(s, c, world, TICK_DT);
}

console.log("bloom opens and settles");
{
  const s = newMovementState();
  s.grounded = true;
  check("starts fully settled", s.bloom === 0, `got ${s.bloom}`);

  // Two seconds of sprinting forward is long enough to reach the ceiling.
  run(s, cmd({ moveZ: 1, buttons: BTN_SPRINT }), 60);
  const moving = s.bloom;
  check("running opens the cone", moving > 0.8, `got ${moving}`);

  // A third of a second after letting go: noticeably tighter, but not settled.
  run(s, cmd(), 10);
  const justStopped = s.bloom;
  check("stopping tightens it straight away", justStopped < moving - 0.2,
    `${moving} -> ${justStopped}`);
  check("but it is not settled yet", justStopped > 0.05, `got ${justStopped}`);

  // Another second and it is all the way home.
  run(s, cmd(), 30);
  check("standing still settles it completely", s.bloom === 0, `got ${s.bloom}`);
}

console.log("stance and air");
{
  const air = newMovementState();
  air.grounded = true;
  run(air, cmd({ buttons: BTN_JUMP }), 6);
  check("a jump blooms even without horizontal speed",
    !air.grounded && air.bloom > 0.4, `grounded=${air.grounded} bloom=${air.bloom}`);

  const crouched = newMovementState();
  crouched.grounded = true;
  const walk = newMovementState();
  walk.grounded = true;
  run(crouched, cmd({ moveZ: 1, buttons: BTN_CROUCH }), 60);
  run(walk, cmd({ moveZ: 1 }), 60);
  check("crouch-walking is steadier than walking", crouched.bloom < walk.bloom,
    `crouch=${crouched.bloom} walk=${walk.bloom}`);
}

console.log("the cone stays sane");
{
  const ar = weaponById(W_AR);
  const still = spreadFor(ar, false, 0);
  const worst = spreadFor(ar, false, 1);
  check("a settled shot is the weapon's own spread", still === ar.spreadHip);
  check("a moving shot is wider", worst > still);
  // The version that was removed tripled the cone. Anything near that is a
  // regression, whatever the constants say.
  check("but never more than doubled", worst < still * 2, `x${worst / still}`);

  const aimed = spreadFor(ar, true, 1);
  check("aiming is still the accurate option", aimed < still, `${aimed} vs ${still}`);

  // A scoped sniper has zero spread by definition, and no multiplier can open
  // a cone that starts at zero -- which is exactly the guarantee wanted.
  check("a scoped sniper stays pin-sharp at full bloom",
    spreadFor(weaponById(W_SNIPER), true, 1) === 0);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
