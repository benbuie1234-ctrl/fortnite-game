import assert from 'node:assert/strict';
import { MatchRoom } from '../server/src/match';
import { ServerPlayer } from '../server/src/player';
import { stepPlayer, type InputCommand } from '../shared/src/sim';
import { World } from '../shared/src/world';
import { buildArena } from '../shared/src/arena';
import { makePiece,SLOT_WALL_Z } from '../shared/src/build';
import { EV_PIECE_REMOVE,Writer,writeInputBatch } from '../shared/src/protocol';
import type { GameEvent } from '../shared/src/snapshot';

const room=new MatchRoom({} as DurableObjectState,{} as never);
const internal=room as unknown as {
  world:World;events:GameEvent[];
  stepOnePlayer(p:ServerPlayer,s:number,ms:number):void;
  onMessage(p:ServerPlayer,data:ArrayBuffer):void;
  resetBuilds():void;
};
const player=new ServerPlayer(0,'test',{close(){},send(){}} as unknown as WebSocket);
player.resetForSpawn(0,0,40,0);
const client={...player};
const world=new World();buildArena(world);
const commands:InputCommand[]=Array.from({length:24},(_,i)=>({seq:i+1,moveX:0,moveZ:1,yaw:0,pitch:0,buttons:0,slot:2}));
for(const cmd of commands)stepPlayer(client,cmd,world);
const writer=new Writer(1024);writeInputBatch(writer,commands,1000);
internal.onMessage(player,writer.finish());
// A hitch delivers 800ms of commands in a burst. Every input must survive.
for(let i=0;i<6;i++)internal.stepOnePlayer(player,2+i/30,2000+i*33);
assert.equal(player.lastSeq,24);
assert.ok(Math.abs(client.z-player.z)<1e-6,'no correction after queued input burst');
assert.equal(player.inputQueue.length,0);
const before=player.z;
internal.onMessage(player,writer.finish());
internal.stepOnePlayer(player,3,3000);
assert.equal(player.z,before,'duplicate batch cannot replay movement');
const wall=makePiece(3,0,3,SLOT_WALL_Z,0,0,0,0);internal.world.set(wall);
internal.resetBuilds();
assert.ok(!internal.world.pieces.has(wall.key));
assert.ok(internal.events.some(e=>e.kind===EV_PIECE_REMOVE&&e.key===wall.key),'reset tells clients to remove collision');
console.log('PASS: 800ms delayed burst preserves movement, duplicate inputs ignored, round reset removes client structures.');
