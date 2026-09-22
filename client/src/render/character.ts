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
 * A pose, as rotation OFFSETS in radians applied on top of the playing clip.
 *
 * Offsets, never assignments, and that distinction is the whole reason this
 * type exists. A Mixamo bone carries its rest orientation in its own rotation
 * (the exporter bakes each joint's preRotation into it), so `bone.rotation.x =
 * v` does not "set the shoulder angle" -- it throws the skeleton's bind pose
 * away and replaces it with a single Euler angle about an axis that has
 * nothing to do with the joint. That is what the slide pose was doing, and it
 * is why a player who pressed crouch at speed arched backwards over their own
 * spine instead of dropping onto a knee. Adding leaves the rig, and whatever
 * animation is playing through it, intact underneath.
 *
 * Every number below was measured against the rig rather than guessed: the
 * dev fixture at /playtest.html reports each bone's world position, and these
 * are the values that put the sliding knee and the crouching toes on the floor
 * and keep the head inside the collision capsule.
 */
type BoneOffsets = ReadonlyArray<readonly [name: string, x: number, y: number, z: number]>;

/** How long the landing take runs for. Matches the trimmed clip's length. */
const LAND_HOLD_S = 0.68;

/** How far the hip drops, in metres, at a full crouch and in a slide. Paired
 *  with the poses: change one without the other and the feet leave the floor. */
const CROUCH_DROP = -0.32;
/** Zero: the slide clip lowers its own hips, so the root must not lower them
 *  again. The hand-built slide pose this replaced had no such track and needed
 *  the whole drop from here. */
const SLIDE_DROP = 0;

/** Knees bent, weight back, torso closed down over the weapon. Head lands at
 *  about CROUCH_HEIGHT, so the silhouette matches the shrunken capsule. */
const CROUCH_POSE: BoneOffsets = [
  ["mixamorigLeftUpLeg", -0.85, 0, 0],
  ["mixamorigLeftLeg", -1.10, 0, 0],
  ["mixamorigLeftFoot", 0.75, 0, 0],
  ["mixamorigRightUpLeg", -0.85, 0, 0],
  ["mixamorigRightLeg", -1.10, 0, 0],
  ["mixamorigRightFoot", 0.75, 0, 0],
  ["mixamorigSpine1", 0.22, 0, 0],
  ["mixamorigHead", -0.15, 0, 0],
];



/** A hurdle: leading knee driven up and through, trailing leg tucked in
 *  behind it, chest folded down over the obstacle, free hand pushed down to
 *  where it would be planted on the top of it. */
const VAULT_POSE: BoneOffsets = [
  ["mixamorigSpine1", 0.55, 0, 0],
  ["mixamorigHead", -0.35, 0, 0],
  ["mixamorigLeftUpLeg", -1.25, 0, 0],
  ["mixamorigLeftLeg", -0.60, 0, 0],
  ["mixamorigRightUpLeg", 0.20, 0, 0],
  ["mixamorigRightLeg", -1.60, 0, 0],
  ["mixamorigLeftArm", 0.50, 0, -0.40],
  ["mixamorigLeftForeArm", -0.30, 0, 0],
  ["mixamorigRightArm", -0.30, 0, 0],
];

/** Clips that play once and hold their last frame rather than looping. */
const ONE_SHOT_CLIPS = new Set(["slide", "land", "death", "climb"]);

/**
 * Seconds of a take that are actually usable, for the ones that are not.
 *
 * "Running Slide" is a complete performance: three strides of a run, a drop
 * into a baseball slide that ends almost flat on the character's back, and a
 * recovery back to standing -- 1.53 seconds of it. A slide in this game lasts
 * as long as the player's momentum does and has to hold a pose the whole time,
 * so playing the take is wrong twice over: it loops back to running, and its
 * deepest frame puts the head at 46 cm when the collision capsule it is
 * supposed to fill is 1.15 m tall.
 *
 * The window below is the entry and the seated part of the slide only, which
 * holds a knee-down pose with the head around 0.95 m -- inside the capsule,
 * and the shape a player expects from a slide. The rest of the take is cut.
 */
const CLIP_WINDOW: Record<string, readonly [number, number]> = {
  slide: [0.10, 0.24],
  // "Falling To Landing" is a quarter second of falling, an impact that takes
  // the hips from 0.89 m down to 0.56, and a recovery. It is triggered on
  // touchdown, so the falling quarter has already happened.
  land: [0.27, 0.95],
  // "Knocked Out" stands still for a second and a half before it collapses.
  // Nobody wants to watch that after being shot.
  death: [1.60, 2.90],
};

/**
 * The ground speed each locomotion clip looks natural at, in m/s./**
 * The ground speed each locomotion clip looks natural at, in m/s.
 *
 * Every clip is in place, so nothing about the animation itself says how fast
 * the character is travelling -- the playback rate is the only thing that
 * couples the feet to the ground. These are the speeds at which each take
 * plays at 1x; the ratio of the real speed to this drives timeScale.
 *
 * Clips not listed here (idle, jump, slide, climb, land, death) are events
 * rather than locomotion and always play at their authored rate.
 */
const CLIP_SPEED: Record<string, number> = {
  walk: 3.0,
  run: 7.0,
  walk_back: 3.0,
  run_back: 6.0,
  strafe_left: 5.0,
  strafe_right: 5.0,
};

/**
 * Every bone any pose layer writes to.
 *
 * The union of the tables above plus the arm and spine bones the aim and look
 * layers touch. It exists so restoreClipPose knows exactly which bones have to
 * have the clip's output put back before the mixer runs; a bone that is bent
 * but missing from here winds itself up, which is the whole failure this list
 * prevents.
 */
const POSED_BONES: readonly string[] = [...new Set([
  ...CROUCH_POSE, ...VAULT_POSE,
].map(([name]) => name).concat([
  "mixamorigRightArm", "mixamorigLeftArm", "mixamorigSpine1", "mixamorigHead",
]))];

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
  private blueprint = new THREE.Group();
  private weaponId = -1;
  private nameplate: THREE.Sprite;
  private nameCanvas: HTMLCanvasElement;
  private nameTexture: THREE.CanvasTexture;

  private phase = 0;
  /** Blend weights for the three posed states, 0-1. */
  private slideMix = 0;
  private mantleMix = 0;
  private vaultMix = 0;
  /** Seconds left of the landing clip, and last frame's stance, so the
   *  touchdown can be spotted here rather than plumbed in from the caller. */
  private landHold = 0;
  private wasGrounded = true;
  /** getObjectByName walks the whole hierarchy; the rig has 67 bones and the
   *  poses below ask for a dozen of them every frame, per character. */
  private boneCache = new Map<string, THREE.Object3D | null>();
  /** The clip's own output for each posed bone, before this frame's offsets.
   *  See restoreClipPose -- without it the offsets compound. */
  private clipPose = new Map<THREE.Object3D, THREE.Quaternion>();
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
        art.traverse(node => {
          if (!(node instanceof THREE.Mesh)) return;
          node.castShadow = true;
          node.receiveShadow = true;
          for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
            if (mat instanceof THREE.MeshStandardMaterial) {
              if (mat.name === "Armor") mat.color.setHex(skin.colors.primary);
              if (mat.name === "Suit") mat.color.setHex(skin.colors.secondary);
              if (mat.name === "Accent") mat.color.setHex(skin.colors.accent);
              if (node.name.startsWith("visor")) {
                mat.color.setHex(skin.colors.visor);
                mat.roughness = 0.18;
                mat.metalness = 0.65;
              }
            }
          }
        });
        this.root.add(art);
      } else {
        const rightHand = art.getObjectByName("mixamorigRightHand") || art.getObjectByName("RightHand");
        if (rightHand) {
          this.root.remove(this.gun);
          this.root.remove(this.pickaxe);
          const hand = handSocket(art, rightHand);
          hand.add(this.gun);
          hand.add(this.pickaxe);
          this.gun.position.set(0.02, 0.08, 0.0);
          this.gun.rotation.set(-1.626, -0.027, -1.690);
          this.pickaxe.position.set(0.02, 0.08, 0.0);
          this.pickaxe.rotation.set(-1.626, -0.027, -1.690);
        }

        const leftHand = art.getObjectByName("mixamorigLeftHand") || art.getObjectByName("LeftHand");
        this.blueprint = createBlueprintModel();
        this.blueprint.visible = false;
        if (leftHand) {
          handSocket(art, leftHand).add(this.blueprint);
          this.blueprint.position.set(-0.04, 0.12, 0.05);
          this.blueprint.rotation.set(1.4, 0.2, -1.2);
        } else {
          this.root.add(this.blueprint);
          this.blueprint.position.set(-0.25, 1.25, 0.35);
        }

        const texLoader = new THREE.TextureLoader();
        const bodyTex = texLoader.load('/textures/character/body_diffuse.jpg');
        bodyTex.colorSpace = THREE.SRGBColorSpace;
        const headTex = texLoader.load('/textures/character/head_diffuse.jpg');
        headTex.colorSpace = THREE.SRGBColorSpace;

        art.traverse(node => {
          if (node instanceof THREE.SkinnedMesh) {
            node.frustumCulled = false;
          }
          if (!(node instanceof THREE.Mesh)) return;
          node.castShadow = true;
          node.receiveShadow = true;
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          mats.forEach((mat, idx) => {
            if (mat instanceof THREE.MeshStandardMaterial) {
              mat.color.setHex(0xffffff);
              mat.map = idx === 0 ? bodyTex : headTex;
              mat.roughness = 0.78;
              mat.metalness = 0.1;
              mat.needsUpdate = true;
            }
          });
        });
        this.root.add(art);
        this.mixer = new THREE.AnimationMixer(art);
        for (const source of models!.animations("character")) {
          const clip = trimToUsableRange(source);
          const action = this.mixer.clipAction(clip);
          if (ONE_SHOT_CLIPS.has(clip.name)) {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
          }
          this.actions.set(clip.name, action);
        }
        const idle = this.actions.get("idle");
        if (idle) {
          idle.play();
          this.currentAction = idle;
        }
      }
    }
    this.setNameplate(name);
  }

  setWeapon(id: number): void {
    if (this.weaponId === id && this.gunModel) return;
    this.weaponId = id;

    this.blueprint.visible = id === 255;
    this.pickaxe.visible = id === W_PICKAXE;
    this.gun.visible = id !== 255 && id !== W_PICKAXE;

    if (this.gunModel) {
      this.gun.remove(this.gunModel);
      disposeWeaponModel(this.gunModel);
      this.gunModel = null;
    }

    if (id === 255 || id === W_PICKAXE) return;

    const slots: Record<number, string> = { 0: "weapon_ar", 1: "weapon_shotgun", 2: "weapon_sniper", 3: "weapon_smg", 4: "weapon_pistol" };
    const imported = this.models?.get(slots[id] as import("./models").ModelId);
    this.gunModel = (imported as THREE.Group | null) ?? createWeaponModel(id);
    this.gun.add(this.gunModel);
  }
  fire(): void {
    this.kick = this.weaponId === W_PICKAXE ? .35 : .09;
    const fireAction = this.actions.get("fire");
    if (fireAction) {
      fireAction.reset().setLoop(THREE.LoopOnce, 1).play();
    }
  }
  aimAt(worldPoint: THREE.Vector3): void {
    if (!this.gun.visible) return;
    if (!this.mixer) {
      this.root.updateMatrixWorld(true);
      const local = this.root.worldToLocal(worldPoint.clone()).sub(this.gun.position).normalize();
      this.gun.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), local);
    }
  }
  setSkin(skinId: string): void {
    const skin: SkinDef = skinById(skinId);
    this.materials[0].color.setHex(skin.colors.primary);
    this.materials[1].color.setHex(skin.colors.secondary);
    this.materials[2].color.setHex(skin.colors.accent);
    this.materials[3].color.setHex(skin.colors.skin);
    this.materials[4].color.setHex(skin.colors.visor);
    this.root.traverse(node => {
      if (node instanceof THREE.Mesh) {
        for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
          if (mat instanceof THREE.MeshStandardMaterial) {
            if (mat.name === "Armor") mat.color.setHex(skin.colors.primary);
            if (mat.name === "Suit") mat.color.setHex(skin.colors.secondary);
            if (mat.name === "Accent") mat.color.setHex(skin.colors.accent);
            if (node.name.startsWith("visor")) {
              mat.color.setHex(skin.colors.visor);
            }
          }
        }
      }
    });
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
    sliding = false,
    aiming = false,
    mantling = false,
    vaulting = false,
    /** Direction of travel in the player's own frame: +1 forward, -1 back,
     *  and +1 strafe is to their right. Picks the locomotion clip. */
    forward = 1,
    strafe = 0,
    alive = true,
  ): void {
    // A vault is a tick or two of simulation: long enough to put the player on
    // the other side of a crate, far too short to see at any frame rate. Both
    // climbs are latched for a moment so the move reads as a move rather than
    // as a flicker of the run cycle.
    // Touching down plays the landing take, but only when the player is not
    // already running it off: interrupting a sprint to absorb a 30 cm hop
    // looks worse than not animating the landing at all.
    if (grounded && !this.wasGrounded && speed < 4 && this.actions.has("land")) {
      this.landHold = LAND_HOLD_S;
    } else if (!grounded) {
      this.landHold = 0;
    } else {
      this.landHold = Math.max(0, this.landHold - dt);
    }
    this.wasGrounded = grounded;
    const isClimbing = (mantling || vaulting) && !grounded && this.actions.has("climb");
    const showVault = vaulting && !isClimbing;
    const showMantle = mantling && !isClimbing;
    // Only the states without a clip of their own still need a built pose on
    // top of a still one; the rest are animations now.
    const posed = showVault;
    const clip = this.pickClip(
      speed, grounded, sliding, showMantle, showVault, alive, forward, strafe,
      this.landHold > 0,
    );
    const next = this.actions.get(clip) ?? this.actions.get("idle");
    if (next && next !== this.currentAction) {
      const isEnteringClimb = clip === "climb";
      const isLeavingClimb = this.currentAction?.getClip().name === "climb";
      const fadeInTime = (isEnteringClimb || isLeavingClimb) ? 0.06 : 0.18;
      next.reset().fadeIn(fadeInTime).play();
      this.currentAction?.fadeOut(fadeInTime);
      this.currentAction = next;
    }
    if (this.currentAction) {
      // Locomotion clips are all in place, so the only thing that makes the
      // feet keep up with the ground is the playback rate. Each one names the
      // pace it was authored at and is played at the ratio of the real speed
      // to that -- which is what stops a sprint (12.25 m/s) reading as a jog
      // with the world sliding underneath it, and stops a crouch-walk (3.6)
      // reading as a scramble.
      const nominal = posed || isClimbing ? 0 : CLIP_SPEED[clip] ?? 0;
      this.currentAction.timeScale = nominal > 0
        ? Math.max(0.6, Math.min(2.0, speed / nominal)) : 1;
    }
    this.restoreClipPose();
    this.mixer?.update(dt);
    this.captureClipPose();

    if (this.mixer) {
      this.crouch += (crouchTarget - this.crouch) * (1 - Math.exp(-14 * dt));
      const crouch = this.crouch < 0.001 ? 0 : this.crouch;
      // Each posed state gets its own blend, so entering and leaving one is a
      // quick ease rather than the snap an if/else gives you.
      const mixStep = 1 - Math.exp(-16 * dt);
      this.slideMix += ((sliding ? 1 : 0) - this.slideMix) * mixStep;
      this.mantleMix += ((showMantle ? 1 : 0) - this.mantleMix) * mixStep;
      this.vaultMix += ((showVault ? 1 : 0) - this.vaultMix) * mixStep;
      const slide = this.slideMix < 0.001 ? 0 : this.slideMix;
      const mantle = this.mantleMix < 0.001 ? 0 : this.mantleMix;
      const vault = this.vaultMix < 0.001 ? 0 : this.vaultMix;

      // Crouch folds the legs rather than shrinking them, so the hip has to
      // come down by the amount the fold actually costs. The slide clip lowers
      // its own hips, so it only needs the difference between where the clip
      // puts them and the floor.
      const drop = SLIDE_DROP * slide + CROUCH_DROP * crouch * (1 - slide);
      this.root.position.set(x, y + drop, z);
      this.root.rotation.y = -yaw;
      this.kick = Math.max(0, this.kick - dt);
      this.muzzle.visible = this.weaponId !== W_PICKAXE && this.weaponId !== 255 && this.kick > 0.045;

      // Weapon down at the hip unless actually aiming.
      if (!aiming && this.weaponId !== 255) {
        this.bend("mixamorigRightArm", 0.38);
        this.bend("mixamorigLeftArm", 0.30);
      }

      // Sliding and mantling have clips of their own now, so only crouch and
      // the vault are still built by hand. Crouch is faded out under all three
      // so its knee bend does not fight an animation that has its own.
      this.applyPose(CROUCH_POSE, crouch * (1 - slide) * (1 - mantle) * (isClimbing ? 0 : (1 - vault)));
      this.applyPose(VAULT_POSE, isClimbing ? 0 : vault);

      // Spine and head follow the camera, but only as far as the pose leaves
      // room for: a climb is already looking up at the ledge and a slide is
      // already leaning back, and adding the view pitch on top of either is
      // what used to bend the character double.
      const look = (1 - slide) * (isClimbing ? 0.1 : 1);
      if (look > 0.001) {
        this.bend("mixamorigSpine1", -pitch * 0.65 * look);
        this.bend("mixamorigHead", -pitch * 0.35 * look);
      }

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
    this.armL.rotation.x = -1.05 - pitch * 0.8 - swing * 0.1;
    this.armR.rotation.x = -0.8 - pitch * 0.8 + swing * 0.1;

    if (sliding) {
      this.armL.rotation.x = -0.4;
      this.armR.rotation.x = -0.4;
    }
    if (aiming && this.weaponId !== 255) {
      this.armL.rotation.x = -1.35 - pitch * 0.9;
      this.armR.rotation.x = -1.25 - pitch * 0.9;
    }
    if (mantling) {
      this.armL.rotation.x = -2.2;
      this.armR.rotation.x = -2.2;
    }

    // Idle breathing, and a slight bob while running.
    const bob = moving && grounded ? Math.abs(Math.sin(this.phase)) * 0.035 : Math.sin(this.phase * 0.5) * 0.012;

    // --- crouch pose ---------------------------------------------------------
    //
    // Drop the hip and let the knee take up the slack, then lean the torso
    // over it. The legs fold; they do not shrink. The lean is what makes the
    // silhouette read as a crouch from across the map, which is the whole
    // point of a stance that also shrinks your hitbox.
    const hipY = LEG_H + (CROUCH_HIP_Y - LEG_H) * crouch;
    const lean = crouch * CROUCH_LEAN + (sliding ? 0.35 : 0);

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
    this.hipL.rotation.x = sliding ? -1.15 : left.hip;
    this.hipR.rotation.x = sliding ? -1.15 : right.hip;
    // The trailing leg lifts its heel, which is most of what sells a walk.
    this.kneeL.rotation.x = sliding ? 1.55 : left.knee;
    this.kneeR.rotation.x = sliding ? 1.55 : right.knee;
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

  private bone(name: string): THREE.Object3D | null {
    let found = this.boneCache.get(name);
    if (found === undefined) {
      found = this.root.getObjectByName(name) ?? null;
      this.boneCache.set(name, found);
    }
    return found;
  }

  /**
   * Which clip should be playing.
   *
   * Ordered by how much the state overrides everything else: being dead, then
   * the two climbs, then a slide, then being airborne, then ordinary
   * locomotion. Direction matters for the last one -- the rig has backwards
   * and strafing takes and they were being ignored, so a player retreating or
   * side-stepping ran forwards on the spot while travelling the other way.
   */
  private pickClip(
    speed: number, grounded: boolean, sliding: boolean,
    mantling: boolean, vaulting: boolean, alive: boolean,
    forward: number, strafe: number, landing: boolean,
  ): string {
    const has = (name: string) => this.actions.has(name);
    if (!alive && has("death")) return "death";
    if ((mantling || vaulting) && !grounded && has("climb")) return "climb";
    if (vaulting) return has("jump") ? "jump" : "idle";
    if (sliding && has("slide")) return "slide";
    if (!grounded) return has("jump") ? "jump" : "idle";
    if (landing) return "land";
    if (speed <= 0.4) return "idle";

    // Sideways only wins when it is clearly the dominant direction, so a
    // diagonal still runs rather than flickering between two clips.
    if (Math.abs(strafe) > Math.abs(forward) + 0.2) {
      const side = strafe > 0 ? "strafe_right" : "strafe_left";
      if (has(side)) return side;
    }
    if (forward < -0.2) {
      const back = speed > 4.5 ? "run_back" : "walk_back";
      if (has(back)) return back;
      if (has("run_back")) return "run_back";
    }
    if (speed > 4.5) return "run";
    return has("walk") ? "walk" : "run";
  }

  /**
   * Put every posed bone back to the clip's own output before the mixer runs.
   *
   * The pose layers add to whatever rotation a bone is carrying, which assumes
   * the mixer has just overwritten it with the clip's value. It has not,
   * always: AnimationMixer compares the value it is about to write against the
   * one it wrote last frame and SKIPS the write when they match --
   *
   *     if ( buffer[ i ] !== buffer[ i + stride ] ) { this.binding.setValue( … ); break; }
   *
   * -- which is a real optimisation for a rig where most bones are still, and
   * a trap for anything layering on top of it. A bone the clip holds constant
   * gets written exactly once, and every frame after that the offset lands on
   * the previous frame's result instead of on the clip's. The walk clip holds
   * the head bone constant, so crouch-walking wound the head a sixth of a
   * radian further round its neck every frame -- about nine turns a second.
   *
   * So the clip's output is remembered per bone and put back first. A write
   * the mixer skips then leaves the correct value in place rather than last
   * frame's, and one it does perform overwrites it as usual.
   */
  private restoreClipPose(): void {
    for (const [bone, quaternion] of this.clipPose) bone.quaternion.copy(quaternion);
  }

  /** Remember what the clip left on each posed bone, offsets not yet applied. */
  private captureClipPose(): void {
    for (const name of POSED_BONES) {
      const bone = this.bone(name);
      if (!bone) continue;
      const saved = this.clipPose.get(bone);
      if (saved) saved.copy(bone.quaternion);
      else this.clipPose.set(bone, bone.quaternion.clone());
    }
  }

  /** Add to a bone's rotation. Never assign: see BoneOffsets. */
  private bend(name: string, x: number, y = 0, z = 0): void {
    const bone = this.bone(name);
    if (!bone) return;
    bone.rotation.x += x;
    bone.rotation.y += y;
    bone.rotation.z += z;
  }

  /** Lay a pose over the playing clip at `mix` strength. */
  private applyPose(pose: BoneOffsets, mix: number): void {
    if (mix < 0.001) return;
    for (const [name, x, y, z] of pose) this.bend(name, x * mix, y * mix, z * mix);
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
 * A child of `bone` that props are parented to, in METRES.
 *
 * The Mixamo rig is authored in centimetres and carries a 0.01 scale on its
 * root, so every bone inherits it. Parenting a weapon straight onto the hand
 * bone therefore drew it at a hundredth of its size -- a 0.86 m rifle became
 * 8.6 mm, which is why the guns "disappeared" the moment they were moved into
 * the character's hand: they were in exactly the right place, and about as big
 * as a grain of rice. This cancels the inherited scale, so everything hung off
 * it can be positioned and sized in the same units as the rest of the game.
 */
function handSocket(art: THREE.Object3D, bone: THREE.Object3D): THREE.Object3D {
  art.updateMatrixWorld(true);
  const scale = bone.getWorldScale(new THREE.Vector3());
  const socket = new THREE.Group();
  socket.name = `${bone.name}_socket`;
  // Uniform in practice; guard a zero so a malformed rig cannot produce NaN.
  socket.scale.setScalar(1 / (Math.abs(scale.x) > 1e-9 ? scale.x : 1));
  bone.add(socket);
  return socket;
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

/**
 * Cut a clip down to CLIP_WINDOW, if it has one. Others pass straight through.
 *
 * Expressed in hundredths of a second (fps = 100) rather than in frames,
 * because what matters is where the performance is in time and the takes are
 * not all exported at the same rate.
 */
function trimToUsableRange(clip: THREE.AnimationClip): THREE.AnimationClip {
  const window = CLIP_WINDOW[clip.name];
  if (!window) return clip;
  const trimmed = THREE.AnimationUtils.subclip(
    clip, clip.name, Math.round(window[0] * 100), Math.round(window[1] * 100), 100,
  );
  // A window that caught no keyframes would silently drop the whole clip, so
  // fall back to the original rather than animating nothing.
  return trimmed.tracks.length > 0 ? trimmed : clip;
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

function createBlueprintModel(): THREE.Group {
  const g = new THREE.Group();
  const boardMat = new THREE.MeshStandardMaterial({
    color: 0x3e2723, roughness: 0.85, metalness: 0.1,
  });
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.36), boardMat);
  board.castShadow = true;
  g.add(board);

  const canvas = typeof document !== 'undefined' ? document.createElement("canvas") : null;
  if (canvas) {
    canvas.width = 256; canvas.height = 384;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#1565c0";
      ctx.fillRect(0, 0, 256, 384);
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= 256; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 384); ctx.stroke(); }
      for (let y = 0; y <= 384; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.strokeRect(32, 48, 192, 288);
      ctx.strokeRect(48, 64, 80, 100);
      ctx.strokeRect(144, 64, 64, 100);
      ctx.strokeRect(48, 180, 160, 130);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 15px monospace";
      ctx.fillText("CLUTCH ARCHITECT", 44, 34);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const paperMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.05 });
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.34), paperMat);
    paper.rotation.x = -Math.PI / 2;
    paper.position.y = 0.007;
    g.add(paper);
  }
  return g;
}
