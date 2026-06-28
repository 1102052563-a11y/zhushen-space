import { useState } from 'react';
import { useFieldHistory, type HistPoint } from '../store/fieldHistoryStore';
import { useNpc } from '../store/npcStore';

/* 字段历史趋势：选实体 + 字段 → 看它过去 N 回合的取值时间线（数字画 sparkline + 列每次变动的增减）。 */

const DIM_CN: Record<string, string> = { str: '力量', agi: '敏捷', con: '体质', int: '智力', cha: '魅力', luck: '幸运' };
const SIX = ['str', 'agi', 'con', 'int', 'cha', 'luck'];

function Sparkline({ pts }: { pts: HistPoint[] }) {
  const nums = pts.filter((p) => typeof p.value === 'number') as { turn: number; value: number }[];
  if (nums.length < 2) return null;
  const W = 320, H = 48, pad = 4;
  const vs = nums.map((p) => p.value);
  const min = Math.min(...vs), max = Math.max(...vs);
  const span = max - min || 1;
  const t0 = nums[0].turn, t1 = nums[nums.length - 1].turn, tSpan = (t1 - t0) || 1;
  const xy = nums.map((p) => [pad + ((p.turn - t0) / tSpan) * (W - 2 * pad), pad + (1 - (p.value - min) / span) * (H - 2 * pad)]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="block" preserveAspectRatio="none">
      <path d={d} fill="none" stroke="#2dd4bf" strokeWidth={1.5} />
      {xy.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.8} fill="#5eead4" />)}
    </svg>
  );
}

export default function FieldTrend() {
  const series = useFieldHistory((s) => s.series);
  const npcs = useNpc((s) => s.npcs);
  const [entity, setEntity] = useState('player');
  const [field, setField] = useState('con');

  const aliveNpcs = Object.values(npcs).filter((n: any) => !n.isDead && n.name && n.name !== n.id) as any[];
  const fields = entity === 'player' ? SIX : [...SIX, 'realm', 'level'];
  const key = entity === 'player' ? `player:${field}` : `npc:${entity}:${field}`;
  const pts = series[key] ?? [];
  const fieldLabel = (f: string) => DIM_CN[f] || (f === 'realm' ? '阶位' : f === 'level' ? '等级' : f);

  return (
    <div className="space-y-2 text-sm">
      <div className="text-[11px] text-slate-500 leading-snug">竖着看一个字段：它过去几回合<b className="text-slate-300">怎么一步步变成现在这样</b>。看到某回合无故掉了 → 去 🔒 锁死它。只记<b className="text-slate-300">值变了</b>的回合。</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <select value={entity} onChange={(e) => setEntity(e.target.value)} className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200">
          <option value="player">主角</option>
          {aliveNpcs.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <select value={field} onChange={(e) => setField(e.target.value)} className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200">
          {fields.map((f) => <option key={f} value={f}>{fieldLabel(f)}</option>)}
        </select>
      </div>

      {pts.length === 0 ? (
        <div className="text-slate-500 text-xs py-2">（暂无历史——这个字段还没在某回合发生过变化，或刚开始记录）</div>
      ) : (
        <div className="border border-slate-700/50 rounded p-2 space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-teal-300 text-xs font-semibold">{entity === 'player' ? '主角' : (npcs as any)[entity]?.name} · {fieldLabel(field)}</span>
            <span className="text-slate-400 text-xs">当前 <b className="text-teal-200">{String(pts[pts.length - 1].value)}</b></span>
          </div>
          <Sparkline pts={pts} />
          <div className="max-h-40 overflow-y-auto space-y-0.5 pr-1 font-mono text-[11px]">
            {pts.slice().reverse().map((p, i, arr) => {
              const prev = arr[i + 1];
              let delta: number | null = null;
              if (prev && typeof p.value === 'number' && typeof prev.value === 'number') delta = p.value - prev.value;
              return (
                <div key={`${p.turn}-${i}`} className="flex items-center gap-2">
                  <span className="text-slate-500 w-8 text-right shrink-0">T{p.turn}</span>
                  <span className="text-slate-200">{String(p.value)}</span>
                  {delta !== null && delta !== 0 && (
                    <span className={delta > 0 ? 'text-emerald-300/80' : 'text-rose-300/90'}>{delta > 0 ? `+${delta}` : delta}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
