import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildBuiltinTemplates, BUILTIN_TEMPLATES, type TheaterTemplate } from '../systems/theaterTemplates';

/* ══════════ 🎭 小剧场·花样模板库 · drpg-theater ══════════
   玩家可增删改的「这一则该怎么写」清单，替代原先写死在 MINI_THEATER_RULE 里的 15 个风格词。
   纯逻辑（内置数据 / 抽取 / 注入块拼装）在 systems/theaterTemplates.ts。

   ⚠ **配置类 store**：模板是玩家资产、不是本档进度 → 进 saveManager 的 STORES 但**不给 clear**
     （新游戏保留），并进 configExport（随全局配置导出）。
   ⚠ seeded 标志：内置只在第一次种一次。玩家删掉的内置条目**不会**在下次启动时复活——
     想要回来点「恢复内置」。 */

const CAP = 60;

interface TheaterState {
  templates: TheaterTemplate[];
  seeded: boolean;
  pickCount: number;   // 每次抽几条花样（1~3，默认 2）

  /** 首次使用时种入内置（幂等·只种一次）。由设置页与生成路径各自兜底调用。 */
  ensureSeeded: () => void;
  upsert: (t: Partial<TheaterTemplate> & { name: string }, id?: string) => void;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  setPickCount: (n: number) => void;
  /** 把内置补齐回来（按 id 判重：已存在的不动，缺的补回；玩家自建的不受影响）。返回补回条数。 */
  restoreBuiltins: () => number;
  /** 全部启用 / 全部禁用（批量勾选）。 */
  setAllEnabled: (on: boolean) => void;
}

let seq = 0;
function newId(): string {
  seq += 1;
  return `tt_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export const useTheater = create<TheaterState>()(
  persist(
    (set, get): TheaterState => ({
      templates: [],
      seeded: false,
      pickCount: 2,

      ensureSeeded: () => {
        if (get().seeded) return;
        set({ templates: buildBuiltinTemplates(), seeded: true });
      },

      upsert: (t, id) => set((s) => {
        const name = String(t.name || '').trim().slice(0, 20);
        if (!name) return s;
        const prompt = String(t.prompt || '').trim().slice(0, 300);
        const i = id ? s.templates.findIndex((x) => x.id === id) : -1;
        if (i >= 0) {
          const next = s.templates.slice();
          next[i] = { ...next[i], name, prompt };
          return { templates: next };
        }
        return { templates: [...s.templates, { id: newId(), name, prompt, enabled: true, builtin: false }].slice(0, CAP) };
      }),

      toggle: (id) => set((s) => ({ templates: s.templates.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)) })),
      remove: (id) => set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),
      setPickCount: (n) => set({ pickCount: Math.max(1, Math.min(3, Math.floor(n) || 1)) }),

      restoreBuiltins: () => {
        const have = new Set(get().templates.map((t) => t.id));
        const missing = buildBuiltinTemplates().filter((t) => !have.has(t.id));
        if (missing.length) set((s) => ({ templates: [...missing, ...s.templates].slice(0, CAP), seeded: true }));
        return missing.length;
      },

      setAllEnabled: (on) => set((s) => ({ templates: s.templates.map((t) => ({ ...t, enabled: on })) })),
    }),
    { name: 'drpg-theater' },
  ),
);

export { CAP as THEATER_TEMPLATE_CAP, BUILTIN_TEMPLATES };
