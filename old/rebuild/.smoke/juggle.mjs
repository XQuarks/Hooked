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
await page.evaluate(()=>{const k='absurd-fishing-3d-save-v2';const s=JSON.parse(localStorage.getItem(k));s.map='bay';s.weather='clear';s.unlocked=['bay'];s.trips=3;s.maxDepth={bay:150};localStorage.setItem(k,JSON.stringify(s));});
await page.reload({waitUntil:'load'}); await sleep(900);
await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>/开始|继续/.test(x.textContent||''))?.click()});
await sleep(500);
await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('跳过'))?.click()});
await sleep(1000);
await page.mouse.click(215,560);
for(let i=0;i<50;i++){ await sleep(300); const p=await page.evaluate(()=>window.__af?.debugState?.().phase); if(p==='shoot') break; }
// 锁定一条鱼，连续点它：用真实点击路径，不直接改状态
const logs=[];
for (let i=0;i<14;i++){
  const pos = await page.evaluate(()=>{
    const a=window.__af;
    const f=a.air.find(x=>x.state==='fly' && x.sp.value>0);
    if(!f) return null;
    const s=a.stage.worldToScreen(f.x,f.y);
    return {x:Math.round(s.x), y:Math.round(s.y), fy:+a.focusY.toFixed(1), ay:+f.y.toFixed(1), hp:f.hp, ft:+f.focusT.toFixed(2)};
  });
  if(!pos) break;
  logs.push(pos);
  await page.mouse.click(pos.x, pos.y);
  await sleep(240);
}
console.log(JSON.stringify(logs));
const end = await page.evaluate(()=>{const a=window.__af; return {focus:+a.focusY.toFixed(1), phase:a.phase, y:Math.max(...a.air.filter(f=>f.state==='fly').map(f=>f.y),0)};});
console.log('end:', JSON.stringify(end));
await page.screenshot({path:'.smoke/shots/J-high.png'});
console.log('errors:', errs.length, errs.slice(0,2));
await browser.close();
