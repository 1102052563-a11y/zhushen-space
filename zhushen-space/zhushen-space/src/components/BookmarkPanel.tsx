import { useState, useMemo } from 'react';
import { useBookmarks, type Bookmark } from '../store/bookmarkStore';

/* ══════════ ⭐ 坐标（收藏楼层）面板 ══════════
   借鉴 ST-SevenDaysCal「构画」的「坐标」。列表 = 收藏时的**正文快照**（不是指针），
   所以原楼被编辑/重生成/挤出显示窗口/切世界清空，这里照样读得到全文（见 bookmarkStore 注释）。
   「跳回」是尽力而为：楼还在 DOM 里就滚过去并闪一下，不在就明说，不假装成功。
   纯前端：不调 API、不注入 AI。 */

/** 尽力跳回原楼：DOM 里找得到就滚过去 + 闪一下描边；找不到返回 false（调用方给提示）。 */
function jumpToFloor(msgId: number): boolean {
  const el = document.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // 用内联 style 描边高亮：不依赖 tailwind class（动态类名会被 JIT 清掉）
  const prev = el.style.outline;
  el.style.outline = '2px solid rgba(212,175,55,0.65)';
  el.style.outlineOffset = '6px';
  el.style.borderRadius = '10px';
  window.setTimeout(() => { el.style.outline = prev; el.style.outlineOffset = ''; }, 1800);
  return true;
}

function fmtTime(ts: number): string {
  try {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return ''; }
}

/** 正文快照去掉结算块/HTML 标记后的预览（列表折叠态只给两三行）。 */
function preview(text: string): string {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/^[>＞].*$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export default function BookmarkPanel({ onClose }: { onClose: () => void }) {
  const marks = useBookmarks((s) => s.marks);
  const update = useBookmarks((s) => s.update);
  const remove = useBookmarks((s) => s.remove);
  const clear = useBookmarks((s) => s.clear);

  const [q, setQ] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [toast, setToast] = useState('');

  const allTags = useMemo(() => {
    const set = new Set<string>();
    marks.forEach((m) => m.tags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [marks]);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return marks
      .filter((m) => !tagFilter || m.tags.includes(tagFilter))
      .filter((m) => !kw || m.text.toLowerCase().includes(kw) || m.note.toLowerCase().includes(kw) || m.tags.some((t) => t.toLowerCase().includes(kw)))
      .slice()
      .reverse();   // 新的在前
  }, [marks, q, tagFilter]);

  const say = (s: string) => { setToast(s); window.setTimeout(() => setToast(''), 2400); };

  const doJump = (m: Bookmark) => {
    if (jumpToFloor(m.msgId)) { onClose(); return; }
    say('这一楼已不在当前显示范围（或已被清空）——快照仍在，可在此阅读全文');
  };

  const doExport = () => {
    const body = marks.slice().reverse().map((m) => {
      const head = [`第 ${m.turn} 回合`, m.worldName, m.worldTime].filter(Boolean).join(' · ');
      return `## ${head}${m.tags.length ? `　[${m.tags.join('] [')}]` : ''}\n${m.note ? `> ${m.note}\n\n` : ''}${m.text}`;
    }).join('\n\n---\n\n');
    const blob = new Blob([`﻿# 收藏的坐标（${marks.length} 条）\n\n${body}\n`], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `坐标收藏_${marks.length}条.md`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    say(`已导出 ${marks.length} 条`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[88dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">

        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/60 text-lg">⭐</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-100">坐标 · 收藏的楼层</div>
            <div className="text-[12px] font-mono text-dim/60">存的是正文快照——原楼被改/被清也丢不了（{marks.length} 条）</div>
          </div>
          {marks.length > 0 && <button onClick={doExport} title="导出为 Markdown" className="text-dim/50 hover:text-god text-sm transition-colors">⭳</button>}
          {marks.length > 0 && (
            <button onClick={() => { if (confirm(`清空全部 ${marks.length} 条收藏？不可恢复。`)) clear(); }}
              title="清空收藏" className="text-dim/50 hover:text-blood text-sm transition-colors">🗑</button>
          )}
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {marks.length > 0 && (
          <div className="shrink-0 border-b border-edge bg-panel/60 px-4 py-2 space-y-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜正文 / 备注 / 标签…"
              className="w-full bg-void border border-edge rounded px-2.5 py-1.5 text-[13px] text-slate-200 outline-none focus:border-god/50" />
            {allTags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button onClick={() => setTagFilter('')}
                  className={`px-2 py-0.5 rounded border text-[12px] font-mono transition-colors ${!tagFilter ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>全部</button>
                {allTags.map((t) => (
                  <button key={t} onClick={() => setTagFilter(tagFilter === t ? '' : t)}
                    className={`px-2 py-0.5 rounded border text-[12px] font-mono transition-colors ${tagFilter === t ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>{t}</button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {marks.length === 0 ? (
            <div className="py-16 text-center text-dim/45 text-[13px] font-mono border border-dashed border-edge rounded-xl leading-relaxed">
              还没有收藏。<br />
              把鼠标移到任意一段正文上，点右上角的 <span className="text-god/70">☆</span> 就能收藏这一楼。<br />
              <span className="text-dim/35">收藏会连正文一起存快照，之后回来还能读到原文。</span>
            </div>
          ) : shown.length === 0 ? (
            <div className="py-12 text-center text-dim/40 text-[13px] font-mono">没有匹配的收藏</div>
          ) : shown.map((m) => {
            const open = openId === m.id;
            const body = preview(m.text);
            return (
              <div key={m.id} className="rounded-lg border border-edge bg-panel/50 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono text-dim/55 border-b border-edge/60 flex-wrap">
                  <span className="text-god/60">第 {m.turn} 回合</span>
                  {m.worldName && <span>{m.worldName}</span>}
                  {m.worldTime && <span>{m.worldTime}</span>}
                  <span className="text-dim/35">{fmtTime(m.ts)}</span>
                  <span className="flex-1" />
                  <button onClick={() => doJump(m)} title="跳回原楼" className="hover:text-god transition-colors">↗ 跳回</button>
                  <button onClick={() => setEditing(m)} title="备注 / 标签" className="hover:text-god transition-colors">✎</button>
                  <button onClick={() => remove(m.id)} title="删除这条收藏" className="text-blood/50 hover:text-blood transition-colors">删</button>
                </div>
                {(m.note || m.tags.length > 0) && (
                  <div className="px-3 pt-1.5 flex items-start gap-2 flex-wrap">
                    {m.tags.map((t) => <span key={t} className="px-1.5 py-0.5 rounded bg-god/10 border border-god/25 text-[11px] font-mono text-god/80">{t}</span>)}
                    {m.note && <span className="text-[12px] text-dim/70 leading-relaxed">{m.note}</span>}
                  </div>
                )}
                <div onClick={() => setOpenId(open ? null : m.id)}
                  className={`px-3 py-2 text-[13px] text-slate-300 leading-relaxed whitespace-pre-wrap cursor-pointer hover:bg-panel/40 transition-colors ${open ? '' : 'line-clamp-3'}`}>
                  {body}
                </div>
                {!open && body.length > 120 && (
                  <div className="px-3 pb-1.5 text-[11px] font-mono text-dim/35 select-none">点击展开全文</div>
                )}
              </div>
            );
          })}
        </div>

        {toast && <div className="shrink-0 px-4 py-1.5 border-t border-edge bg-panel text-[12px] font-mono text-god/85">{toast}</div>}

        {editing && (
          <BookmarkEditModal
            mark={editing}
            onSave={(patch) => { update(editing.id, patch); setEditing(null); }}
            onClose={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  );
}

/* ⚠ 模块级组件，勿内联进父组件（内联=每键重挂，中文输入法会断字） */
function BookmarkEditModal({ mark, onSave, onClose }: { mark: Bookmark; onSave: (p: { note: string; tags: string[] }) => void; onClose: () => void }) {
  const [note, setNote] = useState(mark.note);
  const [tags, setTags] = useState(mark.tags.join(' '));

  return (
    <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-god/40 bg-void shadow-[0_0_60px_rgba(0,0,0,0.85)] overflow-hidden">
        <header className="flex items-center gap-2 px-4 py-2.5 border-b border-edge bg-panel">
          <span className="text-sm font-bold text-god">✎ 备注与标签</span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </header>
        <div className="p-4 space-y-3">
          <div>
            <div className="text-[12px] font-mono text-dim/60 mb-1">备注（为什么留下这一楼）</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
              className="w-full bg-void border border-edge rounded px-2.5 py-1.5 text-[13px] text-slate-200 leading-relaxed outline-none focus:border-god/50 resize-y" />
          </div>
          <div>
            <div className="text-[12px] font-mono text-dim/60 mb-1">标签（空格分隔，最多 8 个）</div>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="如：名场面 伏笔 高光 想续写"
              className="w-full bg-void border border-edge rounded px-2.5 py-1.5 text-[13px] text-slate-200 outline-none focus:border-god/50" />
          </div>
        </div>
        <footer className="flex items-center gap-2 px-4 py-2.5 border-t border-edge bg-panel">
          <span className="flex-1" />
          <button onClick={onClose} className="px-3 py-1 rounded border border-edge text-dim hover:text-slate-300 text-[13px] font-mono">取消</button>
          <button onClick={() => onSave({ note: note.trim(), tags: tags.split(/[\s,，]+/).filter(Boolean).slice(0, 8) })}
            className="px-3 py-1 rounded border border-god/40 text-god bg-god/10 hover:bg-god/20 text-[13px] font-mono">✓ 保存</button>
        </footer>
      </div>
    </div>
  );
}
