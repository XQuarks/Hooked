# 文件结构说明 · HOOKED 荒谬钓鱼

> **概述**：本文把仓库里的每一个文件按「职责分层」归类，说明它是什么、属于哪一层、被谁依赖。
> 目标是一份**打开即懂**的地图 —— 任何人（或任何 AI）接手这个项目，看这一页就知道"想改的东西在哪"。
>
> **状态**：与代码同步（核对自磁盘实况）。截至 2026-09-16：`src` 10 个模块共 7,184 行，`.dev` 35 个脚本共 6,942 行，文档 3 份共 3,256 行。
> **唯一数值来源是 `src/config.js`** —— 本文只描述结构，不复制数值，数值请以代码为准。
>
> **读者**：接手本项目的开发者 / 审阅者，以及需要理解代码组织的 AI 助手。
>
> **关联**：[`README.md`](./README.md)（玩法与部署）· [`DESIGN.md`](./DESIGN.md)（设计推演与迭代记录）· [`EXPANSION.md`](./EXPANSION.md)（扩建路线）

---

## 0. 一页速览（7 层）

```
① 数据层   config.js                                  ← 所有数值的唯一来源，其它模块只读它
② 渲染层   world.js · fish.js · hook.js                ← Three.js 场景 / 鱼 / 钩线
③ 逻辑层   game.js · input.js · audio.js               ← 主循环与状态机 / 输入 / 音效
④ 界面层   ui.js · icons.js · codex.js                 ← DOM 覆盖层 / SVG 图标 / 图鉴
⑤ 载体层   index.html · styles.css · vendor/           ← 页面骨架 / 样式 / Three.js 本体
⑥ 文档层   README.md · DESIGN.md · EXPANSION.md · STRUCTURE.md
⑦ 辅助层   .dev/ · shots-v2/ · .workbuddy-ai/memory/
```

**一句话记忆法**：`config` 定数值 → `world/fish/hook` 画世界 → `game` 跑逻辑 → `ui/icons/codex` 贴界面 → `index/styles` 装起来。

---

## 1. 目录树

```
/                                   （仓库根，GitHub Pages 直接托管此目录）
├── index.html                      ← 唯一入口页面
├── styles.css                      ← 全部样式
├── README.md                       ← 玩法 + 部署（面向玩家/使用者）
├── DESIGN.md                       ← 设计推演 + 迭代 1~10 踩坑记录（面向开发）
├── EXPANSION.md                    ← 5 地图 / 92 鱼 / 8 枪的扩建方案（面向未来）
├── STRUCTURE.md                    ← 本文（文件结构与分层）
├── docs/                           ← 📊 数值与剧情参考文档（01~06 **由脚本生成**，改 config.js 后重跑）
│   ├── README.md                   ←    索引 + 「想改什么 → 改哪里」速查 + 维护规则（手写）
│   ├── 01-世界与地图.md
│   ├── 02-鱼类图鉴.md
│   ├── 03-升级与成本.md
│   ├── 04-物理与经济.md
│   └── 05-剧情与世界观.md
├── .nojekyll                       ← 让 GitHub Pages 跳过 Jekyll 处理
├── .gitignore                      ← 忽略开发产物与 AI 记忆目录
├── src/                            ← 游戏源码（10 个 ES Module）
│   ├── config.js
│   ├── world.js
│   ├── fish.js
│   ├── hook.js
│   ├── game.js
│   ├── input.js
│   ├── audio.js
│   ├── ui.js
│   ├── icons.js
│   └── codex.js
├── vendor/
│   └── three.module.js             ← Three.js r160 本地副本（唯一第三方代码，MIT）
├── .dev/                           ← CDP 无头 Chrome 验证 / 出图 / 探针脚本
│   ├── gen-docs.mjs                ←    生成 docs/ 的数值文档（改了 config.js 就跑它）
│   └── archive/                    ← 9 个一次性探针（`_` 前缀），已归档不再参与常规回归
├── shots-v2/                       ← 旧版人工复核截图 22 张（.gitignore 内，不进仓库）
└── .workbuddy-ai/memory/           ← AI 工作记忆与开发日志（.gitignore 内，不进仓库）
```

> ⚠ **`.dev/` 是「部分」进仓库**：`.dev/*.mjs`（脚本本体）与 `.dev/archive/` 都被 git 跟踪；
> 被忽略的只是**跑脚本产生的产物** —— `.dev/profile-*/`（Chrome 用户目录）、`.dev/shots-*/`（出图）、
> `.dev/*.json`、`.dev/*.log`。`shots-v2/` 与 `.workbuddy-ai/` 则整体不进仓库。

---

## 2. 逐文件作用表

### ① 数据层 —— 唯一事实来源

| 文件 | 行数 | 作用 |
|---|---:|---|
| `src/config.js` | 1062 | **全项目最重要的文件**。集中定义：`WORLD` 世界尺度 / `CAMERA` / `WATER_STOPS` 水体渐变 / `ALTITUDE_BANDS` + `altitudeAt()` 大气分层 / `ZONES` 10 层海域 + `zonesOfMap()` `zoneAtDepth()` / `MAPS` 2 张地图 + `mapById()` `mapOfSpecies()` `mapMaxDepth()` / `FISH_DENSITY` `HAZARD_SPAWN` `SPAWN_TOP_MARGIN` / `MODEL_SCALE` / `RARITY` + `rollRarity()` + `valueOf()` / `SCHOOL` 鱼群 / `ICEBERG` 浮冰 / `SPECIES` 38 种鱼 / `UPGRADES` + `UPGRADE_ORDER` + `MAX_LEVEL` + `GROWTH` + `upgradeCost()` + `MAP_LEVEL_CAP` + `LEVELS` + `lvAt()` + `upgradeValueText()` / `DEEP` / `TUNING` 手感参数 / `SAVE_KEY`。**其它模块一律 import 它，不重复定义数值** |

> 改数值只改这一个文件。改完跑 `node .dev/curves.mjs check` 自检曲线单调性。

### ② 渲染层 —— 3D 世界

| 文件 | 行数 | 作用 | 依赖 |
|---|---:|---|---|
| `src/world.js` | 1707 | 场景、正交缩放相机、光照、水体、太空、深海地形（固定种子 PRNG）、暗幕、爆炸与粒子池、船与渔夫的摇晃动画。导出 `World` 类 + 工具函数 `toonMat()` `mergeGeos()` `makeGlowTexture()` | 无本地依赖（最底层） |
| `src/fish.js` | 782 | 鱼类造型工厂 `buildFishModel()`（`LatheGeometry` 旋转体 + 卡通阶梯着色 + 特征构件）、六种游动/飞行行为、三轴翻滚、血量、对象池、鱼群生成。导出 `Fish` / `FishManager` / `FISH_STATE` | `config` `world` |
| `src/hook.js` | 195 | 鱼钩与鱼线、渔获串排布 `layoutCatch()`、线段扫掠碰撞 `distToSegment()`。导出 `Hook` | `config` `world` |

### ③ 逻辑层 —— 玩法与反馈

| 文件 | 行数 | 作用 | 依赖 |
|---|---:|---|---|
| `src/game.js` | 1589 | **程序入口**。主循环 + 状态机 `IDLE → DESCEND → ASCEND → AIR → RESULT`、扣钱鱼加权抽签、爆炸命中判定、结算、`localStorage` 存档（`SAVE_KEY`） | `world` `fish` `hook` `input` `ui` `audio` |
| `src/input.js` | 84 | 统一输入层：触屏 / 鼠标 / 键盘 → 归一化坐标与方向键。导出 `Input` | 无 |
| `src/audio.js` | 155 | WebAudio 程序化合成音效（振荡器 + 噪声 + 滤波器），**零音频文件、零版权风险**。导出 `SFX` `unlockAudio()` `setMuted()` `isMuted()` | 无 |

### ④ 界面层 —— DOM 覆盖层

| 文件 | 行数 | 作用 | 依赖 |
|---|---:|---|---|
| `src/ui.js` | 1180 | HUD、**枪械条**、深度尺、**手机外壳 + 5 个 App**（渔具店 / 枪店 / 图鉴 / 航线 / 设置）、结算面板、标题页、飘字。导出 `UI` | `codex` `icons` |
| `src/icons.js` | 380 | 内联 SVG 图标库，共 37 个 `GLYPH` + 1 个 `coinIcon`（合计 38 个图标，覆盖 HUD / 5 个 App / 11 项升级 / **7 把枪** / 场景）。全界面**零 emoji** 靠它兜住。导出 `GLYPH` `glyph()` `iconText()` `coinIcon()` `heartRow()` | 无 |
| `src/codex.js` | 409 | 图鉴两级排序（地图 → 海域 → 身价）+ canvas 2D 程序化鱼图标（彩色 / 黑色剪影共用同一套特征参数）。导出 `codexOrder()` `groupByMap()` `zoneLabel()` `mapLabel()` `drawFishIcon()` | `config` |

### ⑤ 载体层

| 文件 | 行数 | 作用 |
|---|---:|---|
| `index.html` | 91 | 唯一入口：竖屏容器、importmap、HUD 骨架、手机层、结算层；加载 `src/game.js` |
| `styles.css` | 1444 | 竖屏布局、HUD、深度尺、手机外观与 App、图鉴、结算面板；世界界面明暗主题用 `[data-theme="light"]` 切换 |
| `vendor/three.module.js` | 53045 | Three.js r160 本地化副本（压缩产物）。**唯一的第三方代码**，MIT 许可，见文件头声明 |

### ⑥ 文档层

| 文件 | 行数 | 读者 | 内容 |
|---|---:|---|---|
| `README.md` | 527 | 玩家 / 使用者 | 玩法三段式循环、手机界面、11 项升级、图鉴、本地运行、GitHub Pages 三种部署方式、技术要点、开发辅助脚本清单 |
| `DESIGN.md` | 1454 | 开发者 | 原作玩法拆解、坐标系、状态机、数值设计、验收标准 + **迭代 1~10 全过程踩坑记录** |
| `EXPANSION.md` | 1275 | 规划者 | 5 地图 / 92 鱼 / 8 枪 / 弱剧情的扩建方案 + 分 8 批的落地路线 |
| `STRUCTURE.md` | — | 接手者 / AI | 本文：文件分层与作用 |
| `docs/`（7 份） | — | 调数值 / 写文案的人 | **唯一的数值与文案参考**。`README.md` 是手写索引；`01~06` **由 `.dev/gen-docs.mjs` 从 `src/config.js` 生成** —— 手改会被下次生成覆盖 |

> **为什么单独拆出 `docs/`**：README / DESIGN 里长期手抄了一份数值副本，
> 导致反复出现「文档写 9 条鱼、代码其实 18 条」这类漂移（历史上一共抓到 4 批）。
> 现在数值**只有 `config.js` 一处**，`docs/01~06` 是它的自动投影；
> `node .dev/gen-docs.mjs check` 一跑就知道文档有没有过期。

### ⑦ 辅助层（均不进仓库正文）

| 路径 | 规模 | 作用 |
|---|---|---|
| `.dev/` | 27 个 `.mjs`（+ `archive/` 9 个） | CDP 无头 Chrome 真跑游戏的验证 / 出图 / 探针脚本，详见 §3。**脚本本体进仓库**，产物（`profile-*/` `shots-*/` `*.json` `*.log`）进 `.gitignore` |
| `docs/` | 6 份 md | 数值与剧情参考文档（01~05 由 `.dev/gen-docs.mjs` 生成），详见 §2 ⑥ |
| `shots-v2/` | 22 张 PNG，约 1.75 MB | 旧版人工复核截图（已在 `.gitignore`） |
| `.workbuddy-ai/memory/` | 4 个 md | AI 工作记忆与开发日志（已在 `.gitignore`） |
| `.nojekyll` / `.gitignore` | — | GitHub Pages 免 Jekyll；忽略开发产物、Chrome profile、AI 记忆目录 |

---

## 3. `.dev/` 内部五类细分

| 类别 | 文件 | 说明 |
|---|---|---|
| **回归断言（8 套）** | `verify.mjs`（迭代 2 基线）· `verify3~9.mjs` | 主力回归。批 1 → `verify7`，批 2 → `verify8`，批 3（枪械）→ `verify9`。当前 **verify9 43 + verify8 47 + verify7 39 + verify6 52 + verify5 34 + verify4 25 + verify3 34 = 274 条全绿** |
| **数值验算（3 套）** | `curves.mjs` · `balance.mjs` · `balance-v2.mjs` | 升级曲线自检/导出、AI 代理玩家手感抽样、经济模型离线模拟 |
| **文档生成（1 套）** | `gen-docs.mjs` | **从 `src/config.js` 生成 `docs/01~06`**。`check` 子命令只校验不写盘（不一致则退出码 1） |
| **出图复核（13 套）** | `shots2/3/4/5-fish/5-ui/6` · `shots-icons` · `shots-shop` · `shots-polar` · `shots-guns` · **`shots-phone`** · `boom` · `_shots-v02` | 断言测不到"好不好看"，靠这些出图人工复核 |
| **诊断探针 / 一次性（14 个）** | `smoke.mjs` · `probe-coin/coinfit/d1/emoji/roww.mjs`（在 `.dev/` 根）<br>`.dev/archive/` 下 9 个：`_dbg` · `_probe-air/aurora/codex/roww2/slow` · `_shots-v02` · `_splice-wide/cost` | 定位静默失败、字体缺字形、宽度挤压等问题的一次性脚本。**带 `_` 前缀的 9 个已归档到 `.dev/archive/`**（不再参与常规回归），路径仍按**项目根**解析 —— 跑法为 `node .dev/archive/_xxx.mjs`。⚠️ `_splice-*.mjs` 会覆写 `DESIGN.md` / `EXPANSION.md` 的表格，非必要勿跑 |

> **完整清单**（36 个脚本逐个的一句话作用）见 [`README.md` 的「开发辅助」](./README.md#开发辅助)；本表只做归类。
> 下表用简写（如 `verify3~8.mjs` 指 `verify3.mjs` 到 `verify8.mjs` 共 6 个）。

**跑法**（先另开终端起静态服务器）：

```bash
python -m http.server 8899
node .dev/verify8.mjs http://127.0.0.1:8899/index.html
node .dev/curves.mjs check        # 改完 config.js 数值看这个
node .dev/gen-docs.mjs check      # 改完 config.js 数值 → 校验 docs/ 有没有跟着过期
node .dev/verify9.mjs            # 改完枪械 / 血量看这个
node .dev/shots-icons.mjs http://127.0.0.1:8899/index.html   # 改完 icons.js 看这个
node .dev/shots-guns.mjs         # 改完枪店 / 枪械条 / 枪械图标看这个
node .dev/shots-phone.mjs        # 改完手机界面（增删按钮 / 改间距）看这个
```

---

## 4. 依赖方向（谁 import 谁）

```
        config.js        world.js       icons.js      audio.js     input.js        ← 第 0 层：无本地依赖
            │                │              │
            ├────────┬───────┤              │
            ▼        ▼       ▼              │
        codex.js   fish.js  hook.js         │                                     ← 第 1 层
            │                │
            └───────┬────────┘
                    ▼
                 ui.js ◄──── icons.js                                               ← 第 2 层
                    │
   ┌────────┬───────┴────────┬──────────┬──────────┐
   ▼        ▼                ▼          ▼          ▼
 world.js  fish.js        hook.js   input.js   ui.js  audio.js  ←─ game.js         ← 第 3 层（入口）
```

**规则**：依赖只能**向下**，不出现环。`game.js` 是唯一入口，被 `index.html` 加载。

---

## 5. 改动落点速查

| 想改什么 | 改哪里 |
|---|---|
| 数值 / 加鱼 / 加地图 / 加升级项 / **加枪** | `src/config.js`（**改完跑 `node .dev/gen-docs.mjs` 同步 `docs/`**） |
| 某个数字该去哪找 / 怎么调 | [`docs/README.md`](./docs/README.md) 的「想改什么 → 改哪里」速查 |
| 场景、光照、水体、地形、爆炸 | `src/world.js` |
| 鱼的外形、游动行为、血量、对象池 | `src/fish.js` |
| 鱼钩 / 鱼线 / 渔获串排布 | `src/hook.js` |
| 玩法流程、状态机、结算、存档 | `src/game.js` |
| HUD / 枪械条 / 手机 / 各 App / 结算面板 | `src/ui.js` + `styles.css` |
| 图标 | `src/icons.js`（改完跑 `shots-icons.mjs` 出图复核） |
| 图鉴排序与鱼图标 | `src/codex.js` |
| 输入方式 | `src/input.js` |
| 音效 | `src/audio.js` |
| 页面骨架 / importmap | `index.html` |
| 鱼的文案 / 地图简介 | `src/config.js` 的 `desc` 字段（改完跑 `gen-docs.mjs`，会同步进 `docs/05`） |

---

## 6. 维护约定

1. **新增数值一律进 `config.js`**，不要在 `game.js` / `ui.js` 里写魔法数字。**改完数值跑一次 `node .dev/gen-docs.mjs`** —— `docs/` 里的数字是自动生成的，不跑就过期了。
2. **文档里不要手抄数值**：需要数据时链接到 `docs/`。手抄副本是这个项目历史上 4 批文档漂移的根因。
3. **依赖不回头**：低层模块（`config` / `world` / `icons` / `audio` / `input`）不 import 高层模块。
4. **`.dev/` 新脚本命名**：常规回归用 `verifyN.mjs`，出图用 `shotsN-*.mjs`；一次性探针加 `_` 前缀并放进 **`.dev/archive/`**。
   ⚠️ 所有 `.dev` 脚本的路径都按**项目根（`process.cwd()`）**解析，必须在项目根执行，例如 `node .dev/verify8.mjs`。
5. **新增文件后同步本文 §1 目录树与 §2 作用表**，并检查 README「文件结构」是否需要更新。
6. **`docs/README.md` 与 `DESIGN.md` / `EXPANSION.md` 是手写的，`docs/01~05` 是生成的** —— 改文档前先确认自己在改哪一类。
7. **`.dev/profile-*` 是每次跑 verify 时 Chrome 自动生成的临时用户目录**，已被 `.gitignore` 覆盖；占盘很大（历史峰值 217 个目录 / 约 5.6 GB），可随时整批删除，下次运行会重建。
