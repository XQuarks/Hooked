import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import fs from 'node:fs';
import path from 'node:path';
import { skipStory, castOff } from './lib.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const SHOTS = path.resolve('.smoke/shots');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
function note(msg) {
  const line = `[${new Date().toISOString().slice(11, 23)}] ${msg}`;
  log.push(line);
  console.log(line);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--font-render-hinting=none',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2, isMobile: false, hasTouch: false });

const errors = [];
const warns = [];
page.on('console', (m) => {
  const t = m.type();
  const text = m.text();
  if (t === 'error') { errors.push(text); note('CONSOLE ERROR: ' + text); }
  else if (t === 'warning') warns.push(text);
});
page.on('pageerror', (e) => { errors.push('PAGEERROR: ' + e.message); note('PAGE ERROR: ' + e.message); });
page.on('requestfailed', (r) => note('REQ FAILED: ' + r.url()));

const url = 'file:///' + HTML.replace(/\\/g, '/') + '#debug';
note('goto ' + url);
await page.goto(url, { waitUntil: 'load', timeout: 60000 });

// ---------- WebGL 能力 ----------
const gl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const g = c.getContext('webgl2') || c.getContext('webgl');
  if (!g) return { ok: false };
  const d = g.getExtension('WEBGL_debug_renderer_info');
  return { ok: true, renderer: d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER), ver: g.getParameter(g.VERSION) };
});
note('WebGL: ' + JSON.stringify(gl));

await sleep(1200);
await page.screenshot({ path: path.join(SHOTS, '01-title.png') });

const titleInfo = await page.evaluate(() => ({
  title: document.querySelector('.title h1')?.textContent,
  startBtn: document.querySelector('.btn.start')?.textContent,
  canvases: document.querySelectorAll('canvas').length,
  rootChildren: document.querySelector('#root')?.children.length,
}));
note('title: ' + JSON.stringify(titleInfo));

// ---------- 开始（先进游戏，播序章，再点屏幕下钩） ----------
await page.click('.btn.start');
note('clicked start');
await sleep(600);
const storyCleared = await skipStory(page);
note('prologue cleared: ' + storyCleared);
const firstPhase = await castOff(page);
note('cast fired -> ' + firstPhase);

const phaseOf = () => page.evaluate(() => document.querySelector('.hud-layer')?.getAttribute('data-phase') ?? null);

// 等待 HUD 出现
for (let i = 0; i < 60; i++) {
  if (await phaseOf()) break;
  await sleep(100);
}
note('phase after start: ' + (await phaseOf()));

const stageBox = await page.evaluate(() => {
  const r = document.querySelector('.stage').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
note('stage box: ' + JSON.stringify(stageBox));

let shotDescent = false, shotAscent = false, shotShoot = false, shotResult = false;
let sawAscent = false, sawShoot = false, sawTurn = false;
let shootFired = 0;
let t0 = Date.now();
let lastPhase = '';

// 主循环：根据 phase 操作
for (let tick = 0; tick < 420; tick++) {
  const phase = await phaseOf();
  if (phase !== lastPhase) {
    note(`phase -> ${phase} @${((Date.now() - t0) / 1000).toFixed(1)}s`);
    lastPhase = phase;
  }
  if (phase === 'turn') sawTurn = true;

  if (phase === 'descent') {
    // 正弦扫动，尽量去撞鱼
    const k = Math.sin(tick * 0.35);
    await page.mouse.move(stageBox.x + stageBox.w / 2 + k * stageBox.w * 0.32, stageBox.y + stageBox.h * 0.6);
    if (!shotDescent && (Date.now() - t0) > 1800) {
      await page.screenshot({ path: path.join(SHOTS, '02-descent.png') });
      shotDescent = true;
      note('shot descent');
    }
  } else if (phase === 'ascent') {
    sawAscent = true;
    const k = Math.sin(tick * 0.55);
    await page.mouse.move(stageBox.x + stageBox.w / 2 + k * stageBox.w * 0.36, stageBox.y + stageBox.h * 0.5);
    if (!shotAscent) {
      await page.screenshot({ path: path.join(SHOTS, '03-ascent.png') });
      shotAscent = true;
      note('shot ascent');
    }
  } else if (phase === 'shoot') {
    sawShoot = true;
    const st = await page.evaluate(() => {
      const e = window.__af;
      if (!e) return null;
      const d = e.debugState();
      const t = d.air.find((a) => a.state === 'fly' && a.delay <= 0);
      if (!t) return { d, p: null };
      const s2 = e.stage.worldToScreen(t.x, t.y, 0.4);
      return { d, p: { x: s2.x, y: s2.y } };
    });
    if (st) {
      if (shootFired === 0) note('shoot debug: ' + JSON.stringify(st.d));
      if (st.p && shootFired < 40) {
        const x = stageBox.x + st.p.x, y = stageBox.y + st.p.y;
        if (x > 4 && x < stageBox.w - 4 && y > 4 && y < stageBox.h - 4) {
          await page.mouse.move(x, y);
          await page.mouse.click(x, y);
          shootFired++;
        }
      }
      if (shootFired === 6) {
        const d2 = await page.evaluate(() => window.__af.debugState());
        note('after 6 shots: ' + JSON.stringify(d2));
      }
    }
    if (!shotShoot && shootFired >= 1) {
      await page.screenshot({ path: path.join(SHOTS, '04-shoot.png') });
      shotShoot = true;
      note('shot shoot');
    }
  } else if (phase === 'idle') {
    // 可能已结算
    const hasResult = await page.evaluate(() => !!document.querySelector('.result-total'));
    if (hasResult) {
      if (!shotResult) {
        await page.screenshot({ path: path.join(SHOTS, '05-result.png') });
        shotResult = true;
        const txt = await page.evaluate(() => document.querySelector('.sheet')?.innerText?.slice(0, 600));
        note('RESULT SHEET:\n' + txt);
        // 先验「点本局新消息 → 直接跳进手机短信」
        const hasMsgs = await page.evaluate(() => !!document.querySelector('.result-msgs'));
        if (hasMsgs) {
          await page.evaluate(() => document.querySelector('.result-msgs')?.click());
          await sleep(900);
          const jumped = await page.evaluate(() => ({
            phone: !!document.querySelector('.phone'),
            sheet: !!document.querySelector('.result-total'),
          }));
          note('result-msgs jump: ' + JSON.stringify(jumped));
          await page.screenshot({ path: path.join(SHOTS, '10-result-jump.png') });
          await page.evaluate(() => {
            const b = document.querySelector('.phone-fold');
            b?.click();
          });
          await sleep(600);
        }
        // 点「收下」（若上一步已经跳走，这里会跳过）
        const clicked = await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('收下'));
          if (b) { b.click(); return true; }
          return false;
        });
        note('clicked 收下: ' + clicked);
        await sleep(700);
        await page.screenshot({ path: path.join(SHOTS, '06-back.png') });
        const err = await page.evaluate(() => document.querySelector('.result-total'));
        note('result cleared: ' + (err === null));
      }
      break;
    }
    // 没有结算说明被剧情/手机挡住了，尝试关掉说明再出海
    const overlay = await page.evaluate(() => {
      const s = document.querySelector('.sheet-mask .btn, .notice .btn, .comic .btn');
      return s ? s.textContent : null;
    });
    if (overlay) { note('overlay button: ' + overlay); await page.evaluate(() => { const b = document.querySelector('.sheet-mask .btn, .notice .btn, .comic .btn'); b && b.click(); }); }
    else {
      note('idle, restart');
      await skipStory(page, 6);
      await castOff(page);
    }
  } else if (phase === null) {
    // HUD 未渲染：标题或暂停
    await sleep(120);
  }
  await sleep(60);
}

// ---------- 手机 UI 抽查 ----------
// 这一趟会触发「翠花姐来电」；手机震动时点它是接听，所以先按拒绝，才有法打开手机
await sleep(500);
await page.evaluate(() => document.querySelector('.island .is-btn.no')?.click());
await sleep(500);
const phoneOk = await page.evaluate(async () => {
  const b = (document.querySelector('.phone-fab') ?? [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('手机')));
  if (!b) return 'no phone btn';
  b.click();
  return 'clicked';
});
note('phone: ' + phoneOk);
await sleep(900);
await page.screenshot({ path: path.join(SHOTS, '07-phone.png') });
const phoneInfo = await page.evaluate(() => ({
  icons: document.querySelectorAll('.app-icon').length,
  bar: document.querySelector('.phone') ? 'open' : 'closed',
}));
note('phone info: ' + JSON.stringify(phoneInfo));

// 打开鱼鉴
const dex = await page.evaluate(() => {
  const i = [...document.querySelectorAll('.app-icon')].find((x) => x.textContent?.includes('鱼鉴'));
  if (i) { i.click(); return true; }
  return false;
});
await sleep(1200);
await page.screenshot({ path: path.join(SHOTS, '08-dex.png') });
note('dex opened: ' + dex);

const dexInfo = await page.evaluate(() => ({
  grid: document.querySelectorAll('.dex-grid > *').length,
  imgs: document.querySelectorAll('.dex-grid img').length,
}));
note('dex info: ' + JSON.stringify(dexInfo));

// 关手机
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('返回') || x.textContent?.includes('关闭'));
  b && b.click();
});

await sleep(600);
await page.screenshot({ path: path.join(SHOTS, '09-final.png') });

const finalState = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('absurd-fishing-3d-save-v2') || '{}');
  return { money: s.money, trips: s.trips, caught: s.caught ? Object.keys(s.caught).length : 0, bestTrip: s.bestTrip, bestCombo: s.bestCombo };
});
note('save state: ' + JSON.stringify(finalState));

note(`summary: turn=${sawTurn} ascent=${sawAscent} shoot=${sawShoot} clicks=${shootFired} errors=${errors.length}`);
if (warns.length) note('warnings(3): ' + warns.slice(0, 3).join(' | '));

fs.writeFileSync(path.resolve('.smoke/report.txt'), log.join('\n'), 'utf8');
await browser.close();
console.log('DONE errors=' + errors.length);
