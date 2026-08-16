import { describe, it, expect } from 'vitest';
import { buildEavesdropSys, rollDiscovered, eavesdropNotice, EAVESDROP_DISCOVER } from './eavesdrop';

const A = { id: 'a', name: '林岚', npcTag: '随从', realm: '二阶·Lv.20', personality: '嘴硬心软', favor: 40, status: '在西区休整' } as any;
const B = { id: 'b', name: '阿玖', npcTag: '契约者', realm: '三阶·Lv.5', personality: '油滑', favor: -10 } as any;

describe('buildEavesdropSys', () => {
  it('含双方档案+各自认知边界+行协议', () => {
    const s = buildEavesdropSys(A, B, ['坊市大火（三日前）'], [], '云来城', '第7日');
    expect(s).toContain('林岚');
    expect(s).toContain('阿玖');
    expect(s).toContain('坊市大火');
    expect(s).toContain('认知边界');
    expect(s).toContain('林岚|台词');
    expect(s).toContain('禁止出现主角发言');
  });
});

describe('rollDiscovered', () => {
  it('注入 rng 确定性判定', () => {
    expect(rollDiscovered(() => EAVESDROP_DISCOVER - 0.01)).toBe(true);
    expect(rollDiscovered(() => EAVESDROV_SAFE())).toBe(false);
  });
});
function EAVESDROV_SAFE() { return EAVESDROP_DISCOVER + 0.01; }

describe('eavesdropNotice', () => {
  it('被察觉时带后果条款', () => {
    expect(eavesdropNotice('林岚', '阿玖', '两人在抱怨物价', false)).not.toContain('察觉');
    expect(eavesdropNotice('林岚', '阿玖', '两人在抱怨物价', true)).toContain('察觉');
  });
});
