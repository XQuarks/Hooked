/**
 * shots5-fish.mjs — 第 5 轮：把全部 20 种鱼摆成一面"鱼墙"出图，
 * 用来肉眼核对「重做鱼类外形 + 扣钱鱼醒目化」这一条。
 * 用法：node .dev/shots5-fish.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v5');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const profile = path.resolve('.dev/profile-fish-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1280,800', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let ws;
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch (_) { /* wait */ }
    if (!target) await sleep(300);
  }
  ws = new WebSocket(target);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3500);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(500);
  // 覆写视口后必须手动触发一次 resize，否则 canvas 还停在旧的 430×932
  // （另外 #stage 在宽屏下被 CSS 锁成 9:16，鱼墙需要临时放开成全屏）
  await ev(`(()=>{ const g=window.__game;
    g._loop = ()=>{};                 // 冻住 rAF，否则游戏主循环每帧把相机掰回去
    const st=document.getElementById('stage');
    if(st) st.style.cssText += ';width:100vw!important;height:100vh!important;border-radius:0!important;box-shadow:none!important;';
    document.querySelectorAll('.hud,.modal,#catchPanel,#resultPanel,#zoneBanner').forEach(e=>e.style.display='none');
    g.world.resize();
    return innerWidth+'x'+innerHeight+' canvas='+document.getElementById('game').clientWidth+'x'+document.getElementById('game').clientHeight; })()`);
  await sleep(300);

  // ── 建"鱼墙"：清掉场景里所有 mesh/sprite，只留灯 ──
  const n = await ev(`(async()=>{
    const THREE = await import('three');
    const { buildFishModel } = await import('./src/fish.js');
    const { SPECIES } = await import('./src/config.js');
    const g = window.__game, w = g.world;
    g.showIdle();
    w.scene.children.slice().forEach((o)=>{ if(!o.isLight) o.visible = false; });

    const COLS = 5, CW = 30, CH = 24;
    const rows = Math.ceil(SPECIES.length / COLS);
    const grid = new THREE.Group();
    grid.name = '__fishwall';
    w.scene.add(grid);

    const cells = [];
    SPECIES.forEach((def, i)=>{
      const col = i % COLS, row = Math.floor(i / COLS);
      const cx = (col - (COLS-1)/2) * CW;
      const cy = ((rows-1)/2 - row) * CH;
      const m = buildFishModel(def);
      m.position.set(cx, cy, 0);
      m.rotation.y = -0.52;                       // 3/4 侧视，能看到体积和侧面花纹
      if (m.userData.badgePivot) m.userData.badgePivot.rotation.y = 0.52;  // 徽章正对镜头
      grid.add(m);
      cells.push({ id: def.id, name: def.name, hazard: !!def.hazard, cx, cy });
    });
    window.__cells = cells;

    const Z = w.camera.position.z;
    w.camera.position.set(0, 0, Z);
    w.camera.lookAt(0, 0, 0);
    const viewW = COLS * CW + 12, viewH = rows * CH + 8;
    w.camera.left = -viewW/2; w.camera.right = viewW/2;
    w.camera.top = viewH/2; w.camera.bottom = -viewH/2;
    w.camera.updateProjectionMatrix();
    window.__view = { viewW, viewH };
    w.renderer.render(w.scene, w.camera);
    return SPECIES.length + '|' + rows + '|' + viewW + 'x' + viewH;
  })()`);
  console.log('wall:', n);

  // ── 标签 ──
  await ev(`(()=>{
    const old = document.getElementById('fishlabels'); if (old) old.remove();
    const d = document.createElement('div');
    d.id = 'fishlabels';
    d.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:600 13px/1.25 "Segoe UI",system-ui,sans-serif;color:#08202f;text-align:center;';
    document.body.appendChild(d);
    const { viewW, viewH } = window.__view;
    const W = innerWidth, H = innerHeight;
    for (const c of window.__cells) {
      const nx = 0.5 + c.cx / viewW, ny = 0.5 - c.cy / viewH;
      const el = document.createElement('div');
      el.textContent = (c.hazard ? '⚠ ' : '') + c.name;
      el.style.cssText = 'position:absolute;transform:translate(-50%,0);white-space:nowrap;'
        + 'left:' + (nx*W) + 'px;top:' + (ny*H + 46) + 'px;'
        + (c.hazard ? 'color:#c01818;font-weight:800;' : '');
      d.appendChild(el);
    }
    return 'ok';
  })()`);
  await ev(`(()=>{ const g=window.__game; g.world.renderer.render(g.world.scene, g.world.camera); return 'ok'; })()`);
  await shot('F1-gallery');

  // ── 扣钱鱼特写：三种扣钱鱼放大，验证暗红描边 + 红晕 + ⚠ 徽章 ──
  await ev(`(async()=>{
    const THREE = await import('three');
    const { buildFishModel } = await import('./src/fish.js');
    const { SPECIES } = await import('./src/config.js');
    const g = window.__game, w = g.world;
    const old = w.scene.getObjectByName('__fishwall'); if (old) w.scene.remove(old);
    const grid = new THREE.Group(); grid.name = '__hazard';
    w.scene.add(grid);
    const haz = SPECIES.filter((s)=>s.hazard);
    const CW = 40;
    haz.forEach((def, i)=>{
      const m = buildFishModel(def);
      m.position.set((i - (haz.length-1)/2) * CW, 0, 0);
      m.rotation.y = -0.45;
      if (m.userData.badgePivot) m.userData.badgePivot.rotation.y = 0.45;
      grid.add(m);
    });
    const Z = w.camera.position.z;
    w.camera.position.set(0, 0, Z); w.camera.lookAt(0,0,0);
    const viewW = haz.length * CW + 16, viewH = 56;
    w.camera.left=-viewW/2; w.camera.right=viewW/2; w.camera.top=viewH/2; w.camera.bottom=-viewH/2;
    w.camera.updateProjectionMatrix();
    window.__view = { viewW, viewH };
    w.renderer.render(w.scene, w.camera);
    return haz.map((h)=>h.name).join(',');
  })()`);
  await ev(`(()=>{
    const d = document.getElementById('fishlabels'); if (d) d.remove();
    const el = document.createElement('div');
    el.style.cssText='position:fixed;left:0;right:0;top:10px;text-align:center;font:800 20px/1.3 "Segoe UI",system-ui,sans-serif;color:#a01010;';
    el.textContent='⚠ 扣钱鱼特写：暗红描边 + 红色脉冲光晕 + 头顶警示牌';
    document.body.appendChild(el);
    return 'ok';
  })()`);
  await ev(`(()=>{ const g=window.__game; g.world.renderer.render(g.world.scene, g.world.camera); return 'ok'; })()`);
  await shot('F2-hazard');

  // ── 图鉴图标全表：左边已解锁（彩色）/ 右边未解锁（黑色剪影）──
  await ev(`(async()=>{
    const { drawFishIcon, codexOrder } = await import('./src/codex.js');
    const g = window.__game;
    g.world.renderer.setClearColor?.(0x000000, 0);
    document.querySelectorAll('body > div:not(#stage)').forEach(e=>e.remove());
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:#071726;padding:14px 18px;overflow:hidden;'
      + 'font:600 12px/1.3 "Segoe UI",system-ui,sans-serif;color:#cfe6f7;';
    const order = codexOrder();
    const mk = (title, known) => {
      const box = document.createElement('div');
      box.innerHTML = '<div style="font:800 14px/1 \\'Segoe UI\\',sans-serif;letter-spacing:.1em;margin:0 0 8px;color:'
        + (known ? '#7fe0ff' : '#8ea6b8') + '">' + title + '</div>';
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:4px;';
      for (const def of order) {
        const cell = document.createElement('div');
        cell.style.cssText = 'text-align:center;';
        const cv = document.createElement('canvas');
        const W = 120, H = 76, dpr = 2;
        cv.width = W * dpr; cv.height = H * dpr;
        cv.style.cssText = 'width:' + W + 'px;height:' + H + 'px;';
        const ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawFishIcon(ctx, def, W, H, known);
        cell.appendChild(cv);
        const lb = document.createElement('div');
        lb.textContent = (known && def.hazard ? '⚠' : '') + (known ? def.name : '？ ？ ？');
        lb.style.cssText = 'font-size:11px;margin-top:-2px;' + (def.hazard && known ? 'color:#ff8080;' : '');
        cell.appendChild(lb);
        grid.appendChild(cell);
      }
      box.appendChild(grid);
      return box;
    };
    wrap.appendChild(mk('已 解 锁（彩色）', true));
    const sp = document.createElement('div'); sp.style.height = '10px'; wrap.appendChild(sp);
    wrap.appendChild(mk('未 解 锁（黑色剪影，不透露信息）', false));
    document.body.appendChild(wrap);
    return order.length;
  })()`);
  await shot('F3-icons');
} finally {
  try { ws?.close(); } catch (_) { /* ignore */ }
  chrome.kill();
}
