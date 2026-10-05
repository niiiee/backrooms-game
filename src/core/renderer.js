import * as THREE from 'three';

/**
 * Manages Three.js WebGLRenderer, PerspectiveCamera, Scene, Fog,
 * First-Person Handheld Flashlight + Volumetric Beam + SpotLight,
 * and Quality Presets (Low / Medium / High).
 */
export class RendererManager {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.state = state;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0a06);
    this.scene.fog = new THREE.FogExp2(0x141208, 0.055);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      85
    );
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.detectedQuality = this.detectDeviceQuality();
    this.activeQuality =
      state.settings.quality === 'Auto' ? this.detectedQuality : state.settings.quality;
    state.settings.resolvedQuality = this.activeQuality;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.activeQuality === 'High',
      powerPreference: 'high-performance'
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this._setupLights();
    this.applyQualityPreset(this.activeQuality);
    this._setupResizeObserver();
  }

  detectDeviceQuality() {
    try {
      const cores = navigator.hardwareConcurrency || 4;
      const memory = navigator.deviceMemory || 4;
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
      let rendererStr = '';
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          rendererStr = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
        }
      }
      const isSoftwareOrIntegrated =
        /SwiftShader|llvmpipe|Software|Basic Render|Intel\(R\) HD|UHD Graphics 6/i.test(
          rendererStr
        );
      if (isSoftwareOrIntegrated || cores <= 2 || memory <= 2) {
        return 'Low';
      }
      if (cores >= 8 && memory >= 8) {
        return 'High';
      }
      return 'Medium';
    } catch {
      return 'Medium';
    }
  }

  _setupLights() {
    this.ambientLight = new THREE.HemisphereLight(0xd9cf98, 0x262112, 0.32);
    this.scene.add(this.ambientLight);

    // Subtle close-range personal glow so pitch-black rooms remain navigable at 0% battery
    this.personalGlow = new THREE.PointLight(0xffe6a3, 0.22, 4.0, 1.8);
    this.camera.add(this.personalGlow);

    // High-power Player Flashlight (SpotLight calibrated for Three.js r170 physically-based units)
    this.flashlight = new THREE.SpotLight(0xfff9e6, 28.0, 38, Math.PI / 4.8, 0.38, 0.9);
    this.flashlight.position.set(0.24, -0.18, -0.15);
    this.flashlightTarget = new THREE.Object3D();
    this.flashlightTarget.position.set(0, -0.04, -12);
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlightTarget);
    this.flashlight.target = this.flashlightTarget;

    // Secondary close-fill beam light so nearby walls/floors directly in front light up vividly
    this.flashlightFill = new THREE.SpotLight(0xfff2c2, 12.0, 14, Math.PI / 3.2, 0.65, 1.0);
    this.flashlightFill.position.set(0.24, -0.18, -0.15);
    this.flashlightFill.target = this.flashlightTarget;
    this.camera.add(this.flashlightFill);

    // First-person handheld flashlight model & volumetric beam cone in bottom-right of view
    this.flashlightRig = new THREE.Group();
    this.flashlightRig.position.set(0.26, -0.22, -0.36);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1e2022,
      roughness: 0.35,
      metalness: 0.8
    });
    const bodyMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.026, 0.24, 10),
      bodyMat
    );
    bodyMesh.rotation.x = Math.PI * 0.5;
    this.flashlightRig.add(bodyMesh);

    const headBezel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.042, 0.032, 0.05, 12),
      bodyMat
    );
    headBezel.rotation.x = Math.PI * 0.5;
    headBezel.position.z = -0.13;
    this.flashlightRig.add(headBezel);

    this.flashlightLensMat = new THREE.MeshBasicMaterial({
      color: 0xfffbe0
    });
    const lensMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.036, 12),
      this.flashlightLensMat
    );
    lensMesh.position.z = -0.156;
    lensMesh.rotation.y = Math.PI;
    this.flashlightRig.add(lensMesh);

    // Translucent volumetric beam cone extending forward from flashlight lens
    const coneGeo = new THREE.ConeGeometry(1.15, 5.2, 16, 1, true);
    coneGeo.translate(0, -2.6, 0);
    coneGeo.rotateX(-Math.PI * 0.5);
    this.flashlightBeamMat = new THREE.MeshBasicMaterial({
      color: 0xfff6cc,
      transparent: true,
      opacity: 0.085,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.flashlightBeamMesh = new THREE.Mesh(coneGeo, this.flashlightBeamMat);
    this.flashlightBeamMesh.position.z = -0.16;
    this.flashlightRig.add(this.flashlightBeamMesh);

    this.camera.add(this.flashlightRig);
  }

  /**
   * Updates flashlight SpotLight + close fill + volumetric beam cone + lens state.
   */
  setFlashlightOutput(enabled, factor = 1.0) {
    if (!this.flashlight) return;
    if (!enabled || factor <= 0.001) {
      this.flashlight.intensity = 0;
      if (this.flashlightFill) this.flashlightFill.intensity = 0;
      if (this.flashlightBeamMesh) this.flashlightBeamMesh.visible = false;
      if (this.flashlightLensMat) this.flashlightLensMat.color.setHex(0x1a1a18);
      return;
    }

    this.flashlight.intensity = 28.0 * factor;
    if (this.flashlightFill) {
      this.flashlightFill.intensity = 12.0 * factor;
    }
    if (this.flashlightBeamMesh) {
      this.flashlightBeamMesh.visible = true;
      this.flashlightBeamMat.opacity = 0.075 * Math.min(1.2, factor);
    }
    if (this.flashlightLensMat) {
      this.flashlightLensMat.color.setHex(0xfffbe0);
    }
  }

  applyQualityPreset(preset) {
    const resolved = preset === 'Auto' ? this.detectedQuality : preset;
    this.activeQuality = resolved;
    this.state.settings.resolvedQuality = resolved;

    const dpr = window.devicePixelRatio || 1;
    if (resolved === 'Low') {
      this.renderer.setPixelRatio(Math.min(dpr, 1.0));
      this.renderer.shadowMap.enabled = false;
      this.flashlight.castShadow = false;
      this.camera.far = 55;
    } else if (resolved === 'Medium') {
      this.renderer.setPixelRatio(Math.min(dpr, 1.35));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.flashlight.castShadow = true;
      this.flashlight.shadow.mapSize.width = 512;
      this.flashlight.shadow.mapSize.height = 512;
      this.camera.far = 70;
    } else {
      this.renderer.setPixelRatio(Math.min(dpr, 1.75));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.flashlight.castShadow = true;
      this.flashlight.shadow.mapSize.width = 1024;
      this.flashlight.shadow.mapSize.height = 1024;
      this.camera.far = 90;
    }
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  configureAtmosphere({
    bgColor = 0x0b0a06,
    fogColor = 0x141208,
    fogDensity = 0.055,
    ambientSky = 0xd9cf98,
    ambientGround = 0x262112,
    ambientIntensity = 0.34
  } = {}) {
    this.scene.background.setHex(bgColor);
    this.scene.fog.color.setHex(fogColor);
    this.scene.fog.density = fogDensity;
    this.ambientLight.color.setHex(ambientSky);
    this.ambientLight.groundColor.setHex(ambientGround);
    this.ambientLight.intensity = ambientIntensity;
  }

  _setupResizeObserver() {
    const handleResize = () => {
      const w = window.innerWidth || 800;
      const h = window.innerHeight || 600;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
      if (this.onResizeCallback) {
        this.onResizeCallback(w, h);
      }
    };

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(handleResize);
      this.resizeObserver.observe(this.canvas);
    }
    window.addEventListener('resize', handleResize);
    handleResize();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
