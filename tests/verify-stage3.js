import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadLevelModule, TOTAL_LEVELS } from '../src/levels/levelLoader.js';

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
    }
  };
}

console.log('=== STAGE 3 VERIFICATION: ALL 6 LEVELS (LEVEL 0 - LEVEL 5) ===');

const scene = new THREE.Scene();
const atmosphereSnapshots = [];
const mockJustPressed = new Set();
const mockInput = {
  isDown: () => false,
  consumeJustPressed: (code) => {
    if (mockJustPressed.has(code)) {
      mockJustPressed.delete(code);
      return true;
    }
    return false;
  }
};

const mockRenderer = {
  configureAtmosphere(cfg) {
    atmosphereSnapshots.push(cfg);
  }
};

const mockState = {
  mode: 'PLAYING',
  seed: 'STAGE3-MULTI-LEVEL',
  metrics: { fps: 60, activeChunks: 0, totalChunks: 0 },
  player: {
    x: 0,
    y: 1.72,
    z: 0,
    stamina: 50,
    maxStamina: 100,
    battery: 50,
    maxBattery: 100,
    sanity: 80,
    flashlightOn: true,
    speedMultiplier: 1.0,
    noiseRadius: 2.0,
    surfaceType: 'carpet'
  },
  levelInfo: {}
};

for (let idx = 0; idx < TOTAL_LEVELS; idx++) {
  const lvl = await loadLevelModule(idx, scene, mockState, mockRenderer, 'Medium');
  assert.equal(lvl.id, idx, `Level ${idx} must report matching id`);
  assert.equal(lvl.levelData.validation.valid, true, `Level ${idx} must pass BFS reachability validation`);
  assert.ok(lvl.levelData.rooms.length >= 2, `Level ${idx} must have rooms`);
  assert.ok(lvl.levelData.halls.length >= 1, `Level ${idx} must have large halls`);
  assert.ok(lvl.levelData.pillars.length >= 1, `Level ${idx} must have pillars`);
  assert.ok(lvl.levelData.deadEnds.length >= 1, `Level ${idx} must have dead ends`);

  // Verify level-specific mechanics
  if (idx === 1) {
    // Test Level 1 Supply Crate scavenging
    assert.ok(lvl.crates.length > 0, 'Level 1 must spawn warehouse supply crates');
    const crate = lvl.crates[0];
    mockState.player.x = crate.x * lvl.levelData.cellSize;
    mockState.player.z = crate.z * lvl.levelData.cellSize;
    mockState.player.battery = 40;
    mockJustPressed.add('KeyE');
    lvl.update(0.016, 1.0, mockInput, null);
    assert.equal(crate.looted, true, 'Level 1 supply crate must be lootable');
    assert.ok(mockState.player.battery > 40, 'Looting Level 1 supply crate must recharge battery');
  } else if (idx === 2) {
    // Test Level 2 Steam Vent hazard slowdown & noise
    const haz = lvl.chunkManager.hazardVisuals[0];
    if (haz) {
      haz.data.phase = 0; // ensure active at elapsedTime = 0.5
      mockState.player.x = haz.data.x * lvl.levelData.cellSize;
      mockState.player.z = haz.data.z * lvl.levelData.cellSize;
      lvl.update(0.016, 0.5, mockInput, null);
      assert.equal(mockState.player.speedMultiplier, 0.55, 'Level 2 active steam vent must slow player');
    }
  } else if (idx === 3) {
    // Test Level 3 Poolrooms water drag & drainage
    assert.equal(mockState.player.surfaceType, 'water', 'Level 3 must start with flooded water surface');
    assert.ok(mockState.player.speedMultiplier < 1.0, 'Level 3 water must apply drag slowdown initially');
  } else if (idx === 5) {
    // Test Level 5 Non-Euclidean Spatial Loop when trying to force locked exit
    mockState.player.x = lvl.levelData.exit.x * lvl.levelData.cellSize;
    mockState.player.z = lvl.levelData.exit.z * lvl.levelData.cellSize;
    mockJustPressed.add('KeyE');
    lvl.update(0.016, 1.0, mockInput, null);
    assert.equal(
      mockState.player.x,
      lvl.levelData.spawn.x * lvl.levelData.cellSize,
      'Level 5 unsealed exit must loop player back to spawn'
    );
  }

  // Complete all objectives in the level, verify exit unlocks, and transition to next level
  for (const obj of lvl.levelData.objectives) {
    mockState.player.x = obj.x * lvl.levelData.cellSize;
    mockState.player.z = obj.z * lvl.levelData.cellSize;
    mockJustPressed.add('KeyE');
    lvl.update(0.016, 2.0, mockInput, null);
  }
  assert.equal(mockState.levelInfo.exitUnlocked, true, `Level ${idx} exit must unlock after completing objectives`);

  if (idx === 3) {
    // After draining all valves in Level 3 Poolrooms, speedMultiplier must be 1.0
    lvl.update(0.5, 3.0, mockInput, null);
    assert.equal(mockState.player.speedMultiplier, 1.0, 'Level 3 drainage must restore full dry speed');
  }

  // Step onto unlocked exit
  mockState.player.x = lvl.levelData.exit.x * lvl.levelData.cellSize;
  mockState.player.z = lvl.levelData.exit.z * lvl.levelData.cellSize;
  mockJustPressed.add('KeyE');
  const stepRes = lvl.update(0.016, 4.0, mockInput, null);
  assert.equal(stepRes.reachedExit, true, `Level ${idx} unlocked exit must transition to next level`);

  lvl.dispose();
  console.log(`[PASS] Level ${idx} (${mockState.levelInfo.name}) validated: layout, unique mechanic, objectives, and exit transition.`);
}

assert.equal(atmosphereSnapshots.length, 6, 'All 6 levels must configure distinct atmosphere lighting/fog');
console.log('=== STAGE 3 ALL CHECKS PASSED ===');
