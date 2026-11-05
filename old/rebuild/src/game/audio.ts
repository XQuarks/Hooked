let ctx: AudioContext | null = null;
let enabled = true;

export function setSound(on: boolean) {
  enabled = on;
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** 页面首次交互时调用，解锁移动端音频 */
export function unlockAudio() {
  ac();
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.06, slide = 0) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}

function noise(dur: number, vol = 0.1, hp = 800, lp = 12000) {
  const a = ac();
  if (!a) return;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const f2 = a.createBiquadFilter();
  f2.type = 'lowpass';
  f2.frequency.value = lp;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(f2).connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  shot: () => noise(0.07, 0.09, 1200),
  boom: () => {
    noise(0.45, 0.22, 90, 4000);
    tone(90, 0.4, 'sawtooth', 0.09, -60);
  },
  hit: () => tone(520, 0.06, 'square', 0.05, 200),
  kill: () => tone(880, 0.12, 'triangle', 0.07, 400),
  combo: (stack: number) => {
    const base = 660 * Math.pow(1.06, Math.min(stack, 14));
    tone(base, 0.1, 'triangle', 0.055, 240);
  },
  bad: () => tone(200, 0.32, 'sawtooth', 0.07, -120),
  catchFish: () => tone(600, 0.08, 'sine', 0.07, 320),
  splash: () => noise(0.3, 0.09, 260, 5200),
  saw: () => noise(0.16, 0.08, 1800),
  zap: () => {
    tone(1200, 0.18, 'sawtooth', 0.06, -900);
    noise(0.18, 0.06, 2600);
  },
  bump: () => tone(150, 0.24, 'triangle', 0.11, -60),
  cash: () => {
    tone(988, 0.08, 'square', 0.045);
    setTimeout(() => tone(1319, 0.16, 'square', 0.045), 70);
  },
  ring: () => {
    tone(740, 0.16, 'sine', 0.055);
    setTimeout(() => tone(880, 0.22, 'sine', 0.055), 170);
  },
  click: () => tone(1000, 0.03, 'square', 0.025),
  pop: () => tone(400, 0.09, 'sine', 0.055, 500),
  overheat: () => {
    noise(0.5, 0.1, 600, 3000);
    tone(240, 0.3, 'sawtooth', 0.05, -120);
  },
  push: () => noise(0.35, 0.07, 120, 900),
};
