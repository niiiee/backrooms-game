import { CELL, isWalkableCell } from '../gen/validator.js';

/**
 * First-person Player Controller:
 * - WASD + Mouse look
 * - Balanced Sprint with stamina drain (16.5/s) & exhaustion recovery
 * - Head bob, sprint camera shake/roll tilt, and low-stamina ragged breathing cues
 * - Flashlight with battery drain (0.92/s) & passive capacitor recovery up to 30%
 * - Sub-stepped Circle-vs-AABB depenetration collision (zero wall clipping,
 *   zero corner sticking, exact pillar hitbox matching, and map bounds lock)
 */
export class PlayerController {
  constructor(state, input, rendererManager, callbacks = {}) {
    this.state = state;
    this.input = input;
    this.rendererManager = rendererManager;
    this.callbacks = callbacks;

    this.walkSpeed = 4.4;
    this.sprintSpeed = 7.35;
    this.playerRadius = 0.42;
    this.eyeHeight = 1.72;

    this.bobTimer = 0;
    this.stepAccumulator = 0;
    this.breathTimer = 0;
    this.cameraRoll = 0;
  }

  spawnAt(gridX, gridZ, cellSize, yaw = 0) {
    const p = this.state.player;
    p.x = gridX * cellSize;
    p.z = gridZ * cellSize;
    p.y = this.eyeHeight;
    p.vx = 0;
    p.vz = 0;
    p.yaw = yaw;
    p.pitch = 0;
    p.stamina = p.maxStamina;
    p.exhausted = false;
    p.health = 100;
    p.sanity = 100;
    p.battery = Math.max(p.battery, 75);
    p.flashlightOn = true;
    this.cameraRoll = 0;
    this._updateFlashlightBeam();
    this._syncCamera(0, 0, false);
  }

  update(dt, levelData) {
    if (this.state.mode !== 'PLAYING' || !levelData) return;

    const p = this.state.player;

    // 1. Mouse look (guarded against NaN sensitivity)
    const { dx, dy } = this.input.consumeMouseDelta();
    const rawSens = Number(this.state.settings.sensitivity);
    const sens = 0.0022 * (Number.isFinite(rawSens) ? rawSens : 1.0);
    p.yaw -= (Number.isFinite(dx) ? dx : 0) * sens;
    p.pitch = Math.max(
      -1.42,
      Math.min(1.42, p.pitch - (Number.isFinite(dy) ? dy : 0) * sens)
    );

    if (this.input.isDown('KeyQ')) p.yaw += 1.9 * dt;

    // 2. Flashlight toggle (F, L, or Right-Click) & balanced battery logic
    const toggledFlashlight =
      this.input.consumeJustPressed('KeyF') ||
      this.input.consumeJustPressed('KeyL') ||
      this.input.consumeJustPressed('MouseRight');

    if (toggledFlashlight) {
      if (p.battery > 0) {
        p.flashlightOn = !p.flashlightOn;
      } else {
        p.flashlightOn = false;
      }
      if (this.callbacks.onFlashlightToggle) {
        this.callbacks.onFlashlightToggle(p.flashlightOn);
      }
    }

    if (p.flashlightOn) {
      p.battery = Math.max(0, p.battery - dt * 0.92);
      if (p.battery <= 0) {
        p.flashlightOn = false;
      }
    } else if (p.battery < 30) {
      // Emergency capacitor recovery up to 30% when turned off
      p.battery = Math.min(30, p.battery + dt * 2.5);
    }

    this._updateFlashlightBeam();

    // 3. Movement & Balanced Stamina
    const { forward, strafe } = this.input.getMovementAxes();
    const wantsToMove = Math.abs(forward) > 0.01 || Math.abs(strafe) > 0.01;
    const wantsSprint =
      (this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight')) &&
      wantsToMove &&
      !p.exhausted &&
      p.stamina > 1.0;

    p.isMoving = wantsToMove;
    p.isSprinting = wantsSprint;

    if (wantsSprint) {
      p.stamina = Math.max(0, p.stamina - dt * 16.5);
      if (p.stamina <= 0.5) {
        p.exhausted = true;
      }
    } else {
      const regenRate = wantsToMove ? 12.0 : 20.5;
      p.stamina = Math.min(p.maxStamina, p.stamina + dt * regenRate);
      if (p.exhausted && p.stamina >= 22) {
        p.exhausted = false;
      }
    }

    // Low-stamina & exhaustion breathing audio cues
    if (p.stamina < 42 || p.exhausted) {
      this.breathTimer -= dt;
      const strain = Math.max(0.15, Math.min(1.0, (42 - p.stamina) / 42));
      if (this.breathTimer <= 0) {
        this.breathTimer = p.exhausted ? 0.68 : 1.05 - strain * 0.35;
        if (this.callbacks.onBreathing) {
          this.callbacks.onBreathing(strain, p.exhausted);
        }
      }
    } else {
      this.breathTimer = Math.max(0, this.breathTimer - dt);
    }

    const baseSpeed = wantsSprint ? this.sprintSpeed : this.walkSpeed;
    const effectiveSpeed = baseSpeed * (p.speedMultiplier || 1.0);

    const sinY = Math.sin(p.yaw);
    const cosY = Math.cos(p.yaw);

    const forwardX = -sinY;
    const forwardZ = -cosY;
    const rightX = cosY;
    const rightZ = -sinY;

    const moveX = (forwardX * forward + rightX * strafe) * effectiveSpeed;
    const moveZ = (forwardZ * forward + rightZ * strafe) * effectiveSpeed;

    p.vx = moveX;
    p.vz = moveZ;

    // 4. Sub-stepped Circle-vs-AABB Depenetration Collision
    const prevX = p.x;
    const prevZ = p.z;
    const resolved = this.resolveWorldMotion(p.x, p.z, moveX * dt, moveZ * dt, levelData);
    p.x = resolved.x;
    p.z = resolved.z;
    p.y = this.eyeHeight;

    const movedDist = Math.hypot(p.x - prevX, p.z - prevZ);

    // 5. Acoustic Noise Radius (for Enemy AI hearing & stealth hiding)
    if (!wantsToMove) {
      p.noiseRadius = p.flashlightOn ? 2.0 : 0.8;
    } else if (wantsSprint) {
      p.noiseRadius = p.surfaceType === 'water' ? 18.5 : 14.0;
    } else {
      p.noiseRadius = p.surfaceType === 'water' ? 8.5 : 4.8;
    }

    // 6. Head-bob, Sprint Camera Shake & Footsteps
    if (wantsToMove && movedDist > 0.001) {
      const bobFreq = wantsSprint ? 14.2 : 8.6;
      this.bobTimer += dt * bobFreq;
      this.stepAccumulator += movedDist;

      const stepInterval = wantsSprint ? 1.85 : 1.45;
      if (this.stepAccumulator >= stepInterval) {
        this.stepAccumulator = 0;
        if (this.callbacks.onFootstep) {
          this.callbacks.onFootstep(p.surfaceType, wantsSprint);
        }
      }
    } else {
      // Gentle idle breathing camera sway when low on stamina
      const idleBreathRate = p.stamina < 40 ? 4.5 : 1.6;
      this.bobTimer += dt * idleBreathRate;
      this.stepAccumulator = 0;
    }

    const bobAmp = wantsToMove
      ? wantsSprint
        ? 0.072
        : 0.036
      : p.stamina < 40
        ? 0.014
        : 0.004;

    this._syncCamera(bobAmp, strafe, wantsSprint, dt);
  }

  /**
   * Moves (startX, startZ) by (deltaX, deltaZ) using sub-steps and iterative
   * circle-vs-AABB depenetration so the player smoothly slides along walls,
   * corners, and pillars without ever clipping or getting stuck.
   */
  resolveWorldMotion(startX, startZ, deltaX, deltaZ, levelData) {
    const totalDist = Math.hypot(deltaX, deltaZ);
    const maxStep = 0.14;
    const steps = Math.max(1, Math.min(12, Math.ceil(totalDist / maxStep)));
    const stepX = deltaX / steps;
    const stepZ = deltaZ / steps;

    let wx = startX;
    let wz = startZ;

    for (let s = 0; s < steps; s++) {
      wx += stepX;
      wz += stepZ;
      const pushed = this._depenetratePosition(wx, wz, levelData);
      wx = pushed.x;
      wz = pushed.z;
    }

    const minWorld = levelData.cellSize * 0.75;
    const maxWorldX = (levelData.width - 1.75) * levelData.cellSize;
    const maxWorldZ = (levelData.height - 1.75) * levelData.cellSize;
    wx = Math.max(minWorld, Math.min(maxWorldX, wx));
    wz = Math.max(minWorld, Math.min(maxWorldZ, wz));

    return { x: wx, z: wz };
  }

  _depenetratePosition(worldX, worldZ, levelData) {
    const { grid, width, height, cellSize } = levelData;
    const halfCell = cellSize * 0.5;
    const halfPillar = cellSize * 0.28;
    const r = this.playerRadius;

    let wx = worldX;
    let wz = worldZ;

    for (let iter = 0; iter < 2; iter++) {
      const centerCellX = Math.round(wx / cellSize);
      const centerCellZ = Math.round(wz / cellSize);

      for (let cz = centerCellZ - 1; cz <= centerCellZ + 1; cz++) {
        for (let cx = centerCellX - 1; cx <= centerCellX + 1; cx++) {
          let isObstacle = false;
          let halfExtent = halfCell;

          if (cx < 0 || cx >= width || cz < 0 || cz >= height) {
            isObstacle = true;
          } else {
            const cellVal = grid[cz * width + cx];
            if (!isWalkableCell(cellVal)) {
              isObstacle = true;
              if (cellVal === CELL.PILLAR) {
                halfExtent = halfPillar;
              }
            }
          }

          if (!isObstacle) continue;

          const boxCenterX = cx * cellSize;
          const boxCenterZ = cz * cellSize;
          const boxMinX = boxCenterX - halfExtent;
          const boxMaxX = boxCenterX + halfExtent;
          const boxMinZ = boxCenterZ - halfExtent;
          const boxMaxZ = boxCenterZ + halfExtent;

          const closestX = Math.max(boxMinX, Math.min(wx, boxMaxX));
          const closestZ = Math.max(boxMinZ, Math.min(wz, boxMaxZ));

          const dx = wx - closestX;
          const dz = wz - closestZ;
          const distSq = dx * dx + dz * dz;

          if (distSq < r * r) {
            if (distSq > 1e-8) {
              const dist = Math.sqrt(distSq);
              const overlap = r - dist;
              wx += (dx / dist) * overlap;
              wz += (dz / dist) * overlap;
            } else {
              const penLeft = Math.abs(wx - boxMinX);
              const penRight = Math.abs(boxMaxX - wx);
              const penTop = Math.abs(wz - boxMinZ);
              const penBottom = Math.abs(boxMaxZ - wz);
              const minPen = Math.min(penLeft, penRight, penTop, penBottom);
              if (minPen === penLeft) wx = boxMinX - r;
              else if (minPen === penRight) wx = boxMaxX + r;
              else if (minPen === penTop) wz = boxMinZ - r;
              else wz = boxMaxZ + r;
            }
          }
        }
      }
    }

    return { x: wx, z: wz };
  }

  _updateFlashlightBeam() {
    const p = this.state.player;
    const light = this.rendererManager.flashlight;
    if (!p.flashlightOn || p.battery <= 0) {
      if (this.rendererManager.setFlashlightOutput) {
        this.rendererManager.setFlashlightOutput(false, 0);
      } else if (light) {
        light.intensity = 0;
      }
      return;
    }
    let flicker = 1.0;
    if (p.battery < 20) {
      const t = performance.now() * 0.02;
      flicker = Math.sin(t * 3.7) * Math.cos(t * 7.3) > 0.35 ? 0.2 : 0.85;
    }
    const batteryScale = 0.45 + 0.55 * (p.battery / p.maxBattery);
    const factor = batteryScale * flicker;
    if (this.rendererManager.setFlashlightOutput) {
      this.rendererManager.setFlashlightOutput(true, factor);
    } else if (light) {
      light.intensity = 28.0 * factor;
    }
  }

  _syncCamera(bobAmp, strafe = 0, isSprinting = false, dt = 0.016) {
    const p = this.state.player;
    const cam = this.rendererManager.camera;
    const bobY = Math.sin(this.bobTimer) * bobAmp;
    const bobX = Math.cos(this.bobTimer * 0.5) * bobAmp * 0.55;

    // Sprint camera shake + proximity danger tremor
    const closestDist = this.state.levelInfo?.closestEnemyDist ?? Infinity;
    const dangerTremor = closestDist < 9.0 ? (1.0 - closestDist / 9.0) * 0.018 : 0;
    const sprintShake = isSprinting ? 0.012 : 0;
    const totalShake = sprintShake + dangerTremor;

    const shakeX = totalShake > 0 ? Math.sin(this.bobTimer * 3.7) * totalShake : 0;
    const shakeY = totalShake > 0 ? Math.cos(this.bobTimer * 5.3) * totalShake : 0;

    // Smooth camera roll tilt when strafing or sprinting
    const targetRoll =
      -strafe * 0.022 + (isSprinting ? Math.sin(this.bobTimer * 0.5) * 0.016 : 0);
    this.cameraRoll += (targetRoll - this.cameraRoll) * Math.min(1, dt * 10.0);

    cam.position.set(p.x + bobX + shakeX, p.y + bobY + shakeY, p.z);
    cam.rotation.y = p.yaw;
    cam.rotation.x = p.pitch;
    if ('z' in cam.rotation) {
      cam.rotation.z = this.cameraRoll;
    }

    // Subtle handheld flashlight sway & immediate child SpotLight world matrix sync
    if (this.rendererManager.flashlightRig) {
      this.rendererManager.flashlightRig.position.x = 0.26 + bobX * 0.45;
      this.rendererManager.flashlightRig.position.y = -0.22 + bobY * 0.55;
      this.rendererManager.flashlightRig.rotation.x = bobY * 0.35;
      this.rendererManager.flashlightRig.rotation.y = -strafe * 0.035 + bobX * 0.4;
    }
    if (typeof cam.updateMatrixWorld === 'function') {
      cam.updateMatrixWorld(true);
    }
  }
}
