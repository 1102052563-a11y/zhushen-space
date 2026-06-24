import { useState } from 'react';
import { useApiDebugLog } from '../systems/apiDebugLog';

// 兼容旧引用：App 的 debugParts 状态仍用此类型（喂给正文日志的 parts）
export interface PromptPart { label: string; role: string; content: string; }

const tok = (s: string) => Math.round((s || '').length / 3.5);
const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });

/* 开发者 · API 调试台：分选项卡浏览每一次 API 调用（正文 + 所有演化阶段/功能）的
   输入（正文带结构化分段：预设块/后历史/深度注入…；其他显示原始消息含聊天记录）+ 返回。
   左栏＝调用列表（选项卡），右栏＝该调用的紧凑可展开卡片。数据来自全局 apiDebugLog。 */
export default function ApiPromptPanel({ onClose }: { onClose: () => void }) {
  const calls = useApiDebugLog((s) => s.calls);
  const clear = useApiDebugLog((s) => s.clear);
  const capturing = useApiDebugLog((s) => s.capturing);
  const setCapturing = useApiDebugLog((s) => s.setCapturing);
  const [selId, setSelId] = useState<number | null>(null);
  const [copied, setCopied] = useState('');
  const [view, setView] = useState<'parts' | 'raw'>('parts');

  const cur = calls.find((c) => c.id === selId) ?? calls[0];

  function copy(text: string, tag: string) {
    try { navigator.clipboard.writeText(text); setCopied(tag); setTimeout(() => setCopied(''), 1200); } catch { /* */ }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex flex-col" onClick={onClose}>
      <div className="flex-1 flex flex-col max-w-6xl w-full mx-auto px-3 py-4 min-h-0" onClick={(e) => e.stopPropagation()}>

        {/* 标题栏 */}
        <div className="shrink-0 flex items-center gap-3 mb-2">
          <h2 className="text-lg font-bold text-slate-100">API 调试台</h2>
          <span className="text-[10px] font-mono text-god/60">{calls.length} 条调用</span>
          <label className="text-[10px] font-mono text-dim flex items-center gap-1 cursor-pointer select-none">
            <input type="checkbox" checked={capturing} onChange={(e) => setCapturing(e.target.checked)} /> 捕获
          </label>
          <button onClick={clear} className="text-[10px] font-mono px-2 py-0.5 border border-edge rounded text-dim hover:text-slate-200 transition-colors">清空</button>
          <span className="ml-auto text-[10px] text-dim/60 hidden sm:inline">正文＝结构化分段 · 其他阶段＝原始消息+返回</span>
          <button onClick={onClose} className="text-[11px] font-mono px-3 py-1 border border-edge rounded text-dim hover:text-slate-200 transition-colors">← 返回</button>
        </div>

        <div className="flex-1 min-h-0 flex gap-2">
          {/* 左：调用列表（选项卡） */}
          <div className="w-52 shrink-0 overflow-y-auto rounded-lg border border-edge bg-panel/40 p-1.5 space-y-1">
            {calls.length === 0 && <div className="text-center text-dim text-[11px] py-8 leading-relaxed">还没有调用<br />发一条消息 / 跑个演化阶段试试</div>}
            {calls.map((c) => {
              const active = cur?.id === c.id;
              return (
                <button key={c.id} onClick={() => setSelId(c.id)}
                  className={`w-full text-left px-2 py-1.5 rounded text-[11px] transition-colors border ${active ? 'border-god/50 bg-god/10 text-slate-100' : 'border-transparent hover:bg-void/50 text-dim'}`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.pending ? 'bg-amber-400 animate-pulse' : c.ok ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                    <span className="flex-1 truncate font-semibold">{c.label}</span>
                  </div>
                  <div className="text-[9px] font-mono text-dim/70 mt-0.5">
                    {fmtTime(c.ts)} · {c.messages.length}条 · ~{tok(c.messages.map((m) => m.content).join(''))}词
                    {c.ms ? ' · ' + c.ms + 'ms' : c.pending ? ' · …' : ''}
                  </div>
                </button>
              );
            })}
          </div>

          {/* 右：选中调用详情 */}
          <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-edge bg-panel/40 p-2 space-y-1.5">
            {!cur && <div className="text-center text-dim text-sm py-16">选择左侧一条调用查看其输入与返回</div>}
            {cur && (
              <>
                <div className="text-[10px] font-mono text-dim/70 px-1 pb-0.5 flex items-center gap-2 flex-wrap">
                  <span>{cur.label} · {fmtTime(cur.ts)} · {cur.pending ? '生成中…' : cur.ok ? '成功 ' + (cur.ms ?? '?') + 'ms' : '失败'}</span>
                  {/* 正文有结构化分段时给个切换：结构化 ⇄ 原始消息（实际发给模型的消息数组，一条不漏）。其他调用只有原始消息。 */}
                  {cur.parts ? (
                    <span className="inline-flex rounded border border-edge overflow-hidden ml-auto text-[10px]">
                      <button onClick={() => setView('parts')} className={`px-2 py-0.5 ${view === 'parts' ? 'bg-god/20 text-god' : 'text-dim hover:text-slate-200'}`}>结构化分段</button>
                      <button onClick={() => setView('raw')} className={`px-2 py-0.5 border-l border-edge ${view === 'raw' ? 'bg-god/20 text-god' : 'text-dim hover:text-slate-200'}`}>原始消息（实发 {cur.messages.length} 条）</button>
                    </span>
                  ) : <span className="ml-auto">原始消息 · {cur.messages.length} 条</span>}
                </div>
                {cur.parts && view === 'parts'
                  ? cur.parts.map((p, i) => <DbgCard key={'p' + i} label={p.label} role={p.role} content={p.content} onCopy={copy} tag={'p' + i} copied={copied} />)
                  : cur.messages.map((m, i) => <DbgCard key={'m' + i} label={'#' + (i + 1) + ' · ' + m.role} role={m.role} content={m.content} onCopy={copy} tag={'m' + i} copied={copied} defaultOpen={cur.messages.length <= 3} />)}
                <DbgCard label="↩ 返回 response" role={cur.ok ? 'ok' : cur.pending ? '…' : 'error'}
                  content={cur.pending ? '（生成中…）' : cur.response || cur.error || '（空）'}
                  onCopy={copy} tag="resp" copied={copied} defaultOpen />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DbgCard({ label, role, content, onCopy, tag, copied, defaultOpen }: {
  label: string; role: string; content: string;
  onCopy: (t: string, tag: string) => void; tag: string; copied: string; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const tk = tok(content);
  const isInj = label.startsWith('⚡');
  const isOv = label.startsWith('📊');
  const isResp = label.startsWith('↩');
  const isTail = label.startsWith('📜');
  const isWb = label.startsWith('📚');
  const isPreset = label.startsWith('📦');
  const cls = isResp || isOv ? 'border-god/40 bg-god/5'
    : isInj ? 'border-emerald-500/40 bg-emerald-900/10'
    : isWb ? 'border-amber-500/40 bg-amber-900/10'
    : isPreset ? 'border-violet-500/40 bg-violet-900/10'
    : isTail ? 'border-sky-500/30 bg-sky-900/10'
    : 'border-edge bg-void/40';
  return (
    <div className={`rounded border ${cls}`}>
      <div className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <span className="flex-1 text-[12px] font-semibold text-slate-200 truncate">{label}</span>
        <span className="shrink-0 text-[9px] font-mono px-1 py-0.5 rounded border border-edge text-dim">{role}</span>
        <span className="shrink-0 text-[9px] font-mono text-dim/60 w-12 text-right">~{tk}词</span>
        <button onClick={(e) => { e.stopPropagation(); onCopy(content, tag); }}
          className="shrink-0 text-[10px] font-mono text-dim hover:text-god transition-colors">{copied === tag ? '✓' : '复制'}</button>
        <span className="shrink-0 text-dim text-[10px] w-3 text-center">{open ? '∧' : '∨'}</span>
      </div>
      {open && (
        <div className="border-t border-edge/40 px-2.5 py-2 max-h-[42vh] overflow-y-auto">
          <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-words leading-relaxed">{content || '（空）'}</pre>
        </div>
      )}
    </div>
  );
}
