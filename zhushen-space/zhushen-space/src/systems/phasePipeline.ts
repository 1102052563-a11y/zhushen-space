// ─────────────────────────────────────────────────────────────────────────────
// 演化阶段·声明式调度器
//
// 背景：回合后的各「演化阶段」(物品/主角/NPC/势力/领地/万族/杂项/记忆/生图…)原本是
//   手写并发 + 散在 App.runPostNarrativePhases 里(谁等谁、谁进快照全靠人肉编排)。
//   这里抽成「一张阶段表 Phase[] + 一个调度器」：加阶段/调顺序/开关 gate/依赖都只改数据。
//
// 语义（与原手写编排一致）：
//   - enabled=false 的阶段：跳过 run，但其 promise 仍 resolve，好让依赖它的阶段照常继续。
//   - deps：列出的阶段(无论启用与否)都 settle 后，本阶段才开始（如 mergedAudit 依赖 item+player）。
//   - onDone：run 成功后的钩子（如战斗回合跑完某阶段要把 HP 压回战斗结算值）。
//   - awaitForSnapshot：纳入「抓回合洞察快照前要等」的集合（只等会改快照变量的阶段）。
//   - delayMs：延后启动（生图阶段要等演化先写档）。
//   假定阶段图无环（实际只有 mergedAudit 一条依赖边）；遇环则忽略成环的那条依赖边以防死循环。
// ─────────────────────────────────────────────────────────────────────────────

export interface Phase {
  key: string;
  enabled: boolean;
  deps?: string[];
  run: () => void | Promise<void>;
  onDone?: () => void | Promise<void>;
  awaitForSnapshot?: boolean;
  delayMs?: number;
}

export interface PipelineHandle {
  /** awaitForSnapshot 的阶段全部 settle —— 调用方据此在抓快照前等待 */
  snapshotReady: Promise<void>;
  /** 全部阶段（含 delay）settle */
  allDone: Promise<void>;
}

export function runPhasePipeline(phases: Phase[]): PipelineHandle {
  const byKey = new Map(phases.map((p) => [p.key, p]));
  const started = new Map<string, Promise<void>>();

  const start = (p: Phase, stack: Set<string>): Promise<void> => {
    const cached = started.get(p.key);
    if (cached) return cached;
    if (stack.has(p.key)) return Promise.resolve();   // 成环：忽略该依赖边，避免死循环
    const here = new Set(stack).add(p.key);
    const depPromises = (p.deps ?? []).map((k) => {
      const d = byKey.get(k);
      return d ? start(d, here) : Promise.resolve();
    });
    const body = Promise.allSettled(depPromises).then(async () => {
      if (!p.enabled) return;
      if (p.delayMs && p.delayMs > 0) await new Promise((r) => setTimeout(r, p.delayMs));
      await p.run();
      if (p.onDone) await p.onDone();
    });
    started.set(p.key, body);
    return body;
  };

  const all = phases.map((p) => start(p, new Set()));
  const snapWaiters = phases.filter((p) => p.awaitForSnapshot).map((p) => started.get(p.key)!);
  return {
    snapshotReady: Promise.allSettled(snapWaiters).then(() => undefined),
    allDone: Promise.allSettled(all).then(() => undefined),
  };
}
