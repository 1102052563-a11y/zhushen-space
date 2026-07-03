import { describe, it, expect, beforeEach } from 'vitest';
import {
  npcNorm, npcRegister, npcRemove, npcCoreRoster, npcCoreReset, npcCoreSnapshot, npcCoreRestore,
  reconcileNpcs, seedNpcsIfEmpty, npcDiagnostics,
} from './npcCore';

beforeEach(() => { npcCoreReset(); });

describe('NPC 事件核心 npcCore（Step 10·溯源审计 + store-based 对账）', () => {
  it('npcNorm：去空白+小写', () => {
    expect(npcNorm(' 弗利萨 ')).toBe(npcNorm('弗利萨'));
  });

  it('register 登记真名 NPC（带来源）；幽灵（名===id）忽略', () => {
    npcRegister('弗利萨', 'C1', 'upsert', 7);
    npcRegister('C11', 'C11', 'upsert', 7);   // 名===id 幽灵 → 忽略
    const roster = npcCoreRoster();
    expect(roster[npcNorm('弗利萨')]).toMatchObject({ name: '弗利萨', id: 'C1', source: 'upsert', turn: 7 });
    expect(roster[npcNorm('C11')]).toBeUndefined();
  });

  it('register 幂等：同真名保首建来源（重入不覆盖）', () => {
    npcRegister('苏晓', 'C1', 'narrative', 1);
    npcRegister('苏晓', 'C2', 'party', 5);   // 同名重入 → roster 仍是首建
    expect(npcCoreRoster()[npcNorm('苏晓')]).toMatchObject({ id: 'C1', source: 'narrative' });
  });

  it('★reconcile 抓幽灵（编号无真名）', () => {
    const v = reconcileNpcs({ C11: { id: 'C11', name: 'C11' }, C1: { id: 'C1', name: '张三' } });
    expect(v.some((x) => /幽灵/.test(x))).toBe(true);
  });

  it('★reconcile 抓重复建档（同真名多 id）+ 带首建来源', () => {
    npcRegister('弗利萨', 'C1', '登场判断', 3);   // 先登记首建源
    const v = reconcileNpcs({
      C1: { id: 'C1', name: '弗利萨' },
      C2: { id: 'C2', name: '弗利萨' },   // 重复建档
    });
    const dup = v.find((x) => /重复建档/.test(x));
    expect(dup).toBeTruthy();
    expect(dup).toMatch(/首建源：登场判断/);   // 溯源审计：告诉你重复的那个名字最初谁建的
  });

  it('reconcile 抓 id 不一致', () => {
    const v = reconcileNpcs({ C1: { id: 'C9', name: '张三' } });
    expect(v.some((x) => /id 不一致/.test(x))).toBe(true);
  });

  it('reconcile 干净态无违规；死亡 NPC 不计重复', () => {
    expect(reconcileNpcs({ C1: { id: 'C1', name: '张三' } })).toEqual([]);
    // 一活一死同名 → 不算重复建档
    expect(reconcileNpcs({ C1: { id: 'C1', name: '李四' }, C2: { id: 'C2', name: '李四', isDead: true } })).toEqual([]);
  });

  it('seedNpcsIfEmpty：核心空时从 npcStore 播种真名', () => {
    const seeded = seedNpcsIfEmpty({ C1: { id: 'C1', name: '张三' }, C9: { id: 'C9', name: 'C9' } });
    expect(seeded).toBe(true);
    expect(npcCoreRoster()[npcNorm('张三')]).toBeTruthy();
    expect(npcCoreRoster()[npcNorm('C9')]).toBeUndefined();   // 幽灵不播种
    expect(seedNpcsIfEmpty({ C2: { id: 'C2', name: '别人' } })).toBe(false);   // 已非空 → 不再播种
  });

  it('npcDiagnostics：一次性对账', () => {
    const d = npcDiagnostics({ C11: { id: 'C11', name: 'C11' } });
    expect(d.ok).toBe(false);
    expect(d.violations.some((x) => /幽灵/.test(x))).toBe(true);
  });

  it('remove 从 roster 删名', () => {
    npcRegister('要走的', 'C1', 'upsert', 1);
    npcRemove('要走的');
    expect(npcCoreRoster()[npcNorm('要走的')]).toBeUndefined();
  });

  it('★快照往返（读档）：roster 恢复', () => {
    npcRegister('英灵', 'C1', 'monument', 2);
    const snap = JSON.parse(JSON.stringify(npcCoreSnapshot()));
    npcCoreReset();
    expect(npcCoreRoster()[npcNorm('英灵')]).toBeUndefined();
    npcCoreRestore(snap);
    expect(npcCoreRoster()[npcNorm('英灵')]).toMatchObject({ source: 'monument' });
  });
});
