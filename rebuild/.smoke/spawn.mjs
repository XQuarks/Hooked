import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { skipStory, castOff } from './lib.mjs';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML=path.resolve('dist/index.html');
const KEY='absurd-fishing-3d-save-v2';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage();
await page.setViewport({width:430,height:900,deviceScaleFactor:1});
const errs=[];
page.on('pageerror',(e)=>errs.push(e.message));
await page.goto('file:///'+HTML.replace(/\\/g,'/')+'#debug',{waitUntil:'load'});
await page.evaluate(()=>localStorage.clear());
await page.reload({waitUntil:'load'});
await sleep(1100);
await page.evaluate((k)=>{const s=JSON.parse(localStorage.getItem(k));s.unlocked=['bay','ice'];s.map='bay';s.up={line:7,saw:3,hook:5,lamp:4,fin:3,scope:2,slowmo:1};localStorage.setItem(k,JSON.stringify(s));},KEY);
await page.reload({waitUntil:'load'});
await sleep(1000);
await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('开始')||(x.textContent||'').includes('继续'));b?.click();});
await sleep(600);
await skipStory(page);
await castOff(page);
await sleep(400);

const res = await page.evaluate(() => {
  const e = window.__af;
  const base = e.cfg;
  const run = (weather, map) => {
    let total=0, school=0, rare=0, hunt=0;
    for (let i=0;i<24;i++){
      e.spawn({ ...base, map, weather });
      for (const p of e.plan) {
        total++;
        if (p.sp.behavior === 'school') school++;
        if (p.sp.behavior === 'hunt') hunt++;
        if (p.sp.hp >= 5 || p.sp.value >= 150) rare++;
      }
    }
    return { total, school: +(school/total*100).toFixed(1), hunt: +(hunt/total*100).toFixed(1), rare: +(rare/total*100).toFixed(1) };
  };
  return {
    bay_clear: run('clear','bay'),
    bay_rain: run('rain','bay'),
    bay_fog: run('fog','bay'),
  };
});
console.log('阳光湾分布:', JSON.stringify(res.bay_clear), JSON.stringify(res.bay_rain), JSON.stringify(res.bay_fog));
console.log('errors:', errs.length);
await browser.close();
