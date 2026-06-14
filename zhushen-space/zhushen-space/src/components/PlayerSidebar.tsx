import { useState, useRef } from 'react';
import { usePlayer, type PlayerAttrs } from '../store/playerStore';
import { useGame } from '../store/gameStore';
import { useItems } from '../store/itemStore';
import { StatusChips, SegmentedText } from './NpcDetail';
import StatusEffectChips from './StatusEffectChips';
import { computeDerived, realmFromLevel, trueAttr, computeMaxHp, computeMaxEp, gearMaxHpBonus, gearMaxEpBonus, effectiveResource } from '../systems/derivedStats';
import { useCharacters } from '../store/characterStore';
import { computeAttrBreakdown, ATTR_LABEL, type AttrBreak } from '../systems/attrBonus';
import { useImageGen } from '../store/imageGenStore';
import { generateImage, buildPortraitPrompt, shrinkDataUrl } from '../systems/imageGen';
import { useImageViewer } from '../store/imageViewerStore';
import { genPortraitTags } from '../systems/imageTags';
import Bar from './Bar';

function DerivedRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-dim/60 font-mono">{label}</span>
      <span className="font-mono text-amber-300/90">{value}</span>
    </div>
  );
}

/* ── 可编辑文本（点击切换为输入框）；segmented=true 时显示态按分隔符分行排版 ── */
function EditText({
  value, onSave, placeholder, className = '', multiline = false, segmented = false,
}: {
  value: string; onSave: (v: string) => void; placeholder?: string; className?: string; multiline?: boolean; segmented?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);
  if (!editing && segmented && value) {
    return (
      <div onClick={() => { setLocal(value); setEditing(true); }} className="cursor-text hover:opacity-90 transition-opacity" title="点击编辑">
        <SegmentedText text={value} />
      </div>
    );
  }
  if (editing) {
    const commit = () => { onSave(local.trim()); setEditing(false); };
    return multiline ? (
      <textarea
        autoFocus value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        rows={3}
        className="w-full bg-void border border-god/40 rounded px-1.5 py-1 text-[13px] text-slate-200 outline-none leading-relaxed resize-y"
      />
    ) : (
      <input
        autoFocus value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="w-full bg-void border border-god/40 rounded px-1.5 py-0.5 text-[13px] text-slate-200 outline-none"
      />
    );
  }
  return (
    <button
      onClick={() => { setLocal(value); setEditing(true); }}
      className={`text-left hover:text-god transition-colors ${value ? 'text-slate-300' : 'text-dim/40'} ${className}`}
    >
      {value || placeholder || '—'}
    </button>
  );
}

/* ── 可编辑数字 ── */
function EditNum({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(String(value));
  if (editing) {
    const commit = () => { onSave(Math.max(0, Math.round(Number(local) || 0))); setEditing(false); };
    return (
      <input
        autoFocus type="number" value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="w-12 bg-void border border-god/40 rounded px-1 py-0.5 text-xs font-mono text-god outline-none text-right"
      />
    );
  }
  return (
    <button onClick={() => { setLocal(String(value)); setEditing(true); }} className="font-mono font-bold text-slate-100 hover:text-god transition-colors">
      {value}
    </button>
  );
}

/* ── 一行：标签 + 可编辑值 ── */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span className="w-20 shrink-0 text-dim/60 font-mono">{label}</span>
      <span className="flex-1 min-w-0 truncate">{children}</span>
    </div>
  );
}

/* 主角立绘：图像框 + AI生成/上传/移除（dataURL 存 profile.avatar）*/
function PlayerAvatar() {
  const profile = usePlayer((s) => s.profile);
  const setProfile = usePlayer((s) => s.setProfile);
  const portraitService = useImageGen((s) => s.portraitService);
  const portraitNegative = useImageGen((s) => s.portraitNegative);
  const fileRef = useRef<HTMLInputElement>(null);
  const [gening, setGening] = useState(false);
  const [err, setErr] = useState('');
  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { alert('图片请小于 3MB'); return; }
    const reader = new FileReader();
    reader.onload = async () => setProfile({ avatar: await shrinkDataUrl(String(reader.result)) });
    reader.readAsDataURL(file);
  }
  async function handleGen() {
    setGening(true); setErr('');
    try {
      // 无英文生图标签(列19)时，先用 LLM 把中文外观翻成英文 danbooru tags（NAI 必须英文才像）
      let tags = profile.imageTags;
      if (!tags || !tags.trim()) {
        const desc = [profile.baseAppearance, profile.appearance, profile.profession, realmFromLevel(profile.level), profile.background].filter(Boolean).join('，');
        const gen = await genPortraitTags(desc);
        if (gen) { tags = gen; setProfile({ imageTags: gen }); }
      }
      const prompt = buildPortraitPrompt({ appearance: profile.appearance, baseAppearance: profile.baseAppearance, profession: profile.profession, tier: realmFromLevel(profile.level), imageTags: tags });
      const url = await generateImage(portraitService, { prompt, negative: portraitNegative, label: '生成主角立绘' });
      setProfile({ avatar: await shrinkDataUrl(url), avatarTags: tags || '' });
    } catch (e: any) { setErr(e.message ?? '生成失败'); }
    finally { setGening(false); }
  }
  return (
    <div className="w-full flex flex-col items-center gap-1.5">
      <button onClick={() => profile.avatar ? useImageViewer.getState().open(profile.avatar, '主角立绘') : fileRef.current?.click()}
        title={profile.avatar ? '点击查看大图' : '点击上传立绘'}
        className={`w-32 h-32 rounded-xl overflow-hidden border border-edge/60 bg-void/60 flex items-center justify-center hover:border-god/40 transition-colors ${profile.avatar ? 'cursor-zoom-in' : ''}`}>
        {gening ? <span className="text-[11px] font-mono text-god/70 animate-pulse">生成中…</span>
          : profile.avatar ? <img src={profile.avatar} alt="立绘" className="w-full h-full object-cover" />
          : <span className="text-5xl text-dim/25">👤</span>}
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
      <div className="flex gap-1.5">
        <button onClick={handleGen} disabled={gening}
          className="text-[11px] font-mono px-2 py-0.5 rounded border border-god/40 text-god hover:bg-god/10 disabled:opacity-40 transition-colors">✨ 生成</button>
        <button onClick={() => fileRef.current?.click()}
          className="text-[11px] font-mono px-2 py-0.5 rounded border border-edge text-dim hover:text-god transition-colors">上传</button>
        {profile.avatar && <button onClick={() => setProfile({ avatar: '' })} className="text-[11px] font-mono px-2 py-0.5 rounded border border-edge text-dim/50 hover:text-blood transition-colors">移除</button>}
      </div>
      {err && <div className="text-[10px] text-blood font-mono max-w-[220px] leading-snug whitespace-pre-line text-center">{err}</div>}
    </div>
  );
}

const ATTR_DEFS: { key: keyof PlayerAttrs; label: string }[] = [
  { key: 'str', label: '力量' },
  { key: 'agi', label: '敏捷' },
  { key: 'con', label: '体质' },
  { key: 'int', label: '智力' },
  { key: 'cha', label: '魅力' },
  { key: 'luck', label: '幸运' },
];

export default function PlayerSidebar({ onClose }: { onClose?: () => void }) {
  const profile = usePlayer((s) => s.profile);
  const setProfile = usePlayer((s) => s.setProfile);
  const setAttr = usePlayer((s) => s.setAttr);
  const removeStatusEffect = usePlayer((s) => s.removeStatusEffect);
  const p = useGame((s) => s.player);
  const items = useItems((s) => s.items);
  const [editStatus, setEditStatus] = useState(false);
  const [showTrueAttr, setShowTrueAttr] = useState(false);   // 基础属性 ↔ 真实属性 切换
  const b1 = useCharacters((s) => s.characters['B1']);
  const equippedFull = items.filter((it) => it.equipped);
  const equipped = equippedFull.map((it) => ({ category: it.category as string, grade: (it.numeric?.grade as number) ?? 1 }));
  // 属性构成：原始 + 装备/技能/天赋 的属性加成（真实加载，不只是摆设）
  const breakdown = computeAttrBreakdown(profile.attrs, b1?.skills ?? [], b1?.traits ?? [], equippedFull);
  const effAttrs = { str: breakdown.str.total, agi: breakdown.agi.total, con: breakdown.con.total, int: breakdown.int.total, cha: breakdown.cha.total, luck: breakdown.luck.total } as PlayerAttrs;
  const derived = computeDerived(effAttrs, profile.level, equipped);   // 衍生属性按"有效六维"计算
  const derivedNoEq = computeDerived(effAttrs, profile.level, []);     // 仅六维+等级部分（用于拆出装备贡献）
  const [attrPop, setAttrPop] = useState<keyof PlayerAttrs | null>(null);   // 点击查看属性构成
  const [derivedPop, setDerivedPop] = useState<keyof typeof derived | null>(null);

  return (
    <>
      {/* 头部：立绘单独一行（放大居中）→ 姓名 / 等级 · 阶位 · 职业 */}
      <div className="relative p-3 border-b border-edge shrink-0 flex flex-col items-center gap-2">
        {onClose && (
          <button onClick={onClose} className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center text-dim hover:text-god text-xs">✕</button>
        )}
        {/* 立绘：单独占一行、放大 */}
        <PlayerAvatar />
        {/* 姓名 / 等级 */}
        <div className="w-full text-center">
          <EditText
            value={profile.name}
            onSave={(v) => setProfile({ name: v })}
            placeholder="主角姓名"
            className="text-xl font-bold !text-slate-100 hover:!text-god truncate w-full !text-center"
          />
          <div className="flex items-center justify-center flex-wrap gap-1 text-sm text-dim font-mono mt-0.5">
            <span>LV.</span>
            <EditNum value={profile.level} onSave={(v) => setProfile({ level: v })} />
            <span className="text-edge">·</span>
            {/* 阶位由等级自动推导（只会是 一阶~无上之境），不单独编辑 */}
            <span className="text-god" title="阶位由等级自动对应">{realmFromLevel(profile.level)}</span>
            {profile.profession && <span className="text-edge">·</span>}
            <EditText value={profile.profession} onSave={(v) => setProfile({ profession: v })} placeholder="职业" />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 身份信息 */}
        <div className="p-3 border-b border-edge space-y-1.5">
          <div className="text-sm text-god font-mono mb-1.5">❖ 身份</div>
          <Row label="所属乐园"><EditText value={profile.homeParadise} onSave={(v) => setProfile({ homeParadise: v })} placeholder="（开局选定）" /></Row>
          <Row label="主角背景"><EditText value={profile.preParadiseJob} onSave={(v) => setProfile({ preParadiseJob: v })} placeholder="（入园前职业）" /></Row>
          <Row label="称号"><EditText value={profile.title} onSave={(v) => setProfile({ title: v })} placeholder="（无）" /></Row>
          <Row label="身份"><EditText value={profile.identity} onSave={(v) => setProfile({ identity: v })} placeholder="（无）" /></Row>
          <Row label="职业"><EditText value={profile.profession} onSave={(v) => setProfile({ profession: v })} placeholder="（无）" /></Row>
          <Row label="竞技场排名"><EditText value={profile.arenaRank} onSave={(v) => setProfile({ arenaRank: v })} placeholder="（未上榜）" /></Row>
          <Row label="烙印等级"><EditText value={profile.brandLevel} onSave={(v) => setProfile({ brandLevel: v })} placeholder="（无）" /></Row>
          <Row label="契约者ID"><EditText value={profile.contractorId} onSave={(v) => setProfile({ contractorId: v })} placeholder="（未分配）" /></Row>
          <Row label="生物强度"><EditText value={profile.bioStrength} onSave={(v) => setProfile({ bioStrength: v })} placeholder="（如 T3·勇士）" /></Row>
          <Row label="进阶点数"><EditNum value={profile.advancePoints ?? 0} onSave={(v) => setProfile({ advancePoints: v })} /></Row>
          <Row label="世界之源"><EditNum value={Math.round((profile.worldSource ?? 0) * 10) / 10} onSave={(v) => setProfile({ worldSource: Math.round(v * 10) / 10 })} /></Row>
        </div>

        {/* 基础属性 / 真实属性（切换；真实=普通÷80 向下取整，>80 才产生） */}
        <div className="p-3 border-b border-edge">
          <div className="text-sm text-god font-mono mb-2 flex items-center justify-between">
            <span>⚔ {showTrueAttr ? '真实属性' : '基础属性'}</span>
            <button
              onClick={() => setShowTrueAttr((v) => !v)}
              title="真实属性 = 每80点普通属性折算1点"
              className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/60 hover:border-god/40 hover:text-god transition-colors"
            >{showTrueAttr ? '基础属性' : '真实属性'}</button>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {ATTR_DEFS.map(({ key, label }) => {
              const bk = breakdown[key];
              const bonus = bk.total - bk.base;
              return (
                <div key={key} className="flex items-center justify-between text-[13px]">
                  <span className="text-dim/60 font-mono">{showTrueAttr ? `真实${label}` : label}</span>
                  {showTrueAttr
                    ? <span className="font-mono font-bold text-amber-300/90">{trueAttr(bk.total)}</span>
                    : (
                      <button onClick={() => setAttrPop(attrPop === key ? null : key)} title="点击查看属性构成"
                        className="font-mono font-bold text-slate-100 hover:text-god transition-colors">
                        {bk.total}{bonus !== 0 && <span className={`ml-0.5 text-[11px] ${bonus > 0 ? 'text-emerald-400/70' : 'text-blood/70'}`}>({bonus > 0 ? '+' : ''}{bonus})</span>}
                      </button>
                    )}
                </div>
              );
            })}
          </div>
          {/* 属性构成弹层：原始(可编辑) + 装备/技能/天赋加成 */}
          {attrPop && !showTrueAttr && (() => {
            const bk: AttrBreak = breakdown[attrPop];
            return (
              <div className="mt-2 rounded-lg border border-god/30 bg-void/50 px-3 py-2 text-[12px] font-mono space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-god/80">{ATTR_LABEL[attrPop]} · 构成</span>
                  <button onClick={() => setAttrPop(null)} className="text-dim/40 hover:text-blood">✕</button>
                </div>
                <div className="flex items-center justify-between"><span className="text-dim/60">原始（点数字可改）</span><EditNum value={bk.base} onSave={(v) => setAttr(attrPop, v)} /></div>
                {bk.equip !== 0 && <div className="flex justify-between"><span className="text-dim/60">装备加成</span><span className="text-amber-300/80">{bk.equip > 0 ? '+' : ''}{bk.equip}</span></div>}
                {bk.skill !== 0 && <div className="flex justify-between"><span className="text-dim/60">技能加成</span><span className="text-sky-300/80">{bk.skill > 0 ? '+' : ''}{bk.skill}</span></div>}
                {bk.talent !== 0 && <div className="flex justify-between"><span className="text-dim/60">天赋加成</span><span className="text-fuchsia-300/80">{bk.talent > 0 ? '+' : ''}{bk.talent}</span></div>}
                <div className="flex justify-between border-t border-edge/40 pt-1"><span className="text-slate-300">合计</span><span className="text-slate-100 font-bold">{bk.total}</span></div>
                {bk.equip === 0 && bk.skill === 0 && bk.talent === 0 && <div className="text-dim/40 text-[11px]">暂无装备/技能/天赋加成</div>}
              </div>
            );
          })()}
        </div>

        {/* 衍生属性（六维+等级+装备换算，随属性/装备变化） */}
        <div className="p-3 border-b border-edge">
          <div className="text-sm text-god font-mono mb-2">⚔ 衍生属性 <span className="text-[11px] text-dim/40">六维+装备换算</span></div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {([['patk', '物理攻击'], ['pdef', '物理防御'], ['matk', '法术攻击'], ['mdef', '法术防御']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setDerivedPop(derivedPop === k ? null : k)} title="点击查看构成"
                className="flex items-center justify-between text-[13px] hover:text-god transition-colors">
                <span className="text-dim/60 font-mono">{label}</span>
                <span className="font-mono text-amber-300/90">{derived[k]}</span>
              </button>
            ))}
          </div>
          {derivedPop && (() => {
            const k = derivedPop; const total = derived[k]; const eq = total - derivedNoEq[k];
            const label = { patk: '物理攻击', pdef: '物理防御', matk: '法术攻击', mdef: '法术防御' }[k];
            return (
              <div className="mt-2 rounded-lg border border-god/30 bg-void/50 px-3 py-2 text-[12px] font-mono space-y-1">
                <div className="flex items-center justify-between"><span className="text-god/80">{label} · 构成</span><button onClick={() => setDerivedPop(null)} className="text-dim/40 hover:text-blood">✕</button></div>
                <div className="flex justify-between"><span className="text-dim/60">有效六维 + 等级</span><span className="text-slate-200">{derivedNoEq[k]}</span></div>
                {eq !== 0 && <div className="flex justify-between"><span className="text-dim/60">装备加成</span><span className="text-amber-300/80">{eq > 0 ? '+' : ''}{eq}</span></div>}
                <div className="flex justify-between border-t border-edge/40 pt-1"><span className="text-slate-300">合计</span><span className="text-slate-100 font-bold">{total}</span></div>
                <div className="text-dim/40 text-[11px]">六维已含装备/技能/天赋加成（见上方属性构成）</div>
              </div>
            );
          })()}
        </div>

        {/* 当前状态/Buff（受伤/疲惫/增益等，主角演化维护，可手动编辑；分段显示） */}
        <div className="p-3 border-b border-edge">
          <div className="text-sm text-god font-mono mb-1.5 flex items-center justify-between">
            <span>❖ 当前状态</span>
            <button onClick={() => setEditStatus((v) => !v)} className="text-[11px] text-dim/40 hover:text-god transition-colors">
              {editStatus ? '完成' : '✎ 编辑'}
            </button>
          </div>
          {editStatus ? (
            <textarea
              autoFocus defaultValue={profile.status} rows={3}
              onBlur={(e) => { setProfile({ status: e.target.value.trim() }); setEditStatus(false); }}
              placeholder="自由备注状态（可选）。结构化状态由 AI 走 addStatus 生成，点击胶囊看详情。"
              className="w-full bg-void border border-god/40 rounded px-1.5 py-1 text-[13px] text-slate-200 outline-none leading-relaxed resize-y"
            />
          ) : (
            <>
              {/* 结构化状态（固定格式，点击胶囊查看详情；引擎按时效自动过期）*/}
              {(profile.statusEffects?.length ?? 0) > 0
                ? <StatusEffectChips effects={profile.statusEffects} onRemove={(name) => removeStatusEffect(name)} />
                : (!profile.status || profile.status === '一切正常') && <div className="text-[13px] text-emerald-300/70">一切正常</div>}
              {/* 自由文本状态（兼容旧写法）；排除与限时状态重名的，避免上下重复显示 */}
              {profile.status && profile.status !== '一切正常' && (
                <div className="mt-2"><StatusChips status={profile.status} exclude={(profile.statusEffects ?? []).map((e) => e.name)} /></div>
              )}
            </>
          )}
        </div>

        {/* 基底外观（开局设定·不可变·生图基准）*/}
        {profile.baseAppearance && (
          <div className="p-3 border-b border-edge">
            <div className="text-sm text-dim font-mono mb-1.5">基底外观 <span className="text-[11px] text-dim/40">开局设定·不可变·生图基准</span></div>
            <div className="text-[13px] leading-relaxed text-slate-300/90 whitespace-pre-wrap">{profile.baseAppearance}</div>
          </div>
        )}

        {/* 外观描写 */}
        <div className="p-3 border-b border-edge">
          <div className="text-sm text-dim font-mono mb-1.5">外观描写 <span className="text-[11px] text-dim/40">随剧情演化</span></div>
          <EditText
            value={profile.appearance}
            onSave={(v) => setProfile({ appearance: v })}
            placeholder="点击填写外观…"
            multiline
            segmented
            className="text-[13px] leading-relaxed block w-full"
          />
        </div>

        {/* 所处位置 */}
        <div className="p-3">
          <div className="text-sm text-dim font-mono mb-1.5">所处位置</div>
          <EditText
            value={profile.location}
            onSave={(v) => setProfile({ location: v })}
            placeholder="点击填写位置…"
            className="text-[13px] block w-full"
          />
        </div>

      </div>

      {/* 底部：生命值 HP / 蓝量 EP（上限由体质×20 / 智力×15 自动换算）*/}
      <div className="shrink-0 border-t border-edge p-3 space-y-2">
        {(() => {
          // 最大HP/EP = 基础六维换算 + 装备里明确写"增加HP/EP上限"的效果；技能/天赋的属性加成不计入上限，避免乱跳
          const maxHp = computeMaxHp(profile.attrs) + gearMaxHpBonus(equippedFull);
          const maxEp = computeMaxEp(profile.attrs) + gearMaxEpBonus(equippedFull);
          return (
            <>
              <Bar value={effectiveResource(p.hp, p.maxHp, maxHp)} max={maxHp} color="bg-blood" label="生命 HP" />
              <Bar value={effectiveResource(p.mp, p.maxMp, maxEp)} max={maxEp} color="bg-sky-500" label="蓝量 EP" />
              <div className="text-[10px] text-dim/35 font-mono text-center">HP=体质×20 · EP=智力×15（按属性自动换算）</div>
            </>
          );
        })()}
      </div>
    </>
  );
}
