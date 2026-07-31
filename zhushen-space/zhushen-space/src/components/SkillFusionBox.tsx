import { useState } from 'react';
import { useCharacters, type Skill, type Trait } from '../store/characterStore';
import {
  generateSkillFusion, setSkillUpNote,
  type FuseSource, type FuseKind, type FusionOwner, type SkillFusionResult,
} from '../systems/skillUpgrade';
import { normalizeSkillLevel } from '../systems/skillLevelNorm';

/* 技能 / 天赋 融合（技能熔炉）·UI 单一实现
   选 2+ 个已有技能/天赋 → AI 熔铸成 1 个全新条目（产物类型前端随机）→ 可撤回 / 重新合成。
   **主角面板（SkillUpgradePanel 的融合页）与 NPC 详情（技能/天赋栏）共用本组件**，
   差异全部收在 props.owner 里：写入哪个 charId、提示词锚定谁的阶位、正文提示写谁的名字。
   引擎侧见 systems/skillUpgrade.ts 的 generateSkillFusion（owner 不传=主角）。 */

const FUSE_MAX = 4;   // 融合一次最多投入的技能/天赋数（≥2 起）

/** 一次融合的快照：供「撤回」还原来源 / 「重新合成」重掷。 */
type FuseSnapshot = {
  sources: FuseSource[];                                   // 被消耗的原始来源（完整对象·含 addedAt）
  customInput: string;                                     // 当时的自定义倾向
  result: { kind: FuseKind; id?: string; name: string };    // 当前产物身份（技能用 id、天赋用 name 定位）
};

export default function SkillFusionBox({ owner, skills, traits }: {
  owner: FusionOwner;      // 熔铸对象（id='B1' 即主角；NPC/宠物/召唤物传自己的档案）
  skills: Skill[];
  traits: Trait[];
}) {
  const addSkill = useCharacters((s) => s.addSkill);
  const removeSkill = useCharacters((s) => s.removeSkill);
  const addTrait = useCharacters((s) => s.addTrait);
  const removeTrait = useCharacters((s) => s.removeTrait);

  const [fuseSel, setFuseSel] = useState<string[]>([]);   // 选中键：`skill:<id>` / `talent:<name>`
  const [fuseCustom, setFuseCustom] = useState('');
  const [fuseBusy, setFuseBusy] = useState(false);
  const [fuseErr, setFuseErr] = useState('');
  const [fuseDone, setFuseDone] = useState<null | { kind: FuseKind; name: string; rarity?: string; level?: string; effect?: string }>(null);
  const [lastFuse, setLastFuse] = useState<FuseSnapshot | null>(null);   // 最近一次融合（可撤回/重铸）

  const charId = owner.id;
  const who = owner.name || (charId === 'B1' ? '主角' : charId);

  // 老存档里 level 可能混着品级（"传说·Lv.1"，AI 写的）→ 直接渲染 `{rarity}·{level}` 会出现两次品级。
  const skillTag = (s: Skill): string => {
    const n = normalizeSkillLevel(s.level, s.rarity);
    return [n.rarity, n.level].filter(Boolean).join('·');
  };
  const chipCls = (on: boolean) => `px-2.5 py-1 rounded-lg border text-[12px] transition-colors ${on ? 'border-god/70 bg-god/15 text-slate-100' : 'border-edge text-slate-300 hover:border-god/40'}`;

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
    if (res.outKind === 'skill') { newId = `S_${charId}_f${Date.now().toString(36)}`; addSkill(charId, { ...(apply as any), id: newId }); }
    else addTrait(charId, apply as any);
    const names = srcs.map((s) => (s.entry as any).name as string);
    const kindLabel = res.outKind === 'skill' ? '技能' : '天赋';
    const subject = charId === 'B1' ? '主角' : `${who}（${owner.tag || 'NPC'}·${charId}）`;
    setSkillUpNote(`（系统·面板已结算：${subject}将 ${srcs.length} 个技能/天赋「${names.join('」「')}」投入技能熔炉，熔铸出全新${kindLabel}「${apply.name}」（${apply.rarity ?? ''}）。此为面板结算结果，正文知晓即可、无需就此展开情节。）`);
    setLastFuse({ sources: srcs, customInput, result: { kind: res.outKind, id: newId, name: apply.name } });
    setFuseDone({ kind: res.outKind, name: apply.name, rarity: apply.rarity, level: apply.level, effect: apply.effect });
  }
  // 移除一个熔铸产物（技能优先按 id，天赋按 name）
  function removeFused(result: { kind: FuseKind; id?: string; name: string }) {
    if (result.kind === 'skill') removeSkill(charId, result.id ?? result.name);
    else removeTrait(charId, result.name);
  }

  async function doFuse() {
    const sources = resolveFuseSources();
    if (fuseBusy || sources.length < 2) return;
    const names = sources.map((s) => (s.entry as any).name as string);
    if (!window.confirm(`将 ${who} 的 ${sources.length} 个技能/天赋「${names.join('」「')}」投入熔炉融合成一个全新条目？\n\n· 会调用 AI（计费）\n· 产物是技能还是天赋 **随机**\n· 会 **消耗掉** 这 ${sources.length} 个来源（可在结果处「撤回」还原）`)) return;
    setFuseBusy(true); setFuseErr(''); setFuseDone(null); setLastFuse(null);
    try {
      const res = await generateSkillFusion({ sources, outKind: rollOutKind(sources), customInput: fuseCustom, owner });
      // 生成成功后再消耗来源（失败则来源不丢），先消耗再写入（防新条目与某来源同名被连带删除）
      sources.forEach((s) => { if (s.kind === 'skill') removeSkill(charId, (s.entry as Skill).id); else removeTrait(charId, (s.entry as Trait).name); });
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
      const res = await generateSkillFusion({ sources: snap.sources, outKind: rollOutKind(snap.sources), customInput: snap.customInput, owner });
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
      if (s.kind === 'skill') { const { addedAt: _a, ...rest } = s.entry as Skill; addSkill(charId, rest); }
      else { const { addedAt: _a, ...rest } = s.entry as Trait; addTrait(charId, rest); }
    });
    setSkillUpNote('');   // 融合已撤回，别把"已用掉"提示漏给正文
    setFuseSel(snap.sources.map((s) => s.kind === 'skill' ? `skill:${(s.entry as Skill).id}` : `talent:${(s.entry as Trait).name}`));
    setFuseCustom(snap.customInput);
    setFuseDone(null); setFuseErr(''); setLastFuse(null);
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-dim/50 leading-relaxed">
        选 <b className="text-god">2 个及以上</b>{charId === 'B1' ? '' : `${who} 的`}技能 / 天赋投入熔炉，AI 会把它们熔铸成<b className="text-god">一个全新条目</b>（基于所有来源与你的倾向）——<b className="text-amber-300">产物是技能还是天赋则随机</b>。融合会<b className="text-blood/80">消耗</b>选中的来源（可撤回）。与装备强化共用 AI 接口。
        {charId !== 'B1' && <span className="text-teal-300/80">　产物强度锚定 {who} 自己的阶位/生物强度，不会越过其主人。</span>}
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
                      {idx >= 0 && <span className="text-amber-300 font-mono mr-1">{idx + 1}.</span>}{s.name}<span className="text-dim/40 ml-1">{skillTag(s)}</span>
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
              {/* ⚠ 别再加 line-clamp：这是玩家花了 AI 调用 + 吃掉若干技能/天赋换来的产物，
                  截断＝看不到自己得到了什么（多段效果的天赋常被切在第三段中间）。
                  外层弹窗本来就是 max-h-[90dvh] overflow-y-auto，长了会自己滚。 */}
              {fuseDone.effect && <div className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap">{fuseDone.effect}</div>}
              <div className="text-[10px] text-dim/50">新条目已加入{charId === 'B1' ? '' : ` ${who} 的`}「{fuseDone.kind === 'skill' ? '技能' : '天赋'}」列表。不满意可<b className="text-slate-300">撤回</b>（还原来源）或<b className="text-slate-300">重新合成</b>（换一个）。</div>
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
  );
}
