/**
 * 手感批次验证：刹停惯性 / 起拉 anticipation / 收线 lead / hitStop
 * 直接在页面里用 rAF 采样，避免 RPC 往返把时间轴拉歪。
 */
import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { castOff, sleep } from './lib.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const KEY = 'absurd-fishing-3d-save-v2';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 1 });
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
await sleep(1400);
// 先串两条鱼，保证待会儿能进 shoot 测 hitStop
await page.evaluate(() => {
  const e = window.__af;
  const pool = e.fishes.filter((f) => !f.caught && !f.dead && f.mesh).slice(0, 3);
  for (const f of pool) e.hook(f, e.cfg);
});

// ── 1. 刹停 + 起拉：采样 2.4 秒 ──
const trace = await page.evaluate(() => new Promise((resolve) => {
  const e = window.__af;
  const out = [];
  const before = { y: e.lure.y, vy: e.lure.vy, depth: -e.lure.y };
  e.beginTurn('bottom');
  const t0 = performance.now();
  const tick = () => {
    out.push({
      t: Math.round(performance.now() - t0),
      ph: e.phase,
      y: +e.lure.y.toFixed(3),
      vy: +e.lure.vy.toFixed(2),
      gap: +(e.focusY - e.lure.y).toFixed(2),
    });
    if (performance.now() - t0 < 2400) requestAnimationFrame(tick);
    else resolve({ before, out });
  };
  requestAnimationFrame(tick);
}));
await sleep(200);

const before = trace.before;
const rows = trace.out;
const turnRows = rows.filter((r) => r.ph === 'turn');
const ascRows = rows.filter((r) => r.ph === 'ascent');
const lastTurn = turnRows[turnRows.length - 1];
const firstAsc = ascRows[0];
const deepest = ascRows.reduce((a, b) => (b.y < a.y ? b : a), ascRows[0]);
const riseStart = ascRows.findIndex((r) => r.y > deepest.y);

console.log('刹车前:', JSON.stringify(before));
console.log('turn 段:', JSON.stringify({ frames: turnRows.length, from: turnRows[0]?.y, to: lastTurn?.y, drop: +(lastTurn?.y - turnRows[0]?.y).toFixed(2) }));
console.log('ascent 起点:', JSON.stringify({ y: firstAsc?.y, vy: firstAsc?.vy }));
console.log('ascent 最深点:', JSON.stringify(deepest), '出现在第', riseStart, '帧 / 共', ascRows.length);
console.log('anticipation 下沉量:', +(deepest.y - firstAsc.y).toFixed(3), 'm');
const tail = ascRows.slice(-6).map((r) => `vy=${r.vy} gap=${r.gap}`);
console.log('收线末段(vy / 镜头间隔):', JSON.stringify(tail));

// ── 2. hitStop：打一枪看 hitStopT 有没有起来 ──
const hs = await page.evaluate(() => {
  const e = window.__af;
  const a = (e.air || []).find((x) => x.state === 'fly');
  if (!a) return { err: 'no fish', phase: e.phase };
  a.hp = 6;
  a.knockT = 0;
  e.damage(a, 1, e.cfg);
  const snap = { first: e.hitStopT, hp: a.hp };
  e.damage(a, 1, e.cfg);
  snap.second = e.hitStopT;
  return snap;
});
console.log('hitStop:', JSON.stringify(hs));
console.log('shot 阶段:', JSON.stringify(await page.evaluate(() => ({ phase: window.__af.phase, air: window.__af.air.length }))));

// ── 3. 收线镜头 lead：镜头与钩子的差值应接近固定偏移，而不是越拉越大 ──
const lead = await page.evaluate(() => {
  const e = window.__af;
  const rows = [];
  for (let i = 0; i < 1; i++) {
    rows.push({
      phase: e.phase,
      lureY: +e.lure.y.toFixed(2),
      focusY: +e.focusY.toFixed(2),
      gap: +(e.focusY - e.lure.y).toFixed(2),
    });
  }
  return rows[0];
});
console.log('镜头间隔:', JSON.stringify(lead));

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
