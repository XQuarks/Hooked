import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import fs from 'node:fs';
import path from 'node:path';
import { skipStory, castOff } from './lib.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const SHOTS = path.resolve('.smoke/shots');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = 'absurd-fishing-3d-save-v2';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR:', e.message); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('ERR:', m.text()); } });

const url = 'file:///' + HTML.replace(/\\/g, '/') + '#debug';
await page.goto(url, { waitUntil: 'load' });
await sleep(800);

// 造一份「已推进」的存档：满级鱼线 + 6 万块 + 解锁冰海
await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k));
  s.money = 60000;
  s.trips = 12;
  s.unlocked = ['bay', 'ice'];
  s.up = { line: 7, saw: 3, hook: 5, lamp: 4, fin: 3, scope: 2, slowmo: 1 };
  s.guns = ['pistol', 'shotgun', 'harpoon', 'revolver'];
  s.gun = 'shotgun';
  s.hats = ['straw', 'chef', 'crownless'];
  s.caught = { sardine: 9, mackerel: 4, goldfish: 1 };
  localStorage.setItem(k, JSON.stringify(s));
}, KEY);
await page.reload({ waitUntil: 'load' });
await sleep(1000);
await page.screenshot({ path: path.join(SHOTS, '10-title-rich.png') });
console.log('title:', await page.evaluate(() => document.querySelector('.title')?.innerText.replace(/\n/g, ' | ')));

await page.click('.btn.start');
await sleep(600);
await skipStory(page);
console.log('cast ->', await castOff(page));
await sleep(200);
const box = await page.evaluate(() => { const r = document.querySelector('.stage').getBoundingClientRect(); return { w: r.width, h: r.height }; });

let shotDeep = false, shotMid = false, maxDepth = 0, lastReport = 0;
for (let i = 0; i < 900; i++) {
  const st = await page.evaluate(() => {
    const e = window.__af;
    if (!e) return null;
    const d = e.debugState();
    const fish = window.__af.fishNear ? window.__af.fishNear(26) : [];
    return { d, fish };
  });
  if (!st) break;
  const { d } = st;
  if (d.phase === 'descent') {
    // 读取附近鱼位，往最空的一侧挪
    const near = await page.evaluate(() => {
      const e = window.__af;
      const lureY = e.lure?.y ?? 0;
      return (e.fishes || [])
        .filter((f) => !f.caught && !f.dead && f.depth > -lureY - 6 && f.depth < -lureY + 26)
        .map((f) => ({ x: f.x, depth: f.depth }));
    });
    const depth = Math.round(-(await page.evaluate(() => window.__af.lure.y)));
    maxDepth = Math.max(maxDepth, depth);
    let tx = -3.2;
    if (near.length) {
      let bestScore = -1e9;
      for (let c = -3.2; c <= 3.2; c += 0.4) {
        let score = 0;
        for (const f of near) score += Math.min(6, Math.abs(f.x - c) + Math.abs(f.depth - depth) * 0.15);
        if (score > bestScore) { bestScore = score; tx = c; }
      }
    }
    const px = box.w / 2 + (tx / 3.45) * (box.w / 2) * 0.86;
    await page.mouse.move(px, box.h * 0.62);
    if (depth > 90 && !shotMid) {
      await page.screenshot({ path: path.join(SHOTS, '11-band-coral.png') });
      shotMid = true;
      console.log('shot 珊瑚林 @' + depth + 'm');
    }
    if (depth > 170 && !shotDeep) {
      await page.screenshot({ path: path.join(SHOTS, '12-band-cliff.png') });
      shotDeep = true;
      console.log('shot 断崖 @' + depth + 'm');
    }
    if (depth - lastReport > 120) { lastReport = depth; console.log('' + depth + 'm'); }
  } else if (d.phase === 'shoot') {
    // 打最靠上的那条
    const target = await page.evaluate(() => {
      const e = window.__af;
      const d = e.debugState();
      const t = d.air.filter((a) => a.state === 'fly' && a.delay <= 0).sort((a, b) => b.y - a.y)[0];
      if (!t) return null;
      const p = e.stage.worldToScreen(t.x, t.y, 0.4);
      return p;
    });
    if (target && target.x > 6 && target.x < box.w - 6 && target.y > 6 && target.y < box.h - 6) {
      await page.mouse.click(target.x, target.y);
    }
  }
  if (d.phase !== 'descent' && !globalThis.__finalShot && maxDepth > 55) {
    globalThis.__finalShot = 1;
    await page.screenshot({ path: path.join(SHOTS, '16-deep-final.png') });
    console.log('shot final descent @' + maxDepth + 'm, phase=' + d.phase);
  }
  await sleep(45);
  const hasResult = await page.evaluate(() => !!document.querySelector('.result-total'));
  if (hasResult) {
    await page.screenshot({ path: path.join(SHOTS, '13-result-deep.png') });
    console.log('RESULT:', await page.evaluate(() => document.querySelector('.sheet')?.innerText.replace(/\n/g, ' | ')));
    break;
  }
}

// 切冰海
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('收下'));
  b && b.click();
});
await sleep(600);
await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k));
  s.map = 'ice';
  localStorage.setItem(k, JSON.stringify(s));
}, KEY);
await page.reload({ waitUntil: 'load' });
await sleep(1200);
await page.click('.btn.start');
await sleep(600);
await skipStory(page, 24);
await castOff(page);
await sleep(300);
await page.mouse.move(box.w / 2, box.h * 0.6);
await sleep(2600);
await page.screenshot({ path: path.join(SHOTS, '14-ice-shallow.png') });
const ice = await page.evaluate(() => window.__af.debugState());
console.log('ICE debug:', JSON.stringify(ice).slice(0, 200));
await sleep(2500);
await page.screenshot({ path: path.join(SHOTS, '15-ice-deep.png') });
console.log('ICE2:', JSON.stringify(await page.evaluate(() => window.__af.debugState())).slice(0, 160));

console.log('maxDepth reached:', maxDepth, 'errors:', errors.length);
await browser.close();
