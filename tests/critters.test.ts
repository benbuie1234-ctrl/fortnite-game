/**
 * Birds and fish. The interesting property is that nothing about them travels
 * over the wire except "this one is gone": the server and the client have to
 * derive the same position from the same clock, or the thing you shoot at is
 * not the thing the server tests.
 */
import {
  CRITTERS, CRITTER_BIRD, CRITTER_FISH, critterAt, critterHit, critterHeal,
  CritterState, CRITTER_RESPAWN_S, BIRD_HEAL, FISH_HEAL,
} from "../shared/src/critters";
import { LAKE_SHAPE, LAKE_SURFACE, terrainHeight, MAP_HALF } from "../shared/src/map";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

console.log("the flock");
{
  const birds = CRITTERS.filter(c => c.kind === CRITTER_BIRD).length;
  const fish = CRITTERS.filter(c => c.kind === CRITTER_FISH).length;
  check("there are birds", birds >= 8, `${birds}`);
  check("there are fish", fish >= 8, `${fish}`);
}

console.log("paths stay where they belong");
{
  let lowBird = Infinity, highBird = -Infinity;
  let strayFish = 0, surfacingFish = 0, offMap = 0;
  for (let i = 0; i < CRITTERS.length; i++) {
    const c = CRITTERS[i];
    let brokeSurface = false;
    for (let t = 0; t < 120; t += 0.25) {
      const p = critterAt(i, t)!;
      if (Math.abs(p.x) > MAP_HALF || Math.abs(p.z) > MAP_HALF) offMap++;
      if (c.kind === CRITTER_BIRD) {
        const clearance = p.y - terrainHeight(p.x, p.z);
        lowBird = Math.min(lowBird, clearance);
        highBird = Math.max(highBird, clearance);
      } else {
        // Inside the lake ellipse, or it is a fish in a field.
        const inLake = Math.hypot((p.x - LAKE_SHAPE.x) / LAKE_SHAPE.rx, (p.z - LAKE_SHAPE.z) / LAKE_SHAPE.rz);
        if (inLake > 1) strayFish++;
        if (p.y > LAKE_SURFACE - 0.1) brokeSurface = true;
      }
    }
    if (c.kind === CRITTER_FISH && brokeSurface) surfacingFish++;
  }
  check("nothing leaves the map", offMap === 0, `${offMap} sample(s)`);
  // Above a jump, below a sniper's patience.
  check("birds fly out of reach but in range", lowBird > 4 && highBird < 60,
    `${lowBird.toFixed(1)}m to ${highBird.toFixed(1)}m`);
  check("fish stay in the lake", strayFish === 0, `${strayFish} sample(s) on dry land`);
  check("and every fish surfaces", surfacingFish === CRITTERS.filter(c => c.kind === CRITTER_FISH).length,
    `${surfacingFish} of ${CRITTERS.filter(c => c.kind === CRITTER_FISH).length}`);
}

console.log("shooting one");
{
  const now = 1000;
  const state = new CritterState();
  const index = 0;
  const p = critterAt(index, now)!;
  // Straight at it from ten metres away.
  const from = { x: p.x - 10, y: p.y, z: p.z };
  const hit = critterHit(from.x, from.y, from.z, 1, 0, 0, 40, now, i => state.alive(i, now));
  check("a shot down the sights connects", hit !== null && hit.index === index,
    `${JSON.stringify(hit)}`);

  // A shot a clear two metres wide of it does not.
  const wide = critterHit(from.x, from.y + 2.4, from.z, 1, 0, 0, 40, now, i => state.alive(i, now));
  check("a shot wide of it misses", wide === null || wide.index !== index);

  state.down(index, now);
  check("a downed critter cannot be shot again",
    critterHit(from.x, from.y, from.z, 1, 0, 0, 40, now, i => state.alive(i, now))?.index !== index);
  check("and is still down a moment later", !state.alive(index, now + CRITTER_RESPAWN_S - 1));
  check("but comes back", state.alive(index, now + CRITTER_RESPAWN_S + 1));
}

console.log("payouts");
{
  const bird = CRITTERS.findIndex(c => c.kind === CRITTER_BIRD);
  const fish = CRITTERS.findIndex(c => c.kind === CRITTER_FISH);
  check("a bird is worth more than a fish", critterHeal(bird) > critterHeal(fish),
    `${critterHeal(bird)} vs ${critterHeal(fish)}`);
  check("a bird pays the bird rate", critterHeal(bird) === BIRD_HEAL);
  check("a fish pays the fish rate", critterHeal(fish) === FISH_HEAL);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
