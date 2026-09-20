/**
 * verify6.mjs — 第 6 轮（迭代 6）改动的回归验证
 *
 * 覆盖需求：
 *   ① 降低扣钱鱼在水下生成中的占比        → B1~B5
 *   ② 金币图标在宿主界面显示不出来 → 换内联 SVG → C1~C7
 *   ③ 主界面固定显示地图名「宁静海湾」+ 图鉴适配多地图 → D1~D9
 *   ④ 新增手机界面，商店 / 图鉴 / 设置 做成手机 App     → E1~E13
 *   ⑤ 鱼被枪击后更容易在空中旋转          → F1~F6
 *   回归：完整一竿流程 + 控制台零报错       → G1~G2
 *
 * 用法：node .dev/verify6.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.VB_PORT || 9353);   // ⚠ 可用 VB_PORT 覆盖：上一次跑被打断时 Chrome 会占着端口，新一轮会"连到旧现场"
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const OUT = path.resolve('.dev/shots-v6');

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
  throw new Error('Chrome CDP 未就绪（静态服务器没开？先跑 python -m http.server 8899）');
}

const profile = path.resolve('.dev/profile-v6-' + Date.now());
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
      return { __err: (r.result.exceptionDetails.exception?.description || '').split('\n').slice(0, 2).join(' | ') };
    }
    return r.result?.result?.value;
  };
  const J = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return { __bad: v }; } };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  // 自己撑帧：headless 里没有别的帧源时 CSS 过渡会停住，必须轮询到目标状态
  const rafWait = (ms) => ev(`new Promise((res)=>{const t0=performance.now();
    const tick=()=>{ if(performance.now()-t0>=${ms}) res('ok'); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);})`);
  const waitFor = async (expr, ms = 6000) => {
    const t0 = Date.now();
    for (;;) {
      await rafWait(140);
      if (await ev(expr)) return true;
      if (Date.now() - t0 > ms) return false;
    }
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3400);

  // ── A 冒烟：游戏没起来就别往下跑了 ──
  const boot = J(await ev('JSON.stringify({game: !!window.__game, state: window.__game && window.__game.state})'));
  check('A1 页面启动无异常并停在标题页', boot.game === true && boot.state === 'title', JSON.stringify(boot));
  if (!boot.game) throw new Error('游戏没起来：' + JSON.stringify(boot) + '（检查静态服务器是否在 8899）');

  await ev('document.getElementById("startBtn").click()');
  await waitFor('window.__game.state === "idle"');
  check('A2 点开始钓鱼进入待机', (await ev('window.__game.state')) === 'idle');

  // ⚠ 把 config 挂到 window 上，后面的探针才能用 `window.__cfg.UPGRADE_ORDER.length` 之类
  //   的**现值**去断言（而不是写死"11 项"这种会随设计变更漂走的数字）。
  //   ⚠⚠ 少了这一步的后果很阴险：探针里 `window.__cfg.X` 抛错 → ev 返回错误对象 →
  //      JSON.parse 失败 → 两个 undefined 相比**恰好为真** → 断言"空过"。
  //      （C5 就这么假通过过一轮，所以这里显式写上，并加一条 A2b 钉住它。）
  await ev(`(async()=>{ window.__cfg = await import('./src/config.js'); return 'ok'; })()`);
  check('A2b 测试用的 window.__cfg 已注入（探针拿现值断言的唯一入口）',
    (await ev('typeof window.__cfg?.UPGRADE_ORDER?.length')) === 'number',
    'UPGRADE_ORDER.length = ' + await ev('window.__cfg.UPGRADE_ORDER.length'));

  // ── B 需求①：扣钱鱼占比 ─────────────────────────────────
  const stat = J(await ev(`(async()=>{
    const C = await import('./src/config.js');
    const g = window.__game;
    const zoneOf = (y) => { for (const z of C.ZONES) if (y <= z.top && y > z.bottom) return z.id; return 'trench'; };
    const S = { casts:0, total:0, haz:0, zoneMax:0, perCast:[] };
    for (let i=0;i<300;i++){
      g.spawnFish();
      const per = {}; let hz = 0;
      for (const f of g.fish.active){
        S.total++;
        const zid = zoneOf(f.y);
        per[zid] = per[zid] || 0;
        per[zid]++;
        if (f.def.hazard){ hz++; S.haz++; }
        if (f.def.hazard){ per[zid+'_h'] = (per[zid+'_h']||0)+1; }
      }
      for (const k in per) if (k.endsWith('_h')) S.zoneMax = Math.max(S.zoneMax, per[k]);
      S.perCast.push(hz);
      S.casts++;
    }
    S.avgHaz = +(S.perCast.reduce((a,b)=>a+b,0)/S.casts).toFixed(3);
    S.ratio = +(S.haz/S.total).toFixed(4);
    // 改前基线：直接按 SPECIES.weight 抽签（不缩放、不封顶）
    let oldT=0, oldH=0;
    for (const z of C.ZONES){
      const pool = C.SPECIES.filter(s=>s.zones.includes(z.id));
      if (!pool.length) continue;
      const n = Math.max(1, Math.round(z.count*C.FISH_DENSITY));
      const tot = pool.reduce((a,s)=>a+s.weight,0);
      const hw = pool.filter(s=>s.hazard).reduce((a,s)=>a+s.weight,0);
      oldT += n; oldH += n*(hw/tot);
    }
    S.oldRatio = +(oldH/oldT).toFixed(4);
    S.oldAvgHaz = +oldH.toFixed(3);       // 各层期望之和 = 每竿期望条数（旧规则）
    delete S.perCast;
    return JSON.stringify(S);
  })()`));

  check('B1 每层海域最多只刷 1 条扣钱鱼（HAZARD_SPAWN.maxPerZone）',
    stat.zoneMax <= 1, `单层最多 ${stat.zoneMax} 条 · 300 竿 / ${stat.total} 条鱼`);
  check('B2 扣钱鱼占全部鱼的比例降到 8% 以内',
    stat.ratio <= 0.08, `实测 ${(stat.ratio * 100).toFixed(1)}%（改前基线 ${(stat.oldRatio * 100).toFixed(1)}%）`);
  // ⚠ 这个比值是**全局聚合**的：每加一张地图都会被平移一点。批 8 加了第 4 张图
  //   （1/18 是扣钱鱼）之后刚好落在 50.0% 上 —— 现在落在 54% 附近。断言的本意是"明显下降"，
  //   不是"恰好减半"。
  check('B3 占比相对改前明显下降（至少降到 75% 以下）',
    stat.ratio < stat.oldRatio * 0.75, `${(stat.oldRatio * 100).toFixed(1)}% → ${(stat.ratio * 100).toFixed(1)}%`);
  check('B4 每竿平均遇到的扣钱鱼 ≤ 1.3 条（改前 ≈3.4）',
    stat.avgHaz <= 1.3, `实测 ${stat.avgHaz} 条/竿 · 改前基线 ≈${stat.oldAvgHaz}`);
  const cfg = J(await ev(`(async()=>{ const C = await import('./src/config.js');
    return JSON.stringify({ hs: C.HAZARD_SPAWN, density: C.FISH_DENSITY }); })()`));
  check('B5 频率控制参数写在 config 里（可调）',
    cfg.hs && cfg.hs.weightScale > 0 && cfg.hs.weightScale < 1 && cfg.hs.maxPerZone >= 1,
    JSON.stringify(cfg.hs));

  // ── C 需求②：金币图标 ───────────────────────────────────
  const coinDom = J(await ev(`JSON.stringify((()=>{
    const html = document.documentElement.outerHTML;
    const chip = document.querySelector('.chip.coin .ico svg');
    const r = chip ? chip.getBoundingClientRect() : null;
    return {
      emojiInDom: html.includes('\\u{1FA99}'),
      chipSvg: !!chip,
      w: r ? +r.width.toFixed(1) : 0,
      h: r ? +r.height.toFixed(1) : 0,
      viewBox: chip ? chip.getAttribute('viewBox') : null,
      hasImageTag: chip ? chip.innerHTML.includes('<image') : true,
      shapes: chip ? chip.querySelectorAll('circle,path,rect').length : 0,
      fills: chip ? [...new Set([...chip.querySelectorAll('*')].map(n=>n.getAttribute('fill')).filter(Boolean))] : [],
    };
  })())`));
  check('C1 页面 DOM 里不再有 🪙 emoji（U+1FA99）',
    coinDom.emojiInDom === false, `emojiInDom=${coinDom.emojiInDom}`);
  check('C2 HUD 金币图标是内联 SVG 且有实际尺寸',
    coinDom.chipSvg && coinDom.w > 6 && coinDom.h > 6, `${coinDom.w}×${coinDom.h}px`);
  check('C3 金币图标是矢量图形（viewBox + 形状，无位图 <image>）',
    coinDom.viewBox === '0 0 24 24' && !coinDom.hasImageTag && coinDom.shapes >= 3,
    `viewBox=${coinDom.viewBox} shapes=${coinDom.shapes}`);
  check('C4 金币图标用的是游戏自己的金色配色（不依赖 emoji 字体着色）',
    coinDom.fills.some((f) => /ffcc33|c8890c|ffe89a/i.test(f)), coinDom.fills.join(','));

  // 商店 App 的购买按钮
  await ev('window.__game.save.coins = 99999; window.__game.openPhone(); window.__game.ui.openApp("shop");');
  await rafWait(400);
  const shopCoin = J(await ev(`JSON.stringify((()=>{
    const cfg = window.__cfg;
    const btns = [...document.querySelectorAll('#pApp .buy')];
    // ⚠ 分段解锁（v0.6）：本图货架上还没上架的项，按钮是「未解锁」且**故意不带价格** ——
    //   它本来就不该有金币图标。所以这里只统计"真的能买的那些按钮"。
    const buyable = btns.filter(b=>!b.classList.contains('lock'));
    return { n: btns.length, total: cfg.UPGRADE_ORDER.length,
             locked: btns.filter(b=>b.classList.contains('lock')).length,
             withSvg: buyable.filter(b=>b.querySelector('svg')).length,
             emoji: btns.some(b=>b.textContent.includes('\\u{1FA99}')) };
  })())`));
  // ⚠ 项数从页面上的 config **现取**，不写死 —— 写死的话每加/删一项升级都要来改断言，
  //   而漏改的症状是"断言失败，但你以为是代码坏了"。
  check('C5 商店里每个能买的按钮都带 SVG 金币图标（未解锁的那一行不带价格）',
    shopCoin.n === shopCoin.total && shopCoin.withSvg === shopCoin.n - shopCoin.locked
    && !shopCoin.emoji,
    `${shopCoin.withSvg}/${shopCoin.n} 带图标（未解锁 ${shopCoin.locked} 行不计）`);

  // 图鉴里只有"已钓到"的鱼才显示身价，所以先塞几条解锁记录
  await ev(`(()=>{ const g = window.__game;
    g.save.codex = { sardine:{n:9,best:8}, clown:{n:5,best:13}, puffer:{n:2,best:10},
                     mackerel:{n:3,best:17}, blobfish:{n:2,best:35}, tuna:{n:1,best:45} };
    g.ui.openApp("codex"); })()`);
  await rafWait(400);
  const codexCoin = J(await ev(`JSON.stringify((()=>{
    const vals = [...document.querySelectorAll('#pApp .cx-val')];
    return { n: vals.length, withSvg: vals.filter(v=>v.querySelector('svg')).length,
             emoji: vals.some(v=>v.textContent.includes('\\u{1FA99}')) };
  })())`));
  check('C6 图鉴里的身价同样用 SVG 金币图标',
    codexCoin.n > 0 && codexCoin.withSvg === codexCoin.n && !codexCoin.emoji,
    `${codexCoin.withSvg}/${codexCoin.n}`);

  const resCoin = J(await ev(`JSON.stringify((()=>{
    window.__game.ui.showResult({caught:5, depth:120, alt:300, shot:3, bestCombo:4, earned:1234, escaped:[], newRecord:false}, {next(){}});
    const el = document.querySelector('.overlay .rrow.total');
    const ok = !!el && !!el.querySelector('svg');
    const emoji = el ? el.textContent.includes('\\u{1FA99}') : true;
    return { ok, emoji, text: el ? el.textContent.trim() : '' };
  })())`));
  check('C7 结算面板的「本竿收入」也是 SVG 金币', resCoin.ok && !resCoin.emoji, resCoin.text);
  await ev('window.__game.ui.hideOverlay()');

  // ── C8~C11：把**其余界面 emoji 也一并矢量化** ────────────
  // 起因：金币修好之后，商店里变成「1 个单色 SVG 鱼钩 + 4 个彩色 emoji」的混排，
  // 风格割裂；深度 chip 的 🌊、图鉴的 ⚠/❤、飘字的 📖 也都还是 emoji。
  await ev(`window.__game.ui.openApp('shop')`);
  await rafWait(300);
  const shopIcons = J(await ev(`JSON.stringify((()=>{
    const icons = [...document.querySelectorAll('#pApp .item .icon')];
    return { n: icons.length, total: window.__cfg.UPGRADE_ORDER.length,
      allSvg: icons.every(i => !!i.querySelector('svg')),
      leftover: icons.map(i => i.textContent.trim()).filter(Boolean) };
  })())`));
  check('C8 商店每一项升级图标都是内联 SVG（不再是 SVG + 彩色 emoji 混排）',
    shopIcons.n === shopIcons.total && shopIcons.allSvg && shopIcons.leftover.length === 0,
    `${shopIcons.n} 项 · 纯 SVG=${shopIcons.allSvg} · 残留文字 ${JSON.stringify(shopIcons.leftover)}`);

  const hudIco = J(await ev(`JSON.stringify({
    wave: !!document.querySelector('#depthIco svg'),
    mute: !!document.querySelector('#muteBtn svg'),
  })`));
  check('C9 HUD 的深度 chip 与静音按钮都是 SVG',
    hudIco.wave && hudIco.mute, `深度 chip=${hudIco.wave} · 静音=${hudIco.mute}`);

  await ev(`window.__game.ui.openApp('codex')`);
  await rafWait(300);
  const codexIco = J(await ev(`JSON.stringify((()=>{
    const haz = document.querySelector('#pApp .cx-haz');
    const hp  = document.querySelector('#pApp .cx-hp');
    return { hazSvg: !!haz && !!haz.querySelector('svg'),
             hazTxt: haz ? haz.textContent.trim() : '',
             hpSvg: hp ? hp.querySelectorAll('svg').length : 0 };
  })())`));
  check('C10 图鉴的「扣钱」标记与血量心形都是 SVG',
    codexIco.hazSvg && codexIco.hazTxt === '扣钱' && codexIco.hpSvg >= 1,
    `扣钱 SVG=${codexIco.hazSvg}「${codexIco.hazTxt}」· 心形 ${codexIco.hpSvg} 个`);

  // 全量兜底：页面**可见文本**里不该再有任何 emoji / 符号类字形
  const emojiLeft = J(await ev(`JSON.stringify((()=>{
    const txt = document.body.innerText || '';
    const hits = [...txt].filter(c => /[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{FE0F}]/u.test(c));
    return { n: hits.length, sample: [...new Set(hits)].slice(0, 10) };
  })())`));
  check('C11 页面可见文本里不再有 emoji（金币/图标全部换成内联 SVG）',
    emojiLeft.n === 0, `${emojiLeft.n} 个 ${JSON.stringify(emojiLeft.sample)}`);

  await ev('window.__game.ui.openApp("codex")');
  await rafWait(300);
  await shot('V6-C-codex-coin');

  // ── D 需求③：地图名 + 多地图图鉴 ───────────────────────
  await ev('window.__game.closePhone(); window.__game.showIdle();');
  await waitFor('window.__game.state === "idle"');
  const title1 = J(await ev(`JSON.stringify({
    name: document.getElementById('seaName').textContent,
    sub: document.getElementById('seaGoal').textContent,
    on: document.getElementById('seaTitle').classList.contains('on'),
  })`));
  check('D1 待机大标题 = 地图名「宁静海湾」', title1.name === '宁静海湾' && title1.on, JSON.stringify(title1));
  check('D2 副标题是这张地图的探索进度（不是"前往 −XXm"）',
    /^(已探索至|可下潜至) −\d+m$/.test(title1.sub), title1.sub);

  // 鱼线升到满级后标题**不应该**变成"海沟尽头"之类的深度名
  await ev('window.__game.save.levels.line = 4; window.__game.applyUpgrades(); window.__game.showIdle();');
  await rafWait(300);
  const title2 = J(await ev(`JSON.stringify({
    name: document.getElementById('seaName').textContent,
    sub: document.getElementById('seaGoal').textContent,
    line: window.__game.maxDepth,
  })`));
  check('D3 鱼线升到 Lv4（580→840m）后标题仍固定为地图名',
    title2.name === '宁静海湾' && title2.line === 840, `${title2.name} / 鱼线 ${title2.line}m`);
  await ev('window.__game.save.levels.line = 2; window.__game.applyUpgrades();');

  const maps = J(await ev(`(async()=>{ const C = await import('./src/config.js');
    return JSON.stringify({
      n: C.MAPS.length, name: C.DEFAULT_MAP.name, id: C.DEFAULT_MAP.id,
      maxD: C.mapMaxDepth(C.DEFAULT_MAP),
      zones: C.DEFAULT_MAP.zones.length,
      mapOfZone: C.mapOfZone('deep').id,
      mapOfSpecies: C.mapOfSpecies(C.SPECIES[0]).id,
      hasZoneAtDepth: typeof C.zoneAtDepth === 'function',
      // ⚠ B4：mapId 是必传的（不传会抛错），这里显式带第一张图
      zoneAt300: C.zoneAtDepth(-300, C.DEFAULT_MAP.id).id,
    }); })()`));
  check('D4 config 里有 MAPS 多地图结构（地图 → 海域 → 鱼）',
    maps.n >= 1 && maps.name === '宁静海湾' && maps.mapOfZone === maps.id && maps.mapOfSpecies === maps.id,
    `地图 ${maps.n} 张 · ${maps.name} · ${maps.zones} 层海域 · 上限 ${maps.maxD}m`);
  check('D5 深度上限由地图决定（860m）且深度→海域换算走 zoneAtDepth',
    maps.maxD === 860 && maps.hasZoneAtDepth && maps.zoneAt300 === 'deep',
    `mapMaxDepth=${maps.maxD} zoneAt(−300)=${maps.zoneAt300}`);

  // 深度尺按地图上限换算（430m 应该正好在半高）
  const ruler = J(await ev(`JSON.stringify((()=>{
    window.__game.ui.setDepth(430, 840);
    const m = document.querySelector('.ruler .marker');
    return { top: m.style.top, total: window.__game.ui._rulerTotal };
  })())`));
  check('D6 深度尺的总长 = 地图上限，游标按比例定位',
    ruler.total === 860 && ruler.top === '50%', `total=${ruler.total} marker.top=${ruler.top}`);

  await ev('window.__game.openPhone(); window.__game.ui.openApp("codex");');
  await rafWait(450);
  const cx = J(await ev(`JSON.stringify((()=>{
    const mapH = [...document.querySelectorAll('#pApp .cx-map-h b')].map(e=>e.textContent);
    const zones = [...document.querySelectorAll('#pApp .cx-zone-h b')].map(e=>e.textContent);
    const items = [...document.querySelectorAll('#pApp .cx-item')];
    const first = items[0] ? items[0].dataset.id : null;
    const canvasOk = items.every(it=>{const c=it.querySelector('canvas'); return c && c.width>0 && c.height>0;});
    const wheres = items.slice(0,3).map(it=>it.querySelector('.cx-where').textContent);
    // 批 2：图鉴会列出**所有**地图，没到过的那几张只给一个"指路"盒子
    const lockedBoxes = [...document.querySelectorAll('#pApp .cx-locked-box')].map(e=>e.textContent);
    return { mapH, zones, n: items.length, first, canvasOk, wheres, lockedBoxes,
      mapTotal: window.__cfg.MAPS.length, zoneTotal: window.__cfg.zonesOfMap('calm-bay').length };
  })())`));
  check('D7 图鉴有「地图 → 海域」两级分组（每张图一组；没到过的图各给一个指路盒子）',
    cx.mapH.length === cx.mapTotal && cx.mapH[0] === '宁静海湾'
      && cx.zones.length === cx.zoneTotal && cx.lockedBoxes.length === cx.mapTotal - 1
      && /航线/.test(cx.lockedBoxes[0]),
    `地图组 ${JSON.stringify(cx.mapH)}（共 ${cx.mapTotal}）· 海域组 ${cx.zones.length} · 未解锁 ${cx.lockedBoxes.length}`);
  check('D8 图鉴仍按"海域深度 → 身价"排序，20 条鱼图标全部画出',
    cx.n === 20 && cx.first === 'sardine' && cx.canvasOk, `${cx.n} 条 · 首条 ${cx.first}`);
  check('D9 每条鱼的「所在海域」带上地图名',
    cx.wheres.every((w) => w.startsWith('宁静海湾 · ')), cx.wheres[0]);

  // ── E 需求④：手机界面 ───────────────────────────────────
  await ev('window.__game.closePhone(); window.__game.showIdle();');
  await waitFor('window.__game.state === "idle"');
  const entry = J(await ev(`JSON.stringify({
    phoneBtn: document.getElementById('phoneBtn').classList.contains('on'),
    phoneBtnText: document.getElementById('phoneBtn').textContent.trim(),
    oldShop: !!document.getElementById('shopBtn'),
    oldCodex: !!document.getElementById('codexBtn'),
    svg: !!document.querySelector('#phoneBtn svg'),
  })`));
  check('E1 主界面新增手机按钮，旧的渔具店 / 图鉴按钮已移除',
    entry.phoneBtn && !entry.oldShop && !entry.oldCodex && entry.svg, JSON.stringify(entry));

  await ev('document.getElementById("phoneBtn").click()');
  await waitFor('!document.getElementById("phoneLayer").classList.contains("hidden")');
  await rafWait(500);
  const phone = J(await ev(`JSON.stringify((()=>{
    const r = document.getElementById('phoneBody').getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    return { w: Math.round(r.width), h: Math.round(r.height), vw, vh,
             hRatio: +(r.height/vh).toFixed(3), area: +((r.width*r.height)/(vw*vh)).toFixed(3),
             ar: +(r.width/r.height).toFixed(3),
             btnHidden: !document.getElementById('phoneBtn').classList.contains('on') };
  })())`));
  check('E2 手机是"巨大"的（高度 ≥ 屏幕 70%、面积 ≥ 25%）',
    phone.hRatio >= 0.7 && phone.area >= 0.25, `${phone.w}×${phone.h} / ${phone.vw}×${phone.vh} · 高占比 ${phone.hRatio} 面积 ${phone.area}`);
  check('E3 手机是竖屏手机比例（9:19.5 ≈ 0.462）',
    Math.abs(phone.ar - 0.4615) < 0.06, `宽高比 ${phone.ar}`);
  check('E4 打开手机后主界面的手机入口收起', phone.btnHidden === true);

  const home = J(await ev(`JSON.stringify((()=>{
    const apps = [...document.querySelectorAll('#pHome .p-app-item')];
    return { n: apps.length,
      ids: apps.map(a=>a.dataset.app),
      names: apps.map(a=>a.textContent.trim().replace(/\\s+/g,'')),
      hasWidget: !!document.querySelector('#pHome .p-widget'),
      // v0.4.1：手机底部的「抛竿」Dock 已移除。这里量的是"它真的没了"，
      // 而不是"换个选择器再找一次"—— 顺手把容器也一起量了，
      // 免得只删按钮、留下一条空荡荡的圆角横条。
      castBtn: !!document.querySelector('#pCast'),
      dockBox: !!document.querySelector('#pDock'),
      homeBar: !!document.querySelector('.p-bar'),
      time: document.getElementById('pTime').textContent,
      statusSvg: document.querySelectorAll('.p-sys svg').length };
  })())`));
  check('E5 桌面有应用列表：电话 / 短信 / 渔具店 / 枪店 / 鱼图鉴 / 航线 / 电台 / 设置 八个常驻 App',
    home.n === 8 && home.ids.join(',') === 'call,sms,shop,gunshop,codex,route,radio,settings'
      && home.names[0].includes('电话') && home.names[1].includes('短信')
      && home.names[2].includes('渔具店') && home.names[3].includes('枪店')
      && home.names[4].includes('鱼图鉴') && home.names[5].includes('航线')
      && home.names[6].includes('电台') && home.names[7].includes('设置'),
    JSON.stringify(home.names));
  check('E6 手机有状态栏（时钟 + 信号/Wi-Fi/电量）、桌面小部件，且**没有**抛竿 Dock',
    home.statusSvg === 3 && /^\d{1,2}:\d{2}$/.test(home.time) && home.hasWidget
      && home.castBtn === false && home.dockBox === false && home.homeBar === true,
    `时钟 ${home.time} · 状态图标 ${home.statusSvg} 个 · 抛竿按钮=${home.castBtn} · Dock 容器=${home.dockBox} · Home 条=${home.homeBar}`);

  // 商店 App
  await ev(`document.querySelector('[data-app="shop"]').click()`);
  await rafWait(420);
  const shopApp = J(await ev(`JSON.stringify((()=>{
    const g = window.__game;
    g.save.coins = 99999; g.ui.refreshApp();
    const items = [...document.querySelectorAll('#pApp .item')];
    const buy = document.querySelector('#pApp .buy[data-k]');
    return { title: document.querySelector('#pApp .p-app-h b').textContent,
             homeHidden: document.getElementById('pHome').classList.contains('hidden'),
             appShown: !document.getElementById('pApp').classList.contains('hidden'),
             back: !!document.querySelector('#pApp [data-back]'),
             items: items.length, total: window.__cfg.UPGRADE_ORDER.length,
             buyDisabled: buy ? buy.disabled : null,
             coins: g.save.coins, lv0: g.save.levels.line };
  })())`));
  check('E7 商店是手机里的一个 App（有 App 标题栏 + 返回键，桌面让位）',
    shopApp.title === '渔 具 店' && shopApp.homeHidden && shopApp.appShown && shopApp.back,
    JSON.stringify({ title: shopApp.title, back: shopApp.back }));
  check('E8 商店 App 里升级项齐全、金币足够时可购买',
    shopApp.items === shopApp.total && shopApp.buyDisabled === false,
    `${shopApp.items} 项（应 ${shopApp.total}）· 可买=${!shopApp.buyDisabled}`);

  await ev(`document.querySelector('#pApp .buy[data-k="line"]').click()`);
  await rafWait(320);
  const bought = J(await ev(`JSON.stringify({
    coins: window.__game.save.coins, lv: window.__game.save.levels.line,
    stillShop: document.querySelector('#pApp .p-app-h b').textContent,
    items: document.querySelectorAll('#pApp .item').length,
    total: window.__cfg.UPGRADE_ORDER.length,
  })`));
  check('E9 在 App 内购买生效且原地刷新（不跳出手机）',
    bought.lv === shopApp.lv0 + 1 && bought.coins < shopApp.coins
      && bought.stillShop === '渔 具 店' && bought.items === bought.total,
    `Lv${shopApp.lv0}→Lv${bought.lv} · 金币 ${shopApp.coins}→${bought.coins}`);
  await shot('V6-E-shop');

  // 图鉴 App
  await ev(`document.querySelector('[data-back]').click()`);
  await rafWait(300);
  await ev(`document.querySelector('[data-app="codex"]').click()`);
  await rafWait(420);
  const codexApp = J(await ev(`JSON.stringify((()=>{
    const items = [...document.querySelectorAll('#pApp .cx-item')];
    const cvs = items.map(it=>it.querySelector('canvas')).filter(Boolean);
    return { title: document.querySelector('#pApp .p-app-h b').textContent, n: items.length,
             canvases: cvs.length, painted: cvs.every(c=>c.width>0 && c.height>0) };
  })())`));
  check('E10 图鉴是手机里的 App，20 条鱼全部渲染',
    codexApp.title === '鱼 类 图 鉴' && codexApp.n === 20 && codexApp.canvases === 20 && codexApp.painted,
    `${codexApp.title} · ${codexApp.n} 条`);
  await shot('V6-E-codex');

  // 设置 App
  await ev(`document.querySelector('[data-back]').click()`);
  await rafWait(300);
  await ev(`document.querySelector('[data-app="settings"]').click()`);
  await rafWait(420);
  const setApp = J(await ev(`JSON.stringify({
    title: document.querySelector('#pApp .p-app-h b').textContent,
    sound: !!document.getElementById('pSound'),
    soundOn: document.getElementById('pSound').classList.contains('on'),
    reset: !!document.getElementById('pReset'),
    exit: !!document.getElementById('pExit'),
    muted: window.__game.save.muted,
  })`));
  check('E11 设置是手机里的 App（音效开关 / 清空存档 / 收起手机）',
    setApp.title === '设 置' && setApp.sound && setApp.reset && setApp.exit && setApp.soundOn,
    JSON.stringify(setApp));
  await shot('V6-E-settings');

  await ev(`document.getElementById('pSound').click()`);
  await rafWait(300);
  const muted = J(await ev(`JSON.stringify({ muted: window.__game.save.muted,
    swOff: !document.getElementById('pSound').classList.contains('on'),
    saved: JSON.parse(localStorage.getItem('hooked.save.v3')||'{}').muted })`));
  check('E12 音效开关生效并写入存档',
    muted.muted === true && muted.swOff === true && muted.saved === true, JSON.stringify(muted));
  await ev(`document.getElementById('pSound').click()`);   // 关回去
  await rafWait(220);

  // 交互闭环
  await ev(`document.querySelector('#pApp [data-back]').click()`);
  await rafWait(320);
  const backHome = await ev(`!document.getElementById('pHome').classList.contains('hidden')`);
  check('E13 App 里的返回键回到手机桌面', backHome === true);

  // 手机开着时点画布不抛竿
  await ev(`(()=>{ const c = document.getElementById('game'); const r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left+r.width*0.5, clientY: r.top+r.height*0.5, pointerId: 1, bubbles: true, cancelable: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left+r.width*0.5, clientY: r.top+r.height*0.5, pointerId: 1, bubbles: true, cancelable: true })); })()`);
  await rafWait(260);
  check('E14 手机开着时点游戏画面不会误抛竿',
    (await ev('window.__game.state')) === 'idle', 'state=' + await ev('window.__game.state'));

  // 点手机外的空白 → 收起
  await ev(`document.getElementById('phoneLayer').click()`);
  await waitFor('document.getElementById("phoneLayer").classList.contains("hidden")');
  const closed = J(await ev(`JSON.stringify({ hidden: document.getElementById('phoneLayer').classList.contains('hidden'),
    btnBack: document.getElementById('phoneBtn').classList.contains('on') })`));
  check('E15 点手机外的空白收起手机，入口按钮恢复',
    closed.hidden && closed.btnBack, JSON.stringify(closed));

  // v0.4.1：手机里的抛竿入口已移除 —— 断言反过来，验的是"**没有**这个入口"。
  // ⚠ 光断言"按钮不存在"是不够的：还得验"手机开着时点画面不会抛竿"
  //   （E14 已经覆盖），以及"收起手机后点画面能抛竿"（E15 之后的状态）。
  await ev('window.__game.openPhone()');
  await rafWait(320);
  const noCast = J(await ev(`JSON.stringify((()=>{
    const g = window.__game;
    const before = g.state;
    // 兜底：万一手滑把按钮加回来，这里也能抓到（不能只查选择器）
    const anyBtn = [...document.querySelectorAll('#phoneLayer button')]
      .map(b => b.textContent.trim().replace(/\\s+/g,'')).filter(t => t.includes('抛竿'));
    // 手机开着时点画面：不应该抛竿
    // ⚠ 必须**成对**发 down/up：Input 用 _activeId 做单指去重，
    //   只发 down 不发 up 的话 _activeId 会一直挂在 0，
    //   下一次 pointerdown 会被直接忽略 —— 症状是"E16b 莫名其妙抛不了竿"。
    const cv = document.getElementById('game');
    cv.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, pointerId:0, clientX:200, clientY:400}));
    cv.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, pointerId:0, clientX:200, clientY:400}));
    return { before, after: g.state, castBtns: anyBtn.length,
      hasDock: !!document.querySelector('#pDock') };})())`));
  check('E16 手机里不再有抛竿入口（按钮已移除，且开着手机时点画面不会抛竿）',
    noCast.castBtns === 0 && noCast.hasDock === false
      && noCast.before === 'idle' && noCast.after === 'idle',
    `手机内「抛竿」按钮 ${noCast.castBtns} 个 · Dock 容器=${noCast.hasDock} · 点画面后 state=${noCast.after}`);

  // 收起手机之后，抛竿照常可用 —— 这是现在**唯一**的抛竿路径，必须确认它没被一起弄坏
  await ev('window.__game.closePhone()');
  await rafWait(260);
  await ev(`(()=>{const cv = document.getElementById('game');
    cv.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, pointerId:0, clientX:200, clientY:400}));
    cv.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, pointerId:0, clientX:200, clientY:400}));
    return 'ok';})()`);
  await waitFor('window.__game.state === "descend"', 4000);
  const castNow = J(await ev(`JSON.stringify({ state: window.__game.state })`));
  check('E16b 收起手机后点画面就能抛竿（移除 Dock 后抛竿路径仍然通）',
    castNow.state === 'descend', `state=${castNow.state}`);

  // ── F 需求⑤：空中旋转 ───────────────────────────────────
  // ⚠ 采样**多条鱼**再取最大值，不能只看 active[0]。
  //   spinY = (random − 0.5) × 9 → 均匀落在 [−4.5, 4.5]，
  //   单条鱼有 ~7% 的概率 |spinY| < 0.3 —— 判据卡在那儿就是"测试在掷骰子"
  //   （同一份代码实测跑出过 Δy = 0.26 / 0.32 / 2.84 / 3.9 四种结果）。
  //   "三轴都在转"是代码保证的性质，单条鱼只是采样，取最大值才是稳定的尺子。
  const spin = J(await ev(`(async()=>{
    const g = window.__game;
    g._loop = () => {};
    await new Promise(r=>setTimeout(r,60));
    g.showIdle(); g.spawnFish();
    const recs = [];
    for (const f of g.fish.active.slice(0, 8)) {
      f.launch(20, 150);
      const s0 = Math.abs(f.spin);
      const r0 = { z: f.mesh.rotation.z, x: f.mesh.rotation.x, y: f.mesh.rotation.y };
      for (let i=0;i<60;i++) f.update(1/60, i/60, g.world.viewRange());   // 1 秒
      const d = { z: Math.abs(f.mesh.rotation.z - r0.z), x: Math.abs(f.mesh.rotation.x - r0.x), y: Math.abs(f.mesh.rotation.y - r0.y) };
      const before = Math.abs(f.spin);
      f.knockUp(74, 0);
      const after = Math.abs(f.spin);
      recs.push({ s0:+s0.toFixed(2), dz:+d.z.toFixed(2), dx:+d.x.toFixed(2), dy:+d.y.toFixed(2),
                  before:+before.toFixed(2), after:+after.toFixed(2), id: f.def.id });
    }
    const maxD = { x: Math.max(...recs.map(r=>r.dx)), y: Math.max(...recs.map(r=>r.dy)) };
    return JSON.stringify({ first: recs[0], n: recs.length, maxD });
  })()`));
  const spin0 = spin.first;
  check('F1 起飞转速下限超过改前上限（改前 |spin| ≤ 4.5）',
    spin0.s0 > 4.5, `|spin| = ${spin0.s0} rad/s（${spin0.id}）`);
  check('F2 一秒内绕 Z 轴至少转 1 圈（≥ 2π rad）',
    spin0.dz >= 6.28, `Δz = ${spin0.dz} rad`);
  check('F3 三轴都在翻滚（X / Y 轴同样在转，不是平面转圈）',
    spin.maxD.x > 0.3 && spin.maxD.y > 0.3,
    `${spin.n} 条鱼里最大 Δx=${spin.maxD.x} Δy=${spin.maxD.y}`);
  check('F4 中弹（knockUp）后转速明显加快',
    spin0.after - spin0.before >= 5, `${spin0.before} → ${spin0.after} rad/s`);

  // 真实空中阶段的接线：进入 AIR 后鱼确实在转
  const airSpin = J(await ev(`(()=>{
    const g = window.__game;
    g.showIdle(); g.spawnFish();
    const a = g.fish.active[0], b = g.fish.active[1] || g.fish.active[0];
    a.hook(); b.hook(); g.caught = [a, b];
    g.enterAir();
    const snap = g.airFish.map(f=>({id:f.def.id, z:f.mesh.rotation.z, s:f.spin}));
    for (let i=0;i<45;i++) g._update(1/60);
    const now = g.airFish.map(f=>f.mesh.rotation.z);
    return JSON.stringify({ n: g.airFish.length, state: g.state,
      dz: snap.map((s,i)=>+Math.abs(now[i]-s.z).toFixed(2)), spin: snap.map(s=>+s.s.toFixed(1)) });
  })()`));
  check('F5 空中阶段（真实状态机）里所有鱼都在自转',
    airSpin.state === 'air' && airSpin.n > 0 && airSpin.dz.every((v) => v > 1.5),
    `Δz=${JSON.stringify(airSpin.dz)} · spin=${JSON.stringify(airSpin.spin)}`);

  const spinShot = J(await ev(`(()=>{ const g = window.__game; g._update(1/60); g.world.render(); return JSON.stringify({n:g.airFish.length}); })()`));
  await shot('V6-F-air-spin');
  check('F6 空中旋转截图已出（用于人工复核观感）', spinShot.n > 0, `空中鱼 ${spinShot.n} 条`);

  // ── H 来电引导（v0.6）────────────────────────────────────
  //
  // 这套系统解决的是"玩家不知道该花钱"：商店 7 项 + 枪店 7 把开局全可见，
  // 玩家可能一路只升鱼线、永远不碰枪店，然后在深层遇到打不动的血牛时找不到出口。
  // 电话在**刚好需要知道**的那一刻把玩家送过去（见 config.js 的 CALLS 注释）。
  console.log('\n── H 来电引导 ──');
  const callSetup = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.ui.closePhone();
    // 铺一个"刚开局"的干净存档（夹具从 UPGRADE_ORDER 现铺，不手写键名）
    g.save.calls = []; g.save.lastCallCast = -999; g.save.casts = 0;
    g.save.codex = {}; g.save.mapBest = {}; g.save.drop = { on:false, depth:0 };
    g.save.levels = Object.fromEntries(cfg.UPGRADE_ORDER.map(k=>[k,0]));
    g.applyUpgrades(); g.showIdle();
    const c0 = g.pendingCall();
    const before = { id: c0 && c0.id,
      ringing: document.getElementById('phoneBtn').classList.contains('ringing') };
    g.save.casts = 3; g.showIdle();
    const c1 = g.pendingCall();
    return { before, after: c1 && c1.id,
      ringing: document.getElementById('phoneBtn').classList.contains('ringing'),
      banner: document.getElementById('callBanner').classList.contains('on'),
      who: document.getElementById('callBannerWho').textContent };
  })())`));
  check('H1 第 3 竿之前不响铃；到第 3 竿小手机开始晃动 + 顶部滑入 iPhone 式来电卡',
    callSetup.before.id === null && callSetup.before.ringing === false
    && callSetup.after === 'shop-intro' && callSetup.ringing === true && callSetup.banner === true,
    `之前=${callSetup.before.id} · 之后=${callSetup.after} · 晃动=${callSetup.ringing} · 来电卡=${callSetup.banner} · 来电人「${callSetup.who}」`);
  await shot('H1-call-card');
  // 卡片上的两个圆钮必须真的存在（挂断 / 接听）—— v0.7 从"一条细横幅"改成了 iPhone 式卡片
  const card = J(await ev(`JSON.stringify((()=>{const q=(s)=>document.querySelector(s);
    return { accept: !!q('#callAccept'), decline: !!q('#callDecline'),
      ava: q('#callBannerIco') ? q('#callBannerIco').className : '',
      acceptSvg: !!(q('#callAccept') && q('#callAccept').querySelector('svg')),
      declineSvg: !!(q('#callDecline') && q('#callDecline').querySelector('svg')),
      phoneShape: !!document.querySelector('#phoneBtn .ph-body .ph-screen'),
      state: q('#iosState') ? q('#iosState').textContent : '' };})())`));
  check('H1b 来电卡是 iPhone 样式：头像 + 状态行 + 接听/挂断两个圆钮；手机按钮本身是小手机造型',
    card.accept === true && card.decline === true && card.acceptSvg === true
    && card.declineSvg === true && card.phoneShape === true && /ios-ava/.test(card.ava)
    && /来电/.test(card.state),
    `接听=${card.accept} 挂断=${card.decline} 头像「${card.ava}」 手机造型=${card.phoneShape} 状态「${card.state}」`);

  const answered = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    document.getElementById('callBanner').click();
    const q = (s) => document.querySelector(s);
    return { open: g.phoneOpen, app: g.ui._phone.app,
      who: q('#pApp .call-who') ? q('#pApp .call-who').textContent : null,
      lines: document.querySelectorAll('#pApp .call-line').length,
      hasNext: !!q('#callNext'), hasGo: !!q('#callGo') };
  })())`));
  check('H2 点横幅 → 打开手机并**直接**进入来电界面（不用自己找电话 App）',
    answered.open === true && answered.app === 'call' && answered.lines === 1
    && answered.hasNext === true && answered.hasGo === false,
    `手机=${answered.open} · App=${answered.app} · 已出 ${answered.lines} 句 · 来电人「${answered.who}」`);

  const advanced = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    const steps = [];
    for (let i=0;i<10;i++){
      const n = document.querySelector('#callNext');
      if (!n) break;
      n.click();
      steps.push(document.querySelectorAll('#pApp .call-line').length);
    }
    const q = (s) => document.querySelector(s);
    return { steps, lines: document.querySelectorAll('#pApp .call-line').length,
      hasGo: !!q('#callGo'), goText: (q('#callGo')||{}).textContent || '',
      hasHang: !!q('#callHang'), hasNext: !!q('#callNext') };
  })())`));
  check('H3 对话**逐句**推进，最后一句之后才出现「挂断 / 去 X」',
    advanced.lines >= 4 && advanced.steps.length >= 3 && advanced.hasGo === true
    && advanced.hasHang === true && advanced.hasNext === false,
    `推进 ${advanced.steps.length} 次 → 共 ${advanced.lines} 句 · 按钮「${advanced.goText}」`);

  const ended = J(await ev(`JSON.stringify((()=>{const g=window.__game;
    document.querySelector('#callGo').click();
    const c = g.pendingCall();
    return { heard: g.save.calls.slice(), lastCast: g.save.lastCallCast,
      app: g.ui._phone.app,
      ringing: document.getElementById('phoneBtn').classList.contains('ringing'),
      banner: document.getElementById('callBanner').classList.contains('on'),
      pending: c && c.id };
  })())`));
  check('H4 点「去 渔具店」→ 记下已听、**直接跳到渔具店**、不再震动',
    ended.heard.includes('shop-intro') && ended.app === 'shop'
    && ended.ringing === false && ended.banner === false,
    `已听=${JSON.stringify(ended.heard)} · 跳到=${ended.app} · 震动=${ended.ringing}`);
  check('H5 同一通电话不会响第二次', ended.pending !== 'shop-intro', `下一条=${ended.pending}`);

  const gap = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.ui.closePhone();
    // 把"第二通"的条件也满足（鱼线 Lv2），但不推进竿数 → 应被 CALL_GAP 挡住
    g.save.levels.line = 2; g.applyUpgrades(); g.showIdle();
    const blocked = g.pendingCall();
    g.save.casts = g.save.lastCallCast + cfg.CALL_GAP; g.showIdle();
    const ok = g.pendingCall();
    return { blocked: blocked && blocked.id, ok: ok && ok.id, gap: cfg.CALL_GAP,
      last: g.save.lastCallCast, casts: g.save.casts };
  })())`));
  check('H6 两通之间至少隔 CALL_GAP 竿（防止一次待机收到三通电话）',
    gap.blocked === null && gap.ok === 'shop-drop',
    `间隔不足=${gap.blocked} · 够了之后=${gap.ok}（上一通在第 ${gap.last} 竿 · 现在第 ${gap.casts} 竿 · GAP=${gap.gap}）`);

  const meta = J(await ev(`JSON.stringify((()=>{const cfg=window.__cfg;
    const ids = cfg.CALLS.map(c=>c.id);
    const appIds = ['call','shop','gunshop','codex','route','boat','settings'];
    return {
      n: cfg.CALLS.length,
      dup: ids.filter((x,i)=>ids.indexOf(x)!==i),
      badGoto: cfg.CALLS.filter(c=>c.goto && !appIds.includes(c.goto)).map(c=>c.id),
      emptyLines: cfg.CALLS.filter(c=>!Array.isArray(c.lines)||!c.lines.length).map(c=>c.id),
      noWhen: cfg.CALLS.filter(c=>!c.when||!Object.keys(c.when).length).map(c=>c.id),
      gunCalls: cfg.CALLS.filter(c=>c.goto==='gunshop').length,
      // v0.7（第 4/5 条）：船厂 / 码头管理员那几通必须在表里
      boatCalls: cfg.CALLS.filter(c=>/船厂|码头/.test(c.who)).length,
      // ⚠ v0.7：电话里**不许再出现「攻击力」这个词**（那是一条已经不存在的升级轴，
      //   说起来像在骗玩家）。这条断言就是 item 2 的守卫。
      attackTalk: cfg.CALLS.filter(c=>c.lines.some(t=>/攻击力/.test(t))).map(c=>c.id),
      whoSet: [...new Set(cfg.CALLS.map(c=>c.who))],
    };
  })())`));
  check('H7 电话表自洽：id 唯一、goto 是真实 App、都有对话与触发条件',
    meta.dup.length === 0 && meta.badGoto.length === 0
    && meta.emptyLines.length === 0 && meta.noWhen.length === 0,
    `${meta.n} 通 · 重复=${meta.dup.join(',')||'无'} · 坏 goto=${meta.badGoto.join(',')||'无'} · 空对话=${meta.emptyLines.join(',')||'无'}`);
  // A6b（"攻击力现在只能在枪店买到，不买枪的玩家没有伤害出口"）的解法就落在这里：
  // 电话必须**明确**把"打不动 → 换更好的武器"这条因果说给玩家听，并且把他送过去。
  // ⚠ v0.7 起措辞改了：「攻击力」这个词在游戏里已经不存在（并进枪械了），
  //   台词改成"想要好武器就来店里"——所以这里连**用词**一起钉住。
  check('H8 A6b 的解法确实落进了电话：枪店来电 ≥ 2 通、把"打不动 → 换更好的武器"说清楚，且不再提「攻击力」',
    meta.gunCalls >= 2 && meta.whoSet.some((w) => w.includes('枪店'))
    && meta.attackTalk.length === 0,
    `枪店来电 ${meta.gunCalls} 通 · 来电人 ${JSON.stringify(meta.whoSet)} · 提到「攻击力」的 ${meta.attackTalk.length} 通`);

  // ── G 回归 ──────────────────────────────────────────────
  const loop = J(await ev(`(async()=>{
    const g = window.__game;
    g.enterResult();
    await new Promise(r=>setTimeout(r,700));
    const afterResult = g.state;
    g.ui.hideOverlay(); g.showIdle();
    // 再跑一竿：抛竿 → 下潜 → 收线 → 上升
    g.enterDescend();
    let guard = 0;
    while (g.state === 'descend' && guard++ < 3000) g._update(1/60);
    const s1 = g.state;
    guard = 0;
    while (g.state === 'ascend' && guard++ < 3000) g._update(1/60);
    return JSON.stringify({ afterResult, s1, s2: g.state, coins: Math.round(g.save.coins) });
  })()`));
  check('G1 完整一竿流程仍然跑得通（下潜 → 收线 → 上升 → 空中）',
    loop.afterResult === 'result' && loop.s1 === 'ascend' && loop.s2 === 'air',
    JSON.stringify(loop));
  check('G2 全程控制台零报错', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

  // ── H9 = GAMEPLAY §6.2 B10 的回归断言（v0.7 第三批补上）─────────
  // 历史事故：许可证退役之后 `save.licenses` 恒为空数组，而 `_callReady` 还在读它 ——
  // 两通带 `when.map` 的电话（shop-winch / shop-newsea）从此**永远不响**，
  // 并且 296 条断言一条都没拦住。这条断言就是那个窟窿的补丁：
  // **故意把 licenses 留成空数组**，只给"海图 + 船"—— 旧实现在这里必挂。
  const h9 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.ui.closePhone();
    g.save.calls = cfg.CALLS.filter(c => c.id !== 'shop-winch').map(c => c.id);   // 其它都标记已听
    g.save.lastCallCast = -999;
    g.save.casts = 25;
    g.save.charts = { polar: true }; g.save.boats = { owned: ['golden'], current: 'golden' };
    g.save.licenses = [];                       // ⚠ 故意保持空：读 licenses 的旧实现会判"没到过极地"
    g.save.mapBest = { polar: 300 };
    g.applyUpgrades(); g.showIdle();
    const c = g.pendingCall();
    return { id: c && c.id };})())`));
  check('H9 B10 回归：到过极地（海图 + 船）之后，带 when.map 的电话照常响 —— 判定不读 licenses',
    h9.id === 'shop-winch', `待播的电话 = ${h9.id}（应为 shop-winch）`);

  // ── 汇总 ────────────────────────────────────────────────
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n================  ${pass}/${results.length} 通过  ================`);
  const fails = results.filter((r) => !r.ok);
  if (fails.length) {
    console.log('FAIL 列表：');
    for (const f of fails) console.log(`  · ${f.name}  ${f.detail || ''}`);
  }
  fs.writeFileSync(path.join(OUT, 'verify6-result.json'), JSON.stringify({ pass, total: results.length, results }, null, 2));
  process.exitCode = fails.length ? 1 : 0;
} finally {
  try { ws && ws.close(); } catch (_) { /* ignore */ }
  chrome.kill();
}
