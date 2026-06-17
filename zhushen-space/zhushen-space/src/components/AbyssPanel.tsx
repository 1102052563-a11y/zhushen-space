import { useEffect, useMemo, useRef, useState } from 'react';
import { useAbyss } from '../store/abyssStore';
import { useItems } from '../store/itemStore';
import { useMisc } from '../store/miscStore';
import { useNpc } from '../store/npcStore';
import { ABYSS_TUNING, boonGenContext, rollBoons, makeRng, boonSig } from '../systems/abyssEngine';
import type { RoomType, BoonGenContext, SinTemplate, SinFlavor, AwakenFlavor, JudgeFlavor } from '../systems/abyssEngine';
import { BOON_PRIM_LABELS, ABYSS_STARMAP, STAR_BRANCH_LABEL, ABYSS_BIOMES, type BoonCard, type StarBranch } from '../data/abyssData';

/* 深渊地牢面板（M2）——仅主神空间。线性多层地牢 + 自动战斗 + 战后 API 三选一 + 随机原罪物 + 队伍/极限。
   设计见 指导/深渊地牢-堕落流-设计.md。 */

const ROOM_ICON: Record<RoomType, string> = {
  entry: '🚪', battle: '⚔', elite: '💀', boss: '👑', event: '❓',
  rest: '🔥', treasure: '💎', beacon: '🌀', sin: '🩸',
};

function isHome(name?: string): boolean {
  return /轮回乐园|专属房间|主神空间/.test(name ?? '');
}

interface Props {
  onClose: () => void;
  onGenBoons?: (ctx: BoonGenContext) => Promise<BoonCard[]>;
  onGenSin?: (tpl: SinTemplate) => Promise<SinFlavor | null>;
  onGenAwaken?: (item: { name: string; category: string; subType?: string; affix?: string; awakenLv?: number }) => Promise<AwakenFlavor | null>;
  onGenJudge?: (options: { id: string; label: string }[]) => Promise<JudgeFlavor | null>;
}

export default function AbyssPanel({ onClose, onGenBoons, onGenSin, onGenAwaken, onGenJudge }: Props) {
  const run = useAbyss((s) => s.run);
  const meta = useAbyss((s) => s.meta);
  const boonLoading = useAbyss((s) => s.boonLoading);
  const lastSettle = useAbyss((s) => s.lastSettle);
  const start = useAbyss((s) => s.start);
  const enter = useAbyss((s) => s.enter);
  const act = useAbyss((s) => s.act);
  const transform = useAbyss((s) => s.transform);
  const chooseAltar = useAbyss((s) => s.chooseAltar);
  const chooseJudge = useAbyss((s) => s.chooseJudge);
  const enrichJudge = useAbyss((s) => s.enrichJudge);
  const chooseBoon = useAbyss((s) => s.chooseBoon);
  const unlockStarmapNode = useAbyss((s) => s.unlockStarmapNode);
  const setStartDeck = useAbyss((s) => s.setStartDeck);
  const applyAwaken = useAbyss((s) => s.applyAwaken);
  const items = useItems((s) => s.items);
  const [awakening, setAwakening] = useState<string | null>(null);
  const setPendingBoons = useAbyss((s) => s.setPendingBoons);
  const setBoonLoading = useAbyss((s) => s.setBoonLoading);
  const enrichSin = useAbyss((s) => s.enrichSin);
  const retreat = useAbyss((s) => s.retreat);
  const ackDeath = useAbyss((s) => s.ackDeath);
  const ackClear = useAbyss((s) => s.ackClear);
  const clearLastSettle = useAbyss((s) => s.clearLastSettle);

  const coins = useItems((s) => s.currency.乐园币);
  const worldName = useMisc((s) => s.worldName);
  const home = isHome(worldName);
  const sceneNpcs = useNpc((s) => Object.values(s.npcs).filter((n) => n.onScene && !n.partyMember).slice(0, 12));

  // 开局选项
  const [hardcore, setHardcore] = useState(false);
  const [allyIds, setAllyIds] = useState<string[]>([]);
  const [targetIdx, setTargetIdx] = useState(0);
  const [showStarmap, setShowStarmap] = useState(false);
  const [startZone, setStartZone] = useState(1);
  const [endless, setEndless] = useState(false);

  // 战后加成卡生成（API → 种子兜底）
  const genRef = useRef(false);
  const sinRef = useRef<string | null>(null);
  const judgeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!run) { genRef.current = false; sinRef.current = null; }
  }, [run?.seed]);

  useEffect(() => {
    if (!run || run.status !== 'choosingBoon' || run.pendingBoons || boonLoading || genRef.current) return;
    genRef.current = true;
    setBoonLoading(true);
    (async () => {
      let cards: BoonCard[] = [];
      if (onGenBoons) { try { cards = await onGenBoons(boonGenContext(run)); } catch { /* */ } }
      if (!cards || cards.length < 1) {
        const n = ABYSS_TUNING.boonChoices + (run.extraBoon ? 1 : 0);
        cards = rollBoons(makeRng(`${run.seed}|boon|${run.floor}|${run.posIdx}|${run.corruption}`), n, run.affinity);
      }
      // 渐进注入（§8.6）：收藏卡按层深混入一张
      const lib = meta.cardLibrary.filter((e) => e.fromBiome <= run.biome).map((e) => e.card);
      if (lib.length && cards.length && Math.random() < Math.min(0.5, run.globalDepth * 0.06)) {
        cards = [...cards];
        cards[cards.length - 1] = lib[Math.floor(Math.random() * lib.length)];
      }
      setPendingBoons(cards);
      genRef.current = false;
    })();
  }, [run?.status, run?.pendingBoons, boonLoading]);

  // 随机原罪物 AI 配文增强（兜底版已落库）
  useEffect(() => {
    const ps = run?.pendingSin;
    if (!ps) return;
    const key = `${run!.seed}#${ps.idx}`;
    if (sinRef.current === key) return;
    sinRef.current = key;
    (async () => {
      let flavor: SinFlavor | null = null;
      if (onGenSin) { try { flavor = await onGenSin(ps.template); } catch { /* */ } }
      enrichSin(flavor);
    })();
  }, [run?.pendingSin?.idx, run?.seed]);

  // 深渊裁判剧情局 AI 配文（场景+选项文案，后果前端定）
  useEffect(() => {
    if (run?.status !== 'judge' || !run.pendingJudge || !onGenJudge) return;
    const key = `${run.seed}#j${run.posIdx}`;
    if (judgeRef.current === key) return;
    judgeRef.current = key;
    (async () => {
      try {
        const f = await onGenJudge(run.pendingJudge!.options.map((o) => ({ id: o.id, label: o.label })));
        enrichJudge(f);
      } catch { /* */ }
    })();
  }, [run?.status, run?.posIdx, run?.seed]);

  const hero = run?.party[0];
  const fallPct = useMemo(() => {
    if (!run) return 0;
    const th = ABYSS_TUNING.corruptThresholds;
    const lv = run.fallLevel;
    const lo = th[lv] ?? 0;
    const hi = th[lv + 1] ?? lo + 50;
    return Math.max(0, Math.min(100, ((run.corruption - lo) / Math.max(1, hi - lo)) * 100));
  }, [run]);

  const room = run ? run.map.rooms[run.posIdx] : null;
  const atLast = run ? run.posIdx >= run.map.rooms.length - 1 : false;

  function toggleAlly(id: string) {
    setAllyIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : (cur.length >= 3 ? cur : [...cur, id]));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-xl border border-violet-700/40 bg-[#0d0a14] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-violet-800/40 bg-[#0d0a14]/95 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="text-lg">🕳</span>
            <h2 className="text-base font-semibold text-violet-200">深渊地牢 · 堕落流</h2>
            <span className="text-[10px] text-violet-400/60">M2 · 黑渊</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100 text-sm px-2">✕</button>
        </div>

        {/* 进度总览（跨周目 meta） */}
        <div className="grid grid-cols-4 gap-px bg-violet-900/20 text-center text-[11px]">
          <Stat label="堕落结晶" value={meta.crystals} accent="text-fuchsia-300" />
          <Stat label="通关" value={meta.clearsCount} accent="text-amber-300" />
          <Stat label="最深层" value={meta.deepestFloor} accent="text-violet-300" />
          <Stat label="觉醒充能" value={meta.awakenCharges} accent="text-rose-300" />
          <Stat label="解锁险地" value={`${meta.unlockedZones}/${ABYSS_BIOMES.length}`} accent="text-violet-300" />
          <Stat label="星图节点" value={meta.starmapNodes.length} accent="text-fuchsia-300" />
          <Stat label="卡牌库" value={meta.cardLibrary.length} accent="text-sky-300" />
          <Stat label="原罪图鉴" value={Object.keys(meta.sinCodex).length} accent="text-rose-300" />
        </div>
        <div className="px-3 py-1 text-center text-[10px] text-violet-300/70 bg-violet-900/10">
          无尽深渊：{meta.endlessUnlocked ? '已解锁 ♾' : '未解锁（需通关界之底）'}
        </div>

        <div className="p-4 space-y-4">
          {!home && (
            <div className="rounded-lg border border-amber-700/40 bg-amber-950/30 p-3 text-xs text-amber-200">
              ⚠ 深渊入口只在<strong>主神空间/轮回乐园</strong>开启。请先回归乐园再来。
            </div>
          )}

          {lastSettle && !run && (
            <div className="rounded-lg border border-violet-700/40 bg-violet-950/30 p-3 text-xs text-violet-100 flex items-start justify-between gap-3">
              <div>
                <div className={lastSettle.cleared ? 'text-amber-300 font-semibold' : 'text-violet-200 font-semibold'}>
                  {lastSettle.cleared ? '🏁 通关结算' : '📜 上局结算'}
                </div>
                <div className="text-violet-300/80 mt-1">{lastSettle.note}</div>
                <div className="mt-1">带出 <b className="text-emerald-300">{lastSettle.carry}</b> 件 · 堕落结晶 <b className="text-fuchsia-300">+{lastSettle.crystals}</b></div>
              </div>
              <button onClick={clearLastSettle} className="text-violet-400 hover:text-violet-100">收起</button>
            </div>
          )}

          {/* 入口 + 开局选项 */}
          {!run && !showStarmap && (
            <div className="space-y-3 py-2">
              <div className="text-center">
                <button onClick={() => setShowStarmap(true)} className="text-xs text-fuchsia-300/90 hover:text-fuchsia-200 underline underline-offset-2">🌑 堕落星图（用堕落结晶永久强化）</button>
              </div>
              <p className="text-sm text-violet-200/90 text-center">深入黑渊，夺取原罪物。越深越凶，腐蚀换力——见好就收，量力而退。</p>

              {/* 极限模式 */}
              <label className={`flex items-center gap-2 text-xs rounded-lg border p-2 cursor-pointer ${hardcore ? 'border-rose-600/50 bg-rose-950/30 text-rose-200' : 'border-violet-800/40 text-slate-300'}`}>
                <input type="checkbox" checked={hardcore} onChange={(e) => setHardcore(e.target.checked)} />
                <span><b>极限模式</b>：强制主角单人，无队友（更高难度 → 后续给更高奖励）。</span>
              </label>

              {/* 无尽深渊（通关界之底解锁） */}
              {meta.endlessUnlocked && (
                <label className={`flex items-center gap-2 text-xs rounded-lg border p-2 cursor-pointer ${endless ? 'border-fuchsia-600/50 bg-fuchsia-950/30 text-fuchsia-200' : 'border-violet-800/40 text-slate-300'}`}>
                  <input type="checkbox" checked={endless} onChange={(e) => setEndless(e.target.checked)} />
                  <span><b>♾ 无尽深渊</b>：越过界之底循环下潜，越来越深越凶，永不通关，刷最深记录。</span>
                </label>
              )}

              {/* 队伍 */}
              {!hardcore && (
                <div className="rounded-lg border border-violet-800/40 p-2">
                  <div className="text-[11px] text-violet-300/80 mb-1">带队（在场 NPC，最多 3）：{allyIds.length}/3</div>
                  {sceneNpcs.length === 0 ? (
                    <div className="text-[11px] text-slate-500">当前无在场 NPC 可带。</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {sceneNpcs.map((n) => (
                        <button key={n.id} onClick={() => toggleAlly(n.id)}
                          className={`text-[11px] px-2 py-1 rounded border transition ${allyIds.includes(n.id) ? 'border-cyan-500/60 bg-cyan-950/40 text-cyan-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}>
                          {allyIds.includes(n.id) ? '✓ ' : ''}{n.name}{n.realm ? ` ·${n.realm}` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 卡牌库 → 起手卡组（§8.6） */}
              {meta.cardLibrary.length > 0 && (
                <div className="rounded-lg border border-violet-800/40 p-2">
                  <div className="text-[11px] text-violet-300/80 mb-1">🎴 起手卡组（从卡牌库选 ≤3）：{meta.startDeck.length}/3</div>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {meta.cardLibrary.map((e) => {
                      const sig = boonSig(e.card);
                      const on = meta.startDeck.includes(sig);
                      return (
                        <button key={sig} onClick={() => {
                          if (on) setStartDeck(meta.startDeck.filter((x) => x !== sig));
                          else if (meta.startDeck.length < 3) setStartDeck([...meta.startDeck, sig]);
                        }}
                          className={`text-[11px] px-2 py-1 rounded border transition ${on ? 'border-fuchsia-500/60 bg-fuchsia-950/40 text-fuchsia-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}>
                          {on ? '✓ ' : ''}{e.card.name}{e.count > 1 ? `×${e.count}` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 原罪图鉴 */}
              {Object.keys(meta.sinCodex).length > 0 && (
                <div className="text-[11px] text-slate-400">📖 原罪图鉴 {Object.keys(meta.sinCodex).length}：{Object.keys(meta.sinCodex).slice(0, 8).join('、')}{Object.keys(meta.sinCodex).length > 8 ? '…' : ''}</div>
              )}

              {/* 觉醒（§10.2） */}
              {meta.awakenCharges > 0 && (
                <div className="rounded-lg border border-rose-800/40 p-2">
                  <div className="text-[11px] text-rose-300/80 mb-1">⚒ 觉醒（充能 {meta.awakenCharges}）：给已带出的装备/原罪物升品级 + 加词缀</div>
                  {(() => {
                    const awakenable = items.filter((it) => ['武器', '防具', '饰品'].includes(it.category) || (it.tags || []).includes('原罪')).slice(0, 12);
                    if (!awakenable.length) return <div className="text-[10px] text-slate-500">背包暂无可觉醒的装备/原罪物。</div>;
                    return (
                      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                        {awakenable.map((it) => (
                          <button key={it.id} disabled={!!awakening || meta.awakenCharges < 1}
                            onClick={async () => {
                              setAwakening(it.id);
                              let flavor: AwakenFlavor | null = null;
                              if (onGenAwaken) { try { flavor = await onGenAwaken(it); } catch { /* */ } }
                              applyAwaken(it.id, flavor);
                              setAwakening(null);
                            }}
                            className="text-[11px] px-2 py-1 rounded border border-rose-700/40 bg-rose-950/20 text-rose-100 hover:brightness-125 disabled:opacity-40">
                            {awakening === it.id ? '觉醒中…' : `${it.name}${it.awakenLv ? ` ✦${it.awakenLv}` : ''}`}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* 险地直达（通关解锁） */}
              {meta.unlockedZones > 1 && (
                <div className="rounded-lg border border-violet-800/40 p-2">
                  <div className="text-[11px] text-violet-300/80 mb-1">起跳险地（通关解锁直达）</div>
                  <div className="flex flex-wrap gap-1.5">
                    {ABYSS_BIOMES.slice(0, meta.unlockedZones).map((b, i) => (
                      <button key={i} onClick={() => setStartZone(i + 1)}
                        className={`text-[11px] px-2 py-1 rounded border transition ${startZone === i + 1 ? 'border-violet-400 bg-violet-900/40 text-violet-100' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}>
                        {i + 1}·{b.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-slate-400 text-center">门票 <b className="text-amber-300">{ABYSS_TUNING.ticketCost}</b> 乐园币 · 持有 <b className={coins >= ABYSS_TUNING.ticketCost ? 'text-emerald-300' : 'text-rose-300'}>{coins}</b></p>
              <div className="text-center">
                <button
                  disabled={!home || coins < ABYSS_TUNING.ticketCost}
                  onClick={() => { if (!start({ hardcore, allyIds, startZone, endless })) alert('乐园币不足，无法购买门票'); }}
                  className="px-5 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white"
                >
                  {endless ? '♾ 踏入无尽深渊' : `🕳 踏入深渊（${ABYSS_BIOMES[Math.min(startZone, ABYSS_BIOMES.length) - 1]?.name ?? '黑渊'}）`}
                </button>
              </div>
            </div>
          )}

          {/* 堕落星图（meta 永久树） */}
          {!run && showStarmap && (
            <div className="space-y-3 py-1">
              <div className="flex items-center justify-between">
                <button onClick={() => setShowStarmap(false)} className="text-xs text-violet-300 hover:text-violet-100">← 返回</button>
                <span className="text-sm text-fuchsia-200">🌑 堕落星图</span>
                <span className="text-xs text-fuchsia-300">结晶 {meta.crystals}💎</span>
              </div>
              <p className="text-[11px] text-slate-400">花堕落结晶永久点亮：起手增益 / 加成卡偏向 / 失控缓和 / 四选一。跨周目保留。</p>
              {(['core', 'martial', 'guard', 'corruption', 'common'] as StarBranch[]).map((br) => {
                const nodes = ABYSS_STARMAP.filter((n) => n.branch === br);
                if (!nodes.length) return null;
                return (
                  <div key={br} className="rounded-lg border border-fuchsia-900/30 p-2">
                    <div className="text-[11px] text-fuchsia-300/80 mb-1">{STAR_BRANCH_LABEL[br]}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {nodes.map((n) => {
                        const owned = meta.starmapNodes.includes(n.id);
                        const prereqOk = (n.prereq ?? []).every((p) => meta.starmapNodes.includes(p));
                        const can = !owned && prereqOk && meta.crystals >= n.cost;
                        return (
                          <button key={n.id} disabled={owned || !can} onClick={() => unlockStarmapNode(n.id)}
                            className={`text-left rounded border p-2 transition ${owned ? 'border-emerald-600/50 bg-emerald-950/30' : can ? 'border-fuchsia-600/50 bg-fuchsia-950/20 hover:brightness-125' : 'border-slate-700/50 opacity-50'}`}>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-slate-100">{owned ? '✓ ' : ''}{n.name}</span>
                              <span className="text-[10px] text-fuchsia-300">{owned ? '已点亮' : `${n.cost}💎`}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">{n.desc}</div>
                            {!owned && !prereqOk && <div className="text-[9px] text-rose-400/70 mt-0.5">需先点亮前置</div>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 进行中 */}
          {run && hero && (
            <>
              <div className="rounded-lg border border-violet-800/40 bg-black/30 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-violet-200">
                  <span>{run.mode === 'endless' && <span className="text-fuchsia-300">♾深{run.globalDepth} · </span>}{ABYSS_BIOMES[run.biome - 1]?.name ?? '深渊'} <span className="text-violet-400/60">({run.biome}/{ABYSS_BIOMES.length})</span> · 第 <b className="text-violet-100">{run.floor}</b>/{ABYSS_TUNING.floorsPerZone} 层 {run.hardcore && <span className="text-rose-300">· 极限</span>}</span>
                  <span>房间 {run.posIdx + 1}/{run.map.rooms.length}</span>
                </div>
                {/* 队伍 HP */}
                {run.party.map((u) => (
                  <Meter key={u.id} label={`${u.isPlayer ? '★' : '◦'}${u.name}`} pct={(u.hp / Math.max(1, u.maxHp)) * 100} text={`${u.hp}/${u.maxHp}`} color={u.alive ? 'bg-emerald-500' : 'bg-slate-600'} />
                ))}
                {/* 腐蚀 / 堕落 */}
                <Meter label={`腐蚀·堕落Lv${run.fallLevel}`} pct={fallPct} text={`${run.corruption}`} color="bg-fuchsia-600" />
                <div className="flex gap-3 text-[11px] text-slate-400">
                  <span>主角攻 <b className="text-rose-300">{hero.atk}</b></span>
                  <span>防 <b className="text-sky-300">{hero.def}</b></span>
                  {hero.lifesteal ? <span>吸血 <b className="text-emerald-300">{Math.round(hero.lifesteal * 100)}%</b></span> : null}
                  <span>战利品 <b className="text-amber-300">{run.loot.length}</b></span>
                  <span>加成 <b className="text-violet-300">{run.boons.length}</b></span>
                </div>
              </div>

              {/* 探索 */}
              {run.status === 'exploring' && room && (
                <div className="rounded-lg border border-violet-800/40 bg-black/20 p-3 text-center space-y-3">
                  <div className="text-sm text-violet-100">{ROOM_ICON[room.type]} 当前：{room.name}</div>
                  {atLast ? (
                    <div className="text-xs text-amber-300">已抵达本层尽头。</div>
                  ) : (
                    <button onClick={enter} className="px-5 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-sm font-semibold text-white">前进 ▶（进入下一房间）</button>
                  )}
                  <div>
                    <button onClick={retreat} className="text-xs text-amber-300/80 hover:text-amber-200 underline underline-offset-2">🌀 从此撤退（全额带出战利品）</button>
                  </div>
                </div>
              )}

              {/* 交互式战斗 */}
              {run.status === 'fighting' && run.fight && (() => {
                const aliveE = run.fight.enemies.filter((e) => e.alive);
                const tIdx = Math.min(targetIdx, Math.max(0, aliveE.length - 1));
                return (
                  <div className="rounded-lg border border-rose-800/40 bg-rose-950/10 p-3 space-y-2">
                    <div className="text-center text-sm text-rose-200">⚔ 交战中 · 第 {run.fight.round} 回合 {run.fight.form && <span className="text-fuchsia-300">· 😈魔化 {run.fight.form.roundsLeft} 回合</span>}</div>
                    <div className="space-y-1">
                      {run.fight.enemies.map((e) => {
                        const idxInAlive = aliveE.indexOf(e);
                        const selected = e.alive && idxInAlive === tIdx;
                        return (
                          <button key={e.id} disabled={!e.alive} onClick={() => setTargetIdx(idxInAlive)}
                            className={`w-full text-left rounded px-2 py-1 border transition ${e.alive ? (selected ? 'border-rose-400 bg-rose-900/40' : 'border-rose-800/40 hover:bg-rose-900/20') : 'border-slate-800 opacity-40'}`}>
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-rose-100">{selected ? '🎯 ' : ''}{e.name}{e.tier ? ` ·${e.tier}` : ''}</span>
                              <span className="text-slate-300 tabular-nums">{Math.max(0, e.hp)}/{e.maxHp}</span>
                            </div>
                            <div className="h-1.5 mt-0.5 rounded-full bg-slate-800 overflow-hidden">
                              <div className="h-full bg-rose-500" style={{ width: `${Math.max(0, Math.min(100, (e.hp / Math.max(1, e.maxHp)) * 100))}%` }} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center pt-1">
                      <button onClick={() => act('attack', tIdx)} className="px-3 py-1.5 rounded bg-rose-700 hover:bg-rose-600 text-xs font-semibold text-white">⚔ 攻击</button>
                      <button onClick={() => act('defend')} className="px-3 py-1.5 rounded bg-sky-800 hover:bg-sky-700 text-xs font-semibold text-white">🛡 防御</button>
                      {run.fallLevel >= ABYSS_TUNING.formMinFall && !run.fight.form && !run.fight.formUsed && (
                        <button onClick={transform} className="px-3 py-1.5 rounded bg-fuchsia-700 hover:bg-fuchsia-600 text-xs font-semibold text-white">😈 堕落形态</button>
                      )}
                      <button onClick={() => act('flee')} className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs text-slate-200">🏃 撤离</button>
                    </div>
                    <div className="max-h-24 overflow-y-auto text-[10px] text-slate-400 space-y-0.5 pt-1">
                      {run.fight.log.slice(-8).reverse().map((l, i) => <div key={i}>{l}</div>)}
                    </div>
                  </div>
                );
              })()}

              {/* 战后三选一 */}
              {run.status === 'choosingBoon' && (
                <div className="space-y-2">
                  <div className="text-center text-sm text-fuchsia-200">深渊馈赠 · 三选一</div>
                  {(!run.pendingBoons || boonLoading) ? (
                    <div className="text-center text-xs text-violet-300/70 py-4 animate-pulse">深渊低语凝聚中…（AI 生成，失败将回退种子）</div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {run.pendingBoons.map((b) => (
                        <button key={b.id} onClick={() => chooseBoon(b)}
                          className={`text-left rounded-lg border p-3 transition hover:brightness-125 ${BOON_BORDER[b.quality]}`}>
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold text-slate-100">{b.name}</div>
                            {b.capstone && <span className="text-[9px] text-amber-300">★质变</span>}
                          </div>
                          <div className="text-[10px] text-violet-300/70 mt-0.5">{SCHOOL_LABEL[b.school]} · {QUALITY_LABEL[b.quality]}</div>
                          <div className="text-xs text-slate-300 mt-1">{b.desc}</div>
                          {b.prims && b.prims.length > 0 && (
                            <div className="text-[9px] text-slate-500 mt-1">{b.prims.map((p) => `${BOON_PRIM_LABELS[p.id] ?? p.id}·${p.tier}`).join(' / ')}</div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 堕落祭坛 */}
              {run.status === 'altar' && run.pendingAltar && (
                <div className="rounded-lg border border-fuchsia-800/40 bg-fuchsia-950/10 p-3 space-y-2">
                  <div className="text-center text-sm text-fuchsia-200">🩸 堕落祭坛 · 献祭换力（主动堆腐蚀）</div>
                  <div className="grid grid-cols-1 gap-2">
                    {run.pendingAltar.map((o, i) => (
                      <button key={o.id} onClick={() => chooseAltar(i)} className="text-left rounded-lg border border-fuchsia-700/40 bg-fuchsia-900/20 p-2 hover:brightness-125 transition">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-fuchsia-100">{o.label}</span>
                          <span className="text-[10px] text-rose-300">腐蚀 +{o.corruption}</span>
                        </div>
                        <div className="text-xs text-slate-300 mt-0.5">{o.desc}</div>
                      </button>
                    ))}
                  </div>
                  <div className="text-center">
                    <button onClick={() => chooseAltar(-1)} className="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2">拒绝离开（不献祭）</button>
                  </div>
                </div>
              )}

              {/* 深渊裁判剧情局 */}
              {run.status === 'judge' && run.pendingJudge && (
                <div className="rounded-lg border border-indigo-800/40 bg-indigo-950/10 p-3 space-y-2">
                  <div className="text-center text-sm text-indigo-200">🎭 深渊裁判 · 抉择</div>
                  <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{run.pendingJudge.scene}</p>
                  <div className="grid grid-cols-1 gap-2">
                    {run.pendingJudge.options.map((o, i) => (
                      <button key={o.id} onClick={() => chooseJudge(i)} className="text-left rounded-lg border border-indigo-700/40 bg-indigo-900/20 p-2 hover:brightness-125 transition">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-indigo-100">{o.label}</span>
                          <span className="text-[10px] text-rose-300">{o.corruption > 0 ? `腐蚀+${o.corruption}` : o.corruption < 0 ? `腐蚀${o.corruption}` : ''}{o.hpDelta ? ` · HP${o.hpDelta > 0 ? '+' : ''}${Math.round(o.hpDelta * 100)}%` : ''}</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">{o.flavor}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 死亡 / 通关 */}
              {run.status === 'dead' && (
                <div className="rounded-lg border border-rose-800/50 bg-rose-950/30 p-4 text-center space-y-3">
                  <div className="text-rose-300 font-semibold">💀 队伍全灭——深渊放逐</div>
                  <div className="text-xs text-rose-200/80">未带出战利品损失一半，堕落结晶按深度结算。</div>
                  <button onClick={ackDeath} className="px-5 py-2 rounded-lg bg-rose-800 hover:bg-rose-700 text-sm font-semibold text-white">接受放逐 · 结算</button>
                </div>
              )}
              {run.status === 'cleared' && (
                <div className="rounded-lg border border-amber-700/50 bg-amber-950/20 p-4 text-center space-y-3">
                  <div className="text-amber-300 font-semibold">🏁 击破区主——通关黑渊！</div>
                  <div className="text-xs text-amber-200/80">全额带出战利品 + 通关结晶。</div>
                  <button onClick={ackClear} className="px-5 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-sm font-semibold text-white">领取奖励 · 结算</button>
                </div>
              )}

              {/* 日志 */}
              <div className="rounded-lg border border-violet-900/40 bg-black/30 p-3 max-h-40 overflow-y-auto text-[11px] text-slate-400 space-y-1">
                {run.log.slice(-12).reverse().map((l, i) => <div key={i}>{l}</div>)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent: string }) {
  return (
    <div className="bg-[#0d0a14] py-2">
      <div className={`text-sm font-semibold ${accent}`}>{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  );
}

function Meter({ label, pct, text, color }: { label: string; pct: number; text: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-400 w-24 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-slate-800 overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <span className="text-[10px] text-slate-300 tabular-nums w-20 text-right">{text}</span>
    </div>
  );
}

const SCHOOL_LABEL: Record<string, string> = {
  corruption: '🩸腐蚀', martial: '⚔武道', guard: '🛡守护', undead: '💀亡灵', domain: '🔥领域', gambler: '🎲赌徒',
};
const QUALITY_LABEL: Record<string, string> = { common: '普通', fine: '精良', epic: '史诗' };
const BOON_BORDER: Record<string, string> = {
  common: 'border-slate-600/50 bg-slate-900/40',
  fine: 'border-sky-600/50 bg-sky-950/30',
  epic: 'border-fuchsia-600/50 bg-fuchsia-950/30',
};
