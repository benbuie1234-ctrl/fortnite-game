import {
  TICK_HZ, TICK_DT, SNAPSHOT_HZ, MAX_PLAYERS_PER_MATCH, RESPAWN_DELAY_S,
  ROUND_WIN_SCORE, PLAYER_MAX_HP, MATERIALS, SPRINT_STAMINA_MAX, SHIELD_LIFETIME_S,
} from "@shared/constants";
import {
  C_HELLO, C_INPUT, C_PING, C_CHAT,
  S_WELCOME, S_PONG, S_FULL_WORLD, S_MATCH, S_CHAT, S_KICK,
  EV_DEATH, EV_RESPAWN, EV_PIECE_REMOVE,
  Reader, Writer, readInputBatch,
  PF_ALIVE, PF_GROUNDED, PF_AIMING, PF_CROUCH, PF_FIRING, PF_MOVING, PF_SLIDING,
  PF_SHIELD_SPENT,
} from "@shared/protocol";
import { writeSnapshot, type GameEvent, type OtherState } from "@shared/snapshot";
import { World } from "@shared/world";
import { buildArena, arenaSpawns, isOutOfBounds, ARENA_OWNER } from "@shared/arena";
import { stepPlayer, fallDamage, BTN_FIRE, BTN_AIM, BTN_RELOAD, BTN_JUMP } from "@shared/sim";
import { weaponById, ARENA_LOADOUT } from "@shared/weapons";
import { CritterState } from "@shared/critters";
import { ServerPlayer } from "./player";
import { resolveFire, tryPlace, beginReload, finishReloads } from "./combat";
import { BUILD_SHIELD } from "@shared/placement";
import { SLOT_SHIELD } from "@shared/build";

export interface Env {
  MATCH: DurableObjectNamespace;
  ASSETS: Fetcher;
}

/** Inputs processed per tick, per player. Caps how fast a modified client can
 *  make itself move; a legitimate client averages exactly 1. */
const MAX_INPUTS_PER_TICK = 4;
/** Drop a player who has sent nothing for this long. */
const INPUT_TIMEOUT_MS = 45_000;
const MATS_PER_SECOND = 2;

export class MatchRoom implements DurableObject {
  private world = new World();
  private players = new Map<number, ServerPlayer>();
  private bySocket = new Map<WebSocket, ServerPlayer>();
  private events: GameEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private spawns = arenaSpawns();
  /** Which birds and fish are currently down. Authoritative; clients mirror it
   *  from EV_CRITTER rather than being told the whole set. */
  private critters = new CritterState();

  // The room is entirely in-memory and ephemeral: a match that ends leaves
  // nothing to persist, so neither the state store nor the env is retained.
  constructor(_ctx: DurableObjectState, _env: Env) {
    buildArena(this.world);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    if (this.players.size >= MAX_PLAYERS_PER_MATCH) {
      return new Response("match full", { status: 503 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Deliberately NOT the hibernation API: this room runs a 30 Hz tick, so it
    // is never idle long enough to hibernate, and the plain API keeps the tick
    // loop and the in-memory world alive between messages.
    server.accept();

    const url = new URL(request.url);
    const name = sanitizeName(url.searchParams.get("name") ?? "Player");
    const id = this.allocateId();
    if (id < 0) return new Response("match full", { status: 503 });

    const player = new ServerPlayer(id, name, server);
    const spawn = this.pickSpawn();
    player.resetForSpawn(spawn.x, spawn.y, spawn.z, spawn.yaw);
    player.lastInputAtMs = Date.now();

    this.players.set(id, player);
    this.bySocket.set(server, player);

    server.addEventListener("message", (ev: MessageEvent) => {
      try {
        this.onMessage(player, ev.data);
      } catch {
        // A malformed frame must never take the room down for everyone else.
      }
    });
    const drop = () => this.removePlayer(player);
    server.addEventListener("close", drop);
    server.addEventListener("error", drop);

    this.sendWelcome(player);
    this.sendFullWorld(player);
    this.broadcastMatchState();
    this.startTicking();

    return new Response(null, { status: 101, webSocket: client });
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  private onMessage(player: ServerPlayer, data: unknown): void {
    if (typeof data === "string") {
      const msg = JSON.parse(data) as { t?: number; text?: string };
      if (msg.t === C_CHAT && typeof msg.text === "string") {
        this.broadcastJson({
          t: S_CHAT, id: player.id, name: player.name, text: msg.text.slice(0, 140),
        });
      }
      return;
    }
    if (!(data instanceof ArrayBuffer)) return;

    const r = new Reader(data);
    const type = r.u8();
    switch (type) {
      case C_INPUT: {
        const batch = readInputBatch(r);
        player.lastInputAtMs = Date.now();
        // Round-trip estimate, smoothed. Sizes the lag-compensation rewind
        // when this player shoots.
        // clientTimeMs arrives truncated to 32 bits, so compare in that same
        // space; the subtraction wraps correctly for any realistic round trip.
        const rtt = ((Date.now() >>> 0) - batch.clientTimeMs) >>> 0;
        if (rtt < 1000) player.rttMs = player.rttMs * 0.8 + rtt * 0.2;
        for (const cmd of batch.commands) {
          const ahead = (cmd.seq - player.lastReceivedSeq) & 0xffff;
          if (player.receivedInput && (ahead === 0 || ahead > 0x8000)) continue;
          if (player.inputQueue.length >= 128) {
            player.socket.close(1008, "Input backlog exceeded; please reconnect");
            return;
          }
          player.receivedInput = true;
          player.lastReceivedSeq = cmd.seq;
          player.inputQueue.push(cmd);
        }
        break;
      }
      case C_PING: {
        // A ping proves the client is alive even when its render loop is
        // throttled, so it refreshes the inactivity deadline as well.
        player.lastInputAtMs = Date.now();
        const clientTime = r.u32();
        const w = new Writer(16);
        w.u8(S_PONG).u32(clientTime).u32(Date.now() >>> 0);
        player.socket.send(w.finish());
        break;
      }
      case C_HELLO:
        break;
      default:
        break;
    }
  }

  private sendWelcome(player: ServerPlayer): void {
    player.socket.send(JSON.stringify({
      t: S_WELCOME,
      id: player.id,
      name: player.name,
      tickHz: TICK_HZ,
      serverTimeMs: Date.now(),
      loadout: ARENA_LOADOUT,
      x: player.x, y: player.y, z: player.z, yaw: player.yaw,
    }));
  }

  /** Full build state for a joining player. Arena geometry is excluded: the
   *  client generates it from the same deterministic function the server does. */
  private sendFullWorld(player: ServerPlayer): void {
    const w = new Writer(8192);
    w.u8(S_FULL_WORLD);
    const countAt = w.offset;
    w.u16(0);
    let n = 0;
    const nowMs = Date.now();
    const nowSec = nowMs / 1000;
    for (const piece of this.world.pieces.values()) {
      if (piece.ownerId === ARENA_OWNER) continue;
      w.u32(piece.key);
      w.u8(piece.mat);
      w.u8(piece.facing);
      w.u8(piece.ownerId);
      w.u16(Math.max(0, Math.round(piece.hp)));
      // Age of the piece, so the joiner's grow-in animation lines up.
      w.u32(Math.max(0, Math.round((nowSec - piece.placedAt) * 1000)) >>> 0);
      n++;
    }
    w.patchU16(countAt, n);
    player.socket.send(w.finish());
  }

  private broadcastJson(obj: unknown): void {
    const text = JSON.stringify(obj);
    for (const p of this.players.values()) {
      try { p.socket.send(text); } catch { /* socket closing */ }
    }
  }

  private broadcastMatchState(): void {
    this.broadcastJson({
      t: S_MATCH,
      target: ROUND_WIN_SCORE,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, kills: p.kills, deaths: p.deaths,
        wins: p.wins, ping: Math.round(p.rttMs),
      })),
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private allocateId(): number {
    for (let i = 0; i < MAX_PLAYERS_PER_MATCH; i++) {
      if (!this.players.has(i)) return i;
    }
    return -1;
  }

  private pickSpawn(): { x: number; y: number; z: number; yaw: number } {
    // Farthest spawn from any living player, so nobody materialises in a fight.
    let best = this.spawns[0];
    let bestDist = -1;
    for (const s of this.spawns) {
      let nearest = Infinity;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        nearest = Math.min(nearest, Math.hypot(p.x - s.x, p.z - s.z));
      }
      if (nearest === Infinity) return s;
      if (nearest > bestDist) { bestDist = nearest; best = s; }
    }
    return best;
  }

  private removePlayer(player: ServerPlayer): void {
    if (!this.players.has(player.id)) return;
    this.players.delete(player.id);
    this.bySocket.delete(player.socket);
    try { player.socket.close(); } catch { /* already closed */ }
    this.broadcastMatchState();
    if (this.players.size === 0) this.stopTicking();
  }

  private startTicking(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), 1000 / TICK_HZ);
  }

  private stopTicking(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    // Nobody left: drop player-built pieces so the next match starts clean.
    this.resetBuilds();
    this.critters.reset();
    this.events.length = 0;
    this.tickCount = 0;
  }

  private resetBuilds(): void {
    for (const [key, piece] of [...this.world.pieces]) {
      if (piece.ownerId !== ARENA_OWNER) {
        this.world.pieces.delete(key);
        this.events.push({ kind: EV_PIECE_REMOVE, key });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  private tick(): void {
    const nowMs = Date.now();
    const nowSec = nowMs / 1000;
    this.tickCount++;

    for (const player of [...this.players.values()]) {
      if (nowMs - player.lastInputAtMs > INPUT_TIMEOUT_MS) {
        try {
          player.socket.send(JSON.stringify({ t: S_KICK, reason: "timed out" }));
        } catch { /* already gone */ }
        this.removePlayer(player);
        continue;
      }
      this.stepOnePlayer(player, nowSec, nowMs);
    }

    for (const player of this.players.values()) {
      this.resolveDeathAndRespawn(player, nowSec);
      player.recordHistory(nowMs);
    }

    this.expireShields(nowSec);

    if (this.tickCount % Math.max(1, Math.round(TICK_HZ / SNAPSHOT_HZ)) === 0) {
      this.broadcastSnapshots(nowMs);
      this.events.length = 0;
    }
  }

  private stepOnePlayer(player: ServerPlayer, nowSec: number, nowMs: number): void {
    finishReloads(player, nowSec);
    player.addMats(MATS_PER_SECOND * TICK_DT);

    let processed = 0;
    while (player.inputQueue.length > 0 && processed < MAX_INPUTS_PER_TICK) {
      const cmd = player.inputQueue.shift()!;
      // Each queued input is one simulation tick, so it gets its own instant on
      // the clock the fire interval is measured against.
      //
      // Without this, every input in a burst shared the tick's timestamp, so
      // the second and later ones were inside the previous shot's cooldown and
      // their trigger pulls were silently dropped. Inputs arrive two at a time
      // (SEND_HZ is half TICK_HZ), so that happened on every other tick: the
      // gap between shots alternated between the weapon's real interval and a
      // tick longer, which is exactly the "sometimes there's fire delay and
      // sometimes there isn't" the cadence was suffering from.
      const inputTime = nowSec + processed * TICK_DT;
      processed++;
      player.lastSeq = cmd.seq;

      this.applySlot(player, cmd.slot);
      player.aiming = (cmd.buttons & BTN_AIM) !== 0;

      if (!player.alive) continue;

      stepPlayer(player, cmd, this.world, TICK_DT);

      const fall = fallDamage(player.lastFallHeight, player.lastLandingSpeed);
      if (fall > 0) {
        player.hp -= fall;
        player.lastDamagedBy = -1;
      }

      if (isOutOfBounds(player.x, player.y, player.z)) {
        const spawn = this.pickSpawn();
        player.x = spawn.x; player.y = spawn.y; player.z = spawn.z;
        player.vx = 0; player.vy = 0; player.vz = 0;
      }

      if ((cmd.buttons & BTN_RELOAD) !== 0) beginReload(player, inputTime);

      const firing = (cmd.buttons & BTN_FIRE) !== 0;
      const weapon = weaponById(player.weaponId);

      if (player.inBuildMode) {
        // Turbo build: holding the button keeps placing at the build cooldown.
        if (firing) tryPlace(this.world, player, inputTime, nowMs, this.events);
      } else {
        const triggered = weapon.auto ? firing : firing && !player.wasFiring;
        if (triggered) {
          resolveFire(this.world, player, [...this.players.values()], inputTime, nowMs, this.events, this.critters);
        }
      }
      player.wasFiring = firing;
    }

    // The queue should hover near empty. A persistent backlog means the client
    // is sending faster than the tick rate, so drop the excess rather than
    // letting it bank up movement.
    // Keep unprocessed inputs for the next tick. Discarding this backlog made
    // the next acknowledgement erase movement already predicted by clients.
  }

  /**
   * Take down shields that have outlived their welcome.
   *
   * Swept rather than scheduled: there are at most one per player, so walking
   * the piece map twice a second costs nothing, and a timer per piece would be
   * one more thing to clean up when a round ends or a player leaves.
   */
  private expireShields(nowSec: number): void {
    if (this.tickCount % Math.max(1, Math.round(TICK_HZ / 2)) !== 0) return;
    for (const [key, piece] of this.world.pieces) {
      if (piece.slot !== SLOT_SHIELD) continue;
      if (nowSec - piece.placedAt < SHIELD_LIFETIME_S) continue;
      this.world.remove(key);
      this.events.push({ kind: EV_PIECE_REMOVE, key });
    }
  }

  private applySlot(player: ServerPlayer, slot: number): void {
    if (slot >= 0 && slot <= 4) {
      if (player.weaponIdx !== slot) player.reloadEndAt = 0;
      player.weaponIdx = slot;
      player.buildSlot = -1;
    } else if ((slot >= 5 && slot <= 8) || slot === BUILD_SHIELD) {
      player.buildSlot = slot;
    } else if (slot >= 9 && slot <= 11) {
      const mat = slot - 9;
      if (mat < MATERIALS.length) player.material = mat;
    }
  }

  private resolveDeathAndRespawn(player: ServerPlayer, nowSec: number): void {
    if (player.alive && player.hp <= 0) {
      player.alive = false;
      player.hp = 0;
      player.deaths++;
      player.respawnAt = nowSec + RESPAWN_DELAY_S;

      const killer = player.lastDamagedBy >= 0
        ? this.players.get(player.lastDamagedBy)
        : undefined;
      if (killer && killer.id !== player.id) killer.kills++;

      this.events.push({
        kind: EV_DEATH,
        victim: player.id,
        killer: killer ? killer.id : 255,
        weapon: killer ? killer.weaponId : 255,
      });
      this.broadcastMatchState();

      if (killer && killer.kills >= ROUND_WIN_SCORE) this.endRound(killer, nowSec);
      return;
    }

    if (!player.alive && nowSec >= player.respawnAt) {
      const spawn = this.pickSpawn();
      player.resetForSpawn(spawn.x, spawn.y, spawn.z, spawn.yaw);
      player.lastDamagedBy = -1;
      this.events.push({ kind: EV_RESPAWN, id: player.id, x: spawn.x, y: spawn.y, z: spawn.z });
    }
  }

  private endRound(winner: ServerPlayer, nowSec: number): void {
    winner.wins++;
    this.broadcastJson({
      t: S_MATCH, roundOver: true, winnerId: winner.id, winnerName: winner.name,
    });
    this.resetBuilds();
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      p.shieldUsed = false;
      const spawn = this.pickSpawn();
      p.resetForSpawn(spawn.x, spawn.y, spawn.z, spawn.yaw);
      p.respawnAt = nowSec;
      this.events.push({ kind: EV_RESPAWN, id: p.id, x: spawn.x, y: spawn.y, z: spawn.z });
    }
    this.broadcastMatchState();
  }

  // -------------------------------------------------------------------------
  // Snapshots
  // -------------------------------------------------------------------------

  private broadcastSnapshots(nowMs: number): void {
    const all = [...this.players.values()];
    for (const me of all) {
      const others: OtherState[] = [];
      for (const o of all) {
        if (o.id === me.id) continue;
        others.push({
          id: o.id,
          flags: flagsFor(o),
          x: o.x, y: o.y, z: o.z,
          yaw: o.yaw, pitch: o.pitch,
          hpPct: Math.round((o.hp / PLAYER_MAX_HP) * 255),
          weapon: o.inBuildMode ? 255 : o.weaponId,
        });
      }

      const w = new Writer(4096);
      writeSnapshot(w, {
        serverTimeMs: nowMs,
        ackSeq: me.lastSeq,
        selfId: me.id,
        self: {
          x: me.x, y: me.y, z: me.z,
          vx: me.vx, vy: me.vy, vz: me.vz,
          flags: flagsFor(me),
          hp: me.hp, shield: me.shield, mats: me.mats,
          weapon: me.weaponId, ammo: me.ammo[me.weaponIdx],
          buildSlot: me.buildSlot < 0 ? 0 : me.buildSlot,
          material: me.material,
          reloadMs: Math.max(0, me.reloadEndAt * 1000 - nowMs),
          stance: Math.round(me.crouch * 255),
          stamina: Math.round((me.stamina / SPRINT_STAMINA_MAX) * 255),
          bloom: Math.round(me.bloom * 255),
          slideLockout: me.slideLockout, crouchHeld: me.crouchHeld,
          fallPeakY: me.fallPeakY, staminaIdle: me.staminaIdle,
        },
        others,
        events: this.events,
      });

      try { me.socket.send(w.finish()); } catch { /* socket closing */ }
    }
  }
}

function flagsFor(p: ServerPlayer): number {
  let f = 0;
  if (p.alive) f |= PF_ALIVE;
  if (p.grounded) f |= PF_GROUNDED;
  if (p.aiming) f |= PF_AIMING;
  if (p.wasFiring) f |= PF_FIRING;
  if (Math.hypot(p.vx, p.vz) > 0.8) f |= PF_MOVING;
  if (p.crouch > 0.5) f |= PF_CROUCH;
  if (p.sliding) f |= PF_SLIDING;
  if (p.shieldUsed) f |= PF_SHIELD_SPENT;
  void BTN_JUMP;
  return f;
}

function sanitizeName(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    // Strip C0 and DEL so names cannot smuggle control characters into the UI.
    if (code >= 32 && code !== 127) out += ch;
  }
  out = out.trim().slice(0, 16);
  return out.length > 0 ? out : "Player";
}
