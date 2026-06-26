import { useState, useMemo } from 'react';
import { useItems } from '../store/itemStore';
import { useCharacters, type Skill, type Trait, type SubProfession } from '../store/characterStore';
import {
  useSubProfTree, subProfMastery, SUBPROF_MASTERY_LADDER, SUBPROF_MASTERY_PER_SKILLPOINT,
} from '../store/subProfTreeStore';
import {
  generateSkillUpgrade, parseLevelNum, crossesWatershed, rarityIndex, bumpRarity,
  SKILL_RARITIES, TALENT_RARITIES, setSkillUpNote,
} from '../systems/skillUpgrade';

/* 乐园设施·技能升级面板：
   - 技能/天赋：技能点(升等级·跨10级分水岭加效果·平时涨数值)/黄金技能点(升品级·质变)，调 AI 生成升级效果。
   - 副职业/技艺：花技能点直接提升熟练度档位(新手→…→宗师)，纯机械(不调 AI)；升档后名下配方由正文演化自动质变。
   复用装备强化所的 API；结算→写回→扣点→给正文一条"已用掉"通知。 */

type Mode = 'normal' | 'golden';
type Sel = { kind: 'skill' | 'talent' | 'subprof'; key: string } | null;

/** 给定熟练度原始值，返回所属档名（新手→…→宗师）。 */
function tierForSpent(spent: number): string {
  let idx = 0;
  for (let i = SUBPROF_MASTERY_LADDER.length - 1; i >= 0; i--) { if (spent >= SUBPROF_MASTERY_LADDER[i].min) { idx = i; break; } }
  return SUBPROF_MASTERY_LADDER[idx].tier;
}

export default function SkillUpgradePanel({ onClose }: { onClose: () => void }) {
  const currency = useItems((s) => s.currency);
  const adjustCurrency = useItems((s) => s.adjustCurrency);
  const chars = useCharacters((s) => s.characters);
  const updateSkill = useCharacters((s) => s.updateSkill);
  const updateTrait = useCharacters((s) => s.updateTrait);
  const addSubProfMastery = useSubProfTree((s) => s.addSubProfMastery);
  const subProgress = useSubProfTree((s) => s.progress);   // 订阅：加熟练度后重算档位、刷新显示

  const b1 = chars['B1'];
  const skills: Skill[] = b1?.skills ?? [];
  const traits: Trait[] = b1?.traits ?? [];
  const subprofs: SubProfession[] = b1?.subProfessions ?? [];

  const [sel, setSel] = useState<Sel>(null);
  const [mode, setMode] = useState<Mode>('normal');
  const [points, setPoints] = useState(1);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<null | { name: string; level?: string; rarity?: string; effect?: string }>(null);

  const sp = currency['技能点'] ?? 0;
  const gp = currency['黄金技能点'] ?? 0;

  const isTalent = sel?.kind === 'talent';
  const isSubprof = sel?.kind === 'subprof';

  // 选中的技能/天赋（从 live store 取，升级后自动反映新值）
  const entry: Skill | Trait | undefined = useMemo(() => {
    if (!sel || sel.kind === 'subprof') return undefined;
    return sel.kind === 'skill' ? skills.find((s) => s.id === sel.key) : traits.find((t) => t.name === sel.key);
  }, [sel, skills, traits]);

  // ── 技能/天赋升级预览 ──
  const oldLv = parseLevelNum((entry as any)?.level);
  const newLv = oldLv + points;
  const crossed = crossesWatershed(oldLv, newLv);
  const ladder = isTalent ? TALENT_RARITIES : SKILL_RARITIES;
  const curIdx = rarityIndex((entry as any)?.rarity, isTalent);
  const maxRaritySteps = ladder.length - 1 - curIdx;
  const newRarity = bumpRarity((entry as any)?.rarity, isTalent, points);
  const avail = mode === 'normal' ? sp : gp;
  const pointsMax = Math.max(1, mode === 'normal' ? avail : Math.min(gp, maxRaritySteps || 0));
  const showCustom = (mode === 'normal' && crossed) || mode === 'golden';
  const goldenMaxed = mode === 'golden' && maxRaritySteps <= 0;
  const canSettle = !!entry && !busy && points >= 1 && points <= avail && !(mode === 'golden' && (maxRaritySteps <= 0 || points > maxRaritySteps));

  // ── 副职业熟练度预览 ──
  void subProgress;   // 订阅触发重算
  const subName = isSubprof ? sel!.key : null;
  const mastery = subName ? subProfMastery(subName) : null;
  const subGain = points * SUBPROF_MASTERY_PER_SKILLPOINT;
  const subNewSpent = (mastery?.spent ?? 0) + subGain;
  const subNewTier = tierForSpent(subNewSpent);
  const subMaxed = !!mastery && mastery.tier === '宗师';
  const canSettleSub = !!subName && points >= 1 && points <= sp;

  function pick(s: Sel) { setSel(s); setDone(null); setErr(''); setPoints(1); setCustom(''); setMode('normal'); }
  function switchMode(m: Mode) { setMode(m); setPoints(1); setDone(null); setErr(''); }

  async function settle() {
    if (!entry || !canSettle) return;
    setBusy(true); setErr(''); setDone(null);
    try {
      const res = await generateSkillUpgrade({ entry, isTalent, mode, points, newLevelNum: newLv, crossed, newRarity, customInput: custom });
      const { id: _id, addedAt: _a, ...patch } = res.apply as any;
      if (isTalent) updateTrait('B1', entry.name, patch);
      else updateSkill('B1', (entry as Skill).id, patch);
      adjustCurrency(mode === 'normal' ? '技能点' : '黄金技能点', -points);
      const descChange = mode === 'normal' ? `Lv.${oldLv} → Lv.${newLv}` : `品级 ${(entry as any).rarity ?? ''} → ${newRarity}`;
      setSkillUpNote(`（系统·面板已结算：主角消耗 ${points} ${mode === 'normal' ? '技能点' : '黄金技能点'}，将${isTalent ? '天赋' : '技能'}「${entry.name}」升级（${descChange}）。此为面板结算结果，正文知晓即可、无需就此展开情节。）`);
      setDone({ name: entry.name, level: patch.level, rarity: patch.rarity, effect: patch.effect });
    } catch (e: any) {
      setErr(e?.message ?? '生成失败');
    } finally {
      setBusy(false);
    }
  }

  // 副职业：纯机械，不调 AI
  function settleSubprof() {
    if (!subName || !canSettleSub) return;
    const before = subProfMastery(subName);
    addSubProfMastery('B1', subName, subGain);
    adjustCurrency('技能点', -points);
    const after = subProfMastery(subName);
    setSkillUpNote(`（系统·面板已结算：主角消耗 ${points} 技能点钻研副职业「${subName}」，熟练度提升（${before.tier} → ${after.tier}）。此为面板结算结果，正文知晓即可、无需就此展开情节。）`);
    setDone({ name: subName, rarity: after.tier, effect: `熟练度档位：${after.tier}${after.tier === '宗师' ? '（已登顶）' : `（距「${SUBPROF_MASTERY_LADDER[Math.min(SUBPROF_MASTERY_LADDER.length - 1, before.idx + 1)]?.tier}」还差 ${Math.max(0, (after.nextMin ?? after.spent) - after.spent)} 熟练度）`}` });
    setPoints(1);
  }

  const empty = skills.length === 0 && traits.length === 0 && subprofs.length === 0;
  const chipCls = (on: boolean) => `px-2.5 py-1 rounded-lg border text-[12px] transition-colors ${on ? 'border-god/70 bg-god/15 text-slate-100' : 'border-edge text-slate-300 hover:border-god/40'}`;

  return (
    <div className="fixed inset-0 z-[72] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-edge bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">🔼 技能升级</h2>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <span className="px-2.5 py-1 rounded-lg border border-sky-500/40 text-sky-300 bg-sky-500/10">技能点 <b className="text-sky-200">{sp}</b></span>
          <span className="px-2.5 py-1 rounded-lg border border-amber-500/40 text-amber-300 bg-amber-500/10">黄金技能点 <b className="text-amber-200">{gp}</b></span>
        </div>
        <div className="text-[11px] text-dim/50 leading-relaxed">
          技能/天赋：技能点升等级（跨 10 级新增效果·平时涨数值）、黄金技能点升品级质变。副职业/技艺：花技能点提升熟练度档位至宗师（升档后名下配方由正文自动质变）。与装备强化共用 AI 接口。
        </div>

        {empty ? (
          <div className="text-center text-dim/50 py-8 text-sm">暂无可升级的技能 / 天赋 / 副职业。</div>
        ) : (
          <>
            <div className="space-y-2">
              {skills.length > 0 && (
                <div>
                  <div className="text-[11px] text-dim/50 mb-1">技能</div>
                  <div className="flex flex-wrap gap-1.5">
                    {skills.map((s) => (
                      <button key={s.id} onClick={() => pick({ kind: 'skill', key: s.id })} className={chipCls(sel?.kind === 'skill' && sel.key === s.id)}>
                        {s.name}<span className="text-dim/40 ml-1">{s.rarity ?? ''}·{s.level ?? ''}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {traits.length > 0 && (
                <div>
                  <div className="text-[11px] text-dim/50 mb-1">天赋</div>
                  <div className="flex flex-wrap gap-1.5">
                    {traits.map((t) => (
                      <button key={t.name} onClick={() => pick({ kind: 'talent', key: t.name })} className={chipCls(sel?.kind === 'talent' && sel.key === t.name)}>
                        {t.name}<span className="text-dim/40 ml-1">{t.rarity ?? ''}级</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {subprofs.length > 0 && (
                <div>
                  <div className="text-[11px] text-dim/50 mb-1">副职业 / 技艺</div>
                  <div className="flex flex-wrap gap-1.5">
                    {subprofs.map((sp2) => {
                      const m = subProfMastery(sp2.name);
                      return (
                        <button key={sp2.name} onClick={() => pick({ kind: 'subprof', key: sp2.name })} className={chipCls(sel?.kind === 'subprof' && sel.key === sp2.name)}>
                          {sp2.name}<span className="text-dim/40 ml-1">{m.tier}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── 技能 / 天赋 升级 ── */}
            {entry && (
              <div className="space-y-3 border-t border-edge/60 pt-3">
                <div className="rounded-xl border border-edge bg-panel2/40 p-3">
                  <div className="text-sm font-semibold text-slate-100">{entry.name}
                    <span className="text-[11px] text-dim/50 ml-2">{(entry as any).rarity ?? ''}{isTalent ? '级' : ''} · {(entry as any).level ?? ''}</span>
                  </div>
                  {(entry as any).effect && <div className="text-[11px] text-dim/70 mt-1 leading-relaxed line-clamp-4 whitespace-pre-wrap">{(entry as any).effect}</div>}
                </div>

                <div className="flex gap-2">
                  <button onClick={() => switchMode('normal')} className={`flex-1 px-3 py-2 rounded-xl border text-[12px] transition-colors ${mode === 'normal' ? 'border-sky-500/70 bg-sky-500/15 text-sky-100' : 'border-edge text-slate-300 hover:border-sky-500/40'}`}>
                    普通升级<span className="block text-[10px] text-dim/50">技能点 · 升等级</span>
                  </button>
                  <button onClick={() => switchMode('golden')} className={`flex-1 px-3 py-2 rounded-xl border text-[12px] transition-colors ${mode === 'golden' ? 'border-amber-500/70 bg-amber-500/15 text-amber-100' : 'border-edge text-slate-300 hover:border-amber-500/40'}`}>
                    黄金质变<span className="block text-[10px] text-dim/50">黄金技能点 · 升品级</span>
                  </button>
                </div>

                {goldenMaxed ? (
                  <div className="text-[12px] text-amber-300/80 text-center py-2">已是最高品级（{(entry as any).rarity}），无法再质变。</div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12px] text-dim/70">投入{mode === 'normal' ? '技能点' : '黄金技能点'}</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setPoints((p) => Math.max(1, p - 1))} className="w-7 h-7 rounded-lg border border-edge text-slate-300 hover:border-god/50">−</button>
                        <span className="w-8 text-center text-slate-100 font-mono">{points}</span>
                        <button onClick={() => setPoints((p) => Math.min(pointsMax, p + 1))} className="w-7 h-7 rounded-lg border border-edge text-slate-300 hover:border-god/50">＋</button>
                      </div>
                    </div>
                    <div className="text-[12px] text-center text-slate-200 bg-panel2/40 rounded-lg py-1.5 border border-edge/60">
                      {mode === 'normal'
                        ? <>Lv.{oldLv} <span className="text-god">→</span> Lv.{newLv}{crossed && <span className="ml-2 text-amber-300">⚡跨分水岭·新增效果</span>}</>
                        : <>品级 {(entry as any).rarity ?? '—'} <span className="text-amber-400">→</span> {newRarity} <span className="ml-1 text-amber-300">·质变</span></>}
                    </div>
                    {showCustom && (
                      <textarea value={custom} onChange={(e) => setCustom(e.target.value)} rows={2}
                        placeholder="描述你想要的新效果（可留空，留空 AI 会按技能主题自动设计）"
                        className="w-full rounded-xl border border-edge bg-panel2/40 px-3 py-2 text-[12px] text-slate-200 placeholder:text-dim/40 focus:border-god/50 outline-none resize-none" />
                    )}
                    {avail < points && <div className="text-[11px] text-blood/80 text-center">{mode === 'normal' ? '技能点' : '黄金技能点'}不足（需 {points}，有 {avail}）。</div>}
                    <button onClick={settle} disabled={!canSettle} className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-colors ${canSettle ? 'bg-god/20 border border-god/60 text-god hover:bg-god/30' : 'bg-panel2/30 border border-edge text-dim/40 cursor-not-allowed'}`}>
                      {busy ? '⏳ 淬炼中…（调用 AI 生成升级效果）' : '⚡ 结算升级'}
                    </button>
                  </>
                )}
                {err && <div className="text-[11px] text-blood/90 bg-blood/10 border border-blood/30 rounded-lg p-2 leading-relaxed">{err}</div>}
                {done && (
                  <div className="rounded-xl border border-god/50 bg-god/10 p-3 space-y-1">
                    <div className="text-[12px] text-god font-semibold">✓ 已升级「{done.name}」 {done.rarity ? `· ${done.rarity}` : ''} {done.level ?? ''}</div>
                    {done.effect && <div className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap line-clamp-6">{done.effect}</div>}
                    <div className="text-[10px] text-dim/50">已扣除点数；正文将收到一条"点数已用掉"的提示。可在「技能」面板查看。</div>
                  </div>
                )}
              </div>
            )}

            {/* ── 副职业 / 技艺 提升熟练度 ── */}
            {subName && mastery && (
              <div className="space-y-3 border-t border-edge/60 pt-3">
                <div className="rounded-xl border border-edge bg-panel2/40 p-3 space-y-1.5">
                  <div className="text-sm font-semibold text-slate-100">{subName}<span className="text-[11px] text-dim/50 ml-2">熟练度档位：{mastery.tier}</span></div>
                  <div className="h-1.5 rounded-full bg-edge/60 overflow-hidden"><div className="h-full bg-emerald-400/70" style={{ width: `${mastery.pct}%` }} /></div>
                  <div className="text-[10px] text-dim/50">熟练度 {mastery.spent}{mastery.nextMin ? ` / 下一档「${tierForSpent(mastery.nextMin)}」需 ${mastery.nextMin}` : '（已登顶宗师）'}</div>
                </div>

                {subMaxed ? (
                  <div className="text-[12px] text-emerald-300/80 text-center py-2">已是宗师，熟练度已登顶。</div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12px] text-dim/70">投入技能点（1 点 = +{SUBPROF_MASTERY_PER_SKILLPOINT} 熟练度）</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setPoints((p) => Math.max(1, p - 1))} className="w-7 h-7 rounded-lg border border-edge text-slate-300 hover:border-god/50">−</button>
                        <span className="w-8 text-center text-slate-100 font-mono">{points}</span>
                        <button onClick={() => setPoints((p) => Math.min(Math.max(1, sp), p + 1))} className="w-7 h-7 rounded-lg border border-edge text-slate-300 hover:border-god/50">＋</button>
                      </div>
                    </div>
                    <div className="text-[12px] text-center text-slate-200 bg-panel2/40 rounded-lg py-1.5 border border-edge/60">
                      熟练度 {mastery.spent} <span className="text-emerald-400">→</span> {subNewSpent}　｜　{mastery.tier} <span className="text-emerald-400">→</span> {subNewTier}
                      {subNewTier !== mastery.tier && <span className="ml-2 text-emerald-300">⬆升档（名下配方将于正文演化质变）</span>}
                    </div>
                    {sp < points && <div className="text-[11px] text-blood/80 text-center">技能点不足（需 {points}，有 {sp}）。</div>}
                    <button onClick={settleSubprof} disabled={!canSettleSub} className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-colors ${canSettleSub ? 'bg-emerald-500/20 border border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/30' : 'bg-panel2/30 border border-edge text-dim/40 cursor-not-allowed'}`}>
                      ⚡ 结算·提升熟练度
                    </button>
                  </>
                )}
                {done && done.name === subName && (
                  <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-3 space-y-1">
                    <div className="text-[12px] text-emerald-300 font-semibold">✓ 「{done.name}」{done.effect}</div>
                    <div className="text-[10px] text-dim/50">已扣除技能点；升档后名下配方会在下一次正文演化时质变。正文将收到一条"点数已用掉"的提示。</div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
