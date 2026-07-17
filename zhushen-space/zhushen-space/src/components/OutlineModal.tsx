import { useState, useEffect, useRef } from 'react';
import DiceCard from './DiceCard';
import type { DiceCardData } from '../systems/autoDice';

/* 本回合细纲弹窗（细纲功能）：
   - 正文生成前先跑「细纲师」，流式把细纲填进来（loading 期间只读展示、随流增长）；
   - 生成完玩家可自由编辑；
   - 〔确认并生成正文〕→ 把编辑后的细纲回传，注入正文 API 生成正文；〔取消〕→ 放弃本回合（生成中也随时可取消，父组件会一并中止请求）。
   - 〔收起〕→ 缩成顶部小条、撤掉遮罩，回看正文/骰子卡再决定；本回合的检定卡也直接摆在弹窗里（规划这一拍要照着成败写）。
   模块级组件（勿内联进父组件），避免受控 textarea 每键重挂导致输入法拼音断字。*/
export interface OutlineModalProps {
  open: boolean;
  loading: boolean;      // 生成中（流式未结束）
  text: string;          // 当前文本（流式期间随增长；由父组件驱动）
  wordTarget?: number;   // 字数目标（0=不限定）
  dice?: DiceCardData[]; // 本回合检定卡（自动检定命中时才有）
  onConfirm: (text: string) => void;
  onCancel: () => void;
  onRegenerate: () => void;
  onStop?: () => void;   // 生成中「停止」：只停生成、留住已写的部分转可编辑（弹窗不关）
  title?: string;        // 标题（复用于剧情指导/数据库推进审核窗；缺省=细纲）
  subtitle?: string;     // 副标题说明（缺省=细纲说明）
  allowEmpty?: boolean;  // 允许空文本确认（剧情指导/数据库推进：清空=本回合不注入该规划）
}

export default function OutlineModal({ open, loading, text, wordTarget, dice, onConfirm, onCancel, onRegenerate, onStop, title, subtitle, allowEmpty }: OutlineModalProps) {
  const [draft, setDraft] = useState('');
  const [mini, setMini] = useState(false);   // 收起态：缩成顶部小条 + 无遮罩，露出底下的正文/骰子卡
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 打开或 text 变化（流式增长 / 重新生成）时把 draft 同步到最新细纲；
  // 生成结束后 text 不再变 → 本 effect 不再触发 → 玩家的手动编辑得以保留。
  useEffect(() => { if (open) setDraft(text); }, [open, text]);

  // 流式结束（loading: true→false）/ 展开后自动聚焦文本框，便于直接编辑。
  useEffect(() => { if (open && !loading && !mini) taRef.current?.focus(); }, [open, loading, mini]);

  // Esc = 取消（生成中同样管用：父组件会中止请求并作废本回合）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  const empty = !draft.trim();
  const heading = title ?? '📝 本回合细纲';

  // ── 收起态：顶部小条（不放底部——本回合的用户气泡+骰子卡就贴在对话最下方，别挡住它）──
  if (mini) {
    return (
      <div className="fixed z-[95] top-2 left-1/2 -translate-x-1/2 w-[min(32rem,calc(100vw-1rem))] flex items-center gap-2 px-3 py-2 rounded-xl border border-violet-700/40 bg-panel/95 backdrop-blur shadow-2xl">
        <span className="text-sm text-slate-200 truncate">{heading}</span>
        <span className="text-[11px] font-mono text-dim shrink-0">{loading ? '⏳ 生成中…' : `${draft.length} 字`}</span>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setMini(false)}
            className="px-2 py-1 rounded-md text-xs border border-edge text-slate-300 hover:text-slate-100 hover:border-slate-500 transition"
          >⤢ 展开</button>
          {!loading && (
            <button
              onClick={() => onConfirm(draft)}
              disabled={empty && !allowEmpty}
              className="px-2 py-1 rounded-md text-xs font-semibold bg-violet-700/80 text-white hover:bg-violet-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >✅ 生成正文</button>
          )}
          <button
            onClick={onCancel}
            className="px-2 py-1 rounded-md text-xs border border-edge text-dim hover:text-slate-200 hover:border-slate-500 transition"
            title="取消（Esc）：作废本回合"
          >取消</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-panel border border-edge rounded-xl shadow-2xl overflow-hidden">
        {/* 头 */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-edge">
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-100">{heading}</div>
            <div className="text-xs text-dim mt-0.5">
              {subtitle ?? '先规划这一拍怎么写，编辑满意后再生成正文。正文会被要求严格遵循此细纲。'}
              {subtitle ? '' : (wordTarget ? ` · 字数目标 ≈ ${wordTarget} 字` : '')}
            </div>
          </div>
          <div className="flex items-center shrink-0">
            <button onClick={() => setMini(true)} className="text-dim hover:text-slate-200 text-xl leading-none px-2" title="收起：缩成顶部小条，回看正文/骰子卡">－</button>
            <button onClick={onCancel} className="text-dim hover:text-slate-200 text-xl leading-none px-2" title="取消（Esc）：作废本回合">×</button>
          </div>
        </div>

        {/* 体 */}
        <div className="flex-1 min-h-0 p-4 overflow-hidden flex flex-col">
          {/* 本回合 roll 点：摆在细纲上方（成败直接决定这一拍怎么规划）。挂在这里而非分支里，免得转圈→文本框切换时重挂、骰子动画重播 */}
          {dice && dice.length > 0 && (
            <div className="shrink-0 mb-2 flex flex-wrap gap-2">
              {dice.map((d, i) => <div key={i} className="min-w-[15rem] flex-1"><DiceCard data={d} /></div>)}
            </div>
          )}
          {loading && !draft ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-dim">
              <div className="w-6 h-6 border-2 border-violet-500/40 border-t-violet-400 rounded-full animate-spin" />
              <div className="text-sm">生成中……</div>
              <div className="text-xs text-dim/70">发错了？点〔取消〕或按 Esc 随时撤回本回合</div>
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
          {loading && onStop ? (
            <button
              onClick={onStop}
              className="px-3 py-1.5 rounded-md text-sm border border-edge text-slate-300 hover:text-slate-100 hover:border-slate-500 transition"
              title="停止生成：留住已写出的部分，直接改"
            >⏹ 停止</button>
          ) : (
            <button
              onClick={onRegenerate}
              disabled={loading}
              className="px-3 py-1.5 rounded-md text-sm border border-edge text-slate-300 hover:text-slate-100 hover:border-slate-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >🔄 重新生成</button>
          )}
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
