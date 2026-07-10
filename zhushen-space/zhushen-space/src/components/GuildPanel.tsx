import { useEffect, useState } from 'react';
import { useGuild } from '../store/guildStore';
import { guildClient } from '../systems/guildClient';
import { pushSceneNotice } from '../systems/allocNotice';
import { chatReady, chatName, chatToken } from '../systems/chatIdentity';
import { useItems } from '../store/itemStore';
import type { GuildCard, GuildMember, GuildRank } from '../systems/guildProtocol';

/* 家族面板🏰（右导航）——无家族：创建 + 浏览/申请；有家族：名册/军衔 · 贡献→等级→增益 · 金库 · 编年史 · 退出/解散。
   见 指导/家族系统-设计.md。异步家族·账号级（guildStore.my 持久化）。⚠受控输入子组件全模块级（防输入法重挂）。*/

const inputCls = 'bg-void border border-edge rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-amber-400/40';
const btnGhost = 'text-[12px] font-mono py-1.5 px-3 rounded-lg border border-edge text-dim hover:text-slate-100';
const btnPrimary = 'text-[13px] font-mono py-1.5 px-4 rounded-lg border border-amber-400/50 text-amber-100 bg-amber-500/15 hover:bg-amber-500/25';
// 与 GuildDO 的 LEVEL_EXP 保持一致（进度条用）
const LEVEL_EXP = [0, 0, 5000, 15000, 35000, 70000, 130000, 230000, 400000, 650000, 1000000];
const RANK_LABEL: Record<GuildRank, string> = { leader: '会长', viceLeader: '副会长', elder: '长老', member: '成员' };

function CreateGuildForm() {
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [emblem, setEmblem] = useState('🏰');
  const [manifesto, setManifesto] = useState('');
  const create = () => { if (!name.trim() || !tag.trim()) return; guildClient.create(name.trim(), tag.trim(), emblem.trim(), manifesto.trim()); };
  return (
    <div className="rounded-xl border border-amber-500/25 bg-panel p-4 space-y-2.5">
      <div className="text-sm font-bold text-amber-100">🏰 创立家族</div>
      <div className="grid grid-cols-2 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="家族名（如 无间战队）" className={`${inputCls} w-full`} />
        <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="标签（≤6字）" className={`${inputCls} w-full`} />
      </div>
      <div className="flex gap-2">
        <input value={emblem} onChange={(e) => setEmblem(e.target.value)} placeholder="徽记(emoji)" className={`${inputCls} w-24`} />
        <input value={manifesto} onChange={(e) => setManifesto(e.target.value)} placeholder="家族宣言（一句话）" className={`${inputCls} flex-1`} />
      </div>
      <button onClick={create} disabled={!name.trim() || !tag.trim()} className={`${btnPrimary} w-full ${(!name.trim() || !tag.trim()) ? 'opacity-40' : ''}`}>创立家族（你为会长）</button>
    </div>
  );
}

function GuildBrowser({ cards, busyId }: { cards: GuildCard[]; busyId: string | null }) {
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState<'level' | 'week'>('level');
  const filtered = q.trim() ? cards.filter((c) => (c.name || '').includes(q.trim()) || (c.tag || '').includes(q.trim())) : cards;
  const ranked = [...filtered].sort((a, b) => sortBy === 'week' ? (b.weeklyContrib || 0) - (a.weeklyContrib || 0) : (b.level - a.level) || (b.members - a.members));   // 总榜=等级→人数 / 周战榜=本周贡献
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索家族名 / 标签" className={`${inputCls} flex-1`} />
        <button onClick={() => setSortBy('level')} className={`text-[11px] font-mono px-2 py-0.5 rounded border ${sortBy === 'level' ? 'border-amber-400/50 text-amber-100 bg-amber-500/15' : 'border-edge text-dim'}`}>总榜</button>
        <button onClick={() => setSortBy('week')} className={`text-[11px] font-mono px-2 py-0.5 rounded border ${sortBy === 'week' ? 'border-amber-400/50 text-amber-100 bg-amber-500/15' : 'border-edge text-dim'}`}>周战榜</button>
        <button onClick={() => guildClient.refresh()} className={btnGhost}>🔄</button>
      </div>
      {ranked.length === 0
        ? <div className="text-center text-dim/50 text-sm py-10">还没有家族，去上面创立第一个。</div>
        : <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {ranked.map((c, i) => (
              <div key={c.id} className="rounded-xl border border-edge bg-panel p-3 flex items-center gap-3">
                <div className="text-2xl shrink-0">{c.emblem || '🏰'}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-100 truncate"><span className="text-[11px] font-mono text-amber-300/60">#{i + 1}</span> {c.name} <span className="text-[11px] text-amber-300/70">[{c.tag}]</span></div>
                  <div className="text-[11px] font-mono text-dim/55">Lv.{c.level} · {c.members} 人 · 本周 {c.weeklyContrib || 0} · 会长 {c.ownerName || '道友'}</div>
                  {c.manifesto && <div className="text-[11px] text-dim/60 truncate">{c.manifesto}</div>}
                </div>
                <button onClick={() => guildClient.apply(c.id)} disabled={busyId === c.id || c.recruiting === false}
                  className={`${btnPrimary} shrink-0 ${(busyId === c.id || c.recruiting === false) ? 'opacity-40' : ''}`}>
                  {c.recruiting === false ? '不招募' : '申请加入'}
                </button>
              </div>
            ))}
          </div>}
    </div>
  );
}

function RosterRow({ m, myRole, myPid, weekly }: { m: GuildMember; myRole: GuildRank; myPid: string | undefined; weekly: boolean }) {
  const canManage = (myRole === 'leader' || myRole === 'viceLeader') && m.rank !== 'leader' && m.pid !== myPid;
  const inactive = Date.now() - (m.lastActive || 0) > 7 * 86400000;
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-edge bg-panel/50">
      <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded shrink-0 ${m.rank === 'leader' ? 'text-amber-200 border border-amber-500/40' : 'text-dim border border-edge'}`}>{RANK_LABEL[m.rank]}</span>
      <span className="text-sm text-slate-100 truncate flex-1">{m.name}{inactive && <span className="ml-1.5 text-[10px] font-mono text-dim/40">沉睡</span>}</span>
      <span className="text-[11px] font-mono text-cyan-300/60 shrink-0">{weekly ? '周' : '总'}贡献 {weekly ? m.contribWeek : m.contribTotal}</span>
      {myRole === 'leader' && m.rank !== 'leader' && m.pid !== myPid && (
        <select value={m.rank} onChange={(e) => guildClient.setRank(m.pid, e.target.value)} className={`${inputCls} text-[11px] py-0.5`}>
          <option value="member">成员</option><option value="elder">长老</option><option value="viceLeader">副会长</option>
        </select>
      )}
      {canManage && <button onClick={() => { if (confirm(`将「${m.name}」移出家族？`)) guildClient.kick(m.pid); }} className="text-blood/60 hover:text-blood text-sm px-1 shrink-0" title="踢出">✕</button>}
    </div>
  );
}

function ChestSection() {
  const chest = useGuild((s) => s.chest);
  const items = useItems((s) => s.items);
  const addItem = useItems((s) => s.addItem);
  const removeItem = useItems((s) => s.removeItem);
  const [pick, setPick] = useState('');
  const donatable = items.filter((it) => !it.equipped && !it.locked);
  const deposit = () => {
    const it = items.find((x) => x.id === pick); if (!it) return;
    guildClient.deposit(it); removeItem(it.id); setPick('');   // ⚠带完整物品快照进金库（防丢词缀）
  };
  const withdraw = (i: number) => { const c = chest[i]; if (!c) return; const { _by, _at, ...item } = c; addItem({ ...item, acquisition: '家族金库' } as any); guildClient.withdraw(i); };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className={`${inputCls} flex-1`}>
          <option value="">选背包物品捐入金库…</option>
          {donatable.map((it) => <option key={it.id} value={it.id}>{it.name}{it.gradeDesc ? `（${it.gradeDesc}）` : ''}</option>)}
        </select>
        <button onClick={deposit} disabled={!pick} className={`${btnGhost} ${!pick ? 'opacity-40' : ''}`}>捐入</button>
      </div>
      {chest.length === 0
        ? <div className="text-center text-dim/45 text-[12px] py-4">金库空空。</div>
        : <div className="space-y-1">
            {chest.map((c: any, i: number) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-edge bg-panel/50">
                <span className="text-sm text-slate-100 truncate flex-1">{c.name || '物品'}{c.gradeDesc ? ` · ${c.gradeDesc}` : ''}</span>
                <span className="text-[10px] font-mono text-dim/45 shrink-0">{c._by || ''}</span>
                <button onClick={() => withdraw(i)} className={`${btnGhost} shrink-0`}>取出</button>
              </div>
            ))}
          </div>}
    </div>
  );
}

function ChainBar() {
  const chain = useGuild((s) => s.chain);
  if (!chain || !chain.count) return null;
  const MILE = [10, 50, 200, 1000, 5000];
  const next = MILE.find((m) => m > chain.count);
  const alive = Date.now() - (chain.lastAt || 0) < 12 * 3600 * 1000;
  return (
    <div className="rounded-xl border border-orange-500/25 bg-panel p-3 flex items-center gap-3">
      <div className="text-2xl shrink-0">🔥</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-orange-100">家族连击 {chain.count} 连{!alive && <span className="ml-1 text-[10px] text-dim/40">已断</span>}</div>
        <div className="text-[11px] font-mono text-dim/60">{next ? `距下一里程碑 ${next}（还差 ${next - chain.count}）· 12h 内继续击杀强敌别断链` : '已达最高里程碑！'} · 最佳 {chain.best}</div>
      </div>
    </div>
  );
}

function WeekTaskSection() {
  const wt = useGuild((s) => s.weekTasks);
  const myPid = useGuild((s) => s.me?.playerId);
  if (!wt) return null;
  const allDone = wt.goals.every((g) => g.cur >= g.target);
  const claimed = !!myPid && wt.claimed.includes(myPid);
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-panel p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-[13px] font-bold text-slate-100">📅 本周家族任务</div>
        <div className="flex-1" />
        <button onClick={() => guildClient.claimTask()} disabled={!allDone || claimed}
          className={`text-[12px] font-mono py-1 px-3 rounded-lg border ${(!allDone || claimed) ? 'border-edge text-dim/40 cursor-not-allowed' : 'border-emerald-500/50 text-emerald-300 hover:bg-emerald-900/25'}`}>
          {claimed ? '已领取' : allDone ? '领取奖励' : '未完成'}
        </button>
      </div>
      {wt.goals.map((g, i) => {
        const pct = g.target > 0 ? Math.min(100, Math.round((g.cur / g.target) * 100)) : 100;
        return (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-dim/70">{g.label}</span>
              <span className="text-emerald-200/90">{g.cur} / {g.target}</span>
            </div>
            <div className="h-1.5 rounded-full bg-void border border-edge overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500/70 to-green-400/90 transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      {wt.rewardCoin ? <div className="text-[11px] font-mono text-emerald-300/70">完成后全员可领 {wt.rewardCoin} 乐园币（每周一次·周一重置）</div> : null}
    </div>
  );
}

function MyGuildView({ cards }: { cards: GuildCard[] }) {
  const my = useGuild((s) => s.my)!;
  const exp = useGuild((s) => s.exp);
  const online = useGuild((s) => s.online);
  const roster = useGuild((s) => s.roster);
  const chronicle = useGuild((s) => s.chronicle);
  const currency = useItems((s) => s.currency);
  const adjustCurrency = useItems((s) => s.adjustCurrency);
  const [donate, setDonate] = useState(500);
  const [rankView, setRankView] = useState<'total' | 'week'>('total');
  const myPid = useGuild((s) => s.me?.playerId);

  const cur = LEVEL_EXP[my.level] ?? 0;
  const next = LEVEL_EXP[my.level + 1] ?? null;
  const pct = next ? Math.max(2, Math.min(100, Math.round(((exp - cur) / (next - cur)) * 100))) : 100;

  const doDonate = () => {
    const amt = Math.max(1, Math.round(donate || 0));
    if ((currency.乐园币 ?? 0) < amt) return;
    adjustCurrency('乐园币', -amt, `家族·${my.name}·捐献`);
    guildClient.contribute('donate', amt, '乐园币捐献');
  };

  return (
    <div className="space-y-4">
      {/* 家族头 */}
      <div className="rounded-xl border border-amber-500/25 bg-panel p-4">
        <div className="flex items-center gap-3">
          <div className="text-4xl shrink-0">{my.emblem || '🏰'}</div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-amber-100 truncate">{my.name} <span className="text-[12px] text-amber-300/70">[{my.tag}]</span></div>
            <div className="text-[11px] font-mono text-dim/55">我的军衔：{RANK_LABEL[my.role]} · 在线 {online} 人</div>
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] font-mono mb-1">
            <span className="text-amber-300/70">家族等级 Lv.{my.level}</span>
            <span className="text-amber-200/90">{next ? `${exp} / ${next}` : `${exp}（满级）`}</span>
          </div>
          <div className="h-2 rounded-full bg-void border border-edge overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-500/70 to-yellow-400/90 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {my.perks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {my.perks.map((p) => <span key={p.key} className="text-[10px] font-mono text-emerald-300/80 px-1.5 py-0.5 rounded border border-emerald-500/25">✦ {p.label}</span>)}
          </div>
        )}
      </div>

      {/* 捐献贡献 */}
      <div className="rounded-xl border border-edge bg-panel p-3 space-y-2">
        <div className="text-[13px] font-bold text-slate-100">捐献乐园币 → 家族贡献 / 升级</div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-amber-300/70">💰 {currency.乐园币}</span>
          <input type="number" value={donate} onChange={(e) => setDonate(Math.max(1, Number(e.target.value) || 0))} className={`${inputCls} w-28`} />
          <button onClick={doDonate} disabled={(currency.乐园币 ?? 0) < donate} className={`${btnPrimary} ${(currency.乐园币 ?? 0) < donate ? 'opacity-40' : ''}`}>捐献</button>
        </div>
      </div>

      {/* 家族连击 */}
      <ChainBar />

      {/* 本周家族任务 */}
      <WeekTaskSection />

      {/* 名册 + 贡献榜 */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="text-[13px] font-bold text-slate-100">名册（{roster.length}）</div>
          <div className="flex-1" />
          <button onClick={() => setRankView('total')} className={`text-[11px] font-mono px-2 py-0.5 rounded border ${rankView === 'total' ? 'border-amber-400/50 text-amber-100 bg-amber-500/15' : 'border-edge text-dim'}`}>总榜</button>
          <button onClick={() => setRankView('week')} className={`text-[11px] font-mono px-2 py-0.5 rounded border ${rankView === 'week' ? 'border-amber-400/50 text-amber-100 bg-amber-500/15' : 'border-edge text-dim'}`}>周榜</button>
        </div>
        {[...roster].sort((a, b) => (rankView === 'week' ? b.contribWeek - a.contribWeek : b.contribTotal - a.contribTotal)).map((m) => <RosterRow key={m.pid} m={m} myRole={my.role} myPid={myPid} weekly={rankView === 'week'} />)}
      </div>

      {/* 家族战 · 本周贡献榜（各家族本周贡献 PK） */}
      {cards.length > 1 && (
        <div className="space-y-1.5">
          <div className="text-[13px] font-bold text-slate-100">⚔️ 家族战 · 本周榜</div>
          {[...cards].sort((a, b) => (b.weeklyContrib || 0) - (a.weeklyContrib || 0)).slice(0, 6).map((c, i) => (
            <div key={c.id} className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border ${c.id === my.id ? 'border-amber-400/40 bg-amber-500/10' : 'border-edge bg-panel/50'}`}>
              <span className="text-[11px] font-mono text-amber-300/60 w-6 shrink-0">#{i + 1}</span>
              <span className="text-base shrink-0">{c.emblem || '🏰'}</span>
              <span className="text-sm text-slate-100 truncate flex-1">{c.name}{c.id === my.id && <span className="ml-1 text-[10px] text-amber-300/70">我族</span>}</span>
              <span className="text-[11px] font-mono text-orange-300/70 shrink-0">本周 {c.weeklyContrib || 0}</span>
            </div>
          ))}
        </div>
      )}

      {/* 金库 */}
      <div className="space-y-1.5">
        <div className="text-[13px] font-bold text-slate-100">🏦 家族金库</div>
        <ChestSection />
      </div>

      {/* 编年史 */}
      {chronicle.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[13px] font-bold text-slate-100">📜 家族编年史</div>
          <div className="rounded-xl border border-edge bg-panel/50 p-2 space-y-1 max-h-40 overflow-y-auto">
            {chronicle.slice(0, 20).map((e, i) => <div key={i} className="text-[11px] font-mono text-dim/70">· {e.text}</div>)}
          </div>
        </div>
      )}

      {/* 退出 / 解散 */}
      <div className="flex items-center gap-2 pt-1">
        <div className="flex-1" />
        {my.role === 'leader'
          ? <button onClick={() => { if (confirm('解散家族？此操作不可撤销，所有成员将退出。')) guildClient.disband(); }} className="text-[12px] font-mono py-1.5 px-3 rounded-lg border border-blood/40 text-blood/80 hover:bg-blood/10">解散家族</button>
          : <button onClick={() => { if (confirm('退出当前家族？')) guildClient.leave(); }} className={btnGhost}>退出家族</button>}
      </div>
    </div>
  );
}

/** 每日家族津贴（stipend perk 生效）：有该 perk 且今日未领 → 发乐园币 + 场外通报。每日一次（localStorage 日期门）。 */
function claimDailyStipend() {
  try {
    const my = useGuild.getState().my; if (!my) return;
    const perk = (my.perks || []).find((p) => p.key === 'stipend'); const amt = perk ? Math.round(perk.value) : 0;
    if (!amt) return;
    const today = new Date().toISOString().slice(0, 10);
    const KEY = 'drpg-guild-stipend';
    if (localStorage.getItem(KEY) === today) return;
    localStorage.setItem(KEY, today);
    useItems.getState().adjustCurrency('乐园币', amt, `家族·${my.name}·每日津贴`);
    pushSceneNotice(`【场外·家族】今日家族津贴 +${amt} 乐园币（家族「${my.name}」Lv.${my.level} 增益）`);
  } catch { /* 非阻塞 */ }
}

export default function GuildPanel({ onClose }: { onClose: () => void }) {
  const my = useGuild((s) => s.my);
  const status = useGuild((s) => s.status);
  const error = useGuild((s) => s.error);
  const [cards, setCards] = useState<GuildCard[]>([]);

  useEffect(() => {
    if (chatReady() && chatToken()) {
      guildClient.openList(chatName() || '道友', chatToken(), setCards);
      if (my) guildClient.openGuild(my.id, chatName() || '道友', chatToken());
    }
    claimDailyStipend();
    return () => guildClient.leaveAll();
  }, []);   // eslint-disable-line

  const gated = !chatReady() || !chatToken();

  return (
    <div className="fixed inset-0 z-[70] bg-void/95 backdrop-blur-sm flex flex-col">
      <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-amber-500/20 bg-panel">
        <span className="text-lg">🏰</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-amber-100">家族</div>
          <div className="text-[11px] font-mono text-amber-300/50">{my ? `${my.name} [${my.tag}]` : '异步契约者战队 · 归属 / 共享进度 / 家族增益'}</div>
        </div>
        <button onClick={onClose} className="text-dim/50 hover:text-blood text-xl px-1">✕</button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {gated
          ? <div className="text-center text-dim/50 text-sm py-16">家族需先登录 Discord（聊天室 / 联机身份）。</div>
          : my
            ? <MyGuildView cards={cards} />
            : <div className="space-y-4">
                <CreateGuildForm />
                <div className="text-[12px] font-mono text-dim/55">{status === 'connected' ? `🏆 家族总榜（${cards.length} 个家族·按等级排名）` : status === 'connecting' ? '连接中…' : ''}</div>
                <GuildBrowser cards={cards} busyId={null} />
              </div>}
      </div>

      {error && <div className="shrink-0 px-4 py-2 text-[13px] font-mono border-t border-amber-500/30 text-amber-200/80 bg-amber-500/5">{error}</div>}
    </div>
  );
}
