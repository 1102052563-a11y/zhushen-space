import { useState } from 'react';
import { useTeam, memberCap, ACTIVITY_GATE, type TeamRank } from '../store/adventureTeamStore';
import { useNpc } from '../store/npcStore';
import NpcDetail from './NpcDetail';

const RANK_CLS: Record<TeamRank, string> = {
  E: 'text-zinc-300 border-zinc-500/50', D: 'text-emerald-300 border-emerald-500/50',
  C: 'text-sky-300 border-sky-500/50', B: 'text-violet-300 border-violet-500/50',
  A: 'text-amber-300 border-amber-500/50', S: 'text-orange-300 border-orange-500/60',
  SS: 'text-rose-300 border-rose-500/60', SSS: 'text-fuchsia-300 border-fuchsia-500/70',
};

function Bar({ value, max = 100, cls, label }: { value: number; max?: number; cls: string; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-mono text-dim/60 mb-1">
        <span>{label}</span><span>{value}/{max}</span>
      </div>
      <div className="h-2 rounded-full bg-void border border-edge overflow-hidden">
        <div className={`h-full ${cls}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AdventureTeamPanel({ onClose }: { onClose: () => void }) {
  const T = useTeam();
  const npcs = useNpc((s) => s.npcs);
  const [npcDetailId, setNpcDetailId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);   // 退出冒险团二次确认

  const cap = memberCap(T.rank);
  const a = T.assessment;
  const joined = !!T.leaderId && T.leaderId !== 'B1';   // 加入他人冒险团（主角非团长）
  const leaderRec = joined && T.leaderId.startsWith('C') ? npcs[T.leaderId] : undefined;

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-2xl max-h-[88dvh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between p-4 border-b border-edge shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">🛡</span>
            <h2 className="text-base font-bold text-slate-100">冒险团</h2>
            {T.established && <span className="text-[13px] font-mono text-dim/50">{T.name || '（未命名）'}</span>}
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
        </header>

        {!T.established ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="text-center text-dim/40 text-sm py-12 leading-relaxed">
              {T.disbanded ? '冒险团已解散。' : '尚未建立冒险团。'}<br />
              开启「设置→变量管理→🛡 冒险团演化」后，当正文中主角**明确建立永久冒险团**时会自动建团并进入建团试炼。
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">

            {/* 概况：阶位徽章 + 双进度条 */}
            <section className="rounded-lg border border-edge bg-panel p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-bold text-slate-100">{T.name || '（未命名）'}{joined && <span className="text-amber-300/80 text-[11px] ml-2 font-mono">已加入·非团长</span>}{T.disbanded && <span className="text-blood/80 text-[12px] ml-2">已解散</span>}</div>
                <div className={`text-base font-bold font-mono px-2.5 py-0.5 rounded-lg border ${RANK_CLS[T.rank]}`}>{T.rank} 阶</div>
              </div>
              <Bar value={T.teamExp} cls="bg-gradient-to-r from-cyan-600/70 to-cyan-400/80" label="团队经验" />
              <Bar value={T.activity} cls={T.activity >= ACTIVITY_GATE ? 'bg-gradient-to-r from-emerald-600/70 to-emerald-400/80' : 'bg-gradient-to-r from-amber-700/70 to-amber-500/70'} label={`活跃度（晋级需 ≥${ACTIVITY_GATE}）`} />
              {joined && (
                confirmLeave ? (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[12px] text-blood/80 mr-auto">退出后将离开「{T.name || '该冒险团'}」，确定？</span>
                    <button onClick={() => { T.clearTeam(); onClose(); }} className="px-3 py-1 rounded-lg border border-blood/50 bg-blood/15 text-blood text-[12px] font-mono hover:bg-blood/25 transition-colors">确认退出</button>
                    <button onClick={() => setConfirmLeave(false)} className="px-3 py-1 rounded-lg border border-edge text-dim/70 text-[12px] font-mono hover:text-slate-200 transition-colors">取消</button>
                  </div>
                ) : (
                  <div className="flex justify-end pt-1">
                    <button onClick={() => setConfirmLeave(true)} className="px-3 py-1 rounded-lg border border-blood/40 text-blood/80 text-[12px] font-mono hover:bg-blood/15 transition-colors">🚪 退出冒险团</button>
                  </div>
                )
              )}
            </section>

            {/* 考核试炼横幅 */}
            {a.pending && (
              <div className="rounded-lg border border-orange-600/50 bg-orange-900/20 px-3 py-2.5">
                <div className="text-[13px] font-bold text-orange-300">⚔ 考核试炼{a.isEstablish ? '·建团' : `·晋阶 →${a.targetRank}`}</div>
                <div className="text-[12px] text-orange-200/80 mt-1 leading-relaxed">
                  {a.note || ''}　需进入【冒险团考核世界】完成试炼。状态：{a.status}。<br />
                  危险度极高，失败将减员、惨败则解散。
                </div>
              </div>
            )}
            {!a.pending && a.status === 'failed' && (
              <div className="rounded-lg border border-blood/40 bg-blood/10 px-3 py-2 text-[12px] text-blood/90">上次考核失败{a.note ? `：${a.note}` : ''}</div>
            )}

            {/* 成员 */}
            <Section title="团队成员" count={`${T.members.length}/${cap}`}>
              <div className="flex flex-wrap gap-2">
                {joined ? (
                  leaderRec
                    ? <button onClick={() => setNpcDetailId(T.leaderId)} className="px-2.5 py-1.5 rounded-lg border border-amber-500/50 text-amber-300 text-[13px] font-mono hover:bg-amber-900/20 transition-colors">{T.leaderId}·{leaderRec.name}（团长）</button>
                    : <span className="px-2.5 py-1.5 rounded-lg border border-amber-500/40 text-amber-300 text-[13px] font-mono">{T.leaderName || '团长'}（团长）</span>
                ) : (
                  <span className="px-2.5 py-1.5 rounded-lg border border-god/40 text-god text-[13px] font-mono">B1·团长（主角）</span>
                )}
                {T.members.filter((m) => !(m.id && m.id === T.leaderId)).map((m, i) => {
                  if (m.id === 'B1') {
                    return <span key="B1" className="px-2.5 py-1.5 rounded-lg border border-god/40 text-god text-[13px] font-mono">B1·主角{m.role ? <span className="text-god/70">（{m.role}）</span> : null}</span>;
                  }
                  const rec = m.id ? npcs[m.id] : undefined;
                  const label = m.id || m.name || '?';
                  return (
                    <button key={m.id || `${m.name}_${i}`} onClick={() => rec && m.id && setNpcDetailId(m.id)}
                      className={`px-2.5 py-1.5 rounded-lg border text-[13px] font-mono transition-colors ${rec ? 'border-violet-700/50 text-violet-300 hover:bg-violet-900/20' : 'border-edge text-dim/50'}`}>
                      <span>{label}</span>
                      {rec?.name && rec.name !== m.id && <span className="text-slate-200">·{rec.name}</span>}
                      {!rec && m.name && m.id && <span className="text-slate-200">·{m.name}</span>}
                      {m.tier && <span className="text-dim/40"> {m.tier}</span>}
                      {m.role && <span className="text-dim/60">（{m.role}）</span>}
                    </button>
                  );
                })}
              </div>
            </Section>

            {/* 团队效果/权限 */}
            <Section title="团队效果 / 权限" count={T.perks.length}>
              {T.perks.length === 0 ? <Empty text="（暂无团队效果）" /> : (
                <div className="space-y-1.5">{T.perks.map((p) => (
                  <div key={p.name} className="rounded border border-edge bg-void/60 px-2.5 py-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] text-cyan-300 font-mono">{p.name}</span>
                      {p.source && <span className="text-[11px] text-dim/40 font-mono">来自 {p.source}</span>}
                    </div>
                    {p.desc && <div className="text-[12px] text-dim/80 mt-0.5">{p.desc}</div>}
                  </div>
                ))}</div>
              )}
            </Section>

            {/* 大事记 */}
            <Section title="团队大事记" count={T.deeds.length}>
              {T.deeds.length === 0 ? <Empty text="（暂无）" /> : (
                <div className="space-y-1">{[...T.deeds].reverse().map((d, i) => (
                  <div key={i} className="text-[12px] text-dim/80 border-l-2 border-edge/50 pl-2">
                    {(d.time || d.location) && <span className="text-dim/40 font-mono mr-1.5">{[d.time, d.location].filter(Boolean).join('·')}</span>}
                    {d.description}
                  </div>
                ))}</div>
              )}
            </Section>
          </div>
        )}
      </div>
    </div>

      {/* NPC 详情独立于本面板的背景遮罩之外渲染：关闭它不会冒泡触发冒险团面板的 onClose（留在冒险团面板）*/}
      {npcDetailId && npcs[npcDetailId] && (
        <NpcDetail npc={npcs[npcDetailId]} list={Object.values(npcs)} onClose={() => setNpcDetailId(null)} onSelect={(id) => setNpcDetailId(id)} />
      )}
    </>
  );
}

function Section({ title, count, children }: { title: string; count: number | string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-mono text-dim/70">{title}</span>
        <span className="text-[11px] font-mono text-dim/40">{count}</span>
      </div>
      {children}
    </section>
  );
}
function Empty({ text }: { text: string }) { return <div className="text-[12px] text-dim/35 font-mono px-1 py-1">{text}</div>; }
