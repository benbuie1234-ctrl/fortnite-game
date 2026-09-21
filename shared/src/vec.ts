/**
 * Look/movement basis. Must match the convention used in sim.ts: with
 * moveZ = +1 (forward) and yaw = 0 the player travels toward +Z.
 */
export function forwardVector(yaw: number, pitch: number): [number, number, number] {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
}

export function rightVector(yaw: number): [number, number, number] {
  return [Math.cos(yaw), 0, Math.sin(yaw)];
}

/** Which cardinal direction a yaw is facing: 0=+X, 1=+Z, 2=-X, 3=-Z. */
export function quadrantFromYaw(yaw: number): 0 | 1 | 2 | 3 {
  const [fx, , fz] = forwardVector(yaw, 0);
  if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 0 : 2;
  return fz > 0 ? 1 : 3;
}

/** Offset in cells for a cardinal direction. */
export function quadrantOffset(q: 0 | 1 | 2 | 3): [number, number] {
  switch (q) {
    case 0: return [1, 0];
    case 1: return [0, 1];
    case 2: return [-1, 0];
    default: return [0, -1];
  }
}

/** Random unit direction inside a cone of half-angle `spread` around dir. */
export function applySpread(
  dir: [number, number, number],
  spread: number,
  rand: () => number,
): [number, number, number] {
  if (spread <= 0) return dir;
  const [dx, dy, dz] = dir;

  // Build an orthonormal basis around dir.
  const up: [number, number, number] = Math.abs(dy) > 0.99 ? [1, 0, 0] : [0, 1, 0];
  let rx = up[1] * dz - up[2] * dy;
  let ry = up[2] * dx - up[0] * dz;
  let rz = up[0] * dy - up[1] * dx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;

  const ux = dy * rz - dz * ry;
  const uy = dz * rx - dx * rz;
  const uz = dx * ry - dy * rx;

  // Uniform over the disc so pellets do not clump at the centre.
  const angle = rand() * Math.PI * 2;
  const radius = Math.sqrt(rand()) * Math.tan(spread);
  const ox = Math.cos(angle) * radius;
  const oy = Math.sin(angle) * radius;

  const nx = dx + rx * ox + ux * oy;
  const ny = dy + ry * ox + uy * oy;
  const nz = dz + rz * ox + uz * oy;
  const nl = Math.hypot(nx, ny, nz) || 1;
  return [nx / nl, ny / nl, nz / nl];
}
