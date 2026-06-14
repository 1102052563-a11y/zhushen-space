import { useState } from 'react';
import { useCharacters, type SubProfession, type Recipe } from '../store/characterStore';

/* 副职业库（主角 B1）：生活/制造/社交类手艺 + 名下配方，双层熟练度。 */

const TIER_CLS: Record<string, string> = {
  新手: 'text-slate-400 border-slate-500/50',
  熟练: 'text-emerald-300 border-emerald-600/50',
  专家: 'text-sky-300 border-sky-600/50',
  大师: 'text-violet-300 border-violet-600/50',
  宗师: 'text-amber-300 border-amber-500/50',
};
const BAR_CLS: Record<string, string> = {
  新手: 'bg-slate-400', 熟练: 'bg-emerald-400', 专家: 'bg-sky-400', 大师: 'bg-violet-400', 宗师: 'bg-amber-400',
};

function Bar({ value, cls }: { value: number; cls: string }) {
  return (
    <div className="h-1.5 bg-void rounded-full overflow-hidden border border-edge/40">
      <div className={`h-full ${cls} transition-all`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export default function SubProfessionPanel({ onClose }: { onClose: () => void }) {
  const list = useCharacters((s) => s.characters['B1']?.subProfessions ?? []);
  const removeSubProfession = useCharacters((s) => s.removeSubProfession);
  const removeRecipe = useCharacters((s) => s.removeRecipe);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between p-4 border-b border-edge shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🛠</span>
              <h2 className="text-base font-bold text-slate-100">副职业</h2>
              <span className="text-[13px] font-mono text-dim/50">共 {list.length} 门</span>
            </div>
            <p className="text-[13px] text-dim/60 mt-0.5">生活/制造/社交类手艺；总熟练度决定可掌握的配方阶位，各配方有自己的熟练度。靠剧情实践提升。</p>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {list.length === 0 && (
            <div className="text-center text-dim/40 text-sm py-12">暂无副职业。会在剧情中习得（如成为机械师、药剂师），由叙事自动写入。</div>
          )}
          {list.map((sp) => (
            <SubProfCard key={sp.name} sp={sp}
              onDelete={() => removeSubProfession('B1', sp.name)}
              onDeleteRecipe={(rn) => removeRecipe('B1', sp.name, rn)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SubProfCard({ sp, onDelete, onDeleteRecipe }: { sp: SubProfession; onDelete: () => void; onDeleteRecipe: (rn: string) => void }) {
  const [open, setOpen] = useState(false);
  const tcls = TIER_CLS[sp.tier] ?? TIER_CLS['新手'];
  const bcls = BAR_CLS[sp.tier] ?? BAR_CLS['新手'];
  const recipes = sp.recipes ?? [];
  const label = sp.recipeLabel || '配方';
  return (
    <div className={`rounded-xl border p-3 space-y-2 bg-panel ${tcls}`}>
      <div className="flex items-center gap-2">
        <span className="flex-1 font-semibold text-sm text-slate-100 truncate">{sp.name}</span>
        {sp.category && <span className="text-[11px] font-mono text-dim/50">{sp.category}</span>}
        <span className={`text-[12px] font-mono font-bold ${tcls.split(' ')[0]}`}>{sp.tier}</span>
      </div>
      {/* 总熟练度进度条 */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono text-dim/50 shrink-0">总熟练</span>
        <div className="flex-1"><Bar value={sp.progress ?? 0} cls={bcls} /></div>
        <span className="text-[11px] font-mono text-dim/60 shrink-0 w-10 text-right">{sp.progress ?? 0}%</span>
      </div>
      {sp.effect && <div className="text-[12px] text-slate-300/80 leading-relaxed"><span className="text-dim/40">效果·</span>{sp.effect}</div>}
      {sp.desc && <div className="text-[12px] text-dim/55 leading-relaxed italic">{sp.desc}</div>}

      <div className="flex items-center justify-between pt-0.5">
        <button onClick={() => setOpen((o) => !o)} className="text-[12px] font-mono text-god/70 hover:text-god transition-colors">
          {open ? '收起' : `${label}（${recipes.length}）▾`}
        </button>
        <button onClick={onDelete} className="text-[11px] font-mono text-blood/50 hover:text-blood transition-colors">删除</button>
      </div>

      {open && recipes.length > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-edge/40">
          {recipes.map((r) => <RecipeRow key={r.id || r.name} r={r} onDelete={() => onDeleteRecipe(r.name)} />)}
        </div>
      )}
      {open && recipes.length === 0 && <div className="text-[12px] text-dim/40 pt-1 border-t border-edge/40">暂无{label}</div>}
    </div>
  );
}

function RecipeRow({ r, onDelete }: { r: Recipe; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-edge/50 bg-void/40 px-2.5 py-1.5">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <span className="flex-1 text-[13px] text-slate-200 truncate">{r.name}</span>
        {r.tier && <span className="text-[11px] font-mono text-dim/50">{r.tier}</span>}
        <span className="text-[11px] font-mono text-dim/60 w-9 text-right">{r.progress ?? 0}%</span>
      </div>
      <div className="mt-1"><Bar value={r.progress ?? 0} cls="bg-god/70" /></div>
      {open && (
        <div className="mt-1.5 space-y-0.5 text-[12px] text-dim/70 leading-relaxed">
          {r.materials && <div><span className="text-dim/45">材料·</span>{r.materials}</div>}
          {r.output && <div><span className="text-dim/45">产物·</span>{r.output}</div>}
          {r.desc && <div className="italic text-dim/55">{r.desc}</div>}
          <div className="flex justify-end"><button onClick={onDelete} className="text-[11px] text-blood/50 hover:text-blood">删除</button></div>
        </div>
      )}
    </div>
  );
}
