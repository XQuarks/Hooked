# `.dev/archive/` —— 一次性探针归档

这里的脚本都是**一次性**的：探针（排查具体问题）、补丁（改 `src/` 的临时脚本）、测量（只读数值）。
用完就不再需要，但留着可以当"当时的思路记录"。它们**不在常规回归链里**，改代码后不需要跑。

> ⚠ **这里刻意不写脚本总数** —— 手写的派生数据一定会漂（这张表原来写着"9 个"，
> 后来涨到四十多个也没人改）。下表只登记**有留存价值**的那些。

| 脚本 | 当时要查什么 |
|---|---|
| `_dbg.mjs` | 早期临时调试入口（无头部注释） |
| `_probe-air.mjs` | 空中相机是不是真的锁定了「最低的非扣钱鱼」并推近 |
| `_probe-aurora.mjs` | 极光的加色混合有没有生效（直接读像素，比"看着像暗条"靠谱） |
| `_probe-codex.mjs` | 图鉴 App 打开时的异常与 DOM 实际结果 |
| `_probe-roww2.mjs` | 商店每一行「文字实际宽度 vs 可用宽度」，谁把宽度吃掉了 |
| `_probe-slow.mjs` | 复现 C3 减速实测比值为什么是负的 |
| `_shots-v02.mjs` | v0.2 世界整体 ×2 之后的观感复核出图 |
| `_splice-wide.mjs` | 用 `curves.mjs wide` 的输出替换 `EXPANSION.md` 2.2 的宽表 |
| `_splice-cost.mjs` | 用 `curves.mjs costtable` 的输出替换 `DESIGN.md` 的单级成本表 |
| `_measure-a4.mjs` | **A4 的"输出上限余量"离线模型**：逐帧复刻 `_updateGun` / `_shoot`。⚠ 它的正式版已经搬进 `.dev/gen-docs.mjs`（`gunOutputCeiling()`），**改数值后要重算请跑 `gen-docs`，不要跑这个** —— 留着只是"口径的原始记录" |
| `_probe-shotgun.mjs` | **B11 的实测**：散弹枪一次开火到底有几个爆炸圈（数 `world.burstExplosion` 与 `_shootShotgun` 的调用次数）。修复前 **1 / 0**、修复后 **6 / 1**。✅ 它的正式断言版本已经落地（`verify9` 的 **C9b**），这个探针留着只是"当时的现场" |
| `_probe-lint.mjs` | **C1 的探路**：先量"扫所有被反引号包着、但仓库里找不到的标识符"这条路的**误报率** —— 12 份文档命中 **54 处**，绝大多数是**正确引用**（真实文件 `.nojekyll`、`EXPANSION` 的规划词 `cruise`/`rifle`、`DESIGN` 的"已删除清单"）。**结论：这条路不可用**，门禁改走"退役词表 + 计数交叉核对"（`.dev/lint-docs.mjs`）。留着是"**为什么没选那条路**"的记录 |

> 另外还有两类**不登记**的一次性脚本：
> ① `_patch-*.mjs` / `_p1.._p12-*.mjs`（改 `src/` 的补丁脚本，改完即弃）；
> ② `_measure-a10.mjs` / `_measure-first-batch.mjs`（早期只读测量）。

## 跑法

所有脚本的路径都按**项目根（`process.cwd()`）**解析，所以必须在项目根执行：

```bash
node .dev/archive/_probe-roww2.mjs http://127.0.0.1:8899/index.html
```

## ⚠️ 注意

`_splice-wide.mjs` 和 `_splice-cost.mjs` 会**直接覆写 `EXPANSION.md` / `DESIGN.md` 的表格**，
且是按行号切片替换 —— 文档结构一变就会定位失败或改错位置。**除非明确要同步数值表，否则不要跑。**

完整的分层说明见项目根目录的 [`STRUCTURE.md`](../../STRUCTURE.md)。
