/** 这一批新增的四个功能：App 分页 / 鱼博发帖点赞 / 通知栏批量 / 电话回拨 */
import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { skipStory, sleep } from './lib.mjs';

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
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 160));
});

const openApp = async (name) =>
  page.evaluate((n) => {
    const icon = [...document.querySelectorAll('.app-icon')].find((x) => (x.textContent || '').includes(n));
    if (!icon) return false;
    icon.click();
    return true;
  }, name);

await page.goto('file:///' + HTML.replace(/\\/g, '/') + '#debug', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(1100);
await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k));
  s.unlocked = ['bay', 'ice'];
  s.map = 'bay';
  s.trips = 3;
  s.fired = ['intro', 'introAfterFirst'];
  s.queue = [];
  s.up = { line: 7, saw: 3, hook: 5, lamp: 4, fin: 3, scope: 2, slowmo: 1 };
  s.notices = [
    { id: 'n1', title: '测试公告', text: '第一行', trip: 3, kind: 'notice' },
    { id: 'n2', title: '新应用：渔具', text: '回到主屏幕看看', trip: 3, kind: 'system' },
  ];
  s.calls = [
    { id: 'call_c1', from: 'cuihua', topic: '渔具店的熟人', trip: 2, missed: true },
    { id: 'call_c2', from: 'unknown', topic: '海底的瓶子', trip: 3, missed: false },
  ];
  s.feed = [{ id: 'f1', author: 'kevin', text: '今天又是第一！', likes: 12, trip: 2 }];
  s.unread = { sms: 2, feed: 1 };
  s.unreadKey = { sms: 2 };
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
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('跳过'));
  b?.click();
});
await sleep(600);
await page.evaluate(() => document.querySelector('.phone-fab')?.click());
await sleep(600);

// ── 1. 分页 ──
const p1 = await page.evaluate(() => ({
  icons: document.querySelectorAll('.app-icon').length,
  dots: document.querySelectorAll('.app-dot').length,
  names: [...document.querySelectorAll('.app-icon .lbl')].map((e) => e.textContent),
}));
await page.evaluate(() => document.querySelectorAll('.app-dot')[1]?.click());
await sleep(320);
const p2 = await page.evaluate(() => ({
  icons: document.querySelectorAll('.app-icon').length,
  names: [...document.querySelectorAll('.app-icon .lbl')].map((e) => e.textContent),
  on: document.querySelector('.app-dot.on') ? [...document.querySelectorAll('.app-dot')].indexOf(document.querySelector('.app-dot.on')) : -1,
}));
console.log('分页-第1页:', JSON.stringify(p1));
console.log('分页-第2页:', JSON.stringify(p2));
await page.screenshot({ path: path.join(SHOTS, '30-apps-page2.png') });

// ── 2. 鱼博：发帖 + 点赞 ──
await page.evaluate(() => document.querySelectorAll('.app-dot')[0]?.click());
await sleep(200);
console.log('开鱼博:', await openApp('鱼博'));
await sleep(400);
const feedBefore = await page.evaluate(() => document.querySelectorAll('.feed-post').length);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('发帖'));
  b?.click();
});
await sleep(400);
const feedAfter = await page.evaluate(() => ({
  n: document.querySelectorAll('.feed-post').length,
  top: document.querySelector('.feed-post p')?.textContent ?? null,
}));
// 点赞第一条（自己发的那条在最上面）
const like1 = await page.evaluate(() => {
  const b = document.querySelector('.feed-post .like');
  if (!b) return null;
  const before = b.textContent;
  b.click();
  return before;
});
await sleep(300);
const likeAfter = await page.evaluate(() => {
  const b = document.querySelector('.feed-post .like');
  return { text: b?.textContent ?? null, on: b?.classList.contains('on') ?? null };
});
await page.evaluate(() => document.querySelector('.feed-post .like')?.click());
await sleep(200);
const likeTwice = await page.evaluate(() => document.querySelector('.feed-post .like')?.textContent ?? null);
console.log('鱼博:', JSON.stringify({ feedBefore, feedAfter, like1, likeAfter, likeTwice }));
await page.screenshot({ path: path.join(SHOTS, '31-feed-post.png') });

// ── 3. 通知栏 ──
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('‹'));
  b?.click();
});
await sleep(400);
await page.evaluate(() => {
  const bell = document.querySelector('.phone-bell');
  bell?.click();
});
await sleep(500);
const ntfBefore = await page.evaluate(() => ({
  rows: document.querySelectorAll('.ntf').length,
  tools: [...document.querySelectorAll('.ntf-tools .mini-btn')].map((b) => b.textContent),
}));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.ntf-tools .mini-btn')].find((x) => (x.textContent || '').includes('全部已读'));
  b?.click();
});
await sleep(300);
const afterRead = await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k));
  return { unread: s.unread, unreadKey: s.unreadKey };
}, KEY);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.ntf-tools .mini-btn')].find((x) => (x.textContent || '').includes('清空'));
  b?.click();
});
await sleep(300);
const afterClear = await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k));
  return { notices: s.notices.length, calls: s.calls.length };
}, KEY);
console.log('通知栏:', JSON.stringify({ ntfBefore, afterRead, afterClear }));

// ── 4. 电话回拨 ──
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('‹'));
  b?.click();
});
await sleep(400);
console.log('开电话:', await openApp('电话'));
await sleep(400);
const backBtn = await page.evaluate(() => document.querySelectorAll('.cl-back').length);
await page.evaluate(() => document.querySelector('.cl-back')?.click());
await sleep(600);
const callUi = await page.evaluate(() => ({
  call: !!document.querySelector('.call'),
  text: document.querySelector('.call')?.innerText.replace(/\n/g, ' | ').slice(0, 90) ?? null,
}));
await page.screenshot({ path: path.join(SHOTS, '32-callback.png') });

console.log('回拨:', JSON.stringify({ backBtn, callUi }));
console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
