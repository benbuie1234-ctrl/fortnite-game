import { FrameLimiter } from "../client/src/render/framelimiter";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

/**
 * Feed the limiter one second of animation frames arriving at `displayHz`
 * and count how many it lets through. `jitterMs` simulates the timing noise a
 * real browser produces.
 */
function renderedInOneSecond(
  limiter: FrameLimiter, displayHz: number, jitterMs = 0,
): number {
  const step = 1000 / displayHz;
  let rendered = 0;
  let seed = 12345;
  const rand = () => {
    // Deterministic jitter, so the test never flakes.
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  };
  for (let i = 1; i <= displayHz; i++) {
    const now = i * step + (jitterMs ? rand() * jitterMs : 0);
    if (limiter.shouldRender(now)) rendered++;
  }
  return rendered;
}

// Minimal localStorage stub so the persistence path is exercised under node.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string): void { this.store.set(k, v); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
}
const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

console.log("frame limiter");

{
  // Regression: getItem returns null when unset and Number(null) is 0, which
  // is the valid code for "uncapped". Converting before the null check handed
  // every first-time player an uncapped renderer.
  storage.clear();
  const fresh = new FrameLimiter();
  check("a first-time player defaults to 60, not uncapped",
    fresh.fpsTarget === 60, `got ${fresh.fpsTarget}`);

  const n = renderedInOneSecond(fresh, 120);
  check("so a 120Hz display is actually halved by default",
    n >= 58 && n <= 62, `rendered ${n}`);
}

{
  storage.clear();
  new FrameLimiter(120);
  check("an explicit choice persists", new FrameLimiter().fpsTarget === 120,
    `got ${new FrameLimiter().fpsTarget}`);

  storage.clear();
  new FrameLimiter(0);
  check("including uncapped", new FrameLimiter().fpsTarget === 0,
    `got ${new FrameLimiter().fpsTarget}`);
  storage.clear();
}

{
  // The whole point: a 120 Hz display should do half the work at a 60 cap.
  const n = renderedInOneSecond(new FrameLimiter(60), 120);
  check("120Hz display at a 60 cap renders ~60", n >= 58 && n <= 62, `rendered ${n}`);
}

{
  // The bug this guards against: at 60Hz targeting 60, frames arrive at almost
  // exactly the interval. Without the tolerance, tiny timing noise pushes each
  // frame just under the threshold and the game silently runs at 30.
  const n = renderedInOneSecond(new FrameLimiter(60), 60);
  check("60Hz display at a 60 cap renders every frame", n >= 59, `rendered ${n}`);
}

{
  const n = renderedInOneSecond(new FrameLimiter(60), 60, 0.8);
  check("60Hz display survives timing jitter", n >= 57, `rendered ${n}`);
}

{
  const n = renderedInOneSecond(new FrameLimiter(30), 120);
  check("120Hz display at a 30 cap renders ~30", n >= 28 && n <= 32, `rendered ${n}`);
}

{
  const n = renderedInOneSecond(new FrameLimiter(0), 120);
  check("uncapped renders every frame", n === 120, `rendered ${n}`);
}

{
  // A long stall (tab restored, GC pause) must not bank up a burst of frames.
  const limiter = new FrameLimiter(60);
  limiter.shouldRender(0);
  limiter.shouldRender(5000); // five second gap
  let burst = 0;
  for (let i = 1; i <= 5; i++) {
    if (limiter.shouldRender(5000 + i * 0.5)) burst++;
  }
  check("does not replay a backlog after a stall", burst === 0, `burst ${burst}`);
}

{
  const limiter = new FrameLimiter(60);
  limiter.setTarget(120);
  check("target updates at runtime", limiter.fpsTarget === 120, `got ${limiter.fpsTarget}`);
  const n = renderedInOneSecond(limiter, 120);
  check("and takes effect immediately", n >= 118, `rendered ${n}`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
