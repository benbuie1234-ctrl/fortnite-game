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
  private matBoxes = [el("matWoodBox"), el("matBrickBox"), el("matMetalBox")];
  private matValues = [el("matWood"), el("matBrick"), el("matMetal")];

  private slotNodes: HTMLElement[] = [];
  private flashUntil = 0;
  private hitUntil = 0;

  constructor() {
    for (const s of SLOT_LABELS) {
      const node = document.createElement("div");
      node.className = "slot";
      node.innerHTML = `<div class="ico">${s.ico}</div><div>${s.name}</div><div class="k">${s.key}</div>`;
      this.slotsEl.appendChild(node);
      this.slotNodes.push(node);
    }
  }

  show(): void { this.hud.classList.remove("hidden"); }
  hide(): void { this.hud.classList.add("hidden"); }

  setVitals(hp: number, shield: number): void {
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
      this.buildPreview.textContent = SLOT_LABELS[index]?.name ?? "";
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
    node.innerHTML = involvesMe ? `<span class="me">${text}</span>` : text;
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
