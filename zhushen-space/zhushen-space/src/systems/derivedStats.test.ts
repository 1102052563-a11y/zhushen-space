import { describe, it, expect } from 'vitest';
import {
  computeMaxHp, computeMaxEp, effectiveResource,
  realmFromLevel, normalizeTier, trueAttr, lvFromRealm,
  attrCapForTier, clampBaseAttrs, gearMaxHpBonus, gearMaxHpPctBonus, fullMaxHp, fullMaxEp,
  realAttrMult, parseCombatStat, computeDerived, ratioOf, hpCoefOf, epCoefOf, vitalFormula, computeAttrPool,
  npcBaseAttrs, TIER_LEVEL_RANGE, clampLevelToTier, TIERS,
} from './derivedStats';
import type { PlayerAttrs } from '../store/playerStore';

// 六维构造器（只关心被测字段，其余给默认值）
const A = (p: Partial<PlayerAttrs>): PlayerAttrs => ({ str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5, ...p } as PlayerAttrs);

// NPC 真实属性点直加(realAttrs) 计入 HP/EP —— 治"给 NPC 加真实体质/真实智力不涨血/蓝"（与主角同源）
describe('npcBaseAttrs：NPC 六维并入真实属性点直加(realAttrs)', () => {
  it('realAttrs 叠加到基础六维', () => {
    expect(npcBaseAttrs({ attrs: A({ con: 10 }), realAttrs: { con: 5 } }).con).toBe(15);
    expect(npcBaseAttrs({ attrs: A({ int: 8 }), realAttrs: { int: 4 } }).int).toBe(12);
  });
  it('真实体质 → NPC HP 上限；真实智力 → NPC EP 上限', () => {
    expect(computeMaxHp(npcBaseAttrs({ attrs: A({ con: 10 }), realAttrs: { con: 5 } }))).toBe(300);   // (10+5)×20
    expect(computeMaxEp(npcBaseAttrs({ attrs: A({ int: 10 }), realAttrs: { int: 4 } }))).toBe(210);   // (10+4)×15
  });
  it('空/缺省安全（无 realAttrs 或无 attrs 不炸、退回默认六维）', () => {
    expect(npcBaseAttrs({ attrs: A({ con: 7 }) }).con).toBe(7);
    expect(npcBaseAttrs(undefined).con).toBe(5);
    expect(npcBaseAttrs({ realAttrs: { con: 3 } }).con).toBe(8);   // 无基础 attrs → 默认5 + 直加3
  });
});

describe('computeMaxHp / computeMaxEp（HP=体质×20, EP=智力×15）', () => {
  it('按系数换算', () => {
    expect(computeMaxHp(A({ con: 5 }))).toBe(100);
    expect(computeMaxHp(A({ con: 10 }))).toBe(200);
    expect(computeMaxEp(A({ int: 5 }))).toBe(75);
    expect(computeMaxEp(A({ int: 10 }))).toBe(150);
  });
  it('缺省/0 边界', () => {
    expect(computeMaxHp(undefined)).toBe(100); // 默认 con 5
    expect(computeMaxEp(undefined)).toBe(75);  // 默认 int 5
    expect(computeMaxHp(A({ con: 0 }))).toBe(0);
  });
});

describe('多属性混合转化比（hpRatio / epRatio 系数表）', () => {
  it('ratioOf：全空→undefined；map→保留(清洗后)', () => {
    expect(ratioOf(undefined)).toBeUndefined();
    expect(ratioOf({})).toBeUndefined();
    expect(ratioOf({ hpRatio: {} })).toBeUndefined();
    expect(ratioOf({ hpRatio: { con: 10, int: 5 } })).toEqual({ hp: { con: 10, int: 5 }, ep: undefined });
    expect(ratioOf({ epRatio: { int: 15, con: 8 } })).toEqual({ hp: undefined, ep: { int: 15, con: 8 } });
  });
  it('ratioOf 清洗：≤0/非有限项剔除', () => {
    expect(ratioOf({ hpRatio: { con: 20, int: 0, str: -3, agi: NaN } })).toEqual({ hp: { con: 20 }, ep: undefined });
  });
  it('ratioOf 兼容旧扁平字段（2×2→并入 map）', () => {
    expect(ratioOf({ hpPerCon: 30, hpPerInt: 5, epPerInt: 25, epPerCon: 8 }))
      .toEqual({ hp: { con: 30, int: 5 }, ep: { int: 25, con: 8 } });
  });
  it('hpCoefOf/epCoefOf：空→默认 体×20 / 智×15', () => {
    expect(hpCoefOf(undefined)).toEqual({ con: 20 });
    expect(epCoefOf(undefined)).toEqual({ int: 15 });
    expect(hpCoefOf({ hp: { con: 10, int: 5 } })).toEqual({ con: 10, int: 5 });
  });
  it('computeMaxHp/EP：HP = 体×10 + 智×5（多属性混合）', () => {
    const r = { hp: { con: 10, int: 5 } };
    expect(computeMaxHp(A({ con: 10, int: 8 }), 1, r)).toBe(140);   // 体10×10=100 + 智8×5=40
    expect(computeMaxEp(A({ int: 10 }), 1, r)).toBe(150);           // ep 未给→默认 智×15
  });
  it('任意属性都能进 HP/EP（力→HP、魅→EP）', () => {
    expect(computeMaxHp(A({ str: 10, con: 0 }), 1, { hp: { str: 12 } })).toBe(120);
    expect(computeMaxEp(A({ cha: 10 }), 1, { ep: { cha: 7 } })).toBe(70);
  });
  it('给了表就以表为准（不再叠默认）：epRatio={con:8} → EP = 体×8（无智×15）', () => {
    expect(computeMaxEp(A({ con: 10, int: 100 }), 1, { ep: { con: 8 } })).toBe(80);
  });
  it('系数表叠乘 realMult（四阶 ×5）', () => {
    expect(computeMaxHp(A({ con: 10, int: 10 }), 5, { hp: { con: 20, int: 5 } })).toBe(1250);  // (200+50)×5
  });
  it('默认（无 ratio）= 体×20 / 智×15，旧行为不变', () => {
    expect(computeMaxHp(A({ con: 10, int: 10 }))).toBe(200);
    expect(computeMaxEp(A({ con: 10, int: 10 }))).toBe(150);
  });
  it('fullMaxHp 透传系数表（体×10+智×5 + 装备平值 +1000）', () => {
    expect(fullMaxHp(A({ con: 10, int: 8 }), [], [], [], 1, { hp: { con: 10, int: 5 } })).toBe(140);
    expect(fullMaxHp(A({ con: 10, int: 8 }), [{ effect: '生命值上限+1000' }], [], [], 1, { hp: { con: 10, int: 5 } })).toBe(1140);
    expect(fullMaxEp(A({ int: 10 }), [], [], [], 1, { ep: { int: 25 } })).toBe(250);
  });
  it('vitalFormula：渲染中文公式', () => {
    expect(vitalFormula({ con: 10, int: 5 })).toBe('体×10+智×5');
    expect(vitalFormula({ str: 12 })).toBe('力×12');
    expect(vitalFormula({})).toBe('—');
  });
  it('computeAttrPool：通用六维加权池（供自定义能量条上限）', () => {
    expect(computeAttrPool(A({ int: 10, con: 6 }), { int: 30, con: 5 })).toBe(330);  // 智10×30 + 体6×5
    expect(computeAttrPool(A({ int: 10 }), { int: 30 }, 5)).toBe(1500);              // ×realMult(四阶)
    expect(computeAttrPool(A({ int: 10 }), undefined)).toBe(0);                      // 空表→0
    expect(computeAttrPool(A({ int: 10 }), {})).toBe(0);
    expect(computeAttrPool(A({ luck: 8 }), { luck: 4 })).toBe(32);                   // 任意属性
  });
});

describe('realAttrMult / HP·EP ×5（四阶起六维即真实属性·5:1）', () => {
  it('realAttrMult：一~三阶=1，四阶起=5', () => {
    expect(realAttrMult('三阶')).toBe(1);
    expect(realAttrMult('四阶')).toBe(5);
    expect(realAttrMult('至强')).toBe(5);
    expect(realAttrMult(undefined, 35)).toBe(5);  // Lv35=四阶
    expect(realAttrMult(undefined, 20)).toBe(1);  // Lv20=二阶
  });
  it('computeMaxHp/EP 按 realMult 放大（四阶 体100→HP1万、智100→EP7500）', () => {
    expect(computeMaxHp(A({ con: 100 }), 5)).toBe(10000);
    expect(computeMaxEp(A({ int: 100 }), 5)).toBe(7500);
    expect(computeMaxHp(A({ con: 100 }))).toBe(2000);  // 默认倍率1不变
  });
  it('fullMaxHp 透传 realMult（六维部分×5，装备平值加成不×）', () => {
    expect(fullMaxHp(A({ con: 100 }), [], [], [], 5)).toBe(10000);
    expect(fullMaxHp(A({ con: 100 }), [{ effect: '生命值上限+1000' }], [], [], 5)).toBe(11000); // 10000(六维×5)+1000(装备不×)
  });
});

describe('effectiveResource（当前值显示口径）', () => {
  it('从未设过 → 视为满', () => expect(effectiveResource(undefined, undefined, 200)).toBe(200));
  it('有值则原样保留', () => expect(effectiveResource(50, undefined, 200)).toBe(50));
  it('夹到 [0, max]', () => {
    expect(effectiveResource(300, undefined, 200)).toBe(200);
    expect(effectiveResource(-10, undefined, 200)).toBe(0);
  });
});

describe('realmFromLevel（等级→阶位）', () => {
  it('阶位边界', () => {
    expect(realmFromLevel(1)).toBe('一阶');
    expect(realmFromLevel(10)).toBe('一阶');
    expect(realmFromLevel(11)).toBe('二阶');
    expect(realmFromLevel(90)).toBe('九阶');
    expect(realmFromLevel(100)).toBe('绝强');
    expect(realmFromLevel(105)).toBe('巅峰绝强');
    expect(realmFromLevel(120)).toBe('至强');
    expect(realmFromLevel(150)).toBe('巅峰至强');
    expect(realmFromLevel(151)).toBe('无上之境');
  });
  it('非法等级兜底为一阶', () => expect(realmFromLevel(0)).toBe('一阶'));
});

describe('normalizeTier（AI 任意阶位串→合法阶位）', () => {
  it('提取合法阶位', () => {
    expect(normalizeTier('三阶中期')).toBe('三阶');
    expect(normalizeTier('巅峰至强')).toBe('巅峰至强');
    expect(normalizeTier('至强者')).toBe('至强');
  });
  it('修仙词/空 → 空串', () => {
    expect(normalizeTier('结丹')).toBe('');
    expect(normalizeTier('')).toBe('');
    expect(normalizeTier(undefined)).toBe('');
  });
});

describe('trueAttr（每 80 普通 = 1 真实）', () => {
  it('floor(v/80)', () => {
    expect(trueAttr(80)).toBe(1);
    expect(trueAttr(79)).toBe(0);
    expect(trueAttr(160)).toBe(2);
    expect(trueAttr(0)).toBe(0);
    expect(trueAttr(-5)).toBe(0);
  });
});

describe('lvFromRealm（从 realm 串提 Lv）', () => {
  it('提取等级', () => {
    expect(lvFromRealm('一阶·Lv.8|身份')).toBe(8);
    expect(lvFromRealm('Lv.12')).toBe(12);
  });
  it('取不到默认 1', () => {
    expect(lvFromRealm('无')).toBe(1);
    expect(lvFromRealm(undefined)).toBe(1);
  });

  // ⚠ 阶位·等级一致性守卫（治「毒岛冴子·二阶·Lv.86 → 资质T8·真神」）
  it('阶位与 Lv 矛盾 → 以阶位为准夹回该阶区间', () => {
    expect(lvFromRealm('二阶·Lv.86')).toBe(20);        // 越上限 → 夹到二阶顶 Lv.20
    expect(lvFromRealm('五阶·Lv.3')).toBe(41);         // 越下限 → 夹到五阶底 Lv.41
    expect(lvFromRealm('二阶·Lv.86|藤美学园3年级学生')).toBe(20);   // 带身份后缀
  });
  it('阶位与 Lv 自洽 → 原样返回（不误伤正常数据）', () => {
    expect(lvFromRealm('九阶·Lv.86')).toBe(86);
    expect(lvFromRealm('三阶·Lv.25|调查员')).toBe(25);
    expect(lvFromRealm('无上之境·Lv.999')).toBe(999);   // 无上无上限
  });
  it('身份后缀里的阶位词不参与判定（只认 | 前的头部）', () => {
    expect(lvFromRealm('一阶·Lv.5|三阶佣兵团学徒')).toBe(5);
  });
  it('认不出阶位的脏数据 → 不夹，仍交给 realmFromLevel 推导', () => {
    expect(lvFromRealm('结丹中期·Lv.25')).toBe(25);
    expect(lvFromRealm('Lv.86')).toBe(86);
  });
});

describe('TIER_LEVEL_RANGE ↔ realmFromLevel 双向一致（改一处漏改另一处就挂）', () => {
  it('每个阶位的区间上下界都能被 realmFromLevel 判回该阶', () => {
    for (const [tier, [lo, hi]] of Object.entries(TIER_LEVEL_RANGE)) {
      expect(realmFromLevel(lo)).toBe(tier);
      if (Number.isFinite(hi)) expect(realmFromLevel(hi)).toBe(tier);
    }
  });
  it('区间首尾相接、无空洞无重叠', () => {
    const rs = TIERS.map((t) => TIER_LEVEL_RANGE[t]);
    expect(rs[0][0]).toBe(1);
    for (let i = 1; i < rs.length; i++) expect(rs[i][0]).toBe(rs[i - 1][1] + 1);
  });
});

describe('clampLevelToTier', () => {
  it('夹进区间；阶位认不出则原样返回', () => {
    expect(clampLevelToTier(86, '二阶')).toBe(20);
    expect(clampLevelToTier(15, '二阶')).toBe(15);
    expect(clampLevelToTier(86, '结丹')).toBe(86);
    expect(clampLevelToTier(86, undefined)).toBe(86);
  });
});

// 冴子回归：realm 一矛盾就会经 max(阶位串, realmFromLevel(Lv)) 把二阶顶成九阶 → 六维上限 80 放开到 500
describe('回归·二阶Lv.86 不得被当成九阶', () => {
  it('attrCapForTier 仍按二阶封顶 80（而非九阶的 500）', () => {
    const realm = '二阶·Lv.86|藤美学园3年级学生';
    expect(attrCapForTier(realm, lvFromRealm(realm))).toBe(80);
  });
});

describe('attrCapForTier（基础六维上限，取阶位/等级较高者）', () => {
  it('按阶位', () => {
    expect(attrCapForTier('一阶')).toBe(50);
    expect(attrCapForTier('五阶')).toBe(175);
  });
  it('阶位与等级取较高上限', () => {
    expect(attrCapForTier('三阶', 5)).toBe(99);     // 三阶99 > 一阶(lv5)50
    expect(attrCapForTier(undefined, 15)).toBe(80); // 二阶
  });
  it('都取不到 → Infinity（不夹）', () => expect(attrCapForTier()).toBe(Infinity));
});

describe('clampBaseAttrs（基础六维封顶护栏，绕过短指令的入口同护栏）', () => {
  it('超过本阶上限 → 夹到上限', () => {
    // 三阶 cap=99：力500 夹到 99，体80 不动
    expect(clampBaseAttrs({ str: 500, con: 80 }, '三阶')).toEqual({ str: 99, con: 80 });
  });
  it('六项都夹（含幸运），负值兜到 0', () => {
    const out = clampBaseAttrs({ str: 999, agi: 10, con: 999, int: 5, cha: 200, luck: -3 }, '一阶'); // cap=50
    expect(out).toEqual({ str: 50, agi: 10, con: 50, int: 5, cha: 50, luck: 0 });
  });
  it('取不到阶位上限 → 原样不夹', () => {
    expect(clampBaseAttrs({ str: 9999 })).toEqual({ str: 9999 });
  });
  it('按等级推导上限（无阶位字段时）', () => {
    expect(clampBaseAttrs({ str: 300 }, undefined, 15).str).toBe(80); // lv15=二阶 cap80
  });
});

describe('装备「上限加成」解析（只认明写"上限/最大值"，不认回复/伤害类）', () => {
  it('平值加成', () => {
    expect(gearMaxHpBonus([{ effect: '生命值上限+50' }])).toBe(50);
    expect(gearMaxHpBonus([{ effect: '回复100生命' }])).toBe(0); // 回复≠上限
    expect(gearMaxHpBonus([])).toBe(0);
  });
  it('百分比加成', () => {
    expect(gearMaxHpPctBonus([{ effect: '生命上限+10%' }])).toBe(10);
    expect(gearMaxHpPctBonus([{ effect: '造成10%生命值伤害' }])).toBe(0); // 伤害≠上限
  });
});

describe('上限加成·宽松档（未写"上限"但显然是「加生命/HP」的天赋/词缀也计入）', () => {
  it('加号·名词在前', () => {
    expect(gearMaxHpBonus([{ effect: '生命值+5000' }])).toBe(5000);
    expect(gearMaxHpBonus([{ effect: 'HP +500' }])).toBe(500);
    expect(gearMaxHpBonus([{ effect: '血量+800' }])).toBe(800);
  });
  it('增益动词·数字在前', () => {
    expect(gearMaxHpBonus([{ effect: '增加2000点生命' }])).toBe(2000);
    expect(gearMaxHpBonus([{ effect: '永久提升8000生命' }])).toBe(8000);
  });
  it('加号·数字在前', () => {
    expect(gearMaxHpBonus([{ effect: '+2000生命' }])).toBe(2000);
    expect(gearMaxHpBonus([{ effect: '生命强化：+1500生命' }])).toBe(1500);
  });
  it('仍排除回复/伤害/消耗等非上限语义', () => {
    expect(gearMaxHpBonus([{ effect: '回复100生命' }])).toBe(0);
    expect(gearMaxHpBonus([{ effect: '每回合恢复500生命' }])).toBe(0);
    expect(gearMaxHpBonus([{ effect: '造成5000点生命伤害' }])).toBe(0);
    expect(gearMaxHpBonus([{ effect: '消耗300生命' }])).toBe(0);
  });
  it('严谨档与宽松档不重复计数', () => {
    expect(gearMaxHpBonus([{ effect: '最大生命+5000' }])).toBe(5000);
    expect(gearMaxHpBonus([{ effect: '增加5000点生命上限' }])).toBe(5000);
  });
  it('天赋「生命值+N」让 fullMaxHp 真正叠加（con5 基础100 + 5000）', () => {
    expect(fullMaxHp(A({ con: 5 }), [], [{ effect: '生命狂暴：生命值+5000' }])).toBe(5100);
  });
});

describe('attrBonus 字段·HP/EP 上限加成（规范字段，与六维同处；含百分比）', () => {
  it('装备 attrBonus 平值/百分比都读得到', () => {
    expect(gearMaxHpBonus([{ attrBonus: '生命上限+5000' }])).toBe(5000);
    expect(gearMaxHpPctBonus([{ attrBonus: '生命上限+20%' }])).toBe(20);
    expect(gearMaxHpBonus([{ attrBonus: '体质+10、生命上限+3000' }])).toBe(3000); // 六维与上限并存，只取上限部分
  });
  it('天赋 attrBonus 让 fullMaxHp 叠加（con5 基础100 + 5000）', () => {
    expect(fullMaxHp(A({ con: 5 }), [], [{ attrBonus: '生命上限+5000' }])).toBe(5100);
  });
  it('天赋 attrBonus 平值+百分比并存（(100+2000)×1.5=3150）', () => {
    expect(fullMaxHp(A({ con: 5 }), [], [{ attrBonus: '生命上限+2000、生命上限+50%' }])).toBe(3150);
  });
  it('attrBonus 与 effect 复述同一加成 → 只计一次（不双算）', () => {
    expect(gearMaxHpBonus([{ attrBonus: '生命上限+5000', effect: '大幅强化生命，生命上限+5000' }])).toBe(5000);
  });
  it('attrBonus 只写六维时，仍从 effect 读上限加成（兜底）', () => {
    expect(gearMaxHpBonus([{ attrBonus: '体质+10', effect: '生命上限+2000' }])).toBe(2000);
  });
});

describe('parseCombatStat（装备攻防字段→衍生攻防贡献，范围取均值）', () => {
  it('法术攻击力 60-135 → matk 98（均值）', () => {
    expect(parseCombatStat('法术攻击力 60-135')).toEqual({ patk: 0, matk: 98, pdef: 0, mdef: 0 });
  });
  it('物理攻击 范围/单值', () => {
    expect(parseCombatStat('攻击力 15-28')).toEqual({ patk: 22, matk: 0, pdef: 0, mdef: 0 });
    expect(parseCombatStat('攻击 80')).toEqual({ patk: 80, matk: 0, pdef: 0, mdef: 0 });
  });
  it('防御（物理/法术分流）', () => {
    expect(parseCombatStat('防御力 8-12')).toEqual({ patk: 0, matk: 0, pdef: 10, mdef: 0 });
    expect(parseCombatStat('法术防御力 40-60')).toEqual({ patk: 0, matk: 0, pdef: 0, mdef: 50 });
  });
  it('攻防混合一条 → 各归各位', () => {
    expect(parseCombatStat('攻击力 15-28 / 防御力 8-12')).toEqual({ patk: 22, matk: 0, pdef: 10, mdef: 0 });
  });
  it('允许强化前导 +', () => {
    expect(parseCombatStat('攻击 +15')).toEqual({ patk: 15, matk: 0, pdef: 0, mdef: 0 });
  });
  it('无数字/空 → 全 0', () => {
    expect(parseCombatStat('')).toEqual({ patk: 0, matk: 0, pdef: 0, mdef: 0 });
    expect(parseCombatStat('锋利无比')).toEqual({ patk: 0, matk: 0, pdef: 0, mdef: 0 });
    expect(parseCombatStat(undefined)).toEqual({ patk: 0, matk: 0, pdef: 0, mdef: 0 });
  });
});

describe('computeDerived 读取 combatStat（写明攻防数值时所见即所得，否则回退品级）', () => {
  it('法杖 法术攻击力 60-135 真正加进 matk（int50：基础 matk=152，+98=250）', () => {
    const noEq = computeDerived(A({ int: 50 }), 1, []);
    const withStaff = computeDerived(A({ int: 50 }), 1, [{ category: '武器', grade: 5, combatStat: '法术攻击力 60-135' }]);
    expect(withStaff.matk - noEq.matk).toBe(98);   // 卡面均值，而非旧的 grade×4=20
    expect(withStaff.patk - noEq.patk).toBe(0);    // 纯法系不给物理攻击
  });
  it('无可识别攻防数值 → 回退按品级估算（武器 grade5：matk+20）', () => {
    const noEq = computeDerived(A({ int: 50 }), 1, []);
    const legacy = computeDerived(A({ int: 50 }), 1, [{ category: '武器', grade: 5 }]);
    expect(legacy.matk - noEq.matk).toBe(20);      // grade×4 旧口径仍兼容
  });
});

describe('fullMaxHp（无加成时 = computeMaxHp，叠加装备上限）', () => {
  it('纯六维', () => {
    expect(fullMaxHp(A({ con: 5 }))).toBe(100);
    expect(fullMaxHp(A({ con: 10 }))).toBe(200);
  });
  it('叠加装备平值上限', () => {
    expect(fullMaxHp(A({ con: 5 }), [{ effect: '生命值上限+50' }])).toBe(150);
  });
  it('跨资源公式：生命=最大法力的300%（灵影体质类）', () => {
    // con5→基础HP100, int48→最大EP720, +300%×720=2160 → 2260
    expect(fullMaxHp(A({ con: 5, int: 48 }), [], [{ effect: '生命值额外提升量=最大法力值的300%' }])).toBe(2260);
  });
  it('跨资源不误吃伤害/恢复类', () => {
    expect(fullMaxHp(A({ con: 5, int: 48 }), [], [{ effect: '对目标造成其最大法力值10%的伤害' }])).toBe(100);
    expect(fullMaxHp(A({ con: 5, int: 48 }), [], [{ effect: '每回合恢复最大生命5%' }])).toBe(100);
    // 同时含生命与最大法力但是伤害公式(无增益动词)→不算上限加成
    expect(fullMaxHp(A({ con: 5, int: 48 }), [], [{ effect: '造成自身生命值与最大法力值之和的15%的伤害' }])).toBe(100);
  });
  it('阶梯式百分比只取初始值，不累加（灵影体质真实文案）', () => {
    // con5→基础HP100, int48→最大EP720；阶梯 30/45/100% 只取首个30% → +216 → 316
    const linfl = '将脑部储蓄的法力值分散到身体各处，从而大幅提升生命值——生命值提升总量 = 最大法力值的一定比例：初始 30%，突破上限后 45%，最终可达 100%。';
    expect(fullMaxHp(A({ con: 5, int: 48 }), [], [{ effect: linfl }])).toBe(316);
  });
});
