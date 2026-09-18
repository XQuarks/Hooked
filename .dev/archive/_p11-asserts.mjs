/**
 * _p10-fix-asserts.mjs —— N1/N4 断言对齐真实行为：
 *   · pumpNews 会**立刻**把队首弹出来显示（手机关着时）—— 所以"队列里还有它"是错的，
 *     正确的断言是「推送卡正处于弹出状态」。
 *   · N4 在 announced=['shotgun'] 之后，sync 只可能吐出 Uzi。
 */
import fs from 'node:fs';

const F = '.dev/verify9.mjs';
let src = fs.readFileSync(F, 'utf8');
const fail = [];
const rep = (a, b, label) => {
  const n = src.split(a).length - 1;
  if (n !== 1) { fail.push(`${label}: 命中 ${n} 次`); return; }
  src = src.replace(a, b);
  console.log('✓ ' + label);
};

rep(`    g.syncBadges(); g.showIdle();
    return { news: g.save.gunNews.slice(), ann: g.save.gunAnnounced.slice(),
      dot: document.getElementById('phoneDot').classList.contains('on'),
      queued: g.ui._newsQueue.map(x => x.id) };})())\`));
  check('N1 到过极地那一刻：散弹枪记进未读 + 标记已播报，手机红点亮、推送排队',
    n1.news.join(',') === 'shotgun' && n1.ann.join(',') === 'shotgun'
    && n1.dot === true && n1.queued.join(',') === 'shotgun',
    \`未读 \${JSON.stringify(n1.news)} · 已播报 \${JSON.stringify(n1.ann)} · 红点=\${n1.dot} · 队列 \${JSON.stringify(n1.queued)}\`);`,
`    g.syncBadges(); g.showIdle();
    return { news: g.save.gunNews.slice(), ann: g.save.gunAnnounced.slice(),
      dot: document.getElementById('phoneDot').classList.contains('on'),
      bannerOn: document.getElementById('newsBanner').classList.contains('on') };})())\`));
  check('N1 到过极地那一刻：散弹枪记进未读 + 标记已播报，手机红点亮、推送卡弹出',
    n1.news.join(',') === 'shotgun' && n1.ann.join(',') === 'shotgun'
    && n1.dot === true && n1.bannerOn === true,
    \`未读 \${JSON.stringify(n1.news)} · 已播报 \${JSON.stringify(n1.ann)} · 红点=\${n1.dot} · 推送卡=\${n1.bannerOn}\`);`, 'N1 断言');

rep(`  check('N4 潜到 −140m：Uzi 解锁 → 记进未读；收起手机后推送卡才弹出（手机开着时不打扰）',
    n4.news.join(',') === 'uzi' && n4.queuedInPhone.join(',') === 'uzi'
    && n4.bannerOn === true && /Uzi/.test(n4.body),`,
`  check('N4 潜到 −140m：Uzi 解锁 → 记进未读；收起手机后推送卡才弹出（手机开着时不打扰）',
    n4.news.join(',') === 'uzi' && n4.queuedInPhone.join(',') === 'uzi'
    && n4.bannerOn === true && /Uzi/.test(n4.body) && !/散弹枪/.test(n4.body),`, 'N4 断言');

if (fail.length) { console.error('\n✗✗ 未写盘：\n  ' + fail.join('\n  ')); process.exit(1); }
fs.writeFileSync(F, src);
console.log('\n✓ 断言已对齐');
