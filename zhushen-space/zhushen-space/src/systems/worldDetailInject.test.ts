// 世界详情·分层注入引擎：分节/分类/词条打分/阶段推断/门控拼装 全链路单测（纯函数，无 IO）。
import { describe, it, expect } from 'vitest';
import {
  parseWorldDoc, extractTerms, scoreAgainst, inferStage, assembleInjection,
  CORE_SEC_CAP, UNPARSED_CAP,
} from './worldDetailInject';

// 仿真档案：结构对齐工坊真实产出（**【节名】** + 剧情线①②③ + 人物/地理/贵重物品/隐藏剧情）
const PLOT = `**【作品来源】**
《测试纪》某某著，起点连载。标签：林战、青云宗。

**【世界定位】**
凡人从外门杂役逆袭的修真世界。

**【世界观 · 力量体系】**
灵力、法宝、境界。乐园阶位映射（宁低勿高）：凝气≈一阶；结丹≈二阶。

**【叙事基调 · 雷区】**
压抑求生流；禁写现代梗。

**【地理 · 舞台】**
**青云宗**位于东洲群山。**黑风寨**盘踞北岭古道，劫掠过路商队。

**【世界剧情线】**
① **入门试炼**
林战入青云宗为外门杂役，结识师兄**赵九**，初见宗门规矩之严。

② **黑风寨之乱**
**黑风寨之乱**爆发，寨主**铁面虎**率众围攻山门，外门弟子被迫上前线。

③ **秘境夺宝**
东洲**古秘境**开启，上古灵宝**焚天鼎**现世，各方势力入场夺宝。

**【主要人物】**
**赵九**（外门师兄）：市侩但仗义，惯用**青纹刀**，欠着赌坊银钱。

**铁面虎**（黑风寨主）：结丹初期，独眼，持双斧。

**【贵重物品】**
**焚天鼎**：上古灵宝，鼎内藏焚天真火。

**【隐藏剧情 · 伏笔】**
青云宗宗主实为魔修卧底，秘境即其布局。`;

describe('parseWorldDoc', () => {
  const doc = parseWorldDoc(PLOT);

  it('分节与分类：核心/剧情线/候选池/隐藏各就各位', () => {
    expect(doc.parsed).toBe(true);
    expect(doc.core.map((c) => c.title)).toEqual(['作品来源', '世界定位', '世界观 · 力量体系', '叙事基调 · 雷区']);
    expect(doc.stages.map((s) => s.idx)).toEqual([1, 2, 3]);
    expect(doc.hidden).toHaveLength(1);
    expect(doc.hidden[0].text).toContain('魔修卧底');
    const poolTitles = new Set(doc.pool.map((c) => c.title));
    expect(poolTitles.has('地理 · 舞台')).toBe(true);
    expect(poolTitles.has('主要人物')).toBe(true);
    expect(poolTitles.has('贵重物品')).toBe(true);
    // 隐藏剧情绝不落进候选池
    expect(doc.pool.some((c) => c.text.includes('魔修卧底'))).toBe(false);
  });

  it('重复节头（灌水批）去重：同名同文只留首个', () => {
    const dup = PLOT + '\n\n**【作品来源】**\n《测试纪》某某著，起点连载。标签：林战、青云宗。';
    expect(parseWorldDoc(dup).core.filter((c) => c.title === '作品来源')).toHaveLength(1);
  });

  it('无节结构（玩家自由文本修订）→ parsed:false', () => {
    expect(parseWorldDoc('这是一段没有任何节头的自由设定文本，讲了一个故事。').parsed).toBe(false);
  });
});

describe('extractTerms / scoreAgainst', () => {
  it('抽出粗体/引号专名，过滤模板泛用词', () => {
    const terms = extractTerms('**铁面虎**率军来袭，「青纹刀」出鞘。世界剧情线如下。主角登场。');
    const names = terms.map((t) => t.term);
    expect(names).toContain('铁面虎');
    expect(names).toContain('青纹刀');
    expect(names).not.toContain('世界剧情线');
    expect(names).not.toContain('主角');
  });

  it('命中计数封顶 3 次', () => {
    const terms = [{ term: '铁面虎', w: 2 }];
    expect(scoreAgainst(terms, '铁面虎铁面虎铁面虎铁面虎铁面虎')).toBe(6);   // min(5,3)×2
  });
});

describe('inferStage', () => {
  const doc = parseWorldDoc(PLOT);

  it('近期正文密集提及第2阶段专名 → 推断阶段2', () => {
    const ctx = '铁面虎带着黑风寨众杀上山门，黑风寨之乱爆发；铁面虎的双斧劈碎了山门大阵'.toLowerCase();
    expect(inferStage(doc, ctx)).toBe(2);
  });

  it('提及第3阶段专名 → 3；空上下文置信不足 → 回退 1', () => {
    expect(inferStage(doc, '古秘境中焚天鼎虚影浮现，焚天鼎鼎盖缓缓开启'.toLowerCase())).toBe(3);
    expect(inferStage(doc, '')).toBe(1);
  });
});

describe('assembleInjection · layered', () => {
  it('核心常驻＋剧情线只到当前+1＋相关块按命中选取；未来阶段与隐藏剧情不可见', () => {
    const ctx = '赵九握着青纹刀警惕四顾，赵九低声骂了句晦气';
    const r = assembleInjection('测试纪', PLOT, ctx);
    expect(r.mode).toBe('layered');
    expect(r.stage).toBe(1);
    expect(r.content).toContain('【作品来源】');
    expect(r.content).toContain('叙事基调');
    expect(r.content).toContain('入门试炼');          // 阶段1
    expect(r.content).toContain('黑风寨之乱');        // 阶段2 = 当前+1 预告窗
    expect(r.content).not.toContain('秘境夺宝');      // 阶段3 = 未来 → 不可见
    expect(r.content).not.toContain('焚天鼎现世');
    expect(r.content).not.toContain('魔修卧底');      // 隐藏剧情 → 不可见
    expect(r.content).toContain('〔主要人物〕');       // 赵九/青纹刀命中 → 人物块入选
    expect(r.content).toContain('赵九');
    expect(r.content).not.toContain('〔贵重物品〕');   // 零命中块不入选
    expect(r.content).toContain('严禁抢进度');
  });

  it('minStage（会话记忆只进不退）抬高阶段窗口', () => {
    const r = assembleInjection('测试纪', PLOT, '', { minStage: 3 });
    expect(r.stage).toBe(3);
    expect(r.content).toContain('秘境夺宝');
    expect(r.content).not.toContain('魔修卧底');
  });

  it('零命中上下文 → 无「本回合相关」块，核心与阶段仍在', () => {
    const r = assembleInjection('测试纪', PLOT, '完全无关的现代都市对话');
    expect(r.content).not.toContain('本回合相关');
    expect(r.content).toContain('【作品来源】');
    expect(r.content).toContain('入门试炼');
  });

  it('full 模式（规划层）＝完整档案，含隐藏剧情与全部阶段', () => {
    const r = assembleInjection('测试纪', PLOT, '', { mode: 'full' });
    expect(r.mode).toBe('full');
    expect(r.content).toContain('完整版');
    expect(r.content).toContain('魔修卧底');
    expect(r.content).toContain('秘境夺宝');
  });

  it('自由文本（无节结构）→ 整段注入并按上限截断', () => {
    const short = assembleInjection('X', '自由文本修订：这个世界其实是一场梦境实验。', '');
    expect(short.mode).toBe('raw');
    expect(short.content).toContain('梦境实验');
    const long = assembleInjection('X', '很长的自由文本。'.repeat(2000), '');
    expect(long.content.length).toBeLessThan(UNPARSED_CAP + 400);   // 头部说明 + 截断体
  });

  it('超长核心节被截到单节上限', () => {
    const bigCore = `**【世界定位】**\n${'设'.repeat(3000)}\n\n**【地理 · 舞台】**\n某地某景某物某人某事。`;
    const r = assembleInjection('X', bigCore, '');
    const seg = r.content.split('【世界定位】')[1] || '';
    expect(seg.indexOf('【')).toBeLessThan(CORE_SEC_CAP + 200);   // 定位节体不超过单节预算太多
  });

  it('体量档位 scale：精简(0.6)产出比充裕(1.6)小', () => {
    const bigCore = `**【世界定位】**\n${'设'.repeat(3000)}\n\n**【世界观 · 力量体系】**\n${'力'.repeat(3000)}`;
    const lean = assembleInjection('X', bigCore, '', { scale: 0.6 });
    const rich = assembleInjection('X', bigCore, '', { scale: 1.6 });
    expect(lean.content.length).toBeLessThan(rich.content.length);
    const seg = lean.content.split('【世界定位】')[1] || '';
    expect(seg.indexOf('【')).toBeLessThan(CORE_SEC_CAP * 0.6 + 200);   // 单节上限随档位缩放
  });
});
