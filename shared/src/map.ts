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
for(let row=0;row<3;row++)for(let col=0;col<4;col++)BUILDINGS.push({x:35+col*10,z:-68+row*14,w:4,d:5,floors:1+(col+row)%2,base:0,style:'house',color:[0xe6c08f,0xb8d2be,0xe5aea0,0xabc8d9][col]});
for(let i=0;i<5;i++)BUILDINGS.push({x:-68+(i%3)*13,z:37+Math.floor(i/3)*18,w:9,d:10,floors:1,base:0,style:'warehouse',color:[0x739aa0,0xbb9b79,0x8895ae][i%3]});
for(const [x,z] of [[43,43],[57,43],[43,57],[57,57]])BUILDINGS.push({x,z,w:4,d:4,floors:1,base:6,style:'cabin',color:0xb89970});
BUILDINGS.push({x:51,z:51,w:3,d:3,floors:4,base:6,style:'city',color:0xd4c4a1});
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
