/**
 * 全部静态数据。原则：
 * - 数值单位统一用「米 / 秒 / 美元」，不再出现像素。
 * - 鱼保留原版的名称、习性文案与深度区间，只重新标定体型与售价。
 */

export type MapId = 'bay' | 'ice';
export type FishShape = 'fish' | 'long' | 'round' | 'flat' | 'shark' | 'jelly' | 'squid' | 'angler' | 'narwhal' | 'king';
export type Behavior = 'cruise' | 'dart' | 'school' | 'hunt';
export type Special = 'jelly' | 'eel' | 'ice' | 'legend' | 'rare';

export interface Species {
  id: string;
  name: string;
  map: MapId;
  shape: FishShape;
  color: string;
  color2: string;
  len: number; // 体长（米）
  minD: number;
  maxD: number;
  value: number;
  hp: number;
  speed: number; // 米/秒
  behavior: Behavior;
  weight?: number;
  glow?: boolean;
  special?: Special;
  desc: string;
}

export const SPECIES: Species[] = [
  // ================= 阳光湾 =================
  { id: 'sardine', name: '沙丁鱼', map: 'bay', shape: 'fish', color: '#b9cfe0', color2: '#65869c', len: 0.34, minD: 0, maxD: 90, value: 4, hp: 1, speed: 2.4, behavior: 'school', weight: 3, desc: '罐头界顶流，挤地铁经验丰富。一辈子都在排队，死后还要挤在一个罐头里。' },
  { id: 'yellow', name: '小黄鱼', map: 'bay', shape: 'fish', color: '#ffd23f', color2: '#d99b00', len: 0.42, minD: 5, maxD: 110, value: 8, hp: 1, speed: 2.2, behavior: 'school', weight: 3, desc: '性格开朗，最大的梦想是被做成糖醋的。' },
  { id: 'mackerel', name: '鲭鱼', map: 'bay', shape: 'fish', color: '#6fb3c9', color2: '#22495c', len: 0.58, minD: 20, maxD: 150, value: 12, hp: 2, speed: 3.0, behavior: 'cruise', weight: 3, desc: '身上的条纹是它自己画的，为了显瘦。' },
  { id: 'puffer', name: '河豚', map: 'bay', shape: 'round', color: '#f2c572', color2: '#a3702c', len: 0.52, minD: 40, maxD: 190, value: 15, hp: 2, speed: 1.0, behavior: 'cruise', weight: 2, desc: '生气时会膨胀，和你老板一模一样。' },
  { id: 'jelly', name: '水母', map: 'bay', shape: 'jelly', color: '#ff9ad5', color2: '#ffd1ec', len: 0.46, minD: 25, maxD: 400, value: -25, hp: 1, speed: 0.5, behavior: 'cruise', weight: 1.5, special: 'jelly', desc: '别打它！它只是一坨有梦想的果冻。打中会被罚款。' },
  { id: 'snapper', name: '真鲷', map: 'bay', shape: 'fish', color: '#ff6b6b', color2: '#a82c22', len: 0.72, minD: 60, maxD: 210, value: 20, hp: 2, speed: 2.4, behavior: 'cruise', weight: 2.5, desc: '喜庆的红色，过年时身价翻倍，平时装低调。' },
  { id: 'eel', name: '海鳗', map: 'bay', shape: 'long', color: '#7a8f4e', color2: '#39481d', len: 1.5, minD: 90, maxD: 260, value: 26, hp: 2, speed: 1.8, behavior: 'hunt', weight: 2, desc: '滑溜溜的，连交税都能滑过去。它对你的鱼钩也很感兴趣。' },
  { id: 'ray', name: '魔鬼鱼', map: 'bay', shape: 'flat', color: '#6c7a89', color2: '#333d48', len: 1.2, minD: 120, maxD: 290, value: 34, hp: 2, speed: 1.4, behavior: 'cruise', weight: 2, desc: '名字很凶，其实是个社恐，每天在海底扮演地毯。' },
  { id: 'grouper', name: '石斑鱼', map: 'bay', shape: 'fish', color: '#b08850', color2: '#553d1e', len: 0.95, minD: 150, maxD: 330, value: 44, hp: 3, speed: 1.2, behavior: 'cruise', weight: 2, desc: '表情永远像刚看完你的年终总结。' },
  { id: 'shark', name: '小鲨鱼', map: 'bay', shape: 'shark', color: '#8a9ba8', color2: '#dfe6ea', len: 1.6, minD: 180, maxD: 360, value: 58, hp: 3, speed: 3.6, behavior: 'dart', weight: 1.6, desc: '自称是大鲨鱼，只是「还没发育」。冲刺时是真的快。' },
  { id: 'octo', name: '章鱼', map: 'bay', shape: 'squid', color: '#e0617a', color2: '#96293d', len: 0.92, minD: 200, maxD: 390, value: 66, hp: 3, speed: 1.0, behavior: 'cruise', weight: 1.6, desc: '有三颗心，但没有一颗用来爱你。' },
  { id: 'marlin', name: '旗鱼', map: 'bay', shape: 'narwhal', color: '#3d6fb6', color2: '#16305a', len: 2.2, minD: 250, maxD: 400, value: 88, hp: 3, speed: 4.2, behavior: 'dart', weight: 1.4, desc: '海里最快的鱼，然而还是被你的鱼钩追上了。' },
  { id: 'lantern', name: '灯笼鱼', map: 'bay', shape: 'angler', color: '#4b3a5a', color2: '#ffe066', len: 0.7, minD: 300, maxD: 400, value: 118, hp: 3, speed: 0.9, behavior: 'hunt', weight: 1.3, glow: true, desc: '自带手电筒，全海唯一不怕停电的鱼。' },
  { id: 'goldfish', name: '镇长的金鱼', map: 'bay', shape: 'fish', color: '#ffb300', color2: '#e06200', len: 1.25, minD: 340, maxD: 400, value: 420, hp: 4, speed: 2.0, behavior: 'dart', weight: 0, special: 'rare', desc: '镇长三年前在这里「放生」的。它现在比镇长还胖，而且更受欢迎。' },

  // ================= 极光冰海 =================
  { id: 'cod', name: '北极鳕', map: 'ice', shape: 'fish', color: '#c9d6df', color2: '#5e7484', len: 0.5, minD: 0, maxD: 130, value: 18, hp: 1, speed: 2.0, behavior: 'school', weight: 3, desc: '耐寒体质，冬天从不穿秋裤，令人担忧。' },
  { id: 'icefish', name: '冰鱼', map: 'ice', shape: 'fish', color: '#e8fbff', color2: '#93d4e8', len: 0.5, minD: 10, maxD: 170, value: 24, hp: 1, speed: 2.8, behavior: 'dart', weight: 3, glow: true, desc: '血是透明的，心也是。心思一眼就能看穿。' },
  { id: 'frozen', name: '冰封鱼', map: 'ice', shape: 'fish', color: '#7fb3d5', color2: '#28536f', len: 0.82, minD: 40, maxD: 260, value: 44, hp: 4, speed: 0.5, behavior: 'cruise', weight: 2.4, special: 'ice', desc: '被冻在冰块里了还在游，敬业精神感动全海。需要多打几枪。' },
  { id: 'gjelly', name: '荧光水母', map: 'ice', shape: 'jelly', color: '#7dffcf', color2: '#c9fff0', len: 0.55, minD: 30, maxD: 600, value: -55, hp: 1, speed: 0.4, behavior: 'cruise', weight: 1.5, special: 'jelly', glow: true, desc: '在黑暗中发出温柔的光。打中罚得比普通水母更狠，温柔是有代价的。' },
  { id: 'eeel', name: '电鳗', map: 'ice', shape: 'long', color: '#f4e04d', color2: '#4a3f00', len: 1.8, minD: 80, maxD: 520, value: 50, hp: 2, speed: 1.6, behavior: 'hunt', weight: 1.6, special: 'eel', glow: true, desc: '上升时钩到它会被电一下，甩掉两条已钓到的鱼。摸一下，醒脑提神。' },
  { id: 'narwhal', name: '独角鲸', map: 'ice', shape: 'narwhal', color: '#9aa9b8', color2: '#44515e', len: 2.8, minD: 150, maxD: 360, value: 80, hp: 3, speed: 2.2, behavior: 'cruise', weight: 1.8, desc: '海洋里的独角兽。角其实是一颗牙，所以它每天刷牙要刷两米。' },
  { id: 'gsquid', name: '发光乌贼', map: 'ice', shape: 'squid', color: '#5ad1ff', color2: '#07506f', len: 1.0, minD: 180, maxD: 460, value: 74, hp: 3, speed: 1.8, behavior: 'dart', weight: 1.8, glow: true, desc: '会喷发光墨汁，蹦迪时是全场焦点。' },
  { id: 'sleeper', name: '格陵兰睡鲨', map: 'ice', shape: 'shark', color: '#5b5f66', color2: '#9aa0a8', len: 2.6, minD: 250, maxD: 520, value: 115, hp: 5, speed: 0.9, behavior: 'hunt', weight: 1.4, desc: '寿命能到 400 岁，退休金能把养老系统领破产。它游得很慢，但它不会停。' },
  { id: 'angler', name: '深海鮟鱇', map: 'ice', shape: 'angler', color: '#2b2140', color2: '#8affff', len: 1.1, minD: 300, maxD: 600, value: 130, hp: 4, speed: 0.8, behavior: 'hunt', weight: 1.4, glow: true, desc: '头上挂着小灯钓别的鱼。同行，是冤家。' },
  { id: 'ghostray', name: '幽灵鳐', map: 'ice', shape: 'flat', color: '#b9a6ff', color2: '#4a30a8', len: 1.8, minD: 350, maxD: 600, value: 145, hp: 4, speed: 1.5, behavior: 'cruise', weight: 1.3, glow: true, desc: '半透明，飘来飘去，据说是一只没交完房贷的鳐鱼的灵魂。' },
  { id: 'codking', name: '冰川鳕王', map: 'ice', shape: 'fish', color: '#dfe9f3', color2: '#2f5f93', len: 2.3, minD: 400, maxD: 600, value: 175, hp: 5, speed: 1.8, behavior: 'cruise', weight: 1.2, desc: '北极鳕的老板。开会时间比游泳时间多。' },
  { id: 'fishking', name: '鱼王', map: 'ice', shape: 'king', color: '#ffcf33', color2: '#a87400', len: 4.4, minD: 500, maxD: 590, value: 1400, hp: 14, speed: 1.2, behavior: 'cruise', weight: 0, special: 'legend', glow: true, desc: '传说中的鱼王。戴着一副假牙——那是海爷爷二十年前丢的。' },
];

export const speciesById: Record<string, Species> = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

// ================= 地图与深度带 =================

export interface Band {
  name: string;
  from: number;
  to: number;
  /** 雾色 */
  fog: string;
  /** 雾密度（随深度递增） */
  density: number;
  /** 主光颜色 */
  light: string;
  /** 主光强度 */
  power: number;
  /** 水下环境色 */
  ambient: string;
  /** 体积光颜色 */
  ray: string;
}

export interface MapInfo {
  id: MapId;
  name: string;
  subtitle: string;
  desc: string;
  mechanics: string[];
  maxDepth: number;
  ticket: number;
  emoji: string;
  /** 主界面顶部的一行天气/海况 */
  weather: string;
  bands: Band[];
  /** 水面以上天空：顶部 / 地平线 / 地面反射 */
  sky: [string, string, string];
  sun: string;
}

export const MAPS: Record<MapId, MapInfo> = {
  bay: {
    id: 'bay',
    name: '阳光湾',
    subtitle: '家门口的海 · 0~400 米',
    desc: '阳光明媚的小渔湾，海鸥比游客多，游客比鱼少。适合新手和退休人士。',
    mechanics: ['🪼 水母：击落会被罚款', '🍾 海底散落着会发光的漂流瓶', '🐠 镇长的金鱼：340 米以下的稀有鱼'],
    maxDepth: 400,
    ticket: 0,
    emoji: '🏖️',
    weather: '晴 · 东南风 3 级 · 24°C',
    sky: ['#1f6fb2', '#8fd0ea', '#082437'],
    sun: '#fff2c4',
    bands: [
      { name: '阳光浅滩', from: 0, to: 80, fog: '#63cbd2', density: 0.014, light: '#fff0c2', power: 2.6, ambient: '#7fd8e8', ray: '#fff6d0' },
      { name: '珊瑚林', from: 80, to: 180, fog: '#2a95a8', density: 0.019, light: '#c8f4ff', power: 1.9, ambient: '#2f8ea6', ray: '#bff4ff' },
      { name: '蓝洞', from: 180, to: 300, fog: '#13546c', density: 0.025, light: '#8fdcff', power: 1.3, ambient: '#12556f', ray: '#7fd2ff' },
      { name: '断崖', from: 300, to: 400, fog: '#072b3d', density: 0.034, light: '#4a9ccb', power: 0.85, ambient: '#0a2c3e', ray: '#3f8fbb' },
    ],
  },
  ice: {
    id: 'ice',
    name: '极光冰海',
    subtitle: '世界尽头 · 0~600 米',
    desc: '永夜之海，头顶极光，脚下深渊。海水黑得像你的未来，需要头灯照明。',
    mechanics: ['🔦 永夜：越深越黑，头灯是唯一光源', '🌊 洋流：会把鱼钩推向一边，防流鳍可抵抗', '⚡ 电鳗：钩到会甩掉两条鱼', '🧊 冰封鱼：需要多打几枪', '👑 传说中的鱼王潜伏在 500 米以下'],
    maxDepth: 600,
    ticket: 2400,
    emoji: '🧊',
    weather: '永夜 · 极光活跃 · -2°C',
    sky: ['#040a20', '#123a52', '#01050c'],
    sun: '#7dffcf',
    bands: [
      { name: '浮冰层', from: 0, to: 100, fog: '#1b4a66', density: 0.02, light: '#b4ecff', power: 1.5, ambient: '#1d4e6a', ray: '#9fe8ff' },
      { name: '冰柱林', from: 100, to: 220, fog: '#103a55', density: 0.027, light: '#7fd0ff', power: 1.0, ambient: '#123a58', ray: '#6fc8ff' },
      { name: '沉船带', from: 220, to: 360, fog: '#0a2438', density: 0.033, light: '#4a90c0', power: 0.7, ambient: '#0b2436', ray: '#3f80b0' },
      { name: '热泉裂谷', from: 360, to: 500, fog: '#122230', density: 0.041, light: '#ff9a6a', power: 1.0, ambient: '#2a1a18', ray: '#ff9a6a' },
      { name: '鱼王座', from: 500, to: 600, fog: '#04080f', density: 0.052, light: '#8a6bff', power: 0.8, ambient: '#0a0a1c', ray: '#8a6bff' },
    ],
  },
};

export const UNLOCK_ICE = {
  /** 第二阶段：听到北方的消息 */
  bookDepth: 180,
  bookSpecies: 8,
  /** 第三阶段：可以买票出发 */
  depth: 250,
  species: 11,
};

// ================= 升级 =================

export interface UpgradeDef {
  id: 'line' | 'saw' | 'hook' | 'lamp' | 'fin';
  name: string;
  icon: string;
  desc: string;
  values: number[];
  costs: number[];
  unit: string;
  digits?: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'line', name: '鱼线长度', icon: '🧵', desc: '决定最大下潜深度。越深，鱼越值钱。', values: [50, 100, 160, 230, 300, 400, 500, 600], costs: [0, 50, 150, 300, 550, 900, 1350, 1920], unit: '米' },
  { id: 'hook', name: '鱼钩容量', icon: '🪝', desc: '上升时最多能挂多少条鱼。', values: [6, 9, 13, 17, 22, 28, 34, 40], costs: [0, 60, 180, 400, 700, 1100, 1600], unit: '条' },
  { id: 'saw', name: '电锯鱼饵', icon: '🪚', desc: '下潜时撞到鱼不会停下，而是把鱼锯开继续下潜的次数。', values: [0, 1, 2, 3, 5, 7], costs: [0, 180, 520, 1000, 1700], unit: '次' },
  { id: 'lamp', name: '潜水头灯', icon: '🔦', desc: '黑暗中的照明半径。极光冰海必备。', values: [26, 34, 43, 54, 68, 84], costs: [0, 220, 560, 1000, 1600, 2400], unit: '米' },
  { id: 'fin', name: '防流鳍', icon: '🐟', desc: '抵抗洋流的能力。', values: [0, 35, 60, 80, 92], costs: [0, 420, 1000, 1800, 2700], unit: '%' },
];

// ================= 武器 =================

export interface Weapon {
  id: string;
  name: string;
  icon: string;
  price: number;
  dmg: number;
  rate: number; // 发/秒
  auto: boolean;
  pellets: number;
  spread: number; // 米
  splash: number; // 米
  heat: number; // 每秒累积热量（1 = 满）
  desc: string;
}

export const WEAPONS: Weapon[] = [
  { id: 'pistol', name: '爷爷的老手枪', icon: '🔫', price: 0, dmg: 1, rate: 5, auto: false, pellets: 1, spread: 0, splash: 0, heat: 0, desc: '爷爷留下的传家宝。枪柄上刻着「别打水母」。' },
  { id: 'dual', name: '双持手枪', icon: '🤠', price: 400, dmg: 1, rate: 7, auto: false, pellets: 2, spread: 2.4, splash: 0, heat: 0, desc: '一枪变两枪，帅气值翻倍，准度减半。' },
  { id: 'shotgun', name: '海鲜霰弹枪', icon: '💥', price: 1000, dmg: 1, rate: 2, auto: false, pellets: 7, spread: 5.2, splash: 0, heat: 0, desc: '一枪下去，漫天鱼片。大炮哥的最爱。' },
  { id: 'uzi', name: '冲锋枪', icon: '⚡', price: 1800, dmg: 1, rate: 12, auto: true, pellets: 1, spread: 1.7, splash: 0, heat: 0.42, desc: '按住不放即可连射。注意枪管会过热。' },
  { id: 'rocket', name: '金枪鱼火箭筒', icon: '🚀', price: 3400, dmg: 5, rate: 1.3, auto: false, pellets: 1, spread: 0, splash: 11, heat: 0, desc: '范围爆炸。名字里有金枪鱼，但和金枪鱼没有任何关系。' },
  { id: 'minigun', name: '大炮哥特制加特林', icon: '🌀', price: 5400, dmg: 2, rate: 20, auto: true, pellets: 1, spread: 2.1, splash: 3, heat: 0.6, desc: '大炮哥用洗衣机改的。按住就是一场风暴，然后是一阵白烟。' },
];

export const weaponById: Record<string, Weapon> = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

export interface GunUpgradeDef {
  id: 'scope' | 'slowmo';
  name: string;
  icon: string;
  desc: string;
  values: number[];
  costs: number[];
  label: (v: number) => string;
}

export const GUN_UPGRADES: GunUpgradeDef[] = [
  { id: 'scope', name: '瞄准镜', icon: '🎯', desc: '扩大命中判定半径。', values: [1.1, 1.35, 1.6, 1.9], costs: [0, 300, 800, 1500], label: (v) => `半径 ${v.toFixed(2)}m` },
  { id: 'slowmo', name: '子弹时间', icon: '⏳', desc: '鱼在空中飞得更慢，更好瞄准。', values: [1, 0.86, 0.74, 0.62], costs: [0, 400, 1200, 2200], label: (v) => `${Math.round(v * 100)}% 速度` },
];

// ================= 帽子 =================

export interface Hat {
  id: string;
  name: string;
  icon: string;
  price: number;
  effect: string;
  money?: number;
  jelly?: number;
  lamp?: number;
  speed?: number;
  hidden?: boolean;
}

export const HATS: Hat[] = [
  { id: 'straw', name: '草帽', icon: '👒', price: 0, effect: '没有效果，但很有情怀。' },
  { id: 'cap', name: '钓鱼节鸭舌帽', icon: '🧢', price: 260, effect: '下潜速度 +10%', speed: 1.1 },
  { id: 'cowboy', name: '牛仔帽', icon: '🤠', price: 780, effect: '所有收入 +8%', money: 1.08 },
  { id: 'chef', name: '厨师帽', icon: '👨‍🍳', price: 1300, effect: '水母罚款减半（厨师知道水母凉拌也挺好）', jelly: 0.5 },
  { id: 'miner', name: '矿工帽', icon: '⛑️', price: 1900, effect: '头灯范围 +8 米', lamp: 8 },
  { id: 'penguin', name: '企鹅帽', icon: '🐧', price: 0, effect: '头灯 +12 米，收入 +15%。海爷爷亲手织的。', lamp: 12, money: 1.15, hidden: true },
];

export const hatById: Record<string, Hat> = Object.fromEntries(HATS.map((h) => [h.id, h]));

// ================= 漂流瓶 =================

export interface Bottle {
  id: string;
  map: MapId;
  depth: number;
  title: string;
  text: string;
}

export const BOTTLES: Bottle[] = [
  { id: 'b1', map: 'bay', depth: 75, title: '漂流瓶 #1', text: '如果你捡到这个瓶子，说明你已经学会用枪钓鱼了。很好。别告诉你奶奶。——海' },
  { id: 'b2', map: 'bay', depth: 170, title: '漂流瓶 #2', text: '二十年前那天，我不是去买烟。我是追一条戴着我假牙的鱼。它往北边游了。——海' },
  { id: 'b3', map: 'bay', depth: 290, title: '漂流瓶 #3', text: '北方有片永夜的冰海，那里的企鹅会用智能手机。如果你来了，记得带件外套和很多子弹。——海' },
  { id: 'b4', map: 'ice', depth: 160, title: '漂流瓶 #4', text: '冰海的洋流很调皮。我给防流鳍店写过好评，店老板是只海豹。——海' },
  { id: 'b5', map: 'ice', depth: 420, title: '漂流瓶 #5', text: '鱼王就在更深的地方。没有假牙，我已经二十年没啃过甘蔗了。拜托了孩子。——海' },
];

// ================= 天气 =================
//
// 天气同时改两件事：
//   1. 画面——雾的浓度、光的强弱、整体色调、雨/雪/极光粒子；
//   2. 鱼群——按行为（群游/巡游/伏击/冲刺）与稀有度调整刷新权重。
// 数值都是「倍率」，1 = 不改变。

export type WeatherId = 'clear' | 'cloudy' | 'rain' | 'fog' | 'storm' | 'aurora' | 'blizzard' | 'iceclear';

export interface Weather {
  id: WeatherId;
  name: string;
  icon: string;
  /** 地图名下面那一行小字 */
  tip: string;
  /** 只在哪些地图出现 */
  maps: MapId[];
  /** 抽取权重 */
  weight: number;
  /** 画面：雾密度 / 光强（倍率）与色调 */
  fog: number;
  light: number;
  tint: string;
  particle: 'none' | 'rain' | 'snow' | 'spark';
  /** 鱼群密度倍率：>1 刷得更密 */
  spawn: number;
  /** 浪高倍率：影响水面线条与船的起伏 */
  wave: number;
  /** 闪电频率（每秒触发概率，仅雷雨） */
  bolt?: number;
  /** 鱼群：按行为加权；rare 额外作用于高价值/高血量的鱼 */
  bias: Partial<Record<Behavior, number>> & { rare?: number };
}

export const WEATHERS: Weather[] = [
  {
    id: 'clear',
    name: '晴',
    icon: '☀️',
    tip: '风平浪静',
    maps: ['bay'],
    weight: 4,
    fog: 1,
    light: 1.05,
    tint: '#fff2c4',
    particle: 'none',
    spawn: 1,
    wave: 0.8,
    bias: { cruise: 1.1 },
  },
  {
    id: 'cloudy',
    name: '多云',
    icon: '⛅',
    tip: '光线转弱',
    maps: ['bay'],
    weight: 3,
    fog: 1.15,
    light: 0.9,
    tint: '#b9c7d4',
    particle: 'none',
    spawn: 1,
    wave: 1,
    bias: { cruise: 1.15, dart: 1.1 },
  },
  {
    id: 'rain',
    name: '小雨',
    icon: '🌧️',
    tip: '鱼群上浮',
    maps: ['bay'],
    weight: 2.6,
    fog: 1.35,
    light: 0.78,
    tint: '#7f9fb5',
    particle: 'rain',
    spawn: 1.18,
    wave: 1.3,
    bias: { school: 1.95, cruise: 1.2, hunt: 0.78 },
  },
  {
    id: 'fog',
    name: '海雾',
    icon: '🌫️',
    tip: '大货出没',
    maps: ['bay'],
    weight: 1.6,
    fog: 2,
    light: 0.62,
    tint: '#c9d8de',
    particle: 'none',
    spawn: 1.05,
    wave: 0.7,
    bias: { hunt: 1.7, dart: 1.25, rare: 2.3, school: 0.76 },
  },
  {
    id: 'storm',
    name: '雷雨',
    icon: '⛈️',
    tip: '浪高流急',
    maps: ['bay'],
    weight: 1.1,
    fog: 1.55,
    light: 0.58,
    tint: '#5b6f86',
    particle: 'rain',
    spawn: 1.22,
    wave: 2.1,
    bolt: 0.11,
    bias: { hunt: 1.35, rare: 1.5, school: 0.82, cruise: 0.9 },
  },
  {
    id: 'aurora',
    name: '极光',
    icon: '🌌',
    tip: '稀有鱼活跃',
    maps: ['ice'],
    weight: 3,
    fog: 0.9,
    light: 1.15,
    tint: '#7dffcf',
    particle: 'spark',
    spawn: 1,
    wave: 0.9,
    bias: { hunt: 1.25, rare: 2.4, school: 0.88 },
  },
  {
    id: 'blizzard',
    name: '暴雪',
    icon: '🌨️',
    tip: '小鱼成群',
    maps: ['ice'],
    weight: 2.6,
    fog: 1.7,
    light: 0.8,
    tint: '#cfe6f5',
    particle: 'snow',
    spawn: 1.25,
    wave: 1.7,
    bias: { school: 1.5, cruise: 1.2, rare: 0.75 },
  },
  {
    id: 'iceclear',
    name: '晴寒',
    icon: '❄️',
    tip: '视野通透',
    maps: ['ice'],
    weight: 2,
    fog: 0.78,
    light: 1.22,
    tint: '#dff4ff',
    particle: 'none',
    spawn: 0.95,
    wave: 0.55,
    bias: { cruise: 1.3, rare: 1.1 },
  },
];

export const weatherById: Record<WeatherId, Weather> = Object.fromEntries(
  WEATHERS.map((w) => [w.id, w]),
) as Record<WeatherId, Weather>;

/** 每张图的默认天气（存档里没有 / 与地图不匹配时用它） */
export const DEFAULT_WEATHER: Record<MapId, WeatherId> = { bay: 'clear', ice: 'aurora' };

/** 抽一个天气：默认 45% 维持当前天气，避免每局都变；alwaysChange 时强制换一种 */
export function rollWeather(map: MapId, prev?: WeatherId, alwaysChange = false): WeatherId {
  const pool = WEATHERS.filter((w) => w.maps.includes(map));
  if (!pool.length) return DEFAULT_WEATHER[map];
  if (!alwaysChange && prev && pool.some((w) => w.id === prev) && Math.random() < 0.45) return prev;
  let cands = pool;
  if (alwaysChange && pool.length > 1) cands = pool.filter((w) => w.id !== prev);
  const total = cands.reduce((a, w) => a + w.weight, 0);
  let r = Math.random() * total;
  for (const w of cands) {
    r -= w.weight;
    if (r <= 0) return w.id;
  }
  return cands[cands.length - 1].id;
}

/** 某条鱼在这种天气下的权重倍率 */
export function weatherWeight(sp: Species, w: Weather): number {
  let m = w.bias[sp.behavior] ?? 1;
  // hp 高 / 售价高的当「稀有」处理
  if (sp.hp >= 5 || sp.value >= 150) m *= w.bias.rare ?? 1;
  return m;
}

// ================= 辅助 =================

export function bandAt(map: MapId, depth: number): Band {
  const bands = MAPS[map].bands;
  for (const b of bands) if (depth >= b.from && depth < b.to) return b;
  return depth < bands[0].from ? bands[0] : bands[bands.length - 1];
}

export const fmtMoney = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
