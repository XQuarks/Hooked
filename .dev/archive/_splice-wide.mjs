/**
 * _splice-wide.mjs — 用 curves.mjs 生成的宽表替换 EXPANSION.md 2.2 的旧表。
 * 按行号切片替换（Markdown 表格里有大量重复的 `|`，用字符串匹配容易打偏）。
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'EXPANSION.md';
const lines = fs.readFileSync(FILE, 'utf8').split('\n');

const start = lines.findIndex((l) => l.startsWith('| Lv | line·鱼线'));
const end = lines.findIndex((l, i) => i > start && l.startsWith('| 20 | ') && l.includes('| 1100 |'));
if (start < 0 || end < 0) throw new Error(`定位失败 start=${start} end=${end}`);

const table = execFileSync('node', ['.dev/curves.mjs', 'wide'], { encoding: 'utf8' })
  .trimEnd().split('\n');

const out = [...lines.slice(0, start), ...table, ...lines.slice(end + 1)];
fs.writeFileSync(FILE, out.join('\n'));
console.log(`替换 EXPANSION.md ${start + 1}~${end + 1} 行（${end - start + 1} 行 → ${table.length} 行）`);
console.log(table.slice(0, 4).join('\n'));
