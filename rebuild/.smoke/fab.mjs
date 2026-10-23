import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { sleep } from './lib.mjs';
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage();
await page.setViewport({ width:430, height:900, deviceScaleFactor:2 });
await page.goto('file:///' + path.resolve('dist/index.html').replace(/\\/g,'/') + '#debug', {waitUntil:'load'});
await page.evaluate(()=>localStorage.clear());
await page.reload({waitUntil:'load'}); await sleep(900);
const seed = async (queue) => {
  await page.evaluate((queue)=>{
    const k='absurd-fishing-3d-save-v2';const s=JSON.parse(localStorage.getItem(k));
    s.map='bay';s.weather='clear';s.unlocked=['bay'];s.trips=1;s.money=8420;
    s.fired=['prologue','kevin','north','ending','intro','introAfterFirst','firstTrip'];
    s.queue=queue;
    localStorage.setItem(k,JSON.stringify(s));
  }, queue);
  await page.reload({waitUntil:'load'}); await sleep(900);
  await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>/开始|继续/.test(x.textContent||''))?.click()});
  await sleep(500);
  await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('跳过'))?.click()});
  await sleep(1200);
};
await seed([]);
const normal = await page.evaluate(()=>{
  const f=document.querySelector('.phone-fab'); const b=document.querySelector('.pf-body');
  const r=b?.getBoundingClientRect(); const cs=f?getComputedStyle(f):null;
  return {fab:!!f, ring: f?.classList.contains('ringing'), body: r?{w:Math.round(r.width),h:Math.round(r.height)}:null, anim: b?getComputedStyle(b).animationName:null, cs: cs?.width};
});
console.log('无来电:', JSON.stringify(normal));
await page.screenshot({path:'.smoke/shots/F-normal.png'});

await seed([{uid:'call_test',kind:'call',from:'cuihua',topic:'渔具店的熟人',lines:[{text:'喂？'}],tier:'main'}]);
const ring = await page.evaluate(()=>{
  const f=document.querySelector('.phone-fab'); const b=document.querySelector('.pf-body');
  return {ring: f?.classList.contains('ringing'), anim: b?getComputedStyle(b).animationName:null, halo: f?getComputedStyle(f,'::after').animationName:null, tf: b?getComputedStyle(b).transform:null};
});
console.log('来电:', JSON.stringify(ring));
await page.screenshot({path:'.smoke/shots/F-ring1.png'});
await sleep(60);
await page.screenshot({path:'.smoke/shots/F-ring2.png'});
await sleep(60);
await page.screenshot({path:'.smoke/shots/F-ring3.png'});
await sleep(60);
await page.screenshot({path:'.smoke/shots/F-ring4.png'});
console.log('tf2:', await page.evaluate(()=>getComputedStyle(document.querySelector('.pf-body')).transform));
await browser.close();
