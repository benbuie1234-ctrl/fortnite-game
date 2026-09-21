import * as THREE from 'three';
import { MAP_HALF,terrainHeight,BUILDINGS,LOCATIONS } from '@shared/map';

export function createLandscape(scene:THREE.Scene):void {
 const size=MAP_HALF*2;
 const ground=new THREE.PlaneGeometry(size,size,240,240);ground.rotateX(-Math.PI/2);
 const positions=ground.getAttribute('position');const colors=[];
 for(let i=0;i<positions.count;i++) {
  const x=positions.getX(i),z=positions.getZ(i),h=terrainHeight(x,z);positions.setY(i,h);
  const noise=(Math.sin(x*.13)*Math.cos(z*.17)+1)*.035;
  const color=new THREE.Color(h<-.1?0xbfae7b:h>10?0x638957:0x80aa63);color.multiplyScalar(.94+noise);colors.push(color.r,color.g,color.b);
 }
 ground.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));ground.computeVertexNormals();
 const terrain=new THREE.Mesh(ground,new THREE.MeshLambertMaterial({vertexColors:true}));terrain.receiveShadow=true;scene.add(terrain);
 const water=new THREE.Mesh(new THREE.CircleGeometry(1,64),new THREE.MeshLambertMaterial({color:0x53b6c8,transparent:true,opacity:.72}));
 water.rotation.x=-Math.PI/2;water.scale.set(49,75,1);water.position.set(-251,.025,170);scene.add(water);
 // Roads are tessellated to follow the actual shared terrain, including the ridge ascent.
 function road(x1:number,z1:number,x2:number,z2:number,width:number,color:number):void {
  const length=Math.hypot(x2-x1,z2-z1),nx=-(z2-z1)/length*width/2,nz=(x2-x1)/length*width/2;
  const verts=[],indices=[];const steps=Math.ceil(length/3);
  for(let i=0;i<=steps;i++){const t=i/steps,x=x1+(x2-x1)*t,z=z1+(z2-z1)*t;for(const sign of [-1,1])verts.push(x+nx*sign,terrainHeight(x+nx*sign,z+nz*sign)+.04,z+nz*sign);if(i<steps){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(indices);g.computeVertexNormals();
  const m=new THREE.Mesh(g,new THREE.MeshLambertMaterial({color,side:THREE.DoubleSide}));m.receiveShadow=true;scene.add(m);
 }
 // Main ring and central cross create several routes between every district.
 road(-240,-156,240,-156,9,0x667477);road(-240,156,240,156,9,0x667477);
 road(-156,-240,-156,240,9,0x667477);road(156,-240,156,240,9,0x667477);
 road(0,-300,0,300,10,0xbba97e);road(-300,0,300,0,10,0xbba97e);
 for(const coordinate of [-216,-183,-150,-117,-84]) {
  road(coordinate,-222,coordinate,-84,6,0x667477);road(-222,coordinate,-84,coordinate,6,0x667477);
 }
 for(const z of [-210,-168,-126,-84])road(96,z,222,z,5,0xc5b491);
 for(const poi of LOCATIONS){road(poi.x,poi.z,poi.x,0,5,0xbba97e);road(poi.x,poi.z,0,poi.z,5,0xbba97e);}
 // Thin facade accents read as window frames; open cells remain open routes.
 const box=new THREE.BoxGeometry(1,1,1),mat=new THREE.MeshLambertMaterial({color:0xffffff});
 const details:{x:number;y:number;z:number;sx:number;sy:number;sz:number;color:number}[]=[];
 for(const b of BUILDINGS) {
  for(let level=0;level<b.floors;level++)for(let x=0;x<b.w;x++) {
   if(x===Math.floor(b.w/2)&&level===0)continue;
   if(level>0&&x%3===1)continue;
   for(const side of [0,b.d])details.push({x:(b.x+x+.5)*3,y:(b.base+level)*3+1.8,z:(b.z+side)*3+(side===0?-.14:.14),sx:1.65,sy:1.1,sz:.03,color:0x4a7384});
  }
  details.push({x:(b.x+b.w/2)*3,y:b.base*3+2.65,z:b.z*3-.7,sx:3.6,sy:.16,sz:1.6,color:b.style==='house'?0xf3e4c6:0x4b6978});
 }
 const facade=new THREE.InstancedMesh(box,mat,details.length),dummy=new THREE.Object3D();
 details.forEach((d,i)=>{dummy.position.set(d.x,d.y,d.z);dummy.scale.set(d.sx,d.sy,d.sz);dummy.updateMatrix();facade.setMatrixAt(i,dummy.matrix);facade.setColorAt(i,new THREE.Color(d.color));});facade.computeBoundingSphere();scene.add(facade);
 // Names on the landscape are visible approach landmarks.
 for(const poi of LOCATIONS){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=80;const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#102d3acc';ctx.fillRect(0,0,512,80);ctx.fillStyle='#fff';ctx.font='bold 30px system-ui';ctx.textAlign='center';ctx.fillText(poi.name,256,51);
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:true}));sprite.position.set(poi.x,terrainHeight(poi.x,poi.z)+22,poi.z);sprite.scale.set(28,4.4,1);scene.add(sprite);
 }
 // Mountain backdrop is beyond the playable boundary, never mistaken for traversable cover.
 for(let i=0;i<20;i++){
  const a=i*Math.PI*2/20;const mountain=new THREE.Mesh(new THREE.ConeGeometry(55,60+i%4*18,5),new THREE.MeshLambertMaterial({color:i%2?0x688693:0x789b9f}));
  mountain.position.set(Math.cos(a)*520,14,Math.sin(a)*520);scene.add(mountain);
 }
}
