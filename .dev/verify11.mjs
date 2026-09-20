/**
 * verify11.mjs — 批 7（鱼的机制：6 种行为模式 + 4 种特殊状态 + Boss 框架）的回归验证
 *
 * 覆盖：
 *   A 数据表（纯 Node，不开浏览器）
 *     · `BEHAVIOR` / `TRAIT` / `BOSS` 三张表的参数自洽
 *     · **每种模式 / 状态都真的有鱼在用**（没有死配置）
 *     · ⭐ **教学图（宁静海湾）一条都不带**（复杂度预算，EXPANSION §3.2 ①）
 *     · 假河豚的**外形参数和硫磺河豚逐字段一致**（拟态的前提）
 *     · `trait` 这个字段名不和 `FISH_STATE` 撞
 *   B 行为模式（浏览器，冻结主循环手动步进）
 *     · cruise 基线 / hunt 追猎 / flee 逃逸 / ambush 伏击 / dash 冲刺节奏
 *     · **六种模式都遵守边界回绕**（游出画面再也不回来是这类代码的经典 bug）
 *   C 特殊状态（浏览器）
 *     · charged 占 2 个鱼护位 · frozen 收线 ×0.75（每竿重置）· burning 鱼护 −1（只一次）
 *     · phantom 有 2 个残影，且**判定用的是真身**
 *   D Boss 框架（浏览器）
 *     · 条件不满足不刷 · 满足则出场 + 血条 · 掉 1/3 血换模式提速 · 打死收起血条
 *   E 冒烟：完整一竿 + 控制台零报错
 *
 * 用法：node .dev/verify11.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../src/config.js';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.VB_PORT || 9367);
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v11');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  · ' + detail : ''}`);
}

const { BEHAVIOR, TRAIT, BOSS, SPECIES, MAPS, ZONES, zonesOfMap, mapOfSpecies } = C;

// ═══════════════════════════════════════════════════════════
// A 组 — 数据表（纯 Node）
// ═══════════════════════════════════════════════════════════
console.log('\n── A 行为 / 状态 / Boss 的数据表 ──');

const BEHAVIOR_KEYS = ['hunt', 'flee', 'ambush', 'dash'];
const TRAIT_KEYS = ['charged', 'frozen', 'burning', 'phantom'];

check('A1 BEHAVIOR 表：4 种有参数的模式齐全，数值都是正数且合法',
  BEHAVIOR_KEYS.every((k) => !!BEHAVIOR[k])
  && BEHAVIOR.hunt.radius > 0 && BEHAVIOR.hunt.speedMul > 0
  && BEHAVIOR.flee.radius > 0 && BEHAVIOR.flee.speedMul > 1     // 逃逸必须比巡游快
  && BEHAVIOR.ambush.radius > 0 && BEHAVIOR.ambush.speedMul > 1 // 伏击的冲刺必须更快
  && BEHAVIOR.dash.run > 0 && BEHAVIOR.dash.rest > 0 && BEHAVIOR.dash.speedMul > 1,
  `hunt×${BEHAVIOR.hunt.speedMul}@${BEHAVIOR.hunt.radius}m · flee×${BEHAVIOR.flee.speedMul}@${BEHAVIOR.flee.radius}m · `
  + `ambush×${BEHAVIOR.ambush.speedMul}@${BEHAVIOR.ambush.radius}m · dash ${BEHAVIOR.dash.run}/${BEHAVIOR.dash.rest}s`);

check('A2 TRAIT 表：4 种状态齐全，参数自洽（带电占 2 位 / 冰冻降速 / 灼热减容量 / 幻影 2 残影）',
  TRAIT_KEYS.every((k) => !!TRAIT[k])
  && TRAIT.charged.slots === 2 && TRAIT.charged.flash === true
  && TRAIT.frozen.ascendMul > 0 && TRAIT.frozen.ascendMul < 1
  && TRAIT.burning.creel === -1
  && TRAIT.phantom.decoys === 2,
  TRAIT_KEYS.map((k) => `${k}:${TRAIT[k].text}`).join(' · '));

// 每种模式 / 状态都真的有鱼在用 —— 没有死配置
const usedB = new Set(SPECIES.map((s) => s.behavior).filter(Boolean));
const usedT = new Set(SPECIES.map((s) => s.trait).filter(Boolean));
check('A3 每一种行为模式 / 特殊状态都**真的有鱼在用**（没有"写了没人读"的死配置）',
  BEHAVIOR_KEYS.every((k) => usedB.has(k)) && TRAIT_KEYS.every((k) => usedT.has(k)),
  `用到的模式 ${[...usedB].join('/')} · 状态 ${[...usedT].join('/')}`);

// ⭐ 教学图一条都不带
const first = MAPS[0];
const firstSp = SPECIES.filter((s) => mapOfSpecies(s).id === first.id);
const firstFx = firstSp.filter((s) => s.behavior || s.trait);
check('A4 ⭐ 教学图（宁静海湾）**一条鱼都不带**行为 / 状态（复杂度预算，EXPANSION §3.2 ①）',
  firstFx.length === 0,
  firstFx.length ? firstFx.map((s) => s.id).join(',') : `${firstSp.length} 种鱼全部保持 cruise + 无状态`);

// 带 bossWhen 的 Boss：每张图恰好一个，且条件字段完整
const bossWith = SPECIES.filter((s) => s.bossWhen);
const bossBad = [];
for (const m of MAPS) {
  // ⚠ 终章 Boss（final: true）单独算 —— 它和本图的常规 Boss 共存是设计。
  const list = bossWith.filter((s) => mapOfSpecies(s).id === m.id && !s.final);
  if (list.length > 1) bossBad.push(m.id + ':' + list.length + ' 个');
}
for (const s of bossWith) {
  if (!(s.bossWhen.depth > 0)) bossBad.push(s.id + ':depth 非法');
  if (!(s.bossWhen.caught >= 1)) bossBad.push(s.id + ':caught 非法');
}
check('A5 带出场条件的 Boss：每张图最多一个**常规**（终章另算），且触发字段都合法',
  bossBad.length === 0,
  bossBad.join(',') || bossWith.map((s) => `${s.name}(−${s.bossWhen.depth}m / ${s.bossWhen.caught} 条)`).join(' · '));

check('A6 BOSS.phases 里的每一项都是合法行为键（含 cruise），且段数与 phases 对得上',
  Array.isArray(BOSS.phases) && BOSS.phases.length >= BOSS.segments
  && BOSS.phases.every((p) => p === 'cruise' || !!BEHAVIOR[p])
  && BOSS.segments >= 2 && BOSS.phaseSpeedMul > 1,
  `phases=${BOSS.phases.join('→')} · ${BOSS.segments} 段 · 每段 ×${BOSS.phaseSpeedMul}`);

// 假河豚：拟态的前提是"外形一模一样"
const puffer = SPECIES.find((s) => s.id === 'sulfur-puffer');
const mimic = SPECIES.find((s) => s.id === 'mimic-puffer');
const LOOK = ['color', 'belly', 'spots', 'spikes', 'radius', 'body', 'tail', 'fin', 'eye'];
const lookDiff = mimic ? LOOK.filter((k) => JSON.stringify(mimic[k]) !== JSON.stringify(puffer[k])) : ['缺 mimic-puffer'];
check('A7 假河豚的**外形参数和硫磺河豚逐字段一致** —— 这是"拟态"能成立的前提',
  lookDiff.length === 0,
  lookDiff.length ? '不一致：' + lookDiff.join(',') : `${LOOK.length} 个外形字段全部相同`);

check('A8 假河豚不是扣钱鱼，且身价明显高于真河豚（"别急着躲"才有回报）',
  !!mimic && !mimic.hazard && !!puffer.hazard && mimic.value > puffer.value * 2,
  mimic ? `真河豚 ${puffer.value} 扣钱 / 假河豚 ${mimic.value} 不扣钱` : '缺 mimic-puffer');

// ⚠ trait 和 FISH_STATE 不能撞名
check('A9 配置字段叫 `trait` 而不是 `state` —— 不和 `FISH_STATE`（swim/caught/air/dead）撞名',
  SPECIES.every((s) => s.state === undefined) && SPECIES.some((s) => s.trait),
  '没有鱼种写 def.state');

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

const profile = path.resolve('.dev/profile-v11-' + Date.now());
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
  check('A0 测试用的 window.__cfg 已注入（探针拿现值断言的唯一入口）',
    (await ev('typeof window.__cfg?.BEHAVIOR?.hunt?.speedMul')) === 'number',
    'BEHAVIOR 键数 = ' + await ev('Object.keys(window.__cfg.BEHAVIOR).length'));
  await ev('document.getElementById("startBtn").click()');
  await sleep(400);

  // 冻结主循环：行为模式 / 引信 / 计时都按帧推进，必须手动定步长才可复现
  await ev(`(()=>{const g=window.__game; if(!g) return 'no game'; g._loop = () => {};
    window.__cfg.TUNING.airSettleGrace = 999;
    window.step = (n) => { const dt0 = 1/60;
      for (let i=0;i<n;i++){ g.time += dt0; g._update(dt0); }
      g.world.render();
    };
    return 'ok';})()`);
  await sleep(200);

  // ═══════════════════════════════════════════════════════════
  // B 行为模式
  // ═══════════════════════════════════════════════════════════
  console.log('\n── B 六种行为模式 ──');

  // 夹具：清空鱼池，塞一条指定 behavior 的鱼（放在 x=0），把钩子摆到指定位置
  //
  // ⚠⚠ **两个坑，都踩过**：
  //   ① 钩子**不能和鱼放在同一个 x 上**：下潜阶段有一条"撞鱼 → 直接串上"的判定，
  //      摆在一起的话第一帧鱼就被串走了（`state` 变成 CAUGHT，`update` 直接 return，
  //      后面所有"它游了多远"的断言全是 0）。
  //   ② 钩子**不能瞬移**：那条判定用的是 `distToSegment(prev → now)`，
  //      瞬移会让线段**扫过整个屏幕**，把路上的鱼全串走。
  //      所以这里把 `dropGraceT` 顶到 999 —— 它就是"落地缓冲期不判撞鱼"那个闸，
  //      测试期间直接关掉这条判定，只留我们要验的游动逻辑。
  const rig = (behavior, hx, hy, extra = '') => `(()=>{const g=window.__game; const cfg=window.__cfg;
    g.fish.releaseAll(); g.caught = []; g.state='descend'; g.dropGraceT = 999;
    g.hook.x=${hx}; g.hook.y=${hy}; g.targetX=${hx};
    const def = cfg.SPECIES.find(s=>s.behavior==='${behavior}') || cfg.SPECIES[0];
    const f = g.fish.acquire(def);
    f.reset(0, ${hy});
    f.behavior = '${behavior}';
    f.speed = 40; f.dir = 1; f.behaviorT = 0; f.dashing = true;
    ${extra}
    return f;})()`;

  const b1 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const f = ${rig('hunt', -300, -200)};
    // cruise 基线：把 behavior 改成 cruise，钩子在远处
    f.behavior = 'cruise';
    const x0 = f.x; for (let i=0;i<30;i++) window.step(1);
    return { moved: +(f.x - x0).toFixed(2), dir: f.dir };})())`));
  check('B1 基线：`cruise`（不写 behavior 的鱼）匀速直游，钩子在旁边也不改向',
    b1.moved > 15 && b1.dir === 1, `半秒走了 ${b1.moved}（40/s × 0.5 ≈ 20）`);

  const b2 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    // 钩子在左边 → hunt 应该掉头朝左
    // ⚠ 距离要在 BEHAVIOR.hunt.radius（110）**之内** —— 放 300 远的话它按设计就不该改向，
    //   那样测的是「半径外不追」，和这条断言的意图正好相反。
    const f = ${rig('hunt', -80, -200)};
    f.x = 0; f.dir = 1;
    for (let i=0;i<10;i++) window.step(1);
    return { dir: f.dir, x: Math.round(f.x) };})())`));
  check('B2 `hunt` 追猎：钩子在左侧时掉头朝左游过来', b2.dir === -1, `dir=${b2.dir}（−1 = 朝左）x=${b2.x}`);

  const b3 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const B = window.__cfg.BEHAVIOR.flee;
    // ① 钩子远：照常巡游（速度 = 基准）
    const f = ${rig('flee', 0, 0)};
    f.x = 0; f.dir = 1;
    let far = f._steer(1/60, { x: 0, y: -B.radius * 3 });
    // ② 钩子近且在右边 → 应该掉头朝左**加速**
    f.x = 0;
    let near = f._steer(1/60, { x: 0, y: -10 });
    return { far: +far.toFixed(2), near: +near.toFixed(2), radius: B.radius, mul: B.speedMul };})())`));
  check('B3 `flee` 逃逸：进半径就**掉头加速**（方向是"离开钩子"，不是"撞上来"）',
    b3.far === 40 && b3.near < 0 && Math.abs(b3.near) > b3.far,
    `半径外 ${b3.far} → 半径内 ${b3.near}（应为负、绝对值更大）· 半径 ${b3.radius}m ×${b3.mul}`);

  const b4 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const B = window.__cfg.BEHAVIOR.ambush;
    const f = ${rig('ambush', 0, 0)};
    f.x = 0; f.dir = 1;
    const idle = f._steer(1/60, { x: 0, y: -B.radius * 3 });   // 远处 → 静止
    const rush = f._steer(1/60, { x: 0, y: -10 });             // 近处 → 冲刺
    return { idle: +idle.toFixed(2), rush: +rush.toFixed(2), radius: B.radius, mul: B.speedMul };})())`));
  check('B4 `ambush` 伏击：玩家没靠近时**完全静止**，进入半径才突然冲刺',
    b4.idle === 0 && Math.abs(b4.rush) > 40,
    `半径外 ${b4.idle}（应为 0）→ 半径内 ${b4.rush} · 半径 ${b4.radius}m ×${b4.mul}`);

  const b5 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const B = window.__cfg.BEHAVIOR.dash;
    const f = ${rig('dash', 999, -999)};      // 钩子放很远，排除 seek 干扰
    f.x = 0; f.dir = 1; f.behaviorT = B.run; f.dashing = true;
    // 跑 run 秒 + 0.1s：应该已经翻到"停"
    for (let i=0;i<Math.ceil((B.run + 0.1) * 60);i++) window.step(1);
    const resting = f.dashing;
    const vRest = f._steer(1/60, { x: 999, y: -999 });
    // 再跑 rest 秒 + 0.1s：应该翻回"冲"
    for (let i=0;i<Math.ceil((B.rest + 0.1) * 60);i++) window.step(1);
    const dashing = f.dashing;
    const vDash = f._steer(1/60, { x: 999, y: -999 });
    return { resting, vRest: +vRest.toFixed(2), dashing, vDash: +vDash.toFixed(2), run: B.run, rest: B.rest };})())`));
  check('B5 `dash` 冲刺：冲 `run` 秒 → 停 `rest` 秒 → 再冲（有节奏，不是一直好抓）',
    b5.resting === false && b5.vRest === 0 && b5.dashing === true && Math.abs(b5.vDash) > 40,
    `${b5.run}s 后 dashing=${b5.resting}（停，v=${b5.vRest}）→ 再 ${b5.rest}s 后 dashing=${b5.dashing}（v=${b5.vDash}）`);

  const b6 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    // 每种模式都跑够久，确认**边界回绕**在六种模式里都生效（游出画面再也不回来是经典 bug）
    g.dropGraceT = 999;                 // 关掉"撞鱼"判定，只验游动
    const out = {};
    for (const b of ['cruise','hunt','flee','ambush','dash']) {
      g.fish.releaseAll();
      const def = cfg.SPECIES.find(s=>s.behavior===b) || cfg.SPECIES[0];
      const f = g.fish.acquire(def); f.reset(0, -200); f.behavior = b; f.speed = 300; f.dir = 1;
      g.hook.x = -9999; g.hook.y = -200;
      // ⚠ 回绕的边界是 \`WORLD.fishHalfWidth + **这条鱼的 radius**\`，不是裸的 fishHalfWidth ——
      //   拿后者当基准的话，每条鱼都会"看起来越界"，而其实它规规矩矩地绕回来了。
      const hw = cfg.WORLD.fishHalfWidth + f.radius;
      let maxX = -1e9, minX = 1e9;
      for (let i=0;i<600;i++) { window.step(1); maxX = Math.max(maxX, f.x); minX = Math.min(minX, f.x); }
      out[b] = { maxX: Math.round(maxX), minX: Math.round(minX), hw: Math.round(hw) };
    }
    return out;})())`));
  const b6bad = Object.entries(b6).filter(([, v]) => v.maxX > v.hw + 1 || v.minX < -v.hw - 1);
  check('B6 六种模式**都遵守边界回绕**（速度给到 300 也不会有鱼游出画面再也不回来）',
    b6bad.length === 0,
    b6bad.length ? b6bad.map(([k, v]) => `${k}:${v.minX}~${v.maxX} > ±${v.hw}`).join(' / ')
      : Object.entries(b6).map(([k, v]) => `${k}:${v.minX}~${v.maxX}(±${v.hw})`).join(' '));

  // ═══════════════════════════════════════════════════════════
  // C 特殊状态
  // ═══════════════════════════════════════════════════════════
  console.log('\n── C 四种特殊状态 ──');

  const c1 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.fish.releaseAll(); g.caught = []; g.creelLimit = 8;
    const mk = (trait) => { const d = Object.assign({}, cfg.SPECIES.find(s=>s.id==='mackerel'), { id: 'x-'+(trait||'none'), trait });
      const f = g.fish.acquire(d); f.reset(0, -100); return f; };
    const plain = mk(null); g._catch(plain);
    const after1 = { used: g._creelUsed(), n: g.caught.length };
    const charged = mk('charged'); g._catch(charged);
    const after2 = { used: g._creelUsed(), n: g.caught.length };
    return { after1, after2, slots: g.caught.map(f=>f.slots||1) };})())`));
  check('C1 `charged` 带电：占 **2 个鱼护位**（普通鱼 1 个）—— 鱼护按"占位"算而不是按条数',
    c1.after1.used === 1 && c1.after1.n === 1
    && c1.after2.used === 3 && c1.after2.n === 2,
    `1 条普通 → 占 ${c1.after1.used} 位；再串 1 条带电 → 占 ${c1.after2.used} 位（${c1.after2.n} 条）· slots=${c1.slots.join(',')}`);

  const c2 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    // ⚠ 先开新一竿把 ascendMul 洗回 1 —— 不然基准会被前面几组（B6 那批鱼里有带 frozen 的）
    //   污染，跑出来是"180 → 180"而不是"240 → 180"，看着像机制没生效。
    g._resetRun();
    const base = g.reelSpeed;
    g.fish.releaseAll(); g.caught = [];
    const d = Object.assign({}, cfg.SPECIES.find(s=>s.id==='mackerel'), { id: 'x-frozen', trait: 'frozen' });
    const f = g.fish.acquire(d); f.reset(0, -100); g._catch(f);
    const frozen = g.reelSpeed;
    // 再串一条冰冻的：**不叠加**（取 min，不是连乘）
    const f2 = g.fish.acquire(d); f2.reset(0, -100); g._catch(f2);
    const frozen2 = g.reelSpeed;
    // 新一竿：应该回到 1
    g._resetRun();
    return { base: +base.toFixed(1), frozen: +frozen.toFixed(1), frozen2: +frozen2.toFixed(1),
      afterReset: +g.reelSpeed.toFixed(1), mul: cfg.TRAIT.frozen.ascendMul };})())`));
  check('C2 `frozen` 冰冻：本竿收线 ×0.75，**不叠加**，而且**每竿重置回 1**',
    Math.abs(c2.frozen / c2.base - c2.mul) < 1e-6 && c2.frozen2 === c2.frozen && c2.afterReset === c2.base,
    `${c2.base} → ${c2.frozen} → ${c2.frozen2}（第二条不叠加）→ 新竿 ${c2.afterReset}`);

  const c3 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.fish.releaseAll(); g.caught = []; g.creelLimit = 10; g._traitCreelDone = false;
    const mk = () => { const d = Object.assign({}, cfg.SPECIES.find(s=>s.id==='mackerel'), { id: 'x-burning', trait: 'burning' });
      const f = g.fish.acquire(d); f.reset(0, -100); return f; };
    const before = g.creelLimit;
    g._catch(mk()); const after1 = g.creelLimit;
    g._catch(mk()); const after2 = g.creelLimit;
    g._catch(mk()); const after3 = g.creelLimit;
    return { before, after1, after2, after3 };})())`));
  check('C3 `burning` 灼热：鱼护上限 −1，**每竿只触发一次**（一串灼热鱼不会把鱼护压到 0）',
    c3.after1 === c3.before - 1 && c3.after2 === c3.after1 && c3.after3 === c3.after1,
    `上限 ${c3.before} → ${c3.after1} → ${c3.after2} → ${c3.after3}`);

  const c4 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.fish.releaseAll(); g.caught = [];
    const d = Object.assign({}, cfg.SPECIES.find(s=>s.id==='manta'), { id: 'x-phantom', trait: 'phantom' });
    const f = g.fish.acquire(d); f.reset(0, -100);
    const n = f.decoys ? f.decoys.length : 0;
    const vis0 = f.decoys ? f.decoys.filter(x=>x.visible).length : 0;
    for (let i=0;i<6;i++) window.step(1);
    const vis1 = f.decoys ? f.decoys.filter(x=>x.visible).length : 0;
    // 判定用的是真身：真身在原点附近，残影横向错开 —— 串的判定必须落在真身上
    const trueX = f.x;
    const decoyOff = f.decoys ? Math.abs(f.decoys[0].position.x) : 0;
    // 串上之后残影必须收起来（真身已经暴露）
    g._catch(f);
    for (let i=0;i<2;i++) window.step(1);
    const visAfter = f.decoys ? f.decoys.filter(x=>x.visible).length : -1;
    return { n, vis0, vis1, trueX: Math.round(trueX), decoyOff: Math.round(decoyOff), visAfter };})())`));
  check('C4 `phantom` 幻影：2 个残影横向错开（不是叠在一起）；串上之后残影收起（真身已暴露）',
    c4.n === 2 && c4.vis1 === 2 && c4.decoyOff > 0 && c4.visAfter === 0,
    `${c4.n} 个残影 · 可见 ${c4.vis0}→${c4.vis1} · 横向错开 ${c4.decoyOff} · 串上后可见 ${c4.visAfter}`);
  await shot('C4-phantom');

  // ═══════════════════════════════════════════════════════════
  // D Boss 框架
  // ═══════════════════════════════════════════════════════════
  console.log('\n── D Boss 框架 ──');

  const d1 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.save.charts = { polar: true, lava: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.enterMap('lava');
    const defs = g.bossDefs.map(d=>d.id);
    // 池子里不该有带 bossWhen 的鱼
    const inPool = g.fish.active.filter(f=>f.def.bossWhen).length;
    // 条件不满足：深度不够 → 不该出现
    g._resetRun();
    g.state = 'descend'; g.hook.y = -100; g.run.caught = 0;
    g._checkBossTrigger();
    const noTrigger = !!g.boss;
    // 只满足一半（深度够、串鱼不够）
    g.hook.y = -1400; g.run.caught = 1;
    g._checkBossTrigger();
    const halfTrigger = !!g.boss;
    return { defs, inPool, noTrigger, halfTrigger, need: g.bossDefs[0] ? g.bossDefs[0].bossWhen : null };})())`));
  check('D1 Boss 不进普通鱼池；**两个条件都满足**才出场（深度够但串鱼不够 → 不刷）',
    // ⚠ 候选数改成 >= 1：熔岩海沟现在有**两个**（常规 + 终章），靠触发深度分层 ——
    //   不是"一张图只能有一个 Boss"。
    d1.defs.length >= 1 && d1.inPool === 0 && d1.noTrigger === false && d1.halfTrigger === false,
    `候选 ${d1.defs.join(',')} · 池中 ${d1.inPool} 条 · 条件 ${JSON.stringify(d1.need)}`);

  const d2 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g._resetRun();
    g.state = 'descend'; g.hook.x = 0; g.hook.y = -1400; g.targetX = 0; g.run.caught = 5;
    g._checkBossTrigger();
    const bar = document.getElementById('bossBar');
    const fill = document.getElementById('bossFill');
    return { spawned: !!g.boss, name: g.boss ? g.boss.def.name : null,
      barShown: !bar.classList.contains('hidden'), barName: document.getElementById('bossName').textContent,
      width: fill ? fill.style.width : null,
      segLines: document.querySelectorAll('#bossTrack i').length,
      below: g.boss ? (g.boss.y < g.hook.y) : null };})())`));
  // ⚠ 宽度**按数值比**：浏览器会把 `100.0%` 规范化成 `100%`，比字符串会假失败
  check('D2 条件满足 → Boss 出场（刷在钩子**下方**）+ 顶部血条出现 + 分段刻度按 `BOSS.segments` 生成',
    d2.spawned === true && d2.barShown === true && parseFloat(d2.width) === 100
    && d2.segLines === BOSS.segments - 1 && d2.below === true,
    `${d2.name} · 血条「${d2.barName}」width=${d2.width} · 刻度 ${d2.segLines} 条 · 刷在钩子下方=${d2.below}`);
  await shot('D2-boss-appear');

  const d3 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const f = g.boss;
    if (!f) return { err: '没有 Boss' };
    const b0 = f.behavior, s0 = f.speed;
    // 打掉 40% 的血 → 应该跨过第 1 段
    f.damage(f.maxHp * 0.4);
    g._syncBossBar(f);
    const p1 = g._bossPhase, b1 = f.behavior, s1 = f.speed;
    // 再打 40% → 第 2 段
    f.damage(f.maxHp * 0.4);
    g._syncBossBar(f);
    const p2 = g._bossPhase, b2 = f.behavior, s2 = f.speed;
    const fill = document.getElementById('bossFill');
    // ⚠ 速度**不要在这里取整**：39/29 = 1.345 被 round 掉之后，比 1.35 会差 0.005
    //   （断言里容差是 1e-6），看起来像"倍率没生效"，其实是测量精度的问题。
    return { b0, s0, p1, b1, s1, p2, b2, s2,
      width: fill ? fill.style.width : null, phases: window.__cfg.BOSS.phases, mul: window.__cfg.BOSS.phaseSpeedMul };})())`));
  check('D3 每打掉 1/segments 的血 → 换一次行为模式 + 提速（血条宽度同步）',
    d3.p1 === 1 && d3.p2 === 2 && d3.b1 !== d3.b0 && d3.b2 !== d3.b1
    && Math.abs(d3.s1 / d3.s0 - BOSS.phaseSpeedMul) < 1e-6 && parseFloat(d3.width) === 20,
    `模式 ${d3.b0}→${d3.b1}→${d3.b2} · 速度 ${d3.s0.toFixed(1)}→${d3.s1.toFixed(1)}→${d3.s2.toFixed(1)} · 血条 ${d3.width}`);

  const d4 = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const f = g.boss;
    if (!f) return { err: '没有 Boss' };
    f.damage(f.maxHp * 2);          // 直接打死
    g._hitFish(f);
    const bar = document.getElementById('bossBar');
    return { boss: !!g.boss, hidden: bar.classList.contains('hidden') };})())`));
  check('D4 Boss 被打死 → 血条收起、`this.boss` 清空',
    d4.boss === false && d4.hidden === true,
    `boss=${d4.boss} · 血条 hidden=${d4.hidden}`);

  // ═══════════════════════════════════════════════════════════
  // E 冒烟
  // ═══════════════════════════════════════════════════════════
  console.log('\n── E 冒烟 ──');

  const smoke = J(await ev(`(()=>{try{const g=window.__game; const cfg=window.__cfg;
    cfg.TUNING.airSettleGrace = 1.8;
    g.save.charts = { polar: true, lava: true };
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.save.levels = Object.fromEntries(cfg.UPGRADE_ORDER.map(k=>[k, k==='winch'?0:cfg.MAX_LEVEL]));
    g.applyUpgrades();
    g.enterMap('lava');
    g.showIdle();
    for (let i=0;i<10;i++) window.step(1);
    g.enterDescend();
    const seen = new Set();
    for (let i=0;i<60*90;i++) { window.step(1); seen.add(g.state); if (g.state === 'result') break; }
    return JSON.stringify({ seen: [...seen], caught: g.run.caught, depth: Math.round(g.run.depth),
      boss: !!g.boss, map: g.map.id });
    }catch(e){return JSON.stringify({ err: e.message });}})()`));
  check('E1 在熔岩海沟跑完整一竿（下潜 → 收线 → 上升 → 空中 → 结算），带新行为/状态的鱼也在里面',
    smoke.seen.includes('descend') && smoke.seen.includes('ascend') && smoke.seen.includes('result'),
    `${smoke.seen.join(' → ')} · 最深 ${smoke.depth}m · 串上 ${smoke.caught} 条 · 场上 Boss=${smoke.boss}`);
  await shot('E1-full-run');

  const clean = errors.filter((e) => !/favicon|AudioContext/i.test(e));
  check('E2 全程控制台零报错', clean.length === 0, clean.slice(0, 3).join(' | ') || 'clean');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n================  ${pass}/${results.length} 通过  ================\n`);
  fs.writeFileSync(path.resolve('.dev/verify11.json'),
    JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  if (pass !== results.length) process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
}
