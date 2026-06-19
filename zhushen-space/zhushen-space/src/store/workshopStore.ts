import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* 创意工坊 store（配置层，非游戏进度）。
 *
 * 「在线读取为主」：前端拉一个托管的工坊索引（JSON）→ 浏览 → 一键安装；
 * 安装后在 installs 账本记下 来源id/版本/内容哈希，用于显示「已安装 / 有更新」。
 * 投稿走「导出投稿文件」，不直接上传（无社区后端）。
 *
 * 这里只存：工坊源列表 + 已安装账本 + 少量 UI 偏好；实际抓取/安装逻辑在 systems/workshop.ts。
 * 与 saveManager 无关（不是存档进度），与 configExport 同类（配置/偏好）。
 */

export interface WorkshopSource {
  id: string;
  name: string;
  url: string;        // 索引 JSON 的 URL（同源相对路径或绝对 URL）
  builtin?: boolean;  // 内置默认源（不可删，仅可关）
}

// 已安装条目账本（按工坊条目 id 记一条）
export interface InstallRecord {
  id: string;             // 工坊条目 id（meta.id）
  type: string;           // WorkshopKindId
  name: string;
  version?: string;
  contentHash?: string;
  sourceId?: string;
  installedAt: number;
}

const DEFAULT_SOURCE: WorkshopSource = {
  id: 'builtin-local',
  name: '诛神空间·内置工坊',
  url: 'workshop/index.json',   // 同源静态文件（public/workshop/index.json），随站点部署
  builtin: true,
};

interface WorkshopState {
  sources: WorkshopSource[];
  activeSourceId: string;
  installs: Record<string, InstallRecord>;

  setActiveSource: (id: string) => void;
  addSource: (name: string, url: string) => { ok: boolean; message: string };
  removeSource: (id: string) => void;
  renameSource: (id: string, name: string, url: string) => void;

  recordInstall: (rec: InstallRecord) => void;
  forgetInstall: (id: string) => void;
}

export const useWorkshop = create<WorkshopState>()(
  persist(
    (set, get): WorkshopState => ({
      sources: [DEFAULT_SOURCE],
      activeSourceId: DEFAULT_SOURCE.id,
      installs: {},

      setActiveSource: (id) => set({ activeSourceId: id }),

      addSource: (name, url) => {
        const nm = name.trim();
        const u = url.trim();
        if (!u) return { ok: false, message: '请填写索引 URL' };
        if (get().sources.some((s) => s.url === u)) return { ok: false, message: '该源已存在' };
        const src: WorkshopSource = { id: `src_${Date.now()}`, name: nm || u, url: u };
        set((s) => ({ sources: [...s.sources, src], activeSourceId: src.id }));
        return { ok: true, message: `已添加源「${src.name}」` };
      },

      removeSource: (id) =>
        set((s) => {
          const tgt = s.sources.find((x) => x.id === id);
          if (!tgt || tgt.builtin) return s;   // 内置源不可删
          const sources = s.sources.filter((x) => x.id !== id);
          const activeSourceId = s.activeSourceId === id ? (sources[0]?.id ?? DEFAULT_SOURCE.id) : s.activeSourceId;
          return { sources, activeSourceId };
        }),

      renameSource: (id, name, url) =>
        set((s) => ({
          sources: s.sources.map((x) =>
            x.id !== id ? x : { ...x, name: name.trim() || x.name, url: x.builtin ? x.url : (url.trim() || x.url) }
          ),
        })),

      recordInstall: (rec) => set((s) => ({ installs: { ...s.installs, [rec.id]: rec } })),
      forgetInstall: (id) =>
        set((s) => {
          const installs = { ...s.installs };
          delete installs[id];
          return { installs };
        }),
    }),
    {
      name: 'drpg-workshop',
      // 老版本若没有内置源（或被改名/删除），合并时补回内置源，保证默认同源工坊始终可用
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<WorkshopState>;
        const sources = Array.isArray(p.sources) ? p.sources.slice() : [];
        if (!sources.some((s) => s.id === DEFAULT_SOURCE.id)) sources.unshift(DEFAULT_SOURCE);
        return {
          ...current,
          ...p,
          sources,
          activeSourceId: p.activeSourceId && sources.some((s) => s.id === p.activeSourceId) ? p.activeSourceId : DEFAULT_SOURCE.id,
          installs: p.installs ?? {},
        };
      },
    }
  )
);
