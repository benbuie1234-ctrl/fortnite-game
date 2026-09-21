import { SLOT_FLOOR, SLOT_RAMP, SLOT_CONE, SLOT_WALL_X, SLOT_WALL_Z, Slot, Facing, worldToCell, packKey, makePiece, pieceBox, rampHeightAt, inGridBounds } from './build';
import { TILE, EYE_HEIGHT, BUILD_RANGE, PLAYER_RADIUS, PLAYER_HEIGHT, STEP_HEIGHT, BUILD_MIN_LAYER } from './constants';
import { quadrantFromYaw, forwardVector } from './vec';
import type { World } from './world';
export const BUILD_WALL=5, BUILD_FLOOR=6, BUILD_RAMP=7, BUILD_CONE=8;
export interface PlacementTarget { gx:number;gy:number;gz:number;slot:Slot;facing:Facing; }

/** Same rejection reasons drive the ghost and server placement. */
export function placementIssue(p:{x:number;y:number;z:number}, target:PlacementTarget, world:World):string|null {
  if(!inGridBounds(target.gx,target.gy,target.gz))return 'Outside build area';
  if(world.pieces.has(packKey(target.gx,target.gy,target.gz,target.slot)))return 'Already occupied';
  const cx=(target.gx+.5)*TILE,cy=target.gy*TILE,cz=(target.gz+.5)*TILE;
  if(Math.hypot(cx-p.x,cy+TILE*.5-p.y-EYE_HEIGHT,cz-p.z)>BUILD_RANGE)return 'Out of reach';
  if(buriedInTerrain(target,world))return 'Blocked by terrain';
  const piece=makePiece(target.gx,target.gy,target.gz,target.slot,0,target.facing,0,0);
  const box=pieceBox(piece);
  if(box&&p.x+PLAYER_RADIUS>box[0]&&p.x-PLAYER_RADIUS<box[3]&&p.z+PLAYER_RADIUS>box[2]&&p.z-PLAYER_RADIUS<box[5]&&p.y+PLAYER_HEIGHT>box[1]&&p.y<box[4]) {
    if(target.slot!==SLOT_FLOOR||box[4]-p.y>STEP_HEIGHT)return 'Move clear of the piece';
  }
  const ramp=rampHeightAt(piece,p.x,p.z);
  if(ramp!==null&&ramp>p.y+STEP_HEIGHT&&p.y+PLAYER_HEIGHT>cy)return 'Move clear of the ramp';
  return null;
}

/**
 * True only when the piece would sit entirely under the landscape.
 *
 * The old test compared the cell's base height against the terrain at the cell
 * CENTRE, which rejected any placement on a slope the moment the middle of the
 * tile dipped below the cell line -- so on the ridge, around the basin and on
 * every hillside there were large open areas that silently refused to build.
 * Sampling the corners and asking whether the whole piece is underground keeps
 * the rule (no building inside a mountain) without the false positives.
 */
function buriedInTerrain(target:PlacementTarget, world:World):boolean {
  const x0=target.gx*TILE, z0=target.gz*TILE;
  const top=target.slot===SLOT_FLOOR?target.gy*TILE:(target.gy+1)*TILE;
  let lowest=Infinity;
  for(const x of [x0,x0+TILE])for(const z of [z0,z0+TILE]) {
    lowest=Math.min(lowest,world.groundAt(x,z));
  }
  return lowest>=top+.05;
}

/** Pitch controls the build layer; looking down places at your feet.
 * Floors and ramps share a layer at ramp exits, allowing continuous climbs. */
export function resolvePlacement(p:{x:number;y:number;z:number;yaw:number;pitch?:number;buildSlot:number}, world?:World):PlacementTarget|null {
  const pitch=p.pitch??0;
  const q=quadrantFromYaw(p.yaw);
  const forward=forwardVector(p.yaw,pitch);
  let distance=TILE*1.15;
  if(forward[1]<-.15) distance=Math.min(distance,(p.y+EYE_HEIGHT-Math.floor((p.y+.05)/TILE)*TILE)/-forward[1]);
  const x=p.x+forward[0]*distance, z=p.z+forward[2]*distance;
  // Not clamped at 0 any more. Clamping meant the lake basin, and anywhere
  // else the landscape drops below y=0, had no legal build layer at all.
  const layer=Math.max(BUILD_MIN_LAYER,Math.floor((p.y+.15)/TILE));
  let gy=layer;
  if(pitch>.35) gy=Math.max(layer,Math.floor((p.y+EYE_HEIGHT+forward[1]*distance)/TILE));
  // Near the upper half of a ramp, the next tile starts at its top edge.
  const feet=worldToCell(p.x,p.y+.05,p.z);
  if(world?.get(feet.gx,feet.gy,feet.gz,SLOT_RAMP) && p.y-feet.gy*TILE>TILE*.4 && pitch>-.35) gy=feet.gy+1;
  const cell=worldToCell(x,gy*TILE,z);
  let target:PlacementTarget;
  if(p.buildSlot===BUILD_WALL) {
    // Place the forward face of the selected tile; close walls stay in reach.
    const base=worldToCell(p.x,p.y,p.z);
    target={gx:base.gx,gy,gz:base.gz,slot:q===0||q===2?SLOT_WALL_X:SLOT_WALL_Z,facing:q};
    if(q===0)target.gx++; if(q===1)target.gz++;
  } else {
    const slot=p.buildSlot===BUILD_FLOOR?SLOT_FLOOR:p.buildSlot===BUILD_RAMP?SLOT_RAMP:p.buildSlot===BUILD_CONE?SLOT_CONE:null;
    if(slot===null)return null;
    target={gx:cell.gx,gy,gz:cell.gz,slot,facing:q};
  }
  // Holding build while looking up stacks walls instead of repeatedly hitting one occupied slot.
  if(world && p.buildSlot===BUILD_WALL && pitch>.35) {
    while(world.pieces.has(packKey(target.gx,target.gy,target.gz,target.slot)) && target.gy<layer+3)target.gy++;
  }
  const cx=(target.gx+.5)*TILE,cy=(target.gy+.5)*TILE,cz=(target.gz+.5)*TILE;
  if(Math.hypot(cx-p.x,cy-p.y-EYE_HEIGHT,cz-p.z)>BUILD_RANGE)return null;
  return target;
}
