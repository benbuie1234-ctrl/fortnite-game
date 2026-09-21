// Development-only visual fixture. Not an entry in the production build.
import * as THREE from 'three';
import { Character } from './render/character';
import { loadModels } from './render/models';
const models=await loadModels();
const scene=new THREE.Scene();scene.background=new THREE.Color(0x7899a6);
scene.add(new THREE.HemisphereLight(0xd7eeff,0x68523e,2));const sun=new THREE.DirectionalLight(0xffefd0,3);sun.position.set(3,5,4);scene.add(sun);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));document.body.appendChild(renderer.domElement);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x8a9877}));floor.rotation.x=-Math.PI/2;scene.add(floor);scene.add(new THREE.GridHelper(20,40,0x536454,0x718369));
const ch=new Character('default','Ranger',models);scene.add(ch.root);ch.hideNameplate();ch.setWeapon(0);
const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.05,100);const target=new THREE.Vector3(0,.8,0);
const pose=document.getElementById('pose') as unknown as HTMLSelectElement,angle=document.getElementById('angle') as unknown as HTMLSelectElement;
let last=performance.now(),minFoot=Infinity,maxFoot=-Infinity;
pose.onchange=()=>{minFoot=Infinity;maxFoot=-Infinity;};
function frame(t:number){requestAnimationFrame(frame);const dt=Math.min(.05,(t-last)/1000);last=t;const c=pose.value.includes('crouch'),moving=pose.value==='run'||pose.value==='crouchwalk';ch.update(0,0,0,0,0,moving?(c?2:6):0,pose.value!=='jump',dt,c?1:0);ch.aimAt(new THREE.Vector3(0,1.2,20));ch.root.updateMatrixWorld(true);camera.position.set(angle.value==='side'?4:0,1.55,angle.value==='side'?2:angle.value==='front'?5:-5);camera.lookAt(target);renderer.render(scene,camera);
const box=new THREE.Box3();for(const name of ['footL','footR']){const foot=ch.root.getObjectByName(name);if(foot){box.setFromObject(foot);minFoot=Math.min(minFoot,box.min.y);maxFoot=Math.max(maxFoot,box.min.y);}}document.getElementById('results')!.textContent=`Models: ${models.size} | Feet lowest: ${minFoot.toFixed(4)} m | lift: ${maxFoot.toFixed(3)} m | Draw calls: ${renderer.info.render.calls}\n${models.has('character')?'Compressed GLB ranger loaded':'Fallback character'}`;}
requestAnimationFrame(frame);
