/** 天气：8 种天各截一张岸边图，并记录刷鱼数量/浪高 */
import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { sleep } from './lib.mjs';

const SHOTS = path.resolve('.smoke/shots');
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage();
await page.setViewport({ width:430, height:900, deviceScaleFactor:2 });
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto('file:///' + path.resolve('dist/index.html').replace(/\\/g,'/') + '#debug', {waitUntil:'load'});
await page.evaluate(()=>localStorage.clear());
await page.reload({waitUntil:'load'});
await sleep(900);

const list = [
  ['bay','clear'],['bay','cloudy'],['bay','rain'],['bay','fog'],['bay','storm'],
  ['ice','aurora'],['ice','blizzard'],['ice','iceclear'],
];
for (const [map, weather] of list) {
  await page.evaluate((map, weather) => {
    const k='absurd-fishing-3d-save-v2';
    let s=null; try{s=JSON.parse(localStorage.getItem(k))}catch{}
    if(!s){localStorage.clear();location.reload();return;}
    s.unlocked=['bay','ice']; s.map=map; s.weather=weather; s.trips=8; s.money=12000;
    s.maxDepth={bay:128,ice:320};
    s.fired=['prologue','kevin','north','ending','intro','introAfterFirst','firstTrip','d60','money400','trip3','jelly1','d120','bottle1','species7','d200','goldfish','iceHint','unlockReady','iceUnlocked','iceTrip1','ice300','legend','allSpecies'];
    s.queue=[]; s.hints={...s.hints, descent:true};
    localStorage.setItem(k, JSON.stringify(s));
  }, map, weather);
  await page.reload({waitUntil:'load'});
  await sleep(900);
  await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>/开始|继续/.test(x.textContent||''))?.click()});
  await sleep(600);
  await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('跳过'))?.click()});
  await sleep(1300);
  const st = await page.evaluate(()=>window.__af?.debugState?.());
  console.log(weather, JSON.stringify({fish: st?.fish, sea: st?.sea, weather: st?.weather}));
  await page.screenshot({path: path.join(SHOTS, `W-${weather}.png`)});
  // 抛竿后读刷鱼数（spawn 在 startTrip 里跑）
  await page.mouse.click(215, 520);
  await sleep(300);
  const st2 = await page.evaluate(()=>window.__af?.debugState?.());
  console.log('  cast:', JSON.stringify({fish: st2?.fish, weather: st2?.weather, sea: st2?.sea}));
}
console.log('errors:', errs.length, errs.slice(0,3));
await browser.close();
