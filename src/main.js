import { GameState } from './core/state.js';
import { InputManager } from './core/input.js';
import { RendererManager } from './core/renderer.js';
import { PlayerController } from './core/player.js';
import { GameLoop } from './core/loop.js';
import { SaveManager } from './core/save.js';
import { loadLevelModule, TOTAL_LEVELS } from './levels/levelLoader.js';
import { EnemyManager } from './enemies/enemyManager.js';
import { ProceduralAudioSynth } from './audio/audioSynth.js';
import { PostProcessor } from './fx/postProcessor.js';
import { UIManager } from './ui/uiManager.js';

export class BackroomsGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.fxOverlay = document.getElementById('fx-overlay');
    this.uiContainer = document.getElementById('ui-layer');

    this.state = new GameState();
    this.rendererManager = new RendererManager(this.canvas, this.state);
    this.input = new InputManager(this.canvas, this.state);
    this.audioSynth = new ProceduralAudioSynth(this.state);
    this.postProcessor = new PostProcessor(this.rendererManager, this.state, this.fxOverlay);

    this.playerController = new PlayerController(
      this.state,
      this.input,
      this.rendererManager,
      {
        onFootstep: (surface, sprinting) => {
          this.audioSynth.playFootstep(surface, sprinting);
        },
        onFlashlightToggle: () => {
          this.audioSynth.playFlashlightClick();
        },
        onBreathing: (intensity, isExhausted) => {
          this.audioSynth.playBreathing(intensity, isExhausted);
        }
      }
    );

    this.activeLevel = null;
    this.enemyManager = null;
    this.lowFpsTimer = 0;

    this.ui = new UIManager(this.uiContainer, this.state, {
      onStartGame: (levelIdx) => this.startLevel(levelIdx),
      onResume: () => this.resumeGame(),
      onRetry: () => this.startLevel(this.state.currentLevel),
      onMainMenu: () => {
        this.state.mode = 'MENU';
        this.input.exitPointerLock();
        this.ui.renderMenuState();
      },
      onQualityChange: (preset) => {
        this.rendererManager.applyQualityPreset(preset);
        this.postProcessor.applyQuality(this.state.settings.resolvedQuality);
      },
      onVolumeChange: (vol) => {
        this.audioSynth.setVolume(vol);
      }
    });

    this.loop = new GameLoop(
      this.rendererManager,
      (dt, elapsed, fps) => this.update(dt, elapsed, fps),
      () => this.render()
    );

    // Expose programmatic test API for automated verification
    window.__BACKROOMS_GAME__ = this;
    this.loop.start();
  }

  async startLevel(levelIndex = 0) {
    if (this.enemyManager) {
      this.enemyManager.dispose();
      this.enemyManager = null;
    }
    if (this.activeLevel) {
      this.activeLevel.dispose();
      this.activeLevel = null;
    }

    this.state.currentLevel = levelIndex;
    if (levelIndex > this.state.highestUnlockedLevel) {
      this.state.highestUnlockedLevel = levelIndex;
    }
    this.state.persistProgress();

    // Trigger smooth noclip / VHS glitch / fade transition effect
    this.postProcessor.triggerLevelTransition(0.85);
    this.audioSynth.playStinger('warp');

    this.activeLevel = await loadLevelModule(
      levelIndex,
      this.rendererManager.scene,
      this.state,
      this.rendererManager,
      this.state.settings.resolvedQuality
    );

    if (this.state.levelInfo.audioProfile) {
      this.audioSynth.configureLevelAudio(this.state.levelInfo.audioProfile);
    }

    const { spawn, cellSize } = this.activeLevel.levelData;
    this.playerController.spawnAt(spawn.x, spawn.z, cellSize, 0);

    this.enemyManager = new EnemyManager(
      this.rendererManager.scene,
      this.activeLevel.levelData,
      this.state,
      {
        onWarningCue: (_ent, pan = 0) => {
          this.audioSynth.playStinger('warning', pan);
        },
        onChaseStart: () => {},
        onEnemyVocalize: (ent, dist, pan = 0) => {
          this.audioSynth.playEnemyVocalization(ent.type, dist, pan);
        },
        onPlayerCaught: () => this.triggerDeath()
      }
    );

    this.state.mode = 'PLAYING';
    this.ui.renderMenuState();
    this.ui.showLevelToast(this.state.levelInfo.name, this.state.levelInfo.subtitle);
    this.input.requestPointerLock();
  }

  resumeGame() {
    if (this.state.mode === 'PAUSED') {
      this.state.mode = 'PLAYING';
      this.ui.renderMenuState();
      this.input.requestPointerLock();
    }
  }

  pauseGame() {
    if (this.state.mode === 'PLAYING') {
      this.state.mode = 'PAUSED';
      this.input.exitPointerLock();
      this.ui.renderMenuState();
    }
  }

  triggerDeath() {
    if (this.state.mode !== 'PLAYING') return;
    this.state.deaths += 1;
    this.state.mode = 'DEAD';
    this.state.persistProgress();
    this.audioSynth.playStinger('death');
    this.input.exitPointerLock();
    this.ui.renderMenuState();
  }

  update(dt, elapsedTime, fps) {
    this.state.metrics.fps = fps;

    // Adaptive quality step-down if Auto preset detects sustained <28 FPS
    if (this.state.mode === 'PLAYING' && this.state.settings.quality === 'Auto') {
      if (fps < 28 && this.state.settings.resolvedQuality !== 'Low') {
        this.lowFpsTimer += dt;
        if (this.lowFpsTimer > 4.0) {
          this.lowFpsTimer = 0;
          const nextQual =
            this.state.settings.resolvedQuality === 'High' ? 'Medium' : 'Low';
          this.rendererManager.applyQualityPreset(nextQual);
          this.postProcessor.applyQuality(nextQual);
        }
      } else {
        this.lowFpsTimer = Math.max(0, this.lowFpsTimer - dt);
      }
    }

    if (this.input.consumeJustPressed('Escape') || this.input.consumeJustPressed('KeyP')) {
      if (this.state.mode === 'PLAYING') {
        this.pauseGame();
      } else if (this.state.mode === 'PAUSED') {
        this.resumeGame();
      }
    }

    if (this.state.mode === 'PLAYING' && this.activeLevel) {
      this.playerController.update(dt, this.activeLevel.levelData);
      const result = this.activeLevel.update(dt, elapsedTime, this.input, this.audioSynth);
      if (this.enemyManager) {
        this.enemyManager.update(dt);
      }
      this.audioSynth.update(dt);
      this.ui.updateHUD();

      if (result && result.reachedExit && this.state.mode === 'PLAYING') {
        const nextLevel = this.state.currentLevel + 1;
        if (nextLevel >= TOTAL_LEVELS) {
          this.state.mode = 'VICTORY';
          SaveManager.save({ completedGame: true, highestUnlockedLevel: TOTAL_LEVELS - 1 });
          this.input.exitPointerLock();
          this.ui.renderMenuState();
        } else {
          this.startLevel(nextLevel);
        }
      }
    }

    this.postProcessor.update(elapsedTime);
    this.input.endFrame();
  }

  render() {
    this.postProcessor.render();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new BackroomsGame();
});
