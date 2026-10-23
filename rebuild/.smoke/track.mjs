import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { sleep } from './lib.mjs';
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage();
await page.setViewport({ width:430, height:900, deviceScaleFactor:1 });
await page.goto('file:///' + path.resolve('dist/index.html').replace(/\\/g,'/') + '#debug', {waitUntil:'load'});
await page.evaluate(()=>localStorage.clear());
await page.reload({waitUntil:'load'}); await sleep(900);
await page.evaluate(()=>{const k='absurd-fishing-3d-save-v2';const s=JSON.parse(localStorage.getItem(k));s.map='bay';s.weather='clear';s.unlocked=['bay'];s.trips=3;localStorage.setItem(k,JSON.stringify(s));});
await page.reload({waitUntil:'load'}); await sleep(900);
await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>/开始|继续/.test(x.textContent||''))?.click()});
await sleep(500);
await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('跳过'))?.click()});
await sleep(900);
await page.evaluate(()=>{
  window.__rec=[];
  const a=window.__af;
  const rec=()=>{
    if(a.phase==='cast'||a.phase==='descent') {
      const s=a.stage.worldToScreen(a.lure.x, a.lure.y);
      const tip=a.world.rodTip();
      const ts=a.stage.worldToScreen(tip.x, tip.y);
      window.__rec.push({t:+a.castT.toFixed(3), ph:a.phase, x:+s.x.toFixed(1), y:+s.y.toFixed(1), tx:+ts.x.toFixed(1), ty:+ts.y.toFixed(1), ly:+a.lure.y.toFixed(2)});
    }
    requestAnimationFrame(rec);
  };
  rec();
});
await page.mouse.click(120, 560);
await sleep(2200);
const rec = await page.evaluate(()=>window.__rec);
console.log('frames', rec.length);
console.log(JSON.stringify(rec.filter((_,i)=>i%3===0).slice(0,28)));
let maxJump=0, jumpAt=null, reversals=0, lastDir=0;
for(let i=1;i<rec.length;i++){
  const d=Math.hypot(rec[i].x-rec[i-1].x, rec[i].y-rec[i-1].y);
  if(d>maxJump){maxJump=d;jumpAt=rec[i];}
  const dir=Math.sign(rec[i].y-rec[i-1].y);
  if(lastDir && dir && dir!==lastDir) reversals++;
  if(dir) lastDir=dir;
}
console.log('最大单帧位移(px):', maxJump.toFixed(1), jumpAt);
console.log('屏幕上 y 方向反转次数:', reversals);
await browser.close();
