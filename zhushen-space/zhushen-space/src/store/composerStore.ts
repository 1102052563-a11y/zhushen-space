import { create } from 'zustand';

/* 输入框草稿通道（不持久化）——供背包/物品等深层组件把一段文字「填入」主聊天输入框。
   App 订阅 draft，非空时写进 inputValue 并清空 draft（一次性消费）。 */
interface ComposerState {
  draft: string;
  fill: (text: string) => void;
}

export const useComposer = create<ComposerState>((set) => ({
  draft: '',
  fill: (text) => set({ draft: text }),
}));
