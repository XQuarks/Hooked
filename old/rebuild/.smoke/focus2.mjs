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
for(let i=0;i<50;i++){ await sleep(250); const p=await page.evaluate(()=>window.__af?.debugState?.().phase); if(p==='shoot') break; }
await sleep(900);
// 把第二条鱼设成血厚，然后连续 damage 它
const ok = await page.evaluate(()=>{
  const a=window.__af;
  const f=a.air.find(x=>x.state==='fly');
  if(!f) return false;
  f.hp = 60;
  a.__target = f;
  return true;
});
console.log('准备:', ok);
const rows=[];
for(let i=0;i<6;i++){
  await page.evaluate(()=>{ const a=window.__af; a.damage(a.__target, 1, a.cfg); });
  await sleep(420);
  const r = await page.evaluate(()=>{const a=window.__af; const f=a.__target; return {fishY:+f.y.toFixed(1), focus:+a.focusY.toFixed(1), ft:+f.focusT.toFixed(2), hp:f.hp, zoom:+(a.stage.zoomNow||0).toFixed(2)};});
  rows.push(r);
}
console.log(JSON.stringify(rows));
await page.screenshot({path:'.smoke/shots/J-focus2.png'});
await browser.close();
