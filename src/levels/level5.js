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
 * LEVEL 5: "THE ENDLESS HALLWAY" (Terror Hotel Finale)
 * - Look: 4.4m grand ceiling, ornate crimson damask wallpaper, dark mahogany wainscoting,
 *   crimson & gold carpet, warm flickering antique brass sconces, deep blood-red fog.
 * - Unique Mechanic: Non-Euclidean Spatial Loop & Crimson Anomaly Seals with progressive
 *   rift banishment and live anomaly signal bearing.
 */
export function createLevel(scene, state, rendererManager, quality = 'Medium') {
  const levelData = generateLevelArchitecture({
    levelIndex: 5,
    seed: state.seed,
    width: 40,
    height: 40,
    hallCount: 4,
    roomCount: 9,
    deadEndCount: 12,
    loopCount: 7,
    pillarDensity: 0.6,
    objectiveCount: 3,
    hazardCount: 6,
    minExitDistance: 20,
    corridorBias: 'endless_hall'
  });

  const themeConfig = {
    textureTheme: 'level5',
    wallHeight: 4.4,
    pillarShape: 'box',
    wallRoughness: 0.78,
    wallMetalness: 0.14,
    floorRoughness: 0.88,
    floorMetalness: 0.06,
    pillarTint: 0x5e191e,
    lightColor: 0xffb86c,
    lightIntensity: 2.1,
    objectiveLabel: 'Crimson Anomaly Seal',
    objectiveColor: 0x801820,
    hazardColor: 0x5c0812,
    hazardEmissive: 0x3b0008,
    hazardPlumeColor: 0xff2a44,
    hasOverheadPipes: false
  };

  rendererManager.configureAtmosphere({
    bgColor: 0x120405,
    fogColor: 0x1c0709,
    fogDensity: 0.054,
    ambientSky: 0xd98a6c,
    ambientGround: 0x24080a,
    ambientIntensity: 0.32
  });

  state.player.surfaceType = 'wood';
  state.player.speedMultiplier = 1.0;

  const chunkManager = new ChunkManager(scene, levelData, themeConfig, quality);

  let objectivesCompleted = 0;
  const objectivesTotal = levelData.objectives.length;
  let exitUnlocked = objectivesTotal === 0;
  let warpCooldown = 0;
  chunkManager.setExitUnlocked(exitUnlocked);

  state.levelInfo = {
    index: 5,
    name: 'LEVEL 5 // THE ENDLESS HALLWAY',
    subtitle: 'Non-Euclidean Grand Hotel Corridor',
    mechanicHint: 'Seal 3 Crimson Anomalies [E] to break the corridor loop & escape',
    objectivesCompleted,
    objectivesTotal,
    exitUnlocked,
    interactionPrompt: '',
    warningMessage: '',
    chaseActive: false,
    closestEnemyDist: Infinity,
    audioProfile: {
      humFreq: 50,
      humGain: 0.12,
      dronePitch: 36
    },
    enemiesConfig: [
      { type: 'howler', count: 2 },
      { type: 'smiler', count: 1 },
      { type: 'hound', count: 1 }
    ]
  };

  return {
    id: 5,
    levelData,
    chunkManager,
    update(dt, elapsedTime, input, audioSynth) {
      const p = state.player;
      if (warpCooldown > 0) warpCooldown -= dt;

      const flickerWave = 0.88 + 0.12 * Math.sin(elapsedTime * 6.5);
      const chunkStats = chunkManager.update(p, elapsedTime, flickerWave);
      state.metrics.activeChunks = chunkStats.activeChunks;
      state.metrics.totalChunks = chunkStats.totalChunks;

      // Progressive rift banishment as Crimson Anomaly Seals are completed
      const totalRifts = chunkManager.hazardVisuals.length;
      const activeRiftLimit = exitUnlocked
        ? 0
        : Math.ceil(totalRifts * (1 - objectivesCompleted / Math.max(1, objectivesTotal)));

      if (!exitUnlocked && warpCooldown <= 0) {
        for (let i = 0; i < totalRifts; i++) {
          const hv = chunkManager.hazardVisuals[i];
          if (i >= activeRiftLimit) {
            hv.active = false;
            hv.warning = false;
            hv.plume.visible = false;
            continue;
          }
          if (!hv.active) continue;
          const hx = hv.data.x * levelData.cellSize;
          const hz = hv.data.z * levelData.cellSize;
          const dist = Math.hypot(p.x - hx, p.z - hz);
          if (dist < 1.95) {
            p.x = levelData.spawn.x * levelData.cellSize;
            p.z = levelData.spawn.z * levelData.cellSize;
            warpCooldown = 3.0;
            state.levelInfo.warningMessage = 'NON-EUCLIDEAN CORRIDOR LOOP — SPACE RESET!';
            if (audioSynth && audioSynth.playStinger) audioSynth.playStinger('warp');
            break;
          }
        }
      } else if (exitUnlocked) {
        for (const hv of chunkManager.hazardVisuals) {
          hv.active = false;
          hv.warning = false;
          hv.plume.visible = false;
        }
      }

      let promptText = '';
      let nearestTarget = null;
      let nearestDist = Infinity;

      // Check Crimson Anomaly Seals
      for (const item of chunkManager.interactiveMeshes) {
        if (item.data.activated) continue;
        const ox = item.data.x * levelData.cellSize;
        const oz = item.data.z * levelData.cellSize;
        const dist = Math.hypot(p.x - ox, p.z - oz);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestTarget = { x: ox, z: oz, label: 'Crimson Anomaly' };
        }
        if (dist < 2.6) {
          promptText = `[E] Seal ${item.label} (+30% Battery & Stamina)`;
          if (input.consumeJustPressed('KeyE')) {
            item.data.activated = true;
            item.indicatorMat.color.setHex(0x32d74b);
            item.indicatorMat.emissive.setHex(0x22cc44);
            objectivesCompleted++;
            p.battery = Math.min(p.maxBattery, p.battery + 30);
            p.stamina = Math.min(p.maxStamina, p.stamina + 40);
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
        state.levelInfo.mechanicHint = formatSignalBearing(p, ex, ez, 'Final Escape Threshold');
      } else if (nearestTarget) {
        state.levelInfo.mechanicHint = `Seal Anomalies [E] — ${formatSignalBearing(
          p,
          nearestTarget.x,
          nearestTarget.z,
          nearestTarget.label
        )}`;
      }

      if (exitDist < 2.6) {
        if (exitUnlocked) {
          promptText = '[E] Step Through Threshold -> ESCAPE THE BACKROOMS';
          if (input.consumeJustPressed('KeyE') || exitDist < 1.35) {
            reachedExit = true;
          }
        } else {
          promptText = `Threshold Sealed by Spatial Loop (${objectivesCompleted}/${objectivesTotal} Anomalies Sealed)`;
          if (input.consumeJustPressed('KeyE') && warpCooldown <= 0) {
            p.x = levelData.spawn.x * levelData.cellSize;
            p.z = levelData.spawn.z * levelData.cellSize;
            warpCooldown = 2.5;
            state.levelInfo.warningMessage = 'HALLWAY LOOPED — SEAL ALL 3 ANOMALIES FIRST!';
          }
        }
      }

      state.levelInfo.interactionPrompt = promptText;

      return { reachedExit };
    },
    dispose() {
      chunkManager.dispose();
    }
  };
}
