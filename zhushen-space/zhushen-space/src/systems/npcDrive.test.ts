import { describe, it, expect } from 'vitest';
import { driveOf, isStatic, filterByDrive, EMPTY_DRIVE_CTX, type DriveCtx } from './npcDrive';
import { defaultNpcRecord, type NpcRecord } from '../store/npcStore';

function npc(id: string, patch: Partial<NpcRecord> = {}): NpcRecord {
  return { ...defaultNpcRecord(id), name: `角色${id}`, npcTag: '土著', onScene: false, ...patch };
}
const ctx = (p: Partial<DriveCtx> = {}): DriveCtx => ({ ...EMPTY_DRIVE_CTX, ...p });

describe('npcDrive · driveOf 分流', () => {
  it('在场角色恒有驱动力', () => {
    expect(driveOf(npc('C1', { onScene: true }), ctx())).toBe('scene');
  });

  it('冻结 / 归档 → 恒静滞（优先于一切）', () => {
    expect(driveOf(npc('C1', { onScene: true, frozenAt: 5 }), ctx())).toBeNull();
    expect(driveOf(npc('C2', { isBond: true, frozenAt: 5 }), ctx())).toBeNull();
    expect(driveOf(npc('C3', { archived: true, isBond: true }), ctx())).toBeNull();
  });

  it('随从/宠物/召唤物跟着主角走，恒 bond', () => {
    for (const tag of ['随从', '宠物', '召唤物']) {
      expect(driveOf(npc('C1', { npcTag: tag }), ctx())).toBe('bond');
    }
  });

  it('玩家投入过的角色 → bond', () => {
    expect(driveOf(npc('C1', { isBond: true }), ctx())).toBe('bond');
    expect(driveOf(npc('C2', { keepForever: true }), ctx())).toBe('bond');
    expect(driveOf(npc('C3', { isFriend: true }), ctx())).toBe('bond');
    expect(driveOf(npc('C4', { partyMember: true }), ctx())).toBe('bond');
    expect(driveOf(npc('C5', { isCanonLocked: true }), ctx())).toBe('bond');
  });

  it('名字出现在任务 → quest；出现在世界大事/正文 → world', () => {
    const n = npc('C1', { name: '凌薇' });
    expect(driveOf(n, ctx({ questText: '护送凌薇出城' }))).toBe('quest');
    expect(driveOf(n, ctx({ worldText: '凌薇在城南遇袭' }))).toBe('world');
    expect(driveOf(n, ctx({ narrative: '凌薇转身离去' }))).toBe('world');
  });

  it('任务优先于局势（命中即返回·优先级固定）', () => {
    const n = npc('C1', { name: '凌薇' });
    expect(driveOf(n, ctx({ questText: '找凌薇', worldText: '凌薇遇袭' }))).toBe('quest');
  });

  it('无关的离场土著 → 静滞（这就是省 token 的那一刀）', () => {
    const n = npc('C1', { name: '张铁匠' });
    expect(driveOf(n, ctx({ questText: '护送凌薇出城', worldText: '城南大火' }))).toBeNull();
    expect(isStatic(n, ctx())).toBe(true);
  });

  it('社交驱动力只给契约者，土著没有这一层', () => {
    const base = { name: '陈九', arenaRank: '第37名' };
    expect(driveOf(npc('C1', { ...base, npcTag: '契约者' }), ctx())).toBe('social');
    expect(driveOf(npc('C2', { ...base, npcTag: '土著' }), ctx())).toBeNull();
    expect(driveOf(npc('C3', { name: '陈九', npcTag: '契约者', affiliatedTeam: '暗渊远征队' }), ctx())).toBe('social');
  });

  it('单字名不参与命中（防"王""李"误命中满天飞）', () => {
    const n = npc('C1', { name: '王' });
    expect(driveOf(n, ctx({ narrative: '王城的守卫换班了' }))).toBeNull();
  });

  it('带后缀的名字只取 | 前主名', () => {
    const n = npc('C1', { name: '凌薇|队长' });
    expect(driveOf(n, ctx({ narrative: '凌薇点了点头' }))).toBe('world');
  });
});

describe('npcDrive · filterByDrive', () => {
  it('剔除静滞者并报告名单', () => {
    const list = [
      npc('C1', { name: '凌薇', onScene: true }),
      npc('C2', { name: '张铁匠' }),
      npc('C3', { name: '李掌柜', isBond: true }),
    ];
    const { passed, staticIds } = filterByDrive(list, ctx());
    expect(passed.map((n) => n.id)).toEqual(['C1', 'C3']);
    expect(staticIds).toEqual(['C2']);
  });

  it('按优先级排序后截断到 cap（在场 > 羁绊 > 任务 > 局势 > 社交）', () => {
    const list = [
      npc('C1', { name: '甲甲', npcTag: '契约者', arenaRank: '第9名' }),   // social
      npc('C2', { name: '乙乙' }),                                          // world
      npc('C3', { name: '丙丙', isBond: true }),                            // bond
      npc('C4', { name: '丁丁', onScene: true }),                           // scene
    ];
    const { passed } = filterByDrive(list, ctx({ narrative: '乙乙路过' }), 3);
    expect(passed.map((n) => n.id)).toEqual(['C4', 'C3', 'C2']);
  });

  it('cap=0 → 全部让位（但静滞名单仍如实报告）', () => {
    const list = [npc('C1', { onScene: true }), npc('C2', { name: '张铁匠' })];
    const r = filterByDrive(list, ctx(), 0);
    expect(r.passed).toEqual([]);
    expect(r.staticIds).toEqual(['C2']);
  });
});
