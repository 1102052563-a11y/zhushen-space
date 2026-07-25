import { useState, useMemo } from 'react';
import { useTables } from '../store/tableStore';
import { useChronicle } from '../store/chronicleStore';
import { useWorldRecord } from '../store/worldRecordStore';
import { useMisc } from '../store/miscStore';
import { useNpc } from '../store/npcStore';
import { useFaction } from '../store/factionStore';
import { usePlayer } from '../store/playerStore';
import { useMonument } from '../store/monumentStore';
import {
  buildVolumes, digestVolume, overallDigest, compiledToEvents, ORPHAN_VOLUME,
  TIER_LABEL, type ChronicleEvent, type ChronicleTier, type ChronicleVolume,
} from '../systems/chronicle';

/* ════════════════════════════════════════════
   📜 编年史（传奇模式）—— 两个视图，刻意不合并：

   · 本纪：当前存档的历史。卷(世界) → 页(纪要/事迹) → 注(评价/收获/代价)。
           **当朝为实录、前朝才有正史**：未编纂的卷现场投影实录 + 「修史」按钮；编纂过的卷显示正史，可重修。
   · 前尘：历代主角的丰碑（drpg-monument 是账号级、跨存档的）。
           它们的回合号来自**不同存档**，混进本纪的时间轴语义上是错的，故独立成卷。

   本组件只读既有数据源投影，除「修史」外不写任何 store、不花 API。
════════════════════════════════════════════ */

const TIER_STYLE: Record<ChronicleTier, { dot: string; text: string; ring: string }> = {
  gold:   { dot: 'bg-amber-400',   text: 'text-amber-200',   ring: 'border-amber-400/40' },
  silver: { dot: 'bg-slate-300',   text: 'text-slate-200',   ring: 'border-edge' },
  gray:   { dot: 'bg-dim/40',      text: 'text-dim/70',      ring: 'border-edge/50' },
};
const KIND_ICON: Record<string, string> = {
  worldEnter: '🚪', worldLeave: '🏁', chronicleRow: '·', keyEvent: '⭐', outcome: '🕮',
  deed: '👤', questSettle: '📋', monument: '🪦', compiled: '✒',
};

export default function ChroniclePanel({ onClose, onCompile, onOpenNpc }: {
  onClose: () => void;
  onCompile: (volumeId: string) => Promise<{ ok: boolean; error?: string; count?: number }>;
  onOpenNpc?: (npcId: string) => void;
}) {
  const [view, setView] = useState<'annals' | 'past'>('annals');

  return (
    <div className="fixed inset-0 z-[65] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-5xl h-[88dvh] rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col">
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-edge bg-panel">
          <span className="text-lg">📜</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-100">编年史</div>
            <div className="text-[12px] font-mono text-dim/50">当朝为实录 · 前朝方有正史</div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setView('annals')}
              className={`px-2.5 py-1 rounded-lg border text-[12px] font-bold transition-colors ${view === 'annals' ? 'border-amber-400/60 bg-amber-400/15 text-amber-200' : 'border-edge text-dim hover:text-slate-200 hover:border-amber-400/40'}`}>📖 本纪</button>
            <button onClick={() => setView('past')}
              className={`px-2.5 py-1 rounded-lg border text-[12px] font-bold transition-colors ${view === 'past' ? 'border-god/60 bg-god/15 text-god' : 'border-edge text-dim hover:text-slate-200 hover:border-god/40'}`}>🪦 前尘</button>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg ml-2">✕</button>
        </header>

        {view === 'annals' ? <AnnalsView onCompile={onCompile} onOpenNpc={onOpenNpc} /> : <PastLivesView />}
      </div>
    </div>
  );
}

/* ══ 本纪：当前存档 ══════════════════════════════════════ */

function AnnalsView({ onCompile, onOpenNpc }: {
  onCompile: (volumeId: string) => Promise<{ ok: boolean; error?: string; count?: number }>;
  onOpenNpc?: (npcId: string) => void;
}) {
  const tables    = useTables((s) => s.tables);
  const rowMeta   = useChronicle((s) => s.rowMeta);
  const compiled  = useChronicle((s) => s.compiled);
  const records   = useWorldRecord((s) => s.records);
  const archived  = useMisc((s) => s.archivedTasks);
  const worldName = useMisc((s) => s.worldName);
  const npcs      = useNpc((s) => s.npcs);
  const factions  = useFaction((s) => s.factions);
  const profile   = usePlayer((s) => s.profile);

  const [openVol, setOpenVol]   = useState<string | null>(null);
  const [showGray, setShowGray] = useState(false);
  const [busyVol, setBusyVol]   = useState('');
  const [err, setErr]           = useState('');
  const [done, setDone]         = useState('');

  const volumes = useMemo(() => buildVolumes({
    rows: useTables.getState().rows('chronicle') as any,
    rowMeta,
    records,
    archivedTasks: archived as any,
    deeds: [
      { owner: profile.name || '主角', ownerId: 'B1', log: profile.deedLog ?? [] },
      ...Object.values(npcs).filter((n) => (n.deedLog?.length ?? 0) > 0).map((n) => ({ owner: n.name || n.id, ownerId: n.id, log: n.deedLog ?? [] })),
    ],
    known: {
      npcs: Object.values(npcs).filter((n) => (n.name || '').trim()).map((n) => ({ id: n.id, name: n.name })),
      factions: Object.values(factions ?? {}).filter((f: any) => (f?.name || '').trim()).map((f: any) => ({ id: f.id, name: f.name })),
      playerName: profile.name,
    },
    compiledIds: Object.keys(compiled),
    currentWorld: worldName,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tables, rowMeta, records, archived, npcs, factions, profile, compiled, worldName]);

  const overall = useMemo(() => overallDigest(volumes), [volumes]);

  async function doCompile(volId: string) {
    if (busyVol) return;
    setBusyVol(volId); setErr(''); setDone('');
    try {
      const r = await onCompile(volId);
      if (r.ok) setDone(`✒ 已修成正史，共 ${r.count} 条`);
      else setErr(r.error ?? '修史失败');
    } finally { setBusyVol(''); }
  }

  if (!volumes.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-6">
        <div className="text-3xl opacity-30">📜</div>
        <div className="text-[13px] text-dim/60">史册还是空的。</div>
        <div className="text-[11.5px] text-dim/40 leading-relaxed max-w-sm">
          编年史读的是【纪要表】与【世界记录】。进入一个世界、让剧情推进几个回合后，这里就会有内容。
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
      {/* 全史概览 */}
      <div className="rounded-xl border border-edge bg-void p-3">
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {overall.map((d, i) => (
            <span key={i} className="text-[12px] font-mono">
              <span className="text-dim/45">{d.icon} {d.label}</span>
              <span className="text-slate-200 ml-1.5">{d.value}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-mono text-dim/45">{volumes.length} 卷 · 新卷在前</span>
        <label className="flex items-center gap-1.5 text-[11px] font-mono text-dim/50 cursor-pointer select-none">
          <input type="checkbox" checked={showGray} onChange={(e) => setShowGray(e.target.checked)} className="accent-amber-400" />
          显示日常流水
        </label>
      </div>
      {err && <div className="text-[12px] font-mono text-blood/80 text-center">{err}</div>}
      {done && <div className="text-[12px] font-mono text-emerald-300/90 text-center">{done}</div>}

      {volumes.map((v) => {
        const open = openVol === v.id;
        const isCompiled = !!compiled[v.id];
        const cv = compiled[v.id];
        // 已修正史 → 显示正史；否则显示实录（金银恒显，灰按开关）
        const shown: ChronicleEvent[] = isCompiled
          ? compiledToEvents(cv.entries, v.id, v.world)
          : v.events;
        const visible = shown.filter((e) => showGray || e.tier !== 'gray');
        const hiddenCount = shown.length - visible.length;
        const digest = digestVolume(v);

        return (
          <div key={v.id} className={`rounded-xl border bg-void overflow-hidden ${v.status === 'active' ? 'border-god/40' : v.id === ORPHAN_VOLUME ? 'border-edge/40' : 'border-edge'}`}>
            {/* 卷首 */}
            <button onClick={() => setOpenVol(open ? null : v.id)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-panel2/40 transition-colors">
              <span className="text-base shrink-0">{v.id === ORPHAN_VOLUME ? '🗂' : v.status === 'active' ? '📖' : '📕'}</span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-bold text-slate-100 truncate">{v.world}</span>
                  {v.instanceId && v.instanceId > 1 && <span className="text-[10px] font-mono text-dim/45">第 {v.instanceId} 次</span>}
                  {v.tier && <span className="text-[10px] font-mono text-purple-300/60">{v.tier}</span>}
                  {v.status === 'active' && <span className="text-[10px] font-mono text-god/70">进行中</span>}
                  {isCompiled
                    ? <span className="text-[10px] font-mono text-amber-300/80 px-1.5 py-0.5 rounded border border-amber-400/35">✒ 正史</span>
                    : <span className="text-[10px] font-mono text-dim/45 px-1.5 py-0.5 rounded border border-edge">实录</span>}
                </span>
                <span className="block text-[11px] font-mono text-dim/40 mt-0.5">
                  {typeof v.enterTurn === 'number' ? `T${v.enterTurn}` : '—'}
                  {typeof v.leaveTurn === 'number' ? ` → T${v.leaveTurn}` : v.status === 'active' ? ' → 今' : ''}
                  {' · '}{shown.length} 条史事
                  {v.rating ? ` · 评价 ${v.rating}` : ''}
                </span>
              </span>
              <span className="text-dim/40 text-sm shrink-0">{open ? '▾' : '▸'}</span>
            </button>

            {open && (
              <div className="border-t border-edge/60 p-3 space-y-2.5">
                {/* 卷首题记（正史才有） */}
                {isCompiled && cv.preface && (
                  <div className="text-[12.5px] text-amber-100/80 italic leading-relaxed border-l-2 border-amber-400/40 pl-2.5">{cv.preface}</div>
                )}

                {/* 本卷之最 */}
                {digest.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-edge/50 bg-panel2/30 px-2.5 py-2">
                    {digest.map((d, i) => (
                      <span key={i} className="text-[11.5px] font-mono">
                        <span className="text-dim/45">{d.icon} {d.label}</span>
                        <span className="text-slate-200/90 ml-1.5">{d.value}</span>
                      </span>
                    ))}
                  </div>
                )}

                {/* 修史 / 重修 */}
                {v.id !== ORPHAN_VOLUME && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => doCompile(v.id)} disabled={!!busyVol}
                      className="px-2.5 py-1 rounded-lg border border-amber-400/45 text-amber-200 text-[11.5px] font-bold hover:bg-amber-400/10 disabled:opacity-40">
                      {busyVol === v.id ? '✒ 修史中…' : isCompiled ? '✒ 重修此卷' : '✒ 修史（AI 删繁就简）'}
                    </button>
                    {isCompiled && (
                      <span className="text-[10.5px] font-mono text-dim/40">
                        由 {cv.sourceCount ?? '?'} 条实录编纂为 {cv.entries.length} 条
                      </span>
                    )}
                    {v.status === 'active' && !isCompiled && (
                      <span className="text-[10.5px] font-mono text-dim/40">（本卷尚在进行，通常离世后再修史）</span>
                    )}
                  </div>
                )}

                {/* 史事时间轴 */}
                {visible.length === 0 ? (
                  <div className="text-[12px] text-dim/35 py-2">
                    这一卷暂无{showGray ? '' : '重要'}史事{hiddenCount > 0 ? `（另有 ${hiddenCount} 条日常，勾选上方开关查看）` : ''}。
                  </div>
                ) : (
                  <ol className="relative space-y-2 pl-4 border-l border-edge/60">
                    {visible.map((e) => {
                      const st = TIER_STYLE[e.tier];
                      return (
                        <li key={e.id} className="relative">
                          <span className={`absolute -left-[21px] top-1.5 w-2 h-2 rounded-full ${st.dot}`} />
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-[10px] font-mono text-dim/35 shrink-0">{KIND_ICON[e.kind] ?? '·'}</span>
                            {e.timeText && <span className="text-[10.5px] font-mono text-dim/45 shrink-0">{e.timeText}</span>}
                            {e.location && <span className="text-[10.5px] font-mono text-dim/30 shrink-0">@{e.location}</span>}
                            {e.tier === 'gold' && <span className="text-[9.5px] font-mono text-amber-300/60 shrink-0">{TIER_LABEL.gold}</span>}
                          </div>
                          <div className={`text-[13px] leading-relaxed ${st.text}`}>{e.title}</div>
                          {e.detail && e.detail !== e.title && (
                            <div className="text-[11.5px] text-dim/55 leading-snug mt-0.5">{e.detail}</div>
                          )}
                          {/* 互链：点人名跳 NPC 详情 */}
                          {!!e.entities?.length && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {e.entities.map((en, k) => (
                                <button key={k}
                                  onClick={() => { if (en.type === 'npc' && en.id && onOpenNpc) onOpenNpc(en.id); }}
                                  disabled={en.type !== 'npc' || !en.id || !onOpenNpc}
                                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                                    en.type === 'npc' && en.id && onOpenNpc
                                      ? 'border-god/30 text-god/70 hover:bg-god/10 hover:text-god cursor-pointer'
                                      : 'border-edge/50 text-dim/40 cursor-default'}`}>
                                  {en.type === 'npc' ? '👤' : en.type === 'faction' ? '🏛' : en.type === 'world' ? '🌐' : '★'}{en.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
                {hiddenCount > 0 && visible.length > 0 && (
                  <div className="text-[10.5px] font-mono text-dim/35 text-center">另有 {hiddenCount} 条日常流水已折叠</div>
                )}

                {/* 离世总结（现成的 WorldSummary，史料最密的一块） */}
                {v.summary && <SummaryBlock s={v.summary} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 离世总结渲染（把既有 WorldSummary 的 JSON 表单换成史书读法）。 */
function SummaryBlock({ s }: { s: NonNullable<ChronicleVolume['summary']> }) {
  const rows: [string, string][] = [];
  if (s.世界线偏转) rows.push(['世界线偏转', s.世界线偏转]);
  if (s.收获?.世界之源) rows.push(['世界之源', s.收获.世界之源]);
  if (s.收获?.货币) rows.push(['所得', s.收获.货币]);
  if (s.代价?.length) rows.push(['代价', s.代价.join('；')]);
  if (s.未了伏笔?.length) rows.push(['未了', s.未了伏笔.join('；')]);
  const gains = [...(s.收获?.装备 ?? []), ...(s.收获?.重要物品 ?? [])].filter(Boolean);

  return (
    <div className="rounded-lg border border-edge/60 bg-panel2/25 p-2.5 space-y-1.5">
      <div className="text-[11px] font-mono text-dim/45">🏁 离世总结</div>
      {!!s.经历概述?.length && (
        <ul className="space-y-0.5">
          {s.经历概述.map((t, i) => <li key={i} className="text-[12px] text-slate-300/85 leading-snug">· {t}</li>)}
        </ul>
      )}
      {rows.map(([k, val], i) => (
        <div key={i} className="text-[11.5px] leading-snug">
          <span className="font-mono text-dim/45">{k}　</span>
          <span className="text-slate-300/80">{val}</span>
        </div>
      ))}
      {!!gains.length && (
        <div className="text-[11.5px] leading-snug">
          <span className="font-mono text-dim/45">携出　</span>
          <span className="text-amber-200/80">{gains.join('、')}</span>
        </div>
      )}
    </div>
  );
}

/* ══ 前尘：历代主角（跨存档）══════════════════════════════ */

function PastLivesView() {
  const entries = useMonument((s) => s.entries);
  const list = useMemo(
    () => Object.values(entries).sort((a, b) => (b.enshrinedAt ?? 0) - (a.enshrinedAt ?? 0)),
    [entries],
  );
  const [openId, setOpenId] = useState<string | null>(null);

  if (!list.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-6">
        <div className="text-3xl opacity-30">🪦</div>
        <div className="text-[13px] text-dim/60">还没有立过碑。</div>
        <div className="text-[11.5px] text-dim/40 leading-relaxed max-w-sm">
          主角陨落或一周目终结时可入丰碑。丰碑是**账号级**的，跨存档、跨新局常驻 —— 这里是历代主角的列传。
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      <div className="rounded-xl border border-edge bg-void px-3 py-2 text-[11.5px] font-mono text-dim/50">
        🪦 共 {list.length} 位 · 跨存档常驻（回合号来自各自的存档，故不与本纪并轴）
      </div>
      {list.map((e) => {
        const open = openId === e.id;
        const snap: any = e.snapshot ?? {};
        return (
          <div key={e.id} className="rounded-xl border border-edge bg-void overflow-hidden">
            <button onClick={() => setOpenId(open ? null : e.id)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-panel2/40 transition-colors">
              <span className="text-base shrink-0">🪦</span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-bold text-slate-100 truncate">{snap.name || '无名者'}</span>
                  {snap.tier && <span className="text-[10px] font-mono text-purple-300/60">{snap.tier}</span>}
                  {snap.origin === 'npc' && <span className="text-[10px] font-mono text-dim/45">随从</span>}
                </span>
                <span className="block text-[11px] font-mono text-dim/40 mt-0.5">
                  {e.world || '—'}
                  {typeof e.turn === 'number' ? ` · 历 ${e.turn} 回合` : ''}
                  {e.enshrinedAt ? ` · ${new Date(e.enshrinedAt).toLocaleDateString()}` : ''}
                </span>
              </span>
              <span className="text-dim/40 text-sm shrink-0">{open ? '▾' : '▸'}</span>
            </button>
            {open && (
              <div className="border-t border-edge/60 p-3 space-y-2">
                {e.eulogy && <div className="text-[12.5px] text-amber-100/80 italic leading-relaxed border-l-2 border-amber-400/40 pl-2.5">{e.eulogy}</div>}
                {e.eulogyStatus === 'pending' && <div className="text-[11px] font-mono text-dim/40">碑文生成中…</div>}
                {e.summary && <div className="text-[12px] text-slate-300/85 leading-relaxed">{e.summary}</div>}
                {!!(snap.deedLog?.length) && (
                  <ol className="relative space-y-1.5 pl-4 border-l border-edge/60 mt-2">
                    {snap.deedLog.slice(-30).map((d: any, i: number) => (
                      <li key={i} className="relative">
                        <span className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-dim/40" />
                        {(d.time || d.location) && (
                          <div className="text-[10.5px] font-mono text-dim/40">{d.time}{d.location ? ` @${d.location}` : ''}</div>
                        )}
                        <div className="text-[12.5px] text-slate-300/85 leading-snug">{d.description}</div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
