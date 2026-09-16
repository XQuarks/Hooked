import { spawn } from 'node:child_process';
import path from 'node:path';
const CHROME = 'C://Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9367;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = path.resolve('.dev/profile-dbg-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-proxy-server', '--proxy-bypass-list=*', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore','pipe','pipe'] });
try {
  let ws;
  for (let i=0;i<60;i++){ try { const l=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p=l.find(t=>t.type==='page'); if(p?.webSocketDebuggerUrl){ ws=new WebSocket(p.webSocketDebuggerUrl); break; } } catch(_){} await sleep(300); }
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let id=0; const pend=new Map();
  ws.onmessage=(e)=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
  const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
  const ev=async(x)=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
    return r.result?.exceptionDetails ? {__err:(r.result.exceptionDetails.exception?.description||'').split('\n')[0]} : r.result?.result?.value;};
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:8899/index.html'}); await sleep(3400);
  await ev('document.getElementById("startBtn").click()'); await sleep(300);
  await ev(`(()=>{const g=window.__game; g.save.coins=99999999; g.openPhone(); g.ui.openApp('shop'); return 'ok';})()`);
  await sleep(500);
  console.log(await ev(`JSON.stringify((()=>{
    const ds = document.querySelector('#pApp .item .ds');
    if (!ds) return { err: 'no .ds', pAppItems: document.querySelectorAll('#pApp .item').length };
    const cs = getComputedStyle(ds);
    const mk = (css, text) => { const p=document.createElement('span');
      p.style.cssText = css; p.textContent = text; document.body.appendChild(p);
      const w = p.getBoundingClientRect().width; p.remove(); return +w.toFixed(1); };
    const T = '最大下潜深度 · 80m → 150m';
    return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily.slice(0,40),
      letterSpacing: cs.letterSpacing, text: ds.textContent.trim(),
      rectW: +ds.getBoundingClientRect().width.toFixed(1),
      byFont: mk('position:absolute;visibility:hidden;white-space:nowrap;font:'+cs.font+';letter-spacing:'+cs.letterSpacing, T),
      byLong: mk('position:absolute;visibility:hidden;white-space:nowrap;font-size:'+cs.fontSize+';font-weight:'+cs.fontWeight+';font-family:'+cs.fontFamily+';letter-spacing:'+cs.letterSpacing, T),
      byPx11: mk('position:absolute;visibility:hidden;white-space:nowrap;font-size:11px;font-family:'+cs.fontFamily, T),
      byInline: mk('position:absolute;visibility:hidden;white-space:nowrap;font-size:11px', T),
      dsH: Math.round(ds.getBoundingClientRect().height),
      rowH: Math.round(ds.closest('.item').getBoundingClientRect().height),
    };
  })())`));
} finally { try{chrome.kill();}catch(_){} }
