import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { sleep } from './lib.mjs';
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage();
await page.setViewport({ width:430, height:900, deviceScaleFactor:2 });
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
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
for(let i=0;i<50;i++){ await sleep(250); const p=await page.evaluate(()=>window.__af?.debugState?.().phase); if(p==='shoot') break; }
await sleep(700);
const rows=[];
for(let i=0;i<10;i++){
  const t = await page.evaluate(()=>{
    const d=window.__af.debugState();
    const a=d.air[0];
    if(!a) return null;
    const s=window.__af.stage.worldToScreen(a.x,a.y);
    return {x:Math.round(s.x),y:Math.round(s.y),ay:+a.y.toFixed(1),hp:a.hp,state:a.state,shots:d.shots,focus:+window.__af.focusY.toFixed(1)};
  });
  if(!t) break;
  rows.push(t);
  await page.mouse.click(t.x,t.y);
  await sleep(260);
}
console.log(JSON.stringify(rows));
console.log('errors:', errs.length, errs.slice(0,2));
await page.screenshot({path:'.smoke/shots/J-juggle.png'});
await browser.close();
