import { describe, it, expect } from 'vitest';
import { processMacros, makeMacroCtx } from './stMacros';

const ctx = () => makeMacroCtx({ user: '张三', char: '李四', lastUserMessage: '我推门进去', random: () => 0 });

describe('stMacros', () => {
  it('无宏文本原样返回', () => {
    expect(processMacros('这是一段普通正文，没有宏。', ctx())).toBe('这是一段普通正文，没有宏。');
  });
  it('{{user}}/{{char}} 替换', () => {
    expect(processMacros('{{user}} 对 {{char}} 说话', ctx())).toBe('张三 对 李四 说话');
  });
  it('<user> 标签替换', () => {
    expect(processMacros('主角是<user>。', ctx())).toBe('主角是张三。');
  });
  it('{{lastUserMessage}} 替换', () => {
    expect(processMacros('上一条：{{lastUserMessage}}', ctx())).toBe('上一条：我推门进去');
  });
  it('setvar 求值后产出空、getvar 取回（跨调用共享同一 ctx）', () => {
    const c = ctx();
    expect(processMacros('{{setvar::风格::冷硬}}', c)).toBe('');         // setvar 本身产出空
    expect(processMacros('文风：{{getvar::风格}}', c)).toBe('文风：冷硬'); // 后续 getvar 取回
  });
  it('${var} 取变量', () => {
    const c = makeMacroCtx({ runtimeVars: { 心情: '愉悦' }, random: () => 0 });
    expect(processMacros('当前心情 ${心情}', c)).toBe('当前心情 愉悦');
  });
  it('addvar 累加', () => {
    const c = ctx();
    processMacros('{{addvar::log::A}}', c);
    processMacros('{{addvar::log::B}}', c);
    expect(processMacros('{{getvar::log}}', c)).toBe('AB');
  });
  it('{{//注释}} 被清除', () => {
    expect(processMacros('前{{// 这是注释 }}后', ctx())).toBe('前后');
  });
  it('{{trim}} 清除、{{newline}} 换行', () => {
    expect(processMacros('a{{trim}}b{{newline}}c', ctx())).toBe('ab\nc');
  });
  it('{{random::a::b::c}} 用种子 0 取第一个', () => {
    expect(processMacros('{{random::甲::乙::丙}}', ctx())).toBe('甲');
  });
  it('{{roll 2d6}} 用种子 0 = 2（每颗 floor(0*6)+1=1）', () => {
    expect(processMacros('掷出 {{roll 2d6}}', ctx())).toBe('掷出 2');
  });
  it('未识别的残留宏被清掉防泄漏（默认 stripLeftover=true）', () => {
    expect(processMacros('正文{{unknownMacro}}{{idle_duration}}收尾', ctx())).toBe('正文收尾');
  });
  it('stripLeftover=false（全局场景）保留未识别 {{ }}，不误删代码提示词的合法双花括号', () => {
    expect(processMacros('你好{{user}}，保留{{unknownMacro}}', ctx(), false)).toBe('你好张三，保留{{unknownMacro}}');
  });
});
