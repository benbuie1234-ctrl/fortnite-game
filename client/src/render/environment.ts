import * as THREE from 'three';
import { BUILDINGS, PROPS, ROADS, DOCK, ARCHITECTURE, terrainHeight, buildingFootprint } from '@shared/map';
import { TILE } from '@shared/constants';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Spatially batched architectural kit: trim, inset windows, shutters, roof
 * battens, storefronts and furniture. All routes use shared map geometry. */
class Kit {
 private batches=new Map<string,{geo:THREE.BufferGeometry;mat:THREE.MeshStandardMaterial;items:{matrix:THREE.Matrix4;color:THREE.Color}[]}>();
 private cube=new THREE.BoxGeometry(1,1,1);
 private round=new RoundedBoxGeometry(1,1,1,2,.07);
 private cylinder=new THREE.CylinderGeometry(.5,.5,1,16);
 private stone=new THREE.IcosahedronGeometry(.5,1);
 private matte=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.82,envMapIntensity:.65});
 private metal=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.48,metalness:.32,envMapIntensity:.7});
 private glass=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.3,metalness:.18,envMapIntensity:.65});
 add(x:number,y:number,z:number,w:number,h:number,d:number,color:number,shape:'box'|'round'|'stone'|'cylinder'='box',yaw=0,finish:'matte'|'metal'|'glass'='matte',roll=0) {
  const key=`${Math.floor(x/48)},${Math.floor(z/48)},${shape},${finish}`;
  const geo=shape==='box'?this.cube:shape==='round'?this.round:shape==='cylinder'?this.cylinder:this.stone;
  const b=this.batches.get(key)??{geo,mat:this[finish],items:[]};
  b.items.push({matrix:new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(0,yaw,roll)),new THREE.Vector3(w,h,d)),color:new THREE.Color(color)});this.batches.set(key,b);
 }
 finish(scene:THREE.Scene) {for(const b of this.batches.values()){const m=new THREE.InstancedMesh(b.geo,b.mat,b.items.length);b.items.forEach((p,i)=>{m.setMatrixAt(i,p.matrix);m.setColorAt(i,p.color);});m.computeBoundingSphere();m.castShadow=true;m.receiveShadow=true;scene.add(m);}}
}
const trim=0xeee0c4,timber=0x665044,iron=0x394c55,glass=0x426f7d;
export function createEnvironment(scene:THREE.Scene):void {
 const k=new Kit();
 for(const p of ARCHITECTURE)k.add(p.x,p.y,p.z,p.w,p.h,p.d,p.color);
 BUILDINGS.forEach((b,index)=>{
  const x=b.x*TILE,z=b.z*TILE,y=b.base*TILE,w=b.w*TILE,d=b.d*TILE,h=b.floors*TILE;
  // Thin paving skirts ground the structures and distinguish streets from grass.
  if(b.style!=='cabin') {
   for(const zz of [z-.7,z+d+.7])k.add(x+w/2,y+.025,zz,w+2,.05,1.4,0xb5b4a0);
   for(const xx of [x-.7,x+w+.7])k.add(xx,y+.025,z+d/2,1.4,.05,d,0xb5b4a0);
   for(let q=0;q<=w;q+=1.5)for(const zz of [z-.7,z+d+.7])k.add(x+q,y+.056,zz,.022,.012,1.35,0x898e83);
  }
  const wood=b.style==='cabin',industrial=b.style==='warehouse',frame=wood?timber:industrial?iron:trim;
  const face=(side:number,u:number,v:number,su:number,sv:number,depth:number,color:number,finish:'matte'|'metal'|'glass'='matte')=>{
   if(side<2)k.add(x+u,y+v,z+(side===0?-.17:d+.17),su,sv,depth,color,'box',0,finish);
   else k.add(x+(side===2?-.17:w+.17),y+v,z+u,depth,sv,su,color,'box',0,finish);
  };
  for(let side=0;side<4;side++) {
   const cells=side<2?b.w:b.d,length=cells*TILE;
   for(let f=1;f<=b.floors;f++) {
    face(side,length/2,f*TILE-.20,length+.45,.3,.42,frame);
    face(side,length/2,f*TILE-.52,length+.2,.12,.28,wood?0x4e4035:0x9e9a8b);
   }
   for(let f=0;f<b.floors;f++)for(let c=0;c<cells;c++) {
    const open=side<2?(f===0?c===Math.floor(b.w/2):c%3===1):c%3===1;
    const center=(c+.5)*TILE,base=f*TILE;
    if(open){
     const door=side<2&&f===0,opening=door?2.4:TILE-1.8,low=door?0:1.1,high=door?3.3:TILE-1.4;
     for(const s of [-1,1])face(side,center+s*(opening/2+.05),base+(low+high)/2,.16,high-low+.2,.4,frame);
     face(side,center,base+high+.08,opening+.32,.16,.42,frame);
     if(!door)face(side,center,base+low-.04,opening+.4,.18,.55,frame);
     continue;
    }
    face(side,center,base+.28,TILE-.12,.35,.30,frame);
    if(wood){for(let v=.65;v<TILE-.6;v+=.48)face(side,center,base+v,TILE-.08,.08,.25,0x806044);}
    else if(industrial){for(let u=.3;u<TILE;u+=.55)face(side,c*TILE+u,base+TILE/2,.08,TILE-.6,.26,0x647e85);}
    else {for(let v=.8;v<1.65;v+=.35)face(side,center,base+v,TILE-.15,.04,.24,0xa99b87);}
    const wh=industrial?1.15:2.15,ww=industrial?TILE*.68:2.5,wy=base+(industrial?4.5:3.35);
    face(side,center,wy,ww+.3,wh+.3,.32,frame);face(side,center,wy,ww,wh,.36,glass,'glass');
    face(side,center,wy,.09,wh,.40,frame);face(side,center,wy,ww,.09,.40,frame);
    face(side,center,wy-wh/2-.2,ww+.55,.16,.64,frame);face(side,center,wy+wh/2+.2,ww+.4,.12,.43,frame);
    if(b.style==='house')for(const dir of [-1,1]) {
     face(side,center+dir*(ww/2+.48),wy,.52,wh+.12,.34,index%2?0x668e87:0x9d6653);
     for(let sl=0;sl<6;sl++)face(side,center+dir*(ww/2+.48),wy-wh/2+sl*wh/6,.47,.055,.4,trim);
    }
   }
   for(const u of [.10,length-.10])face(side,u,h/2,.22,h,.35,frame);
   face(side,length-.4,h/2,.085,h,.42,iron,'metal');
  }
  const doorX=x+(Math.floor(b.w/2)+.5)*TILE;
  k.add(doorX,y+TILE-.15,z-.85,TILE+.4,.22,1.8,industrial?iron:wood?timber:trim);
  if(b.style==='city') {
   for(const zz of [z,z+d])k.add(x+w/2,y+h+.12,zz,w+.3,.24,.45,trim);
   for(const xx of [x,x+w])k.add(xx,y+h+.12,z+d/2,.45,.24,d,trim);
   for(let c=0;c<b.w;c++)if(c!==Math.floor(b.w/2)) {
    const cx=x+(c+.5)*TILE;k.add(cx,y+4.95,z-.8,TILE-.4,.16,1.6,trim);
    for(let stripe=0;stripe<8;stripe++)k.add(cx-TILE/2+.45+stripe*.65,y+4.77,z-1.55,.35,.40,.08,index%2?0x4d8a91:0xbc6d54);
   }
  }
  if(wood||b.style==='house') {
   for(let zi=0;zi<=d;zi+=.75)for(let side=0;side<2;side++) {
    const run=w/2;k.add(x+(side===0?run/2:w-run/2),y+h+run/2+.12,z+zi,Math.SQRT2*run,.10,.09,wood?0x564942:0x754f49,'box',0,'matte',side===0?Math.PI/4:-Math.PI/4);
   }
   k.add(x+w/2,y+h+w/2+.12,z+d/2,.24,.24,d+.4,wood?timber:0xb67c5c,'round');
  }
  for(const s of [-1,1]) {
   k.add(doorX+s*(TILE/2+.3),y+3.4,z-.36,.22,.7,.35,iron,'round');
   k.add(doorX+s*(TILE/2+.3),y+3.4,z-.56,.14,.44,.09,0xffdc95);
  }
  sign(scene,b.style==='city'?['CORNER MARKET','ATLAS WORKS','THE POST','LOFT 04','OUTPOST'][index%5]:industrial?'TIDAL / FREIGHT':wood?'PINEWATCH':String(101+index),doorX,y+TILE-.65,z-.42,b.style==='house'?1.1:4.6,.65,industrial?iron:0x365561);
 });
 for(const p of PROPS) {
  if(!p.kind||p.kind==='crate')continue;
  const {x,y,z,w,h,d}=p;
  if(p.kind==='fence') {
   for(let dz=-d/2+.18;dz<d/2;dz+=.55)k.add(x,y+h/2,z+dz,w,h,.18,trim,'round');
   for(const v of [.25,.7])k.add(x,y+h*v,z,w*.65,.12,d,0xd0bea0);
  } else if(p.kind==='bench') {
   for(const dx of [-.32,0,.32])k.add(x+dx,y+h-.12,z,.26,.18,d,0x9a7351,'round');
   for(const dz of [-d*.36,d*.36])k.add(x,y+h/2,z+dz,w*.7,h,.16,iron);
  } else if(p.kind==='clock') {
   k.add(x,y+h/2,z,w*.88,h,d*.88,0xcdbb9b);
   for(const v of [.2,.6,8.7,11.7])k.add(x,y+v,z,w,.25,d,trim,'round');
   for(const xx of [-1,1])for(const zz of [-1,1])k.add(x+xx*w*.42,y+h/2,z+zz*d*.42,.18,h,.18,0xa99475);
   for(const side of [-1,1]){
    k.add(x,y+10,z+side*d*.445,1.9,1.9,.08,iron,'round');k.add(x,y+10,z+side*d*.465,1.65,1.65,.04,trim);
    k.add(x,y+10.3,z+side*d*.49,.08,.7,.035,iron);k.add(x+.3,y+10,z+side*d*.49,.65,.08,.035,iron);
   }
  } else if(p.kind==='cabinet') {
   k.add(x,y+h/2,z,w,h,d,0x9a7959,'round');
   for(let v=0;v<3;v++){k.add(x,y+.3+v*.6,z-d/2-.015,w*.88,.48,.035,0xb89770);k.add(x,y+.3+v*.6,z-d/2-.04,w*.25,.05,.04,iron,'box',0,'metal');}
  } else if(p.kind==='vent') {
   k.add(x,y+h/2,z,w,h,d,0x8b9a98,'round',0,'metal');
   for(let v=.2;v<h;v+=.16)k.add(x,y+v,z-d/2-.015,w*.82,.055,.04,iron);
   for(const dx of [-.7,.7]){k.add(x+dx,y+h+.015,z,.9,.04,.9,iron,'cylinder');for(let q=0;q<4;q++)k.add(x+dx,y+h+.04,z,.72,.02,.06,0x9aaba4,'box',q*Math.PI/4,'metal');}
  } else if(p.kind==='barrel') {
   k.add(x,y+h/2,z,w,h,d,0x698d91,'cylinder',0,'metal');
   for(const v of [.08,.25,.75,.92])k.add(x,y+h*v,z,w*1.02,.055,d*1.02,iron,'cylinder');
   k.add(x+.2,y+h+.015,z,.15,.02,.15,iron,'cylinder');
  } else {
   k.add(x,y+h*.45,z,w,h*.9,d,0xac8460,'round');k.add(x,y+h*.86,z,w+.02,.14,d+.02,0xcfb087);k.add(x,y+h*.94,z,w*.82,.1,d*.82,0x524839);
   for(let i=0;i<5;i++)k.add(x+Math.sin(i*2.4)*w*.24,y+h,z+Math.cos(i*2.4)*d*.24,.6,.25,.6,0x719555,'stone');
  }
 }
 for(const r of ROADS.filter(r=>r.color===0x667477)) {
  const len=Math.hypot(r.x2-r.x1,r.z2-r.z1),dx=(r.x2-r.x1)/len,dz=(r.z2-r.z1)/len;
  for(let t=4;t<len;t+=7) {
   const x=r.x1+dx*t,z=r.z1+dz*t;
   if(BUILDINGS.some(b=>{const f=buildingFootprint(b,2);return x>f.x0&&x<f.x1&&z>f.z0&&z<f.z1;}))continue;
   for(let q=0;q<3;q++){const xx=x+dx*q,zz=z+dz*q;k.add(xx,terrainHeight(xx,zz)+.07,zz,.15,.015,.95,0xe7d2a1,'box',Math.atan2(dx,dz));}
  }
 }
 // Dock planking and open timber rails share the same extents as collision.
 for(let x=DOCK.x0;x<DOCK.x1;x+=.65)k.add(x+.31,.045,(DOCK.z0+DOCK.z1)/2,.59,.08,DOCK.z1-DOCK.z0,0x93785c);
 for(const z of [DOCK.z0,DOCK.z1]){
  for(const y of [.42,1.08])k.add((DOCK.x0+DOCK.x1)/2,y,z,DOCK.x1-DOCK.x0,.14,.22,0xb09a78);
  for(let x=DOCK.x0;x<=DOCK.x1;x+=3)k.add(x,.57,z,.23,1.15,.23,timber);
 }
 k.finish(scene);
}
function sign(scene:THREE.Scene,text:string,x:number,y:number,z:number,w:number,h:number,color:number) {
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;const c=canvas.getContext('2d')!;
 c.fillStyle=`#${color.toString(16).padStart(6,'0')}`;c.fillRect(0,0,512,96);c.strokeStyle='#e6d7b7';c.lineWidth=4;c.strokeRect(8,8,496,80);c.fillStyle='#fff2d3';c.font='600 38px sans-serif';c.textAlign='center';c.fillText(text,256,62);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map:texture,roughness:.8}));m.position.set(x,y,z);m.rotation.y=Math.PI;scene.add(m);
}
