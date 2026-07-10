import { useEffect, useState } from 'react';
import { useGuild, type GuildSummary } from '../store/guildStore';
import { AutoText } from './AutoText';
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

/* 家族战·确定性对决：种子=我族id+对手id+当日 → 同对手同日结果固定（防 reroll）。战力对决 + ±30% 种子扰动。 */
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function strHash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h >>> 0; }

function WarSection({ cards, my }: { cards: GuildCard[]; my: GuildSummary }) {
  const wars = useGuild((s) => s.wars);
  const [result, setResult] = useState('');
  const myPower = cards.find((c) => c.id === my.id)?.power || my.level * 500;
  const opponents = cards.filter((c) => c.id !== my.id);
  const declareWar = (opp: GuildCard) => {
    const theirPower = opp.power || opp.level * 500;
    const day = Math.floor(Date.now() / 86400000);
    const rng = mulberry32(strHash(my.id + opp.id + day));
    const myRoll = myPower * (0.7 + rng() * 0.6);
    const theirRoll = theirPower * (0.7 + rng() * 0.6);
    const win = myRoll >= theirRoll;
    const myScore = Math.round(myRoll), theirScore = Math.round(theirRoll);
    guildClient.reportWar(win, opp.name, myScore, theirScore);
    setResult(`${win ? '⚔️ 大胜' : '💢 战败'}「${opp.name}」 · 我族 ${myScore} vs ${theirScore}${win ? '（家族贡献 +）' : ''}`);
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="text-[13px] font-bold text-slate-100">⚔️ 家族战</div>
        <span className="text-[11px] font-mono text-orange-300/70">战力 {myPower}</span>
        {wars && <span className="text-[11px] font-mono text-dim/55">· {wars.wins}胜 {wars.losses}负</span>}
      </div>
      {result && <div className="text-[12px] font-mono text-amber-200/80 px-1">{result}</div>}
      {opponents.length === 0
        ? <div className="text-[11px] text-dim/45 px-1">暂无其他家族可宣战。</div>
        : <div className="space-y-1">
            {[...opponents].sort((a, b) => (b.power || 0) - (a.power || 0)).slice(0, 6).map((c) => (
              <div key={c.id} className="flex items-center gap-2 px-2.5 py-1 rounded-lg border border-edge bg-panel/50">
                <span className="text-base shrink-0">{c.emblem || '🏰'}</span>
                <span className="text-sm text-slate-100 truncate flex-1">{c.name}</span>
                <span className="text-[11px] font-mono text-orange-300/60 shrink-0">战力 {c.power || 0}</span>
                <button onClick={() => declareWar(c)} className="text-[11px] font-mono py-1 px-2.5 rounded-lg border border-blood/40 text-blood/80 hover:bg-blood/10 shrink-0">宣战</button>
              </div>
            ))}
          </div>}
      <div className="text-[10px] font-mono text-dim/40 px-1">每日至多 5 次 · 按战力确定性对决（同对手同日不可 reroll）</div>
    </div>
  );
}

const MAX_BUILDING_LV_C = 10;
function buildingCost(level: number) { return level * 1000; }   // 建设到下一级花费·乐园币（成员集资）

function BuildingEditModal({ b, onClose }: { b: any; onClose: () => void }) {
  const [name, setName] = useState(b.name || '');
  const [desc, setDesc] = useState(b.desc || '');
  const [effect, setEffect] = useState(b.effect || '');
  const save = () => { guildClient.editBuilding(b.id, { name: name.trim() || b.name, desc: desc.trim(), effect: effect.trim() }); onClose(); };
  const ta = 'w-full bg-void border border-edge rounded-lg px-3 py-2 text-[13px] text-slate-200 resize-y focus:outline-none focus:border-amber-400/40';
  return (
    <div className="fixed inset-0 z-[85] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] flex flex-col">
        <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-amber-500/20 bg-panel">
          <span className="text-base">🏛</span><div className="flex-1 text-sm font-bold text-amber-100">据点建筑</div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </header>
        <div className="p-4 space-y-3">
          <label className="flex flex-col gap-1"><span className="text-[11px] font-mono text-dim/55">名称</span><input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} w-full`} /></label>
          <label className="flex flex-col gap-1"><span className="text-[11px] font-mono text-dim/55">描述（外观 / 功能）</span><textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className={ta} /></label>
          <label className="flex flex-col gap-1"><span className="text-[11px] font-mono text-dim/55">效果 / 象征（纯风味·非数值）</span><textarea value={effect} onChange={(e) => setEffect(e.target.value)} rows={2} className={ta} /></label>
        </div>
        <footer className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-amber-500/20 bg-panel"><div className="flex-1" /><button onClick={onClose} className={btnGhost}>取消</button><button onClick={save} className={btnPrimary}>保存</button></footer>
      </div>
    </div>
  );
}

function BaseSection({ onGenerateBuildings, canManage }: { onGenerateBuildings?: (p: string) => void | Promise<void>; canManage: boolean }) {
  const base = useGuild((s) => s.base);
  const my = useGuild((s) => s.my)!;
  const currency = useItems((s) => s.currency);
  const adjustCurrency = useItems((s) => s.adjustCurrency);
  const [tendency, setTendency] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const buildings: any[] = (base && Array.isArray(base.buildings)) ? base.buildings : [];
  const upgrade = (b: any) => {
    const lv = b.level || 1;
    if (lv >= MAX_BUILDING_LV_C) return;
    const cost = buildingCost(lv);
    if ((currency.乐园币 ?? 0) < cost) return;
    adjustCurrency('乐园币', -cost, `家族·${my.name}·据点·${b.name}`);
    guildClient.upgradeBuilding(b.id);
  };
  const gen = async () => { if (!onGenerateBuildings || genBusy) return; setGenBusy(true); try { await onGenerateBuildings(tendency.trim()); } finally { setGenBusy(false); } };
  const editing = editId ? buildings.find((x) => x.id === editId) : null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-[13px] font-bold text-slate-100">🏯 家族据点</div>
        <div className="flex-1" />
        {canManage && <button onClick={() => guildClient.addBuilding({ name: '新建筑' })} className={btnGhost}>＋ 添加</button>}
      </div>
      {canManage && (
        <div className="flex gap-2">
          <input value={tendency} onChange={(e) => setTendency(e.target.value)} placeholder="✨AI 生成建筑：如「主神空间悬浮要塞·冷兵器演武场」" className={`${inputCls} flex-1`} />
          <button onClick={gen} disabled={!onGenerateBuildings || genBusy} className={`${btnPrimary} ${(!onGenerateBuildings || genBusy) ? 'opacity-40' : ''}`}>{genBusy ? '生成中…' : '生成'}</button>
        </div>
      )}
      {buildings.length === 0
        ? <div className="text-[11px] text-dim/45 px-1">还没有建筑。{canManage ? '「添加」手写，或用 AI 生成据点蓝图。' : '等会长 / 长老规划据点。'}</div>
        : buildings.map((b) => {
            const lv = b.level || 1;
            const cost = buildingCost(lv);
            const max = lv >= MAX_BUILDING_LV_C;
            const poor = (currency.乐园币 ?? 0) < cost;
            return (
              <div key={b.id} className="rounded-xl border border-edge bg-panel p-2.5 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-100 truncate flex-1">🏛 {b.name} <span className="text-amber-300/70 font-mono text-[11px]">Lv.{lv}</span>{b.aiGen && <span className="ml-1 text-[10px] text-cyan-300/60">AI</span>}</span>
                  {canManage && <button onClick={() => setEditId(b.id)} className="text-[12px] font-mono text-dim/60 hover:text-cyan-100 shrink-0" title="编辑">✎</button>}
                  {canManage && <button onClick={() => { if (confirm(`拆除「${b.name}」？`)) guildClient.removeBuilding(b.id); }} className="text-blood/50 hover:text-blood text-sm shrink-0" title="拆除">✕</button>}
                  <button onClick={() => upgrade(b)} disabled={max || poor} className={`text-[11px] font-mono py-1 px-2 rounded-lg border shrink-0 ${(max || poor) ? 'border-edge text-dim/40' : 'border-amber-400/50 text-amber-100 bg-amber-500/15 hover:bg-amber-500/25'}`}>{max ? '满级' : `建设 ${cost}`}</button>
                </div>
                {b.desc && <div className="text-[11px] text-dim/60">{b.desc}</div>}
                {b.effect && <div className="text-[11px] text-emerald-300/60">✦ {b.effect}</div>}
              </div>
            );
          })}
      {editing && <BuildingEditModal b={editing} onClose={() => setEditId(null)} />}
    </div>
  );
}

function GuildSettingsModal({ onClose }: { onClose: () => void }) {
  const my = useGuild((s) => s.my)!;
  const meta = useGuild((s) => s.meta);
  const [name, setName] = useState(my.name);
  const [tag, setTag] = useState(my.tag);
  const [emblem, setEmblem] = useState(my.emblem || '🏰');
  const [manifesto, setManifesto] = useState(meta?.manifesto || '');
  const [recruiting, setRecruiting] = useState(meta?.recruiting !== false);
  const save = () => {
    guildClient.edit({ name: name.trim() || my.name, tag: tag.trim() || my.tag, emblem: emblem.trim(), manifesto: manifesto.trim(), recruiting });
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[85] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] flex flex-col">
        <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-amber-500/20 bg-panel">
          <span className="text-base">⚙</span>
          <div className="flex-1 text-sm font-bold text-amber-100">家族设置</div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </header>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1"><span className="text-[11px] font-mono text-dim/55">家族名</span><input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} w-full`} /></label>
            <label className="flex flex-col gap-1"><span className="text-[11px] font-mono text-dim/55">标签</span><input value={tag} onChange={(e) => setTag(e.target.value)} className={`${inputCls} w-full`} /></label>
          </div>
          <label className="flex flex-col gap-1"><span className="text-[11px] font-mono text-dim/55">徽记(emoji)</span><input value={emblem} onChange={(e) => setEmblem(e.target.value)} className={`${inputCls} w-24`} /></label>
          <label className="flex flex-col gap-1"><span className="text-[11px] font-mono text-dim/55">家族宣言</span><textarea value={manifesto} onChange={(e) => setManifesto(e.target.value)} rows={2} className="w-full bg-void border border-edge rounded-lg px-3 py-2 text-[13px] text-slate-200 resize-y focus:outline-none focus:border-amber-400/40" /></label>
          <label className="flex items-center gap-2 text-[13px] text-slate-200 cursor-pointer"><input type="checkbox" checked={recruiting} onChange={(e) => setRecruiting(e.target.checked)} className="accent-amber-500" />开放招募（关闭后广场里显"不招募"）</label>
        </div>
        <footer className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-amber-500/20 bg-panel">
          <div className="flex-1" />
          <button onClick={onClose} className={btnGhost}>取消</button>
          <button onClick={save} className={btnPrimary}>保存</button>
        </footer>
      </div>
    </div>
  );
}

function MyGuildView({ cards, onGenerateBuildings }: { cards: GuildCard[]; onGenerateBuildings?: (p: string) => void | Promise<void> }) {
  const my = useGuild((s) => s.my)!;
  const exp = useGuild((s) => s.exp);
  const online = useGuild((s) => s.online);
  const roster = useGuild((s) => s.roster);
  const chronicle = useGuild((s) => s.chronicle);
  const hallOfFame = useGuild((s) => s.hallOfFame);
  const currency = useItems((s) => s.currency);
  const adjustCurrency = useItems((s) => s.adjustCurrency);
  const [donate, setDonate] = useState(500);
  const [rankView, setRankView] = useState<'total' | 'week'>('total');
  const [settingsOpen, setSettingsOpen] = useState(false);
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
          {my.role === 'leader' && <button onClick={() => setSettingsOpen(true)} className="text-lg text-dim/50 hover:text-amber-200 shrink-0" title="家族设置">⚙</button>}
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

      {/* 家族战 · 宣战对决 */}
      <WarSection cards={cards} my={my} />

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

      {/* 家族据点 */}
      <BaseSection onGenerateBuildings={onGenerateBuildings} canManage={my.role !== 'member'} />

      {/* 编年史 */}
      {chronicle.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[13px] font-bold text-slate-100">📜 家族编年史</div>
          <div className="rounded-xl border border-edge bg-panel/50 p-2 space-y-1 max-h-40 overflow-y-auto">
            {chronicle.slice(0, 20).map((e, i) => <div key={i} className="text-[11px] font-mono text-dim/70">· <AutoText text={e.text} /></div>)}
          </div>
        </div>
      )}

      {/* 家族丰碑 · 名人堂（创立者 + 离场英灵铭记） */}
      {hallOfFame.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[13px] font-bold text-slate-100">🪦 家族丰碑</div>
          <div className="rounded-xl border border-amber-500/15 bg-panel/50 p-2 space-y-1 max-h-40 overflow-y-auto">
            {hallOfFame.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                <span>{h.reason === 'found' ? '👑' : '🕯'}</span>
                <span className="text-slate-200 truncate flex-1">{h.name}</span>
                <span className="text-dim/50 shrink-0">{h.reason === 'found' ? '创立者' : `${h.reason === 'kicked' ? '除名' : '退隐'} · 贡献 ${h.contribTotal}`}</span>
              </div>
            ))}
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

      {settingsOpen && <GuildSettingsModal onClose={() => setSettingsOpen(false)} />}
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

export default function GuildPanel({ onClose, onGenerateBuildings }: { onClose: () => void; onGenerateBuildings?: (p: string) => void | Promise<void> }) {
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
            ? <MyGuildView cards={cards} onGenerateBuildings={onGenerateBuildings} />
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
