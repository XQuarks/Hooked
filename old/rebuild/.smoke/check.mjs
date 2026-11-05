import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const SHOTS = path.resolve('.smoke/shots');
const URL = 'file:///' + HTML.replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  if (m.type() === 'error') errs.push(m.text().slice(0, 160));
});

const clickText = (t) =>
  page.evaluate((txt) => {
    const el = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(txt));
    if (!el) return false;
    el.click();
    return true;
  }, t);

async function skipStory(rounds = 20) {
  for (let i = 0; i < rounds; i++) {
    const any = await page.evaluate(() => !!document.querySelector('.comic, .call, .notice, .bottle'));
    if (!any) return true;
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const pick = ['跳过', '接听', '已阅', '继续'].map((t) => btns.find((b) => (b.textContent || '').includes(t))).find(Boolean);
      if (pick) pick.click();
      else document.querySelector('.comic')?.click();
    });
    await sleep(320);
  }
  return false;
}

// ---------- 1. 新档：开场只应有 1 个弹层 ----------
await page.goto(URL, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(1500);

await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('开始'));
  b?.click();
});
await sleep(700);

const overlays = [];
for (let i = 0; i < 6; i++) {
  const kind = await page.evaluate(() => {
    if (document.querySelector('.comic')) return 'comic';
    if (document.querySelector('.call')) return 'call';
    if (document.querySelector('.notice')) return 'notice';
    return null;
  });
  if (!kind) break;
  overlays.push(kind);
  await skipStory(1);
}
console.log('开场弹层序列:', overlays.join(' -> ') || '(none)');

await sleep(600);
await page.screenshot({ path: path.join(SHOTS, '70-goal.png') });

// 目标条文案
const goal = await page.evaluate(() => document.querySelector('.goal')?.innerText.replace(/\n/g, ' | ') ?? null);
console.log('目标条:', goal);

// ---------- 2. 新档手机：应只有 3 个可用 ----------
await clickText('📱');
await sleep(500);
await page.screenshot({ path: path.join(SHOTS, '71-phone-locked.png') });
const locked = await page.evaluate(() =>
  [...document.querySelectorAll('.app-icon')].map((b) => ({
    name: (b.querySelector('.lbl')?.textContent || '').trim(),
    locked: b.classList.contains('locked'),
  })),
);
console.log('新档 App:', JSON.stringify(locked));

// 点锁定 App 应给提示
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.app-icon.locked')][0];
  b?.click();
});
await sleep(500);
const toast = await page.evaluate(() => [...document.querySelectorAll('.hintbar')].map((e) => e.textContent).join(' | ') || null);
console.log('点锁定 App 提示:', toast);

await page.evaluate(() => document.querySelector('.phone-wrap')?.click());
await sleep(300);

// ---------- 3. 注入进度：全部解锁 + 红点 ----------
await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k));
  s.trips = 4;
  s.money = 900;
  s.totalEarned = 900;
  s.maxDepth = { bay: 70, ice: 0 };
  s.unreadKey = { sms: 2 };
  s.unread = { sms: 5, feed: 7 };
  s.appsSeen = ['sms', 'dex', 'settings', 'tackle'];
  localStorage.setItem(k, JSON.stringify(s));
}, KEY);
await page.reload({ waitUntil: 'load' });
await sleep(1500);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('继续'));
  b?.click();
});
await sleep(700);
await skipStory(6);
await sleep(400);

const hudBadge = await page.evaluate(() => {
  const el = document.querySelector('.dot-num, .dot-any');
  return el ? { cls: el.className, text: el.textContent } : null;
});
console.log('HUD 手机徽标:', JSON.stringify(hudBadge));

await clickText('📱');
await sleep(500);
await page.screenshot({ path: path.join(SHOTS, '72-phone-unlocked.png') });
const apps = await page.evaluate(() =>
  [...document.querySelectorAll('.app-icon')].map((b) => ({
    name: (b.querySelector('.lbl')?.textContent || '').trim(),
    locked: b.classList.contains('locked'),
    dot: b.querySelector('.dot')?.textContent ?? null,
    any: !!b.querySelector('.app-any'),
    isNew: !!b.querySelector('.app-new'),
  })),
);
console.log('进度档 App:', JSON.stringify(apps));

// 打开短信 → 红点应清零
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.app-icon')].find((x) => (x.querySelector('.lbl')?.textContent || '').includes('短信'));
  b?.click();
});
await sleep(700);
await page.screenshot({ path: path.join(SHOTS, '73-sms.png') });
await page.evaluate(() => document.querySelector('.back')?.click());
await sleep(400);
const afterRead = await page.evaluate(() =>
  [...document.querySelectorAll('.app-icon')].map((b) => ({
    name: (b.querySelector('.lbl')?.textContent || '').trim(),
    dot: b.querySelector('.dot')?.textContent ?? null,
    any: !!b.querySelector('.app-any'),
  })),
);
console.log('读短信后:', JSON.stringify(afterRead));

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
