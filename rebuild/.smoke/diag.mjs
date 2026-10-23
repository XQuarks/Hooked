import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML=path.resolve('dist/index.html');
const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const page=await browser.newPage();
await page.setViewport({width:430,height:900,deviceScaleFactor:1});
page.on('console',async(m)=>{
  if(m.type()!=='error') return;
  const args=m.args();
  for(const a of args){
    try{ const v=await a.evaluate(o=> o&&o.stack?o.stack:(o&&o.message?o.message:String(o))); console.log('ERR ARG:',v);}catch(e){console.log('ERR ARG(raw):',String(e));}
  }
});
page.on('pageerror',e=>console.log('PAGEERROR:',e.stack));
await page.goto('file:///'+HTML.replace(/\\/g,'/'),{waitUntil:'load'});
await new Promise(r=>setTimeout(r,1500));
console.log('fallback?', await page.evaluate(()=>!!document.querySelector('.gpu-fallback')));
console.log('body text:', (await page.evaluate(()=>document.body.innerText)).slice(0,400));
await browser.close();
