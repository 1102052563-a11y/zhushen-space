import { useState } from 'react';
import { useMisc, isMainQuest, type MiscTask, type QuestRing } from '../store/miscStore';
import { usePlayer } from '../store/playerStore';
import { useCharacters } from '../store/characterStore';
import { useCalendar } from '../store/calendarStore';
import { extractMonthDay, visibleIn, sortByDate, dateLabel, upcoming, TYPE_META, type AlmanacItem, type AlmanacType } from '../systems/calendar';
import { latestNode, impactIndex } from '../systems/rumor';
import { scopeOf, isSettled, OUTCOME_LABEL } from '../systems/worldEvent';

type Tab = 'tasks' | 'events' | 'rumors' | 'almanac' | 'skills';

/* 影响力五档 → 色阶（低→高：灰 → 石板 → 琥珀 → 橙 → 紫） */
const IMPACT_COLOR = ['text-dim/50', 'text-slate-300', 'text-amber-300/90', 'text-orange-300', 'text-fuchsia-300'];

export default function MiscPanel({ onClose, onGenerate }: { onClose: () => void; onGenerate?: (tendency: string) => Promise<{ ok: boolean; msg: string }> }) {
  const tasks = useMisc((s) => s.tasks);
  const archivedTasks = useMisc((s) => s.archivedTasks);
  const events = useMisc((s) => s.worldEvents);
  const removeTask = useMisc((s) => s.removeTask);
  const editTask = useMisc((s) => s.editTask);
  const toggleTaskLock = useMisc((s) => s.toggleTaskLock);
  const clearArchivedTasks = useMisc((s) => s.clearArchivedTasks);
  const removeEvent = useMisc((s) => s.removeWorldEvent);
  const rumors = useMisc((s) => s.rumors) ?? [];
  const removeRumor = useMisc((s) => s.removeRumor);
  const [truthOpen, setTruthOpen] = useState<Record<string, boolean>>({});   // 真相默认折叠：玩家自己选当上帝还是当局中人
  const paradiseTime = useMisc((s) => s.paradiseTime);
  const worldTime = useMisc((s) => s.worldTime);
  const worldName = useMisc((s) => s.worldName);
  const weather = useMisc((s) => s.weather);
  const contractors = useMisc((s) => s.contractors) ?? { count: 0, note: '' };
  const profession = usePlayer((s) => s.profile.profession);
  const b1 = useCharacters((s) => s.characters['B1']);
  const skills = b1?.skills ?? [];
  const traits = b1?.traits ?? [];
  const subprofs = b1?.subProfessions ?? [];
  const [tab, setTab] = useState<Tab>('tasks');
  const [editing, setEditing] = useState<MiscTask | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  // 🗓 世界历：本世界可见（本世界专属 + 跨世界）；「还有几天」靠从 worldTime 抠出的锚点算，抠不出就不显示
  const almItems = useCalendar((s) => s.items);
  const almVisible = sortByDate(visibleIn(almItems, worldName));
  const almAnchor = extractMonthDay(worldTime) ?? extractMonthDay(paradiseTime);
  const almSoon = almAnchor ? new Map(upcoming(almVisible, almAnchor, 30).map((u) => [u.item.id, u.inDays])) : null;
  const upsertAlm = useCalendar((s) => s.upsert);
  const removeAlm = useCalendar((s) => s.remove);
  const [almEditing, setAlmEditing] = useState<AlmanacItem | null>(null);   // id='' 表示新增

  const mainTasks = tasks.filter((t) => isMainQuest(t));   // 主线置顶高亮
  const sideTasks = tasks.filter((t) => !isMainQuest(t));  // 支线分组

  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: 'tasks', label: '任务', n: tasks.length },
    { key: 'events', label: '世界大事', n: events.filter((e) => !isSettled(e)).length },
    { key: 'rumors', label: '📢 传闻', n: rumors.length },
    { key: 'almanac', label: '历', n: almVisible.length },
    { key: 'skills', label: '职业技能', n: skills.length },
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

        <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-edge bg-panel">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1 rounded text-sm font-mono border transition-colors ${tab === t.key ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>
              {t.label}{t.n > 0 ? ` (${t.n})` : ''}
            </button>
          ))}
          <span className="flex-1" />
          {tab === 'tasks' && onGenerate && (
            <button onClick={() => setGenOpen(true)} title="按你的倾向手动重新生成本世界主线（覆盖原有）"
              className="px-2.5 py-1 rounded text-[12px] font-mono border border-god/40 text-god/90 bg-god/10 hover:bg-god/20 transition-colors">
              🎲 手动生成主线
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {tab === 'tasks' && (
            tasks.length === 0 && archivedTasks.length === 0 ? <Empty text="暂无任务" /> : (
            <>
              {tasks.length === 0 && <div className="text-[12px] font-mono text-dim/40 text-center py-3">暂无进行中任务</div>}
              {mainTasks.map((t) => (
                <TaskCard key={t.id} t={t} main onRemove={() => removeTask(t.id)} onEdit={() => setEditing(t)} onToggleLock={() => toggleTaskLock(t.id)} />
              ))}
              {mainTasks.length > 0 && sideTasks.length > 0 && (
                <div className="text-[11px] font-mono text-dim/40 px-1 pt-1">支线</div>
              )}
              {sideTasks.map((t) => (
                <TaskCard key={t.id} t={t} main={false} onRemove={() => removeTask(t.id)} onEdit={() => setEditing(t)} onToggleLock={() => toggleTaskLock(t.id)} />
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
            [...events].reverse().map((e) => {
              const settled = isSettled(e);
              const bg = scopeOf(e) === 'background';
              const chain = e.chain ?? [];
              return (
                <div key={e.id} className={`rounded-lg border px-3 py-2 ${settled ? 'border-edge/50 bg-panel/30 opacity-70' : 'border-edge bg-panel/60'}`}>
                  <div className="flex items-center gap-2 text-[12px] font-mono text-dim/60 mb-0.5 flex-wrap">
                    <span className={bg ? 'text-indigo-300/80' : 'text-emerald-300/80'}>{bg ? '🌐 背景' : '📍 区域'}</span>
                    {e.time && <span>🕒 {e.time}</span>}
                    {e.location && <span>📍 {e.location}</span>}
                    {settled && <span className="text-amber-300/80">🏁 {OUTCOME_LABEL[e.outcome ?? 'faded']}</span>}
                    <span className="flex-1" />
                    <button onClick={() => removeEvent(e.id)} className="text-blood/50 hover:text-blood">删</button>
                  </div>
                  {e.name && <div className="text-[14px] font-bold text-slate-100 mb-0.5">{e.name}</div>}
                  {/* 事件脉络：推进是追加，所以这里读起来就是一条完整的时间线（老条目无 chain → 显示 desc） */}
                  {chain.length > 0 ? (
                    <div className="space-y-0.5 border-l-2 border-edge/60 pl-2.5 my-1">
                      {chain.map((c, i) => (
                        <div key={i} className="text-[13px] text-slate-300 leading-relaxed">
                          {c.date && <span className="font-mono text-[11px] text-dim/50 mr-1.5">{c.date}</span>}{c.text}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[14px] text-slate-300 leading-relaxed">{e.desc}</div>
                  )}
                  <div className="flex flex-wrap gap-x-3 text-[11px] font-mono text-dim/50 mt-1">
                    {e.actors && <span>👥 {e.actors}</span>}
                    {e.settleCond && <span className="text-sky-300/70">🎯 {e.settleCond}</span>}
                  </div>
                </div>
              );
            })
          )}

          {tab === 'rumors' && (
            rumors.length === 0 ? <Empty text="暂无流传的传闻" /> : (
              <>
                <div className="text-[11px] font-mono text-dim/45 leading-relaxed pb-1">
                  传闻是<b className="text-slate-300">世人嘴里的说法</b>，与客观真相分开记 —— NPC 只知道「流传」这一栏，可能因此说错话、做错事。
                  「真相」默认折叠：你可以选择当上帝，也可以跟着一起被蒙在鼓里。
                </div>
                {[...rumors].reverse().map((r) => {
                  const n = latestNode(r);
                  const open = !!truthOpen[r.id];
                  return (
                    <div key={r.id} className="rounded-lg border border-edge bg-panel/60 px-3 py-2">
                      <div className="flex items-center gap-2 text-[12px] font-mono mb-0.5 flex-wrap">
                        <span className={IMPACT_COLOR[impactIndex(r.impact)]}>◈ {r.impact}</span>
                        {r.scope && <span className="text-dim/60">📡 {r.scope}</span>}
                        <span className="text-dim/40">流变 {r.nodes.length} 次</span>
                        <span className="flex-1" />
                        <button onClick={() => removeRumor(r.id)} className="text-blood/50 hover:text-blood">删</button>
                      </div>
                      <div className="text-[14px] font-bold text-slate-100 mb-1">{r.name}</div>
                      {n && (
                        <>
                          <div className="text-[13px] text-slate-300 leading-relaxed">
                            <span className="font-mono text-[11px] text-dim/50 mr-1.5">流传</span>{n.told || '—'}
                          </div>
                          <button
                            onClick={() => setTruthOpen((p) => ({ ...p, [r.id]: !p[r.id] }))}
                            className="mt-1 text-[11px] font-mono text-dim/45 hover:text-god/80 transition-colors">
                            {open ? '▾ 收起真相' : '▸ 查看真相与偏差（剧透）'}
                          </button>
                          {open && (
                            <div className="mt-1 space-y-0.5 rounded border border-god/25 bg-god/5 px-2 py-1.5">
                              <div className="text-[13px] text-god/90 leading-relaxed">
                                <span className="font-mono text-[11px] text-dim/50 mr-1.5">真相</span>{n.truth || '—'}
                              </div>
                              <div className="text-[13px] text-amber-300/80 leading-relaxed">
                                <span className="font-mono text-[11px] text-dim/50 mr-1.5">偏差</span>{n.drift || '—'}
                              </div>
                              {n.cause && <div className="text-[12px] text-dim/60 leading-relaxed">
                                <span className="font-mono text-[11px] text-dim/50 mr-1.5">诱因</span>{n.cause}
                              </div>}
                              <div className="text-[11px] font-mono text-dim/40 pt-0.5">
                                形成 {n.date || '—'}　时效 {n.expire || '—'}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </>
            )
          )}

          {tab === 'almanac' && (
            <div className="space-y-2">
              <div className="text-[11px] font-mono text-dim/45 leading-relaxed">
                世界历只收「<b className="text-dim/70">每年固定到期</b>」的日子：节日 / 生日 / 纪念日。一次性事件请走「世界大事」，有期限的目标请走「任务」。
                <br />这里的条目会喂给杂项演化 AI（它也可自行建档），并在<b className="text-dim/70">临近时</b>随「当前时空」注入正文——楼层信息条的「历」段就是它。
                {!almAnchor && <><br /><span className="text-amber-400/70">当前世界时间看不出月/日（如「进入世界第 3 天」），暂时算不了「还有几天」，仅按日期排列。</span></>}
              </div>
              <button onClick={() => setAlmEditing({ id: '', name: '', type: 'festival', month: 1, day: 1, days: 1 })}
                className="px-2 py-1 rounded border border-god/40 text-god/90 bg-god/10 hover:bg-god/20 text-[12px] font-mono transition-colors">＋ 新增一个日子</button>
              {almVisible.length === 0 ? <Empty text="暂无历条目" /> : almVisible.map((it) => {
                const meta = TYPE_META[it.type];
                const inDays = almSoon?.get(it.id);
                return (
                  <div key={it.id} className="rounded-lg border border-edge bg-panel/60 px-3 py-2">
                    <div className="flex items-center gap-2 text-[12px] font-mono flex-wrap">
                      <span>{meta.glyph}</span>
                      <span className="text-slate-200 text-[14px]">{it.name}</span>
                      <span className="text-dim/50">{meta.label}</span>
                      <span className="text-dim/60">{dateLabel(it)}</span>
                      {inDays !== undefined && <span className="text-god/70">{inDays === 0 ? '就是今天' : `还有 ${inDays} 天`}</span>}
                      <span className="text-dim/40">{it.world ? it.world : '跨世界'}</span>
                      <span className="flex-1" />
                      <button onClick={() => setAlmEditing(it)} className="text-dim/60 hover:text-god">改</button>
                      <button onClick={() => removeAlm(it.id)} className="text-blood/50 hover:text-blood">删</button>
                    </div>
                    {it.note && <div className="text-[13px] text-slate-300 leading-relaxed mt-0.5">{it.note}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'skills' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[12px] flex-wrap">
                <span className="font-mono text-dim/50">职业</span>
                <span className="text-god/85 font-semibold">{profession || '（未设定）'}</span>
                <span className="flex-1" />
                <span className="font-mono text-[11px] text-dim/40">任务生成已参考它·让职业专长有用武之地</span>
              </div>
              <div>
                <div className="text-[11px] font-mono text-dim/50 mb-1">技能（{skills.length}）</div>
                {skills.length === 0 ? <div className="text-[11px] text-dim/40">暂无技能</div> : (
                  <div className="space-y-1">
                    {skills.map((s) => {
                      const nm = String(s.name || '').split('|')[0].trim();
                      return (
                        <div key={s.id} className="rounded border border-edge bg-panel/40 px-2 py-1.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[13px] text-slate-200 font-semibold">{nm || '（未命名）'}</span>
                            {s.skillType && <span className="text-[10px] font-mono px-1 rounded bg-edge/40 text-dim/60">{s.skillType}</span>}
                            {s.rarity && <span className="text-[10px] font-mono px-1 rounded bg-amber-500/10 text-amber-300/70">{s.rarity}</span>}
                            {s.level && <span className="text-[10px] font-mono text-dim/50">{s.level}</span>}
                          </div>
                          {(s.effect || s.desc) && <div className="text-[11px] text-dim/70 leading-snug mt-0.5">{s.effect || s.desc}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {traits.length > 0 && (
                <div>
                  <div className="text-[11px] font-mono text-dim/50 mb-1">天赋（{traits.length}）</div>
                  <div className="space-y-1">
                    {traits.map((t) => {
                      const nm = String(t.name || '').split('|')[0].trim();
                      return (
                        <div key={nm || (t as any).id} className="rounded border border-edge bg-panel/40 px-2 py-1.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[13px] text-emerald-300/85 font-semibold">{nm || '（未命名）'}</span>
                            {(t as any).rarity && <span className="text-[10px] font-mono px-1 rounded bg-amber-500/10 text-amber-300/70">{(t as any).rarity}</span>}
                          </div>
                          {(t as any).effect && <div className="text-[11px] text-dim/70 leading-snug mt-0.5">{(t as any).effect}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {subprofs.length > 0 && (
                <div>
                  <div className="text-[11px] font-mono text-dim/50 mb-1">副职业（{subprofs.length}）</div>
                  <div className="flex flex-wrap gap-1.5">
                    {subprofs.map((sp) => (
                      <span key={String(sp.name)} className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-edge text-sky-300/70">
                        {String(sp.name || '').split('|')[0].trim()}{(sp as any).tier ? `·${(sp as any).tier}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {skills.length === 0 && traits.length === 0 && subprofs.length === 0 && !profession && (
                <Empty text="暂无职业/技能数据（在角色创建或技能面板里设定）" />
              )}
            </div>
          )}
        </div>
        {editing && (
          <TaskEditModal
            task={editing}
            onSave={(patch) => { editTask(editing.id, patch); setEditing(null); }}
            onClose={() => setEditing(null)}
          />
        )}
        {genOpen && onGenerate && (
          <GenerateTaskModal onGenerate={onGenerate} onClose={() => setGenOpen(false)} />
        )}
        {almEditing && (
          <AlmanacEditModal
            item={almEditing}
            worldName={worldName}
            onSave={(patch) => { upsertAlm(patch, almEditing.id || undefined); setAlmEditing(null); }}
            onClose={() => setAlmEditing(null)}
          />
        )}
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
function TaskCard({ t, main, onRemove, onEdit, onToggleLock, archived }: { t: MiscTask; main: boolean; onRemove?: () => void; onEdit?: () => void; onToggleLock?: () => void; archived?: boolean }) {
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
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${t.prof ? 'bg-sky-500/15 text-sky-300/80 border border-sky-500/30' : main ? 'bg-god/20 text-god border border-god/40' : 'bg-edge/40 text-dim/55'}`}>
          {t.prof ? '职业' : main ? '主线' : '支线'}
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
            {onToggleLock && <button onClick={onToggleLock} title={t.locked ? '已锁定·点击解锁（AI 只更新进度、不改任务链）' : '锁定任务链（AI 只更新进度、不改结构）'} className={`text-[12px] font-mono shrink-0 ${t.locked ? 'text-amber-300/90' : 'text-dim/40 hover:text-amber-300/70'}`}>{t.locked ? '🔒' : '🔓'}</button>}
            {onEdit && <button onClick={onEdit} title="编辑任务" className="text-[12px] font-mono text-dim/50 hover:text-god shrink-0">✏️</button>}
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

/* ── 任务手动编辑弹窗（模块级组件·内部用原生受控输入，避免拼音输入被打断）── */
const RING_STATUSES: QuestRing['status'][] = ['planned', 'active', 'done', 'skipped'];
const RING_STATUS_LABEL: Record<QuestRing['status'], string> = { planned: '未解锁', active: '进行中', done: '已达成', skipped: '已跳过' };
const EDIT_INPUT = 'w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 focus:border-god/50 outline-none';

/* 🗓 历条目编辑（新增/修改共用；item.id==='' 为新增）。⚠模块级组件，勿内联进父组件（内联=每键重挂，IME 断字） */
const ALM_TYPES: AlmanacType[] = ['festival', 'birthday', 'anniversary', 'custom'];

function AlmanacEditModal({ item, worldName, onSave, onClose }: { item: AlmanacItem; worldName: string; onSave: (patch: Partial<AlmanacItem>) => void; onClose: () => void }) {
  const [name, setName] = useState(item.name || '');
  const [type, setType] = useState<AlmanacType>(item.type || 'festival');
  const [month, setMonth] = useState(String(item.month || 1));
  const [day, setDay] = useState(String(item.day || 1));
  const [days, setDays] = useState(String(item.days || 1));
  const [displayDate, setDisplayDate] = useState(item.displayDate || '');
  const [note, setNote] = useState(item.note || '');
  // 「本世界专属」勾上 → world=当前世界名；不勾 → 留空=跨世界（主角生日、乐园级纪念日）
  const [scoped, setScoped] = useState(!!item.world || (!item.id && !!worldName));

  const save = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(), type, month: Number(month) || 1, day: Number(day) || 1, days: Number(days) || 1,
      displayDate: displayDate.trim(), note: note.trim(), world: scoped ? worldName : '',
    });
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md max-h-[86dvh] flex flex-col rounded-2xl border border-god/40 bg-void shadow-[0_0_60px_rgba(0,0,0,0.85)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-edge bg-panel">
          <span className="text-sm font-bold text-god">🗓 {item.id ? '编辑' : '新增'}一个日子</span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="grid grid-cols-[3.6rem_1fr] gap-x-3 gap-y-2 items-center text-[12px]">
            <label className="text-dim/60 font-mono">名称</label>
            <input className={EDIT_INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="如 魂师大赛 / 凯莉的生日" />
            <label className="text-dim/60 font-mono">类型</label>
            <div className="flex gap-1.5 flex-wrap">
              {ALM_TYPES.map((t) => (
                <button key={t} onClick={() => setType(t)}
                  className={`px-2 py-1 rounded border text-[12px] font-mono transition-colors ${type === t ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>
                  {TYPE_META[t].glyph} {TYPE_META[t].label}
                </button>
              ))}
            </div>
            <label className="text-dim/60 font-mono">日期</label>
            <div className="flex items-center gap-1.5 flex-wrap">
              <input className={`${EDIT_INPUT} w-14`} type="number" min={1} max={12} value={month} onChange={(e) => setMonth(e.target.value)} />
              <span className="text-dim/50">月</span>
              <input className={`${EDIT_INPUT} w-14`} type="number" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} />
              <span className="text-dim/50">日 · 持续</span>
              <input className={`${EDIT_INPUT} w-14`} type="number" min={1} max={366} value={days} onChange={(e) => setDays(e.target.value)} />
              <span className="text-dim/50">天</span>
            </div>
            <label className="text-dim/60 font-mono">本地写法</label>
            <input className={EDIT_INPUT} value={displayDate} onChange={(e) => setDisplayDate(e.target.value)} placeholder="选填：腊月廿三 / 火之月第三日（留空则显示 M月D日）" />
            <label className="text-dim/60 font-mono">说明</label>
            <input className={EDIT_INPUT} value={note} onChange={(e) => setNote(e.target.value)} placeholder="选填：一句话（会随「临近的日子」注入正文）" />
            <label className="text-dim/60 font-mono">归属</label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={scoped} onChange={(e) => setScoped(e.target.checked)} disabled={!worldName} className="accent-god w-4 h-4" />
              <span className="text-[12px] text-slate-300">{worldName ? `仅「${worldName}」可见` : '（当前无世界名，只能记为跨世界）'}</span>
            </label>
          </div>
          <div className="text-[11px] font-mono text-dim/40 leading-relaxed">
            年份在扮演里无意义，只记月/日。不勾「仅本世界」= 跨世界长期有效（主角生日、乐园级纪念日）。
          </div>
        </div>
        <footer className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-t border-edge bg-panel">
          <span className="flex-1" />
          <button onClick={onClose} className="px-3 py-1 rounded border border-edge text-dim hover:text-slate-300 text-[13px] font-mono">取消</button>
          <button onClick={save} disabled={!name.trim()}
            className="px-3 py-1 rounded border border-god/40 text-god bg-god/10 hover:bg-god/20 disabled:opacity-40 text-[13px] font-mono">✓ 保存</button>
        </footer>
      </div>
    </div>
  );
}

function TaskEditModal({ task, onSave, onClose }: { task: MiscTask; onSave: (patch: Partial<MiscTask>) => void; onClose: () => void }) {
  const [name, setName] = useState(task.name || '');
  const [kind, setKind] = useState<'主线' | '支线'>(isMainQuest(task) ? '主线' : '支线');
  const [status, setStatus] = useState(task.status || '进行中');
  const [desc, setDesc] = useState(task.desc || '');
  const [finale, setFinale] = useState(task.finale || '');
  const [progress, setProgress] = useState(task.progress || '');
  const [rating, setRating] = useState(task.rating || '');
  const [reward, setReward] = useState(task.reward || '');
  const [penalty, setPenalty] = useState(task.penalty || '');
  const [rings, setRings] = useState<QuestRing[]>(Array.isArray(task.rings) ? task.rings.map((r) => ({ ...r })) : []);

  const upd = (i: number, p: Partial<QuestRing>) => setRings((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const addRing = () => setRings((rs) => [...rs, { idx: (rs.length ? Math.max(...rs.map((r) => r.idx)) : 0) + 1, goal: '', status: 'planned' }]);
  const delRing = (i: number) => setRings((rs) => rs.filter((_, idx) => idx !== i));

  const save = () => {
    const sorted = [...rings].sort((a, b) => a.idx - b.idx);
    const active = sorted.find((r) => r.status === 'active');
    onSave({
      name: name.trim(), kind, status: status.trim() || '进行中', desc, finale: finale.trim(), progress: progress.trim(),
      rating: rating.trim(), reward, penalty, rings: sorted, currentRing: active ? active.idx : (sorted[0]?.idx ?? 1),
    });
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg max-h-[86dvh] flex flex-col rounded-2xl border border-god/40 bg-void shadow-[0_0_60px_rgba(0,0,0,0.85)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-edge bg-panel">
          <span className="text-sm font-bold text-god">✏️ 编辑任务 <span className="font-mono text-dim/50">{task.id}</span></span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="grid grid-cols-[3.2rem_1fr] gap-x-3 gap-y-2 items-center text-[12px]">
            <label className="text-dim/60 font-mono">名称</label>
            <input className={EDIT_INPUT} value={name} onChange={(e) => setName(e.target.value)} />
            <label className="text-dim/60 font-mono">类型</label>
            <div className="flex gap-2">
              {(['主线', '支线'] as const).map((k) => (
                <button key={k} onClick={() => setKind(k)} className={`px-2 py-0.5 rounded text-[12px] font-mono border ${kind === k ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim'}`}>{k}</button>
              ))}
            </div>
            <label className="text-dim/60 font-mono">状态</label>
            <input className={EDIT_INPUT} value={status} onChange={(e) => setStatus(e.target.value)} placeholder="进行中 / 已完成 / 已失败 / 已放弃" />
            <label className="text-dim/60 font-mono">评级</label>
            <input className={EDIT_INPUT} value={rating} onChange={(e) => setRating(e.target.value)} placeholder="S / A / B / C / D / E（可空）" />
            <label className="text-dim/60 font-mono">终局</label>
            <input className={EDIT_INPUT} value={finale} onChange={(e) => setFinale(e.target.value)} placeholder="高潮/最后一环目标（可空）" />
            <label className="text-dim/60 font-mono">进度</label>
            <input className={EDIT_INPUT} value={progress} onChange={(e) => setProgress(e.target.value)} placeholder="上回合进度（可空）" />
          </div>

          <div className="pt-1">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[12px] font-mono text-dim/60">任务环（{rings.length}）</span>
              <span className="flex-1" />
              <button onClick={addRing} className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim hover:text-god hover:border-god/40">＋ 加环</button>
            </div>
            {rings.length === 0 && <div className="text-[11px] font-mono text-dim/40 mb-1">无环（扁平任务）。奖励/惩罚见下方。</div>}
            <div className="space-y-2">
              {rings.map((r, i) => (
                <div key={i} className="rounded-lg border border-edge bg-panel/40 p-2 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-mono text-dim/50 shrink-0">环</span>
                    <input type="number" className="w-12 bg-void border border-edge rounded px-1 py-0.5 text-[12px] text-slate-200 outline-none" value={r.idx} onChange={(e) => upd(i, { idx: Number(e.target.value) || r.idx })} />
                    <select className="bg-void border border-edge rounded px-1 py-0.5 text-[12px] text-slate-200 outline-none" value={r.status} onChange={(e) => upd(i, { status: e.target.value as QuestRing['status'] })}>
                      {RING_STATUSES.map((s) => <option key={s} value={s}>{RING_STATUS_LABEL[s]}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-[11px] font-mono text-dim/60"><input type="checkbox" checked={!!r.optional} onChange={(e) => upd(i, { optional: e.target.checked || undefined })} />贪婪</label>
                    <span className="flex-1" />
                    <button onClick={() => delRing(i)} className="text-[11px] font-mono text-blood/50 hover:text-blood shrink-0">删环</button>
                  </div>
                  <textarea className={EDIT_INPUT + ' resize-none'} rows={2} value={r.goal} onChange={(e) => upd(i, { goal: e.target.value })} placeholder="环目标" />
                  <input className={EDIT_INPUT} value={r.reward || ''} onChange={(e) => upd(i, { reward: e.target.value || undefined })} placeholder="本环奖励（可空）" />
                  <input className={EDIT_INPUT} value={r.penalty || ''} onChange={(e) => upd(i, { penalty: e.target.value || undefined })} placeholder="本环惩罚（可空）" />
                  {(r.status === 'done' || r.status === 'skipped') && (
                    <input className={EDIT_INPUT} value={r.summary || ''} onChange={(e) => upd(i, { summary: e.target.value || undefined })} placeholder="达成·主角行为总结（可空）" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {rings.length === 0 && (
            <div className="grid grid-cols-[3.2rem_1fr] gap-x-3 gap-y-2 items-center text-[12px]">
              <label className="text-dim/60 font-mono">奖励</label>
              <input className={EDIT_INPUT} value={reward} onChange={(e) => setReward(e.target.value)} />
              <label className="text-dim/60 font-mono">失败</label>
              <input className={EDIT_INPUT} value={penalty} onChange={(e) => setPenalty(e.target.value)} />
              <label className="text-dim/60 font-mono">描述</label>
              <textarea className={EDIT_INPUT + ' resize-none'} rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
          )}
        </div>
        <footer className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-t border-edge bg-panel">
          <span className="text-[11px] font-mono text-dim/40 flex-1 leading-tight">保存后即时生效·以你改的为准（不受 AI 路线图锁定）</span>
          <button onClick={onClose} className="text-[12px] font-mono px-3 py-1 rounded border border-edge text-dim hover:text-slate-200">取消</button>
          <button onClick={save} className="text-[12px] font-mono px-3 py-1 rounded border border-god/50 text-god bg-god/10 hover:bg-god/20">保存</button>
        </footer>
      </div>
    </div>
  );
}

/* ── 手动生成主线弹窗（按玩家倾向重规划本世界主线·覆盖原有）── */
function GenerateTaskModal({ onGenerate, onClose }: { onGenerate: (tendency: string) => Promise<{ ok: boolean; msg: string }>; onClose: () => void }) {
  const [tendency, setTendency] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const presets = ['不想战斗·偏潜入/智取', '偏经营/发展/建设', '偏解谜/调查/情报', '偏社交/攻略/结盟', '短平快·尽快通关', '硬核战斗·高强度'];

  const run = async () => {
    if (busy) return;
    setBusy(true); setResult(null);
    try { setResult(await onGenerate(tendency)); }
    catch (e: any) { setResult({ ok: false, msg: '生成出错：' + (e?.message || String(e)) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-full max-w-md flex flex-col rounded-2xl border border-god/40 bg-void shadow-[0_0_60px_rgba(0,0,0,0.85)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-edge bg-panel">
          <span className="text-sm font-bold text-god">🎲 手动生成主线</span>
          <span className="flex-1" />
          <button onClick={() => !busy && onClose()} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </header>
        <div className="p-4 space-y-3">
          <div className="text-[12px] text-dim/70 leading-relaxed">按你的<span className="text-god/80">任务倾向</span>为当前世界重规划一条主线并<span className="text-amber-300/80">覆盖原有主线</span>；不填就按世界核心目标常规生成。</div>
          <textarea className={EDIT_INPUT + ' resize-none'} rows={3} value={tendency} disabled={busy}
            onChange={(e) => setTendency(e.target.value)}
            placeholder="例：不想打打杀杀，偏潜入与智取；或 偏经营发展；或 沿原作主线深入…" />
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button key={p} disabled={busy} onClick={() => setTendency(p)}
                className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/70 hover:text-god hover:border-god/40 disabled:opacity-40">{p}</button>
            ))}
          </div>
          {result && (
            <div className={`text-[12px] rounded px-2 py-1.5 border ${result.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300/90' : 'border-blood/30 bg-blood/10 text-blood/80'}`}>
              {result.ok ? '✅ ' : '⚠ '}{result.msg}
            </div>
          )}
        </div>
        <footer className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-t border-edge bg-panel">
          <span className="text-[11px] font-mono text-dim/40 flex-1 leading-tight">生成会调用任务 API，稍等片刻</span>
          {result?.ok ? (
            <button onClick={onClose} className="text-[12px] font-mono px-3 py-1 rounded border border-god/50 text-god bg-god/10">完成</button>
          ) : (
            <>
              <button onClick={() => !busy && onClose()} disabled={busy} className="text-[12px] font-mono px-3 py-1 rounded border border-edge text-dim hover:text-slate-200 disabled:opacity-40">取消</button>
              <button onClick={run} disabled={busy} className="text-[12px] font-mono px-3 py-1 rounded border border-god/50 text-god bg-god/10 hover:bg-god/20 disabled:opacity-50">{busy ? '生成中…' : '生成'}</button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
