/**
 * Procedural Web Audio Synthesizer for the Backrooms.
 * Generates 100% of game audio in code with zero external audio files:
 * - Fluorescent electrical ballast hum (60Hz/120Hz + harmonics)
 * - Surface-dependent footsteps (carpet, concrete, metal, water, wood)
 * - Low-stamina & exhaustion ragged breathing synthesis
 * - Directional enemy audio (StereoPannerNode) & unique vocalizations per enemy type
 * - Tension systems: "Sudden Silence" acoustic vacuum before encounters + Lub-Dub Heartbeat
 * - Clear chase warning stingers, noclip warp transitions, and interaction sounds
 * - Automatic Web Audio graph node disconnection on completion (zero node leaks)
 */
export class ProceduralAudioSynth {
  constructor(state) {
    this.state = state;
    this.ctx = null;
    this.masterGain = null;
    this.humOsc1 = null;
    this.humOsc2 = null;
    this.humGain = null;
    this.droneOsc = null;
    this.droneGain = null;
    this.droneFilter = null;
    this.noiseBuffer = null;

    this.baseHumGain = 0.08;
    this.initialized = false;
    this.distantSoundTimer = 8.0;
    this.proximityPulseTimer = 0;
    this.silenceTimer = 0;
    this.preEncounterTriggered = false;

    this._bindUnlockGesture();
  }

  _bindUnlockGesture() {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    };
    window.addEventListener('click', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  init() {
    if (this.initialized) return true;
    if (typeof window === 'undefined') return false;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;

    try {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.state.settings.volume ?? 0.8;
      this.masterGain.connect(this.ctx.destination);

      const sampleRate = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, sampleRate * 2, sampleRate);
      const output = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < output.length; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      // 1. Continuous Fluorescent Ballast Hum
      this.humGain = this.ctx.createGain();
      this.humGain.gain.value = 0.08;

      const humFilter = this.ctx.createBiquadFilter();
      humFilter.type = 'lowpass';
      humFilter.frequency.value = 320;

      this.humOsc1 = this.ctx.createOscillator();
      this.humOsc1.type = 'sawtooth';
      this.humOsc1.frequency.value = 60;

      this.humOsc2 = this.ctx.createOscillator();
      this.humOsc2.type = 'triangle';
      this.humOsc2.frequency.value = 120;

      this.humOsc1.connect(humFilter);
      this.humOsc2.connect(humFilter);
      humFilter.connect(this.humGain);
      this.humGain.connect(this.masterGain);

      this.humOsc1.start();
      this.humOsc2.start();

      // 2. Continuous Sub-Bass Tension Drone
      this.droneGain = this.ctx.createGain();
      this.droneGain.gain.value = 0.06;

      this.droneFilter = this.ctx.createBiquadFilter();
      this.droneFilter.type = 'lowpass';
      this.droneFilter.frequency.value = 140;

      this.droneOsc = this.ctx.createOscillator();
      this.droneOsc.type = 'sine';
      this.droneOsc.frequency.value = 50;

      this.droneOsc.connect(this.droneFilter);
      this.droneFilter.connect(this.droneGain);
      this.droneGain.connect(this.masterGain);
      this.droneOsc.start();

      this.initialized = true;
      return true;
    } catch {
      return false;
    }
  }

  _autoCleanup(sourceNode, nodesToDisconnect = []) {
    if (!sourceNode) return;
    sourceNode.onended = () => {
      try {
        sourceNode.disconnect();
      } catch {
        // ignore
      }
      for (const n of nodesToDisconnect) {
        try {
          if (n && typeof n.disconnect === 'function') n.disconnect();
        } catch {
          // ignore
        }
      }
    };
  }

  _connectToMasterWithPan(lastNode, pan = 0, cleanupList = []) {
    if (typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0));
      lastNode.connect(panner);
      panner.connect(this.masterGain);
      cleanupList.push(panner);
    } else {
      lastNode.connect(this.masterGain);
    }
  }

  setVolume(vol) {
    this.state.settings.volume = vol;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
    }
  }

  configureLevelAudio(profile = {}) {
    if (!this.initialized && !this.init()) return;
    const now = this.ctx.currentTime;
    const humFreq = profile.humFreq || 60;
    const humGain = profile.humGain ?? 0.1;
    const dronePitch = profile.dronePitch || 50;

    this.baseHumGain = humGain;
    this.humOsc1.frequency.setTargetAtTime(humFreq, now, 0.2);
    this.humOsc2.frequency.setTargetAtTime(humFreq * 2, now, 0.2);
    this.humGain.gain.setTargetAtTime(humGain, now, 0.2);
    this.droneOsc.frequency.setTargetAtTime(dronePitch, now, 0.3);
  }

  /**
   * Tension System: Sudden eerie silence ("acoustic vacuum") right before an encounter.
   * Ducks the continuous fluorescent hum and ambient drone to near-zero.
   */
  triggerEncounterSilence(duration = 1.25) {
    this.silenceTimer = Math.max(this.silenceTimer, duration);
    if (this.initialized && this.ctx) {
      const now = this.ctx.currentTime;
      this.humGain.gain.setTargetAtTime(0.002, now, 0.03);
      this.droneGain.gain.setTargetAtTime(0.002, now, 0.03);
    }
  }

  /**
   * Synthesizes surface-specific footstep audio.
   * Surfaces: 'carpet' | 'concrete' | 'metal' | 'water' | 'wood'
   */
  playFootstep(surface = 'carpet', isSprinting = false) {
    if (!this.initialized && !this.init()) return;
    const now = this.ctx.currentTime;
    const gainScale = isSprinting ? 0.28 : 0.15;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();

    let duration = 0.11;
    if (surface === 'carpet') {
      filter.type = 'bandpass';
      filter.frequency.value = 230 + Math.random() * 40;
      filter.Q.value = 1.8;
      duration = 0.09;
    } else if (surface === 'concrete') {
      filter.type = 'bandpass';
      filter.frequency.value = 780 + Math.random() * 120;
      filter.Q.value = 2.4;
      duration = 0.08;
    } else if (surface === 'metal') {
      filter.type = 'bandpass';
      filter.frequency.value = 1350 + Math.random() * 220;
      filter.Q.value = 6.0;
      duration = 0.14;
      const ping = this.ctx.createOscillator();
      const pingGain = this.ctx.createGain();
      ping.type = 'triangle';
      ping.frequency.setValueAtTime(520 + Math.random() * 90, now);
      ping.frequency.exponentialRampToValueAtTime(180, now + 0.12);
      pingGain.gain.setValueAtTime(gainScale * 0.45, now);
      pingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      ping.connect(pingGain);
      pingGain.connect(this.masterGain);
      this._autoCleanup(ping, [pingGain]);
      ping.start(now);
      ping.stop(now + 0.13);
    } else if (surface === 'water') {
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(420, now);
      filter.frequency.exponentialRampToValueAtTime(1450, now + 0.18);
      filter.Q.value = 2.2;
      duration = 0.22;
    } else {
      filter.type = 'lowpass';
      filter.frequency.value = 380 + Math.random() * 60;
      duration = 0.11;
      const thump = this.ctx.createOscillator();
      const thumpGain = this.ctx.createGain();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(125, now);
      thump.frequency.exponentialRampToValueAtTime(55, now + 0.1);
      thumpGain.gain.setValueAtTime(gainScale * 0.6, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      thump.connect(thumpGain);
      thumpGain.connect(this.masterGain);
      this._autoCleanup(thump, [thumpGain]);
      thump.start(now);
      thump.stop(now + 0.11);
    }

    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(gainScale, now + 0.012);
    env.gain.exponentialRampToValueAtTime(0.001, now + duration);

    src.connect(filter);
    filter.connect(env);
    env.connect(this.masterGain);
    this._autoCleanup(src, [filter, env]);

    src.start(now, Math.random() * 1.2, duration);
  }

  /**
   * Synthesizes ragged low-stamina / exhausted player breathing (inhale + exhale formant airflow).
   */
  playBreathing(intensity = 0.5, isExhausted = false) {
    if (!this.initialized && !this.init()) return;
    const now = this.ctx.currentTime;
    const peakGain = (0.045 + intensity * 0.09) * (isExhausted ? 1.35 : 1.0);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 3.2;
    filter.frequency.setValueAtTime(720, now);
    filter.frequency.linearRampToValueAtTime(920, now + 0.18);
    filter.frequency.exponentialRampToValueAtTime(440, now + 0.48);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    // Inhale swell
    env.gain.linearRampToValueAtTime(peakGain, now + 0.14);
    env.gain.linearRampToValueAtTime(peakGain * 0.25, now + 0.22);
    // Exhale puff
    env.gain.linearRampToValueAtTime(peakGain * 0.85, now + 0.31);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.52);

    src.connect(filter);
    filter.connect(env);
    env.connect(this.masterGain);
    this._autoCleanup(src, [filter, env]);

    src.start(now, Math.random() * 0.8, 0.54);
  }

  /**
   * Synthesizes unique directional vocalizations for each enemy type:
   * - 'howler': Metallic warbling formant shriek
   * - 'smiler': High-frequency static crackle & chittering teeth click
   * - 'hound': Guttural low-frequency predator growl & snarl
   */
  playEnemyVocalization(enemyType = 'howler', distance = 12.0, pan = 0) {
    if (!this.initialized && !this.init()) return;
    const now = this.ctx.currentTime;
    const atten = Math.max(0.04, Math.min(1.0, 1.0 - distance / 25.0));
    const gainVal = 0.18 * atten * atten;

    if (enemyType === 'howler') {
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc1.type = 'sawtooth';
      osc2.type = 'triangle';
      const baseF = 240 + Math.random() * 80;
      osc1.frequency.setValueAtTime(baseF, now);
      osc1.frequency.exponentialRampToValueAtTime(baseF * 1.85, now + 0.18);
      osc1.frequency.exponentialRampToValueAtTime(baseF * 0.62, now + 0.52);

      osc2.frequency.setValueAtTime(baseF * 1.06, now);
      osc2.frequency.exponentialRampToValueAtTime(baseF * 1.92, now + 0.18);
      osc2.frequency.exponentialRampToValueAtTime(baseF * 0.58, now + 0.52);

      filter.type = 'bandpass';
      filter.frequency.value = 680;
      filter.Q.value = 4.0;

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(gainVal, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      const cleanup = [osc2, filter, gain];
      this._connectToMasterWithPan(gain, pan, cleanup);
      this._autoCleanup(osc1, cleanup);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.56);
      osc2.stop(now + 0.56);
    } else if (enemyType === 'smiler') {
      // Static crackle + reverse whisper envelope
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2600, now);
      filter.frequency.exponentialRampToValueAtTime(1100, now + 0.34);
      filter.Q.value = 5.5;

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(gainVal * 1.15, now + 0.28);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

      src.connect(filter);
      filter.connect(gain);
      const cleanup = [filter, gain];
      this._connectToMasterWithPan(gain, pan, cleanup);
      this._autoCleanup(src, cleanup);

      src.start(now, Math.random() * 1.0, 0.38);
    } else {
      // Hound guttural low-frequency growl
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(58, now);
      osc.frequency.linearRampToValueAtTime(42, now + 0.42);

      filter.type = 'lowpass';
      filter.frequency.value = 210;
      filter.Q.value = 5.0;

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(gainVal * 1.3, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.connect(filter);
      filter.connect(gain);
      const cleanup = [filter, gain];
      this._connectToMasterWithPan(gain, pan, cleanup);
      this._autoCleanup(osc, cleanup);

      osc.start(now);
      osc.stop(now + 0.46);
    }
  }

  playFlashlightClick() {
    this.playStinger('flashlight');
  }

  playInteract() {
    this.playStinger('interact');
  }

  playStinger(type = 'warning', pan = 0) {
    if (!this.initialized && !this.init()) return;
    const now = this.ctx.currentTime;

    if (type === 'warning') {
      // Trigger sudden acoustic vacuum on ambient hum right as the warning shriek cuts through
      this.triggerEncounterSilence(1.15);

      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sawtooth';
      osc2.type = 'square';
      osc1.frequency.setValueAtTime(195, now);
      osc1.frequency.exponentialRampToValueAtTime(610, now + 0.35);
      osc1.frequency.exponentialRampToValueAtTime(135, now + 0.85);

      osc2.frequency.setValueAtTime(207, now);
      osc2.frequency.exponentialRampToValueAtTime(645, now + 0.35);
      osc2.frequency.exponentialRampToValueAtTime(128, now + 0.85);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.28, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.88);

      osc1.connect(gain);
      osc2.connect(gain);
      const cleanup = [osc2, gain];
      this._connectToMasterWithPan(gain, pan, cleanup);
      this._autoCleanup(osc1, cleanup);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.9);
      osc2.stop(now + 0.9);
    } else if (type === 'death') {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.38, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
      src.connect(gain);
      gain.connect(this.masterGain);
      this._autoCleanup(src, [gain]);
      src.start(now, 0, 0.95);
    } else if (type === 'interact') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.setValueAtTime(640, now + 0.08);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this._autoCleanup(osc, [gain]);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'flashlight') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1600, now);
      osc.frequency.exponentialRampToValueAtTime(420, now + 0.035);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this._autoCleanup(osc, [gain]);
      osc.start(now);
      osc.stop(now + 0.045);
    } else if (type === 'warp') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.exponentialRampToValueAtTime(72, now + 0.62);
      gain.gain.setValueAtTime(0.26, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.62);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this._autoCleanup(osc, [gain]);
      osc.start(now);
      osc.stop(now + 0.64);
    }
  }

  _playDistantCorridorSound() {
    if (!this.initialized) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    const baseFreq = 65 + Math.random() * 75;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.72, now + 1.4);

    filter.type = 'lowpass';
    filter.frequency.value = 190;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.075, now + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.45);

    osc.connect(filter);
    filter.connect(gain);
    const cleanup = [filter, gain];
    this._connectToMasterWithPan(gain, (Math.random() - 0.5) * 1.6, cleanup);
    this._autoCleanup(osc, cleanup);

    osc.start(now);
    osc.stop(now + 1.5);
  }

  /**
   * Realistic two-stage "Lub-Dub" heartbeat pulse near danger.
   */
  _playProximityHeartbeat(proximityFactor) {
    if (!this.initialized) return;
    const now = this.ctx.currentTime;
    const peak = 0.07 + proximityFactor * 0.24;

    // Beat 1: LUB
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(66, now);
    osc1.frequency.exponentialRampToValueAtTime(34, now + 0.14);
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.linearRampToValueAtTime(peak, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc1.connect(gain1);
    gain1.connect(this.masterGain);
    this._autoCleanup(osc1, [gain1]);
    osc1.start(now);
    osc1.stop(now + 0.16);

    // Beat 2: DUB (120ms later)
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(54, now + 0.12);
    osc2.frequency.exponentialRampToValueAtTime(28, now + 0.25);
    gain2.gain.setValueAtTime(0.001, now + 0.12);
    gain2.gain.linearRampToValueAtTime(peak * 0.78, now + 0.14);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    osc2.connect(gain2);
    gain2.connect(this.masterGain);
    this._autoCleanup(osc2, [gain2]);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.27);
  }

  update(dt) {
    if (!this.initialized) return;
    const now = this.ctx.currentTime;

    if (this.state.mode !== 'PLAYING') {
      this.humGain.gain.setTargetAtTime(0.015, now, 0.1);
      this.droneGain.gain.setTargetAtTime(0.015, now, 0.1);
      return;
    }

    const closest = this.state.levelInfo.closestEnemyDist ?? Infinity;
    const chaseActive = this.state.levelInfo.chaseActive;
    const warningActive = this.state.levelInfo.warningActive;
    const proximity = Math.max(0, Math.min(1, 1 - closest / 20.0));

    // Pre-encounter sudden silence: when an enemy first creeps within < 11m before chasing,
    // trigger a 1.1s acoustic vacuum where background hum drops out!
    if (!chaseActive && closest < 11.0 && !this.preEncounterTriggered) {
      this.preEncounterTriggered = true;
      this.triggerEncounterSilence(1.1);
    } else if (closest > 15.0) {
      this.preEncounterTriggered = false;
    }

    if (this.silenceTimer > 0 || warningActive) {
      this.silenceTimer = Math.max(0, this.silenceTimer - dt);
      this.humGain.gain.setTargetAtTime(0.003, now, 0.04);
      this.droneGain.gain.setTargetAtTime(0.008, now, 0.04);
    } else {
      this.humGain.gain.setTargetAtTime(this.baseHumGain, now, 0.18);
      const targetDroneGain = 0.05 + proximity * 0.18 + (chaseActive ? 0.08 : 0);
      this.droneGain.gain.setTargetAtTime(targetDroneGain, now, 0.1);
      this.droneFilter.frequency.setTargetAtTime(120 + proximity * 380, now, 0.1);
    }

    this.distantSoundTimer -= dt;
    if (this.distantSoundTimer <= 0) {
      this.distantSoundTimer = 11.0 + Math.random() * 9.0;
      this._playDistantCorridorSound();
    }

    if (proximity > 0.12) {
      this.proximityPulseTimer -= dt;
      if (this.proximityPulseTimer <= 0) {
        this.proximityPulseTimer = Math.max(0.32, 0.98 - proximity * 0.66);
        this._playProximityHeartbeat(proximity);
      }
    }
  }

  dispose() {
    if (!this.initialized || !this.ctx) return;
    try {
      this.humOsc1?.stop();
      this.humOsc2?.stop();
      this.droneOsc?.stop();
      this.ctx.close();
    } catch {
      // ignore
    }
    this.initialized = false;
  }
}
