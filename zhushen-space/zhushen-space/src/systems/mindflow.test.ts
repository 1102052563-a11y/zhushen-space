import { describe, it, expect } from 'vitest';
import { buildMindflowBlock, sanitizeMindflowReply, pickMindflowTargets, buildMindflowMessages } from './mindflow';
import type { NpcRecord } from '../store/npcStore';

const mkNpc = (p: Partial<NpcRecord>): NpcRecord => ({
  id: 'C1', name: '蕾姆', onScene: true, isDead: false, archived: false,
  gender: '女', personality: '沉静', relations: '', favor: 10,
  ...p,
} as unknown as NpcRecord);

describe('pickMindflowTargets', () => {
  it('只取在场角色，按候选排序截断到 max', () => {
    const npcs = [
      mkNpc({}),
      { ...mkNpc({}), id: 'C2', name: '韩立', onScene: false },
      { ...mkNpc({}), id: 'C3', name: '灰袍老者', onScene: true },
      { ...mkNpc({}), id: 'C4', name: '路人甲', onScene: true },
    ] as NpcRecord[];
    const t = pickMindflowTargets(npcs, '我看向蕾姆', 2);
    expect(t.length).toBe(2);
    expect(t.every((r) => r.onScene)).toBe(true);
    expect(t[0].name).toBe('蕾姆');   // 被点名者置顶
  });
  it('全员离场 → 空', () => {
    const npcs = [{ ...mkNpc({}), onScene: false }] as NpcRecord[];
    expect(pickMindflowTargets(npcs, '', 2)).toHaveLength(0);
  });
});

describe('sanitizeMindflowReply', () => {
  it('正常心流保留并截断', () => {
    const r = sanitizeMindflowReply('蕾姆', '他刚才那句话……是认真的吗。心口有点发烫，先把茶端过去，顺便看看他的表情再说。');
    expect(r?.name).toBe('蕾姆');
    expect(r?.text).toContain('心口有点发烫');
  });
  it('剥 think 块后仍有效', () => {
    const r = sanitizeMindflowReply('蕾姆', '<think>分析一下</think>他在试探我。不能接话，先装作没听懂，把注意力引到晚饭上。');
    expect(r?.text.startsWith('他在试探我')).toBe(true);
  });
  it('混入结构模块 → 整段作废', () => {
    expect(sanitizeMindflowReply('蕾姆', '我很生气。<state>\nhp.C1 -= 10\n</state>')).toBeNull();
    expect(sanitizeMindflowReply('蕾姆', '状态栏：愤怒值+10，接下来我要发火了，绝不客气。')).toBeNull();
  });
  it('太短/空 → 作废', () => {
    expect(sanitizeMindflowReply('蕾姆', '嗯。')).toBeNull();
    expect(sanitizeMindflowReply('蕾姆', '')).toBeNull();
  });
});

describe('buildMindflowBlock', () => {
  it('空列表 → 空串（调用方据此不注入）', () => {
    expect(buildMindflowBlock([])).toBe('');
  });
  it('含导演注规则与各角色分段', () => {
    const b = buildMindflowBlock([{ name: '蕾姆', text: '心流A' }, { name: '韩立', text: '心流B' }]);
    expect(b).toContain('<角色心流·导演注>');
    expect(b).toContain('【蕾姆·内心】');
    expect(b).toContain('【韩立·内心】');
    expect(b).toContain('角色隔离');
    expect(b.endsWith('</角色心流·导演注>')).toBe(true);
  });
});

describe('buildMindflowMessages', () => {
  it('system=心流规则，user=档案块+剧情块+玩家言行', () => {
    const msgs = buildMindflowMessages(mkNpc({}), '我伸出手', '……昨夜的雨还没停。');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('第一人称心流');
    expect(msgs[1].content).toContain('<该角色人格档案>');
    expect(msgs[1].content).toContain('<最近剧情>');
    expect(msgs[1].content).toContain('我伸出手');
  });
  it('无剧情尾段时省略剧情块', () => {
    const msgs = buildMindflowMessages(mkNpc({}), '你好', '');
    expect(msgs[1].content).not.toContain('<最近剧情>');
  });
});
