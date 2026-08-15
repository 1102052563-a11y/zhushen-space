// 世界库解析/抽样单测：parseWorldLib 五种格式 + sampleWorldPoolText 分组/去重/来源不变量（随机只测不变量，不测精确值）。
import { describe, it, expect } from 'vitest';
import { parseWorldLib, sampleWorldPoolText, type WorldPoolBook } from './worldLib';

describe('parseWorldLib', () => {
  it('① 主库散文式「N. **名** | **副题**」', () => {
    const lib = parseWorldLib('12. **进击的巨人** | **墙内墙外**：巨人横行的世界。\n13、**咒术回战** | **咒灵**：……');
    expect(lib.count).toBe(2);
    expect(lib.nameById.get(12)).toBe('进击的巨人');
    expect(lib.nameById.get(13)).toBe('咒术回战');
  });

  it('②④⑤ 引号 / 裸行 / YAML 格式', () => {
    expect(parseWorldLib('"3|我欲封天"').nameById.get(3)).toBe('我欲封天');
    expect(parseWorldLib('7|蛊真人\n').nameById.get(7)).toBe('蛊真人');
    const y = parseWorldLib('id: 21\nname: "某休闲世界"\n');
    expect(y.nameById.get(21)).toBe('某休闲世界');
  });

  it('同编号撞重保留首个，编号排序', () => {
    const lib = parseWorldLib('"5|甲"\n"5|乙"\n"2|丙"');
    expect(lib.nameById.get(5)).toBe('甲');
    expect(lib.ids).toEqual([2, 5]);
  });
});

// 造一本含 三阶/九阶/休闲 条目的世界书（三阶 10 个世界、九阶 2 个）
const names3 = Array.from({ length: 10 }, (_, i) => `三阶世界${i + 1}`);
const mkBooks = (): WorldPoolBook[] => [
  {
    enabled: true,
    name: '世界选择',
    entries: [
      { enabled: true, key: ['选择三阶世界'], content: names3.map((n, i) => `"${i + 1}|${n}"`).join('\n') },
      { enabled: true, key: ['选择九阶世界'], content: '"1|遮天"\n"2|完美世界"' },
      { enabled: false, key: ['选择五阶世界'], content: '"1|被禁用的条目"' },
    ],
  },
  { enabled: true, name: '休闲世界', entries: [{ enabled: true, key: ['休闲'], content: '"1|白色相簿"\n"2|CLANNAD"' }] },
  { enabled: false, name: '被禁用的书', entries: [{ enabled: true, key: ['选择一阶世界'], content: '"1|不该出现"' }] },
];

describe('sampleWorldPoolText', () => {
  it('空世界库返回空串（调用方跳过注入）', () => {
    expect(sampleWorldPoolText([])).toBe('');
    expect(sampleWorldPoolText([{ enabled: true, name: 'x', entries: [] }])).toBe('');
  });

  it('按阶分组；抽样数≤perTier；名字全部来自该阶名单且不重复', () => {
    const text = sampleWorldPoolText(mkBooks(), 4);
    const line3 = text.split('\n').find((l) => l.startsWith('三阶：'))!;
    expect(line3).toBeTruthy();
    const picked = line3.replace('三阶：', '').split('、');
    expect(picked.length).toBe(4);
    expect(new Set(picked).size).toBe(picked.length);
    for (const n of picked) expect(names3).toContain(n);
  });

  it('世界数不足 perTier 时全取；禁用的书/条目不出现', () => {
    const text = sampleWorldPoolText(mkBooks(), 8);
    const line9 = text.split('\n').find((l) => l.startsWith('九阶：'))!;
    expect(line9.replace('九阶：', '').split('、').sort()).toEqual(['完美世界', '遮天']);
    expect(text).not.toContain('被禁用');
    expect(text).not.toContain('不该出现');
  });

  it('休闲书按书名识别，单独成行', () => {
    const text = sampleWorldPoolText(mkBooks(), 8);
    const lz = text.split('\n').find((l) => l.startsWith('休闲'))!;
    expect(lz).toContain('白色相簿');
    expect(lz).toContain('CLANNAD');
  });
});
