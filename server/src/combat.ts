import {
  EYE_HEIGHT, MAX_LAG_COMP_MS, INTERP_DELAY_MS, BUILD_COOLDOWN, BUILD_RANGE,
  MATERIALS, TILE,
} from "@shared/constants";
import { makePiece, inGridBounds, currentHp, packKey } from "@shared/build";
import { World, rayVsBox, type RayHit } from "@shared/world";
import {
  weaponById, damageAtRange, W_PICKAXE, W_SNIPER,
  spreadFor, pieceDamage, traceWithDrop,
} from "@shared/weapons";
import { eyeHeightFor } from "@shared/sim";
import { forwardVector, applySpread } from "@shared/vec";
import {
  EV_PIECE_ADD, EV_PIECE_REMOVE, EV_PIECE_DAMAGE, EV_SHOT, EV_HIT, EV_FOLIAGE,
} from "@shared/protocol";
import type { GameEvent } from "@shared/snapshot";
import { ServerPlayer, hitBoxes } from "./player";
import { resolvePlacement, placementIssue } from "@shared/placement";
import { cameraPose } from "@shared/camera";
import { ARENA_OWNER, treeIndexFromKey } from "@shared/arena";

/**
 * Pick a target for the aim lock and return the exact launch direction that
 * puts a round on its head.
 *
 * Three things have to be solved together or the shot still misses:
 *
 *  - The target has to be the one the SERVER will hit-test, so it is read at
 *    the lag-compensated time rather than wherever it is right now.
 *  - Bullet drop has to be cancelled. Past 45 m a round falls away from a
 *    straight line -- about 1.5 m at 200 m -- so the launch angle is solved by
 *    firing the real trajectory, measuring where it ends up, and lifting the
 *    aim by the error. Three passes converge well inside a head.
 *  - Line of sight has to be checked, because a perfect direction into a wall
 *    is still a miss. Blocked targets are only chosen if nothing else is
 *    available, so the lock tracks without ever shooting through cover.
 */
function lockOn(
  world: World,
  shooter: ServerPlayer,
  players: readonly ServerPlayer[],
  rewindTo: number,
  nowSec: number,
  weapon: { range: number },
  ox: number, oy: number, oz: number,
): [number, number, number] | null {
  let bestDistance = Infinity;
  let bestVisible = false;
  let tx = 0, ty = 0, tz = 0;

  for (const target of players) {
    if (target.id === shooter.id || !target.alive) continue;
    const p = target.positionAt(rewindTo);
    const { head } = hitBoxes(p.x, p.y, p.z, target.crouch);
    const cx = (head[0] + head[3]) / 2;
    const cy = (head[1] + head[4]) / 2;
    const cz = (head[2] + head[5]) / 2;

    const distance = Math.hypot(cx - ox, cy - oy, cz - oz);
    if (distance > weapon.range) continue;

    const blocked = world.raycast(
      ox, oy, oz,
      (cx - ox) / distance, (cy - oy) / distance, (cz - oz) / distance,
      distance - 0.05, nowSec,
    );
    const visible = blocked === null;
    // A target you can actually shoot always beats a nearer one you cannot.
    if (bestVisible && !visible) continue;
    if (visible === bestVisible && distance >= bestDistance) continue;

    bestDistance = distance;
    bestVisible = visible;
    tx = cx; ty = cy; tz = cz;
  }
  if (bestDistance === Infinity) return null;

  let aimY = ty;
  for (let pass = 0; pass < 3; pass++) {
    const dx = tx - ox, dy = aimY - oy, dz = tz - oz;
    const length = Math.hypot(dx, dy, dz) || 1;
    // Fly the real trajectory out to the target's range and see where it lands.
    const end = traceWithDrop(
      ox, oy, oz, dx / length, dy / length, dz / length, bestDistance, () => null,
    );
    aimY += ty - end.y;
  }

  const dx = tx - ox, dy = aimY - oy, dz = tz - oz;
  const length = Math.hypot(dx, dy, dz) || 1;
  return [dx / length, dy / length, dz / length];
}

/**
 * Resolve one trigger pull. Everything here is authoritative: the client never
 * tells us that it hit something, only that it fired.
 */
export function resolveFire(
  world: World,
  shooter: ServerPlayer,
  players: readonly ServerPlayer[],
  nowSec: number,
  nowMs: number,
  events: GameEvent[],
): void {
  const weapon = weaponById(shooter.weaponId);

  if (nowSec < shooter.nextFireAt) return;
  if (nowSec < shooter.reloadEndAt) return;

  const ammo = shooter.ammo[shooter.weaponIdx];
  if (Number.isFinite(ammo) && ammo <= 0) {
    beginReload(shooter, nowSec);
    return;
  }

  shooter.nextFireAt = nowSec + weapon.fireInterval;
  if (Number.isFinite(ammo)) shooter.ammo[shooter.weaponIdx] = ammo - 1;

  // Rewind the world to what the shooter actually saw: half their round trip
  // plus the interpolation delay their client renders remote players at.
  const rewindMs = Math.min(MAX_LAG_COMP_MS, shooter.rttMs * 0.5 + INTERP_DELAY_MS);
  const rewindTo = nowMs - rewindMs;

  const ox = shooter.x;
  const oy = shooter.y + eyeHeightFor(shooter.crouch);
  const oz = shooter.z;
  let baseDir = forwardVector(shooter.yaw, shooter.pitch);

  // The aim lock replaces the whole aiming path, including the camera
  // correction below: that correction exists to make the crosshair agree with
  // an over-the-shoulder camera, and a locked shot is already pointed exactly
  // where it needs to go.
  const locked = shooter.aimbot && weapon.id !== W_PICKAXE
    ? lockOn(world, shooter, players, rewindTo, nowSec, weapon, ox, oy, oz)
    : null;

  if (locked) baseDir = locked;
  else if (weapon.id !== W_PICKAXE) {
    const camera = cameraPose(shooter, shooter.aiming, world, nowSec, weapon.id===W_SNIPER);
    const [cx,cy,cz] = camera.origin;
    const [fx,fy,fz] = camera.forward;
    let aimDistance = world.raycast(cx,cy,cz,fx,fy,fz,weapon.range,nowSec)?.t ?? weapon.range;
    for (const target of players) {
      if (target.id === shooter.id || !target.alive) continue;
      const pos = target.positionAt(rewindTo);
      const boxes = hitBoxes(pos.x,pos.y,pos.z,target.crouch);
      for (const box of [boxes.head,boxes.body]) {
        const hit=rayVsBox(box,cx,cy,cz,fx,fy,fz);
        if(hit && hit.t<aimDistance) aimDistance=hit.t;
      }
    }
    const delta:[number,number,number]=[cx+fx*aimDistance-ox,cy+fy*aimDistance-oy,cz+fz*aimDistance-oz];
    const length=Math.hypot(...delta);
    if(length>0.001) baseDir=delta.map(v=>v/length) as [number,number,number];
  }
  // A locked shot has no cone at all: any spread is a chance to miss, which is
  // the one thing that toggle exists to remove.
  const spread = locked ? 0 : spreadFor(weapon, shooter.aiming);

  for (let pellet = 0; pellet < weapon.pellets; pellet++) {
    const dir = applySpread(baseDir, spread, Math.random);
    const [dx, dy, dz] = dir;

    let pieceHit: RayHit | null = null;
    let hitPlayer: ServerPlayer | null = null;
    let hitHead = false;

    // Segmented so the round can drop. Inside the flat zone this is identical
    // to a straight raycast; past it the path bends and the hit tests follow.
    const shot = traceWithDrop(
      ox, oy, oz, dx, dy, dz, weapon.range,
      (x, y, z, sx, sy, sz, segment) => {
        let nearest = segment;
        let found = false;

        const piece = world.raycast(x, y, z, sx, sy, sz, segment, nowSec);
        if (piece && piece.t <= nearest) {
          nearest = piece.t; pieceHit = piece; hitPlayer = null; found = true;
        }

        for (const target of players) {
          if (target.id === shooter.id || !target.alive) continue;
          const p = target.positionAt(rewindTo);
          const { body, head } = hitBoxes(p.x, p.y, p.z, target.crouch);

          const headHit = rayVsBox(head, x, y, z, sx, sy, sz);
          if (headHit && headHit.t <= nearest) {
            nearest = headHit.t; hitPlayer = target; hitHead = true; pieceHit = null; found = true;
          }
          const bodyHit = rayVsBox(body, x, y, z, sx, sy, sz);
          if (bodyHit && bodyHit.t <= nearest) {
            nearest = bodyHit.t; hitPlayer = target; hitHead = false; pieceHit = null; found = true;
          }
        }
        return found ? nearest : null;
      },
    );

    const victim = hitPlayer as ServerPlayer | null;
    const struck = pieceHit as RayHit | null;

    if (victim) {
      // Falloff is measured along the path travelled, not the straight-line
      // distance, so a long arcing shot is priced at what it actually flew.
      let dmg = damageAtRange(weapon, shot.t);
      if (hitHead) dmg *= weapon.headMult;
      applyPlayerDamage(victim, dmg, shooter, nowSec);
      events.push({
        kind: EV_HIT, target: victim.id, shooter: shooter.id,
        damage: Math.round(dmg), headshot: hitHead ? 1 : 0,
      });
    } else if (struck) {
      damagePiece(world, struck.piece.key, pieceDamage(weapon, struck.piece.mat), nowSec, events, shooter);
      // Shooting a tree knocks its leaves off. The trunk is indestructible
      // cover either way; what changes is that everyone can now see through
      // the canopy, so hiding in one stops being free once you fire from it.
      const tree = treeIndexFromKey(struck.piece.key);
      if (tree >= 0) events.push({ kind: EV_FOLIAGE, index: tree });
    }

    events.push({
      kind: EV_SHOT, shooter: shooter.id, weapon: weapon.id,
      ox, oy, oz,
      ex: shot.x, ey: shot.y, ez: shot.z,
      hit: victim ? 2 : (struck ? 1 : 0),
    });
  }


  if (Number.isFinite(shooter.ammo[shooter.weaponIdx]) && shooter.ammo[shooter.weaponIdx] <= 0) {
    beginReload(shooter, nowSec);
  }
}

export function beginReload(p: ServerPlayer, nowSec: number): void {
  const weapon = weaponById(p.weaponId);
  if (!Number.isFinite(weapon.magSize)) return;
  if (p.ammo[p.weaponIdx] >= weapon.magSize) return;
  if (nowSec < p.reloadEndAt) return;
  p.reloadEndAt = nowSec + weapon.reloadTime;
}

export function finishReloads(p: ServerPlayer, nowSec: number): void {
  if (p.reloadEndAt > 0 && nowSec >= p.reloadEndAt) {
    const weapon = weaponById(p.weaponId);
    if (Number.isFinite(weapon.magSize)) p.ammo[p.weaponIdx] = weapon.magSize;
    p.reloadEndAt = 0;
  }
}

export function applyPlayerDamage(
  target: ServerPlayer, dmg: number, source: ServerPlayer | null, nowSec: number,
): void {
  if (!target.alive) return;
  let remaining = dmg;
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, remaining);
    target.shield -= absorbed;
    remaining -= absorbed;
  }
  target.hp -= remaining;
  if (source) {
    target.lastDamagedBy = source.id;
    target.lastDamagedAt = nowSec;
  }
}

/** Apply damage to a build piece, destroying it at zero. */
export function damagePiece(
  world: World, key: number, dmg: number, nowSec: number,
  events: GameEvent[], source: ServerPlayer | null,
): void {
  const piece = world.pieces.get(key);
  if (!piece) return;
  if (piece.ownerId === ARENA_OWNER) return; // arena geometry is indestructible

  // Grow-in means a fresh piece has less effective HP than its stored value.
  const effective = currentHp(piece, nowSec);
  const next = effective - dmg;

  // Pickaxing a build refunds materials, which is what keeps a box fight going.
  if (source && source.weaponId === W_PICKAXE) {
    source.addMats(Math.round(Math.min(dmg, Math.max(0, effective)) / 8));
  }

  if (next <= 0) {
    world.remove(key);
    events.push({ kind: EV_PIECE_REMOVE, key });
  } else {
    piece.hp = next;
    events.push({ kind: EV_PIECE_DAMAGE, key, hp: Math.round(next) });
  }
}

/**
 * Validate and place a build piece. Returns true if something was placed.
 * All of the limits here are server-side on purpose; the client predicts the
 * same rules but never gets to assert the outcome.
 */
export function tryPlace(
  world: World, p: ServerPlayer, nowSec: number, nowMs: number, events: GameEvent[],
): boolean {
  if (!p.inBuildMode || !p.alive) return false;
  if (nowSec - p.lastBuildAt < BUILD_COOLDOWN) return false;

  const matDef = MATERIALS[p.material] ?? MATERIALS[0];
  if (p.mats < matDef.cost) return false;

  const target = resolvePlacement(p, world);
  if (!target) return false;
  if (placementIssue(p,target,world)) return false;
  const { gx, gy, gz, slot, facing } = target;

  if (!inGridBounds(gx, gy, gz)) return false;
  if (world.pieces.has(packKey(gx, gy, gz, slot))) return false;

  // Do not let a player build further than their reach.
  const cx = (gx + 0.5) * TILE;
  const cy = (gy + 0.5) * TILE;
  const cz = (gz + 0.5) * TILE;
  if (Math.hypot(cx - p.x, cy - (p.y + EYE_HEIGHT), cz - p.z) > BUILD_RANGE) return false;

  const piece = makePiece(gx, gy, gz, slot, p.material, facing, p.id, nowSec);
  world.set(piece);
  p.mats -= matDef.cost;
  p.lastBuildAt = nowSec;

  events.push({
    kind: EV_PIECE_ADD, key: piece.key, mat: piece.mat,
    facing: piece.facing, owner: p.id, placedAtMs: nowMs,
  });
  return true;
}
