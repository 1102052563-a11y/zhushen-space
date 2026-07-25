/* 悬浮图鉴 · 完整档案页（2026-07-25）
   悬浮卡只给一瞥（3 行 × 90 字）；这里渲染未截断的原文，并把 wiki 正文里的
   `[名](页.md)` 还原成可点内链——点进去就是下一个词条，形成站内浏览。

   ⚠ 只在打开时挂载（App 侧 ek==null 就不渲染），故不参与正文渲染路径，
     与「打字卡顿」那套性能铁则无关：这里可以正常用 hook / state。
   ⚠ Tailwind 只收录源码里出现的**完整类名**，故不做片段拼接。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  loadCodexDoc, parseDocBlocks, ekForWikiName,
  type CodexDoc, type DocBlock, type DocSpan,
} from '../systems/codexDetail';

function Spans({ spans, onJump }: { spans: DocSpan[]; onJump: (ek: string) => void }) {
  return (
    <>
      {spans.map((s, i) => {
        const ek = s.link ? ekForWikiName(s.link) : null;
        if (!ek) return <span key={i}>{s.text}</span>;
        return (
          <button
            key={i}
            onClick={() => onJump(ek)}
            className="text-god/85 hover:text-god underline decoration-dotted underline-offset-2 transition-colors"
          >{s.text}</button>
        );
      })}
    </>
  );
}

function Block({ b, onJump }: { b: DocBlock; onJump: (ek: string) => void }) {
  if (b.t === 'hr') return <hr className="border-edge/50 my-3" />;
  if (b.t === 'h') {
    const cls = b.level <= 1
      ? 'text-[17px] font-semibold text-slate-100 mt-4 mb-1.5'
      : b.level === 2
        ? 'text-[15px] font-semibold text-slate-200 mt-3.5 mb-1'
        : 'text-[13px] font-semibold text-slate-300 mt-3 mb-1';
    return <div className={cls}><Spans spans={b.spans} onJump={onJump} /></div>;
  }
  if (b.t === 'li') {
    return (
      <div className="flex gap-2 text-[13px] text-slate-300/90 leading-relaxed">
        <span className="text-dim/40 shrink-0">·</span>
        <span className="min-w-0"><Spans spans={b.spans} onJump={onJump} /></span>
      </div>
    );
  }
  if (b.t === 'quote') {
    return (
      <div className="border-l-2 border-edge pl-2.5 text-[12.5px] text-dim/80 italic leading-relaxed">
        <Spans spans={b.spans} onJump={onJump} />
      </div>
    );
  }
  return (
    <div className="text-[13px] text-slate-300/90 leading-relaxed">
      <Spans spans={b.spans} onJump={onJump} />
    </div>
  );
}

export default function CodexDetail({ ek, onClose }: { ek: string | null; onClose: () => void }) {
  const [stack, setStack] = useState<string[]>([]);
  const [doc, setDoc] = useState<CodexDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const cur = stack.length ? stack[stack.length - 1] : null;

  useEffect(() => { setStack(ek ? [ek] : []); }, [ek]);

  useEffect(() => {
    if (!cur) { setDoc(null); return; }
    let alive = true;
    setLoading(true);
    void loadCodexDoc(cur)
      .then((d) => { if (alive) { setDoc(d); bodyRef.current?.scrollTo({ top: 0 }); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [cur]);

  const jump = useCallback((next: string) => {
    setStack((s) => (s[s.length - 1] === next ? s : [...s, next]));
  }, []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);

  useEffect(() => {
    if (!ek) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (stack.length > 1) back(); else onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ek, stack.length, back, onClose]);

  if (!ek) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-edge bg-panel shadow-2xl shadow-black/60 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-4 py-3 border-b border-edge/70 bg-void/30">
          {stack.length > 1 && (
            <button onClick={back} className="text-dim/60 hover:text-slate-200 text-sm mt-0.5 transition-colors shrink-0" title="返回上一条">←</button>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-semibold text-sky-200 truncate">{doc?.title ?? '…'}</div>
            {doc?.meta && <div className="text-[11.5px] font-mono text-dim/70 mt-0.5 line-clamp-2">{doc.meta}</div>}
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-slate-200 text-lg leading-none shrink-0 transition-colors" title="关闭">×</button>
        </div>

        <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
          {loading && <div className="text-[12px] font-mono text-dim/50">读取档案…</div>}
          {!loading && !doc && <div className="text-[12px] font-mono text-dim/50">查无此档案。</div>}
          {!loading && doc?.lines?.map((l, i) => (
            <div key={i} className="text-[13px] text-slate-300/90 leading-relaxed">{l}</div>
          ))}
          {!loading && doc?.md && parseDocBlocks(doc.md).map((b, i) => (
            <Block key={i} b={b} onJump={jump} />
          ))}
        </div>

        {doc && (
          <div className="px-4 py-2 border-t border-edge/70 bg-void/40 flex items-center gap-2">
            <span className="text-[10.5px] font-mono text-dim/50 truncate">📚 {doc.source}</span>
            {doc.spoiler && <span className="text-[10.5px] font-mono text-rose-300/50 shrink-0">· 含原著剧透</span>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
