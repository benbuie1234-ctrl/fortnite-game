import {
  EYE_HEIGHT, MAX_LAG_COMP_MS, INTERP_DELAY_MS, BUILD_COOLDOWN, BUILD_RANGE,
  MATERIALS, TILE,
} from "@shared/constants";
import { makePiece, inGridBounds, currentHp, packKey } from "@shared/build";
import { World, rayVsBox } from "@shared/world";
import { weaponById, damageAtRange, W_PICKAXE } from "@shared/weapons";
import { forwardVector, applySpread } from "@shared/vec";
import {
  EV_PIECE_ADD, EV_PIECE_REMOVE, EV_PIECE_DAMAGE, EV_SHOT, EV_HIT,
} from "@shared/protocol";
import type { GameEvent } from "@shared/snapshot";
import { ServerPlayer, hitBoxes } from "./player";
import { resolvePlacement } from "@shared/placement";
import { ARENA_OWNER } from "@shared/arena";

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
  const oy = shooter.y + EYE_HEIGHT;
  const oz = shooter.z;
  const baseDir = forwardVector(shooter.yaw, shooter.pitch);
  const spread = shooter.aiming ? weapon.spreadAds : weapon.spreadHip;

  for (let pellet = 0; pellet < weapon.pellets; pellet++) {
    const dir = applySpread(baseDir, spread, Math.random);
    const [dx, dy, dz] = dir;

    const pieceHit = world.raycast(ox, oy, oz, dx, dy, dz, weapon.range, nowSec);
    let bestT = pieceHit ? pieceHit.t : weapon.range;

    let hitPlayer: ServerPlayer | null = null;
    let hitHead = false;

    for (const target of players) {
      if (target.id === shooter.id || !target.alive) continue;
      const p = target.positionAt(rewindTo);
      const { body, head } = hitBoxes(p.x, p.y, p.z);

      const headHit = rayVsBox(head, ox, oy, oz, dx, dy, dz);
      if (headHit && headHit.t < bestT) {
        bestT = headHit.t; hitPlayer = target; hitHead = true;
      }
      const bodyHit = rayVsBox(body, ox, oy, oz, dx, dy, dz);
      if (bodyHit && bodyHit.t < bestT) {
        bestT = bodyHit.t; hitPlayer = target; hitHead = false;
      }
    }

    if (hitPlayer) {
      let dmg = damageAtRange(weapon, bestT);
      if (hitHead) dmg *= weapon.headMult;
      applyPlayerDamage(hitPlayer, dmg, shooter, nowSec);
      events.push({
        kind: EV_HIT, target: hitPlayer.id, shooter: shooter.id,
        damage: Math.round(dmg), headshot: hitHead ? 1 : 0,
      });
    } else if (pieceHit && bestT === pieceHit.t) {
      const dmg = damageAtRange(weapon, bestT) * weapon.buildDamage;
      damagePiece(world, pieceHit.piece.key, dmg, nowSec, events, shooter);
    }

    events.push({
      kind: EV_SHOT, shooter: shooter.id, weapon: weapon.id,
      ox, oy, oz,
      ex: ox + dx * bestT, ey: oy + dy * bestT, ez: oz + dz * bestT,
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

  const target = resolvePlacement(p);
  if (!target) return false;
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
