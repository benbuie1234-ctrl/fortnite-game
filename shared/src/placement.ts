import { SLOT_FLOOR, SLOT_RAMP, SLOT_CONE, SLOT_WALL_X, SLOT_WALL_Z, Slot, Facing, worldToCell, packKey } from './build';
import { TILE, EYE_HEIGHT, BUILD_RANGE } from './constants';
import { quadrantFromYaw, forwardVector } from './vec';
import type { World } from './world';
export const BUILD_WALL=5, BUILD_FLOOR=6, BUILD_RAMP=7, BUILD_CONE=8;
export interface PlacementTarget { gx:number;gy:number;gz:number;slot:Slot;facing:Facing; }

/** Pitch controls the build layer; looking down places at your feet.
 * Floors and ramps share a layer at ramp exits, allowing continuous climbs. */
export function resolvePlacement(p:{x:number;y:number;z:number;yaw:number;pitch?:number;buildSlot:number}, world?:World):PlacementTarget|null {
  const pitch=p.pitch??0;
  const q=quadrantFromYaw(p.yaw);
  const forward=forwardVector(p.yaw,pitch);
  let distance=TILE*1.15;
  if(forward[1]<-.15) distance=Math.min(distance,(p.y+EYE_HEIGHT-Math.floor((p.y+.05)/TILE)*TILE)/-forward[1]);
  const x=p.x+forward[0]*distance, z=p.z+forward[2]*distance;
  const layer=Math.max(0,Math.floor((p.y+.15)/TILE));
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
