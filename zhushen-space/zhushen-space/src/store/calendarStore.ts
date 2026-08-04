import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clampInt, type AlmanacItem, type AlmanacType } from '../systems/calendar';

/* ══════════ 世界历（drpg-calendar）══════════
   存「每年固定到期」的日子：节日 / 生日 / 纪念日 / 其它。与任务(miscStore.tasks)分开——
   任务会结算掉、历不会；历只有 (月,日)，年份在扮演里无意义。

   来源两条，都**不新增 API 调用**：
     ① 玩家在面板手动增删改
     ② 杂项演化阶段（已有）顺带输出 `almanac([...])` 指令 → miscParser 落到这里
   纯逻辑（序号换算 / 未来七天 / 从 worldTime 抠今天）在 systems/calendar.ts。

   world 字段：本世界专属（如「斗罗大陆·魂师大赛」）填世界名，跨世界的（乐园级纪念日）留空。
   ⚠ 离开世界不自动清——世界专属条目由 AI 按维护规则移除或玩家手动删；这与 truths 清单同策略。 */

const CAP = 60;   // 条目上限：防 AI 逐轮堆积；超出时丢最旧的（玩家锁定的除外——历没有锁定态，故按插入序裁）

/* 名称归一化匹配（去空白/标点/大小写后相等）：同名→更新而非重复堆叠，照 adventureTeamStore.nameEq 同款 */
function nameEq(a?: string, b?: string): boolean {
  const n = (s?: string) => (s ?? '').replace(/[\s·•・\-—_,，.。、|｜()（）【】[\]:：]/g, '').trim().toLowerCase();
  const x = n(a), y = n(b);
  return !!x && !!y && x === y;
}

const TYPES: AlmanacType[] = ['festival', 'birthday', 'anniversary', 'custom'];
function normType(v: unknown): AlmanacType {
  const t = String(v ?? '').trim() as AlmanacType;
  return TYPES.includes(t) ? t : 'custom';
}

let seq = 0;
function newId(): string {
  seq += 1;
  return `alm_${Date.now().toString(36)}_${seq.toString(36)}`;
}

/** AI / 面板传来的任意形状 → 规范条目（越界夹取、类型兜底）。名字为空返回 null（丢弃）。 */
export function normalizeItem(raw: unknown, id?: string): AlmanacItem | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = String(o.name ?? '').trim().slice(0, 40);
  if (!name) return null;
  const month = clampInt(o.month, 1, 12, 1);
  return {
    id: id || newId(),
    name,
    type: normType(o.type),
    month,
    day: clampInt(o.day, 1, 31, 1),
    days: clampInt(o.days, 1, 366, 1),
    displayDate: String(o.displayDate ?? '').trim().slice(0, 20) || undefined,
    note: String(o.note ?? '').trim().slice(0, 80) || undefined,
    world: String(o.world ?? '').trim().slice(0, 40) || undefined,
  };
}

interface CalendarState {
  items: AlmanacItem[];
  /** 增改一条（面板用）。传 id=改，不传=新增。 */
  upsert: (raw: Partial<AlmanacItem>, id?: string) => void;
  /** 批量落库（AI `almanac([...])` 指令用）：同名同世界→更新，否则新增。返回实际写入条数。 */
  applyMany: (list: unknown[]) => number;
  /** 按名字删（AI 指令 `almanacRemove("名")` 用）。返回删除条数。 */
  removeByName: (name: string) => number;
  remove: (id: string) => void;
  clearAll: () => void;
}

export const useCalendar = create<CalendarState>()(
  persist(
    (set, get): CalendarState => ({
      items: [],

      upsert: (raw, id) => set((s) => {
        const norm = normalizeItem(raw, id);
        if (!norm) return s;
        const i = id ? s.items.findIndex((x) => x.id === id) : -1;
        if (i >= 0) {
          const next = s.items.slice();
          next[i] = norm;
          return { items: next };
        }
        return { items: [...s.items, norm].slice(-CAP) };
      }),

      applyMany: (list) => {
        if (!Array.isArray(list) || !list.length) return 0;
        let n = 0;
        set((s) => {
          const next = s.items.slice();
          for (const raw of list) {
            const norm = normalizeItem(raw);
            if (!norm) continue;
            // 判重：同名 且 同世界（跨世界条目与同名的世界专属条目互不覆盖）
            const i = next.findIndex((x) => nameEq(x.name, norm.name) && (x.world || '') === (norm.world || ''));
            if (i >= 0) next[i] = { ...norm, id: next[i].id };   // 保留原 id，面板上的编辑焦点不跳
            else next.push(norm);
            n++;
          }
          return { items: next.slice(-CAP) };
        });
        return n;
      },

      removeByName: (name) => {
        const before = get().items.length;
        set((s) => ({ items: s.items.filter((x) => !nameEq(x.name, name)) }));
        return before - get().items.length;
      },

      remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
      clearAll: () => set({ items: [] }),
    }),
    { name: 'drpg-calendar' },
  ),
);

export { CAP as CALENDAR_CAP };
