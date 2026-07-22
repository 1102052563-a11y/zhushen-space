import { useState } from 'react';
import { useCanonRoute } from '../store/canonRouteStore';
import { useNpc } from '../store/npcStore';
import { CANON_STATIONS, CANON_ROUTE_META, CANON_SUXIAO } from '../data/canonRoute';
import { stationToWorldOption, upsertSuxiaoNpc, ensureQuestRelation } from '../systems/canonRoute';
import type { WorldOption } from './WorldSelector';

/* 🛤 原著路线 · 路线图：按原著顺序陈列苏晓走过的任务世界。
   当前站可进入；已通关站盖章并与白夜成绩同框；未来站上锁。 */

const SUXIAO_CHIP: Record<string, { label: string; cls: string }> = {
  'on-track': { label: '🟢 苏晓：按原著轨道行动中', cls: 'border-emerald-400/40 text-emerald-300' },
  derailed:   { label: '🌀 苏晓：已脱轨·自由演化', cls: 'border-amber-400/40 text-amber-300' },
  dead:       { label: '☠ 苏晓：已陨落', cls: 'border-blood/50 text-blood' },
  allied:     { label: '🤝 苏晓：与你同盟', cls: 'border-sky-400/40 text-sky-300' },
};

export default function CanonRoutePanel({ onClose, onEnterWorld, onDmSuxiao }: {
  onClose: () => void;
  onEnterWorld: (w: WorldOption) => void;
  onDmSuxiao?: () => void;   // 💬 一键私信白夜（App 里建档+开 DM 面板）
}) {
  const stationIndex = useCanonRoute((s) => s.stationIndex);
  const progress = useCanonRoute((s) => s.stations);
  const suxiao = useCanonRoute((s) => s.suxiao);
  const divergence = useCanonRoute((s) => s.divergence);
  const enterStation = useCanonRoute((s) => s.enterStation);
  const advance = useCanonRoute((s) => s.advance);
  const suxiaoNpc = useNpc((s) => (suxiao.npcId ? s.npcs[suxiao.npcId] : undefined));
  const [expandedId, setExpandedId] = useState<string | null>(CANON_STATIONS[stationIndex]?.id ?? null);

  const chip = SUXIAO_CHIP[suxiao.state] ?? SUXIAO_CHIP['on-track'];
  const curCleared = !!progress[CANON_STATIONS[stationIndex]?.id ?? '']?.cleared;
  const hasNext = stationIndex + 1 < CANON_STATIONS.length;
  // 📜 收集册总进度（原著支线/隐藏/猎杀复刻）
  const clTotal = CANON_STATIONS.reduce((a, s) => a + (s.world.sideMissions?.length ?? 0) + (s.world.triggerQuests?.length ?? 0), 0);
  const clDone = CANON_STATIONS.reduce((a, s) => a + (progress[s.id]?.checklist?.length ?? 0), 0);

  function toggleFriend() {
    const N = useNpc.getState();
    const id = suxiao.npcId && N.npcs[suxiao.npcId] ? suxiao.npcId : upsertSuxiaoNpc(stationIndex);
    if (id) N.setFriend(id, !N.npcs[id]?.isFriend);
  }

  function enter(idx: number) {
    const s = CANON_STATIONS[idx];
    if (!s) return;
    if (!confirm(`进入第 ${s.order} 站【${s.name}】？\n（将以原著时间点切入，由乐园发布你的专属主线）`)) return;
    enterStation(idx);
    ensureQuestRelation(idx);   // 掷定本站与白夜的任务关系（协同/对立/无关·全站固定），入世界卡与每回合注入
    upsertSuxiaoNpc(idx);   // 苏晓（白夜）建/更新档案：本站入场数值查表锁死，离场待剧情登场
    onEnterWorld(stationToWorldOption(s));
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[92dvh] flex flex-col bg-panel border border-edge rounded-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* 头 */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-edge">
          <span className="text-god font-bold">🛤 原著路线</span>
          <span className="text-[11px] font-mono text-dim">苏晓的足迹 · 已收录 {CANON_STATIONS.length} 站 / 全程 {CANON_ROUTE_META.totalNavWorlds} 站</span>
          <span className="shrink-0 px-2 py-0.5 rounded-full border border-emerald-400/40 text-emerald-300 text-[11px] font-mono" title="原著对照收集册：复刻原著支线/隐藏/猎杀的总进度">📜 {clDone}/{clTotal}</span>
          <span className={`ml-auto shrink-0 px-2 py-0.5 rounded-full border text-[11px] font-mono ${chip.cls}`}>{chip.label}</span>
          <button onClick={onClose} className="shrink-0 px-2 text-dim hover:text-slate-200 text-lg leading-none">×</button>
        </div>

        {/* 当前站偏差度 */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-edge/60 text-[11px] font-mono text-dim">
          <span>当前站偏差度</span>
          <div className="flex-1 h-1.5 rounded bg-void overflow-hidden"><div className="h-full bg-amber-400/70" style={{ width: `${divergence}%` }} /></div>
          <span className="w-9 text-right">{divergence}%</span>
          <span className="text-dim/50 max-sm:hidden">（只记录不惩罚：低=原著见证者 · 高=命运改写者）</span>
        </div>

        {/* 站点列表 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {CANON_STATIONS.map((s, i) => {
            const p = progress[s.id];
            const isCur = i === stationIndex;
            const locked = i > stationIndex;
            const open = expandedId === s.id;
            const canonRef = [s.suxiao.settle?.sourcePct != null ? `${s.suxiao.settle.sourcePct}%` : '', s.suxiao.settle?.rating || ''].filter(Boolean).join(' · ');
            return (
              <div key={s.id} className={`border rounded-lg transition-colors ${isCur ? 'border-god/60 bg-god/5' : p?.cleared ? 'border-emerald-400/30 bg-emerald-400/5' : 'border-edge bg-void/40'} ${locked ? 'opacity-45' : ''}`}>
                <button className="w-full flex items-center gap-2.5 px-3 py-2 text-left" onClick={() => setExpandedId(open ? null : s.id)}>
                  <span className={`shrink-0 w-7 h-7 rounded-full border flex items-center justify-center text-[12px] font-mono ${isCur ? 'border-god/70 text-god' : p?.cleared ? 'border-emerald-400/50 text-emerald-300' : 'border-edge text-dim'}`}>
                    {p?.cleared ? '🏁' : locked ? '🔒' : s.order}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block truncate text-sm ${isCur ? 'text-god' : 'text-slate-200'}`}>{s.name}</span>
                    <span className="block text-[11px] font-mono text-dim truncate">{s.stationType} · 第{s.volume}卷 · 荐{s.recommendedTier}{isCur ? ' · 当前站' : ''}</span>
                  </span>
                  {p?.cleared && (
                    <span className="shrink-0 text-[11px] font-mono text-emerald-300 text-right leading-tight">
                      你 {[p.sourcePct != null ? `${p.sourcePct}%` : '', p.rating || ''].filter(Boolean).join(' · ') || '通关'}{p.beatCanon ? ' 🏆' : ''}
                      <br /><span className="text-dim">白夜 {canonRef || '—'}</span>
                    </span>
                  )}
                  {!p?.cleared && !locked && canonRef && (
                    <span className="shrink-0 text-[11px] font-mono text-dim text-right leading-tight">白夜基准<br />{canonRef}</span>
                  )}
                  <span className={`shrink-0 text-dim/60 text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
                </button>
                {open && (
                  <div className="px-3 pb-3 pt-1 space-y-2 text-[12px] leading-relaxed text-slate-300 border-t border-edge/50">
                    <p className="whitespace-pre-wrap text-dim">{s.world.desc}</p>
                    {s.world.era && <p><span className="text-god/70 font-mono">⏳ 切入时点：</span>{s.world.era}</p>}
                    {s.world.rules && <p className="whitespace-pre-wrap"><span className="text-blood/80 font-mono">⚠ 世界规则：</span>{s.world.rules}</p>}
                    {s.world.mainMission && <p><span className="text-amber-300/80 font-mono">🎯 原著主线（苏晓的任务·参照）：</span>{s.world.mainMission}</p>}
                    {p?.questRelation && (
                      <p><span className="text-fuchsia-300/80 font-mono">⚔ 与白夜的任务关系：</span>
                        <span className={p.questRelation === '对立' ? 'text-blood' : p.questRelation === '协同' ? 'text-emerald-300' : 'text-dim'}>{p.questRelation}</span>
                      </p>
                    )}
                    {(s.world.sideMissions?.length || s.world.triggerQuests?.length) ? (
                      <div><span className="text-emerald-300/80 font-mono">📜 原著对照收集册（复刻原著支线/隐藏/猎杀即打勾）：</span>
                        <ul className="pl-5 space-y-0.5">
                          {[...(s.world.sideMissions ?? []), ...(s.world.triggerQuests ?? [])].map((it, k) => {
                            const done = p?.checklist?.includes(it);
                            return <li key={k} className={done ? 'text-emerald-300' : 'text-dim/80'}>{done ? '✅' : '☐'} {it.length > 48 ? it.slice(0, 47) + '…' : it}</li>;
                          })}
                        </ul>
                      </div>
                    ) : null}
                    {p?.encounters?.length ? (
                      <div><span className="text-sky-300/80 font-mono">🤝 与苏晓的交集：</span>
                        <ul className="list-disc pl-5 text-dim">{p.encounters.map((e, k) => <li key={k}>{e}</li>)}</ul>
                      </div>
                    ) : null}
                    {isCur && (
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => enter(i)} className="px-3 py-1.5 rounded border border-god/50 bg-god/15 text-god font-bold hover:bg-god/25 transition-colors">🚪 进入本站世界</button>
                        {curCleared && hasNext && (
                          <button onClick={() => { advance(); setExpandedId(CANON_STATIONS[stationIndex + 1]?.id ?? null); }}
                            className="px-3 py-1.5 rounded border border-emerald-400/50 text-emerald-300 hover:bg-emerald-400/10 transition-colors">→ 前往下一站</button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-[11px] font-mono text-dim/60 px-1 pt-1">
            ……路线全程 {CANON_ROUTE_META.totalNavWorlds} 站；后续站点随轮回 wiki 阅读进度更新（重跑 build-canon-route 即扩展）。
          </p>
        </div>

        {/* 脚：苏晓人设一瞥 + 私信/好友入口 */}
        <div className="shrink-0 px-4 py-2.5 border-t border-edge text-[11px] leading-relaxed text-dim/80 bg-void/40">
          <div className="flex items-center gap-2 flex-wrap pb-1">
            <span className="text-god/70 font-mono">「{CANON_SUXIAO.defaultAlias}」·{CANON_SUXIAO.name}</span>
            {suxiao.state !== 'dead' ? (
              <>
                {onDmSuxiao && (
                  <button onClick={onDmSuxiao} title="打开与白夜的私信（可聊天/交易/讨价还价）"
                    className="px-2 py-0.5 rounded border border-sky-400/40 text-sky-300 hover:bg-sky-400/10 transition-colors font-mono">💬 私信白夜</button>
                )}
                <button onClick={toggleFriend} title="加入好友栏后，白夜每回合参与 NPC 演化调度"
                  className={`px-2 py-0.5 rounded border font-mono transition-colors ${suxiaoNpc?.isFriend ? 'border-amber-300/50 text-amber-300 hover:bg-amber-300/10' : 'border-edge text-dim hover:border-god/40 hover:text-god'}`}>
                  {suxiaoNpc?.isFriend ? '⭐ 已是好友' : '☆ 加为好友'}
                </button>
              </>
            ) : <span className="text-blood/80 font-mono">☠ 已陨落</span>}
          </div>
          {CANON_SUXIAO.persona.split('\n')[0]}
        </div>
      </div>
    </div>
  );
}
