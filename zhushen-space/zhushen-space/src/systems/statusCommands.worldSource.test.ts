import { describe, it, expect, beforeEach } from 'vitest';
import { applyPlayerProfileCommands } from './statusCommands';
import { usePlayer } from '../store/playerStore';
import { useMisc } from '../store/miscStore';

// 世界之源"对不上"根治：主角演化阶段读隐藏块拿绝对总量落库，但主叙事(另一次 AI 调用)可见的"当前总计"
// 可能与块值分叉——本阶段能拿到主叙事 narrative，故非归零回合以玩家可见的总量为准覆盖块值；
// 人在乐园则恒归零（每个任务世界独立累计，不跨世界带入）。
const setWS = (v: number) => usePlayer.setState((s) => ({ profile: { ...s.profile, worldSource: v } }));
const ws = () => usePlayer.getState().profile.worldSource;
const inTaskWorld = () => useMisc.setState({ worldName: '哥布林巢穴' } as any);   // 非乐园=任务世界内

describe('世界之源·忠于正文可见总量（治"正文总计6.3%、侧栏却显示4"）', () => {
  beforeEach(() => { inTaskWorld(); setWS(2.8); });

  it('★正文可见「当前总计 6.3%」覆盖隐藏块指令 =4（侧栏与正文对齐）', () => {
    applyPlayerProfileCommands('character.B1.worldSource = 4', '主角斩杀首领。获得: 世界之源 3.5%（当前总计: 6.3%）', 1);
    expect(ws()).toBe(6.3);
  });

  it('无可见总量 → 用指令绝对块值 =4', () => {
    applyPlayerProfileCommands('character.B1.worldSource = 4', '普通正文，本回合无世界之源变化', 1);
    expect(ws()).toBe(4);
  });

  it('★单回合明细"获得 世界之源 3.5%"(无总计关键词)不被当成总量 → 走指令 += 3.5', () => {
    applyPlayerProfileCommands('character.B1.worldSource += 3.5', '主角击杀，获得: 世界之源 3.5%', 1);
    expect(ws()).toBe(6.3);   // 2.8 + 3.5（指令累加），而非把 3.5 当总量
  });

  it('主叙事缺省(narrative="")时不触发可见覆盖，纯走块指令', () => {
    setWS(1.0);
    applyPlayerProfileCommands('character.B1.worldSource = 5', '', 1);
    expect(ws()).toBe(5);
  });

  it('可见总量取靠近"世界之源"的"总计"值、不误取前面的单回合增量', () => {
    setWS(0);
    applyPlayerProfileCommands('character.B1.worldSource = 2', '世界之源 3.5%（当前总计: 6.3%）', 1);
    expect(ws()).toBe(6.3);   // 取 6.3 非 3.5
  });
});

describe('世界之源·每个任务世界结束后归零（人在乐园恒 0·不靠 AI 记得发 =0）', () => {
  beforeEach(() => setWS(6.3));

  it('★人在轮回乐园：即便正文回顾"世界之源总计6.3%"也强制归零', () => {
    useMisc.setState({ worldName: '轮回乐园' } as any);
    applyPlayerProfileCommands('', '本世界世界之源总计 6.3%，结算完毕，返回轮回乐园', 1);
    expect(ws()).toBe(0);
  });

  it('★人在乐园(专属房间)：显式指令想设 8% 也被归零覆盖', () => {
    useMisc.setState({ worldName: '专属房间' } as any);
    applyPlayerProfileCommands('character.B1.worldSource = 8', '……', 1);
    expect(ws()).toBe(0);
  });

  it('在任务世界内不误归零（世界之源正常累计中）', () => {
    useMisc.setState({ worldName: '魔王城' } as any);
    applyPlayerProfileCommands('character.B1.worldSource = 8', '当前世界之源总计 8%', 1);
    expect(ws()).toBe(8);
  });
});
