import { useState } from 'react';
import { useMisc, isMainQuest, type MiscTask, type QuestRing } from '../store/miscStore';

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

  const mainTasks = tasks.filter((t) => isMainQuest(t));   // 主线置顶高亮
  const sideTasks = tasks.filter((t) => !isMainQuest(t));  // 支线分组

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
              {mainTasks.map((t) => (
                <TaskCard key={t.id} t={t} main onRemove={() => removeTask(t.id)} />
              ))}
              {mainTasks.length > 0 && sideTasks.length > 0 && (
                <div className="text-[11px] font-mono text-dim/40 px-1 pt-1">支线</div>
              )}
              {sideTasks.map((t) => (
                <TaskCard key={t.id} t={t} main={false} onRemove={() => removeTask(t.id)} />
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

/* 环状态 → 文字配色 / 进度条配色 / 前缀符 */
function ringTextTone(s: QuestRing['status']): string {
  return s === 'done' ? 'text-emerald-400/80'
    : s === 'active' ? 'text-amber-300'
    : s === 'skipped' ? 'text-slate-500/60 line-through'
    : 'text-dim/55';
}
function ringBarTone(s: QuestRing['status']): string {
  return s === 'done' ? 'bg-emerald-500/70'
    : s === 'active' ? 'bg-amber-400'
    : s === 'skipped' ? 'bg-slate-700/40'
    : 'bg-slate-600/40';
}
function ringMark(s: QuestRing['status']): string {
  return s === 'done' ? '✓' : s === 'active' ? '▶' : s === 'skipped' ? '⤼' : '·';
}

/* 任务卡片：主线置顶高亮 + 环进度条/环列表/终局；无 rings 时退回扁平显示 */
function TaskCard({ t, main, onRemove }: { t: MiscTask; main: boolean; onRemove: () => void }) {
  const rings = Array.isArray(t.rings) ? [...t.rings].sort((a, b) => a.idx - b.idx) : [];
  const hasRings = rings.length > 0;
  const active = rings.find((r) => r.status === 'active');
  const pos = active ? active.idx : rings.filter((r) => r.status === 'done').length;
  return (
    <div className={`rounded-lg px-3 py-2 space-y-1 border ${main ? 'border-god/50 bg-god/10' : 'border-edge bg-panel/60'}`}>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${main ? 'bg-god/20 text-god border border-god/40' : 'bg-edge/40 text-dim/55'}`}>
          {main ? '主线' : '支线'}
        </span>
        <span className="text-[12px] font-mono text-dim/45 shrink-0">{t.id}</span>
        <span className={`text-sm font-semibold flex-1 truncate ${main ? 'text-god' : 'text-slate-100'}`}>{t.name || '（未命名任务）'}</span>
        <span className="text-[12px] font-mono text-amber-400/80 shrink-0">{t.status}</span>
        <button onClick={onRemove} className="text-[12px] font-mono text-blood/50 hover:text-blood shrink-0">删</button>
      </div>

      {hasRings ? (
        <div className="space-y-1">
          {/* 进度条 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 flex gap-0.5">
              {rings.map((r) => (
                <div key={r.idx} className={`h-1.5 flex-1 rounded-full ${ringBarTone(r.status)}`} title={`环${r.idx} ${r.goal}`} />
              ))}
            </div>
            <span className="text-[11px] font-mono text-dim/50 shrink-0">第{pos}/共{rings.length}环</span>
          </div>
          {/* 环列表：已达成/当前环逐条显示；未来(planned)环只提示"还剩N环"、不剧透 */}
          <div className="space-y-0.5">
            {rings.filter((r) => r.status !== 'planned').map((r) => (
              <div key={r.idx} className={`text-[12px] leading-snug ${ringTextTone(r.status)}`}>
                <span className="font-mono opacity-70">{ringMark(r.status)}环{r.idx}</span> {r.goal}
                {r.status === 'active' && (
                  <span className={`ml-1 text-[10px] font-mono px-1 rounded border ${r.optional ? 'border-amber-500/40 text-amber-400/80' : 'border-blood/40 text-blood/70'}`}>{r.optional ? '贪婪·可选' : '强制'}</span>
                )}
                {/* 奖励与惩罚都只显示「当前进行中」那一环 */}
                {r.status === 'active' && r.reward && (
                  <div className="pl-4 font-mono text-[11px] text-god/70">🎁 奖励：{r.reward}</div>
                )}
                {r.status === 'active' && r.penalty && (
                  <div className="pl-4 font-mono text-[11px] text-blood/55">⚠ 惩罚：{r.penalty}</div>
                )}
              </div>
            ))}
            {rings.filter((r) => r.status === 'planned').length > 0 && (
              <div className="text-[11px] font-mono text-dim/40">🔒 还剩 {rings.filter((r) => r.status === 'planned').length} 环（随剧情解锁）</div>
            )}
          </div>
          {(() => {
            const greedy = rings.filter((r) => r.optional);
            const forcedAllDone = rings.some((r) => !r.optional) && rings.filter((r) => !r.optional).every((r) => r.status === 'done' || r.status === 'skipped');
            return forcedAllDone && greedy.some((r) => r.status === 'planned') && !greedy.some((r) => r.status === 'active')
              ? <div className="text-[12px] font-mono text-amber-400/80">✅ 主线已达成 · ⚖ 可见好就收离场，或接受隐藏委托·继续赌（贪婪环·高风险高回报）</div>
              : null;
          })()}
          {t.finale && <div className="text-[12px] font-mono text-god/55">🏁 终局：{t.finale}</div>}
        </div>
      ) : (
        t.desc && <div className="text-[13px] text-dim/80 leading-relaxed">{t.desc}</div>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-mono text-dim/60">
        {/* 多环任务的奖惩按"每环"显示（见上方当前环 🎁 奖励），此处不再重复任务级奖惩，避免冗余；仅无环的扁平任务才显示 */}
        {!hasRings && t.reward && <span className="text-god/60">奖励：{t.reward}</span>}
        {!hasRings && t.penalty && <span className="text-blood/60">失败：{t.penalty}</span>}
        {(t.startTime || t.endTime) && <span>⏳ {t.startTime || '—'} ~ {t.endTime || '—'}</span>}
      </div>
    </div>
  );
}
