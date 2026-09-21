import {
  BTN_JUMP, BTN_FIRE, BTN_AIM, BTN_CROUCH, BTN_RELOAD, BTN_EDIT, BTN_RESET,
  type InputCommand,
} from "@shared/sim";
import { quantizeYaw, quantizePitch } from "@shared/protocol";

const PITCH_LIMIT = Math.PI / 2 - 0.02;

/** Build slots, matching the server's `slot` field encoding. */
const SLOT_WALL = 5;
const SLOT_FLOOR = 6;
const SLOT_RAMP = 7;
const SLOT_CONE = 8;

export interface ControlsOptions {
  sensitivity: number;
  onPointerLockChange(locked: boolean): void;
}

export class Controls {
  yaw = 0;
  pitch = 0;
  sensitivity: number;

  /** 0-4 weapon, 5-8 build piece. */
  slot = 2;
  material = 0;

  private keys = new Set<string>();
  private mouseDown = false;
  private rightDown = false;
  private locked = false;
  /** One-shot slot values (material switches) that must reach the server
   *  exactly once, without clobbering the held weapon/build selection. */
  private slotOverrides: number[] = [];
  private seq = 0;
  private edgeReload = false;
  private edgeReset = false;

  constructor(
    private canvas: HTMLElement,
    private opts: ControlsOptions,
  ) {
    this.sensitivity = opts.sensitivity;
    this.attach();
  }

  get isLocked(): boolean { return this.locked; }
  get inBuildMode(): boolean { return this.slot >= SLOT_WALL; }
  /** Read-only view for the camera. sample() advances the sequence number, so
   *  callers that only want to observe must not go through it. */
  get aiming(): boolean { return this.rightDown; }
  get firing(): boolean { return this.mouseDown; }

  requestLock(): void {
    // Returns a promise in current browsers, and rejects when the document is
    // not eligible (embedded frames, or a second request too soon after exit).
    const result = this.canvas.requestPointerLock() as unknown;
    if (result instanceof Promise) result.catch(() => { /* stays unlocked */ });
  }

  private attach(): void {
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        // Never leave a key stuck down when focus is lost mid-strafe.
        this.keys.clear();
        this.mouseDown = false;
        this.rightDown = false;
      }
      this.opts.onPointerLockChange(this.locked);
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
      // Keep yaw in range so quantisation stays lossless across long sessions.
      if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
      if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    });

    document.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      e.preventDefault();
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.rightDown = true;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightDown = false;
    });
    document.addEventListener("contextmenu", (e) => {
      if (this.locked) e.preventDefault();
    });

    document.addEventListener("keydown", (e) => {
      if (!this.locked) return;
      // Stop the browser scrolling or quick-finding under the game.
      if (["Space", "Tab", "Slash", "Quote"].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.handleSelection(e.code);
    });
    document.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener("blur", () => {
      this.keys.clear();
      this.mouseDown = false;
      this.rightDown = false;
    });
  }

  private handleSelection(code: string): void {
    switch (code) {
      case "Digit1": this.slot = 0; break;
      case "Digit2": this.slot = 1; break;
      case "Digit3": this.slot = 2; break;
      case "Digit4": this.slot = 3; break;
      case "Digit5": this.slot = 4; break;
      case "KeyQ": this.slot = SLOT_WALL; break;
      case "KeyE": this.slot = SLOT_FLOOR; break;
      case "KeyR": this.slot = SLOT_RAMP; break;
      case "KeyF": this.slot = SLOT_CONE; break;
      case "KeyZ": this.selectMaterial(0); break;
      case "KeyX": this.selectMaterial(1); break;
      case "KeyC": this.selectMaterial(2); break;
      case "KeyG": this.edgeReload = true; break;
      default: break;
    }
  }

  private selectMaterial(mat: number): void {
    if (this.material === mat) return;
    this.material = mat;
    // 9-11 tell the server to change material without changing the held slot.
    this.slotOverrides.push(9 + mat);
  }

  /**
   * Sample the current state into one command. Angles are quantised here, not
   * at send time, so local prediction runs on exactly the values the server
   * will decode — otherwise every shot would drift by a fraction of a degree.
   */
  sample(): InputCommand {
    let buttons = 0;
    if (this.keys.has("Space")) buttons |= BTN_JUMP;
    if (this.mouseDown) buttons |= BTN_FIRE;
    if (this.rightDown) buttons |= BTN_AIM;
    if (this.keys.has("ControlLeft") || this.keys.has("KeyV")) buttons |= BTN_CROUCH;
    if (this.edgeReload) { buttons |= BTN_RELOAD; this.edgeReload = false; }
    if (this.keys.has("KeyT")) buttons |= BTN_EDIT;
    if (this.edgeReset) { buttons |= BTN_RESET; this.edgeReset = false; }

    let moveX = 0;
    let moveZ = 0;
    if (this.keys.has("KeyW")) moveZ += 1;
    if (this.keys.has("KeyS")) moveZ -= 1;
    if (this.keys.has("KeyD")) moveX += 1;
    if (this.keys.has("KeyA")) moveX -= 1;

    const slot = this.slotOverrides.length > 0
      ? this.slotOverrides.shift()!
      : this.slot;

    this.seq = (this.seq + 1) & 0xffff;

    return {
      seq: this.seq,
      moveX, moveZ,
      yaw: quantizeYaw(this.yaw),
      pitch: quantizePitch(this.pitch),
      buttons,
      slot,
    };
  }
}
