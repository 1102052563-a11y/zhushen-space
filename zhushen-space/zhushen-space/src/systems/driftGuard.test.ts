import { describe, it, expect } from 'vitest';
import { attrsDiffer, attrChangeJustified, revertStableDims, changedFields, entityChangeJustified, pickFields, sameName, SKILL_GUARD_FIELDS, ITEM_ID_FIELDS, ITEM_COMBAT_FIELDS, NPC_PROFILE_GUARD_FIELDS, profileChangeJustified } from './driftGuard';

const A = (o: Record<string, number> = {}) => ({ str: 10, agi: 10, con: 50, int: 10, cha: 10, luck: 5, ...o });

describe('driftGuard 防漂哨纯逻辑', () => {
  it('attrsDiffer：稳定五维变了才 true；只动幸运不算', () => {
    expect(attrsDiffer(A(), A())).toBe(false);
    expect(attrsDiffer(A(), A({ con: 10 }))).toBe(true);   // 体质崩 → true（HP上限会崩）
    expect(attrsDiffer(A(), A({ luck: 99 }))).toBe(false); // 幸运不在守护范围
  });

  it('attrChangeJustified：阶位变 / 点名+成长词 才放行', () => {
    expect(attrChangeJustified('卡尔', '三阶|战士', '四阶|战士', '')).toBe(true);          // 阶位变
    expect(attrChangeJustified('卡尔', '三阶', '三阶', '卡尔成功突破到了新境界')).toBe(true); // 点名+突破
    expect(attrChangeJustified('卡尔', '三阶', '三阶', '卡尔受了重伤，体力大减')).toBe(true);  // 点名+受创
    expect(attrChangeJustified('卡尔', '三阶', '三阶', '卡尔走在熙攘的街道上')).toBe(false);   // 点名但无成长/受创词
    expect(attrChangeJustified('卡尔', '三阶', '三阶', '远处有人突破了')).toBe(false);         // 有词但没点名
    expect(attrChangeJustified('卡尔', '三阶', '三阶', '')).toBe(false);                       // 无正文
  });

  it('revertStableDims：退回五维、保留幸运与其它字段', () => {
    const base = A({ con: 50 });
    const next = A({ con: 10, luck: 99 });
    const out = revertStableDims(base, next);
    expect(out.con).toBe(50);   // 体质退回基线
    expect(out.luck).toBe(99);  // 幸运保留 next 的（另有机制）
  });
});

describe('driftGuard 技能/天赋防漂', () => {
  const sk = (o: Record<string, any> = {}) => ({ id: 'S1', name: '火球术', level: 'Lv.3', effect: '灼烧3层', rarity: '稀有', ...o });

  it('changedFields：已确立字段被改→算漂移；基线为空→放行补全；相同→不算', () => {
    expect(changedFields(sk(), sk({ effect: '灼烧5层' }), SKILL_GUARD_FIELDS)).toContain('effect');   // 效果被改 → 漂移
    expect(changedFields(sk(), sk({ level: 'Lv.9' }), SKILL_GUARD_FIELDS)).toContain('level');
    expect(changedFields(sk({ effect: '' }), sk({ effect: '灼烧3层' }), SKILL_GUARD_FIELDS)).not.toContain('effect'); // 基线空 → 首次补全放行
    expect(changedFields(sk(), sk(), SKILL_GUARD_FIELDS)).toHaveLength(0);   // 没变
  });

  it('entityChangeJustified：点名+升级/受创词才放行', () => {
    expect(entityChangeJustified('火球术', '火球术升级到了 Lv.5')).toBe(true);
    expect(entityChangeJustified('火球术', '他随手放了个火球术')).toBe(false);   // 点名但无升级词
    expect(entityChangeJustified('火球术', '某个法术变强了')).toBe(false);       // 有词但没点名
  });

  it('pickFields：取基线值组回退 patch', () => {
    expect(pickFields(sk(), ['effect', 'level'])).toEqual({ effect: '灼烧3层', level: 'Lv.3' });
  });

  it('sameName：归一相等', () => {
    expect(sameName('火球·术', '火球术')).toBe(true);
    expect(sameName('火球术', '冰锥术')).toBe(false);
  });
});

describe('driftGuard 物品字段防漂', () => {
  const it0 = (o: Record<string, any> = {}) => ({ id: 'I1', name: '铁剑', category: '武器', subType: '单手剑', combatStat: '攻击力+45', effect: '锋利', gradeDesc: '蓝色', ...o });

  it('战斗字段被无故改写 → 算漂移', () => {
    expect(changedFields(it0(), it0({ combatStat: '攻击力+200' }), ITEM_COMBAT_FIELDS)).toContain('combatStat');
    expect(changedFields(it0(), it0({ gradeDesc: '史诗级' }), ITEM_COMBAT_FIELDS)).toContain('gradeDesc');
  });

  it('身份字段被改 → 算漂移（物品不该自己变类/改名）', () => {
    expect(changedFields(it0(), it0({ category: '防具' }), ITEM_ID_FIELDS)).toContain('category');
    expect(changedFields(it0(), it0({ name: '神剑' }), ITEM_ID_FIELDS)).toContain('name');
  });
});

describe('driftGuard 外貌/档案防漂', () => {
  const npc = (o: Record<string, any> = {}) => ({ appearanceDetail: '银发紫瞳·清瘦', gender: '女', personality: '高冷', profession: '剑士', ...o });

  it('外貌基底被无故改写 → 算漂移', () => {
    expect(changedFields(npc(), npc({ appearanceDetail: '金发碧眼·魁梧' }), NPC_PROFILE_GUARD_FIELDS)).toContain('appearanceDetail');
    expect(changedFields(npc(), npc({ profession: '法师' }), NPC_PROFILE_GUARD_FIELDS)).toContain('profession');  // 肉盾剑士→法师 角色翻转
  });

  it('profileChangeJustified：有外貌/转职事件才放行', () => {
    expect(profileChangeJustified('她染了金发，换上法袍转职为法师')).toBe(true);
    expect(profileChangeJustified('她照常走在街上聊着天')).toBe(false);
  });
});
