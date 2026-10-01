export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
  /** Air control pitch: +1 nose down, -1 nose up (W/S, left stick Y). Very weak by design. */
  pitch: number;
}

const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

/** Keyboard + gamepad input with edge-triggered "pressed" actions. */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private padPrev: boolean[] = [];
  readonly drive: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, pitch: 0 };

  // mouse orbit
  mouseDown = false;
  mouseDX = 0;
  mouseDY = 0;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (PREVENT.has(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('pointerdown', (e) => {
      this.mouseDown = true;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', (e) => {
      this.mouseDown = false;
      canvas.releasePointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.mouseDown) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
  }

  private key(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  /** Actions: 'respawn' | 'camera' | 'pause' | 'mute' | 'horn' */
  wasPressed(action: string): boolean {
    switch (action) {
      case 'respawn':
        return this.pressed.has('KeyR') || this.pressed.has('pad3');
      case 'camera':
        return this.pressed.has('KeyC') || this.pressed.has('pad8');
      case 'pause':
        return this.pressed.has('Escape') || this.pressed.has('KeyP') || this.pressed.has('pad9');
      case 'mute':
        return this.pressed.has('KeyM');
      case 'confirm':
        return this.pressed.has('Enter') || this.pressed.has('pad0');
    }
    return false;
  }

  horn(): boolean {
    return this.key('KeyH') || this.padHorn;
  }
  private padHorn = false;

  /** Call once per rendered frame before reading `drive`. */
  poll() {
    let throttle = this.key('KeyW', 'ArrowUp') ? 1 : 0;
    let brake = this.key('KeyS', 'ArrowDown') ? 1 : 0;
    let steer = (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0);
    let handbrake = this.key('Space');
    let stickPitch: number | null = null;
    this.padHorn = false;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const ax = gp.axes[0] ?? 0;
      if (Math.abs(ax) > 0.12) steer = Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88);
      const rt = gp.buttons[7]?.value ?? 0;
      const lt = gp.buttons[6]?.value ?? 0;
      throttle = Math.max(throttle, rt);
      brake = Math.max(brake, lt);
      // left stick up/down = air pitch (stick forward = nose down)
      const ay = gp.axes[1] ?? 0;
      if (Math.abs(ay) > 0.2) stickPitch = -ay;
      if (gp.buttons[5]?.pressed || gp.buttons[1]?.pressed) handbrake = true;
      if (gp.buttons[10]?.pressed) this.padHorn = true;
      gp.buttons.forEach((b, i) => {
        if (b.pressed && !this.padPrev[i]) this.pressed.add('pad' + i);
        this.padPrev[i] = b.pressed;
      });
      break;
    }

    this.drive.throttle = throttle;
    this.drive.brake = brake;
    this.drive.steer = Math.max(-1, Math.min(1, steer));
    this.drive.handbrake = handbrake;
    // in the air, gas/brake (W/S, triggers) gently tilt the nose, unless the stick is used
    this.drive.pitch = Math.max(-1, Math.min(1, stickPitch ?? throttle - brake));
  }

  consumeMouse() {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
  }
}
