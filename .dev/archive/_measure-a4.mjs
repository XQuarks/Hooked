/**
 * _measure-a4.mjs — A4 的"输出上限余量"离线模型（只读测量，不改任何东西）
 *
 * 目的：GAMEPLAY §6.4 A4 说"深层血牛的几枪余量极薄"，但那个数只存在于
 * 一段一次性脚本里。这里把模型固定下来，好搬进 `gen-docs.mjs`。
 *
 * 口径：逐帧复刻 `game.js::_updateGun` / `_shoot`（dt = 1/60），
 *   ① 全程按住（单点枪 = 以冷却允许的最快速率连点，这是它的理论上限）；
 *   ② 每一发都命中**同一条鱼**，散弹 6 颗弹丸全中（= 上界，不是实战值）；
 *   ③ 不计滞空位移、不计换目标、不计击退。
 *
 * 用法：node .dev/archive/_measure-a4.mjs
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const C = await import(pathToFileURL(path.join(ROOT, 'src/config.js')).href);
const { GUNS, gunById, gunStats, TUNING, SPECIES } = C;

const DT = 1 / 60;
const T = TUNING.airTimeout;

/** 某把枪在 `T` 秒内能打出的**总伤害上限** */
function ceiling(id, lv, seconds = T) {
  const g = gunById(id);
  const s = gunStats(id, lv);
  const holdable = g.mech === 'auto' || g.mech === 'burst' || g.mech === 'laser';

  let cd = 0, reloadT = 0, heat = 0, spin = 0, ammo = s.mag || 0;
  let total = 0, shots = 0;

  const fire = () => {
    let d = s.damage;
    if (g.mech === 'laser') d *= 1 + Math.min(s.rampMax, s.ramp * heat);
    let c = s.cooldown;
    if (g.mech === 'auto' && s.spinup > 0) c *= 1 + (1 - Math.min(1, spin / s.spinup));
    cd = c;
    if (g.mech === 'burst') ammo = Math.max(0, ammo - 1);
    total += d * (g.mech === 'shotgun' ? s.pellets : 1);
    shots++;
  };

  const steps = Math.floor(seconds / DT);
  for (let i = 0; i <= steps; i++) {
    if (cd > 0) cd = Math.max(0, cd - DT);

    if (reloadT > 0) {
      reloadT -= DT;
      if (reloadT <= 0) { reloadT = 0; if (s.mag) ammo = s.mag; heat = 0; }
      continue;
    }

    if (!holdable) { if (cd <= 0) fire(); continue; }

    if (g.mech === 'auto') spin = Math.min(s.spinup, spin + DT);
    if (g.mech === 'laser') {
      heat += DT;
      if (s.mag && heat >= s.mag) { reloadT = s.reload; cd = 0; continue; }
    }
    if (cd > 0) continue;
    if (g.mech === 'burst' && s.mag && ammo <= 0) { reloadT = s.reload; cd = 0; continue; }
    fire();
  }
  return { total, shots };
}

const named = (n) => SPECIES.find((s) => s.name === n);
const targets = ['极夜之王', '黄金鱼王', '巨齿鲨'].map(named);

console.log(`airTimeout = ${T}s，dt = 1/60\n`);
const head = ['枪（Lv0）', ...targets.map((t) => `${t.name}(${t.hp})`)];
console.log(head.join(' | '));

for (const g of GUNS) {
  const { total, shots } = ceiling(g.id, 0);
  const cells = targets.map((t) => (total / t.hp).toFixed(2));
  console.log([`${g.name} (${total.toFixed(1)} 伤 / ${shots} 发)`, ...cells].join(' | '));
}

console.log('\n激光 ramp×mag（描述里那句"最多 ×5"到底哪一档吃得到）：');
for (let lv = 0; lv <= 5; lv++) {
  const s = gunStats('laser', lv);
  const reached = 1 + Math.min(s.rampMax, s.ramp * s.mag);
  console.log(`  Lv${lv}: ramp=${s.ramp} × 过热时长=${s.mag}s → ${reached.toFixed(2)}×  ${reached >= 5 ? '← 吃满' : ''}`);
}
