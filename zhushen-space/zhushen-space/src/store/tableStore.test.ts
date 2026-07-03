import { describe, it, expect, beforeEach } from 'vitest';
import { useTables, evolveTables } from './tableStore';
import { buildDefaultTables, DEFAULT_SHEET_UIDS, type AcuTableData } from '../systems/acuTableSpec';

const T = () => useTables.getState();

beforeEach(() => {
  useTables.getState().resetAll();
});

describe('acuTableSpec / buildDefaultTables', () => {
  it('23 张默认表，含 row_id 表头', () => {
    const tables = buildDefaultTables();
    expect(Object.keys(tables).length).toBe(23);
    expect(DEFAULT_SHEET_UIDS).toContain('protagonist_info');
    for (const uid of DEFAULT_SHEET_UIDS) {
      expect(tables[uid].content[0][0]).toBe('row_id');
    }
  });

  it('单行表预置 row_id=1 空行；多行表只有表头', () => {
    const tables = buildDefaultTables();
    expect(tables.protagonist_info.single).toBe(true);
    expect(tables.protagonist_info.content.length).toBe(2);      // 表头 + 1 空行
    expect(tables.protagonist_info.content[1][0]).toBe('1');
    expect(tables.inventory.single).toBe(false);
    expect(tables.inventory.content.length).toBe(1);             // 仅表头
  });

  it('sortedSheets 按 orderNo', () => {
    const order = T().sortedSheets().map((s) => s.orderNo);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(T().sortedSheets()[0].uid).toBe('protagonist_info');
  });
});

describe('insertRow（多行表）', () => {
  it('按列索引键插入并读回', () => {
    const idx = T().insertRow('inventory', { 0: '铁剑', 1: '武器', 2: '普通', 3: '1' });
    expect(idx).toBe(0);
    expect(T().getCell('inventory', 0, '物品名称')).toBe('铁剑');
    expect(T().getCell('inventory', 0, 1)).toBe('武器'); // 按索引读
    // 新 row_id = content.length 表头占 0 → 首条 = "1"
    expect(T().rows('inventory')[0].row_id).toBe('1');
  });

  it('按中文列名键插入', () => {
    T().insertRow('currency', { 货币名称: '乐园币', 数量: '500' });
    expect(T().getCell('currency', 0, '数量')).toBe('500');
  });

  it('缺省列补空串', () => {
    T().insertRow('talents', { 天赋名称: '剑心' });
    const row = T().rows('talents')[0];
    expect(row['天赋名称']).toBe('剑心');
    expect(row['品级']).toBe('');
  });
});

describe('updateRow / updateCell', () => {
  it('updateRow 按索引与按列名混合改', () => {
    T().insertRow('inventory', { 物品名称: '布衣', 品级: '普通' });
    T().updateRow('inventory', 0, { 2: '精良', 已装备: '是' }); // 2=品级列索引
    expect(T().getCell('inventory', 0, '品级')).toBe('精良');
    expect(T().getCell('inventory', 0, '已装备')).toBe('是');
    expect(T().getCell('inventory', 0, '物品名称')).toBe('布衣'); // 未动的列不变
  });

  it('单行表主角信息 updateRow(0,...) 直接可用', () => {
    const ok = T().updateRow('protagonist_info', 0, { 姓名: '苏晓', 阶位: '一阶' });
    expect(ok).toBe(true);
    expect(T().getCell('protagonist_info', 0, '姓名')).toBe('苏晓');
  });

  it('updateCell 改单格', () => {
    T().insertRow('currency', { 货币名称: '魂币', 数量: '10' });
    T().updateCell('currency', 0, '数量', '99');
    expect(T().getCell('currency', 0, '数量')).toBe('99');
  });
});

describe('deleteRow / query', () => {
  it('删行后 query 过滤生效', () => {
    T().insertRow('important_characters', { 姓名: '张三', 关系: '盟友' });
    T().insertRow('important_characters', { 姓名: '李四', 关系: '宿敌' });
    expect(T().rows('important_characters').length).toBe(2);
    T().deleteRow('important_characters', 0); // 删张三
    const rest = T().rows('important_characters');
    expect(rest.length).toBe(1);
    expect(rest[0]['姓名']).toBe('李四');
    expect(T().query('important_characters', { 关系: '宿敌' }).length).toBe(1);
    expect(T().query('important_characters', { 关系: '盟友' }).length).toBe(0);
  });
});

describe('单行表护栏', () => {
  it('单行表拒绝 insertRow 与 deleteRow', () => {
    expect(T().insertRow('protagonist_info', { 姓名: 'X' })).toBe(-1); // 已有 row_id=1
    expect(T().deleteRow('global_state', 0)).toBe(false);
    expect(T().getSheet('protagonist_info')!.content.length).toBe(2); // 未被加行
  });
});

describe('快照导入导出', () => {
  it('exportSnapshot / importSnapshot 往返', () => {
    T().insertRow('inventory', { 物品名称: '回城卷轴', 数量: '3' });
    const snap = JSON.parse(JSON.stringify(T().exportSnapshot()));
    T().resetAll();
    expect(T().rows('inventory').length).toBe(0);
    T().importSnapshot(snap);
    expect(T().getCell('inventory', 0, '物品名称')).toBe('回城卷轴');
  });
});

describe('evolveTables（v1→v2 结构演进·列名重映射·数据不丢）', () => {
  it('★旧主角表(无真实属性列)演进后：加出新列(空)+ 旧数据按列名保留', () => {
    // 模拟老存档的主角表：只有旧 22 列的一部分
    const oldTables = {
      protagonist_info: {
        uid: 'protagonist_info', name: '主角信息表', single: true, orderNo: 1,
        sourceData: { note: '', initNode: '', insertNode: '', updateNode: '', deleteNode: '', ddl: '' },
        content: [
          ['row_id', '姓名', '力量', '理智'],
          ['1', '苏晓', '100', '90'],
        ],
        updateConfig: {} as any, exportConfig: {} as any,
      },
    } as unknown as AcuTableData;
    const evolved = evolveTables(oldTables);
    const p = evolved['protagonist_info'];
    const headers = p.content[0].slice(1);
    expect(headers).toContain('真实力量');          // 新列加出来了
    expect(headers).toContain('理智');
    const row = p.content[1];
    const col = (h: string) => row[headers.indexOf(h) + 1];
    expect(col('姓名')).toBe('苏晓');                // 旧数据按列名保留
    expect(col('力量')).toBe('100');
    expect(col('理智')).toBe('90');
    expect(col('真实力量')).toBe('');                // 新列留空
  });

  it('保留用户自建的非默认表', () => {
    const oldTables = {
      my_custom: { uid: 'my_custom', name: '我的表', single: false, orderNo: 99,
        sourceData: { note: '', initNode: '', insertNode: '', updateNode: '', deleteNode: '', ddl: '' },
        content: [['row_id', 'A'], ['1', 'x']], updateConfig: {} as any, exportConfig: {} as any } as any,
    } as unknown as AcuTableData;
    const evolved = evolveTables(oldTables);
    expect(evolved['my_custom']).toBeTruthy();
    expect(evolved['protagonist_info']).toBeTruthy();   // 默认表也补齐
  });
});
