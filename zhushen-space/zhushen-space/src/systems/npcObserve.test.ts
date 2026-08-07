import { describe, it, expect } from 'vitest';
import { eventsKnownTo, buildObservePrompt, observeContaminated } from './npcObserve';
import type { WorldEvent } from '../store/miscStore';
import type { NpcRecord } from '../store/npcStore';

const same = (a?: string, b?: string) => (a ?? '') === (b ?? '');
const ev = (p: Partial<WorldEvent> = {}): WorldEvent => ({ id: 'W_1', time: '', location: '', desc: '公开事', ...p });

describe('npcObserve · 认知边界（P1 knownBy 的消费点）', () => {
  it('公开事件全给；hidden/trace 只有 knownBy 点名才给；已结算不给', () => {
    const events = [
      ev({ id: 'W_1', name: '秋收庆典' }),
      ev({ id: 'W_2', name: '密谋', visibility: 'hidden', desc: '幕后', knownBy: '白九' }),
      ev({ id: 'W_3', name: '暗查', visibility: 'trace', desc: '内查', knownBy: '林澈, 白九' }),
      ev({ id: 'W_4', name: '旧案', settledAt: 1 }),
    ];
    const forLin = eventsKnownTo(events, '林澈', '', same);
    expect(forLin.join('|')).toContain('秋收庆典');
    expect(forLin.join('|')).toContain('暗查');
    expect(forLin.join('|')).not.toContain('密谋');
    expect(forLin.join('|')).not.toContain('旧案');
    const forStranger = eventsKnownTo(events, '路人甲', '', same);
    expect(forStranger.join('|')).toContain('秋收庆典');
    expect(forStranger.join('|')).not.toContain('暗查');
  });
});

describe('npcObserve · 提示词与污染检测', () => {
  it('土著加"不知道轮回乐园"铁则；观测素材只含她知道的', () => {
    const npc = { id: 'C1', name: '林澈', gender: '女', realm: '', personality: '沉静', status: '在药铺帮工', npcTag: '土著', extra: {} } as unknown as NpcRecord;
    const s = buildObservePrompt(npc, { worldName: '大离王朝', worldTime: '3年5月', playerName: '主角', knownEvents: ['秋收庆典：进入第三日'] });
    expect(s).toContain('第一人称');
    expect(s).toContain('完全不知道');
    expect(s).toContain('秋收庆典');
    expect(s).toContain('名单之外的事她一无所知');
  });

  it('污染检测：混入协议/结构模块 → 拒收；正常片段放行；空串拒收', () => {
    expect(observeContaminated('我在檐下听雨，指尖还沾着药香。')).toBe(false);
    expect(observeContaminated('我在走路。<state>\nhp.B1 -= 5\n</state>')).toBe(true);
    expect(observeContaminated('【正文】她走在街上')).toBe(true);
    expect(observeContaminated('')).toBe(true);
  });
});
