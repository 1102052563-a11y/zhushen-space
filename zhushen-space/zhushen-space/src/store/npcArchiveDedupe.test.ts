import { describe, it, expect, beforeEach } from 'vitest';
import { useNpc } from './npcStore';
import { useCharacters } from './characterStore';

/* 归档 NPC 不被自动去重吞掉 —— 治「归档了召唤回来不是同一个人 / 归档区为空 / 头像与档案没了」
   三态：在场 / 离场(AI自动·仍追踪) / 归档(玩家显式封存·独立第三态)。铁则：归档 ≠ 删除。
   旧 bug：facade 闸门每次变动扫重名时不排除 archived，AI 重新提及该角色时新建的同名档案与封存档撞名
          → dedupeByName 合并 → 评分里「onScene」白给新空壳 1 分 → 封存档落败被 delete + removeCharacter。*/

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

describe('★归档档案不被自动去重卷入（归档=玩家封存·独立第三态）', () => {
  it('归档档案 + AI 新建同名档案 → 封存档完好存活，归档标记不被解除', () => {
    useNpc.setState({ npcs: { C3: rich('C3', '克劳德') as any, C15: freshShell('C15', '克劳德') as any } });
    const npcs = useNpc.getState().npcs;
    expect(npcs['C3']).toBeTruthy();            // 封存档没被删
    expect(npcs['C3'].archived).toBe(true);     // 归档态没被自动解除（归档区不会凭空变空）
  });

  it('封存档的技能/天赋不被 removeCharacter 连坐清除', () => {
    // ⚠ 先播种 characterStore：facade 闸门在 npc setState 那一刻就会跑，晚播种会假通过
    useCharacters.setState({ characters: { C3: { skills: [{ name: '限界技·凶斩' }], talents: [], titles: [], subProfessions: [] } as any } });
    useNpc.setState({ npcs: { C3: rich('C3', '克劳德') as any, C15: freshShell('C15', '克劳德') as any } });
    useNpc.getState().dedupeByName();
    expect(useCharacters.getState().characters['C3']?.skills?.length).toBe(1);
  });

  it('归档态不参与重名分组 → 两个非归档同名仍照常合并（没把去重整个关掉）', () => {
    useNpc.setState({ npcs: {
      C7: freshShell('C7', '蒂法·洛克哈特', { onScene: false, deedLog: [{ description: '第七天堂酒吧' }] }) as any,
      C9: freshShell('C9', '蒂法·洛克哈特') as any,
    } });
    useNpc.getState().dedupeByName();
    expect(Object.keys(useNpc.getState().npcs).length).toBe(1);   // 非归档重复档 → 仍会合并
  });
});

describe('★留谁删谁：数据丰满度说了算，「在场」不再白送分', () => {
  it('★老档案(离场·有经历) vs 新空壳(在场·无经历) → 老档案胜出并存活（旧公式此处会反过来删掉老档案）', () => {
    // 旧公式：老档 2+1+1+1+deedLog(1)+onScene(0)=6 ／ 新壳 2+1+1+1+0+onScene(1)=6 → 平手 → id 决胜 'C15'<'C3' → 新壳赢 → 老档被删
    useNpc.setState({ npcs: {
      C3: freshShell('C3', '克劳德', { onScene: false, deedLog: [{ description: '击败萨菲罗斯' }] }) as any,
      C15: freshShell('C15', '克劳德') as any,
    } });
    useNpc.getState().dedupeByName();
    const npcs = useNpc.getState().npcs;
    expect(npcs['C3']).toBeTruthy();     // 有经历的老档案活下来
    expect(npcs['C15']).toBeFalsy();     // 空壳并入它
    expect(npcs['C3'].onScene).toBe(true);   // 空壳在场 → 合并结果视为在场（保留原不变量）
  });

  it('★玩家解除归档召回后，与空壳合并仍保住封存档（召唤回来还是同一个人）', () => {
    // 玩家点「重新上场」= upsertNpc(id,{onScene:true,archived:false})，此后才与空壳同组
    useNpc.setState({ npcs: {
      C3: rich('C3', '克劳德', { archived: false, onScene: true, deedLog: [{ description: '击败萨菲罗斯' }], items: [{ id: 'W1', name: '破坏剑' }] }) as any,
      C15: freshShell('C15', '克劳德') as any,
    } });
    useNpc.getState().dedupeByName();
    const npcs = useNpc.getState().npcs;
    expect(npcs['C3']).toBeTruthy();
    expect(npcs['C3'].deedLog?.length).toBe(1);          // 经历还在（deedLog 可选 → 用 ?.；真丢了就是 undefined≠1 照样红）
    expect(npcs['C3'].items.map((i: any) => i.id)).toContain('W1');   // 装备还在
  });
});

describe('★合并不丢感情线（治「并肩作战谈恋爱→召唤回来当我是陌生变态」）', () => {
  it('★经历时间线两边并起来、不重复、且按时间重排（不乱序）', () => {
    // addedAt = appendDeed 建条目时盖的时间戳；两份经历交错并入后须按它重排
    useNpc.setState({ npcs: {
      C3: freshShell('C3', '克劳德', { onScene: false, deedLog: [
        { time: '第3日', location: '米德加', description: '并肩击退神罗兵', addedAt: 1000 },
        { time: '第5日', location: '教堂', description: '一起看花', addedAt: 2000 },
      ] }) as any,
      C15: freshShell('C15', '克劳德', { deedLog: [
        { time: '第5日', location: '教堂', description: '一起看花', addedAt: 2000 },   // 与老档重复 → 不应变成两条
        { time: '第9日', location: '古代种神殿', description: '约定同行', addedAt: 3000 },
      ] }) as any,
    } });
    useNpc.getState().dedupeByName();
    const survivor = Object.values(useNpc.getState().npcs)[0] as any;
    expect(survivor.deedLog.map((d: any) => d.description))
      .toEqual(['并肩击退神罗兵', '一起看花', '约定同行']);   // 三条历史都在、重复的只留一条、且按时间顺序
  });

  it('★好感度/四轴态度取较大值 → 合并绝不让关系进度倒退', () => {
    useNpc.setState({ npcs: {
      C3: freshShell('C3', '克劳德', { onScene: false, favor: 95, trust: 80, respect: 70, corruption: 40,
        deedLog: [{ description: '共同经历' }] }) as any,
      C15: freshShell('C15', '克劳德', { favor: 0, trust: 10, respect: 10, corruption: 0 }) as any,   // AI 新建空壳＝默认值
    } });
    useNpc.getState().dedupeByName();
    const survivor = Object.values(useNpc.getState().npcs)[0] as any;
    expect(survivor.favor).toBe(95);
    expect(survivor.trust).toBe(80);
    expect(survivor.respect).toBe(70);
    expect(survivor.corruption).toBe(40);
  });

  it('★关系/内心/自述/原则等人设字段不再蒸发（旧列表只补 12 个字段）', () => {
    useNpc.setState({ npcs: {
      C15: freshShell('C15', '克劳德', { relations: '', innerThought: '', selfNarration: '', principles: '', callPlayer: '' }) as any,
      C3: freshShell('C3', '克劳德', { onScene: false, deedLog: [{ description: '共同经历' }],
        relations: 'B1:恋人', innerThought: '想守护她', selfNarration: '我是克劳德·斯特莱夫',
        principles: '绝不抛下同伴', callPlayer: '搭档' }) as any,
    } });
    useNpc.getState().dedupeByName();
    const survivor = Object.values(useNpc.getState().npcs)[0] as any;
    expect(survivor.relations).toBe('B1:恋人');       // ← 旧代码这里会是 ''
    expect(survivor.innerThought).toBe('想守护她');
    expect(survivor.selfNarration).toBe('我是克劳德·斯特莱夫');
    expect(survivor.principles).toBe('绝不抛下同伴');
    expect(survivor.callPlayer).toBe('搭档');
  });

  it('★长期保留/羁绊/好友标记任一为真即保留（合并不悄悄降级）', () => {
    useNpc.setState({ npcs: {
      C3: freshShell('C3', '克劳德', { onScene: false, keepForever: true, isBond: true, isFriend: true,
        deedLog: [{ description: '共同经历' }] }) as any,
      C15: freshShell('C15', '克劳德') as any,
    } });
    useNpc.getState().dedupeByName();
    const survivor = Object.values(useNpc.getState().npcs)[0] as any;
    expect(survivor.keepForever).toBe(true);
    expect(survivor.isBond).toBe(true);
    expect(survivor.isFriend).toBe(true);
  });
});
