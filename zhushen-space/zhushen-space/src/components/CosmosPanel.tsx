import { useState } from 'react';
import { useCosmos, COSMOS_CATEGORIES, type CosmosCategory, type CosmosEntity } from '../store/cosmosStore';

/* 万族态势面板：宇宙背景层（七乐园/虚空万族/文明组织/原生世界/神灵/深渊）的只读浏览。
   顶部七乐园战力排行榜 + 按类型分 tab + 实体卡。 */

const STATUS_CLS: Record<string, string> = {
  鼎盛: 'text-emerald-300 border-emerald-600/40 bg-emerald-900/15',
  扩张: 'text-emerald-300 border-emerald-600/40 bg-emerald-900/15',
  稳固: 'text-slate-300 border-edge bg-panel/50',
  衰退: 'text-amber-300 border-amber-600/40 bg-amber-900/15',
  困顿: 'text-amber-300 border-amber-600/40 bg-amber-900/15',
  沉寂: 'text-zinc-400 border-zinc-600/40 bg-zinc-800/20',
  封印: 'text-sky-300 border-sky-600/40 bg-sky-900/15',
  复苏: 'text-cyan-300 border-cyan-600/40 bg-cyan-900/15',
  覆灭: 'text-rose-400/70 border-rose-900/40 bg-rose-950/20',
};
const CAT_ICON: Record<CosmosCategory, string> = {
  乐园: '🏛', 种族: '👽', 文明组织: '⚙', 原生世界: '🌐', 神灵: '✨', 深渊: '🕳',
};
const PRIORITY_LABEL = ['核心', '次要', '边缘'];

function EntityCard({ e }: { e: CosmosEntity }) {
  const [open, setOpen] = useState(false);
  const cls = STATUS_CLS[e.status] ?? STATUS_CLS['稳固'];
  return (
    <div className={`rounded-xl border px-3 py-2 transition-colors ${e.destroyed ? 'opacity-50' : ''} ${cls}`}>
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base">{CAT_ICON[e.category]}</span>
          <span className="text-sm font-bold text-slate-100">{e.name}</span>
          {e.rank != null && <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-god/40 text-god bg-god/10">第{e.rank}</span>}
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-current/40">{e.status}</span>
          {!e.isPlayerKnown && <span className="text-[10px] font-mono text-dim/40">未接触</span>}
          <span className="flex-1" />
          <span className="text-[10px] font-mono text-dim/35">{PRIORITY_LABEL[e.priority] ?? ''}</span>
        </div>
        {e.power && <div className="text-[12px] text-dim/75 mt-0.5 leading-snug">{e.power}</div>}
      </button>
      {open && (
        <div className="mt-2 pt-2 border-t border-current/15 space-y-1 text-[12px] text-dim/80 leading-relaxed">
          {e.territory && <div><span className="text-dim/45">疆域·</span>{e.territory}</div>}
          {e.resources && <div><span className="text-dim/45">资源·</span>{e.resources}</div>}
          {e.goal && <div><span className="text-dim/45">动向·</span>{e.goal}</div>}
          {e.towardParadise && <div><span className="text-dim/45">对轮回乐园·</span>{e.towardParadise}</div>}
          {e.relations.length > 0 && <div><span className="text-dim/45">关系·</span>{e.relations.map((r) => `${r.target}(${r.relation})`).join('、')}</div>}
          {Object.entries(e.extra).map(([k, v]) => <div key={k}><span className="text-dim/45">{k}·</span>{v}</div>)}
          {e.era && <div className="text-dim/55 italic">纪元：{e.era}</div>}
          {e.deeds.length > 0 && (
            <div className="pt-1">
              <div className="text-dim/45 mb-0.5">大事记</div>
              <div className="space-y-0.5">
                {e.deeds.slice(0, 8).map((d, i) => (
                  <div key={i} className="flex gap-1.5"><span className="text-god/40">·</span><span className="flex-1">{d.time ? `[${d.time}] ` : ''}{d.desc}</span></div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CosmosPanel({ onClose }: { onClose: () => void }) {
  const entities = useCosmos((s) => s.entities);
  const enabled = useCosmos((s) => s.settings.enabled);
  const [tab, setTab] = useState<CosmosCategory | '全部'>('全部');

  const paradises = entities.filter((e) => e.category === '乐园').sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const list = (tab === '全部' ? entities : entities.filter((e) => e.category === tab))
    .slice()
    .sort((a, b) => Number(a.destroyed) - Number(b.destroyed) || a.priority - b.priority);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[88vh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">

        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-fuchsia-300/80 text-lg">🌌</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">万族态势</div>
            <div className="text-[12px] font-mono text-dim/60 truncate">轮回乐园宇宙宏观格局 · 头顶自转的背景层</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {!enabled && entities.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center text-dim/50 text-sm font-mono">
            <div>
              万族演化未启用 / 棋盘为空。<br />
              去「设置 → 变量管理 → 🌌 万族演化」启用并选择种子（忠于原著 / 随机生成）。
            </div>
          </div>
        ) : (
          <>
            {/* 七乐园战力排行榜 */}
            {paradises.length > 0 && (
              <div className="shrink-0 px-4 py-2 border-b border-edge bg-panel/40">
                <div className="text-[11px] font-mono text-dim/50 mb-1">七乐园战力排行</div>
                <div className="flex flex-wrap gap-1.5">
                  {paradises.map((p) => (
                    <span key={p.id} className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${STATUS_CLS[p.status] ?? STATUS_CLS['稳固']} ${p.destroyed ? 'opacity-50' : ''}`}>
                      {p.rank ?? '?'}·{p.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 分类 tab */}
            <div className="shrink-0 flex gap-1 px-4 py-2 border-b border-edge bg-panel flex-wrap">
              {(['全部', ...COSMOS_CATEGORIES] as const).map((c) => {
                const n = c === '全部' ? entities.length : entities.filter((e) => e.category === c).length;
                if (c !== '全部' && n === 0) return null;
                return (
                  <button key={c} onClick={() => setTab(c)}
                    className={`px-2.5 py-1 rounded text-sm font-mono border transition-colors ${tab === c ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>
                    {c}{n > 0 ? ` (${n})` : ''}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 content-start">
              {list.length === 0 ? (
                <div className="col-span-full py-12 text-center text-dim/40 text-sm font-mono">该分类暂无实体</div>
              ) : (
                list.map((e) => <EntityCard key={e.id} e={e} />)
              )}
            </div>
          </>
        )}

        <div className="shrink-0 px-4 py-2 border-t border-edge bg-panel/60 text-[11px] font-mono text-dim/40 text-center">
          这是宇宙背景层（多数与主角无关）；前期纯氛围，中后期主角才够格搅动。点实体卡展开详情。
        </div>
      </div>
    </div>
  );
}
