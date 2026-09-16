# `.dev/archive/` —— 一次性探针归档

这里的 9 个脚本都是**排查具体问题时写的一次性探针**，问题定位完就不再需要，但留着可以当"当时的思路记录"。
它们**不在常规回归链里**，改代码后不需要跑。

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

## 跑法

所有脚本的路径都按**项目根（`process.cwd()`）**解析，所以必须在项目根执行：

```bash
node .dev/archive/_probe-roww2.mjs http://127.0.0.1:8899/index.html
```

## ⚠️ 注意

`_splice-wide.mjs` 和 `_splice-cost.mjs` 会**直接覆写 `EXPANSION.md` / `DESIGN.md` 的表格**，
且是按行号切片替换 —— 文档结构一变就会定位失败或改错位置。**除非明确要同步数值表，否则不要跑。**

完整的分层说明见项目根目录的 [`STRUCTURE.md`](../../STRUCTURE.md)。
