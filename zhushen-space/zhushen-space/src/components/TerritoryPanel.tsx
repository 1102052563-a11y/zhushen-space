import { useState } from 'react';
import { useTerritory, buildingCap, BUILDING_MAX_LEVEL, type Building, type TerritoryItem } from '../store/territoryStore';
import { useItems, type ItemCategory } from '../store/itemStore';
import { useNpc, hasRealNpcName } from '../store/npcStore';
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

  // ── 手动增删：建筑新建表单 + 成员关联选择器 ──
  const [addingBuilding, setAddingBuilding] = useState(false);
  const [bName, setBName] = useState('');
  const [bLevel, setBLevel] = useState(1);
  const [bEffect, setBEffect] = useState('');
  const [bAppearance, setBAppearance] = useState('');
  const [bDesc, setBDesc] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [memberPick, setMemberPick] = useState('');
  const [memberRole, setMemberRole] = useState('');

  const resetBuildingForm = () => { setBName(''); setBLevel(1); setBEffect(''); setBAppearance(''); setBDesc(''); setAddingBuilding(false); };
  const submitBuilding = () => {
    const nm = bName.trim();
    if (!nm) return;
    const existing = T.buildings.some((x) => x.name.trim().toLowerCase() === nm.toLowerCase());
    if (!existing && T.buildings.length >= cap) { alert(`建筑数量已达上限（${cap} 栋）。请先升级 / 拆除现有建筑，或提升领地等级后再建。`); return; }
    T.upsertBuilding({ name: nm, level: bLevel, effect: bEffect.trim(), appearance: bAppearance.trim(), description: bDesc.trim() || undefined });
    resetBuildingForm();
  };
  const memberIds = new Set(T.members.map((m) => m.id));
  const availableNpcs = Object.values(npcs).filter((r) => hasRealNpcName(r) && !r.isDead && !memberIds.has(r.id));
  const submitMember = () => {
    if (!memberPick) return;
    T.addMember(memberPick, { role: memberRole.trim() || undefined });
    setMemberPick(''); setMemberRole(''); setAddingMember(false);
  };

  // 仓库 → 背包：整摞取出到主角随身背包，再从领地仓库移除。
  // 有完整快照(it.item)就原样还原全字段（词缀/强化/宝石/评分…），只换新 id、用仓库现存数量；
  // 无快照(AI 记的材料)才回退到扁平字段。
  const moveItemToBackpack = (it: TerritoryItem) => {
    if (it.item) {
      const { id: _id, addedAt: _at, ...rest } = it.item;
      useItems.getState().addItem({ ...rest, quantity: it.quantity, equipped: false });
    } else {
      useItems.getState().addItem({
        name: it.name,
        category: (it.category as ItemCategory) || '其他物品',
        gradeDesc: it.gradeDesc || '',
        effect: it.effect || '',
        quantity: it.quantity,
        equipped: false,
        tags: [],
        appearance: it.appearance,
        notes: it.desc,
      });
    }
    T.takeItem(it.id);   // 传 id → 整摞取出
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-2xl max-h-[88dvh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
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
            <Section
              title="建筑"
              count={`${T.buildings.length}/${cap}`}
              action={
                <button
                  onClick={() => setAddingBuilding((v) => !v)}
                  title={T.buildings.length >= cap ? `建筑已达上限（${cap} 栋）` : '手动新建建筑'}
                  className="shrink-0 self-center text-[11px] font-mono text-dim/50 hover:text-god transition-colors"
                >{addingBuilding ? '取消' : '＋新建'}</button>
              }
            >
              {addingBuilding && (
                <div className="rounded-lg border border-god/30 bg-void/60 p-2.5 space-y-2">
                  <input autoFocus value={bName} onChange={(e) => setBName(e.target.value)} placeholder="建筑名称（必填）"
                    onKeyDown={(e) => { if (e.key === 'Enter') submitBuilding(); if (e.key === 'Escape') resetBuildingForm(); }}
                    className="w-full bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-100 outline-none focus:border-god/60 placeholder:text-dim/30" />
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-dim/50">等级</span>
                    <select value={bLevel} onChange={(e) => setBLevel(Number(e.target.value))}
                      className="bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-100 outline-none focus:border-god/60">
                      {Array.from({ length: BUILDING_MAX_LEVEL }, (_, i) => i + 1).map((lv) => <option key={lv} value={lv}>Lv.{lv}</option>)}
                    </select>
                  </div>
                  <input value={bEffect} onChange={(e) => setBEffect(e.target.value)} placeholder="效果（如：每回合产 50 乐园币 / +10% 制作成功率）"
                    className="w-full bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-100 outline-none focus:border-god/60 placeholder:text-dim/30" />
                  <input value={bAppearance} onChange={(e) => setBAppearance(e.target.value)} placeholder="外观（可选）"
                    className="w-full bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-100 outline-none focus:border-god/60 placeholder:text-dim/30" />
                  <input value={bDesc} onChange={(e) => setBDesc(e.target.value)} placeholder="说明（可选）"
                    className="w-full bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-100 outline-none focus:border-god/60 placeholder:text-dim/30" />
                  <div className="flex items-center justify-end gap-2 pt-0.5">
                    <button onClick={resetBuildingForm} className="text-[12px] font-mono text-dim/50 hover:text-slate-200 px-2 py-1">取消</button>
                    <button onClick={submitBuilding} disabled={!bName.trim()}
                      className="text-[12px] font-mono px-3 py-1 rounded bg-god/20 border border-god/40 text-god hover:bg-god/30 disabled:opacity-30 disabled:cursor-not-allowed">添加</button>
                  </div>
                </div>
              )}
              {T.buildings.length === 0
                ? (!addingBuilding && <Empty text="（暂无建筑）" />)
                : <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">{T.buildings.map((b) => (
                    <BuildingCard key={b.id} b={b}
                      onDelete={() => { if (confirm(`确认拆除建筑「${b.name}」？`)) T.removeBuilding(b.name); }}
                      onLevel={(lv) => T.setBuildingLevel(b.name, lv)} />
                  ))}</div>}
            </Section>

            {/* 成员（关联 NPC） */}
            <Section
              title="领地成员"
              count={T.members.length}
              action={
                <button
                  onClick={() => setAddingMember((v) => !v)}
                  title="关联已建档 NPC 为领地成员"
                  className="shrink-0 self-center text-[11px] font-mono text-dim/50 hover:text-violet-300 transition-colors"
                >{addingMember ? '取消' : '＋添加'}</button>
              }
            >
              {addingMember && (
                <div className="rounded-lg border border-violet-700/30 bg-void/60 p-2.5 space-y-2">
                  {availableNpcs.length === 0 ? (
                    <div className="text-[12px] text-dim/40 leading-relaxed">没有可关联的已建档 NPC（成员只能关联已建档的 NPC；当前 NPC 都已是成员，或还没有已建档的 NPC）。</div>
                  ) : (
                    <>
                      <select value={memberPick} onChange={(e) => setMemberPick(e.target.value)}
                        className="w-full bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-100 outline-none focus:border-violet-500/60">
                        <option value="">选择要关联的 NPC…</option>
                        {availableNpcs.map((r) => <option key={r.id} value={r.id}>{r.id}·{r.name}{r.realm ? `（${r.realm}）` : ''}</option>)}
                      </select>
                      <input value={memberRole} onChange={(e) => setMemberRole(e.target.value)} placeholder="职务（可选，如：工坊主管）"
                        onKeyDown={(e) => { if (e.key === 'Enter') submitMember(); }}
                        className="w-full bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-100 outline-none focus:border-violet-500/60 placeholder:text-dim/30" />
                      <div className="flex items-center justify-end gap-2 pt-0.5">
                        <button onClick={() => { setAddingMember(false); setMemberPick(''); setMemberRole(''); }} className="text-[12px] font-mono text-dim/50 hover:text-slate-200 px-2 py-1">取消</button>
                        <button onClick={submitMember} disabled={!memberPick}
                          className="text-[12px] font-mono px-3 py-1 rounded bg-violet-900/30 border border-violet-700/50 text-violet-300 hover:bg-violet-900/50 disabled:opacity-30 disabled:cursor-not-allowed">添加</button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {T.members.length === 0
                ? (!addingMember && <Empty text="（暂无驻留成员）" />)
                : <div className="flex flex-wrap gap-2">{T.members.map((m) => {
                    const rec = npcs[m.id];
                    return (
                      <div key={m.id}
                        className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[13px] font-mono ${rec ? 'border-violet-700/50' : 'border-edge'}`}>
                        <button
                          onClick={() => rec && setNpcDetailId(m.id)}
                          className={`flex items-center ${rec ? 'text-violet-300 hover:text-violet-200' : 'text-dim/50 cursor-default'}`}>
                          <span>{m.id}</span>
                          {rec?.name && rec.name !== m.id && <span className="text-slate-200">·{rec.name}</span>}
                          {m.role && <span className="text-dim/60">（{m.role}）</span>}
                        </button>
                        <button
                          onClick={() => { if (confirm(`确认移除领地成员「${rec?.name || m.id}」？`)) T.removeMember(m.id); }}
                          title="移除该成员"
                          className="opacity-0 group-hover:opacity-100 text-dim/40 hover:text-blood text-[11px] transition-opacity">✕</button>
                      </div>
                    );
                  })}</div>}
            </Section>

            {/* 仓库（与主角背包分离；可整摞取出到背包 / 删除 / 一键清空）*/}
            <Section
              title="仓库"
              count={T.storageItems.length}
              action={T.storageItems.length > 0 && (
                <button
                  onClick={() => { if (confirm(`确认清空仓库全部 ${T.storageItems.length} 种物资？此操作不可撤销（不会转入背包）。`)) T.clearStorage(); }}
                  title="一键清空整个仓库（直接删除，不转入背包）"
                  className="shrink-0 self-center text-[11px] font-mono text-dim/40 hover:text-blood transition-colors"
                >一键清空</button>
              )}
            >
              {T.storageItems.length === 0
                ? <Empty text="（仓库为空）" />
                : <div className="space-y-1">{T.storageItems.map((it) => (
                    <div key={it.id} className="group flex items-center gap-2 px-2.5 py-1.5 rounded border border-edge bg-void/60">
                      <span className="flex-1 text-[13px] text-slate-200 truncate">{it.name}
                        {it.gradeDesc && <span className="text-dim/50 text-[11px] ml-1">{it.gradeDesc}</span>}
                        {it.category && <span className="text-dim/40 text-[11px] ml-1">[{it.category}]</span>}
                      </span>
                      <span className="text-[12px] font-mono text-amber-300/80 shrink-0">×{it.quantity}</span>
                      <button
                        onClick={() => moveItemToBackpack(it)}
                        title="整摞取出到主角背包"
                        className="shrink-0 opacity-0 group-hover:opacity-100 text-dim/50 hover:text-god text-[11px] font-mono transition-opacity"
                      >→背包</button>
                      <button
                        onClick={() => { if (confirm(`确认从仓库删除「${it.name}」×${it.quantity}？`)) T.takeItem(it.id); }}
                        title="从仓库删除该物资（不转入背包）"
                        className="shrink-0 opacity-0 group-hover:opacity-100 text-dim/40 hover:text-blood text-[12px] font-mono transition-opacity"
                      >✕</button>
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

function BuildingCard({ b, onDelete, onLevel }: { b: Building; onDelete: () => void; onLevel: (lv: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="group rounded-lg border border-edge bg-panel px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2 cursor-pointer" onClick={() => setOpen(!open)}>
        <span className="text-[13px] text-slate-100 font-mono truncate">{b.name}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] font-mono text-sky-300/80">Lv.{b.level}/{BUILDING_MAX_LEVEL}</span>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="拆除该建筑"
            className="opacity-0 group-hover:opacity-100 text-dim/40 hover:text-blood text-[12px] font-mono transition-opacity">✕</button>
        </div>
      </div>
      {b.effect && <div className="text-[12px] text-emerald-300/80 mt-1 leading-snug">{b.effect}</div>}
      {open && (
        <div className="mt-1.5 space-y-1.5 text-[12px] text-dim/70" onClick={(e) => e.stopPropagation()}>
          {b.appearance && <div><span className="text-dim/40">外观：</span>{b.appearance}</div>}
          {b.description && <div><span className="text-dim/40">说明：</span>{b.description}</div>}
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-dim/40">等级</span>
            <button onClick={() => onLevel(Math.max(1, b.level - 1))} disabled={b.level <= 1}
              className="w-5 h-5 flex items-center justify-center rounded border border-edge text-dim/70 hover:text-god hover:border-god/50 disabled:opacity-30 disabled:cursor-not-allowed">−</button>
            <span className="font-mono text-sky-300/80">Lv.{b.level}/{BUILDING_MAX_LEVEL}</span>
            <button onClick={() => onLevel(Math.min(BUILDING_MAX_LEVEL, b.level + 1))} disabled={b.level >= BUILDING_MAX_LEVEL}
              className="w-5 h-5 flex items-center justify-center rounded border border-edge text-dim/70 hover:text-god hover:border-god/50 disabled:opacity-30 disabled:cursor-not-allowed">＋</button>
          </div>
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
