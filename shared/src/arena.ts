import { TILE } from './constants';
import { Piece,Slot,SLOT_FLOOR,SLOT_WALL_X,SLOT_WALL_Z,SLOT_RAMP,Facing,packKey } from './build';
import { World } from './world';
import { MAP_HALF,BUILDINGS,terrainHeight } from './map';
export const ARENA_OWNER=255;
export const ARENA_HALF_TILES=MAP_HALF/TILE;
export const ARENA_WALL_HEIGHT=0;
export function isArenaPiece(p:Piece):boolean{return p.ownerId===ARENA_OWNER;}
function place(w:World,x:number,y:number,z:number,slot:Slot,facing:Facing=0):void {
 const key=packKey(x,y,z,slot);
 w.set({key,gx:x,gy:y,gz:z,slot,facing,mat:2,hp:Infinity,maxHp:Infinity,placedAt:-1e9,ownerId:ARENA_OWNER});
}
/** Enterable buildings with front/back doors, open windows and continuous stairwells. */
export function buildArena(world:World,_seed=1):void {
 world.terrainEnabled=true;
 for(const b of BUILDINGS) {
  const door=Math.floor(b.w/2);
  for(let level=0;level<=b.floors;level++) {
   const gy=b.base+level;
   for(let x=0;x<b.w;x++)for(let z=0;z<b.d;z++) {
    // Hole over the stairs. The neighboring landing remains solid.
    if(level>0&&x===1&&z===1)continue;
    place(world,b.x+x,gy,b.z+z,SLOT_FLOOR);
   }
   if(level===b.floors)continue;
   for(let x=0;x<b.w;x++) {
    for(const side of [0,b.d]) {
     if(level===0&&x===door)continue;
     if(level>0&&x%3===1)continue;
     place(world,b.x+x,gy,b.z+side,SLOT_WALL_Z);
    }
   }
   for(let z=0;z<b.d;z++)for(const side of [0,b.w]) {
    if(z%3===1)continue; // Full-height window openings double as escape routes.
    place(world,b.x+side,gy,b.z+z,SLOT_WALL_X);
   }
   place(world,b.x+1,gy,b.z+1,SLOT_RAMP,1);
  }
  if(b.style==='house'||b.style==='cabin') {
   for(let z=0;z<b.d;z++)for(let x=0;x<b.w;x++) {
    const rise=Math.min(x,b.w-1-x);
    place(world,b.x+x,b.base+b.floors+rise,b.z+z,SLOT_RAMP,x<b.w/2?0:2);
   }
  }
 }
 // Docks run toward the shallow lake. Broad decking has matching collision.
 for(let x=-80;x<=-67;x++)for(let z=50;z<54;z++)place(world,x,0,z,SLOT_FLOOR);
 // Cargo stacks form short-range cover between the warehouses and docks.
 for(let i=0;i<12;i++) {
  const x=-70+(i%4)*8,z=72+Math.floor(i/4)*4;
  for(let dx=0;dx<5;dx++) {
   place(world,x+dx,0,z,SLOT_WALL_Z);place(world,x+dx,0,z+2,SLOT_WALL_Z);
   for(let dz=0;dz<2;dz++)place(world,x+dx,1,z+dz,SLOT_FLOOR);
  }
  for(let dz=0;dz<2;dz++){place(world,x,0,z+dz,SLOT_WALL_X);place(world,x+5,0,z+dz,SLOT_WALL_X);}
 }
 // Crossroads rest stop keeps the centre useful for small groups.
 for(const x of [-4,3])for(const z of [-4,3]) {
  place(world,x,0,z,SLOT_WALL_X);place(world,x,0,z,SLOT_WALL_Z);
 }
}
export function arenaSpawns():Array<{x:number;y:number;z:number;yaw:number}> {
 // Start close together at the central hub; the four districts are exploration routes.
 return [[0,-21],[0,21],[-21,0],[21,0]].map(([x,z])=>({x,y:terrainHeight(x,z)+.05,z,yaw:Math.atan2(x,-z)}));
}
export function isOutOfBounds(x:number,y:number,z:number):boolean {
 return Math.abs(x)>MAP_HALF+12||Math.abs(z)>MAP_HALF+12||y< -20||y>220;
}
