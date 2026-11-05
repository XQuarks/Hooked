/** 本轮验证：标题位置/字号、金币条底框、手机宽度、系统通知不重复且可点 */
import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { sleep } from './lib.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');
const SHOTS = path.resolve('.smoke/shots');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 140));
});

await page.goto('file:///' + HTML.replace(/\\/g, '/') + '#debug', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(600);
// 把剧情事件全部标记为已触发，避免第 1 趟的「翠花姐来电」把系统通知挤到后面
await page.evaluate(() => {
  const k = 'absurd-fishing-3d-save-v2';
  const s = JSON.parse(localStorage.getItem(k));
  s.trips = 0;
  s.unlocked = ['bay'];
  s.money = 8420;
  s.queue = [];
  s.fired = ['prologue','kevin','north','ending','intro','introAfterFirst','firstTrip','d60','money400','trip3','jelly1','d120','bottle1','species7','d200','goldfish','iceHint','unlockReady','iceUnlocked','iceTrip1','ice300','legend','allSpecies'];
  localStorage.setItem(k, JSON.stringify(s));
});
await page.reload({ waitUntil: 'load' });
await sleep(1000);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /开始|继续/.test(x.textContent || ''));
  b?.click();
});
await sleep(700);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('跳过'));
  b?.click();
});
await sleep(1000);

// ── 1. 岸边：标题位置 / 字号，金币条底框
const shore = await page.evaluate(() => {
  const t = document.querySelector('.hud-map');
  const b = t?.querySelector('b');
  const tr = t?.getBoundingClientRect();
  const br = b?.getBoundingClientRect();
  const mb = document.querySelector('.money-bar');
  const cs = mb ? getComputedStyle(mb, '::before') : null;
  return {
    titleRect: tr ? { x: Math.round(tr.x), y: Math.round(tr.y), w: Math.round(tr.width), h: Math.round(tr.height) } : null,
    titleSize: b ? getComputedStyle(b).fontSize : null,
    titleTextW: br ? Math.round(br.width) : null,
    moneyBg: cs?.backgroundColor,
    moneyBorder: cs?.borderTopColor,
    moneyRadius: cs?.borderRadius,
    moneySkew: cs?.transform,
  };
});
console.log('岸边:', JSON.stringify(shore));
await page.screenshot({ path: path.join(SHOTS, 'C1-shore.png') });

// ── 2. 手机：宽度 / 高度 / 位置
await page.evaluate(() => document.querySelector('.phone-fab')?.click());
await sleep(1200);
const phone = await page.evaluate(() => {
  const p = document.querySelector('.phone');
  const r = p?.getBoundingClientRect();
  const stage = document.querySelector('.stage')?.getBoundingClientRect();
  const wrap = document.querySelector('.phone-wrap')?.getBoundingClientRect();
  return {
    w: r ? Math.round(r.width) : null,
    h: r ? Math.round(r.height) : null,
    top: r ? Math.round(r.top) : null,
    left: r ? Math.round(r.left) : null,
    bottom: r ? Math.round(r.bottom) : null,
    wRatio: r ? +(r.width / innerWidth).toFixed(2) : null,
    hRatio: r ? +(r.height / innerHeight).toFixed(2) : null,
    stage: stage ? { h: Math.round(stage.height), bottom: Math.round(stage.bottom) } : null,
    wrap: wrap ? { h: Math.round(wrap.height), bottom: Math.round(wrap.bottom) } : null,
  };
});
console.log('手机:', JSON.stringify(phone));
await page.screenshot({ path: path.join(SHOTS, 'C2-phone.png') });
await page.evaluate(() => document.querySelector('.phone-fold')?.click());
await sleep(500);

// ── 3. 结算一局：解锁鱼博 + 渔具，应只弹一条系统通知
await page.evaluate(() => window.__af?.finish());
await sleep(900);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('收下'));
  b?.click();
});
await sleep(900);
const isl1 = await page.evaluate(() => {
  const el = document.querySelector('.island');
  return { cls: el?.className, text: el?.innerText.replace(/\n/g, ' | ') };
});
console.log('解锁后:', JSON.stringify(isl1));
await page.screenshot({ path: path.join(SHOTS, 'C3-unlock.png') });

// ── 4. 开手机再关：回来应是收起的小胶囊，不再整块弹开
await page.evaluate(() => document.querySelector('.phone-fab')?.click());
await sleep(600);
const hiddenCls = await page.evaluate(() => document.querySelector('.island')?.className);
await page.evaluate(() => document.querySelector('.phone-fold')?.click());
await sleep(700);
const isl2 = await page.evaluate(() => {
  const el = document.querySelector('.island');
  return {
    cls: el?.className,
    open: el?.classList.contains('open'),
    text: el?.innerText.replace(/\n/g, ' | '),
  };
});
console.log('开关手机后:', JSON.stringify({ hiddenCls, isl2 }));
await page.screenshot({ path: path.join(SHOTS, 'C4-pill.png') });

// ── 5. 点收起的胶囊：应打开手机通知栏并展开这条
await page.evaluate(() => document.querySelector('.island')?.click());
await sleep(800);
const afterTap = await page.evaluate(() => {
  const bar = document.querySelector('.appbar .tt')?.textContent;
  const openRow = document.querySelector('.ntf.on');
  return {
    phone: !!document.querySelector('.phone'),
    appTitle: bar,
    openRowText: openRow?.innerText.replace(/\n/g, ' | ') ?? null,
  };
});
console.log('点胶囊后:', JSON.stringify(afterTap));
await page.screenshot({ path: path.join(SHOTS, 'C5-notify.png') });

// ── 6. 关手机后再等一会：不应该再自己弹开
await page.evaluate(() => document.querySelector('.phone-fold')?.click());
await sleep(2500);
const isl3 = await page.evaluate(() => {
  const el = document.querySelector('.island');
  return { cls: el?.className ?? null, open: el?.classList.contains('open') ?? null };
});
console.log('稍等后:', JSON.stringify(isl3));

console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
