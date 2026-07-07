import { describe, it, expect, beforeEach } from 'vitest';
import { pushSceneNotice, noteCurrencyChange, drainSceneNotices } from './allocNotice';

/* 场外操作通报：加点/合成/强化/花费货币等前端确定性操作 → 注入正文<前置须知>，防"花到5000正文却记10000"OOC。 */
describe('sceneNotice · 场外操作通报', () => {
  beforeEach(() => { drainSceneNotices(); });   // 清空模块级缓冲，隔离用例

  it('pushSceneNotice → drain 取回并清空（一次性消费）', () => {
    pushSceneNotice('【场外·合成】合成出 星骸挽歌');
    pushSceneNotice('   ');   // 纯空白忽略
    expect(drainSceneNotices()).toEqual(['【场外·合成】合成出 星骸挽歌']);
    expect(drainSceneNotices()).toEqual([]);   // 再 drain 已空
  });

  it('货币按币种聚合净值 + 收集缘由 + 播报当前余额', () => {
    noteCurrencyChange('乐园币', -500, '装备强化·星骸挽歌');
    noteCurrencyChange('乐园币', -4500, '赌坊·兑换筹码');
    noteCurrencyChange('灵魂钱币', 200, '魂赌·赢');
    const joined = drainSceneNotices({ 乐园币: 5000, 灵魂钱币: 1200 }).join('\n');
    expect(joined).toContain('乐园币 -5000');
    expect(joined).toContain('装备强化·星骸挽歌、赌坊·兑换筹码');   // 缘由合并
    expect(joined).toContain('当前 乐园币 = 5000');
    expect(joined).toContain('灵魂钱币 +200');
    expect(joined).toContain('当前 灵魂钱币 = 1200');
  });

  it('净值为 0 的币种不播报（花了又赚回来）', () => {
    noteCurrencyChange('乐园币', -100, 'a');
    noteCurrencyChange('乐园币', 100, 'b');
    expect(drainSceneNotices({ 乐园币: 999 })).toEqual([]);
  });

  it('文字通报 + 货币行同时输出；drain 后货币缓冲也清空', () => {
    pushSceneNotice('【场外·加点】体质+5');
    noteCurrencyChange('乐园币', -300, '合成手工费');
    const out = drainSceneNotices({ 乐园币: 700 });
    expect(out[0]).toBe('【场外·加点】体质+5');
    expect(out.some((l) => l.includes('乐园币 -300'))).toBe(true);
    expect(drainSceneNotices({ 乐园币: 700 })).toEqual([]);   // 货币缓冲亦一次性
  });
});
