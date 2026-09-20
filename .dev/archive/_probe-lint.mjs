/**
 * _probe-lint.mjs — 探路：C1 的「关键词扫描门禁」到底该扫什么、会误报多少
 *
 * 只读。先量一遍再决定规则怎么写，免得写出来的 lint 全是噪音（那种门禁最后一定被绕过）。
 *
 * 用法：node .dev/archive/_probe-lint.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DOCS = [
  'README.md', 'DESIGN.md', 'GAMEPLAY.md', 'STRUCTURE.md', 'EXPANSION.md',
  ...fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => 'docs/' + f),
];

// 仓库里"存在过的标识符"全集：源码 + 样式 + 脚本
const SRC_TEXT = [
  ...fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => 'src/' + f),
  'styles.css', 'index.html',
  ...fs.readdirSync(path.join(ROOT, '.dev')).filter((f) => f.endsWith('.mjs')).map((f) => '.dev/' + f),
  ...fs.readdirSync(path.join(ROOT, '.dev/archive')).filter((f) => f.endsWith('.mjs')).map((f) => '.dev/archive/' + f),
].map((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')).join('\n');

const FILE_EXT = /\.(md|mjs|js|css|html|png|json|log|txt)$/;
const BROWSER = new Set([
  'localStorage', 'requestAnimationFrame', 'getComputedStyle', 'WebSocket', 'Math', 'JSON',
  'setTimeout', 'setInterval', 'addEventListener', 'querySelector', 'querySelectorAll',
  'classList', 'textContent', 'innerHTML', 'disabled', 'dataset', 'canvas', 'AudioContext',
  'PointerEvent', 'FileReader', 'Date', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'import', 'export', 'const', 'let', 'var', 'function', 'return', 'undefined', 'null', 'true', 'false',
  'node', 'npm', 'git', 'python', 'bash', 'sh', 'wc', 'grep', 'sed', 'awk', 'ls', 'cd', 'curl',
]);

const rows = [];
for (const rel of DOCS) {
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      let t = m[1].trim();
      if (!t || FILE_EXT.test(t) || t.includes('/') || t.includes(' ') || t.includes('(')) continue;
      t = t.replace(/^[.#]/, '');                    // CSS 选择器前缀
      const last = t.split('.').pop();               // a.b.c → c
      if (!/^[A-Za-z_$][\w$]*$/.test(last)) continue;
      if (BROWSER.has(last)) continue;
      if (SRC_TEXT.includes(last)) continue;
      rows.push({ rel, line: i + 1, tok: m[1].trim(), last, text: line.slice(0, 110) });
    }
  });
}

console.log(`\n扫了 ${DOCS.length} 份文档，命中 ${rows.length} 处"文档提到、仓库里找不到"的标识符：\n`);
for (const r of rows) console.log(`  ${r.rel}:${r.line}  [${r.tok}]  ${r.text}`);
