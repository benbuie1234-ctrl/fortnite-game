/**
 * Caps how often the game actually renders.
 *
 * requestAnimationFrame runs at the display's refresh rate, which on a 120 Hz
 * laptop means twice the GPU work for no visible benefit in a game like this.
 * That shows up as fan noise and heat on a Mac, and as thermal throttling and
 * flat batteries on the school Chromebooks this is meant to run on — a
 * throttled machine drops frames exactly when a fight starts.
 *
 * This gates *rendering only*. The network tick lives on its own timer and
 * must keep running regardless, or a player who alt-tabs gets dropped for
 * inactivity.
 */

export type FpsTarget = 30 | 60 | 120 | 0; // 0 = uncapped

const STORAGE_KEY = "clutch.fpsCap";
const DEFAULT_TARGET: FpsTarget = 60;

/**
 * Tolerance when comparing elapsed time against the frame interval.
 *
 * Without it there is a nasty failure: on a 60 Hz display targeting 60 fps,
 * rAF fires at ~16.67 ms, and the tiniest jitter makes elapsed come in just
 * under the interval. Every other frame gets skipped and the game runs at 30.
 * One millisecond of slack absorbs that jitter while still correctly halving
 * a 120 Hz display down to 60.
 */
const TOLERANCE_MS = 1;

export class FrameLimiter {
  private intervalMs = 0;
  private last = -Infinity;
  private target: FpsTarget = DEFAULT_TARGET;

  constructor(target?: FpsTarget) {
    this.setTarget(target ?? loadTarget());
  }

  get fpsTarget(): FpsTarget { return this.target; }

  setTarget(target: FpsTarget): void {
    this.target = target;
    this.intervalMs = target > 0 ? 1000 / target : 0;
    try {
      localStorage.setItem(STORAGE_KEY, String(target));
    } catch {
      // Blocked storage is fine; the cap just will not persist.
    }
  }

  /**
   * Whether this animation frame should be drawn. Call once at the top of the
   * frame callback and return early when it is false.
   */
  shouldRender(now: number): boolean {
    // Never draw into a hidden tab. rAF usually stops on its own, but an
    // occluded-but-"visible" pane can keep firing.
    if (typeof document !== "undefined" && document.hidden) return false;

    if (this.intervalMs <= 0) return true;

    if (this.last === -Infinity) {
      this.last = now;
      return true;
    }

    const elapsed = now - this.last;
    if (elapsed < this.intervalMs - TOLERANCE_MS) return false;

    // Advance the deadline by whole intervals so the cadence stays on a fixed
    // grid rather than drifting slower over time.
    //
    // The Math.max(1, ...) is load-bearing. A frame accepted inside the
    // tolerance window has not technically covered a full interval, so the
    // step count floors to zero and the deadline would never move — which
    // lets every subsequent frame through. That silently renders a 120 Hz
    // display at ~88 fps instead of the 60 it was asked for.
    const steps = Math.max(1, Math.floor(elapsed / this.intervalMs));
    this.last += steps * this.intervalMs;

    // After a long stall (tab restored, GC pause) resync to now instead of
    // replaying a backlog of catch-up frames.
    if (now - this.last > this.intervalMs * 4) this.last = now;
    return true;
  }
}

function loadTarget(): FpsTarget {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Check for null BEFORE converting. Number(null) is 0, and 0 is the valid
    // code for "uncapped" — so converting first would hand every first-time
    // player an uncapped renderer, which is the exact problem this exists to
    // solve.
    if (raw === null) return DEFAULT_TARGET;
    const n = Number(raw);
    if (n === 0 || n === 30 || n === 60 || n === 120) return n as FpsTarget;
  } catch {
    // Blocked storage; fall through to the default.
  }
  return DEFAULT_TARGET;
}
