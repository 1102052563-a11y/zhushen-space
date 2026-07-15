import { useState } from 'react';

/* 生图提示词编辑框：显示某张已生成图片（正文配图 / 主角·NPC 肖像）当前所用的生图提示词，
   玩家可直接改，点「重新生成」按新提示词重出这张图。GPT/自然语言模型 = 中文描述，NAI/标签模型 = 英文 tags，原样展示由玩家自行编辑。
   受控本地 state：由父组件在打开时才挂载本组件、以 initialPrompt 初始化（每次打开都是新实例，无需 effect 同步）。
   ⚠ 铁则：不要把本组件内联定义进父组件（受控 textarea 每键重挂会断输入法）。 */
export default function ImagePromptEditModal({
  title, initialPrompt, busy, note, onClose, onSubmit,
}: {
  title?: string;
  initialPrompt: string;
  busy?: boolean;
  note?: string;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
}) {
  const [text, setText] = useState(initialPrompt);
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => { if (!busy) onClose(); }}>
      <div className="bg-void border border-god/30 rounded-2xl w-full max-w-2xl max-h-[90dvh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.85)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 p-4 border-b border-edge shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg">✏️</span>
            <h2 className="text-base font-bold text-slate-100 truncate">{title || '编辑生图提示词'}</h2>
          </div>
          <button onClick={onClose} disabled={busy} className="text-dim/50 hover:text-blood text-lg font-mono disabled:opacity-40">✕</button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            autoFocus
            placeholder="生图提示词…"
            className="w-full bg-void border border-edge rounded px-3 py-2 text-[13px] leading-relaxed text-slate-200 focus:outline-none focus:border-god/50 resize-y font-mono min-h-[220px]"
          />
          <div className="text-[11px] text-dim/45 leading-relaxed">
            {note || '这是当前生成该图片的提示词。改完点「重新生成」即按新提示词重出这张图（画师串 / 负面词仍由「生图设置」自动附加，无需写入）。'}
          </div>
        </div>
        <footer className="flex items-center justify-end gap-2 p-3 border-t border-edge shrink-0">
          <button onClick={onClose} disabled={busy} className="text-[13px] font-mono px-3 py-1.5 rounded-lg border border-edge text-dim hover:text-slate-200 transition-colors disabled:opacity-40">取消</button>
          <button onClick={() => onSubmit(text)} disabled={busy || !text.trim()} className="text-[13px] font-semibold px-3 py-1.5 rounded-lg border border-god/50 text-god bg-god/10 hover:bg-god/20 transition-colors disabled:opacity-40">
            {busy ? '◌ 生成中…' : '🔄 重新生成'}
          </button>
        </footer>
      </div>
    </div>
  );
}
