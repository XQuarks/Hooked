import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { sleep } from './lib.mjs';

const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage();
await page.setViewport({ width:430, height:900, deviceScaleFactor:1 });
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto('file:///' + path.resolve('dist/index.html').replace(/\\/g,'/') + '#debug', {waitUntil:'load'});
await page.evaluate(()=>localStorage.clear());
await page.reload({waitUntil:'load'}); await sleep(900);
await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>/开始|继续/.test(x.textContent||''))?.click()});
await sleep(600);
await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('跳过'))?.click()});
await sleep(900);

// 顶部元素是否挡住 canvas？
console.log('hit at 215,450:', await page.evaluate(()=>{
  const el=document.elementFromPoint(215,450);
  return el ? el.tagName+'.'+el.className : null;
}));
console.log('hit at 215,600:', await page.evaluate(()=>{
  const el=document.elementFromPoint(215,600);
  return el ? el.tagName+'.'+el.className : null;
}));

// 抛竿
await page.mouse.click(215, 500);
await sleep(300);
console.log('after click phase:', await page.evaluate(()=>window.__af?.debugState?.().phase));

// 等进入下潜
for (let i=0;i<40;i++){ await sleep(300); const p=await page.evaluate(()=>window.__af?.debugState?.().phase); if(p==='descent') break; }
console.log('phase now:', await page.evaluate(()=>window.__af?.debugState?.().phase));
const x0 = await page.evaluate(()=>window.__af?.targetX);
await page.mouse.move(90, 500);
await sleep(200);
await page.mouse.move(90, 520);
await sleep(400);
const x1 = await page.evaluate(()=>window.__af?.targetX);
console.log('targetX:', x0, '->', x1);
await page.screenshot({path:'.smoke/shots/D1-descent.png'});

// 等到射击阶段，点画面开枪
for (let i=0;i<80;i++){ await sleep(500); const p=await page.evaluate(()=>window.__af?.debugState?.().phase); if(p==='shoot') break; }
const st = await page.evaluate(()=>window.__af?.debugState?.());
console.log('shoot start:', JSON.stringify({phase:st.phase, shots:st.shots, air:st.air.length}));
for (let i=0;i<6;i++){ await page.mouse.click(215 - i*20, 420); await sleep(160); }
const st2 = await page.evaluate(()=>window.__af?.debugState?.());
console.log('after clicks:', JSON.stringify({phase:st2.phase, shots:st2.shots, gross:st2.gross, kills:st2.kills}));
console.log('errors:', errs.length, errs.slice(0,3));
await browser.close();
