import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const SHOTS = path.resolve('.smoke/shots');
const URL = 'file:///' + HTML.replace(/\\/g, '/');
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

const islandState = () =>
  page.evaluate(() => {
    const el = document.querySelector('.island');
    if (!el) return null;
    return {
      cls: el.className,
      open: el.classList.contains('open'),
      text: el.innerText.replace(/\n/g, ' | '),
      w: Math.round(el.getBoundingClientRect().width),
      h: Math.round(el.getBoundingClientRect().height),
    };
  });

// 1) 开新档，只跳过漫画
await page.goto(URL, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(1400);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('开始'));
  b?.click();
});
await sleep(700);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('跳过'));
  b?.click();
});
await sleep(600);
console.log('开场后岛:', JSON.stringify(await islandState()));

// 2) 注入「已打完第一局」，让 introAfterFirst 的来电进来
await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k));
  s.trips = 1;
  s.money = 120;
  s.totalEarned = 120;
  localStorage.setItem(k, JSON.stringify(s));
}, KEY);
await page.reload({ waitUntil: 'load' });
await sleep(1500);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('继续'));
  b?.click();
});
await sleep(1200);

console.log('来电岛:', JSON.stringify(await islandState()));
await page.screenshot({ path: path.join(SHOTS, '80-island-call.png') });

// 2.5) 先拒绝一次：应记一笔「未接」，5 秒后自己弹回来
await page.evaluate(() => document.querySelector('.is-btn.no')?.click());
await sleep(500);
const missedLog = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').calls, KEY);
console.log('拒绝后通话记录:', JSON.stringify(missedLog));
await sleep(5400);
console.log('5.4 秒后岛:', JSON.stringify(await islandState()));

// 3) 接听 → 应该转成全屏通话
await page.evaluate(() => document.querySelector('.is-btn.yes')?.click());
await sleep(900);
const fullCall = await page.evaluate(() => ({
  call: !!document.querySelector('.call'),
  island: !!document.querySelector('.island'),
}));
console.log('接听后:', JSON.stringify(fullCall));
await page.screenshot({ path: path.join(SHOTS, '81-island-accepted.png') });

// 4) 挂断/结束通话，岛应显示下一条（公告）
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const pick = ['结束通话', '挂断', '知道了', '继续', '接听'].map((t) => btns.find((b) => (b.textContent || '').includes(t))).find(Boolean);
  if (pick) pick.click();
});
await sleep(600);
// 推进剩余对话
for (let i = 0; i < 10; i++) {
  const has = await page.evaluate(() => !!document.querySelector('.call'));
  if (!has) break;
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const pick = ['结束通话', '挂断', '知道了', '继续'].map((t) => btns.find((b) => (b.textContent || '').includes(t))).find(Boolean);
    if (pick) pick.click();
    else document.querySelector('.lines')?.click();
  });
  await sleep(300);
}
await sleep(700);
console.log('通话结束后岛:', JSON.stringify(await islandState()));
await page.screenshot({ path: path.join(SHOTS, '82-island-notice.png') });

// 5) 等 9 秒，公告应收成胶囊
await sleep(9000);
const pill = await islandState();
console.log('公告 9s 后:', JSON.stringify(pill));
await page.screenshot({ path: path.join(SHOTS, '83-island-pill.png') });

// 6) 接听之后，通话记录应从「未接」升级为「已接」
const finalCalls = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').calls, KEY);
console.log('最终通话记录:', JSON.stringify(finalCalls));

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
