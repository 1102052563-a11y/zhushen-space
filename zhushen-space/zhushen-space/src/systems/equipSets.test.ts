import { describe, it, expect } from 'vitest';
import {
  tiersForPieces, collectEquipSetCounts, activeEquipSets, equipSetAttrDelta, equipSetPassive,
  equipSetEquipEntry, equipSetSummaryLine, normalizeEquipSetDef, parsePendingSuit, type EquipSetDef,
} from './equipSets';

const SETS: EquipSetDef[] = [
  {
    key: 'aurora', name: '极光行者', emoji: '❄', theme: '冰霜迅袭', desc: '踏霜而行。',
    gradeDesc: '紫色', pieces: 4, createdAt: 0,
    tiers: [
      { need: 2, bonus: '敏捷+10' },
      { need: 4, bonus: '暴击率+8%，力量+12，攻击附带霜痕' },
    ],
  },
  {
    key: 'ember', name: '烬火余威', emoji: '🔥', theme: '烈焰重击', desc: '', gradeDesc: '蓝色', pieces: 2, createdAt: 0,
    tiers: [{ need: 2, bonus: '减伤12%，体质+8' }],
  },
];
const piece = (equipSet?: string, equipped = true) => ({ equipped, equipSet });

describe('tiersForPieces（件数 → 确定性解锁档位）', () => {
  it('2~6 件各档位表', () => {
    expect(tiersForPieces(2)).toEqual([2]);
    expect(tiersForPieces(3)).toEqual([2, 3]);
    expect(tiersForPieces(4)).toEqual([2, 4]);
    expect(tiersForPieces(5)).toEqual([2, 4, 5]);
    expect(tiersForPieces(6)).toEqual([2, 4, 6]);
  });
  it('越界钳到 2~6', () => {
    expect(tiersForPieces(1)).toEqual([2]);
    expect(tiersForPieces(9)).toEqual([2, 4, 6]);
    expect(tiersForPieces(NaN)).toEqual([2]);
  });
});

describe('collectEquipSetCounts / activeEquipSets（按装备件本体计数·递进激活）', () => {
  it('只统计已装备件；指向已删套装不计', () => {
    const counts = collectEquipSetCounts(
      [piece('aurora'), piece('aurora', false), piece('DELETED'), piece(undefined)], SETS);
    expect(counts).toEqual({ aurora: 1 });
  });
  it('1 件即收录进度（x/N 展示）但档位未激活', () => {
    const act = activeEquipSets([piece('aurora')], SETS);
    expect(act).toHaveLength(1);
    expect(act[0].count).toBe(1);
    expect(act[0].pieces).toBe(4);
    expect(act[0].tiers.every((t) => !t.active)).toBe(true);
  });
  it('2 件 → 仅低档激活；4 件 → 全档激活', () => {
    const two = activeEquipSets([piece('aurora'), piece('aurora')], SETS)[0];
    expect(two.tiers.find((t) => t.need === 2)!.active).toBe(true);
    expect(two.tiers.find((t) => t.need === 4)!.active).toBe(false);
    const four = activeEquipSets(Array.from({ length: 4 }, () => piece('aurora')), SETS)[0];
    expect(four.tiers.every((t) => t.active)).toBe(true);
  });
});

describe('套装加成从自由文本派生（六维 + 战斗被动）', () => {
  const four = Array.from({ length: 4 }, () => piece('aurora'));
  it('满 4 件：敏捷/力量六维 + 暴击率被动', () => {
    const d = equipSetAttrDelta(four, SETS);
    expect(d.agi).toBe(10);
    expect(d.str).toBe(12);
    expect(equipSetPassive(four, SETS).critChance).toBeCloseTo(0.08);
  });
  it('仅 2 件：只有低档生效', () => {
    const two = [piece('aurora'), piece('aurora')];
    expect(equipSetAttrDelta(two, SETS).agi).toBe(10);
    expect(equipSetAttrDelta(two, SETS).str).toBeUndefined();
    expect(equipSetPassive(two, SETS).critChance).toBeUndefined();
  });
  it('减伤 token 生效（烬火余威 2 件）', () => {
    const two = [piece('ember'), piece('ember')];
    expect(equipSetPassive(two, SETS).dmgTakenPct).toBeCloseTo(-0.12);
    expect(equipSetAttrDelta(two, SETS).con).toBe(8);
  });
  it('equipSetEquipEntry 打包成【装备套装加成】·摘要含名与 x/N', () => {
    expect(equipSetEquipEntry(four, SETS)?.effect).toContain('力量+12');
    const line = equipSetSummaryLine([piece('aurora'), piece('aurora')], SETS);
    expect(line).toContain('极光行者');
    expect(line).toContain('2/4件');
  });
});

describe('parsePendingSuit（AI 输出容错解析）', () => {
  it('剥 <套装推演> + 代码块围栏 + 尾逗号', () => {
    const raw = '<套装推演>先推演一番材料与主题……</套装推演>\n```json\n{"set":{"name":"霜狼行猎","emoji":"🐺","theme":"冰猎","desc":"群狼环伺。","tiers":[{"need":2,"bonus":"敏捷+10"},{"need":4,"bonus":"暴击率+8%",}]},"pieces":[{"name":"霜狼之牙","category":"武器"},{"name":"霜狼皮甲","category":"防具"}]}\n```';
    const out = parsePendingSuit(raw);
    expect(out).not.toBeNull();
    expect(out!.set.name).toBe('霜狼行猎');
    expect(out!.set.tiers).toHaveLength(2);
    expect(out!.pieces).toHaveLength(2);
    expect(out!.pieces[0].name).toBe('霜狼之牙');
  });
  it('顶层平铺（无 set 包装）也能解析', () => {
    const out = parsePendingSuit('{"name":"平铺套","tiers":[{"need":2,"bonus":"力量+5"}],"pieces":[{"name":"甲"}]}');
    expect(out!.set.name).toBe('平铺套');
  });
  it('缺套装名 / 缺 pieces / 非 JSON → null', () => {
    expect(parsePendingSuit('{"set":{"tiers":[{"need":2,"bonus":"x"}]},"pieces":[{"name":"a"}]}')).toBeNull();
    expect(parsePendingSuit('{"set":{"name":"空","tiers":[{"need":2,"bonus":"x"}]},"pieces":[]}')).toBeNull();
    expect(parsePendingSuit('抱歉我无法生成')).toBeNull();
  });
  it('normalizeEquipSetDef：need 钳 1~6、tiers 排序', () => {
    const d = normalizeEquipSetDef({ name: '乱序', tiers: [{ need: 9, bonus: 'b' }, { need: 2, bonus: 'a' }] })!;
    expect(d.tiers.map((t) => t.need)).toEqual([2, 6]);
  });
});
