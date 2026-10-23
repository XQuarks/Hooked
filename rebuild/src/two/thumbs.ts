/**
 * 图鉴缩略图：直接把 2D 鱼画到离屏 canvas 转 dataURL。
 * 比 3D 版省掉一整套 WebGL 上下文（原来图鉴最多会开 26 个渲染器）。
 */
import { speciesById } from '../game/data';
import { FishSprite } from './fish2d';
import { Cam, makeCanvas, ctx2d } from './core';

const cache = new Map<string, string>();

function stubCam(W: number, H: number, scale: number): Cam {
  return {
    W,
    H,
    scale,
    cy: 0,
    cx: 0,
    shakeX: 0,
    shakeY: 0,
    toScreenX: (x) => W / 2 + x * scale,
    toScreenY: (y) => H / 2 - y * scale,
    toWorld: (sx, sy) => ({ x: (sx - W / 2) / scale, y: -(sy - H / 2) / scale }),
  };
}

export function fishThumb(id: string): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const sp = speciesById[id];
  if (!sp) return '';

  const W = 220;
  const H = 140;
  const c = makeCanvas(W, H);
  const g = ctx2d(c);

  const sprite = new FishSprite(sp);
  // draw() 内部还会乘一个「视觉放大」系数，这里先除掉，否则小鱼会被裁掉
  const grow = Math.max(1.3, 2.0 - sp.len * 0.14);
  const hRatio = sprite.form.h;
  const scale = Math.min((W * 0.6) / sp.len, (H * 0.5) / (sp.len * hRatio)) / grow;
  sprite.draw(g, stubCam(W, H, scale));

  const url = c.toDataURL('image/png');
  cache.set(id, url);
  return url;
}

export function warmThumbs() {
  for (const sp of Object.values(speciesById)) fishThumb(sp.id);
}

export function disposeThumbs() {
  cache.clear();
}
