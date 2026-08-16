import { describe, it, expect } from 'vitest';
import { applyCustomInjects, type PromptInject } from './customInject';

/* 🎯 自定义注入：位置解析 + 从后往前插入 + protectTail + 各类跳过。 */
const msg = (role: string, content: string) => ({ role, content });
const base = () => [msg('system', '系统'), msg('user', '早前输入'), msg('assistant', '早前正文'), msg('user', '本回合输入')];
const inj = (p: Partial<PromptInject>): PromptInject => ({ id: p.id ?? 'i1', label: '', content: '内容', role: 'system', pos: 'end', enabled: true, ...p });
const OPTS = { expand: (t: string) => t, cond: () => true };

describe('applyCustomInjects · 自定义注入', () => {
  it('start / end / depth 位置', () => {
    const m1 = base(); applyCustomInjects(m1, [inj({ pos: 'start', content: 'A' })], OPTS);
    expect(m1[0].content).toBe('A');
    const m2 = base(); applyCustomInjects(m2, [inj({ pos: 'end', content: 'B' })], OPTS);
    expect(m2[m2.length - 1].content).toBe('B');
    const m3 = base(); applyCustomInjects(m3, [inj({ pos: 'depth', depth: 1, content: 'C' })], OPTS);
    expect(m3[m3.length - 2].content).toBe('C');   // 倒数第 1 楼（本回合输入）之前
    expect(m3[m3.length - 1].content).toBe('本回合输入');
  });

  it('protectTail：end 插在 prefill 之前，prefill 恒居末位', () => {
    const m = [...base(), msg('assistant', '<think>')];
    applyCustomInjects(m, [inj({ pos: 'end', content: 'X' })], { ...OPTS, protectTail: 1 });
    expect(m[m.length - 1].content).toBe('<think>');
    expect(m[m.length - 2].content).toBe('X');
  });

  it('regex：从末尾往前第一条命中 · before/after', () => {
    const m1 = base(); applyCustomInjects(m1, [inj({ pos: 'regex', regex: '输入', content: 'R' })], OPTS);
    expect(m1[3].content).toBe('R');               // 命中最新的「本回合输入」(idx3)，before=插它前
    expect(m1[4].content).toBe('本回合输入');
    const m2 = base(); applyCustomInjects(m2, [inj({ pos: 'regex', regex: '早前正文', at: 'after', content: 'S' })], OPTS);
    expect(m2[3].content).toBe('S');               // 命中 idx2，after=idx3
  });

  it('regex 未命中 / 非法正则 = 跳过（绝不兜底到末尾）', () => {
    const m1 = base(); applyCustomInjects(m1, [inj({ pos: 'regex', regex: '不存在的词', content: 'X' })], OPTS);
    expect(m1.length).toBe(4);
    const m2 = base(); applyCustomInjects(m2, [inj({ pos: 'regex', regex: '([bad', content: 'X' })], OPTS);
    expect(m2.length).toBe(4);
  });

  it('activeWhen 不满足 / 内容展开为空 / 未启用 = 跳过', () => {
    const m = base();
    applyCustomInjects(m, [
      inj({ id: 'a', activeWhen: 'var:x == 1', content: 'A' }),
      inj({ id: 'b', content: '   ' }),
      inj({ id: 'c', enabled: false, content: 'C' }),
    ], { expand: (t) => t, cond: () => false });
    expect(m.length).toBe(4);
  });

  it('多条同位置保持列表次序 · 不同位置互不位移', () => {
    const m = base();
    applyCustomInjects(m, [
      inj({ id: 'a', pos: 'end', content: '一' }),
      inj({ id: 'b', pos: 'end', content: '二' }),
      inj({ id: 'c', pos: 'start', content: '零' }),
    ], OPTS);
    expect(m[0].content).toBe('零');
    expect(m[m.length - 2].content).toBe('一');
    expect(m[m.length - 1].content).toBe('二');
  });

  it('内容走 expand 闭包（宏/模板展开由调用方注入）', () => {
    const m = base();
    applyCustomInjects(m, [inj({ pos: 'end', content: 'raw' })], { expand: () => '展开后', cond: () => true });
    expect(m[m.length - 1].content).toBe('展开后');
  });
});
