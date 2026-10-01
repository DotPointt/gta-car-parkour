const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function formatTime(t: number) {
  if (!isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t * 1000) % 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** Thin wrapper around the DOM overlay. */
export class Hud {
  private hud = $('hud');
  private timer = $('hud-timer');
  private falls = $('hud-falls');
  private level = $('hud-level');
  private best = $('hud-best');
  private section = $('hud-section');
  private speed = $('hud-speed');
  private gear = $('hud-gear');
  private rpm = $('hud-rpm-fill');
  private banner = $('banner');
  private big = $('bigmsg');
  private fade = $('fade');
  private bannerTimer = 0;
  private bigTimer: number | undefined;

  show(v: boolean) {
    this.hud.classList.toggle('hidden', !v);
  }

  setTime(t: number) {
    this.timer.textContent = formatTime(t);
  }
  setLevel(n: number) {
    this.level.textContent = String(n);
  }
  setFalls(n: number) {
    this.falls.textContent = String(n);
  }
  setBest(t: number) {
    this.best.textContent = formatTime(t);
  }
  setSection(name: string) {
    this.section.textContent = name;
  }

  setCar(speedKmh: number, gear: number, rpm: number, redline: number) {
    this.speed.textContent = String(Math.round(speedKmh));
    this.gear.textContent = gear === -1 ? 'R' : String(gear);
    this.rpm.style.width = `${Math.min(100, (rpm / redline) * 100).toFixed(1)}%`;
  }

  showBanner(title: string, sub: string) {
    this.banner.innerHTML = `${title}<span class="sub">${sub}</span>`;
    this.banner.classList.add('show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), 2600);
  }

  hideBanner() {
    this.banner.classList.remove('show');
  }

  /** Big centre message. mode: pop animation, or stay until cleared. */
  bigMessage(text: string, cls: '' | 'red' | 'gold' = '', stay = false) {
    const el = this.big;
    el.className = '';
    void el.offsetWidth; // restart animation
    el.textContent = text;
    if (cls) el.classList.add(cls);
    el.classList.add(stay ? 'stay' : 'pop');
    window.clearTimeout(this.bigTimer);
  }

  clearBig() {
    this.big.className = '';
    this.big.textContent = '';
  }

  setFade(on: boolean) {
    this.fade.classList.toggle('on', on);
  }
}
