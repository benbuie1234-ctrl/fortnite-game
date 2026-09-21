import { EYE_HEIGHT } from './constants';
import { forwardVector, rightVector } from './vec';
import type { World } from './world';

/** One camera boom shared by rendering and authoritative crosshair aiming. */
export function cameraPose(p: {x:number;y:number;z:number;yaw:number;pitch:number}, aiming:boolean, world:World, now:number) {
  const forward = forwardVector(p.yaw,p.pitch);
  const right = rightVector(p.yaw);
  const distance = aiming ? 1.9 : 3.4;
  const shoulder = aiming ? .42 : .62;
  const eye: [number,number,number] = [p.x,p.y+EYE_HEIGHT,p.z];
  let offset = forward.map((v,i) => -v*distance+right[i]*shoulder+(i===1?.18:0));
  const length = Math.hypot(...offset);
  const hit = world.raycast(...eye,offset[0]/length,offset[1]/length,offset[2]/length,length+.3,now);
  if(hit) offset = offset.map(v=>v*Math.max(0,hit.t-.25)/length);
  const floor=world.groundAt(eye[0]+offset[0],eye[2]+offset[2])+.2;
  if(eye[1]+offset[1]<floor && offset[1]<0) offset=offset.map(v=>v*Math.max(0,(eye[1]-floor)/-offset[1]));
  return {origin:eye.map((v,i)=>v+offset[i]) as [number,number,number],forward};
}
