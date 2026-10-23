/**
 * 天气 → 画面参数。
 *
 * 天气不该只是 HUD 上的一行字：它要真的改变「看起来」和「钓到什么」。
 * 画面这边做三件事：
 *   1. 把深度带的雾/光/色调按天气混合（weatherize）；
 *   2. 在背景上加一层天气色调（weatherVeil）；
 *   3. 在前景加雨/雪/极光粒子（weatherParticles）。
 * 鱼的刷新权重在 data.ts 的 weatherWeight 里。
 */
import { Band, Weather } from '../game/data';
import { Cam, hash1, rgba, tint } from './core';

/** 把深度带按天气调色：雾更浓/更淡、光更亮/更暗、整体偏冷或偏暖 */
export function weatherize(band: Band, w: Weather): Band {
  if (w.id === 'clear' || w.id === 'aurora') {
    return {
      ...band,
      density: band.density * w.fog,
      power: band.power * w.light,
      fog: tint(band.fog, w.tint, 0.06),
      ray: tint(band.ray, w.tint, 0.12),
    };
  }
  return {
    ...band,
    density: band.density * w.fog,
    power: band.power * w.light,
    fog: tint(band.fog, w.tint, 0.2),
    light: tint(band.light, w.tint, 0.25),
    ambient: tint(band.ambient, w.tint, 0.24),
    ray: tint(band.ray, w.tint, 0.18),
  };
}

/** 背景画完后的天气色调（压在所有场景元素之下、鱼之上？不，画在 paintBack 末尾，鱼还在后面） */
export function weatherVeil(g: CanvasRenderingContext2D, cam: Cam, w: Weather, above: number) {
  if (w.id === 'clear' || w.id === 'iceclear') return;
  // 高空变透明：太空里不该有一层天气色罩
  const alt = Math.max(0, (cam.toScreenY(0) - cam.H / 2) / cam.scale);
  const altFade = 1 - Math.min(1, Math.max(0, (alt - 90) / 60));
  if (altFade <= 0.01) return;
  const base =
    w.id === 'rain'
      ? 0.24
      : w.id === 'fog'
        ? 0.3
        : w.id === 'storm'
          ? 0.38
          : w.id === 'blizzard'
            ? 0.26
            : w.id === 'aurora'
              ? 0.12
              : 0.14;
  // 水下雾感更重，水上只是天色变化
  const a = base * (above > 0.5 ? 0.75 : 1) * altFade;
  g.save();
  g.fillStyle = rgba(w.tint, a);
  g.fillRect(0, 0, cam.W, cam.H);
  g.restore();
}

/**
 * 天气的天空层：低云 / 海雾带 / 雷雨闪电。
 * 画在 paintBack 之后、船和鱼之前——所以云在船后面，不会盖住玩法。
 */
export function weatherSky(
  g: CanvasRenderingContext2D,
  cam: Cam,
  w: Weather,
  t: number,
  above: number,
) {
  if (above < 0.25) return;
  // 高空没有低云 / 雾带，直接不画（云本身是世界坐标，不画也省得算）
  const skyAlt = Math.max(0, (cam.toScreenY(0) - cam.H / 2) / cam.scale);
  if (skyAlt > 110) return;
  const { W, H } = cam;
  const horizon = Math.min(H * 0.72, cam.toScreenY(0));
  const a = Math.min(1, above);

  g.save();

  // --- 阴天/雨天/雷雨：先压一层从天空顶部往下渐隐的暗色，把太阳和蓝天压下去
  if (w.id === 'cloudy' || w.id === 'rain' || w.id === 'storm') {
    const top = w.id === 'storm' ? 0.66 : w.id === 'rain' ? 0.46 : 0.28;
    const col = w.id === 'storm' ? '#141d28' : '#24303c';
    const gr = g.createLinearGradient(0, 0, 0, Math.max(1, horizon));
    gr.addColorStop(0, rgba(col, top * a));
    gr.addColorStop(0.55, rgba(col, top * 0.42 * a));
    gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, W, Math.max(1, horizon));
  }

  // --- 低云：多云/小雨/雷雨各有一套厚度。
  // 必须用**世界坐标**：挂在屏幕高度上时，相机一抬（鱼飞到天上）云会跟着屏幕走，
  // 看起来像贴在镜头上的贴纸。现在云在海面上方 3~12m，镜头升高它们自然沉出画面。
  if (w.id === 'cloudy' || w.id === 'rain' || w.id === 'storm') {
    const heavy = w.id === 'storm' ? 1 : w.id === 'rain' ? 0.82 : 0.5;
    const n = w.id === 'storm' ? 8 : w.id === 'rain' ? 6 : 5;
    const body = w.id === 'storm' ? '#1d2733' : w.id === 'rain' ? '#2f3b46' : '#4a545e';
    const scale = cam.scale;
    const band = 26; // 云带宽度（米），循环平铺
    for (let i = 0; i < n; i++) {
      const seed = i * 7.73;
      const rWorld = 3.6 + hash1(seed) * 6.4;
      const rx = rWorld * scale;
      const ry = rx * (0.3 + hash1(seed + 1.1) * 0.14);
      const drift = t * (0.35 + hash1(seed + 2.3) * 0.6);
      const raw = (hash1(seed + 3.7) * band + drift) % band;
      const wx = raw - band / 2;
      const wy = 3 + hash1(seed + 4.9) * 9;
      const x = cam.toScreenX(wx);
      const y = cam.toScreenY(wy);
      if (x < -rx || x > W + rx || y < -ry || y > H + ry) continue;
      const gr = g.createRadialGradient(x, y, 0, x, y, rx);
      gr.addColorStop(0, rgba(body, 0.52 * heavy * a));
      gr.addColorStop(0.5, rgba(body, 0.26 * heavy * a));
      gr.addColorStop(1, rgba(body, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // --- 海雾：贴着水面（世界 y=0 平面）的几条雾带
  if (w.id === 'fog') {
    const sy = cam.toScreenY(0);
    if (sy > -H * 0.2 && sy < H * 1.1) {
      for (let i = 0; i < 5; i++) {
        const y = sy - i * (0.55 * cam.scale);
        const th = 1.5 * cam.scale;
        const drift = Math.sin(t * 0.25 + i * 1.3) * W * 0.02;
        const gr = g.createLinearGradient(0, y - th * 0.55, 0, y + th * 0.55);
        gr.addColorStop(0, rgba('#eaf6fb', 0));
        gr.addColorStop(0.45, rgba('#eaf6fb', (0.2 - i * 0.025) * a));
        gr.addColorStop(1, rgba('#eaf6fb', 0));
        g.fillStyle = gr;
        g.fillRect(drift - W * 0.04, y - th * 0.55, W * 1.08, th * 1.1);
      }
    }
  }

  // --- 雷雨：整屏爆闪 + 一道锯齿闪电
  if (w.id === 'storm') {
    const cycle = 5.2;
    const k = Math.floor(t / cycle);
    const ph = t - k * cycle;
    if (ph < 0.46) {
      const strobe = ph < 0.1 ? 1 : ph < 0.18 ? 0.22 : ph < 0.27 ? 0.8 : Math.max(0, 1 - (ph - 0.27) * 3.4);
      g.fillStyle = rgba('#d6e9ff', 0.34 * strobe * a);
      g.fillRect(0, 0, W, H);

      const bx = W * (0.14 + hash1(k * 2.31) * 0.72);
      let x = bx;
      let y = -8;
      const endY = Math.min(horizon * 0.86, H * 0.5);
      g.strokeStyle = rgba('#f2fbff', 0.92 * strobe);
      g.lineWidth = 2.1;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(x, y);
      let guard = 0;
      while (y < endY && guard++ < 18) {
        y += 16 + hash1(x * 0.7 + y * 1.3) * 26;
        x += (hash1(x * 1.9 + y * 0.4) - 0.5) * 44;
        g.lineTo(x, y);
      }
      g.stroke();
      g.strokeStyle = rgba('#9fd4ff', 0.34 * strobe);
      g.lineWidth = 7;
      g.stroke();
    }
  }

  g.restore();
}

/** 前景天气粒子：雨 / 雪 / 极光尘。水下不画雨雪（只留一点光点） */
export function weatherParticles(
  g: CanvasRenderingContext2D,
  cam: Cam,
  t: number,
  w: Weather,
  above: number,
) {
  if (w.particle === 'none') return;
  // 雨雪只存在大气层里；被顶到高空后不要再下
  const pAlt = Math.max(0, (cam.toScreenY(0) - cam.H / 2) / cam.scale);
  if ((w.particle === 'rain' || w.particle === 'snow') && pAlt > 60) return;
  const { W, H } = cam;
  const surface = above > 0.5;

  g.save();
  if (w.particle === 'rain') {
    if (!surface) {
      g.restore();
      return;
    }
    const heavy = !!w.bolt;
    g.strokeStyle = heavy ? 'rgba(202, 232, 255, 0.6)' : 'rgba(196, 228, 255, 0.46)';
    g.lineWidth = heavy ? 1.4 : 1.15;
    g.lineCap = 'round';
    const n = heavy ? 96 : 54;
    for (let i = 0; i < n; i++) {
      const seed = i * 7.13;
      const speed = (heavy ? 1150 : 900) + hash1(seed) * 520;
      const x = (hash1(seed + 1.3) * W + t * (heavy ? 160 : 110)) % (W + 80) - 40;
      const y = (hash1(seed + 2.7) * H + t * speed) % (H + 90) - 45;
      const len = (heavy ? 18 : 14) + hash1(seed + 3.1) * 10;
      const slant = heavy ? 0.42 : 0.28;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - len * slant, y + len);
      g.stroke();
    }
    // 水面上的雨点涟漪：让「在下雨」这件事落到水线上
    const sy = cam.toScreenY(0);
    if (sy > 0 && sy < H) {
      for (let i = 0; i < (heavy ? 14 : 8); i++) {
        const seed = i * 3.17;
        const ph = (t * (heavy ? 1.9 : 1.4) + seed) % 1;
        const x = (hash1(seed + 0.7) * W + t * 24) % W;
        const r = 2 + ph * (heavy ? 12 : 8);
        g.strokeStyle = rgba('#dff3ff', 0.34 * (1 - ph));
        g.lineWidth = 1;
        g.beginPath();
        g.ellipse(x, sy + 2, r, r * 0.3, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
  } else if (w.particle === 'snow') {
    if (!surface) {
      g.restore();
      return;
    }
    const n = 46;
    const gust = w.wave ?? 1;
    for (let i = 0; i < n; i++) {
      const seed = i * 5.77;
      const speed = 40 + hash1(seed) * 60;
      const x =
        (hash1(seed + 1.1) * W + Math.sin(t * 0.6 + seed) * 18 + t * (14 + gust * 10)) % (W + 40) - 20;
      const y = (hash1(seed + 2.3) * H + t * speed) % (H + 40) - 20;
      const r = 1 + hash1(seed + 3.9) * 1.9;
      g.fillStyle = rgba('#eaf7ff', 0.34 + hash1(seed + 4.4) * 0.4);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // 极光尘：慢慢上浮的小光点，水下也可见
    g.globalCompositeOperation = 'lighter';
    const n = 34;
    for (let i = 0; i < n; i++) {
      const seed = i * 9.31;
      const speed = 8 + hash1(seed) * 22;
      const x = (hash1(seed + 1.7) * W + Math.sin(t * 0.3 + seed) * 20) % W;
      const y = (H - ((hash1(seed + 2.9) * H + t * speed) % (H + 30))) + 10;
      const r = 0.8 + hash1(seed + 4.1) * 1.7;
      const a = (0.2 + hash1(seed + 5.5) * 0.45) * (0.5 + 0.5 * Math.sin(t * 1.6 + seed));
      const col = i % 3 === 0 ? '#8affd8' : i % 3 === 1 ? '#8fd8ff' : '#d8b4ff';
      g.fillStyle = rgba(col, a);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}
