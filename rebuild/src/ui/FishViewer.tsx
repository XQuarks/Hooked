import { useEffect, useRef } from 'react';
import { speciesById } from '../game/data';
import { FishSprite } from '../two/fish2d';
import { Cam, rgba } from '../two/core';

/**
 * 图鉴详情里的鱼：2D 版比 3D 版更合适——
 * 这里要的是「看清这条鱼长什么样」，矢量绘制的轮廓比带高光的实体更容易辨认。
 */
export function FishViewer({ id, height = 168 }: { id: string; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dirRef = useRef(1);

  useEffect(() => {
    const c = canvasRef.current;
    const sp = speciesById[id];
    if (!c || !sp) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.parentElement?.clientWidth || 300;
    const H = height;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    c.style.width = '100%';
    c.style.height = H + 'px';
    const g = c.getContext('2d');
    if (!g) return;

    const sprite = new FishSprite(sp);
    const hRatio = sprite.form.h;
    const scale = Math.min((W * 0.7) / sp.len, (H * 0.58) / (sp.len * hRatio));

    const cam: Cam = {
      W,
      H,
      scale,
      cy: 0,
      cx: 0,
      shakeX: 0,
      shakeY: 0,
      toScreenX: (x) => W / 2 + x * scale,
      toScreenY: (y) => H / 2 - y * scale,
      toWorld: (sx, sy) => ({ x: (sx - W / 2) / scale, y: -(sy - H / 2) / scale }),
    };

    let raf = 0;
    let t = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;

      sprite.root.position.set(0, Math.sin(t * 1.05) * 0.012 * sp.len, 0);
      sprite.setDir(dirRef.current);
      sprite.setSpin(Math.sin(t * 0.62) * 0.055 * dirRef.current);
      sprite.update(dt);

      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);

      // 背景光：中间一团冷光，鱼压在上面才有「标本」感
      const bg = g.createRadialGradient(W / 2, H * 0.46, 0, W / 2, H * 0.5, Math.max(W, H) * 0.62);
      bg.addColorStop(0, rgba(sp.glow ? sp.color2 : '#2b6e86', 0.3));
      bg.addColorStop(0.5, rgba('#123b4d', 0.14));
      bg.addColorStop(1, rgba('#04121a', 0));
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);

      sprite.draw(g, cam);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      sprite.dispose();
    };
  }, [id, height]);

  return (
    <div style={{ width: '100%', lineHeight: 0, cursor: 'ew-resize', touchAction: 'pan-y' }}>
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          const startX = e.clientX;
          const move = (ev: PointerEvent) => {
            if (Math.abs(ev.clientX - startX) > 14) dirRef.current = ev.clientX > startX ? 1 : -1;
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      />
      <div style={{ fontSize: 10, opacity: 0.42, textAlign: 'center', marginTop: 2, lineHeight: 1.4 }}>
        左右拖动可让它转身
      </div>
    </div>
  );
}
