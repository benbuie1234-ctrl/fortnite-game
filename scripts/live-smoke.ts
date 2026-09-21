/** Run against a local Worker only: npx esbuild scripts/live-smoke.ts --bundle --platform=node --format=esm --outfile=/tmp/clutch-live.mjs && node /tmp/clutch-live.mjs */
import assert from 'node:assert/strict';
import { Connection } from '../client/src/net/connection';
import { BTN_FIRE, BTN_CROUCH } from '../shared/src/sim';
const room=`ASTRAQA${Date.now()}`;let matchCount=0;const errors:string[]=[];
const connect=(name:string)=>{const c=new Connection({onWelcome(){},onEvents(){},onMatchState(m){if(Array.isArray(m.players))matchCount=Math.max(matchCount,m.players.length);},onChat(){},onClose:r=>errors.push(r)});c.connect(`ws://localhost:8788/ws?room=${room}&name=${name}`);return c;};
const a=connect('QA Alpha'),b=connect('QA Bravo');
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
let seq=0;let buttons=0;let move=0;
const timer=setInterval(()=>{seq++;for(const c of [a,b])if(c.selfId>=0)c.pushInput({seq,moveX:0,moveZ:c===a?move:0,yaw:c.self.yaw,pitch:0,buttons:c===a?buttons:0,slot:2});},1000/30);
try{
 await wait(1200);assert.equal(matchCount,2);assert.ok(a.snapshotsReceived>3&&b.snapshotsReceived>3);assert.ok(Math.abs(a.serverNow()-Date.now())<2000,'server clock is full epoch time');
 const before={x:a.self.x,z:a.self.z};move=-1;await wait(900);move=0;await wait(300);assert.ok(Math.hypot(a.self.x-before.x,a.self.z-before.z)>1,'real websocket movement advances');
 buttons=BTN_CROUCH;await wait(500);assert.ok(a.self.crouch>.8,'crouch reconciles over websocket');buttons=0;await wait(400);assert.ok(a.self.crouch<.1);
 const ammo=a.self.ammo;buttons=BTN_FIRE;await wait(650);buttons=0;await wait(200);assert.ok(a.self.ammo<ammo,'server accepts fire and decrements ammo');assert.equal(b.remotePoses().length,1);assert.ok(a.pendingInputCount<12,'input acknowledgement queue stays bounded');
 b.disconnect();await wait(300);b.connect(`ws://localhost:8788/ws?room=${room}&name=QA%20Bravo`);await wait(800);assert.ok(b.snapshotsReceived>2);assert.equal(b.others.size,1);assert.deepEqual(errors,[]);
 console.log(`PASS: two live websocket clients, movement, crouch, shooting, remote interpolation, disconnect/rejoin; ${a.snapshotsReceived} snapshots, ${a.pendingInputCount} pending inputs.`);
}finally{clearInterval(timer);a.disconnect();b.disconnect();}
