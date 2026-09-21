import { currentHp, type Piece } from "@shared/build";
import { ARENA_OWNER } from "@shared/arena";
import { PLAYER_MAX_HP, PLAYER_MAX_SHIELD, MATERIALS, SPRINT_MIN_TO_START, SPRINT_STAMINA_MAX } from "@shared/constants";
import { ARENA_LOADOUT, weaponById, spreadFor } from "@shared/weapons";
import type { MatchPlayerInfo } from "../net/connection";

const SLOT_LABELS = [
  { key: "1", ico: "⛏", name: "Pick" },
  { key: "2", ico: "✦", name: "Pump" },
  { key: "3", ico: "✈", name: "AR" },
  { key: "4", ico: "▸", name: "SMG" },
  { key: "5", ico: "⌖", name: "Sniper" },
  { key: "Q", ico: "▤", name: "Wall" },
  { key: "E", ico: "▭", name: "Floor" },
  { key: "R", ico: "◢", name: "Ramp" },
  { key: "F", ico: "▲", name: "Cone" },
];

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing HUD element #${id}`);
  return node as T;
}

export class Hud {
  private hud = el("hud");
  private hpFill = el("hpFill");
  private shieldFill = el("shieldFill");
  private ammoEl = el("ammo");
  private slotsEl = el("slots");
  private killfeedEl = el("killfeed");
  private scoreEl = el("score");
  private centerMsg = el("centerMsg");
  private damageFlash = el("damageFlash");
  private hitmarker = el("hitmarker");
  private netstat = el("netstat");
  private crosshair = el("crosshair");
  private buildPreview = el("buildPreview");
  private locationBadge = el("locationBadge");
  private matBoxes = [el("matWoodBox"), el("matBrickBox"), el("matMetalBox")];
  private matValues = [el("matWood"), el("matBrick"), el("matMetal")];

  private hitDirs = el("hitDirs");
  private scope = el("scope");
  private staminaBar = el("staminaBar");
  private staminaFill = el("staminaFill");
  private aimbotBadge = el("aimbotBadge");
  /** Tapping a HUD slot selects it. Wired by main so the HUD does not need to
   *  know what a weapon is. */
  onSlotTapped: ((slot: number) => void) | null = null;
  onMaterialTapped: ((material: number) => void) | null = null;
  private compass = el("compass");
  private scoreboard = el("scoreboard");
  private compassTicks: HTMLElement[] = [];
  private compassPips: HTMLElement[] = [];
  /** World-space gunshots still worth showing, with their expiry. Stored as
   *  positions, not bearings: a bearing goes stale the moment you turn. */
  private gunshots: Array<{ x: number; z: number; until: number }> = [];
  private slotNodes: HTMLElement[] = [];
  private buildReason='';
  setBuildReason(reason:string):void {this.buildReason=reason;}
  private flashUntil = 0;
  private hitUntil = 0;

  constructor() {
    for (const s of SLOT_LABELS) {
      const node = document.createElement("div");
      node.className = "slot";
      node.innerHTML = `<div class="ico">${slotIcon(this.slotNodes.length, s.ico)}</div><div>${s.name}</div><div class="k">${s.key}</div>`;
      const index = this.slotNodes.length;
      node.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.onSlotTapped?.(index);
      });
      (index < 5 ? this.slotsEl : el("buildSlots")).appendChild(node);
      this.slotNodes.push(node);
    }
    this.matBoxes.forEach((box, material) => {
      box.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.onMaterialTapped?.(material);
      });
    });
    this.buildCompass();
  }

  // -------------------------------------------------------------------------
  // Compass
  // -------------------------------------------------------------------------

  private buildCompass(): void {
    for (let i = 0; i < 16; i++) {
      const tick = document.createElement("div");
      const cardinal = i % 4 === 0;
      tick.className = cardinal ? "tick cardinal" : "tick";
      tick.textContent = COMPASS_LABELS[i];
      this.compass.appendChild(tick);
      this.compassTicks.push(tick);
    }
    // A fixed pool. Allocating a node per gunshot would churn the DOM during a
    // firefight, which is the exact moment the compass has to stay smooth.
    for (let i = 0; i < 8; i++) {
      const pip = document.createElement("div");
      pip.className = "pip";
      pip.style.display = "none";
      this.compass.appendChild(pip);
      this.compassPips.push(pip);
    }
  }

  /** Note a gunshot so the compass can point at it for a moment. */
  addGunshot(x: number, z: number): void {
    this.gunshots.push({ x, z, until: performance.now() + GUNSHOT_LIFETIME_MS });
    if (this.gunshots.length > this.compassPips.length) this.gunshots.shift();
  }

  /**
   * Reposition the tape and the gunshot pips for the current view.
   *
   * Everything is placed by screen-relative bearing, so a cardinal label and a
   * gunshot pip are positioned by exactly the same maths and cannot disagree.
   */
  updateCompass(px: number, pz: number, yaw: number): void {
    for (let i = 0; i < this.compassTicks.length; i++) {
      const heading = (i / this.compassTicks.length) * Math.PI * 2;
      const place = bearingToX(Math.sin(heading), -Math.cos(heading), yaw);
      const tick = this.compassTicks[i];
      if (place === null) { tick.style.display = "none"; continue; }
      tick.style.display = "block";
      tick.style.left = `${place.x}px`;
      tick.style.opacity = String(place.edge ? 0.35 : 1);
    }

    const now = performance.now();
    this.gunshots = this.gunshots.filter((g) => g.until > now);
    for (let i = 0; i < this.compassPips.length; i++) {
      const pip = this.compassPips[i];
      const shot = this.gunshots[i];
      if (!shot) { pip.style.display = "none"; continue; }
      const dx = shot.x - px, dz = shot.z - pz;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) { pip.style.display = "none"; continue; }
      const place = bearingToX(dx / len, dz / len, yaw, true);
      if (place === null) { pip.style.display = "none"; continue; }
      pip.style.display = "block";
      pip.style.left = `${place.x}px`;
      pip.classList.toggle("edge", place.edge);
      // Fade out over the pip's life so a stale shot does not read as a live one.
      pip.style.opacity = String(Math.max(0, (shot.until - now) / GUNSHOT_LIFETIME_MS));
    }
  }

  // -------------------------------------------------------------------------
  // Directional damage
  // -------------------------------------------------------------------------

  /**
   * Flash a red wedge toward whoever just hit you.
   *
   * `bearing` is in radians, 0 straight ahead and positive to the right.
   */
  addDamageDirection(bearing: number): void {
    const node = document.createElement("div");
    node.className = "hitdir";
    node.style.transform = `rotate(${bearing * (180 / Math.PI)}deg)`;
    this.hitDirs.appendChild(node);
    setTimeout(() => node.remove(), 1200);
  }

  // -------------------------------------------------------------------------
  // Scoreboard
  // -------------------------------------------------------------------------

  setScoreboardOpen(open: boolean): void {
    this.scoreboard.classList.toggle("open", open);
  }

  setScoreboard(players: MatchPlayerInfo[], selfId: number): void {
    if (!this.scoreboard.classList.contains("open")) return;
    const sorted = [...players].sort(
      (a, b) => (b.wins ?? 0) - (a.wins ?? 0) || b.kills - a.kills || a.deaths - b.deaths,
    );
    const rows = sorted.map((p) => {
      const me = p.id === selfId ? ' class="me"' : "";
      return `<tr${me}><td>${escapeHtml(p.name)}</td>` +
        `<td class="num">${p.wins ?? 0}</td>` +
        `<td class="num">${p.kills}</td>` +
        `<td class="num">${p.deaths}</td>` +
        `<td class="num">${p.ping ?? 0} ms</td></tr>`;
    }).join("");
    el("scoreTable").innerHTML =
      `<tr><th>PLAYER (${players.length} ONLINE)</th><th class="num">WINS</th>` +
      `<th class="num">KILLS</th><th class="num">DEATHS</th><th class="num">PING</th></tr>${rows}`;
  }

  setStructure(piece:Piece|null,now:number):void {
    const box=el("structureHealth");
    box.style.display=piece&&piece.key!==-1?"block":"none";
    if(!piece)return;
    const arena=piece.ownerId===ARENA_OWNER;
    const hp=arena?1:Math.max(0,currentHp(piece,now));
    el("structureLabel").textContent=arena?(piece.key<0?'SCENERY · SOLID COVER':'MAP STRUCTURE · INDESTRUCTIBLE'):`${MATERIALS[piece.mat].name.toUpperCase()} · ${Math.ceil(hp)} / ${piece.maxHp}`;
    el("structureFill").style.width=`${arena?100:100*hp/piece.maxHp}%`;
  }
  showDamage(amount:number, headshot:boolean):void {
    const node=document.createElement("div");
    node.className="damage-number";
    node.textContent=String(amount);
    node.style.color=headshot?"#ffe36b":"#bceeff";
    this.hud.appendChild(node);
    setTimeout(()=>node.remove(),700);
  }
  /**
   * Size the crosshair to the shot cone the server would actually fire.
   *
   * Derived from the same spreadFor() the shot uses, so the crosshair is a
   * readout of the weapon's real accuracy rather than a decoration that
   * happens to be near it: it opens as you move, tightens as you slow, and is
   * at its smallest standing still.
   */
  setReticle(aiming:boolean,slot:number,building:boolean,bloom=0):void {
    const weapon=weaponById(ARENA_LOADOUT[slot]??0);
    const cone=spreadFor(weapon,aiming,bloom);
    const base=building?18:slot===1?(aiming?32:48):aiming?12:22;
    const size=building?base:Math.round(base+cone*RETICLE_PIXELS_PER_RADIAN);
    this.crosshair.style.width=`${size}px`;
    this.crosshair.style.height=`${size}px`;
    this.crosshair.style.margin=`-${size/2}px 0 0 -${size/2}px`;
    this.crosshair.classList.toggle("shotgun",slot===1&&!building);
  }
  /** The scope replaces the whole view, so the ordinary crosshair goes away
   *  with it -- two reticles at once is worse than either. */
  setScope(on: boolean): void {
    this.scope.classList.toggle("on", on);
    this.hud.classList.toggle("scoped", on);
    this.crosshair.style.display = on ? "none" : "";
  }

  setAimbot(on: boolean): void {
    this.aimbotBadge.classList.toggle("on", on);
    if (!on) this.aimbotBadge.textContent = "AIM LOCK";
  }

  /** Whether the lock currently has a clear shot, so the badge says which.
   *  "SEARCHING" is the honest answer on an empty server, which otherwise
   *  looks identical to the toggle not having worked. */
  setAimbotLocked(locked: boolean, hasTarget = true): void {
    this.aimbotBadge.textContent = !hasTarget
      ? "AIM LOCK · SEARCHING"
      : locked ? "AIM LOCK · LOCKED" : "AIM LOCK · NO SHOT";
  }

  /** Sprint stamina. Turns warm once it is too low to start a sprint with, so
   *  the bar answers "can I run?" rather than only "how much is left?". */
  setStamina(seconds: number): void {
    const frac = Math.max(0, Math.min(1, seconds / SPRINT_STAMINA_MAX));
    this.staminaFill.style.width = `${frac * 100}%`;
    this.staminaBar.classList.toggle("spent", seconds < SPRINT_MIN_TO_START);
  }

  show(): void { this.hud.classList.remove("hidden"); }
  hide(): void { this.hud.classList.add("hidden"); }
  setLocation(name: string): void { this.locationBadge.textContent = name; }

  /**
   * Draw health and shield as one pool on one scale.
   *
   * They used to be two independent bars, each normalised to its own maximum.
   * Because shield absorbs damage first, a 33-damage hit on a full shield
   * moved the shield bar by a third of its width and the health bar not at
   * all -- so neither bar was a measure of how much damage you had taken. On a
   * shared scale the pool always shortens by exactly what you were hit for.
   */
  setVitals(hp: number, shield: number): void {
    el("hpValue").textContent = String(Math.ceil(Math.max(0, hp)));
    el("shieldValue").textContent = String(Math.ceil(Math.max(0, shield)));
    const pool = PLAYER_MAX_HP + PLAYER_MAX_SHIELD;
    const pct = (v: number) => `${Math.max(0, Math.min(100, (v / pool) * 100))}%`;
    this.hpFill.style.width = pct(hp);
    this.shieldFill.style.width = pct(shield);
  }

  setMats(mats: number, material: number): void {
    // One shared pool, shown against whichever material is selected. Keeps the
    // economy simple enough that new players never have to think about it.
    for (let i = 0; i < this.matValues.length; i++) {
      this.matValues[i].textContent = String(Math.floor(mats));
      this.matBoxes[i].classList.toggle("active", i === material);
    }
  }

  /**
   * Highlight the held slot, and say what is actually selected.
   *
   * The build half of the bar carries slots 5-8 and the weapon half carries
   * 0-4, so the slot number IS the index -- the old `slot - 5 + 5` said the
   * same thing the long way round, which made it look as though the two halves
   * were indexed differently and hid the fact that the build readout showed
   * only the piece and never the material it would be made of.
   */
  setSlot(slot: number, building: boolean, material = 0): void {
    for (let i = 0; i < this.slotNodes.length; i++) {
      this.slotNodes[i].classList.toggle("active", i === slot);
    }
    this.crosshair.classList.toggle("build", building);
    if (!building) { this.buildPreview.textContent = ""; return; }
    const piece = SLOT_LABELS[slot]?.name ?? "";
    const mat = MATERIALS[material] ?? MATERIALS[0];
    this.buildPreview.textContent = this.buildReason || `${mat.name} ${piece}`.toUpperCase();
  }

  setAmmo(weaponIdx: number, ammo: number, reloading: boolean, building = false, mats = 0): void {
    if (building) {
      // Build mode used to fall through to the weapon readout with a forced
      // index of 0, so it showed the pickaxe's ammo -- a number that has
      // nothing to do with building and never changes. The material budget is
      // the thing that actually limits you.
      this.ammoEl.className = "";
      const mat = MATERIALS[0];
      this.ammoEl.innerHTML = `${Math.floor(mats)}<small> / ${mat.cost} per piece</small>`;
      return;
    }
    if (reloading) {
      this.ammoEl.className = "reloading";
      this.ammoEl.textContent = "RELOADING";
      return;
    }
    this.ammoEl.className = "";
    const weapon = weaponById(ARENA_LOADOUT[weaponIdx] ?? 0);
    if (!Number.isFinite(weapon.magSize)) {
      this.ammoEl.innerHTML = "";
      return;
    }
    this.ammoEl.innerHTML = `${Math.max(0, ammo)}<small> / ${weapon.magSize}</small>`;
  }

  setScore(players: MatchPlayerInfo[], selfId: number, target: number): void {
    if (players.length === 0) { this.scoreEl.innerHTML = ""; return; }
    const sorted = [...players].sort((a, b) => b.kills - a.kills);
    this.scoreEl.innerHTML = sorted
      .map((p) => {
        const me = p.id === selfId ? ' style="color:var(--accent)"' : "";
        return `<div class="p"${me}><span>${escapeHtml(p.name)}</span><b>${p.kills}</b></div>`;
      })
      .join('<span class="sep">·</span>') + `<span class="sep">first to ${target}</span>`;
  }

  addKillFeed(text: string, involvesMe: boolean): void {
    const node = document.createElement("div");
    node.className = "kf";
    node.innerHTML = involvesMe ? `<span class="me">${escapeHtml(text)}</span>` : escapeHtml(text);
    this.killfeedEl.appendChild(node);
    // Cap the feed and expire entries so it never grows without bound.
    while (this.killfeedEl.children.length > 5) {
      this.killfeedEl.removeChild(this.killfeedEl.firstChild!);
    }
    setTimeout(() => node.remove(), 6000);
  }

  setCenterMessage(main: string, sub = ""): void {
    this.centerMsg.innerHTML = main
      ? `${escapeHtml(main)}${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ""}`
      : "";
  }

  flashDamage(): void {
    this.flashUntil = performance.now() + 220;
    this.damageFlash.style.opacity = "1";
  }

  showHitmarker(headshot: boolean): void {
    this.hitUntil = performance.now() + 140;
    this.hitmarker.style.opacity = "1";
    (this.hitmarker.firstElementChild as SVGElement | null)
      ?.setAttribute("stroke", headshot ? "#ff5a5a" : "#ffffff");
  }

  setNetStat(ping: number, fps: number, pending: number, fpsCap = 0): void {
    const rounded = Math.round(fps);
    // Colour the frame rate so a problem is obvious at a glance rather than
    // needing to be read. Judged against the cap when there is one, because a
    // capped 60 is perfect, not a shortfall.
    const target = fpsCap > 0 ? fpsCap : 60;
    const colour = rounded >= target - 5 ? "#8ee87a"
      : rounded >= target * 0.6 ? "#ffc53d"
      : "#ff6b6b";
    // Frame time matters more than frame rate for judging stutter: 16.7ms is
    // smooth, and a spike shows up there before the averaged fps moves.
    const frameMs = fps > 0 ? (1000 / fps).toFixed(1) : "--";
    const capNote = fpsCap > 0 ? ` <span style="opacity:.55">cap ${fpsCap}</span>` : "";

    this.netstat.innerHTML =
      `<b style="color:${colour};font-size:14px">${rounded}</b> fps${capNote}` +
      ` &nbsp;·&nbsp; <b>${frameMs}</b> ms/frame` +
      `<br/><b>${Math.round(ping)}</b> ms ping &nbsp;·&nbsp; <b>${pending}</b> queued`;
  }

  /** Call once per frame to expire the transient overlays. */
  tick(): void {
    const now = performance.now();
    if (this.flashUntil && now > this.flashUntil) {
      this.damageFlash.style.opacity = "0";
      this.flashUntil = 0;
    }
    if (this.hitUntil && now > this.hitUntil) {
      this.hitmarker.style.opacity = "0";
      this.hitUntil = 0;
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slotIcon(i: number, fallback: string): string {
  const paths = ["M8 26L23 8M8 8Q22 0 33 14L25 11L21 15", "M4 12H34V17H17L13 24H7L10 17H4Z", "M3 12H34V16H23L20 23H15L16 17H11L8 21H3ZM18 8H26V12", "M7 11H29V17H21V25H16V17H12L9 23H5Z", "M2 13H38V16H18L14 23H8L10 16H2ZM19 8H29V11H19Z"];
  return i < 5 ? `<svg viewBox="0 0 40 30" fill="currentColor" stroke="currentColor" stroke-width="1.5"><path d="${paths[i]}"/></svg>` : fallback;
}


/** 16-point compass rose, clockwise from north. North is -Z. */
const COMPASS_LABELS = [
  "N", "\u00b7", "NE", "\u00b7", "E", "\u00b7", "SE", "\u00b7",
  "S", "\u00b7", "SW", "\u00b7", "W", "\u00b7", "NW", "\u00b7",
];

/** Half-width of the compass strip, and the arc it covers. */
const COMPASS_HALF_PX = 180;
const COMPASS_HALF_DEG = 100;
const GUNSHOT_LIFETIME_MS = 4000;
/** How aggressively the crosshair opens with the shot cone. */
const RETICLE_PIXELS_PER_RADIAN = 620;

/**
 * Where a world direction lands on the compass strip.
 *
 * Returns null when it is behind you and `clamp` is off; with `clamp` on it
 * sticks to the nearer edge and is flagged, so a gunshot from directly behind
 * still tells you which shoulder to turn over.
 */
function bearingToX(
  dx: number, dz: number, yaw: number, clamp = false,
): { x: number; edge: boolean } | null {
  const fx = -Math.sin(yaw), fz = Math.cos(yaw);
  const rx = -Math.cos(yaw), rz = -Math.sin(yaw);
  const along = dx * fx + dz * fz;
  const side = dx * rx + dz * rz;
  const deg = Math.atan2(side, along) * (180 / Math.PI);
  if (Math.abs(deg) > COMPASS_HALF_DEG) {
    if (!clamp) return null;
    return { x: deg > 0 ? COMPASS_HALF_PX * 2 - 6 : 6, edge: true };
  }
  return { x: COMPASS_HALF_PX + deg * (COMPASS_HALF_PX / COMPASS_HALF_DEG), edge: false };
}
