/**
 * verify3.mjs — 第 4 轮改造的回归验证
 *
 * 覆盖：
 *   · 状态机 IDLE 待机 + 渔具店独立入口
 *   · 11 项升级（鱼线 / 鱼钩 / 铅坠 / 攻击力 / 灯具 / 绞盘 / 鱼护 / 保险 / 声呐 / 鱼饵 / 加固）
 *   · 核心逻辑反转：下潜碰鱼→自动上升；上升碰鱼→勾住
 *   · 空中结算及时性（不再被飞鸟卡住）
 *   · 空中镜头不跟随河豚
 *   · 深海黑暗 + 灯具照明 + 两侧地形
 *   · 多屏幕比例
 *
 * 用法：node .dev/verify3.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const URL = 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v3');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  · ' + detail : ''}`);
}

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

const profile = path.resolve('.dev/profile-v3-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
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
      return { __err: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || '').split('\n')[0] };
    }
    return r.result?.result?.value;
  };
  const J = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };

  const PE = (type, nx, ny) => `(()=>{
    const c = document.getElementById('game');
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('${type}', {
      clientX: r.left + r.width * ${nx}, clientY: r.top + r.height * ${ny},
      pointerId: 1, bubbles: true, cancelable: true,
    }));
    return 'ok';
  })()`;

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3500);

  // ── 冻结 rAF，改手动定步长 ──
  await ev(`(()=>{const g=window.__game; if(!g) return 'no game'; g._loop = () => {};
    window.step = (n) => { const dt0 = 1/60;
      for (let i=0;i<n;i++){
        if (g.slowmoT > 0) { g.slowmoT -= dt0; if (g.slowmoT <= 0) g.timeScale = 1; }
        const dt = dt0 * g.timeScale; g.time += dt; g._update(dt);
      }
      g.world.render();
    };
    return 'ok';})()`);
  await sleep(300);

  // ═══════════════════════════════════════════════════════
  // T1 标题 → 待机
  // ═══════════════════════════════════════════════════════
  const boot = J(await ev('JSON.stringify({state: window.__game.state, hooked: !!window.__game.hook})'));
  check('T1 游戏启动到标题页', boot.state === 'title', 'state=' + boot.state);

  await ev('document.getElementById("startBtn").click()');
  await ev('window.step(30)');
  const idle = J(await ev(`JSON.stringify({
    state: window.__game.state,
    scale: +window.__game.world.viewScale.toFixed(3),
    phoneBtn: document.getElementById('phoneBtn').classList.contains('on'),
    hud: !document.getElementById('hud').classList.contains('hidden'),
    camY: Math.round(window.__game.world.camY),
    viewH: Math.round(window.__game.world.viewH),
  })`));
  check('T2 进入待机态（渔夫在船上）', idle.state === 'idle', 'state=' + idle.state);
  check('T3 待机时相机推近', Math.abs(idle.scale - 0.62) < 0.05, 'viewScale=' + idle.scale);
  check('T4 待机时手机入口出现', idle.phoneBtn === true && idle.hud === true, `phoneBtn=${idle.phoneBtn} hud=${idle.hud}`);
  const boatIn = idle.camY + idle.viewH / 2 > 30 && idle.camY - idle.viewH / 2 < 0;
  check('T5 船与渔夫完整在画面内', boatIn, `camY=${idle.camY} viewH=${idle.viewH}`);
  await shot('01-idle');

  // ═══════════════════════════════════════════════════════
  // T6 手机 → 渔具店 App + 11 项升级
  // ═══════════════════════════════════════════════════════
  await ev('document.getElementById("phoneBtn").click()');
  await ev('window.step(6)');
  await ev(`document.querySelector('[data-app="shop"]').click()`);
  await ev('window.step(6)');
  const shop = J(await ev(`JSON.stringify({
    state: window.__game.state,
    phone: !document.getElementById('phoneLayer').classList.contains('hidden'),
    app: window.__game.ui.currentApp,
    items: document.querySelectorAll('#pApp .item').length,
    names: [...document.querySelectorAll('#pApp .item .nm')].map(e=>e.textContent.replace(/Lv\\.\\d+/,'').trim()),
  })`));
  check('T6 手机里打开渔具店 App（状态仍是 idle，世界继续跑）',
    shop.phone === true && shop.app === 'shop' && shop.state === 'idle',
    `state=${shop.state} app=${shop.app}`);
  check('T7 商店有 11 项升级（5 项基础 + 3 项新轴 + 3 项进阶）',
    shop.items === 11, 'items=' + shop.items + ' → ' + shop.names.join('/'));
  await shot('02-shop');

  // 给钱，逐项买满，验证数值真的变了
  await ev('window.__game.save.coins = 9999999; window.__game.ui.refreshApp();');
  await ev('window.step(2)');
  const before = J(await ev(`JSON.stringify({
    maxDepth: window.__game.maxDepth, hookR: +window.__game.hook.radius.toFixed(2),
    sink: window.__game.descendSpeed, lampR: window.__game.world.lampR,
  })`));
  for (let i = 0; i < 4; i++) {
    for (const k of ['line', 'hook', 'sinker', 'power', 'lamp']) {
      await ev(`(()=>{const b=document.querySelector('#pApp .buy[data-k="${k}"]'); if(b&&!b.disabled) b.click(); return 'ok';})()`);
    }
  }
  await ev('window.step(2)');
  const after = J(await ev(`JSON.stringify({
    lv: window.__game.save.levels,
    maxDepth: window.__game.maxDepth, hookR: +window.__game.hook.radius.toFixed(2),
    sink: window.__game.descendSpeed, lampR: window.__game.world.lampR,
    lampP: +window.__game.world.lampP.toFixed(2),
    lineLimitTop: document.querySelector('#ruler .limit').style.top,
  })`));
  check('T8 鱼线升级 → 最大下潜深度 840', after.maxDepth === 840 && before.maxDepth === 320, `${before.maxDepth} → ${after.maxDepth}`);
  check('T9 鱼钩升级 → 判定半径 17.6', after.hookR === 17.6 && before.hookR === 8, `${before.hookR} → ${after.hookR}`);
  check('T10 铅坠升级 → 下潜速度 136', after.sink === 136 && before.sink === 64, `${before.sink} → ${after.sink}`);
  check('T11 灯具升级 → 照亮半径 240', after.lampR === 240 && before.lampR === 52, `${before.lampR} → ${after.lampR}`);
  check('T12 攻击力满级', after.lv.power === 4, 'power=' + after.lv.power);

  // 收起手机回到船上
  await ev('window.__game.closePhone()');
  await ev('window.step(10)');
  const backIdle = J(await ev('JSON.stringify({state: window.__game.state, phoneHidden: document.getElementById("phoneLayer").classList.contains("hidden")})'));
  check('T13 收起手机返回待机', backIdle.state === 'idle' && backIdle.phoneHidden === true, 'state=' + backIdle.state);

  // ═══════════════════════════════════════════════════════
  // T14 点击屏幕抛竿 → 下潜
  // ═══════════════════════════════════════════════════════
  await ev(PE('pointerdown', 0.5, 0.5));
  await ev(PE('pointerup', 0.5, 0.5));
  await ev('window.step(4)');
  const desc = J(await ev(`JSON.stringify({
    state: window.__game.state, maxDepth: window.__game.maxDepth,
    hookR: +window.__game.hook.radius.toFixed(2),
    lampR: window.__game.world.lampR,
    phoneBtn: document.getElementById('phoneBtn').classList.contains('on'),
  })`));
  check('T14 点击屏幕开始抛竿', desc.state === 'descend', 'state=' + desc.state);
  check('T15 下潜阶段隐藏手机入口', desc.phoneBtn === false, 'phoneBtn=' + desc.phoneBtn);
  check('T16 抛竿时带上升级后的装备', desc.maxDepth === 840 && desc.hookR === 17.6 && desc.lampR === 240,
    `depth=${desc.maxDepth} hookR=${desc.hookR} lampR=${desc.lampR}`);
  await shot('03-cast');

  // 等抛竿动画结束
  await ev('window.step(40)');

  // ═══════════════════════════════════════════════════════
  // T17 下潜碰到鱼 → 直接串上这条鱼，并带着下潜速度继续滑一段再上升
  // ═══════════════════════════════════════════════════════
  // 先把场景做成完全可控：只留下一条鱼，其余全挪到够不着的地方，
  // 否则钩子自己往下潜的时候就会随机撞到别的鱼，测试不可复现。
  const placed = J(await ev(`(()=>{const g=window.__game;
    let guard = 0;
    while (g.state !== 'descend' && guard++ < 60) { g.enterDescend(); window.step(1); }
    guard = 0;
    while (g.castT > 0 && guard++ < 200) window.step(1);
    for (const f of g.fish.active) { f.speed = 0; f.bobAmp = 0; f.x = 0; f.y = -3000; f.mesh.position.set(0,-3000,0); }
    const f = g.fish.active[0];
    f.y = g.hook.y - 40; f.x = g.hook.x; f.mesh.position.set(f.x, f.y, 0);
    window.__t17 = f;
    return JSON.stringify({state:g.state, hookY:Math.round(g.hook.y), fishY:Math.round(f.y), name:f.def.name});})()`));

  // v0.3：撞鱼不再只是「惩罚」—— 撞到的那条**直接串上**，然后钩子带着当前下潜速度
  // 继续滑一小段刹停，再上升。所以要同时验三件事：
  //   ① 鱼串上了（caught 计数 +1，鱼的状态变 caught）
  //   ② 真的又往下滑了一段（glide > 0，且不超过 reelPreDepth 上限）
  //   ③ 起手速度 = 下潜速度（不是从 0 开始的 smoothstep —— 那是「顿一下再往下」）
  const bump = J(await ev(`(()=>{const g=window.__game;
    let caughtAtBump = -1, frames = 0, yAtBump = null, minY = null, prevY = null, firstDy = null;
    for (let i=0;i<200;i++){
      const before = g.reelPre;
      window.step(1); frames++;
      if (before === 0 && g.reelPre > 0 && yAtBump === null) { yAtBump = g.hook.y; caughtAtBump = g.run.caught; }
      if (yAtBump !== null) {
        if (firstDy === null && prevY !== null) firstDy = prevY - g.hook.y;
        minY = (minY === null) ? g.hook.y : Math.min(minY, g.hook.y);
      }
      prevY = g.hook.y;
      if (g.state === 'ascend') break;
    }
    return JSON.stringify({state:g.state, frames, caughtAtBump,
      glide: yAtBump === null ? null : +(yAtBump - minY).toFixed(1),
      firstDy: firstDy === null ? null : +firstDy.toFixed(2),
      perFrame: +(g.descendSpeed / 60).toFixed(2),
      depth: Math.round(g.run.depth), fishState: window.__t17.state,
      hookR: window.__game.hook.radius});})()`));
  check('T17 下潜撞鱼 → 直接串上这条鱼，并带着下潜速度继续滑一段再上升',
    bump.state === 'ascend' && bump.caughtAtBump === 1 && bump.fishState === 'caught'
    && bump.glide > 5 && bump.glide <= 61
    && Math.abs(bump.firstDy - bump.perFrame) <= bump.perFrame * 0.35 + 0.2
    && bump.frames < 200,
    `${bump.frames} 帧后 state=${bump.state}，撞鱼瞬间 caught=${bump.caughtAtBump}、鱼 ${bump.fishState}；`
    + `继续下滑 ${bump.glide}m，起手 ${bump.firstDy}/帧（下潜 ${bump.perFrame}/帧）`
    + `（放在 ${placed.name} y=${placed.fishY}，钩在 y=${placed.hookY}，判定半径 ${bump.hookR}）`);

  // ═══════════════════════════════════════════════════════
  // T18 上升碰到鱼 → 被勾住
  // ═══════════════════════════════════════════════════════
  await ev(`(()=>{const g=window.__game;
    const list = g.fish.active.filter(x=>x.state==='swim' && !x.def.hazard).slice(0,3);
    list.forEach((f,i)=>{ f.speed=0; f.bobAmp=0; f.x = g.hook.x; f.y = g.hook.y + 12 + i*14;
      f.mesh.position.set(f.x,f.y,0); });
    window.__t18 = list.map(f=>f.def.name);
    return 'ok';})()`);
  const caught = J(await ev(`(()=>{const g=window.__game;
    let lineFishAt3 = -1, frames = 0;
    for (let i=0;i<90;i++){
      window.step(1); frames++;
      if (g.run.caught >= 3) { lineFishAt3 = g.caught.length; break; }
    }
    return JSON.stringify({state:g.state, caught:g.run.caught, frames, lineFishAt3,
      listRows: document.querySelectorAll('#catchList .row').length, placed: window.__t18});})()`));
  check('T18 上升碰到鱼 → 串上鱼线', caught.caught >= 3 && caught.lineFishAt3 >= 3,
    `caught=${caught.caught} 鱼线上=${caught.lineFishAt3} 名单=${caught.listRows} 放的鱼=${caught.placed}（${caught.frames} 帧）`);
  await shot('04-ascend');

  // ═══════════════════════════════════════════════════════
  // T19 出水 → 空中
  // ═══════════════════════════════════════════════════════
  await ev('window.step(400)');
  const air = J(await ev(`JSON.stringify({
    state: window.__game.state,
    airFish: window.__game.airFish.length,
    gun: window.__game.gun.id,
    mech: window.__game.gun.mech,
    cd: window.__game.gunCd,
    ammo: window.__game.gunAmmo,
    reload: window.__game.gunReloadT,
    heat: window.__game.gunHeat,
    spin: window.__game.gunSpin,
    barOn: document.getElementById('gunBar').classList.contains('on'),
  })`));
  check('T19 上升到水面进入空中阶段', air.state === 'air' || air.state === 'result', 'state=' + air.state);
  // ⚠ v0.4 改写了这条：旧版断言的是「**没有**武器对象」（当时枪只是"点击处爆炸"，
  //   屏幕上不画枪）。现在枪械是一等公民（7 把枪 + 5 级 + 枪店），断言反过来 ——
  //   验的是"进空中时枪械状态被正确初始化了，而且枪械条出现了"。
  check('T20 空中阶段初始化枪械状态 + 枪械条出现',
    ['cd', 'ammo', 'reload', 'heat', 'spin'].every((k) => Number.isFinite(air[k])) && air.barOn === true,
    `枪=${air.gun}(${air.mech}) cd=${air.cd} ammo=${air.ammo} reload=${air.reload} heat=${air.heat} 枪械条=${air.barOn}`);

  // ═══════════════════════════════════════════════════════
  // T21 空中镜头不跟随河豚
  // ═══════════════════════════════════════════════════════
  const camTest = J(await ev(`(()=>{const g=window.__game;
    const fake = (x,y,hazard)=>({state:'air', def:{hazard, name:'t'}, mesh:{position:{x,y}}});
    const keep = g.airFish;
    g.airFish = [fake(0, 3000, true), fake(0, 200, false)];
    const c1 = g._airCamera();
    g.airFish = [fake(0, 3000, true)];
    const c2 = g._airCamera();
    g.airFish = keep;
    return JSON.stringify({ withNormal: Math.round(c1.y), onlyPuffer: Math.round(c2.y) });})()`));
  check('T21 镜头不跟随河豚', camTest.withNormal < 900 && camTest.onlyPuffer < 400,
    `普通鱼+河豚 camY=${camTest.withNormal}，只有河豚 camY=${camTest.onlyPuffer}`);

  // ═══════════════════════════════════════════════════════
  // T22 结算及时性（关键修复：不再被飞鸟卡住）
  // ═══════════════════════════════════════════════════════
  await ev(`(()=>{const g=window.__game;
    if (g.state !== 'air') { g.state='air'; g.airT=0; }
    g.airFish.forEach(f=>f.kill()); g.airFish=[];
    g._spawnBird();                       // 故意留一只鸟在场上
    g.airT = 0;
    return g.birds.length;})()`);
  // ⚠ 必须超过 airSettleGrace（v0.3.1 起是 1.8s）。以前写死 1.5s —— 加长停留之后就不够了，
  //   会误报成"没有结算"。
  await ev('window.step(175)');  // 2.92 秒
  const settle = J(await ev('JSON.stringify({state: window.__game.state, birds: window.__game.birds.length})'));
  check('T22 没有可打的鱼时短暂停留后结算（鸟不拦截）', settle.state === 'result',
    `2.92s 后 state=${settle.state} 鸟=${settle.birds}`);

  // ═══════════════════════════════════════════════════════
  // T22b 打完最后一条鱼要「停留一下」再结算（v0.3）
  //   ⚠ 旧实现用的是 airT（**进空中阶段**就开始计时），打掉最后一条时它早就超过
  //   grace 了 → 结算立刻弹出，最后那一下击落根本看不清。
  //   现在用 airClearT（从"场上清空"那一刻起算）。这里故意把 airT 设成 99s：
  //   旧实现会立刻结算，新实现必须还停留在 air。
  // ═══════════════════════════════════════════════════════
  const hold = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    g.state='air'; g.airT=99; g.airClearT=0; g.airFish=[]; g.birds=[];
    // 只观察到 grace 之前：这条验的是"**没有**提前结算"，不必真的走到结算，
    // 免得在同一套里第二次进 enterResult。
    const snap = [];
    for (let i=0;i<30;i++){ window.step(1); if (i===2||i===20) snap.push(g.state); }
    return { snap: snap.join(','), state: g.state };})())`));
  check('T22b 场上清空后要停留一下再结算（airT=99s 时旧实现会立刻弹）',
    hold.snap === 'air,air' && hold.state === 'air',
    `airT 故意设成 99s；清空后 0.05s / 0.35s 的状态序列 = ${hold.snap}（应仍是 air）`);

  await sleep(700);
  const result = J(await ev(`JSON.stringify({
    hasCard: !!document.querySelector('#overlay .card'),
    title: (document.querySelector('#overlay h2')||{}).textContent || '',
  })`));
  check('T23 结算面板弹出', result.hasCard && /结\s*算/.test(result.title), 'title=' + result.title);
  await shot('05-result');

  // 回船上
  await ev('document.getElementById("nextBtn").click()');
  await ev('window.step(10)');
  const loop = J(await ev('JSON.stringify({state: window.__game.state, phoneBtn: document.getElementById("phoneBtn").classList.contains("on")})'));
  check('T24 结算后回到船上（可再抛竿）', loop.state === 'idle' && loop.phoneBtn === true, `state=${loop.state}`);

  // ═══════════════════════════════════════════════════════
  // T25 深海黑暗 + 灯具照明
  // ═══════════════════════════════════════════════════════
  const dark = J(await ev(`(()=>{const g=window.__game, w=g.world;
    const Y = -730;                       // 深海（darknessFull = 860 的 85% 处）
    const sample = (lamp) => {
      w.setLamp(lamp);
      w.camY = Y; w.viewScale = 1; w._applyView();
      w.update(1/60, {x:0,y:Y,rate:999,scale:1,hookY:Y});
      return { d:+w.darkness.toFixed(3), light:+w.hookLight.intensity.toFixed(2),
               dist:Math.round(w.hookLight.distance), veil:+w.veilMat.opacity.toFixed(3),
               glow:+w.lampGlowMat.opacity.toFixed(3) };
    };
    const a = sample(0), b = sample(4);
    w.setLamp(g.save.levels.lamp);
    return JSON.stringify({lamp0:a, lamp4:b});})()`));
  check('T25 深海（-730m）无灯具时几乎全黑', dark.lamp0.d > 0.7 && dark.lamp0.veil > 0.5,
    `darkness=${dark.lamp0.d} veil=${dark.lamp0.veil} light=${dark.lamp0.light}`);
  check('T26 灯具满级大幅提升深海可见度',
    dark.lamp4.d < 0.3 && dark.lamp4.light > dark.lamp0.light * 3 && dark.lamp4.dist > 300
    && dark.lamp4.glow > dark.lamp0.glow,
    `darkness ${dark.lamp0.d}→${dark.lamp4.d} light ${dark.lamp0.light}→${dark.lamp4.light} dist=${dark.lamp4.dist} glow=${dark.lamp4.glow}`);

  // 浅水不黑暗
  const shallow = J(await ev(`(()=>{const w=window.__game.world;
    w.camY=-20; w.update(1/60,{x:0,y:-20,rate:999,scale:1,hookY:-20});
    return JSON.stringify({d:+w.darkness.toFixed(3), veilVisible:w.veil.visible});})()`));
  check('T27 浅水区不施加暗幕', shallow.d < 0.1 && shallow.veilVisible === false, `darkness=${shallow.d}`);

  // ═══════════════════════════════════════════════════════
  // T28 两侧深海地形
  // ═══════════════════════════════════════════════════════
  const decor = J(await ev(`(()=>{const w=window.__game.world;
    const kinds = {rock:0, kelp:0, relic:0};
    for (const d of w.decor) {
      if (d.userData.pulse) kinds.relic++;
      else if (d.userData.blades) kinds.kelp++;
      else kinds.rock++;
    }
    // 深水可见数量
    w.camY=-300; w.viewH=w.baseViewH; w._updateDecor(1/60);
    const visibleDeep = w.decor.filter(d=>d.visible).length;
    // 飞在天上时，海底地形应该全部剔除
    w.camY=400; w._updateDecor(1/60);
    const visibleSky = w.decor.filter(d=>d.visible).length;
    return JSON.stringify({total:w.decor.length, kinds, visibleDeep, visibleSky,
      wallX: Math.round(w.wallX), fishHalf: 66});})()`));
  check('T28 深海两侧生成地形（岩石/海带/神秘物体）',
    decor.total >= 50 && decor.kinds.rock > 0 && decor.kinds.kelp > 0 && decor.kinds.relic > 0,
    `共 ${decor.total} 组：岩 ${decor.kinds.rock} / 海带 ${decor.kinds.kelp} / 神秘 ${decor.kinds.relic}`);
  check('T29 地形贴在玩法区之外', decor.wallX >= 70, `wallX=${decor.wallX}`);
  check('T30 地形按相机深度剔除', decor.visibleDeep > 8 && decor.visibleSky === 0,
    `深水可见 ${decor.visibleDeep} / 高空可见 ${decor.visibleSky}`);

  // 深水截图
  await ev(`(()=>{const g=window.__game; g.state='descend'; g.hook.setVisible(true);
    g.hook.setPosition(0,-330); g.world.camY=-360; g.world.setLamp(0);
    g.world.update(1/60,{x:0,y:-360,rate:999,scale:1,hookY:-330}); g.world.render(); return 'ok';})()`);
  await shot('06-deep-lamp0');
  await ev(`(()=>{const g=window.__game; g.world.setLamp(4);
    g.world.update(1/60,{x:0,y:-360,rate:999,scale:1,hookY:-330}); g.world.render(); return 'ok';})()`);
  await shot('07-deep-lamp4');

  // ═══════════════════════════════════════════════════════
  // T31 多屏幕比例
  // ═══════════════════════════════════════════════════════
  const ratios = [
    [375, 667, '16:9'], [393, 852, '19.5:9'], [412, 915, '20:9'],
    [768, 1024, '4:3'], [1440, 900, '16:10'], [1920, 1080, '16:9横'],
  ];
  const widths = [];
  for (const [w, h, tag] of ratios) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await sleep(300);
    await ev('window.dispatchEvent(new Event("resize"))');
    await sleep(250);
    const r = J(await ev('JSON.stringify({w: Math.round(window.__game.world.baseViewW), h: Math.round(window.__game.world.baseViewH), wallX: Math.round(window.__game.world.wallX)})'));
    widths.push(`${tag}:${r.w}`);
    if (w === 375) await shot('08-ratio-375');
  }
  check('T31 各屏幕比例下玩法宽度恒为 154', widths.every((s) => s.endsWith(':154')), widths.join(' '));

  // 恢复竖屏
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
  await sleep(300);
  await ev('window.dispatchEvent(new Event("resize"))');
  await sleep(300);

  // ═══════════════════════════════════════════════════════
  // T32 存档跨刷新
  // ═══════════════════════════════════════════════════════
  await ev('window.__game.save.coins = 4321; window.__game.save.levels.lamp = 2; localStorage.setItem("hooked.save.v3", JSON.stringify(window.__game.save))');
  await send('Page.navigate', { url: URL });
  await sleep(3200);
  const saved = J(await ev('JSON.stringify({coins: window.__game.save.coins, lamp: window.__game.save.levels.lamp, lampR: window.__game.world.lampR})'));
  check('T32 存档跨刷新保持', saved.coins === 4321 && saved.lamp === 2 && saved.lampR === 136,
    `coins=${saved.coins} lamp=${saved.lamp} lampR=${saved.lampR}`);

  // ═══════════════════════════════════════════════════════
  check('T33 控制台无报错', errors.length === 0, errors.slice(0, 4).join(' | ') || '0 条');

  // ── 汇总 ──
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n═══ ${pass}/${results.length} 断言通过 ═══`);
  if (pass < results.length) {
    console.log('失败项：');
    for (const r of results.filter((x) => !x.ok)) console.log('  · ' + r.name + '  → ' + r.detail);
  }
  fs.writeFileSync(path.resolve('.dev/verify3.json'), JSON.stringify({ pass, total: results.length, results, errors }, null, 2));

  ws.close();
} catch (e) {
  console.error('验证脚本异常：', e);
} finally {
  try { chrome.kill(); } catch (_) { /* ignore */ }
  setTimeout(() => process.exit(0), 500);
}
