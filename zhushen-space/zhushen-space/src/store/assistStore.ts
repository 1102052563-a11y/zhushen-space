import { create } from 'zustand';
import type { AssistCard, AssistMe } from '../systems/assistProtocol';

// 全局助战大厅·会话态。【不持久化】——和 tradeStore / chatRoomStore 一样是 live 状态，刷新即断开重来。
// 由 systems/assistClient.ts 在收到 WS 事件时写入；AssistPanel 订阅它。
// （被邀请生成的助战 NPC 是普通 npcStore 记录，已随存档持久化，与本 store 无关。）

export type AssistStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';
export type { AssistCard, AssistMe };

interface AssistState {
  status: AssistStatus;
  me: AssistMe | null;
  cards: AssistCard[];
  online: number;
  error: string | null;
  _set: (p: Partial<AssistState>) => void;
  reset: () => void;
}

const INIT = {
  status: 'idle' as AssistStatus,
  me: null as AssistMe | null,
  cards: [] as AssistCard[],
  online: 0,
  error: null as string | null,
};

export const useAssist = create<AssistState>((set): AssistState => ({
  ...INIT,
  _set: (p) => set(p),
  reset: () => set({ ...INIT }),
}));
