import { useState, useEffect, useMemo } from 'react';

/* 「结算任务」随从勾选弹窗：点【结算任务】时弹出，让玩家勾选本次给哪些随从/队友同步发放属性点/技能点。
   - 默认勾选「本会自动结算」的随从（在场/羁绊/队友）；離場的旧随从默认不勾、但可手动勾上。
   - 确认 → 回传勾选的 id 列表（走 setSettlementWhitelist），随后把【结算任务】塞进输入框由玩家发送。
   - 取消 → 什么都不做（不进入结算）。
   模块级组件（勿内联进父组件），避免受控输入每键重挂导致输入法拼音断字（见 inline-wrapper-component-breaks-ime）。*/
export interface SettleCompanion {
  id: string;
  name: string;
  tier?: string;       // 阶位
  tag?: string;        // 标签（随从/宠物/召唤物/契约者…）
  onScene?: boolean;   // 是否在场
  defaultChecked: boolean;  // 默认是否勾选（=本会自动结算者）
}
export interface SettlementCompanionModalProps {
  open: boolean;
  companions: SettleCompanion[];
  ratioPct: number;    // 折算比例（展示用，如 50 = 主角的一半）
  onConfirm: (selectedIds: string[]) => void;
  onCancel: () => void;
}

export default function SettlementCompanionModal({ open, companions, ratioPct, onConfirm, onCancel }: SettlementCompanionModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 打开时按 defaultChecked 初始化勾选集合
  useEffect(() => {
    if (open) setSelected(new Set(companions.filter((c) => c.defaultChecked).map((c) => c.id)));
  }, [open, companions]);

  // Esc = 取消
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const allChecked = useMemo(() => companions.length > 0 && companions.every((c) => selected.has(c.id)), [companions, selected]);

  if (!open) return null;
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(companions.map((c) => c.id)));

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6">
      <div className="w-full max-w-lg max-h-[88vh] flex flex-col bg-panel border border-edge rounded-xl shadow-2xl overflow-hidden">
        {/* 头 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
          <div>
            <div className="text-base font-semibold text-slate-100">🎖️ 结算随从选择</div>
            <div className="text-xs text-dim mt-0.5">勾选本次世界结算要一并发放成长的随从/队友——每人获得约主角的 {ratioPct}%（属性点/技能点，四阶+随从发真实属性点）。</div>
          </div>
          <button onClick={onCancel} className="text-dim hover:text-slate-200 text-xl leading-none px-2" title="取消（Esc）">×</button>
        </div>

        {/* 体 */}
        <div className="flex-1 min-h-0 p-3 overflow-y-auto">
          {companions.length === 0 ? (
            <div className="py-10 text-center text-sm text-dim">当前没有可结算的随从/队友。</div>
          ) : (
            <>
              <button
                onClick={toggleAll}
                className="mb-2 px-2.5 py-1 rounded-md text-xs border border-edge text-slate-300 hover:border-god/50 hover:text-god transition"
              >{allChecked ? '☐ 全不选' : '☑ 全选'}（已选 {selected.size}/{companions.length}）</button>
              <div className="space-y-1.5">
                {companions.map((c) => {
                  const on = selected.has(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-md border cursor-pointer transition ${on ? 'border-god/50 bg-god/5' : 'border-edge hover:border-slate-500'}`}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggle(c.id)} className="accent-god w-4 h-4 shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="text-sm text-slate-100">{c.name}</span>
                        <span className="ml-2 text-[11px] text-dim">
                          {c.tier || '阶位未定'}{c.tag ? ` · ${c.tag}` : ''}
                          <span className={c.onScene ? 'text-emerald-400/70' : 'text-amber-400/60'}> · {c.onScene ? '在场' : '離場'}</span>
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="mt-2 text-[11px] text-dim/70 leading-relaxed">未勾选的随从本次不发放点数。離場的旧随从默认不勾，可手动勾选。</div>
            </>
          )}
        </div>

        {/* 脚 */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-edge">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-sm border border-edge text-dim hover:text-slate-200 hover:border-slate-500 transition"
          >取消</button>
          <button
            onClick={() => onConfirm([...selected])}
            className="px-4 py-1.5 rounded-md text-sm font-semibold bg-god/80 text-void hover:bg-god transition"
          >✅ 确认结算（{selected.size} 名）</button>
        </div>
      </div>
    </div>
  );
}
