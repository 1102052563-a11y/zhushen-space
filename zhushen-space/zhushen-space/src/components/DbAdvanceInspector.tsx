import { useState } from 'react';
import { useDbAdvance } from '../store/dbAdvanceStore';

/* 数据库推进·诊断面板（把管线活状态开放出来·只读）。
   治「召回 / 推进貌似没生效」——一眼看出：① 预设的模块名是否按 `召回`/`推进` 命中（管线按名查找，名不对该阶段被整段跳过）；
   ② 上一回合各阶段到底出没出东西（recall/stage/scene/tabletop 的字数 + 原文）。跑一回合正文后回来看即可定位。 */
export default function DbAdvanceInspector() {
  const preset = useDbAdvance((s) => s.preset);
  const useRecall = useDbAdvance((s) => s.useRecall);
  const lastRecall = useDbAdvance((s) => s.lastRecall);
  const lastStage = useDbAdvance((s) => s.lastStage);
  const lastScene = useDbAdvance((s) => s.lastScene);
  const lastTabletop = useDbAdvance((s) => s.lastTabletop);
  const [open, setOpen] = useState(false);

  const mods = preset?.plotTasks ?? [];
  const hasRecall = mods.some((m) => m.name === '召回');
  const hasAdvance = mods.some((m) => m.name === '推进');

  const outputs: { label: string; v: string; note?: string }[] = [
    { label: 'recall 召回', v: lastRecall, note: useRecall ? '喂给推进 + directive({{recall}})' : '⚠ 召回开关关着·本就不跑' },
    { label: 'stage', v: lastStage, note: '→ finalSystemDirective 的 {{stage}} 注入正文' },
    { label: 'scene', v: lastScene, note: '→ {{scene}} 注入正文' },
    { label: 'tabletop 推演', v: lastTabletop, note: '各角色行动/台词·本轮已注入 + 下轮 {{tabletop}}' },
  ];

  return (
    <div className="pt-2 space-y-1.5 border-t border-edge/60">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-[12px] font-mono text-god/70 hover:text-god transition-colors">
        🔬 诊断 · 模块命中 + 上次各阶段产出 <span className="text-dim/40">看召回/推进到底出没出东西</span>
        <span className={`ml-auto text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="space-y-2">
          {/* 预设模块命中 */}
          {!preset ? (
            <div className="text-[12px] font-mono text-amber-300/70">尚未导入推进预设。</div>
          ) : (
            <div className="text-[12px] font-mono text-dim/70 space-y-0.5 border border-edge/50 rounded p-2 bg-void/40">
              <div>预设模块（{mods.length}）：<span className="text-slate-300/85">{mods.map((m) => m.name || '?').join(' · ') || '（无）'}</span></div>
              <div className={hasRecall ? 'text-emerald-300/70' : 'text-blood/80'}>{hasRecall ? '✓ 「召回」模块命中' : '⚠ 无叫「召回」的模块 → 管线按名查找失败、召回被跳过（把该模块 name 改成「召回」，或让我加模糊匹配）'}</div>
              <div className={hasAdvance ? 'text-emerald-300/70' : 'text-blood/80'}>{hasAdvance ? '✓ 「推进」模块命中' : '⚠ 无叫「推进」的模块 → 推进被跳过、整个管线返回空'}</div>
            </div>
          )}
          {/* 上次各阶段产出 */}
          <div className="space-y-1.5">
            {outputs.map((o) => (
              <div key={o.label} className="rounded border border-edge/60 overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-2 py-1 bg-void/50 text-[11px] font-mono">
                  <span className="text-god/75 truncate">{o.label}<span className="text-dim/40 ml-1.5">{o.note}</span></span>
                  <span className={`shrink-0 ${o.v?.trim() ? 'text-dim/50' : 'text-blood/70'}`}>{o.v?.trim() ? `${o.v.length} 字` : '空'}</span>
                </div>
                {o.v?.trim() && (
                  <pre className="px-2 py-1.5 text-[11px] font-mono text-slate-300/85 whitespace-pre-wrap break-words max-h-40 overflow-y-auto leading-snug">{o.v}</pre>
                )}
              </div>
            ))}
          </div>
          <div className="text-[11px] font-mono text-dim/45 leading-snug">开着数据库推进跑一回合正文后回来看：某段「空」= 那阶段没产出/没抽到。stage/scene 空但 tabletop / recall 有 = 你预设的标签跟管线的 stage/scene 对不上（正文靠 tabletop 注入 + 整段兜底走）。recall 一直空且上面显示「召回命中」= 多半 AI 那次回了空，或召回模块提示词问题。</div>
        </div>
      )}
    </div>
  );
}
