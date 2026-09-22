import { TILE } from './constants';
import { Piece,Slot,SLOT_FLOOR,SLOT_WALL_X,SLOT_WALL_Z,SLOT_RAMP,Facing,packKey } from './build';
import { World } from './world';
import { MAP_HALF,BUILDINGS,SCENERY,PROPS,CARS,CAR_LENGTH,CAR_WIDTH,CAR_HEIGHT,terrainHeight,cell,DOCK,ARCHITECTURE } from './map';
export const ARENA_OWNER=255;
export const ARENA_HALF_TILES=MAP_HALF/TILE;
export const ARENA_WALL_HEIGHT=0;
export function isArenaPiece(p:Piece):boolean{return p.ownerId===ARENA_OWNER;}
/** Cars are keyed from here downward, clear of scenery (-2 down) and props
 *  (-10000 down), so a collider can always be traced back to what it is. */
export const CAR_KEY_BASE=-20000;

/** Scenery obstacles are keyed negatively; recover the SCENERY index. */
export function sceneryIndexFromKey(key:number):number { return -key-2; }
/** The SCENERY index of the tree this collider belongs to, or -1. Props are
 *  keyed from -10000 down, so the range check separates them from scenery. */
export function treeIndexFromKey(key:number):number {
  if(key>-2||key<=-10000)return -1;
  const i=sceneryIndexFromKey(key);
  return SCENERY[i]?.kind==='tree'?i:-1;
}
function place(w:World,x:number,y:number,z:number,slot:Slot,facing:Facing=0):void {
 const key=packKey(x,y,z,slot);
 w.set({key,gx:x,gy:y,gz:z,slot,facing,mat:2,hp:Infinity,maxHp:Infinity,placedAt:-1e9,ownerId:ARENA_OWNER});
}
/** Enterable buildings with front/back doors, open windows and continuous stairwells. */
export function buildArena(world:World,_seed=1):void {
 world.terrainEnabled=true;
 ARCHITECTURE.forEach((p,i)=>world.addObstacle([p.x-p.w/2,p.y-p.h/2,p.z-p.d/2,p.x+p.w/2,p.y+p.h/2,p.z+p.d/2],-40000-i));
 SCENERY.forEach((p,i)=>{
   const r=p.kind==='tree'?.28:p.size*.3,h=p.kind==='tree'?p.size:p.size*.5;
   world.addObstacle([p.x-r,p.y,p.z-r,p.x+r,p.y+h,p.z+r],-i-2);

 });
 PROPS.forEach((p,i)=>world.addObstacle([p.x-p.w/2,p.y,p.z-p.d/2,p.x+p.w/2,p.y+p.h,p.z+p.d/2],-10000-i));
 // Cars. The collider is an axis-aligned box sized to whichever way round the
 // car is parked: the collision system has no rotated boxes, and a body-sized
 // box that ignored the yaw would let you walk through the front of half of
 // them. Squaring it up costs a little air at the corners and is honest from
 // every side, which is the trade the ramps and cones already make.
 CARS.forEach((c,i)=>{
  const cos=Math.abs(Math.cos(c.yaw)),sin=Math.abs(Math.sin(c.yaw));
  const halfX=(CAR_LENGTH*sin+CAR_WIDTH*cos)/2;
  const halfZ=(CAR_LENGTH*cos+CAR_WIDTH*sin)/2;
  const y=terrainHeight(c.x,c.z);
  world.addObstacle([c.x-halfX,y,c.z-halfZ,c.x+halfX,y+CAR_HEIGHT,c.z+halfZ],CAR_KEY_BASE-i);
 });
 for(const b of BUILDINGS) {
  const door=Math.floor(b.w/2);
  // The stairwell alternates columns floor by floor, and never uses the
  // doorway's column.
  //
  // It used to be one fixed cell, with every level's ramp stacked directly
  // above the last. A ramp fills its whole cell, so the ramp above was a solid
  // ceiling over the one below: a player climbing had TILE minus their own
  // height of headroom and wedged solid about two thirds of the way up every
  // flight. Putting consecutive flights in different columns leaves nothing
  // over a ramp but the hole it climbs through.
  //
  // Alternating needs two free columns, which is why anything with more than
  // one floor is at least three cells wide -- see the check in map.ts.
  const stairCol=(level:number):number=>level%2===0?0:b.w-1;
  // A pitched roof is a solid wedge sitting on the top floor's ceiling, so
  // there is no attic under it and the last flight of a house would climb into
  // the underside of its own roof and stop. Those buildings simply do not get
  // a top flight -- and without a flight there is no hole in the ceiling over
  // it either, which is what `hasFlight` is consulted twice for.
  const pitched=b.style==='house'||b.style==='cabin';
  const hasFlight=(level:number):boolean=>
    level>=0&&level<b.floors&&!(pitched&&level===b.floors-1);
  for(let level=0;level<=b.floors;level++) {
   const gy=b.base+level;
   for(let x=0;x<b.w;x++)for(let z=0;z<b.d;z++) {
    // Hole over the flight below, so the climb can come through. The rest of
    // the landing stays solid.
    if(level>0&&hasFlight(level-1)&&x===stairCol(level-1)&&z===0)continue;
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
   // Rises toward +Z from the front wall inward, so the flight is inside the
   // building rather than climbing into the back wall.
   if(hasFlight(level))place(world,b.x+stairCol(level),gy,b.z,SLOT_RAMP,1);
  }
  if(b.style==='house'||b.style==='cabin') {
   for(let z=0;z<b.d;z++)for(let x=0;x<b.w;x++) {
    const rise=Math.min(x,b.w-1-x);
    place(world,b.x+x,b.base+b.floors+rise,b.z+z,SLOT_RAMP,x<b.w/2?0:2);
   }
  }
 }
 // Decking out over the lake, running out between the two warehouses.
 //
 // The deck sits on the cell line at y=0: above the water, and a short step
 // down from the shore at its landward end, so it can be walked onto. Its cell
 // range is chosen to abut the warehouse district rather than overlap it -- an
 // earlier span put decking and a railing straight through the middle of a
 // warehouse, which is the sort of thing that only shows up when somebody
 // walks there.
 const deckX0=cell(-198), deckX1=cell(-144), deckZ0=cell(102), deckZ1=cell(114);
 for(let x=deckX0;x<=deckX1;x++)for(let z=deckZ0;z<=deckZ1;z++)place(world,x,0,z,SLOT_FLOOR);
 // Low, visible dock rails instead of six-metre solid walls.
 for(const [i,z] of [DOCK.z0,DOCK.z1].entries())world.addObstacle([DOCK.x0,0,z-.12,DOCK.x1,1.15,z+.12],-30000-i);


}
export function arenaSpawns():Array<{x:number;y:number;z:number;yaw:number}> {
 // Around the central mesa, facing inward. Close together on purpose: the
 // districts are somewhere to go, not somewhere to start, and a round that
 // opens with four people walking apart is a round that takes too long.
 return [[0,-26],[0,26],[-26,0],[26,0]].map(([x,z])=>({x,y:terrainHeight(x,z)+.05,z,yaw:Math.atan2(x,-z)}));
}
export function isOutOfBounds(x:number,y:number,z:number):boolean {
 return Math.abs(x)>MAP_HALF+12||Math.abs(z)>MAP_HALF+12||y< -20||y>220;
}
