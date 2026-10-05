import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Custom GLSL Post-Processing Shader combining:
 * - Film Grain (animated hash noise)
 * - Vignette (radial edge falloff intensified by low sanity / danger)
 * - Chromatic Aberration & Barrel Screen Distortion when close to danger
 * - VHS Scanlines, Tracking Bar & Horizontal Tape Jitter
 * - Noclip / VHS Glitch / Fade Level Transition effect (uTransitionProgress)
 */
export const VHSAnalogHorrorShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0.0 },
    uGrainIntensity: { value: 0.075 },
    uVignetteStrength: { value: 0.42 },
    uAberration: { value: 0.0022 },
    uVhsEnabled: { value: 1.0 },
    uDangerFactor: { value: 0.0 },
    uTransitionProgress: { value: 0.0 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrainIntensity;
    uniform float uVignetteStrength;
    uniform float uAberration;
    uniform float uVhsEnabled;
    uniform float uDangerFactor;
    uniform float uTransitionProgress;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      vec2 centerOffset = uv - 0.5;
      float radialDist = length(centerOffset);

      // 1. Proximity Danger Screen Distortion (Radial Barrel Warp + Glitch Slices)
      if (uDangerFactor > 0.01) {
        float warp = radialDist * radialDist * uDangerFactor * 0.16 * (0.8 + 0.2 * sin(uTime * 18.0));
        uv += centerOffset * warp;

        float dangerSlice = hash(vec2(floor(uv.y * 42.0), floor(uTime * 24.0)));
        if (dangerSlice > 1.0 - uDangerFactor * 0.22) {
          uv.x += (dangerSlice - 0.5) * 0.045 * uDangerFactor;
        }
      }

      // 2. Smooth Noclip / VHS Glitch Transition between Levels
      if (uTransitionProgress > 0.001) {
        float noclipSlice = hash(vec2(floor(uv.y * 32.0), floor(uTime * 35.0)));
        uv.x += (noclipSlice - 0.5) * 0.18 * uTransitionProgress;
        uv.y = fract(uv.y + uTransitionProgress * 0.35 * sin(uTime * 12.0));
      }

      // 3. VHS Horizontal Tracking Band & Jitter
      if (uVhsEnabled > 0.5) {
        float trackBar = fract(uTime * 0.14);
        float distToBar = abs(uv.y - trackBar);
        if (distToBar < 0.035) {
          float barPull = (1.0 - distToBar / 0.035) * 0.012;
          uv.x += sin(uv.y * 90.0 + uTime * 25.0) * barPull;
        }
        float lineNoise = hash(vec2(floor(uv.y * 240.0), floor(uTime * 18.0)));
        if (lineNoise > 0.985) {
          uv.x += (lineNoise - 0.985) * 0.18;
        }
      }

      // 4. Chromatic Aberration (amplified by danger & noclip transition)
      float shift = uAberration * (1.0 + radialDist * 1.8 + uDangerFactor * 3.8 + uTransitionProgress * 12.0);

      float r = texture2D(tDiffuse, clamp(uv + vec2(shift, 0.0), 0.0, 1.0)).r;
      float g = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).g;
      float b = texture2D(tDiffuse, clamp(uv - vec2(shift, 0.0), 0.0, 1.0)).b;
      vec3 color = vec3(r, g, b);

      // 5. VHS Scanlines
      if (uVhsEnabled > 0.5) {
        float scanline = sin(uv.y * 520.0) * 0.035;
        color -= scanline;
      }

      // 6. Procedural Film Grain
      float grain = (hash(uv * 400.0 + vec2(uTime * 37.0, uTime * 19.0)) - 0.5) *
        (uGrainIntensity + uDangerFactor * 0.06 + uTransitionProgress * 0.15);
      color += grain;

      // 7. Vignette + Danger Pulse
      float vig = smoothstep(0.82, 0.22, radialDist * (0.85 + uVignetteStrength + uDangerFactor * 0.35));
      color *= mix(0.18, 1.0, vig);

      if (uDangerFactor > 0.01) {
        float pulse = 0.65 + 0.35 * sin(uTime * 11.0);
        float redEdge = smoothstep(0.24, 0.76, radialDist) * uDangerFactor * 0.36 * pulse;
        color.r += redEdge;
        color.gb *= (1.0 - redEdge * 0.45);
      }

      // 8. Noclip Transition Fade-In/Out Envelope
      if (uTransitionProgress > 0.001) {
        color = mix(color, vec3(0.04, 0.03, 0.01), smoothstep(0.0, 0.85, uTransitionProgress));
      }

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `
};

/**
 * Manages Post-Processing pipeline (UnrealBloomPass + VHS/Grain/Vignette/ChromaticAberration ShaderPass),
 * Noclip level transitions, and the VHS Camcorder HUD overlay.
 */
export class PostProcessor {
  constructor(rendererManager, state, overlayContainer) {
    this.rendererManager = rendererManager;
    this.state = state;
    this.overlayContainer = overlayContainer;

    this.composer = null;
    this.bloomPass = null;
    this.vhsPass = null;
    this.transitionTimer = 0;
    this.transitionDuration = 0.85;
    this.lastTime = 0;

    this._initComposer();
    this._initVHSOverlay();

    this.rendererManager.onResizeCallback = (w, h) => this.resize(w, h);
  }

  _initComposer() {
    const { renderer, scene, camera } = this.rendererManager;
    const w = window.innerWidth || 800;
    const h = window.innerHeight || 600;

    this.composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.floor(w * 0.5), Math.floor(h * 0.5)),
      0.38,
      0.35,
      0.82
    );
    this.composer.addPass(this.bloomPass);

    this.vhsPass = new ShaderPass(VHSAnalogHorrorShader);
    this.composer.addPass(this.vhsPass);

    this.applyQuality(this.state.settings.resolvedQuality);
  }

  _initVHSOverlay() {
    if (!this.overlayContainer) return;
    this.overlayContainer.innerHTML = `
      <div id="vhs-camcorder-frame" style="
        position:absolute; inset:16px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        pointer-events:none;
        display:flex;
        flex-direction:column;
        justify-content:flex-end;
        padding: 12px 18px;
        font-family: var(--font-mono);
        font-size: 11px;
        color: rgba(240, 234, 210, 0.58);
        text-shadow: 1px 1px 2px rgba(0,0,0,0.95);
      ">
        <div style="display:flex; justify-content:space-between; align-items:flex-end;">
          <div>
            <span style="color:#ff3b30; font-weight:bold;">&#9679; REC</span> &nbsp;SP &nbsp;
            <span id="vhs-tape-seed">TAPE // ARCHIVE-1989</span>
          </div>
          <div id="vhs-timecode">OCT 05 1989 &nbsp; 00:00:00</div>
        </div>
      </div>
    `;
    this.elFrame = this.overlayContainer.querySelector('#vhs-camcorder-frame');
    this.elTimecode = this.overlayContainer.querySelector('#vhs-timecode');
    this.elTapeSeed = this.overlayContainer.querySelector('#vhs-tape-seed');
  }

  /**
   * Triggers a smooth noclip / VHS glitch / fade transition when entering a level.
   */
  triggerLevelTransition(duration = 0.85) {
    this.transitionDuration = Math.max(0.1, duration);
    this.transitionTimer = this.transitionDuration;
    if (this.vhsPass) {
      this.vhsPass.uniforms.uTransitionProgress.value = 1.0;
    }
  }

  applyQuality(qualityPreset) {
    if (!this.bloomPass || !this.vhsPass) return;
    if (qualityPreset === 'Low') {
      this.bloomPass.enabled = false;
      this.vhsPass.uniforms.uGrainIntensity.value = 0.055;
    } else if (qualityPreset === 'Medium') {
      this.bloomPass.enabled = true;
      this.bloomPass.strength = 0.32;
      this.vhsPass.uniforms.uGrainIntensity.value = 0.072;
    } else {
      this.bloomPass.enabled = true;
      this.bloomPass.strength = 0.42;
      this.vhsPass.uniforms.uGrainIntensity.value = 0.082;
    }
  }

  resize(w, h) {
    if (!this.composer) return;
    this.composer.setSize(w, h);
    if (this.bloomPass) {
      this.bloomPass.resolution.set(Math.floor(w * 0.5), Math.floor(h * 0.5));
    }
  }

  update(elapsedTime) {
    const dt = Math.max(0, Math.min(0.1, elapsedTime - this.lastTime));
    this.lastTime = elapsedTime;

    if (this.transitionTimer > 0) {
      this.transitionTimer = Math.max(0, this.transitionTimer - dt);
    }

    const vhsOn = this.state.settings.vhsEnabled !== false;
    const closest = this.state.levelInfo.closestEnemyDist ?? Infinity;
    const proximity = Math.max(0, Math.min(1, 1 - closest / 17.0));
    const lowSanity = Math.max(0, (100 - this.state.player.sanity) / 100);
    const chaseBoost = this.state.levelInfo.chaseActive ? 0.42 : 0;
    const danger = Math.min(1.0, proximity * 0.78 + lowSanity * 0.4 + chaseBoost);

    if (this.vhsPass) {
      const u = this.vhsPass.uniforms;
      u.uTime.value = elapsedTime;
      u.uVhsEnabled.value = vhsOn ? 1.0 : 0.0;
      u.uDangerFactor.value = danger;
      u.uVignetteStrength.value = 0.4 + danger * 0.38;
      u.uAberration.value = 0.002 + danger * 0.0055;
      u.uTransitionProgress.value =
        this.transitionDuration > 0 ? this.transitionTimer / this.transitionDuration : 0.0;
    }

    if (this.elFrame) {
      this.elFrame.style.display = vhsOn && this.state.mode === 'PLAYING' ? 'flex' : 'none';
      if (vhsOn && this.state.mode === 'PLAYING') {
        const totalSec = Math.floor(elapsedTime);
        const mins = String(Math.floor(totalSec / 60) % 60).padStart(2, '0');
        const secs = String(totalSec % 60).padStart(2, '0');
        const frames = String(Math.floor((elapsedTime % 1) * 30)).padStart(2, '0');
        this.elTimecode.textContent = `OCT 05 1989   00:${mins}:${secs}:${frames}`;
        this.elTapeSeed.textContent = `TAPE // ${this.state.seed} // L${this.state.currentLevel}`;
      }
    }
  }

  render() {
    if (this.composer) {
      this.composer.render();
    }
  }
}
