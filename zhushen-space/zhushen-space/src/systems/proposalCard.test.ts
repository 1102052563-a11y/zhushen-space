import { describe, it, expect, beforeEach } from 'vitest';
import { useMisc } from '../store/miscStore';
import { useTables } from '../store/tableStore';
import { useTableJournal } from '../store/tableJournalStore';
import { useCalendar } from '../store/calendarStore';
import {
  parseProposals, stripProposalsForApi, applyProposal, proposalLines, buildAdvisorContext, type Proposal,
} from './proposalCard';
import { FORESHADOW_UID, collectStaleThreads } from './plotThreads';

const HEADER = ['', '伏笔', '埋下时间', '涉及对象', '状态', '预期回收', '说明'];

function seedTables(rows: string[][] = []) {
  useTables.setState((s) => ({
    tables: {
      ...s.tables,
      foreshadowing: { ...(s.tables as Record<string, unknown>).foreshadowing as object, uid: FORESHADOW_UID, name: '伏笔表', content: [HEADER, ...rows] },
    },
  }) as never);
}

const card = (kind: Proposal['kind'], data: Record<string, unknown>, ref?: string): Proposal =>
  ({ id: 'c0', kind, ref, data, raw: JSON.stringify(data) });

beforeEach(() => {
  seedTables([]);
  useCalendar.getState().clearAll();
  useMisc.setState({ tasks: [], worldTime: '斗罗历 2 月 17 日', worldName: '斗罗大陆', paradiseTime: '', weather: '' } as never);
});

describe('parseProposals（剥卡片）', () => {
  it('把卡片从正文里剥出来，正文只剩解释文字', () => {
    const reply = `我建议这样安排。\n<proposal kind="thread">\n{"title":"黑袍人不摘兜帽","expect":"主角认出他是旧识"}\n</proposal>\n要的话点应用。`;
    const { text, cards } = parseProposals(reply, '7');
    expect(text).toBe('我建议这样安排。\n\n要的话点应用。');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: '7#0', kind: 'thread' });
    expect(cards[0].data.title).toBe('黑袍人不摘兜帽');
  });

  it('多张卡片按出现顺序编号；ref 属性被读出', () => {
    const reply = `<proposal kind="quest" ref="T_3">{"name":"改这条"}</proposal><proposal kind='almanac'>{"name":"七夕","month":7,"day":7}</proposal>`;
    const { cards } = parseProposals(reply, 'm');
    expect(cards.map((c) => c.kind)).toEqual(['quest', 'almanac']);
    expect(cards[0].ref).toBe('T_3');
    expect(cards[1].ref).toBeUndefined();
    expect(cards.map((c) => c.id)).toEqual(['m#0', 'm#1']);
  });

  it('容忍裸键/单引号/尾逗号（走 lenientJsonParse）', () => {
    const { cards } = parseProposals(`<proposal kind="almanac">{name:'春祭', month:3, day:1,}</proposal>`);
    expect(cards[0].data).toMatchObject({ name: '春祭', month: 3, day: 1 });
  });

  it('未知 kind / JSON 坏掉 / 数组体 → 整块丢弃，不产出卡片', () => {
    expect(parseProposals(`<proposal kind="unknown">{"a":1}</proposal>`).cards).toHaveLength(0);
    expect(parseProposals(`<proposal kind="quest">这不是 JSON</proposal>`).cards).toHaveLength(0);
    expect(parseProposals(`<proposal kind="quest">[1,2]</proposal>`).cards).toHaveLength(0);
  });

  it('没有卡片时原样返回', () => {
    expect(parseProposals('就是随便聊两句')).toEqual({ text: '就是随便聊两句', cards: [] });
  });
});

describe('stripProposalsForApi（防模型照抄旧卡片）', () => {
  it('卡片块换成占位符，解释文字保留', () => {
    const s = stripProposalsForApi(`看这条：<proposal kind="quest">{"name":"甲"}</proposal>如何`);
    expect(s).not.toContain('proposal');
    expect(s).not.toContain('甲');
    expect(s).toContain('任务提案卡');
    expect(s).toContain('看这条：');
    expect(s).toContain('如何');
  });
  it('无卡片时原样', () => {
    expect(stripProposalsForApi('普通回复')).toBe('普通回复');
  });
});

describe('applyProposal（唯一写库入口）', () => {
  it('quest 新建：分配 T_ id、默认支线进行中、至少一环 active', () => {
    const r = applyProposal(card('quest', {
      name: '找回矿石', desc: '替铁匠跑腿', reward: '300 贝利',
      rings: [{ idx: 1, goal: '打听下落' }, { idx: 2, goal: '夺回来' }],
    }));
    expect(r.ok).toBe(true);
    const t = useMisc.getState().tasks[0];
    expect(t).toMatchObject({ name: '找回矿石', kind: '支线', status: '进行中' });
    expect(t.id).toMatch(/^T_\d+$/);
    expect(t.rings?.[0].status).toBe('active');
    expect(t.currentRing).toBe(1);
  });

  it('quest 带 ref：改既有任务；ref 指向不存在的任务则失败且不新建', () => {
    applyProposal(card('quest', { name: '原名' }));
    const id = useMisc.getState().tasks[0].id;
    expect(applyProposal(card('quest', { name: '新名', kind: '主线' }, id)).ok).toBe(true);
    expect(useMisc.getState().tasks).toHaveLength(1);
    expect(useMisc.getState().tasks[0]).toMatchObject({ name: '新名', kind: '主线' });

    const bad = applyProposal(card('quest', { name: 'x' }, 'T_999'));
    expect(bad.ok).toBe(false);
    expect(useMisc.getState().tasks).toHaveLength(1);
  });

  it('thread 新建：写进伏笔表，埋下时间自动取世界时间、状态默认「埋下」', () => {
    const r = applyProposal(card('thread', { title: '井底的哭声', obj: '村民', expect: '查明是怨魂' }));
    expect(r.ok).toBe(true);
    const rows = useTables.getState().tables[FORESHADOW_UID].content.slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe('井底的哭声');
    expect(rows[0][2]).toBe('斗罗历 2 月 17 日');
    expect(rows[0][4]).toBe('埋下');
    expect(rows[0][5]).toBe('查明是怨魂');
  });

  it('thread 新建必须补记编辑日志——否则账龄查无记录＝「久远」，刚埋下就被当陈债催收', () => {
    useTableJournal.setState({ entries: [] } as never);
    useMisc.setState({ turnCount: 42 } as never);
    applyProposal(card('thread', { title: '刚埋下的钩子' }));
    const rowId = useTables.getState().tables[FORESHADOW_UID].content[1][0];
    const log = useTableJournal.getState().entries.filter((e) => e.uid === FORESHADOW_UID && e.rowId === rowId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ command: 'insertRow', turn: 42 });
    // 账龄口径下它是「新鲜」的：本回合刚记，不该出现在催收清单里
    expect(collectStaleThreads(42).some((t) => t.rowId === rowId)).toBe(false);
  });

  it('thread 带 ref：按 row_id 改行；找不到就失败、不新增', () => {
    applyProposal(card('thread', { title: '甲' }));
    const rowId = useTables.getState().tables[FORESHADOW_UID].content[1][0];
    expect(applyProposal(card('thread', { title: '甲·改', state: '发展中' }, rowId)).ok).toBe(true);
    const rows = useTables.getState().tables[FORESHADOW_UID].content.slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe('甲·改');
    expect(rows[0][4]).toBe('发展中');
    expect(applyProposal(card('thread', { title: 'x' }, '999')).ok).toBe(false);
  });

  it('almanac：落 calendarStore，越界值被夹取', () => {
    expect(applyProposal(card('almanac', { name: '春祭', type: 'festival', month: 3, day: 1, days: 3, world: '斗罗大陆' })).ok).toBe(true);
    const items = useCalendar.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: '春祭', type: 'festival', month: 3, day: 1, days: 3, world: '斗罗大陆' });
  });

  it('缺必填字段一律失败，且不写任何库', () => {
    expect(applyProposal(card('quest', { desc: '没名字' })).ok).toBe(false);
    expect(applyProposal(card('thread', {})).ok).toBe(false);
    expect(applyProposal(card('almanac', { month: 1, day: 1 })).ok).toBe(false);
    expect(useMisc.getState().tasks).toHaveLength(0);
    expect(useTables.getState().tables[FORESHADOW_UID].content.slice(1)).toHaveLength(0);
    expect(useCalendar.getState().items).toHaveLength(0);
  });
});

describe('proposalLines（卡片正面）', () => {
  it('空字段自动省略，环列成一行', () => {
    const lines = proposalLines(card('quest', { name: '甲', rings: [{ goal: '一' }, { goal: '二' }] }));
    expect(lines.find((l) => l.label === '名称')?.value).toBe('甲');
    expect(lines.some((l) => l.label === '奖励')).toBe(false);
    expect(lines.find((l) => l.label === '环')?.value).toContain('1.一');
  });
  it('历卡片把类型译成中文、多日标共N天', () => {
    const lines = proposalLines(card('almanac', { name: '春祭', type: 'festival', month: 3, day: 1, days: 3 }));
    expect(lines.find((l) => l.label === '类型')?.value).toBe('节日');
    expect(lines.find((l) => l.label === '日期')?.value).toBe('3月1日（共3天）');
    expect(lines.find((l) => l.label === '归属')?.value).toBe('跨世界');
  });
});

describe('buildAdvisorContext（现状清单·带 id 供 ref 引用）', () => {
  it('列出任务 id / 伏笔 row_id / 历 id；已回收伏笔不列', () => {
    applyProposal(card('quest', { name: '入学试炼', kind: '主线' }));
    seedTables([
      ['1', '活着的伏笔', '', '', '埋下', '预期A', ''],
      ['2', '收掉的伏笔', '', '', '已回收', '', ''],
    ]);
    applyProposal(card('almanac', { name: '七夕', type: 'festival', month: 7, day: 7 }));

    const ctx = buildAdvisorContext();
    expect(ctx).toContain('斗罗大陆');
    expect(ctx).toMatch(/T_\d+｜主线「入学试炼」/);
    expect(ctx).toContain('1｜「活着的伏笔」');
    expect(ctx).not.toContain('收掉的伏笔');
    expect(ctx).toContain('7/7 节日「七夕」');
  });

  /* worldScope 铁则：一个世界一个世界玩下来，参谋若看得到别的世界的历，会据此讨论/出提案 → 串味 */
  it('★历按当前世界过滤：别的任务世界的条目不进参谋的现状清单', () => {
    const C = useCalendar.getState();
    C.applyMany([
      { name: '本世界的开炉祭', month: 2, day: 22, world: '斗罗大陆' },
      { name: '别世界的节', month: 3, day: 3, world: '海贼王' },
      { name: '跨世界的纪念日', month: 6, day: 1, world: '' },
    ]);
    const ctx = buildAdvisorContext();   // 当前 worldName = 斗罗大陆（见 beforeEach）
    expect(ctx).toContain('本世界的开炉祭');
    expect(ctx).toContain('跨世界的纪念日');
    expect(ctx).not.toContain('别世界的节');
  });

  it('★almanac 提案卡没写 world → 落库归当前世界（与手动新增同口径）', () => {
    expect(applyProposal(card('almanac', { name: '试炼日', type: 'festival', month: 2, day: 19 })).ok).toBe(true);
    expect(useCalendar.getState().items[0].world).toBe('斗罗大陆');
  });

  it('almanac 提案卡显式写 world:"" → 尊重跨世界', () => {
    applyProposal(card('almanac', { name: '主角生日', type: 'birthday', month: 4, day: 1, world: '' }));
    expect(useCalendar.getState().items[0].world).toBeUndefined();
  });

  it('全空时也给出「（无）」占位，不会拼出半截块', () => {
    const ctx = buildAdvisorContext();
    expect(ctx).toContain('【进行中任务】（无）');
    expect(ctx).toContain('【未回收伏笔】（无）');
    expect(ctx).toContain('【世界历】（无）');
  });
});
