import { useState } from 'react';

export interface PromptPart {
  label: string;
  role: string;
  content: string;
}

/* 开发者·正文API提示词查看器：把本回合「实际发给模型」的提示词拆成卡片，
   重点用来调试注入/深度注入——⚡开头的卡＝深度注入块（贴近当前生成的高优先级注入）。 */
export default function ApiPromptPanel({ parts, onClose }: { parts: PromptPart[]; onClose: () => void }) {
  const [openIdx, setOpenIdx] = useState<number | null>(parts.length ? 0 : null);
  const [copied, setCopied] = useState<string>('');
  const tok = (s: string) => Math.round(s.length / 3.5);

  function copy(text: string, tag: string) {
    try { navigator.clipboard.writeText(text); setCopied(tag); setTimeout(() => setCopied(''), 1500); } catch { /* */ }
  }
  function copyAll() {
    copy(parts.map((p) => `===== ${p.label} =====\n${p.content}`).join('\n\n\n'), 'all');
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex flex-col" onClick={onClose}>
      <div className="flex-1 flex flex-col max-w-4xl w-full mx-auto px-4 py-6 min-h-0" onClick={(e) => e.stopPropagation()}>

        {/* 标题 */}
        <div className="text-center mb-4 shrink-0">
          <h2 className="text-2xl font-bold text-slate-100 tracking-wide">正文 API 提示词</h2>
          <div className="text-[11px] font-mono tracking-[0.3em] text-god/60 mt-1">API PROMPT · 开发者调试</div>
          <div className="mx-auto mt-2 w-24 h-px bg-gradient-to-r from-transparent via-god/50 to-transparent" />
        </div>

        {/* 卡片列表 */}
        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-edge bg-panel/40 p-3 space-y-2">
          {parts.length === 0 && (
            <div className="text-center text-dim text-sm py-16">还没有数据——先发送一条消息生成正文，再打开本页。</div>
          )}
          {parts.map((part, i) => {
            const isInj = part.label.startsWith('⚡');
            const open = openIdx === i;
            return (
              <div key={i} className={`rounded-lg border transition-colors ${isInj ? 'border-emerald-500/40 bg-emerald-900/10' : 'border-edge bg-void/40'}`}>
                {/* 行头 */}
                <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isInj ? 'bg-emerald-400' : 'bg-god/60'}`} />
                  <span className="flex-1 text-sm font-semibold text-slate-200 truncate">{part.label}</span>
                  <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim">{part.role}</span>
                  <span className="shrink-0 text-[10px] font-mono text-dim/70 w-16 text-right">~{tok(part.content)} 词符</span>
                  <button onClick={() => copy(part.content, String(i))}
                    className="shrink-0 text-[11px] font-mono px-2 py-0.5 rounded border border-edge text-dim hover:border-god/40 hover:text-god transition-colors">
                    {copied === String(i) ? '✓' : '复制'}
                  </button>
                  <button onClick={() => setOpenIdx(open ? null : i)}
                    className="shrink-0 text-dim hover:text-slate-200 px-1 transition-colors">{open ? '∧' : '∨'}</button>
                </div>
                {/* 展开内容 */}
                {open && (
                  <div className="border-t border-edge/40 px-3.5 py-3 max-h-[46vh] overflow-y-auto">
                    <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-words leading-relaxed">{part.content || '（空）'}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 底部 */}
        <div className="shrink-0 flex items-center gap-3 mt-4">
          <button onClick={onClose}
            className="px-4 py-1.5 text-sm font-mono border border-edge text-dim hover:border-slate-400/40 hover:text-slate-200 rounded transition-colors">
            ← 返回
          </button>
          <span className="flex-1 text-center text-[11px] text-dim/70">
            ⓘ 本页展示本回合「实际发给模型」的提示词；<span className="text-emerald-400/80">⚡绿色卡＝深度注入块</span>（贴近当前生成的高优先级注入）
          </span>
          <button onClick={copyAll}
            className="px-4 py-1.5 text-sm font-mono border border-god/40 text-god hover:bg-god/10 rounded transition-colors">
            {copied === 'all' ? '✓ 已复制' : '复制全部 ⧉'}
          </button>
        </div>
      </div>
    </div>
  );
}
