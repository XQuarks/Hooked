/**
 * _patch-v3a.mjs —— v0.7 第三批 · 第 1 步：枪械分段解锁（A2 = a + b）
 *
 *   a) unlockMap：首图只解锁手枪；散弹枪要「到过冰封极地」
 *   b) unlockDepth：其余五把在**第二张图**按深度递进解锁（140 / 340 / 600 / 920 / 1100）
 *
 * 深度锚点取自冰封极地的海域边界（0/140/340/600/920/1240），
 * 让"解锁一把新枪"和"潜到一片新海域"正好是同一件事。
 */
import fs from 'node:fs';

const F = 'src/config.js';
let src = fs.readFileSync(F, 'utf8');
const fail = [];
const rep = (a, b, label) => {
  const n = src.split(a).length - 1;
  if (n !== 1) { fail.push(`${label}: 命中 ${n} 次`); return; }
  src = src.replace(a, b);
  console.log('✓ ' + label);
};

// ── 六把枪的解锁条件（手枪是初始枪，不加字段）──
const guns = [
  ["mech: 'single', tier: '轻型', price: 8000, upBase: 5200,",
   "mech: 'single', tier: '轻型', price: 8000, upBase: 5200,\n    unlockMap: 'polar',", '散弹枪'],
  ["mech: 'burst', tier: '轻型', price: 14000, upBase: 8400,",
   "mech: 'burst', tier: '轻型', price: 14000, upBase: 8400,\n    unlockMap: 'polar', unlockDepth: 140,", 'Uzi'],
  ["mech: 'auto', tier: '中型', price: 26000, upBase: 14000,",
   "mech: 'auto', tier: '中型', price: 26000, upBase: 14000,\n    unlockMap: 'polar', unlockDepth: 340,", '加特林'],
  ["mech: 'pierce', tier: '中型', price: 34000, upBase: 18000,",
   "mech: 'pierce', tier: '中型', price: 34000, upBase: 18000,\n    unlockMap: 'polar', unlockDepth: 600,", '鱼叉枪'],
  ["mech: 'laser', tier: '重型', price: 42000, upBase: 22000,",
   "mech: 'laser', tier: '重型', price: 42000, upBase: 22000,\n    unlockMap: 'polar', unlockDepth: 920,", '激光枪'],
  ["mech: 'single', tier: '重型', price: 60000, upBase: 30000,",
   "mech: 'single', tier: '重型', price: 60000, upBase: 30000,\n    unlockMap: 'polar', unlockDepth: 1100,", '巴雷特'],
];
for (const [a, b, label] of guns) rep(a, b, 'GUNS.' + label);

// ── 在 GUNS 表上方补一段设计说明（紧挨着平衡锚点那四条）──
rep(`//   ④ ⭐ **\`dmg\` 曲线自带"攻击力成长"，不再有全局倍率**（v0.5）。`,
`//   ⑤ ⭐ **枪械分段解锁（v0.7 第三批，A2 = a + b）**：
//        · \`unlockMap\`   要「到过某张图」才上架（判定 = \`mapProgress().owned\`，与渔具店同源）
//        · \`unlockDepth\` 在那张图**潜到过这个深度**才上架（读 \`mapBest\`）
//      首图只有手枪；散弹枪跟人一起到极地；后面五把按海域一层层往下放
//      （140 霜蓝水道 / 340 极光长廊 / 600 永冻深渊 / 920 极夜之底 / 1100 极夜之底深处）。
//      为什么用深度而不用金币：**引导玩家先潜深** —— 和"换图要潜到底拿海图"是同一个方向，
//      而且"解锁一把新枪"和"见到一片新海域"正好同时发生，推送提示才有意义。
//      ⚠ **已拥有的枪永远视为已解锁**（老存档兜底，B5 的教训：不能把玩家手里的东西判成"未解锁"）。
//
//   ⑥ ⭐ **新枪上架要播报（v0.7 第三批）**：一把枪从"锁着"变"可见"的那一刻，
//      \`game.js\` 的 \`_syncGunNews()\` 会把它记进 \`save.gunNews\`，
//      然后走 iOS 式推送横幅 + 手机红点 + 枪店 App 红点；玩家**点开枪店**之后红点才消失，
//      新枪在店里挂「New」角标。判定只在这一处（\`_syncGunNews\`），界面只负责播。
//
//   ④ ⭐ **\`dmg\` 曲线自带"攻击力成长"，不再有全局倍率**（v0.5）。`, 'GUNS 设计说明');

if (fail.length) { console.error('\n✗✗ 未写盘：\n  ' + fail.join('\n  ')); process.exit(1); }
fs.writeFileSync(F, src);
console.log('\n✓ config.js 已写盘');
