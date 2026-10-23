import { useEffect, useRef, useState } from 'react';
import { CHARS } from '../game/story';
import { CharId } from '../game/state';
import { Avatar } from './common';
import { sfx } from '../game/audio';

/**
 * 灵动岛式通知。
 *
 * 为什么要它：原来所有重要剧情都是全屏弹层，玩家在「刚想再来一局」的时候被摁住读三分钟。
 * 现在改成——强剧情出一个常驻的来电卡片，你什么时候想接再接；弱消息闪一下就走，不打断。
 *
 * 四档强度：
 *   call        → 常驻展开，可以拒绝（收起 5 秒后再弹）
 *   call(force) → 强制来电：只剩「接听」，其余 UI 由 App 隐藏
 *   notice      → 展开 8 秒后收成胶囊，点击还能再打开
 *   sms         → 展开 4.5 秒后自动消失（就像真的手机通知）
 */
export type IslandItem =
  | {
      uid: string;
      kind: 'call';
      from: CharId;
      lines: { me?: boolean; text: string }[];
      /** 强制来电：不能拒绝、不能收起 */
      force?: boolean;
      /** 一句话摘要 */
      topic?: string;
    }
  | { uid: string; kind: 'notice'; title: string; text: string; system?: boolean }
  | { uid: string; kind: 'sms'; from: CharId; text: string; key?: boolean; expireAt?: number };

const SMS_LIFE = 4500;
const NOTICE_PILL_AFTER = 6000;
/** 公告收成胶囊后再留这么久，然后彻底让位给下一条 */
const NOTICE_LIFE = 20000;
const CALL_RETRY = 5000;

export function Island({
  item,
  hidden = false,
  onAccept,
  onOpenSms,
  onOpenNotice,
  onDismiss,
  onSnooze,
  onExpanded,
}: {
  item: IslandItem | null;
  /** 被其他界面挡住时不卸载、只隐藏：计时暂停，回来时是收起的小胶囊而不是再弹一次 */
  hidden?: boolean;
  onAccept: (it: IslandItem) => void;
  onOpenSms: (it: IslandItem) => void;
  onOpenNotice: (it: IslandItem) => void;
  onDismiss: (uid: string) => void;
  onSnooze: (uid: string) => void;
  onExpanded?: (open: boolean) => void;
}) {
  const forced = item?.kind === 'call' && !!item.force;
  // 强制来电永远展开，不允许收成胶囊
  const [expanded, setExpanded] = useState(true);
  const timers = useRef<number[]>([]);
  const dragY = useRef(0);
  const [dragPx, setDragPx] = useState(0);
  // 计时用绝对时间点，被遮挡时暂停（回来时把停掉的时长补回去）
  const deadlines = useRef({ collapse: 0, dismiss: 0 });
  const hiddenAt = useRef(0);

  useEffect(() => {
    onExpanded?.(!hidden && !!item && (expanded || !!forced));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, item?.uid, hidden]);

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };

  /** 按剩余时间重新挂表 */
  const arm = (it: IslandItem | null) => {
    clearTimers();
    if (!it || hidden) return;
    const now = Date.now();
    const d = deadlines.current;
    if (d.collapse > 0) {
      timers.current.push(window.setTimeout(() => setExpanded(false), Math.max(0, d.collapse - now)));
    }
    if (d.dismiss > 0) {
      timers.current.push(window.setTimeout(() => onDismiss(it.uid), Math.max(0, d.dismiss - now)));
    }
  };

  // 新的一条：重置状态与死线
  useEffect(() => {
    const now = Date.now();
    setExpanded(true);
    setDragPx(0);
    dragY.current = 0;
    hiddenAt.current = hidden ? now : 0;
    if (!item) return;
    deadlines.current = {
      collapse: item.kind === 'notice' ? now + NOTICE_PILL_AFTER : 0,
      dismiss: item.kind === 'sms' ? now + SMS_LIFE : item.kind === 'notice' ? now + NOTICE_LIFE : 0,
    };
    arm(item);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.uid]);

  // 被挡住 / 重新露出来
  useEffect(() => {
    if (!item) return;
    const now = Date.now();
    if (hidden) {
      clearTimers();
      // 回来时只想看到一条安静的小胶囊，不再整块弹开
      if (item.kind !== 'call') setExpanded(false);
      hiddenAt.current = now;
      return;
    }
    if (hiddenAt.current) {
      const shift = now - hiddenAt.current;
      hiddenAt.current = 0;
      if (deadlines.current.collapse) deadlines.current.collapse += shift;
      if (deadlines.current.dismiss) deadlines.current.dismiss += shift;
    }
    arm(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, item?.uid]);

  if (!item) return null;

  const isSystem = item.kind === 'notice' && !!item.system;
  const who: CharId = item.kind === 'notice' ? 'mayor' : item.from;
  const ch = CHARS[who];
  const body =
    item.kind === 'call'
      ? item.topic ?? ch.title ?? '来电'
      : item.kind === 'notice'
        ? item.title
        : item.text;

  const decline = () => {
    if (item.kind !== 'call' || forced) return;
    sfx.click();
    setExpanded(false);
    onSnooze(item.uid);
    timers.current.push(
      window.setTimeout(() => {
        setExpanded(true);
      }, CALL_RETRY),
    );
  };

  const tapBody = () => {
    sfx.click();
    if (forced) {
      onAccept(item);
      return;
    }
    // 短信 / 公告：点一下就进对应界面（不要求先展开胶囊）
    if (item.kind === 'sms') {
      onOpenSms(item);
      return;
    }
    if (item.kind === 'notice') {
      onOpenNotice(item);
      return;
    }
    if (!expanded) {
      setExpanded(true);
      return;
    }
    onAccept(item);
  };

  // ---------- 上滑收起（强制来电不可滑走）----------
  const onPointerDown = (e: React.PointerEvent) => {
    if (forced) return;
    dragY.current = e.clientY;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (forced || !dragY.current) return;
    const dy = Math.min(0, e.clientY - dragY.current);
    if (dy < -4) setDragPx(dy);
  };
  const onPointerUp = () => {
    if (forced) return;
    const passed = dragPx < -26;
    dragY.current = 0;
    setDragPx(0);
    if (!passed) return;
    sfx.click();
    if (item.kind === 'sms') onDismiss(item.uid);
    else if (item.kind === 'call') decline();
    else setExpanded(false);
  };

  return (
    <div
      className={`island${expanded || forced ? ' open' : ''} k-${item.kind}${forced ? ' force' : ''}${item.kind === 'sms' && item.key ? ' key' : ''}${hidden ? ' is-hidden' : ''}`}
      onClick={tapBody}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={dragPx ? { transform: `translateX(-50%) translateY(${dragPx}px)`, opacity: 1 + dragPx / 90 } : undefined}
      role="button"
      tabIndex={0}
    >
      <div className="is-avatar">
        {isSystem ? (
          <div className="is-sys" style={{ width: expanded || forced ? 40 : 24, height: expanded || forced ? 40 : 24, fontSize: expanded || forced ? 19 : 12 }}>
            📲
          </div>
        ) : (
          <Avatar id={who} size={expanded || forced ? 40 : 24} />
        )}
      </div>

      <div className="is-text">
        <div className="is-top">
          <b>{isSystem ? '系统通知' : ch.name}</b>
          <span className="is-tag">
            {item.kind === 'call'
              ? forced
                ? '📞 重要来电'
                : '📞 来电'
              : item.kind === 'notice'
                ? isSystem
                  ? '📲 系统'
                  : '📢 公告'
                : '💬 新消息'}
          </span>
        </div>
        <div className="is-body">{body}</div>
      </div>

      {item.kind === 'call' && (expanded || forced) && (
        <div className="is-actions">
          {!forced && (
            <button
              className="is-btn no"
              aria-label="拒绝"
              onClick={(e) => {
                e.stopPropagation();
                decline();
              }}
            >
              📵
            </button>
          )}
          <button
            className={`is-btn yes${forced ? ' wide' : ''}`}
            aria-label="接听"
            onClick={(e) => {
              e.stopPropagation();
              sfx.click();
              onAccept(item);
            }}
          >
            {forced ? '接听' : '📞'}
          </button>
        </div>
      )}

      {!expanded && !forced && (
        <span className="is-hint">{item.kind === 'call' ? '未接来电 · 点开' : '点开'}</span>
      )}
      {expanded && item.kind !== 'call' && (
        <button
          className="is-x"
          aria-label="关闭通知"
          onClick={(e) => {
            e.stopPropagation();
            sfx.click();
            onDismiss(item.uid);
          }}
        >
          ✕
        </button>
      )}
      {expanded && item.kind === 'sms' && <span className="is-live" />}
    </div>
  );
}
