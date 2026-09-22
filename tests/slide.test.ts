// The slide, as a movement option rather than a stumble: a hill has to pay,
// an uphill has to cost, a slide has to survive a ledge, and jumping out of
// one has to carry the momentum without becoming a free speed boost.
import { World } from "../shared/src/world";
import {
  stepPlayer, newMovementState,
  BTN_JUMP, BTN_CROUCH, BTN_SPRINT,
  type InputCommand, type MovementState,
} from "../shared/src/sim";
import {
  TICK_DT, MOVE_SPEED, SPRINT_SPEED_MULT, SLIDE_SPRINT_BOOST_SPEED,
  SLIDE_JUMP_MIN_TIME,
} from "../shared/src/constants";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

/** Yaw that puts "forward" on +x, so a test can slide along the x axis. */
const EAST = -Math.PI / 2;
function input(moveZ: number, buttons = 0, yaw = EAST): InputCommand {
  return { seq: 0, moveX: 0, moveZ, yaw, pitch: 0, buttons, slot: 2 };
}
const speed = (s: MovementState) => Math.hypot(s.vx, s.vz);

/** Sprint from a standstill until at full speed, then return the state. */
function sprinting(w: World, x: number, z: number, yaw = EAST): MovementState {
  const s = { ...newMovementState(), x, y: w.groundAt(x, z), z, yaw, grounded: true };
  for (let i = 0; i < 40; i++) stepPlayer(s, input(1, BTN_SPRINT, yaw), w, TICK_DT);
  return s;
}

// ---------------------------------------------------------------------------
console.log("a hill is worth finding");
{
  // The eastern face below Crestview Heights: about nineteen metres of descent
  // over thirty, which is the longest sustained fall line on the island. The
  // control is the mesa top itself, which the plaza pad holds dead level.
  const w = new World();
  w.terrainEnabled = true;

  function slide(x: number, z: number, ticks: number) {
    const s = sprinting(w, x, z);
    // One press starts it, then crouch is simply held.
    stepPlayer(s, input(1, BTN_SPRINT | BTN_CROUCH), w, TICK_DT);
    const entry = speed(s);
    const startX = s.x;
    let peak = entry, sliding = 1, travelled = 0;
    for (let i = 0; i < ticks; i++) {
      stepPlayer(s, input(1, BTN_SPRINT | BTN_CROUCH), w, TICK_DT);
      if (s.sliding) { sliding++; peak = Math.max(peak, speed(s)); travelled = s.x - startX; }
    }
    return { s, entry, peak, sliding, travelled };
  }

  const down = slide(156, -156, 200);
  const flat = slide(56, -176, 200);
  console.log(`    downhill: ${down.sliding} ticks, ${down.travelled.toFixed(1)} m, peak ${down.peak.toFixed(1)} m/s`);
  console.log(`    flat:     ${flat.sliding} ticks, ${flat.travelled.toFixed(1)} m, peak ${flat.peak.toFixed(1)} m/s`);

  check("sliding downhill holds the speed the hill gives it",
    down.peak >= down.entry - 0.1, `entry ${down.entry.toFixed(1)} peak ${down.peak.toFixed(1)}`);
  check("and holds more of it than the same slide on the flat",
    down.peak > flat.peak + 0.5, `${down.peak.toFixed(1)} vs ${flat.peak.toFixed(1)}`);
  // The margin here is structurally smaller than it looks like it should be,
  // and honestly so: the flat slide's entry boost scales with sprint speed, so
  // the baseline this is measured against got longer when sprint stopped being
  // capped below its own multiplier. The hill's own top speed is set by the
  // grade against SLIDE_FRICTION and does not move with it.
  check("and carries much further",
    down.travelled > flat.travelled * 1.4,
    `${down.travelled.toFixed(1)} m vs ${flat.travelled.toFixed(1)} m`);
  check("and lasts longer",
    down.sliding > flat.sliding, `${down.sliding} vs ${flat.sliding} ticks`);

  // Uphill is the same rule with the sign flipped, which is what stops a
  // slide being a way to travel everywhere.
  const up = (() => {
    const s = sprinting(w, 186, -156, Math.PI / 2); // at the foot, facing back up
    let sliding = 0;
    for (let i = 0; i < 150; i++) {
      stepPlayer(s, input(1, BTN_SPRINT | BTN_CROUCH, Math.PI / 2), w, TICK_DT);
      if (s.sliding) sliding++;
    }
    return sliding;
  })();
  console.log(`    uphill:   ${up} ticks`);
  check("sliding uphill dies quickly", up < flat.sliding, `${up} vs ${flat.sliding} ticks`);
}

// ---------------------------------------------------------------------------
console.log("jumping out of a slide");
{
  const w = new World();
  const s = sprinting(w, 0, 0);
  stepPlayer(s, input(1, BTN_SPRINT | BTN_CROUCH), w, TICK_DT);
  check("the slide is running", s.sliding === true);

  // Too early: the entry boost must not be cashable straight into a jump.
  const early = { ...s };
  stepPlayer(early, input(1, BTN_SPRINT | BTN_CROUCH | BTN_JUMP), w, TICK_DT);
  check("a jump on the next tick is refused", early.grounded === true && early.sliding === true,
    `grounded ${early.grounded} sliding ${early.sliding}`);

  // Let the slide actually run, then jump out of it.
  const late = { ...s };
  const ticks = Math.ceil(SLIDE_JUMP_MIN_TIME / TICK_DT) + 1;
  for (let i = 0; i < ticks; i++) stepPlayer(late, input(1, BTN_SPRINT | BTN_CROUCH), w, TICK_DT);
  const before = speed(late);
  stepPlayer(late, input(1, BTN_SPRINT | BTN_CROUCH | BTN_JUMP), w, TICK_DT);
  console.log(`    slide-jump: ${before.toFixed(1)} -> ${speed(late).toFixed(1)} m/s, vy ${late.vy.toFixed(1)}`);
  check("a slide that has run can be jumped out of", late.grounded === false && late.vy > 0);
  check("and the jump keeps the momentum", speed(late) > before - 0.5,
    `${before.toFixed(2)} -> ${speed(late).toFixed(2)}`);
  check("which is faster than sprinting", speed(late) > MOVE_SPEED * SPRINT_SPEED_MULT,
    `${speed(late).toFixed(2)} vs ${(MOVE_SPEED * SPRINT_SPEED_MULT).toFixed(2)}`);
  check("and it spends the slide", late.sliding === false && late.slideLockout > 0);

  // The whole point of the lockout: a slide-jump must not chain into another
  // slide the moment it lands, or that loop beats sprinting forever.
  let resliddenWhileFalling = false;
  for (let i = 0; i < 60; i++) {
    stepPlayer(late, input(1, BTN_SPRINT | BTN_CROUCH), w, TICK_DT);
    if (late.sliding) resliddenWhileFalling = true;
  }
  check("and landing from it does not start another slide", resliddenWhileFalling === false);
}

// ---------------------------------------------------------------------------
console.log("a ledge interrupts a slide, it does not cancel it");
{
  const w = new World();
  // A low platform to run off: 0.9 m up, ending at x = 12. The lip has to be
  // far enough along that the sprint-up and the slide both happen ON it --
  // with the box ending at x = 0 the player was already past the edge before
  // crouch was ever pressed, and the test was measuring a slide in mid-air.
  w.addObstacle([-40, 0, -8, 12, 0.9, 8], 9001);

  const s = { ...newMovementState(), x: -12, y: 0.9, z: 0, yaw: EAST, grounded: true };
  for (let i = 0; i < 40; i++) stepPlayer(s, input(1, BTN_SPRINT), w, TICK_DT);
  stepPlayer(s, input(1, BTN_SPRINT | BTN_CROUCH), w, TICK_DT);
  check("sliding along the platform", s.sliding === true, `x ${s.x.toFixed(1)}`);

  let airborne = 0, slidAfterLanding = false, landed = false;
  let speedAtLip = 0, lockoutWhileAirborne = 0;
  for (let i = 0; i < 90; i++) {
    const wasGrounded = s.grounded;
    if (wasGrounded && !landed && s.x > -1) speedAtLip = speed(s);
    stepPlayer(s, input(1, BTN_SPRINT | BTN_CROUCH), w, TICK_DT);
    if (!s.grounded) { airborne++; lockoutWhileAirborne = Math.max(lockoutWhileAirborne, s.slideLockout); }
    if (!wasGrounded && s.grounded) landed = true;
    if (landed && s.sliding) slidAfterLanding = true;
  }
  console.log(`    ${airborne} airborne ticks, lip speed ${speedAtLip.toFixed(1)}, resumed ${slidAfterLanding}`);
  check("running off the lip puts the player in the air", airborne > 0, `${airborne} ticks`);
  check("and the slide picks up again on landing", slidAfterLanding === true);
  // The gap must not be charged as the end of the slide, or the cooldown
   // would still be running when the feet land and the resume could not fire.
  check("with no cooldown charged for the gap", lockoutWhileAirborne === 0,
    `${lockoutWhileAirborne.toFixed(2)} s`);
}

// ---------------------------------------------------------------------------
console.log("landing into a slide");
{
  const w = new World();

  /** Drop a player in from 4 m with a given horizontal speed and crouch held. */
  function drop(vx: number): { slid: boolean; peak: number } {
    const s = { ...newMovementState(), x: 0, y: 4, z: 0, vx, yaw: EAST, grounded: false };
    let slid = false, peak = 0;
    for (let i = 0; i < 90; i++) {
      stepPlayer(s, input(1, BTN_CROUCH), w, TICK_DT);
      if (s.grounded && s.sliding) { slid = true; peak = Math.max(peak, speed(s)); }
    }
    return { slid, peak };
  }

  const fast = drop(MOVE_SPEED * SPRINT_SPEED_MULT);
  const slow = drop(3);
  console.log(`    landed at sprint speed: slid ${fast.slid}, peak ${fast.peak.toFixed(1)} m/s`);
  check("landing at speed with crouch held starts a slide", fast.slid === true);
  check("landing at a shuffle does not", slow.slid === false);

  // A landing slide is a continuation, not a fresh shove: it must never come
  // out faster than the speed that arrived, or a route with ledges in it beats
  // the same route without one and a staircase ratchets up to the cap.
  check("and a landing slide is not given the entry boost",
    fast.peak < SLIDE_SPRINT_BOOST_SPEED - 1,
    `${fast.peak.toFixed(2)} vs ${SLIDE_SPRINT_BOOST_SPEED}`);

  // The same thing the long way round: sprint off a roof with crouch pressed
  // only once airborne, so the only slide that can happen is the landing one.
  w.addObstacle([-40, 0, -8, 0, 4, 8], 9002);
  const runner = { ...newMovementState(), x: -12, y: 4, z: 0, yaw: EAST, grounded: true };
  let leftTheRoof = false, slidOnLanding = false;
  for (let i = 0; i < 160; i++) {
    const buttons = BTN_SPRINT | (leftTheRoof ? BTN_CROUCH : 0);
    stepPlayer(runner, input(1, buttons), w, TICK_DT);
    if (!runner.grounded) leftTheRoof = true;
    if (leftTheRoof && runner.grounded && runner.sliding) slidOnLanding = true;
  }
  check("sprinting off a roof and crouching in the air lands in a slide",
    slidOnLanding === true, `left the roof: ${leftTheRoof}`);
}

console.log(failures === 0
  ? "\nPASS: slope momentum, slide-jump, ledge gaps and landing slides."
  : `\n${failures} FAILURES`);
if (failures > 0) process.exit(1);
