/**
 * Skin catalogue. Deliberately pure data and pure colour: every skin is the
 * same low-poly mesh recoloured, so adding one costs nothing at runtime and
 * there is no asset pipeline to feed.
 *
 * `price` is in cents. A price of 0 means the skin is free to everyone. Paid
 * skins are unlocked server-side after a Stripe webhook confirms payment, so
 * a modified client cannot grant itself one.
 */
export interface SkinDef {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly rarity: "free" | "rare" | "epic" | "legendary";
  readonly colors: {
    readonly primary: number;   // torso
    readonly secondary: number; // legs
    readonly accent: number;    // arms / trim
    readonly skin: number;      // head
    readonly visor: number;     // face stripe
  };
}

export const SKINS: readonly SkinDef[] = [
  {
    id: "default", name: "Recruit", price: 0, rarity: "free",
    colors: { primary: 0x3f6fb5, secondary: 0x2b3a52, accent: 0xd9a066, skin: 0xe8b98a, visor: 0x1c2534 },
  },
  {
    id: "forest", name: "Ranger", price: 0, rarity: "free",
    colors: { primary: 0x4a6b3f, secondary: 0x33452c, accent: 0x8a9a5b, skin: 0xd9a066, visor: 0x22301f },
  },
  {
    id: "ember", name: "Ember", price: 299, rarity: "rare",
    colors: { primary: 0xd2542e, secondary: 0x5c2318, accent: 0xffa53d, skin: 0xe8b98a, visor: 0x2a0f0a },
  },
  {
    id: "frost", name: "Glacier", price: 299, rarity: "rare",
    colors: { primary: 0x6fb7d8, secondary: 0x2f5a73, accent: 0xd8f0ff, skin: 0xf0d5be, visor: 0x12303a },
  },
  {
    id: "void", name: "Void Runner", price: 499, rarity: "epic",
    colors: { primary: 0x4b2d7a, secondary: 0x241340, accent: 0xb96bff, skin: 0xc9a9e8, visor: 0x0d0618 },
  },
  {
    id: "gold", name: "Midas Touch", price: 799, rarity: "legendary",
    colors: { primary: 0xd4a017, secondary: 0x8a6508, accent: 0xffe27a, skin: 0xf2d9a0, visor: 0x3a2a05 },
  },
];

export const DEFAULT_SKIN = SKINS[0];

export function skinById(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? DEFAULT_SKIN;
}

export function isFreeSkin(id: string): boolean {
  return skinById(id).price === 0;
}
