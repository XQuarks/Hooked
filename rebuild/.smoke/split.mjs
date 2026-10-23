import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const SHOTS = path.resolve('.smoke/shots');
const URL = 'file:///' + HTML.replace(/\\/g, '/') + '#debug';
const KEY = 'absurd-fishing-3d-save-v2';
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
  if (m.type() === 'error') errs.push(m.text().slice(0, 160));
});

// 1) 新档 → 进游戏 → 跳过漫画
await page.goto(URL, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(1300);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('开始'));
  b?.click();
});
await sleep(600);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('跳过'));
  b?.click();
});
await sleep(900);

console.log(
  '岸边 HUD:',
  JSON.stringify(
    await page.evaluate(() => ({
      map: document.querySelector('.hud-map')?.innerText.replace(/\n/g, ' | ') ?? null,
      chips: [...document.querySelectorAll('.hud-top .chip')].map((e) => e.innerText.replace(/\n/g, ' ')),
      phoneFab: !!document.querySelector('.phone-fab'),
      castHint: document.querySelector('.cast-hint')?.textContent ?? null,
      startBtn: !!document.querySelector('.hud-bottom .btn'),
    })),
  ),
);
await page.screenshot({ path: path.join(SHOTS, '100-shore-hud.png') });

// 2) 注入未读，验证进短信后红点清零
await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k));
  s.messages = [
    { id: 'm1', thread: 'mom', text: '你在哪', trip: 1 },
    { id: 'm2', thread: 'cuihua', text: '来升级', trip: 1 },
  ];
  s.unread = { sms: 2, feed: 1, comic: 1 };
  s.unreadKey = { sms: 2, comic: 1 };
  s.feed = [{ id: 'p1', author: 'kevin', text: '测试鱼博', likes: 3, trip: 1 }];
  s.calls = [{ id: 'call_x', from: 'cuihua', topic: '渔具店', trip: 1, missed: true }];
  s.unread.call = 1;
  s.unreadKey.call = 1;
  localStorage.setItem(k, JSON.stringify(s));
}, KEY);
await page.reload({ waitUntil: 'load' });
await sleep(1200);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /开始|继续/.test(x.textContent || ''));
  b?.click();
});
await sleep(900);
// 若有剧情浮层先跳过
for (let i = 0; i < 6; i++) {
  const has = await page.evaluate(() => !!document.querySelector('.comic,.call,.notice'));
  if (!has) break;
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /跳过|接听|继续|已阅|挂断/.test(x.textContent || ''));
    b?.click();
  });
  await sleep(400);
}

await page.evaluate(() => document.querySelector('.phone-fab')?.click());
await sleep(800);
const home = await page.evaluate(() => ({
  apps: [...document.querySelectorAll('.app-icon .lbl')].map((e) => e.textContent),
  smsDot: (() => { const i = [...document.querySelectorAll('.app-icon')].find((x) => (x.textContent || '').includes('短信')); return i?.querySelector('.dot')?.textContent ?? null; })(),
  callDot: (() => { const i = [...document.querySelectorAll('.app-icon')].find((x) => (x.textContent || '').includes('电话')); return i?.querySelector('.dot')?.textContent ?? null; })(),
}));
console.log('手机主屏:', JSON.stringify(home));
await page.screenshot({ path: path.join(SHOTS, '101-phone-apps.png') });

// 3) 进短信 → 返回 → 红点应消失
await page.evaluate(() => {
  const i = [...document.querySelectorAll('.app-icon')].find((x) => (x.textContent || '').includes('短信'));
  i?.click();
});
await sleep(800);
const inSms = await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k) || '{}');
  return {
    bar: document.querySelector('.appbar .tt')?.textContent ?? null,
    tabs: document.querySelectorAll('.tabs').length,
    unread: s.unread?.sms ?? null,
    unreadKey: s.unreadKey?.sms ?? null,
  };
}, KEY);
console.log('进短信后:', JSON.stringify(inSms));

// 返回主屏
await page.evaluate(() => document.querySelector('.appbar .back')?.click());
await sleep(500);
const afterBack = await page.evaluate(() => ({
  smsDot: (() => { const i = [...document.querySelectorAll('.app-icon')].find((x) => (x.textContent || '').includes('短信')); return i?.querySelector('.dot')?.textContent ?? null; })(),
  callDot: (() => { const i = [...document.querySelectorAll('.app-icon')].find((x) => (x.textContent || '').includes('电话')); return i?.querySelector('.dot')?.textContent ?? null; })(),
  phoneDot: document.querySelector('.phone-fab .dot-num')?.textContent ?? null,
}));
console.log('返回后:', JSON.stringify(afterBack));
await page.screenshot({ path: path.join(SHOTS, '102-phone-after-sms.png') });

// 关掉手机看岸边的手机图标红点
await page.evaluate(() => {
  const b = document.querySelector('.phone-fold');
  b?.click();
});
await sleep(700);
console.log('岸边手机图标:', JSON.stringify(await page.evaluate(() => ({
  fab: !!document.querySelector('.phone-fab'),
  dot: document.querySelector('.phone-fab .dot-num')?.textContent ?? null,
  any: !!document.querySelector('.phone-fab .dot-any'),
}))));
await page.screenshot({ path: path.join(SHOTS, '106-shore-unread.png') });

// 4) 四个独立 App 都能打开
const openApp = async (name) => {
  await page.evaluate((n) => {
    const i = [...document.querySelectorAll('.app-icon')].find((x) => (x.textContent || '').includes(n));
    i?.click();
  }, name);
  await sleep(500);
  const t = await page.evaluate(() => document.querySelector('.appbar .tt')?.textContent ?? null);
  await page.evaluate(() => document.querySelector('.appbar .back')?.click());
  await sleep(300);
  return t;
};
// 重新打开手机再测四个 App
await page.evaluate(() => document.querySelector('.phone-fab')?.click());
await sleep(600);
console.log('电话:', await openApp('电话'));
console.log('鱼博:', await openApp('鱼博'));
console.log('剧情:', await openApp('剧情'));

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
