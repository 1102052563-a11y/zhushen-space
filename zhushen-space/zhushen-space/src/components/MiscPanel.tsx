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
  const contractors = useMisc((s) => s.contractors) ?? { count: 0, note: '' };
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
      <div className="w-full max-w-2xl h-[88dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">

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

        {/* 本世界·其他契约者人口（随世界时间演化·让世界不是单机） */}
        {(contractors.count ?? 0) > 0 && (
          <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b border-edge bg-panel/50 text-[12px]">
            <span className="font-mono text-dim/50 shrink-0">🧭 本世界契约者</span>
            <span className="font-mono text-amber-300/90 shrink-0">{contractors.count} 人</span>
            {contractors.note && <span className="text-dim/70 truncate">· {contractors.note}</span>}
          </div>
        )}

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
                  {/* 已结束任务不再折叠成一行：复用完整任务卡（archived 模式），保留原有环数/进度条/每环奖励，只是整体淡化 */}
                  <div className="space-y-1">
                    {archivedTasks.map((t) => (
                      <TaskCard key={t.id} t={t} main={isMainQuest(t)} archived />
                    ))}
                  </div>
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

/* 任务卡片：主线置顶高亮 + 环进度条/环列表/终局；无 rings 时退回扁平显示。
   archived=已结束任务：整体淡化 + 头部显示评分/结束状态 + 展开每个达成环的奖励（不再折叠成一行），不显示进行中才有的贪婪抉择/未解锁环提示。 */
function TaskCard({ t, main, onRemove, archived }: { t: MiscTask; main: boolean; onRemove?: () => void; archived?: boolean }) {
  const rings = Array.isArray(t.rings) ? [...t.rings].sort((a, b) => a.idx - b.idx) : [];
  const hasRings = rings.length > 0;
  const active = rings.find((r) => r.status === 'active');
  const pos = active ? active.idx : rings.filter((r) => r.status === 'done').length;
  // 容错：旧档若曾丢环，total 取「环数 vs 最大 idx」更大者，避免显示「第3/共2环」这种矛盾计数
  const total = rings.length ? Math.max(rings.length, ...rings.map((r) => r.idx)) : 0;
  const failed = /失败|放弃|作废|取消/.test(t.status);
  return (
    <div className={`rounded-lg px-3 py-2 space-y-1 border ${archived ? 'border-edge/50 bg-panel/30 opacity-80' : main ? 'border-god/50 bg-god/10' : 'border-edge bg-panel/60'}`}>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${main ? 'bg-god/20 text-god border border-god/40' : 'bg-edge/40 text-dim/55'}`}>
          {main ? '主线' : '支线'}
        </span>
        <span className="text-[12px] font-mono text-dim/45 shrink-0">{t.id}</span>
        <span className={`text-sm font-semibold flex-1 truncate ${archived ? (failed ? 'text-blood/70' : 'text-dim/80') : main ? 'text-god' : 'text-slate-100'}`}>{t.name || '（未命名任务）'}</span>
        {archived ? (
          <>
            {t.rating && <span className={`text-[11px] font-mono px-1 rounded shrink-0 ${failed ? 'bg-blood/15 text-blood/70' : 'bg-amber-500/15 text-amber-300/80'}`}>评{t.rating}</span>}
            <span className={`text-[12px] font-mono shrink-0 ${failed ? 'text-blood/70' : 'text-emerald-400/70'}`}>{t.status}</span>
          </>
        ) : (
          <>
            <span className="text-[12px] font-mono text-amber-400/80 shrink-0">{t.status}</span>
            {onRemove && <button onClick={onRemove} className="text-[12px] font-mono text-blood/50 hover:text-blood shrink-0">删</button>}
          </>
        )}
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
            <span className="text-[11px] font-mono text-dim/50 shrink-0">第{pos}/共{total}环</span>
          </div>
          {/* 环列表：已达成/当前环逐条显示；未来(planned)环只提示"还剩N环"、不剧透 */}
          <div className="space-y-0.5">
            {rings.filter((r) => r.status !== 'planned').map((r) => (
              <div key={r.idx} className={`text-[12px] leading-snug ${ringTextTone(r.status)}`}>
                <span className="font-mono opacity-70">{ringMark(r.status)}环{r.idx}</span> {r.goal}
                {r.status === 'active' && (
                  <span className={`ml-1 text-[10px] font-mono px-1 rounded border ${r.optional ? 'border-amber-500/40 text-amber-400/80' : 'border-blood/40 text-blood/70'}`}>{r.optional ? '贪婪·可选' : '强制'}</span>
                )}
                {/* 达成环·评级徽标 */}
                {r.status === 'done' && r.rating && (
                  <span className="ml-1 text-[10px] font-mono px-1 rounded bg-amber-500/15 text-amber-300/80">评{r.rating}</span>
                )}
                {/* 达成环·主角这一环的行为总结（结算逐环评价依据） */}
                {r.status === 'done' && r.summary && (
                  <div className="pl-4 text-[11px] text-sky-300/60 leading-snug">📖 {r.summary}</div>
                )}
                {/* 奖励：当前环正常显示；已达成环也**始终保留显示**（奖励只是移到结算统一兑现，不是没了），dimmer 区分 */}
                {r.status === 'active' && r.reward && (
                  <div className="pl-4 font-mono text-[11px] text-god/70">🎁 奖励：{r.reward}</div>
                )}
                {r.status === 'done' && r.reward && (
                  <div className="pl-4 font-mono text-[11px] text-god/50">🎁 奖励（待结算兑现）：{r.reward}</div>
                )}
                {r.status === 'active' && r.penalty && (
                  <div className="pl-4 font-mono text-[11px] text-blood/55">⚠ 惩罚：{r.penalty}</div>
                )}
              </div>
            ))}
            {!archived && rings.filter((r) => r.status === 'planned').length > 0 && (
              <div className="text-[11px] font-mono text-dim/40">🔒 还剩 {rings.filter((r) => r.status === 'planned').length} 环（随剧情解锁）</div>
            )}
          </div>
          {!archived && (() => {
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

      {!archived && t.progress && (
        <div className="text-[12px] leading-relaxed text-sky-300/75">
          <span className="font-mono text-dim/45">📈 进度·上回合：</span>{t.progress}
        </div>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-mono text-dim/60">
        {/* 多环任务的奖惩按"每环"显示（见上方当前环 🎁 奖励），此处不再重复任务级奖惩，避免冗余；仅无环的扁平任务才显示 */}
        {!hasRings && t.reward && <span className="text-god/60">奖励：{t.reward}</span>}
        {!hasRings && t.penalty && <span className="text-blood/60">{archived ? '惩罚' : '失败'}：{t.penalty}</span>}
        {(t.startTime || t.endTime) && <span>⏳ {t.startTime || '—'} ~ {t.endTime || '—'}</span>}
      </div>
    </div>
  );
}
