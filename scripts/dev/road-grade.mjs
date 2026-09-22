import { load } from './bundle.mjs';
const m = await load('shared/src/map.ts');
const pts = JSON.parse(process.argv[2]);
for (let i=0;i<pts.length-1;i++){
  const [x1,z1]=pts[i],[x2,z2]=pts[i+1];
  const len=Math.hypot(x2-x1,z2-z1);
  let worst=0;
  const prof=[];
  for(let t=0;t<=len;t+=4){
    const a=t/len; const h=m.terrainHeight(x1+(x2-x1)*a,z1+(z2-z1)*a);
    prof.push(h.toFixed(0));
    if(t>0){const b=(t-4)/len;const h0=m.terrainHeight(x1+(x2-x1)*b,z1+(z2-z1)*b);worst=Math.max(worst,Math.abs(h-h0)/4);}
  }
  console.log(`(${x1},${z1})->(${x2},${z2}) len ${len.toFixed(0)} worst ${worst.toFixed(2)}  ${prof.join(' ')}`);
}
