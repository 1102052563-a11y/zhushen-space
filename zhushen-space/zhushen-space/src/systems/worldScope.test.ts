import { describe, it, expect, beforeEach } from 'vitest';
import {
  isHomeWorld, sameWorld, scopeOfNpc, isActiveIn,
  freezeWorld, thawWorld, reconcileWorldScope, activeNpcs, frozenNpcsByWorld,
} from './worldScope';
import { defaultNpcRecord, useNpc, type NpcRecord } from '../store/npcStore';
import { useFaction, defaultFaction, type FactionRecord } from '../store/factionStore';

function npc(id: string, patch: Partial<NpcRecord>): NpcRecord {
  return { ...defaultNpcRecord(id), name: `角色${id}`, npcTag: '土著', onScene: false, ...patch };
}
function faction(id: string, patch: Partial<FactionRecord>): FactionRecord {
  return { ...defaultFaction(id), name: `势力${id}`, ...patch };
}
function seed(npcs: NpcRecord[], factions: FactionRecord[] = []) {
  useNpc.setState({ npcs: Object.fromEntries(npcs.map((n) => [n.id, n])) } as never);
  useFaction.setState({ factions: Object.fromEntries(factions.map((f) => [f.id, f])) } as never);
}
const rec = (id: string) => useNpc.getState().npcs[id];

beforeEach(() => seed([], []));

describe('worldScope · 判定原语', () => {
  it('isHomeWorld 认三种乐园写法，任务世界为 false', () => {
    expect(isHomeWorld('轮回乐园')).toBe(true);
    expect(isHomeWorld('专属房间')).toBe(true);
    expect(isHomeWorld('主神空间')).toBe(true);
    expect(isHomeWorld('丧尸围城')).toBe(false);
    expect(isHomeWorld(undefined)).toBe(false);
  });

  it('sameWorld 走归一比对（吃空白/装饰符/大小写），空值不匹配', () => {
    expect(sameWorld('丧尸围城', '丧尸·围城')).toBe(true);
    expect(sameWorld('Dead City', 'deadcity')).toBe(true);
    expect(sameWorld('丧尸围城', '永夜监狱')).toBe(false);
    expect(sameWorld('', '丧尸围城')).toBe(false);   // 空 = 未归属，不算同世界
    expect(sameWorld(undefined, undefined)).toBe(false);
  });

  it('scopeOfNpc：只有土著绑世界，契约者/随从/宠物跟着主角走', () => {
    expect(scopeOfNpc({ npcTag: '土著' })).toBe('world');
    expect(scopeOfNpc({ npcTag: '契约者' })).toBe('paradise');
    expect(scopeOfNpc({ npcTag: '随从' })).toBe('paradise');
    expect(scopeOfNpc({ npcTag: '宠物' })).toBe('paradise');
    expect(scopeOfNpc({ npcTag: undefined })).toBe('paradise');
  });

  it('isActiveIn：冻结即不活跃；无归属视为活跃', () => {
    expect(isActiveIn({ worldName: '丧尸围城' }, '丧尸围城')).toBe(true);
    expect(isActiveIn({ worldName: '丧尸围城' }, '永夜监狱')).toBe(false);
    expect(isActiveIn({ worldName: '丧尸围城', frozenAt: 5 }, '丧尸围城')).toBe(false);
    expect(isActiveIn({}, '丧尸围城')).toBe(true);
  });
});

describe('worldScope · freezeWorld', () => {
  it('冻结本世界土著：打 frozenAt + 强制离场；契约者/随从不动', () => {
    seed([
      npc('C1', { worldName: '丧尸围城', onScene: true }),
      npc('C2', { worldName: '丧尸围城' }),
      npc('C3', { npcTag: '契约者', worldName: '丧尸围城' }),
      npc('C4', { npcTag: '随从', worldName: '丧尸围城' }),
    ]);
    const r = freezeWorld('丧尸围城', 12);
    expect(r.npcFrozen.sort()).toEqual(['C1', 'C2']);
    expect(rec('C1').frozenAt).toBe(12);
    expect(rec('C1').onScene).toBe(false);          // 不变量：frozenAt ⟹ !onScene
    expect(rec('C3').frozenAt).toBeUndefined();     // 契约者跨世界跟着走
    expect(rec('C4').frozenAt).toBeUndefined();
  });

  it('别的世界的土著、以及无归属的离场土著，都不冻（宁漏勿误）', () => {
    seed([
      npc('C1', { worldName: '永夜监狱' }),
      npc('C2', { worldName: undefined }),
    ]);
    const r = freezeWorld('丧尸围城', 12);
    expect(r.npcFrozen).toEqual([]);
    expect(rec('C1').frozenAt).toBeUndefined();
    expect(rec('C2').frozenAt).toBeUndefined();
  });

  it('老存档迁移：在场但无 worldName 的土著 → 补写归属后再冻', () => {
    seed([npc('C1', { worldName: undefined, onScene: true })]);
    const r = freezeWorld('丧尸围城', 12);
    expect(r.npcBackfilled).toEqual(['C1']);
    expect(rec('C1').worldName).toBe('丧尸围城');
    expect(rec('C1').frozenAt).toBe(12);
  });

  it('玩家投入过的角色永不冻（羁绊/永久保留/好友/临时队友/原著锁）', () => {
    seed([
      npc('C1', { worldName: '丧尸围城', isBond: true }),
      npc('C2', { worldName: '丧尸围城', keepForever: true }),
      npc('C3', { worldName: '丧尸围城', isFriend: true }),
      npc('C4', { worldName: '丧尸围城', partyMember: true }),
      npc('C5', { worldName: '丧尸围城', isCanonLocked: true }),
    ]);
    const r = freezeWorld('丧尸围城', 12);
    expect(r.npcFrozen).toEqual([]);
    expect(r.npcKept.sort()).toEqual(['C1', 'C2', 'C3', 'C4', 'C5']);
  });

  it('乐园不冻结（那是 paradise 作用域的家）', () => {
    seed([npc('C1', { worldName: '轮回乐园', onScene: true })]);
    expect(freezeWorld('轮回乐园', 12).npcFrozen).toEqual([]);
    expect(rec('C1').frozenAt).toBeUndefined();
  });

  it('势力：只关"明确属于本世界且仍在当前世界"的；worldName 为空的不动（可能是乐园势力）', () => {
    seed([], [
      faction('F1', { worldName: '丧尸围城', inCurrentWorld: true }),
      faction('F2', { worldName: '永夜监狱', inCurrentWorld: true }),
      faction('F3', { worldName: '', inCurrentWorld: true }),
      faction('F4', { worldName: '丧尸围城', inCurrentWorld: false }),
    ]);
    const r = freezeWorld('丧尸围城', 12);
    expect(r.factionsClosed).toEqual(['F1']);
    expect(useFaction.getState().factions.F2.inCurrentWorld).toBe(true);
    expect(useFaction.getState().factions.F3.inCurrentWorld).toBe(true);
  });

  it('幂等：连冻两次不改变已冻的回合号', () => {
    seed([npc('C1', { worldName: '丧尸围城' })]);
    freezeWorld('丧尸围城', 12);
    const r2 = freezeWorld('丧尸围城', 99);
    expect(r2.npcFrozen).toEqual([]);
    expect(rec('C1').frozenAt).toBe(12);
  });
});

describe('worldScope · thawWorld（同名再入选「继承」）', () => {
  it('冻结 → 解冻 往返一致：清掉 frozenAt，但不自动拉回在场', () => {
    seed([npc('C1', { worldName: '丧尸围城', onScene: true })],
      [faction('F1', { worldName: '丧尸围城', inCurrentWorld: true })]);
    freezeWorld('丧尸围城', 12);
    const t = thawWorld('丧尸围城');
    expect(t.npcThawed).toEqual(['C1']);
    expect(t.factionsReopened).toEqual(['F1']);
    expect(rec('C1').frozenAt).toBeUndefined();
    expect(rec('C1').worldName).toBe('丧尸围城');   // 归属保留
    expect(rec('C1').onScene).toBe(false);          // 登场仍走登场判断，不由解冻代劳
  });

  it('只解冻同名世界的，别的世界仍冻着', () => {
    seed([npc('C1', { worldName: '丧尸围城' }), npc('C2', { worldName: '永夜监狱' })]);
    freezeWorld('丧尸围城', 12);
    freezeWorld('永夜监狱', 12);
    thawWorld('丧尸围城');
    expect(rec('C1').frozenAt).toBeUndefined();
    expect(rec('C2').frozenAt).toBe(12);
  });

  it('已覆灭的势力不因解冻复活', () => {
    seed([], [faction('F1', { worldName: '丧尸围城', inCurrentWorld: false, isDestroyed: true })]);
    expect(thawWorld('丧尸围城').factionsReopened).toEqual([]);
  });
});

describe('worldScope · reconcileWorldScope（每回合兜底）', () => {
  it('人在乐园：所有任务世界土著都被补冻', () => {
    seed([
      npc('C1', { worldName: '丧尸围城' }),
      npc('C2', { worldName: '永夜监狱' }),
      npc('C3', { npcTag: '契约者', worldName: '丧尸围城' }),
    ]);
    const r = reconcileWorldScope('轮回乐园', 20);
    expect(r.npcFrozen.sort()).toEqual(['C1', 'C2']);
    expect(rec('C3').frozenAt).toBeUndefined();
  });

  it('人在任务世界 B：A 的土著被冻，B 的不动', () => {
    seed([npc('C1', { worldName: '丧尸围城' }), npc('C2', { worldName: '永夜监狱', onScene: true })]);
    const r = reconcileWorldScope('永夜监狱', 20);
    expect(r.npcFrozen).toEqual(['C1']);
    expect(rec('C2').frozenAt).toBeUndefined();
    expect(rec('C2').onScene).toBe(true);
  });

  it('无归属的土著永不被兜底冻（老存档安全）', () => {
    seed([npc('C1', { worldName: undefined })]);
    expect(reconcileWorldScope('轮回乐园', 20).npcFrozen).toEqual([]);
  });
});

describe('worldScope · 视图辅助', () => {
  it('activeNpcs 剔除冻结；frozenNpcsByWorld 按世界分组', () => {
    seed([
      npc('C1', { worldName: '丧尸围城' }),
      npc('C2', { worldName: '永夜监狱' }),
      npc('C3', { npcTag: '契约者' }),
    ]);
    freezeWorld('丧尸围城', 12);
    freezeWorld('永夜监狱', 12);
    expect(activeNpcs().map((n) => n.id)).toEqual(['C3']);
    const g = frozenNpcsByWorld();
    expect(Object.keys(g).sort()).toEqual(['丧尸围城', '永夜监狱']);
    expect(g['丧尸围城'].map((n) => n.id)).toEqual(['C1']);
  });
});
