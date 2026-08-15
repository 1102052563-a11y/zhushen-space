// 📣 战报卡构建单测：MVP=全场输出最高、最痛一击格式、险胜标记、热度确定性。
import { describe, it, expect } from 'vitest';
import type { BattleState } from '../store/combatStore';
import { buildBattleReport, formatBattleReportContent, reportBaseHeat } from './arenaReport';

const mkState = (over: Partial<Record<string, unknown>> = {}): BattleState => ({
  round: 7,
  order: ['B1', 'C9'],
  initialState: {
    B1: { side: 'player', name: '主角', maxHp: 1000, tier: '三阶' },
    C9: { side: 'enemy', name: '血手屠夫', maxHp: 1200, tier: '三阶' },
  },
  participants: {
    B1: { curHp: 620, stats: { dealt: 1200, taken: 380 } },
    C9: { curHp: 0, stats: { dealt: 380, taken: 1200 } },
  },
  maxHit: { actorId: 'B1', targetId: 'C9', dmg: 340, label: '燃剑术' },
  log: [],
  ...over,
} as unknown as BattleState);

describe('buildBattleReport', () => {
  it('胜负/回合/MVP/最痛一击齐全', () => {
    const r = buildBattleReport({ arena: '新秀赛区', a: '主角', b: '第37名·血手屠夫', victor: 'player', state: mkState(), note: '晋升至第36名' });
    expect(r.result).toBe('A胜');
    expect(r.rounds).toBe(7);
    expect(r.mvp).toBe('主角');
    expect(r.maxHit).toContain('燃剑术');
    expect(r.maxHit).toContain('340');
    expect(r.note).toBe('晋升至第36名');
  });

  it('主角残血<15%的胜利自动补「九死一生的险胜」', () => {
    const st = mkState({ participants: { B1: { curHp: 90, stats: { dealt: 900, taken: 900 } }, C9: { curHp: 0, stats: { dealt: 900, taken: 900 } } } });
    const r = buildBattleReport({ arena: '新秀赛区', a: '主角', b: '对手', victor: 'player', state: st });
    expect(r.note).toContain('九死一生');
  });

  it('败北=B胜；无 maxHit/无输出时字段缺省', () => {
    const st = mkState({ maxHit: undefined, participants: { B1: { curHp: 0, stats: { dealt: 0, taken: 500 } }, C9: { curHp: 800, stats: { dealt: 0, taken: 0 } } } });
    const r = buildBattleReport({ arena: '新秀赛区', a: '主角', b: '对手', victor: 'enemy', state: st });
    expect(r.result).toBe('B胜');
    expect(r.maxHit).toBeUndefined();
    expect(r.mvp).toBeUndefined();
  });

  it('formatBattleReportContent 含对阵与胜者', () => {
    const txt = formatBattleReportContent({ arena: '新秀赛区', a: '主角', b: '血手屠夫', result: 'A胜', rounds: 7, mvp: '主角' });
    expect(txt).toContain('主角 VS 血手屠夫');
    expect(txt).toContain('主角 获胜');
    expect(txt).toContain('7回合');
  });

  it('reportBaseHeat：名次越高越热、讨伐固定高热、有界', () => {
    expect(reportBaseHeat('arena', 1)).toBeGreaterThan(reportBaseHeat('arena', 500));
    expect(reportBaseHeat('arena', 99999)).toBeGreaterThanOrEqual(80);
    expect(reportBaseHeat('arena', 1)).toBeLessThanOrEqual(950);
    expect(reportBaseHeat('raid')).toBe(620);
  });
});
