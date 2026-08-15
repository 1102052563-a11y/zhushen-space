import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* 私信（一对一私聊）数据层 —— drpg-dm
   - 可私信对象：契约者 / 随从 / 宠物（土著、召唤物不可）；既可是已建档 NPC，也可是公共频道里尚未建档的发帖人
   - AI 扮演对方据其档案/发言回应；支持 聊天 / 购买 / 给予出售 / 索取 / 私下交易(以物换物)
   - 交易逻辑仿公共频道：AI 出报价 → 玩家可讨价还价 → 点「成交」由代码确定性结算 */

export type DmDealKind = 'buy' | 'sell' | 'request' | 'barter';
export type DmDealStatus = 'pending' | 'done' | 'rejected' | 'cancelled';

/* 交易中涉及的物品（玩家收到的物品带固定格式字段，供入库展示）*/
export interface DmDealItem {
  name: string;
  gradeDesc?: string;
  category?: string;
  qty: number;
  effect?: string;
  origin?: string; subType?: string; combatStat?: string; durability?: string;
  requirement?: string; affix?: string; score?: string; intro?: string; appearance?: string;
  tags?: string[];
}

export interface DmDeal {
  id: string;
  kind: DmDealKind;
  giveItem?: DmDealItem;                              // 玩家交出的物品（→ 对方储存空间）
  giveCurrency?: { amount: number; type: string };   // 玩家支付的货币
  getItem?: DmDealItem;                               // 玩家获得的物品
  getCurrency?: { amount: number; type: string };    // 玩家收到的货币
  note?: string;                                      // 对方话术/条件
  source?: 'have' | 'source' | 'free';               // 对方物品来源：自有 / 代购转卖 / 赠予
  status: DmDealStatus;
  ts: number;
}

/* 消息花样（借鉴 Abstract外置手机的消息类型·缺省 text 纯文本，全部可选向后兼容）：
   recalled=对方撤回的消息（text 是"撤回了一条消息"占位，orig 存原文，点开偷看）；
   poke=戳一戳（居中演出行）；quote=引用主角某句话再回应（quote 存被引用原文）。*/
export type DmMsgKind = 'text' | 'recalled' | 'poke' | 'quote';
/* NPC 回复自带的状态头（借鉴外置手机 <message> 头·纯展示，不回喂 AI）*/
export interface DmMsgMeta { emotion?: string; location?: string; state?: string; thought?: string }

export interface DmMessage {
  id: string;
  from: 'player' | 'npc' | 'system';
  text: string;
  ts: number;
  deal?: DmDeal;     // 该条消息附带的交易提案
  kind?: DmMsgKind;  // 缺省 'text'
  orig?: string;     // kind='recalled'：被撤回的原文（UI 点开偷看）
  quote?: string;    // kind='quote'：被引用的主角原话
  meta?: DmMsgMeta;  // 状态头（一轮回复只挂第一条 npc 消息上）
}

export interface DmThread {
  id: string;
  targetId?: string;        // C-id（已建档则有；频道未建档 NPC 为空）
  targetName: string;
  targetTier?: string;
  targetJob?: string;
  targetPersona?: string;
  targetStrength?: string;
  targetTag?: string;       // npcTag（契约者/随从/宠物…）
  sourceContent?: string;   // 频道发言原文（未建档 NPC 据此回应）
  archived?: boolean;       // 是否已生成完整 NPC 档案
  messages: DmMessage[];
  createdAt: number;
  updatedAt: number;
  unread?: number;          // 未读条数（NPC主动来讯时+N；打开该会话清零；导航「私信」红点=各线程之和）
}

/* 可私信/可加好友判定：白名单——仅「随从 / 契约者 / 宠物」三类可；
   土著、召唤物、害兽、路人等一切其它标签、以及无标签，一律不可私信/加好友。 */
export function isDmableTag(tag?: string): boolean {
  return /随从|契约者|宠物/.test((tag || '').trim());
}

let _seq = 0;
function uid(prefix: string): string { _seq = (_seq + 1) % 1e6; return `${prefix}${Date.now().toString(36)}${_seq.toString(36)}`; }

interface DmOpenInfo {
  id?: string; targetId?: string; targetName: string;
  targetTier?: string; targetJob?: string; targetPersona?: string; targetStrength?: string; targetTag?: string;
  sourceContent?: string;
}

interface DmState {
  threads: Record<string, DmThread>;
  order: string[];   // 线程 id，最近活跃在前
  openThread: (t: DmOpenInfo) => string;
  addMsg: (threadId: string, msg: Omit<DmMessage, 'id' | 'ts'> & { id?: string; ts?: number }) => string;
  bumpUnread: (threadId: string, n?: number) => void;
  clearUnread: (threadId: string) => void;
  updateDeal: (threadId: string, dealId: string, patch: Partial<DmDeal>) => void;
  patchThread: (threadId: string, patch: Partial<DmThread>) => void;
  removeThread: (threadId: string) => void;
  clearAll: () => void;
}

function threadKey(t: DmOpenInfo): string {
  if (t.id) return t.id;
  if (t.targetId) return `c:${t.targetId}`;
  return `n:${(t.targetName || '').trim()}`;
}

export const useDm = create<DmState>()(
  persist(
    (set) => ({
      threads: {},
      order: [],

      openThread: (t) => {
        const id = threadKey(t);
        set((s) => {
          const now = Date.now();
          const prev = s.threads[id];
          const merged: DmThread = prev
            ? {
                ...prev,
                // 用新信息补全空缺字段（频道信息可能比旧线程更全），但不覆盖已建档的 targetId
                targetId: prev.targetId || t.targetId,
                targetName: t.targetName || prev.targetName,
                targetTier: t.targetTier || prev.targetTier,
                targetJob: t.targetJob || prev.targetJob,
                targetPersona: t.targetPersona || prev.targetPersona,
                targetStrength: t.targetStrength || prev.targetStrength,
                targetTag: t.targetTag || prev.targetTag,
                sourceContent: prev.sourceContent || t.sourceContent,
                updatedAt: now,
              }
            : {
                id, targetId: t.targetId, targetName: t.targetName || '契约者',
                targetTier: t.targetTier, targetJob: t.targetJob, targetPersona: t.targetPersona,
                targetStrength: t.targetStrength, targetTag: t.targetTag, sourceContent: t.sourceContent,
                archived: !!t.targetId, messages: [], createdAt: now, updatedAt: now,
              };
          const order = [id, ...s.order.filter((x) => x !== id)];
          return { threads: { ...s.threads, [id]: merged }, order };
        });
        return id;
      },

      addMsg: (threadId, msg) => {
        const mid = msg.id ?? uid('M');
        set((s) => {
          const th = s.threads[threadId];
          if (!th) return s;
          const m: DmMessage = { id: mid, from: msg.from, text: msg.text, ts: msg.ts ?? Date.now(), deal: msg.deal, kind: msg.kind, orig: msg.orig, quote: msg.quote, meta: msg.meta };
          const order = [threadId, ...s.order.filter((x) => x !== threadId)];
          return { threads: { ...s.threads, [threadId]: { ...th, messages: [...th.messages, m], updatedAt: Date.now() } }, order };
        });
        return mid;
      },

      bumpUnread: (threadId, n = 1) =>
        set((s) => (s.threads[threadId] ? { threads: { ...s.threads, [threadId]: { ...s.threads[threadId], unread: (s.threads[threadId].unread || 0) + n } } } : s)),

      clearUnread: (threadId) =>
        set((s) => (s.threads[threadId]?.unread ? { threads: { ...s.threads, [threadId]: { ...s.threads[threadId], unread: 0 } } } : s)),

      updateDeal: (threadId, dealId, patch) =>
        set((s) => {
          const th = s.threads[threadId];
          if (!th) return s;
          const messages = th.messages.map((m) => m.deal && m.deal.id === dealId ? { ...m, deal: { ...m.deal, ...patch } } : m);
          return { threads: { ...s.threads, [threadId]: { ...th, messages, updatedAt: Date.now() } } };
        }),

      patchThread: (threadId, patch) =>
        set((s) => (s.threads[threadId] ? { threads: { ...s.threads, [threadId]: { ...s.threads[threadId], ...patch, updatedAt: Date.now() } } } : s)),

      removeThread: (threadId) =>
        set((s) => {
          const threads = { ...s.threads }; delete threads[threadId];
          return { threads, order: s.order.filter((x) => x !== threadId) };
        }),

      clearAll: () => set({ threads: {}, order: [] }),
    }),
    { name: 'drpg-dm', version: 1 },
  ),
);
