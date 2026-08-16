import { describe, it, expect, beforeEach } from 'vitest';
import { makePromptExpandCtx, expandPromptText } from './promptExpand';
import { usePlayer } from '../store/playerStore';
import { useGame } from '../store/gameStore';
import { useVariables } from '../store/variableStore';
import { useSnippets } from '../store/snippetStore';

/* 统一提示词展开：表格模板(<if var>) → ST 宏，一份 runtimeVars 两层共享。 */
describe('promptExpand · expandPromptText', () => {
  beforeEach(() => {
    useVariables.setState({ variables: [] });
    useSnippets.setState({ items: [] });
    usePlayer.getState().setProfile({ ...usePlayer.getState().profile, name: '苏晓' });
    useGame.setState((s) => ({ player: { ...s.player, hp: 20, maxHp: 100 } }));
  });

  it('端到端：<if var="主角.HP百分比 < 30"> 分支 + 分支内 ST 宏', () => {
    const ctx = makePromptExpandCtx({ user: '苏晓', char: '苏晓', random: () => 0 });
    const t = '<if var="主角.HP百分比 < 30">{{user}}濒死，笔法{{random::狠辣::温和}}<else>健康</if>';
    expect(expandPromptText(t, ctx)).toBe('苏晓濒死，笔法狠辣');
  });

  it('条件不满足走 else；自定义变量可作 cond 的 var: 原子', () => {
    useGame.setState((s) => ({ player: { ...s.player, hp: 90, maxHp: 100 } }));
    useVariables.getState().upsertDefinition({ key: '堕落值', label: '堕落值', type: 'number', value: 80, showInStatusBar: false });
    const ctx = makePromptExpandCtx({ random: () => 0 });
    expect(expandPromptText('<if var="主角.HP百分比 < 30">濒死<else>健康</if>', ctx)).toBe('健康');
    expect(expandPromptText('<if cond="var:堕落值 >= 60">黑化倾向</if>', ctx)).toBe('黑化倾向');
  });

  it('keepUnknown=true 保留未定义占位符；默认 stripLeftover 清未识别宏', () => {
    const ctx = makePromptExpandCtx({});
    expect(expandPromptText('保留${player_skills}和{{wordTarget}}', ctx, false, true)).toBe('保留${player_skills}和{{wordTarget}}');
    expect(expandPromptText('清掉{{不存在的宏}}后', ctx)).toBe('清掉后');
  });

  it('宏层也能读同一份 runtimeVars（{{getvar::主角.名}}）', () => {
    const ctx = makePromptExpandCtx({});
    expect(expandPromptText('主角是{{getvar::主角.名}}', ctx)).toBe('主角是苏晓');
  });

  it('无标记文本零开销原样返回', () => {
    const ctx = makePromptExpandCtx({});
    expect(expandPromptText('平常文本，没有任何标记', ctx)).toBe('平常文本，没有任何标记');
  });

  it('🧩 {{include::片段名}} 展开 + 嵌套 + 循环引用截断 + 未知名置空', () => {
    useSnippets.setState({ items: [
      { id: '1', name: '战斗风格', content: '狠辣凌厉，{{include::底色}}' },
      { id: '2', name: '底色', content: '带黑色幽默' },
      { id: '3', name: '循环A', content: '{{include::循环B}}' },
      { id: '4', name: '循环B', content: '{{include::循环A}}' },
    ] });
    const ctx = makePromptExpandCtx({ random: () => 0 });   // 快照在 setState 之后采集
    expect(expandPromptText('文风：{{include::战斗风格}}', ctx)).toBe('文风：狠辣凌厉，带黑色幽默');
    expect(expandPromptText('X{{include::循环A}}Y', ctx)).toBe('XY');
    expect(expandPromptText('未知{{include::没这个}}片段', ctx)).toBe('未知片段');
  });

  it('🧩 片段内容还能再走宏与 <if var>（展开顺序：include → 模板 → 宏）', () => {
    useSnippets.setState({ items: [{ id: '1', name: '状态注解', content: '<if var="主角.HP百分比 < 30">【{{user}}濒死】</if>' }] });
    const ctx = makePromptExpandCtx({ user: '苏晓', random: () => 0 });
    expect(expandPromptText('前文{{include::状态注解}}后文', ctx)).toBe('前文【苏晓濒死】后文');
  });
});
