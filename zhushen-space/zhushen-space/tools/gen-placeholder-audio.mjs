/* 生成「占位」游戏音效（纯过程合成·无版权·可商用），写到 public/audio/*.wav。
   想换真素材：把同名 .mp3 丢进 public/audio/（mp3 优先于这里的 wav）。
   重新生成：node tools/gen-placeholder-audio.mjs */
import fs from 'fs';
import path from 'path';

const SR = 22050;
const OUT = path.resolve('public/audio');
fs.mkdirSync(OUT, { recursive: true });

const TAU = Math.PI * 2;
const rnd = () => Math.random() * 2 - 1;
const clamp = (x) => Math.max(-1, Math.min(1, x));
function wavBuf(s) {
  const n = s.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const v = clamp(s[i]); b.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), 44 + i * 2); }
  return b;
}
const save = (name, s) => { fs.writeFileSync(path.join(OUT, name + '.wav'), wavBuf(s)); console.log('  ✓', name + '.wav', (s.length / SR).toFixed(2) + 's'); };
const buf = (sec) => new Float32Array(Math.floor(SR * sec));
// 一极低通（柔化噪声）
function lp(s, a) { let y = 0; for (let i = 0; i < s.length; i++) { y += a * (s[i] - y); s[i] = y; } return s; }
function hp(s, a) { let py = 0, px = 0; for (let i = 0; i < s.length; i++) { const x = s[i]; py = a * (py + x - px); px = x; s[i] = py; } return s; }
// 渐出尾巴防爆音
function tail(s, ms = 8) { const k = Math.floor(SR * ms / 1000); for (let i = 0; i < k; i++) s[s.length - 1 - i] *= i / k; return s; }

// 一段衰减正弦音（用于音符/打击）
function tone(s, off, dur, freq, amp, decay = 18, wave = 'sine') {
  const N = Math.floor(SR * dur);
  for (let i = 0; i < N; i++) {
    const t = i / SR, e = Math.exp(-t * decay);
    let w;
    if (wave === 'square') w = Math.sign(Math.sin(TAU * freq * t));
    else if (wave === 'tri') w = Math.asin(Math.sin(TAU * freq * t)) * 0.637;
    else w = Math.sin(TAU * freq * t);
    const j = off + i; if (j < s.length) s[j] += w * amp * e;
  }
}
// 噪声击（点击/沙沙）
function noise(s, off, dur, amp, decay = 30, lpa = 0.5) {
  const N = Math.floor(SR * dur), tmp = new Float32Array(N);
  for (let i = 0; i < N; i++) tmp[i] = rnd();
  lp(tmp, lpa);
  for (let i = 0; i < N; i++) { const j = off + i; if (j < s.length) s[j] += tmp[i] * amp * Math.exp(-(i / SR) * decay); }
}

/* ── 一次性音效 ── */
function dice() { const s = buf(0.5); const ts = [0, 0.09, 0.2, 0.31, 0.4]; for (const t of ts) noise(s, Math.floor(SR * t), 0.07, 0.55, 45, 0.35); return tail(s); }
function hit() { const s = buf(0.22); tone(s, 0, 0.22, 120, 0.8, 22); noise(s, 0, 0.05, 0.45, 60, 0.4); return tail(s); }
function crit() { const s = buf(0.32); tone(s, 0, 0.3, 150, 0.8, 16); tone(s, 0, 0.28, 360, 0.4, 20); noise(s, 0, 0.06, 0.6, 50, 0.6); tone(s, Math.floor(SR * 0.04), 0.22, 720, 0.25, 24, 'tri'); return tail(s); }
function block() { const s = buf(0.18); tone(s, 0, 0.16, 1100, 0.5, 40); tone(s, 0, 0.16, 1650, 0.3, 45); noise(s, 0, 0.03, 0.3, 80, 0.7); return tail(s); }
function heal() { const s = buf(0.55); const ns = [523, 659, 784]; ns.forEach((f, i) => tone(s, Math.floor(SR * i * 0.07), 0.4, f, 0.35, 6, 'sine')); return tail(s, 30); }
function msg() { const s = buf(0.18); tone(s, 0, 0.08, 880, 0.5, 30); tone(s, Math.floor(SR * 0.06), 0.1, 1320, 0.45, 26); return tail(s); }
function fanfare() { const s = buf(0.95); const ns = [523, 659, 784, 1046]; ns.forEach((f, i) => tone(s, Math.floor(SR * i * 0.14), i === 3 ? 0.5 : 0.2, f, 0.4, i === 3 ? 6 : 12, 'tri')); tone(s, Math.floor(SR * 0.42), 0.5, 1568, 0.18, 6, 'sine'); return tail(s, 40); }
function levelup() { const s = buf(0.8); const ns = [523, 698, 880, 1175, 1568]; ns.forEach((f, i) => tone(s, Math.floor(SR * i * 0.08), 0.3, f, 0.35, 10, 'tri')); return tail(s, 30); }
function coin() { const s = buf(0.32); tone(s, 0, 0.08, 988, 0.5, 18, 'square'); tone(s, Math.floor(SR * 0.07), 0.25, 1319, 0.45, 9, 'square'); return tail(s); }
function slot() { const s = buf(0.5); for (let i = 0; i < 7; i++) noise(s, Math.floor(SR * i * 0.06), 0.04, 0.4, 70, 0.6); return tail(s); }
function win() { const s = buf(0.85); const ns = [659, 784, 988, 1319]; ns.forEach((f, i) => tone(s, Math.floor(SR * i * 0.1), 0.4, f, 0.4, 8, 'tri')); for (let i = 0; i < 5; i++) tone(s, Math.floor(SR * (0.4 + i * 0.06)), 0.15, 1760 + i * 200, 0.12, 22, 'sine'); return tail(s, 40); }
function open() { const s = buf(0.45); noise(s, 0, 0.35, 0.3, 7, 0.15); hp(s, 0.7); tone(s, Math.floor(SR * 0.12), 0.3, 784, 0.25, 9, 'sine'); tone(s, Math.floor(SR * 0.12), 0.3, 1175, 0.18, 11, 'tri'); return tail(s, 30); }

/* ── 环境循环音（3s·无缝：稳态噪声 + 整周期 LFO，首尾电平接近）── */
function ambLoop(sec, build) { const s = buf(sec); build(s); // 头尾各 30ms 交叉淡化降低拼接咔哒
  const k = Math.floor(SR * 0.03); for (let i = 0; i < k; i++) { const a = i / k; const head = s[i], tailv = s[s.length - k + i]; s[i] = head * a + tailv * (1 - a); s[s.length - k + i] = tailv * (1 - a) + head * a; } return s; }
function ambRain() { return ambLoop(3, (s) => { for (let i = 0; i < s.length; i++) s[i] = rnd() * 0.5; hp(s, 0.55); lp(s, 0.6); for (let i = 0; i < s.length; i++) s[i] *= 0.5; }); }
function ambThunder() { const s = ambRain(); const r0 = Math.floor(SR * 1.0); for (let i = 0; i < SR * 0.8; i++) { const t = i / SR; s[r0 + i] += Math.sin(TAU * (55 + 10 * Math.sin(t * 6)) * t) * 0.4 * Math.exp(-t * 2) * (0.5 + 0.5 * rnd()); } return s; }
function ambWind() { return ambLoop(3, (s) => { for (let i = 0; i < s.length; i++) s[i] = rnd(); lp(s, 0.18); for (let i = 0; i < s.length; i++) { const t = i / SR; const lfo = 0.45 + 0.35 * Math.sin(TAU * (1 / 3) * t); s[i] *= lfo * 0.6; } }); }
function ambSnow() { return ambLoop(3, (s) => { for (let i = 0; i < s.length; i++) s[i] = rnd(); lp(s, 0.12); for (let i = 0; i < s.length; i++) { const t = i / SR; s[i] *= (0.35 + 0.2 * Math.sin(TAU * (2 / 3) * t)) * 0.4; } }); }
function ambFog() { return ambLoop(3, (s) => { for (let i = 0; i < s.length; i++) { const t = i / SR; s[i] = Math.sin(TAU * 80 * t) * 0.12 + Math.sin(TAU * 120 * t) * 0.06 + rnd() * 0.04; } lp(s, 0.4); }); }

console.log('生成占位音效 →', OUT);
const all = { dice, hit, crit, block, heal, msg, fanfare, levelup, coin, slot, win, open,
  'amb-rain': ambRain, 'amb-thunder': ambThunder, 'amb-snow': ambSnow, 'amb-wind': ambWind, 'amb-fog': ambFog };
for (const [name, fn] of Object.entries(all)) save(name, fn());
console.log('完成：', Object.keys(all).length, '个文件');
