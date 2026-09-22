/** Shared layout used by collision, scenery, navigation and spawn selection. */
import { TILE } from './constants';

/**
 * Half-width of the playable area, in metres.
 *
 * Pulled in from 360. Matches were slow because the four districts sat 312 m
 * apart across an empty middle, so most of a round was spent walking. The
 * districts are closer together and the space between them now has terrain in
 * it rather than distance.
 */
export const MAP_HALF = 240;

/** Cell index a metre coordinate falls in. Map data is authored in cells so it
 *  survives a change to TILE; everything else here is metres. */
export const cell = (metres: number): number => Math.round(metres / TILE);

/**
 * The districts, and the height each one's plateau sits at.
 *
 * Heights are exact multiples of TILE so a building's base cell lands exactly
 * on its own ground. A plateau at 25 m with a 24 m base would leave every
 * structure in the district either floating or sunk by a metre.
 */
export const LOCATIONS = [
  {name:'SKYLINE CITY',x:-108,z:-108,height:TILE*4,color:0x62b7db,description:'High-rise blocks · rooftop fights'},
  {name:'SUNNY MEADOWS',x:108,z:-108,height:TILE*1,color:0xeac06a,description:'Houses · gardens · neighborhood lanes'},
  {name:'TIDAL WORKS',x:-108,z:108,height:0,color:0x68b9b1,description:'Warehouses · docks · lakefront'},
  {name:'PINEWATCH RIDGE',x:108,z:108,height:TILE*5,color:0x89b96b,description:'Forest · hilltop cabins · lookout'},
  {name:'THE CITADEL',x:0,z:0,height:TILE*2,color:0xd7a2e0,description:'Central mesa · the fight everyone walks into'},
] as const;

// ---------------------------------------------------------------------------
// Terrain
//
// Plateaus are combined with max(), never added. Summing them meant two
// overlapping rises stacked into a spike nothing was authored against; taking
// the higher of the two keeps every plateau exactly the height it claims to
// be, which is what lets buildings be placed on a fixed base cell.
//
// Rolling ground fills the space BETWEEN the plateaus and is faded out by the
// plateau coverage, so the flat tops stay flat.
// ---------------------------------------------------------------------------

interface Plateau { x:number; z:number; r:number; f:number; h:number; }

/**
 * Falloffs are roughly twice the height on purpose: that is a ~26 degree
 * slope, which reads as a hillside you walk up rather than a cliff you
 * scramble. Anything steeper and the approaches to the high districts stop
 * being routes and become walls.
 */
const PLATEAUS: readonly Plateau[] = [
  {x:-108,z:-108,r:46,f:54,h:TILE*4},  // Skyline, high and flat
  {x:108, z:-108,r:48,f:34,h:TILE*1},  // Meadows, a gentle shelf
  {x:-108,z:108, r:46,f:30,h:0},       // Tidal, at the waterline
  {x:108, z:108, r:44,f:64,h:TILE*5},  // Pinewatch, the summit
  {x:0,   z:0,   r:30,f:30,h:TILE*2},  // the central mesa
];

/** Low hills between the districts, so the middle of the map has shape. */
const HILLS: readonly Plateau[] = [
  {x:-10, z:-120,r:14,f:30,h:9},
  {x:120, z:6,   r:16,f:32,h:11},
  {x:-6,  z:124, r:15,f:28,h:8},
  {x:-126,z:2,   r:14,f:30,h:10},
  {x:56,  z:-58, r:11,f:24,h:7},
  {x:-58, z:-52, r:10,f:22,h:6},
  {x:62,  z:58,  r:12,f:26,h:9},
  {x:-64, z:60,  r:11,f:24,h:7},
];

/** Centre and extent of the lake, in metres. */
const LAKE = {x:-168,z:150,rx:46,rz:60};

const smooth=(t:number)=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
/** 1 at the centre of a rise, 0 outside its falloff. */
const reach=(p:Plateau,x:number,z:number)=>1-smooth((Math.hypot(x-p.x,z-p.z)-p.r)/p.f);

/**
 * The landscape before any building pad is cut into it.
 *
 * Split out from terrainHeight because the pads are DERIVED from the buildings
 * and some buildings derive their base cell from the ground -- so the raw
 * surface has to be answerable before the pads exist.
 */
export function rawTerrain(x:number,z:number):number {
  let height=0,cover=0;
  for(const p of PLATEAUS) {
    const t=reach(p,x,z);
    height=Math.max(height,p.h*t);
    cover=Math.max(cover,t);
  }
  // Hills only raise the ground where no district plateau owns it, so a
  // district's flat top is never tilted by one.
  for(const p of HILLS) height=Math.max(height,p.h*reach(p,x,z)*(1-cover));
  const lake=Math.hypot((x-LAKE.x)/LAKE.rx,(z-LAKE.z)/LAKE.rz);
  return height-3.2*(1-smooth((lake-.7)/.3));
}

export function terrainHeight(x:number,z:number):number {
  const base=rawTerrain(x,z);
  const pad=padAt(x,z);
  return pad===null?base:base+(pad.h-base)*pad.w;
}

/** Water surface height, for the renderer. Sits just above the basin floor. */
export const LAKE_SURFACE = -1.4;
export const LAKE_SHAPE = LAKE;

export function locationAt(x:number,z:number):string {
  const nearest=LOCATIONS.reduce((a,b)=>Math.hypot(x-a.x,z-a.z)<Math.hypot(x-b.x,z-b.z)?a:b);
  return Math.hypot(x-nearest.x,z-nearest.z)<72?nearest.name:'THE CROSSROADS';
}

// ---------------------------------------------------------------------------
// Buildings
//
// Authored in grid cells. `base` is the cell the ground floor sits on, so it
// has to match the plateau underneath: height / TILE, exactly.
// ---------------------------------------------------------------------------

export interface Building {x:number;z:number;w:number;d:number;floors:number;base:number;style:'city'|'house'|'warehouse'|'cabin';color:number;}
export const BUILDINGS:Building[]=[];

// The four districts sit at the corners of a square, so their cell
// coordinates are just two values in each axis. Naming them per AXIS rather
// than per district matters: a single `MEADOW` constant used for both x and z
// quietly puts the Meadows in the Pinewatch quadrant, buried 24 m inside that
// plateau, and everything still compiles.
const NEAR = cell(-108), FAR = cell(108);

// Authored blocks leave a continuous street through each district. Different
// footprints and heights create courtyards, alleys and readable silhouettes.
const CITY_BASE = 4, MEADOW_BASE = 1, RIDGE_BASE = 5;
for (const [dx,dz,w,d,floors,color] of [
 [-6,-6,3,3,3,0xe0c8ac], [1,-6,4,2,2,0x7ca7ac],
 [-6,1,3,4,2,0xca8870], [1,1,3,3,4,0xb9b7cf],
 [5,2,2,3,1,0xd4b66f],
]) BUILDINGS.push({x:NEAR+dx,z:NEAR+dz,w,d,floors,base:CITY_BASE,style:'city',color});
for (const [dx,dz,w,d,color] of [
 [-6,-5,2,2,0xe3b07e],[-2,-5,2,3,0x85acaa],[3,-5,2,2,0xd89887],
 [-6,1,2,3,0xaebf8c],[-1,2,2,2,0xe1c591],[4,1,2,2,0x93b6c7],
]) BUILDINGS.push({x:FAR+dx,z:NEAR+dz,w,d,floors:1,base:MEADOW_BASE,style:'house',color});
for (const [dx,dz,w,d,color] of [
 [-5,-5,3,3,0x779fa3],[1,-5,4,3,0xc19871],[-4,1,3,3,0x8294b2],[2,2,3,2,0xba8068],
]) BUILDINGS.push({x:NEAR+dx,z:FAR+dz,w,d,floors:1,base:0,style:'warehouse',color});
for (const [dx,dz,w,d] of [[-5,-5,2,3],[2,-5,2,2],[-5,2,2,2],[3,2,2,3]])
 BUILDINGS.push({x:FAR+dx,z:FAR+dz,w,d,floors:1,base:RIDGE_BASE,style:'cabin',color:0x9c7958});
BUILDINGS.push({x:FAR-1,z:FAR,w:3,d:2,floors:3,base:RIDGE_BASE,style:'city',color:0xc8b795});
// Four pavilions frame an open central court; the cross streets stay clear.
for (const [x,z,floors,color] of [[-5,-5,2,0xd1b69a],[2,-5,3,0x82a4a4],[-5,2,2,0xbe8c79],[2,2,2,0xb9b9ce]])
 BUILDINGS.push({x,z,w:3,d:3,floors,base:2,style:'city',color});

/**
 * Cover between the districts.
 *
 * The base cell is derived from the terrain under each one rather than fixed,
 * because these sit on the rolling ground between plateaus and a hard-coded
 * base would bury half of them. They are also placed by their CENTRE, so the
 * sample the base is taken from is the middle of the footprint.
 */
for (const [mx, mz] of [
  [-58, -16], [54, -18], [-16, -56], [-18, 52], [-62, -62], [58, -60], [-60, 58], [60, 62],
  [0, -92], [0, 92], [-92, 0], [92, 0],
]) {
  BUILDINGS.push({
    x: cell(mx) - 1, z: cell(mz) - 1, w: 2, d: 2, floors: 1,
    base: Math.round(rawTerrain(mx, mz) / TILE), style: 'cabin', color: 0xb7bd9b,
  });
}

// ---------------------------------------------------------------------------
// Building pads
//
// A building is a rigid stack of grid cells anchored to one base cell, so it
// can only stand on ground that is level under its whole footprint. Rolling
// terrain is the entire point of the map, so the terrain gives way instead:
// each building flattens the ground beneath it and blends back out to the
// landscape over a short skirt.
//
// Pads are spatially indexed because terrainHeight is on the hot path -- it is
// called ~1500 times per bullet by the terrain raycast, so testing all forty
// of them per sample would be felt. A sample only ever tests the handful of
// pads in its own coarse cell.
// ---------------------------------------------------------------------------

interface Pad { x0:number; z0:number; x1:number; z1:number; h:number; }
/** Metres of skirt from the pad edge back down to the landscape. Wide enough
 *  that the slope it creates is always walkable. */
const PAD_BLEND=11;
const PAD_CELL=64;
const PAD_INDEX=new Map<string,Pad[]>();

function indexPad(pad:Pad):void {
  for(let cx=Math.floor((pad.x0-PAD_BLEND)/PAD_CELL);cx<=Math.floor((pad.x1+PAD_BLEND)/PAD_CELL);cx++)
  for(let cz=Math.floor((pad.z0-PAD_BLEND)/PAD_CELL);cz<=Math.floor((pad.z1+PAD_BLEND)/PAD_CELL);cz++) {
    const key=`${cx},${cz}`;
    const list=PAD_INDEX.get(key)??[];
    list.push(pad);
    PAD_INDEX.set(key,list);
  }
}

/** The pad with the strongest claim on this point, or null. */
function padAt(x:number,z:number):{h:number;w:number}|null {
  const list=PAD_INDEX.get(`${Math.floor(x/PAD_CELL)},${Math.floor(z/PAD_CELL)}`);
  if(list===undefined)return null;
  let weight=0,height=0;
  for(const pad of list) {
    // Distance outside the rectangle; zero anywhere inside it.
    const dx=Math.max(pad.x0-x,0,x-pad.x1);
    const dz=Math.max(pad.z0-z,0,z-pad.z1);
    const w=1-smooth(Math.hypot(dx,dz)/PAD_BLEND);
    if(w>weight){weight=w;height=pad.h;}
  }
  return weight>0?{h:height,w:weight}:null;
}

for(const b of BUILDINGS) {
  // A margin of a third of a tile, so the doorway threshold is level rather
  // than sitting on the first centimetre of the skirt.
  const m=TILE/3;
  indexPad({x0:b.x*TILE-m,z0:b.z*TILE-m,x1:(b.x+b.w)*TILE+m,z1:(b.z+b.d)*TILE+m,h:b.base*TILE});
}

export function buildingAt(gx:number,gz:number):Building|undefined {
  return BUILDINGS.find(b=>gx>=b.x&&gx<=b.x+b.w&&gz>=b.z&&gz<=b.z+b.d);
}

/** Metre-space footprint of a building, padded. Used to keep scenery and props
 *  out of doorways; written once so map data and the renderer cannot disagree
 *  about where a building actually is. */
export function buildingFootprint(b:Building,pad=0):{x0:number;z0:number;x1:number;z1:number} {
  return {x0:b.x*TILE-pad, z0:b.z*TILE-pad, x1:(b.x+b.w)*TILE+pad, z1:(b.z+b.d)*TILE+pad};
}

// ---------------------------------------------------------------------------
// Roads
//
// Shared so the renderer draws exactly the corridors the scenery generator
// keeps clear. They used to be two separate hard-coded lists that drifted.
// ---------------------------------------------------------------------------

export interface Road {x1:number;z1:number;x2:number;z2:number;width:number;color:number;}
export const ROADS:Road[]=[
  // The central cross, and a ring joining the four districts.
  {x1:0,z1:-MAP_HALF,x2:0,z2:MAP_HALF,width:12,color:0xbba97e},
  {x1:-MAP_HALF,z1:0,x2:MAP_HALF,z2:0,width:12,color:0xbba97e},
  {x1:-108,z1:-170,x2:-108,z2:170,width:9,color:0x667477},
  {x1:108,z1:-170,x2:108,z2:170,width:9,color:0x667477},
  {x1:-170,z1:-108,x2:170,z2:-108,width:9,color:0x667477},
  {x1:-170,z1:108,x2:170,z2:108,width:9,color:0x667477},
];
// A spur from each district to the centre, so every plateau has a walkable
// approach rather than only its own slope.
for(const poi of LOCATIONS) {
  if(poi.x===0&&poi.z===0)continue;
  ROADS.push({x1:poi.x,z1:poi.z,x2:poi.x*0.18,z2:poi.z*0.18,width:7,color:0xbba97e});
}

export const onRoad=(x:number,z:number,pad:number)=>ROADS.some(r=>{
  const dx=r.x2-r.x1, dz=r.z2-r.z1, len2=dx*dx+dz*dz || 1;
  const t=Math.max(0,Math.min(1,((x-r.x1)*dx+(z-r.z1)*dz)/len2));
  return Math.hypot(x-(r.x1+dx*t),z-(r.z1+dz*t))<r.width/2+pad;
});

// ---------------------------------------------------------------------------
// Scenery and props
// ---------------------------------------------------------------------------

export interface Scenery {x:number;z:number;y:number;size:number;kind:'tree'|'rock';}
export const SCENERY:Scenery[]=[];
let seed=918273;
function random():number { seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296; }

for(let i=0;i<900;i++) {
  const x=(random()-.5)*(MAP_HALF*1.92), z=(random()-.5)*(MAP_HALF*1.92);
  if(onRoad(x,z,4))continue;
  if(BUILDINGS.some(b=>{const f=buildingFootprint(b,7);return x>f.x0&&x<f.x1&&z>f.z0&&z<f.z1;}))continue;
  const y=terrainHeight(x,z);
  if(y<-.05)continue; // nothing grows in the lake
  // Trees cluster on the forested ridge and thin out over the city plateau.
  const wooded=Math.hypot(x-108,z-108)<90;
  if(!wooded&&random()<.45)continue;
  SCENERY.push({x,z,y,size:4+random()*4,kind:i%5===0?'rock':'tree'});
}

// ---------------------------------------------------------------------------
// Cars
//
// Solid cover you can also climb onto, parked along the roads and in the
// districts. Sized a little over life size -- a real 4.5 m car reads as a toy
// beside a 6 m wall, and the walls are the thing the eye calibrates against.
// ---------------------------------------------------------------------------

export interface Car {x:number;z:number;yaw:number;color:number;}
/** Body dimensions, in metres. Length runs along the car's own forward axis. */
export const CAR_LENGTH = 5.6;
export const CAR_WIDTH = 2.4;
export const CAR_HEIGHT = 1.55;

export const CARS:Car[]=[];
{
  const palette=[0xd8323c,0xf0c020,0x2a6fd0,0x1d1f24,0xe8eaee,0x2fb56b,0xff7a1a];
  // Parked along the approach roads and on the streets BETWEEN the district
  // blocks, angled so they read as parked rather than dropped on the map.
  const spots:Array<[number,number,number]>=[
    [-86,-14,0.1],[-70,-14,-0.1],[86,-16,3.2],[70,-16,3.0],
    [-16,-86,1.6],[-16,-70,1.5],[16,88,-1.6],[16,72,-1.5],
    [-114,-114,0.7],[-84,-90,2.2],[102,-114,-0.6],[102,-90,2.5],
    [-111,111,0.4],[108,132,1.1],[34,24,0.8],[-32,-26,2.4],
  ];
  // A car whose box lands inside a building is not cover, it is a bug you can
  // see through a wall. The footprints move whenever the districts are
  // re-authored, so this is checked here rather than trusted to the numbers
  // above staying correct.
  const clearance=Math.hypot(CAR_LENGTH,CAR_WIDTH)/2;
  for(const [x,z,yaw] of spots) {
    if(BUILDINGS.some(b=>{
      const f=buildingFootprint(b,clearance);
      return x>f.x0&&x<f.x1&&z>f.z0&&z<f.z1;
    }))continue;
    CARS.push({x,z,yaw,color:palette[CARS.length%palette.length]});
  }
}

export interface Prop {x:number;y:number;z:number;w:number;h:number;d:number;color:number;kind?:'crate'|'fence'|'bench'|'planter'|'cabinet'|'vent'|'barrel'|'clock';}
export const PROPS:Prop[]=[];
for(const b of BUILDINGS.filter(b=>b.style==='house')) {
  const f=buildingFootprint(b);
  const y=b.base*TILE;
  // A low garden border down one side, with the bench and planter beside it.
  //
  // Everything sits on the -X flank on purpose. buildArena leaves a doorway in
  // the middle of BOTH the -Z and +Z walls, so anything parked off either of
  // those faces is standing in a doorway -- which is exactly where the planter
  // used to be, sealing the back door of every house in the district.
  PROPS.push({x:f.x0-2.0,y,z:(f.z0+f.z1)/2,w:.5,h:1.0,d:f.z1-f.z0,color:0xf0e6cc,kind:'fence'});
  PROPS.push({x:f.x0-4.2,y,z:(f.z0+f.z1)/2-2.5,w:1.0,h:.8,d:3.2,color:0x927550,kind:'bench'});
  PROPS.push({x:f.x0-4.2,y,z:(f.z0+f.z1)/2+2.5,w:2.0,h:1.2,d:2.0,color:0xb29369,kind:'planter'});
  SCENERY.push({x:f.x0-7,z:f.z0-3,y,size:6,kind:'tree'});
}
// Cargo stacks out on the decking, as short-range cover. Placed on the deck
// surface (y=0), not on the terrain: the ground under the jetty is the lake
// bed, so a crate sitting on it would be underwater.
for(let i=0;i<10;i++) {
  PROPS.push({
    x:-190+(i%5)*10, y:0, z:104+Math.floor(i/5)*12,
    w:7,h:5,d:7,color:[0x9a5b4a,0x4a6f9a,0x6f8f5a][i%3],
  });
}

// Shared furnishings: the visual model and the solid cover use these exact bounds.
for(const [i,b] of BUILDINGS.entries()) {
 const x=b.x*TILE,z=b.z*TILE,y=b.base*TILE,w=b.w*TILE,d=b.d*TILE;
 PROPS.push({x:x+1.0,y,z:z+d-1.0,w:1.5,h:1.9,d:1.0,color:0x856a54,kind:'cabinet'});
 // Leave the doorway column and the alternating front stairwell unobstructed.
 PROPS.push({x:x+(b.w===2?1.2:w-1.2),y,z:z+d-3.6,w:1.5,h:1.5,d:1.5,color:0x65858a,kind:i%2?'barrel':'crate'});
 if(b.style==='city')PROPS.push({x:x+w/2,y:y+b.floors*TILE,z:z+d-2,w:2.8,h:1.2,d:1.8,color:0x819497,kind:'vent'});
}

// The plaza clock is the central navigation landmark, with solid matching cover.
PROPS.push({x:0,y:TILE*2,z:0,w:3,h:12,d:3,color:0xd6c09d,kind:'clock'});
export const DOCK={x0:cell(-198)*TILE,x1:(cell(-144)+1)*TILE,z0:cell(102)*TILE,z1:(cell(114)+1)*TILE};

/** Solid parts around door and window openings. Shared with rendering so a
 * facade never paints over an escape route or hides an invisible wall. */
export const ARCHITECTURE:Array<{x:number;y:number;z:number;w:number;h:number;d:number;color:number}>=[];
for(const b of BUILDINGS)for(let side=0;side<4;side++) {
 const count=side<2?b.w:b.d;
 const panel=(u:number,v:number,w:number,h:number)=>{
  ARCHITECTURE.push(side<2?
   {x:b.x*TILE+u,y:b.base*TILE+v,z:(b.z+(side===0?0:b.d))*TILE,w,h,d:.25,color:b.color}:
   {x:(b.x+(side===2?0:b.w))*TILE,y:b.base*TILE+v,z:b.z*TILE+u,w:.25,h,d:w,color:b.color});
 };
 for(let f=0;f<b.floors;f++)for(let c=0;c<count;c++) {
  const open=side<2?(f===0?c===Math.floor(b.w/2):c%3===1):c%3===1;
  if(!open)continue;
  const u=(c+.5)*TILE,base=f*TILE,door=side<2&&f===0;
  if(door){
   const jamb=(TILE-2.4)/2;
   for(const sign of [-1,1])panel(u+sign*(1.2+jamb/2),base+TILE/2,jamb,TILE);
   panel(u,base+(3.3+TILE)/2,2.4,TILE-3.3);
  } else {
   panel(u,base+.55,TILE,1.1);panel(u,base+TILE-.7,TILE,1.4);
   for(const sign of [-1,1])panel(u+sign*(TILE/2-.45),base+2.85,.9,3.5);
  }
 }
}
