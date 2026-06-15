import { useState } from 'react';
import { useNpc, type NpcRecord } from '../store/npcStore';
import { isDmableTag } from '../store/dmStore';
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
function NpcCard({ npc, onOpen, onDm, onToggleFriend }: { npc: NpcRecord; onOpen: () => void; onDm?: (r: NpcRecord) => void; onToggleFriend?: (id: string, on: boolean) => void }) {
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
            {!npc.onScene && !npc.isDead && <span className="text-[11px] font-mono text-dim/40 ml-1">已离场</span>}
          </div>
          {npc.realm && <div className="text-[12px] font-mono text-god/60 truncate mt-0.5">{npc.realm.split('|').join(' · ')}</div>}
          {npc.review && <div className="text-[12px] text-amber-200/55 italic truncate mt-0.5">锐评·{npc.review}</div>}
          <div className="mt-1.5 flex items-center gap-2">
            <span className={`text-[12px] font-mono ${favorCls(npc.favor)}`}>好感 {npc.favor > 0 ? '+' : ''}{npc.favor}</span>
            <div className="flex-1"><FavorBar value={npc.favor} /></div>
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1 text-[11px] font-mono text-dim/40">
          {itemCount > 0 && <span>🎒{itemCount}</span>}
          {canDm && (
            <button onClick={(e) => { e.stopPropagation(); onDm!(npc); }} title={`私信 ${npc.name || npc.id}`}
              className="px-1.5 py-0.5 rounded border border-cyan-500/40 text-cyan-300/80 hover:bg-cyan-900/25 transition-colors">✉ 私信</button>
          )}
          {canFriend && (
            <button onClick={(e) => { e.stopPropagation(); onToggleFriend!(npc.id, !npc.isFriend); }} title={npc.isFriend ? '移出好友栏' : '加为好友（每回合参与演化）'}
              className={`px-1.5 py-0.5 rounded border transition-colors ${npc.isFriend ? 'border-amber-500/50 text-amber-300/90 bg-amber-900/15' : 'border-edge text-dim/50 hover:text-amber-300/80 hover:border-amber-500/40'}`}>{npc.isFriend ? '⭐ 已好友' : '☆ 好友'}</button>
          )}
          <span className="text-god/40">查看›</span>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   主弹窗
════════════════════════════════════════════ */
export default function NpcPanel({ onClose, onDm }: { onClose: () => void; onDm?: (r: NpcRecord) => void }) {
  const npcs      = useNpc((s) => s.npcs);
  const clearAll  = useNpc((s) => s.clearAll);
  const setFriend = useNpc((s) => s.setFriend);

  // 死亡角色不出现在档案列表（仍保留在 store 里，仅不展示）。
  // 只认 isDead 标记（与在场浮窗/其余各处一致）——不再在展示层重跑 looksDead，
  // 否则丧尸/不死生物这类「状态里本就含死字但其实是活跃敌人」的 NPC 会被误判死亡、整条从档案消失。
  const isDeadNpc = (r: NpcRecord) => !!r.isDead;
  const records  = Object.values(npcs).filter((r) => !isDeadNpc(r)).sort((a, b) => b.updatedAt - a.updatedAt);
  const onScene  = records.filter((r) => r.onScene);
  const offScene = records.filter((r) => !r.onScene);

  const [tab, setTab]           = useState<'on' | 'off'>('on');
  const [search, setSearch]     = useState('');
  const [tagFilter, setTagFilter] = useState<string>('');   // 标签筛选（空=全部）
  const [confirmClear, setConfirmClear] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = selectedId ? npcs[selectedId] : null;

  const TAGS = ['契约者', '土著', '随从', '宠物', '召唤物'];

  const displayed = (tab === 'on' ? onScene : offScene).filter((r) => {
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
      <div className="w-full max-w-lg h-[88vh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">

        {/* 标题栏 */}
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/60 text-lg">📇</span>
          <div>
            <div className="text-sm font-bold text-slate-100">NPC 档案</div>
            <div className="text-[12px] font-mono text-dim/60">
              在场 {onScene.length} · 离场 {offScene.length}
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

        {/* NPC 列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-dim/30">
              <span className="text-3xl opacity-30">📇</span>
              <span className="text-sm font-mono">
                {records.length === 0
                  ? 'NPC 档案为空。启用 NPC 演化后，AI 会自动建立档案。'
                  : search
                  ? '无匹配 NPC'
                  : tab === 'on' ? '当前无在场 NPC' : '当前无离场 NPC'}
              </span>
            </div>
          ) : (
            displayed.map((npc) => <NpcCard key={npc.id} npc={npc} onOpen={() => setSelectedId(npc.id)} onDm={onDm} onToggleFriend={setFriend} />)
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
        />
      )}
    </div>
  );
}
