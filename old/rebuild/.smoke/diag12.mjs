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
await page.evaluate((k)=>{const s=JSON.parse(localStorage.getItem(k));s.unlocked=['bay'];s.map='bay';s.weather='clear';s.trips=2;s.fired=['intro','introAfterFirst'];s.queue=[];localStorage.setItem(k,JSON.stringify(s));},KEY);
await page.reload({waitUntil:'load'});
await sleep(1000);
await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/开始|继续/.test(x.textContent||''));b?.click();});
await sleep(600);
await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('跳过'));b?.click();});
await sleep(600);
// 直接进入 shoot
await page.evaluate(()=>{
  const e=window.__af;
  e.startTrip(e.cfg && e.cfg);
  const pool=e.fishes.filter(f=>!f.caught&&!f.dead&&f.mesh).slice(0,3);
  for(const f of pool) e.hook(f,e.cfg);
});
for(let i=0;i<200;i++){ const ph=await page.evaluate(()=>window.__af.phase); if(ph==='shoot') break; await sleep(100); }
await page.evaluate(()=>{ const e=window.__af; const a=e.air.find(x=>x.state==='fly'); a.x=0; a.y=8; a.vy=0; e.focusY=8; });
await sleep(300);
await page.evaluate(()=>{ const e=window.__af; const a=e.air.find(x=>x.state==='fly'); if(!a) throw new Error('no fly'); a.hp=20; e.damage(a,1,e.cfg); });
await sleep(100);
console.log('fx 状态:', JSON.stringify(await page.evaluate(()=>({
  ps: window.__af.fx.ps.length,
  juice: window.__af.fx.ps.filter(p=>p.juice).length,
  splats: window.__af.fx.splats.map(s=>({x:s.x,y:s.y,r:s.r,life:+s.life.toFixed(3)})),
  rings: window.__af.fx.rings.length,
}))));
await page.screenshot({path:path.resolve('.smoke/shots/44-a-all.png')});
await page.evaluate(()=>{ window.__af.fx.splats.length=0; });
await sleep(50);
await page.screenshot({path:path.resolve('.smoke/shots/44-b-nosplat.png')});
await page.evaluate(()=>{ window.__af.fx.ps.length=0; });
await sleep(50);
await page.screenshot({path:path.resolve('.smoke/shots/44-c-nofx.png')});
await browser.close();
