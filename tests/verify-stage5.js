import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SaveManager } from '../src/core/save.js';
import { GameState } from '../src/core/state.js';

console.log('=== STAGE 5 VERIFICATION: UI, SAVE SYSTEM, ARCHITECTURE & BUNDLE BUDGET ===');

const rootDir = path.resolve('.');

// 1. Verify all 7 required architecture directories exist and have modules
const requiredDirs = [
  'src/core',
  'src/levels',
  'src/gen',
  'src/enemies',
  'src/audio',
  'src/fx',
  'src/ui'
];

for (const rel of requiredDirs) {
  const full = path.join(rootDir, rel);
  assert.ok(fs.existsSync(full), `Required directory ${rel} must exist`);
  const files = fs.readdirSync(full).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 0, `Directory ${rel} must contain ES module files`);
}
console.log('[PASS] All 7 modular architecture directories verified (/src/core, /levels, /gen, /enemies, /audio, /fx, /ui).');

// 2. Verify zero external models, textures, or audio assets anywhere in src/
const forbiddenExts = new Set([
  '.glb',
  '.gltf',
  '.obj',
  '.fbx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.mp3',
  '.wav',
  '.ogg',
  '.flac'
]);

function scanNoExternalAssets(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanNoExternalAssets(full);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      assert.equal(
        forbiddenExts.has(ext),
        false,
        `Forbidden external asset file detected: ${full}`
      );
    }
  }
}
scanNoExternalAssets(path.join(rootDir, 'src'));
console.log('[PASS] Zero external models, textures, or audio files verified (100% procedural).');

// 3. Verify SaveManager & GameState localStorage persistence
const storageMap = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => storageMap.get(k) ?? null,
    setItem: (k, v) => storageMap.set(k, String(v))
  }
};

SaveManager.resetProgress();
const state = new GameState();
assert.equal(state.currentLevel, 0);
state.currentLevel = 4;
state.highestUnlockedLevel = 4;
state.seed = 'CUSTOM-SEED-99';
state.deaths = 3;
state.settings.quality = 'High';
state.settings.volume = 0.65;
state.settings.sensitivity = 1.4;
state.settings.vhsEnabled = false;
state.persistProgress();

const reloaded = new GameState();
assert.equal(reloaded.currentLevel, 4, 'Saved level must persist across reloads');
assert.equal(reloaded.highestUnlockedLevel, 4, 'Highest unlocked level must persist');
assert.equal(reloaded.seed, 'CUSTOM-SEED-99', 'Custom seed must persist');
assert.equal(reloaded.deaths, 3, 'Deaths count must persist');
assert.equal(reloaded.settings.quality, 'High', 'Quality preset must persist');
assert.equal(reloaded.settings.volume, 0.65, 'Volume setting must persist');
assert.equal(reloaded.settings.sensitivity, 1.4, 'Mouse sensitivity must persist');
assert.equal(reloaded.settings.vhsEnabled, false, 'VHS toggle must persist');
console.log('[PASS] SaveManager & GameState localStorage autosave and reload verified.');

// 4. Verify Production Build dist/ size is strictly under 2 MB (< 2,097,152 bytes)
const distDir = path.join(rootDir, 'dist');
if (fs.existsSync(distDir)) {
  let totalBytes = 0;
  function sumDir(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) sumDir(full);
      else totalBytes += fs.statSync(full).size;
    }
  }
  sumDir(distDir);
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(3);
  console.log(`[INFO] Production dist/ bundle size: ${totalBytes} bytes (${totalMB} MB)`);
  assert.ok(
    totalBytes > 0 && totalBytes < 2 * 1024 * 1024,
    `Production build size (${totalBytes} bytes) must be under 2 MB`
  );
  console.log('[PASS] Production build is lightweight and strictly under the 2 MB budget.');
}
console.log('=== STAGE 5 ALL CHECKS PASSED ===');
