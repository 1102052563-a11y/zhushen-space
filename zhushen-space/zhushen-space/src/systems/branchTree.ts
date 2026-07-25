/* 🌿 楼层分支树 · 模型与布局（2026-07-24）
   ─────────────────────────────────────────────────────────────────────────────
   参考 SillyTavern 的 Timelines 扩展：把聊天历史画成时间线，任意节点开分支。
   本文件是**纯函数层**：吃「当前对话 + 分支槽 meta + 其它可跳转槽 meta」，吐带坐标的节点/边。
   不碰 store、不碰 IndexedDB、不 import React —— 故可单测。

   数据来源全部是 `saveDb.allMeta()`（游标逐条剥掉 data），**画整棵树零存档数据加载**。
   主干挂载靠 `SaveSlot.tipMsgId`（本槽对话末端楼层 id），支线挂载靠 `branch.parentMsgId`（分叉点）。
   旧档没有 tipMsgId → 只是树上不显示它的跳转点，不报错、不丢数据。 */

export type BranchOrigin = 'regen' | 'rollback' | 'manual';

/** 只取需要的字段，避免本模块依赖 saveManager（反过来 saveManager 也不该依赖布局） */
export interface SlotLite {
  id: string;
  name: string;
  updatedAt: number;
  tipMsgId?: number;
  preview?: { turn?: number; lastText?: string; location?: string };
  branch?: { origin: BranchOrigin; parentMsgId: number; pinned?: boolean; note?: string };
}
export interface MsgLite { id: number; role: string; content: string }

export interface TurnRow {
  turn: number;          // 1-based；0 = 开场（首条用户楼层之前的内容）
  userMsgId: number;     // -1 = 开场行没有用户楼层
  tipMsgId: number;      // 本回合最后一条楼层 id —— 挂载与跳转都认它
  userText: string;
  text: string;          // 本回合正文（assistant 部分）
}

export interface TreeNode {
  key: string;
  kind: 'turn' | 'branch';
  lane: number; x: number; y: number;
  turn: number;
  title: string;
  text: string;
  tipMsgId: number;
  slotId?: string;       // 可跳转的槽：支线=自身；主干=命中的备份/存档
  slotName?: string;
  at?: number;           // 槽的 updatedAt
  origin?: BranchOrigin;
  pinned?: boolean;
  current?: boolean;     // 主干末端 = 你现在在这里
}
export interface TreeEdge { key: string; x1: number; y1: number; x2: number; y2: number; dashed?: boolean }

export interface BranchTreeModel {
  nodes: TreeNode[];
  edges: TreeEdge[];
  width: number; height: number;
  laneCount: number;
  turnCount: number;      // 主干总回合（未截断前）
  shown: number;          // 实际画出的主干回合数
  orphans: SlotLite[];    // 挂不上主干的支线（分叉点已不在当前对话里，多半来自另一条时间线）
}

// ── 布局常量（面板里 SVG 直接用这套坐标）──
export const ROW_H = 66;
export const LANE_W = 200;
export const X0 = 46;
export const Y0 = 36;
export const NODE_R = 9;
export const DEFAULT_LIMIT = 80;   // 主干只画最近 N 回合（长档几百回合时保证可读+不卡）

/** 正文摘要：剥 HTML / 结算块 / 骰子块，压掉空白 */
export function digest(s: string, n = 68): string {
  const t = String(s ?? '')
    .replace(/<(检定结果|击杀结算|世界结算)>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*[>＞].*$/gm, ' ')
    .replace(/【[^】]*】/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** 把线性对话切成「回合」：一条 user 开一回合，其后的 assistant 并入。首条 user 之前的内容 = 开场(turn 0)。 */
export function splitTurns(messages: MsgLite[]): TurnRow[] {
  const msgs = [...(messages ?? [])].filter((m) => m && typeof m.id === 'number').sort((a, b) => a.id - b.id);
  const rows: TurnRow[] = [];
  let cur: TurnRow | null = null;
  let n = 0;
  for (const m of msgs) {
    if (m.role === 'user') {
      cur = { turn: ++n, userMsgId: m.id, tipMsgId: m.id, userText: digest(m.content, 40), text: '' };
      rows.push(cur);
      continue;
    }
    if (!cur) {                                   // 开场（没有用户楼层在前）
      cur = { turn: 0, userMsgId: -1, tipMsgId: m.id, userText: '', text: digest(m.content) };
      rows.push(cur);
      continue;
    }
    cur.tipMsgId = m.id;
    if (m.role === 'assistant' && !cur.text) cur.text = digest(m.content);
  }
  return rows;
}

/** 支线挂到哪个回合：分叉点 parentMsgId 落在哪一回合的末端之前，就挂在那一回合之后。 */
export function attachIndex(rows: TurnRow[], parentMsgId: number): number {
  let idx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].tipMsgId <= parentMsgId) idx = i; else break;
  }
  return idx;                                     // -1 = 分叉点在整条对话之前（挂根）
}

export interface BuildInput {
  messages: MsgLite[];
  branches: SlotLite[];      // id 以 branch_ 开头的槽
  jumpables?: SlotLite[];    // 其它带 tipMsgId 的槽（🛟滚动备份 / ⏱自动存档 / 手动存档）→ 主干上的「回到此处」
  limit?: number;
}

export function buildBranchTree({ messages, branches, jumpables = [], limit = DEFAULT_LIMIT }: BuildInput): BranchTreeModel {
  const allRows = splitTurns(messages);
  const cut = Math.max(0, allRows.length - Math.max(1, limit));
  const rows = allRows.slice(cut);

  // 主干上每个 tip 楼层 → 最新的那个可跳转槽（同一回合有多份备份时取最近的）
  const jumpBy = new Map<number, SlotLite>();
  for (const s of jumpables) {
    const tip = s.tipMsgId;
    if (typeof tip !== 'number' || !tip) continue;
    const cur = jumpBy.get(tip);
    if (!cur || s.updatedAt > cur.updatedAt) jumpBy.set(tip, s);
  }

  const nodes: TreeNode[] = [];
  const edges: TreeEdge[] = [];
  const rowY = (i: number) => Y0 + i * ROW_H;

  rows.forEach((r, i) => {
    const j = jumpBy.get(r.tipMsgId);
    nodes.push({
      key: `t${r.tipMsgId}`,
      kind: 'turn',
      lane: 0, x: X0, y: rowY(i),
      turn: r.turn,
      title: r.turn === 0 ? '开场' : `第 ${r.turn} 回合`,
      text: r.text || r.userText,
      tipMsgId: r.tipMsgId,
      slotId: j?.id, slotName: j?.name, at: j?.updatedAt,
      current: i === rows.length - 1,
    });
    if (i > 0) edges.push({ key: `s${i}`, x1: X0, y1: rowY(i - 1), x2: X0, y2: rowY(i) });
  });

  // 支线：按分叉点分组，同一分叉点的并排放（lane 1,2,3…），挂在父回合与下一回合之间
  const byParent = new Map<number, SlotLite[]>();
  const orphans: SlotLite[] = [];
  for (const b of [...branches].sort((a, x) => a.updatedAt - x.updatedAt)) {
    const pid = b.branch?.parentMsgId;
    if (typeof pid !== 'number') { orphans.push(b); continue; }
    const idx = attachIndex(rows, pid);
    // 分叉点落在被截断的早期，或压根不在这条对话里 → 归为「游离支线」，另列不上树
    if (idx < 0) { orphans.push(b); continue; }
    (byParent.get(idx) ?? byParent.set(idx, []).get(idx)!).push(b);
  }

  let laneCount = 1;
  for (const [idx, list] of byParent) {
    list.forEach((b, k) => {
      const lane = 1 + k;
      laneCount = Math.max(laneCount, lane + 1);
      const x = X0 + lane * LANE_W;
      const y = rowY(idx) + ROW_H * 0.55;
      nodes.push({
        key: b.id,
        kind: 'branch',
        lane, x, y,
        turn: b.preview?.turn ?? 0,
        title: b.name,
        text: b.branch?.note || b.preview?.lastText || '',
        tipMsgId: b.tipMsgId ?? -1,
        slotId: b.id, slotName: b.name, at: b.updatedAt,
        origin: b.branch?.origin, pinned: b.branch?.pinned,
      });
      edges.push({ key: `b${b.id}`, x1: X0, y1: rowY(idx), x2: x, y2: y, dashed: true });
    });
  }

  return {
    nodes, edges,
    width: X0 + laneCount * LANE_W + 60,
    height: Y0 + Math.max(1, rows.length) * ROW_H + 40,
    laneCount,
    turnCount: allRows.length,
    shown: rows.length,
    orphans,
  };
}
