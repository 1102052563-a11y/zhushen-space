import { describe, it, expect, beforeEach } from 'vitest';
import { useNpc } from './npcStore';
import { useCharacters } from './characterStore';

/* 归档 NPC 被自动去重吞掉 —— 复现「归档了召唤回来不是同一个人 / 归档区为空 / 头像没了」
   三态设计：在场 / 离场(AI自动·仍追踪) / 归档(玩家显式封存·独立第三态)。归档 ≠ 删除。 */

const rich = (id: string, name: string, extra: any = {}) => ({
  id, name, onScene: false, archived: true,
  realm: '二阶|剑士', personality: '沉默寡言', background: '前神罗士兵，米德加出身',
  appearanceDetail: '金色刺猬头，蓝眼，背负破坏剑',
  items: [], deedLog: [], ...extra,
});
const freshShell = (id: string, name: string, extra: any = {}) => ({
  id, name, onScene: true, archived: false,
  realm: '二阶|剑士', personality: '沉默寡言', background: '前神罗士兵，米德加出身',
  appearanceDetail: '金色刺猬头，蓝眼，背负破坏剑',
  items: [], deedLog: [], ...extra,
});

beforeEach(() => {
  useNpc.setState({ npcs: {} });
  useCharacters.setState({ characters: {} });
});

describe('★归档 NPC vs AI 新建同名空壳（dedupeByName 留谁删谁）', () => {
  it('★归档的丰满档案 输给 新建空壳 → 被物理删除（数据丢失·复现 bug）', () => {
    // C3=玩家封存的克劳德（丰满但 onScene:false、avatar 已被 partialize 剥离）
    // C15=AI 重新提及克劳德时新建的档案（同样带 AI 生成的基础资料，但 onScene:true）
    useNpc.setState({ npcs: { C3: rich('C3', '克劳德') as any, C15: freshShell('C15', '克劳德') as any } });
    useCharacters.setState({ characters: { C3: { skills: [{ name: '限界技·凶斩' }], talents: [], titles: [], subProfessions: [] } as any } });

    useNpc.getState().dedupeByName();

    const npcs = useNpc.getState().npcs;
    const survivor = Object.values(npcs)[0] as any;
    console.log('存活者:', survivor?.id, '| 归档标记:', survivor?.archived, '| C3还在吗:', !!npcs['C3']);
    expect(Object.keys(npcs).length).toBe(1);
    expect(npcs['C3']).toBeTruthy();          // 期望：玩家封存的那份该活下来
  });

  it('★合并后归档标记被清除 → 归档区变空', () => {
    useNpc.setState({ npcs: { C3: rich('C3', '克劳德', { deedLog: [{ description: '击败萨菲罗斯' }] }) as any, C15: freshShell('C15', '克劳德') as any } });
    useNpc.getState().dedupeByName();
    const survivor = Object.values(useNpc.getState().npcs)[0] as any;
    expect(survivor.archived).toBe(true);     // 期望：玩家封存的状态不该被自动解除
  });

  it('★被删的归档档案 连 characterStore 技能/天赋一起没（不是同一个人了）', () => {
    useNpc.setState({ npcs: { C3: rich('C3', '克劳德') as any, C15: freshShell('C15', '克劳德') as any } });
    useCharacters.setState({ characters: { C3: { skills: [{ name: '限界技·凶斩' }], talents: [], titles: [], subProfessions: [] } as any } });
    useNpc.getState().dedupeByName();
    expect(useCharacters.getState().characters['C3']?.skills?.length).toBe(1);   // 期望：封存角色的技能不该被清
  });
});
