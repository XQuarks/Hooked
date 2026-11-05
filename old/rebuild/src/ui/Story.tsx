import { useEffect, useRef, useState } from 'react';
import { Avatar, Money, Thumb } from './common';
import { CHARS, COMICS, bottleById } from '../game/story';
import { QueueItem } from '../game/state';
import { MAPS, speciesById } from '../game/data';
import { TripResult } from '../game/engine';
import { sfx } from '../game/audio';

export function StoryOverlay({ item, onDone, autoAnswer }: { item: QueueItem; onDone: () => void; autoAnswer?: boolean }) {
  if (item.kind === 'call')
    return (
      <Call
        from={item.from}
        lines={item.lines}
        onDone={onDone}
        autoAnswer={autoAnswer}
        label={item.callback ? item.topic : undefined}
      />
    );
  if (item.kind === 'comic') return <Comic id={item.id} onDone={onDone} />;
  if (item.kind === 'notice') return <Notice title={item.title} text={item.text} org={item.org} onDone={onDone} />;
  return <Bottle id={item.id} onDone={onDone} />;
}

function Call({ from, lines, onDone, autoAnswer, label }: { from: keyof typeof CHARS; lines: { me?: boolean; text: string }[]; onDone: () => void; autoAnswer?: boolean; label?: string }) {
  // 从灵动岛点「接听」进来的，直接进通话；否则先显示来电界面
  const [stage, setStage] = useState<'ring' | 'talk'>(autoAnswer ? 'talk' : 'ring');
  const [declines, setDeclines] = useState(0);
  const [idx, setIdx] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const c = CHARS[from];

  useEffect(() => {
    if (stage !== 'ring') return;
    sfx.ring();
    const t = window.setInterval(() => sfx.ring(), 1600);
    return () => window.clearInterval(t);
  }, [stage]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [idx]);

  const declineText = ['', '（对方锲而不舍地再次拨打……）', '（对方第三次打来了。看来躲不掉了。）', '（手机开始发烫了……接吧。）'];

  return (
    <div className="call">
      <div className="who">
        <div className={stage === 'ring' ? 'ring-shake' : ''} style={{ display: 'inline-block' }}>
          <Avatar id={from} size={84} />
        </div>
        <div className="nm">{c.name}</div>
        <div className="st">{stage === 'ring' ? `来电 · ${c.title ?? ''}` : (label ?? '通话中…')}</div>
        {declines > 0 && stage === 'ring' && <div style={{ marginTop: 8, fontSize: 11, color: '#ffd479' }}>{declineText[Math.min(declines, 3)]}</div>}
      </div>

      {stage === 'talk' && (
        <div className="lines" onClick={() => idx < lines.length - 1 && setIdx(idx + 1)}>
          {lines.slice(0, idx + 1).map((l, i) => (
            <div key={i} className={`line${l.me ? ' me' : ''}`}>
              {l.text}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      <div style={{ marginTop: 'auto', paddingTop: 14 }}>
        {stage === 'ring' ? (
          <div style={{ display: 'flex', justifyContent: 'space-around' }}>
            <button
              onClick={() => {
                if (declines >= 3) return;
                setDeclines(declines + 1);
                sfx.bad();
              }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, opacity: declines >= 3 ? 0.45 : 1 }}
            >
              <span style={{ width: 60, height: 60, borderRadius: '50%', background: '#e4573f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>📵</span>
              <span style={{ fontSize: 11 }}>{declines >= 3 ? '拒绝无效' : '拒绝'}</span>
            </button>
            <button onClick={() => { sfx.click(); setStage('talk'); }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 60, height: 60, borderRadius: '50%', background: '#35c46a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, animation: 'pulse 1.4s infinite' }}>📞</span>
              <span style={{ fontSize: 11 }}>接听</span>
            </button>
          </div>
        ) : idx < lines.length - 1 ? (
          <button className="btn wide" onClick={() => setIdx(idx + 1)}>
            继续 ▸
          </button>
        ) : (
          <button className="btn danger wide" onClick={onDone}>
            📵 挂断
          </button>
        )}
      </div>
    </div>
  );
}

function Comic({ id, onDone }: { id: string; onDone: () => void }) {
  const comic = COMICS[id];
  const [i, setI] = useState(0);
  if (!comic) return null;
  const total = comic.panels.length;
  const p = comic.panels[i];
  const last = i === total - 1;
  const next = () => {
    sfx.click();
    if (last) onDone();
    else setI((v) => v + 1);
  };

  return (
    <div className="comic" onClick={next}>
      <div className="comic-top">
        <span className="comic-name">{comic.title}</span>
        <button
          className="chip pe"
          onClick={(e) => {
            e.stopPropagation();
            onDone();
          }}
        >
          跳过
        </button>
      </div>
      <div className="comic-progress">
        <i style={{ width: `${((i + 1) / total) * 100}%` }} />
      </div>

      <div className="comic-body">
        <div className="comic-frame" key={`f${i}`} style={{ background: p.bg }}>
          <div className="comic-halo" />
          <div className="comic-art">{p.art}</div>
          <div className="comic-vig" />
          <div className="comic-grain" />
          <div className="comic-idx">{i + 1}/{total}</div>
        </div>

        <div className="comic-copy" key={`c${i}`}>
          {p.caption && <p className="comic-cap">{p.caption}</p>}
          {p.say && p.who && (
            <div className="comic-say" style={{ borderLeftColor: CHARS[p.who].color }}>
              <b style={{ color: CHARS[p.who].color }}>{CHARS[p.who].name}</b>
              <span>{p.say}</span>
            </div>
          )}
        </div>
      </div>

      <div className="comic-foot">
        <div className="comic-dots">
          {comic.panels.map((_, k) => (
            <i key={k} className={k <= i ? 'on' : ''} />
          ))}
        </div>
        <span className="comic-hint">{last ? '点击任意处开始钓鱼 ▸' : '点击任意处继续 ▸'}</span>
      </div>
    </div>
  );
}

function Notice({ title, text, org, onDone }: { title: string; text: string; org?: string; onDone: () => void }) {
  return (
    <div className="notice">
      <div className="paper">
        <div className="org">{org ?? '公告'}</div>
        <h3>{title}</h3>
        <p>{text}</p>
        <div className="stamp">
          {(org ?? '公告').slice(0, 4)}
          <br />
          专用章
        </div>
        <button className="btn danger wide" style={{ marginTop: 18 }} onClick={onDone}>
          已阅
        </button>
      </div>
    </div>
  );
}

function Bottle({ id, onDone }: { id: string; onDone: () => void }) {
  const b = bottleById(id);
  if (!b) return null;
  return (
    <div className="bottle">
      <div className="paper">
        <div className="tt">
          🍾 {b.title} · {MAPS[b.map].name} {b.depth}m
        </div>
        <div className="txt">“{b.text}”</div>
        <div style={{ textAlign: 'right', fontSize: 11, color: '#7a5d1e', marginTop: 10 }}>（已存入 短信 › 漂流瓶）</div>
        <button className="btn wide" style={{ marginTop: 16 }} onClick={onDone}>
          小心收好
        </button>
      </div>
    </div>
  );
}

/* ============ 结算 ============ */

export function ResultSheet({
  result,
  newSpecies,
  record,
  newMsgs,
  onDone,
  onOpenSms,
}: {
  result: TripResult;
  newSpecies: string[];
  record: boolean;
  newMsgs: { thread: string; text: string; key?: boolean }[];
  onDone: () => void;
  /** 点「本局新消息」直接跳进手机短信（可选） */
  onOpenSms?: () => void;
}) {
  const rows = Object.entries(result.kills)
    .filter(([id]) => speciesById[id] && speciesById[id].value > 0)
    .sort((a, b) => (speciesById[b[0]]?.value ?? 0) * b[1] - (speciesById[a[0]]?.value ?? 0) * a[1]);
  // 天空目标不是鱼：单独一行，标在「毛收入」下面说明它已经包含在里面
  const SKY_NAMES: Record<string, string> = { sky_bird: '海鸟', sky_plane: '飞机', sky_ufo: 'UFO' };
  const skyRows = Object.entries(result.kills).filter(([id, n]) => id.startsWith('sky_') && n > 0);
  const skyText = skyRows.map(([id, n]) => `${SKY_NAMES[id] ?? id} ×${n}`).join(' · ');

  const cap =
    result.earned <= 0
      ? result.penalty > 0
        ? '水母表示：谢谢你的捐款。'
        : '空军也是一种修行。'
      : result.earned > 2500
        ? '这一网，够你爷爷蒸一年桑拿！'
        : result.earned > 900
          ? '翠花姐和大炮哥已经在搓手了。'
          : result.earned > 250
            ? '不错的一趟！海鸥没偷走就算赚。'
            : '聊胜于无，至少你没打水母。';

  return (
    <div className="sheet-mask">
      <div className="sheet">
        <div className="result-total">
          <div className="num">
            {result.earned < 0 ? '-' : ''}
            <Money v={Math.abs(result.earned)} />
          </div>
          <div className="cap">
            {MAPS[result.map].name} · 最深 {result.depth}m · 上钩 {result.hooked} 条
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
            {record && <span className="tag gold">🏅 新纪录</span>}
            {result.maxCombo >= 3 && <span className="tag">🔥 最高 {result.maxCombo} 连</span>}
            {result.bottles.length > 0 && <span className="tag green">🍾 漂流瓶 ×{result.bottles.length}</span>}
            {result.legend && <span className="tag gold">👑 鱼王</span>}
          </div>
        </div>
        <div className="sheet-body">
          {newMsgs.length > 0 && (
            <div
              className={`result-msgs${onOpenSms ? ' pe' : ''}`}
              role={onOpenSms ? 'button' : undefined}
              onClick={onOpenSms}
            >
              <div className="rm-h">
                📱 本局新消息 ×{newMsgs.length}
                {newMsgs.some((m) => m.key) && <span className="rm-key">主线</span>}
              </div>
              {newMsgs.slice(0, 2).map((m, i) => (
                <div className="rm-row" key={i}>
                  <b style={{ color: CHARS[m.thread as keyof typeof CHARS]?.color ?? '#8fc4da' }}>
                    {CHARS[m.thread as keyof typeof CHARS]?.name ?? m.thread}
                  </b>
                  <span>{m.text}</span>
                </div>
              ))}
              <div className="rm-tip">{onOpenSms ? '点开看全部 ›' : '回到岸边后打开手机查看 →'}</div>
            </div>
          )}
          <div className="kv">
            <span>毛收入</span>
            <b className="money" style={{ color: 'var(--mag)' }}>
              +${result.gross}
            </b>
          </div>
          {result.bonus > 0 && (
            <div className="kv">
              <span>深度奖励（{result.depth}m）</span>
              <b className="money" style={{ color: '#2f8a52' }}>
                +${result.bonus}
              </b>
            </div>
          )}
          {result.penalty > 0 && (
            <div className="kv">
              <span>水母罚款 ×{result.jellyHits}</span>
              <b style={{ color: 'var(--bad)' }}>-${result.penalty}</b>
            </div>
          )}
          {result.skyGain > 0 && (
            <div className="kv" style={{ opacity: 0.72 }}>
              <span style={{ fontSize: 11.5 }}>　└ 击落 {skyText}</span>
              <b className="money" style={{ color: 'var(--mag)', fontSize: 12 }}>
                +${result.skyGain}
              </b>
            </div>
          )}
          {result.lost > 0 && (
            <div className="kv">
              <span>逃回大海</span>
              <b className="muted">{result.lost} 条</b>
            </div>
          )}
          <div className="divider" />
          <div style={{ fontSize: 11, color: '#6b7680', marginBottom: 4, letterSpacing: 1 }}>渔获</div>
          {rows.length === 0 && (
            <div className="muted small" style={{ padding: '10px 0' }}>
              {skyRows.length > 0 ? '鱼一条没打下来，天上的倒是没放过。' : '一条鱼都没打下来……'}
            </div>
          )}
          {rows.map(([id, n]) => {
            const sp = speciesById[id];
            return (
              <div className="catch-row" key={id}>
                <div style={{ width: 62, display: 'flex', justifyContent: 'center' }}>
                  <Thumb id={id} h={36} />
                </div>
                <div className="nm">
                  {sp.name}
                  {newSpecies.includes(id) && <span className="badge">NEW</span>}
                </div>
                <div className="ct">×{n}</div>
              </div>
            );
          })}
          <div style={{ marginTop: 12, fontSize: 11, color: '#6f6656', textAlign: 'center' }}>{cap}</div>
        </div>
        <div className="sheet-foot">
          <button className="btn wide" onClick={onDone}>
            收下 💰
          </button>
        </div>
      </div>
    </div>
  );
}
