import * as THREE from 'three';
import { BaseEnemy, createEntityAuraShaderMaterial } from './baseEnemy.js';

/**
 * Enemy Type 2: SMILER
 * Abyssal void entity with orbiting shadow shards, dilating glowing eyes,
 * and an unhinging double-row crescent grin of 14 razor teeth.
 * Unique Behavior: Light-reactive! Spots active flashlights from afar (25m),
 * but recoils/slows down and violently glitches when the player shines their
 * flashlight beam directly into its face.
 */
export class SmilerEnemy extends BaseEnemy {
  constructor(levelData) {
    super(levelData, {
      type: 'smiler',
      name: 'Smiler',
      patrolSpeed: 1.9,
      investigateSpeed: 2.9,
      chaseSpeed: 5.15,
      sightRange: 21.0,
      hearingMultiplier: 0.9,
      warningDuration: 0.9,
      loseSightDuration: 3.8,
      searchDuration: 5.5
    });

    this.isStunnedByBeam = false;
    this._buildProceduralModel();
  }

  _buildProceduralModel() {
    this.bodyGroup = new THREE.Group();
    this.bodyGroup.position.y = 1.55;

    // 1. Pitch-black shadow core + tattered lower void tendrils
    const shroudGeo = new THREE.CapsuleGeometry(0.42, 1.18, 6, 12);
    const shroudMat = new THREE.MeshBasicMaterial({
      color: 0x020202
    });
    const shroud = new THREE.Mesh(shroudGeo, shroudMat);
    this.bodyGroup.add(shroud);

    // Orbiting jagged shadow shards for unmistakable silhouette
    this.shardRing = new THREE.Group();
    const shardGeo = new THREE.ConeGeometry(0.08, 0.58, 4);
    for (let s = 0; s < 6; s++) {
      const angle = (s / 6) * Math.PI * 2;
      const shard = new THREE.Mesh(shardGeo, shroudMat);
      shard.position.set(Math.cos(angle) * 0.52, -0.35 + (s % 2) * 0.25, Math.sin(angle) * 0.52);
      shard.rotation.x = Math.PI + Math.sin(angle) * 0.25;
      shard.rotation.z = Math.cos(angle) * 0.25;
      this.shardRing.add(shard);
    }
    this.bodyGroup.add(this.shardRing);

    // 2. Piercing Glowing Eyes with dark slit pupils
    this.faceMat = new THREE.MeshBasicMaterial({
      color: 0xffffff
    });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x050000 });

    const eyeGeo = new THREE.SphereGeometry(0.068, 8, 8);
    const pupilGeo = new THREE.BoxGeometry(0.02, 0.09, 0.03);

    this.leftEye = new THREE.Group();
    this.leftEye.position.set(-0.16, 0.36, 0.39);
    const eyeMeshL = new THREE.Mesh(eyeGeo, this.faceMat);
    eyeMeshL.scale.set(1.2, 0.75, 0.6);
    const pupilL = new THREE.Mesh(pupilGeo, pupilMat);
    pupilL.position.z = 0.04;
    this.leftEye.add(eyeMeshL, pupilL);

    this.rightEye = new THREE.Group();
    this.rightEye.position.set(0.16, 0.36, 0.39);
    const eyeMeshR = new THREE.Mesh(eyeGeo, this.faceMat);
    eyeMeshR.scale.set(1.2, 0.75, 0.6);
    const pupilR = new THREE.Mesh(pupilGeo, pupilMat);
    pupilR.position.z = 0.04;
    this.rightEye.add(eyeMeshR, pupilR);

    this.bodyGroup.add(this.leftEye, this.rightEye);

    // 3. Double-row unhinging crescent grin (upper & lower jaw groups)
    this.upperJaw = new THREE.Group();
    this.lowerJaw = new THREE.Group();
    const toothGeo = new THREE.ConeGeometry(0.028, 0.095, 4);

    for (let i = -4; i <= 4; i++) {
      const t = i / 4;
      const curveY = 0.1 + t * t * 0.14;
      const curveZ = 0.41 - t * t * 0.07;

      const upperTooth = new THREE.Mesh(toothGeo, this.faceMat);
      upperTooth.position.set(t * 0.27, curveY, curveZ);
      upperTooth.rotation.x = Math.PI;
      this.upperJaw.add(upperTooth);

      if (i >= -3 && i <= 3) {
        const lowerTooth = new THREE.Mesh(toothGeo, this.faceMat);
        lowerTooth.position.set(t * 0.24, curveY - 0.08, curveZ);
        this.lowerJaw.add(lowerTooth);
      }
    }
    this.bodyGroup.add(this.upperJaw, this.lowerJaw);

    // 4. Custom GLSL Glitch Aura
    this.auraMat = createEntityAuraShaderMaterial(0x9922ff);
    const auraMesh = new THREE.Mesh(new THREE.SphereGeometry(0.68, 12, 10), this.auraMat);
    auraMesh.scale.set(1.0, 1.45, 1.0);
    this.bodyGroup.add(auraMesh);

    this.group.add(this.bodyGroup);
  }

  getEffectiveSightRange(player) {
    return player.flashlightOn ? 25.0 : 12.0;
  }

  getEffectiveSpeed(player) {
    const base = super.getEffectiveSpeed(player);
    if (player && player.flashlightOn && (this.state === 'chase' || this.state === 'investigate')) {
      const dx = this.x - player.x;
      const dz = this.z - player.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.5 && dist < 11.5) {
        const lookX = -Math.sin(player.yaw);
        const lookZ = -Math.cos(player.yaw);
        const dot = (dx / dist) * lookX + (dz / dist) * lookZ;
        if (dot > 0.8) {
          this.isStunnedByBeam = true;
          return base * 0.52;
        }
      }
    }
    this.isStunnedByBeam = false;
    return base;
  }

  _animateVisuals(_dt, _player) {
    this.bodyGroup.position.y = 1.52 + Math.sin(this.animTime * 4.2) * 0.14;
    this.shardRing.rotation.y = this.animTime * 2.4;

    if (this.state === 'warning') {
      this.faceMat.color.setHex(0xff3b30);
      this.bodyGroup.scale.set(1.24, 1.24, 1.24);
      // Unhinge jaw wide during warning shriek
      this.lowerJaw.position.y = -0.14 + Math.sin(this.animTime * 45) * 0.04;
      this.leftEye.rotation.z = -0.25;
      this.rightEye.rotation.z = 0.25;
    } else if (this.isStunnedByBeam) {
      // Violent optical recoil & glitch jitter when blinded by flashlight beam
      this.faceMat.color.setHex(0x88ffff);
      this.bodyGroup.scale.set(0.9, 1.08, 0.9);
      this.bodyGroup.position.x = (Math.random() - 0.5) * 0.16;
      this.lowerJaw.position.y = -0.18;
    } else {
      const isChase = this.state === 'chase';
      this.faceMat.color.setHex(isChase ? 0xffe0d8 : 0xffffff);
      this.bodyGroup.scale.set(1, 1, 1);
      this.bodyGroup.position.x = isChase && Math.sin(this.animTime * 33) > 0.88 ? (Math.random() - 0.5) * 0.14 : 0;
      this.lowerJaw.position.y = isChase ? -0.08 - Math.abs(Math.sin(this.animTime * 16)) * 0.07 : 0;
      this.leftEye.rotation.z = -0.1;
      this.rightEye.rotation.z = 0.1;
    }
  }
}
