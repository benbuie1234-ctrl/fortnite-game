import * as THREE from "three";

/**
 * Procedural textures, drawn to a canvas at load time.
 *
 * Why not image files: every texture here costs **zero bytes of download**.
 * On school wifi with thirty kids loading at once that matters far more than
 * the extra fidelity a hand-painted PNG would buy. Each one takes well under a
 * millisecond to draw and is generated exactly once, then shared by every mesh
 * that uses it.
 *
 * Every texture is authored to tile seamlessly: patterns use periods that
 * divide the canvas size, and scattered detail is drawn with wraparound so
 * nothing is clipped at the seam.
 */

const SIZE = 256;

function canvas(): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement("canvas");
  cv.width = SIZE;
  cv.height = SIZE;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  return { cv, ctx };
}

/** Deterministic PRNG so textures look identical for every player. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

/**
 * Draw a blob at (x, y), repeating it across every edge it overlaps so the
 * texture stays seamless when tiled.
 */
function wrapDot(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number,
): void {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const px = x + ox * SIZE;
      const py = y + oy * SIZE;
      if (px < -r || px > SIZE + r || py < -r || py > SIZE + r) continue;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function finish(cv: HTMLCanvasElement, anisotropy: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  // Mipmaps plus anisotropy stop the grid shimmering into noise at distance,
  // which is very visible on a floor you are running across.
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Build materials
// ---------------------------------------------------------------------------

function woodCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x5eed01);

  ctx.fillStyle = "#c08a4a";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Vertical planks with darker seams between them.
  const planks = 4;
  const plankW = SIZE / planks;
  for (let i = 0; i < planks; i++) {
    const x = i * plankW;
    const shade = 0.88 + rand() * 0.24;
    ctx.fillStyle = tint(0xc08a4a, shade);
    ctx.fillRect(x, 0, plankW, SIZE);

    // Grain: long wavering strokes down the plank.
    for (let g = 0; g < 26; g++) {
      const gx = x + rand() * plankW;
      const amp = 1 + rand() * 2.5;
      const period = 40 + rand() * 90;
      ctx.strokeStyle = tint(0xc08a4a, 0.72 + rand() * 0.2, 0.5);
      ctx.lineWidth = 0.7 + rand() * 1.4;
      ctx.beginPath();
      for (let y = 0; y <= SIZE; y += 4) {
        // sin over a whole number of periods keeps the top and bottom edges
        // continuous when the texture tiles.
        const wobble = Math.sin((y / SIZE) * Math.PI * 2 * Math.round(SIZE / period)) * amp;
        const px = gx + wobble;
        if (y === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
      }
      ctx.stroke();
    }

    // Plank seam.
    ctx.fillStyle = "rgba(60,36,14,.55)";
    ctx.fillRect(x, 0, 2, SIZE);
  }
  return cv;
}

function brickCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x5eed02);

  // Mortar base.
  ctx.fillStyle = "#6f6a64";
  ctx.fillRect(0, 0, SIZE, SIZE);

  const rows = 8;
  const h = SIZE / rows;
  const brickW = SIZE / 4;
  const gap = 3;

  for (let row = 0; row < rows; row++) {
    const y = row * h;
    // Offset alternate courses by half a brick, the way real bond works.
    const offset = (row % 2) * (brickW / 2);
    for (let b = -1; b < 5; b++) {
      const x = b * brickW + offset;
      const shade = 0.82 + rand() * 0.3;
      ctx.fillStyle = tint(0x9a5f4a, shade);
      ctx.fillRect(x + gap / 2, y + gap / 2, brickW - gap, h - gap);

      // A little grit per brick.
      ctx.fillStyle = "rgba(0,0,0,.07)";
      for (let s = 0; s < 8; s++) {
        const sx = x + gap + rand() * (brickW - gap * 2);
        const sy = y + gap + rand() * (h - gap * 2);
        ctx.fillRect(sx, sy, 1.5, 1.5);
      }
    }
  }
  return cv;
}

function metalCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x5eed03);

  ctx.fillStyle = "#6f7d8c";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Brushed horizontal streaks.
  for (let i = 0; i < 320; i++) {
    const y = rand() * SIZE;
    ctx.strokeStyle = tint(0x6f7d8c, 0.82 + rand() * 0.34, 0.35);
    ctx.lineWidth = 0.6 + rand() * 1.3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SIZE, y);
    ctx.stroke();
  }

  // Panel division, and rivets along it.
  ctx.strokeStyle = "rgba(30,38,48,.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, SIZE / 2);
  ctx.lineTo(SIZE, SIZE / 2);
  ctx.moveTo(SIZE / 2, 0);
  ctx.lineTo(SIZE / 2, SIZE);
  ctx.stroke();

  const rivetSpacing = SIZE / 8;
  for (let i = 0; i < 8; i++) {
    const p = i * rivetSpacing + rivetSpacing / 2;
    ctx.fillStyle = "rgba(210,222,235,.5)";
    wrapDot(ctx, p, SIZE / 2, 2.6);
    wrapDot(ctx, SIZE / 2, p, 2.6);
    ctx.fillStyle = "rgba(25,32,42,.45)";
    wrapDot(ctx, p + 1, SIZE / 2 + 1, 1.5);
    wrapDot(ctx, SIZE / 2 + 1, p + 1, 1.5);
  }
  return cv;
}

// ---------------------------------------------------------------------------
// World surfaces
// ---------------------------------------------------------------------------

function grassCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x5eed04);

  ctx.fillStyle = "#6f8f5a";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Broad patches of colour variation, then finer blades on top.
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = tint(0x6f8f5a, 0.86 + rand() * 0.26, 0.55);
    wrapDot(ctx, rand() * SIZE, rand() * SIZE, 8 + rand() * 22);
  }
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = tint(0x6f8f5a, 0.72 + rand() * 0.5, 0.5);
    wrapDot(ctx, rand() * SIZE, rand() * SIZE, 0.7 + rand() * 1.5);
  }
  return cv;
}

function concreteCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x5eed05);

  ctx.fillStyle = "#828b97";
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = tint(0x828b97, 0.88 + rand() * 0.22, 0.4);
    wrapDot(ctx, rand() * SIZE, rand() * SIZE, 3 + rand() * 16);
  }
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rand() > 0.5 ? "rgba(0,0,0,.05)" : "rgba(255,255,255,.05)";
    wrapDot(ctx, rand() * SIZE, rand() * SIZE, 0.6 + rand() * 1.4);
  }
  return cv;
}

// ---------------------------------------------------------------------------

function tint(hex: number, mul: number, alpha = 1): string {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * mul));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * mul));
  const b = Math.min(255, Math.round((hex & 0xff) * mul));
  return `rgba(${r},${g},${b},${alpha})`;
}

export interface TextureSet {
  /** Indexed by material id: wood, brick, metal. */
  build: THREE.CanvasTexture[];
  grass: THREE.CanvasTexture;
  concrete: THREE.CanvasTexture;
}

let cached: TextureSet | null = null;

/** Build (once) every texture the game uses. */
export function getTextures(anisotropy: number): TextureSet {
  if (cached) return cached;
  cached = {
    build: [
      finish(woodCanvas(), anisotropy),
      finish(brickCanvas(), anisotropy),
      finish(metalCanvas(), anisotropy),
    ],
    grass: finish(grassCanvas(), anisotropy),
    concrete: finish(concreteCanvas(), anisotropy),
  };
  return cached;
}

// ---------------------------------------------------------------------------
// UV scaling
//
// Textures are shared between every piece, so the tiling density has to be
// baked into each geometry's UVs instead of set per-texture. Otherwise a 3 m
// wall and a 0.25 m floor slab would show wildly different brick sizes.
// ---------------------------------------------------------------------------

/**
 * Rewrite a BoxGeometry's UVs so one texture tile covers `metersPerTile` of
 * world space on every face, regardless of the box's proportions.
 *
 * BoxGeometry lays out 6 faces of 4 vertices in the order
 * +X, -X, +Y, -Y, +Z, -Z, each with UVs spanning 0..1.
 */
export function scaleBoxUVs(
  geo: THREE.BufferGeometry,
  w: number, h: number, d: number,
  metersPerTile: number,
): void {
  const uv = geo.getAttribute("uv");
  if (!uv) return;

  // Per face, which world dimensions the U and V axes span.
  const spans: Array<[number, number]> = [
    [d, h], // +X
    [d, h], // -X
    [w, d], // +Y
    [w, d], // -Y
    [w, h], // +Z
    [w, h], // -Z
  ];

  for (let face = 0; face < 6; face++) {
    const [su, sv] = spans[face];
    const ru = su / metersPerTile;
    const rv = sv / metersPerTile;
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      if (i >= uv.count) break;
      uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
    }
  }
  uv.needsUpdate = true;
}

/** Planar UVs for an arbitrary geometry, projected from its dominant axis. */
export function planarUVs(geo: THREE.BufferGeometry, metersPerTile: number): void {
  const pos = geo.getAttribute("position");
  const normal = geo.getAttribute("normal");
  const uvs = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));

    // Project along whichever axis the face most faces, so the texture never
    // appears smeared across a steep surface.
    let u: number, v: number;
    if (ny >= nx && ny >= nz) { u = x; v = z; }
    else if (nx >= nz) { u = z; v = y; }
    else { u = x; v = y; }

    uvs[i * 2] = u / metersPerTile;
    uvs[i * 2 + 1] = v / metersPerTile;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}
