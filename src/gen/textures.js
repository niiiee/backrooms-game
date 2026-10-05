import * as THREE from 'three';
import { SeededRNG } from './rng.js';

const textureCache = new Map();
const MAX_CACHE_ENTRIES = 6;

function createCanvas(w = 256, h = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  return { canvas, ctx };
}

function finalizeTexture(canvas, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function disposeBundle(bundle) {
  if (!bundle) return;
  Object.values(bundle).forEach((tex) => {
    if (tex && typeof tex.dispose === 'function') {
      tex.dispose();
    }
  });
}

export function clearProceduralTextureCache() {
  for (const bundle of textureCache.values()) {
    disposeBundle(bundle);
  }
  textureCache.clear();
}

/**
 * Adds multi-layered organic grime, capillary water tide lines, mold/rust clusters,
 * surface micro-cracks, and wear to any 2D canvas context.
 */
function applyGrimeAndWear(ctx, w, h, rng, options = {}) {
  const {
    grimeColor = [35, 30, 15],
    moldColor = [22, 26, 14],
    dripIntensity = 0.35,
    bottomDampness = 0.45,
    noiseStrength = 18,
    addCracks = true
  } = options;

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  for (let y = 0; y < h; y++) {
    const ny = y / h;
    for (let x = 0; x < w; x++) {
      const nx = x / w;
      const idx = (y * w + x) * 4;

      const fbm = rng.fbm2D(nx * 6, ny * 6, 3);
      const finePlotch = rng.fbm2D(nx * 14 + 3.7, ny * 14 + 1.9, 2);
      const drip = rng.fbm2D(nx * 22, ny * 2.2, 2);
      const grain = (rng.next() - 0.5) * noiseStrength;

      // Capillary water-damage tide line near floor baseboard
      const tideLine = Math.exp(-Math.pow((ny - (0.76 + fbm * 0.08)) / 0.025, 2)) * 0.32 * bottomDampness;
      const bottomMask = Math.pow(Math.max(0, (ny - 0.62) / 0.38), 1.65) * bottomDampness + tideLine;
      const topMask = Math.pow(Math.max(0, (0.22 - ny) / 0.22), 1.9) * (dripIntensity * 0.65);
      const stainPatch = fbm > 0.54 ? (fbm - 0.54) * 2.15 : 0;
      const moldSpot = finePlotch > 0.68 ? (finePlotch - 0.68) * 2.4 : 0;
      const dripFactor = drip > 0.59 && ny < 0.65 ? (drip - 0.59) * dripIntensity * 1.25 : 0;

      const totalStain = Math.min(0.84, bottomMask + topMask + stainPatch + dripFactor);

      let r = data[idx] * (1 - totalStain) + grimeColor[0] * totalStain;
      let g = data[idx + 1] * (1 - totalStain) + grimeColor[1] * totalStain;
      let b = data[idx + 2] * (1 - totalStain) + grimeColor[2] * totalStain;

      if (moldSpot > 0.01) {
        const mBlend = Math.min(0.65, moldSpot);
        r = r * (1 - mBlend) + moldColor[0] * mBlend;
        g = g * (1 - mBlend) + moldColor[1] * mBlend;
        b = b * (1 - mBlend) + moldColor[2] * mBlend;
      }

      data[idx] = Math.max(0, Math.min(255, r + grain));
      data[idx + 1] = Math.max(0, Math.min(255, g + grain));
      data[idx + 2] = Math.max(0, Math.min(255, b + grain));
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Add subtle procedural cracks, peeling seams, and scuff marks
  if (addCracks) {
    ctx.strokeStyle = 'rgba(18, 15, 10, 0.32)';
    ctx.lineWidth = 1;
    const crackCount = rng.int(3, 6);
    for (let c = 0; c < crackCount; c++) {
      let cx = rng.int(20, w - 20);
      let cy = rng.int(16, h - 24);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const segments = rng.int(4, 8);
      for (let s = 0; s < segments; s++) {
        cx += rng.int(-12, 12);
        cy += rng.int(4, 16);
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
  }
}

/**
 * Generates procedural wall, floor, ceiling, exitDoor, and wallMarking textures for a given theme.
 */
export function getProceduralTextures(theme = 'level0', seed = 'TEX-SEED') {
  const cacheKey = `${theme}:${seed}`;
  if (textureCache.has(cacheKey)) {
    return textureCache.get(cacheKey);
  }

  if (textureCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = textureCache.keys().next().value;
    disposeBundle(textureCache.get(oldestKey));
    textureCache.delete(oldestKey);
  }

  const rng = new SeededRNG(cacheKey);
  const w = 256;
  const h = 256;

  // 1. WALL TEXTURE
  const wall = createCanvas(w, h);
  const wCtx = wall.ctx;

  if (theme === 'level0') {
    wCtx.fillStyle = '#c7b25a';
    wCtx.fillRect(0, 0, w, h);

    // Subtle wallpaper roll seams & peeling edges
    for (let x = 0; x < w; x += 64) {
      wCtx.fillStyle = 'rgba(72, 60, 18, 0.24)';
      wCtx.fillRect(x, 0, 2, h);
      wCtx.fillStyle = 'rgba(215, 198, 118, 0.18)';
      wCtx.fillRect(x + 2, 0, 1, h);
    }

    // Classic Backrooms heraldic diamond & chevron motif
    wCtx.strokeStyle = 'rgba(142, 122, 46, 0.46)';
    wCtx.lineWidth = 2;
    for (let y = 16; y < h - 24; y += 32) {
      for (let x = 16; x < w; x += 32) {
        wCtx.beginPath();
        wCtx.moveTo(x, y - 9);
        wCtx.lineTo(x + 8, y);
        wCtx.lineTo(x, y + 9);
        wCtx.lineTo(x - 8, y);
        wCtx.closePath();
        wCtx.stroke();

        wCtx.fillStyle = 'rgba(128, 108, 36, 0.28)';
        wCtx.fillRect(x - 2, y - 2, 4, 4);
      }
    }

    // Peeling wallpaper tear patches revealing raw plaster underneath
    for (let p = 0; p < 3; p++) {
      const px = rng.int(24, w - 40);
      const py = rng.int(35, h - 55);
      const pw = rng.int(14, 28);
      const ph = rng.int(10, 22);
      wCtx.fillStyle = '#8b7d5b';
      wCtx.fillRect(px, py, pw, ph);
      wCtx.strokeStyle = '#574c29';
      wCtx.strokeRect(px, py, pw, ph);
    }

    applyGrimeAndWear(wCtx, w, h, rng, {
      grimeColor: [52, 44, 14],
      moldColor: [28, 32, 12],
      dripIntensity: 0.54,
      bottomDampness: 0.62,
      noiseStrength: 18
    });

    wCtx.fillStyle = '#4a3b22';
    wCtx.fillRect(0, h - 18, w, 18);
    wCtx.fillStyle = '#2d2312';
    wCtx.fillRect(0, h - 19, w, 2);
  } else if (theme === 'level1') {
    wCtx.fillStyle = '#56595c';
    wCtx.fillRect(0, 0, w, h);

    for (let y = 0; y < h; y += 64) {
      wCtx.fillStyle = 'rgba(25, 27, 30, 0.48)';
      wCtx.fillRect(0, y, w, 3);
      for (let x = 32; x < w; x += 64) {
        wCtx.beginPath();
        wCtx.arc(x, y + 32, 4, 0, Math.PI * 2);
        wCtx.fillStyle = '#222426';
        wCtx.fill();
        // Rust streak below tie-rod hole
        wCtx.fillStyle = 'rgba(92, 46, 22, 0.38)';
        wCtx.fillRect(x - 2, y + 36, 4, 22);
      }
    }

    applyGrimeAndWear(wCtx, w, h, rng, {
      grimeColor: [20, 22, 24],
      moldColor: [64, 34, 18],
      dripIntensity: 0.68,
      bottomDampness: 0.65,
      noiseStrength: 24
    });

    const stripeY = h - 42;
    wCtx.fillStyle = '#a88922';
    wCtx.fillRect(0, stripeY, w, 12);
    wCtx.fillStyle = '#1c1c1c';
    for (let x = -20; x < w + 20; x += 24) {
      wCtx.beginPath();
      wCtx.moveTo(x, stripeY);
      wCtx.lineTo(x + 12, stripeY);
      wCtx.lineTo(x + 4, stripeY + 12);
      wCtx.lineTo(x - 8, stripeY + 12);
      wCtx.closePath();
      wCtx.fill();
    }
  } else if (theme === 'level2') {
    wCtx.fillStyle = '#3d332c';
    wCtx.fillRect(0, 0, w, h);

    const brickH = 16;
    const brickW = 32;
    for (let row = 0; row < h / brickH; row++) {
      const y = row * brickH;
      const offset = (row % 2) * (brickW / 2);
      wCtx.fillStyle = '#211c18';
      wCtx.fillRect(0, y, w, 2);
      for (let x = -offset; x < w; x += brickW) {
        wCtx.fillStyle = '#211c18';
        wCtx.fillRect(x, y, 2, brickH);
        const shade = rng.int(-14, 14);
        wCtx.fillStyle = `rgb(${68 + shade}, ${54 + shade}, ${44 + shade})`;
        wCtx.fillRect(x + 2, y + 2, brickW - 3, brickH - 3);
      }
    }

    const pipeBands = [48, 120, 196];
    for (const py of pipeBands) {
      const grad = wCtx.createLinearGradient(0, py - 10, 0, py + 10);
      grad.addColorStop(0, '#2a1c12');
      grad.addColorStop(0.4, '#70482c');
      grad.addColorStop(1, '#1d130c');
      wCtx.fillStyle = grad;
      wCtx.fillRect(0, py - 10, w, 20);
    }

    applyGrimeAndWear(wCtx, w, h, rng, {
      grimeColor: [28, 18, 10],
      moldColor: [78, 32, 12],
      dripIntensity: 0.74,
      bottomDampness: 0.68,
      noiseStrength: 22
    });
  } else if (theme === 'level3') {
    wCtx.fillStyle = '#5e8488';
    wCtx.fillRect(0, 0, w, h);

    const tileSize = 32;
    for (let y = 0; y < h; y += tileSize) {
      for (let x = 0; x < w; x += tileSize) {
        const isCrackedTile = rng.chance(0.08);
        const tint = rng.int(-12, 12);
        const r = Math.min(255, (isCrackedTile ? 175 : 212) + tint);
        const g = Math.min(255, (isCrackedTile ? 205 : 238) + tint);
        const b = Math.min(255, (isCrackedTile ? 205 : 238) + tint);
        wCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        wCtx.fillRect(x + 2, y + 2, tileSize - 3, tileSize - 3);

        wCtx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        wCtx.fillRect(x + 4, y + 4, tileSize - 10, 4);
      }
    }

    applyGrimeAndWear(wCtx, w, h, rng, {
      grimeColor: [32, 88, 92],
      moldColor: [18, 62, 54],
      dripIntensity: 0.42,
      bottomDampness: 0.6,
      noiseStrength: 12
    });
  } else if (theme === 'level4') {
    wCtx.fillStyle = '#b8b4a6';
    wCtx.fillRect(0, 0, w, h);

    wCtx.fillStyle = '#58646e';
    wCtx.fillRect(0, h * 0.45, w, h * 0.55);

    wCtx.fillStyle = '#3b3f45';
    wCtx.fillRect(0, h * 0.44, w, 6);

    // Subtle acoustic partition vertical grooves
    for (let x = 0; x < w; x += 64) {
      wCtx.fillStyle = 'rgba(30, 34, 38, 0.28)';
      wCtx.fillRect(x, 0, 2, h);
    }

    applyGrimeAndWear(wCtx, w, h, rng, {
      grimeColor: [42, 40, 35],
      moldColor: [30, 32, 26],
      dripIntensity: 0.44,
      bottomDampness: 0.5,
      noiseStrength: 18
    });

    wCtx.fillStyle = '#2d3033';
    wCtx.fillRect(0, h - 16, w, 16);
  } else {
    wCtx.fillStyle = '#6b1d24';
    wCtx.fillRect(0, 0, w, h);

    wCtx.strokeStyle = 'rgba(168, 122, 50, 0.4)';
    wCtx.lineWidth = 2;
    for (let y = 20; y < h * 0.62; y += 36) {
      for (let x = 20; x < w; x += 36) {
        wCtx.beginPath();
        wCtx.moveTo(x, y - 12);
        wCtx.lineTo(x + 10, y);
        wCtx.lineTo(x, y + 12);
        wCtx.lineTo(x - 10, y);
        wCtx.closePath();
        wCtx.stroke();
      }
    }

    const wainscotY = Math.floor(h * 0.62);
    wCtx.fillStyle = '#2e1610';
    wCtx.fillRect(0, wainscotY, w, h - wainscotY);
    wCtx.fillStyle = '#8f6b32';
    wCtx.fillRect(0, wainscotY - 3, w, 4);

    wCtx.strokeStyle = '#1a0b07';
    wCtx.lineWidth = 3;
    for (let x = 12; x < w; x += 64) {
      wCtx.strokeRect(x, wainscotY + 10, 44, h - wainscotY - 22);
    }

    applyGrimeAndWear(wCtx, w, h, rng, {
      grimeColor: [18, 6, 6],
      moldColor: [38, 10, 12],
      dripIntensity: 0.56,
      bottomDampness: 0.55,
      noiseStrength: 19
    });
  }

  // 2. FLOOR TEXTURE
  const floor = createCanvas(w, h);
  const fCtx = floor.ctx;

  if (theme === 'level0') {
    fCtx.fillStyle = '#8b7941';
    fCtx.fillRect(0, 0, w, h);
    fCtx.fillStyle = 'rgba(55, 45, 18, 0.34)';
    for (let y = 0; y < h; y += 4) {
      for (let x = y % 8 === 0 ? 0 : 2; x < w; x += 4) {
        fCtx.fillRect(x, y, 2, 2);
      }
    }
    // Soggy dark carpet water-stain patch
    fCtx.fillStyle = 'rgba(42, 34, 12, 0.28)';
    fCtx.beginPath();
    fCtx.arc(rng.int(60, 190), rng.int(60, 190), rng.int(28, 52), 0, Math.PI * 2);
    fCtx.fill();

    applyGrimeAndWear(fCtx, w, h, rng, {
      grimeColor: [38, 31, 10],
      dripIntensity: 0.32,
      bottomDampness: 0.25,
      noiseStrength: 24,
      addCracks: false
    });
  } else if (theme === 'level1') {
    fCtx.fillStyle = '#424548';
    fCtx.fillRect(0, 0, w, h);
    fCtx.strokeStyle = 'rgba(20, 20, 22, 0.55)';
    fCtx.lineWidth = 2;
    fCtx.strokeRect(2, 2, w - 4, h - 4);
    applyGrimeAndWear(fCtx, w, h, rng, {
      grimeColor: [14, 15, 16],
      dripIntensity: 0.45,
      bottomDampness: 0.35,
      noiseStrength: 26
    });
  } else if (theme === 'level2') {
    fCtx.fillStyle = '#26221e';
    fCtx.fillRect(0, 0, w, h);
    fCtx.strokeStyle = '#4a382b';
    fCtx.lineWidth = 2;
    for (let i = 0; i < w; i += 16) {
      fCtx.beginPath();
      fCtx.moveTo(i, 0);
      fCtx.lineTo(i, h);
      fCtx.moveTo(0, i);
      fCtx.lineTo(w, i);
      fCtx.stroke();
    }
    applyGrimeAndWear(fCtx, w, h, rng, {
      grimeColor: [45, 22, 10],
      dripIntensity: 0.52,
      bottomDampness: 0.35,
      noiseStrength: 22
    });
  } else if (theme === 'level3') {
    fCtx.fillStyle = '#3bb8b3';
    fCtx.fillRect(0, 0, w, h);
    const tileSize = 32;
    fCtx.strokeStyle = 'rgba(25, 95, 95, 0.45)';
    fCtx.lineWidth = 2;
    for (let i = 0; i <= w; i += tileSize) {
      fCtx.beginPath();
      fCtx.moveTo(i, 0);
      fCtx.lineTo(i, h);
      fCtx.moveTo(0, i);
      fCtx.lineTo(w, i);
      fCtx.stroke();
    }
    fCtx.strokeStyle = 'rgba(215, 255, 252, 0.45)';
    fCtx.lineWidth = 3;
    for (let i = 0; i < 18; i++) {
      fCtx.beginPath();
      fCtx.arc(rng.int(20, w - 20), rng.int(20, h - 20), rng.int(12, 36), 0, Math.PI * 1.4);
      fCtx.stroke();
    }
    applyGrimeAndWear(fCtx, w, h, rng, {
      grimeColor: [20, 80, 85],
      dripIntensity: 0.18,
      bottomDampness: 0.12,
      noiseStrength: 10,
      addCracks: false
    });
  } else if (theme === 'level4') {
    fCtx.fillStyle = '#3e4752';
    fCtx.fillRect(0, 0, w, h);
    fCtx.strokeStyle = 'rgba(25, 30, 36, 0.45)';
    fCtx.lineWidth = 2;
    for (let i = 0; i <= w; i += 64) {
      fCtx.beginPath();
      fCtx.moveTo(i, 0);
      fCtx.lineTo(i, h);
      fCtx.moveTo(0, i);
      fCtx.lineTo(w, i);
      fCtx.stroke();
    }
    applyGrimeAndWear(fCtx, w, h, rng, {
      grimeColor: [24, 22, 18],
      dripIntensity: 0.35,
      bottomDampness: 0.28,
      noiseStrength: 20
    });
  } else {
    fCtx.fillStyle = '#4d1419';
    fCtx.fillRect(0, 0, w, h);
    fCtx.strokeStyle = 'rgba(170, 125, 48, 0.4)';
    fCtx.lineWidth = 3;
    fCtx.strokeRect(16, 16, w - 32, h - 32);
    fCtx.strokeRect(48, 48, w - 96, h - 96);
    applyGrimeAndWear(fCtx, w, h, rng, {
      grimeColor: [15, 5, 5],
      dripIntensity: 0.38,
      bottomDampness: 0.32,
      noiseStrength: 18,
      addCracks: false
    });
  }

  // 3. CEILING TEXTURE (with water-leak rings & stained acoustic tiles)
  const ceiling = createCanvas(w, h);
  const cCtx = ceiling.ctx;
  cCtx.fillStyle = theme === 'level3' ? '#d4e8e8' : theme === 'level5' ? '#2b1410' : '#9c9680';
  cCtx.fillRect(0, 0, w, h);
  cCtx.strokeStyle = 'rgba(40, 38, 32, 0.55)';
  cCtx.lineWidth = 3;
  for (let i = 0; i <= w; i += 64) {
    cCtx.beginPath();
    cCtx.moveTo(i, 0);
    cCtx.lineTo(i, h);
    cCtx.moveTo(0, i);
    cCtx.lineTo(w, i);
    cCtx.stroke();
  }
  // Brownish ceiling water-leak ring
  cCtx.strokeStyle = 'rgba(62, 48, 22, 0.36)';
  cCtx.lineWidth = 4;
  cCtx.beginPath();
  cCtx.arc(rng.int(48, 200), rng.int(48, 200), rng.int(18, 34), 0, Math.PI * 2);
  cCtx.stroke();

  applyGrimeAndWear(cCtx, w, h, rng, {
    grimeColor: [35, 32, 24],
    dripIntensity: 0.48,
    bottomDampness: 0.32,
    noiseStrength: 18
  });

  // 4. EXIT DOOR TEXTURE
  const exitDoor = createCanvas(w, h);
  const eCtx = exitDoor.ctx;
  eCtx.fillStyle = '#2b302c';
  eCtx.fillRect(0, 0, w, h);
  eCtx.strokeStyle = '#141715';
  eCtx.lineWidth = 10;
  eCtx.strokeRect(8, 8, w - 16, h - 16);
  eCtx.fillStyle = '#1a0505';
  eCtx.fillRect(64, 24, 128, 42);
  eCtx.fillStyle = '#ff3b30';
  eCtx.font = 'bold 30px monospace';
  eCtx.textAlign = 'center';
  eCtx.fillText('EXIT', 128, 55);
  eCtx.fillStyle = '#8c8c84';
  eCtx.fillRect(36, 134, w - 72, 12);
  applyGrimeAndWear(eCtx, w, h, rng, {
    grimeColor: [20, 15, 12],
    dripIntensity: 0.3,
    bottomDampness: 0.35,
    noiseStrength: 14
  });

  // 5. SURVIVOR WALL MARKING DECAL TEXTURE (Chalk/Charcoal warnings, tally marks, arrows)
  const marking = createCanvas(w, h);
  const mCtx = marking.ctx;
  mCtx.fillStyle = '#242018';
  mCtx.fillRect(0, 0, w, h);
  mCtx.strokeStyle = '#6e6244';
  mCtx.lineWidth = 4;
  mCtx.strokeRect(6, 6, w - 12, h - 12);

  const phrases = ["DON'T LOOK", 'NO EXIT', 'LISTEN', 'IT HEARS YOU'];
  const chosenPhrase = phrases[rng.int(0, phrases.length - 1)];
  mCtx.fillStyle = '#d8cfb0';
  mCtx.font = 'bold 26px monospace';
  mCtx.textAlign = 'center';
  mCtx.fillText(chosenPhrase, 128, 72);

  // Scrawled directional arrow
  mCtx.strokeStyle = '#c94030';
  mCtx.lineWidth = 6;
  mCtx.beginPath();
  mCtx.moveTo(52, 135);
  mCtx.lineTo(204, 135);
  mCtx.lineTo(172, 108);
  mCtx.moveTo(204, 135);
  mCtx.lineTo(172, 162);
  mCtx.stroke();

  // Survivor tally marks ||||
  mCtx.strokeStyle = '#b8ae8e';
  mCtx.lineWidth = 3;
  for (let t = 0; t < 4; t++) {
    const tx = 84 + t * 18;
    mCtx.beginPath();
    mCtx.moveTo(tx, 185);
    mCtx.lineTo(tx - 3, 224);
    mCtx.stroke();
  }
  mCtx.beginPath();
  mCtx.moveTo(74, 216);
  mCtx.lineTo(150, 192);
  mCtx.stroke();

  const bundle = {
    wall: finalizeTexture(wall.canvas, 1, 1),
    floor: finalizeTexture(floor.canvas, 1, 1),
    ceiling: finalizeTexture(ceiling.canvas, 1, 1),
    exitDoor: finalizeTexture(exitDoor.canvas, 1, 1),
    wallMarking: finalizeTexture(marking.canvas, 1, 1)
  };

  textureCache.set(cacheKey, bundle);
  return bundle;
}
