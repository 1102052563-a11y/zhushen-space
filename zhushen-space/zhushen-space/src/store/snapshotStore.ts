/* 逐回合演化快照库（drpg-evosnap）——每回合把**全部演化变量**整份快照一次、保留最近 N 份。
 *
 * 你要的是"所有信息的快照"：这里直接把所有 drpg-* 进度变量（已由各 store 的 partialize 剥掉图片、纯文本）
 * 整份抓下来，而不只是某几项。用途：
 *   ① 给防漂哨(driftGuard)当"回合初基线"——最新一份=本回合演化前的确认值，任意域(六维/技能/物品/天赋/势力…)都能据此对账回退；
 *   ② 可查的逐回合历史，保留最近 keep 份（默认 3·可配 setKeep）。
 * snaps 留**内存**（整份状态×N 太大、持久化会撑爆 localStorage；跨刷新的整档恢复由 autosnap 负责）；只持久化 keep 这个配置。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface EvoSnapshot {
  turn: number;
  ts: number;
  stores: Record<string, string>;   // localStorage key → 该 store 的 JSON 串（zustand persist 格式 {state,version}）
}

interface SnapState {
  snaps: EvoSnapshot[];
  keep: number;
  setKeep: (n: number) => void;
  push: (s: EvoSnapshot) => void;
  latest: () => EvoSnapshot | undefined;
  clear: () => void;
}

export const useSnapshots = create<SnapState>()(
  persist(
    (set, get): SnapState => ({
      snaps: [],
      keep: 3,
      setKeep: (n) => set({ keep: Math.max(1, Math.min(20, Math.floor(n) || 3)) }),
      push: (s) =>
        set((st) => {
          const arr = [...st.snaps, s];
          const k = Math.max(1, st.keep);
          return { snaps: arr.length > k ? arr.slice(arr.length - k) : arr };
        }),
      latest: () => { const a = get().snaps; return a[a.length - 1]; },
      clear: () => set({ snaps: [] }),
    }),
    { name: 'drpg-evosnap', partialize: (s) => ({ keep: s.keep } as any) },   // 只持久化 keep；snaps 留内存
  ),
);

/** 从一份快照里取出某 store 的 state（zustand persist 把状态包成 {state,version}，这里拆出 state）。*/
export function snapState(snap: EvoSnapshot | undefined, key: string): any {
  if (!snap) return undefined;
  const raw = snap.stores[key];
  if (!raw) return undefined;
  try { const o = JSON.parse(raw); return o?.state ?? o; } catch { return undefined; }
}

/** 抓取本回合"演化前基线"：把所有 drpg-* 进度变量（+主角存档键）整份快照一次，保留最近 keep 份。
 *  读 localStorage（= 各 store 已持久化、已剥图的当前值），文本、体积可控。*/
export function captureEvoSnapshot(turn: number): void {
  try {
    const stores: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith('drpg-') || k === 'zhushen-save-v1') {
        const v = localStorage.getItem(k);
        if (v != null) stores[k] = v;
      }
    }
    useSnapshots.getState().push({ turn, ts: Date.now(), stores });
  } catch { /* 快照失败不阻断回合 */ }
}
