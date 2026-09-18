/**
 * verify5.mjs — 第 5 轮（迭代 5）改动的回归验证
 *
 * 覆盖需求：
 *   ① 只剩扣钱鱼时飞出画面即结算        → D4 / D5
 *   ② 勾中鱼时鱼钩附近短暂显示鱼名       → D1
 *   ③ 收线前鱼钩缓动再下探一小段 + 提示   → E1 / E2 / E3
 *   ④ 血厚的鱼每中一枪没死就再飞一段      → D2 / D3
 *   ⑤ 鱼外形重做 + 扣钱鱼醒目 + 图鉴      → C1~C7
 *   ⑥ 主界面大标题改名「宁静海湾」并放大  → F1
 *   ⑦ 副标题改为去过的最深处 + 去黑底     → F1 / F2
 *   ⑧ 提示去黑底 + 亮点字体 + 呼吸        → F3
 *   ⑨ 待机隐藏右上深度 chip               → F4
 *   ⑩ 开始游戏后两侧 UI 从左右滑入        → F5
 *
 * 用法：node .dev/verify5.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v5');

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

const profile = path.resolve('.dev/profile-v5-' + Date.now());
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

  /**
   * 等真实时间 + 持续请求帧。
   * 游戏主循环被冻住（g._loop = () => {}）之后，如果页面上没有任何 rAF 回调，
   * headless Chrome 可能不再产帧，CSS 过渡就会停在起始值上 —— 于是
   * getComputedStyle 读到的 opacity / transform 一直是过渡开始时的值。
   * 用 rAF 自己撑着帧，过渡才会真的跑完。
   */
  const rafWait = (ms) => ev(`new Promise((res)=>{
    const t0 = performance.now();
    const tick = () => { if (performance.now() - t0 >= ${ms}) res('ok'); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  })`);

  /**
   * 轮询直到表达式为真。
   * headless 下帧率被压得很低，单次固定等待经常还没跑完过渡，
   * 所以这里一边撑帧一边看，值稳下来了再读。
   */
  const waitFor = async (expr, ms = 8000) => {
    const t0 = Date.now();
    for (;;) {
      await rafWait(150);
      if (await ev(expr)) return true;
      if (Date.now() - t0 > ms) return false;
    }
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3500);

  // ── 冻结 rAF，改手动定步长 ──
  const froze = await ev(`(()=>{const g=window.__game; if(!g) return 'no game'; g._loop = () => {};
    window.step = (n) => { const dt0 = 1/60;
      for (let i=0;i<n;i++){
        if (g.slowmoT > 0) { g.slowmoT -= dt0; if (g.slowmoT <= 0) g.timeScale = 1; }
        const dt = dt0 * g.timeScale; g.time += dt; g._update(dt);
      }
      g.world.render();
      return 'ok';
    };
    return 'ok';})()`);
  check('S0 冻结 rAF 成功（确定性步进可用）', froze === 'ok', String(froze));
  if (froze !== 'ok') throw new Error('游戏没起来（静态服务器没开？）→ ' + String(froze));

  // 把 config 挂到 window，方便测试里按 id 取鱼种
  await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);

  const txOf = (m) => {
    const p = /matrix\(([^)]+)\)/.exec(String(m));
    return p ? parseFloat(p[1].split(',')[4]) : 0;
  };

  // ═══════════════════════════════════════════════════════
  // C 组 — 图鉴（需求⑤）
  // ═══════════════════════════════════════════════════════
  await ev(`(()=>{ const g=window.__game; const cfg=window.__cfg;
    // ⚠ levels 必须把 UPGRADE_ORDER 的**每一项**都写出来。
    // 少写一项的话那一项就是 undefined，applyUpgrades 里会算出 NaN 并污染物理，
    // 而且不报错 —— 症状只是"鱼突然钓不上来了"（已经踩过一次：漏了 winch → 上拉速度 NaN）。
    //
    // ⚠⚠ 2026-09 修（B6）：这里原来是**手写的 11 项列表**，从 v0.5 删掉 4 项起就过期了
    //   （power / insurance / sonar / rig 已经不存在，靠"多出来的键被忽略"蒙混过关）。
    //   现在一律**从 config 现铺**（.dev/fixtures.mjs 的 levelsOf() 就是这个口径，
    //   只是测试跑在页面里，所以照它的写法现取一次），verify7 的 A9 会扫这类手写字面量。
    const lv = Object.fromEntries(cfg.UPGRADE_ORDER.map(k=>[k,0]));
    Object.assign(lv, { line:2, hook:1, sinker:1, lamp:1, winch:1, creel:1, bait:1 });
    const glv = Object.fromEntries(cfg.GUN_ORDER.map(id=>[id,0]));
    Object.assign(glv, { pistol: 1 });
    g.save = { coins: 900, bestDepth: 200, bestAlt: 0, casts: 5, totalEarned: 900,
      levels: lv,
      // ⚠ v0.4：guns 是**必填**的第二个表。少了它，save.guns.current
      //   会在 _tapFire / _syncGunHud 里抛异常 —— 而且症状离病因很远
      //   （"空中阶段一开火就整个卡住、不结算"）。同一个坑在 levels 上踩过一次。
      guns: { owned: [], current: 'pistol', levels: glv },
      licenses: [], mapBest: {}, calls: [], lastCallCast: -999,
      codex: { sardine:{n:9,best:7}, clown:{n:4,best:12}, puffer:{n:2,best:9}, tuna:{n:1,best:44} } };
    g.applyUpgrades(); g.showIdle(); return 'ok'; })()`);
  await ev('window.step(20)');

  const c1 = J(await ev(`JSON.stringify({
    idleBtn: document.getElementById('phoneBtn').classList.contains('on'),
  })`));
  await ev(`(()=>{ window.__game.enterDescend(); return 'ok'; })()`);
  await ev('window.step(2)');
  const c1b = J(await ev(`JSON.stringify({
    diveBtn: document.getElementById('phoneBtn').classList.contains('on'),
  })`));
  check('C1 手机入口（含图鉴）只在待机时出现', c1.idleBtn === true && c1b.diveBtn === false,
    `待机=${c1.idleBtn} 下潜中=${c1b.diveBtn}`);

  await ev(`(()=>{ const g=window.__game; g.showIdle(); g.openPhone(); g.ui.openApp('codex'); return 'ok'; })()`);
  await ev('window.step(2)');
  const c2 = J(await ev(`(()=>{
    const items = [...document.querySelectorAll('#pApp .cx-item')];
    const zones = [...document.querySelectorAll('#pApp .cx-zone-h b')].map(e=>e.textContent);
    const locked = items.filter(e=>e.classList.contains('locked'));
    const known  = items.filter(e=>e.classList.contains('known'));
    const lockNm  = locked[0]?.querySelector('.cx-nm')?.textContent.trim();
    const lockHasHp = !!locked[0]?.querySelector('.cx-hp');
    const lockHasVal = !!locked[0]?.querySelector('.cx-val');
    const lockDesc = locked[0]?.querySelector('.cx-desc')?.textContent.trim();
    const lockWhere = locked[0]?.querySelector('.cx-where')?.textContent.trim();
    const k = known.find(e=>e.querySelector('.cx-nm').textContent.includes('沙丁鱼'));
    const kHpEl = k?.querySelector('.cx-hp');
    // v0.4：血量从「画 N 颗心」改成「一颗心图标 + 数字」——
    // 血量最高到 120，画 120 颗心会直接把这一行撑爆。
    const kHpN = kHpEl ? kHpEl.querySelectorAll('svg').length : 0;
    const kHp = kHpEl?.textContent || '';
    const hpCfg = window.__cfg.SPECIES.find(s=>s.id==='sardine').hp;
    const kValEl = k?.querySelector('.cx-val');
    const kVal = kValEl?.textContent || '';
    const kValSvg = !!kValEl?.querySelector('svg');
    const kDesc = k?.querySelector('.cx-desc')?.textContent || '';
    const kWhere = k?.querySelector('.cx-where')?.textContent || '';
    const total = document.querySelector('.cx-total')?.textContent || '';
    // 图鉴的总数是**全部地图**的鱼种数（批 2 之后两张图 = 38）。
    // 不从界面反推，直接问 config —— 加地图时这条断言自己会跟上。
    const speciesTotal = window.__cfg.SPECIES.length;
    return JSON.stringify({ n: items.length, zones, lockedN: locked.length, knownN: known.length,
      lockNm, lockHasHp, lockHasVal, lockDesc, lockWhere, kHp, kHpN, hpCfg, kVal, kValSvg, kDesc, kWhere,
      total, speciesTotal });
  })()`));
  check('C2 图鉴列出全部 20 种鱼、按 5 个海域分组',
    c2.n === 20 && c2.zones.length === 5, `${c2.n} 条 / 分组 ${c2.zones.join(' · ')}`);
  check('C2b 分组顺序 = 海域深度顺序，海域雅称不与地图名重名（浅滩→尽头）',
    c2.zones.join(',') === '阳光浅滩,蓝色回廊,幽蓝深谷,无光深渊,海沟尽头', c2.zones.join(' → '));
  check('C3 已钓到的鱼给出 血量 / 金币 / 简介 / 所在海域',
    c2.kHpN === 1 && Number(c2.kHp.trim()) === c2.hpCfg
      && c2.kValSvg && /\d+/.test(c2.kVal) && c2.kDesc.length > 10 && c2.kWhere.length > 4,
    `血量 ${c2.kHp.trim()}（一颗心图标 + 数字，config 里是 ${c2.hpCfg}）· ${c2.kVal.trim()}（SVG 金币=${c2.kValSvg}）· ${c2.kWhere.trim()}`);
  check('C3b 「所在海域」= 地图名 · 海域雅称（迭代 6：地图这一级进图鉴）',
    /^宁静海湾 · (阳光浅滩|蓝色回廊|幽蓝深谷|无光深渊|海沟尽头)$/.test(c2.kWhere.trim())
      && !/(表层|中层|深层|深渊|海沟)海域/.test(c2.kWhere),
    c2.kWhere.trim());
  check('C4 未钓到的鱼显示「？？？」且不透露血量/金币',
    c2.lockNm === '？ ？ ？' && !c2.lockHasHp && !c2.lockHasVal,
    `名字=${c2.lockNm} 有血量=${c2.lockHasHp} 有金币=${c2.lockHasVal}`);
  check('C4b 未钓到的鱼只给"这一层有鱼"的线索（不给简介）',
    /没见过的鱼/.test(c2.lockDesc) && !/扣钱鱼。/.test(c2.lockDesc),
    c2.lockDesc.slice(0, 40));
  check('C5 收集进度按已解锁数量统计（分母 = 全部地图的鱼种数）',
    new RegExp(`已收集\\s*4\\s*/\\s*${c2.speciesTotal}`).test(c2.total.replace(/\s+/g, ' ')),
    c2.total.replace(/\s+/g, ' '));

  // 图标：已解锁是彩色，未解锁是黑色剪影
  const c6 = J(await ev(`(()=>{
    const lum = (cv)=>{
      const c = cv.getContext('2d');
      const d = c.getImageData(0,0,cv.width,cv.height).data;
      let s=0,n=0,mx=0;
      for (let i=0;i<d.length;i+=4){
        if (d[i+3] < 128) continue;
        const l = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
        s+=l; n++; mx=Math.max(mx, d[i], d[i+1], d[i+2]);
      }
      return { avg: n ? +(s/n).toFixed(1) : 0, n, mx };
    };
    const items = [...document.querySelectorAll('#pApp .cx-item')];
    const locked = items.find(e=>e.classList.contains('locked'));
    const known  = items.find(e=>e.querySelector('.cx-nm').textContent.includes('沙丁鱼'));
    return JSON.stringify({
      locked: lum(locked.querySelector('.cx-ico')),
      known:  lum(known.querySelector('.cx-ico')),
    });
  })()`));
  check('C6 未钓到的鱼图标是黑色剪影，已钓到的是彩色',
    c6.locked.n > 150 && c6.locked.avg < 55 && c6.known.n > 150 && c6.known.mx > 150,
    `剪影亮度=${c6.locked.avg}（${c6.locked.n}px） 彩色最大通道=${c6.known.mx}`);
  await shot('C1-codex-partial');

  // 全解锁 → 校验同层内按身价升序
  const c7 = J(await ev(`(()=>{
    const g = window.__game;
    const S = window.__cfg.SPECIES;
    g.save.codex = {};
    for (const s of S) g.save.codex[s.id] = { n: 1, best: s.value };
    g.showIdle(); g.openPhone(); g.ui.openApp('codex');
    const byName = new Map(S.map(d=>[d.name, d]));
    const groups = [...document.querySelectorAll('#pApp .cx-zone')];
    const detail = [];
    let mono = true;
    for (const grp of groups) {
      const vals = [...grp.querySelectorAll('.cx-item')].map(it=>{
        const nm = it.querySelector('.cx-nm').textContent.replace('⚠ 扣钱','').trim();
        const d = byName.get(nm);
        return d ? d.value : null;
      }).filter(v=>v!=null);
      for (let i=1;i<vals.length;i++) if (vals[i] < vals[i-1]) mono = false;
      detail.push(vals.join('<'));
    }
    const hazards = document.querySelectorAll('.cx-item.haz').length;
    return JSON.stringify({ mono, detail, hazards,
      speciesTotal: window.__cfg.SPECIES.length,
      total: document.querySelector('.cx-total').textContent.replace(/\s+/g,' ') });
  })()`));
  check('C7 同一海域内按身价升序排列', c7.mono === true, c7.detail.join(' | '));
  check('C8 3 种扣钱鱼在列表里被单独标出', c7.hazards === 3, `扣钱鱼条目=${c7.hazards}`);
  check('C9 全部解锁后进度满格（N/N，N = 全部地图鱼种数）',
    new RegExp(`已收集\\s*${c7.speciesTotal}\\s*/\\s*${c7.speciesTotal}`).test(c7.total), c7.total);
  await shot('C2-codex-full');

  // ═══════════════════════════════════════════════════════
  // D 组 — 勾鱼提示 / 中弹再飞 / 只剩扣钱鱼立即结算
  // ═══════════════════════════════════════════════════════
  const d1 = J(await ev(`(()=>{const g=window.__game;
    g.save.codex = {};
    g.showIdle(); g.enterDescend();
    let guard = 0;
    while (g.castAir && guard++ < 400) window.step(1);
    for (const f of g.fish.active) { f.speed=0; f.bobAmp=0; f.x=0; f.y=-3000; f.mesh.position.set(0,-3000,0); }
    // ⚠ 必须潜得够深再收线：v0.3.2 的回拉起步缓动让上升的**头 0.75s 很慢**
    //   （从静止加速，只走 ascendSpeed·T/5 ≈ 36 单位）。原来只潜 20 帧（≈28m），
    //   钩子还没加速起来就出水进空中了，鱼根本来不及串上。
    window.step(30);
    // ⚠ v0.3.2 起，「勾中鱼」的**主路径**是下潜撞鱼直接串上（撞鱼 = 串上 + 带速度刹停）。
    //   所以这里把鱼放在钩子**下方**，让下潜自己撞上去 —— 测的是同一条链路
    //   （_catch → 飘字 → 图鉴），而且走的是玩家实际会遇到的那条路径。
    const f = g.fish.active.find(x=>!x.def.hazard);
    f.y = g.hook.y - 40; f.x = g.hook.x; f.mesh.position.set(f.x, f.y, 0);
    const name = f.def.name;
    let frames = 0;
    while (g.run.caught === 0 && frames++ < 300) window.step(1);
    const floats = [...document.querySelectorAll('#floatLayer .float-txt')].map(e=>e.textContent);
    return JSON.stringify({ name, floats, caught: g.run.caught, codex: Object.keys(g.save.codex),
      ascendHint: document.getElementById('hint').textContent });
  })()`));
  check('D1 勾中鱼时鱼钩附近短暂弹出该鱼的名字',
    d1.floats.includes(d1.name) && d1.caught === 1,
    `勾到「${d1.name}」→ 飘字 ${JSON.stringify(d1.floats)}`);
  check('D1b 首次钓到会写入图鉴存档', d1.codex.length === 1, `codex=${JSON.stringify(d1.codex)}`);

  const d2 = J(await ev(`(()=>{const g=window.__game;
    const def = window.__cfg.SPECIES.find(s=>s.id==='tuna');   // hp 9
    const f = g.fish.acquire(def); f.reset(0, 100);
    g.state = 'air'; g.airFish = [f]; g.caught = []; g.birds = []; g.airT = 0;
    // v0.4：开火走枪械管线（_tapFire），冷却字段也从 fireCd 改成 gunCd。
    // v0.5：伤害**只**来自枪械档位（全局「攻击力」倍率已并入 GUNS[].dmg），所以断言直接读它。
    g.gunCd = 0;
    const dmg = g.gunStat.damage;
    const w = g.world.screenToWorld(0.5, 0.5);
    f.launch(0, 120, w.x, w.y);
    f.vx = 0; f.vy = 120;
    const vy0 = f.vy, hp0 = f.hp;
    g._tapFire();
    const floats = [...document.querySelectorAll('#floatLayer .float-txt')].map(e=>e.textContent);
    return JSON.stringify({ vy0, vy1: +f.vy.toFixed(1), hp0, hp1: f.hp, dmg, state: f.state, floats });
  })()`));
  check('D2 中弹未死 → 鱼被再顶向天空（竖直速度变大）',
    Math.abs(d2.hp1 - (d2.hp0 - d2.dmg)) < 1e-6 && d2.vy1 > d2.vy0 + 30 && d2.state === 'air',
    `${d2.__err ? 'ERR ' + d2.__err + ' · ' : ''}hp ${d2.hp0}→${d2.hp1}（单发 ${d2.dmg}），vy ${d2.vy0}→${d2.vy1}`);
  check('D3 中弹未死会提示还差几枪', d2.floats.some((t)=>/还差 \d+ 枪/.test(t)),
    JSON.stringify(d2.floats));

  const d4 = J(await ev(`(()=>{const g=window.__game;
    const def = window.__cfg.SPECIES.find(s=>s.id==='puffer');
    const f = g.fish.acquire(def); f.reset(0, 100);
    g.state='air'; g.airFish=[f]; g.birds=[]; g.airT=0; g.fireCd=0;
    f.launch(0, 141, 0, 5);
    let frames = 0;
    while (g.state === 'air' && frames < 60*30) { window.step(1); frames++; }
    return JSON.stringify({ state: g.state, sec: +(frames/60).toFixed(2),
      timeout: window.__cfg.TUNING.airTimeout, y: Math.round(f.mesh.position.y),
      top: Math.round(g.world.viewRange().top) });
  })()`));
  check('D4 只剩扣钱鱼 → 飞出画面顶部就结算（不再干等 timeout）',
    d4.state === 'result' && d4.sec < 10,
    `${d4.sec}s 后 state=${d4.state}（timeout 是 ${d4.timeout}s；河豚飞到 y=${d4.y}，画面顶 ${d4.top}）`);

  const d5 = J(await ev(`(()=>{const g=window.__game;
    const pf = window.__cfg.SPECIES.find(s=>s.id==='puffer');
    const tf = window.__cfg.SPECIES.find(s=>s.id==='tuna');
    const a = g.fish.acquire(pf); a.reset(0, 100);
    const b = g.fish.acquire(tf); b.reset(0, 100);
    g.state='air'; g.airFish=[a,b]; g.birds=[]; g.airT=0;
    // ⚠ 初速要跟 airGravity 同比例（v0.2 里世界 ×2、重力也 ×2）——
    //   只改重力不改初速的话滞空时间会缩短一半，金枪鱼提前落水，
    //   这条断言就变成在测"鱼落水后该不该结算"了（那是另一条断言的事）。
    a.launch(0, 800, -60, 5);      // 河豚：直接飞出画面
    b.launch(0, 200, 0, 5);        // 金枪鱼：正常高度，还在画面里
    let frames = 0;
    while (g.state === 'air' && frames < 60*6) { window.step(1); frames++; }
    return JSON.stringify({ state: g.state, sec: +(frames/60).toFixed(2),
      hazardY: Math.round(a.mesh.position.y), fishY: Math.round(b.mesh.position.y),
      top: Math.round(g.world.viewRange().top) });
  })()`));
  check('D5 只要还有普通鱼在飞，就不会提前结算',
    d5.state === 'air', `${d5.sec}s 后 state=${d5.state}（河豚 y=${d5.hazardY}，金枪鱼 y=${d5.fishY}，画面顶 ${d5.top}）`);

  // ═══════════════════════════════════════════════════════
  // E 组 — 收线上拉预备（需求③）
  // ═══════════════════════════════════════════════════════
  const e1 = J(await ev(`(()=>{const g=window.__game;
    g.save.levels.line = 1; g.applyUpgrades();
    g.showIdle(); g.enterDescend();
    let guard = 0;
    while (g.castAir && guard++ < 400) window.step(1);
    for (const f of g.fish.active) { f.speed=0; f.bobAmp=0; f.x=0; f.y=-3000; f.mesh.position.set(0,-3000,0); }
    window.step(40);
    const y0 = g.hook.y;
    // ⚠ 必须把当前下潜速度传进去：v0 决定『刹停距离』（D = v0·T/2），
    //   不传就退化成触底那种纯停顿（D = 0），E2 会误判成『没有继续下滑』。
    g._reel('bump', g.descendSpeed);
    const st1 = g.state, pre1 = g.reelPre;
    const hint1 = document.getElementById('hint').textContent;
    const reelHidden = !document.getElementById('reelBtn').classList.contains('on');
    window.step(12);
    const yMid = g.hook.y, st2 = g.state;
    let frames = 12;
    while (g.state === 'descend' && frames < 200) { window.step(1); frames++; }
    return JSON.stringify({ st1, pre1, st2, hint1, reelHidden,
      y0: +y0.toFixed(1), yMid: +yMid.toFixed(1), yEnd: +g.hook.y.toFixed(1),
      stEnd: g.state, frames, preDur: window.__cfg.TUNING.reelPreDur,
      reelDur: +g.reelDur.toFixed(3),
      ascendHint: document.getElementById('hint').textContent });
  })()`));
  check('E1 撞鱼收线先进入「上拉预备」而不是直接反转',
    e1.st1 === 'descend' && e1.pre1 > 0 && e1.st2 === 'descend',
    `state=${e1.st1} reelPre=${e1.pre1.toFixed(2)}s`);
  check('E2 预备期间鱼钩继续向下缓动一段',
    e1.yMid < e1.y0 && e1.yEnd <= e1.y0 - 8,
    `y ${e1.y0} → ${e1.yMid}（预备中）→ ${e1.yEnd}（结束）`);
  check('E3 预备期间显示「即将上拉」提示，收线按钮已收起',
    /即将上拉/.test(e1.hint1) && e1.reelHidden === true, `${e1.hint1} / 按钮隐藏=${e1.reelHidden}`);
  // ⚠ v0.3.2：刹停时长不再是 reelPreDur，而是由**距离**反推（dur = 2D/v0）——
  //   所以这里比的是实测帧数和 g.reelDur（本夹具的帧步进就是 1/60）。
  check('E4 预备走完才进入上升，时长由刹停距离反推',
    e1.stEnd === 'ascend' && Math.abs(e1.frames / 60 - e1.reelDur) < 0.3,
    `${e1.frames} 帧 ≈ ${(e1.frames / 60).toFixed(2)}s（reelDur ${e1.reelDur}s）→ ${e1.stEnd}`);

  const e5 = J(await ev(`(()=>{const g=window.__game;
    g.save.levels.line = 0; g.applyUpgrades();
    g.showIdle(); g.enterDescend();
    let guard = 0;
    while (g.castAir && guard++ < 400) window.step(1);
    for (const f of g.fish.active) { f.speed=0; f.bobAmp=0; f.x=0; f.y=-3000; f.mesh.position.set(0,-3000,0); }
    let sawPre = false, hintAtPre = '', frames = 0, yPre = 0;
    while (g.state === 'descend' && frames < 60*60) {
      window.step(1); frames++;
      if (!sawPre && g.reelPre > 0) { sawPre = true; hintAtPre = document.getElementById('hint').textContent; yPre = g.hook.y; }
    }
    return JSON.stringify({ sawPre, hintAtPre, frames, state: g.state, maxDepth: g.maxDepth,
      yPre: +yPre.toFixed(1), yEnd: +g.hook.y.toFixed(1) });
  })()`));
  check('E5 触底收线同样走「预备 → 上拉」，且不会越过鱼线极限',
    e5.sawPre === true && /鱼线到顶 · 即将上拉/.test(e5.hintAtPre)
      && e5.state === 'ascend' && e5.yPre >= -e5.maxDepth - 0.5 && e5.yEnd >= -e5.maxDepth - 0.5,
    `${e5.hintAtPre}；极限 −${e5.maxDepth}m，预备底 −${-e5.yPre}m，最终 −${-e5.yEnd}m（${e5.frames} 帧）`);

  // ═══════════════════════════════════════════════════════
  // F 组 — 界面（需求⑥⑦⑧⑨⑩）
  // ═══════════════════════════════════════════════════════
  await ev(`(()=>{ const g=window.__game;
    g.save.levels.line = 1; g.save.bestDepth = 0; g.applyUpgrades(); g.showIdle(); return 'ok'; })()`);
  await ev('window.step(20)');
  const f1 = J(await ev(`(()=>{
    const name = document.getElementById('seaName');
    const goal = document.getElementById('seaGoal');
    return JSON.stringify({
      name: name.textContent,
      fs: parseFloat(getComputedStyle(name).fontSize),
      top: parseFloat(getComputedStyle(document.getElementById('seaTitle')).top),
      goalBg: getComputedStyle(goal).backgroundColor,
      goalBorder: getComputedStyle(goal).borderTopWidth,
    });
  })()`));
  check('F1 主界面大标题显示地图名「宁静海湾」（固定，不随鱼线等级变化）', f1.name === '宁静海湾',
    `${f1.name}（鱼线 Lv1 = 150m）`);
  check('F2 标题字号约为原来的 3 倍（31px → ~92px 量级）', f1.fs >= 60,
    `${f1.fs}px（原 31px，${(f1.fs / 31).toFixed(2)} 倍）`);
  check('F2b 标题位置比原来（58px）下移', f1.top > 60, `top=${f1.top}px`);
  check('F3 副标题去掉了黑底', /rgba\(0, 0, 0, 0\)|transparent/.test(f1.goalBg) && parseFloat(f1.goalBorder) === 0,
    `background=${f1.goalBg} border=${f1.goalBorder}`);

  const f2 = J(await ev(`(()=>{
    const h = document.getElementById('hint');
    const cs = getComputedStyle(h);
    return JSON.stringify({
      text: h.textContent, bg: cs.backgroundColor, border: cs.borderTopWidth,
      anim: cs.animationName, dur: cs.animationDuration, iter: cs.animationIterationCount,
      color: cs.color, shadow: cs.textShadow.slice(0, 60),
      on: h.classList.contains('on'),
    });
  })()`));
  check('F4 提示去黑底、改用亮点字体', /rgba\(0, 0, 0, 0\)|transparent/.test(f2.bg)
    && parseFloat(f2.border) === 0 && /rgb\(255, 255, 255\)/.test(f2.color) && /rgba?\(/.test(f2.shadow),
    `bg=${f2.bg} color=${f2.color}`);
  check('F5 提示透明度做呼吸变化（无限循环动画）',
    /hintBreath/.test(f2.anim) && /infinite/.test(f2.iter),
    `animation=${f2.anim} ${f2.dur} × ${f2.iter}`);

  // 深度 chip：待机隐藏、抛竿后出现
  await ev(`(()=>{ window.__game.showIdle(); return 'ok'; })()`);
  await waitFor(`parseFloat(getComputedStyle(document.getElementById('depthChip')).opacity) < 0.05`);
  const chipOff = J(await ev(`JSON.stringify({
    o: getComputedStyle(document.getElementById('depthChip')).opacity,
    cls: document.getElementById('depthChip').className,
    state: window.__game.state,
  })`));
  await ev(`(()=>{ window.__game.enterDescend(); return 'ok'; })()`);
  await waitFor(`parseFloat(getComputedStyle(document.getElementById('depthChip')).opacity) > 0.95`);
  const chipOn = J(await ev(`JSON.stringify({
    o: getComputedStyle(document.getElementById('depthChip')).opacity,
    cls: document.getElementById('depthChip').className,
    state: window.__game.state,
  })`));
  check('F6 右上深度 chip 待机隐藏、开始游戏后出现（需求⑨）',
    parseFloat(chipOff.o) < 0.05 && parseFloat(chipOn.o) > 0.95,
    `待机 opacity=${chipOff.o} cls="${chipOff.cls}" state=${chipOff.state} → 下潜 opacity=${chipOn.o} cls="${chipOn.cls}" state=${chipOn.state}`);

  // 两侧 UI 滑入
  await ev(`(()=>{ window.__game.showIdle(); return 'ok'; })()`);
  await waitFor(`/matrix\\(1, 0, 0, 1, -\\d/.test(getComputedStyle(document.getElementById('ruler')).transform)`);
  const slideOff = J(await ev(`JSON.stringify({
    ruler: getComputedStyle(document.getElementById('ruler')).transform,
    catch: getComputedStyle(document.getElementById('catchPanel')).transform,
    dur: getComputedStyle(document.getElementById('ruler')).transitionDuration,
  })`));
  await ev(`(()=>{ window.__game.enterDescend(); return 'ok'; })()`);
  await waitFor(`getComputedStyle(document.getElementById('ruler')).transform === 'matrix(1, 0, 0, 1, 0, 0)'`);
  const slideOn = J(await ev(`JSON.stringify({
    ruler: getComputedStyle(document.getElementById('ruler')).transform,
    catch: getComputedStyle(document.getElementById('catchPanel')).transform,
  })`));
  check('F7 两侧 UI 起始位置在画面外（左 / 右）',
    txOf(slideOff.ruler) < -40 && txOf(slideOff.catch) > 40 && /0\.[3-9]/.test(slideOff.dur),
    `左尺 x=${txOf(slideOff.ruler).toFixed(0)} 右板 x=${txOf(slideOff.catch).toFixed(0)} 时长=${slideOff.dur}`);
  check('F8 开始游戏后两侧 UI 缓动归位到 0（从左右滑入）',
    Math.abs(txOf(slideOn.ruler)) < 2 && Math.abs(txOf(slideOn.catch)) < 2,
    `左尺 x=${txOf(slideOn.ruler).toFixed(1)} 右板 x=${txOf(slideOn.catch).toFixed(1)}`);
  await shot('F1-in-game-ui');

  // ═══════════════════════════════════════════════════════
  // G 控制台
  // ═══════════════════════════════════════════════════════
  check('G1 控制台无报错', errors.length === 0, errors.length ? errors.slice(0, 3).join(' || ') : '0 条');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n═══ ${pass}/${results.length} 断言通过 ═══`);
  fs.writeFileSync(path.resolve('.dev/verify5.json'), JSON.stringify(results, null, 2));
  if (pass !== results.length) process.exitCode = 1;
} finally {
  try { ws?.close(); } catch (_) { /* ignore */ }
  chrome.kill();
}
