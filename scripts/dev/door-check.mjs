import { load } from './bundle.mjs';
const m = await load('shared/src/map.ts');
const a = await load('shared/src/arena.ts');
const w = await load('shared/src/world.ts');
const sim = await load('shared/src/sim.ts');
const world = new w.World(); a.buildArena(world);
const TILE=6;
for (const bp of m.BLUEPRINTS) {
  const side = bp.entrance.side;
  const inward = side===0?[0,1]:side===1?[0,-1]:side===2?[1,0]:[-1,0];
  const sx = bp.entrance.x - inward[0]*5, sz = bp.entrance.z - inward[1]*5;
  const p = { ...sim.newMovementState(), x:sx, y:bp.b.base*TILE+0.05, z:sz, grounded:true };
  const yaw = Math.atan2(-inward[0], inward[1]);
  for (let i=0;i<60;i++) sim.stepPlayer(p,{seq:i,moveX:0,moveZ:1,yaw,pitch:0,buttons:0,slot:2},world,1/30);
  const got = (p.x-bp.entrance.x)*inward[0] + (p.z-bp.entrance.z)*inward[1];
  if (got < 2) {
    const g0 = m.terrainHeight(sx,sz), gd = m.terrainHeight(bp.entrance.x, bp.entrance.z);
    console.log(`${bp.b.name.padEnd(28)} side=${side} got=${got.toFixed(1)} floor=${(bp.b.base*TILE).toFixed(1)} groundOut=${g0.toFixed(1)} groundDoor=${gd.toFixed(1)} endY=${p.y.toFixed(1)} ended=(${p.x.toFixed(1)},${p.z.toFixed(1)}) door=(${bp.entrance.x.toFixed(1)},${bp.entrance.z.toFixed(1)})`);
  }
}
