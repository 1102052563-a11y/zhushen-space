import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* 字段历史趋势（数据库引入·延伸）——每回合给一批"重点字段"(主角/NPC 六维、阶位、等级)采样一个值，
 * 只在**值变了**时追加一个点 → 形成"某字段过去 N 回合怎么变的"时间线。
 * 配合审计(②)横看、趋势竖看：能定位某个数值**哪一回合、变了多少**漂掉的，再去①锁死它。
 * 键 = `player:<维>` / `npc:<id>:<维|realm|level>`。持久化 drpg-field-history，随存档、新游戏清空。
 */

export interface HistPoint { turn: number; value: number | string }

const PER_KEY = 40;     // 每个字段最多留 40 个变化点
const MAX_KEYS = 400;   // 总字段序列上限（超了丢"最久没更新"的）

interface FieldHistState {
  series: Record<string, HistPoint[]>;
  record: (key: string, turn: number, value: number | string) => void;   // 只在与上一点不同才追加
  seriesOf: (key: string) => HistPoint[];
  clear: () => void;
}

export const useFieldHistory = create<FieldHistState>()(
  persist(
    (set, get): FieldHistState => ({
      series: {},
      record: (key, turn, value) =>
        set((s) => {
          if (!key) return s;
          const arr = s.series[key] ? [...s.series[key]] : [];
          const last = arr[arr.length - 1];
          if (last && last.value === value) return s;   // 没变 → 不记（时间线是阶梯函数，省体积）
          arr.push({ turn, value });
          const series = { ...s.series, [key]: arr.length > PER_KEY ? arr.slice(arr.length - PER_KEY) : arr };
          const keys = Object.keys(series);
          if (keys.length > MAX_KEYS) {
            keys.sort((a, b) => (series[a][series[a].length - 1].turn) - (series[b][series[b].length - 1].turn));
            for (const k of keys.slice(0, keys.length - MAX_KEYS)) delete series[k];
          }
          return { series };
        }),
      seriesOf: (key) => get().series[key] ?? [],
      clear: () => set({ series: {} }),
    }),
    { name: 'drpg-field-history' },
  ),
);
