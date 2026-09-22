import { W_PICKAXE } from "@shared/weapons";
import * as THREE from "three";
import type { ModelLibrary } from "./models";
import { PLAYER_HEIGHT, CROUCH_HEIGHT } from "@shared/constants";
import { skinById, type SkinDef } from "@shared/skins";
import { createWeaponModel, disposeWeaponModel } from "./weaponmodels";

// Proportions, in metres, summing to PLAYER_HEIGHT. Deliberately blocky: it
// reads clearly at distance, costs nothing to draw, and makes every skin a
// recolour rather than a new asset.
export const LEG_H = 0.78;
export const TORSO_H = 0.62;
const HEAD_H = 0.34;
const ARM_H = 0.56;

/** The leg has a knee. THIGH_H + SHIN_H is LEG_H, so a straight leg is exactly
 *  the leg it replaced and nothing else in the proportions has to move. */
export const THIGH_H = 0.40;
export const SHIN_H = LEG_H - THIGH_H;
const FOOT_L = 0.26;

/** Roughly how far the top of the skull sits above the shoulder line. Used to
 *  work out how low the hip has to go for the crouched silhouette to fit
 *  inside the collision capsule. */
export const HEAD_RISE = 0.405;

/** How far the torso leans forward at a full crouch. */
export const CROUCH_LEAN = 0.62;

/**
 * Hip height at a full crouch.
 *
 * DERIVED, not chosen. A crouched player whose model is taller than their
 * collision capsule shows a head that cannot be shot, which is worse than an
 * ugly pose -- so the hip goes exactly as low as it needs to for the top of
 * the skull to land on CROUCH_HEIGHT. Tuning the stance in constants.ts now
 * moves the pose with it instead of silently desynchronising the two.
 */
export const CROUCH_HIP_Y = Math.max(
  Math.abs(THIGH_H - SHIN_H) + 0.06, // below this the knee has nowhere to go
  CROUCH_HEIGHT - Math.cos(CROUCH_LEAN) * TORSO_H - HEAD_RISE,
);

/**
 * One player's body. Built from boxes so there is no asset pipeline, no
 * loading, and no rig: the walk cycle is four rotations driven by speed.
 */
export class Character {
  readonly root = new THREE.Group();
  private mixer?: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private currentAction?: THREE.AnimationAction;
  /** Hip joints. The thigh hangs off these and the knee hangs off the thigh,
   *  so one rotation at each joint folds the whole leg. */
  private hipL: THREE.Group;
  private hipR: THREE.Group;
  private kneeL: THREE.Group;
  private kneeR: THREE.Group;
  /** Feet, kept level with the ground whatever the leg above them is doing. */
  private footL: THREE.Group;
  private footR: THREE.Group;
  private armL: THREE.Object3D;
  private armR: THREE.Object3D;
  private torso: THREE.Object3D;
  private head: THREE.Group;
  private gun: THREE.Group;
  private gunModel: THREE.Group | null = null;
  private pickaxe = new THREE.Group();
  private weaponId = -1;
  private nameplate: THREE.Sprite;
  private nameCanvas: HTMLCanvasElement;
  private nameTexture: THREE.CanvasTexture;

  private phase = 0;
  /** Smoothed crouch, 0-1. Smoothed here rather than by the caller because
   *  remote players only send a crouch BIT, and a bit applied straight to the
   *  pose snaps. */
  private crouch = 0;
  private kick = 0;
  private muzzle: THREE.Mesh;
  private lastName = "";
  private materials: THREE.MeshStandardMaterial[] = [];

  constructor(skinId: string, name: string, private models?: ModelLibrary) {
    const skin = skinById(skinId);

    const matPrimary = physical(skin.colors.primary);
    const matSecondary = physical(skin.colors.secondary);
    const matAccent = physical(skin.colors.accent);
    const matSkin = physical(skin.colors.skin, 0.82);
    const matVisor = physical(skin.colors.visor, 0.25, 0.6);
    this.materials = [matPrimary, matSecondary, matAccent, matSkin, matVisor];

    // --- legs: a hip, a thigh, a knee, a shin and a foot -------------------
    //
    // They used to be one box per leg, scaled down on the Y axis to crouch.
    // That telescopes: the leg gets SHORTER rather than folding, so the whole
    // body slides straight down and the pose reads as sinking through the
    // floor rather than as crouching. A knee is the entire difference.
    const leg = (side: number): [THREE.Group, THREE.Group, THREE.Group] => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.13, LEG_H, 0);
      hip.add(pivotBox(0.21, THIGH_H, 0.21, matSecondary));

      const knee = new THREE.Group();
      knee.position.y = -THIGH_H;
      knee.add(pivotBox(0.19, SHIN_H, 0.19, matSecondary));

      // A foot, so the leg has somewhere to end. Without one a folded leg
      // stops in mid-air at the ankle and the character looks amputated. It
      // gets its own group because it has to be counter-rotated back to level
      // every frame -- an ankle that follows the shin points a deep crouch's
      // toes at the floor.
      const ankle = new THREE.Group();
      ankle.position.y = -SHIN_H;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.09, FOOT_L), matAccent);
      foot.position.set(0, 0.045, FOOT_L * 0.22);
      ankle.add(foot);
      knee.add(ankle);

      hip.add(knee);
      return [hip, knee, ankle];
    };
    [this.hipL, this.kneeL, this.footL] = leg(-1);
    [this.hipR, this.kneeR, this.footR] = leg(1);

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

    for (const node of [this.hipL, this.hipR, this.torso, this.armL, this.armR]) {
      node.traverse((o) => {
        if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
      });
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
      this.hipL, this.hipR, this.torso, this.armL, this.armR,
      this.head, this.gun, this.nameplate,
    );
    const art = models?.get("character");
    if (art) {
      const names = ["hipL", "hipR", "kneeL", "kneeR", "footL", "footR", "torso", "armL", "armR", "head"] as const;
      const isBlockRanger = names.every(n => art.getObjectByName(n));

      for (const node of [this.hipL, this.hipR, this.torso, this.armL, this.armR, this.head]) {
        this.root.remove(node);
        node.traverse(n => { if (n instanceof THREE.Mesh) n.geometry.dispose(); });
      }

      if (isBlockRanger) {
        for (const name of names) (this as unknown as Record<string, THREE.Object3D>)[name] = art.getObjectByName(name)!;
      } else {
        const rightHand = art.getObjectByName("mixamorigRightHand") || art.getObjectByName("RightHand");
        if (rightHand) {
          this.root.remove(this.gun);
          this.root.remove(this.pickaxe);
          rightHand.add(this.gun);
          rightHand.add(this.pickaxe);
          this.gun.position.set(0.08, 0.12, 0.0);
          this.gun.rotation.set(0, Math.PI / 2, -Math.PI / 2);
          this.pickaxe.position.set(0.08, 0.12, 0.0);
          this.pickaxe.rotation.set(0, Math.PI / 2, -Math.PI / 2);
        }
      }

      art.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        node.castShadow = true;
        node.receiveShadow = true;
        for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
          if (mat instanceof THREE.MeshStandardMaterial) {
            if (mat.name === "Armor") mat.color.setHex(skin.colors.primary);
            if (mat.name === "Accent" || mat.name === "Suit") mat.color.setHex(skin.colors.accent);
          }
        }
      });
      this.root.add(art);
      this.mixer = new THREE.AnimationMixer(art);
      for (const clip of models!.animations("character")) this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
    this.setNameplate(name);
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

    const slots: Record<number, string> = { 0: "weapon_ar", 1: "weapon_shotgun", 2: "weapon_sniper", 3: "weapon_smg", 4: "weapon_pistol" };
    const imported = this.models?.get(slots[id] as import("./models").ModelId);
    this.gunModel = imported as THREE.Group | null ?? createWeaponModel(id);
    this.gun.add(this.gunModel);
  }
  fire(): void {
    this.kick = this.weaponId === W_PICKAXE ? .35 : .09;
    const fireAction = this.actions.get("fire");
    if (fireAction) {
      fireAction.reset().setLoop(THREE.LoopOnce, 1).play();
    }
  }
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

  /**
   * Draw the floating nameplate.
   *
   * Name only. There used to be a health bar under it, which handed every
   * player a permanent readout of exactly how close each opponent was to
   * dying, from any range, through the noise of a fight. Damage numbers tell
   * you what YOUR shots did, which is the information you earned; how much a
   * stranger has left is theirs.
   */
  setNameplate(name: string): void {
    if (name === this.lastName) return;
    this.lastName = name;

    const ctx = this.nameCanvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 256, 64);

    ctx.font = "bold 26px Inter, Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(0,0,0,.85)";
    ctx.strokeText(name, 128, 34);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(name, 128, 34);

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
    crouchTarget = 0,
  ): void {
    const moveClip = speed > 4.5 ? "run" : speed > 0.4 ? (this.actions.has("walk") ? "walk" : "run") : "idle";
    const next = this.actions.get(!grounded ? "jump" : moveClip);
    if (next && next !== this.currentAction) {
      next.reset().fadeIn(.18).play();
      this.currentAction?.fadeOut(.18);
      this.currentAction = next;
    }
    this.mixer?.update(dt);

    if (this.mixer) {
      this.crouch += (crouchTarget - this.crouch) * (1 - Math.exp(-14 * dt));
      const crouch = this.crouch < 0.001 ? 0 : this.crouch;
      this.root.position.set(x, y + (CROUCH_HIP_Y - LEG_H) * crouch, z);
      this.root.rotation.y = -yaw;
      this.kick = Math.max(0, this.kick - dt);
      this.muzzle.visible = this.weaponId !== W_PICKAXE && this.kick > 0.045;
      const spine = this.root.getObjectByName("mixamorigSpine1") || this.root.getObjectByName("mixamorigSpine");
      if (spine) spine.rotation.x = -pitch * 0.55;
      const head = this.root.getObjectByName("mixamorigHead");
      if (head) head.rotation.x = -pitch * 0.35;
      this.nameplate.position.y = PLAYER_HEIGHT + 0.42;
      return;
    }
    // Track the stance. The simulation already shrinks the collision capsule
    // and drops the eye; without this the model stayed bolt upright, so
    // crouching looked like it did nothing at all.
    this.crouch += (crouchTarget - this.crouch) * (1 - Math.exp(-14 * dt));
    const crouch = this.crouch < 0.001 ? 0 : this.crouch;
    this.root.position.set(x, y, z);
    // The model faces +Z at yaw 0, matching forwardVector in shared/vec.ts.
    this.root.rotation.y = -yaw;

    this.head.rotation.x = -pitch * 0.55;
    this.kick = Math.max(0,this.kick-dt);
    this.muzzle.visible = this.weaponId!==W_PICKAXE&&this.kick>.045;
    this.pickaxe.rotation.x=-pitch+(this.kick>0?Math.sin((.35-this.kick)/.35*Math.PI)*1.6:0);
    this.gun.rotation.x = -pitch - this.kick*1.2;

    const moving = speed > 0.6;
    if (moving && grounded) {
      this.phase += dt * speed * 2.1;
    } else {
      // Ease the limbs back to neutral instead of snapping.
      this.phase += dt * 2.0;
    }

    const swing = moving && grounded ? Math.sin(this.phase) * Math.min(0.85, speed * 0.13) : 0;
    this.armL.rotation.x = -1.05-pitch*.8-swing*.1;
    this.armR.rotation.x = -.8-pitch*.8+swing*.1;

    // Idle breathing, and a slight bob while running.
    const bob = moving && grounded ? Math.abs(Math.sin(this.phase)) * 0.035 : Math.sin(this.phase * 0.5) * 0.012;

    // --- crouch pose ---------------------------------------------------------
    //
    // Drop the hip and let the knee take up the slack, then lean the torso
    // over it. The legs fold; they do not shrink. The lean is what makes the
    // silhouette read as a crouch from across the map, which is the whole
    // point of a stance that also shrinks your hitbox.
    const hipY = LEG_H + (CROUCH_HIP_Y - LEG_H) * crouch;
    const lean = crouch * CROUCH_LEAN;

    // Where the foot has to end up, measured from the hip. Straight down while
    // standing; as the hip falls the same foot is closer, and the knee bends by
    // however much that costs.
    const { hipBend, kneeBend } = legPose(hipY);
    const left = walkingLegPose(hipY, swing);
    const right = walkingLegPose(hipY, -swing);

    this.hipL.position.y = hipY;
    this.hipR.position.y = hipY;
    // A positive rotation about X swings the limb BACKWARD (the model faces
    // +Z), so the forward reach of the knee is negative.
    this.hipL.rotation.x = left.hip;
    this.hipR.rotation.x = right.hip;
    // The trailing leg lifts its heel, which is most of what sells a walk.
    this.kneeL.rotation.x = left.knee;
    this.kneeR.rotation.x = right.knee;
    this.levelFeet();

    if (!grounded) {
      // Tuck in the air so a jump is legible from across the map.
      this.hipL.rotation.x = -0.5 - hipBend * 0.4;
      this.hipR.rotation.x = -0.25 - hipBend * 0.4;
      this.kneeL.rotation.x = Math.max(kneeBend, 0.95);
      this.kneeR.rotation.x = Math.max(kneeBend, 0.55);
      this.armL.rotation.x = -0.9;
      this.levelFeet();
    }

    this.torso.rotation.x = lean;
    this.torso.position.y = hipY + Math.cos(lean) * TORSO_H / 2 + bob;
    this.torso.position.z = Math.sin(lean) * TORSO_H / 2;

    // Everything above the waist hangs off the shoulder line, which the lean
    // moves. Arms and the weapon are siblings of the torso rather than
    // children of it, so they have to be carried down explicitly or they float
    // at standing height over a crouched body.
    const shoulderY = hipY + Math.cos(lean) * TORSO_H + bob;
    const shoulderZ = Math.sin(lean) * TORSO_H;

    this.head.rotation.x = -pitch * 0.55;
    this.head.position.y = shoulderY;
    this.head.position.z = shoulderZ;

    this.armL.position.set(-0.32, shoulderY - 0.04, shoulderZ);
    this.armR.position.set(0.32, shoulderY - 0.04, shoulderZ);
    this.gun.position.set(-0.28, shoulderY - 0.18, shoulderZ + 0.3 - this.kick);
    this.pickaxe.position.set(-0.3, shoulderY - 0.3, shoulderZ + 0.4);

    // Keep the nameplate just above the head, wherever the head now is.
    this.nameplate.position.y = shoulderY + HEAD_H + 0.45;
  }

  /** Cancel the leg's accumulated pitch at the ankle, so the sole stays
   *  parallel to the ground however far the knee has folded. */
  private levelFeet(): void {
    this.footL.rotation.x = -(this.hipL.rotation.x + this.kneeL.rotation.x);
    this.footR.rotation.x = -(this.hipR.rotation.x + this.kneeR.rotation.x);
  }

  dispose(scene: THREE.Scene): void {
    this.mixer?.stopAllAction();
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
/**
 * Fold a leg so its foot lands on the ground with the hip at `hipY`.
 *
 * A plain two-link solve. `hipBend` is how far the thigh swings forward off
 * the straight hip-to-foot line, `kneeBend` how far the shin folds back under
 * it; applying one at the hip and the other at the knee puts the ankle
 * directly below the hip at y = 0 for any reachable hip height.
 *
 * Exported because it is the only real maths in this file and it is what
 * decides whether a crouching player's feet end up through the floor. See
 * tests/crouch.test.ts.
 */
export function legPose(hipY: number): { hipBend: number; kneeBend: number } {
  // clamp() absorbs the floating-point overshoot at full extension, so reach
  // needs no epsilon of its own at the top -- and must not have one, or a
  // standing leg carries a permanent degree and a half of knee bend.
  const reach = Math.max(Math.abs(THIGH_H - SHIN_H) + 1e-3, Math.min(LEG_H, hipY));
  return {
    hipBend: Math.acos(clamp(
      (THIGH_H * THIGH_H + reach * reach - SHIN_H * SHIN_H) / (2 * THIGH_H * reach))),
    kneeBend: Math.PI - Math.acos(clamp(
      (THIGH_H * THIGH_H + SHIN_H * SHIN_H - reach * reach) / (2 * THIGH_H * SHIN_H))),
  };
}

export function walkingLegPose(hipY: number, swing: number): { hip: number; knee: number } {
  const { hipBend, kneeBend } = legPose(hipY);
  return { hip: swing - hipBend, knee: kneeBend + Math.max(0, swing) * 0.9 };
}

function clamp(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

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
