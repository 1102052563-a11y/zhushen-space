import { describe, it, expect } from 'vitest';
import { splitProtectedBlocks, polishReceipt, proseCharCount, joinProseForModel, mergePolished, loadPolishPrefs, savePolishPrefs, POLISH_GOALS } from './polish';

/* ✨ 正文校正：拆分/拼回不变量 + 分段标记协议 + 偏好。钉住两条命门：
   ① segs 原位串接 === 原文（受保护块一个字不动）；② 标记缺失/乱序必须抛错，绝不凑合硬拼。 */
describe('正文校正 · 受保护块拆分', () => {
  const prose1 = '林岚推开门，走进了昏暗的房间。她的手指在门框上停了几秒，像是在确认什么。这里比想象中冷得多。';
  const prose2 = '窗外的雨还在下。远处传来钟声，一下，又一下，敲在人心上。她终于转过身，直视着那双眼睛。';
  const block = '<击杀结算>\n目标：黑衣人×2\n世界之源：+0.3%\n</击杀结算>';
  const fence = '```\nconst x = 1;\n```';

  it('拆分后原位串接 === 原文（不变量）', () => {
    const text = `${prose1}\n\n${block}\n\n${prose2}\n${fence}`;
    const segs = splitProtectedBlocks(text);
    expect(segs.map((s) => s.text).join('')).toBe(text);
    expect(segs.some((s) => s.kind === 'keep' && s.label === '结算块')).toBe(true);
    expect(segs.some((s) => s.kind === 'keep' && s.label === '代码块')).toBe(true);
    expect(segs.filter((s) => s.kind === 'prose')).toHaveLength(2);
  });

  it('嵌套 div 按最外层跨度整段保护（宁可多保护）', () => {
    const html = '<div class="a">外<div class="b">内</div>尾</div>';
    const text = `${prose1}\n${html}\n${prose2}`;
    const segs = splitProtectedBlocks(text);
    const keep = segs.find((s) => s.label === 'HTML 容器');
    expect(keep?.text).toBe(html);
    expect(segs.map((s) => s.text).join('')).toBe(text);
  });

  it('配图 markdown / img 标签受保护；块间短间隙散文不送模型', () => {
    const text = `${prose1}\n![插图](https://x/y.png)\n——\n<img src="a.png">\n${prose2}`;
    const segs = splitProtectedBlocks(text);
    expect(segs.filter((s) => s.label === '配图')).toHaveLength(2);
    // 「——」这类短间隙是 keep 不是 prose
    expect(segs.filter((s) => s.kind === 'prose')).toHaveLength(2);
    expect(polishReceipt(segs)).toContain('配图×2');
    expect(proseCharCount(segs)).toBeGreaterThan(40);
  });

  it('防御：正文里混入 <state>/<think> 也会被保护', () => {
    const text = `${prose1}\n<state>\nhp.B1 -= 10\n</state>\n<think>推理</think>\n${prose2}`;
    const segs = splitProtectedBlocks(text);
    expect(segs.some((s) => s.label === '指令块')).toBe(true);
    expect(segs.some((s) => s.label === '思维链')).toBe(true);
    expect(segs.map((s) => s.text).join('')).toBe(text);
  });
});

describe('正文校正 · 分段标记协议', () => {
  const prose1 = '第一段散文，写得又长又拖沓，充满了各种各样毫无必要的修饰词汇与冗余表达方式。';
  const prose2 = '第二段散文同样需要修理，人物的对话显得机械而缺乏生活气息，亟待润色一番。';
  const block = '<世界结算>\n评级：A\n</世界结算>';
  const text = `${prose1}\n\n${block}\n\n${prose2}`;

  it('joinProseForModel：段间夹 ⟦P2⟧ 标记行', () => {
    const segs = splitProtectedBlocks(text);
    const payload = joinProseForModel(segs);
    expect(payload).toContain('⟦P2⟧');
    expect(payload).not.toContain('世界结算');   // 受保护块绝不进载荷
  });

  it('mergePolished：标记齐全 → 原位拼回，受保护块一字不动', () => {
    const segs = splitProtectedBlocks(text);
    const reply = `改好的第一段。\n⟦P2⟧\n改好的第二段。`;
    const merged = mergePolished(segs, reply);
    expect(merged).toContain('改好的第一段。');
    expect(merged).toContain('改好的第二段。');
    expect(merged).toContain(block);
    // 原段的段间空白结构保留（block 前后的 \n\n 还在）
    expect(merged).toContain(`\n\n${block}\n\n`);
  });

  it('mergePolished：模型用代码围栏包整篇 → 自动剥壳', () => {
    const segs = splitProtectedBlocks(text);
    const reply = '```\n改一。\n⟦P2⟧\n改二。\n```';
    expect(mergePolished(segs, reply)).toContain('改一。');
  });

  it('mergePolished：标记缺失/乱序 → 抛错（绝不硬拼）', () => {
    const segs = splitProtectedBlocks(text);
    expect(() => mergePolished(segs, '只有一段没有标记')).toThrow(/分段标记/);
    expect(() => mergePolished(segs, 'a\n⟦P3⟧\nb')).toThrow(/分段标记/);
    expect(() => mergePolished(segs, 'a\n⟦P2⟧\nb\n⟦P2⟧\nc')).toThrow(/分段标记/);
  });

  it('单散文段：无标记直接整段替换', () => {
    const segs = splitProtectedBlocks(prose1);
    expect(mergePolished(segs, '精修后的整段。')).toBe('精修后的整段。');
  });
});

describe('正文校正 · 偏好持久化', () => {
  it('默认：四目标勾选（pseudo 关）+ 轻校；存取往返', () => {
    localStorage.removeItem('drpg-polish-prefs');
    const p = loadPolishPrefs();
    expect(p.strength).toBe('light');
    expect(p.goals.sort()).toEqual(POLISH_GOALS.filter((g) => g.def).map((g) => g.id).sort());
    savePolishPrefs({ goals: ['cliche'], strength: 'deep' });
    const q = loadPolishPrefs();
    expect(q.goals).toEqual(['cliche']);
    expect(q.strength).toBe('deep');
  });
});
