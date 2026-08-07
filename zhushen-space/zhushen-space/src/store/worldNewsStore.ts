import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* 🌍 世界见闻（P2·借鉴 world-backstage 舆情层）：任务世界**自己的**新闻/论坛快照——
   当地媒体在报什么、市井在传什么（与「公共频道」的契约者广场是两个虚构层）。
   只读氛围层：绝不写回世界事实/NPC 认知/正文因果。数据源=已公开的世界事件(known/direct)
   + trace 表象 + 传闻「流传」版本；hidden 事件连候选都进不来（可见性门在 systems/worldNews.ts）。
   快照带 worldName，读取按世界过滤；手动刷新为主（自动刷新会出现"旧新闻追着新剧情跑"）。 */

export interface NewsItem {
  id: string;
  kind: 'news' | 'forum';
  sourceType: 'official' | 'unofficial';   // 来源层级 ≠ 世界真相：官方也可能措辞保守，小道也可能碰巧为真
  claim: 'fact' | 'mixed' | 'rumor';       // 内容与已结算世界事实的关系（trace 来源强制 mixed/rumor）
  title: string;
  body: string;
  outlet?: string;     // 媒体/板块名（载体随世界时代变：现代=新闻APP/论坛，古代=官府告示/茶馆，修真=坊市传讯）
  heat?: string;       // 传播范围（小圈子/街谈巷议/全城哗然…）
  replies?: string[];  // 论坛代表回帖（≤4）
  refId?: string;      // 关联的事件/传闻 id（W_x / R_x）
}

export interface NewsSnapshot {
  worldName: string;
  worldTime: string;   // 生成时的世界时间（世界继续走后可提示"可能已过期"）
  turn: number;
  generatedAt: number;
  items: NewsItem[];
}

const SNAPSHOT_CAP = 8;   // 全部世界共存，新挤旧；读取按 worldName 过滤

interface WorldNewsState {
  snapshots: NewsSnapshot[];
  refreshing: boolean;
  setRefreshing: (v: boolean) => void;
  pushSnapshot: (s: NewsSnapshot) => void;
  clearAll: () => void;
}

export const useWorldNews = create<WorldNewsState>()(
  persist(
    (set): WorldNewsState => ({
      snapshots: [],
      refreshing: false,
      setRefreshing: (v) => set({ refreshing: v }),
      pushSnapshot: (s) => set((st) => ({ snapshots: [...(st.snapshots ?? []), s].slice(-SNAPSHOT_CAP) })),
      clearAll: () => set({ snapshots: [], refreshing: false }),
    }),
    { name: 'drpg-worldnews' }
  )
);
