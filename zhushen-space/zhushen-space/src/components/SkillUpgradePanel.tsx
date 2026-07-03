import { useState, useMemo } from 'react';
import { useItems } from '../store/itemStore';
import { useCharacters, type Skill, type Trait, type SubProfession } from '../store/characterStore';
import {
  useSubProfTree, subProfMastery, SUBPROF_MASTERY_LADDER, SUBPROF_MASTERY_PER_SKILLPOINT,
} from '../store/subProfTreeStore';
import {
  generateSkillUpgrade, parseLevelNum, crossesWatershed, rarityIndex, bumpRarity,
  SKILL_RARITIES, TALENT_RARITIES, setSkillUpNote,
  levelUpCoinCost, rarityUpCoinCost, masteryCoinCost,
  generateSkillFusion, type FuseSource, type FuseKind, type SkillFusionResult,
} from '../systems/skillUpgrade';

/* 乐园设施·技能升级面板：
   - 技能/天赋：技能点升等级 / 黄金技能点升品级质变（调 AI 生成升级效果）。
   - 副职业/技艺：技能点提熟练度档位至宗师（纯机械·升档后配方由正文演化质变）。
   - 三类都可改用【乐园币】支付（见 skillUpgrade.ts 消耗表）。结算→写回→扣资源→给正文一条"已用掉"通知。 */

type Mode = 'normal' | 'golden';
type Pay = 'points' | 'coin';
type Sel = { kind: 'skill' | 'talent' | 'subprof'; key: string } | null;

const fmt = (n: number) => n.toLocaleString('en-US');
const FUSE_MAX = 4;   // 融合一次最多投入的技能/天赋数（≥2 起）

/** 一次融合的快照：供「撤回」还原来源 / 「重新合成」重掷。 */
type FuseSnapshot = {
  sources: FuseSource[];                                    // 被消耗的原始来源（完整对象·含 addedAt）
  customInput: string;                                      // 当时的自定义倾向
  result: { kind: FuseKind; id?: string; name: string };   // 当前产物身份（技能用 id、天赋用 name 定位）
};

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
  const addSkill = useCharacters((s) => s.addSkill);
  const removeSkill = useCharacters((s) => s.removeSkill);
  const addTrait = useCharacters((s) => s.addTrait);
  const removeTrait = useCharacters((s) => s.removeTrait);
  const addSubProfMastery = useSubProfTree((s) => s.addSubProfMastery);
  const subProgress = useSubProfTree((s) => s.progress);

  const b1 = chars['B1'];
  const skills: Skill[] = b1?.skills ?? [];
  const traits: Trait[] = b1?.traits ?? [];
  const subprofs: SubProfession[] = b1?.subProfessions ?? [];

  const [sel, setSel] = useState<Sel>(null);
  const [mode, setMode] = useState<Mode>('normal');
  const [pay, setPay] = useState<Pay>('points');
  const [points, setPoints] = useState(1);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<null | { name: string; level?: string; rarity?: string; effect?: string }>(null);

  // ── 技能/天赋融合（技能熔炉）──
  const [tab, setTab] = useState<'upgrade' | 'fuse'>('upgrade');
  const [fuseSel, setFuseSel] = useState<string[]>([]);   // 选中键：`skill:<id>` / `talent:<name>`
  const [fuseCustom, setFuseCustom] = useState('');
  const [fuseBusy, setFuseBusy] = useState(false);
  const [fuseErr, setFuseErr] = useState('');
  const [fuseDone, setFuseDone] = useState<null | { kind: FuseKind; name: string; rarity?: string; level?: string; effect?: string }>(null);
  const [lastFuse, setLastFuse] = useState<FuseSnapshot | null>(null);   // 最近一次融合（可撤回/重铸）

  const sp = currency['技能点'] ?? 0;
  const gp = currency['黄金技能点'] ?? 0;
  const coin = currency['乐园币'] ?? 0;

  const isTalent = sel?.kind === 'talent';
  const isSubprof = sel?.kind === 'subprof';

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
  const showCustom = (mode === 'normal' && crossed) || mode === 'golden';
  const goldenMaxed = mode === 'golden' && maxRaritySteps <= 0;
  // 价格 / 余额
  const coinCost = mode === 'normal' ? levelUpCoinCost((entry as any)?.rarity, oldLv, points) : rarityUpCoinCost(curIdx, points);
  const ptName = mode === 'normal' ? '技能点' : '黄金技能点';
  const ptAvail = mode === 'normal' ? sp : gp;
  const stMax = pay === 'coin'
    ? (mode === 'golden' ? Math.max(1, maxRaritySteps) : 30)
    : (mode === 'golden' ? Math.max(1, Math.min(gp, maxRaritySteps)) : Math.max(1, sp));
  const payOk = pay === 'coin' ? coin >= coinCost : ptAvail >= points;
  const canSettle = !!entry && !busy && points >= 1 && payOk && (mode === 'golden' ? (maxRaritySteps >= 1 && points <= maxRaritySteps) : true);

  // ── 副职业熟练度预览 ──
  void subProgress;
  const subName = isSubprof ? sel!.key : null;
  const mastery = subName ? subProfMastery(subName) : null;
  const subGain = points * SUBPROF_MASTERY_PER_SKILLPOINT;
  const subNewSpent = (mastery?.spent ?? 0) + subGain;
  const subNewTier = tierForSpent(subNewSpent);
  const subMaxed = !!mastery && mastery.tier === '宗师';
  const coinCostSub = masteryCoinCost(mastery?.spent ?? 0, points);
  const subMax = pay === 'coin' ? 30 : Math.max(1, sp);
  const payOkSub = pay === 'coin' ? coin >= coinCostSub : sp >= points;
  const canSettleSub = !!subName && points >= 1 && payOkSub && !subMaxed;

  function pick(s: Sel) { setSel(s); setDone(null); setErr(''); setPoints(1); setCustom(''); setMode('normal'); setPay('points'); }
  function switchMode(m: Mode) { setMode(m); setPoints(1); setDone(null); setErr(''); setPay('points'); }
  function switchTab(t: 'upgrade' | 'fuse') { setTab(t); setErr(''); setDone(null); }   // 保留 fuse 结果/撤回态，切回来还能撤回/重铸

  // ── 融合：多选技能/天赋 → AI 熔铸成一个新条目（产物类型随机） ──
  const fuseCandidates = skills.length + traits.length;
  function toggleFuse(key: string) {
    if (fuseBusy) return;
    setFuseErr(''); setFuseDone(null);
    setFuseSel((cur) => cur.includes(key) ? cur.filter((k) => k !== key) : cur.length >= FUSE_MAX ? cur : [...cur, key]);
  }
  function resolveFuseSources(): FuseSource[] {
    return fuseSel.map((k) => {
      const sep = k.indexOf(':'); const kind = k.slice(0, sep); const id = k.slice(sep + 1);
      if (kind === 'skill') { const e = skills.find((x) => x.id === id); return e ? { kind: 'skill' as const, entry: e } : null; }
      const e = traits.find((x) => x.name === id); return e ? { kind: 'talent' as const, entry: e } : null;
    }).filter(Boolean) as FuseSource[];
  }

  // 产物类型随机：按来源里技能占比加权（钳制 [0.25,0.75]，纯同类型也保留惊喜）
  function rollOutKind(srcs: FuseSource[]): FuseKind {
    const pSkill = Math.min(0.75, Math.max(0.25, srcs.filter((s) => s.kind === 'skill').length / srcs.length));
    return Math.random() < pSkill ? 'skill' : 'talent';
  }
  // 写入熔铸产物 + 挂一次性正文提示 + 记录快照（供撤回/重铸）
  function writeFused(res: SkillFusionResult, srcs: FuseSource[], customInput: string) {
    const apply = res.apply;
    let newId: string | undefined;
    if (res.outKind === 'skill') { newId = `S_B1_f${Date.now().toString(36)}`; addSkill('B1', { ...(apply as any), id: newId }); }
    else addTrait('B1', apply as any);
    const names = srcs.map((s) => (s.entry as any).name as string);
    const kindLabel = res.outKind === 'skill' ? '技能' : '天赋';
    setSkillUpNote(`（系统·面板已结算：主角将 ${srcs.length} 个技能/天赋「${names.join('」「')}」投入技能熔炉，熔铸出全新${kindLabel}「${apply.name}」（${apply.rarity ?? ''}）。此为面板结算结果，正文知晓即可、无需就此展开情节。）`);
    setLastFuse({ sources: srcs, customInput, result: { kind: res.outKind, id: newId, name: apply.name } });
    setFuseDone({ kind: res.outKind, name: apply.name, rarity: apply.rarity, level: apply.level, effect: apply.effect });
  }
  // 移除一个熔铸产物（技能优先按 id，天赋按 name）
  function removeFused(result: { kind: FuseKind; id?: string; name: string }) {
    if (result.kind === 'skill') removeSkill('B1', result.id ?? result.name);
    else removeTrait('B1', result.name);
  }

  async function doFuse() {
    const sources = resolveFuseSources();
    if (fuseBusy || sources.length < 2) return;
    const names = sources.map((s) => (s.entry as any).name as string);
    if (!window.confirm(`将 ${sources.length} 个技能/天赋「${names.join('」「')}」投入熔炉融合成一个全新条目？\n\n· 会调用 AI（计费）\n· 产物是技能还是天赋 **随机**\n· 会 **消耗掉** 这 ${sources.length} 个来源（可在结果处「撤回」还原）`)) return;
    setFuseBusy(true); setFuseErr(''); setFuseDone(null); setLastFuse(null);
    try {
      const res = await generateSkillFusion({ sources, outKind: rollOutKind(sources), customInput: fuseCustom });
      // 生成成功后再消耗来源（失败则来源不丢），先消耗再写入（防新条目与某来源同名被连带删除）
      sources.forEach((s) => { if (s.kind === 'skill') removeSkill('B1', (s.entry as Skill).id); else removeTrait('B1', (s.entry as Trait).name); });
      writeFused(res, sources, fuseCustom);
      setFuseSel([]); setFuseCustom('');
    } catch (e: any) {
      setFuseErr(e?.message ?? '融合失败');
    } finally {
      setFuseBusy(false);
    }
  }

  // 重新合成：对结果不满意 → 保持已消耗的同一批来源，重掷类型 + 重新调 AI，替换掉当前产物
  async function doRefuse() {
    if (!lastFuse || fuseBusy) return;
    const snap = lastFuse;
    if (!window.confirm(`对当前融合产物「${snap.result.name}」不满意，重新合成一次？\n\n· 会再次调用 AI（计费）\n· 仍消耗原来那 ${snap.sources.length} 个来源、替换掉当前产物\n· 产物类型仍然 **随机**`)) return;
    setFuseBusy(true); setFuseErr('');
    try {
      const res = await generateSkillFusion({ sources: snap.sources, outKind: rollOutKind(snap.sources), customInput: snap.customInput });
      removeFused(snap.result);   // 生成成功后再移除旧产物（失败则旧产物保留、快照不变）
      writeFused(res, snap.sources, snap.customInput);
    } catch (e: any) {
      setFuseErr(e?.message ?? '重新合成失败');
    } finally {
      setFuseBusy(false);
    }
  }

  // 撤回：移除熔铸产物 + 还原被消耗的来源 + 清掉尚未注入正文的"已用掉"提示
  function doUndoFuse() {
    if (!lastFuse || fuseBusy) return;
    const snap = lastFuse;
    removeFused(snap.result);
    snap.sources.forEach((s) => {
      if (s.kind === 'skill') { const { addedAt: _a, ...rest } = s.entry as Skill; addSkill('B1', rest); }
      else { const { addedAt: _a, ...rest } = s.entry as Trait; addTrait('B1', rest); }
    });
    setSkillUpNote('');   // 融合已撤回，别把"已用掉"提示漏给正文
    setFuseSel(snap.sources.map((s) => s.kind === 'skill' ? `skill:${(s.entry as Skill).id}` : `talent:${(s.entry as Trait).name}`));
    setFuseCustom(snap.customInput);
    setFuseDone(null); setFuseErr(''); setLastFuse(null);
  }

  async function settle() {
    if (!entry || !canSettle) return;
    setBusy(true); setErr(''); setDone(null);
    try {
      const res = await generateSkillUpgrade({ entry, isTalent, mode, points, newLevelNum: newLv, crossed, newRarity, customInput: custom });
      const { id: _id, addedAt: _a, ...patch } = res.apply as any;
      if (isTalent) updateTrait('B1', entry.name, patch);
      else updateSkill('B1', (entry as Skill).id, patch);
      const costText = pay === 'coin' ? `${fmt(coinCost)} 乐园币` : `${points} ${ptName}`;
      if (pay === 'coin') adjustCurrency('乐园币', -coinCost, `${isTalent ? '天赋' : '技能'}升级·${entry.name}`); else adjustCurrency(mode === 'normal' ? '技能点' : '黄金技能点', -points, `${isTalent ? '天赋' : '技能'}升级·${entry.name}`);
      const descChange = mode === 'normal' ? `Lv.${oldLv} → Lv.${newLv}` : `品级 ${(entry as any).rarity ?? ''} → ${newRarity}`;
      setSkillUpNote(`（系统·面板已结算：主角消耗 ${costText}，将${isTalent ? '天赋' : '技能'}「${entry.name}」升级（${descChange}）。此为面板结算结果，正文知晓即可、无需就此展开情节。）`);
      setDone({ name: entry.name, level: patch.level, rarity: patch.rarity, effect: patch.effect });
    } catch (e: any) {
      setErr(e?.message ?? '生成失败');
    } finally {
      setBusy(false);
    }
  }

  function settleSubprof() {
    if (!subName || !canSettleSub) return;
    const before = subProfMastery(subName);
    addSubProfMastery('B1', subName, subGain);
    const costText = pay === 'coin' ? `${fmt(coinCostSub)} 乐园币` : `${points} 技能点`;
    if (pay === 'coin') adjustCurrency('乐园币', -coinCostSub, `副职业进修·${subName}`); else adjustCurrency('技能点', -points, `副职业进修·${subName}`);
    const after = subProfMastery(subName);
    setSkillUpNote(`（系统·面板已结算：主角消耗 ${costText} 钻研副职业「${subName}」，熟练度提升（${before.tier} → ${after.tier}）。此为面板结算结果，正文知晓即可、无需就此展开情节。）`);
    setDone({ name: subName, rarity: after.tier, effect: `熟练度档位：${after.tier}${after.tier === '宗师' ? '（已登顶）' : ''}` });
    setPoints(1);
  }

  const empty = skills.length === 0 && traits.length === 0 && subprofs.length === 0;
  const chipCls = (on: boolean) => `px-2.5 py-1 rounded-lg border text-[12px] transition-colors ${on ? 'border-god/70 bg-god/15 text-slate-100' : 'border-edge text-slate-300 hover:border-god/40'}`;
  const payCls = (on: boolean) => `flex-1 px-2 py-1 rounded-lg border text-[11px] transition-colors ${on ? 'border-yellow-500/70 bg-yellow-500/15 text-yellow-100' : 'border-edge text-slate-300 hover:border-yellow-500/40'}`;

  // 复用的「支付方式」切换（ptLabel=点数那侧的名字）
  const PayToggle = ({ ptLabel }: { ptLabel: string }) => (
    <div className="flex gap-2">
      <button onClick={() => { setPay('points'); setPoints(1); }} className={payCls(pay === 'points')}>用{ptLabel}</button>
      <button onClick={() => { setPay('coin'); setPoints(1); }} className={payCls(pay === 'coin')}>用乐园币</button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[72] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-edge bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">🔼 技能升级</h2>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
        </div>
        <div className="flex items-center gap-2 text-[12px] flex-wrap">
          <span className="px-2.5 py-1 rounded-lg border border-sky-500/40 text-sky-300 bg-sky-500/10">技能点 <b className="text-sky-200">{sp}</b></span>
          <span className="px-2.5 py-1 rounded-lg border border-amber-500/40 text-amber-300 bg-amber-500/10">黄金技能点 <b className="text-amber-200">{gp}</b></span>
          <span className="px-2.5 py-1 rounded-lg border border-yellow-500/40 text-yellow-300 bg-yellow-500/10">乐园币 <b className="text-yellow-200">{fmt(coin)}</b></span>
        </div>
        {/* 顶部：升级 / 融合 切换 */}
        <div className="flex gap-2">
          <button onClick={() => switchTab('upgrade')} className={`flex-1 px-3 py-2 rounded-xl border text-[13px] font-semibold transition-colors ${tab === 'upgrade' ? 'border-god/70 bg-god/15 text-god' : 'border-edge text-slate-300 hover:border-god/40'}`}>🔼 升级</button>
          <button onClick={() => switchTab('fuse')} className={`flex-1 px-3 py-2 rounded-xl border text-[13px] font-semibold transition-colors ${tab === 'fuse' ? 'border-amber-500/70 bg-amber-500/15 text-amber-200' : 'border-edge text-slate-300 hover:border-amber-500/40'}`}>🔮 融合</button>
        </div>

        {tab === 'upgrade' && (
        <div className="text-[11px] text-dim/50 leading-relaxed">
          技能点升等级、黄金技能点升品级质变、技能点提副职业熟练度至宗师；三类都可改用<b className="text-yellow-300">乐园币</b>支付（越高级越贵）。与装备强化共用 AI 接口。
        </div>
        )}

        {tab === 'upgrade' && (empty ? (
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
                    普通升级<span className="block text-[10px] text-dim/50">升等级</span>
                  </button>
                  <button onClick={() => switchMode('golden')} className={`flex-1 px-3 py-2 rounded-xl border text-[12px] transition-colors ${mode === 'golden' ? 'border-amber-500/70 bg-amber-500/15 text-amber-100' : 'border-edge text-slate-300 hover:border-amber-500/40'}`}>
                    黄金质变<span className="block text-[10px] text-dim/50">升品级</span>
                  </button>
                </div>

                {goldenMaxed ? (
                  <div className="text-[12px] text-amber-300/80 text-center py-2">已是最高品级（{(entry as any).rarity}），无法再质变。</div>
                ) : (
                  <>
                    <PayToggle ptLabel={ptName} />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12px] text-dim/70">{mode === 'normal' ? `升 ${points} 级` : `升 ${points} 档品级`}</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setPoints((p) => Math.max(1, p - 1))} className="w-7 h-7 rounded-lg border border-edge text-slate-300 hover:border-god/50">−</button>
                        <span className="w-8 text-center text-slate-100 font-mono">{points}</span>
                        <button onClick={() => setPoints((p) => Math.min(stMax, p + 1))} className="w-7 h-7 rounded-lg border border-edge text-slate-300 hover:border-god/50">＋</button>
                      </div>
                    </div>
                    <div className="text-[12px] text-center text-slate-200 bg-panel2/40 rounded-lg py-1.5 border border-edge/60">
                      {mode === 'normal'
                        ? <>Lv.{oldLv} <span className="text-god">→</span> Lv.{newLv}{crossed && <span className="ml-2 text-amber-300">⚡跨分水岭·新增效果</span>}</>
                        : <>品级 {(entry as any).rarity ?? '—'} <span className="text-amber-400">→</span> {newRarity} <span className="ml-1 text-amber-300">·质变</span></>}
                    </div>
                    <div className="text-[12px] text-center">
                      {pay === 'coin'
                        ? <span className={coin >= coinCost ? 'text-yellow-300' : 'text-blood/80'}>花费 {fmt(coinCost)} 乐园币（余 {fmt(coin)}）</span>
                        : <span className={ptAvail >= points ? 'text-slate-300' : 'text-blood/80'}>需 {points} {ptName}（余 {ptAvail}）</span>}
                    </div>
                    {showCustom && (
                      <textarea value={custom} onChange={(e) => setCustom(e.target.value)} rows={2}
                        placeholder="描述你想要的新效果（可留空，留空 AI 会按技能主题自动设计）"
                        className="w-full rounded-xl border border-edge bg-panel2/40 px-3 py-2 text-[12px] text-slate-200 placeholder:text-dim/40 focus:border-god/50 outline-none resize-none" />
                    )}
                    <button onClick={settle} disabled={!canSettle} className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-colors ${canSettle ? 'bg-god/20 border border-god/60 text-god hover:bg-god/30' : 'bg-panel2/30 border border-edge text-dim/40 cursor-not-allowed'}`}>
                      {busy ? '⏳ 淬炼中…（调用 AI 生成升级效果）' : '⚡ 结算升级'}
                    </button>
                  </>
                )}
                {err && <div className="text-[11px] text-blood/90 bg-blood/10 border border-blood/30 rounded-lg p-2 leading-relaxed">{err}</div>}
                {done && done.name === entry.name && (
                  <div className="rounded-xl border border-god/50 bg-god/10 p-3 space-y-1">
                    <div className="text-[12px] text-god font-semibold">✓ 已升级「{done.name}」 {done.rarity ? `· ${done.rarity}` : ''} {done.level ?? ''}</div>
                    {done.effect && <div className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap line-clamp-6">{done.effect}</div>}
                    <div className="text-[10px] text-dim/50">已扣除资源；正文将收到一条"已用掉"提示。可在「技能」面板查看。</div>
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
                    <PayToggle ptLabel="技能点" />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12px] text-dim/70">+{subGain} 熟练度（{points}×{SUBPROF_MASTERY_PER_SKILLPOINT}）</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setPoints((p) => Math.max(1, p - 1))} className="w-7 h-7 rounded-lg border border-edge text-slate-300 hover:border-god/50">−</button>
                        <span className="w-8 text-center text-slate-100 font-mono">{points}</span>
                        <button onClick={() => setPoints((p) => Math.min(subMax, p + 1))} className="w-7 h-7 rounded-lg border border-edge text-slate-300 hover:border-god/50">＋</button>
                      </div>
                    </div>
                    <div className="text-[12px] text-center text-slate-200 bg-panel2/40 rounded-lg py-1.5 border border-edge/60">
                      熟练度 {mastery.spent} <span className="text-emerald-400">→</span> {subNewSpent}　｜　{mastery.tier} <span className="text-emerald-400">→</span> {subNewTier}
                      {subNewTier !== mastery.tier && <span className="ml-2 text-emerald-300">⬆升档</span>}
                    </div>
                    <div className="text-[12px] text-center">
                      {pay === 'coin'
                        ? <span className={coin >= coinCostSub ? 'text-yellow-300' : 'text-blood/80'}>花费 {fmt(coinCostSub)} 乐园币（余 {fmt(coin)}）</span>
                        : <span className={sp >= points ? 'text-slate-300' : 'text-blood/80'}>需 {points} 技能点（余 {sp}）</span>}
                    </div>
                    <button onClick={settleSubprof} disabled={!canSettleSub} className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-colors ${canSettleSub ? 'bg-emerald-500/20 border border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/30' : 'bg-panel2/30 border border-edge text-dim/40 cursor-not-allowed'}`}>
                      ⚡ 结算·提升熟练度
                    </button>
                  </>
                )}
                {done && done.name === subName && (
                  <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-3 space-y-1">
                    <div className="text-[12px] text-emerald-300 font-semibold">✓ 「{done.name}」{done.effect}</div>
                    <div className="text-[10px] text-dim/50">已扣除资源；升档后名下配方会在下一次正文演化时质变。正文将收到一条"已用掉"提示。</div>
                  </div>
                )}
              </div>
            )}
          </>
        ))}

        {/* ── 技能 / 天赋 融合（技能熔炉·产物类型随机） ── */}
        {tab === 'fuse' && (
          <div className="space-y-3">
            <div className="text-[11px] text-dim/50 leading-relaxed">
              选 <b className="text-god">2 个及以上</b>技能 / 天赋投入熔炉，AI 会把它们熔铸成<b className="text-god">一个全新条目</b>（基于所有来源与你的倾向）——<b className="text-amber-300">产物是技能还是天赋则随机</b>。融合会<b className="text-blood/80">消耗</b>选中的来源，不可撤销。与装备强化共用 AI 接口。
            </div>
            {fuseCandidates < 2 ? (
              <div className="text-center text-dim/50 py-8 text-sm">至少需要 2 个技能 / 天赋才能融合。</div>
            ) : (
              <>
                {skills.length > 0 && (
                  <div>
                    <div className="text-[11px] text-dim/50 mb-1">技能</div>
                    <div className="flex flex-wrap gap-1.5">
                      {skills.map((s) => {
                        const key = `skill:${s.id}`; const idx = fuseSel.indexOf(key);
                        return (
                          <button key={s.id} onClick={() => toggleFuse(key)} className={chipCls(idx >= 0)}>
                            {idx >= 0 && <span className="text-amber-300 font-mono mr-1">{idx + 1}.</span>}{s.name}<span className="text-dim/40 ml-1">{s.rarity ?? ''}·{s.level ?? ''}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {traits.length > 0 && (
                  <div>
                    <div className="text-[11px] text-dim/50 mb-1">天赋</div>
                    <div className="flex flex-wrap gap-1.5">
                      {traits.map((t) => {
                        const key = `talent:${t.name}`; const idx = fuseSel.indexOf(key);
                        return (
                          <button key={t.name} onClick={() => toggleFuse(key)} className={chipCls(idx >= 0)}>
                            {idx >= 0 && <span className="text-amber-300 font-mono mr-1">{idx + 1}.</span>}{t.name}<span className="text-dim/40 ml-1">{t.rarity ?? ''}级</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <textarea value={fuseCustom} onChange={(e) => setFuseCustom(e.target.value)} rows={2}
                  placeholder="融合倾向（想要的流派 / 效果 / 属性侧重 / 意象，可留空由 AI 自拟方向）"
                  className="w-full rounded-xl border border-edge bg-panel2/40 px-3 py-2 text-[12px] text-slate-200 placeholder:text-dim/40 focus:border-god/50 outline-none resize-none" />

                <div className="text-[12px] text-center text-slate-200 bg-panel2/40 rounded-lg py-1.5 border border-edge/60">
                  已选 <b className="text-god">{fuseSel.length}</b> / 上限 {FUSE_MAX}　<span className="text-god">→</span>　熔铸出 <b className="text-amber-300">1 个技能或天赋（随机）</b>
                </div>

                <button onClick={doFuse} disabled={fuseSel.length < 2 || fuseBusy}
                  className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-colors ${fuseSel.length >= 2 && !fuseBusy ? 'bg-amber-500/20 border border-amber-500/60 text-amber-200 hover:bg-amber-500/30' : 'bg-panel2/30 border border-edge text-dim/40 cursor-not-allowed'}`}>
                  {fuseBusy ? '⏳ 熔铸中…（调用 AI 生成融合产物）' : fuseSel.length >= 2 ? `🔮 融合（${fuseSel.length} 合 1）` : '🔮 融合（请选 2+）'}
                </button>

                {fuseErr && <div className="text-[11px] text-blood/90 bg-blood/10 border border-blood/30 rounded-lg p-2 leading-relaxed">{fuseErr}</div>}
                {fuseDone && (
                  <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 space-y-2">
                    <div className="text-[12px] text-amber-300 font-semibold">✓ 熔铸出{fuseDone.kind === 'skill' ? '技能' : '天赋'}「{fuseDone.name}」{fuseDone.rarity ? ` · ${fuseDone.rarity}${fuseDone.kind === 'talent' ? '级' : ''}` : ''}{fuseDone.level ? ` ${fuseDone.level}` : ''}</div>
                    {fuseDone.effect && <div className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap line-clamp-6">{fuseDone.effect}</div>}
                    <div className="text-[10px] text-dim/50">新条目已加入「{fuseDone.kind === 'skill' ? '技能' : '天赋'}」列表，可在「技能」面板查看。不满意可<b className="text-slate-300">撤回</b>（还原来源）或<b className="text-slate-300">重新合成</b>（换一个）。</div>
                    {lastFuse && (
                      <div className="flex gap-2 pt-0.5">
                        <button onClick={doUndoFuse} disabled={fuseBusy}
                          className="flex-1 py-2 rounded-lg border border-edge text-slate-300 text-[12px] font-medium hover:border-blood/50 hover:text-blood transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                          ↩ 撤回（还原来源）
                        </button>
                        <button onClick={doRefuse} disabled={fuseBusy}
                          className="flex-1 py-2 rounded-lg border border-amber-500/50 text-amber-200 text-[12px] font-medium hover:bg-amber-500/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                          {fuseBusy ? '⏳ 重铸中…' : '🔄 重新合成'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
