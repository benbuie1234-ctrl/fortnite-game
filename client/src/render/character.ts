import * as THREE from "three";
import { PLAYER_HEIGHT } from "@shared/constants";
import { skinById, type SkinDef } from "@shared/skins";

// Proportions, in metres, summing to PLAYER_HEIGHT. Deliberately blocky: it
// reads clearly at distance, costs nothing to draw, and makes every skin a
// recolour rather than a new asset.
const LEG_H = 0.78;
const TORSO_H = 0.62;
const HEAD_H = 0.34;
const ARM_H = 0.56;

/**
 * One player's body. Built from boxes so there is no asset pipeline, no
 * loading, and no rig: the walk cycle is four rotations driven by speed.
 */
export class Character {
  readonly root = new THREE.Group();
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private torso: THREE.Mesh;
  private head: THREE.Group;
  private gun: THREE.Mesh;
  private nameplate: THREE.Sprite;
  private nameCanvas: HTMLCanvasElement;
  private nameTexture: THREE.CanvasTexture;

  private phase = 0;
  private lastName = "";
  private lastHpPct = -1;
  private materials: THREE.MeshLambertMaterial[] = [];

  constructor(skinId: string, name: string) {
    const skin = skinById(skinId);

    const matPrimary = new THREE.MeshLambertMaterial({ color: skin.colors.primary });
    const matSecondary = new THREE.MeshLambertMaterial({ color: skin.colors.secondary });
    const matAccent = new THREE.MeshLambertMaterial({ color: skin.colors.accent });
    const matSkin = new THREE.MeshLambertMaterial({ color: skin.colors.skin });
    const matVisor = new THREE.MeshLambertMaterial({ color: skin.colors.visor });
    this.materials = [matPrimary, matSecondary, matAccent, matSkin, matVisor];

    // --- legs: pivot at the hip so rotation swings the foot ---
    this.legL = pivotBox(0.21, LEG_H, 0.21, matSecondary);
    this.legL.position.set(-0.13, LEG_H, 0);
    this.legR = pivotBox(0.21, LEG_H, 0.21, matSecondary);
    this.legR.position.set(0.13, LEG_H, 0);

    // --- torso ---
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, TORSO_H, 0.29), matPrimary);
    this.torso.position.set(0, LEG_H + TORSO_H / 2, 0);

    // --- arms: pivot at the shoulder ---
    this.armL = pivotBox(0.15, ARM_H, 0.15, matAccent);
    this.armL.position.set(-0.32, LEG_H + TORSO_H - 0.04, 0);
    this.armR = pivotBox(0.15, ARM_H, 0.15, matAccent);
    this.armR.position.set(0.32, LEG_H + TORSO_H - 0.04, 0);

    // --- head, grouped so it can pitch with the view ---
    this.head = new THREE.Group();
    this.head.position.set(0, LEG_H + TORSO_H, 0);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.34, HEAD_H, 0.34), matSkin);
    skull.position.y = HEAD_H / 2 + 0.02;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.345, 0.1, 0.345), matVisor);
    visor.position.set(0, HEAD_H / 2 + 0.06, 0.005);
    this.head.add(skull, visor);

    // --- held weapon, a simple silhouette in the right hand ---
    this.gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.13, 0.62),
      new THREE.MeshLambertMaterial({ color: 0x2a2f38 }),
    );
    this.gun.position.set(0.32, LEG_H + TORSO_H - 0.18, 0.3);

    for (const m of [this.legL, this.legR, this.torso, this.armL, this.armR, this.gun]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    this.head.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
    });

    // --- nameplate + health bar ---
    this.nameCanvas = document.createElement("canvas");
    this.nameCanvas.width = 256;
    this.nameCanvas.height = 64;
    this.nameTexture = new THREE.CanvasTexture(this.nameCanvas);
    this.nameTexture.colorSpace = THREE.SRGBColorSpace;
    this.nameplate = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.nameTexture, depthTest: false, transparent: true,
    }));
    this.nameplate.scale.set(1.5, 0.375, 1);
    this.nameplate.position.y = PLAYER_HEIGHT + 0.42;
    this.nameplate.renderOrder = 3;

    this.root.add(
      this.legL, this.legR, this.torso, this.armL, this.armR,
      this.head, this.gun, this.nameplate,
    );
    this.setNameplate(name, 255);
  }

  setSkin(skinId: string): void {
    const skin: SkinDef = skinById(skinId);
    this.materials[0].color.setHex(skin.colors.primary);
    this.materials[1].color.setHex(skin.colors.secondary);
    this.materials[2].color.setHex(skin.colors.accent);
    this.materials[3].color.setHex(skin.colors.skin);
    this.materials[4].color.setHex(skin.colors.visor);
  }

  /** Hide the plate entirely. Used for the local player, who does not need a
   *  label floating over their own head. */
  hideNameplate(): void {
    this.nameplate.visible = false;
  }

  setNameplate(name: string, hpPct: number): void {
    if (name === this.lastName && hpPct === this.lastHpPct) return;
    this.lastName = name;
    this.lastHpPct = hpPct;

    const ctx = this.nameCanvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 256, 64);

    ctx.font = "bold 26px Inter, Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(0,0,0,.85)";
    ctx.strokeText(name, 128, 28);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(name, 128, 28);

    const frac = Math.max(0, Math.min(1, hpPct / 255));
    ctx.fillStyle = "rgba(0,0,0,.72)";
    ctx.fillRect(40, 40, 176, 12);
    ctx.fillStyle = frac > 0.5 ? "#4ade80" : frac > 0.22 ? "#ffc53d" : "#ff5a5a";
    ctx.fillRect(42, 42, 172 * frac, 8);

    this.nameTexture.needsUpdate = true;
  }

  /**
   * Pose the body. `speed` is horizontal metres per second; the walk cycle is
   * driven by distance travelled so it never desyncs from actual movement.
   */
  update(
    x: number, y: number, z: number,
    yaw: number, pitch: number,
    speed: number, grounded: boolean, dt: number,
  ): void {
    this.root.position.set(x, y, z);
    // The model faces +Z at yaw 0, matching forwardVector in shared/vec.ts.
    this.root.rotation.y = yaw;

    this.head.rotation.x = -pitch * 0.55;
    this.gun.rotation.x = -pitch * 0.85;

    const moving = speed > 0.6;
    if (moving && grounded) {
      this.phase += dt * speed * 2.1;
    } else {
      // Ease the limbs back to neutral instead of snapping.
      this.phase += dt * 2.0;
    }

    const swing = moving && grounded ? Math.sin(this.phase) * Math.min(0.85, speed * 0.13) : 0;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.7;
    this.armR.rotation.x = swing * 0.35;

    if (!grounded) {
      // Tuck in the air so a jump is legible from across the map.
      this.legL.rotation.x = -0.5;
      this.legR.rotation.x = -0.25;
      this.armL.rotation.x = -0.9;
    }

    // Idle breathing, and a slight bob while running.
    const bob = moving && grounded ? Math.abs(Math.sin(this.phase)) * 0.035 : Math.sin(this.phase * 0.5) * 0.012;
    this.torso.position.y = LEG_H + TORSO_H / 2 + bob;
    this.head.position.y = LEG_H + TORSO_H + bob;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.root);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
    this.nameTexture.dispose();
  }
}

/** A box whose origin sits at its top face, so rotation pivots at the joint. */
function pivotBox(
  w: number, h: number, d: number, material: THREE.Material,
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, -h / 2, 0);
  return new THREE.Mesh(geo, material);
}
