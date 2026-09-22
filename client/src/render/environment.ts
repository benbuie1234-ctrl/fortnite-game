import * as THREE from 'three';
import { BUILDINGS, PROPS, ROADS, DOCK, ARCHITECTURE, terrainHeight, buildingFootprint, Building } from '@shared/map';
import { TILE } from '@shared/constants';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Spatially batched architectural kit: PBR materials, trim, siding, porches,
 * dormers, chimneys, storefront awnings, roof parapets, and industrial fittings.
 */
class Kit {
  private batches = new Map<string, {
    geo: THREE.BufferGeometry;
    mat: THREE.MeshStandardMaterial;
    items: { matrix: THREE.Matrix4; color: THREE.Color }[];
  }>();

  private cube = new THREE.BoxGeometry(1, 1, 1);
  private round = new RoundedBoxGeometry(1, 1, 1, 2, 0.07);
  private cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
  private stone = new THREE.IcosahedronGeometry(0.5, 1);

  private matte = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, envMapIntensity: 0.65 });
  private metal = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.55, envMapIntensity: 0.85 });
  private glass = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.18, metalness: 0.25, envMapIntensity: 1.1, transparent: true, opacity: 0.85 });
  private wood = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0.02, envMapIntensity: 0.6 });

  add(
    x: number, y: number, z: number,
    w: number, h: number, d: number,
    color: number,
    shape: 'box' | 'round' | 'stone' | 'cylinder' = 'box',
    yaw = 0,
    finish: 'matte' | 'metal' | 'glass' | 'wood' = 'matte',
    roll = 0,
  ): void {
    const key = `${Math.floor(x / 48)},${Math.floor(z / 48)},${shape},${finish}`;
    const geo = shape === 'box' ? this.cube : shape === 'round' ? this.round : shape === 'cylinder' ? this.cylinder : this.stone;
    const mat = finish === 'metal' ? this.metal : finish === 'glass' ? this.glass : finish === 'wood' ? this.wood : this.matte;
    const b = this.batches.get(key) ?? { geo, mat, items: [] };
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, roll));
    b.items.push({
      matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, h, d)),
      color: new THREE.Color(color),
    });
    this.batches.set(key, b);
  }

  finish(scene: THREE.Scene): void {
    for (const b of this.batches.values()) {
      const m = new THREE.InstancedMesh(b.geo, b.mat, b.items.length);
      b.items.forEach((p, i) => {
        m.setMatrixAt(i, p.matrix);
        m.setColorAt(i, p.color);
      });
      m.computeBoundingSphere();
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    }
  }
}

// Color palettes
const trim = 0xf2ece1;
const timber = 0x684e3a;
const darkTimber = 0x483526;
const iron = 0x364852;
const darkMetal = 0x222a30;
const glass = 0x5b8a9b;
const brickRed = 0xb25842;
const stoneGrey = 0x8a8a8e;
const barnRed = 0xa42d24;
const gasYellow = 0xf5b800;
const gasRed = 0xd83020;

export function createEnvironment(scene: THREE.Scene): void {
  const k = new Kit();

  // Solid architecture panels from map data (door/window frames)
  for (const p of ARCHITECTURE) {
    k.add(p.x, p.y, p.z, p.w, p.h, p.d, p.color);
  }

  BUILDINGS.forEach((b: Building, index: number) => {
    const x = b.x * TILE, z = b.z * TILE, y = b.base * TILE;
    const w = b.w * TILE, d = b.d * TILE, h = b.floors * TILE;
    const theme = b.theme ?? b.style;
    const doorX = x + (Math.floor(b.w / 2) + 0.5) * TILE;

    // --- 1. Sidewalks & Paved Plazas ---
    if (theme !== 'alpine_cabin' && theme !== 'bunker_shelter' && theme !== 'quarry_office') {
      const curbH = 0.08;
      for (const zz of [z - 0.9, z + d + 0.9]) {
        k.add(x + w / 2, y + curbH / 2, zz, w + 2.4, curbH, 1.8, 0xb8b8a8);
      }
      for (const xx of [x - 0.9, x + w + 0.9]) {
        k.add(xx, y + curbH / 2, z + d / 2, 1.8, curbH, d, 0xb8b8a8);
      }
      // Sidewalk expansion lines
      for (let q = 0; q <= w; q += 1.8) {
        for (const zz of [z - 0.9, z + d + 0.9]) {
          k.add(x + q, y + curbH + 0.005, zz, 0.03, 0.01, 1.75, 0x82847c);
        }
      }
    }

    // Material framing selection
    const isWood = b.style === 'cabin' || theme === 'red_barn' || theme === 'alpine_cabin' || theme === 'lookout_tower';
    const isIndustrial = b.style === 'warehouse' || theme === 'harbor_warehouse' || theme === 'dock_shack';
    const isCastle = theme === 'citadel_castle' || theme === 'church';
    const frameColor = isWood ? timber : isIndustrial ? iron : isCastle ? stoneGrey : trim;

    const face = (
      side: number, u: number, v: number, su: number, sv: number, depth: number,
      color: number, finish: 'matte' | 'metal' | 'glass' | 'wood' = 'matte',
    ) => {
      if (side < 2) {
        k.add(x + u, y + v, z + (side === 0 ? -0.17 : d + 0.17), su, sv, depth, color, 'box', 0, finish);
      } else {
        k.add(x + (side === 2 ? -0.17 : w + 0.17), y + v, z + u, depth, sv, su, color, 'box', 0, finish);
      }
    };

    // --- 2. Facades, Window Trim, Siding & Wall Detailing ---
    for (let side = 0; side < 4; side++) {
      const cells = side < 2 ? b.w : b.d;
      const length = cells * TILE;

      // Floor dividing belt courses / cornices
      for (let f = 1; f <= b.floors; f++) {
        face(side, length / 2, f * TILE - 0.20, length + 0.5, 0.32, 0.45, frameColor);
        face(side, length / 2, f * TILE - 0.52, length + 0.2, 0.14, 0.30, isWood ? darkTimber : 0x9e9a8b);
      }

      // Per-cell window and wall articulation
      for (let f = 0; f < b.floors; f++) {
        for (let c = 0; c < cells; c++) {
          const open = side < 2 ? (f === 0 ? c === Math.floor(b.w / 2) : c % 3 === 1) : c % 3 === 1;
          const center = (c + 0.5) * TILE;
          const base = f * TILE;

          if (open) {
            // Door / large opening frames
            const door = side < 2 && f === 0;
            const opening = door ? 2.4 : TILE - 1.8;
            const low = door ? 0 : 1.1;
            const high = door ? 3.3 : TILE - 1.4;

            for (const s of [-1, 1]) {
              face(side, center + s * (opening / 2 + 0.06), base + (low + high) / 2, 0.18, high - low + 0.2, 0.42, frameColor);
            }
            face(side, center, base + high + 0.08, opening + 0.36, 0.18, 0.44, frameColor);
            if (!door) {
              face(side, center, base + low - 0.05, opening + 0.44, 0.20, 0.58, frameColor);
            }
            continue;
          }

          // Wall face texture relief
          face(side, center, base + 0.28, TILE - 0.12, 0.35, 0.30, frameColor);

          if (theme === 'red_barn') {
            // Red barn horizontal wood siding
            for (let v = 0.5; v < TILE - 0.5; v += 0.45) {
              face(side, center, base + v, TILE - 0.08, 0.07, 0.26, barnRed, 'wood');
            }
            // Characteristic white X-bracing on lower wall
            face(side, center, base + TILE * 0.45, 0.15, TILE * 0.85, 0.28, trim, 'wood');
          } else if (isWood) {
            // Horizontal timber logs
            for (let v = 0.65; v < TILE - 0.6; v += 0.48) {
              face(side, center, base + v, TILE - 0.08, 0.08, 0.28, timber, 'wood');
            }
          } else if (isIndustrial) {
            // Corrugated vertical metal ribbing
            for (let u = 0.3; u < TILE; u += 0.55) {
              face(side, c * TILE + u, base + TILE / 2, 0.08, TILE - 0.6, 0.28, 0x647e85, 'metal');
            }
          } else if (isCastle) {
            // Heavy stone block ashlar relief
            for (let v = 0.8; v < TILE - 0.6; v += 0.7) {
              face(side, center, base + v, TILE - 0.15, 0.08, 0.32, 0x767570, 'matte');
            }
          } else {
            // Residential clapboard siding
            for (let v = 0.6; v < TILE - 0.5; v += 0.32) {
              face(side, center, base + v, TILE - 0.12, 0.04, 0.25, 0xb8b09d, 'matte');
            }
          }

          // Inset glazed windows with frames & mullions
          const wh = isIndustrial ? 1.2 : 2.2;
          const ww = isIndustrial ? TILE * 0.68 : 2.5;
          const wy = base + (isIndustrial ? 4.5 : 3.35);

          face(side, center, wy, ww + 0.35, wh + 0.35, 0.34, frameColor);
          face(side, center, wy, ww, wh, 0.38, glass, 'glass');
          // Window cross mullions
          face(side, center, wy, 0.09, wh, 0.42, frameColor);
          face(side, center, wy, ww, 0.09, 0.42, frameColor);
          // Window sill and header trim
          face(side, center, wy - wh / 2 - 0.2, ww + 0.58, 0.18, 0.65, frameColor);
          face(side, center, wy + wh / 2 + 0.2, ww + 0.42, 0.14, 0.45, frameColor);

          // Residential window shutters
          if (b.style === 'house' && theme !== 'red_barn') {
            for (const dir of [-1, 1]) {
              const shutterColor = index % 3 === 0 ? 0x466a64 : index % 3 === 1 ? 0x8a4e3c : 0x364858;
              face(side, center + dir * (ww / 2 + 0.48), wy, 0.52, wh + 0.12, 0.35, shutterColor, 'wood');
              for (let sl = 0; sl < 6; sl++) {
                face(side, center + dir * (ww / 2 + 0.48), wy - wh / 2 + sl * wh / 6, 0.46, 0.05, 0.41, trim);
              }
            }
          }
        }
      }

      // Vertical corner quoins & columns
      for (const u of [0.12, length - 0.12]) {
        face(side, u, h / 2, 0.26, h, 0.38, frameColor);
      }
      // Rain downspout on each building corner
      face(side, length - 0.45, h / 2, 0.09, h, 0.44, darkMetal, 'metal');
    }

    // --- 3. Front Porches & Entrance Porticos ---
    if (b.style === 'house' && theme !== 'red_barn') {
      const porchW = 3.8, porchD = 1.6, porchH = 3.1;
      // Porch floor slab
      k.add(doorX, y + 0.18, z - porchD / 2, porchW, 0.22, porchD, 0xd4c2a5, 'box', 0, 'wood');
      // Porch roof canopy
      k.add(doorX, y + porchH, z - porchD / 2, porchW + 0.4, 0.22, porchD + 0.3, frameColor);
      // Porch posts
      for (const px of [-porchW / 2 + 0.18, porchW / 2 - 0.18]) {
        k.add(doorX + px, y + porchH / 2 + 0.1, z - porchD + 0.15, 0.18, porchH - 0.2, 0.18, frameColor, 'round');
      }
      // Porch handrails and pickets
      for (const px of [-porchW / 2 + 0.18, porchW / 2 - 0.18]) {
        k.add(doorX + px, y + 0.95, z - porchD / 2, 0.08, 0.10, porchD - 0.4, frameColor);
        for (let rz = z - porchD + 0.4; rz < z - 0.2; rz += 0.35) {
          k.add(doorX + px, y + 0.6, rz, 0.06, 0.65, 0.06, frameColor);
        }
      }
      // Red brick chimney stack rising up the building side
      const chimX = x + w - 0.6, chimZ = z + d / 2;
      k.add(chimX, y + h / 2 + 1.5, chimZ, 1.2, h + 3.0, 1.2, brickRed, 'box', 0, 'matte');
      k.add(chimX, y + h + 3.1, chimZ, 1.4, 0.24, 1.4, stoneGrey, 'round');
    }

    // --- 4. Anarchy Red Barn Specific Features ---
    if (theme === 'red_barn') {
      // Overhanging hay hood beam at peak
      k.add(doorX, y + h + w / 2 + 0.5, z - 1.2, 0.25, 0.25, 2.4, timber, 'box', 0, 'wood');
      k.add(doorX, y + h + w / 2 + 0.1, z - 2.1, 0.1, 0.8, 0.1, iron, 'cylinder');
      // Grain silo beside the barn
      const siloX = x + w + 2.8, siloZ = z + d / 2, siloR = 2.2, siloH = h + 2.5;
      k.add(siloX, y + siloH / 2, siloZ, siloR * 2, siloH, siloR * 2, 0x8a9da2, 'cylinder', 0, 'metal');
      k.add(siloX, y + siloH + 0.6, siloZ, siloR * 1.9, 1.2, siloR * 1.9, 0x6e8085, 'stone', 0, 'metal');
    }

    // --- 5. Gas Station Features ---
    if (theme === 'gas_station') {
      const canW = w + 4, canD = 9, canH = 4.8;
      const canX = x + w / 2, canZ = z - 6.5;
      // Fuel canopy roof
      k.add(canX, y + canH, canZ, canW, 0.6, canD, 0xf0ede6, 'box', 0, 'metal');
      // Yellow and red brand fascia
      k.add(canX, y + canH + 0.12, canZ - canD / 2 - 0.04, canW + 0.08, 0.24, 0.08, gasYellow);
      k.add(canX, y + canH - 0.12, canZ - canD / 2 - 0.04, canW + 0.08, 0.24, 0.08, gasRed);
      k.add(canX, y + canH + 0.12, canZ + canD / 2 + 0.04, canW + 0.08, 0.24, 0.08, gasYellow);
      k.add(canX, y + canH - 0.12, canZ + canD / 2 + 0.04, canW + 0.08, 0.24, 0.08, gasRed);
      // Canopy steel columns
      for (const cx of [canX - canW * 0.35, canX + canW * 0.35]) {
        for (const cz of [canZ - canD * 0.3, canZ + canD * 0.3]) {
          k.add(cx, y + canH / 2, cz, 0.45, canH, 0.45, darkMetal, 'round', 0, 'metal');
          // Fuel pump islands
          k.add(cx, y + 0.22, cz, 1.2, 0.45, 2.6, 0xd0c8b6, 'round');
          // Gas pump unit
          k.add(cx, y + 1.25, cz, 0.75, 1.6, 1.1, gasRed, 'round');
          k.add(cx, y + 1.55, cz - 0.56, 0.45, 0.35, 0.06, 0x11161a, 'box', 0, 'glass');
        }
      }
      // Roadside price sign totem
      k.add(canX - canW / 2 - 3.5, y + 3.5, z - 8, 0.4, 7.0, 0.4, darkMetal, 'cylinder', 0, 'metal');
      k.add(canX - canW / 2 - 3.5, y + 5.5, z - 8, 2.8, 2.2, 0.5, gasYellow, 'round');
      k.add(canX - canW / 2 - 3.5, y + 4.8, z - 8, 2.2, 0.7, 0.55, gasRed, 'round');
    }

    // --- 6. Church / Chapel Features ---
    if (theme === 'church') {
      // Steeple / Belfry tower above the front entrance
      const belfryH = 9.0;
      k.add(doorX, y + h + belfryH / 2, z + 2.5, 3.2, belfryH, 3.2, stoneGrey, 'round');
      // Belfry louvers
      for (const side of [-1, 1]) {
        k.add(doorX + side * 1.65, y + h + belfryH * 0.65, z + 2.5, 0.1, 2.4, 1.8, darkTimber);
        k.add(doorX, y + h + belfryH * 0.65, z + 2.5 + side * 1.65, 1.8, 2.4, 0.1, darkTimber);
      }
      // Pyramid spire topped with cross
      k.add(doorX, y + h + belfryH + 3.0, z + 2.5, 2.8, 6.0, 2.8, 0x5a6369, 'stone');
      k.add(doorX, y + h + belfryH + 6.8, z + 2.5, 0.16, 1.6, 0.16, 0xd4b66f, 'box', 0, 'metal');
      k.add(doorX, y + h + belfryH + 7.2, z + 2.5, 1.1, 0.16, 0.16, 0xd4b66f, 'box', 0, 'metal');
      // Stone buttresses along church nave
      for (let bz = z + 1; bz <= z + d - 1; bz += 3.5) {
        for (const bx of [x - 0.45, x + w + 0.45]) {
          k.add(bx, y + h * 0.45, bz, 0.75, h * 0.9, 0.85, stoneGrey, 'round');
        }
      }
    }

    // --- 7. City High-Rise Rooftop & Cornice Details ---
    if (b.style === 'city') {
      // Rooftop parapet walls
      for (const zz of [z, z + d]) {
        k.add(x + w / 2, y + h + 0.45, zz, w + 0.4, 0.9, 0.35, trim);
      }
      for (const xx of [x, x + w]) {
        k.add(xx, y + h + 0.45, z + d / 2, 0.35, 0.9, d, trim);
      }

      // Ground-floor storefront canvas awnings
      for (let c = 0; c < b.w; c++) {
        if (c !== Math.floor(b.w / 2)) {
          const cx = x + (c + 0.5) * TILE;
          k.add(cx, y + 4.95, z - 0.8, TILE - 0.4, 0.16, 1.6, trim);
          for (let stripe = 0; stripe < 8; stripe++) {
            k.add(
              cx - TILE / 2 + 0.45 + stripe * 0.65,
              y + 4.77, z - 1.55,
              0.35, 0.40, 0.08,
              index % 2 === 0 ? 0x4d8a91 : 0xbc6d54,
            );
          }
        }
      }

      // Rooftop HVAC units, ducting, and water towers on taller blocks
      if (b.floors >= 3) {
        const hvacX = x + w * 0.3, hvacZ = z + d * 0.4;
        k.add(hvacX, y + h + 1.2, hvacZ, 3.2, 1.8, 2.2, 0x829496, 'round', 0, 'metal');
        // Dual exhaust fans
        for (const ox of [-0.8, 0.8]) {
          k.add(hvacX + ox, y + h + 2.15, hvacZ, 1.1, 0.1, 1.1, darkMetal, 'cylinder', 0, 'metal');
        }
        // Metal elevator overrun penthouse
        k.add(x + w * 0.7, y + h + 1.8, z + d * 0.7, 3.0, 3.4, 2.8, 0x939ba0, 'box', 0, 'metal');
      }
    }

    // --- 8. Pitched Roof Rakes & Fascias (House / Cabin) ---
    if (isWood || b.style === 'house') {
      for (let zi = 0; zi <= d; zi += 0.75) {
        for (let side = 0; side < 2; side++) {
          const run = w / 2;
          k.add(
            x + (side === 0 ? run / 2 : w - run / 2),
            y + h + run / 2 + 0.12,
            z + zi,
            Math.SQRT2 * run, 0.12, 0.10,
            isWood ? 0x564942 : 0x754f49,
            'box', 0, 'matte',
            side === 0 ? Math.PI / 4 : -Math.PI / 4,
          );
        }
      }
      // Roof ridge board cap
      k.add(x + w / 2, y + h + w / 2 + 0.14, z + d / 2, 0.28, 0.28, d + 0.5, isWood ? timber : 0xb67c5c, 'round');
    }

    // --- 9. Exterior Doorway Lamps ---
    for (const s of [-1, 1]) {
      k.add(doorX + s * (TILE / 2 + 0.35), y + 3.4, z - 0.38, 0.24, 0.72, 0.36, iron, 'round');
      k.add(doorX + s * (TILE / 2 + 0.35), y + 3.4, z - 0.58, 0.16, 0.46, 0.10, 0xffdc95);
    }

    // --- 10. Building Display Signboards ---
    const signTitle = b.name ?? (
      b.style === 'city'
        ? ['CORNER MARKET', 'ATLAS WORKS', 'THE POST', 'METRO LOFTS', 'SKYLINE TOWER'][index % 5]
        : isIndustrial
        ? 'TIDAL FREIGHT'
        : isWood
        ? 'PINEWATCH'
        : `NO. ${101 + index}`
    );
    sign(
      scene, signTitle,
      doorX, y + TILE - 0.65, z - 0.42,
      b.style === 'house' ? 1.4 : 4.6, 0.68,
      isIndustrial ? iron : theme === 'red_barn' ? barnRed : 0x365561,
    );
  });

  // --- 11. Props & Furniture Physics Geometry Detailing ---
  for (const p of PROPS) {
    if (!p.kind || p.kind === 'crate') continue;
    const { x, y, z, w, h, d } = p;

    if (p.kind === 'fence') {
      for (let dz = -d / 2 + 0.18; dz < d / 2; dz += 0.55) {
        k.add(x, y + h / 2, z + dz, w, h, 0.18, trim, 'round');
      }
      for (const v of [0.25, 0.7]) {
        k.add(x, y + h * v, z, w * 0.65, 0.12, d, 0xd0bea0);
      }
    } else if (p.kind === 'bench') {
      for (const dx of [-0.32, 0, 0.32]) {
        k.add(x + dx, y + h - 0.12, z, 0.26, 0.18, d, 0x9a7351, 'round');
      }
      for (const dz of [-d * 0.36, d * 0.36]) {
        k.add(x, y + h / 2, z + dz, w * 0.7, h, 0.16, iron);
      }
    } else if (p.kind === 'clock') {
      // Citadel Grand Clocktower
      k.add(x, y + h / 2, z, w * 0.88, h, d * 0.88, 0xcdbb9b);
      for (const v of [0.2, 0.6, 8.7, 11.7]) {
        k.add(x, y + v, z, w, 0.25, d, trim, 'round');
      }
      for (const xx of [-1, 1]) {
        for (const zz of [-1, 1]) {
          k.add(x + xx * w * 0.42, y + h / 2, z + zz * d * 0.42, 0.22, h, 0.22, 0xa99475);
        }
      }
      // Clock faces with glowing illuminated dials and hands
      for (const side of [-1, 1]) {
        k.add(x, y + 10, z + side * d * 0.445, 2.0, 2.0, 0.08, iron, 'round');
        k.add(x, y + 10, z + side * d * 0.465, 1.75, 1.75, 0.04, 0xfff3d2);
        k.add(x, y + 10.3, z + side * d * 0.49, 0.08, 0.72, 0.04, iron);
        k.add(x + 0.3, y + 10, z + side * d * 0.49, 0.68, 0.08, 0.04, iron);
        k.add(x + side * w * 0.445, y + 10, z, 0.08, 2.0, 2.0, iron, 'round');
        k.add(x + side * w * 0.465, y + 10, z, 0.04, 1.75, 1.75, 0xfff3d2);
      }
      // Steeple roof on clock tower
      k.add(x, y + h + 2.2, z, w * 0.95, 4.4, d * 0.95, 0x5a6870, 'stone');
    } else if (p.kind === 'cabinet') {
      k.add(x, y + h / 2, z, w, h, d, 0x9a7959, 'round');
      for (let v = 0; v < 3; v++) {
        k.add(x, y + 0.3 + v * 0.6, z - d / 2 - 0.015, w * 0.88, 0.48, 0.035, 0xb89770);
        k.add(x, y + 0.3 + v * 0.6, z - d / 2 - 0.04, w * 0.25, 0.05, 0.04, iron, 'box', 0, 'metal');
      }
    } else if (p.kind === 'vent') {
      k.add(x, y + h / 2, z, w, h, d, 0x8b9a98, 'round', 0, 'metal');
      for (let v = 0.2; v < h; v += 0.16) {
        k.add(x, y + v, z - d / 2 - 0.015, w * 0.82, 0.055, 0.04, iron);
      }
      for (const dx of [-0.7, 0.7]) {
        k.add(x + dx, y + h + 0.015, z, 0.9, 0.04, 0.9, iron, 'cylinder');
        for (let q = 0; q < 4; q++) {
          k.add(x + dx, y + h + 0.04, z, 0.72, 0.02, 0.06, 0x9aaba4, 'box', q * Math.PI / 4, 'metal');
        }
      }
    } else if (p.kind === 'barrel') {
      k.add(x, y + h / 2, z, w, h, d, 0x698d91, 'cylinder', 0, 'metal');
      for (const v of [0.08, 0.25, 0.75, 0.92]) {
        k.add(x, y + h * v, z, w * 1.02, 0.055, d * 1.02, iron, 'cylinder');
      }
      k.add(x + 0.2, y + h + 0.015, z, 0.15, 0.02, 0.15, iron, 'cylinder');
    }
  }

  // --- 12. Road Center Stripes ---
  for (const r of ROADS.filter(r => r.color === 0x667477 || r.width >= 10)) {
    const len = Math.hypot(r.x2 - r.x1, r.z2 - r.z1);
    const dx = (r.x2 - r.x1) / len, dz = (r.z2 - r.z1) / len;
    for (let t = 4; t < len; t += 7) {
      const rx = r.x1 + dx * t, rz = r.z1 + dz * t;
      if (BUILDINGS.some(b => {
        const f = buildingFootprint(b, 2);
        return rx > f.x0 && rx < f.x1 && rz > f.z0 && rz < f.z1;
      })) continue;
      for (let q = 0; q < 3; q++) {
        const xx = rx + dx * q, zz = rz + dz * q;
        k.add(xx, terrainHeight(xx, zz) + 0.07, zz, 0.15, 0.015, 0.95, 0xf0d56b, 'box', Math.atan2(dx, dz));
      }
    }
  }

  // --- 13. Tidal Works Dock Decking & Heavy Timber Railings ---
  for (let px = DOCK.x0; px < DOCK.x1; px += 0.65) {
    k.add(px + 0.31, 0.045, (DOCK.z0 + DOCK.z1) / 2, 0.59, 0.08, DOCK.z1 - DOCK.z0, 0x93785c, 'box', 0, 'wood');
  }
  for (const pz of [DOCK.z0, DOCK.z1]) {
    for (const py of [0.42, 1.08]) {
      k.add((DOCK.x0 + DOCK.x1) / 2, py, pz, DOCK.x1 - DOCK.x0, 0.14, 0.22, 0xb09a78, 'box', 0, 'wood');
    }
    for (let px = DOCK.x0; px <= DOCK.x1; px += 3) {
      k.add(px, 0.57, pz, 0.24, 1.18, 0.24, timber, 'box', 0, 'wood');
    }
  }

  // --- 14. River Covered Bridge ---
  const bridgeX1 = -35, bridgeZ1 = 34, bridgeX2 = -15, bridgeZ2 = 46;
  const brDx = bridgeX2 - bridgeX1, brDz = bridgeZ2 - bridgeZ1;
  const brLen = Math.hypot(brDx, brDz), brYaw = Math.atan2(brDx, brDz);
  const brMidX = (bridgeX1 + bridgeX2) / 2, brMidZ = (bridgeZ1 + bridgeZ2) / 2;
  const brH = 3.6, brW = 6.2;
  const brY = terrainHeight(bridgeX1, bridgeZ1) + 0.2;
  // Wooden plank deck
  k.add(brMidX, brY, brMidZ, brW, 0.3, brLen, 0x8a6e50, 'box', brYaw, 'wood');
  // Red covered bridge walls & roof
  for (const s of [-1, 1]) {
    const wx = brMidX + Math.cos(brYaw) * s * (brW / 2 - 0.15);
    const wz = brMidZ - Math.sin(brYaw) * s * (brW / 2 - 0.15);
    k.add(wx, brY + brH / 2, wz, 0.3, brH, brLen, barnRed, 'box', brYaw, 'wood');
    // Window cutouts / openings in the covered bridge
    for (let bt = -brLen / 2 + 2; bt < brLen / 2; bt += 3.5) {
      const ox = wx - Math.sin(brYaw) * bt;
      const oz = wz - Math.cos(brYaw) * bt;
      k.add(ox, brY + brH * 0.6, oz, 0.45, 1.2, 1.8, darkTimber, 'box', brYaw, 'wood');
    }
  }
  // Covered bridge pitched roof
  k.add(brMidX, brY + brH + 0.6, brMidZ, brW + 1.0, 1.2, brLen + 0.8, 0x5e4838, 'box', brYaw, 'wood');

  k.finish(scene);
}

function sign(
  scene: THREE.Scene,
  text: string,
  x: number, y: number, z: number,
  w: number, h: number,
  color: number,
): void {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const c = canvas.getContext('2d')!;
  c.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  c.fillRect(0, 0, 512, 96);
  c.strokeStyle = '#f0e3cc';
  c.lineWidth = 5;
  c.strokeRect(8, 8, 496, 80);
  c.fillStyle = '#fff4db';
  c.font = '700 36px sans-serif';
  c.textAlign = 'center';
  c.fillText(text, 256, 60);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.75, envMapIntensity: 0.6 }),
  );
  m.position.set(x, y, z);
  m.rotation.y = Math.PI;
  scene.add(m);
}
