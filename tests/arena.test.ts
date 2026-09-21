import { arenaSpawns } from "../shared/src/arena";
import { forwardVector } from "../shared/src/vec";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

console.log("spawns face the arena centre");

for (const [i, s] of arenaSpawns().entries()) {
  const [fx, , fz] = forwardVector(s.yaw, 0);
  // Direction from the spawn toward the origin.
  const len = Math.hypot(s.x, s.z) || 1;
  const toCentreX = -s.x / len;
  const toCentreZ = -s.z / len;
  // Dot product near 1 means the player looks straight at the middle.
  const dot = fx * toCentreX + fz * toCentreZ;
  check(
    `spawn ${i} at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) looks inward`,
    dot > 0.99,
    `dot=${dot.toFixed(3)} forward=(${fx.toFixed(2)}, ${fz.toFixed(2)})`,
  );
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
