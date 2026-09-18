/**
 * _p8-fix-n1.mjs —— 修复 N1（上一版被 shell 转义弄坏了）：
 * N 组每一步**自清理**，只断言"这一次 sync 的增量"，不依赖上一步的存档残留。
 */
import fs from 'node:fs';

const F = '.dev/verify9.mjs';
const L = fs.readFileSync(F, 'utf8').split('\n');

const start = L.findIndex((l) => l.includes('const n1 = J(await ev('));
const end = L.findIndex((l) => l.includes("const n2 = J(await ev("));
if (start < 0 || end < 0 || end <= start) { console.error('✗ 锚点定位失败', start, end); process.exit(1); }

// N1 的正确形态（行数组；模板串里的 ${} 用 \${ 转义）
const n1 = [
  '  const n1 = J(await ev(`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;',
  '    // 每步自清理：只断言"这一次 sync 的增量"，不依赖上一步的存档残留 ——',
  '    //   跨步骤状态会让失败原因飘到完全不相干的地方（本次审计真踩到）。',
  '    g.state=\'idle\'; g.phoneOpen=false; g.ui.closePhone();',
  '    g.save.chart = true; g.save.boats = { owned: [\'golden\'], current: \'golden\' };',
  '    g.save.mapBest = { polar: 0 };',
  '    g.save.guns = { owned: [], current: \'pistol\', levels: Object.fromEntries(cfg.GUN_ORDER.map(k=>[k,0])) };',
  '    g.save.gunNews = []; g.save.gunAnnounced = [];',
  '    g.save.calls = cfg.CALLS.map(c => c.id); g.ringingCall = null; g.ui.ringPhone(false, null);',
  '    g.ui._newsQueue.length = 0; g.ui._newsShowing = false;',
  '    g.syncBadges(); g.showIdle();',
  '    return { news: g.save.gunNews.slice(), ann: g.save.gunAnnounced.slice(),',
  '      dot: document.getElementById(\'phoneDot\').classList.contains(\'on\'),',
  '      queued: g.ui._newsQueue.map(x => x.id) };})())`));',
  '  check(\'N1 到过极地那一刻：散弹枪记进未读 + 标记已播报，手机红点亮、推送排队\',',
  '    n1.news.join(\',\') === \'shotgun\' && n1.ann.join(\',\') === \'shotgun\'',
  '    && n1.dot === true && n1.queued.join(\',\') === \'shotgun\',',
  '    `未读 ${JSON.stringify(n1.news)} · 已播报 ${JSON.stringify(n1.ann)} · 红点=${n1.dot} · 队列 ${JSON.stringify(n1.queued)}`);',
  '',
];

L.splice(start, end - start, ...n1);
fs.writeFileSync(F, L.join('\n'));
console.log('✓ N1 已修复（' + n1.length + ' 行，替换原 ' + (end - start) + ' 行）');
