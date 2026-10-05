/**
 * Seeded pseudo-random number generator (xmur3 + mulberry32)
 * with 2D value/fractal noise for procedural textures and level generation.
 */
export class SeededRNG {
  constructor(seed = 'BACKROOMS-1989') {
    this.seedString = String(seed);
    const hashFn = SeededRNG.xmur3(this.seedString);
    this.state = hashFn();
  }

  static xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  /** Returns a float in [0, 1) */
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns a float in [min, max) */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** Returns an integer in [min, max] inclusive */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  /** Returns true with probability p */
  chance(p = 0.5) {
    return this.next() < p;
  }

  /** Picks a random element from a non-empty array */
  pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** In-place Fisher-Yates shuffle (returns array) */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /** Deterministic 2D hash in [0, 1) */
  hash2D(x, y) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + (this.state ^ 0x9e3779b9);
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /** Smooth 2D value noise in [0, 1) */
  noise2D(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;

    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);

    const aa = this.hash2D(xi, yi);
    const ba = this.hash2D(xi + 1, yi);
    const ab = this.hash2D(xi, yi + 1);
    const bb = this.hash2D(xi + 1, yi + 1);

    const x1 = aa + u * (ba - aa);
    const x2 = ab + u * (bb - ab);
    return x1 + v * (x2 - x1);
  }

  /** Fractal Brownian Motion 2D noise in [0, 1) */
  fbm2D(x, y, octaves = 4) {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let maxVal = 0;
    for (let i = 0; i < octaves; i++) {
      value += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxVal += amplitude;
      amplitude *= 0.5;
      frequency *= 2.02;
    }
    return value / maxVal;
  }
}
