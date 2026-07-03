import { describe, it, expect } from 'vitest';
import { buildDefaultTables, DEFAULT_SHEET_UIDS } from './acuTableSpec';

/* acuTableSpec 是「表结构单一真相」。ddl 现在是**纯文档/规格**（英文列名+类型+CHECK 约束+中文注释），
   运行时引擎走中文 headers（见 tableSqlite Step 6b 镜像），ddl 无人读。
   风险=有人加列改 headers 却忘了同步 ddl → 文档悄悄骗人。这里把该风险**下沉成机器守卫**：
   ddl 列数必须== headers 列数（漂移即红），单一真相不再靠自觉。 */

/** 从一段 CREATE TABLE ddl 里数出列定义（排除 row_id 主键）。列定义 = `列名 类型`。 */
function ddlColumnCount(ddl: string): number {
  const m = ddl.match(/\b(\w+)\s+(INTEGER|TEXT|REAL)\b/g) ?? [];
  return m.filter((s) => !/^row_id\b/.test(s.trim())).length;
}

describe('acuTableSpec 表结构守卫（单一真相·机器可校验）', () => {
  const tables = buildDefaultTables();

  it('23 张默认表全部建出，uid 无重复', () => {
    expect(Object.keys(tables).length).toBe(23);
    expect(new Set(DEFAULT_SHEET_UIDS).size).toBe(23);
  });

  it('★每张表 ddl 列数 == headers 列数（防 headers/ddl 漂移）', () => {
    const drift: string[] = [];
    for (const sheet of Object.values(tables)) {
      const headerCount = (sheet.content[0]?.length ?? 0) - 1;   // 去掉 row_id
      const ddlCount = ddlColumnCount(sheet.sourceData.ddl);
      if (headerCount !== ddlCount) drift.push(`${sheet.name}：headers ${headerCount} 列 vs ddl ${ddlCount} 列`);
    }
    expect(drift).toEqual([]);
  });

  it('每张表 content[0] 以 row_id 开头', () => {
    for (const sheet of Object.values(tables)) {
      expect(sheet.content[0]?.[0]).toBe('row_id');
    }
  });

  it('★表内无重复列名（重复会让按列名定位静默错位）', () => {
    const dups: string[] = [];
    for (const sheet of Object.values(tables)) {
      const cols = sheet.content[0] ?? [];
      const seen = new Set<string>();
      for (const c of cols) {
        if (seen.has(c)) dups.push(`${sheet.name}：重复列「${c}」`);
        seen.add(c);
      }
    }
    expect(dups).toEqual([]);
  });

  it('单行表预置 row_id=1 空行且禁增删语义；多行表只留表头', () => {
    for (const sheet of Object.values(tables)) {
      if (sheet.single) {
        expect(sheet.content.length).toBe(2);        // 表头 + 唯一一行
        expect(sheet.content[1]?.[0]).toBe('1');     // row_id=1
      } else {
        expect(sheet.content.length).toBe(1);        // 只表头
      }
    }
  });

  it('ddl 的表名 == uid（英文表名一致，供 SQL 模式/文档对得上）', () => {
    for (const sheet of Object.values(tables)) {
      const m = sheet.sourceData.ddl.match(/CREATE TABLE\s+(\w+)/);
      expect(m?.[1]).toBe(sheet.uid);
    }
  });
});
