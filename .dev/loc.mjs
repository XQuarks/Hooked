/**
 * loc.mjs — 把「体积快照」（各文件行数）生成进 `STRUCTURE.md`
 *
 * 为什么要有这个脚本：
 *   `STRUCTURE.md` 的逐文件作用表里原本**手写**了每个文件的行数。
 *   2026-09-16 核对时发现 **13 个数字全部过期**（config 1062→1242、game 1589→1949、
 *   ui 1180→1087、icons 380→315……），而且上一轮改文档的人（我）填的还是**估的行数**。
 *   这和项目里其他手抄数字是同一个病：**手写的派生数据一定会漂**。
 *
 *   所以行数从手写表里拿掉，改成由本脚本生成 —— 改完文件跑一下，表就同步了；
 *   `check` 子命令能像 `gen-docs.mjs check` 一样把漂移变成**可挂掉的断言**。
 *
 * 用法：
 *   node .dev/loc.mjs          # 生成 / 覆盖 STRUCTURE.md 里 LOC 标记之间的内容
 *   node .dev/loc.mjs check    # 只校验不写盘：不一致则退出码 1
 *
 * ⚠ 只替换 `<!-- LOC:BEGIN -->` 与 `<!-- LOC:END -->` 之间的内容，文档其余部分一律不碰。
 * ⚠ **不要往表里加时间戳** —— 那会让 `check` 每次都失败。
 * ⚠ `STRUCTURE.md` 自己**不进表**：本脚本会改写它，把它的行数写进去会形成自指循环
 *   （表变长 → 文件变长 → 表又要变），永远收敛不了。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DOC = path.join(ROOT, 'STRUCTURE.md');
const CHECK_ONLY = process.argv.includes('check');

const BEGIN = '<!-- LOC:BEGIN — 由 .dev/loc.mjs 生成，不要手改（改了文件跑 `node .dev/loc.mjs`）-->';
const END = '<!-- LOC:END -->';

const list = (dir, filter) =>
  fs.readdirSync(path.join(ROOT, dir)).filter(filter).map((f) => `${dir}/${f}`);

const CODE = [
  ...list('src', (f) => f.endsWith('.js')),
  'index.html',
  'styles.css',
];
const DOCS = [
  'README.md', 'DESIGN.md', 'EXPANSION.md',
  ...list('docs', (f) => f.endsWith('.md')),
];

/**
 * 行数 = **和 `wc -l` 一致**的换行符个数。
 *
 * ⚠ 不要写 `split('\n').length` —— 文件以换行结尾时会多算一行，
 *   于是文档里的数字和读者自己跑 `wc -l` 得到的结果差 1。
 *   一张"可以核对"的表，数字对不上就等于没有。
 */
const count = (rel) => {
  const t = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  return t.split('\n').length - (t.endsWith('\n') ? 1 : 0);
};
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const tableOf = (files) => {
  const rows = files.map((rel) => ({ rel, n: count(rel) })).sort((a, b) => b.n - a.n);
  return {
    total: rows.reduce((a, r) => a + r.n, 0),
    text: [
      '| 文件 | 行数 |',
      '|---|---:|',
      ...rows.map((r) => `| \`${r.rel}\` | ${fmt(r.n)} |`),
    ].join('\n'),
  };
};

const code = tableOf(CODE);
const docs = tableOf(DOCS);
const vendored = count('vendor/three.module.js');

const block = [
  BEGIN,
  '### 体积快照',
  '',
  `**代码**（自有，合计 ${fmt(code.total)} 行）`,
  '',
  code.text,
  '',
  `**文档**（合计 ${fmt(docs.total)} 行；\`STRUCTURE.md\` 本文不计 —— 它会被本脚本改写，写进去就成自指循环了）`,
  '',
  docs.text,
  '',
  `> 另有 \`vendor/three.module.js\`（第三方 Three.js r160，${fmt(vendored)} 行）—— 不计入上表。`,
  '> 行数**由 \`.dev/loc.mjs\` 生成**，不是手写的：手写的派生数据一定会漂（这张表曾经 13 个数字全过期）。',
  END,
].join('\n');

const src = fs.readFileSync(DOC, 'utf8');
// 用「行首前缀」匹配而不是整串匹配：占位符可能是裸的 `<!-- LOC:BEGIN -->`，
// 也可能是带完整说明的版本。整串匹配会在换占位符写法时静默找不到。
const re = /^<!-- LOC:BEGIN[\s\S]*?^<!-- LOC:END -->/m;
if (!re.test(src)) {
  console.error('✗ STRUCTURE.md 里找不到 LOC 标记（<!-- LOC:BEGIN ... --> / <!-- LOC:END -->）');
  process.exit(1);
}
const next = src.replace(re, block);

if (next === src) {
  console.log(`✓ 体积快照已是最新（代码 ${fmt(code.total)} 行 · 文档 ${fmt(docs.total)} 行）`);
  process.exit(0);
}
if (CHECK_ONLY) {
  console.error('✗ STRUCTURE.md 的体积快照与文件不一致 —— 跑 node .dev/loc.mjs 重新生成');
  process.exit(1);
}
fs.writeFileSync(DOC, next);
console.log(`✓ 体积快照已更新（代码 ${fmt(code.total)} 行 · 文档 ${fmt(docs.total)} 行）`);
