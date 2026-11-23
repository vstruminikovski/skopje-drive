// Driving input from the keyboard and on-screen buttons (mouse, touch or pen).
// Keys: W/↑ gas, S/↓ brake (hold at standstill → reverse), A/D or ←/→ steer,
// Space handbrake, R reset to start, C camera.
// On-screen: ◀ ▶ steer (bottom left), ▲ gas, ■ brake, P handbrake (bottom right).

import type { DriveInput } from '../physics/vehicle';

type Act = 'left' | 'right' | 'gas' | 'brake' | 'hand' | 'reset' | 'cam';

const STEER_RATE = 2.5; // steer travel per second while held (1 = full lock)
const RETURN_RATE = 4; // steer returns to centre per second when released

export class Controls {
  private keys = new Set<string>();
  private held = new Set<Act>();
  private steer = 0;
  reverse = false;
  onReset?: () => void;
  onCamera?: () => void;

  constructor(root: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyR') this.onReset?.();
      if (e.code === 'KeyC') this.onCamera?.();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.buildButtons(root);
  }

  private buildButtons(root: HTMLElement) {
    const pad = document.createElement('div');
    pad.className = 'mg-touch';
    pad.innerHTML = `
      <div class="mg-col mg-tl"><button data-act="reset" aria-label="Од почеток">↺</button><button data-act="cam" aria-label="Камера">◎</button></div>
      <div class="mg-bar">
        <div class="mg-col"><button data-act="left" aria-label="Лево">‹</button><button data-act="right" aria-label="Десно">›</button></div>
        <div class="mg-col"><button data-act="hand" aria-label="Рачна кочница">P</button><button data-act="brake" aria-label="Кочница или назад">■</button><button data-act="gas" aria-label="Гас">▲</button></div>
      </div>`;
    root.appendChild(pad);
    for (const b of pad.querySelectorAll<HTMLButtonElement>('button')) {
      const act = b.dataset.act as Act;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        try {
          b.setPointerCapture(e.pointerId); // keep the press even if the pointer leaves the button
        } catch {
          /* no active pointer to capture: the press still counts */
        }
        if (act === 'reset') this.onReset?.();
        else if (act === 'cam') this.onCamera?.();
        else this.held.add(act);
      };
      const up = () => this.held.delete(act);
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  read(dt: number, speed: number): DriveInput {
    const k = (...c: string[]) => c.some((x) => this.keys.has(x));
    const h = (a: Act) => this.held.has(a);
    const thr = k('KeyW', 'ArrowUp') || h('gas') ? 1 : 0;
    const brk = k('KeyS', 'ArrowDown') || h('brake') ? 1 : 0;
    const dir = (k('KeyD', 'ArrowRight') || h('right') ? 1 : 0) - (k('KeyA', 'ArrowLeft') || h('left') ? 1 : 0);
    // steering ramps so taps give small corrections; holding turns fully and returns to centre
    if (dir !== 0) this.steer += Math.max(-STEER_RATE * dt, Math.min(STEER_RATE * dt, dir - this.steer));
    else this.steer += Math.max(-RETURN_RATE * dt, Math.min(RETURN_RATE * dt, -this.steer));

    // S at standstill selects reverse; W at standstill selects drive
    if (Math.abs(speed) < 0.4) {
      if (brk && !thr) this.reverse = true;
      if (thr && !brk) this.reverse = false;
    }
    const throttle = this.reverse ? brk : thr;
    const brake = this.reverse ? thr : brk;
    return { throttle, brake, steer: this.steer, handbrake: k('Space') || h('hand'), reverse: this.reverse };
  }
}
