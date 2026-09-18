/**
 * _p9-fix-n4.mjs —— N4 同样改成"每步自清理"：先把未读/队列/已播报归到已知态，
 * 再把深度推到 140，只断言"这一步让 Uzi 进了未读、收起手机后推送卡弹出"。
 */
import fs from 'node:fs';

const F = '.dev/verify9.mjs';
const src = fs.readFileSync(F, 'utf8');

const start = src.indexOf('  const n4 = J(await ev(');
const end = src.indexOf('  const n5 = J(await ev(');
if (start < 0 || end < 0 || end <= start) { console.error('✗ 锚点定位失败', start, end); process.exit(1); }

const n4 = [
  '  const n4 = J(await ev(`JSON.stringify((()=>{const g=window.__game;',
  '    // 自清理到已知态：散弹枪算"已经播报过"，这一步只看 Uzi 的深度解锁',
  '    g.save.gunNews = []; g.save.gunAnnounced = [\'shotgun\'];',
  '    g.ui._newsQueue.length = 0; g.ui._newsShowing = false;',
  '    g.save.mapBest = { polar: 140 }; g._syncGunNews();',
  '    const queuedInPhone = g.ui._newsQueue.map(x => x.id);',
  '    g.closePhone();   // 手机开着时推送不弹（不打扰）；收起后才放出来',
  '    return { news: g.save.gunNews.slice(), queuedInPhone,',
  '      bannerOn: document.getElementById(\'newsBanner\').classList.contains(\'on\'),',
  '      body: document.getElementById(\'newsBody\').textContent };})())`));',
  '  check(\'N4 潜到 −140m：Uzi 解锁 → 记进未读；收起手机后推送卡才弹出（手机开着时不打扰）\',',
  '    n4.news.join(\',\') === \'uzi\' && n4.queuedInPhone.join(\',\') === \'uzi\'',
  '    && n4.bannerOn === true && /Uzi/.test(n4.body),',
  '    `未读 ${JSON.stringify(n4.news)} · 队列 ${JSON.stringify(n4.queuedInPhone)} · 推送「${n4.body}」`);',
  '',
];

const out = src.slice(0, start) + n4.join('\n') + src.slice(end);
fs.writeFileSync(F, out);
console.log('✓ N4 已重写（' + n4.length + ' 行）');
