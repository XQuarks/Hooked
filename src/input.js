/**
 * input.js — 统一输入层：触屏 / 鼠标 / 键盘
 * 对外只暴露归一化坐标（0~1，左上为原点）与语义化事件。
 */

export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.pointerDown = false;
    this.nx = 0.5;
    this.ny = 0.5;
    this.startNx = 0.5;
    this.startNy = 0.5;
    this.moved = false;
    this._activeId = null;

    this.onDown = null;   // (nx, ny) => void
    this.onDrag = null;   // (nx, ny, dx, dy) => void
    this.onUp = null;     // (nx, ny, wasTap) => void
    this.onKey = null;    // (code, isDown) => void

    const rectOf = () => el.getBoundingClientRect();

    const norm = (e) => {
      const r = rectOf();
      return {
        nx: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        ny: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      };
    };

    el.addEventListener('pointerdown', (e) => {
      if (this._activeId !== null) return;
      this._activeId = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      const p = norm(e);
      this.pointerDown = true;
      this.nx = this.startNx = p.nx;
      this.ny = this.startNy = p.ny;
      this.moved = false;
      e.preventDefault();
      if (this.onDown) this.onDown(p.nx, p.ny);
    }, { passive: false });

    el.addEventListener('pointermove', (e) => {
      const p = norm(e);
      const dx = p.nx - this.nx, dy = p.ny - this.ny;
      this.nx = p.nx; this.ny = p.ny;
      if (this.pointerDown && (Math.abs(p.nx - this.startNx) + Math.abs(p.ny - this.startNy)) > 0.012) {
        this.moved = true;
      }
      if (this.onDrag) this.onDrag(p.nx, p.ny, dx, dy);
    }, { passive: true });

    const end = (e) => {
      if (e.pointerId !== this._activeId) return;
      this._activeId = null;
      const p = norm(e);
      this.pointerDown = false;
      if (this.onUp) this.onUp(p.nx, p.ny, !this.moved);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);

    el.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (this.onKey) this.onKey(e.code, true);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (this.onKey) this.onKey(e.code, false);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  isDown(...codes) { return codes.some((c) => this.keys.has(c)); }
}
