import { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';
import { fishThumb } from '../two/thumbs';
import { speciesById, fmtMoney } from '../game/data';
import { CHARS } from '../game/story';
import { CharId } from '../game/state';

export function Money({ v, big }: { v: number; big?: boolean }) {
  return <span className={`money${big ? ' big' : ''}`}>{fmtMoney(v)}</span>;
}

/**
 * 左下角（以及标题页右上角）的手机入口。
 * 不再是 emoji，而是一只 CSS 画的小手机：机身、刘海、四宫格图标、home 条。
 * 有来电时加 .ringing，整只手机震动摇晃 + 红色呼吸圈。
 */
export function PhoneFab({
  badge,
  badgeAny,
  ringing,
  onClick,
  style,
}: {
  badge: number;
  badgeAny: boolean;
  ringing?: boolean;
  onClick: () => void;
  style?: CSSProperties;
}) {
  return (
    <button className={`phone-fab pe${ringing ? ' ringing' : ''}`} style={style} onClick={onClick} aria-label="手机">
      <span className="pf-body" aria-hidden="true">
        <span className="pf-screen">
          <span className="pf-cam" />
          <span className="pf-grid">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="pf-home" />
        </span>
      </span>
      {badge > 0 ? (
        <span className="dot-num">{badge > 99 ? '99+' : badge}</span>
      ) : badgeAny ? (
        <span className="dot-any" />
      ) : null}
    </button>
  );
}

export function Avatar({ id, size = 38 }: { id: CharId; size?: number }) {
  const c = CHARS[id];
  return (
    <div className="avatar" style={{ width: size, height: size, background: `${c.color}33`, borderColor: `${c.color}88`, fontSize: size * 0.5 }}>
      {c.avatar}
    </div>
  );
}

/** 鱼缩略图：2D 矢量离屏绘制，锁定状态用剪影 */
export function Thumb({ id, locked, h = 44, maxW = 120 }: { id: string; locked?: boolean; h?: number; maxW?: number }) {
  const sp = speciesById[id];
  const url = sp ? fishThumb(id) : '';
  if (!url) return <div style={{ width: 60, height: h }} />;
  return <img src={url} alt={sp?.name ?? ''} style={{ height: h, width: 'auto', maxWidth: maxW, objectFit: 'contain', filter: locked ? 'brightness(0) invert(0.45)' : 'drop-shadow(0 6px 14px rgba(0,0,0,.35))', opacity: locked ? 0.6 : 1 }} />;
}

export function AppBar({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return (
    <div className="appbar">
      <button className="back" onClick={onBack} aria-label="返回">
        ‹
      </button>
      <div className="tt">{title}</div>
      {right}
    </div>
  );
}

/** 让 canvas 尺寸跟随容器（避免布局抖动导致的拉伸） */
export function useElementSize<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  const size = useRef({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      size.current = { w: r.width, h: r.height };
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    size.current = { w: r.width, h: r.height };
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * 让元素「先挂载、再进场」，并在隐藏时保留一小段时间做退场动画。
 * 用法：const p = usePresence(show); ... {p.mounted && <div className={`slide${p.on ? ' on' : ''}`}>}
 */
export function usePresence(show: boolean, ms = 380) {
  const [mounted, setMounted] = useState(show);
  const [on, setOn] = useState(show);
  useEffect(() => {
    let raf = 0;
    let t = 0;
    if (show) {
      setMounted(true);
      raf = requestAnimationFrame(() => setOn(true));
    } else {
      setOn(false);
      t = window.setTimeout(() => setMounted(false), ms);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [show, ms]);
  return { mounted, on };
}
