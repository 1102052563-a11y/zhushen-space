/* 🛡 冒险团派遣 —— 委托板 / 编成 / 倒数封条 / 归来战报
   注意：**倒数没走完时，`rec.ledger` 在数据里就不存在**（见 dispatchEngine），
   所以这里没有"藏起来"的分支——想显示也没得显示。别为了做加载态去引擎里提前算账本。 */
import { useEffect, useState } from 'react';
import { useTeam, FATIGUE_GATE, type DispatchRecord, type DispatchReward } from '../store/adventureTeamStore';
import { useNpc } from '../store/npcStore';
import { useMisc } from '../store/miscStore';
import { gradeColorClass } from '../store/itemStore';
import { dispatchCandidates, memberBlockReason, estimateDispatch, launchDispatch, ensureBoard, rollOfferBoard } from '../systems/dispatchEngine';
import { generateDispatchReport, fallbackReport } from '../systems/dispatchReport';
import { generateDispatchBoard } from '../systems/dispatchGen';

const TIER_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const RATING_CLS: Record<string, string> = {
  E: 'text-zinc-400 border-zinc-600/50', D: 'text-slate-300 border-slate-500/50',
  C: 'text-emerald-300 border-emerald-500/50', B: 'text-sky-300 border-sky-500/50',
  A: 'text-violet-300 border-violet-500/50', S: 'text-amber-300 border-amber-500/60',
  SS: 'text-orange-300 border-orange-500/60', SSS: 'text-fuchsia-300 border-fuchsia-500/70',
};

function pctLabel(score: number): { text: string; cls: string } {
  if (score >= 78) return { text: '十拿九稳', cls: 'text-emerald-300' };
  if (score >= 62) return { text: '胜算颇大', cls: 'text-sky-300' };
  if (score >= 48) return { text: '五五之数', cls: 'text-amber-300' };
  if (score >= 32) return { text: '凶多吉少', cls: 'text-orange-300' };
  return { text: '九死一生', cls: 'text-blood' };
}

/* ── 委托酬劳卡：接单**之前**就把整件东西摊开（这才是选这条委托的理由）── */
function RewardCard({ r, compact }: { r: DispatchReward; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const rows: [string, string | undefined][] = [
    ['类型', [r.category, r.subType].filter(Boolean).join('·')],
    ['产地', r.origin],
    ['攻防', r.combatStat], ['耐久', r.durability], ['需求', r.requirement],
    ['属性加成', r.attrBonus], ['评分', r.score],
    ['词缀', r.affix], ['效果', r.effect],
    ['主动效果', [r.activeEffect, r.activeDuration].filter(Boolean).join('　持续：')],
    ['外观', r.appearance], ['简介', r.intro],
  ];
  return (
    <div className="rounded border border-amber-800/40 bg-amber-950/15 px-2 py-1.5 mt-1.5">
      <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }} className="w-full flex items-center gap-1.5 text-left">
        <span className="text-[11px] font-mono text-amber-500/70 shrink-0">🎁 达成酬劳</span>
        <span className={`text-[12px] font-mono truncate ${gradeColorClass(r.gradeDesc)}`}>{r.name}</span>
        <span className="text-[10px] font-mono text-dim/40 shrink-0">{r.gradeDesc}</span>
        {r.quantity && r.quantity > 1 && <span className="text-[10px] font-mono text-dim/40 shrink-0">×{r.quantity}</span>}
        {!compact && <span className="ml-auto text-[10px] font-mono text-dim/35 shrink-0">{open ? '收起' : '详情'}</span>}
      </button>
      {open && (
        <div className="mt-1.5 pt-1.5 border-t border-amber-900/30 space-y-0.5">
          {rows.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="flex gap-1.5 text-[11px] leading-relaxed">
              <span className="text-dim/40 font-mono shrink-0 w-[52px]">{k}</span>
              <span className="text-dim/80 flex-1 min-w-0 break-words whitespace-pre-wrap">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 进行中：只给倒数，不给任何结算线索 ── */
function ActiveCard({ rec, turn, onAbort }: { rec: DispatchRecord; turn: number; onAbort: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const total = Math.max(1, rec.endTurn - rec.startTurn);
  const left = Math.max(0, rec.endTurn - turn);
  const pct = Math.max(0, Math.min(100, ((total - left) / total) * 100));
  return (
    <section className="rounded-lg border border-amber-600/40 bg-amber-950/15 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-amber-200">⚔ {rec.offer.title}</div>
          <div className="text-[12px] text-dim/70 mt-0.5 truncate">{rec.offer.world}　{TIER_CN[rec.offer.tier]}阶委托</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-mono font-bold text-amber-300 leading-none">{left}</div>
          <div className="text-[11px] text-dim/50 font-mono mt-0.5">回合后归来</div>
        </div>
      </div>
      <div className="h-2 rounded-full bg-void border border-edge overflow-hidden">
        <div className="h-full bg-gradient-to-r from-amber-700/70 to-amber-400/80 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rec.memberNames.map((n, i) => (
          <span key={i} className="px-2 py-0.5 rounded border border-amber-700/40 text-amber-200/80 text-[12px] font-mono">{n}</span>
        ))}
      </div>
      {rec.offer.reward && <RewardCard r={rec.offer.reward} />}
      <div className="text-[12px] text-dim/50 leading-relaxed border-t border-edge/60 pt-2">
        🔒 <b className="text-dim/70">归来之前看不到结算</b>——战报与战利品在队伍返回那一刻才生成。
        {rec.offer.reward && <span className="block mt-0.5">达成才发酬劳；失利（评级 E/D）不发。</span>}
        {rec.startTime && <span className="block mt-0.5 font-mono text-dim/35">出发于 {rec.startTime}</span>}
      </div>
      <div className="flex justify-end">
        {confirm ? (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-blood/80 mr-auto">撤回则本次委托作废，无任何收获。</span>
            <button onClick={onAbort} className="px-2.5 py-1 rounded border border-blood/50 bg-blood/15 text-blood text-[12px] font-mono hover:bg-blood/25 transition-colors">确认撤回</button>
            <button onClick={() => setConfirm(false)} className="px-2.5 py-1 rounded border border-edge text-dim/70 text-[12px] font-mono hover:text-slate-200 transition-colors">取消</button>
          </div>
        ) : (
          <button onClick={() => setConfirm(true)} className="px-2.5 py-1 rounded border border-edge text-dim/50 text-[12px] font-mono hover:border-blood/40 hover:text-blood/80 transition-colors">召回队伍</button>
        )}
      </div>
    </section>
  );
}

/* ── 委托板抬头：AI 生成（**手动·唯一触发点**）+ 联网开关 ── */
function BoardHeader({ turn }: { turn: number }) {
  const source = useTeam((s) => s.boardSource);
  const busy = useTeam((s) => s.boardBusy);
  const err = useTeam((s) => s.boardError);
  const web = useTeam((s) => s.dispatchWebSearch);
  const setWeb = useTeam((s) => s.setDispatchWebSearch);
  const setBoard = useTeam((s) => s.setBoard);
  const rank = useTeam((s) => s.rank);

  return (
    <div className="rounded-lg border border-edge bg-panel/60 px-2.5 py-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono text-dim/50">
          {source === 'ai' ? '✨ AI 委托板' : '⚙ 自动委托板'}
          <span className="text-dim/30">（第 {turn} 回合）</span>
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {source === 'ai' && !busy && (
            <button onClick={() => setBoard(rollOfferBoard(turn, rank, dispatchCandidates()), turn, 'auto')}
              title="丢弃 AI 委托，换回免费的自动委托板"
              className="px-2 py-0.5 rounded border border-edge text-dim/50 text-[11px] font-mono hover:text-slate-300 transition-colors">换回自动</button>
          )}
          <button onClick={() => { void generateDispatchBoard(turn); }} disabled={busy}
            className="px-2.5 py-0.5 rounded border border-god/40 bg-god/10 text-god text-[11px] font-mono hover:bg-god/20 disabled:opacity-40 transition-colors">
            {busy ? '生成中…' : '🔮 AI 生成委托'}
          </button>
        </div>
      </div>
      <label className="flex items-center gap-1.5 text-[11px] font-mono text-dim/50 cursor-pointer">
        <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} className="accent-god" />
        联网搜索（Google）——同人世界据原作真实设定出委托，需接口支持
      </label>
      {source === 'ai' && (
        <div className="text-[11px] font-mono text-dim/35 leading-relaxed">
          AI 委托<b className="text-dim/50">不会自动换批</b>，只有你再点一次生成、或点「换回自动」才变。
        </div>
      )}
      {err && <div className="text-[11px] font-mono text-blood/80">⚠ {err}</div>}
    </div>
  );
}

/* ── 委托板 + 编成 ── */
function BoardSection({ turn }: { turn: number }) {
  const board = useTeam((s) => s.dispatchBoard);
  const rank = useTeam((s) => s.rank);
  const fatigue = useTeam((s) => s.fatigue);
  const injury = useTeam((s) => s.injury);
  const npcs = useNpc((s) => s.npcs);
  const [selOffer, setSelOffer] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // 不缓存：三个函数都从 getState 读，缓存了反而要靠 deps 猜什么时候失效（eslint 也看不出来）。
  // 组件已订阅 npcs/fatigue/injury，它们一变就重渲染；这几步都是 O(成员数≤10) 的算术，直接算最省心。
  void npcs; void fatigue; void injury;
  const cands = dispatchCandidates();
  const offer = board.find((o) => o.id === selOffer) ?? null;
  const chosen = cands.filter((c) => picked.has(c.id));
  const est = offer ? estimateDispatch(offer, chosen, rank) : null;

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const go = () => {
    if (!offer) return;
    const ok = launchDispatch(offer, [...picked], turn);
    if (ok) { setSelOffer(null); setPicked(new Set()); }
  };

  if (!cands.length) {
    return (
      <div className="space-y-2.5">
        <BoardHeader turn={turn} />
        <div className="rounded-lg border border-edge bg-panel px-3 py-6 text-center text-[13px] text-dim/40 leading-relaxed">
          没有可派遣的成员。<br />
          <span className="text-[12px]">派遣只用<b>已建档</b>的团队成员（主角不出勤）——去 NPC 面板把队友加进冒险团吧。</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <BoardHeader turn={turn} />

      {/* 委托列表 */}
      <div className="space-y-1.5">
        {board.map((o) => {
          const on = o.id === selOffer;
          return (
            <div key={o.id} onClick={() => setSelOffer(on ? null : o.id)} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelOffer(on ? null : o.id); } }}
              className={`w-full text-left rounded-lg border px-3 py-2 transition-colors cursor-pointer ${on ? 'border-god/50 bg-god/10' : 'border-edge bg-panel hover:border-god/30'}`}>
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] text-slate-200 font-bold">{o.title}</span>
                <span className={`text-[11px] font-mono px-1.5 rounded border ${o.tier >= 6 ? 'text-rose-300 border-rose-600/50' : o.tier >= 4 ? 'text-amber-300 border-amber-600/50' : 'text-emerald-300 border-emerald-600/50'}`}>{TIER_CN[o.tier]}阶</span>
                <span className="ml-auto text-[11px] font-mono text-dim/50">{o.turns} 回合</span>
              </div>
              <div className="text-[12px] text-dim/60 mt-0.5 truncate">{o.world}{o.employer ? `　·　雇主：${o.employer}` : ''}</div>
              {o.brief && <div className="text-[12px] text-dim/70 mt-1 leading-relaxed">{o.brief}</div>}
              {o.objective && <div className="text-[11px] text-sky-300/70 mt-0.5">目标：{o.objective}</div>}
              {o.risk && <div className="text-[11px] text-orange-300/60 mt-0.5">风险：{o.risk}</div>}
              <div className="text-[11px] font-mono text-dim/40 mt-1 flex flex-wrap gap-x-3">
                <span>建议 {o.slots} 人</span>
                {o.archLabel && <span>偏好 {o.archLabel}系</span>}
                <span>报酬 {o.tier >= 4 ? '魂币' : '乐园币'}</span>
                <span>危险 {o.danger >= 0.6 ? '高' : o.danger >= 0.4 ? '中' : '低'}</span>
              </div>
              {o.reward && <RewardCard r={o.reward} />}
            </div>
          );
        })}
      </div>

      {/* 编成 */}
      {offer && (
        <div className="rounded-lg border border-god/30 bg-void/60 p-3 space-y-2.5">
          <div className="text-[12px] font-mono text-dim/60">出勤编成（建议 {offer.slots} 人）</div>
          <div className="space-y-1">
            {cands.map((c) => {
              const block = memberBlockReason(c);
              const fat = fatigue[c.id] ?? 0;
              const on = picked.has(c.id);
              return (
                <button key={c.id} disabled={!!block} onClick={() => toggle(c.id)}
                  className={`w-full flex items-center gap-2.5 rounded border px-2.5 py-1.5 text-left transition-colors ${block ? 'border-edge/60 opacity-40 cursor-not-allowed' : on ? 'border-god/50 bg-god/10' : 'border-edge hover:border-god/30'}`}>
                  <span className={`text-[13px] font-mono shrink-0 ${on ? 'text-god' : 'text-slate-300'}`}>{on ? '☑' : '☐'} {c.name}</span>
                  <span className="text-[11px] text-dim/40 font-mono shrink-0">{c.realm || '阶位不详'}</span>
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <div className="flex-1 h-1.5 rounded-full bg-void border border-edge/60 overflow-hidden min-w-[40px]">
                      <div className={`h-full ${fat >= FATIGUE_GATE ? 'bg-blood/70' : fat >= 40 ? 'bg-amber-500/70' : 'bg-emerald-600/60'}`} style={{ width: `${fat}%` }} />
                    </div>
                    <span className="text-[10px] font-mono text-dim/40 shrink-0 w-7 text-right">{fat}</span>
                  </div>
                  {block && <span className="text-[11px] font-mono text-blood/70 shrink-0">{block}</span>}
                </button>
              );
            })}
          </div>

          {est && (
            <div className="rounded border border-edge bg-panel/60 px-2.5 py-2 space-y-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] text-dim/60 font-mono">胜算预估</span>
                <span className={`text-[13px] font-bold ${pctLabel(est.score).cls}`}>{pctLabel(est.score).text}</span>
                <span className="ml-auto text-[11px] font-mono text-dim/40">{est.score}/100</span>
              </div>
              <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                {est.detail.map((d, i) => (
                  <span key={i} className="text-[11px] font-mono text-dim/50">
                    {d.label}
                    <b className={d.delta > 0 ? 'text-emerald-400/80' : d.delta < 0 ? 'text-blood/80' : 'text-dim/40'}>{d.delta > 0 ? ` +${d.delta}` : d.delta < 0 ? ` ${d.delta}` : ''}</b>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-dim/40 mr-auto">已选 {picked.size} 人</span>
            <button onClick={go} disabled={picked.size === 0}
              className="px-3 py-1 rounded-lg border border-god/50 bg-god/15 text-god text-[13px] font-mono hover:bg-god/25 disabled:opacity-30 disabled:hover:bg-god/15 transition-colors">
              ⚔ 派出（{offer.turns} 回合）
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 战报 ── */
function ReportModal({ rec, onClose }: { rec: DispatchRecord; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const live = useTeam((s) => s.dispatchHistory.find((r) => r.id === rec.id)) ?? rec;
  const l = live.ledger;
  const regen = async () => { setBusy(true); try { await generateDispatchReport(live.id); } finally { setBusy(false); } };
  const body = live.report || (l ? fallbackReport(live) : '');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-lg max-h-[85dvh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-2 p-3.5 border-b border-edge shrink-0">
          <span>📜</span>
          <h3 className="text-[15px] font-bold text-slate-100">{live.offer.title}</h3>
          {l && <span className={`text-[13px] font-mono font-bold px-2 py-0.5 rounded border ${RATING_CLS[l.rating] ?? ''}`}>{l.rating}</span>}
          <button onClick={onClose} className="ml-auto text-dim/50 hover:text-blood text-lg font-mono">✕</button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="text-[12px] font-mono text-dim/50">{live.offer.world}　{TIER_CN[live.offer.tier]}阶　历时 {live.offer.turns} 回合</div>

          {live.reportState === 'loading' ? (
            <div className="text-[13px] text-amber-200/80 font-mono animate-pulse py-6 text-center">📜 战报撰写中…</div>
          ) : (
            <div className="text-[13px] text-slate-200/90 leading-[1.85] whitespace-pre-wrap">{body}</div>
          )}
          {live.reportState === 'fail' && (
            <div className="text-[11px] font-mono text-amber-500/70">⚠ AI 战报未生成（{live.reportErr || '接口不可用'}），上面是系统纪要。</div>
          )}

          {/* 账本：AI 写什么都改不了这里的数字 */}
          {l && (
            <div className="rounded-lg border border-edge bg-panel/60 p-2.5 space-y-1.5">
              <div className="text-[11px] font-mono text-dim/50">结算账本（判定分 {l.score}/100）</div>
              <div className="flex flex-wrap gap-x-3 text-[12px] font-mono">
                <span className="text-cyan-300/80">团队经验 +{l.teamExp}</span>
                <span className="text-emerald-300/80">活跃度 +{l.activity}</span>
                {l.currency.amount > 0 && <span className="text-amber-300/80">{l.currency.kind} +{l.currency.amount}</span>}
              </div>
              {l.rewardGranted
                ? <div className="text-[12px] font-mono text-amber-300/90">🎁 委托酬劳「{l.rewardGranted}」已入储存空间</div>
                : live.offer.reward ? <div className="text-[12px] font-mono text-dim/40">🎁 委托失利，酬劳「{live.offer.reward.name}」未发放</div> : null}
              <div className="space-y-1 pt-1 border-t border-edge/50">
                {l.members.map((m) => (
                  <div key={m.id} className="text-[12px] text-dim/70 flex flex-wrap items-baseline gap-x-2">
                    <span className="text-slate-300">{m.name}</span>
                    {m.dead && <span className="text-blood font-mono">☠ 阵亡</span>}
                    {m.injured && <span className="text-orange-400/80 font-mono">🩹 {m.injured}·{m.injuryTurns}回合</span>}
                    {m.hpLoss > 0 && !m.dead && <span className="text-blood/60 font-mono">-{m.hpLoss} HP</span>}
                    <span className="text-dim/40 font-mono">疲劳 +{m.fatigueAdd}</span>
                    {m.lootName && <span className="text-amber-300/80 font-mono">🎁 {m.lootName}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <footer className="flex items-center gap-2 p-3 border-t border-edge shrink-0">
          <span className="text-[11px] font-mono text-dim/35 mr-auto">数值已在归来时定死，重写战报不会改动它们</span>
          <button onClick={regen} disabled={busy || live.reportState === 'loading'}
            className="px-2.5 py-1 rounded border border-edge text-dim/70 text-[12px] font-mono hover:border-god/40 hover:text-god disabled:opacity-40 transition-colors">
            {live.report ? '重写战报' : '生成战报'}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default function DispatchPanel() {
  const active = useTeam((s) => s.dispatchActive);
  const history = useTeam((s) => s.dispatchHistory);
  const abort = useTeam((s) => s.abortDispatch);
  const markRead = useTeam((s) => s.markDispatchRead);
  const turn = useMisc((s) => s.turnCount);
  const [openRec, setOpenRec] = useState<string | null>(null);
  const rec = history.find((r) => r.id === openRec) ?? null;

  // 新档/久未刷新时打开就补一批委托——不然"必须先跑一个回合才有委托看"（实机踩到的空板）
  useEffect(() => { ensureBoard(turn); }, [turn]);

  return (
    <div className="space-y-4">
      {active ? <ActiveCard rec={active} turn={turn} onAbort={abort} /> : <BoardSection turn={turn} />}

      <section className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-mono text-dim/70">归来战报</span>
          <span className="text-[11px] font-mono text-dim/40">{history.length}</span>
        </div>
        {history.length === 0 ? (
          <div className="text-[12px] text-dim/35 font-mono px-1 py-1">（尚无派遣记录）</div>
        ) : (
          <div className="space-y-1">
            {[...history].reverse().map((r) => (
              <button key={r.id} onClick={() => { setOpenRec(r.id); markRead(r.id); }}
                className="w-full flex items-center gap-2 rounded border border-edge bg-panel px-2.5 py-1.5 text-left hover:border-god/30 transition-colors">
                {!r.read && <span className="w-1.5 h-1.5 rounded-full bg-blood shrink-0" title="未读" />}
                <span className={`text-[12px] font-mono font-bold px-1.5 rounded border shrink-0 ${RATING_CLS[r.ledger?.rating ?? 'E'] ?? ''}`}>{r.ledger?.rating ?? '?'}</span>
                <span className="text-[13px] text-slate-300 truncate">{r.offer.title}</span>
                <span className="text-[11px] font-mono text-dim/35 ml-auto shrink-0">
                  {r.ledger?.casualties.length ? <span className="text-blood/70 mr-1.5">☠{r.ledger.casualties.length}</span> : null}
                  第{r.ledger?.sealedAt ?? r.endTurn}回合
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {rec && <ReportModal rec={rec} onClose={() => setOpenRec(null)} />}
    </div>
  );
}
