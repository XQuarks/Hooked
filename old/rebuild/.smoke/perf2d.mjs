/**
 * 2D 版渲染成本测量：直接连续调用 stage.render()，测每帧 CPU 光栅化耗时。
 *
 * 为什么这样测：headless Chrome 的 canvas 2D 走 CPU（skia），
 * 与手机上「填充率吃紧」的体感成因一致；同步循环内 rAF 插不进来，采样干净。
 *
 * 用法：node .smoke/perf2d.mjs <html 路径> [full|bg]
 *   full = 真实场景（含鱼）
 *   bg   = 清空鱼，只测背景层（两版参数最可比）
 */
import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { skipStory, castOff, sleep } from './lib.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const target = process.argv[2];
const mode = process.argv[3] || 'full';
if (!target) {
  console.error('usage: node .smoke/perf2d.mjs <html> [full|bg]');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto('file:///' + path.resolve(target).replace(/\\/g, '/') + '#debug', { waitUntil: 'load' });
await sleep(700);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(900);
await page.click('.btn.start');
await sleep(500);
await skipStory(page);
const entered = await castOff(page);
await sleep(2400);

const r = await page.evaluate(async (mode) => {
  const e = window.__af;
  const s = e.stage;
  // 固定到 200m 完全水下：水体、光柱、焦散、噪点、近景剪影全开，两版参数一致。
  if (s.rawBand && s.map) {
    s.applyBand(s.rawBand, s.map, 200, 0);
    s.setCamera(-200, { x: 0, y: 0 }, 0);
    s.tick(100);
  }
  if (mode === 'bg') s.fishes.length = 0;
  // 暂停 update：否则每帧都会被游戏逻辑改回真实深度，场景就不再固定了。
  // render 仍照常跑，测到的就是纯绘制成本。
  e.paused = true;

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const t0 = performance.now();
  let frames = 0;
  await new Promise((res) => {
    const tick = () => {
      frames++;
      if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
      else res();
    };
    requestAnimationFrame(tick);
  });
  const secs = (performance.now() - t0) / 1000;
  const st = e.debugState();
  return {
    fps: +(frames / secs).toFixed(1),
    msPerFrame: +((secs / frames) * 1000).toFixed(2),
    frames,
    fishes: s.fishes.length,
    phase: st.phase,
    focusY: st.focusY,
    weather: st.weather,
    w: s.W,
    h: s.H,
    dpr: s.dpr,
  };
}, mode);

console.log(JSON.stringify({ target: path.basename(target), mode, entered, ...r }));
console.log('errors:', errors.length, errors.slice(0, 3));
await browser.close();
