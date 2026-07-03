import { describe, it, expect } from 'vitest';
import { reconcileSettlementCurrency } from './stateApply';
import type { StateUpdate } from './stateParser';

const u = (key: string, value: number, op: StateUpdate['op'] = '+='): StateUpdate => ({ key, op, value, raw: `${key} ${op} ${value}` });
const cur = (us: StateUpdate[]) => us.filter((x) => x.key === '乐园币' || x.key === '灵魂钱币');

// 结算·货币忠于【最终清算】面板：治"面板写获得货币7000、<state> 却 乐园币 += 4000、侧栏只加4000·对不上"。
describe('reconcileSettlementCurrency（结算货币忠于正文面板）', () => {
  it('★面板"获得货币 7000"覆盖 <state> 的 乐园币 += 4000（对齐正文）', () => {
    const raw = '<世界结算>…【最终清算】\n* **获得货币**：**7000** 乐园币（已存入储蓄空间，现余额：11585）\n</世界结算>';
    const out = reconcileSettlementCurrency(raw, [u('乐园币', 4000), u('character.B1.attrPoints', 8)]);
    expect(cur(out)[0].value).toBe(7000);   // 被校正
    expect(out.find((x) => x.key === 'character.B1.attrPoints')?.value).toBe(8);   // 其它不动
  });

  it('面板与指令一致 → 不改', () => {
    const raw = '<世界结算>获得货币：7000 乐园币</世界结算>';
    const out = reconcileSettlementCurrency(raw, [u('乐园币', 7000)]);
    expect(cur(out)[0].value).toBe(7000);
  });

  it('★灵魂钱币同理（六阶+）', () => {
    const raw = '<世界结算>**获得货币**：**12** 灵魂钱币（现余额：60）</世界结算>';
    const out = reconcileSettlementCurrency(raw, [u('灵魂钱币', 8)]);
    expect(cur(out)[0].value).toBe(12);
  });

  it('★同类货币多条 += → 折成一条防双入账（值取面板）', () => {
    const raw = '<世界结算>获得货币：7000 乐园币</世界结算>';
    const out = reconcileSettlementCurrency(raw, [u('乐园币', 7000), u('乐园币', 7000)]);
    expect(cur(out).length).toBe(1);
    expect(cur(out)[0].value).toBe(7000);
  });

  it('★把灵魂钱币奖励写成了乐园币 → 纠正币种（治"灵魂钱币当乐园币发"）', () => {
    // 用户实测：面板「获得货币: 150,000 灵魂钱币」，四阶按默认规则却发了 乐园币 += 150000 → 钱进了乐园币
    const raw = '<世界结算>**获得货币**：**150,000 灵魂钱币**（已存入储蓄空间）</世界结算>';
    const out = reconcileSettlementCurrency(raw, [u('乐园币', 150000)]);
    expect(cur(out).length).toBe(1);
    expect(cur(out)[0].key).toBe('灵魂钱币');      // 收敛成面板币种
    expect(cur(out)[0].value).toBe(150000);
    expect(out.some((x) => x.key === '乐园币')).toBe(false);   // 乐园币不再入账
  });

  it('★两种币各发一次（灵魂钱币面板·乐园币+灵魂钱币都发）→ 只留面板币种一条', () => {
    const raw = '<世界结算>**获得货币**：**150000 灵魂钱币**</世界结算>';
    const out = reconcileSettlementCurrency(raw, [u('乐园币', 150000), u('灵魂钱币', 150000)]);
    expect(cur(out).length).toBe(1);
    expect(cur(out)[0].key).toBe('灵魂钱币');
    expect(cur(out)[0].value).toBe(150000);
  });

  it('数字带千分位逗号 7,000 → 正确解析', () => {
    const raw = '<世界结算>获得货币：**7,000** 乐园币</世界结算>';
    const out = reconcileSettlementCurrency(raw, [u('乐园币', 4000)]);
    expect(cur(out)[0].value).toBe(7000);
  });

  it('currency.乐园币 前缀写法也校正', () => {
    const raw = '<世界结算>获得货币：7000 乐园币</世界结算>';
    const out = reconcileSettlementCurrency(raw, [u('currency.乐园币', 4000)]);
    expect(out[0].value).toBe(7000);
  });

  it('raw 无"获得货币" → 原样返回', () => {
    const out = reconcileSettlementCurrency('<世界结算>无货币</世界结算>', [u('乐园币', 4000)]);
    expect(cur(out)[0].value).toBe(4000);
  });

  it('= 绝对赋值不动（只管 += 入账）', () => {
    const raw = '<世界结算>获得货币：7000 乐园币</世界结算>';
    const out = reconcileSettlementCurrency(raw, [u('乐园币', 4000, '=')]);
    expect(out[0].value).toBe(4000);   // op 非 += 不碰
  });
});
