import { describe, it, expect } from 'vitest';
import { computeCompanionAwards, isSettlingCompanion, COMPANION_SETTLE_RATIO, MAX_SETTLE_COMPANIONS, type CompanionLike } from './companionSettlement';

const c = (over: Partial<CompanionLike> & { id: string }): CompanionLike => ({ name: over.id, onScene: true, ...over });

describe('isSettlingCompanion（谁参与随从结算）', () => {
  it('羁绊(isBond) / 临时队友(partyMember) 恒计入（即便离场）', () => {
    expect(isSettlingCompanion(c({ id: 'C1', name: '小翠', isBond: true, onScene: false }))).toBe(true);
    expect(isSettlingCompanion(c({ id: 'C2', name: '阿铁', partyMember: true, onScene: false }))).toBe(true);
  });
  it('在场 + 随从/宠物/召唤标签 → 计入', () => {
    expect(isSettlingCompanion(c({ id: 'C3', name: '灵狐', npcTag: '宠物', onScene: true }))).toBe(true);
    expect(isSettlingCompanion(c({ id: 'C4', name: '傀儡', npcTag: '召唤物', onScene: true }))).toBe(true);
  });
  it('离场且仅靠标签（非羁绊/队友）→ 不计入', () => {
    expect(isSettlingCompanion(c({ id: 'C5', name: '路过随从', npcTag: '随从', onScene: false }))).toBe(false);
  });
  it('土著 / 普通契约者路人 → 不计入', () => {
    expect(isSettlingCompanion(c({ id: 'C6', name: '村民', npcTag: '土著', onScene: true }))).toBe(false);
    expect(isSettlingCompanion(c({ id: 'C7', name: '过客', npcTag: '契约者', onScene: true }))).toBe(false);
  });
  it('已死亡 / 无真名（占位档）→ 不计入', () => {
    expect(isSettlingCompanion(c({ id: 'C8', name: '亡者', isBond: true, isDead: true }))).toBe(false);
    expect(isSettlingCompanion(c({ id: 'C9', name: 'C9', partyMember: true }))).toBe(false);   // name===id 视为无真名
  });
});

describe('computeCompanionAwards（按主角结算折算发点）', () => {
  const party: CompanionLike[] = [
    c({ id: 'C1', name: '小翠', realm: '三阶', isBond: true }),      // ≤三阶 → 普通属性点
    c({ id: 'C2', name: '阿铁', realm: '五阶', partyMember: true }), // 四阶+ → 真实属性点
  ];

  it('★随从按主角同项 ×0.5 折算·向下取整；阶位决定发普通 vs 真实属性点', () => {
    // 主角 S 档：属性点 16、技能点 16（三阶主角发普通属性点）
    const out = computeCompanionAwards({ attrPoints: 16, realAttrPoints: 0, skillPoints: 16 }, party);
    expect(out).toHaveLength(2);
    const cui = out.find((x) => x.id === 'C1')!;
    const tie = out.find((x) => x.id === 'C2')!;
    expect(cui.attrPoints).toBe(8); expect(cui.realAttrPoints).toBe(0); expect(cui.skillPoints).toBe(8);   // 三阶随从：普通属性点
    expect(tie.realAttrPoints).toBe(8); expect(tie.attrPoints).toBe(0); expect(tie.skillPoints).toBe(8);   // 五阶随从：真实属性点
  });

  it('★主角发的是真实属性点（四阶+主角）→ 仍进「属性点池」，随从按自身阶位路由', () => {
    // 主角四阶+：realAttrPoints 20、attrPoints 0
    const out = computeCompanionAwards({ attrPoints: 0, realAttrPoints: 20, skillPoints: 10 }, party);
    expect(out.find((x) => x.id === 'C1')!.attrPoints).toBe(10);      // 三阶随从从池里拿普通属性点
    expect(out.find((x) => x.id === 'C2')!.realAttrPoints).toBe(10);  // 五阶随从拿真实属性点
    expect(out.every((x) => x.skillPoints === 5)).toBe(true);
  });

  it('主角这次几乎没拿点数（E/D 微通关）→ 随从不发（空数组）', () => {
    expect(computeCompanionAwards({ attrPoints: 1, realAttrPoints: 0, skillPoints: 1 }, party)).toEqual([]);   // floor(1*0.5)=0
    expect(computeCompanionAwards({ attrPoints: 0, realAttrPoints: 0, skillPoints: 0 }, party)).toEqual([]);
  });

  it('无阶位随从按普通属性点发（四阶判定取不到→false）', () => {
    const out = computeCompanionAwards({ attrPoints: 10, realAttrPoints: 0, skillPoints: 4 }, [c({ id: 'C1', name: '小翠', isBond: true })]);
    expect(out[0].attrPoints).toBe(5); expect(out[0].realAttrPoints).toBe(0);
  });

  it('只发合格随从，跳过土著/死者/路人', () => {
    const mixed: CompanionLike[] = [
      c({ id: 'C1', name: '小翠', isBond: true, realm: '二阶' }),
      c({ id: 'C6', name: '村民', npcTag: '土著' }),
      c({ id: 'C8', name: '亡者', isBond: true, isDead: true }),
    ];
    const out = computeCompanionAwards({ attrPoints: 10, realAttrPoints: 0, skillPoints: 10 }, mixed);
    expect(out.map((x) => x.id)).toEqual(['C1']);
  });

  it('自定义比例覆盖默认', () => {
    const out = computeCompanionAwards({ attrPoints: 10, realAttrPoints: 0, skillPoints: 10 }, [c({ id: 'C1', name: '小翠', isBond: true })], { ratio: 1 });
    expect(out[0].attrPoints).toBe(10); expect(out[0].skillPoints).toBe(10);
    expect(COMPANION_SETTLE_RATIO).toBe(0.5);
  });

  it(`最多同步 ${MAX_SETTLE_COMPANIONS} 名随从`, () => {
    const many = Array.from({ length: MAX_SETTLE_COMPANIONS + 6 }, (_, i) => c({ id: `C${i + 1}`, name: `随从${i + 1}`, isBond: true }));
    const out = computeCompanionAwards({ attrPoints: 20, realAttrPoints: 0, skillPoints: 20 }, many);
    expect(out).toHaveLength(MAX_SETTLE_COMPANIONS);
  });
});
