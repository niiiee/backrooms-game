import { HowlerEnemy } from './howler.js';
import { SmilerEnemy } from './smiler.js';
import { HoundEnemy } from './hound.js';

const ENEMY_CLASSES = {
  howler: HowlerEnemy,
  smiler: SmilerEnemy,
  hound: HoundEnemy
};

/**
 * Manages spawning, updating, directional audio callbacks, warning cues,
 * pre-encounter silence tension, and cleanup of all active enemies in a level.
 */
export class EnemyManager {
  constructor(scene, levelData, state, callbacks = {}) {
    this.scene = scene;
    this.levelData = levelData;
    this.state = state;
    this.callbacks = callbacks;

    this.enemies = [];
    this.warningBannerTimer = 0;

    this._spawnEnemies();
  }

  _spawnEnemies() {
    const configList = this.state.levelInfo.enemiesConfig || [
      { type: 'howler', count: 1 },
      { type: 'smiler', count: 1 }
    ];

    const candidates = (this.levelData.patrolWaypoints || []).filter(
      (wp) => wp.distFromSpawn >= 11
    );

    if (candidates.length === 0) {
      candidates.push({
        x: this.levelData.exit.x,
        z: this.levelData.exit.z,
        distFromSpawn: 20
      });
    }

    let wpIndex = 0;
    for (const entry of configList) {
      const EnemyClass = ENEMY_CLASSES[entry.type] || HowlerEnemy;
      const count = entry.count || 1;
      for (let i = 0; i < count; i++) {
        const enemy = new EnemyClass(this.levelData);
        const wp = candidates[(wpIndex * 7 + 3) % candidates.length];
        wpIndex++;
        enemy.spawnAtGrid(wp.x, wp.z);
        this.scene.add(enemy.group);
        this.enemies.push(enemy);
      }
    }
  }

  update(dt) {
    if (this.state.mode !== 'PLAYING') return;

    const player = this.state.player;
    let closestDist = Infinity;
    let closestPan = 0;
    let anyChasing = false;
    let anyWarning = false;

    for (const enemy of this.enemies) {
      const res = enemy.update(dt, player, {
        onWarningCue: (ent, pan = 0) => {
          this.warningBannerTimer = 2.4;
          const dirHint = pan < -0.3 ? ' [LEFT]' : pan > 0.3 ? ' [RIGHT]' : '';
          this.state.levelInfo.warningMessage = `⚠ ${ent.name.toUpperCase()} DETECTED YOU${dirHint} — RUN!`;
          if (this.callbacks.onWarningCue) {
            this.callbacks.onWarningCue(ent, pan);
          }
        },
        onChaseStart: (ent, pan = 0) => {
          if (this.callbacks.onChaseStart) {
            this.callbacks.onChaseStart(ent, pan);
          }
        },
        onVocalize: (ent, dist, pan = 0) => {
          if (this.callbacks.onEnemyVocalize) {
            this.callbacks.onEnemyVocalize(ent, dist, pan);
          }
        },
        onCatchPlayer: (ent) => {
          if (this.callbacks.onPlayerCaught) {
            this.callbacks.onPlayerCaught(ent);
          }
        }
      });

      if (res.distToPlayer < closestDist) {
        closestDist = res.distToPlayer;
        closestPan = res.stereoPan ?? 0;
      }
      if (res.state === 'chase') anyChasing = true;
      if (res.state === 'warning') anyWarning = true;
    }

    this.state.levelInfo.closestEnemyDist = closestDist;
    this.state.levelInfo.closestEnemyPan = closestPan;
    this.state.levelInfo.chaseActive = anyChasing || anyWarning;
    this.state.levelInfo.warningActive = anyWarning;

    if (this.warningBannerTimer > 0) {
      this.warningBannerTimer -= dt;
      if (this.warningBannerTimer <= 0 && !anyChasing && !anyWarning) {
        if (this.state.levelInfo.warningMessage.startsWith('⚠')) {
          this.state.levelInfo.warningMessage = '';
        }
      }
    }
  }

  dispose() {
    for (const enemy of this.enemies) {
      enemy.dispose(this.scene);
    }
    this.enemies = [];
  }
}
