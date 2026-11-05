import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML=path.resolve('dist/index.html');
const KEY='absurd-fishing-3d-save-v2';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage();
await page.setViewport({width:430,height:900,deviceScaleFactor:2});
await page.goto('file:///'+HTML.replace(/\\/g,'/')+'#debug',{waitUntil:'load'});
await page.evaluate(()=>localStorage.clear());
await page.reload({waitUntil:'load'});
await sleep(1100);
await page.evaluate((k)=>{const s=JSON.parse(localStorage.getItem(k));s.trips=2;s.fired=['intro','introAfterFirst','iceUnlocked'];s.queue=[];s.messages=[{id:'m1',thread:'mom',text:'测试',trip:1}];localStorage.setItem(k,JSON.stringify(s));},KEY);
await page.reload({waitUntil:'load'});
await sleep(1000);
await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/开始|继续/.test(x.textContent||''));b?.click();});
await sleep(600);
await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('跳过'));b?.click();});
await sleep(700);
// 直接调 finish
const ok = await page.evaluate(()=>{ try { window.__af.finish(); return true; } catch(e) { return String(e); } });
await sleep(900);
console.log('finish:', ok);
console.log(JSON.stringify(await page.evaluate(()=>{
  const mask=document.querySelector('.sheet-mask');
  if(!mask) return {mask:null};
  return {
    maskBg: getComputedStyle(mask).backgroundColor,
    kids: [...mask.children].map(el=>{
      const b=el.getBoundingClientRect(); const c=getComputedStyle(el);
      return {cls:el.className,t:Math.round(b.top),l:Math.round(b.left),w:Math.round(b.width),h:Math.round(b.height),bg:c.backgroundColor,bgi:c.backgroundImage.slice(0,40),z:c.zIndex,pos:c.position};
    }),
  };
}),null,1));
await page.screenshot({path:path.resolve('.smoke/shots/54-result.png')});
await browser.close();
