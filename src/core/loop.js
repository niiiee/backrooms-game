import { Timer } from 'three/addons/misc/Timer.js';

/**
 * Main Game Loop using Three.js Timer addon and setAnimationLoop.
 * Tracks smoothed FPS and invokes per-frame update and render hooks.
 */
export class GameLoop {
  constructor(rendererManager, onUpdate, onRender) {
    this.rendererManager = rendererManager;
    this.onUpdate = onUpdate;
    this.onRender = onRender;

    this.timer = new Timer();
    this.elapsedTime = 0;

    this.frameCount = 0;
    this.fpsAccum = 0;
    this.currentFps = 60;
  }

  start() {
    this.rendererManager.renderer.setAnimationLoop((timestamp) => {
      this.timer.update(timestamp);
      const dt = this.timer.getDelta();
      this.elapsedTime = this.timer.getElapsed();

      // Clamp delta to avoid large physics steps after tab switch
      const clampedDt = Math.min(Math.max(dt, 0.001), 0.1);

      this.frameCount++;
      this.fpsAccum += clampedDt;
      if (this.fpsAccum >= 0.5) {
        this.currentFps = Math.round(this.frameCount / this.fpsAccum);
        this.frameCount = 0;
        this.fpsAccum = 0;
      }

      if (this.onUpdate) {
        this.onUpdate(clampedDt, this.elapsedTime, this.currentFps);
      }
      if (this.onRender) {
        this.onRender(clampedDt, this.elapsedTime);
      }
    });
  }

  stop() {
    this.rendererManager.renderer.setAnimationLoop(null);
  }
}
