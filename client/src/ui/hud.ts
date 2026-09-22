import { currentHp, type Piece } from "@shared/build";
import { ARENA_OWNER } from "@shared/arena";
import { PLAYER_MAX_HP, PLAYER_MAX_SHIELD, MATERIALS, SPRINT_MIN_TO_START, SPRINT_STAMINA_MAX } from "@shared/constants";
import { ARENA_LOADOUT, weaponById } from "@shared/weapons";
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
  { key: "V", ico: "◈", name: "Shield" },
];

/** Where each entry of SLOT_LABELS sits in the slot field the server reads.
 *  The shield is 12, not 9: 9-11 are the material switches. */
const SLOT_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12];

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
  private centerMsg = el("centerMsg");
  private damageFlash = el("damageFlash");
  private hitmarker = el("hitmarker");
  private netstat = el("netstat");
  private crosshair = el("crosshair");
  private buildPreview = el("buildPreview");
  private locationBadge = el("locationBadge");
  private killTallyCount = el("killTallyCount");
  private killTallyTarget = el("killTallyTarget");
  private matBoxes = [el("matWoodBox"), el("matBrickBox"), el("matMetalBox")];
  private matValues = [el("matWood"), el("matBrick"), el("matMetal")];

  private hitDirs = el("hitDirs");
  private scope = el("scope");
  private staminaBar = el("staminaBar");
  private staminaFill = el("staminaFill");
  /** Tapping a HUD slot selects it. Wired by main so the HUD does not need to
   *  know what a weapon is. */
  onSlotTapped: ((slot: number) => void) | null = null;
  onMaterialTapped: ((material: number) => void) | null = null;
  private compass = el("compass");
  private compassTicks: HTMLElement[] = [];
  private compassPips: HTMLElement[] = [];
  /** World-space gunshots still worth showing, with their expiry. Stored as
   *  positions, not bearings: a bearing goes stale the moment you turn. */
  private gunshots: Array<{ x: number; z: number; until: number }> = [];
  private slotNodes: HTMLElement[] = [];
  /** Kills needed to take a round, for the standings footer. */
  scoreTarget = 0;
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
        this.onSlotTapped?.(SLOT_IDS[index]);
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

  setStructure(piece:Piece|null,now:number):void {
    const box=el("structureHealth");
    box.style.display=piece&&piece.key!==-1?"block":"none";
    if(!piece)return;
    const arena=piece.ownerId===ARENA_OWNER;
    const hp=arena?1:Math.max(0,currentHp(piece,now));
    el("structureLabel").textContent=arena?(piece.key<0?'SCENERY · SOLID COVER':'MAP STRUCTURE · INDESTRUCTIBLE'):`${MATERIALS[piece.mat].name.toUpperCase()} · ${Math.ceil(hp)} / ${piece.maxHp}`;
    el("structureFill").style.width=`${arena?100:100*hp/piece.maxHp}%`;
  }
  /** A green pop for health gained, so a hit on a bird reads as a reward
   *  rather than as a shot that did nothing. */
  showHeal(amount:number):void {
    const node=document.createElement("div");
    node.className="damage-number heal";
    node.textContent=`+${amount}`;
    this.hud.appendChild(node);
    setTimeout(()=>node.remove(),900);
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
   * A fixed size per weapon class, opened by a fraction of the current bloom.
   *
   * An earlier version scaled the crosshair with the live shot cone in world
   * angle, which at 620 px per radian put an assault rifle at 44 px standing
   * still and near 100 px moving -- a blob that covered the thing you were
   * shooting at. The reticle is a readout here, not a projection: it shows
   * that the cone is open and roughly how much, in a handful of pixels rather
   * than in whatever the trigonometry happens to produce.
   */
  setReticle(aiming:boolean,slot:number,building:boolean,bloom=0):void {
    const open=bloom>0?(bloom<1?bloom:1):0;
    const size=(building?18:slot===1?(aiming?32:48):aiming?12:22)
      +(building?0:(aiming?6:16)*open);
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
  setKills(kills: number, target = this.scoreTarget): void {
    this.killTallyCount.textContent = String(Math.max(0, kills));
    if (target > 0) {
      this.killTallyTarget.textContent = `/ ${target}`;
      this.killTallyTarget.style.display = "";
    } else {
      this.killTallyTarget.style.display = "none";
    }
  }

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
  /** Grey out the shield slot once it has been spent. */
  setShieldSpent(spent: boolean): void {
    this.slotNodes[SLOT_IDS.length - 1]?.classList.toggle("spent", spent);
  }

  setSlot(slot: number, building: boolean, material = 0): void {
    const index = SLOT_IDS.indexOf(slot);
    for (let i = 0; i < this.slotNodes.length; i++) {
      this.slotNodes[i].classList.toggle("active", i === index);
    }
    this.crosshair.classList.toggle("build", building);
    if (!building) { this.buildPreview.textContent = ""; return; }
    const piece = SLOT_LABELS[index]?.name ?? "";
    // The shield is not made of anything, so naming a material for it would be
    // a readout that never matches what gets placed.
    if (slot === SLOT_IDS[SLOT_IDS.length - 1]) {
      this.buildPreview.textContent = this.buildReason || "SHIELD BLOCK";
      return;
    }
    const mat = MATERIALS[material] ?? MATERIALS[0];
    this.buildPreview.textContent = this.buildReason || `${mat.name} ${piece}`.toUpperCase();
  }

  setAmmo(weaponIdx: number, ammo: number, reloading: boolean, building = false, mats = 0,
          shield = false, shieldUsed = false): void {
    if (shield) {
      // The shield is not paid for in materials, so showing the material
      // budget for it would be answering a question nobody asked.
      this.ammoEl.className = shieldUsed ? "reloading" : "";
      this.ammoEl.innerHTML = shieldUsed
        ? "SHIELD USED"
        : '1<small> / match</small>';
      return;
    }
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
      // "in flight", not "queued": this is unacknowledged INPUT, a netcode
      // stat that sits at 1-3 and moves every tick. It was being read as a
      // count of people in the game, which it has never been.
      `<br/><b>${Math.round(ping)}</b> ms ping &nbsp;·&nbsp; <b>${pending}</b> inputs in flight`;
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

/**
 * The standings, as one table.
 *
 * Shared between the in-game overlay and the panel on the menu so the two
 * cannot drift into showing different things. Sorted by wins, then kills, then
 * fewest deaths -- the order that answers "who is winning" rather than "who
 * shot most recently".
 */
export function standingsTable(
  players: MatchPlayerInfo[], selfId: number, target = 0,
): string {
  if (players.length === 0) {
    return '<tr><th>PLAYER</th></tr><tr><td class="empty">Nobody here yet</td></tr>';
  }
  // The win condition used to live in the score strip across the top of the
  // playfield. With that gone it has to be somewhere, and the table that says
  // how many kills everyone has is the obvious place to say how many win.
  const goal = target > 0 ? `<td class="num goal" colspan="5">First to ${target} kills wins the round</td>` : "";
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
  return `<tr><th>PLAYER (${players.length} ONLINE)</th><th class="num">WINS</th>` +
    `<th class="num">KILLS</th><th class="num">DEATHS</th><th class="num">PING</th></tr>` +
    `${rows}${goal ? `<tr class="goal">${goal}</tr>` : ""}`;
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
