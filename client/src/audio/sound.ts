import { W_AR, W_SHOTGUN, W_SNIPER, W_SMG, W_PISTOL, W_PICKAXE } from "@shared/weapons";

/**
 * All game audio, synthesised at runtime with the Web Audio API.
 *
 * Still zero bytes of download -- there are no .wav or .mp3 files, including
 * the reverb, whose impulse response is generated from noise at startup.
 *
 * Three things do most of the work here, and none of them are the sounds
 * themselves:
 *
 *  1. **Air absorption.** Distance does not just make a sound quieter, it
 *     makes it *duller*: high frequencies are absorbed by air far faster than
 *     low ones. A gunshot across the map should be a muffled thud, not a
 *     quiet crack. Volume-only falloff is the single most common reason game
 *     audio sounds fake, and it is what this used to do.
 *  2. **Reverb.** A completely dry sound has no space around it and reads as
 *     synthetic no matter how well it is voiced. The wet/dry mix also rises
 *     with distance, because a far-off source reaches you mostly as
 *     reflections rather than directly.
 *  3. **Layering.** A real gunshot is a sharp transient, a tonal body, a low
 *     thump and a decaying tail, plus the mechanical clack of the action. One
 *     noise burst is a hiss; the layers are what make it a gunshot.
 */

export type SoundKind =
  | "shot" | "build" | "destroy" | "hitmarker" | "headshot"
  | "damage" | "step" | "jump" | "land" | "death" | "win" | "respawn";

/** Beyond this many metres a sound is inaudible and is skipped entirely. */
const MAX_DISTANCE = 95;
const REFERENCE_DISTANCE = 6;

/**
 * Distance over which air absorption halves the filter cutoff. Smaller values
 * make the world feel bigger and hazier.
 */
const ABSORPTION_HALF_DISTANCE = 16;
const MIN_CUTOFF_HZ = 520;

interface Listener {
  x: number; y: number; z: number;
  /** Rightward unit vector, for stereo panning. */
  rx: number; rz: number;
}

/** Where a positioned sound connects, already split into dry and wet paths. */
interface Route {
  input: AudioNode;
  gain: number;
  /** Per-playback pitch offset, so repeats are never identical. */
  detune: number;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverbIn: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private listener: Listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
  private muted = false;
  private volume = 0.6;
  private recent = 0;
  private recentResetAt = 0;
  private ambienceTimer: ReturnType<typeof setTimeout> | null = null;
  private ambienceNodes: AudioNode[] = [];
  /** Off by default. Constant background noise is fatiguing, and it is the
   *  kind of thing a player should opt into rather than have imposed. */
  private ambienceEnabled = false;

  constructor() {
    try {
      this.muted = localStorage.getItem("clutch.muted") === "1";
      this.ambienceEnabled = localStorage.getItem("clutch.ambience") === "1";
      const v = localStorage.getItem("clutch.volume");
      if (v !== null) this.volume = Math.max(0, Math.min(1, Number(v)));
    } catch {
      // Private browsing or blocked storage: defaults are fine.
    }
  }

  /**
   * Must be called from a real user gesture -- browsers refuse to start an
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

      // --- reverb bus --------------------------------------------------------
      // A short pre-delay before the convolver keeps the reverb from smearing
      // into the transient, which is what stops gunshots going washy.
      const convolver = ctx.createConvolver();
      convolver.buffer = impulseResponse(ctx, 1.7, 3.2);

      const preDelay = ctx.createDelay(0.2);
      preDelay.delayTime.value = 0.022;

      const reverbIn = ctx.createGain();
      reverbIn.gain.value = 1;

      const reverbOut = ctx.createGain();
      reverbOut.gain.value = 0.9;

      reverbIn.connect(preDelay);
      preDelay.connect(convolver);
      convolver.connect(reverbOut);
      reverbOut.connect(master);

      // One second of white noise, reused as the source for every noise-based
      // sound. Buffers can be shared; only the source nodes are per-playback.
      const len = Math.floor(ctx.sampleRate);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      this.ctx = ctx;
      this.master = master;
      this.reverbIn = reverbIn;
      this.noise = buf;

      if (this.ambienceEnabled) this.startAmbience();
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

  get ambience(): boolean { return this.ambienceEnabled; }

  /** Turn the wind bed and birdsong on or off. */
  setAmbience(enabled: boolean): void {
    this.ambienceEnabled = enabled;
    try { localStorage.setItem("clutch.ambience", enabled ? "1" : "0"); } catch { /* ignore */ }
    if (enabled) this.startAmbience();
    else this.stopAmbience();
  }

  /** Update where the player is hearing from. `yaw` matches the game's convention. */
  setListener(x: number, y: number, z: number, yaw: number): void {
    this.listener = { x, y, z, rx: Math.cos(yaw), rz: Math.sin(yaw) };
  }

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------

  private route(x?: number, y?: number, z?: number): Route | null {
    const ctx = this.ctx;
    const master = this.master;
    const reverbIn = this.reverbIn;
    if (!ctx || !master || !reverbIn || this.muted) return null;

    // Rate-limit: a shotgun plus several impacts in one frame can stack into
    // clipping. Allow a generous burst, then drop extras for that window.
    if (ctx.currentTime > this.recentResetAt) {
      this.recent = 0;
      this.recentResetAt = ctx.currentTime + 0.05;
    }
    if (this.recent++ > 12) return null;

    const detune = (Math.random() - 0.5) * 140; // +/- 70 cents

    if (x === undefined || y === undefined || z === undefined) {
      // Non-positional (UI, your own hit confirms). A touch of reverb still
      // stops it sounding like it is happening inside your skull.
      const dry = ctx.createGain();
      dry.gain.value = 1;
      dry.connect(master);
      const wet = ctx.createGain();
      wet.gain.value = 0.07;
      dry.connect(wet);
      wet.connect(reverbIn);
      return { input: dry, gain: 1, detune };
    }

    const dx = x - this.listener.x;
    const dy = y - this.listener.y;
    const dz = z - this.listener.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > MAX_DISTANCE) return null;

    const gain = REFERENCE_DISTANCE / Math.max(REFERENCE_DISTANCE, dist);

    // Air absorption. Halving the cutoff every ABSORPTION_HALF_DISTANCE metres
    // tracks how high frequencies actually die off with range closely enough
    // that the ear reads it as distance rather than as a filter sweep.
    const cutoff = Math.max(
      MIN_CUTOFF_HZ,
      20000 * Math.pow(0.5, dist / ABSORPTION_HALF_DISTANCE),
    );
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    filter.Q.value = 0.4;

    const panner = ctx.createStereoPanner();
    if (dist > 0.01) {
      const dot = (dx * this.listener.rx + dz * this.listener.rz) / dist;
      panner.pan.value = Math.max(-1, Math.min(1, dot * 0.9));
    }
    filter.connect(panner);

    // Far sources reach you mostly as reflections, so the wet mix climbs with
    // distance while the direct path falls away.
    const wetAmount = Math.min(0.6, 0.06 + dist / 110);
    const dry = ctx.createGain();
    dry.gain.value = 1 - wetAmount * 0.55;
    panner.connect(dry);
    dry.connect(master);

    const wet = ctx.createGain();
    wet.gain.value = wetAmount;
    panner.connect(wet);
    wet.connect(reverbIn);

    return { input: filter, gain, detune };
  }

  // -------------------------------------------------------------------------
  // Primitives
  // -------------------------------------------------------------------------

  /** Filtered noise burst -- the backbone of most sounds here. */
  private burst(
    r: Route,
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
    src.detune.value = r.detune;
    const offset = Math.random() * 0.5;

    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? "lowpass";
    filter.frequency.setValueAtTime(opts.from, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.to), t + opts.decay);
    if (opts.q !== undefined) filter.Q.value = opts.q;

    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.volume * r.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + opts.decay);

    src.connect(filter);
    filter.connect(g);
    g.connect(r.input);
    src.start(t, offset, opts.decay + 0.06);
    src.stop(t + opts.decay + 0.06);
  }

  /** Pitched tone with an exponential decay. */
  private tone(
    r: Route,
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
    osc.detune.value = r.detune * 0.5;
    if (opts.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + opts.decay);
    }

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    // Tiny attack ramp avoids the click a hard gain step produces.
    g.gain.exponentialRampToValueAtTime(opts.volume * r.gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + opts.decay);

    osc.connect(g);
    g.connect(r.input);
    osc.start(t);
    osc.stop(t + opts.decay + 0.04);
  }

  // -------------------------------------------------------------------------
  // Weapons
  // -------------------------------------------------------------------------

  /** A gunshot, voiced per weapon. Call once per trigger pull, not per pellet. */
  shot(weapon: number, x: number, y: number, z: number): void {
    const r = this.route(x, y, z);
    if (!r) return;
    const v = VOICES[weapon] ?? VOICES[W_AR];

    if (weapon === W_PICKAXE) {
      // A swing, not a shot: band-limited whoosh with no low body.
      this.burst(r, { type: "bandpass", from: 900, to: 2600, decay: 0.16, volume: 0.26, q: 1.2 });
      return;
    }

    // 1. Transient. Very short, very bright: the snap that arrives before the
    //    ear has resolved anything else. This layer is most of the "punch".
    this.burst(r, {
      type: "highpass", from: 2600, to: 5200,
      decay: 0.014, volume: v.volume, q: 0.6,
    });

    // 2. Body. The report itself, sweeping down as it decays.
    this.burst(r, {
      from: v.crack, to: v.bodyTo,
      decay: v.decay, volume: v.volume * 0.85,
    });

    // 3. Thump. Low end you feel more than hear; gives the weapon weight.
    this.tone(r, {
      from: v.thumpHz, to: v.thumpHz * 0.34,
      decay: v.decay * 1.5, volume: v.volume * 0.72,
    });

    // 4. Tail: the report bouncing off the world. Kept separate from the
    //    reverb bus so a heavy weapon gets a longer tail than a light one.
    if (v.tail > 0) {
      this.burst(r, {
        type: "bandpass", from: 1300, to: 380,
        decay: v.tail, volume: v.volume * 0.26, q: 0.8, delay: 0.018,
      });
    }

    // 5. Mechanical action cycling, a beat after the shot.
    if (v.mech) {
      this.burst(r, {
        type: "highpass", from: 3400, to: 2400,
        decay: 0.035, volume: v.volume * 0.2, delay: 0.055,
      });
    }
  }

  /** Magazine out, magazine in, bolt release. */
  reload(x?: number, y?: number, z?: number): void {
    const r = this.route(x, y, z);
    if (!r) return;
    const click = (delay: number, from: number, volume: number) =>
      this.burst(r, { type: "highpass", from, to: from * 0.7, decay: 0.04, volume, delay });
    click(0, 3200, 0.16);
    click(0.17, 2600, 0.13);
    click(0.42, 4200, 0.18);
  }

  /** Swapping to a different weapon. */
  swap(): void {
    const r = this.route();
    if (!r) return;
    this.burst(r, { type: "highpass", from: 3000, to: 2200, decay: 0.045, volume: 0.13 });
  }

  // -------------------------------------------------------------------------
  // World
  // -------------------------------------------------------------------------

  build(x: number, y: number, z: number): void {
    const r = this.route(x, y, z);
    if (!r) return;
    this.tone(r, { type: "triangle", from: 260, to: 95, decay: 0.11, volume: 0.28 });
    this.burst(r, { from: 2600, to: 700, decay: 0.05, volume: 0.17 });
    // A wooden knock on the tail so the piece lands rather than just appearing.
    this.burst(r, { type: "bandpass", from: 800, to: 400, decay: 0.09, volume: 0.1, q: 1.4, delay: 0.03 });
  }

  destroy(x: number, y: number, z: number): void {
    const r = this.route(x, y, z);
    if (!r) return;
    this.burst(r, { type: "highpass", from: 3000, to: 1800, decay: 0.03, volume: 0.22 });
    this.burst(r, { type: "bandpass", from: 1500, to: 240, decay: 0.34, volume: 0.32, q: 0.9 });
    this.tone(r, { from: 130, to: 45, decay: 0.24, volume: 0.24 });
  }

  /** Confirmation blip for your own hits. Non-positional: it is UI, not world. */
  hitmarker(headshot: boolean): void {
    const r = this.route();
    if (!r) return;
    this.tone(r, {
      from: headshot ? 1750 : 1150,
      to: headshot ? 1300 : 900,
      decay: 0.07, volume: 0.2,
    });
    if (headshot) {
      this.tone(r, { from: 2400, to: 1900, decay: 0.05, volume: 0.12, delay: 0.035 });
    }
  }

  damage(): void {
    const r = this.route();
    if (!r) return;
    this.burst(r, { from: 900, to: 180, decay: 0.16, volume: 0.28 });
    this.tone(r, { from: 95, to: 50, decay: 0.22, volume: 0.26 });
  }

  step(x: number, y: number, z: number): void {
    const r = this.route(x, y, z);
    if (!r) return;
    this.burst(r, {
      from: 1100, to: 300, decay: 0.065, volume: 0.12,
      rate: 0.9 + Math.random() * 0.25,
    });
  }

  jump(x: number, y: number, z: number): void {
    const r = this.route(x, y, z);
    if (!r) return;
    this.burst(r, { from: 700, to: 260, decay: 0.07, volume: 0.11 });
  }

  /** Landing. `speed` scales the thump so a big drop sounds like one. */
  land(x: number, y: number, z: number, speed: number): void {
    const r = this.route(x, y, z);
    if (!r) return;
    const heavy = Math.min(1, speed / 18);
    this.burst(r, { from: 800, to: 180, decay: 0.1 + heavy * 0.1, volume: 0.13 + heavy * 0.18 });
    if (heavy > 0.35) {
      this.tone(r, { from: 85, to: 40, decay: 0.2, volume: 0.22 * heavy });
    }
  }

  death(x?: number, y?: number, z?: number): void {
    const r = this.route(x, y, z);
    if (!r) return;
    this.tone(r, { type: "sawtooth", from: 340, to: 70, decay: 0.55, volume: 0.18 });
    this.burst(r, { from: 1800, to: 250, decay: 0.3, volume: 0.18 });
  }

  respawn(): void {
    const r = this.route();
    if (!r) return;
    this.tone(r, { type: "triangle", from: 420, to: 700, decay: 0.2, volume: 0.16 });
  }

  /** Round-win sting: a rising three-note arpeggio. */
  win(): void {
    const r = this.route();
    if (!r) return;
    const notes = [523.25, 659.25, 783.99]; // C5 E5 G5
    notes.forEach((hz, i) => {
      this.tone(r, { type: "triangle", from: hz, decay: 0.42, volume: 0.18, delay: i * 0.11 });
    });
  }

  /** Menu hover / click. */
  ui(kind: "hover" | "click"): void {
    const r = this.route();
    if (!r) return;
    if (kind === "hover") {
      this.tone(r, { type: "sine", from: 1400, decay: 0.045, volume: 0.05 });
    } else {
      this.tone(r, { type: "triangle", from: 760, to: 1180, decay: 0.09, volume: 0.12 });
    }
  }

  // -------------------------------------------------------------------------
  // Ambience
  // -------------------------------------------------------------------------

  /**
   * A continuous wind bed plus occasional birdsong.
   *
   * Silence is what makes a world feel dead. Without a floor of ambient noise
   * every sound arrives out of nowhere and the map reads as an empty room.
   * Mixed very low on purpose: you should only notice it when it stops.
   */
  private startAmbience(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.ambienceNodes.length > 0) return;

    const src = ctx.createBufferSource();
    src.buffer = windBuffer(ctx, 8);
    src.loop = true;

    // Brown noise is already dark; this just shaves the last of the hiss off
    // the top so nothing in it reads as static.
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 480;
    lp.Q.value = 0.3;

    const gain = ctx.createGain();
    gain.gain.value = 0.016;

    // Gusts. Modulating LEVEL rather than filter cutoff is the difference
    // between wind and a synthesiser sweep: a real gust gets louder, it does
    // not change pitch.
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.045;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = 0.009;
    gust.connect(gustDepth);
    gustDepth.connect(gain.gain);

    src.connect(lp);
    lp.connect(gain);
    gain.connect(master);
    src.start();
    gust.start();
    this.ambienceNodes.push(src, gust, gain, lp, gustDepth);

    const scheduleBird = (): void => {
      this.ambienceTimer = setTimeout(() => {
        this.birdCall();
        scheduleBird();
      }, 8000 + Math.random() * 16000);
    };
    scheduleBird();
  }

  /**
   * Stop scheduling birdsong. The wind bed keeps running -- it is driven by a
   * looping buffer rather than a timer, and muting already silences it at the
   * master gain.
   */
  stopAmbience(): void {
    if (this.ambienceTimer !== null) {
      clearTimeout(this.ambienceTimer);
      this.ambienceTimer = null;
    }
    for (const node of this.ambienceNodes) {
      try {
        if ("stop" in node) (node as OscillatorNode).stop();
        node.disconnect();
      } catch { /* already stopped */ }
    }
    this.ambienceNodes.length = 0;
  }

  /** A short two or three note chirp, panned somewhere off to the side. */
  private birdCall(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted) return;

    const panner = ctx.createStereoPanner();
    panner.pan.value = (Math.random() - 0.5) * 1.6;
    panner.connect(master);

    const base = 1800 + Math.random() * 1400;
    const notes = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < notes; i++) {
      const t = ctx.currentTime + i * (0.09 + Math.random() * 0.05);
      const osc = ctx.createOscillator();
      osc.type = "sine";
      const f = base * (0.92 + Math.random() * 0.25);
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 1.25, t + 0.055);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.022, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);

      osc.connect(g);
      g.connect(panner);
      osc.start(t);
      osc.stop(t + 0.09);
    }
  }
}

// ---------------------------------------------------------------------------
// Weapon voicing
// ---------------------------------------------------------------------------

interface GunVoice {
  /** Starting cutoff of the body layer -- brightness of the report. */
  crack: number;
  /** Where the body sweeps down to. */
  bodyTo: number;
  /** Low-end thump frequency; the weapon's weight. */
  thumpHz: number;
  decay: number;
  /** Length of the reflected tail; 0 for none. */
  tail: number;
  volume: number;
  /** Whether the action audibly cycles after the shot. */
  mech: boolean;
}

const VOICES: Record<number, GunVoice> = {
  [W_AR]:      { crack: 5200, bodyTo: 420, thumpHz: 145, decay: 0.13,  tail: 0.34, volume: 0.40, mech: true },
  [W_SHOTGUN]: { crack: 3400, bodyTo: 150, thumpHz: 88,  decay: 0.30,  tail: 0.58, volume: 0.60, mech: true },
  [W_SNIPER]:  { crack: 8200, bodyTo: 260, thumpHz: 118, decay: 0.18,  tail: 0.95, volume: 0.62, mech: true },
  [W_SMG]:     { crack: 5600, bodyTo: 680, thumpHz: 178, decay: 0.075, tail: 0.16, volume: 0.29, mech: false },
  [W_PISTOL]:  { crack: 5000, bodyTo: 500, thumpHz: 162, decay: 0.115, tail: 0.26, volume: 0.35, mech: true },
  [W_PICKAXE]: { crack: 2000, bodyTo: 900, thumpHz: 200, decay: 0.16,  tail: 0,    volume: 0.26, mech: false },
};

// ---------------------------------------------------------------------------

/**
 * Brown noise, in a buffer that loops without a click.
 *
 * Two fixes over the previous attempt, which sounded like static because it
 * was static:
 *
 *  - White noise has equal energy at every frequency, so filtering it leaves
 *    hiss. Brown noise (white, integrated) falls off at 6 dB per octave and
 *    is mostly low-frequency energy, which is what wind actually is.
 *  - A one-second loop of raw noise clicks audibly every time it wraps,
 *    because the last sample and the first are unrelated. The tail is
 *    crossfaded back over the head so the seam is continuous.
 */
function windBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const fade = Math.floor(rate * 0.75);

  const raw = new Float32Array(len + fade);
  let last = 0;
  for (let i = 0; i < raw.length; i++) {
    const white = Math.random() * 2 - 1;
    // Leaky integrator: the leak keeps it from wandering off as a DC drift.
    last = (last + 0.018 * white) / 1.018;
    raw[i] = last * 3.2;
  }

  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    raw[i] = raw[i] * t + raw[len + i] * (1 - t);
  }

  const buffer = ctx.createBuffer(1, len, rate);
  buffer.copyToChannel(raw.subarray(0, len), 0);
  return buffer;
}

/**
 * Generate a reverb impulse response: decaying noise, independently random per
 * channel so the tail has stereo width.
 *
 * Shipping a recorded .wav impulse is the usual approach and would cost a few
 * hundred kB. This costs nothing, and for a diffuse outdoor tail it is very
 * hard to tell the two apart.
 */
function impulseResponse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, length, rate);

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Early reflections are dense; later ones thin out.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buffer;
}
