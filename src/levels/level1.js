import * as THREE from 'three';
import { generateLevelArchitecture } from '../gen/generator.js';
import { ChunkManager } from '../gen/chunkManager.js';

function formatSignalBearing(player, targetX, targetZ, label) {
  const dx = targetX - player.x;
  const dz = targetZ - player.z;
  const dist = Math.round(Math.hypot(dx, dz));
  const lookX = -Math.sin(player.yaw);
  const lookZ = -Math.cos(player.yaw);
  const rightX = Math.cos(player.yaw);
  const rightZ = -Math.sin(player.yaw);
  const forwardDot = (dx * lookX + dz * lookZ) / (Math.hypot(dx, dz) || 1);
  const rightDot = (dx * rightX + dz * rightZ) / (Math.hypot(dx, dz) || 1);

  let dir = '▲ AHEAD';
  if (forwardDot < -0.45) dir = '▼ BEHIND';
  else if (rightDot > 0.4) dir = '► RIGHT';
  else if (rightDot < -0.4) dir = '◄ LEFT';

  return `${label}: ${dist}m [${dir}]`;
}

/**
 * LEVEL 1: "THE HABITABLE ZONE" (Dark Concrete Warehouse)
 * - Look: Tall 4.8m warehouse ceiling, cylindrical concrete columns, overhead steel trusses,
 *   caution stripes, cold mercury-vapor lighting, dense slate fog.
 * - Unique Mechanic: Periodic Warehouse Blackout Cycles (with countdown warning)
 *   & Glowing Supply Crates (+35% Battery/Stamina) + 2 Diesel Backup Generators.
 */
export function createLevel(scene, state, rendererManager, quality = 'Medium') {
  const levelData = generateLevelArchitecture({
    levelIndex: 1,
    seed: state.seed,
    width: 36,
    height: 36,
    hallCount: 4,
    roomCount: 8,
    deadEndCount: 11,
    loopCount: 6,
    pillarDensity: 0.65,
    objectiveCount: 2,
    hazardCount: 5,
    minExitDistance: 18,
    corridorBias: 'standard'
  });

  const themeConfig = {
    textureTheme: 'level1',
    wallHeight: 4.8,
    pillarShape: 'cylinder',
    wallRoughness: 0.9,
    wallMetalness: 0.12,
    floorRoughness: 0.85,
    floorMetalness: 0.15,
    pillarTint: 0x70757a,
    lightColor: 0xaad4ff,
    lightIntensity: 1.95,
    objectiveLabel: 'Diesel Backup Generator',
    objectiveColor: 0x8a6d1b,
    hazardColor: 0x2b3640,
    hazardEmissive: 0x0b1520,
    hazardPlumeColor: 0x7090aa,
    hasOverheadPipes: true,
    propColor: 0x3b4248
  };

  rendererManager.configureAtmosphere({
    bgColor: 0x080a0d,
    fogColor: 0x0d1015,
    fogDensity: 0.056,
    ambientSky: 0x7b92a8,
    ambientGround: 0x14181f,
    ambientIntensity: 0.28
  });

  state.player.surfaceType = 'concrete';
  state.player.speedMultiplier = 1.0;

  const chunkManager = new ChunkManager(scene, levelData, themeConfig, quality);

  // Add Warehouse Supply Crates in dead ends with proper material disposal tracking
  const crateGroup = new THREE.Group();
  const crates = [];
  const crateGeo = new THREE.BoxGeometry(0.95, 0.85, 0.95);
  const crateMats = [];

  const maxCrates = Math.min(4, levelData.deadEnds.length);
  for (let i = 0; i < maxCrates; i++) {
    const de = levelData.deadEnds[i];
    const mat = new THREE.MeshStandardMaterial({
      color: 0x7a5f3e,
      emissive: 0x1f3a18,
      emissiveIntensity: 0.45,
      roughness: 0.75,
      metalness: 0.15
    });
    crateMats.push(mat);
    const mesh = new THREE.Mesh(crateGeo, mat);
    mesh.position.set(de.x * levelData.cellSize, 0.425, de.z * levelData.cellSize);
    crateGroup.add(mesh);
    crates.push({
      x: de.x,
      z: de.z,
      mesh,
      mat,
      looted: false
    });
  }
  scene.add(crateGroup);

  let objectivesCompleted = 0;
  const objectivesTotal = levelData.objectives.length;
  let exitUnlocked = objectivesTotal === 0;
  chunkManager.setExitUnlocked(exitUnlocked);

  state.levelInfo = {
    index: 1,
    name: 'LEVEL 1 // HABITABLE ZONE',
    subtitle: 'Subterranean Concrete Warehouse Sector',
    mechanicHint: 'Start 2 Backup Generators [E] & Scavenge Supply Crates before Blackout',
    objectivesCompleted,
    objectivesTotal,
    exitUnlocked,
    interactionPrompt: '',
    warningMessage: '',
    chaseActive: false,
    closestEnemyDist: Infinity,
    audioProfile: {
      humFreq: 120,
      humGain: 0.11,
      dronePitch: 44
    },
    enemiesConfig: [
      { type: 'smiler', count: 2 },
      { type: 'hound', count: 1 }
    ]
  };

  return {
    id: 1,
    levelData,
    chunkManager,
    crates,
    update(dt, elapsedTime, input, audioSynth) {
      const p = state.player;

      const cycle = elapsedTime % 24;
      const blackoutWindow = Math.max(0, 5.0 - objectivesCompleted * 2.2);
      const inPreBlackout = blackoutWindow > 0 && cycle > 16.0 && cycle <= 18.0;
      const inBlackout = cycle > 18.0 && cycle < 18.0 + blackoutWindow;
      const blackoutMultiplier = inBlackout
        ? 0.06
        : inPreBlackout
        ? 0.5 + 0.4 * Math.sin(elapsedTime * 25.0)
        : 1.0;

      if (inPreBlackout) {
        if (!state.levelInfo.warningMessage.startsWith('⚠')) {
          state.levelInfo.warningMessage = 'WAREHOUSE POWER FAILING — BLACKOUT IN 2s';
        }
      } else if (inBlackout) {
        if (!p.flashlightOn) {
          p.sanity = Math.max(10, p.sanity - dt * 5.5);
        }
        if (!state.levelInfo.warningMessage.startsWith('⚠')) {
          state.levelInfo.warningMessage = 'SECTOR BLACKOUT ACTIVE — SHINE FLASHLIGHT ON SMILERS';
        }
      } else if (
        state.levelInfo.warningMessage === 'SECTOR BLACKOUT ACTIVE — SHINE FLASHLIGHT ON SMILERS' ||
        state.levelInfo.warningMessage === 'WAREHOUSE POWER FAILING — BLACKOUT IN 2s'
      ) {
        state.levelInfo.warningMessage = '';
      }

      let promptText = '';

      // Check Supply Crates
      for (const crate of crates) {
        if (crate.looted) continue;
        const cx = crate.x * levelData.cellSize;
        const cz = crate.z * levelData.cellSize;
        const dist = Math.hypot(p.x - cx, p.z - cz);
        if (dist < 2.5) {
          promptText = '[E] Scavenge Supply Crate (+35% Battery & Stamina)';
          if (input.consumeJustPressed('KeyE')) {
            crate.looted = true;
            crate.mesh.scale.set(0.85, 0.35, 0.85);
            crate.mesh.position.y = 0.18;
            crate.mat.color.setHex(0x3a2e20);
            crate.mat.emissiveIntensity = 0.0;
            p.battery = Math.min(p.maxBattery, p.battery + 35);
            p.stamina = Math.min(p.maxStamina, p.stamina + 35);
            p.sanity = Math.min(100, p.sanity + 15);
            if (audioSynth && audioSynth.playInteract) audioSynth.playInteract();
          }
        }
      }

      // Check Backup Generators & Signal Bearing
      let nearestTarget = null;
      let nearestDist = Infinity;

      for (const item of chunkManager.interactiveMeshes) {
        if (item.data.activated) continue;
        const ox = item.data.x * levelData.cellSize;
        const oz = item.data.z * levelData.cellSize;
        const dist = Math.hypot(p.x - ox, p.z - oz);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestTarget = { x: ox, z: oz, label: 'Backup Generator' };
        }
        if (dist < 2.6) {
          promptText = `[E] Engage ${item.label} (+20% Battery)`;
          if (input.consumeJustPressed('KeyE')) {
            item.data.activated = true;
            item.indicatorMat.color.setHex(0x32d74b);
            item.indicatorMat.emissive.setHex(0x22cc44);
            objectivesCompleted++;
            p.battery = Math.min(p.maxBattery, p.battery + 20);
            state.levelInfo.objectivesCompleted = objectivesCompleted;
            if (audioSynth && audioSynth.playInteract) audioSynth.playInteract();

            if (objectivesCompleted >= objectivesTotal) {
              exitUnlocked = true;
              state.levelInfo.exitUnlocked = true;
              chunkManager.setExitUnlocked(true);
            }
          }
        }
      }

      const ex = levelData.exit.x * levelData.cellSize;
      const ez = levelData.exit.z * levelData.cellSize;
      const exitDist = Math.hypot(p.x - ex, p.z - ez);
      let reachedExit = false;

      if (exitUnlocked) {
        state.levelInfo.mechanicHint = formatSignalBearing(p, ex, ez, 'Freight Exit');
      } else if (nearestTarget) {
        state.levelInfo.mechanicHint = `Start Generators [E] — ${formatSignalBearing(
          p,
          nearestTarget.x,
          nearestTarget.z,
          nearestTarget.label
        )}`;
      }

      if (exitDist < 2.6) {
        if (exitUnlocked) {
          promptText = '[E] Enter Service Tunnel -> Level 2';
          if (input.consumeJustPressed('KeyE') || exitDist < 1.35) {
            reachedExit = true;
          }
        } else {
          promptText = `Freight Exit Unpowered (${objectivesCompleted}/${objectivesTotal} Generators Active)`;
        }
      }

      state.levelInfo.interactionPrompt = promptText;

      const chunkStats = chunkManager.update(p, elapsedTime, blackoutMultiplier);
      state.metrics.activeChunks = chunkStats.activeChunks;
      state.metrics.totalChunks = chunkStats.totalChunks;

      return { reachedExit };
    },
    dispose() {
      scene.remove(crateGroup);
      crateGeo.dispose();
      for (const m of crateMats) {
        m.dispose();
      }
      chunkManager.dispose();
    }
  };
}
