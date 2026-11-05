import { BOTTLES, DEFAULT_WEATHER, GUN_UPGRADES, MAPS, MapId, SPECIES, UPGRADES, UNLOCK_ICE, WEATHERS, WeatherId, hatById, weaponById } from './data';

export type CharId =
  | 'mom' | 'cuihua' | 'dapao' | 'mayor' | 'kevin' | 'gull'
  | 'unknown' | 'grandpa' | 'bobo' | 'bottle' | 'me' | 'seal';

export interface Msg {
  id: string;
  thread: CharId;
  mine?: boolean;
  text: string;
  trip: number;
  /** 主线消息：会进结算页提示、手机红点用红色，其余只在对应 App 里显示小点 */
  key?: boolean;
}

export interface Post {
  id: string;
  author: CharId;
  text: string;
  likes: number;
  trip: number;
  /** 自己点过赞（每条只能点一次） */
  liked?: boolean;
}

export type QueueItem =
  | {
      kind: 'call';
      uid?: string;
      from: CharId;
      lines: { me?: boolean; text: string }[];
      tier?: 'main' | 'side';
      /** 强制来电：隐藏其余 UI，只能接听，不能拒绝、不能拖到以后 */
      force?: boolean;
      /** 来电摘要，用于通话记录与岛上预览 */
      topic?: string;
      /** 玩家主动拨出（回拨）：不写新的通话记录，也不动队列 */
      callback?: boolean;
    }
  | { kind: 'comic'; uid?: string; id: string; tier?: 'main' | 'side' }
  | { kind: 'notice'; uid?: string; title: string; text: string; org?: string; tier?: 'main' | 'side' }
  | { kind: 'bottle'; uid?: string; id: string; tier?: 'main' | 'side' };

export type Quality = 'low' | 'mid' | 'high';

export interface SaveState {
  v: number;
  money: number;
  totalEarned: number;
  trips: number;
  map: MapId;
  unlocked: MapId[];
  up: { line: number; saw: number; hook: number; lamp: number; fin: number; scope: number; slowmo: number };
  guns: string[];
  gun: string;
  hats: string[];
  hat: string;
  caught: Record<string, number>;
  maxDepth: Record<MapId, number>;
  bestTrip: number;
  bestCatch: number;
  bestCombo: number;
  bottles: string[];
  fired: string[];
  messages: Msg[];
  feed: Post[];
  comics: string[];
  unread: Record<string, number>;
  /** 其中属于主线（key）的未读数：手机图标只认这个，避免「10 条烂梗」把红点撑爆 */
  unreadKey: Record<string, number>;
  /** 已经提示过「新解锁」的 App，避免每次开手机都弹一遍 */
  appsSeen: string[];
  hotFish: Record<MapId, string>;
  sound: boolean;
  haptics: boolean;
  quality: Quality;
  hints: Record<string, boolean>;
  queue: QueueItem[];
  /** 通话记录：接过的、漏掉的都在这里，手机短信页可查 */
  calls: CallLog[];
  /** 公告与系统通知的存档，手机通知栏可回看 */
  notices: NoticeRecord[];
  /** 当前天气（只对当前地图有效，换图会回落到默认） */
  weather: WeatherId;
  /** 每个短信会话已经读到第几条：右侧未读数 = 总条数 − 这个 */
  seen: Record<string, number>;
  jellyHits: number;
  legend: boolean;
}

export interface NoticeRecord {
  id: string;
  title: string;
  text: string;
  org?: string;
  trip: number;
  /** notice = 剧情公告；system = 应用解锁之类的系统通知 */
  kind: 'notice' | 'system';
}

export interface CallLog {
  /** 'call_' + 队列 uid，用来把「漏接」升级成「已接」 */
  id: string;
  from: CharId;
  topic: string;
  trip: number;
  missed: boolean;
  /** 通话内容（挂断后存档），用来在联系人里回看历史对话 */
  lines?: { me?: boolean; text: string }[];
}

const KEY = 'absurd-fishing-3d-save-v2';
const LEGACY_KEY = 'ridiculous-fishing-cn-save-v1';

export function defaultSave(): SaveState {
  return {
    v: 2,
    money: 0,
    totalEarned: 0,
    trips: 0,
    map: 'bay',
    unlocked: ['bay'],
    up: { line: 0, saw: 0, hook: 0, lamp: 0, fin: 0, scope: 0, slowmo: 0 },
    guns: ['pistol'],
    gun: 'pistol',
    hats: ['straw'],
    hat: 'straw',
    caught: {},
    maxDepth: { bay: 0, ice: 0 },
    bestTrip: 0,
    bestCatch: 0,
    bestCombo: 0,
    bottles: [],
    fired: [],
    messages: [],
    feed: [],
    comics: [],
    unread: {},
    unreadKey: {},
    // 开局就有的三个不算「新解锁」
    appsSeen: ['sms', 'calls', 'story', 'dex', 'settings'],
    hotFish: { bay: 'yellow', ice: 'cod' },
    sound: true,
    haptics: true,
    quality: 'high',
    hints: {},
    queue: [],
    calls: [],
    notices: [],
    weather: 'clear',
    seen: {},
    jellyHits: 0,
    legend: false,
  };
}

function migrateLegacy(): SaveState | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    const d = defaultSave();
    const money = Number(o.money) || 0;
    return {
      ...d,
      money,
      totalEarned: Number(o.totalEarned) || 0,
      trips: Number(o.trips) || 0,
      map: o.map === 'ice' ? 'ice' : 'bay',
      unlocked: Array.isArray(o.unlocked) && o.unlocked.includes('ice') ? ['bay', 'ice'] : ['bay'],
      up: { ...d.up, ...(o.up || {}) },
      guns: Array.isArray(o.guns) && o.guns.length ? o.guns.filter((g: string) => weaponById[g]) : d.guns,
      gun: weaponById[o.gun] ? o.gun : 'pistol',
      hats: Array.isArray(o.hats) && o.hats.length ? o.hats.filter((h: string) => hatById[h]) : d.hats,
      hat: hatById[o.hat] ? o.hat : 'straw',
      caught: o.caught && typeof o.caught === 'object' ? o.caught : {},
      maxDepth: { ...d.maxDepth, ...(o.maxDepth || {}) },
      bestTrip: Number(o.bestTrip) || 0,
      bestCatch: Number(o.bestCatch) || 0,
      bottles: Array.isArray(o.bottles) ? o.bottles : [],
      fired: Array.isArray(o.fired) ? o.fired : [],
      messages: Array.isArray(o.messages) ? o.messages : [],
      feed: Array.isArray(o.feed) ? o.feed : [],
      comics: Array.isArray(o.comics) ? o.comics : [],
      legend: !!o.legend,
      jellyHits: Number(o.jellyHits) || 0,
      queue: [],
      hints: { design: true },
    };
  } catch {
    return null;
  }
}

export function loadSave(): SaveState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const d = defaultSave();
      // 老存档里可能混进 sky_* 这类非鱼种 key（天空目标的击杀曾经被当成鱼记进来），
      // 读档时按 SPECIES 清一遍，图鉴的「x/24」才不会越界
      const caught: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed.caught || {})) {
        if (SPECIES.some((sp) => sp.id === k)) caught[k] = Number(v) || 0;
      }
      return {
        ...d,
        ...parsed,
        caught,
        v: 2,
        up: { ...d.up, ...(parsed.up || {}) },
        maxDepth: { ...d.maxDepth, ...(parsed.maxDepth || {}) },
        hotFish: { ...d.hotFish, ...(parsed.hotFish || {}) },
        hints: { ...(parsed.hints || {}) },
        queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      };
    }
  } catch {
    /* ignore */
  }
  const legacy = migrateLegacy();
  if (legacy) return legacy;
  return defaultSave();
}

export function persist(s: SaveState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}

export function exportSave(s: SaveState): string {
  return JSON.stringify(s);
}

export function importSave(text: string): SaveState | null {
  try {
    const o = JSON.parse(text);
    if (!o || typeof o !== 'object' || typeof o.money !== 'number') return null;
    const d = defaultSave();
    return {
      ...d,
      ...o,
      v: 2,
      up: { ...d.up, ...(o.up || {}) },
      maxDepth: { ...d.maxDepth, ...(o.maxDepth || {}) },
      hotFish: { ...d.hotFish, ...(o.hotFish || {}) },
      hints: { ...(o.hints || {}) },
      queue: Array.isArray(o.queue) ? o.queue : [],
    };
  } catch {
    return null;
  }
}

export function upVal(s: SaveState, id: 'line' | 'saw' | 'hook' | 'lamp' | 'fin'): number {
  const def = UPGRADES.find((u) => u.id === id)!;
  return def.values[Math.min(s.up[id] ?? 0, def.values.length - 1)];
}

export function gunUpVal(s: SaveState, id: 'scope' | 'slowmo'): number {
  const def = GUN_UPGRADES.find((u) => u.id === id)!;
  return def.values[Math.min(s.up[id] ?? 0, def.values.length - 1)];
}

/** 图鉴计数：水母不计入（避免用罚款鱼凑解锁条件） */
export function speciesCount(s: SaveState, map?: MapId): number {
  return SPECIES.filter((sp) => (!map || sp.map === map) && sp.special !== 'jelly' && (s.caught[sp.id] || 0) > 0).length;
}

export function hatBonus(s: SaveState) {
  const h = hatById[s.hat];
  return {
    money: h?.money ?? 1,
    jelly: h?.jelly ?? 1,
    lamp: h?.lamp ?? 0,
    speed: h?.speed ?? 1,
  };
}

export function currentWeapon(s: SaveState) {
  return weaponById[s.gun] || weaponById.pistol;
}

export function pickHotFish(map: MapId, exclude?: string): string {
  const pool = SPECIES.filter((sp) => sp.map === map && !sp.special && sp.id !== exclude);
  return pool[Math.floor(Math.random() * pool.length)].id;
}

export function canUnlockIce(s: SaveState) {
  return s.maxDepth.bay >= UNLOCK_ICE.depth && speciesCount(s, 'bay') >= UNLOCK_ICE.species;
}

/** 第一阶段：听见北方的消息（只需 180m + 8 种鱼），航线上会先出现「未开放海域」 */
export function canBookIce(s: SaveState) {
  return s.maxDepth.bay >= UNLOCK_ICE.bookDepth && speciesCount(s, 'bay') >= UNLOCK_ICE.bookSpecies;
}

// ---------------------------------------------------------------- 手机 App 解锁

export type AppKey = 'sms' | 'calls' | 'feed' | 'story' | 'dex' | 'tackle' | 'guns' | 'route' | 'hat' | 'stats' | 'settings';

/**
 * 分阶段开放：一开始只给「看消息 / 看图鉴 / 设置」，其余跟着进度开。
 * 目的不是卡人，而是避免开局 8 个图标一屏、玩家不知道点哪个。
 */
export function appUnlocked(s: SaveState, id: AppKey): boolean {
  switch (id) {
    case 'sms':
    case 'calls':
    case 'story':
    case 'dex':
    case 'settings':
      return true;
    case 'feed':
      return s.trips >= 1;
    case 'tackle':
      return s.trips >= 1;
    case 'guns':
      return s.trips >= 2;
    case 'stats':
      return s.trips >= 2;
    case 'route':
      // 原来的「40 米或 3 趟」经常第一趟就开了，航线是中期内容，改成只看趟数
      return s.trips >= 3;
    case 'hat':
      return s.trips >= 4;
    default:
      return true;
  }
}

export function appUnlockHint(s: SaveState, id: AppKey): string {
  switch (id) {
    case 'feed':
      return '完成第 1 次出海后解锁';
    case 'tackle':
      return '完成第 1 次出海后解锁';
    case 'guns':
    case 'stats':
      return '完成第 2 次出海后解锁';
    case 'route':
      return `完成第 3 次出海后解锁（当前 ${s.trips} 次）`;
    case 'hat':
      return '完成第 4 次出海后解锁';
    default:
      return '';
  }
}

/** 刚解锁、但还没被玩家看到过的 App（用于标 NEW） */
export function freshApps(s: SaveState): AppKey[] {
  const all: AppKey[] = ['sms', 'dex', 'tackle', 'guns', 'route', 'hat', 'stats', 'settings'];
  return all.filter((a) => appUnlocked(s, a) && !s.appsSeen.includes(a));
}

/** 当前地图生效的天气：存档里的天气不属于这张图时，回落到默认天气 */
export function weatherOf(s: SaveState): WeatherId {
  const w = s.weather;
  return WEATHERS.some((x) => x.id === w && x.maps.includes(s.map)) ? w : DEFAULT_WEATHER[s.map];
}

// ---------------------------------------------------------------- 主线目标

export interface Goal {
  icon: string;
  text: string;
  sub?: string;
  now?: number;
  target?: number;
  /** 数字前缀，例如 $ */
  unit?: string;
  /** 需要玩家做一件具体的事，而不是继续下潜 */
  cta?: 'phone' | 'sea';
}

/**
 * 岸边的「下一步」。用状态判断而不是「第一个未触发事件」——
 * 这样玩家跳级时（比如一口气潜到 90m）目标会自动跟上，不会卡在已完成的那条。
 */
export function mainGoal(s: SaveState): Goal {
  const totalSpecies = SPECIES.filter((x) => x.special !== 'jelly').length;

  if (s.legend) {
    const got = speciesCount(s);
    if (got < totalSpecies) return { icon: '📖', text: '集齐全部图鉴', now: got, target: totalSpecies, sub: '爷爷的桑拿店等你回去' };
    return { icon: '👑', text: '你已经是传奇渔夫了', sub: '随便钓钓，或者去冰海看看' };
  }

  if (s.unlocked.includes('ice')) {
    if (s.maxDepth.ice < 100) return { icon: '❄️', text: '在冰海下潜 100 米', now: s.maxDepth.ice, target: 100, sub: '永夜很黑，先去渔具升头灯' };
    if (s.maxDepth.ice < 300) return { icon: '🕳️', text: '在冰海下潜 300 米', now: s.maxDepth.ice, target: 300 };
    return { icon: '👑', text: '下潜到 500 米，找到鱼王', now: s.maxDepth.ice, target: 500, sub: '它嘴里的假牙是你爷爷的' };
  }

  const ticket = MAPS.ice.ticket;

  if (canUnlockIce(s)) {
    if (s.money < ticket) {
      return { icon: '🎫', text: '攒够船票钱', now: s.money, target: ticket, unit: '$', sub: `还差 $${(ticket - s.money).toLocaleString()}` };
    }
    return { icon: '⛵', text: '可以出发去冰海了', sub: '打开手机 → 航线 → 购买船票', cta: 'phone' };
  }

  if (canBookIce(s)) {
    return { icon: '🧭', text: '打开航线，看看北方', sub: '爷爷好像留了什么话', cta: 'phone' };
  }

  if (s.maxDepth.bay < 60) return { icon: '🌊', text: '下潜到 60 米', now: s.maxDepth.bay, target: 60 };
  if (s.totalEarned < 400) return { icon: '💰', text: '累计赚到 $400', now: s.totalEarned, target: 400, unit: '$', sub: '攒钱升级鱼线，才能下得更深' };
  if (s.maxDepth.bay < 120) return { icon: '🌊', text: '下潜到 120 米', now: s.maxDepth.bay, target: 120, sub: '更深的鱼更值钱' };
  if (speciesCount(s, 'bay') < 7) return { icon: '📖', text: '收集 7 种鱼', now: speciesCount(s, 'bay'), target: 7 };
  if (s.maxDepth.bay < 180) return { icon: '🌊', text: '下潜到 180 米', now: s.maxDepth.bay, target: 180 };
  if (speciesCount(s, 'bay') < UNLOCK_ICE.species) {
    return { icon: '📖', text: `收集 ${UNLOCK_ICE.species} 种鱼`, now: speciesCount(s, 'bay'), target: UNLOCK_ICE.species };
  }
  return { icon: '🌊', text: `下潜到 ${UNLOCK_ICE.depth} 米`, now: s.maxDepth.bay, target: UNLOCK_ICE.depth };
}

/** 全部升级 + 船票的累计金币需求，用于 UI 展示与平衡自检 */
export function totalCost(): number {
  const up = UPGRADES.reduce((a, u) => a + u.costs.reduce((x, y) => x + y, 0), 0);
  const gunUp = GUN_UPGRADES.reduce((a, u) => a + u.costs.reduce((x, y) => x + y, 0), 0);
  return up + gunUp + 12000 + 3600 + 2400; // 枪械 / 帽子 / 船票（估算）
}

/**
 * 支线目标：直接从成就表里挑「离得最近的那一条」。
 * 主线负责「去哪」，支线负责「顺手还能干什么」——玩家不缺大方向，缺的是这一局的小理由。
 */
export function sideGoal(s: SaveState): Goal | null {
  if (!s.legend && s.unlocked.includes('ice') && s.maxDepth.ice >= 300) {
    return { icon: '👑', text: '击败鱼王，拿回假牙', sub: '鱼王在 500 米以下' };
  }
  if (s.bestCatch < 8) return { icon: '🪝', text: '一次钩到 8 条鱼', now: s.bestCatch, target: 8, sub: '收线时主动撞鱼' };
  if (s.bestCatch < 20) return { icon: '🐟', text: '一次钩到 20 条鱼', now: s.bestCatch, target: 20 };
  if (s.bestCombo < 8) return { icon: '🔥', text: '空中打出 8 连', now: s.bestCombo, target: 8 };
  if (s.bestTrip < 1200) return { icon: '💰', text: '单次出海赚 $1200', now: s.bestTrip, target: 1200, unit: '$' };
  if (s.bottles.length < BOTTLES.length) {
    return { icon: '🍾', text: '找齐海底的漂流瓶', now: s.bottles.length, target: BOTTLES.length };
  }
  if (speciesCount(s) < 18) return { icon: '📖', text: '图鉴收集 18 种鱼', now: speciesCount(s), target: 18 };
  if (s.guns.length < 4) return { icon: '🔫', text: '拥有 4 把枪', now: s.guns.length, target: 4 };
  return null;
}

// ---------------------------------------------------------------- 通话记录

/** 漏接 / 接听都记一笔；同一个 uid 只保留一条（后到的状态覆盖先到的） */
export function logCall(
  s: SaveState,
  uid: string,
  from: CharId,
  topic: string,
  missed: boolean,
  lines?: { me?: boolean; text: string }[],
): SaveState {
  const id = 'call_' + uid;
  const prev = s.calls.find((c) => c.id === id);
  if (prev) {
    // 漏接 → 回拨接听时要把台词补上，否则联系人里点进这通电话只写「没有留下记录」
    const nextLines = lines ?? prev.lines;
    if (prev.missed === missed && nextLines === prev.lines) return s;
    return {
      ...s,
      calls: s.calls.map((c) => (c.id === id ? { ...c, missed, lines: nextLines } : c)),
    };
  }
  return {
    ...s,
    calls: [...s.calls, { id, from, topic, trip: s.trips, missed, lines }],
    // 漏接算「特殊消息」：手机图标上给红点，电话 App 里也能看到
    unread: missed ? { ...s.unread, call: (s.unread.call || 0) + 1 } : s.unread,
    unreadKey: missed ? { ...s.unreadKey, call: (s.unreadKey.call || 0) + 1 } : s.unreadKey,
  };
}
