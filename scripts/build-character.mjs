import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

// Node polyfills for Three.js loaders & exporters
globalThis.window = {
  URL: {
    createObjectURL() { return "data:image/png;base64,"; },
    revokeObjectURL() {}
  }
};
globalThis.document = {
  createElementNS() {
    return {
      src: "",
      addEventListener(e, fn) { if (e === "load") setTimeout(fn, 1); },
      removeEventListener() {},
      style: {}
    };
  },
  createElement() { return this.createElementNS(); }
};
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(v => { this.result = v; this.onloadend?.(); });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then(v => {
      this.result = `data:${blob.type};base64,${Buffer.from(v).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

console.log("Loading Mixamo character model...");
const charBuf = fs.readFileSync("mixamo downloads/Ch15_nonPBR.fbx");
const fbxLoader = new FBXLoader();
const charGroup = fbxLoader.parse(charBuf.buffer.slice(charBuf.byteOffset, charBuf.byteOffset + charBuf.byteLength), "");

// Sizing: Mixamo exports in centimeters (~180 cm). Game is in meters (~1.8m).
charGroup.scale.setScalar(0.01);
charGroup.updateMatrixWorld(true);

// Replace materials with clean PBR materials for WebGL performance and lighting integration
charGroup.traverse(node => {
  if (node.isMesh) {
    node.castShadow = true;
    node.receiveShadow = true;
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x364856, // spec-ops suit
      roughness: 0.75,
      metalness: 0.15,
      name: "Armor",
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x222a30, // tactical armor plate
      roughness: 0.85,
      metalness: 0.1,
      name: "Suit",
    });
    node.material = [bodyMat, accentMat];
  }
});

// Animation files to extract and their target clip names. Paths are relative
// to the downloads directory, so the pack's own folder and the loose exports
// alongside it are listed the same way.
//
// Everything is inPlace except the jump: the simulation owns the player's
// position, so a clip that walks its own root away from the body's collision
// capsule desyncs the model from the thing you can actually shoot. The jump is
// the exception because its vertical travel is the animation.
const animConfigs = [
  { file: 'Basic Shooter Pack/rifle aiming idle.fbx', name: 'idle', inPlace: true },
  { file: 'Basic Shooter Pack/rifle run.fbx', name: 'run', inPlace: true },
  { file: 'Basic Shooter Pack/rifle jump.fbx', name: 'jump', inPlace: false },
  { file: 'Basic Shooter Pack/walking.fbx', name: 'walk', inPlace: true },
  { file: 'Basic Shooter Pack/firing rifle.fbx', name: 'fire', inPlace: true },
  { file: 'Basic Shooter Pack/reloading.fbx', name: 'reload', inPlace: true },
  { file: 'Basic Shooter Pack/run backwards.fbx', name: 'run_back', inPlace: true },
  { file: 'Basic Shooter Pack/walking backwards.fbx', name: 'walk_back', inPlace: true },
  { file: 'Basic Shooter Pack/strafe left.fbx', name: 'strafe_left', inPlace: true },
  { file: 'Basic Shooter Pack/strafe right.fbx', name: 'strafe_right', inPlace: true },
  { file: 'Basic Shooter Pack/hit reaction.fbx', name: 'hit', inPlace: true },
  // Loose exports. These carry the whole character as well as the take, which
  // is why they are 115 MB each; only the animation is read out of them.
  { file: 'Running Slide.fbx', name: 'slide', inPlace: true },
  { file: 'Falling To Landing.fbx', name: 'land', inPlace: true },
  // lockY as well: a ladder climb raises its own root half a metre over its
  // 0.77 s, and the solver already owns the player's height while mantling --
  // played as authored the two rises compound and the body leaves the capsule.
  // rotateY rotates 180 degrees so the character faces the wall/ladder.
  { file: 'Climbing Ladder.fbx', name: 'climb', inPlace: true, lockY: true, rotateY: Math.PI },
  { file: 'Knocked Out.fbx', name: 'death', inPlace: true },
];

const clips = [];
const animDir = "mixamo downloads";

for (const config of animConfigs) {
  const filePath = path.join(animDir, config.file);
  if (!fs.existsSync(filePath)) {
    console.warn(`Animation file not found: ${filePath}`);
    continue;
  }
  const animBuf = fs.readFileSync(filePath);
  const animGroup = fbxLoader.parse(animBuf.buffer.slice(animBuf.byteOffset, animBuf.byteOffset + animBuf.byteLength), "");
  if (animGroup.animations && animGroup.animations.length > 0) {
    const rawClip = animGroup.animations[0];
    const newTracks = [];

    for (const track of rawClip.tracks) {
      if (track.name.endsWith('.position')) {
        const values = new Float32Array(track.values.length);
        for (let i = 0; i < track.values.length; i += 3) {
          if (config.inPlace && track.name.includes('Hips')) {
            values[i] = 0; // zero out lateral translation drift
            // Vertical is kept by default: for a slide, a landing or a
            // collapse the drop IS the animation. lockY pins it to the take's
            // own first frame for the clips where the game drives height.
            values[i + 1] = config.lockY ? track.values[1] : track.values[i + 1];
            values[i + 2] = 0; // zero out forward/backward translation
          } else {
            values[i] = track.values[i];
            values[i + 1] = track.values[i + 1];
            values[i + 2] = track.values[i + 2];
          }
        }
        newTracks.push(new THREE.VectorKeyframeTrack(track.name, track.times, values));
      } else if (track.name.endsWith('.quaternion') && config.rotateY && track.name.includes('Hips')) {
        const qRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), config.rotateY);
        const values = new Float32Array(track.values.length);
        const q = new THREE.Quaternion();
        for (let i = 0; i < track.values.length; i += 4) {
          q.set(track.values[i], track.values[i + 1], track.values[i + 2], track.values[i + 3]);
          q.premultiply(qRot);
          values[i] = q.x;
          values[i + 1] = q.y;
          values[i + 2] = q.z;
          values[i + 3] = q.w;
        }
        newTracks.push(new THREE.QuaternionKeyframeTrack(track.name, track.times, values));
      } else {
        newTracks.push(track);
      }
    }

    const processedClip = new THREE.AnimationClip(config.name, rawClip.duration, newTracks);
    clips.push(processedClip);
    console.log(`Added animation clip: "${config.name}" (duration: ${rawClip.duration.toFixed(2)}s, ${newTracks.length} tracks)`);
  }
}

console.log(`Exporting rigged character with ${clips.length} animation clips to GLB...`);
const exporter = new GLTFExporter();
const glbData = await exporter.parseAsync(charGroup, {
  binary: true,
  animations: clips,
});

const outPath = "client/public/models/player.glb";
fs.writeFileSync(outPath, Buffer.from(glbData));
console.log(`Exported uncompressed GLB: ${(glbData.byteLength / 1024 / 1024).toFixed(2)} MB`);

console.log("Optimizing with Meshopt...");
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const doc = await io.read(outPath);
await doc.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: "high" }));
await io.write(outPath, doc);
const stats = fs.statSync(outPath);
console.log(`Successfully generated optimized ${outPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
