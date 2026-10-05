import * as THREE from 'three';
import { BaseEnemy, createEntityAuraShaderMaterial } from './baseEnemy.js';

/**
 * Enemy Type 1: HOWLER / BACTERIA
 * Towering 2.95m asymmetric bacteriophage wire-frame silhouette:
 * - Multi-segmented crooked spine & protruding thoracic rib loops
 * - Double-jointed dangling wire arms with three-pronged scythe claws
 * - Tripod cranial cage with cranial antennae and multi-node glowing optic cluster
 * - Surrounded by a custom GLSL glitch-slice distortion aura
 * - Stop-motion jitter & violent body displacement during warning/chase
 */
export class HowlerEnemy extends BaseEnemy {
  constructor(levelData) {
    super(levelData, {
      type: 'howler',
      name: 'Howler (Bacteria)',
      patrolSpeed: 2.1,
      investigateSpeed: 3.2,
      chaseSpeed: 5.45,
      sightRange: 22.0,
      hearingMultiplier: 1.0,
      warningDuration: 1.05,
      loseSightDuration: 4.2,
      searchDuration: 6.0
    });

    this._buildProceduralModel();
  }

  _buildProceduralModel() {
    const wireMat = new THREE.MeshStandardMaterial({
      color: 0x0b0b09,
      roughness: 0.38,
      metalness: 0.45
    });

    this.rigGroup = new THREE.Group();
    this.group.add(this.rigGroup);

    // 1. Crooked multi-segment spine
    const lowerSpine = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.085, 1.05, 7), wireMat);
    lowerSpine.position.set(0, 1.35, 0);
    lowerSpine.rotation.z = 0.09;
    const upperSpine = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.0, 7), wireMat);
    upperSpine.position.set(-0.04, 2.25, 0.06);
    upperSpine.rotation.z = -0.11;
    upperSpine.rotation.x = 0.14;
    this.rigGroup.add(lowerSpine, upperSpine);

    // 2. Protruding thoracic rib hoops (distinct bacteriophage silhouette)
    const ribGeo = new THREE.TorusGeometry(0.24, 0.024, 6, 12, Math.PI * 1.45);
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(ribGeo, wireMat);
      rib.position.set(0, 1.55 + i * 0.22, 0.04);
      rib.rotation.x = Math.PI * 0.5 + 0.18;
      rib.rotation.z = Math.PI * 0.28 + (i % 2 === 0 ? 0.1 : -0.1);
      const s = 1.0 + i * 0.12;
      rib.scale.set(s, s, 1);
      this.rigGroup.add(rib);
    }

    // 3. Wide asymmetric jagged shoulder crossbar
    const shoulderGeo = new THREE.CylinderGeometry(0.038, 0.038, 1.18, 6);
    const shoulders = new THREE.Mesh(shoulderGeo, wireMat);
    shoulders.position.set(0, 2.52, 0.05);
    shoulders.rotation.z = Math.PI * 0.5 + 0.16;
    this.rigGroup.add(shoulders);

    // 4. Digitigrade crooked legs
    const legGeo = new THREE.CylinderGeometry(0.045, 0.025, 1.25, 6);
    legGeo.translate(0, -0.6, 0);
    this.leftLeg = new THREE.Mesh(legGeo, wireMat);
    this.leftLeg.position.set(-0.24, 1.22, 0);
    this.rightLeg = new THREE.Mesh(legGeo, wireMat);
    this.rightLeg.position.set(0.24, 1.22, 0);
    this.rigGroup.add(this.leftLeg, this.rightLeg);

    // 5. Elongated multi-jointed wire arms + 3-clawed hands
    const buildClawedArm = (side) => {
      const armPivot = new THREE.Group();
      armPivot.position.set(side * 0.54, 2.48, 0.05);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.024, 1.48, 6), wireMat);
      upper.position.y = -0.72;
      armPivot.add(upper);

      const clawGeo = new THREE.ConeGeometry(0.022, 0.34, 4);
      for (let c = -1; c <= 1; c++) {
        const claw = new THREE.Mesh(clawGeo, wireMat);
        claw.position.set(c * 0.06, -1.52, 0.06);
        claw.rotation.x = Math.PI + 0.25;
        claw.rotation.z = c * 0.22;
        armPivot.add(claw);
      }
      return armPivot;
    };

    this.leftArm = buildClawedArm(-1);
    this.rightArm = buildClawedArm(1);
    this.rigGroup.add(this.leftArm, this.rightArm);

    // 6. Distorted Tripod Head + Antennae + Multi-Optic Cluster
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 2.82, 0.12);

    const skullGeo = new THREE.OctahedronGeometry(0.26, 1);
    const skull = new THREE.Mesh(skullGeo, wireMat);
    skull.scale.set(0.82, 1.45, 0.95);
    this.headGroup.add(skull);

    // Cranial antennae horns
    const hornGeo = new THREE.CylinderGeometry(0.008, 0.025, 0.55, 5);
    const hornL = new THREE.Mesh(hornGeo, wireMat);
    hornL.position.set(-0.14, 0.38, -0.05);
    hornL.rotation.z = 0.35;
    const hornR = new THREE.Mesh(hornGeo, wireMat);
    hornR.position.set(0.16, 0.42, -0.05);
    hornR.rotation.z = -0.42;
    this.headGroup.add(hornL, hornR);

    this.opticMat = new THREE.MeshStandardMaterial({
      color: 0xffaa33,
      emissive: 0xff5511,
      emissiveIntensity: 1.6
    });
    const opticGeo = new THREE.SphereGeometry(0.065, 8, 8);
    const mainOptic = new THREE.Mesh(opticGeo, this.opticMat);
    mainOptic.position.set(0, 0.04, 0.22);
    const subOpticL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), this.opticMat);
    subOpticL.position.set(-0.09, 0.14, 0.19);
    const subOpticR = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), this.opticMat);
    subOpticR.position.set(0.09, -0.06, 0.19);
    this.headGroup.add(mainOptic, subOpticL, subOpticR);

    this.rigGroup.add(this.headGroup);

    // 7. Custom GLSL Glitch-Slice Distortion Aura
    this.auraMat = createEntityAuraShaderMaterial(0xff3300);
    const auraMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.42, 2.75, 10, 8, true), this.auraMat);
    auraMesh.position.y = 1.45;
    this.group.add(auraMesh);
  }

  _animateVisuals(_dt, _player) {
    const isChasing = this.state === 'chase';
    const isWarning = this.state === 'warning';
    // Quantize animation time slightly during chase/warning for unsettling stop-motion horror feel
    const t = isChasing || isWarning ? Math.floor(this.animTime * 24) / 24 : this.animTime;
    const strideFreq = isChasing ? 14.5 : 6.5;
    const strideAmp = isChasing ? 0.72 : 0.34;

    if (isWarning) {
      // Violent head convulsion, spatial glitch jitter & crimson optic flare
      this.headGroup.rotation.z = Math.sin(this.animTime * 48) * 0.55;
      this.headGroup.rotation.x = Math.cos(this.animTime * 41) * 0.38;
      this.leftArm.rotation.x = -2.35 + Math.sin(this.animTime * 34) * 0.32;
      this.rightArm.rotation.x = -2.35 + Math.cos(this.animTime * 34) * 0.32;
      this.rigGroup.position.x = Math.sin(this.animTime * 65) * 0.08;
      this.rigGroup.position.z = Math.cos(this.animTime * 53) * 0.08;
      this.opticMat.emissive.setHex(0xff1100);
      this.opticMat.emissiveIntensity = 4.5;
    } else {
      this.leftLeg.rotation.x = Math.sin(t * strideFreq) * strideAmp;
      this.rightLeg.rotation.x = -Math.sin(t * strideFreq) * strideAmp;
      this.leftArm.rotation.x = -Math.sin(t * strideFreq) * (strideAmp * 0.85) - (isChasing ? 0.95 : 0.15);
      this.rightArm.rotation.x = Math.sin(t * strideFreq) * (strideAmp * 0.85) - (isChasing ? 0.95 : 0.15);
      this.headGroup.rotation.z = Math.sin(t * 5.2) * 0.18 + (isChasing ? Math.sin(this.animTime * 37) * 0.16 : 0);
      this.headGroup.rotation.x = isChasing ? 0.26 : 0;

      // Intermittent horizontal glitch snap while chasing
      const glitchTrigger = isChasing && Math.sin(this.animTime * 29.0) > 0.86;
      this.rigGroup.position.x = glitchTrigger ? (Math.random() - 0.5) * 0.22 : 0;
      this.rigGroup.position.z = 0;

      this.opticMat.emissive.setHex(isChasing ? 0xff2200 : 0xcc6611);
      this.opticMat.emissiveIntensity = isChasing ? 3.4 : 1.3;
    }
  }
}
