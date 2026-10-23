import { useEffect, useRef, useState } from 'react';
import { MAPS, SPECIES, weatherById } from '../game/data';
import { AppKey, CharId, Quality, SaveState, appUnlockHint, appUnlocked, freshApps, weatherOf } from '../game/state';
import { Money } from './common';
import { APP_META, CallsApp, DexApp, FeedApp, GunApp, HatApp, NotifyApp, RouteApp, SettingsApp, SmsApp, StatsApp, StoryApp, TackleApp } from './apps';
import { badgeOf } from '../game/helpers';
import { sfx } from '../game/audio';

/** 主屏每页放几个 App */
const PAGE_SIZE = 12;

/** 这些 App 用浅色主题（白/米黄底），其余维持深海底 */
const LIGHT_APPS = new Set<AppId>(['sms', 'calls', 'feed', 'story', 'dex', 'tackle', 'hat', 'stats']);

export type AppId =
  | 'sms'
  | 'calls'
  | 'feed'
  | 'story'
  | 'dex'
  | 'tackle'
  | 'guns'
  | 'route'
  | 'hat'
  | 'stats'
  | 'settings'
  | 'notify';

/** 哪些入口的未读会汇总到该 App 的红点上 */
const APP_BADGES: Record<string, string[]> = {
  sms: ['sms'],
  calls: ['call'],
  feed: ['feed'],
  story: ['comic', 'bottle'],
  route: ['route'],
  hat: ['hat'],
};

interface Props {
  s: SaveState;
  update: (fn: (s: SaveState) => SaveState) => void;
  notify: (t: string) => void;
  onClose: () => void;
  /** 回拨一通电话：由 App 弹出通话浮层 */
  onCallBack: (from: CharId, topic: string) => void;
  initial?: AppId | null;
  /** 打开后要展开的那条通知（从岛上点公告进来时用） */
  initialFocus?: string | null;
  setQuality: (q: Quality) => void;
}

export function Phone({ s, update, notify, onClose, initial, initialFocus, setQuality, onCallBack }: Props) {
  const [app, setApp] = useState<AppId | null>(initial ?? null);
  const focus = initialFocus ?? null;
  const [threadFocus, setThreadFocus] = useState<CharId | null>(null);
  // 主屏分页：每页 8 个（2 行 × 4），小屏也不会挤成 4 列 3 行
  const [page, setPage] = useState(0);
  const touchX = useRef(0);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(t);
  }, []);

  const back = () => {
    sfx.click();
    setApp(null);
  };

  const openApp = (id: AppId) => {
    sfx.click();
    update((prev) =>
      prev.appsSeen.includes(id) ? prev : { ...prev, appsSeen: [...prev.appsSeen, id] },
    );
    setApp(id);
  };

  // 一进 App 就清它的红点。
  // 之前只在「从主屏幕点图标」时清，从灵动岛/结算页直接进来会漏清——返回后红点还在。
  useEffect(() => {
    if (!app) return;
    const keys = APP_BADGES[app] ?? [];
    if (!keys.length) return;
    update((prev) => {
      const unread = { ...prev.unread };
      const unreadKey = { ...prev.unreadKey };
      let dirty = false;
      for (const k of keys) {
        if (unread[k]) dirty = true;
        if (unreadKey[k]) dirty = true;
        unread[k] = 0;
        unreadKey[k] = 0;
      }
      return dirty ? { ...prev, unread, unreadKey } : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app]);

  const fresh = freshApps(s);
  const pages = Math.max(1, Math.ceil(APP_META.length / PAGE_SIZE));
  const weather = weatherById[weatherOf(s)];
  // 调试模式（URL 带 #debug）下不锁 App，方便自动化脚本直接测各个页面
  const debugAll = typeof location !== 'undefined' && location.hash.includes('debug');

  const common = { s, update, notify, onBack: back, setQuality };
  let content = null;
  if (app === 'sms') content = <SmsApp {...common} initialThread={threadFocus} />;
  else if (app === 'calls')
    content = (
      <CallsApp
        {...common}
        onOpenThread={(id) => {
          setThreadFocus(id);
          setApp('sms');
        }}
        onCallBack={(_, from, topic) => onCallBack(from, topic)}
      />
    );
  else if (app === 'feed') content = <FeedApp {...common} />;
  else if (app === 'story') content = <StoryApp {...common} />;
  else if (app === 'dex') content = <DexApp {...common} />;
  else if (app === 'tackle') content = <TackleApp {...common} />;
  else if (app === 'guns') content = <GunApp {...common} />;
  else if (app === 'route') content = <RouteApp {...common} />;
  else if (app === 'hat') content = <HatApp {...common} />;
  else if (app === 'stats') content = <StatsApp {...common} />;
  else if (app === 'settings') content = <SettingsApp {...common} />;
  else if (app === 'notify')
    content = (
      <NotifyApp
        s={s}
        update={update}
        onBack={back}
        focus={focus}
        onJump={(target, thread) => {
          sfx.click();
          setThreadFocus(thread ?? null);
          setApp(target);
        }}
      />
    );

  return (
    <div className="phone-wrap" onClick={onClose}>
      <div className="phone" data-map={s.map} onClick={(e) => e.stopPropagation()}>
        <div className="phone-screen">
          <div className="phone-status">
            <span className="ps-time">
              {now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="ps-notch" aria-hidden="true" />
            <span className="ps-right">
              <span className="ps-net">{s.map === 'ice' ? '企鹅通信' : '海鸥移动'} ▮▮▮</span>
              <button
                className="phone-bell"
                aria-label="通知栏"
                onClick={() => {
                  sfx.click();
                  setApp('notify');
                }}
              >
                🔔
              </button>
              <button className="phone-fold" aria-label="收起手机" onClick={onClose}>
                <svg width="9" height="6" viewBox="0 0 9 6" aria-hidden="true">
                  <path d="M1 1l3.5 3.4L8 1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </span>
          </div>
          <div className="phone-body">
            {content ? (
              <div className={`app-shell app-${app}${app && LIGHT_APPS.has(app) ? ' lt' : ''}`}>{content}</div>
            ) : (
              <div className="phone-home">
                <div className="ph-head">
                  <div className="phone-clock">
                    {now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="phone-date">
                    {now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })} · 海大海 OS
                  </div>
                </div>
                <div className="phone-chips">
                  <span>📍 {MAPS[s.map].name}</span>
                  <span>
                    💰 <Money v={s.money} />
                  </span>
                  <span>
                    {weather.icon} {weather.name}
                  </span>
                </div>
              <div
                className="app-grid"
                onTouchStart={(e) => {
                  touchX.current = e.touches[0].clientX;
                }}
                onTouchEnd={(e) => {
                  const dx = e.changedTouches[0].clientX - touchX.current;
                  if (Math.abs(dx) < 42) return;
                  const next = dx < 0 ? Math.min(pages - 1, page + 1) : Math.max(0, page - 1);
                  if (next !== page) {
                    sfx.click();
                    setPage(next);
                  }
                }}
              >
                {APP_META.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).map((a) => {
                  const id = a.id as AppId;
                  const key = id as AppKey;
                  const unlocked = debugAll || appUnlocked(s, key);
                  const bs = (APP_BADGES[a.id] ?? []).reduce(
                    (acc, k) => {
                      const b = badgeOf(s, k);
                      return { total: acc.total + b.total, key: acc.key + b.key };
                    },
                    { total: 0, key: 0 },
                  );
                  const isNew = unlocked && fresh.includes(key);
                  return (
                    <button
                      key={a.id}
                      className={`app-icon${unlocked ? '' : ' locked'}${isNew ? ' new-app' : ''}`}
                      onClick={() => {
                        if (!unlocked) {
                          sfx.bad();
                          notify(appUnlockHint(s, key));
                          return;
                        }
                        openApp(id);
                      }}
                    >
                      <div className="sq" style={{ background: a.bg }}>
                        {a.icon}
                      </div>
                      <div className="lbl">{a.name}</div>
                      {!unlocked && <span className="app-lock">🔒</span>}
                      {unlocked && bs.key > 0 && <span className="dot">{bs.key > 99 ? '99+' : bs.key}</span>}
                      {unlocked && bs.key === 0 && bs.total > 0 && <span className="app-any" />}
                      {isNew && <span className="app-new">NEW</span>}
                    </button>
                  );
                })}
              </div>
              {pages > 1 && (
                <div className="app-dots">
                  {Array.from({ length: pages }, (_, i) => {
                    // 另一页有「新应用」时，圆点上也点一下，别让玩家漏掉
                    const hasNew = APP_META.slice(i * PAGE_SIZE, i * PAGE_SIZE + PAGE_SIZE).some((a) => {
                      const key = a.id as AppKey;
                      return (debugAll || appUnlocked(s, key)) && fresh.includes(key);
                    });
                    return (
                      <button
                        key={i}
                        className={`app-dot${i === page ? ' on' : ''}${hasNew ? ' fresh' : ''}`}
                        onClick={() => {
                          sfx.click();
                          setPage(i);
                        }}
                        aria-label={`第 ${i + 1} 页`}
                      />
                    );
                  })}
                </div>
              )}
              <div className="phone-note">
                <b>📌 便签</b>
                <br />
                {tip(s)}
              </div>

              {/* 主屏底部的战绩条：参考图的手机桌面留白很多，
                  这里用现有存档数据补一块，既有信息又不空 */}
              <div className="home-stat">
                <div>
                  <i>累计收入</i>
                  <b>${s.totalEarned.toLocaleString()}</b>
                </div>
                <div>
                  <i>图鉴</i>
                  <b>
                    {Object.keys(s.caught).length}
                    <em>/{SPECIES.length}</em>
                  </b>
                </div>
                <div>
                  <i>最深</i>
                  <b>
                    {Math.max(0, ...Object.values(s.maxDepth))}
                    <em>m</em>
                  </b>
                </div>
              </div>

              {/* 底部快捷栏：4 个常驻 App，顺便把桌面的下半截填上 */}
              <div className="home-dock">
                {(['sms', 'calls', 'story', 'settings'] as AppId[]).map((id) => {
                  const m = APP_META.find((a) => a.id === id);
                  if (!m) return null;
                  return (
                    <button
                      key={id}
                      className="dock-ico"
                      style={{ background: m.bg }}
                      onClick={() => openApp(id)}
                      aria-label={m.name}
                    >
                      {m.icon}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
          <div className="phone-bar">
            <button className="pb-side" onClick={() => app && back()}>
              {app ? '‹ 返回' : ''}
            </button>
            <button
              className="home"
              onClick={() => (app ? back() : onClose())}
              aria-label="主屏幕"
            />
            <span className="pb-side" />
          </div>
        </div>
      </div>
    </div>
  );
}

function tip(s: SaveState): string {
  if (s.legend) return '爷爷找到了！接下来：收集全部图鉴，成为真正的钓鱼大师。';
  if (s.unlocked.includes('ice')) return s.maxDepth.ice < 300 ? '冰海很黑，先升头灯和防流鳍，再往深处去。' : '鱼王在 500 米以下！确保鱼线够长、枪够猛。';
  if (s.fired.includes('unlockReady')) return '打开「航线」购买去极光冰海的船票！';
  if (s.maxDepth.bay < 100) return '升级鱼线，钓得更深。海底好像漂着发光的瓶子……';
  return `目标：阳光湾下潜 250 米，并收集 11 种鱼（当前 ${s.maxDepth.bay}m）。`;
}
