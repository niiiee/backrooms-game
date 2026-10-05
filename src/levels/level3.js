import * as THREE from 'three';
import { isWalkableCell } from '../gen/validator.js';
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
 * LEVEL 3: "THE POOLROOMS" (Subliminal Aqua Ceramic Complexes)
 * - Look: 4.5m vaulted ceiling, cylindrical ceramic columns, translucent rippling turquoise
 *   water plane, dry tiled step-islands in Large Halls, ethereal cyan daylight shafts.
 * - Unique Mechanic: Flooded Water Drag, Dry Refuge Platforms & Floodgate Drainage Valves.
 */
export function createLevel(scene, state, rendererManager, quality = 'Medium') {
  const levelData = generateLevelArchitecture({
    levelIndex: 3,
    seed: state.seed,
    width: 38,
    height: 38,
    hallCount: 4,
    roomCount: 9,
    deadEndCount: 10,
    loopCount: 6,
    pillarDensity: 0.65,
    objectiveCount: 3,
    hazardCount: 5,
    minExitDistance: 19,
    corridorBias: 'pools'
  });

  const themeConfig = {
    textureTheme: 'level3',
    wallHeight: 4.5,
    pillarShape: 'cylinder',
    wallRoughness: 0.24,
    wallMetalness: 0.14,
    floorRoughness: 0.2,
    floorMetalness: 0.25,
    pillarTint: 0xd8f4f4,
    lightColor: 0xc2fffb,
    lightIntensity: 2.55,
    objectiveLabel: 'Floodgate Drainage Valve',
    objectiveColor: 0x228b8d,
    hazardColor: 0x156568,
    hazardEmissive: 0x08383a,
    hazardPlumeColor: 0x80f5ff,
    hasOverheadPipes: false
  };

  rendererManager.configureAtmosphere({
    bgColor: 0x102c2e,
    fogColor: 0x183f42,
    fogDensity: 0.036,
    ambientSky: 0xc4f7f5,
    ambientGround: 0x1d4e52,
    ambientIntensity: 0.56
  });

  state.player.surfaceType = 'water';
  state.player.speedMultiplier = 0.76;

  const chunkManager = new ChunkManager(scene, levelData, themeConfig, quality);

  // Translucent rippling water plane spanning the level
  const worldSpan = levelData.width * levelData.cellSize;
  const waterGeo = new THREE.PlaneGeometry(worldSpan, worldSpan, 20, 20);
  waterGeo.rotateX(-Math.PI * 0.5);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x2ec4b6,
    emissive: 0x0b3b3c,
    emissiveIntensity: 0.35,
    roughness: 0.12,
    metalness: 0.35,
    transparent: true,
    opacity: 0.58
  });
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.position.set(worldSpan * 0.5, 0.52, worldSpan * 0.5);
  scene.add(waterMesh);

  // Add raised dry tiled refuge platforms at the center of Large Halls
  const platformGroup = new THREE.Group();
  const platformGeo = new THREE.BoxGeometry(3.2, 0.62, 3.2);
  const platformMat = new THREE.MeshStandardMaterial({
    color: 0xdff6f6,
    roughness: 0.25,
    metalness: 0.1
  });
  const dryPlatforms = [];
  for (const hall of levelData.halls) {
    const px = hall.cx * levelData.cellSize;
    const pz = hall.cz * levelData.cellSize;
    const mesh = new THREE.Mesh(platformGeo, platformMat);
    mesh.position.set(px, 0.31, pz);
    platformGroup.add(mesh);
    dryPlatforms.push({ x: px, z: pz, radius: 1.75 });
  }
  scene.add(platformGroup);

  let objectivesCompleted = 0;
  const objectivesTotal = levelData.objectives.length;
  let exitUnlocked = objectivesTotal === 0;
  chunkManager.setExitUnlocked(exitUnlocked);

  state.levelInfo = {
    index: 3,
    name: 'LEVEL 3 // THE POOLROOMS',
    subtitle: 'Subliminal Hydro-Ceramic Chambers',
    mechanicHint: 'Turn 3 Floodgate Drainage Valves [E] to drain water & unlock EXIT',
    objectivesCompleted,
    objectivesTotal,
    exitUnlocked,
    interactionPrompt: '',
    warningMessage: '',
    chaseActive: false,
    closestEnemyDist: Infinity,
    audioProfile: {
      humFreq: 48,
      humGain: 0.09,
      dronePitch: 64
    },
    enemiesConfig: [
      { type: 'hound', count: 2 },
      { type: 'howler', count: 1 }
    ]
  };

  return {
    id: 3,
    levelData,
    chunkManager,
    waterMesh,
    update(dt, elapsedTime, input, audioSynth) {
      const p = state.player;

      const drainProgress = objectivesTotal > 0 ? objectivesCompleted / objectivesTotal : 1;
      const targetWaterY = 0.52 * (1 - drainProgress) - (drainProgress >= 1 ? 0.15 : 0);
      waterMesh.position.y += (targetWaterY - waterMesh.position.y) * Math.min(1, dt * 3.0);
      waterMesh.position.y += Math.sin(elapsedTime * 2.4) * 0.008;

      // Check if player is standing on a raised dry tiled refuge platform
      let onDryPlatform = false;
      for (const plat of dryPlatforms) {
        if (Math.hypot(p.x - plat.x, p.z - plat.z) <= plat.radius) {
          onDryPlatform = true;
          break;
        }
      }

      if (drainProgress >= 1 || onDryPlatform) {
        p.surfaceType = 'concrete';
        p.speedMultiplier = 1.0;
      } else {
        p.surfaceType = 'water';
        p.speedMultiplier = 0.76 + 0.24 * drainProgress;
      }

      // Check Whirlpool / Undertow Drain Hazards with safe collision margin
      for (const hv of chunkManager.hazardVisuals) {
        if (!hv.active || drainProgress >= 1) continue;
        const hx = hv.data.x * levelData.cellSize;
        const hz = hv.data.z * levelData.cellSize;
        const dx = hx - p.x;
        const dz = hz - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 2.6 && dist > 0.35) {
          const nextX = p.x + (dx / dist) * dt * 0.95;
          const nextZ = p.z + (dz / dist) * dt * 0.95;
          const gx = Math.round(nextX / levelData.cellSize);
          const gz = Math.round(nextZ / levelData.cellSize);
          if (
            gx > 0 &&
            gx < levelData.width - 1 &&
            gz > 0 &&
            gz < levelData.height - 1 &&
            isWalkableCell(levelData.grid[gz * levelData.width + gx])
          ) {
            const cellCenterX = gx * levelData.cellSize;
            const cellCenterZ = gz * levelData.cellSize;
            if (
              Math.abs(nextX - cellCenterX) < levelData.cellSize * 0.38 &&
              Math.abs(nextZ - cellCenterZ) < levelData.cellSize * 0.38
            ) {
              p.x = nextX;
              p.z = nextZ;
            }
          }
          p.noiseRadius = Math.max(p.noiseRadius, 18.0);
          if (!state.levelInfo.warningMessage.startsWith('⚠')) {
            state.levelInfo.warningMessage = 'STRONG DRAINAGE CURRENT — SPLASH NOISE ELEVATED';
          }
        }
      }

      let promptText = '';
      let nearestTarget = null;
      let nearestDist = Infinity;

      // Check Floodgate Drainage Valves
      for (const item of chunkManager.interactiveMeshes) {
        if (item.data.activated) continue;
        const ox = item.data.x * levelData.cellSize;
        const oz = item.data.z * levelData.cellSize;
        const dist = Math.hypot(p.x - ox, p.z - oz);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestTarget = { x: ox, z: oz, label: 'Drainage Valve' };
        }
        if (dist < 2.6) {
          promptText = `[E] Turn ${item.label}`;
          if (input.consumeJustPressed('KeyE')) {
            item.data.activated = true;
            item.indicatorMat.color.setHex(0x32d74b);
            item.indicatorMat.emissive.setHex(0x22cc44);
            objectivesCompleted++;
            p.stamina = Math.min(p.maxStamina, p.stamina + 30);
            p.battery = Math.min(p.maxBattery, p.battery + 15);
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
        state.levelInfo.mechanicHint = formatSignalBearing(p, ex, ez, 'Dry Stairwell Exit');
      } else if (nearestTarget) {
        state.levelInfo.mechanicHint = `Drain Valves [E] — ${formatSignalBearing(
          p,
          nearestTarget.x,
          nearestTarget.z,
          nearestTarget.label
        )}`;
      }

      if (exitDist < 2.6) {
        if (exitUnlocked) {
          promptText = '[E] Ascend Dry Stairwell -> Level 4 (Office Maze)';
          if (input.consumeJustPressed('KeyE') || exitDist < 1.35) {
            reachedExit = true;
          }
        } else {
          promptText = `Exit Floodgate Submerged (${objectivesCompleted}/${objectivesTotal} Valves Drained)`;
        }
      }

      state.levelInfo.interactionPrompt = promptText;

      const chunkStats = chunkManager.update(p, elapsedTime, 1.0);
      state.metrics.activeChunks = chunkStats.activeChunks;
      state.metrics.totalChunks = chunkStats.totalChunks;

      return { reachedExit };
    },
    dispose() {
      state.player.surfaceType = 'carpet';
      state.player.speedMultiplier = 1.0;
      scene.remove(waterMesh);
      scene.remove(platformGroup);
      waterGeo.dispose();
      waterMat.dispose();
      platformGeo.dispose();
      platformMat.dispose();
      chunkManager.dispose();
    }
  };
}
