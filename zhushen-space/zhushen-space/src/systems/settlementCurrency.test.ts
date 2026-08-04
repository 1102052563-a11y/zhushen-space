import { describe, it, expect } from 'vitest';
import { reconcileSettlementCurrency, scanCjkCurrencyUpdates } from './stateApply';
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
    expect(cur(out).length).toBe(1);   // 且不因"没有 += 幸存"而补发一条（尊重绝对赋值）
  });

  // ★兜底补入账：AI 只写了面板、<state> 里一条货币指令都没有（或全是解析不出的变体）→ 按面板补一条
  it('★面板有授予但 updates 里无货币指令 → 前端按面板补入账', () => {
    const raw = '<世界结算>【最终清算】\n获得货币：**7,000** 乐园币（已存入储蓄空间）</世界结算>';
    const out = reconcileSettlementCurrency(raw, [u('character.B1.attrPoints', 8)]);
    expect(cur(out).length).toBe(1);
    expect(cur(out)[0].key).toBe('乐园币');
    expect(cur(out)[0].value).toBe(7000);
    expect(cur(out)[0].op).toBe('+=');
  });

  it('面板有授予但同回合已有 <upstore> transferCurrency → 不补（防双发）', () => {
    const raw = '<世界结算>获得货币：7000 乐园币</世界结算>\n<upstore>transferCurrency({"to":"B1","amount":7000})</upstore>';
    const out = reconcileSettlementCurrency(raw, []);
    expect(cur(out).length).toBe(0);
  });

  it('面板有授予但同回合已有 createItem(乐园币) 折算入账 → 不补（防双发）', () => {
    const raw = '<世界结算>获得货币：7000 乐园币</世界结算>\n<upstore>createItem({"1":"乐园币","5":"7000"})</upstore>';
    const out = reconcileSettlementCurrency(raw, []);
    expect(cur(out).length).toBe(0);
  });
});

// ★中文币名 <state> 补扫：parseLine 的 key 正则是 ASCII \w，「乐园币 += 7000」历史上整行 parse 失败——
// 提示词教的主通道全空转。scanCjkCurrencyUpdates 只扫 <state> 块，合成 StateUpdate 走既有管线。
describe('scanCjkCurrencyUpdates（中文币名指令补扫）', () => {
  it('★<state> 里的 乐园币 += 7000 能被扫出', () => {
    const out = scanCjkCurrencyUpdates('<state>\n乐园币 += 7000\n</state>');
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({ key: '乐园币', op: '+=', value: 7000 });
  });

  it('currency. 前缀 / -= 支出 / 千分位逗号 都认', () => {
    const out = scanCjkCurrencyUpdates('<state>\ncurrency.灵魂钱币 -= 1,500\n</state>');
    expect(out[0]).toMatchObject({ key: '灵魂钱币', op: '-=', value: 1500 });
  });

  it('魂币 别名归一成 灵魂钱币', () => {
    const out = scanCjkCurrencyUpdates('<state>魂币 += 12</state>');
    expect(out[0].key).toBe('灵魂钱币');
  });

  it('行尾注释（# / 括号）不影响解析', () => {
    const out = scanCjkCurrencyUpdates('<state>\n乐园币 += 500 # 出售战利品\n</state>');
    expect(out[0]).toMatchObject({ key: '乐园币', value: 500 });
  });

  it('★同一条「统计+发放」写两遍 → 只算一次', () => {
    const out = scanCjkCurrencyUpdates('<state>\n乐园币 += 7000\n乐园币 += 7000\n</state>');
    expect(out.length).toBe(1);
  });

  it('不同金额两条是真两笔 → 都保留', () => {
    const out = scanCjkCurrencyUpdates('<state>\n乐园币 += 7000\n乐园币 -= 500\n</state>');
    expect(out.length).toBe(2);
  });

  it('★<state> 块外的正文散文不匹配', () => {
    const out = scanCjkCurrencyUpdates('正文里提到 乐园币 += 9999 也不该入账\n<state>hp.B1 -= 5</state>');
    expect(out.length).toBe(0);
  });

  it('无 <state> 块 → 空数组', () => {
    expect(scanCjkCurrencyUpdates('随便一段话 乐园币 += 100').length).toBe(0);
  });
});
