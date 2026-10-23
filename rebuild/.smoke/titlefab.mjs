import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { sleep } from './lib.mjs';
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage();
await page.setViewport({ width:430, height:900, deviceScaleFactor:2 });
await page.goto('file:///' + path.resolve('dist/index.html').replace(/\\/g,'/') + '#debug', {waitUntil:'load'});
await page.evaluate(()=>localStorage.clear());
await page.reload({waitUntil:'load'}); await sleep(1200);
console.log(await page.evaluate(()=>{
  const f=document.querySelector('.phone-fab'); const r=f?.getBoundingClientRect();
  return {fab:!!f, rect:r?{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}:null, ring:f?.classList.contains('ringing')};
}));
await page.screenshot({path:'.smoke/shots/F-title.png'});
await browser.close();
