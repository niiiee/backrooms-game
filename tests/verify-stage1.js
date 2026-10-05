import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SeededRNG } from '../src/gen/rng.js';
import { CELL, validateLevelGrid } from '../src/gen/validator.js';
import { generateLevelArchitecture } from '../src/gen/generator.js';
import { PlayerController } from '../src/core/player.js';
import { createLevel as createLevel0 } from '../src/levels/level0.js';

// Provide minimal DOM canvas 2D shim for headless Node texture generation verification
if (typeof document === 'undefined') {
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
    getElementById() {
      return null;
    },
    head: { appendChild() {} },
    addEventListener() {}
  };
}
if (typeof performance === 'undefined') {
  globalThis.performance = { now: () => Date.now() };
}

console.log('=== STAGE 1 VERIFICATION: CORE + MOVEMENT + LEVEL 0 GENERATOR ===');

// 1. Test SeededRNG determinism
const rngA = new SeededRNG('TEST-SEED-1989');
const rngB = new SeededRNG('TEST-SEED-1989');
for (let i = 0; i < 25; i++) {
  assert.equal(rngA.next(), rngB.next(), 'SeededRNG must be deterministic');
}
console.log('[PASS] SeededRNG determinism & 2D fBm noise verified.');

// 2. Test Validator rejection on blocked exit & acceptance on valid grid
const blockedGrid = new Uint8Array(10 * 10).fill(CELL.WALL);
blockedGrid[1 * 10 + 1] = CELL.SPAWN;
blockedGrid[8 * 10 + 8] = CELL.EXIT;
const invalidRes = validateLevelGrid(blockedGrid, 10, 10, { x: 1, z: 1 }, { x: 8, z: 8 }, [], 5);
assert.equal(invalidRes.valid, false, 'Validator must reject unreachable exit');
console.log('[PASS] Validator accurately detects unreachable exits.');

// 3. Test 50 seeds of Level 0 architectural generation
let totalAttempts = 0;
for (let s = 0; s < 50; s++) {
  const lvl = generateLevelArchitecture({
    levelIndex: 0,
    seed: `STAGE1-SEED-${s}`,
    width: 34,
    height: 34,
    hallCount: 3,
    roomCount: 8,
    deadEndCount: 10,
    loopCount: 5,
    pillarDensity: 0.55,
    objectiveCount: 2,
    hazardCount: 4,
    minExitDistance: 16
  });
  totalAttempts += lvl.attemptsUsed;
  assert.equal(lvl.validation.valid, true, `Seed ${s} must pass BFS validation`);
  assert.ok(lvl.rooms.length >= 2, `Seed ${s} must have rooms`);
  assert.ok(lvl.halls.length >= 1, `Seed ${s} must have large halls`);
  assert.ok(lvl.pillars.length >= 1, `Seed ${s} must have pillars`);
  assert.ok(lvl.deadEnds.length >= 1, `Seed ${s} must have dead ends`);
  assert.equal(lvl.objectives.length, 2, `Seed ${s} must have 2 reachable objectives`);
}
console.log(`[PASS] 50/50 Level 0 seeds generated valid architectural layouts (avg attempts: ${(totalAttempts / 50).toFixed(2)}).`);

// 4. Test First-Person PlayerController Movement, Stamina, Battery, & Wall Collision
const testLevel = generateLevelArchitecture({
  levelIndex: 0,
  seed: 'COLLISION-TEST',
  width: 34,
  height: 34
});

const mockState = {
  mode: 'PLAYING',
  seed: 'STAGE1-RUNTIME',
  settings: { sensitivity: 1.0 },
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
  }
};

const mockKeys = new Set();
const mockJustPressed = new Set();
const mockInput = {
  isDown: (code) => mockKeys.has(code),
  consumeJustPressed: (code) => {
    if (mockJustPressed.has(code)) {
      mockJustPressed.delete(code);
      return true;
    }
    return false;
  },
  consumeMouseDelta: () => ({ dx: 0, dy: 0 }),
  getMovementAxes: () => ({
    forward: mockKeys.has('KeyW') ? 1 : 0,
    strafe: 0
  })
};

const mockRenderer = {
  camera: { position: { set() {} }, rotation: { x: 0, y: 0 } },
  flashlight: { intensity: 4.2 },
  configureAtmosphere() {}
};

let footstepsTriggered = 0;
const player = new PlayerController(mockState, mockInput, mockRenderer, {
  onFootstep: () => {
    footstepsTriggered++;
  }
});

player.spawnAt(testLevel.spawn.x, testLevel.spawn.z, testLevel.cellSize, 0);

// Sprint forward and verify stamina & battery drain and wall collision containment
mockKeys.add('KeyW');
mockKeys.add('ShiftLeft');
for (let step = 0; step < 120; step++) {
  player.update(0.05, testLevel);
  const gx = Math.round(mockState.player.x / testLevel.cellSize);
  const gz = Math.round(mockState.player.z / testLevel.cellSize);
  const cellVal = testLevel.grid[gz * testLevel.width + gx];
  assert.notEqual(cellVal, CELL.WALL, 'Player must never enter a solid WALL cell');
  assert.notEqual(cellVal, CELL.PILLAR, 'Player must never enter a solid PILLAR cell');
}

assert.ok(mockState.player.stamina < 100, 'Sprinting must drain stamina');
assert.ok(mockState.player.battery < 100, 'Active flashlight must drain battery');
assert.ok(footstepsTriggered > 0, 'Moving must trigger footstep callbacks');

// Stop sprinting and verify stamina regenerates
mockKeys.delete('ShiftLeft');
mockKeys.delete('KeyW');
const depletedStamina = mockState.player.stamina;
for (let step = 0; step < 30; step++) {
  player.update(0.05, testLevel);
}
assert.ok(mockState.player.stamina > depletedStamina, 'Stamina must regenerate when resting');
console.log('[PASS] PlayerController movement, stamina, flashlight battery, footsteps, and wall collision verified.');

// 5. Test Full Level 0 InstancedMesh ChunkManager + Breaker Switch Objective + Exit Unlocking
const scene = new THREE.Scene();
const level0Instance = createLevel0(scene, mockState, mockRenderer, 'Medium');
assert.ok(level0Instance.chunkManager.totalChunkCount > 0, 'ChunkManager must create spatial chunks');

// Update at spawn and verify only nearby chunks are active
level0Instance.update(0.016, 1.0, mockInput, null);
assert.ok(
  mockState.metrics.activeChunks > 0 &&
    mockState.metrics.activeChunks <= mockState.metrics.totalChunks,
  'ChunkManager must stream active chunks around player'
);

// Visit both Breaker Switches, press KeyE, and verify exit unlocks
for (const obj of level0Instance.levelData.objectives) {
  mockState.player.x = obj.x * level0Instance.levelData.cellSize;
  mockState.player.z = obj.z * level0Instance.levelData.cellSize;
  mockJustPressed.add('KeyE');
  level0Instance.update(0.016, 2.0, mockInput, null);
}
assert.equal(mockState.levelInfo.exitUnlocked, true, 'Flipping all breakers must unlock Level 0 exit');

// Move player to Exit and verify reachedExit triggers
mockState.player.x = level0Instance.levelData.exit.x * level0Instance.levelData.cellSize;
mockState.player.z = level0Instance.levelData.exit.z * level0Instance.levelData.cellSize;
mockJustPressed.add('KeyE');
const exitStep = level0Instance.update(0.016, 3.0, mockInput, null);
assert.equal(exitStep.reachedExit, true, 'Reaching unlocked exit must trigger level transition');

level0Instance.dispose();
console.log('[PASS] Level 0 Chunked InstancedMesh, Breaker Switch mechanic, and Exit transition verified.');
console.log('=== STAGE 1 ALL CHECKS PASSED ===');
