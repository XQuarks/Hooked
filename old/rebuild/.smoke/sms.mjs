import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { skipStory, castOff } from './lib.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const SHOTS = path.resolve('.smoke/shots');
const URL = 'file:///' + HTML.replace(/\\/g, '/') + '#debug';
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
  if (m.text().includes('[island]')) console.log('  log', m.text());
});

const phase = () => page.evaluate(() => document.querySelector('.hud-layer')?.getAttribute('data-phase') ?? null);
const island = () =>
  page.evaluate(() => {
    const el = document.querySelector('.island');
    if (!el) return null;
    return { cls: el.className, open: el.classList.contains('open'), text: el.innerText.replace(/\n/g, ' | ') };
  });

await page.goto(URL, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(1400);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('开始'));
  b?.click();
});
await sleep(700);
await skipStory(page, 6);
await castOff(page);

// 等到这一局结束
for (let i = 0; i < 90; i++) {
  if ((await phase()) === 'idle') break;
  await sleep(500);
}
console.log('一局结束, phase =', await phase());

// 收下结算
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('收下'));
  b?.click();
});
await sleep(900);

const first = await island();
console.log('首局后岛:', JSON.stringify(first));
await page.screenshot({ path: path.join(SHOTS, '84-island-after-trip.png') });

// 如果是来电，接听后结束，看后续短信条
if (first && first.cls.includes('k-call')) {
  await page.evaluate(() => document.querySelector('.is-btn.yes')?.click());
  await sleep(600);
  for (let i = 0; i < 12; i++) {
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
  await sleep(800);
  console.log('通话后岛:', JSON.stringify(await island()));
  await page.screenshot({ path: path.join(SHOTS, '86-island-sms.png') });
  await page.screenshot({ path: path.join(SHOTS, '85-island-after-call.png') });
}

// 连拍几帧，看短信条是否会自动消失
for (let i = 0; i < 6; i++) {
  await sleep(1500);
  const it = await island();
  console.log(`+${(i + 1) * 1.5}s 岛:`, it ? it.cls + ' | ' + it.text.slice(0, 46) : 'null');
}

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
