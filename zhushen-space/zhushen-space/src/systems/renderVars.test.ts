import { describe, it, expect, beforeEach } from 'vitest';
import { renderPhaseExpand } from './renderVars';
import { useSettings } from '../store/settingsStore';
import { useGame } from '../store/gameStore';
import { useVariables } from '../store/variableStore';

/* 🧩 渲染期变量：显示层替换·默认关·楼层播种确定性。 */
describe('renderVars · 渲染期变量', () => {
  beforeEach(() => {
    useSettings.setState({ renderVars: true });
    useVariables.setState({ variables: [] });
    useGame.setState((s) => ({ player: { ...s.player, hp: 42, maxHp: 100 } }));
  });

  it('开关关 = 原样返回（同一引用·零开销）', () => {
    useSettings.setState({ renderVars: false });
    const t = 'HP：{{getvar::主角.HP}}';
    expect(renderPhaseExpand(1, t)).toBe(t);
  });

  it('getvar / <if var> 就地替换；未知 ${} 占位原样保留', () => {
    expect(renderPhaseExpand(1, 'HP：{{getvar::主角.HP}}')).toBe('HP：42');
    expect(renderPhaseExpand(1, '<if var="主角.HP百分比 < 50">告急<else>稳</if>')).toBe('告急');
    expect(renderPhaseExpand(1, '模板${notdefined}保留')).toBe('模板${notdefined}保留');
  });

  it('随机宏按楼层播种：同楼多次渲染恒定不闪变', () => {
    const t = '天气{{random::晴::雨::雪}}';
    const a = renderPhaseExpand(7, t);
    expect(renderPhaseExpand(7, t)).toBe(a);
    expect(renderPhaseExpand(7, t)).toBe(a);
    expect(['天气晴', '天气雨', '天气雪']).toContain(a);
  });

  it('无标记文本零开销原样', () => {
    expect(renderPhaseExpand(1, '普通正文一段。')).toBe('普通正文一段。');
  });
});
