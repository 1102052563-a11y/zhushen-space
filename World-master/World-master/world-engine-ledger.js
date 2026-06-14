// world-engine-ledger.js — 重大事件账本（纯本地，替代旧记忆模块）
window.WORLD_ENGINE_LEDGER = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const MAX_LEDGER_ROUNDS = 20;

  const EVENT_TYPE_NAMES = { conflict: '冲突型', progress: '推进型' };
  const TERMINAL_STAGES = new Set(['已完成', '已失败', '已消散', '已爆发']);

  /**
   * 对比存档点（推演前）与当前状态（推演后），记录 Lv3/4 变化。
   * 所有变化合并为一条，按轮次分组。
   */
  function recordChanges(state) {
    const removedTerminalEvents = state._terminalEventsThisRound || [];
    delete state._terminalEventsThisRound;

    const cp = core.restoreCheckpoint();
    if (!cp) {
      core.saveState(state);
      return;
    }

    const changes = [];

    // —— 事件链：普通变化记录 Lv3/4，任何等级的终局都记录 ——
    const cpEventMap = new Map((cp.events || []).map(e => [e.name, e]));
    const currentEvents = state.events || [];
    for (const ev of [...currentEvents, ...removedTerminalEvents]) {
      const isTerminal = TERMINAL_STAGES.has(ev.stage);
      if ((!ev.level || ev.level < 3) && !isTerminal) continue;
      const cpEv = cpEventMap.get(ev.name);
      if (!cpEv) {
        changes.push({
          type: isTerminal ? 'event_terminal' : 'event_new',
          name: ev.name,
          eventType: ev.type || 'conflict',
          level: ev.level,
          stage: ev.stage || '?',
          desc: ev.desc || ''
        });
      } else if (cpEv.stage !== ev.stage) {
        changes.push({
          type: isTerminal ? 'event_terminal' : 'event_advance',
          name: ev.name,
          level: ev.level,
          fromStage: cpEv.stage || '?',
          toStage: ev.stage || '?',
          stage: ev.stage || '?',
          desc: ev.desc || ''
        });
      }
    }
    // —— 风声：新增 Lv3/4 ——
    const cpWindTopics = new Set((cp.winds || []).map(w => w.topic));
    for (const wind of (state.winds || [])) {
      if (!wind.level || wind.level < 3) continue;
      if (!cpWindTopics.has(wind.topic)) {
        changes.push({
          type: 'wind_new',
          topic: wind.topic,
          level: wind.level,
          content: wind.content || ''
        });
      }
    }

    if (changes.length === 0) {
      core.saveState(state);
      return;
    }

    // 清理旧格式记忆，移除同轮已有记录（处理重roll覆盖）
    state.memories = (state.memories || []).filter(m => {
      if (m.type !== 'ledger') return false;
      if (m.round === state.round) return false;
      return true;
    });

    state.memories.unshift({
      id: `ledger_${state.round}`,
      type: 'ledger',
      round: state.round,
      changes: changes
    });

    if (state.memories.length > MAX_LEDGER_ROUNDS) {
      state.memories.length = MAX_LEDGER_ROUNDS;
    }

    core.saveState(state);
    console.log(`[世界引擎] 账本: 第${state.round}轮记录${changes.length}条变化`);
  }

  /** 构建注入用的账本文本 */
  function buildLedgerText(state) {
    const entries = (state.memories || []).filter(m => m.type === 'ledger').reverse();
    if (!entries.length) return '暂无重大事件记录';

    return entries.map(entry => {
      const lines = [`第${entry.round}轮（${entry.changes.length}条变化）：`];
      for (const c of entry.changes) {
        if (c.type === 'event_new') {
          const tn = EVENT_TYPE_NAMES[c.eventType] || c.eventType;
          lines.push(`  [新增Lv${c.level}${tn}事件链] ${c.name} - ${c.stage} - ${c.desc}`);
        } else if (c.type === 'event_advance') {
          lines.push(`  [事件链推进] ${c.name}(Lv${c.level}) ${c.fromStage}->${c.toStage} - ${c.desc}`);
        } else if (c.type === 'event_terminal') {
          lines.push(`  [事件链终局] ${c.name}(Lv${c.level}) ${c.fromStage ? c.fromStage + '->' : ''}${c.stage || c.toStage} - ${c.desc}`);
        } else if (c.type === 'wind_new') {
          lines.push(`  [新增Lv${c.level}风声] ${c.topic} - ${c.content}`);
        }
      }
      return lines.join('\n');
    }).join('\n\n');
  }

  return { recordChanges, buildLedgerText };
})();
