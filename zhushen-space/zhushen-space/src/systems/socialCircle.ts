/*
  社交圈（v5.6 世界引擎 `social_network_driven` 的轮回乐园**折中**实装）
  ────────────────────────────────────────────────────────────────────
  卡里把「社交圈」做成一个独立的变量树（性质/互动频率/信息范围/社群人脉/活跃角色/关联团体…），
  由 AI 单独推演维护。前端已经有关系图谱 + 势力 + 冒险团 + 公会 + 频道 —— 再加一层独立的
  「社交圈」store 是**概念过载**，玩家会分不清它和势力/冒险团的区别。

  折中：**不新建 store，把社交圈做成关系图谱的社区检测派生层**（纯计算·零 API·零存档）。
  只借用卡里最有价值的两个用法：

    ① **信息传播判定**：两人不在同一圈、且无 ≤2 跳路径 → 拒绝"他听说了"类演化（可判定的防超距）
    ② **注入过滤**：正文提到某人时，把他所在圈的其他活跃成员一并给 AI（比按好感排序更有语义）

  卡里那条「关键词命中最近 5 条消息才注入」的策略同样值钱，这里用在 §注入 上。

  算法：**标签传播（Label Propagation）**——确定性变体，按 id 字典序遍历、平票取最小标签，
  同一份图必得同一组圈子（不能每次刷新圈子就变，那样注入内容会跳来跳去）。
*/
import type { RelNode, RelEdge } from './relationGraph';

export interface Circle {
  id: string;          // 该圈的代表节点 id（成员里字典序最小的）
  members: string[];   // 节点 id（含主角 B1，若他在圈内）
  names: string[];     // 对应显示名
}

/** 圈子最小规模：2 人成不了"圈"，至少 3 人才有信息流通的意义 */
export const MIN_CIRCLE = 3;

/* 邻接表（忽略好感虚拟边——那是"主角对某人"的私人关系，不代表两人同处一个社交圈） */
function adjacency(nodes: RelNode[], edges: RelEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    if (e.favorEdge) continue;
    if (!adj.has(e.a) || !adj.has(e.b)) continue;
    adj.get(e.a)!.add(e.b);
    adj.get(e.b)!.add(e.a);
  }
  return adj;
}

/**
 * 社区检测（确定性标签传播）。同一份图必得同一组圈子。
 * 死亡节点不参与（死人不在任何社交圈里）；ghost 节点参与（他们是"听说过的人"，正是信息链的一环）。
 */
export function detectCircles(nodes: RelNode[], edges: RelEdge[], maxRounds = 8): Circle[] {
  const live = nodes.filter((n) => !n.isDead);
  const adj = adjacency(live, edges);
  const label = new Map<string, string>();
  for (const n of live) label.set(n.id, n.id);

  const order = live.map((n) => n.id).sort();   // 固定遍历顺序 = 确定性
  for (let r = 0; r < maxRounds; r++) {
    let changed = false;
    for (const id of order) {
      const nbrs = adj.get(id);
      if (!nbrs || nbrs.size === 0) continue;
      const tally = new Map<string, number>();
      for (const nb of nbrs) {
        const l = label.get(nb);
        if (l) tally.set(l, (tally.get(l) ?? 0) + 1);
      }
      if (!tally.size) continue;
      // 取票数最多的标签；平票取字典序最小 → 结果稳定
      let best = '';
      let bestN = -1;
      for (const [l, c] of [...tally.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
        if (c > bestN) { best = l; bestN = c; }
      }
      if (best && best !== label.get(id)) { label.set(id, best); changed = true; }
    }
    if (!changed) break;
  }

  const byLabel = new Map<string, string[]>();
  for (const id of order) {
    const l = label.get(id)!;
    if (!byLabel.has(l)) byLabel.set(l, []);
    byLabel.get(l)!.push(id);
  }
  const nameOf = new Map(live.map((n) => [n.id, n.name]));
  return [...byLabel.values()]
    .filter((ms) => ms.length >= MIN_CIRCLE)
    .map((ms) => {
      const sorted = [...ms].sort();
      return { id: sorted[0], members: sorted, names: sorted.map((m) => nameOf.get(m) ?? m) };
    })
    .sort((a, b) => b.members.length - a.members.length);
}

/* ── ① 信息传播判定（可判定的防超距）────────────────────── */

/** 最短路跳数（BFS），不可达返回 Infinity */
export function hops(nodes: RelNode[], edges: RelEdge[], from: string, to: string): number {
  if (from === to) return 0;
  const adj = adjacency(nodes, edges);
  const seen = new Set([from]);
  let frontier = [from];
  let d = 0;
  while (frontier.length) {
    d++;
    const next: string[] = [];
    for (const cur of frontier) {
      for (const nb of adj.get(cur) ?? []) {
        if (seen.has(nb)) continue;
        if (nb === to) return d;
        seen.add(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return Infinity;
}

/** 信息可达的最大跳数（卡里的「二度人脉」） */
export const MAX_INFO_HOPS = 2;
/** 同圈时放宽到几跳。⚠ **不能无限放宽**：标签传播会把一条长链并成一个大圈，
 *  若"同圈"就无条件放行，链两端相距 4~5 跳的人也会被判成消息互通——防超距当场失效。
 *  同圈只代表"消息更容易流通"，不代表可以无视距离。 */
export const MAX_INFO_HOPS_SAME_CIRCLE = 3;

export interface InfoVerdict { ok: boolean; reason: string; hops: number }

/**
 * A 能不能知道关于 B 的事？
 * 同圈 → 放宽到 3 跳；不同圈 → 2 跳（经中间人传话）；超出 → **拒绝**（可判定的防超距）。
 */
export function canKnowAbout(
  nodes: RelNode[], edges: RelEdge[], circles: Circle[], from: string, to: string,
): InfoVerdict {
  const same = !!circles.find((c) => c.members.includes(from) && c.members.includes(to));
  const limit = same ? MAX_INFO_HOPS_SAME_CIRCLE : MAX_INFO_HOPS;
  const d = hops(nodes, edges, from, to);
  if (d <= limit) {
    return { ok: true, hops: d, reason: same ? `同处一个社交圈（相隔 ${d} 度），消息自然流通` : `${d} 度人脉，可经中间人传话` };
  }
  return {
    ok: false,
    hops: d,
    reason: d === Infinity
      ? '两人之间没有任何人际链路——对他而言这件事根本不存在'
      : `相隔 ${d} 度人脉，超出信息传播半径${same ? '（虽在同一大圈，但两端离得太远）' : ''}`,
  };
}

/* ── ② 注入过滤 ───────────────────────────────────────────── */

/** 找出与某人同圈的其他人（供注入时把"他的圈子"一并给 AI） */
export function circleMatesOf(circles: Circle[], id: string): string[] {
  const c = circles.find((x) => x.members.includes(id));
  return c ? c.members.filter((m) => m !== id) : [];
}

/**
 * 关键词命中才注入（借卡里那条「扫最近 N 条消息」的策略）：
 * 只有圈内成员的名字在近期文本里出现过，这个圈子才值得占正文预算。
 */
export function relevantCircles(circles: Circle[], recentText: string, cap = 2): Circle[] {
  const text = (recentText ?? '');
  if (!text.trim()) return [];
  return circles
    .map((c) => ({ c, hit: c.names.filter((n) => n.length >= 2 && text.includes(n)).length }))
    .filter((x) => x.hit > 0)
    .sort((a, b) => b.hit - a.hit)
    .slice(0, cap)
    .map((x) => x.c);
}

/** 注入正文：本轮相关的社交圈 + 防超距铁则。无命中不出块（不占预算）。 */
export function buildCircleInjection(circles: Circle[], recentText: string): { role: 'system'; content: string }[] {
  const picked = relevantCircles(circles, recentText);
  if (!picked.length) return [];
  const rows = picked.map((c) => `· ${c.names.slice(0, 8).join('、')}${c.members.length > 8 ? ` 等${c.members.length}人` : ''}`);
  return [{
    role: 'system' as const,
    content: `<社交圈>（这些人彼此相熟、消息在圈内自然流通——写他们时可自然带出"听谁说的"。`
      + `⚠ **圈外的事不会自己传进来**：不在同一圈、也没有共同熟人的两个人，一方绝不会"莫名知道"另一方的事）\n${rows.join('\n')}\n</社交圈>`,
  }];
}
