import { describe, it, expect, beforeEach } from 'vitest';
import { extractTableEditInner, splitCommands, parseCommandLine, parseTableEdits, applyTableEdits } from './tableEditParser';
import { useTables } from '../store/tableStore';

const T = () => useTables.getState();
beforeEach(() => { useTables.getState().resetAll(); });

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
