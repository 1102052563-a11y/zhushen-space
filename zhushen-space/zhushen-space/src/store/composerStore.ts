import { create } from 'zustand';

/* 主聊天输入框状态（真相源·2026-07-23 从 App 的 useState 迁入）。
   ⚠架构约束：**App 绝不订阅 value**——只有 ChatComposer / ChoiceOptions 这类小组件订阅。
   inputValue 每键都变，订阅进 1.1 万行的 App 就是每键整树重渲（打字卡顿的根源，本次迁移要治的病）；
   App 侧一律 `useComposer.getState().xxx()` 读写（zustand 的写不重渲非订阅者）。
   旧用法兼容：背包等深层组件的 `useComposer.getState().fill(text)` 语义不变（填入 + 聚焦输入框）。 */
interface ComposerState {
  value: string;
  /** fill() 递增的序号：ChatComposer 据此聚焦输入框、App 据此关掉背包弹窗（稀事件，订阅无压力）。 */
  fillSeq: number;
  /** 打字 onChange / 程序化恢复（不聚焦）。 */
  setValue: (v: string) => void;
  /** 函数式改写（叠加选项/追加文本等，沿用原 setState(prev=>…) 的写法零改动迁移）。 */
  update: (fn: (prev: string) => string) => void;
  /** 覆盖填入 + 请求聚焦（背包「使用物品」、世界卡填入等用户可见的填入动作）。 */
  fill: (text: string) => void;
  clear: () => void;
}

const readDraft = () => { try { return localStorage.getItem('drpg-chat-draft') || ''; } catch { return ''; } };

export const useComposer = create<ComposerState>((set) => ({
  value: readDraft(),   // 输入草稿恢复：误触返回/刷新/崩溃也不丢已输入的行动
  fillSeq: 0,
  setValue: (v) => set({ value: v }),
  update: (fn) => set((s) => ({ value: fn(s.value) })),
  fill: (text) => set((s) => ({ value: text, fillSeq: s.fillSeq + 1 })),
  clear: () => set({ value: '' }),
}));

// 输入草稿持久化（模块级订阅·不经 React）：随输入写 localStorage、清空即删。
// 小字符串直写，无需合并写盘；SSR/测试环境无 localStorage 时静默跳过。
useComposer.subscribe((s, prev) => {
  if (s.value === prev.value) return;
  try {
    if (s.value) localStorage.setItem('drpg-chat-draft', s.value);
    else localStorage.removeItem('drpg-chat-draft');
  } catch { /* */ }
});
