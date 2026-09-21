import assert from 'node:assert/strict';
import { MatchRoom } from '../server/src/match';
import { ServerPlayer } from '../server/src/player';
import { World } from '../shared/src/world';
import { resolveFire } from '../server/src/combat';
import { EV_HIT,EV_DEATH,EV_RESPAWN } from '../shared/src/protocol';
import { ROUND_WIN_SCORE } from '../shared/src/constants';
import type { GameEvent } from '../shared/src/snapshot';
const messages:string[]=[];const socket={send:(s:unknown)=>{if(typeof s==='string')messages.push(s);},close(){}} as unknown as WebSocket;
const room=new MatchRoom({} as DurableObjectState,{} as never) as unknown as {players:Map<number,ServerPlayer>;world:World;events:GameEvent[];resolveDeathAndRespawn(p:ServerPlayer,t:number):void};
room.world=new World();const a=new ServerPlayer(0,'Alpha',socket),b=new ServerPlayer(1,'Bravo',socket);room.players.set(0,a);room.players.set(1,b);
const random=Math.random;Math.random=()=>.5;
try{
for(let kill=0;kill<ROUND_WIN_SCORE;kill++){
 a.resetForSpawn(3,0,0,0);b.resetForSpawn(3,0,8,Math.PI);a.aiming=true;b.shield=0;
 const t=100+kill*10;
 for(let shot=0;shot<12&&b.hp>0;shot++){a.nextFireAt=0;resolveFire(room.world,a,[a,b],t+shot,t*1000+shot*1000,room.events);}
 assert.ok(b.hp<=0,'aimed shots eliminate a nearby opponent');
 room.resolveDeathAndRespawn(b,t+2);
 if(kill<ROUND_WIN_SCORE-1){assert.equal(b.alive,false);room.resolveDeathAndRespawn(b,t+9);assert.equal(b.alive,true);}
}
assert.equal(a.wins,1);assert.equal(a.kills,0);assert.equal(b.deaths,0);assert.equal(a.alive,true);assert.equal(b.alive,true);
assert.ok(room.events.some(e=>e.kind===EV_HIT));assert.ok(room.events.some(e=>e.kind===EV_DEATH));assert.ok(room.events.some(e=>e.kind===EV_RESPAWN));assert.ok(messages.some(s=>JSON.parse(s).roundOver));
console.log('PASS: two-player damage, elimination, respawn, win attribution, and round reset.');
}finally{Math.random=random;}
