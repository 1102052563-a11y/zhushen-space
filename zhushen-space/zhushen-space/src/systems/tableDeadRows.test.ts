import { describe, it, expect, beforeEach } from 'vitest';
import { projectStoresToTables } from './tableMigrate';
import { useTables } from '../store/tableStore';
import { useNpc } from '../store/npcStore';
import { useCharacters } from '../store/characterStore';

/* 重要角色表 · 死亡角色不许整行蒸发 —— 治「重要NPC就剩这几个、其他都没了」
   表规约白纸黑字：「离场/死亡改 状态，别删」。
   旧 bug：realNpcs() 的筛选带着 `!npc.isDead` → 已死亡角色被整行过滤出投影，与规约冲突，
          也违背「数据库＝图书馆·只存不删」。
   ⚠ 加回行的同时必须保证 状态 列标明死亡：isDead 是布尔、status 是自由文本，两者可能不同步，
     只加行不标死 → AI 读表会把死人当活人写。*/

const npc = (id: string, name: string, extra: any = {}) => ({
  id, name, relations: '', favor: 0, realm: '二阶', status: '一切正常',
  personality: '', onScene: true, items: [], updatedAt: 0, ...extra,
});

beforeEach(() => {
  useTables.getState().resetAll();
  useCharacters.setState({ characters: {} } as any);
});

const rowsOf = (uid: string) => useTables.getState().rows(uid) as unknown as { 姓名: string; 状态: string }[];

describe('★重要角色表：死亡角色保留整行，只改状态', () => {
  it('★已死亡 NPC 仍在表里（旧代码这里会整行消失）', () => {
    useNpc.setState({ npcs: {
      C7: npc('C7', '蒂法·洛克哈特') as any,
      C1: npc('C1', '卡雷尔', { isDead: true, status: '一切正常' }) as any,
      C5: npc('C5', '王虎', { isDead: true, status: '被苏晓斩于城门下' }) as any,
    } } as any);
    projectStoresToTables();
    const names = rowsOf('important_characters').map((r) => r.姓名);
    expect(names).toContain('蒂法·洛克哈特');
    expect(names).toContain('卡雷尔');   // ← 旧代码：被 !isDead 过滤掉
    expect(names).toContain('王虎');
  });

  it('★状态列必定标明死亡（status 文本没写死字时强制兜底，防 AI 把死人当活人）', () => {
    useNpc.setState({ npcs: {
      C1: npc('C1', '卡雷尔', { isDead: true, status: '一切正常' }) as any,
    } } as any);
    projectStoresToTables();
    const r = rowsOf('important_characters').find((x) => x.姓名 === '卡雷尔')!;
    expect(r.状态).toContain('已死亡');          // 强制标明
    expect(r.状态).toContain('一切正常');        // 原状态作补充、不丢
  });

  it('状态文本已明确表示死亡 → 照原文，不画蛇添足', () => {
    useNpc.setState({ npcs: {
      C5: npc('C5', '王虎', { isDead: true, status: '已死亡·被斩于城门下' }) as any,
    } } as any);
    projectStoresToTables();
    const r = rowsOf('important_characters').find((x) => x.姓名 === '王虎')!;
    expect(r.状态).toBe('已死亡·被斩于城门下');
  });

  it('活人状态不受影响', () => {
    useNpc.setState({ npcs: { C7: npc('C7', '蒂法·洛克哈特', { status: '深度睡眠' }) as any } } as any);
    projectStoresToTables();
    const r = rowsOf('important_characters').find((x) => x.姓名 === '蒂法·洛克哈特')!;
    expect(r.状态).toBe('深度睡眠');
  });

  it('无名编号空壳仍然不进表（只放宽死亡，没把筛选整个拆掉）', () => {
    useNpc.setState({ npcs: {
      C7: npc('C7', '蒂法·洛克哈特') as any,
      C9: npc('C9', 'C9') as any,   // 占位名空壳
    } } as any);
    projectStoresToTables();
    const names = rowsOf('important_characters').map((r) => r.姓名);
    expect(names).toContain('蒂法·洛克哈特');
    expect(names).not.toContain('C9');
  });
});
