/** Rebuild shipped models from the official Kenney archives extracted into ASSET_SOURCE.
 * ASSET_SOURCE defaults to ../assets in the development workspace.
 * The original Clutch ranger is authored below, in metres, with named articulation joints.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
const source=process.env.ASSET_SOURCE || '../assets';
const out='client/public/models';await fs.mkdir(out,{recursive:true});
await MeshoptEncoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const files={tree:['nature-kit','Models/GLTF format/tree_pineTallC.glb'],rock:['nature-kit','Models/GLTF format/rock_largeD.glb'],grass:['nature-kit','Models/GLTF format/grass.glb'],weapon_ar:['blaster-kit','Models/GLB format/blaster-e.glb'],weapon_shotgun:['blaster-kit','Models/GLB format/blaster-b.glb'],weapon_smg:['blaster-kit','Models/GLB format/blaster-a.glb'],weapon_sniper:['blaster-kit','Models/GLB format/blaster-n.glb'],crate:['blaster-kit','Models/GLB format/crate-medium.glb']};
let bytes=0;
for(const [id,[pack,file]] of Object.entries(files)){
 try {
 const doc=await io.read(path.join(source,pack,file));
 await doc.transform(dedup(),prune(),meshopt({encoder:MeshoptEncoder,level:'high'}));
 await io.write(`${out}/${id}.glb`,doc);const stat=await fs.stat(`${out}/${id}.glb`);bytes+=stat.size;console.log(id,stat.size);
 }catch(e){if(id==='grass'&&e.code==='ENOENT'){delete files.grass;continue;}throw e;}
}
// GLTFExporter only needs FileReader for assembling its binary Blob in Node.
globalThis.FileReader=class {readAsArrayBuffer(blob){blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}readAsDataURL(blob){blob.arrayBuffer().then(v=>{this.result=`data:${blob.type};base64,${Buffer.from(v).toString('base64')}`;this.onloadend?.();});}};
const primary=new THREE.MeshStandardMaterial({color:0x426e76,roughness:.68});primary.name='Armor';
const dark=new THREE.MeshStandardMaterial({color:0x182d3c,roughness:.88});dark.name='Suit';
const accent=new THREE.MeshStandardMaterial({color:0xcfe780,roughness:.5});accent.name='Accent';
const metal=new THREE.MeshStandardMaterial({color:0xaabdb5,roughness:.38,metalness:.35});
const visor=new THREE.MeshStandardMaterial({color:0x162e42,roughness:.18,metalness:.65,emissive:0x123d51,emissiveIntensity:.25});
const rig=new THREE.Group();rig.name='Ranger';
function mesh(parent,name,geo,mat,x=0,y=0,z=0){const m=new THREE.Mesh(geo,mat);m.name=name;m.position.set(x,y,z);parent.add(m);return m;}
function box(p,n,w,h,d,m,x=0,y=0,z=0){return mesh(p,n,new THREE.BoxGeometry(w,h,d),m,x,y,z);}
function joint(p,n,x=0,y=0,z=0){const g=new THREE.Group();g.name=n;g.position.set(x,y,z);p.add(g);return g;}
for(const [name,side] of [['L',-1],['R',1]]){
 const hip=joint(rig,'hip'+name,side*.13,.78,0);
 mesh(hip,'thigh'+name,new THREE.CylinderGeometry(.105,.087,.4,8),dark,0,-.2);
 box(hip,'thighPlate'+name,.165,.25,.08,primary,0,-.17,.07);
 const knee=joint(hip,'knee'+name,0,-.4);
 mesh(knee,'kneecap'+name,new THREE.IcosahedronGeometry(.105,0),metal,0,-.025,.045);
 mesh(knee,'shin'+name,new THREE.CylinderGeometry(.083,.065,.38,8),dark,0,-.19);
 box(knee,'shinPlate'+name,.135,.22,.065,primary,0,-.19,.064);
 const foot=joint(knee,'foot'+name,0,-.38);
 box(foot,'boot'+name,.195,.10,.29,dark,0,.05,.055);
 box(foot,'sole'+name,.20,.03,.30,metal,0,.015,.055);
 box(foot,'bootStripe'+name,.201,.025,.08,accent,0,.072,.08);
}
const torso=mesh(rig,'torso',new THREE.CylinderGeometry(.265,.205,.62,8),dark,0,1.09);
box(torso,'chest',.39,.32,.13,primary,0,.10,.19);
box(torso,'chestLight',.20,.025,.02,accent,0,.11,.265);
box(torso,'abdomen',.30,.14,.10,primary,0,-.16,.17);
box(torso,'backpack',.32,.36,.16,primary,0,.04,-.20);
box(torso,'packStripe',.04,.25,.02,accent,.09,.04,-.29);
for(const side of [-1,1])box(torso,'beltPouch'+side,.11,.12,.14,metal,side*.185,-.24,.12);
for(const [name,side] of [['L',-1],['R',1]]){
 const arm=box(rig,'arm'+name,.145,.56,.15,dark,side*.32,1.36);arm.geometry.translate(0,-.28,0);
 mesh(arm,'shoulder'+name,new THREE.IcosahedronGeometry(.15,1),primary,0,-.07);
 box(arm,'bracer'+name,.17,.18,.17,primary,0,-.39);
 box(arm,'wristStripe'+name,.176,.035,.176,accent,0,-.46);
 box(arm,'glove'+name,.15,.10,.16,dark,0,-.52);
}
const head=joint(rig,'head',0,1.40);
mesh(head,'helmet',new THREE.IcosahedronGeometry(.213,1),primary,0,.19);
box(head,'visor',.32,.115,.12,visor,0,.22,.16);
box(head,'visorBrow',.34,.035,.14,metal,0,.29,.16);
box(head,'chin',.23,.065,.095,dark,0,.075,.16);
for(const side of [-1,1])mesh(head,'ear'+side,new THREE.CylinderGeometry(.068,.068,.035,8),metal,side*.198,.19).rotation.z=Math.PI/2;
// Clips are upper-body secondary motion. Gameplay drives legs and head after
// animation, retaining precise feet/capsule alignment at every crouch fraction.
const tracks=[new THREE.NumberKeyframeTrack('backpack.rotation[z]',[0,1,2],[0,.015,0])];
const animations=[new THREE.AnimationClip('idle',2,tracks),new THREE.AnimationClip('run',.7,[new THREE.NumberKeyframeTrack('backpack.rotation[z]',[0,.175,.35,.525,.7],[0,.055,0,-.055,0])]),new THREE.AnimationClip('jump',.8,[new THREE.NumberKeyframeTrack('backpack.rotation[x]',[0,.4,.8],[0,.08,0])])];
// Export quaternion tracks (glTF does not support Euler tracks).
for(const clip of animations)clip.tracks=clip.tracks.map(t=>{const axis=t.name.endsWith('[z]')?'z':'x';const vals=[];for(const a of t.values){const e=new THREE.Euler();e[axis]=a;vals.push(...new THREE.Quaternion().setFromEuler(e).toArray());}return new THREE.QuaternionKeyframeTrack('backpack.quaternion',Array.from(t.times),vals);});
const data=await new GLTFExporter().parseAsync(rig,{binary:true,animations});
const doc=await io.readBinary(new Uint8Array(data));await doc.transform(dedup(),prune(),meshopt({encoder:MeshoptEncoder,level:'high'}));await io.write(`${out}/ranger.glb`,doc);
const manifest={models:Object.fromEntries([...Object.keys(files).map(id=>[id,`${id}.glb`]),['character','ranger.glb']])};await fs.writeFile(`${out}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
for(const name of ['nature-kit','blaster-kit'])await fs.copyFile(path.join(source,name,'License.txt'),`${out}/${name}-LICENSE.txt`);
await fs.writeFile(`${out}/CREDITS.txt`,`CLUTCH ASSET CREDITS\n\nKenney Nature Kit (CC0)\nhttps://kenney.nl/assets/nature-kit\n\nKenney Blaster Kit 2.1 (CC0)\nhttps://kenney.nl/assets/blaster-kit\n\nModels are converted to self-contained, Meshopt-compressed GLB files.\nSee the included original license files.\n\nClutch Ranger: original articulated character created for this game.\nSource and rebuild instructions: scripts/build-assets.mjs.\n`);
console.log('Environment and weapon bytes:',bytes,'plus ranger',(await fs.stat(`${out}/ranger.glb`)).size);
