/**
 * lint-structure.mjs — 源码结构门禁：抓「不报错、不闪退、静默失效」的结构缺陷
 *
 * 为什么要有这个脚本：
 *   这个项目已经被同一类事故坑过三次，而**每一次 442 条断言都没拦住**：
 *     · B11  散弹枪：`_shoot()` 用 `switch (g.mech)` 分派，而没有一把枪的 mech 叫 `shotgun`
 *            → `_shootShotgun()` 是死代码，6 颗弹丸从未生效（标价 8,000 的枪成了全场最弱）。
 *     · B13  榴弹枪：`gunStats()` 漏传 `fuse` → `t -= dt` 得 `NaN` → `if (b.t > 0)` 对 NaN 为假
 *            → "延迟 0.55s 爆炸"变成"同一帧就炸"。
 *     · B10  两通电话：读了一个恒为空数组的退役字段 → 两通电话永远不会响。
 *
 *   共同点：**代码路径被走到了，但机制没生效**。运行期断言很难守住这类问题，
 *   因为它们要的是"数据真的传出来了""这段代码真的会被执行"，而不是"没有异常"。
 *   静态结构能看见的东西，就放在这里守。
 *
 * 这里把这几类结构性缺陷变成会挂掉的断言：
 *
 *   ① 类内重名方法 —— JS 里后一个**静默覆盖**前一个，不报错不警告。
 *      典型成因：复制一个方法改功能，忘了改名字。
 *   ② 逐字重复的函数体 —— 同一份实现出现在两处（跨文件或同文件）。
 *      危险是**反向**的：后来人找到第一份、改好、测试通过，然后发现线上行为没变。
 *   ③ 无人引用的导出 —— 全项目（含 `.dev/` 与 `index.html`）都搜不到的 `export`。
 *      它本身无害，但它常常意味着"某处本该用它的代码改走了另一条路"。
 *   ④ 语法 —— 按 **ES Module** 解析（只解析不执行）。⚠ 这条是被坑出来的：
 *      `node --check <文件>` 对本项目的 `.js` **是哑的**（漏掉真语法错误），见下面 ④ 那段注释。
 *   ⑤ 空 import —— import 进来却一次都没用。拆模块的必然残留；它还会**掩盖 ③**
 *      （只要还有人 import，那个死导出就永远显示为"被引用过"）。
 *
 * 用法：
 *   node .dev/lint-structure.mjs          # 校验；有问题则退出码 1
 *   node .dev/lint-structure.mjs --list   # 只打印扫描到的规模（维护时看）
 *
 * ⚠ 本脚本**只读**。
 *
 * ⚠ **尺子自检**：扫描器（正则 + 花括号配平）一旦失效，下面几关会**一起空过** ——
 *   那比没有门禁更糟（B11 就是这么漏的）。所以每次运行都先断言"扫到了足够多的东西"
 *   （见 SANITY），低于下限直接判失败。加新文件时如果这里报警，先确认是文件真少了，
 *   还是正则被新的写法绕过了。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const LIST_ONLY = process.argv.includes('--list');

const SRC_DIR = path.join(ROOT, 'src');
const srcFiles = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js')).sort();

/** 重复函数体的最小行数 —— 低于这个行数的小工具函数撞车是正常的，不算缺陷 */
const MIN_DUP_LINES = 6;

const read = (p) => fs.readFileSync(p, 'utf8');

// ─────────────────────────────────────────────────────────────
// 预处理：去掉注释与字符串字面量，只留下结构
// ─────────────────────────────────────────────────────────────
// 目的是让"花括号配平"和"逐字比较"不被注释/字符串干扰。
//
// ⚠⚠ **输出的行数必须与输入完全一致** —— 这是本脚本最容易写错、也最致命的一条。
//   删掉的内容一律补等量的 '\n' 占位，绝不静默少行。
//   踩过的坑：第一版让块注释直接消失（一块 `/** ... */` 少 4 行），于是 `sLines`
//   比 `lines` 短 —— 而 `matchBrace` 是在 `sLines` 上配平、返回值却拿去切 `lines`，
//   两个行空间错位最多 491 行（`ui.js`）。后果是「逐字重复的函数体」这一关**整关空过**：
//   它拿到的"函数体"其实是几十行之后的另一段代码。漏报比误报更难发现 ——
//   门禁照样打印"✓ 没有重复实现"。所以下面 SANITY 里专门有一条守这个不变式。
//
// ⚠ 不做正则字面量识别：`/[{}]/` 这种写法会让配平偏一位。当前 `src/` 里没有这种写法，
//   一旦出现，SANITY 的"函数体数量"会先报出来。
function sanitize(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;                       // '\n' 留给主循环输出，行数不变
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';   // ← 块注释吃掉的行，补回来
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          // 模板插值里的表达式要保留（它可能含花括号），这里退化成普通字符处理
          i++;
          continue;
        }
        // 模板字面量可以跨行，同样要补行
        if (src[i] === '\n') out += '\n';
        i++;
      }
      out += '""';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 归一化：按行 trim、去掉空行 —— 这样"只差缩进/空行"的两份实现也能被认出来 */
const normalize = (body) => body.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

// ─────────────────────────────────────────────────────────────
// 扫描：顶层函数 + 类 + 类方法
// ─────────────────────────────────────────────────────────────

const topFnRe = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const classRe = /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/;
// ⚠ **不能**写死"方法 = 2 空格缩进"：那只是个约定，不成立时会把整批方法**漏掉**或**误判**。
//   改成"**在类体那一层（花括号深度 = classDepth + 1）**"来认（见下面循环里的 classDepth），
//   缩进随便写。真实踩过：`narrative.js` 的方法是从类体**原样搬到顶层**的（缩进 0），
//   而方法体里的 `persist(this.save);`（缩进 2）被老启发式当成了方法定义 → 误报"重名 3 次"。
const methodRe = /^\s*(?:static\s+)?(?:get\s+|set\s+|async\s+)?(#?[A-Za-z_$][\w$]*)\s*\(/;

const files = [];      // { rel, lines, sane }
const funcs = [];      // { rel, name, line, body }
const classes = [];    // { rel, name, line, methods: [{ name, line }] }
const exports_ = [];   // { rel, name, line }

for (const f of srcFiles) {
  const rel = `src/${f}`;
  const raw = read(path.join(SRC_DIR, f));
  const sane = sanitize(raw);
  const lines = raw.split('\n');
  const sLines = sane.split('\n');

  files.push({ rel, lines, rawLines: lines.length, sanLines: sLines.length });

  // 花括号配平：返回从 openLine 的 '{' 起、与之配对的那个 '}' 所在行号
  const matchBrace = (openLine) => {
    let depth = 0;
    let started = false;
    for (let i = openLine; i < sLines.length; i++) {
      for (const ch of sLines[i]) {
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') { depth--; }
      }
      if (started && depth <= 0) return i;
    }
    return sLines.length - 1;
  };

  /**
   * 取函数/方法体，**丢掉签名行**再归一化。
   * ⚠ 必须丢签名：`export function mergeGeos(list) {` 与 `function mergeGeos(list) {`
   *   只差一个 `export `，但逐字比较会把它们判成"不一样" —— 而它们恰恰是同一份实现。
   *   （这个坑是写这个门禁时踩到的：第一版带签名比较，`mergeGeos` 那份重复**没被抓出来**。）
   */
  const bodyOf = (fromLine, toLine) => {
    const text = lines.slice(fromLine, toLine + 1).join('\n');
    const at = text.indexOf('{');
    return normalize(at >= 0 ? text.slice(at) : text);
  };

  let curClass = null;
  let depth = 0;          // 花括号深度（按 sanitize 后的文本数，注释/字符串里的括号已经没了）
  let classDepth = -1;    // 类体所在的那一层；方法必须在 classDepth + 1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const startDepth = depth;                        // 这一行**开始时**的深度
    for (const ch of sLines[i]) {                    // 行尾再把这行自己的括号吃掉
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }

    const cm = classRe.exec(line);
    if (cm) {
      curClass = { rel, name: cm[1], line: i + 1, methods: [] };
      classDepth = startDepth;
      classes.push(curClass);
      continue;
    }

    const fm = topFnRe.exec(line);
    if (fm) {
      curClass = null;
      classDepth = -1;
      const end = matchBrace(i);
      funcs.push({ rel, name: fm[1], line: i + 1, body: bodyOf(i, end) });
      continue;
    }

    if (curClass) {
      // ⚠ 只有**正好在类体那一层**的行才算方法定义 —— 否则方法体里的同名**调用**
      //   （`persist(this.save);`）会被当成定义，报出假的重名。
      const mm = (startDepth === classDepth + 1) ? methodRe.exec(line) : null;
      if (mm && !['if', 'for', 'while', 'switch', 'return', 'catch'].includes(mm[1])) {
        curClass.methods.push({ name: mm[1], line: i + 1 });
        const end = matchBrace(i);
        funcs.push({
          rel, name: `${curClass.name}.${mm[1]}`, line: i + 1,
          body: bodyOf(i, end),
        });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const em = /^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(lines[i]);
    if (em) exports_.push({ rel, name: em[1], line: i + 1 });
  }
}

// ─────────────────────────────────────────────────────────────
// ① 类内重名方法
// ─────────────────────────────────────────────────────────────
// ⚠ 用 Map 而不是普通对象：`seen[name]` 在 name === 'constructor' 时会拿到
//   Object.prototype.constructor（一个函数），后面 .push 直接崩。
const dupMethods = [];
for (const c of classes) {
  const seen = new Map();
  for (const m of c.methods) {
    if (!seen.has(m.name)) seen.set(m.name, []);
    seen.get(m.name).push(m.line);
  }
  for (const [name, ls] of seen) {
    if (ls.length > 1) dupMethods.push({ rel: c.rel, cls: c.name, name, lines: ls });
  }
}

// ─────────────────────────────────────────────────────────────
// ② 逐字重复的函数体
// ─────────────────────────────────────────────────────────────
const byBody = new Map();
for (const fn of funcs) {
  if (fn.body.split('\n').length < MIN_DUP_LINES) continue;
  if (!byBody.has(fn.body)) byBody.set(fn.body, []);
  byBody.get(fn.body).push(fn);
}
const dupBodies = [...byBody.values()]
  .filter((g) => g.length > 1)
  .map((g) => ({
    places: g.map((x) => `${x.rel}:${x.line} ${x.name}`),
    lineCount: g[0].body.split('\n').length,
    head: g[0].body.split('\n')[0].slice(0, 72),
  }))
  .sort((a, b) => b.lineCount - a.lineCount);

// ─────────────────────────────────────────────────────────────
// ③ 无人引用的导出
// ─────────────────────────────────────────────────────────────
// 引用范围要包含 `.dev/`（含 archive）与 `index.html` —— 否则会把"只给测试用的导出"
// 误报成死代码。反过来，如果某个导出连测试都不引用，而测试又需要那个数，
// 说明**测试走了另一条路**（`verify13` 读 `window.__MAXP` 就是这种情况）。
const refs = [
  ...srcFiles.map((f) => ({ rel: `src/${f}`, text: read(path.join(SRC_DIR, f)) })),
  ...(fs.existsSync(path.join(ROOT, '.dev'))
    ? fs.readdirSync(path.join(ROOT, '.dev')).filter((f) => f.endsWith('.mjs'))
      .map((f) => ({ rel: `.dev/${f}`, text: read(path.join(ROOT, '.dev', f)) }))
    : []),
  ...(fs.existsSync(path.join(ROOT, '.dev/archive'))
    ? fs.readdirSync(path.join(ROOT, '.dev/archive')).filter((f) => f.endsWith('.mjs'))
      .map((f) => ({ rel: `.dev/archive/${f}`, text: read(path.join(ROOT, '.dev/archive', f)) }))
    : []),
  { rel: 'index.html', text: fs.existsSync(path.join(ROOT, 'index.html')) ? read(path.join(ROOT, 'index.html')) : '' },
];

const unusedExports = [];    // 连自己文件都不用 —— 真·死代码
const needlessExports = [];  // 只有自己文件在用，却挂了 export —— 多余的导出面

/**
 * 数某个名字在文本里出现几次。
 * ⚠ 必须带 `g` 且用 `matchAll` 语义 —— `String.prototype.match` 在**非全局**正则下
 *   返回的是「第一个匹配 + 捕获组」那个数组，长度恒为 1。第一版就是这么写的，
 *   于是 `hits > 1` 永不成立，**每一个在自身文件里被调用的导出都被判成"全项目零引用"**
 *   （`primaryZone` 在 `codex.js:80` 正被用着，却被告知"真死代码，直接删"）——
 *   照着修会直接把代码改坏。门禁的误报比漏报更危险，因为它会指导错误的改动。
 */
const countHits = (text, name) =>
  [...text.matchAll(new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g'))].length;

for (const e of exports_) {
  const re = new RegExp(`\\b${e.name.replace(/\$/g, '\\$')}\\b`);
  // ⚠ 跳过"定义它的那个文件" —— 否则"自己声明自己"就算被引用了
  const usedElsewhere = refs.some((r) => r.rel !== e.rel && re.test(r.text));
  if (usedElsewhere) continue;
  // 自己文件里除声明那一行之外还出现过 = 内部在用，只是没必要 export
  const own = refs.find((r) => r.rel === e.rel);
  const hits = own ? countHits(own.text, e.name) : 0;
  if (hits > 1) needlessExports.push(e);
  else unusedExports.push(e);
}

// ─────────────────────────────────────────────────────────────
// ④ 语法：按 **ES Module** 解析（只解析、不执行）
// ─────────────────────────────────────────────────────────────
// ⚠⚠ 为什么**不能**用 `node --check <文件>`：实测它对本项目的 `.js` **是哑的** ——
//   同一个"对象字面量方法之间漏了逗号"的语法错误，
//     `node --check x.mjs` → 报错 ✅
//     `node --check x.js`  → **退出码 0** ❌（浏览器却直接 SyntaxError，整页白屏）
//   **真实踩过**：拆 `narrative.js` 时把类体原样搬成了对象字面量，`--check` 全绿、页面全白。
//   这里从 **stdin** 喂进去并强制 `--input-type=module`，绕开"按扩展名猜"的那套判断。
// （`vm.SourceTextModule` 也能只解析不执行，但它需要 `--experimental-vm-modules`，不能默认用。）
const syntaxBad = [];
let syntaxSkipped = null;
for (const f of srcFiles) {
  const r = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: read(path.join(SRC_DIR, f)), encoding: 'utf8',
  });
  if (r.error) { syntaxSkipped = r.error.code || r.error.message; break; }
  if (r.status !== 0) {
    const msg = (r.stderr || '').split('\n').find((l) => /Error/.test(l)) || '解析失败';
    syntaxBad.push(`${f}  ${msg.trim()}`);
  }
}

// ─────────────────────────────────────────────────────────────
// ⑤ 空 import：import 进来却一次都没用
// ─────────────────────────────────────────────────────────────
// ⚠ 这条是**拆模块的必然产物**：把实现搬去新文件之后，旧文件里的 `import` 还留着 ——
//   既不报错也不影响行为，于是每次拆分都悄悄多几行死代码。
//   实测：拆 `save.js` / `narrative.js` / `voyage.js` 三刀共留下 4 个，
//   而上一轮拆「天空目标造型」时留下的 `import * as THREE` 更是**一整刀都没人发现**。
//   它同时会掩盖 ③：只要还有人 import，那个"真死导出"就永远显示为"被引用过"
//   （`icons.js` 的 `heartRow` 就是这么被藏了一整轮的）。
//
// ⚠ 判据用的是"标识符在**去掉 import 语句后的原文**里出现过"——
//   所以出现在**注释 / 字符串**里的名字也算"用过"。方向是**宁可漏报、绝不误报**：
//   误报会让人去删仍在用的 import，那才是真事故。
//
// ⚠ 必须按**整段** import 解析（`import {\n a,\n b,\n} from '…'` 很常见）：
//   只读单行会静默漏掉一大半 —— 第一版探针就是这么错的（`voyage.js` 明明有 16 个只数出 3 个）。
const IMPORT_RE = /^[ \t]*import\b[\s\S]*?from[ \t]*'[^']*';?/gm;
const deadImports = [];
let importNameCount = 0;
for (const f of srcFiles) {
  const raw = read(path.join(SRC_DIR, f));
  const imported = [];
  IMPORT_RE.lastIndex = 0;
  for (const m of raw.matchAll(IMPORT_RE)) {
    const stmt = m[0];
    const line = raw.slice(0, m.index).split('\n').length;
    const ns = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(stmt);
    if (ns) { imported.push({ name: ns[1], line }); continue; }
    const br = /\{([\s\S]*?)\}/.exec(stmt);
    if (!br) continue;
    for (const part of br[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) imported.push({ name: n, line });
    }
  }
  importNameCount += imported.length;
  const body = raw.replace(IMPORT_RE, (s) => s.replace(/[^\n]/g, ' '));
  for (const im of imported) {
    const re = new RegExp(`(?<![.\\w$])${im.name.replace(/\$/g, '\\$')}(?![\\w$])`);
    if (!re.test(body)) deadImports.push({ rel: `src/${f}`, ...im });
  }
}

// ─────────────────────────────────────────────────────────────
// 尺子自检
// ─────────────────────────────────────────────────────────────
const methodCount = classes.reduce((a, c) => a + c.methods.length, 0);
const SANITY = [
  { what: 'src/*.js 文件', got: srcFiles.length, min: 10 },
  { what: '顶层函数 + 类方法', got: funcs.length, min: 150 },
  { what: '类', got: classes.length, min: 4 },
  { what: '类方法', got: methodCount, min: 120 },
  { what: '导出', got: exports_.length, min: 60 },
  // ⑤ 的尺子：解析出来的 import 名字太少，说明 IMPORT_RE 被新的写法绕过了
  { what: 'import 名字', got: importNameCount, min: 120 },
];
const sanityFails = SANITY.filter((s) => s.got < s.min);

// ─────────────────────────────────────────────────────────────
// 尺子自检 · 行号对齐（比上面那几条更要命）
// ─────────────────────────────────────────────────────────────
// `sanitize` 的行数一旦少于原文，`matchBrace` 在 sanitized 行空间里配平出的行号
// 就会被拿去切 raw 行空间 —— 第②关直接空过，而且**打印的是"没有重复实现"**。
// 这类"尺子坏了但读数正常"的情形没有任何外部征兆，只能自己守自己。
const rowDrift = files
  .filter((f) => f.rawLines !== f.sanLines)
  .map((f) => `${f.rel} 原始 ${f.rawLines} 行 / 去注释后 ${f.sanLines} 行（差 ${f.rawLines - f.sanLines}）`);

// ─────────────────────────────────────────────────────────────
// 打印
// ─────────────────────────────────────────────────────────────
const ok = (s) => `  \u2713 ${s}`;
const bad = (s) => `  \u2717 ${s}`;
const fails = [];

if (LIST_ONLY) {
  console.log('\n扫描规模');
  for (const s of SANITY) console.log(`  ${s.what.padEnd(18)} ${String(s.got).padStart(5)}  (下限 ${s.min})`);
  console.log('\n类');
  for (const c of classes) console.log(`  ${c.rel.padEnd(14)} ${c.name.padEnd(14)} L${String(c.line).padStart(5)}  ${c.methods.length} 个方法`);
  console.log(`\n导出 ${exports_.length} 个`);
  process.exit(0);
}

console.log('\n源码结构门禁 —— 抓"不报错、不闪退、静默失效"的结构缺陷\n');

console.log('尺子自检（扫描器失效会让下面几关一起空过）');
if (sanityFails.length === 0) {
  console.log(ok(SANITY.map((s) => `${s.what} ${s.got}`).join(' · ')));
}
for (const s of sanityFails) {
  console.log(bad(`${s.what} 只扫到 ${s.got} 个（下限 ${s.min}）—— 正则可能被新的写法绕过了`));
  fails.push(`SANITY ${s.what}`);
}
if (rowDrift.length === 0) {
  console.log(ok(`${files.length} 个文件「去注释前后行数一致」—— 配平行号可安全用于切片`));
} else {
  for (const d of rowDrift) {
    console.log(bad(`${d}`));
    console.log(`      sanitize() 少输出了换行 → matchBrace 的行号与原文错位 → **第②关会整关空过**`);
    fails.push(`SANITY 行号错位 ${d}`);
  }
}

console.log(`\n① 类内重名方法（${classes.length} 个类）`);
if (dupMethods.length === 0) console.log(ok('没有重名方法'));
for (const d of dupMethods) {
  console.log(bad(`${d.rel}  ${d.cls}.${d.name}() 定义了 ${d.lines.length} 次：L${d.lines.join(' / L')}`));
  console.log(`      后一个会**静默覆盖**前一个，前面的实现永远不会执行`);
  fails.push(`① ${d.rel} ${d.cls}.${d.name}`);
}

console.log(`\n② 逐字重复的函数体（≥${MIN_DUP_LINES} 行）`);
if (dupBodies.length === 0) console.log(ok('没有重复实现'));
for (const d of dupBodies) {
  console.log(bad(`${d.lineCount} 行，出现在 ${d.places.length} 处：`));
  for (const p of d.places) console.log(`      ${p}`);
  console.log(`      首行: ${d.head}`);
  fails.push(`② ${d.places[0]}`);
}

console.log(`\n③ 导出面（${exports_.length} 个导出，引用范围含 .dev/ 与 index.html）`);
if (unusedExports.length === 0 && needlessExports.length === 0) console.log(ok('没有多余的导出'));
for (const e of unusedExports) {
  console.log(bad(`${e.rel}:${e.line}  export ${e.name} —— 全项目零引用（含它自己的文件）`));
  console.log(`      真死代码，直接删`);
  fails.push(`③ ${e.rel} ${e.name}`);
}
for (const e of needlessExports) {
  console.log(bad(`${e.rel}:${e.line}  export ${e.name} —— 只有它自己的文件在用`));
  console.log(`      删掉 \`export \` 关键字即可（保留实现，缩小模块的导出面）`);
  fails.push(`③ ${e.rel} ${e.name} (多余 export)`);
}

console.log(`\n④ 语法（按 ES Module 解析，只解析不执行）`);
if (syntaxSkipped) {
  console.log(`  ⚠ 跳过：起不了子进程（${syntaxSkipped}）`);
  console.log(`      换一个能 spawn 子进程的环境跑，**别把这行当成通过**`);
} else if (syntaxBad.length === 0) {
  console.log(ok(`${srcFiles.length} 个模块全部能被 ESM 解析器解析`));
} else {
  for (const b of syntaxBad) {
    console.log(bad(b));
    console.log(`      浏览器会直接 SyntaxError（整页白屏），而 \`node --check <文件>\` 对 .js **抓不到**这一条`);
  }
  fails.push('④ 语法');
}

console.log(`\n⑤ 空 import（${importNameCount} 个 import 名字，判据含注释与字符串 —— 宁可漏报不误报）`);
if (deadImports.length === 0) console.log(ok('没有空 import'));
for (const d of deadImports) {
  console.log(bad(`${d.rel}:${d.line}  ${d.name} —— import 进来一次都没用`));
  console.log(`      拆模块的典型残留：实现在新文件里，旧文件的 import 忘了删`);
  fails.push(`⑤ ${d.rel} ${d.name}`);
}

if (fails.length === 0) {
  console.log(`\n================  门禁通过  ================\n`);
  process.exit(0);
}
console.log(`\n================  ${fails.length} 处结构缺陷  ================`);
console.log('这些都是静默失效，运行期断言很难守住。修完重跑：node .dev/lint-structure.mjs\n');
process.exit(1);
