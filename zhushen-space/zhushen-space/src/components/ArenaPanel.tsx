import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayer } from '../store/playerStore';
import { useArena } from '../store/arenaStore';
import { useMisc } from '../store/miscStore';
import {
  arenasForTier, inParadise, tierIndex, seedPlayerRank, effectiveTier,
  buildHomeRanks, buildWindowRanks, reserveSeatNotice, ladderBadge, normalArenaId,
  type ArenaDef, type LadderEntry,
} from '../systems/arena';

/* 竞技场面板：阶位分支 → 选竞技场 → 排行榜（带记忆缓存）→ 自选名次 → 挑战（建档+进战斗）。
   AI 调用由 App 通过 onGenerateLadder / onChallenge 注入；本面板只管 UI 与 store。 */

export default function ArenaPanel({ onClose, onGenerateLadder, onChallenge }: {
  onClose: () => void;
  onGenerateLadder: (arenaId: string, def: ArenaDef, ranks: number[], windowKey: string) => Promise<void>;
  onChallenge: (def: ArenaDef, entry: LadderEntry) => Promise<void>;
}) {
  const rawTier = usePlayer((s) => s.profile.tier);
  const level = usePlayer((s) => s.profile.level);
  const tier = effectiveTier(rawTier, level);
  const playerName = usePlayer((s) => s.profile.name);
  const ladders = useArena((s) => s.ladders);
  const defeated = useArena((s) => s.defeated);
  const enabled = useArena((s) => s.config.enabled);
  const worldName = useMisc((s) => s.worldName);

  const inHub = inParadise(worldName);
  const unlocked = enabled && inHub;
  const ti = tierIndex(tier);
  const champQualified = (ladders[normalArenaId(5)]?.bestRank ?? 99999) <= 50;
  const defs = useMemo(() => arenasForTier(tier, champQualified), [tier, champQualified]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [showDefeated, setShowDefeated] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [confirmEntry, setConfirmEntry] = useState<LadderEntry | null>(null);
  const busyRef = useRef(false);

  const def = defs.find((d) => d.id === selectedId) ?? null;
  const ladder = selectedId ? ladders[selectedId] : undefined;

  // 自动选第一个可进入的竞技场
  useEffect(() => {
    if (!selectedId && defs.length) setSelectedId((defs.find((d) => !d.locked) ?? defs[0]).id);
  }, [defs, selectedId]);

  async function run(msg: string, fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(msg);
    try { await fn(); } catch (e) { console.error('[Arena]', e); }
    finally { busyRef.current = false; setBusy(''); }
  }

  function loadHome(d: ArenaDef) {
    const seeded = useArena.getState().ensureLadder(d.id, seedPlayerRank(d));
    return run('正在生成排行榜…', () => onGenerateLadder(d.id, d, buildHomeRanks(seeded.playerRank, d.kind), 'home'));
  }
  function loadWindow(d: ArenaDef, target: number) {
    return run(`正在加载第 ${target} 名附近…`, () => onGenerateLadder(d.id, d, buildWindowRanks(target, d.kind), `t${target}`));
  }

  // 选定可进入竞技场且无缓存榜单 → 自动加载主榜
  useEffect(() => {
    if (!def || def.locked) return;
    const seeded = useArena.getState().ensureLadder(def.id, seedPlayerRank(def));
    if (seeded.entries.length === 0) void loadHome(def);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def?.id]);

  const sortedEntries = useMemo(
    () => (ladder?.entries ? [...ladder.entries].sort((a, b) => a.rank - b.rank) : []),
    [ladder?.entries],
  );
  const reserveNotice = def ? reserveSeatNotice(def.id, ti, ladder?.playerRank ?? 99999) : undefined;

  function doChallenge(entry: LadderEntry) {
    if (!def) return;
    setConfirmEntry(null);
    void run('正在生成对手并进入战斗…', async () => { await onChallenge(def, entry); onClose(); });
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-xl border border-cyan-500/30 bg-slate-900/95 shadow-2xl overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700/60 bg-slate-950/60">
          <span className="text-sm font-semibold text-slate-100">🏟 竞技场</span>
          <div className="flex items-center gap-2">
            {unlocked && (
              <button onClick={() => setShowDefeated((v) => !v)}
                className={`px-2.5 py-1 rounded text-xs border ${showDefeated ? 'bg-amber-600/80 border-amber-400 text-white' : 'border-slate-600 text-slate-300 hover:bg-slate-700'}`}>
                🏆 击败记录{defeated.length ? `(${defeated.length})` : ''}
              </button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-lg leading-none">✕</button>
          </div>
        </div>

        {/* 不可用：① 不在乐园内（任务世界中）② 设置里关掉了 */}
        {!unlocked && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12 gap-2">
            <div className="text-4xl opacity-60">🔒</div>
            {!enabled ? (
              <>
                <div className="text-slate-200 text-sm font-medium">竞技场已停用</div>
                <div className="text-slate-400 text-xs max-w-sm leading-relaxed">在「设置 → 变量管理 → 🏟竞技场」可重新开启。</div>
              </>
            ) : (
              <>
                <div className="text-slate-200 text-sm font-medium">需在乐园内才能使用竞技场</div>
                <div className="text-slate-400 text-xs max-w-sm leading-relaxed">
                  竞技场只在乐园（枢纽）内开放。你当前身处任务世界{worldName ? <>：<span className="text-slate-200">{worldName}</span></> : ''}，
                  返回乐园后即可进入竞技场。
                </div>
              </>
            )}
          </div>
        )}

        {/* 击败记录 */}
        {unlocked && showDefeated && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {defeated.length === 0 && <div className="text-slate-500 text-sm text-center py-10">还没有击败过任何对手。去排行榜挑战吧。</div>}
            {defeated.map((d) => (
              <div key={d.id} className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm text-slate-100">
                    <span className="text-amber-300">#{d.rank}</span> {d.name}
                    <span className="text-[10px] text-slate-400 ml-2">{d.tier}{d.job ? ` · ${d.job}` : ''}{d.strength ? ` · ${d.strength}` : ''}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 shrink-0">{d.arenaName}</span>
                </div>
                {d.summary && <div className="text-[11px] text-slate-300/90 mt-1 leading-snug">{d.summary}</div>}
                {d.reward && <div className="text-[11px] text-emerald-300/90 mt-1">🎁 {d.reward}</div>}
              </div>
            ))}
          </div>
        )}

        {/* 竞技场主体 */}
        {unlocked && !showDefeated && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 竞技场卡片选择 */}
            <div className="flex gap-2 p-3 border-b border-slate-800 overflow-x-auto shrink-0">
              {defs.map((d) => {
                const active = d.id === selectedId;
                return (
                  <button key={d.id} onClick={() => setSelectedId(d.id)}
                    className={`min-w-[150px] text-left rounded-lg border px-3 py-2 transition-colors ${active ? 'border-cyan-400 bg-cyan-900/25' : 'border-slate-700 bg-slate-800/40 hover:border-cyan-500/40'}`}>
                    <div className="text-sm text-slate-100 flex items-center gap-1">{d.emoji} {d.name}{d.locked && <span className="text-[10px] text-rose-300">🔒</span>}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-2 leading-snug">{d.desc}</div>
                  </button>
                );
              })}
            </div>

            {def?.locked ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-2">
                <div className="text-3xl opacity-60">🔒</div>
                <div className="text-slate-300 text-xs max-w-md leading-relaxed">{def.lockHint}</div>
              </div>
            ) : def ? (
              <>
                {/* 工具条：我的名次 + 刷新 + 自选名次 */}
                <div className="px-3 py-2 border-b border-slate-800 bg-slate-950/40 flex flex-wrap items-center gap-2 text-xs shrink-0">
                  <span className="text-slate-300">我的名次 <b className="text-cyan-300">#{ladder?.playerRank ?? '—'}</b></span>
                  <span className="text-slate-500">最佳 #{ladder?.bestRank ?? '—'}</span>
                  {(ladder?.streak ?? 0) > 0 && <span className="text-amber-300">🔥连胜{ladder!.streak}</span>}
                  <button onClick={() => def && loadHome(def)} className="ml-auto px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700">🔄 刷新</button>
                  <div className="flex items-center gap-1">
                    <input value={targetInput} onChange={(e) => setTargetInput(e.target.value.replace(/[^\d]/g, ''))}
                      placeholder="名次" className="w-16 bg-void border border-edge rounded px-2 py-1 text-xs" />
                    <button disabled={!targetInput}
                      onClick={() => { const t = parseInt(targetInput, 10); if (t > 0 && def) loadWindow(def, t); }}
                      className="px-2 py-1 rounded bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white">跳转</button>
                  </div>
                </div>
                {reserveNotice && <div className="px-3 py-1.5 text-[11px] text-amber-300/90 bg-amber-900/15 border-b border-amber-700/30">📌 {reserveNotice}</div>}

                {/* 榜单 */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {sortedEntries.length === 0 && !busy && <div className="text-slate-500 text-sm text-center py-10">点「刷新」生成排行榜。</div>}
                  {sortedEntries.map((e) => {
                    const badge = e.badge ?? ladderBadge(def.kind, e.rank);
                    return (
                      <div key={e.rank}
                        className={`flex items-center gap-2 rounded-lg border p-2 ${e.isPlayer ? 'border-cyan-400/70 bg-cyan-900/25' : 'border-slate-700/50 bg-slate-800/30'}`}>
                        <div className={`w-12 text-center text-sm font-mono shrink-0 ${e.rank <= 10 ? 'text-amber-300' : e.rank <= 50 ? 'text-cyan-300' : 'text-slate-400'}`}>#{e.rank}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-slate-100 truncate">
                            {e.isPlayer ? (playerName || '我') : e.name}
                            {e.isPlayer && <span className="text-[10px] text-cyan-300 ml-1">（我）</span>}
                            {badge && <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-700/40 text-emerald-200 ml-1.5 align-middle">{badge}</span>}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">{e.tier}{e.job ? ` · ${e.job}` : ''}{e.strength ? ` · ${e.strength}` : ''}{e.persona ? ` · ${e.persona}` : ''}</div>
                        </div>
                        {!e.isPlayer && (
                          <button onClick={() => setConfirmEntry(e)}
                            className="px-2.5 py-1 rounded text-xs border border-rose-500/60 text-rose-200 hover:bg-rose-700/40 shrink-0">挑战</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
        )}

        {/* 忙碌遮罩 */}
        {busy && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 z-10">
            <div className="w-7 h-7 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            <div className="text-xs text-cyan-200">{busy}</div>
          </div>
        )}
      </div>

      {/* 挑战确认 */}
      {confirmEntry && def && (
        <div className="fixed inset-0 z-[65] bg-black/60 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setConfirmEntry(null); }}>
          <div className="w-full max-w-sm rounded-xl border border-rose-500/40 bg-slate-900 p-4 space-y-3">
            <div className="text-sm text-slate-100">确认挑战 <span className="text-amber-300">#{confirmEntry.rank}</span> <b>{confirmEntry.name}</b>？</div>
            <div className="text-[11px] text-slate-400 leading-relaxed">
              将为对手生成完整面板（装备/技能/天赋）并进入战斗。
              <br />胜利后你的名次将<b className="text-cyan-300">取代为 #{confirmEntry.rank}</b>{confirmEntry.rank <= 100 ? '，并发放排名奖励。' : '（仅前100名有物质奖励）。'}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmEntry(null)} className="px-3 py-1.5 rounded border border-slate-600 text-slate-300 text-sm hover:bg-slate-700">取消</button>
              <button onClick={() => doChallenge(confirmEntry)} className="px-4 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium">挑战</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
