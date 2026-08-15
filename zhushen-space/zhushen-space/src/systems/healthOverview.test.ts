/* 🩺 运行概览：失败归因分桶 + 健康行聚合（借鉴 ACU 仪表盘）。 */
import { describe, it, expect } from 'vitest';
import { classifyFailures, buildHealthRows } from './healthOverview';

describe('classifyFailures 失败归因', () => {
  it('按特征词分桶：API 连接 / 输出格式 / 指令被拦 / 其他', () => {
    const r = classifyFailures([
      'embedding 接口 401: unauthorized',
      'insertRow 数据无效：insertRow(9,{)',
      '表未匹配：updateRow("不存在表",1,{})',
      '行已被玩家锁定 🔒（此行不许改动）：updateRow(...)',
      '大总结不可变（禁止修改/删除已有大总结）：deleteRow(...)',
      '完全莫名其妙的失败',
    ]);
    const byBucket = Object.fromEntries(r.map((x) => [x.bucket, x.count]));
    expect(byBucket).toEqual({ api: 1, format: 2, apply: 2, other: 1 });
    expect(r[0].count).toBe(2);                       // 按数量降序
    expect(r.find((x) => x.bucket === 'api')!.hint).toContain('接口');
    expect(r.find((x) => x.bucket === 'apply')!.hint).toContain('护栏');
  });
  it('空输入 → 空数组（面板不渲染归因块）', () => {
    expect(classifyFailures([])).toEqual([]);
  });
});

describe('buildHealthRows 健康行', () => {
  it('四大行齐全（接口/填表/状态指令/一致性），各带行动文案', () => {
    const rows = buildHealthRows();
    const titles = rows.map((r) => r.title);
    expect(titles).toContain('正文接口');
    expect(titles).toContain('填表');
    expect(titles).toContain('状态指令');
    expect(titles).toContain('一致性');
    for (const r of rows) {
      expect(['ok', 'warn', 'bad']).toContain(r.level);
      expect(r.text.length).toBeGreaterThan(4);       // 每行都有可读文案，不是裸徽标
    }
  });
});
