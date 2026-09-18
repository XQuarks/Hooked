/**
 * _patch-gendocs.mjs —— 修三个"文档在骗人"的生成器缺陷
 *
 * ① `callWhenText()` 不认识 v0.7 新增的 `chart` / `boat` / `appLocked` 三个字段
 *    → `docs/05` 把三通**有门槛**的电话印成了「（无条件）」（函数上方那句注释早就预警过这个坑）。
 * ② 同一函数把 `when.map` 翻成"拿到「X」许可证" → 许可证已在 v0.7 第二批退役，语义变了。
 * ③ `docs/01` 的地图总表还留着「许可证」列，于是「冰封极地」被印成"免费（初始图）"。
 */
import fs from 'node:fs';

const F = '.dev/gen-docs.mjs';
let src = fs.readFileSync(F, 'utf8');
const fail = [];

// ③（地图总表列名）改由 `_patch-gendocs2.mjs` 用行号定位完成 —— 这里的锚点用模板字符串写，
//    `${...}` 会被求值，永远命中不了。留一个"已知缺失"豁免，免得它拖住其余四处。
const KNOWN_MISS = new Set(['docs/01 地图总表列名']);

const fix = (a, b, label) => {
  const n = src.split(a).length - 1;
  if (n !== 1) {
    if (KNOWN_MISS.has(label)) { console.log('… ' + label + '：交给 _patch-gendocs2.mjs（本处跳过）'); return; }
    fail.push(`${label}：锚点命中 ${n} 次，应为 1`); return;
  }
  src = src.replace(a, b);
  console.log('✓ ' + label);
};

// ① 导入 CHART / BOATS
fix(
  '  CALLS, CALL_GAP,\n} = C;',
  '  CALLS, CALL_GAP,\n  CHART, BOATS, BOAT_UNLOCK_CAST,\n} = C;',
  '导入 CHART / BOATS / BOAT_UNLOCK_CAST');

// ② callWhenText：补齐新字段 + 修 when.map 的措辞
fix(
  `/**
 * 把一条电话的触发条件翻译成人话（doc05 用）。
 * ⚠ 新增条件字段时**必须同步这里** —— 漏了的话文档会印出一个空的触发条件，
 *   而读者会以为那条电话"无条件就会响"。
 */
function callWhenText(when = {}) {
  const bits = [];
  if (when.casts != null) bits.push(\`累计抛竿 ≥ \${when.casts}\`);
  if (when.depth != null) bits.push(\`本图潜到过 \${when.depth}m\`);
  if (when.codex != null) bits.push(\`图鉴解锁 ≥ \${when.codex} 种\`);
  if (when.map != null) bits.push(\`拿到「\${(MAPS.find((m) => m.id === when.map) || {}).name || when.map}」许可证\`);
  if (when.level) {
    for (const [k, n] of Object.entries(when.level)) {
      bits.push(\`\${(UPGRADES[k] || {}).name || k} ≥ Lv\${n}\`);
    }
  }
  return bits.length ? bits.join(' + ') : '（无条件）';
}`,
  `/** App id → 中文名（电话触发条件里会用到） */
const APP_NAME = {
  call: '电话', shop: '渔具店', gunshop: '枪店',
  codex: '图鉴', route: '航线', boat: '船厂', settings: '设置',
};

/**
 * 把一条电话的触发条件翻译成人话（doc05 用）。
 *
 * ⚠⚠ **新增条件字段时必须同步这里** —— 漏了的话文档会印出一个空的触发条件，
 *     而读者会以为那条电话"无条件就会响"。
 *     这个坑**在 v0.7 真的踩了**：新增 \`chart\` / \`boat\` / \`appLocked\` 三个字段时
 *     没同步本函数，于是 \`docs/05\` 把三通有门槛的电话印成了「（无条件）」——
 *     其中两通（码头管理员老陈）明明要求"已经拿到海图"才响。
 *     **凡是在 \`_callReady()\` 里加了判定，就回来加一行。**
 */
function callWhenText(when = {}) {
  const bits = [];
  if (when.casts != null) bits.push(\`累计抛竿 ≥ \${when.casts}\`);
  if (when.depth != null) bits.push(\`本图潜到过 \${when.depth}m\`);
  if (when.codex != null) bits.push(\`图鉴解锁 ≥ \${when.codex} 种\`);
  // ⚠ v0.7 起 \`when.map\` 的语义 = "已到过那张图"（= \`mapProgress().owned\`，与分段解锁同源），
  //   不再是"拿到那张图的许可证" —— 许可证已经退役。
  if (when.map != null) bits.push(\`已到过「\${(MAPS.find((m) => m.id === when.map) || {}).name || when.map}」\`);
  if (when.chart != null) bits.push(when.chart ? \`已拿到\${CHART.name}\` : \`还没拿到\${CHART.name}\`);
  if (when.boat != null) bits.push(when.boat ? '已拥有一艘船' : '还没有船');
  if (when.appLocked != null) bits.push(\`\${APP_NAME[when.appLocked] || when.appLocked} App 还没解锁\`);
  if (when.level) {
    for (const [k, n] of Object.entries(when.level)) {
      bits.push(\`\${(UPGRADES[k] || {}).name || k} ≥ Lv\${n}\`);
    }
  }
  return bits.length ? bits.join(' + ') : '（无条件）';
}`,
  'callWhenText 补齐 chart/boat/appLocked + when.map 措辞');

// ③ 地图总表：把「许可证」列换成「换图门槛」
fix(
  `| 地图 | id | 英文 | 深度 | 等级闸门 | 许可证 | 机制钩子 |
|---|---|---|---:|---:|---:|---|
\${MAPS.map((m, i) => \`| **\${m.name}** | \\\`\${m.id}\\\` | \${m.en} | \${depthOf(m)} m | Lv\${levelCapForMap(i)} | \${m.license ? fmt(m.license) + ' 金币' : '免费（初始图）'} | \${m.hook ? '\\\`' + m.hook + '\\\`' : '—'} |\`).join('\\n')}

> 等级闸门来自 \\\`MAP_LEVEL_CAP = [\${C.MAP_LEVEL_CAP.join(', ')}]\\\`（第 N 张图的累计上限）。
> 当前只有前 \${MAPS.length} 张落地，后面的数值是给扩建预留的。`,
  `| 地图 | id | 英文 | 深度 | 等级闸门 | 换图门槛 | 机制钩子 |
|---|---|---|---:|---:|---:|---|
\${MAPS.map((m, i) => \`| **\${m.name}** | \\\`\${m.id}\\\` | \${m.en} | \${depthOf(m)} m | Lv\${levelCapForMap(i)} | \${mapGateText(i)} | \${m.hook ? '\\\`' + m.hook + '\\\`' : '—'} |\`).join('\\n')}

> 等级闸门来自 \\\`MAP_LEVEL_CAP = [\${C.MAP_LEVEL_CAP.join(', ')}]\\\`（第 N 张图的累计上限）。
> 当前只有前 \${MAPS.length} 张落地，后面的数值是给扩建预留的。
>
> ⚠ **「换图门槛」列已不是许可证**（v0.7 第二批取消）：首图是出生地，其余图要
> **\${CHART.name} + 一艘船**。船厂 App 在第 \${BOAT_UNLOCK_CAST} 竿由老赵的电话解锁。`,
  'docs/01 地图总表列名');

// ④ doc05 的「进入门槛」
fix(
  "- 进入门槛：\${m.license ? \`许可证 \${fmt(m.license)} 金币\` : '初始地图，免费'}",
  '- 进入门槛：${mapGateText(MAPS.indexOf(m))}',
  'docs/05 进入门槛');

// ⑤ 加 mapGateText 工具函数（放在 depthOf 旁边）
fix(
  `/** 一张地图的深度上限 */
const depthOf = (m) => mapMaxDepth(m);`,
  `/** 一张地图的深度上限 */
const depthOf = (m) => mapMaxDepth(m);

/**
 * 一张地图的"换图门槛"人话描述（v0.7 第二批：许可证退役，改成"海图 + 船"）。
 * ⚠ 门槛的**唯一判定来源**是 \`game.js\` 的 \`mapProgress()\` —— 这里只是把它印出来。
 *   改门槛时别忘了回来同步（这也是 gen-docs 一贯的"派生数据"约定）。
 */
const mapGateText = (i) => (i === 0
  ? '出生地（无条件）'
  : \`\${CHART.name} + 一艘船（\${fmt(BOATS[0].price)} 金币）\`);`,
  '新增 mapGateText()');

if (fail.length) {
  console.error('\n✗✗ 有锚点对不上，**未写盘**：\n  ' + fail.join('\n  '));
  process.exit(1);
}
fs.writeFileSync(F, src);
console.log('\n✓ gen-docs.mjs 已写盘');
