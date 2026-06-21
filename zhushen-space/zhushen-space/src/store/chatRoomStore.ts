import { create } from 'zustand';
import type { ChatMsg, RosterEntry, ChatSelf } from '../systems/chatProtocol';

// 全局实时聊天室·会话态。【不持久化】——和 multiplayerStore 一样是 live 状态，刷新即断开重来。
// 由 systems/chatClient.ts 在收到 WS 事件时写入；ChatRoomPanel 订阅它。

export type ChatStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';
// 载荷类型（ChatMsg/RosterEntry/ChatSelf）已上移到 systems/chatProtocol.ts 作单一事实来源；
// 这里再导出 + 保留 ChatPeer/ChatMe 别名，使「从 store 引类型」的现有用法（如 ChatRoomPanel）不变。
export type { ChatMsg };
export type ChatPeer = RosterEntry;
export type ChatMe = ChatSelf;

interface ChatState {
  status: ChatStatus;
  me: ChatMe | null;
  messages: ChatMsg[];
  roster: ChatPeer[];
  error: string | null;
  entered: boolean;   // 本会话是否已进入(连过)聊天室——决定面板显门禁还是聊天
  open: boolean;      // 聊天面板当前是否打开——决定新消息是否计入未读
  unread: number;     // 面板关闭期间收到的新消息数（导航红点）
  _set: (p: Partial<ChatState>) => void;
  pushMessage: (m: ChatMsg) => void;
  reset: () => void;
}

const MAX_MESSAGES = 200;

const INIT = {
  status: 'idle' as ChatStatus,
  me: null as ChatMe | null,
  messages: [] as ChatMsg[],
  roster: [] as ChatPeer[],
  error: null as string | null,
  entered: false,
  open: false,
  unread: 0,
};

export const useChatRoom = create<ChatState>((set): ChatState => ({
  ...INIT,
  _set: (p) => set(p),
  // 按 id 去重再追加：防双连接/重连回显把同一条消息收两遍（发言显示两次）。id 已存在则原样不动。
  pushMessage: (m) => set((s) => (s.messages.some((x) => x.id === m.id) ? {} : { messages: [...s.messages, m].slice(-MAX_MESSAGES) })),
  reset: () => set((s) => ({ ...INIT, open: s.open })),   // 保留 open（面板挂载态由面板拥有，不被 leave 重置）
}));
