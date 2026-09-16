/**
 * _splice-cost.mjs — 用 curves.mjs costtable 的输出替换 DESIGN.md 里的单级成本表。
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'DESIGN.md';
const lines = fs.readFileSync(FILE, 'utf8').split('\n');

const start = lines.findIndex((l) => l.startsWith('| 升级项 | base | Lv0 | Lv4 | Lv9 | Lv19 |'));
const end = lines.findIndex((l, i) => i > start && l.startsWith('| 加固'));
if (start < 0 || end < 0) throw new Error(`定位失败 start=${start} end=${end}`);

const table = execFileSync('node', ['.dev/curves.mjs', 'costtable'], { encoding: 'utf8' })
  .trimEnd().split('\n');

const out = [...lines.slice(0, start), ...table, ...lines.slice(end + 1)];
fs.writeFileSync(FILE, out.join('\n'));
console.log(`替换 DESIGN.md ${start + 1}~${end + 1} 行（${end - start + 1} 行 → ${table.length} 行）`);
console.log(table.join('\n'));
