import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';

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
});

await page.goto(URL, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(1400);
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

// 打完一局（不追求收益，只求走完阶段）
await page.mouse.click(215, 520);
let sawShoot = false;
for (let i = 0; i < 700; i++) {
  const st = await page.evaluate(() => ({
    phase: document.querySelector('[data-phase]')?.dataset.phase ?? null,
    result: !!document.querySelector('.result-total'),
  }));
  if (st.result) break;
  if (st.phase === 'descent') await page.mouse.move(215 + (i % 2 ? 60 : -60), 520);
  if (st.phase === 'shoot') {
    sawShoot = true;
    await page.mouse.click(215, 420);
  }
  await sleep(120);
}
console.log('sawShoot:', sawShoot);
console.log('save:', JSON.stringify(await page.evaluate((k)=>{const s=JSON.parse(localStorage.getItem(k)||'{}');return {trips:s.trips,messages:(s.messages||[]).length,last:(s.messages||[]).slice(-2).map(m=>m.thread+':'+m.text.slice(0,8)),queue:(s.queue||[]).map(q=>q.kind)};},'absurd-fishing-3d-save-v2')));

// 关掉结算
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('收下'));
  b?.click();
});
await sleep(700);

// 先接掉强/弱剧情，再观察「新应用」通知
const seen = new Set();
let last = null;
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => {
    const el = document.querySelector('.island');
    return {
      cls: el?.className ?? null,
      text: el?.innerText.replace(/\n/g, ' | ') ?? null,
      call: !!document.querySelector('.call'),
      result: !!document.querySelector('.result-total'),
      comic: !!document.querySelector('.comic'),
      phone: !!document.querySelector('.phone'),
    };
  });
  if (i > 44) console.log('  i=' + i, st.cls, '|', (st.text || '').slice(0, 40));
  if (i % 6 === 0) console.log('  queue:', JSON.stringify(await page.evaluate(() => window.__island?.map((x) => x.kind + ':' + x.uid))));
  if (st.text !== last) {
    last = st.text;
    if (st.text) console.log('island@' + i + ':', st.cls, '|', st.text);
    if (st.text && st.text.includes('新应用') && (st.cls || '').includes('open')) {
      await sleep(700);
      await page.screenshot({ path: path.join(SHOTS, '95-app-unlock.png') });
    }
  }
  // 有电话就接掉
  await page.evaluate(() => {
    const y = document.querySelector('.island .is-btn.yes');
    if (y) y.click();
  });
  // 通话里推两句
  await page.evaluate(() => {
    const lines = document.querySelector('.lines');
    if (lines) lines.click();
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('挂断'));
    if (b) b.click();
  });
  await sleep(500);
}
console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
