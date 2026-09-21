import * as THREE from "three";
import { TICK_DT, TICK_HZ, EYE_HEIGHT } from "@shared/constants";
import { forwardVector, rightVector } from "@shared/vec";
import { resolvePlacement } from "@shared/placement";
import { packKey } from "@shared/build";
import { weaponById, ARENA_LOADOUT, W_SNIPER } from "@shared/weapons";
import { SKINS } from "@shared/skins";
import {
  EV_SHOT, EV_HIT, EV_DEATH, EV_RESPAWN, PF_ALIVE, PF_GROUNDED,
} from "@shared/protocol";
import type { GameEvent } from "@shared/snapshot";

import { createRenderer } from "./render/scene";
import { PieceRenderer, BuildGhost } from "./render/pieces";
import { Character } from "./render/character";
import { Effects } from "./render/effects";
import { Controls } from "./input/controls";
import { Connection, type MatchPlayerInfo } from "./net/connection";
import { Hud } from "./ui/hud";

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const app = document.getElementById("app")!;
const menu = document.getElementById("menu")!;
const statusEl = document.getElementById("status")!;
const nameInput = document.getElementById("nameInput") as HTMLInputElement;
const codeInput = document.getElementById("codeInput") as HTMLInputElement;
const playBtn = document.getElementById("playBtn") as HTMLButtonElement;
const joinBtn = document.getElementById("joinBtn") as HTMLButtonElement;

const view = createRenderer(app);
const hud = new Hud();
const pieces = new PieceRenderer(view.scene);
const ghost = new BuildGhost(view.scene);
const effects = new Effects(view.scene);

const characters = new Map<number, Character>();
let selfCharacter: Character | null = null;
let matchPlayers: MatchPlayerInfo[] = [];
let scoreTarget = 5;
let playing = false;
let respawnAtMs = 0;

nameInput.value = localStorage.getItem("clutch.name") ?? "";

const conn = new Connection({
  onWelcome(id, name) {
    localStorage.setItem("clutch.name", name);
    enterGame(id, name);
  },
  onEvents(events) { handleEvents(events); },
  onMatchState(msg) {
    if (Array.isArray(msg.players)) matchPlayers = msg.players as MatchPlayerInfo[];
    if (typeof msg.target === "number") scoreTarget = msg.target;
    if (msg.roundOver) {
      const winner = String(msg.winnerName ?? "Someone");
      hud.setCenterMessage(`${winner} wins!`, "Next round starting");
      setTimeout(() => hud.setCenterMessage(""), 3000);
    }
  },
  onChat(name, text) { hud.addKillFeed(`${name}: ${text}`, false); },
  onClose(reason) { leaveGame(reason); },
});

const controls = new Controls(view.renderer.domElement, {
  sensitivity: 0.0022,
  onPointerLockChange(locked) {
    if (playing && !locked) hud.setCenterMessage("Paused", "Click to resume");
    else if (locked) hud.setCenterMessage("");
  },
});

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

function serverUrl(name: string, room: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  // In `vite dev` the client is on 5173 while the Worker runs on 8787, so
  // point at wrangler directly. In production both are the same origin.
  const host = location.port === "5173" ? `${location.hostname}:8787` : location.host;
  const params = new URLSearchParams({ name });
  if (room) params.set("room", room);
  return `${proto}//${host}/ws?${params.toString()}`;
}

let connectAttempt = 0;

function startConnect(room: string): void {
  const name = (nameInput.value || "Player").slice(0, 16);
  statusEl.className = "status";
  statusEl.textContent = room ? `Joining ${room}...` : "Finding a match...";
  playBtn.disabled = true;
  joinBtn.disabled = true;
  conn.connect(serverUrl(name, room));

  // If the welcome never lands, say so rather than hanging on a spinner. The
  // attempt token stops a stale timer from overwriting the message from a
  // later connection, or from a disconnect that already reported its reason.
  const attempt = ++connectAttempt;
  setTimeout(() => {
    if (attempt !== connectAttempt || playing) return;
    statusEl.className = "status error";
    statusEl.textContent = "Could not reach the server. Is it running?";
    playBtn.disabled = false;
    joinBtn.disabled = false;
  }, 8000);
}

playBtn.addEventListener("click", () => startConnect(""));
joinBtn.addEventListener("click", () => startConnect(codeInput.value.trim().toUpperCase()));
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startConnect(""); });
codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startConnect(codeInput.value.trim().toUpperCase());
});

function enterGame(id: number, name: string): void {
  playing = true;
  menu.classList.add("hidden");
  hud.show();
  // Free skins are assigned per slot so players are visually distinct before
  // anybody has bought anything.
  selfCharacter = new Character(SKINS[id % 2].id, name);
  selfCharacter.hideNameplate();
  view.scene.add(selfCharacter.root);
  controls.requestLock();
}

function leaveGame(reason: string): void {
  connectAttempt++;
  if (!playing) {
    statusEl.className = "status error";
    statusEl.textContent = reason;
    playBtn.disabled = false;
    joinBtn.disabled = false;
    return;
  }
  playing = false;
  hud.hide();
  menu.classList.remove("hidden");
  statusEl.className = "status error";
  statusEl.textContent = reason;
  playBtn.disabled = false;
  joinBtn.disabled = false;
  document.exitPointerLock();

  for (const c of characters.values()) c.dispose(view.scene);
  characters.clear();
  if (selfCharacter) { selfCharacter.dispose(view.scene); selfCharacter = null; }
}

app.addEventListener("click", () => {
  if (playing && !controls.isLocked) controls.requestLock();
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function nameOf(id: number): string {
  if (id === conn.selfId) return "You";
  return matchPlayers.find((p) => p.id === id)?.name ?? "Player";
}

function handleEvents(events: readonly GameEvent[]): void {
  for (const e of events) {
    switch (e.kind) {
      case EV_SHOT: {
        const sniper = e.weapon === W_SNIPER;
        effects.spawnTracer(e.ox, e.oy, e.oz, e.ex, e.ey, e.ez, sniper ? 0xbfe6ff : 0xfff0b0);
        effects.spawnImpact(e.ex, e.ey, e.ez);
        break;
      }
      case EV_HIT:
        if (e.shooter === conn.selfId) hud.showHitmarker(e.headshot === 1);
        if (e.target === conn.selfId) hud.flashDamage();
        break;
      case EV_DEATH: {
        const victim = nameOf(e.victim);
        const killer = e.killer === 255 ? null : nameOf(e.killer);
        const text = killer ? `${killer} eliminated ${victim}` : `${victim} was eliminated`;
        hud.addKillFeed(text, e.victim === conn.selfId || e.killer === conn.selfId);
        if (e.victim === conn.selfId) {
          respawnAtMs = performance.now() + 3000;
        }
        break;
      }
      case EV_RESPAWN:
        if (e.id === conn.selfId) {
          respawnAtMs = 0;
          hud.setCenterMessage("");
        }
        break;
      default: break;
    }
  }
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

const camTarget = new THREE.Vector3();
let camDistance = 3.4;

function updateCamera(aiming: boolean): void {
  const s = conn.self;
  const fwd = forwardVector(controls.yaw, controls.pitch);
  const right = rightVector(controls.yaw);

  camTarget.set(s.x, s.y + EYE_HEIGHT, s.z);

  const wantDistance = aiming ? 1.9 : 3.4;
  camDistance += (wantDistance - camDistance) * 0.22;
  const shoulder = aiming ? 0.42 : 0.62;

  let dx = -fwd[0] * camDistance + right[0] * shoulder;
  let dy = -fwd[1] * camDistance + 0.18;
  let dz = -fwd[2] * camDistance + right[2] * shoulder;

  // Pull the camera in if the boom would clip through geometry, so building a
  // box around yourself does not black out the screen.
  const len = Math.hypot(dx, dy, dz);
  if (len > 0.01) {
    const hit = conn.world.raycast(
      camTarget.x, camTarget.y, camTarget.z,
      dx / len, dy / len, dz / len,
      len + 0.3, Date.now() / 1000,
    );
    if (hit) {
      const allowed = Math.max(0.35, hit.t - 0.25);
      const scale = allowed / len;
      dx *= scale; dy *= scale; dz *= scale;
    }
  }

  view.camera.position.set(camTarget.x + dx, camTarget.y + dy, camTarget.z + dz);
  // Orient directly from the input angles rather than lookAt, so the view
  // matches the ray the server will actually trace.
  view.camera.rotation.order = "YXZ";
  view.camera.rotation.y = controls.yaw + Math.PI;
  view.camera.rotation.x = controls.pitch;
  view.camera.rotation.z = 0;

  const weapon = weaponById(ARENA_LOADOUT[controls.slot] ?? 0);
  view.setFov(aiming && !controls.inBuildMode ? 78 / weapon.adsZoom : 78);
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

let lastFrame = performance.now();
let fps = 60;

function frame(now: number): void {
  requestAnimationFrame(frame);

  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  fps = fps * 0.92 + (1 / Math.max(dt, 1e-4)) * 0.08;

  if (!playing) {
    view.render();
    return;
  }

  const nowSec = Date.now() / 1000;
  const self = conn.self;
  const aiming = controls.isLocked && !controls.inBuildMode && controls.aiming;

  updateCamera(aiming);
  pieces.sync(conn.world, nowSec);
  effects.update(dt);

  // --- build ghost ---
  if (controls.inBuildMode && self.alive) {
    const target = resolvePlacement({
      x: self.x, y: self.y, z: self.z, yaw: controls.yaw, buildSlot: controls.slot,
    });
    if (target) {
      const occupied = conn.world.pieces.has(
        packKey(target.gx, target.gy, target.gz, target.slot),
      );
      ghost.show(target, occupied);
    } else {
      ghost.hide();
    }
  } else {
    ghost.hide();
  }

  // --- local body ---
  if (selfCharacter) {
    selfCharacter.root.visible = self.alive;
    selfCharacter.update(
      self.x, self.y, self.z,
      controls.yaw, controls.pitch,
      Math.hypot(self.vx, self.vz), self.grounded, dt,
    );
    // No nameplate on your own body.
  }

  // --- remote bodies ---
  const seen = new Set<number>();
  for (const pose of conn.remotePoses()) {
    seen.add(pose.id);
    let ch = characters.get(pose.id);
    if (!ch) {
      ch = new Character(SKINS[pose.id % 2].id, nameOf(pose.id));
      view.scene.add(ch.root);
      characters.set(pose.id, ch);
    }
    const alive = (pose.state.flags & PF_ALIVE) !== 0;
    ch.root.visible = alive;
    ch.setNameplate(nameOf(pose.id), pose.state.hpPct);
    // Remote speed is not transmitted; derive it from the flag the server sets
    // so the walk cycle still plays.
    const moving = (pose.state.flags & 32) !== 0;
    ch.update(
      pose.x, pose.y, pose.z, pose.yaw, pose.pitch,
      moving ? 6 : 0, (pose.state.flags & PF_GROUNDED) !== 0, dt,
    );
  }
  for (const [id, ch] of characters) {
    if (seen.has(id)) continue;
    ch.dispose(view.scene);
    characters.delete(id);
  }

  // --- hud ---
  hud.setVitals(self.hp, self.shield);
  hud.setMats(self.mats, self.material);
  hud.setSlot(controls.slot, controls.inBuildMode);
  const weaponIdx = controls.inBuildMode ? 0 : controls.slot;
  hud.setAmmo(weaponIdx, self.ammo, false);
  hud.setScore(matchPlayers, conn.selfId, scoreTarget);
  hud.setNetStat(conn.rttMs, fps, conn.pendingInputCount);
  if (!self.alive && respawnAtMs > 0) {
    const left = Math.max(0, (respawnAtMs - performance.now()) / 1000);
    hud.setCenterMessage("Eliminated", `Respawning in ${left.toFixed(1)}s`);
  }
  hud.tick();

  view.render();
}

// ---------------------------------------------------------------------------
// Network tick
//
// Deliberately NOT driven by requestAnimationFrame: browsers pause rAF in
// background tabs, which would stop inputs and get the player kicked for
// inactivity the moment they alt-tab. A timer keeps running (throttled to
// roughly 1 Hz when hidden), which is enough to hold the connection open.
// ---------------------------------------------------------------------------

let tickAccumulator = 0;
let lastTick = performance.now();

setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now;
  if (!playing) return;

  tickAccumulator += dt;
  let steps = 0;
  // Cap the catch-up: after a long stall we want to resync, not replay a
  // second of banked movement.
  while (tickAccumulator >= TICK_DT && steps < 6) {
    conn.pushInput(controls.sample());
    tickAccumulator -= TICK_DT;
    steps++;
  }
  if (tickAccumulator > TICK_DT * 6) tickAccumulator = 0;
}, 1000 / TICK_HZ);

requestAnimationFrame(frame);
