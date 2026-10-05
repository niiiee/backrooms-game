import { SaveManager } from '../core/save.js';
import { TOTAL_LEVELS } from '../levels/levelLoader.js';

const LEVEL_TITLES = [
  'Level 0 — The Lobby (Yellow Rooms)',
  'Level 1 — Habitable Zone (Dark Warehouse)',
  'Level 2 — Pipe Dreams (Steam Tunnels)',
  'Level 3 — The Poolrooms (Subliminal Aqua)',
  'Level 4 — Abandoned Office (Cubicle Maze)',
  'Level 5 — The Endless Hallway (Terror Hotel)'
];

/**
 * UI Manager for Minimal Diegetic HUD, Level Transition Toast,
 * Polished Main Menu, Settings (Sensitivity, Volume, Graphics, VHS),
 * Pause, Death, and Victory overlays.
 */
export class UIManager {
  constructor(container, state, callbacks = {}) {
    this.container = container;
    this.state = state;
    this.callbacks = callbacks;

    this._injectStyles();
    this._buildDOM();
    this.renderMenuState();
  }

  _injectStyles() {
    if (document.getElementById('backrooms-ui-styles')) return;
    const style = document.createElement('style');
    style.id = 'backrooms-ui-styles';
    style.textContent = `
      .hud-minimal-top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 22px 28px;
        width: 100%;
        text-shadow: 0 1px 4px rgba(0,0,0,0.95);
        pointer-events: none;
      }
      .hud-header-block {
        border-left: 2px solid rgba(212, 194, 106, 0.65);
        padding-left: 12px;
      }
      .hud-title {
        font-size: 13px;
        font-weight: bold;
        color: rgba(235, 218, 138, 0.88);
        letter-spacing: 2px;
      }
      .hud-sub {
        font-size: 11px;
        color: rgba(189, 181, 149, 0.65);
        margin-top: 2px;
      }
      .hud-objective {
        font-size: 12px;
        color: rgba(245, 238, 200, 0.92);
        margin-top: 6px;
        letter-spacing: 0.6px;
      }
      .hud-telemetry {
        font-size: 10px;
        color: rgba(185, 178, 148, 0.45);
        letter-spacing: 1px;
        text-align: right;
      }
      .hud-minimal-bottom {
        position: absolute;
        bottom: 44px;
        left: 28px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 195px;
        pointer-events: none;
        transition: opacity 0.25s ease;
      }
      .meter-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 10px;
        color: rgba(225, 216, 180, 0.78);
        letter-spacing: 1.2px;
        text-shadow: 0 1px 2px rgba(0,0,0,0.95);
      }
      .meter-row > span:first-child {
        width: 58px;
      }
      .meter-track {
        flex: 1;
        height: 4px;
        background: rgba(255,255,255,0.1);
        overflow: hidden;
      }
      .meter-fill {
        height: 100%;
        transition: width 0.08s linear;
      }
      .level-toast {
        position: absolute;
        top: 24%;
        left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.45s ease;
      }
      .level-toast-title {
        font-size: 22px;
        color: #f2e4a4;
        letter-spacing: 4px;
        text-shadow: 0 2px 12px rgba(0,0,0,0.95);
      }
      .level-toast-sub {
        font-size: 12px;
        color: #bdb595;
        letter-spacing: 2px;
        margin-top: 6px;
      }
      .crosshair-wrap {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        pointer-events: none;
      }
      .crosshair-dot {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: rgba(255, 248, 210, 0.68);
        box-shadow: 0 0 5px rgba(0,0,0,0.9);
        margin: 0 auto;
      }
      .prompt-text {
        margin-top: 16px;
        font-size: 12px;
        color: #fff5c0;
        background: rgba(8, 8, 6, 0.82);
        padding: 5px 12px;
        border-left: 2px solid rgba(212, 194, 106, 0.85);
        letter-spacing: 1px;
        white-space: nowrap;
      }
      .warning-banner {
        position: absolute;
        top: 86px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 13px;
        font-weight: bold;
        color: #ff6b5e;
        background: rgba(22, 4, 4, 0.86);
        border: 1px solid rgba(255, 70, 55, 0.65);
        padding: 6px 16px;
        letter-spacing: 2px;
        text-transform: uppercase;
      }
      .modal-backdrop {
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at center, rgba(16, 15, 10, 0.84), rgba(3, 3, 2, 0.96));
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
      }
      .modal-card {
        width: min(560px, 94vw);
        max-height: 92vh;
        overflow-y: auto;
        background: rgba(12, 11, 8, 0.96);
        border: 1px solid rgba(212, 194, 106, 0.48);
        box-shadow: 0 22px 60px rgba(0,0,0,0.92);
        padding: 28px 32px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .modal-badge {
        font-size: 10px;
        color: #9e9470;
        letter-spacing: 2.5px;
        text-transform: uppercase;
      }
      .modal-card h1 {
        font-size: 24px;
        color: var(--yellow-primary);
        letter-spacing: 3.5px;
        margin: 0;
      }
      .modal-card p {
        font-size: 12px;
        line-height: 1.55;
        color: #c9c1a3;
        margin: 0;
      }
      .btn-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 6px;
      }
      .ui-btn {
        background: rgba(212, 194, 106, 0.1);
        color: #f3ebd0;
        border: 1px solid rgba(212, 194, 106, 0.48);
        padding: 11px 15px;
        font-family: var(--font-mono);
        font-size: 12px;
        letter-spacing: 1.5px;
        cursor: pointer;
        text-align: left;
        text-transform: uppercase;
        transition: background 0.15s, transform 0.1s, border-color 0.15s;
      }
      .ui-btn:hover {
        background: rgba(212, 194, 106, 0.26);
        border-color: rgba(212, 194, 106, 0.85);
        transform: translateX(3px);
      }
      .ui-btn.danger {
        border-color: rgba(220, 75, 60, 0.65);
        color: #ff9a8f;
      }
      .settings-grid {
        display: flex;
        flex-direction: column;
        gap: 10px;
        border-top: 1px solid rgba(212, 194, 106, 0.2);
        border-bottom: 1px solid rgba(212, 194, 106, 0.2);
        padding: 12px 0;
      }
      .settings-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 11px;
        letter-spacing: 0.8px;
        gap: 12px;
      }
      .settings-row select, .settings-row input[type="text"] {
        background: #14130d;
        color: #e6dfc5;
        border: 1px solid rgba(212, 194, 106, 0.42);
        padding: 5px 9px;
        font-family: var(--font-mono);
        font-size: 11px;
        min-width: 195px;
      }
      .slider-wrap {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .slider-val {
        font-size: 11px;
        color: #d4c26a;
        min-width: 38px;
        text-align: right;
      }
      .settings-row input[type="range"] {
        width: 145px;
        accent-color: #d4c26a;
      }
    `;
    document.head.appendChild(style);
  }

  _buildDOM() {
    this.container.innerHTML = `
      <div id="hud-root" style="display:none; width:100%; height:100%; position:relative;">
        <div class="hud-minimal-top">
          <div class="hud-header-block">
            <div class="hud-title" id="hud-level-name">LEVEL 0 // THE LOBBY</div>
            <div class="hud-sub" id="hud-level-sub">Mono-Yellow Fluorescent Complex</div>
            <div class="hud-objective" id="hud-objective-text">Objectives: 0 / 2</div>
          </div>
          <div class="hud-telemetry">
            <div id="hud-fps">FPS: 60</div>
            <div id="hud-chunks">CHUNKS: 0/0</div>
          </div>
        </div>
        <div id="hud-toast" class="level-toast">
          <div class="level-toast-title" id="hud-toast-title"></div>
          <div class="level-toast-sub" id="hud-toast-sub"></div>
        </div>
        <div id="hud-warning" class="warning-banner" style="display:none;"></div>
        <div class="crosshair-wrap">
          <div class="crosshair-dot"></div>
          <div id="hud-prompt" class="prompt-text" style="display:none;"></div>
        </div>
        <div class="hud-minimal-bottom" id="hud-meters-wrap">
          <div class="meter-row">
            <span>STAMINA</span>
            <div class="meter-track"><div id="meter-stamina" class="meter-fill" style="width:100%; background:#d4c26a;"></div></div>
          </div>
          <div class="meter-row">
            <span id="label-battery">FLASH [F]</span>
            <div class="meter-track"><div id="meter-battery" class="meter-fill" style="width:100%; background:#5bc0be;"></div></div>
          </div>
          <div class="meter-row">
            <span>SANITY</span>
            <div class="meter-track"><div id="meter-sanity" class="meter-fill" style="width:100%; background:#9b7ede;"></div></div>
          </div>
        </div>
      </div>
      <div id="modal-root" class="modal-backdrop"></div>
    `;

    this.hudRoot = this.container.querySelector('#hud-root');
    this.modalRoot = this.container.querySelector('#modal-root');
    this.elLevelName = this.container.querySelector('#hud-level-name');
    this.elLevelSub = this.container.querySelector('#hud-level-sub');
    this.elObjective = this.container.querySelector('#hud-objective-text');
    this.elMetersWrap = this.container.querySelector('#hud-meters-wrap');
    this.elStamina = this.container.querySelector('#meter-stamina');
    this.elBattery = this.container.querySelector('#meter-battery');
    this.elLabelBattery = this.container.querySelector('#label-battery');
    this.elSanity = this.container.querySelector('#meter-sanity');
    this.elFps = this.container.querySelector('#hud-fps');
    this.elChunks = this.container.querySelector('#hud-chunks');
    this.elWarning = this.container.querySelector('#hud-warning');
    this.elPrompt = this.container.querySelector('#hud-prompt');
    this.elToast = this.container.querySelector('#hud-toast');
    this.elToastTitle = this.container.querySelector('#hud-toast-title');
    this.elToastSub = this.container.querySelector('#hud-toast-sub');
  }

  showLevelToast(title, subtitle) {
    if (!this.elToast) return;
    this.elToastTitle.textContent = title || '';
    this.elToastSub.textContent = subtitle || '';
    this.elToast.style.opacity = '1';
    if (this._toastTimeout) clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      if (this.elToast) this.elToast.style.opacity = '0';
    }, 2200);
  }

  updateHUD() {
    if (this.state.mode !== 'PLAYING') {
      this.hudRoot.style.display = 'none';
      return;
    }
    this.hudRoot.style.display = 'block';

    const p = this.state.player;
    const info = this.state.levelInfo;

    this.elLevelName.textContent = info.name;
    this.elLevelSub.textContent = info.subtitle;
    this.elObjective.textContent = info.exitUnlocked
      ? `EXIT UNLOCKED — Proceed to Exit Door (${info.objectivesCompleted}/${info.objectivesTotal})`
      : `${info.mechanicHint} (${info.objectivesCompleted}/${info.objectivesTotal})`;

    this.elStamina.style.width = `${Math.round(p.stamina)}%`;
    this.elStamina.style.background = p.exhausted ? '#c93b2b' : '#d4c26a';

    this.elLabelBattery.textContent = p.flashlightOn ? 'FLASH ON' : 'FLASH OFF';
    this.elBattery.style.width = `${Math.round(p.battery)}%`;
    this.elBattery.style.background = p.battery < 20 ? '#e06d53' : '#5bc0be';

    this.elSanity.style.width = `${Math.round(p.sanity)}%`;

    // Minimal HUD auto-dimming: fade meters down when resources are healthy and calm
    if (this.elMetersWrap) {
      const isCalm = p.stamina > 92 && p.battery > 65 && p.sanity > 85 && !info.chaseActive;
      this.elMetersWrap.style.opacity = isCalm ? '0.45' : '0.95';
    }

    this.elFps.textContent = `${this.state.metrics.fps} FPS · ${this.state.settings.resolvedQuality}`;
    this.elChunks.textContent = `SECTORS ${this.state.metrics.activeChunks}/${this.state.metrics.totalChunks}`;

    if (info.warningMessage) {
      this.elWarning.style.display = 'block';
      this.elWarning.textContent = info.warningMessage;
    } else {
      this.elWarning.style.display = 'none';
    }

    if (info.interactionPrompt) {
      this.elPrompt.style.display = 'block';
      this.elPrompt.textContent = info.interactionPrompt;
    } else {
      this.elPrompt.style.display = 'none';
    }
  }

  _buildSettingsControlsHTML() {
    const s = this.state.settings;
    const volPct = Math.round((s.volume ?? 0.8) * 100);
    const sensVal = Number(s.sensitivity ?? 1.0).toFixed(1);
    return `
      <div class="settings-grid">
        <div class="settings-row">
          <label for="seed-input">GENERATION SEED:</label>
          <input id="seed-input" type="text" value="${this.state.seed}" />
        </div>
        <div class="settings-row">
          <label for="quality-select">GRAPHICS QUALITY:</label>
          <select id="quality-select">
            <option value="Auto" ${s.quality === 'Auto' ? 'selected' : ''}>Auto (${s.resolvedQuality})</option>
            <option value="Low" ${s.quality === 'Low' ? 'selected' : ''}>Low (Fastest)</option>
            <option value="Medium" ${s.quality === 'Medium' ? 'selected' : ''}>Medium (Balanced)</option>
            <option value="High" ${s.quality === 'High' ? 'selected' : ''}>High (Shadows + Bump)</option>
          </select>
        </div>
        <div class="settings-row">
          <label for="volume-range">MASTER AUDIO VOLUME:</label>
          <div class="slider-wrap">
            <input id="volume-range" type="range" min="0" max="1" step="0.05" value="${s.volume ?? 0.8}" />
            <span class="slider-val" id="volume-val">${volPct}%</span>
          </div>
        </div>
        <div class="settings-row">
          <label for="sens-range">MOUSE SENSITIVITY:</label>
          <div class="slider-wrap">
            <input id="sens-range" type="range" min="0.3" max="2.5" step="0.1" value="${s.sensitivity ?? 1.0}" />
            <span class="slider-val" id="sens-val">${sensVal}x</span>
          </div>
        </div>
        <div class="settings-row">
          <label for="vhs-checkbox">VHS ANALOG POST-FX:</label>
          <input id="vhs-checkbox" type="checkbox" ${s.vhsEnabled !== false ? 'checked' : ''} />
        </div>
      </div>
    `;
  }

  _bindSettingsEvents() {
    const seedEl = this.modalRoot.querySelector('#seed-input');
    seedEl?.addEventListener('change', () => {
      if (seedEl.value.trim()) {
        this.state.seed = seedEl.value.trim();
        this.state.persistProgress();
      }
    });

    const qualEl = this.modalRoot.querySelector('#quality-select');
    qualEl?.addEventListener('change', () => {
      this.state.settings.quality = qualEl.value;
      if (this.callbacks.onQualityChange) {
        this.callbacks.onQualityChange(qualEl.value);
      }
      this.state.persistProgress();
    });

    const volEl = this.modalRoot.querySelector('#volume-range');
    const volValEl = this.modalRoot.querySelector('#volume-val');
    volEl?.addEventListener('input', () => {
      const v = parseFloat(volEl.value);
      this.state.settings.volume = v;
      if (volValEl) volValEl.textContent = `${Math.round(v * 100)}%`;
      if (this.callbacks.onVolumeChange) {
        this.callbacks.onVolumeChange(v);
      }
      this.state.persistProgress();
    });

    const sensEl = this.modalRoot.querySelector('#sens-range');
    const sensValEl = this.modalRoot.querySelector('#sens-val');
    sensEl?.addEventListener('input', () => {
      const s = parseFloat(sensEl.value);
      this.state.settings.sensitivity = s;
      if (sensValEl) sensValEl.textContent = `${s.toFixed(1)}x`;
      this.state.persistProgress();
    });

    const vhsEl = this.modalRoot.querySelector('#vhs-checkbox');
    vhsEl?.addEventListener('change', () => {
      this.state.settings.vhsEnabled = vhsEl.checked;
      this.state.persistProgress();
    });
  }

  renderMenuState() {
    const mode = this.state.mode;
    if (mode === 'PLAYING') {
      this.modalRoot.style.display = 'none';
      this.updateHUD();
      return;
    }

    this.hudRoot.style.display = 'none';
    this.modalRoot.style.display = 'flex';

    if (mode === 'MENU') {
      let levelOptions = '';
      for (let i = 0; i < TOTAL_LEVELS; i++) {
        const selected = i === this.state.currentLevel ? 'selected' : '';
        levelOptions += `<option value="${i}" ${selected}>${LEVEL_TITLES[i]}</option>`;
      }

      this.modalRoot.innerHTML = `
        <div class="modal-card interactive-ui">
          <div class="modal-badge">ASYNC THRESHOLD // VHS ARCHIVE TERMINAL</div>
          <h1>THE BACKROOMS</h1>
          <p>PROCEDURAL LIMINAL SURVIVAL HORROR<br/>
          [WASD] Move &bull; [Shift] Sprint &bull; [F] Flashlight (Stealth) &bull; [E] Interact &bull; [Esc] Pause</p>
          <div class="settings-row">
            <label for="level-select">SELECT ARCHIVE TAPE:</label>
            <select id="level-select">${levelOptions}</select>
          </div>
          ${this._buildSettingsControlsHTML()}
          <div class="btn-group">
            <button class="ui-btn" id="btn-start-game">&#9654; PLAY SELECTED TAPE (SAVED: LEVEL ${this.state.currentLevel})</button>
            <button class="ui-btn" id="btn-new-game">START NEW RUN FROM LEVEL 0</button>
            <button class="ui-btn danger" id="btn-reset-save">RESET SAVED PROGRESS</button>
          </div>
        </div>
      `;

      this._bindSettingsEvents();

      const lvlSelect = this.modalRoot.querySelector('#level-select');
      this.modalRoot.querySelector('#btn-start-game')?.addEventListener('click', () => {
        const chosen = lvlSelect ? parseInt(lvlSelect.value, 10) : this.state.currentLevel;
        if (this.callbacks.onStartGame) this.callbacks.onStartGame(chosen);
      });

      this.modalRoot.querySelector('#btn-new-game')?.addEventListener('click', () => {
        this.state.currentLevel = 0;
        if (this.callbacks.onStartGame) this.callbacks.onStartGame(0);
      });

      this.modalRoot.querySelector('#btn-reset-save')?.addEventListener('click', () => {
        SaveManager.resetProgress();
        this.state.currentLevel = 0;
        this.state.highestUnlockedLevel = 0;
        this.state.deaths = 0;
        this.renderMenuState();
      });
    } else if (mode === 'PAUSED') {
      this.modalRoot.innerHTML = `
        <div class="modal-card interactive-ui">
          <div class="modal-badge">RECORDING SUSPENDED</div>
          <h1>TAPE PAUSED</h1>
          <p>${this.state.levelInfo.name} — ${this.state.levelInfo.subtitle}</p>
          ${this._buildSettingsControlsHTML()}
          <div class="btn-group">
            <button class="ui-btn" id="btn-resume">&#9654; RESUME TAPE</button>
            <button class="ui-btn" id="btn-retry-pause">RESTART CURRENT LEVEL</button>
            <button class="ui-btn danger" id="btn-quit-menu">RETURN TO MAIN MENU</button>
          </div>
        </div>
      `;
      this._bindSettingsEvents();
      this.modalRoot.querySelector('#btn-resume')?.addEventListener('click', () => {
        if (this.callbacks.onResume) this.callbacks.onResume();
      });
      this.modalRoot.querySelector('#btn-retry-pause')?.addEventListener('click', () => {
        if (this.callbacks.onRetry) this.callbacks.onRetry();
      });
      this.modalRoot.querySelector('#btn-quit-menu')?.addEventListener('click', () => {
        if (this.callbacks.onMainMenu) this.callbacks.onMainMenu();
      });
    } else if (mode === 'DEAD') {
      this.modalRoot.innerHTML = `
        <div class="modal-card interactive-ui">
          <div class="modal-badge" style="color:#ff6b5e;">FATAL INTERCEPTION</div>
          <h1 style="color:#ff453a;">SIGNAL LOST // FOOTAGE CORRUPTED</h1>
          <p>An entity intercepted you in ${this.state.levelInfo.name}.<br/>
          Progress autosaved at Level ${this.state.currentLevel}. Total casualties: ${this.state.deaths}.</p>
          <div class="btn-group">
            <button class="ui-btn" id="btn-retry-death">REWIND & RETRY LEVEL ${this.state.currentLevel}</button>
            <button class="ui-btn danger" id="btn-menu-death">RETURN TO MAIN MENU</button>
          </div>
        </div>
      `;
      this.modalRoot.querySelector('#btn-retry-death')?.addEventListener('click', () => {
        if (this.callbacks.onRetry) this.callbacks.onRetry();
      });
      this.modalRoot.querySelector('#btn-menu-death')?.addEventListener('click', () => {
        if (this.callbacks.onMainMenu) this.callbacks.onMainMenu();
      });
    } else if (mode === 'VICTORY') {
      this.modalRoot.innerHTML = `
        <div class="modal-card interactive-ui">
          <div class="modal-badge" style="color:#32d74b;">THRESHOLD BREACHED</div>
          <h1 style="color:#32d74b;">ARCHIVE COMPLETE // ESCAPED</h1>
          <p>You survived all 6 levels of the Backrooms complex (Seed: ${this.state.seed}, Casualties: ${this.state.deaths}).</p>
          <div class="btn-group">
            <button class="ui-btn" id="btn-play-again">START NEW ARCHIVE FROM LEVEL 0</button>
            <button class="ui-btn" id="btn-victory-menu">RETURN TO MAIN MENU</button>
          </div>
        </div>
      `;
      this.modalRoot.querySelector('#btn-play-again')?.addEventListener('click', () => {
        this.state.currentLevel = 0;
        if (this.callbacks.onStartGame) this.callbacks.onStartGame(0);
      });
      this.modalRoot.querySelector('#btn-victory-menu')?.addEventListener('click', () => {
        if (this.callbacks.onMainMenu) this.callbacks.onMainMenu();
      });
    }
  }
}
