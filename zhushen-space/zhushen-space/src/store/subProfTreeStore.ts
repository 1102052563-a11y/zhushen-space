import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useCharacters } from './characterStore';
import { usePlayer } from './playerStore';
import { useItems } from './itemStore';
import type { TreeDef, TreeNode, TreeBranch, NodeGrants } from './skillTreeStore';
import {
  canRankUp, nodeRank, validateTree, autoLayout, defaultCost,
  DEFAULT_BRANCH_COLORS, SKILLTREE_TUNING, coinPerPP, nodeCostFor, isBigNode,
} from '../systems/skillTree';
import { registerTreePool } from '../systems/treePool';

/* ════════════════════════════════════════════════════════════════════════════
   副职业树 store（drpg-subproftree）——「职业技能树」的孪生：同一套径向星图引擎，
   区别在于节点解锁的是【配方】(炼金图纸/锻造图…)而非技能/天赋：
     · 配方节点(medium/major/capstone)：rank1 学会配方(进副职业面板的配方清单·不进技能/天赋栏)；
       rank2/3 钻研精进 → 提升该配方熟练度。
     · 微星(minor)：磨练基本功 → 提升【副职业总熟练度】(不给六维属性·全程无属性加成)。
   潜能点与技能树【共用一池】(treePool 登记)。可同时拥有多棵副职业树（炼金 + 锻造…），切换 activeTreeId 查看，
   ranks/spent 跨树累计。模板(trees)=配置可分享；progress=每角色进度(随存档重置)。
   ──────────────────────────────────────────────────────────────────────────── */

export interface SubProfTreeProgress {
  activeTreeId?: string;
  ranks: Record<string, number>;   // 节点 id → 当前点数(0..maxRank)
  aiBonusPP: number;               // 兑换/任务额外潜能点（计入共享池）
  exchangedPP?: number;            // 累计【乐园币兑换】出的潜能点（越买越贵的递增基数）
  spent: number;                   // 已花潜能点（= Σ rank×cost，计入共享池）
  evoSeenTier?: Record<string, number>;   // 副职业名 → 演化阶段上次见到的熟练度档序（升档→质变全部配方）
}

const newProgress = (): SubProfTreeProgress => ({ ranks: {}, aiBonusPP: 0, exchangedPP: 0, spent: 0 });

/* 解锁配方时给的初始熟练度（学了图纸但还没多练）；越高阶起步越低 */
const LEARN_PROGRESS: Record<string, number> = { medium: 30, major: 15, capstone: 6 };

/* ── 副职业熟练度 = 在该副职业配方树上累计耗费的潜能点（总盘约 400），按阶梯升档：达阈值才升一档。
   每次升档 → 对该副职业名下所有配方做一次「质变」（演化阶段触发，~4 次/整盘，省 token）。 ── */
export const SUBPROF_MASTERY_LADDER: { tier: string; min: number }[] = [
  { tier: '新手', min: 0 }, { tier: '熟练', min: 50 }, { tier: '专家', min: 130 }, { tier: '大师', min: 250 }, { tier: '宗师', min: 400 },
];
const GROWTH_MUL = [1.0, 1.4, 1.9, 2.5, 3.2];   // 副职业熟练度越高，配方熟练度涨得越快（喂给演化阶段的 bumpRecipe 乘子）

/** 某副职业在其配方树上累计耗费的潜能点（= 副职业熟练度原始值；跨同名多棵树求和） */
export function subProfTreeSpent(profName: string, charId = 'B1'): number {
  const s = useSubProfTree.getState();
  const prog = s.progress[charId]; if (!prog) return 0;
  let sum = 0;
  for (const tree of Object.values(s.trees)) {
    if (tree.profession !== profName) continue;
    for (const n of tree.nodes) { const r = prog.ranks[n.id] ?? 0; if (r > 0) sum += r * (n.cost ?? 0); }
  }
  return sum;
}
/** 副职业熟练度档位信息：原始点数 spent、档序 idx、档名 tier、下一档阈值、配方成长倍率、本档进度% */
export function subProfMastery(profName: string, charId = 'B1'): { spent: number; idx: number; tier: string; nextMin?: number; growthMul: number; pct: number } {
  const spent = subProfTreeSpent(profName, charId);
  let idx = 0;
  for (let i = SUBPROF_MASTERY_LADDER.length - 1; i >= 0; i--) { if (spent >= SUBPROF_MASTERY_LADDER[i].min) { idx = i; break; } }
  const cur = SUBPROF_MASTERY_LADDER[idx], next = SUBPROF_MASTERY_LADDER[idx + 1];
  return { spent, idx, tier: cur.tier, nextMin: next?.min, growthMul: GROWTH_MUL[idx] ?? 1, pct: next ? Math.min(100, Math.round((spent - cur.min) / (next.min - cur.min) * 100)) : 100 };
}

/* ── 配方星图组装器：core 放射 N 条流派臂；每臂 起步微星 → 配方(medium) → 径(minor) → 配方(major) → … → 终极配方(capstone)。
   微星=基本功(无 grant·点了加总熟练度)；配方节点 grants.recipe（图纸信息完整）。无属性/无星核/无星座。 */
interface RecipeNotable { name: string; kind: 'medium' | 'major' | 'capstone'; tier: string; recipe: NodeGrants['recipe'] }
interface RecipeBranch { id: string; name: string; color: string; notables: RecipeNotable[] }
function assembleRecipeStar(opts: {
  id: string; profession: string; title: string; version: number; recipeLabel: string; category: string;
  coreName: string; coreDesc?: string;
  branches: RecipeBranch[];
}): any {
  const { branches } = opts;
  const nodes: any[] = [
    { id: 'core', name: opts.coreName, branch: branches[0].id, layer: 0, kind: 'minor', cost: 0, maxRank: 1, prereqs: [], grants: {}, desc: opts.coreDesc },
  ];
  let c = 0; const nid = () => `r${++c}`;
  for (const b of branches) {
    const s1 = nid();
    nodes.push({ id: s1, name: `${b.name}·入门`, branch: b.id, layer: 1, kind: 'minor', cost: 1, prereqs: ['core'], desc: `踏入「${b.name}」一脉，磨练基本功（提升副职业总熟练度）。` });
    let prev = s1, layer = 2;
    b.notables.forEach((nb, i) => {
      if (i > 0) {   // 配方之间插一颗「基本功」微星，拉长路径
        const mid = nid();
        nodes.push({ id: mid, name: `${b.name}·研习`, branch: b.id, layer, kind: 'minor', cost: 2, prereqs: [prev], desc: '反复研习，磨练手艺（提升副职业总熟练度）。' });
        prev = mid; layer++;
      }
      const id = nid();
      nodes.push({
        id, name: nb.name, branch: b.id, layer, kind: nb.kind,
        cost: nb.kind === 'capstone' ? 12 : nb.kind === 'major' ? 6 : 4, tierGate: nb.tier, prereqs: [prev],
        grants: { recipe: nb.recipe }, ...(nb.kind === 'capstone' ? { spentGate: 14 } : {}),
      });
      prev = id; layer++;
    });
  }
  return {
    id: opts.id, profession: opts.profession, title: opts.title, source: 'builtin', version: opts.version,
    recipeLabel: opts.recipeLabel, category: opts.category,
    branches: branches.map((b) => ({ id: b.id, name: b.name, color: b.color })), nodes,
  };
}

/* ── 内置副职业树①：炼金术·图纸星图（药剂 / 转化 / 禁忌三脉）── */
function buildAlchemyTree() {
  const COL = DEFAULT_BRANCH_COLORS;
  return assembleRecipeStar({
    id: 'subtree_alchemy_v1', profession: '炼金术', title: '炼金术·图纸星图', version: 1,
    recipeLabel: '图纸', category: '制造',
    coreName: '炼金入门', coreDesc: '掌握炼金台与基础试剂操作，群图之始——免费起手。',
    branches: [
      { id: 'potion', name: '药剂', color: COL[0], notables: [
        { name: '初级治疗药剂', kind: 'medium', tier: '一阶', recipe: { name: '初级治疗药剂', tier: '熟练', materials: '红草 ×2、净水 ×1、空瓶 ×1', output: '初级治疗药剂：饮用后立即回复少量生命，战斗内外通用', desc: '炼金师的入门款，回血消耗品，需求量极大。' } },
        { name: '法力回复药剂', kind: 'medium', tier: '二阶', recipe: { name: '法力回复药剂', tier: '熟练', materials: '蓝晶草 ×2、灵泉水 ×1、空瓶 ×1', output: '法力回复药剂：回复一定法力/精力，施法者必备', desc: '蓝瓶，续航核心。' } },
        { name: '巨力药剂', kind: 'major', tier: '三阶', recipe: { name: '巨力药剂', tier: '专家', materials: '蛮牛角粉 ×1、烈焰花 ×2、强化基液 ×1', output: '巨力药剂：限时大幅提升力量与近战伤害，有短暂后坐乏力', desc: '战前强化爆发药，战斗流派常备。' } },
        { name: '不朽生命药剂', kind: 'capstone', tier: '五阶', recipe: { name: '不朽生命药剂', tier: '大师', materials: '九叶回春草 ×1、凤凰之泪 ×1、贤者基液 ×1、龙血结晶 ×1', output: '不朽生命药剂：短时间内受到致命伤不死，并持续高额回血；珍稀保命底牌', desc: '炼金药剂一脉的巅峰之作，活命神药。' } },
      ] },
      { id: 'transmute', name: '转化', color: COL[2], notables: [
        { name: '点金图谱', kind: 'medium', tier: '二阶', recipe: { name: '点金图谱', tier: '熟练', materials: '贱金属锭 ×3、点金触媒 ×1', output: '把贱金属转化为少量黄金/乐园币等价物，收益随熟练度提升', desc: '炼金生财之道，转化系入门。' } },
        { name: '元素转化阵', kind: 'major', tier: '四阶', recipe: { name: '元素转化阵', tier: '专家', materials: '元素结晶 ×2、转化符文 ×1、稳定剂 ×1', output: '将一种元素材料转化为另一种等阶元素材料，破解配方材料瓶颈', desc: '高阶炼金的材料调度术。' } },
        { name: '贤者之石', kind: 'capstone', tier: '六阶', recipe: { name: '贤者之石', tier: '宗师', materials: '完全元素 ×4、本源精粹 ×1、贤者基液 ×3、时之沙 ×1', output: '贤者之石：万能催化剂，大幅提升一切炼金产物品质，可短时点石成金、续命', desc: '炼金术的终极幻想，转化一脉的封顶图谱。' } },
      ] },
      { id: 'forbidden', name: '禁忌', color: COL[3], notables: [
        { name: '腐蚀毒剂', kind: 'medium', tier: '三阶', recipe: { name: '腐蚀毒剂', tier: '专家', materials: '毒囊 ×2、强酸基液 ×1', output: '涂抹武器或投掷，使目标持续掉血并降低防御', desc: '禁忌炼金的下毒手艺。' } },
        { name: '魔像血清', kind: 'major', tier: '五阶', recipe: { name: '魔像血清', tier: '大师', materials: '魔核 ×1、活性血肉 ×3、禁忌触媒 ×1', output: '注入无生命躯体使其成为听命魔像，限时作战', desc: '游走道德边缘的造物术。' } },
        { name: '不死之触', kind: 'capstone', tier: '七阶', recipe: { name: '不死之触', tier: '宗师', materials: '亡者精魄 ×3、深渊基液 ×1、禁忌符文 ×2', output: '不死之触：将素材炼成不死仆从的核心药剂，亵渎而强大', desc: '禁忌炼金的终极禁术，慎用。' } },
      ] },
    ],
  });
}

/* ── 内置副职业树②：锻造·锻造图星图（武器 / 防具两脉）── */
function buildForgeTree() {
  const COL = DEFAULT_BRANCH_COLORS;
  return assembleRecipeStar({
    id: 'subtree_forge_v1', profession: '锻造', title: '锻造·锻造图星图', version: 1,
    recipeLabel: '锻造图', category: '制造',
    coreName: '锻造入门', coreDesc: '熟悉熔炉、铁砧与淬火，掌握基础锻打——免费起手。',
    branches: [
      { id: 'weapon', name: '兵器', color: COL[1], notables: [
        { name: '精铁长剑', kind: 'medium', tier: '一阶', recipe: { name: '精铁长剑', tier: '熟练', materials: '精铁锭 ×3、硬木 ×1', output: '精铁长剑：一把均衡的近战武器，攻击力随熟练度小幅提升', desc: '锻造师的第一把像样兵器。' } },
        { name: '寒锋利刃', kind: 'major', tier: '三阶', recipe: { name: '寒锋利刃', tier: '专家', materials: '玄铁锭 ×2、寒铁芯 ×1、淬冰液 ×1', output: '寒锋利刃：附带冰属性的利器，命中有几率减速', desc: '附魔兵器的代表作。' } },
        { name: '屠龙巨刃', kind: 'capstone', tier: '六阶', recipe: { name: '屠龙巨刃', tier: '宗师', materials: '陨铁锭 ×4、龙骨 ×1、星辉结晶 ×2、宗师锻油 ×1', output: '屠龙巨刃：对巨型/龙类目标造成额外重创的传说兵器', desc: '兵器锻造一脉的封顶之作。' } },
      ] },
      { id: 'armor', name: '甲胄', color: COL[4], notables: [
        { name: '铁甲胸铠', kind: 'medium', tier: '二阶', recipe: { name: '铁甲胸铠', tier: '熟练', materials: '精铁锭 ×4、皮革 ×2', output: '铁甲胸铠：提供稳定物理防御的基础护甲', desc: '护甲锻造的开端。' } },
        { name: '玄铁重铠', kind: 'major', tier: '四阶', recipe: { name: '玄铁重铠', tier: '专家', materials: '玄铁锭 ×4、龙筋 ×1、强化符 ×1', output: '玄铁重铠：高物理与元素双抗的重型护甲，略降敏捷', desc: '坦克流派的中坚装备。' } },
        { name: '不灭战甲', kind: 'capstone', tier: '七阶', recipe: { name: '不灭战甲', tier: '宗师', materials: '陨铁锭 ×4、不灭核心 ×1、星辉结晶 ×3、宗师锻油 ×2', output: '不灭战甲：受到致命一击时免疫并反弹部分伤害的传说护甲', desc: '甲胄锻造的终极幻想。' } },
      ] },
    ],
  });
}

const BUILTIN_ALCHEMY: TreeDef = autoLayout(validateTree(buildAlchemyTree()).tree);
const BUILTIN_FORGE: TreeDef = autoLayout(validateTree(buildForgeTree()).tree);
const BUILTIN_TREES: TreeDef[] = [BUILTIN_ALCHEMY, BUILTIN_FORGE];

/* dst 是否能经前置链到达 target（拒绝制造环的连线）*/
function reaches(nodes: TreeNode[], from: string, target: string): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const p of byId.get(cur)?.prereqs ?? []) stack.push(p);
  }
  return false;
}

interface SubProfTreeState {
  trees: Record<string, TreeDef>;
  progress: Record<string, SubProfTreeProgress>;

  // 模板
  upsertTree: (tree: TreeDef) => void;
  removeTree: (id: string) => void;
  setActiveTree: (charId: string, treeId: string) => void;

  // 编辑器
  addNode: (treeId: string, node: Partial<TreeNode> & { x: number; y: number }) => string | undefined;
  updateNode: (treeId: string, nodeId: string, patch: Partial<TreeNode>) => void;
  moveNode: (treeId: string, nodeId: string, x: number, y: number) => void;
  removeNode: (treeId: string, nodeId: string) => void;
  addEdge: (treeId: string, srcId: string, dstId: string) => boolean;
  removeEdge: (treeId: string, srcId: string, dstId: string) => void;
  addBranch: (treeId: string, name: string) => void;
  updateBranch: (treeId: string, branchId: string, patch: Partial<TreeBranch>) => void;
  removeBranch: (treeId: string, branchId: string) => void;
  updateTreeMeta: (treeId: string, patch: Partial<Pick<TreeDef, 'profession' | 'title' | 'recipeLabel' | 'category'>>) => void;
  relayout: (treeId: string) => void;

  // 进度
  grantBonusPP: (charId: string, n: number) => void;
  rankUpNode: (charId: string, nodeId: string) => boolean;   // 点一个点：配方节点 rank0→1 学会配方；其余（微星/配方加点）纯花潜能点（→副职业熟练度）。无 API
  applyRecipeUpgrade: (charId: string, nodeId: string, upgraded: { tier?: string; materials?: string; output?: string; desc?: string; progress?: number }) => boolean;  // 配方节点 rank≥1 再投点：用 AI 质变后的配方覆盖（同名 upsert·不重置熟练度）+ 加一点
  setEvoSeenTier: (charId: string, profName: string, idx: number) => void;   // 演化阶段记录某副职业已质变到的熟练度档（防重复触发全质变）
  exchangePP: (charId: string, count: number) => number;     // 乐园币兑换潜能点（计入共享池）；返回实际兑换数
}

export const useSubProfTree = create<SubProfTreeState>()(
  persist(
    (set, get): SubProfTreeState => ({
      trees: Object.fromEntries(BUILTIN_TREES.map((t) => [t.id, t])),
      progress: {},

      upsertTree: (tree) => set((s) => ({ trees: { ...s.trees, [tree.id]: tree } })),
      removeTree: (id) => set((s) => {
        const trees = { ...s.trees }; delete trees[id];
        const progress = { ...s.progress };
        for (const [cid, p] of Object.entries(progress)) if (p.activeTreeId === id) progress[cid] = { ...p, activeTreeId: undefined };
        return { trees, progress };
      }),
      setActiveTree: (charId, treeId) => set((s) => {
        const p = s.progress[charId] ?? newProgress();
        return { progress: { ...s.progress, [charId]: { ...p, activeTreeId: treeId } } };
      }),

      addNode: (treeId, node) => {
        const id = `N_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
        let added = false;
        set((s) => {
          const t = s.trees[treeId]; if (!t) return s;
          const kind = node.kind ?? 'minor';
          const nn: TreeNode = {
            id, name: node.name ?? '新节点', branch: node.branch ?? (t.branches[0]?.id ?? ''),
            layer: node.layer ?? 1, tierGate: node.tierGate ?? '', cost: node.cost ?? defaultCost(kind),
            prereqs: node.prereqs ?? [], kind, grants: node.grants ?? {}, desc: node.desc, x: node.x, y: node.y,
          };
          added = true;
          return { trees: { ...s.trees, [treeId]: { ...t, nodes: [...t.nodes, nn] } } };
        });
        return added ? id : undefined;
      },
      updateNode: (treeId, nodeId, patch) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        const nodes = t.nodes.map((n) => n.id === nodeId ? { ...n, ...patch, id: n.id } : n);
        return { trees: { ...s.trees, [treeId]: { ...t, nodes } } };
      }),
      moveNode: (treeId, nodeId, x, y) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        const nodes = t.nodes.map((n) => n.id === nodeId ? { ...n, x, y } : n);
        return { trees: { ...s.trees, [treeId]: { ...t, nodes } } };
      }),
      removeNode: (treeId, nodeId) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        const nodes = t.nodes.filter((n) => n.id !== nodeId)
          .map((n) => n.prereqs.includes(nodeId) ? { ...n, prereqs: n.prereqs.filter((p) => p !== nodeId) } : n);
        return { trees: { ...s.trees, [treeId]: { ...t, nodes } } };
      }),
      addEdge: (treeId, srcId, dstId) => {
        let ok = false;
        set((s) => {
          const t = s.trees[treeId]; if (!t || srcId === dstId) return s;
          const dst = t.nodes.find((n) => n.id === dstId); if (!dst) return s;
          if (dst.prereqs.includes(srcId)) return s;
          if (reaches(t.nodes, srcId, dstId)) return s;
          const nodes = t.nodes.map((n) => n.id === dstId ? { ...n, prereqs: [...n.prereqs, srcId] } : n);
          ok = true;
          return { trees: { ...s.trees, [treeId]: { ...t, nodes } } };
        });
        return ok;
      },
      removeEdge: (treeId, srcId, dstId) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        const nodes = t.nodes.map((n) => n.id === dstId ? { ...n, prereqs: n.prereqs.filter((p) => p !== srcId) } : n);
        return { trees: { ...s.trees, [treeId]: { ...t, nodes } } };
      }),
      addBranch: (treeId, name) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        const id = `br_${Date.now().toString(36)}`;
        const color = DEFAULT_BRANCH_COLORS[t.branches.length % DEFAULT_BRANCH_COLORS.length];
        return { trees: { ...s.trees, [treeId]: { ...t, branches: [...t.branches, { id, name: name || `流派${t.branches.length + 1}`, color }] } } };
      }),
      updateBranch: (treeId, branchId, patch) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        const branches = t.branches.map((b) => b.id === branchId ? { ...b, ...patch, id: b.id } : b);
        return { trees: { ...s.trees, [treeId]: { ...t, branches } } };
      }),
      removeBranch: (treeId, branchId) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        const branches = t.branches.filter((b) => b.id !== branchId);
        const fallback = branches[0]?.id ?? '';
        const nodes = t.nodes.map((n) => n.branch === branchId ? { ...n, branch: fallback } : n);
        return { trees: { ...s.trees, [treeId]: { ...t, branches, nodes } } };
      }),
      updateTreeMeta: (treeId, patch) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        return { trees: { ...s.trees, [treeId]: { ...t, ...patch } } };
      }),
      relayout: (treeId) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        const cleared = { ...t, nodes: t.nodes.map((n) => ({ ...n, x: undefined, y: undefined })) };
        return { trees: { ...s.trees, [treeId]: autoLayout(cleared) } };
      }),

      grantBonusPP: (charId, n) => set((s) => {
        const p = s.progress[charId] ?? newProgress();
        return { progress: { ...s.progress, [charId]: { ...p, aiBonusPP: Math.max(0, (p.aiBonusPP ?? 0) + n) } } };
      }),

      rankUpNode: (charId, nodeId) => {
        const s = get();
        const prog = s.progress[charId] ?? newProgress();
        const tree = prog.activeTreeId ? s.trees[prog.activeTreeId] : undefined;
        if (!tree) return false;
        const profile = usePlayer.getState().profile;
        const ctx = { level: profile.level, tier: profile.tier, charId, ignoreTierGate: true };   // charId→共享池；ignoreTierGate→副职业树取消阶位限制
        if (!canRankUp(tree, nodeId, prog, ctx).ok) return false;
        const node = tree.nodes.find((n) => n.id === nodeId)!;
        const wasRank = nodeRank(prog, nodeId);
        const paid = nodeCostFor(node, ctx);
        const chars = useCharacters.getState();

        // 确保该副职业本体存在（带分类/配方叫法/说明），让配方有处可挂、面板能正确显示
        chars.addSubProfession('B1', { name: tree.profession, tier: '新手', category: tree.category, recipeLabel: tree.recipeLabel, desc: tree.title });

        const rec = node.grants?.recipe;
        // 配方节点 rank≥1 的「再投点=质变」走 applyRecipeUpgrade（要调 AI），rankUpNode 不处理，交回面板
        if (rec?.name && wasRank >= 1) return false;
        if (rec?.name && wasRank === 0) {
          // 首次：学会该配方（进副职业面板的配方清单，绝不进技能/天赋栏）
          chars.addRecipe('B1', tree.profession, {
            id: `RT_${node.id}`, name: rec.name, tier: rec.tier,
            progress: LEARN_PROGRESS[node.kind] ?? 20, materials: rec.materials, output: rec.output, desc: rec.desc,
          });
        }
        // 微星 / 任何节点：只花潜能点 → 累计耗费即「副职业熟练度」(subProfTreeSpent 派生·不再 bumpSubProf)

        set((st) => {
          const cur = st.progress[charId] ?? newProgress();
          return {
            progress: {
              ...st.progress,
              [charId]: { ...cur, activeTreeId: prog.activeTreeId, ranks: { ...cur.ranks, [nodeId]: nodeRank(cur, nodeId) + 1 }, spent: (cur.spent ?? 0) + paid },
            },
          };
        });
        return true;
      },

      // 配方节点 rank≥1 再投点：先由面板调 AI 把配方【质变升级】（提产出/品质/效果/加新效果），再用结果覆盖配方（同名 upsert·不重置熟练度）+ 加一点 + 配方熟练度小涨。与职业技能树「大节点升级」一致。
      applyRecipeUpgrade: (charId, nodeId, upgraded) => {
        const s = get();
        const prog = s.progress[charId] ?? newProgress();
        const tree = prog.activeTreeId ? s.trees[prog.activeTreeId] : undefined;
        if (!tree) return false;
        const profile = usePlayer.getState().profile;
        const ctx = { level: profile.level, tier: profile.tier, charId, ignoreTierGate: true };
        if (!canRankUp(tree, nodeId, prog, ctx).ok) return false;
        const node = tree.nodes.find((n) => n.id === nodeId); if (!node) return false;
        const rec = node.grants?.recipe; if (!rec?.name) return false;
        const chars = useCharacters.getState();
        chars.addRecipe('B1', tree.profession, {   // 质变覆盖：略去 progress → addRecipe 保留原熟练度
          id: `RT_${node.id}`, name: rec.name,
          tier: upgraded.tier ?? rec.tier, materials: upgraded.materials ?? rec.materials,
          output: upgraded.output ?? rec.output, desc: upgraded.desc ?? rec.desc,
        });
        chars.bumpRecipe('B1', tree.profession, rec.name, 25);   // 投点钻研 → 配方熟练度+25
        set((st) => {
          const cur = st.progress[charId] ?? newProgress();
          return { progress: { ...st.progress, [charId]: { ...cur, activeTreeId: prog.activeTreeId, ranks: { ...cur.ranks, [nodeId]: nodeRank(cur, nodeId) + 1 }, spent: (cur.spent ?? 0) + nodeCostFor(node, ctx) } } };
        });
        return true;
      },

      setEvoSeenTier: (charId, profName, idx) => set((st) => {
        const cur = st.progress[charId] ?? newProgress();
        return { progress: { ...st.progress, [charId]: { ...cur, evoSeenTier: { ...(cur.evoSeenTier ?? {}), [profName]: idx } } } };
      }),

      // 乐园币兑换潜能点：单价 = 阶位基础价 × ppCoinStep^已兑换数（越买越贵）；计入共享池。返回实际兑换数
      exchangePP: (charId, count) => {
        const want = Math.max(0, Math.floor(count));
        if (!want) return 0;
        const prof = usePlayer.getState().profile;
        const base = coinPerPP(prof.tier, prof.level);
        const bought = get().progress[charId]?.exchangedPP ?? 0;
        const have = useItems.getState().currency['乐园币'] || 0;
        let got = 0, cost = 0;
        for (let i = 0; i < want; i++) {
          const price = Math.max(1, Math.round(base * Math.pow(SKILLTREE_TUNING.ppCoinStep, bought + got)));
          if (have - cost < price) break;
          cost += price; got++;
        }
        if (got <= 0) return 0;
        useItems.getState().adjustCurrency('乐园币', -cost);
        set((st) => {
          const p = st.progress[charId] ?? newProgress();
          return { progress: { ...st.progress, [charId]: { ...p, aiBonusPP: (p.aiBonusPP ?? 0) + got, exchangedPP: (p.exchangedPP ?? 0) + got } } };
        });
        return got;
      },
    }),
    {
      name: 'drpg-subproftree',
      partialize: (s) => ({ trees: s.trees, progress: s.progress }),
      // 内置树版本升级：缺失补入 / 旧版本升级（保留用户自建树与解锁进度）
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Pick<SubProfTreeState, 'trees' | 'progress'>>;
        const trees: Record<string, TreeDef> = { ...(p.trees ?? {}) };
        for (const bt of BUILTIN_TREES) {
          const old = trees[bt.id];
          if (!old || (old.version ?? 0) < bt.version) trees[bt.id] = bt;
        }
        const progress: Record<string, SubProfTreeProgress> = {};
        for (const [cid, raw] of Object.entries((p.progress ?? {}) as Record<string, any>)) {
          progress[cid] = { activeTreeId: raw?.activeTreeId, ranks: raw?.ranks ?? {}, aiBonusPP: raw?.aiBonusPP ?? 0, exchangedPP: raw?.exchangedPP ?? 0, spent: raw?.spent ?? 0, evoSeenTier: raw?.evoSeenTier ?? {} };
        }
        return { ...current, trees, progress };
      },
    },
  ),
);

// 共享潜能池：把「副职业树已花/额外潜能点」登记进 treePool，与技能树合并计算可用潜能
registerTreePool((charId) => {
  const p = useSubProfTree.getState().progress[charId];
  return { spent: p?.spent ?? 0, bonus: p?.aiBonusPP ?? 0 };
});

/* 是否大节点（解锁配方）——供面板判定「学/精进」按钮文案 */
export function isRecipeNode(node: TreeNode | undefined): boolean { return isBigNode(node); }
