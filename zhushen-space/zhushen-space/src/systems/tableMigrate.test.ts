import { describe, it, expect, beforeEach } from 'vitest';
import { migrateStoresToTables, projectStoresToTables } from './tableMigrate';
import { useTables } from '../store/tableStore';
import { usePlayer } from '../store/playerStore';
import { useGame } from '../store/gameStore';
import { useItems } from '../store/itemStore';
import { useNpc } from '../store/npcStore';
import { useMisc } from '../store/miscStore';
import { useCharacters } from '../store/characterStore';
import { useFaction } from '../store/factionStore';
import { useResource } from '../store/resourceStore';

beforeEach(() => {
  useTables.getState().resetAll();
  usePlayer.setState({ profile: { name: '苏晓', tier: '一阶', level: 5, title: '新人', identity: '契约者', location: '主神空间', worldSource: 0, profession: '剑士', bioStrength: 'T3·勇士', race: '人类', gender: '男', homeParadise: '轮回乐园', contractorId: 'K-0721', brandLevel: '3', arenaRank: '青铜', attrs: { str: 100, agi: 20, con: 30, int: 40, cha: 10, luck: 5 }, realAttrs: { str: 8 }, attrPoints: 3, realAttrPoints: 2, appearance: '黑衣少年', personality: '冷静' } } as any);
  useGame.setState({ player: { hp: 80, maxHp: 100, mp: 40, maxMp: 60, san: 90, maxSan: 100 } } as any);
  useItems.setState({ currency: { 乐园币: 500, 魂币: 3 }, items: [{ id: 'i1', name: '铁剑', category: '武器', gradeDesc: '普通', quantity: 1, equipped: true, equipSlot: 'weapon' }] } as any);
  useNpc.setState({ npcs: { C1: { id: 'C1', name: '张三', relations: 'B1:盟友', favor: 60, realm: '二阶', status: '正常', personality: '豪爽', attrs: { str: 50, agi: 15, con: 20, int: 25, cha: 12, luck: 3 } }, C2: { id: 'C2', name: 'C2', relations: '' } } } as any);
  useMisc.setState({ paradiseTime: '第3天', worldTime: '', weather: '晴', turnCount: 12 } as any);
  useCharacters.setState({ characters: {} } as any);   // 防跨测试泄漏（技能/天赋/称号/副职业来源）
  useFaction.setState({ factions: {} } as any);
  useResource.setState({ resources: [] } as any);
});

describe('migrateStoresToTables（Step 7 迁移）', () => {
  it('主角信息表 ← player + game', () => {
    migrateStoresToTables({ overwrite: true });
    const t = useTables.getState();
    expect(t.getCell('protagonist_info', 0, '姓名')).toBe('苏晓');
    expect(t.getCell('protagonist_info', 0, '力量')).toBe('100');
    expect(t.getCell('protagonist_info', 0, 'HP')).toBe('80');
    expect(t.getCell('protagonist_info', 0, 'HP上限')).toBe('100');
  });

  it('★真实属性仅在有直加时显示（无直加留空·不与基础重复）', () => {
    migrateStoresToTables({ overwrite: true });
    const t = useTables.getState();
    expect(t.getCell('protagonist_info', 0, '力量')).toBe('100');        // 基础
    expect(t.getCell('protagonist_info', 0, '真实力量')).toBe('108');    // 有直加8 → 100+8
    expect(t.getCell('protagonist_info', 0, '真实幸运')).toBe('');       // 无直加 → 留空（治"真实与普通重合"）
    expect(t.getCell('protagonist_info', 0, '职业')).toBe('剑士');
    expect(t.getCell('protagonist_info', 0, '生物强度')).toBe('T3·勇士');
    expect(t.getCell('protagonist_info', 0, '真实属性点')).toBe('2');
  });

  it('★背包表全字段（对齐物品演化固定格式）', () => {
    useItems.setState({ items: [{ id: 'I_B1_01', name: '磨损的军队作训服', category: '防具', subType: '上衣', gradeDesc: '白色',
      quantity: 1, equipped: true, equipSlot: 'armor:upper', combatStat: '防御力 2', durability: '12/25', score: '5',
      acquisition: '初始装备补全', requirement: '无', affix: '', effect: '提供基础防护', intro: '与那个世界最后的联系', notes: '初始装备补全', tags: ['防具'] }] } as any);
    migrateStoresToTables({ overwrite: true });
    const r = useTables.getState().rows('inventory')[0];
    expect(r['物品ID']).toBe('I_B1_01');
    expect(r['攻击防御']).toBe('防御力 2');
    expect(r['耐久度']).toBe('12/25');
    expect(r['评分']).toBe('5');
    expect(r['获得途径']).toBe('初始装备补全');
    expect(r['简介']).toBe('与那个世界最后的联系');
  });

  it('★理智值随 gameStore.san 填入（不再空）', () => {
    migrateStoresToTables({ overwrite: true });
    const t = useTables.getState();
    expect(t.getCell('protagonist_info', 0, '理智')).toBe('90');
    expect(t.getCell('protagonist_info', 0, '理智上限')).toBe('100');
  });

  it('★主角身份字段列（种族/性别/所属乐园/契约者编号/烙印/竞技场排名）', () => {
    migrateStoresToTables({ overwrite: true });
    const t = useTables.getState();
    expect(t.getCell('protagonist_info', 0, '种族')).toBe('人类');
    expect(t.getCell('protagonist_info', 0, '所属乐园')).toBe('轮回乐园');
    expect(t.getCell('protagonist_info', 0, '契约者编号')).toBe('K-0721');
    expect(t.getCell('protagonist_info', 0, '竞技场排名')).toBe('青铜');
  });

  it('★NPC 六维=基础 + 真实六维（有真实属性点直加才显示）', () => {
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '张三', realm: '二阶',
      attrs: { str: 50, agi: 15, con: 20, int: 25, cha: 12, luck: 3 }, realAttrs: { str: 6 } } } } as any);
    migrateStoresToTables({ overwrite: true });
    const r = useTables.getState().rows('important_characters')[0];
    expect(r['力量']).toBe('50');        // 基础
    expect(r['智力']).toBe('25');
    expect(r['真实力量']).toBe('56');    // 50 + 6 直加
    expect(r['真实智力']).toBe('');      // 无直加 → 留空（不与基础重复）
  });

  it('★重要角色表补 NPC 标量字段（性别/职业/背景/动机…）', () => {
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '张三', realm: '二阶', attrs: { str: 50 },
      gender: '男', profession: '剑客', bioStrength: 'T2·精英', age: '约30', npcTag: '契约者',
      hp: 120, maxHp: 150, background: '流浪剑客', motiveNow: '寻找宿敌', shortGoal: '变强', callPlayer: '兄弟', innerThought: '不能输' } } } as any);
    migrateStoresToTables({ overwrite: true });
    const r = useTables.getState().rows('important_characters')[0];
    expect(r['性别']).toBe('男');
    expect(r['职业']).toBe('剑客');
    expect(r['生物强度']).toBe('T2·精英');
    expect(r['背景']).toBe('流浪剑客');
    expect(r['动机']).toBe('寻找宿敌');
    expect(r['HP上限']).toBe('150');
  });

  it('★NPC 物品/技能/天赋进独立明细表（按 归属NPC 关联）', () => {
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '张三', realm: '二阶',
      items: [{ id: 'I_C1_01', name: '断剑', category: '武器', gradeDesc: '蓝色', quantity: 1, equipped: true, equipSlot: 'weapon', combatStat: '攻击 20', durability: '30/40' }] } } } as any);
    useCharacters.setState({ characters: { C1: { id: 'C1',
      skills: [{ name: '斩击', rarity: '精良', skillType: '主动', target: '单体', addedAt: 0 }],
      traits: [{ name: '剑心', rarity: 'B', effect: '暴击+5%', addedAt: 0 }],
    } } } as any);
    projectStoresToTables();
    const t = useTables.getState();
    const item = t.rows('npc_items')[0];
    expect(item['归属NPC']).toBe('张三');
    expect(item['物品名称']).toBe('断剑');
    expect(item['攻击防御']).toBe('攻击 20');
    const sk = t.rows('npc_skills')[0];
    expect(sk['归属NPC']).toBe('张三');
    expect(sk['技能名称']).toBe('斩击');
    expect(sk['目标']).toBe('单体');
    const tr = t.rows('npc_talents')[0];
    expect(tr['归属NPC']).toBe('张三');
    expect(tr['天赋名称']).toBe('剑心');
  });

  it('★主角状态/Buff 列 = status + 限时状态名', () => {
    usePlayer.setState({ profile: { ...usePlayer.getState().profile, status: '中毒', statusEffects: [{ name: '狂暴' }, { name: '护盾' }] } } as any);
    migrateStoresToTables({ overwrite: true });
    expect(useTables.getState().getCell('protagonist_info', 0, '状态')).toBe('中毒 ｜ 狂暴 ｜ 护盾');
  });

  it('★副职业表 ← characterStore B1.subProfessions（含配方名）', () => {
    useCharacters.setState({ characters: { B1: { id: 'B1', skills: [], traits: [], subProfessions: [
      { name: '炼金术', tier: '专家', progress: 60, category: '制造', recipeLabel: '药方', effect: '可炼中级药剂', desc: '瓶瓶罐罐',
        recipes: [{ name: '治疗药剂' }, { name: '力量药剂' }] },
    ] } } } as any);
    projectStoresToTables();
    const r = useTables.getState().rows('subprofessions');
    expect(r.length).toBe(1);
    expect(r[0]['名称']).toBe('炼金术');
    expect(r[0]['档位']).toBe('专家');
    expect(r[0]['配方']).toBe('治疗药剂、力量药剂');
  });

  it('★成就表 ← playerStore.achievements', () => {
    usePlayer.setState({ profile: { ...usePlayer.getState().profile, achievements: [
      { name: '初次击杀', category: '战斗', type: '普通', rarity: '蓝', hidden: false, condition: '击杀首个敌人', unlockTime: '第1天' },
    ] } } as any);
    projectStoresToTables();
    const r = useTables.getState().rows('achievements');
    expect(r[0]['成就名称']).toBe('初次击杀');
    expect(r[0]['是否隐藏']).toBe('否');
  });

  it('★自定义能量条表 ← resourceStore', () => {
    useResource.setState({ resources: [
      { id: 'rage', name: '怒气值', cur: 40, max: 100, color: '', desc: '战斗攒怒' },
      { id: 'corr', name: '堕落值', cur: 5, maxFormula: { int: 30 }, desc: '' },
    ] } as any);
    projectStoresToTables();
    const r = useTables.getState().rows('resources');
    expect(r.length).toBe(2);
    expect(r.find((x) => x['名称'] === '怒气值')?.['当前值']).toBe('40');
    expect(r.find((x) => x['名称'] === '堕落值')?.['上限']).toBe('六维公式');
  });

  it('货币表 ← currency', () => {
    migrateStoresToTables({ overwrite: true });
    const rows = useTables.getState().rows('currency');
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r['货币名称'] === '乐园币')?.['数量']).toBe('500');
  });

  it('背包表 ← items（含装备标记）', () => {
    migrateStoresToTables({ overwrite: true });
    const r = useTables.getState().rows('inventory');
    expect(r.length).toBe(1);
    expect(r[0]['物品名称']).toBe('铁剑');
    expect(r[0]['已装备']).toBe('是');
  });

  it('重要角色表 ← npcs（跳过无名/编号 C2）', () => {
    migrateStoresToTables({ overwrite: true });
    const r = useTables.getState().rows('important_characters');
    expect(r.length).toBe(1);
    expect(r[0]['姓名']).toBe('张三');
    expect(r[0]['好感度']).toBe('60');
  });

  it('★宠物/召唤物表 ← npcs（宠物/召唤物从重要角色表分流出去）', () => {
    useNpc.setState({ npcs: {
      C1: { id: 'C1', name: '张三', relations: 'B1:盟友', favor: 60, realm: '二阶', status: '正常' },
      C3: { id: 'C3', name: '小黑', npcTag: '宠物', bodyType: '兽形', realm: '一阶', status: '跟随中', attrs: { str: 30, agi: 40, con: 20, int: 8, cha: 15, luck: 5 } },
      G1: { id: 'G1', name: '火元素', npcTag: '召唤物', bodyType: '非人形', realm: '三阶', status: '已召唤' },
    } } as any);
    migrateStoresToTables({ overwrite: true });
    const t = useTables.getState();
    // 重要角色表只剩非宠物 NPC（张三）
    const imp = t.rows('important_characters');
    expect(imp.length).toBe(1);
    expect(imp[0]['姓名']).toBe('张三');
    // 宠物/召唤物表拿到两只，带形态
    const pets = t.rows('pet_summons');
    expect(pets.map((r) => r['姓名']).sort()).toEqual(['小黑', '火元素']);
    const hei = pets.find((r) => r['姓名'] === '小黑')!;
    expect(hei['标签']).toBe('宠物');
    expect(hei['形态']).toBe('兽形');
    expect(pets.find((r) => r['姓名'] === '火元素')!['形态']).toBe('非人形');
  });

  it('世界状态表 ← misc', () => {
    migrateStoresToTables({ overwrite: true });
    const t = useTables.getState();
    expect(t.getCell('global_state', 0, '天气')).toBe('晴');
    expect(t.getCell('global_state', 0, '回合数')).toBe('12');
  });

  it('overwrite=false 只填空表（不覆盖已有）', () => {
    const t = useTables.getState();
    t.insertRow('inventory', { 物品名称: '已有物' });
    migrateStoresToTables({ overwrite: false });
    const names = t.rows('inventory').map((r) => r['物品名称']);
    expect(names).toContain('已有物');
    expect(names).not.toContain('铁剑');
  });

  it('overwrite=true 清空重灌', () => {
    const t = useTables.getState();
    t.insertRow('inventory', { 物品名称: '旧物' });
    migrateStoresToTables({ overwrite: true });
    expect(t.rows('inventory').map((r) => r['物品名称'])).toEqual(['铁剑']);
  });
});

describe('projectStoresToTables（1c 每回合投影·store=单一真相·表=只读投影）', () => {
  it('★AI 乱填的镜像表被 store 投影覆盖（漂移从构造上消除）', () => {
    const t = useTables.getState();
    t.insertRow('inventory', { 物品名称: '幻觉神装', 数量: '99' });   // 模拟 AI 用 <tableEdit> 往镜像表塞假货
    projectStoresToTables();
    const names = t.rows('inventory').map((r) => r['物品名称']);
    expect(names).toEqual(['铁剑']);          // 幻觉神装被覆盖掉，只剩 store 真值
    expect(names).not.toContain('幻觉神装');
  });

  it('★投影不动纪要表（编年史=AI 原生只追加·不是镜像）', () => {
    const t = useTables.getState();
    t.insertRow('chronicle', { 时间: '第1天', 地点: '新手村', 事件: '苏醒' });
    projectStoresToTables();
    const c = t.rows('chronicle');
    expect(c.length).toBe(1);
    expect(c[0]['事件']).toBe('苏醒');       // 编年史原样保留，投影绝不碰
  });

  it('★投影不动进程/伏笔/约定表（AI 原生剧情记忆表·非镜像·跨回合记长线剧情）', () => {
    const t = useTables.getState();
    t.insertRow('progress', { 进程名: '变身进程', 类型: '变身', 当前: '30', 目标: '100', 状态: '进行中' });
    t.insertRow('foreshadowing', { 伏笔: '黑袍人始终不摘兜帽', 状态: '埋下' });
    t.insertRow('pacts', { 对象: '苏晓', 约定内容: '十年后再战', 状态: '生效' });
    projectStoresToTables();
    expect(t.rows('progress').length).toBe(1);
    expect(t.rows('progress')[0]?.['当前']).toBe('30');           // 进度原样保留，投影绝不碰
    expect(t.rows('foreshadowing')[0]?.['伏笔']).toBe('黑袍人始终不摘兜帽');
    expect(t.rows('pacts')[0]?.['对象']).toBe('苏晓');
  });

  it('技能/天赋/称号 ← characterStore B1（全字段）', () => {
    useCharacters.setState({ characters: { B1: { id: 'B1',
      skills: [{ name: '火球术', rarity: '精良', level: 'Lv.3', skillType: '主动', target: '单体', damage: '法术180%', attrBonus: '智力+5', tags: ['火'], effect: '烧', addedAt: 0 }],
      traits: [{ name: '火之亲和', rarity: 'B', category: '能量', source: '血脉', effect: '火伤+10%', attrBonus: '法强+8', addedAt: 0 }],
      titles: [{ name: '烈焰使', rarity: '蓝', source: '副本', obtainedTime: '第2天', effect: '火抗+5', equipped: true, addedAt: 0 }],
    } } } as any);
    projectStoresToTables();
    const t = useTables.getState();
    const sk = t.rows('protagonist_skills')[0];
    expect(sk?.['技能名称']).toBe('火球术');
    expect(sk?.['归属']).toBe('B1');
    expect(sk?.['目标']).toBe('单体');
    expect(sk?.['属性加成']).toBe('智力+5');
    expect(sk?.['标签']).toBe('火');
    expect(t.rows('talents')[0]?.['类型']).toBe('能量');
    expect(t.rows('talents')[0]?.['属性加成']).toBe('法强+8');
    expect(t.rows('titles')[0]?.['品级']).toBe('蓝');
    expect(t.rows('titles')[0]?.['获得时间']).toBe('第2天');
    expect(t.rows('titles')[0]?.['佩戴']).toBe('是');
  });

  it('势力 ← factionStore（跳过已覆灭）', () => {
    useFaction.setState({ factions: {
      F1: { id: 'F1', name: '天启教', powerLevel: '大型', scale: '巨型', relations: '敌对', goal: '灭世' },
      F2: { id: 'F2', name: '残党', isDestroyed: true },
    } } as any);
    projectStoresToTables();
    const r = useTables.getState().rows('factions');
    expect(r.length).toBe(1);
    expect(r[0]['势力名称']).toBe('天启教');
  });

  it('投影是幂等的（连跑两次结果一致·无累积重复）', () => {
    projectStoresToTables();
    projectStoresToTables();
    const t = useTables.getState();
    expect(t.rows('inventory').length).toBe(1);       // 不会因跑两次变两行
    expect(t.rows('currency').length).toBe(2);
    expect(t.getCell('protagonist_info', 0, '姓名')).toBe('苏晓');
  });
});
