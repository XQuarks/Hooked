import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { sleep } from './lib.mjs';
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage();
await page.setViewport({ width:430, height:900, deviceScaleFactor:2 });
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto('file:///' + path.resolve('dist/index.html').replace(/\\/g,'/') + '#debug', {waitUntil:'load'});
await page.evaluate(()=>localStorage.clear());
await page.reload({waitUntil:'load'}); await sleep(900);
await page.evaluate(()=>{
  const k='absurd-fishing-3d-save-v2';const s=JSON.parse(localStorage.getItem(k));
  s.map='bay';s.weather='clear';s.unlocked=['bay'];s.trips=1; s.fired=['prologue','kevin','north','ending','intro','introAfterFirst','firstTrip'];
  s.queue=[{uid:'call_test',kind:'call',from:'cuihua',topic:'渔具店的熟人',lines:[{text:'喂？是海家的小子吧？'},{text:'你爷爷欠我二十年鱼线钱。'}],tier:'main'}];
  localStorage.setItem(k,JSON.stringify(s));
});
await page.reload({waitUntil:'load'}); await sleep(900);
await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>/开始|继续/.test(x.textContent||''))?.click()});
await sleep(500);
await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('跳过'))?.click()});
await sleep(1200);
const before = await page.evaluate(()=>({ring:document.querySelector('.phone-fab')?.classList.contains('ringing'), island:!!document.querySelector('.island.k-call')}));
console.log('点之前:', JSON.stringify(before));
await page.evaluate(()=>document.querySelector('.phone-fab')?.click());
await sleep(700);
const after = await page.evaluate(()=>({
  call: !!document.querySelector('.call'),
  phone: !!document.querySelector('.phone'),
  ring: document.querySelector('.phone-fab')?.classList.contains('ringing') ?? null,
  text: document.querySelector('.call')?.innerText.replace(/\n/g,' | ').slice(0,80),
}));
console.log('点手机之后:', JSON.stringify(after));
await page.screenshot({path:'.smoke/shots/A-answer.png'});
console.log('errors:', errs.length, errs.slice(0,2));
await browser.close();
