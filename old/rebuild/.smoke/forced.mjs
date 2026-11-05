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

const snap = () =>
  page.evaluate(() => {
    const el = document.querySelector('.island');
    return {
      island: el
        ? {
            cls: el.className,
            text: el.innerText.replace(/\n/g, ' | '),
            w: Math.round(el.getBoundingClientRect().width),
          }
        : null,
      veil: !!document.querySelector('.force-veil'),
      hud: !!document.querySelector('.hud-layer'),
      decline: !!document.querySelector('.is-btn.no'),
      acceptLabel: document.querySelector('.is-btn.yes')?.textContent ?? null,
    };
  });

// 1) 新档 → 进游戏 → 跳过漫画
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
await sleep(800);

// 2) 注入「已潜到 130 米」，触发 d120 的强制来电（顺手把前面的事件标成已播）
await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k));
  s.trips = 2;
  s.money = 300;
  s.totalEarned = 300;
  s.maxDepth.bay = 130;
  s.fired = ['intro', 'introAfterFirst'];
  localStorage.setItem(k, JSON.stringify(s));
}, KEY);
await page.reload({ waitUntil: 'load' });
await sleep(1500);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('继续'));
  b?.click();
});
await sleep(1600);

console.log('强制来电态:', JSON.stringify(await snap()));
await page.screenshot({ path: path.join(SHOTS, '90-forced-call.png') });

// 3) 点接听 → 直接进通话（不再二次来电）
await page.evaluate(() => document.querySelector('.is-btn.yes')?.click());
await sleep(800);
const inCall = await page.evaluate(() => ({
  call: !!document.querySelector('.call'),
  lines: !!document.querySelector('.lines'),
  st: document.querySelector('.call .st')?.textContent ?? null,
  veil: !!document.querySelector('.force-veil'),
}));
console.log('接听后:', JSON.stringify(inCall));
await page.screenshot({ path: path.join(SHOTS, '91-forced-talk.png') });

// 4) 推完对话并挂断
for (let i = 0; i < 20; i++) {
  const alive = await page.evaluate(() => !!document.querySelector('.call'));
  if (!alive) break;
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const end = btns.find((b) => (b.textContent || '').includes('挂断'));
    if (end) {
      end.click();
      return;
    }
    const lines = document.querySelector('.lines');
    if (lines) {
      lines.click();
      return;
    }
    const ans = btns.find((b) => (b.textContent || '').includes('接听'));
    ans?.click();
  });
  await sleep(320);
}
await sleep(900);

const after = await snap();
console.log('通话结束后:', JSON.stringify(after));
const log = await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k) || '{}');
  return { calls: s.calls, queue: (s.queue || []).map((q) => q.kind + ':' + (q.force ? 'force' : 'normal')) };
}, KEY);
console.log('通话记录:', JSON.stringify(log));
await page.screenshot({ path: path.join(SHOTS, '92-forced-done.png') });

// 5) 手机里应该有这条通话记录
await page.evaluate(() => {
  const b = (document.querySelector('.phone-fab') ?? [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('手机')));
  b?.click();
});
await sleep(800);
const opened = await page.evaluate(() => {
  const i = [...document.querySelectorAll('.app-icon')].find((x) => (x.textContent || '').includes('电话'));
  if (!i) return false;
  i.click();
  return true;
});
await sleep(900);
const logUi = await page.evaluate(
  () => document.querySelector('.call-log')?.innerText.replace(/\n/g, ' | ') ?? null,
);
console.log('通话记录 UI:', JSON.stringify(logUi), 'opened=', opened);
console.log('phone open:', await page.evaluate(() => !!document.querySelector('.phone')), 'call:', await page.evaluate(() => !!document.querySelector('.call')));
await page.screenshot({ path: path.join(SHOTS, '93-call-log.png') });

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
