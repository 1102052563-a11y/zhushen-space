import { describe, it, expect, beforeEach } from 'vitest';
import { useTables } from '../store/tableStore';
import { useTableJournal } from '../store/tableJournalStore';
import { useMisc } from '../store/miscStore';
import { applyMiscCommands } from './miscParser';
import {
  collectStaleThreads, buildForeshadowDunning, buildTruthReinforcement, buildPlotGuardInjection,
  DUN_AGE, DUN_URGENT_AGE, DUN_MAX, TRUTH_PERIOD,
} from './plotThreads';

/* 伏笔表行结构：[row_id, 伏笔, 埋下时间, 涉及对象, 状态, 预期回收, 说明]（content[0] 为表头行） */
const HEADER = ['', '伏笔', '埋下时间', '涉及对象', '状态', '预期回收', '说明'];
const row = (id: string, title: string, state: string, expect = ''): string[] => [id, title, '第1章', '某人', state, expect, ''];

function seedForeshadow(rows: string[][]) {
  useTables.setState((s) => ({
    tables: {
      ...s.tables,
      foreshadowing: { ...(s.tables as Record<string, unknown>).foreshadowing as object, uid: 'foreshadowing', name: '伏笔表', content: [HEADER, ...rows] },
    },
  }) as never);
}
function seedJournal(list: { rowId: string; turn: number }[]) {
  useTableJournal.setState({
    entries: list.map((e, i) => ({
      id: i + 1, turn: e.turn, uid: 'foreshadowing', sheetName: '伏笔表',
      command: 'updateRow' as const, rowId: e.rowId, pos: 0, before: null, after: null,
    })),
  });
}

beforeEach(() => {
  seedForeshadow([]);
  seedJournal([]);
  useMisc.setState({ truths: [] } as never);
});

describe('伏笔催收 collectStaleThreads / buildForeshadowDunning', () => {
  it('新鲜线头（账龄 < DUN_AGE）不催；无陈旧则整块为空串', () => {
    seedForeshadow([row('1', '黑袍人不摘兜帽', '埋下', '真身是未来主角')]);
    seedJournal([{ rowId: '1', turn: 20 }]);
    expect(collectStaleThreads(20 + DUN_AGE - 1)).toHaveLength(0);
    expect(buildForeshadowDunning(20 + DUN_AGE - 1)).toBe('');
  });

  it('已回收/已废弃不催（即便账龄很老）', () => {
    seedForeshadow([row('1', '旧线', '已回收'), row('2', '弃线', '已废弃')]);
    seedJournal([{ rowId: '1', turn: 1 }, { rowId: '2', turn: 1 }]);
    expect(collectStaleThreads(100)).toHaveLength(0);
  });

  it('★账龄 ≥DUN_AGE 开始催收：含行号/标题/账龄/预期回收，未到 URGENT 无废弃建议', () => {
    seedForeshadow([row('3', '神秘刀疤', '发展中', '刀疤来自宿敌')]);
    seedJournal([{ rowId: '3', turn: 10 }]);
    const txt = buildForeshadowDunning(10 + DUN_AGE + 5);   // 账龄 20
    expect(txt).toContain('<伏笔催收>');
    expect(txt).toContain('[3]「神秘刀疤」');
    expect(txt).toContain(`已 ${DUN_AGE + 5} 回合`);
    expect(txt).toContain('预期回收：刀疤来自宿敌');
    expect(txt).not.toContain('已废弃」**');
  });

  it('★账龄 ≥DUN_URGENT_AGE 升级措辞（建议明确废弃）', () => {
    seedForeshadow([row('4', '老债', '埋下')]);
    seedJournal([{ rowId: '4', turn: 1 }]);
    expect(buildForeshadowDunning(1 + DUN_URGENT_AGE)).toContain('建议本回合直接标「已废弃」');
  });

  it('★日志无记录（超出留存期）按「久远」催收且视为最紧急', () => {
    seedForeshadow([row('5', '远古之谜', '埋下'), row('6', '近期线', '埋下')]);
    seedJournal([{ rowId: '6', turn: 5 }]);   // 5 号无任何日志
    const list = collectStaleThreads(5 + DUN_AGE);
    expect(list[0].rowId).toBe('5');          // 久远排最前
    expect(list[0].age).toBeNull();
    expect(buildForeshadowDunning(5 + DUN_AGE)).toContain('久远');
  });

  it('超过 DUN_MAX 截断并注明剩余条数', () => {
    seedForeshadow(Array.from({ length: DUN_MAX + 2 }, (_, i) => row(String(i + 1), `线头${i + 1}`, '埋下')));
    const txt = buildForeshadowDunning(100);   // 全部无日志=久远
    expect(txt).toContain(`另有 2 条较陈旧未列出`);
    expect((txt.match(/- \[/g) ?? []).length).toBe(DUN_MAX);
  });

  it('状态留空视为未回收、照常催收（AI 忘填状态不逃账）', () => {
    seedForeshadow([row('7', '无状态线', '')]);
    expect(collectStaleThreads(50)).toHaveLength(1);
  });
});

describe('世界真相周期强化 buildTruthReinforcement', () => {
  it('仅在 TRUTH_PERIOD 整数倍回合且清单非空时出块', () => {
    useMisc.setState({ truths: ['主角失去左眼', '凯莉知道主角是契约者'] } as never);
    const txt = buildTruthReinforcement(TRUTH_PERIOD * 2);
    expect(txt).toContain('<世界真相·重申>');
    expect(txt).toContain('1. 主角失去左眼');
    expect(txt).toContain('2. 凯莉知道主角是契约者');
    expect(buildTruthReinforcement(TRUTH_PERIOD * 2 + 1)).toBe('');   // 非周期回合
    useMisc.setState({ truths: [] } as never);
    expect(buildTruthReinforcement(TRUTH_PERIOD)).toBe('');            // 空清单
  });

  it('turn=0 不出块（开局无重申）', () => {
    useMisc.setState({ truths: ['某事实'] } as never);
    expect(buildTruthReinforcement(0)).toBe('');
  });
});

describe('组装 buildPlotGuardInjection', () => {
  it('两块各自独立出现；均为 system 角色；异常时返回空数组不抛', () => {
    seedForeshadow([row('8', '悬线', '埋下')]);
    useMisc.setState({ truths: ['铁律：本界灵力枯竭'] } as never);
    const both = buildPlotGuardInjection(TRUTH_PERIOD * 5);   // 周期回合 + 有陈旧线头（无日志=久远）
    expect(both).toHaveLength(2);
    expect(both.every((b) => b.role === 'system')).toBe(true);
    expect(both[0].content).toContain('伏笔催收');
    expect(both[1].content).toContain('世界真相');
    const only = buildPlotGuardInjection(TRUTH_PERIOD * 5 + 1);   // 非周期回合 → 只剩催收
    expect(only).toHaveLength(1);
  });
});

describe('miscParser truths(...) 指令', () => {
  it('★覆盖式落库＋裁剪 12 条＋去空白；非数组静默忽略', () => {
    applyMiscCommands('<upstore>\ntruths(["甲乙誓约未偿", "  ", "主角右臂机械义肢"])\n</upstore>');
    expect(useMisc.getState().truths).toEqual(['甲乙誓约未偿', '主角右臂机械义肢']);

    const fourteen = JSON.stringify(Array.from({ length: 14 }, (_, i) => `事实${i + 1}`));
    applyMiscCommands(`<upstore>\ntruths(${fourteen})\n</upstore>`);
    expect(useMisc.getState().truths).toHaveLength(12);

    applyMiscCommands('<upstore>\ntruths("不是数组")\n</upstore>');
    expect(useMisc.getState().truths).toHaveLength(12);   // 未被破坏
  });
});
