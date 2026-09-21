import * as THREE from "three";
import { weaponById } from "@shared/weapons";

/**
 * Camera feel: recoil, shake, landing dip and FOV punch.
 *
 * None of this changes what the game simulates -- every one of these effects
 * is applied to the *camera* after the authoritative state is known, and the
 * ray the server traces is unaffected. That distinction matters: recoil you
 * can feel but that does not move your actual aim is juice; recoil that moves
 * your aim is a mechanic, and it belongs in the simulation where both sides
 * agree on it.
 *
 * Everything here is a spring. An impulse kicks a value away from rest and it
 * springs back, which is what makes a weapon feel like it has mass rather than
 * like a value being lerped to zero on a timer.
 */

/** Spring constants. Stiff enough to recover fast, damped enough not to wobble. */
const RECOIL_STIFFNESS = 190;
const RECOIL_DAMPING = 21;
const DIP_STIFFNESS = 120;
const DIP_DAMPING = 15;

export class ViewEffects {
  // Recoil, in radians, added on top of the player's aim.
  private punchPitch = 0;
  private punchYaw = 0;
  private punchPitchVel = 0;
  private punchYawVel = 0;

  // Positional shake, in metres.
  private shake = 0;
  private shakeX = 0;
  private shakeY = 0;

  // Vertical camera dip on landing.
  private dip = 0;
  private dipVel = 0;

  /** Extra degrees of field of view, for the brief widening when firing. */
  private fovPunch = 0;

  /**
   * Fire a weapon. Kick is scaled by the weapon's own recoil rating, so the
   * sniper shoves and the SMG buzzes.
   */
  fire(weaponId: number): void {
    const recoil = weaponById(weaponId).recoil;
    // Up and slightly to one side, never the same way twice.
    this.punchPitchVel += recoil * 1.5;
    this.punchYawVel += (Math.random() - 0.5) * recoil * 1.1;
    this.shake = Math.min(1, this.shake + recoil * 0.06);
    this.fovPunch = Math.min(3.5, this.fovPunch + recoil * 0.5);
  }

  /** Took a hit. Shake scales with how hard. */
  damage(amount: number): void {
    this.shake = Math.min(1.4, this.shake + Math.min(0.5, amount / 90));
    this.punchPitchVel += (Math.random() - 0.5) * 1.2;
  }

  /** Landed. `speed` is the downward speed at impact. */
  land(speed: number): void {
    const heavy = Math.min(1, speed / 20);
    if (heavy < 0.08) return;
    this.dipVel -= heavy * 3.2;
    if (heavy > 0.5) this.shake = Math.min(1, this.shake + heavy * 0.25);
  }

  /** A nearby explosion or a piece being destroyed close by. */
  bump(strength: number): void {
    this.shake = Math.min(1.2, this.shake + strength);
  }

  update(dt: number): void {
    // Clamp dt: a long frame would otherwise make the springs explode.
    const step = Math.min(dt, 1 / 30);

    this.punchPitchVel += (-RECOIL_STIFFNESS * this.punchPitch - RECOIL_DAMPING * this.punchPitchVel) * step;
    this.punchPitch += this.punchPitchVel * step;
    this.punchYawVel += (-RECOIL_STIFFNESS * this.punchYaw - RECOIL_DAMPING * this.punchYawVel) * step;
    this.punchYaw += this.punchYawVel * step;

    this.dipVel += (-DIP_STIFFNESS * this.dip - DIP_DAMPING * this.dipVel) * step;
    this.dip += this.dipVel * step;

    // Shake decays fast; it is punctuation, not atmosphere.
    this.shake = Math.max(0, this.shake - step * 3.4);
    if (this.shake > 0.0001) {
      this.shakeX = (Math.random() - 0.5) * this.shake * 0.09;
      this.shakeY = (Math.random() - 0.5) * this.shake * 0.09;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }

    this.fovPunch = Math.max(0, this.fovPunch - step * 14);
  }

  /** Aim offset in radians, added to the player's own look angles. */
  get pitchOffset(): number { return this.punchPitch * 0.045; }
  get yawOffset(): number { return this.punchYaw * 0.045; }
  get fovOffset(): number { return this.fovPunch; }

  /** Positional offset applied in camera-local space. */
  applyShake(camera: THREE.PerspectiveCamera): void {
    if (this.shakeX === 0 && this.shakeY === 0 && Math.abs(this.dip) < 1e-4) return;
    // Shake sideways/up in the camera's own frame so it reads as the camera
    // being knocked, not the world sliding.
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    camera.position.addScaledVector(right, this.shakeX);
    camera.position.addScaledVector(up, this.shakeY + this.dip * 0.12);
  }
}
