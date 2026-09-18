/**
 * config.js — 全局数值配置（项目唯一数值来源）
 * 改数值只改这里，不要散落到逻辑代码里。
 */

// ───────────────────────── 世界 / 相机 ─────────────────────────
//
// ⚠ v0.2「水下世界整体放大 2 倍」（2026-09 手感调整）：
//   鱼、地形、地图深度、所有判定半径与速度全部 ×2，而**相机视野保持不变**
//   （viewHeight / minViewWidth 故意不动）—— 世界变大、镜头不动，屏幕上才会"大一号"。
//   连带结果：宁静海湾 430 → 860m，冰封极地 620 → 1240m，
//   鱼线 Lv0 从 80 → 320m（用户要的"80m 的线能到 320m 深"）。
//   这一组数值是**一次性脚本换算**出来的，不是手抄的（手抄 250 个数字必错）。
export const WORLD = {
  viewHeight: 240,      // 基准可见高度（世界单位 ≈ 米）
  minViewWidth: 154,    // 最小可见宽度：保证玩法区域在任何屏幕比例下都完整
  surfaceY: 0,          // 海平面
  skyTop: 3000,         // 天空顶部（要够高，让高价鱼能飞进太空）
  bottomY: -1400,        // 世界底部
  cameraZ: 120,
  playHalfWidth: 56,    // 鱼钩水平活动半径
  fishHalfWidth: 66,    // 鱼类水平游动范围
  boatY: 2,
  rodTipY: 34,
};

// 相机偏移统一用「可见高度的比例」表示，
// 这样 16:9 手机和 20:9 超长屏上鱼钩在画面里的相对位置完全一致。
export const CAMERA = {
  idleAnchor: 0.25,        // 待机/标题：水面落在画面下方这个比例处（船和渔夫居中偏下）
  idleScale: 0.62,         // 待机时推近，让渔夫有存在感
  shopAnchor: 0.42,        // 商店/结算：水面在画面下方这个比例处
  descendLeadRatio: -0.30, // 下沉：鱼钩在中心上方 30% 可见高度处
  ascendLeadRatio: 0.33,   // 上升：鱼钩在中心下方 33% 处
  shallowClampRatio: 0.10, // 浅水时最多露出水面以上 10% 可见高度
  // 抛竿滞空：镜头要跟着飞起来的鱼钩走，否则钩子飞出画面顶部
  castLeadRatio: -0.10,    // 鱼钩在中心上方 10% 可见高度处
  castTopRatio: 0.34,      // 抛竿时最多露出水面以上 34% 可见高度（比下潜宽松）
  descendRate: 7,
  ascendRate: 12,
  minY: WORLD.bottomY + WORLD.viewHeight / 2 + 10,
};

// ───────────────────────── 水体 / 天空 / 太空 渐变 ─────────────────────────
// 从海沟一路到深空。0 以上是天空，越高越暗，最后变成太空。
export const WATER_STOPS = [
  [3000, '#000004'],
  [2300, '#01020a'],
  [1800, '#040717'],
  [1400, '#08102a'],
  [1080, '#102346'],
  [840, '#1b4574'],
  [640, '#2f74ab'],
  [500, '#46a2db'],
  [360, '#72c0ea'],
  [220, '#a2dbf4'],
  [90, '#c6ebfa'],
  [0, '#5cc4e8'],
  [-110, '#2ea8d8'],
  [-240, '#166b96'],
  [-390, '#0b3f66'],
  [-550, '#061f38'],
  [-740, '#02101f'],
  [-1000, '#000408'],
  [-1400, '#000203'],
];

// 大气层分层（用于星空淡入 / 云淡出 / 高度提示）
// 阈值是按「相机能到的最高高度」反推的：黄金鱼王飞到 3050m 时相机最高到 ~2480，
// 正好落进「深空」，所以从沙丁鱼到鱼王能完整走完这 6 层。
export const ALTITUDE_BANDS = [
  { y: 0, name: '海面', en: 'SEA LEVEL', stars: 0, clouds: 1 },
  { y: 520, name: '高空', en: 'HIGH SKY', stars: 0, clouds: 0.75 },
  { y: 1040, name: '平流层', en: 'STRATOSPHERE', stars: 0.35, clouds: 0.35 },
  { y: 1560, name: '中间层', en: 'MESOSPHERE', stars: 0.72, clouds: 0.1 },
  { y: 2080, name: '近地轨道', en: 'LOW ORBIT', stars: 1, clouds: 0 },
  { y: 2400, name: '深空', en: 'DEEP SPACE', stars: 1, clouds: 0 },
];

/** 给定世界高度落在哪一层大气（用于高度横幅） */
export function altitudeAt(y) {
  const B = ALTITUDE_BANDS;
  if (y <= B[0].y) return B[0];
  for (let i = 0; i < B.length - 1; i++) if (y < B[i + 1].y) return B[i];
  return B[B.length - 1];
}

// ───────────────────────── 深度分区 ─────────────────────────
// count 是「基准数量」。逻辑反转之后鱼既是障碍也是奖励，
// 所以各层数量刻意压得比较平 —— 表层堆太多会让玩家一抛竿就被迫收线。
// name  = 深度尺上的分区简称（短，要能塞进 46px 宽的尺子）
// nick  = 图鉴里的「海域名」（像地名，不是分区名）
// map   = 这个海域属于哪张地图。**深度分区是按地图隔离的**：
//         两张地图的表层都是 0~N 米，只有带上 map 才能区分"我现在在哪片海的表层"。
//
// ⚠ 命名注意：nick 是**海域**的雅称，不能和 MAPS 里的**地图名**重名。
// 迭代 6 把主界面大标题改成地图名「宁静海湾」之后，深层的旧 nick（也叫宁静海湾）
// 就撞车了 —— 图鉴里会出现"宁静海湾 · 宁静海湾"。所以深层改名「幽蓝深谷」。
// 加新地图时同样要检查：新海域的 nick 不能等于任何地图名（含新地图自己的名字）。
export const ZONES = [
  // ── ① 宁静海湾 CALM BAY（860m，教学基准）─────────────────
  { id: 'sunlit', map: 'calm-bay', name: '表层', en: 'SUNLIT', nick: '阳光浅滩', top: 0, bottom: -110, color: '#3fb6e0', count: 14 },
  { id: 'twilight', map: 'calm-bay', name: '中层', en: 'TWILIGHT', nick: '蓝色回廊', top: -110, bottom: -240, color: '#2a86b4', count: 20 },
  { id: 'deep', map: 'calm-bay', name: '深层', en: 'DEEP', nick: '幽蓝深谷', top: -240, bottom: -390, color: '#186099', count: 20 },
  { id: 'abyss', map: 'calm-bay', name: '深渊', en: 'ABYSS', nick: '无光深渊', top: -390, bottom: -550, color: '#0d3a63', count: 18 },
  { id: 'trench', map: 'calm-bay', name: '海沟', en: 'TRENCH', nick: '海沟尽头', top: -550, bottom: -860, color: '#061f38', count: 20 },

  // ── ② 冰封极地 POLAR（1240m，浮冰与极光）─────────────────
  // 层界按 0/140/340/600/920/1240 切：每层的身价跨度比宁静海湾大，
  // 因为这张图是"换图之后第一次明显感觉钱变多了"的地方（见 EXPANSION 3.1 的两个梯度）。
  { id: 'ice-shelf', map: 'polar', name: '表层', en: 'ICE SHELF', nick: '浮冰浅海', top: 0, bottom: -140, color: '#cfe9f5', count: 14 },
  { id: 'ice-twilight', map: 'polar', name: '中层', en: 'ICE TWILIGHT', nick: '霜蓝水道', top: -140, bottom: -340, color: '#6fb8dc', count: 20 },
  { id: 'ice-deep', map: 'polar', name: '深层', en: 'ICE DEEP', nick: '极光长廊', top: -340, bottom: -600, color: '#2a6a96', count: 20 },
  { id: 'ice-abyss', map: 'polar', name: '深渊', en: 'ICE ABYSS', nick: '永冻深渊', top: -600, bottom: -920, color: '#123a5e', count: 18 },
  { id: 'ice-trench', map: 'polar', name: '海沟', en: 'ICE TRENCH', nick: '极夜之底', top: -920, bottom: -1240, color: '#05192e', count: 20 },
];

/** 这张地图包含的深度海域（顺序 = 从浅到深） */
export const zonesOfMap = (mapId) => ZONES.filter((z) => z.map === mapId);

/**
 * 按世界深度找所在的海域（深度尺 / 区域横幅 / 刷鱼都走它）。
 *
 * ⚠ **必须带地图**：两张地图的表层都是 `0 ~ -70` 左右，不隔离的话
 * 在冰封极地的 30m 处会返回「阳光浅滩」。默认值取第一张图只是为了
 * 让不关心地图的老调用点（纯数值测试）还能跑。
 */
export function zoneAtDepth(y, mapId = DEFAULT_MAP.id) {
  const zs = zonesOfMap(mapId);
  for (const z of zs) if (y <= z.top && y > z.bottom) return z;
  return zs[zs.length - 1] || ZONES[ZONES.length - 1];
}

// ────────────────── 换图门槛（v0.7：已换成「海图 + 船」）──────────────────
//
// **这里原来有一个 `CODEX_GATE`（每层都有收获 + 图鉴 ≥ 90%），v0.7 第二批把它删掉了。**
// 原因（需求原话是"移除其他所有条件"）：
//   · 它**注定当不了主墙** —— 一竿就能刷满五层，收集速度天然快于攒钱速度
//     （9 个候选口径实测主线恒为 41 竿，见 `GAMEPLAY.md` §4.6 结论 2 与
//      `.dev/archive/_measure-a10.mjs`）；
//   · 而"潜到这张图的尽头"本来就是它的意图 —— 现在那件事由**海沟底部的宝箱**直接承担
//     （见下面的 SEABED / CHEST）。
//
// 现在的门槛只剩两条，都定义在别处：
//   ① **钓到海图**  → `SEABED` / `CHEST`（宝箱就在首图最底部，拿到即 `save.chart = true`）
//   ② **拥有任意一艘船** → `BOATS`（10,000，三条船同价）
// 判定在 `game.js` 的 `mapProgress()`，界面只渲染它给出的 `conds`。

// ───────────────────────── 地图 ─────────────────────────
// 一张地图 = 一片有名字的海，它包含若干「深度海域」（表层 → 海沟）。
//
// 为什么要拆出这一层：主界面顶部的大标题要显示的是**地图名**，
// 而不是"当前鱼线能潜到的最深海域"那种随升级变化的分区名 ——
// 地图是玩家选的"去哪片海钓鱼"，海域只是这片海里的一层深度。
//
// 字段：
//   zones    这张地图包含哪些深度海域（引用 ZONES 的 id）
//   license  进入本图要付的许可证金币（0 = 初始地图）
//   hook     机制钩子的标识符，world.js / game.js 按它加载额外逻辑（null = 无）
//   theme    视觉主题（水体渐变等），见 world.js
//
// 进度门槛（内容完成度 + 潜到上限 + 许可证）在 game.js 的 mapProgress 里算；
// 「内容完成度」的口径见上面的 CODEX_GATE（唯一来源）。
export const MAPS = [
  {
    id: 'calm-bay',
    name: '宁静海湾',
    en: 'CALM BAY',
    color: '#2ea8d8',            // 主界面大标题的辉光色
    zones: ['sunlit', 'twilight', 'deep', 'abyss', 'trench'],
    license: 0,
    hook: null,
    desc: '风平浪静的近海。从阳光浅滩一路向下，能一直潜到海沟尽头。',
  },
  {
    id: 'polar',
    name: '冰封极地',
    en: 'POLAR',
    color: '#7fd4f0',
    zones: ['ice-shelf', 'ice-twilight', 'ice-deep', 'ice-abyss', 'ice-trench'],
    // ⚠ v0.7：许可证 **0** —— 进这张图的门槛改成「钓到海图 + 至少拥有一艘船」，
    //   图鉴 90% / 潜到上限 / 33,233 金币三条**全部取消**（见 config 的 BOATS 与 game.js 的 mapProgress）。
    //   钱没有被删掉，只是从"过路费"变成了"买船"（10,000）——
    //   而且船是**玩家真的能用的东西**，比一笔过路费更像奖励。
    license: 0,
    hook: 'iceberg',
    // 水体从冰蓝渐到墨蓝 —— 这是"换图了"最直观的信号，比任何 UI 都直接。
    //
    // ⚠ `waterStops` 用的是**归一化位置 t ∈ [0,1]**（0 = 海底，1 = 天空顶），
    //   而不是默认 `WATER_STOPS` 那种世界 Y 坐标。为什么不让两张图都用世界 Y：
    //   两张图深度不同（860 vs 1240），写世界 Y 就得为每张图重算一遍全套色标；
    //   写成比例之后「冰蓝 → 墨蓝」这条曲线直接按本图深度铺满，加第三张图
    //   只要照抄一条曲线。world.js 的 makeGradientTexture 认这个约定。
    theme: {
      waterStops: [
        [0.00, '#04101f'],   // 海沟底：几乎全黑
        [0.16, '#0a2440'],
        [0.38, '#1a4a76'],
        [0.62, '#3f8cbe'],
        [0.84, '#8fd0ea'],
        [1.00, '#cfe9f5'],   // 冰洞口的透光层
      ],
      // 水面以上的天空：极夜。暗到能看见极光，但还没黑到看不清船。
      skyStops: [
        [0, '#5a9ec4'],
        [180, '#2c5a86'],
        [480, '#173a63'],
        [900, '#0d2242'],
        [1500, '#071428'],
        [2200, '#030a18'],
        [3000, '#000206'],
      ],
      // 极光：画在**天空**里的一条光带（不是水下）。
      // 玩家一换图抬头就能看见，比藏在水下的任何东西都更像"到北极了"。
      //
      // ⚠ `y = [底边基准, 高度上限]`，语义是"这道帘子**从哪儿垂下来、最高能到哪**"，
      //   不是"光带中心在哪"，也不是"光带的上边界"。
      //   光帘高度 = (高度上限 − 底边基准) × 0.55~1.05，顶端会伸出画面 —— 这是对的。
      //
      //   **两条硬约束（都踩过）**：
      //   ① 底边必须低于待机视野的上边界，否则整条帘子悬在画面上方。
      //      实测待机可见天空只有 y ∈ [0, 120]（viewH 160、camY 40）。
      //      原来写 [300, 740]，底边全在 300 以上 → 换图后玩家只看得到一片黑天，
      //      这条"最强的换图信号"等于没做。
      //   ② 底边不能压到 0 以下 —— 极光从水里长出来会穿模。
      //   现在底边落在 10 ~ 45，正好在船的上方。
      //
      //   另外注意：可见天空**横向**也只有 ±47.5（viewW ≈ 95），
      //   帘子的 x 展布在 world.js 里按这个宽度定，别按玩法宽度 154 来。
      aurora: { y: [10, 230], color: 0x4dffc3, ribbons: 5 },
      // 极夜：太阳和云都要压暗（照搬温带那个大白天会把极光完全盖掉）
      skyDim: 0.3,
      snow: 1.7,             // 海雪密度倍率（极地水里的悬浮冰晶比温带海多）
      icePillars: true,      // 冰柱地形（0 ~ −600m 贴着两侧岩壁往下挂）
      iceCeiling: true,      // 头顶的冰层顶盖：从 0m 往下压的一整排冰凌
    },
    desc: '冰层之下，还有一整个世界。',
  },
];

/** 当前进入的地图（多地图之后由存档里的 currentMap 决定，这里只是兜底） */
export const DEFAULT_MAP = MAPS[0];

/** 按 id 取地图；找不到就退回第一张（存档里的旧 id / 脏数据不要炸） */
export function mapById(id) {
  return MAPS.find((m) => m.id === id) || DEFAULT_MAP;
}

/** 这张海域属于哪张地图 */
export function mapOfZone(zoneId) {
  const z = ZONES.find((x) => x.id === zoneId);
  return (z && mapById(z.map)) || DEFAULT_MAP;
}

/** 鱼种属于哪张地图（按它最浅的那个海域反查） */
export function mapOfSpecies(def) {
  return mapOfZone(def.zones[0]);
}

/** 这张地图的深度上限 = 它最深的那个海域的底 */
export function mapMaxDepth(map) {
  let d = 0;
  for (const id of map.zones) {
    const z = ZONES.find((x) => x.id === id);
    if (z) d = Math.max(d, -z.bottom);
  }
  return d;
}

// ───────────────────────── 海床 / 宝箱 / 海图（v0.7）─────────────────────────
// 首图的最底部铺一层**海床**，海床上放一只**宝箱**，箱里是通往第 2 张图的**海图**。
//
// 为什么要"下到底才能拿到海图"：它是换图的**唯一内容条件**（另一个是买船，见 BOATS）——
// 把"看遍这片海"从"钓到 90% 的鱼种"换成"潜到这张图的尽头"。
// 前者靠刷竿数就能满足（见 GAMEPLAY §4.6 结论 2），后者**必须一路下潜**，
// 而下潜要躲鱼、要升鱼线 —— 它天然和"成长"绑在一起。
//
// ⚠ 宝箱是**碰到即得**（不占鱼护、不参与空中结算）：它是剧情道具不是渔获。
//   走"钓上来 → 抛向天空 → 打下来"那条链的话，玩家打丢了还得重钓，那不是设计意图。
export const SEABED = {
  map: 'calm-bay',      // 哪张图有海床（目前只有首图 —— 它是"新手图"，也是第一道门槛）
  margin: 26,           // 海床面比本图最低点再往下多少米（别让鱼贴着地面刷）
  rocks: 9,             // 海床上的石头块数（纯装饰，但"地面"得有东西才像地面）
};

export const CHEST = {
  x: 30,                // 横向位置（世界单位，正数 = 偏右，避开正下方那条下潜线）
  w: 20, h: 14, d: 15,  // 箱体尺寸（世界单位）
  gold: 300,            // 开箱给的一点"彩头"金币（海图本身不卖钱）
  glow: 0xffcc33,
};

/** 海图 —— 换图用的剧情道具（拿到即写进存档，见 game.js 的 `save.chart`） */
export const CHART = { id: 'chart', name: '极地海图', en: 'POLAR CHART' };

// ───────────────────────── 船只（v0.7）─────────────────────────
// 三艘**同价（10,000）**的船，各带一个效果 —— 玩家买**任意一艘**都能去第 2 张图，
// 所以这是一个"选哪种玩法"的选择，不是"攒更多钱买更好的船"的阶梯。
//
// 为什么同价：第 4 条需求写的就是"支付 10000 元购买任意一艘新船，作为进入第二张图的硬性条件"。
// 同价 = 三条路等值，玩家的决策点是**风格**（金币 / 装货 / 护钩），不是数值大小。
//
// ⚠ 效果强度不许"越大越好"，各自都有明确的边界：
//   gold  金币 ×1.25 —— 它是**收入**倍率，直接和换图速度挂钩，所以只给 25%；
//   creel 鱼护 +12 条 —— 相当于"鱼护这一项白送 4 级"（Lv0=8 → 20），但不改上限结构；
//   guard 每竿**首次**撞鱼不强制收线 —— 保护**一次**，第二次照常收线，
//         否则下潜阶段就变成无风险通道了（这是 §2.3 那条铁律的延续）。
export const BOATS = [
  {
    id: 'golden', name: '黄金号', en: 'GOLDEN', price: 10000,
    effect: { kind: 'gold', mul: 1.25 },
    desc: '渔获金币 +25%', tip: '挂着金帆的商船 —— 同样的鱼，卖得更贵。',
    hull: 0xd9a441, trim: 0x7a5314, sail: 0xffe6a3,
  },
  {
    id: 'cargo', name: '仓储号', en: 'CARGO', price: 10000,
    effect: { kind: 'creel', add: 12 },
    desc: '鱼护容量 +12 条', tip: '甲板上堆满板条箱 —— 一趟能带回来的鱼更多。',
    hull: 0x4f7f5f, trim: 0x27452f, sail: 0xcfe8d6,
  },
  {
    id: 'armor', name: '装甲号', en: 'ARMOR', price: 10000,
    effect: { kind: 'guard', count: 1 },
    desc: '每竿首次撞鱼不强制收线', tip: '船头包着铁皮 —— 护着你的钩子再往下潜一段。',
    hull: 0x6b7280, trim: 0x2b3038, sail: 0xd6dbe3,
  },
];

export const BOAT_ORDER = BOATS.map((b) => b.id);
export const boatById = (id) => BOATS.find((b) => b.id === id) || null;

/** 第几竿之后船厂老板会打来电话推荐新船（= 船厂 App 的开放时刻） */
export const BOAT_UNLOCK_CAST = 10;

/**
 * 鱼类密度倍率。
 * 上面的 count 是「基准数量」，实际数量 = max(1, round(count × FISH_DENSITY))。
 *
 * 0.1  → 每层 1~2 条，合计 9 条，下潜几乎碰不到鱼；
 * 0.18 → 每层 3~4 条，合计 18 条，上升阶段有鱼可抓、下潜阶段也真的需要躲。
 * 逻辑反转之后鱼同时是「障碍」和「奖励」，太稀会让上升阶段无事可做。
 */
export const FISH_DENSITY = 0.18;

/**
 * 扣钱鱼（hazard）出现频率控制 —— 需求①「降低扣钱鱼占比」。
 *
 * 只调 SPECIES 里的 weight 是不够的：那些 weight 同时承担着"这一层鱼种配比"的表达，
 * 而且扣钱鱼的 weight 压下去以后，玩家在表里也看不出"它被刻意压过"。
 * 所以单独开一组参数，把"鱼种配比"和"风险密度"两件事拆开：
 *
 *   weightScale：抽签时把 hazard 鱼种的 weight 乘上这个系数（0.25 ≈ 原频率的 1/4）
 *   maxPerZone ：每层海域最多同时刷出几条扣钱鱼。
 *                每层实际只有 3~4 条鱼，不封顶的话一次抽签就能让整层都是扣钱鱼 ——
 *                "躲开扣钱鱼"会从风险变成走投无路。
 *
 * 效果（按 spawnFish() 的抽签逻辑仿真 20 万竿/层，FISH_DENSITY = 0.18 时的
 *       每竿期望扣钱鱼条数；下面列的都是**海域**名，不是地图名）：
 *   改前 阳光浅滩 0.35 / 蓝色回廊 0.92 / 幽蓝深谷 1.01 / 无光深渊 0.48
 *   改后 阳光浅滩 0.10 / 蓝色回廊 0.26 / 幽蓝深谷 0.29 / 无光深渊 0.13
 *   （两张图的海沟尽头层都没有扣钱鱼，恒为 0；第 2 张图只有「浮冰浅海」一层有：
 *     改前 0.40 → 改后 0.11）
 *
 * ⚠ 上面是**运行期仿真期望值**，不是 `n × 权重占比` 的手算值：鱼群触发时
 *   （SCHOOL.chance = 0.34）非鱼群部分的抽签次数由 SCHOOL.extras 决定
 *   （期望约 1.5~2），而不是 zone.count × FISH_DENSITY —— 手算会高估 1.2~1.6 倍。
 */
export const HAZARD_SPAWN = {
  weightScale: 0.25,
  maxPerZone: 1,
};

/**
 * 刷鱼时**离水面留出的空档**（米）。
 *
 * 为什么必须有：下潜撞到鱼是「惩罚」（强制收线），而鱼的刷新上界原来是 `zone.top`
 * —— 表层的 top 就是 0，也就是**可以刷在贴着水面的位置**。
 * 于是鱼钩刚入水就落在 bumpRadius 里撞上，一竿还没开始就被迫上拉，
 * 玩家看到的是「刚抛竿就提示碰到鱼，可收上来什么都没有」。
 *
 * 留出 10m 之后，鱼钩入水那一下一定是干净的，撞鱼只会发生在真的下潜了一段之后。
 * 只有整张图最浅的那一层会受影响（其他层的 top 本来就低于 -10）。
 */
export const SPAWN_TOP_MARGIN = 20;

/**
 * 模型放大倍率 —— v0.2「水下世界整体放大 2 倍」。
 *
 * ⚠ 为什么只有这一个倍率、而不是把所有数值都 ×2 写死：
 *   - **表里的数值**（`ZONES` 深度、`LEVELS` 曲线、`TUNING` 距离、`DEEP`/`ICEBERG`）
 *     在 v0.2 里已经直接换算成绝对值了，它们本身就是"世界坐标"，不需要再乘；
 *   - **按固定设计稿尺寸建模的东西**（鱼的 body/tail/fin、鱼钩的铅坠与钩身、
 *     海带/岩石/冰柱等装饰）在 config 里是"设计稿尺寸"，照原样建出来会显得太小，
 *     所以统一在**构建 mesh 的那一处**乘这个倍率。
 *
 * 这样 fish.js / hook.js / world.js 各自只有一处乘法，不会散落到几十个数字里
 * （散落的话，漏掉一个就是一个"看起来对、细看不对"的 bug）。
 *
 * 相机视野（`WORLD.viewHeight` / `minViewWidth`）**故意不放大** ——
 * 世界变大、镜头不动，屏幕上所有东西才会"大一号"。
 */
export const MODEL_SCALE = 2;

/**
 * 稀有度（精英变体）—— 同一片海里给玩家一点惊喜。
 *
 * 为什么性价比极高：不需要任何新模型、新逻辑，只是在 `spawnFish` 里多掷一次骰子、
 * 渲染时换一套描边颜色。但它让**每一竿都有"会不会出金色"的期待**。
 *
 * `mul` 作用在 `def.value` 上，得到的才是"这一条鱼"的身价 ——
 * 结算、图鉴最高价、声呐的金色阈值全部跟着走，**不要在任何地方再乘一遍**。
 *
 * ⚠ `p` 之和必须 = 1（`rollRarity` 用累积法，和不为 1 会让最后几档永远抽不到）。
 *   verify8 会断言这一点。
 */
export const RARITY = [
  { id: 'normal', name: '普通', p: 0.84,  mul: 1,  rim: null,     glow: 0 },
  { id: 'silver', name: '银色', p: 0.13,  mul: 2.5, rim: 0xdfe9f5, glow: 0.35 },
  { id: 'gold',   name: '金色', p: 0.025, mul: 6,  rim: 0xffcc33, glow: 0.7 },
  { id: 'crown',  name: '王冠', p: 0.005, mul: 12, rim: 0xfff0b0, glow: 1.0 },
];

/** 按稀有度概率抽一次（累积法）。rand 可注入，方便测试用固定种子。 */
export function rollRarity(rand = Math.random) {
  let r = rand();
  for (const t of RARITY) { r -= t.p; if (r < 0) return t; }
  return RARITY[0];
}

/** 一条鱼的实际身价 = 鱼种基础身价 × 稀有度倍率（rarity 为空时按普通算） */
export const valueOf = (def, rarity) => Math.round(def.value * ((rarity && rarity.mul) || 1));

/**
 * 鱼群：同种鱼以几条为一组、保持间距同步游动。
 * 一串能串一大串，是连击的主要来源；也让"上升阶段"从被动扫过变成要规划路线。
 *
 * `count` 是组内条数范围，`gap` 是相邻两条的间距（世界单位），
 * `chance` 是这条鱼出现时"成组"的概率（鱼种自己也可以带 `school` 覆盖 count）。
 */
export const SCHOOL = {
  count: [3, 6],
  gap: [14, 26],
  chance: 0.34,
  /**
   * 鱼群出现时，本层**额外**再刷几条散鱼。
   *
   * 为什么不留散鱼不行：整层只有一群同种鱼的话，上升时要么全串上、要么全错过，
   * 没有"要不要为这一条绕一下"的取舍 —— 鱼群反而把决策变少了。
   * 留 1~2 条散鱼，鱼群才是"主菜"而不是"全部"。
   *
   * 注意鱼群是**加**在本层基准数量之上的，不是从里面切一块：
   * FISH_DENSITY 之后每层只有 3~4 条，切 60% 出来只剩 2 条，"群"就不成立了。
   */
  extras: [1, 2],
};

/**
 * 浮冰（冰封极地专属的「机制钩子」，对应 MAPS.polar.hook = 'iceberg'）。
 *
 * 和鱼的区别：鱼是**碰到就结束**（强制收线），浮冰是**碰到就被推开 + 减速**。
 * 为什么不做成第二种"碰到就收线"：那只是把鱼换个样子，玩家学不到新东西；
 * 而"被推开"制造的是一种新的失误 —— 你还在下潜、路线却被横向顶偏了，
 * 接下来这一段就可能在没鱼的地方空放。代价是速度，不是这一竿。
 *
 * 只出现在 `top ~ depth` 这一段：极地 300m 以下全是水，头顶的浮冰不可能跟下去。
 */
export const ICEBERG = {
  count: [5, 8],        // 每次刷新生成几块
  depth: 340,           // 只在这个深度以上（米）
  radius: [14, 30],      // 世界单位，判定半径
  drift: [6, 18],        // 横向漂移速度（单位/秒）
  /** 撞上之后的惩罚：横向推开 + 下潜减速 */
  pushX: 34,            // 被横向推开的世界单位
  pushY: 28,            // 被往上顶回的世界单位（"弹开"）
  slowTime: 1.5,        // 减速持续秒数
  slowScale: 0.42,      // 减速期间下潜速度倍率
  cooldown: 0.8,        // 同一块冰的重复触发间隔
};

// ───────────────────────── 鱼类图鉴 ─────────────────────────
// body: [长半径, 高半径, 宽半径]   nose 朝 +X
// hp: 显式血量（不要再用体型反推 —— 图鉴里要如实显示，而且"每条鱼血量不同"
//     是玩法的一部分：血厚的鱼每中一枪没死，就会再往天上蹿一段）
// desc: 图鉴里的简介
// hazard: 打中会扣钱（扣钱鱼统一走醒目的警戒视觉，见 fish.js）
export const SPECIES = [
  // ── 表层 Sunlit ──────────────────────────────────────────
  {
    id: 'sardine', name: '沙丁鱼', zones: ['sunlit'], value: 6, hp: 2,
    radius: 3.2, speed: 48, weight: 30,
    desc: '成群结队的小银鱼，闪得像一把撒进水里的硬币。一枪就碎，胜在数量。',
    color: 0xdcecf8, belly: 0xffffff, stripe: 0x3f7ea8, stripeN: 1,
    body: [4.2, 1.5, 0.95], tail: [1.7, 1.6], fin: [1.3, 0.9], eye: 0.5,
  },
  {
    id: 'clown', name: '小丑鱼', zones: ['sunlit'], value: 11, hp: 2,
    radius: 3.9, speed: 32, weight: 20,
    desc: '橙底白带，脸上永远挂着一副"我很忙"的表情。据说它和河豚是邻居。',
    color: 0xff6a1f, stripe: 0xfff6ea, stripeN: 3, belly: 0xffb066,
    body: [4.0, 2.1, 1.25], tail: [1.6, 1.9], fin: [1.2, 1.0], eye: 0.75,
  },
  {
    id: 'mackerel', name: '鲭鱼', zones: ['sunlit'], value: 15, hp: 3,
    radius: 4.5, speed: 56, weight: 17,
    desc: '背上一身虎纹，游得比谁都快。身上那些亮点其实是鳞片反光。',
    color: 0x3f9fc4, stripe: 0x10344a, stripeN: 4, spots: 0x9fe4ff,
    body: [5.8, 2.0, 1.15], tail: [2.1, 2.3], fin: [1.6, 1.1], eye: 0.6,
  },
  {
    id: 'puffer', name: '河豚', zones: ['sunlit', 'twilight'], value: 9, hp: 4,
    radius: 5.0, speed: 16, weight: 11,
    desc: '扣钱鱼。气鼓鼓的一颗刺球，一身黑黄警戒带。打中它会炸开，扣 30 金币还清空连击。',
    color: 0xffd23f, hazard: true, spikes: 18,
    stripe: 0x141414, stripeN: 3, belly: 0xfff3c4,
    body: [3.5, 3.1, 2.7], tail: [1.2, 1.5], fin: [0.9, 0.9], eye: 0.95,
  },
  // ── 中层 Twilight ────────────────────────────────────────
  {
    id: 'blobfish', name: '水滴鱼', zones: ['twilight'], value: 32, hp: 5,
    radius: 5.8, speed: 12, weight: 9,
    desc: '一团粉色的忧伤。因为太懒，它干脆放弃了游泳，随波逐流。',
    color: 0xf7a8c0, belly: 0xffd9e4, bignose: 1.0, whisker: 3,
    body: [3.9, 3.3, 2.4], tail: [1.2, 1.2], fin: [0.9, 0.8], eye: 0.42,
  },
  {
    id: 'snapper', name: '红鲷', zones: ['twilight'], value: 24, hp: 4,
    radius: 5.0, speed: 36, weight: 19,
    desc: '通红一条，背鳍像一排小刀。眼睛大得有点凶，看久了会被它瞪回来。',
    color: 0xff3d3d, belly: 0xffb0a0, stripe: 0xa80000, stripeN: 1, fangs: 4,
    body: [4.9, 2.7, 1.35], tail: [1.9, 2.5], fin: [1.9, 1.6], eye: 0.85,
  },
  {
    id: 'butterfly', name: '蝴蝶鱼', zones: ['twilight'], value: 28, hp: 4,
    radius: 4.2, speed: 40, weight: 14,
    desc: '扁得像一枚金币，黄底黑带，尾巴张成一柄小扇子。',
    color: 0xffd447, stripe: 0x24243a, stripeN: 3, fanTail: 1.0,
    body: [3.7, 2.9, 0.95], tail: [1.4, 2.1], fin: [1.2, 1.3], eye: 0.7,
  },
  {
    id: 'tuna', name: '金枪鱼', zones: ['twilight'], value: 42, hp: 9,
    radius: 6.5, speed: 64, weight: 9,
    desc: '一枚深蓝色的鱼雷。血很厚，一枪打不死 —— 它会带着伤口继续往上窜。',
    color: 0x2f7fc4, belly: 0xd8f0ff, stripe: 0x0b2c48, stripeN: 2, spots: 0x7fd0ff,
    body: [7.4, 2.9, 1.65], tail: [2.7, 3.1], fin: [1.9, 1.3], eye: 0.7,
  },
  {
    id: 'eel', name: '电鳗', zones: ['twilight', 'deep'], value: 55, hp: 6,
    radius: 6.2, speed: 52, weight: 10,
    desc: '扣钱鱼。黑黄相间的长条，游过的地方水都在发麻。打中它会被电到扣 30 金币。',
    color: 0xf2c400, hazard: true, stripe: 0x101010, stripeN: 5,
    emissive: 0x554400, emissiveIntensity: 0.35,
    body: [9.0, 1.5, 1.1], tail: [1.6, 1.9], fin: [1.0, 0.8], eye: 0.7,
  },
  // ── 深层 Deep ────────────────────────────────────────────
  {
    id: 'lantern', name: '灯笼鱼', zones: ['deep'], value: 66, hp: 6,
    radius: 4.2, speed: 32, weight: 18,
    desc: '身体两侧排着一串小灯，嘴里的牙长得收不回去。深海里最像节日的一种鱼。',
    color: 0x2b3a55, emissive: 0x7fffd4, emissiveIntensity: 0.9, glow: [5.2, 0x4fd8b0],
    spots: 0x9fffe0, fangs: 6, belly: 0x6fe8c0,
    body: [3.7, 2.2, 1.45], tail: [1.5, 1.7], fin: [1.2, 1.0], eye: 0.9,
  },
  {
    id: 'squid', name: '深海乌贼', zones: ['deep'], value: 82, hp: 9,
    radius: 5.6, speed: 44, weight: 12,
    desc: '紫色的软体怪，五条触手一直在水里打卷。遇到危险会喷墨 —— 不过这里没人看得见。',
    color: 0xb46ad8, emissive: 0xd9a0ff, emissiveIntensity: 0.55, glow: [6.4, 0xc78cff], legs: 5,
    body: [3.2, 2.7, 2.2], tail: [2.4, 1.1], fin: [1.0, 1.0], eye: 0.95,
  },
  {
    id: 'sword', name: '剑鱼', zones: ['deep'], value: 100, hp: 16,
    radius: 7.6, speed: 76, weight: 8,
    desc: '鼻子上长着一把一米多长的剑。冲刺起来连渔船的木板都能捅穿。',
    color: 0x4a6a8c, belly: 0xe0f0ff, stripe: 0x16283a, stripeN: 2,
    bill: 4.6, body: [7.8, 2.5, 1.35], tail: [2.7, 3.1], fin: [2.4, 1.6], eye: 0.7,
  },
  {
    id: 'lionfish', name: '狮子鱼', zones: ['deep', 'abyss'], value: 130, hp: 11,
    radius: 6.4, speed: 24, weight: 8,
    desc: '扣钱鱼。红白相间的一身毒鳍，张开来像一把烧着的扇子。碰它一下就要赔钱。',
    color: 0xff4a3d, hazard: true, stripe: 0xfff2f0, stripeN: 5, fanFin: 1.5, spikes: 12,
    body: [3.8, 3.2, 1.5], tail: [1.6, 2.2], fin: [2.6, 2.4], eye: 0.8,
  },
  // ── 深渊 Abyss ───────────────────────────────────────────
  {
    id: 'ghost', name: '幽灵鱼', zones: ['abyss'], value: 160, hp: 8,
    radius: 5.4, speed: 36, weight: 11,
    desc: '半透明的苍白影子，能看见光从它身体里穿过去。有人说它其实是鱼的灵魂。',
    color: 0x8fe0ff, emissive: 0xbff2ff, emissiveIntensity: 0.85, glow: [6.8, 0x9fe8ff],
    opacity: 0.6, whisker: 4, belly: 0xe8ffff,
    body: [5.0, 2.7, 1.6], tail: [2.2, 2.9], fin: [1.6, 1.2], eye: 0.75,
  },
  {
    id: 'hammerhead', name: '双髻鲨', zones: ['abyss'], value: 190, hp: 24,
    radius: 8.0, speed: 60, weight: 6,
    desc: '脑袋向两边摊开成一把锤子，眼睛长在锤子的两端。血厚得离谱。',
    color: 0x8a97a6, belly: 0xe4ecf2, hammer: true, stripe: 0x2b3a4a, stripeN: 1,
    body: [8.2, 2.7, 1.85], tail: [3.0, 3.5], fin: [2.8, 2.0], eye: 0.62,
  },
  {
    id: 'angler', name: '鮟鱇鱼', zones: ['abyss'], value: 200, hp: 18,
    radius: 7.0, speed: 24, weight: 8,
    desc: '额头挂着一盏灯，嘴大得能吞下比自己大的东西，牙全朝里长。',
    color: 0x5a3a4a, emissive: 0xffcc55, emissiveIntensity: 0.6, lure: true,
    fangs: 8, belly: 0x8a5a6a, bignose: 0.5,
    body: [4.7, 3.7, 2.85], tail: [1.8, 2.1], fin: [1.4, 1.1], eye: 0.95,
  },
  {
    id: 'oarfish', name: '皇带鱼', zones: ['abyss'], value: 260, hp: 10,
    radius: 8.5, speed: 48, weight: 5,
    desc: '一条银色的长绸带，头上顶着一撮红缨。传说看到它就预示着地震。',
    color: 0xe2ecf5, belly: 0xffffff, emissive: 0x9fe8ff, emissiveIntensity: 0.4,
    crest: true, crestColor: 0xff3d3d, stripe: 0xb0c4d8, stripeN: 6,
    body: [11.0, 1.8, 0.85], tail: [2.0, 1.7], fin: [1.2, 0.9], eye: 0.55,
  },
  {
    id: 'manta', name: '蝠鲼', zones: ['abyss'], value: 340, hp: 26,
    radius: 9.5, speed: 52, weight: 4,
    desc: '水里的风筝。双翼展开近十米，游过去的时候像一片会动的夜。',
    color: 0x35485e, belly: 0xcfe0ee, emissive: 0x5f7fa0, emissiveIntensity: 0.5,
    wings: 8.2, spots: 0x9fd8ff,
    body: [4.7, 1.9, 3.7], tail: [3.2, 0.8], fin: [1.0, 0.8], eye: 0.55,
  },
  // ── 海沟 Trench ──────────────────────────────────────────
  {
    id: 'viper', name: '毒蛇鱼', zones: ['trench'], value: 420, hp: 18,
    radius: 6.5, speed: 40, weight: 5,
    desc: '全身漆黑，靠一排发光的侧线在黑暗里伏击。牙长到合不上嘴。',
    color: 0x14283c, emissive: 0x66ffcc, emissiveIntensity: 0.75,
    spikes: 10, glow: [7.2, 0x3fd8a8], fangs: 8, spots: 0x66ffcc,
    body: [5.6, 2.2, 1.3], tail: [2.0, 2.2], fin: [1.4, 1.1], eye: 0.85,
  },
  {
    id: 'goldking', name: '黄金鱼王', zones: ['trench'], value: 680, hp: 60,
    radius: 11.0, speed: 28, weight: 1.6,
    // ⚠ 本图的 Boss：不参与稀有度抽签（`elite: false`）。
    //   两个理由：① 它本身就已经是"稀有"了，再叠一层金边会让"金色"这个信号贬值；
    //   ② 数值上它更不能抽 —— 680 × 王冠 12 = 8160，比第二张图的 Boss（1900）还高 4 倍，
    //      第一张图的收尾鱼会把后面所有地图的经济天花板顶穿。
    //   （和冰封极地的「极夜之王」同一条规则，见 verify8 A12。）
    elite: false, boss: true,
    desc: '海沟底的王。通体鎏金，头顶王冠，普通手枪打空一整梭子都未必放得倒。',
    color: 0xffcc33, emissive: 0xffaa00, emissiveIntensity: 1.0,
    glow: [13.5, 0xffd766], crown: true, belly: 0xfff0b0, spots: 0xfff8d0,
    body: [7.2, 4.1, 2.65], tail: [2.9, 3.7], fin: [2.0, 1.6], eye: 0.95,
  },

  // ══ ② 冰封极地 POLAR ═══════════════════════════════════════
  // 配色规则：整体走冷色（冰蓝 / 银白 / 钢灰），**只有发光鱼用暖色点缀** ——
  // 极地这张图的信息密度比宁静海湾高（多了浮冰），鱼再花就找不着了。
  // 身价 17 → 1900，是宁静海湾的 2.8 倍（见 EXPANSION 3.1 的两个梯度）。

  // ── 浮冰浅海 Ice Shelf（0 ~ 70m）──────────────────────────
  {
    id: 'ice-scad', name: '冰鲹', zones: ['ice-shelf'], value: 17, hp: 2,
    radius: 3.4, speed: 52, weight: 28, school: 6,
    desc: '冰洞口最常见的一群小银鱼，鳍边泛着淡蓝。一枪能穿两条。',
    color: 0xdff0fb, belly: 0xffffff, stripe: 0x5a9fc4, stripeN: 2, spots: 0xffffff,
    body: [4.4, 1.5, 0.95], tail: [1.8, 1.7], fin: [1.3, 0.9], eye: 0.5,
  },
  {
    id: 'snow-crab', name: '雪蟹', zones: ['ice-shelf'], value: 26, hp: 5,
    radius: 4.4, speed: 22, weight: 18,
    desc: '一身白壳的横行者，八条腿在水里划得毫无章法。壳比看起来硬。',
    color: 0xf2f8ff, belly: 0xffffff, spikes: 12, legs: 6, spots: 0xcfe0ee,
    body: [3.6, 2.6, 2.4], tail: [1.0, 1.2], fin: [1.4, 1.4], eye: 0.8,
  },
  {
    id: 'arctic-cod', name: '北极鳕', zones: ['ice-shelf'], value: 38, hp: 4,
    radius: 5.2, speed: 40, weight: 16,
    desc: '灰绿底色上撒着一层浅斑，下巴挂着三根须。冷水里长大的都长得慢。',
    color: 0x9fb8ac, belly: 0xeaf6f0, stripe: 0x4a6a5c, stripeN: 3, spots: 0xd8f0e4,
    whisker: 3, body: [5.6, 2.2, 1.25], tail: [2.0, 2.2], fin: [1.5, 1.1], eye: 0.65,
  },
  {
    id: 'ice-jelly', name: '冰水母', zones: ['ice-shelf'], value: 22, hp: 3,
    radius: 4.8, speed: 14, weight: 12,
    desc: '扣钱鱼。一团几乎透明的冰蓝色触手，几乎看不见，直到你撞上去。打中它会炸开扣 30 金币。',
    color: 0xbfe8ff, hazard: true, emissive: 0x8fe0ff, emissiveIntensity: 0.9,
    glow: [5.6, 0x9fe8ff], opacity: 0.62, legs: 6, spikes: 14, belly: 0xe8f8ff,
    body: [3.2, 3.0, 2.6], tail: [1.0, 1.0], fin: [0.9, 0.9], eye: 0.7,
  },

  // ── 霜蓝水道 Ice Twilight（70 ~ 170m）────────────────────
  {
    id: 'silver-cod', name: '银鳕', zones: ['ice-twilight'], value: 62, hp: 6,
    radius: 5.6, speed: 36, weight: 18, school: 4,
    desc: '全身覆着一层真银似的鳞，光打上去会整条亮一下。深一点的水里最好认。',
    color: 0xdceaf5, belly: 0xffffff, stripe: 0x9fb8cc, stripeN: 2, spots: 0xffffff,
    body: [6.0, 2.3, 1.3], tail: [2.1, 2.3], fin: [1.6, 1.2], eye: 0.6,
  },
  {
    id: 'narwhal-calf', name: '独角鲸幼崽', zones: ['ice-twilight'], value: 78, hp: 10,
    radius: 6.8, speed: 48, weight: 12,
    desc: '鼻子上顶着一根还没长开的长牙，会拿它戳冰块玩。完全不知道自己很值钱。',
    color: 0x9fb4c8, belly: 0xeaf4ff, bill: 5.2, spots: 0xd8e4f0,
    body: [7.0, 2.8, 2.0], tail: [2.6, 3.0], fin: [1.8, 1.4], eye: 0.6,
  },
  {
    id: 'bluefin', name: '蓝鳍金枪', zones: ['ice-twilight'], value: 95, hp: 12,
    radius: 7.2, speed: 68, weight: 10,
    desc: '冷水版的鱼雷，鳍尖一抹亮蓝。血厚、跑得快，是上升阶段最难串的一条。',
    color: 0x2f6fa8, belly: 0xcfe8f8, stripe: 0x0d2c48, stripeN: 2, spots: 0x7fc8ff,
    body: [7.6, 2.8, 1.7], tail: [2.7, 3.1], fin: [2.0, 1.4], eye: 0.7,
  },
  {
    id: 'ice-crystal', name: '冰晶鱼', zones: ['ice-twilight'], value: 140, hp: 9,
    radius: 5.6, speed: 28, weight: 8, school: 3,
    desc: '身上长满棱柱状的透明结晶，自己会发光。据说整条鱼就是一块长成鱼形的冰。',
    color: 0xa8e8ff, emissive: 0x6fd8ff, emissiveIntensity: 1.0, glow: [7.4, 0x8fe8ff],
    spikes: 16, spots: 0xffffff, belly: 0xe8ffff,
    body: [3.8, 2.8, 2.2], tail: [1.4, 1.8], fin: [1.6, 1.6], eye: 0.85,
  },

  // ── 极光长廊 Ice Deep（170 ~ 300m）───────────────────────
  {
    id: 'aurora-fish', name: '极光鱼', zones: ['ice-deep'], value: 190, hp: 11,
    radius: 6.0, speed: 40, weight: 12,
    desc: '通体绿紫交错的辉光，游动时像把一小段极光揣在了身上。',
    color: 0x6fe8c0, emissive: 0x7f6fff, emissiveIntensity: 0.95, glow: [8.0, 0x9f8fff],
    stripe: 0xb08fff, stripeN: 3, spots: 0xd8fff0, belly: 0xd8ffe8,
    body: [5.0, 2.4, 1.5], tail: [1.9, 2.4], fin: [1.8, 1.5], eye: 0.75,
  },
  {
    id: 'ice-eel', name: '深海冰鳗', zones: ['ice-deep'], value: 240, hp: 9,
    radius: 6.6, speed: 52, weight: 10,
    desc: '一条半透明的长鞭子，体内有一条淡蓝的脊线在流动。游起来几乎没有声音。',
    color: 0xbfe0f0, emissive: 0x5fc8ff, emissiveIntensity: 0.6, glow: [6.4, 0x8fd8ff],
    stripe: 0x2a5a7a, stripeN: 5,
    body: [9.2, 1.5, 1.1], tail: [1.6, 1.9], fin: [1.0, 0.8], eye: 0.7,
  },
  {
    id: 'snow-sturgeon', name: '雪原鲟', zones: ['ice-deep'], value: 310, hp: 26,
    radius: 8.2, speed: 32, weight: 7,
    desc: '背上一排骨板，像披了件老式的铠甲。慢，但很难一枪放倒。',
    color: 0xc8d8e4, belly: 0xf0f8ff, stripe: 0x6a8496, stripeN: 4, spikes: 14,
    whisker: 4, body: [8.6, 2.4, 1.7], tail: [2.6, 3.0], fin: [1.7, 1.3], eye: 0.55,
  },
  {
    id: 'ice-crab', name: '冰甲蟹', zones: ['ice-deep'], value: 420, hp: 34,
    radius: 7.8, speed: 24, weight: 5,
    desc: '壳上结了厚厚一层冰，敲上去当当响。全身唯一的软处是那对眼睛。',
    color: 0x8fb8d0, belly: 0xd8ecf8, spikes: 18, legs: 6, spots: 0xe0f4ff,
    emissive: 0x5fa8d8, emissiveIntensity: 0.3,
    body: [4.2, 3.2, 3.0], tail: [1.1, 1.3], fin: [1.6, 1.5], eye: 0.85,
  },

  // ── 永冻深渊 Ice Abyss（300 ~ 460m）──────────────────────
  {
    id: 'megalodon', name: '巨齿鲨', zones: ['ice-abyss'], value: 560, hp: 48,
    radius: 9.8, speed: 60, weight: 5,
    desc: '一张嘴就是三排牙。它不在乎你钓的是什么，它只在乎你比它小。',
    color: 0x6a8496, belly: 0xdce8f0, stripe: 0x2a3a4a, stripeN: 1, fangs: 10,
    body: [9.4, 3.2, 2.2], tail: [3.4, 3.8], fin: [2.8, 2.0], eye: 0.6,
  },
  {
    id: 'frozen-ghost', name: '冰封幽灵', zones: ['ice-abyss'], value: 700, hp: 15,
    radius: 6.8, speed: 36, weight: 6,
    desc: '一具被冻在冰里的轮廓，冰化了它还在游。没人愿意细看它长什么样。',
    color: 0xcfeaff, emissive: 0x9fd8ff, emissiveIntensity: 0.9, glow: [7.6, 0xbfe8ff],
    opacity: 0.55, whisker: 4, belly: 0xf0fbff,
    body: [5.4, 2.8, 1.7], tail: [2.3, 3.0], fin: [1.7, 1.3], eye: 0.75,
  },
  {
    id: 'polar-oarfish', name: '极地皇带', zones: ['ice-abyss'], value: 880, hp: 12,
    radius: 9.2, speed: 44, weight: 4,
    desc: '一条会发光的银带子，头顶的冠是冰蓝色的。极地里管它叫"海底极光"。',
    color: 0xd8e8f5, belly: 0xffffff, emissive: 0x7fd0ff, emissiveIntensity: 0.45,
    crest: true, crestColor: 0x9fd8ff, stripe: 0xa8c4d8, stripeN: 6,
    body: [11.4, 1.9, 0.9], tail: [2.1, 1.8], fin: [1.2, 0.9], eye: 0.55,
  },
  {
    id: 'frost-throat', name: '霜之喉', zones: ['ice-abyss'], value: 1150, hp: 40,
    radius: 8.8, speed: 28, weight: 4,
    desc: '额头挂着一盏冷光的灯，嘴张开比身体还宽。呼出来的气在深海里也是白的。',
    color: 0x4a5a6a, emissive: 0x8fe8ff, emissiveIntensity: 0.55, lure: true,
    fangs: 9, bignose: 0.5, belly: 0x8fa8b8,
    body: [5.2, 4.0, 3.0], tail: [1.9, 2.2], fin: [1.5, 1.2], eye: 0.95,
  },

  // ── 极夜之底 Ice Trench（460 ~ 620m）────────────────────
  {
    id: 'frost-leviathan', name: '冰霜利维坦幼体', zones: ['ice-trench'], value: 1450, hp: 50,
    radius: 11.6, speed: 40, weight: 3,
    desc: '注意"幼体"两个字。它展开的双翼已经比渔船还宽了，而成体据说有一百米。',
    color: 0x7fb8d8, belly: 0xd8f0ff, emissive: 0x5fc0ff, emissiveIntensity: 0.5,
    glow: [13.0, 0x8fd8ff], wings: 9.4, spikes: 16,
    body: [8.0, 3.4, 4.2], tail: [3.6, 4.2], fin: [2.6, 2.0], eye: 0.7,
  },
  {
    id: 'polar-night-king', name: '极夜之王', zones: ['ice-trench'], value: 1900, hp: 120,
    radius: 13.2, speed: 32, weight: 1.4,
    // ⚠ 本图的 Boss：不参与稀有度抽签（它本身就已经是"稀有"了），
    //   再叠一层金色描边会让"金色"这个信号失去意义。
    elite: false, boss: true,
    desc: '极夜之底的王。通体漆黑，只有王冠和侧线泛着极淡的蓝。血厚得不像话。',
    color: 0x1a2a44, belly: 0x2a4a6a, emissive: 0x6f9fff, emissiveIntensity: 0.8,
    glow: [16.0, 0x8fb8ff], crown: true, spots: 0xbfe0ff, fangs: 8,
    body: [9.0, 4.4, 3.2], tail: [3.4, 4.0], fin: [2.4, 1.9], eye: 1.0,
  },
];

// ───────────────────────── 升级项 ─────────────────────────
// 7 项：6 项走等级曲线（cost(lv) = base × GROWTH^lv），1 项（绞盘）是**一次性购买**。
//
// 分层直接写在 base 上，玩家打开商店一眼就知道哪些该现在买、哪些要攒：
//   基础 tier：base 100~180
//   进阶 tier：base 340~450
//   工具 tier：一次性买断（没有等级曲线，见下面的 `oneShot`）
//
// ⚠ 为什么 BASE_MUL 是 1.0、分层交给 base 本身：
//   如果用小 base + 大 BASE_MUL（比如全部 ×3），开局第一次升级要攒 5 竿 ≈ 6 分钟，
//   玩家开局买不到任何东西 = 劝退；而且整体缩放会抹平各项之间的相对差距，
//   分层的表达力被浪费。让 base 自己承担分层，尾部长度交给 GROWTH 去拉。
//
// ⚠ `icon` 字段现在填的是 **GLYPH 的键名**（不是 emoji）。
//   界面渲染走 icons.js 的 `glyph(u.icon)`，不再有 emoji 兜底 —— 界面里一个 emoji 都不能有
//   （verify6 的 C11 会全量扫描整页 innerText 把这条钉死）。
//   新增升级项时：只要在 icons.js 的 GLYPH 里加同名键，商店就自动有图标。
//
// ⚠ `unlockMap` 是解锁该升级项需要持有的**地图许可证**（null = 开局可用）。
//
// ⚠ `oneShot` + `maxLv = 1`：这一项**没有等级曲线**，买一次就永久拥有
//   （`upgradeCost` 在 lv ≥ maxLv 时返回 Infinity，商店渲染成「已拥有」）。
//   它的效果必须是**开关型**的（绞盘 = 多一个「快速回收」按钮），
//   不要往里塞"每级给一点"的成长 —— 那属于曲线项。
//
// ⚠⚠ `desc` 的**长度是有预算的**：商店一行只有 ~176px 给「desc · 当前 → 下一级」，
//    而这条文案会随等级变长（`1033 → 1100m` 比 `80 → 150m` 宽得多），
//    所以 desc 必须留出余量。7 个字就是上限，8 个字在满级附近会折行。
//    （折行不只是难看：那一行会比旁边高出 16px，整列看着像排版坏了。
//      verify7 的 B6/B7 会把这条钉死，改 desc 后记得重跑。）
//
// ⚠ `unit` 是**数值单位后缀，包含前面的空格**（`%` 不带空格，其余带一个）。
//    它只在行尾显示一次（`1033 → 1100m`），不是每边各带一遍 —— 见 upgradeValueText。
export const UPGRADES = {
  line: {
    key: 'line', name: '鱼线', icon: 'line', base: 250, tier: '基础', unlockMap: null,
    desc: '下潜深度', unit: 'm',
  },
  hook: {
    key: 'hook', name: '鱼钩', icon: 'hook', base: 200, tier: '基础', unlockMap: null,
    desc: '捕获半径', unit: 'm',
  },
  // 铅坠（v0.5 重做）：不再给"下潜速度"，而是**可直接跳过的最大深度** ——
  // 开竿时钩子直接出现在玩家指定的深度（见 TUNING.DROP_MAX_RATIO 的 70% 上限）。
  // 下潜速度因此变成常量（TUNING.DESCEND_SPEED），不再是一条升级轴。
  sinker: {
    key: 'sinker', name: '铅坠', icon: 'sinker', base: 160, tier: '基础', unlockMap: null,
    desc: '直达深度', unit: 'm',
  },
  lamp: {
    key: 'lamp', name: '灯具', icon: 'lamp', base: 300, tier: '基础', unlockMap: null,
    desc: '照亮半径', unit: 'm',
  },
  creel: {
    key: 'creel', name: '鱼护', icon: 'creel', base: 560, tier: '进阶', unlockMap: 'polar',
    desc: '串鱼上限', unit: ' 条',
  },
  bait: {
    key: 'bait', name: '鱼饵', icon: 'bait', base: 740, tier: '进阶', unlockMap: 'polar',
    desc: '高价鱼概率', unit: '%',
  },
  // 绞盘（v0.5 重做）：一次性买断的工具。买下之后上升阶段多一个「快速回收」按钮。
  //
  // ⚠ v0.7：`unlockMap: 'polar'` —— 拿到「冰封极地」许可证之后才出现在商店里。
  //
  //   **首图是"新手图"**：货架只放 4 项基础 + 1 件待解锁的工具，
  //   鱼护 / 鱼饵（`unlockMap: 'polar'`）和绞盘都要换图之后才上架 ——
  //   目的是让"第一次换图"同时成为**货架变厚**的那一刻，而不是单纯换个水色。
  //   ⚠ 这条会缩短首图的内容量（少买 2 项 = 少花钱），是**明知代价的选择**：
  //     GAMEPLAY 的 A11（内容量）已明确"先不管"，等第 3 张图落地再回头调。
  winch: {
    key: 'winch', name: '绞盘', icon: 'winch', base: 9000, tier: '工具', unlockMap: 'polar',
    oneShot: true, maxLv: 1,
    desc: '快速回收', unit: '',
  },
};

// 商店里的显示顺序：基础 → 进阶 → 工具（和上面的定义顺序一致，显式写出来防止以后重排）
export const UPGRADE_ORDER = [
  'line', 'hook', 'sinker', 'lamp',
  'creel', 'bait',
  'winch',
];

export const MAX_LEVEL = 20;

/**
 * 某一项升级的**等级上限**。
 *
 * 普通项是 `MAX_LEVEL`（20）；一次性工具（`oneShot`，如绞盘）是 1 —— 买一次就满。
 * 所有"还能不能继续买 / 该不该渲染 MAX"的判断都必须走它，**不要直接比 `MAX_LEVEL`**：
 * 直接比的话，绞盘会在 lv=1 时被判成"还能买"，商店给出一个永远点不动的按钮。
 */
export const maxLvOf = (key) => UPGRADES[key]?.maxLv ?? MAX_LEVEL;

/**
 * 每级成本倍率。
 * 标定过程（见 EXPANSION.md 第一章）：1.34 → 132 竿（太短）；1.47 → 320 竿 6.2h（选中）；
 * 1.50 → 366 竿（尾部偏陡）。
 */
export const GROWTH = 1.62;

export const upgradeCost = (key, level) =>
  level >= maxLvOf(key) ? Infinity : Math.round(UPGRADES[key].base * Math.pow(GROWTH, level));

/**
 * 每张地图开放的等级上限（累计值）。
 *   第 1 张图最多 Lv5，第 2 张 Lv9，第 3 张 Lv13，第 4 张 Lv17，第 5 张 Lv20。
 *
 * 为什么用「同一棵树 + 分段封顶」而不是「每张图一套独立升级树」：
 * 独立树会让玩家换图后之前的投入全部作废；分段封顶则投入全部有效，只是"暂时买不动了"。
 * 副作用是每张图的"毕业"信号非常明确 —— 升级按钮全部变灰，这就是"该换图了"。
 */
/**
 * 每张地图开放到第几级 —— 这是**换图的进度闸门**。
 *
 * 数值不是随便定的：`LEVELS.maxDepth` 在每个节点上正好等于该地图的深度上限，
 * 所以"买满本图的等级"= "刚好能潜到本图的底"，玩家自然会想换一片更深的海。
 *
 *   Lv5  → maxDepth 860  = 宁静海湾的上限 ✓
 *   Lv9  → maxDepth 1240 = 冰封极地的上限 ✓
 *   Lv13 → maxDepth 1560 = 熔岩海沟 ✓
 *   Lv17 → maxDepth 1800 = 废弃沉船 ✓
 *   Lv20 → maxDepth 2200 = 深海之声 ✓
 *
 * ⚠ 改 LEVELS.maxDepth 的时候必须回头核对这张表 —— 两边错开一级，
 *   玩家就会卡在"买满了却潜不到底"或者"还没买满就到底了"。
 *   verify7 的 A8 / verify8 会断言这个对应关系。
 */
export const MAP_LEVEL_CAP = [5, 9, 13, 17, 20];

/** 某张地图的等级上限（越界一律钳到最后一张，脏存档不要炸） */
export const levelCapForMap = (mi) => MAP_LEVEL_CAP[Math.min(Math.max(mi, 0), MAP_LEVEL_CAP.length - 1)];

/**
 * 各项升级「每级到底给多少」的数值表。
 * 索引就是等级 0~20，和 UPGRADES[x].base 一一对应。
 * 想调手感只改这里，别去逻辑里散落魔法数字。
 *
 * **v0.5 起只剩 7 条曲线**（原来是 12 条）。删掉的 6 条连同它们的机制一起移除了：
 *   descendSpeed（铅坠·下潜速度）→ 改成 dropDepth，下潜速度变成常量 DESCEND_SPEED
 *   ascendSpeed （绞盘·收线速度）→ 绞盘改成一次性工具，收线速度变成常量 ASCEND_SPEED
 *   gunPower    （攻击力）        → 并入枪械自身等级（见 GUNS 的 dmg 说明）
 *   insurance   （保险）          → 移除，罚款固定
 *   sonar       （声呐）          → 移除
 *   rig         （加固）          → 移除，撞鱼判定固定
 *
 * ⚠ **索引 0~4 冻结成 v0.2 的现值**，不许改：
 *   - 宁静海湾的 5 个海域边界（110/240/390/550/860）就是照着 maxDepth[0..4] 调的；
 *   - verify3 的 T8~T11 直接断言 Lv4 的数值（840 / 17.6 / 240 / 18）；
 *   - verify7 的 A3 逐位核对这一组（改了就挂）。
 *   要扩等级只改 5 以后的斜率。
 *
 * 曲线形状的理由（见 EXPANSION.md 第二章）：
 *   - maxDepth 用锚点插值，锚点就是各图的深度上限 → "升到 Lv5 就能潜满第一张图"是结构保证的；
 *   - dropDepth 同样用锚点插值，锚点取各图深度上限的 70%（见 TUNING.DROP_MAX_RATIO）——
 *     保证"跳到底"永远不等于"跳过整个下潜段"；
 *   - lampPower 封顶 0.95，留 5% 黑暗让最深处永远有一点压迫感。
 */
export const LEVELS = {
  maxDepth:   [320, 450, 580, 710, 840, 860, 956, 1050, 1146, 1240, 1320, 1400, 1480, 1560, 1620, 1680, 1740, 1800, 1934, 2066, 2200], // m — 鱼线
  hookRadius: [8, 10.4, 12.8, 15.2, 17.6, 18, 18.4, 18.8, 19.2, 19.6, 20, 20.4, 20.8, 21.2, 21.6, 22, 22.4, 22.8, 23.2, 23.6, 24],  // 世界单位 — 鱼钩
  // 铅坠：**可直接跳过的最大深度**（米）。实际能跳多深还要和鱼线极限、70% 上限取小。
  // 锚点：Lv0 = 80（开局就能省一点）· Lv9 = 860（≈ 冰封极地 1240 的 70%）· Lv20 = 1540（= 2200 的 70%）。
  dropDepth:  [80, 170, 250, 340, 430, 510, 600, 690, 770, 860, 920, 980, 1050, 1110, 1170, 1230, 1290, 1350, 1420, 1480, 1540], // m — 铅坠
  lampRadius: [52, 92, 136, 184, 240, 258, 276, 294, 312, 330, 348, 366, 384, 402, 420, 438, 456, 474, 492, 510, 528],       // 照亮半径 — 灯具
  lampPower:  [0.10, 0.30, 0.48, 0.66, 0.84, 0.85, 0.85, 0.86, 0.87, 0.88, 0.89, 0.89, 0.90, 0.91, 0.91, 0.92, 0.93, 0.94, 0.94, 0.95, 0.95], // 0~1 — 灯具
  creelLimit: [8, 11, 13, 16, 18, 21, 24, 26, 29, 31, 34, 37, 39, 42, 44, 47, 50, 52, 55, 57, 60],                         // 条 — 鱼护
  bait:       [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],                        // % — 鱼饵（高价鱼权重加成）
};

/**
 * 按等级取曲线上的一项值（**所有** TUNING 函数都必须走这里，不要直接 `LEVELS.x[lv]`）。
 *
 * 为什么必须包一层：7 条曲线 × 21 个等级，只要有一处传进来的等级是 undefined / 越界
 * —— 旧存档、测试里手写的 levels 对象、将来新加的升级项 ——
 * `LEVELS.x[undefined]` 会安静地返回 undefined，然后 NaN 顺着
 * `hook.y += this.ascendSpeed * dt` 一路污染物理：**不报错、不闪退，
 * 只是鱼再也钓不上来**。这种 bug 排查成本极高，所以在唯一的入口处一次性钉死。
 */
export const lvAt = (key, lv) => {
  const row = LEVELS[key];
  // 曲线名写错时**直接抛**，不要静默返回 undefined —— 后者正是上面说的那种隐形 NaN。
  if (!row) throw new Error(`lvAt: LEVELS 里没有「${key}」这条曲线`);
  const i = Math.max(0, Math.min(MAX_LEVEL, Math.round(Number(lv)) || 0));
  return row[i];
};

/**
 * 某一项升级在某个等级下的**显示文案**（商店里「当前 → 下一级」用）。
 * 从 LEVELS 取值而不是在 UPGRADES 里手写 20 个字符串 —— 数值改了文案自动跟着改，
 * 不会出现"表里改了、商店还显示旧值"的错位。
 */
/**
 * 商店里的「数值文案」——**只返回数字，不带单位**。
 *
 * 单位由 `UPGRADES[key].unit` 提供，在行尾统一显示一次：
 *   `下潜深度 · 1033 → 1100m`
 * 而不是每边各带一遍（`1033m → 1100m`）。
 *
 * 为什么把单位挪出去：商店那一列只有 ~176px，而单位重复一次就要多占 14~28px。
 * 满级附近的长数字（`1033 → 1100m`）本来就已经顶到边，再叠一个重复单位必然折行。
 * 省下来的宽度让每一项在 0~19 级全程都是单行 —— 这正是 verify7 B6/B7 断言的东西。
 *
 * ⚠ **一次性项（`oneShot`）返回空串**：它没有「当前 → 下一级」的数值可比，
 *   商店那边会改渲染成「未购买 / 已拥有」。别给它编一个数字出来。
 *
 * ⚠ 这个函数**只被 ui.js 的商店行使用**（全项目仅一处调用），所以改契约不会波及别处。
 */
export function upgradeValueText(key, lv) {
  switch (key) {
    case 'line': return `${lvAt('maxDepth', lv)}`;
    case 'hook': return `${lvAt('hookRadius', lv)}`;
    case 'sinker': return `${lvAt('dropDepth', lv)}`;
    case 'lamp': return `${lvAt('lampRadius', lv)}`;
    case 'creel': return `${lvAt('creelLimit', lv)}`;
    case 'bait': return `${lvAt('bait', lv)}`;
    case 'winch': return '';      // 一次性工具：没有等级数值
    default: return '';
  }
}

// ───────────────────────── 枪械 ─────────────────────────
//
// 一把枪 = 一条「机制」+ 六档数值（Lv0 ~ Lv5，也就是**可升级 5 级**）。
//
// 为什么把枪做成数据表而不是 if-else：
//   7 把枪 × 6 档 × 5 个数值 = 210 个数字。散在 game.js 里的话，
//   ① 改一个数要满仓库找；② 枪店界面没法"照着表渲染"；③ 数值文档只能手抄。
//
// ── 数值字段（都是长度 6 的数组，索引 = 枪械等级）──
//   dmg   单发基础伤害（**未乘攻击力倍率**；最终伤害 = dmg × LEVELS.gunPower[攻击力等级]）
//   rad   单发判定/爆炸半径（世界单位）。**它是一把枪的身份**，不要拿全局倍率去抹平
//   cd    两发之间的最小间隔（秒）。单点枪 = 点击冷却下限；连发枪 = 射速
//   mag   弹匣容量（发）。`null` = 没有弹匣概念（单点枪 / 加特林）
//   reload 换弹耗时（秒）。`null` 同上
//
// ── 机制字段（`mech`）──
//   'single'  单点：一次点击一发，**不支持长按连发**（普通手枪 / 散弹枪 / 巴雷特）
//   'burst'   弹匣连发：按住连发到弹匣空 → 自动换弹 → 换完继续（Uzi）
//   'auto'    持续连发：按住就一直打，没有弹匣，但有 `spinup` 秒的转速预热（加特林）
//   'laser'   激光：按住持续结算，**伤害随连续照射时间递增**，`mag` 当"过热时长"、
//             `reload` 当"强制冷却时长"用（激光枪）
//   'pierce'  穿透：一次点击打出一条**直线弹道**，命中线上所有鱼（鱼叉枪）
//
// ── 价格与升级成本 ──
//   price  购买价（0 = 初始拥有）
//   upBase 升级基价，第 lv 次升级花 `upBase × GUN_GROWTH^lv`（lv 从 0 起，共 5 次）
//
// ⚠ 平衡锚点（改数值前先读这四条）：
//   ① **普通手枪 Lv0 = 2 伤害 / 24 半径 / 0.30s 间隔**。24 是旧版 48 的**一半**
//      （用户要求"攻击范围缩小 50%"），而 2 伤害正好让表层鱼（hp 2~5）1~3 枪解决。
//   ② 每把枪的"身份"必须一眼看得出来：散弹=覆盖、Uzi=爆发但有空窗、
//      加特林=持续输出但要预热、激光=越照越疼但会过热、巴雷特=一炮清场但很慢、
//      鱼叉=一条线上全串走。
//   ③ 后一把枪**不是**前一把的严格上位：巴雷特 DPS 最低但单发最高；
//      加特林持续 DPS 最高但半径最小、还要预热。让玩家按场景换枪，而不是按价格。
//   ⑤ ⭐ **枪械分段解锁（v0.7 第三批，A2 = a + b）**：
//        · `unlockMap`   要「到过某张图」才上架（判定 = `mapProgress().owned`，与渔具店同源）
//        · `unlockDepth` 在那张图**潜到过这个深度**才上架（读 `mapBest`）
//      首图只有手枪；散弹枪跟人一起到极地；后面五把按海域一层层往下放
//      （140 霜蓝水道 / 340 极光长廊 / 600 永冻深渊 / 920 极夜之底 / 1100 极夜之底深处）。
//      为什么用深度而不用金币：**引导玩家先潜深** —— 和"换图要潜到底拿海图"是同一个方向，
//      而且"解锁一把新枪"和"见到一片新海域"正好同时发生，推送提示才有意义。
//      ⚠ **已拥有的枪永远视为已解锁**（老存档兜底，B5 的教训：不能把玩家手里的东西判成"未解锁"）。
//
//   ⑥ ⭐ **新枪上架要播报（v0.7 第三批）**：一把枪从"锁着"变"可见"的那一刻，
//      `game.js` 的 `_syncGunNews()` 会把它记进 `save.gunNews`，
//      然后走 iOS 式推送横幅 + 手机红点 + 枪店 App 红点；玩家**点开枪店**之后红点才消失，
//      新枪在店里挂「New」角标。判定只在这一处（`_syncGunNews`），界面只负责播。
//
//   ④ ⭐ **`dmg` 曲线自带"攻击力成长"，不再有全局倍率**（v0.5）。
//      v0.4 时"攻击力"是一条独立的 21 级全局乘数（×1.00 → ×3.80），
//      作用在 `dmg[lv] × gunPower[攻击力等级]` 上。v0.5 把那条曲线**并进了枪械自身**：
//      每把枪的 `dmg[i]` 都乘了一条 `1 + 2.8·i/5` 的斜坡，所以
//        `新 dmg[5] = 旧 dmg[5] × 3.8`、`新 dmg[0] = 旧 dmg[0]`（Lv0 一分不变）。
//      于是"把枪升满"的终局强度**和改之前完全一致**，但成长只由枪械升级一条轴承担。
//      ⚠ 改 `dmg` 时不要再想着乘一个全局系数 —— 那条路已经封掉了。
//      ⚠ 斜坡只乘伤害、**不乘半径**：半径是每把枪的身份，全局放大会把七把枪抹平。
export const GUNS = [
  {
    id: 'pistol', name: '普通手枪', en: 'PISTOL', icon: 'gun-pistol',
    mech: 'single', tier: '初始', price: 0, upBase: 1800,
    desc: '单点 · 均衡',
    tip: '点一次打一发，不能长按连发。范围最小，但指哪打哪、没有空窗。',
    dmg: [2, 4.7, 10.6, 18.8, 32.4, 53.2],
    rad: [24, 27, 31, 35, 40, 46],
    cd:  [0.30, 0.30, 0.29, 0.28, 0.27, 0.26],
    mag: null, reload: null,
  },
  {
    id: 'shotgun', name: '散弹枪', en: 'SHOTGUN', icon: 'gun-shotgun',
    mech: 'single', tier: '轻型', price: 8000, upBase: 5200,
    unlockMap: 'polar',
    desc: '扇形 · 覆盖',
    tip: '一次打出 6 颗弹丸呈扇形铺开，覆盖极广。单颗伤害低，贴脸才打得满。',
    dmg: [1.6, 3.4, 6.4, 10.7, 17.5, 26.6],
    rad: [16, 18, 20, 22, 25, 28],
    cd:  [0.85, 0.82, 0.79, 0.75, 0.71, 0.66],
    mag: null, reload: null,
    pellets: 6, spread: 30,
  },
  {
    id: 'uzi', name: 'Uzi', en: 'UZI', icon: 'gun-uzi',
    mech: 'burst', tier: '轻型', price: 14000, upBase: 8400,
    unlockMap: 'polar', unlockDepth: 140,
    desc: '连发 · 换弹',
    tip: '按住就是一梭子，打空后自动换弹，换完接着连发。爆发高，但有换弹空窗。',
    dmg: [1.5, 3, 5.1, 8.3, 12.6, 19],
    rad: [14, 15, 16, 18, 20, 22],
    cd:  [0.100, 0.095, 0.090, 0.085, 0.080, 0.075],
    mag: [9, 11, 13, 16, 19, 24],
    reload: [1.40, 1.34, 1.28, 1.20, 1.12, 1.00],
  },
  {
    id: 'gatling', name: '加特林', en: 'GATLING', icon: 'gun-gatling',
    mech: 'auto', tier: '中型', price: 26000, upBase: 14000,
    unlockMap: 'polar', unlockDepth: 340,
    desc: '持续 · 预热',
    tip: '按住就一直打，没有换弹。开火头 0.9 秒转速没上来，射速只有一半。',
    dmg: [0.8, 1.6, 2.8, 4.3, 6.5, 9.5],
    rad: [12, 13, 14, 15, 16, 18],
    cd:  [0.075, 0.072, 0.069, 0.066, 0.063, 0.060],
    mag: null, reload: null,
    spinup: 0.9,
  },
  {
    id: 'harpoon', name: '鱼叉枪', en: 'HARPOON', icon: 'gun-harpoon',
    mech: 'pierce', tier: '中型', price: 34000, upBase: 18000,
    unlockMap: 'polar', unlockDepth: 600,
    desc: '穿透 · 直线',
    tip: '朝瞄准方向甩出一条贯穿整屏的鱼叉，线上的鱼全部命中。排成一列时最爽。',
    dmg: [5, 12.5, 25.4, 48.2, 87.5, 152],
    rad: [7, 8, 9, 10, 11, 13],
    cd:  [0.75, 0.72, 0.69, 0.66, 0.63, 0.58],
    mag: null, reload: null,
  },
  {
    id: 'laser', name: '激光枪', en: 'LASER', icon: 'gun-laser',
    mech: 'laser', tier: '重型', price: 42000, upBase: 22000,
    unlockMap: 'polar', unlockDepth: 920,
    desc: '持续 · 递增',
    tip: '按住持续照射，照得越久伤害越高（最多 ×5）。连照过热后强制冷却。',
    dmg: [1.2, 2.5, 4.5, 7.2, 11.3, 17.1],
    rad: [18, 19, 21, 23, 25, 28],
    cd:  [0.16, 0.155, 0.150, 0.145, 0.140, 0.130],
    // 激光把 mag / reload 当"过热时长 / 强制冷却时长"用（见文件头说明）
    mag: [3.2, 3.5, 3.8, 4.2, 4.6, 5.2],
    reload: [1.40, 1.35, 1.30, 1.20, 1.10, 0.90],
    ramp: [0.55, 0.60, 0.66, 0.72, 0.80, 0.90],   // 每秒在基础伤害上加成 ramp·t
    rampMax: 4.0,                                  // 递增上限（×5 封顶）
  },
  {
    id: 'barrett', name: '巴雷特', en: 'BARRETT', icon: 'gun-barrett',
    mech: 'single', tier: '重型', price: 60000, upBase: 30000,
    unlockMap: 'polar', unlockDepth: 1100,
    desc: '单发 · 重炮',
    tip: '一发入魂：伤害和范围都是全场最高，代价是 1.3 秒才能再开一枪。',
    dmg: [14, 34.3, 72.1, 139.4, 259.2, 471.2],
    rad: [60, 66, 72, 80, 88, 98],
    cd:  [1.35, 1.30, 1.25, 1.20, 1.15, 1.05],
    mag: null, reload: null,
  },
];

/** 枪店里的显示顺序（价格从低到高，正好就是"该买哪把"的自然阶梯） */
export const GUN_ORDER = GUNS.map((g) => g.id);

/** 枪械等级上限：Lv0 是出厂状态，可以升 5 次到 Lv5（用户要求"每把枪可升级 5 级"） */
export const GUN_MAX_LEVEL = 5;

/**
 * 枪械升级成本倍率。
 * 比全局升级的 GROWTH(1.47) 陡得多：一把枪只有 5 次升级，要在这 5 次里
 * 走完"从能用到毕业"的距离，所以每级得涨得多一点（1.85 ≈ 5 次翻 21 倍）。
 */
export const GUN_GROWTH = 1.85;

/** 第 lv 次升级的价格（lv 从 0 起） */
export const gunUpgradeCost = (id, lv) =>
  lv >= GUN_MAX_LEVEL ? Infinity : Math.round(gunById(id).upBase * Math.pow(GUN_GROWTH, lv));

/** 按 id 取枪；找不到就退回初始手枪（存档里的脏数据不要炸） */
export function gunById(id) {
  return GUNS.find((g) => g.id === id) || GUNS[0];
}

/**
 * 某把枪在某个等级下的**实际数值** —— 和 `lvAt` 同一条纪律：
 * **所有**读枪械数值的地方都必须走这里，不要直接 `gun.dmg[lv]`。
 *
 * 理由和 lvAt 一模一样：等级越界 / 存档里没有这把枪的等级 / 测试夹具手写了半截
 * → `arr[undefined]` 安静返回 undefined → 伤害变 NaN → 鱼永远打不死，
 * **不报错、不闪退**。这里统一钳到 0..GUN_MAX_LEVEL，枪 id 写错直接退回手枪。
 */
export function gunStats(id, lv) {
  const g = gunById(id);
  const i = Math.max(0, Math.min(GUN_MAX_LEVEL, Math.round(Number(lv)) || 0));
  return {
    id: g.id,
    mech: g.mech,
    damage: g.dmg[i],
    radius: g.rad[i],
    cooldown: g.cd[i],
    mag: g.mag ? g.mag[i] : null,
    reload: g.reload ? g.reload[i] : null,
    // 机制专属：没有的枪给 0，调用点就不用到处判空
    pellets: g.pellets || 0,
    spread: g.spread || 0,
    ramp: g.ramp ? g.ramp[i] : 0,
    rampMax: g.rampMax || 0,
    spinup: g.spinup || 0,
  };
}

// ───────────────────────── 来电引导（v0.6）─────────────────────────
//
// **这个系统解决的是"玩家不知道该花钱"的问题，不是"玩家不会玩"的问题。**
//
// 背景：渔具店的 6 项和枪店的 7 把枪**开局就全部可见**（分段解锁还没落地），
// 于是商店是"一份没有引导的清单"——玩家可能一路只升鱼线，永远不去碰枪店，
// 然后在深层遇到打不动的血牛时找不到出口（见 GAMEPLAY.md 风险 A6b）。
//
// 做法：在玩家**刚好需要知道某件事**的那一刻，让 NPC 打个电话过来。
//
// ── 四条设计约束（破一条这套系统就变成噪音）──
//
// ① **只在待机（IDLE）响，绝不打断进行中的一竿。**
//    待机本来就是"玩家在做决定"的那一屏（要不要抛竿 / 要不要看手机），
//    而一竿中间插电话会把三段式循环切断。
// ② **每通只响一次**（`save.calls` 记已听过的 id）。听完就永远不再响 ——
//    这是它和"弹窗式引导"的根本区别：弹窗会重复，电话不会。
// ③ **两通之间至少隔 `CALL_GAP` 竿。** 玩家可能在第 5 竿就连着满足三个条件，
//    不隔开的话会一次待机收到三通电话，直接变成骚扰。
// ④ **响铃不阻塞任何操作。** 手机按钮只是震动 + 发光，玩家想无视就无视，
//    照样能点画面抛竿；下一次回待机它再响（因为还没听）。
//
// ── 字段 ──
//   who       来电人（显示在来电界面上）
//   icon      头像用的 GLYPH 键（复用 App 图标：shop / gunshop）
//   when      触发条件（全部满足才响）。支持：
//               casts  —— 累计抛竿数 ≥ N
//               depth  —— **本图**到过的最深处 ≥ N 米
//               codex  —— 图鉴已解锁种数 ≥ N
//               level  —— { 升级项 key: 等级 }，逐项都要 ≥
//               map    —— 该地图的许可证已买下（= 去过）
//               chart  —— 已钓到海图（true / false 都可用：false = "还没钓到"）
//               boat   —— 是否已拥有船（同上，正反两向都支持）
//               appLocked —— ['appId']：该 App **还没解锁**时才响
//                            （用于"先钓到海图就不要再打船厂推荐电话"这种互斥，见 boat-intro）
//   unlock    听完后要解锁哪个 App（v0.7）—— null / 省略 = 不解锁。
//             ⚠ 必须是**接听那一刻**才解锁：解锁早了，桌面会出现一个从没被介绍过的 App。
//   lines     对话，一句一条（点一下出下一句，像真的在打电话）
//   goto      听完之后自动跳到哪个 App（null = 不跳）。**这是"引导"和"告知"的分界线** ——
//             只说一句"去枪店看看"然后让玩家自己找，多数人不会去。
//   gotoText  goto 按钮上的字
//
// ⚠ 数组顺序 = 优先级。多条同时满足时，**排在前面的先响**。
// ⚠ `goto` 必须是手机里真实存在的 App id（`verify6` 会断言这一点）。
export const CALLS = [
  {
    id: 'shop-intro',
    who: '渔具店 · 老王',
    icon: 'shop',
    when: { casts: 3 },
    lines: [
      '喂？钓着呢？我是渔具店的老王。',
      '看你连着下了三竿，还拿着开局那套家伙。',
      '先买条好点的线 —— 线越长，能潜得越深；潜得越深，鱼越值钱。',
      '打开手机里的「渔具店」，最便宜那项现在就能买。',
    ],
    goto: 'shop',
    gotoText: '去 渔具店',
  },
  {
    id: 'shop-drop',
    who: '渔具店 · 老王',
    icon: 'shop',
    when: { level: { line: 2 } },
    lines: [
      '老王。线是够长了，但你每一竿都还得从水面慢慢沉下去。',
      '铅坠那一行下面有个开关，叫「直达深度」。',
      '打开它，开竿就能直接落到你指定的深度，省掉这一段。',
      '不过最多只让你跳过七成 —— 剩下那截还得自己潜，鱼可不会等你。',
    ],
    goto: 'shop',
    gotoText: '去 渔具店',
  },
  {
    id: 'gun-intro',
    who: '枪店 · 阿海',
    icon: 'gunshop',
    when: { depth: 240 },
    lines: [
      '兄弟，我枪店的阿海。',
      '刚才那条红鲷，你打了几枪才打下来？',
      '越深的鱼血越厚，光靠手里那把老枪是打不动的。',
      '想打得更痛快，就得换更好的家伙 —— 想要好武器，就来我店里挑。',
    ],
    goto: 'gunshop',
    gotoText: '去 枪 店',
  },
  {
    id: 'shop-winch',
    who: '渔具店 · 老王',
    icon: 'shop',
    // ⚠ v0.6：绞盘改成 `unlockMap: 'polar'` 之后，这一通也必须等到拿到极地许可证才响 ——
    //   否则电话会把玩家指到一个**还没解锁**的商店行上（点不动，比不打还糟）。
    when: { casts: 25, map: 'polar' },
    lines: [
      '老王。上升那一段，是不是等得有点烦了？',
      '绞盘，一次性买断，九千。买完就永久归你。',
      '之后上升阶段右下角会多一个「快速回收」按钮，按一下三倍速。',
      '每竿只能按一次 —— 想多串几条鱼，就忍着别按。',
    ],
    goto: 'shop',
    gotoText: '去 渔具店',
  },
  {
    id: 'gun-power',
    who: '枪店 · 阿海',
    icon: 'gunshop',
    when: { depth: 390 },
    lines: [
      '阿海。你下到三百九了？',
      '那个深度的鱼，一条能顶你半梭子。',
      '两条路：把手上的枪升满，或者攒六万换巴雷特。',
      '巴雷特一发十四点伤害，范围还大 —— 就是慢，一秒多才能再开一枪。',
    ],
    goto: 'gunshop',
    gotoText: '去 枪 店',
  },
  {
    id: 'shop-newsea',
    who: '渔具店 · 老王',
    icon: 'shop',
    when: { map: 'polar' },
    lines: [
      '老王。听说你到冰封极地了？那边的鱼更硬，也更值钱。',
      '那边的鱼更硬，也更值钱。别忘了阿海的枪店。',
      '还有，极地水里有浮冰 —— 撞上不会收线，但会把你顶偏、减速一秒半。',
      '路上小心。',
    ],
    goto: 'shop',
    gotoText: '去 渔具店',
  },
  // ── v0.7：船厂 + 海图（第 4、5 条需求）────────────────────
  {
    id: 'boat-intro',
    who: '船厂 · 老赵',
    icon: 'boat',
    // ⚠ `when.appLocked: 'boat'` = "船厂 App 还没解锁时才响"。
    //   为什么需要这个条件：如果玩家先钓到了海图（那时会**直接解锁**船厂、见 game 的
    //   `_getChart()`），这通"推荐新船"的电话就变成马后炮了 —— 需求里明确要求
    //   "若是玩家没有解锁船厂 App 则直接给玩家解锁，并去掉船厂 NPC 引导"。
    when: { casts: BOAT_UNLOCK_CAST, appLocked: 'boat' },
    lines: [
      '喂？我是船厂的老赵。',
      '看你连着下了十竿，还踩着那条小舢板 —— 它出不了这片海湾。',
      '我这儿有三条船，都是一万。黄金号多卖钱，仓储号装得多，装甲号护钩子。',
      '想要哪条，来我船厂挑。船厂已经装进你手机里了。',
    ],
    // 听完才解锁（`unlock`）—— 和"引导=把他送到该去的地方"同一条原则
    unlock: 'boat',
    goto: 'boat',
    gotoText: '去 船 厂',
  },
  {
    id: 'chart-need-boat',
    who: '码头管理员 · 老陈',
    icon: 'route',
    // 钓到海图、但还没船 → 告诉他"能去，但得先有条船"
    when: { chart: true, boat: false },
    lines: [
      '你从海沟里钓上来的那张，是极地的海图。',
      '海图是通行证 —— 但你现在这条舢板开不过去。冰海不是它该待的地方。',
      '先买条船：手机里的「船厂」，三条都是一万。哪条都行。',
      '备好了就来找我，我带你去航线。',
    ],
    goto: 'boat',
    gotoText: '去 船 厂',
  },
  {
    id: 'chart-ready',
    who: '码头管理员 · 老陈',
    icon: 'route',
    // 钓到海图**而且已经有船** → 直接把他送去航线（需求："直接告知并引导其前往新地图"）
    when: { chart: true, boat: true },
    lines: [
      '海图在你手上，船也备好了 —— 那就没什么好等的了。',
      '打开手机里的「航线」，极地那一片已经对你开了。',
      '冰海的水是墨蓝的，别被极光晃了眼。',
    ],
    goto: 'route',
    gotoText: '去 航 线',
  },
];

/**
 * 两通电话之间至少隔多少竿。
 * 玩家可能在第 5 竿就连着满足三个条件 —— 不隔开的话会一次待机收到三通，直接变骚扰。
 */
export const CALL_GAP = 4;

// ───────────────────────── 深海场景 ─────────────────────────
export const DEEP = {
  darknessFull: 860,   // 到这个深度时环境光衰减到底（灯具可以救回来一部分）
  decorTop: -116,       // 两侧地形从这个深度开始出现
  decorBottom: -1300,   // 一直到海沟底
  wallInset: 8,        // 地形贴屏幕左右边缘内缩多少
  kelpCount: 22,       // 海带株数
  rockCount: 30,       // 岩石数量
  relicCount: 9,       // 神秘发光体数量
};

// ───────────────────────── 玩法手感参数 ─────────────────────────
export const TUNING = {
  // ── 装备：走等级曲线的项按等级取值（等级存在 save.levels 里）──
  // ⚠ 一律做成函数而不是常量：这些项全部可成长，散落的常量会变成"改了等级没生效"的坑。
  // ⚠ 一律走 lvAt()（它会把残缺/越界等级钳到 0..MAX_LEVEL），不要直接 LEVELS.x[lv]。
  maxDepth: (lv) => lvAt('maxDepth', lv),
  hookRadius: (lv) => lvAt('hookRadius', lv),
  lampRadius: (lv) => lvAt('lampRadius', lv),
  lampPower: (lv) => lvAt('lampPower', lv),
  // 鱼护：一竿最多串几条鱼。超过上限后最早串上的那条会挣脱。
  creelLimit: (lv) => lvAt('creelLimit', lv),
  // 鱼饵：高价鱼权重加成（0~1）
  bait: (lv) => lvAt('bait', lv) / 100,
  // 铅坠（v0.5）：**可直接跳过的最大深度**（米）。实际落点还要和鱼线极限、DROP_MAX_RATIO 取小。
  dropDepth: (lv) => lvAt('dropDepth', lv),

  // ── 两个"不再是升级轴"的速度常量（v0.5）──
  //
  // 为什么固定：下潜速度原本挂在「铅坠」上（64 → 240）、收线速度挂在「绞盘」上（240 → 480）。
  // 两条轴被移除之后，速度不该再承担"难度递增"的职责 —— 它只会变成一笔
  // **玩家看不见的隐形税**（"为什么我潜得比别人慢？因为我没点那一项"）。
  //
  // DESCEND_SPEED 取原曲线的中段（原 Lv2 = 100）：
  //   取 Lv0 的 64 会让中后期每一竿凭空多等 8~12 秒；取 Lv20 的 240 又会让
  //   开局的下潜快到来不及躲鱼（240 穿过一屏只要 1 秒）。100 是"还躲得动、也不拖沓"的那一档。
  // ASCEND_SPEED 取原 Lv0 的 240：这是改之前**每个玩家开局就有**的速度，
  //   所以"收线变快了"这件事只会发生在买了绞盘并按了快速回收的人身上。
  DESCEND_SPEED: 100,          // m/s — 固定下潜速度
  ASCEND_SPEED: 240,           // m/s — 固定收线速度

  // ── 铅坠·直达深度 ──
  // 开竿时把钩子**直接放到玩家指定的深度**，省掉从水面沉下去的那一段。
  //
  // ⚠ 为什么必须有这个 70% 上限：不加的话，铅坠升满之后"跳到底"就等于
  //   **整个下潜阶段被删掉** —— 而"下潜躲鱼"是这个游戏的三段循环之一（见 GAMEPLAY.md 支柱 P1）。
  //   钳到 70% 之后，每一竿至少还要自己下潜 30% 的深度，躲鱼这一段永远存在。
  DROP_MAX_RATIO: 0.7,
  // 落点离水面至少留这么远：不然"直达 0m"会把钩子放在贴着水面的地方，
  // 一入水就落进 SPAWN_TOP_MARGIN 那一段空白里，开竿手感是空的。
  DROP_MIN_DEPTH: 20,          // m
  // 落地缓冲：跳下去之后这么久之内**不判下潜撞鱼**。
  //
  // 为什么必须有：玩家是"盲选深度"的（鱼在开竿那一刻才刷出来，跳下去之前看不见），
  // 所以"一落地就贴在一条鱼身上、被迫立刻收线"是纯运气，不是操作失误。
  // 0.45s × 100 m/s ≈ 45m 的缓冲 —— 和已有的 hitCooldown(0.28s) 同一个量级，
  // 不足以穿过多密的鱼群，但足以让玩家看清周围再操作。
  DROP_GRACE: 0.45,            // s

  // ── 绞盘·快速回收（一次性工具）──
  // 买下之后，上升阶段 HUD 上多一个「快速回收」按钮，按一下把收线速度乘这个倍率。
  // ⚠ 它是**玩家主动触发**的，不是自动的：上升阶段串鱼是主要收入来源，
  //   无脑加速会让玩家跳过鱼群 —— 加速这件事必须是一个"我现在够了"的决策。
  FAST_REEL_MUL: 3,            // ×  — 按下后收线速度的倍率


  bottomPause: 0.55,
  // ── 收线上拉预备 ──
  // 下潜被鱼撞到 / 触底时，鱼钩不是"啪"地反向，而是先缓动再往下探一小段，
  // 给玩家一个"要上拉了"的预告，同时让这一竿看起来多了一点惯性。
  // ── 收线上拉预备（v0.3 改版）──
  // 撞到鱼 / 触底之后，鱼钩**带着当前的下潜速度**再往下滑一小段、减速到 0，然后才上升。
  // 为什么不是简单的"往下探固定距离"：那样起手速度是 0，看起来像"顿一下再往下"，
  // 和下潜的动势断开。现在的曲线是 y = y0 − D·(2u − u²)，起手速度 = 2D/T。
  //   令 2D/T = v0（当前下潜速度）→ **距离 D 由速度推出来，时长 T 才是设计参数**。
  //   于是快铅坠滑得远、慢铅坠滑得近，但"刹停"花的时间一样 —— 手感不随等级漂。
  // ⚠ v0.3.2：0.5/60 玩家反馈"减速看不出来"。距离 D = v0·T/2，把 T 拉长到 0.8 之后
  //   Lv0 从 16 → 26、Lv20 从 60 → 96，减速过程明显长了一大截（弹簧的"压缩"）。
  reelPreDur: 0.8,       // 兜底停顿时长（只在 v0 = 0、即触底时用到）
  // ⚠ v0.3.2：**距离才是设计参数**，时长由它和速度反推（dur = 2D/v0）。
  //   之前反过来（时长是设计参数、D = v0·T/2），结果慢铅坠（Lv0 只有 64 m/s）
  //   只滑 26m ≈ 屏幕高度的 9%，玩家反馈「减速看不出来」。
  //   固定距离之后，不管铅坠多少级都滑同样长的一段 —— 看得见。
  reelPreDepth: 60,      // 刹停距离（世界单位）≈ 屏幕高度的 22%

  // ── 回拉的起步缓动（v0.3.1）──
  // 撞鱼刹停之后钩子是**静止**的，如果下一帧直接按满速上拉，视觉上是"啪"地反向，
  // 和前面那段减速完全断开。这段缓动让回拉"从 0 加速起来"，并且带一点 anticipation
  // （先微微一沉再往上）—— 就是 easeInBack 的感觉。
  // ⚠ 只有走 `_reel()` → 预备 → `_beginAscend()` 这条路径才会有（见 _updateAscend）。
  ascendRamp: 0.75,      // 起步缓动时长（秒）—— 0.3/0.5 都太短，加速段看不出来

  hitCooldown: 0.28,
  hitShake: 12,
  // 下潜撞到鱼 → 自动收线的判定半径。**固定值，任何升级都不改它。**
  // 刻意不跟鱼钩挂钩：如果它跟着鱼钩涨，玩家花钱升鱼钩反而更容易被迫收线，
  // 「升级」变成了惩罚。
  // ⚠ v0.5：「加固」被移除，所以这里**不再有** `bumpRadiusAt()` 那条减免路径 ——
  //   下潜的难度现在完全由玩家的走位决定，没有"花钱把判定缩小"的出口。
  bumpRadius: 8.4,

  // ── 抛竿 ──
  // 鱼钩被甩到空中 → 划一道抛物线 → 落进水里。
  // 滞空这一秒多玩家就能左右移动鱼钩，落点由玩家自己决定。
  //   竿梢 y≈46，初速 130、重力 300 → 最高点 ≈74m，全程 ≈1.16s
  castSpeed: 130,        // 起抛初速（向上）
  castGravity: -300,     // 空中重力（比空中阶段的重得多，弧线更利落）
  castSteer: 34,         // 空中左右操控的加速度增益
  castMaxVx: 96,         // 空中水平速度上限
  castTime: 1.6,         // 滞空最长时限（保险丝：防止某些机型掉帧后卡在空中）
  castDrag: 1.5,         // 水平阻尼，避免左右横拉变成瞬移
  castSplash: 14,        // 入水水花粒子数

  // 手枪：点击处爆炸（v0.4 起枪械由 GUNS 表驱动，见下面的 GUNS 段）
  // ⚠ v0.5：「攻击力」那条全局倍率被移除，伤害**只**来自 `GUNS[].dmg[lv]`。
  //   开火管线里不要再乘任何系数（见 game.js 的 `_fire`）。
  fireCooldown: 0.30,
  comboStep: 3,                       // 每 3 连击 +0.25 倍率
  comboMax: 3.0,
  // 扣钱鱼的罚款（固定值）。
  // ⚠ v0.5：「保险」被移除，罚款不再有减免路径 —— 撞上就是全价。
  //   这条是刻意的：扣钱鱼是纯风险，不该能用金币把它变成"几乎无感"。
  pufferPenalty: 30,
  birdBonus: 60,

  // 空中：价格越高 → 飞得越高 / 越远 / 越久
  //   最高点 = v0² / (2|g|)，v0 = launchBase + √value × launchPerSqrtValue
  //   √6   → v0 274 → 626m   (沙丁鱼)
  //   √100 → v0 380 → 1204m  (剑鱼)
  //   √680 → v0 604 → 3040m  (黄金鱼王 · 深空)
  airGravity: -60,
  launchBase: 240,
  launchPerSqrtValue: 14,
  // 水平漂移：先定「这条鱼总共该飘多远」，再反推水平速度，
  // 这样滞空久的鱼不会因为速度一样而飘到天边去。
  launchDriftBase: 180,
  launchDriftPerSqrt: 24,
  airTimeout: 26,
  // 中弹未死：血厚的鱼每次没被打死就再往天上顶一段（需求④）。
  // 一次没死 = 一次额外的滞空，所以血越厚飞得越久、越容易被连击。
  knockUpBase: 148,          // 基础再升空初速
  knockUpPerHp: 12,          // 每剩 1 点血再多顶这么多初速
  // ⚠ v0.4：血量从 1~9 拉宽到 2~120 之后，"按剩余血量线性加初速"会失控 ——
  //   极夜之王（hp 120）中一枪会被顶飞 148 + 120×12 = 1588，直接飞出大气层。
  //   所以加一个封顶：**超过 16 点血之后不再多顶**，"血厚 → 飞得久"这个手感
  //   在浅层照样成立，深层的血牛只是"要多打几枪"，不是"打一枪就上天"。
  knockUpMaxHp: 16,
  // 空中「没有可打的鱼了」之后还要等多久才结算。
  // 之前这里被飞鸟卡住：鸟只要还在屏幕上就永远不结算，玩家只能干等。
  // ⚠ 这个值现在计的是「**场上没有可打的鱼**之后过了多久」，不是「进空中阶段多久」。
  //   以前用 airT（进空中阶段就开始计时）→ 打掉最后一条鱼时早就超时 → 立刻弹结算，
  //   最后那一下根本看不清。改成 airClearT 之后这个数才是真正的"停留时长"。
  airSettleGrace: 1.8,   // ⚠ 0.9 玩家反馈"看不出来"，加长到 1.8s；同时 _airCamera 会在
                         //   清空那一刻把画面定格（否则镜头还在飘，感觉不到"停"）
  slowmoScale: 0.28,
  slowmoTime: 0.22,

  // 空中相机：锁定**最低的那条非扣钱鱼**，把它放在画面中间并推近。
  //
  // 为什么不再"框住所有鱼"：鱼一散开，包围盒就让镜头一路拉远，
  // 玩家看到一堆小点，反而不知道该打谁。
  // 只盯一条（最低的 = 最快落回水里、最该优先打掉的），它被击落 / 落水后
  // 自动换成下一条 —— 天然形成"逐个点杀"的节奏。
  // v0.3：目标鱼放在**画面正中**（bias 从 0.06 收到 0），视野稍微放宽到 0.70 ——
  // 原来推得太近（0.62）又把目标压在中心下方，鱼群上半部分会被顶出画面。
  airCamFollowScale: 0.70,  // 推近倍率（< 1 = 放大；1 = 与常规视野相同）
  airCamFollowBias: 0,      // 目标鱼放在画面正中（0 = 正中；正数 = 往中心下方放）
  airCamRate: 9,            // v0.3.1：5.5 时跟得有点"黏"（换目标要 0.5s 才追上），提到 9

  shakeDecay: 5.5,
};

// ───────────────────────── 存档 ─────────────────────────
// v3：升级项从 1 项恢复到 5 项，旧存档的等级分布已经对不上，直接换 key 重新开档。
//
// ⚠ 扩容到 11 项 × 20 级时**不需要再换 key**：
//   LEVELS 的索引 0~4 被冻结成 v0.1 的现值，老存档里的 Lv0~Lv4 依然指向同一组数字；
//   新加的 6 项在 loadSave 里会因为 raw.levels[k] 不存在而自然落到 0。
export const SAVE_KEY = 'hooked.save.v3';
