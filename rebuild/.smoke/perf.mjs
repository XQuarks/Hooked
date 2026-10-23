import puppeteer from 'file:///C:/Users/guoxiaoyan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
import { skipStory, castOff, sleep } from './lib.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = path.resolve('dist/index.html');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('file:///' + HTML.replace(/\\/g, '/') + '#debug', { waitUntil: 'load' });
await sleep(700);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(900);
await page.click('.btn.start');
await sleep(500);
await skipStory(page);
const ph = await castOff(page);
console.log('phase:', ph);

const sample = async (label) => {
  const r = await page.evaluate(async () => {
    const e = window.__af;
    const info = e.stage.renderer.info;
    info.autoReset = false;
    info.reset();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const calls = Math.round(info.render.calls / 2);
    const tris = Math.round(info.render.triangles / 2);
    info.autoReset = true;
    const t0 = performance.now();
    let frames = 0;
    await new Promise((res) => {
      const tick = () => {
        frames++;
        if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
        else res();
      };
      requestAnimationFrame(tick);
    });
    return {
      calls,
      tris,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      fps: frames,
      phase: e.debugState().phase,
    };
  });
  console.log(label, JSON.stringify(r));
  return r;
};

await sleep(2200);
await sample('水下(descent)');
await sleep(400);
await page.screenshot({ path: path.resolve('.smoke/shots/perf-underwater.png') });

// 等到水上
for (let i = 0; i < 200; i++) {
  const s = await page.evaluate(() => window.__af.debugState().phase);
  if (s === 'shoot' || s === 'idle') break;
  await sleep(150);
}
await sleep(500);
await sample('水上(shoot/idle)');
await page.screenshot({ path: path.resolve('.smoke/shots/perf-above.png') });

console.log('errors:', errors.length);
await browser.close();
