import { SaveManager } from './save.js';

export class GameState {
  constructor() {
    const saved = SaveManager.load();

    this.mode = 'MENU'; // 'MENU' | 'PLAYING' | 'PAUSED' | 'DEAD' | 'VICTORY'
    this.currentLevel = saved.currentLevel || 0;
    this.highestUnlockedLevel = saved.highestUnlockedLevel || 0;
    this.seed = saved.seed || 'ARCHIVE-1989';
    this.deaths = saved.deaths || 0;

    this.settings = {
      quality: saved.settings.quality || 'Auto',
      resolvedQuality: 'Medium',
      sensitivity: saved.settings.sensitivity ?? 1.0,
      volume: saved.settings.volume ?? 0.8,
      vhsEnabled: saved.settings.vhsEnabled ?? true
    };

    this.player = {
      x: 0,
      y: 1.7,
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
    };

    this.levelInfo = {
      index: 0,
      name: 'LEVEL 0 // THE LOBBY',
      subtitle: 'Mono-Yellow Damp Fluorescent Complex',
      mechanicHint: 'Locate Breaker Switches to unlock the Acoustic Exit',
      objectivesCompleted: 0,
      objectivesTotal: 0,
      exitUnlocked: false,
      interactionPrompt: '',
      warningMessage: '',
      chaseActive: false,
      closestEnemyDist: Infinity
    };

    this.metrics = {
      fps: 60,
      activeChunks: 0,
      totalChunks: 0
    };

    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) {
      fn(this);
    }
  }

  persistProgress() {
    SaveManager.save({
      currentLevel: this.currentLevel,
      highestUnlockedLevel: Math.max(this.highestUnlockedLevel, this.currentLevel),
      seed: this.seed,
      deaths: this.deaths,
      settings: {
        quality: this.settings.quality,
        sensitivity: this.settings.sensitivity,
        volume: this.settings.volume,
        vhsEnabled: this.settings.vhsEnabled
      }
    });
  }
}
