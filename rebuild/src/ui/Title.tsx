import { MAPS, SPECIES } from '../game/data';
import { Quality, SaveState, speciesCount } from '../game/state';

interface Props {
  save: SaveState;
  quality: Quality;
  setQuality: (q: Quality) => void;
  onStart: () => void;
}

const LABEL: Record<Quality, string> = { low: '流畅', mid: '均衡', high: '精美' };

export function Title({ save, quality, setQuality, onStart }: Props) {
  const deepest = Math.max(save.maxDepth.bay, save.maxDepth.ice);
  return (
    <div className="title">
      <div className="tag">DEEP SEA REMASTER</div>
      <h1>
        荒唐<em>钓鱼</em>
      </h1>
      <div style={{ fontSize: 11, letterSpacing: 3, color: '#8fc4da', marginTop: 6 }}>RIDICULOUS FISHING · 2D 重制版</div>
      <p className="lede">
        爷爷二十年前说去买烟，就再也没回来。
        <br />
        他留给你一条船、一把枪，和一部充满未读消息的智能手机。
      </p>
      <div className="meta">
        <span className="chip">🎣 出海 {save.trips} 次</span>
        <span className="chip">📖 图鉴 {speciesCount(save)}/{SPECIES.filter((x) => x.special !== 'jelly').length}</span>
        <span className="chip">🌊 最深 {deepest}m</span>
        {save.map === 'ice' && <span className="chip">🧊 极光冰海</span>}
      </div>
      <button className="btn start" onClick={onStart}>
        {save.trips > 0 ? '继续钓鱼' : '开始游戏'}
      </button>
      <div className="foot">
        <div className="seg">
          {(['low', 'mid', 'high'] as Quality[]).map((q) => (
            <button key={q} className={quality === q ? 'on' : ''} onClick={() => setQuality(q)}>
              {LABEL[q]}
            </button>
          ))}
        </div>
        <span>进度自动保存 · {MAPS[save.map].name}</span>
      </div>
    </div>
  );
}
