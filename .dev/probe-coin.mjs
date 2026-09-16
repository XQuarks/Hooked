/**
 * probe-coin.mjs — 金币图标渲染路径细查（需求②的排查步骤）
 *
 * 上一轮 probe-emoji.mjs 的结论：本机 headless Chrome 能画出 🪙 的彩色字形。
 * 但 🪙（U+1FA99，Emoji 11.0 / 2018 年新增）属于**较新的码位**，
 * 能不能画出来完全取决于系统里有没有提供它的 emoji 字体 —— 换个宿主环境就可能变豆腐块。
 *
 * 这个脚本逐字体验证字形来源，并把 HUD 顶栏放大截图，看清真实渲染结果。
 *
 * 用法：node .dev/probe-coin.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9342;
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

const profile = path.resolve('.dev/profile-coin-' + Date.now());
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
  const shot = async (name, clip, scale) => {
    const params = { format: 'png' };
    if (clip) { params.clip = { ...clip, scale: scale || 3 }; }
    const r = await send('Page.captureScreenshot', params);
    if (r.result?.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3200);

  // ── A. 逐字体看 🪙 的字形来源 ──
  const perFont = await ev(`JSON.stringify((()=>{
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
      return { opaque, colors: cols.size };
    };
    const fonts = ['"PingFang SC"','"Hiragino Sans GB"','"Microsoft YaHei"','system-ui',
                   '"Segoe UI"','"Segoe UI Emoji"','"Segoe UI Symbol"','"Noto Color Emoji"',
                   '"Apple Color Emoji"','sans-serif','serif','monospace'];
    const out = {};
    for (const f of fonts) out[f] = probe('\\u{1FA99}', f);
    out['__tofu(U+10FFFD)'] = probe('\\u{10FFFD}', 'sans-serif');
    out['__rod(U+1F3A3)'] = probe('\\u{1F3A3}', 'sans-serif');
    return out;
  })())`);
  console.log('\n【A】各字体单独渲染 🪙 的像素指纹（colors=1 且 opaque≈600 → 豆腐块）：');
  const PF = JSON.parse(perFont);
  for (const [k, v] of Object.entries(PF)) {
    const tofu = v.colors === 1 && v.opaque > 400 && v.opaque < 900;
    console.log(`   ${k.padEnd(22)} opaque=${String(v.opaque).padStart(5)} colors=${String(v.colors).padStart(4)}  ${tofu ? '← 疑似豆腐块' : ''}`);
  }

  // ── B. 用 styles.css 的真实字体栈渲染 ──
  const realStack = await ev(`JSON.stringify((()=>{
    const stack = getComputedStyle(document.body).fontFamily;
    const S = 72, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.font = '56px ' + stack;
    g.textAlign='center'; g.textBaseline='middle'; g.fillStyle='#000';
    g.fillText('\\u{1FA99}', S/2, S/2);
    const d = g.getImageData(0,0,S,S).data;
    const cols = new Set(); let opaque = 0;
    for (let i=0;i<d.length;i+=4) if (d[i+3]>20){opaque++;cols.add(d[i]+','+d[i+1]+','+d[i+2]);}
    return { stack, opaque, colors: cols.size };
  })())`);
  console.log('\n【B】用页面真实字体栈渲染 🪙：', realStack);

  // ── C. 进游戏，量 HUD 金币 chip，并放大截图顶栏 ──
  await ev('document.getElementById("startBtn").click()');
  await sleep(900);
  const chip = await ev(`JSON.stringify((()=>{
    const ico = document.querySelector('.chip.coin .ico');
    const chip = document.querySelector('.chip.coin');
    const r = ico.getBoundingClientRect(), rc = chip.getBoundingClientRect();
    return { text: ico.textContent, icoW: +r.width.toFixed(1), icoH: +r.height.toFixed(1),
             chipW: +rc.width.toFixed(1), chipX: +rc.x.toFixed(1), chipY: +rc.y.toFixed(1),
             chipH: +rc.height.toFixed(1), font: getComputedStyle(ico).fontFamily };
  })())`);
  console.log('\n【C】HUD 金币 chip 实测（待机界面）：', chip);

  const C = JSON.parse(chip);
  await shot('probe-topbar', { x: 0, y: 0, width: 240, height: 46 }, 4);
  await shot('probe-idle-full');
  console.log(`\n截图：${OUT}\\probe-topbar.png（顶栏 4 倍放大） / probe-idle-full.png`);
} finally {
  try { ws && ws.close(); } catch (_) { /* ignore */ }
  chrome.kill();
}
