/**
 * save.js — 存档：默认值 / 读档迁移 / 落盘
 *
 * 为什么单独一个文件：`loadSave()` 是这个项目**最长的一个函数**（约 140 行），
 * 而它几乎全部是「老存档逐字段迁移 + 兜底」—— 和主循环、状态机没有任何关系。
 * 它原先埋在 `game.js` 里，于是"想改读档逻辑该翻哪里"只能靠猜。
 *
 * ⚠ 依赖方向：本文件只依赖 `config` / `world` / `story`（都是更低层），
 *   **不 import `game.js`** —— 存档层不知道游戏的存在。
 * ⚠ **改这里之前先看 `ARCHITECTURE.md` §9**：删字段不换 key · "表可能不存在"要包一层 ·
 *   加等级项要 grep 所有手写夹具。
 */
import { clamp } from './world.js';
import {
  UPGRADE_ORDER, maxLvOf, SAVE_KEY, DEFAULT_MAP, MAPS, mapById,
  GUNS, GUN_ORDER, GUN_MAX_LEVEL, CALLS, CHARTS, boatById,
} from './config.js';
import { SMS } from './story.js';

// ─────────────────────────────────────────────────────────────
// 存档
// ─────────────────────────────────────────────────────────────
export const freshSave = () => ({
  coins: 0, bestDepth: 0, bestAlt: 0, casts: 0, totalEarned: 0,
  // 等级表由 UPGRADE_ORDER 生成 —— 加升级项时只改 config，不会漏掉存档字段
  levels: Object.fromEntries(UPGRADE_ORDER.map((k) => [k, 0])),
  muted: false,
  // 图鉴：{ [speciesId]: { n: 钓到次数, best: 最高身价 } }
  codex: {},
  // 玩家当前在哪片海。**这是"当前地图"的唯一真相** ——
  // 以前各处直接读 DEFAULT_MAP，多地图之后必须改成读它（见 Game.map）。
  currentMap: DEFAULT_MAP.id,
  // ⚠ **@retired 字段**：许可证机制 v0.7 第二批退役之后，`_licenses()` / `buyMap()` / `enterMap()`
  //   里的许可证分支已于 2026-09-20 全部删除 —— 进图门槛只剩「**海图 + 船**」。
  //   这个字段**恒为空数组、全项目没有任何读者**，留着只是为了老存档与回归夹具里的 `licenses` 不炸。
  //   ⚠ **任何新判定都不许读它**：当年 `_callReady` 读它，两通电话**永远不响**，
  //     而 296 条断言一条都没拦住（GAMEPLAY §6.2 B10 的病灶就是它）。
  licenses: [],
  // 每张图各自到过的最深处 { [mapId]: 米数 }。
  // bestDepth 仍是"全游戏最深记录"（结算面板用），换图条件②要的是**本图**的，
  // 两者不能混 —— 否则在冰封极地潜到 600m 会顺手满足宁静海湾的换图条件。
  mapBest: {},
  // ── 枪械（v0.4）──
  //   owned   已买下的枪 id（初始手枪不在这里，它永远可用）
  //   current 当前装备的枪 id —— **这是"当前枪械"的唯一真相**
  //   levels  每把枪各自的等级（0 ~ GUN_MAX_LEVEL）
  //
  // ⚠ 为什么不把枪械等级塞进 `levels` 那张表：那张表的键是**升级项**（鱼线/鱼钩/…），
  //   走 lvAt() 取绝对值曲线；枪械等级是"这把枪自己的档位"，取值走 gunStats()。
  //   两张表混在一起，加一把枪就会让 `lvAt` 的越界钳制把枪械等级当成升级等级。
  guns: { owned: [], current: GUN_ORDER[0], levels: Object.fromEntries(GUN_ORDER.map((id) => [id, 0])) },
  // ── 铅坠·直达深度（v0.5）──
  //   on    这一竿开竿时要不要跳过一段下潜
  //   depth 玩家指定的目标深度（正数米，实际会被钳到 [DROP_MIN_DEPTH, dropDepthCap]）
  //
  // ⚠ 这是**玩家偏好**而不是装备等级，所以不放进 `levels`：
  //   `levels` 的每一项都对应一条 LEVELS 曲线，而这两个是"开关 + 一个数"。
  //   混进去的话 lvAt() 会把它们当成曲线名去查表，直接抛错。
  drop: { on: false, depth: 0 },
  // ── 来电引导（v0.6）──
  //   calls        已听过的电话 id（听完就不再响）
  //   lastCallCast 上一通电话发生在第几竿 —— 用来实现"两通之间至少隔 CALL_GAP 竿"
  calls: [],
  lastCallCast: -999,
  // ── 海图 / 船只（v0.7；海图 v0.8 推广到多图）──
  //   charts   已拿到的**海图 id 表**（`{ polar: true, lava: true }`），见 config 的 CHARTS
  //   boatApp  船厂 App 是否已解锁（第 10 竿的电话 或 钓到海图时解锁）
  //   boats    { owned: 已买下的船 id[], current: 当前用的那艘 }
  //
  // ⚠ v0.8（批 4）：从 `chart: boolean` 改成 `charts: { id: true }` ——
  //   第 3 张图的门槛要用「冰封极地底部的熔岩海图」，一个 boolean 装不下两张图。
  //   老存档的 `chart === true` 在读档时迁移成 `{ polar: true }`（见 loadSave）。
  //   **换名而不是换类型**是刻意的：`!!this.save.charts` 会永远为真（对象恒真），
  //   那种"改完不报错、只是门槛永远满足"的静默失败最难查。
  //   换名之后忘改的地方会直接抛 `undefined`，一眼就能定位。
  charts: {},
  boatApp: false,
  boats: { owned: [], current: null },
  // 未读"新枪上架"（v0.7 第三批）：枪店分段解锁之后，一把枪从"锁着"变"可见"时记进来，
  // 玩家**点开枪店**才清空 —— 手机红点 / 枪店 App 红点 / 推送横幅读它。
  gunNews: [],
  // 播报**过**的新枪（不清空）：驱动店里那枚「NEW」角标，
  // 一直挂到那把枪被买下为止（owned 之后 isNew 自然为 false）。
  gunAnnounced: [],
  // ── 剧情（批 5）──
  //   sms       已经发过的短信 id（每条只发一次）
  //   smsSeen   上次打开短信 App 时已有多少条 —— 未读数 = sms.length − smsSeen
  //   seenCut   已经看过过场的地图 id（每张图只放一次）
  //   hazards   累计钓到的扣钱鱼条数（短信的触发条件之一）
  //   bossKills 累计击败的 Boss 数（结局短信看它）
  sms: [], smsSeen: 0, seenCut: [], hazards: 0, bossKills: 0,
  // beatGame 是否已经通关（打过终章 Boss）—— 标题 / 手机上会显示一个标记
  beatGame: false,
});

export function loadSave() {
  const s = freshSave();
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      s.coins = Number(raw.coins) || 0;
      s.bestDepth = Number(raw.bestDepth) || 0;
      s.bestAlt = Number(raw.bestAlt) || 0;
      s.casts = Number(raw.casts) || 0;
      s.totalEarned = Number(raw.totalEarned) || 0;
      s.muted = !!raw.muted;
      for (const k of UPGRADE_ORDER) {
        // ⚠ 钳到**该项自己的上限**（maxLvOf）而不是 MAX_LEVEL：
        //   一次性工具（绞盘）的上限是 1，用 MAX_LEVEL 会让手改存档把它写成 20，
        //   于是商店显示一个"已拥有但 Lv.20"的错位状态。
        s.levels[k] = clamp(Math.round(Number(raw.levels?.[k]) || 0), 0, maxLvOf(k));
      }
      if (raw.codex && typeof raw.codex === 'object') {
        for (const [id, v] of Object.entries(raw.codex)) {
          const n = Math.max(0, Math.round(Number(v?.n) || 0));
          const best = Math.max(0, Math.round(Number(v?.best) || 0));
          if (n > 0) s.codex[id] = { n, best };
        }
      }
      // ⚠ 这是 **@retired 字段**的迁移，**保留只为不丢老存档里的数据** ——
      //   全项目没有任何判定读 `s.licenses`（详见 `freshSave` 里那段说明）。
      //   别照着这一段去写新的许可证逻辑。
      if (Array.isArray(raw.licenses)) {
        s.licenses = raw.licenses.filter((x) => typeof x === 'string');
      }
      // ⚠ 存档里的地图 id 可能是**已经不存在的地图**（改名 / 删图 / 手改存档），
      //   mapById 会退回第一张，这里存回它的 id，免得每次读档都要兜一次。
      s.currentMap = mapById(raw.currentMap).id;
      if (raw.mapBest && typeof raw.mapBest === 'object') {
        for (const [id, v] of Object.entries(raw.mapBest)) {
          const d = Math.max(0, Math.round(Number(v) || 0));
          if (d > 0 && MAPS.some((m) => m.id === id)) s.mapBest[id] = d;
        }
      }
      // 老存档迁移（v0.1 只有全局 bestDepth，没有 per-map 的表）。
      // 把全局纪录当成初始地图的纪录补进去 —— 否则老玩家回来会发现大标题
      // 从「已探索至 −430m」退回「可下潜至 −430m」、航线 App 的深度条件也变红，
      // 看起来像进度被清了。只在表是空的时候补，不会覆盖真实数据。
      if (!Object.keys(s.mapBest).length && s.bestDepth > 0) {
        s.mapBest[DEFAULT_MAP.id] = Math.round(s.bestDepth);
      }
      // ── 枪械：逐字段兜底，任何一项坏掉都不影响其它项 ──
      // ⚠ v0.4 之前的老存档整个 `guns` 字段都不存在 —— 上面的 freshSave() 已经铺好了
      //   默认值（手枪 + 全 0 级），这里只覆盖"读得出来的"部分。
      //   verify9 的 D4 专门盯这条路径。
      const rg = raw.guns;
      if (rg && typeof rg === 'object') {
        if (Array.isArray(rg.owned)) {
          // 只保留**现在还存在的枪 id**：删过枪 / 改过 id 的存档不会留下一堆幽灵
          s.guns.owned = rg.owned.filter((x) => typeof x === 'string' && GUNS.some((g) => g.id === x));
        }
        if (typeof rg.current === 'string' && GUNS.some((g) => g.id === rg.current)) {
          s.guns.current = rg.current;
        }
        if (rg.levels && typeof rg.levels === 'object') {
          for (const id of GUN_ORDER) {
            s.guns.levels[id] = clamp(Math.round(Number(rg.levels[id]) || 0), 0, GUN_MAX_LEVEL);
          }
        }
      }
      // current 指向一把没买的枪（手改存档 / 上面被过滤掉了）→ 退回手枪。
      // 不兜这一下的话，玩家会拿着一把"没拥有却能开火"的枪，枪店里还看不到它。
      if (s.guns.current !== GUN_ORDER[0] && !s.guns.owned.includes(s.guns.current)) {
        s.guns.current = GUN_ORDER[0];
      }
      // （未读新枪的迁移挪到了下面 chart / boats 兜底之后 —— 它要先知道"到过哪张图"）
      // ── 铅坠·直达深度：逐字段兜底（老存档整个 drop 字段都不存在）──
      const rd = raw.drop;
      if (rd && typeof rd === 'object') {
        s.drop.on = !!rd.on;
        s.drop.depth = Math.max(0, Math.round(Number(rd.depth) || 0));
      }
      // ── 来电引导：同样逐字段兜底，并且**只保留现在还存在的电话 id** ──
      // （删过一通电话 / 改过 id 的存档不会留下幽灵条目）
      if (Array.isArray(raw.calls)) {
        s.calls = raw.calls.filter((x) => typeof x === 'string' && CALLS.some((c) => c.id === x));
      }
      const lcc = Number(raw.lastCallCast);
      if (Number.isFinite(lcc)) s.lastCallCast = Math.round(lcc);
      // ── 海图 / 船只（v0.7 / v0.8）：逐字段兜底，并且**只保留现在还存在的 id** ──
      // ⚠⚠ **老存档迁移**：`chart === true`（v0.7 的单个 boolean）→ `charts = { polar: true }`。
      //   只认 CHARTS 里还存在的 id，删过海图 / 改过 id 的存档不会留下幽灵条目。
      if (raw.chart === true) s.charts.polar = true;
      if (raw.charts && typeof raw.charts === 'object') {
        for (const c of CHARTS) if (raw.charts[c.id]) s.charts[c.id] = true;
      }
      s.boatApp = !!raw.boatApp;
      const rb = raw.boats;
      if (rb && typeof rb === 'object') {
        const owned = (Array.isArray(rb.owned) ? rb.owned : [])
          .filter((id) => typeof id === 'string' && boatById(id));
        s.boats.owned = [...new Set(owned)];
        s.boats.current = s.boats.owned.includes(rb.current) ? rb.current : (s.boats.owned[0] || null);
      }
      // ⚠ 兜底：有船却没解锁船厂（手改存档 / 将来删过 App）→ 补上解锁。
      //   不补的话桌面看不到船厂，玩家拥有一艘**买不到也换不了**的船。
      if (s.boats.owned.length) s.boatApp = true;
      // ⚠ 海图也不许"丢"：如果存档里船都买了却没有**极地**海图（不可能由正常流程产生），
      //   补上它，免得玩家卡在"有船但进不去极地"的死状态里。
      //   （只补第一张 —— 后面的海图是"潜到上一张图底部"才拿到的，不能替玩家跳过那一步。）
      if (s.boats.owned.length && !s.charts.polar) s.charts.polar = true;
      // ── 未读新枪（v0.7 第三批）：只保留现在还存在的枪 id ──
      // ⚠⚠ **老存档升级要把"当前已解锁"的枪全部标成"播报过"** ——
      //   不然这次更新一上线，所有老玩家会同时收到五六条"新货上架"，
      //   一个本来是好消息的功能第一次露面就成了骚扰。只有 fresh install
      //   （连存档都没有）才从空白开始。
      if (Array.isArray(raw.gunNews)) {
        s.gunNews = raw.gunNews.filter((x) => typeof x === 'string' && GUNS.some((g) => g.id === x));
      }
      // ── 剧情（批 5）：只保留现在还存在的短信 id（删过笑话的存档不会留下幽灵）──
      if (Array.isArray(raw.sms)) {
        s.sms = raw.sms.filter((x) => typeof x === 'string' && SMS.some((m) => m.id === x));
      }
      s.smsSeen = Math.max(0, Math.round(Number(raw.smsSeen) || 0));
      if (Array.isArray(raw.seenCut)) {
        s.seenCut = raw.seenCut.filter((x) => typeof x === 'string' && MAPS.some((m) => m.id === x));
      }
      s.hazards = Math.max(0, Math.round(Number(raw.hazards) || 0));
      s.bossKills = Math.max(0, Math.round(Number(raw.bossKills) || 0));
      s.beatGame = !!raw.beatGame;
      if (Array.isArray(raw.gunAnnounced)) {
        s.gunAnnounced = raw.gunAnnounced.filter((x) => typeof x === 'string' && GUNS.some((g) => g.id === x));
      } else {
        const hasBoat = s.boats.owned.length > 0;
        // 一张图"到过" = 首图 / 或者（持有**通往它**的海图 + 有船）—— 与 mapProgress 同源。
        // ⚠ 海图 id 就是它解锁的那张图的 id（见 config 的 CHARTS），所以直接 `s.charts[id]`。
        const reached = (id) => id === MAPS[0].id || (hasBoat && !!s.charts[id]);
        for (const g of GUNS) {
          if (g.price <= 0) continue;
          if (g.unlockMap && !reached(g.unlockMap)) continue;
          if (g.unlockDepth != null && (s.mapBest[g.unlockMap] || 0) < g.unlockDepth) continue;
          s.gunAnnounced.push(g.id);
        }
      }
    }
  } catch (_) { /* 存档损坏则用默认值 */ }
  return s;
}

export function persist(save) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) { /* 隐私模式忽略 */ }
}
