import { useEffect, useMemo, useRef, useState } from 'react';
import { AppBar, Avatar, Money, Thumb } from './common';
import { BOTTLES, GUN_UPGRADES, HATS, MAPS, MapId, SPECIES, UPGRADES, UNLOCK_ICE, WEAPONS, bandAt, speciesById } from '../game/data';
import { CharId, Quality, SaveState, canBookIce, canUnlockIce, clearSave, exportSave, importSave, pickHotFish, speciesCount } from '../game/state';
import { CHARS, COMICS } from '../game/story';
import { sfx } from '../game/audio';

export interface AppProps {
  s: SaveState;
  update: (fn: (s: SaveState) => SaveState) => void;
  notify: (t: string) => void;
  onBack: () => void;
  setQuality: (q: Quality) => void;
}

/* ==================== 短信 / 鱼博 / 剧情 ==================== */

export function SmsApp({ s, update, onBack, initialThread }: AppProps & { initialThread?: CharId | null }) {
  const [thread, setThread] = useState<CharId | null>(initialThread ?? null);

  const threads = useMemo(() => {
    const map = new Map<CharId, { last: string; trip: number; n: number }>();
    for (const m of s.messages) {
      map.set(m.thread, { last: m.text, trip: m.trip, n: (map.get(m.thread)?.n ?? 0) + 1 });
    }
    if (s.bottles.length) {
      const b = BOTTLES.filter((x) => s.bottles.includes(x.id));
      map.set('bottle', { last: b[b.length - 1]?.title ?? '来自海底的信', trip: 0, n: b.length });
    }
    return [...map.entries()].sort((a, b) => b[1].trip - a[1].trip);
  }, [s.messages, s.bottles]);

  if (thread) {
    const list = s.messages.filter((m) => m.thread === thread);
    const bottles = thread === 'bottle' ? BOTTLES.filter((b) => s.bottles.includes(b.id)) : [];
    return (
      <div>
        <AppBar title={CHARS[thread].name} onBack={() => setThread(null)} />
        <div className="app-body">
          {bottles.map((b) => (
            <div className="msg" key={b.id}>
              <div className="bub">
                <b style={{ color: '#7cf7b0' }}>{b.title}</b>
                <br />
                {b.text}
              </div>
            </div>
          ))}
          {list.map((m) => (
            <div className={`msg${m.mine ? ' mine' : ''}`} key={m.id}>
              <div className="bub">{m.text}</div>
            </div>
          ))}
          {list.length === 0 && bottles.length === 0 && <div className="muted small">还没有消息。</div>}
        </div>
      </div>
    );
  }

  // 顶部角标也走未读：全读完显示「已读」，不再永远挂着总条数
  const unreadAll = threads.reduce((a, [id, t]) => a + Math.max(0, t.n - (s.seen?.[id] ?? 0)), 0);

  return (
    <div>
      <AppBar
        title="短信"
        onBack={onBack}
        right={
          threads.length === 0 ? undefined : unreadAll > 0 ? (
            <span className="tag">{unreadAll} 未读</span>
          ) : (
            <span className="tag read">已读</span>
          )
        }
      />
      <div className="app-body">
        {threads.map(([id, t]) => {
          // 未读 = 总条数 − 已经读过的条数；自己发的不算（消息列表里没有 mine 以外的干扰）
          const left = Math.max(0, t.n - (s.seen?.[id] ?? 0));
          return (
          <button
            key={id}
            className="thread"
            style={{ width: '100%' }}
            onClick={() => {
              sfx.click();
              // 点开会话就把这一行标成已读，右侧数字随即消失
              update((p) => ({ ...p, seen: { ...p.seen, [id]: t.n } }));
              setThread(id);
            }}
          >
            <Avatar id={id} />
            <div className="t">
              <b>{CHARS[id].name}</b>
              <p>{t.last}</p>
            </div>
            {left > 0 && <span className="n">{left}</span>}
          </button>
          );
        })}
        {threads.length === 0 && <div className="muted small">出海一次，手机就会响起来。</div>}
      </div>
    </div>
  );
}

/* ==================== 电话 ==================== */

export function CallsApp({
  s,
  onBack,
  onOpenThread,
  onCallBack,
}: AppProps & { onOpenThread: (id: CharId) => void; onCallBack: (id: string, from: CharId, topic: string) => void }) {
  const [open, setOpen] = useState<CharId | null>(null);
  const calls = s.calls;
  const missed = calls.filter((c) => c.missed).length;

  /** 联系人 = 打过电话的 + 发过短信的（漂流瓶和自己不算），按最近一次往来排序 */
  const contacts = useMemo(() => {
    type Row = {
      id: CharId;
      lastCall?: (typeof calls)[number];
      lastMsg?: (typeof s.messages)[number];
      nCall: number;
      missed: number;
      trip: number;
    };
    const map = new Map<CharId, Row>();
    for (const c of calls) {
      const cur = map.get(c.from) ?? { id: c.from, nCall: 0, missed: 0, trip: -1 };
      cur.lastCall = c;
      cur.nCall += 1;
      if (c.missed) cur.missed += 1;
      cur.trip = Math.max(cur.trip, c.trip);
      map.set(c.from, cur);
    }
    for (const m of s.messages) {
      if (m.thread === 'bottle' || m.thread === 'me') continue;
      const cur = map.get(m.thread) ?? { id: m.thread, nCall: 0, missed: 0, trip: -1 };
      cur.lastMsg = m;
      cur.trip = Math.max(cur.trip, m.trip);
      map.set(m.thread, cur);
    }
    return [...map.values()].sort((a, b) => b.trip - a.trip);
  }, [calls, s.messages]);

  if (open) {
    const mine = calls.filter((c) => c.from === open);
    const c = CHARS[open];
    const last = mine[mine.length - 1];
    return (
      <div>
        <AppBar
          title={c.name}
          onBack={() => {
            sfx.click();
            setOpen(null);
          }}
          right={<span className="tag">{mine.length > 0 ? `${mine.length} 次` : '联系人'}</span>}
        />
        <div className="app-body">
          <div className="call-hero">
            <Avatar id={open} size={54} />
            <div>
              <b>{c.name}</b>
              <i>{c.title ?? ''}</i>
            </div>
          </div>
          <div className="call-actions">
            <button
              className="ca-btn"
              disabled={!last}
              onClick={() => last && onCallBack(last.id, open, last.topic)}
            >
              📞 {last ? '回拨' : '暂无可回拨'}
            </button>
            <button className="ca-btn ghost" onClick={() => onOpenThread(open)}>
              💬 发短信
            </button>
          </div>

          {mine.length === 0 && <div className="muted small">还没有通话记录。短信聊过，但没通过电话。</div>}
          {mine.map((cl) => (
            <div className={`call-card${cl.missed ? ' missed' : ''}`} key={cl.id}>
              <div className="cc-head">
                <span className="cc-ic">{cl.missed ? '📵' : '📞'}</span>
                <b className="cc-topic">{cl.topic}</b>
                <em className="cc-meta">{cl.trip > 0 ? `第 ${cl.trip} 趟` : '岸边'}</em>
              </div>
              {cl.missed ? (
                <div className="cc-note">未接听 · 点上面「回拨」打回去</div>
              ) : cl.lines?.length ? (
                <div className="cc-lines">
                  {cl.lines.map((l, i) => (
                    <div className={`msg${l.me ? ' mine' : ''}`} key={i}>
                      <div className="bub">{l.text}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="cc-note">已接听 · 这通电话没有留下记录</div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <AppBar
        title="电话"
        onBack={onBack}
        right={<span className="tag">{missed > 0 ? `${missed} 未接` : `${contacts.length} 位联系人`}</span>}
      />
      <div className="app-body">
        {contacts.length === 0 && <div className="muted small">还没有联系人。剧情推进时，电话会打进来。</div>}
        {contacts.map((ct) => {
          const preview = ct.lastCall
            ? `${ct.lastCall.missed ? '未接来电 · ' : ''}${ct.lastCall.topic}`
            : ct.lastMsg?.text ?? '还没有往来';
          return (
            <button
              key={ct.id}
              className="contact-row"
              onClick={() => {
                sfx.click();
                setOpen(ct.id);
              }}
            >
              <Avatar id={ct.id} />
              <span className="cr-body">
                <b>{CHARS[ct.id].name}</b>
                <i>{preview}</i>
              </span>
              {ct.missed > 0 ? (
                <span className="cr-badge">{ct.missed}</span>
              ) : ct.nCall > 0 ? (
                <span className="cr-n">{ct.nCall} 次</span>
              ) : (
                <span className="cr-n">短信</span>
              )}
            </button>
          );
        })}
        <div className="phone-note" style={{ marginTop: 12 }}>
          <b>📞 说明</b>
          <br />
          点联系人看历史通话（接过的话会保留整段对话）；「回拨」重打最近一通，「发短信」跳去短信 App。
        </div>
      </div>
    </div>
  );
}

/* ==================== 鱼博 ==================== */

/** 鱼博的自动文案：按当前战绩挑一条，读起来像玩家自己写的 */
function draftPost(s: SaveState): string {
  const kinds = Object.keys(s.caught).length;
  const map = MAPS[s.map]?.name ?? '海上';
  const deepest = Math.max(0, ...Object.values(s.maxDepth));
  const pool = [
    `今日战报：累计赚了 ${s.totalEarned}，${kinds} 种鱼进账。手有点抖。`,
    `在${map}潜到 ${deepest} 米。看见一条比我还大的鱼，它看了我一眼就走了。`,
    `第 ${s.trips} 趟了。爷爷你到底在哪。`,
    '有没有人要鱼？很多鱼。真的很多。冰箱放不下了。',
    '水母不能打。别问，问就是罚款。',
    '今天钓到一条会发光的鱼。它比我房间的灯还亮。',
    '钓鱼的秘诀是耐心。还有一把好枪。',
    '海鸥史蒂夫又偷我鱼了。它现在看见我会点头打招呼。',
    '有人知道为什么深海的鱼都长得这么随便吗。',
    '我妈问我什么时候找个正经工作。我说我在继承家业。',
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

export function FeedApp({ s, update, notify, onBack }: AppProps) {
  const posts = s.feed.slice().reverse();

  const publish = () => {
    sfx.click();
    const text = draftPost(s);
    update((prev) => ({
      ...prev,
      feed: [...prev.feed, { id: 'me_' + Date.now(), author: 'me', text, likes: 0, trip: prev.trips }],
    }));
    notify('已发到鱼博');
  };

  const like = (id: string) => {
    const p = s.feed.find((x) => x.id === id);
    if (!p || p.liked) return;
    sfx.click();
    update((prev) => ({
      ...prev,
      feed: prev.feed.map((x) => (x.id === id ? { ...x, liked: true, likes: x.likes + 1 } : x)),
    }));
  };

  return (
    <div>
      <AppBar
        title="鱼博"
        onBack={onBack}
        right={
          <button className="mini-btn" onClick={publish}>
            + 发帖
          </button>
        }
      />
      <div className="app-body">
        {posts.length === 0 && <div className="muted small">还没人发帖。点右上角发一条，或者出海钓点东西。</div>}
        {posts.map((p) => (
          <div className="feed-post" key={p.id}>
            <div className="h">
              <Avatar id={p.author} size={30} />
              {CHARS[p.author].name}
              <span>· 第 {p.trip} 趟</span>
            </div>
            <p>{p.text}</p>
            <div className="act">
              <button className={`like${p.liked ? ' on' : ''}`} onClick={() => like(p.id)}>
                {p.liked ? '❤️' : '🤍'} {p.likes.toLocaleString()}
              </button>
              <span> · 💬 0 · 转发 0</span>
            </div>
          </div>
        ))}
        <div className="phone-note" style={{ marginTop: 14 }}>
          <b>📰 渔市快讯</b>
          <br />
          海鸥史蒂夫否认参与码头鲭鱼失窃案，称「那天我在飞」。
          <br />
          专家提醒：吃鱼补脑，但用枪打鱼并不补脑。
        </div>
      </div>
    </div>
  );
}

/* ==================== 剧情（漫画 / 漂流瓶） ==================== */

export function StoryApp({ s, onBack }: AppProps) {
  return (
    <div>
      <AppBar
        title="剧情"
        onBack={onBack}
        right={
          <span className="tag">
            {s.comics.length}/{Object.keys(COMICS).length}
          </span>
        }
      />
      <div className="app-body">
        <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 6 }}>📖 漫画</div>
        {Object.values(COMICS).map((c) => {
          const got = s.comics.includes(c.id);
          return (
            <div className="card" key={c.id}>
              <div className="row">
                <div className="ico">{got ? '📖' : '🔒'}</div>
                <div className="grow">
                  <div className="name">{got ? c.title : '未解锁的漫画'}</div>
                  <div className="desc">{got ? `${c.panels.length} 格 · 已解锁` : '推进剧情即可解锁'}</div>
                </div>
              </div>
            </div>
          );
        })}
        <div className="divider" />
        <div style={{ fontSize: 11, color: 'var(--dim)', margin: '8px 0 6px' }}>
          🍾 漂流瓶（{s.bottles.length}/{BOTTLES.length}）
        </div>
        {BOTTLES.map((b) => {
          const got = s.bottles.includes(b.id);
          return (
            <div className="card" key={b.id}>
              <div className="name">{got ? b.title : `？？？ · ${MAPS[b.map].name} ${b.depth}m`}</div>
              <div className="desc">{got ? b.text : '据说在海底某处发着绿光……'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ==================== 鱼鉴 ==================== */

export function DexApp({ s, onBack }: AppProps) {
  const [tab, setTab] = useState<MapId>(s.map);
  const [sel, setSel] = useState<string | null>(null);
  const list = SPECIES.filter((x) => x.map === tab);
  const got = speciesCount(s, tab);
  const sp = sel ? speciesById[sel] : null;
  const known = sel ? (s.caught[sel] || 0) > 0 : false;
  const band = sp ? bandAt(tab, (sp.minD + sp.maxD) / 2) : null;

  return (
    <div>
      <AppBar
        title="鱼鉴"
        onBack={onBack}
        right={
          <span className="small muted">
            {speciesCount(s)}/{SPECIES.filter((x) => x.special !== 'jelly').length}
          </span>
        }
      />
      <div className="tabs">
        {(['bay', 'ice'] as MapId[]).map((m) => (
          <button key={m} className={tab === m ? 'on' : ''} onClick={() => setTab(m)}>
            {MAPS[m].name}
          </button>
        ))}
      </div>
      <div className="app-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--dim)', marginBottom: 8 }}>
          <span>
            已收集 {got}/{list.length}
          </span>
          <span>点击查看鱼的样子</span>
        </div>
        <div className="dex-grid">
          {list.map((x) => {
            const n = s.caught[x.id] || 0;
            // 图鉴编号：用全局物种序号（不是当前地图里的序号），换图也不会变
            const no = SPECIES.findIndex((sp) => sp.id === x.id) + 1;
            // 星级按身价派生：越贵越稀有，参考图里每格左上角都有
            const v = x.value;
            const stars = v < 20 ? 1 : v < 60 ? 2 : v < 150 ? 3 : v < 400 ? 4 : 5;
            return (
              <button key={x.id} className={`dex-cell${n > 0 ? '' : ' locked'}`} onClick={() => setSel(x.id)}>
                <span className="dc-star">{'★'.repeat(stars)}</span>
                <span className="dc-no">No.{String(no).padStart(2, '0')}</span>
                <Thumb id={x.id} locked={n === 0} h={52} />
                <div className="n" style={{ color: x.special === 'legend' ? 'var(--gold)' : undefined }}>
                  {n > 0 ? x.name : '？？？'}
                </div>
                <div className="d">{n > 0 ? `×${n}` : `${x.minD}-${x.maxD}m`}</div>
              </button>
            );
          })}
        </div>
      </div>

      {sp && (
        <div className="sheet-mask" onClick={() => setSel(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="dex-hero">
              <Thumb id={sp.id} locked={!known} h={104} maxW={260} />
            </div>
            <div className="sheet-body" style={{ paddingTop: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontSize: 21, fontWeight: 900 }}>{known ? sp.name : '？？？'}</div>
                {sp.special === 'legend' && <span className="tag gold">传说</span>}
                {sp.special === 'rare' && <span className="tag gold">稀有</span>}
                {sp.special === 'jelly' && <span className="tag" style={{ background: 'rgba(255,120,160,.18)', color: '#ff9ad5' }}>别打</span>}
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {sp.minD}-{sp.maxD}m · {band?.name} · 血量 {sp.hp} · {sp.value < 0 ? `罚款 $${-sp.value} 起` : `收购价 $${sp.value}`}
              </div>
              <div className="dex-desc">
                {known ? sp.desc : '尚未钓到。把它打下来一次即可解锁图鉴。'}
              </div>
              <div className="kv">
                <span>行为</span>
                <b>{sp.behavior === 'school' ? '成群巡游' : sp.behavior === 'dart' ? '间歇冲刺' : sp.behavior === 'hunt' ? '主动追钩' : '匀速巡游'}</b>
              </div>
              <div className="kv">
                <span>已击落</span>
                <b>{s.caught[sp.id] || 0} 条</b>
              </div>
            </div>
            <div className="sheet-foot">
              <button className="btn ghost wide" onClick={() => setSel(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==================== 渔具 ==================== */

export function TackleApp({ s, update, notify, onBack }: AppProps) {
  const buy = (id: keyof SaveState['up'], cost: number) => {
    if (s.money < cost) {
      sfx.bad();
      notify('钱不够！翠花姐不接受赊账（除了你爷爷）');
      return;
    }
    sfx.cash();
    update((p) => ({ ...p, money: p.money - cost, up: { ...p.up, [id]: p.up[id] + 1 } as SaveState['up'] }));
  };
  return (
    <div>
      <AppBar title="翠花渔具店" onBack={onBack} right={<Money v={s.money} />} />
      <div className="app-body">
        <div className="card" style={{ background: 'linear-gradient(150deg, rgba(16,185,129,.18), rgba(255,255,255,.02))' }}>
          <div className="row">
            <div className="ico">👩‍🦰</div>
            <div className="grow">
              <div className="name">翠花姐</div>
              <div className="desc">「鱼线加长一米，快乐加深一米！你爷爷当年就是在我这买的第一根鱼线，然后就失踪了。别多想。」</div>
            </div>
          </div>
        </div>
        {s.up.line === 0 && (
          <div className="card" style={{ background: 'linear-gradient(150deg, rgba(74,214,255,.14), rgba(255,255,255,.02))' }}>
            <div className="desc" style={{ margin: 0 }}>
              💡 先把鱼线放长——它是唯一能让<b>所有鱼都更值钱</b>的升级。深处的鱼价格是浅水的三到五倍。
            </div>
          </div>
        )}
        {UPGRADES.map((u) => {
          const lv = s.up[u.id];
          const max = lv >= u.values.length - 1;
          const cost = max ? 0 : u.costs[lv + 1];
          return (
            <div className="card" key={u.id}>
              <div className="row">
                <div className="ico">{u.icon}</div>
                <div className="grow">
                  <div className="name">
                    {u.name}
                    <span className="tag">Lv.{lv + 1}</span>
                    {u.id === 'line' && !max && <span className="tag green">⬆ 收入</span>}
                    {max && <span className="tag gold">满级</span>}
                  </div>
                  <div className="desc">{u.desc}</div>
                  {/* Lv.1 → Lv.2 左右对照：参考图里 iDiver 升级页的标志性组件 */}
                  <div className="lv-pair">
                    <div className="lv-box now">
                      <b>Lv.{lv + 1}</b>
                      <i>
                        {u.values[lv]}
                        {u.unit}
                      </i>
                    </div>
                    <span className="lv-arrow">➜</span>
                    <div className={`lv-box next${max ? ' max' : ''}`}>
                      <b>{max ? 'MAX' : `Lv.${lv + 2}`}</b>
                      <i>
                        {max ? '已拉满' : `${u.values[lv + 1]}${u.unit}`}
                      </i>
                    </div>
                    {!max && (
                      <div className="lv-cost">
                        <span className="mb-coin" />
                        {cost}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="pips">
                {u.values.map((_, i) => (
                  <i key={i} className={i <= lv ? 'on' : ''} />
                ))}
              </div>
              <button className="btn sm wide" style={{ marginTop: 9 }} disabled={max} onClick={() => buy(u.id, cost)}>
                {max ? '已满级' : `升级 · ${cost}`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ==================== 枪铺 ==================== */

export function GunApp({ s, update, notify, onBack }: AppProps) {
  const buyGun = (id: string, price: number) => {
    if (s.money < price) {
      sfx.bad();
      notify('大炮哥：兄弟，钱不够啊！多打几条鱼再来！');
      return;
    }
    sfx.cash();
    update((p) => ({ ...p, money: p.money - price, guns: [...p.guns, id], gun: id }));
  };
  const buyUp = (id: 'scope' | 'slowmo', cost: number) => {
    if (s.money < cost) {
      sfx.bad();
      notify('钱不够！');
      return;
    }
    sfx.cash();
    update((p) => ({ ...p, money: p.money - cost, up: { ...p.up, [id]: p.up[id] + 1 } as SaveState['up'] }));
  };
  return (
    <div>
      <AppBar title="大炮枪械铺" onBack={onBack} right={<Money v={s.money} />} />
      <div className="app-body">
        <div className="card" style={{ background: 'linear-gradient(150deg, rgba(239,68,68,.18), rgba(255,255,255,.02))' }}>
          <div className="row">
            <div className="ico">🧔</div>
            <div className="grow">
              <div className="name">大炮哥</div>
              <div className="desc">「打鱼不用枪，等于吃面不用筷子！加特林是我用洗衣机改的，顺便还能甩干衣服。」</div>
            </div>
          </div>
        </div>
        {WEAPONS.map((w) => {
          const owned = s.guns.includes(w.id);
          const eq = s.gun === w.id;
          return (
            <div className={`card${eq ? ' hi' : ''}`} key={w.id}>
              <div className="row">
                <div className="ico">{w.icon}</div>
                <div className="grow">
                  <div className="name">
                    {w.name}
                    {eq && <span className="tag gold">已装备</span>}
                  </div>
                  <div className="desc">{w.desc}</div>
                  {/* 属性表：参考图 Duff's 的武器详情是「标签 + 值」两列，不是一行文字 */}
                  <div className="stat-grid">
                    <span>伤害</span>
                    <b>
                      {w.dmg}
                      {w.pellets > 1 ? `×${w.pellets}` : ''}
                    </b>
                    <span>射速</span>
                    <b>{w.rate}/秒</b>
                    <span>模式</span>
                    <b>{w.auto ? '连射' : '点射'}</b>
                    {w.splash > 0 && (
                      <>
                        <span>爆炸</span>
                        <b>{w.splash}m</b>
                      </>
                    )}
                    {w.heat > 0 && (
                      <>
                        <span>过热</span>
                        <b className="warn">会</b>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <button
                className={`btn sm wide${owned ? ' ghost' : ''}`}
                style={{ marginTop: 9 }}
                disabled={eq}
                onClick={() => (owned ? update((p) => ({ ...p, gun: w.id })) : buyGun(w.id, w.price))}
              >
                {eq ? '✔ 已装备' : owned ? '装 备' : `购买 · $${w.price}`}
              </button>
            </div>
          );
        })}
        <div className="divider" />
        <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 6 }}>改装</div>
        {GUN_UPGRADES.map((u) => {
          const lv = s.up[u.id];
          const max = lv >= u.values.length - 1;
          const cost = max ? 0 : u.costs[lv + 1];
          return (
            <div className="card" key={u.id}>
              <div className="row">
                <div className="ico">{u.icon}</div>
                <div className="grow">
                  <div className="name">
                    {u.name} <span className="tag">Lv.{lv + 1}</span>
                  </div>
                  <div className="desc">{u.desc}</div>
                  <div className="val">
                    {u.label(u.values[lv])}
                    {!max && <span className="muted"> → {u.label(u.values[lv + 1])}</span>}
                  </div>
                </div>
                <button className="btn sm" disabled={max} onClick={() => buyUp(u.id, cost)}>
                  {max ? '满级' : `$${cost}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ==================== 航线 ==================== */

export function RouteApp({ s, update, notify, onBack }: AppProps) {
  const select = (m: MapId) => {
    sfx.click();
    update((p) => ({ ...p, map: m, hotFish: { ...p.hotFish, [m]: pickHotFish(m, p.hotFish[m]) } }));
    notify(`航线已切换：${MAPS[m].name}`);
  };
  return (
    <div>
      <AppBar title="航线" onBack={onBack} right={<Money v={s.money} />} />
      <div className="app-body">
        {(Object.keys(MAPS) as MapId[]).map((id) => {
          const m = MAPS[id];
          const unlocked = s.unlocked.includes(id);
          const cur = s.map === id;
          const ready = id === 'ice' ? canUnlockIce(s) : true;
          const bookable = id === 'ice' ? canBookIce(s) : true;
          return (
            <div className="map-card" key={id}>
              <div
                className="map-art"
                style={{
                  background:
                    id === 'bay'
                      ? 'linear-gradient(160deg, #7dd3fc, #0e7490 60%, #082f49)'
                      : 'linear-gradient(160deg, #123a52, #0b1030 55%, #020617)',
                }}
              >
                <div>
                  <div className="nm">
                    {m.emoji} {m.name}
                  </div>
                  <div className="sb">{m.subtitle}</div>
                </div>
                {!unlocked && <div className="lock">{bookable ? '🔒' : '❓'}</div>}
                {cur && <div className="tag green" style={{ position: 'absolute', top: 8, right: 8 }}>当前位置</div>}
              </div>
              <div className="map-body">
                <div className="d">{m.desc}</div>
                <div className="fx">
                  {m.mechanics.map((x) => (
                    <div key={x}>{x}</div>
                  ))}
                </div>
                {!unlocked && id === 'ice' && !bookable && (
                  <div className="muted small" style={{ marginTop: 8, lineHeight: 1.7 }}>
                    信号里有人提过「北边还有一片海」。再潜深一点，或者多认识几种鱼。
                  </div>
                )}
                {!unlocked && id === 'ice' && bookable && (
                  <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.9 }}>
                    <div style={{ color: s.maxDepth.bay >= UNLOCK_ICE.depth ? 'var(--green)' : 'var(--dim)' }}>
                      {s.maxDepth.bay >= UNLOCK_ICE.depth ? '✅' : '⬜'} 阳光湾下潜 {UNLOCK_ICE.depth}m（{s.maxDepth.bay}m）
                    </div>
                    <div style={{ color: speciesCount(s, 'bay') >= UNLOCK_ICE.species ? 'var(--green)' : 'var(--dim)' }}>
                      {speciesCount(s, 'bay') >= UNLOCK_ICE.species ? '✅' : '⬜'} 阳光湾图鉴 {UNLOCK_ICE.species} 种（{speciesCount(s, 'bay')}）
                    </div>
                    <div style={{ color: s.money >= m.ticket ? 'var(--green)' : 'var(--dim)' }}>
                      {s.money >= m.ticket ? '✅' : '⬜'} 船票 ${m.ticket}
                    </div>
                  </div>
                )}
                <div style={{ marginTop: 10 }}>
                  {unlocked ? (
                    <button className="btn sm wide ghost" disabled={cur} onClick={() => select(id)}>
                      {cur ? '✔ 正在此处钓鱼' : '⛵ 起航前往'}
                    </button>
                  ) : (
                    <button
                      className="btn sm wide"
                      disabled={!ready}
                      onClick={() => {
                        if (s.money < m.ticket) {
                          sfx.bad();
                          notify('船票钱不够！再多钓几次吧');
                          return;
                        }
                        sfx.cash();
                        update((p) => ({ ...p, money: p.money - m.ticket, unlocked: [...p.unlocked, id], map: id, hotFish: { ...p.hotFish, [id]: pickHotFish(id) } }));
                      }}
                    >
                      {ready ? `🎫 购买船票 · $${m.ticket}` : '条件未达成'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ==================== 帽子 ==================== */

export function HatApp({ s, update, notify, onBack }: AppProps) {
  useEffect(() => {
    update((p) => ({ ...p, unread: { ...p.unread, hat: 0 } }));
  }, [update]);
  return (
    <div>
      <AppBar title="帽子屋" onBack={onBack} right={<Money v={s.money} />} />
      <div className="app-body">
        <div className="card">
          <div className="desc" style={{ fontSize: 12 }}>
            🎩 店员：「钓鱼水平不够？帽子来凑！每顶帽子都带有神奇的（玄学）加成。」
          </div>
        </div>
        <div className="dex-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
          {HATS.filter((h) => !h.hidden || s.hats.includes(h.id)).map((h) => {
            const owned = s.hats.includes(h.id);
            const eq = s.hat === h.id;
            return (
              <div className={`dex-cell${eq ? '' : ''}`} key={h.id} style={{ padding: '10px 8px' }}>
                <div style={{ fontSize: 34 }}>{h.icon}</div>
                <div className="n">{h.name}</div>
                <div className="d" style={{ lineHeight: 1.5, minHeight: 30 }}>{h.effect}</div>
                <button
                  className="btn sm wide"
                  style={{ marginTop: 6 }}
                  disabled={eq}
                  onClick={() => {
                    if (owned) {
                      update((p) => ({ ...p, hat: h.id }));
                      sfx.click();
                    } else if (s.money >= h.price) {
                      sfx.cash();
                      update((p) => ({ ...p, money: p.money - h.price, hats: [...p.hats, h.id], hat: h.id }));
                    } else {
                      sfx.bad();
                      notify('钱不够买这顶帽子！');
                    }
                  }}
                >
                  {eq ? '戴着呢' : owned ? '戴上' : `$${h.price}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ==================== 档案 ==================== */

export function StatsApp({ s, onBack }: AppProps) {
  const ach = [
    { ok: s.trips >= 1, icon: '⛵', name: '初次出海', desc: '完成第一次钓鱼' },
    { ok: s.maxDepth.bay >= 100, icon: '🌊', name: '深海新人', desc: '阳光湾下潜 100 米' },
    { ok: Math.max(s.maxDepth.bay, s.maxDepth.ice) >= 300, icon: '🕳️', name: '深渊凝视者', desc: '任意海域下潜 300 米' },
    { ok: s.unlocked.includes('ice'), icon: '🧊', name: '冰海来客', desc: '解锁极光冰海' },
    { ok: s.bestCatch >= 20, icon: '🐟', name: '满载而归', desc: '一次钩到 20 条鱼' },
    { ok: s.bestCombo >= 8, icon: '🔥', name: '连击大师', desc: '空中打出 8 连' },
    { ok: s.bestTrip >= 1200, icon: '💰', name: '暴发户', desc: '单次出海赚 $1200' },
    { ok: s.jellyHits >= 5, icon: '🪼', name: '果冻杀手', desc: '累计打中 5 只水母（反面）' },
    { ok: speciesCount(s) >= 18, icon: '📖', name: '收藏家', desc: '收集 18 种鱼' },
    { ok: s.bottles.length >= BOTTLES.length, icon: '🍾', name: '瓶中信', desc: '找到全部漂流瓶' },
    { ok: s.guns.length >= 4, icon: '🔫', name: '军火商之友', desc: '拥有 4 把枪' },
    { ok: s.legend, icon: '👑', name: '鱼王终结者', desc: '击落传说中的鱼王' },
  ];
  const rows: [string, string][] = [
    ['出海次数', `${s.trips} 次`],
    ['累计收入', `$${s.totalEarned.toLocaleString()}`],
    ['单次最高收入', `$${s.bestTrip.toLocaleString()}`],
    ['单次最多上钩', `${s.bestCatch} 条`],
    ['最高连杀', `${s.bestCombo} 连`],
    ['阳光湾最深', `${s.maxDepth.bay} m`],
    ['极光冰海最深', `${s.maxDepth.ice} m`],
    ['图鉴收集', `${speciesCount(s)}/${SPECIES.filter((x) => x.special !== 'jelly').length}`],
  ];
  return (
    <div>
      <AppBar title="渔夫档案" onBack={onBack} />
      <div className="app-body">
        <div className="card hi">
          <div className="row">
            <div style={{ fontSize: 44 }}>🧑</div>
            <div className="grow">
              <div className="name" style={{ fontSize: 16 }}>阿渔</div>
              <div className="desc">
                海大海之孙 · {s.legend ? '传奇渔夫' : s.unlocked.includes('ice') ? '冰海探险家' : s.trips > 5 ? '阳光湾熟手' : '钓鱼萌新'}
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          {rows.map(([k, v]) => (
            <div className="kv" key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--dim)', margin: '10px 0 6px' }}>成就 {ach.filter((a) => a.ok).length}/{ach.length}</div>
        <div className="ach">
          {ach.map((a) => (
            <div className={`a${a.ok ? ' on' : ''}`} key={a.name}>
              <div className="ic">{a.ok ? a.icon : '🔒'}</div>
              <b>{a.name}</b>
              {a.desc}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ==================== 通知栏 ==================== */

type NotifyRow =
  | { kind: 'notice'; id: string; title: string; text: string; trip: number; system: boolean }
  | { kind: 'call'; id: string; from: CharId; topic: string; trip: number }
  | { kind: 'sms'; id: string; from: CharId; text: string; trip: number };

/**
 * 手机通知栏：岛上闪过的公告、漏接的电话、新短信都会在这里留档。
 * 岛是「提醒」，这里才是「回看」——点短信/未接来电直接进对应会话。
 */
export function NotifyApp({
  s,
  update,
  onBack,
  focus,
  onJump,
}: {
  s: SaveState;
  update: (fn: (s: SaveState) => SaveState) => void;
  onBack: () => void;
  focus?: string | null;
  onJump: (app: 'sms', thread?: CharId) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(focus ?? null);

  const rows = useMemo(() => {
    const list: NotifyRow[] = [];
    for (const n of s.notices) {
      list.push({ kind: 'notice', id: n.id, title: n.title, text: n.text, trip: n.trip, system: n.kind === 'system' });
    }
    for (const c of s.calls) {
      if (c.missed) list.push({ kind: 'call', id: c.id, from: c.from, topic: c.topic, trip: c.trip });
    }
    for (const m of s.messages) {
      list.push({ kind: 'sms', id: m.id, from: m.thread, text: m.text, trip: m.trip });
    }
    // 越新越靠上；同一趟里保持写入顺序（稳定排序）
    return list.sort((a, b) => b.trip - a.trip);
  }, [s.notices, s.calls, s.messages]);

  const markAllRead = () => {
    sfx.click();
    update((prev) => ({ ...prev, unread: {}, unreadKey: {} }));
  };
  const clearNotices = () => {
    sfx.click();
    // 只清公告 / 系统通知；短信和通话记录是剧情，不能在这里删
    update((prev) => ({ ...prev, notices: [] }));
  };

  return (
    <div>
      <AppBar title="通知" onBack={onBack} right={<span className="tag">{rows.length} 条</span>} />
      <div className="app-body">
        <div className="ntf-tools">
          <button className="mini-btn" onClick={markAllRead}>
            ✓ 全部已读
          </button>
          <button className="mini-btn" onClick={clearNotices} disabled={s.notices.length === 0}>
            清空通知
          </button>
        </div>
        {rows.length === 0 && <div className="muted small">还没有通知。出海一趟，这里就会热闹起来。</div>}
        <div className="notify-list">
          {rows.map((r) => {
            if (r.kind === 'call') {
              return (
                <button
                  key={r.id}
                  className="ntf kind-call"
                  onClick={() => {
                    sfx.click();
                    onJump('sms', r.from);
                  }}
                >
                  <span className="ntf-ic">📵</span>
                  <span className="ntf-t">
                    {CHARS[r.from].name}
                    <i>未接来电</i>
                  </span>
                  <span className="ntf-b">{r.topic}</span>
                </button>
              );
            }
            if (r.kind === 'sms') {
              return (
                <button
                  key={r.id}
                  className="ntf kind-sms"
                  onClick={() => {
                    sfx.click();
                    onJump('sms', r.from);
                  }}
                >
                  <span className="ntf-ic">💬</span>
                  <span className="ntf-t">
                    {CHARS[r.from].name}
                    <i>新消息</i>
                  </span>
                  <span className="ntf-b">{r.text}</span>
                </button>
              );
            }
            const open = openId === r.id;
            return (
              <button
                key={r.id}
                className={`ntf kind-notice${open ? ' on' : ''}${r.system ? ' kind-sys' : ''}`}
                onClick={() => {
                  sfx.click();
                  setOpenId(open ? null : r.id);
                }}
              >
                <span className="ntf-ic">{r.system ? '📲' : '📢'}</span>
                <span className="ntf-t">
                  {r.title}
                  <i>{r.system ? '系统通知' : '公告'}</i>
                </span>
                <span className={`ntf-b${open ? ' full' : ''}`}>{r.text}</span>
              </button>
            );
          })}
        </div>
        <div className="phone-note" style={{ marginTop: 12 }}>
          <b>💡 小提示</b>
          <br />
          点公告展开全文；点消息或未接来电直接进对应的短信会话。
        </div>
      </div>
    </div>
  );
}

/* ==================== 设置 ==================== */

export function SettingsApp({ s, update, notify, onBack, setQuality }: AppProps) {
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <AppBar title="设置" onBack={onBack} />
      <div className="app-body">
        <div className="card">
          <div className="kv">
            <span>🔊 音效</span>
            <button className={`tog${s.sound ? ' on' : ''}`} onClick={() => update((p) => ({ ...p, sound: !p.sound }))}>
              {s.sound ? '开启' : '关闭'}
            </button>
          </div>
          <div className="kv">
            <span>📳 触觉反馈</span>
            <button className={`tog${s.haptics ? ' on' : ''}`} onClick={() => update((p) => ({ ...p, haptics: !p.haptics }))}>
              {s.haptics ? '开启' : '关闭'}
            </button>
          </div>
          <div className="kv" style={{ alignItems: 'center' }}>
            <span>🎨 画质</span>
            <div className="seg">
              {(['low', 'mid', 'high'] as Quality[]).map((q) => (
                <button
                  key={q}
                  className={s.quality === q ? 'on' : ''}
                  onClick={() => {
                    update((p) => ({ ...p, quality: q }));
                    setQuality(q);
                  }}
                >
                  {q === 'low' ? '流畅' : q === 'mid' ? '均衡' : '精美'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="name">🎮 操作说明</div>
          <div className="desc" style={{ marginTop: 6, lineHeight: 1.9 }}>
            · 下潜：左右拖动控制鱼钩，躲开鱼。撞到鱼会立刻结束下潜
            <br />· 收线：主动去撞鱼，尽量装满鱼钩（容量有上限）
            <br />· 射击：鱼飞上天后点它们开枪；没打死会被打得更高
            <br />· 连杀：1.6 秒内连续击杀会叠加倍率，最高 ×2.5
            <br />· 长按「收线」可提前结束下潜，保住已钩的鱼
          </div>
        </div>

        <div className="card">
          <div className="name">💾 存档</div>
          <div className="desc">当前版本 v2 · 自动保存到本机</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button
              className="btn sm ghost"
              style={{ flex: 1 }}
              onClick={() => {
                const blob = new Blob([exportSave(s)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `absurd-fishing-save-${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
                notify('存档已导出');
              }}
            >
              导出
            </button>
            <button className="btn sm ghost" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
              导入
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const text = await f.text();
                const next = importSave(text);
                if (!next) {
                  notify('存档格式不对');
                  return;
                }
                update(() => next);
                notify('存档已导入');
              }}
            />
          </div>
        </div>

        <div className="card">
          <div className="name" style={{ color: 'var(--red)' }}>🗑️ 重置进度</div>
          <div className="desc">删除本机所有进度与剧情记录，不可撤销。</div>
          {!confirm ? (
            <button className="btn sm ghost wide" style={{ marginTop: 8 }} onClick={() => setConfirm(true)}>
              删除所有进度
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button
                className="btn sm danger"
                style={{ flex: 1 }}
                onClick={() => {
                  clearSave();
                  location.reload();
                }}
              >
                确定删除
              </button>
              <button className="btn sm ghost" style={{ flex: 1 }} onClick={() => setConfirm(false)}>
                取消
              </button>
            </div>
          )}
        </div>

        <div className="small muted" style={{ textAlign: 'center', lineHeight: 1.9, marginTop: 12 }}>
          荒唐钓鱼 · 深海重制版 v2.0
          <br />
          Canvas 2D 矢量绘制 · 无外部素材
          <br />
          致敬 Ridiculous Fishing（Vlambeer）
        </div>
      </div>
    </div>
  );
}

export const APP_META: { id: string; name: string; icon: string; bg: string }[] = [
  { id: 'sms', name: '短信', icon: '💬', bg: 'linear-gradient(150deg,#4ade80,#15803d)' },
  { id: 'calls', name: '电话', icon: '📞', bg: 'linear-gradient(150deg,#67e8f9,#0e7490)' },
  { id: 'feed', name: '鱼博', icon: '🐦', bg: 'linear-gradient(150deg,#fdba74,#c2410c)' },
  { id: 'story', name: '剧情', icon: '🎬', bg: 'linear-gradient(150deg,#a78bfa,#4c1d95)' },
  { id: 'dex', name: '鱼鉴', icon: '📖', bg: 'linear-gradient(150deg,#c4b5fd,#6d28d9)' },
  { id: 'tackle', name: '渔具', icon: '🎣', bg: 'linear-gradient(150deg,#6ee7b7,#047857)' },
  { id: 'guns', name: '枪铺', icon: '🔫', bg: 'linear-gradient(150deg,#fca5a5,#b91c1c)' },
  { id: 'route', name: '航线', icon: '🧭', bg: 'linear-gradient(150deg,#7dd3fc,#0369a1)' },
  { id: 'hat', name: '帽子', icon: '🎩', bg: 'linear-gradient(150deg,#f9a8d4,#be185d)' },
  { id: 'stats', name: '档案', icon: '🏆', bg: 'linear-gradient(150deg,#fde047,#a16207)' },
  { id: 'settings', name: '设置', icon: '⚙️', bg: 'linear-gradient(150deg,#cbd5e1,#475569)' },
];
