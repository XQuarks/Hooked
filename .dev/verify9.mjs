/**
 * verify9.mjs — 批 3（枪械系统：7 把枪 + 5 级升级 + 枪店 + 血量重标定）的回归验证
 *
 * 覆盖：
 *   A 数值表（纯 Node，不开浏览器）
 *     · GUNS 表结构：7 把枪 / 每把 6 档 / 机制字段齐全且自洽
 *     · 数值单调：伤害与半径递增、间隔递减、弹匣递增、换弹递减
 *     · **普通手枪 Lv0 = 伤害 2 / 半径 24 / 间隔 0.30**，半径恰好是旧版 48 的一半
 *     · **未升级手枪打表层鱼 1~3 枪**（用户点名的验收指标）
 *     · 血量标定：浅层普遍偏低 + 深层层内有高有低
 *     · gunStats 对越界等级 / 脏枪 id 的钳制（NaN 会静默毁掉整条伤害链）
 *     · 升级成本递增、Lv5 = Infinity、价格阶梯
 *     · 攻击力倍率**只作用于伤害，不作用于半径**（半径是每把枪的身份）
 *   B 枪店（浏览器）：7 张卡 / 购买 / 装备 / 升级 / 买不起 / 满级 / 不溢出 / 零 emoji
 *   C 机制（浏览器，冻结主循环手动步进）：单点 / 间隔 / 弹匣换弹 / 持续连发预热 /
 *     激光递增 / 激光过热 / 巴雷特单发 / 鱼叉穿透 / 散弹覆盖 / 攻击力倍率 / 枪械条
 *   D 存档：旧存档迁移、等级钳制、脏 current 回退、刷新保持
 *   E 冒烟：完整一竿 + 控制台零报错
 *
 * 用法：node .dev/verify9.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../src/config.js';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.VB_PORT || 9365);   // ⚠ 可用 VB_PORT 覆盖：上一次跑被打断时 Chrome 会占着端口，新一轮会"连到旧现场"
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v9');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  · ' + detail : ''}`);
}

const { GUNS, GUN_ORDER, GUN_MAX_LEVEL, GUN_GROWTH, gunById, gunStats, gunUpgradeCost,
  LEVELS, SPECIES, ZONES, MAPS, zonesOfMap, mapMaxDepth } = C;

const byId = new Map(GUNS.map((g) => [g.id, g]));
const lvAll = (arr) => arr.every((v) => Number.isFinite(v));

// ═══════════════════════════════════════════════════════════
// A 组 — 枪械数值表（纯 Node）
// ═══════════════════════════════════════════════════════════
console.log('\n── A 枪械数值表 ──');

check('A1 GUNS 共 7 把枪，每把 6 档（Lv0~Lv5 = 可升级 5 级），id 唯一且齐全',
  GUNS.length === 7 && GUN_ORDER.length === 7 && new Set(GUN_ORDER).size === 7
  && GUN_MAX_LEVEL === 5
  && GUNS.every((g) => g.id && g.name && g.en && g.icon && g.mech && g.tier
    && g.dmg.length === 6 && g.rad.length === 6 && g.cd.length === 6
    && lvAll(g.dmg) && lvAll(g.rad) && lvAll(g.cd)),
  `${GUN_ORDER.join(' / ')}`);

const MECHS = new Set(['single', 'burst', 'auto', 'laser', 'pierce']);
const mechBad = GUNS.filter((g) => !MECHS.has(g.mech)).map((g) => g.id);
check('A2 mech 都是已知机制，且用户点名的 5 种各有一把',
  mechBad.length === 0
  && ['single', 'burst', 'auto', 'laser', 'pierce'].every((m) => GUNS.some((g) => g.mech === m)),
  `机制：${GUNS.map((g) => g.id + ':' + g.mech).join(' ')}`);

// 机制专属字段：有弹匣的必须成对出现；散弹/激光/加特林的专属参数必须存在
const fieldBad = [];
for (const g of GUNS) {
  const hasMag = Array.isArray(g.mag);
  if (hasMag !== Array.isArray(g.reload)) fieldBad.push(g.id + ':弹匣/换弹不成对');
  if (hasMag && (!lvAll(g.mag) || !lvAll(g.reload))) fieldBad.push(g.id + ':弹匣数值非法');
  if (g.mech === 'shotgun' && !(g.pellets >= 2 && g.spread > 0)) fieldBad.push(g.id + ':缺 pellets/spread');
  if (g.mech === 'auto' && !(g.spinup > 0)) fieldBad.push(g.id + ':缺 spinup');
  if (g.mech === 'laser' && !(g.ramp.length === 6 && g.rampMax > 0)) fieldBad.push(g.id + ':缺 ramp/rampMax');
}
check('A3 机制专属字段齐全（Uzi/激光有弹匣、散弹有弹丸数、加特林有预热、激光有递增）',
  fieldBad.length === 0, fieldBad.join(',') || '7 把枪字段自洽');

// 单调性：伤害 / 半径 / 弹匣不降，间隔 / 换弹不升
const monoBad = [];
for (const g of GUNS) {
  const up = (a, n) => a.every((v, i) => i === 0 || v >= a[i - 1]);
  const down = (a) => a.every((v, i) => i === 0 || v <= a[i - 1]);
  if (!up(g.dmg)) monoBad.push(g.id + ':dmg 倒退');
  if (!up(g.rad)) monoBad.push(g.id + ':rad 倒退');
  if (!down(g.cd)) monoBad.push(g.id + ':cd 变慢');
  if (g.mag && !up(g.mag)) monoBad.push(g.id + ':mag 倒退');
  if (g.reload && !down(g.reload)) monoBad.push(g.id + ':reload 变慢');
}
check('A4 每把枪逐级变强：伤害/范围/弹匣不减，间隔/换弹不增（升级不会变成削弱）',
  monoBad.length === 0, monoBad.join(',') || '7 把枪 6 档全部单调');

const p0 = gunStats('pistol', 0);
const OLD_BLAST = 48;   // v0.3 时代「攻击力 Lv0」的爆炸半径（config 里已删除，这里当基线常量）
check('A5 普通手枪 Lv0 = 伤害 2 / 半径 24 / 间隔 0.30，半径恰好是旧版的 50%',
  p0.damage === 2 && p0.radius === OLD_BLAST / 2 && p0.cooldown === 0.30,
  `伤害 ${p0.damage} · 半径 ${p0.radius}（旧 ${OLD_BLAST} 的 ${(p0.radius / OLD_BLAST * 100).toFixed(0)}%）· 间隔 ${p0.cooldown}s`);

// 用户点名的验收指标：未升级手枪打表层鱼 1~3 枪
const shallowFish = SPECIES.filter((s) => s.zones.some((z) => {
  const zone = ZONES.find((x) => x.id === z);
  return zone && zone.top === 0;      // 每张图最浅的那一层
}));
const shotCounts = shallowFish.map((s) => Math.ceil(s.hp / p0.damage));
check('A6 未升级手枪打浅层鱼 1~3 枪可击杀（两张图的表层鱼全部落在区间内）',
  shallowFish.length >= 8 && shotCounts.every((n) => n >= 1 && n <= 3),
  shallowFish.map((s, i) => `${s.name}(hp${s.hp})→${shotCounts[i]}枪`).join(' · '));

// 血量标定：浅层普遍偏低；深层同一层内要有高有低
//
// ⚠ "有高有低"要量的是**层内的极差**，不是"深层平均值比浅层高" ——
//   后者用身价就能满足（身价本来就随深度涨），根本测不到血量这一条轴。
//   极差阈值取 2.2：浅层是 2~5（极差 2.5，但绝对差只有 3 点），
//   深层是 6~16 / 9~34 / 12~48 这种"软鱼和硬骨头同框"的量级。
const shallowMax = Math.max(...shallowFish.map((s) => s.hp));
const shallowAvg = shallowFish.reduce((a, s) => a + s.hp, 0) / shallowFish.length;
check('A7a 浅层血量普遍偏低：最高 ≤ 6，且平均值 ≤ 4',
  shallowMax <= 6 && shallowAvg <= 4,
  `表层最高 ${shallowMax} · 平均 ${shallowAvg.toFixed(2)}（${shallowFish.map((s) => s.hp).join('/')}）`);

const deepZones = ZONES.filter((z) => z.top <= -240);
const deepSpread = deepZones.map((z) => {
  const pool = SPECIES.filter((s) => s.zones.includes(z.id));
  return { z, lo: Math.min(...pool.map((s) => s.hp)), hi: Math.max(...pool.map((s) => s.hp)), n: pool.length };
});
const spreadBad = deepSpread.filter((d) => d.hi / d.lo < 2.2);
check('A7b 深层鱼血量有高有低：每个深层海域**层内极差 ≥ 2.2 倍**',
  spreadBad.length === 0,
  deepSpread.map((d) => `${d.z.name} ${d.lo}~${d.hi}(${(d.hi / d.lo).toFixed(1)}×)`).join(' · '));

const hpAll = SPECIES.map((s) => s.hp);
check('A7c 全局血量跨度足够大（最脆 2 → 最厚 120，≥ 15 倍），中间有连续梯度',
  Math.max(...hpAll) / Math.min(...hpAll) >= 15 && new Set(hpAll).size >= 12,
  `${Math.min(...hpAll)} ~ ${Math.max(...hpAll)}（${new Set(hpAll).size} 个不同档位）`);

check('A8 血量最高的是 Boss，且没有超过它两倍以外的离群值',
  Math.max(...SPECIES.map((s) => s.hp)) === 120
  && SPECIES.find((s) => s.hp === 120).boss === true,
  `最高 hp = ${Math.max(...SPECIES.map((s) => s.hp))}（${SPECIES.find((s) => s.hp === 120).name}）`);

// gunStats 的钳制：脏数据不能返回 undefined（undefined 顺着乘法会变成 NaN 伤害）
const dirty = [
  ['越界高', gunStats('pistol', 999).damage],
  ['越界低', gunStats('pistol', -5).damage],
  ['undefined', gunStats('pistol', undefined).damage],
  ['NaN', gunStats('pistol', NaN).damage],
  ['脏 id', gunStats('不存在的枪', 3).damage],
  ['脏 id + 脏等级', gunStats(null, null).damage],
];
check('A9 gunStats 对越界等级 / 脏枪 id 一律钳制，绝不返回 undefined',
  dirty.every(([, v]) => Number.isFinite(v)),
  dirty.map(([k, v]) => `${k}=${v}`).join(' · '));

const costBad = [];
for (const g of GUNS) {
  if (g.price < 0 || g.upBase <= 0) costBad.push(g.id + ':价格非法');
  for (let l = 1; l < GUN_MAX_LEVEL; l++) {
    if (!(gunUpgradeCost(g.id, l) > gunUpgradeCost(g.id, l - 1))) costBad.push(`${g.id}:Lv${l} 没变贵`);
  }
  if (gunUpgradeCost(g.id, GUN_MAX_LEVEL) !== Infinity) costBad.push(g.id + ':满级还能买');
}
check('A10 枪械升级成本严格递增、Lv0 = upBase、Lv5 为 Infinity',
  costBad.length === 0, costBad.join(',') || `GUN_GROWTH=${GUN_GROWTH}`);

const prices = GUNS.map((g) => g.price);
check('A11 价格阶梯递增（后一把不比前一把便宜），手枪免费',
  prices[0] === 0 && prices.every((v, i) => i === 0 || v >= prices[i - 1]),
  GUNS.map((g) => `${g.name} ${g.price}`).join(' · '));

// ⚠ v0.5：「攻击力」那条全局倍率被删掉，成长并进了枪械自身的 dmg 曲线 ——
//   每把枪的 dmg[i] 都乘了一条 `1 + 2.8·i/5` 的斜坡（Lv0 不变、Lv5 ×3.8）。
//   下面三条盯的是"合并之后没走样"。
const RAMP = (i) => 1 + 2.8 * i / 5;

// ① 半径**从不**被任何倍率放大：半径是每把枪的身份（手枪 24 / 散弹 28 / 巴雷特 98）。
const radiusPure = GUNS.every((g) => gunStats(g.id, 5).radius === g.rad[5]);
// ② 把斜坡除回去得到的"出厂曲线"必须仍然逐级单调 ——
//    如果斜坡是均匀乘上去的，除回去之后曲线形状不变；哪一把乘歪了，这里就会挂。
const baseBad = [];
for (const g of GUNS) {
  const base = g.dmg.map((v, i) => v / RAMP(i));
  for (let i = 1; i < base.length; i++) if (base[i] < base[i - 1] - 1e-9) baseBad.push(`${g.id}:Lv${i}`);
}
check('A12 攻击力已并入枪械：半径从不被放大，且斜坡除回去后出厂曲线仍逐级单调',
  radiusPure && baseBad.length === 0 && LEVELS.gunPower === undefined,
  `半径纯=${radiusPure} · 反推曲线倒退=${baseBad.join(',') || '无'} · gunPower=${LEVELS.gunPower}`);

// ③ 最强的一条：**终局伤害必须等于改前**（枪械 Lv5 × 攻击力 Lv20）。
//    这张表是"改前的快照"，是历史值 —— 不是现值，别拿它去跟 config 对齐。
//    它保证"删掉攻击力"没有偷偷改强度：投入的轴少了，终点没变。
const OLD_ENDGAME = { pistol: 14, shotgun: 7, uzi: 5, gatling: 2.5, harpoon: 40, laser: 4.5, barrett: 124 };
const endgameBad = GUNS
  .filter((g) => Math.abs(g.dmg[5] - OLD_ENDGAME[g.id] * 3.8) > 0.05)
  .map((g) => `${g.id} ${g.dmg[5]}≠${(OLD_ENDGAME[g.id] * 3.8).toFixed(1)}`);
check('A12b 终局伤害 = 改前（枪械 Lv5 × 攻击力 Lv20）：合并攻击力没有偷偷改强度',
  endgameBad.length === 0,
  endgameBad.join(' / ') || GUNS.map((g) => `${g.id} ${g.dmg[5]}`).join(' · '));

// 每把枪都要有"能被认出来"的身份：同一机制下不能有数值完全相同的两把
const dup = [];
for (let i = 0; i < GUNS.length; i++) {
  for (let j = i + 1; j < GUNS.length; j++) {
    const a = GUNS[i], b = GUNS[j];
    if (a.dmg[0] === b.dmg[0] && a.rad[0] === b.rad[0] && a.cd[0] === b.cd[0]) dup.push(`${a.id}=${b.id}`);
  }
}
check('A13 没有两把枪的 Lv0 数值完全相同（每把枪都要有自己的身份）',
  dup.length === 0, dup.join(',') || '7 把枪两两不同');

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

const profile = path.resolve('.dev/profile-v9-' + Date.now());
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
  await ev('document.getElementById("startBtn").click()');
  await sleep(400);

  // ── 冻结主循环，改手动定步长 ──
  // ⚠ 这是枪械测试的前提：按住开火是**按帧**推进的，主循环自己跑的话
  //   "按住 1.5 秒"到底跑了多少帧完全不可控，射速类断言会变成掷骰子。
  //   同时把 airSettleGrace 顶到 999：不这么做的话，测试里"场上没有鱼"超过 1.8s
  //   就会自动结算，state 一变成 result，_updateGun 直接停摆，后面全测不了。
  await ev(`(()=>{const g=window.__game; if(!g) return 'no game'; g._loop = () => {};
    window.__cfg.TUNING.airSettleGrace = 999;
    window.step = (n) => { const dt0 = 1/60;
      for (let i=0;i<n;i++){ g.time += dt0; g._update(dt0); }
      g.world.render();
    };
    return 'ok';})()`);
  await sleep(200);

  // 每个机制测试共用的夹具：进空中、清场、装枪、统计 _shoot 调用次数
  const setupGun = (id, lv) => ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
    g.closePhone(); g.ui.hideOverlay();
    g.state='air'; g.airFish=[]; g.birds=[]; g.airT=0; g.airClearT=0; g.caught=[];
    g.hook.setVisible(false); g.world.clearParticles();
    g.save.guns.current='${id}';
    g.save.guns.owned = cfg.GUN_ORDER.filter(x=>x!=='pistol');
    g.save.guns.levels['${id}']=${lv};
    g.save.levels.power = 0; g.applyUpgrades();
    g._resetGun();
    g.input.nx=0.5; g.input.ny=0.5; g.input.pointerDown=false;
    window.__shots = 0;
    if (!window.__patched) {
      window.__patched = true;
      const g2 = window.__game;
      const orig = g2._shoot.bind(g2);
      g2._shoot = (s) => { window.__shots++; return orig(s); };
    }
    return 'ok';})()`);

  // ═══════════════════════════════════════════════════════
  console.log('\n── C 枪械机制（冻结主循环，逐帧手动推进）──');
  // ═══════════════════════════════════════════════════════

  // C1 手枪：单点，不支持长按连发
  await setupGun('pistol', 0);
  const c1 = J(await ev(`(()=>{const g=window.__game;
    g._tapFire();                       // 玩家点了一下
    g.input.pointerDown = true;         // 然后按住不放
    window.step(90);                    // 1.5 秒
    g.input.pointerDown = false;
    return JSON.stringify({ shots: window.__shots });})()`));
  check('C1 普通手枪只能单点：点一下 + 按住 1.5s，总共只打出 1 发（不支持长按连发）',
    c1.shots === 1, `${c1.shots} 发`);

  // C2 攻击间隔 0.30s
  await setupGun('pistol', 0);
  const c2 = J(await ev(`(()=>{const g=window.__game;
    g._tapFire();                       // 第 1 发
    window.step(12);                    // 0.2s：冷却（0.30s）还没走完
    g._tapFire();
    const early = window.__shots;
    window.step(8);                     // 累计 0.333s > 0.30s
    g._tapFire();
    return JSON.stringify({ early, total: window.__shots });})()`));
  check('C2 手枪攻击间隔 ≈ 0.30s：0.2s 时点第二下无效，0.33s 时有效',
    c2.early === 1 && c2.total === 2, `0.2s → ${c2.early} 发 · 0.33s → ${c2.total} 发`);

  // C3 Uzi：弹匣连发 → 自动换弹 → 换完继续
  await setupGun('uzi', 0);
  const c3 = J(await ev(`(()=>{const g=window.__game; const mag = g.gunStat.mag;
    g._tapFire();
    g.input.pointerDown = true;
    window.step(90);                    // 1.5s：9 发 × 0.10s = 0.9s 打空，随后进入 1.4s 换弹
    const emptied = window.__shots;
    const reloading = g.gunReloadT > 0;
    window.step(150);                   // 再 2.5s：换弹走完，第二梭继续
    g.input.pointerDown = false;
    return JSON.stringify({ mag, emptied, reloading, total: window.__shots });})()`));
  check('C3 Uzi：按住先打空一个弹匣，然后自动换弹，换完接着连发',
    c3.mag === 9 && c3.emptied === 9 && c3.reloading === true && c3.total > 9,
    `弹匣 ${c3.mag} · 1.5s 时打了 ${c3.emptied} 发且换弹中=${c3.reloading} · 4s 共 ${c3.total} 发`);

  // C4 加特林：持续连发 + 转速预热
  await setupGun('gatling', 0);
  const c4 = J(await ev(`(()=>{const g=window.__game;
    g._tapFire();
    g.input.pointerDown = true;
    window.step(54);                    // 0.9s 预热期
    const warm = window.__shots;
    window.step(60);                    // 之后 1s 满转速
    g.input.pointerDown = false;
    return JSON.stringify({ warm, later: window.__shots - warm, reloadT: g.gunReloadT });})()`));
  check('C4 加特林按住持续连发、没有弹匣，且头 0.9s 转速没上来（射速明显更低）',
    c4.later > c4.warm && c4.reloadT === 0,
    `预热 0.9s 内 ${c4.warm} 发 → 满转速后 1s ${c4.later} 发`);

  // C5 激光：伤害随照射时间递增
  await setupGun('laser', 0);
  const c5 = J(await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
    // 一条打不死的"木桩鱼"放在瞄准点上，只看每次结算的伤害数字
    const S = cfg.SPECIES.find(s=>s.id==='polar-night-king');
    const f = g.fish.acquire(S); f.reset(0,0);
    const w = g._aimPoint();
    f.launch(0,0,w.x,w.y); f.vx=0; f.vy=0; f.mesh.position.set(w.x, w.y, 2);
    f.hp = 1e9; f.maxHp = 1e9;
    g.airFish = [f];
    const dmgs = [];
    const orig = g._damageInRadius.bind(g);
    g._damageInRadius = (x,y,r,d,q) => { dmgs.push(+d.toFixed(2)); return orig(x,y,r,d,q); };
    g.input.pointerDown = true;
    window.step(10);                    // ~0.17s
    const early = dmgs[dmgs.length-1];
    window.step(70);                    // 累计 ~1.33s
    const later = dmgs[dmgs.length-1];
    g.input.pointerDown = false;
    return JSON.stringify({ early, later, n: dmgs.length });})()`));
  check('C5 激光枪：连续照射时单次结算伤害递增（越照越疼）',
    c5.later > c5.early * 1.4, `第 0.17s 单次 ${c5.early} → 第 1.33s 单次 ${c5.later}（共 ${c5.n} 次）`);

  // C6 激光过热 → 强制冷却 → 恢复
  await setupGun('laser', 0);
  const c6 = J(await ev(`(()=>{const g=window.__game; const heatMax = g.gunStat.mag;
    g.input.pointerDown = true;
    window.step(60*3.4);                // 3.4s > 过热时长 3.2s
    const overheated = g.gunReloadT > 0;
    const shotsAtOverheat = window.__shots;
    window.step(60*1.6);                // 冷却 1.4s 走完
    const recovered = g.gunReloadT === 0 && window.__shots > shotsAtOverheat;
    g.input.pointerDown = false;
    return JSON.stringify({ heatMax, overheated, recovered });})()`));
  check('C6 激光枪照满过热时长后强制冷却，冷却结束自动恢复照射',
    c6.overheated === true && c6.recovered === true,
    `过热时长 ${c6.heatMax}s → 过热=${c6.overheated} · 冷却后恢复=${c6.recovered}`);

  // C7 巴雷特：单发 + 长间隔
  await setupGun('barrett', 0);
  const c7 = J(await ev(`(()=>{const g=window.__game;
    g._tapFire();
    g.input.pointerDown = true;
    window.step(90);                    // 1.5s（间隔 1.35s，理论上最多 2 发）
    g.input.pointerDown = false;
    return JSON.stringify({ shots: window.__shots });})()`));
  check('C7 巴雷特单发、间隔长：按住 1.5s 只打出 1 发（第二发要等 1.35s 冷却）',
    c7.shots === 1, `${c7.shots} 发`);

  // C8 鱼叉：一发穿透弹道上的所有鱼
  await setupGun('harpoon', 3);
  const c8 = J(await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
    const S = cfg.SPECIES.find(s=>s.id==='sardine');       // hp 2，鱼叉 Lv3 一发必死
    const w = g._aimPoint();
    const vr = g.world.viewRange();
    const x0 = g.world.camX, y0 = vr.bottom - 20;          // 弹道起点 = 画面下方（船的位置）
    let dx = w.x - x0, dy = w.y - y0;
    const L = Math.hypot(dx, dy); dx/=L; dy/=L;
    const targets = [];
    for (let i=1;i<=4;i++){                                 // 沿弹道等距排 4 条鱼
      const t = L * (0.4 + i * 0.14);
      const f = g.fish.acquire(S); f.reset(0,0); g.airFish.push(f);
      f.launch(0,0, x0+dx*t, y0+dy*t); f.vx=0; f.vy=0;
      f.mesh.position.set(x0+dx*t, y0+dy*t, 2);
      targets.push(f);
    }
    g.gunCd = 0;
    g._tapFire();
    const dead = targets.filter(f => f.state !== 'air').length;
    return JSON.stringify({ n: targets.length, dead });})()`));
  check('C8 鱼叉枪：一发穿透弹道上的所有鱼（一条线上排 4 条全中）',
    c8.dead === 4, `弹道上 ${c8.n} 条 · 一发命中 ${c8.dead} 条`);

  // C9 散弹枪：一次射击覆盖一大片
  await setupGun('shotgun', 5);
  const c9 = J(await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
    const S = cfg.SPECIES.find(s=>s.id==='sardine');
    const w = g._aimPoint();
    // 瞄准点周围半径 40 内撒 7 条（散弹 Lv5 的覆盖直径 ≈ 2×(spread 30 + rad 28)）
    const spots = [[0,0],[-22,10],[22,10],[-12,-16],[12,-16],[0,24],[0,-26]];
    const targets = [];
    for (const [ox,oy] of spots){
      const f = g.fish.acquire(S); f.reset(0,0); g.airFish.push(f);
      f.launch(0,0, w.x+ox, w.y+oy); f.vx=0; f.vy=0; f.mesh.position.set(w.x+ox, w.y+oy, 2);
      targets.push(f);
    }
    g.gunCd = 0;
    g._tapFire();
    const dead = targets.filter(f => f.state !== 'air').length;
    return JSON.stringify({ n: targets.length, dead });})()`));
  check('C9 散弹枪：一次射击覆盖一大片（半径 40 内 7 条至少命中 5 条）',
    c9.dead >= 5, `${c9.n} 条里命中 ${c9.dead} 条`);

  // C10 v0.5：攻击力已并入枪械 —— **升级枪械是伤害的唯一来源**，且完全不动半径。
  // 同时确认全局倍率被删干净了（`g.gunMul` 不该再存在）。
  await setupGun('pistol', 0);
  const c10 = J(await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
    const at = (lv) => { g.save.guns.levels.pistol = lv; const s = g.gunStat;
      return { dmg: +s.damage.toFixed(2), rad: s.radius }; };
    const a = at(0), b = at(5);
    return JSON.stringify({ a, b, ratio: +(b.dmg / a.dmg).toFixed(2),
      gunMul: g.gunMul, table: cfg.GUNS.find(x=>x.id==='pistol').dmg[5] });})()`));
  check('C10 升级枪械是伤害的唯一来源（手枪 Lv0→Lv5 伤害 ×26.6），数值全部来自表、无全局放大',
    c10.a.dmg === 2 && Math.abs(c10.b.dmg - c10.table) < 1e-9
    && c10.a.rad === 24 && c10.b.rad === 46 && c10.gunMul === undefined,
    `伤害 ${c10.a.dmg} → ${c10.b.dmg}（×${c10.ratio}）· 半径 ${c10.a.rad} → ${c10.b.rad}（表值）· gunMul=${c10.gunMul}`);

  // C11 枪械条：弹匣 / 换弹 两种状态都要显示对
  await setupGun('uzi', 0);
  const c11 = J(await ev(`(()=>{const g=window.__game;
    g.ui.showGunBar(true);
    g._syncGunHud(g.gunStat);
    const full = document.getElementById('gunAmmo').textContent.trim();
    g.input.pointerDown = true;
    window.step(70);                    // 打空弹匣 → 进入换弹
    const reloadTxt = document.getElementById('gunAmmo').textContent.trim();
    const reloading = g.gunReloadT > 0;
    g.input.pointerDown = false;
    return JSON.stringify({ full, reloadTxt, reloading,
      barOn: document.getElementById('gunBar').classList.contains('on'),
      name: document.getElementById('gunName').textContent.trim() });})()`));
  check('C11 枪械条：满弹匣显示「9 / 9」，打空后显示换弹状态，枪名与图标同步',
    c11.full === '9 / 9' && c11.reloading === true && /换弹/.test(c11.reloadTxt)
    && c11.barOn === true && c11.name === 'Uzi',
    `满弹匣「${c11.full}」→ 打空「${c11.reloadTxt}」· 换弹中=${c11.reloading} · 枪械条可见=${c11.barOn} · 枪名 ${c11.name}`);
  await shot('C11-gunbar-uzi');

  // ═══════════════════════════════════════════════════════
  console.log('\n── B 枪店 App ──');
  // ═══════════════════════════════════════════════════════
  const openGunshop = () => ev(`(()=>{const g=window.__game;
    g.state='idle'; g.phoneOpen=false; g.showIdle();
    g.openPhone(); g.ui.openApp('gunshop'); g.ui.refreshApp(); return 'ok';})()`);
  const readGunshop = () => ev(`JSON.stringify((()=>{
    const cards = [...document.querySelectorAll('#pApp .gs-item')];
    const list = document.querySelector('#pApp .gs-list');
    const listRight = list ? Math.round(list.getBoundingClientRect().right) : 0;
    return {
      n: cards.length,
      ids: cards.map(c => (c.querySelector('.gs-t b')||{}).textContent),
      current: cards.map(c => c.classList.contains('cur')),
      owned: cards.map(c => c.classList.contains('owned')),
      buyBtns: cards.map(c => { const b = c.querySelector('[data-gun-buy]'); return b ? b.textContent.trim() : ''; }),
      equipBtns: cards.map(c => !!c.querySelector('[data-gun-equip]')),
      upBtns: cards.map(c => { const b = c.querySelector('[data-gun-up]'); return b ? b.textContent.trim() : ''; }),
      // 「买不了」有两种长相：钱不够 → .buy.lock（disabled）；钱够 → .gs-go（可点）。
      // 所以量"能不能买"必须同时看这两个选择器，只查 .buy 会把 .gs-go 漏成 null。
      buyDisabled: cards.map(c => {
        const b = c.querySelector('[data-gun-buy]') || c.querySelector('.buy.lock');
        return b ? b.disabled : null;
      }),
      upDisabled: cards.map(c => { const b = c.querySelector('[data-gun-up]'); return b ? b.disabled : null; }),
      overflow: cards.map(c => Math.round(c.getBoundingClientRect().right) - listRight).filter(v => v > 0).length,
      emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.querySelector('#pApp').innerText),
    };})())`);

  await ev(`(()=>{const g=window.__game; const cfg=window.__cfg;
    // ⚠⚠ 解锁相关的存档字段必须**显式归零**：上一轮跑这套时 B5 的买枪会把这些
    //   一起 persist 进 localStorage，下一次跑就"开局已经在极地"——
    //   黑卡判定、新货播报全被上一轮污染（本次审计真踩到，队列里凭空多出三把枪）。
    g.save.chart = false; g.save.boats = { owned: [], current: null }; g.save.boatApp = false;
    g.save.mapBest = {}; g.save.gunNews = []; g.save.gunAnnounced = [];
    g.save.guns = { owned: [], current: 'pistol', levels: Object.fromEntries(cfg.GUN_ORDER.map(k=>[k,0])) };
    g.save.coins = 0; g.ringingCall = null; g.ui.ringPhone(false, null);
    g.save.calls = cfg.CALLS.map(c => c.id);      // 电话全部标记已听 —— 这组不验来电
    g.syncBadges(); g.ui._newsQueue.length = 0; g.ui._newsShowing = false;
    g.showIdle(); return 'ok';})()`);
  await openGunshop();
  const b1 = J(await readGunshop());
  check('B1 枪店列出全部 7 把枪，每把一张卡',
    b1.n === 7, `${b1.n} 张 · ${b1.ids.join(' / ')}`);
  check('B2 开局只有手枪：它是唯一"装备中"的卡，其余都还没拥有',
    b1.current[0] === true && b1.current.filter(Boolean).length === 1
    && b1.owned[0] === true && b1.owned.filter(Boolean).length === 1,
    `装备中=${b1.ids[b1.current.indexOf(true)]} · 已拥有 ${b1.owned.filter(Boolean).length} 把`);

  // ── B2b 枪店分段解锁（v0.7 第三批，A2 = a + b）────────────────
  // 首图只上架手枪；其余六把是"黑卡"—— 看得到名字，**看不到任何数值 / 价格 / 机制说明**。
  // 为什么连价格都不给：价格是一种承诺（"攒够就能买"），而对一把还没解锁的枪，
  // 攒钱根本不是当前的正确目标 —— 先把深度潜出来才是。
  const b2b = J(await ev(`JSON.stringify((()=>{
    const cards = [...document.querySelectorAll('#pApp .gs-item')];
    const locked = cards.filter(c => c.classList.contains('unreleased'));
    return {
      total: cards.length, locked: locked.length,
      withBuy: locked.filter(c => c.querySelector('[data-gun-buy]')).length,
      withStats: locked.filter(c => c.querySelector('.gs-stats')).length,
      withTip: locked.filter(c => c.querySelector('.gs-tip')).length,
      withFoot: locked.filter(c => c.querySelector('.gs-foot')).length,
      withLock: locked.filter(c => c.querySelector('.gs-lockrow')).length,
      firstName: (locked[0] && (locked[0].querySelector('.gs-t b') || {}).textContent) || '',
      hasDigit: locked.some(c => /[0-9]/.test(c.textContent)) };
  })())`));
  check('B2b 首图只上架手枪：其余六把是黑卡（无购买按钮、无数值、无价格），只留名字与解锁条件',
    b2b.total === 7 && b2b.locked === 6 && b2b.withBuy === 0 && b2b.withStats === 0
    && b2b.withTip === 0 && b2b.withFoot === 0 && b2b.withLock === 6 && b2b.hasDigit === false,
    `黑卡 ${b2b.locked}/${b2b.total} · 第一张「${b2b.firstName}」· 带解锁条件 ${b2b.withLock}/${b2b.locked} · 泄数字 ${b2b.hasDigit}`);

  // ── 把场景推到"已经到过极地 + 潜到过最底"：六把枪全部上架 ──
  // ⚠ gunAnnounced 预先铺满：B3~B8 验的是"买 / 装 / 升"，不是"新货播报" ——
  //   不铺的话六条推送会排队、红点会亮，B10 的截图里就会飘着一张通知卡。
  await ev(`(()=>{const g=window.__game;
    // 诊断：记录每一次 _syncGunNews 的调用点与"当时它为什么把枪记成新货"
    g._newsTrace = [];
    const orig = g._syncGunNews.bind(g);
    g._syncGunNews = (...a) => {
      const before = { ann: g.save.gunAnnounced.length, owned: g.save.guns.owned.length,
        mapBestPolar: g.save.mapBest.polar || 0, chart: g.save.chart };
      const r = orig(...a);
      g._newsTrace.push({ before, got: r.slice(), stack: (new Error().stack || '').split('\\n').slice(2, 5).join(' <- ') });
      return r;
    };
    g.save.chart = true;
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.save.mapBest = { polar: 1240 };
    g.save.gunNews = []; g.save.gunAnnounced = window.__cfg.GUN_ORDER.slice();
    g.syncBadges(); g.ui.refreshApp(); return 'ok';})()`);
  await sleep(240);
  const b2c = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    let renderErr = null;
    try { g.ui.refreshApp(); } catch (e) { renderErr = String((e && e.message) || e); }
    const cards = [...document.querySelectorAll('#pApp .gs-item')];
    const shot = cards.find(c => c.textContent.includes('散弹枪'));
    return { chart: g.save.chart, boats: g.save.boats.owned.length,
      mapBestPolar: g.save.mapBest.polar || 0,
      ann: g.save.gunAnnounced.length,
      unlocked: g.gunUnlocked(cfg.gunById('shotgun')),
      entry: (()=>{ try { const e = g.gunEntry(cfg.gunById('shotgun')); return { locked:e.locked, owned:e.owned, afford:e.canAffordBuy }; } catch (e) { return { err: String((e && e.message) || e) }; } })(),
      renderErr,
      nCards: cards.length,
      shotHtml: shot ? shot.outerHTML.slice(0, 160) : '(找不到散弹枪卡)' };})())`));
  check('B2c 解锁场景铺设生效：到过极地 + 潜到底之后，散弹枪立刻上架',
    b2c.chart === true && b2c.boats === 1 && b2c.mapBestPolar === 1240
    && b2c.unlocked === true && b2c.entry.locked === false && b2c.renderErr === null
    && b2c.shotHtml !== '(找不到散弹枪卡)',
    `chart=${b2c.chart} 船=${b2c.boats} 纪录=${b2c.mapBestPolar}m · 解锁=${b2c.unlocked} · entry=${JSON.stringify(b2c.entry)} · 渲染错=${b2c.renderErr} · 卡片数=${b2c.nCards} · ${b2c.shotHtml.slice(0,90)}`);
  // ⚠ B3 必须用**场景之后**的新探针：上面铺的解锁场景改变了散弹枪的渲染，
  //   还拿 b1（场景之前拍的快照）就会读到"黑卡没有按钮"的旧状态。
  const b3pre = J(await readGunshop());
  check('B3 金币 0 时：没买的枪按钮是灰的（显示价格），手枪的升级按钮也是灰的',
    b3pre.buyDisabled[1] === true && b3pre.upBtns[0] !== '' && b3pre.upDisabled[0] === true,
    `散弹枪购买按钮 disabled=${b3pre.buyDisabled[1]} · 手枪升级「${b3pre.upBtns[0].replace(/\s+/g, '')}」disabled=${b3pre.upDisabled[0]}`);

  // 给够钱 → 能买
  await ev(`(()=>{window.__game.save.coins = 9999999; window.__game.ui.refreshApp(); return 'ok';})()`);
  const b3 = J(await readGunshop());
  check('B4 金币够了之后：购买按钮亮起、升级按钮亮起',
    b3.buyBtns[1] !== '' && b3.buyDisabled[1] === false && b3.upDisabled[0] === false,
    `散弹枪购买按钮「${b3.buyBtns[1]}」disabled=${b3.buyDisabled[1]} · 手枪升级 disabled=${b3.upDisabled[0]}`);

  const buy = J(await ev(`(()=>{const g=window.__game; const before = g.save.coins;
    const price = window.__cfg.gunById('shotgun').price;
    document.querySelector('[data-gun-buy="shotgun"]').click();
    return JSON.stringify({ before, after: g.save.coins, price,
      owned: g.save.guns.owned.slice(), current: g.save.guns.current });})()`));
  check('B5 买枪：扣掉对应金币、进入已拥有，并且**买完自动装备**',
    buy.after === buy.before - buy.price && buy.owned.includes('shotgun') && buy.current === 'shotgun',
    `金币 ${buy.before} → ${buy.after}（价 ${buy.price}）· 当前枪 = ${buy.current}`);

  const up = J(await ev(`(()=>{const g=window.__game; const before = g.save.coins;
    const cost = window.__cfg.gunUpgradeCost('shotgun', 0);
    const dmg0 = g.save.guns.levels.shotgun;
    document.querySelector('[data-gun-up="shotgun"]').click();
    const lv = g.save.guns.levels.shotgun;
    const s = window.__cfg.gunStats('shotgun', lv);
    return JSON.stringify({ before, after: g.save.coins, cost, dmg0, lv,
      dmg: s.damage, rad: s.radius });})()`));
  check('B6 升级枪械：等级 +1、扣掉对应金币、数值真的变强',
    up.lv === 1 && up.after === up.before - up.cost && up.dmg > 1.6 && up.rad > 16,
    `Lv${up.dmg0}→Lv${up.lv} · 金币 ${up.before} → ${up.after}（价 ${up.cost}）· 单发伤害 ${up.dmg} / 范围 ${up.rad}`);

  const equip = J(await ev(`(()=>{const g=window.__game;
    document.querySelector('[data-gun-equip="pistol"]').click();
    const back = g.save.guns.current;
    document.querySelector('[data-gun-equip="shotgun"]').click();
    return JSON.stringify({ back, again: g.save.guns.current });})()`));
  check('B7 切换当前枪械：点「装备」后 current 跟着变（可以来回切）',
    equip.back === 'pistol' && equip.again === 'shotgun',
    `切到 ${equip.back} → 再切回 ${equip.again}`);

  const maxed = J(await ev(`(()=>{const g=window.__game;
    g.save.guns.levels.barrett = 5; g.save.guns.owned.push('barrett');
    g.ui.refreshApp();
    const card = [...document.querySelectorAll('#pApp .gs-item')]
      .find(c => c.textContent.includes('巴雷特'));
    return JSON.stringify({ up: !!card.querySelector('[data-gun-up]'),
      maxBtn: (card.querySelector('.buy.max')||{}).textContent || '' });})()`));
  check('B8 升满 5 级后不再有升级按钮，改为 MAX（不会无限升级）',
    maxed.up === false && /MAX/.test(maxed.maxBtn), `满级按钮「${maxed.maxBtn}」`);

  const b9 = J(await readGunshop());
  check('B9 枪店卡片不横向溢出面板（.gs-item 宽度 ≤ 列表宽度）',
    b9.overflow === 0, `溢出卡片 ${b9.overflow} 张`);
  check('B10 枪店里一个 emoji 都没有（界面一律内联 SVG）', b9.emoji === false);
  await shot('B10-gunshop');

  // ═══════════════════════════════════════════════════════
  console.log('\n── B3 新货播报（推送 / 红点 / NEW 角标）──');
  // ═══════════════════════════════════════════════════════
  // 场景：刚拿到海图 + 船（人还在海湾），什么都不拥有 → 散弹枪是唯一的新货。
  // 到过一张图 = 解锁条件满足的那一刻（enterMap / 深度纪录 / showIdle 三处都会检测）。
  const n1 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    // 每步自清理：只断言"这一次 sync 的增量"，不依赖上一步的存档残留 ——
    //   跨步骤状态会让失败原因飘到完全不相干的地方（本次审计真踩到）。
    g.state='idle'; g.phoneOpen=false; g.ui.closePhone();
    g.save.chart = true; g.save.boats = { owned: ['golden'], current: 'golden' };
    g.save.mapBest = { polar: 0 };
    g.save.guns = { owned: [], current: 'pistol', levels: Object.fromEntries(cfg.GUN_ORDER.map(k=>[k,0])) };
    g.save.gunNews = []; g.save.gunAnnounced = [];
    g.save.calls = cfg.CALLS.map(c => c.id); g.ringingCall = null; g.ui.ringPhone(false, null);
    g.ui._newsQueue.length = 0; g.ui._newsShowing = false;
    g.syncBadges(); g.showIdle();
    return { news: g.save.gunNews.slice(), ann: g.save.gunAnnounced.slice(),
      dot: document.getElementById('phoneDot').classList.contains('on'),
      bannerOn: document.getElementById('newsBanner').classList.contains('on') };})())`));
  check('N1 到过极地那一刻：散弹枪记进未读 + 标记已播报，手机红点亮、推送卡弹出',
    n1.news.join(',') === 'shotgun' && n1.ann.join(',') === 'shotgun'
    && n1.dot === true && n1.bannerOn === true,
    `未读 ${JSON.stringify(n1.news)} · 已播报 ${JSON.stringify(n1.ann)} · 红点=${n1.dot} · 推送卡=${n1.bannerOn}`);

  const n2 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.openPhone();
    return { open: g.phoneOpen,
      badge: !!document.querySelector('#pHome .p-ico.gunshop .p-badge') };})())`));
  check('N2 手机桌面：枪店 App 图标挂红点（和来电红点同一套视觉语言）',
    n2.open === true && n2.badge === true, `红点=${n2.badge}`);

  const n3 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.ui.openApp('gunshop'); g.ui.refreshApp();
    const cards = [...document.querySelectorAll('#pApp .gs-item')];
    const shot = cards.find(c => c.textContent.includes('散弹枪'));
    const uzi = cards.find(c => c.textContent.includes('Uzi'));
    const out = { news: g.save.gunNews.slice(),
      dot: document.getElementById('phoneDot').classList.contains('on'),
      newTag: !!(shot && shot.querySelector('.gs-new')),
      uziLocked: !!(uzi && uzi.classList.contains('unreleased')) };
    g.ui.showPhoneHome();   // 桌面重绘之后红点才会从图标上消失（openApp 只清数据）
    out.homeBadge = !!document.querySelector('#pHome .p-ico.gunshop .p-badge');
    return out;})())`));
  check('N3 点开枪店：未读清零（红点全灭），散弹枪挂「NEW」，还没解锁的 Uzi 仍是黑卡',
    n3.news.length === 0 && n3.dot === false && n3.homeBadge === false
    && n3.newTag === true && n3.uziLocked === true,
    `未读 ${JSON.stringify(n3.news)} · 手机红点=${n3.dot} · 桌面红点=${n3.homeBadge} · NEW=${n3.newTag} · Uzi 黑卡=${n3.uziLocked}`);

  const n4 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    // 自清理到已知态：散弹枪算"已经播报过"，这一步只看 Uzi 的深度解锁
    g.save.gunNews = []; g.save.gunAnnounced = ['shotgun'];
    g.ui._newsQueue.length = 0; g.ui._newsShowing = false;
    g.save.mapBest = { polar: 140 }; g._syncGunNews();
    const queuedInPhone = g.ui._newsQueue.map(x => x.id);
    g.closePhone();   // 手机开着时推送不弹（不打扰）；收起后才放出来
    return { news: g.save.gunNews.slice(), queuedInPhone,
      bannerOn: document.getElementById('newsBanner').classList.contains('on'),
      body: document.getElementById('newsBody').textContent };})())`));
  check('N4 潜到 −140m：Uzi 解锁 → 记进未读；收起手机后推送卡才弹出（手机开着时不打扰）',
    n4.news.join(',') === 'uzi' && n4.queuedInPhone.join(',') === 'uzi'
    && n4.bannerOn === true && /Uzi/.test(n4.body) && !/散弹枪/.test(n4.body),
    `未读 ${JSON.stringify(n4.news)} · 队列 ${JSON.stringify(n4.queuedInPhone)} · 推送「${n4.body}」`);
  const n5 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.save.coins = 99999999;
    g.openPhone(); g.ui.openApp('gunshop'); g.ui.refreshApp();
    document.querySelector('[data-gun-buy="shotgun"]').click(); g.ui.refreshApp();
    const cards = [...document.querySelectorAll('#pApp .gs-item')];
    const shot = cards.find(c => c.textContent.includes('散弹枪'));
    return { owned: g.save.guns.owned.slice(), current: g.save.guns.current,
      newTag: !!(shot && shot.querySelector('.gs-new')) };})())`));
  check('N5 买下新枪：「NEW」角标消失（它只陪到买下为止，announced 只增不减也不影响）',
    n5.owned.includes('shotgun') && n5.current === 'shotgun' && n5.newTag === false,
    `拥有 ${JSON.stringify(n5.owned)} · 当前=${n5.current} · NEW=${n5.newTag}`);

  // ═══════════════════════════════════════════════════════
  console.log('\n── D 存档（枪械字段）──');
  // ═══════════════════════════════════════════════════════
  // D1/D2/D3：写一份"没有 guns 字段 / 等级越界 / current 指向没买的枪"的存档再刷新
  await ev(`(()=>{ localStorage.setItem('hooked.save.v3', JSON.stringify({
      coins: 1234, bestDepth: 100, casts: 2,
      levels: { line: 2 },   // @partial-save —— 故意残缺 + 越界，验读档的钳制
      guns: { owned: ['uzi'], current: 'barrett', levels: { uzi: 99, laser: -4, pistol: 2 } },  // @partial-save
      codex: {} })); return 'ok';})()`);
  await send('Page.navigate', { url: URL });
  await sleep(3200);
  const d1 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    if (!g) return { err: 'no game' };
    const L = g.save.guns.levels;
    const keys = Object.keys(L);
    return { current: g.save.guns.current, owned: g.save.guns.owned,
      uzi: L.uzi, laser: L.laser, pistol: L.pistol, keyCount: keys.length,
      mech: g.gun.mech, dmg: g.gunStat.damage };})())`));
  check('D1 存档里的枪械等级越界会被钳制（99 → 5，−4 → 0），不返回 undefined',
    d1.uzi === 5 && d1.laser === 0 && d1.pistol === 2,
    `uzi ${d1.uzi} · laser ${d1.laser} · pistol ${d1.pistol}`);
  check('D2 current 指向一把没买的枪 → 读档退回手枪（不会"拿着没有的枪开火"）',
    d1.current === 'pistol' && d1.mech === 'single' && Number.isFinite(d1.dmg),
    `current=${d1.current}（存档里写的是 barrett）· 实际机制 ${d1.mech} · 单发 ${d1.dmg}`);
  check('D3 枪械等级表在读档后被补齐成 7 个键（不是只剩存档里那几个）',
    d1.keyCount === 7, `${d1.keyCount} 个键`);

  // D4 完全没有 guns 字段的老存档（v0.4 之前）也要能读
  await ev(`(()=>{ localStorage.setItem('hooked.save.v3', JSON.stringify({
      // @partial-save —— "v0.4 之前的老存档"的定义就是残缺的
      coins: 500, bestDepth: 120, casts: 3, levels: { line: 3, lamp: 2 },
      codex: { sardine: { n: 2, best: 7 } } })); return 'ok';})()`);
  await send('Page.navigate', { url: URL });
  await sleep(3200);
  const d4 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    if (!g) return { err: 'no game' };
    return { current: g.save.guns.current, owned: g.save.guns.owned.length,
      lv: g.save.guns.levels.pistol, dmg: g.gunStat.damage,
      line: g.save.levels.line, coins: g.save.coins };})())`));
  check('D4 老存档（没有 guns 字段）照常读档：退回手枪 Lv0，其它进度不受影响',
    d4.current === 'pistol' && d4.owned === 0 && d4.lv === 0
    && Number.isFinite(d4.dmg) && d4.line === 3 && d4.coins === 500,
    `枪=${d4.current} Lv${d4.lv} 单发 ${d4.dmg} · 鱼线 Lv${d4.line} · 金币 ${d4.coins}`);

  // D5 枪械选择跨刷新保持
  // ⚠ 必须写进 localStorage —— 直接改 `g.save` 只动了内存里那一份，
  //   刷新后读的是 localStorage（persist() 只在游戏内的动作里调）。
  await ev(`(()=>{ const raw = JSON.parse(localStorage.getItem('hooked.save.v3') || '{}');
    raw.coins = 999999;
    raw.guns = { owned: ['uzi'], current: 'uzi', levels: { uzi: 2 } };  // @partial-save：只覆盖枪械那一块
    localStorage.setItem('hooked.save.v3', JSON.stringify(raw));
    return 'ok';})()`);
  await send('Page.navigate', { url: URL });
  await sleep(3200);
  const d5 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    if (!g) return { err: 'no game' };
    return { current: g.save.guns.current, lv: g.save.guns.levels.uzi, mech: g.gun.mech };})())`));
  check('D5 当前枪械与它的等级跨刷新保持（存档里存的是 id + 等级）',
    d5.current === 'uzi' && d5.lv === 2 && d5.mech === 'burst',
    `current=${d5.current} Lv${d5.lv} 机制 ${d5.mech}`);

  // ═══════════════════════════════════════════════════════
  console.log('\n── E 冒烟 ──');
  // ═══════════════════════════════════════════════════════
  const smoke = J(await ev(`(()=>{const g=window.__game;
    g._loop = () => {};
    g.showIdle();
    const seen = [];
    window.step = (n) => { const dt0 = 1/60;
      for (let i=0;i<n;i++){ g.time += dt0; g._update(dt0); }
      g.world.render();
    };
    g.enterDescend();
    for (let i=0;i<60*70;i++){
      window.step(1);
      if (seen[seen.length-1] !== g.state) seen.push(g.state);
      if (g.state === 'result') break;
    }
    return JSON.stringify({ seen, caught: g.run.caught, shot: g.run.shot,
      gun: g.save.guns.current, coins: Math.round(g.save.coins) });})()`));
  check('E1 用当前枪械跑完整一竿（下潜 → 收线 → 上升 → 空中 → 结算）',
    smoke.seen.includes('descend') && smoke.seen.includes('ascend') && smoke.seen.includes('result'),
    smoke.seen.join(' → ') + ` · 串上 ${smoke.caught} 条 / 击落 ${smoke.shot} / 枪 ${smoke.gun}`);
  await shot('E1-full-run');

  const clean = errors.filter((e) => !/favicon|AudioContext/i.test(e));
  check('E2 全程控制台零报错', clean.length === 0, clean.slice(0, 3).join(' | ') || 'clean');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n================  ${pass}/${results.length} 通过  ================\n`);
  fs.writeFileSync(path.resolve('.dev/verify9.json'),
    JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  if (pass !== results.length) process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
}
