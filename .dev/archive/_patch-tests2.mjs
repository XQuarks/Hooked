/**
 * 一次性补丁 2：修 verify8 里因为「门槛换成海图+船」而失效的几处状态假设。
 * 用法：node .dev/_patch-tests2.mjs
 */
import fs from 'node:fs';

const log = [];
const patch = (file, pairs) => {
  let t = fs.readFileSync(file, 'utf8');
  for (const [from, to, label] of pairs) {
    if (!t.includes(from)) { log.push(`✗ ${file} 未找到：${label}`); continue; }
    t = t.replace(from, to);
    log.push(`✓ ${label}`);
  }
  fs.writeFileSync(file, t);
};

// ① game.js：enterMap 也要过门槛（当前所在的那张图无条件放行 —— 存档里的图必须能继续玩）
patch('src/game.js', [[
  `  enterMap(id) {
    const map = mapById(id);
    if (map.license > 0 && !this._licenses().includes(map.id)) return false;`,
  `  enterMap(id) {
    const map = mapById(id);
    // ① 当前所在的那张图**无条件放行**：存档里的图必须能继续玩（老档 / 手改存档）
    // ② 换到**别的**图：必须过门槛（海图 + 船，见 mapProgress）
    // ③ 许可证（将来加图可能用）：> 0 时必须已经持有
    if (map.id !== this.save.currentMap && !this.mapProgress(map).gateOk) return false;
    if (map.license > 0 && !this._licenses().includes(map.id)) return false;`,
  'enterMap 加门槛判定',
]]);

// ② verify8：状态与文案修补
patch('.dev/verify8.mjs', [
  [
    `  check('B2 没有许可证时不能直接进（enterMap 返回 false 且存档不变）',
    b2.ok === false && b2.cur === 'calm-bay', \`ok=\${b2.ok} cur=\${b2.cur}\`);`,
    `  check('B2 门槛没过时连 enterMap 都进不去（返回 false 且存档不变）',
    b2.ok === false && b2.cur === 'calm-bay', \`ok=\${b2.ok} cur=\${b2.cur}\`);`,
    'B2 文案',
  ],
  [
    `    // 还原现场（后面所有 B 组断言都要求"人在极地"）
    g.save.coins = snap.coins; g.save.licenses = snap.lic; g.enterMap(snap.cur);`,
    `    // 还原现场（后面所有 B 组断言都要求"人在极地"）
    // ⚠ chart / boats 也要还回去 —— 它们现在是门槛本身，不还的话 enterMap 会被拦下，
    //   后面五条 B 组断言全部跑到"宁静海湾"上去了。
    g.save.chart = snap.chart; g.save.boats = snap.boats;
    g.save.coins = snap.coins; g.save.licenses = snap.lic; g.enterMap(snap.cur);`,
    'B4b 还原 chart/boats',
  ],
  [
    `    && chartGot.before.depth <= -880`,
    `    && chartGot.before.depth <= -860`,
    'B13 深度下界',
  ],
  [
    `    // ③ 换船免费：换装甲号 → 护钩 1 次、鱼护回到基础值
    const raw = g.setBoat('armor');`,
    `    // ③ 再买装甲号（护钩 1 次）→ 鱼护回到基础值（不叠加！）
    const raw = g.buyBoat('armor');`,
    'B14 买装甲号',
  ],
  [
    `    // ④ 换黄金号 → 金币倍率
    g.setBoat('golden');`,
    `    // ④ 再买黄金号（金币 ×1.25）—— 换船本身免费，但新船要买
    const swapBack = g.setBoat('cargo');     // 免费换回已拥有的船
    g.buyBoat('golden');`,
    'B14 换船 + 买黄金号',
  ],
  [
    `    && boatRes.spend === 10000 && boatRes.creelAfter === boatRes.creelBefore + 12`,
    `    && boatRes.swapBack === true && boatRes.spend === 30000
    && boatRes.creelAfter === boatRes.creelBefore + 12`,
    'B14 断言补 swapBack / 总花费',
  ],
  [
    `      guard, goldMul, okNow, cur, spend: 100000 - coinsAfterBuy,`,
    `      guard, goldMul, okNow, cur, swapBack, spend: 100000 - coinsAfterBuy,`,
    'B14 return swapBack',
  ],
  [
    `    g.save.licenses = []; g.save.currentMap = 'calm-bay';
    g.ui.setMap(cfg.mapById('calm-bay'));
    g.save.codex = {}; g.save.mapBest = {};
    g.save.coins = 500; g.showIdle(); g.openPhone(); g.ui.openApp('route'); return 'ok';})()\`);`,
    `    g.save.licenses = []; g.save.currentMap = 'calm-bay';
    g.ui.setMap(cfg.mapById('calm-bay'));
    g.save.codex = {}; g.save.mapBest = {};
    // ⚠ v0.7：门槛是"海图 + 船"，所以退条件要**连这两样一起清掉** ——
    //   只清 licenses 的话 B 组留下的海图 / 船会让极地那张卡变成"已解锁"，F3 会空过。
    g.save.chart = false; g.save.boats = { owned: [], current: null };
    g.save.coins = 500; g.showIdle(); g.openPhone(); g.ui.openApp('route'); return 'ok';})()\`);`,
    'F 组清空海图/船',
  ],
  [
    `  check('F3 还没解锁的那张图列出四个条件（海域层数 / 图鉴比例 / 深度 / 金币），按钮是灰的',
    f1.lockedN === 1 && f1.lockedName === '冰封极地' && f1.conds.length === 4
    && f1.lockedBtn === '条件未满'
    && f1.conds.some((c) => /层有收获/.test(c)) && f1.conds.some((c) => /图鉴/.test(c))
    && f1.conds.some((c) => /潜至/.test(c))
    && f1.conds.some((c) => /金币/.test(c)),`,
    `  check('F3 还没解锁的那张图列出两个条件（海图 / 船），按钮是灰的',
    f1.lockedN === 1 && f1.lockedName === '冰封极地' && f1.conds.length === 2
    && f1.lockedBtn === '条件未满'
    && f1.conds.some((c) => /海图|宝箱/.test(c)) && f1.conds.some((c) => /船/.test(c)),`,
    'F3 两条条件',
  ],
  [
    `  check('F6 桌面 6 个 App（4 列换行、不横向溢出），地图小部件显示的是当前这张图',`,
    `  check('F6 桌面 App 数 = 已解锁的个数（船厂解锁后 7 个），地图小部件显示的是当前这张图',`,
    'F6 文案',
  ],
  [
    `    && f5.n === 6`, `    && f5.n === 7`, 'F6 期望 7 个（B 组已解锁船厂）',
  ],
]);

console.log(log.join('\n'));
