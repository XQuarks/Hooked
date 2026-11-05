import { MAPS, bandAt, hatById, speciesById, weaponById } from './data';
import { SaveState, gunUpVal, hatBonus, upVal, weatherOf } from './state';

export { MAPS, bandAt, hatById, speciesById, weaponById };

export function currentWeaponName(s: SaveState): string {
  return weaponById[s.gun]?.name ?? '爷爷的老手枪';
}

export function speciesName(id: string): string {
  return speciesById[id]?.name ?? id;
}

/** 出海配置：把存档翻译成引擎参数（唯一的耦合点） */
export function tripConfig(s: SaveState) {
  const map = MAPS[s.map];
  const hb = hatBonus(s);
  const w = weaponById[s.gun] ?? weaponById.pistol;
  return {
    map: s.map,
    hat: s.hat,
    legend: s.legend,
    weather: weatherOf(s),
    maxDepth: Math.min(upVal(s, 'line'), map.maxDepth),
    hookCap: upVal(s, 'hook'),
    saw: upVal(s, 'saw'),
    lamp: upVal(s, 'lamp') + hb.lamp,
    fin: upVal(s, 'fin'),
    weapon: w,
    aim: gunUpVal(s, 'scope'),
    slow: gunUpVal(s, 'slowmo'),
    moneyMult: hb.money,
    jellyMult: hb.jelly,
    speedMult: hb.speed,
    hotFish: s.hotFish[s.map],
    bottlesHave: s.bottles,
    hints: s.hints,
  };
}

/** 本轮「热门鱼」提示文案 */
export function hotName(s: SaveState): string {
  const id = s.hotFish[s.map];
  const known = (s.caught[id] || 0) > 0;
  if (!known) return '神秘鱼种（见鱼鉴）';
  return `${speciesName(id)} · 售价 ×2`;
}

export const BADGE_KEYS = ['sms', 'feed', 'route', 'comic', 'hat', 'bottle', 'call'] as const;

/**
 * 手机主图标上的数字：只算主线（key）消息。
 * 以前是把 6 个入口的未读直接相加，结果是「📱 17」——玩家点进去发现全是烂梗。
 */
export function badgeKeyCount(s: SaveState): number {
  return BADGE_KEYS.reduce((a, k) => a + (s.unreadKey?.[k] || 0), 0);
}

/** 全部未读（含普通），用来决定要不要显示「有个小点」而不是数字 */
export function badgeTotal(s: SaveState): number {
  return BADGE_KEYS.reduce((a, k) => a + (s.unread[k] || 0), 0);
}

/** 某个入口（短信/鱼博/航线…）的未读，给 App 图标用 */
export function badgeOf(s: SaveState, key: string): { total: number; key: number } {
  return { total: s.unread[key] || 0, key: s.unreadKey?.[key] || 0 };
}
