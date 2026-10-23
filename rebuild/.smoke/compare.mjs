/**
 * 画质回归验证：把新旧两版锁定到同一个固定场景（200m 水下、清空鱼、同一时刻），
 * 隐藏所有 DOM 层，只截 .viewport（也就是纯 canvas 合成结果），再做逐像素比对。
 *
 * 用法：node .smoke/compare.mjs <旧 html> <新 html>
 */
import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { skipStory, castOff, sleep } from './lib.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [oldHtml, newHtml, opt] = process.argv.slice(2);
if (!oldHtml || !newHtml) {
  console.error('usage: node .smoke/compare.mjs <old.html> <new.html>');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});

async function shot(html, out) {
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('file:///' + path.resolve(html).replace(/\\/g, '/') + '#debug', { waitUntil: 'load' });
  await sleep(700);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await sleep(900);
  await page.click('.btn.start');
  await sleep(500);
  await skipStory(page);
  await castOff(page);
  await sleep(1500);

  // 锁定场景：停 update、固定深度/水线/时钟、清空鱼、隐藏所有 DOM 覆盖层
  const box = await page.evaluate((opt) => {
    const e = window.__af;
    const s = e.stage;
    s.applyBand(s.rawBand, s.map, 200, 0);
    s.setCamera(-200, { x: 0, y: 0 }, 0);
    // 关键：loop 每帧会执行 stage.tick(engine.t)，所以必须把 engine.t 一起冻住，
    // 否则两版的焦散/光柱相位不同，比出来全是假差异。
    e.t = 100;
    s.tick(100);
    s.fishes.length = 0;
    s.skyActors.length = 0;
    s.fx = null;
    // 隔离实验：噪点每次加载都是新的随机纹理，会淹掉真正的结构差异。
    // 传 nograin 就把它关掉，剩下的差异才说明问题。
    if (opt === 'nograin') s.backdrop.grain = () => {};
    e.paused = true;
    for (const sel of ['.hud-layer', '.hud-shell', '.crosshair', '.banner', '.hintbar', '.island', '.splash-flash']) {
      document.querySelectorAll(sel).forEach((n) => (n.style.display = 'none'));
    }
    const r = document.querySelector('.viewport').getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }, opt);
  await sleep(400);
  await page.screenshot({ path: out, clip: box });
  await page.close();
  return errs;
}

const dir = path.resolve('.smoke/shots');
fs.mkdirSync(dir, { recursive: true });
const a = path.join(dir, 'cmp-old.png');
const b = path.join(dir, 'cmp-new.png');
const e1 = await shot(oldHtml, a);
const e2 = await shot(newHtml, b);

// 在同一页面里把两张图解码到 canvas，逐像素比对
const page = await browser.newPage();
const b64 = (p) => fs.readFileSync(p).toString('base64');
const diff = await page.evaluate(
  async (srcA, srcB) => {
    const load = (src) =>
      new Promise((res) => {
        const img = new Image();
        img.onload = () => res(img);
        img.src = src;
      });
    const [ia, ib] = await Promise.all([load(srcA), load(srcB)]);
    if (ia.width !== ib.width || ia.height !== ib.height) {
      return { error: 'size mismatch', a: [ia.width, ia.height], b: [ib.width, ib.height] };
    }
    const mk = (img) => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const da = mk(ia);
    const db = mk(ib);
    let maxDiff = 0;
    let over2 = 0;
    let sum = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      sum += d;
      if (d > maxDiff) maxDiff = d;
      if (d > 2) over2++;
    }
    const px = da.length / 4;
    return {
      w: ia.width,
      h: ia.height,
      pixels: px,
      maxChannelDiff: maxDiff,
      meanChannelDiff: +(sum / px).toFixed(3),
      pixelsOver2: over2,
      pctOver2: +((over2 / px) * 100).toFixed(3),
    };
  },
  'data:image/png;base64,' + b64(a),
  'data:image/png;base64,' + b64(b),
);
console.log('old errors:', e1.length, 'new errors:', e2.length);
console.log(JSON.stringify(diff, null, 1));
await browser.close();
