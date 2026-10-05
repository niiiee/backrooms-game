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
 * LEVEL 0: "THE LOBBY" (Yellow Rooms)
 * - Look: 3.8m ceiling, mono-yellow damp wallpaper, worn carpet, buzzing fluorescent lights
 * - Unique Mechanic: Periodic Fluorescent Grid Brownout Surges (with 2s pre-surge flicker warning)
 *   & 2 Grid Breaker Switches tracked via live EM Signal Bearing.
 */
export function createLevel(scene, state, rendererManager, quality = 'Medium') {
  const levelData = generateLevelArchitecture({
    levelIndex: 0,
    seed: state.seed,
    width: 34,
    height: 34,
    hallCount: 3,
    roomCount: 8,
    deadEndCount: 10,
    loopCount: 5,
    pillarDensity: 0.55,
    objectiveCount: 2,
    hazardCount: 4,
    minExitDistance: 16,
    corridorBias: 'standard'
  });

  const themeConfig = {
    textureTheme: 'level0',
    wallHeight: 3.8,
    pillarShape: 'box',
    wallRoughness: 0.88,
    wallMetalness: 0.04,
    floorRoughness: 0.95,
    floorMetalness: 0.02,
    pillarTint: 0xd8c878,
    lightColor: 0xfff3b0,
    lightIntensity: 2.35,
    objectiveLabel: 'Grid Breaker Switch',
    objectiveColor: 0x5c532c,
    hazardColor: 0x6e5f22,
    hazardEmissive: 0x3a2e05,
    hazardPlumeColor: 0xdfd080,
    hasOverheadPipes: false
  };

  rendererManager.configureAtmosphere({
    bgColor: 0x121006,
    fogColor: 0x1a1709,
    fogDensity: 0.048,
    ambientSky: 0xe6d88a,
    ambientGround: 0x2e2812,
    ambientIntensity: 0.38
  });

  state.player.surfaceType = 'carpet';
  state.player.speedMultiplier = 1.0;

  const chunkManager = new ChunkManager(scene, levelData, themeConfig, quality);

  let objectivesCompleted = 0;
  const objectivesTotal = levelData.objectives.length;
  let exitUnlocked = objectivesTotal === 0;
  chunkManager.setExitUnlocked(exitUnlocked);

  state.levelInfo = {
    index: 0,
    name: 'LEVEL 0 // THE LOBBY',
    subtitle: 'Non-Linear Mono-Yellow Fluorescent Complex',
    mechanicHint: 'Flip 2 Grid Breaker Switches [E] to stabilize power & unlock EXIT',
    objectivesCompleted,
    objectivesTotal,
    exitUnlocked,
    interactionPrompt: '',
    warningMessage: '',
    chaseActive: false,
    closestEnemyDist: Infinity,
    audioProfile: {
      humFreq: 60,
      humGain: 0.14,
      dronePitch: 55
    },
    enemiesConfig: [
      { type: 'howler', count: 1 },
      { type: 'smiler', count: 1 }
    ]
  };

  return {
    id: 0,
    levelData,
    chunkManager,
    update(dt, elapsedTime, input, audioSynth) {
      const p = state.player;
      // Level 0 Unique Mechanic: Pre-warned power grid brownout surges every 22 seconds
      const cycle = elapsedTime % 22;
      const inPreWarning = cycle > 14.5 && cycle <= 16.5;
      const inSurge = cycle > 16.5 && cycle < 19.8;

      let blackoutMultiplier = 1.0;
      if (inPreWarning) {
        blackoutMultiplier = 0.65 + 0.35 * Math.sin(elapsedTime * 28.0);
        if (!state.levelInfo.warningMessage.startsWith('⚠')) {
          state.levelInfo.warningMessage = 'GRID SURGE IMMINENT — READY FLASHLIGHT [F]';
        }
      } else if (inSurge) {
        blackoutMultiplier = 0.2 + 0.12 * Math.sin(elapsedTime * 35.0);
        if (!p.flashlightOn) {
          p.sanity = Math.max(15, p.sanity - dt * 4.0);
          if (!state.levelInfo.warningMessage.startsWith('⚠')) {
            state.levelInfo.warningMessage = 'POWER SURGE BROWNOUT — USE FLASHLIGHT [F]';
          }
        }
      } else {
        p.sanity = Math.min(100, p.sanity + dt * 2.5);
        if (
          state.levelInfo.warningMessage === 'POWER SURGE BROWNOUT — USE FLASHLIGHT [F]' ||
          state.levelInfo.warningMessage === 'GRID SURGE IMMINENT — READY FLASHLIGHT [F]'
        ) {
          state.levelInfo.warningMessage = '';
        }
      }

      // Check Electrical Hum Distortion Hazards
      for (const hv of chunkManager.hazardVisuals) {
        if (!hv.active) continue;
        const hx = hv.data.x * levelData.cellSize;
        const hz = hv.data.z * levelData.cellSize;
        const dist = Math.hypot(p.x - hx, p.z - hz);
        if (dist < 2.1) {
          p.battery = Math.max(0, p.battery - dt * 4.5);
          if (!state.levelInfo.warningMessage.startsWith('⚠')) {
            state.levelInfo.warningMessage = 'EM INTERFERENCE ZONE — BATTERY DRAINING';
          }
        }
      }

      // Check Interactive Breaker Switches & compute nearest target signal bearing
      let promptText = '';
      let nearestTarget = null;
      let nearestDist = Infinity;

      for (const item of chunkManager.interactiveMeshes) {
        if (item.data.activated) continue;
        const ox = item.data.x * levelData.cellSize;
        const oz = item.data.z * levelData.cellSize;
        const dist = Math.hypot(p.x - ox, p.z - oz);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestTarget = { x: ox, z: oz, label: 'Nearest Breaker' };
        }
        if (dist < 2.6) {
          promptText = `[E] Flip ${item.label} (+25% Battery)`;
          if (input.consumeJustPressed('KeyE')) {
            item.data.activated = true;
            item.indicatorMat.color.setHex(0x32d74b);
            item.indicatorMat.emissive.setHex(0x22cc44);
            objectivesCompleted++;
            p.battery = Math.min(p.maxBattery, p.battery + 25);
            state.levelInfo.objectivesCompleted = objectivesCompleted;
            if (audioSynth && audioSynth.playInteract) {
              audioSynth.playInteract();
            }
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
        state.levelInfo.mechanicHint = formatSignalBearing(p, ex, ez, 'Acoustic Exit');
      } else if (nearestTarget) {
        state.levelInfo.mechanicHint = `Flip Breakers [E] — ${formatSignalBearing(
          p,
          nearestTarget.x,
          nearestTarget.z,
          nearestTarget.label
        )}`;
      }

      if (exitDist < 2.6) {
        if (exitUnlocked) {
          promptText = '[E] Enter Exit Stairwell -> Level 1';
          if (input.consumeJustPressed('KeyE') || exitDist < 1.35) {
            reachedExit = true;
          }
        } else {
          promptText = `Exit Locked (${objectivesCompleted}/${objectivesTotal} Breakers Flipped)`;
        }
      }

      state.levelInfo.interactionPrompt = promptText;

      const chunkStats = chunkManager.update(p, elapsedTime, blackoutMultiplier);
      state.metrics.activeChunks = chunkStats.activeChunks;
      state.metrics.totalChunks = chunkStats.totalChunks;

      return { reachedExit };
    },
    dispose() {
      chunkManager.dispose();
    }
  };
}
