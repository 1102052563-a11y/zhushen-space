/* 🤖 AI 建表助手：设计稿机械校验（《建表指南》必须契约下沉）+ JSON 抠取。 */
import { describe, it, expect } from 'vitest';
import { validateTableDesign, extractDesignJson } from './tableDesign';

describe('validateTableDesign', () => {
  it('合规设计稿通过并归一化', () => {
    const v = validateTableDesign({ name: ' 城市物价表 ', headers: [' 城市 ', '物价指数', '治安'], note: '记录各城市物价与治安，一城一行。', single: 0 });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.design.name).toBe('城市物价表');
      expect(v.design.headers).toEqual(['城市', '物价指数', '治安']);
      expect(v.design.single).toBe(false);
    }
  });
  it('必须契约逐条打回：空表名/无列/列重复/列过多/空 note', () => {
    expect(validateTableDesign({ name: '', headers: ['a'], note: 'x' }).ok).toBe(false);
    expect(validateTableDesign({ name: 'T表', headers: [], note: 'x' }).ok).toBe(false);
    expect(validateTableDesign({ name: 'T表', headers: ['a', 'a'], note: 'x' }).ok).toBe(false);
    expect(validateTableDesign({ name: 'T表', headers: Array.from({ length: 13 }, (_, i) => `列${i}`), note: 'x' }).ok).toBe(false);
    expect(validateTableDesign({ name: 'T表', headers: ['a'], note: '  ' }).ok).toBe(false);
    expect(validateTableDesign('不是对象').ok).toBe(false);
  });
});

describe('extractDesignJson', () => {
  it('容忍代码围栏与前后废话，抠出 JSON 并宽松解析', () => {
    const reply = '好的，为你设计如下：\n```json\n{"name":"悬赏令表","headers":["目标","赏金","状态"],"note":"一张悬赏一行。","single":false}\n```\n希望有帮助！';
    const d = extractDesignJson(reply) as Record<string, unknown>;
    expect(d.name).toBe('悬赏令表');
    expect(Array.isArray(d.headers)).toBe(true);
  });
  it('没有 JSON → undefined', () => {
    expect(extractDesignJson('抱歉我不明白')).toBeUndefined();
  });
});
