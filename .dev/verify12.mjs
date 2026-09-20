/**
 * verify12.mjs — 批 5（剧情系统：短信 / 电台 / 过场 / 图鉴注脚）的回归验证
 *
 * 覆盖：
 *   A 数据表（纯 Node）
 *     · `SMS` / `SENDERS` / `RADIO` / `CUTSCENE` / `CODEX_NOTE` 五张表的结构自洽
 *     · ⭐ **过场每张图恰好 3 行**（设计硬约束：多一行就变成"要我读东西"）
 *     · ⭐ 注脚的 key 都是真实鱼种，而且**不是每条鱼都有**（"彩蛋"不是"作业"）
 *     · `when` 的字段都在白名单里（拼错字段名会让那条短信**永远不发**，且不报错）
 *     · 文案里没有 emoji（`verify6` 的 C11 只管界面文字，这里管数据表）
 *   B 短信（浏览器）：触发 / 只发一次 / 未读数 / 分组 / 条件短信
 *   C 电台 · 过场 · 注脚（浏览器）
 *   D 冒烟：完整一竿 + 控制台零报错
 *
 * 用法：node .dev/verify12.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../src/config.js';
import * as S from '../src/story.js';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.VB_PORT || 9368);
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v12');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  · ' + detail : ''}`);
}

const { SMS, SENDERS, RADIO, CUTSCENE, CODEX_NOTE } = S;
const { MAPS, SPECIES } = C;

// ═══════════════════════════════════════════════════════════
// A 组 — 数据表（纯 Node）
// ═══════════════════════════════════════════════════════════
console.log('\n── A 剧情数据表 ──');

const smsBad = [];
const seenId = new Set();
for (const m of SMS) {
  if (!m.id || seenId.has(m.id)) smsBad.push((m.id || '?') + ':id 重复/缺失');
  seenId.add(m.id);
  if (!SENDERS[m.who]) smsBad.push(m.id + ':who 非法');
  if (!Array.isArray(m.text) || !m.text.length || m.text.some((x) => !x || typeof x !== 'string')) {
    smsBad.push(m.id + ':text 非法');
  }
}
check('A1 SMS 表：id 唯一、发件人合法、每条至少一句台词',
  smsBad.length === 0, smsBad.join(',') || `${SMS.length} 条短信 · 发件人 ${Object.keys(SENDERS).join('/')}`);

// 两个发件人都真的发过消息（否则界面上会出现一条空会话线）
const usedWho = new Set(SMS.map((m) => m.who));
check('A2 两个发件人**都真的发过消息**（否则短信 App 里会出现一条空会话线）',
  Object.keys(SENDERS).every((k) => usedWho.has(k)),
  Object.keys(SENDERS).map((k) => `${SENDERS[k].name}:${SMS.filter((m) => m.who === k).length} 条`).join(' · '));

check('A3 电台至少 8 条播报，都是非空字符串',
  Array.isArray(RADIO) && RADIO.length >= 8 && RADIO.every((x) => typeof x === 'string' && x.length > 8),
  `${RADIO.length} 条 · 最长 ${Math.max(...RADIO.map((x) => x.length))} 字`);

// ⭐ 过场恰好 3 行
const cutBad = [];
for (const m of MAPS) {
  const c = CUTSCENE[m.id];
  if (!c) { cutBad.push(m.id + ':缺'); continue; }
  if (!Array.isArray(c) || c.length !== 3) cutBad.push(m.id + ':' + (c ? c.length : 0) + ' 行');
  else if (c.some((x) => !x || typeof x !== 'string')) cutBad.push(m.id + ':有空行');
}
check('A4 ⭐ 每张地图都有过场，而且**恰好 3 行**（多一行就变成"要我读东西"）',
  cutBad.length === 0,
  cutBad.join(',') || MAPS.map((m) => `${m.name}:${CUTSCENE[m.id].length} 行`).join(' · '));

// 注脚：key 必须是真实鱼种
const spIds = new Set(SPECIES.map((s) => s.id));
const noteBad = Object.keys(CODEX_NOTE).filter((k) => !spIds.has(k));
check('A5 图鉴注脚的 key 都是**真实存在的鱼种 id**（拼错的话那条注脚永远不会显示）',
  noteBad.length === 0, noteBad.join(',') || `${Object.keys(CODEX_NOTE).length} 条注脚，全部对得上鱼种`);

// ⭐ 不是每条鱼都有注脚
const noteRatio = Object.keys(CODEX_NOTE).length / SPECIES.length;
check('A6 ⭐ 注脚**不是每条鱼都有**（只给"有话可说"的）—— 硬凑会让彩蛋变成作业',
  noteRatio > 0.1 && noteRatio < 0.6,
  `${Object.keys(CODEX_NOTE).length} / ${SPECIES.length} 种鱼有注脚（${(noteRatio * 100).toFixed(0)}%）`);

// when 的字段白名单
const WHEN_KEYS = new Set(['casts', 'depth', 'codex', 'coins', 'lt', 'map', 'chart', 'boat', 'boss', 'hazard', 'codexFull', 'after']);
const whenBad = [];
for (const m of SMS) for (const k of Object.keys(m.when || {})) if (!WHEN_KEYS.has(k)) whenBad.push(m.id + ':' + k);
check('A7 短信的 `when` 字段都在白名单里（拼错字段名会让那条短信**永远不发**，而且不报错）',
  whenBad.length === 0, whenBad.join(',') || `${WHEN_KEYS.size} 个合法字段`);

// 文案里不能有 emoji（verify6 的 C11 只管界面文字）
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const emojiBad = [
  ...SMS.flatMap((m) => m.text.map((t) => [m.id, t])),
  ...RADIO.map((t) => ['radio', t]),
  ...Object.entries(CUTSCENE).flatMap(([k, v]) => v.map((t) => [k, t])),
  ...Object.entries(CODEX_NOTE).map(([k, v]) => [k, v]),
].filter(([, t]) => EMOJI.test(t)).map(([k]) => k);
check('A8 剧情文案里**一个 emoji 都没有**（界面一律内联 SVG）',
  emojiBad.length === 0, emojiBad.join(',') || '五张表全部干净');

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

const profile = path.resolve('.dev/profile-v12-' + Date.now());
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
    (await ev('typeof window.__cfg?.MAPS?.length')) === 'number',
    'MAPS.length = ' + await ev('window.__cfg.MAPS.length'));
  await ev('document.getElementById("startBtn").click()');
  await sleep(400);

  // 清一份干净的剧情存档（只清剧情相关的，别动别的）
  await ev(`(()=>{const g=window.__game;
    g.save.sms = []; g.save.smsSeen = 0; g.save.seenCut = [];
    g.save.hazards = 0; g.save.bossKills = 0; g.save.casts = 0;
    return 'ok';})()`);

  // ═══════════════════════════════════════════════════════════
  // B 短信
  // ═══════════════════════════════════════════════════════════
  console.log('\n── B 短信 ──');

  const b1 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const n0 = g.save.sms.length;
    g.save.casts = 0;
    // 抛一竿 = casts + 1，然后回待机（_syncSms 挂在 showIdle 上）
    g.showIdle();
    const n1 = g.save.sms.length;
    g.save.casts = 5; g.showIdle();
    const n2 = g.save.sms.length;
    // 再抛几竿：不该重复发
    g.save.casts = 20; g.showIdle();
    const n3 = g.save.sms.length;
    // ⚠ 「每条只发一次」要在**条件不变**的前提下重复调用才测得准 ——
    //   换个 casts 再调会合法地多出一条新短信（那是条件刚被触达，不是重复发）。
    g.showIdle(); g.showIdle(); g.showIdle();
    const n4 = g.save.sms.length;
    return { n0, n1, n2, n3, n4, ids: g.save.sms.slice() };})())`));
  check('B1 短信按条件触发（抛竿 / 金币 / 深度…），而且**每条只发一次**（重复调不会重复发）',
    b1.n0 === 0 && b1.n2 > b1.n1 && b1.n4 === b1.n3 && b1.ids.includes('ai-first-cast'),
    `0 → ${b1.n1} → ${b1.n2} → ${b1.n3} → ${b1.n4}（最后三次重复调不变）· 已发 ${b1.ids.length} 条`);

  const b2 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const unread0 = g.smsUnread();
    const threads = g.smsThreads();
    // 打开短信 App → 已读
    g.openPhone(); g.ui.openApp('sms');
    const unread1 = g.smsUnread();
    const dom = document.querySelectorAll('#pApp .sms-thread').length;
    const bubbles = document.querySelectorAll('#pApp .sms-b').length;
    const badge = document.getElementById('phoneDot') ? document.getElementById('phoneDot').className : '';
    return { unread0, unread1, threads: threads.map(t=>t.who), dom, bubbles, badge };})())`));
  check('B2 未读数 = 已发 − 已读；**打开短信 App 就清零**；会话线按发件人分成两条',
    b2.unread0 > 0 && b2.unread1 === 0
    && b2.dom === b2.threads.length && b2.dom >= 1 && b2.bubbles > 0
    && b2.threads[0] === 'ai',
    `未读 ${b2.unread0} → ${b2.unread1} · 会话线 ${JSON.stringify(b2.threads)} · 气泡 ${b2.bubbles} 个`);
  await shot('B2-sms');

  const b3 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.closePhone();
    // 条件短信：潜到 400m（写进本图纪录）
    const before = g.save.sms.length;
    g.save.mapBest[g.map.id] = 500; g.showIdle();
    const afterDepth = g.save.sms.includes('ai-deep-400');
    // 扣钱鱼
    g.save.hazards = 3; g.showIdle();
    const afterHaz = g.save.sms.includes('ai-puffer');
    // 本图图鉴集齐
    for (const d of cfg.SPECIES) if (cfg.mapOfSpecies(d).id === g.map.id) g.save.codex[d.id] = { n: 1, best: 1 };
    g.showIdle();
    const afterCodex = g.save.sms.includes('ai-codex-full');
    return { before, afterDepth, afterHaz, afterCodex, n: g.save.sms.length };})())`));
  check('B3 条件短信真的会到：潜到 400m / 钓到扣钱鱼 / 本图图鉴集齐',
    b3.afterDepth === true && b3.afterHaz === true && b3.afterCodex === true,
    `${b3.before} → ${b3.n} 条 · 400m=${b3.afterDepth} 扣钱鱼=${b3.afterHaz} 图鉴集齐=${b3.afterCodex}`);

  // ═══════════════════════════════════════════════════════════
  // C 电台 / 过场 / 注脚
  // ═══════════════════════════════════════════════════════════
  console.log('\n── C 电台 · 过场 · 注脚 ──');

  const c1 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.openPhone(); g.ui.openApp('radio');
    const t1 = (document.querySelector('#pApp .radio-txt') || {}).textContent || '';
    const sw = document.querySelector('#pApp [data-radio]');
    // 换台：连点几次，至少有一次不一样（13 条里随机）
    let changed = false;
    for (let i = 0; i < 12; i++) {
      sw.click();
      const t = (document.querySelector('#pApp .radio-txt') || {}).textContent || '';
      if (t && t !== t1) { changed = true; break; }
    }
    const t2 = (document.querySelector('#pApp .radio-txt') || {}).textContent || '';
    return { t1: t1.slice(0, 24), t2: t2.slice(0, 24), changed, hasSwitch: !!sw };})())`));
  check('C1 电台 App：能打开、有播报、有「换台」按钮而且真的会换',
    c1.t1.length > 8 && c1.hasSwitch === true && c1.changed === true,
    `「${c1.t1}…」→「${c1.t2}…」· 换台生效=${c1.changed}`);
  await shot('C1-radio');

  const c2 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.closePhone();
    g.save.seenCut = [];
    g.save.charts = { polar: true, lava: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    // ① 第一次进极地 → 应该放过场
    g.enterMap('polar');
    const first = { open: g.ui.cutsceneOpen, seen: g.save.seenCut.slice() };
    // 点两下：补完 → 收起
    // ⚠ 全文长度读 ui._cutFull（打字机刚开始跑时 DOM 里还是空的，量出来是 0）
    const textFullLen = (g.ui._cutFull || '').length;
    g.ui.cutTap();
    const afterTap1 = document.getElementById('cutText').textContent.length;
    g.ui.cutTap();
    const afterTap2 = g.ui.cutsceneOpen;
    // ② 再进一次 → 不该再放
    // ⚠ 中间那次 enterMap 自己也会放一张过场（那张图也没看过），必须先关掉 ——
    //   不关的话量到的是**上一张图**的过场，看起来像"二次进入又放了"。
    g.enterMap('calm-bay');
    g.ui.cutTap(); g.ui.cutTap();
    const midClosed = g.ui.cutsceneOpen;
    g.enterMap('polar');
    const second = g.ui.cutsceneOpen;
    return { first, textFullLen, afterTap1, afterTap2, midClosed, second };})())`));
  check('C2 过场：**每张图只放一次**；点第一下补完、点第二下收起',
    c2.first.open === true && c2.first.seen.includes('polar')
    && c2.afterTap1 === c2.textFullLen && c2.afterTap2 === false
    && c2.midClosed === false && c2.second === false,
    `首次 open=${c2.first.open}（已记 ${c2.first.seen.join(',')}）· 补完 ${c2.afterTap1}/${c2.textFullLen} 字 · 再点 open=${c2.afterTap2} · 中间图关掉=${!c2.midClosed} · 二次进入 open=${c2.second}`);

  const c3 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    // 三行：换行符应该正好 2 个
    g.save.seenCut = [];
    g.enterMap('calm-bay');
    const txt = document.getElementById('cutText');
    const full = (g.ui._cutFull || '');
    const lines = full.split('\\n');
    g.ui.cutTap(); g.ui.cutTap();
    return { lines: lines.length, chars: full.length, empty: lines.filter(x=>!x).length };})())`));
  check('C3 过场**只有 3 行**（多一行就变成"要我读东西"）',
    c3.lines === 3 && c3.empty === 0 && c3.chars > 10,
    `${c3.lines} 行 · ${c3.chars} 字`);

  const c4 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    // 给本图所有鱼打上图鉴，然后数注脚
    for (const d of cfg.SPECIES) if (cfg.mapOfSpecies(d).id === g.map.id) g.save.codex[d.id] = { n: 1, best: 1 };
    g.openPhone(); g.ui.openApp('codex');
    const items = [...document.querySelectorAll('#pApp .cx-item')];
    const notes = [...document.querySelectorAll('#pApp .cx-note')].map(e=>e.textContent);
    const withNote = items.filter(it=>it.querySelector('.cx-note')).length;
    return { items: items.length, withNote, notes: notes.slice(0,3) };})())`));
  check('C4 图鉴注脚：**有注脚的鱼才显示**（不是每条都有），内容来自 story.js',
    c4.items > 0 && c4.withNote > 0 && c4.withNote < c4.items,
    `${c4.withNote} / ${c4.items} 条鱼带注脚 · 例「${c4.notes[0] || ''}」`);
  await shot('C4-codex-note');

  // ═══════════════════════════════════════════════════════════
  // D 冒烟
  // ═══════════════════════════════════════════════════════════
  console.log('\n── D 冒烟 ──');

  const smoke = J(await ev(`(()=>{try{const g=window.__game; const cfg=window.__cfg;
    g.closePhone(); g.ui.hideOverlay();
    g.save.levels = Object.fromEntries(cfg.UPGRADE_ORDER.map(k=>[k, k==='winch'?0:cfg.MAX_LEVEL]));
    g.applyUpgrades();
    g.showIdle();
    for (let i=0;i<10;i++) g._update(1/60);
    g.enterDescend();
    const seen = new Set();
    for (let i=0;i<60*90;i++) { g._update(1/60); seen.add(g.state); if (g.state === 'result') break; }
    return JSON.stringify({ seen: [...seen], caught: g.run.caught, sms: g.save.sms.length });
    }catch(e){return JSON.stringify({ err: e.message });}})()`));
  check('D1 带剧情系统跑完整一竿（下潜 → 收线 → 上升 → 空中 → 结算）',
    smoke.seen.includes('descend') && smoke.seen.includes('ascend') && smoke.seen.includes('result'),
    `${smoke.seen.join(' → ')} · 串上 ${smoke.caught} 条 · 已发短信 ${smoke.sms} 条`);

  const clean = errors.filter((e) => !/favicon|AudioContext/i.test(e));
  check('D2 全程控制台零报错', clean.length === 0, clean.slice(0, 3).join(' | ') || 'clean');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n================  ${pass}/${results.length} 通过  ================\n`);
  fs.writeFileSync(path.resolve('.dev/verify12.json'),
    JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  if (pass !== results.length) process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
}
