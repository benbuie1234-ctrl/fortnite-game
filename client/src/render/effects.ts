import * as THREE from "three";

const TRACER_COUNT = 48;
const TRACER_LIFE = 0.085;
const IMPACT_COUNT = 32;
const IMPACT_LIFE = 0.32;

/**
 * Pooled hit-scan visuals. Everything is allocated up front: a shotgun blast
 * spawns nine tracers at once and we never want that to trigger a GC pause
 * mid-fight.
 */
export class Effects {
  private tracers: THREE.Mesh[] = [];
  private tracerLife: number[] = [];
  private impacts: THREE.Mesh[] = [];
  private impactLife: number[] = [];
  private nextTracer = 0;
  private nextImpact = 0;

  constructor(scene: THREE.Scene) {
    // A unit-length cylinder along +Y, scaled and oriented per shot.
    const tracerGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 5, 1, true);
    tracerGeo.translate(0, 0.5, 0);

    for (let i = 0; i < TRACER_COUNT; i++) {
      const mesh = new THREE.Mesh(
        tracerGeo,
        new THREE.MeshBasicMaterial({
          color: 0xfff0b0, transparent: true, opacity: 0, depthWrite: false,
        }),
      );
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push(mesh);
      this.tracerLife.push(0);
    }

    const impactGeo = new THREE.SphereGeometry(0.085, 6, 4);
    for (let i = 0; i < IMPACT_COUNT; i++) {
      const mesh = new THREE.Mesh(
        impactGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false,
        }),
      );
      mesh.visible = false;
      scene.add(mesh);
      this.impacts.push(mesh);
      this.impactLife.push(0);
    }
  }

  breakBurst(x:number,y:number,z:number):void {
    for(let i=0;i<12;i++) this.spawnImpact(x+(Math.random()-.5)*2,y+(Math.random()-.5)*2,z+(Math.random()-.5)*2);
  }

  spawnTracer(
    ox: number, oy: number, oz: number,
    ex: number, ey: number, ez: number,
    color = 0xfff0b0,
  ): void {
    const mesh = this.tracers[this.nextTracer];
    this.tracerLife[this.nextTracer] = TRACER_LIFE;
    this.nextTracer = (this.nextTracer + 1) % TRACER_COUNT;

    const dx = ex - ox, dy = ey - oy, dz = ez - oz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return;

    mesh.position.set(ox, oy, oz);
    // The geometry runs along +Y, so aim it by rotating that axis onto the shot.
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(dx / len, dy / len, dz / len),
    );
    mesh.scale.set(1, len, 1);
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.9;
    mesh.visible = true;
  }

  spawnImpact(x: number, y: number, z: number, color = 0xffd27a): void {
    const mesh = this.impacts[this.nextImpact];
    this.impactLife[this.nextImpact] = IMPACT_LIFE;
    this.nextImpact = (this.nextImpact + 1) % IMPACT_COUNT;

    mesh.position.set(x, y, z);
    mesh.scale.setScalar(1);
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
    mesh.visible = true;
  }

  update(dt: number): void {
    for (let i = 0; i < TRACER_COUNT; i++) {
      if (this.tracerLife[i] <= 0) continue;
      this.tracerLife[i] -= dt;
      const mat = this.tracers[i].material as THREE.MeshBasicMaterial;
      if (this.tracerLife[i] <= 0) {
        this.tracers[i].visible = false;
        mat.opacity = 0;
      } else {
        mat.opacity = 0.9 * (this.tracerLife[i] / TRACER_LIFE);
      }
    }

    for (let i = 0; i < IMPACT_COUNT; i++) {
      if (this.impactLife[i] <= 0) continue;
      this.impactLife[i] -= dt;
      const mat = this.impacts[i].material as THREE.MeshBasicMaterial;
      const t = Math.max(0, this.impactLife[i] / IMPACT_LIFE);
      if (this.impactLife[i] <= 0) {
        this.impacts[i].visible = false;
        mat.opacity = 0;
      } else {
        mat.opacity = 0.95 * t;
        this.impacts[i].scale.setScalar(1 + (1 - t) * 1.8);
      }
    }
  }
}
