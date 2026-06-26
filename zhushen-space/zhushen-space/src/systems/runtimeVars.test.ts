import { describe, it, expect, beforeEach } from 'vitest';
import { buildRuntimeVars, runtimeVarCatalog } from './runtimeVars';
import { processMacros, makeMacroCtx } from './stMacros';
import { usePlayer } from '../store/playerStore';
import { useItems } from '../store/itemStore';
import { useMisc } from '../store/miscStore';
import { useVariables } from '../store/variableStore';

/* 透明变量桥：核心游戏态 + 自定义变量 → 宏可引用。 */
describe('runtimeVars · 透明变量桥', () => {
  beforeEach(() => {
    useVariables.setState({ variables: [] });
  });

  it('核心游戏态以命名空间键暴露（主角./货币./世界.）', () => {
    usePlayer.getState().setProfile({ ...usePlayer.getState().profile, name: '叶凡', tier: '三阶' });
    useItems.setState((s) => ({ currency: { ...s.currency, 乐园币: 999 } }));
    useMisc.getState().setTime({ worldName: '火影世界' });
    const vars = buildRuntimeVars();
    expect(vars['主角.名']).toBe('叶凡');
    expect(vars['主角.阶位']).toBe('三阶');
    expect(vars['货币.乐园币']).toBe('999');
    expect(vars['世界.名']).toBe('火影世界');
    // 六维以中文键暴露
    expect('主角.力量' in vars).toBe(true);
    expect('主角.HP' in vars).toBe(true);
  });

  it('自定义变量按原始 key 暴露，AI 更新后取回最新值', () => {
    useVariables.getState().upsertDefinition({ key: '好感度', label: '小南好感', type: 'number', value: 42, showInStatusBar: false });
    expect(buildRuntimeVars()['好感度']).toBe('42');
    // 模拟正文 AI 经 <state> 改值
    useVariables.getState().setVariable('好感度', 77);
    expect(buildRuntimeVars()['好感度']).toBe('77');
  });

  it('预设宏 {{getvar::名}} / ${名} 解析成当前值（端到端）', () => {
    usePlayer.getState().setProfile({ ...usePlayer.getState().profile, name: '萧炎' });
    useVariables.getState().upsertDefinition({ key: '堕落值', label: '堕落值', type: 'number', value: 30, showInStatusBar: false });
    const ctx = makeMacroCtx({ runtimeVars: buildRuntimeVars(), random: () => 0 });
    expect(processMacros('主角：{{getvar::主角.名}}，堕落值=${堕落值}', ctx)).toBe('主角：萧炎，堕落值=30');
  });

  it('预设内 {{setvar}} 可就地覆盖种子值（不冲突）', () => {
    useVariables.getState().upsertDefinition({ key: '风格', label: '风格', type: 'string', value: '热血', showInStatusBar: false });
    const ctx = makeMacroCtx({ runtimeVars: buildRuntimeVars(), random: () => 0 });
    // 先取种子值，再覆盖
    expect(processMacros('{{getvar::风格}}', ctx)).toBe('热血');
    processMacros('{{setvar::风格::冷硬}}', ctx);
    expect(processMacros('{{getvar::风格}}', ctx)).toBe('冷硬');
  });

  it('目录区分核心态与自定义两组', () => {
    useVariables.getState().upsertDefinition({ key: '主线进度', label: '主线进度', type: 'number', value: 1, showInStatusBar: false });
    const rows = runtimeVarCatalog();
    expect(rows.some((r) => r.group === '核心游戏态' && r.name === '世界.名')).toBe(true);
    expect(rows.some((r) => r.group === '自定义变量' && r.name === '主线进度' && r.custom)).toBe(true);
  });
});
