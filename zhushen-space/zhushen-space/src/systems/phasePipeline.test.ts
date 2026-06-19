import { describe, it, expect } from 'vitest';
import { runPhasePipeline, type Phase } from './phasePipeline';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('runPhasePipeline（演化阶段声明式调度）', () => {
  it('deps：依赖阶段 settle 后才跑', async () => {
    const order: string[] = [];
    const phases: Phase[] = [
      { key: 'a', enabled: true, run: async () => { await tick(); order.push('a'); } },
      { key: 'b', enabled: true, run: async () => { await tick(); order.push('b'); } },
      { key: 'audit', enabled: true, deps: ['a', 'b'], run: () => { order.push('audit'); } },
    ];
    await runPhasePipeline(phases).allDone;
    expect(order.indexOf('audit')).toBeGreaterThan(order.indexOf('a'));
    expect(order.indexOf('audit')).toBeGreaterThan(order.indexOf('b'));
  });

  it('enabled=false：跳过 run，但依赖它的阶段照常跑', async () => {
    const ran: string[] = [];
    await runPhasePipeline([
      { key: 'a', enabled: false, run: () => { ran.push('a'); } },
      { key: 'b', enabled: true, deps: ['a'], run: () => { ran.push('b'); } },
    ]).allDone;
    expect(ran).toEqual(['b']);   // a 跳过，b 仍跑
  });

  it('onDone 在 run 成功后触发', async () => {
    const seq: string[] = [];
    await runPhasePipeline([
      { key: 'x', enabled: true, run: () => { seq.push('run'); }, onDone: () => { seq.push('done'); } },
    ]).allDone;
    expect(seq).toEqual(['run', 'done']);
  });

  it('snapshotReady 只等 awaitForSnapshot 的阶段', async () => {
    let slow = false;
    const h = runPhasePipeline([
      { key: 'fast', enabled: true, awaitForSnapshot: true, run: () => { /* 即时 */ } },
      { key: 'slow', enabled: true, run: async () => { await tick(40); slow = true; } },
    ]);
    await h.snapshotReady;
    expect(slow).toBe(false);   // 快照不等 slow
    await h.allDone;
    expect(slow).toBe(true);
  });

  it('某阶段抛错不影响其它，allDone 仍 resolve', async () => {
    const ran: string[] = [];
    await runPhasePipeline([
      { key: 'boom', enabled: true, run: () => { throw new Error('x'); } },
      { key: 'ok', enabled: true, run: () => { ran.push('ok'); } },
    ]).allDone;
    expect(ran).toEqual(['ok']);
  });

  it('delayMs：延后启动', async () => {
    let ran = false;
    const h = runPhasePipeline([
      { key: 'd', enabled: true, delayMs: 30, run: () => { ran = true; } },
    ]);
    await tick(5);
    expect(ran).toBe(false);   // 还没到点
    await h.allDone;
    expect(ran).toBe(true);
  });
});
