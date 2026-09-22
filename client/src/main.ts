import { cameraPose, easeCameraDistance } from "@shared/camera";
import * as THREE from "three";
import { TICK_DT, TICK_HZ, EYE_HEIGHT, TILE, MATERIALS } from "@shared/constants";
import { eyeHeightFor } from "@shared/sim";
import { resolvePlacement, placementIssue, BUILD_SHIELD } from "@shared/placement";
import { unpackKey } from "@shared/build";
import { weaponById, ARENA_LOADOUT, W_SNIPER, W_PICKAXE } from "@shared/weapons";
import { locationAt, SCENERY } from "@shared/map";
import { SKINS } from "@shared/skins";
import {
  EV_PIECE_DAMAGE, EV_SHOT, EV_HIT, EV_DEATH, EV_RESPAWN, EV_PIECE_ADD, EV_PIECE_REMOVE,
  EV_FOLIAGE, EV_CRITTER, PF_ALIVE, PF_GROUNDED, PF_CROUCH, PF_AIMING, PF_SLIDING,
} from "@shared/protocol";
import type { GameEvent } from "@shared/snapshot";

import { createRenderer } from "./render/scene";
import { PieceRenderer, BuildGhost } from "./render/pieces";
import { Character } from "./render/character";
import { Effects } from "./render/effects";
import { Controls, ACTION_LABELS, keyLabel, type Action } from "./input/controls";
import { Connection, type MatchPlayerInfo } from "./net/connection";
import { Hud, standingsTable } from "./ui/hud";
import { FrameLimiter, type FpsTarget } from "./render/framelimiter";
import { Sound } from "./audio/sound";
import { ViewEffects } from "./render/viewfx";
import { loadModels } from "./render/models";
import { createCritters } from "./render/critters";

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
const models = await loadModels((loaded, total) => {
  document.getElementById("loadingProgress")!.style.width = `${Math.round(loaded / Math.max(1, total) * 100)}%`;
  document.getElementById("loadingText")!.textContent = "Loading the arena…";
});
const view = createRenderer(app, models);
const hud = new Hud();
const pieces = new PieceRenderer(view.scene, view.maxAnisotropy);
const ghost = new BuildGhost(view.scene);
const effects = new Effects(view.scene);
const sound = new Sound();
const viewfx = new ViewEffects();
const limiter = new FrameLimiter();
const critters = createCritters(view.scene);

const characters = new Map<number, Character>();
let selfCharacter: Character | null = null;
let matchPlayers: MatchPlayerInfo[] = [];
let scoreTarget = 5;
let playing = false;
let menuOpen = true;
let helpTimer: ReturnType<typeof setTimeout> | undefined;
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
    if (typeof msg.target === "number") { scoreTarget = msg.target; hud.scoreTarget = scoreTarget; }
    refreshStandings();
    const me = matchPlayers.find((p) => p.id === conn.selfId);
    hud.setKills(me ? me.kills : 0, scoreTarget);
    if (msg.roundOver) {
      const winner = String(msg.winnerName ?? "Someone");
      sound.win();
      hud.setCenterMessage(`${winner} wins!`, `First to ${scoreTarget}`);
      setTimeout(() => hud.setCenterMessage(""), 3200);
      // The one moment in a match when everybody wants the table, so they do
      // not have to go looking for it.
      document.getElementById("lastResult")!.textContent = `${winner} won the last round`;
    }
  },
  onChat(name, text) { hud.addKillFeed(`${name}: ${text}`, false); },
  onClose(reason) { leaveGame(reason); },
});

const controls = new Controls(view.renderer.domElement, {
  sensitivity: 0.0022,
  onPointerLockChange(locked) {
    if (playing && !locked) openMenu();
    else if (locked) { closeMenu(); hud.setCenterMessage(""); }
  },
  onScoreboard(open) { if (open && playing) openMenu("standings"); },
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

/**
 * Pointer capture, but never fatal.
 *
 * setPointerCapture throws NotFoundError when the pointer is no longer active,
 * which happens more often than it sounds: a stale touch, a synthetic event, a
 * browser that has already released it. It used to be called before the rest
 * of the pointerdown handler, so a throw meant the stick never registered the
 * touch at all -- the control looked dead rather than degraded.
 */
function capture(el: HTMLElement, id: number): void {
  try { el.setPointerCapture(id); } catch { /* works without it, just less reliably */ }
}

if (mobile && stick) {
  const knob = stick.querySelector("i") as HTMLElement | null;
  let stickId = -1;
  const moveStick = (e: { clientX: number; clientY: number }) => {
    const r = stick.getBoundingClientRect(), max = r.width * 0.34;
    let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(x, y);
    if (d > max) { x *= max / d; y *= max / d; }
    if (knob) knob.style.transform = `translate(${x}px,${y}px)`;
    controls.setTouchMove(x / max, -y / max);
  };
  const releaseStick = () => {
    stickId = -1;
    if (knob) knob.style.transform = "";
    controls.setTouchMove(0, 0);
  };
  stick.addEventListener("pointerdown", e => { e.preventDefault(); stickId = e.pointerId; capture(stick, stickId); moveStick(e); });
  stick.addEventListener("pointermove", e => { if (e.pointerId === stickId) moveStick(e); });
  // pointercancel as well as pointerup, and a blur for good measure. A touch
  // that is cancelled -- an incoming call, the browser taking the gesture for
  // a system swipe, the tab going to the background -- never delivers a
  // pointerup, so without these the stick stays wherever it was last pushed
  // and the player runs into a wall until they notice.
  for (const kind of ["pointerup", "pointercancel", "pointerleave"]) {
    stick.addEventListener(kind, (e) => { if ((e as PointerEvent).pointerId === stickId) releaseStick(); });
  }
  window.addEventListener("blur", releaseStick);

  const look = document.getElementById("mobileLook");
  let lookId = -1, lastX = 0, lastY = 0;
  if (look) {
    look.addEventListener("pointerdown", e => { lookId = e.pointerId; lastX = e.clientX; lastY = e.clientY; capture(look, lookId); });
    look.addEventListener("pointermove", e => {
      if (e.pointerId !== lookId) return;
      controls.touchLook(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX; lastY = e.clientY;
    });
    for (const kind of ["pointerup", "pointercancel"]) {
      look.addEventListener(kind, (e) => { if ((e as PointerEvent).pointerId === lookId) lookId = -1; });
    }
  }
  mobile.querySelectorAll<HTMLButtonElement>("[data-touch]").forEach(b => {
    const a = b.dataset.touch!;
    // Toggles report back whether they are now on, so a latched AIM or SPRINT
    // button looks latched instead of leaving the player guessing.
    const paint = (on: boolean) => b.classList.toggle("held", on);
    b.addEventListener("pointerdown", e => { e.preventDefault(); capture(b, e.pointerId); paint(controls.setTouchAction(a, true)); });
    for (const kind of ["pointerup", "pointercancel", "lostpointercapture"]) {
      b.addEventListener(kind, () => paint(controls.setTouchAction(a, false)));
    }
  });
}

// Tapping the on-screen weapon bar, build bar or material boxes selects them.
// Without this the only way to change weapon on a phone was a key that phones
// do not have.
hud.onSlotTapped = (slot) => controls.selectSlot(slot);
hud.onMaterialTapped = (material) => controls.selectMaterialPublic(material);

function selectMenuPanel(panel: string): void {
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach(el => { el.hidden = el.dataset.panel !== panel; });
  document.querySelectorAll<HTMLButtonElement>("[data-menu-tab]").forEach(el => {
    el.setAttribute("aria-selected", String(el.dataset.menuTab === panel));
  });
}
function openMenu(panel?: string): void {
  menuOpen = true;
  controls.reset();
  hud.hide();
  menu.classList.remove("hidden");
  document.body.classList.toggle("in-match", playing);
  document.querySelectorAll("[data-touch]").forEach(el => el.classList.remove("held"));
  document.getElementById("mobileStick")?.querySelector("i")?.removeAttribute("style");
  document.getElementById("sessionNote")!.textContent = playing ? "Match is live. You can still take damage." : "Free-for-all · First to 5 eliminations";
  if (panel) selectMenuPanel(panel);
  refreshStandings();
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeMenu(): void {
  menuOpen = false;
  menu.classList.add("hidden");
  hud.show();
  controls.reset();
}
document.querySelectorAll<HTMLButtonElement>("[data-menu-tab]").forEach(button => {
  button.addEventListener("click", () => selectMenuPanel(button.dataset.menuTab!));
});
document.getElementById("resumeBtn")!.addEventListener("click", () => {
  closeMenu();
  if (!document.body.classList.contains("touch")) controls.requestLock();
});
document.getElementById("resumeFooter")!.addEventListener("click", () => document.getElementById("resumeBtn")!.click());
document.getElementById("leaveBtn")!.addEventListener("click", () => leaveGame("You left the match."));
document.getElementById("menuBtn")!.addEventListener("click", () => openMenu("play"));
window.addEventListener("keydown", e => {
  if (e.code === "Escape" && playing && !menuOpen) { e.preventDefault(); openMenu("play"); }
});
window.addEventListener("blur", () => { if (playing) openMenu(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && playing) openMenu(); });

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

/**
 * Redraw the leaderboard on the menu.
 *
 * Kept up to date while connected and left standing afterwards, so the panel
 * shows the result of the match you just played rather than emptying the
 * instant you disconnect.
 */
function refreshStandings(): void {
  const table = document.getElementById("standingsTable");
  if (table) table.innerHTML = standingsTable(matchPlayers, conn.selfId, scoreTarget);
}

function serverUrl(name: string, room: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  // In `vite dev` the client is on 5173 while the Worker runs on 8787, so
  // point at wrangler directly. In production both are the same origin.
  const host = location.host;
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
    conn.disconnect();
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
  let initial = false;
  try { initial = localStorage.getItem("clutch.stats") === "1"; } catch { /* default on */ }
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
  hud.setKills(0, scoreTarget);
  controls.reset();
  critters.state.reset();
  tickAccumulator = 0;
  closeMenu();
  // The control reminder is for the first minute of your first match, not for
  // every match forever. It fades itself out rather than becoming furniture.
  const help = document.getElementById("helpBadge");
  if (help) {
    help.style.opacity = "1";
    clearTimeout(helpTimer);
    helpTimer = setTimeout(() => { help.style.opacity = "0"; }, 12_000);
  }
  // Free skins are assigned per slot so players are visually distinct before
  // anybody has bought anything.
  selfCharacter = new Character(SKINS[id % 2].id, name, models);
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
  hud.setKills(0, scoreTarget);
  conn.disconnect();
  controls.reset();
  clearTimeout(helpTimer);
  respawnAtMs = 0;
  openMenu("play");
  statusEl.className = "status error";
  statusEl.textContent = reason;
  playBtn.disabled = false;
  joinBtn.disabled = false;
  document.exitPointerLock();

  refreshStandings();
  for (const c of characters.values()) c.dispose(view.scene);
  characters.clear();
  if (selfCharacter) { selfCharacter.dispose(view.scene); selfCharacter = null; }
}

app.addEventListener("click", () => {
  if (document.body.classList.contains("touch")) return;
  if (playing && !menuOpen && !controls.isLocked) controls.requestLock();
});

// Mute lives outside Controls because that only listens while pointer-locked,
// and muting is exactly what you want to do when you have just tabbed away.
window.addEventListener("keydown", (e) => {
  if (e.code !== "KeyM" || e.repeat) return;
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
          // Only your own shots kick your own camera.
          if (e.shooter === conn.selfId) {
            viewfx.fire(e.weapon);
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
        const audible = TILE * 3;
        if (dist < audible) viewfx.bump(0.22 * (1 - dist / audible));
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
        if (e.killer === conn.selfId) {
          const me = matchPlayers.find((p) => p.id === conn.selfId);
          if (me) {
            me.kills++;
            hud.setKills(me.kills, scoreTarget);
          }
        }
        break;
      }
      case EV_FOLIAGE:
        strippedTrees.set(e.index, performance.now() + FOLIAGE_REGROW_MS);
        refreshTreeAlpha(e.index);
        break;
      case EV_CRITTER: {
        // Mirror the server's downed set, then put a burst where it was. The
        // position comes from the shared path function rather than the event,
        // which is the whole reason the event is four bytes.
        const where = critters.positionOf(e.index, conn.renderTime() / 1000);
        critters.state.down(e.index, Date.now() / 1000);
        if (where) {
          effects.breakBurst(where.x, where.y, where.z);
          sound.destroy(where.x, where.y, where.z);
        }
        if (e.shooter === conn.selfId) {
          hud.showHeal(e.heal);
          sound.hitmarker(false);
        }
        break;
      }
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
  const reach = 2.2;
  for (let i = 0; i < SCENERY.length; i++) {
    const p = SCENERY[i];
    if (p.kind !== "tree") continue;
    if (Math.abs(p.x - x) > reach || Math.abs(p.z - z) > reach) continue;
    // Fade foliage only when the camera is actually inside the canopy.
    if (y < p.y + p.size * .45 || y > p.y + p.size * 1.7) continue;
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
// Camera
// ---------------------------------------------------------------------------

let cameraDistance=0;
function updateCamera(aiming: boolean, dt: number, sprinting = false): void {
  const weapon=weaponById(ARENA_LOADOUT[controls.slot]??0);
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
    viewfx.rollOffset,
  );
  viewfx.applyShake(view.camera);
  const sprintZoom = sprinting && !aiming ? 7 : 0;
  const fov=(aiming&&!controls.inBuildMode?78/weapon.adsZoom:78)+sprintZoom+viewfx.fovOffset;
  view.setFov(view.camera.fov+(fov-view.camera.fov)*(1-Math.exp(-18*dt)));
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

let lastFrame = performance.now();
let fps = 60;
let prevGrounded = false;
let prevSliding = false;
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
    const orbit = now * 0.000012;
    view.camera.position.set(Math.sin(orbit) * 100, 62, Math.cos(orbit) * 100);
    view.camera.lookAt(0, 10, 0);
    pieces.sync(conn.world, Date.now() / 1000);
    pieces.updateVisibility(view.camera.position.x, view.camera.position.z);
    critters.update(Date.now() / 1000, Date.now() / 1000);
    view.render();
    return;
  }

  const nowSec = Date.now() / 1000;
  const self = conn.self;
  // Touch play never takes the pointer lock, so gating aim on it would make
  // aiming impossible on a phone.
  const canAct = !menuOpen && (controls.isLocked || document.body.classList.contains("touch"));
  const aiming = canAct && !controls.inBuildMode && controls.aiming;

  const distance=Math.hypot(self.x-renderSelf.x,self.y-renderSelf.y,self.z-renderSelf.z);
  const blend=1-Math.exp(-24*dt);
  if(!renderReady || distance>3) { Object.assign(renderSelf,{x:self.x,y:self.y,z:self.z});renderReady=true; }
  else {
    renderSelf.x+=(self.x-renderSelf.x)*blend;
    renderSelf.z+=(self.z-renderSelf.z)*blend;
    // Height is smoothed on exactly the same curve as the other two axes.
    //
    // It used to be assigned outright while grounded, and that is the hill
    // judder: the simulation advances at a fixed 30 Hz while this runs at the
    // display rate, so walking a slope held y still for three or four frames
    // and then jumped it 20-40 cm, over and over, while x and z slid along
    // smoothly underneath. The body (and the camera on it) visibly stair-
    // stepped up and down the whole way. Flat ground hid it completely,
    // because there y never changed.
    //
    // A real fall still snaps: past this threshold the tick moved the feet
    // further than any slope at any speed the game allows could, so it is a
    // drop or a mantle rather than ground, and smoothing it would leave the
    // body floating behind the landing.
    const dy = self.y - renderSelf.y;
    renderSelf.y += Math.abs(dy) > 0.7 ? dy : dy * blend;
  }
  updateCamera(aiming, dt, self.sprinting);
  viewfx.update(dt);
  sound.setListener(self.x, self.y + eyeHeightFor(self.crouch), self.z, controls.yaw);
  pieces.sync(conn.world, nowSec);
  pieces.updateVisibility(self.x, self.z);
  const direction=view.camera.getWorldDirection(new THREE.Vector3());
  const aimRange=weaponById(ARENA_LOADOUT[controls.slot]??0).range;
  const targetPiece=conn.world.raycast(view.camera.position.x,view.camera.position.y,view.camera.position.z,direction.x,direction.y,direction.z,aimRange,nowSec);
  hud.setStructure(targetPiece&&targetPiece.t<=TILE*3?targetPiece.piece:null,nowSec);
  hud.setLocation(locationAt(self.x, self.z));
  const aimPoint=view.camera.position.clone().addScaledVector(direction,targetPiece?.t??aimRange);
  effects.update(dt);
  // Wildlife is drawn at the same past instant remote players are, because the
  // server validates shots against it at that instant too. Drawing it at "now"
  // would put every bird half a round trip ahead of the one you can hit.
  critters.update(conn.renderTime() / 1000, nowSec);

  // --- build ghost ---
  if (controls.inBuildMode && self.alive) {
    const target = resolvePlacement({
      x: self.x, y: self.y, z: self.z, yaw: controls.yaw, pitch: controls.pitch, buildSlot: controls.slot,
    }, conn.world);
    if (target) {
      const issue=placementIssue(self,target,conn.world);
      const unavailable = controls.slot === BUILD_SHIELD ? (self.shieldUsed ? 'Shield already used this round' : '') : (self.mats < MATERIALS[self.material].cost ? 'Not enough materials' : '');
      ghost.show(target, issue !== null || !!unavailable);
      hud.setBuildReason(issue ?? unavailable);
    } else {
      ghost.hide();
      hud.setBuildReason('Out of reach');
    }
  } else {
    ghost.hide();
    hud.setBuildReason('');
  }

  // --- local jump, landing and slide, from state transitions ---
  if (self.alive) {
    if (!prevGrounded && self.grounded) {
      sound.land(self.x, self.y, self.z, Math.abs(prevVy));
      viewfx.land(Math.abs(prevVy));
    } else if (prevGrounded && !self.grounded && self.vy > 2) {
      sound.jump(self.x, self.y, self.z);
    }
    if (self.sliding && !prevSliding) sound.slide(self.x, self.y, self.z);
    // Sliding is not walking: the feet are not doing anything, so the footstep
    // loop has to stop or a slide sounds like a very fast jog.
    footsteps(-1, self.x, self.y, self.z,
      self.grounded && !self.sliding && Math.hypot(self.vx, self.vz) > 1);
  }
  viewfx.setSliding(self.alive && self.sliding, controls.strafe);
  prevSliding = self.sliding;
  prevGrounded = self.grounded;
  prevVy = self.vy;

  // --- local body ---
  if (selfCharacter) {
    // Hide only our local model when the camera enters its silhouette. Other
    // players still see the full character, including while we use the scope.
    selfCharacter.root.visible = view.camera.position.distanceTo(new THREE.Vector3(renderSelf.x,renderSelf.y+EYE_HEIGHT,renderSelf.z))>.85;
    selfCharacter.setWeapon(controls.inBuildMode?255:ARENA_LOADOUT[controls.slot]);
    const aiming = controls.aiming && !controls.inBuildMode;
    // Direction of travel in the player's own frame, so the animation picks
    // the backwards and strafing takes when they apply. Read off the velocity
    // rather than the keys: being shoved down a ramp or carried by a slide is
    // travel too, and the legs should agree with where the body is going.
    const localSpeed = Math.hypot(self.vx, self.vz);
    const sinYaw = Math.sin(controls.yaw), cosYaw = Math.cos(controls.yaw);
    const localForward = localSpeed > 0.1 ? (-self.vx * sinYaw + self.vz * cosYaw) / localSpeed : 1;
    const localStrafe = localSpeed > 0.1 ? (-self.vx * cosYaw - self.vz * sinYaw) / localSpeed : 0;
    selfCharacter.update(
      renderSelf.x, renderSelf.y, renderSelf.z,
      controls.yaw, controls.pitch,
      localSpeed, self.grounded, dt,
      self.crouch,
      self.sliding,
      aiming,
      self.mantling,
      self.vaulting,
      localForward,
      localStrafe,
      self.alive,
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
      ch = new Character(SKINS[pose.id % 2].id, nameOf(pose.id), models);
      view.scene.add(ch.root);
      characters.set(pose.id, ch);
    }
    const alive = (pose.state.flags & PF_ALIVE) !== 0;
    // A dead player stays on screen and plays the knocked-out clip until they
    // respawn, rather than blinking out of existence the instant they drop.
    ch.root.visible = true;
    ch.setWeapon(pose.state.weapon);
    ch.setNameplate(nameOf(pose.id));
    // Remote speed is not transmitted; derive it from the flag the server sets
    // so the walk cycle still plays.
    const moving = (pose.state.flags & 32) !== 0;
    const grounded = (pose.state.flags & PF_GROUNDED) !== 0;
    const sliding = (pose.state.flags & PF_SLIDING) !== 0;
    const aiming = (pose.state.flags & PF_AIMING) !== 0;
    ch.update(
      pose.x, pose.y, pose.z, pose.yaw, pose.pitch,
      moving ? 6 : 0, grounded, dt,
      (pose.state.flags & PF_CROUCH) !== 0 ? 1 : 0,
      sliding,
      aiming,
      false,
      false,
      1,
      0,
      alive,
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
  const onShield = controls.slot === BUILD_SHIELD;
  hud.setAmmo(weaponIdx, self.ammo, self.reloadMs > 0, controls.inBuildMode, self.mats,
    onShield, self.shieldUsed);
  hud.setShieldSpent(self.shieldUsed);
  hud.updateCompass(self.x, self.z, controls.yaw);
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
    if (menuOpen) controls.reset();
    if(conn.canAcceptInput) conn.pushInput(controls.sample());
    tickAccumulator -= TICK_DT;
    steps++;
  }
  if (tickAccumulator > TICK_DT * 6) tickAccumulator = 0;
}, 1000 / TICK_HZ);

// Dev-only handle, so the running game can be inspected and driven from the
// console -- and by a browser-automation harness, which cannot take the
// pointer lock that keyboard input is gated behind. Stripped from production
// builds by the `import.meta.env.DEV` constant.
if (import.meta.env.DEV) {
  (globalThis as unknown as Record<string, unknown>).clutch = { conn, controls, view, renderSelf };
}

requestAnimationFrame(frame);

refreshStandings();
document.getElementById("loading")!.remove();

const volume=document.getElementById("volume") as HTMLInputElement;
volume.value=localStorage.getItem("clutch.volume")??"0.6";
sound.setVolume(Number(volume.value));
volume.addEventListener("input",()=>{ sound.setVolume(Number(volume.value)); localStorage.setItem("clutch.volume", volume.value); });
