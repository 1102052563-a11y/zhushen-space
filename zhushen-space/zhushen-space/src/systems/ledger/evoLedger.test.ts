import { describe, it, expect, beforeEach } from 'vitest';
import { evoPayloadName, charRef, npcRef, charDigest, npcDigest, buildEvoFeedback, type EvoResult } from './evoLedger';
import { useLedger } from './ledgerStore';
import { applyCharacterCommands, applyNpcCommands, applyFactionCommands } from '../stateParser';
import { useCharacters } from '../../store/characterStore';
import { useNpc } from '../../store/npcStore';
import { useFaction } from '../../store/factionStore';

const charCmd = (type: string, charId: string, payload: unknown) => ({ type: type as any, charId, payload, raw: '' });
const npcCmd = (type: string, id: string, payload?: any) => ({ type: type as any, id, payload, raw: '' });
const facCmd = (type: string, id: string, payload?: any) => ({ type: type as any, id, payload, raw: '' });

describe('evoLedger 纯函数', () => {
  it('evoPayloadName 从对象/字符串取名', () => {
    expect(evoPayloadName({ name: '火球术' })).toBe('火球术');
    expect(evoPayloadName({ '1': '寒冰刺' })).toBe('寒冰刺');
    expect(evoPayloadName('剑气')).toBe('剑气');
  });

  it('charDigest 全等才同（不同字段→不同指纹，交给 store 合并）', () => {
    const a = charDigest('addSkill', 'B1', { name: '火球术', level: 'Lv.1' });
    const b = charDigest('addSkill', 'B1', { name: '火球术', level: 'Lv.1' });
    const c = charDigest('addSkill', 'B1', { name: '火球术', level: 'Lv.2' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('npcDigest 全等才同；ref 带名便于审计', () => {
    expect(npcDigest('add', 'C1', { '1': '小明', '12': '友好' })).toBe(npcDigest('add', 'C1', { '1': '小明', '12': '友好' }));
    expect(npcDigest('add', 'C1', { '1': '小明', '12': '友好' })).not.toBe(npcDigest('add', 'C1', { '1': '小明', '12': '敌对' }));
    expect(charRef('B1', { name: '火球术' })).toBe('B1:火球术');
    expect(npcRef('C1', { '1': '小明|男' })).toBe('C1:小明');
  });

  it('buildEvoFeedback 汇总失败项，无失败返回空', () => {
    expect(buildEvoFeedback([{ ok: true, entity: 'char', op: 'addSkill', ref: 'B1:x' }], '角色')).toBe('');
    const fb = buildEvoFeedback([{ ok: false, entity: 'char', op: 'deSkill', ref: 'B1:幻影剑', reason: 'not_found' }], '主角技能');
    expect(fb).toContain('幻影剑');
    expect(fb).toContain('不存在');
  });
});

describe('applyCharacterCommands 闸门（角色·第1期）', () => {
  beforeEach(() => {
    useCharacters.setState({ characters: {} });
    useLedger.getState().clear();
  });

  it('★同批次重复 addSkill → 第二条记 dup，只入一条', () => {
    const res = applyCharacterCommands([
      charCmd('addSkill', 'B1', { name: '火球术', level: 'Lv.1' }),
      charCmd('addSkill', 'B1', { name: '火球术', level: 'Lv.1' }),
    ]);
    expect(res[1].skipped).toBe(true);
    expect(res[1].reason).toBe('dup');
    expect(useCharacters.getState().characters['B1']?.skills.filter((s) => s.name === '火球术').length).toBe(1);
  });

  it('★deSkill 不存在的技能 → 结构化失败(not_found)', () => {
    applyCharacterCommands([charCmd('addSkill', 'B1', { name: '火球术' })]);
    const res = applyCharacterCommands([charCmd('deSkill', 'B1', '并不存在的技能')]);
    expect(res[0].ok).toBe(false);
    expect(res[0].reason).toBe('not_found');
    expect(useCharacters.getState().characters['B1']?.skills.length).toBe(1);   // 没误删
  });

  it('deSkill 已有技能 → 正常移除(applied)', () => {
    applyCharacterCommands([charCmd('addSkill', 'B1', { name: '火球术' })]);
    const res = applyCharacterCommands([charCmd('deSkill', 'B1', '火球术')]);
    expect(res[0].ok).toBe(true);
    expect(useCharacters.getState().characters['B1']?.skills.length).toBe(0);
  });

  it('账本记录 entity=char', () => {
    applyCharacterCommands([charCmd('addSkill', 'B1', { name: '裂空斩' })], undefined, { source: 'player-phase', turn: 3 });
    const evs = useLedger.getState().eventsOfTurn(3).filter((e) => e.entity === 'char');
    expect(evs.length).toBeGreaterThan(0);
    expect(evs[0].outcome).toBe('applied');
  });
});

describe('applyNpcCommands 闸门（NPC·第1期）', () => {
  beforeEach(() => {
    useNpc.setState({ npcs: {} } as any);
    useLedger.getState().clear();
  });

  it('同批次重复 add 同一 NPC 同载荷 → 第二条 dup', () => {
    const res = applyNpcCommands([
      npcCmd('add', 'C1', { '1': '小明', '12': '友好' }),
      npcCmd('add', 'C1', { '1': '小明', '12': '友好' }),
    ], { source: 'npc-phase', turn: 5 });
    expect(res[0].ok).toBe(true);
    expect(res[1].skipped).toBe(true);
    expect(res[1].reason).toBe('dup');
  });

  it('不同列的 add 不去重（避免吞掉后续更新）', () => {
    const res = applyNpcCommands([
      npcCmd('add', 'C1', { '1': '小明', '12': '友好' }),
      npcCmd('add', 'C1', { '1': '小明', '12': '敌对' }),
    ]);
    expect(res[0].ok).toBe(true);
    expect(res[1].skipped).toBeUndefined();
  });

  it('账本记录 entity=npc', () => {
    applyNpcCommands([npcCmd('add', 'C2', { '1': '阿强' })], { source: 'npc-phase', turn: 8 });
    const evs = useLedger.getState().eventsOfTurn(8).filter((e) => e.entity === 'npc');
    expect(evs.length).toBe(1);
    expect(evs[0].ref).toBe('C2:阿强');
  });
});

describe('applyFactionCommands 闸门（势力·第2期）', () => {
  beforeEach(() => {
    useFaction.setState({ factions: {} } as any);
    useLedger.getState().clear();
  });

  it('★同批次重复 add 同势力同载荷 → 第二条 dup，首条 applied', () => {
    const res = applyFactionCommands([
      facCmd('add', 'F1', { '1': '青云宗', '3': '修真门派' }),
      facCmd('add', 'F1', { '1': '青云宗', '3': '修真门派' }),
    ], { source: 'faction-phase', turn: 2 });
    expect(res[0].ok).toBe(true);
    expect(res[1].skipped).toBe(true);
    expect(res[1].reason).toBe('dup');
  });

  it('不同列的 add 不去重', () => {
    const res = applyFactionCommands([
      facCmd('add', 'F1', { '1': '青云宗', '3': '正派' }),
      facCmd('add', 'F1', { '1': '青云宗', '3': '魔道' }),
    ]);
    expect(res[1].skipped).toBeUndefined();
  });

  it('账本记录 entity=faction', () => {
    applyFactionCommands([facCmd('add', 'F2', { '1': '血煞盟' })], { source: 'faction-phase', turn: 4 });
    const evs = useLedger.getState().eventsOfTurn(4).filter((e) => e.entity === 'faction');
    expect(evs.length).toBe(1);
    expect(evs[0].ref).toBe('F2:血煞盟');
  });
});
