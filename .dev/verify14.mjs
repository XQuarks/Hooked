/**
 * verify14.mjs — 终章（「创世之音」+ 结局）的回归验证
 *
 * 覆盖：
 *   A 数据（纯 Node）：终章 Boss 的标记 / 触发字段 / 与常规 Boss 靠**深度**区分 / ENDING 文本 / 图鉴注脚包袱
 *   B 触发（浏览器）：bossKills 不够不出 / 够 + 潜够深才出 / 深度不够谁都不出 / **终章会顶掉常规 Boss**
 *   C 通关（浏览器）：打死 → `save.beatGame` + 结局过场 + 结局短信 + 手机上的通关标记
 *   D 冒烟：完整一竿 + 控制台零报错
 *
 * 用法：node .dev/verify14.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../src/config.js';
import * as S from '../src/story.js';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.VB_PORT || 9371);
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v14');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  · ' + detail : ''}`);
}

const { SPECIES, MAPS, mapOfSpecies, mapMaxDepth } = C;
const { ENDING, CODEX_NOTE } = S;

// ═══════════════════════════════════════════════════════════
// A 组 — 数据（纯 Node）
// ═══════════════════════════════════════════════════════════
console.log('\n── A 终章数据 ──');

const fin = SPECIES.find((s) => s.final);
check('A1 终章 Boss「创世之音」存在，且 `boss + final` 都打了、不参与稀有度抽签',
  !!fin && fin.boss === true && fin.final === true && fin.elite === false && fin.hp > 0,
  fin ? `${fin.name} hp${fin.hp} · 身价 ${fin.value}` : '缺 final');

check('A2 终章 Boss 的触发条件三个字段都合法（depth / caught / afterBoss）',
  !!fin && fin.bossWhen.depth > 0 && fin.bossWhen.caught >= 1 && fin.bossWhen.afterBoss >= 1,
  fin ? JSON.stringify(fin.bossWhen) : '缺');

// ⭐ 终章靠**深度**和常规 Boss 区分（同一竿只会出一个）
const finMap = fin ? mapOfSpecies(fin) : null;
const normalOfMap = finMap ? SPECIES.filter((s) => s.bossWhen && !s.final && mapOfSpecies(s).id === finMap.id) : [];
check('A3 ⭐ 终章 Boss 的触发深度**比本图常规 Boss 更深** —— 两者靠深度区分，不会同一竿打架',
  !!fin && normalOfMap.length === 1 && fin.bossWhen.depth > normalOfMap[0].bossWhen.depth,
  normalOfMap.map((s) => `${s.name}@${s.bossWhen.depth}m`).join(',') + (fin ? ` < ${fin.name}@${fin.bossWhen.depth}m` : ''));

check('A4 每张图最多一个 `final`（终章只有一个）',
  MAPS.every((m) => SPECIES.filter((s) => s.final && mapOfSpecies(s).id === m.id).length <= 1),
  `全局 final 数 = ${SPECIES.filter((s) => s.final).length}`);

check('A5 结局文本（`ENDING`）至少 8 行，且**以协会那句收尾**（包袱在这里抖完）',
  Array.isArray(ENDING) && ENDING.length >= 8
  && /广告牌/.test(ENDING[ENDING.length - 1]),
  `${ENDING.length} 行 · 最后一句「${ENDING[ENDING.length - 1]}」`);

check('A6 ⭐ 图鉴注脚里，终章 Boss 被登记成「这是一种鱼。」—— 那个包袱从第一章埋到通关',
  !!fin && CODEX_NOTE[fin.id] === '这是一种鱼。',
  fin ? `「${CODEX_NOTE[fin.id]}」` : '缺');

// ═══════════════════════════════════════════════════════════
// 浏览器部分
// ═══════════════════════════════════════════════════════════
async function getTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const t = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) return t.webSocketDebuggerUrl;
    } catch (_) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('Chrome CDP 未就绪（静态服务器没开？先跑 python -m http.server 8899）');
}

const profile = path.resolve('.dev/profile-v14-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--no-proxy-server', '--proxy-bypass-list=*',
  '--disable-extensions', '--mute-audio',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=430,932', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

try {
  const ws = new WebSocket(await getTarget(PORT));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const pending = new Map();
  const errors = [];

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push('EXCEPTION: ' + (d.exception?.description || d.text).split('\n')[0]);
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      const t = m.params.entry.text || '';
      if (!/favicon|AudioContext|autoplay/i.test(t)) errors.push('LOG ERROR: ' + t);
    }
  };

  const send = (method, params = {}) => new Promise((res) => {
    const id = ++msgId; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      return { __err: (r.result.exceptionDetails.exception?.description || '').split('\n').slice(0, 2).join(' | ') };
    }
    return r.result?.result?.value;
  };
  const J = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return { __bad: v }; } };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3200);

  await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);
  check('A0 测试用的 window.__cfg 已注入（探针拿现值断言的唯一入口）',
    (await ev('typeof window.__cfg?.SPECIES?.length')) === 'number',
    'SPECIES.length = ' + await ev('window.__cfg.SPECIES.length'));
  await ev('document.getElementById("startBtn").click()');
  await sleep(400);

  // 冻结主循环 + 进熔岩海沟
  await ev(`(()=>{const g=window.__game; if(!g) return 'no game'; g._loop = () => {};
    window.__cfg.TUNING.airSettleGrace = 999;
    window.step = (n) => { const dt0 = 1/60;
      for (let i=0;i<n;i++){ g.time += dt0; g._update(dt0); }
      g.world.render();
    };
    g.save.charts = { polar: true, lava: true, wreck: true, song: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.enterMap('song');   // ⚠ 批 8b：终章 Boss 搬到第 5 张图「深海之声」了
    return 'ok';})()`);
  await sleep(200);

  // ═══════════════════════════════════════════════════════════
  // B 触发
  // ═══════════════════════════════════════════════════════════
  console.log('\n── B 终章触发 ──');

  const b1 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    // ① bossKills 不够（只打赢过 1 个）→ 潜到最深也不出终章
    g.save.bossKills = 2; g._resetRun();
    g.state = 'descend'; g.hook.x = 0; g.hook.y = -2150; g.targetX = 0; g.run.caught = 9;
    g._checkBossTrigger();
    const low = g.boss ? g.boss.def.id : null;
    // ② bossKills 够（2 个）→ 出终章
    g.save.bossKills = 3; g._resetRun();
    g.state = 'descend'; g.hook.y = -2150; g.run.caught = 9;
    g._checkBossTrigger();
    const ok = g.boss ? g.boss.def.id : null;
    return { low, ok };})())`));
  check('B1 `afterBoss` 门槛生效：打赢的 Boss 不够时潜到最深只出**常规** Boss，够数才换成终章',
    // ⚠ bossKills=1 时出的应该是**常规** Boss（`原初之火`）而不是 null ——
    //   `afterBoss` 挡住的只是**终章**，常规 Boss 照常出。
    b1.low === 'siren-queen' && b1.ok === 'genesis-voice',
    `bossKills=2 → ${b1.low || '（不出）'}（常规）· bossKills=3 → ${b1.ok}（终章顶掉了常规）`);

  const b2 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    // 深度不够（1400m，在常规 Boss 和终章之间）→ 出的是**常规** Boss
    g.save.bossKills = 3; g._resetRun();
    g.state = 'descend'; g.hook.y = -2100; g.run.caught = 9;
    g._checkBossTrigger();
    const mid = g.boss ? g.boss.def.id : null;
    // 深度也不够常规 Boss → 谁都不出
    g._resetRun(); g.state = 'descend'; g.hook.y = -200; g.run.caught = 9;
    g._checkBossTrigger();
    const none = g.boss ? g.boss.def.id : null;
    return { mid, none };})())`));
  check('B2 触发按**深度分层**：2100m 出常规 Boss「海妖女王」，200m 谁都不出',
    b2.mid === 'siren-queen' && b2.none === null,
    `2100m → ${b2.mid} · 200m → ${b2.none || '（不出）'}`);

  const b3 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    // 串鱼数不够 → 也不出
    g.save.bossKills = 3; g._resetRun();
    g.state = 'descend'; g.hook.y = -2150; g.run.caught = 1;
    g._checkBossTrigger();
    const few = g.boss ? g.boss.def.id : null;
    return { few };})())`));
  check('B3 `caught` 门槛也生效：潜得够深但本竿只串了 1 条 → 终章不出',
    b3.few === null, `caught=1 → ${b3.few || '（不出）'}`);

  // ═══════════════════════════════════════════════════════════
  // C 通关
  // ═══════════════════════════════════════════════════════════
  console.log('\n── C 通关 ──');

  const c1 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.save.sms = []; g.save.smsSeen = 0; g.save.beatGame = false;
    g.save.bossKills = 3; g._resetRun();
    g.state = 'descend'; g.hook.y = -2150; g.run.caught = 9;
    g._checkBossTrigger();
    const spawned = !!g.boss;
    const name = g.boss ? g.boss.def.name : null;
    // 打死它
    const f = g.boss;
    f.damage(f.maxHp * 2);
    g._hitFish(f);
    return { spawned, name, beatGame: g.save.beatGame,
      cutOpen: g.ui.cutsceneOpen, cutLen: (g.ui._cutFull || '').length,
      sms: g.save.sms.slice(), boss: !!g.boss };})())`));
  check('C1 打死终章 Boss → `save.beatGame` 置位 + **结局过场**打开 + 血条收起',
    c1.spawned === true && c1.beatGame === true && c1.cutOpen === true
    && c1.cutLen > 60 && c1.boss === false,
    `「${c1.name}」· beatGame=${c1.beatGame} · 过场 ${c1.cutLen} 字 · 血条收起=${!c1.boss}`);
  await shot('C1-ending');

  const c2 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const full = g.ui._cutFull || '';
    const lines = full.split('\\n');
    // 关掉过场
    g.ui.cutTap(); g.ui.cutTap();
    const closed = g.ui.cutsceneOpen;
    return { lines: lines.length, last: lines[lines.length - 1], closed };})())`));
  check('C2 结局过场是 `ENDING` 全文（比普通过场的 3 行长），最后一句是协会的包袱',
    c2.lines === ENDING.length && /广告牌/.test(c2.last) && c2.closed === false,
    `${c2.lines} 行 · 末句「${c2.last}」· 关掉后 open=${c2.closed}`);

  check('C3 结局短信也到了（小鲟「任务完成」+ 协会「债务已结清」）',
    c1.sms.includes('ai-end') && c1.sms.includes('assoc-end'),
    `已发 ${c1.sms.length} 条 · 含结局两条=${c1.sms.includes('ai-end') && c1.sms.includes('assoc-end')}`);

  const c4 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    // ⚠ openPhone() 有前置条件：**状态必须是 IDLE**（下潜/上升时点手机不生效）。
    //   探针前面把状态留在 descend 了，不先回 IDLE 的话手机会**根本不打开** ——
    //   症状是 #pHome 的 innerHTML 是空串，看起来像"标记没渲染"。
    g.closePhone(); g.state = 'idle'; g.showIdle();
    g.openPhone(); g.ui.showPhoneHome();
    const el = document.querySelector('#pHome .p-cleared');
    return { shown: !!el, text: el ? el.textContent : null, beat: g.save.beatGame,
      html: (document.getElementById('pHome').innerHTML || '').slice(0, 90),
      hasPhone: !!g.ui._phone, hasEl: !!document.getElementById('pHome'),
      app: g.ui._phone ? g.ui._phone.app : 'no-phone' };})())`));
  check('C4 手机上出现「债务已结清」通关标记（只有真通关过才显示）',
    // ⚠ 标记的文案是**带字间空格**的（"债 务 已 结 清"），正则要允许空格
    c4.shown === true && c4.beat === true && /结\s*清/.test(c4.text || ''),
    `标记「${c4.text}」· beatGame=${c4.beat} · HTML 开头「${(c4.html||'').slice(0,80)}」`);
  await shot('C4-cleared');

  const c5 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    // 没通关的存档不该有标记
    const keep = g.save.beatGame;
    g.save.beatGame = false; g.ui.showPhoneHome();
    const off = !!document.querySelector('#pHome .p-cleared');
    g.save.beatGame = keep; g.ui.showPhoneHome();
    return { off };})())`));
  check('C5 没通关时**不显示**那个标记（不是"永远挂着"的装饰）',
    c5.off === false, `beatGame=false 时标记存在=${c5.off}`);

  // ═══════════════════════════════════════════════════════════
  // D 冒烟
  // ═══════════════════════════════════════════════════════════
  console.log('\n── D 冒烟 ──');

  const smoke = J(await ev(`(()=>{try{const g=window.__game; const cfg=window.__cfg;
    g.closePhone(); g.ui.hideOverlay();
    cfg.TUNING.airSettleGrace = 1.8;
    g.save.levels = Object.fromEntries(cfg.UPGRADE_ORDER.map(k=>[k, k==='winch'?0:cfg.MAX_LEVEL]));
    g.applyUpgrades();
    g.showIdle();
    for (let i=0;i<10;i++) window.step(1);
    g.enterDescend();
    const seen = new Set();
    for (let i=0;i<60*90;i++) { window.step(1); seen.add(g.state); if (g.state === 'result') break; }
    return JSON.stringify({ seen: [...seen], caught: g.run.caught, map: g.map.id });
    }catch(e){return JSON.stringify({ err: e.message });}})()`));
  check('D1 带终章系统跑完整一竿（下潜 → 收线 → 上升 → 空中 → 结算）',
    smoke.seen.includes('descend') && smoke.seen.includes('ascend') && smoke.seen.includes('result'),
    `${smoke.seen.join(' → ')} · 串上 ${smoke.caught} 条 · 图 ${smoke.map}`);

  const clean = errors.filter((e) => !/favicon|AudioContext/i.test(e));
  check('D2 全程控制台零报错', clean.length === 0, clean.slice(0, 3).join(' | ') || 'clean');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n================  ${pass}/${results.length} 通过  ================\n`);
  fs.writeFileSync(path.resolve('.dev/verify14.json'),
    JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  if (pass !== results.length) process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
}
