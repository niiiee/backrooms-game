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
 * LEVEL 4: "ABANDONED OFFICE MAZE" (90s Cubicle & Server Complex)
 * - Look: 3.5m drop ceiling, drywall + grey-blue cubicle partition fabric, commercial carpet tiles,
 *   procedural office desks with glowing green CRT monitors, cool fluorescent light.
 * - Unique Mechanic: CRT Security Terminal Overrides (+25% UPS Battery) & Motion Sensor Alarms
 *   with live network node signal bearing.
 */
export function createLevel(scene, state, rendererManager, quality = 'Medium') {
  const levelData = generateLevelArchitecture({
    levelIndex: 4,
    seed: state.seed,
    width: 38,
    height: 38,
    hallCount: 4,
    roomCount: 10,
    deadEndCount: 11,
    loopCount: 6,
    pillarDensity: 0.6,
    objectiveCount: 3,
    hazardCount: 6,
    minExitDistance: 20,
    corridorBias: 'office'
  });

  const themeConfig = {
    textureTheme: 'level4',
    wallHeight: 3.5,
    pillarShape: 'box',
    wallRoughness: 0.86,
    wallMetalness: 0.08,
    floorRoughness: 0.92,
    floorMetalness: 0.04,
    pillarTint: 0x9aa4b0,
    lightColor: 0xd8eeff,
    lightIntensity: 2.15,
    objectiveLabel: 'CRT Security Terminal',
    objectiveColor: 0x2c3e50,
    hazardColor: 0x3b2025,
    hazardEmissive: 0x440810,
    hazardPlumeColor: 0xff3b30,
    hasOverheadPipes: false
  };

  rendererManager.configureAtmosphere({
    bgColor: 0x0b0e14,
    fogColor: 0x121722,
    fogDensity: 0.05,
    ambientSky: 0xb8d0e8,
    ambientGround: 0x1a202c,
    ambientIntensity: 0.34
  });

  state.player.surfaceType = 'carpet';
  state.player.speedMultiplier = 1.0;

  const chunkManager = new ChunkManager(scene, levelData, themeConfig, quality);

  // Add Procedural Office Desks + Glowing CRT Monitors in Rooms (placed on safe walkable corners)
  const officeProps = new THREE.Group();
  const deskGeo = new THREE.BoxGeometry(1.2, 0.75, 0.65);
  const deskMat = new THREE.MeshStandardMaterial({ color: 0x4a3e35, roughness: 0.7 });
  const crtGeo = new THREE.BoxGeometry(0.42, 0.38, 0.38);
  const crtMat = new THREE.MeshStandardMaterial({
    color: 0x8c887b,
    emissive: 0x18a84b,
    emissiveIntensity: 0.95
  });

  for (let i = 1; i < levelData.rooms.length; i++) {
    const rm = levelData.rooms[i];
    const wx = (rm.x + 0.65) * levelData.cellSize;
    const wz = (rm.z + 0.65) * levelData.cellSize;
    const desk = new THREE.Mesh(deskGeo, deskMat);
    desk.position.set(wx, 0.375, wz);
    const crt = new THREE.Mesh(crtGeo, crtMat);
    crt.position.set(wx, 0.94, wz);
    officeProps.add(desk, crt);
  }
  scene.add(officeProps);

  let objectivesCompleted = 0;
  const objectivesTotal = levelData.objectives.length;
  let exitUnlocked = objectivesTotal === 0;
  let alarmPingTimer = 0;
  chunkManager.setExitUnlocked(exitUnlocked);

  state.levelInfo = {
    index: 4,
    name: 'LEVEL 4 // ABANDONED OFFICE',
    subtitle: 'Automated Cubicle & Server Sector',
    mechanicHint: 'Override 3 CRT Security Terminals [E] to unlock the Executive Elevator',
    objectivesCompleted,
    objectivesTotal,
    exitUnlocked,
    interactionPrompt: '',
    warningMessage: '',
    chaseActive: false,
    closestEnemyDist: Infinity,
    audioProfile: {
      humFreq: 75,
      humGain: 0.12,
      dronePitch: 52
    },
    enemiesConfig: [
      { type: 'howler', count: 1 },
      { type: 'smiler', count: 1 },
      { type: 'hound', count: 1 }
    ]
  };

  return {
    id: 4,
    levelData,
    chunkManager,
    update(dt, elapsedTime, input, audioSynth) {
      const p = state.player;

      if (alarmPingTimer > 0) {
        alarmPingTimer -= dt;
        p.noiseRadius = Math.max(p.noiseRadius, 17.5);
      }

      const chunkStats = chunkManager.update(p, elapsedTime, 1.0);
      state.metrics.activeChunks = chunkStats.activeChunks;
      state.metrics.totalChunks = chunkStats.totalChunks;

      // Check Motion Sensor Laser Hazards
      for (const hv of chunkManager.hazardVisuals) {
        if (!hv.active) continue;
        const hx = hv.data.x * levelData.cellSize;
        const hz = hv.data.z * levelData.cellSize;
        const dist = Math.hypot(p.x - hx, p.z - hz);
        if (dist < 2.0) {
          alarmPingTimer = 1.8;
          p.noiseRadius = 19.0;
          if (!state.levelInfo.warningMessage.startsWith('⚠')) {
            state.levelInfo.warningMessage = 'SECURITY MOTION SENSOR TRIPPED — ENTITIES ALERTED!';
          }
        }
      }

      let promptText = '';
      let nearestTarget = null;
      let nearestDist = Infinity;

      // Check CRT Security Terminals
      for (const item of chunkManager.interactiveMeshes) {
        if (item.data.activated) continue;
        const ox = item.data.x * levelData.cellSize;
        const oz = item.data.z * levelData.cellSize;
        const dist = Math.hypot(p.x - ox, p.z - oz);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestTarget = { x: ox, z: oz, label: 'Security Terminal' };
        }
        if (dist < 2.6) {
          promptText = `[E] Override ${item.label} (+25% UPS Battery)`;
          if (input.consumeJustPressed('KeyE')) {
            item.data.activated = true;
            item.indicatorMat.color.setHex(0x32d74b);
            item.indicatorMat.emissive.setHex(0x22cc44);
            objectivesCompleted++;
            alarmPingTimer = 1.4;
            p.battery = Math.min(p.maxBattery, p.battery + 25);
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
        state.levelInfo.mechanicHint = formatSignalBearing(p, ex, ez, 'Executive Elevator');
      } else if (nearestTarget) {
        state.levelInfo.mechanicHint = `Hack Terminals [E] — ${formatSignalBearing(
          p,
          nearestTarget.x,
          nearestTarget.z,
          nearestTarget.label
        )}`;
      }

      if (exitDist < 2.6) {
        if (exitUnlocked) {
          promptText = '[E] Board Executive Elevator -> Level 5 (The Endless Hallway)';
          if (input.consumeJustPressed('KeyE') || exitDist < 1.35) {
            reachedExit = true;
          }
        } else {
          promptText = `Mag-Lock Engaged (${objectivesCompleted}/${objectivesTotal} Security Terminals Overridden)`;
        }
      }

      state.levelInfo.interactionPrompt = promptText;

      return { reachedExit };
    },
    dispose() {
      scene.remove(officeProps);
      deskGeo.dispose();
      deskMat.dispose();
      crtGeo.dispose();
      crtMat.dispose();
      chunkManager.dispose();
    }
  };
}
