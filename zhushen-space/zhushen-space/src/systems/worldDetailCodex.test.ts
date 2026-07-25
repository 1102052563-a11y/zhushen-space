import { describe, it, expect } from 'vitest';
import { sectionOf, parseWorldDetailCodex } from './worldDetailCodex';

/* 样本取自工坊真实产出：批次02/诡秘之主.md（加粗+斜杠+括号+马甲）
   与 样板/我欲封天.md（字段标签式 + 贵重物品段）。两种格式都必须吃得下。 */
const PLOT = `**【作品来源】** 爱潜水的乌贼 著。

**【主要人物】**
- **克莱恩·莫雷蒂/愚者（周明瑞）**｜谨慎幽默重责任；愚者至诡秘之主；马甲夏洛克、格尔曼、道恩、梅林、海神。弧光：廷根→贝克兰德→半神→真神→诡秘之主。对阿蒙死敌级博弈；塔罗会基石。
- **奥黛丽·霍尔（正义）**｜空想家途径；心理治疗；苏茜观众途径金毛。
- 孟浩（主角）｜性格：隐忍护短、睚眦必报｜装备·能力：复制万物的铜镜｜人物弧光：穷书生→山海星空之主
（正式产出 ≥10 人、每人字段齐全：身份/性格/装备·能力/弧光/立场关系。）

**【势力图谱】** 塔罗会、值夜者小队、风暴教会。

**【贵重物品】**
- 铜镜（照妖镜）：全书第一至宝，苍茫老祖为灵宠鹦鹉所造，能复制万物、可化超脱战甲。
- 应龙传承 / 血脉：封妖一脉、血仙传承，孟浩崛起之基。

**【隐藏剧情 · 伏笔】**
- 铜镜真正来历为全书最大伏笔。
`;

describe('sectionOf', () => {
  it('只取本节，遇到下一个 **【 就停', () => {
    const s = sectionOf(PLOT, '势力图谱');
    expect(s).toContain('塔罗会');
    expect(s).not.toContain('贵重物品');
    expect(s).not.toContain('铜镜');
  });

  it('没有该节 → 空串', () => {
    expect(sectionOf(PLOT, '不存在的节')).toBe('');
  });
});

describe('parseWorldDetailCodex', () => {
  const out = parseWorldDetailCodex(PLOT, '诡秘之主');
  const byName = (n: string) => out.find((e) => e.name === n);

  it('加粗+斜杠+括号：主名取斜杠前，其余进别名', () => {
    const e = byName('克莱恩·莫雷蒂');
    expect(e).toBeTruthy();
    expect(e!.kind).toBe('wchar');
    expect(e!.aliases).toContain('愚者');
    expect(e!.aliases).toContain('周明瑞');
  });

  it('行内「马甲X、Y」也抽成别名——正文常只写马甲名', () => {
    const e = byName('克莱恩·莫雷蒂')!;
    expect(e.aliases).toContain('夏洛克');
    expect(e.aliases).toContain('梅林');
    expect(e.aliases).toContain('海神');
  });

  it('弧光排到最后（LINE_MAX 截断时优先被挤掉，避免一悬浮就漏结局）', () => {
    const e = byName('克莱恩·莫雷蒂')!;
    const arcAt = e.lines.findIndex((l) => l.includes('弧光'));
    expect(arcAt).toBe(e.lines.length - 1);
    expect(e.lines[0]).toContain('谨慎幽默重责任');
  });

  it('字段标签式（样板格式）同样吃得下', () => {
    const e = byName('孟浩');
    expect(e).toBeTruthy();
    expect(e!.aliases).toContain('主角');
    expect(e!.lines.some((l) => l.includes('隐忍护短'))).toBe(true);
    expect(e!.lines[e!.lines.length - 1]).toContain('弧光');
  });

  it('贵重物品走全角冒号分隔，标记为 witem', () => {
    const e = byName('铜镜');
    expect(e).toBeTruthy();
    expect(e!.kind).toBe('witem');
    expect(e!.aliases).toContain('照妖镜');
    expect(e!.lines[0]).toContain('全书第一至宝');
  });

  it('跳过工坊模板的「（正式产出…）」说明行', () => {
    expect(out.some((e) => e.name.includes('正式产出'))).toBe(false);
  });

  it('⚠ 绝不解析【隐藏剧情】——阶段门控不能被悬浮卡绕过', () => {
    expect(out.some((e) => e.lines.some((l) => l.includes('最大伏笔')))).toBe(false);
  });

  it('meta 标出处，玩家一眼知道是哪个世界的原著设定', () => {
    expect(byName('铜镜')!.meta).toBe('原著 · 诡秘之主');
  });
});
