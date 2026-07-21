import { describe, it, expect } from 'vitest';
import { makeCustomGem, parseGeneratedGems, generateGemShop } from './gemEngine';
import { activeGemSets, DEFAULT_GEM_SETS, type GemSetDef } from './gemSets';
import { useGemSets } from '../store/gemSetStore';
import { equipmentPassive } from './combatTags';
import type { SocketedGem } from '../store/itemStore';

/* 自定义宝石：手动打造 / AI 解析，并验证「套装能识别、加成能生效」（用户明确要求）。
   注：makeCustomGem 读默认套装 store（测试环境即 DEFAULT_GEM_SETS）。 */

describe('makeCustomGem（手动打造·必带 gemAttr/gemSet/effect）', () => {
  it('按归属属性自动归入套装', () => {
    const g = makeCustomGem({ grade: '紫色', slot: '通用', attr: '暴击率', effect: '暴击率+10%' });
    expect(g.category).toBe('宝石');
    expect(g.gemAttr).toBe('暴击率');
    expect(g.gemSet).toBe('rift');            // 暴击率 ∈ 裂空杀阵 members
    expect(g.effect).toBe('暴击率+10%');
    expect(g.tags).toContain('自定义');
  });
  it('显式指定套装 key 优先', () => {
    const g = makeCustomGem({ grade: '金色', slot: '武器', attr: '力量', effect: '力量+20', setKey: 'bulwark' });
    expect(g.gemSet).toBe('bulwark');
  });
  it('属性不属于任何套装且未指定 → 不归套（gemSet 空）', () => {
    const g = makeCustomGem({ grade: '白色', slot: '通用', attr: '玄之又玄', effect: '玄+1' });
    expect(g.gemSet).toBeUndefined();
  });
  it('非法品级/部位回退', () => {
    const g = makeCustomGem({ grade: '乱写', slot: '手指' as any, attr: '力量', effect: '力量+5' });
    expect(g.gradeDesc).toBe('紫色');   // 回退默认
    expect(g.gemSlot).toBe('通用');
  });
});

describe('parseGeneratedGems（AI 输出解析）', () => {
  it('解析 JSON 数组（含代码块），带品级回退', () => {
    const raw = '```json\n[{"name":"赤瞳","slot":"武器","attr":"暴击率","effect":"暴击率+12%","grade":"史诗级"},{"attr":"体质","effect":"体质+20"}]\n```';
    const out = parseGeneratedGems(raw, '蓝色');
    expect(out).toHaveLength(2);
    expect(out[0].gradeDesc).toBe('史诗级');
    expect(out[0].gemSet).toBe('rift');
    expect(out[1].gradeDesc).toBe('蓝色');   // 缺 grade → 回退
    expect(out[1].gemSet).toBe('bulwark');
  });
  it('非 JSON → 空数组', () => expect(parseGeneratedGems('无法生成', '紫色')).toEqual([]));
});

describe('generateGemShop（保底出货：AI/自定义套装也刷得出来）', () => {
  it('AI 套装(members 与内置「疾风迅捷」重叠) 也保底出 1 颗归属它的宝石', () => {
    // 治用户报「AI 整的套装怎么也刷不出来」：随机池抽不到 + setForGem 首个匹配把重叠 member 判给内置套装
    const before = useGemSets.getState().sets;
    const aiSet: GemSetDef = { key: 'ai_test_gale', name: '测试急速流', emoji: '⚡', theme: '敏', desc: '', members: ['敏捷', '急速'], tiers: [{ need: 2, bonus: '敏捷+10' }] };
    useGemSets.setState({ sets: [...before, aiSet] });
    try {
      const keys = new Set(generateGemShop('紫色', 8).map((g) => g.item.gemSet));
      expect(keys.has('ai_test_gale')).toBe(true);   // force-assign 生效：重叠 member 也归到 AI 套装
    } finally {
      useGemSets.setState({ sets: before });
    }
  });
  it('多个 AI 套装(含全自造词 member) 都被覆盖', () => {
    const before = useGemSets.getState().sets;
    const ai1: GemSetDef = { key: 'ai_a', name: '甲套', emoji: '💠', theme: '攻', desc: '', members: ['自造词甲'], tiers: [{ need: 2, bonus: '力量+5' }] };
    const ai2: GemSetDef = { key: 'ai_b', name: '乙套', emoji: '💠', theme: '防', desc: '', members: ['自造词乙'], tiers: [{ need: 2, bonus: '体质+5' }] };
    useGemSets.setState({ sets: [...before, ai1, ai2] });
    try {
      const keys = new Set(generateGemShop('紫色', 8).map((g) => g.item.gemSet));
      expect(keys.has('ai_a')).toBe(true);   // 自造词 member 也兜底出货
      expect(keys.has('ai_b')).toBe(true);
    } finally {
      useGemSets.setState({ sets: before });
    }
  });
});

describe('端到端：自定义宝石被套装识别 + 效果生效', () => {
  it('两颗自定义「暴击率」宝石 → 裂空杀阵 2 件套激活 + 暴击率 token 进战斗被动', () => {
    const g = makeCustomGem({ grade: '紫色', slot: '通用', attr: '暴击率', effect: '暴击率+10%' });
    const toSocketed = (): SocketedGem => ({ gemId: 'x' + Math.random(), name: g.name, tier: g.gradeDesc, slot: g.gemSlot!, attr: g.gemAttr!, statText: g.effect, high: false, set: g.gemSet });
    const equipped = [{ equipped: true, gems: [toSocketed(), toSocketed()] }];
    const sets = activeGemSets(equipped, DEFAULT_GEM_SETS);
    expect(sets[0]?.key).toBe('rift');                                   // 识别
    expect(sets[0]?.tiers.find((t) => t.need === 2)?.active).toBe(true); // 集齐激活
    expect(equipmentPassive([{ effect: g.effect }]).critChance).toBeCloseTo(0.10);  // 单颗效果生效
  });
});
