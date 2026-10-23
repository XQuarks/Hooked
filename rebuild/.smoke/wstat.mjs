import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { sleep } from './lib.mjs';
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage();
await page.setViewport({ width:430, height:900, deviceScaleFactor:1 });
await page.goto('file:///' + path.resolve('dist/index.html').replace(/\\/g,'/') + '#debug', {waitUntil:'load'});
await sleep(1000);
const out = await page.evaluate(()=>{
  const base = {
    map:'bay', hat:'straw', legend:false, maxDepth:500, hookCap:6, saw:0, lamp:0, fin:0,
    weapon:'pistol', aim:1, slow:0, moneyMult:1, jellyMult:1, speedMult:1, hotFish:'', bottlesHave:[], hints:{},
  };
  const res = {};
  for (const w of ['clear','cloudy','rain','fog','storm']) {
    let total=0, N=60;
    for(let i=0;i<N;i++){
      window.__af.spawn({...base, weather:w});
      total += window.__af.plan.length;
    }
    res[w] = +(total/N).toFixed(1);
  }
  return res;
});
console.log('平均刷鱼数（60 次，bay 500m）:', JSON.stringify(out));
await browser.close();
