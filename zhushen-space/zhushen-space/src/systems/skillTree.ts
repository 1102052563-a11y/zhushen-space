/* ════════════════════════════════════════════════════════════════════════════
   职业技能树 — 纯逻辑引擎（无 React / 无 store 副作用）
   职责：潜能点预算 · 阶位 gate · 解锁结算校验 · 树契约校验(DAG) · 自动布局
   类型定义在 store/skillTreeStore.ts（此处 type-only 引用，无运行时循环依赖）。
   ──────────────────────────────────────────────────────────────────────────── */
import { TIERS, normalizeTier, realmFromLevel } from './derivedStats';
import { ATTR_KEYS, ATTR_LABEL, type AttrDelta } from './attrBonus';
import type { TreeDef, TreeNode } from '../store/skillTreeStore';

/* ── 调参旋钮（改即生效）────────────────────────────────────────────────────── */
export const SKILLTREE_TUNING = {
  ppBase: 4,            // 出生基础潜能点
  ppPerLevel: 4,        // 每升一级获得 4 潜能点
  ppPerTier: 0,         // 阶位里程碑额外潜能点（默认并入升级；保留旋钮）
  aiBonusTurnCap: 50,   // 单回合 AI/任务加成封顶（防刷）
  maxRankDefault: 3,    // 每个普通节点可点 3 次（3 个豆子）
  realAttrMul: 80,      // 真实属性点 → 普通属性等值（每 80 普通 = 1 真实）
  ppCoinBase: 1000,     // 乐园币兑换潜能点：1 潜能点基础价(一阶)；按阶位指数递增以防前期囤点
  ppCoinGrowth: 2,      // 每升一阶兑换价 ×此值（一阶1000→二阶2000→…→九阶25.6万）
  ppCoinStep: 1.25,     // 越买越贵：每兑换 1 潜能点，下一点价 ×此值（防一次性囤大量潜能点）
  respecCoinPerPoint: 200,  // 洗点代价：每洗 1 个小节点点数 花 200 乐园币（大节点不可洗）
  socketRadius: 240,    // 星核默认作用半径（画布像素）；半径内已点亮微星受其增益
  costByKind: { minor: 2, medium: 4, major: 6, capstone: 14 } as Record<TreeNode['kind'], number>,
  // 层 → 默认阶位 gate（编辑器「按层套用阶位」用；可被节点单独覆盖）
  layerTierGate: ['一阶', '三阶', '五阶', '七阶', '九阶'] as string[],
};

export const DEFAULT_BRANCH_COLORS = ['#38bdf8', '#f59e0b', '#a78bfa', '#34d399', '#f472b6'];

export interface TreeCtx { level: number; tier?: string; expressBranches?: Set<string> }

/* 「传承·提前解锁」：主角已通过其它途径获得某路【终极技能/天赋】(capstone) → 该路全程提前解锁(免阶位/累计闸门)、每节点仅 1 潜能点。 */
function normName(s?: string): string { return String(s ?? '').trim().toLowerCase(); }
/* 主角已拥有的技能+天赋名集合（规范化），喂给 expressBranchIds 判路。 */
export function ownedNameSet(skills?: { name?: string }[], traits?: { name?: string }[]): Set<string> {
  const out = new Set<string>();
  for (const x of skills ?? []) if (x?.name) out.add(normName(x.name));
  for (const x of traits ?? []) if (x?.name) out.add(normName(x.name));
  return out;
}
/* 哪些 branch 的终极(capstone)技能/天赋已被主角拥有 → 该 branch 提前解锁。 */
export function expressBranchIds(tree: TreeDef | undefined, owned: Set<string> | undefined): Set<string> {
  const out = new Set<string>();
  if (!tree || !owned || !owned.size) return out;
  for (const n of tree.nodes) {
    if (n.kind !== 'capstone' || n.sink || !n.branch) continue;
    const nm = n.grants?.skill?.name || n.grants?.trait?.name;
    if (nm && owned.has(normName(nm))) out.add(n.branch);
  }
  return out;
}
/* 节点实际花费：传承提前解锁的路线全程 1 点；否则 node.cost。 */
export function nodeCostFor(node: TreeNode, ctx?: TreeCtx): number {
  if (node.branch && ctx?.expressBranches?.has(node.branch)) return 1;
  return node.cost ?? 0;
}

/* 阶位序号（一阶=0 … 无上之境=12）；取不到返回 -1 */
export function tierIdxOf(tier?: string): number {
  return TIERS.indexOf(normalizeTier(tier) as typeof TIERS[number]);
}

/* 有效阶位名 = max(名义阶位, 等级反推阶位)（与竞技场 effectiveTier 一致）*/
export function effectiveTierName(tier: string | undefined, level: number): string {
  const named = normalizeTier(tier);
  const byLevel = realmFromLevel(Math.max(1, Math.floor(level || 1)));
  const i1 = TIERS.indexOf(named as typeof TIERS[number]);
  const i2 = TIERS.indexOf(byLevel as typeof TIERS[number]);
  return (i1 >= i2 ? named : byLevel) || byLevel || '一阶';
}

/* 乐园币兑换潜能点·单价：按有效阶位指数递增（早期昂贵→防前期囤点；后期仍有意义）。 */
export function coinPerPP(tier: string | undefined, level: number): number {
  const idx = Math.max(0, tierIdxOf(effectiveTierName(tier, level)));
  return Math.max(1, Math.round(SKILLTREE_TUNING.ppCoinBase * Math.pow(SKILLTREE_TUNING.ppCoinGrowth, idx)));
}

/* 潜能点预算 = 等级线性 + 阶位里程碑（纯函数，不漂移）*/
export function potentialBudget(level: number, tier?: string): number {
  const lv = Math.max(1, Math.floor(level || 1));
  const ti = Math.max(0, tierIdxOf(effectiveTierName(tier, lv)));
  return SKILLTREE_TUNING.ppBase + SKILLTREE_TUNING.ppPerLevel * (lv - 1) + SKILLTREE_TUNING.ppPerTier * ti;
}

export function defaultCost(kind: TreeNode['kind']): number {
  return SKILLTREE_TUNING.costByKind[kind] ?? 2;
}

/* 节点最大点数（豆子数）；sink 无上限节点给一个很大的数 */
export function nodeMaxRank(node: TreeNode): number {
  if (node.sink) return node.maxRank ?? 999;
  return node.maxRank ?? SKILLTREE_TUNING.maxRankDefault;
}

export interface SocketCore { itemName?: string; name?: string; effect?: string; ptAttr?: AttrDelta; radius?: number; chainNodeIds?: string[]; active?: boolean }
export interface ProgressLike { ranks?: Record<string, number>; aiBonusPP?: number; spent?: number; sockets?: Record<string, SocketCore> }

export function nodeRank(progress: ProgressLike | undefined, id: string): number {
  return Math.max(0, Math.floor(progress?.ranks?.[id] ?? 0));
}
export function isUnlocked(progress: ProgressLike | undefined, id: string): boolean {
  if (nodeRank(progress, id) >= 1) return true;   // 点过 ≥1 次即可作前置
  const sk = progress?.sockets?.[id];   // 已嵌核(未拆卸)的星核位视为已解锁 → 其脉络链可继续点
  return !!(sk && sk.active !== false);
}

/* 当前可用潜能点 = 预算 + 累计(兑换/任务/奇遇) − 已花费 */
export function availablePP(progress: ProgressLike | undefined, ctx: TreeCtx): number {
  return potentialBudget(ctx.level, ctx.tier) + (progress?.aiBonusPP ?? 0) - (progress?.spent ?? 0);
}

/* 阶位 gate 已移除（2026-06-17 用户要求）：所有节点不再受 tierGate 限制，恒通过。 */
export function gatePass(_node: TreeNode, _ctx: TreeCtx): boolean {
  return true;
}

/* sink「无上限」节点是否满足前提：本树所有非 sink 节点都已点满 */
export function allNonSinkMaxed(tree: TreeDef, progress: ProgressLike | undefined): boolean {
  return tree.nodes.filter((n) => !n.sink).every((n) => nodeRank(progress, n.id) >= nodeMaxRank(n));
}

export interface UnlockCheck { ok: boolean; reason?: string }

/* 单节点能否「再点一次」（确定性）：未满级 · 前置全开 · gate 达标 · 潜能点够 · sink 需全树点满 */
export function canRankUp(
  tree: TreeDef | undefined, nodeId: string, progress: ProgressLike | undefined, ctx: TreeCtx,
): UnlockCheck {
  if (!tree) return { ok: false, reason: '无技能树' };
  const node = tree.nodes.find((n) => n.id === nodeId);
  if (!node) return { ok: false, reason: '节点不存在' };
  const cur = nodeRank(progress, nodeId);
  if (cur >= nodeMaxRank(node)) return { ok: false, reason: node.sink ? '已达上限' : '已点满' };
  const missing = (node.prereqs ?? []).filter((p) => !isUnlocked(progress, p));
  if (missing.length) {
    const names = missing.map((id) => tree.nodes.find((n) => n.id === id)?.name ?? id);
    return { ok: false, reason: `需先解锁：${names.join('、')}` };
  }
  // 大节点(中星/主星)：紧邻它的前置节点必须【点满】才能解锁（投满铺垫→再拿大招，增加爽感）；中型子技能不受此限
  if (node.kind === 'major' || node.kind === 'capstone') {
    const notMaxed = (node.prereqs ?? []).filter((p) => {
      const pn = tree.nodes.find((n) => n.id === p);
      if (!pn || pn.socket || pn.sink) return false;   // 星核位(嵌核即满足)/无尽端点(无上限) 不要求点满
      return nodeRank(progress, p) < nodeMaxRank(pn);
    });
    if (notMaxed.length) {
      const names = notMaxed.map((id) => tree.nodes.find((n) => n.id === id)?.name ?? id);
      return { ok: false, reason: `需先点满前置节点：${names.join('、')}` };
    }
  }
  const express = !!(node.branch && ctx.expressBranches?.has(node.branch));
  if (!express && node.spentGate && (progress?.spent ?? 0) < node.spentGate) return { ok: false, reason: `需累计投入 ${node.spentGate} 潜能点（现 ${progress?.spent ?? 0}）` };
  if (node.sink && !allNonSinkMaxed(tree, progress)) return { ok: false, reason: '需先点满其余全部节点' };
  const avail = availablePP(progress, ctx);
  const cost = nodeCostFor(node, ctx);
  if (avail < cost) return { ok: false, reason: `潜能点不足（需 ${cost}，有 ${avail}）` };
  return { ok: true };
}
/** 向后兼容旧引用名 */
export const canUnlock = canRankUp;

/* 技能树累计六维加成 → 普通属性等值（喂给所有判定的有效六维 base）。
   普通节点 ptAttr 按普通点；sink 节点 realAttr=true 的 ptAttr 按真实点 ×80。 */
export function treeAttrDelta(tree: TreeDef | undefined, progress: ProgressLike | undefined): AttrDelta {
  const out: AttrDelta = {};
  if (!tree) return out;
  for (const n of tree.nodes) {
    const r = nodeRank(progress, n.id);
    if (r <= 0 || !n.ptAttr) continue;
    const mul = n.realAttr ? SKILLTREE_TUNING.realAttrMul : 1;
    for (const k of ATTR_KEYS) {
      const v = (n.ptAttr as any)[k];
      if (v) out[k] = (out[k] ?? 0) + v * r * mul;
    }
  }
  // 星核镶嵌：每个已嵌核 socket，作用半径内「已点亮微星」数 × 核 ptAttr → 加成（与设计的其它属性功能一同折进有效六维）
  const sockets = progress?.sockets ?? {};
  for (const [sid, core] of Object.entries(sockets)) {
    if (core?.active === false) continue;   // 已拆卸的星核不计加成（脉络链与已点点数保留）
    const sNode = tree.nodes.find((n) => n.id === sid);
    if (!sNode || !core?.ptAttr) continue;
    const radius = core.radius ?? SKILLTREE_TUNING.socketRadius;
    let cnt = 0;
    for (const n of tree.nodes) {
      if (n.id === sid || isBigNode(n) || n.sink || n.socket || (n.layer ?? 0) <= 0) continue;   // 只算微星
      if (nodeRank(progress, n.id) < 1) continue;
      const dx = (n.x ?? 0) - (sNode.x ?? 0), dy = (n.y ?? 0) - (sNode.y ?? 0);
      if (dx * dx + dy * dy <= radius * radius) cnt++;
    }
    if (cnt > 0) for (const k of ATTR_KEYS) { const v = (core.ptAttr as any)[k]; if (v) out[k] = (out[k] ?? 0) + v * cnt; }
  }
  return out;
}

/* 大节点 = 解锁技能/天赋的节点（中星/主星）。洗点不动它们。*/
export function isBigNode(node: TreeNode | undefined): boolean {
  return !!(node && (node.grants?.skill || node.grants?.trait));
}
/* 洗点退还的小节点点数（仅非大节点 rank×cost 之和）→ 乘 respecCoinPerPoint = 乐园币代价 */
export function respecMinorPoints(tree: TreeDef | undefined, progress: ProgressLike | undefined): number {
  if (!tree) return 0;
  let pts = 0;
  for (const n of tree.nodes) { if (!isBigNode(n)) pts += nodeRank(progress, n.id) * (n.cost ?? 0); }
  return pts;
}

/* 六维增减 → 可读文本「力量+5、智力+3」（喂给合成被动天赋的 attrBonus）*/
export function attrDeltaText(a?: AttrDelta): string {
  if (!a) return '';
  return ATTR_KEYS.filter((k) => a[k]).map((k) => `${ATTR_LABEL[k]}${a[k]! > 0 ? '+' : ''}${a[k]}`).join('、');
}

/* ── 树契约校验：手动编辑 / AI 生成的 JSON 都过这关，产出规范化的 TreeDef ──────── */
function sanitizeAttr(a: any, clampPositive = false): AttrDelta | undefined {
  if (!a || typeof a !== 'object') return undefined;
  const out: AttrDelta = {};
  for (const k of ATTR_KEYS) { let v = Math.trunc(Number((a as any)[k])); if (clampPositive && v < 0) v = 0; if (v) out[k] = v; }   // 技能树不产生负面/代价 → ptAttr 负值归零
  return Object.keys(out).length ? out : undefined;
}
/* 把 AI/手填的任意字段安全转成字符串（防对象/数组进了字符串字段，渲染时整页崩溃）*/
function fieldText(v: any): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v || undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => fieldText(x)).filter(Boolean).join('、') || undefined;
  if (typeof v === 'object') return attrDeltaText(v) || Object.entries(v).map(([k, val]) => `${k}:${fieldText(val)}`).join('、') || undefined;
  return String(v);
}
/* tags 规整成字符串数组（字符串按分隔符拆、数组逐项转字符串）*/
function fieldTags(v: any): string[] | undefined {
  let arr: string[] = [];
  if (Array.isArray(v)) arr = v.map((x) => fieldText(x) ?? '').filter(Boolean);
  else if (typeof v === 'string') arr = v.split(/[,，、/|]/).map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}
function sanitizeSkill(s: any): any {
  if (!s || typeof s !== 'object') return undefined;
  return { ...s, name: fieldText(s.name) ?? '', level: fieldText(s.level), skillType: fieldText(s.skillType), rarity: fieldText(s.rarity), cost: fieldText(s.cost), cooldown: fieldText(s.cooldown), target: fieldText(s.target), damage: fieldText(s.damage), effect: fieldText(s.effect), attrBonus: fieldText(s.attrBonus), desc: fieldText(s.desc), tags: fieldTags(s.tags) };
}
function sanitizeTrait(t: any): any {
  if (!t || typeof t !== 'object') return undefined;
  return { ...t, name: fieldText(t.name) ?? '', level: fieldText(t.level), rarity: fieldText(t.rarity), category: fieldText(t.category), source: fieldText(t.source), effect: fieldText(t.effect), attrBonus: fieldText(t.attrBonus), desc: fieldText(t.desc) };
}
function sanitizeGrants(g: any): TreeNode['grants'] {
  if (!g || typeof g !== 'object') return {};
  const out: TreeNode['grants'] = {};
  if (g.skill && typeof g.skill === 'object') out.skill = sanitizeSkill(g.skill);   // 字段全转字符串/tags转数组，防崩溃
  if (g.trait && typeof g.trait === 'object') out.trait = sanitizeTrait(g.trait);
  const a = sanitizeAttr(g.attr);
  if (a) out.attr = a;
  return out;
}

/* DFS 环检测：返回卷入环的节点名（用于报错），无环返回 null */
function findCycleNode(nodes: TreeNode[]): string | null {
  const adj = new Map<string, string[]>();           // 前置 p → 后继 n（p 必须先于 n）
  for (const n of nodes) adj.set(n.id, []);
  for (const n of nodes) for (const p of n.prereqs ?? []) adj.get(p)?.push(n.id);
  const color = new Map<string, number>();           // 0 白 1 灰 2 黑
  nodes.forEach((n) => color.set(n.id, 0));
  let bad: string | null = null;
  const dfs = (u: string): void => {
    color.set(u, 1);
    for (const v of adj.get(u) ?? []) {
      if (bad) return;
      if (color.get(v) === 1) { bad = nodes.find((n) => n.id === v)?.name ?? v; return; }
      if (color.get(v) === 0) { dfs(v); if (bad) return; }
    }
    color.set(u, 2);
  };
  for (const n of nodes) { if (color.get(n.id) === 0) { dfs(n.id); if (bad) break; } }
  return bad;
}

export interface TreeValidation { ok: boolean; errors: string[]; warnings: string[]; tree: TreeDef }

export function validateTree(raw: any): TreeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const branches = (Array.isArray(raw?.branches) ? raw.branches : []).map((b: any, i: number) => ({
    id: String(b?.id || `br_${i + 1}`),
    name: String(b?.name || `流派${i + 1}`),
    color: String(b?.color || DEFAULT_BRANCH_COLORS[i % DEFAULT_BRANCH_COLORS.length]),
    desc: b?.desc ? String(b.desc) : undefined,
  }));
  const branchIds = new Set(branches.map((b: any) => b.id));
  const usedIds = new Set<string>();
  const rawNodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
  const nodes: TreeNode[] = rawNodes.map((n: any, i: number) => {
    let id = String(n?.id || '').trim();
    if (!id || usedIds.has(id)) { let k = i + 1; while (usedIds.has(`N_${k}`)) k++; id = `N_${k}`; }
    usedIds.add(id);
    const kind: TreeNode['kind'] = n?.kind === 'major' || n?.kind === 'capstone' || n?.kind === 'medium' ? n.kind : 'minor';
    let branch = String(n?.branch || '').trim();
    if (branch && !branchIds.has(branch)) { warnings.push(`节点「${n?.name || id}」的分支不存在，已归入首支`); branch = branches[0]?.id || ''; }
    const tg = normalizeTier(n?.tierGate);
    return {
      id,
      name: String(n?.name || '未命名节点').trim(),
      branch,
      layer: Number.isFinite(Number(n?.layer)) ? Math.max(0, Math.floor(Number(n.layer))) : 1,   // 允许 0=中心节点
      tierGate: tg && TIERS.includes(tg as typeof TIERS[number]) ? tg : '',
      cost: Number.isFinite(Number(n?.cost)) ? Math.max(0, Math.floor(Number(n.cost))) : defaultCost(kind),   // 保留显式 0（免费 core），仅缺失/NaN 才取默认
      prereqs: Array.isArray(n?.prereqs) ? n.prereqs.map((x: any) => String(x)) : [],
      kind,
      grants: sanitizeGrants(n?.grants),
      maxRank: Number.isFinite(Number(n?.maxRank)) ? Math.max(1, Math.floor(Number(n.maxRank))) : undefined,
      ptAttr: sanitizeAttr(n?.ptAttr, true),   // 只留正值，负面/代价归零
      realAttr: !!n?.realAttr,
      sink: !!n?.sink,
      spentGate: Number.isFinite(Number(n?.spentGate)) ? Math.max(0, Math.floor(Number(n.spentGate))) : undefined,
      socket: !!n?.socket,
      socketRadius: Number.isFinite(Number(n?.socketRadius)) ? Math.max(60, Math.floor(Number(n.socketRadius))) : undefined,
      desc: n?.desc ? String(n.desc) : undefined,
      x: Number.isFinite(n?.x) ? Number(n.x) : undefined,
      y: Number.isFinite(n?.y) ? Number(n.y) : undefined,
    };
  });
  // 清理悬空/自引用前置
  const idSet = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    const before = n.prereqs.length;
    n.prereqs = n.prereqs.filter((p) => idSet.has(p) && p !== n.id);
    if (n.prereqs.length !== before) warnings.push(`节点「${n.name}」有无效前置已清理`);
  }
  // 环检测（致命）
  const cyc = findCycleNode(nodes);
  if (cyc) errors.push(`存在循环依赖（卷入「${cyc}」），玩家将永远无法解锁`);
  // 孤立提示（非致命）
  for (const n of nodes) {
    if ((n.prereqs?.length ?? 0) === 0 && n.layer > 1) warnings.push(`节点「${n.name}」位于第 ${n.layer} 层却无前置（玩家可直接解锁）`);
  }
  if (!nodes.length) errors.push('技能树没有任何节点');

  // 星座：归一化（nodeIds 过滤到存在的节点；保留 reward）
  const constellations = (Array.isArray(raw?.constellations) ? raw.constellations : []).map((c: any, i: number) => ({
    id: String(c?.id || `cst_${i + 1}`),
    name: String(c?.name || `星座${i + 1}`),
    nodeIds: (Array.isArray(c?.nodeIds) ? c.nodeIds.map((x: any) => String(x)) : []).filter((id: string) => idSet.has(id)),
    reward: sanitizeGrants(c?.reward),
    desc: c?.desc ? String(c.desc) : undefined,
  })).filter((c: any) => c.nodeIds.length >= 2 && (c.reward.skill || c.reward.trait));   // 至少 2 节点 + 有奖励才有效

  const tree: TreeDef = {
    id: String(raw?.id || `tree_${Date.now().toString(36)}`),
    profession: String(raw?.profession || raw?.title || '自定义职业').trim() || '自定义职业',
    title: raw?.title ? String(raw.title) : undefined,
    branches,
    nodes,
    constellations: constellations.length ? constellations : undefined,
    source: raw?.source === 'ai' || raw?.source === 'builtin' ? raw.source : 'manual',
    version: Math.max(1, Math.floor(Number(raw?.version) || 1)),
  };
  return { ok: errors.length === 0, errors, warnings, tree };
}

/* 星座成型状态：每个星座的 已点亮/总数 + 是否成型（全部 rank≥1）*/
export interface ConstellationStat { id: string; name: string; lit: number; total: number; complete: boolean; nodeIds: string[]; reward: any; desc?: string }
export function constellationStatus(tree: TreeDef | undefined, progress: ProgressLike | undefined): ConstellationStat[] {
  return (tree?.constellations ?? []).map((c) => {
    const lit = c.nodeIds.filter((id) => nodeRank(progress, id) >= 1).length;
    return { id: c.id, name: c.name, lit, total: c.nodeIds.length, complete: lit >= c.nodeIds.length && c.nodeIds.length > 0, nodeIds: c.nodeIds, reward: c.reward, desc: c.desc };
  });
}

/* ── 径向「星图」布局：中心放射，流派支=臂(按角度均分)，层=同心环，同层兄弟扇开 ──
   只给缺 x/y 的节点摆位（手动拖动的保留）。layer<=0 视为中心节点。 */
const PAD = 110, RING_STEP = 150, BASE_R = 150, SIB_SPREAD = 0.34;
export function autoLayout(tree: TreeDef): TreeDef {
  const branchOrder = tree.branches.map((b) => b.id);
  const N = Math.max(1, branchOrder.length);
  const baseAngle = (bid: string) => (Math.max(0, branchOrder.indexOf(bid)) / N) * Math.PI * 2 - Math.PI / 2; // 从正上方起，顺时针均分
  // 同 分支|层 分组，做角度扇开避免重叠
  const groups = new Map<string, TreeNode[]>();
  for (const n of tree.nodes) {
    const k = `${n.branch}|${n.layer}`;
    let arr = groups.get(k); if (!arr) { arr = []; groups.set(k, arr); }
    arr.push(n);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of tree.nodes) {
    if (Number.isFinite(n.x) && Number.isFinite(n.y)) { pos.set(n.id, { x: n.x!, y: n.y! }); continue; }
    if ((n.layer ?? 0) <= 0) { pos.set(n.id, { x: 0, y: 0 }); continue; }   // 中心
    const sibs = groups.get(`${n.branch}|${n.layer}`) ?? [n];
    const idx = Math.max(0, sibs.indexOf(n)), cnt = sibs.length;
    const ang = baseAngle(n.branch) + (idx - (cnt - 1) / 2) * SIB_SPREAD;
    const r = BASE_R + (n.layer - 1) * RING_STEP;
    pos.set(n.id, { x: Math.cos(ang) * r, y: Math.sin(ang) * r });
  }
  // 归一化到正坐标 + padding
  let minX = Infinity, minY = Infinity;
  for (const p of pos.values()) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; }
  const nodes = tree.nodes.map((n) => {
    const p = pos.get(n.id)!;
    return { ...n, x: Math.round(p.x - minX + PAD), y: Math.round(p.y - minY + PAD) };
  });
  return { ...tree, nodes };
}

/* 画布范围（供 SVG viewBox / 容器尺寸）*/
export function treeBounds(tree: TreeDef): { w: number; h: number } {
  let maxX = 0, maxY = 0;
  for (const n of tree.nodes) { maxX = Math.max(maxX, n.x ?? 0); maxY = Math.max(maxY, n.y ?? 0); }
  return { w: Math.max(420, maxX + PAD), h: Math.max(320, maxY + PAD) };
}

/* 进度统计：已点节点数(rank≥1) / 总节点数 + 累计点数(Σrank) / 满级总点数 */
export function treeProgressStats(tree: TreeDef | undefined, progress: ProgressLike | undefined): { unlocked: number; total: number; ranksOwned: number; ranksMax: number } {
  const nodes = tree?.nodes ?? [];
  let unlocked = 0, ranksOwned = 0, ranksMax = 0;
  for (const n of nodes) {
    const r = nodeRank(progress, n.id);
    if (r >= 1) unlocked++;
    ranksOwned += r;
    if (!n.sink) ranksMax += nodeMaxRank(n);
  }
  return { unlocked, total: nodes.length, ranksOwned, ranksMax };
}
