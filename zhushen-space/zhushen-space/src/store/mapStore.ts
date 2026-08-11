import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { sameWorld } from '../systems/worldScope';
import { mapImageKey, mapImgDel } from '../systems/mapImages';
import {
  emptyWorldMap, ingestTurn, touchMentions, applyDiscover, applySetNode, applyLink, applyVisit,
  mapWorldKey, type WorldMapData, type MapNode, type DiscoverResult, type IngestEvent,
} from '../systems/mapEngine';

/* ══════════ 小地图（drpg-map）══════════
   世界分桶的分层节点图：byWorld[世界名] = { nodes, edges, trail, … }。
   按世界名分桶 = 天然的世界作用域：切世界自动「冻结」（数据留在原桶），重返世界原图恢复，
   无需像任务那样走 freeze/thaw 迁移（见 miscStore.freezeTasksOfWorld 的对照）。

   写入方只有三个，全部走确定性引擎（systems/mapEngine）的护栏：
     ① 每回合建图 ingest（callApi 开头的 reconcile 步；零 API）
     ② 地图演化阶段的 AI 指令（mapParser → aiDiscover/aiSet/aiLink）
     ③ 玩家面板操作（图钉/标注/移动/删除）
   ⚠ 本 store 不登记 tableMigrate.MIRROR_TABLES（镜像表每回合被 store 投影整表覆盖，
     会吃掉 AI 写入——地图的单一写入方是本 store，AI 只能经指令进店）。 */

export interface MapSettings {
  enabled: boolean;         // 总开关：关=不建图/不注入/不跑演化（面板保留入口显示说明）
  aiWrite: boolean;         // AI 写图（地图演化阶段；频率走 综合设置→演化调度 的 map 行）
  injectNarrative: boolean; // <当前地图> 注入正文
  injectOutline: boolean;   // <当前地图> 注入细纲（规划层）
  maxNewPerTurn: number;    // 每轮演化允许新增节点数上限（防 AI 一口气铺满全城）
  archiveAfter: number;     // 传闻 N 回合未被提及自动归档（图钉豁免）
}

const DEFAULT_SETTINGS: MapSettings = {
  enabled: true, aiWrite: true, injectNarrative: true, injectOutline: true,
  maxNewPerTurn: 5, archiveAfter: 30,
};

interface MapState {
  byWorld: Record<string, WorldMapData>;
  settings: MapSettings;
  setSettings: (patch: Partial<MapSettings>) => void;
  /** 只读取图（无则返回空图，不写入）。key 见 mapWorldKey：空世界名归「轮回乐园」。 */
  dataOf: (worldName: string) => WorldMapData;
  /** 每回合确定性建图（幂等）。events 传 miscStore.worldEvents 原样，内部按世界过滤未结算者。 */
  ingest: (worldName: string, inp: { location: string; turn: number; events?: { location: string; scope?: string; settledAt?: number; worldName?: string }[] }) => { newNames: string[] };
  /** 正文提及触达（地图演化阶段的确定性预步，防误归档） */
  touch: (worldName: string, narrative: string, turn: number) => void;
  // ── AI 指令通道（mapParser 专用）──
  aiDiscover: (worldName: string, rawName: string, p: Record<string, unknown>, turn: number, opts: { fallbackRegionName?: string; allowCreate: boolean }) => DiscoverResult;
  aiSet: (worldName: string, rawName: string, p: Record<string, unknown>, turn: number) => boolean;
  aiLink: (worldName: string, aName: string, bName: string, p: Record<string, unknown>) => boolean;
  // ── 玩家操作 ──
  markVisited: (worldName: string, id: string, turn: number) => void;
  setPin: (worldName: string, id: string, pinned: boolean) => void;
  /** 地点图元数据（大图走 systems/mapImages 缓存+imageDb，这里只记 hasImage/提示词） */
  setNodeImage: (worldName: string, id: string, patch: { hasImage?: boolean; imagePrompt?: string }) => void;
  setPlayerNote: (worldName: string, id: string, note: string) => void;
  restoreNode: (worldName: string, id: string) => void;  // 从归档捞回（并续命 lastSeenTurn 防止立刻再归档）
  removeNode: (worldName: string, id: string) => void;   // 手动删（区域级联删除其场所）
  clearWorld: (worldName: string) => void;
  clearAll: () => void;
}

export const useMap = create<MapState>()(
  persist(
    (set, get): MapState => {
      /** 对某世界的图应用一次纯函数变换；未变更则不写（省 persist 抖动） */
      const withWorld = <T>(worldName: string, fn: (prev: WorldMapData) => { data: WorldMapData; out: T; changed: boolean }): T => {
        const key = mapWorldKey(worldName);
        const prev = get().byWorld[key] ?? emptyWorldMap();
        const { data, out, changed } = fn(prev);
        if (changed) set((s) => ({ byWorld: { ...s.byWorld, [key]: data } }));
        return out;
      };
      return {
        byWorld: {},
        settings: { ...DEFAULT_SETTINGS },
        setSettings: (patch) => set((s) => ({ settings: { ...(s.settings ?? DEFAULT_SETTINGS), ...patch } })),

        dataOf: (worldName) => get().byWorld[mapWorldKey(worldName)] ?? emptyWorldMap(),

        ingest: (worldName, inp) => {
          if (!get().settings.enabled) return { newNames: [] };
          const wn = mapWorldKey(worldName);
          const events: IngestEvent[] = (inp.events ?? [])
            .filter((e) => !e.settledAt && !!e.location && (!e.worldName || sameWorld(e.worldName, wn)))
            .map((e) => ({ location: e.location, scope: e.scope }));
          return withWorld(worldName, (prev) => {
            const r = ingestTurn(prev, { worldName: wn, location: inp.location, turn: inp.turn, events, archiveAfter: get().settings.archiveAfter });
            return { data: r.data, out: { newNames: r.newNames }, changed: r.changed };
          });
        },

        touch: (worldName, narrative, turn) => {
          withWorld(worldName, (prev) => {
            const r = touchMentions(prev, narrative, turn);
            return { data: r.data, out: null, changed: r.changed };
          });
        },

        aiDiscover: (worldName, rawName, p, turn, opts) =>
          withWorld(worldName, (prev) => {
            const r = applyDiscover(prev, rawName, p, turn, opts);
            return { data: r.data, out: r.result, changed: r.data !== prev };
          }),

        aiSet: (worldName, rawName, p, turn) =>
          withWorld(worldName, (prev) => {
            const r = applySetNode(prev, rawName, p, turn);
            return { data: r.data, out: r.ok, changed: r.data !== prev };
          }),

        aiLink: (worldName, aName, bName, p) =>
          withWorld(worldName, (prev) => {
            const r = applyLink(prev, aName, bName, p);
            return { data: r.data, out: r.ok, changed: r.data !== prev };
          }),

        markVisited: (worldName, id, turn) => {
          withWorld(worldName, (prev) => {
            const r = applyVisit(prev, id, turn);
            return { data: r.data, out: null, changed: r.data !== prev };
          });
        },

        setNodeImage: (worldName, id, patch) => {
          withWorld(worldName, (prev) => {
            const n = prev.nodes[id];
            if (!n) return { data: prev, out: null, changed: false };
            const next = {
              ...n,
              ...(patch.hasImage !== undefined ? { hasImage: patch.hasImage || undefined } : {}),
              ...(patch.imagePrompt !== undefined ? { imagePrompt: patch.imagePrompt.trim().slice(0, 600) || undefined } : {}),
            };
            return { data: { ...prev, nodes: { ...prev.nodes, [id]: next } }, out: null, changed: true };
          });
        },

        setPin: (worldName, id, pinned) => {
          withWorld(worldName, (prev) => {
            const n = prev.nodes[id];
            if (!n || !!n.pinned === pinned) return { data: prev, out: null, changed: false };
            return { data: { ...prev, nodes: { ...prev.nodes, [id]: { ...n, pinned } } }, out: null, changed: true };
          });
        },

        setPlayerNote: (worldName, id, note) => {
          withWorld(worldName, (prev) => {
            const n = prev.nodes[id];
            const t = note.trim().slice(0, 120);
            if (!n || (n.playerNote ?? '') === t) return { data: prev, out: null, changed: false };
            return { data: { ...prev, nodes: { ...prev.nodes, [id]: { ...n, playerNote: t || undefined } } }, out: null, changed: true };
          });
        },

        restoreNode: (worldName, id) => {
          withWorld(worldName, (prev) => {
            const n = prev.nodes[id];
            if (!n || !n.archived) return { data: prev, out: null, changed: false };
            const maxSeen = Math.max(0, ...Object.values(prev.nodes).map((x) => x.lastSeenTurn));
            return { data: { ...prev, nodes: { ...prev.nodes, [id]: { ...n, archived: false, lastSeenTurn: maxSeen } } }, out: null, changed: true };
          });
        },

        removeNode: (worldName, id) => {
          const wk = mapWorldKey(worldName);
          withWorld(worldName, (prev) => {
            const n = prev.nodes[id];
            if (!n) return { data: prev, out: null, changed: false };
            const dropIds = new Set<string>([id]);
            if (n.kind === 'region') for (const x of Object.values(prev.nodes)) if (x.parentId === id) dropIds.add(x.id);
            for (const did of dropIds) if (prev.nodes[did]?.hasImage) mapImgDel(mapImageKey(wk, did));   // 地点图随节点删
            const nodes: Record<string, MapNode> = {};
            for (const x of Object.values(prev.nodes)) if (!dropIds.has(x.id)) nodes[x.id] = x;
            return {
              data: {
                ...prev, nodes,
                edges: prev.edges.filter((e) => !dropIds.has(e.a) && !dropIds.has(e.b)),
                trail: prev.trail.filter((t) => !dropIds.has(t)),
              },
              out: null, changed: true,
            };
          });
        },

        clearWorld: (worldName) => set((s) => {
          const key = mapWorldKey(worldName);
          if (!s.byWorld[key]) return s;
          for (const n of Object.values(s.byWorld[key].nodes)) if (n.hasImage) mapImgDel(mapImageKey(key, n.id));   // 地点图随世界清
          const byWorld = { ...s.byWorld };
          delete byWorld[key];
          return { byWorld };
        }),

        clearAll: () => set((s) => {
          for (const [wk, wm] of Object.entries(s.byWorld)) {
            for (const n of Object.values(wm.nodes)) if (n.hasImage) mapImgDel(mapImageKey(wk, n.id));   // 新游戏：地点图一并清
          }
          return { byWorld: {} };
        }),
      };
    },
    {
      name: 'drpg-map',
      version: 1,
      // 老档缺 settings 子字段时从默认补齐（照 settingsStore.merge 的浅合并口径）
      merge: (persisted: unknown, current: MapState): MapState => {
        const p = (persisted && typeof persisted === 'object' ? persisted : {}) as Partial<MapState>;
        return {
          ...current,
          ...p,
          settings: { ...DEFAULT_SETTINGS, ...(p.settings && typeof p.settings === 'object' ? p.settings : {}) },
          byWorld: p.byWorld && typeof p.byWorld === 'object' ? p.byWorld : {},
        };
      },
    },
  ),
);
