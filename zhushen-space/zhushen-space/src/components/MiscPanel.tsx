import { useState } from 'react';
import { useMisc } from '../store/miscStore';

type Tab = 'tasks' | 'events';

export default function MiscPanel({ onClose }: { onClose: () => void }) {
  const tasks = useMisc((s) => s.tasks);
  const archivedTasks = useMisc((s) => s.archivedTasks);
  const events = useMisc((s) => s.worldEvents);
  const removeTask = useMisc((s) => s.removeTask);
  const clearArchivedTasks = useMisc((s) => s.clearArchivedTasks);
  const removeEvent = useMisc((s) => s.removeWorldEvent);
  const paradiseTime = useMisc((s) => s.paradiseTime);
  const worldTime = useMisc((s) => s.worldTime);
  const worldName = useMisc((s) => s.worldName);
  const weather = useMisc((s) => s.weather);
  const [tab, setTab] = useState<Tab>('tasks');

  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: 'tasks', label: '任务', n: tasks.length },
    { key: 'events', label: '世界大事', n: events.length },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[88vh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">

        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/60 text-lg">📋</span>
          <div className="flex-1">
            <div className="text-sm font-bold text-slate-100">杂项 · 任务与世界</div>
            <div className="text-[12px] font-mono text-dim/60">由杂项演化阶段自动维护</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {/* 双时间 + 天气 */}
        <div className="shrink-0 grid grid-cols-3 gap-px bg-edge border-b border-edge text-center">
          <div className="bg-panel px-2 py-2">
            <div className="text-[11px] font-mono text-dim/50">轮回历时间</div>
            <div className="text-sm text-god font-mono mt-0.5 truncate">{paradiseTime || '—'}</div>
          </div>
          <div className="bg-panel px-2 py-2">
            <div className="text-[11px] font-mono text-dim/50">{worldName || '世界时间'}</div>
            <div className="text-sm text-slate-200 font-mono mt-0.5 truncate">{worldTime || '—'}</div>
          </div>
          <div className="bg-panel px-2 py-2">
            <div className="text-[11px] font-mono text-dim/50">天气</div>
            <div className="text-sm text-sky-300 font-mono mt-0.5 truncate">{weather || '—'}</div>
          </div>
        </div>

        <div className="shrink-0 flex gap-1 px-4 py-2 border-b border-edge bg-panel">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1 rounded text-sm font-mono border transition-colors ${tab === t.key ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>
              {t.label}{t.n > 0 ? ` (${t.n})` : ''}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {tab === 'tasks' && (
            tasks.length === 0 && archivedTasks.length === 0 ? <Empty text="暂无任务" /> : (
            <>
              {tasks.length === 0 && <div className="text-[12px] font-mono text-dim/40 text-center py-3">暂无进行中任务</div>}
              {tasks.map((t) => (
                <div key={t.id} className="rounded-lg border border-edge bg-panel/60 px-3 py-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-mono text-dim/50">{t.id}</span>
                    <span className="text-sm font-semibold text-slate-100 flex-1 truncate">{t.name || '（未命名任务）'}</span>
                    <span className="text-[12px] font-mono text-amber-400/80">{t.status}</span>
                    <button onClick={() => removeTask(t.id)} className="text-[12px] font-mono text-blood/50 hover:text-blood">删</button>
                  </div>
                  {t.desc && <div className="text-[13px] text-dim/80 leading-relaxed">{t.desc}</div>}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-mono text-dim/60">
                    {t.reward && <span className="text-god/60">奖励：{t.reward}</span>}
                    {t.penalty && <span className="text-blood/60">失败：{t.penalty}</span>}
                    {(t.startTime || t.endTime) && <span>⏳ {t.startTime || '—'} ~ {t.endTime || '—'}</span>}
                  </div>
                </div>
              ))}

              {archivedTasks.length > 0 && (
                <div className="pt-2 mt-1 border-t border-edge/60">
                  <div className="flex items-center gap-2 px-1 pb-1.5">
                    <span className="text-[12px] font-mono text-dim/50">已结束 ({archivedTasks.length})</span>
                    <span className="flex-1" />
                    <button onClick={clearArchivedTasks} className="text-[11px] font-mono text-dim/40 hover:text-blood">清空</button>
                  </div>
                  {archivedTasks.map((t) => {
                    const failed = /失败|放弃|作废|取消/.test(t.status);
                    return (
                      <div key={t.id} className="rounded-lg border border-edge/50 bg-panel/30 px-3 py-1.5 mb-1 flex items-center gap-2 opacity-70">
                        <span className="text-[11px] font-mono text-dim/40">{t.id}</span>
                        <span className="text-[13px] text-dim/70 line-through flex-1 truncate">{t.name || '（未命名任务）'}</span>
                        <span className={`text-[11px] font-mono ${failed ? 'text-blood/70' : 'text-emerald-400/70'}`}>{t.status}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
            )
          )}

          {tab === 'events' && (
            events.length === 0 ? <Empty text="暂无世界大事" /> :
            [...events].reverse().map((e) => (
              <div key={e.id} className="rounded-lg border border-edge bg-panel/60 px-3 py-2">
                <div className="flex items-center gap-2 text-[12px] font-mono text-dim/60 mb-0.5">
                  <span>🕒 {e.time}</span><span>📍 {e.location}</span>
                  <span className="flex-1" />
                  <button onClick={() => removeEvent(e.id)} className="text-blood/50 hover:text-blood">删</button>
                </div>
                <div className="text-[14px] text-slate-300 leading-relaxed">{e.desc}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-16 text-center text-dim/40 text-sm font-mono border border-dashed border-edge rounded-xl">{text}</div>;
}
