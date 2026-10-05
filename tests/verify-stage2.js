import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CELL } from '../src/gen/validator.js';
import { generateLevelArchitecture } from '../src/gen/generator.js';
import { findPathAStar, hasLineOfSight } from '../src/enemies/pathfinding.js';
import { HowlerEnemy } from '../src/enemies/howler.js';
import { SmilerEnemy } from '../src/enemies/smiler.js';
import { HoundEnemy } from '../src/enemies/hound.js';
import { EnemyManager } from '../src/enemies/enemyManager.js';
import { GameState } from '../src/core/state.js';

// Mock localStorage in Node for autosave verification
const storageMap = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => storageMap.get(k) ?? null,
    setItem: (k, v) => storageMap.set(k, String(v))
  }
};

console.log('=== STAGE 2 VERIFICATION: ENEMY AI + A* PATHFINDING + DEATH/RETRY LOOP ===');

// 1. Verify A* Pathfinding around obstacles and Line-of-Sight occlusion
const testWidth = 12;
const testHeight = 12;
const testGrid = new Uint8Array(testWidth * testHeight).fill(CELL.ROOM);
// Place wall border and an interior dividing wall with a doorway gap at (6, 9)
for (let i = 0; i < 12; i++) {
  testGrid[0 * testWidth + i] = CELL.WALL;
  testGrid[11 * testWidth + i] = CELL.WALL;
  testGrid[i * testWidth + 0] = CELL.WALL;
  testGrid[i * testWidth + 11] = CELL.WALL;
  if (i !== 9) {
    testGrid[i * testWidth + 6] = CELL.WALL;
  }
}

const path = findPathAStar(testGrid, testWidth, testHeight, 2, 2, 9, 2);
assert.ok(path.length > 0, 'A* must find a valid path around the dividing wall');
for (const step of path) {
  assert.notEqual(
    testGrid[step.z * testWidth + step.x],
    CELL.WALL,
    'A* path must never step through a wall cell'
  );
}
const lastNode = path[path.length - 1];
assert.equal(lastNode.x, 9);
assert.equal(lastNode.z, 2);

// Line of sight across the wall at z=2 should be blocked, while along z=9 (the gap) should be open
const cellSize = 4.0;
const losBlocked = hasLineOfSight(testGrid, testWidth, testHeight, cellSize, 2 * cellSize, 2 * cellSize, 9 * cellSize, 2 * cellSize, 40);
const losOpen = hasLineOfSight(testGrid, testWidth, testHeight, cellSize, 2 * cellSize, 9 * cellSize, 9 * cellSize, 9 * cellSize, 40);
assert.equal(losBlocked, false, 'LOS must be blocked by intervening wall cell');
assert.equal(losOpen, true, 'LOS must succeed through open corridor');
console.log('[PASS] Grid A* pathfinding and DDA Line-of-Sight raycasting verified.');

// 2. Verify all 3 Enemy Types + State Transitions (patrol -> investigate -> warning -> chase -> search)
const mockLevelData = {
  width: testWidth,
  height: testHeight,
  cellSize,
  grid: testGrid,
  spawn: { x: 2, z: 2 },
  exit: { x: 9, z: 2 },
  patrolWaypoints: [
    { x: 2, z: 8, distFromSpawn: 6 },
    { x: 9, z: 8, distFromSpawn: 12 }
  ]
};

const howler = new HowlerEnemy(mockLevelData);
const smiler = new SmilerEnemy(mockLevelData);
const hound = new HoundEnemy(mockLevelData);

assert.equal(howler.type, 'howler');
assert.equal(smiler.type, 'smiler');
assert.equal(hound.type, 'hound');

// Test Hound acute hearing: place Hound at (2, 2) and noisy sprinting player behind wall at (8, 2)
hound.spawnAtGrid(2, 2);
const noisyPlayer = {
  x: 5 * cellSize,
  z: 2 * cellSize,
  yaw: 0,
  flashlightOn: false,
  noiseRadius: 14.5 // sprinting noise
};
// Block direct LOS between (2,2) and (5,2) with a pillar at (3,2)
testGrid[2 * testWidth + 3] = CELL.PILLAR;
hound.update(0.05, noisyPlayer);
assert.equal(
  hound.state,
  'investigate',
  'Hound must transition from patrol to investigate when hearing player noise behind an obstacle'
);
testGrid[2 * testWidth + 3] = CELL.ROOM; // remove temporary pillar

// Test Clear Warning Cue before Chase: place Howler in open sight of player at (2, 9) -> (5, 9)
howler.spawnAtGrid(2, 9);
howler.yaw = Math.PI * 0.5; // facing +X toward player
let warningCueFired = false;
const visiblePlayer = {
  x: 5 * cellSize,
  z: 9 * cellSize,
  yaw: 0,
  flashlightOn: true,
  noiseRadius: 2.0
};

howler.update(0.05, visiblePlayer, {
  onWarningCue: () => {
    warningCueFired = true;
  }
});
assert.equal(howler.state, 'warning', 'Enemy must enter warning state before starting chase');
assert.equal(warningCueFired, true, 'onWarningCue callback must fire prior to chase');

// Advance past warning duration -> verify transition to 'chase'
howler.update(1.2, visiblePlayer);
assert.equal(howler.state, 'chase', 'Enemy must transition from warning to chase after warning cue duration');

// Break line of sight (move player behind wall at (9, 2)) and advance time -> verify transition to 'search' then 'patrol'
const hiddenPlayer = {
  x: 9 * cellSize,
  z: 2 * cellSize,
  yaw: 0,
  flashlightOn: false,
  noiseRadius: 1.0
};
howler.path = []; // simulate reaching last known pos
howler.update(4.5, hiddenPlayer);
assert.equal(howler.state, 'search', 'Enemy must transition from chase to search after losing sight');

howler.update(6.5, hiddenPlayer);
assert.equal(howler.state, 'patrol', 'Enemy must return from search to patrol when search timer expires');

// Test Smiler unique flashlight beam stun/slowdown mechanic
smiler.spawnAtGrid(2, 9);
smiler.setState('chase');
// Player at (4, 9) facing (-X) directly toward Smiler at (2, 9): yaw = +PI/2 makes -sin(yaw) = -1 (-X)
const playerAimingAtSmiler = {
  x: 4 * cellSize,
  z: 9 * cellSize,
  yaw: Math.PI * 0.5,
  flashlightOn: true,
  noiseRadius: 2.0
};
const stunnedSpeed = smiler.getEffectiveSpeed(playerAimingAtSmiler);
const normalChaseSpeed = smiler.chaseSpeed;
assert.ok(
  stunnedSpeed < normalChaseSpeed * 0.65,
  'Smiler must slow down when player shines flashlight directly at it'
);
console.log('[PASS] Howler, Smiler, and Hound behaviors & patrol/investigate/warning/chase/search state transitions verified.');

// 3. Test EnemyManager + Player Catch -> Death Screen -> Autosave -> Retry Loop
const fullLevel = generateLevelArchitecture({
  levelIndex: 0,
  seed: 'STAGE2-DEATH-RETRY',
  width: 34,
  height: 34
});
const scene = new THREE.Scene();
const gameState = new GameState();
gameState.mode = 'PLAYING';
gameState.levelInfo.enemiesConfig = [
  { type: 'howler', count: 1 },
  { type: 'smiler', count: 1 },
  { type: 'hound', count: 1 }
];

let caughtCount = 0;
const manager = new EnemyManager(scene, fullLevel, gameState, {
  onPlayerCaught: () => {
    caughtCount++;
    gameState.deaths += 1;
    gameState.mode = 'DEAD';
    gameState.persistProgress();
  }
});
assert.equal(manager.enemies.length, 3, 'EnemyManager must spawn all 3 configured enemy types');

// Move player directly onto enemy 0 in chase mode to trigger catch & death
const enemy0 = manager.enemies[0];
enemy0.setState('chase');
gameState.player.x = enemy0.x + 0.2;
gameState.player.z = enemy0.z + 0.2;
manager.update(0.05);

assert.equal(caughtCount, 1, 'Enemy catching player must invoke onPlayerCaught');
assert.equal(gameState.mode, 'DEAD', 'Game state must transition to DEAD on catch');
assert.equal(gameState.deaths, 1, 'Death counter must increment');

// Verify localStorage autosave recorded death
const savedRaw = JSON.parse(globalThis.window.localStorage.getItem('backrooms_archive_save_v1'));
assert.equal(savedRaw.deaths, 1, 'Deaths must be persisted to localStorage');

// Simulate Retry: dispose old enemies, respawn player at level spawn, spawn fresh enemies, set mode = PLAYING
manager.dispose();
gameState.player.x = fullLevel.spawn.x * fullLevel.cellSize;
gameState.player.z = fullLevel.spawn.z * fullLevel.cellSize;
gameState.mode = 'PLAYING';
const retryManager = new EnemyManager(scene, fullLevel, gameState);
retryManager.update(0.05);
assert.equal(gameState.mode, 'PLAYING', 'Retry loop must restore PLAYING state safely away from enemies');
retryManager.dispose();

console.log('[PASS] EnemyManager catch detection, Death state, localStorage autosave, and Retry loop verified.');
console.log('=== STAGE 2 ALL CHECKS PASSED ===');
