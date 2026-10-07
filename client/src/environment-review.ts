// Development-only environment review: uses the actual terrain, art and collisions.
import { createRenderer } from './render/scene';
import { loadModels } from './render/models';
import { PieceRenderer } from './render/pieces';
import { World } from '@shared/world';
import { buildArena } from '@shared/arena';
import { LOCATIONS,terrainHeight } from '@shared/map';
const models=await loadModels();const view=createRenderer(document.getElementById('app')!,models);
const world=new World();buildArena(world);const pieces=new PieceRenderer(view.scene,view.maxAnisotropy);pieces.sync(world,0);
const select=document.getElementById('place') as unknown as HTMLSelectElement;
const distance=document.getElementById('distance') as HTMLInputElement,angle=document.getElementById('angle') as HTMLInputElement;
let frames=0,previous=performance.now();
function frame(t:number){requestAnimationFrame(frame);const p=LOCATIONS[Number(select.value)]??{x:160,z:150};const h=terrainHeight(p.x,p.z);const d=Number(distance.value),a=Number(angle.value)/100;view.camera.position.set(p.x+Math.sin(a)*d,h+d*.42+3,p.z+Math.cos(a)*d);view.camera.lookAt(p.x,h+6,p.z);pieces.updateVisibility(view.camera.position.x,view.camera.position.z);view.render();frames++;if(t-previous>1000){document.getElementById('metrics')!.textContent=`${models.size} models · ${Math.round(frames*1000/(t-previous))} fps · ${view.renderer.info.memory.geometries} geometries`;previous=t;frames=0;}}
requestAnimationFrame(frame);
