import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { skipStory, castOff } from './lib.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const SHOTS = path.resolve('.smoke/shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
await sleep(1200);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('开始'));
  b?.click();
});
await sleep(600);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('跳过'));
  b?.click();
});
await sleep(800);

// ---------- 1. 岸边 → 抛竿的滑动动画 ----------
const before = await page.evaluate(() => {
  const s = document.querySelector('.hud-slide');
  return { on: s?.classList.contains('on') ?? null, goal: !!document.querySelector('.hud-slide .goal'), fab: !!document.querySelector('.hud-slide .phone-fab') };
});
console.log('岸边滑层:', JSON.stringify(before));

await castOff(page);
await sleep(120);
const mid = await page.evaluate(() => {
  const slides = [...document.querySelectorAll('.hud-slide')];
  return slides.map((s) => ({ on: s.classList.contains('on'), t: getComputedStyle(s).transform, o: getComputedStyle(s).opacity }));
});
console.log('抛竿后 120ms:', JSON.stringify(mid));
await page.screenshot({ path: path.join(SHOTS, '110-slide-mid.png') });
await sleep(700);
const after = await page.evaluate(() => {
  const slides = [...document.querySelectorAll('.hud-slide')];
  return {
    n: slides.length,
    on: slides.map((s) => s.classList.contains('on')),
    hasGoal: !!document.querySelector('.goal'),
    hasHook: !!document.querySelector('.hookbox, .abort'),
  };
});
console.log('抛竿后 820ms:', JSON.stringify(after));
await page.screenshot({ path: path.join(SHOTS, '111-descent-ui.png') });

// ---------- 2. 命中后不缩小 + 第二枪弹更高 ----------
// 等到射击阶段
for (let i = 0; i < 200; i++) {
  const ph = await page.evaluate(() => window.__af?.debugState?.().phase);
  if (ph === 'shoot') break;
  await sleep(150);
}
await sleep(600);

const r1 = await page.evaluate(() => {
  const e = window.__af;
  const a = (e.air || []).find((x) => x.state === 'fly');
  if (!a) return null;
  a.hp = 3;
  a.hits = 0;
  a.vy = 0;
  const before = a.mesh.root.scale.x;
  e.damage(a, 1, e.cfg);
  return { before, after: a.mesh.root.scale.x, hits: a.hits, vy: Math.round(a.vy), hp: a.hp };
});
console.log('第一枪:', JSON.stringify(r1));
await sleep(400);
const s1 = await page.evaluate(() => {
  const a = (window.__af.air || []).find((x) => x.state === 'fly');
  return a ? { scale: Number(a.mesh.root.scale.x.toFixed(3)), hits: a.hits, y: Number(a.y.toFixed(2)) } : null;
});
console.log('400ms 后:', JSON.stringify(s1));

const r2 = await page.evaluate(() => {
  const e = window.__af;
  const a = (e.air || []).find((x) => x.state === 'fly');
  if (!a) return null;
  const y0 = a.y;
  const vy0 = a.vy;
  e.damage(a, 1, e.cfg);
  return { y0: Number(y0.toFixed(2)), vy0: Math.round(vy0), vy1: Math.round(a.vy), hits: a.hits, hp: a.hp };
});
console.log('第二枪:', JSON.stringify(r2));
await sleep(300);
const s2 = await page.evaluate(() => {
  const a = (window.__af.air || []).find((x) => x.state === 'fly');
  return a ? { scale: Number(a.mesh.root.scale.x.toFixed(3)), y: Number(a.y.toFixed(2)) } : null;
});
console.log('300ms 后:', JSON.stringify(s2));
await page.screenshot({ path: path.join(SHOTS, '112-knockup.png') });

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
