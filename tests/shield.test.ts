/**
 * The shield block: one panel per match that throws bullets back at whoever
 * fired them.
 */
import { World } from "../shared/src/world";
import { makePiece, SLOT_SHIELD, packKey } from "../shared/src/build";
import { ServerPlayer } from "../server/src/player";
import { resolveFire, tryPlace, damagePiece } from "../server/src/combat";
import { EV_HIT, EV_PIECE_REMOVE } from "../shared/src/protocol";
import { BUILD_SHIELD } from "../shared/src/placement";
import type { GameEvent } from "../shared/src/snapshot";
import { TILE, SHIELD_MAX_HP, PLAYER_MAX_HP } from "../shared/src/constants";
import { W_PICKAXE, W_AR } from "../shared/src/weapons";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}
const socket = {} as WebSocket;

/**
 * A shooter looking down +Z with a victim further along it.
 *
 * Both stand in the MIDDLE of the cell column, not on x=0. The camera sits
 * over the shooter's shoulder and the shot is re-aimed from the muzzle to
 * where the camera is looking, so a round fired from exactly x=0 drifts a few
 * centimetres negative -- straight past the edge of a panel whose cell starts
 * at x=0, which looks exactly like the reflection not working.
 */
const LANE = TILE / 2;
function scene() {
  const world = new World();
  const shooter = new ServerPlayer(0, "shooter", socket);
  Object.assign(shooter, { x: LANE, y: 0, z: 0, yaw: 0, pitch: 0, weaponIdx: 2, nextFireAt: 0, aiming: true });
  const victim = new ServerPlayer(1, "victim", socket);
  Object.assign(victim, { x: LANE, y: 0, z: 30 });
  return { world, shooter, victim };
}

console.log("a bare shot connects");
{
  const { world, shooter, victim } = scene();
  const events: GameEvent[] = [];
  resolveFire(world, shooter, [shooter, victim], 10, 10_000, events);
  check("the control case hits", events.some(e => e.kind === EV_HIT && e.target === 1));
}

console.log("a shield turns it round");
{
  const { world, shooter, victim } = scene();
  // A panel across the line of fire, half way between them, facing along X so
  // its plane is the XY plane (a Z-facing barrier).
  world.set(makePiece(0, 0, 2, SLOT_SHIELD, 2, 1, 1, 0));
  const events: GameEvent[] = [];
  resolveFire(world, shooter, [shooter, victim], 10, 10_000, events);

  const onVictim = events.some(e => e.kind === EV_HIT && e.target === 1);
  const onShooter = events.some(e => e.kind === EV_HIT && e.target === 0);
  check("the shot no longer reaches the target", !onVictim);
  check("it comes back at whoever fired it", onShooter,
    JSON.stringify(events.filter(e => e.kind === EV_HIT)));
  check("and the reflected round is nobody's kill",
    events.every(e => e.kind !== EV_HIT || e.target !== 0 || e.shooter === 255));
  check("the shooter actually loses health", shooter.hp < PLAYER_MAX_HP,
    `hp=${shooter.hp}`);
}

console.log("bullets do not wear it down");
{
  const { world, shooter, victim } = scene();
  const piece = makePiece(0, 0, 2, SLOT_SHIELD, 2, 1, 1, 0);
  world.set(piece);
  for (let i = 0; i < 12; i++) {
    shooter.nextFireAt = 0;
    shooter.ammo[2] = 30;
    resolveFire(world, shooter, [shooter, victim], 10 + i, 10_000, []);
  }
  check("it is still standing after a magazine", world.pieces.has(piece.key));
  check("and undamaged", piece.hp === SHIELD_MAX_HP, `hp=${piece.hp}`);
}

console.log("but a pickaxe takes it apart");
{
  const world = new World();
  const piece = makePiece(0, 0, 2, SLOT_SHIELD, 2, 1, 1, 0);
  world.set(piece);
  const miner = new ServerPlayer(0, "miner", socket);
  Object.assign(miner, { weaponIdx: 0 });
  check("the pickaxe is the held weapon", miner.weaponId === W_PICKAXE);
  const events: GameEvent[] = [];
  for (let i = 0; i < 6; i++) damagePiece(world, piece.key, 20, 10, events, miner);
  check("it comes down", !world.pieces.has(piece.key));
  check("and says so", events.some(e => e.kind === EV_PIECE_REMOVE));

  // Whereas an assault rifle swinging at it does nothing at all.
  const second = makePiece(0, 0, 3, SLOT_SHIELD, 2, 1, 1, 0);
  world.set(second);
  const rifleman = new ServerPlayer(1, "rifleman", socket);
  Object.assign(rifleman, { weaponIdx: 2 });
  check("the rifle is the held weapon", rifleman.weaponId === W_AR);
  for (let i = 0; i < 10; i++) damagePiece(world, second.key, 40, 10, [], rifleman);
  check("a rifle cannot break one", world.pieces.has(second.key) && second.hp === SHIELD_MAX_HP);
}

console.log("one per match");
{
  const world = new World();
  const p = new ServerPlayer(0, "builder", socket);
  Object.assign(p, { x: TILE * 0.5, y: 0, z: TILE * 0.5, yaw: 0, pitch: 0, buildSlot: BUILD_SHIELD });
  const events: GameEvent[] = [];
  const first = tryPlace(world, p, 10, 10_000, events);
  check("the first one goes down", first);
  check("and is free", p.mats === 500, `mats=${p.mats}`);
  p.lastBuildAt = 0;
  // Move on a tile so the second attempt is not merely rejected as occupied.
  p.z += TILE * 2;
  const second = tryPlace(world, p, 20, 20_000, events);
  check("the second is refused", !second);

  p.shieldUsed = false;
  p.lastBuildAt = 0;
  check("until the round resets it", tryPlace(world, p, 30, 30_000, events));
  void packKey;
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
