// The development aim lock. The promise is "cannot miss", so the cases that
// would otherwise cause a miss are the ones worth testing: bloom, bullet drop,
// a multi-pellet spread, and a crouching target. Cover is the deliberate
// exception -- a lock that shot through walls would be a different feature.
import { World } from "../shared/src/world";
import { ServerPlayer } from "../server/src/player";
import { resolveFire } from "../server/src/combat";
import { EV_HIT, EV_SHOT } from "../shared/src/protocol";
import type { GameEvent } from "../shared/src/snapshot";
import { makePiece, SLOT_WALL_Z } from "../shared/src/build";
import { CROUCH_HEIGHT, PLAYER_HEIGHT } from "../shared/src/constants";
import { weaponById, W_AR, W_SHOTGUN, W_SNIPER } from "../shared/src/weapons";
import { Writer, Reader, writeInputBatch, readInputBatch } from "../shared/src/protocol";
import { BTN_AIMBOT, BTN_FIRE, BTN_SPRINT } from "../shared/src/sim";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

const socket = {} as WebSocket;

interface Options {
  weaponIdx?: number;
  aimbot?: boolean;
  crouch?: number;
  yaw?: number;
  world?: World;
  /** Sideways offset of the target, so the lock has to actually turn. */
  offsetX?: number;
}

function fire(distance: number, options: Options = {}): GameEvent[] {
  const world = options.world ?? new World();
  const shooter = new ServerPlayer(0, "shooter", socket);
  Object.assign(shooter, {
    x: 1.5, y: 0, z: 0,
    yaw: options.yaw ?? 0, pitch: 0,
    aiming: false,
    weaponIdx: options.weaponIdx ?? 2,
    aimbot: options.aimbot ?? true,
    nextFireAt: 0, reloadEndAt: 0,
  });

  const target = new ServerPlayer(1, "target", socket);
  target.x = 1.5 + (options.offsetX ?? 0);
  target.y = 0;
  target.z = distance;
  target.crouch = options.crouch ?? 0;

  const events: GameEvent[] = [];
  resolveFire(world, shooter, [shooter, target], 10, 10_000, events);
  return events;
}

const hits = (events: GameEvent[]): number =>
  events.filter(e => e.kind === EV_HIT).length;

// ---------------------------------------------------------------------------
console.log("the lock cannot miss");
{
  // Each of these is well outside the weapon's own cone at range.
  for (const distance of [6, 25, 60, 140]) {
    const events = fire(distance);
    check(`assault rifle connects at ${distance} m through full bloom`,
      hits(events) === 1, `${hits(events)} hits`);
  }
}
{
  // Well past the flat zone: a straight shot here falls roughly 11 m short,
  // which the launch-angle solve has to cancel.
  const events = fire(350, { weaponIdx: 4 });
  check("the sniper connects at 350 m, where drop is metres",
    hits(events) === 1, `${hits(events)} hits`);
  check("and it is the sniper firing",
    events.some(e => e.kind === EV_SHOT && e.weapon === W_SNIPER));
}
{
  // Every pellet, not just the one nearest the middle of the cone.
  const weapon = weaponById(W_SHOTGUN);
  const events = fire(9, { weaponIdx: 1 });
  check("every shotgun pellet connects",
    hits(events) === weapon.pellets, `${hits(events)} of ${weapon.pellets}`);
}
{
  // A crouched target's head is lower; aiming at a standing head would sail
  // straight over it.
  const events = fire(30, { crouch: 1 });
  check("a crouching target is still hit", hits(events) === 1, `${hits(events)} hits`);
  check("and crouching really does lower the head", CROUCH_HEIGHT < PLAYER_HEIGHT);
}
{
  // The shooter is facing the wrong way entirely. The lock has to do all of
  // the aiming, or this proves nothing.
  const events = fire(40, { yaw: Math.PI, offsetX: 18 });
  check("it connects while facing the other way",
    hits(events) === 1, `${hits(events)} hits`);
}

// ---------------------------------------------------------------------------
console.log("but it does not shoot through cover");
{
  const world = new World();
  // Wall across the line of fire at z = 6.
  world.set(makePiece(0, 0, 2, SLOT_WALL_Z, 1, 0, 9, 0));
  const events = fire(12, { world });
  check("a wall between the two stops the shot", hits(events) === 0, `${hits(events)} hits`);
  check("and the wall is what got hit",
    events.some(e => e.kind === EV_SHOT && e.hit === 1));
}

// ---------------------------------------------------------------------------
console.log("and it is off unless asked for");
{
  // Same geometry, lock disabled, shooter facing away: an ordinary miss.
  const events = fire(40, { aimbot: false, yaw: Math.PI, offsetX: 18 });
  check("facing away without the lock misses", hits(events) === 0, `${hits(events)} hits`);
  const straight = fire(40, { aimbot: false, offsetX: 18 });
  check("and so does facing forward at an off-axis target",
    hits(straight) === 0, `${hits(straight)} hits`);
}
{
  // Spread still applies to everyone else. Fired straight down the axis at
  // long range, an unlocked burst must not be perfect -- and the locked one
  // must be, or this comparison proves nothing.
  let loose = 0;
  let locked = 0;
  for (let i = 0; i < 40; i++) {
    loose += hits(fire(120, { aimbot: false, weaponIdx: 2 }));
    locked += hits(fire(120));
  }
  check("an unlocked burst scatters", loose < 40, `${loose}/40 landed`);
  check("a locked burst does not", locked === 40, `${locked}/40 landed`);
  void W_AR;
}

// ---------------------------------------------------------------------------
console.log("the flag survives the wire");
{
  // The lock lives on the server, so the whole feature hangs on one bit
  // getting there. BTN_AIMBOT is bit 8 -- the first one outside a byte -- so a
  // button field narrowed to u8 anywhere along the way would silently disable
  // it while everything else kept working.
  const w = new Writer(64);
  writeInputBatch(w, [{
    seq: 7, moveX: 1, moveZ: -1,
    yaw: 0.25, pitch: -0.1,
    buttons: BTN_AIMBOT | BTN_FIRE | BTN_SPRINT,
    slot: 4,
  }], 123_456);
  const batch = readInputBatch(new Reader(w.finish().slice(1)));
  const cmd = batch.commands[0];
  check("the aim lock bit round-trips", (cmd.buttons & BTN_AIMBOT) !== 0,
    `buttons=${cmd.buttons}`);
  check("and does not disturb its neighbours",
    (cmd.buttons & BTN_FIRE) !== 0 && (cmd.buttons & BTN_SPRINT) !== 0);
  check("(it is deliberately outside the low byte)", BTN_AIMBOT > 0xff);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
