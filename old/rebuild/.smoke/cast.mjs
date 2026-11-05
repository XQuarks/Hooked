import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { sleep } from './lib.mjs';
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage();
await page.setViewport({ width:430, height:900, deviceScaleFactor:1 });
await page.goto('file:///' + path.resolve('dist/index.html').replace(/\\/g,'/') + '#debug', {waitUntil:'load'});
await page.evaluate(()=>localStorage.clear());
await page.reload({waitUntil:'load'}); await sleep(900);
await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>/开始|继续/.test(x.textContent||''))?.click()});
await sleep(600);
await page.evaluate(()=>{[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('跳过'))?.click()});
await sleep(1000);
const before = await page.evaluate(()=>({lure:{...window.__af.lure}, tip:window.__af.world.rodTip()}));
console.log('抛竿前 lure/tip:', JSON.stringify(before));
await page.mouse.click(120, 560);
const samples=[];
for(let i=0;i<26;i++){ await sleep(50); samples.push(await page.evaluate(()=>({t:+window.__af.castT.toFixed(2), x:+window.__af.lure.x.toFixed(3), y:+window.__af.lure.y.toFixed(3), vx:+window.__af.lure.vx.toFixed(2)}))); }
console.log('samples:', JSON.stringify(samples));
// 统计水平速度变号次数（抛体应该只在出手前有变化）
let flips=0, last=0;
for(const s of samples){ if(Math.abs(s.vx)>0.01){ if(last && Math.sign(s.vx)!==last) flips++; last=Math.sign(s.vx);} }
console.log('vx 变号次数:', flips);
await browser.close();
