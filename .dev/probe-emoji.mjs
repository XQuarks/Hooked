/**
 * probe-emoji.mjs — 诊断「金币图标 🪙 显示不出来」
 *
 * 排查思路（需求②要求先确认资源加载方式与渲染路径）：
 *   1. 🪙 是 emoji 字符，不是图片资源 —— 它的"加载"完全依赖系统 emoji 字体。
 *      所以要看：字体回退链里有没有能提供 U+1FA99 字形的字体。
 *   2. 把字符画到 canvas 上做像素分析：真字形是多色 / 实心，
 *      缺字形时浏览器画 "豆腐块"（单色空心方框），两者的像素特征完全不同。
 *   3. 和「确定缺失的码位」做对照，拿到 tofu 的像素指纹再比对。
 *
 * 用法：node .dev/probe-emoji.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-probe');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

async function getTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch (_) { /* 还没起来 */ }
    await sleep(300);
  }
  throw new Error('Chrome CDP 未就绪');
}

const profile = path.resolve('.dev/profile-probe-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--no-proxy-server', '--proxy-bypass-list=*',
  '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let ws;
try {
  ws = new WebSocket(await getTarget(PORT));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++msgId; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.result?.exceptionDetails) {
      return { __err: (r.result.exceptionDetails.exception?.description || '').split('\n')[0] };
    }
    return r.result?.result?.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3500);

  // ── 1. 页面里到底有没有用到 🪙 ──
  const usage = await ev(`JSON.stringify((()=>{
    const nodes = [...document.querySelectorAll('*')].filter(n =>
      [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.includes('\\u{1FA99}')));
    return {
      count: nodes.length,
      where: nodes.map(n => n.className || n.tagName).slice(0, 20),
    };
  })())`);
  console.log('\n【1】页面中 🪙 的出现位置：', usage);

  // ── 2. 像素指纹：真字形 vs 豆腐块 ──
  const px = await ev(`JSON.stringify((()=>{
    const probe = (ch, font) => {
      const S = 72, cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const g = cv.getContext('2d');
      g.clearRect(0,0,S,S);
      g.font = '56px ' + font;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#000';
      g.fillText(ch, S/2, S/2);
      const d = g.getImageData(0,0,S,S).data;
      const cols = new Set(); let opaque = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i+3] > 20) { opaque++; cols.add(d[i]+','+d[i+1]+','+d[i+2]); }
      }
      return { opaque, ratio: +(opaque/(S*S)).toFixed(4), colors: cols.size };
    };
    const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    return {
      coin:      probe('\\u{1FA99}', FONT),   // 🪙 金币
      rod:       probe('\\u{1F3A3}', FONT),   // 🎣 对照：确定可用的 emoji
      hook:      probe('\\u{1FA9D}', FONT),   // 🪝 鱼钩（Emoji 12.0）
      gear:      probe('\\u{2699}',  FONT),   // ⚙ 设置（Emoji 1.0，老）
      tofu:      probe('\\u{10FFFD}', FONT),  // 确定缺失的码位 → 豆腐块指纹
    };
  })())`);
  console.log('\n【2】canvas 像素指纹（opaque 像素数 / 占比 / 颜色数）：');
  const P = JSON.parse(px);
  for (const [k, v] of Object.entries(P)) {
    console.log(`   ${k.padEnd(6)} opaque=${String(v.opaque).padStart(5)}  ratio=${v.ratio}  colors=${v.colors}`);
  }
  const tofu = P.tofu;
  const same = (a) => a.colors <= 2 && Math.abs(a.ratio - tofu.ratio) < 0.02;
  console.log(`   → 🪙 是否与豆腐块同指纹：${same(P.coin) ? '★ 是（缺字形，渲染成了 tofu 方框）' : '否（有真实字形）'}`);
  console.log(`   → 🎣 是否与豆腐块同指纹：${same(P.rod) ? '是' : '否（有真实字形）'}`);

  // ── 3. 字体回退链：哪些字体声明支持 U+1FA99 ──
  const fonts = await ev(`JSON.stringify((()=>{
    const list = ['system-ui','sans-serif','"Segoe UI"','"Segoe UI Emoji"','"Segoe UI Symbol"',
                  '"Noto Color Emoji"','"Apple Color Emoji"','"Microsoft YaHei"','"PingFang SC"','Arial'];
    const out = {};
    for (const f of list) out[f] = document.fonts.check('16px ' + f, '\\u{1FA99}');
    return out;
  })())`);
  console.log('\n【3】document.fonts.check(..., "🪙")：', fonts);

  // ── 4. 真实 HUD 上量一下金币 chip 的宽度（缺字形时宽度会异常）──
  const chip = await ev(`JSON.stringify((()=>{
    const ico = document.querySelector('.chip.coin .ico');
    if (!ico) return { err: 'no .chip.coin .ico' };
    const r = ico.getBoundingClientRect();
    const cs = getComputedStyle(ico);
    return { text: ico.textContent, w: +r.width.toFixed(1), h: +r.height.toFixed(1),
             font: cs.fontFamily, fs: cs.fontSize, ua: navigator.userAgent };
  })())`);
  console.log('\n【4】HUD 金币图标实测：', chip);

  await shot('probe-hud');
  console.log(`\n截图：${OUT}\\probe-hud.png`);
} finally {
  try { ws && ws.close(); } catch (_) { /* ignore */ }
  chrome.kill();
}
