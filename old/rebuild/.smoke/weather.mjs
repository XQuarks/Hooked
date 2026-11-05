import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML=path.resolve('dist/index.html');
const SHOTS=path.resolve('.smoke/shots');
const KEY='absurd-fishing-3d-save-v2';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage();
await page.setViewport({width:430,height:900,deviceScaleFactor:2});
const errs=[];
page.on('pageerror',(e)=>errs.push(e.message));
page.on('console',(m)=>{if(m.type()==='error')errs.push(m.text().slice(0,140));});
await page.goto('file:///'+HTML.replace(/\\/g,'/')+'#debug',{waitUntil:'load'});
await page.evaluate(()=>localStorage.clear());
await page.reload({waitUntil:'load'});
await sleep(1200);
// 进游戏 + 跳过漫画
await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('开始'));b?.click();});
await sleep(600);
await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('跳过'));b?.click();});
await sleep(900);

for (const w of ['clear','rain','fog']) {
  await page.evaluate((k,id)=>{const s=JSON.parse(localStorage.getItem(k));s.weather=id;localStorage.setItem(k,JSON.stringify(s));}, KEY, w);
  await page.reload({waitUntil:'load'});
  await sleep(1100);
  await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('继续')||(x.textContent||'').includes('开始'));b?.click();});
  await sleep(1000);
  const info=await page.evaluate(()=>({
    map:document.querySelector('.hud-map')?.innerText.replace(/\n/g,' | ')??null,
    weather:window.__af?undefined:undefined,
  }));
  console.log(w, JSON.stringify(info));
  await page.screenshot({path:path.join(SHOTS,'11'+w+'-shore.png')});
}
console.log('errors:',errs.length,errs.slice(0,3));
await browser.close();
