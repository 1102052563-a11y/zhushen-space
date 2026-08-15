/* 大总结·纪要压实（借鉴 ACU 飞行模式）端到端：
   规划公式（planChronicleCompaction）→ 填表提示词点名（buildTableFillPrompt）→
   写路径护栏+水位线（applyTableEdits/advanceCompaction）→ 剧情快照（buildPlotStateSnapshot）→ 迁移（addMissingDefaultSheets）。 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useTables, addMissingDefaultSheets } from '../store/tableStore';
import { useTableJournal } from '../store/tableJournalStore';
import {
  CHRONICLE_UID, BIG_SUMMARY_UID, BIG_SUMMARY_THRESHOLD,
  planChronicleCompaction, visibleChronicleRows, type AcuTableData,
} from './acuTableSpec';
import { applyTableEdits } from './tableEditParser';
import { buildTableFillPrompt, buildPlotStateSnapshot, chronicleRecallCorpus, chronicleFillBacklog } from './tablePrompt';
import { buildMemPool } from './factVec';
import { useMisc } from '../store/miscStore';
import { useChronicle } from '../store/chronicleStore';

const T = () => useTables.getState();
beforeEach(() => { T().resetAll(); useTableJournal.getState().clear(); });

/** 播种 n 条纪要行（事件1..事件n）。 */
function seedChronicle(n: number) {
  for (let i = 1; i <= n; i++) {
    T().insertRow(CHRONICLE_UID, { 时间: `第${i}天`, 地点: '试炼场', 事件: `事件${i}` });
  }
}

describe('planChronicleCompaction 规划公式', () => {
  it('可见纪要不足阈值 → null', () => {
    seedChronicle(BIG_SUMMARY_THRESHOLD - 1);
    expect(planChronicleCompaction(T().getSheet(CHRONICLE_UID))).toBeNull();
  });
  it('满阈值 → 归纳最早一段（保留最近6行）·throughId=段末 row_id', () => {
    seedChronicle(15);
    const plan = planChronicleCompaction(T().getSheet(CHRONICLE_UID));
    expect(plan).not.toBeNull();
    expect(plan!.rows.length).toBe(9);          // 15 - KEEP_RECENT(6)
    expect(plan!.fromId).toBe('1');
    expect(plan!.throughId).toBe('9');
  });
  it('老档积压几百行 → 单次至多 SLICE_MAX 行（分片阶梯，防 token 炸弹）', () => {
    seedChronicle(80);
    const plan = planChronicleCompaction(T().getSheet(CHRONICLE_UID));
    expect(plan!.rows.length).toBe(25);         // min(80-6, 25)
    expect(plan!.throughId).toBe('25');
  });
  it('水位线之下的行不算可见', () => {
    seedChronicle(20);
    T().advanceCompaction(CHRONICLE_UID, 10);
    expect(visibleChronicleRows(T().getSheet(CHRONICLE_UID)).length).toBe(10);
    expect(planChronicleCompaction(T().getSheet(CHRONICLE_UID))).toBeNull();   // 可见10 < 15
  });
});

describe('buildTableFillPrompt 点名板块', () => {
  it('未满阈值 → 无大总结板块', () => {
    seedChronicle(5);
    expect(buildTableFillPrompt()).not.toContain('## ⚠ 大总结·本回合归纳');
  });
  it('满阈值 → 点名板块列出待归纳行（含首末编号·不含保留窗口行）', () => {
    seedChronicle(15);
    const p = buildTableFillPrompt();
    expect(p).toContain('## ⚠ 大总结·本回合归纳');
    expect(p).toContain('[1] ');
    expect(p).toContain('[9] ');
    expect(p).toContain('事件9');
    expect(p).not.toContain('[10] ');            // 第10行起是保留窗口，不进归纳清单
    expect(p).toContain('insertRow("大总结表"');
  });
  it('压实后：已折叠行不回显最近记录、板块消失', () => {
    seedChronicle(15);
    T().advanceCompaction(CHRONICLE_UID, 9);
    const p = buildTableFillPrompt();
    expect(p).not.toContain('## ⚠ 大总结·本回合归纳');
    expect(p).not.toContain('事件9');            // 已压实
    expect(p).toContain('事件10');               // 可见窗口
  });
});

describe('applyTableEdits 写路径护栏 + 水位线', () => {
  it('系统点名时：插入成功 + 系统补记覆盖范围 + 水位线推进', () => {
    seedChronicle(15);
    const r = applyTableEdits('<tableEdit>insertRow("大总结表", {"总结":"前九日试炼概要"})</tableEdit>', { turn: 1 });
    expect(r.applied).toBe(1);
    expect(r.failed).toBe(0);
    const big = T().getSheet(BIG_SUMMARY_UID)!;
    expect(big.content.length).toBe(2);
    expect(big.content[1][1]).toBe('前九日试炼概要');
    expect(big.content[1][2]).toBe('#1~#9');     // 覆盖纪要=系统自动记
    expect(T().getSheet(CHRONICLE_UID)!.compactedThrough).toBe(9);
    expect(visibleChronicleRows(T().getSheet(CHRONICLE_UID)).length).toBe(6);
  });
  it('未点名（可见不足阈值）→ 大总结插入被确定性拒收', () => {
    seedChronicle(3);
    const r = applyTableEdits('<tableEdit>insertRow("大总结表", {"总结":"幻觉总结"})</tableEdit>', { turn: 2 });
    expect(r.applied).toBe(0);
    expect(r.failed).toBe(1);
    expect(r.errors[0]).toContain('大总结被拒');
    expect(T().getSheet(BIG_SUMMARY_UID)!.content.length).toBe(1);   // 只有表头
    expect(T().getSheet(CHRONICLE_UID)!.compactedThrough ?? 0).toBe(0);
  });
  it('一批两条大总结 → 只收第一条', () => {
    seedChronicle(15);
    const r = applyTableEdits('<tableEdit>insertRow("大总结表", {"总结":"A"})\ninsertRow("大总结表", {"总结":"B"})</tableEdit>', { turn: 3 });
    expect(r.applied).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.errors[0]).toContain('一批最多一条');
    expect(T().getSheet(BIG_SUMMARY_UID)!.content.length).toBe(2);
  });
  it('大总结不可变：updateRow/deleteRow 一律拒收', () => {
    seedChronicle(15);
    applyTableEdits('<tableEdit>insertRow("大总结表", {"总结":"阶段一"})</tableEdit>', { turn: 4 });
    const r = applyTableEdits('<tableEdit>updateRow("大总结表", 1, {"总结":"篡改"})\ndeleteRow("大总结表", 1)</tableEdit>', { turn: 5 });
    expect(r.applied).toBe(0);
    expect(r.failed).toBe(2);
    expect(r.errors.every((e) => e.includes('不可变'))).toBe(true);
    expect(T().getSheet(BIG_SUMMARY_UID)!.content[1][1]).toBe('阶段一');
  });
  it('同批携带纪要插入照常入账（大总结与常规维护并存）', () => {
    seedChronicle(15);
    const r = applyTableEdits('<tableEdit>insertRow("纪要表", {"时间":"第16天","地点":"营地","事件":"事件16"})\ninsertRow("大总结表", {"总结":"前段归纳"})</tableEdit>', { turn: 6 });
    expect(r.applied).toBe(2);
    // 水位线按批前状态算（=prompt 同一口径）：折到 #9，本批新纪要仍可见
    expect(T().getSheet(CHRONICLE_UID)!.compactedThrough).toBe(9);
    expect(visibleChronicleRows(T().getSheet(CHRONICLE_UID)).map((r2) => r2[0])).toContain('16');
  });
});

describe('快照 / store / 迁移', () => {
  it('buildPlotStateSnapshot 带最近大总结', () => {
    seedChronicle(15);
    applyTableEdits('<tableEdit>insertRow("大总结表", {"总结":"试炼期归纳"})</tableEdit>', { turn: 7 });
    const s = buildPlotStateSnapshot();
    expect(s).toContain('大总结·最近');
    expect(s).toContain('试炼期归纳');
  });
  it('advanceCompaction 只进不退', () => {
    seedChronicle(20);
    T().advanceCompaction(CHRONICLE_UID, 9);
    T().advanceCompaction(CHRONICLE_UID, 5);
    expect(T().getSheet(CHRONICLE_UID)!.compactedThrough).toBe(9);
  });
  it('addMissingDefaultSheets：v10 老档补上大总结表·已有表原封不动（row_id 不重排）', () => {
    seedChronicle(3);
    const old: AcuTableData = { ...T().exportSnapshot() };
    delete old[BIG_SUMMARY_UID];                 // 模拟 v10 档（没有大总结表）
    const migrated = addMissingDefaultSheets(old);
    expect(migrated[BIG_SUMMARY_UID]).toBeTruthy();
    expect(migrated[CHRONICLE_UID]).toBe(old[CHRONICLE_UID]);   // 引用不变=一个字没动
  });
});

describe('⏳ 填表积压检测（借鉴 ACU 仪表盘 overdue）', () => {
  it('纪要断更 gap≥阈值 → overdue；记上就恢复；老档无回合索引不误报', () => {
    useMisc.getState().setTurnCount(10);
    useChronicle.getState().clearChronicle();
    expect(chronicleFillBacklog()?.overdue).toBe(true);       // 空纪要·第10回合：gap=10 ≥ 1+3
    applyTableEdits('<tableEdit>insertRow("纪要表", {"时间":"t","地点":"l","事件":"e"})</tableEdit>', { turn: 9 });
    expect(chronicleFillBacklog()?.overdue).toBe(false);      // 最后一条记在第9回合：gap=1
    useChronicle.getState().clearChronicle();                 // 模拟老档：有纪要行、没 rowMeta 回合索引
    expect(chronicleFillBacklog()).toBeNull();
  });
});

describe('🔒 行锁（借鉴 ACU patch_sheet_locks）', () => {
  it('锁定行：AI updateRow/deleteRow 被拒·错误进清单；解锁后恢复', () => {
    T().insertRow('pacts', { 对象: '苏晓', 约定内容: '十年之约', 状态: '生效' });
    T().toggleRowLock('pacts', '1');
    const r = applyTableEdits('<tableEdit>updateRow("约定表", 1, {"状态":"已破裂"})\ndeleteRow("约定表", 1)</tableEdit>', { turn: 20 });
    expect(r.applied).toBe(0);
    expect(r.failed).toBe(2);
    expect(r.errors.every((e) => e.includes('锁定'))).toBe(true);
    expect(T().getCell('pacts', 0, '状态')).toBe('生效');
    T().toggleRowLock('pacts', '1');   // 解锁
    const r2 = applyTableEdits('<tableEdit>updateRow("约定表", 1, {"状态":"已兑现"})</tableEdit>', { turn: 21 });
    expect(r2.applied).toBe(1);
    expect(T().getCell('pacts', 0, '状态')).toBe('已兑现');
  });
  it('锁只拦截目标行：同批其他行/insertRow 照常', () => {
    T().insertRow('pacts', { 对象: 'A', 约定内容: '甲', 状态: '生效' });
    T().insertRow('pacts', { 对象: 'B', 约定内容: '乙', 状态: '生效' });
    T().toggleRowLock('pacts', '1');
    const r = applyTableEdits('<tableEdit>updateRow("约定表", 2, {"状态":"已兑现"})\ninsertRow("约定表", {"对象":"C","约定内容":"丙","状态":"生效"})</tableEdit>', { turn: 22 });
    expect(r.applied).toBe(2);
    expect(r.failed).toBe(0);
  });
  it('填表提示词给锁定行打 🔒 标', () => {
    T().insertRow('pacts', { 对象: '苏晓', 约定内容: '十年之约', 状态: '生效' });
    T().toggleRowLock('pacts', '1');
    const p = buildTableFillPrompt();
    expect(p).toContain('[1]🔒');
    expect(p).toContain('禁止 updateRow/deleteRow');
  });
});

describe('纪要向量召回语料（交火模式借鉴）', () => {
  it('chronicleRecallCorpus：排除最近3行·含已压实行·大总结只放掉出注入窗的', () => {
    seedChronicle(10);
    T().advanceCompaction(CHRONICLE_UID, 5);     // 前5行已压实——照样进召回语料（折叠出上下文、向量捞回来）
    for (const s of ['阶段一', '阶段二', '阶段三']) T().insertRow(BIG_SUMMARY_UID, { 总结: s });
    const c = chronicleRecallCorpus();
    expect(c.chronicleRows.length).toBe(7);      // 10 - 最近3
    expect(c.chronicleRows[0].text).toBe('事件1');   // 已压实的 #1 仍在
    expect(c.chronicleRows[6].text).toBe('事件7');
    expect(c.bigSummaries).toEqual(['阶段一']);      // 最近2条（阶段二/三）已固定注入，不进池
  });
  it('buildMemPool：纪要行入池 kind=chron；factsOnly 时不进池', () => {
    const rows = [{ time: '第1天', location: '试炼场', text: '击败石像鬼' }];
    const pool = buildMemPool({ chronicleRows: rows });
    const chron = pool.filter((p) => p.kind === 'chron');
    expect(chron.length).toBe(1);
    expect(chron[0].body).toContain('击败石像鬼');
    expect(buildMemPool({ chronicleRows: rows }, 1000, true).filter((p) => p.kind === 'chron').length).toBe(0);
  });
});
