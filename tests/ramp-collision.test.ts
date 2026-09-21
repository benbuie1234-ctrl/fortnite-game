import { World } from "../shared/src/world";
import { stepPlayer, type InputCommand, type MovementState } from "../shared/src/sim";
import { makePiece, SLOT_RAMP, SLOT_CONE, pieceBoxes } from "../shared/src/build";
import { TILE, TICK_DT, PLAYER_RADIUS } from "../shared/src/constants";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

function newPlayer(x: number, y: number, z: number): MovementState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, grounded: false, lastLandingSpeed: 0 };
}
function input(moveX: number, moveZ: number): InputCommand {
  return { seq: 0, moveX, moveZ, yaw: 0, pitch: 0, buttons: 0, slot: 2 };
}
function run(s: MovementState, w: World, cmd: InputCommand, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepPlayer(s, cmd, w, TICK_DT);
}

console.log("ramps are solid");

{
  // Regression: ramps used to return no collision box at all, so the only
  // thing handling them was a surface snap that placed you on top. Every
  // other approach angle went straight through.
  const ramp = makePiece(0, 0, 0, SLOT_RAMP, 0, 0, 1, 0);
  const boxes = pieceBoxes(ramp);
  check("a ramp contributes solid boxes", boxes.length > 0, `got ${boxes.length}`);

  // No box may poke above the true slope, or the player would walk on air.
  let above = 0;
  for (const b of boxes) {
    const farX = b[3];              // slope height equals distance along +X
    if (b[4] > farX + 1e-6) above++;
  }
  check("no step rises above the visible slope", above === 0, `${above} boxes too tall`);
}

{
  // Walking into the side of a ramp, where it is well above head height.
  const world = new World();
  world.set(makePiece(0, 0, 0, SLOT_RAMP, 0, 0, 1, 0));
  const p = newPlayer(2.5, 0, -2.0);
  run(p, world, input(0, 1), 90); // straight at the -Z face

  check("blocked by the side of a ramp", p.z < -PLAYER_RADIUS + 1e-3, `z=${p.z.toFixed(3)}`);
  check("did not pass through it", p.z < TILE, `z=${p.z.toFixed(3)}`);
}

{
  // Standing still on a ramp must not sink through it.
  const world = new World();
  world.set(makePiece(0, 0, 0, SLOT_RAMP, 0, 0, 1, 0));
  const surface = 1.5; // 45 degree slope, so height equals distance along +X
  const p = newPlayer(1.5, surface, 1.5);
  run(p, world, input(0, 0), 120);

  check("stays on the ramp surface", Math.abs(p.y - surface) < 0.08, `y=${p.y.toFixed(3)}`);
  check("did not fall through to the floor", p.y > 0.5, `y=${p.y.toFixed(3)}`);
  check("is grounded", p.grounded === true);
}

{
  // Walking up still works -- the fix must not trade one bug for another.
  //
  // Uses a ramp facing +Z and walks FORWARD rather than strafing, because the
  // strafe axis is a convention that has already been flipped once; forward is
  // stable regardless.
  const world = new World();
  world.set(makePiece(0, 0, 0, SLOT_RAMP, 0, 1, 1, 0)); // facing 1 = rises toward +Z
  const p = newPlayer(1.5, 0, 0.25);
  run(p, world, input(0, 1), 14);
  check("still climbs the slope", p.y > 0.8, `y=${p.y.toFixed(3)} z=${p.z.toFixed(3)}`);
  check("tracks the surface while climbing", Math.abs(p.y - p.z) < 0.35, `z=${p.z.toFixed(2)} y=${p.y.toFixed(2)}`);
}

console.log("cones are standable");

{
  // Regression: a cone was one full-cell box at half height, so it swallowed
  // the whole block and had no top to stand on.
  const cone = makePiece(0, 0, 0, SLOT_CONE, 0, 0, 1, 0);
  const boxes = pieceBoxes(cone);
  check("a cone is more than one box", boxes.length > 1, `got ${boxes.length}`);

  const widest = Math.max(...boxes.map((b) => b[3] - b[0]));
  const narrowest = Math.min(...boxes.map((b) => b[3] - b[0]));
  check("it narrows toward the top", narrowest < widest - 0.3,
    `widest ${widest.toFixed(2)} narrowest ${narrowest.toFixed(2)}`);
}

{
  const world = new World();
  world.set(makePiece(0, 0, 0, SLOT_CONE, 0, 0, 1, 0));
  const p = newPlayer(TILE / 2, 6, TILE / 2);
  run(p, world, input(0, 0), 120);

  const top = TILE * 0.5;
  check("you can stand on top of a cone", Math.abs(p.y - top) < 0.1, `y=${p.y.toFixed(3)} expected ${top}`);
  check("grounded on the cone", p.grounded === true);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
