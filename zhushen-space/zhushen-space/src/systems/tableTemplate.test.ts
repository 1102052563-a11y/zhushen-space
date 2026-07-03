import { describe, it, expect, beforeEach } from 'vitest';
import { resolveTableTemplates, evaluateSeed, evaluateCellExpr, evaluateCond } from './tableTemplate';
import { useTables } from '../store/tableStore';

const R = (t: string, seed = '') => resolveTableTemplates(t, { seedContent: seed, random: () => 0 });

beforeEach(() => {
  useTables.getState().resetAll();
  useTables.getState().updateRow('protagonist_info', 0, { 姓名: '苏晓', 力量: '100' });
  useTables.getState().insertRow('inventory', { 物品名称: '铁剑', 数量: '3' });
});

describe('evaluateSeed（,=或 &=与 !=非 ()分组）', () => {
  it('contains / 与 / 或 / 非', () => {
    expect(evaluateSeed('战斗', '一场激烈的战斗')).toBe(true);
    expect(evaluateSeed('战斗 & 受伤', '战斗中受伤了')).toBe(true);
    expect(evaluateSeed('战斗 & 治疗', '战斗中受伤了')).toBe(false);
    expect(evaluateSeed('逃跑, 战斗', '只有战斗')).toBe(true);
    expect(evaluateSeed('!和平', '战斗')).toBe(true);
  });
});

describe('evaluateCellExpr（表/行/列 op 值·读 tableStore）', () => {
  it('数值比较', () => {
    expect(evaluateCellExpr('背包物品表/铁剑/数量 > 2')).toBe(true);
    expect(evaluateCellExpr('背包物品表/铁剑/数量 > 5')).toBe(false);
    expect(evaluateCellExpr('主角信息表/苏晓/力量 == 100')).toBe(true);
  });
});

describe('<if …> 条件模板', () => {
  it('cell 真/假分支 + else', () => {
    expect(R('<if cell="背包物品表/铁剑/数量 > 2">多<else>少</if>')).toBe('多');
    expect(R('<if cell="背包物品表/铁剑/数量 > 5">多<else>少</if>')).toBe('少');
  });
  it('seed 分支', () => {
    expect(R('<if seed="战斗">打！<else>安宁</if>', '爆发了战斗')).toBe('打！');
    expect(R('<if seed="战斗">打！<else>安宁</if>', '风平浪静')).toBe('安宁');
  });
  it('嵌套 if', () => {
    const t = '<if seed="战斗"><if cell="背包物品表/铁剑/数量 > 2">持剑而战</if></if>';
    expect(R(t, '战斗开始')).toBe('持剑而战');
  });
  it('db/sql 属 SQL 专属·镜像未就绪 → 判否（隐藏，走 else）', () => {
    expect(R('<if db="db.x.count()>0">A<else>B</if>')).toBe('B');
    expect(R('<if sql="SELECT 1">A<else>B</if>')).toBe('B');
  });
});

describe('<if cond="…"> 复合条件（cell:/seed:/random: + &,|!()）', () => {
  it('单原子·无前缀默认 cell / 带 cell: 前缀', () => {
    expect(R('<if cond="背包物品表/铁剑/数量 > 2">有<else>无</if>')).toBe('有');
    expect(R('<if cond="cell:背包物品表/铁剑/数量 > 2">有<else>无</if>')).toBe('有');
  });
  it('& 与', () => {
    expect(R('<if cond="cell:背包物品表/铁剑/数量 > 2 & seed:战斗">持剑而战<else>否</if>', '战斗开始')).toBe('持剑而战');
    expect(R('<if cond="cell:背包物品表/铁剑/数量 > 5 & seed:战斗">持剑而战<else>否</if>', '战斗开始')).toBe('否');
  });
  it(', 或 | 或', () => {
    expect(R('<if cond="cell:背包物品表/铁剑/数量 > 5, seed:战斗">A<else>B</if>', '战斗')).toBe('A');
    expect(R('<if cond="cell:背包物品表/铁剑/数量 > 5 | seed:和平">A<else>B</if>', '战斗')).toBe('B');
  });
  it('! 非', () => {
    expect(R('<if cond="!seed:和平">A<else>B</if>', '战斗')).toBe('A');
  });
  it('() 分组：(真&假)假 或 seed真 → 真', () => {
    expect(R('<if cond="(cell:背包物品表/铁剑/数量 > 5 & seed:x), seed:战斗">A<else>B</if>', '战斗')).toBe('A');
  });
  it('random: 概率（测试注入 rng=()=>0 → 恒 < 阈值）', () => {
    expect(R('<if cond="random:50">A<else>B</if>')).toBe('A');   // 0*100=0 < 50 → 真
    expect(R('<if cond="random:0">A<else>B</if>')).toBe('B');    // 0 < 0 → 假
  });
  it('evaluateCond 直调·空表达式判否', () => {
    expect(evaluateCond('', {})).toBe(false);
    expect(evaluateCond('seed:战斗', { seedContent: '爆发战斗' })).toBe(true);
  });
});

describe('计算标签 + $ref', () => {
  it('<random id> + $random:', () => {
    // rng=()=>0 → min..max 取 min
    expect(R('<random id="d" min="3" max="8" />掷出 $random:d')).toBe('掷出 3');
  });
  it('<random> 无 id 内联', () => {
    expect(R('结果 <random min="7" max="7" />')).toBe('结果 7');
  });
  it('<calc> 四则 + $ref', () => {
    expect(R('<random id="a" min="10" max="10" /><calc id="b" expr="$random:a * 2 + 1" />答案 $calc:b')).toBe('答案 21');
  });
  it('<calc> 引用 cell:', () => {
    expect(R('<calc id="s" expr="cell:主角信息表/苏晓/力量 + 5" />力量+5=$calc:s')).toBe('力量+5=105');
  });
  it('<max>/<min>', () => {
    expect(R('<max id="m" values="3, 9, 5" />最大 $max:m')).toBe('最大 9');
    expect(R('<min id="n" values="3, 9, 5" />最小 $min:n')).toBe('最小 3');
  });
});

describe('快速返回', () => {
  it('无标记原样返回', () => {
    expect(R('这是一段普通预设文本，没有任何表格模板。')).toBe('这是一段普通预设文本，没有任何表格模板。');
  });
});
