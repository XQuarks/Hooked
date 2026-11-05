import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { sleep } from './lib.mjs';
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
for (const [w,h,name] of [[375,667,'small'],[520,940,'wide']]) {
  const page = await browser.newPage();
  await page.setViewport({ width:w, height:h, deviceScaleFactor:1 });
  await page.goto('file:///' + path.resolve('dist/index.html').replace(/\\/g,'/') + '#debug', {waitUntil:'load'});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:'load'}); await sleep(900);
  await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>/开始|继续/.test(x.textContent||''))?.click()});
  await sleep(500);
  await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('跳过'))?.click()});
  await sleep(900);
  await page.evaluate(()=>document.querySelector('.phone-fab')?.click());
  await sleep(1200);
  const m = await page.evaluate(()=>{
    const p=document.querySelector('.phone').getBoundingClientRect();
    const bar=document.querySelector('.phone-bar')?.getBoundingClientRect();
    const body=document.querySelector('.phone-body');
    return {phone:[Math.round(p.width),Math.round(p.height),Math.round(p.top)], barBottom:Math.round(bar.bottom), scroll:[body.clientHeight, body.scrollHeight]};
  });
  console.log(name, JSON.stringify(m));
  await page.screenshot({path:`.smoke/shots/R-${name}.png`});
  await page.close();
}
await browser.close();
