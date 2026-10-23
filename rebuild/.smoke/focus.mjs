import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { sleep } from './lib.mjs';
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage();
await page.setViewport({ width:430, height:900, deviceScaleFactor:2 });
await page.goto('file://' + path.resolve('dist/index.html').replace(/\\/g,'/') + '#debug', {waitUntil:'load'});
await page.evaluate(()=>localStorage.clear());
await page.reload({waitUntil:'load'}); await sleep(900);
await page.evaluate(()=>{const k='absurd-fishing-3d-save-v2';const s=JSON.parse(localStorage.getItem(k));s.map='bay';s.weather='clear';s.unlocked=['bay'];s.trips=3;localStorage.setItem(k,JSON.stringify(s));});
await page.reload({waitUntil:'load'}); await sleep(900);
await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>/开始|继续/.test(x.textContent||''))?.click()});
await sleep(500);
await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('跳过'))?.click()});
await sleep(1000);
await page.mouse.click(215,560);
for(let i=0;i<50;i++){ await sleep(300); const p=await page.evaluate(()=>window.__af?.debugState?.().phase); if(p==='shoot') break; }
const setup = await page.evaluate(()=>{
  const a=window.__af;
  const f=a.air.find(x=>x.state==='fly');
  if(!f) return null;
  for (const o of a.air) { o.vy=0; o.vx=0; o.y=2; o.delay=0; o.focusT=0; }
  f.y=60; f.focusT=1.5;
  return {n:a.air.length};
});
console.log('setup:', JSON.stringify(setup));
await sleep(900);
const r = await page.evaluate(()=>{const a=window.__af; const f=a.air.find(x=>x.focusT>0) ?? a.air[0]; const s=a.stage.worldToScreen(f.x,f.y); return {focus:+a.focusY.toFixed(1), fishY:+f.y.toFixed(1), screenY:Math.round(s.y)};});
console.log('focus 后:', JSON.stringify(r));
await page.screenshot({path:'.smoke/shots/J-focus.png'});
await browser.close();
