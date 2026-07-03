import { describe, it, expect, beforeEach } from 'vitest';
import { ensureSqliteMirror, isSqliteReady, resolveDbSqlTemplates, needsSqlite } from './tableSqlite';
import { resolveTableTemplates } from './tableTemplate';
import { useTables } from '../store/tableStore';

// 从当前 tableStore 现建 sql.js 镜像（每测重置表 + 重建）
async function setup() {
  const t = useTables.getState();
  t.resetAll();
  t.updateRow('protagonist_info', 0, { 姓名: '苏晓', HP: '80', 'HP上限': '100' });
  t.insertRow('inventory', { 物品名称: '铁剑', 类别: '武器', 数量: '2' });
  t.insertRow('inventory', { 物品名称: '木盾', 类别: '防具', 数量: '1' });
  t.insertRow('inventory', { 物品名称: '匕首', 类别: '武器', 数量: '3' });
  return ensureSqliteMirror();
}

describe('tableSqlite（6b·sql.js 只读镜像）', () => {
  let ready = false;
  beforeEach(async () => { ready = await setup(); });

  it('needsSqlite 判定（不加载 wasm）', () => {
    expect(needsSqlite('前 {[db.x.count()]} 后')).toBe(true);
    expect(needsSqlite('<if sql="SELECT 1">a</if>')).toBe(true);
    expect(needsSqlite('普通文本没有查询')).toBe(false);
  });

  it('镜像就绪', () => { expect(ready).toBe(true); expect(isSqliteReady()).toBe(true); });

  it('{[db]} ORM：where/get（中文表名+中文列名）', () => {
    expect(resolveDbSqlTemplates('{[db.背包物品表.where("物品名称","铁剑").get("数量")]}')).toBe('2');
  });
  it('{[db]} ORM：count', () => {
    expect(resolveDbSqlTemplates('武器 {[db.背包物品表.where("类别","武器").count()]} 件')).toBe('武器 2 件');
  });
  it('{[sql]} 原生 SQL（中文名翻译 + 聚合）', () => {
    expect(resolveDbSqlTemplates("{[sql \"SELECT SUM(数量) FROM 背包物品表 WHERE 类别='武器'\"]}")).toBe('5');
  });
  it('{[db … as X]} 存变量 + $v: 引用', () => {
    expect(resolveDbSqlTemplates('{[db.背包物品表.count() as n]}背包 $v:n 种物品')).toBe('背包 3 种物品');
  });
  it('单行表主角信息查询', () => {
    expect(resolveDbSqlTemplates('{[db.主角信息表.get("HP")]}/{[db.主角信息表.get("HP上限")]}')).toBe('80/100');
  });

  it('<if db> / <if sql>（经 resolveTableTemplates）', () => {
    expect(resolveTableTemplates("<if db=\"背包物品表.where('类别','武器').count() > 1\">武器多<else>少</if>")).toBe('武器多');
    expect(resolveTableTemplates("<if db=\"背包物品表.where('类别','武器').count() > 9\">武器多<else>少</if>")).toBe('少');
    expect(resolveTableTemplates("<if sql=\"SELECT 1 FROM 背包物品表 WHERE 物品名称='不存在'\">有<else>无</if>")).toBe('无');
  });
});
