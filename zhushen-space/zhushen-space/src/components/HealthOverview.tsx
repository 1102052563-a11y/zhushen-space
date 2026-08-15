/* 🩺 运行概览（借鉴 ACU 仪表盘）：绿/琥珀/红 健康行 + 最近失败自动归因。
   挂在 变量管理（演化功能中心）顶部——所有诊断一眼总览，细节各自去对应面板。
   纯展示：数据全部来自 systems/healthOverview.ts 现算（订阅回合报告/填表失败清单以自动刷新）。 */
import { useReducer } from 'react';
import { useTurnReport } from '../store/turnReportStore';
import { useTableJournal } from '../store/tableJournalStore';
import { buildHealthRows, classifyFailures, collectRecentFailures } from '../systems/healthOverview';

const DOT: Record<string, string> = { ok: 'text-emerald-400', warn: 'text-amber-300', bad: 'text-rose-400' };

export default function HealthOverview() {
  useTurnReport((s) => s.records.length);      // 订阅：新回合报告进来自动重算
  useTableJournal((s) => s.lastErrors.length); // 订阅：填表失败清单变化自动重算
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const rows = buildHealthRows();
  const buckets = classifyFailures(collectRecentFailures());
  const worst = rows.some((r) => r.level === 'bad') ? 'bad' : rows.some((r) => r.level === 'warn') ? 'warn' : 'ok';

  return (
    <div className={`mb-7 rounded-xl border p-3.5 bg-black/20 ${worst === 'bad' ? 'border-rose-600/50' : worst === 'warn' ? 'border-amber-600/40' : 'border-edge/50'}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-semibold text-slate-200">🩺 运行概览</span>
        <span className="text-[11px] text-dim/55 flex-1">接口 / 填表 / 状态指令 / 一致性 一眼总览；只有琥珀·红行需要看，绿的不用管</span>
        <button onClick={refresh} className="text-[11px] px-2 py-0.5 rounded border border-edge text-dim hover:text-slate-200 hover:border-god/40" title="重新检查">↻</button>
      </div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.title} className="flex items-start gap-2 text-[12px] leading-relaxed">
            <span className={`shrink-0 ${DOT[r.level]}`}>●</span>
            <span className="shrink-0 text-slate-300 font-semibold">{r.icon} {r.title}</span>
            <span className="text-dim/80 min-w-0">{r.text}</span>
          </div>
        ))}
        {buckets.length > 0 && (
          <div className="mt-2 pt-2 border-t border-edge/40 space-y-1">
            <div className="text-[11px] text-dim/60">🧭 最近失败归因（自动分类·各给一句处置）：</div>
            {buckets.map((b) => (
              <div key={b.bucket} className="flex items-start gap-2 text-[11px] leading-relaxed">
                <span className="shrink-0 text-amber-300/80">{b.label} ×{b.count}</span>
                <span className="text-dim/70 min-w-0">{b.hint} <span className="text-dim/45">例：{b.example}</span></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
