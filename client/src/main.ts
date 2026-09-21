import { cameraPose, easeCameraDistance } from "@shared/camera";
import * as THREE from "three";
import { TICK_DT, TICK_HZ, EYE_HEIGHT, TILE } from "@shared/constants";
import { eyeHeightFor } from "@shared/sim";
import { resolvePlacement, placementIssue } from "@shared/placement";
import { unpackKey } from "@shared/build";
import { weaponById, ARENA_LOADOUT, W_SNIPER, W_PICKAXE } from "@shared/weapons";
import { locationAt, SCENERY } from "@shared/map";
import { TREE_PERCH_RADIUS, PLAYER_HEIGHT, CROUCH_HEIGHT } from "@shared/constants";
import { SKINS } from "@shared/skins";
import {
  EV_PIECE_DAMAGE, EV_SHOT, EV_HIT, EV_DEATH, EV_RESPAWN, EV_PIECE_ADD, EV_PIECE_REMOVE,
  EV_FOLIAGE, PF_ALIVE, PF_GROUNDED, PF_CROUCH,
} from "@shared/protocol";
import type { GameEvent } from "@shared/snapshot";

import { createRenderer } from "./render/scene";
import { PieceRenderer, BuildGhost } from "./render/pieces";
import { Character } from "./render/character";
import { Effects } from "./render/effects";
import { Controls, ACTION_LABELS, keyLabel, type Action } from "./input/controls";
import { Connection, type MatchPlayerInfo } from "./net/connection";
import { Hud } from "./ui/hud";
import { FrameLimiter, type FpsTarget } from "./render/framelimiter";
import { Sound } from "./audio/sound";
import { ViewEffects } from "./render/viewfx";
import { loadModels } from "./render/models";

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
// Cast through unknown: the Workers type definitions in this project shadow
// part of the DOM lib, so the direct assertion is rejected.
const fpsSelect = document.getElementById("fpsSelect") as unknown as HTMLSelectElement;

// Optional art, loaded before the scene is built. Resolves immediately to an
// empty library when no models are installed, in which case everything falls
// back to the procedural shapes and nothing waits.
const models = await loadModels();
const view = createRenderer(app, models);
const hud = new Hud();
const pieces = new PieceRenderer(view.scene, view.maxAnisotropy);
const ghost = new BuildGhost(view.scene);
const effects = new Effects(view.scene);
const sound = new Sound();
const viewfx = new ViewEffects();
const limiter = new FrameLimiter();

const characters = new Map<number, Character>();
let selfCharacter: Character | null = null;
let matchPlayers: MatchPlayerInfo[] = [];
let scoreTarget = 5;
let playing = false;
let respawnAtMs = 0;
const renderSelf={x:0,y:0,z:0};
let renderReady=false;

nameInput.value = localStorage.getItem("clutch.name") ?? "";

fpsSelect.value = String(limiter.fpsTarget);
fpsSelect.addEventListener("change", () => {
  limiter.setTarget(Number(fpsSelect.value) as FpsTarget);
});

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
      sound.win();
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
  onScoreboard(open) { hud.setScoreboardOpen(open); },
});

// Touch controls use the same input sampler as keyboard/mouse, so prediction
// and the server see identical commands on phones and tablets.
//
// The markup these bind to did not exist until now, so this whole block was
// attaching to nothing and every touch device was left with keyboard handlers
// it had no way to drive.
if (matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0) {
  document.body.classList.add("touch");
}
const mobile = document.getElementById("mobileControls");
const stick = document.getElementById("mobileStick");
if (mobile && stick) {
  const knob = stick.querySelector("i") as HTMLElement | null;
  let stickId = -1;
  const moveStick = (e: PointerEvent) => {
    const r = stick.getBoundingClientRect(), max = r.width * 0.34;
    let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(x, y);
    if (d > max) { x *= max / d; y *= max / d; }
    if (knob) knob.style.transform = `translate(${x}px,${y}px)`;
    controls.setTouchMove(x / max, -y / max);
  };
  stick.addEventListener("pointerdown", e => { stickId = e.pointerId; stick.setPointerCapture(stickId); moveStick(e); });
  stick.addEventListener("pointermove", e => { if (e.pointerId === stickId) moveStick(e); });
  stick.addEventListener("pointerup", e => { if (e.pointerId === stickId) { stickId = -1; if (knob) knob.style.transform = ""; controls.setTouchMove(0, 0); } });
  const look = document.getElementById("mobileLook");
  let lookId = -1, lastX = 0, lastY = 0;
  if (look) {
    look.addEventListener("pointerdown", e => { lookId = e.pointerId; lastX = e.clientX; lastY = e.clientY; look.setPointerCapture(lookId); });
    look.addEventListener("pointermove", e => { if (e.pointerId === lookId) { controls.touchLook(e.clientX - lastX, e.clientY - lastY); lastX = e.clientX; lastY = e.clientY; } });
    look.addEventListener("pointerup", e => { if (e.pointerId === lookId) lookId = -1; });
  }
  mobile.querySelectorAll<HTMLButtonElement>("[data-touch]").forEach(b => {
    const a = b.dataset.touch!;
    // Toggles report back whether they are now on, so a latched AIM or SPRINT
    // button looks latched instead of leaving the player guessing.
    const paint = (on: boolean) => b.classList.toggle("held", on);
    b.addEventListener("pointerdown", e => { e.preventDefault(); paint(controls.setTouchAction(a, true)); });
    b.addEventListener("pointerup", () => paint(controls.setTouchAction(a, false)));
    b.addEventListener("pointercancel", () => paint(controls.setTouchAction(a, false)));
  });
}

// Tapping the on-screen weapon bar, build bar or material boxes selects them.
// Without this the only way to change weapon on a phone was a key that phones
// do not have.
hud.onSlotTapped = (slot) => controls.selectSlot(slot);
hud.onMaterialTapped = (material) => controls.selectMaterialPublic(material);

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
  // Must happen inside the click handler: browsers refuse to start an
  // AudioContext outside a user gesture, and it would stay muted forever.
  if (playBtn.disabled) return;
  document.getElementById("roomBadge")!.textContent = room ? `PRIVATE ROOM · ${room}` : "CLUTCH · PUBLIC ARENA";
  sound.init();
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
function joinRoom(): void {
  const code = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) { statusEl.textContent = "Enter your friend’s room code first."; return; }
  startConnect(code);
}
joinBtn.addEventListener("click", joinRoom);
document.getElementById("createBtn")!.addEventListener("click", () => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const code = Array.from(bytes, b => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
  codeInput.value = code;
  startConnect(code);
});
const sensitivity = document.getElementById("sensitivity") as HTMLInputElement;
sensitivity.value = localStorage.getItem("clutch.sensitivity") ?? "0.0022";
controls.sensitivity = Number(sensitivity.value);
sensitivity.addEventListener("input", () => {
  controls.sensitivity = Number(sensitivity.value);
  localStorage.setItem("clutch.sensitivity", sensitivity.value);
});
// --- key bindings -----------------------------------------------------------
//
// Click a binding, press a key. Escape cancels rather than binding Escape,
// which would take the pointer-lock release key away from the player.
{
  const container = document.getElementById("keybinds")!;
  const buttons = new Map<Action, HTMLButtonElement>();
  let listening: Action | null = null;

  const refresh = (): void => {
    for (const [action, button] of buttons) {
      const code = controls.bindings[action];
      button.textContent = listening === action
        ? "Press a key…"
        : code ? keyLabel(code) : "Unbound";
      button.classList.toggle("listening", listening === action);
    }
  };

  for (const [action, label] of ACTION_LABELS) {
    const name = document.createElement("label");
    name.textContent = label;
    const button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", () => {
      listening = listening === action ? null : action;
      refresh();
    });
    container.appendChild(name);
    container.appendChild(button);
    buttons.set(action, button);
  }

  // Capture phase: while a binding is being captured, no other keydown handler
  // on the page (mute, the name field, the game itself) should see the key.
  window.addEventListener("keydown", (e) => {
    if (listening === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code !== "Escape") controls.setBinding(listening, e.code);
    listening = null;
    refresh();
  }, true);

  document.getElementById("resetBinds")!.addEventListener("click", () => {
    controls.resetBindings();
    listening = null;
    refresh();
  });
  refresh();
}

{
  const toggle = document.getElementById("statsToggle") as unknown as HTMLInputElement;
  const netstat = document.getElementById("netstat")!;
  const apply = (on: boolean) => {
    netstat.style.display = on ? "block" : "none";
    toggle.checked = on;
    try { localStorage.setItem("clutch.stats", on ? "1" : "0"); } catch { /* ignore */ }
  };
  let initial = true;
  try { initial = localStorage.getItem("clutch.stats") !== "0"; } catch { /* default on */ }
  apply(initial);
  toggle.addEventListener("change", () => apply(toggle.checked));
}
document.getElementById("quality")!.addEventListener("change", e => {
  const quality = (e.target as HTMLSelectElement).value;
  view.renderer.setPixelRatio(Math.min(devicePixelRatio, quality === "low" ? 1 : quality === "high" ? 2 : 1.5));
  view.renderer.shadowMap.enabled = quality !== "low";
  view.setBloom(quality !== "low");
  view.scene.traverse(o => { if (o instanceof THREE.Mesh) {
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of materials) m.needsUpdate = true;
  }});
  view.resize();
});
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startConnect(""); });
codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinRoom();
});

function enterGame(id: number, name: string): void {
  controls.yaw = conn.self.yaw;
  controls.pitch = 0;
  renderReady=false;
  playing = true;
  menu.classList.add("hidden");
  hud.show();
  // Free skins are assigned per slot so players are visually distinct before
  // anybody has bought anything.
  selfCharacter = new Character(SKINS[id % 2].id, name);
  selfCharacter.hideNameplate();
  view.scene.add(selfCharacter.root);
  if (!document.body.classList.contains("touch")) controls.requestLock();
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
  if (document.body.classList.contains("touch")) return;
  if (playing && !controls.isLocked) controls.requestLock();
});

// Mute lives outside Controls because that only listens while pointer-locked,
// and muting is exactly what you want to do when you have just tabbed away.
window.addEventListener("keydown", (e) => {
  if (e.code !== "KeyM" || e.repeat) return;
  // Cmd/Ctrl+M is the aim-assist chord below, not mute.
  if (e.metaKey || e.ctrlKey) return;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
  const muted = sound.toggleMute();
  hud.setCenterMessage(muted ? "Sound off" : "Sound on");
  setTimeout(() => hud.setCenterMessage(""), 900);
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function nameOf(id: number): string {
  if (id === conn.selfId) return "You";
  return matchPlayers.find((p) => p.id === id)?.name ?? "Player";
}

/**
 * Point the red wedge at whoever just hit you.
 *
 * The shooter's position is not in the hit event, and does not need to be: we
 * are already interpolating every remote player, so looking the shooter up
 * costs nothing and avoids widening the snapshot for all four players to carry
 * a field only the victim reads.
 */
function showDamageDirection(shooterId: number): void {
  if (shooterId === conn.selfId || shooterId === 255) return;
  const shooter = conn.remotePoses().find((p) => p.id === shooterId);
  if (!shooter) return;
  const dx = shooter.x - conn.self.x;
  const dz = shooter.z - conn.self.z;
  if (Math.hypot(dx, dz) < 0.01) return;
  const yaw = controls.yaw;
  const along = dx * -Math.sin(yaw) + dz * Math.cos(yaw);
  const side = dx * -Math.cos(yaw) + dz * -Math.sin(yaw);
  hud.addDamageDirection(Math.atan2(side, along));
}

function handleEvents(events: readonly GameEvent[]): void {
  // A shotgun emits one EV_SHOT per pellet, so nine events describe a single
  // trigger pull. Tracers want all nine; the gunshot must fire exactly once.
  const voiced = new Set<number>();
  let dealt = 0;
  let headshot = false;

  for (const e of events) {
    switch (e.kind) {
      case EV_SHOT: {
        const sniper = e.weapon === W_SNIPER;
        // A pickaxe swing is not a bullet: no tracer, and no spark unless it
        // actually connected.
        if (e.weapon !== W_PICKAXE) {
          effects.spawnTracer(e.ox, e.oy, e.oz, e.ex, e.ey, e.ez, sniper ? 0xbfe6ff : 0xfff0b0);
        }
        // Only spark on a real impact. This used to fire on every shot, so a
        // miss left a spark hanging in empty air at the weapon's max range.
        if (e.hit !== 0) {
          effects.spawnImpact(e.ex, e.ey, e.ez, e.hit === 2 ? 0xff8a7a : 0xffd27a);
        }

        const voice = e.shooter * 256 + e.weapon;
        if (!voiced.has(voice)) {
          voiced.add(voice);
          if(e.shooter===conn.selfId) selfCharacter?.fire();
          else characters.get(e.shooter)?.fire();
          sound.shot(e.weapon, e.ox, e.oy, e.oz);
          if (e.weapon !== W_PICKAXE) effects.spawnMuzzleFlash(e.ox, e.oy, e.oz);
          // Only your own shots kick your own camera, or bloom your own cone.
          if (e.shooter === conn.selfId) {
            viewfx.fire(e.weapon);
            conn.notePredictedShot(e.weapon);
          } else if (e.weapon !== W_PICKAXE) {
            // Somebody else fired: put it on the compass. Sound alone tells you
            // a fight started, not which way to turn.
            hud.addGunshot(e.ox, e.oz);
          }
        }
        break;
      }
      case EV_PIECE_ADD: {
        const c = unpackKey(e.key);
        sound.build((c.gx + 0.5) * TILE, (c.gy + 0.5) * TILE, (c.gz + 0.5) * TILE);
        break;
      }
      case EV_PIECE_DAMAGE: {
        pieces.flash(e.key);
        break;
      }
      case EV_PIECE_REMOVE: {
        const c = unpackKey(e.key);
        const bx = (c.gx + 0.5) * TILE, by = (c.gy + 0.5) * TILE, bz = (c.gz + 0.5) * TILE;
        effects.breakBurst(bx, by, bz);
        sound.destroy(bx, by, bz);
        // A piece breaking nearby should register physically, falling off with
        // distance so the whole map does not shake every time anyone builds.
        const dist = Math.hypot(bx - conn.self.x, by - conn.self.y, bz - conn.self.z);
        if (dist < 18) viewfx.bump(0.22 * (1 - dist / 18));
        break;
      }
      case EV_HIT:
        if (e.shooter === conn.selfId) {
          dealt += e.damage;
          headshot ||= e.headshot === 1;
          hud.showHitmarker(e.headshot === 1);
          sound.hitmarker(e.headshot === 1);
        }
        if (e.target === conn.selfId) {
          hud.flashDamage();
          sound.damage();
          viewfx.damage(e.damage);
          showDamageDirection(e.shooter);
        }
        break;
      case EV_DEATH: {
        const victim = nameOf(e.victim);
        const killer = e.killer === 255 ? null : nameOf(e.killer);
        const text = killer ? `${killer} eliminated ${victim}` : `${victim} was eliminated`;
        hud.addKillFeed(text, e.victim === conn.selfId || e.killer === conn.selfId);
        sound.death();
        if (e.victim === conn.selfId) {
          respawnAtMs = performance.now() + 3000;
        }
        break;
      }
      case EV_FOLIAGE:
        strippedTrees.set(e.index, performance.now() + FOLIAGE_REGROW_MS);
        refreshTreeAlpha(e.index);
        break;
      case EV_RESPAWN:
        if (e.id === conn.selfId) {
          respawnAtMs = 0;
          hud.setCenterMessage("");
          sound.respawn();
        }
        break;
      default: break;
    }
  }
  if (dealt) hud.showDamage(dealt, headshot);
}

// ---------------------------------------------------------------------------
// Tree cover
//
// Trees are climbable now, which makes the canopy real cover -- and real cover
// you cannot see out of is just a blindfold. So the tree you are sitting in
// fades for YOU while you aim, and a tree somebody has shot the leaves off
// fades for EVERYONE. Both go through the same per-instance alpha, so a tree
// that is both only fades once.
// ---------------------------------------------------------------------------

/** How long a tree stays stripped before the leaves read as whole again. */
const FOLIAGE_REGROW_MS = 22_000;
const strippedTrees = new Map<number, number>();
let occupiedTree = -1;

/** The tree whose canopy contains this point, or -1. */
function treeAt(x: number, y: number, z: number): number {
  const reach = TREE_PERCH_RADIUS + 0.7;
  for (let i = 0; i < SCENERY.length; i++) {
    const p = SCENERY[i];
    if (p.kind !== "tree") continue;
    if (Math.abs(p.x - x) > reach || Math.abs(p.z - z) > reach) continue;
    // Only once you are actually up in it; standing at the base does not count.
    if (y < p.y + 1.2 || y > p.y + p.size * 1.7) continue;
    return i;
  }
  return -1;
}

function refreshTreeAlpha(index: number): void {
  if (index < 0) return;
  // Sitting in it is the stronger fade: you need to see out, and you are the
  // only one paying for it.
  const alpha = index === occupiedTree ? 0.28 : strippedTrees.has(index) ? 0.45 : 1;
  view.landscape.setTreeAlpha(index, alpha);
}

function updateTreeCover(aiming: boolean, x: number, y: number, z: number): void {
  const wanted = aiming ? treeAt(x, y, z) : -1;
  if (wanted !== occupiedTree) {
    const previous = occupiedTree;
    occupiedTree = wanted;
    refreshTreeAlpha(previous);
    refreshTreeAlpha(wanted);
  }
  const now = performance.now();
  for (const [index, until] of strippedTrees) {
    if (now <= until) continue;
    strippedTrees.delete(index);
    refreshTreeAlpha(index);
  }
}

// ---------------------------------------------------------------------------
// Aim assist (development toggle)
//
// Cmd/Ctrl+M. Steers the local look angles onto the nearest living opponent's
// head. It has to work this way round rather than server-side, because the
// server traces every shot from the player's own yaw and pitch -- so the only
// thing that can move a shot is the aim itself.
//
// It is deliberately loud: a badge sits on the HUD the entire time it is on.
// This is a multiplayer game, so a silent version of this would be a cheat
// rather than a tool.
// ---------------------------------------------------------------------------

// Controls owns the flag. The key, the chord and the on-screen button all go
// through it, so they cannot disagree about whether the lock is on.
let aimAssistShown = false;

function announceAimLock(): void {
  const on = controls.aimbot;
  if (on === aimAssistShown) return;
  aimAssistShown = on;
  hud.setAimbot(on);
  hud.setCenterMessage(on ? "AIM LOCK ON" : "Aim lock off");
  setTimeout(() => hud.setCenterMessage(""), 900);
}

// Cmd/Ctrl+M still works where the browser allows it, but it is a fallback
// rather than the binding: on macOS Cmd+M is Minimise Window, and when the OS
// takes it the page never sees the keystroke at all -- which is
// indistinguishable from the feature being broken. The real binding is a plain
// rebindable key (J by default), handled in Controls.
window.addEventListener("keydown", (e) => {
  if (e.code !== "KeyM" || e.repeat) return;
  if (!e.metaKey && !e.ctrlKey) return;
  e.preventDefault();
  controls.toggleAimLock();
});

/**
 * Point the view at whoever the server's lock is about to shoot.
 *
 * This no longer does the aiming -- the server does, from BTN_AIMBOT -- so its
 * only job is to keep the crosshair on the same target the round is going to.
 * It therefore has to pick the target the same way: the head, at the target's
 * real stance, preferring one that is not behind cover. No drop compensation
 * here on purpose; the camera should sit on the target while the round arcs to
 * it, rather than tilting off into the sky at long range.
 */
function applyAimAssist(): void {
  announceAimLock();
  if (!controls.aimbot) return;
  // On, but with nobody to lock onto. Say so, or an empty server looks like a
  // broken toggle.
  hud.setAimbotLocked(false, false);
  if (!conn.self.alive) return;
  const eyeY = conn.self.y + eyeHeightFor(conn.self.crouch);
  const now = Date.now() / 1000;
  let bestDistance = Infinity;
  let bestVisible = false;
  let bx = 0, by = 0, bz = 0;

  for (const pose of conn.remotePoses()) {
    if ((pose.state.flags & PF_ALIVE) === 0) continue;
    const height = (pose.state.flags & PF_CROUCH) !== 0 ? CROUCH_HEIGHT : PLAYER_HEIGHT;
    const dx = pose.x - conn.self.x;
    const dy = pose.y + height - 0.14 - eyeY;
    const dz = pose.z - conn.self.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 1e-3) continue;

    const blocked = conn.world.raycast(
      conn.self.x, eyeY, conn.self.z,
      dx / distance, dy / distance, dz / distance,
      distance - 0.05, now,
    );
    const visible = blocked === null;
    if (bestVisible && !visible) continue;
    if (visible === bestVisible && distance >= bestDistance) continue;

    bestDistance = distance;
    bestVisible = visible;
    bx = dx; by = dy; bz = dz;
  }
  // No target: leave the player's own aim completely alone.
  if (bestDistance === Infinity) return;
  controls.yaw = Math.atan2(-bx, bz);
  controls.pitch = Math.atan2(by, Math.hypot(bx, bz));
  hud.setAimbotLocked(bestVisible, true);
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

let cameraDistance=0;
function updateCamera(aiming: boolean, dt: number): void {
  const weapon=weaponById(ARENA_LOADOUT[controls.slot]??0);
  // Always the smoothed position, never the raw authoritative one.
  //
  // Aiming used to switch the camera over to conn.self, which is snapped to
  // the server every snapshot and then replayed: perfectly fine as simulation
  // state, and visibly steppy as a camera anchor. So the moment you pressed
  // aim the camera jumped from a smoothed anchor to a jittering one, and back
  // again when you released -- that is the "ADS is glitchy with the character
  // movement" bug. The boom easing below is now unconditional for the same
  // reason: it used to be skipped while aiming, so every aim snapped.
  const pose = cameraPose(
    {...renderSelf, yaw:controls.yaw, pitch:controls.pitch, crouch:conn.self.crouch},
    aiming, conn.world, Date.now()/1000, weapon.id===W_SNIPER,
  );
  const eye=new THREE.Vector3(renderSelf.x,renderSelf.y+eyeHeightFor(conn.self.crouch),renderSelf.z);
  const boom=new THREE.Vector3(...pose.origin).sub(eye);
  const safe=boom.length();
  cameraDistance=easeCameraDistance(cameraDistance,safe,dt);
  view.camera.position.copy(eye).addScaledVector(boom,safe>0?cameraDistance/safe:0);
  view.camera.rotation.order = "YXZ";
  // Recoil is added to the CAMERA only. The shot the server traces still uses
  // the player's real aim, so the kick is something you feel rather than
  // something that silently moves your crosshair off target.
  view.camera.rotation.set(
    controls.pitch + viewfx.pitchOffset,
    Math.PI - (controls.yaw + viewfx.yawOffset),
    0,
  );
  viewfx.applyShake(view.camera);
  const fov=(aiming&&!controls.inBuildMode?78/weapon.adsZoom:78)+viewfx.fovOffset;
  view.setFov(view.camera.fov+(fov-view.camera.fov)*(1-Math.exp(-18*dt)));
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

let lastFrame = performance.now();
let fps = 60;
let prevGrounded = false;
let prevVy = 0;

// Footsteps are driven by distance travelled rather than a timer, so they stay
// in step with actual movement instead of drifting when someone strafes.
const STEP_DISTANCE = 2.1;
const stepAccum = new Map<number, number>();
const stepLast = new Map<number, { x: number; z: number }>();

function footsteps(id: number, x: number, y: number, z: number, active: boolean): void {
  const prev = stepLast.get(id);
  stepLast.set(id, { x, z });
  if (!prev || !active) return;

  const d = Math.hypot(x - prev.x, z - prev.z);
  // A large jump means a respawn or teleport, not running.
  if (d > 1.5) return;

  const acc = (stepAccum.get(id) ?? 0) + d;
  if (acc >= STEP_DISTANCE) {
    stepAccum.set(id, 0);
    sound.step(x, y, z);
  } else {
    stepAccum.set(id, acc);
  }
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  // Rendering is capped; the network tick runs on its own timer and is
  // deliberately unaffected by this.
  if (!limiter.shouldRender(now)) return;

  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  fps = fps * 0.92 + (1 / Math.max(dt, 1e-4)) * 0.08;

  if (!playing) {
    view.render();
    return;
  }

  const nowSec = Date.now() / 1000;
  const self = conn.self;
  // Touch play never takes the pointer lock, so gating aim on it would make
  // aiming impossible on a phone.
  const canAct = controls.isLocked || document.body.classList.contains("touch");
  const aiming = canAct && !controls.inBuildMode && controls.aiming;
  applyAimAssist();

  const distance=Math.hypot(self.x-renderSelf.x,self.y-renderSelf.y,self.z-renderSelf.z);
  const blend=1-Math.exp(-24*dt);
  if(!renderReady || distance>3) { Object.assign(renderSelf,{x:self.x,y:self.y,z:self.z});renderReady=true; }
  else { renderSelf.x+=(self.x-renderSelf.x)*blend;renderSelf.y+=(self.y-renderSelf.y)*blend;renderSelf.z+=(self.z-renderSelf.z)*blend; }
  updateCamera(aiming, dt);
  viewfx.update(dt);
  sound.setListener(self.x, self.y + eyeHeightFor(self.crouch), self.z, controls.yaw);
  pieces.sync(conn.world, nowSec);
  pieces.updateVisibility(self.x, self.z);
  const direction=view.camera.getWorldDirection(new THREE.Vector3());
  const aimRange=weaponById(ARENA_LOADOUT[controls.slot]??0).range;
  const targetPiece=conn.world.raycast(view.camera.position.x,view.camera.position.y,view.camera.position.z,direction.x,direction.y,direction.z,aimRange,nowSec);
  hud.setStructure(targetPiece&&targetPiece.t<=18?targetPiece.piece:null,nowSec);
  hud.setLocation(locationAt(self.x, self.z));
  const aimPoint=view.camera.position.clone().addScaledVector(direction,targetPiece?.t??aimRange);
  effects.update(dt);

  // --- build ghost ---
  if (controls.inBuildMode && self.alive) {
    const target = resolvePlacement({
      x: self.x, y: self.y, z: self.z, yaw: controls.yaw, pitch: controls.pitch, buildSlot: controls.slot,
    }, conn.world);
    if (target) {
      const issue=placementIssue(self,target,conn.world);
      ghost.show(target,issue!==null||self.mats<10);
      hud.setBuildReason(issue??(self.mats<10?'Not enough materials':''));
    } else {
      ghost.hide();
      hud.setBuildReason('Out of reach');
    }
  } else {
    ghost.hide();
    hud.setBuildReason('');
  }

  // --- local jump and landing, from grounded transitions ---
  if (self.alive) {
    if (!prevGrounded && self.grounded) {
      sound.land(self.x, self.y, self.z, Math.abs(prevVy));
      viewfx.land(Math.abs(prevVy));
    } else if (prevGrounded && !self.grounded && self.vy > 2) {
      sound.jump(self.x, self.y, self.z);
    }
    footsteps(-1, self.x, self.y, self.z, self.grounded && Math.hypot(self.vx, self.vz) > 1);
  }
  prevGrounded = self.grounded;
  prevVy = self.vy;

  // --- local body ---
  if (selfCharacter) {
    // Hide only our local model when the camera enters its silhouette. Other
    // players still see the full character, including while we use the scope.
    selfCharacter.root.visible = self.alive && view.camera.position.distanceTo(new THREE.Vector3(renderSelf.x,renderSelf.y+EYE_HEIGHT,renderSelf.z))>.85;
    selfCharacter.setWeapon(controls.inBuildMode?255:ARENA_LOADOUT[controls.slot]);
    selfCharacter.update(
      renderSelf.x, renderSelf.y, renderSelf.z,
      controls.yaw, controls.pitch,
      Math.hypot(self.vx, self.vz), self.grounded, dt,
    );
    selfCharacter.aimAt(aimPoint);
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
    ch.setWeapon(pose.state.weapon);
    ch.setNameplate(nameOf(pose.id));
    // Remote speed is not transmitted; derive it from the flag the server sets
    // so the walk cycle still plays.
    const moving = (pose.state.flags & 32) !== 0;
    const grounded = (pose.state.flags & PF_GROUNDED) !== 0;
    ch.update(
      pose.x, pose.y, pose.z, pose.yaw, pose.pitch,
      moving ? 6 : 0, grounded, dt,
    );
    if (alive) footsteps(pose.id, pose.x, pose.y, pose.z, grounded && moving);
  }
  for (const [id, ch] of characters) {
    if (seen.has(id)) continue;
    ch.dispose(view.scene);
    characters.delete(id);
  }

  // --- hud ---
  const weapon = weaponById(ARENA_LOADOUT[controls.slot] ?? 0);
  hud.setScope(aiming && weapon.id === W_SNIPER);
  updateTreeCover(aiming, renderSelf.x, renderSelf.y, renderSelf.z);
  hud.setVitals(self.hp, self.shield);
  hud.setStamina(self.stamina);
  hud.setMats(self.mats, self.material);
  hud.setSlot(controls.slot, controls.inBuildMode, self.material);
  hud.setReticle(aiming, controls.slot, controls.inBuildMode, self.bloom);
  const weaponIdx = controls.inBuildMode ? 0 : controls.slot;
  hud.setAmmo(weaponIdx, self.ammo, self.reloadMs > 0, controls.inBuildMode, self.mats);
  hud.setScore(matchPlayers, conn.selfId, scoreTarget);
  hud.updateCompass(self.x, self.z, controls.yaw);
  hud.setScoreboard(matchPlayers, conn.selfId);
  hud.setNetStat(conn.rttMs, fps, conn.pendingInputCount, limiter.fpsTarget);
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
    if(conn.canAcceptInput) conn.pushInput(controls.sample());
    tickAccumulator -= TICK_DT;
    steps++;
  }
  if (tickAccumulator > TICK_DT * 6) tickAccumulator = 0;
}, 1000 / TICK_HZ);

requestAnimationFrame(frame);

const volume=document.getElementById("volume") as HTMLInputElement;
volume.value=localStorage.getItem("clutch.volume")??"0.6";
volume.addEventListener("input",()=>sound.setVolume(Number(volume.value)));
