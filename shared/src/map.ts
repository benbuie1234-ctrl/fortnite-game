/** Shared layout used by collision, scenery, navigation and spawn selection. */
export const MAP_HALF = 360;
export const LOCATIONS = [
  {name:'SKYLINE CITY',x:-156,z:-156,color:0x62b7db,description:'High-rise blocks · rooftop fights'},
  {name:'SUNNY MEADOWS',x:156,z:-156,color:0xeac06a,description:'Houses · gardens · neighborhood lanes'},
  {name:'TIDAL WORKS',x:-156,z:156,color:0x68b9b1,description:'Warehouses · docks · lakefront'},
  {name:'PINEWATCH RIDGE',x:156,z:156,color:0x89b96b,description:'Forest · hilltop cabins · lookout'},
] as const;
export interface Building {x:number;z:number;w:number;d:number;floors:number;base:number;style:'city'|'house'|'warehouse'|'cabin';color:number;}
export const BUILDINGS:Building[]=[];
// 4 x 4 city blocks, each separated by a generous street or alley.
for(let row=0;row<4;row++)for(let col=0;col<4;col++) {
  BUILDINGS.push({x:-70+col*11,z:-70+row*11,w:6,d:6,floors:2+(row*3+col)%4,base:0,style:'city',color:[0xc6d4d9,0xe4c6a8,0xa9bccc,0xc3bbcf][(row+col)%4]});
}
for(let row=0;row<3;row++)for(let col=0;col<4;col++)BUILDINGS.push({x:35+col*10,z:[-68,-48,-34][row],w:4,d:5,floors:1+(col+row)%2,base:0,style:'house',color:[0xe6c08f,0xb8d2be,0xe5aea0,0xabc8d9][col]});
for(let i=0;i<5;i++)BUILDINGS.push({x:-68+(i%3)*13,z:37+Math.floor(i/3)*18,w:9,d:10,floors:1,base:0,style:'warehouse',color:[0x739aa0,0xbb9b79,0x8895ae][i%3]});
for(const [x,z] of [[43,43],[57,43],[43,57],[57,57]])BUILDINGS.push({x,z,w:4,d:4,floors:1,base:6,style:'cabin',color:0xb89970});
BUILDINGS.push({x:51,z:51,w:3,d:3,floors:4,base:6,style:'city',color:0xd4c4a1});
// Roadside stops break the long runs into smaller, readable encounters.
for(const [x,z] of [[-27,-8],[22,-8],[-8,-28],[-8,23],[-29,-48],[22,-48],[-48,22],[23,4]]) {
  BUILDINGS.push({x,z,w:4,d:4,floors:1,base:0,style:'cabin',color:0xb7bd9b});
}
const smooth=(t:number)=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
export function terrainHeight(x:number,z:number):number {
  // Broad walkable ascent, flat hilltop keeps all cabin foundations exact.
  const ridge=18*(1-smooth((Math.hypot(x-156,z-156)-62)/65));
  const lake=Math.hypot((x+251)/50,(z-170)/76);
  const basin=-1.2*(1-smooth((lake-.72)/.28));
  return ridge+basin;
}
export function locationAt(x:number,z:number):string {
  const nearest=LOCATIONS.reduce((a,b)=>Math.hypot(x-a.x,z-a.z)<Math.hypot(x-b.x,z-b.z)?a:b);
  return Math.hypot(x-nearest.x,z-nearest.z)<100?nearest.name:'THE CROSSROADS';
}
export function buildingAt(gx:number,gz:number):Building|undefined {
  return BUILDINGS.find(b=>gx>=b.x&&gx<=b.x+b.w&&gz>=b.z&&gz<=b.z+b.d);
}

export interface Scenery {x:number;z:number;y:number;size:number;kind:'tree'|'rock';}
export const SCENERY:Scenery[]=[];
let seed=918273;
function random():number { seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296; }
for(let i=0;i<800;i++) {
  const x=(random()-.5)*590,z=(random()-.5)*590;
  // Keep road corridors, lake, and every building/door approach clear.
  if(Math.abs(x)<12||Math.abs(z)<12||Math.abs(Math.abs(x)-156)<10||Math.abs(Math.abs(z)-156)<10)continue;
  if(x< -80&&x> -224&&z< -80&&z> -224)continue;
  if(x>96&&x<225&&z< -80&&z> -214)continue;
  if(BUILDINGS.some(b=>x>b.x*3-7&&x<(b.x+b.w)*3+7&&z>b.z*3-7&&z<(b.z+b.d)*3+7))continue;
  const y=terrainHeight(x,z);if(y<-.05)continue;
  SCENERY.push({x,z,y,size:3+random()*3,kind:i%5===0?'rock':'tree'});
}

export interface Prop {x:number;y:number;z:number;w:number;h:number;d:number;color:number;}
export const PROPS:Prop[]=[];
for(const b of BUILDINGS.filter(b=>b.style==='house')) {
  const x=b.x*3,z=b.z*3;
  // Low garden borders, a bench and a table; front doors remain clear.
  PROPS.push({x:x-2,y:0,z:z+7,w:.3,h:.65,d:12,color:0xf0e6cc});
  PROPS.push({x:x+2,y:.25,z:z+10,w:2.2,h:.5,d:.6,color:0x927550});
  PROPS.push({x:x+8,y:.25,z:z+10,w:1.5,h:.8,d:1.5,color:0xb29369});
  SCENERY.push({x:x-3,z:z-5,y:0,size:4.4,kind:'tree'});
}
