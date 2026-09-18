/**
 * fixtures.mjs — 回归脚本共用的**夹具构造器**
 *
 * 为什么要有这个文件：
 *   这个项目被"手写的 `levels` 夹具漏键"坑过**两次**：
 *     ① verify5 手写的 5 键夹具（升级项从 5 项扩到 11 项之后没跟上）；
 *     ② v0.4 加枪械时，手写的 `save` 少了 `guns` 字段。
 *   症状都是**不报错、不闪退**：`lvAt` 拿到 `undefined` 会钳到 0，
 *   于是 NaN 顺着 `hook.y += ascendSpeed * dt` 一路污染物理 —— **只是鱼再也钓不上来**。
 *   排查成本极高，所以现在**不许手写**：一律用这里的构造器。
 *
 * 门禁：**`verify7` 的 A9** 会扫所有 `.dev/**` 下的 `.mjs`（跳过浏览器 profile 目录），
 *      任何 `levels: {` 字面量必须满足其一，否则回归挂掉：
 *        ① 写成 `levels: levelsOf({...})`（推荐：键集跟着 `UPGRADE_ORDER` 现铺）
 *        ② 行内含展开 `...`（叠加在完整夹具之上，如 `{ ...base.levels, x: 1 }`）
 *        ③ 带 `@partial-save` 注释标记（**故意残缺**：抗残缺存档测试要用）
 *
 *      为什么值得一条断言：漏键的症状是**不报错、不闪退，只是鱼再也钓不上来**。
 *      实测抓到的第一例就是 `verify5` 里那份 11 项的手写列表 —— 它还留着 v0.5
 *      已经删掉的 power / insurance / sonar / rig，靠"多余的键被忽略"蒙混过关。
 */
import { UPGRADE_ORDER, GUN_ORDER } from '../src/config.js';

/**
 * 完整的升级等级夹具。**键集永远跟着 `UPGRADE_ORDER` 走** ——
 * 加/删升级项时这里自动跟上，不会漏。
 * @param {Record<string, number>} over 想覆盖的项（其余为 0）
 */
export const levelsOf = (over = {}) =>
  Object.fromEntries(UPGRADE_ORDER.map((k) => [k, over[k] ?? 0]));

/** 完整的枪械等级夹具（键集跟着 `GUN_ORDER` 走） */
export const gunLevelsOf = (over = {}) =>
  Object.fromEntries(GUN_ORDER.map((id) => [id, over[id] ?? 0]));

/**
 * 一份完整的存档夹具。**所有字段都给全**，`over` 只用来覆盖想改的那几项。
 * @param {object} over 深合并一层（levels / guns 会分别合并）
 */
export const saveOf = (over = {}) => {
  const base = {
    coins: 0, bestDepth: 0, bestAlt: 0, casts: 0, totalEarned: 0,
    levels: levelsOf(),
    muted: false,
    codex: {},
    currentMap: 'calm-bay',
    licenses: [],
    mapBest: {},
    guns: { owned: [], current: GUN_ORDER[0], levels: gunLevelsOf() },
    drop: { on: false, depth: 0 },
    calls: [],
    lastCallCast: -999,
  };
  const out = { ...base, ...over };
  if (over.levels) out.levels = { ...base.levels, ...over.levels };
  if (over.guns) out.guns = { ...base.guns, ...over.guns, levels: { ...base.guns.levels, ...(over.guns.levels || {}) } };
  if (over.drop) out.drop = { ...base.drop, ...over.drop };
  return out;
};
