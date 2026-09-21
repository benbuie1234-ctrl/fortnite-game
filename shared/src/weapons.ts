import {
  MATERIALS, BULLET_DROP_START, BULLET_DROP_RATE, BULLET_SEGMENT,
} from "./constants";

export interface WeaponDef {
  readonly id: number;
  readonly name: string;
  readonly damage: number;
  readonly headMult: number;
  /** Seconds between shots. */
  readonly fireInterval: number;
  readonly auto: boolean;
  readonly pellets: number;
  readonly magSize: number;
  readonly reloadTime: number;
  /** Cone half-angle in radians, hip and aimed. */
  readonly spreadHip: number;
  readonly spreadAds: number;
  readonly range: number;
  /** Damage falls from 1.0 to falloffMult between these distances. */
  readonly falloffStart: number;
  readonly falloffEnd: number;
  readonly falloffMult: number;
  /** Multiplier applied when the shot lands on a build piece. */
  readonly buildDamage: number;
  /** FOV multiplier while aiming. 1 = no zoom. */
  readonly adsZoom: number;
  /** Seconds of recoil kick applied to the view. */
  readonly recoil: number;
}

export const W_AR = 0;
export const W_SHOTGUN = 1;
export const W_SNIPER = 2;
export const W_SMG = 3;
export const W_PISTOL = 4;
export const W_PICKAXE = 5;

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: W_AR, name: "Assault Rifle",
    damage: 33, headMult: 1.75, fireInterval: 0.15, auto: true, pellets: 1,
    magSize: 30, reloadTime: 2.3,
    spreadHip: 0.035, spreadAds: 0.006,
    range: 150, falloffStart: 50, falloffEnd: 110, falloffMult: 0.7,
    buildDamage: 1.0, adsZoom: 1.3, recoil: 0.9,
  },
  {
    id: W_SHOTGUN, name: "Pump Shotgun",
    damage: 11, headMult: 1.5, fireInterval: 0.9, auto: false, pellets: 9,
    magSize: 5, reloadTime: 3.4,
    spreadHip: 0.075, spreadAds: 0.055,
    range: 40, falloffStart: 6, falloffEnd: 22, falloffMult: 0.35,
    buildDamage: 1.1, adsZoom: 1.1, recoil: 2.4,
  },
  {
    id: W_SNIPER, name: "Bolt-Action",
    damage: 80, headMult: 2.5, fireInterval: 1.5, auto: false, pellets: 1,
    magSize: 1, reloadTime: 2.6,
    spreadHip: 0.09, spreadAds: 0.0,
    // Used to have no falloff at all, so a 300 m body shot hit exactly as hard
    // as a point-blank one. It still reaches further and hits harder than
    // anything else; it just no longer ignores distance entirely.
    range: 400, falloffStart: 90, falloffEnd: 260, falloffMult: 0.72,
    buildDamage: 1.3, adsZoom: 3.2, recoil: 3.0,
  },
  {
    id: W_SMG, name: "SMG",
    damage: 17, headMult: 1.5, fireInterval: 0.08, auto: true, pellets: 1,
    magSize: 30, reloadTime: 2.1,
    spreadHip: 0.055, spreadAds: 0.022,
    range: 80, falloffStart: 20, falloffEnd: 55, falloffMult: 0.55,
    buildDamage: 1.4, adsZoom: 1.15, recoil: 0.5,
  },
  {
    id: W_PISTOL, name: "Pistol",
    damage: 24, headMult: 2.0, fireInterval: 0.25, auto: false, pellets: 1,
    magSize: 16, reloadTime: 1.5,
    spreadHip: 0.03, spreadAds: 0.004,
    range: 120, falloffStart: 35, falloffEnd: 80, falloffMult: 0.65,
    buildDamage: 0.9, adsZoom: 1.25, recoil: 1.1,
  },
  {
    id: W_PICKAXE, name: "Pickaxe",
    damage: 20, headMult: 1.0, fireInterval: 0.55, auto: true, pellets: 1,
    magSize: Infinity, reloadTime: 0,
    spreadHip: 0, spreadAds: 0,
    range: 3.2, falloffStart: 999, falloffEnd: 999, falloffMult: 1,
    buildDamage: 5.0, adsZoom: 1.0, recoil: 0.3,
  },
];

export function weaponById(id: number): WeaponDef {
  return WEAPONS[id] ?? WEAPONS[W_AR];
}

/** Damage after distance falloff. */
export function damageAtRange(w: WeaponDef, dist: number): number {
  if (dist <= w.falloffStart) return w.damage;
  if (dist >= w.falloffEnd) return w.damage * w.falloffMult;
  const t = (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart);
  return w.damage * (1 + (w.falloffMult - 1) * t);
}

/** Loadout every player spawns with in the arena mode. */
export const ARENA_LOADOUT: readonly number[] = [
  W_PICKAXE, W_SHOTGUN, W_AR, W_SMG, W_SNIPER,
];


// ---------------------------------------------------------------------------
// Structure damage
// ---------------------------------------------------------------------------

/**
 * Sniper rounds against build materials, as a fraction of that material's full
 * HP: one shot takes wood down, leaves brick a hair from breaking, and takes
 * half off metal.
 *
 * Written as fractions rather than damage multipliers on purpose. A multiplier
 * only holds the rule for as long as nobody retunes MATERIALS; a fraction of
 * max HP means the rule survives that.
 */
export const SNIPER_MATERIAL_FRACTION: readonly number[] = [1.0, 0.99, 0.5];

/**
 * Damage one shot does to a build piece.
 *
 * Deliberately NOT distance-scaled. Falloff models a bullet losing energy
 * against a body; a wall does not care how far away the shooter stood, and
 * making structure damage fall off would mean a sniper stops one-shotting wood
 * at exactly the range a sniper is for.
 */
export function pieceDamage(w: WeaponDef, mat: number): number {
  if (w.id === W_SNIPER) {
    const def = MATERIALS[mat] ?? MATERIALS[0];
    const fraction = SNIPER_MATERIAL_FRACTION[mat] ?? 1;
    // The nudge on the one-shot case covers the grow-in rounding, so a fresh
    // wall is never left standing on a fractional hit point.
    return def.maxHp * fraction + (fraction >= 1 ? 1 : 0);
  }
  return w.damage * w.buildDamage;
}

// ---------------------------------------------------------------------------
// Ballistics
// ---------------------------------------------------------------------------

/**
 * Cone half-angle for a shot, in radians.
 *
 * Just the weapon's own figure. A movement-driven bloom term used to be added
 * on top; it tripled the effective cone at its ceiling and took the crosshair
 * with it, which made every gun feel wildly inaccurate. Spread is back to the
 * per-weapon values, which are the ones the weapons were tuned around.
 */
export function spreadFor(w: WeaponDef, aiming: boolean): number {
  return aiming ? w.spreadAds : w.spreadHip;
}

/**
 * Trace a shot as a chain of straight segments with gravity applied between
 * them, instead of one infinite straight line.
 *
 * Shots stay perfectly flat out to BULLET_DROP_START, so nothing about close
 * and mid range changes; past that the path bends and long shots have to be
 * led high. `visit` gets each segment and returns the hit distance along it,
 * or null to keep going. The distance returned is measured along the path,
 * which is what damage falloff should use.
 */
export function traceWithDrop(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  visit: (
    x: number, y: number, z: number,
    sx: number, sy: number, sz: number,
    length: number, travelled: number,
  ) => number | null,
): { t: number; x: number; y: number; z: number; hit: boolean } {
  let x = ox, y = oy, z = oz;
  let vx = dx, vy = dy, vz = dz;
  let travelled = 0;

  while (travelled < maxDist) {
    const length = Math.min(BULLET_SEGMENT, maxDist - travelled);
    const hit = visit(x, y, z, vx, vy, vz, length, travelled);
    if (hit !== null) {
      return {
        t: travelled + hit,
        x: x + vx * hit, y: y + vy * hit, z: z + vz * hit,
        hit: true,
      };
    }
    x += vx * length;
    y += vy * length;
    z += vz * length;
    travelled += length;

    // Gravity only engages past the flat zone, and is integrated per metre
    // travelled rather than per second so the path does not depend on tick rate.
    if (travelled > BULLET_DROP_START) {
      const bend = BULLET_DROP_RATE * (travelled - BULLET_DROP_START) * length;
      vy -= bend;
      const norm = Math.hypot(vx, vy, vz);
      if (norm > 1e-9) { vx /= norm; vy /= norm; vz /= norm; }
    }
  }
  // A miss still has to report where the round ended up, or the tracer has
  // nowhere to draw to.
  return { t: travelled, x, y, z, hit: false };
}
