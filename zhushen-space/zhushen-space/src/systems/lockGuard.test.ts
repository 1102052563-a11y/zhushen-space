import { describe, it, expect, beforeEach } from 'vitest';
import { revertSetWithLocks } from './driftGuard';
import { useLocks, lkNpcAttr, lkNpcField } from '../store/lockStore';

describe('revertSetWithLocks 字段级锁定的退回集（数据库引入①核心）', () => {
  const base = { effect: 'A', grade: '蓝', level: 1 };
  const cur = { effect: 'B', grade: '蓝', level: 2 };   // effect/level 变了，grade 没变
  const fields = ['effect', 'grade', 'level'];

  it('无据 → 退回所有漂移字段（锁不锁都退）', () => {
    expect(revertSetWithLocks(base, cur, fields, false, () => false).sort()).toEqual(['effect', 'level']);
  });

  it('有据 + 无锁 → 一个都不退（尊重合法演化）', () => {
    expect(revertSetWithLocks(base, cur, fields, true, () => false)).toEqual([]);
  });

  it('★有据 + 锁了 effect → 只退 effect（锁无视"有正文理由"）', () => {
    expect(revertSetWithLocks(base, cur, fields, true, (f) => f === 'effect')).toEqual(['effect']);
  });

  it('有据 + 锁了 grade（但 grade 没变）→ 不退（锁只对"真的变了的"字段生效）', () => {
    expect(revertSetWithLocks(base, cur, fields, true, (f) => f === 'grade')).toEqual([]);
  });

  it('基线为空的字段不算漂移（首次补全放行，锁也不挡补全）', () => {
    expect(revertSetWithLocks({ effect: '' }, { effect: 'X' }, ['effect'], false, () => false)).toEqual([]);
  });
});

describe('useLocks 锁存储', () => {
  beforeEach(() => useLocks.getState().clearLocks());

  it('lock / isLocked / unlock / toggle', () => {
    const k = lkNpcAttr('C1', 'con');
    expect(useLocks.getState().isLocked(k)).toBe(false);
    useLocks.getState().lock(k);
    expect(useLocks.getState().isLocked(k)).toBe(true);
    useLocks.getState().toggle(k);
    expect(useLocks.getState().isLocked(k)).toBe(false);   // toggle 关
    useLocks.getState().toggle(k);
    expect(useLocks.getState().isLocked(k)).toBe(true);    // toggle 开
    useLocks.getState().unlock(k);
    expect(useLocks.getState().isLocked(k)).toBe(false);
  });

  it('locksWithPrefix 列出某实体的全部锁', () => {
    const s = useLocks.getState();
    s.lock(lkNpcAttr('C1', 'con'));
    s.lock(lkNpcField('C1', 'appearanceDetail'));
    s.lock(lkNpcAttr('C2', 'str'));
    expect(useLocks.getState().locksWithPrefix('npc:C1:').length).toBe(2);
    expect(useLocks.getState().locksWithPrefix('npc:C2:').length).toBe(1);
  });
});
