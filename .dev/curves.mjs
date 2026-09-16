/**
 * curves.mjs — 升级曲线**只读导出器**（EXPANSION.md 的数值表由这里生成，不要手抄）
 *
 * ⚠ 这个脚本**不再自带曲线定义**，一律从 `src/config.js` 读。
 *
 * 历史：最早这里手写了一套 `piecewise([...], step)` 的曲线，和 config.js 的 LEVELS 是
 * 两份独立的真相。批 1 把 Lv0~Lv4 冻结之后两边就漂了 —— 文档里印着
 * 「鱼线 Lv1=150 / Lv2=220」，config 里其实是 150/240，而没有任何东西会报错。
 * 现在唯一的数据源是 config.js，这里只负责排版。
 *
 * 用法：
 *   node .dev/curves.mjs           → 每项一张 Markdown 表 + 累计投入表
 *   node .dev/curves.mjs wide      → 一张 13 列宽表（直接贴 EXPANSION.md 2.2）
 *   node .dev/curves.mjs json      → JSON
 *   node .dev/curves.mjs cost      → 成本表（贴 EXPANSION.md 2.4）
 *   node .dev/curves.mjs check     → 自检：冻结位 / 单调性 / 长度（CI 友好，有问题 exit 1）
 */
import {
  LEVELS, UPGRADES, UPGRADE_ORDER, MAX_LEVEL, GROWTH, upgradeCost, MAP_LEVEL_CAP,
} from '../src/config.js';

// ── LEVELS 的每一行：中文名 + 单位 + 归属的升级项 ──
const ROW_META = {
  maxDepth:     { label: '鱼线',     unit: 'm',   key: 'line' },
  hookRadius:   { label: '鱼钩',     unit: 'm',   key: 'hook' },
  descendSpeed: { label: '铅坠',     unit: 'm/s', key: 'sinker' },
  ascendSpeed:  { label: '绞盘',     unit: 'm/s', key: 'winch' },
  // ⚠ v0.4：`blastRadius` / `damage` 两条曲线已随枪械系统删除 ——
  //   现在每把枪自己的伤害/半径写在 `GUNS` 表里（见 config.js 的 GUNS 段），
  //   「攻击力」升级改成一条乘数曲线 `gunPower`（只乘伤害，不动半径）。
  gunPower:     { label: '攻击力',   unit: '×',   key: 'power' },
  lampRadius:   { label: '灯具',     unit: 'm',   key: 'lamp' },
  lampPower:    { label: '照度',     unit: '',    key: 'lamp' },
  creelLimit:   { label: '鱼护',     unit: '条',  key: 'creel' },
  insurance:    { label: '保险',     unit: '%',   key: 'insurance' },
  sonar:        { label: '声呐',     unit: '%',   key: 'sonar' },
  bait:         { label: '鱼饵',     unit: '%',   key: 'bait' },
  rig:          { label: '加固',     unit: '%',   key: 'rig' },
};

// 宽表的列顺序（和 EXPANSION.md 2.2 一致，改顺序要同步改文档）
const WIDE = [
  ['line', 'maxDepth'], ['hook', 'hookRadius'], ['sinker', 'descendSpeed'],
  ['power', 'gunPower'], ['lamp', 'lampRadius'],
  ['lamp', 'lampPower'], ['winch', 'ascendSpeed'], ['creel', 'creelLimit'],
  ['insurance', 'insurance'], ['sonar', 'sonar'], ['bait', 'bait'], ['rig', 'rig'],
];

/** 某个升级项下挂的 LEVELS 行 */
const rowsOf = (key) => Object.keys(ROW_META).filter((k) => ROW_META[k].key === key);
const titleOf = (key) => `${UPGRADES[key].name} · ${key}`;
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const cumCost = (key, n) => { let s = 0; for (let lv = 0; lv < n; lv++) s += upgradeCost(key, lv); return s; };

const mode = process.argv[2] || 'md';

// ═══════════════════════════════════════════════════════════
if (mode === 'check') {
  const problems = [];
  for (const k of Object.keys(ROW_META)) {
    const row = LEVELS[k];
    if (!Array.isArray(row)) { problems.push(`${k}: 不是数组`); continue; }
    if (row.length !== MAX_LEVEL + 1) problems.push(`${k}: 长度 ${row.length} ≠ ${MAX_LEVEL + 1}`);
    if (row.some((v) => !Number.isFinite(v))) problems.push(`${k}: 有非有限值`);
    if (row.some((v, i) => i > 0 && v < row[i - 1])) problems.push(`${k}: 不单调`);
  }
  // 冻结位：v0.1 就存在的曲线，索引 0~4 不允许变。
  // ⚠ v0.2「水下世界整体放大 2 倍」把这一整组重新标定过一次（×2，maxDepth ×4），
  //   基线跟着换成 v0.2 的现值。老存档不受影响 —— 存档存的是等级不是数值。
  // ⚠ v0.4：`blastRadius` / `damage` 已删除（枪械系统接管了伤害与半径），
  //   所以这里从 8 条变成 6 条。这是设计变更，不是回归。
  const FROZEN = {
    maxDepth: [320, 450, 580, 710, 840], hookRadius: [8, 10.4, 12.8, 15.2, 17.6],
    descendSpeed: [64, 82, 100, 118, 136], ascendSpeed: [240, 252, 264, 276, 288],
    lampRadius: [52, 92, 136, 184, 240], lampPower: [0.10, 0.30, 0.48, 0.66, 0.84],
  };
  for (const [k, want] of Object.entries(FROZEN)) {
    if (!want.every((v, i) => LEVELS[k][i] === v)) {
      problems.push(`${k}: 冻结位 Lv0~Lv4 被改动 → [${LEVELS[k].slice(0, 5)}]`);
    }
  }
  if (problems.length) {
    console.error('✗ 数值表自检未通过：\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
  console.log(`✓ 数值表自检通过：${Object.keys(ROW_META).length} 条曲线 × ${MAX_LEVEL + 1} 级，`
    + `冻结位一致、全部单调、无缺口`);
} else if (mode === 'wide') {
  const head = ([k, r]) => `${k}·${ROW_META[r].label}${ROW_META[r].unit ? `(${ROW_META[r].unit})` : ''}`;
  console.log('| Lv | ' + WIDE.map(head).join(' | ') + ' |');
  console.log('|---:|' + '---:|'.repeat(WIDE.length));
  for (let lv = 0; lv <= MAX_LEVEL; lv++) {
    console.log(`| ${lv} | ` + WIDE.map(([, r]) => LEVELS[r][lv]).join(' | ') + ' |');
  }
} else if (mode === 'json') {
  const out = { MAX_LEVEL, GROWTH, MAP_LEVEL_CAP, levels: LEVELS };
  out.cost = Object.fromEntries(UPGRADE_ORDER.map((k) => [k, Array.from({ length: MAX_LEVEL }, (_, lv) => upgradeCost(k, lv))]));
  console.log(JSON.stringify(out, null, 2));
} else if (mode === 'cost') {
  console.log('| 升级项 | base | ' + [5, 9, 13, 17, 20].map((n) => `Lv${n} 累计`).join(' | ') + ' |');
  console.log('|---|---:|' + '---:|'.repeat(5));
  for (const k of UPGRADE_ORDER) {
    console.log(`| ${k} ${UPGRADES[k].name} | ${UPGRADES[k].base} | `
      + [5, 9, 13, 17, 20].map((n) => fmt(cumCost(k, n))).join(' | ') + ' |');
  }
} else if (mode === 'costtable') {
  // 单级成本表（贴 DESIGN.md 二、升级成本曲线）—— 手抄这张表已经错过一次，别再来第二次
  console.log('| 升级项 | base | Lv0 | Lv4 | Lv9 | Lv19 |');
  console.log('|---|---:|---:|---:|---:|---:|');
  for (const k of UPGRADE_ORDER) {
    console.log(`| ${UPGRADES[k].name}（${UPGRADES[k].desc}） | ${UPGRADES[k].base} | `
      + [0, 4, 9, 19].map((lv) => fmt(upgradeCost(k, lv))).join(' | ') + ' |');
  }
} else {
  for (const k of UPGRADE_ORDER) {
    const rows = rowsOf(k);
    console.log(`\n### ${titleOf(k)} · \`base=${UPGRADES[k].base}\` · ${UPGRADES[k].tier}\n`);
    console.log('| Lv | ' + rows.map((r) => `${ROW_META[r].label}${ROW_META[r].unit ? '(' + ROW_META[r].unit + ')' : ''}`).join(' | ')
      + ' | 升级花费 | 累计投入 |');
    console.log('|---:|' + '---:|'.repeat(rows.length + 2));
    let cum = 0;
    for (let lv = 0; lv <= MAX_LEVEL; lv++) {
      const vals = rows.map((r) => LEVELS[r][lv]);
      const c = lv < MAX_LEVEL ? upgradeCost(k, lv) : null;
      if (c !== null) cum += c;
      console.log(`| ${lv} | ` + vals.join(' | ')
        + ` | ${c === null ? '—' : fmt(c)} | ${fmt(cum)} |`);
    }
  }
  console.log('\n### 成本曲线一览\n');
  console.log(`\`cost(lv) = base × ${GROWTH}^lv\`\n`);
  console.log('| 升级项 | base | Lv0 | Lv4 | Lv9 | Lv19 |');
  console.log('|---|---:|---:|---:|---:|---:|');
  for (const k of UPGRADE_ORDER) {
    console.log(`| ${k} | ${UPGRADES[k].base} | ${fmt(upgradeCost(k, 0))} | ${fmt(upgradeCost(k, 4))} `
      + `| ${fmt(upgradeCost(k, 9))} | ${fmt(upgradeCost(k, MAX_LEVEL - 1))} |`);
  }
}
