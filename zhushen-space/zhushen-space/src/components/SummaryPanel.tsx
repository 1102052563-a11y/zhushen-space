import { useState } from 'react';
import { useMisc } from '../store/miscStore';

type Tab = 'facts' | 'small' | 'large';

/* 记忆面板：查看长期事实（叙事记忆抽取）/ 小总结 / 大总结（杂项演化产出）*/
export default function SummaryPanel({ onClose, onManualUpdate }: { onClose: () => void; onManualUpdate?: () => Promise<void> }) {
  const small = useMisc((s) => s.smallSummaries);
  const large = useMisc((s) => s.largeSummaries);
  const facts = useMisc((s) => s.narrativeFacts);
  const removeFact = useMisc((s) => s.removeNarrativeFact);
  const [tab, setTab] = useState<Tab>('facts');
  const [updating, setUpdating] = useState(false);   // 长期事实「手动更新」中
  const list = tab === 'small' ? small : large;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[88dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">

        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/60 text-lg">🧠</span>
          <div className="flex-1">
            <div className="text-base font-bold text-slate-100">记忆 · 剧情总结</div>
            <div className="text-[12px] font-mono text-dim/60">由杂项演化滚动产出，供叙事记忆注入正文</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-edge bg-panel">
          {([['facts', '长期事实', facts.length], ['small', '小总结', small.length], ['large', '大总结', large.length]] as const).map(([k, label, n]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1 rounded text-sm font-mono border transition-colors ${tab === k ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>
              {label}{n > 0 ? ` (${n})` : ''}
            </button>
          ))}
          {tab === 'facts' && onManualUpdate && (
            <button
              onClick={async () => { if (updating) return; setUpdating(true); try { await onManualUpdate(); } finally { setUpdating(false); } }}
              disabled={updating}
              title="按最近一次正文(+你上一条输入)强制抽取一次长期事实（绕过自动开关，需先配置「叙事记忆」接口）"
              className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded text-sm font-mono border border-god/40 text-god hover:bg-god/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {updating ? <><span className="animate-spin inline-block">◌</span> 更新中…</> : <>⟳ 手动更新</>}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {tab === 'facts' ? (
            facts.length === 0 ? (
              <div className="py-16 text-center text-dim/40 text-sm font-mono border border-dashed border-edge rounded-xl">
                暂无长期事实
                <div className="mt-2 text-dim/30">在「🧠 叙事记忆」开启「LLM 整理/抽取」后，每轮自动抽取</div>
              </div>
            ) : (
              [...facts].reverse().map((f) => (
                <div key={f.id} className="rounded-lg border border-god/20 bg-god/5 px-3 py-2">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[12px] font-mono text-dim/40">{f.id}</span>
                    <span className="text-sm font-semibold text-slate-100 flex-1 truncate">{f.title}</span>
                    <button onClick={() => removeFact(f.id)} className="text-[12px] font-mono text-blood/50 hover:text-blood">删</button>
                  </div>
                  <div className="text-[14px] text-slate-300 leading-relaxed">{f.text}</div>
                  {f.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {f.keywords.map((k, i) => <span key={i} className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-void/60 text-dim/60">{k}</span>)}
                    </div>
                  )}
                </div>
              ))
            )
          ) : list.length === 0 ? (
            <div className="py-16 text-center text-dim/40 text-sm font-mono border border-dashed border-edge rounded-xl">
              {tab === 'small' ? '暂无小总结' : '暂无大总结'}
              <div className="mt-2 text-dim/30">启用「🧩 杂项演化」后，每回合自动生成</div>
            </div>
          ) : (
            [...list].reverse().map((s, i) => (
              <div key={i} className={`rounded-lg border px-3 py-2 text-[14px] leading-relaxed ${
                tab === 'large' ? 'border-god/20 bg-god/5 text-slate-300' : 'border-edge bg-panel/60 text-dim/80'
              }`}>
                <div className="text-[11px] font-mono text-dim/40 mb-1">#{list.length - i}{i === 0 ? ' · 最新' : ''}</div>
                {s}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
