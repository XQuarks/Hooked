import { CSSProperties, useRef } from 'react';
import { HudState } from '../game/engine';
import { MAPS, currentWeaponName, hotName } from '../game/helpers';
import { BOTTLES, weatherById } from '../game/data';
import { SaveState, mainGoal, sideGoal, upVal, weatherOf } from '../game/state';
import { Money, PhoneFab, usePresence } from './common';

interface Props {
  hud: HudState;
  save: SaveState;
  pointer: { x: number; y: number } | null;
  /** 主线未读数（手机图标显示数字） */
  badge: number;
  /** 是否存在任何未读（没有主线时显示小点） */
  badgeAny: boolean;
  /** 有来电时左下角的手机会震动 */
  ringing?: boolean;
  onPause: () => void;
  onAbortDown: (v: boolean) => void;
  onPhone: () => void;
}

export function Hud({ hud, save, pointer, badge, badgeAny, ringing, onPause, onAbortDown, onPhone }: Props) {
  const casting = hud.phase === 'cast';
  const fishing = hud.phase !== 'idle' && !casting;
  const map = MAPS[save.map];
  const weather = weatherById[weatherOf(save)];
  const line = Math.min(upVal(save, 'line'), map.maxDepth);
  const ratio = hud.maxDepth ? Math.min(1, hud.depth / hud.maxDepth) : 0;
  const goal = mainGoal(save);
  const side = sideGoal(save);
  const bottleMarks =
    hud.phase !== 'idle' && hud.maxDepth > 0
      ? BOTTLES.filter((b) => b.map === save.map && !save.bottles.includes(b.id) && b.depth <= hud.maxDepth)
      : [];

  // 进出场：两组 UI 各自朝屏幕底部滑出/滑入，并做透明度过渡
  const shore = usePresence(!fishing && !casting);
  const fishUI = usePresence(fishing);
  // 退场时 phase 已经回到 idle，用最后一帧的 phase 决定底部显示哪一行
  const lastPhase = useRef(hud.phase);
  if (fishing) lastPhase.current = hud.phase;
  const fp = fishing ? hud.phase : lastPhase.current;

  const showDepth = fishing && hud.phase !== 'shoot';
  const showShoot = fishing && hud.phase === 'shoot';

  // 标题按字数缩放：3 字约 96px、4 字约 75px，视觉宽度都落在 ~300px
  const nameLen = Array.from(map.name).length || 3;
  const titleSize = Math.max(44, Math.min(96, Math.floor(300 / nameLen)));

  return (
    <div className="hud-layer" data-phase={hud.phase}>
      {/* 标题独立于 hud-top：它在画面中部，不跟顶部的那排 chip 抢位置 */}
      <div
        className={`hud-map${hud.phase !== 'idle' ? ' hide' : ''}`}
        style={{ '--t-size': `${titleSize}px` } as CSSProperties}
      >
        <b>{map.name}</b>
        <i>
          {weather.icon} {weather.name} · {weather.tip}
        </i>
      </div>
      <div className="hud-top">
        <div className="stack">
          <div className="money-bar pe">
            <span className="mb-coin" />
            <Money v={save.money} />
          </div>
          {fishing && hud.phase !== 'shoot' && (
            <div className="chip dim" style={{ fontSize: 11 }}>
              🪝 {hud.hooked}/{hud.cap}
              {hud.saw > 0 && <span style={{ color: '#ffd479' }}> · 🪚×{hud.saw}</span>}
            </div>
          )}
        </div>
        <div className="stack right">
          {fishing ? (
            <>
              <div className="chip">{hud.band}</div>
              <button className="chip pe" onClick={onPause} aria-label="暂停">
                ⏸ 暂停
              </button>
            </>
          ) : (
            <>
              <div className="chip">{currentWeaponName(save)}</div>
              <div className="chip dim">🧵 {line}m · 🪝 {upVal(save, 'hook')}</div>
              <div className="chip dim" style={{ fontSize: 10.5 }}>
                🔥 {hotName(save)}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="hud-mid">
        <div className={`mid-depth${showDepth ? ' on' : ''}`}>
          <div className="depth">
            {hud.depth}
            <small>m</small>
          </div>
          <div className="mid-sub">
            {hud.phase === 'ascent' ? '收线中' : hud.phase === 'turn' ? '咬钩' : `上限 ${hud.maxDepth}m`}
          </div>
        </div>

        <div className={`rail${showDepth ? ' on' : ''}`}>
          <i style={{ height: `${ratio * 100}%` }} />
          {bottleMarks.map((b) => (
            <em key={b.id} title={`漂流瓶 · ${b.depth}m`} style={{ top: `${(b.depth / hud.maxDepth) * 100}%` }} />
          ))}
          <b style={{ top: `${ratio * 100}%` }} />
        </div>

        <div className={`mid-shoot${showShoot ? ' on' : ''}`}>
          <div className="money" style={{ fontSize: 30 }}>
            ${Math.max(0, hud.gross + hud.estimate + hud.airValue)}
          </div>
          <div className="mid-sub">
            空中 {hud.airLeft} 条{hud.estimate > 0 ? ` · 已钩 ${hud.estimate}` : ''}
          </div>
        </div>

        {hud.phase === 'shoot' && hud.combo > 1 && (
          <div className="combo" style={{ top: '30%' }}>
            <b>×{hud.mult.toFixed(2)}</b>
            <span>{hud.combo} 连杀</span>
          </div>
        )}

        {hud.phase === 'shoot' && pointer && <div className="crosshair" style={{ left: pointer.x, top: pointer.y }} />}
      </div>

      <div className="hud-bottom">
        {shore.mounted && (
          <div className={`hud-slide${shore.on ? ' on' : ''}`}>
            <div className="goal">
              <span className="g-ic">{goal.icon}</span>
              <div className="g-tx">
                <b>{goal.text}</b>
                {goal.sub && <i>{goal.sub}</i>}
              </div>
              {goal.now != null && goal.target != null && (
                <div className="g-prog">
                  <span>
                    {goal.unit ?? ''}
                    {Math.min(goal.now, goal.target).toLocaleString()}/{goal.unit ?? ''}
                    {goal.target.toLocaleString()}
                  </span>
                  <div className="g-bar">
                    <i style={{ width: `${Math.min(100, (goal.now / goal.target) * 100)}%` }} />
                  </div>
                </div>
              )}
              {goal.cta === 'phone' && <span className="g-cta">📱</span>}
            </div>

            {side && (
              <div className="goal side">
                <span className="g-ic">{side.icon}</span>
                <div className="g-tx">
                  <b>{side.text}</b>
                  {side.sub && <i>{side.sub}</i>}
                </div>
                {side.now != null && side.target != null && (
                  <div className="g-prog">
                    <span>
                      {side.unit ?? ''}
                      {Math.min(side.now, side.target).toLocaleString()}/{side.unit ?? ''}
                      {side.target.toLocaleString()}
                    </span>
                    <div className="g-bar">
                      <i style={{ width: `${Math.min(100, (side.now / side.target) * 100)}%` }} />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="shore-row">
              <PhoneFab badge={badge} badgeAny={badgeAny} ringing={ringing} onClick={onPhone} />
              <div className="cast-hint">点击屏幕任意处下钩</div>
              <div className="shore-spacer" />
            </div>
          </div>
        )}

        {fishUI.mounted && (
          <div className={`hud-slide${fishUI.on ? ' on' : ''}`}>
            {fp !== 'shoot' && (
              <div className="hud-row">
                <div className={`hookbox${hud.hooked >= hud.cap ? ' full' : ''}`}>
                  <span>
                    🐟 {hud.hooked}/{hud.cap}
                  </span>
                  {hud.estimate > 0 && <span className="est">约 ${hud.estimate}</span>}
                </div>
                {fp === 'descent' ? (
                  <button
                    className="abort pe"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      onAbortDown(true);
                    }}
                    onPointerUp={() => onAbortDown(false)}
                    onPointerLeave={() => onAbortDown(false)}
                    onPointerCancel={() => onAbortDown(false)}
                  >
                    <div className="fill" style={{ height: `${hud.abort * 100}%` }} />
                    <span>⬆</span>
                    <span>长按收线</span>
                  </button>
                ) : (
                  <div className="hookbox">
                    <span style={{ color: 'var(--cyan)' }}>{fp === 'ascent' ? '⬆ 上升中' : '咬钩…'}</span>
                  </div>
                )}
              </div>
            )}

            {fp === 'shoot' && (
              <div className="hud-row" style={{ alignItems: 'center' }}>
                <div className="hookbox">
                  <span>💥 {hud.airLeft} 条在飞</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
                  {save.gun === 'uzi' || save.gun === 'minigun' ? (
                    <div className={`heat${hud.overheated ? ' hot' : ''}`} title="枪管温度">
                      <i style={{ width: `${Math.min(100, hud.heat * 100)}%` }} />
                    </div>
                  ) : null}
                  <div className="chip dim" style={{ fontSize: 10 }}>
                    {hud.overheated ? '枪管过热' : '点鱼开枪'}
                  </div>
                </div>
              </div>
            )}

            {fishing && hud.dark && hud.phase !== 'shoot' && (
              <div className="chip dim" style={{ alignSelf: 'flex-start', fontSize: 10 }}>
                🔦 头灯 {hud.lamp}m
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
