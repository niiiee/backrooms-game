import * as THREE from 'three';
import { CELL, isWalkableCell } from '../gen/validator.js';
import { findPathAStar, hasLineOfSight } from './pathfinding.js';

/**
 * Creates a custom GLSL distortion & glitch-slice ShaderMaterial for entity void auras.
 */
export function createEntityAuraShaderMaterial(accentHex = 0xff2200) {
  const c = new THREE.Color(accentHex);
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAgitation: { value: 0.2 },
      uAccent: { value: new THREE.Vector3(c.r, c.g, c.b) }
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uAgitation;
      varying vec2 vUv;
      varying float vSlice;
      void main() {
        vUv = uv;
        vec3 pos = position;
        float sliceBand = sin(pos.y * 18.0 + uTime * 28.0);
        vSlice = sliceBand;
        if (sliceBand > 0.72) {
          pos.x += sin(uTime * 65.0 + pos.y * 12.0) * 0.14 * uAgitation;
          pos.z += cos(uTime * 53.0 + pos.y * 9.0) * 0.10 * uAgitation;
        }
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uAgitation;
      uniform vec3 uAccent;
      varying vec2 vUv;
      varying float vSlice;
      void main() {
        float pulse = 0.5 + 0.5 * sin(uTime * 12.0 + vUv.y * 14.0);
        float glitchBar = step(0.82, fract(vUv.y * 16.0 + uTime * 4.5));
        vec3 col = mix(vec3(0.02, 0.01, 0.01), uAccent, glitchBar * 0.65 + pulse * 0.25 * uAgitation);
        float alpha = (0.12 + 0.24 * uAgitation) * (0.6 + 0.4 * glitchBar);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

/**
 * Shared Base Enemy AI Controller implementing:
 * - States: 'patrol' | 'investigate' | 'warning' | 'chase' | 'search'
 * - Grid A* pathfinding + direct sub-cell pursuit when in close line-of-sight
 * - Line-of-Sight + Acoustic Hearing detection + Stealth hiding counterplay
 * - Directional stereo pan calculation & periodic entity vocalizations
 * - Anti-stuck recovery & clear warning cue before every chase
 */
export class BaseEnemy {
  constructor(levelData, config = {}) {
    this.levelData = levelData;
    this.type = config.type || 'entity';
    this.name = config.name || 'Unknown Entity';

    this.patrolSpeed = config.patrolSpeed ?? 2.2;
    this.investigateSpeed = config.investigateSpeed ?? 3.1;
    this.chaseSpeed = config.chaseSpeed ?? 5.2;
    this.sightRange = config.sightRange ?? 20.0;
    this.hearingMultiplier = config.hearingMultiplier ?? 1.0;
    this.warningDuration = config.warningDuration ?? 0.95;
    this.loseSightDuration = config.loseSightDuration ?? 3.8;
    this.searchDuration = config.searchDuration ?? 5.5;
    this.catchRadius = config.catchRadius ?? 1.15;
    this.collisionRadius = 0.38;

    this.state = 'patrol'; // 'patrol' | 'investigate' | 'warning' | 'chase' | 'search'
    this.x = 0;
    this.z = 0;
    this.yaw = 0;

    this.path = [];
    this.repathTimer = 0;
    this.stateTimer = 0;
    this.sightLostTimer = 0;
    this.animTime = 0;
    this.vocalizeTimer = 2.0 + Math.random() * 2.5;

    this.stuckCheckTimer = 0;
    this.lastCheckX = 0;
    this.lastCheckZ = 0;

    this.targetGridPos = null;
    this.lastKnownPlayerGrid = null;
    this.warningTriggeredForCurrentChase = false;

    this.group = new THREE.Group();
    this.eyeLight = null;
    this.auraMat = null;
  }

  spawnAtGrid(gx, gz) {
    const cs = this.levelData.cellSize;
    this.x = gx * cs;
    this.z = gz * cs;
    this.lastCheckX = this.x;
    this.lastCheckZ = this.z;
    this.state = 'patrol';
    this.path = [];
    this.group.position.set(this.x, 0, this.z);
  }

  /**
   * Computes left/right stereo pan [-1, 1] relative to the player's facing yaw.
   */
  computeStereoPan(player) {
    if (!player) return 0;
    const dx = this.x - player.x;
    const dz = this.z - player.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return 0;
    const rightX = Math.cos(player.yaw || 0);
    const rightZ = -Math.sin(player.yaw || 0);
    const pan = (dx / dist) * rightX + (dz / dist) * rightZ;
    return Math.max(-1, Math.min(1, pan));
  }

  setState(newState, callbacks = {}, player = null) {
    if (this.state === newState) return;
    const prevState = this.state;
    this.state = newState;
    this.stateTimer = 0;

    if (newState === 'warning') {
      this.path = [];
      this.warningTriggeredForCurrentChase = true;
      if (callbacks.onWarningCue) {
        callbacks.onWarningCue(this, this.computeStereoPan(player));
      }
    } else if (newState === 'chase') {
      this.repathTimer = 0;
      this.sightLostTimer = 0;
      if (callbacks.onChaseStart && prevState !== 'warning') {
        callbacks.onChaseStart(this, this.computeStereoPan(player));
      }
    } else if (newState === 'search') {
      this.repathTimer = 0;
    } else if (newState === 'patrol') {
      this.warningTriggeredForCurrentChase = false;
      this.repathTimer = 0;
    }
  }

  canSeePlayer(player) {
    const { grid, width, height, cellSize } = this.levelData;
    const effectiveSight = this.getEffectiveSightRange(player);
    const dist = Math.hypot(player.x - this.x, player.z - this.z);
    if (dist > effectiveSight) return false;

    if (this.state === 'patrol') {
      const toPlayerX = (player.x - this.x) / (dist || 1);
      const toPlayerZ = (player.z - this.z) / (dist || 1);
      const forwardX = Math.sin(this.yaw);
      const forwardZ = Math.cos(this.yaw);
      const dot = toPlayerX * forwardX + toPlayerZ * forwardZ;
      if (dot < -0.25 && dist > 4.5) {
        return false;
      }
    }

    return hasLineOfSight(
      grid,
      width,
      height,
      cellSize,
      this.x,
      this.z,
      player.x,
      player.z,
      effectiveSight
    );
  }

  canHearPlayer(player) {
    const dist = Math.hypot(player.x - this.x, player.z - this.z);
    const audibleRange = (player.noiseRadius || 1.5) * this.hearingMultiplier;
    return dist <= audibleRange;
  }

  getEffectiveSightRange(player) {
    return player.flashlightOn ? this.sightRange * 1.1 : this.sightRange * 0.65;
  }

  getEffectiveSpeed(_player) {
    if (this.state === 'chase') return this.chaseSpeed;
    if (this.state === 'investigate') return this.investigateSpeed;
    if (this.state === 'search') return this.investigateSpeed * 0.85;
    if (this.state === 'warning') return 0.35;
    return this.patrolSpeed;
  }

  computePathTo(goalGridX, goalGridZ) {
    const { grid, width, height, cellSize } = this.levelData;
    const startX = Math.round(this.x / cellSize);
    const startZ = Math.round(this.z / cellSize);
    this.path = findPathAStar(grid, width, height, startX, startZ, goalGridX, goalGridZ);
  }

  pickPatrolWaypoint() {
    const waypoints = this.levelData.patrolWaypoints;
    if (!waypoints || waypoints.length === 0) return;

    const cs = this.levelData.cellSize;
    const curX = Math.round(this.x / cs);
    const curZ = Math.round(this.z / cs);

    const distant = waypoints.filter(
      (wp) => Math.abs(wp.x - curX) + Math.abs(wp.z - curZ) >= 4
    );
    const pool = distant.length > 0 ? distant : waypoints;
    const pick = pool[Math.floor(Math.random() * pool.length)];

    this.targetGridPos = { x: pick.x, z: pick.z };
    this.computePathTo(pick.x, pick.z);
  }

  update(dt, player, callbacks = {}) {
    this.animTime += dt;
    this.stateTimer += dt;
    this.repathTimer -= dt;
    this.vocalizeTimer -= dt;

    const cs = this.levelData.cellSize;
    const distToPlayer = Math.hypot(player.x - this.x, player.z - this.z);
    const seesPlayer = this.canSeePlayer(player);
    const hearsPlayer = this.canHearPlayer(player);
    const stereoPan = this.computeStereoPan(player);

    const playerGrid = {
      x: Math.round(player.x / cs),
      z: Math.round(player.z / cs)
    };

    if (seesPlayer) {
      this.lastKnownPlayerGrid = { ...playerGrid };
    }

    // Check catch condition
    if (distToPlayer <= this.catchRadius && (this.state === 'chase' || distToPlayer <= 0.85)) {
      if (callbacks.onCatchPlayer) {
        callbacks.onCatchPlayer(this);
      }
      return { distToPlayer, state: this.state, stereoPan };
    }

    // Periodic directional entity vocalizations when nearby
    if (this.vocalizeTimer <= 0) {
      const interval =
        this.state === 'chase'
          ? 1.6 + Math.random() * 1.1
          : this.state === 'investigate'
            ? 2.8 + Math.random() * 1.5
            : 4.5 + Math.random() * 2.5;
      this.vocalizeTimer = interval;
      if (distToPlayer < 24.0 && callbacks.onVocalize) {
        callbacks.onVocalize(this, distToPlayer, stereoPan);
      }
    }

    // State Machine Transitions
    switch (this.state) {
      case 'patrol': {
        if (seesPlayer) {
          this.setState('warning', callbacks, player);
        } else if (hearsPlayer) {
          this.targetGridPos = { ...playerGrid };
          this.computePathTo(playerGrid.x, playerGrid.z);
          this.setState('investigate', callbacks, player);
        } else if (this.path.length === 0 || this.repathTimer <= 0) {
          this.pickPatrolWaypoint();
          this.repathTimer = 8.0;
        }
        break;
      }

      case 'investigate': {
        if (seesPlayer) {
          this.setState('warning', callbacks, player);
        } else if (hearsPlayer && this.repathTimer <= 0) {
          this.targetGridPos = { ...playerGrid };
          this.computePathTo(playerGrid.x, playerGrid.z);
          this.repathTimer = 1.2;
        } else if (this.path.length === 0 || this.stateTimer > 9.0) {
          this.lastKnownPlayerGrid = this.targetGridPos || { ...playerGrid };
          this.setState('search', callbacks, player);
        }
        break;
      }

      case 'warning': {
        this.yaw = Math.atan2(player.x - this.x, player.z - this.z);
        if (this.stateTimer >= this.warningDuration) {
          this.lastKnownPlayerGrid = { ...playerGrid };
          this.computePathTo(playerGrid.x, playerGrid.z);
          this.setState('chase', callbacks, player);
        }
        break;
      }

      case 'chase': {
        if (seesPlayer) {
          this.sightLostTimer = 0;
          this.lastKnownPlayerGrid = { ...playerGrid };
          if (this.repathTimer <= 0) {
            this.computePathTo(playerGrid.x, playerGrid.z);
            this.repathTimer = 0.45;
          }
        } else {
          const stealthMultiplier = !player.flashlightOn && !player.isSprinting ? 1.65 : 1.0;
          this.sightLostTimer += dt * stealthMultiplier;
        }

        if (this.sightLostTimer >= this.loseSightDuration) {
          this.setState('search', callbacks, player);
        }
        break;
      }

      case 'search': {
        if (seesPlayer) {
          if (this.stateTimer > 2.0) {
            this.setState('warning', callbacks, player);
          } else {
            this.setState('chase', callbacks, player);
          }
          break;
        }
        if (hearsPlayer) {
          this.targetGridPos = { ...playerGrid };
          this.computePathTo(playerGrid.x, playerGrid.z);
          this.setState('investigate', callbacks, player);
          break;
        }

        if (this.path.length === 0 && this.repathTimer <= 0 && this.lastKnownPlayerGrid) {
          const { grid, width, height } = this.levelData;
          const offsets = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [2, 0],
            [-2, 0],
            [0, 2],
            [0, -2]
          ];
          const cand = offsets[Math.floor(Math.random() * offsets.length)];
          const nx = Math.max(1, Math.min(width - 2, this.lastKnownPlayerGrid.x + cand[0]));
          const nz = Math.max(1, Math.min(height - 2, this.lastKnownPlayerGrid.z + cand[1]));
          const targetCell = grid[nz * width + nx];
          if (isWalkableCell(targetCell)) {
            this.computePathTo(nx, nz);
          }
          this.repathTimer = 1.5;
        }

        if (this.stateTimer >= this.searchDuration) {
          this.setState('patrol', callbacks, player);
        }
        break;
      }
    }

    // Move along A* path or direct LOS pursuit
    this._followPath(dt, player, seesPlayer, distToPlayer);

    // Anti-stuck watchdog
    if (this.state !== 'warning') {
      this.stuckCheckTimer += dt;
      if (this.stuckCheckTimer >= 1.4) {
        const moved = Math.hypot(this.x - this.lastCheckX, this.z - this.lastCheckZ);
        this.lastCheckX = this.x;
        this.lastCheckZ = this.z;
        this.stuckCheckTimer = 0;
        if (moved < 0.2) {
          this.pickPatrolWaypoint();
        }
      }
    }

    // Update custom shader aura uniforms if present
    if (this.auraMat && this.auraMat.uniforms) {
      this.auraMat.uniforms.uTime.value = this.animTime;
      this.auraMat.uniforms.uAgitation.value =
        this.state === 'warning' ? 1.0 : this.state === 'chase' ? 0.85 : 0.22;
    }

    this._animateVisuals(dt, player);

    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.yaw;

    return { distToPlayer, state: this.state, stereoPan };
  }

  _followPath(dt, player, seesPlayer = false, distToPlayer = Infinity) {
    if (this.state === 'warning') return;

    const cs = this.levelData.cellSize;
    let targetX = null;
    let targetZ = null;

    if (this.state === 'chase' && seesPlayer && distToPlayer < 6.5) {
      targetX = player.x;
      targetZ = player.z;
    } else if (this.path.length > 0) {
      const nextNode = this.path[0];
      targetX = nextNode.x * cs;
      targetZ = nextNode.z * cs;
    } else if (this.state === 'chase' && seesPlayer) {
      targetX = player.x;
      targetZ = player.z;
    }

    if (targetX === null || targetZ === null) return;

    const dx = targetX - this.x;
    const dz = targetZ - this.z;
    const dist = Math.hypot(dx, dz);

    const speed = this.getEffectiveSpeed(player);
    const step = speed * dt;

    if (this.path.length > 0 && !(this.state === 'chase' && seesPlayer && distToPlayer < 6.5)) {
      if (dist <= Math.max(0.25, step)) {
        this.x = targetX;
        this.z = targetZ;
        this.path.shift();
        return;
      }
    }

    if (dist > 0.01) {
      const nextX = this.x + (dx / dist) * step;
      const nextZ = this.z + (dz / dist) * step;
      const pushed = this._depenetrateEnemy(nextX, nextZ);
      this.x = pushed.x;
      this.z = pushed.z;
      this.yaw = Math.atan2(dx, dz);
    }
  }

  _depenetrateEnemy(worldX, worldZ) {
    const { grid, width, height, cellSize } = this.levelData;
    const halfCell = cellSize * 0.5;
    const halfPillar = cellSize * 0.28;
    const r = this.collisionRadius;

    let wx = worldX;
    let wz = worldZ;

    const centerCellX = Math.round(wx / cellSize);
    const centerCellZ = Math.round(wz / cellSize);

    for (let cz = centerCellZ - 1; cz <= centerCellZ + 1; cz++) {
      for (let cx = centerCellX - 1; cx <= centerCellX + 1; cx++) {
        if (cx < 0 || cx >= width || cz < 0 || cz >= height) continue;
        const cellVal = grid[cz * width + cx];
        if (isWalkableCell(cellVal)) continue;

        const halfExtent = cellVal === CELL.PILLAR ? halfPillar : halfCell;
        const boxCenterX = cx * cellSize;
        const boxCenterZ = cz * cellSize;

        const closestX = Math.max(boxCenterX - halfExtent, Math.min(wx, boxCenterX + halfExtent));
        const closestZ = Math.max(boxCenterZ - halfExtent, Math.min(wz, boxCenterZ + halfExtent));
        const dx = wx - closestX;
        const dz = wz - closestZ;
        const dSq = dx * dx + dz * dz;
        if (dSq < r * r && dSq > 1e-8) {
          const d = Math.sqrt(dSq);
          wx += (dx / d) * (r - d);
          wz += (dz / d) * (r - d);
        }
      }
    }

    return { x: wx, z: wz };
  }

  _animateVisuals(_dt, _player) {}

  dispose(scene) {
    if (scene) {
      scene.remove(this.group);
    } else if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    const disposedGeos = new Set();
    const disposedMats = new Set();
    this.group.traverse((obj) => {
      if (obj.geometry && !disposedGeos.has(obj.geometry)) {
        disposedGeos.add(obj.geometry);
        obj.geometry.dispose();
      }
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m && !disposedMats.has(m)) {
            disposedMats.add(m);
            m.dispose();
          }
        }
      }
    });
  }
}
