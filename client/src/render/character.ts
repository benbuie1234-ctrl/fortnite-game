import { W_PICKAXE } from "@shared/weapons";
import * as THREE from "three";
import { PLAYER_HEIGHT } from "@shared/constants";
import { skinById, type SkinDef } from "@shared/skins";
import { createWeaponModel, disposeWeaponModel } from "./weaponmodels";

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
  private gun: THREE.Group;
  private gunModel: THREE.Group | null = null;
  private pickaxe = new THREE.Group();
  private weaponId = -1;
  private nameplate: THREE.Sprite;
  private nameCanvas: HTMLCanvasElement;
  private nameTexture: THREE.CanvasTexture;

  private phase = 0;
  private kick = 0;
  private muzzle: THREE.Mesh;
  private lastName = "";
  private lastHpPct = -1;
  private materials: THREE.MeshStandardMaterial[] = [];

  constructor(skinId: string, name: string) {
    const skin = skinById(skinId);

    const matPrimary = physical(skin.colors.primary);
    const matSecondary = physical(skin.colors.secondary);
    const matAccent = physical(skin.colors.accent);
    const matSkin = physical(skin.colors.skin, 0.82);
    const matVisor = physical(skin.colors.visor, 0.25, 0.6);
    this.materials = [matPrimary, matSecondary, matAccent, matSkin, matVisor];

    // --- legs: pivot at the hip so rotation swings the foot ---
    this.legL = pivotBox(0.21, LEG_H, 0.21, matSecondary);
    this.legL.position.set(-0.13, LEG_H, 0);
    this.legR = pivotBox(0.21, LEG_H, 0.21, matSecondary);
    this.legR.position.set(0.13, LEG_H, 0);

    // --- torso ---
    this.torso = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.22, TORSO_H, 6), matPrimary);
    this.torso.position.set(0, LEG_H + TORSO_H / 2, 0);

    // --- arms: pivot at the shoulder ---
    this.armL = pivotBox(0.15, ARM_H, 0.15, matAccent);
    this.armL.position.set(-0.32, LEG_H + TORSO_H - 0.04, 0);
    this.armR = pivotBox(0.15, ARM_H, 0.15, matAccent);
    this.armR.position.set(0.32, LEG_H + TORSO_H - 0.04, 0);

    // --- head, grouped so it can pitch with the view ---
    this.head = new THREE.Group();
    this.head.position.set(0, LEG_H + TORSO_H, 0);
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.215, 1), matSkin);
    skull.position.y = HEAD_H / 2 + 0.02;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.09, 0.12), matVisor);
    visor.position.set(0, HEAD_H / 2 + 0.06, 0.17);
    this.head.add(skull, visor);

    // --- held weapon ---
    // An empty holder; setWeapon fills it with a real model per weapon. This
    // used to be one box scaled differently per gun, which meant every weapon
    // had the same silhouette -- and the gun in your hands is on screen in
    // every single frame.
    this.gun = new THREE.Group();
    this.gun.position.set(-0.28, LEG_H + TORSO_H - 0.18, 0.3);

    const handle=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.75,6),matSecondary);
    const blade=new THREE.Mesh(new THREE.BoxGeometry(.58,.09,.12),matAccent);
    blade.position.y=.31;blade.rotation.z=-.15;
    this.pickaxe.add(handle,blade);this.pickaxe.position.set(-.3,1.1,.4);
    this.root.add(this.pickaxe);
    this.muzzle = new THREE.Mesh(new THREE.ConeGeometry(.09,.22,5),new THREE.MeshBasicMaterial({color:0xffe89a}));
    this.muzzle.rotation.x = Math.PI/2;
    this.muzzle.position.z = .42;
    this.muzzle.visible = false;
    this.gun.add(this.muzzle);

    for (const m of [this.legL, this.legR, this.torso, this.armL, this.armR]) {
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

  setWeapon(id:number):void {
    if (this.weaponId === id && this.gunModel) return; // already holding it
    this.weaponId=id;

    // The old box-with-a-scale is gone; every weapon now has its own geometry,
    // so a shotgun reads as a shotgun from across the map.
    this.pickaxe.visible = false;
    if (this.gunModel) {
      this.gun.remove(this.gunModel);
      disposeWeaponModel(this.gunModel);
      this.gunModel = null;
    }

    // 255 means "in build mode, holding nothing".
    this.gun.visible = id !== 255;
    if (!this.gun.visible) return;

    this.gunModel = createWeaponModel(id);
    this.gun.add(this.gunModel);
  }
  fire():void { this.kick=this.weaponId===W_PICKAXE?.35:.09; }
  aimAt(worldPoint:THREE.Vector3):void {
    if(!this.gun.visible)return;
    this.root.updateMatrixWorld(true);
    const local=this.root.worldToLocal(worldPoint.clone()).sub(this.gun.position).normalize();
    this.gun.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),local);
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

    // Opponents reveal names, not their remaining health. Hit feedback is
    // provided by the local damage numbers instead.

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
    this.root.rotation.y = -yaw;

    this.head.rotation.x = -pitch * 0.55;
    this.kick = Math.max(0,this.kick-dt);
    this.muzzle.visible = this.weaponId!==W_PICKAXE&&this.kick>.045;
    this.pickaxe.rotation.x=-pitch+(this.kick>0?Math.sin((.35-this.kick)/.35*Math.PI)*1.6:0);
    this.gun.rotation.x = -pitch - this.kick*1.2;
    this.gun.position.z = .3-this.kick;

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
    this.armL.rotation.x = -1.05-pitch*.8-swing*.1;
    this.armR.rotation.x = -.8-pitch*.8+swing*.1;

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

/**
 * Cloth and skin read as matte; the visor and the weapon catch a highlight.
 * Under the sky environment map that difference is visible, which is most of
 * what stops a character looking like flat painted cardboard.
 */
function physical(color: number, roughness = 0.72, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, roughness, metalness, envMapIntensity: 0.9,
  });
}

/** A box whose origin sits at its top face, so rotation pivots at the joint. */
function pivotBox(
  w: number, h: number, d: number, material: THREE.Material,
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(w * 0.55, w * 0.45, h, 6);
  geo.translate(0, -h / 2, 0);
  return new THREE.Mesh(geo, material);
}
