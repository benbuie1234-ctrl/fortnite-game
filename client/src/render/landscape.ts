import * as THREE from 'three';
import { MAP_HALF,terrainHeight,BUILDINGS,LOCATIONS,SCENERY,PROPS,ROADS,LAKE_SHAPE,LAKE_SURFACE } from '@shared/map';
import { treePerchHeight } from '@shared/arena';
import { TREE_PERCH_RADIUS,TREE_PERCH_THICKNESS,TILE } from '@shared/constants';
import { getTextures, planarUVs } from './textures';
import { createCars } from './cars';
import { InstancedModel, type ModelLibrary } from './models';

export interface Landscape {
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
 // A flattened disc of branches at the perch height, so the platform you can
 // stand on is something you can see before you try to climb onto it.
 const branchGeo=new THREE.CylinderGeometry(TREE_PERCH_RADIUS,TREE_PERCH_RADIUS*.8,TREE_PERCH_THICKNESS,7);
 const detail=getTextures(1).detail;
 const solidMaterial=new THREE.MeshStandardMaterial({color:0xffffff,map:detail,roughness:0.88,metalness:0,envMapIntensity:0.9});
 const treeList=SCENERY.filter(p=>p.kind==='tree'),rockList=SCENERY.filter(p=>p.kind==='rock');
 const foliageMaterial=makeFoliageMaterial(solidMaterial);
 const trunks=new THREE.InstancedMesh(trunkGeo,foliageMaterial,treeList.length);
 const leaves=new THREE.InstancedMesh(leafGeo,foliageMaterial,treeList.length*3);
 const branches=new THREE.InstancedMesh(branchGeo,foliageMaterial,treeList.length);
 const trunkAlpha=addAlphaAttribute(trunkGeo,treeList.length);
 const leafAlpha=addAlphaAttribute(leafGeo,treeList.length*3);
 const branchAlpha=addAlphaAttribute(branchGeo,treeList.length);
 // SCENERY holds trees and rocks interleaved; everything downstream addresses
 // a tree by its SCENERY index, so keep the translation in one place.
 const treeSlotBySceneryIndex=new Map<number,number>();
 SCENERY.forEach((p,i)=>{if(p.kind==='tree')treeSlotBySceneryIndex.set(i,treeSlotBySceneryIndex.size);});
 const rocks=new THREE.InstancedMesh(rockGeo,solidMaterial,rockList.length);
 const props=new THREE.InstancedMesh(propGeo,solidMaterial,PROPS.length);
 const matrix=new THREE.Object3D();

 // A real tree model replaces the box-and-cones version. Same placement data
 // either way, so the fallback and the upgrade always agree on where trees are.
 const treeModel=models?.get('tree');
 const treeInstances=treeModel?new InstancedModel(treeModel,treeList.length):null;
 if(treeInstances?.valid) {
  treeList.forEach((p,i)=>{
   matrix.position.set(p.x,p.y,p.z);
   matrix.scale.setScalar(p.size*0.5);
   matrix.rotation.set(0,(i*2.399)%(Math.PI*2),0); // vary facing so a forest is not a grid of clones
   matrix.updateMatrix();
   treeInstances.setMatrixAt(i,matrix.matrix);
  });
  treeInstances.addTo(scene);
  matrix.rotation.set(0,0,0);
 }

 const useProceduralTrees=!treeInstances?.valid;
 if(useProceduralTrees) treeList.forEach((p,i)=>{
   matrix.position.set(p.x,p.y+p.size/2,p.z);matrix.scale.set(1,p.size,1);matrix.updateMatrix();trunks.setMatrixAt(i,matrix.matrix);trunks.setColorAt(i,new THREE.Color(0x806445));
   matrix.position.set(p.x,p.y+treePerchHeight(p.size)+TREE_PERCH_THICKNESS/2,p.z);matrix.scale.set(1,1,1);matrix.updateMatrix();
   branches.setMatrixAt(i,matrix.matrix);branches.setColorAt(i,new THREE.Color(0x6a5238));
   for(let tier=0;tier<3;tier++){
     const spread=p.size*(.66-tier*.17);
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
 rockList.forEach((p,i)=>{matrix.position.set(p.x,p.y+p.size*.2,p.z);matrix.scale.set(p.size*.62,p.size*.5,p.size*.62);matrix.rotation.set(i*.7%1.2,i*2.1%(Math.PI*2),i*.4%.9);matrix.updateMatrix();rocks.setMatrixAt(i,matrix.matrix);rocks.setColorAt(i,new THREE.Color(i%2?0x8d9aa0:0x9aa49c));});matrix.rotation.set(0,0,0);
 PROPS.forEach((p,i)=>{matrix.position.set(p.x,p.y+p.h/2,p.z);matrix.scale.set(p.w,p.h,p.d);matrix.updateMatrix();props.setMatrixAt(i,matrix.matrix);props.setColorAt(i,new THREE.Color(p.color));});
 // Rocks always use the procedural boxes; trunks and leaves only when no
 // tree model was supplied, or they would be drawn on top of the real trees.
 for(const batch of (useProceduralTrees?[trunks,leaves,branches,rocks,props]:[rocks,props])){batch.computeBoundingSphere();batch.receiveShadow=true;batch.castShadow=true;scene.add(batch);}
 const size=MAP_HALF*2;
 const ground=new THREE.PlaneGeometry(size,size,240,240);ground.rotateX(-Math.PI/2);
 const positions=ground.getAttribute('position');const colors=[];
 for(let i=0;i<positions.count;i++) {
  const x=positions.getX(i),z=positions.getZ(i),h=terrainHeight(x,z);positions.setY(i,h);
  const noise=(Math.sin(x*.13)*Math.cos(z*.17)+1)*.035;
  const color=new THREE.Color(h<-.1?0xbfae7b:h>10?0x638957:0x80aa63);color.multiplyScalar(.94+noise);colors.push(color.r,color.g,color.b);
 }
 ground.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));ground.computeVertexNormals();
 // Project world-space UVs so the grain tiles at a fixed real-world size
 // rather than stretching once across the entire map.
 planarUVs(ground,7);
 const terrain=new THREE.Mesh(ground,new THREE.MeshStandardMaterial({vertexColors:true,map:detail,roughness:0.95,metalness:0,envMapIntensity:0.9}));terrain.receiveShadow=true;scene.add(terrain);
 const water=new THREE.Mesh(new THREE.CircleGeometry(1,64),new THREE.MeshStandardMaterial({color:0x53b6c8,transparent:true,opacity:.78,roughness:0.08,metalness:0.25,envMapIntensity:1.4}));
 water.rotation.x=-Math.PI/2;water.scale.set(LAKE_SHAPE.rx,LAKE_SHAPE.rz,1);water.position.set(LAKE_SHAPE.x,LAKE_SURFACE,LAKE_SHAPE.z);scene.add(water);
 // Roads are tessellated to follow the actual shared terrain, including the ridge ascent.
 function road(x1:number,z1:number,x2:number,z2:number,width:number,color:number):void {
  const length=Math.hypot(x2-x1,z2-z1),nx=-(z2-z1)/length*width/2,nz=(x2-x1)/length*width/2;
  const verts=[],indices=[];const steps=Math.ceil(length/3);
  for(let i=0;i<=steps;i++){const t=i/steps,x=x1+(x2-x1)*t,z=z1+(z2-z1)*t;for(const sign of [-1,1])verts.push(x+nx*sign,terrainHeight(x+nx*sign,z+nz*sign)+.04,z+nz*sign);if(i<steps){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(indices);g.computeVertexNormals();
  const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color,side:THREE.DoubleSide}));m.receiveShadow=true;scene.add(m);
 }
 // Exactly the corridors the map module declares, so the surface you can see
 // and the corridor the scenery generator keeps clear are the same thing. They
 // used to be two hand-maintained lists and had drifted apart.
 for(const r of ROADS)road(r.x1,r.z1,r.x2,r.z2,r.width,r.color);
 // Thin facade accents read as window frames; open cells remain open routes.
 const box=new THREE.BoxGeometry(1,1,1),mat=new THREE.MeshStandardMaterial({color:0xffffff});
 const details:{x:number;y:number;z:number;sx:number;sy:number;sz:number;color:number}[]=[];
 for(const b of BUILDINGS) {
  for(let level=0;level<b.floors;level++)for(let x=0;x<b.w;x++) {
   if(x===Math.floor(b.w/2)&&level===0)continue;
   if(level>0&&x%3===1)continue;
   for(const side of [0,b.d])details.push({x:(b.x+x+.5)*TILE,y:(b.base+level)*TILE+TILE*.55,z:(b.z+side)*TILE+(side===0?-.2:.2),sx:TILE*.55,sy:TILE*.36,sz:.05,color:0x4a7384});
  }
  details.push({x:(b.x+b.w/2)*TILE,y:b.base*TILE+TILE*.88,z:b.z*TILE-1.2,sx:TILE*1.2,sy:.26,sz:2.6,color:b.style==='house'?0xf3e4c6:0x4b6978});
  if(b.style==='house') {
   // Fascia, front steps and a contrasting door surround make each home legible.
   details.push({x:(b.x+b.w/2)*TILE,y:(b.base+b.floors)*TILE-.2,z:b.z*TILE-.26,sx:b.w*TILE+.5,sy:.3,sz:.3,color:0xf2e6c9});
   for(const dx of [-TILE*.45,TILE*.45])details.push({x:(b.x+Math.floor(b.w/2)+.5)*TILE+dx,y:b.base*TILE+TILE*.5,z:b.z*TILE-.26,sx:.2,sy:TILE,sz:.2,color:0xf2e6c9});
  }
 }
 const facade=new THREE.InstancedMesh(box,mat,details.length),dummy=new THREE.Object3D();
 details.forEach((d,i)=>{dummy.position.set(d.x,d.y,d.z);dummy.scale.set(d.sx,d.sy,d.sz);dummy.updateMatrix();facade.setMatrixAt(i,dummy.matrix);facade.setColorAt(i,new THREE.Color(d.color));});facade.computeBoundingSphere();scene.add(facade);
 // Door numbers and a pair of street names give the neighborhood useful callouts.
 BUILDINGS.filter(b=>b.style==='house').forEach((b,i)=>{
   const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
   const ctx=canvas.getContext('2d')!;ctx.fillStyle='#24454d';ctx.fillRect(0,0,128,64);ctx.fillStyle='#fff4d8';ctx.font='bold 34px system-ui';ctx.textAlign='center';ctx.fillText(String(101+i),64,45);
   const sign=new THREE.Mesh(new THREE.PlaneGeometry(1.3,.65),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),side:THREE.DoubleSide}));
   sign.position.set((b.x+Math.floor(b.w/2)+.5)*TILE,b.base*TILE+TILE*.75,b.z*TILE-.3);sign.rotation.y=Math.PI;scene.add(sign);
 });
 // Names on the landscape are visible approach landmarks.
 for(const poi of LOCATIONS){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=80;const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#102d3acc';ctx.fillRect(0,0,512,80);ctx.fillStyle='#fff';ctx.font='bold 30px system-ui';ctx.textAlign='center';ctx.fillText(poi.name,256,51);
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:true}));sprite.position.set(poi.x,terrainHeight(poi.x,poi.z)+34,poi.z);sprite.scale.set(38,6,1);scene.add(sprite);
 }
 // Mountain backdrop is beyond the playable boundary, never mistaken for traversable cover.
 for(let i=0;i<20;i++){
  const a=i*Math.PI*2/20;const mountain=new THREE.Mesh(new THREE.ConeGeometry(55,60+i%4*18,5),new THREE.MeshStandardMaterial({color:i%2?0x688693:0x789b9f}));
  mountain.position.set(Math.cos(a)*(MAP_HALF*1.5),14,Math.sin(a)*(MAP_HALF*1.5));scene.add(mountain);
 }

 createCars(scene);

 return {
  setTreeAlpha(sceneryIndex,alpha) {
   const slot=treeSlotBySceneryIndex.get(sceneryIndex);
   if(slot===undefined||!useProceduralTrees)return;
   const clamped=Math.max(0.12,Math.min(1,alpha));
   if(trunkAlpha.getX(slot)===clamped)return;
   trunkAlpha.setX(slot,clamped);trunkAlpha.needsUpdate=true;
   branchAlpha.setX(slot,clamped);branchAlpha.needsUpdate=true;
   // Leaves fade harder than the trunk: the canopy is what blocks the view,
   // and a trunk you can see straight through reads as a bug rather than cover.
   for(let tier=0;tier<3;tier++)leafAlpha.setX(slot*3+tier,Math.max(0.08,clamped*0.72));
   leafAlpha.needsUpdate=true;
  },
 };
}
