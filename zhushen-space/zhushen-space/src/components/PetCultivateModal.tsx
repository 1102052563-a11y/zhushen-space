import { useState, useEffect } from 'react';
import { useItems } from '../store/itemStore';

/* 宠物/召唤物·培养弹窗：读取玩家储存空间物品作材料 + 玩家填培养方向(提示词) →
   走宠物/召唤物演化同一 API 生成"合理"的提升提案(叙述+<state>/<upstore>) → 可反复重掷 → 采纳即写入该宠物面板并消耗材料。
   模块级组件（勿内联进父组件），避免受控 textarea 每键重挂导致输入法拼音断字。父组件(App)持状态/逻辑，本组件纯呈现+本地输入。 */
interface PetLite { id: string; name: string; realm?: string; npcTag?: string; bodyType?: string }
export interface PetCultivateModalProps {
  open: boolean;
  pet: PetLite | null;
  loading: boolean;
  result: string;        // AI 提案原文（叙述 + <state>/<upstore>；显示时剥标签）
  error?: string;
  onGenerate: (prompt: string, materials: { id: string; name: string; qty: number }[]) => void;
  onAccept: () => void;
  onClose: () => void;
}

/** 剥掉 <think>/<state>/<upstore> 标签，只留给玩家看的培养叙述。 */
function narrativeOnly(text: string): string {
  return text
    .replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<state>[\s\S]*?<\/state>/gi, '')
    .replace(/<upstore>[\s\S]*?<\/upstore>/gi, '')
    .replace(/<\/?(state|upstore|think)[^>]*>/gi, '')
    .trim();
}

export default function PetCultivateModal({ open, pet, loading, result, error, onGenerate, onAccept, onClose }: PetCultivateModalProps) {
  const items = useItems((s) => s.items);
  const [prompt, setPrompt] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});

  // 打开或切换宠物时重置输入
  useEffect(() => { if (open) { setPrompt(''); setQty({}); } }, [open, pet?.id]);
  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !pet) return null;

  const hasResult = !!result.trim() && !loading;
  const pickable = items.filter((it) => (it.quantity ?? 0) > 0 && !it.equipped && !it.archived);
  const materials = pickable
    .filter((it) => (qty[it.id] ?? 0) > 0)
    .map((it) => ({ id: it.id, name: it.name, qty: Math.min(qty[it.id], it.quantity ?? 1) }));
  const setQ = (id: string, v: number, max: number) => setQty((m) => ({ ...m, [id]: Math.max(0, Math.min(max, v)) }));
  const narrative = narrativeOnly(result);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6">
      <div className="w-full max-w-2xl max-h-[92vh] flex flex-col bg-panel border border-edge rounded-xl shadow-2xl overflow-hidden">
        {/* 头 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
          <div>
            <div className="text-base font-semibold text-slate-100">🌱 培养 · {pet.name}</div>
            <div className="text-xs text-dim mt-0.5">
              {pet.npcTag || '宠物'}{pet.realm ? ` · ${pet.realm.split(/[·|]/)[0]}` : ''}{pet.bodyType ? ` · ${pet.bodyType}` : ''} —— 投入材料 + 填写方向，AI 据合理性给出提升，可反复重掷
            </div>
          </div>
          <button onClick={onClose} className="text-dim hover:text-slate-200 text-xl leading-none px-2" title="关闭（Esc）">×</button>
        </div>

        {/* 体 */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {/* 材料 */}
          <div>
            <div className="text-sm font-mono text-god/70 uppercase tracking-widest mb-2">投入材料（读取储存空间 · 采纳时消耗）</div>
            {pickable.length === 0 ? (
              <div className="text-xs text-dim px-2 py-3 border border-edge rounded-lg bg-void/40">储存空间暂无可投入的物品（可不投材料，仅凭培养方向）。</div>
            ) : (
              <div className="max-h-44 overflow-y-auto space-y-1 pr-1 border border-edge rounded-lg p-2 bg-void/30">
                {pickable.map((it) => {
                  const sel = qty[it.id] ?? 0;
                  const max = it.quantity ?? 1;
                  return (
                    <div key={it.id} className={`flex items-center gap-2 px-2 py-1 rounded ${sel > 0 ? 'bg-god/10' : 'hover:bg-void/50'}`}>
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] text-slate-200">{it.name}</span>
                        <span className="text-[11px] text-dim ml-1">{it.gradeDesc} · {it.category} · 持有{max}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button disabled={loading || sel <= 0} onClick={() => setQ(it.id, sel - 1, max)} className="w-6 h-6 rounded border border-edge text-dim hover:text-slate-200 disabled:opacity-30">−</button>
                        <span className="w-6 text-center text-sm font-mono text-slate-200">{sel}</span>
                        <button disabled={loading || sel >= max} onClick={() => setQ(it.id, sel + 1, max)} className="w-6 h-6 rounded border border-edge text-dim hover:text-slate-200 disabled:opacity-30">＋</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 方向 */}
          <div>
            <div className="text-sm font-mono text-god/70 uppercase tracking-widest mb-2">培养方向（提示词）</div>
            <textarea
              value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={loading} spellCheck={false}
              placeholder="例如：用这些灵材温养它的血脉，侧重强化体质与爪牙之力；或：教它一门御风的技能……（可留空，AI 按材料与常理给合理提升）"
              className="w-full min-h-[80px] px-3 py-2 bg-black/30 border border-edge rounded-md text-sm text-slate-200 placeholder:text-dim/40 leading-relaxed resize-y focus:border-god/50 focus:outline-none disabled:opacity-60"
            />
          </div>

          {/* 结果 */}
          {(loading || hasResult || error) && (
            <div>
              <div className="text-sm font-mono text-teal-300/70 uppercase tracking-widest mb-2">培养结果</div>
              {loading ? (
                <div className="flex items-center gap-2 text-dim text-sm px-2 py-4"><span className="w-5 h-5 border-2 border-teal-500/40 border-t-teal-400 rounded-full animate-spin inline-block" /> 培养中……</div>
              ) : error ? (
                <div className="text-sm text-blood px-3 py-2 border border-blood/40 rounded-lg bg-blood/5">{error}</div>
              ) : (
                <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap px-3 py-2 border border-teal-500/30 rounded-lg bg-teal-500/5">
                  {narrative || '（AI 未给出可读叙述，仍可采纳以应用其提升指令）'}
                  <div className="text-[11px] text-teal-300/60 mt-2 pt-2 border-t border-teal-500/20">采纳后将把提升写入「{pet.name}」并消耗生成该结果时所选的材料；不满意可「重新生成」。</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 脚 */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-edge">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-sm border border-edge text-dim hover:text-slate-200 hover:border-slate-500 transition">关闭</button>
          <button onClick={() => onGenerate(prompt, materials)} disabled={loading}
            className="px-3 py-1.5 rounded-md text-sm border border-teal-600/50 text-teal-200 hover:bg-teal-900/25 transition disabled:opacity-40 disabled:cursor-not-allowed">
            {hasResult ? '🔄 重新生成' : '🌱 生成培养'}
          </button>
          <button onClick={onAccept} disabled={!hasResult}
            className="px-4 py-1.5 rounded-md text-sm font-semibold bg-teal-700/80 text-white hover:bg-teal-600 transition disabled:opacity-40 disabled:cursor-not-allowed">
            ✅ 采纳
          </button>
        </div>
      </div>
    </div>
  );
}
