import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { sleep } from './lib.mjs';
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage();
await page.setViewport({ width:430, height:900, deviceScaleFactor:2 });
await page.goto('file:///' + path.resolve('dist/index.html').replace(/\\/g,'/') + '#debug', {waitUntil:'load'});
await page.evaluate(()=>localStorage.clear());
await page.reload({waitUntil:'load'}); await sleep(900);
await page.evaluate(()=>{const k='absurd-fishing-3d-save-v2';const s=JSON.parse(localStorage.getItem(k));s.map='bay';s.weather='storm';s.unlocked=['bay'];s.trips=3;s.queue=[];s.hired=[];s.fired=['prologue','kevin','north','ending','intro','introAfterFirst','firstTrip','d60','money400','trip3'];localStorage.setItem(k,JSON.stringify(s));});
await page.reload({waitUntil:'load'}); await sleep(900);
await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>/开始|继续/.test(x.textContent||''))?.click()});
await sleep(500);
await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('跳过'))?.click()});
await sleep(1200);
const vals=[];
for(let i=0;i<70;i++){
  const v = await page.evaluate(()=>{
    const c=document.querySelector('canvas'); const g=c.getContext('2d');
    const d=g.getImageData(Math.floor(c.width*0.5), Math.floor(c.height*0.22), 1, 1).data;
    return [d[0],d[1],d[2]];
  });
  const lum = v[0]+v[1]+v[2];
  vals.push(lum);
  if (lum > 390) { console.log('flash at', i, v); await page.screenshot({path:'.smoke/shots/W-storm-flash.png'}); break; }
  await sleep(90);
}
console.log('lum min/max:', Math.min(...vals), Math.max(...vals), 'n', vals.length);
await browser.close();
