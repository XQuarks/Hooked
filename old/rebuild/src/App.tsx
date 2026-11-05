import { useCallback, useEffect, useRef, useState } from 'react';
import './styles.css';
import { Engine, HudState, TripResult } from './game/engine';
import { MAPS, SPECIES, rollWeather, type WeatherId } from './game/data';
import { appUnlocked, loadSave, logCall, persist, pickHotFish, speciesCount, weatherOf, type AppKey, type CharId, type Msg, type Quality, type QueueItem, type SaveState } from './game/state';
import { CALLBACKS, bottleById, runStory } from './game/story';
import { setSound, sfx, unlockAudio } from './game/audio';
import { badgeKeyCount, badgeTotal, tripConfig } from './game/helpers';
import { Hud } from './ui/Hud';
import { Title } from './ui/Title';
import { Phone, AppId } from './ui/Phone';
import { APP_META } from './ui/apps';
import { ResultSheet, StoryOverlay } from './ui/Story';
import { Island, IslandItem } from './ui/Island';
import { Money, PhoneFab } from './ui/common';

const BRAGS = ['大炮哥的枪就是好使！', '凯文你看到了吗？', '爷爷，我会找到你的！', '今晚加餐！', '海鸥别想偷我的鱼。'];

const HINTS: Record<string, string> = {
  descent: '按住左右拖动移动鱼钩 · 撞到鱼会结束下潜',
  shoot: '点鱼开枪 · 1.6 秒内连杀可叠加倍率',
  ascent: '收线了：现在反过来，主动去撞鱼把它钩上来',
  nearFish: '⚠️ 撞到鱼会结束下潜，左右躲开',
  full: '鱼钩满了 · 会自动全速上浮',
  heat: '连射会让枪管过热 · 松开一会儿降温',
  combo: '连杀倍率最高 ×2.5 · 尽量打同屏的鱼',
  abort: '长按右下角「收线」可提前结束下潜，保住已钩的鱼',
};

const INIT_HUD: HudState = {
  phase: 'idle',
  depth: 0,
  maxDepth: 0,
  hooked: 0,
  cap: 0,
  saw: 0,
  combo: 0,
  mult: 1,
  heat: 0,
  overheated: false,
  estimate: 0,
  band: MAPS.bay.bands[0].name,
  airLeft: 0,
  airValue: 0,
  gross: 0,
  lamp: 0,
  dark: false,
  abort: 0,
};

export default function App() {
  const [save, setSave] = useState<SaveState>(() => runStory(loadSave()));
  const saveRef = useRef(save);
  saveRef.current = save;

  const [ready, setReady] = useState(false);
  const [gpuError, setGpuError] = useState(false);
  const [title, setTitle] = useState(true);
  const [hud, setHud] = useState<HudState>(INIT_HUD);
  const [result, setResult] = useState<{ r: TripResult; newSpecies: string[]; record: boolean } | null>(null);
  const [phone, setPhone] = useState<{ open: boolean; app: AppId | null; focus?: string }>({ open: false, app: null });
  const [banner, setBanner] = useState<{ text: string; sub?: string; color?: string; id: number } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [splash, setSplash] = useState(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const bannerT = useRef(0);
  const hintT = useRef(0);
  const noteT = useRef(0);
  const [newMsgs, setNewMsgs] = useState<Msg[]>([]);
  // 灵动岛队列：call/notice 来自剧情队列，sms 来自新消息
  const [island, setIsland] = useState<IslandItem[]>([]);
  // 岛上的来电是否处于「展开等接听」状态：只有这时左下角的手机才震动
  const [islandExpanded, setIslandExpanded] = useState(false);
  const [activeStory, setActiveStory] = useState<QueueItem | null>(null);
  const islandMsgLen = useRef(save.messages.length);
  const islandDropped = useRef<Set<string>>(new Set());
  const preTripMsgLen = useRef(0);

  const update = useCallback((fn: (s: SaveState) => SaveState) => {
    setSave((prev) => runStory(fn(prev)));
  }, []);

  const notify = useCallback((text: string) => {
    setNote(text);
    window.clearTimeout(noteT.current);
    noteT.current = window.setTimeout(() => setNote(null), 2200);
  }, []);

  const showHint = useCallback((key: string, text: string) => {
    if (saveRef.current.hints[key]) return;
    setHint(text);
    update((s) => ({ ...s, hints: { ...s.hints, [key]: true } }));
    window.clearTimeout(hintT.current);
    hintT.current = window.setTimeout(() => setHint(null), 5600);
  }, [update]);

  // ---------- 持久化 & 音效 ----------
  useEffect(() => {
    persist(save);
  }, [save]);
  useEffect(() => {
    setSound(save.sound);
  }, [save.sound]);

  // 结算页的「本局新消息」：用局前的消息长度做 diff
  useEffect(() => {
    if (!result) {
      setNewMsgs([]);
      return;
    }
    setNewMsgs(save.messages.slice(preTripMsgLen.current));
  }, [result, save.messages.length]);

  // ---------- 灵动岛：剧情来电/公告 + 新短信 ----------
  useEffect(() => {
    setIsland((prev) => {
      const have = new Set(prev.map((x) => x.uid));
      const add: IslandItem[] = [];
      for (const q of save.queue) {
        if (!q.uid || have.has(q.uid) || islandDropped.current.has(q.uid)) continue;
        if (q.kind === 'call')
          add.push({ uid: q.uid, kind: 'call', from: q.from, lines: q.lines, force: q.force, topic: q.topic });
        else if (q.kind === 'notice') add.push({ uid: q.uid, kind: 'notice', title: q.title, text: q.text });
      }
      if (!add.length) return prev;
      // 来电插队：强剧情永远优先出现在岛上
      const calls = add.filter((x) => x.kind === 'call');
      const rest = add.filter((x) => x.kind !== 'call');
      return calls.length ? [...calls, ...prev, ...rest] : [...prev, ...rest];
    });
  }, [save.queue]);

  useEffect(() => {
    const n = save.messages.length;
    if (n <= islandMsgLen.current) {
      islandMsgLen.current = n;
      return;
    }
    const added = save.messages.slice(islandMsgLen.current).filter((m) => m.thread !== 'bottle');
    islandMsgLen.current = n;
    if (!added.length) return;
    sfx.pop();
    // 一次来一串也不丢：按「主线优先」排好队，一条一条亮完
    const pick = [...added].sort((a, b) => (b.key ? 1 : 0) - (a.key ? 1 : 0)).slice(0, 5);
    setIsland((prev) => [
      ...prev,
      ...pick.map((m, i) => ({
        uid: 'msg_' + m.id,
        kind: 'sms' as const,
        from: m.thread,
        text: m.text,
        key: m.key,
        // 每条至少留 26 秒排队窗口：被来电或前面的短信挡住时，轮到时还能看到
        expireAt: Date.now() + 26000 + i * 5000,
      })),
    ]);
  }, [save.messages.length]);

  // 新 App 解锁：岛上闪一条系统通知（首次挂载不刷一遍历史解锁）
  const unlockedRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const now = new Set(APP_META.filter((a) => appUnlocked(save, a.id as AppKey)).map((a) => a.id));
    const prev = unlockedRef.current;
    unlockedRef.current = now;
    if (!prev) return;
    const fresh = [...now].filter((id) => !prev.has(id));
    if (!fresh.length) return;
    const metaOf = (id: string) => APP_META.find((a) => a.id === id);
    // 一次解锁多个（第 1 趟会同时开鱼博 + 渔具）只弹一条，别连着刷两条
    const names = fresh.map((id) => metaOf(id)?.name ?? id);
    setIsland((list) => [
      ...list,
      {
        uid: fresh.length === 1 ? 'app_' + fresh[0] : 'app_batch_' + fresh.slice().sort().join('_'),
        kind: 'notice' as const,
        title: `新应用${fresh.length > 1 ? ` ×${fresh.length}` : ''}：${names.join('、')}`,
        text: fresh.length > 1 ? '主屏幕上多了几个图标，点开看看' : '回到手机主屏幕看看',
        system: true,
      },
    ]);
    // 也写进手机通知栏，错过岛上的那一下还能回看
    update((s) => {
      const add = fresh.filter((id) => !s.notices.some((n) => n.id === 'sys_' + id));
      if (!add.length) return s;
      return {
        ...s,
        notices: [
          ...s.notices,
          ...add.map((id) => ({
            id: 'sys_' + id,
            title: `新应用：${metaOf(id)?.name ?? id}`,
            text: '手机主屏幕上多了一个图标，点开看看。',
            trip: s.trips,
            kind: 'system' as const,
          })),
        ],
      };
    });
  }, [save.trips, save.maxDepth.bay]);

  // 过期短信自动丢弃：有来电占位时，弱消息不会把队列堵死
  useEffect(() => {
    const t = window.setInterval(() => {
      setIsland((prev) => {
        const now = Date.now();
        const next = prev.filter((x) => !(x.kind === 'sms' && x.expireAt && x.expireAt < now));
        return next.length === prev.length ? prev : next;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  // ---------- 引擎 ----------
  const endRef = useRef<(r: TripResult) => void>(() => {});
  const hudRef = useRef<(h: HudState) => void>(() => {});
  const bannerRef = useRef<(b: { text: string; sub?: string; color?: string }) => void>(() => {});
  const hintRef = useRef<(k: string) => void>(() => {});
  const weatherRef = useRef<(w: WeatherId) => void>(() => {});

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    let engine: Engine | null = null;
    try {
      engine = new Engine(el, {
        quality: saveRef.current.quality,
        onHud: (h) => hudRef.current(h),
        onEnd: (r) => endRef.current(r),
        onBanner: (b) => bannerRef.current(b),
        onHint: (k) => hintRef.current(k),
        onSplash: () => setSplash(Date.now()),
        onWeather: (w) => weatherRef.current(w),
      });
      engine.setScene({
        map: saveRef.current.map,
        hat: saveRef.current.hat,
        legend: saveRef.current.legend,
        weather: weatherOf(saveRef.current),
      });
      engineRef.current = engine;
      if (window.location.hash.includes('debug')) (window as unknown as { __af?: Engine }).__af = engine;
      setReady(true);
    } catch (err) {
      console.error(err);
      setGpuError(true);
    }
    return () => {
      engine?.destroy();
      engineRef.current = null;
    };
  }, []);

  // 天气 / 地图 / 帽子变化后同步给渲染层（换图时 setScene 会重建世界）
  useEffect(() => {
    engineRef.current?.setScene({
      map: save.map,
      hat: save.hat,
      legend: save.legend,
      weather: weatherOf(save),
    });
  }, [save.map, save.hat, save.legend, save.weather]);

  // 局内变天：引擎在下一潜途中换了天气，这里写回存档（回岸后保持）
  weatherRef.current = (w) => update((s) => ({ ...s, weather: w }));

  hudRef.current = (h) => {
    setHud(h);
    if (h.phase === 'ascent' && h.cap > 0 && h.hooked >= h.cap) showHint('full', HINTS.full);
    if (h.heat > 0.55) showHint('heat', HINTS.heat);
    if (h.combo >= 3) showHint('combo', HINTS.combo);
  };

  bannerRef.current = (b) => {
    setBanner({ ...b, id: Date.now() });
    window.clearTimeout(bannerT.current);
    bannerT.current = window.setTimeout(() => setBanner(null), 1900);
    if (saveRef.current.haptics && navigator.vibrate) {
      if (b.text.includes('咬钩')) navigator.vibrate(40);
      else if (b.text.includes('鱼王')) navigator.vibrate([30, 40, 60]);
    }
  };

  hintRef.current = (k) => {
    if (k === 'descent') showHint('descent', HINTS.descent);
    if (k === 'shoot') showHint('shoot', HINTS.shoot);
    if (k === 'ascent') showHint('ascent', HINTS.ascent);
    if (k === 'nearFish') showHint('nearFish', HINTS.nearFish);
  };

  endRef.current = (r) => {
    const prev = saveRef.current;
    // sky_* 是天空目标的击杀，不是鱼种：不能进图鉴，也不能算「新鱼」
    const newSpecies = Object.keys(r.kills).filter(
      (id) => !id.startsWith('sky_') && (prev.caught[id] || 0) === 0 && r.kills[id] > 0,
    );
    const record = prev.trips > 0 && r.earned > prev.bestTrip;
    preTripMsgLen.current = prev.messages.length;
    setResult({ r, newSpecies, record });
    if (r.earned > 0) sfx.cash();
    else sfx.bad();
    if (prev.haptics && navigator.vibrate && r.legend) navigator.vibrate([40, 60, 80, 60, 120]);

    setSave((s) => {
      const caught = { ...s.caught };
      for (const [k, n] of Object.entries(r.kills)) {
        if (k.startsWith('sky_')) continue;
        caught[k] = (caught[k] || 0) + n;
      }
      const messages = [...s.messages];
      const bottles = [...s.bottles];
      const queue = [...s.queue];
      const unread = { ...s.unread };
      const feed = [...s.feed];
      for (const b of r.bottles) {
        if (bottles.includes(b)) continue;
        bottles.push(b);
        const bd = bottleById(b);
        if (bd) {
          messages.push({ id: 'bottle_' + b, thread: 'bottle', text: bd.text, trip: s.trips + 1 });
          unread.sms = (unread.sms || 0) + 1;
        }
        queue.push({ kind: 'bottle', id: b });
      }
      if (record && r.earned >= 200) {
        feed.push({
          id: 'me' + Date.now(),
          author: 'me',
          text: `新纪录！在${MAPS[r.map].name}一趟赚了 $${r.earned}。${BRAGS[Math.floor(Math.random() * BRAGS.length)]}`,
          likes: Math.floor(10 + Math.random() * 300),
          trip: s.trips + 1,
        });
        unread.feed = (unread.feed || 0) + 1;
      }
      return runStory({
        ...s,
        money: Math.max(0, s.money + r.earned),
        totalEarned: s.totalEarned + Math.max(0, r.gross),
        trips: s.trips + 1,
        caught,
        maxDepth: { ...s.maxDepth, [r.map]: Math.max(s.maxDepth[r.map], r.depth) },
        bestTrip: Math.max(s.bestTrip, r.earned),
        bestCatch: Math.max(s.bestCatch, r.hooked),
        bestCombo: Math.max(s.bestCombo, r.maxCombo),
        bottles,
        messages,
        queue,
        unread,
        feed,
        jellyHits: s.jellyHits + r.jellyHits,
        legend: s.legend || r.legend,
        // 每趟回来换一次天气：58% 概率变天，让下一局有新鲜感
        weather: rollWeather(r.map, s.weather),
        hotFish: { ...s.hotFish, [r.map]: pickHotFish(r.map, s.hotFish[r.map]) },
      });
    });
  };

  // ---------- 操作 ----------
  /** 从标题页进入游戏：先进到船边，序章播完再由玩家点击下钩 */
  const enterGame = () => {
    unlockAudio();
    sfx.click();
    setTitle(false);
    setPhone({ open: false, app: null });
    setPaused(false);
  };

  const startTrip = () => {
    const e = engineRef.current;
    if (!e) return;
    if (forcedCall) return; // 强剧情插进来时，先接电话
    unlockAudio();
    sfx.click();
    setTitle(false);
    setPhone({ open: false, app: null });
    setPaused(false);
    e.setPaused(false);
    e.startTrip(tripConfig(saveRef.current));
  };

  /** idle 状态点屏幕任意处即可下钩（按钮/浮层自己处理点击，不抢） */
  const tapToCast = (e: React.PointerEvent) => {
    unlockAudio();
    if (!ready || title || paused || result || phone.open) return;
    if (forcedCall) return; // 强制来电时，点哪里都只能是接电话
    if (hud.phase !== 'idle') return;
    // 只有「阅读型」弹层挡出海；公告/短信留在队列里也走灵动岛，不该拦住下钩
    if (save.queue.some((x) => x.kind === 'comic' || x.kind === 'bottle')) return;
    const el = e.target as HTMLElement;
    // `.island` 是 div，不在 button 选择器里——漏掉它会导致「点通知=开始钓鱼」
    if (el.closest('button, a, input, .island, .phone, .sheet, .sheet-mask, .comic, .notice, .call, .title')) return;
    startTrip();
  };

  const setQuality = (q: Quality) => {
    update((s) => ({ ...s, quality: q }));
    engineRef.current?.setQuality(q);
  };

  /** 从电话 App 回拨一通：直接弹通话浮层，不经过剧情队列，也不写新的通话记录 */
  const startCallBack = (from: CharId, topic: string) => {
    if (hud.phase !== 'idle' || forcedCall) return;
    const lines = CALLBACKS[from] ?? [{ text: '（拨号中……）' }, { text: '（无人接听。）' }];
    sfx.click();
    // 只冻结引擎，不弹暂停面板 —— 面板的 z-index 比通话浮层高，会把电话盖住
    engineRef.current?.setPaused(true);
    setActiveStory({
      kind: 'call',
      uid: 'cb_' + Date.now(),
      from,
      topic: '回拨 · ' + topic,
      lines,
      callback: true,
    });
    // 打过电话了，这个人的未接记录就算接上了
    update((s) => ({ ...s, calls: s.calls.map((c) => (c.from === from ? { ...c, missed: false } : c)) }));
  };

  const openPhone = (app: AppId | null = null, focus?: string) => {
    if (hud.phase !== 'idle') return;
    if (forcedCall) return; // 强制来电优先，手机先别开
    sfx.click();
    setPhone({ open: true, app, focus });
  };

  // 全屏只留给漫画和漂流瓶；来电/公告交给灵动岛
  const q = (() => {
    if (result || phone.open || title || paused || hud.phase !== 'idle') return undefined;
    return save.queue.find((x) => x.kind === 'comic' || x.kind === 'bottle');
  })();

  const islandItem = (() => {
    // 一开始钓鱼就把手机通知收起来：下潜/收线/射击都需要看画面
    if (hud.phase !== 'idle') return null;
    // 全屏阅读（漫画/信）和通话进行中时，岛让位——避免两个层叠在一起
    if (result || phone.open || title || q || activeStory) return null;
    // 优先级：来电（常驻）> 短信（短闪）> 公告。
    // 短信必须能压过已收起的公告，否则永远轮不到它亮那 4 秒。
    const call = island.find((x) => x.kind === 'call');
    if (call) return call;
    const sms = island.find((x) => x.kind === 'sms');
    if (sms) return sms;
    // 「新应用解锁」是系统通知，别被一条剧情公告压到最后
    const appNote = island.find((x) => x.kind === 'notice' && x.uid.startsWith('app_'));
    if (appNote) return appNote;
    return island[0] ?? null;
  })();

  // 来电卡片展开等接听时，左下角的手机会震动——这时点手机就是接听，而不是打开手机界面
  const callToAnswer = islandItem?.kind === 'call' && islandExpanded ? islandItem : null;
  // 被手机/结算/出海挡住时，岛不卸载，只隐藏：计时暂停、收起状态保留，
  // 否则每次回到岸边都会重新弹一遍「新应用：鱼博」。
  const lastIsland = useRef<IslandItem | null>(null);
  if (islandItem) lastIsland.current = islandItem;
  const islandShow =
    islandItem ??
    (lastIsland.current && island.some((x) => x.uid === lastIsland.current?.uid) ? lastIsland.current : null);

  /** 强制来电：除了岛上的「接听」，其他 UI 全部让位 */
  const forcedCall = islandItem?.kind === 'call' && islandItem.force ? islandItem : null;
  const forcedUid = forcedCall?.uid ?? '';

  // 强制来电期间冻结玩法，并关掉暂停面板（暂停面板本身也属于「要被隐藏的 UI」）
  useEffect(() => {
    if (!forcedUid) return;
    setPaused(false);
    engineRef.current?.setPaused(true);
  }, [forcedUid]);

  /**
   * 从岛上接听来电。
   * 注意：**不在这里删队列**——万一玩家通话中途关掉游戏，
   * 回来时这通电话还在队列里，强制来电会重新出现（而不是凭空消失）。
   * 真正的清除放在通话结束的 onDone。
   */
  const openStory = (uid: string) => {
    const it = save.queue.find((x) => x.uid === uid);
    setIsland((p) => p.filter((x) => x.uid !== uid));
    if (!it) return;
    engineRef.current?.setPaused(true);
    setActiveStory(it);
  };

  /** 点岛上的公告：进手机的通知栏（而不是全屏纸片） */
  const openNotice = (uid: string) => {
    const it = save.queue.find((x) => x.uid === uid);
    // 「新应用解锁」是系统通知，本来就不在剧情队列里——以前这里直接 return，
    // 所以收到胶囊后怎么点都没反应。
    const isApp = uid.startsWith('app_');
    if (!isApp && (!it || it.kind !== 'notice')) return;
    sfx.click();
    setIsland((p) => p.filter((x) => x.uid !== uid));
    islandDropped.current.add(uid);
    if (it && it.kind === 'notice') {
      update((s) => ({ ...s, queue: s.queue.filter((x) => x.uid !== uid) }));
    }
    // 系统通知在通知栏里的存档 id 是 sys_<appId>
    const focus = isApp ? (uid.startsWith('app_batch') ? undefined : `sys_${uid.slice(4)}`) : uid;
    if (hud.phase === 'idle' && !title) {
      setPhone({ open: true, app: 'notify', focus });
    } else {
      notify('已收进手机通知栏，回岸再看');
    }
  };
  // 手机图标：有主线消息才显示数字，只有普通消息时显示一个小点
  const badge = badgeKeyCount(save);
  const badgeAny = badgeTotal(save) > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !title && !result && !phone.open && !forcedUid) {
        const next = !paused;
        setPaused(next);
        engineRef.current?.setPaused(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [title, result, phone.open, paused, forcedUid]);

  useEffect(() => {
    const onVis = () => {
      if (!document.hidden || title) return;
      // 强制来电本来就把画面冻住了；再叠一个暂停面板会把它盖掉。
      // 切后台再回来，仍然是「等待接听」的样子。
      if (island.some((x) => x.kind === 'call' && x.force)) return;
      setPaused(true);
      engineRef.current?.setPaused(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [title, island]);

  // 调试用：暴露岛队列，方便自动化脚本核对「谁在排队」
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash.includes('debug')) {
      (window as unknown as { __island?: unknown }).__island = island;
    }
  }, [island]);

  return (
    <div className="app">
      <aside className="side">
        <h1>
          荒唐钓鱼<span>.</span>
        </h1>
        <div className="sub">DEEP SEA REMASTER</div>
        <div className="panel">
          <b>🎮 怎么玩</b>
          ① 下潜：左右移动，躲开鱼；撞到就结束下潜
          <br />② 收线：主动撞鱼，装满鱼钩
          <br />③ 射击：鱼飞上天，点它们开枪
          <br />
          <span style={{ color: '#ff9ad5' }}>⚠ 别打水母（罚款按收入比例）</span>
        </div>
        <div className="panel">
          <b>🌊 光影</b>
          Canvas 2D 矢量绘制：分层视差、体积光柱、焦散光斑、随深度变化的雾。
          <br />
          画质可在标题页或设置里切换。
        </div>
        <div className="panel">
          <b>📊 进度</b>
          出海 {save.trips} 次 · 图鉴 {speciesCount(save)}/{SPECIES.filter((x) => x.special !== 'jelly').length}
          <br />
          阳光湾 {save.maxDepth.bay}m · 冰海 {save.unlocked.includes('ice') ? `${save.maxDepth.ice}m` : '🔒'}
          <br />
          钱包 <Money v={save.money} />
          <div className="meter">
            <i style={{ width: `${Math.min(100, (save.maxDepth.bay / 400) * 100)}%` }} />
          </div>
        </div>
        <div className="panel">
          <b>⌨️ 键盘</b>
          <span className="kbd">←</span> <span className="kbd">→</span> 移动 · <span className="kbd">空格</span> 开枪 · <span className="kbd">Esc</span> 暂停
        </div>
        <footer>单文件构建 · 无外部请求 · 致敬 Ridiculous Fishing</footer>
      </aside>

      <div className="stage" ref={stageRef} onPointerDown={tapToCast}>
        <div className="viewport" ref={mountRef} />
        {splash > 0 && <div className="splash-flash" key={splash} />}

        {ready && !title && !forcedCall && (
          // 开手机时 HUD 先让位：淡出 + 轻微上移，然后手机才从下面升起来
          <div className={`hud-shell${phone.open ? ' gone' : ''}`}>
            <Hud
              hud={hud}
              save={save}
              badge={badge}
              badgeAny={badgeAny}
              ringing={!!callToAnswer}
              onPause={() => {
                setPaused(true);
                engineRef.current?.setPaused(true);
              }}
              onAbortDown={(v) => engineRef.current?.setAbortDown(v)}
              onPhone={() => {
                if (callToAnswer) {
                  openStory(callToAnswer.uid);
                  return;
                }
                openPhone(null);
              }}
            />
          </div>
        )}

        {/* 热门鱼已移到顶部 HUD，避免和岸边目标条打架 */}

        {!forcedCall && banner && (
          <div className="banner" key={banner.id}>
            <div className="t" style={{ color: banner.color ?? '#fff' }}>
              {banner.text}
            </div>
            {banner.sub && <div className="s">{banner.sub}</div>}
          </div>
        )}

        {!forcedCall && hint && <div className="hintbar">{hint}</div>}
        {!forcedCall && note && (
          <div className="hintbar" style={{ bottom: 150, background: 'rgba(255,212,121,.92)', color: '#291a04' }}>
            {note}
          </div>
        )}

        {title && <Title save={save} quality={save.quality} setQuality={setQuality} onStart={enterGame} />}

        {title && (
          <PhoneFab
            badge={badge}
            badgeAny={badgeAny}
            onClick={() => openPhone(null)}
            style={{ position: 'absolute', right: 14, top: 'max(10px, env(safe-area-inset-top))', zIndex: 60 }}
          />
        )}

        {phone.open && (
          <Phone
            s={save}
            update={update}
            notify={notify}
            initial={phone.app}
            initialFocus={phone.focus}
            setQuality={setQuality}
            onClose={() => setPhone({ open: false, app: null })}
            onCallBack={startCallBack}
          />
        )}

        {result && (
          <ResultSheet
            result={result.r}
            newSpecies={result.newSpecies}
            record={result.record}
            newMsgs={newMsgs}
            onOpenSms={() => {
              sfx.click();
              setResult(null);
              // 有待接的强制来电时，先别把手机盖上来
              if (island.some((x) => x.kind === 'call' && x.force)) return;
              setPhone({ open: true, app: 'sms' });
            }}
            onDone={() => {
              sfx.click();
              setResult(null);
            }}
          />
        )}

        {forcedCall && <div className="force-veil" />}

        {islandShow && (
          <Island
            key={islandShow.uid}
            item={islandShow}
            hidden={!islandItem}
            onAccept={() => openStory(islandShow.uid)}
            onOpenNotice={(it) => openNotice(it.uid)}
            onOpenSms={(it) => {
              setIsland((p) => p.filter((x) => x.uid !== it.uid));
              if (hud.phase === 'idle' && !title) setPhone({ open: true, app: 'sms' });
              else notify('已收进手机，回岸再看');
            }}
            onDismiss={(uid) => {
              islandDropped.current.add(uid);
              setIsland((p) => p.filter((x) => x.uid !== uid));
              // 公告不在手机里留档，直接从队列移除，避免又被队列同步加回来
              if (!uid.startsWith('msg_')) update((s) => ({ ...s, queue: s.queue.filter((x) => x.uid !== uid) }));
            }}
            onSnooze={(uid) =>
              update((s) => {
                const it = s.queue.find((x) => x.uid === uid);
                if (!it || it.kind !== 'call') return s;
                return logCall(s, uid, it.from, it.topic ?? '来电', true);
              })
            }
            onExpanded={setIslandExpanded}
          />
        )}

        {activeStory && (
          <StoryOverlay
            key={'as_' + (activeStory.uid ?? 'active')}
            item={activeStory}
            autoAnswer
            onDone={() => {
              const it = activeStory;
              setActiveStory(null);
              setPaused(false);
              engineRef.current?.setPaused(false);
              // 通话真正结束才从队列移除，并记一笔「已接」
              if (it) {
                update((s) => {
                  const next: SaveState = { ...s, queue: s.queue.filter((x) => x.uid !== it.uid) };
                  if (it.kind !== 'call' || !it.uid) return next;
                  if (!it.callback) {
                    return logCall(next, it.uid, it.from, it.topic ?? '来电', false, it.lines);
                  }
                  // 回拨：挂到这个人最近的一条记录上——把「未接」升级成「已接」，
                  // 同时补上这次通话的台词。没有历史记录才新开一条。
                  const last = [...next.calls].reverse().find((c) => c.from === it.from);
                  const uid = last ? last.id.replace(/^call_/, '') : it.uid;
                  return logCall(next, uid, it.from, last?.topic ?? it.topic ?? '回拨', false, it.lines);
                });
              }
            }}
          />
        )}

        {q && (
          <StoryOverlay
            key={JSON.stringify(q).slice(0, 48) + save.queue.length}
            item={q}
            onDone={() =>
              update((s) => {
                const next: SaveState = { ...s, queue: s.queue.filter((x) => x !== q) };
                // 漫画刚看完就不该再标未读；手机里的「剧情」只是回看入口
                if (q.kind === 'comic') {
                  next.unread = { ...s.unread, comic: 0 };
                  next.unreadKey = { ...s.unreadKey, comic: 0 };
                }
                return next;
              })
            }
          />
        )}

        {paused && !result && (
          <div className="sheet-mask" style={{ zIndex: 80 }}>
            <div className="sheet" style={{ maxWidth: 360 }}>
              <div className="sheet-head">
                <b>已暂停</b>
                <div className="spacer" />
                <span className="small muted">{MAPS[save.map].name}</span>
              </div>
              <div className="sheet-body">
                <div className="kv">
                  <span>音效</span>
                  <button className={`btn sm${save.sound ? '' : ' ghost'}`} onClick={() => update((s) => ({ ...s, sound: !s.sound }))}>
                    {save.sound ? '开启' : '关闭'}
                  </button>
                </div>
                {/* 画质只在手机「设置」里调整，暂停面板不再重复一遍 */}
                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <button
                    className="btn ghost"
                    style={{ flex: 1 }}
                    onClick={() => {
                      engineRef.current?.stop();
                      setTitle(true);
                      setPaused(false);
                      setResult(null);
                    }}
                  >
                    回到岸边
                  </button>
                  <button
                    className="btn"
                    style={{ flex: 1.4 }}
                    onClick={() => {
                      setPaused(false);
                      engineRef.current?.setPaused(false);
                    }}
                  >
                    继续钓鱼
                  </button>
                </div>
                <div className="small muted" style={{ marginTop: 10, textAlign: 'center' }}>
                  暂停不会丢失本局，但切后台会自动暂停
                </div>
              </div>
            </div>
          </div>
        )}

        {!ready && !gpuError && (
          <div className="loading">
            <div className="ring" />
            正在下潜…
          </div>
        )}

        {gpuError && (
          <div className="gpu-fallback">
            <div style={{ fontSize: 30 }}>🌊</div>
            <b>这台设备没能启动画面渲染</b>
            <div className="small">
              浏览器似乎禁用了 WebGL2。请换用 Chrome / Edge / Safari 最新版，
              <br />
              或在设置里关闭硬件加速拦截后重试。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
