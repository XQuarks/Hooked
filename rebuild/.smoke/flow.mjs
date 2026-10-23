import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const SHOTS = path.resolve('.smoke/shots');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR:', e.message); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('ERR:', m.text().slice(0, 160)); } });

const url = 'file:///' + HTML.replace(/\\/g, '/') + '#debug';
await page.goto(url, { waitUntil: 'load' });
await sleep(600);
// 首次进入：清空存档
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(1000);

const phase = () => page.evaluate(() => document.querySelector('[data-phase]')?.dataset.phase ?? null);
const overlay = () => page.evaluate(() => {
  const el = document.querySelector('.comic, .call, .notice');
  if (!el) return null;
  return { kind: el.className, text: el.innerText.replace(/\n/g, ' | ').slice(0, 120) };
});

console.log('title shown:', await page.evaluate(() => !!document.querySelector('.title')));
await page.click('.btn.start');
await sleep(700);

// 1) 应该直接进入序章，而不是开始钓鱼
const first = await overlay();
console.log('after start -> overlay:', JSON.stringify(first));
console.log('phase:', await phase());
await page.screenshot({ path: path.join(SHOTS, '50-prologue-1.png') });

// 2) 逐格翻阅
for (let i = 0; i < 8; i++) {
  const before = await overlay();
  if (!before) break;
  await page.mouse.click(215, 430);
  await sleep(520);
  const after = await overlay();
  if (i === 1) await page.screenshot({ path: path.join(SHOTS, '51-prologue-2.png') });
  if (before.text === (after?.text ?? '')) {
    // 可能是 call 需要点按钮，点中央偏下
    await page.mouse.click(215, 620);
    await sleep(420);
  }
}
console.log('after comic:', JSON.stringify(await overlay()));

// 3) 把 call / notice 也走完（按类型点对应按钮）
for (let i = 0; i < 40; i++) {
  const o = await overlay();
  if (!o) break;
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const pick = ['接听', '继续', '挂断', '已阅']
      .map((t) => btns.find((b) => b.textContent && b.textContent.includes(t)))
      .find(Boolean);
    if (pick) { pick.click(); return pick.textContent.trim().slice(0, 12); }
    return null;
  });
  if (!clicked) await page.mouse.click(215, 430);
  await sleep(360);
}
const o2 = await overlay();
console.log('story done, overlay:', JSON.stringify(o2), 'phase:', await phase());
await page.screenshot({ path: path.join(SHOTS, '52-after-prologue.png') });

// 4) 点击屏幕任意处下钩
const queueLen = await page.evaluate(() => JSON.parse(localStorage.getItem('absurd-fishing-3d-save-v2')).queue.length);
console.log('queue left:', queueLen, 'phase before tap:', await phase());
await page.mouse.click(215, 560);
await sleep(120);
console.log('phase after tap:', await phase());
await page.screenshot({ path: path.join(SHOTS, '53-cast-early.png') });
await sleep(320);
await page.screenshot({ path: path.join(SHOTS, '54-cast-air.png') });
await sleep(340);
await page.screenshot({ path: path.join(SHOTS, '55-cast-splash.png') });
await sleep(400);
console.log('phase after cast:', await phase());
await page.screenshot({ path: path.join(SHOTS, '56-descent.png') });

// 5) 等到 shoot，验证未致死鱼的击飞
let hit = null;
for (let i = 0; i < 240; i++) {
  const p = await phase();
  if (p === 'shoot') {
    const info = await page.evaluate(() => {
      const e = window.__af;
      const d = e.debugState();
      const t = d.air.filter((a) => a.state === 'fly' && a.delay <= 0 && a.hp > 1).sort((a, b) => b.y - a.y)[0]
        || d.air.filter((a) => a.state === 'fly' && a.delay <= 0).sort((a, b) => b.y - a.y)[0];
      if (!t) return null;
      const s = e.stage.worldToScreen(t.x, t.y, 0.4);
      return { sp: t.sp, hp: t.hp, y: t.y, x: s.x, sy: s.y };
    });
    if (info && info.x > 10 && info.x < 420 && info.sy > 10 && info.sy < 880) {
      const before = info;
      await page.mouse.click(info.x, info.sy);
      await sleep(120);
      const after = await page.evaluate((sp) => {
        const d = window.__af.debugState();
        const t = d.air.find((a) => a.sp === sp);
        return t ? { y: t.y, hp: t.hp, state: t.state } : null;
      }, info.sp);
      hit = { before, after };
      console.log('HIT TEST:', JSON.stringify(hit));
      await page.screenshot({ path: path.join(SHOTS, '57-knockup.png') });
      await sleep(140);
      const after2 = await page.evaluate((sp) => {
        const d = window.__af.debugState();
        const t = d.air.find((a) => a.sp === sp);
        return t ? { y: t.y, hp: t.hp, state: t.state } : null;
      }, info.sp);
      console.log('after 260ms:', JSON.stringify(after2));
      break;
    }
    // 没有可点的鱼就点屏幕让时间推进
    await page.mouse.click(215, 300);
  }
  await sleep(60);
}
if (hit?.after) {
  console.log('KNOCKUP dy =', (hit.after.y - hit.before.y).toFixed(2), 'hp', hit.before.hp, '->', hit.after.hp, 'state', hit.after.state);
}
console.log('errors:', errors.length);
await browser.close();
