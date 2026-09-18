/**
 * verify7.mjs — 批 1（数值重标定：11 项 × 20 级）的回归验证
 *
 * 覆盖：
 *   A 数值表本身（纯 Node，不开浏览器）
 *     · 13 条曲线 × 21 级无缺口
 *     · **索引 0~4 冻结 = v0.1 现值**（这是保住前四套回归 + 不用换 SAVE_KEY 的前提）
 *     · 每条曲线单调不减、成本随等级严格递增
 *     · lvAt 对残缺/越界等级给出有限值（不是 NaN）
 *   B 商店 UI：11 项 / 3 个分层标题 / 20 格进度条 / 分段封顶
 *   C 6 个新升级项真的作用到 game 实例上（绞盘 / 鱼护 / 保险 / 声呐 / 鱼饵 / 加固）
 *   D 抗残缺存档：只有旧 5 键的 levels 不会把物理搞成 NaN
 *   E 控制台零报错
 *
 * 用法：node .dev/verify7.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../src/config.js';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.VB_PORT || 9363);   // ⚠ 可用 VB_PORT 覆盖：上一次跑被打断时 Chrome 会占着端口，新一轮会"连到旧现场"
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v7');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  · ' + detail : ''}`);
}

// ═══════════════════════════════════════════════════════════
// A 组 — 数值表（纯 Node，不需要浏览器）
// ═══════════════════════════════════════════════════════════
console.log('\n── A 数值表 ──');

const { LEVELS, MAX_LEVEL, UPGRADES, UPGRADE_ORDER, GROWTH, upgradeCost, lvAt, maxLvOf, MAP_LEVEL_CAP } = C;
const ROWS = Object.keys(LEVELS);

check('A1 曲线条数 = 7，每条都是 21 级（0~20）无缺口',
  ROWS.length === 7 && ROWS.every((k) => LEVELS[k].length === MAX_LEVEL + 1),
  `${ROWS.length} 条 · ${ROWS.join('/')}`);

check('A2 每条曲线的值都是有限数（没有 NaN / undefined 洞）',
  ROWS.every((k) => LEVELS[k].every((v) => Number.isFinite(v))),
  ROWS.filter((k) => LEVELS[k].some((v) => !Number.isFinite(v))).join(',') || '全部有限');

// 冻结位：这几条是 v0.1 就存在的曲线，索引 0~4 逐位不变。
//
// ⚠ v0.2「水下世界整体放大 2 倍」把这一整组**重新标定**了一次：
//   宁静海湾的海域边界从 55/120/195/275/430 变成 110/240/390/550/860，
//   maxDepth[0..4] 也跟着从 80/150/240/330/420 变成 320/450/580/710/840。
//   老存档**不需要换 SAVE_KEY**：存档里存的是"等级"（Lv0~Lv4），不是数值本身，
//   等级含义变了只是让老档的装备变强，不会读出 undefined 把物理打成 NaN。
//
// ⚠ v0.4 移除了 blastRadius / damage 两条曲线（攻击力改成乘数曲线 gunPower）。
// ⚠ v0.5 **又移除了 5 条**：descendSpeed（铅坠改直达深度）、ascendSpeed（绞盘改一次性工具）、
//   gunPower（攻击力并入 GUNS[].dmg）、insurance、sonar、rig（三项机制整体删除）。
//   所以冻结位只剩 4 条 —— 这是**设计变更**，不是回归。
const FROZEN = {
  maxDepth: [320, 450, 580, 710, 840],
  hookRadius: [8, 10.4, 12.8, 15.2, 17.6],
  lampRadius: [52, 92, 136, 184, 240],
  lampPower: [0.10, 0.30, 0.48, 0.66, 0.84],
};
const frozenBad = Object.entries(FROZEN)
  .filter(([k, v]) => !v.every((x, i) => LEVELS[k][i] === x))
  .map(([k]) => k);
check('A3 索引 0~4 冻结 = v0.2 现值（保住前四套回归 + 老存档不用换 key）',
  frozenBad.length === 0, frozenBad.length ? '被改动：' + frozenBad.join(',') : '4 条曲线逐位一致');

// 铅坠（v0.5）：曲线语义从"下潜速度"换成"可直接跳过的最大深度"。
// Lv0 = 80 是刻意的 —— 它让"直达深度"从开局就有一点用，而不是买了才从 0 开始。
// 上限 Lv20 = 1540 = 最深地图 2200 的 70%（和 TUNING.DROP_MAX_RATIO 同一个口径）。
check('A3b 铅坠 dropDepth：Lv0 = 80、Lv20 = 1540（= 2200 × 70%）、单调递增',
  LEVELS.dropDepth[0] === 80 && LEVELS.dropDepth[20] === 1540
  && LEVELS.dropDepth.every((v, i) => i === 0 || v > LEVELS.dropDepth[i - 1]),
  `${LEVELS.dropDepth[0]} → ${LEVELS.dropDepth[20]}`);

// 等级越高越强，不能出现"升了一级反而变差"
const nonMono = ROWS.filter((k) => LEVELS[k].some((v, i) => i > 0 && v < LEVELS[k][i - 1]));
check('A4 每条曲线单调不减（升级不会变成削弱）',
  nonMono.length === 0, nonMono.length ? '倒退：' + nonMono.join(',') : `${ROWS.length} 条全部单调`);

const costBad = [];
for (const k of UPGRADE_ORDER) {
  const top = maxLvOf(k);
  if (upgradeCost(k, 0) !== UPGRADES[k].base) costBad.push(k + ':Lv0≠base');
  for (let l = 1; l < top; l++) {
    if (!(upgradeCost(k, l) > upgradeCost(k, l - 1))) costBad.push(`${k}:Lv${l} 没变贵`);
  }
  // ⚠ 满级判断要用**该项自己的上限**：一次性工具（绞盘）只到 Lv1，
  //   拿 MAX_LEVEL 去比会让它在 lv=1 时还算"能买"（价格 Infinity，按钮永远点不动）。
  if (upgradeCost(k, top) !== Infinity) costBad.push(k + ':满级还能买');
}
check('A5 升级成本随等级严格递增、Lv0 = base、满级为 Infinity（上限走 maxLvOf）',
  costBad.length === 0, costBad.join(',') || `GROWTH=${GROWTH} · 鱼线 150→700→226527 · 绞盘 ${upgradeCost('winch', 0)} 一次买断`);

check('A6 lvAt 对残缺/越界等级给出有限值（NaN 会静默毁掉物理）',
  lvAt('dropDepth', undefined) === 80 && lvAt('creelLimit', -5) === 8
  && lvAt('maxDepth', 999) === 2200 && lvAt('bait', 1e9) === 100,
  `undefined→${lvAt('dropDepth', undefined)} / −5→${lvAt('creelLimit', -5)} / 999→${lvAt('maxDepth', 999)}`);

const tierSet = new Set(UPGRADE_ORDER.map((k) => UPGRADES[k].tier));
check('A7 升级项齐全、分 3 个梯度、都有分层与图标键',
  UPGRADE_ORDER.length === Object.keys(UPGRADES).length && tierSet.size === 3
  && UPGRADE_ORDER.every((k) => UPGRADES[k] && UPGRADES[k].icon && UPGRADES[k].name),
  `${UPGRADE_ORDER.length} 项 · 梯度 ${[...tierSet].join('/')}`);

// v0.5 新增：一次性工具（绞盘）。它没有等级曲线，所以"能不能再买"完全由 maxLvOf 决定。
const oneShots = UPGRADE_ORDER.filter((k) => UPGRADES[k].oneShot);
check('A7b 一次性工具（oneShot）上限为 1、有 base 价格、且不参与等级曲线',
  oneShots.length >= 1
  && oneShots.every((k) => maxLvOf(k) === 1 && UPGRADES[k].base > 0)
  && oneShots.every((k) => !ROWS.some((r) => r === k)),
  `${oneShots.join(',')} · 上限 ${oneShots.map((k) => maxLvOf(k)).join(',')} · 价格 ${oneShots.map((k) => UPGRADES[k].base).join(',')}`);

check('A8 MAP_LEVEL_CAP 是本图的等级闸门（当前单地图 = 20）',
  Array.isArray(MAP_LEVEL_CAP) && C.levelCapForMap(0) === MAP_LEVEL_CAP[0]
  && C.levelCapForMap(99) === MAP_LEVEL_CAP[MAP_LEVEL_CAP.length - 1],
  `MAP_LEVEL_CAP=[${MAP_LEVEL_CAP}] · 第 0 张=${C.levelCapForMap(0)}`);

// ── A9 夹具完整性门禁（把 `.dev/fixtures.mjs` 的承诺变成一条会挂的断言）──
/**
 * `fixtures.mjs` 的注释里写着"门禁：verify7 的 A9 会扫所有 `.dev/**\/*.mjs`"，
 * 但**这条断言一直没写** —— 于是 verify5 的 `levels` 夹具在手写列表里烂了两个版本
 * （还留着 v0.5 已经删掉的 power / insurance / sonar / rig 四个键）。
 *
 * 规则：任何 `levels: {` 字面量必须满足其一，否则挂掉 ——
 *   ① `levels: levelsOf({...})`（键集跟着 `UPGRADE_ORDER` 现铺，推荐写法）
 *   ② 行内含展开 `...`（叠加在完整夹具之上，比如 `{ ...base.levels, x: 1 }`）
 *   ③ 带 `@partial-save` 标记（**故意残缺**：抗残缺存档测试要用）
 *
 * 为什么值得一条断言：漏键的症状是**不报错、不闪退，只是鱼再也钓不上来**
 * （`lvAt` 拿到 `undefined` 会钳到 0，NaN 顺着物理链污染）。这坑踩过两次，
 * 排查成本极高，所以宁可让它在回归里挂掉。
 */
const FIXTURE_SKIP_FILES = new Set([
  // C4：verify.mjs 是迭代 2 的基线，从 v0.4 起就坏了（引用已删除的 `g.blast`），
  // 已明确标成"已失效、不参与回归"（STRUCTURE.md §5）。不修它，也不扫它。
  path.resolve('.dev/verify.mjs'),
]);
function scanFixtureLiterals() {
  const bad = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        // 跳过浏览器 profile / 缓存目录：几万个小文件，而且里面是**旧代码的副本**，
        // 扫它们既慢又会报一堆假阳性。
        if (/^(profile-|shots-|\.chrome)/.test(e.name)) continue;
        walk(p);
        continue;
      }
      if (!e.name.endsWith('.mjs') || FIXTURE_SKIP_FILES.has(p)) continue;
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (!/(^|[^\w.])levels\s*:\s*\{/.test(l)) return;
        // 注释行不算（比如本断言自己的说明文字里就有 `levels: {` 这个片段）
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
        if (l.includes('...')) return;                       // ② 叠在完整夹具上
        if (/@partial-save/.test(l + (lines[i - 1] || ''))) return;   // ③ 故意残缺
        bad.push(`${path.relative('.', p).replace(/\\/g, '/')}:${i + 1}  ${l.trim().slice(0, 64)}`);
      });
    }
  };
  walk(path.resolve('.dev'));
  return bad;
}
const fixtureBad = scanFixtureLiterals();
check('A9 所有 .dev 脚本的 levels 夹具都从 UPGRADE_ORDER 现铺（不漏键、不留已删除的项）',
  fixtureBad.length === 0,
  fixtureBad.length ? `${fixtureBad.length} 处手写：${fixtureBad.slice(0, 3).join(' | ')}` : '扫过全部脚本，0 处手写');

// ═══════════════════════════════════════════════════════════
// 浏览器部分
// ═══════════════════════════════════════════════════════════
async function getTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch (_) { /* 还没起来 */ }
    await sleep(300);
  }
  throw new Error('Chrome CDP 未就绪（静态服务器没开？先跑 python -m http.server 8899）');
}

const profile = path.resolve('.dev/profile-v7-' + Date.now());
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
      errors.push('EXCEPTION: ' + (d.exception?.description || d.text));
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
  const rafWait = (ms) => ev(`new Promise((res)=>{const t0=performance.now();
    const tick=()=>{ if(performance.now()-t0>=${ms}) res('ok'); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);})`);

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3400);

  const boot = J(await ev('JSON.stringify({game: !!window.__game, state: window.__game && window.__game.state})'));
  if (!boot.game) throw new Error('游戏没起来：' + JSON.stringify(boot));

  // 冻结 rAF → 手动定步长（和 verify5/6 同一套）
  await ev(`(()=>{const g=window.__game; g._loop = () => {};
    window.step = (n) => { const dt0 = 1/60;
      for (let i=0;i<n;i++){
        if (g.slowmoT > 0) { g.slowmoT -= dt0; if (g.slowmoT <= 0) g.timeScale = 1; }
        const dt = dt0 * g.timeScale; g.time += dt; g._update(dt);
      }
      g.world.render(); return 'ok';
    }; return 'ok';})()`);
  await ev('document.getElementById("startBtn").click()');
  await ev('window.step(10)');
  await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);

  // ═════════════════════════════════════════════════════════
  console.log('\n── B 商店 UI ──');
  // ═════════════════════════════════════════════════════════
  await ev(`(()=>{const g=window.__game;
    g.save.coins = 99999999;
    g.openPhone(); g.ui.openApp('shop'); return 'ok';})()`);
  await rafWait(420);

  const shop = J(await ev(`JSON.stringify((()=>{
    const items = [...document.querySelectorAll('#pApp .item')];
    const heads = [...document.querySelectorAll('#pApp .tier-h')].map(e=>e.textContent);
    const cfg = window.__cfg;
    // 一次性工具（绞盘）没有等级曲线：不画进度条、也没有「当前 → 下一级」。
    // 所以 B2/B3 的分母不是"全部项"，而是**走等级曲线的那几项**。
    const curveKeys = cfg.UPGRADE_ORDER.filter(k => !cfg.UPGRADES[k].oneShot);
    const curveItems = items.filter(i => !i.querySelector('.lv').textContent.includes('拥有'));
    // v0.7 第三批：锁定的项（首图的鱼护 / 鱼饵 / 绞盘）是**暗行** ——
    // 不画进度条、不写「当前 → 下一级」，改成一行「待解锁」提示。
    // 所以 B2/B3 的分母进一步缩小成"开架曲线项"，锁定项单独断言。
    const lockedItems = items.filter(i => i.classList.contains('locked-row'));
    const openCurve = curveItems.filter(i => !i.classList.contains('locked-row'));
    return {
      n: items.length, total: cfg.UPGRADE_ORDER.length,
      curveN: curveItems.length, curveTotal: curveKeys.length,
      lockedN: lockedItems.length,
      openCurveN: openCurve.length,
      lockHints: lockedItems.filter(i => i.querySelector('.lock-hint')).length,
      // v0.7：进度条只画**本图这一段**（首图 = MAP_LEVEL_CAP[0] 格），不再画满 20 格
      segExpect: cfg.MAP_LEVEL_CAP[0],
      heads, tierTotal: new Set(cfg.UPGRADE_ORDER.map(k => cfg.UPGRADES[k].tier)).size,
      pipsPerItem: openCurve.map(i=>i.querySelectorAll('.pips i').length),
      lockedPips: lockedItems.map(i=>i.querySelectorAll('.pips i').length),
      pipsOnOneShot: items.filter(i => i.querySelector('.lv').textContent.includes('拥有'))
        .map(i => i.querySelectorAll('.pips i').length),
      icons: items.filter(i=>i.querySelector('.icon svg')).length,
      nx: openCurve.filter(i=>/→/.test(i.querySelector('.ds').textContent)).length,
      lockedNx: lockedItems.filter(i=>/→/.test(i.querySelector('.ds').textContent)).length,
      lvText: items[0].querySelector('.lv').textContent.trim(),
      firstVal: items[0].querySelector('.nx').textContent.trim(),
    };
  })())`));

  check('B1 商店列出全部升级项，并按梯度分组（项数从 config 现取）',
    shop.n === shop.total && shop.heads.length === shop.tierTotal,
    `${shop.n} 项（应 ${shop.total}）· 梯度 ${shop.heads.length}/${shop.tierTotal} · 标题 ${JSON.stringify(shop.heads)}`);
  check('B2 开架曲线项的进度条格数 = 本图开放的段数；锁定的项不画条、改画「待解锁」提示（v0.7 第三批）',
    shop.pipsPerItem.length === shop.openCurveN
    && shop.pipsPerItem.every((x) => x === shop.segExpect)
    && shop.lockedPips.every((x) => x === 0)
    && shop.lockHints === shop.lockedN
    && shop.pipsOnOneShot.every((x) => x === 0),
    `开架曲线项 ${shop.pipsPerItem.length}/${shop.openCurveN} 各 ${shop.pipsPerItem[0]} 格 · 锁定 ${shop.lockedN} 项（提示 ${shop.lockHints}）· 一次性项格数 ${JSON.stringify(shop.pipsOnOneShot)}`);
  check('B3 每项都有内联 SVG 图标；开架曲线项都有「当前 → 下一级」，锁定的项不泄数值（v0.7 第三批）',
    shop.icons === shop.total && shop.nx === shop.openCurveN && shop.lockedNx === 0,
    `${shop.icons}/${shop.total} 有图标 · 开架 ${shop.nx}/${shop.openCurveN} 有 → · 锁定项带 → 的 ${shop.lockedNx} · 例：${shop.lvText} ${shop.firstVal}`);

  // 分段封顶：把本图的闸门临时压到 3
  const cap = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    const keep = cfg.MAP_LEVEL_CAP[0];
    cfg.MAP_LEVEL_CAP[0] = 3;
    g.save.levels.line = 3;
    g.ui.refreshApp();
    const b = document.querySelector('#pApp .buy[data-k="line"]');
    const out = { text: b.textContent.trim(), disabled: b.disabled, cls: b.className };
    cfg.MAP_LEVEL_CAP[0] = keep;
    return out;})())`));
  check('B4 本图买满后按钮变「本图满级」（换地图的信号，不是硬性 MAX）',
    cap.text === '本图满级' && cap.disabled === true && /cap/.test(cap.cls),
    `「${cap.text}」disabled=${cap.disabled}`);

  const poor = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.save.levels.line = 0;
    g.save.coins = 0; g.ui.refreshApp();
    const b = document.querySelector('#pApp .buy[data-k="line"]');
    const item = b.closest('.item');
    const out = { poor: b.disabled, poorAfford: item.classList.contains('afford') };
    g.save.coins = 99999999; g.ui.refreshApp();
    const b2 = document.querySelector('#pApp .buy[data-k="line"]');
    const item2 = b2.closest('.item');
    out.rich = b2.disabled; out.richAfford = item2.classList.contains('afford');
    return out;})())`));
  check('B5 金币不足时买不起（灰掉），金币够时亮起',
    poor.poor === true && poor.rich === false && poor.richAfford === true,
    `没钱 disabled=${poor.poor} → 有钱 disabled=${poor.rich}（afford=${poor.richAfford}）`);

  // ── B10/B11 分段解锁（A1）：`UPGRADES[*].unlockMap` =「拿到某张图的许可证才上架」──
  // 在 v0.6 之前这个字段全是 null，`ui.js` 的「未解锁」分支**写好了却从没触发过** ——
  // 也就是说 A1 这条风险此前既没有实现、也没有断言守着。
  const lockUi = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    const read = () => { const b=document.querySelector('#pApp .buy[data-k="winch"]');
      return { text: b.textContent.trim(), disabled: b.disabled, cls: b.className }; };
    g.save.coins = 99999999; g.save.levels.winch = 0;
    // v0.7 第二批：解锁判定改成"到没到过那张图"（许可证退役）——
    // 所以这里用"没有海图 / 没有船"来模拟"还没去过极地"。
    g.save.chart = false; g.save.boats = { owned: [], current: null };
    g.save.licenses = []; g.ui.refreshApp();
    const locked = read();
    // 老存档的兜底：**已经买过绞盘**、但还没拿到极地许可证
    g.save.levels.winch = 1; g.ui.refreshApp();
    const owned = read();
    g.save.levels.winch = 0;
    g.save.chart = true; g.save.boats = { owned: ['golden'], current: 'golden' };
    g.ui.refreshApp();
    const open = read();
    const u = cfg.UPGRADES.winch;
    g.save.licenses = [];
    return { locked, owned, open, price: u.base, unlockMap: u.unlockMap };})())`));
  check('B10 分段解锁：没有许可证时该项「未解锁」且不可点，拿到之后回到可购买状态',
    lockUi.locked.text === '未解锁' && lockUi.locked.disabled === true
    && lockUi.open.disabled === false && !/lock/.test(lockUi.open.cls)
    && new RegExp(String(lockUi.price).replace(/(\d)(?=(\d{3})+$)/g, '$1,?')).test(lockUi.open.text),
    `未持有「${lockUi.unlockMap}」时「${lockUi.locked.text}」(disabled=${lockUi.locked.disabled})`
    + ` · 持有后「${lockUi.open.text}」(disabled=${lockUi.open.disabled})`);
  check('B11 老存档兜底：已买过绞盘但还没拿到极地许可证 → 显示「已拥有」而不是「未解锁」',
    lockUi.owned.text === '已拥有' && lockUi.owned.disabled === true,
    `「${lockUi.owned.text}」disabled=${lockUi.owned.disabled}`);

  // ── B12 首图是"新手图"（v0.7）───────────────────────────────
  // 首图货架 = 4 项基础；鱼护 / 鱼饵 / 绞盘都要换图之后才上架。
  // 这条守的是"分段解锁的名单本身"：以后谁把某一项的 unlockMap 去掉/改了，这里会挂。
  const shelf = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.save.licenses = []; g.save.coins = 9999999; g.save.levels.winch = 0;
    g.save.chart = false; g.save.boats = { owned: [], current: null };
    g.ui.refreshApp();
    const locked = [...document.querySelectorAll('#pApp .buy.lock')].map(b=>b.dataset.k).sort();
    const want = cfg.UPGRADE_ORDER.filter(k => cfg.UPGRADES[k].unlockMap).sort();
    const open = cfg.UPGRADE_ORDER.filter(k => !cfg.UPGRADES[k].unlockMap);
    return { locked, want, open,
      segPips: document.querySelector('#pApp .item .pips') ? document.querySelector('#pApp .item .pips').children.length : -1,
      lvText: document.querySelector('#pApp .item .lv').textContent.trim(),
      note: document.querySelector('#pApp .p-note').textContent.replace(/\\s+/g,' ').trim() };
  })())`));
  check('B12 首图（新手图）只上架 4 项基础：带 unlockMap 的 3 项全部锁着、进度条只画本图段',
    shelf.locked.join(',') === shelf.want.join(',') && shelf.locked.length === 3
    && shelf.open.length === 4 && shelf.segPips === 5 && /^Lv\.0 \/ 5$/.test(shelf.lvText)
    && !/20/.test(shelf.note),
    `锁住 ${shelf.locked.join('/')} · 开架 ${shelf.open.join('/')} · 进度条 ${shelf.segPips} 格 · 标签「${shelf.lvText}」· 说明「${shelf.note}」`);
  await shot('01-shop-rows');
  // 出图核对：**把商店切回"未解锁"那一版再截图** —— B10 读完之后 DOM 停在"已解锁"态，
  //   不切的话截出来的是 9,000 那一行，等于没验。
  //   断言只能证明它不可点，证明不了"它看起来不像是坏了"（没有价格的按钮最容易排版翻车）。
  await ev(`(()=>{const g=window.__game; g.save.licenses=[]; g.save.levels.winch=0; g.ui.refreshApp(); return 'ok';})()`);
  await rafWait(150);
  // ⚠ 滚动容器在历史上换过（`#pApp` 本体 ↔ 内层 `.p-app-body`），
  //   两个都设一遍最省事 —— 只设错的那个的话图看起来"没动"，白跑一轮。
  await ev(`(()=>{const a=document.getElementById('pApp'); const b=document.querySelector('#pApp .p-app-body');
    if(a) a.scrollTop=99999; if(b) b.scrollTop=99999; return 'ok';})()`);
  await rafWait(200);
  await shot('01b-shop-winch-locked');
  await ev(`(()=>{const a=document.getElementById('pApp'); const b=document.querySelector('#pApp .p-app-body');
    if(a) a.scrollTop=0; if(b) b.scrollTop=0; return 'ok';})()`);
  // 之后 B6 要量"最长的那一行"，所以把绞盘**放回货架**（有价格 + 有数值文案才量得准）
  await ev(`(()=>{const g=window.__game; g.save.chart=true; g.save.boats={owned:['golden'],current:'golden'}; g.ui.refreshApp(); return 'ok';})()`);
  await rafWait(150);

  // 商店每一行的「说明 · 当前 → 下一级」都要能塞进一行。
  // 折行不只是难看：那一行会比旁边高出 16px，整列看着像排版坏了。
  //
  // ⚠ 必须**渲染后实测**，不能拿 Lv0 的可用宽度去比字符串：
  //   ① 高等级的文案更长（"1033m → 1100m" 比 "80m → 150m" 长得多）；
  //   ② 高等级的成本数字也更长（"226,527" 比 "150" 宽 ~26px），
  //      按钮变宽 → 留给文字的宽度变窄。两个变化叠加，Lv0 量不出来。
  const rowFit = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    // ⚠ 量「不折行时需要多宽」必须用**纯布局**的办法，不要碰字体 API：
    //   本页面里 getComputedStyle 拿 font-size 会返回空字符串（踩过），
    //   探针 span 就退回浏览器默认 16px，量出来的宽度虚高 60%，报一堆假 FAIL。
    //
    // 做法：先记下可用宽度，再把这一格临时改成 nowrap 读 scrollWidth，最后原样还原。
    //   ① 必须先读 avail 再改样式 —— nowrap 会把 .item 顶宽，avail 跟着变；
    //   ② 还原必须和读取在同一段同步代码里（中间没有绘制），否则会把整行撑出面板。
    // ⚠ 不能用 scrollWidth 量：**scrollWidth 永远不会小于 clientWidth**，
    //   所以文字比容器短时会得到"刚好等于容器宽"，余量恒为 0 —— 溢出能测出来，
    //   但余量是假的。用 Range 量文字自身的盒子才是真实宽度。
    const needOf = (el) => {
      const a = el.style.whiteSpace, b = el.style.webkitLineClamp, c = el.style.display;
      el.style.display = 'block';
      el.style.webkitLineClamp = 'unset';
      el.style.whiteSpace = 'nowrap';
      const rg = document.createRange();
      rg.selectNodeContents(el);
      const w = rg.getBoundingClientRect().width;
      el.style.whiteSpace = a; el.style.webkitLineClamp = b; el.style.display = c;
      return Math.ceil(w);
    };
    // 逐级渲染，把每一级下 11 行的「文字需要多宽 / 实际能用多宽」都记下来。
    //
    // 不假设「最坏一定在最高级」：成本数字变长会让按钮变宽、把文字列挤窄，
    // 而文案本身也随等级变长，两个方向叠加，最坏点不一定落在端点上。逐级扫一遍最稳，
    // 代价只是 20 次 innerHTML 重建，几十毫秒的事。
    const over = [];
    const heights = new Set();
    let minAvail = 1e9, maxNeed = 0, sample = '', tight = null;
    g.save.coins = 99999999;
    for (let lv = 0; lv < cfg.MAX_LEVEL; lv++) {
      // ⚠ 一次性工具（绞盘）只到 Lv1：直接写 19 会让 upgradeCost 返回 Infinity，
      //   fmtCost(Infinity) 会把按钮文案写成 NaN。所以按**该项自己的上限**钳一次。
      for (const k of cfg.UPGRADE_ORDER) g.save.levels[k] = Math.min(lv, cfg.maxLvOf(k));
      g.applyUpgrades(); g.ui.refreshApp();
      const rows = [...document.querySelectorAll('#pApp .item')];
      rows.forEach((r, i) => {
        const k = cfg.UPGRADE_ORDER[i];
        const ds = r.querySelector('.ds');
        const avail = ds.clientWidth;          // ← 先读，再改样式
        const need = needOf(ds);
        minAvail = Math.min(minAvail, avail);
        maxNeed = Math.max(maxNeed, need);
        // 记下"余量最小"的那一行。
        // ⚠ 只报 min(可用) 和 max(需要) 会掩盖真实余量：两个极值可能来自不同的行，
        //   看着刚好卡边（180/180），实际某一行可能只剩 0px —— 下次改个字就折行了。
        if (!tight || avail - need < tight.gap) {
          tight = { k: k, lv: lv, need: need, avail: avail, gap: avail - need };
        }
        if (lv === 19 && k === 'line') sample = ds.textContent.trim();
        // 行高一致性只对**走等级曲线**的行成立：一次性工具没有进度条，
        // 天生比别的行矮一截（那是它的结构，不是排版坏了）。
        if (!cfg.UPGRADES[k].oneShot) heights.add(Math.round(r.getBoundingClientRect().height));
        if (need > avail + 0.5) {
          over.push({ k: k, lv: lv, need: need, avail: avail, text: ds.textContent.trim() });
        }
      });
    }
    // 自检：拿一个**肯定过长**的字符串量一次，确认这套办法真能测出「放不下」。
    // （这套断言前面已经因为测量方法本身写错而假通过两次，所以留一道防线。）
    const probeEl = document.querySelector('#pApp .item .ds');
    const probeAvail = probeEl.clientWidth;
    const keep = probeEl.textContent;
    probeEl.textContent = '这是一个明显长到一行放不下的描述文案 · 1234 → 5678m';
    const probeNeed = needOf(probeEl);
    probeEl.textContent = keep;
    const probeWorks = probeNeed > probeAvail + 0.5;

    // 还要确认没有横向溢出：.item 不能比它的容器 .shop-list 宽
    // （nowrap 那版就是把 .item 顶到 326px、撑出 318px 的列表，内容跑到面板外面）
    const items = [...document.querySelectorAll('#pApp .item')];
    const listW = document.querySelector('#pApp .shop-list').clientWidth;
    const widest = Math.max(...items.map((r) => Math.round(r.getBoundingClientRect().width)));

    for (const k of cfg.UPGRADE_ORDER) g.save.levels[k] = 0;
    g.save.coins = 0;
    g.applyUpgrades(); g.ui.refreshApp();
    // 同一个 key 在多个等级都超了的话，只留「超出最多」的那条 —— 报错信息才看得清是差多少
    const worst = {};
    for (const o of over) {
      if (!worst[o.k] || (o.need - o.avail) > (worst[o.k].need - worst[o.k].avail)) worst[o.k] = o;
    }
    const hs = [...heights].sort((a, b) => a - b);
    return { over: Object.values(worst), hits: over.length,
      minAvail: minAvail, maxNeed: maxNeed, sample: sample, tight: tight,
      probeWorks: probeWorks, probeNeed: probeNeed, probeAvail: probeAvail,
      listW: listW, widest: widest, heightSpread: hs.length > 1 ? hs[hs.length - 1] - hs[0] : 0,
      heights: hs };})())`));

  // 先把"尺子"本身验一遍：量不出溢出的尺子，量什么都是通过。
  check('B8 B6 的测量方法本身有效（能测出一个明显过长的字符串）',
    rowFit.probeWorks === true,
    `探针文本需 ${rowFit.probeNeed}px > 可用 ${rowFit.probeAvail}px`);

  check('B6 商店全部行在 0~19 级全程都不折行（逐级真实布局测量）',
    rowFit.over.length === 0,
    rowFit.over.length
      ? rowFit.over.map((x) => `${x.k} Lv${x.lv} 需 ${x.need} > 可用 ${x.avail}px「${x.text}」`).join(' / ')
      : `最紧的一行 ${rowFit.tight.k} Lv${rowFit.tight.lv}：需 ${rowFit.tight.need} / 可用 ${rowFit.tight.avail}px（余量 ${rowFit.tight.gap}px）· 例「${rowFit.sample}」`);
  check('B7 全部行行高全程一致（折行的那一行会高出 16px，一眼看出排版坏了）',
    rowFit.heightSpread === 0, `行高 ${JSON.stringify(rowFit.heights)}`);
  check('B9 商店一行不会横向溢出面板（.item 宽度 ≤ 列表宽度）',
    rowFit.widest <= rowFit.listW,
    `.item 最宽 ${rowFit.widest}px · .shop-list ${rowFit.listW}px`);

  // ═════════════════════════════════════════════════════════
  console.log('\n── C 各项升级真的作用到 game 实例上 ──');
  // ═════════════════════════════════════════════════════════
  const landed = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.closePhone();
    const set = (k, v) => { g.save.levels[k] = v; g.applyUpgrades(); };
    // 直接读 game 实例上落地的字段，而不是再去 config 里算一遍 ——
    // 这样测的是"升级真的作用到游戏上了"，而不是"config 的公式算对了"。
    const snap = () => ({
      drop: g.dropMax, creel: g.creelLimit, bait: g.baitBonus,
      sink: g.descendSpeed, asc: g.ascendSpeed, bump: g.bumpRadius, fine: g.pufferPenalty,
    });
    // ⚠ 鱼线要拉到 Lv4（840m），否则"70% 上限"会先把铅坠钳住，
    //   测出来的是 224 而不是铅坠等级真正允许的深度 —— 那是两条不同的断言。
    set('line', 4);
    for (const k of ['sinker','creel','bait']) set(k, 0);
    const base = snap();
    for (const k of ['sinker','creel','bait']) set(k, 20);
    const max = snap();
    // 铅坠拉满、但鱼线只有 Lv0（320m）时，上限必须被 70% 钳到 224
    set('sinker', 20); set('line', 0);
    const clamped = snap();
    for (const k of ['sinker','creel','bait']) set(k, 0);
    set('line', 0);
    g.showIdle();
    return { base, max, clamped };})())`));

  check('C1 铅坠：直达深度上限 80 → 588（Lv20 的 1540 被"鱼线 840 × 70%"钳住）',
    landed.base.drop === 80 && landed.max.drop === Math.round(840 * 0.7),
    `${landed.base.drop} → ${landed.max.drop}m（鱼线 840 的 70% = ${Math.round(840 * 0.7)}）`);
  check('C1b 换回浅图 / 短鱼线时上限跟着缩：鱼线 Lv0（320m）→ 铅坠满级也只能跳 224m',
    landed.clamped.drop === Math.round(320 * 0.7),
    `钳后上限 ${landed.clamped.drop}m（320 × 70%）`);
  check('C2 鱼护：一竿串鱼上限 8 → 60 条',
    landed.base.creel === 8 && landed.max.creel === 60,
    `${landed.base.creel} → ${landed.max.creel} 条`);
  check('C3 鱼饵：0 → 100% 高价鱼权重加成',
    landed.base.bait === 0 && landed.max.bait === 1,
    `${landed.base.bait} → ${landed.max.bait}`);
  // v0.5 删掉的那四项机制必须**彻底不再可改**：把相关升级项拉满，这四个量一动不动。
  // 这条盯的是"删干净"—— 只删 UI 不删生效路径的话，老存档里的等级还会继续偷偷影响手感。
  check('C4 已删除的四项机制彻底失效：下潜/收线速度、撞鱼判定、罚款全是常量',
    landed.base.sink === 100 && landed.max.sink === 100
    && landed.base.asc === 240 && landed.max.asc === 240
    && Math.abs(landed.base.bump - 8.4) < 1e-9 && Math.abs(landed.max.bump - 8.4) < 1e-9
    && landed.base.fine === 30 && landed.max.fine === 30,
    `下潜 ${landed.base.sink}/${landed.max.sink} · 收线 ${landed.base.asc}/${landed.max.asc} · 撞鱼 ${landed.base.bump}/${landed.max.bump} · 罚款 ${landed.base.fine}/${landed.max.fine}`);
  check('C5 全部落到有限数（没有一项算出 NaN）',
    [...Object.values(landed.base), ...Object.values(landed.max)].every((v) => Number.isFinite(v)), '');

  // 铅坠·直达深度：端到端 —— 开竿后钩子应该**直接出现在目标深度**
  const drop = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.save.levels.line = 4; g.save.levels.sinker = 20; g.applyUpgrades();   // 线 840 → 上限 588
    const cap = g.dropMax;
    const cast = (on, want) => {
      g.save.drop = { on, depth: want };
      g.showIdle(); g.enterDescend();
      let guard=0; while (g.castAir && guard++<400) window.step(1);
      return { y: +(-g.hook.y).toFixed(2), used: +g.dropUsed.toFixed(2), grace: +g.dropGraceT.toFixed(2) };
    };
    const off = cast(false, 400);
    const on = cast(true, 400);
    const over = cast(true, 99999);        // 超过上限 → 应被钳到 cap
    const under = cast(true, 1);           // 低于下限 → 应被钳到 DROP_MIN_DEPTH
    g.save.drop = { on: false, depth: 0 }; g.save.levels.sinker = 0; g.applyUpgrades(); g.showIdle();
    return { cap, off, on, over, under, min: cfg.TUNING.DROP_MIN_DEPTH };})())`));
  check('C6 关掉直达时钩子仍从水面开始下潜（这一竿没跳过任何深度）',
    drop.off.used === 0 && Math.abs(drop.off.y) < 40,
    `钩深 ${drop.off.y}m · dropUsed=${drop.off.used}`);
  check('C7 打开直达后钩子直接出现在目标深度，并拿到落地缓冲',
    Math.abs(drop.on.y - 400) < 0.01 && Math.abs(drop.on.used - 400) < 0.01 && drop.on.grace > 0,
    `钩深 ${drop.on.y}m · dropUsed=${drop.on.used} · 缓冲 ${drop.on.grace}s`);
  check('C8 目标深度被钳进 [DROP_MIN_DEPTH, 上限]（写 99999 和写 1 都越界不了）',
    Math.abs(drop.over.y - drop.cap) < 0.01 && Math.abs(drop.under.y - drop.min) < 0.01,
    `上限 ${drop.cap}m（写 99999 → ${drop.over.y}）· 下限 ${drop.min}m（写 1 → ${drop.under.y}）`);

  // 绞盘·快速回收：没买 → 按不动；买了 → 同一段上升耗时 ≈ 1/3；且本竿只能按一次。
  //
  // ⚠ 用"把钩子放到固定的 −120m 再强制上升、量帧数"的老办法（不要走"抛竿 → 等 → 收线"：
  //   上升起点会随触底自动收线的时机漂移，量出来的帧数没有可比性）。
  const fast = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const measure = (owned, use) => {
      g.save.levels.winch = owned; g.applyUpgrades();
      g.showIdle(); g.enterDescend();
      let guard=0; while (g.castAir && guard++<400) window.step(1);
      g.reelPre = 0; g.state = 'ascend';
      g.hook.setPosition(0, -120); g.hook.y = -120;
      g.fastReel = false;
      const first = use ? g.fastReelNow() : null;
      const second = use ? g.fastReelNow() : null;   // 第二次应被拒（本竿只能按一次）
      let n = 0;
      while (g.state === 'ascend' && n++ < 3000) window.step(1);
      return { n, first, second, used: g.fastReel };
    };
    const denied = measure(false, true);   // 没买绞盘：fastReelNow() 应返回 false
    const slow = measure(true, false);
    const fast = measure(true, true);
    // 按钮显隐：只有买了绞盘、且真的进入上升阶段才出现
    g.save.levels.winch = 0; g.applyUpgrades();
    g.showIdle(); g.state = 'descend'; g.reelPre = 0; g._beginAscend();
    const btnNo = document.getElementById('fastReelBtn').classList.contains('on');
    g.save.levels.winch = 1; g.applyUpgrades();
    g.state = 'descend'; g.reelPre = 0; g._beginAscend();
    const btnYes = document.getElementById('fastReelBtn').classList.contains('on');
    g.save.levels.winch = 0; g.applyUpgrades(); g.showIdle();
    return { denied, slow, fast, btnNo, btnYes };})())`));
  check('C9 没买绞盘时「快速回收」无效：按钮不出现，调用也被拒',
    fast.btnNo === false && fast.denied.first === false && fast.denied.used === false,
    `按钮 on=${fast.btnNo} · 调用返回 ${fast.denied.first} · fastReel=${fast.denied.used}`);
  check('C10 买了绞盘后按钮出现，按一下同一段上升耗时 ≈ 1/3',
    fast.btnYes === true && fast.slow.n >= 25
    && Math.abs(fast.fast.n / fast.slow.n - 1 / 3) < 0.1,
    `按钮 on=${fast.btnYes} · ${fast.slow.n} 帧 → ${fast.fast.n} 帧（比值 ${(fast.fast.n / fast.slow.n).toFixed(2)}，理论 0.33）`);
  check('C11 快速回收每竿只能按一次（第二次被拒，不能一路狂按）',
    fast.fast.first === true && fast.fast.second === false,
    `第一次 ${fast.fast.first} · 第二次 ${fast.fast.second}`);

  // 声呐（v0.5 已随升级项一起移除）：深度尺上不该再有探测带的任何痕迹。
  // 这条是"删干净"的另一半 —— C4 管的是数值不再生效，这里管的是 DOM 也不再存在。
  const sonarGone = J(await ev(`JSON.stringify((()=>{
    const r = document.getElementById('ruler');
    return { sonar: r.querySelectorAll('.sonar').length,
             band: r.querySelectorAll('.s-band').length,
             blip: r.querySelectorAll('.s-blip').length,
             hasMethod: typeof window.__game.ui.setSonar === 'function',
             pct: window.__game.sonarPct };
  })())`));
  check('C12 声呐已彻底移除：深度尺上没有探测带 DOM，game 上也没有 sonarPct',
    sonarGone.sonar === 0 && sonarGone.band === 0 && sonarGone.blip === 0
    && sonarGone.hasMethod === false && sonarGone.pct === undefined,
    `sonar=${sonarGone.sonar} band=${sonarGone.band} blip=${sonarGone.blip} setSonar=${sonarGone.hasMethod} sonarPct=${sonarGone.pct}`);

  // 鱼饵：直接量「本层最贵那条鱼的出现率」——这才是鱼饵承诺的东西。
  // （"全场平均身价"不是好指标：它天然被中层鱼稀释，满级也只有 +4~8%。）
  const bait = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg = window.__cfg;
    // 每层最贵的可钓鱼种 id
    const topOf = {};
    for (const z of cfg.ZONES) {
      const safe = cfg.SPECIES.filter(s => s.zones.includes(z.id) && !s.hazard);
      if (safe.length) topOf[z.id] = safe.slice().sort((a,b)=>b.value-a.value)[0].id;
    }
    // ⚠ 必须把 Math.random 换成**固定种子**的伪随机数，而且每次 run 都从同一个种子开始。
    //
    //   为什么：最贵鱼的占比本身只有 5% 上下，真随机采样时这条断言跑出过
    //   +30% / +53% / +61% 三种结果 —— 阈值卡在中间就是随机挂，属于"测试在掷骰子"。
    //   固定种子 + 两次 run 用**同一串**随机数（配对比较）之后：
    //     ① 结果完全可复现；② 两次的差异只剩"鱼饵本身造成的"，噪声被消掉。
    const realRandom = Math.random;
    let seed = 0;
    const resetSeed = () => { seed = 20260915; };
    Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const run = (lv) => {
      g.save.levels.bait = lv; g.applyUpgrades();
      resetSeed();                     // ← 配对：两次抽签的骰子完全相同
      let n = 0, top = 0;
      for (let i = 0; i < 200; i++) {
        g.spawnFish();
        for (const f of g.fish.active) {
          n++;
          if (f.def.id === topOf[cfg.zoneAtDepth(-f.mesh.position.y).id]) top++;
        }
      }
      return { n, top, rate: n ? top / n : 0 };
    };
    const a = run(0), b = run(20);
    g.save.levels.bait = 0; g.applyUpgrades();
    Math.random = realRandom;
    return { off: +(a.rate*100).toFixed(2), on: +(b.rate*100).toFixed(2), n: a.n };})())`));
  check('C11 鱼饵满级后「本层最贵那条鱼」的出现率明显上升（不是只改了个数字）',
    bait.on > bait.off * 1.3,
    `最贵鱼占比 ${bait.off}% → ${bait.on}%（相对 +${(((bait.on / bait.off) - 1) * 100).toFixed(0)}%）· 样本 ${bait.n} 条（固定种子）`);

  // 鱼护：满了挤掉最老的那条（不是新鱼串不上）
  const creel = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.save.levels.creel = 0; g.applyUpgrades();          // creelLimit = 8
    g.showIdle(); g.enterDescend();
    let guard=0; while (g.castAir && guard++<400) window.step(1);
    window.step(10);
    // ⚠ 池子里必须是**12 种不同名字**的鱼。
    //   这一组断言靠"第一行的名字变了"来判断"最老的那条被挤掉了"，
    //   而渔获面板每一行只写名字 —— 池子里出现两条同种鱼时（批 2 加了鱼群，
    //   同一海域会整群刷同种鱼），第 9 条和第 1 条名字一模一样，
    //   "第一行换人了"就测不出来，报成假 FAIL。
    //   直接按 SPECIES 取 12 个不同鱼种，和场上刷了什么解耦。
    const seenId = new Set(); const pool = [];
    for (const s of cfg.SPECIES) {
      if (pool.length >= 12) break;
      if (seenId.has(s.id)) continue;
      seenId.add(s.id);
      const f = g.fish.acquire(s);
      f.reset(g.hook.x, g.hook.y);
      pool.push(f);
    }
    const firstRow = () => (document.querySelector('#catchList .row .nm')||{}).textContent;
    const seq = [];
    for (const f of pool) {
      f.x = g.hook.x; f.y = g.hook.y; f.mesh.position.set(f.x, f.y, 0);
      const wasFirst = firstRow();
      g._catch(f);
      seq.push({ name: f.def.name, wasFirst, nowFirst: firstRow() });
    }
    // v0.7：满员之后**不再挤掉任何一条** —— 池子有 12 条而上限 8 条，
    //   所以"线上条数"应该正好停在上限，run.lost 必须是 0（旧口径这里会是 ≥ 4）。
    const escaped = pool.filter(f => f.immuneT > 0).length;
    const over = g.caught.length > g.creelLimit;
    const out = { limit: g.creelLimit, onLine: g.caught.length, lost: g.run.lost,
      rows: document.querySelectorAll('#catchList .row').length,
      count: document.getElementById('catchCount').textContent,
      escaped, over, autoFastReel: g.fastReel === true, fullDone: g._creelFullDone === true,
      firstStillSame: seq.length > 8 && seq[8].wasFirst === seq[8].nowFirst,
      keptNames: g.caught.map(f=>f.def.name) };
    g.showIdle();
    return out;})())`));
  check('C12 鱼护满了：**不再挤掉**最早那条，线上恒 = 上限、一条都没丢（v0.7 新口径）',
    creel.onLine === creel.limit && creel.over === false && creel.lost === 0
    && creel.firstStillSame === true,
    `上限 ${creel.limit} · 线上 ${creel.onLine} · 丢失 ${creel.lost} · 第一行没换人=${creel.firstStillSame}`);
  check('C13 满员 → 自动加速收线（每竿只触发一次，且不占绞盘那次手动机会）',
    creel.autoFastReel === true && creel.fullDone === true && creel.escaped === 0,
    `fastReel=${creel.autoFastReel} · 只触发一次=${creel.fullDone} · 被挤掉带免疫的 ${creel.escaped} 条`);
  check('C14 面板行数 = 线上条数 = 计数（满员之后不再减行）',
    creel.rows === creel.onLine && creel.count === String(creel.onLine),
    `面板 ${creel.rows} 行 / 计数 ${creel.count}`);

  // ═════════════════════════════════════════════════════════
  console.log('\n── D 抗残缺存档 ──');
  // ═════════════════════════════════════════════════════════
  const legacy = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    // 模拟"只存了 v0.1 那几项"的旧存档 / 手写的残缺 levels。
    // ⚠ 这里刻意**保留已经删掉的键**（power / sinker 之外的旧项）：
    //   老存档里一定有它们，读档必须无视而不是炸掉。
    g.save.levels = { line:2, hook:1, sinker:1, power:2, lamp:1, insurance:3, sonar:4, rig:5 };
    let err = '';
    try { g.applyUpgrades(); } catch (e) { err = e.message; }
    const keys = ['maxDepth','descendSpeed','ascendSpeed','creelLimit','bumpRadius',
                  'pufferPenalty','baitBonus','dropMax'];
    const vals = {};
    for (const k of keys) vals[k] = Number.isFinite(g[k]) ? g[k] : String(g[k]);
    const hookR = Number.isFinite(g.hook.radius) ? g.hook.radius : String(g.hook.radius);
    const lampR = Number.isFinite(g.world.lampR) ? g.world.lampR : String(g.world.lampR);
    return { err, vals, hookR, lampR,
      allFinite: keys.every(k=>Number.isFinite(g[k])) && Number.isFinite(g.hook.radius)
                 && Number.isFinite(g.world.lampR) };})())`));
  check('D1 残缺 levels（含已删除项的键）不会抛错，也不会把物理搞成 NaN',
    legacy.err === '' && legacy.allFinite === true,
    legacy.err || `line 2 → 鱼线 ${legacy.vals.maxDepth}m · 钩 ${legacy.hookR} · 灯 ${legacy.lampR} · 直达上限 ${legacy.vals.dropMax}m`);
  check('D2 缺失的项按 Lv0 / 常量兜底（收线 240 / 鱼护 8 / 罚款 30 / 下潜 100）',
    legacy.vals.ascendSpeed === 240 && legacy.vals.creelLimit === 8
    && legacy.vals.pufferPenalty === 30 && legacy.vals.descendSpeed === 100,
    `收线 ${legacy.vals.ascendSpeed} · 鱼护 ${legacy.vals.creelLimit} · 罚款 ${legacy.vals.pufferPenalty} · 下潜 ${legacy.vals.descendSpeed}`);

  // 存档往返：读档会把缺失项补齐成 0，而不是 undefined
  const roundtrip = J(await ev(`JSON.stringify((()=>{
    localStorage.setItem('hooked.save.v3', JSON.stringify({
      coins: 500, bestDepth: 120, casts: 3,
      levels: { line: 3, lamp: 2 },    // @partial-save —— 故意残缺，验的是"读档能把缺的补齐"
      codex: { sardine: { n: 2, best: 7 } } }));
    return { saved: true };})())`));
  await send('Page.navigate', { url: URL });
  // ⚠ 不要用固定 sleep 收尾：页面重启 + 首帧渲染的时间在不同机器上差很多，
  //   固定等待会偶发地读到"还没有 __game"的空页面（症状是整组 D 断言一起变 undefined）。
  //
  // ⚠⚠ 但**必须先让旧上下文死掉**再开始轮询。导航是异步的：`Page.navigate` 返回之后
  //   旧页面还会短暂存活，此时 `window.__game` 仍然存在 —— 一上来就轮询会立刻"成功"，
  //   然后在新页面还没启动的空窗期里去读，读到的全是 undefined。
  //   （这个坑让 D3/D4 假 FAIL 了两轮，所以两段等待都留着。）
  await sleep(1600);                       // ① 等旧上下文销毁 + 新文档开始加载
  let booted = false;
  for (let i = 0; i < 60; i++) {           // ② 再轮询到新页面真的起了 __game
    await sleep(200);
    if ((await ev('!!window.__game')) === true) { booted = true; break; }
  }
  await sleep(400);
  // ⚠⚠ 重载会丢掉测试自己注入的 `window.__cfg`（它是脚本加的，不是页面加的）。
  //   不重新注入的话，下面探针里的 `cfg.UPGRADE_ORDER` 会抛错 → ev 返回错误对象
  //   → JSON.parse 失败 → J() 给出 {__bad}，所有字段一起变 undefined。
  //   （这个坑让 D3/D4 连着假 FAIL 了三轮，教训是：**跨页面重载后所有测试注入都要重来一遍**。）
  await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);
  const reloaded = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    if (!g) return { err: 'no game' };
    const L = g.save.levels;
    const cfg = window.__cfg;
    return { line: L.line, lamp: L.lamp, winch: L.winch,
      nKeys: Object.keys(L).length, total: cfg.UPGRADE_ORDER.length,
      maxDepth: g.maxDepth, ascend: g.ascendSpeed, creel: g.creelLimit,
      allKeysZero: cfg.UPGRADE_ORDER.filter(k=>k!=='line'&&k!=='lamp').every(k=>L[k]===0),
      noGhostKeys: !('power' in L) && !('insurance' in L) && !('sonar' in L) && !('rig' in L) };})())`));
  check('D3 旧存档读回后，等级表按当前 UPGRADE_ORDER 重建（数量对、缺的补 0、已删的键不再出现）',
    booted === true && roundtrip.saved && reloaded.nKeys === reloaded.total && reloaded.allKeysZero === true
    && reloaded.noGhostKeys === true && reloaded.ascend === 240 && reloaded.creel === 8,
    `${reloaded.nKeys}/${reloaded.total} 个等级键 · 已删键残留=${!reloaded.noGhostKeys} · 收线 ${reloaded.ascend} · 鱼护 ${reloaded.creel}`);
  check('D4 旧存档里已有的等级照常生效（鱼线 Lv3 → 710m）',
    reloaded.line === 3 && reloaded.maxDepth === 710, `Lv${reloaded.line} → ${reloaded.maxDepth}m`);

  // ═════════════════════════════════════════════════════════
  console.log('\n── E 冒烟 ──');
  // ═════════════════════════════════════════════════════════
  await ev(`(()=>{const g=window.__game; g._loop = () => {};
    window.step = (n) => { const dt0 = 1/60;
      for (let i=0;i<n;i++){
        if (g.slowmoT > 0) { g.slowmoT -= dt0; if (g.slowmoT <= 0) g.timeScale = 1; }
        const dt = dt0 * g.timeScale; g.time += dt; g._update(dt);
      }
      g.world.render(); return 'ok'; }; return 'ok';})()`);
  // 不带假设地跑完一整竿：只推帧、只记录状态迁移，让"触底自动收线"这条真实路径生效。
  // （原来我在这里手动调 _reel()，结果下潜途中已经触底自动收线过一次，
  //   第二次 _reel() 被 `if (reelPre > 0) return` 挡掉，状态早就跑到 air 了。）
  const smoke = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    // 按当前 UPGRADE_ORDER 铺一份等级夹具（每一项都显式给值，不要手写键名 ——
    // 手写的话删/加一项升级就会漏键，漏键的症状是"鱼再也钓不上来"而不是报错）。
    g.save.levels = Object.fromEntries(cfg.UPGRADE_ORDER.map(k => [k, 0]));
    g.save.levels.sinker = 2;          // 给铅坠一点等级，顺带覆盖"直达深度"那段代码
    g.save.drop = { on: false, depth: 0 };
    g.applyUpgrades(); g.showIdle();
    g.enterDescend();
    const seen = [];
    let castAirFrames = 0;
    for (let i = 0; i < 4000; i++) {
      window.step(1);
      if (g.castAir) castAirFrames++;
      if (seen[seen.length - 1] !== g.state) seen.push(g.state);
      if (g.state === 'result' || (g.state === 'idle' && seen.length > 3)) break;
    }
    return { seen, caught: g.run.caught, castAirFrames,
      // 声呐已删除：这里顺带确认整竿跑下来深度尺上不会冒出探测带
      sonarNodes: document.querySelectorAll('#ruler .sonar').length };})())`));
  const sawDescend = smoke.seen.includes('descend');
  const sawAscend = smoke.seen.includes('ascend');
  const sawEnd = smoke.seen.includes('air') || smoke.seen.includes('result');
  check('E1 一整竿流程跑得通（下潜 → 收线 → 上升 → 空中 → 结算）',
    sawDescend && sawAscend && sawEnd,
    smoke.seen.join(' → '));
  check('E2 整竿跑完深度尺上都没有声呐探测带（该机制已彻底移除）',
    smoke.sonarNodes === 0, `sonar 节点 ${smoke.sonarNodes} 个`);

  const clean = errors.filter((e) => !/favicon|AudioContext/i.test(e));
  check('E3 全程控制台零报错', clean.length === 0, clean.slice(0, 3).join(' | ') || 'clean');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n================  ${pass}/${results.length} 通过  ================\n`);
  fs.writeFileSync(path.resolve('.dev/verify7.json'),
    JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  if (pass !== results.length) process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
}
