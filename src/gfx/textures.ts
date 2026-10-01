import * as THREE from 'three';

let maxAniso = 8;
export function setMaxAnisotropy(a: number) {
  maxAniso = a;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  return { c, g };
}

function tex(c: HTMLCanvasElement, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number, light = true) {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
    const s = Math.random() * 2 + 0.5;
    g.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

/** Asphalt with red/white kerbs along both edges. u = across (0..1), v = along. */
export function roadTexture() {
  const W = 512, H = 512;
  const { c, g } = canvas(W, H);
  g.fillStyle = '#3b3e44';
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 9000, 0.12);
  speckle(g, W, H, 9000, 0.25, false);
  // kerbs
  const kw = 26;
  for (let y = 0; y < H; y += 64) {
    const red = (y / 64) % 2 === 0;
    g.fillStyle = red ? '#d8272b' : '#f2f2f2';
    g.fillRect(0, y, kw, 64);
    g.fillRect(W - kw, y, kw, 64);
  }
  // white edge line
  g.fillStyle = '#e8e8e8';
  g.fillRect(kw + 8, 0, 6, H);
  g.fillRect(W - kw - 14, 0, 6, H);
  // center dashes
  g.fillStyle = 'rgba(245,190,20,0.85)';
  g.fillRect(W / 2 - 4, 40, 8, 170);
  g.fillRect(W / 2 - 4, 296, 8, 170);
  return tex(c);
}

/** Narrow beam top: grey panel with yellow edge stripes. */
export function beamTexture() {
  const W = 256, H = 256;
  const { c, g } = canvas(W, H);
  g.fillStyle = '#4a4e55';
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 3000, 0.15);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, W, H);
  g.fillStyle = '#f5b50a';
  g.fillRect(0, 0, 18, H);
  g.fillRect(W - 18, 0, 18, H);
  return tex(c);
}

/** Yellow / black hazard stripes. */
export function hazardTexture() {
  const S = 256;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#f2b705';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#16171a';
  for (let i = -S; i < S * 2; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 32, 0);
    g.lineTo(i + 32 + S, S);
    g.lineTo(i + S, S);
    g.closePath();
    g.fill();
  }
  return tex(c);
}

/** Orange stunt-prop walls with white chevrons. */
export function chevronTexture() {
  const W = 256, H = 128;
  const { c, g } = canvas(W, H);
  g.fillStyle = '#ff6a00';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffffff';
  for (let x = 0; x < W; x += 128) {
    g.beginPath();
    g.moveTo(x + 20, 10);
    g.lineTo(x + 60, 10);
    g.lineTo(x + 108, 64);
    g.lineTo(x + 60, 118);
    g.lineTo(x + 20, 118);
    g.lineTo(x + 68, 64);
    g.closePath();
    g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 0, W, 6);
  g.fillRect(0, H - 6, W, 6);
  return tex(c);
}

export function checkerTexture(n = 8) {
  const S = 256;
  const { c, g } = canvas(S, S);
  const s = S / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(x * s, y * s, s, s);
    }
  return tex(c);
}

/** Glowing green boost pad with arrows (points to +v). */
export function boostTexture() {
  const W = 256, H = 256;
  const { c, g } = canvas(W, H);
  g.fillStyle = '#0b3d1a';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#39ff6a';
  for (let y = 0; y < H; y += 128) {
    g.beginPath();
    g.moveTo(W / 2, y + 12);
    g.lineTo(W - 30, y + 80);
    g.lineTo(W - 30, y + 116);
    g.lineTo(W / 2, y + 48);
    g.lineTo(30, y + 116);
    g.lineTo(30, y + 80);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = '#39ff6a';
  g.lineWidth = 8;
  g.strokeRect(4, -10, W - 8, H + 20);
  return tex(c);
}

/** Red speed-limiter pad (arrows point backwards). */
export function slowTexture() {
  const W = 256, H = 256;
  const { c, g } = canvas(W, H);
  g.fillStyle = '#3d0b0b';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ff3b30';
  for (let y = 0; y < H; y += 128) {
    g.beginPath();
    g.moveTo(W / 2, y + 116);
    g.lineTo(W - 30, y + 48);
    g.lineTo(W - 30, y + 12);
    g.lineTo(W / 2, y + 80);
    g.lineTo(30, y + 12);
    g.lineTo(30, y + 48);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = '#ff3b30';
  g.lineWidth = 8;
  g.strokeRect(4, -10, W - 8, H + 20);
  return tex(c);
}

/** Metal deck plate for platforms. */
export function plateTexture() {
  const S = 256;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#5a5f67';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 3000, 0.12);
  g.strokeStyle = 'rgba(20,20,20,0.6)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, S - 3, S - 3);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  for (let y = 16; y < S; y += 32)
    for (let x = 16 + ((y / 32) % 2) * 16; x < S; x += 32) {
      g.save();
      g.translate(x, y);
      g.rotate(((x + y) / 32) % 2 ? 0.7 : -0.7);
      g.fillRect(-8, -2, 16, 4);
      g.restore();
    }
  g.fillStyle = 'rgba(0,0,0,0.5)';
  for (const [x, y] of [[10, 10], [S - 10, 10], [10, S - 10], [S - 10, S - 10]]) {
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}

/** Red/white stripes for dangerous moving props. */
export function dangerTexture() {
  const S = 128;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#d6202a';
  g.fillRect(0, 0, S / 2, S);
  return tex(c);
}

export function cloudTexture() {
  const S = 256;
  const { c, g } = canvas(S, S);
  for (let i = 0; i < 22; i++) {
    const x = S * (0.25 + Math.random() * 0.5);
    const y = S * (0.35 + Math.random() * 0.3);
    const r = S * (0.12 + Math.random() * 0.16);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  }
  return tex(c, false);
}

export function softDotTexture() {
  const S = 64;
  const { c, g } = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return tex(c, false);
}

/** Cracked glass: dark tint with light crack lines. */
export function crackTexture() {
  const S = 512;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#12161b';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(220,230,240,0.85)';
  g.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const cx = S * (0.2 + Math.random() * 0.6);
    const cy = S * (0.2 + Math.random() * 0.6);
    const rays = 10 + Math.floor(Math.random() * 6);
    for (let i = 0; i < rays; i++) {
      let a = (i / rays) * Math.PI * 2 + Math.random() * 0.3;
      let x = cx, y = cy;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x, y);
      const steps = 6 + Math.random() * 6;
      for (let s = 0; s < steps; s++) {
        a += (Math.random() - 0.5) * 0.5;
        x += Math.cos(a) * (18 + Math.random() * 20);
        y += Math.sin(a) * (18 + Math.random() * 20);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // concentric rings
    g.lineWidth = 1;
    for (let r = 14; r < 140; r += 22 + Math.random() * 20) {
      g.beginPath();
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const rr = r * (0.8 + Math.random() * 0.4);
        const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }
  }
  return tex(c, false);
}

/** Banner with text (for START / FINISH arches). */
export function bannerTexture(text: string, bg = '#111', fg = '#f5b50a', checker = true) {
  const W = 1024, H = 192;
  const { c, g } = canvas(W, H);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  if (checker) {
    const s = 24;
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < W / s; x++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        g.fillRect(x * s, y * s, s, s);
        g.fillRect(x * s, H - (y + 1) * s, s, s);
      }
  }
  g.fillStyle = fg;
  g.font = 'bold 104px "Russo One", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, W / 2, H / 2 + 4);
  return tex(c, false);
}

/** Sign board with text lines. */
export function signTexture(lines: string[], bg = '#f5b50a', fg = '#111') {
  const W = 512, H = 256;
  const { c, g } = canvas(W, H);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = fg;
  g.lineWidth = 14;
  g.strokeRect(10, 10, W - 20, H - 20);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lh = H / (lines.length + 1);
  lines.forEach((l, i) => {
    let size = i === 0 ? 76 : 48;
    g.font = `bold ${size}px "Russo One", Impact, sans-serif`;
    const wText = g.measureText(l).width;
    if (wText > W - 48) {
      size = Math.floor((size * (W - 48)) / wText);
      g.font = `bold ${size}px "Russo One", Impact, sans-serif`;
    }
    g.fillText(l, W / 2, lh * (i + 1) + 4);
  });
  return tex(c, false);
}

/** Tileable procedural water normal map. */
export function waterNormalTexture() {
  const S = 256;
  const { c, g } = canvas(S, S);
  const img = g.createImageData(S, S);
  const h = new Float32Array(S * S);
  const waves: [number, number, number, number][] = [];
  for (let i = 0; i < 48; i++) {
    const kx = Math.round((Math.random() - 0.5) * 48);
    const ky = Math.round((Math.random() - 0.5) * 48);
    if (kx === 0 && ky === 0) continue;
    waves.push([kx, ky, Math.random() * Math.PI * 2, 1 / (2 + Math.hypot(kx, ky))]);
  }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (const [kx, ky, p, a] of waves) v += Math.sin(((kx * x + ky * y) / S) * Math.PI * 2 + p) * a;
      h[y * S + x] = v;
    }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = h[y * S + ((x + 1) % S)] - h[y * S + ((x - 1 + S) % S)];
      const dy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
      const n = new THREE.Vector3(-dx * 1.2, -dy * 1.2, 1).normalize();
      const i = (y * S + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return tex(c, true, false);
}

export function groundTexture() {
  const S = 512;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#6f7266';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 12000, 0.15);
  speckle(g, S, S, 12000, 0.2, false);
  return tex(c);
}
