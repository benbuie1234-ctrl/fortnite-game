import * as THREE from 'three';
import { MAP_HALF,terrainHeight,BUILDINGS,SCENERY,PROPS,ROADS,LAKE_SHAPE,LAKE_SURFACE,onRoad,buildingFootprint } from '@shared/map';
import { getTextures, planarUVs } from './textures';
import { createCars } from './cars';
import { createEnvironment } from './environment';
import { InstancedModel, type ModelLibrary, type ModelId } from './models';

export interface Landscape {
  update(time:number):void;
  /** Fade one tree, addressed by its index in SCENERY. 1 = fully solid. */
  setTreeAlpha(sceneryIndex:number,alpha:number):void;
}

/**
 * Foliage gets its own material with a per-instance alpha attribute.
 *
 * Trees have to be able to fade one at a time -- the one you are hiding in,
 * for you, and any tree somebody has shot the leaves off, for everybody. An
 * InstancedMesh shares a single material across every instance, so the alpha
 * has to travel as instance data and be applied in the shader; there is no
 * per-instance opacity otherwise, short of a draw call per tree.
 */
function makeFoliageMaterial(base:THREE.MeshStandardMaterial):THREE.MeshStandardMaterial {
 const material=base.clone();
 material.transparent=true;
 // Depth writing stays on. Foliage renders after the opaque pass, so anything
 // behind a faded tree has already been drawn and shows through the blend;
 // turning it off would only let trees sort through each other.
 material.depthWrite=true;
 material.onBeforeCompile=shader=>{
  shader.vertexShader='attribute float aAlpha;\nvarying float vAlpha;\n'+
   shader.vertexShader.replace('void main() {','void main() {\n\tvAlpha = aAlpha;');
  shader.fragmentShader='varying float vAlpha;\n'+
   shader.fragmentShader.replace('#include <dithering_fragment>','#include <dithering_fragment>\n\tgl_FragColor.a *= vAlpha;');
 };
 return material;
}

function addAlphaAttribute(geometry:THREE.BufferGeometry,count:number):THREE.InstancedBufferAttribute {
 const attribute=new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1),1);
 geometry.setAttribute('aAlpha',attribute);
 return attribute;
}

export function createLandscape(scene:THREE.Scene,models?:ModelLibrary):Landscape {
 // Tapered trunk and irregular rock, rather than plain boxes. A cylinder that
 // is wider at the base reads as a tree from any angle; a box only ever reads
 // as a box.
 const trunkGeo=new THREE.CylinderGeometry(.19,.32,1,6);
 const rockGeo=new THREE.DodecahedronGeometry(.62,0);
 // Props are crates and containers: they must stay boxes. Sharing one geometry
 // with the rocks turned every container into a boulder.
 const propGeo=new THREE.BoxGeometry(1,1,1);
 const leafGeo=new THREE.ConeGeometry(1,1,7);
 const detail=getTextures(1).detail;
 const solidMaterial=new THREE.MeshStandardMaterial({color:0xffffff,map:detail,roughness:0.88,metalness:0,envMapIntensity:0.9});
 const treeList=SCENERY.filter(p=>p.kind==='tree'),rockList=SCENERY.filter(p=>p.kind==='rock');
 const foliageMaterial=makeFoliageMaterial(solidMaterial);
 const trunks=new THREE.InstancedMesh(trunkGeo,foliageMaterial,treeList.length);
 const leaves=new THREE.InstancedMesh(leafGeo,foliageMaterial,treeList.length*3);
 const trunkAlpha=addAlphaAttribute(trunkGeo,treeList.length);
 const leafAlpha=addAlphaAttribute(leafGeo,treeList.length*3);
 // SCENERY holds trees and rocks interleaved; everything downstream addresses
 // a tree by its SCENERY index, so keep the translation in one place.
 const treeSlotBySceneryIndex=new Map<number,number>();
 SCENERY.forEach((p,i)=>{if(p.kind==='tree')treeSlotBySceneryIndex.set(i,treeSlotBySceneryIndex.size);});
 const rocks=new THREE.InstancedMesh(rockGeo,solidMaterial,rockList.length);
 const props=new THREE.InstancedMesh(propGeo,solidMaterial,PROPS.length);
 const matrix=new THREE.Object3D();

 // Natural species mix: conifers on the ridge, broadleaf and autumn trees
 // around the towns. No platform or second trunk underneath an imported tree.
 const species:ModelId[]=['tree','tree_oak','tree_autumn'];
 const treeBatches=new Map<number,{batch:InstancedModel;slot:number}>();
 for(const id of species) {
  const list=treeList.map((p,i)=>({p,i})).filter(({p,i})=>{
   const chosen=Math.hypot(p.x-108,p.z-108)<85?'tree':i%7===0?'tree_autumn':'tree_oak';return chosen===id;
  });
  const model=models?.get(id);if(!model||!list.length)continue;
  const batch=new InstancedModel(model,list.length,true);if(!batch.valid)continue;
  list.forEach(({p,i},slot)=>{matrix.position.set(p.x,p.y,p.z);matrix.scale.setScalar(p.size*.5);matrix.rotation.set(0,i*2.399,0);matrix.updateMatrix();batch.setMatrixAt(slot,matrix.matrix);treeBatches.set(i,{batch,slot});});batch.addTo(scene);
 }
 matrix.rotation.set(0,0,0);
 const useProceduralTrees=treeBatches.size!==treeList.length;
 const rockModel=models?.get("rock"),crateModel=models?.get("crate");
 const rockInstances=rockModel?new InstancedModel(rockModel,rockList.length):null;
 const crateList=PROPS.filter(p=>!p.kind||p.kind==='crate');
 const crateInstances=crateModel?new InstancedModel(crateModel,crateList.length):null;
 treeList.forEach((p,i)=>{
   matrix.position.set(p.x,p.y+p.size/2,p.z);matrix.scale.set(treeBatches.has(i)?0:1,p.size,treeBatches.has(i)?0:1);matrix.updateMatrix();trunks.setMatrixAt(i,matrix.matrix);trunks.setColorAt(i,new THREE.Color(0x806445));
   for(let tier=0;tier<3;tier++){
     const spread=treeBatches.has(i)?0:p.size*(.66-tier*.17);
     matrix.position.set(p.x,p.y+p.size*(.72+tier*.34),p.z);
     matrix.scale.set(spread,p.size*.82,spread);
     // Rotate each tier differently so the canopy is not three aligned cones.
     matrix.rotation.set(0,(i*1.7+tier*0.9)%(Math.PI*2),0);
     matrix.updateMatrix();
     leaves.setMatrixAt(i*3+tier,matrix.matrix);
     // Darker toward the base, lighter at the crown, as light falls through.
     const base=i%3===0?0x3f6f4e:0x4f7f47;
     const shade=new THREE.Color(base).multiplyScalar(0.82+tier*0.16);
     leaves.setColorAt(i*3+tier,shade);
   }
   matrix.rotation.set(0,0,0);
 });
 rockList.forEach((p,i)=>{
  matrix.position.set(p.x,p.y,p.z);matrix.scale.set(p.size*.6,p.size*.5,p.size*.6);matrix.rotation.set(0,0,0);matrix.updateMatrix();
  if(rockInstances?.valid) rockInstances.setMatrixAt(i,matrix.matrix);
  else { matrix.position.y+=p.size*.2;matrix.updateMatrix();rocks.setMatrixAt(i,matrix.matrix);rocks.setColorAt(i,new THREE.Color(0x85928b)); }
 });
 crateList.forEach((p,i)=>{
  matrix.position.set(p.x,p.y,p.z);matrix.scale.set(p.w,p.h,p.d);matrix.updateMatrix();
  if(crateInstances?.valid)crateInstances.setMatrixAt(i,matrix.matrix);
  else {matrix.position.y+=p.h/2;matrix.updateMatrix();props.setMatrixAt(i,matrix.matrix);props.setColorAt(i,new THREE.Color(p.color));}
 });
 rockInstances?.addTo(scene);crateInstances?.addTo(scene);
 for(const batch of [...(useProceduralTrees?[trunks,leaves]:[]),...(!rockInstances?.valid?[rocks]:[]),...(!crateInstances?.valid?[props]:[])]){batch.computeBoundingSphere();batch.receiveShadow=true;batch.castShadow=true;scene.add(batch);}
 const size=MAP_HALF*2;
 const ground=new THREE.PlaneGeometry(size,size,240,240);ground.rotateX(-Math.PI/2);
 const positions=ground.getAttribute('position');const colors=[];
 for(let i=0;i<positions.count;i++) {
  const x=positions.getX(i),z=positions.getZ(i),h=terrainHeight(x,z);
  const underFloor=BUILDINGS.some(b=>{const f=buildingFootprint(b);return x>=f.x0&&x<=f.x1&&z>=f.z0&&z<=f.z1;});
  positions.setY(i,h-(underFloor?.08:0));
  const noise=(Math.sin(x*.13)*Math.cos(z*.17)+1)*.035;
  const color=new THREE.Color(h<-.1?0xbfae7b:h>10?0x638957:0x80aa63);color.multiplyScalar(.94+noise);colors.push(color.r,color.g,color.b);
 }
 ground.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));ground.computeVertexNormals();
 // Project world-space UVs so the grain tiles at a fixed real-world size
 // rather than stretching once across the entire map.
 planarUVs(ground,7);
 const terrain=new THREE.Mesh(ground,new THREE.MeshStandardMaterial({vertexColors:true,map:detail,roughness:0.95,metalness:0,envMapIntensity:0.9}));terrain.receiveShadow=true;scene.add(terrain);
 const waterMaterial=new THREE.MeshStandardMaterial({color:0x3c929f,transparent:true,opacity:.88,roughness:.3,metalness:.08,envMapIntensity:.7});
 const waterTime={value:0};
 waterMaterial.onBeforeCompile=shader=>{
  shader.uniforms.uWaterTime=waterTime;
  shader.vertexShader='varying vec3 vWaterPosition;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvWaterPosition=(modelMatrix*vec4(position,1.0)).xyz;');
  shader.fragmentShader='uniform float uWaterTime; varying vec3 vWaterPosition;\n'+shader.fragmentShader.replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal = normalize(normal + vec3(sin(vWaterPosition.x*1.7+uWaterTime)*.08, cos(vWaterPosition.z*1.3+uWaterTime*.7)*.08,0.0));');
 };
 const water=new THREE.Mesh(new THREE.CircleGeometry(1,64),waterMaterial);
 water.rotation.x=-Math.PI/2;water.scale.set(LAKE_SHAPE.rx,LAKE_SHAPE.rz,1);water.position.set(LAKE_SHAPE.x,LAKE_SURFACE,LAKE_SHAPE.z);scene.add(water);
 // Concentric, translucent ripples break up the single-color lake surface and
 // catch the sun as the player approaches the shoreline.
 for (let i = 0; i < 7; i++) {
  const ripple = new THREE.Mesh(
   new THREE.RingGeometry(.72 + i * .08, .735 + i * .08, 64),
   new THREE.MeshBasicMaterial({ color: i % 2 ? 0x9de4dc : 0x3b9eb2, transparent: true, opacity: .12, side: THREE.DoubleSide, depthWrite: false }),
  );
  ripple.rotation.x = -Math.PI / 2;
  ripple.position.set(LAKE_SHAPE.x + (i - 3) * 4.5, LAKE_SURFACE + .012, LAKE_SHAPE.z + Math.sin(i * 2.3) * 7);
  ripple.scale.set(6 + i * 1.8, 3.2 + i * 1.1, 1);
  scene.add(ripple);
 }
 // Roads are tessellated to follow the actual shared terrain, including the ridge ascent.
 function road(x1:number,z1:number,x2:number,z2:number,width:number,color:number):void {
  const length=Math.hypot(x2-x1,z2-z1),nx=-(z2-z1)/length,nz=(x2-x1)/length;
  const verts:number[]=[],indices:number[]=[],steps=Math.ceil(length/1.5),across=Math.ceil(width/1.5);
  const inside=(x:number,z:number)=>BUILDINGS.some(b=>{const f=buildingFootprint(b,.12);return x>f.x0&&x<f.x1&&z>f.z0&&z<f.z1;});
  for(let i=0;i<=steps;i++)for(let j=0;j<=across;j++) {
   const t=i/steps,side=(j/across-.5)*width,x=x1+(x2-x1)*t+nx*side,z=z1+(z2-z1)*t+nz*side;
   verts.push(x,terrainHeight(x,z)+.055,z);
  }
  for(let i=0;i<steps;i++)for(let j=0;j<across;j++) {
   const a=i*(across+1)+j,b=a+across+1;
   if([a,a+1,b,b+1].some(v=>inside(verts[v*3],verts[v*3+2])))continue;
   indices.push(a,b,a+1,a+1,b,b+1);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(indices);g.computeVertexNormals();planarUVs(g,5);
  const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color,map:detail,roughness:.96,side:THREE.DoubleSide}));m.receiveShadow=true;scene.add(m);
 }
 // Exactly the corridors the map module declares, so the surface you can see
 // and the corridor the scenery generator keeps clear are the same thing. They
 // used to be two hand-maintained lists and had drifted apart.
 for(const r of ROADS)road(r.x1,r.z1,r.x2,r.z2,r.width,r.color);
 createEnvironment(scene);
 createGroundCover(scene,models);
 // Layered, irregular silhouettes beyond the arena instead of identical pyramids.
 for(let ring=0;ring<2;ring++)for(let i=0;i<24;i++) {
  const a=i*Math.PI*2/24+ring*.16;
  const geo=new THREE.SphereGeometry(1,12,8,0,Math.PI*2,0,Math.PI/2);
  const pos=geo.getAttribute('position');const shades=[];
  for(let j=0;j<pos.count;j++){
   const vx=pos.getX(j),vy=pos.getY(j),vz=pos.getZ(j);
   const noise=1+.18*Math.sin(vx*8+i)*Math.cos(vz*9+i*2);
   pos.setXYZ(j,vx*(55+i%4*10),vy*(28+i%5*9)*noise,vz*(50+i%3*9));
   const c=new THREE.Color(ring?0x77959d:0x677e7b).multiplyScalar(.85+vy*.25);shades.push(c.r,c.g,c.b);
  }
  geo.setAttribute('color',new THREE.Float32BufferAttribute(shades,3));geo.computeVertexNormals();
  const mountain=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:true}));
  mountain.position.set(Math.cos(a)*(MAP_HALF+125+ring*100),-8,Math.sin(a)*(MAP_HALF+125+ring*100));scene.add(mountain);
 }
 const horizon=new THREE.Mesh(new THREE.PlaneGeometry(1800,1800),new THREE.MeshStandardMaterial({color:0x638e92,roughness:.6}));
 horizon.rotation.x=-Math.PI/2;horizon.position.y=-8;scene.add(horizon);

 createCars(scene);

 return {
  update(time){waterTime.value=time;},
  setTreeAlpha(sceneryIndex,alpha) {
   const slot=treeSlotBySceneryIndex.get(sceneryIndex);
   if(slot===undefined)return;
   const tree=treeBatches.get(slot);tree?.batch.setAlphaAt(tree.slot,Math.max(.08,Math.min(1,alpha)));
   const clamped=Math.max(0.12,Math.min(1,alpha));
   if(trunkAlpha.getX(slot)===clamped)return;
   trunkAlpha.setX(slot,clamped);trunkAlpha.needsUpdate=true;
   // Leaves fade harder than the trunk: the canopy is what blocks the view,
   // and a trunk you can see straight through reads as a bug rather than cover.
   for(let tier=0;tier<3;tier++)leafAlpha.setX(slot*3+tier,clamped === 1 ? 1 : Math.max(0.08,clamped*0.72));
   leafAlpha.needsUpdate=true;
  },
 };
}

/** Deterministic small plants are decorative; no invisible foliage colliders.
 * Clustered and spatially batched so a meadow does not cost one call per blade. */
function createGroundCover(scene:THREE.Scene,models?:ModelLibrary):void {
 let seed=81731;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const groups=new Map<string,{id:ModelId;points:{x:number;y:number;z:number;s:number;r:number}[]}>();
 for(let i=0;i<8500;i++) {
  const x=(rand()-.5)*MAP_HALF*1.93,z=(rand()-.5)*MAP_HALF*1.93,y=terrainHeight(x,z);
  if(y<.1||onRoad(x,z,1.2)||BUILDINGS.some(b=>{const f=buildingFootprint(b,2);return x>f.x0&&x<f.x1&&z>f.z0&&z<f.z1;}))continue;
  if(Math.sin(x*.045)*Math.cos(z*.053)<-.15)continue;
  const id:ModelId=i%17===0?'bush':i%5===0?'flower':i%3===0?'fern':'grass';
  const key=`${id},${Math.floor(x/48)},${Math.floor(z/48)}`;
  const g=groups.get(key)??{id,points:[]};g.points.push({x,y,z,s:.7+rand()*.9,r:rand()*6.28});groups.set(key,g);
 }
 const obj=new THREE.Object3D();
 for(const g of groups.values()){
  const model=models?.get(g.id);if(!model)continue;
  const batch=new InstancedModel(model,g.points.length);
  g.points.forEach((p,i)=>{obj.position.set(p.x,p.y,p.z);obj.scale.setScalar(p.s);obj.rotation.set(0,p.r,0);obj.updateMatrix();batch.setMatrixAt(i,obj.matrix);});batch.addTo(scene,false);
 }
}
