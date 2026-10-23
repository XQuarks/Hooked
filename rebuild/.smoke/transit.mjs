/**
 * 水面衔接：入水 / 出水的连续性与观感。
 * 1) 全程采样 phase / lureY / camY / above，检查有没有跳变（一帧内 above 变化过大 = 硬切）
 * 2) 在穿越水面时连拍，肉眼看有没有「水下画面突然变天空」
 */
import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { skipStory, castOff, sleep } from './lib.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const SHOTS = path.resolve('.smoke/shots');
const KEY = 'absurd-fishing-3d-save-v2';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 140));
});

await page.goto('file:///' + HTML.replace(/\\/g, '/') + '#debug', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(1100);
await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k));
  s.unlocked = ['bay', 'ice'];
  s.map = 'bay';
  s.weather = 'clear';
  s.trips = 2;
  s.fired = ['intro', 'introAfterFirst'];
  s.queue = [];
  s.up = { line: 7, saw: 3, hook: 5, lamp: 4, fin: 3, scope: 2, slowmo: 1 };
  localStorage.setItem(k, JSON.stringify(s));
}, KEY);
await page.reload({ waitUntil: 'load' });
await sleep(1000);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /开始|继续/.test(x.textContent || ''));
  b?.click();
});
await sleep(700);
await skipStory(page);

// 逐帧采样
await page.evaluate(() => {
  window.__trace = [];
  const tick = () => {
    const e = window.__af;
    if (e) {
      const cy = e.stage.camera.position.y;
      window.__trace.push({
        ms: Math.round(performance.now()),
        phase: e.phase,
        ly: +e.lure.y.toFixed(2),
        cy: +cy.toFixed(2),
        above: +(0.5 + cy / 4).toFixed(3),
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

await castOff(page);
// 入水段：下钩后 0~3.2 秒
for (let i = 0; i < 5; i++) {
  await sleep(320);
  await page.screenshot({ path: path.join(SHOTS, `13-enter-${i}.png`) });
}
await sleep(2600);

// 提前收线，缩短下潜
await page.evaluate(() => window.__af?.beginAscent('manual'));
// 出水段：连拍
for (let i = 0; i < 8; i++) {
  await sleep(240);
  await page.screenshot({ path: path.join(SHOTS, `14-exit-${i}.png`) });
}

const trace = await page.evaluate(() => window.__trace);
const st = await page.evaluate(() => window.__af?.debugState());

// 分析：相邻帧 above 的最大跳变、相机纵向速度的最大变化
let maxAboveJump = 0;
let jumpAt = null;
let maxAccel = 0;
let accelAt = null;
let prevV = null;
for (let i = 1; i < trace.length; i++) {
  const a = trace[i - 1];
  const b = trace[i];
  const dA = Math.abs(b.above - a.above);
  if (dA > maxAboveJump) {
    maxAboveJump = dA;
    jumpAt = { i, from: a, to: b };
  }
  const dt = (b.ms - a.ms) / 1000;
  if (dt > 0.002) {
    const v = (b.cy - a.cy) / dt;
    if (prevV !== null) {
      const acc = Math.abs(v - prevV) / dt;
      if (acc > maxAccel) {
        accelAt = { i, from: a.phase, to: b.phase, v: Math.round(v), acc: Math.round(acc) };
        maxAccel = acc;
      }
    }
    prevV = v;
  }
}

const phases = [];
for (const p of trace) {
  if (!phases.length || phases[phases.length - 1].p !== p.phase) phases.push({ p: p.phase, ms: p.ms, ly: p.ly, above: p.above });
}
console.log('阶段时间线:', JSON.stringify(phases));
console.log('above 最大单帧跳变:', maxAboveJump.toFixed(3), JSON.stringify(jumpAt));
console.log('相机加速度峰值:', Math.round(maxAccel), 'px/s^2', JSON.stringify(accelAt));
console.log('样例帧(每 6 帧):', JSON.stringify(trace.filter((_, i) => i % 6 === 0).map((x) => `${x.phase}/${x.ly}/${x.cy}/${x.above}`)));
console.log('结束状态:', JSON.stringify({ phase: st?.phase, kills: st?.kills, gross: st?.gross }));
console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
