import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clampInt, type AlmanacItem, type AlmanacType } from '../systems/calendar';
import { isHomeWorld } from '../systems/worldScope';

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

/* 归属兜底（worldScope 铁则）：AI **压根没给 world 这个键**时，默认归当前任务世界。
   —— 反过来（默认跨世界）更糟：某个任务世界的节日会跟着主角进下一个世界、被注入正文串味；
      而误归本世界只是「离开后看不见」，玩家在历面板取消「仅本世界可见」即可捞回。
   ⚠ 只看**键在不在**：面板永远显式传 world（勾了=世界名、没勾=''），所以手动「跨世界」不会被这条兜底吃掉；
      AI 显式写 world:"" 表达跨世界意图时同样被尊重。在乐园/枢纽时不兜底（那本就该是跨世界的）。 */
function resolveWorld(o: Record<string, unknown>, currentWorld: string): string {
  if ('world' in o) return String(o.world ?? '').trim().slice(0, 40);
  const wn = String(currentWorld || '').trim();
  return wn && !isHomeWorld(wn) ? wn.slice(0, 40) : '';
}

/** AI / 面板传来的任意形状 → 规范条目（越界夹取、类型兜底）。名字为空返回 null（丢弃）。
    currentWorld 只用于「AI 没给 world 键」时的归属兜底，见 resolveWorld。 */
export function normalizeItem(raw: unknown, id?: string, currentWorld = ''): AlmanacItem | null {
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
    world: resolveWorld(o, currentWorld) || undefined,
  };
}

interface CalendarState {
  items: AlmanacItem[];
  /** 增改一条。传 id=改，不传=新增。currentWorld 仅在**没给 world 键**时用于归属兜底（见 resolveWorld）。 */
  upsert: (raw: Partial<AlmanacItem>, id?: string, currentWorld?: string) => void;
  /** 批量落库（AI `almanac([...])` 指令用）：同名同世界→更新，否则新增。返回实际写入条数。 */
  applyMany: (list: unknown[], currentWorld?: string) => number;
  /** 按名字删（AI 指令 `almanacRemove("名")` 用）。返回删除条数。 */
  removeByName: (name: string) => number;
  remove: (id: string) => void;
  clearAll: () => void;
}

export const useCalendar = create<CalendarState>()(
  persist(
    (set, get): CalendarState => ({
      items: [],

      upsert: (raw, id, currentWorld = '') => set((s) => {
        const norm = normalizeItem(raw, id, currentWorld);
        if (!norm) return s;
        const i = id ? s.items.findIndex((x) => x.id === id) : -1;
        if (i >= 0) {
          const next = s.items.slice();
          next[i] = norm;
          return { items: next };
        }
        return { items: [...s.items, norm].slice(-CAP) };
      }),

      applyMany: (list, currentWorld = '') => {
        if (!Array.isArray(list) || !list.length) return 0;
        let n = 0;
        set((s) => {
          const next = s.items.slice();
          for (const raw of list) {
            const norm = normalizeItem(raw, undefined, currentWorld);
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
