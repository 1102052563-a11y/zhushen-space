import { describe, it, expect, beforeEach } from 'vitest';
import {
  usableName, scanEntities, getCodexIndex, resetCodexIndex, lookupCodex,
  type CodexEntry, type CodexIndex,
} from './codexIndex';
import { useNpc } from '../store/npcStore';
import { useItems } from '../store/itemStore';
import { useCharacters } from '../store/characterStore';
import { useFaction } from '../store/factionStore';
import { useCosmos } from '../store/cosmosStore';
import { useTerritory } from '../store/territoryStore';
import { useTeam } from '../store/adventureTeamStore';

/* 手搓一部只含指定字面名的索引，用来单独测扫描器（不掺 store 状态） */
function mkIdx(names: string[]): CodexIndex {
  const byKey = new Map<string, CodexEntry>();
  const byName = new Map<string, CodexEntry>();
  const heads = new Set<string>();
  let maxLen = 0;
  names.forEach((nm, i) => {
    const e: CodexEntry = { key: `n:t${i}`, kind: 'npc', accent: 'person', kindLabel: '人物', name: nm, icon: '👤', lines: [] };
    byKey.set(e.key, e);
    byName.set(nm.toLowerCase(), e);
    heads.add(nm[0].toLowerCase());
    if (nm.length > maxLen) maxLen = nm.length;
  });
  return { version: 1, byKey, byName, heads, maxLen, size: byName.size };
}
const hits = (text: string, names: string[]) =>
  scanEntities(text, mkIdx(names), new Set()).map((m) => text.slice(m.start, m.end));

function clearStores() {
  useNpc.setState({ npcs: {} } as any);
  useItems.setState({ items: [] } as any);
  useCharacters.setState({ characters: {} } as any);
  useFaction.setState({ factions: {} } as any);
  useCosmos.setState({ entities: [] } as any);
  useTerritory.setState({ unlocked: false, name: '', buildings: [], effects: [] } as any);
  useTeam.setState({ perks: [] } as any);
  resetCodexIndex();
}

describe('usableName · 什么名字配进词典', () => {
  beforeEach(clearStores);

  it('正常中文名原样收下', () => {
    expect(usableName('苏晓')).toBe('苏晓');
    expect(usableName('  神威·空洞褫夺 ')).toBe('神威·空洞褫夺');
  });

  it('单字名一律拒收——否则「刀」会把正文每个刀字都划线', () => {
    expect(usableName('刀')).toBeNull();
    expect(usableName('影')).toBeNull();
  });

  it('内部 id 形态（C1/G12/B1/F3）拒收', () => {
    for (const s of ['C1', 'G12', 'B1', 'F3', 'c9']) expect(usableName(s)).toBeNull();
  });

  it('停用词拒收：真有实体叫这名也不标，宁可漏一个也不能满屏下划线', () => {
    for (const s of ['世界', '乐园', '技能', '状态', '契约者', 'HP', 'hp']) expect(usableName(s)).toBeNull();
  });

  it('纯 ASCII 要 ≥4 字符（挡掉 EP/Lv/atk 这类缩写）', () => {
    expect(usableName('Lv')).toBeNull();
    expect(usableName('atk')).toBeNull();
    expect(usableName('Fire')).toBe('Fire');
  });

  it('剥掉装饰括号，剥完再判长度', () => {
    expect(usableName('「圣剑」')).toBe('圣剑');
    expect(usableName('【深渊】')).toBe('深渊');
    expect(usableName('（刀）')).toBeNull();
  });

  it('纯标点/纯数字/超长名拒收', () => {
    expect(usableName('。。。')).toBeNull();
    expect(usableName('12345')).toBeNull();
    expect(usableName('一'.repeat(30))).toBeNull();
  });
});

describe('scanEntities · 扫描器', () => {
  it('最长优先：同时存在「苏晓」和「苏晓的剑」时命中长的', () => {
    expect(hits('苏晓的剑很锋利', ['苏晓', '苏晓的剑'])).toEqual(['苏晓的剑']);
  });

  it('每条消息只标首次：同名出现多次只产出一个匹配', () => {
    expect(hits('苏晓走了，苏晓又回来了，苏晓真忙', ['苏晓'])).toEqual(['苏晓']);
  });

  it('seen 跨调用共享 → 前一行标过的，后一行不再标', () => {
    const idx = mkIdx(['苏晓']);
    const seen = new Set<string>();
    expect(scanEntities('苏晓来了', idx, seen)).toHaveLength(1);
    expect(scanEntities('苏晓又来了', idx, seen)).toHaveLength(0);
  });

  it('不重叠：命中后从词尾继续扫', () => {
    const out = scanEntities('阿尔法贝塔', mkIdx(['阿尔法', '贝塔']), new Set());
    expect(out.map((m) => [m.start, m.end])).toEqual([[0, 3], [3, 5]]);
  });

  it('纯 ASCII 名要求词边界：Fire 不该命中 Firewall', () => {
    expect(hits('the Firewall burned', ['Fire'])).toEqual([]);
    expect(hits('he cast Fire again', ['Fire'])).toEqual(['Fire']);
  });

  it('ASCII 大小写不敏感，且长度不变形（下标仍对得上原文）', () => {
    const out = scanEntities('he cast FIRE now', mkIdx(['Fire']), new Set());
    expect(out).toHaveLength(1);
    expect('he cast FIRE now'.slice(out[0].start, out[0].end)).toBe('FIRE');
  });

  it('中文名紧贴其它字也命中（中文没有词边界概念）', () => {
    expect(hits('那把圣剑斩下', ['圣剑'])).toEqual(['圣剑']);
  });

  it('空文本 / 空词典安全返回', () => {
    expect(scanEntities('', mkIdx(['苏晓']), new Set())).toEqual([]);
    expect(scanEntities('苏晓', mkIdx([]), new Set())).toEqual([]);
  });
});

describe('getCodexIndex · 按 store 现状编词典', () => {
  beforeEach(clearStores);

  it('NPC 进词典，带阶位副标题与跳详情用的 npcId', () => {
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '苏晓', realm: '绝强·Lv.95', title: '星界监守者', status: '在场' } } } as any);
    const e = getCodexIndex().byName.get('苏晓');
    expect(e?.key).toBe('n:C1');
    expect(e?.kind).toBe('npc');
    expect(e?.accent).toBe('person');
    expect(e?.npcId).toBe('C1');
    expect(e?.meta).toContain('绝强·Lv.95');
    expect(e?.meta).toContain('星界监守者');
  });

  it('没起名的 NPC（name 还是 C2 这种占位）不进词典', () => {
    useNpc.setState({ npcs: { C2: { id: 'C2', name: 'C2' }, C3: { id: 'C3', name: '' } } } as any);
    expect(getCodexIndex().byKey.size).toBeGreaterThan(0);            // 阶位常驻，索引不会空
    expect(getCodexIndex().byKey.has('n:C2')).toBe(false);
    expect(getCodexIndex().byKey.has('n:C3')).toBe(false);
  });

  it('撞名按注册顺序定优先级：NPC 压过同名物品', () => {
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '影刃' } } } as any);
    useItems.setState({ items: [{ id: 'i1', name: '影刃', gradeDesc: '史诗级' }] } as any);
    expect(getCodexIndex().byName.get('影刃')?.key).toBe('n:C1');
  });

  it('复合名的分隔段也能命中，但全名优先（分隔段延后注册）', () => {
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '神威·空洞褫夺' } } } as any);
    const idx = getCodexIndex();
    expect(idx.byName.get('神威·空洞褫夺')?.key).toBe('n:C1');
    expect(idx.byName.get('空洞褫夺')?.key).toBe('n:C1');
    expect(idx.byName.has('神威')).toBe(false);                        // ≥3 字才收段，「神威」太通用
    const out = scanEntities('神威·空洞褫夺出鞘', idx, new Set());
    expect('神威·空洞褫夺出鞘'.slice(out[0].start, out[0].end)).toBe('神威·空洞褫夺');
  });

  it('14 阶常驻——新玩家最想悬浮的就是「绝强是什么」', () => {
    const idx = getCodexIndex();
    expect(idx.byName.get('绝强')?.kind).toBe('tier');
    expect(idx.byName.get('无上之境')?.kind).toBe('tier');
    expect(idx.byName.get('绝强')?.lines.join()).toContain('1000');    // 单属性极值
  });

  it('万族只收主角已知晓的，没接触过的不该在正文里被剧透', () => {
    useCosmos.setState({ entities: [
      { id: 'co1', name: '死亡乐园', category: '乐园', isPlayerKnown: true, status: '鼎盛' },
      { id: 'co2', name: '天启乐园', category: '乐园', isPlayerKnown: false, status: '鼎盛' },
    ] } as any);
    const idx = getCodexIndex();
    expect(idx.byName.has('死亡乐园')).toBe(true);
    expect(idx.byName.has('天启乐园')).toBe(false);
  });

  it('技能/天赋/称号/副职业配方都进词典，四色系分对', () => {
    useCharacters.setState({ characters: { B1: {
      id: 'B1',
      skills: [{ id: 'S1', name: '幽冥闪', rarity: '天级', desc: '瞬移' }],
      traits: [{ name: '不屈意志', rarity: 'SS', desc: '濒死不倒' }],
      titles: [{ name: '弑神者', rarity: 'S', effect: '威慑' }],
      subProfessions: [{ name: '炼金术士', tier: '大师', recipes: [{ id: 'R1', name: '贤者之石', tier: '大师' }] }],
    } } } as any);
    const idx = getCodexIndex();
    expect(idx.byName.get('幽冥闪')?.accent).toBe('power');
    expect(idx.byName.get('不屈意志')?.kind).toBe('talent');
    expect(idx.byName.get('弑神者')?.kind).toBe('title');
    expect(idx.byName.get('炼金术士')?.kind).toBe('subprof');
    expect(idx.byName.get('贤者之石')?.kind).toBe('subprof');
  });

  it('势力=世界色，物品=物件色', () => {
    useFaction.setState({ factions: { F1: { id: 'F1', name: '暗影议会', type: '教会' } } } as any);
    useItems.setState({ items: [{ id: 'i1', name: '弑神之刃', gradeDesc: '不朽级', category: '武器' }] } as any);
    const idx = getCodexIndex();
    expect(idx.byName.get('暗影议会')?.accent).toBe('world');
    expect(idx.byName.get('弑神之刃')?.accent).toBe('thing');
    expect(idx.byName.get('弑神之刃')?.meta).toContain('不朽级');
  });

  it('领地建筑/效果与冒险团效果都收', () => {
    useTerritory.setState({ unlocked: true, name: '黑曜堡', level: 3, buildings: [{ id: 'b1', name: '锻造工房', level: 2, effect: '打造' }], effects: [{ name: '荒野庇护', desc: '减伤' }] } as any);
    useTeam.setState({ perks: [{ name: '疾行军令', desc: '加速' }] } as any);
    const idx = getCodexIndex();
    expect(idx.byName.get('黑曜堡')?.kind).toBe('territory');
    expect(idx.byName.get('锻造工房')?.kind).toBe('territory');
    expect(idx.byName.get('荒野庇护')?.kind).toBe('territory');
    expect(idx.byName.get('疾行军令')?.kind).toBe('perk');
  });
});

describe('惰性重建 · 打字卡顿的教训', () => {
  beforeEach(clearStores);

  it('store 没动 → 连续调用返回同一个对象（不重建、version 不变）', () => {
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '苏晓' } } } as any);
    const a = getCodexIndex();
    const b = getCodexIndex();
    expect(b).toBe(a);
    expect(b.version).toBe(a.version);
  });

  it('store 变了 → 换新对象且 version 自增（渲染缓存签名靠它失效）', () => {
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '苏晓' } } } as any);
    const a = getCodexIndex();
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '苏晓' }, C2: { id: 'C2', name: '莫甘娜' } } } as any);
    const b = getCodexIndex();
    expect(b).not.toBe(a);
    expect(b.version).toBeGreaterThan(a.version);
    expect(b.byName.has('莫甘娜')).toBe(true);
  });

  it('lookupCodex 只查已建好的索引，查不到就返回 undefined（绝不为一次悬浮重建词典）', () => {
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '苏晓' } } } as any);
    const idx = getCodexIndex();
    expect(lookupCodex('n:C1')?.name).toBe('苏晓');
    expect(lookupCodex('n:不存在')).toBeUndefined();
    expect(getCodexIndex()).toBe(idx);                                 // 查完没触发重建
  });

  it('单个数据源取数炸了不该毁掉整部词典', () => {
    useNpc.setState({ npcs: { C1: { id: 'C1', name: '苏晓' } } } as any);
    useCharacters.setState({ characters: null } as any);                // 故意喂坏其中一源
    const idx = getCodexIndex();
    expect(idx.byName.get('苏晓')?.kind).toBe('npc');                   // 前面的源照常
    expect(idx.byName.get('绝强')?.kind).toBe('tier');                  // 后面的源也照常
  });
});
