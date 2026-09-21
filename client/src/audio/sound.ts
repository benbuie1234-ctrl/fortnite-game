import { W_AR, W_SHOTGUN, W_SNIPER, W_SMG, W_PISTOL, W_PICKAXE } from "@shared/weapons";

/**
 * All game audio, synthesised at runtime with the Web Audio API.
 *
 * Like the textures, this costs **zero bytes of download** — there are no .wav
 * or .mp3 files to fetch, which keeps the game loading instantly on school
 * wifi. Every sound is built from filtered noise bursts and short oscillator
 * envelopes, which is also exactly how real gunshot foley is layered: a
 * high-frequency "crack" over a low-frequency "body".
 *
 * Sounds are positioned by hand rather than with a PannerNode: distance sets
 * gain, and the source's direction relative to the camera sets stereo pan.
 * That is cheaper and far more predictable than the full HRTF path.
 */

export type SoundKind =
  | "shot" | "build" | "destroy" | "hitmarker" | "headshot"
  | "damage" | "step" | "jump" | "land" | "death" | "win" | "respawn";

/** Beyond this many metres a sound is inaudible and is skipped entirely. */
const MAX_DISTANCE = 70;
const REFERENCE_DISTANCE = 6;

interface Listener {
  x: number; y: number; z: number;
  /** Rightward unit vector, for stereo panning. */
  rx: number; rz: number;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private listener: Listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
  private muted = false;
  private volume = 0.6;
  /** Cheap protection against a burst of simultaneous sounds clipping. */
  private recent = 0;
  private recentResetAt = 0;

  constructor() {
    try {
      this.muted = localStorage.getItem("clutch.muted") === "1";
      const v = localStorage.getItem("clutch.volume");
      if (v !== null) this.volume = Math.max(0, Math.min(1, Number(v)));
    } catch {
      // Private browsing or blocked storage: defaults are fine.
    }
  }

  /**
   * Must be called from a real user gesture — browsers refuse to start an
   * AudioContext otherwise, and it would stay silently suspended forever.
   */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : this.volume;
      master.connect(ctx.destination);

      // One second of white noise, reused as the source for every noise-based
      // sound. Buffers can be shared; only the source nodes are per-playback.
      const len = Math.floor(ctx.sampleRate);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      this.ctx = ctx;
      this.master = master;
      this.noise = buf;
    } catch {
      // No audio available; the game stays fully playable in silence.
    }
  }

  get isMuted(): boolean { return this.muted; }

  /** "off" until init() runs, then the AudioContext's own state. */
  get state(): string { return this.ctx ? this.ctx.state : "off"; }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
    try { localStorage.setItem("clutch.muted", muted ? "1" : "0"); } catch { /* ignore */ }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && !this.muted) this.master.gain.value = this.volume;
    try { localStorage.setItem("clutch.volume", String(this.volume)); } catch { /* ignore */ }
  }

  /** Update where the player is hearing from. `yaw` matches the game's convention. */
  setListener(x: number, y: number, z: number, yaw: number): void {
    // rightVector(yaw) from shared/vec, inlined to avoid a per-frame import cost.
    this.listener = { x, y, z, rx: Math.cos(yaw), rz: Math.sin(yaw) };
  }

  // -------------------------------------------------------------------------

  /**
   * Build the output chain for one playback: gain for distance, pan for
   * direction. Returns null when the sound is too far away to bother with.
   */
  private route(x?: number, y?: number, z?: number): { node: AudioNode; gain: number } | null {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted) return null;

    // Rate-limit: a shotgun plus several impacts in one frame can stack into
    // clipping. Allow a generous burst, then drop extras for that window.
    if (ctx.currentTime > this.recentResetAt) {
      this.recent = 0;
      this.recentResetAt = ctx.currentTime + 0.05;
    }
    if (this.recent++ > 10) return null;

    if (x === undefined || y === undefined || z === undefined) {
      return { node: master, gain: 1 };
    }

    const dx = x - this.listener.x;
    const dy = y - this.listener.y;
    const dz = z - this.listener.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > MAX_DISTANCE) return null;

    // Inverse-distance falloff, clamped so point-blank sounds are not enormous.
    const gain = REFERENCE_DISTANCE / Math.max(REFERENCE_DISTANCE, dist);

    const panner = ctx.createStereoPanner();
    if (dist > 0.01) {
      const dot = (dx * this.listener.rx + dz * this.listener.rz) / dist;
      panner.pan.value = Math.max(-1, Math.min(1, dot * 0.85));
    }
    panner.connect(master);
    return { node: panner, gain };
  }

  /** Filtered noise burst — the backbone of most sounds here. */
  private burst(
    dest: AudioNode, gain: number,
    opts: {
      type?: BiquadFilterType; from: number; to: number;
      decay: number; volume: number; rate?: number; q?: number; delay?: number;
    },
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime + (opts.delay ?? 0);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = opts.rate ?? 1;
    // Start from a random offset so repeated shots are not identical.
    const offset = Math.random() * 0.5;

    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? "lowpass";
    filter.frequency.setValueAtTime(opts.from, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.to), t + opts.decay);
    if (opts.q !== undefined) filter.Q.value = opts.q;

    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.volume * gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + opts.decay);

    src.connect(filter);
    filter.connect(g);
    g.connect(dest);
    src.start(t, offset, opts.decay + 0.06);
    src.stop(t + opts.decay + 0.06);
  }

  /** Pitched tone with an exponential decay — used for bodies, blips and stings. */
  private tone(
    dest: AudioNode, gain: number,
    opts: {
      type?: OscillatorType; from: number; to?: number;
      decay: number; volume: number; delay?: number;
    },
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);

    const osc = ctx.createOscillator();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(opts.from, t);
    if (opts.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + opts.decay);
    }

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    // Tiny attack ramp avoids the click a hard gain step produces.
    g.gain.exponentialRampToValueAtTime(opts.volume * gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + opts.decay);

    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + opts.decay + 0.04);
  }

  // -------------------------------------------------------------------------
  // Public sounds
  // -------------------------------------------------------------------------

  /** A gunshot, voiced per weapon. Call once per trigger pull, not per pellet. */
  shot(weapon: number, x: number, y: number, z: number): void {
    const out = this.route(x, y, z);
    if (!out) return;
    const { node, gain } = out;

    switch (weapon) {
      case W_SHOTGUN:
        this.burst(node, gain, { from: 3200, to: 160, decay: 0.34, volume: 0.62 });
        this.tone(node, gain, { from: 90, to: 38, decay: 0.2, volume: 0.5 });
        break;
      case W_SNIPER:
        this.burst(node, gain, { from: 8000, to: 280, decay: 0.16, volume: 0.6 });
        // Long tail: the crack that keeps ringing after the shot.
        this.burst(node, gain, { from: 1400, to: 200, decay: 0.75, volume: 0.22, delay: 0.03 });
        this.tone(node, gain, { from: 120, to: 44, decay: 0.3, volume: 0.42 });
        break;
      case W_SMG:
        this.burst(node, gain, { from: 5400, to: 700, decay: 0.075, volume: 0.3 });
        this.tone(node, gain, { from: 180, to: 90, decay: 0.06, volume: 0.2 });
        break;
      case W_PISTOL:
        this.burst(node, gain, { from: 5000, to: 500, decay: 0.12, volume: 0.36 });
        this.tone(node, gain, { from: 165, to: 70, decay: 0.1, volume: 0.28 });
        break;
      case W_PICKAXE:
        // A swing, not a shot: band-limited whoosh with no low body.
        this.burst(node, gain, { type: "bandpass", from: 900, to: 2600, decay: 0.16, volume: 0.28, q: 1.2 });
        break;
      case W_AR:
      default:
        this.burst(node, gain, { from: 4800, to: 420, decay: 0.125, volume: 0.42 });
        this.tone(node, gain, { from: 145, to: 62, decay: 0.1, volume: 0.32 });
        break;
    }
  }

  /** A build piece snapping into place. */
  build(x: number, y: number, z: number): void {
    const out = this.route(x, y, z);
    if (!out) return;
    this.tone(out.node, out.gain, { type: "triangle", from: 260, to: 95, decay: 0.11, volume: 0.3 });
    this.burst(out.node, out.gain, { from: 2600, to: 700, decay: 0.05, volume: 0.18 });
  }

  /** A build piece being destroyed. */
  destroy(x: number, y: number, z: number): void {
    const out = this.route(x, y, z);
    if (!out) return;
    this.burst(out.node, out.gain, { type: "bandpass", from: 1500, to: 260, decay: 0.32, volume: 0.34, q: 0.9 });
    this.tone(out.node, out.gain, { from: 130, to: 45, decay: 0.22, volume: 0.24 });
  }

  /** Confirmation blip for your own hits. Non-positional: it is UI, not world. */
  hitmarker(headshot: boolean): void {
    const out = this.route();
    if (!out) return;
    this.tone(out.node, out.gain, {
      from: headshot ? 1750 : 1150,
      to: headshot ? 1300 : 900,
      decay: 0.07, volume: 0.22,
    });
  }

  /** You took damage. */
  damage(): void {
    const out = this.route();
    if (!out) return;
    this.burst(out.node, out.gain, { from: 900, to: 180, decay: 0.16, volume: 0.3 });
    this.tone(out.node, out.gain, { from: 95, to: 50, decay: 0.2, volume: 0.28 });
  }

  step(x: number, y: number, z: number): void {
    const out = this.route(x, y, z);
    if (!out) return;
    this.burst(out.node, out.gain, {
      from: 1100, to: 300, decay: 0.065, volume: 0.13,
      rate: 0.9 + Math.random() * 0.25,
    });
  }

  jump(x: number, y: number, z: number): void {
    const out = this.route(x, y, z);
    if (!out) return;
    this.burst(out.node, out.gain, { from: 700, to: 260, decay: 0.07, volume: 0.12 });
  }

  /** Landing. `speed` scales the thump so a big drop sounds like one. */
  land(x: number, y: number, z: number, speed: number): void {
    const out = this.route(x, y, z);
    if (!out) return;
    const heavy = Math.min(1, speed / 18);
    this.burst(out.node, out.gain, { from: 800, to: 180, decay: 0.1 + heavy * 0.1, volume: 0.13 + heavy * 0.2 });
    if (heavy > 0.35) {
      this.tone(out.node, out.gain, { from: 85, to: 40, decay: 0.18, volume: 0.22 * heavy });
    }
  }

  /** Someone was eliminated. */
  death(x?: number, y?: number, z?: number): void {
    const out = this.route(x, y, z);
    if (!out) return;
    this.tone(out.node, out.gain, { type: "sawtooth", from: 340, to: 70, decay: 0.55, volume: 0.2 });
    this.burst(out.node, out.gain, { from: 1800, to: 250, decay: 0.3, volume: 0.2 });
  }

  respawn(): void {
    const out = this.route();
    if (!out) return;
    this.tone(out.node, out.gain, { type: "triangle", from: 420, to: 700, decay: 0.2, volume: 0.18 });
  }

  /** Round-win sting: a rising three-note arpeggio. */
  win(): void {
    const out = this.route();
    if (!out) return;
    const notes = [523.25, 659.25, 783.99]; // C5 E5 G5
    notes.forEach((hz, i) => {
      this.tone(out.node, out.gain, {
        type: "triangle", from: hz, decay: 0.38, volume: 0.2, delay: i * 0.11,
      });
    });
  }
}
