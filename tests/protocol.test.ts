import {
  Writer, Reader, writeInputBatch, readInputBatch,
  quantizeYaw, quantizePitch, C_INPUT,
} from "../shared/src/protocol";
import type { InputCommand } from "../shared/src/sim";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

console.log("input batch round trip");

const commands: InputCommand[] = [
  { seq: 1, moveX: 1, moveZ: -1, yaw: quantizeYaw(0.75), pitch: quantizePitch(-0.3), buttons: 0b101, slot: 2 },
  { seq: 2, moveX: 0, moveZ: 1, yaw: quantizeYaw(-2.1), pitch: quantizePitch(0.9), buttons: 0, slot: 7 },
];

const w = new Writer(64);
writeInputBatch(w, commands, 1234567);
const buf = w.finish();
check("byte length is 22", buf.byteLength === 22, `got ${buf.byteLength}`);

const r = new Reader(buf);
const type = r.u8();
check("type is C_INPUT", type === C_INPUT, `got ${type}`);

const batch = readInputBatch(r);
check("clientTimeMs survives", batch.clientTimeMs === 1234567, `got ${batch.clientTimeMs}`);
check("command count", batch.commands.length === 2, `got ${batch.commands.length}`);

for (let i = 0; i < commands.length; i++) {
  const a = commands[i];
  const b = batch.commands[i];
  check(`cmd${i} seq`, a.seq === b.seq, `sent ${a.seq} got ${b.seq}`);
  check(`cmd${i} moveX`, a.moveX === b.moveX, `sent ${a.moveX} got ${b.moveX}`);
  check(`cmd${i} moveZ`, a.moveZ === b.moveZ, `sent ${a.moveZ} got ${b.moveZ}`);
  check(`cmd${i} buttons`, a.buttons === b.buttons, `sent ${a.buttons} got ${b.buttons}`);
  check(`cmd${i} slot`, a.slot === b.slot, `sent ${a.slot} got ${b.slot}`);
  check(`cmd${i} yaw`, Math.abs(a.yaw - b.yaw) < 1e-4, `sent ${a.yaw} got ${b.yaw}`);
  check(`cmd${i} pitch`, Math.abs(a.pitch - b.pitch) < 1e-4, `sent ${a.pitch} got ${b.pitch}`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
