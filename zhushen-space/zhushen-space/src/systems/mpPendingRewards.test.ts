import { describe, it, expect, beforeEach } from 'vitest';
import { useMp } from '../store/multiplayerStore';
import { useItems } from '../store/itemStore';
import { useCharacters } from '../store/characterStore';
import {
  recordMpReward, clearMpPending, promoteMpPending, discardMpReplay, replayMpPendingOnBoot, mpIsGuest,
} from './mpPendingRewards';

/* 联机来宾·奖励防回滚：进房 saveSlot 备份 → 离房 loadSlot 整档还原+reload，期间入账全部蒸发。
   流水记在 saveManager.STORES 注册表之外的 localStorage 键（loadSlot 不还原也不清），开机重放。 */

const PENDING_KEY = 'drpg-mp-pending';
const REPLAY_KEY = 'drpg-mp-replay';

function asGuest() { useMp.setState({ status: 'connected', role: 'guest' } as never); }
function asHost() { useMp.setState({ status: 'connected', role: 'host' } as never); }
function offline() { useMp.setState({ status: 'idle', role: null } as never); }

beforeEach(() => {
  localStorage.removeItem(PENDING_KEY);
  localStorage.removeItem(REPLAY_KEY);
  offline();
});

describe('mpPendingRewards（来宾奖励防回滚流水）', () => {
  it('来宾判定：connected+非host 才算', () => {
    expect(mpIsGuest()).toBe(false);
    asHost(); expect(mpIsGuest()).toBe(false);
    asGuest(); expect(mpIsGuest()).toBe(true);
  });

  it('★只有来宾记流水；房主/单机调用=静默忽略', () => {
    asHost();
    recordMpReward({ id: 'r1', note: '测试', currency: { 乐园币: 100 } });
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    asGuest();
    recordMpReward({ id: 'r1', note: '测试', currency: { 乐园币: 100 } });
    expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toHaveLength(1);
  });

  it('同 id 只记一次（relay 回显防双记）', () => {
    asGuest();
    recordMpReward({ id: 'r1', note: '测试', currency: { 乐园币: 100 } });
    recordMpReward({ id: 'r1', note: '测试', currency: { 乐园币: 100 } });
    expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toHaveLength(1);
  });

  it('★促账后开机补发：货币/物品/称号真正入账，流水清空', () => {
    asGuest();
    const before = useItems.getState().currency['乐园币'];
    recordMpReward({
      id: 'raid_x', note: '副本通关豪华奖励',
      currency: { 乐园币: 5000 }, items: [{ name: '测试补发·龙王核心', category: '材料', quantity: 1 }],
      title: { name: '测试补发称号', level: '紫色', source: '单测', effect: '无', desc: '测试' },
    });
    promoteMpPending();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();       // pending 已促走
    const n = replayMpPendingOnBoot();
    expect(n).toBe(1);
    expect(useItems.getState().currency['乐园币'] - before).toBe(5000);
    expect(useItems.getState().items.some((i) => i.name === '测试补发·龙王核心')).toBe(true);
    expect((useCharacters.getState().characters['B1']?.titles ?? []).some((t) => t.name === '测试补发称号')).toBe(true);
    expect(localStorage.getItem(REPLAY_KEY)).toBeNull();        // 补发后清空
    expect(replayMpPendingOnBoot()).toBe(0);                    // 幂等：再跑无事发生
  });

  it('★还原没发生（无备份）→ discardMpReplay 丢弃，开机不双发', () => {
    asGuest();
    recordMpReward({ id: 'r2', note: '测试', currency: { 乐园币: 100 } });
    promoteMpPending();
    discardMpReplay();
    expect(replayMpPendingOnBoot()).toBe(0);
  });

  it('来宾中途刷新（流水停在 pending）→ 开机只放 replay，不双发；下次进房 clearMpPending 归零', () => {
    asGuest();
    recordMpReward({ id: 'r3', note: '测试', currency: { 乐园币: 100 } });
    expect(replayMpPendingOnBoot()).toBe(0);                    // pending 不在补发范围
    clearMpPending();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });
});
