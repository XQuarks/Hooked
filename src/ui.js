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
import { UPGRADES, UPGRADE_ORDER, MAX_LEVEL, upgradeCost, upgradeValueText,
  levelCapForMap, MAPS, DEFAULT_MAP, mapById, mapMaxDepth, mapOfSpecies,
  zonesOfMap, GUNS, GUN_MAX_LEVEL, gunById } from './config.js';
import { codexOrder, zoneLabel, groupByMap, drawFishIcon } from './codex.js';
import { coinIcon, glyph, iconText, heartRow, GLYPH } from './icons.js';

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
 * 满级声呐的探测带半高 = 地图总深度的 14%（两侧各一份，合计照亮 28% 的尺子）。
 * 430m 的宁静海湾上就是 ±60m —— 大约能提前看见下面 3~5 条鱼。
 */
const SONAR_SPAN = 0.14;

/**
 * 商店里 11 项升级的图标 —— **全部走 icons.js 的内联 SVG**。
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
      phoneBtn: $('phoneBtn'),
      phoneIco: $('phoneIco'),
      hint: $('hint'),
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
    this._zone = null;
    this._phone = null;         // { save, handlers, app }
    // 当前地图。**UI 层的唯一真相是这一个字段** —— 深度尺的总长、尺子上的分区、
    // 手机桌面小部件、图鉴 / 设置里的地图名全部读它，不再直接读 DEFAULT_MAP。
    this._map = DEFAULT_MAP;
    this._rulerTotal = mapMaxDepth(DEFAULT_MAP);   // 深度尺的总长 = 当前地图的深度上限
    this._sonarPct = 0;         // 声呐等级（0~1），setSonar 里更新
    this._hookDepth = 0;        // 鱼钩当前深度，声呐探测带的中心
    this._fillIcons();
    this._buildRuler();
  }

  // ── 地图 ─────────────────────────────────────────────────
  /**
   * 换到某张地图。深度尺的总长和尺子上的分区色带都要重建 ——
   * 宁静海湾是 430m / 5 层，冰封极地是 620m / 5 层，尺子直接换个量程。
   *
   * ⚠ 重建之后必须把 `_sonarPct` 重新灌一遍：`setSonar` 只存值，
   *   探测带的半高是按 `_rulerTotal` 算的，尺子换量程后旧带子会停在上一个量程的位置。
   */
  setMap(map) {
    this._map = mapById(map && map.id);
    this._rulerTotal = mapMaxDepth(this._map);
    this._buildRuler();
    this._paintSonar();
    // 不在这里重绘 App：换图是 game.enterMap 发起的，它会紧接着调 refreshApp()。
    // 这里再刷一次的话，航线 App 的按钮会在点击处理过程中被重建（点了个寂寞）。
  }

  /** 当前地图在 MAPS 里的下标（商店的分段等级闸门要它） */
  get mapIndex() { return Math.max(0, MAPS.findIndex((m) => m.id === this._map.id)); }

  // ── 图标注入（唯一来源：icons.js）─────────────────────────
  _fillIcons() {
    this.el.coinIco.innerHTML = coinIcon(14);
    this.el.depthIco.innerHTML = glyph('wave', 14);
    this.el.phoneIco.innerHTML = glyph('phone', 19);
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
    this._hookDepth = Number.isFinite(cur) ? Math.max(0, cur) : d;
    this._paintSonar();
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

    // 声呐探测带（升级项 sonar）：以鱼钩为中心的一条带 + 带内鱼的位置刻度。
    // 整层始终在 DOM 里，靠 .on 控制显隐 —— 声呐 0 级时完全不出现。
    this._sonar = document.createElement('div');
    this._sonar.className = 'sonar';
    this._sonar.innerHTML = '<div class="s-band"></div><div class="s-blips"></div>';
    this.el.ruler.appendChild(this._sonar);
    this._sBand = this._sonar.querySelector('.s-band');
    this._sBlips = this._sonar.querySelector('.s-blips');
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

  // ── 声呐 ─────────────────────────────────────────────────
  /**
   * 声呐（升级项 `sonar`）：在深度尺上以鱼钩为中心画一条探测带，带内的鱼显示成刻度。
   *
   * 为什么是"围绕鱼钩的一条带"而不是"整把尺子全部点亮"：
   * 声呐的用途是**决定还要不要再往下**。整张图全亮等于把探索直接跳过去；
   * 只亮眼前这一段，才会产生"再放 40m 看看"这个决策 —— 而这正是升级该买的东西。
   *
   * 带宽按**地图总深度的百分比**算（而不是固定米数）：这样换到更深的地图时，
   * 满级声呐的视野不会跟着缩水，否则升级的收益会被地图稀释掉。
   *
   * @param {number} pct 0~1（= LEVELS.sonar 的值 / 100）。0 表示没有声呐，整层隐藏。
   */
  setSonar(pct) {
    this._sonarPct = Number.isFinite(pct) ? Math.max(0, Math.min(1, pct)) : 0;
    if (this._sonar) this._sonar.classList.toggle('on', this._sonarPct > 0);
    if (this._sonarPct <= 0 && this._sBlips) this._sBlips.innerHTML = '';
    this._paintSonar();
  }

  /** 探测带半高（世界单位 = 米） */
  get _sonarHalf() { return this._sonarPct * this._rulerTotal * SONAR_SPAN; }

  /** 把探测带挪到当前鱼钩深度上（setDepth 每帧调） */
  _paintSonar() {
    if (!this._sBand || !this._sonarPct) return;
    const total = this._rulerTotal;
    const c = this._hookDepth || 0;
    const top = Math.max(0, c - this._sonarHalf);
    const bot = Math.min(total, c + this._sonarHalf);
    this._sBand.style.top = `${(top / total) * 100}%`;
    this._sBand.style.height = `${((bot - top) / total) * 100}%`;
  }

  /**
   * 探测带里的鱼 → 尺子上的刻度。
   * 由 game 每隔 ~0.15s 喂一次（不是每帧 —— 每帧重建 DOM 纯属浪费）。
   * 只挑落在带内的：带外的鱼就算喂进来也不画。
   * @param {Array<{d:number, hot:boolean}>} list 每条鱼的深度（米，正数）
   */
  setSonarBlips(list) {
    if (!this._sBlips) return;
    if (!this._sonarPct || !list || !list.length) {
      if (this._sBlips.childElementCount) this._sBlips.innerHTML = '';
      return;
    }
    const total = this._rulerTotal;
    const c = this._hookDepth || 0;
    const half = this._sonarHalf;
    const hit = list.filter((b) => Math.abs(b.d - c) <= half);
    this._sBlips.innerHTML = hit.map((b) => {
      const top = Math.min(100, (b.d / total) * 100);
      return `<i class="s-blip${b.hot ? ' hot' : ''}" style="top:${top}%"></i>`;
    }).join('');
  }

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
  }

  // ── 收线按钮 / 手机入口 / 提示 ────────────────────────────
  showReel(v) { this.el.reelBtn.classList.toggle('on', v); }

  /** 手机入口：只在待机（船上）时出现 —— 商店 / 图鉴 / 设置 全在里面 */
  showPhoneBtn(v) { this.el.phoneBtn.classList.toggle('on', v); }

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
    // 兜底：倍率缺失时按 ×1 显示。枪械条是每帧刷的 HUD，
    // 这里抛一次异常就会把整个 _updateAir 打断（症状是"鱼打不死、也不结算"）。
    const mul = Number.isFinite(g.mul) ? g.mul : 1;
    let ammo = `×${mul.toFixed(2)}`;
    if (reloading) ammo = '换弹…';
    else if (g.mech === 'laser') {
      // 激光读的是"当前递增到几倍"，玩家才知道"再照一会儿更疼"
      ammo = `×${(1 + Math.min(g.rampMax || 0, (g.ramp || 0) * g.heat)).toFixed(1)}`;
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
    const apps = [['shop', '渔具店'], ['gunshop', '枪店'], ['codex', '鱼图鉴'],
      ['route', '航线'], ['settings', '设置']]
      .map(([id, nm]) => `
        <button class="p-app-item" data-app="${id}">
          <span class="p-ico ${id}">${glyph(id, 28)}</span><span>${nm}</span>
        </button>`).join('');

    // 图鉴进度只算**本图**的鱼种。全局进度放在图鉴 App 里，
    // 桌面上这个数字要和「航线」的解锁条件（本图 75%）对得上。
    const order = codexOrder();
    const mine = order.filter((d) => mapOfSpecies(d).id === map.id);
    const got = mine.filter((d) => save.codex[d.id]).length;
    const pct = Math.round((got / Math.max(1, mine.length)) * 100);

    this.el.pHome.innerHTML = `
      <div class="p-widget">
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
      <div class="p-note" style="margin:0 14px">渔具店 / 枪店 / 图鉴 / 航线 / 设置都装在这台手机里 —— 点图标打开 App。想抛竿就先收起手机，再点一下画面。</div>
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
    this._phone.app = id;
    this.el.pHome.classList.add('hidden');
    this.el.pApp.classList.remove('hidden');
    this._renderApp();
    this.el.pApp.scrollTop = 0;
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
    if (id === 'shop') html = this._appShell('渔 具 店', `金币 ${fmt(save.coins)}`, this._shopBody(save, this.mapIndex));
    else if (id === 'gunshop') html = this._appShell('枪 店', `金币 ${fmt(save.coins)}`, this._gunshopBody(save, handlers));
    else if (id === 'codex') html = this._appShell('鱼 类 图 鉴', '按地图 · 深度排序', this._codexBody(save, order));
    else if (id === 'route') html = this._appShell('航 线', `金币 ${fmt(save.coins)}`, this._routeBody(save, handlers));
    else if (id === 'settings') html = this._appShell('设 置', 'v1.0', this._settingsBody(save, handlers));

    this.el.pApp.innerHTML = html;

    const back = this.el.pApp.querySelector('[data-back]');
    if (back) back.onclick = () => { handlers.tap && handlers.tap(); this.showPhoneHome(); };

    if (id === 'shop') {
      this.el.pApp.querySelectorAll('.buy[data-k]').forEach((b) => {
        b.onclick = () => handlers.buy(b.dataset.k);
      });
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

  // ── App 内容：商店 ───────────────────────────────────────
  /**
   * 11 项 × 20 级。三件事和 5 项时代不一样：
   *
   *   1. **数值文案从 LEVELS 现取**（`upgradeValueText`），不再在 UPGRADES 里手写 5 个字符串 ——
   *      20 个等级 × 11 项手写必然错位。
   *   2. **等级用 20 格进度条**而不是 5 颗点。21 颗点在这个宽度里会糊成一条线。
   *   3. **分段封顶**：本图只开到 `levelCapForMap(mapIndex)`。满了之后按钮变成「本图满级」，
   *      这就是"该换地图了"的信号（见 config.js 的 MAP_LEVEL_CAP）。
   */
  _shopBody(save, mapIndex = 0) {
    const cap = levelCapForMap(mapIndex);
    const licenses = save.licenses || [];
    let lastTier = '';

    const rows = UPGRADE_ORDER.map((key) => {
      const u = UPGRADES[key];
      const lv = save.levels[key];
      const locked = !!u.unlockMap && !licenses.includes(u.unlockMap);
      const maxed = lv >= MAX_LEVEL;          // 全局满级
      const capped = !maxed && lv >= cap;     // 本图这一段已经买满
      const cost = upgradeCost(key, lv);
      const afford = !locked && !capped && save.coins >= cost;

      const cur = upgradeValueText(key, lv);
      const next = capped ? null : upgradeValueText(key, lv + 1);
      // 单位只在**行尾**出现一次：`1033 → 1100m`，而不是 `1033m → 1100m`。
      // 商店那一列只有 ~176px，重复一遍单位要多占 14~28px，满级附近的长数字
      // 叠上重复单位就必然折行。封顶时（没有 → ）也要带上单位，否则当前值成了裸数字。
      const nx = next ? `${cur} → ${next}${u.unit}` : `${cur}${u.unit}`;
      const pips = Array.from({ length: MAX_LEVEL },
        (_, i) => `<i class="${i < lv ? 'f' : ''}"></i>`).join('');

      const tierHead = u.tier !== lastTier ? `<div class="tier-h">${u.tier}</div>` : '';
      lastTier = u.tier;

      // 三种"不能买"的状态也带上 data-k —— 少了它，任何按 key 定位按钮的代码
      // （自动化回归、将来的"跳到某项"功能）在封顶时就查不到元素了。
      let btn;
      if (locked) btn = `<button class="buy lock" data-k="${key}" disabled>未解锁</button>`;
      else if (maxed) btn = `<button class="buy max" data-k="${key}" disabled>MAX</button>`;
      else if (capped) btn = `<button class="buy cap" data-k="${key}" disabled>本图满级</button>`;
      // 价格走 fmtCost：满级附近是 `106万` 而不是 `1,057,128`，
      // 按钮不会被撑宽，右边那列文案也就不会被挤到折行（见 fmtCost 的注释）。
      else btn = `<button class="buy" data-k="${key}" ${afford ? '' : 'disabled'}>${coinIcon(12)} ${fmtCost(cost)}</button>`;

      return `${tierHead}
        <div class="item ${afford ? 'afford' : ''}">
          <div class="icon">${glyph(u.icon, 19)}</div>
          <div class="info">
            <div class="nm">${u.name}<span class="lv">Lv.${lv} / ${MAX_LEVEL}</span></div>
            <div class="ds">${u.desc} · <span class="nx">${nx}</span></div>
            <div class="pips">${pips}</div>
          </div>
          ${btn}
        </div>`;
    }).join('');

    return `
      <div class="wallet"><span class="lb">金币</span><span class="amt">${fmt(save.coins)}</span></div>
      <div class="p-note" style="margin:0 0 10px">
        本图开放至 <b>Lv.${cap}</b> / ${MAX_LEVEL} —— 买满后换一片海继续往上堆。
      </div>
      <div class="shop-list">${rows}</div>`;
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
        <div class="gs-item${e.current ? ' cur' : ''}${e.owned ? ' owned' : ' locked'}">
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
        每把枪可升 <b>${GUN_MAX_LEVEL}</b> 级 · 「攻击力」是所有枪共用的伤害倍率，在渔具店里升。
      </div>
      <div class="gs-list">${rows}</div>`;
  }

  // ── App 内容：航线（换地图）───────────────────────────────
  /**
   * 多地图的入口。每张图一张卡，卡上把「怎么才能去」摊开写清楚：
   *
   *   ① 图鉴 ≥ 75%   —— 逼玩家把这张图真的玩透（去不同深度、钓不同的鱼）
   *   ② 潜到过本图上限 —— 免费，但让"潜到底"成为明确目标
   *   ③ 许可证金币    —— 辅助条件，只负责"让换图有一点成本感"
   *
   * 三个条件**同时**列出来（而不是只显示最缺的那一个）：玩家能看到自己卡在哪一条，
   * 也能看到"另外两条已经绿了"。数据全部来自 game.mapProgress —— 界面和判定
   * 共用同一个来源，不会出现"按钮亮了却买不了"。
   */
  _routeBody(save, handlers) {
    const list = (handlers.mapList && handlers.mapList()) || [];
    const curId = this._map.id;

    const rows = list.map((p) => {
      const m = p.map;
      const cur = m.id === curId;
      const icon = m.id === 'calm-bay' ? 'wave' : 'iceberg';
      const conds = [
        { ok: p.codexOk, t: `图鉴 ${p.codex}/${p.codexTotal}` },
        { ok: p.depthOk, t: `潜至 ${p.reached}/${p.maxD}m` },
        { ok: p.affordable, t: `金币 ${fmtCost(p.price)}` },
      ].map((c) => `<span class="rt-c ${c.ok ? 'ok' : ''}">${c.t}</span>`).join('');

      let btn;
      if (cur) btn = `<button class="buy max" disabled>当前所在</button>`;
      else if (p.owned) btn = `<button class="rt-go" data-map="${m.id}">前 往</button>`;
      else if (p.canBuy) btn = `<button class="rt-go" data-map="${m.id}">${coinIcon(12)} ${fmtCost(p.price)}</button>`;
      else btn = `<button class="buy lock" disabled>条件未满</button>`;

      const tag = cur ? '<span class="rt-tag on">当前</span>'
        : (p.owned ? '<span class="rt-tag">已解锁</span>' : '');

      return `
        <div class="rt-item${cur ? ' cur' : ''}${p.owned ? ' owned' : ''}">
          <div class="rt-h">
            <span class="rt-ico">${glyph(icon, 20)}</span>
            <div class="rt-t"><b>${m.name}</b><i>${m.en}</i></div>
            ${tag}
          </div>
          <div class="rt-desc">${m.desc || ''}</div>
          <div class="rt-meta">深度 0 ~ −${p.maxD}m · ${zonesOfMap(m.id).length} 层海域 · 本图最深 −${p.reached}m</div>
          ${(cur || p.owned) ? '' : `<div class="rt-conds">${conds}</div>`}
          ${btn}
        </div>`;
    }).join('');

    return `
      <div class="wallet"><span class="lb">金币</span><span class="amt">${fmt(save.coins)}</span></div>
      <div class="p-note" style="margin:0 0 10px">
        换一片海需要：<b>本图图鉴 75%</b> · <b>潜到过本图上限</b> · <b>付许可证</b>。
      </div>
      <div class="rt-list">${rows}</div>`;
  }

  // ── App 内容：图鉴 ───────────────────────────────────────
  /**
   * 两级分组：**地图 → 海域**，海域内按身价升序。
   * 未开放的地图（MAPS 里 unlocked:false）显示成"敬请期待"，让多地图结构可见。
   * 未钓到的鱼：黑色剪影 + 名字锁成 ？？？，只透露"这一层有鱼"这个线索。
   */
  _codexBody(save, order) {
    const licenses = save.licenses || [];
    const groups = groupByMap(order, (m) => m.license <= 0 || licenses.includes(m.id));
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
        // 有许可证价格 = 这张图已经做好了，只是玩家还没拿到 → 指路；
        // 没有价格 = 还没做（MAPS 里 unlocked:false）→ 敬请期待。
        return `<div class="cx-map">${head}
          <div class="cx-locked-box">${g.map.license > 0
            ? '尚未取得许可证 · 打开手机里的「航线」App 看看怎么去'
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
