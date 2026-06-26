import { describe, it, expect } from 'vitest';
import { normalizeGradeLabel, scoreToGradeNum, useItems, getItemLog, clearItemLog } from './itemStore';
import { useNpc } from './npcStore';

describe('scoreToGradeNum（评分 → 物品档位 1-14，区间同 ITEM_GRADE_TABLE_RULE）', () => {
  it('区间边界', () => {
    expect(scoreToGradeNum(10)).toBe(1);   // 白色上界
    expect(scoreToGradeNum(11)).toBe(2);   // 绿色下界
    expect(scoreToGradeNum(100)).toBe(4);  // 紫色 71~150
    expect(scoreToGradeNum(450)).toBe(8);  // 暗金 401~530
    expect(scoreToGradeNum(700)).toBe(9);  // 传说上界
    expect(scoreToGradeNum(701)).toBe(10); // 史诗下界
    expect(scoreToGradeNum(8001)).toBe(14); // 永恒（8000+）
  });
  it('缺失/非法 → 0', () => {
    expect(scoreToGradeNum(undefined)).toBe(0);
    expect(scoreToGradeNum(0)).toBe(0);
    expect(scoreToGradeNum('abc')).toBe(0);
  });
  it('容忍带文字的评分串', () => {
    expect(scoreToGradeNum('约120分')).toBe(4); // 120 → 紫色
  });
  it('★只取首个数字 token（评分带区间说明不被拼成大数·旧 bug）', () => {
    expect(scoreToGradeNum('28（绿色装备区间11~30分）')).toBe(2);  // 旧实现→「281130」→14；修复后取 28→绿色
    expect(scoreToGradeNum('100（紫色 71~150）')).toBe(4);          // 100 → 紫色
    expect(scoreToGradeNum('1001~1500')).toBe(11);                 // 范围取下界 1001 → 圣灵级
  });
});

describe('normalizeGradeLabel（一物一档·复合品级收敛护栏）', () => {
  it('★复合品级 + 评分 → 评分定档（评分权威）', () => {
    expect(normalizeGradeLabel('紫色/史诗', { score: 100 })).toEqual({ grade: '紫色', changed: true });
    // 同一复合标签、评分落在史诗区间 → 反向也信评分
    expect(normalizeGradeLabel('紫色/史诗', { score: 800 })).toEqual({ grade: '史诗级', changed: true });
  });

  it('★复合品级 + 多种分隔符（·/、）都能折叠', () => {
    expect(normalizeGradeLabel('暗金·史诗级', { score: 450 }).grade).toBe('暗金');
    expect(normalizeGradeLabel('暗金/史诗级', { score: 450 }).grade).toBe('暗金');
  });

  it('★剥离误用的技能品级词（普通/精良/稀有/奥义/极境）', () => {
    expect(normalizeGradeLabel('白色·普通')).toEqual({ grade: '白色', changed: true });
    expect(normalizeGradeLabel('蓝色/稀有')).toEqual({ grade: '蓝色', changed: true });
    expect(normalizeGradeLabel('蓝色·精良')).toEqual({ grade: '蓝色', changed: true });
  });

  it('复合品级无评分 → 取较低档（防越级爆品）', () => {
    expect(normalizeGradeLabel('紫色/史诗').grade).toBe('紫色');
  });

  it('numeric.grade 兜底定档（无评分时）', () => {
    expect(normalizeGradeLabel('紫色/史诗', { grade: 10 }).grade).toBe('史诗级');
  });

  it('折叠后保留尾部描述', () => {
    expect(normalizeGradeLabel('紫色/史诗·晓组织信物', { score: 100 }).grade).toBe('紫色·晓组织信物');
  });

  it('单一品级 + 合法描述后缀 → 原样保留（不误伤）', () => {
    expect(normalizeGradeLabel('紫色·带3条强化词缀的护甲', { score: 100 })).toEqual({
      grade: '紫色·带3条强化词缀的护甲',
      changed: false,
    });
  });

  it('★关键反例：描述里含品级字（金属/紫水晶）不被误判成复合', () => {
    expect(normalizeGradeLabel('暗金·金属之心', { score: 450 })).toEqual({ grade: '暗金·金属之心', changed: false });
    expect(normalizeGradeLabel('紫色·镶紫水晶', { score: 100 }).changed).toBe(false);
  });

  it('已是单一品级 / 空值 → 不动', () => {
    expect(normalizeGradeLabel('史诗级')).toEqual({ grade: '史诗级', changed: false });
    expect(normalizeGradeLabel('')).toEqual({ grade: '', changed: false });
    expect(normalizeGradeLabel(undefined)).toEqual({ grade: '', changed: false });
  });

  // ── 单标签越级收敛（评分封顶·只降不升） ──
  it('★单一档名【高于】评分档 → 按评分降档（杀越级爆品）', () => {
    expect(normalizeGradeLabel('史诗级', { score: 100 })).toEqual({ grade: '紫色', changed: true }); // 100→紫(4) < 史诗(10) → 降
    expect(normalizeGradeLabel('暗金', { score: 50 }).grade).toBe('蓝色');                            // 50→蓝(3) < 暗金(8) → 降
  });
  it('★降档保留尾部描述', () => {
    expect(normalizeGradeLabel('史诗级·晓组织信物', { score: 100 }).grade).toBe('紫色·晓组织信物');
  });
  it('★单一档名【低于/等于】评分档 → 不升档（不擅自抬升，防异常评分爆品）', () => {
    expect(normalizeGradeLabel('紫色', { score: 800 })).toEqual({ grade: '紫色', changed: false });   // 800→史诗 但只降不升
    expect(normalizeGradeLabel('蓝色', { score: 50 })).toEqual({ grade: '蓝色', changed: false });     // 50→蓝 相等
  });
  it('★评分缺失 → 单标签不动', () => {
    expect(normalizeGradeLabel('史诗级', {})).toEqual({ grade: '史诗级', changed: false });
    expect(normalizeGradeLabel('史诗级', { score: 'N/A' })).toEqual({ grade: '史诗级', changed: false });
  });
  it('★创世(神话档)：评分极高保留、评分低则降', () => {
    expect(normalizeGradeLabel('创世', { score: 9000 })).toEqual({ grade: '创世', changed: false });  // 9000→永恒(14)≥起源 → 保留创世
    expect(normalizeGradeLabel('创世', { score: 50 }).grade).toBe('蓝色');                            // 50→蓝 → 神话档误标，降
  });
});

describe('入库防御网 + 历史迁移（store 集成）', () => {
  it('addItem 入库即折叠复合品级（兜住扭蛋/赠予/导入路径）', () => {
    useItems.setState({ items: [] });
    useItems.getState().addItem({ name: '测试剑', category: '武器', gradeDesc: '紫色/史诗', score: '100', quantity: 1, effect: '', tags: [] } as any);
    expect(useItems.getState().items[0].gradeDesc).toBe('紫色');
  });

  it('normalizeGrades 扫历史背包旧物，返回收敛件数、净物不动', () => {
    useItems.setState({ items: [
      { id: 'A', name: '旧剑', category: '武器', gradeDesc: '暗金/史诗级', score: '450', quantity: 1, effect: '', equipped: false, tags: [], addedAt: 0 },
      { id: 'B', name: '净物', category: '武器', gradeDesc: '蓝色', quantity: 1, effect: '', equipped: false, tags: [], addedAt: 0 },
    ] as any });
    expect(useItems.getState().normalizeGrades()).toBe(1);
    expect(useItems.getState().items.find((i) => i.id === 'A')!.gradeDesc).toBe('暗金');
    expect(useItems.getState().items.find((i) => i.id === 'B')!.gradeDesc).toBe('蓝色');
    // 幂等：再跑一次应为 0
    expect(useItems.getState().normalizeGrades()).toBe(0);
  });

  it('normalizeItemGrades 扫 NPC 持有物', () => {
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '甲', items: [
      { id: 'X', name: 'NPC剑', category: '武器', gradeDesc: '白色·普通', quantity: 1, effect: '', equipped: false },
    ] } } as any });
    expect(useNpc.getState().normalizeItemGrades()).toBe(1);
    expect(useNpc.getState().npcs.C1.items[0].gradeDesc).toBe('白色');
  });
});

describe('dedupeByName（治"经常丢装备·就是消失·最近删除不显示"：只合并可堆叠真重复，绝不按名吞装备）', () => {
  it('★两件同名装备(一穿一备) → 都保留、绝不合并吞掉', () => {
    useItems.setState({ items: [
      { id: 'W1', name: '寒铁长剑', category: '武器', gradeDesc: '蓝色', quantity: 1, effect: '', equipped: true, equipSlot: 'weapon', tags: [], addedAt: 0 },
      { id: 'W2', name: '寒铁长剑', category: '武器', gradeDesc: '蓝色', quantity: 1, effect: '', equipped: false, tags: [], addedAt: 0 },
    ] as any });
    expect(useItems.getState().dedupeByName()).toBe(0);
    expect(useItems.getState().items.length).toBe(2);
  });

  it('★两件同名装备(都未穿·两次掉落) → 都保留', () => {
    useItems.setState({ items: [
      { id: 'W1', name: '精钢匕首', category: '武器', gradeDesc: '绿色', quantity: 1, effect: '', equipped: false, tags: [], addedAt: 0 },
      { id: 'W2', name: '精钢匕首', category: '武器', gradeDesc: '绿色', quantity: 1, effect: '', equipped: false, tags: [], addedAt: 0 },
    ] as any });
    expect(useItems.getState().dedupeByName()).toBe(0);
    expect(useItems.getState().items.length).toBe(2);
  });

  it('同名同品质可堆叠消耗品 → 合并累加数量（真重复）', () => {
    useItems.setState({ items: [
      { id: 'P1', name: '止血喷雾', category: '消耗品', gradeDesc: '白色', quantity: 3, effect: '', equipped: false, tags: [], addedAt: 0 },
      { id: 'P2', name: '止血喷雾', category: '消耗品', gradeDesc: '白色', quantity: 2, effect: '', equipped: false, tags: [], addedAt: 0 },
    ] as any });
    expect(useItems.getState().dedupeByName()).toBe(1);
    expect(useItems.getState().items.length).toBe(1);
    expect(useItems.getState().items[0].quantity).toBe(5);
  });

  it('同名不同品质消耗品 → 不合并（不同档分开）', () => {
    useItems.setState({ items: [
      { id: 'P1', name: '回血丹', category: '消耗品', gradeDesc: '白色', quantity: 1, effect: '', equipped: false, tags: [], addedAt: 0 },
      { id: 'P2', name: '回血丹', category: '消耗品', gradeDesc: '蓝色', quantity: 1, effect: '', equipped: false, tags: [], addedAt: 0 },
    ] as any });
    expect(useItems.getState().dedupeByName()).toBe(0);
    expect(useItems.getState().items.length).toBe(2);
  });

  it('★锁定的物品不参与合并（防误吞锁定物）', () => {
    useItems.setState({ items: [
      { id: 'M1', name: '材料X', category: '材料', gradeDesc: '白色', quantity: 1, effect: '', equipped: false, locked: true, tags: [], addedAt: 0 },
      { id: 'M2', name: '材料X', category: '材料', gradeDesc: '白色', quantity: 1, effect: '', equipped: false, tags: [], addedAt: 0 },
    ] as any });
    expect(useItems.getState().dedupeByName()).toBe(0);
    expect(useItems.getState().items.length).toBe(2);
  });
});

describe('物品流水审计（Phase 4-lite·离场事件记录·回答"东西去哪了")', () => {
  it('销毁/消耗/转出 都按回合记入流水', () => {
    clearItemLog();
    useItems.setState({ items: [
      { id: 'A', name: '剑', category: '武器', gradeDesc: '蓝色', quantity: 1, effect: '', equipped: false, tags: [], addedAt: 0 },
      { id: 'B', name: '药', category: '消耗品', gradeDesc: '白色', quantity: 1, effect: '', equipped: false, tags: [], addedAt: 0 },
      { id: 'C', name: '盾', category: '防具', gradeDesc: '蓝色', quantity: 1, effect: '', equipped: false, tags: [], addedAt: 0 },
    ] as any, recentlyDeleted: [], itemTurn: 7 });
    useItems.getState().binItem(useItems.getState().items.find((x) => x.id === 'A')!, { kind: 'broken', reason: '碎了' });
    useItems.getState().consumeItem('B', 1);
    useItems.getState().removeItem('C');
    const ops = getItemLog().map((e) => `${e.op}:${e.name}`);
    expect(ops).toContain('销毁/丢失:剑');
    expect(ops).toContain('消耗用尽:药');
    expect(ops).toContain('转出/移除:盾');
    expect(getItemLog().every((e) => e.turn === 7)).toBe(true);
  });

  it('同名合并也记入流水（标注未丢失）', () => {
    clearItemLog();
    useItems.setState({ items: [
      { id: 'P1', name: '药水', category: '消耗品', gradeDesc: '白色', quantity: 2, effect: '', equipped: false, tags: [], addedAt: 0 },
      { id: 'P2', name: '药水', category: '消耗品', gradeDesc: '白色', quantity: 3, effect: '', equipped: false, tags: [], addedAt: 0 },
    ] as any, itemTurn: 3 });
    useItems.getState().dedupeByName();
    expect(getItemLog().some((e) => e.op === '同名合并' && e.name === '药水')).toBe(true);
  });
});
