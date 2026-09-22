import assert from 'node:assert/strict';
import * as THREE from 'three';
import { InstancedModel } from '../client/src/render/models';
// Meshopt/glTF quantization: a scaled mesh must not wrap signed integer storage.
const geometry=new THREE.BufferGeometry();
geometry.setAttribute('position',new THREE.Int16BufferAttribute([-32767,0,0,32767,0,0,0,32767,0],3,true));
geometry.setIndex([0,1,2]);geometry.computeVertexNormals();
const root=new THREE.Group();const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());
mesh.scale.set(6,12,6);mesh.position.set(0,2,0);root.add(mesh);
const batch=new InstancedModel(root,1);batch.setMatrixAt(0,new THREE.Matrix4());
const scene=new THREE.Scene();batch.addTo(scene);
const result=(scene.children[0] as THREE.InstancedMesh).geometry;
result.computeBoundingBox();assert.equal(result.boundingBox!.min.x,-6);assert.equal(result.boundingBox!.max.x,6);assert.equal(result.boundingBox!.max.y,14);
assert.ok(result.attributes.position.array instanceof Float32Array);
console.log('PASS: compressed model transforms preserve full tree dimensions.');
