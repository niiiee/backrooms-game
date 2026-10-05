import * as THREE from 'three';
import { BaseEnemy, createEntityAuraShaderMaterial } from './baseEnemy.js';

/**
 * Enemy Type 3: HOUND / SKIN-STEALER
 * Low-slung quadrupedal stalker with protruding dorsal spine spikes,
 * snapping hinged jaw, triple crimson hunter eyes, and acute 1.7x acoustic hearing.
 */
export class HoundEnemy extends BaseEnemy {
  constructor(levelData) {
    super(levelData, {
      type: 'hound',
      name: 'Hound Stalker',
      patrolSpeed: 2.45,
      investigateSpeed: 3.8,
      chaseSpeed: 5.65,
      sightRange: 15.0,
      hearingMultiplier: 1.7,
      warningDuration: 0.85,
      loseSightDuration: 4.5,
      searchDuration: 8.0
    });

    this._buildProceduralModel();
  }

  _buildProceduralModel() {
    const fleshMat = new THREE.MeshStandardMaterial({
      color: 0x6b5144,
      roughness: 0.68,
      metalness: 0.12
    });

    const boneMat = new THREE.MeshStandardMaterial({
      color: 0x221612,
      roughness: 0.55,
      metalness: 0.25
    });

    // 1. Hunched segmented torso + protruding dorsal spine ridges
    this.torso = new THREE.Group();
    this.torso.position.set(0, 0.84, 0);

    const ribCage = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.46, 0.72), fleshMat);
    ribCage.position.set(0, 0.04, 0.22);
    const haunch = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.38, 0.62), fleshMat);
    haunch.position.set(0, -0.04, -0.35);
    this.torso.add(ribCage, haunch);

    const spikeGeo = new THREE.ConeGeometry(0.045, 0.26, 4);
    for (let s = 0; s < 5; s++) {
      const spike = new THREE.Mesh(spikeGeo, boneMat);
      spike.position.set(0, 0.32 - s * 0.02, 0.45 - s * 0.22);
      spike.rotation.x = -0.35;
      this.torso.add(spike);
    }
    this.group.add(this.torso);

    // 2. Elongated skull + hinged snapping mandible + triple hunter eyes
    this.head = new THREE.Group();
    this.head.position.set(0, 1.04, 0.72);
    const cranium = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.28, 0.52), fleshMat);
    this.jaw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.48), boneMat);
    this.jaw.position.set(0, -0.15, 0.08);

    // Fang teeth on lower jaw
    const fangGeo = new THREE.ConeGeometry(0.022, 0.09, 4);
    const fangL = new THREE.Mesh(fangGeo, new THREE.MeshBasicMaterial({ color: 0xd8d0b8 }));
    fangL.position.set(-0.11, 0.08, 0.18);
    const fangR = fangL.clone();
    fangR.position.x = 0.11;
    this.jaw.add(fangL, fangR);

    this.eyeMat = new THREE.MeshStandardMaterial({
      color: 0xff4422,
      emissive: 0xff2200,
      emissiveIntensity: 2.0
    });
    const eyeGeo = new THREE.SphereGeometry(0.042, 6, 6);
    const eyeL = new THREE.Mesh(eyeGeo, this.eyeMat);
    eyeL.position.set(-0.13, 0.06, 0.25);
    const eyeR = new THREE.Mesh(eyeGeo, this.eyeMat);
    eyeR.position.set(0.13, 0.06, 0.25);
    const eyeCenter = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), this.eyeMat);
    eyeCenter.position.set(0, 0.11, 0.26);

    this.head.add(cranium, this.jaw, eyeL, eyeR, eyeCenter);
    this.group.add(this.head);

    // 3. 4 Jointed Crawler Limbs with Fore-Claws
    const limbGeo = new THREE.CylinderGeometry(0.065, 0.038, 0.84, 6);
    limbGeo.translate(0, -0.4, 0);
    this.limbs = [];
    const limbOffsets = [
      [-0.34, 0.82, 0.44],
      [0.34, 0.82, 0.44],
      [-0.3, 0.78, -0.44],
      [0.3, 0.78, -0.44]
    ];
    for (const [lx, ly, lz] of limbOffsets) {
      const limb = new THREE.Mesh(limbGeo, fleshMat);
      limb.position.set(lx, ly, lz);
      this.group.add(limb);
      this.limbs.push(limb);
    }

    // 4. Custom GLSL Distortion Aura
    this.auraMat = createEntityAuraShaderMaterial(0xff5500);
    const auraMesh = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.1, 1.55), this.auraMat);
    auraMesh.position.set(0, 0.65, 0.1);
    this.group.add(auraMesh);
  }

  _animateVisuals(_dt, _player) {
    const isFast = this.state === 'chase' || this.state === 'investigate';
    const freq = isFast ? 16.5 : 8.0;
    const amp = isFast ? 0.78 : 0.38;

    if (this.state === 'warning') {
      // Crouch low & snap jaws rapidly before pouncing
      this.torso.position.y = 0.56;
      this.head.position.y = 0.72;
      this.head.rotation.z = Math.sin(this.animTime * 38) * 0.42;
      this.jaw.rotation.x = 0.35 + Math.sin(this.animTime * 42) * 0.22;
      this.eyeMat.emissiveIntensity = 4.6;
    } else {
      this.torso.position.y = 0.84 + Math.abs(Math.sin(this.animTime * freq)) * 0.09;
      this.head.position.y = 1.04;
      this.head.rotation.z = Math.sin(this.animTime * 5.5) * 0.14;
      this.jaw.rotation.x = isFast ? 0.22 + Math.abs(Math.sin(this.animTime * 18)) * 0.25 : 0.06;
      this.eyeMat.emissiveIntensity = this.state === 'chase' ? 3.5 : 1.6;

      this.limbs[0].rotation.x = Math.sin(this.animTime * freq) * amp;
      this.limbs[1].rotation.x = -Math.sin(this.animTime * freq) * amp;
      this.limbs[2].rotation.x = -Math.sin(this.animTime * freq) * amp;
      this.limbs[3].rotation.x = Math.sin(this.animTime * freq) * amp;
    }
  }
}
