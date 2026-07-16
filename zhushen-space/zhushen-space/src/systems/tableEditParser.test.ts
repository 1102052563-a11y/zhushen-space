import { describe, it, expect, beforeEach } from 'vitest';
import { extractTableEditInner, splitCommands, parseCommandLine, parseTableEdits, applyTableEdits } from './tableEditParser';
import { useTables } from '../store/tableStore';
import { useTableJournal } from '../store/tableJournalStore';

const T = () => useTables.getState();
beforeEach(() => { useTables.getState().resetAll(); useTableJournal.getState().clear(); });

describe('extractTableEditInner', () => {
  it('取最后一对 <tableEdit>', () => {
    const t = '<tableEdit>insertRow(1,{"0":"旧"})</tableEdit>随便<tableEdit>insertRow(1,{"0":"新"})</tableEdit>';
    expect(extractTableEditInner(t)).toContain('新');
    expect(extractTableEditInner(t)).not.toContain('旧');
  });
  it('无标签时从含命令的 <!-- --> 注释块兜底', () => {
    const t = 'AI 正文…\n<!-- insertRow(2,{"0":"铁剑"}) -->\n结束';
    expect(extractTableEditInner(t)).toContain('insertRow');
  });
  it('都没有 → null', () => {
    expect(extractTableEditInner('纯正文没有指令')).toBeNull();
  });
});

describe('splitCommands', () => {
  it('跨行 JSON 重组', () => {
    const inner = 'insertRow(2, {\n"0":"铁剑",\n"3":"1"\n})';
    const cmds = splitCommands(inner);
    expect(cmds.length).toBe(1);
    expect(cmds[0]).toContain('铁剑');
  });
  it('一行多条按 ; 拆', () => {
    const inner = 'insertRow(2,{"0":"A"}); deleteRow(2,0); updateRow(0,0,{"0":"苏晓"})';
    expect(splitCommands(inner).length).toBe(3);
  });
  it('剥行内 // 注释', () => {
    const inner = 'insertRow(2,{"0":"盾"}) // 加个盾';
    const cmd = splitCommands(inner)[0];
    expect(cmd).not.toContain('加个盾');
  });
});

describe('parseCommandLine', () => {
  it('insertRow 表序号 + 列索引数据', () => {
    const p = parseCommandLine('insertRow(2, {"0":"铁剑","3":"1"})');
    expect(p?.command).toBe('insertRow');
    expect(p?.args[0]).toBe(2);
    expect(p?.args[1]).toEqual({ '0': '铁剑', '3': '1' });
  });
  it('updateRow 三参', () => {
    const p = parseCommandLine('updateRow(0, 0, {"姓名":"苏晓"})');
    expect(p?.args).toEqual([0, 0, { 姓名: '苏晓' }]);
  });
  it('deleteRow 无数据对象', () => {
    const p = parseCommandLine('deleteRow(2, 1)');
    expect(p?.command).toBe('deleteRow');
    expect(p?.args).toEqual([2, 1]);
  });
  it('宽松 JSON：裸键/单引号/尾逗号', () => {
    const p = parseCommandLine("insertRow(2, {0:'布衣',1:'防具',})");
    expect(p?.args[1]).toEqual({ '0': '布衣', '1': '防具' });
  });
  it('非命令行 → null', () => {
    expect(parseCommandLine('这不是指令')).toBeNull();
  });
});

describe('applyTableEdits（写进 tableStore）', () => {
  it('表引用三态：序号 / uid / 中文名', () => {
    applyTableEdits('<tableEdit>insertRow(2,{"0":"甲"})</tableEdit>');        // 序号 2 = 背包
    applyTableEdits('<tableEdit>insertRow("inventory",{"0":"乙"})</tableEdit>'); // uid
    applyTableEdits('<tableEdit>insertRow("背包物品表",{"0":"丙"})</tableEdit>'); // 中文名
    const names = T().rows('inventory').map((r) => r['物品名称']);
    expect(names).toEqual(['甲', '乙', '丙']);
  });

  it('列索引数据落到正确列', () => {
    const r = applyTableEdits('<tableEdit>insertRow(2,{"0":"铁剑","1":"武器","2":"精良","3":"2"})</tableEdit>');
    expect(r.applied).toBe(1);
    expect(r.modifiedUids).toEqual(['inventory']);
    const row = T().rows('inventory')[0];
    expect(row['物品名称']).toBe('铁剑');
    expect(row['类别']).toBe('武器');
    expect(row['数量']).toBe('2');
  });

  it('单行表用 updateRow(0,...)（主角信息）', () => {
    const r = applyTableEdits('<tableEdit>updateRow(0,0,{"姓名":"苏晓","阶位":"一阶"})</tableEdit>');
    expect(r.applied).toBe(1);
    expect(T().getCell('protagonist_info', 0, '姓名')).toBe('苏晓');
  });

  it('单行表 insertRow 被拒计入 failed', () => {
    const r = applyTableEdits('<tableEdit>insertRow(0,{"姓名":"X"})</tableEdit>'); // 主角=单行已有row1
    expect(r.applied).toBe(0);
    expect(r.failed).toBe(1);
  });

  it('全角冒号 + 字面\\n + 真实 AI 响应整体应用', () => {
    const ai = [
      '<thought>分析剧情…</thought>',
      '<content>',
      '<tableEdit>',
      'insertRow(1，{"0"："乐园币","1"："500"})\\n',   // 全角冒号+逗号+字面\n
      'deleteRow(2, 0)',                                // 删背包不存在的行 → 未命中
      '</tableEdit>',
      '</content>',
    ].join('\n');
    const r = applyTableEdits(ai);
    expect(T().getCell('currency', 0, '货币名称')).toBe('乐园币');
    expect(T().getCell('currency', 0, '数量')).toBe('500');
    expect(r.applied).toBeGreaterThanOrEqual(1);
  });

  it('多条指令混合 + 表未匹配计 failed', () => {
    const r = applyTableEdits('<tableEdit>insertRow(2,{"0":"A"});insertRow("不存在的表",{"0":"B"})</tableEdit>');
    expect(r.applied).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.errors[0]).toContain('表未匹配');
  });

  it('parseTableEdits 纯解析不写 store', () => {
    const cmds = parseTableEdits('<tableEdit>insertRow(2,{"0":"X"})</tableEdit>');
    expect(cmds.length).toBe(1);
    expect(T().rows('inventory').length).toBe(0); // 未写入
  });
});

describe('row_id 优先解析（行的永久编号·删行位移不打错行）', () => {
  it('删行位移后 updateRow 按 row_id 命中原行', () => {
    T().insertRow('progress', { 进程名: '甲', 状态: '进行中' });   // row_id 1
    T().insertRow('progress', { 进程名: '乙', 状态: '进行中' });   // row_id 2
    T().insertRow('progress', { 进程名: '丙', 状态: '进行中' });   // row_id 3
    T().deleteRow('progress', 0);   // 删甲 → 丙从 pos2 位移到 pos1
    const r = applyTableEdits('<tableEdit>updateRow("进程表", 3, {"状态":"已达成"})</tableEdit>');
    expect(r.applied).toBe(1);
    const rows = T().rows('progress');
    expect(rows.find((x) => x['进程名'] === '丙')!['状态']).toBe('已达成');
    expect(rows.find((x) => x['进程名'] === '乙')!['状态']).toBe('进行中');   // 旧位置语义会误改乙——现在不会
  });

  it('批内 deleteRow 之后的 updateRow 不受位移影响', () => {
    T().insertRow('progress', { 进程名: '甲' });
    T().insertRow('progress', { 进程名: '乙' });
    T().insertRow('progress', { 进程名: '丙' });
    const r = applyTableEdits('<tableEdit>deleteRow("进程表", 1)\nupdateRow("进程表", 3, {"状态":"已达成"})</tableEdit>');
    expect(r.applied).toBe(2);
    expect(T().rows('progress').find((x) => x['进程名'] === '丙')!['状态']).toBe('已达成');
  });

  it('"0" 永远按 0 基行号（row_id 从 1 起·单行表 updateRow(表,0) 兼容不变）', () => {
    const r = applyTableEdits('<tableEdit>updateRow("主角信息表", 0, {"姓名":"苏晓"})</tableEdit>');
    expect(r.applied).toBe(1);
    expect(T().getCell('protagonist_info', 0, '姓名')).toBe('苏晓');
  });
});

describe('幂等 + 编辑日志（tableJournalStore）', () => {
  it('同回合同批指令重复应用 = 整批 no-op（治意外双调双插）', () => {
    const text = '<tableEdit>insertRow("纪要表", {"时间":"第1天","地点":"新手村","事件":"苏醒"})</tableEdit>';
    const r1 = applyTableEdits(text, { turn: 7 });
    expect(r1.applied).toBe(1);
    const r2 = applyTableEdits(text, { turn: 7 });
    expect(r2.skippedDuplicate).toBe(true);
    expect(r2.applied).toBe(0);
    expect(T().rows('chronicle').length).toBe(1);
  });

  it('不同回合同文本不误拦（正常连续回合）', () => {
    const text = '<tableEdit>insertRow("纪要表", {"事件":"赶路"})</tableEdit>';
    applyTableEdits(text, { turn: 7 });
    const r2 = applyTableEdits(text, { turn: 8 });
    expect(r2.applied).toBe(1);
    expect(T().rows('chronicle').length).toBe(2);
  });

  it('失败清单：失败批记入 lastErrors·下批成功清空（供下回合回喂自纠）', () => {
    applyTableEdits('<tableEdit>updateRow("进程表", 99, {"状态":"x"})</tableEdit>', { turn: 3 });
    expect(useTableJournal.getState().lastErrors.length).toBe(1);
    expect(useTableJournal.getState().lastErrors[0]).toContain('未命中');
    applyTableEdits('<tableEdit>insertRow("纪要表", {"事件":"顺利"})</tableEdit>', { turn: 4 });
    expect(useTableJournal.getState().lastErrors.length).toBe(0);
  });

  it('删除找回：deleteRow 的整行镜像进日志·restoreDeleted 放回原位（图书馆铁则）', () => {
    T().insertRow('progress', { 进程名: '献祭仪式', 状态: '进行中' });
    applyTableEdits('<tableEdit>deleteRow("进程表", 1)</tableEdit>', { turn: 5 });
    expect(T().rows('progress').length).toBe(0);
    const entry = useTableJournal.getState().entries.find((e) => e.command === 'deleteRow');
    expect(entry?.before?.[0]).toBe('1');   // 整行镜像含原 row_id
    expect(useTableJournal.getState().restoreDeleted(entry!.id)).toBe(true);
    const rows = T().rows('progress');
    expect(rows.length).toBe(1);
    expect(rows[0].row_id).toBe('1');
    expect(rows[0]['进程名']).toBe('献祭仪式');
    expect(useTableJournal.getState().restoreDeleted(entry!.id)).toBe(false);   // 二次恢复被拒
  });

  it('insert/update 也进流水（before/after 镜像·审计可查）', () => {
    applyTableEdits('<tableEdit>insertRow("进程表", {"进程名":"觉醒","当前":"10"})\nupdateRow("进程表", 1, {"当前":"20"})</tableEdit>', { turn: 6 });
    const es = useTableJournal.getState().entries;
    expect(es.length).toBe(2);
    expect(es[0].command).toBe('insertRow');
    expect(es[0].after).toBeTruthy();
    expect(es[1].command).toBe('updateRow');
    expect(es[1].before).toBeTruthy();
    expect(es[1].after?.join('|')).toContain('20');
    expect(es[1].before?.join('|')).toContain('10');
  });
});
