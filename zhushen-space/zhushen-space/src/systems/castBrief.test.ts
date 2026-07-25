import { describe, it, expect } from 'vitest';
import { pickCastCandidates, serializeCastDossier, buildCastBlacklist, buildCastBriefInput, isCastEligible } from './castBrief';
import type { NpcRecord } from '../store/npcStore';

/* 角色立场简报·输入侧。要守住的三件事：
   ① 选人优先级（玩家点名 > 在场 > 同行 > 好感）——点名了还不给档案是老坑；
   ② 死人/归档者绝不进候选，且要进「不得出场」黑名单（治鬼影登场）；
   ③ 瘦档案里**只有人格、没有任何数值**（六维/HP/装备/技能一律不许漏进来，否则等于把全量卡又搬了一遍）。 */

const npc = (over: Partial<NpcRecord> & { id: string; name: string }): NpcRecord => ({
  gender: '', realm: '', personality: '', status: '', callPlayer: '', background: '',
  innerThought: '', relations: '', favor: 0, appearance5: '', motiveNow: '', shortGoal: '',
  longGoal: '', onScene: false, ...over,
} as NpcRecord);

describe('pickCastCandidates · 选人优先级', () => {
  const roster = [
    npc({ id: 'C1', name: '何月莲', onScene: true, favor: 30 }),
    npc({ id: 'C2', name: '张伟', onScene: false, favor: 90 }),        // 好感高但离场
    npc({ id: 'C3', name: '叶真', onScene: false, partyMember: true }), // 同行但暂不在场
    npc({ id: 'C4', name: '孙瑞', onScene: true, favor: 5 }),
  ];

  it('在场优先于「离场但好感高」', () => {
    const out = pickCastCandidates(roster, '', 2).map((r) => r.name);
    expect(out).toContain('何月莲');
    expect(out).toContain('孙瑞');
    expect(out).not.toContain('张伟');
  });

  it('玩家这一步点了名 → 压过在场，排第一（哪怕离场）', () => {
    const out = pickCastCandidates(roster, '我转头问张伟：你怎么看？', 2).map((r) => r.name);
    expect(out[0]).toBe('张伟');
  });

  it('同行队友压过普通在场者之外的低好感者', () => {
    const out = pickCastCandidates(roster, '', 3).map((r) => r.name);
    expect(out).toContain('叶真');
  });

  it('max 是硬上限', () => {
    expect(pickCastCandidates(roster, '', 1)).toHaveLength(1);
    expect(pickCastCandidates(roster, '', 0)).toHaveLength(0);
  });
});

describe('候选资格 · 死人与归档者出局', () => {
  const roster = [
    npc({ id: 'C1', name: '何月莲', onScene: true }),
    npc({ id: 'C2', name: '亡者', onScene: true, isDead: true }),
    npc({ id: 'C3', name: '封存者', archived: true }),
    npc({ id: 'C4', name: 'C4' }),   // 骨架档：name===id，没真名
  ];

  it('isCastEligible 只放行未死、未归档、有真名的', () => {
    expect(roster.filter(isCastEligible).map((r) => r.name)).toEqual(['何月莲']);
  });

  it('即便被玩家点名，死者/归档者也不进候选', () => {
    const out = pickCastCandidates(roster, '亡者和封存者呢？', 6).map((r) => r.name);
    expect(out).toEqual(['何月莲']);
  });

  it('黑名单列出死者与归档者，供正文"不得出场"', () => {
    const black = buildCastBlacklist(roster);
    expect(black).toContain('亡者(已死亡)');
    expect(black).toContain('封存者(已归档封存)');
    expect(buildCastBlacklist([roster[0]])).toBe('');   // 没人该拦 → 空串，不注入空标签
  });
});

describe('serializeCastDossier · 只给人格，不漏数值', () => {
  const r = npc({
    id: 'C1', name: '何月莲', gender: '女', onScene: true, realm: '二阶·Lv.15', profession: '剑修',
    personality: '外冷内热，认死理', principles: '绝不背弃同门', sampleLines: '「……随你。」',
    callPlayer: '你', relations: 'B1:同门;C2:宿敌', motiveNow: '查清师兄死因', innerThought: '他在骗我',
    favor: 40, trust: 48, respect: 60, lust: 12, corruption: 0,
    attrs: { str: 99, agi: 99, con: 99, int: 99, cha: 99, luck: 99 },
    hp: 500, maxHp: 500, items: [{ name: '青锋剑', equipped: true }],
  } as Partial<NpcRecord> as any);

  const out = serializeCastDossier(r);

  it('带上人格锚点字段', () => {
    for (const s of ['性格:', '原则底线', '范例台词', '关系网:', '当前动机:', '内心:', '对主角态度·四轴']) {
      expect(out).toContain(s);
    }
  });

  it('四轴带当前阶段标签（防跳级）', () => {
    expect(out).toMatch(/信任48/);
  });

  it('绝不夹带六维 / HP / 装备（那是正文卡的活，这里烧不起）', () => {
    expect(out).not.toMatch(/六维|HP|EP|物攻|生物强度|青锋剑/);
  });
});

describe('buildCastBriefInput · 整块组装', () => {
  const roster = [npc({ id: 'C1', name: '何月莲', onScene: true, personality: '外冷内热' })];

  it('包住标签，并明写"名单不是点名册"（防轮流发言）', () => {
    const out = buildCastBriefInput(roster, '', {});
    expect(out).toContain('<本回合可能出场角色·人格档案>');
    expect(out).toContain('</本回合可能出场角色·人格档案>');
    expect(out).toContain('不是点名册');
  });

  it('无可用候选 → 空串（调用方据此跳过，不注入空块）', () => {
    expect(buildCastBriefInput([], '', {})).toBe('');
    expect(buildCastBriefInput([npc({ id: 'C9', name: '亡者', isDead: true })], '', {})).toBe('');
  });

  it('budget 卡死总长度（防某个 NPC 的长档案顶爆请求）', () => {
    const fat = Array.from({ length: 20 }, (_, i) =>
      npc({ id: `C${i}`, name: `角色${i}`, onScene: true, personality: '很长的性格'.repeat(50) }));
    const out = buildCastBriefInput(fat, '', { max: 12, budget: 800 });
    expect(out.length).toBeLessThan(1600);         // 头尾说明 + 被裁的正文
    expect(out).toContain('因长度上限省略');
  });
});
