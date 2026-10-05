/**
 * First-person Input Manager (WASD + Arrow Keys, Shift sprint, F flashlight,
 * E interact, Escape/P pause, PointerLock mouse look).
 */
const KEY_CHAR_TO_CODE = {
  f: 'KeyF',
  F: 'KeyF',
  'ب': 'KeyF',
  l: 'KeyL',
  L: 'KeyL',
  'م': 'KeyL',
  e: 'KeyE',
  E: 'KeyE',
  'ث': 'KeyE',
  w: 'KeyW',
  W: 'KeyW',
  'ص': 'KeyW',
  a: 'KeyA',
  A: 'KeyA',
  'ش': 'KeyA',
  s: 'KeyS',
  S: 'KeyS',
  'س': 'KeyS',
  d: 'KeyD',
  D: 'KeyD',
  'ي': 'KeyD',
  q: 'KeyQ',
  Q: 'KeyQ',
  'ض': 'KeyQ',
  p: 'KeyP',
  P: 'KeyP',
  'ح': 'KeyP'
};

export class InputManager {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.state = state;

    this.keys = new Set();
    this.justPressed = new Set();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.isPointerLocked = false;

    this._resolveCodes = (e) => {
      const codes = [];
      if (e.code) codes.push(e.code);
      if (e.key && KEY_CHAR_TO_CODE[e.key]) {
        const mapped = KEY_CHAR_TO_CODE[e.key];
        if (!codes.includes(mapped)) codes.push(mapped);
      }
      return codes;
    };

    this._onKeyDown = (e) => {
      const codes = this._resolveCodes(e);
      for (const code of codes) {
        if (!this.keys.has(code)) {
          this.justPressed.add(code);
        }
        this.keys.add(code);
      }
    };

    this._onKeyUp = (e) => {
      const codes = this._resolveCodes(e);
      for (const code of codes) {
        this.keys.delete(code);
      }
    };

    this._onMouseDown = (e) => {
      if (this.state.mode !== 'PLAYING') return;
      if (e.button === 2) {
        this.justPressed.add('MouseRight');
      }
    };

    this._onMouseMove = (e) => {
      if (!this.isPointerLocked && this.state.mode !== 'PLAYING') return;
      if (this.isPointerLocked) {
        this.mouseDeltaX += e.movementX || 0;
        this.mouseDeltaY += e.movementY || 0;
      }
    };

    this._onPointerLockChange = () => {
      this.isPointerLocked = document.pointerLockElement === this.canvas;
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    this.canvas.addEventListener('click', () => {
      if (this.state.mode === 'PLAYING' && !this.isPointerLocked) {
        this.requestPointerLock();
      }
    });
  }

  requestPointerLock() {
    try {
      if (this.canvas.requestPointerLock) {
        const p = this.canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      }
    } catch {
      // Headless browsers or sandboxed iframes may reject pointer lock
    }
  }

  exitPointerLock() {
    try {
      if (document.pointerLockElement && document.exitPointerLock) {
        document.exitPointerLock();
      }
    } catch {
      // Ignore
    }
  }

  isDown(code) {
    return this.keys.has(code);
  }

  consumeJustPressed(code) {
    if (this.justPressed.has(code)) {
      this.justPressed.delete(code);
      return true;
    }
    return false;
  }

  consumeMouseDelta() {
    const dx = this.mouseDeltaX;
    const dy = this.mouseDeltaY;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return { dx, dy };
  }

  getMovementAxes() {
    let forward = 0;
    let strafe = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) forward += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) forward -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) strafe += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) strafe -= 1;

    const len = Math.hypot(forward, strafe);
    if (len > 1) {
      forward /= len;
      strafe /= len;
    }
    return { forward, strafe };
  }

  endFrame() {
    this.justPressed.clear();
  }
}
