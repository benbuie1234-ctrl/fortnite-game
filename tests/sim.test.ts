import { World } from "../shared/src/world";
import { stepPlayer, newMovementState, type InputCommand, type MovementState } from "../shared/src/sim";
import { makePiece, SLOT_FLOOR, SLOT_RAMP, SLOT_WALL_X } from "../shared/src/build";
import { TILE, PIECE_THICKNESS, PLAYER_RADIUS, TICK_DT } from "../shared/src/constants";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

function newPlayer(x: number, y: number, z: number): MovementState {
  return { ...newMovementState(), x, y, z };
}

function input(moveX: number, moveZ: number, buttons = 0): InputCommand {
  return { seq: 0, moveX, moveZ, yaw: 0, pitch: 0, buttons, slot: 2 };
}

function run(s: MovementState, world: World, cmd: InputCommand, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepPlayer(s, cmd, world, TICK_DT);
}

// ---------------------------------------------------------------------------

console.log("gravity and ground");
{
  const world = new World();
  const p = newPlayer(0, 8, 0);
  run(p, world, input(0, 0), 90);
  check("lands on the arena floor", Math.abs(p.y - 0) < 1e-3, `y=${p.y}`);
  check("is grounded after landing", p.grounded === true);
  check("vertical velocity settles", Math.abs(p.vy) < 1e-6, `vy=${p.vy}`);
}

console.log("walls block movement");
{
  const world = new World();
  // Wall on the -X face of cell (1,0,0), i.e. the plane x = 3.
  world.set(makePiece(1, 0, 0, SLOT_WALL_X, 0, 0, 1, 0));
  const p = newPlayer(1.5, 0, 1.5);
  run(p, world, input(-1, 0), 120);

  const limit = TILE - PIECE_THICKNESS / 2 - PLAYER_RADIUS;
  check("stops before the wall", p.x <= limit + 1e-3, `x=${p.x} limit=${limit}`);
  check("reaches the wall", p.x > limit - 0.05, `x=${p.x} limit=${limit}`);
  check("does not tunnel through", p.x < TILE, `x=${p.x}`);
}

console.log("floors are standable");
{
  const world = new World();
  // Floor across cell (0,1,0). The slab hangs below its cell line, so the
  // surface you stand on is the cell line itself -- which is what makes a
  // floor and a ramp anchored to the same cell meet.
  world.set(makePiece(0, 1, 0, SLOT_FLOOR, 0, 0, 1, 0));
  const p = newPlayer(1.5, 6, 1.5);
  run(p, world, input(0, 0), 90);
  const top = TILE;
  check("rests on the floor piece", Math.abs(p.y - top) < 0.02, `y=${p.y} expected=${top}`);
  check("grounded on the piece", p.grounded === true);
}

console.log("ramps are walkable");
{
  const world = new World();
  // Ramp in cell (0,0,0) rising toward +X.
  world.set(makePiece(0, 0, 0, SLOT_RAMP, 0, 0, 1, 0));
  const p = newPlayer(0.2, 0, 1.5);
  const startY = p.y;
  // Only 12 ticks: at 7 m/s the player crosses the whole 3 m ramp in well
  // under half a second, and running off the top is a different behaviour
  // than climbing it.
  run(p, world, input(-1, 0), 12);
  check("gains height climbing the ramp", p.y > startY + 1.0, `y=${p.y}`);
  check("still inside the ramp footprint", p.x <= TILE, `x=${p.x}`);
  check("tracks the slope surface", Math.abs(p.y - p.x) < 0.05, `x=${p.x} y=${p.y}`);
  check("grounded while climbing", p.grounded === true);

  // Running off the top should become a normal fall, not a teleport.
  run(p, world, input(-1, 0), 48);
  check("falls back to the floor past the ramp", Math.abs(p.y) < 1e-3, `y=${p.y}`);
}

console.log("determinism (required for client prediction)");
{
  // The client replays unacknowledged inputs after every snapshot. If the same
  // state plus the same inputs does not land in the same place, the player
  // rubber-bands on every single snapshot.
  const build = () => {
    const w = new World();
    w.set(makePiece(1, 0, 0, SLOT_WALL_X, 0, 0, 1, 0));
    w.set(makePiece(0, 1, 0, SLOT_FLOOR, 0, 0, 1, 0));
    w.set(makePiece(-1, 0, 0, SLOT_RAMP, 0, 2, 1, 0));
    return w;
  };
  const cmds: InputCommand[] = [
    input(1, 1, 1), input(0, 1), input(-1, 1), input(-1, 0),
    input(0, -1), input(1, -1, 1), input(0, 0), input(-1, 0),
  ];

  const a = newPlayer(0.4, 2.5, 1.1);
  const b = newPlayer(0.4, 2.5, 1.1);
  const wa = build();
  const wb = build();
  for (let rep = 0; rep < 12; rep++) {
    for (const c of cmds) {
      stepPlayer(a, c, wa, TICK_DT);
      stepPlayer(b, c, wb, TICK_DT);
    }
  }
  check("positions match exactly", a.x === b.x && a.y === b.y && a.z === b.z,
    `a=(${a.x},${a.y},${a.z}) b=(${b.x},${b.y},${b.z})`);
  check("velocities match exactly", a.vx === b.vx && a.vy === b.vy && a.vz === b.vz);
  check("grounded flag matches", a.grounded === b.grounded);
}

console.log("jumping");
{
  const world = new World();
  const p = newPlayer(0, 0, 0);
  run(p, world, input(0, 0), 5);
  check("starts grounded", p.grounded === true);

  stepPlayer(p, input(0, 0, 1), world, TICK_DT); // BTN_JUMP
  check("leaves the ground", p.grounded === false, `grounded=${p.grounded}`);
  check("moving upward", p.vy > 0, `vy=${p.vy}`);

  let peak = p.y;
  for (let i = 0; i < 120; i++) {
    stepPlayer(p, input(0, 0), world, TICK_DT);
    peak = Math.max(peak, p.y);
  }
  check("jump clears a useful height", peak > 1.0 && peak < 2.5, `peak=${peak}`);
  check("returns to the ground", Math.abs(p.y) < 1e-3, `y=${p.y}`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
