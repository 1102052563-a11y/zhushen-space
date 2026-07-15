import { useState } from 'react';
import type { ChaosRecordDraft } from '../systems/chaosWorld';

// 离世时生成的「混沌记录」预览 + opt-in 上传确认。可在上传前编辑标题/正文。上传 = 公开发布到混沌世界看板。
export default function ChaosUploadModal({ draft, onUpload, onClose }: {
  draft: ChaosRecordDraft;
  onUpload: (d: ChaosRecordDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const bandColor =
    draft.offset >= 80 ? 'text-blood' :
    draft.offset >= 60 ? 'text-amber-400' :
    draft.offset >= 40 ? 'text-gold' :
    draft.offset >= 20 ? 'text-sky-400' : 'text-god';

  async function doUpload() {
    setBusy(true); setErr('');
    try {
      await onUpload({ ...draft, title: title.trim() || draft.title, body: body.trim() || draft.body });
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-void/80 backdrop-blur-sm px-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[88vh] flex flex-col bg-panel border border-god/30 rounded-2xl shadow-[0_0_50px_rgba(70,227,207,0.1)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-edge shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-100">☄️ 混沌记录 · 是否上传到混沌世界</h2>
            <button onClick={onClose} className="text-dim hover:text-blood text-sm font-mono">✕</button>
          </div>
          <p className="text-[12px] text-dim mt-1 leading-relaxed">
            这一趟对【{draft.world}】的影响已生成。上传 = <span className="text-amber-400/90">公开发布</span>到混沌世界看板，别的契约者能读到、并据此生成被你影响过的世界。不上传只是关掉本次。
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">
          {/* 世界 + 偏移度 */}
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-base font-bold text-slate-100">{draft.world}</span>
            {draft.tier && <span className="text-sm font-mono text-sky-400/80">{draft.tier}</span>}
            <span className={`text-sm font-mono ${bandColor}`}>剧情偏移度 {draft.offset} · {draft.band}</span>
          </div>

          <div>
            <div className="text-[12px] font-mono text-dim mb-1">标题</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-void border border-god/25 rounded px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-god/60"
            />
          </div>

          <div>
            <div className="text-[12px] font-mono text-dim mb-1">影响概述（可编辑）</div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="w-full bg-void border border-god/25 rounded px-2 py-1.5 text-[14px] text-slate-300 leading-relaxed outline-none focus:border-god/60 resize-y"
            />
          </div>

          {/* 偏移点 */}
          {draft.nodes.length > 0 && (
            <div>
              <div className="text-[12px] font-mono text-dim mb-1">剧情偏移点（{draft.nodes.length}）</div>
              <div className="space-y-1.5">
                {draft.nodes.map((nd, i) => (
                  <div key={i} className="text-[13px] text-slate-300 bg-void/60 border border-edge/60 rounded px-2 py-1.5">
                    <span className={`font-mono mr-2 ${nd.严重度 >= 3 ? 'text-blood' : nd.严重度 >= 2 ? 'text-amber-400' : 'text-dim'}`}>
                      [严重度{nd.严重度}]
                    </span>
                    <span className="text-dim">{nd.原著节点}</span>
                    <span className="mx-1 text-god/60">→</span>
                    <span>{nd.主角改动}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 钩子 */}
          {draft.hooks.length > 0 && (
            <div>
              <div className="text-[12px] font-mono text-dim mb-1">留给后人的钩子</div>
              <ul className="text-[13px] text-slate-300 list-disc pl-5 space-y-0.5">
                {draft.hooks.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </div>
          )}

          {err && <div className="text-sm text-blood">上传失败：{err}</div>}
        </div>

        <div className="px-6 py-3 border-t border-edge flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 border border-edge text-dim rounded-lg hover:text-slate-200 text-sm font-mono transition-colors disabled:opacity-50"
          >
            不上传
          </button>
          <button
            onClick={doUpload}
            disabled={busy}
            className="px-6 py-2 border border-god/50 text-god bg-god/10 rounded-lg hover:bg-god/20 text-sm font-mono transition-colors disabled:opacity-50"
          >
            {busy ? '◌ 上传中…' : '☄️ 上传到混沌世界'}
          </button>
        </div>
      </div>
    </div>
  );
}
