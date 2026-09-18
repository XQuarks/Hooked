/**
 * icons.js — 内联 SVG 图标表（**替代 emoji 图标**）
 *
 * 为什么要有这个文件（需求②的修复方案）：
 *   金币图标原来是 emoji「🪙」（U+1FA99）。emoji 不是资源文件，它靠**宿主的 emoji 字体**
 *   渲染 —— 而 U+1FA99 是 Emoji 11.0（2018 年）才新增的码位，比较老的 emoji 字体里没有这个
 *   字形，宿主就会画成一个"豆腐块"（□）或者干脆空白。游戏的字体栈
 *   `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, …` 里也**一个 emoji
 *   字体都没有声明**，能不能画出来完全靠浏览器兜底 —— 换个宿主环境（内嵌预览面板 / 无头截图
 *   服务 / 精简字体环境）就会挂。
 *   另外彩色 emoji 是**位图字形**：不受 `color` 影响、不随字号线性缩放（实测 13px 字号下
 *   占位 17.9×19px），在深色 chip 里既压不住基线也没法用游戏自己的金色。
 *
 *   所以统一改成**内联 SVG**：矢量、随字号缩放、颜色由我们定、不依赖任何字体。
 *
 * 约定：
 *   - 每个图标都是完整的 `<svg>` 字符串，可以塞进任何 innerHTML。
 *   - 只画几何形状，**不用 <defs>/<linearGradient>**：同一个图标会在页面里出现很多次，
 *     重复的 id 会互相干扰（先出现的定义赢，元素被移除后引用就断）。渐变一律用
 *     "深色底 + 亮色面 + 高光" 三层纯色叠出来，视觉等价且绝对安全。
 *   - 单色图标用 `currentColor`，跟着 CSS 的 color 走。
 */

const wrap = (body, size = 24, extra = '') =>
  `<svg class="svg-ico${extra}" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
  `aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

/** 五角星：金币正面的图案（比"¥"更中性，小尺寸下也认得出） */
const STAR_5 = 'M12 7.4 L13.12 10.46 L16.37 10.58 L13.81 12.59 L14.7 15.72 ' +
  'L12 13.9 L9.3 15.72 L10.19 12.59 L7.63 10.58 L10.88 10.46 Z';

/**
 * 八芒爆炸星（攻击力图标）。
 * ⚠ 容易踩的坑：**N 芒星需要 2N 个顶点**（N 个外尖 + N 个内凹）。
 * 只给 8 个顶点的话画出来是「四芒星 + 四个凹口」，看着像 ✦ 而不是爆炸。
 * 所以这里按 22.5° 步长生成 16 个顶点，外尖 R=10.6、内凹 r=4.6。
 */
const BURST_8 = (() => {
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const a = Math.PI / 2 - (i * Math.PI) / 8;   // 从正上方开始，每 22.5° 一个顶点
    const r = i % 2 === 0 ? 10.6 : 4.6;          // 偶数索引是外尖，奇数索引是内凹
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12 - r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
})();

/**
 * 金币：三层纯色叠出立体感 ——
 * 深金描边盘 → 亮金盘面 → 顶部高光 + 内圈 + 五角星。
 */
export function coinIcon(size = 14, cls = '') {
  return wrap(`
    <circle cx="12" cy="12" r="10.4" fill="#c8890c"/>
    <circle cx="12" cy="12" r="9" fill="#ffcc33"/>
    <path d="M12 3.6a8.4 8.4 0 0 0-8.4 6.1A8.4 8.4 0 0 1 12 4.9a8.4 8.4 0 0 1 8.4 4.8A8.4 8.4 0 0 0 12 3.6Z" fill="#ffe89a"/>
    <circle cx="12" cy="12" r="6.4" fill="none" stroke="#c8890c" stroke-width="1.1" opacity="0.55"/>
    <path d="${STAR_5}" fill="#b8790a"/>
  `, size, cls);
}

/** 齿轮（设置）：外圈用 evenodd 挖空 + 8 根齿，纯色合并成一个形状 */
const GEAR = (() => {
  const teeth = [];
  for (let i = 0; i < 8; i++) {
    teeth.push(`<rect x="10.7" y="1.3" width="2.6" height="4.7" rx="1.1"` +
      (i ? ` transform="rotate(${i * 45} 12 12)"` : '') + '/>');
  }
  return `<g fill="currentColor">${teeth.join('')}` +
    '<path fill-rule="evenodd" d="M12 5.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6Z' +
    'm0 2.5a4.3 4.3 0 1 1 0 8.6 4.3 4.3 0 0 1 0-8.6Z"/></g>';
})();

/**
 * 单色图标表：值 = 一段 SVG 内容，用 currentColor 上色。
 * 这些图标要么是手机 App 图标（配彩色圆角底），要么是商店里的升级项图标。
 */
export const GLYPH = {
  // 渔具店：带雨棚的店铺
  shop: `<g fill="currentColor">
    <path d="M3.4 9.2 4.7 4.6A1.8 1.8 0 0 1 6.4 3.4h11.2a1.8 1.8 0 0 1 1.7 1.2l1.3 4.6Z"/>
    <path d="M4.6 10.6h14.8v7.6a2.4 2.4 0 0 1-2.4 2.4H7a2.4 2.4 0 0 1-2.4-2.4Z" opacity="0.82"/>
    <path d="M10 20.6v-5.2a1.4 1.4 0 0 1 1.4-1.4h1.2a1.4 1.4 0 0 1 1.4 1.4v5.2Z" fill="#000" opacity="0.35"/>
  </g>`,
  // 图鉴：翻开的书
  codex: `<g fill="currentColor">
    <path d="M11 6.2C9.6 4.9 7.6 4.4 4.4 4.6a1.2 1.2 0 0 0-1.1 1.2v11.4c0 .8.7 1.4 1.5 1.3 2.8-.2 4.6.3 6.2 1.5Z" opacity="0.9"/>
    <path d="M13 6.2c1.4-1.3 3.4-1.8 6.6-1.6a1.2 1.2 0 0 1 1.1 1.2v11.4c0 .8-.7 1.4-1.5 1.3-2.8-.2-4.6.3-6.2 1.5Z"/>
    <path d="M11.2 7.6h1.6v12.4a1 1 0 0 1-1.6 0Z" fill="#000" opacity="0.3"/>
  </g>`,
  settings: GEAR,
  // ⚠ v0.4.1 删掉了 `cast`（鱼竿）图标：它唯一的用处是手机底部那条 Dock 的「抛竿」按钮，
  //   而那条 Dock 已经移除（手机里不再有抛竿入口）。
  //   留着它 = 留一个永远渲染不出来的图标，还会让 shots-icons 的总览图多一格噪音。
  // 鱼钩（升级项）
  hook: `<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
    <path d="M15.6 3.2v10.4"/>
    <path d="M15.6 13.6a4.2 4.2 0 1 1-4.2 4.2"/>
    <path d="M9.2 15.6 11.4 18l2.6-2.6"/>
  </g>`,
  // 鱼线（升级项）：缠满线的卷线轴 —— 上下两片法兰 + 中间线团
  line: `<g fill="currentColor">
    <rect x="4.2" y="3.4" width="15.6" height="3.4" rx="1.6"/>
    <rect x="4.2" y="17.2" width="15.6" height="3.4" rx="1.6"/>
    <rect x="6.4" y="7.4" width="11.2" height="9.2" rx="1.5" opacity="0.62"/>
    <path d="M9.4 7.6v8.8M12 7.6v8.8M14.6 7.6v8.8" fill="none" stroke="#000" stroke-width="1" opacity="0.3"/>
  </g>`,
  // 铅坠（升级项）：水滴形坠子 + 顶部挂环
  sinker: `<g fill="currentColor">
    <path fill-rule="evenodd" d="M12 2.2a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Zm0 1.6a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6Z"/>
    <path d="M12 6.6c3.7 0 6.5 3.1 6.5 6.9 0 4.6-3.1 8.3-6.5 8.3s-6.5-3.7-6.5-8.3c0-3.8 2.8-6.9 6.5-6.9Z"/>
    <path d="M12 9.6v9.2" fill="none" stroke="#000" stroke-width="1.1" opacity="0.26"/>
  </g>`,
  // 攻击力（升级项）：八芒爆炸星（16 个顶点，见上面的 BURST_8）
  // ⚠ v0.5：「攻击力」升级项已删除，图标保留备用（枪店/伤害飘字将来可能要用）。
  //   删掉它要连带确认没有别处 glyph('power') —— 目前全项目零调用。
  power: `<path fill="currentColor" d="M${BURST_8}Z"/>`,
  // 灯具（升级项）：灯泡 + 灯头
  lamp: `<g fill="currentColor">
    <path d="M12 2.4a6.4 6.4 0 0 0-4.1 11.4v2.3a1.5 1.5 0 0 0 1.5 1.5h5.2a1.5 1.5 0 0 0 1.5-1.5v-2.3A6.4 6.4 0 0 0 12 2.4Z"/>
    <path d="M9.6 19.1h4.8v1.6a1.3 1.3 0 0 1-1.3 1.3h-2.2a1.3 1.3 0 0 1-1.3-1.3Z" opacity="0.72"/>
  </g>`,
  // 海面 / 深度（HUD 深度 chip）
  wave: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <path d="M2.6 8.6c1.5-1.7 3-1.7 4.5 0s3 1.7 4.5 0 3-1.7 4.5 0 3 1.7 4.5 0"/>
    <path d="M2.6 15.4c1.5-1.7 3-1.7 4.5 0s3 1.7 4.5 0 3-1.7 4.5 0 3 1.7 4.5 0"/>
  </g>`,
  // 血量（图鉴）：一颗心
  heart: `<path fill="currentColor" d="M12 20.6c-.35 0-.7-.13-.96-.37C7.4 17.1 3.2 13.9 3.2 9.9 3.2 7.2 5.3 5.1 7.9 5.1c1.65 0 3.1.83 4.1 2.2 1-1.37 2.45-2.2 4.1-2.2 2.6 0 4.7 2.1 4.7 4.8 0 4-4.2 7.2-7.84 10.33-.26.24-.61.37-.96.37Z"/>`,
  // 手机（主界面入口按钮）
  phone: `<g fill="currentColor">
    <path fill-rule="evenodd" d="M7.4 2.4h9.2A2.4 2.4 0 0 1 19 4.8v14.4a2.4 2.4 0 0 1-2.4 2.4H7.4A2.4 2.4 0 0 1 5 19.2V4.8a2.4 2.4 0 0 1 2.4-2.4Zm.4 2.4v11.4h8.4V4.8Z"/>
    <circle cx="12" cy="19.1" r="1.15"/>
  </g>`,
  // 电话（来电 / 通话记录 App）：一个**听筒**剪影。
  // ⚠ 刻意和 `phone`（智能手机方框）区分开 —— 那个是"手机入口"，这个是"打电话"。
  //   两者在同一个界面里会同时出现（手机按钮 vs 来电头像），不能撞形。
  call: `<path fill="currentColor" d="M8.1 3.2c.5-.5 1.35-.42 1.75.17l1.7 2.5c.35.5.3 1.17-.1 1.62l-1.06 1.2a.6.6 0 0 0-.07.7 11.6 11.6 0 0 0 4.3 4.3.6.6 0 0 0 .7-.07l1.2-1.06c.45-.4 1.12-.45 1.62-.1l2.5 1.7c.6.4.67 1.25.17 1.75l-1.3 1.3c-.8.8-2 1.1-3.1.72C12.3 16.6 7.4 11.7 5.3 7.36c-.38-1.1-.08-2.3.72-3.1Z"/>`,
  // 来电（响铃）：听筒 + 两道声波弧。用于来电横幅 / 通话记录里的"未接"标记。
  'call-in': `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <path d="M4.4 4.9c-.4.4-.55 1-.42 1.55 1.5 6.3 6.27 11.07 12.57 12.57.55.13 1.15-.02 1.55-.42l1.4-1.4-3.3-2.2-1.3 1.3A10.9 10.9 0 0 1 8.7 10.1l1.3-1.3-2.2-3.3Z"/>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" opacity="0.85">
    <path d="M15.4 3.6a6.6 6.6 0 0 1 5 5"/>
    <path d="M15.1 7.4a3 3 0 0 1 1.5 1.5"/>
  </g>`,
  // 状态栏：信号 / Wi-Fi / 电量
  signal: `<g fill="currentColor">
    <rect x="3" y="14.4" width="2.6" height="4.2" rx="0.8"/>
    <rect x="7.1" y="11.8" width="2.6" height="6.8" rx="0.8"/>
    <rect x="11.2" y="9.2" width="2.6" height="9.4" rx="0.8"/>
    <rect x="15.3" y="6.6" width="2.6" height="12" rx="0.8"/>
  </g>`,
  wifi: `<g fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
    <path d="M3.2 8.9a13 13 0 0 1 17.6 0"/>
    <path d="M6.6 12.6a8.4 8.4 0 0 1 10.8 0"/>
    <path d="M10 16.2a3.6 3.6 0 0 1 4 0"/>
  </g><circle cx="12" cy="18.6" r="1.3" fill="currentColor"/>`,
  battery: `<g fill="none" stroke="currentColor" stroke-width="1.6">
    <rect x="2.4" y="7.6" width="16.4" height="8.8" rx="2.6"/>
    <path d="M21 10.6v2.8" stroke-width="2.4" stroke-linecap="round"/>
  </g><rect x="4.6" y="9.8" width="8.4" height="4.4" rx="1.4" fill="currentColor"/>`,
  back: `<path d="M14.6 5.4 8 12l6.6 6.6" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`,
  // 音效开关
  sound: `<g fill="currentColor">
    <path d="M4.2 9.4h3.1L11.6 6a1 1 0 0 1 1.6.8v10.4a1 1 0 0 1-1.6.8L7.3 14.6H4.2A1.2 1.2 0 0 1 3 13.4v-2.8a1.2 1.2 0 0 1 1.2-1.2Z"/>
    <path d="M16.4 8.6a4.6 4.6 0 0 1 0 6.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M18.9 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </g>`,
  mute: `<g fill="currentColor">
    <path d="M4.2 9.4h3.1L11.6 6a1 1 0 0 1 1.6.8v10.4a1 1 0 0 1-1.6.8L7.3 14.6H4.2A1.2 1.2 0 0 1 3 13.4v-2.8a1.2 1.2 0 0 1 1.2-1.2Z"/>
    <path d="M16.2 9.6 21 14.4M21 9.6l-4.8 4.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
  </g>`,
  // 危险 / 警示
  warn: `<path fill="currentColor" d="M12 2.8 22 20.4H2Zm-1.1 6.4h2.2v5.6h-2.2Zm0 7.2h2.2v2.2h-2.2Z"/>`,
  trash: `<g fill="currentColor">
    <path d="M6.6 8.6h10.8l-.9 11a1.8 1.8 0 0 1-1.8 1.6H9.3a1.8 1.8 0 0 1-1.8-1.6Z" opacity="0.85"/>
    <path d="M4.6 6.2h14.8v1.9H4.6Zm5-3.4h4.8l.9 1.6H8.7Z"/>
  </g>`,
  info: `<g fill="currentColor">
    <path fill-rule="evenodd" d="M12 2.6a9.4 9.4 0 1 0 0 18.8 9.4 9.4 0 0 0 0-18.8Zm0 2.2a7.2 7.2 0 1 1 0 14.4 7.2 7.2 0 0 1 0-14.4Z"/>
    <rect x="10.9" y="10.4" width="2.2" height="6.4" rx="1.1"/>
    <rect x="10.9" y="7.1" width="2.2" height="2.2" rx="1.1"/>
  </g>`,
  // ── 迭代 7 新增的 6 项升级图标 ──────────────────────────────
  // 绞盘：滑轮 + 右侧摇柄（刻意不用卷线轴造型 —— 那是 line 鱼线的图形）
  winch: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="9.6" cy="12" r="6.5"/>
    <path d="M16.1 12h3.3v3.6"/>
  </g><circle cx="9.6" cy="12" r="1.7" fill="currentColor"/>
  <circle cx="19.4" cy="17.7" r="2" fill="currentColor"/>`,
  // 鱼护：编织筐（梯形筐身 + 提手 + 网格）
  creel: `<g fill="currentColor">
    <path d="M4.2 8.8h15.6l-1.9 10.6a1.6 1.6 0 0 1-1.58 1.3H7.68a1.6 1.6 0 0 1-1.58-1.3Z"/>
    <path d="M8.6 3.4a3.4 3.4 0 0 1 6.8 0v4.6h-2.1V3.4a1.3 1.3 0 0 0-2.6 0v4.6H8.6Z" opacity="0.7"/>
  </g>
  <g stroke="#000" stroke-width="0.85" opacity="0.32" fill="none">
    <path d="M6.1 12.4h11.8M5.5 15.9h13"/>
    <path d="M9.5 9.6v10.9M12 9.6v10.9M14.5 9.6v10.9"/>
  </g>`,
  // 保险：盾牌 + 中间一枚被护住的金币
  // 保险 / 声呐 / 加固 三个图标随对应升级项一起删除（v0.5）。
  // 它们原来分别是：雨伞（保险）、同心脉冲环（声呐）、两个互扣的链环（加固）。
  // 需要的话去 git 历史里找 —— 留着不用的 GLYPH 只会让下一个人以为那三项还在。
  // 鱼饵：一条小鱼剪影（鱼饵本身就是小鱼）
  bait: `<g fill="currentColor">
    <path d="M15.2 12c0-2.9-2.6-5-5.8-5-3.6 0-6.6 2.2-6.6 5s3 5 6.6 5c3.2 0 5.8-2.1 5.8-5Z"/>
    <path d="M16 12 22 8.4v7.2Z"/>
  </g><circle cx="6.6" cy="10.4" r="1.15" fill="#000" opacity="0.42"/>`,
  // 快速回收（绞盘，v0.5）：向上的双箭头 + 底下一段卷筒。
  // 双箭头是"加速"的通用形状语言，19px 下依然成立；
  // ⚠ 刻意和 `winch`（绞盘本身：卷筒 + 摇柄）区分开 —— 那个是"装备"，
  //   这个是"动作"，所以形态必须不同（一个静态器件、一个动态箭头）。
  'fast-reel': `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3.4v9.2"/>
    <path d="M8.2 7.2 12 3.4l3.8 3.8"/>
    <path d="M7.6 16.2h8.8"/>
    <path d="M7.6 19.6h8.8" opacity="0.55"/>
  </g>`,
  // 航线（地图 App）：一条虚线航路 + 起点实心点 / 终点空心圈。
  // 刻意不用"地图折叠"那种画法 —— 12px 下折角会糊成一坨，读不出是地图。
  // 虚线航路的好处是缩小后剩下的那条斜虚线本身就在说"从这里到那里"。
  route: `<path d="M5.2 18.6c0-4.4 3.2-6.2 7.2-6.2s7-1.8 7-6.2" fill="none"
    stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-dasharray="3.2 2.8"/>
  <circle cx="5.2" cy="18.6" r="2.3" fill="currentColor"/>
  <circle cx="19.4" cy="6.2" r="2.1" fill="none" stroke="currentColor" stroke-width="1.9"/>`,
  // 挂锁（v0.7 第三批）：枪店 / 渔具店里"还没上架"的那一项用它
  lock: `<rect x="5.2" y="10.2" width="13.6" height="9.4" rx="2.4" fill="currentColor"/>
  <path d="M8.3 10.2V7.9a3.7 3.7 0 0 1 7.4 0v2.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,

  // 船（v0.7 船厂）：船体梯形 + 桅杆 + 三角帆。
  // ⚠ 19px 下只能靠**剪影**认人，所以帆和船体必须连成一块实的形状，
  //   不要画成一堆细线（那看起来像一团乱码）。
  boat: `<path fill="currentColor" d="M3.4 15.2h17.2l-2.4 4.4H5.8Z"/>
  <path fill="currentColor" d="M12 3.2v11.4h6.4c-1.7-4.2-3.6-8-6.4-11.4Z"/>
  <rect x="11.4" y="2.6" width="1.2" height="12.6" rx="0.6"/>`,
  // 冰山：水上的尖角 + 水下的庞大冰体（"露出来的只是一角"）。
  // 用两层不同不透明度的纯色块叠出来 —— 不用 <defs>+gradient（同名 id 会互相冲突）。
  iceberg: `<path fill="currentColor" d="M12 2.6 15.8 8.9H8.2Z"/>
  <path fill="currentColor" opacity="0.5"
    d="M3.2 9.6h17.6c-.6 6.1-4.1 10.2-8.8 10.2S3.8 15.7 3.2 9.6Z"/>`,

  // ── 枪械（v0.4 枪店）────────────────────────────────────────
  //
  // 七把枪必须是**七种不同的剪影**，不能靠"多一根线"来区分：
  // 它们在 19px 的商店行里要一眼认出谁是谁，而 19px 下细节全部糊掉，
  // 只有"整体轮廓"能传递信息。所以每把枪都绑一个**夸张的特征**：
  //   手枪=短 + 斜握把 / 散弹=最长最细的枪管 + 前护木 / Uzi=枪身下挂一根长弹匣
  //   鱼叉=带倒钩的叉头 / 加特林=圆形弹鼓 + 双管 / 激光=发射口 + 淡色光束
  //   巴雷特=枪管上方一具瞄准镜 + 枪口制退器
  //
  // ⚠ 一律 `fill="currentColor"`（激光的光束用 opacity 压淡），不要写死颜色 ——
  //   这些图标既出现在深色 App 图标底上，也出现在浅色的商店行里。
  'gun-pistol': `<g fill="currentColor">
    <path d="M5.4 7.6h12.4a1.4 1.4 0 0 1 1.4 1.4v2.2H5.4Z"/>
    <path d="M6.2 11.2h4.8l-2.1 7.4H4.9Z"/>
    <path d="M18.2 8.8h2.4v1.4h-2.4Z"/>
  </g>`,
  'gun-shotgun': `<g fill="currentColor">
    <path d="M1.8 9.4 4.4 10v3l-2.6.6Z"/>
    <path d="M4.4 10.2h17.2a1 1 0 0 1 1 1v1.6H4.4Z"/>
    <path d="M9.6 12.8h6v2.6h-6Z"/>
    <path d="M5 12.8h3.4l-.8 4.6H5Z"/>
  </g>`,
  'gun-uzi': `<g fill="currentColor">
    <path d="M5.4 8.8h12.6a1.2 1.2 0 0 1 1.2 1.2v2.6H5.4Z"/>
    <path d="M19.2 9.8h2.8v1.6h-2.8Z"/>
    <path d="M7.2 12.6h3.6v7.6H7.2Z"/>
    <path d="M11.6 12.6h3.2l-1.3 4.4h-1.9Z"/>
  </g>`,
  'gun-harpoon': `<g fill="currentColor">
    <path d="M2.6 11.2h12.2v2.4H2.6Z"/>
    <path d="M14.8 9.4 21.8 12.4 14.8 15.4Z"/>
    <path d="M14.6 6.8 17 9 14.6 11.2Z" opacity="0.85"/>
    <path d="M14.6 12.8 17 15 14.6 17.2Z" opacity="0.85"/>
    <path d="M5.6 13.6h3.4v3.8H5.6Z"/>
  </g>`,
  // 加特林：弹鼓（带轴心）+ 两根粗管。**不要画三根细管** —— 19px 下那两道
  // 0.5px 的缝会被抗锯齿吃掉，整个图标糊成一块方砖，反而认不出是转管枪。
  'gun-gatling': `<g fill="currentColor">
    <circle cx="8" cy="12" r="4.8"/>
    <circle cx="8" cy="12" r="1.7" fill="#000" opacity="0.32"/>
    <path d="M12.6 8.2h8.8v3.1h-8.8Z"/>
    <path d="M12.6 12.7h8.8v3.1h-8.8Z"/>
    <path d="M1.6 10.3h4.2v3.4H1.6Z"/>
  </g>`,
  'gun-laser': `<g fill="currentColor">
    <path d="M3.2 8.6h6.4v6H3.2Z"/>
    <path d="M4.8 14.6h3.2v4.2H4.8Z"/>
    <path d="M9.6 10.4h3.2v2.4H9.6Z"/>
    <path d="M12.8 10.6 22.8 12 12.8 13.4Z" opacity="0.45"/>
    <path d="M12.8 11.4h9.4v1.2h-9.4Z" opacity="0.85"/>
  </g>`,
  'gun-barrett': `<g fill="currentColor">
    <path d="M3.4 9.4h16.4v3.2H3.4Z"/>
    <path d="M1.2 8.6 3.4 9.4v3.2l-2.2-.7Z"/>
    <path d="M19.8 8.4h2.8v5.2h-2.8Z"/>
    <path d="M7.8 5.6h5.4v2.2H7.8Z"/>
    <path d="M9.4 7.8h2v1.6h-2Z" opacity="0.8"/>
    <path d="M7.4 12.6h3.2v4.8H7.4Z"/>
  </g>`,
  // 枪店 App：左轮。转轮那一圈是它和 Uzi 的唯一区别，也是 19px 下还认得出的特征
  gunshop: `<g fill="currentColor">
    <path d="M4.4 8.6h11.4a1.4 1.4 0 0 1 1.4 1.4v2.6H4.4Z"/>
    <circle cx="8.8" cy="10.6" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <path d="M17.2 9.4h3.4v2.2h-3.4Z"/>
    <path d="M6.6 12.6h4l-1.8 7.2H5.2Z"/>
  </g>`,
};

/** 取一个单色图标（size 单位 px） */
export function glyph(name, size = 22, cls = '') {
  return wrap(GLYPH[name] || '', size, cls);
}

/**
 * 图标 + 文字混排（图鉴里的「⚠ 扣钱」、飘字里的「📖 图鉴 +1」）。
 * 返回一段可塞进 innerHTML 的片段，外层容器建议用 inline-flex + gap 排版。
 */
export function iconText(name, text, size = 12, cls = '') {
  return `${glyph(name, size, cls)}<span>${text}</span>`;
}

/** 血量条：连着画 n 颗心（用 currentColor 上色，跟着容器的 color 走） */
export function heartRow(n, size = 12) {
  return Array.from({ length: n }, () => glyph('heart', size)).join('');
}
