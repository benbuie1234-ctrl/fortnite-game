import { currentHp, type Piece } from "@shared/build";
import { ARENA_OWNER } from "@shared/arena";
import { PLAYER_MAX_HP, PLAYER_MAX_SHIELD, MATERIALS } from "@shared/constants";
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
      (this.slotNodes.length < 5 ? this.slotsEl : el("buildSlots")).appendChild(node);
      this.slotNodes.push(node);
    }
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
  setReticle(aiming:boolean,slot:number,building:boolean):void {
    const size=building?18:slot===1?(aiming?32:48):aiming?12:22;
    this.crosshair.style.width=`${size}px`;
    this.crosshair.style.height=`${size}px`;
    this.crosshair.style.margin=`-${size/2}px 0 0 -${size/2}px`;
    this.crosshair.classList.toggle("shotgun",slot===1&&!building);
  }
  show(): void { this.hud.classList.remove("hidden"); }
  hide(): void { this.hud.classList.add("hidden"); }
  setLocation(name: string): void { this.locationBadge.textContent = name; }

  setVitals(hp: number, shield: number): void {
    el("hpValue").textContent = String(Math.ceil(hp));
    el("shieldValue").textContent = String(Math.ceil(shield));
    this.hpFill.style.width = `${Math.max(0, Math.min(100, (hp / PLAYER_MAX_HP) * 100))}%`;
    this.shieldFill.style.width = `${Math.max(0, Math.min(100, (shield / PLAYER_MAX_SHIELD) * 100))}%`;
  }

  setMats(mats: number, material: number): void {
    // One shared pool, shown against whichever material is selected. Keeps the
    // economy simple enough that new players never have to think about it.
    for (let i = 0; i < this.matValues.length; i++) {
      this.matValues[i].textContent = String(Math.floor(mats));
      this.matBoxes[i].classList.toggle("active", i === material);
    }
  }

  setSlot(slot: number, building: boolean): void {
    // Build slots arrive as 5-8 and map onto the second half of the bar.
    const index = building ? slot - 5 + 5 : slot;
    for (let i = 0; i < this.slotNodes.length; i++) {
      this.slotNodes[i].classList.toggle("active", i === index);
    }
    this.crosshair.classList.toggle("build", building);
    if (building) {
      const mat = MATERIALS[0];
      void mat;
      this.buildPreview.textContent = this.buildReason || SLOT_LABELS[index]?.name || '';
    } else {
      this.buildPreview.textContent = "";
    }
  }

  setAmmo(weaponIdx: number, ammo: number, reloading: boolean): void {
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

  setNetStat(ping: number, fps: number, pending: number): void {
    this.netstat.innerHTML =
      `<b>${Math.round(ping)}</b> ms &nbsp; <b>${Math.round(fps)}</b> fps &nbsp; <b>${pending}</b> queued`;
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
