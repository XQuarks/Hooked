/**
 * audio.js — 纯 WebAudio 程序化音效
 * 不加载任何音频文件：零请求、零版权风险、包体为 0。
 */

let ctx = null;
let master = null;
let muted = false;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** 必须在用户手势里调用一次，解锁移动端音频 */
export function unlockAudio() {
  const c = ac();
  if (c && c.state === 'suspended') c.resume();
}

export function setMuted(v) {
  muted = v;
  if (master) master.gain.value = v ? 0 : 0.55;
}
export function isMuted() { return muted; }

// ── 基础积木 ────────────────────────────────────────────────
function tone({ type = 'sine', f0 = 440, f1 = null, dur = 0.15, gain = 0.3, delay = 0, curve = 'exp' }) {
  const c = ac(); if (!c || muted) return;
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 != null) {
    if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    else osc.frequency.linearRampToValueAtTime(Math.max(1, f1), t + dur);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + dur + 0.02);
}

function noise({ dur = 0.2, gain = 0.3, delay = 0, f0 = 1200, f1 = 200, q = 1, type = 'lowpass' }) {
  const c = ac(); if (!c || muted) return;
  const t = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const flt = c.createBiquadFilter(); flt.type = type; flt.Q.value = q;
  flt.frequency.setValueAtTime(f0, t);
  flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt); flt.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}

// ── 游戏音效 ────────────────────────────────────────────────
export const SFX = {
  /** 钩中鱼：清脆上滑 */
  hookUp(step = 0) {
    const f = 620 * Math.pow(1.0595, Math.min(step, 24));
    tone({ type: 'triangle', f0: f, f1: f * 1.9, dur: 0.09, gain: 0.22 });
    tone({ type: 'sine', f0: f * 2, f1: f * 3, dur: 0.06, gain: 0.1, delay: 0.01 });
  },
  /** 收线 */
  reel() {
    noise({ dur: 0.3, gain: 0.12, f0: 900, f1: 2600, q: 2, type: 'bandpass' });
    tone({ type: 'sawtooth', f0: 160, f1: 520, dur: 0.26, gain: 0.07 });
  },
  /** 抛竿：鱼线甩出去的破空声 */
  cast() {
    noise({ dur: 0.26, gain: 0.16, f0: 700, f1: 4200, q: 1.4, type: 'bandpass' });
    tone({ type: 'triangle', f0: 320, f1: 880, dur: 0.14, gain: 0.07 });
  },
  /** 上升撞鱼：低沉咚 + 震动感 */
  thud() {
    tone({ type: 'square', f0: 150, f1: 42, dur: 0.26, gain: 0.26 });
    noise({ dur: 0.18, gain: 0.2, f0: 500, f1: 90 });
  },
  /** 冲出水面 */
  splash() {
    noise({ dur: 0.45, gain: 0.34, f0: 5200, f1: 380, q: 0.7 });
    tone({ type: 'sine', f0: 300, f1: 900, dur: 0.18, gain: 0.12 });
  },
  /** 开火 */
  shot() {
    noise({ dur: 0.16, gain: 0.36, f0: 3400, f1: 220, q: 0.8 });
    tone({ type: 'square', f0: 220, f1: 60, dur: 0.1, gain: 0.18 });
  },
  /**
   * 换弹完成 / 激光冷却结束。
   *
   * 为什么不用 `deny()` 那种"卡壳"音：换弹是**正常流程**（Uzi 每 9 发就要换一次），
   * 用失败音会让玩家以为自己按错了。两声干脆的金属"咔哒"才读得出"我又能打了"。
   */
  reload() {
    noise({ dur: 0.07, gain: 0.2, f0: 2600, f1: 900, q: 1.2 });
    tone({ type: 'square', f0: 340, f1: 260, dur: 0.06, gain: 0.13, delay: 0.05 });
  },
  /** 命中鱼：连击越高音越高 */
  hit(combo = 0) {
    const f = 520 * Math.pow(1.09, Math.min(combo, 20));
    tone({ type: 'square', f0: f, f1: f * 0.65, dur: 0.08, gain: 0.18 });
    noise({ dur: 0.1, gain: 0.18, f0: 2600, f1: 500 });
  },
  /** 金币 */
  coin(i = 0) {
    const f = 1180 * Math.pow(1.06, Math.min(i, 16));
    tone({ type: 'sine', f0: f, dur: 0.07, gain: 0.12, delay: 0 });
    tone({ type: 'sine', f0: f * 1.5, dur: 0.12, gain: 0.1, delay: 0.055 });
  },
  /** 打中河豚：惩罚 */
  puffer() {
    tone({ type: 'sawtooth', f0: 420, f1: 55, dur: 0.4, gain: 0.28 });
    noise({ dur: 0.3, gain: 0.24, f0: 900, f1: 120 });
  },
  /** 鸟 */
  bird() {
    tone({ type: 'triangle', f0: 1400, f1: 2100, dur: 0.1, gain: 0.16 });
    tone({ type: 'triangle', f0: 2100, f1: 1500, dur: 0.12, gain: 0.14, delay: 0.08 });
  },
  /** 逃脱（鱼落水） */
  escape() {
    tone({ type: 'sine', f0: 300, f1: 110, dur: 0.16, gain: 0.09 });
  },
  /** 购买 */
  buy() {
    [0, 4, 7, 12].forEach((s, i) =>
      tone({ type: 'triangle', f0: 440 * Math.pow(2, s / 12), dur: 0.16, gain: 0.16, delay: i * 0.055 }));
  },
  /** 钱不够 */
  deny() {
    tone({ type: 'square', f0: 200, f1: 130, dur: 0.14, gain: 0.14 });
    tone({ type: 'square', f0: 150, f1: 95, dur: 0.16, gain: 0.12, delay: 0.1 });
  },
  /** 结算 */
  settle() {
    [0, 5, 9, 12, 16].forEach((s, i) =>
      tone({ type: 'sine', f0: 523 * Math.pow(2, s / 12), dur: 0.22, gain: 0.13, delay: i * 0.07 }));
  },
  /** 深度记录 */
  record() {
    [0, 7, 12, 19].forEach((s, i) =>
      tone({ type: 'triangle', f0: 660 * Math.pow(2, s / 12), dur: 0.3, gain: 0.14, delay: i * 0.09 }));
  },
  /** UI 轻点 */
  tap() {
    tone({ type: 'sine', f0: 900, f1: 1300, dur: 0.05, gain: 0.1 });
  },
};
