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

// Palette note: these are deliberately brighter and more saturated than the
// colours they depict. ACES tone mapping compresses midtones and the baked
// edge occlusion multiplies over the top, so a "correct" brown comes out mud.

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

  ctx.fillStyle = "#d99a55";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Vertical planks with darker seams between them.
  const planks = 4;
  const plankW = SIZE / planks;
  for (let i = 0; i < planks; i++) {
    const x = i * plankW;
    const shade = 0.88 + rand() * 0.24;
    ctx.fillStyle = tint(0xd99a55, shade);
    ctx.fillRect(x, 0, plankW, SIZE);

    // Grain: long wavering strokes down the plank.
    for (let g = 0; g < 26; g++) {
      const gx = x + rand() * plankW;
      const amp = 1 + rand() * 2.5;
      const period = 40 + rand() * 90;
      ctx.strokeStyle = tint(0xd99a55, 0.72 + rand() * 0.2, 0.5);
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
  ctx.fillStyle = "#8a847c";
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
      ctx.fillStyle = tint(0xc06b4f, shade);
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

  ctx.fillStyle = "#8798aa";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Brushed horizontal streaks.
  for (let i = 0; i < 320; i++) {
    const y = rand() * SIZE;
    ctx.strokeStyle = tint(0x8798aa, 0.82 + rand() * 0.34, 0.35);
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

  ctx.fillStyle = "#a3acba";
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = tint(0xa3acba, 0.88 + rand() * 0.22, 0.4);
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

/**
 * Neutral, near-white surface grain.
 *
 * Designed to MULTIPLY over an existing colour rather than supply one, so it
 * can be dropped onto the terrain, the buildings and the props without
 * overriding any of their palettes. Everything in the world was a flat
 * untextured colour; this gives each surface something for the light to catch
 * without changing what colour it is.
 *
 * Kept in a narrow range (about 0.84-1.0) so it reads as grain, not dirt.
 */
function detailCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x5eed06);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Broad mottling first, so the surface varies at a distance too.
  for (let i = 0; i < 120; i++) {
    const shade = 0.86 + rand() * 0.12;
    ctx.fillStyle = `rgba(${Math.round(255 * shade)},${Math.round(255 * shade)},${Math.round(255 * shade)},0.5)`;
    wrapDot(ctx, rand() * SIZE, rand() * SIZE, 10 + rand() * 34);
  }
  // Then fine grain, which is what catches a grazing light.
  for (let i = 0; i < 2600; i++) {
    const shade = 0.84 + rand() * 0.16;
    ctx.fillStyle = `rgba(${Math.round(255 * shade)},${Math.round(255 * shade)},${Math.round(255 * shade)},0.55)`;
    wrapDot(ctx, rand() * SIZE, rand() * SIZE, 0.6 + rand() * 1.7);
  }
  return cv;
}

function heightToNormal(src: HTMLCanvasElement, strength = 2.0): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const sCtx = src.getContext("2d");
  if (!sCtx) return cv;
  const imgData = sCtx.getImageData(0, 0, SIZE, SIZE);
  const srcBuf = imgData.data;
  const outImg = ctx.createImageData(SIZE, SIZE);
  const outBuf = outImg.data;

  const getH = (x: number, y: number) => {
    const px = (x + SIZE) % SIZE;
    const py = (y + SIZE) % SIZE;
    const idx = (py * SIZE + px) * 4;
    return (srcBuf[idx] + srcBuf[idx + 1] + srcBuf[idx + 2]) / (3 * 255);
  };

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const tl = getH(x - 1, y - 1);
      const l = getH(x - 1, y);
      const bl = getH(x - 1, y + 1);
      const t = getH(x, y - 1);
      const b = getH(x, y + 1);
      const tr = getH(x + 1, y - 1);
      const r = getH(x + 1, y);
      const br = getH(x + 1, y + 1);

      const dX = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dY = (bl + 2 * b + br) - (tl + 2 * t + tr);
      const dZ = 1.0 / strength;

      const len = Math.hypot(dX, dY, dZ);
      const nx = -dX / len;
      const ny = -dY / len;
      const nz = dZ / len;

      const idx = (y * SIZE + x) * 4;
      outBuf[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      outBuf[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      outBuf[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      outBuf[idx + 3] = 255;
    }
  }
  ctx.putImageData(outImg, 0, 0);
  return cv;
}

function heightToRoughness(src: HTMLCanvasElement, minR = 0.5, maxR = 0.95): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const sCtx = src.getContext("2d");
  if (!sCtx) return cv;
  const imgData = sCtx.getImageData(0, 0, SIZE, SIZE);
  const srcBuf = imgData.data;
  const outImg = ctx.createImageData(SIZE, SIZE);
  const outBuf = outImg.data;

  for (let i = 0; i < srcBuf.length; i += 4) {
    const h = (srcBuf[i] + srcBuf[i + 1] + srcBuf[i + 2]) / (3 * 255);
    const r = Math.round((minR + (1 - h) * (maxR - minR)) * 255);
    outBuf[i] = r;
    outBuf[i + 1] = r;
    outBuf[i + 2] = r;
    outBuf[i + 3] = 255;
  }
  ctx.putImageData(outImg, 0, 0);
  return cv;
}

/** Stratified, chiseled rock cliff face with horizontal fault lines. */
function cliffCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x5eed07);

  ctx.fillStyle = "#687278";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Horizontal geological strata
  const bands = 14;
  for (let b = 0; b < bands; b++) {
    const y0 = (b * SIZE) / bands;
    const bandH = SIZE / bands;
    const tone = 0.85 + rand() * 0.3;
    ctx.fillStyle = tint(0x687278, tone, 0.45);
    ctx.fillRect(0, y0, SIZE, bandH);

    // Weathered fissures and cracks
    for (let c = 0; c < 8; c++) {
      ctx.strokeStyle = rand() > 0.5 ? "rgba(25,32,38,0.5)" : "rgba(180,195,205,0.3)";
      ctx.lineWidth = 1 + rand() * 2;
      ctx.beginPath();
      const sx = rand() * SIZE;
      ctx.moveTo(sx, y0 + rand() * bandH);
      ctx.lineTo((sx + (rand() - 0.5) * 30 + SIZE) % SIZE, y0 + rand() * bandH);
      ctx.stroke();
    }
  }

  // Stone grain & flecks
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = rand() > 0.5 ? "rgba(220,230,240,0.15)" : "rgba(20,25,30,0.2)";
    wrapDot(ctx, rand() * SIZE, rand() * SIZE, 0.5 + rand() * 1.6);
  }
  return cv;
}

/** Rippled beach sand with delicate wave undulations. */
function sandCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x5eed08);

  ctx.fillStyle = "#d8c499";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Gentle wave wash patterns
  for (let y = 0; y < SIZE; y += 16) {
    ctx.fillStyle = tint(0xd8c499, 0.92 + Math.sin((y / SIZE) * Math.PI * 4) * 0.08, 0.4);
    ctx.fillRect(0, y, SIZE, 16);
  }

  // Fine sand grains
  for (let i = 0; i < 2200; i++) {
    const light = rand() > 0.5;
    ctx.fillStyle = light ? "rgba(255,248,225,0.2)" : "rgba(120,95,60,0.18)";
    wrapDot(ctx, rand() * SIZE, rand() * SIZE, 0.5 + rand() * 1.4);
  }
  return cv;
}

/** Weathered cobblestone road with worn stone paving and mortar grooves. */
function cobbleRoadCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x5eed09);

  ctx.fillStyle = "#4a5359";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Cobble stones in staggered courses
  const rows = 16;
  const rowH = SIZE / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    const cols = 12;
    const colW = SIZE / cols;
    const xOffset = (r % 2) * (colW * 0.5);

    for (let c = -1; c <= cols; c++) {
      const x = c * colW + xOffset;
      const shade = 0.8 + rand() * 0.4;
      ctx.fillStyle = tint(0x606c74, shade, 0.85);

      // Stone slab
      const inset = 1.8;
      ctx.fillRect(x + inset, y + inset, colW - inset * 2, rowH - inset * 2);

      // Highlight top-left edge of stone
      ctx.fillStyle = "rgba(220,235,245,0.18)";
      ctx.fillRect(x + inset, y + inset, colW - inset * 2, 1);
      ctx.fillRect(x + inset, y + inset, 1, rowH - inset * 2);

      // Shadow bottom-right edge of stone (mortar)
      ctx.fillStyle = "rgba(15,20,25,0.35)";
      ctx.fillRect(x + inset, y + rowH - inset - 1, colW - inset * 2, 1);
      ctx.fillRect(x + colW - inset - 1, y + inset, 1, rowH - inset * 2);
    }
  }

  // Worn tire/foot tracks down the center
  ctx.fillStyle = "rgba(40,48,54,0.3)";
  ctx.fillRect(SIZE * 0.2, 0, SIZE * 0.25, SIZE);
  ctx.fillRect(SIZE * 0.55, 0, SIZE * 0.25, SIZE);

  // Gravel and wear particles
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rand() > 0.5 ? "rgba(210,220,230,0.15)" : "rgba(20,25,30,0.25)";
    wrapDot(ctx, rand() * SIZE, rand() * SIZE, 0.6 + rand() * 1.5);
  }
  return cv;
}

/** Fluid water wave normal map. */
function waterNormalCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const img = ctx.createImageData(SIZE, SIZE);
  const data = img.data;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = (x / SIZE) * Math.PI * 4;
      const v = (y / SIZE) * Math.PI * 4;

      const dX = Math.cos(u * 1.5 + v * 0.5) * 0.3 + Math.cos(u * 3.0 - v * 2.0) * 0.15;
      const dY = Math.sin(v * 1.5 + u * 0.5) * 0.3 + Math.sin(v * 3.0 + u * 2.0) * 0.15;
      const dZ = 1.0;

      const len = Math.hypot(dX, dY, dZ);
      const nx = -dX / len;
      const ny = -dY / len;
      const nz = dZ / len;

      const idx = (y * SIZE + x) * 4;
      data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}


// ---------------------------------------------------------------------------
// Architectural materials
//
// Every one of these is authored close to neutral grey, because the map data
// supplies the colour: a building's paint is a per-instance tint multiplied
// over the texture. That is what lets one clapboard texture serve a white
// farmhouse, a red barn and a teal cannery without three copies of it.
//
// They all tile seamlessly, and all of them carry a little grain so that a
// large flat wall has something for the light to catch instead of reading as
// a single painted polygon.
// ---------------------------------------------------------------------------

/** Fine-grained speckle, drawn wrapped so the seam never shows. */
function grain(ctx: CanvasRenderingContext2D, rand: () => number, count: number, alpha: number, size = 2): void {
  for (let i = 0; i < count; i++) {
    const shade = rand() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${alpha * (0.4 + rand() * 0.6)})`;
    wrapDot(ctx, rand() * SIZE, rand() * SIZE, size * (0.4 + rand()));
  }
}

/** Rendered stucco: the plainest wall on the island, so it lives on grain. */
function plasterCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x91a57e);
  ctx.fillStyle = "#e6e2da";
  ctx.fillRect(0, 0, SIZE, SIZE);
  grain(ctx, rand, 2600, 0.10, 2.4);
  // Trowel sweeps, so the surface has a direction to it.
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.05 + rand() * 0.07})`;
    ctx.lineWidth = 3 + rand() * 7;
    const y = rand() * SIZE, len = 40 + rand() * 90, x = rand() * SIZE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (rand() - 0.5) * 14);
    ctx.stroke();
  }
  return cv;
}

/** Painted horizontal clapboard: houses, cabins, the barn, the cannery. */
function sidingCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x5ad1c8);
  ctx.fillStyle = "#e0dcd4";
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Eight boards across the tile, each with its own shade so the wall is not
  // one flat colour, and a shadow line under each lap.
  const boards = 8, h = SIZE / boards;
  for (let i = 0; i < boards; i++) {
    const y = i * h;
    ctx.fillStyle = tint(0xe0dcd4, 0.93 + rand() * 0.12);
    ctx.fillRect(0, y, SIZE, h);
    // The lap shadow, and the highlight just under it.
    ctx.fillStyle = "rgba(40,34,28,.30)";
    ctx.fillRect(0, y, SIZE, 2.5);
    ctx.fillStyle = "rgba(255,255,255,.16)";
    ctx.fillRect(0, y + 2.5, SIZE, 1.5);
    // Grain along the board.
    for (let g = 0; g < 10; g++) {
      ctx.strokeStyle = `rgba(90,78,64,${0.05 + rand() * 0.06})`;
      ctx.lineWidth = 0.8;
      const gy = y + 3 + rand() * (h - 5);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      for (let x = 0; x <= SIZE; x += 16) ctx.lineTo(x, gy + Math.sin(x / SIZE * Math.PI * 2) * 0.8);
      ctx.stroke();
    }
  }
  grain(ctx, rand, 700, 0.06, 1.6);
  return cv;
}

/** Stacked log courses, for the cabins. */
function logCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x10c5b2);
  ctx.fillStyle = "#c9b295";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const logs = 5, h = SIZE / logs;
  for (let i = 0; i < logs; i++) {
    const y = i * h;
    // Round the log with a vertical gradient: dark at the chink, bright at the
    // belly. That single gradient is what makes a flat wall read as timber.
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, tint(0xc9b295, 0.55));
    g.addColorStop(0.32, tint(0xc9b295, 1.06));
    g.addColorStop(0.7, tint(0xc9b295, 0.92));
    g.addColorStop(1, tint(0xc9b295, 0.5));
    ctx.fillStyle = g;
    ctx.fillRect(0, y, SIZE, h);
    for (let k = 0; k < 14; k++) {
      ctx.strokeStyle = `rgba(96,72,48,${0.06 + rand() * 0.08})`;
      ctx.lineWidth = 0.9 + rand();
      const gy = y + 4 + rand() * (h - 8);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      for (let x = 0; x <= SIZE; x += 20) ctx.lineTo(x, gy + Math.sin(x / SIZE * Math.PI * 2 + k) * 1.6);
      ctx.stroke();
    }
  }
  return cv;
}

/** Rubble stone, for the chapel, the mill and the ruins. */
function rubbleCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x57012a);
  ctx.fillStyle = "#8d8880";
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Courses of irregular blocks, offset row to row.
  const rows = 7, h = SIZE / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rand() * 30;
    while (x < SIZE) {
      const w = 22 + rand() * 40;
      ctx.fillStyle = tint(0xa9a49a, 0.78 + rand() * 0.38);
      ctx.fillRect(x + 1.5, r * h + 1.5, w - 3, h - 3);
      // A lit top edge and a shaded bottom, so each block has relief.
      ctx.fillStyle = "rgba(255,255,255,.14)";
      ctx.fillRect(x + 1.5, r * h + 1.5, w - 3, 1.6);
      ctx.fillStyle = "rgba(30,26,22,.22)";
      ctx.fillRect(x + 1.5, r * h + h - 3, w - 3, 1.6);
      x += w;
    }
  }
  grain(ctx, rand, 1800, 0.11, 2.2);
  return cv;
}

/** Corrugated sheeting, for the sheds and the industrial district. */
function corrugatedCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0xc0e4ed);
  ctx.fillStyle = "#c8ccce";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const ribs = 16, w = SIZE / ribs;
  for (let i = 0; i < ribs; i++) {
    const g = ctx.createLinearGradient(i * w, 0, (i + 1) * w, 0);
    g.addColorStop(0, tint(0xc8ccce, 0.62));
    g.addColorStop(0.45, tint(0xc8ccce, 1.14));
    g.addColorStop(1, tint(0xc8ccce, 0.62));
    ctx.fillStyle = g;
    ctx.fillRect(i * w, 0, w, SIZE);
  }
  // Rust blooms and fixings, so the sheets read as used.
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = `rgba(148,86,44,${0.05 + rand() * 0.16})`;
    wrapDot(ctx, rand() * SIZE, rand() * SIZE, 2 + rand() * 9);
  }
  for (let i = 0; i < ribs; i++) {
    for (let y = 8; y < SIZE; y += 64) {
      ctx.fillStyle = "rgba(60,60,64,.5)";
      wrapDot(ctx, i * w + w / 2, y, 1.4);
    }
  }
  return cv;
}

/** Asphalt shingles, for the pitched roofs. */
function shingleCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x5417a0);
  ctx.fillStyle = "#b9b4ac";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const rows = 8, h = SIZE / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * h;
    const offset = (r % 2) * (SIZE / 12);
    for (let i = 0; i < 6; i++) {
      const x = offset + i * (SIZE / 6);
      ctx.fillStyle = tint(0xb9b4ac, 0.8 + rand() * 0.34);
      ctx.fillRect(x + 1, y + 1, SIZE / 6 - 2, h - 1);
    }
    // The shadow under the course above: shingles are all about that line.
    ctx.fillStyle = "rgba(24,20,18,.34)";
    ctx.fillRect(0, y, SIZE, 2.6);
  }
  grain(ctx, rand, 2200, 0.13, 1.8);
  return cv;
}

/** Ribbed tin roofing, for the barn, the sheds and the lookout. */
function tinCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x71bb31);
  ctx.fillStyle = "#c2c6c8";
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 10; i++) {
    const x = i * (SIZE / 10);
    ctx.fillStyle = tint(0xc2c6c8, 0.7);
    ctx.fillRect(x, 0, 3, SIZE);
    ctx.fillStyle = tint(0xc2c6c8, 1.12);
    ctx.fillRect(x + 3, 0, 3, SIZE);
  }
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(150,92,50,${0.05 + rand() * 0.2})`;
    wrapDot(ctx, rand() * SIZE, rand() * SIZE, 1.5 + rand() * 7);
  }
  // Seam lines across the sheets.
  for (let y = 0; y < SIZE; y += SIZE / 4) {
    ctx.fillStyle = "rgba(50,52,54,.3)";
    ctx.fillRect(0, y, SIZE, 1.6);
  }
  return cv;
}

/** Clay pantiles, for the town roofs. */
function pantileCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x9d3311);
  ctx.fillStyle = "#c0a294";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const cols = 8, w = SIZE / cols;
  for (let c = 0; c < cols; c++) {
    const g = ctx.createLinearGradient(c * w, 0, (c + 1) * w, 0);
    g.addColorStop(0, tint(0xc0a294, 0.6));
    g.addColorStop(0.5, tint(0xc0a294, 1.16));
    g.addColorStop(1, tint(0xc0a294, 0.6));
    ctx.fillStyle = g;
    ctx.fillRect(c * w, 0, w, SIZE);
  }
  for (let y = 0; y < SIZE; y += SIZE / 5) {
    ctx.fillStyle = "rgba(60,32,22,.32)";
    ctx.fillRect(0, y, SIZE, 3);
    ctx.fillStyle = "rgba(255,240,230,.10)";
    ctx.fillRect(0, y + 3, SIZE, 1.5);
  }
  grain(ctx, rand, 1400, 0.09, 2);
  return cv;
}

/** Floorboards, for interiors. */
function floorboardCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0xf100a5);
  ctx.fillStyle = "#d3c3ab";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const boards = 6, h = SIZE / boards;
  for (let i = 0; i < boards; i++) {
    const y = i * h;
    ctx.fillStyle = tint(0xd3c3ab, 0.86 + rand() * 0.26);
    ctx.fillRect(0, y, SIZE, h - 1);
    ctx.fillStyle = "rgba(60,44,28,.35)";
    ctx.fillRect(0, y + h - 1.5, SIZE, 1.5);
    // End joints, staggered, so the floor is boards and not stripes.
    const joint = rand() * SIZE;
    ctx.fillStyle = "rgba(60,44,28,.3)";
    ctx.fillRect(joint, y, 1.5, h - 1);
    for (let g = 0; g < 8; g++) {
      ctx.strokeStyle = `rgba(90,64,38,${0.05 + rand() * 0.07})`;
      ctx.lineWidth = 0.8;
      const gy = y + 2 + rand() * (h - 5);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      for (let x = 0; x <= SIZE; x += 24) ctx.lineTo(x, gy + Math.sin(x / SIZE * Math.PI * 2 + g) * 1.2);
      ctx.stroke();
    }
  }
  return cv;
}

/** Square floor tiles with grout, for kitchens, bathrooms and shops. */
function floorTileCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0x71135e);
  ctx.fillStyle = "#b8b6b0";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const n = 4, s = SIZE / n;
  for (let x = 0; x < n; x++) {
    for (let z = 0; z < n; z++) {
      ctx.fillStyle = tint(0xe4e2dc, 0.9 + rand() * 0.18);
      ctx.fillRect(x * s + 2, z * s + 2, s - 4, s - 4);
      ctx.fillStyle = "rgba(255,255,255,.12)";
      ctx.fillRect(x * s + 2, z * s + 2, s - 4, 2);
    }
  }
  grain(ctx, rand, 900, 0.06, 1.6);
  return cv;
}

/** Cut-pile carpet, for bedrooms and offices. */
function carpetCanvas(): HTMLCanvasElement {
  const { cv, ctx } = canvas();
  const rand = rng(0xca8f00);
  ctx.fillStyle = "#cfc7bb";
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 9000; i++) {
    const shade = rand() < 0.5 ? 0 : 255;
    ctx.strokeStyle = `rgba(${shade},${shade},${shade},${0.03 + rand() * 0.07})`;
    ctx.lineWidth = 1;
    const x = rand() * SIZE, y = rand() * SIZE, a = rand() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * 3, y + Math.sin(a) * 3);
    ctx.stroke();
  }
  return cv;
}

export interface TextureSet {
  /** Indexed by material id: wood, brick, metal. */
  build: THREE.CanvasTexture[];
  grass: THREE.CanvasTexture;
  concrete: THREE.CanvasTexture;
  /** Neutral grain, meant to multiply over an existing colour. */
  detail: THREE.CanvasTexture;
  /** Substance-style PBR terrain textures & maps */
  terrainNormal: THREE.CanvasTexture;
  terrainRoughness: THREE.CanvasTexture;
  cliffTexture: THREE.CanvasTexture;
  cliffNormal: THREE.CanvasTexture;
  sandTexture: THREE.CanvasTexture;
  sandNormal: THREE.CanvasTexture;
  roadTexture: THREE.CanvasTexture;
  roadNormal: THREE.CanvasTexture;
  roadRoughness: THREE.CanvasTexture;
  waterNormal: THREE.CanvasTexture;
  /** Architectural materials. Authored neutral; the map supplies the colour. */
  plaster: THREE.CanvasTexture;
  siding: THREE.CanvasTexture;
  log: THREE.CanvasTexture;
  rubble: THREE.CanvasTexture;
  corrugated: THREE.CanvasTexture;
  shingle: THREE.CanvasTexture;
  tin: THREE.CanvasTexture;
  pantile: THREE.CanvasTexture;
  floorboard: THREE.CanvasTexture;
  floorTile: THREE.CanvasTexture;
  carpet: THREE.CanvasTexture;
  /** Normal maps for the surfaces whose relief actually reads. */
  sidingNormal: THREE.CanvasTexture;
  rubbleNormal: THREE.CanvasTexture;
  corrugatedNormal: THREE.CanvasTexture;
  shingleNormal: THREE.CanvasTexture;
}

let cached: TextureSet | null = null;

/** Build (once) every texture the game uses. */
export function getTextures(anisotropy: number): TextureSet {
  if (cached) return cached;
  const grassCv = grassCanvas();
  const cliffCv = cliffCanvas();
  const sandCv = sandCanvas();
  const roadCv = cobbleRoadCanvas();
  const detailCv = detailCanvas();
  const plasterCv = plasterCanvas();
  const sidingCv = sidingCanvas();
  const rubbleCv = rubbleCanvas();
  const corrugatedCv = corrugatedCanvas();
  const shingleCv = shingleCanvas();

  cached = {
    build: [
      finish(woodCanvas(), anisotropy),
      finish(brickCanvas(), anisotropy),
      finish(metalCanvas(), anisotropy),
    ],
    grass: finish(grassCv, anisotropy),
    concrete: finish(concreteCanvas(), anisotropy),
    detail: finish(detailCv, anisotropy),
    terrainNormal: finish(heightToNormal(grassCv, 2.2), anisotropy),
    terrainRoughness: finish(heightToRoughness(grassCv, 0.7, 0.95), anisotropy),
    cliffTexture: finish(cliffCv, anisotropy),
    cliffNormal: finish(heightToNormal(cliffCv, 3.0), anisotropy),
    sandTexture: finish(sandCv, anisotropy),
    sandNormal: finish(heightToNormal(sandCv, 1.4), anisotropy),
    roadTexture: finish(roadCv, anisotropy),
    roadNormal: finish(heightToNormal(roadCv, 2.6), anisotropy),
    roadRoughness: finish(heightToRoughness(roadCv, 0.5, 0.88), anisotropy),
    waterNormal: finish(waterNormalCanvas(), anisotropy),
    plaster: finish(plasterCv, anisotropy),
    siding: finish(sidingCv, anisotropy),
    log: finish(logCanvas(), anisotropy),
    rubble: finish(rubbleCv, anisotropy),
    corrugated: finish(corrugatedCv, anisotropy),
    shingle: finish(shingleCv, anisotropy),
    tin: finish(tinCanvas(), anisotropy),
    pantile: finish(pantileCanvas(), anisotropy),
    floorboard: finish(floorboardCanvas(), anisotropy),
    floorTile: finish(floorTileCanvas(), anisotropy),
    carpet: finish(carpetCanvas(), anisotropy),
    sidingNormal: finish(heightToNormal(sidingCv, 1.8), anisotropy),
    rubbleNormal: finish(heightToNormal(rubbleCv, 2.4), anisotropy),
    corrugatedNormal: finish(heightToNormal(corrugatedCv, 2.6), anisotropy),
    shingleNormal: finish(heightToNormal(shingleCv, 2.0), anisotropy),
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
