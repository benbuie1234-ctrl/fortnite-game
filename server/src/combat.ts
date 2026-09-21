import {
  EYE_HEIGHT, MAX_LAG_COMP_MS, INTERP_DELAY_MS, BUILD_COOLDOWN, BUILD_RANGE,
  MATERIALS, TILE,
} from "@shared/constants";
import { makePiece, inGridBounds, currentHp, packKey, SLOT_SHIELD } from "@shared/build";
import { World, rayVsBox, type RayHit } from "@shared/world";
import {
  weaponById, damageAtRange, W_PICKAXE, W_SNIPER,
  spreadFor, pieceDamage, traceWithDrop,
} from "@shared/weapons";
import { eyeHeightFor } from "@shared/sim";
import { forwardVector, applySpread } from "@shared/vec";
import {
  EV_PIECE_ADD, EV_PIECE_REMOVE, EV_PIECE_DAMAGE, EV_SHOT, EV_HIT, EV_FOLIAGE, EV_CRITTER,
} from "@shared/protocol";
import type { GameEvent } from "@shared/snapshot";
import { ServerPlayer, hitBoxes } from "./player";
import { resolvePlacement, placementIssue, BUILD_SHIELD } from "@shared/placement";
import { cameraPose } from "@shared/camera";
import { ARENA_OWNER, treeIndexFromKey } from "@shared/arena";
import { critterHit, critterHeal, CritterState } from "@shared/critters";
import { PLAYER_MAX_HP } from "@shared/constants";

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
  critters?: CritterState,
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

  // The crosshair sits on an over-the-shoulder camera, not on the muzzle, so
  // the shot has to be re-aimed at whatever the camera ray actually meets or
  // every round lands beside the thing under the reticle.
  if (weapon.id !== W_PICKAXE) {
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
  const spread = spreadFor(weapon, shooter.aiming, shooter.bloom);

  /**
   * Fly one pellet from a point in a direction, and report what it met.
   *
   * Pulled out of the loop below because a shot can now be sent back the way
   * it came: a shield panel reflects it, and the returned leg has to be traced
   * with exactly the same rules as the first one -- same drop, same lag
   * compensation, same hit order -- or a reflected round would behave like a
   * different weapon.
   */
  function tracePellet(
    px: number, py: number, pz: number,
    dx: number, dy: number, dz: number,
    range: number,
    /** Who this leg may hit. The shooter is a legal target on a reflection. */
    canHitShooter: boolean,
  ) {
    let pieceHit: RayHit | null = null;
    let hitPlayer: ServerPlayer | null = null;
    let hitCritter = -1;
    let hitHead = false;

    // Segmented so the round can drop. Inside the flat zone this is identical
    // to a straight raycast; past it the path bends and the hit tests follow.
    const shot = traceWithDrop(
      px, py, pz, dx, dy, dz, range,
      (x, y, z, sx, sy, sz, segment) => {
        let nearest = segment;
        let found = false;

        const piece = world.raycast(x, y, z, sx, sy, sz, segment, nowSec);
        if (piece && piece.t <= nearest) {
          nearest = piece.t; pieceHit = piece; hitPlayer = null; hitCritter = -1; found = true;
        }

        for (const target of players) {
          if (!target.alive) continue;
          if (target.id === shooter.id && !canHitShooter) continue;
          const p = target.positionAt(rewindTo);
          const { body, head } = hitBoxes(p.x, p.y, p.z, target.crouch);

          const headHit = rayVsBox(head, x, y, z, sx, sy, sz);
          if (headHit && headHit.t <= nearest) {
            nearest = headHit.t; hitPlayer = target; hitHead = true; pieceHit = null; hitCritter = -1; found = true;
          }
          const bodyHit = rayVsBox(body, x, y, z, sx, sy, sz);
          if (bodyHit && bodyHit.t <= nearest) {
            nearest = bodyHit.t; hitPlayer = target; hitHead = false; pieceHit = null; hitCritter = -1; found = true;
          }
        }

        // Wildlife is tested at the same rewound instant as players, because
        // the client draws it at the same instant too -- a bird evaluated at
        // "now" on the server would sit half a round trip ahead of the one the
        // shooter was actually looking at.
        if (critters) {
          const critter = critterHit(
            x, y, z, sx, sy, sz, nearest, rewindTo / 1000,
            (i) => critters.alive(i, nowSec),
          );
          if (critter) {
            nearest = critter.t; hitCritter = critter.index;
            pieceHit = null; hitPlayer = null; found = true;
          }
        }
        return found ? nearest : null;
      },
    );
    return {
      shot,
      victim: hitPlayer as ServerPlayer | null,
      struck: pieceHit as RayHit | null,
      critter: hitCritter,
      head: hitHead,
    };
  }

  for (let pellet = 0; pellet < weapon.pellets; pellet++) {
    let [dx, dy, dz] = applySpread(baseDir, spread, Math.random);
    let px = ox, py = oy, pz = oz;
    let range = weapon.range;
    // Distance already flown, so damage falloff prices the WHOLE path a
    // reflected round took rather than restarting at zero after the bounce.
    let flown = 0;
    let reflected = false;

    // At most one bounce. Two shields facing each other would otherwise be a
    // loop, and a round that has been round the houses twice is not something
    // any player could reason about anyway.
    for (let leg = 0; leg < 2; leg++) {
      const { shot, victim, struck, critter, head } =
        tracePellet(px, py, pz, dx, dy, dz, range, reflected);

      events.push({
        kind: EV_SHOT, shooter: shooter.id, weapon: weapon.id,
        ox: px, oy: py, oz: pz,
        ex: shot.x, ey: shot.y, ez: shot.z,
        hit: victim || critter >= 0 ? 2 : (struck ? 1 : 0),
      });

      // A shield throws the round back instead of stopping it, and takes
      // nothing for doing so -- bullets are what it is for. It still falls to
      // a pickaxe, and it expires on its own; see MatchRoom.
      if (!victim && critter < 0 && struck && struck.piece.slot === SLOT_SHIELD
          && leg === 0 && weapon.id !== W_PICKAXE) {
        // Straight back down the path it came in on, not a mirror bounce off
        // the panel's normal.
        //
        // A real mirror is the obvious implementation and it makes the item
        // look broken. The crosshair sits on an over-the-shoulder camera, so a
        // shot converges on its aim point at about two degrees off the
        // shooter's own axis; mirrored off a flat panel that returns a round
        // most of a metre wide of them, every time. "Reflects bullets back"
        // means back at the person who fired, so that is what it does -- it is
        // a slab of hard light, and it can be a corner reflector if it likes.
        dx = -dx; dy = -dy; dz = -dz;
        // Start clear of the panel, or the new leg immediately hits it again.
        px = shot.x + dx * 0.05;
        py = shot.y + dy * 0.05;
        pz = shot.z + dz * 0.05;
        flown += shot.t;
        range = Math.max(0, range - shot.t);
        reflected = true;
        if (range <= 0.1) break;
        continue;
      }

      if (victim) {
        // Falloff is measured along the path travelled, not the straight-line
        // distance, so a long arcing shot is priced at what it actually flew.
        let dmg = damageAtRange(weapon, flown + shot.t);
        if (head) dmg *= weapon.headMult;
        // A reflected round is nobody's shot. Crediting it to the person who
        // pulled the trigger would mean walking into your own bullet counts as
        // a kill for you; crediting it to the shield's owner would turn a
        // placed panel into a kill farm. It kills, and it feeds the kill feed
        // as an accident.
        applyPlayerDamage(victim, dmg, reflected ? null : shooter, nowSec);
        events.push({
          kind: EV_HIT, target: victim.id,
          shooter: reflected ? 255 : shooter.id,
          damage: Math.round(dmg), headshot: head ? 1 : 0,
        });
      } else if (critter >= 0 && critters) {
        // Shooting wildlife pays out health, which is the whole point of it:
        // something to do between fights that is worth interrupting a fight for.
        critters.down(critter, nowSec);
        const heal = critterHeal(critter);
        if (!reflected) {
          shooter.hp = Math.min(PLAYER_MAX_HP, shooter.hp + heal);
          events.push({ kind: EV_CRITTER, index: critter, shooter: shooter.id, heal });
        } else {
          events.push({ kind: EV_CRITTER, index: critter, shooter: 255, heal: 0 });
        }
      } else if (struck) {
        damagePiece(world, struck.piece.key, pieceDamage(weapon, struck.piece.mat), nowSec, events, shooter);
        // Shooting a tree knocks its leaves off. The trunk is indestructible
        // cover either way; what changes is that everyone can now see through
        // the canopy, so hiding in one stops being free once you fire from it.
        const tree = treeIndexFromKey(struck.piece.key);
        if (tree >= 0) events.push({ kind: EV_FOLIAGE, index: tree });
      }
      break;
    }
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
  // A shield eats bullets for a living, so a bullet must not wear it down --
  // otherwise the reflection is just a slower way of breaking it. A pickaxe
  // still takes it apart, which is the counter-play.
  if (piece.slot === SLOT_SHIELD && (!source || source.weaponId !== W_PICKAXE)) return;

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

  // The shield costs nothing and is limited by count instead. Charging for it
  // as well would make it a thing players hoard and never actually use.
  const shield = p.buildSlot === BUILD_SHIELD;
  if (shield && p.shieldUsed) return false;
  const matDef = MATERIALS[p.material] ?? MATERIALS[0];
  if (!shield && p.mats < matDef.cost) return false;

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
  if (shield) p.shieldUsed = true;
  else p.mats -= matDef.cost;
  p.lastBuildAt = nowSec;

  events.push({
    kind: EV_PIECE_ADD, key: piece.key, mat: piece.mat,
    facing: piece.facing, owner: p.id, placedAtMs: nowMs,
  });
  return true;
}
