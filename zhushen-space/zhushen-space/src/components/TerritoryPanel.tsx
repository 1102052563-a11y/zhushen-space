import { useState } from 'react';
import { useTerritory, buildingCap, BUILDING_MAX_LEVEL, type Building } from '../store/territoryStore';
import { useNpc } from '../store/npcStore';
import { realmFromLevel } from '../systems/derivedStats';
import NpcDetail from './NpcDetail';

/* 领地看板：概况 / 领地效果 / 建筑 / 成员(关联NPC) / 仓库。
   轮回乐园个人基地，单一记录；数据由「领地演化」阶段维护，此处可查看。 */
export default function TerritoryPanel({ onClose }: { onClose: () => void }) {
  const T = useTerritory();
  const npcs = useNpc((s) => s.npcs);
  const [npcDetailId, setNpcDetailId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const cap = buildingCap(T.level);
  const pct = Math.max(0, Math.min(100, T.buildProgress));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between p-4 border-b border-edge shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏯</span>
            <h2 className="text-base font-bold text-slate-100">领地</h2>
            {T.unlocked && <span className="text-[13px] font-mono text-dim/50">{T.name || '（未命名）'}</span>}
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
        </header>

        {!T.unlocked ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="text-center text-dim/40 text-sm py-12 leading-relaxed">
              领地尚未开辟。<br />
              开启「设置→变量管理→🏯 领地演化」后，在轮回乐园建立/获得基地时会自动开辟并建档。
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">

            {/* 概况 */}
            <section className="rounded-lg border border-edge bg-panel p-3 space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                {editingName ? (
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => { if (nameDraft.trim()) T.setTerritory({ name: nameDraft.trim() }); setEditingName(false); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { if (nameDraft.trim()) T.setTerritory({ name: nameDraft.trim() }); setEditingName(false); } if (e.key === 'Escape') setEditingName(false); }}
                    placeholder="给领地起个名字"
                    className="flex-1 bg-void border border-god/40 rounded px-2 py-1 text-sm text-slate-100 outline-none focus:border-god"
                  />
                ) : (
                  <button
                    onClick={() => { setNameDraft(T.name); setEditingName(true); }}
                    title="点击重命名"
                    className="text-sm font-bold text-slate-100 hover:text-god transition-colors text-left"
                  >
                    {T.name || '（未命名·点击命名）'}
                    <span className="ml-1.5 text-[11px] text-dim/40 font-mono">✎</span>
                  </button>
                )}
                <div className="text-[13px] font-mono text-amber-300 shrink-0">{realmFromLevel(T.level)}·Lv.{T.level}</div>
              </div>
              {/* 建设进度条 */}
              <div>
                <div className="flex items-center justify-between text-[11px] font-mono text-dim/60 mb-1">
                  <span>建设进度</span><span>{pct}/100 → Lv.{T.level + 1}</span>
                </div>
                <div className="h-2 rounded-full bg-void border border-edge overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-amber-600/70 to-amber-400/80" style={{ width: `${pct}%` }} />
                </div>
              </div>
              {T.appearance && <SegLine label="外观" text={T.appearance} />}
              {T.passiveOutput && <SegLine label="被动产出" text={T.passiveOutput} />}
            </section>

            {/* 领地效果 */}
            <Section
              title="领地效果"
              count={T.effects.length}
              action={T.effects.length > 0 && (
                <button
                  onClick={() => { if (confirm(`确认清空全部 ${T.effects.length} 条领地效果？`)) T.clearEffects(); }}
                  title="一键清空全部领地效果"
                  className="shrink-0 self-center text-[11px] font-mono text-dim/40 hover:text-blood transition-colors"
                >一键清空</button>
              )}
            >
              {T.effects.length === 0
                ? <Empty text="（暂无领地效果）" />
                : <div className="space-y-1.5">{T.effects.map((e) => (
                    <div key={e.name} className="group rounded border border-edge bg-void/60 px-2.5 py-1.5">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[13px] text-emerald-300 font-mono">{e.name}</span>
                        {e.source && <span className="text-[11px] text-dim/40 font-mono">来自 {e.source}</span>}
                        <span className="flex-1" />
                        <button
                          onClick={() => T.removeEffect(e.name)}
                          title="删除该领地效果（清掉无意义/凑数的效果）"
                          className="shrink-0 self-center opacity-0 group-hover:opacity-100 text-dim/40 hover:text-blood text-[12px] font-mono transition-opacity"
                        >✕</button>
                      </div>
                      {e.desc && <div className="text-[12px] text-dim/80 mt-0.5">{e.desc}</div>}
                    </div>
                  ))}</div>}
            </Section>

            {/* 建筑 */}
            <Section title="建筑" count={`${T.buildings.length}/${cap}`}>
              {T.buildings.length === 0
                ? <Empty text="（暂无建筑）" />
                : <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">{T.buildings.map((b) => <BuildingCard key={b.id} b={b} />)}</div>}
            </Section>

            {/* 成员（关联 NPC） */}
            <Section title="领地成员" count={T.members.length}>
              {T.members.length === 0
                ? <Empty text="（暂无驻留成员）" />
                : <div className="flex flex-wrap gap-2">{T.members.map((m) => {
                    const rec = npcs[m.id];
                    return (
                      <button key={m.id}
                        onClick={() => rec && setNpcDetailId(m.id)}
                        className={`px-2.5 py-1.5 rounded-lg border text-[13px] font-mono transition-colors ${rec ? 'border-violet-700/50 text-violet-300 hover:bg-violet-900/20' : 'border-edge text-dim/50'}`}>
                        <span>{m.id}</span>
                        {rec?.name && rec.name !== m.id && <span className="text-slate-200">·{rec.name}</span>}
                        {m.role && <span className="text-dim/60">（{m.role}）</span>}
                      </button>
                    );
                  })}</div>}
            </Section>

            {/* 仓库 */}
            <Section title="仓库" count={T.storageItems.length}>
              {T.storageItems.length === 0
                ? <Empty text="（仓库为空）" />
                : <div className="space-y-1">{T.storageItems.map((it) => (
                    <div key={it.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-edge bg-void/60">
                      <span className="flex-1 text-[13px] text-slate-200 truncate">{it.name}
                        {it.gradeDesc && <span className="text-dim/50 text-[11px] ml-1">{it.gradeDesc}</span>}
                        {it.category && <span className="text-dim/40 text-[11px] ml-1">[{it.category}]</span>}
                      </span>
                      <span className="text-[12px] font-mono text-amber-300/80 shrink-0">×{it.quantity}</span>
                    </div>
                  ))}</div>}
            </Section>

          </div>
        )}
      </div>

      {npcDetailId && npcs[npcDetailId] && (
        <NpcDetail npc={npcs[npcDetailId]} list={Object.values(npcs)} onClose={() => setNpcDetailId(null)} onSelect={(id) => setNpcDetailId(id)} />
      )}
    </div>
  );
}

function Section({ title, count, action, children }: { title: string; count: number | string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-mono text-dim/70">{title}</span>
        <span className="text-[11px] font-mono text-dim/40">{count}</span>
        {action && <><span className="flex-1" />{action}</>}
      </div>
      {children}
    </section>
  );
}

function BuildingCard({ b }: { b: Building }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-edge bg-panel px-2.5 py-2 cursor-pointer" onClick={() => setOpen(!open)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-slate-100 font-mono truncate">{b.name}</span>
        <span className="text-[11px] font-mono text-sky-300/80 shrink-0">Lv.{b.level}/{BUILDING_MAX_LEVEL}</span>
      </div>
      {b.effect && <div className="text-[12px] text-emerald-300/80 mt-1 leading-snug">{b.effect}</div>}
      {open && (
        <div className="mt-1.5 space-y-1 text-[12px] text-dim/70">
          {b.appearance && <div><span className="text-dim/40">外观：</span>{b.appearance}</div>}
          {b.description && <div><span className="text-dim/40">说明：</span>{b.description}</div>}
        </div>
      )}
    </div>
  );
}

function SegLine({ label, text }: { label: string; text: string }) {
  return (
    <div className="text-[12px] leading-relaxed">
      <span className="text-dim/40 font-mono mr-1.5">{label}</span>
      <span className="text-dim/85">{text}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-[12px] text-dim/35 font-mono px-1 py-2">{text}</div>;
}
