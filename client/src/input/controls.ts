import {
  BTN_JUMP, BTN_FIRE, BTN_AIM, BTN_CROUCH, BTN_SPRINT, BTN_RELOAD, BTN_EDIT, BTN_RESET,
  type InputCommand,
} from "@shared/sim";
import { quantizeYaw, quantizePitch } from "@shared/protocol";
import { BUILD_SHIELD } from "@shared/placement";

const PITCH_LIMIT = Math.PI * 0.44;

/** Build slots, matching the server's `slot` field encoding. Imported for the
 *  shield rather than re-declared, because 12 is a number you would not guess
 *  and getting it wrong here selects a material instead of a piece. */
const SLOT_WALL = 5;
const SLOT_FLOOR = 6;
const SLOT_RAMP = 7;
const SLOT_CONE = 8;
const SLOT_SHIELD = BUILD_SHIELD;

/** The build pieces, in the order the scroll wheel cycles them. */
export const BUILD_SLOTS = [SLOT_WALL, SLOT_FLOOR, SLOT_RAMP, SLOT_CONE, SLOT_SHIELD];

/**
 * Every rebindable action.
 *
 * Kept as one flat list so the settings UI can be generated from it and a new
 * action cannot be added without also getting a default and a label.
 */
export type Action =
  | "forward" | "back" | "left" | "right"
  | "jump" | "crouch" | "sprint" | "reload" | "edit"
  | "weapon1" | "weapon2" | "weapon3" | "weapon4" | "weapon5"
  | "wall" | "floor" | "ramp" | "cone" | "shield"
  | "matWood" | "matBrick" | "matMetal";

export const ACTION_LABELS: ReadonlyArray<readonly [Action, string]> = [
  ["forward", "Move forward"],
  ["back", "Move back"],
  ["left", "Strafe left"],
  ["right", "Strafe right"],
  ["jump", "Jump / climb"],
  ["crouch", "Crouch / slide"],
  ["sprint", "Sprint"],
  ["reload", "Reload"],
  ["edit", "Edit piece"],
  ["weapon1", "Pickaxe"],
  ["weapon2", "Shotgun"],
  ["weapon3", "Assault rifle"],
  ["weapon4", "SMG"],
  ["weapon5", "Sniper"],
  ["wall", "Build wall"],
  ["floor", "Build floor"],
  ["ramp", "Build ramp"],
  ["cone", "Build cone"],
  ["shield", "Shield block"],
  ["matWood", "Wood"],
  ["matBrick", "Brick"],
  ["matMetal", "Metal"],
];

export const DEFAULT_BINDS: Readonly<Record<Action, string>> = {
  forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD",
  jump: "Space", crouch: "ControlLeft", sprint: "ShiftLeft",
  reload: "KeyG", edit: "KeyT",
  weapon1: "Digit1", weapon2: "Digit2", weapon3: "Digit3",
  weapon4: "Digit4", weapon5: "Digit5",
  wall: "KeyQ", floor: "KeyE", ramp: "KeyR", cone: "KeyF", shield: "KeyV",
  matWood: "KeyZ", matBrick: "KeyX", matMetal: "KeyC",
};

const BINDS_STORAGE_KEY = "clutch.binds";

/** Human-readable name for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  switch (code) {
    case "Space": return "Space";
    case "ControlLeft": return "L Ctrl";
    case "ControlRight": return "R Ctrl";
    case "ShiftLeft": return "L Shift";
    case "ShiftRight": return "R Shift";
    case "AltLeft": return "L Alt";
    case "AltRight": return "R Alt";
    case "ArrowUp": return "Up";
    case "ArrowDown": return "Down";
    case "ArrowLeft": return "Left";
    case "ArrowRight": return "Right";
    default: return code;
  }
}

export interface ControlsOptions {
  sensitivity: number;
  onPointerLockChange(locked: boolean): void;
  /** Tab is held, not toggled, so the scoreboard behaves like every other. */
  onScoreboard?(open: boolean): void;
}

export class Controls {
  yaw = 0;
  pitch = 0;
  sensitivity: number;

  /** 0-4 weapon, 5-8 build piece. */
  slot = 2;
  material = 0;

  private binds: Record<Action, string> = { ...DEFAULT_BINDS };
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
  private touchMoveX = 0;
  private touchMoveZ = 0;
  private touchFire = false;
  private touchAim = false;
  private touchJump = false;
  /**
   * A press that has not been sampled yet.
   *
   * Input is sampled on its own 30 Hz timer, not on the pointer event, so a
   * quick tap that goes down and up inside one tick was simply never seen --
   * on a phone that is a trigger pull or a jump that silently did nothing, and
   * it happens constantly because tapping is how phones work. Latching the
   * press until at least one sample has carried it makes every tap count.
   */
  private touchFireEdge = false;
  private touchJumpEdge = false;
  private touchCrouch = false;
  private touchSprint = false;
  private scoreboard = false;
  /** So the BUILD button can toggle back to whatever you were holding. */
  private lastWeaponSlot = 2;
  private lastBuildSlot = SLOT_WALL;

  constructor(
    private canvas: HTMLElement,
    private opts: ControlsOptions,
  ) {
    this.sensitivity = opts.sensitivity;
    this.loadBinds();
    this.attach();
  }

  get isLocked(): boolean { return this.locked; }
  get inBuildMode(): boolean { return this.slot >= SLOT_WALL; }
  /** Read-only view for the camera. sample() advances the sequence number, so
   *  callers that only want to observe must not go through it. */
  get aiming(): boolean { return this.rightDown || this.touchAim; }
  get firing(): boolean { return this.mouseDown || this.touchFire || this.touchFireEdge; }
  get scoreboardOpen(): boolean { return this.scoreboard; }
  /** Strafe input, -1 to 1, for the slide camera bank. Left deliberately
   *  unquantised: sample() snaps this to -1/0/1 for the wire, which is the
   *  right thing for the simulation and much too steppy for a camera. */
  get strafe(): number {
    let x = 0;
    if (this.down("right")) x += 1;
    if (this.down("left")) x -= 1;
    x += this.touchMoveX;
    return Math.max(-1, Math.min(1, x));
  }

  // -------------------------------------------------------------------------
  // Key bindings
  // -------------------------------------------------------------------------

  get bindings(): Readonly<Record<Action, string>> { return this.binds; }

  /**
   * Rebind one action. A code already used by another action is cleared from
   * it first, because two actions on one key is never what anybody meant and
   * silently firing both is worse than dropping the old binding.
   */
  setBinding(action: Action, code: string): void {
    for (const other of Object.keys(this.binds) as Action[]) {
      if (other !== action && this.binds[other] === code) this.binds[other] = "";
    }
    this.binds[action] = code;
    this.saveBinds();
  }

  resetBindings(): void {
    this.binds = { ...DEFAULT_BINDS };
    this.saveBinds();
  }

  private loadBinds(): void {
    try {
      const raw = localStorage.getItem(BINDS_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<Record<Action, string>>;
      // Merged over the defaults rather than replacing them, so a binding set
      // saved before a new action existed does not leave that action dead.
      for (const [action] of ACTION_LABELS) {
        const code = saved[action];
        if (typeof code === "string") this.binds[action] = code;
      }
    } catch { /* corrupt or unavailable storage: keep the defaults */ }
  }

  private saveBinds(): void {
    try { localStorage.setItem(BINDS_STORAGE_KEY, JSON.stringify(this.binds)); }
    catch { /* private mode; bindings just will not persist */ }
  }

  private down(action: Action): boolean {
    const code = this.binds[action];
    return code !== "" && this.keys.has(code);
  }

  // -------------------------------------------------------------------------
  // Touch
  // -------------------------------------------------------------------------

  setTouchMove(x: number, z: number): void {
    this.touchMoveX = Math.max(-1, Math.min(1, x));
    this.touchMoveZ = Math.max(-1, Math.min(1, z));
  }
  touchLook(dx: number, dy: number): void {
    this.yaw += dx * this.sensitivity * 1.7;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - dy * this.sensitivity * 1.7));
  }
  /**
   * Handle an on-screen control.
   *
   * Aim and sprint are TOGGLES on touch rather than holds. A thumb that has to
   * stay on the aim button is a thumb that cannot also be on the stick, which
   * is the single biggest reason touch shooters feel unplayable; the same
   * applies to sprint. Fire, jump and crouch stay momentary, because those you
   * genuinely want to release.
   */
  setTouchAction(action: string, on: boolean): boolean {
    switch (action) {
      case "fire":
        this.touchFire = on;
        if (on) this.touchFireEdge = true;
        return on;
      case "jump":
        this.touchJump = on;
        if (on) this.touchJumpEdge = true;
        return on;
      case "crouch": this.touchCrouch = on; return on;
      // A toggle, not a hold. Holding a button to read the scoreboard costs
      // the thumb that would otherwise be on the stick or the trigger, which
      // on a phone means you cannot check the score without standing still and
      // stopping shooting.
      case "scores":
        if (on) this.setScoreboard(!this.scoreboard);
        return this.scoreboard;
      case "aim":
        if (on) this.touchAim = !this.touchAim;
        return this.touchAim;
      case "sprint":
        if (on) this.touchSprint = !this.touchSprint;
        return this.touchSprint;
      case "reload":
        if (on) this.edgeReload = true;
        return on;
      case "build":
        if (on) this.selectSlot(this.inBuildMode ? this.lastWeaponSlot : this.lastBuildSlot);
        return this.inBuildMode;
      default: return on;
    }
  }

  /** Select a weapon (0-4) or a build piece (5-8). Used by the on-screen slot
   *  bar as well as the keyboard. */
  selectSlot(slot: number): void {
    if (slot < 0 || slot > SLOT_SHIELD) return;
    // 9-11 are the material switches riding the same field; they are not
    // something the slot bar can select.
    if (slot > SLOT_CONE && slot !== SLOT_SHIELD) return;
    this.slot = slot;
    if (slot >= SLOT_WALL) this.lastBuildSlot = slot;
    else this.lastWeaponSlot = slot;
  }

  selectMaterialPublic(material: number): void { this.selectMaterial(material); }

  reset(): void {
    this.keys.clear();
    this.mouseDown = this.rightDown = false;
    this.touchFire = this.touchAim = this.touchJump = false;
    this.touchFireEdge = this.touchJumpEdge = false;
    this.touchCrouch = this.touchSprint = false;
    this.touchMoveX = this.touchMoveZ = 0;
    this.edgeReload = this.edgeReset = false;
    this.slotOverrides.length = 0;
    this.setScoreboard(false);
  }

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
        this.reset();
      }
      this.opts.onPointerLockChange(this.locked);
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.yaw += e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
      // Keep yaw in range so quantisation stays lossless across long sessions.
      if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
      if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    });

    document.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      e.preventDefault();
      if (e.button === 0) { this.mouseDown = true; this.touchFireEdge = true; }
      if (e.button === 2) this.rightDown = true;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightDown = false;
    });

    document.addEventListener("wheel", (e) => {
      if (!this.locked) return;
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      if (this.inBuildMode) {
        // The wheel used to do nothing at all in build mode, so the only way
        // through the four pieces was four separate keys -- which is most of
        // what made the build bar feel broken.
        const index = BUILD_SLOTS.indexOf(this.slot);
        const next = (index + dir + BUILD_SLOTS.length) % BUILD_SLOTS.length;
        this.selectSlot(BUILD_SLOTS[next]);
      } else {
        this.selectSlot((this.slot + dir + 5) % 5);
      }
    }, { passive: false });

    document.addEventListener("contextmenu", (e) => {
      if (this.locked) e.preventDefault();
    });

    document.addEventListener("keydown", (e) => {
      if (!this.locked) return;
      // Stop the browser scrolling or quick-finding under the game.
      if (["Space", "Tab", "Slash", "Quote"].includes(e.code)) e.preventDefault();
      if (e.code === "Tab") { this.setScoreboard(true); return; }
      if (e.code === this.binds.jump && !e.repeat) this.touchJumpEdge = true;
      this.keys.add(e.code);
      this.handleSelection(e.code);
    });
    document.addEventListener("keyup", (e) => {
      if (e.code === "Tab") this.setScoreboard(false);
      this.keys.delete(e.code);
    });

    window.addEventListener("blur", () => {
      this.reset();
    });
  }

  private setScoreboard(open: boolean): void {
    if (this.scoreboard === open) return;
    this.scoreboard = open;
    this.opts.onScoreboard?.(open);
  }

  private handleSelection(code: string): void {
    const hit = (action: Action) => this.binds[action] !== "" && this.binds[action] === code;
    if (hit("weapon1")) this.selectSlot(0);
    else if (hit("weapon2")) this.selectSlot(1);
    else if (hit("weapon3")) this.selectSlot(2);
    else if (hit("weapon4")) this.selectSlot(3);
    else if (hit("weapon5")) this.selectSlot(4);
    else if (hit("wall")) this.selectSlot(SLOT_WALL);
    else if (hit("floor")) this.selectSlot(SLOT_FLOOR);
    else if (hit("ramp")) this.selectSlot(SLOT_RAMP);
    else if (hit("cone")) this.selectSlot(SLOT_CONE);
    else if (hit("shield")) this.selectSlot(SLOT_SHIELD);
    else if (hit("matWood")) this.selectMaterial(0);
    else if (hit("matBrick")) this.selectMaterial(1);
    else if (hit("matMetal")) this.selectMaterial(2);
    else if (hit("reload")) this.edgeReload = true;
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
    if (this.down("jump") || this.touchJump || this.touchJumpEdge) buttons |= BTN_JUMP;
    if (this.mouseDown || this.touchFire || this.touchFireEdge) buttons |= BTN_FIRE;
    this.touchJumpEdge = false;
    this.touchFireEdge = false;
    if (this.rightDown || this.touchAim) buttons |= BTN_AIM;
    if (this.down("crouch") || this.touchCrouch) buttons |= BTN_CROUCH;
    if (this.down("sprint") || this.touchSprint) buttons |= BTN_SPRINT;
    if (this.edgeReload) { buttons |= BTN_RELOAD; this.edgeReload = false; }
    if (this.down("edit")) buttons |= BTN_EDIT;
    if (this.edgeReset) { buttons |= BTN_RESET; this.edgeReset = false; }

    let moveX = 0;
    let moveZ = 0;
    if (this.down("forward")) moveZ += 1;
    if (this.down("back")) moveZ -= 1;
    if (this.down("right")) moveX += 1;
    if (this.down("left")) moveX -= 1;
    moveX += this.touchMoveX;
    moveZ += this.touchMoveZ;
    // The wire format carries one of -1, 0 or 1 per axis, so an analogue stick
    // has to be squared off here rather than silently truncated on send.
    moveX = Math.sign(Math.abs(moveX) > 0.35 ? moveX : 0);
    moveZ = Math.sign(Math.abs(moveZ) > 0.35 ? moveZ : 0);

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
