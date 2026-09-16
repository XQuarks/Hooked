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
const PORT = 9363;
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

const { LEVELS, MAX_LEVEL, UPGRADES, UPGRADE_ORDER, GROWTH, upgradeCost, lvAt, MAP_LEVEL_CAP } = C;
const ROWS = Object.keys(LEVELS);

check('A1 曲线条数 = 13，每条都是 21 级（0~20）无缺口',
  ROWS.length === 13 && ROWS.every((k) => LEVELS[k].length === MAX_LEVEL + 1),
  `${ROWS.length} 条 · ${ROWS.join('/')}`);

check('A2 每条曲线的值都是有限数（没有 NaN / undefined 洞）',
  ROWS.every((k) => LEVELS[k].every((v) => Number.isFinite(v))),
  ROWS.filter((k) => LEVELS[k].some((v) => !Number.isFinite(v))).join(',') || '全部有限');

// 冻结位：这 8 条是 v0.1 就存在的曲线，索引 0~4 逐位不变。
//
// ⚠ v0.2「水下世界整体放大 2 倍」把这一整组**重新标定**了一次：
//   宁静海湾的海域边界从 55/120/195/275/430 变成 110/240/390/550/860，
//   maxDepth[0..4] 也跟着从 80/150/240/330/420 变成 320/450/580/710/840。
//   老存档**不需要换 SAVE_KEY**：存档里存的是"等级"（Lv0~Lv4），不是数值本身，
//   等级含义变了只是让老档的装备变强，不会读出 undefined 把物理打成 NaN。
//   verify3 的 T8~T11 也同步断言 Lv4 的 840 / 17.6 / 136 / 240。
const FROZEN = {
  maxDepth: [320, 450, 580, 710, 840],
  hookRadius: [8, 10.4, 12.8, 15.2, 17.6],
  descendSpeed: [64, 82, 100, 118, 136],
  ascendSpeed: [240, 252, 264, 276, 288],
  blastRadius: [48, 56, 64, 72, 80],
  damage: [1, 2, 3, 4, 5],
  lampRadius: [52, 92, 136, 184, 240],
  lampPower: [0.10, 0.30, 0.48, 0.66, 0.84],
};
const frozenBad = Object.entries(FROZEN)
  .filter(([k, v]) => !v.every((x, i) => LEVELS[k][i] === x))
  .map(([k]) => k);
check('A3 索引 0~4 冻结 = v0.2 现值（保住前四套回归 + 老存档不用换 key）',
  frozenBad.length === 0, frozenBad.length ? '被改动：' + frozenBad.join(',') : '8 条曲线逐位一致');

// 等级越高越强，不能出现"升了一级反而变差"
const nonMono = ROWS.filter((k) => LEVELS[k].some((v, i) => i > 0 && v < LEVELS[k][i - 1]));
check('A4 每条曲线单调不减（升级不会变成削弱）',
  nonMono.length === 0, nonMono.length ? '倒退：' + nonMono.join(',') : '13 条全部单调');

const costBad = [];
for (const k of UPGRADE_ORDER) {
  if (upgradeCost(k, 0) !== UPGRADES[k].base) costBad.push(k + ':Lv0≠base');
  for (let l = 1; l < MAX_LEVEL; l++) {
    if (!(upgradeCost(k, l) > upgradeCost(k, l - 1))) costBad.push(`${k}:Lv${l} 没变贵`);
  }
  if (upgradeCost(k, MAX_LEVEL) !== Infinity) costBad.push(k + ':满级还能买');
}
check('A5 升级成本随等级严格递增、Lv0 = base、满级为 Infinity',
  costBad.length === 0, costBad.join(',') || `GROWTH=${GROWTH} · 鱼线 150→700→226527`);

check('A6 lvAt 对残缺/越界等级给出有限值（NaN 会静默毁掉物理）',
  lvAt('ascendSpeed', undefined) === 240 && lvAt('creelLimit', -5) === 8
  && lvAt('maxDepth', 999) === 2200 && lvAt('damage', 1e9) === 21,
  `undefined→${lvAt('ascendSpeed', undefined)} / −5→${lvAt('creelLimit', -5)} / 999→${lvAt('maxDepth', 999)}`);

const tierSet = new Set(UPGRADE_ORDER.map((k) => UPGRADES[k].tier));
check('A7 11 项升级齐全、分 3 个梯度、都有分层与图标键',
  UPGRADE_ORDER.length === 11 && tierSet.size === 3
  && UPGRADE_ORDER.every((k) => UPGRADES[k] && UPGRADES[k].icon && UPGRADES[k].name),
  `${UPGRADE_ORDER.length} 项 · 梯度 ${[...tierSet].join('/')}`);

check('A8 MAP_LEVEL_CAP 是本图的等级闸门（当前单地图 = 20）',
  Array.isArray(MAP_LEVEL_CAP) && C.levelCapForMap(0) === MAP_LEVEL_CAP[0]
  && C.levelCapForMap(99) === MAP_LEVEL_CAP[MAP_LEVEL_CAP.length - 1],
  `MAP_LEVEL_CAP=[${MAP_LEVEL_CAP}] · 第 0 张=${C.levelCapForMap(0)}`);

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
    return {
      n: items.length,
      heads,
      pipsPerItem: items.map(i=>i.querySelectorAll('.pips i').length),
      icons: items.filter(i=>i.querySelector('.icon svg')).length,
      nx: items.filter(i=>/→/.test(i.querySelector('.ds').textContent)).length,
      lvText: items[0].querySelector('.lv').textContent.trim(),
      firstVal: items[0].querySelector('.nx').textContent.trim(),
    };
  })())`));

  check('B1 商店列出 11 项升级，并按 3 个梯度分组',
    shop.n === 11 && shop.heads.length === 3, `${shop.n} 项 · 标题 ${JSON.stringify(shop.heads)}`);
  check('B2 每项都是 20 格进度条（5 颗点在这个宽度里会糊成一条线）',
    shop.pipsPerItem.length === 11 && shop.pipsPerItem.every((x) => x === 20),
    `每项 ${shop.pipsPerItem[0]} 格`);
  check('B3 每项都有内联 SVG 图标 + 「当前 → 下一级」数值文案',
    shop.icons === 11 && shop.nx === 11,
    `${shop.icons}/11 有图标 · ${shop.nx}/11 有 → · 例：${shop.lvText} ${shop.firstVal}`);

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
  await shot('01-shop-11');

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
      for (const k of cfg.UPGRADE_ORDER) g.save.levels[k] = lv;
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
        heights.add(Math.round(r.getBoundingClientRect().height));
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

  check('B6 商店 11 行在 0~19 级全程都不折行（逐级真实布局测量）',
    rowFit.over.length === 0,
    rowFit.over.length
      ? rowFit.over.map((x) => `${x.k} Lv${x.lv} 需 ${x.need} > 可用 ${x.avail}px「${x.text}」`).join(' / ')
      : `最紧的一行 ${rowFit.tight.k} Lv${rowFit.tight.lv}：需 ${rowFit.tight.need} / 可用 ${rowFit.tight.avail}px（余量 ${rowFit.tight.gap}px）· 例「${rowFit.sample}」`);
  check('B7 11 行行高全程一致（折行的那一行会高出 16px，一眼看出排版坏了）',
    rowFit.heightSpread === 0, `行高 ${JSON.stringify(rowFit.heights)}`);
  check('B9 商店一行不会横向溢出面板（.item 宽度 ≤ 列表宽度）',
    rowFit.widest <= rowFit.listW,
    `.item 最宽 ${rowFit.widest}px · .shop-list ${rowFit.listW}px`);

  // ═════════════════════════════════════════════════════════
  console.log('\n── C 6 个新升级项真的生效 ──');
  // ═════════════════════════════════════════════════════════
  const newOnes = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.closePhone();
    const out = {};
    const set = (k, v) => { g.save.levels[k] = v; g.applyUpgrades(); };
    const KEYS = ['winch','creel','insurance','rig','sonar','bait'];
    // 直接读 game 实例上落地的字段，而不是再去 config 里算一遍 ——
    // 这样测的是"升级真的作用到游戏上了"，而不是"config 的公式算对了"。
    const snap = () => ({
      winch: g.ascendSpeed, creel: g.creelLimit, fine: g.pufferPenalty,
      bump: g.bumpRadius, sonar: g.sonarPct, bait: g.baitBonus,
    });
    for (const k of KEYS) set(k, 0);
    out.base = snap();
    for (const k of KEYS) set(k, 20);
    out.max = snap();
    out.finite = Object.values(out.base).concat(Object.values(out.max))
      .every((v) => Number.isFinite(v));
    for (const k of KEYS) set(k, 0);
    g.showIdle();
    return out;})())`));

  check('C1 绞盘：上拉速度 240 → 480 m/s（v0.2 世界 ×2）',
    newOnes.base.winch === 240 && newOnes.max.winch === 480,
    `${newOnes.base.winch} → ${newOnes.max.winch}`);
  check('C2 鱼护：一竿串鱼上限 8 → 60 条',
    newOnes.base.creel === 8 && newOnes.max.creel === 60,
    `${newOnes.base.creel} → ${newOnes.max.creel} 条`);
  check('C3 保险：扣钱鱼罚款 30 → 6（减免 80%）',
    newOnes.base.fine === 30 && newOnes.max.fine === 6,
    `${newOnes.base.fine} → ${newOnes.max.fine}`);
  // ⚠ 不要写 `=== 1.68`：`4.2 * (1 - 60/100)` 在 IEEE754 下是 1.6800000000000002。
  //   这里比的是"减免比例"，顺带把浮点误差挡在外面，报错信息也更有用。
  check('C4 加固：下潜撞鱼判定半径 8.4 → 3.36（减免 60%）',
    Math.abs(newOnes.base.bump - 8.4) < 1e-9 && Math.abs(newOnes.max.bump - 3.36) < 1e-9,
    `${newOnes.base.bump} → ${newOnes.max.bump}（实际减免 ${(100 * (1 - newOnes.max.bump / newOnes.base.bump)).toFixed(0)}%）`);
  check('C5 声呐：0 → 100%（深度尺上的探测范围）',
    newOnes.base.sonar === 0 && newOnes.max.sonar === 1,
    `${newOnes.base.sonar} → ${newOnes.max.sonar}`);
  check('C6 鱼饵：0 → 100% 高价鱼权重加成',
    newOnes.base.bait === 0 && newOnes.max.bait === 1,
    `${newOnes.base.bait} → ${newOnes.max.bait}`);
  check('C7 六项全部落到有限数（没有一项算出 NaN）', newOnes.finite === true, '');

  // 绞盘真的让上升更快：把钩子放到固定的 −60m 再强制上升，量同一段距离的帧数。
  // （不要用"抛竿 → 等 → 收线"那套：上升起点会随触底自动收线的时机漂移，
  //   量出来的帧数没有可比性 —— 之前就在这里量出过"Lv20 只用 1 帧"的假数据。）
  const winchFrames = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const run = (lv) => {
      g.save.levels.winch = lv; g.applyUpgrades();
      g.showIdle(); g.enterDescend();
      let guard=0; while (g.castAir && guard++<400) window.step(1);
      g.reelPre = 0; g.state = 'ascend';
      g.hook.setPosition(0, -120); g.hook.y = -120;
      let n = 0;
      while (g.state === 'ascend' && n++ < 3000) window.step(1);
      return n;
    };
    const a = run(0), b = run(20);
    g.save.levels.winch = 0; g.applyUpgrades(); g.showIdle();
    return { slow: a, fast: b };})())`));
  const ratio = winchFrames.fast / winchFrames.slow;
  check('C8 绞盘满级后同一段（−120m → 水面）上升耗时减半',
    winchFrames.slow >= 25 && Math.abs(ratio - 0.5) < 0.12,
    `${winchFrames.slow} 帧 → ${winchFrames.fast} 帧（比值 ${ratio.toFixed(2)}，理论 0.50）`);

  // 声呐：探测带出现 + 带内有刻度；0 级时整层隐藏
  const sonar = J(await ev(`JSON.stringify((()=>{const g=window.__game; const ui = g.ui;
    const probe = () => ({
      on: document.querySelector('#ruler .sonar').classList.contains('on'),
      bandH: document.querySelector('#ruler .s-band').style.height,
      blips: document.querySelectorAll('#ruler .s-blip').length,
      hot: document.querySelectorAll('#ruler .s-blip.hot').length,
    });
    ui.setSonar(0);
    ui.setDepth(200, 420, 200);
    ui.setSonarBlips([{d:190,hot:false},{d:205,hot:true}]);
    const off = probe();
    ui.setSonar(1);
    ui.setDepth(200, 420, 200);
    // 带内两条（190/205）、带外两条（30 / 420）
    ui.setSonarBlips([{d:30,hot:false},{d:190,hot:false},{d:205,hot:true},{d:420,hot:true}]);
    const on = probe();
    return { off, on };})())`));
  check('C9 声呐 0 级时深度尺上没有探测带（不占视觉）',
    sonar.off.on === false && sonar.off.blips === 0, JSON.stringify(sonar.off));
  check('C10 声呐满级出现探测带，且只画带内的鱼（带外 2 条被滤掉，值钱的标金色）',
    sonar.on.on === true && sonar.on.blips === 2 && sonar.on.hot === 1
    && parseFloat(sonar.on.bandH) > 10,
    `带高 ${sonar.on.bandH} · 刻度 ${sonar.on.blips}（金 ${sonar.on.hot}）`);
  await ev(`(()=>{const g=window.__game; g.ui.setSonar(g.sonarPct); return 'ok';})()`);
  await shot('02-sonar');

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
    const escaped = pool.filter(f => f.immuneT > 0).length;
    const over = g.caught.length > g.creelLimit;
    const out = { limit: g.creelLimit, onLine: g.caught.length, lost: g.run.lost,
      rows: document.querySelectorAll('#catchList .row').length,
      count: document.getElementById('catchCount').textContent,
      escaped, over,
      firstWasReplaced: seq.length > 8 && seq[8].wasFirst !== seq[8].nowFirst,
      keptNames: g.caught.map(f=>f.def.name) };
    g.showIdle();
    return out;})())`));
  check('C12 鱼护满了：挤掉最早那条（不是新鱼串不上），线长恒 ≤ 上限',
    creel.onLine === creel.limit && creel.over === false && creel.lost >= 4,
    `上限 ${creel.limit} · 线上 ${creel.onLine} · 挣脱 ${creel.lost}`);
  check('C13 被挤掉的鱼回到水里并拿到免疫时间（不会被同一帧扫回来）',
    creel.escaped >= 4, `带免疫的鱼 ${creel.escaped} 条`);
  check('C14 渔获面板第一行随之下移，计数显示真实条数（不是被截断的行数）',
    creel.firstWasReplaced === true && creel.rows === creel.onLine
    && creel.count === String(creel.onLine),
    `面板 ${creel.rows} 行 / 计数 ${creel.count} · 第一行已换人=${creel.firstWasReplaced}`);

  // ═════════════════════════════════════════════════════════
  console.log('\n── D 抗残缺存档 ──');
  // ═════════════════════════════════════════════════════════
  const legacy = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    // 模拟"只存了 v0.1 那 5 项"的旧存档 / 手写的残缺 levels
    g.save.levels = { line:2, hook:1, sinker:1, power:2, lamp:1 };
    let err = '';
    try { g.applyUpgrades(); } catch (e) { err = e.message; }
    const keys = ['maxDepth','descendSpeed','ascendSpeed','creelLimit','bumpRadius',
                  'pufferPenalty','sonarPct','baitBonus'];
    const vals = {};
    for (const k of keys) vals[k] = Number.isFinite(g[k]) ? g[k] : String(g[k]);
    const hookR = Number.isFinite(g.hook.radius) ? g.hook.radius : String(g.hook.radius);
    const lampR = Number.isFinite(g.world.lampR) ? g.world.lampR : String(g.world.lampR);
    return { err, vals, hookR, lampR,
      allFinite: keys.every(k=>Number.isFinite(g[k])) && Number.isFinite(g.hook.radius)
                 && Number.isFinite(g.world.lampR) };})())`));
  check('D1 只有旧 5 键的 levels 不会抛错，也不会把物理搞成 NaN',
    legacy.err === '' && legacy.allFinite === true,
    legacy.err || `line 2 → 鱼线 ${legacy.vals.maxDepth}m · 钩 ${legacy.hookR} · 灯 ${legacy.lampR}`);
  check('D2 缺失的 6 项按 Lv0 兜底（绞盘 240 / 鱼护 8 / 罚款 30 / 声呐 0）',
    legacy.vals.ascendSpeed === 240 && legacy.vals.creelLimit === 8
    && legacy.vals.pufferPenalty === 30 && legacy.vals.sonarPct === 0,
    `绞盘 ${legacy.vals.ascendSpeed} · 鱼护 ${legacy.vals.creelLimit} · 罚款 ${legacy.vals.pufferPenalty} · 声呐 ${legacy.vals.sonarPct}`);

  // 存档往返：读档会把缺失项补齐成 0，而不是 undefined
  const roundtrip = J(await ev(`JSON.stringify((()=>{
    localStorage.setItem('hooked.save.v3', JSON.stringify({
      coins: 500, bestDepth: 120, casts: 3,
      levels: { line: 3, lamp: 2 }, codex: { sardine: { n: 2, best: 7 } } }));
    return { saved: true };})())`));
  await send('Page.navigate', { url: URL });
  await sleep(3200);
  const reloaded = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    if (!g) return { err: 'no game' };
    const L = g.save.levels;
    return { line: L.line, lamp: L.lamp, winch: L.winch, rig: L.rig,
      nKeys: Object.keys(L).length,
      maxDepth: g.maxDepth, ascend: g.ascendSpeed, creel: g.creelLimit,
      allKeysZero: ['winch','creel','insurance','sonar','bait','rig'].every(k=>L[k]===0) };})())`));
  check('D3 旧存档读回后，6 个新等级字段被补齐为 0（不是 undefined）',
    roundtrip.saved && reloaded.nKeys === 11 && reloaded.allKeysZero === true
    && reloaded.ascend === 240 && reloaded.creel === 8,
    `${reloaded.nKeys} 个等级键 · 绞盘 ${reloaded.ascend} · 鱼护 ${reloaded.creel}`);
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
  const smoke = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.save.levels = { line:0,hook:0,sinker:0,power:0,lamp:0,winch:0,creel:0,insurance:0,sonar:5,bait:3,rig:2 };
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
      sonarOn: document.querySelector('#ruler .sonar').classList.contains('on') };})())`));
  const sawDescend = smoke.seen.includes('descend');
  const sawAscend = smoke.seen.includes('ascend');
  const sawEnd = smoke.seen.includes('air') || smoke.seen.includes('result');
  check('E1 带新升级项的一整竿流程跑得通（下潜 → 收线 → 上升 → 空中 → 结算）',
    sawDescend && sawAscend && sawEnd,
    smoke.seen.join(' → '));
  check('E2 声呐开着时深度尺的探测带在整竿里一直可见',
    smoke.sonarOn === true, `sonar.on=${smoke.sonarOn}`);

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
