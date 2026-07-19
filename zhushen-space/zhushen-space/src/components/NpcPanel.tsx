import { useState, useEffect } from 'react';
import { useNpc, hasRealNpcName, type NpcRecord } from '../store/npcStore';
import { isPetLike } from '../systems/petEvolution';   // 宠物/召唤物分流：默认档案排除宠物，petMode 只看宠物
import { isDmableTag } from '../store/dmStore';
import { normalizeTier, tierFxClass } from '../systems/derivedStats';
import { listSnapshots, removeSnapshot, clearLibrary, REASON_LABEL, type NpcSnapshot } from '../systems/npcLibrary';   // NPC 图书馆：只进不出的档案库（删除仅供玩家显式清理）
import { restoreSnapshot, aiSyncSnapshot } from '../systems/npcRestore';                 // 找回：A 确定性还原 / B AI 提取同步
import NpcDetail from './NpcDetail';

/* 好感度颜色 */
function favorCls(v: number) {
  if (v >= 60)  return 'text-rose-400';
  if (v >= 30)  return 'text-amber-400';
  if (v >= 0)   return 'text-slate-400';
  if (v >= -30) return 'text-sky-400';
  return 'text-blood';
}

function FavorBar({ value }: { value: number }) {
  const pct  = Math.round(((value + 100) / 200) * 100);
  const cls  = value >= 0 ? 'bg-rose-500/70' : 'bg-sky-500/70';
  return (
    <div className="relative h-1 w-full bg-void/60 rounded-full overflow-hidden">
      <div className={`absolute inset-y-0 left-0 ${cls} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      <div className="absolute inset-y-0 left-1/2 w-px bg-edge/60" />
    </div>
  );
}

/* ── NPC 卡片（点击打开完整档案）── */
function NpcCard({ npc, onOpen, onDm, onToggleFriend, onManualUpdate, onRestore, onArchive, updating }: { npc: NpcRecord; onOpen: () => void; onDm?: (r: NpcRecord) => void; onToggleFriend?: (id: string, on: boolean) => void; onManualUpdate?: (id: string) => void; onRestore?: (id: string) => void; onArchive?: (id: string) => void; updating?: boolean }) {
  const genderCls = npc.gender === '女' ? 'text-rose-400' : npc.gender === '男' ? 'text-sky-400' : 'text-dim/40';
  const itemCount = npc.items?.length ?? 0;
  const canDm = !!onDm && !npc.isDead && isDmableTag(npc.npcTag);
  const canFriend = !!onToggleFriend && !npc.isDead && isDmableTag(npc.npcTag);

  return (
    <div
      onClick={onOpen}
      role="button" tabIndex={0}
      className={`w-full text-left rounded-xl border transition-all cursor-pointer ${
        npc.onScene ? 'border-edge bg-panel hover:border-god/40' : 'border-edge/40 bg-panel/50 opacity-70 hover:opacity-100'
      }`}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <div className={`shrink-0 mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center text-[13px] font-bold font-mono border overflow-hidden ${
          npc.onScene ? 'border-god/40 text-god bg-god/5' : 'border-edge text-dim/40 bg-void'
        }`}>
          {/* 标准短ID(C1/G1/B1…)直接显示；非标准长ID(如 _Goblin_Ambusher)会撑爆方框，改用姓名首字 */}
          {/^[A-Za-z]\d{1,3}$/.test(npc.id) ? npc.id : (npc.name?.trim()?.[0] ?? '·')}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-semibold text-slate-100 truncate">{npc.name || npc.id}</span>
            {npc.gender && <span className={`text-[12px] font-mono ${genderCls}`}>{npc.gender}</span>}
            {npc.npcTag && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-cyan-700/50 text-cyan-300/80 shrink-0">{npc.npcTag}</span>}
            {npc.partyMember && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-sky-500/50 text-sky-300/80 bg-sky-900/20 shrink-0" title="临时队友">队</span>}
            {npc.isDead && <span className="text-[11px] font-mono text-blood ml-1">已死亡</span>}
            {npc.archived && !npc.isDead && <span className="text-[11px] font-mono text-amber-400/70 ml-1">已归档</span>}
            {!npc.onScene && !npc.archived && !npc.isDead && <span className="text-[11px] font-mono text-dim/40 ml-1">已离场</span>}
          </div>
          {npc.realm && (() => {
            const full = npc.realm.split('|').join(' · ');
            const t = normalizeTier(npc.realm);                        // 只给阶位名上特效，其余(Lv·身份)保持原色
            return <div className="text-[12px] font-mono text-god/60 truncate mt-0.5">
              {t && full.startsWith(t)
                ? <><span className={`${tierFxClass(t)} font-bold`}>{t}</span>{full.slice(t.length)}</>
                : full}
            </div>;
          })()}
          {npc.review && <div className="text-[12px] text-amber-200/55 italic truncate mt-0.5">锐评·{npc.review}</div>}
          <div className="mt-1.5 flex items-center gap-2">
            <span className={`text-[12px] font-mono ${favorCls(npc.favor)}`}>好感 {npc.favor > 0 ? '+' : ''}{npc.favor}</span>
            <div className="flex-1"><FavorBar value={npc.favor} /></div>
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1 text-[11px] font-mono text-dim/40">
          {!npc.onScene && onRestore && (
            <button onClick={(e) => { e.stopPropagation(); onRestore(npc.id); }} title={npc.archived ? '重新上场（解除归档，拉回在场；档案完整保留，非删除）' : '重新上场（离场保留在档，随时召回，非删除）'}
              className="px-1.5 py-0.5 rounded border border-god/40 text-god/80 hover:bg-god/10 transition-colors">↑ 上场</button>
          )}
          {!npc.archived && onArchive && (
            <button onClick={(e) => { e.stopPropagation(); onArchive(npc.id); }} title="归档（玩家主动封存：收进归档区，不再参与离场自治/演化/正文召回，随时可重新上场，非删除）"
              className="px-1.5 py-0.5 rounded border border-edge text-dim/60 hover:border-amber-600/50 hover:text-amber-400 transition-colors">↓ 归档</button>
          )}
          {itemCount > 0 && <span>🎒{itemCount}</span>}
          {canDm && (
            <button onClick={(e) => { e.stopPropagation(); onDm!(npc); }} title={`私信 ${npc.name || npc.id}`}
              className="px-1.5 py-0.5 rounded border border-cyan-500/40 text-cyan-300/80 hover:bg-cyan-900/25 transition-colors">✉ 私信</button>
          )}
          {canFriend && (
            <button onClick={(e) => { e.stopPropagation(); onToggleFriend!(npc.id, !npc.isFriend); }} title={npc.isFriend ? '移出好友栏' : '加为好友（每回合参与演化）'}
              className={`px-1.5 py-0.5 rounded border transition-colors ${npc.isFriend ? 'border-amber-500/50 text-amber-300/90 bg-amber-900/15' : 'border-edge text-dim/50 hover:text-amber-300/80 hover:border-amber-500/40'}`}>{npc.isFriend ? '⭐ 已好友' : '☆ 好友'}</button>
          )}
          {onManualUpdate && !npc.isDead && (
            <button onClick={(e) => { e.stopPropagation(); onManualUpdate(npc.id); }} disabled={updating} title="按最近一次正文，用 AI 单独更新该 NPC 的档案/属性/技能"
              className="px-1.5 py-0.5 rounded border border-violet-500/40 text-violet-300/80 hover:bg-violet-900/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {updating ? <><span className="animate-spin inline-block">◌</span> 更新中</> : '⟳ 更新'}
            </button>
          )}
          <span className="text-god/40">查看›</span>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   NPC 图书馆（只进不出的档案库）
   任何被删除/被合并掉的真实 NPC，消失前都在这里留了全量快照。此处可「找回」。
   ⚠ 模块级组件，绝不内联进主弹窗——内联会导致每次父组件重渲染就整个重挂（输入法/焦点全断）。
════════════════════════════════════════════ */
function LibrarySection({ onRestored }: { onRestored: (id: string) => void }) {
  const [snaps, setSnaps] = useState<NpcSnapshot[] | null>(null);
  const [busy, setBusy] = useState<string>('');
  const [msg, setMsg] = useState<string>('');
  const [confirmClear, setConfirmClear] = useState(false);

  const reload = () => { void listSnapshots().then(setSnaps).catch(() => setSnaps([])); };
  useEffect(reload, []);

  // 删除都是玩家显式清理（removeSnapshot / clearLibrary 本就只供玩家）：落 IndexedDB 后刷新列表。
  const delOne = async (key: string) => { setBusy('del:' + key); await removeSnapshot(key); setBusy(''); setMsg(''); reload(); };
  const delByName = async (name: string, keys: string[]) => {
    setBusy('name:' + name);
    for (const k of keys) await removeSnapshot(k);
    setBusy(''); setMsg(`已删除「${name}」的 ${keys.length} 份快照`); reload();
  };
  const doClear = async () => { setBusy('__clear__'); await clearLibrary(); setBusy(''); setConfirmClear(false); setMsg('图书馆已清空'); reload(); };

  if (snaps === null) {
    return <div className="flex items-center justify-center h-40 text-dim/40 text-sm font-mono"><span className="animate-spin mr-2">◌</span> 读取图书馆…</div>;
  }
  if (snaps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3 text-dim/30 text-center px-6">
        <span className="text-3xl opacity-30">📚</span>
        <span className="text-sm font-mono">图书馆是空的。</span>
        <span className="text-[12px] font-mono text-dim/40 leading-relaxed">
          今后任何有名有姓的 NPC 被删除或被同名合并掉之前，都会在这里留一份完整快照（含技能/天赋/记忆/头像），永不自动清理。
        </span>
      </div>
    );
  }

  // 同名份数（供「删同名」批量清理：一次清掉反复入库的重复角色/战斗敌人）
  const nameCounts = new Map<string, number>();
  for (const s of snaps) nameCounts.set(s.name, (nameCounts.get(s.name) ?? 0) + 1);

  return (
    <div className="space-y-2">
      {/* 头部：总数 + 一键清空（不可恢复·二次确认） */}
      <div className="flex items-center gap-2 px-1 flex-wrap">
        <span className="text-[12px] font-mono text-dim/50 flex-1 min-w-[8rem]">
          共 {snaps.length} 份快照{nameCounts.size < snaps.length ? `（${nameCounts.size} 个不同角色）` : ''}
        </span>
        {!confirmClear ? (
          <button onClick={() => { setConfirmClear(true); setMsg(''); }} disabled={!!busy}
            className="px-2 py-1 rounded text-[12px] font-mono border border-blood/40 text-blood/80 hover:bg-blood/10 disabled:opacity-40 transition-colors">🗑 清空全部</button>
        ) : (
          <>
            <span className="text-[12px] font-mono text-blood/80">清空后不可恢复，确定？</span>
            <button onClick={() => void doClear()} disabled={!!busy}
              className="px-2 py-1 rounded text-[12px] font-mono border border-blood text-blood bg-blood/10 hover:bg-blood/20 disabled:opacity-40 transition-colors">{busy === '__clear__' ? '◌ 清空中' : '确认清空'}</button>
            <button onClick={() => setConfirmClear(false)} disabled={!!busy}
              className="px-2 py-1 rounded text-[12px] font-mono border border-edge text-dim hover:text-slate-200 transition-colors">取消</button>
          </>
        )}
      </div>
      {msg && <div className="rounded-lg border border-god/30 bg-god/5 px-3 py-2 text-[12px] font-mono text-god/80">{msg}</div>}
      {snaps.map((s) => {
        const dup = nameCounts.get(s.name) ?? 1;
        return (
        <div key={s.key} className="rounded-lg border border-edge bg-panel/60 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-100 flex-1 truncate">{s.name}</span>
            <span className="text-[11px] font-mono text-dim/40">{s.npcId}</span>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-void/60 text-amber-300/70">{REASON_LABEL[s.reason]}</span>
          </div>
          <div className="text-[11px] font-mono text-dim/40 mt-0.5">
            {new Date(s.archivedAt).toLocaleString()}
            {s.record?.realm ? ` · ${s.record.realm}` : ''}
            {s.record?.deedLog?.length ? ` · 经历 ${s.record.deedLog.length}` : ''}
            {typeof s.record?.favor === 'number' ? ` · 好感 ${s.record.favor}` : ''}
          </div>
          <div className="flex gap-1.5 mt-2 flex-wrap">
            <button
              disabled={!!busy}
              onClick={() => {
                setBusy(s.key);
                const r = restoreSnapshot(s);
                setMsg(r.msg);
                setBusy('');
                if (r.ok) onRestored(r.id);
              }}
              title="确定性还原：档案 / 技能 / 天赋 / 记忆 / 头像原样写回；若已有同名档案会自动合并（丰满的那份当留存者）"
              className="px-2 py-1 rounded text-[12px] font-mono border border-god/40 text-god hover:bg-god/10 disabled:opacity-40 transition-colors"
            >↩ 找回</button>
            <button
              disabled={!!busy}
              onClick={async () => {
                const cur = useNpc.getState().npcs[s.npcId];
                if (!cur) { setMsg('当前没有同 ID 的档案可同步 —— 请先点「↩ 找回」'); return; }
                setBusy(s.key);
                setMsg('AI 同步中…');
                const r = await aiSyncSnapshot(s, s.npcId);
                setMsg(r.msg);
                setBusy('');
              }}
              title="AI 提取同步：把这份旧快照里的历史/关系/感情线，融进当前那份同 ID 的档案（适合「当前是 AI 新建空壳」的情况）"
              className="px-2 py-1 rounded text-[12px] font-mono border border-edge text-dim hover:text-slate-200 disabled:opacity-40 transition-colors"
            >{busy === s.key ? '◌ 处理中' : '✨ AI 同步'}</button>
            <div className="flex-1" />
            {dup > 1 && (
              <button
                disabled={!!busy}
                onClick={() => void delByName(s.name, (snaps ?? []).filter((x) => x.name === s.name).map((x) => x.key))}
                title={`删除全部「${s.name}」的 ${dup} 份快照（清理反复入库的重复角色 / 战斗敌人）`}
                className="px-2 py-1 rounded text-[12px] font-mono border border-blood/30 text-blood/70 hover:bg-blood/10 disabled:opacity-40 transition-colors"
              >{busy === 'name:' + s.name ? '◌ 删除中' : `🗑 删同名 ×${dup}`}</button>
            )}
            <button
              disabled={!!busy}
              onClick={() => void delOne(s.key)}
              title="从图书馆删除这一份快照（只删这条·不影响当前存档里的同名角色）"
              className="px-2 py-1 rounded text-[12px] font-mono border border-blood/30 text-blood/70 hover:bg-blood/10 disabled:opacity-40 transition-colors"
            >{busy === 'del:' + s.key ? '◌' : '🗑 删除'}</button>
          </div>
        </div>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════════
   主弹窗
════════════════════════════════════════════ */
export default function NpcPanel({ onClose, onDm, onManualUpdate, manualUpdatingId, onCultivate, petMode }: { onClose: () => void; onDm?: (r: NpcRecord) => void; onManualUpdate?: (id: string) => void; manualUpdatingId?: string | null; onCultivate?: (r: NpcRecord) => void; petMode?: boolean }) {
  const npcs      = useNpc((s) => s.npcs);
  const clearAll  = useNpc((s) => s.clearAll);
  const setFriend = useNpc((s) => s.setFriend);
  const upsertNpc = useNpc((s) => s.upsertNpc);
  const restoreNpc = (id: string) => upsertNpc(id, { onScene: true, archived: false });   // 重新上场（离场/归档皆拉回在场，解除归档；非删除）
  const archiveNpc = (id: string) => upsertNpc(id, { onScene: false, archived: true });   // 归档：玩家主动封存（独立第三态），不再参与自治/演化/召回，随时可拉回，非删除

  // 死亡角色不出现在档案列表（仍保留在 store 里，仅不展示）。
  // 只认 isDead 标记（与在场浮窗/其余各处一致）——不再在展示层重跑 looksDead，
  // 否则丧尸/不死生物这类「状态里本就含死字但其实是活跃敌人」的 NPC 会被误判死亡、整条从档案消失。
  const isDeadNpc = (r: NpcRecord) => !!r.isDead;
  // 无名编号空壳(C11/C22…)不进档案列表——它们要么会被自动清理，要么待补名后才以真名出现。
  // （仍想手动处理可去「设置→变量管理→NPC演化」的管理面板，那里不过滤。）
  // petMode=宠物/召唤物专属花名册；否则 NPC 档案排除宠物/召唤物（它们有独立的 🐾 面板·严格区分）。
  const records  = Object.values(npcs).filter((r) => !isDeadNpc(r) && hasRealNpcName(r) && (petMode ? isPetLike(r) : !isPetLike(r))).sort((a, b) => b.updatedAt - a.updatedAt);
  // 三态互斥（不变量 archived⟹!onScene）：在场 / 离场（AI 剧情自动收起·仍被追踪）/ 归档（玩家主动封存·不参与 AI 处理）
  const onScene  = records.filter((r) => r.onScene && !r.archived);
  const offScene = records.filter((r) => !r.onScene && !r.archived);
  const archived = records.filter((r) => r.archived);

  const [tab, setTab]           = useState<'on' | 'off' | 'arc' | 'lib'>('on');
  const [search, setSearch]     = useState('');
  const [tagFilter, setTagFilter] = useState<string>('');   // 标签筛选（空=全部）
  const [confirmClear, setConfirmClear] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = selectedId ? npcs[selectedId] : null;

  const TAGS = petMode ? ['宠物', '召唤物'] : ['契约者', '土著', '随从'];

  const displayed = (tab === 'on' ? onScene : tab === 'off' ? offScene : archived).filter((r) => {
    if (tagFilter && r.npcTag !== tagFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      r.realm.toLowerCase().includes(q) ||
      r.personality.toLowerCase().includes(q)
    );
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg h-[88dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">

        {/* 标题栏 */}
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/60 text-lg">{petMode ? '🐾' : '📇'}</span>
          <div>
            <div className="text-sm font-bold text-slate-100">{petMode ? '宠物 / 召唤物' : 'NPC 档案'}</div>
            <div className="text-[12px] font-mono text-dim/60">
              在场 {onScene.length} · 离场 {offScene.length}{archived.length > 0 && <> · <span className="text-amber-400/70">归档 {archived.length}</span></>}
            </div>
          </div>
          <div className="flex-1" />
          {records.length > 0 && (
            <button
              onClick={() => {
                if (!confirmClear) { setConfirmClear(true); return; }
                clearAll();
                setConfirmClear(false);
              }}
              onBlur={() => setConfirmClear(false)}
              className={`text-[12px] font-mono px-2 py-1 rounded border transition-colors ${
                confirmClear
                  ? 'border-blood/60 text-blood'
                  : 'border-edge text-dim/40 hover:border-blood/40 hover:text-blood'
              }`}
            >
              {confirmClear ? '确认清空' : '清空'}
            </button>
          )}
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-edge text-dim hover:text-blood hover:border-blood/40 transition-colors text-sm"
          >
            ✕
          </button>
        </header>

        {/* Tab + 搜索 */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-edge bg-panel">
          <div className="flex gap-1 p-0.5 bg-void rounded-lg border border-edge">
            <button
              onClick={() => setTab('on')}
              className={`px-3 py-1 rounded text-[13px] font-mono transition-colors ${
                tab === 'on' ? 'bg-god/10 text-god border border-god/30' : 'text-dim hover:text-slate-200'
              }`}
            >
              在场 A 区 {onScene.length > 0 && <span className="ml-1 text-[11px] opacity-60">{onScene.length}</span>}
            </button>
            <button
              onClick={() => setTab('off')}
              className={`px-3 py-1 rounded text-[13px] font-mono transition-colors ${
                tab === 'off' ? 'bg-god/10 text-god border border-god/30' : 'text-dim hover:text-slate-200'
              }`}
            >
              离场 B 区 {offScene.length > 0 && <span className="ml-1 text-[11px] opacity-60">{offScene.length}</span>}
            </button>
            <button
              onClick={() => setTab('arc')}
              title="归档区：玩家主动封存的 NPC，不再参与离场自治 / 演化 / 正文召回，随时可「↑ 上场」拉回（非删除）"
              className={`px-3 py-1 rounded text-[13px] font-mono transition-colors ${
                tab === 'arc' ? 'bg-amber-500/10 text-amber-300 border border-amber-500/40' : 'text-dim hover:text-slate-200'
              }`}
            >
              归档 {archived.length > 0 && <span className="ml-1 text-[11px] opacity-60">{archived.length}</span>}
            </button>
            <button
              onClick={() => setTab('lib')}
              title="图书馆：只进不出的档案库。任何有名有姓的 NPC 被删除/被同名合并掉之前，都在这里留了全量快照（含技能/天赋/记忆/头像），永不自动清理 —— 随时可找回"
              className={`px-3 py-1 rounded text-[13px] font-mono transition-colors ${
                tab === 'lib' ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/40' : 'text-dim hover:text-slate-200'
              }`}
            >
              📚 图书馆
            </button>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索姓名/ID/阶位…"
            className="flex-1 bg-void border border-edge rounded-lg px-3 py-1.5 text-[13px] font-mono text-slate-200 outline-none focus:border-god placeholder:text-dim/30"
          />
        </div>

        {/* 标签筛选 */}
        <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-edge bg-panel/60 overflow-x-auto">
          <span className="text-[11px] font-mono text-dim/40 shrink-0">标签</span>
          <button onClick={() => setTagFilter('')}
            className={`shrink-0 px-2 py-0.5 rounded text-[12px] font-mono border transition-colors ${tagFilter === '' ? 'border-god/40 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>全部</button>
          {TAGS.map((tg) => (
            <button key={tg} onClick={() => setTagFilter(tagFilter === tg ? '' : tg)}
              className={`shrink-0 px-2 py-0.5 rounded text-[12px] font-mono border transition-colors ${tagFilter === tg ? 'border-cyan-600/60 text-cyan-300 bg-cyan-900/20' : 'border-edge text-dim hover:text-slate-200'}`}>{tg}</button>
          ))}
        </div>

        {/* NPC 列表 / 图书馆 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {tab === 'lib' ? (
            <LibrarySection onRestored={(id) => { setTab(npcs[id]?.onScene ? 'on' : 'off'); setSelectedId(id); }} />
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-dim/30">
              <span className="text-3xl opacity-30">📇</span>
              <span className="text-sm font-mono">
                {records.length === 0
                  ? 'NPC 档案为空。启用 NPC 演化后，AI 会自动建立档案。'
                  : search
                  ? '无匹配 NPC'
                  : tab === 'on' ? '当前无在场 NPC' : tab === 'off' ? '当前无离场 NPC' : '归档区为空。在场/离场 NPC 卡片点「↓ 归档」即可封存。'}
              </span>
            </div>
          ) : (
            displayed.map((npc) => <NpcCard key={npc.id} npc={npc} onOpen={() => setSelectedId(npc.id)} onDm={onDm} onToggleFriend={setFriend} onManualUpdate={onManualUpdate} onRestore={restoreNpc} onArchive={archiveNpc} updating={manualUpdatingId === npc.id} />)
          )}
        </div>
      </div>

      {/* 单个 NPC 完整档案 */}
      {selected && (
        <NpcDetail
          npc={selected}
          list={records}
          onClose={() => setSelectedId(null)}
          onSelect={(id) => setSelectedId(id)}
          onManualUpdate={onManualUpdate}
          updating={manualUpdatingId === selected.id}
          onCultivate={onCultivate}
        />
      )}
    </div>
  );
}
