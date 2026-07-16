import { describe, it, expect, beforeEach } from 'vitest';
import { buildTableFillPrompt, buildPlotStateSnapshot } from './tablePrompt';
import { stripStateBlocks } from './stateParser';
import { useTables } from '../store/tableStore';
import { useTableJournal } from '../store/tableJournalStore';
import { buildCustomSheet } from './acuTableSpec';

beforeEach(() => { useTables.getState().resetAll(); useTableJournal.getState().clear(); });

describe('buildTableFillPrompt（1c：只教填纪要表·镜像表自动派生）', () => {
  it('含填表规则·只维护纪要表·明示镜像表别写·不再 dump 全表结构', () => {
    const p = buildTableFillPrompt();
    expect(p).toContain('表格数据库·填表铁则');
    expect(p).toContain('insertRow("纪要表"');
    expect(p).toContain('别写');                       // 明确告诉 AI 镜像表别填
    expect(p).not.toContain('「背包物品表」（多行');   // 旧的全表结构 dump 已移除
    expect(p).not.toContain('「主角信息表」（单行');
  });

  it('渲染纪要表最近记录供续写连贯', () => {
    useTables.getState().insertRow('chronicle', { 时间: '第1天', 地点: '新手村', 事件: '苏醒' });
    const p = buildTableFillPrompt();
    expect(p).toContain('纪要表·最近记录');
    expect(p).toContain('事件=苏醒');
  });

  it('无纪要时提示可记第一条', () => {
    expect(buildTableFillPrompt()).toContain('暂无');
  });

  it('only 过滤（填表调度·只维护指定表）：only=[progress] 只 dump 进程·不 dump 伏笔/纪要', () => {
    const p = buildTableFillPrompt(['progress']);
    expect(p).toContain('## 进程表·当前');
    expect(p).not.toContain('## 伏笔表·当前');
    expect(p).not.toContain('## 约定表·当前');
    expect(p).not.toContain('纪要表·最近记录');
  });

  it('only undefined/空 → 全 dump（与原行为一致）', () => {
    const p = buildTableFillPrompt();
    expect(p).toContain('纪要表·最近记录');
    expect(p).toContain('## 进程表·当前');
    expect(p).toContain('## 伏笔表·当前');
    expect(p).toContain('## 约定表·当前');
  });

  it('用户自定义表 → 连维护规则(note)+当前行一起注入', () => {
    const sheet = buildCustomSheet({ name: '好感度表', headers: ['对象', '好感值'], note: '0~100·友好+5·冲突-10' });
    useTables.getState().upsertSheet(sheet);
    useTables.getState().insertRow(sheet.uid, { 对象: '小红', 好感值: '60' });
    const p = buildTableFillPrompt();
    expect(p).toContain('好感度表（用户自定义');
    expect(p).toContain('维护规则');
    expect(p).toContain('0~100·友好+5·冲突-10');   // note 原样注入
    expect(p).toContain('对象=小红');
    expect(p).toContain('好感值=60');
  });

  it('无自定义表 → 不含自定义表块', () => {
    expect(buildTableFillPrompt()).not.toContain('用户自定义表（各按其');
  });
});

describe('buildPlotStateSnapshot（喂剧情指导·状态感知）', () => {
  it('全表皆空 → 空串（导演照旧只看最近5楼）', () => {
    expect(buildPlotStateSnapshot()).toBe('');
  });

  it('纪要表 → 渲染最近几条·带列=值', () => {
    useTables.getState().insertRow('chronicle', { 时间: '第1天', 地点: '新手村', 事件: '苏醒' });
    const s = buildPlotStateSnapshot();
    expect(s).toContain('【纪要·最近】');
    expect(s).toContain('事件=苏醒');
    expect(s).toContain('· ');   // 逐条前缀
  });

  it('进程/伏笔/约定 → 各自成块渲染', () => {
    useTables.getState().insertRow('progress', { 进程名: '兽化觉醒', 当前: '30%', 目标: '100%', 状态: '进行中' });
    useTables.getState().insertRow('foreshadowing', { 伏笔: '地下室的血迹', 状态: '未回收' });
    useTables.getState().insertRow('pacts', { 对象: '吉尔', 约定内容: '活着离开浣熊市', 状态: '生效中' });
    const s = buildPlotStateSnapshot();
    expect(s).toContain('【进程表】');
    expect(s).toContain('进程名=兽化觉醒');
    expect(s).toContain('【伏笔表】');
    expect(s).toContain('伏笔=地下室的血迹');
    expect(s).toContain('【约定表】');
    expect(s).toContain('约定内容=活着离开浣熊市');
  });

  it('只填了伏笔 → 不渲染空的进程/约定块', () => {
    useTables.getState().insertRow('foreshadowing', { 伏笔: '神秘信件', 状态: '未回收' });
    const s = buildPlotStateSnapshot();
    expect(s).toContain('【伏笔表】');
    expect(s).not.toContain('【进程表】');
    expect(s).not.toContain('【约定表】');
    expect(s).not.toContain('【纪要·最近】');
  });
});

describe('row_id 永久编号展示 + 失败回喂', () => {
  it('跟踪表 [ ] 展示 row_id（删行后编号不变·AI 照抄不打错行）', () => {
    useTables.getState().insertRow('progress', { 进程名: '甲' });   // row_id 1
    useTables.getState().insertRow('progress', { 进程名: '乙' });   // row_id 2
    useTables.getState().deleteRow('progress', 0);                  // 删甲 → 乙位移到 pos0 但编号仍是 2
    const p = buildTableFillPrompt(['progress']);
    expect(p).toContain('[2] 进程名=乙');
    expect(p).toContain('永久编号');
  });

  it('上回合填表失败 → 注入失败清单块让 AI 修正补写；无失败不注', () => {
    expect(buildTableFillPrompt()).not.toContain('上回合填表失败清单');
    useTableJournal.getState().setLastErrors(['updateRow 未命中行：updateRow("进程表", 99, {...})'], 12);
    const p = buildTableFillPrompt();
    expect(p).toContain('上回合填表失败清单');
    expect(p).toContain('第 12 回合');
    expect(p).toContain('updateRow 未命中行');
  });
});

describe('stripStateBlocks 剥 <tableEdit>（展示不泄漏给玩家）', () => {
  it('闭合形态被剥', () => {
    const t = '主角走进商店。\n<tableEdit>insertRow("背包物品表",{"物品名称":"剑"})</tableEdit>';
    expect(stripStateBlocks(t)).toBe('主角走进商店。');
  });
  it('截断未闭合形态也被剥', () => {
    const t = '主角走进商店。\n<tableEdit>insertRow("背包物品表",{"物品名称":"剑"})';
    expect(stripStateBlocks(t).trim()).toBe('主角走进商店。');
  });
});
