/** 天空目标：刷新、飞行、被打掉、不拦结算 */
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
  if (m.type() === 'error') errs.push(m.text().slice(0, 160));
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
await sleep(1600);
await page.evaluate(() => {
  const e = window.__af;
  const pool = e.fishes.filter((f) => !f.caught && !f.dead && f.mesh).slice(0, 5);
  for (const f of pool) e.hook(f, e.cfg);
});
await page.evaluate(() => window.__af?.beginAscent('manual'));
for (let i = 0; i < 200; i++) {
  const ph = await page.evaluate(() => window.__af?.phase);
  if (ph === 'shoot') break;
  await sleep(100);
}
await sleep(400);

// 手动刷三种，保证画面里都有
const spawned = await page.evaluate(() => {
  const e = window.__af;
  e.sky.length = 0;
  for (let i = 0; i < 3; i++) e.spawnSky();
  e.sky.forEach((s, i) => {
    s.x = -1.6 + i * 1.6;
    s.y = e.focusY + 2 + i * 1.4;
    s.t = i * 1.3;
  });
  return e.sky.map((s) => `${s.kind}:${s.hp}:${s.value}`);
});
console.log('刷新:', JSON.stringify(spawned));
await sleep(1900);
await page.evaluate(() => {
  const e = window.__af;
  // 截图时再把天空目标摆到镜头附近，保证三只都在画面里
  e.sky.forEach((s, i) => {
    s.x = -1.7 + i * 1.7;
    s.y = e.focusY + 2.2 + i * 1.5;
  });
});
await sleep(200);
await page.screenshot({ path: path.join(SHOTS, '23-sky-targets.png') });

const kill = await page.evaluate(() => {
  const e = window.__af;
  const before = { n: e.sky.length, gross: e.debugState().gross };
  const target = e.sky.find((s) => s.kind === 'ufo') || e.sky[0];
  const idx = e.sky.indexOf(target);
  e.hitSky(idx, 1, e.cfg);
  const mid = { n: e.sky.length, hp: target.hp };
  e.hitSky(idx, 99, e.cfg);
  return { before, mid, after: { n: e.sky.length, gross: e.debugState().gross } };
});
console.log('命中:', JSON.stringify(kill));
await sleep(300);
await page.screenshot({ path: path.join(SHOTS, '24-sky-hit.png') });

// 天空目标清空后，结算仍然要能正常走
const flow = await page.evaluate(() => new Promise((resolve) => {
  const e = window.__af;
  e.sky.length = 0;
  for (const a of e.air) e.damage(a, 99, e.cfg);
  const t0 = performance.now();
  const tick = () => {
    if (e.phase !== 'shoot') resolve({ phase: e.phase, ms: Math.round(performance.now() - t0) });
    else if (performance.now() - t0 > 6000) resolve({ phase: e.phase, ms: -1 });
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));
console.log('清空后:', JSON.stringify(flow));
await sleep(900);
const sheet = await page.evaluate(() => document.querySelector('.sheet')?.innerText ?? null);
const line = sheet ? (sheet.split('\n').find((l) => l.includes('击落')) ?? null) : null;
console.log('结算页击落行:', JSON.stringify(line));
console.log('毛收入行:', JSON.stringify(sheet ? sheet.split('\n').find((l) => l.includes('毛收入')) : null));
await page.screenshot({ path: path.join(SHOTS, '25-result-sky.png') });
console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
