/**
 * narrative.js — 剧情驱动：来电引导 / 短信 / 电台 / 过场 / 图鉴注脚
 *
 * 为什么单独一个文件：**数据在 `story.js`、驱动原先却在 `game.js`** ——
 * "剧情"这件事被切成两半放在两个文件里，是接手时最容易找错地方的一处
 * （架构评审 §3 P1-1 点名的就是这个）。现在驱动也独立了：
 *   · 数据（文案 / 触发条件 / 收件人）→ `src/story.js` 与 `config.js` 的 `CALLS`
 *   · 驱动（什么时候响、响了之后做什么）→ **本文件**
 *
 * ⚠⚠ **这是「原型挂载」，不是普通模块**：本文件把方法写成一个 **`Narrative` 类**
 *   （**类体里方法之间不需要逗号** —— 所以这些方法是从 `game.js` **原样搬过来的、零改动**），
 *   `game.js` 在类定义之后把它们逐个挂到 `Game.prototype` 上。
 *   所以这里的方法**照旧写 `this.xxx`**（this 就是 Game 实例），调用点一行都不用改。
 *   选它而不是 `class Game extends Narrative`：这个项目没有构建链、只有一个 Game 类，
 *   挂载是改动面最小的分法（Review §6 第 4 步指定的顺序：save → narrative → voyage → guns）。
 *   ⚠ 踩过的坑：第一版写成了**对象字面量**（`export const NARRATIVE = { … }`），而对象字面量的
 *     方法之间**必须加逗号** → 浏览器直接 `SyntaxError`；更要命的是 **`node --check` 没报出来**。
 *     **改完 `.js` 一定要真加载一次页面**（跑一套回归最快）。
 *
 * ⚠ 依赖方向：只依赖 `config` / `story` / `save` / `audio`（都是更低层），
 *   **不 import `game.js`** —— 剧情层不知道主循环的存在。
 * ⚠ 改这里之前先看 `ARCHITECTURE.md` §7：四条硬约束 + `when.map` 读 `owned` 的那条（B10 的教训）。
 */
import { CALLS, CALL_GAP, mapById, mapMaxDepth, mapOfSpecies, STATE } from './config.js';
import { SMS, CUTSCENE, CODEX_NOTE } from './story.js';
import { codexOrder } from './codex.js';
import { persist } from './save.js';
import { SFX } from './audio.js';

/** 剧情驱动的方法集（由 `game.js` 挂到 `Game.prototype` 上，见文件头说明） */
export class Narrative {
  // ══════ 来电引导 · 访问器与判定 ══════

// ── 来电引导（v0.6）────────────────────────────────────────
/**
 * 已听过的电话 id。
 *
 * ⚠ 和 `boats` 一样，包一层是因为**老存档里这个字段根本不存在** ——
 *   直接 `this.save.calls.includes(...)` 会抛异常。
 */
_calls() {
  if (!Array.isArray(this.save.calls)) this.save.calls = [];
  return this.save.calls;
}

/**
 * 一条电话的触发条件是否**全部**满足。
 * 条件字段的含义见 `config.js` 的 `CALLS` 注释。
 */
_callReady(c) {
  const w = c.when || {};
  if (w.casts != null && this.save.casts < w.casts) return false;
  // 深度用**本图**纪录：在浅图刷竿数不该把"你已经下到 390m"这条播报出去
  if (w.depth != null && this.mapBestOf(this.map.id) < w.depth) return false;
  if (w.codex != null && Object.keys(this.save.codex).length < w.codex) return false;
  // ⚠ v0.7 第二批把许可证退役之后，`licenses` 永远是空数组（buyMap 只在 license>0 时写它）
  //   —— 这里还读它的话，两通带 `when.map` 的电话就**永远不响**（GAMEPLAY §6.2 B10）。
  //   语义改成与分段解锁同源："已到过那张图" = `mapProgress().owned`。
  //   ⚠ 2026-09-20：写 `licenses` 的那段逻辑（连同 `_licenses()`）已整段删除 ——
  //     现在 `save.licenses` 是个**没有任何读者的 @retired 字段**，更不该出现在任何判定里。
  if (w.map != null && !this.mapProgress(mapById(w.map)).owned) return false;
  // ── v0.7：海图 / 船 / App 解锁态（三个都能正反两向用）──
  // ⚠ v0.8：`when.chart` 现在填的是**海图 id**（如 `'polar'`），语义是"已经拿到那张海图"。
  //   以前是 boolean，只能表达"极地海图拿到了没有" —— 加第 3 张图之后装不下。
  if (w.chart != null && !this.hasChart(w.chart)) return false;
  if (w.boat != null && (this._boats().owned.length > 0) !== !!w.boat) return false;
  if (w.appLocked != null && this._apps().includes(w.appLocked)) return false;
  if (w.level) {
    for (const [k, n] of Object.entries(w.level)) {
      if ((this.save.levels[k] || 0) < n) return false;
    }
  }
  return true;
}

  // ══════ 来电引导 · 播放流程 ══════

/**
 * 现在该响哪一通电话（没听过的里，**数组顺序最靠前**且条件满足的那一条）。null = 不响。
 *
 * 三条门：① 没听过；② 条件满足；③ 距上一通至少 `CALL_GAP` 竿。
 * 第 ③ 条是关键 —— 玩家可能在第 5 竿就连着满足三个条件，
 * 不隔开的话会一次待机收到三通电话，直接变成骚扰。
 */
pendingCall() {
  const done = this._calls();
  const last = Number(this.save.lastCallCast);
  if (Number.isFinite(last) && this.save.casts < last + CALL_GAP) return null;
  for (const c of CALLS) {
    if (done.includes(c.id)) continue;
    // 玩家按过「忽略」的那一通：**这一竿之内不再响**，抛下一竿时重新响
    // （`ignoredCall` 在 _resetRun 里清空）—— 忽略 ≠ 听过。
    if (c.id === this.ignoredCall) continue;
    if (this._callReady(c)) return c;
  }
  return null;
}

/**
 * 把"现在该不该响铃"同步给界面。
 *
 * ⚠ **只在待机、且手机没打开时响。** 这是这套系统的第一条硬约束：
 *   一竿中间插电话会把三段式循环切断，而待机本来就是玩家做决定的那一屏。
 * ⚠ 响铃**不阻塞任何操作** —— 玩家想无视就无视，照样能点画面抛竿；
 *   下一次回待机它还会响（因为还没听）。
 */
_syncCall() {
  const c = (this.state === STATE.IDLE && !this.phoneOpen) ? this.pendingCall() : null;
  this.ringingCall = c;
  this.ui.ringPhone(!!c, c);
}

/** 接听：打开手机并直接进入来电界面 */
_answerCall() {
  if (!this.ringingCall) return;
  SFX.tap();
  this.openPhone('call');
}

/**
 * 挂断 / 听完。**标记为已听**（不会再响），并按需跳到目标 App。
 *
 * `goto` 是"引导"和"告知"的分界线：只说一句"去枪店看看"然后让玩家自己找，
 * 多数人不会去；接听完直接把他送到那个 App 前面，才算真的引导。
 */
_endCall(goTo) {
  const c = this.ringingCall;
  if (!c) return;
  this._calls().push(c.id);
  this.save.lastCallCast = this.save.casts;
  // ── v0.7：听完这通电话要解锁的 App（船厂）──
  // ⚠ 解锁必须发生在**接听之后**：解锁早了，桌面上会出现一个从没被介绍过的 App，
  //   而"这通电话就是介绍"正是它的意义（见 config 的 CALLS 注释）。
  if (c.unlock === 'boat' && !this.save.boatApp) this.save.boatApp = true;
  persist(this.save);
  this.ringingCall = null;
  this.ui.ringPhone(false, null);
  SFX.buy();
  const dest = goTo ? c.goto : null;
  if (dest) this.ui.openApp(dest);
  else this.ui.showPhoneHome();
}

  // ══════ 短信 / 过场 / 注脚 ══════

// ── 短信 / 过场（批 5）──────────────────────────────────────
/** 已经发过的短信 id（表可能不存在 —— 和 boats / charts 同一个理由） */
_sms() {
  if (!Array.isArray(this.save.sms)) this.save.sms = [];
  return this.save.sms;
}

/**
 * 检查有没有该发的新短信。**每条只发一次**（`save.sms` 记已发 id）。
 *
 * ⚠ 和电话的三条约束**不一样**：短信**不打断任何操作**，所以
 *   ① 不需要挑时机（随时可以判定，电话只在 IDLE 响）；
 *   ② 不需要 `CALL_GAP` 那种间隔（连发三条只是"回头一起看"）。
 *   它唯一的约束是"每条只发一次"。
 * ⚠ 判定只在这一处（和 `_syncGunNews` 同一条原则）：界面只读 `save.sms`。
 */
_syncSms() {
  const got = this._sms();
  const before = got.length;
  for (const m of SMS) {
    if (got.includes(m.id)) continue;
    if (!this._smsReady(m)) continue;
    got.push(m.id);
  }
  if (got.length !== before) {
    persist(this.save);
    this.syncBadges();
  }
  return got.length - before;
}

/** 一条短信的触发条件满足了吗（`when` 的字段语义见 `story.js` 的注释） */
_smsReady(m) {
  const w = m.when || {};
  const s = this.save;
  if (w.after != null && !this._sms().includes(w.after)) return false;
  if (w.casts != null && (s.casts || 0) < w.casts) return false;
  if (w.depth != null) {
    // `'mapMax'` 是个哨兵值：意思是"本图的深度上限"（不写死 860 / 1240 / 1560）
    const need = w.depth === 'mapMax' ? mapMaxDepth(this.map) : w.depth;
    if (this.mapBestOf() < need) return false;
  }
  if (w.coins != null) {
    const enough = s.coins >= w.coins;
    if (w.lt ? enough : !enough) return false;   // `lt: true` = "**不足**这么多"
  }
  if (w.map != null && !this.mapProgress(mapById(w.map)).owned) return false;
  if (w.chart != null && !this.hasChart(w.chart)) return false;
  if (w.boss != null && (s.bossKills || 0) < w.boss) return false;
  if (w.hazard != null && (s.hazards || 0) < w.hazard) return false;
  if (w.codexFull) {
    // "本图图鉴集齐"—— 和航线的门槛同源（都读本图的鱼种）
    const mine = codexOrder().filter((d) => mapOfSpecies(d).id === this.map.id);
    if (mine.some((d) => !s.codex[d.id])) return false;
  }
  return true;
}

/**
 * 短信按发件人分组后的**两条会话线**（界面只渲染，不做判断）。
 *
 * 为什么按发件人分组而不是排一条时间流水：玩家打开短信是**找笑话**的，
 * 不是查收件箱。分成两条线之后"小鲟今天又说了什么废话"一眼能看到底。
 */
smsThreads() {
  const got = this._sms();
  const list = SMS.filter((m) => got.includes(m.id));
  const out = [];
  for (const who of ['ai', 'assoc']) {
    const text = list.filter((m) => m.who === who).flatMap((m) => m.text);
    if (text.length) out.push({ who, text });
  }
  return out;
}

/** 未读短信数 = 已发条数 − 上次打开短信 App 时的条数 */
smsUnread() {
  return Math.max(0, this._sms().length - (this.save.smsSeen || 0));
}

/** 打开短信 App = 已读（和"点开枪店清红点"同一条原则） */
markSmsRead() {
  if (this.smsUnread() === 0) return;
  this.save.smsSeen = this._sms().length;
  persist(this.save);
  this.syncBadges();
}

/** 过场：这张图的第一次进入，要放一次三行故事卡 */
cutsceneFor(mapId) {
  const seen = Array.isArray(this.save.seenCut) ? this.save.seenCut : [];
  if (seen.includes(mapId)) return null;
  return CUTSCENE[mapId] || null;
}

markCutscene(mapId) {
  if (!Array.isArray(this.save.seenCut)) this.save.seenCut = [];
  if (!this.save.seenCut.includes(mapId)) this.save.seenCut.push(mapId);
  persist(this.save);
}

/** 图鉴注脚（小鲟的一句话）。**不是每条鱼都有** —— 见 `story.js` 的注释 */
codexNote(speciesId) { return CODEX_NOTE[speciesId] || null; }
}
