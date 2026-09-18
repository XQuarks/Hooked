/**
 * _p7-tests.mjs —— v0.7 第三批 · 第 4 步：回归补齐
 *   verify9：B2b 枪店黑卡 / 解锁场景 / N 组新货播报（推送 / 红点 / NEW 角标）
 *   verify6：H9 —— B10 的回归断言（when.map 不再读 licenses）
 */
import fs from 'node:fs';

const fail = [];
const rep = (file, a, b, label) => {
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes(b)) { console.log('… ' + label + '（已应用，跳过）'); return; }
  const n = src.split(a).length - 1;
  if (n !== 1) { fail.push(`${label}（${file}）：命中 ${n} 次`); return; }
  fs.writeFileSync(file, src.replace(a, b));
  console.log('✓ ' + label);
};

// ═══════════ verify6：H9 = B10 的回归断言 ═══════════
rep('.dev/verify6.mjs',
`  check('G2 全程控制台零报错', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

  // ── 汇总 ────────────────────────────────────────────────`,
`  check('G2 全程控制台零报错', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

  // ── H9 = GAMEPLAY §6.2 B10 的回归断言（v0.7 第三批补上）─────────
  // 历史事故：许可证退役之后 \`save.licenses\` 恒为空数组，而 \`_callReady\` 还在读它 ——
  // 两通带 \`when.map\` 的电话（shop-winch / shop-newsea）从此**永远不响**，
  // 并且 296 条断言一条都没拦住。这条断言就是那个窟窿的补丁：
  // **故意把 licenses 留成空数组**，只给"海图 + 船"—— 旧实现在这里必挂。
  const h9 = J(await ev(\`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.ui.closePhone();
    g.save.calls = cfg.CALLS.filter(c => c.id !== 'shop-winch').map(c => c.id);   // 其它都标记已听
    g.save.lastCallCast = -999;
    g.save.casts = 25;
    g.save.chart = true; g.save.boats = { owned: ['golden'], current: 'golden' };
    g.save.licenses = [];                       // ⚠ 故意保持空：读 licenses 的旧实现会判"没到过极地"
    g.save.mapBest = { polar: 300 };
    g.applyUpgrades(); g.showIdle();
    const c = g.pendingCall();
    return { id: c && c.id };})())\`));
  check('H9 B10 回归：到过极地（海图 + 船）之后，带 when.map 的电话照常响 —— 判定不读 licenses',
    h9.id === 'shop-winch', \`待播的电话 = \${h9.id}（应为 shop-winch）\`);

  // ── 汇总 ────────────────────────────────────────────────`, 'verify6 H9');

// ═══════════ verify9：B2b 黑卡 + 解锁场景 ═══════════
rep('.dev/verify9.mjs',
`  check('B2 开局只有手枪：它是唯一"装备中"的卡，其余都还没拥有',
    b1.current[0] === true && b1.current.filter(Boolean).length === 1
    && b1.owned[0] === true && b1.owned.filter(Boolean).length === 1,
    \`装备中=\${b1.ids[b1.current.indexOf(true)]} · 已拥有 \${b1.owned.filter(Boolean).length} 把\`);`,
`  check('B2 开局只有手枪：它是唯一"装备中"的卡，其余都还没拥有',
    b1.current[0] === true && b1.current.filter(Boolean).length === 1
    && b1.owned[0] === true && b1.owned.filter(Boolean).length === 1,
    \`装备中=\${b1.ids[b1.current.indexOf(true)]} · 已拥有 \${b1.owned.filter(Boolean).length} 把\`);

  // ── B2b 枪店分段解锁（v0.7 第三批，A2 = a + b）────────────────
  // 首图只上架手枪；其余六把是"黑卡"—— 看得到名字，**看不到任何数值 / 价格 / 机制说明**。
  // 为什么连价格都不给：价格是一种承诺（"攒够就能买"），而对一把还没解锁的枪，
  // 攒钱根本不是当前的正确目标 —— 先把深度潜出来才是。
  const b2b = J(await ev(\`JSON.stringify((()=>{
    const cards = [...document.querySelectorAll('#pApp .gs-item')];
    const locked = cards.filter(c => c.classList.contains('unreleased'));
    return {
      total: cards.length, locked: locked.length,
      withBuy: locked.filter(c => c.querySelector('[data-gun-buy]')).length,
      withStats: locked.filter(c => c.querySelector('.gs-stats')).length,
      withTip: locked.filter(c => c.querySelector('.gs-tip')).length,
      withFoot: locked.filter(c => c.querySelector('.gs-foot')).length,
      withLock: locked.filter(c => c.querySelector('.gs-lockrow')).length,
      firstName: (locked[0] && (locked[0].querySelector('.gs-t b') || {}).textContent) || '',
      hasDigit: locked.some(c => /[0-9]/.test(c.textContent)) };
  })())\`));
  check('B2b 首图只上架手枪：其余六把是黑卡（无购买按钮、无数值、无价格），只留名字与解锁条件',
    b2b.total === 7 && b2b.locked === 6 && b2b.withBuy === 0 && b2b.withStats === 0
    && b2b.withTip === 0 && b2b.withFoot === 0 && b2b.withLock === 6 && b2b.hasDigit === false,
    \`黑卡 \${b2b.locked}/\${b2b.total} · 第一张「\${b2b.firstName}」· 带解锁条件 \${b2b.withLock}/\${b2b.locked} · 泄数字 \${b2b.hasDigit}\`);

  // ── 把场景推到"已经到过极地 + 潜到过最底"：六把枪全部上架 ──
  // ⚠ gunAnnounced 预先铺满：B3~B8 验的是"买 / 装 / 升"，不是"新货播报" ——
  //   不铺的话六条推送会排队、红点会亮，B10 的截图里就会飘着一张通知卡。
  await ev(\`(()=>{const g=window.__game;
    g.save.chart = true;
    g.save.boats = { owned: ['golden'], current: 'golden' };
    g.save.mapBest = { polar: 1240 };
    g.save.gunNews = []; g.save.gunAnnounced = window.__cfg.GUN_ORDER.slice();
    g.syncBadges(); g.ui.refreshApp(); return 'ok';})()\`);
  await rafWait(240);`, 'verify9 B2b + 解锁场景');

// ═══════════ verify9：N 组 新货播报 ═══════════
rep('.dev/verify9.mjs',
`  // ═══════════════════════════════════════════════════════
  console.log('\\n── D 存档（枪械字段）──');`,
`  // ═══════════════════════════════════════════════════════
  console.log('\\n── B3 新货播报（推送 / 红点 / NEW 角标）──');
  // ═══════════════════════════════════════════════════════
  // 场景：刚拿到海图 + 船（人还在海湾），什么都不拥有 → 散弹枪是唯一的新货。
  // 到过一张图 = 解锁条件满足的那一刻（enterMap / 深度纪录 / showIdle 三处都会检测）。
  const n1 = J(await ev(\`JSON.stringify((()=>{const g=window.__game; const cfg=window.__cfg;
    g.state='idle'; g.phoneOpen=false; g.showIdle();
    g.save.chart = true; g.save.boats = { owned: ['golden'], current: 'golden' };
    g.save.mapBest = { polar: 0 };
    g.save.guns = { owned: [], current: 'pistol', levels: Object.fromEntries(cfg.GUN_ORDER.map(k=>[k,0])) };
    g.save.gunNews = []; g.save.gunAnnounced = [];
    g.syncBadges(); g.showIdle();
    return { news: g.save.gunNews.slice(), ann: g.save.gunAnnounced.slice(),
      dot: document.getElementById('phoneDot').classList.contains('on'),
      queued: g.ui._newsQueue.map(x => x.id) };})())\`));
  check('N1 到过极地那一刻：散弹枪记进未读 + 标记已播报，手机红点亮、推送排队',
    n1.news.join(',') === 'shotgun' && n1.ann.join(',') === 'shotgun'
    && n1.dot === true && n1.queued.join(',') === 'shotgun',
    \`未读 \${JSON.stringify(n1.news)} · 已播报 \${JSON.stringify(n1.ann)} · 红点=\${n1.dot} · 队列 \${JSON.stringify(n1.queued)}\`);

  const n2 = J(await ev(\`JSON.stringify((()=>{const g=window.__game;
    g.openPhone();
    return { open: g.phoneOpen,
      badge: !!document.querySelector('#pHome .p-ico.gunshop .p-badge') };})())\`));
  check('N2 手机桌面：枪店 App 图标挂红点（和来电红点同一套视觉语言）',
    n2.open === true && n2.badge === true, \`红点=\${n2.badge}\`);

  const n3 = J(await ev(\`JSON.stringify((()=>{const g=window.__game;
    g.ui.openApp('gunshop'); g.ui.refreshApp();
    const cards = [...document.querySelectorAll('#pApp .gs-item')];
    const shot = cards.find(c => c.textContent.includes('散弹枪'));
    const uzi = cards.find(c => c.textContent.includes('Uzi'));
    const out = { news: g.save.gunNews.slice(),
      dot: document.getElementById('phoneDot').classList.contains('on'),
      newTag: !!(shot && shot.querySelector('.gs-new')),
      uziLocked: !!(uzi && uzi.classList.contains('unreleased')) };
    g.ui.showPhoneHome();   // 桌面重绘之后红点才会从图标上消失（openApp 只清数据）
    out.homeBadge = !!document.querySelector('#pHome .p-ico.gunshop .p-badge');
    return out;})())\`));
  check('N3 点开枪店：未读清零（红点全灭），散弹枪挂「NEW」，还没解锁的 Uzi 仍是黑卡',
    n3.news.length === 0 && n3.dot === false && n3.homeBadge === false
    && n3.newTag === true && n3.uziLocked === true,
    \`未读 \${JSON.stringify(n3.news)} · 手机红点=\${n3.dot} · 桌面红点=\${n3.homeBadge} · NEW=\${n3.newTag} · Uzi 黑卡=\${n3.uziLocked}\`);

  const n4 = J(await ev(\`JSON.stringify((()=>{const g=window.__game;
    g.save.mapBest = { polar: 140 }; g._syncGunNews();
    const queuedInPhone = g.ui._newsQueue.map(x => x.id);
    g.closePhone();
    return { news: g.save.gunNews.slice(), queuedInPhone,
      bannerOn: document.getElementById('newsBanner').classList.contains('on'),
      body: document.getElementById('newsBody').textContent };})())\`));
  check('N4 潜到 −140m：Uzi 解锁 → 记进未读；收起手机后推送卡才弹出（手机开着时不打扰）',
    n4.news.join(',') === 'uzi' && n4.queuedInPhone.join(',') === 'uzi'
    && n4.bannerOn === true && /Uzi/.test(n4.body),
    \`未读 \${JSON.stringify(n4.news)} · 队列 \${JSON.stringify(n4.queuedInPhone)} · 推送「\${n4.body}」\`);

  const n5 = J(await ev(\`JSON.stringify((()=>{const g=window.__game;
    g.save.coins = 99999999;
    g.openPhone(); g.ui.openApp('gunshop'); g.ui.refreshApp();
    document.querySelector('[data-gun-buy="shotgun"]').click(); g.ui.refreshApp();
    const cards = [...document.querySelectorAll('#pApp .gs-item')];
    const shot = cards.find(c => c.textContent.includes('散弹枪'));
    return { owned: g.save.guns.owned.slice(), current: g.save.guns.current,
      newTag: !!(shot && shot.querySelector('.gs-new')) };})())\`));
  check('N5 买下新枪：「NEW」角标消失（它只陪到买下为止，announced 只增不减也不影响）',
    n5.owned.includes('shotgun') && n5.current === 'shotgun' && n5.newTag === false,
    \`拥有 \${JSON.stringify(n5.owned)} · 当前=\${n5.current} · NEW=\${n5.newTag}\`);

  // ═══════════════════════════════════════════════════════
  console.log('\\n── D 存档（枪械字段）──');`, 'verify9 N 组');

if (fail.length) { console.error('\n✗✗ 未写盘：\n  ' + fail.join('\n  ')); process.exit(1); }
console.log('\n✓ 两套测试补丁写盘完成');
