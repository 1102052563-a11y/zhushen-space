import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ════════════════════════════════════════════
   🗺 已探索地点树（借鉴 色色灵感状态栏V3.2 的地图库·MVP：足迹树+探索纪要，不做地图绘制）
   - 观察式记录：App 回合兜底簇对比 profile.location 变化 → recordVisit（一个观察点覆盖 AI 指令/手动编辑等一切写入路径）；
   - 路径按 - — · / > → 切段成树（「新宿区-御苑」→ 新宿区/御苑 两级）；祖先节点自动补建；
   - 🌍 world 作用域：节点带 worldName，读取点按当前世界过滤（消费点只有 注入+面板 两处，过滤式足够）；
   - 注入：紧凑树（只出名字·≥2 节点才出·上限 24）并进 <当前时空>，让 AI 记得世界里有哪些去过的地方、引用时拼全链；
   - 纪要：每节点一句探索备注（玩家在 MiscPanel「地点」tab 编辑；有纪要的节点不被容量剪除）。
   进度类 store：已注册 saveManager STORES 带 clear。
════════════════════════════════════════════ */

export interface LocationNode {
  world: string;      // 世界名（''=乐园/未知）
  path: string;       // 规范全路径（段以 - 连接，如「新宿区-御苑」）
  name: string;       // 尾段名
  note: string;       // 探索纪要（一句话·玩家编辑）
  visits: number;     // 到访次数（祖先补建节点从 0 计）
  lastTurn: number;
  firstAt: number;
}

interface LocationState {
  nodes: LocationNode[];
  lastSeen: string;   // 上次记录的原始位置串（防连续同地重复计数）
  recordVisit: (rawLoc: string, world: string, turn: number) => void;
  setNote: (world: string, path: string, note: string) => void;
  removeNode: (world: string, path: string) => void;   // 连同子孙一起删
  clearAll: () => void;
}

const CAP_PER_WORLD = 120;   // 每世界节点上限：超出剪 lastTurn 最旧的无纪要叶节点

/** 位置串 → 规范路径段（空段滤除；每段截 24 字防怪串） */
export function splitLocPath(raw: string): string[] {
  return String(raw ?? '')
    .split(/[-—·/>→]/)
    .map((s) => s.trim().slice(0, 24))
    .filter(Boolean)
    .slice(0, 5);   // 树最深 5 级，再深没有导航价值
}

/** 当前世界的紧凑树行（注入用·名字缩进表层级·上限 cap；<2 节点=太少不值得注入，返回 []） */
export function locationTreeLines(nodes: LocationNode[], world: string, cap = 24): string[] {
  const mine = nodes.filter((n) => n.world === (world || ''));
  if (mine.length < 2) return [];
  const sorted = [...mine].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));   // 字典序=父在子前
  return sorted.slice(0, cap).map((n) => {
    const depth = splitLocPath(n.path).length - 1;
    return `${'　'.repeat(Math.max(0, depth))}${n.name}${n.note ? `（${n.note.slice(0, 20)}）` : ''}`;
  });
}

export const useLocations = create<LocationState>()(
  persist(
    (set, get): LocationState => ({
      nodes: [],
      lastSeen: '',
      recordVisit: (rawLoc, world, turn) => {
        const raw = String(rawLoc ?? '').trim();
        if (!raw || raw === get().lastSeen) return;
        const segs = splitLocPath(raw);
        if (!segs.length) { set({ lastSeen: raw }); return; }
        const w = String(world ?? '').trim();
        set((s) => {
          const nodes = [...s.nodes];
          const now = Date.now();
          // 祖先链逐级补建；叶节点 visits++
          for (let i = 0; i < segs.length; i++) {
            const path = segs.slice(0, i + 1).join('-');
            const isLeaf = i === segs.length - 1;
            const idx = nodes.findIndex((n) => n.world === w && n.path === path);
            if (idx >= 0) {
              nodes[idx] = { ...nodes[idx], visits: nodes[idx].visits + (isLeaf ? 1 : 0), lastTurn: turn };
            } else {
              nodes.push({ world: w, path, name: segs[i], note: '', visits: isLeaf ? 1 : 0, lastTurn: turn, firstAt: now });
            }
          }
          // 容量剪除：本世界超限 → 剪 lastTurn 最旧、无纪要、无子孙的叶节点
          const mine = nodes.filter((n) => n.world === w);
          if (mine.length > CAP_PER_WORLD) {
            const hasChild = (p: string) => nodes.some((n) => n.world === w && n.path !== p && n.path.startsWith(p + '-'));
            const prunable = mine
              .filter((n) => !n.note && !hasChild(n.path))
              .sort((a, b) => a.lastTurn - b.lastTurn)
              .slice(0, mine.length - CAP_PER_WORLD);
            const drop = new Set(prunable.map((n) => `${n.world}|${n.path}`));
            if (drop.size) return { nodes: nodes.filter((n) => !drop.has(`${n.world}|${n.path}`)), lastSeen: raw };
          }
          return { nodes, lastSeen: raw };
        });
      },
      setNote: (world, path, note) => set((s) => ({
        nodes: s.nodes.map((n) => (n.world === world && n.path === path ? { ...n, note: String(note ?? '').slice(0, 60) } : n)),
      })),
      removeNode: (world, path) => set((s) => ({
        nodes: s.nodes.filter((n) => !(n.world === world && (n.path === path || n.path.startsWith(path + '-')))),
      })),
      clearAll: () => set({ nodes: [], lastSeen: '' }),
    }),
    { name: 'drpg-locations' },
  ),
);
