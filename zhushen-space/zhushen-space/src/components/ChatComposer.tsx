import { useEffect, useRef } from 'react';
import { useComposer } from '../store/composerStore';
import { useSettings } from '../store/settingsStore';

/* 主聊天输入框（2026-07-23 从 App 拆出·治打字卡顿）。
   inputValue 每键都变，留在 1.1 万行的 App 里就是每键整树重渲——拆出后打字只重渲这里。
   ⚠必须是模块级组件：定义在 App 函数体内会每次重渲重挂载，直接打断中文输入法组词（IME 坑，踩过）。
   与 App 的分工：值的真相源在 composerStore；App 发送时 `useComposer.getState().value` 取、`clear()` 清，
   外部填入走 `fill()`（聚焦在本组件内响应 fillSeq 完成）。
   拆成两个组件是为了保持输入条里的 DOM 顺序：textarea、↵ 在前，⏩/🔁（不碰输入值，留在 App）在中，▶ 在尾。 */

export function ComposerTextarea({ onSend, onAddImages }: {
  onSend: () => void;
  onAddImages: (files: File[]) => void;
}) {
  const value = useComposer((s) => s.value);
  const fillSeq = useComposer((s) => s.fillSeq);
  const disableEnterSend = useSettings((s) => s.disableEnterSend);
  const showNewlineButton = useSettings((s) => s.showNewlineButton);
  const ref = useRef<HTMLTextAreaElement>(null);

  // fill()（背包「使用物品」等）→ 聚焦输入框；首挂 fillSeq=0 不触发
  useEffect(() => {
    if (fillSeq) setTimeout(() => ref.current?.focus(), 0);
  }, [fillSeq]);
  // 自适应高度：值变化（含 fill/叠加选项等程序化写入）统一在此调整，onInput 无法覆盖非键入路径
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 128) + 'px'; }
  }, [value]);

  return (
    <>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => useComposer.getState().setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { if (disableEnterSend) return; e.preventDefault(); onSend(); } }}
        onPaste={(e) => { const imgs = Array.from(e.clipboardData?.items || []).filter((it) => it.kind === 'file' && it.type.startsWith('image/')).map((it) => it.getAsFile()).filter(Boolean) as File[]; if (imgs.length) { e.preventDefault(); onAddImages(imgs); } }}
        placeholder={disableEnterSend ? '在此输入你的行动…（回车发送已禁用，点 ▶ 发送）' : (showNewlineButton ? '在此输入你的行动…（Shift+Enter 或点 ↵ 换行）' : '在此输入你的行动…（Shift+Enter 换行）')}
        className="flex-1 max-lg:basis-full max-lg:order-1 bg-transparent text-sm max-lg:text-base text-slate-200 placeholder:text-dim outline-none resize-none max-h-32 overflow-y-auto leading-relaxed py-1"
      />
      {showNewlineButton && (
        <button
          onClick={() => {
            const el = ref.current;
            const cur = useComposer.getState().value;
            const start = el?.selectionStart ?? cur.length;
            const end = el?.selectionEnd ?? cur.length;
            useComposer.getState().setValue(cur.slice(0, start) + '\n' + cur.slice(end));
            setTimeout(() => {
              if (!el) return;
              el.focus();
              const pos = start + 1;
              el.setSelectionRange(pos, pos);
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 128) + 'px';
            }, 0);
          }}
          title="插入换行（Shift+Enter 同效）"
          className="w-7 h-7 max-lg:w-9 max-lg:h-9 max-lg:order-2 flex items-center justify-center text-dim border border-edge rounded text-sm hover:bg-panel2 hover:text-slate-200 shrink-0 transition-colors"
        >
          ↵
        </button>
      )}
    </>
  );
}

export function ComposerSendButton({ generating, onSend }: {
  generating: boolean;
  onSend: () => void;
}) {
  const empty = useComposer((s) => !s.value.trim());   // 布尔选择器：只在 空↔非空 翻转时重渲本按钮
  return (
    <button
      onClick={onSend}
      disabled={generating || empty}
      className="w-7 h-7 max-lg:w-9 max-lg:h-9 max-lg:order-2 max-lg:ml-auto flex items-center justify-center text-god border border-god/30 rounded hover:bg-god/10 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {generating ? <span className="animate-spin text-xs">◌</span> : '▶'}
    </button>
  );
}
