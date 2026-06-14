import { useGame } from '../store/gameStore';
import { useVariables } from '../store/variableStore';
import { power } from '../systems/combat';
import Bar from './Bar';

export default function StatusBar() {
  const p = useGame((s) => s.player);
  const customVars = useVariables((s) => s.variables.filter((v) => v.showInStatusBar));

  return (
    <div className="p-3 space-y-2">
      <Bar value={p.hp} max={p.maxHp} color="bg-blood" label="生命" />
      <Bar value={p.mp ?? 0} max={p.maxMp ?? 0} color="bg-sky-500" label="法力" />
      <Bar value={p.san} max={p.maxSan} color="bg-san" label="精神" />
      <div className="flex items-center justify-between pt-1">
        <div className="flex gap-3 text-sm font-mono">
          <Stat label="攻击" value={p.atk} />
          <Stat label="防御" value={p.def} />
          <Stat label="战力" value={power(p)} accent />
        </div>
        <div className="text-right">
          <div className="text-[12px] text-dim font-mono">奖励点</div>
          <div className="text-base font-bold text-gold font-mono god-glow leading-none">{p.points}</div>
        </div>
      </div>
      {customVars.length > 0 && (
        <div className="border-t border-edge pt-2 space-y-1">
          {customVars.map((v) => (
            <div key={v.key} className="flex items-center justify-between text-sm font-mono">
              <span className="text-dim truncate max-w-[6rem]">{v.label || v.key}</span>
              {v.type === 'boolean' ? (
                <span className={v.value ? 'text-god' : 'text-dim/50'}>
                  {v.value ? '✓ 是' : '✗ 否'}
                </span>
              ) : v.type === 'number' && v.max !== undefined ? (
                <span className="text-slate-300">
                  {String(v.value)}
                  <span className="text-dim/50">/{v.max}</span>
                </span>
              ) : (
                <span className="text-slate-300 truncate max-w-[5rem]">{String(v.value)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <div className="text-[12px] text-dim">{label}</div>
      <div className={`text-sm font-bold ${accent ? 'text-god' : 'text-slate-200'}`}>{value}</div>
    </div>
  );
}
