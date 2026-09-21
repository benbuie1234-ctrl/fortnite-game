import {
  SLOT_FLOOR, SLOT_RAMP, SLOT_CONE, SLOT_WALL_X, SLOT_WALL_Z,
  Slot, Facing, worldToCell,
} from "./build";
import { quadrantFromYaw, quadrantOffset } from "./vec";

/** Build slots as they travel in the input's `slot` field. */
export const BUILD_WALL = 5;
export const BUILD_FLOOR = 6;
export const BUILD_RAMP = 7;
export const BUILD_CONE = 8;

export interface PlacementTarget {
  gx: number; gy: number; gz: number; slot: Slot; facing: Facing;
}

/**
 * Where a piece lands, given the player's position and facing.
 *
 * Shared on purpose: the client draws its build ghost from this and the server
 * validates against it, so the preview can never point at a different cell
 * than the one that actually gets built.
 */
export function resolvePlacement(p: {
  x: number; y: number; z: number; yaw: number; buildSlot: number;
}): PlacementTarget | null {
  const cell = worldToCell(p.x, p.y + 0.1, p.z);
  const q = quadrantFromYaw(p.yaw);
  const [ox, oz] = quadrantOffset(q);

  switch (p.buildSlot) {
    case BUILD_WALL: {
      // Walls are canonicalised onto the -X / -Z face of a cell, so facing
      // +X or +Z means placing on the neighbouring cell's face.
      if (q === 0) return { gx: cell.gx + 1, gy: cell.gy, gz: cell.gz, slot: SLOT_WALL_X, facing: q };
      if (q === 2) return { gx: cell.gx,     gy: cell.gy, gz: cell.gz, slot: SLOT_WALL_X, facing: q };
      if (q === 1) return { gx: cell.gx, gy: cell.gy, gz: cell.gz + 1, slot: SLOT_WALL_Z, facing: q };
      return               { gx: cell.gx, gy: cell.gy, gz: cell.gz,     slot: SLOT_WALL_Z, facing: q };
    }
    case BUILD_FLOOR:
      return { gx: cell.gx + ox, gy: cell.gy, gz: cell.gz + oz, slot: SLOT_FLOOR, facing: q };
    case BUILD_RAMP:
      return { gx: cell.gx + ox, gy: cell.gy, gz: cell.gz + oz, slot: SLOT_RAMP, facing: q };
    case BUILD_CONE:
      return { gx: cell.gx, gy: cell.gy + 1, gz: cell.gz, slot: SLOT_CONE, facing: q };
    default:
      return null;
  }
}
