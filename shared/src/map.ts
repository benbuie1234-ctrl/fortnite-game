/** Shared layout used by collision, scenery, navigation and spawn selection. */
import { TILE } from './constants';

/**
 * Half-width of the playable area, in metres.
 * 480m x 480m total battle royale island arena.
 */
export const MAP_HALF = 240;

/** Cell index a metre coordinate falls in. */
export const cell = (metres: number): number => Math.round(metres / TILE);

/**
 * The 5 core districts and their plateau heights.
 * Heights are exact multiples of TILE so buildings land squarely on ground.
 */
export const LOCATIONS = [
  {name:'SKYLINE CITY',x:-108,z:-108,height:TILE*4,color:0x62b7db,description:'High-rise blocks · rooftop fights'},
  {name:'SUNNY MEADOWS',x:108,z:-108,height:TILE*1,color:0xeac06a,description:'Houses · gardens · neighborhood lanes'},
  {name:'TIDAL WORKS',x:-108,z:108,height:0,color:0x68b9b1,description:'Warehouses · docks · lakefront'},
  {name:'PINEWATCH RIDGE',x:108,z:108,height:TILE*5,color:0x89b96b,description:'Forest · hilltop cabins · lookout'},
  {name:'THE CITADEL',x:0,z:0,height:TILE*2,color:0xd7a2e0,description:'Central mesa · the fight everyone walks into'},
] as const;

// ---------------------------------------------------------------------------
// Terrain: Natural, varied Fortnite-style island landscape
// Rolling hills, river gorge, lake basin, cliffs, and plateaus
// ---------------------------------------------------------------------------

interface Plateau { x:number; z:number; r:number; f:number; h:number; }

const PLATEAUS: readonly Plateau[] = [
  {x:-108,z:-108,r:46,f:54,h:TILE*4},  // Skyline, high and flat (24m)
  {x:108, z:-108,r:48,f:38,h:TILE*1},  // Meadows, gentle suburban shelf (6m)
  {x:-108,z:108, r:46,f:32,h:0},       // Tidal, at the waterline (0m)
  {x:108, z:108, r:44,f:64,h:TILE*5},  // Pinewatch, mountain summit (30m)
  {x:0,   z:0,   r:30,f:32,h:TILE*2},  // Central Citadel mesa (12m)
];

/** Scenic rolling hills and natural knolls across the countryside. */
const HILLS: readonly Plateau[] = [
  {x:-10, z:-120, r:14, f:30, h:9},
  {x:120, z:6,    r:16, f:32, h:11},
  {x:-6,  z:124,  r:15, f:28, h:8},
  {x:-126,z:2,    r:14, f:30, h:10},
  {x:56,  z:-58,  r:11, f:24, h:7},
  {x:-58, z:-52,  r:10, f:22, h:6},
  {x:62,  z:58,   r:12, f:26, h:9},
  {x:-64, z:60,   r:11, f:24, h:7},
  {x:48,  z:48,   r:12, f:24, h:8},
  {x:-30, z:42,   r:11, f:22, h:6},
];

/** Centre and extent of the lake, in metres. Compatible with fish and critters. */
const LAKE = {x:-168,z:150,rx:46,rz:60};

const smooth=(t:number)=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
const reach=(p:Plateau,x:number,z:number)=>1-smooth((Math.hypot(x-p.x,z-p.z)-p.r)/p.f);

/**
 * Natural river system: A winding river valley carving from the mountain foothills
 * past the Citadel and flowing out into Misty Lake.
 */
function riverDepth(x: number, z: number): number {
  // Approximate river spline points:
  // (50, 75) -> (10, 45) -> (-25, 30) -> (-75, 65) -> (-130, 110) -> (-168, 150)
  // Distance to a 3-segment bezier curve through the central valley
  let minD = 999;
  const pts: [number, number][] = [
    [55, 80], [30, 60], [5, 45], [-20, 32], [-50, 48], [-80, 72], [-115, 105], [-145, 130]
  ];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[i + 1];
    const dx = x2 - x1, dz = z2 - z1;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / len2));
    const cx = x1 + dx * t, cz = z1 + dz * t;
    const dist = Math.hypot(x - cx, z - cz);
    if (dist < minD) minD = dist;
  }
  const riverWidth = 9.5;
  if (minD > riverWidth) return 0;
  const falloff = 1 - smooth(minD / riverWidth);
  return falloff * 2.2;
}

/**
 * The landscape before any building pad is cut into it.
 */
export function rawTerrain(x:number,z:number):number {
  let height=0,cover=0;
  for(const p of PLATEAUS) {
    const t=reach(p,x,z);
    height=Math.max(height,p.h*t);
    cover=Math.max(cover,t);
  }
  for(const p of HILLS) height=Math.max(height,p.h*reach(p,x,z)*(1-cover));

  // River gorge carving through non-plateau ground
  const rDepth = riverDepth(x, z) * (1 - cover * 0.85);
  height -= rDepth;

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
  // Named exploration landmarks and discovery zones
  if (Math.hypot(x - 48, z - (-48)) < 32) return 'ANARCHY ACRES';
  if (Math.hypot(x - (-48), z - (-48)) < 28) return 'RETAIL GAS & GO';
  if (Math.hypot(x - 48, z - 48) < 28) return 'HAUNTED CHAPEL';
  if (Math.hypot(x - 52, z - 148) < 32) return 'WHISPERING PINES';
  if (Math.hypot(x - (-58), z - (-16)) < 26) return 'SHATTERED QUARRY';
  if (Math.hypot(x - 60, z - 62) < 26) return 'RIDGE SAWMILL';
  if (Math.hypot(x - (-62), z - (-62)) < 26) return 'FORGOTTEN RUINS';
  if (Math.hypot(x - 58, z - (-60)) < 26) return 'SURVIVORS BUNKER';
  if (Math.hypot(x - (-60), z - 58) < 26) return 'HERMITS LAGOON';
  if (Math.hypot(x - 92, z - 0) < 26) return 'RADAR RELAY';
  if (Math.hypot(x - 0, z - (-92)) < 26) return 'NORTH FUEL DEPOT';
  if (Math.hypot(x - 0, z - 92) < 26) return 'VALLEY OVERLOOK';
  if (Math.hypot(x - (-25), z - 40) < 22) return 'RIVER COVERED BRIDGE';
  if (Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz) < 1.0) return 'MISTY LAKE';

  const nearest=LOCATIONS.reduce((a,b)=>Math.hypot(x-a.x,z-a.z)<Math.hypot(x-b.x,z-b.z)?a:b);
  return Math.hypot(x-nearest.x,z-nearest.z)<72?nearest.name:'THE CROSSROADS';
}

// ---------------------------------------------------------------------------
// Buildings: Varied Fortnite Architecture & Lived-in Blueprints
// ---------------------------------------------------------------------------

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  floors: number;
  base: number;
  style: 'city' | 'house' | 'warehouse' | 'cabin';
  color: number;
  theme?: string;
  name?: string;
}

export const BUILDINGS: Building[] = [];

const NEAR = cell(-108), FAR = cell(108);

// Base levels matching plateaus: height / TILE
const CITY_BASE = 4, MEADOW_BASE = 1, RIDGE_BASE = 5;

// --- 1. SKYLINE CITY (Downtown Commercial High-Rises & Alleys) ---
// High-rise apartments, corner deli, modern lofts, city plaza
for (const [dx, dz, w, d, floors, color, theme, name] of [
  [-6, -6, 4, 3, 4, 0x5a7d8d, 'city_tower', 'Skyline Tower'],
  [1, -6, 4, 3, 2, 0xc47e68, 'city_market', 'Corner Market & Deli'],
  [-6, 1, 3, 4, 3, 0x8a9da8, 'city_loft', 'Downtown Lofts'],
  [1, 1, 3, 3, 3, 0xb5b2ce, 'city_market', 'Skyline Plaza Offices'],
  [5, 2, 3, 2, 2, 0xd4b66f, 'city_market', 'Metro Boutique'],
] as const) {
  BUILDINGS.push({ x: NEAR + dx, z: NEAR + dz, w, d, floors, base: CITY_BASE, style: 'city', color, theme, name });
}

// --- 2. SUNNY MEADOWS (Suburban Family Homes, Porches & Attics) ---
// Multi-story homes, charming cottages, gardens and back patios
for (const [dx, dz, w, d, floors, color, theme, name] of [
  [-6, -5, 4, 3, 2, 0xe3b07e, 'suburban_manor', 'Grand Manor'],
  [-1, -5, 3, 3, 2, 0x85acaa, 'suburban_home', 'Blue Spruce House'],
  [3, -5, 3, 2, 1, 0xd89887, 'suburban_cottage', 'Rosewood Cottage'],
  [-6, 2, 3, 3, 2, 0xaebf8c, 'suburban_home', 'Olive Garden Villa'],
  [-2, 2, 3, 3, 2, 0xe1c591, 'suburban_manor', 'Yellow Birch House'],
  [2, 2, 3, 2, 1, 0x93b6c7, 'suburban_cottage', 'Meadow Breeze Bungalow'],
] as const) {
  BUILDINGS.push({ x: FAR + dx, z: NEAR + dz, w, d, floors, base: MEADOW_BASE, style: 'house', color, theme, name });
}

// --- 3. TIDAL WORKS (Industrial Coastal Harbor & Boathouses) ---
// High-bay warehouses, logistics depot, fish packing, boathouse
for (const [dx, dz, w, d, color, theme, name] of [
  [-5, -5, 4, 3, 0x779fa3, 'harbor_warehouse', 'Cargo Freight Warehouse A'],
  [1, -5, 4, 3, 0xc19871, 'harbor_warehouse', 'Logistics Bay B'],
  [-4, 1, 3, 3, 0x8294b2, 'dock_shack', 'Fish Market & Cold Storage'],
  [2, 2, 3, 2, 0xba8068, 'dock_shack', 'Boatmaster Station'],
] as const) {
  BUILDINGS.push({ x: NEAR + dx, z: FAR + dz, w, d, floors: 1, base: 0, style: 'warehouse', color, theme, name });
}

// --- 4. PINEWATCH RIDGE (Alpine Mountain Summit & Forest Cabins) ---
// Alpine log cabins and the tall summit fire lookout tower
for (const [dx, dz, w, d, color, theme, name] of [
  [-5, -5, 3, 3, 0x9c7958, 'alpine_cabin', 'Pinewatch Lodge'],
  [2, -5, 3, 2, 0x8b6845, 'alpine_cabin', 'Hunter Cabin'],
  [-5, 2, 3, 2, 0x9c7958, 'alpine_cabin', 'Timberline Shack'],
  [3, 2, 3, 3, 0xa88562, 'alpine_cabin', 'Overlook Cabin'],
] as const) {
  BUILDINGS.push({ x: FAR + dx, z: FAR + dz, w, d, floors: 1, base: RIDGE_BASE, style: 'cabin', color, theme, name });
}
// Mountain Fire Lookout Tower (3 floors high, overlooking the whole island)
BUILDINGS.push({
  x: FAR - 1, z: FAR, w: 3, d: 2, floors: 3, base: RIDGE_BASE,
  style: 'city', color: 0x8c6d4f, theme: 'lookout_tower', name: 'Fire Lookout Tower',
});

// --- 5. THE CITADEL (Central Castle Bastions & Clock Plaza) ---
// Four grand stone bastions framing the central open plaza and clocktower
for (const [x, z, floors, color, name] of [
  [-5, -5, 2, 0x948b80, 'Citadel NW Bastion'],
  [2, -5, 3, 0x867d73, 'Citadel High Keep'],
  [-5, 2, 2, 0x8e8578, 'Citadel SW Guardhouse'],
  [2, 2, 2, 0x9c9386, 'Citadel Armory'],
] as const) {
  BUILDINGS.push({ x, z, w: 3, d: 3, floors, base: 2, style: 'city', color, theme: 'citadel_castle', name });
}

// --- 6. COUNTRYSIDE LANDMARKS & EXPLORATION POIS ---
// 12 handcrafted outposts providing tactical cover across the rolling terrain
for (const [mx, mz, theme, name, color] of [
  [-58, -16, 'quarry_office', 'Quarry Office', 0x7e7568],
  [54, -18, 'alpine_cabin', 'Sunny Orchard Cabin', 0x937d5c],
  [-16, -56, 'bunker_shelter', 'NW Bunker Pass', 0x5a6352],
  [-18, 52, 'alpine_cabin', 'SW River Pass', 0x7a6a58],
  [-62, -62, 'gas_station', 'Gas & Go Mini-Mart', 0x2e475d],
  [58, -60, 'red_barn', 'Anarchy Farmstead', 0xb4352a],
  [-60, 58, 'dock_shack', 'Hermits Shack', 0x7a634e],
  [60, 62, 'harbor_warehouse', 'Ridge Sawmill', 0x826549],
  [0, -92, 'harbor_warehouse', 'North Fuel Depot', 0x566d75],
  [0, 92, 'alpine_cabin', 'Valley Overlook', 0x8a7056],
  [-92, 0, 'city_market', 'West Crossing Outpost', 0x7d8792],
  [92, 0, 'bunker_shelter', 'Radar Relay Station', 0x6e7882],
] as const) {
  BUILDINGS.push({
    x: cell(mx) - 1,
    z: cell(mz) - 1,
    w: 2,
    d: 2,
    floors: 1,
    base: Math.round(rawTerrain(mx, mz) / TILE),
    style: 'cabin',
    color,
    theme,
    name,
  });
}

// ---------------------------------------------------------------------------
// Building pads: Spatial indexing and leveling skirts
// ---------------------------------------------------------------------------

interface Pad { x0:number; z0:number; x1:number; z1:number; h:number; }
const PAD_BLEND = 11;
const PAD_CELL = 64;
const PAD_INDEX = new Map<string,Pad[]>();

function indexPad(pad:Pad):void {
  for(let cx=Math.floor((pad.x0-PAD_BLEND)/PAD_CELL);cx<=Math.floor((pad.x1+PAD_BLEND)/PAD_CELL);cx++)
  for(let cz=Math.floor((pad.z0-PAD_BLEND)/PAD_CELL);cz<=Math.floor((pad.z1+PAD_BLEND)/PAD_CELL);cz++) {
    const key=`${cx},${cz}`;
    const list=PAD_INDEX.get(key)??[];
    list.push(pad);
    PAD_INDEX.set(key,list);
  }
}

function padAt(x:number,z:number):{h:number;w:number}|null {
  const list=PAD_INDEX.get(`${Math.floor(x/PAD_CELL)},${Math.floor(z/PAD_CELL)}`);
  if(list===undefined)return null;
  let weight=0,height=0;
  for(const pad of list) {
    const dx=Math.max(pad.x0-x,0,x-pad.x1);
    const dz=Math.max(pad.z0-z,0,z-pad.z1);
    const w=1-smooth(Math.hypot(dx,dz)/PAD_BLEND);
    if(w>weight){weight=w;height=pad.h;}
  }
  return weight>0?{h:height,w:weight}:null;
}

for(const b of BUILDINGS) {
  const m=TILE/3;
  indexPad({x0:b.x*TILE-m,z0:b.z*TILE-m,x1:(b.x+b.w)*TILE+m,z1:(b.z+b.d)*TILE+m,h:b.base*TILE});
}

export function buildingAt(gx:number,gz:number):Building|undefined {
  return BUILDINGS.find(b=>gx>=b.x&&gx<=b.x+b.w&&gz>=b.z&&gz<=b.z+b.d);
}

export function buildingFootprint(b:Building,pad=0):{x0:number;z0:number;x1:number;z1:number} {
  return {x0:b.x*TILE-pad, z0:b.z*TILE-pad, x1:(b.x+b.w)*TILE+pad, z1:(b.z+b.d)*TILE+pad};
}

// ---------------------------------------------------------------------------
// Roads: Cohesive island highway & country trail network
// ---------------------------------------------------------------------------

export interface Road {x1:number;z1:number;x2:number;z2:number;width:number;color:number;}
export const ROADS:Road[]=[
  // Central Cross highways
  {x1:0,z1:-MAP_HALF,x2:0,z2:MAP_HALF,width:11,color:0xbba97e},
  {x1:-MAP_HALF,z1:0,x2:MAP_HALF,z2:0,width:11,color:0xbba97e},
  // District ring roads
  {x1:-108,z1:-170,x2:-108,z2:170,width:9,color:0x667477},
  {x1:108,z1:-170,x2:108,z2:170,width:9,color:0x667477},
  {x1:-170,z1:-108,x2:170,z2:-108,width:9,color:0x667477},
  {x1:-170,z1:108,x2:170,z2:108,width:9,color:0x667477},
  // Country spurs to major rural landmarks
  {x1:48,z1:-108,x2:48,z2:-48,width:7,color:0xbba97e},   // Road to Anarchy Barn
  {x1:-48,z1:-108,x2:-48,z2:-48,width:7,color:0xbba97e}, // Road to Gas & Go
  {x1:48,z1:0,x2:48,z2:48,width:7,color:0xbba97e},       // Road to Haunted Chapel
  {x1:-108,z1:-16,x2:-58,z2:-16,width:6,color:0x7d7265},  // Quarry haul road
  {x1:-40,z1:30,x2:-25,z2:40,width:6,color:0x8b7355},    // Covered bridge approach
  {x1:-25,z1:40,x2:-10,z2:50,width:6,color:0x8b7355},    // Covered bridge crossing
  {x1:-108,z1:108,x2:-168,z2:130,width:7,color:0x7a837c},// Docks road to lake pier
];

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
// Scenery: Rich, organic vegetation and natural rock formations
// ---------------------------------------------------------------------------

export interface Scenery {x:number;z:number;y:number;size:number;kind:'tree'|'rock';}
export const SCENERY:Scenery[]=[];
let seed=918273;
function random():number { seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296; }

for(let i=0;i<950;i++) {
  const x=(random()-.5)*(MAP_HALF*1.92), z=(random()-.5)*(MAP_HALF*1.92);
  if(onRoad(x,z,4))continue;
  if(BUILDINGS.some(b=>{const f=buildingFootprint(b,7);return x>f.x0&&x<f.x1&&z>f.z0&&z<f.z1;}))continue;
  const y=terrainHeight(x,z);
  if(y<-.05)continue; // nothing grows submerged in the lake
  // Dense pine woodlands on the summit ridge, lighter elsewhere
  const wooded=Math.hypot(x-108,z-108)<95 || Math.hypot(x-52,z-148)<45;
  if(!wooded&&random()<.42)continue;
  SCENERY.push({x,z,y,size:4+random()*4.2,kind:i%5===0?'rock':'tree'});
}

// ---------------------------------------------------------------------------
// Cars: Solid cover players can stand on, parked in realistic bays
// ---------------------------------------------------------------------------

export interface Car {x:number;z:number;yaw:number;color:number;}
export const CAR_LENGTH = 5.6;
export const CAR_WIDTH = 2.4;
export const CAR_HEIGHT = 1.55;

export const CARS:Car[]=[];
{
  const palette=[0xd8323c,0xf0c020,0x2a6fd0,0x1d1f24,0xe8eaee,0x2fb56b,0xff7a1a];
  // Handcrafted spots in driveways, gas station pump stalls, and town streets
  const spots:Array<[number,number,number]>=[
    // Skyline City street parking
    [-86,-14,0.1],[-70,-14,-0.1],[-114,-114,0.7],[-84,-90,2.2],
    // Sunny Meadows driveways
    [86,-16,3.2],[70,-16,3.0],[102,-114,-0.6],[102,-90,2.5],
    // Tidal Works industrial loading docks
    [-111,111,0.4],[-16,-86,1.6],[-16,-70,1.5],
    // Pinewatch Ridge trailhead
    [108,132,1.1],[16,88,-1.6],[16,72,-1.5],
    // Citadel Plaza & Crossroads
    [34,24,0.8],[-32,-26,2.4],
    // Gas Station pump bays & Anarchy Barn yard
    [-42,-44,1.57],[-42,-52,1.57],[42,-44,0.3],[54,-42,2.8],
  ];
  const clearance=Math.hypot(CAR_LENGTH,CAR_WIDTH)/2;
  for(const [x,z,yaw] of spots) {
    if(BUILDINGS.some(b=>{
      const f=buildingFootprint(b,clearance);
      return x>f.x0&&x<f.x1&&z>f.z0&&z<f.z1;
    }))continue;
    CARS.push({x,z,yaw,color:palette[CARS.length%palette.length]});
  }
}

// ---------------------------------------------------------------------------
// Props: Physics cover, landmarks, fences, furniture, and environmental dressing
// ---------------------------------------------------------------------------

export interface Prop {
  x:number;
  y:number;
  z:number;
  w:number;
  h:number;
  d:number;
  color:number;
  kind?:'crate'|'fence'|'bench'|'planter'|'cabinet'|'vent'|'barrel'|'clock';
}

export const PROPS:Prop[]=[];

// Suburban yards in Sunny Meadows get fences, benches, and planters
for(const b of BUILDINGS.filter(b=>b.style==='house'&&b.theme!=='red_barn')) {
  const f=buildingFootprint(b);
  const y=b.base*TILE;
  PROPS.push({x:f.x0-2.0,y,z:(f.z0+f.z1)/2,w:.5,h:1.0,d:f.z1-f.z0,color:0xf0e6cc,kind:'fence'});
  PROPS.push({x:f.x0-4.2,y,z:(f.z0+f.z1)/2-2.5,w:1.0,h:.8,d:3.2,color:0x927550,kind:'bench'});
  PROPS.push({x:f.x0-4.2,y,z:(f.z0+f.z1)/2+2.5,w:2.0,h:1.2,d:2.0,color:0xb29369,kind:'planter'});
  SCENERY.push({x:f.x0-7,z:f.z0-3,y,size:6,kind:'tree'});
}

// Cargo stacks out on Tidal Works harbor decking
for(let i=0;i<10;i++) {
  PROPS.push({
    x:-190+(i%5)*10, y:0, z:104+Math.floor(i/5)*12,
    w:7,h:5,d:7,color:[0x9a5b4a,0x4a6f9a,0x6f8f5a][i%3],
  });
}

// Shared furnishings & rooftop vents
for(const [i,b] of BUILDINGS.entries()) {
  const x=b.x*TILE,z=b.z*TILE,y=b.base*TILE,w=b.w*TILE,d=b.d*TILE;
  PROPS.push({x:x+1.0,y,z:z+d-1.0,w:1.5,h:1.9,d:1.0,color:0x856a54,kind:'cabinet'});
  PROPS.push({x:x+(b.w===2?1.2:w-1.2),y,z:z+d-3.6,w:1.5,h:1.5,d:1.5,color:0x65858a,kind:i%2?'barrel':'crate'});
  if(b.style==='city') {
    PROPS.push({x:x+w/2,y:y+b.floors*TILE,z:z+d-2,w:2.8,h:1.2,d:1.8,color:0x819497,kind:'vent'});
  }
}

// Iconic Central Clocktower Landmark in The Citadel
PROPS.push({x:0,y:TILE*2,z:0,w:3,h:12,d:3,color:0xd6c09d,kind:'clock'});

export const DOCK={x0:cell(-198)*TILE,x1:(cell(-144)+1)*TILE,z0:cell(102)*TILE,z1:(cell(114)+1)*TILE};

/** Solid parts around door and window openings */
export const ARCHITECTURE:Array<{x:number;y:number;z:number;w:number;h:number;d:number;color:number}>=[];
for(const b of BUILDINGS) for(let side=0;side<4;side++) {
  const count=side<2?b.w:b.d;
  const panel=(u:number,v:number,w:number,h:number)=>{
    ARCHITECTURE.push(side<2?
      {x:b.x*TILE+u,y:b.base*TILE+v,z:(b.z+(side===0?0:b.d))*TILE,w,h,d:.25,color:b.color}:
      {x:(b.x+(side===2?0:b.w))*TILE,y:b.base*TILE+v,z:b.z*TILE+u,w:.25,h,d:w,color:b.color});
  };
  for(let f=0;f<b.floors;f++) for(let c=0;c<count;c++) {
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
