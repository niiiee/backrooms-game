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
 * LEVEL 2: "PIPE DREAMS" (Claustrophobic Maintenance Tunnels)
 * - Look: Low 3.2m ceiling, grimy industrial brick & rusted steel pipe corridors,
 *   metal grating floor, amber-orange sodium lights, smoky steam fog.
 * - Unique Mechanic: Pre-telegraphed Bursting Steam Vents & Pressure Relief Valves.
 *   Turning each valve shuts off a third of the steam vents and guides the player via
 *   acoustic pressure signal bearing.
 */
export function createLevel(scene, state, rendererManager, quality = 'Medium') {
  const levelData = generateLevelArchitecture({
    levelIndex: 2,
    seed: state.seed,
    width: 36,
    height: 36,
    hallCount: 2,
    roomCount: 7,
    deadEndCount: 12,
    loopCount: 6,
    pillarDensity: 0.6,
    objectiveCount: 3,
    hazardCount: 8,
    minExitDistance: 18,
    corridorBias: 'tunnels'
  });

  const themeConfig = {
    textureTheme: 'level2',
    wallHeight: 3.2,
    pillarShape: 'cylinder',
    wallRoughness: 0.85,
    wallMetalness: 0.28,
    floorRoughness: 0.65,
    floorMetalness: 0.45,
    pillarTint: 0x5c4230,
    lightColor: 0xff8c3b,
    lightIntensity: 2.05,
    objectiveLabel: 'Steam Pressure Relief Valve',
    objectiveColor: 0x9e3224,
    hazardColor: 0x6b3a1e,
    hazardEmissive: 0x441a08,
    hazardPlumeColor: 0xe8ded5,
    hasOverheadPipes: true,
    propColor: 0x70482c
  };

  rendererManager.configureAtmosphere({
    bgColor: 0x120905,
    fogColor: 0x1a0e07,
    fogDensity: 0.062,
    ambientSky: 0xd47a3b,
    ambientGround: 0x1f1008,
    ambientIntensity: 0.29
  });

  state.player.surfaceType = 'metal';
  state.player.speedMultiplier = 1.0;

  const chunkManager = new ChunkManager(scene, levelData, themeConfig, quality);

  let objectivesCompleted = 0;
  const objectivesTotal = levelData.objectives.length;
  let exitUnlocked = objectivesTotal === 0;
  chunkManager.setExitUnlocked(exitUnlocked);

  state.levelInfo = {
    index: 2,
    name: 'LEVEL 2 // PIPE DREAMS',
    subtitle: 'High-Pressure Steam Utility Tunnels',
    mechanicHint: 'Turn 3 Pressure Relief Valves [E] to shut off scalding steam & unlock EXIT',
    objectivesCompleted,
    objectivesTotal,
    exitUnlocked,
    interactionPrompt: '',
    warningMessage: '',
    chaseActive: false,
    closestEnemyDist: Infinity,
    audioProfile: {
      humFreq: 90,
      humGain: 0.13,
      dronePitch: 38
    },
    enemiesConfig: [
      { type: 'hound', count: 2 },
      { type: 'howler', count: 1 }
    ]
  };

  return {
    id: 2,
    levelData,
    chunkManager,
    update(dt, elapsedTime, input, audioSynth) {
      const p = state.player;
      let inSteamHazard = false;

      const chunkStats = chunkManager.update(p, elapsedTime, exitUnlocked ? 1.0 : 0.92);
      state.metrics.activeChunks = chunkStats.activeChunks;
      state.metrics.totalChunks = chunkStats.totalChunks;

      // Progressive steam shutoff: each valve turned permanently disables a subset of vents
      const totalVents = chunkManager.hazardVisuals.length;
      const activeVentLimit = exitUnlocked
        ? 0
        : Math.ceil(totalVents * (1 - objectivesCompleted / Math.max(1, objectivesTotal)));

      for (let i = 0; i < totalVents; i++) {
        const hv = chunkManager.hazardVisuals[i];
        if (i >= activeVentLimit) {
          hv.active = false;
          hv.warning = false;
          hv.plume.visible = false;
          continue;
        }
        if (!hv.active) continue;
        const hx = hv.data.x * levelData.cellSize;
        const hz = hv.data.z * levelData.cellSize;
        const dist = Math.hypot(p.x - hx, p.z - hz);
        if (dist < 2.2) {
          inSteamHazard = true;
        }
      }

      if (inSteamHazard) {
        p.speedMultiplier = 0.55;
        p.stamina = Math.max(0, p.stamina - dt * 15.0);
        p.sanity = Math.max(10, p.sanity - dt * 6.5);
        p.noiseRadius = Math.max(p.noiseRadius, 16.0);
        if (!state.levelInfo.warningMessage.startsWith('⚠')) {
          state.levelInfo.warningMessage = 'SCALDING STEAM RUPTURE — SPEED REDUCED & HIGH NOISE!';
        }
      } else {
        p.speedMultiplier = 1.0;
        if (
          state.levelInfo.warningMessage ===
          'SCALDING STEAM RUPTURE — SPEED REDUCED & HIGH NOISE!'
        ) {
          state.levelInfo.warningMessage = '';
        }
      }

      let promptText = '';
      let nearestTarget = null;
      let nearestDist = Infinity;

      // Check Pressure Relief Valves
      for (const item of chunkManager.interactiveMeshes) {
        if (item.data.activated) continue;
        const ox = item.data.x * levelData.cellSize;
        const oz = item.data.z * levelData.cellSize;
        const dist = Math.hypot(p.x - ox, p.z - oz);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestTarget = { x: ox, z: oz, label: 'Pressure Valve' };
        }
        if (dist < 2.6) {
          promptText = `[E] Turn ${item.label} (+20% Battery)`;
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
        state.levelInfo.mechanicHint = formatSignalBearing(p, ex, ez, 'Floodgate Hatch');
      } else if (nearestTarget) {
        state.levelInfo.mechanicHint = `Turn Valves [E] — ${formatSignalBearing(
          p,
          nearestTarget.x,
          nearestTarget.z,
          nearestTarget.label
        )}`;
      }

      if (exitDist < 2.6) {
        if (exitUnlocked) {
          promptText = '[E] Open Floodgate Hatch -> Level 3 (Poolrooms)';
          if (input.consumeJustPressed('KeyE') || exitDist < 1.35) {
            reachedExit = true;
          }
        } else {
          promptText = `Bulkhead Sealed by Steam Pressure (${objectivesCompleted}/${objectivesTotal} Valves Turned)`;
        }
      }

      state.levelInfo.interactionPrompt = promptText;

      return { reachedExit };
    },
    dispose() {
      state.player.speedMultiplier = 1.0;
      chunkManager.dispose();
    }
  };
}
