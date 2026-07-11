import { useState, useEffect, useRef } from 'react';

/* 本回合细纲弹窗（细纲功能）：
   - 正文生成前先跑「细纲师」，流式把细纲填进来（loading 期间只读展示、随流增长）；
   - 生成完玩家可自由编辑；
   - 〔确认并生成正文〕→ 把编辑后的细纲回传，注入正文 API 生成正文；〔取消〕→ 放弃本回合。
   模块级组件（勿内联进父组件），避免受控 textarea 每键重挂导致输入法拼音断字。*/
export interface OutlineModalProps {
  open: boolean;
  loading: boolean;      // 生成中（流式未结束）
  text: string;          // 当前文本（流式期间随增长；由父组件驱动）
  wordTarget?: number;   // 字数目标（0=不限定）
  onConfirm: (text: string) => void;
  onCancel: () => void;
  onRegenerate: () => void;
  title?: string;        // 标题（复用于剧情指导/数据库推进审核窗；缺省=细纲）
  subtitle?: string;     // 副标题说明（缺省=细纲说明）
  allowEmpty?: boolean;  // 允许空文本确认（剧情指导/数据库推进：清空=本回合不注入该规划）
}

export default function OutlineModal({ open, loading, text, wordTarget, onConfirm, onCancel, onRegenerate, title, subtitle, allowEmpty }: OutlineModalProps) {
  const [draft, setDraft] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 打开或 text 变化（流式增长 / 重新生成）时把 draft 同步到最新细纲；
  // 生成结束后 text 不再变 → 本 effect 不再触发 → 玩家的手动编辑得以保留。
  useEffect(() => { if (open) setDraft(text); }, [open, text]);

  // 流式结束（loading: true→false）后自动聚焦文本框，便于直接编辑。
  useEffect(() => { if (open && !loading) taRef.current?.focus(); }, [open, loading]);

  // Esc = 取消
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  const empty = !draft.trim();

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-panel border border-edge rounded-xl shadow-2xl overflow-hidden">
        {/* 头 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
          <div>
            <div className="text-base font-semibold text-slate-100">{title ?? '📝 本回合细纲'}</div>
            <div className="text-xs text-dim mt-0.5">
              {subtitle ?? '先规划这一拍怎么写，编辑满意后再生成正文。正文会被要求严格遵循此细纲。'}
              {subtitle ? '' : (wordTarget ? ` · 字数目标 ≈ ${wordTarget} 字` : '')}
            </div>
          </div>
          <button onClick={onCancel} className="text-dim hover:text-slate-200 text-xl leading-none px-2" title="取消（Esc）">×</button>
        </div>

        {/* 体 */}
        <div className="flex-1 min-h-0 p-4 overflow-hidden flex flex-col">
          {loading && !draft ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-dim">
              <div className="w-6 h-6 border-2 border-violet-500/40 border-t-violet-400 rounded-full animate-spin" />
              <div className="text-sm">生成中……</div>
            </div>
          ) : (
            <textarea
              ref={taRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              readOnly={loading}
              spellCheck={false}
              placeholder="（内容将在这里生成，可自由编辑）"
              className="flex-1 min-h-[40vh] w-full px-3 py-2 bg-black/30 border border-edge rounded-md text-sm text-slate-200 placeholder:text-dim/40 font-mono leading-relaxed resize-none focus:border-violet-600/50 focus:outline-none"
            />
          )}
          <div className="mt-2 flex items-center justify-between text-xs text-dim">
            <span>{loading ? '⏳ 生成中，可等它写完，也可随时改…' : '可自由增删情节点、改钩子、调字数目标。'}</span>
            <span>{draft.length} 字</span>
          </div>
        </div>

        {/* 脚 */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-edge">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-sm border border-edge text-dim hover:text-slate-200 hover:border-slate-500 transition"
          >取消</button>
          <button
            onClick={onRegenerate}
            disabled={loading}
            className="px-3 py-1.5 rounded-md text-sm border border-edge text-slate-300 hover:text-slate-100 hover:border-slate-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >🔄 重新生成</button>
          <button
            onClick={() => onConfirm(draft)}
            disabled={loading || (empty && !allowEmpty)}
            className="px-4 py-1.5 rounded-md text-sm font-semibold bg-violet-700/80 text-white hover:bg-violet-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >✅ 确认并生成正文</button>
        </div>
      </div>
    </div>
  );
}
