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
    range: 400, falloffStart: 400, falloffEnd: 400, falloffMult: 1.0,
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
