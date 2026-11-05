/** 命中溅汁 + 空中镜头跳过扣钱鱼（水母） */
import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { castOff, sleep } from './lib.mjs';

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
await sleep(600);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('跳过'));
  b?.click();
});
await sleep(700);
await castOff(page);
await sleep(1800);

await page.evaluate(() => {
  const e = window.__af;
  const pool = e.fishes.filter((f) => !f.caught && !f.dead && f.mesh).slice(0, 6);
  for (const f of pool) e.hook(f, e.cfg);
});
await page.evaluate(() => window.__af?.beginAscent('manual'));
for (let i = 0; i < 240; i++) {
  const ph = await page.evaluate(() => window.__af?.phase);
  if (ph === 'shoot') break;
  await sleep(100);
}
await sleep(900);

// ── 1. 空中最下面那条如果是扣钱鱼，镜头不应该跟它
const setup = await page.evaluate(() => {
  const e = window.__af;
  const fly = e.air.filter((a) => a.state === 'fly').sort((a, b) => a.y - b.y);
  if (fly.length < 2) return { ok: false, n: fly.length };
  const low = fly[0];
  const high = fly[1];
  // 只改 value：相机判定看的就是这个字段，不用换成真的水母
  low.sp = { ...low.sp, value: -25, special: 'jelly' };
  low.y = 3.2;
  low.x = -2.6;
  high.y = 7.5;
  high.x = 2.1;
  for (const a of fly.slice(2)) a.state = 'lost';
  // 直接对齐镜头，别让它从 20 米慢慢降下来（那会掩盖真正的跟随结果）
  e.focusY = 8;
  return { ok: true, lowX: low.x, lowY: low.y, highX: high.x, highY: high.y };
});
await sleep(1100);
const camA = await page.evaluate(() => ({
  camX: +window.__af.stage.cam.cx.toFixed(2),
  focusY: +window.__af.focusY.toFixed(2),
  camY: +window.__af.stage.camera.position.y.toFixed(2),
}));
console.log('水母在左下、能卖钱的在右上:', JSON.stringify(setup));
console.log('镜头（应贴右侧 2.1，不该是 -2.6）:', JSON.stringify(camA));

// ── 2. 天上只剩扣钱鱼：镜头回水面附近，不追它们
await page.evaluate(() => {
  const e = window.__af;
  for (const a of e.air) {
    if (a.state !== 'fly') continue;
    a.sp = { ...a.sp, value: -25, special: 'jelly' };
    a.y = 12;
    a.x = -1.2;
  }
});
await sleep(1300);
const camB = await page.evaluate(() => ({
  camX: +window.__af.stage.cam.cx.toFixed(2),
  focusY: +window.__af.focusY.toFixed(2),
}));
console.log('全是水母（y=12）:', JSON.stringify(camB), '（focusY 应远低于 12）');
await page.screenshot({ path: path.join(SHOTS, '40-jelly-cam.png') });

// ── 3. 命中溅汁：把鱼摆到画面正中再打，才看得见粒子
await page.evaluate(() => {
  const e = window.__af;
  const a = e.air.find((x) => x.state === 'fly');
  if (!a) return;
  a.sp = { ...a.sp, value: 20, color: '#ff9ad5', color2: '#ffd1ec' };
  a.hp = 8;
  a.x = 0;
  a.y = 8;
  a.vy = 0;
  a.vx = 0;
  e.focusY = 9.5;
});
await sleep(420);
const juiceInfo = await page.evaluate(() => {
  const e = window.__af;
  const a = e.air.find((x) => x.state === 'fly');
  if (!a) return null;
  const before = { ps: e.fx.ps.length, splats: e.fx.splats.length };
  e.damage(a, 1, e.cfg);
  const juice = e.fx.ps.filter((x) => x.juice);
  return {
    before,
    after: { ps: e.fx.ps.length, splats: e.fx.splats.length },
    juiceCount: juice.length,
    colors: [...new Set(juice.map((p) => p.color))],
    gravity: juice[0]?.gravity,
    stretch: juice[0]?.stretch,
    fishColor: a.sp.color,
    fishColor2: a.sp.color2,
    fishPos: { x: +a.x.toFixed(2), y: +a.y.toFixed(2) },
    camY: +e.focusY.toFixed(2),
  };
});
console.log('命中:', JSON.stringify(juiceInfo));
await sleep(85);
await page.screenshot({ path: path.join(SHOTS, '41-juice-hit.png') });
await sleep(120);
await page.screenshot({ path: path.join(SHOTS, '41b-juice-spread.png') });

// ── 4. 击杀：更大一坨
const killInfo = await page.evaluate(() => {
  const e = window.__af;
  const a = e.air.find((x) => x.state === 'fly' && x.hp > 0);
  if (!a) return null;
  a.sp = { ...a.sp, value: 20, special: undefined };
  a.hp = 1;
  a.x = 0;
  a.y = 8;
  const before = e.fx.ps.filter((x) => x.juice).length;
  const g0 = e.res.gross;
  e.damage(a, 99, e.cfg);
  return {
    added: e.fx.ps.filter((x) => x.juice).length - before,
    splats: e.fx.splats.length,
    gross: Math.round(e.res.gross - g0),
  };
});
console.log('击杀:', JSON.stringify(killInfo));
await sleep(80);
await page.screenshot({ path: path.join(SHOTS, '42-juice-kill.png') });

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
