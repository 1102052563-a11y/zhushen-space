import { useEffect, useRef, useState } from 'react';
import type { DiceMode } from '../systems/diceEngine';

/* 摇骰动画（受控）：父组件先算好结果，传入 finalValue + outcome，并把 rollToken +1 触发动画。
   组件做"数字滚动 + 骰体摇晃"，animMs 后定格在 finalValue 并按 outcome 着色。动画常驻（无跳过）。 */

export type RollOutcome = 'none' | 'crit' | 'fumble' | 'success' | 'fail';
interface Props {
  mode: DiceMode;
  finalValue: number;
  outcome: RollOutcome;
  rollToken: number;     // 每次 +1 重新播放
  animMs?: number;
  size?: number;
}

const COLOR: Record<RollOutcome, { stroke: string; num: string; fill: string }> = {
  none: { stroke: '#5eead4', num: '#e2f5f0', fill: 'rgba(94,234,212,0.06)' },
  success: { stroke: '#4ade80', num: '#bbf7d0', fill: 'rgba(74,222,128,0.10)' },
  crit: { stroke: '#fbbf24', num: '#fde68a', fill: 'rgba(251,191,36,0.14)' },
  fumble: { stroke: '#f87171', num: '#fecaca', fill: 'rgba(248,113,113,0.14)' },
  fail: { stroke: '#94a3b8', num: '#cbd5e1', fill: 'rgba(148,163,184,0.08)' },
};

const CSS = `
@keyframes zsDiceRoll{0%{transform:rotate(0) scale(1)}20%{transform:rotate(180deg) scale(1.08)}50%{transform:rotate(320deg) scale(.94)}75%{transform:rotate(430deg) scale(1.06)}100%{transform:rotate(360deg) scale(1)}}
@keyframes zsDicePulse{0%{transform:scale(1)}40%{transform:scale(1.07)}100%{transform:scale(1)}}
.zs-dice-rolling{animation:zsDiceRoll var(--zs-dice-ms,760ms) ease-out;}
.zs-dice-pulse{animation:zsDicePulse .5s ease-out;}
`;

export default function DiceRoller({ mode, finalValue, outcome, rollToken, animMs = 760, size = 168 }: Props) {
  const [display, setDisplay] = useState(finalValue);
  const [rolling, setRolling] = useState(false);
  const [pulse, setPulse] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ivRef = useRef<number | null>(null);

  useEffect(() => {
    if (rollToken <= 0) return;
    setRolling(true);
    setPulse(false);
    const max = mode === 'd20' ? 20 : 100;
    if (ivRef.current) window.clearInterval(ivRef.current);
    ivRef.current = window.setInterval(() => setDisplay(Math.floor(Math.random() * max) + 1), 60);
    const t = window.setTimeout(() => {
      if (ivRef.current) { window.clearInterval(ivRef.current); ivRef.current = null; }
      setDisplay(finalValue);
      setRolling(false);
      if (outcome === 'crit' || outcome === 'fumble') setPulse(true);
    }, animMs);
    return () => { window.clearTimeout(t); if (ivRef.current) { window.clearInterval(ivRef.current); ivRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollToken]);

  const c = rolling ? COLOR.none : COLOR[outcome];
  const cls = `${rolling ? 'zs-dice-rolling' : ''} ${pulse && !rolling ? 'zs-dice-pulse' : ''}`;

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <style>{CSS}</style>
      <div
        ref={wrapRef}
        className={cls}
        style={{ width: size, height: size, transformOrigin: '50% 50%', ['--zs-dice-ms' as any]: `${animMs}ms`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {mode === 'd20' ? (
          <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label="d20 骰子">
            <polygon points="100,20 169.3,60 169.3,140 100,180 30.7,140 30.7,60" fill={c.fill} stroke={c.stroke} strokeWidth={2} strokeLinejoin="round" />
            <line x1="100" y1="46" x2="100" y2="20" stroke={c.stroke} strokeOpacity={0.45} strokeWidth={1} />
            <line x1="100" y1="46" x2="30.7" y2="60" stroke={c.stroke} strokeOpacity={0.45} strokeWidth={1} />
            <line x1="100" y1="46" x2="169.3" y2="60" stroke={c.stroke} strokeOpacity={0.45} strokeWidth={1} />
            <line x1="55" y1="128" x2="30.7" y2="140" stroke={c.stroke} strokeOpacity={0.45} strokeWidth={1} />
            <line x1="55" y1="128" x2="100" y2="180" stroke={c.stroke} strokeOpacity={0.45} strokeWidth={1} />
            <line x1="145" y1="128" x2="169.3" y2="140" stroke={c.stroke} strokeOpacity={0.45} strokeWidth={1} />
            <line x1="145" y1="128" x2="100" y2="180" stroke={c.stroke} strokeOpacity={0.45} strokeWidth={1} />
            <polygon points="100,46 55,128 145,128" fill={c.fill} stroke={c.stroke} strokeWidth={1.5} strokeLinejoin="round" />
            <text x="100" y="100" textAnchor="middle" dominantBaseline="middle" fontSize="44" fontWeight={600} fill={c.num}>{display}</text>
          </svg>
        ) : (
          <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label="d100 百分骰">
            <rect x="34" y="34" width="132" height="132" rx="22" fill={c.fill} stroke={c.stroke} strokeWidth={2} />
            <text x="100" y="92" textAnchor="middle" dominantBaseline="middle" fontSize="52" fontWeight={600} fill={c.num}>{display}</text>
            <text x="100" y="138" textAnchor="middle" dominantBaseline="middle" fontSize="16" fill={c.stroke}>d100</text>
          </svg>
        )}
      </div>
    </div>
  );
}
