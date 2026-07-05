import { describe, it, expect } from 'vitest';
import { dropRecentFromRecall } from './narrativeMemory';

/* 治用户报「开了数据库推进(Stitches)+召回，正文就不注入长期事实」：去重原来整块清空 <相关记忆>，
   连长期事实一起吞。现只剔除【近期记忆】召回，长期事实/世界大事/阶段记忆照留。 */
describe('dropRecentFromRecall · Stitches 去重只丢近期记忆、留长期事实', () => {
  const wrap = (lines: string[]) => `<相关记忆>\n${lines.join('\n\n')}\n</相关记忆>`;

  it('混合块：保留长期事实/世界大事/阶段记忆，剔除近期记忆', () => {
    const out = dropRecentFromRecall(wrap([
      '[长期事实] 主角与虚渊观测者结契。',
      '[近期记忆] 玩家上一拍在集市讨价还价。',
      '[世界大事] 第七乐园开启万族议会。',
      '[阶段记忆] 釜山行世界第一幕收束。',
    ]));
    expect(out).not.toBeNull();
    expect(out).toContain('[长期事实] 主角与虚渊观测者结契。');
    expect(out).toContain('[世界大事] 第七乐园开启万族议会。');
    expect(out).toContain('[阶段记忆] 釜山行世界第一幕收束。');
    expect(out).not.toContain('[近期记忆]');
    expect(out!.startsWith('<相关记忆>')).toBe(true);
    expect(out!.endsWith('</相关记忆>')).toBe(true);
  });

  it('只有近期记忆 → 返回 null（等价整块跳过）', () => {
    expect(dropRecentFromRecall(wrap(['[近期记忆] a', '[近期记忆] b']))).toBeNull();
  });

  it('只有长期事实 → 原样保留', () => {
    const out = dropRecentFromRecall(wrap(['[长期事实] 只此一条']));
    expect(out).toBe(wrap(['[长期事实] 只此一条']));
  });

  it('长期事实正文含换行也不被截断', () => {
    const body = '[长期事实] 第一行\n第二行仍属同一条';
    const out = dropRecentFromRecall(wrap([body, '[近期记忆] 丢弃']));
    expect(out).toContain('第二行仍属同一条');
    expect(out).not.toContain('[近期记忆]');
  });
});
