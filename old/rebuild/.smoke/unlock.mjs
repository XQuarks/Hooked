/**
 * 解锁节奏 + 引导回归：
 * 1) trips = 1/2/3/4 时，手机主屏应分别出现对应数量的 App（非 debug 模式，真锁）
 * 2) 每次解锁都应有一条「有人告诉你」的引导（来电 / 短信）
 * 3) 电话 App：联系人列表 → 点进去看到历史通话的整段对话
 * 4) 漏接的电话回拨后，联系人里要补上台词（不是「没有留下记录」）
 */
import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { sleep } from './lib.mjs';

const KEY = 'absurd-fishing-3d-save-v2';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
// 注意：这里**不能**带 #debug，否则手机主屏会把没解锁的 App 也画出来
await page.goto('file:///' + path.resolve('dist/index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(900);

async function seed(trips, patch = {}) {
  await page.evaluate(
    (KEY, trips, patch) => {
      const s = JSON.parse(localStorage.getItem(KEY));
      s.trips = trips;
      // 开场事件都当作已经放过，避免来电把后面的断言搅乱
      s.fired = ['intro', 'introAfterFirst', 'firstTrip'];
      s.queue = [];
      s.messages = [];
      s.calls = [];
      s.notices = [];
      s.unread = {};
      s.unreadKey = {};
      s.appsSeen = ['sms', 'calls', 'story', 'dex', 'settings'];
      s.maxDepth = { bay: 60, ice: 0 };
      Object.assign(s, patch);
      localStorage.setItem(KEY, JSON.stringify(s));
    },
    KEY,
    trips,
    patch,
  );
  await page.reload({ waitUntil: 'load' });
  await sleep(900);
}

async function enter() {
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((x) => /开始|继续/.test(x.textContent || ''))?.click();
  });
  await sleep(700);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('跳过'))?.click();
  });
  await sleep(900);
}

async function openPhone() {
  await page.evaluate(() => document.querySelector('.island .is-btn.no')?.click());
  await sleep(400);
  await page.evaluate(() => document.querySelector('.phone-fab')?.click());
  await sleep(900);
}

const expect = { 1: 7, 2: 9, 3: 10, 4: 11 };
for (const trips of [1, 2, 3, 4]) {
  await seed(trips);
  await enter();
  const st = await page.evaluate((KEY) => {
    const s = JSON.parse(localStorage.getItem(KEY));
    return {
      fired: s.fired.filter((f) => f.startsWith('unlock')),
      guide: s.queue.filter((q) => q.kind === 'call').map((q) => q.topic),
      sms: s.messages.filter((m) => /帽子/.test(m.text)).length,
      notices: s.notices.filter((n) => n.kind === 'system').map((n) => n.title),
    };
  }, KEY);
  await openPhone();
  const apps = await page.evaluate(() =>
    [...document.querySelectorAll('.app-icon')].map((el) => ({
      lbl: el.querySelector('.lbl')?.textContent || '',
      isNew: !!el.querySelector('.app-new'),
      locked: el.classList.contains('locked'),
    })),
  );
  if (trips === 2) await page.screenshot({ path: '.smoke/shots/U-home2.png' });
  await page.evaluate(() => document.querySelector('.phone-fold')?.click());
  await sleep(400);
  const unlockedCount = apps.filter((a) => !a.locked).length;
  const ok = unlockedCount === expect[trips];
  console.log(
    `trips=${trips} ${ok ? '✅' : '❌'} 已解锁 ${unlockedCount}/${expect[trips]}  ` +
      `引导=${JSON.stringify(st.guide)} 帽子短信=${st.sms} 系统通知=${st.notices.length}`,
  );
  console.log('   → ' + apps.map((a) => a.lbl + (a.isNew ? '*' : a.locked ? '🔒' : '')).join(' / '));
}

// ---------- 联系人 + 已接来电的历史对话 ----------
await seed(2, {
  fired: ['intro', 'introAfterFirst', 'firstTrip', 'unlockGuns'],
  calls: [
    {
      id: 'call_introAfterFirst_0',
      from: 'cuihua',
      topic: '渔具店的熟人',
      trip: 1,
      missed: false,
      lines: [
        { text: '喂？是海家的小子吧？我是渔具店的翠花！' },
        { me: true, text: '呃……' },
        { text: '线越长，钓得越深，鱼越值钱！' },
      ],
    },
  ],
  messages: [
    { id: 'm1', thread: 'dapao', text: '兄弟！听说你用手枪打鱼？有前途！！', trip: 2, key: false },
    { id: 'm2', thread: 'cuihua', text: '鱼线该升级了哦～', trip: 2, key: false },
  ],
});
await enter();
await openPhone();
await page.evaluate(() => {
  [...document.querySelectorAll('.app-icon')].find((x) => (x.textContent || '').includes('电话'))?.click();
});
await sleep(700);
const list = await page.evaluate(() =>
  [...document.querySelectorAll('.contact-row')].map((r) => ({
    name: r.querySelector('b')?.textContent,
    preview: r.querySelector('i')?.textContent?.slice(0, 16),
  })),
);
console.log('联系人列表:', JSON.stringify(list));
await page.screenshot({ path: '.smoke/shots/U-list.png' });
await page.evaluate(() => {
  [...document.querySelectorAll('.contact-row')].find((r) => (r.textContent || '').includes('翠花'))?.click();
});
await sleep(600);
const detail = await page.evaluate(() => ({
  cards: document.querySelectorAll('.call-card').length,
  bubbles: [...document.querySelectorAll('.cc-lines .bub')].map((b) => b.textContent?.slice(0, 10)),
  note: document.querySelector('.cc-note')?.textContent ?? null,
}));
console.log('已接来电详情:', JSON.stringify(detail));
await page.screenshot({ path: '.smoke/shots/U-contact.png' });

// ---------- 漏接 → 回拨 → 台词补上 ----------
await seed(1, {
  fired: ['intro', 'introAfterFirst', 'firstTrip'],
  calls: [{ id: 'call_introAfterFirst_0', from: 'cuihua', topic: '渔具店的熟人', trip: 1, missed: true }],
});
await enter();
await openPhone();
await page.evaluate(() => {
  [...document.querySelectorAll('.app-icon')].find((x) => (x.textContent || '').includes('电话'))?.click();
});
await sleep(600);
await page.evaluate(() => {
  [...document.querySelectorAll('.contact-row')].find((r) => (r.textContent || '').includes('翠花'))?.click();
});
await sleep(500);
await page.evaluate(() => document.querySelector('.ca-btn')?.click());
await sleep(900);
for (let i = 0; i < 12; i++) {
  const hung = await page.evaluate(() => {
    const end = document.querySelector('.call .btn.danger.wide');
    if (end) { end.click(); return true; }
    document.querySelector('.call .lines')?.click(); // 点对话框推进
    document.querySelector('.call .btn.wide')?.click();
    return false;
  });
  if (hung) break;
  await sleep(260);
}
await sleep(800);
const afterCall = await page.evaluate((KEY) => {
  const s = JSON.parse(localStorage.getItem(KEY));
  const c = s.calls.find((x) => x.from === 'cuihua');
  return {
    missed: c?.missed,
    lines: c?.lines?.length ?? 0,
    cards: document.querySelectorAll('.call-card').length,
    bubbles: [...document.querySelectorAll('.cc-lines .bub')].map((b) => b.textContent?.slice(0, 10)),
    note: document.querySelector('.cc-note')?.textContent ?? null,
  };
}, KEY);
console.log('漏接后回拨:', JSON.stringify(afterCall));
await page.screenshot({ path: '.smoke/shots/U-callback.png' });

// ---------- 第一趟的引导：翠花电话里要点名新解锁的两个 App ----------
await seed(1, { fired: ['intro'] });
await enter();
const firstTrip = await page.evaluate((KEY) => {
  const s = JSON.parse(localStorage.getItem(KEY));
  const c = s.queue.find((q) => q.kind === 'call');
  return { topic: c?.topic, hasApps: (c?.lines ?? []).some((l) => /鱼博/.test(l.text) && /渔具店/.test(l.text)) };
}, KEY);
console.log('第一趟引导:', JSON.stringify(firstTrip));

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
