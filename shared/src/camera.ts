import { forwardVector, rightVector } from './vec';
import type { World } from './world';
import { rayVsBox } from './world';
import { type Box, type Piece } from './build';
import { eyeHeightFor } from './sim';

// Covers the near clipping plane, including its corners at wide aspect ratios.
export const CAMERA_RADIUS = .3;

export function easeCameraDistance(previous:number, safe:number, dt:number):number {
  return safe < previous ? safe : previous+(safe-previous)*(1-Math.exp(-8*Math.max(0,dt)));
}

/** One camera boom shared by rendering and authoritative crosshair aiming. */
export function cameraPose(
  p: {x:number;y:number;z:number;yaw:number;pitch:number;crouch?:number},
  aiming:boolean, world:World, now:number, scoped=false,
) {
  void now;
  const forward = forwardVector(p.yaw,p.pitch);
  const right = rightVector(p.yaw);
  const distance = aiming ? 1.9 : 3.4;
  const shoulder = aiming ? .42 : .62;
  const eye: [number,number,number] = [p.x,p.y+eyeHeightFor(p.crouch??0),p.z];
  // A scope looks directly along the firing ray, without shoulder parallax.
  if(scoped && aiming) return {origin:eye,forward};

  const boom = forward.map((v,i) => -v*distance+right[i]*shoulder+(i===1?.18:0));
  const length = Math.hypot(...boom);
  const dir = boom.map(v=>v/length) as [number,number,number];

  // Solid geometry only.
  //
  // This used to run three overlapping occlusion tests: a world raycast, a
  // per-box ray, and a swept march that additionally treated a ramp's whole
  // vertical span as blocking. The march sampled nine offset points every 5 cm
  // and stopped at the first one that reported a hit, so walking past a ramp
  // made the boom jump in and out as different sample points crossed the
  // slope -- that is the camera "glitching out" near ramps.
  //
  // Ramps contribute real collision boxes now (see pieceBoxes), so the box
  // test below covers them properly, and the ramp-specific test was not only
  // redundant but wrong: it pulled the camera in for empty air above a slope.
  // What is left is the rule that was actually wanted -- the boom shortens
  // when, and only when, something solid is in the way.
  const boxes:Box[]=[],ramps:Piece[]=[];
  const end=eye.map((v,i)=>v+boom[i]);
  const lo=eye.map((v,i)=>Math.min(v,end[i])-CAMERA_RADIUS);
  const hi=eye.map((v,i)=>Math.max(v,end[i])+CAMERA_RADIUS);
  world.collidersNear(lo[0],lo[1],lo[2],hi[0],hi[1],hi[2],boxes,ramps);

  let safe = length;
  for(const box of boxes) {
    // Growing the box by the camera radius turns a ray test into a cheap
    // swept-sphere test, which is what keeps the near plane out of walls.
    const expanded=box.map((v,i)=>v+(i<3?-CAMERA_RADIUS:CAMERA_RADIUS)) as Box;
    const contact=rayVsBox(expanded,...eye,dir[0],dir[1],dir[2]);
    if(contact && contact.t<safe) safe=Math.max(0,contact.t-.02);
  }

  // Terrain is a height field rather than a box, so it needs its own march.
  for(let d=0;d<=safe;d+=.25) {
    const x=eye[0]+dir[0]*d,y=eye[1]+dir[1]*d,z=eye[2]+dir[2]*d;
    if(y-CAMERA_RADIUS<world.groundAt(x,z)){safe=Math.max(0,d-.25);break;}
  }

  const offset=dir.map(v=>v*safe);
  const floor=world.groundAt(eye[0]+offset[0],eye[2]+offset[2])+.2;
  if(eye[1]+offset[1]<floor && offset[1]<0) {
    const scale=Math.max(0,(eye[1]-floor)/-offset[1]);
    for(let i=0;i<3;i++) offset[i]*=scale;
  }
  return {origin:eye.map((v,i)=>v+offset[i]) as [number,number,number],forward};
}
