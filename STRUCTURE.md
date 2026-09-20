# 文件结构说明 · HOOKED 荒谬钓鱼

> **概述**：本文把仓库里的每一个文件按「职责分层」归类，说明它是什么、属于哪一层、被谁依赖。
> 目标是一份**打开即懂**的地图 —— 任何人（或任何 AI）接手这个项目，看这一页就知道"想改的东西在哪"。
>
> **状态**：与代码同步（核对自磁盘实况）。截至 2026-09-20：`src` 15 个模块，根文档 6 份 + `docs/` 7 份。
> **行数与脚本数不在这里手抄** —— 行数见 §2 的「体积快照」（由 `.dev/loc.mjs` 生成），脚本见 §3。
> （这一行曾经写死过「10 个模块共 7,184 行」，而往下 120 行的生成块同时写着「14,369 行」——
> 同一份文件里两个数互相打架，AI 打开第一页就被误导。手抄派生数据一定会漂，所以直接删掉。）
> **本文只描述结构与职责，不复制数值，也不手写行数** —— 行数见 §2 的「体积快照」（由 `.dev/loc.mjs` 生成）。
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
③ 逻辑层   game.js · save.js · narrative.js · voyage.js · guns.js · input.js · audio.js  ← 主循环与状态机 / 存档 / 剧情驱动 / 航线 / 枪械 / 输入 / 音效
④ 界面层   ui.js · icons.js · codex.js                 ← DOM 覆盖层 / SVG 图标 / 图鉴
⑤ 载体层   index.html · styles.css · vendor/           ← 页面骨架 / 样式 / Three.js 本体
⑥ 文档层   README.md · DESIGN.md · EXPANSION.md · GAMEPLAY.md · STRUCTURE.md
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
├── EXPANSION.md                    ← 3 地图 / 56 鱼 / 8 枪的扩建方案（面向未来）
├── GAMEPLAY.md                     ← 玩法设计：目标 / 机制 / 联动 / 平衡 / 解锁节奏 / 风险清单
├── STRUCTURE.md                    ← 本文（文件结构与分层）
├── ARCHITECTURE-REVIEW.md          ← 架构评审快照（2026-09-20 一次性记录，**不是维护文档**；不在 loc.mjs 统计内）
├── docs/                           ← 📊 数值与剧情参考文档（01~06 **由脚本生成**，改 config.js 后重跑）
│   ├── README.md                   ←    索引 + 「想改什么 → 改哪里」速查 + 维护规则（手写）
│   ├── 01-世界与地图.md
│   ├── 02-鱼类图鉴.md
│   ├── 03-升级与成本.md
│   ├── 04-物理与经济.md
│   └── 05-剧情与世界观.md
├── .nojekyll                       ← 让 GitHub Pages 跳过 Jekyll 处理
├── .gitignore                      ← 忽略开发产物与 AI 记忆目录
├── src/                            ← 游戏源码（15 个 ES Module）
│   ├── ARCHITECTURE.md            ←    硬不变式：「改哪里会炸」（进仓库，见 §2 ⑥）
│   ├── config.js
│   ├── world.js
│   ├── fish.js
│   ├── hook.js
│   ├── save.js
│   ├── game.js
│   ├── input.js
│   ├── audio.js
│   ├── ui.js
│   ├── icons.js
│   ├── story.js
│   ├── narrative.js
│   ├── voyage.js
│   ├── guns.js
│   └── codex.js
├── vendor/
│   └── three.module.js             ← Three.js r160 本地副本（唯一第三方代码，MIT）
├── .dev/                           ← CDP 无头 Chrome 验证 / 出图 / 探针脚本 / 门禁脚本
│   ├── gen-docs.mjs                ←    生成 docs/ 的数值文档（改了 config.js 就跑它）
│   ├── lint-docs.mjs               ←    手写文档的「过期」门禁（退役词 / 计数 / 脚本清单）
│   ├── lint-structure.mjs          ←    源码结构门禁（重名方法 / 重复实现 / 死导出 / 语法 / 空 import）
│   └── archive/                    ← 一次性探针（`_` 前缀），已归档不再参与常规回归
├── shots-v2/                       ← 旧版人工复核截图 22 张（.gitignore 内，不进仓库）
└── .workbuddy-ai/memory/           ← AI 工作记忆与开发日志（.gitignore 内，不进仓库）
```

> ⚠ **`.dev/` 是「部分」进仓库**：`.dev/*.mjs`（脚本本体）与 `.dev/archive/` 都被 git 跟踪；
> 被忽略的只是**跑脚本产生的产物** —— `.dev/profile-*/`（Chrome 用户目录）、`.dev/shots-*/`（出图）、
> `.dev/*.json`、`.dev/*.log`。`shots-v2/` 与 `.workbuddy-ai/` 则整体不进仓库。

---

## 2. 逐文件作用表

### ① 数据层 —— 唯一事实来源

| 文件 | 作用 |
|---|---|
| `src/config.js` | **全项目最重要的文件**。集中定义：`WORLD` 世界尺度 / `CAMERA` / `WATER_STOPS` 水体渐变 / `ALTITUDE_BANDS` + `altitudeAt()` 大气分层 / `ZONES` 25 层海域 + `zonesOfMap()` `zoneAtDepth()`（**mapId 必传，不传抛错**） / `MAPS` 5 张地图 + `mapById()` `mapOfSpecies()` `mapMaxDepth()` / `FISH_DENSITY` `HAZARD_SPAWN` `SPAWN_TOP_MARGIN` / `MODEL_SCALE` / `RARITY` + `rollRarity()` + `valueOf()` / `SCHOOL` 鱼群 / 四个地图机制 `ICEBERG` 浮冰 `HEAT_VENT` 热泉 `WRECK_CELL` 沉船格子 `SIREN` 海妖之歌 / `BEHAVIOR` `TRAIT` `BOSS` / `SEABED` `CHEST` `CHARTS` `BOATS` / `SPECIES` 93 种鱼 / `UPGRADES` + `UPGRADE_ORDER` + `MAX_LEVEL` + `GROWTH` + `upgradeCost()` + `MAP_LEVEL_CAP` + `LEVELS` + `lvAt()` + `upgradeValueText()` / **`GUNS` 8 把枪 × 6 档 + `GUN_ORDER` + `GUN_MAX_LEVEL` + `GUN_GROWTH` + `gunById()` + `gunStats()` + `gunUpgradeCost()`** / `CALLS` + `CALL_GAP` 来电引导 / `DEEP` 深海场景 / **`MAX_PARTICLES` 特效预算** / **`SKY` 天空目标（海鸟 / 飞机 / UFO，血量与身价按图）+ `SKY_MAX_ALIVE` + `SKY_GAP`** / `TUNING` 手感参数 / `SAVE_KEY`。**其它模块一律 import 它，不重复定义数值** |

> 改数值只改这一个文件。改完跑 `node .dev/curves.mjs check` 自检曲线单调性。

### ② 渲染层 —— 3D 世界

| 文件 | 作用 | 依赖 |
|---|---|---|
| `src/world.js` | 场景、正交缩放相机、光照、水体、太空、深海地形（固定种子 PRNG）、暗幕、爆炸与粒子池、船与渔夫（**含 v0.7 的船只皮肤**：金帆 / 货箱堆 / 首装甲板）、**首图海床 + 宝箱**。导出 `World` 类 + 工具函数 `toonMat()` `mergeGeos()` `makeGlowTexture()` | 无本地依赖（最底层） |
| `src/fish.js` | 鱼类造型工厂 `buildFishModel()`（`LatheGeometry` 旋转体 + 卡通阶梯着色 + 特征构件）、六种游动/飞行行为、三轴翻滚、血量、对象池、鱼群生成。**天空目标造型** `buildSkyModel()`（海鸟 / 飞机 / UFO，v0.8；含 `solidFin()` 有厚度的翼面）。导出 `Fish` / `FishManager` / `FISH_STATE` / `buildSkyModel` | `config` `world` |
| `src/hook.js` | 鱼钩与鱼线、渔获串排布 `layoutCatch()`、线段扫掠碰撞 `distToSegment()`。导出 `Hook` | `config` `world` |

### ③ 逻辑层 —— 玩法与反馈

| 文件 | 作用 | 依赖 |
|---|---|---|
| `src/save.js` | **存档层**（v0.8 从 `game.js` 拆出）：默认值 `freshSave()` · 读档迁移 `loadSave()`（**老存档逐字段兜底，全项目最长的函数**）· 落盘 `persist()`。⚠ **不 import `game.js`** —— 存档层不知道游戏的存在 | `config` `world` `story` |
| `src/narrative.js` | **剧情驱动**（v0.8 从 `game.js` 拆出）：来电引导（`pendingCall()` / `_syncCall()` / `_answerCall()` / `_endCall()`）、短信与电台（`_syncSms()` / `smsThreads()` / `smsUnread()` / `markSmsRead()`）、过场（`cutsceneFor()` / `markCutscene()`）、图鉴注脚（`codexNote()`）。⚠ **数据在 `story.js` 与 `config` 的 `CALLS`，驱动在这里** —— 想改剧情别再翻 `game.js`。⚠ 它导出的是一个**类**，方法由 `game.js` **挂到 `Game.prototype`** 上（原型挂载，理由见文件头） | `config` `story` `codex` `save` `audio` |
| `src/voyage.js` | **航线**（v0.8 从 `game.js` 拆出）：地图访问器（`map` / `mapIndex` / `mapCap`）、本图纪录（`_mapBest()` / `mapBestOf()`）、海图（`_charts()` / `hasChart()`）、船厂（`boatList()` / `buyBoat()` / `setBoat()`）、**换图门槛与换图**（`mapProgress()` / `buyMap()` / `enterMap()` / `_goMap()`）、海床宝箱（`_checkChest()` / `_getChart()`）。⚠ **它是一条链**：潜到上一张图底部 → 撞开宝箱拿海图 → 船厂买船 → 航线换图，判定只有 `mapProgress()` 一处。⚠ 同样是**原型挂载**；⚠ `enterMap()` 会调 narrative 的 `_syncSms()` / `cutsceneFor()`，那是**运行期**同原型取用，**不能写成 import**（会成环） | `config` `hook` `save` `audio` |
| `src/guns.js` | **枪械**（v0.8 从 `game.js` 拆出）：枪店侧（`_gunNews()` / `_gunAnnounced()` / `gunUnlocked()` / `gunLockText()` / `gunEntry()` / `_buyGun()` / `_equipGun()` / `_upgradeGun()`）+ **七把枪共用的一条开火管线**（`gun` / `gunLv` / `gunStat` / `_aimPoint()` / `_resetGun()` / `_tapFire()` / `_updateGun()` / `_startReload()` / `_shoot()` 及其 5 个 `mech` 分支 / `_damageInRadius()` / `_applyDamage()` / `_syncGunHud()`）。⚠ **`_hitFish()` 刻意留在 `game.js`** —— 本文件只管"子弹怎么飞、打中了谁"，"被打中之后发生什么"（Boss / 扣钱 / 连击 / 图鉴）属结算。⚠ 同样是**原型挂载** | `config` `world` `fish` `hook` `save` `audio` |
| `src/game.js` | **程序入口**。主循环 + 状态机 `IDLE → DESCEND → ASCEND → AIR → RESULT`、扣钱鱼加权抽签、命中结算（`_hitFish()`）、**天空目标**（`_spawnSky()` / `_updateSky()` / `_applySkyDamage()`，v0.8）、结算 | `world` `fish` `hook` `input` `ui` `audio` `save` `narrative` `voyage` `guns` |
| `src/input.js` | 统一输入层：触屏 / 鼠标 / 键盘 → 归一化坐标与方向键。导出 `Input` | 无 |
| `src/audio.js` | WebAudio 程序化合成音效（振荡器 + 噪声 + 滤波器），**零音频文件、零版权风险**。导出 `SFX` `unlockAudio()` `setMuted()` `isMuted()` | 无 |

### ④ 界面层 —— DOM 覆盖层

| 文件 | 作用 | 依赖 |
|---|---|---|
| `src/ui.js` | HUD、**枪械条**、深度尺、**手机外壳 + 9 个 App**（电话 / 短信 / 渔具店 / 枪店 / 鱼图鉴 / 航线 / **船厂**（要解锁）/ 电台 / 设置）、**来电界面**、结算面板、标题页、飘字。导出 `UI` | `codex` `icons` |
| `src/icons.js` | 内联 SVG 图标库，共 43 个 `GLYPH` + 1 个 `coinIcon`（合计 44 个图标，覆盖 HUD / **9 个 App**（含船厂）/ **7 项升级 + 1 件工具** / **8 把枪** / 场景）。全界面**零 emoji** 靠它兜住。导出 `GLYPH` `glyph()` `iconText()` `coinIcon()` `heartRow()` | 无 |
| `src/codex.js` | 图鉴两级排序（地图 → 海域 → 身价）+ canvas 2D 程序化鱼图标（彩色 / 黑色剪影共用同一套特征参数）。导出 `codexOrder()` `groupByMap()` `zoneLabel()` `mapLabel()` `drawFishIcon()` | `config` |

### ⑤ 载体层

| 文件 | 作用 |
|---|---|
| `index.html` | 唯一入口：竖屏容器、importmap、HUD 骨架、手机层、结算层；加载 `src/game.js` |
| `styles.css` | 竖屏布局、HUD、深度尺、手机外观与 App、图鉴、结算面板；世界界面明暗主题用 `[data-theme="light"]` 切换 |
| `vendor/three.module.js` | Three.js r160 本地化副本（压缩产物）。**唯一的第三方代码**，MIT 许可，见文件头声明 |

<!-- LOC:BEGIN — 由 .dev/loc.mjs 生成，不要手改（改了文件跑 `node .dev/loc.mjs`）-->
### 体积快照

**代码**（自有，合计 14,886 行）

| 文件 | 行数 |
|---|---:|
| `src/config.js` | 2,478 |
| `styles.css` | 2,304 |
| `src/world.js` | 2,251 |
| `src/game.js` | 2,135 |
| `src/ui.js` | 1,655 |
| `src/fish.js` | 1,142 |
| `src/guns.js` | 505 |
| `src/codex.js` | 402 |
| `src/icons.js` | 380 |
| `src/voyage.js` | 343 |
| `src/narrative.js` | 249 |
| `src/save.js` | 242 |
| `src/story.js` | 210 |
| `src/hook.js` | 194 |
| `src/audio.js` | 164 |
| `index.html` | 149 |
| `src/input.js` | 83 |

**文档**（合计 7,529 行；`STRUCTURE.md` 本文不计 —— 它会被本脚本改写，写进去就成自指循环了）

| 文件 | 行数 |
|---|---:|
| `DESIGN.md` | 3,327 |
| `EXPANSION.md` | 1,004 |
| `GAMEPLAY.md` | 911 |
| `README.md` | 788 |
| `docs/05-剧情与世界观.md` | 426 |
| `docs/02-鱼类图鉴.md` | 282 |
| `docs/06-枪械.md` | 218 |
| `docs/04-物理与经济.md` | 193 |
| `docs/01-世界与地图.md` | 153 |
| `docs/03-升级与成本.md` | 128 |
| `docs/README.md` | 99 |

> 另有 `vendor/three.module.js`（第三方 Three.js r160，53,044 行）—— 不计入上表。
> 行数**由 `.dev/loc.mjs` 生成**，不是手写的：手写的派生数据一定会漂（这张表曾经 13 个数字全过期）。
<!-- LOC:END -->

### ⑥ 文档层

| 文件 | 读者 | 内容 |
|---|---|---|
| `README.md` | 玩家 / 使用者 | 玩法三段式循环、手机界面（9 个 App，含船厂）、**电话引导**、7 项升级 + 1 件工具、**8 把枪与枪店**、图鉴、本地运行、GitHub Pages 三种部署方式、技术要点、开发辅助脚本清单 |
| `DESIGN.md` | 开发者 | 原作玩法拆解、坐标系、状态机、数值设计、验收标准 + **迭代 1~11 全过程踩坑记录** |
| `EXPANSION.md` | 规划者 | 3 地图 / 56 鱼 / 8 枪 / 弱剧情的扩建方案 + 分 8 批的落地路线（批 1~3 已完成，**批 4 是下一步**）。⚠ 全文分「现状（实测）/ 目标 / 待定 / 更远期」四种状态标记 |
| `GAMEPLAY.md` | 策划 / 平衡调整者 | **玩法设计文档**：设计目标与核心体验、机制构成、系统联动、数值与平衡思路、解锁节奏与引导、**风险点清单**。含一段由 `.dev/pace.mjs` 生成的「节奏验算」 |
| `STRUCTURE.md` | 接手者 / AI | 本文：文件分层与作用 |
| **`src/ARCHITECTURE.md`** | 接手者 / **AI** | **硬不变式清单 ——「改哪里会炸」**：分区必带 mapId / 加枪要做两件事 / 浮冰弹开要搬 `targetX` / 稀有度光晕不进材质缓存 / 换图门槛…，**每条附一条守着它的断言位置**。 ⚠ **它进仓库**（原先这些只写在 `.workbuddy-ai/memory/MEMORY.md`，而那目录被 `.gitignore` 忽略 → **clone 的人/AI 一条都读不到**）。受 `lint-docs.mjs` 的 A/D 两关约束 |
| `ARCHITECTURE-REVIEW.md` | 接手者 / AI | **架构评审快照**（2026-09-20）：重复代码 / 过期文档 / 退役机制残留 / 上帝对象拆解建议 + 执行顺序。⚠ **一次性的**，修完对应条目就过期；**不受 `lint-docs.mjs` 与 `loc.mjs` 约束**，别把它当成需要维护的文档 |
| `docs/`（7 份） | 调数值 / 写文案的人 | **唯一的数值与文案参考**。`README.md` 是手写索引；`01~06` **由 `.dev/gen-docs.mjs` 从 `src/config.js` 生成** —— 手改会被下次生成覆盖 |

> **为什么单独拆出 `docs/`**：README / DESIGN 里长期手抄了一份数值副本，
> 导致反复出现「文档写 9 条鱼、代码其实 18 条」这类漂移（历史上一共抓到 4 批）。
> 现在数值**只有 `config.js` 一处**，`docs/01~06` 是它的自动投影；
> `node .dev/gen-docs.mjs check` 一跑就知道文档有没有过期。

### ⑦ 辅助层（均不进仓库正文）

| 路径 | 规模 | 作用 |
|---|---|---|
| `.dev/` | 详见 §3 | CDP 无头 Chrome 真跑游戏的验证 / 出图 / 探针脚本。**脚本本体进仓库**，产物（`profile-*/` `shots-*/` `*.json` `*.log`）进 `.gitignore`。⚠️ 总数**刻意不写**：加一个探针就要来改一次数字，而这个项目已经因为手抄派生数据翻过四次车 —— 要数就 `ls .dev/*.mjs \| wc -l` |
| `docs/` | 7 份 md | 数值与剧情参考文档（**01~06** 由 `.dev/gen-docs.mjs` 生成；`README.md` 是手写索引），详见 §2 ⑥ |
| `shots-v2/` | 22 张 PNG，约 1.75 MB | 旧版人工复核截图（已在 `.gitignore`） |
| `.workbuddy-ai/memory/` | 每日日志 + `MEMORY.md` | AI 工作记忆与开发日志（已在 `.gitignore`）。⚠️ 文件数每天在变，**不写死** |
| `.nojekyll` / `.gitignore` | — | GitHub Pages 免 Jekyll；忽略开发产物、Chrome profile、AI 记忆目录 |

---

## 3. `.dev/` 内部五类细分

| 类别 | 文件 | 说明 |
|---|---|---|
| **回归断言（14 套）** | `verify3~16.mjs` | 主力回归。批 1 → `verify7`，批 2 → `verify8`，批 3（枪械）→ `verify9`，**批 4（第 3 张图 + 热泉 + 耐压舱 + 榴弹枪）→ `verify10`**，**批 7（鱼的行为模式 / 特殊状态 / Boss）→ `verify11`**，**批 5（剧情：短信 / 电台 / 过场 / 图鉴注脚）→ `verify12`**，**批 6（特效 12 项）→ `verify13`**，**终章（创世之音 + 结局）→ `verify14`**，**批 8（第 4 张图 + 沉船格子）→ `verify15`**，**批 8b（第 5 张图 + 海妖之歌）→ `verify16`**，批 v0.5（删 4 项 + 重做铅坠/绞盘）→ `verify3/7/9` 增量，批 v0.6（来电引导）→ `verify6` 增量，批 v0.6 第一批风险处置（分段解锁 / 内容门槛 / 超时鱼 / 夹具门禁）→ `verify3/6/7/8` 增量。当前 **verify3 34 + verify4 25 + verify5 34 + verify6 63 + verify7 47 + verify8 51 + verify9 52 + verify10 25 + verify11 26 + verify12 18 + verify13 16 + verify14 17 + verify15 16 + verify16 18 = 442 条全绿** |
| **已失效（1 套）** | `.dev/verify.mjs` | 迭代 2 的 31 条基线。**从 v0.4 起就是坏的** —— 它引用 `g.blast`，而枪械系统早就删了那个字段。⚠ 跑全部回归时**不要把它算进去**，否则会误以为代码坏了；要么按当前 API 重写，要么保持忽略 |
| **夹具（1 个共享模块）** | `fixtures.mjs` | 回归脚本共用的**完整存档夹具构造器**（`levelsOf` / `gunLevelsOf` / `saveOf`）。**不许手写 `levels` 字面量** —— 这个项目被"手写夹具漏键"坑过两次（症状是"不报错、不闪退，只是鱼再也钓不上来"）。门禁 = `verify7` 的 **A9**：扫全部 `.dev` 脚本，`levels: {` 必须来自构造器、或含展开 `...`、或带 `@partial-save` 标记 |
| **数值验算（4 套）** | `curves.mjs` · `balance.mjs` · `balance-v2.mjs` · **`pace.mjs`** | 升级曲线自检/导出、AI 代理玩家手感抽样、经济模型离线模拟、**玩法节奏验算**（逐竿推进模拟「升一级要几竿 / 换图门槛哪个先松」，结果写进 `GAMEPLAY.md`；生成前先跑 `assertLevelAnchors()` 与 `assertGateReachable()` 两组**会挂**的结构断言） |
| **文档生成（3 套）** | `gen-docs.mjs` · `loc.mjs` · `pace.mjs` | `gen-docs.mjs`：**从 `src/config.js` 生成 `docs/01~06`**。`loc.mjs`：**把各文件行数生成进本文的「体积快照」**（手写的行数曾经 13 个数字全过期）。`pace.mjs`：**把节奏验算表生成进 `GAMEPLAY.md`**。三者的 `check` 子命令都只校验不写盘，不一致则退出码 1 |
| **文档门禁（1 套）** | `lint-docs.mjs` | **手写文档的「过期」门禁**（`GAMEPLAY.md` §6.3 C1 的长期方案）。上面那 3 套只管**生成出来的** `docs/01~06`；`README` / `GAMEPLAY` / `STRUCTURE` / `EXPANSION` 是**手写**的，生成器全绿也证明不了它们没错（这个项目从它们身上抓过 **6 批**过期数字）。三关：**A 退役词**（`许可证` / `声呐` / `加固` / `gunPower`…不得以"现在时"出现；带退役标记的行放行）/ **B 计数**（文档里写的条数 / 十四套回归合计 vs 源码实测）/ **C 清单**（`.dev` 下的脚本都得在 README 的表里）。**只读不写** —— 这些数字嵌在**散文**里，机器改散文比人写更容易改坏；**锚点失配也算失败**，防止门禁悄悄退化成空过 |
| **结构门禁（1 套）** | `lint-structure.mjs` | **源码结构门禁**：把几类「不报错、不闪退、静默失效」的缺陷变成会挂掉的断言 —— **① 类内重名方法**（JS 里后一个**静默覆盖**前一个，B11 散弹枪 / B13 榴弹枪同型）/ **② 逐字重复的函数体**（危险是**反向**的：后来人改第一份、测试通过，线上行为没变）/ **③ 无人引用的导出** / **④ 语法**（按 ES Module 解析 —— `node --check <文件>` 对本项目的 `.js` **是哑的**，见脚本内注释）/ **⑤ 空 import**（拆模块的必然残留，且它会**掩盖 ③**：只要还有人 import，那个死导出就永远显示为"被引用过"）。**纯 Node、只读不写**，不用起服务器。⚠ 自带**尺子自检**：扫描规模低于下限、或「去注释前后行数不一致」（会让配平行号错位、整关空过）都直接判失败 —— 门禁自己空过比没有门禁更糟；⚠ ④ 关需要 `spawn` 子进程，**起不了时会明确打印"跳过"而不是假装通过** |
| **出图复核** | `shots2/3/4/5-fish/5-ui/6` · `shots-icons` · `shots-shop` · `shots-polar` · `shots-guns` · **`shots-phone`** · `boom`<br>`.dev/archive/` 下：`_shots-v02` · `_shots-v05`（删 4 项 + 铅坠/绞盘）· `_shots-call`（来电引导） | 断言测不到"好不好看"，靠这些出图人工复核 |
| **诊断探针 / 一次性** | `smoke.mjs` · `probe-coin/coinfit/d1/emoji/roww.mjs`（在 `.dev/` 根）<br>`.dev/archive/` 下：`_dbg` · `_probe-air/aurora/codex/roww2/slow/`**`shotgun`** · `_measure-`**`a4`**`/a10/first-batch` · `_splice-wide/cost` | 定位静默失败、字体缺字形、宽度挤压等问题的一次性脚本。**带 `_` 前缀的已归档到 `.dev/archive/`**（不再参与常规回归），路径仍按**项目根**解析 —— 跑法为 `node .dev/archive/_xxx.mjs`。⚠️ `_splice-*.mjs` 会覆写 `DESIGN.md` / `EXPANSION.md` 的表格，非必要勿跑；其中 `_splice-wide.mjs` 的锚点已随 `EXPANSION.md` 重写而消失（跑了会**先抛错再动手**，不会改坏文档）。⚠️ `_measure-a4.mjs` 的正式版已搬进 `gen-docs.mjs`，**改数值后重算请跑 `gen-docs`**；`_probe-shotgun.mjs` 是 B11 的实测现场，其正式断言版本已落地（`verify9` **C9b**） |

> **完整清单**（逐个脚本的一句话作用）见 [`README.md` 的「开发辅助」](./README.md#开发辅助)；本表只做归类 ——
> 这里**刻意不写脚本总数**：加一个探针就要来改一次数字，而这个项目已经因为手抄派生数据翻过四次车。
> 下表用简写（如 `verify3~8.mjs` 指 `verify3.mjs` 到 `verify8.mjs` 共 6 个）。

**跑法**（先另开终端起静态服务器）：

```bash
python -m http.server 8899
node .dev/verify8.mjs http://127.0.0.1:8899/index.html
node .dev/curves.mjs check        # 改完 config.js 数值看这个
node .dev/gen-docs.mjs check      # 改完 config.js 数值 → 校验 docs/ 有没有跟着过期
node .dev/pace.mjs                # 改完 config.js 数值 → 重算 GAMEPLAY.md 的「节奏验算」
                                  #   ⚠ 生成前会跑两组**会挂**的结构断言：等级闸门锚点（B3）
                                  #     与内容门槛双侧平衡（A10：既不能形同虚设、也不能成为主墙）
node .dev/loc.mjs check           # 改完任何文件 → 校验本文的「体积快照」有没有跟着过期
                                  #   ⚠ 顺序：pace.mjs 会改写 GAMEPLAY.md 的行数，所以它必须排在 loc.mjs 之前
node .dev/lint-docs.mjs           # 改完任何**文档** → 校验手写的四份有没有过期数字 / 退役词 / 漏登记的脚本
                                  #   ⚠ 只读不写：发现漂移请人改（数字嵌在散文里），改完重跑
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

> ⚠ **v0.8 起 `save.js` / `narrative.js` / `voyage.js` / `guns.js` 已从 `game.js` 拆出**
> （四刀都是"零行为变化"的搬迁，合起来 `game.js` 3,195 → 2,100 行上下）：
> · `save.js`：`freshSave` / `loadSave` / `persist` 三个**模块级纯函数**（约 224 行，零 `this.`）；
> · `narrative.js`：剧情驱动的 15 个**类方法**（约 209 行）；
> · `voyage.js`：航线的 17 个成员（地图 / 海图 / 船厂 / 宝箱，约 300 行）；
> · `guns.js`：枪械的 27 个成员（枪店 + 开火管线，约 460 行）。
>
> 后三者是**原型挂载**：它们导出**类**，`game.js` 在类定义之后用 `mountMixin()` 把方法逐个
> `defineProperty` 到 `Game.prototype` 上（⚠ **不能**用 `Object.assign`：类方法是**不可枚举**的，
> `assign` 会**静默**一个都拷不过去；⚠ 同名方法会被 `defineProperty` **悄悄覆盖**，
> 所以"搬走的方法在 `game.js` 里还留着定义"必须当成错误 —— 搬迁脚本里有断言挡它）。
>
> 四者都只依赖更低层（`config` / `world` / `fish` / `hook` / `story` / `codex` / `audio` / `save`），
> **不 import `game.js`，彼此之间也不互相 import** —— 上面那张图里的 `game.js` 一格现在等价于
> `game.js + save.js + narrative.js + voyage.js + guns.js`。
> ✅ **架构评审 §6 第 4 步列的四刀到此全部拆完**（顺序：`save` → `narrative` → `voyage` → `guns`）。

---

## 5. 改动落点速查

| 想改什么 | 改哪里 |
|---|---|
| ⚠ **先看这个：改哪里会炸 / 硬不变式** | [`src/ARCHITECTURE.md`](./src/ARCHITECTURE.md)（每条附守着它的**断言位置**） |
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
| **玩法节奏 / 平衡性 / 换图门槛够不够硬** | 先看 [`GAMEPLAY.md`](./GAMEPLAY.md) 的第六章风险清单；要重算节奏跑 `node .dev/pace.mjs` |

---

## 6. 维护约定

1. **新增数值一律进 `config.js`**，不要在 `game.js` / `ui.js` 里写魔法数字。**改完数值跑一次 `node .dev/gen-docs.mjs`** —— `docs/` 里的数字是自动生成的，不跑就过期了。
2. **文档里不要手抄数值**：需要数据时链接到 `docs/`。手抄副本是这个项目历史上 4 批文档漂移的根因。
3. **依赖不回头**：低层模块（`config` / `world` / `icons` / `audio` / `input`）不 import 高层模块。
4. **`.dev/` 新脚本命名**：常规回归用 `verifyN.mjs`，出图用 `shotsN-*.mjs`；一次性探针加 `_` 前缀并放进 **`.dev/archive/`**。
   ⚠️ 所有 `.dev` 脚本的路径都按**项目根（`process.cwd()`）**解析，必须在项目根执行，例如 `node .dev/verify8.mjs`。
5. **新增文件后同步本文 §1 目录树与 §2 作用表**，并检查 README「文件结构」是否需要更新。
6. **`docs/README.md` 与 `DESIGN.md` / `EXPANSION.md` 是手写的，`docs/01~06` 是生成的** —— 改文档前先确认自己在改哪一类。
7. **`.dev/profile-*` 是每次跑 verify 时 Chrome 自动生成的临时用户目录**，已被 `.gitignore` 覆盖；占盘很大（历史峰值 217 个目录 / 约 5.6 GB），可随时整批删除，下次运行会重建。
