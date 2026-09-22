import * as THREE from 'three';
import {
  BLUEPRINTS, BUILDINGS, DECKS, BRIDGES, LAKE, WATERFALL, SCENERY,
  terrainHeight, onRoad, insideBuilding, blocksEntrance, riverDistance, riverWidth,
  type Blueprint, type Room,
} from '@shared/map';
import { TILE } from '@shared/constants';
import { InstancedModel, type ModelLibrary, type ModelId } from './models';

/**
 * Everything that makes the island look lived in.
 *
 * The interiors are driven by the blueprint's ROOMS. A kitchen knows it is a
 * kitchen, knows which of its four walls have doorways in them and knows where
 * the stairwell is, so the fridge goes against a blank wall and not across the
 * door. That is the whole difference between a furnished building and a
 * building with furniture pushed into its corners.
 *
 * Nothing here collides. It is all decoration, instanced by model, and the
 * cover players actually take shelter behind lives in the map's PROPS instead.
 */

export interface Placement {
  id: ModelId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale?: number;
}

/** Deterministic, so every player's island is dressed identically. */
function seeded(seed: number): () => number {
  let s = (seed * 2246822519) >>> 0 || 7;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Placing things in a room
// ---------------------------------------------------------------------------

/** 0 = -Z wall, 1 = +Z, 2 = -X, 3 = +X. */
type Side = 0 | 1 | 2 | 3;

/**
 * A room, and what is still free in it.
 *
 * Each wall is a line of free spans. Placing something against a wall consumes
 * a span, so a kitchen run comes out as a run rather than as six things in the
 * same corner. Doorways, windows at floor level and the stairwell are taken out
 * of the spans before anything is placed.
 */
class RoomSpace {
  /** Free stretches along each wall, in metres from the wall's low corner. */
  private free: Array<Array<[number, number]>> = [[], [], [], []];
  /** Rectangles in the middle of the floor that are already taken. */
  private taken: Array<[number, number, number, number]> = [];

  constructor(
    readonly room: Room,
    readonly bp: Blueprint,
    private rand: () => number,
  ) {
    const { x0, z0, x1, z1 } = room;
    this.free[0] = [[x0, x1]];
    this.free[1] = [[x0, x1]];
    this.free[2] = [[z0, z1]];
    this.free[3] = [[z0, z1]];

    // Doorways: nothing goes in front of one, on either side of the wall.
    for (const run of bp.walls) {
      if (run.parapet) continue;
      if (run.y !== room.y) continue;
      for (const o of run.openings) {
        if (o.kind !== 'door' && o.kind !== 'garage' && o.kind !== 'arch') continue;
        const pad = o.w / 2 + 0.9;
        if (run.axis === 'z') {
          if (Math.abs(run.at - z0) < 0.6) this.block(0, o.u - pad, o.u + pad);
          if (Math.abs(run.at - z1) < 0.6) this.block(1, o.u - pad, o.u + pad);
          // A door in a wall that crosses this room blocks the floor too.
          if (run.at > z0 + 0.6 && run.at < z1 - 0.6) this.reserve(o.u - pad, run.at - 1.4, o.u + pad, run.at + 1.4);
        } else {
          if (Math.abs(run.at - x0) < 0.6) this.block(2, o.u - pad, o.u + pad);
          if (Math.abs(run.at - x1) < 0.6) this.block(3, o.u - pad, o.u + pad);
          if (run.at > x0 + 0.6 && run.at < x1 - 0.6) this.reserve(run.at - 1.4, o.u - pad, run.at + 1.4, o.u + pad);
        }
      }
    }

    // The stairwell, and a step of landing round it.
    if (bp.shaft) {
      const s = bp.shaft;
      this.reserve(s.x0 - 0.6, s.z0 - 0.6, s.x1 + 0.6, s.z1 + 0.6);
      this.block(0, s.x0 - 0.6, s.x1 + 0.6);
      this.block(1, s.x0 - 0.6, s.x1 + 0.6);
      this.block(2, s.z0 - 0.6, s.z1 + 0.6);
      this.block(3, s.z0 - 0.6, s.z1 + 0.6);
    }
  }

  private block(side: Side, from: number, to: number): void {
    const out: Array<[number, number]> = [];
    for (const [a, b] of this.free[side]) {
      if (to <= a || from >= b) { out.push([a, b]); continue; }
      if (from > a) out.push([a, from]);
      if (to < b) out.push([to, b]);
    }
    this.free[side] = out;
  }

  private reserve(x0: number, z0: number, x1: number, z1: number): void {
    this.taken.push([x0, z0, x1, z1]);
  }

  private clear(x0: number, z0: number, x1: number, z1: number): boolean {
    return !this.taken.some(t => x0 < t[2] && x1 > t[0] && z0 < t[3] && z1 > t[1]);
  }

  get width(): number { return this.room.x1 - this.room.x0; }
  get depth(): number { return this.room.z1 - this.room.z0; }
  get area(): number { return this.width * this.depth; }

  /**
   * Put something with its back to a wall.
   *
   * `w` is how much wall it takes up and `d` how far it sticks out. Returns
   * the placement, or null when nothing will fit anywhere.
   */
  against(w: number, d: number, sides: Side[] = [0, 1, 2, 3], gap = 0.12): Placement | null {
    const order = sides.slice().sort(() => this.rand() - 0.5);
    for (const side of order) {
      const spans = this.free[side].filter(([a, b]) => b - a >= w + 0.2);
      if (!spans.length) continue;
      const [a, b] = spans[Math.floor(this.rand() * spans.length * 0.999)];
      // Nudge along the span rather than always hugging the corner.
      const slack = (b - a) - w;
      const at = a + Math.min(slack, slack * (0.15 + this.rand() * 0.7)) + w / 2;
      const { x0, z0, x1, z1 } = this.room;
      let x: number, z: number, yaw: number;
      if (side === 0) { x = at; z = z0 + d / 2 + gap; yaw = 0; }
      else if (side === 1) { x = at; z = z1 - d / 2 - gap; yaw = Math.PI; }
      else if (side === 2) { x = x0 + d / 2 + gap; z = at; yaw = Math.PI / 2; }
      else { x = x1 - d / 2 - gap; z = at; yaw = -Math.PI / 2; }
      const half = [side < 2 ? w / 2 : d / 2, side < 2 ? d / 2 : w / 2];
      if (!this.clear(x - half[0], z - half[1], x + half[0], z + half[1])) { this.block(side, at - w / 2, at + w / 2); continue; }
      this.block(side, at - w / 2 - 0.15, at + w / 2 + 0.15);
      this.reserve(x - half[0], z - half[1], x + half[0], z + half[1]);
      return { id: 'crate', x, y: this.room.y, z, yaw };
    }
    return null;
  }

  /** Put something out in the middle of the floor. */
  middle(w: number, d: number, yaw = 0): Placement | null {
    const { x0, z0, x1, z1 } = this.room;
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = x0 + 1.0 + w / 2 + this.rand() * Math.max(0, (x1 - x0) - w - 2.0);
      const z = z0 + 1.0 + d / 2 + this.rand() * Math.max(0, (z1 - z0) - d - 2.0);
      if (x + w / 2 > x1 - 0.4 || z + d / 2 > z1 - 0.4) continue;
      if (!this.clear(x - w / 2, z - d / 2, x + w / 2, z + d / 2)) continue;
      this.reserve(x - w / 2, z - d / 2, x + w / 2, z + d / 2);
      return { id: 'crate', x, y: this.room.y, z, yaw };
    }
    return null;
  }

  /** The middle of the room, for a ceiling fitting. Always available. */
  get centre(): [number, number] {
    return [(this.room.x0 + this.room.x1) / 2, (this.room.z0 + this.room.z1) / 2];
  }
}

// ---------------------------------------------------------------------------
// Room recipes
// ---------------------------------------------------------------------------

/** Footprint of a model, from the measured sizes in the manifest. */
function extentOf(models: ModelLibrary, id: ModelId): [number, number, number] {
  return models.extent(id) ?? [0.8, 0.8, 0.8];
}

interface Ctx {
  out: Placement[];
  models: ModelLibrary;
  rand: () => number;
}

/** Place one model against a wall, sized from its own measurements. */
function wall(ctx: Ctx, space: RoomSpace, id: ModelId, sides?: Side[], lift = 0): Placement | null {
  const [w, , d] = extentOf(ctx.models, id);
  const p = space.against(w, d, sides);
  if (!p) return null;
  p.id = id;
  p.y += lift;
  ctx.out.push(p);
  return p;
}

/** Place one model out on the floor. */
function floor(ctx: Ctx, space: RoomSpace, id: ModelId, yaw = 0, lift = 0): Placement | null {
  const [w, , d] = extentOf(ctx.models, id);
  const p = space.middle(w, d, yaw);
  if (!p) return null;
  p.id = id;
  p.y += lift;
  ctx.out.push(p);
  return p;
}

/** Put something on top of something else already placed. */
function on(ctx: Ctx, base: Placement | null, id: ModelId, dx = 0, dz = 0): void {
  if (!base) return;
  const [, h] = extentOf(ctx.models, base.id);
  ctx.out.push({ id, x: base.x + dx, y: base.y + h, z: base.z + dz, yaw: base.yaw });
}

function ceiling(ctx: Ctx, space: RoomSpace, id: ModelId): void {
  const [x, z] = space.centre;
  const drop = id === 'ceiling_fan' ? 0.45 : 0.6;
  ctx.out.push({ id, x, y: space.room.y + TILE - drop, z, yaw: ctx.rand() * 6.28 });
}

function furnishRoom(ctx: Ctx, bp: Blueprint, room: Room): void {
  const space = new RoomSpace(room, bp, ctx.rand);
  const big = space.area > 46;
  const r = ctx.rand;

  switch (room.kind) {
    case 'living': {
      wall(ctx, space, big && r() < 0.6 ? 'sofa_long' : 'sofa');
      const table = floor(ctx, space, r() < 0.5 ? 'coffee_table' : 'coffee_table_glass');
      if (table) ctx.out.push({ id: r() < 0.5 ? 'rug' : 'rug_round', x: table.x, y: room.y + 0.01, z: table.z, yaw: r() * 6.28 });
      const cab = wall(ctx, space, 'tv_cabinet');
      on(ctx, cab, r() < 0.7 ? 'tv' : 'tv_vintage');
      if (big) wall(ctx, space, 'armchair');
      wall(ctx, space, 'bookcase');
      wall(ctx, space, 'floor_lamp');
      wall(ctx, space, r() < 0.5 ? 'speaker' : 'radio');
      if (r() < 0.6) wall(ctx, space, 'potted_plant');
      ceiling(ctx, space, r() < 0.4 ? 'ceiling_fan' : 'ceiling_lamp');
      break;
    }
    case 'kitchen': {
      // A worktop run along one wall, with the appliances in it.
      const side: Side[] = [[0], [1], [2], [3]][Math.floor(r() * 4)] as Side[];
      wall(ctx, space, r() < 0.5 ? 'fridge_large' : 'fridge', side);
      const sink = wall(ctx, space, 'kitchen_sink', side);
      wall(ctx, space, 'stove', side);
      const cab = wall(ctx, space, r() < 0.5 ? 'cabinet' : 'cabinet_drawer', side);
      on(ctx, cab, 'microwave');
      on(ctx, sink, 'coffee_machine');
      wall(ctx, space, 'cabinet_upper', side, 2.0);
      if (big) {
        const bar = floor(ctx, space, 'kitchen_bar', Math.PI / 2);
        if (bar) for (const dz of [-0.7, 0.7]) ctx.out.push({ id: 'bar_stool', x: bar.x + 1.0, y: room.y, z: bar.z + dz, yaw: -Math.PI / 2 });
      }
      wall(ctx, space, 'trashcan');
      ceiling(ctx, space, 'ceiling_lamp');
      break;
    }
    case 'dining': {
      const table = floor(ctx, space, r() < 0.5 ? 'dining_table' : 'round_table');
      if (table) {
        for (const [dx, dz, yaw] of [[-1.2, 0, Math.PI / 2], [1.2, 0, -Math.PI / 2], [0, -1.0, 0], [0, 1.0, Math.PI]] as const) {
          ctx.out.push({ id: r() < 0.5 ? 'chair' : 'chair_cushion', x: table.x + dx, y: room.y, z: table.z + dz, yaw });
        }
      }
      wall(ctx, space, 'bookcase_closed');
      wall(ctx, space, 'potted_plant');
      ceiling(ctx, space, 'ceiling_lamp');
      break;
    }
    case 'bed': {
      const bed = wall(ctx, space, big ? 'bed_double' : r() < 0.5 ? 'bed_single' : 'bed_double');
      if (bed) {
        const night = wall(ctx, space, 'nightstand');
        on(ctx, night, 'table_lamp');
        ctx.out.push({ id: 'rug_round', x: bed.x, y: room.y + 0.01, z: bed.z + Math.cos(bed.yaw) * -1.8, yaw: r() * 6.28 });
      }
      wall(ctx, space, 'coat_rack');
      wall(ctx, space, 'chest');
      if (big) { const d = wall(ctx, space, 'desk'); on(ctx, d, 'laptop'); }
      wall(ctx, space, 'bookcase');
      ceiling(ctx, space, 'ceiling_lamp');
      break;
    }
    case 'bath': {
      wall(ctx, space, 'bathtub');
      wall(ctx, space, 'toilet');
      wall(ctx, space, 'bath_sink');
      if (big) wall(ctx, space, 'shower');
      if (r() < 0.5) wall(ctx, space, 'washer');
      if (r() < 0.4) wall(ctx, space, 'dryer');
      ceiling(ctx, space, 'ceiling_lamp');
      break;
    }
    case 'hall':
    case 'lobby': {
      wall(ctx, space, 'coat_rack');
      wall(ctx, space, room.kind === 'lobby' ? 'sofa_corner' : 'bench_cushion');
      if (room.kind === 'lobby') {
        const desk = wall(ctx, space, 'desk');
        on(ctx, desk, 'monitor');
        if (desk) ctx.out.push({ id: 'desk_chair', x: desk.x - Math.sin(desk.yaw) * 0.9, y: room.y, z: desk.z - Math.cos(desk.yaw) * 0.9, yaw: desk.yaw + Math.PI });
      }
      wall(ctx, space, 'potted_plant');
      ctx.out.push({ id: 'rug', x: space.centre[0], y: room.y + 0.01, z: space.centre[1], yaw: r() < 0.5 ? 0 : Math.PI / 2 });
      ceiling(ctx, space, 'ceiling_lamp');
      break;
    }
    case 'office': {
      const desk = wall(ctx, space, 'desk');
      on(ctx, desk, r() < 0.6 ? 'monitor' : 'laptop');
      if (desk) ctx.out.push({ id: 'desk_chair', x: desk.x - Math.sin(desk.yaw) * 0.9, y: room.y, z: desk.z - Math.cos(desk.yaw) * 0.9, yaw: desk.yaw + Math.PI });
      wall(ctx, space, 'bookcase_closed');
      const shelf = wall(ctx, space, 'bookcase');
      on(ctx, shelf, 'books');
      wall(ctx, space, 'cabinet_drawer');
      wall(ctx, space, 'trashcan');
      if (r() < 0.5) wall(ctx, space, 'potted_plant');
      ceiling(ctx, space, 'ceiling_lamp');
      break;
    }
    case 'shop': {
      // A counter facing the door, shelving down the walls, stock behind.
      const counter = floor(ctx, space, 'kitchen_bar', r() < 0.5 ? 0 : Math.PI / 2);
      on(ctx, counter, 'laptop');
      wall(ctx, space, 'fridge_large');
      for (let i = 0; i < 3; i++) wall(ctx, space, r() < 0.5 ? 'bookcase' : 'bookcase_closed');
      wall(ctx, space, 'coffee_machine', undefined, 0.9);
      floor(ctx, space, 'box_open', r() * 6.28);
      floor(ctx, space, 'box_closed', r() * 6.28);
      wall(ctx, space, 'trashcan');
      ceiling(ctx, space, 'ceiling_lamp');
      break;
    }
    case 'storage': {
      for (let i = 0; i < (big ? 5 : 3); i++) {
        const id: ModelId = ['crate_wood', 'crate_large', 'box_closed', 'box_open', 'barrel'][Math.floor(r() * 5)] as ModelId;
        const p = wall(ctx, space, id);
        // Stack a second one on the first, sometimes.
        if (p && r() < 0.45) on(ctx, p, r() < 0.5 ? 'box_closed' : 'crate_wood');
      }
      const pallet = floor(ctx, space, 'pallet', r() * 6.28);
      on(ctx, pallet, 'crate_wood');
      wall(ctx, space, 'bookcase');
      if (r() < 0.5) wall(ctx, space, 'chest');
      break;
    }
    case 'workshop':
    case 'garage': {
      const bench = wall(ctx, space, 'workbench');
      on(ctx, bench, 'radio');
      wall(ctx, space, 'barrel');
      wall(ctx, space, 'barrel_open');
      wall(ctx, space, 'crate_large');
      floor(ctx, space, 'pallet_small', r() * 6.28);
      floor(ctx, space, 'planks', r() * 6.28);
      wall(ctx, space, 'bucket');
      if (r() < 0.5) wall(ctx, space, 'scaffold');
      break;
    }
    case 'attic': {
      // Somebody's forgotten things, which is what an attic is for.
      for (let i = 0; i < 4; i++) {
        const p = wall(ctx, space, ['box_closed', 'crate_wood', 'chest', 'box_open'][Math.floor(r() * 4)] as ModelId);
        if (p && r() < 0.4) on(ctx, p, 'books');
      }
      if (r() < 0.6) wall(ctx, space, 'armchair');
      wall(ctx, space, 'table_lamp');
      floor(ctx, space, 'rug', r() * 6.28);
      break;
    }
    case 'cellar':
    case 'bunk': {
      wall(ctx, space, 'bed_bunk');
      if (big) wall(ctx, space, 'bed_single');
      const night = wall(ctx, space, 'nightstand');
      on(ctx, night, 'table_lamp');
      wall(ctx, space, 'chest');
      wall(ctx, space, 'coat_rack');
      break;
    }
    case 'bar': {
      const bar = floor(ctx, space, 'kitchen_bar', Math.PI / 2);
      if (bar) for (const dz of [-1.2, 0, 1.2]) ctx.out.push({ id: 'bar_stool', x: bar.x + 1.1, y: room.y, z: bar.z + dz, yaw: -Math.PI / 2 });
      wall(ctx, space, 'fridge');
      floor(ctx, space, 'round_table');
      ceiling(ctx, space, 'ceiling_lamp');
      break;
    }
    case 'stall': {
      // A barn stall: straw, a trough, tools.
      for (let i = 0; i < 4; i++) floor(ctx, space, 'log', r() * 6.28);
      wall(ctx, space, 'bucket');
      wall(ctx, space, 'workbench');
      wall(ctx, space, 'crate_wood');
      break;
    }
    case 'nave': {
      // Pews in rows down the nave.
      const rows = Math.max(2, Math.floor(space.depth / 2.4));
      for (let i = 0; i < rows; i++) {
        const z = room.z0 + 1.6 + i * 2.2;
        if (z > room.z1 - 1.2) break;
        for (const dx of [-1.9, 1.9]) {
          ctx.out.push({ id: 'bench_cushion', x: (room.x0 + room.x1) / 2 + dx, y: room.y, z, yaw: 0, scale: 1.6 });
        }
      }
      break;
    }
    default: {
      // Ruins and anything unclassified: a little rubble and nothing else.
      if (r() < 0.6) floor(ctx, space, 'crate_wood', r() * 6.28);
      if (r() < 0.4) floor(ctx, space, 'barrel', r() * 6.28);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Outside
// ---------------------------------------------------------------------------

/** Is this spot free of the things a player has to be able to walk through? */
function open(x: number, z: number, pad = 1.2): boolean {
  return !insideBuilding(x, z, pad) && !onRoad(x, z, pad) && !blocksEntrance(x, z, pad, pad);
}

function scatter(
  ctx: Ctx, cx: number, cz: number, radius: number, count: number,
  pick: (r: number) => ModelId, lift = 0,
): void {
  for (let i = 0; i < count; i++) {
    const a = ctx.rand() * Math.PI * 2;
    const d = Math.sqrt(ctx.rand()) * radius;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (!open(x, z)) continue;
    ctx.out.push({ id: pick(ctx.rand()), x, y: terrainHeight(x, z) + lift, z, yaw: ctx.rand() * 6.28 });
  }
}

/** Yards, forecourts and the ground immediately round each building. */
function dressYards(ctx: Ctx): void {
  for (const bp of BLUEPRINTS) {
    const b = bp.b;
    const y = b.base * TILE;
    const r = ctx.rand;
    const corners: Array<[number, number]> = [
      [bp.x0 - 2.2, bp.z0 - 2.2], [bp.x1 + 2.2, bp.z0 - 2.2],
      [bp.x0 - 2.2, bp.z1 + 2.2], [bp.x1 + 2.2, bp.z1 + 2.2],
    ];
    for (const [x, z] of corners) {
      if (!open(x, z, 0.8)) continue;
      const roll = r();
      const id: ModelId = b.style === 'house' ? (roll < 0.35 ? 'potted_plant' : roll < 0.6 ? 'plant_small' : roll < 0.8 ? 'trashcan' : 'bucket')
        : b.style === 'warehouse' ? (roll < 0.4 ? 'barrel' : roll < 0.7 ? 'pallet' : 'crate_large')
          : b.style === 'cabin' ? (roll < 0.5 ? 'log' : roll < 0.8 ? 'stump' : 'bucket')
            : (roll < 0.4 ? 'trashcan' : roll < 0.7 ? 'dumpster' : 'crate_wood');
      ctx.out.push({ id, x, y: Math.max(y, terrainHeight(x, z)), z, yaw: r() * 6.28 });
    }
    // Something beside the front door: a bench, a plant, a pile of firewood.
    const s = bp.entrance.side;
    const out: [number, number] = s === 0 ? [0, -1] : s === 1 ? [0, 1] : s === 2 ? [-1, 0] : [1, 0];
    const along: [number, number] = [out[1], -out[0]];
    for (const dir of [-1, 1]) {
      const x = bp.entrance.x + out[0] * 1.6 + along[0] * dir * 2.6;
      const z = bp.entrance.z + out[1] * 1.6 + along[1] * dir * 2.6;
      if (!open(x, z, 0.6)) continue;
      const roll = r();
      const id: ModelId = b.style === 'house' ? (roll < 0.4 ? 'potted_plant' : roll < 0.7 ? 'bench_cushion' : 'plant_small')
        : b.style === 'cabin' ? (roll < 0.5 ? 'log' : 'stump')
          : (roll < 0.5 ? 'barrel' : 'crate_wood');
      ctx.out.push({ id, x, y: Math.max(y, terrainHeight(x, z)), z, yaw: Math.atan2(-out[0], -out[1]) });
    }
  }
}

/** Street furniture through the towns, and along the roads between them. */
function dressStreets(ctx: Ctx): void {
  const towns: Array<[number, number, number]> = [
    [96, -144, 40], [-4, -14, 34], [-134, -150, 30], [74, 124, 30], [-164, -50, 30],
  ];
  for (const [cx, cz, radius] of towns) {
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 + ctx.rand();
      const d = radius * (0.5 + ctx.rand() * 0.6);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      // Street furniture belongs at the KERB: just off the road, not on it.
      if (!onRoad(x, z, 5) || onRoad(x, z, 1.2)) continue;
      if (insideBuilding(x, z, 2) || blocksEntrance(x, z, 1.5, 1.5)) continue;
      const roll = ctx.rand();
      const id: ModelId = roll < 0.3 ? 'street_light' : roll < 0.45 ? 'street_bench'
        : roll < 0.6 ? 'trashcan' : roll < 0.7 ? 'signpost' : roll < 0.8 ? 'lamp_post'
          : roll < 0.9 ? 'potted_plant' : 'barrier';
      ctx.out.push({ id, x, y: terrainHeight(x, z), z, yaw: ctx.rand() * 6.28 });
    }
  }
  // A traffic light at the crossroads the two highways make.
  for (const [x, z] of [[6, -6], [-10, -20], [6, -22], [-10, -6]] as const) {
    ctx.out.push({ id: 'traffic_light', x, y: terrainHeight(x, z), z, yaw: Math.atan2(-x, -z) });
  }
}

/** The named landmarks that are made of props rather than of walls. */
function dressLandmarks(ctx: Ctx): void {
  const r = ctx.rand;
  const put = (id: ModelId, x: number, z: number, yaw = 0, scale?: number): void => {
    ctx.out.push({ id, x, y: terrainHeight(x, z), z, yaw, scale });
  };

  // The graveyard behind Greenwood Chapel: rows of stones and one crypt.
  for (let i = 0; i < 26; i++) {
    const x = -78 - (i % 6) * 3.4 + r() * 0.8;
    const z = 162 + Math.floor(i / 6) * 3.6 + r() * 0.8;
    if (!open(x, z, 0.8)) continue;
    const roll = r();
    put(roll < 0.5 ? 'gravestone' : roll < 0.8 ? 'gravestone_round' : 'gravestone_cross', x, z, (r() - 0.5) * 0.4);
  }
  put('crypt', -92, 176, 0.2);
  for (let i = 0; i < 10; i++) put('iron_fence', -100 + i * 4, 156, 0);

  // Camp Kindling, in the trees above the lake.
  for (const [x, z] of [[-112, 158], [-106, 163], [-116, 166]] as const) {
    put('tent', x, z, r() * 6.28);
  }
  put('campfire', -111, 163);
  for (let i = 0; i < 5; i++) put('log', -111 + Math.cos(i) * 3.2, 163 + Math.sin(i) * 3.2, i);
  put('chest', -104, 168, 0.6);

  // The angler's pier on Misty Lake.
  const pier = DECKS[1];
  if (pier) {
    const px = (pier.x0 + pier.x1) / 2;
    for (const z of [pier.z0 + 4, pier.z1 - 6]) {
      ctx.out.push({ id: 'crate_wood', x: px + 1.2, y: pier.y, z, yaw: r() * 6.28 });
      ctx.out.push({ id: 'bucket', x: px - 1.2, y: pier.y, z: z + 1.4, yaw: 0 });
    }
    ctx.out.push({ id: 'barrel', x: px, y: pier.y, z: pier.z1 - 2, yaw: 0 });
  }

  // The harbour pier at Saltwood: crab pots, barrels, coils of rope.
  const quay = DECKS[0];
  if (quay) {
    const qx = (quay.x0 + quay.x1) / 2;
    for (let i = 0; i < 7; i++) {
      const z = quay.z0 + 3 + i * ((quay.z1 - quay.z0 - 6) / 7);
      ctx.out.push({ id: i % 3 === 0 ? 'barrel' : i % 3 === 1 ? 'crate_wood' : 'box_closed', x: qx + (i % 2 ? 1.6 : -1.6), y: quay.y, z, yaw: r() * 6.28 });
    }
  }

  // Orchard Row: fruit crates and a pumpkin patch at the far end.
  scatter(ctx, 30, 162, 20, 18, roll => (roll < 0.5 ? 'crate_wood' : roll < 0.8 ? 'box_open' : 'bucket'));
  scatter(ctx, 20, 178, 12, 22, () => 'pumpkin');

  // Beekeepers Row: the hives, which are boxes at a distance and boxes up close.
  for (let i = 0; i < 8; i++) {
    const x = 128 + (i % 4) * 3.2, z = 112 + Math.floor(i / 4) * 4;
    put('box_closed', x, z, 0.1 * i, 1.4);
  }

  // The drive-in: speaker posts in rows facing the screen.
  for (let i = 0; i < 12; i++) {
    const x = 118 + (i % 4) * 6, z = -34 + Math.floor(i / 4) * 7;
    if (!open(x, z, 1)) continue;
    put('signpost', x, z, Math.PI, 0.7);
  }

  // The foundry yard: pallets, spoil and a scaffold tower.
  scatter(ctx, -164, -70, 22, 26, roll => (roll < 0.3 ? 'pallet' : roll < 0.55 ? 'barrel' : roll < 0.75 ? 'crate_large' : roll < 0.9 ? 'planks' : 'dumpster'));
  put('scaffold', -150, -84, 0.2);
  put('scaffold', -150, -80, 0.2);

  // Hayseed: straw, sacks and a water butt round the farmyard.
  scatter(ctx, 74, 126, 24, 24, roll => (roll < 0.35 ? 'crate_wood' : roll < 0.55 ? 'barrel' : roll < 0.75 ? 'bucket' : roll < 0.9 ? 'pallet' : 'box_open'));

  // Behind the waterfall: the island's best-hidden cache.
  ctx.out.push({ id: 'chest', x: WATERFALL.x - 3.4, y: WATERFALL.pool - 0.6, z: WATERFALL.z + 1.2, yaw: 1.2 });
  ctx.out.push({ id: 'campfire', x: WATERFALL.x - 4.2, y: WATERFALL.pool - 0.6, z: WATERFALL.z + 3.4, yaw: 0 });

  // A few more caches, out where only somebody exploring will find them.
  const secrets: Array<[number, number]> = [
    [-196, -176], [208, -116], [-208, 100], [196, 146], [-34, 176],
    [154, -76], [-124, 100], [44, -96], [-30, 206], [214, 60],
  ];
  for (const [x, z] of secrets) {
    if (!open(x, z, 1)) continue;
    put('chest', x, z, r() * 6.28);
    put('barrel', x + 2.2, z + 1.4, r() * 6.28);
  }

  // Under each bridge, where people shelter from the rain.
  for (const bridge of BRIDGES) {
    const ax = Math.sin(bridge.yaw), az = Math.cos(bridge.yaw);
    const x = bridge.x + ax * (bridge.length / 2 - 3) + az * (bridge.width / 2 + 2);
    const z = bridge.z + az * (bridge.length / 2 - 3) - ax * (bridge.width / 2 + 2);
    if (!open(x, z, 1)) continue;
    put('campfire', x, z);
    put('log', x + 1.8, z + 1.2, r() * 6.28);
    put('crate_wood', x - 1.6, z + 1.0, r() * 6.28);
  }

  // Driftwood and rock pools along the shore, wherever the beach is wide.
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    const rad = 218 + r() * 12;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    const y = terrainHeight(x, z);
    if (y < 0.2 || y > 2.6) continue;
    if (!open(x, z, 1)) continue;
    const roll = r();
    ctx.out.push({ id: roll < 0.45 ? 'log' : roll < 0.7 ? 'stump' : roll < 0.85 ? 'rock_a' : 'rock_c', x, y, z, yaw: r() * 6.28 });
  }

  // Fishing spots along the river.
  for (let i = 0; i < 26; i++) {
    const t = (i + 0.5) / 26;
    const s = SCENERY[Math.floor(r() * SCENERY.length)];
    void s;
    const angle = r() * Math.PI * 2;
    const x = -150 + t * 300 + Math.cos(angle) * 6;
    const z = 40 + Math.sin(angle) * 30;
    const river = riverDistance(x, z);
    if (river.d < riverWidth(river.t) + 2 || river.d > riverWidth(river.t) + 12) continue;
    if (!open(x, z, 1)) continue;
    put(r() < 0.5 ? 'log' : 'bucket', x, z, r() * 6.28);
  }
  void LAKE;
  void BUILDINGS;
}

// ---------------------------------------------------------------------------

export function createFurnishings(scene: THREE.Scene, models: ModelLibrary): number {
  const ctx: Ctx = { out: [], models, rand: seeded(20260922) };
  for (const bp of BLUEPRINTS) {
    for (const room of bp.rooms) furnishRoom(ctx, bp, room);
  }
  dressYards(ctx);
  dressStreets(ctx);
  dressLandmarks(ctx);
  return instance(scene, models, ctx.out);
}

function instance(scene: THREE.Scene, models: ModelLibrary, placements: Placement[]): number {
  const byId = new Map<ModelId, Placement[]>();
  for (const p of placements) {
    const list = byId.get(p.id);
    if (list) list.push(p); else byId.set(p.id, [p]);
  }
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scaleVec = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  let placed = 0;

  for (const [id, list] of byId) {
    const source = models.get(id);
    if (!source) continue;
    const batch = new InstancedModel(source, list.length);
    if (!batch.valid) continue;
    list.forEach((p, i) => {
      quaternion.setFromAxisAngle(up, p.yaw);
      const s = p.scale ?? 1;
      scaleVec.set(s, s, s);
      batch.setMatrixAt(i, matrix.compose(position.set(p.x, p.y, p.z), quaternion, scaleVec));
    });
    batch.addTo(scene);
    placed += list.length;
  }
  return placed;
}
