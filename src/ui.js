/**
 * ui.js — DOM 覆盖层
 *
 * 三块：
 *   1. HUD（顶部读数 / 海域大标题 / 深度尺 / 渔获面板 / 连击 / 飘字）
 *   2. 手机界面（需求④）：渔具店 / 枪店 / 图鉴 / 航线 / 设置 五个 App 都装在里面
 *   3. 全屏遮罩卡片（标题页 / 结算 / 确认框）—— 这些不是 App，仍走 .overlay
 *
 * 图标一律用 icons.js 的内联 SVG，不用 emoji —— 原因见 icons.js 顶部说明。
 */
import { UPGRADES, UPGRADE_ORDER, MAX_LEVEL, maxLvOf, upgradeCost, upgradeValueText,
  levelCapForMap, MAPS, DEFAULT_MAP, mapById, mapMaxDepth, mapOfSpecies,
  zonesOfMap, GUN_MAX_LEVEL, gunById, CALLS } from './config.js';
import { codexOrder, zoneLabel, groupByMap, drawFishIcon } from './codex.js';
import { coinIcon, glyph, iconText, GLYPH } from './icons.js';
// 剧情数据表（批 5）—— 文案全在 story.js，界面只负责渲染
import { SENDERS, RADIO } from './story.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

/**
 * 商店价格专用的紧凑写法：≥ 1 万就换成「万」，并且**不留多余的 .0**。
 *
 * 为什么价格必须压缩、而余额不用：
 *   商店一行的宽度预算是死的（面板 342px → 一行 318px → 文字列 178px + 按钮）。
 *   按钮的宽度由价格字符串撑，而满级附近的价格会到 `1,057,128` 这种 9 字符，
 *   把按钮从 66px 顶到 93px —— 文字列被挤到 151px，11 项里有 8 项当场折行。
 *   压缩成 `106万` 之后按钮全程停在 66px，文字列稳回 178px。
 *
 *   而 HUD 的金币药丸和手机钱包都是 flex 自适应、跟着内容长宽的（实测 999→76px、
 *   98,765,432→140px 都没有溢出），所以余额照旧显示精确值 —— 玩家随时能看到自己的真实金币数。
 *
 * ⚠ 压缩只影响显示。`upgradeCost()` 返回的仍是原值，扣钱走的是那个数，不会少收。
 */
const fmtCost = (n) => {
  if (!(n >= 10000)) return fmt(n);
  const v = n / 10000;
  // 上百万了就不留小数（`106万` 比 `105.7万` 短，也更像人话）；否则保留一位。
  const s = v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '');
  return s + '万';
};

/**
 * 商店里各项升级的图标 —— **全部走 icons.js 的内联 SVG**。
 * `UPGRADES[key].icon` 存的就是 GLYPH 的键名，所以这里直接 `glyph(u.icon)`，
 * 不需要再维护一张 key → 图形的映射表（多一张表就多一处漏更新的机会）。
 *
 * 历史：最早这 5 个用的是 config 里的 emoji（🎣 🪝 ⚓ 💥 🔦）—— 彩色 emoji 不受主题色控制、
 * 基线偏低会顶掉行高，而且和旁边的单色 SVG 图标风格割裂。
 */

/**
 * 把海域配色提亮，用作标题辉光。
 * 区域配色本身是深的（海沟是 #061f38），直接拿来做发光等于没发光。
 */
function brighten(hex, k = 0.55) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(n)) return '#6fd8ff';
  const mix = (c) => Math.round(c + (255 - c) * k);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'),
      coinIco: $('coinIco'),
      coin: $('coinVal'),
      depthChip: $('depthChip'),
      depthIco: $('depthIco'),
      depth: $('depthVal'),
      lineVal: $('lineVal'),
      seaTitle: $('seaTitle'),
      seaName: $('seaName'),
      seaGoal: $('seaGoal'),
      mute: $('muteBtn'),
      zoneBanner: $('zoneBanner'),
      zoneName: $('zoneName'),
      zoneEn: $('zoneEn'),
      ruler: $('ruler'),
      catchPanel: $('catchPanel'),
      catchCount: $('catchCount'),
      catchList: $('catchList'),
      comboBox: $('comboBox'),
      comboVal: $('comboVal'),
      comboCnt: $('comboCnt'),
      floatLayer: $('floatLayer'),
      reelBtn: $('reelBtn'),
      // 快速回收（绞盘）：上升阶段才出现的加速按钮
      fastReelBtn: $('fastReelBtn'),
      fastReelIco: $('fastReelIco'),
      phoneBtn: $('phoneBtn'),
      phoneIco: $('phoneIco'),
      // 来电卡片（v0.7：iPhone 式 —— 头像 / 来电人 / 状态 / 两个圆钮）
      callBanner: $('callBanner'),
      callBannerIco: $('callBannerIco'),
      callBannerWho: $('callBannerWho'),
      iosState: $('iosState'),
      callAccept: $('callAccept'),
      callDecline: $('callDecline'),
      // 新货上架推送（v0.7 第三批）
      newsBanner: $('newsBanner'),
      newsIco: $('newsIco'),
      newsTitle: $('newsTitle'),
      newsBody: $('newsBody'),
      // 左下角手机的红点（有未读新枪 / 有没接的来电）
      phoneDot: $('phoneDot'),
      hint: $('hint'),
      // 屏幕闪白（批 7，串上带电鱼时用）
      screenFlash: $('screenFlash'),
      // 批 6 特效的三个覆盖层
      vignette: $('vignette'),
      comboFx: $('comboFx'),
      bossShift: $('bossShift'),
      // 过场卡（批 5）
      cutscene: $('cutscene'),
      cutText: $('cutText'),
      cutHint: $('cutHint'),
      // Boss 血条（批 7）
      bossBar: $('bossBar'),
      bossName: $('bossName'),
      bossTrack: $('bossTrack'),
      bossFill: $('bossFill'),
      overlay: $('overlay'),
      // 枪械条（空中阶段）
      gunBar: $('gunBar'),
      gunIco: $('gunIco'),
      gunName: $('gunName'),
      gunMeta: $('gunMeta'),
      gunAmmo: $('gunAmmo'),
      gunMeter: $('gunMeter'),
      // 手机
      phoneLayer: $('phoneLayer'),
      phoneBody: $('phoneBody'),
      pTime: $('pTime'),
      pSig: $('pSig'),
      pWifi: $('pWifi'),
      pBat: $('pBat'),
      pHome: $('pHome'),
      pApp: $('pApp'),
    };
    this.project = null;        // (worldX, worldY) => { nx, ny }
    // 新货推送的队列与去重（**不属于存档** —— 刷新页面后横幅不再补播，
    // 红点仍然在，因为那部分是 save.gunNews 的职责）
    this._newsQueue = [];
    this._newsShowing = false;
    this._newsT = 0;
    // 点推送卡 = 收起它并让 game 层打开枪店（onNewsTap 由 game 注入）
    this.el.newsBanner.onclick = () => {
      if (!this.el.newsBanner.classList.contains('on')) return;
      clearTimeout(this._newsT);
      this._hideNews();
      this.onNewsTap && this.onNewsTap();
    };
    this._zone = null;
    this._phone = null;         // { save, handlers, app }
    // 当前地图。**UI 层的唯一真相是这一个字段** —— 深度尺的总长、尺子上的分区、
    // 手机桌面小部件、图鉴 / 设置里的地图名全部读它，不再直接读 DEFAULT_MAP。
    this._map = DEFAULT_MAP;
    this._rulerTotal = mapMaxDepth(DEFAULT_MAP);   // 深度尺的总长 = 当前地图的深度上限
    this._fillIcons();
    this._buildRuler();
  }

  // ── 地图 ─────────────────────────────────────────────────
  /**
   * 换到某张地图。深度尺的总长和尺子上的分区色带都要重建 ——
   * 宁静海湾是 860m / 5 层，冰封极地是 1240m / 5 层，尺子直接换个量程。
   */
  setMap(map) {
    this._map = mapById(map && map.id);
    this._rulerTotal = mapMaxDepth(this._map);
    this._buildRuler();
    // 不在这里重绘 App：换图是 game.enterMap 发起的，它会紧接着调 refreshApp()。
    // 这里再刷一次的话，航线 App 的按钮会在点击处理过程中被重建（点了个寂寞）。
  }

  /** 当前地图在 MAPS 里的下标（商店的分段等级闸门要它） */
  get mapIndex() { return Math.max(0, MAPS.findIndex((m) => m.id === this._map.id)); }

  // ── 图标注入（唯一来源：icons.js）─────────────────────────
  _fillIcons() {
    this.el.coinIco.innerHTML = coinIcon(14);
    this.el.depthIco.innerHTML = glyph('wave', 14);
    this.el.phoneIco.innerHTML = glyph('phone', 22);
    // 来电卡片：两个圆钮用的是**同一个听筒图标**，挂断那个在 CSS 里转 134°（真机就是这么干的）
    this.el.callAccept.innerHTML = glyph('phone', 19);
    this.el.callDecline.innerHTML = glyph('phone', 19);
    this.el.callBannerIco.innerHTML = glyph('call-in', 20);
    this.el.newsIco.innerHTML = glyph('gunshop', 20);
    this.el.fastReelIco.innerHTML = glyph('fast-reel', 16);
    this.el.pSig.innerHTML = glyph('signal', 14);
    this.el.pWifi.innerHTML = glyph('wifi', 14);
    this.el.pBat.innerHTML = glyph('battery', 14);
  }

  // ── 基础显示 ─────────────────────────────────────────────
  setCoins(n) { this.el.coin.textContent = fmt(n); }

  /**
   * 本竿已经潜到的最深深度。
   * 除了顶部数字，还要把左侧深度尺上的金色游标推下去 —— 那是"我到了哪"。
   * @param {number} m 已到达的最深深度
   * @param {number} [limit] 当前鱼线能到达的极限（同步到顶部 chip）
   * @param {number} [cur] 鱼钩**当前**深度（声呐探测带的中心）。不给就跟着 m 走。
   */
  setDepth(m, limit, cur) {
    const d = Math.max(0, Math.round(m));
    this.el.depth.textContent = d;
    if (Number.isFinite(limit)) this.el.lineVal.textContent = Math.round(limit);
    if (this._marker) {
      this._marker.style.top = `${Math.min(100, (d / this._rulerTotal) * 100)}%`;
      this._markerTag.textContent = `已潜 −${d}m`;
    }
  }

  setMuteIcon(muted) {
    // 同样用内联 SVG：🔊 是 Emoji 1.0 的码位、各平台都有，但图标的线宽/基线
    // 跟旁边的 chip 完全对不齐，统一成 SVG 之后整条顶栏是一套视觉。
    this.el.mute.innerHTML = glyph(muted ? 'mute' : 'sound', 19);
  }

  /**
   * 右上角「已潜 / 上限」chip。
   * 待机（还没抛竿）时它是没有意义的 0 / 80m，先收起来，
   * 抛竿后才淡入 —— 免得主界面一上来就挂着一个"0"。
   */
  setDepthChip(v) { this.el.depthChip.classList.toggle('on', v); }

  showHud(v) { this.el.hud.classList.toggle('hidden', !v); }

  // ── 深度尺 ───────────────────────────────────────────────
  /**
   * 两层结构：
   *   .ruler         定位 + 允许溢出（两条深度线的文字标签要探出尺子右侧）
   *     .ruler-track   圆角外框 + 裁切，色带画在这里，免得方角盖住圆角
   * 尺子的总长 = 当前地图的深度上限（宁静海湾 = 430m），换地图自动跟着变。
   */
  _buildRuler() {
    const total = this._rulerTotal;
    this.el.ruler.innerHTML = '';

    const track = document.createElement('div');
    track.className = 'ruler-track';
    this.el.ruler.appendChild(track);

    // ⚠ 只画**当前地图**的分区。两张图的表层都是 0~70m，
    //   遍历全部 ZONES 会让尺子上同时叠出"阳光浅滩"和"浮冰浅海"两层色带。
    for (const z of zonesOfMap(this._map.id)) {
      const d = document.createElement('div');
      d.className = 'band';
      d.style.top = `${(-z.top / total) * 100}%`;
      d.style.height = `${((z.top - z.bottom) / total) * 100}%`;
      d.style.background = `linear-gradient(90deg, ${z.color}66, transparent)`;
      d.innerHTML = `<span>${z.name}<i>${-z.top}m</i></span>`;
      track.appendChild(d);
    }
    // 鱼线极限：红色虚线 + 「鱼线 −XXm」标签（当前鱼线能到达的最低深度）
    this._limit = document.createElement('div');
    this._limit.className = 'limit';
    this._limit.innerHTML = '<span class="tag">鱼线</span>';
    this.el.ruler.appendChild(this._limit);
    this._limitTag = this._limit.querySelector('.tag');

    // 已潜深度：金色游标 + 「已潜 −XXm」标签（本竿已经达到的最低深度）
    this._marker = document.createElement('div');
    this._marker.className = 'marker';
    this._marker.innerHTML = '<span class="tag">已潜</span>';
    this.el.ruler.appendChild(this._marker);
    this._markerTag = this._marker.querySelector('.tag');
  }

  setRulerVisible(v) { this.el.ruler.classList.toggle('on', v); }

  /** 当前鱼线能到达的最低深度 */
  setLineLimit(maxDepth) {
    const pct = maxDepth / this._rulerTotal;
    this._limit.style.top = `${Math.min(100, pct * 100)}%`;
    // 只有鱼线极限正好压到尺子最底（≈ 这张地图的海底）时才不画那条虚线 ——
    // 否则虚线和它的文字标签会贴到尺子的圆角上。满级 420m / 地图 430m 时
    // 还差 10m，仍然照常显示。
    this._limit.style.display = pct >= 0.985 ? 'none' : 'block';
    this._limitTag.textContent = `鱼线 −${Math.round(maxDepth)}m`;
    this.el.lineVal.textContent = Math.round(maxDepth);
  }

  // ── 声呐（v0.5 已移除）──────────────────────────────────
  // 「声呐」升级项连同深度尺上的探测带一起删掉了。原来的实现（围绕鱼钩的一条
  // 探测带 + 带内鱼的刻度）在 git 历史里可以找到；这里不再保留空壳方法 ——
  // 留一个永远不被调用的 setSonar 只会让下一个人以为它还在生效。

  /**
   * 主界面大标题 = **当前地图名**（固定「宁静海湾」，不随深度/升级变化）。
   * 副标题是这张地图的探索进度。传 null / false 隐藏。
   */
  setSeaTitle(target) {
    if (!target) { this.el.seaTitle.classList.remove('on'); return; }
    this.el.seaName.textContent = target.name;
    this.el.seaGoal.textContent = target.sub;
    if (target.color) this.el.seaTitle.style.setProperty('--sea', brighten(target.color));
    this.el.seaTitle.classList.add('on');
  }

  // ── 区域横幅 ─────────────────────────────────────────────
  setZone(zone) {
    if (!zone) {
      this._zone = null;
      this.el.zoneBanner.classList.remove('on');
      return;
    }
    if (this._zone === zone.id) return;
    this._zone = zone.id;
    this._showBanner(zone.name, zone.en);
  }

  /** 空中阶段的高度横幅（海面 → 平流层 → 近地轨道 → 深空） */
  setAltitude(band) {
    if (!band) return;
    const id = 'alt:' + band.en;
    if (this._zone === id) return;
    this._zone = id;
    this._showBanner(band.name, band.en);
  }

  _showBanner(name, en) {
    this.el.zoneName.textContent = name;
    this.el.zoneEn.textContent = en;
    this.el.zoneBanner.classList.add('on');
    clearTimeout(this._zoneT);
    this._zoneT = setTimeout(() => this.el.zoneBanner.classList.remove('on'), 2200);
  }

  // ── 渔获面板 ─────────────────────────────────────────────
  /**
   * 面板里的 `.row` 数量**不等于**鱼线上的鱼数：
   * 列表只留最近 26 行（再往上翻没有意义），而鱼护满级能串 60 条。
   * 所以显示的数字以 game 传进来的真实条数为准，DOM 行数只用来兜底。
   */
  setCatchVisible(v) { this.el.catchPanel.classList.toggle('on', v); }

  addCatch(fish, total) {
    const row = document.createElement('div');
    row.className = 'row' + (fish.value >= 100 ? ' hot' : '');
    row.innerHTML = `<span class="nm">${fish.def.name}</span><span class="vl">${fish.value}</span>`;
    this.el.catchList.appendChild(row);
    while (this.el.catchList.children.length > 26) this.el.catchList.removeChild(this.el.catchList.firstChild);
    this.el.catchList.scrollTop = this.el.catchList.scrollHeight;
    this._syncCatchCount(total);
  }

  removeCatch(total) {
    if (this.el.catchList.lastChild) this.el.catchList.removeChild(this.el.catchList.lastChild);
    this._syncCatchCount(total);
  }

  /**
   * 鱼护满了 → 最早串上的那条挣脱，列表里对应的是**第一行**（不是最后一行）。
   * 和 game._catch() 里的 `caught.shift()` 严格一一对应，两边不能各写各的。
   */
  dropFirstCatch(total) {
    if (this.el.catchList.firstChild) this.el.catchList.removeChild(this.el.catchList.firstChild);
    this._syncCatchCount(total);
  }

  clearCatch() {
    this.el.catchList.innerHTML = '';
    this.setCatchCount(0);
  }

  _syncCatchCount(total) {
    this.setCatchCount(Number.isFinite(total) ? total : this.el.catchList.children.length);
  }

  setCatchCount(n) { this.el.catchCount.textContent = n; }

  // ── 连击 ─────────────────────────────────────────────────
  setCombo(count, mult) {
    if (count >= 2) {
      this.el.comboBox.classList.add('on');
      this.el.comboVal.textContent = `×${mult.toFixed(2).replace(/0$/, '')}`;
      this.el.comboCnt.textContent = `${count} COMBO`;
    } else {
      this.el.comboBox.classList.remove('on');
    }
    // 连击色差（批 6 特效 #4）：搭在已有的 setCombo 上，不另起一条调用链 ——
    // 连击数只有这一个来源，多一条链就会有两处不同步的风险。
    this.setComboFx(count);
  }

  // ── 收线按钮 / 手机入口 / 提示 ────────────────────────────
  showReel(v) { this.el.reelBtn.classList.toggle('on', v); }

  // ── 快速回收（绞盘，v0.5）────────────────────────────────
  /**
   * 显示 / 隐藏「快速回收」按钮。只有**上升阶段 + 已买绞盘**才显示 ——
   * 判断在 game 那边做（UI 不做判断，见枪店那段注释的同一原则）。
   */
  showFastReel(v) { this.el.fastReelBtn.classList.toggle('on', !!v); }

  /**
   * 标记"本竿已经按过快速回收"：按钮变灰不可再按。
   *
   * 为什么按下之后还要留在屏幕上（而不是直接隐藏）：玩家需要看到"我按过了"
   * 这个回执，否则会怀疑自己是不是没按中，然后一直戳。
   */
  setFastReel(used) {
    this.el.fastReelBtn.classList.toggle('used', !!used);
    this.el.fastReelBtn.disabled = !!used;
  }

  // ── 铅坠·直达深度（v0.5）────────────────────────────────
  /**
   * 把「直达深度」的当前状态喂给商店控件。
   *
   * ⚠ 上限 `cap` 由 game 算好传进来（= 铅坠等级与"鱼线极限 × 70%"取小）——
   *   UI **不自己算**：那个上限依赖鱼线等级和当前地图，散一份到界面里
   *   迟早会和 game 里的那份漂开（历史教训：同一个数写在两处必然错位）。
   *
   * @param {{on:boolean, depth:number}} drop 存档里的玩家偏好
   * @param {number} cap  本图 / 本等级下允许的最大跳深（米）
   * @param {number} min  允许的最小跳深（米）
   */
  setDropControl(drop, cap, min) {
    this._drop = { on: !!(drop && drop.on), depth: Math.max(0, Math.round((drop && drop.depth) || 0)) };
    this._dropCap = Math.max(0, Math.round(cap || 0));
    this._dropMin = Math.max(0, Math.round(min || 0));
  }

  /** 手机入口：只在待机（船上）时出现 —— 商店 / 图鉴 / 设置 全在里面 */
  showPhoneBtn(v) { this.el.phoneBtn.classList.toggle('on', v); }

  // ── 来电（v0.6 首版 / v0.7 改成 iPhone 式卡片）────────────────
  /**
   * 来电状态：**小手机开始晃动** + **屏幕上方滑入一张 iPhone 式来电卡**。
   *
   * 为什么不做全屏来电界面（真机就是全屏，这里刻意不抄）：
   * ① 全屏会打断玩家正在做的事（待机时他可能正要点画面抛竿）；
   * ② **晃动本身就在说"手机里有东西"** —— 这正是"手机响了"的语义，
   *    玩家不需要被教育就知道该去掏手机。
   *
   * @param {boolean} on
   * @param {{who:string, icon?:string}} [call] 来电人（名字 + 头像用的 GLYPH 键）
   */
  ringPhone(on, call) {
    this.el.phoneBtn.classList.toggle('ringing', !!on);
    this.el.callBanner.classList.toggle('on', !!on);
    if (on && call) {
      this.el.callBannerWho.textContent = call.who;
      // 头像按来电人上色 + 换字形：和通话记录里的小头像**同一套**规则
      //（历史上这两处颜色不一致过一次，玩家会以为记错了人）。
      this.el.callBannerIco.className = `ios-ava ${call.icon || ''}`;
      this.el.callBannerIco.innerHTML = glyph(call.icon || 'call', 20);
      this.el.iosState.textContent = '来电中…';
    }
  }

  // ── 新货上架推送（v0.7 第三批）─────────────────────────────
  /**
   * iOS 式推送：顶部滑入一张通知卡（App 图标 + 标题 + 正文 + 「现在」），
   * 4.2 秒后自动收起，排队的逐条播。**点它 = 打开枪店** —— 红点就是在那一步消失的。
   *
   * 为什么排队而不是一次全弹：潜到某个深度可能一次满足两把枪的 `unlockDepth`，
   * 两张卡叠在一起会互相盖住 —— iOS 的做法也是逐条轮播。
   *
   * 为什么不跟来电共用一张卡：来电是"有人在找你"（要接 / 不接，两个动作），
   * 推送是"有新东西可看"（点与不点都不影响进度）。两者长得一样的话，
   * 玩家会开始害怕每一次震动。
   */
  queueGunNews(ids) {
    for (const id of ids) {
      const g = gunById(id);
      if (g && !this._newsQueue.some((x) => x.id === g.id)) this._newsQueue.push(g);
    }
    this.pumpNews();
  }

  /** 放下一张推送卡（队列空 / 正在显示 / 手机开着 时不放） */
  pumpNews() {
    if (this._newsShowing || !this._newsQueue.length) return;
    if (this._phone && !this.el.phoneLayer.classList.contains('hidden')) return;  // 手机开着不打扰
    const g = this._newsQueue.shift();
    this._newsShowing = true;
    this.el.newsIco.innerHTML = glyph(g.icon || 'gunshop', 20);
    this.el.newsTitle.textContent = '枪店 · 新货上架';
    this.el.newsBody.textContent = `「${g.name}」已经到货 —— 手机里的枪店可以看看`;
    this.el.newsBanner.classList.add('on');
    clearTimeout(this._newsT);
    this._newsT = setTimeout(() => this._hideNews(), 4200);
  }

  _hideNews() {
    this.el.newsBanner.classList.remove('on');
    this._newsShowing = false;
    // 稍等动画收完再放下一张，两张卡不会叠在一起
    setTimeout(() => this.pumpNews(), 520);
  }

  /** 左下角手机的红点：> 0 就亮（数量在手机桌面的枪店图标上显示） */
  setPhoneBadge(n) {
    this.el.phoneDot.classList.toggle('on', n > 0);
  }

  /** 枪械条：只在空中射击阶段出现 */
  showGunBar(v) { this.el.gunBar.classList.toggle('on', v); }

  /**
   * 刷新枪械条。**每帧都会被调用**，所以这里只改文本和宽度，绝不重建 DOM 子树
   * （枪械图标是 SVG，每帧 innerHTML 一次会直接掉帧）。
   *
   * 三种枪三种读法：
   *   - 有弹匣（Uzi）→ `7 / 9`
   *   - 激光        → 显示递增倍率 `×2.4`，进度条走"过热进度"
   *   - 其余        → 显示全局伤害倍率 `×1.48`，进度条走"换弹进度"
   */
  setGunState(g) {
    if (!g || !this.el.gunBar) return;
    if (this._gunIcon !== g.icon) {
      this._gunIcon = g.icon;
      this.el.gunIco.innerHTML = glyph(g.icon, 20);
    }
    this.el.gunName.textContent = g.name;
    this.el.gunMeta.textContent = `Lv.${g.level}`;

    const reloading = g.reloadT > 0;
    // 枪械条右侧读数。v0.5 起不再有全局攻击力倍率，所以这里改显示**伤害/发** ——
    // 它就是"攻击力"本身，玩家要能一眼看到升枪之后这个数变大了。
    //
    // 兜底：数值缺失时按 0 显示。枪械条是每帧刷的 HUD，
    // 这里抛一次异常就会把整个 _updateAir 打断（症状是"鱼打不死、也不结算"）。
    const dmg = Number.isFinite(g.damage) ? g.damage : 0;
    const dmgTxt = dmg >= 10 ? String(Math.round(dmg)) : dmg.toFixed(1);
    let ammo = `${dmgTxt} 伤害`;
    if (reloading) ammo = '换弹…';
    else if (g.mech === 'laser') {
      // 激光读的是"当前递增到几倍"，玩家才知道"再照一会儿更疼"
      ammo = `${dmgTxt} × ${(1 + Math.min(g.rampMax || 0, (g.ramp || 0) * g.heat)).toFixed(1)}`;
    } else if (g.mag) ammo = `${g.ammo} / ${g.mag}`;
    this.el.gunAmmo.textContent = ammo;

    let pct = 0;
    if (reloading && g.reloadMax > 0) pct = 1 - g.reloadT / g.reloadMax;
    else if (g.mech === 'laser' && g.heatMax > 0) pct = Math.min(1, g.heat / g.heatMax);
    this.el.gunMeter.style.width = `${Math.round(pct * 100)}%`;
    this.el.gunBar.classList.toggle('reload', reloading);
    this.el.gunBar.classList.toggle('hot', pct > 0.72 && !reloading);
  }

  setHint(text) {
    if (!text) { this.el.hint.classList.remove('on'); return; }
    this.el.hint.textContent = text;
    this.el.hint.classList.add('on');
  }

  /**
   * 屏幕短促闪白（批 7）—— 串上「带电」鱼时用。
   *
   * ⚠ **不要用 `setTimeout` 去摘 class**：那会留下一个"如果这一帧正好在换图 /
   *   重置就被吞掉"的 timer。这里靠 **transition 自己走完**（见 styles.css 的
   *   `.screen-flash`）：加 `.on` 之后浏览器把 opacity 推到 0.55，
   *   下一次 `requestAnimationFrame` 再摘掉，它就自己淡回去。
   *   两帧足够 —— 闪白本来就只有 100ms 量级。
   */
  flashScreen() {
    const el = this.el.screenFlash;
    if (!el) return;
    el.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('on')));
  }

  /**
   * Boss 血条（批 7）。`name = null` 表示"收起来"。
   *
   * ⚠ **分段刻度只在段数变化时重建 DOM**：血条每中一枪都会调一次（每秒十几次），
   *   每次都重建 innerHTML 会让刻度线闪、也会白烧 DOM 操作。
   *   填充宽度走 CSS `transition`，所以每帧改 width 是平滑的、不需要 JS 补间。
   */
  setBossBar(name, ratio, segments) {
    const el = this.el.bossBar;
    if (!el) return;
    if (!name) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    this.el.bossName.textContent = name;
    if (this._bossSeg !== segments) {
      this._bossSeg = segments;
      let html = '';
      for (let i = 1; i < segments; i++) {
        html += `<i style="left:${((i / segments) * 100).toFixed(2)}%"></i>`;
      }
      this.el.bossTrack.innerHTML = html + '<div class="boss-fill" id="bossFill"></div>';
      // ⚠ innerHTML 会把填充条一起冲掉，所以上面把它拼回去了 ——
      //   但那样拿到的就是**新元素**，缓存必须重取，否则后面改的是个孤儿节点。
      this.el.bossFill = $('bossFill');
    }
    if (this.el.bossFill) {
      this.el.bossFill.style.width = (Math.max(0, Math.min(1, ratio)) * 100).toFixed(1) + '%';
    }
  }

  // ── 批 6 特效的四个 UI 侧接口 ─────────────────────────────
  /**
   * 深度氛围 vignette（特效 #11）：越深越重。
   *
   * ⚠ 走 CSS 覆盖层 + ，**不引入后处理管线** ——
   *   这个项目是纯静态零构建 + 软渲染无头 Chrome，EffectComposer 那一套跑不动。
   * ⚠ 和已有的"暗幕"（，由灯具决定）是**两件事**：
   *   暗幕是"看不看得见"（玩法），vignette 是"压迫感"（氛围）。两者叠加不冲突。
   */
  setVignette(depth01) {
    const el = this.el.vignette;
    if (!el) return;
    const v = Math.max(0, Math.min(1, depth01 || 0));
    el.style.opacity = (v * 0.72).toFixed(3);
  }

  /** 连击色差（特效 #4）：连击越高边缘 RGB 分离越明显 */
  setComboFx(combo) {
    const el = this.el.comboFx;
    if (!el) return;
    // 阈值 10：低于它完全不显示 —— 否则普通的一竿从头到尾都在闪，很快就麻木了
    const v = combo >= 10 ? Math.min(1, (combo - 10) / 20 + 0.35) : 0;
    el.style.opacity = v.toFixed(3);
  }

  /** Boss 色偏（特效 #10）：Boss 在场时整个画面偏红 */
  setBossShift(on) {
    const el = this.el.bossShift;
    if (el) el.style.opacity = on ? '1' : '0';
  }

  /**
   * 金币数字飘字（特效 #3）：上浮 + 放大 1.4× + 淡出。
   *
   * ⚠ 它和普通飘字（）的区别是**要有"数字"的感觉** ——
   *   纯粒子玩家看不出自己赚了多少，纯文字又太安静。所以给一个专门的样式类。
   */
  floatCoins(x, y, amount) {
    this.floatText(x, y, '+' + fmt(amount), 'coin-pop');
  }

  // ── 过场卡（批 5）──────────────────────────────────────────
  /**
   * 全屏黑底 + 打字机逐字。**只有 3 行**（多一行就变成"要我读东西"）。
   *
   * ⚠ 用 `setInterval` 逐字推进，而不是 CSS `steps()`：
   *   `steps()` 那种做法要 `nowrap + overflow:hidden + 宽度动画`，**多行会坏**，
   *   而这里恰好是 3 行。JS 逐字还多一个好处 —— "点一下补完"只是把 `textContent`
   *   设成全文，不会留下半截动画状态。
   */
  showCutscene(lines, onDone) {
    const el = this.el.cutscene;
    const txt = this.el.cutText;
    if (!el || !txt) { if (onDone) onDone(); return; }
    const full = lines.join('\n');
    let i = 0;
    this._cutFull = full;
    this._cutDone = onDone || null;
    el.classList.remove('hidden');
    // 点击绑定只做一次（ 每次换图都会调）
    if (!el._bound) { el._bound = true; el.onclick = () => this.cutTap(); }
    txt.textContent = '';
    txt.classList.add('done');           // 先不显示光标，免得空行闪一下
    clearInterval(this._cutTimer);
    this._cutTimer = setInterval(() => {
      i += 1;
      txt.textContent = full.slice(0, i);
      if (i >= full.length) { clearInterval(this._cutTimer); txt.classList.remove('done'); }
    }, 45);
  }

  /**
   * 过场期间点一下：**没打完就补完，打完了才收起**。
   * 这是"跳过"和"继续"共用同一个手势 —— 玩家不用学两个操作。
   */
  cutTap() {
    const el = this.el.cutscene;
    if (!el || el.classList.contains('hidden')) return false;
    const txt = this.el.cutText;
    clearInterval(this._cutTimer);
    if (txt.textContent.length < (this._cutFull || '').length) {
      txt.textContent = this._cutFull;      // 第一次点：补完
      txt.classList.remove('done');
      return true;
    }
    el.classList.add('hidden');             // 第二次点：收起
    const cb = this._cutDone;
    this._cutDone = null;
    if (cb) cb();
    return true;
  }

  /** 过场是不是正在播（`game.js` 的输入要据此让路） */
  get cutsceneOpen() {
    return !!this.el.cutscene && !this.el.cutscene.classList.contains('hidden');
  }

  // ── 飘字 ─────────────────────────────────────────────────
  /**
   * 飘字。`icon` 给一个 GLYPH 名字时，会在文字前面挂一个内联 SVG 图标
   * （原来这里是 emoji「📖」，同一个字体兜底问题；而且 emoji 基线和 18px 的黑体对不齐）。
   */
  floatText(wx, wy, text, cls = '', icon = '') {
    if (!this.project) return;
    // 同屏飘字上限，避免连续捕获时糊满屏幕
    if (this.el.floatLayer.childElementCount >= 7) return;
    const { nx, ny } = this.project(wx, wy);
    if (nx < -0.2 || nx > 1.2 || ny < -0.2 || ny > 1.2) return;
    const d = document.createElement('div');
    d.className = 'float-txt ' + cls;
    if (icon) {
      d.classList.add('has-ico');
      d.innerHTML = glyph(icon, cls.includes('sm') ? 13 : 18) + `<span>${text}</span>`;
    } else {
      d.textContent = text;
    }
    d.style.left = `${nx * 100}%`;
    d.style.top = `${ny * 100}%`;
    this.el.floatLayer.appendChild(d);
    setTimeout(() => d.remove(), 1000);
  }

  clearFloats() { this.el.floatLayer.innerHTML = ''; }

  // ============================================================
  // 手机界面（需求④）
  // ============================================================
  get phoneOpen() { return !this.el.phoneLayer.classList.contains('hidden'); }
  get currentApp() { return this._phone ? this._phone.app : null; }

  /** 打开手机。save / handlers 由 game 传进来，App 里的按钮都回调到 game */
  openPhone(save, handlers) {
    this._phone = { save, handlers, app: null };
    this._tickClock();
    this.el.phoneLayer.classList.remove('hidden');
    this.el.phoneLayer.onclick = (e) => {
      if (e.target === this.el.phoneLayer) handlers.close();      // 点手机外的空白 = 收起手机
    };
    const bar = this.el.phoneLayer.querySelector('.p-bar');
    if (bar) bar.onclick = () => handlers.close();                // 点底部横条也收起（像上滑回桌面）
    this.showPhoneHome();
  }

  closePhone() {
    this.el.phoneLayer.classList.add('hidden');
  }

  /** 状态栏时钟用真实时间 */
  _tickClock() {
    const d = new Date();
    this.el.pTime.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /** 桌面：地图小部件 + App 列表 */
  showPhoneHome() {
    if (!this._phone) return;
    const { save } = this._phone;
    this._phone.app = null;
    this.el.pHome.classList.remove('hidden');
    this.el.pApp.classList.add('hidden');

    const map = this._map;
    // 桌面小部件显示的是**本图**的最深纪录（不是全局 bestDepth）——
    // 换到冰封极地之后，"最深纪录"要跟着这张图走，否则会显示海湾那 430m。
    const best = Math.max(0, Math.round(save.mapBest?.[map.id] || 0));
    // ⚠ 「电话」放在第一位：手机响了的时候，玩家第一眼要能看见它在哪。
    //   有未听的来电时图标上挂一个红点徽标（和真手机一样）。
    const ringing = !!this._phone.handlers.ringingCall?.();
    // 未读新枪（v0.7 第三批）：枪店图标上挂一个红点，多于一把时显示数字
    const gunNews = (this._phone.handlers.gunNews && this._phone.handlers.gunNews()) || [];
    // 未读短信（批 5）：手机图标 / 短信图标上挂红点
    const smsUnread = (this._phone.handlers.smsUnread && this._phone.handlers.smsUnread()) || 0;
    // 桌面 App 列表 = **已解锁的那些**（v0.7：船厂要等船厂老板打来电话才出现）。
    // ⚠ 解锁名单由 game 给（`handlers.apps`）—— 界面不自己判断"该不该有这一格"，
    //   否则"桌面多出一个没被介绍过的 App"这种错会藏在 UI 里。
    const unlocked = (this._phone.handlers.apps && this._phone.handlers.apps()) || null;
    // ⚠ 短信排在电话后面：两者都是"有人找你"，放一起玩家一眼就知道去哪看。
    const apps = [['call', '电话'], ['sms', '短信'], ['shop', '渔具店'], ['gunshop', '枪店'],
      ['codex', '鱼图鉴'], ['route', '航线'], ['boat', '船厂'], ['radio', '电台'], ['settings', '设置']]
      .filter(([id]) => !unlocked || unlocked.includes(id))
      .map(([id, nm]) => `
        <button class="p-app-item" data-app="${id}">
          <span class="p-ico ${id}">${glyph(id, 28)}${id === 'call' && ringing ? '<i class="p-badge"></i>' : ''}${id === 'sms' && smsUnread ? '<i class="p-badge"></i>' : ''}${id === 'gunshop' && gunNews.length ? `<i class="p-badge num">${gunNews.length > 1 ? gunNews.length : ''}</i>` : ''}</span><span>${nm}</span>
        </button>`).join('');

    // 图鉴进度只算**本图**的鱼种。全局进度放在图鉴 App 里，
    // 桌面上这个数字要和「航线」的解锁条件（本图 75%）对得上。
    const order = codexOrder();
    const mine = order.filter((d) => mapOfSpecies(d).id === map.id);
    const got = mine.filter((d) => save.codex[d.id]).length;
    const pct = Math.round((got / Math.max(1, mine.length)) * 100);

    this.el.pHome.innerHTML = `
      <div class="p-widget">
        ${save.beatGame ? `<div class="p-cleared">债 务 已 结 清</div>` : ''}
        <div class="p-w-map">当 前 地 图 · ${map.en}</div>
        <div class="p-w-name">${map.name}</div>
        <div class="p-w-row">
          <span class="p-w-coin">${coinIcon(12)}${fmt(save.coins)}</span>
          <span class="p-w-depth">本图最深 −${best}m</span>
        </div>
      </div>
      <div class="p-widget p-widget-2">
        <div class="p-w2-row"><span class="p-w2-lb">本 图 图 鉴</span><b>${got} / ${mine.length}</b></div>
        <div class="p-track"><i style="width:${pct}%"></i></div>
        <div class="p-w2-row p-w2-sub">
          <span>深度 0 ~ −${mapMaxDepth(map)}m</span>
          <span>${zonesOfMap(map.id).length} 层海域</span>
        </div>
      </div>
      <div class="p-grid">${apps}</div>
      <div class="p-note" style="margin:0 14px">电话 / 渔具店 / 枪店 / 图鉴 / 航线${unlocked && unlocked.includes('boat') ? ' / 船厂' : ''} / 设置都装在这台手机里 —— 点图标打开 App。想抛竿就先收起手机，再点一下画面。</div>
    `;
    this.el.pHome.querySelectorAll('[data-app]').forEach((b) => {
      b.onclick = () => {
        this._phone.handlers.tap && this._phone.handlers.tap();
        this.openApp(b.dataset.app);
      };
    });
  }

  /** 打开某个 App */
  openApp(id) {
    if (!this._phone) return;
    // 点开枪店 = "已读"（v0.7 第三批）：手机红点 / 枪店 App 红点在这一步消失。
    // ⚠ 新枪身上的「NEW」角标**不**跟着消失 —— 它跟到那把枪被买下为止，
    //   否则玩家刚点进来角标就没了，"新货"这件事就没人记得了。
    if (id === 'gunshop' && this._phone.handlers.clearGunNews) this._phone.handlers.clearGunNews();
    this._phone.app = id;
    // 每次进来电界面都从第一句重新开始（`_callStep` 是界面自己的推进状态，
    // 不属于存档 —— 挂了电话再进来应该重头听）
    if (id === 'call') this._callStep = 0;
    this.el.pHome.classList.add('hidden');
    this.el.pApp.classList.remove('hidden');
    this._renderApp();
    this.el.pApp.scrollTop = 0;
    // 打开短信 = 已读（批 5）。⚠ 放在  **之后** ——
    //   先标已读的话，标题栏的"N 条新消息"永远显示不出来。
    if (id === 'sms' && this._phone.handlers.readSms) this._phone.handlers.readSms();
  }

  // ── 短信 / 电台（批 5）────────────────────────────────────
  /**
   * 短信：按发件人分成两条**会话线**（小鲟 / 渔业协会），气泡左右分开。
   *
   * 为什么按发件人分组而不是按时间排一条流水：玩家打开短信是**找笑话**的，
   * 不是查收件箱。分成两条线之后"小鲟今天又说了什么废话"一眼就能看到底。
   *
   * ⚠ 新消息的判定在 `game.js`（`_syncSms`），界面只读 `handlers.sms()` 给的结果 ——
   *   和枪店红点同一条原则：**判断只在一处**。
   */
  _smsNote(handlers) {
    const n = (handlers.smsUnread && handlers.smsUnread()) || 0;
    return n ? `${n} 条新消息` : '已读完';
  }

  _smsBody(handlers) {
    const threads = (handlers.sms && handlers.sms()) || [];
    if (!threads.length) return '<div class="p-note" style="margin:0">还没有收到任何消息。</div>';
    return threads.map((t) => {
      const s = SENDERS[t.who] || SENDERS.ai;
      const bubbles = t.text.map((line) => `
        <div class="sms-b ${t.who === 'assoc' ? 'assoc' : 'ai'}">
          <span class="sms-t">${line}</span>
        </div>`).join('');
      return `
        <div class="sms-thread">
          <div class="sms-head">
            <span class="sms-ava ${t.who}">${glyph(s.icon, 20)}</span>
            <b>${s.name}</b><i>${s.en}</i>
          </div>
          ${bubbles}
        </div>`;
    }).join('');
  }

  /**
   * 电台：随机播一条荒诞新闻。**和玩法完全无关**（`EXPANSION.md` §6.6）。
   *
   * 「换台」按钮只是重掷一次 —— 它不保存、不计数、不解锁任何东西。
   * 这一整个 App 存在的意义就是"玩家随手点开，读到一条和自己无关的荒唐新闻"。
   */
  _radioBody() {
    const line = RADIO[Math.floor(Math.random() * RADIO.length)];
    return `
      <div class="radio-box">
        <div class="radio-freq"><span class="radio-dot"></span>88.6 MHz · 海上广播</div>
        <div class="radio-txt">${line}</div>
      </div>
      <button class="radio-switch" data-radio>换 台</button>`;
  }

  /** 数据变了（买了东西 / 清了存档）→ 重绘当前 App */
  refreshApp() { if (this._phone && this._phone.app) this._renderApp(); }

  _appShell(title, note, body) {
    return `
      <div class="p-app-h">
        <button class="p-back" data-back aria-label="返回桌面">${glyph('back', 15)}</button>
        <b>${title}</b><i>${note || ''}</i>
      </div>
      <div class="p-app-body">${body}</div>`;
  }

  _renderApp() {
    const { save, handlers } = this._phone;
    const id = this._phone.app;
    const order = codexOrder();

    let html = '';
    if (id === 'call') html = this._appShell('电 话', this._callNote(handlers), this._callBody(handlers));
    else if (id === 'shop') html = this._appShell('渔 具 店', `金币 ${fmt(save.coins)}`, this._shopBody(save, this.mapIndex));
    else if (id === 'gunshop') html = this._appShell('枪 店', `金币 ${fmt(save.coins)}`, this._gunshopBody(save, handlers));
    else if (id === 'codex') html = this._appShell('鱼 类 图 鉴', '按地图 · 深度排序', this._codexBody(save, order));
    else if (id === 'route') html = this._appShell('航 线', `金币 ${fmt(save.coins)}`, this._routeBody(save, handlers));
    else if (id === 'boat') html = this._appShell('船 厂', `金币 ${fmt(save.coins)}`, this._boatBody(save, handlers));
    else if (id === 'settings') html = this._appShell('设 置', 'v1.0', this._settingsBody(save, handlers));
    else if (id === 'sms') html = this._appShell('短 信', this._smsNote(handlers), this._smsBody(handlers));
    else if (id === 'radio') html = this._appShell('电 台', '海上广播 · 与您无关', this._radioBody());

    this.el.pApp.innerHTML = html;

    const back = this.el.pApp.querySelector('[data-back]');
    if (back) back.onclick = () => { handlers.tap && handlers.tap(); this.showPhoneHome(); };
    // 电台"换台"：重掷一条。它不保存、不计数、不解锁任何东西 —— 纯氛围。
    const rsw = this.el.pApp.querySelector('[data-radio]');
    if (rsw) rsw.onclick = () => { handlers.tap && handlers.tap(); this._renderApp(); };

    if (id === 'call') {
      // 来电界面：推进对话 / 挂断 / 直接去目标 App。
      // ⚠ `_callStep` 由界面维护（挂了再进来重头听），但"标记已听 + 写存档 + 跳 App"
      //   全部交回 game —— 界面只负责说"我要下一步了"。
      const next = this.el.pApp.querySelector('#callNext');
      if (next) next.onclick = () => { handlers.tap && handlers.tap(); this._callStep = (this._callStep || 1) + 1; this._renderApp(); };
      const skip = this.el.pApp.querySelector('#callSkip');
      if (skip) skip.onclick = () => { handlers.endCall && handlers.endCall(true); };
      const hang = this.el.pApp.querySelector('#callHang');
      if (hang) hang.onclick = () => { handlers.endCall && handlers.endCall(false); };
      const go = this.el.pApp.querySelector('#callGo');
      if (go) go.onclick = () => { handlers.endCall && handlers.endCall(true); };
    } else if (id === 'shop') {
      this.el.pApp.querySelectorAll('.buy[data-k]').forEach((b) => {
        b.onclick = () => handlers.buy(b.dataset.k);
      });
      // 铅坠的「直达深度」控件：开关 + 目标深度步进。
      // ⚠ 步进值在这里算（步长是"界面粒度"，属于表现层），但**钳制在 game 那边做** ——
      //   界面只管发出"我想要多少"，不负责判断能不能。
      const drop = this._drop || { on: false, depth: 0 };
      const cap = this._dropCap || 0;
      const min = this._dropMin || 0;
      const cur = Math.min(Math.max(drop.depth || 0, min), cap);
      const step = cap >= 600 ? 50 : 20;
      const tg = this.el.pApp.querySelector('#dropTg');
      if (tg) tg.onclick = () => { handlers.setDropOn(!drop.on); this.refreshApp(); };
      const minus = this.el.pApp.querySelector('#dropMinus');
      if (minus) minus.onclick = () => handlers.setDropDepth(Math.max(min, cur - step));
      const plus = this.el.pApp.querySelector('#dropPlus');
      if (plus) plus.onclick = () => handlers.setDropDepth(Math.min(cap, cur + step));
    } else if (id === 'gunshop') {
      // 三个动作各管各的按钮：买（没拥有）→ 装备（拥有但不是当前）→ 升级（拥有）
      this.el.pApp.querySelectorAll('[data-gun-buy]').forEach((b) => {
        b.onclick = () => handlers.buyGun(b.dataset.gunBuy);
      });
      this.el.pApp.querySelectorAll('[data-gun-equip]').forEach((b) => {
        b.onclick = () => handlers.equipGun(b.dataset.gunEquip);
      });
      this.el.pApp.querySelectorAll('[data-gun-up]').forEach((b) => {
        b.onclick = () => handlers.upgradeGun(b.dataset.gunUp);
      });
    } else if (id === 'route') {
      this.el.pApp.querySelectorAll('.rt-go[data-map]').forEach((b) => {
        b.onclick = () => handlers.goMap(b.dataset.map);
      });
    } else if (id === 'boat') {
      // 买（还没拥有）/ 换（已拥有但不是当前）—— 两个动作各管各的按钮
      this.el.pApp.querySelectorAll('[data-boat-buy]').forEach((b) => {
        b.onclick = () => handlers.buyBoat(b.dataset.boatBuy);
      });
      this.el.pApp.querySelectorAll('[data-boat-use]').forEach((b) => {
        b.onclick = () => handlers.setBoat(b.dataset.boatUse);
      });
    } else if (id === 'codex') {
      this._paintCodexIcons(this.el.pApp, save, order, 56, 38);
    } else if (id === 'settings') {
      const sw = this.el.pApp.querySelector('#pSound');
      if (sw) sw.onclick = () => { handlers.setMute(!handlers.getMuted()); this.refreshApp(); };
      const rst = this.el.pApp.querySelector('#pReset');
      if (rst) rst.onclick = () => handlers.reset();
      const exit = this.el.pApp.querySelector('#pExit');
      if (exit) exit.onclick = () => handlers.close();
    }
  }

  // ── App 内容：电话（v0.6）────────────────────────────────
  /** App 标题栏右侧那行小字：有来电时写「通话中」，否则写通话记录条数 */
  _callNote(handlers) {
    const cur = handlers.ringingCall && handlers.ringingCall();
    if (cur) return '通 话 中';
    const done = (handlers.callLog && handlers.callLog()) || [];
    return done.length ? `已接 ${done.length} 通` : '暂无通话';
  }

  /**
   * 电话 App 的正文。
   *
   * 两种状态：
   *   ① **有未听的来电** → 来电界面（逐句推进的对话 + 接完跳转）
   *   ② 没有 → 通话记录（听过的电话，点开能重看内容）
   *
   * ⚠ 界面**不做任何判断**：有没有来电、听过哪些，全部来自 `game` 喂进来的 handler
   *   （和枪店同一条原则 —— 判断留在 UI 里的话，"按钮亮着却点不动"会散得到处都是）。
   */
  _callBody(handlers) {
    const cur = handlers.ringingCall && handlers.ringingCall();
    if (cur) return this._callIncoming(cur, handlers);

    const done = (handlers.callLog && handlers.callLog()) || [];
    const heard = CALLS.filter((c) => done.includes(c.id));
    if (!heard.length) {
      return `<div class="call-empty">
        <div class="call-empty-ico">${glyph('call', 34)}</div>
        <b>还没有通话记录</b>
        <span>该打来的人会自己打过来 —— 在船上等着就行。</span>
      </div>`;
    }
    const rows = heard.map((c) => `
      <div class="call-log-item">
        <span class="cl-ico ${c.icon}">${glyph(c.icon, 16)}</span>
        <div class="cl-txt">
          <b>${c.who}</b>
          <i>${c.lines[0]}</i>
        </div>
      </div>`).join('');
    return `
      <div class="p-note" style="margin:0 0 10px">
        听过的电话都记在这里。<b>没听过的不会显示</b> —— 想知道后面还有什么，就继续钓。
      </div>
      <div class="call-log">${rows}</div>`;
  }

  /**
   * 来电界面：逐句推进的对话。
   *
   * 为什么是"一句一句出"而不是一次全显示：**这是电话**。
   * 一次全铺开读起来像短信，一句一句推才有"对面在说话"的节奏感 ——
   * 而节奏感正是让玩家愿意读完这几句的原因（他平时是直接跳过说明文字的）。
   *
   * 推进状态 `this._callStep` 是**界面自己的**，不进存档：挂了再进来应该重头听。
   */
  _callIncoming(c, handlers) {
    const step = Math.max(1, Math.min(this._callStep || 1, c.lines.length));
    const shown = c.lines.slice(0, step);
    const last = step >= c.lines.length;
    const bubbles = shown.map((t, i) => `<div class="call-line${i === step - 1 ? ' now' : ''}">${t}</div>`).join('');
    const acts = last
      ? `<button class="call-btn ghost" id="callHang">挂 断</button>
         <button class="call-btn gold" id="callGo">${c.gotoText}</button>`
      : `<button class="call-btn" id="callNext">继 续 ▾</button>`;
    return `
      <div class="call-card">
        <div class="call-ava ${c.icon}">${glyph(c.icon, 30)}</div>
        <div class="call-who">${c.who}</div>
        <div class="call-state">${last ? '通话中' : '来电中…'}</div>
        <div class="call-lines">${bubbles}</div>
        <div class="call-act">${acts}</div>
        ${last ? '' : `<div class="call-skip" id="callSkip">跳过 · 直接去 ${c.gotoText.replace(/\s/g, '')}</div>`}
      </div>`;
  }

  // ── App 内容：商店 ───────────────────────────────────────
  /**
   * 6 项等级升级 + 1 项一次性工具（v0.5）。三件事：
   *
   *   1. **数值文案从 LEVELS 现取**（`upgradeValueText`），不在 UPGRADES 里手写 ——
   *      20 个等级 × 6 项手写必然错位。
   *   2. **等级用进度条**而不是几颗点。格子数 = **该项自己的上限**（`maxLvOf`）。
   *   3. **分段封顶**：本图只开到 `levelCapForMap(mapIndex)`。满了之后按钮变成「本图满级」，
   *      这就是"该换地图了"的信号（见 config.js 的 MAP_LEVEL_CAP）。
   *
   * ⚠ v0.5 新增 `oneShot`（绞盘）：它没有等级，只有「未购买 / 已拥有」两态 ——
   *   所以既不画进度条、也不显示「当前 → 下一级」的数值文案。
   *   **所有上限判断一律走 `maxLvOf(key)`**，不要写死 `MAX_LEVEL`：
   *   写死的话绞盘会在 lv=1 时被判成"还能买"，给出一个永远点不动的按钮。
   */
  _shopBody(save, mapIndex = 0) {
    const cap = levelCapForMap(mapIndex);
    // 本图**开放的这一段**：进度条只画这一段（v0.7）。
    // 为什么：首图是"新手图"，把 20 格全画出来等于提前把所有长线目标摊开给玩家看，
    // 既显得货架很空（前 15 格全是灰的），也让"换图"失去"又开了一段"的意义。
    const from = mapIndex > 0 ? levelCapForMap(mapIndex - 1) : 0;
    const seg = Math.max(1, cap - from);
    // ⚠⚠ v0.7 第二批：`unlockMap` 的判定从「手里有没有这张图的**许可证**」
    //   改成了「**到没到过**这张图」（`mapProgress().owned`）。
    //   许可证机制已整条删除（2026-09-20 连 `_licenses()` 与换图里的许可证分支一起清了）——
    //   当年继续读 `save.licenses` 的话，鱼护 / 鱼饵 / 绞盘会**永远锁在「未解锁」**，
    //   玩家换到极地也买不到。**这里只认 `owned`，新代码不要去碰 `save.licenses`。**
    const routes = (this._phone && this._phone.handlers.mapList && this._phone.handlers.mapList()) || [];
    const reached = (mapId) => routes.some((p) => p.map.id === mapId && p.owned);
    let lastTier = '';

    const rows = UPGRADE_ORDER.map((key) => {
      const u = UPGRADES[key];
      const lv = save.levels[key];
      const maxLv = maxLvOf(key);
      const oneShot = !!u.oneShot;
      const maxed = lv >= maxLv;                        // 该项满级（一次性项买过就是满级）
      // ⚠ 分段解锁（v0.6）：`unlockMap` 指向的那张图还没**到过**时，这一项不在货架上。
      // ⚠⚠ `!maxed` 是**老存档**的兜底（B5）：绞盘改成 `unlockMap: 'polar'` 之后，
      //   一个在改动之前就买过绞盘的老档，`mapProgress().owned` 判不了 polar
      //   （当年那一版看的是 `licenses` 里有没有 polar）——
      //   不加这个条件的话商店会把它显示成「未解锁」，
      //   而他手里那个「快速回收」按钮其实一直是可用的（game.js 只看 levels.winch）。
      //   **已拥有的东西不能被"没解锁"覆盖**，否则玩家会以为自己的钱白花了。
      const locked = !maxed && !!u.unlockMap && !reached(u.unlockMap);
      const capped = !oneShot && !maxed && lv >= cap;    // 本图这一段已经买满
      const cost = upgradeCost(key, lv);
      const afford = !locked && !capped && !maxed && save.coins >= cost;

      // 数值文案：一次性项没有「当前 → 下一级」，`upgradeValueText` 返回空串
      const cur = upgradeValueText(key, lv);
      const next = (capped || maxed) ? null : upgradeValueText(key, lv + 1);
      // ⚠⚠ 待解锁提示里的**地图名必须从 `u.unlockMap` 取**，不能写死。
      //   批 4 之前只有一张"下一张图"，写死「冰封极地」看不出问题；
      //   加了第 3 张图之后，「耐压舱」（`unlockMap: 'lava'`）会顶着
      //   「到过「冰封极地」后上架」出现在首图货架上 —— **玩家会照着它去潜极地，然后发现没用**。
      //   这类"文案和判定不同源"的 bug 不会报错、不会闪退，只会让玩家白跑一趟。
      const unlockName = u.unlockMap ? (mapById(u.unlockMap) || {}).name || u.unlockMap : '';
      // 单位只在**行尾**出现一次：`1033 → 1100m`，而不是 `1033m → 1100m`。
      // 商店那一列只有 ~176px，重复一遍单位要多占 14~28px，满级附近的长数字
      // 叠上重复单位就必然折行。封顶时（没有 → ）也要带上单位，否则当前值成了裸数字。
      const nx = oneShot ? '' : (next ? `${cur} → ${next}${u.unit}` : `${cur}${u.unit}`);

      // 进度条只画**本图这一段**（v0.7）：格子数 = cap − 上一张图的闸门。
      // 已占格数按段内偏移算 —— 带着 Lv6 进第二张图时，条上应该是"1 格亮"而不是"6 格亮"。
      const pips = oneShot ? ''
        : Array.from({ length: seg }, (_, i) => `<i class="${(from + i) < lv ? 'f' : ''}"></i>`).join('');

      const tierHead = u.tier !== lastTier ? `<div class="tier-h">${u.tier}</div>` : '';
      lastTier = u.tier;

      // 三种"不能买"的状态也带上 data-k —— 少了它，任何按 key 定位按钮的代码
      // （自动化回归、将来的"跳到某项"功能）在封顶时就查不到元素了。
      let btn;
      if (locked) btn = `<button class="buy lock" data-k="${key}" disabled>未解锁</button>`;
      else if (maxed) btn = `<button class="buy max" data-k="${key}" disabled>${oneShot ? '已拥有' : 'MAX'}</button>`;
      else if (capped) btn = `<button class="buy cap" data-k="${key}" disabled>本图满级</button>`;
      // 价格走 fmtCost：满级附近是 `106万` 而不是 `1,057,128`，
      // 按钮不会被撑宽，右边那列文案也就不会被挤到折行（见 fmtCost 的注释）。
      else btn = `<button class="buy" data-k="${key}" ${afford ? '' : 'disabled'}>${coinIcon(12)} ${fmtCost(cost)}</button>`;

      // 铅坠这一行下面挂「直达深度」的开关 + 目标深度步进器
      const extra = key === 'sinker' ? this._dropRow() : '';

      return `${tierHead}
        <div class="item ${afford ? 'afford' : ''}${locked ? ' locked-row' : ''}">
          <div class="icon">${glyph(u.icon, 19)}</div>
          <div class="info">
            <div class="nm">${u.name}<span class="lv">${oneShot ? (lv > 0 ? '已拥有' : '未拥有') : `Lv.${lv} / ${cap}`}</span></div>
            <div class="ds">${u.desc}${locked ? '' : (nx ? ` · <span class="nx">${nx}</span>` : '')}</div>
            ${locked ? `<div class="lock-hint">${glyph('lock', 11)}${u.tier === '工具' ? '高级强化' : '进阶强化'} · 到过「${unlockName}」后上架</div>`
                     : (pips ? `<div class="pips">${pips}</div>` : '')}
          </div>
          ${btn}
        </div>${extra}`;
    }).join('');

    return `
      <div class="wallet"><span class="lb">金币</span><span class="amt">${fmt(save.coins)}</span></div>
      <div class="p-note" style="margin:0 0 10px">
        本图开放至 <b>Lv.${cap}</b> —— 这一段买满后，换一片海继续往上堆（每片海只开一段）。
      </div>
      <div class="shop-list">${rows}</div>`;
  }

  /**
   * 铅坠的「直达深度」控件（v0.5）。
   *
   * 为什么挂在铅坠这一行下面、而不是塞进「设置」App：
   * 它是这一项升级的**用法**。拆到别的 App 里，玩家根本不会把"我买的东西"
   * 和"这个开关"联系起来 —— 而这条机制的全部价值就在于玩家知道它在起作用。
   *
   * 数据来自 `game.applyUpgrades()` 喂进来的 `setDropControl()`。
   */
  _dropRow() {
    const d = this._drop || { on: false, depth: 0 };
    const cap = this._dropCap || 0;
    const min = this._dropMin || 0;
    const cur = Math.min(Math.max(d.depth || 0, min), cap);
    const usable = cap > 0;
    return `
      <div class="drop-row${usable ? '' : ' off'}">
        <button class="drop-tg${d.on ? ' on' : ''}" id="dropTg" ${usable ? '' : 'disabled'}>
          ${d.on ? '直达 · 开' : '直达 · 关'}
        </button>
        <div class="drop-dep">
          <button class="drop-st" id="dropMinus" ${cur <= min ? 'disabled' : ''}>−</button>
          <span class="drop-val">−${cur}m</span>
          <button class="drop-st" id="dropPlus" ${cur >= cap ? 'disabled' : ''}>+</button>
        </div>
      </div>
      <div class="drop-hint">开竿直接落到 −${cur}m，省掉这一段下潜 · 上限 −${cap}m</div>`;
  }

  // ── App 内容：枪店（v0.4）─────────────────────────────────
  /**
   * 枪店 = 购买 / 装备 / 升级 三件事，全在一张卡上完成。
   *
   * 数据全部来自 `game.gunEntry()` —— **UI 不做任何判断**，只把
   * 「拥有 / 装备中 / 买得起 / 下一级数值」翻译成按钮的几种状态。
   * 判断留在 UI 里的话，"按钮亮着却点不动"这类不一致会同时出现在好几个地方，
   * 而且没有任何断言测得到。
   *
   * 每张卡都必须把「这把枪的机制」写出来（tip）：枪械和升级项不一样 ——
   * 玩家没法从"Uzi"两个字猜出它和加特林差在哪，那是设计文档里的知识，不是常识。
   */
  _gunshopBody(save, handlers) {
    const list = (handlers.gunList && handlers.gunList()) || [];
    if (!list.length) return '';
    let lastTier = '';

    const num = (v) => `${Math.round(v * 10) / 10}`;
    const sec = (v) => `${v.toFixed(2)}s`;
    // 「当前 → 下一级」；满级（next 为 null）时只显示当前值
    const delta = (cur, nx, f) => (nx == null ? `<b>${f(cur)}</b>` : `${f(cur)}<i>→</i><b>${f(nx)}</b>`);

    const rows = list.map((e) => {
      const g = e.gun;
      const n = e.next;
      // 分层小标题（和渔具店同一个视觉语言）：7 把枪按 初始 → 轻型 → 中型 → 重型 排下来，
      // 玩家一眼就知道"现在该买哪一档"。tier 字段只在枪店里用得到。
      const tierHead = g.tier !== lastTier ? `<div class="tier-h">${g.tier}</div>` : '';
      lastTier = g.tier;
      // ── 分段解锁（v0.7 第三批）：还没上架的枪 = 一张黑卡，**看不到任何数值** ──
      // 为什么连价格都不给：价格是一种承诺（"攒够就能买"），而对一把还没解锁的枪，
      // 攒钱根本不是当前的正确目标 —— 先把深度潜出来才是。名字保留，是因为
      // 玩家需要知道"有什么在等我"；伤害 / 半径 / 机制 / 价格全部藏起来。
      if (e.locked) {
        return `${tierHead}
        <div class="gs-item unreleased">
          <div class="gs-h">
            <span class="gs-ico">${glyph(g.icon, 22)}</span>
            <div class="gs-t"><b>${g.name}</b><i>${g.en}</i></div>
            <span class="gs-tag">未解锁</span>
          </div>
          <div class="gs-lockrow">${glyph('lock', 13)}<span>${e.lockText}</span></div>
        </div>`;
      }
      const stats = [
        `<span class="gs-st">伤害 ${delta(e.stat.damage, n && n.damage, num)}</span>`,
        `<span class="gs-st">范围 ${delta(e.stat.radius, n && n.radius, num)}</span>`,
        `<span class="gs-st">间隔 ${delta(e.stat.cooldown, n && n.cooldown, sec)}</span>`,
      ];
      // 弹匣 / 过热：只有 Uzi 和激光有，单位语义不同（发数 vs 秒数）
      if (e.stat.mag) {
        const unit = g.mech === 'laser' ? 's' : ' 发';
        const label = g.mech === 'laser' ? '过热' : '弹匣';
        stats.push(`<span class="gs-st">${label} ${delta(e.stat.mag, n && n.mag, (v) => `${num(v)}${unit}`)}</span>`);
      }

      const pips = Array.from({ length: GUN_MAX_LEVEL },
        (_, i) => `<i class="${i < e.lv ? 'f' : ''}"></i>`).join('');

      // 主按钮：装备中 / 装备 / 购买 / 买不起
      let btn;
      if (e.current) btn = '<button class="buy max" disabled>装备中</button>';
      else if (e.owned) btn = `<button class="gs-go" data-gun-equip="${g.id}">装 备</button>`;
      else if (e.canAffordBuy) btn = `<button class="gs-go" data-gun-buy="${g.id}">${coinIcon(12)} ${fmtCost(g.price)}</button>`;
      else btn = `<button class="buy lock" disabled>${coinIcon(12)} ${fmtCost(g.price)}</button>`;

      // 升级按钮：只有拥有的枪才有（没买的枪只显示价格，避免一排没用的灰按钮）
      let upBtn = '';
      if (e.owned) {
        upBtn = e.maxed
          ? '<button class="buy max" disabled>MAX</button>'
          : `<button class="buy" data-gun-up="${g.id}" ${save.coins >= e.upCost ? '' : 'disabled'}>升级 ${coinIcon(12)} ${fmtCost(e.upCost)}</button>`;
      }

      const tag = e.current ? '<span class="gs-tag on">装备中</span>'
        : (e.owned ? '<span class="gs-tag">已拥有</span>' : '');

      return `${tierHead}
        <div class="gs-item${e.current ? ' cur' : ''}${e.owned ? ' owned' : ' locked'}">${e.isNew ? '<i class="gs-new">NEW</i>' : ''}
          <div class="gs-h">
            <span class="gs-ico">${glyph(g.icon, 22)}</span>
            <div class="gs-t"><b>${g.name}</b><i>${g.en} · ${g.desc}</i></div>
            ${tag}
          </div>
          <div class="gs-tip">${g.tip}</div>
          <div class="gs-stats">${stats.join('')}</div>
          <div class="gs-foot">
            <div class="gs-lv"><span class="pips">${pips}</span><em>Lv.${e.lv} / ${GUN_MAX_LEVEL}</em></div>
            <div class="gs-btns">${upBtn}${btn}</div>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="wallet"><span class="lb">金币</span><span class="amt">${fmt(save.coins)}</span></div>
      <div class="p-note" style="margin:0 0 10px">
        每把枪可升 <b>${GUN_MAX_LEVEL}</b> 级 · 伤害只跟<b>这把枪自己的等级</b>走 ——
        渔具店里没有「攻击力」这一项。
      </div>
      <div class="gs-list">${rows}</div>`;
  }

  // ── App 内容：航线（换地图）───────────────────────────────
  /**
   * 多地图的入口。每张图一张卡，卡上把「怎么才能去」摊开写清楚：
   *
   *   ⚠ **条件不写死在这里**（v0.7）：直接渲染 `game.mapProgress()` 给出的 `conds`
   *   —— 现在是「钓到海图 + 有一艘船」两条，将来加图可能还有别的。
   *   界面只负责画和点按钮，判断全在 game 那一层。
   *
   * 条件**同时**列出来（而不是只显示最缺的那一个）：玩家能看到自己卡在哪一条，
   * 也能看到"另一条已经绿了"。数据全部来自 game.mapProgress —— 界面和判定
   * 共用同一个来源，不会出现"按钮亮了却买不了"。
   */
  _routeBody(save, handlers) {
    const list = (handlers.mapList && handlers.mapList()) || [];
    const curId = this._map.id;

    const rows = list.map((p) => {
      const m = p.map;
      const cur = m.id === curId;
      const icon = m.id === 'calm-bay' ? 'wave' : 'iceberg';
      // ⚠ v0.7：条件**不由界面写死**，而是读 game 给的 `p.conds`
      //   （海图 / 船 / 将来加图时可能还有别的）。界面只渲染 + 点按钮 ——
      //   判断留在 UI 里的话，"按钮亮了却买不了"会散得到处都是（和枪店同一条原则）。
      const conds = p.conds.map((c) => `<span class="rt-c ${c.ok ? 'ok' : ''}">${c.text}</span>`).join('');

      let btn;
      if (cur) btn = '<button class="buy max" disabled>当前所在</button>';
      else if (p.gateOk) btn = `<button class="rt-go" data-map="${m.id}">前 往</button>`;
      else btn = '<button class="buy lock" disabled>条件未满</button>';

      const tag = cur ? '<span class="rt-tag on">当前</span>'
        : (p.gateOk ? '<span class="rt-tag">已解锁</span>' : '');

      return `
        <div class="rt-item${cur ? ' cur' : ''}${p.gateOk ? ' owned' : ''}">
          <div class="rt-h">
            <span class="rt-ico">${glyph(icon, 20)}</span>
            <div class="rt-t"><b>${m.name}</b><i>${m.en}</i></div>
            ${tag}
          </div>
          <div class="rt-desc">${m.desc || ''}</div>
          <div class="rt-meta">深度 0 ~ −${p.maxD}m · ${zonesOfMap(m.id).length} 层海域 · 本图最深 −${p.reached}m</div>
          ${(cur || p.gateOk) ? '' : `<div class="rt-conds">${conds}</div>`}
          ${btn}
        </div>`;
    }).join('');

    return `
      <div class="wallet"><span class="lb">金币</span><span class="amt">${fmt(save.coins)}</span></div>
      <div class="p-note" style="margin:0 0 10px">
        去一片新的海要两样东西：<b>那张海图</b>（首图海沟最底部的宝箱里）+ <b>一艘船</b>（船厂，一万）。
      </div>
      <div class="rt-list">${rows}</div>`;
  }

  // ── App 内容：船厂（v0.7）────────────────────────────────
  /**
   * 三条船，同价 10,000，各带一个效果 —— 买**任意一艘**就能开去极地。
   *
   * 为什么同价：需求里就是这么定的（"支付 10000 元购买任意一艘新船"）。
   * 同价 = 三条路等值，玩家的决策点是**玩法风格**（多卖钱 / 装得多 / 护钩子），
   * 而不是"我还得再攒多少"。已拥有的船**免费换** —— 买断之后随便试。
   *
   * ⚠ 和枪店同一条原则：拥有 / 当前 / 买得起 全部由 game 算好传进来（`handlers.boatList`），
   *   界面不做判断。
   */
  _boatBody(save, handlers) {
    const list = (handlers.boatList && handlers.boatList()) || [];
    const rows = list.map((e) => {
      const d = e.def;
      const hull = `#${(d.hull >>> 0).toString(16).padStart(6, '0')}`;
      const trim = `#${(d.trim >>> 0).toString(16).padStart(6, '0')}`;
      const tag = e.current ? '<span class="gs-tag on">出海中</span>'
        : (e.owned ? '<span class="gs-tag">已拥有</span>' : '');
      let btn;
      if (e.current) btn = '<button class="buy max" disabled>当前船只</button>';
      else if (e.owned) btn = `<button class="gs-go" data-boat-use="${d.id}">换 这 艘</button>`;
      else if (e.affordable) btn = `<button class="gs-go" data-boat-buy="${d.id}">${coinIcon(12)} ${fmtCost(d.price)}</button>`;
      else btn = `<button class="buy lock" disabled>${coinIcon(12)} ${fmtCost(d.price)}</button>`;
      return `
        <div class="bt-item${e.current ? ' cur' : ''}${e.owned ? ' owned' : ''}">
          <div class="bt-h">
            <span class="bt-ico" style="--hull:${hull};--trim:${trim}">${glyph('boat', 24)}</span>
            <div class="bt-t"><b>${d.name}</b><i>${d.en}</i></div>
            ${tag}
          </div>
          <div class="bt-eff">${d.desc}</div>
          <div class="bt-tip">${d.tip}</div>
          <div class="bt-foot">${btn}</div>
        </div>`;
    }).join('');

    return `
      <div class="wallet"><span class="lb">金币</span><span class="amt">${fmt(save.coins)}</span></div>
      <div class="p-note" style="margin:0 0 10px">
        三条船<b>都是一万</b>，各带一个效果 —— 买<b>任意一艘</b>就能开去冰封极地。已拥有的船<b>免费换</b>。
      </div>
      <div class="bt-list">${rows}</div>`;
  }

  // ── App 内容：图鉴 ───────────────────────────────────────
  /**
   * 两级分组：**地图 → 海域**，海域内按身价升序。
   * 未开放的地图（MAPS 里 unlocked:false）显示成"敬请期待"，让多地图结构可见。
   * 未钓到的鱼：黑色剪影 + 名字锁成 ？？？，只透露"这一层有鱼"这个线索。
   */
  _codexBody(save, order) {
    // ⚠ v0.7：哪张图"已经可以去"不再看许可证（两张图的许可证都是 0 了），
    //   而是看 game 的门槛判定（首图 = 天生拥有；其余图 = 海图 + 船）。
    //   判断仍然只有一个来源 —— `mapProgress`，这里只是把它翻成"分组是否解锁"。
    const routes = (this._phone && this._phone.handlers.mapList && this._phone.handlers.mapList()) || [];
    const reachable = new Set(routes.filter((p) => p.owned).map((p) => p.map.id));
    const groups = groupByMap(order, (m) => reachable.has(m.id));
    const got = order.filter((d) => save.codex[d.id]).length;

    return `
      <div class="cx-top">
        <span class="cx-total">已收集 <b>${got}</b> / ${order.length}</span>
        <span class="cx-tiph">地图 → 海域 · 越往下越贵</span>
      </div>
    ` + groups.map((g) => {
      const mine = order.filter((d) => mapOfSpecies(d).id === g.map.id);
      const found = mine.filter((d) => save.codex[d.id]).length;
      const head = `
        <div class="cx-map-h" style="--zc:${brighten(g.map.color, 0.35)}">
          <b>${g.map.name}</b><i>${g.map.en} · 地图</i>
          <span class="cx-prog">${found}/${mine.length}</span>
        </div>
        <div class="cx-map-desc">${g.map.desc || ''}</div>`;

      if (g.locked) {
        // 有海域 = 这张图已经做好了，只是玩家还没到过 → 指路；
        // 没海域 = 还没做（MAPS 里还没铺 ZONES）→ 敬请期待。
        return `<div class="cx-map">${head}
          <div class="cx-locked-box">${zonesOfMap(g.map.id).length
            ? '海域尚未抵达 · 打开手机里的「航线」App 看看怎么去'
            : '这片海域尚未开放 · 敬请期待'}</div>
        </div>`;
      }

      const zones = g.zones.map((z) => {
        const zfound = z.list.filter((d) => save.codex[d.id]).length;
        const items = z.list.map((def) => {
          const rec = save.codex[def.id];
          const known = !!rec;
          const nm = known
            ? `${def.name}${def.hazard ? `<span class="cx-haz">${iconText('warn', '扣钱', 10)}</span>` : ''}`
            : '？ ？ ？';
          const meta = known
            // 血量改成「一颗心 + 数字」：v0.4 之后血量最高 120，画 120 颗心会直接撑爆一行。
            // 数字也更好用 —— 玩家能一眼算出"我这几枪够不够"。
            ? `<span class="cx-hp" title="血量 ${def.hp}">${glyph('heart', 11)}<b>${def.hp}</b></span>`
              + `<span class="cx-val">${coinIcon(12)} ${def.value}</span>`
              + `<span class="cx-cnt">钓到 ${rec.n} 次 · 最高 ${rec.best}</span>`
            : '<span class="cx-lock">未 钓 获</span>';
          // 小鲟的注脚（批 5）：**只有"有话可说"的鱼才有** —— 见 story.js 的 CODEX_NOTE。
          // 给每条鱼硬凑一句会让注脚从"彩蛋"变成"必须读完的作业"。
          const note = (known && this._phone && this._phone.handlers.codexNote)
            ? this._phone.handlers.codexNote(def.id) : null;
          const desc = known
            ? def.desc
            : (z.zone.top === 0
              // 最浅那层 top = 0，写"−0m 以下"不通顺，改成直接点名海域
              ? `这片${z.zone.nick || z.zone.name + '海域'}里还有一条没见过的鱼。往下潜一潜就能碰上。`
              : `这一层海域里还有一条没见过的鱼。把鱼线放到 −${-z.zone.top}m 以下试试。`);
          return `
          <div class="cx-item ${known ? 'known' : 'locked'}${def.hazard ? ' haz' : ''}" data-id="${def.id}">
            <canvas class="cx-ico" aria-hidden="true"></canvas>
            <div class="cx-info">
              <div class="cx-nm">${nm}</div>
              <div class="cx-meta">${meta}</div>
              <div class="cx-desc">${desc}</div>
              ${note ? `<div class="cx-note">${note}</div>` : ''}
              <div class="cx-where">${g.map.name} · ${zoneLabel(def)}</div>
            </div>
          </div>`;
        }).join('');
        return `
        <div class="cx-zone">
          <div class="cx-zone-h" style="--zc:${brighten(z.zone.color, 0.35)}">
            <b>${z.zone.nick || z.zone.name + '海域'}</b><i>${z.zone.name}海域 · ${z.zone.en}</i>
            <span class="cx-range">−${-z.zone.top}m ~ −${-z.zone.bottom}m</span>
            <span class="cx-prog">${zfound}/${z.list.length}</span>
          </div>
          ${items}
        </div>`;
      }).join('');

      return `<div class="cx-map">${head}<div class="cx-zones">${zones}</div></div>`;
    }).join('');
  }

  /** 图鉴图标：canvas 现画（未解锁 = 纯黑剪影），不占额外资源 */
  _paintCodexIcons(root, save, order, W, H) {
    const byId = new Map(order.map((d) => [d.id, d]));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const node of root.querySelectorAll('.cx-item')) {
      const def = byId.get(node.dataset.id);
      const cv = node.querySelector('.cx-ico');
      if (!def || !cv) continue;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px';
      cv.style.height = H + 'px';
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawFishIcon(ctx, def, W, H, !!save.codex[def.id]);
    }
  }

  // ── App 内容：设置 ───────────────────────────────────────
  _settingsBody(save, handlers) {
    const muted = handlers.getMuted();
    const best = Math.max(0, Math.round(save.bestDepth || 0));
    return `
      <div class="p-sec">声 音</div>
      <div class="p-row">
        <span class="p-r-ico">${glyph(muted ? 'mute' : 'sound', 18)}</span>
        <div class="p-r-t"><b>游戏音效</b><span>全部音效由 WebAudio 实时合成，零音频文件</span></div>
        <button class="p-switch ${muted ? '' : 'on'}" id="pSound" aria-label="音效开关"></button>
      </div>

      <div class="p-sec">记 录</div>
      <div class="p-row">
        <span class="p-r-ico">${coinIcon(18)}</span>
        <div class="p-r-t"><b>金币 ${fmt(save.coins)}</b><span>累计赚取 ${fmt(save.totalEarned || 0)}</span></div>
      </div>
      <div class="p-row">
        <span class="p-r-ico">${glyph('info', 18)}</span>
        <div class="p-r-t"><b>最深 ${best}m · 最高飞行 ${Math.round(save.bestAlt || 0)}m</b>
          <span>累计抛竿 ${save.casts} 次 · 本图最深 −${Math.round(save.mapBest?.[this._map.id] || 0)}m</span></div>
      </div>

      <div class="p-sec">操 作 说 明</div>
      <div class="p-note">
        ① <b>下潜</b> · 点屏幕抛竿，左右拖动躲开鱼，碰到就自动收线<br>
        ② <b>上升</b> · 上升时撞到的鱼才会被串上鱼线<br>
        ③ <b>天空</b> · 用当前装备的枪把鱼打下来（长按连发 / 点按单发）<br>
        ④ <b>手机</b> · 渔具店 / 枪店 / 图鉴 / 航线 / 设置；<b>收起手机后</b>点画面才抛竿
      </div>

      <div class="p-sec">数 据</div>
      <div class="p-row danger tap" id="pReset">
        <span class="p-r-ico">${glyph('trash', 18)}</span>
        <div class="p-r-t"><b>清空存档</b><span>金币 / 升级 / 纪录 / 图鉴全部重置，不可撤销</span></div>
      </div>
      <div class="p-row tap" id="pExit">
        <span class="p-r-ico">${glyph('phone', 18)}</span>
        <div class="p-r-t"><b>收起手机</b><span>回到船上（也可以点手机外的空白处）</span></div>
      </div>

      <div class="p-sec">关 于</div>
      <div class="p-note">
        <b>HOOKED · 荒谬钓鱼</b><br>
        当前地图：${this._map.name}（${this._map.en}）· 深度上限 −${mapMaxDepth(this._map)}m<br>
        Three.js 程序化生成全部美术资源，无外部模型 / 贴图 / 音频文件。
      </div>`;
  }

  // ── 遮罩（标题页 / 结算 / 确认框）─────────────────────────
  hideOverlay() {
    this.el.overlay.classList.add('hidden');
    this.el.overlay.innerHTML = '';
  }

  _card(html) {
    this.el.overlay.classList.remove('hidden');
    this.el.overlay.innerHTML = `<div class="card">${html}</div>`;
    return this.el.overlay.querySelector('.card');
  }

  // 标题页
  showTitle(save, handlers) {
    const card = this._card(`
      <h1>HOOKED</h1>
      <div class="sub">荒 谬 钓 鱼</div>
      <div class="rulelist">
        <div>① <b>下潜</b> · 点屏幕抛竿，<span class="k">左右拖动</span>躲开鱼——碰到就自动收线</div>
        <div>② <b>上升</b> · 上升时撞到的鱼<span class="g">才会被串上鱼线</span>，左右移动多抓几条</div>
        <div>③ <b>天空</b> · 渔获按身价飞向高空，用<span class="k">枪</span>把它们打下来（长按连发 / 点按单发）</div>
        <div>④ <b>手机</b> · 左下角手机里装着<span class="g">渔具店 / 枪店 / 图鉴 / 航线 / 设置</span>五个 App</div>
      </div>
      <div class="result-rows">
        <div class="rrow"><span>地图</span><b>${this._map.name}</b></div>
        <div class="rrow"><span>金币</span><b>${fmt(save.coins)}</b></div>
        <div class="rrow"><span>最深纪录</span><b>${save.bestDepth} m</b></div>
        <div class="rrow"><span>最高飞行</span><b>${save.bestAlt || 0} m</b></div>
        <div class="rrow"><span>累计抛竿</span><b>${save.casts}</b></div>
      </div>
      <button class="btn gold" id="startBtn">开 始 钓 鱼</button>
      <button class="btn ghost" id="resetBtn">清空存档</button>
    `);
    card.querySelector('#startBtn').onclick = handlers.start;
    card.querySelector('#resetBtn').onclick = handlers.reset;
  }

  // 结算
  showResult(r, handlers) {
    const medals = [
      [0, '再 接 再 厉'],
      [3, '不 错 的 一 竿'],
      [7, '渔 获 颇 丰'],
      [12, '满 载 而 归'],
      [18, '钓 鱼 大 师'],
    ];
    let medal = medals[0][1];
    if (r.caught >= 18) medal = medals[4][1];
    else if (r.caught >= 12) medal = medals[3][1];
    else if (r.caught >= 7) medal = medals[2][1];
    else if (r.caught >= 3) medal = medals[1][1];

    const escapes = r.escaped.length
      ? `<div class="escape-list">${r.escaped.map((n) => `<span>${n} 逃走了</span>`).join('')}</div>`
      : '';
    // 超时收竿时还挂在天上的鱼（v0.6）。只报条数、不逐条列 ——
    // 那一刻可能挂着十几条，逐条列会把面板撑爆；而且玩家要的是"我漏了几条"，不是"漏了哪几条"。
    const timedOut = r.timedOut
      ? `<div class="escape-list timedout"><span>时间到了 · 还有 ${r.timedOut} 条没打下来</span></div>`
      : '';

    const card = this._card(`
      <h2>本 次 结 算</h2>
      <div class="medal">${medal}</div>
      <div class="result-rows">
        <div class="rrow"><span>下潜深度</span><b>${r.depth} m ${r.newRecord ? '<span class="hi">新纪录!</span>' : ''}</b></div>
        <div class="rrow"><span>最高飞行</span><b>${r.alt || 0} m</b></div>
        <div class="rrow"><span>串上鱼线</span><b>${r.caught} 条</b></div>
        <div class="rrow"><span>空中击落</span><b>${r.shot} 条</b></div>
        <div class="rrow"><span>最高连击</span><b>${r.bestCombo}</b></div>
        <div class="rrow total"><span>本竿收入</span><b>${coinIcon(16)} ${fmt(r.earned)}</b></div>
      </div>
      ${escapes}
      ${timedOut}
      <button class="btn gold" id="nextBtn">回 到 船 上</button>
    `);
    card.querySelector('#nextBtn').onclick = handlers.next;
    return medal;
  }

  // 通用确认
  confirm(title, text, onOk, okText = '确定') {
    const card = this._card(`
      <h2>${title}</h2>
      <div class="rulelist">${text}</div>
      <button class="btn gold" id="okBtn">${okText}</button>
      <button class="btn ghost" id="noBtn">取消</button>
    `);
    card.querySelector('#okBtn').onclick = onOk;
    card.querySelector('#noBtn').onclick = () => this.hideOverlay();
  }
}
