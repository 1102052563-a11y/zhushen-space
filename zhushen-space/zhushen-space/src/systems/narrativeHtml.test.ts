import { describe, it, expect } from 'vitest';
import { toHtmlWithImages, toHtmlWithImagesCached } from './narrativeHtml';

/* 渲染层缓存（治「打字卡几秒」）：按楼层 id + 内容签名记忆化 toHtmlWithImages。
   核心正确性 = 内容没变才复用、内容一变必重算（绝不留旧 HTML 残影）。 */
describe('toHtmlWithImagesCached', () => {
  it('相同 id+内容 → 与直接调用完全一致，二次调用命中缓存', () => {
    const t = '苏晓拔剑，寒光一闪，直取咽喉。';
    const direct = toHtmlWithImages(t);
    const a = toHtmlWithImagesCached(1, t);
    const b = toHtmlWithImagesCached(1, t);
    expect(a).toBe(direct);   // 缓存版产出 = 原函数产出
    expect(b).toBe(a);        // 二次调用（打字等无关重渲染）返回同值
  });

  it('同一 id 内容变了 → 重算，绝不返回旧 HTML（编辑正文/流式追加不留残影）', () => {
    const first = toHtmlWithImagesCached(2, '第一版正文内容。');
    const second = toHtmlWithImagesCached(2, '改写之后的正文内容。');
    expect(second).not.toBe(first);
    expect(second).toContain('改写之后的正文内容');
    expect(second).not.toContain('第一版正文内容');
    expect(second).toBe(toHtmlWithImages('改写之后的正文内容。'));   // 与现算一致（不是缓存拼凑）
  });

  it('不同 id 互不串档', () => {
    const x = toHtmlWithImagesCached(10, 'AAA 的故事。');
    const y = toHtmlWithImagesCached(11, 'BBB 的故事。');
    expect(x).toContain('AAA');
    expect(y).toContain('BBB');
    expect(x).not.toContain('BBB');
  });
});
