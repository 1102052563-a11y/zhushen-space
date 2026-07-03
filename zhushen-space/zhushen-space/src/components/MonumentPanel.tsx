import { useEffect, useMemo, useState } from 'react';
import { useMonument, type MonumentEntry } from '../store/monumentStore';
import { useNpc, hasRealNpcName, type NpcRecord } from '../store/npcStore';
import {
  buildMonumentSnapshot, buildNpcMonumentSnapshot, enshrineCurrentPlayer, enshrineNpc, regenerateEulogy,
  summonMonument, dismissMonument,
} from '../systems/monument';
import { useMonumentCloud, pullMonumentCloud, syncMonumentCloud, initMonumentCloudSync } from '../systems/monumentCloud';
import { discordLoggedIn, discordLogin, fetchChatIdentity, chatReady, chatName, chatDisplayUid } from '../systems/chatIdentity';
import { EntityCard, EntityDetailModal, type EntityKind } from './EntityDetail';

/* 纪念丰碑：把过往主角铭刻入碑（全量面板 + AI 生平总结 + 结语），跨存档常驻；
   在任何后续存档里可「召唤」入碑英灵成临时在场队友，或「遣散」。本地功能、无需登录。 */

const EQUIP_CATS = new Set(['武器', '防具', '饰品', '法宝', '装备']);
function itemKind(it: any): EntityKind { return EQUIP_CATS.has(String(it?.category || it?.slot || '')) ? 'equip' : 'item'; }
const ATTR_LABEL: Record<string, string> = { str: '力', agi: '敏', con: '体', int: '智', cha: '魅', luck: '幸' };

function Avatar({ src, size = 40 }: { src?: string; size?: number }) {
  return src
    ? <img src={src} alt="" className="rounded-lg object-cover shrink-0" style={{ width: size, height: size }} />
    : <span className="rounded-lg bg-panel grid place-items-center shrink-0" style={{ width: size, height: size, fontSize: size * 0.5 }}>🪦</span>;
}

function ChipRow({ label, items }: { label: string; items: any[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold text-god/70 mb-1">{label}（{items.length}）</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((x: any, i: number) => (
          <span key={i} className="px-2 py-0.5 rounded-md text-[11px] bg-panel/60 border border-edge text-slate-200">{x?.name || x?.title || '—'}</span>
        ))}
      </div>
    </div>
  );
}

export default function MonumentPanel({ onClose }: { onClose: () => void }) {
  const entries = useMonument((s) => s.entries);
  const removeEntry = useMonument((s) => s.removeEntry);
  const npcs = useNpc((s) => s.npcs);

  const [view, setView] = useState<'monument' | 'summoned'>('monument');
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [detail, setDetail] = useState<MonumentEntry | null>(null);
  const [sub, setSub] = useState<{ kind: EntityKind; data: any } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [flash, setFlash] = useState('');
  const [enshrineMode, setEnshrineMode] = useState<'player' | 'npc'>('player');  // 立碑来源：主角 / NPC
  const [enshrineNpcId, setEnshrineNpcId] = useState('');

  // 云同步（与聊天室共用 Discord 身份）
  const cloud = useMonumentCloud();
  const [loggedIn, setLoggedIn] = useState(() => discordLoggedIn());
  const [cloudBusy, setCloudBusy] = useState(false);
  // 进场：已登录则自动拉取云端并入 + 启用自动上传
  useEffect(() => {
    (async () => {
      if (!discordLoggedIn()) return;
      try {
        if (!chatReady()) await fetchChatIdentity();
        initMonumentCloudSync();
        await pullMonumentCloud();
      } catch { /* 失败留在未登录态，可手动重试 */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doCloudLogin = async () => {
    setCloudBusy(true);
    try {
      await discordLogin();
      setLoggedIn(true);
      await fetchChatIdentity();
      initMonumentCloudSync();
      await pullMonumentCloud();
    } catch (e: any) { setFlash(e?.message || '登录失败'); }
    setCloudBusy(false);
  };
  const doCloudSync = async () => { setCloudBusy(true); await syncMonumentCloud(); setCloudBusy(false); };

  const list = useMemo(() => Object.values(entries).sort((a, b) => b.enshrinedAt - a.enshrinedAt), [entries]);
  const summonedByMon = useMemo(() => {
    const m = new Map<string, NpcRecord>();
    for (const r of Object.values(npcs)) if (r.monumentId) m.set(r.monumentId, r);
    return m;
  }, [npcs]);
  const summoned = useMemo(() => Object.values(npcs).filter((r) => !!r.monumentId), [npcs]);
  const eligibleNpcs = useMemo(() => Object.values(npcs).filter((r) => hasRealNpcName(r)), [npcs]);   // 可入碑的 NPC（有名字，含离场/已陨落——丰碑本就为悼念）
  const preview = !showPreview ? null
    : enshrineMode === 'npc'
      ? (enshrineNpcId ? buildNpcMonumentSnapshot(enshrineNpcId) : null)
      : buildMonumentSnapshot();
  // NPC 模式默认选中第一个
  useEffect(() => {
    if (showPreview && enshrineMode === 'npc' && !enshrineNpcId && eligibleNpcs[0]) setEnshrineNpcId(eligibleNpcs[0].id);
  }, [showPreview, enshrineMode, enshrineNpcId, eligibleNpcs]);
  // 实时反映 detail 条目的最新状态（结语生成完成后刷新）
  const detailLive = detail ? entries[detail.id] || detail : null;

  const toast = (m: string) => { setFlash(m); setTimeout(() => setFlash((c) => (c === m ? '' : '')), 2200); };

  const doEnshrine = async () => {
    setBusy(true);
    try {
      const id = enshrineMode === 'npc' ? await enshrineNpc(enshrineNpcId) : await enshrineCurrentPlayer();
      if (!id) toast(enshrineMode === 'npc' ? '请选择一个有效 NPC' : '未检测到主角——请先创建/进入你的角色');
      else { toast('已铭刻入碑 · 正在撰写生平结语…'); setShowPreview(false); }
    } catch { toast('入碑失败'); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[85dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        {/* 顶栏 */}
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/70 text-lg">🪦</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">纪念丰碑</div>
            <div className="text-[11px] font-mono text-dim/60">{list.length} 位英灵入碑 · 跨存档常驻 · 可召唤入队</div>
          </div>
          <button onClick={() => setShowPreview((v) => !v)} className="px-3 py-1.5 rounded-lg text-[13px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 transition-colors">
            {showPreview ? '收起' : '🗿 立碑铭刻'}
          </button>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {/* 云同步条（与聊天室共用 Discord 身份；登录后自动拉取并入 + 变更自动上传）*/}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-edge bg-panel/20 text-[12px]">
          <span className="text-god/70">☁</span>
          {!loggedIn ? (
            <>
              <span className="text-dim/60">云同步丰碑 · 跨设备备份（用 Discord 验证身份）</span>
              <button onClick={doCloudLogin} disabled={cloudBusy} className="ml-auto px-3 py-1 rounded-lg text-[12px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 transition-colors">{cloudBusy ? '登录中…' : '用 Discord 登录'}</button>
            </>
          ) : (
            <>
              <span className="text-dim/55 font-mono shrink-0">{chatName() || '道友'}<span className="text-god/45"> #{chatDisplayUid()}</span></span>
              <span className={`truncate ${cloud.status === 'error' ? 'text-amber-400/80' : cloud.status === 'syncing' ? 'text-god/70' : 'text-dim/45'}`}>{cloud.status === 'syncing' ? '同步中…' : (cloud.msg || (cloud.lastSync ? `已同步 ${new Date(cloud.lastSync).toLocaleTimeString()}` : '已登录'))}</span>
              <button onClick={doCloudSync} disabled={cloudBusy} className="ml-auto shrink-0 px-3 py-1 rounded-lg text-[12px] font-semibold bg-god/15 border border-god/40 text-god hover:bg-god/25 disabled:opacity-40 transition-colors">{cloudBusy ? '同步中…' : '☁ 同步'}</button>
            </>
          )}
        </div>

        {/* 立碑表单（主角 / NPC 皆可，全量面板 + AI 生平结语）*/}
        {showPreview && (
          <div className="shrink-0 px-4 py-3 border-b border-edge bg-panel/30 space-y-2.5">
            {/* 来源切换：主角 / NPC */}
            <div className="flex items-center gap-1.5">
              {([['player', '🗿 主角'], ['npc', '📇 NPC']] as const).map(([v, label]) => (
                <button key={v} onClick={() => setEnshrineMode(v)} className={`px-3 py-1 rounded-lg text-[12px] transition-colors ${enshrineMode === v ? 'bg-god/20 border border-god/40 text-god font-semibold' : 'border border-edge text-dim/70 hover:text-god'}`}>{label}</button>
              ))}
              {enshrineMode === 'npc' && (
                eligibleNpcs.length === 0
                  ? <span className="text-[11px] text-amber-400/80 ml-1">暂无可入碑的 NPC（先结识有名字的角色）</span>
                  : <select value={enshrineNpcId} onChange={(e) => setEnshrineNpcId(e.target.value)} className="flex-1 min-w-0 bg-void border border-edge rounded-lg px-2 py-1 text-[12px] text-slate-100 outline-none focus:border-god/50">
                      {eligibleNpcs.map((r) => <option key={r.id} value={r.id}>{r.name}{r.realm ? `·${r.realm.split('|')[0]}` : ''}{r.isDead ? '（已陨落）' : ''}</option>)}
                    </select>
              )}
            </div>
            {!preview?.name ? (
              <div className="text-[12px] text-amber-400/80">{enshrineMode === 'npc' ? '请选择一个 NPC。' : '未检测到主角——请先创建/进入你的角色，再铭刻入碑。'}</div>
            ) : (
              <>
                <div className="text-[12px] text-dim/70 leading-relaxed">将把 <span className="text-slate-100 font-semibold">{preview.name}</span><span className="text-dim/50"> · {preview.line || ''}</span> 的**完整面板**铭刻入碑（六维/装备/储存/技能/天赋/称号/副职业/经历等，<span className="text-god/80">全部信息不丢</span>），并由 AI（与主角演化共用接口）撰写其生平总结与结语。</div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-dim/60">
                  <span>技能 {preview.skills?.length || 0}</span><span>天赋 {preview.traits?.length || 0}</span>
                  <span>称号 {preview.titles?.length || 0}</span>{enshrineMode === 'player' && <span>成就 {preview.achievements?.length || 0}</span>}
                  <span>副职 {preview.subProfessions?.length || 0}</span><span>装备 {preview.equipment?.length || 0}</span>
                  <span>储存 {preview.items?.length || 0}</span><span>经历 {preview.deedLog?.length || 0}</span>
                </div>
                <button onClick={doEnshrine} disabled={busy} className="px-4 py-1.5 rounded-lg text-[13px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-40 transition-colors">{busy ? '铭刻中…' : '🪦 确认立碑'}</button>
              </>
            )}
          </div>
        )}

        {flash && <div className="shrink-0 px-4 pt-2 text-[12px] font-mono text-god/80">{flash}</div>}

        {/* 分块：碑林 / 已召唤 */}
        <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-edge bg-panel/40 text-[13px]">
          {([['monument', `🗿 碑林${list.length ? ' · ' + list.length : ''}`], ['summoned', `⚔ 已召唤${summoned.length ? ' · ' + summoned.length : ''}`]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-lg transition-colors ${view === v ? 'bg-god/20 border border-god/40 text-god font-semibold' : 'border border-transparent text-dim/70 hover:text-god'}`}>{label}</button>
          ))}
        </div>

        {view === 'monument' ? (
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
            {list.length === 0 && <div className="text-center text-dim/40 text-xs font-mono py-12">— 碑林空寂 · 点右上「立碑铭刻当前主角」镌刻第一位英灵 —</div>}
            {list.map((e) => {
              const s = e.snapshot;
              const summonedNpc = summonedByMon.get(e.id);
              return (
                <div key={e.id} className="rounded-xl border border-edge bg-panel/30 p-3 space-y-2">
                  <div className="flex items-center gap-2.5">
                    <Avatar src={s.avatar} size={40} />
                    <button onClick={() => setDetail(e)} className="flex-1 min-w-0 text-left">
                      <div className="font-semibold text-slate-100 truncate">{s.name}</div>
                      <div className="text-[11px] font-mono text-dim/55 truncate">{s.line || [s.tier, s.profession].filter(Boolean).join('·')}</div>
                      <div className="text-[10px] font-mono text-dim/40 truncate">入碑于 {e.world || '主神空间'}{e.turn ? ` · 第 ${e.turn} 回合` : ''}</div>
                    </button>
                    {e.eulogyStatus === 'pending' && <span className="text-[10px] font-mono text-god/60 shrink-0 animate-pulse">✍️ 结语中</span>}
                    {e.eulogyStatus === 'error' && <button onClick={() => regenerateEulogy(e.id)} className="text-[10px] font-mono text-amber-400/80 shrink-0 hover:text-amber-300">⚠ 重试</button>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setDetail(e)} className="px-2.5 py-1 rounded-lg text-[12px] border border-edge text-dim/70 hover:text-god hover:border-god/40 transition-colors">详情</button>
                    {summonedNpc ? (
                      <button onClick={() => dismissMonument(summonedNpc.id)} className="ml-auto px-3 py-1 rounded-lg text-[12px] font-semibold border border-blood/40 text-blood/80 hover:bg-blood/15 transition-colors">遣散</button>
                    ) : (
                      <button onClick={() => summonMonument(e)} className="ml-auto px-3 py-1 rounded-lg text-[12px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 transition-colors">⚔ 召唤入队</button>
                    )}
                    {confirmDel === e.id ? (
                      <span className="flex items-center gap-1">
                        <button onClick={() => { removeEntry(e.id); setConfirmDel(null); }} className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-blood/20 border border-blood/40 text-blood">确认毁碑</button>
                        <button onClick={() => setConfirmDel(null)} className="px-2 py-1 rounded-lg text-[11px] border border-edge text-dim/60">取消</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDel(e.id)} className="px-2 py-1 rounded-lg text-[12px] border border-edge text-dim/50 hover:text-blood hover:border-blood/40 transition-colors" title="从丰碑移除">🗑</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            <div className="text-[11px] font-mono text-dim/40 px-1 pb-1">已召唤的纪念英灵 · {summoned.length} 名（强制在场，离开世界或点遣散即退场）</div>
            {summoned.length === 0 && <div className="text-center text-dim/40 text-xs font-mono py-12">— 还没有召唤英灵 · 去「碑林」点「召唤入队」 —</div>}
            {summoned.map((r) => (
              <div key={r.id} className="flex items-center gap-2.5 rounded-xl border border-edge bg-panel/30 p-2.5">
                <Avatar src={r.avatar} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-100 truncate">{r.name}</div>
                  <div className="text-[10px] font-mono text-dim/45 truncate">{r.realm || ''}</div>
                </div>
                <button onClick={() => dismissMonument(r.id)} className="px-3 py-1 rounded-lg text-[12px] font-semibold border border-blood/40 text-blood/80 hover:bg-blood/15 transition-colors">遣散</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 英灵详情（全量面板 + 生平 + 结语）*/}
      {detailLive && (() => {
        const s = detailLive.snapshot;
        const summonedNpc = summonedByMon.get(detailLive.id);
        const a: any = s.attrs || {};
        return (
          <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
            <div className="w-full max-w-md max-h-[84dvh] overflow-y-auto rounded-2xl border border-edge bg-void p-4 space-y-3 shadow-[0_0_50px_rgba(0,0,0,0.8)]">
              <div className="flex items-start gap-3">
                <Avatar src={s.avatar} size={64} />
                <div className="flex-1 min-w-0">
                  <div className="text-base font-bold text-slate-100 truncate">{s.name}{s.title ? <span className="text-[11px] text-god/70 ml-1.5">「{s.title}」</span> : null}</div>
                  <div className="text-[11px] font-mono text-dim/55">{s.line || [s.tier, s.profession].filter(Boolean).join('·')}</div>
                  <div className="text-[10px] font-mono text-dim/40 mt-0.5">入碑于 {detailLive.world || '主神空间'}{detailLive.turn ? ` · 第 ${detailLive.turn} 回合` : ''} · {new Date(detailLive.enshrinedAt).toLocaleDateString()}</div>
                </div>
              </div>

              {/* 身份字段（主角 + NPC 通吃；空的自动隐藏）*/}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                {([['标签', s.npcTag], ['等级', s.level ? 'Lv.' + s.level : ''], ['种族', s.race], ['年龄', s.age], ['所属乐园', s.homeParadise], ['入园前', s.preParadiseJob], ['身份', s.identity], ['隶属', s.affiliatedTeam], ['烙印', s.brandLevel], ['生物强度', s.bioStrength], ['竞技场', s.arenaRank], ['当前状态', s.status && s.status !== '一切正常' ? s.status : '']] as const)
                  .filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="flex gap-1.5"><span className="text-dim/45 shrink-0">{k}</span><span className="text-slate-200 truncate">{v}</span></div>
                  ))}
              </div>
              {s.review ? <div className="text-[12px] text-dim/60 leading-relaxed italic border-l-2 border-god/25 pl-2">{s.review}</div> : null}

              {/* 六维 */}
              {Object.keys(a).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(ATTR_LABEL).map(([k, lab]) => (
                    <span key={k} className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-panel/60 border border-edge text-slate-200">{lab} {a[k] ?? '?'}</span>
                  ))}
                  {(s.maxHp != null) && <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-blood/10 border border-blood/30 text-blood/80">HP {s.maxHp}</span>}
                  {(s.maxEp != null) && <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-god/10 border border-god/30 text-god/80">EP {s.maxEp}</span>}
                </div>
              )}

              {(s.personality || s.personalityDetail) && <div className="text-[12px] text-dim/70 leading-relaxed whitespace-pre-wrap">{[s.personality, s.personalityDetail].filter(Boolean).join('\n')}</div>}
              {s.appearance && <div className="text-[12px] text-dim/60 leading-relaxed whitespace-pre-wrap">{s.appearance}</div>}

              {/* 生平总结 + 结语 */}
              {detailLive.eulogyStatus === 'pending' && <div className="text-[12px] text-god/70 font-mono animate-pulse py-1">✍️ 正在撰写生平总结与结语…（与主角演化共用接口）</div>}
              {detailLive.eulogyStatus === 'error' && (
                <div className="flex items-center gap-2 text-[12px] text-amber-400/80">未能生成生平结语（接口未配置或失败）<button onClick={() => regenerateEulogy(detailLive.id)} className="px-2 py-0.5 rounded-md text-[11px] border border-god/40 text-god hover:bg-god/15">重试</button></div>
              )}
              {detailLive.summary && (
                <div className="space-y-1"><div className="text-[11px] font-semibold text-god/70">📜 生平总结</div>
                  <div className="text-[12px] text-slate-200 leading-relaxed whitespace-pre-wrap">{detailLive.summary}</div></div>
              )}
              {detailLive.eulogy && (
                <div className="rounded-xl border border-god/25 bg-god/5 p-3 space-y-1">
                  <div className="text-[11px] font-semibold text-god/70">🕯 结语</div>
                  <div className="text-[12.5px] text-slate-100 leading-relaxed whitespace-pre-wrap italic">{detailLive.eulogy}</div>
                </div>
              )}

              <ChipRow label="技能" items={s.skills || []} />
              <ChipRow label="天赋" items={s.traits || []} />
              <ChipRow label="称号" items={s.titles || []} />
              <ChipRow label="副职业" items={s.subProfessions || []} />
              <ChipRow label="成就" items={s.achievements || []} />

              {!!(s.equipment?.length) && (
                <div className="space-y-1.5"><div className="text-[11px] font-semibold text-god/70">装备（{s.equipment.length}）</div>
                  {s.equipment.map((it: any, i: number) => <EntityCard key={i} kind="equip" data={it} onOpen={() => setSub({ kind: 'equip', data: it })} />)}
                </div>
              )}
              {!!(s.items?.length) && (
                <div className="space-y-1.5"><div className="text-[11px] font-semibold text-god/70">储存空间（{s.items.length}）</div>
                  {s.items.slice(0, 40).map((it: any, i: number) => <EntityCard key={i} kind={itemKind(it)} data={it} onOpen={() => setSub({ kind: itemKind(it), data: it })} />)}
                </div>
              )}

              {!!(s.currencies?.filter((c) => c.amount).length) && (
                <div className="flex flex-wrap gap-1.5">
                  {s.currencies!.filter((c) => c.amount).map((c) => <span key={c.label} className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-amber-500/10 border border-amber-500/30 text-amber-300/90">{c.label} {c.amount}</span>)}
                </div>
              )}
              {!!(s.resources?.length) && (
                <div className="flex flex-wrap gap-1.5">
                  {s.resources!.map((r, i) => <span key={i} className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-panel/60 border border-edge text-slate-200">{r.name} {r.cur}/{r.max}</span>)}
                </div>
              )}
              {s.background && (
                <div className="space-y-1"><div className="text-[11px] font-semibold text-god/70">背景出身</div>
                  <div className="text-[12px] text-dim/65 leading-relaxed whitespace-pre-wrap">{s.background}</div></div>
              )}
              {!!(s.deedLog?.length) && (
                <div className="space-y-1"><div className="text-[11px] font-semibold text-god/70">生平经历（{s.deedLog.length}）</div>
                  <div className="space-y-0.5">
                    {s.deedLog.slice(-30).map((d: any, i: number) => {
                      const t = [d?.time, d?.location].filter(Boolean).join('·');
                      const txt = d?.content || d?.text || d?.summary || '';
                      return txt ? <div key={i} className="text-[11px] text-dim/60 leading-snug">{t ? <span className="text-dim/40 font-mono">[{t}] </span> : null}{txt}</div> : null;
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                {summonedNpc ? (
                  <button onClick={() => dismissMonument(summonedNpc.id)} className="flex-1 px-3 py-2 rounded-lg text-[13px] font-semibold border border-blood/40 text-blood/80 hover:bg-blood/15 transition-colors">遣散</button>
                ) : (
                  <button onClick={() => { summonMonument(detailLive); }} className="flex-1 px-3 py-2 rounded-lg text-[13px] font-semibold bg-god/20 border border-god/40 text-god hover:bg-god/30 transition-colors">⚔ 召唤入队</button>
                )}
                <button onClick={() => setDetail(null)} className="px-4 py-2 rounded-lg text-[13px] border border-edge text-dim/70 hover:text-slate-100 transition-colors">关闭</button>
              </div>
            </div>
          </div>
        );
      })()}

      {sub && <EntityDetailModal kind={sub.kind} data={sub.data} onClose={() => setSub(null)} />}
    </div>
  );
}
