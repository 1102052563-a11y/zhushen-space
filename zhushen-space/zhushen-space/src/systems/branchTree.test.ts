import { describe, it, expect } from 'vitest';
import {
  splitTurns, attachIndex, buildBranchTree, digest, X0, LANE_W, ROW_H, Y0,
  type MsgLite, type SlotLite,
} from './branchTree';

const u = (id: number, c = '我出手') => ({ id, role: 'user', content: c });
const a = (id: number, c = '正文') => ({ id, role: 'assistant', content: c });

/** 一段普通对话：开场 + 3 个回合 */
const CHAT: MsgLite[] = [a(1, '开场白'), u(2, '打他'), a(3, '你打赢了'), u(4, '继续'), a(5, '又赢了'), u(6, '再来'), a(7, '第三次')];

const branch = (id: string, parentMsgId: number, over: Partial<SlotLite> = {}): SlotLite => ({
  id, name: `⟳ 支线 ${id}`, updatedAt: 1000 + Number(id.replace(/\D/g, '')),
  tipMsgId: parentMsgId + 2,
  preview: { turn: 9, lastText: '另一种结局' },
  branch: { origin: 'regen', parentMsgId },
  ...over,
});

describe('splitTurns · 线性对话切回合', () => {
  it('首条用户楼层之前的内容归「开场」(turn 0)', () => {
    const rows = splitTurns(CHAT);
    expect(rows[0].turn).toBe(0);
    expect(rows[0].userMsgId).toBe(-1);
    expect(rows[0].tipMsgId).toBe(1);
    expect(rows[0].text).toBe('开场白');
  });

  it('一条 user 开一回合，其后的 assistant 并入，回合号连续', () => {
    const rows = splitTurns(CHAT);
    expect(rows.map((r) => r.turn)).toEqual([0, 1, 2, 3]);
    expect(rows.map((r) => r.tipMsgId)).toEqual([1, 3, 5, 7]);
    expect(rows[1].text).toBe('你打赢了');
  });

  it('一回合多条 assistant → tip 取最后一条，正文取第一条', () => {
    const rows = splitTurns([u(1), a(2, '前半'), a(3, '后半')]);
    expect(rows).toHaveLength(1);
    expect(rows[0].tipMsgId).toBe(3);
    expect(rows[0].text).toBe('前半');
  });

  it('乱序输入按 id 归位（楼层乱序是已知偶发竞态，展示层得兜住）', () => {
    const rows = splitTurns([a(5, '又赢了'), u(2, '打他'), a(3, '你打赢了'), u(4, '继续')]);
    expect(rows.map((r) => r.tipMsgId)).toEqual([3, 5]);
  });

  it('空对话/脏数据不炸', () => {
    expect(splitTurns([])).toEqual([]);
    expect(splitTurns([{ id: undefined, role: 'user', content: 'x' } as any])).toEqual([]);
  });
});

describe('attachIndex · 支线挂到哪一回合之后', () => {
  const rows = splitTurns(CHAT);   // tip = [1,3,5,7]

  it('分叉点正好是某回合末端 → 挂在那一回合之后', () => {
    expect(attachIndex(rows, 3)).toBe(1);
    expect(attachIndex(rows, 5)).toBe(2);
  });

  it('分叉点落在回合中间 → 挂在它所在回合的前一回合之后', () => {
    expect(attachIndex(rows, 4)).toBe(1);   // 4 是第2回合的 user 楼层，共有部分只到 tip=3
  });

  it('分叉点早于整条对话 → -1（挂不上）', () => {
    expect(attachIndex(rows, -1)).toBe(-1);
    expect(attachIndex(rows, 0)).toBe(-1);
  });
});

describe('buildBranchTree · 树模型', () => {
  it('主干每回合一个节点，竖排在 lane 0，末端标记「你在这里」', () => {
    const m = buildBranchTree({ messages: CHAT, branches: [] });
    const spine = m.nodes.filter((n) => n.kind === 'turn');
    expect(spine).toHaveLength(4);
    expect(spine.every((n) => n.lane === 0 && n.x === X0)).toBe(true);
    expect(spine.map((n) => n.y)).toEqual([Y0, Y0 + ROW_H, Y0 + 2 * ROW_H, Y0 + 3 * ROW_H]);
    expect(spine.filter((n) => n.current)).toHaveLength(1);
    expect(spine[spine.length - 1].current).toBe(true);
  });

  it('支线挂在分叉点那一回合旁，走虚线边', () => {
    const m = buildBranchTree({ messages: CHAT, branches: [branch('branch_1', 3)] });
    const b = m.nodes.find((n) => n.kind === 'branch')!;
    expect(b.lane).toBe(1);
    expect(b.x).toBe(X0 + LANE_W);
    expect(b.y).toBeGreaterThan(Y0 + ROW_H);          // 在第1回合下方一点
    expect(b.y).toBeLessThan(Y0 + 2 * ROW_H);         // 但不越过第2回合
    const edge = m.edges.find((e) => e.dashed)!;
    expect([edge.x1, edge.y1]).toEqual([X0, Y0 + ROW_H]);
  });

  it('同一分叉点的多条支线并排（lane 1,2,3…），画布随之变宽', () => {
    const m = buildBranchTree({ messages: CHAT, branches: [branch('branch_1', 3), branch('branch_2', 3), branch('branch_3', 3)] });
    expect(m.nodes.filter((n) => n.kind === 'branch').map((n) => n.lane).sort()).toEqual([1, 2, 3]);
    expect(m.laneCount).toBe(4);
    expect(m.width).toBeGreaterThan(X0 + 3 * LANE_W);
  });

  it('分叉点不在当前对话里 → 归「游离支线」，不画上树也不丢', () => {
    const m = buildBranchTree({ messages: CHAT, branches: [branch('branch_9', -1)] });
    expect(m.nodes.filter((n) => n.kind === 'branch')).toHaveLength(0);
    expect(m.orphans.map((o) => o.id)).toEqual(['branch_9']);
  });

  it('缺 parentMsgId 的旧数据也归游离，不报错', () => {
    const bad = { id: 'branch_x', name: 'x', updatedAt: 1 } as SlotLite;
    const m = buildBranchTree({ messages: CHAT, branches: [bad] });
    expect(m.orphans).toHaveLength(1);
  });

  it('带 tipMsgId 的备份/存档 → 主干对应回合获得可跳转的 slotId', () => {
    const snap: SlotLite = { id: 'autosnap_1', name: '🛟 自动备份', updatedAt: 5, tipMsgId: 5 };
    const m = buildBranchTree({ messages: CHAT, branches: [], jumpables: [snap] });
    const hit = m.nodes.find((n) => n.tipMsgId === 5)!;
    expect(hit.slotId).toBe('autosnap_1');
    expect(m.nodes.find((n) => n.tipMsgId === 3)!.slotId).toBeUndefined();   // 没备份的回合跳不了
  });

  it('同一回合有多份备份 → 取最近的一份', () => {
    const old: SlotLite = { id: 'autosnap_old', name: '旧', updatedAt: 10, tipMsgId: 7 };
    const neu: SlotLite = { id: 'autosnap_new', name: '新', updatedAt: 99, tipMsgId: 7 };
    const m = buildBranchTree({ messages: CHAT, branches: [], jumpables: [old, neu] });
    expect(m.nodes.find((n) => n.tipMsgId === 7)!.slotId).toBe('autosnap_new');
  });

  it('旧档没有 tipMsgId 的槽被忽略，不会误挂到 0 号楼层', () => {
    const legacy: SlotLite = { id: 'slot_old', name: '老存档', updatedAt: 1 };
    const m = buildBranchTree({ messages: CHAT, branches: [], jumpables: [legacy] });
    expect(m.nodes.filter((n) => n.slotId)).toHaveLength(0);
  });

  it('长档只画最近 N 回合，但 turnCount 仍报总数', () => {
    const long: MsgLite[] = [];
    for (let i = 1; i <= 100; i++) { long.push(u(i * 2), a(i * 2 + 1)); }
    const m = buildBranchTree({ messages: long, branches: [], limit: 10 });
    expect(m.turnCount).toBe(100);
    expect(m.shown).toBe(10);
    expect(m.nodes.filter((n) => n.kind === 'turn')).toHaveLength(10);
    expect(m.nodes.find((n) => n.current)!.tipMsgId).toBe(201);   // 末端仍是最新一回合
  });

  it('被截断掉的早期分叉点归游离，不会错挂到第一个可见回合', () => {
    const long: MsgLite[] = [];
    for (let i = 1; i <= 40; i++) { long.push(u(i * 2), a(i * 2 + 1)); }
    const m = buildBranchTree({ messages: long, branches: [branch('branch_1', 5)], limit: 10 });
    expect(m.nodes.filter((n) => n.kind === 'branch')).toHaveLength(0);
    expect(m.orphans).toHaveLength(1);
  });

  it('空对话安全：不炸、无节点、高度有下限', () => {
    const m = buildBranchTree({ messages: [], branches: [] });
    expect(m.nodes).toEqual([]);
    expect(m.turnCount).toBe(0);
    expect(m.height).toBeGreaterThan(0);
  });

  it('收藏标记透传到节点（UI 靠它显示 📌 并豁免裁剪）', () => {
    const m = buildBranchTree({ messages: CHAT, branches: [branch('branch_1', 3, { branch: { origin: 'manual', parentMsgId: 3, pinned: true } })] });
    const b = m.nodes.find((n) => n.kind === 'branch')!;
    expect(b.pinned).toBe(true);
    expect(b.origin).toBe('manual');
  });
});

describe('digest · 正文摘要', () => {
  it('剥掉结算块/HTML/引用行，只留散文', () => {
    expect(digest('<击杀结算>甲|越阶|主角+3</击杀结算>他挥出一刀')).toBe('他挥出一刀');
    expect(digest('> 【动作日志】记账\n他转身离开')).toBe('他转身离开');
    expect(digest('<div class="x">卡片</div>正文')).toContain('正文');
  });

  it('剥掉思考块（防泄漏）', () => {
    expect(digest('<think>我该怎么写</think>他开口了')).toBe('他开口了');
  });

  it('超长截断带省略号', () => {
    expect(digest('一'.repeat(200), 20)).toHaveLength(20);
    expect(digest('一'.repeat(200), 20).endsWith('…')).toBe(true);
  });

  it('空/undefined 安全', () => {
    expect(digest('')).toBe('');
    expect(digest(undefined as any)).toBe('');
  });
});
