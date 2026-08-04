import { describe, it, expect, beforeEach } from 'vitest';
import { useTeam, FATIGUE_GATE, BOARD_SIZE, type DispatchOffer, type DispatchRecord } from '../store/adventureTeamStore';
import { useNpc, type NpcRecord } from '../store/npcStore';
import { useSettings } from '../store/settingsStore';
import { useItems } from '../store/itemStore';
import { makeRng } from './autonomyCorpus';
import {
  rollOfferBoard, estimateDispatch, settleDispatch, ratingOf,
  dispatchCandidates, memberBlockReason, runDispatchTick, launchDispatch, ensureBoard,
} from './dispatchEngine';
import { gradeForTier } from './dispatchGen';

/* ── 夹具 ── */
const npc = (id: string, over: Partial<NpcRecord> = {}): NpcRecord => ({
  id, name: `角色${id}`, realm: '五阶·Lv.42', bioStrength: 'T5',
  onScene: false, items: [], maxHp: 400, hp: 400,
  profession: '剑士', updatedAt: 1,
  ...over,
} as NpcRecord);

const offer = (over: Partial<DispatchOffer> = {}): DispatchOffer => ({
  id: 'o1', title: '清剿盘踞的凶物', world: '荒古禁地', tier: 5, turns: 4,
  slots: 2, arch: 'melee', archLabel: '近战', minPower: 5, danger: 0.5,
  ...over,
});

const rec = (over: Partial<DispatchRecord> = {}): DispatchRecord => ({
  id: 'dr_1', offer: offer(), memberIds: ['C1', 'C2'], memberNames: ['角色C1', '角色C2'],
  startTurn: 10, endTurn: 14,
  ...over,
});

function seedTeam(members: string[], patch: Record<string, unknown> = {}) {
  useTeam.setState({
    established: true, disbanded: false, name: '试验团', rank: 'C',
    members: members.map((id) => ({ id })), teamExp: 0, activity: 50,
    deeds: [], perks: [],                       // ⚠ setState 是**合并**：不显式清空的话大事记会跨用例累积

    dispatchBoard: [], boardTurn: -1, boardSource: 'auto', boardBusy: false, boardError: '',
    dispatchActive: null, dispatchHistory: [], fatigue: {}, injury: {},
    ...patch,
  });
}
function seedNpcs(list: NpcRecord[]) {
  useNpc.setState({ npcs: Object.fromEntries(list.map((n) => [n.id, n])) } as never);
}

beforeEach(() => {
  seedTeam(['C1', 'C2']);
  seedNpcs([npc('C1'), npc('C2')]);
  useSettings.setState({ npcAutonomyDeath: false } as never);
});

/* ══════════ 封条：整个功能的卖点 ══════════ */
describe('封条 · 时间不到看不到结算', () => {
  it('未到点：跑再多回合心跳也不出账本，active 里连 ledger 字段都没有', () => {
    seedTeam(['C1', 'C2'], { dispatchActive: rec() });
    for (let t = 10; t < 14; t++) runDispatchTick(t);
    const s = useTeam.getState();
    expect(s.dispatchActive).not.toBeNull();
    expect(s.dispatchActive!.ledger).toBeUndefined();     // 不是藏起来，是数据里没有
    expect(s.dispatchHistory).toHaveLength(0);
  });

  it('到点那一刻才封存：账本出现、记录移进历史、active 清空', () => {
    seedTeam(['C1', 'C2'], { dispatchActive: rec() });
    runDispatchTick(14);
    const s = useTeam.getState();
    expect(s.dispatchActive).toBeNull();
    expect(s.dispatchHistory).toHaveLength(1);
    expect(s.dispatchHistory[0].ledger).toBeDefined();
    expect(s.dispatchHistory[0].ledger!.sealedAt).toBe(14);
  });

  it('★封存时委托进账真金白银入钱包（金额与账本一致·魂币→灵魂钱币归一）', () => {
    // 此前 applyLedger 只把"进账 N"写进 deed 文字，面板/战报都显示进账、钱包一分不涨——被动收入整条线是断的
    seedTeam(['C1', 'C2'], { dispatchActive: rec() });
    const before = { ...useItems.getState().currency };
    runDispatchTick(14);
    const led = useTeam.getState().dispatchHistory[0].ledger!;
    const key = led.currency.kind === '魂币' ? '灵魂钱币' : '乐园币';
    const after = useItems.getState().currency;
    expect(after[key] - before[key]).toBe(led.currency.amount);
  });

  it('超过终点回合（漏跑了几回合）仍能补结算 —— 倒数记的是绝对回合，不是自减', () => {
    seedTeam(['C1', 'C2'], { dispatchActive: rec() });
    runDispatchTick(99);
    expect(useTeam.getState().dispatchHistory).toHaveLength(1);
  });

  it('人被删档/归档到一个不剩 → 撤回，不发奖也不报错', () => {
    seedTeam(['C1', 'C2'], { dispatchActive: rec() });
    seedNpcs([]);
    expect(() => runDispatchTick(14)).not.toThrow();
    expect(useTeam.getState().dispatchActive).toBeNull();
    expect(useTeam.getState().dispatchHistory).toHaveLength(0);
  });
});

/* ══════════ 出勤闸门 ══════════ */
describe('出勤资格', () => {
  it('主角 B1 永不进候选（人在正文里，不能同时被派出去）', () => {
    seedTeam(['B1', 'C1']);
    expect(dispatchCandidates().map((n) => n.id)).toEqual(['C1']);
  });

  it('未建档 / 已死 / 归档 的成员不进候选', () => {
    seedTeam(['C1', 'C2', 'C3', 'C9']);
    seedNpcs([npc('C1'), npc('C2', { isDead: true }), npc('C3', { archived: true })]);
    expect(dispatchCandidates().map((n) => n.id)).toEqual(['C1']);
  });

  it('疲劳 ≥ 闸门 → 需休整（这就是强制轮换）', () => {
    useTeam.setState({ fatigue: { C1: FATIGUE_GATE, C2: FATIGUE_GATE - 1 } });
    expect(memberBlockReason(npc('C1'))).toBe('需休整');
    expect(memberBlockReason(npc('C2'))).toBeNull();
  });

  it('伤势中 / 在场 / 已出勤 各有各的拦截理由', () => {
    useTeam.setState({ injury: { C1: { turns: 3, name: '断骨未愈' } }, dispatchActive: rec({ memberIds: ['C2'] }) });
    expect(memberBlockReason(npc('C1'))).toContain('疗伤');
    expect(memberBlockReason(npc('C2'))).toBe('出勤中');
    expect(memberBlockReason(npc('C3', { onScene: true }))).toBe('在场');
  });

  it('launchDispatch 自动剔掉被拦的人；一个能去的都没有则不出发', () => {
    useTeam.setState({ fatigue: { C1: 90 } });
    const r = launchDispatch(offer(), ['C1', 'C2'], 5);
    expect(r!.memberIds).toEqual(['C2']);

    useTeam.setState({ dispatchActive: null, fatigue: { C1: 90, C2: 90 } });
    expect(launchDispatch(offer(), ['C1', 'C2'], 5)).toBeNull();
  });

  it('已有队伍在外时不接第二单（团就一支）', () => {
    expect(launchDispatch(offer(), ['C1'], 5)).not.toBeNull();
    expect(launchDispatch(offer({ id: 'o2' }), ['C2'], 5)).toBeNull();
  });
});

/* ══════════ 评估 ══════════ */
describe('胜算评估', () => {
  it('战力碾压 → 高分；越级挑战 → 低分', () => {
    const strong = estimateDispatch(offer({ tier: 2 }), [npc('C1'), npc('C2')], 'C').score;
    const weak = estimateDispatch(offer({ tier: 9 }), [npc('C1'), npc('C2')], 'C').score;
    expect(strong).toBeGreaterThan(weak);
  });

  it('人手不足扣分，且标出 understaffed', () => {
    const full = estimateDispatch(offer({ slots: 2 }), [npc('C1'), npc('C2')], 'C');
    const half = estimateDispatch(offer({ slots: 2 }), [npc('C1')], 'C');
    expect(half.score).toBeLessThan(full.score);
    expect(half.understaffed).toBe(true);
    expect(full.understaffed).toBe(false);
  });

  it('原型对口加分、不对口扣分', () => {
    const melee = estimateDispatch(offer({ arch: 'melee' }), [npc('C1', { profession: '剑士' })], 'C').score;
    const caster = estimateDispatch(offer({ arch: 'melee' }), [npc('C1', { profession: '法师' })], 'C').score;
    expect(melee).toBeGreaterThan(caster);
  });

  it('队内宿敌扣分、盟友加分 —— 白嫖轨道A 在后台织的关系网', () => {
    const foes = [npc('C1', { relations: '角色C2：宿敌' }), npc('C2', { relations: '角色C1：宿敌' })];
    const allies = [npc('C1', { relations: '角色C2：盟友' }), npc('C2', { relations: '角色C1：盟友' })];
    const neutral = [npc('C1'), npc('C2')];
    const s = (m: NpcRecord[]) => estimateDispatch(offer(), m, 'C').score;
    expect(s(foes)).toBeLessThan(s(neutral));
    expect(s(allies)).toBeGreaterThan(s(neutral));
  });

  // ↓ 三条都是 2026-07-25 那个「拼串后对整串正则」bug 的回归测试
  it('跟队外的人结仇，不该算到队友头上', () => {
    const s = (m: NpcRecord[]) => estimateDispatch(offer(), m, 'C').score;
    // 甲跟没上队的「角色C9」有仇，甲乙之间明明是盟友 → 该按盟友加分
    const outsiderFeud = [
      npc('C1', { relations: '角色C9：宿敌;角色C2：盟友' }),
      npc('C2', { relations: '角色C1：盟友' }),
    ];
    expect(s(outsiderFeud)).toBeGreaterThan(s([npc('C1'), npc('C2')]));
  });

  it('名字互为前缀时不该误判 —— 必须按名精确取那一条', () => {
    const s = (m: NpcRecord[]) => estimateDispatch(offer(), m, 'C').score;
    // 「角色C2」是队外「角色C2X」的前缀：包含匹配会把跟 C2X 的仇扣到 C2 头上
    const prefixTrap = [
      npc('C1', { relations: '角色C2X：宿敌' }),
      npc('C2', { relations: '角色C1：盟友' }),
    ];
    expect(s(prefixTrap)).toBeGreaterThan(s([npc('C1'), npc('C2')]));
  });

  it('单方面记恨比互为死敌轻', () => {
    const s = (m: NpcRecord[]) => estimateDispatch(offer(), m, 'C').score;
    const mutual = [npc('C1', { relations: '角色C2：宿敌' }), npc('C2', { relations: '角色C1：宿敌' })];
    const oneWay = [npc('C1', { relations: '角色C2：宿敌' }), npc('C2')];
    const neutral = [npc('C1'), npc('C2')];
    expect(s(mutual)).toBeLessThan(s(oneWay));
    expect(s(oneWay)).toBeLessThan(s(neutral));
  });

  it('疲劳的人拉低胜算', () => {
    const fresh = estimateDispatch(offer(), [npc('C1'), npc('C2')], 'C').score;
    useTeam.setState({ fatigue: { C1: 60, C2: 60 } });
    expect(estimateDispatch(offer(), [npc('C1'), npc('C2')], 'C').score).toBeLessThan(fresh);
  });

  it('空编成不炸', () => {
    expect(estimateDispatch(offer(), [], 'C').score).toBe(0);
  });
});

/* ══════════ 结算 ══════════ */
describe('结算账本', () => {
  it('同一记录同一批人 → 结果完全可复现（种子确定性）', () => {
    const a = settleDispatch(rec(), [npc('C1'), npc('C2')], 'C', 14);
    const b = settleDispatch(rec(), [npc('C1'), npc('C2')], 'C', 14);
    expect(a).toEqual(b);
  });

  it('货币按阶位门槛：三阶及下乐园币 / 四阶起魂币，绝不混发', () => {
    for (let tier = 1; tier <= 9; tier++) {
      const l = settleDispatch(rec({ offer: offer({ tier }) }), [npc('C1'), npc('C2')], 'C', 14);
      expect(l.currency.kind).toBe(tier >= 4 ? '魂币' : '乐园币');
    }
  });

  it('魂币量级远小于乐园币（不是同一种钱，别按数字大小比）', () => {
    const p = settleDispatch(rec({ offer: offer({ tier: 3 }) }), [npc('C1')], 'C', 14);
    const s = settleDispatch(rec({ offer: offer({ tier: 9 }) }), [npc('C1')], 'C', 14);
    expect(p.currency.amount).toBeGreaterThan(s.currency.amount);
  });

  it('每个出勤成员都有一行账，且都记了疲劳', () => {
    const l = settleDispatch(rec(), [npc('C1'), npc('C2')], 'C', 14);
    expect(l.members.map((m) => m.id)).toEqual(['C1', 'C2']);
    expect(l.members.every((m) => m.fatigueAdd > 0)).toBe(true);
  });

  it('越级出勤更累', () => {
    const easy = settleDispatch(rec({ offer: offer({ tier: 1 }) }), [npc('C1')], 'C', 14).members[0].fatigueAdd;
    const hard = settleDispatch(rec({ offer: offer({ tier: 9 }) }), [npc('C1')], 'C', 14).members[0].fatigueAdd;
    expect(hard).toBeGreaterThan(easy);
  });

  it('致死开关关着 → 无论多惨都不死人', () => {
    for (let i = 0; i < 40; i++) {
      const l = settleDispatch(
        rec({ id: `dr_${i}`, offer: offer({ tier: 9, danger: 0.95 }) }),
        [npc('C1', { realm: '一阶·Lv.3', bioStrength: 'T0' })], 'E', 14, { allowDeath: false },
      );
      expect(l.casualties).toHaveLength(0);
    }
  });

  it('开了致死开关，弱队打高危委托才可能死；受保护的人永远不死', () => {
    const weak = () => npc('C1', { realm: '一阶·Lv.3', bioStrength: 'T0' });
    let deaths = 0;
    for (let i = 0; i < 60; i++) {
      const l = settleDispatch(rec({ id: `dx_${i}`, offer: offer({ tier: 9, danger: 0.95 }) }), [weak()], 'E', 14, { allowDeath: true });
      deaths += l.casualties.length;
    }
    expect(deaths).toBeGreaterThan(0);

    for (let i = 0; i < 60; i++) {
      const l = settleDispatch(
        rec({ id: `dy_${i}`, offer: offer({ tier: 9, danger: 0.95 }) }),
        [npc('C1', { realm: '一阶·Lv.3', bioStrength: 'T0', isFriend: true })], 'E', 14, { allowDeath: true },
      );
      expect(l.casualties).toHaveLength(0);
    }
  });

  it('战利品只在 S 及以上才可能出现，且不落到阵亡者头上', () => {
    for (let i = 0; i < 40; i++) {
      const l = settleDispatch(rec({ id: `dz_${i}` }), [npc('C1'), npc('C2')], 'C', 14, { allowDeath: true });
      const looted = l.members.filter((m) => m.lootName);
      if (looted.length) {
        expect(['S', 'SS', 'SSS']).toContain(l.rating);
        expect(looted.every((m) => !m.dead)).toBe(true);
      }
    }
  });

  it('评级分档单调：分越高档越高', () => {
    expect(ratingOf(10)).toBe('E');
    expect(ratingOf(30)).toBe('D');
    expect(ratingOf(60)).toBe('B');
    expect(ratingOf(99)).toBe('SSS');
    const order = ['E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
    let last = -1;
    for (let s = 0; s <= 100; s += 2) {
      const i = order.indexOf(ratingOf(s));
      expect(i).toBeGreaterThanOrEqual(last);
      last = i;
    }
  });

  it('E/D 判为失利，A 及以上给得起战利品档的经验', () => {
    const bad = settleDispatch(rec(), [npc('C1', { bioStrength: 'T0', realm: '一阶' })], 'E', 14);
    if (bad.rating === 'E' || bad.rating === 'D') expect(bad.success).toBe(false);
    expect(bad.teamExp).toBeGreaterThanOrEqual(0);
  });

  it('无论输赢都给活跃度 —— 这是活跃度唯一的玩家杠杆', () => {
    const l = settleDispatch(rec(), [npc('C1')], 'C', 14);
    expect(l.activity).toBeGreaterThan(0);
  });
});

/* ══════════ 落库副作用 ══════════ */
describe('封存时真落库', () => {
  it('团队经验/活跃度上涨，团队大事记多一条', () => {
    seedTeam(['C1', 'C2'], { dispatchActive: rec(), activity: 30, teamExp: 0 });
    runDispatchTick(14);
    const s = useTeam.getState();
    expect(s.activity).toBeGreaterThan(30);
    expect(s.deeds.length).toBe(1);
  });

  it('出勤者疲劳上涨；受伤的人进 injury 表并被拦住不能再派', () => {
    seedTeam(['C1', 'C2'], { dispatchActive: rec({ offer: offer({ tier: 9, danger: 0.95 }) }) });
    runDispatchTick(14);
    const s = useTeam.getState();
    expect(s.fatigue.C1).toBeGreaterThan(0);
    const l = s.dispatchHistory[0].ledger!;
    for (const m of l.members) {
      if (m.injured) expect(s.injury[m.id]?.turns).toBe(m.injuryTurns);
    }
  });

  it('NPC 收到经历 + 掉血，但绝不掉到 0 以下', () => {
    seedTeam(['C1'], { dispatchActive: rec({ memberIds: ['C1'], offer: offer({ tier: 9, danger: 0.95 }) }) });
    seedNpcs([npc('C1', { hp: 20, maxHp: 400 })]);
    runDispatchTick(14);
    const n = useNpc.getState().npcs.C1;
    expect(n.hp).toBeGreaterThanOrEqual(1);
    expect((n.deedLog ?? []).length).toBeGreaterThan(0);
  });
});

/* ══════════ 疲劳与伤势的回合恢复 ══════════ */
describe('休整循环', () => {
  it('待命的人每回合恢复疲劳，出勤中的不恢复', () => {
    seedTeam(['C1', 'C2'], { fatigue: { C1: 50, C2: 50 }, dispatchActive: rec({ memberIds: ['C2'] }) });
    runDispatchTick(11);
    const f = useTeam.getState().fatigue;
    expect(f.C1).toBeLessThan(50);
    expect(f.C2).toBe(50);
  });

  it('疲劳归零后键被清掉（长局不堆垃圾）', () => {
    seedTeam(['C1'], { fatigue: { C1: 1 } });
    runDispatchTick(11);
    expect('C1' in useTeam.getState().fatigue).toBe(false);
  });

  it('伤势每回合倒数，归零自动痊愈并解除拦截', () => {
    seedTeam(['C1'], { injury: { C1: { turns: 2, name: '断骨未愈' } } });
    runDispatchTick(11);
    expect(useTeam.getState().injury.C1.turns).toBe(1);
    runDispatchTick(12);
    expect(useTeam.getState().injury.C1).toBeUndefined();
    expect(memberBlockReason(npc('C1'))).toBeNull();
  });
});

/* ══════════ 委托板 ══════════ */
describe('委托板', () => {
  it('固定条数、阶位成梯度、最后一条永远是"够一够"的挑战', () => {
    const b = rollOfferBoard(0, 'C', [npc('C1')]);
    expect(b).toHaveLength(BOARD_SIZE);
    for (let i = 1; i < b.length; i++) expect(b[i].tier).toBeGreaterThanOrEqual(b[i - 1].tier);
    expect(b.at(-1)!.tier).toBeGreaterThan(b[0].tier);
  });

  it('同一批次内容稳定，换批后变化（按 BOARD_REFRESH 分组播种）', () => {
    const a = rollOfferBoard(0, 'C', [npc('C1')]);
    expect(rollOfferBoard(1, 'C', [npc('C1')]).map((o) => o.title)).toEqual(a.map((o) => o.title));
    expect(rollOfferBoard(60, 'C', [npc('C1')]).map((o) => o.title)).not.toEqual(a.map((o) => o.title));
  });

  it('阶位夹在 1~9，且不越界索引货币表', () => {
    const b = [...rollOfferBoard(0, 'SSS', [npc('C1', { realm: '九阶', bioStrength: 'T9' })]), ...rollOfferBoard(0, 'E', [])];
    for (const o of b) { expect(o.tier).toBeGreaterThanOrEqual(1); expect(o.tier).toBeLessThanOrEqual(9); }
  });

  it('没成员也能出板（不炸），且心跳会自动铺板', () => {
    seedTeam([]);
    seedNpcs([]);
    runDispatchTick(0);
    expect(useTeam.getState().dispatchBoard.length).toBe(BOARD_SIZE);
  });

  it('未建团时心跳直接返回，不铺板', () => {
    useTeam.setState({ established: false, dispatchBoard: [], boardTurn: -1 });
    runDispatchTick(0);
    expect(useTeam.getState().dispatchBoard).toHaveLength(0);
  });

  // 实机踩到的：新档进游戏直接点开派遣页，一条委托都没有（心跳只在跑完一个回合后才有机会铺板）
  it('ensureBoard：板空就补，没过期就不动（面板打开时调它，不必先走一个回合）', () => {
    seedTeam(['C1']);
    expect(ensureBoard(0)).toBe(true);
    expect(useTeam.getState().dispatchBoard).toHaveLength(BOARD_SIZE);
    expect(ensureBoard(1)).toBe(false);                         // 没过期 → 不换批，玩家看的板不会在眼前跳
    const before = useTeam.getState().dispatchBoard.map((o) => o.id);
    expect(ensureBoard(60)).toBe(true);                         // 过期 → 换批
    expect(useTeam.getState().dispatchBoard.map((o) => o.id)).not.toEqual(before);
  });

  it('ensureBoard 未建团时不铺板', () => {
    useTeam.setState({ established: false, dispatchBoard: [], boardTurn: -1 });
    expect(ensureBoard(0)).toBe(false);
    expect(useTeam.getState().dispatchBoard).toHaveLength(0);
  });

  // 玩家花 token 生成的委托板（还带看得见的奖励物品）绝不能被免费的自动板悄悄顶掉
  it('⚠ AI 生成的委托板永不自动换批（"手动生成不要自动生成"的落实）', () => {
    seedTeam(['C1']);
    const aiBoard = [{ ...offer({ id: 'ai_1' }), reward: { name: '灰烬之刃', category: '武器', gradeDesc: '暗金' } }];
    useTeam.getState().setBoard(aiBoard, 0, 'ai');
    expect(ensureBoard(999)).toBe(false);                       // 过再久也不换
    expect(useTeam.getState().dispatchBoard[0].id).toBe('ai_1');
    expect(runDispatchTick(999).boardRolled).toBe(false);        // 回合心跳也不许碰
    expect(useTeam.getState().dispatchBoard[0].reward?.name).toBe('灰烬之刃');
  });

  it('换回自动板后恢复正常到期换批', () => {
    seedTeam(['C1']);
    useTeam.getState().setBoard([offer({ id: 'ai_1' })], 0, 'ai');
    useTeam.getState().setBoard(rollOfferBoard(0, 'C', []), 0, 'auto');
    expect(useTeam.getState().boardSource).toBe('auto');
    expect(ensureBoard(60)).toBe(true);
  });
});

/* ══════════ 委托奖励物品 ══════════ */
describe('委托酬劳', () => {
  const REWARD = {
    name: '霜噬手铳', category: '武器', gradeDesc: '暗金', subType: '单手火器',
    combatStat: '攻击力 180-240', attrBonus: '敏捷+12', affix: '【霜噬】：命中附加减速',
    effect: '持握者指节常年泛着薄霜', appearance: '乌钢枪管，握把缠着灰蓝鲛皮', quantity: 1,
  };

  it('达成才发酬劳，失利不发', () => {
    let granted = 0, withheld = 0;
    for (let i = 0; i < 30; i++) {
      useItems.setState({ items: [] } as never);
      seedTeam(['C1'], { dispatchActive: rec({ id: `dr_r${i}`, memberIds: ['C1'], offer: { ...offer(), reward: REWARD } }) });
      seedNpcs([npc('C1')]);
      runDispatchTick(14);
      const l = useTeam.getState().dispatchHistory.at(-1)!.ledger!;
      const bag = useItems.getState().items;
      if (l.success) { granted++; expect(l.rewardGranted).toBe('霜噬手铳'); expect(bag).toHaveLength(1); }
      else { withheld++; expect(l.rewardGranted).toBeUndefined(); expect(bag).toHaveLength(0); }
    }
    expect(granted).toBeGreaterThan(0);
    expect(granted + withheld).toBe(30);
  });

  it('入库时字段完整铺开，且 attrBonus 并进 effect（否则 effectiveAttrs 读不到＝死数据）', () => {
    useItems.setState({ items: [] } as never);
    seedTeam(['C1'], { dispatchActive: rec({ memberIds: ['C1'], offer: { ...offer({ tier: 1, danger: 0.2 }), reward: REWARD } }) });
    seedNpcs([npc('C1')]);
    runDispatchTick(14);
    const it = useItems.getState().items[0];
    expect(it).toBeDefined();
    expect(it.name).toBe('霜噬手铳');
    expect(it.gradeDesc).toBe('暗金');
    expect(it.combatStat).toBe('攻击力 180-240');
    expect(it.affix).toContain('霜噬');
    expect(it.appearance).toContain('乌钢枪管');
    expect(it.effect).toContain('敏捷+12');            // ⚠ attrBonus 必须并进 effect
    expect(it.acquisition).toContain('冒险团委托');
  });

  it('没有 reward 的委托（自动板）达成也不发物品，不报错', () => {
    useItems.setState({ items: [] } as never);
    seedTeam(['C1'], { dispatchActive: rec({ memberIds: ['C1'], offer: offer({ tier: 1, danger: 0.2 }) }) });
    seedNpcs([npc('C1')]);
    expect(() => runDispatchTick(14)).not.toThrow();
    expect(useItems.getState().items).toHaveLength(0);
    expect(useTeam.getState().dispatchHistory.at(-1)!.ledger!.rewardGranted).toBeUndefined();
  });
});

/* ══════════ 奖励品级封顶 ══════════ */
describe('gradeForTier · 奖励品级按委托阶位封顶', () => {
  const CAPS: Record<number, string> = { 1: '紫色', 2: '暗紫色', 3: '淡金', 4: '金色', 5: '暗金', 6: '传说级', 7: '史诗级', 8: '圣灵级', 9: '不朽级' };
  const LADDER = ['白色', '绿色', '蓝色', '紫色', '暗紫色', '淡金', '金色', '暗金', '传说级', '史诗级', '圣灵级', '不朽级', '起源', '永恒', '创世'];

  it('每一阶都不越自己那档天花板（对齐世界阶·装备品质上限表）', () => {
    for (let tier = 1; tier <= 9; tier++) {
      for (let s = 0; s < 40; s++) {
        const { grade, cap } = gradeForTier(tier, makeRng(s * 7 + tier));
        expect(cap).toBe(CAPS[tier]);
        expect(LADDER.indexOf(grade)).toBeLessThanOrEqual(LADDER.indexOf(cap));
        expect(LADDER.indexOf(grade)).toBeGreaterThanOrEqual(LADDER.indexOf(cap) - 1);   // 最多下浮一档
      }
    }
  });

  it('越界阶位被夹住，不会返回 undefined 品级', () => {
    for (const t of [-3, 0, 12, 99]) {
      const { grade, cap } = gradeForTier(t, makeRng(1));
      expect(LADDER).toContain(grade);
      expect(LADDER).toContain(cap);
    }
  });
});
