const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function formatTime(t: number) {
  if (!isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t * 1000) % 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** Drift combo milestones (seconds) and their call-outs: each one makes the counter glow harder. */
/** The counter catches fire (orange) at FIRE seconds and burns blue from BLUE_FIRE on. */
export const DRIFT_FIRE = 5;
export const DRIFT_BLUE_FIRE = 10;

export const DRIFT_TIERS: [number, string][] = [
  [2, 'ХОРОШО'],
  [4, 'КРУТО!'],
  [7, 'ОГОНЬ!'],
  [11, 'БЕЗУМИЕ!'],
  [16, 'ЛЕГЕНДА!'],
];

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
  private drift = $('drift');
  private driftTime = $('drift-time');
  private driftTier = $('drift-tier');
  private driftBank = $('drift-bank');
  private shownTier = 0;
  private nitro = $('nitro');
  private nitroFill = $('nitro-fill');
  private nitroPct = $('nitro-pct');

  constructor() {
    // flame tongues behind the drift counter (CSS animates them)
    const fire = $('drift-fire');
    for (let i = 0; i < 9; i++) {
      const f = document.createElement('i');
      f.style.setProperty('--x', `${4 + i * 10.5}%`);
      f.style.setProperty('--d', `${0.55 + ((i * 37) % 7) * 0.06}s`);
      f.style.setProperty('--delay', `${-((i * 53) % 9) * 0.07}s`);
      f.style.setProperty('--h', `${60 + ((i * 29) % 5) * 9}%`);
      fire.appendChild(f);
    }
  }
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

  /**
   * Drift combo counter. `active` = sliding right now (otherwise it waits out the cooldown).
   * Returns the tier index when a new milestone was just reached (for a sound), else 0.
   */
  setDrift(seconds: number, active: boolean): number {
    const on = seconds > 0;
    this.drift.classList.toggle('on', on);
    this.drift.classList.toggle('cool', on && !active);
    if (!on) {
      this.drift.classList.remove('fire', 'fire-blue');
      this.shownTier = 0;
      this.drift.dataset.tier = '0';
      return 0;
    }
    this.driftTime.textContent = seconds.toFixed(1);
    this.drift.classList.toggle('fire', seconds >= DRIFT_FIRE && seconds < DRIFT_BLUE_FIRE);
    this.drift.classList.toggle('fire-blue', seconds >= DRIFT_BLUE_FIRE);
    let tier = 0;
    while (tier < DRIFT_TIERS.length && seconds >= DRIFT_TIERS[tier][0]) tier++;
    if (tier === this.shownTier) return 0;
    this.shownTier = tier;
    this.drift.dataset.tier = String(tier);
    this.driftTier.textContent = tier ? DRIFT_TIERS[tier - 1][1] : '';
    this.drift.classList.remove('burst');
    void this.drift.offsetWidth; // restart the animation
    this.drift.classList.add('burst');
    return tier;
  }

  /** The combo is cashed in: "−3.2 с" floats up to the timer. */
  bankDrift(seconds: number) {
    const el = this.driftBank;
    el.textContent = `−${seconds.toFixed(1)} с`;
    el.classList.remove('go');
    this.timer.classList.remove('bonus');
    void el.offsetWidth;
    el.classList.add('go');
    this.timer.classList.add('bonus');
  }

  setNitro(level: number, boosting: boolean, refilling: boolean) {
    this.nitroFill.style.width = `${(level * 100).toFixed(1)}%`;
    this.nitroPct.textContent = `${Math.round(level * 100)}%`;
    this.nitro.classList.toggle('boost', boosting);
    this.nitro.classList.toggle('refill', refilling && level < 1);
    this.nitro.classList.toggle('empty', level <= 0.001);
  }

  setFade(on: boolean) {
    this.fade.classList.toggle('on', on);
  }
}
