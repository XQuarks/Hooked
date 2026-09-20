/**
 * lint-docs.mjs — 手写文档的「过期」门禁（GAMEPLAY.md §6.3 C1 的长期方案）
 *
 * 为什么要有这个脚本：
 *   `docs/01~06` 由 `gen-docs.mjs` 生成，`check` 能挡住漂移；
 *   但 README / GAMEPLAY / STRUCTURE / EXPANSION 四份是**手写**的 ——
 *   生成器全绿也证明不了它们没错。这个项目历史上从它们身上抓过 **6 批**过期数字
 *   （升级项 11 → 7、`GROWTH` 1.47 → 1.62、许可证退役后仍写着"拿到许可证才上架"……）。
 *   反复人肉校对不是办法：**"每次动 config.js 记得回头读一遍这四份"是一种愿望，不是门禁**。
 *
 * 这里把"过期"变成三条会挂掉的断言：
 *
 *   A 退役词 —— 已删除的机制 / 字段名不得以"现在时"出现在文档里。
 *              自带退役标记的行放行（`~~…~~` / 「已退役」/「已删除」/「已取消」……），
 *              因为"记录它被删掉了"本身是正确内容（DESIGN.md 迭代史全靠这个）。
 *   B 计数   —— 文档里写的条数 / 个数必须等于从源码实测出来的值。
 *   C 清单   —— `.dev/` 下的脚本必须都在 README 的脚本表里（加了脚本忘了写文档）。
 *
 * 用法：
 *   node .dev/lint-docs.mjs          # 校验；有漂移则退出码 1
 *   node .dev/lint-docs.mjs --list   # 只打印三张表（维护时看）
 *
 * ⚠ 本脚本**只读**，不写任何文档。发现漂移请人改。
 *   理由：这里的数字都嵌在**散文**里，机器改写散文比人写更容易改坏语义；
 *   而"能干净地生成"的那部分（各文件行数 → `loc.mjs`、`docs/01~06` → `gen-docs.mjs`）
 *   本来就已经生成了。这个脚本守的是**剩下那部分没法生成的**。
 *
 * ⚠ 锚点失配 = 失败。如果某条断言的 `re` 一条都匹配不上（有人把标题改写了），
 *   也算挂 —— 否则门禁会**悄悄变成空过**，那比没有门禁更糟（B11 就是这么漏的）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const LIST_ONLY = process.argv.includes('--list');

const C = await import(pathToFileURL(path.join(ROOT, 'src/config.js')).href);
const I = await import(pathToFileURL(path.join(ROOT, 'src/icons.js')).href);

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readLines = (rel) => read(rel).split('\n');

// ── 被测文档：四份手写的 + 手写索引 docs/README.md ─────────────────────────────
// ⚠ `DESIGN.md` **不在里面**：它是迭代史，逐轮记录"当时改了什么、删了什么"，
//   通篇都是历史快照 —— 拿"不得以现在时出现"去扫它，等于要求历史改写自己。
//   （和 `EXPANSION.md` 的区别：那份是**一整篇**历史快照，所以整篇豁免；
//     `DESIGN.md` 是**逐条**历史，没法用一个标记覆盖，直接不扫。）
const DOCS = ['README.md', 'GAMEPLAY.md', 'STRUCTURE.md', 'EXPANSION.md', 'docs/README.md', 'src/ARCHITECTURE.md'];

// ════════════════════════════════════════════════════════════════════════════
// A 退役词
// ════════════════════════════════════════════════════════════════════════════

const RETIRED = [
  { term: '许可证',      died: 'v0.7 第二批', why: '换图门槛改成「海图 + 船」；`MAPS[].license` 字段保留但两张图都恒为 0' },
  { term: 'LIC_MUL',     died: 'v0.7 第二批', why: '许可证整条取消，对应的调参口变成 `BOATS[].price`' },
  { term: '33,233',      died: 'v0.7 第二批', why: '许可证的价格' },
  { term: '声呐',        died: 'v0.5',        why: '升级项 `sonar` 移除（连同深度尺上的探测带）' },
  { term: 'sonar',       died: 'v0.5',        why: '升级项 `sonar` 移除' },
  { term: '加固',        died: 'v0.5',        why: '升级项 `rig` 移除，撞鱼判定固定' },
  { term: '保险',        died: 'v0.5',        why: '升级项 `insurance` 移除，罚款固定 30、没有减免路径' },
  { term: 'insurance',   died: 'v0.5',        why: '升级项 `insurance` 移除' },
  { term: 'UPGRADE_SVG', died: 'v0.5',        why: '`ui.js` 的图标映射表删掉，改用 `icons.js` 的 `glyph(key)`' },
  { term: 'gunPower',    died: 'v0.5',        why: '全局攻击力倍率并入 `GUNS[].dmg`，只剩一条轴' },
  { term: '图鉴 90%',    died: 'v0.7 第二批', why: '换图门槛里的"图鉴 ≥ 90%"整条删掉' },
];

// ⚠ **退役的"旧数值"不进这张表**（比如 `GROWTH = 1.47`）。
//   理由：一个裸数字在"从 1.47 提到 1.62"这类**改动叙述**里是正确内容，
//   词表分不清"写错了"和"在讲它改过"。数值类的漂移交给 B 关 ——
//   那里比的是**实测值**，方向明确（"文档说选 1.47，实测是 1.62"），不会误报。

/** 一行（或它上面两行）里出现这些字样 = 这段在讲"它已经没了"，属于正确内容 */
const RETIRE_MARK = new RegExp([
  '~~',                                   // 删除线
  '已退役', '退役', '已删', '已删除', '删除', '已移除', '移除', '已取消', '取消',
  '已作废', '作废', '已废弃', '废弃', '删掉', '删了', '删除了',
  '不再', '曾经', '历史', '旧版', '旧的', '旧的三条', '以前', '当时', '原来',
  'v\\d+\\.\\d+\\s*时',                    // "v0.4 时……" = 在讲过去
].join('|'));

/**
 * 回看窗口（行）。退役标记常常在**上一行**（"v0.4 时……" 换行后才是那句带术语的话），
 * 所以命中行要连它上面两行一起看。
 * ⚠ 刻意压到 **2 行**：窗口越大，越容易把一段真正的过期描述"顺带豁免"掉。
 */
const LOOKBACK = 2;

/**
 * 整篇按"历史快照"豁免的文档。
 * ⚠ 豁免不是"放过"—— 每个都要挂一条**免责声明的存在性断言**：
 *   声明被删掉 / 改写，豁免立刻失效（否则豁免会变成一张可以永久继承的空白支票）。
 *
 * ⚠ **当前是空的** —— `EXPANSION.md` 曾经在这里（它当时整篇是 v0.1 写下的目标方案，
 *   里面 `LIC_MUL` / `GROWTH 1.47` / `声呐` / 11 项升级都是那时的设计）。
 *   2026-09-18 把它**重写成了对齐现状的规划文档**（现状列全部改成实测值、
 *   目标缩到 3 张图、死掉的方案整段删除），所以它现在**正常受 A 关管辖**。
 *   这正是这条豁免机制想要的结局：**豁免是临时的，不是永久的**。
 */
const HISTORICAL_DOCS = {};

// ════════════════════════════════════════════════════════════════════════════
// B 计数：文档里写的数 vs 实测的数
// ════════════════════════════════════════════════════════════════════════════

const SRC_MODULES = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).length;
const GLYPH_N = Object.keys(I.GLYPH).length;
const ICON_N = GLYPH_N + 1;                                     // + 金币（不在 GLYPH 里）
const LV_MAX = C.MAX_LEVEL;                                     // 20 → Lv0~Lv20 共 21 档
const MAX_HP = Math.max(...C.SPECIES.map((s) => s.hp));
const LEVELED = C.UPGRADE_ORDER.filter((k) => (C.UPGRADES[k].maxLv ?? C.MAX_LEVEL) > 1).length;
const ONE_TIME = C.UPGRADE_ORDER.length - LEVELED;
const SPECIES_OF_MAP = (mapId) => C.SPECIES.filter((s) => C.mapOfSpecies(s)?.id === mapId);
const SPECIES_OF = (mapId) => SPECIES_OF_MAP(mapId).length;
const PRICIEST_OF = (mapId) => Math.max(...SPECIES_OF_MAP(mapId).map((s) => s.value));

// ── STRUCTURE.md 的派生数字（P0-3 的长期方案）──────────────────────────────────
// 这份文件曾经**自己跟自己打架**：`§0 状态行`手写着「10 个模块共 7,184 行」，
// 而往下 120 行的生成块（`loc.mjs` 管的）写着「14,369 行」。它又明确是**写给 AI 看的**
// （§0 写着"任何人（或任何 AI）接手这个项目，看这一页就知道想改的东西在哪"），
// 于是 AI 打开第一页就拿到 6 个错数字：模块数 / `MAPS` / `SPECIES` / `GUNS` / `GLYPH` / App 数。
// 修法不是"这次改对"，而是把它们变成会挂的断言 —— 否则下次改 `config.js` 照样漂。
//
// ⚠ 行数**不进**锚点：它已经在 §2 的「体积快照」里由 `loc.mjs` 生成，
//   而且那边是带千分位的（`11,841`），这里 `Number()` 会得到 `NaN`。
//   §0 里那句手抄的行数已经删掉了 —— 同一份文件里不留第二份行数。
const ROOT_DOCS = fs.readdirSync(ROOT).filter((f) => f.endsWith('.md')).length;
const DOCS_MD = fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).length;

/**
 * App 数从 `ui.js` 的桌面列表里数出来，不写死。
 * ⚠ 只取 `const apps = [` 到 `.filter(` 之间那一段 —— 扩到整个文件的话，
 *   `data-app="…"` 之类的字符串会混进来，把数字顶大。
 */
const APP_N = (() => {
  const m = read('src/ui.js').match(/const apps = \[([\s\S]*?)\]\s*\n?\s*\.filter\(/);
  return m ? (m[1].match(/\['[a-z]+',/g) || []).length : 0;
})();

/** 一套 verify 脚本里的断言条数 —— 与脚本结尾打印的 `N/N 通过` 同源 */
const verifyCount = (file) => (read(`.dev/${file}`).match(/^\s*(?:await\s+)?check\(/gm) || []).length;

/**
 * 每条断言：`re` 至少要匹配到一次，捕获组里的数字必须等于 `actual()`。
 * `actual` 返回**数组**，长度和捕获组个数一致。
 */
const COUNTS = [
  { file: 'README.md', re: /^## 图鉴（(\d+) 种 · 血量最高 (\d+)）/,
    actual: () => [C.SPECIES.length, MAX_HP], src: 'SPECIES.length / max(hp)',
    label: '图鉴标题' },

  { file: 'README.md', re: /^## 枪械（(\d+) 把 · 每把可升 (\d+) 级）/,
    actual: () => [C.GUNS.length, C.GUNS[0].dmg.length - 1], src: 'GUNS.length / GUNS[0].dmg.length-1',
    label: '枪械标题' },

  { file: 'README.md', re: /^## 升级（(\d+) 项有等级 \+ (\d+) 项一次性工具）/,
    actual: () => [LEVELED, ONE_TIME], src: 'UPGRADE_ORDER 里 maxLv>1 的项数 / 其余',
    label: '升级标题' },

  { file: 'README.md', re: /游戏源码（(\d+) 个 ES Module）/,
    actual: () => [SRC_MODULES], src: 'src/*.js 文件数',
    label: 'src 模块数' },

  { file: 'README.md', re: /图标库（(\d+) 个：金币 \+ (\d+) 个 GLYPH/,
    actual: () => [ICON_N, GLYPH_N], src: 'GLYPH 键数 + 1 / GLYPH 键数',
    label: '图标数（文件树）' },

  { file: 'README.md', re: /一共 \*\*(\d+) 个\*\*/,
    actual: () => [ICON_N], src: 'GLYPH 键数 + 1',
    label: '图标数（清单引言）' },

  { file: 'README.md', re: /查看 (\d+) 种鱼的资料卡/,
    actual: () => [C.SPECIES.length], src: 'SPECIES.length',
    label: '手机·图鉴一行' },

  { file: 'README.md', re: /全部 (\d+) 种鱼的身价 \/ 血量/,
    actual: () => [C.SPECIES.length], src: 'SPECIES.length',
    label: '图鉴脚注' },

  { file: 'README.md', re: /\*\*(\d+) 种\*\*极地鱼（最贵 (\d+) 金币）/,
    actual: () => [SPECIES_OF('polar'), PRICIEST_OF('polar')],
    src: 'SPECIES 里 map=polar 的条数 / 最高身价',
    label: '冰封极地一行' },

  { file: 'README.md', re: /完整 (\d+) 级曲线、逐级成本/,
    actual: () => [LV_MAX + 1], src: 'MAX_LEVEL + 1',
    label: '升级曲线档数' },

  { file: 'README.md', re: /#\s+(\d+) 种鱼的完整数值表/,
    actual: () => [C.SPECIES.length], src: 'SPECIES.length',
    label: '文件树 · 02 图鉴' },

  { file: 'README.md', re: /#\s+(\d+) 项 × (\d+) 级曲线 \+ (\d+) 项一次性工具/,
    actual: () => [LEVELED, LV_MAX + 1, ONE_TIME], src: 'UPGRADE_ORDER / MAX_LEVEL+1',
    label: '文件树 · 03 升级' },

  { file: 'README.md', re: /(\d+) 条鱼种风味文本/,
    actual: () => [C.SPECIES.length], src: 'SPECIES.length',
    label: '文件树 · 05 剧情' },

  { file: 'README.md', re: /#\s+全局数值配置（MAPS (\d+) 张地图 \/ (\d+) 种鱼 \/ .*?(\d+) 项升级 × (\d+) 级 \+ (\d+) 项一次性工具 \/ (\d+) 把枪/,
    actual: () => [C.MAPS.length, C.SPECIES.length, LEVELED, LV_MAX, ONE_TIME, C.GUNS.length],
    src: 'MAPS / SPECIES / UPGRADE_ORDER / MAX_LEVEL / GUNS',
    label: '文件树 · config.js' },

  // ── GAMEPLAY.md：标定口径里"我们选中的那个数"必须等于 config 现值 ──
  //    ⚠ 这条就是 C1 的原发地：§4.2 的表里写着「→ 选 **1.47**」，而 `GROWTH` 在 v0.5
  //      就改成 1.62 了，一直没人回头改。裸数字进不了 A 关的退役词表
  //      （它在"从 1.47 提到 1.62"这种**改动叙述**里是正确内容），
  //      但"**选的是**多少"是一个**派生值** —— B 关比的就是它，方向明确、不会误报。
  //    ⚠ 锚点要**钉到那一行**（`` `GROWTH`（每级成本倍率）… → 选 **X** ``），
  //      不能只写 `→ 选 **X**` —— 那样任何"引用这句话"的地方（比如 §6.4 里
  //      "§4.2 还写着「→ 选 **1.47**」"）都会误报，而误报会让人开始无视门禁。
  { file: 'GAMEPLAY.md', re: /`GROWTH`（每级成本倍率）[^\n]*?→ 选 \*\*([\d.]+)\*\*/,
    actual: () => [C.GROWTH], src: 'GROWTH',
    label: '§4.2 标定口径 · 选中的 GROWTH' },

  // ── STRUCTURE.md 的派生数字（原先全是手写，P0-3 里 6 个数字同时过期）──
  //    ⚠ 锚点一律钉到**那一行**（带上行首符号或整句），别只写数字本身 ——
  //      「10 个模块」这种短语在别处被引用时也会命中，误报会让人开始无视门禁。
  { file: 'STRUCTURE.md', re: /：`src` (\d+) 个模块，根文档 (\d+) 份 \+ `docs\/` (\d+) 份/,
    actual: () => [SRC_MODULES, ROOT_DOCS, DOCS_MD], src: 'src/*.js / 根目录 *.md / docs/*.md',
    label: '§0 状态行 · 模块数与文档数' },

  { file: 'STRUCTURE.md', re: /^├── src\/\s+← 游戏源码（(\d+) 个 ES Module）/,
    actual: () => [SRC_MODULES], src: 'src/*.js 文件数',
    label: '§1 目录树 · src 模块数' },

  { file: 'STRUCTURE.md', re: /`ZONES` (\d+) 层海域[^\n]*?`MAPS` (\d+) 张地图[^\n]*?`SPECIES` (\d+) 种鱼[^\n]*?`GUNS` (\d+) 把枪 × (\d+) 档/,
    // ⚠ 「档」= `dmg` 数组的元素个数（Lv0~Lv5 共 6 档），**不是**「可升几级」（那是 5）。
    //   上面 README 那条「每把可升 5 级」用的是 `dmg.length - 1` —— 两个都对，别抄错。
    actual: () => [C.ZONES.length, C.MAPS.length, C.SPECIES.length, C.GUNS.length, C.GUNS[0].dmg.length],
    src: 'ZONES / MAPS / SPECIES / GUNS / 枪的档数',
    label: '§2① config.js 一行' },

  { file: 'STRUCTURE.md', re: /手机外壳 \+ (\d+) 个 App/,
    actual: () => [APP_N], src: 'ui.js 桌面 App 列表条数',
    label: '§2④ ui.js 一行' },

  { file: 'STRUCTURE.md', re: /共 (\d+) 个 `GLYPH` \+ 1 个 `coinIcon`（合计 (\d+) 个图标[^\n]*?\*\*(\d+) 个 App\*\*（含船厂）\/ \*\*(\d+) 项升级 \+ (\d+) 件工具\*\* \/ \*\*(\d+) 把枪\*\*/,
    actual: () => [GLYPH_N, ICON_N, APP_N, LEVELED, ONE_TIME, C.GUNS.length],
    src: 'GLYPH 键数 / 图标总数 / App / 升级项 / 枪',
    label: '§2④ icons.js 一行' },

  { file: 'STRUCTURE.md', re: /手机界面（(\d+) 个 App，含船厂）、\*\*电话引导\*\*、(\d+) 项升级 \+ (\d+) 件工具、\*\*(\d+) 把枪与枪店\*\*/,
    actual: () => [APP_N, LEVELED, ONE_TIME, C.GUNS.length],
    src: 'App / 升级项 / 枪',
    label: '§2⑥ README 一行' },

  // ── README 的电话引导：原先写死「6 通」，而 `CALLS` 已经有 9 条 ──
  //    典型症状是**同一屏里自相矛盾**：上半页说「6 通」，点进去的 `docs/05` 列着 1~9。
  { file: 'README.md', re: /📊 (\d+) 通电话的\*\*完整文案与触发条件\*\*/,
    actual: () => [C.CALLS.length], src: 'CALLS.length',
    label: '电话引导 · 通数' },
];

// verify 断言表：README 的脚本表里逐条写死了每套的条数（会随加断言过期）
// ⚠ 中间用 `[^\n]*?` 而不是 `[^|\n]*?` —— 表格里脚本名和条数之间**夹着一个 `|`**
//   （`` | `verify8.mjs` | **批 2**…的 **50 条断言** ``），用竖线当边界会让它一条都匹配不上，
//   而"匹配不上"会被当成锚点失配报出来 —— 正好是这个门禁自己该防的空过。
const VERIFY_RE = /`(verify\d*\.mjs)`[^\n]*?\*\*(\d+) 条断言\*\*/g;

// ════════════════════════════════════════════════════════════════════════════
// C 清单：.dev/ 下的脚本必须都在 README 的脚本表里
// ════════════════════════════════════════════════════════════════════════════

const DEV_SCRIPTS = fs.readdirSync(path.join(ROOT, '.dev'))
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => `.dev/${f}`)
  .sort();

/** 有意不写进 README 的 —— 加进来要写清理由（当前为空：`.dev/` 下每个脚本都在 README 的表里） */
const DEV_EXEMPT = new Set([]);

// ════════════════════════════════════════════════════════════════════════════
// 跑
// ════════════════════════════════════════════════════════════════════════════

const fails = [];
const notes = [];

// ── A ──
const aHits = [];
const aSkipped = [];
for (const rel of DOCS) {
  if (HISTORICAL_DOCS[rel]) { aSkipped.push(rel); continue; }
  const ls = readLines(rel);
  ls.forEach((line, i) => {
    // 命中行 + 上面两行一起看（退役标记常在上/上一行）
    const ctx = ls.slice(Math.max(0, i - LOOKBACK), i + 1).join('\n');
    if (RETIRE_MARK.test(ctx)) return;
    for (const r of RETIRED) {
      if (line.includes(r.term)) aHits.push({ rel, line: i + 1, term: r.term, r, text: line.trim() });
    }
  });
}
// 豁免文档的"免责声明存在性"断言 —— 声明没了，豁免就失效
const aGuard = [];
for (const [rel, h] of Object.entries(HISTORICAL_DOCS)) {
  if (!h.guard.test(read(rel))) aGuard.push({ rel, h });
}

// ── B ──
const bHits = [];
const bDead = [];
for (const c of COUNTS) {
  const text = read(c.file);
  const lines = text.split('\n');
  let seen = 0;
  lines.forEach((line, i) => {
    const m = c.re.exec(line);
    if (!m) return;
    seen++;
    const want = c.actual();
    const got = m.slice(1).map(Number);
    const ok = got.length === want.length && got.every((v, k) => v === want[k]);
    if (!ok) bHits.push({ ...c, line: i + 1, got, want, text: line.trim() });
  });
  if (seen === 0) bDead.push({ ...c, reason: '一条都没匹配上' });
}

// ── B（verify 断言表）──
const vHits = [];
{
  const lines = readLines('README.md');
  const seen = new Set();
  lines.forEach((line, i) => {
    for (const m of line.matchAll(VERIFY_RE)) {
      seen.add(m[1]);
      let want;
      try { want = verifyCount(m[1]); } catch { vHits.push({ file: m[1], line: i + 1, got: [Number(m[2])], want: null, note: '脚本读不到' }); continue; }
      if (Number(m[2]) !== want) vHits.push({ file: m[1], line: i + 1, got: [Number(m[2])], want: [want] });
    }
  });
  for (const f of ['verify3.mjs', 'verify4.mjs', 'verify5.mjs', 'verify6.mjs', 'verify7.mjs', 'verify8.mjs', 'verify9.mjs']) {
    if (!seen.has(f)) bDead.push({ file: 'README.md', label: `verify 表 · ${f}`, reason: '脚本表里没提它' });
  }
}

// ── B（七套回归的合计条数）──
// `34 + 25 + 34 + 63 + 47 + 51 + 52 = 306 条` 这种句子散在好几份文档里，
// 每加一条断言就要挨个改一遍 —— 正好是 B 关该管的派生数据。
const SEVEN = ['verify3.mjs', 'verify4.mjs', 'verify5.mjs', 'verify6.mjs', 'verify7.mjs', 'verify8.mjs', 'verify9.mjs', 'verify10.mjs', 'verify11.mjs', 'verify12.mjs', 'verify13.mjs', 'verify14.mjs', 'verify15.mjs', 'verify16.mjs'];
const SEVEN_RE = /(\d+) \+ (\d+) \+ (\d+) \+ (\d+) \+ (\d+) \+ (\d+) \+ (\d+) \+ (\d+) \+ (\d+) \+ (\d+) \+ (\d+) \+ (\d+) \+ (\d+) \+ (\d+) = \*{0,2}(\d+)/g;
const sHits = [];
const sDead = [];
{
  const want = SEVEN.map(verifyCount);
  want.push(want.reduce((a, b) => a + b, 0));
  let seen = 0;
  for (const rel of [...DOCS, 'DESIGN.md']) {
    readLines(rel).forEach((line, i) => {
      for (const m of line.matchAll(SEVEN_RE)) {
        seen++;
        const got = m.slice(1, 16).map(Number);
        if (got.join() !== want.join()) sHits.push({ rel, line: i + 1, got, want, text: line.trim() });
      }
    });
  }
  // ⚠⚠ 一条都没匹配上 = 锚点失配，必须报错。
  //   这条守卫是**吃了自己的狗粮**加上的：把 7 个数改成 8 个数之后，
  //   文档里那句"… = 306"立刻匹配不到了，而门禁**照样全绿** ——
  //   和 B11 那两条"空过的断言"是同一个病。
  if (seen === 0) sDead.push('十四套回归合计：一条都没匹配上（锚点失配，门禁已空过）');
}

// ── D：src/ARCHITECTURE.md 引用的脚本必须真的存在 ─────────────────────────────
// 这份文档的价值全在「每条硬不变式都附一条守着它的断言」。一旦有人改了断言名 / 删了脚本
// 而没回来改文档，它就会变成一份**看起来权威、其实指不到东西**的清单 ——
// 那正好是它自己要防的那种静默失效。所以把"引用可解析"也变成会挂的断言。
const ARC = 'src/ARCHITECTURE.md';
const arcRefs = [
  // ⚠ 加 `(?<![\w$])` 是为了排除 `verify$i.mjs` 这种**循环里的变量名** ——
  //   不加的话它会把 `$i` 里的 `i` 当成脚本名，报一个不存在的 `.dev/i.mjs`（真误报）。
  //   这个项目的老规矩：**门禁必须零误报，否则一定被绕过**。
  ...[...read(ARC).matchAll(/(?<![\w$])([a-z][a-z0-9-]*)\.mjs/g)].map((m) => m[1]),
  ...[...read(ARC).matchAll(/`(verify\d+)`/g)].map((m) => m[1]),
];
const arcUniq = [...new Set(arcRefs)];
const arcMissing = arcUniq.filter((r) => !fs.existsSync(path.join(ROOT, '.dev', `${r}.mjs`)));
/** ⚠ 一条引用都提不出来 = 文档被大改 / 正则失效 → **也算失败**（防门禁悄悄空过） */
const arcDead = arcUniq.length === 0;

// ── C ──
const cHits = [];
{
  const text = read('README.md');
  for (const s of DEV_SCRIPTS) {
    if (DEV_EXEMPT.has(s)) continue;
    if (!text.includes('`' + path.basename(s) + '`')) cHits.push(s);
  }
}

// ── 打印 ──
const ok = (s) => `  \u2713 ${s}`;
const bad = (s) => `  \u2717 ${s}`;

if (LIST_ONLY) {
  console.log(`\nA · 退役词表（${RETIRED.length} 个）`);
  for (const r of RETIRED) console.log(`  ${r.term.padEnd(14)} ${r.died.padEnd(14)} ${r.why}`);
  console.log(`\nB · 计数断言（${COUNTS.length} 条 + verify 断言表 + 十四套合计）`);
  for (const c of COUNTS) {
    const want = c.actual();
    console.log(`  ${c.file.padEnd(12)} ${c.label.padEnd(18)} = ${want.join(' / ').padEnd(14)} (${c.src})`);
  }
  console.log(`\nC · .dev 脚本（${DEV_SCRIPTS.length} 个，豁免 ${DEV_EXEMPT.size} 个）`);
  for (const s of DEV_SCRIPTS) console.log(`  ${s}${DEV_EXEMPT.has(s) ? '   [豁免]' : ''}`);
  process.exit(0);
}

console.log('\n手写文档门禁 —— 让"过期"变成会挂掉的断言\n');

console.log(`A · 退役词（${RETIRED.length} 个词 × ${DOCS.length - aSkipped.length} 份文档`
  + `${aSkipped.length ? `，豁免 ${aSkipped.map((s) => `${s}（历史快照）`).join(' / ')}` : ''}）`);
if (aHits.length === 0 && aGuard.length === 0) console.log(ok('没有未标记的退役词'));
for (const h of aHits) {
  console.log(bad(`${h.rel}:${h.line}  「${h.term}」未标退役（${h.r.died} 已删：${h.r.why}）`));
  console.log(`      ${h.text.slice(0, 96)}`);
  fails.push(`A ${h.rel}:${h.line} ${h.term}`);
}
for (const { rel, h } of aGuard) {
  console.log(bad(`${rel}  历史快照豁免失效：正文里找不到「${h.guardText}」（${h.why}）`));
  fails.push(`A ${rel} 免责声明缺失`);
}

console.log(`\nB · 计数（${COUNTS.length} 条 + verify 断言表 + 十四套合计）`);
if (bHits.length === 0 && vHits.length === 0 && sHits.length === 0 && bDead.length === 0 && sDead.length === 0) console.log(ok('全部与源码一致'));
for (const h of bHits) {
  console.log(bad(`${h.file}:${h.line}  ${h.label}：文档写 ${h.got.join(' / ')}，实测 ${h.want.join(' / ')}（${h.src}）`));
  fails.push(`B ${h.file}:${h.line} ${h.label}`);
}
for (const h of vHits) {
  console.log(bad(`README.md:${h.line}  ${h.file} 的断言条数：文档写 ${h.got[0]}，实测 ${h.want ? h.want[0] : '?'}`));
  fails.push(`B README.md:${h.line} ${h.file}`);
}
for (const s of sDead) { console.log(bad(s)); fails.push('B ' + s); }
for (const h of sHits) {
  console.log(bad(`${h.rel}:${h.line}  十四套回归合计：文档写 ${h.got.slice(0, 14).join('+')} = ${h.got[14]}，实测 ${h.want.slice(0, 14).join('+')} = ${h.want[14]}`));
  fails.push(`B ${h.rel}:${h.line} 七套合计`);
}
for (const h of bDead) {
  console.log(bad(`${h.file}  ${h.label}：${h.reason} —— 锚点失配，门禁已空过`));
  fails.push(`B ${h.file} ${h.label} 锚点失配`);
}

console.log(`\nC · 清单（.dev/ 下 ${DEV_SCRIPTS.length} 个脚本）`);
if (cHits.length === 0) console.log(ok('全部出现在 README 的脚本表里'));
else for (const s of cHits) {
  console.log(bad(`${s} 不在 README 的脚本表里（补一行，或加进 DEV_EXEMPT 并写明理由）`));
  fails.push(`C ${s}`);
}

console.log(`\nD · src/ARCHITECTURE.md（硬不变式的落点，引用的脚本必须存在）`);
if (arcDead) {
  console.log(bad('一条脚本引用都提不出来 —— 文档被大改或正则失效，门禁已空过'));
  fails.push('D 锚点失配');
} else if (arcMissing.length === 0) console.log(ok(`引用的 ${arcUniq.length} 个 .dev 脚本全部存在`));
else for (const r of arcMissing) {
  console.log(bad(`引用了 .dev/${r}.mjs，但该文件不存在 —— 文档已经指不到东西了`));
  fails.push(`D ${r}`);
}

if (fails.length === 0) {
  console.log(`\n================  门禁通过  ================\n`);
  process.exit(0);
}
console.log(`\n================  ${fails.length} 处过期  ================`);
console.log('这些数字都嵌在散文里，请人改（本脚本只读不写）。改完重跑：node .dev/lint-docs.mjs\n');
process.exit(1);
