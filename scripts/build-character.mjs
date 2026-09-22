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

// Animation files to extract and their target clip names
const animConfigs = [
  { file: 'rifle aiming idle.fbx', name: 'idle', inPlace: true },
  { file: 'rifle run.fbx', name: 'run', inPlace: true },
  { file: 'rifle jump.fbx', name: 'jump', inPlace: false },
  { file: 'walking.fbx', name: 'walk', inPlace: true },
  { file: 'firing rifle.fbx', name: 'fire', inPlace: true },
  { file: 'reloading.fbx', name: 'reload', inPlace: true },
  { file: 'run backwards.fbx', name: 'run_back', inPlace: true },
  { file: 'strafe left.fbx', name: 'strafe_left', inPlace: true },
  { file: 'strafe right.fbx', name: 'strafe_right', inPlace: true },
  { file: 'hit reaction.fbx', name: 'hit', inPlace: true },
];

const clips = [];
const animDir = "mixamo downloads/Basic Shooter Pack";

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
            values[i + 1] = track.values[i + 1]; // keep original bone-space vertical bob
            values[i + 2] = 0; // zero out forward/backward translation
          } else {
            values[i] = track.values[i];
            values[i + 1] = track.values[i + 1];
            values[i + 2] = track.values[i + 2];
          }
        }
        newTracks.push(new THREE.VectorKeyframeTrack(track.name, track.times, values));
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
