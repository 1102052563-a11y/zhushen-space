import { describe, it, expect } from 'vitest';
import { lintPromptTemplate, lintCondExpr } from './promptLint';

/* 🩺 模板语法体检：只提示不阻断。 */
describe('promptLint · 模板语法体检', () => {
  const known = { vars: new Set(['主角.HP', '好感度']), snippets: new Set(['战斗风格']) };

  it('未知 if 类型 = error', () => {
    const r = lintPromptTemplate('<if foo="x > 1">A</if>', known);
    expect(r.some((i) => i.level === 'error' && i.msg.includes('未知条件类型'))).toBe(true);
  });

  it('<if>/</if> 不配平 = error', () => {
    const r = lintPromptTemplate('<if var="好感度 > 1">A', known);
    expect(r.some((i) => i.msg.includes('不配平'))).toBe(true);
  });

  it('var 表达式缺运算符 = error；未定义变量 = warn', () => {
    expect(lintPromptTemplate('<if var="好感度">A</if>', known).some((i) => i.level === 'error' && i.msg.includes('缺比较运算符'))).toBe(true);
    expect(lintPromptTemplate('<if var="不存在 > 1">A</if>', known).some((i) => i.level === 'warn' && i.msg.includes('不存在'))).toBe(true);
  });

  it('include/getvar 未知性 warn；已知不报', () => {
    expect(lintPromptTemplate('{{include::没有的}}', known).some((i) => i.msg.includes('片段'))).toBe(true);
    expect(lintPromptTemplate('{{include::战斗风格}}', known).length).toBe(0);
    expect(lintPromptTemplate('{{getvar::未知变量}}', known).some((i) => i.msg.includes('无此变量'))).toBe(true);
    expect(lintPromptTemplate('{{getvar::主角.HP}}', known).length).toBe(0);
  });

  it('花括号不配平 warn', () => {
    expect(lintPromptTemplate('{{getvar::主角.HP}} 和 {{漏了尾巴', known).some((i) => i.msg.includes('不配平'))).toBe(true);
  });

  it('合法文本零报告；known 不传则跳过对应检查', () => {
    expect(lintPromptTemplate('<if var="好感度 >= 50">亲昵<else>疏离</if>，{{getvar::主角.HP}}', known).length).toBe(0);
    expect(lintPromptTemplate('{{getvar::随便什么}}{{include::随便}}').length).toBe(0);
  });

  it('lintCondExpr：未知前缀 error / var 缺 op error / 未定义 warn / 合法与空 = 零', () => {
    expect(lintCondExpr('', known.vars).length).toBe(0);
    expect(lintCondExpr('foo:xx', known.vars).some((i) => i.level === 'error')).toBe(true);
    expect(lintCondExpr('var:好感度', known.vars).some((i) => i.msg.includes('缺比较运算符'))).toBe(true);
    expect(lintCondExpr('var:不存在 > 1', known.vars).some((i) => i.level === 'warn')).toBe(true);
    expect(lintCondExpr('var:好感度 >= 50 & seed:战斗', known.vars).length).toBe(0);
    expect(lintCondExpr('!var:好感度 >= 50 , random:30', known.vars).length).toBe(0);
  });
});
