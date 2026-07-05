import { useMemo, useState } from 'react';
import { useCharacters, SKILL_TIER_CLS, SKILL_TIER_DOT, normSkillTier, RARITY_CLS, RARITY_DOT, type Skill, type Talent } from '../store/characterStore';
import { useLoadout } from '../store/loadoutStore';
import { uploadLocal, uploaderName } from '../systems/workshop';

/* 体系 / 流派（技能·天赋「装备栏 / loadout」）——主角 B1。
   出战区 = characters['B1']；替补席 = loadoutStore.bench。应用模板=按模板分区，卸载=替补全回流（零丢失）。
   浏览/下载他人体系在「🧩 创意工坊」面板（install 只把模板加进 builds[]，回这里点「应用」才生效）。 */

const norm = (s?: string) => (s ?? '').replace(/[\s·•・\-—_,，.。、|｜()（）【】\[\]:：]/g, '').trim().toLowerCase();
const eqName = (a?: string, b?: string) => { const x = norm(a), y = norm(b); return !!x && x === y; };

function SkillChip({ sk, selectable, selected, onToggle, action }: {
  sk: Skill; selectable?: boolean; selected?: boolean; onToggle?: () => void; action?: React.ReactNode;
}) {
  const tier = normSkillTier(sk.rarity);
  return (
    <div
      onClick={selectable ? onToggle : undefined}
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[13px] ${SKILL_TIER_CLS[tier] ?? SKILL_TIER_CLS['普通']} ${selectable ? 'cursor-pointer' : ''} ${selected ? 'ring-2 ring-god/70' : ''}`}>
      {selectable && <span className={`shrink-0 w-4 h-4 rounded border grid place-items-center text-[10px] ${selected ? 'bg-god/80 border-god text-black' : 'border-edge text-transparent'}`}>✓</span>}
      <span className={`shrink-0 w-2 h-2 rounded-full ${SKILL_TIER_DOT[tier] ?? 'bg-slate-400'}`} />
      <span className="font-medium text-slate-100 truncate">{sk.name}</span>
      {sk.skillType && <span className="text-[11px] text-dim/60 shrink-0">{sk.skillType}</span>}
      {sk.level && <span className="text-[11px] font-mono text-dim/50 shrink-0 ml-auto">{sk.level}</span>}
      {action && <span className="shrink-0 ml-auto flex items-center gap-1">{action}</span>}
    </div>
  );
}

function TalentChip({ tr, selectable, selected, onToggle, action }: {
  tr: Talent; selectable?: boolean; selected?: boolean; onToggle?: () => void; action?: React.ReactNode;
}) {
  return (
    <div
      onClick={selectable ? onToggle : undefined}
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[13px] ${RARITY_CLS[tr.rarity] ?? RARITY_CLS['C']} ${selectable ? 'cursor-pointer' : ''} ${selected ? 'ring-2 ring-god/70' : ''}`}>
      {selectable && <span className={`shrink-0 w-4 h-4 rounded border grid place-items-center text-[10px] ${selected ? 'bg-god/80 border-god text-black' : 'border-edge text-transparent'}`}>✓</span>}
      <span className={`shrink-0 w-2 h-2 rounded-full ${RARITY_DOT[tr.rarity] ?? 'bg-slate-400'}`} />
      <span className="font-medium text-slate-100 truncate">{tr.name}</span>
      {tr.category && <span className="text-[11px] text-dim/60 shrink-0">{tr.category}</span>}
      {action && <span className="shrink-0 ml-auto flex items-center gap-1">{action}</span>}
    </div>
  );
}

const iconBtn = 'text-[12px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim hover:text-god hover:border-god/50 transition-colors';

export default function LoadoutPanel({ onClose }: { onClose: () => void }) {
  const actSkills = useCharacters((s) => s.characters['B1']?.skills ?? []);
  const actTraits = useCharacters((s) => s.characters['B1']?.traits ?? []);

  const builds = useLoadout((s) => s.builds);
  const activeBuildId = useLoadout((s) => s.activeBuildId);
  const bench = useLoadout((s) => s.bench);
  const applyBuild = useLoadout((s) => s.applyBuild);
  const unapplyBuild = useLoadout((s) => s.unapplyBuild);
  const removeBuild = useLoadout((s) => s.removeBuild);
  const updateBuild = useLoadout((s) => s.updateBuild);
  const saveBuildFromNames = useLoadout((s) => s.saveBuildFromNames);
  const benchSkill = useLoadout((s) => s.benchSkill);
  const activateSkill = useLoadout((s) => s.activateSkill);
  const benchTalent = useLoadout((s) => s.benchTalent);
  const activateTalent = useLoadout((s) => s.activateTalent);
  const deleteEverywhere = useLoadout((s) => s.deleteEverywhere);

  const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState<{ id: string | null; name: string; desc: string; selS: string[]; selT: string[] } | null>(null);
  const [busyUpload, setBusyUpload] = useState('');

  const toast = (m: string, ms = 3500) => { setMsg(m); if (ms) setTimeout(() => setMsg(''), ms); };

  // 全部技能/天赋池（出战 ∪ 替补），编辑模式勾选用
  const poolS = useMemo(() => {
    const out = [...actSkills];
    for (const s of bench.skills) if (!out.some((y) => eqName(y.name, s.name))) out.push(s);
    return out;
  }, [actSkills, bench.skills]);
  const poolT = useMemo(() => {
    const out = [...actTraits];
    for (const t of bench.traits) if (!out.some((y) => eqName(y.name, t.name))) out.push(t);
    return out;
  }, [actTraits, bench.traits]);

  const startNew = () => setEdit({ id: null, name: '', desc: '', selS: [], selT: [] });
  const startEdit = (id: string) => {
    const b = builds.find((x) => x.id === id); if (!b) return;
    setEdit({ id, name: b.name, desc: b.desc ?? '', selS: b.skills.map((s) => s.name), selT: b.traits.map((t) => t.name) });
  };
  const toggle = (kind: 'S' | 'T', name: string) => setEdit((e) => {
    if (!e) return e;
    const key = kind === 'S' ? 'selS' : 'selT';
    const cur = e[key];
    return { ...e, [key]: cur.some((n) => eqName(n, name)) ? cur.filter((n) => !eqName(n, name)) : [...cur, name] };
  });
  const saveEdit = () => {
    if (!edit) return;
    if (edit.selS.length + edit.selT.length === 0) { toast('至少选 1 个技能或天赋'); return; }
    if (edit.id) {
      const skills = edit.selS.map((n) => poolS.find((s) => eqName(s.name, n))).filter(Boolean) as Skill[];
      const traits = edit.selT.map((n) => poolT.find((t) => eqName(t.name, n))).filter(Boolean) as Talent[];
      updateBuild(edit.id, { name: edit.name.trim() || '未命名体系', desc: edit.desc.trim() || undefined, skills, traits });
      toast(`✓ 已更新体系「${edit.name.trim() || '未命名体系'}」`);
    } else {
      saveBuildFromNames(edit.name, edit.selS, edit.selT, edit.desc.trim() || undefined);
      toast(`✓ 已保存体系「${edit.name.trim() || '未命名体系'}」`);
    }
    setEdit(null);
  };

  const doApply = (id: string, name: string) => {
    applyBuild(id);
    toast(`⚔ 已应用体系「${name}」——不在其中的技能/天赋已收进替补席`);
  };
  const doUnapply = () => { unapplyBuild(); toast('🔓 已卸载体系——替补席全部回到出战区'); };
  const doDeleteBuild = (id: string, name: string) => {
    if (!window.confirm(`删除体系模板「${name}」？（仅删模板，不影响你的技能/天赋）`)) return;
    removeBuild(id);
  };
  const doUpload = async (id: string, name: string) => {
    if (!uploaderName()) { toast('请先在「设置」里起一个工坊昵称再上传'); return; }
    setBusyUpload(id);
    try {
      await uploadLocal('loadout', id, { name });
      toast(`🎴 已上传体系「${name}」到创意工坊`);
    } catch (e: any) {
      toast('上传失败：' + (e?.message || String(e)), 6000);
    } finally { setBusyUpload(''); }
  };

  const inEdit = !!edit;
  const selCount = edit ? edit.selS.length + edit.selT.length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-4xl max-h-[88dvh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <header className="flex items-center justify-between p-4 border-b border-edge shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🎴</span>
              <h2 className="text-base font-bold text-slate-100">体系 / 流派</h2>
              <span className="text-[13px] font-mono text-dim/50">{builds.length} 套模板</span>
            </div>
            <p className="text-[13px] text-dim/60 mt-0.5">
              {inEdit
                ? <span className="text-god/80">编辑模式：勾选要放进模板的技能 / 天赋（可选出战区或替补席里的任意条目）。</span>
                : <>应用模板 → 只留模板内技能，其余收进<span className="text-god/80">替补席</span>；卸载 → 全部回流。浏览/下载他人体系在「🧩 创意工坊」。</>}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!inEdit && <button onClick={startNew} className="text-[12px] font-mono px-2 py-1 rounded border border-god/40 text-god hover:bg-god/10 transition-colors">＋ 新建体系</button>}
            <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {msg && <div className="text-[13px] text-god bg-god/10 border border-god/30 rounded-lg px-3 py-2">{msg}</div>}

          {/* ── 编辑模式：从「出战∪替补」全池勾选 ── */}
          {inEdit ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <input autoFocus value={edit!.name} onChange={(e) => setEdit((s) => s && { ...s, name: e.target.value })}
                  placeholder="体系名，如「剑刃风暴流」" className="flex-1 min-w-[180px] bg-black/30 border border-edge rounded-lg px-3 py-1.5 text-[13px] text-slate-100 placeholder:text-dim/40 focus:border-god/50 outline-none" />
                <span className="text-[12px] font-mono text-dim/60">已选 {selCount}</span>
                <button onClick={saveEdit} className="text-[12px] font-mono px-3 py-1.5 rounded border border-god/50 text-god hover:bg-god/10">{edit!.id ? '保存修改' : '保存体系'}</button>
                <button onClick={() => setEdit(null)} className="text-[12px] font-mono px-3 py-1.5 rounded border border-edge text-dim hover:text-blood hover:border-blood/50">取消</button>
              </div>
              <input value={edit!.desc} onChange={(e) => setEdit((s) => s && { ...s, desc: e.target.value })}
                placeholder="简介（可选）" className="w-full bg-black/30 border border-edge rounded-lg px-3 py-1.5 text-[13px] text-slate-100 placeholder:text-dim/40 focus:border-god/50 outline-none" />
              {poolS.length > 0 && <>
                <div className="text-[12px] font-mono text-dim/50 pt-1">技能池（{poolS.length}）</div>
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {poolS.map((sk) => <SkillChip key={sk.id} sk={sk} selectable selected={edit!.selS.some((n) => eqName(n, sk.name))} onToggle={() => toggle('S', sk.name)} />)}
                </div>
              </>}
              {poolT.length > 0 && <>
                <div className="text-[12px] font-mono text-dim/50 pt-1">天赋池（{poolT.length}）</div>
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {poolT.map((tr) => <TalentChip key={tr.name} tr={tr} selectable selected={edit!.selT.some((n) => eqName(n, tr.name))} onToggle={() => toggle('T', tr.name)} />)}
                </div>
              </>}
              {poolS.length + poolT.length === 0 && <div className="text-[13px] text-dim/50 text-center py-8">还没有技能 / 天赋，先在剧情里获得吧。</div>}
            </div>
          ) : (
            <>
              {/* ── 模板库 ── */}
              <section className="space-y-2">
                {builds.length === 0 && <div className="text-[13px] text-dim/50 text-center py-4 border border-dashed border-edge rounded-xl">还没有体系模板。点右上「＋ 新建体系」把当前技能存成一套，或去「🧩 创意工坊」下载他人的体系。</div>}
                {builds.map((b) => {
                  const active = b.id === activeBuildId;
                  return (
                    <div key={b.id} className={`rounded-xl border p-3 ${active ? 'border-god/60 bg-god/5' : 'border-edge bg-black/20'}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-bold text-slate-100">{b.name}</span>
                        {active && <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-god/20 text-god border border-god/40">应用中</span>}
                        <span className="text-[12px] font-mono text-dim/50">✨{b.skills.length} · 🧬{b.traits.length}</span>
                        <div className="ml-auto flex items-center gap-1.5">
                          {active
                            ? <button onClick={doUnapply} className="text-[12px] font-mono px-2 py-1 rounded border border-blood/40 text-blood/90 hover:bg-blood/10">🔓 卸载</button>
                            : <button onClick={() => doApply(b.id, b.name)} className="text-[12px] font-mono px-2 py-1 rounded border border-god/50 text-god hover:bg-god/10">⚔ 应用</button>}
                          <button onClick={() => startEdit(b.id)} className={iconBtn}>编辑</button>
                          <button disabled={busyUpload === b.id} onClick={() => doUpload(b.id, b.name)} className={`${iconBtn} disabled:opacity-40`}>{busyUpload === b.id ? '上传中…' : '⬆工坊'}</button>
                          <button onClick={() => doDeleteBuild(b.id, b.name)} className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim hover:text-blood hover:border-blood/50">删除</button>
                        </div>
                      </div>
                      {b.desc && <p className="text-[12px] text-dim/60 mt-1">{b.desc}</p>}
                    </div>
                  );
                })}
              </section>

              {/* ── 出战区 ｜ 替补席 ── */}
              <div className="grid md:grid-cols-2 gap-4 pt-1">
                {/* 出战区 */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-[13px] font-bold text-slate-200">
                    <span>⚔ 出战区</span><span className="text-[12px] font-mono text-dim/50">{actSkills.length + actTraits.length} 生效</span>
                  </div>
                  {actSkills.map((sk) => <SkillChip key={sk.id} sk={sk} action={<button title="收进替补席" onClick={() => benchSkill(sk.name)} className={iconBtn}>⬇</button>} />)}
                  {actTraits.map((tr) => <TalentChip key={tr.name} tr={tr} action={<button title="收进替补席" onClick={() => benchTalent(tr.name)} className={iconBtn}>⬇</button>} />)}
                  {actSkills.length + actTraits.length === 0 && <div className="text-[12px] text-dim/40 py-6 text-center border border-dashed border-edge rounded-lg">出战区空</div>}
                </div>
                {/* 替补席 */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-[13px] font-bold text-slate-200">
                    <span>🗄 替补席</span><span className="text-[12px] font-mono text-dim/50">{bench.skills.length + bench.traits.length} 收纳</span>
                  </div>
                  {bench.skills.map((sk) => <SkillChip key={sk.id} sk={sk} action={<>
                    <button title="上场" onClick={() => activateSkill(sk.name)} className={iconBtn}>⬆</button>
                    <button title="永久删除" onClick={() => deleteEverywhere('skill', sk.name)} className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim hover:text-blood hover:border-blood/50">🗑</button>
                  </>} />)}
                  {bench.traits.map((tr) => <TalentChip key={tr.name} tr={tr} action={<>
                    <button title="上场" onClick={() => activateTalent(tr.name)} className={iconBtn}>⬆</button>
                    <button title="永久删除" onClick={() => deleteEverywhere('talent', tr.name)} className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim hover:text-blood hover:border-blood/50">🗑</button>
                  </>} />)}
                  {bench.skills.length + bench.traits.length === 0 && <div className="text-[12px] text-dim/40 py-6 text-center border border-dashed border-edge rounded-lg">替补席空</div>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
