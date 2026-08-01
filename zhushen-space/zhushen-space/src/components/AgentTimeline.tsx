/* Agent 正文模式 · 运行时间线（输入框上方窄条，仿 TauriTavern run timeline）
   - 开着 agent 模式才显示；运行中实时滚动事件，结束后保留最近一次可查
   - 折叠态一行摘要；展开列表（requested→completed 的顶替降噪已由 runtime 侧只发结果事件天然满足）
   模块级组件：自订阅 agentRunStore/settingsStore，不重渲 App。 */
import { useEffect, useRef, useState } from 'react';
import { useAgentRun } from '../store/agentRunStore';
import { useSettings } from '../store/settingsStore';
import type { AgentRunEvent } from '../systems/agent/agentTypes';

const TONE_CLS: Record<AgentRunEvent['tone'], string> = {
  info: 'text-slate-300',
  active: 'text-sky-300',
  success: 'text-emerald-300',
  warn: 'text-amber-300',
  error: 'text-rose-300',
};

const STATUS_TXT: Record<string, string> = {
  running: '运行中', completed: '✅ 完成', partial: '⚠ 部分成功（已保留成稿）', failed: '❌ 失败', cancelled: '⏹ 已取消',
};

export function AgentTimeline() {
  const enabled = useSettings((s) => s.agentNarrative?.enabled);
  const active = useAgentRun((s) => s.active);
  const lastRun = useAgentRun((s) => s.runs[0]);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const run = active ?? lastRun ?? null;
  // 运行中自动滚到最新事件
  useEffect(() => {
    if (open && active && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, active, active?.events.length]);

  if (!enabled || !run) return null;

  const last = run.events[run.events.length - 1];
  const statusTxt = STATUS_TXT[run.status] ?? run.status;
  const headline = active
    ? `🤖 Agent ${statusTxt} · 第 ${run.rounds || 1} 轮 · ${last ? last.label : '准备中…'}`
    : `🤖 上次 Agent 运行：${statusTxt} · ${run.rounds} 轮 · ${run.commits} 次提交${run.durationMs ? ` · ${Math.round(run.durationMs / 1000)}s` : ''}`;

  return (
    <div className="mb-1 border border-edge rounded bg-panel2/60 text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-panel2 transition-colors"
        title={open ? '收起 Agent 时间线' : '展开 Agent 时间线'}
      >
        <span className={`truncate flex-1 ${active ? 'text-sky-300 animate-pulse' : 'text-dim'}`}>{headline}</span>
        <span className="text-dim shrink-0">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div ref={listRef} className="max-h-48 overflow-y-auto px-2 pb-1.5 space-y-0.5">
          {run.events.length === 0 && <div className="text-dim">Agent 正在思考…</div>}
          {run.events.map((ev) => (
            <div key={ev.id} className="flex gap-2 items-baseline">
              <span className="text-dim shrink-0 w-8 text-right">R{ev.round}</span>
              <span className={`${TONE_CLS[ev.tone]} shrink-0`}>{ev.label}</span>
              {ev.detail && <span className="text-dim truncate">{ev.detail}</span>}
            </div>
          ))}
          {run.errorCode && <div className="text-rose-300/80 pt-0.5">错误码：{run.errorCode}</div>}
        </div>
      )}
    </div>
  );
}
