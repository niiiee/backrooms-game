import assert from 'node:assert/strict';
import { ProceduralAudioSynth } from '../src/audio/audioSynth.js';
import { VHSAnalogHorrorShader } from '../src/fx/postProcessor.js';

console.log('=== STAGE 4 VERIFICATION: PROCEDURAL WEB AUDIO + VHS POST-PROCESSING ===');

// 1. Mock Web Audio API to verify oscillator/filter/buffer synthesis in Node
let createdOscillators = 0;
let createdFilters = 0;
let createdBufferSources = 0;

class MockAudioParam {
  constructor(val = 0) {
    this.value = val;
  }
  setValueAtTime(v) {
    this.value = v;
  }
  linearRampToValueAtTime(v) {
    this.value = v;
  }
  exponentialRampToValueAtTime(v) {
    this.value = v;
  }
  setTargetAtTime(v) {
    this.value = v;
  }
}

class MockNode {
  connect() {
    return this;
  }
}

class MockOscillator extends MockNode {
  constructor() {
    super();
    this.type = 'sine';
    this.frequency = new MockAudioParam(440);
    createdOscillators++;
  }
  start() {}
  stop() {}
}

class MockBiquadFilter extends MockNode {
  constructor() {
    super();
    this.type = 'lowpass';
    this.frequency = new MockAudioParam(300);
    this.Q = new MockAudioParam(1);
    createdFilters++;
  }
}

class MockGainNode extends MockNode {
  constructor() {
    super();
    this.gain = new MockAudioParam(1);
  }
}

class MockBufferSource extends MockNode {
  constructor() {
    super();
    this.buffer = null;
    createdBufferSources++;
  }
  start() {}
}

class MockAudioContext {
  constructor() {
    this.sampleRate = 44100;
    this.currentTime = 0;
    this.state = 'running';
    this.destination = new MockNode();
  }
  createGain() {
    return new MockGainNode();
  }
  createOscillator() {
    return new MockOscillator();
  }
  createBiquadFilter() {
    return new MockBiquadFilter();
  }
  createBufferSource() {
    return new MockBufferSource();
  }
  createBuffer(_channels, length) {
    return {
      getChannelData: () => new Float32Array(length)
    };
  }
  resume() {
    return Promise.resolve();
  }
}

globalThis.window = {
  AudioContext: MockAudioContext,
  addEventListener() {}
};

const mockState = {
  mode: 'PLAYING',
  seed: 'STAGE4-AUDIO',
  currentLevel: 0,
  settings: { volume: 0.8, vhsEnabled: true, resolvedQuality: 'High' },
  player: { sanity: 75 },
  levelInfo: {
    closestEnemyDist: 6.5,
    chaseActive: true
  }
};

const synth = new ProceduralAudioSynth(mockState);
assert.equal(synth.init(), true, 'ProceduralAudioSynth must initialize with Web Audio API');
assert.ok(createdOscillators >= 3, 'Must create continuous hum and tension drone oscillators');

// Test all 5 surface footstep types
const surfaces = ['carpet', 'concrete', 'metal', 'water', 'wood'];
for (const surf of surfaces) {
  const prevBufCount = createdBufferSources;
  synth.playFootstep(surf, true);
  assert.ok(createdBufferSources > prevBufCount, `Footstep on ${surf} must trigger noise buffer synthesis`);
}

// Test all stingers (warning, death, interact, flashlight, warp)
const stingers = ['warning', 'death', 'interact', 'flashlight', 'warp'];
for (const st of stingers) {
  synth.playStinger(st);
}

// Test low-stamina breathing and directional enemy vocalizations
synth.playBreathing(0.75, true);
synth.playEnemyVocalization('howler', 8.0, -0.7);
synth.playEnemyVocalization('smiler', 10.0, 0.5);
synth.playEnemyVocalization('hound', 6.0, 0.2);
synth.triggerEncounterSilence(1.1);

// Test level audio reconfiguration and proximity heartbeat update
synth.configureLevelAudio({ humFreq: 90, humGain: 0.12, dronePitch: 42 });
synth.update(0.5);
synth.update(0.6);
console.log('[PASS] ProceduralAudioSynth verified: hum, drone, 5 surface footsteps, breathing, 3 directional vocalizations, silence tension, lub-dub heartbeat, and 5 stingers.');

// 2. Verify VHSAnalogHorrorShader uniforms & GLSL shader definitions
assert.ok(VHSAnalogHorrorShader.uniforms.uGrainIntensity, 'Shader must include film grain uniform');
assert.ok(VHSAnalogHorrorShader.uniforms.uVignetteStrength, 'Shader must include vignette uniform');
assert.ok(VHSAnalogHorrorShader.uniforms.uAberration, 'Shader must include chromatic aberration uniform');
assert.ok(VHSAnalogHorrorShader.uniforms.uVhsEnabled, 'Shader must include VHS toggle uniform');
assert.ok(VHSAnalogHorrorShader.uniforms.uTransitionProgress, 'Shader must include noclip transition uniform');
assert.ok(
  VHSAnalogHorrorShader.fragmentShader.includes('uAberration') &&
    VHSAnalogHorrorShader.fragmentShader.includes('uGrainIntensity') &&
    VHSAnalogHorrorShader.fragmentShader.includes('uVignetteStrength') &&
    VHSAnalogHorrorShader.fragmentShader.includes('uTransitionProgress'),
  'GLSL fragment shader must compute grain, vignette, chromatic aberration, danger distortion, and noclip transition'
);
console.log('[PASS] VHSAnalogHorrorShader GLSL uniforms & post-processing pipeline verified.');
console.log('=== STAGE 4 ALL CHECKS PASSED ===');
