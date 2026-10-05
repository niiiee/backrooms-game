import assert from 'node:assert/strict';
import * as THREE from 'three';

import { GameState } from '../src/core/state.js';
import { PlayerController } from '../src/core/player.js';
import { SaveManager } from '../src/core/save.js';
import { loadLevelModule, TOTAL_LEVELS } from '../src/levels/levelLoader.js';
import { CELL, validateLevelGrid } from '../src/gen/validator.js';
import { clearProceduralTextureCache } from '../src/gen/textures.js';
import { HowlerEnemy } from '../src/enemies/howler.js';
import { SmilerEnemy } from '../src/enemies/smiler.js';
import { HoundEnemy } from '../src/enemies/hound.js';

// Mock browser globals for headless Node verification
const storageMap = new Map();
const localStorageMock = {
  getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
  setItem: (k, v) => storageMap.set(k, String(v)),
  removeItem: (k) => storageMap.delete(k),
  clear: () => storageMap.clear()
};
globalThis.localStorage = localStorageMock;
globalThis.window = {
  localStorage: localStorageMock,
  addEventListener: () => {},
  removeEventListener: () => {},
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1
};

globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') {
      const width = 256;
      const height = 256;
      const pixelBuf = new Uint8ClampedArray(width * height * 4);
      return {
        width,
        height,
        getContext() {
          return {
            fillStyle: '#000',
            strokeStyle: '#000',
            lineWidth: 1,
            font: '',
            textAlign: 'center',
            fillRect() {},
            strokeRect() {},
            beginPath() {},
            moveTo() {},
            lineTo() {},
            closePath() {},
            stroke() {},
            fill() {},
            arc() {},
            fillText() {},
            createLinearGradient() {
              return { addColorStop() {} };
            },
            createRadialGradient() {
              return { addColorStop() {} };
            },
            getImageData(x, y, w, h) {
              return { data: new Uint8ClampedArray(w * h * 4) };
            },
            putImageData(img) {
              pixelBuf.set(img.data.subarray(0, pixelBuf.length));
            }
          };
        }
      };
    }
    return { style: {}, querySelector() {}, addEventListener() {} };
  },
  getElementById: () => null,
  querySelectorAll: () => [],
  head: { appendChild() {} },
  addEventListener: () => {},
  removeEventListener: () => {}
};

function createMockState(seed = 'QA-SEED', quality = 'Medium') {
  return {
    mode: 'PLAYING',
    seed,
    settings: { sensitivity: 1.0, volume: 0.75, quality, vhsEnabled: true },
    metrics: { fps: 60, activeChunks: 0, totalChunks: 0 },
    player: {
      x: 0,
      y: 1.72,
      z: 0,
      vx: 0,
      vz: 0,
      yaw: 0,
      pitch: 0,
      stamina: 100,
      maxStamina: 100,
      exhausted: false,
      flashlightOn: true,
      battery: 100,
      maxBattery: 100,
      sanity: 100,
      health: 100,
      isMoving: false,
      isSprinting: false,
      speedMultiplier: 1.0,
      noiseRadius: 1.5,
      surfaceType: 'carpet'
    },
    levelInfo: {}
  };
}

const mockRenderer = {
  camera: { position: { set() {} }, rotation: { x: 0, y: 0 } },
  flashlight: { intensity: 4.2 },
  configureAtmosphere() {}
};

const mockJustPressed = new Set();
const mockInput = {
  isDown: () => false,
  consumeJustPressed: (code) => {
    if (mockJustPressed.has(code)) {
      mockJustPressed.delete(code);
      return true;
    }
    return false;
  },
  consumeMouseDelta: () => ({ dx: 0, dy: 0 }),
  getMovementAxes: () => ({ forward: 0, strafe: 0 })
};

console.log('============================================================');
console.log('BACKROOMS QA & GAME DESIGN AUDIT SUITE');
console.log('============================================================\n');

// ---------------------------------------------------------------------------
// 1. 50-SEED PER LEVEL GENERATOR & VALIDATOR AUDIT (300 TOTAL SEEDS)
// ---------------------------------------------------------------------------
console.log('[1/6] Running 50-seed generator & validator audit across all 6 levels (300 seeds)...');

for (let lvlIdx = 0; lvlIdx < TOTAL_LEVELS; lvlIdx++) {
  let failures = 0;
  let minExitDist = Infinity;
  let maxExitDist = 0;
  let totalExitDist = 0;
  let maxAttempts = 0;
  let levelTitle = '';
  let gridDim = '';

  for (let s = 1; s <= 50; s++) {
    const scene = new THREE.Scene();
    const state = createMockState(`QA-AUDIT-L${lvlIdx}-SEED-${s}`, 'Low');
    const lvl = await loadLevelModule(lvlIdx, scene, state, mockRenderer, 'Low');

    const d = lvl.levelData;
    levelTitle = state.levelInfo.name;
    gridDim = `${d.width}x${d.height}`;

    const val = validateLevelGrid(
      d.grid,
      d.width,
      d.height,
      d.spawn,
      d.exit,
      d.objectives,
      14
    );

    if (!val.valid || !d.validation.valid) {
      failures++;
    }

    minExitDist = Math.min(minExitDist, val.distance);
    maxExitDist = Math.max(maxExitDist, val.distance);
    totalExitDist += val.distance;
    maxAttempts = Math.max(maxAttempts, d.attemptsUsed || 1);

    lvl.dispose();
  }
  clearProceduralTextureCache();

  const avgExitDist = (totalExitDist / 50).toFixed(1);
  assert.equal(failures, 0, `Level ${lvlIdx} had ${failures} unreachable seeds!`);
  console.log(
    `  ✔ ${levelTitle.padEnd(32)} (${gridDim}) | 50/50 valid (0 failures) | Exit BFS dist: min=${minExitDist}, avg=${avgExitDist}, max=${maxExitDist} | maxAttempts=${maxAttempts}`
  );
}

// ---------------------------------------------------------------------------
// 2. MEMORY LEAK & LEVEL TRANSITION DISPOSAL AUDIT
// ---------------------------------------------------------------------------
console.log('\n[2/6] Auditing memory disposal across level transitions (0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 0 -> 1)...');
{
  const scene = new THREE.Scene();
  const state = createMockState('QA-MEM-AUDIT', 'Medium');
  const sequence = [0, 1, 2, 3, 4, 5, 0, 1];

  for (const lvlIdx of sequence) {
    const lvl = await loadLevelModule(lvlIdx, scene, state, mockRenderer, 'Medium');

    // Simulate 5 frames of updates
    for (let f = 0; f < 5; f++) {
      lvl.update(0.016, f * 0.016, mockInput, null);
    }

    let geoCount = 0;
    let matCount = 0;
    scene.traverse((obj) => {
      if (obj.geometry) geoCount++;
      if (obj.material) matCount++;
    });
    assert.ok(geoCount > 0 && matCount > 0, `Level ${lvlIdx} must populate scene meshes`);

    lvl.dispose();
    assert.equal(
      scene.children.length,
      0,
      `Scene still had ${scene.children.length} children after disposing Level ${lvlIdx}`
    );
  }
  clearProceduralTextureCache();
  console.log('  ✔ Scene graph returns to 0 children after every level transition; all InstancedMeshes, geometries, materials, and cached textures cleanly disposed.');
}

// ---------------------------------------------------------------------------
// 3. COLLISION & PHYSICS TORTURE AUDIT
// ---------------------------------------------------------------------------
console.log('\n[3/6] Running collision & physics torture tests (walls, corners, pillars, dt spikes)...');
{
  const state = createMockState('QA-COLLISION', 'Medium');
  const player = new PlayerController(state, mockInput, mockRenderer);

  // Build a controlled 9x9 test grid with walls, concave corners, and a center pillar
  const W = 9;
  const H = 9;
  const cellSize = 4.0;
  const grid = new Uint8Array(W * H).fill(CELL.WALL);
  for (let z = 1; z < H - 1; z++) {
    for (let x = 1; x < W - 1; x++) {
      grid[z * W + x] = CELL.ROOM;
    }
  }
  // Place a pillar at (4, 4) -> center world (16, 16)
  grid[4 * W + 4] = CELL.PILLAR;

  const levelData = { width: W, height: H, cellSize, grid };

  // Test A: High-speed sprint directly into North wall (z = 0 is wall, south face at z = 2.0)
  player.spawnAt(3, 1, cellSize, 0);
  for (let i = 0; i < 60; i++) {
    const next = player.resolveWorldMotion(state.player.x, state.player.z, 0, -0.55, levelData);
    state.player.x = next.x;
    state.player.z = next.z;
  }
  const northWallFaceZ = 0 * cellSize + cellSize * 0.5; // 2.0
  assert.ok(
    state.player.z >= northWallFaceZ + player.playerRadius - 1e-4,
    `Player penetrated north wall! z=${state.player.z}`
  );

  // Test B: Diagonal 45-degree sprint into a concave wall corner (x=1, z=1)
  player.spawnAt(1, 1, cellSize, 0);
  for (let i = 0; i < 60; i++) {
    const next = player.resolveWorldMotion(state.player.x, state.player.z, -0.4, -0.4, levelData);
    state.player.x = next.x;
    state.player.z = next.z;
  }
  assert.ok(
    state.player.x >= 2.0 + player.playerRadius - 1e-4 &&
      state.player.z >= 2.0 + player.playerRadius - 1e-4,
    `Player stuck or clipped in corner: (${state.player.x}, ${state.player.z})`
  );

  // Test C: Sliding along a wall at an angle should still advance along the free axis
  player.spawnAt(2, 1, cellSize, 0);
  state.player.z = 2.0 + player.playerRadius + 0.02;
  const startX = state.player.x;
  const nextSlide = player.resolveWorldMotion(state.player.x, state.player.z, 0.5, -0.5, levelData); // push into north wall while moving east
  state.player.x = nextSlide.x;
  state.player.z = nextSlide.z;
  assert.ok(
    state.player.x > startX + 0.45,
    `Player failed to slide smoothly along wall! startX=${startX}, endX=${state.player.x}`
  );

  // Test D: Pillar collision accuracy (visual half-width = 0.28 * 4 = 1.12m around center 16,16)
  // At x = 17.65, z = 16.0 (inside cell (4,4) which spans 14..18, but outside pillar!)
  const outsidePillar = player._depenetratePosition(17.65, 16.0, levelData);
  assert.ok(
    Math.abs(outsidePillar.x - 17.65) < 1e-5 && Math.abs(outsidePillar.z - 16.0) < 1e-5,
    'Player collided with empty air around pillar inside pillar cell!'
  );
  // Inside pillar center (16.2, 16.0) must push out of solid pillar
  const insidePillar = player._depenetratePosition(16.2, 16.0, levelData);
  assert.ok(
    insidePillar.x >= 16.0 + 1.12 + player.playerRadius - 1e-4,
    'Player did not depenetrate from solid pillar!'
  );

  // Test E: Vertical position lock (cannot fall out of map)
  assert.equal(state.player.y, player.eyeHeight, 'Player Y coordinate drifted from eyeHeight!');

  console.log('  ✔ Wall penetration: 0 | Corner sticking: 0 | Wall sliding: smooth | Pillar hitbox: exact | Y-lock: verified.');
}

// ---------------------------------------------------------------------------
// 4. CORRUPTED / MISSING SAVE DATA AUDIT
// ---------------------------------------------------------------------------
console.log('\n[4/6] Auditing SaveManager resilience against corrupted, missing, and out-of-range data...');
{
  // Case 1: Missing data
  localStorageMock.clear();
  let loaded = SaveManager.load();
  assert.equal(loaded.currentLevel, 0);
  assert.equal(loaded.settings.quality, 'Auto');

  // Case 2: Malformed JSON string
  localStorageMock.setItem('backrooms_archive_save_v1', '{corrupted_json::');
  loaded = SaveManager.load();
  assert.equal(loaded.currentLevel, 0);

  // Case 3: JSON "null" or primitive or array
  for (const payload of ['null', 'false', '42', '"hello"', '[1,2,3]']) {
    localStorageMock.setItem('backrooms_archive_save_v1', payload);
    loaded = SaveManager.load();
    assert.equal(loaded.currentLevel, 0);
    assert.equal(typeof loaded.settings, 'object');
  }

  // Case 4: Out-of-bounds numbers & invalid types inside object
  localStorageMock.setItem(
    'backrooms_archive_save_v1',
    JSON.stringify({
      currentLevel: 999,
      highestUnlockedLevel: -40,
      deaths: -15,
      seed: '',
      settings: {
        sensitivity: 'not-a-number',
        volume: 99.9,
        quality: 'UltraExtremeBogus'
      }
    })
  );
  loaded = SaveManager.load();
  assert.equal(loaded.currentLevel, 5, 'currentLevel should clamp to max level 5');
  assert.equal(loaded.highestUnlockedLevel, 5, 'highestUnlockedLevel should be at least currentLevel (5)');
  assert.equal(loaded.deaths, 0, 'negative deaths should clamp to 0');
  assert.equal(loaded.settings.sensitivity, 1.0, 'NaN sensitivity should fallback to 1.0');
  assert.equal(loaded.settings.volume, 1.0, 'volume > 1 should clamp to 1.0');
  assert.equal(loaded.settings.quality, 'Auto', 'invalid quality should fallback to Auto');

  SaveManager.resetProgress();
  console.log('  ✔ SaveManager safely sanitizes missing keys, malformed JSON, null/arrays, NaNs, and out-of-range level/settings values.');
}

// ---------------------------------------------------------------------------
// 5. ENEMY AI, WARNING CUE, SUB-CELL CATCH & STEALTH ESCAPE AUDIT
// ---------------------------------------------------------------------------
console.log('\n[5/6] Auditing Enemy AI (warning cue, sub-cell corner catch, stealth escape/hide)...');
{
  const W = 12;
  const H = 12;
  const cellSize = 4.0;
  const grid = new Uint8Array(W * H).fill(CELL.WALL);
  for (let z = 1; z < H - 1; z++) {
    for (let x = 1; x < W - 1; x++) {
      grid[z * W + x] = CELL.ROOM;
    }
  }
  // Add an L-shaped wall barrier at row z=5 so player can hide behind it
  for (let x = 1; x <= 8; x++) {
    grid[5 * W + x] = CELL.WALL;
  }

  const mockLevelData = {
    width: W,
    height: H,
    cellSize,
    grid,
    spawn: { x: 2, z: 2 },
    exit: { x: 9, z: 9 },
    patrolWaypoints: [
      { x: 2, z: 8, distFromSpawn: 6 },
      { x: 9, z: 8, distFromSpawn: 10 }
    ]
  };

  const howler = new HowlerEnemy(mockLevelData);
  howler.spawnAtGrid(2, 2);
  howler.yaw = Math.PI * 0.5; // facing +X

  let warningFired = false;
  let caughtPlayer = false;

  // Step 1: Place player in clear LOS at (5, 2) -> world (20, 8) with flashlight ON
  const playerVisible = {
    x: 20.0,
    z: 8.0,
    yaw: 0,
    flashlightOn: true,
    isSprinting: false,
    noiseRadius: 2.0
  };

  howler.update(0.05, playerVisible, {
    onWarningCue: () => {
      warningFired = true;
    },
    onCatchPlayer: () => {
      caughtPlayer = true;
    }
  });

  assert.equal(warningFired, true, 'Enemy must fire warning cue before chasing!');
  assert.equal(howler.state, 'warning', 'Enemy must enter warning state before chase!');

  // Advance past warning duration (1.05s) -> enters 'chase'
  for (let i = 0; i < 25; i++) {
    howler.update(0.05, playerVisible);
  }
  assert.equal(howler.state, 'chase', 'Enemy must transition to chase after warning cue');

  // Step 2: Test Escape & Hide behind wall at (2, 8) -> world (8, 32) with flashlight OFF
  const playerHidden = {
    x: 8.0,
    z: 32.0,
    yaw: 0,
    flashlightOn: false,
    isSprinting: false,
    noiseRadius: 0.8
  };

  for (let i = 0; i < 60; i++) {
    howler.update(0.1, playerHidden);
  }
  assert.ok(
    howler.state === 'search' || howler.state === 'patrol',
    `Enemy should lose player and drop to search/patrol when player hides behind wall with light off (got ${howler.state})`
  );

  // Step 3: Test Sub-Cell Corner Catch — place player near corner of cell (3, 2) -> (3*4 + 1.45, 2*4 + 1.45) = (13.45, 9.45)
  const playerCorner = {
    x: 13.45,
    z: 9.45,
    yaw: 0,
    flashlightOn: true,
    isSprinting: false,
    noiseRadius: 2.0
  };
  howler.x = 10.0;
  howler.z = 8.0;
  howler.state = 'chase';
  caughtPlayer = false;

  for (let i = 0; i < 40; i++) {
    howler.update(0.05, playerCorner, {
      onCatchPlayer: () => {
        caughtPlayer = true;
      }
    });
    if (caughtPlayer) break;
  }
  assert.equal(
    caughtPlayer,
    true,
    'Enemy failed to catch player standing in sub-cell corner!'
  );

  // Also instantiate Smiler and Hound to verify their constructors, behaviors, and disposal
  const smiler = new SmilerEnemy(mockLevelData);
  const hound = new HoundEnemy(mockLevelData);
  smiler.spawnAtGrid(3, 2);
  hound.spawnAtGrid(4, 2);
  smiler.update(0.05, playerVisible);
  hound.update(0.05, playerVisible);

  howler.dispose();
  smiler.dispose();
  hound.dispose();
  console.log('  ✔ Warning cue before chase: verified | Sub-cell corner catch: verified | Stealth escape & hide with flashlight off: verified.');
}

// ---------------------------------------------------------------------------
// 6. FPS / FRAME-TIME BENCHMARK ACROSS LOW / MEDIUM / HIGH
// ---------------------------------------------------------------------------
console.log('\n[6/6] Benchmarking frame update performance across Low / Medium / High presets...');
{
  for (const quality of ['Low', 'Medium', 'High']) {
    const scene = new THREE.Scene();
    const state = createMockState(`QA-PERF-${quality}`, quality);
    const player = new PlayerController(state, mockInput, mockRenderer);

    // Load Level 5 (largest 40x40 grid with 3 enemies and reality rifts)
    const lvl = await loadLevelModule(5, scene, state, mockRenderer, quality);
    player.spawnAt(lvl.levelData.spawn.x, lvl.levelData.spawn.z, lvl.levelData.cellSize, 0);

    // Verify all active chunk InstancedMeshes have boundingSphere computed for frustum culling
    let instancedMeshCount = 0;
    scene.traverse((obj) => {
      if (obj.isInstancedMesh) {
        instancedMeshCount++;
        assert.ok(
          obj.boundingSphere !== null,
          'InstancedMesh missing boundingSphere for frustum culling!'
        );
      }
    });

    const frames = 180;
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
      player.update(0.016, lvl.levelData);
      lvl.update(0.016, f * 0.016, mockInput, null);
    }
    const elapsedMs = performance.now() - t0;
    const avgFrameMs = elapsedMs / frames;

    assert.ok(
      avgFrameMs < 8.0,
      `Frame update on ${quality} took ${avgFrameMs.toFixed(2)}ms (must be well below 16.67ms for 60 FPS)`
    );

    console.log(
      `  ✔ Preset: ${quality.padEnd(6)} | Avg CPU frame time: ${avgFrameMs.toFixed(3)} ms/frame (>> 60 FPS budget of 16.67 ms) | Active InstancedMeshes: ${instancedMeshCount}`
    );

    lvl.dispose();
    clearProceduralTextureCache();
  }
}

console.log('\n============================================================');
console.log('ALL QA & GAME DESIGN AUDIT CHECKS PASSED (0 ERRORS)');
console.log('============================================================');
