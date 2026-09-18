/**
 * 一次性补丁：给 verify8 补上 v0.7 第二批的断言（宝箱 / 海图 / 船厂），
 * 并给 verify6 的 H7 补上 `boat` 这个新 App id。
 * 用法：node .dev/_patch-tests.mjs
 */
import fs from 'node:fs';

const log = [];
const patch = (file, pairs) => {
  let t = fs.readFileSync(file, 'utf8');
  for (const [from, to, label] of pairs) {
    if (!t.includes(from)) { log.push(`✗ ${file} 未找到：${label}`); continue; }
    t = t.replace(from, to);
    log.push(`✓ ${file} ${label}`);
  }
  fs.writeFileSync(file, t);
};

// ── verify6：goto 的合法 App 列表要含船厂 ──
patch('.dev/verify6.mjs', [[
  `    const appIds = ['call','shop','gunshop','codex','route','settings'];`,
  `    const appIds = ['call','shop','gunshop','codex','route','boat','settings'];`,
  'H7 appIds 加 boat',
], [
  `      gunCalls: cfg.CALLS.filter(c=>c.goto==='gunshop').length,`,
  `      gunCalls: cfg.CALLS.filter(c=>c.goto==='gunshop').length,
      // v0.7（第 4/5 条）：船厂 / 码头管理员那几通必须在表里
      boatCalls: cfg.CALLS.filter(c=>/船厂|码头/.test(c.who)).length,`,
  'H7 统计船厂来电',
]]);

// ── verify8：补 B13 / B14 ──
const anchor = `  await rafWait(400);
  const b5 = J(await ev(\`JSON.stringify((()=>{const g=window.__game;`;
const add = `  // ── B13 宝箱 → 海图 → 船厂解锁（v0.7 第二批）────────────────
  // 这一段是"换图门槛"的前半条：海沟底部的宝箱**碰到即得**海图，
  // 并且如果船厂还没被介绍过，**直接解锁**（需求原话："若是玩家没有解锁船厂 App
  // 则直接给玩家解锁，并去掉船厂 NPC 引导"）。
  const chartGot = J(await ev(\`JSON.stringify((()=>{const g=window.__game;
    g.save.chart = false; g.save.boatApp = false;
    g.save.boats = { owned: [], current: null };
    g.save.licenses = []; g.enterMap('calm-bay');
    const at = g.world.chestAt;
    const before = { seabed: g.world.seabedRoot.visible, chest: g.world.chest.visible,
      chart: g.save.chart, boatApp: g.save.boatApp,
      depth: at ? Math.round(at.y) : null, x: at ? Math.round(at.x) : null };
    const coins0 = g.save.coins;
    // 把钩子放到宝箱上，走一次碰撞检查
    g.hook.setPosition(at.x, at.y); g.hook.x = at.x; g.hook.y = at.y;
    g._checkChest(at.x, at.y);
    // 换到极地看看海床收起来没有，再换回来
    g.enterMap('polar');
    const inIce = g.world.seabedRoot.visible;
    g.enterMap('calm-bay');
    return { before, inIce, backSeabed: g.world.seabedRoot.visible,
      chart: g.save.chart, boatApp: g.save.boatApp, chest: g.world.chest.visible,
      coins: g.save.coins - coins0 };})())\`));
  check('B13 首图海床上的宝箱：碰到即得海图 + 直接解锁船厂 + 宝箱收起 + 海床只在首图',
    chartGot.before.seabed === true && chartGot.before.chest === true
    && chartGot.before.chart === false && chartGot.before.boatApp === false
    && chartGot.before.depth <= -880
    && chartGot.chart === true && chartGot.boatApp === true && chartGot.chest === false
    && chartGot.coins > 0 && chartGot.inIce === false && chartGot.backSeabed === true,
    \`宝箱在 \${chartGot.before.x}, \${chartGot.before.depth}m · 海图\${chartGot.before.chart}→\${chartGot.chart}\`
    + \` · 船厂\${chartGot.before.boatApp}→\${chartGot.boatApp} · 开箱+\${chartGot.coins}\`
    + \` · 海床：首图\${chartGot.before.seabed}/极地\${chartGot.inIce}/回来\${chartGot.backSeabed}\`);

  // ── B14 船厂：三条船同价、效果各一、买船才进得了极地（v0.7）──
  const boatRes = J(await ev(\`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    const prices = cfg.BOATS.map(b=>b.price);
    const kinds = cfg.BOATS.map(b=>b.effect.kind);
    g.save.boats = { owned: [], current: null };
    g.save.chart = true; g.save.coins = 100000;
    // ① 没船 → 进不去
    g.save.currentMap = 'calm-bay';
    const noBoat = g.buyMap('polar');
    // ② 买一艘仓储号（鱼护 +12）
    const creelBefore = g.creelLimit;
    const bought = g.buyBoat('cargo');
    const creelAfter = g.creelLimit;
    const coinsAfterBuy = g.save.coins;
    // ③ 换船免费：换装甲号 → 护钩 1 次、鱼护回到基础值
    const raw = g.setBoat('armor');
    const guard = g.hookGuardMax;
    const creelArmor = g.creelLimit;
    // ④ 换黄金号 → 金币倍率
    g.setBoat('golden');
    const goldMul = g.boatGoldMul;
    // ⑤ 有船之后能进极地
    const okNow = g.buyMap('polar');
    const cur = g.save.currentMap;
    g.enterMap('calm-bay');
    return { prices, kinds, noBoat, bought, raw, creelBefore, creelAfter, creelArmor,
      guard, goldMul, okNow, cur, spend: 100000 - coinsAfterBuy,
      owned: g.save.boats.owned.slice(), boatApp: g.save.boatApp };})())\`));
  check('B14 船厂：三条船同价 10,000、各带一种效果；没船进不了极地、买了任意一艘就能进',
    boatRes.prices.join(',') === '10000,10000,10000'
    && boatRes.kinds.join(',') === 'gold,creel,guard'
    && boatRes.noBoat === false && boatRes.bought === true && boatRes.raw === true
    && boatRes.spend === 10000 && boatRes.creelAfter === boatRes.creelBefore + 12
    && boatRes.creelArmor === boatRes.creelBefore
    && boatRes.guard === 1 && boatRes.goldMul === 1.25
    && boatRes.okNow === true && boatRes.cur === 'polar' && boatRes.boatApp === true,
    \`船价 \${boatRes.prices.join('/')} · 效果 \${boatRes.kinds.join('/')} · 无船进极地=\${boatRes.noBoat}\`
    + \` · 花 \${boatRes.spend} · 鱼护 \${boatRes.creelBefore}→\${boatRes.creelAfter}（换船后 \${boatRes.creelArmor}）\`
    + \` · 护钩 \${boatRes.guard} · 金币倍率 \${boatRes.goldMul} · 有船后进极地=\${boatRes.okNow}\`);

`;
patch('.dev/verify8.mjs', [[anchor, add + anchor, '插入 B13 / B14']]);

console.log(log.join('\n'));
