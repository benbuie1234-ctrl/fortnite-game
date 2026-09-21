import { EYE_HEIGHT } from './constants';
import { forwardVector, rightVector } from './vec';
import type { World } from './world';
import { rayVsBox } from './world';
import { type Box, type Piece, rampHeightAt } from './build';
import { TILE } from './constants';

// Covers the near clipping plane, including its corners at wide aspect ratios.
export const CAMERA_RADIUS = .3;

export function easeCameraDistance(previous:number, safe:number, dt:number):number {
  return safe < previous ? safe : previous+(safe-previous)*(1-Math.exp(-8*Math.max(0,dt)));
}

/** One camera boom shared by rendering and authoritative crosshair aiming. */
export function cameraPose(p: {x:number;y:number;z:number;yaw:number;pitch:number}, aiming:boolean, world:World, now:number, scoped=false) {
  const forward = forwardVector(p.yaw,p.pitch);
  const right = rightVector(p.yaw);
  const distance = aiming ? 1.9 : 3.4;
  const shoulder = aiming ? .42 : .62;
  const eye: [number,number,number] = [p.x,p.y+EYE_HEIGHT,p.z];
  // A scope looks directly along the firing ray, without shoulder parallax.
  if(scoped && aiming) return {origin:eye,forward};
  let offset = forward.map((v,i) => -v*distance+right[i]*shoulder+(i===1?.18:0));
  const length = Math.hypot(...offset);
  const hit = world.raycast(...eye,offset[0]/length,offset[1]/length,offset[2]/length,length+.3,now);
  let safe = hit ? Math.max(0,hit.t-CAMERA_RADIUS) : length;
  const boxes:Box[]=[],ramps:Piece[]=[];
  const end=eye.map((v,i)=>v+offset[i]);
  const lo=eye.map((v,i)=>Math.min(v,end[i])-CAMERA_RADIUS);
  const hi=eye.map((v,i)=>Math.max(v,end[i])+CAMERA_RADIUS);
  world.collidersNear(lo[0],lo[1],lo[2],hi[0],hi[1],hi[2],boxes,ramps);
  const dir=offset.map(v=>v/length);
  for(const box of boxes) {
    const expanded=box.map((v,i)=>v+(i<3?-CAMERA_RADIUS:CAMERA_RADIUS)) as Box;
    const contact=rayVsBox(expanded,...eye,dir[0],dir[1],dir[2]);
    if(contact) safe=Math.min(safe,Math.max(0,contact.t-.02));
  }
  // Short swept-volume steps cover terrain and both sides of sloping builds.
  for(let t=0;t<=safe+.05;t+=.05) {
    const d=Math.min(t,safe),x=eye[0]+dir[0]*d,y=eye[1]+dir[1]*d,z=eye[2]+dir[2]*d;
    let blocked=false;
    for(const sx of [-CAMERA_RADIUS,0,CAMERA_RADIUS])for(const sz of [-CAMERA_RADIUS,0,CAMERA_RADIUS]) {
      if(y-CAMERA_RADIUS<world.groundAt(x+sx,z+sz))blocked=true;
      for(const ramp of ramps) {
        const h=rampHeightAt(ramp,x+sx,z+sz);
        if(h!==null&&y+CAMERA_RADIUS>=ramp.gy*TILE&&y-CAMERA_RADIUS<=h)blocked=true;
      }
    }
    if(blocked){safe=Math.max(0,d-.05);break;}
  }
  offset=offset.map(v=>v*safe/length);
  const floor=world.groundAt(eye[0]+offset[0],eye[2]+offset[2])+.2;
  if(eye[1]+offset[1]<floor && offset[1]<0) offset=offset.map(v=>v*Math.max(0,(eye[1]-floor)/-offset[1]));
  return {origin:eye.map((v,i)=>v+offset[i]) as [number,number,number],forward};
}
