import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ════════════════════════════════════════════
   NPC 私聊缓存（drpg-npc-chat）
   - 每个 NPC 与主角的私下对话记录（对白 + 交互描述旁白），上限 ~300 条
   - 属游戏进度（按 C-id 索引，C-id 跨存档复用）→ 纳入 saveManager 快照 + clearProgress，随存档走，不进 configExport
   - 调 API：systems/npcChat.ts（resolveApiChain('npcchat', 正文API) + apiChatFallback）
   - 设计见会话计划（NPC 私聊·NSFW·交互描述）
════════════════════════════════════════════ */

export interface NpcChatTurn {
  id: string;
  role: 'player' | 'npc';
  text: string;        // player：玩家说/做的；npc：她的对白
  scene?: string;      // 仅 npc 回合：交互描述（第三人称旁白，可 NSFW）
  ts: number;
}

const CAP = 300;       // 每个 NPC 缓存上限（200~300）
let _seq = Date.now();

interface NpcChatState {
  chats: Record<string, NpcChatTurn[]>;
  appendTurn: (npcId: string, turn: { role: 'player' | 'npc'; text: string; scene?: string }) => void;
  resetChat: (npcId: string) => void;
  clearAll: () => void;
}

export const useNpcChat = create<NpcChatState>()(
  persist(
    (set) => ({
      chats: {},
      appendTurn: (npcId, turn) =>
        set((s) => {
          const prev = s.chats[npcId] ?? [];
          const next = [...prev, { ...turn, id: `t_${++_seq}`, ts: Date.now() }].slice(-CAP);
          return { chats: { ...s.chats, [npcId]: next } };
        }),
      resetChat: (npcId) =>
        set((s) => {
          const chats = { ...s.chats };
          delete chats[npcId];
          return { chats };
        }),
      clearAll: () => set({ chats: {} }),
    }),
    {
      name: 'drpg-npc-chat',
      partialize: (s) => ({ chats: s.chats }),
      merge: (persisted: any, current) => ({
        ...current,
        chats: (persisted && typeof persisted.chats === 'object' && persisted.chats) || {},
      }),
    },
  ),
);
