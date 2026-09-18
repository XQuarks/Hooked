/**
 * _patch-gendocs2.mjs —— gen-docs 的 ③（docs/01 地图总表列名）
 *
 * 上一版用模板字符串写锚点，`${...}` 被**求值**了 → 命中 0 次（守卫拦住没写盘）。
 * 这里改成**按行定位 + 行号替换**，彻底避开转义问题。
 */
import fs from 'node:fs';

const F = '.dev/gen-docs.mjs';
const L = fs.readFileSync(F, 'utf8').split('\n');

const head = L.findIndex((l) => l.startsWith('| 地图 | id | 英文'));
if (head < 0) { console.error('✗ 找不到地图总表表头'); process.exit(1); }
if (!L[head].includes('许可证')) { console.error('✗ 表头里已经没有「许可证」了（可能已改过）'); process.exit(1); }

// 表头 + 分隔行 + 数据行 = 3 行
const oldRows = L.slice(head, head + 3);
console.log('--- 将被替换的 3 行 ---');
oldRows.forEach((l) => console.log('  ' + l));

const newRows = [
  '| 地图 | id | 英文 | 深度 | 等级闸门 | 换图门槛 | 机制钩子 |',
  '|---|---|---|---:|---:|---:|---|',
  '${MAPS.map((m, i) => `| **${m.name}** | \\`${m.id}\\` | ${m.en} | ${depthOf(m)} m | Lv${levelCapForMap(i)} | ${mapGateText(i)} | ${m.hook ? \'`\' + m.hook + \'`\' : \'—\'} |`).join(\'\\n\')}',
];
L.splice(head, 3, ...newRows);

// 表下那两条说明之后补一条（把"门槛已经不是许可证"说清楚）
const noteAt = L.findIndex((l, i) => i > head && l.startsWith('> 当前只有前'));
if (noteAt < 0) { console.error('✗ 找不到"当前只有前 N 张落地"那句'); process.exit(1); }
const extra = [
  '>',
  '> ⚠ **「换图门槛」列已不是许可证**（v0.7 第二批取消）：首图是出生地，其余图要',
  '> **${CHART.name} + 一艘船**（船厂 App 在第 ${BOAT_UNLOCK_CAST} 竿由老赵的电话解锁）。',
];
L.splice(noteAt + 1, 0, ...extra);

fs.writeFileSync(F, L.join('\n'));
console.log(`\n✓ 已写盘：表头/数据行替换（第 ${head + 1}~${head + 3} 行），说明行插在第 ${noteAt + 2} 行`);
