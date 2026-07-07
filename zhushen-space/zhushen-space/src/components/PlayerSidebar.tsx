import { useState, useRef, useEffect } from 'react';
import { usePlayer, type PlayerAttrs } from '../store/playerStore';
import { useGame } from '../store/gameStore';
import { useItems, gradeToNum } from '../store/itemStore';
import { StatusChips, SegmentedText } from './NpcDetail';
import StatusEffectChips from './StatusEffectChips';
import { computeDerived, tierFxClass, realmFromLevel, effectiveResource, fullMaxHp, fullMaxEp, realAttrMult, attrCapForTier, ratioOf, ATTR_SHORT, computeVitalBreakdown } from '../systems/derivedStats';
import { useResource } from '../store/resourceStore';
import { playerResourceMax, refillAllVitals } from '../systems/playerVitals';
import { useCharacters } from '../store/characterStore';
import { computeAttrBreakdown, withAttrDelta, ATTR_LABEL, ATTR_KEYS, type AttrBreak } from '../systems/attrBonus';
import { activeGemSets, gemSetEquipEntry } from '../systems/gemSets';
import { playerTreeAttrBonus } from '../store/skillTreeStore';
import { playerTeamAttrBonus, playerTeamPerkAbilities } from '../store/adventureTeamStore';
import { bioInnate, bioPower, bioStrengthLabel, nominalTierNum } from '../systems/bioStrength';
import { useImageGen } from '../store/imageGenStore';
import { generateImage, buildPortraitPrompt, equippedForPrompt, shrinkDataUrl } from '../systems/imageGen';
import { useImageViewer } from '../store/imageViewerStore';
import { PortraitPicker, PortraitLibraryModal } from './PortraitPicker';
import { genPortraitTags } from '../systems/imageTags';
import Bar, { BAR_STYLES } from './Bar';
import AttrTalentPicker from './AttrTalentPicker';
import { milestonesCrossed } from '../systems/attrTalent';
import { pushAllocNotice } from '../systems/allocNotice';


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
function Row({ label, children, wrap }: { label: string; children: React.ReactNode; wrap?: boolean }) {
  return (
    <div className={`flex gap-2 text-[13px] ${wrap ? 'items-start' : 'items-center'}`}>
      <span className="w-20 shrink-0 text-dim/60 font-mono">{label}</span>
      <span className={`flex-1 min-w-0 ${wrap ? 'break-words' : 'truncate'}`}>{children}</span>
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
  const [libOpen, setLibOpen] = useState(false);
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
      // 手动「生成」：每次按【当前外观】重新翻译生图标签(列19)，确保新图反映当下场景/外观。
      // 旧逻辑只在"无标签"时翻译 → 复用几回合前的旧标签 → 出旧场景图（用户反馈的根因），故改为每次重译；翻译失败再回退旧标签。
      const equip = equippedForPrompt(useItems.getState().items);   // 读装备栏真实穿戴，服装/武器不再靠外观描述
      const desc = [profile.gender, profile.race, profile.baseAppearance, profile.appearance, equip, profile.profession, realmFromLevel(profile.level), profile.background].filter(Boolean).join('，');
      const gen = await genPortraitTags(desc);
      const tags = gen || profile.imageTags;
      if (gen && gen !== profile.imageTags) setProfile({ imageTags: gen });
      const prompt = buildPortraitPrompt({ gender: profile.gender, race: profile.race, appearance: profile.appearance, baseAppearance: profile.baseAppearance, bodyType: profile.bodyType, equipment: equip, profession: profile.profession, tier: realmFromLevel(profile.level), imageTags: tags });
      const url = await generateImage(portraitService, { prompt, negative: portraitNegative, label: '生成主角立绘' });
      setProfile({ avatar: await shrinkDataUrl(url), avatarTags: tags || '' });
    } catch (e: any) { setErr(e.message ?? '生成失败'); }
    finally { setGening(false); }
  }
  return (
    <div className="w-full flex flex-col items-center gap-1.5">
      <button onClick={() => profile.avatar ? useImageViewer.getState().open(profile.avatar, '主角立绘') : setLibOpen(true)}
        title={profile.avatar ? '点击查看大图' : '点击从图库选立绘'}
        className={`w-32 h-32 rounded-xl overflow-hidden border border-edge/60 bg-void/60 flex items-center justify-center hover:border-god/40 transition-colors ${profile.avatar ? 'cursor-zoom-in' : ''}`}>
        {gening ? <span className="text-[11px] font-mono text-god/70 animate-pulse">生成中…</span>
          : profile.avatar ? <img src={profile.avatar} alt="立绘" className="w-full h-full object-cover" />
          : <span className="text-5xl text-dim/25">👤</span>}
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
      <PortraitLibraryModal open={libOpen} onClose={() => setLibOpen(false)} onPick={(url) => setProfile({ avatar: url })} />
      <div className="flex gap-1.5">
        <button onClick={handleGen} disabled={gening}
          className="text-[11px] font-mono px-2 py-0.5 rounded border border-god/40 text-god hover:bg-god/10 disabled:opacity-40 transition-colors">✨ 生成</button>
        <button onClick={() => fileRef.current?.click()}
          className="text-[11px] font-mono px-2 py-0.5 rounded border border-edge text-dim hover:text-god transition-colors">上传</button>
        <PortraitPicker onPick={(url) => setProfile({ avatar: url })} />
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
  const [personaOpen, setPersonaOpen] = useState(false);   // 性格详细描述：默认收起，点击「📖详情」展开查看/编辑
  const [labelOpen, setLabelOpen] = useState(false);       // HP/EP 条自定义称呼（换皮）：默认收起，点血条下方小按钮展开
  const [refillMsg, setRefillMsg] = useState('');          // 一键回满 HP/EP 的瞬时反馈
  const [resOpen, setResOpen] = useState(false);           // 自定义能量条管理：默认收起
  const resources = useResource((s) => s.resources);
  const addResource = useResource((s) => s.addResource);
  const updateResource = useResource((s) => s.updateResource);
  const removeResource = useResource((s) => s.removeResource);
  const [showTrueAttr, setShowTrueAttr] = useState(nominalTierNum(profile.tier, profile.level) >= 4);   // 四阶起默认显示真实属性（六维即真实属性）
  const isRealTier = nominalTierNum(profile.tier, profile.level) >= 4;   // 一~三阶=普通属性阶段，没有真实属性（四阶起经觉醒才有）
  useEffect(() => { if (!isRealTier && showTrueAttr) setShowTrueAttr(false); }, [isRealTier, showTrueAttr]);   // 跌回<四阶或本就<四阶 → 强制普通属性视图
  const b1 = useCharacters((s) => s.characters['B1']);
  const updateSkill = useCharacters((s) => s.updateSkill);
  // 技能↔能量条绑定（写进 skill.numeric.resCost「消耗」/ resGate「门槛」；同一技能共用一条能量条）
  const skillResId = (sk: any) => sk?.numeric?.resCost?.id ?? sk?.numeric?.resGate?.id ?? '';
  const setSkillResId = (sk: any, resId: string) => {
    const num = sk.numeric ?? { kind: 'skill' };
    if (!resId) { updateSkill('B1', sk.id, { numeric: { ...num, resCost: undefined, resGate: undefined } }); return; }
    const resCost = num.resCost ? { id: resId, amount: num.resCost.amount } : { id: resId, amount: 10 };   // 选能量条默认给个消耗10
    const resGate = num.resGate ? { id: resId, amount: num.resGate.amount } : undefined;
    updateSkill('B1', sk.id, { numeric: { ...num, resCost, resGate } });
  };
  const setSkillAmt = (sk: any, field: 'resCost' | 'resGate', amt: number) => {
    const num = sk.numeric ?? { kind: 'skill' };
    const id = skillResId(sk);
    updateSkill('B1', sk.id, { numeric: { ...num, [field]: id && amt > 0 ? { id, amount: amt } : undefined } });
  };
  const equippedFull = items.filter((it) => it.equipped);
  const equipped = equippedFull.map((it) => ({ category: it.category as string, grade: (it.numeric?.grade as number) ?? gradeToNum(it.gradeDesc), combatStat: it.combatStat }));
  // 属性构成：原始 + 技能树 + 装备/技能/天赋 的属性加成（真实加载，不只是摆设）
  // 技能树六维折进 base（与战斗/骰子一致），资质档 bioInnate 仍用原始 profile.attrs
  const capB = attrCapForTier(profile.tier, profile.level);
  // 宝石套装六维加成 → 合成"装备条目"并入"装备"来源列（与战斗 buildCombatant 同口径）；同时供套装面板展示
  const gemSets = activeGemSets(equippedFull);
  const setEntry = gemSetEquipEntry(equippedFull);
  const equipForAttr = setEntry ? [...equippedFull, setEntry as any] : equippedFull;
  const breakdown = computeAttrBreakdown(withAttrDelta(withAttrDelta(profile.attrs, playerTreeAttrBonus()), playerTeamAttrBonus()), b1?.skills ?? [], b1?.traits ?? [], equipForAttr, capB);   // 基础有效六维(不含真实属性点直加)·夹本阶上限·供属性栏展示
  // 衍生/战力按「有效六维 + 真实属性点直加(realAttrs)」算，与战斗 buildCombatant 同口径（直加并入再夹本阶上限）
  const breakdownReal = computeAttrBreakdown(withAttrDelta(withAttrDelta(withAttrDelta(profile.attrs, playerTreeAttrBonus()), playerTeamAttrBonus()), profile.realAttrs), b1?.skills ?? [], b1?.traits ?? [], equipForAttr, capB);
  const effAttrs = { str: breakdownReal.str.total, agi: breakdownReal.agi.total, con: breakdownReal.con.total, int: breakdownReal.int.total, cha: breakdownReal.cha.total, luck: breakdownReal.luck.total } as PlayerAttrs;
  const derived = computeDerived(effAttrs, profile.level, equipped);   // 衍生属性按"有效六维(含真实属性点直加)"算（不含战斗内四阶×5）
  const derivedNoEq = computeDerived(effAttrs, profile.level, []);     // 仅六维+等级部分（拆出装备贡献）
  const [attrPop, setAttrPop] = useState<keyof PlayerAttrs | null>(null);   // 点击查看属性构成
  const [vitalPop, setVitalPop] = useState<'hp' | 'ep' | null>(null);        // 点击血条查看 HP/EP 上限构成
  const [derivedPop, setDerivedPop] = useState<keyof typeof derived | null>(null);
  // 属性加点（待确认 / 结算模型）：普通属性「+」消耗「属性点」(每点 +1 基础 attrs)，真实属性「+」消耗「真实属性点」(每点 +1 真实·直加 realAttrs，**不动基础**，两者独立)。
  // 点「+/−」只暂存待加点；点「✓ 确认加点」才一次性结算：扣点、加属性，并为本次跨过的所有里程碑(密→疏变步长·见 milestonesCrossed)逐个弹四选一逆天天赋。
  const attrPts = profile.attrPoints ?? 0;
  const realPts = profile.realAttrPoints ?? 0;
  const realAttrs = profile.realAttrs ?? {};   // 真实属性·直加分配（与基础独立）；显示真实属性 = floor(基础/80) + realAttrs
  const [pending, setPending] = useState<Record<string, { ap: number; rap: number }>>({});  // 各属性暂存的 属性点/真实属性点
  const [pickerQueue, setPickerQueue] = useState<{ key: keyof PlayerAttrs; label: string; milestone: number }[]>([]);
  const stagedAp = Object.values(pending).reduce((s, v) => s + (v.ap || 0), 0);
  const stagedRap = Object.values(pending).reduce((s, v) => s + (v.rap || 0), 0);
  const apLeft = attrPts - stagedAp, rapLeft = realPts - stagedRap;
  const stage = (key: keyof PlayerAttrs) => setPending((p) => {
    if (key === 'luck') return p;   // 幸运禁止加点（前端机械生成）
    const cur = p[key] ?? { ap: 0, rap: 0 };
    // 在 updater 内部按最新 pending 算剩余，避免同一渲染内连点超额暂存（attrPts/realPts 在确认前不变）
    const usedAp = Object.values(p).reduce((s, v) => s + (v.ap || 0), 0);
    const usedRap = Object.values(p).reduce((s, v) => s + (v.rap || 0), 0);
    if (showTrueAttr) return realPts - usedRap <= 0 ? p : { ...p, [key]: { ...cur, rap: cur.rap + 1 } };
    return attrPts - usedAp <= 0 ? p : { ...p, [key]: { ...cur, ap: cur.ap + 1 } };
  });
  const unstage = (key: keyof PlayerAttrs) => setPending((p) => {
    const cur = p[key]; if (!cur) return p;
    const next = showTrueAttr ? { ...cur, rap: Math.max(0, cur.rap - 1) } : { ...cur, ap: Math.max(0, cur.ap - 1) };
    const np = { ...p, [key]: next };
    if (next.ap === 0 && next.rap === 0) delete np[key];
    return np;
  });
  const cancelAlloc = () => setPending({});
  const confirmAlloc = () => {
    const cur = usePlayer.getState().profile;
    const newAttrs = { ...cur.attrs };
    const newReal: Partial<PlayerAttrs> = { ...(cur.realAttrs ?? {}) };
    const queue: { key: keyof PlayerAttrs; label: string; milestone: number }[] = [];
    const changes: string[] = [];   // 人类可读加点明细 → 注入正文事件，让 AI 知道这次淬炼
    let useAp = 0, useRap = 0;
    for (const def of ATTR_DEFS) {
      const pd = pending[def.key]; if (!pd || (!pd.ap && !pd.rap)) continue;
      const oldBase = cur.attrs[def.key] ?? 0;
      const oldAlloc = (cur.realAttrs?.[def.key]) ?? 0;
      const newBase = oldBase + pd.ap;            // 属性点 → +1 基础
      const newAlloc = oldAlloc + pd.rap;         // 真实属性点 → +1 真实·直加（不动基础）
      newAttrs[def.key] = newBase; newReal[def.key] = newAlloc; useAp += pd.ap; useRap += pd.rap;
      if (pd.ap) changes.push(`${def.label} ${oldBase}→${newBase}（消耗${pd.ap}属性点）`);
      if (pd.rap) changes.push(`真实${def.label}·直加 ${oldAlloc}→${newAlloc}（消耗${pd.rap}真实属性点）`);
      // 里程碑按「真实属性 = 基础六维 + 真实属性点直加」计算（2026-06-24 起不再 ÷80；四阶起六维即真实属性）
      for (const m of milestonesCrossed(oldBase + oldAlloc, newBase + newAlloc)) queue.push({ key: def.key, label: def.label, milestone: m });
    }
    if (!useAp && !useRap) return;
    const remainAp = Math.max(0, (cur.attrPoints ?? 0) - useAp);
    const remainRap = Math.max(0, (cur.realAttrPoints ?? 0) - useRap);
    setProfile({ attrs: newAttrs, realAttrs: newReal, attrPoints: remainAp, realAttrPoints: remainRap });
    // 一次性事件：让下一次主线叙事"知道"这次主动加点（点数已前端结算，余额为最新值）
    pushAllocNotice(`【主角属性分配】${cur.name || '主角'}在属性面板自行加点：${changes.join('；')}。分配后余额——属性点${remainAp}、真实属性点${remainRap}。请在正文中将这次主动淬炼/强化自然带过（可简略），并以此余额为准；点数已由前端确定性结算，勿再提示"有未用点数"或重发点数。`);
    setPending({});
    if (queue.length) setPickerQueue(queue);
  };

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
            <span className={`${tierFxClass(realmFromLevel(profile.level))} font-bold`} title="阶位由等级自动对应">{realmFromLevel(profile.level)}</span>
            {profile.profession && <span className="text-edge">·</span>}
            <EditText value={profile.profession} onSave={(v) => setProfile({ profession: v })} placeholder="职业" />
          </div>
        </div>
      </div>

      {/* 手机端：不独立滚动、按内容自然撑高 → 整个侧栏(aside)一起上下滑；桌面端(lg+)：本区独立滚动、底部 HP/EP 固定 */}
      <div className="flex-none overflow-visible lg:flex-1 lg:overflow-y-auto lg:min-h-0">
        {/* 身份信息 */}
        <div className="p-3 border-b border-edge space-y-1.5">
          <div className="text-sm text-god font-mono mb-1.5">❖ 身份</div>
          <Row label="所属乐园"><EditText value={profile.homeParadise} onSave={(v) => setProfile({ homeParadise: v })} placeholder="（开局选定）" /></Row>
          <Row label="主角背景"><EditText value={profile.preParadiseJob} onSave={(v) => setProfile({ preParadiseJob: v })} placeholder="（入园前职业）" /></Row>
          {/* 性格：行内显示简短特质；详细描述默认收起，点「📖详情」展开查看/编辑（不占满面板） */}
          <div className="flex items-center gap-2 text-[13px]">
            <span className="w-20 shrink-0 text-dim/60 font-mono">性格</span>
            <span className="flex-1 min-w-0 truncate"><EditText value={profile.personality || ''} onSave={(v) => setProfile({ personality: v })} placeholder="（性格特质）" /></span>
            <button onClick={() => setPersonaOpen((v) => !v)} title="查看 / 编辑性格详细描述"
              className="shrink-0 text-[11px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/60 hover:text-god hover:border-god/40 transition-colors">
              📖{personaOpen ? '收起' : '详情'}
            </button>
          </div>
          {personaOpen && (
            <div className="rounded-lg border border-god/30 bg-void/40 p-2">
              <div className="text-[11px] font-mono text-god/60 mb-1">性格详细描述</div>
              <textarea
                value={profile.personalityDetail || ''}
                onChange={(e) => setProfile({ personalityDetail: e.target.value })}
                rows={4}
                placeholder="点击编辑性格的详细描述（成长经历 / 价值观 / 行为模式 / 软肋与执念…）。会注入 AI 上下文，影响人设刻画。"
                className="w-full bg-void border border-edge rounded px-2 py-1.5 text-[13px] text-slate-200 outline-none focus:border-god/50 leading-relaxed resize-y"
              />
            </div>
          )}
          <Row label="性别"><EditText value={profile.gender || ''} onSave={(v) => setProfile({ gender: v })} placeholder="（开局设定·生图据此定 1boy/1girl）" /></Row>
          <Row label="种族"><EditText value={profile.race || ''} onSave={(v) => setProfile({ race: v })} placeholder="（如 人类/精灵）" /></Row>
          <Row label="称号"><EditText value={profile.title} onSave={(v) => setProfile({ title: v })} placeholder="（无）" /></Row>
          <Row label="身份"><EditText value={profile.identity} onSave={(v) => setProfile({ identity: v })} placeholder="（无）" /></Row>
          <Row label="职业"><EditText value={profile.profession} onSave={(v) => setProfile({ profession: v })} placeholder="（无）" /></Row>
          <Row label="竞技场排名"><EditText value={profile.arenaRank} onSave={(v) => setProfile({ arenaRank: v })} placeholder="（未上榜）" /></Row>
          <Row label="烙印等级"><EditText value={profile.brandLevel} onSave={(v) => setProfile({ brandLevel: v })} placeholder="（无）" /></Row>
          <Row label="契约者ID"><EditText value={profile.contractorId} onSave={(v) => setProfile({ contractorId: v })} placeholder="（未分配）" /></Row>
          <Row label="生物强度" wrap><span className="text-[13px] text-amber-300/90 flex flex-col leading-snug" title="前端按六维机械判定：资质档(基础六维)/战力档(含装备技能天赋加成)">{(bioStrengthLabel(bioInnate(profile.attrs, profile.tier, profile.level), bioPower(effAttrs, profile.tier, profile.level)) || '（六维待定）').split(' / ').map((p, i) => <span key={i}>{p}</span>)}</span></Row>
          <Row label="世界之源"><EditNum value={Math.round((profile.worldSource ?? 0) * 10) / 10} onSave={(v) => setProfile({ worldSource: Math.round(v * 10) / 10 })} /></Row>
        </div>

        {/* 基础属性 / 真实属性（切换；四阶起六维即真实属性，真实属性=基础六维+真实属性点直加，不再÷80） */}
        <div className={`p-3 border-b border-edge${showTrueAttr ? ' ra-gold-panel' : ''}`}>
          <div className="text-sm text-god font-mono mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 min-w-0">⚔ {showTrueAttr ? '真实属性' : '基础属性'}
              <span className="text-[11px] font-mono text-amber-300/80 truncate" title={showTrueAttr ? '真实属性点：四阶起由任务结算/升级发放；点「+」暂存、确认后消耗（每点真实属性+1）' : '属性点：任务结算/升级发放；点「+」暂存、确认后消耗（每点基础+1）'}>
                {showTrueAttr ? `🔶真实属性点 ${rapLeft}` : `🔷属性点 ${apLeft}`}
                {(showTrueAttr ? stagedRap : stagedAp) > 0 && <span className="text-emerald-400/80"> (待确认 −{showTrueAttr ? stagedRap : stagedAp})</span>}
              </span>
            </span>
            {isRealTier && (
            <button
              onClick={() => setShowTrueAttr((v) => !v)}
              title="四阶起六维即真实属性（不再÷80）；两个视图都可加点（普通属性用属性点，真实属性用真实属性点）"
              className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/60 hover:border-god/40 hover:text-god transition-colors shrink-0"
            >{showTrueAttr ? '基础属性' : '真实属性'}</button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {ATTR_DEFS.map(({ key, label }) => {
              const bk = breakdown[key];
              const bonus = bk.total - bk.base;
              const pd = pending[key] ?? { ap: 0, rap: 0 };
              const pendCount = showTrueAttr ? pd.rap : pd.ap;     // 当前视图单位下的待加点数
              const canStage = showTrueAttr ? rapLeft > 0 : apLeft > 0;
              const allocatable = key !== 'luck';                  // 幸运由前端机械生成，禁止手动加点
              return (
                <div key={key} className="flex items-center justify-between text-[13px]">
                  <span className="text-dim/60 font-mono">{showTrueAttr ? `真实${label}` : label}</span>
                  <span className="flex items-center gap-1">
                    {showTrueAttr
                      ? <span className="font-mono font-bold text-amber-300/90 ra-gold" title="真实属性 = 基础六维(含装备/技能/天赋) + 真实属性点直加（四阶起六维即真实属性，不再÷80）">{bk.total + (realAttrs[key] ?? 0)}{(realAttrs[key] ?? 0) > 0 && <span className="ml-0.5 text-[11px] text-emerald-400/70">(+{realAttrs[key]}直加)</span>}</span>
                      : <button onClick={() => setAttrPop(attrPop === key ? null : key)} title="点击查看属性构成"
                          className="font-mono font-bold text-slate-100 hover:text-god transition-colors">
                          {bk.total}{bonus !== 0 && <span className={`ml-0.5 text-[11px] ${bonus > 0 ? 'text-emerald-400/70' : 'text-blood/70'}`}>({bonus > 0 ? '+' : ''}{bonus})</span>}
                        </button>}
                    {allocatable && pendCount > 0 && <span className="text-[11px] font-mono text-emerald-400/90" title="待确认的加点">+{pendCount}</span>}
                    {allocatable && pendCount > 0 && <button onClick={() => unstage(key)} title="撤销一点待加点"
                      className="w-4 h-4 flex items-center justify-center rounded border border-edge text-dim/60 hover:text-blood hover:border-blood/40 text-[12px] font-bold leading-none">−</button>}
                    {allocatable
                      ? <button onClick={() => stage(key)} disabled={!canStage}
                          title={showTrueAttr
                            ? (canStage ? `暂存 1 真实属性点：真实${label} +1（真实属性直加，不动基础）` : '真实属性点不足')
                            : (canStage ? `暂存 1 属性点：${label} +1` : '属性点不足')}
                          className="w-5 h-5 flex items-center justify-center rounded border text-[14px] font-bold leading-none transition-colors border-god/40 text-god hover:bg-god/15 disabled:opacity-25 disabled:cursor-not-allowed">+</button>
                      : <span title="幸运由前端机械生成，不可手动加点" className="text-[12px] text-dim/30 leading-none px-1">🔒</span>}
                  </span>
                </div>
              );
            })}
          </div>
          {/* 宝石套装：集齐已装备装备上的同套装宝石激活阶梯加成（六维已并入上方"装备"来源列，战斗被动进战斗结算） */}
          {gemSets.length > 0 && (
            <div className="mt-2 space-y-1">
              {gemSets.map((s) => (
                <div key={s.key} className="rounded-lg border border-god/25 bg-god/5 px-2 py-1">
                  <div className="flex items-center gap-1.5 text-[12px]">
                    <span>{s.emoji}</span>
                    <span className="font-bold text-god/90">{s.name}</span>
                    <span className="font-mono text-[11px] text-amber-300/80">×{s.count}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                    {s.tiers.map((t) => (
                      <span key={t.need} className={`text-[10.5px] font-mono ${t.active ? 'text-emerald-300/90' : 'text-dim/35'}`}
                        title={t.active ? '已激活' : `再镶嵌 ${t.need - s.count} 件同套装宝石激活`}>
                        {t.active ? '✓' : '○'}{t.need}件·{t.bonus}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* 加点确认条：暂存待加点后出现，确认才结算（扣点+加属性+里程碑四选一） */}
          {(stagedAp > 0 || stagedRap > 0) && (
            <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-god/40 bg-god/5 px-2 py-1.5">
              <span className="text-[11px] font-mono text-dim/75 flex-1 min-w-0 truncate">
                待确认：{[stagedAp > 0 && `属性点 −${stagedAp}`, stagedRap > 0 && `真实属性点 −${stagedRap}`].filter(Boolean).join(' · ')}
              </span>
              <button onClick={cancelAlloc} className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/60 hover:text-blood hover:border-blood/40 transition-colors">取消</button>
              <button onClick={confirmAlloc} className="text-[11px] font-mono px-2 py-0.5 rounded border border-god/50 text-god bg-god/10 hover:bg-god/20 transition-colors font-bold">✓ 确认加点</button>
            </div>
          )}
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
          <div className="text-sm text-god font-mono mb-2">⚔ 衍生属性 <span className="text-[11px] text-dim/40">六维(含真实属性点)+装备换算</span></div>
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
            const formula = { patk: 'max(力,敏)×3 + 力 + 等级×2 + 装备', pdef: '体×3 + 等级×2 + 装备', matk: '智×3 + 等级×2 + 装备', mdef: '智×1.6 + 魅×1.4 + 等级×2 + 装备' }[k];
            return (
              <div className="mt-2 rounded-lg border border-god/30 bg-void/50 px-3 py-2 text-[12px] font-mono space-y-1">
                <div className="flex items-center justify-between"><span className="text-god/80">{label} · 公式与构成</span><button onClick={() => setDerivedPop(null)} className="text-dim/40 hover:text-blood">✕</button></div>
                <div className="text-dim/55 text-[11px] leading-snug">公式：{formula}</div>
                <div className="flex justify-between"><span className="text-dim/60">有效六维(含真实属性点) + 等级</span><span className="text-slate-200">{derivedNoEq[k]}</span></div>
                {eq !== 0 && <div className="flex justify-between"><span className="text-dim/60">装备加成</span><span className="text-amber-300/80">{eq > 0 ? '+' : ''}{eq}</span></div>}
                <div className="flex justify-between border-t border-edge/40 pt-1"><span className="text-slate-300">合计</span><span className="text-slate-100 font-bold">{total}</span></div>
                <div className="text-dim/40 text-[11px]">已含装备/技能/天赋 + 真实属性点直加；战斗中四阶起整体 ×5（跨阶碾压·同阶相抵）。</div>
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

        {/* 形态（人形/非人形）：非人形召唤物/野兽绕开人形生图框架 */}
        <div className="p-3 border-b border-edge flex items-center gap-2">
          <div className="text-sm text-dim font-mono shrink-0">形态</div>
          <select value={profile.bodyType ?? ''} onChange={(e) => setProfile({ bodyType: e.target.value as any })}
            className="flex-1 bg-void/60 border border-edge/60 rounded px-2 py-1 text-[13px] text-slate-200 focus:border-god/40 outline-none">
            <option value="">自动（按外观判断）</option>
            <option value="人形">人形</option>
            <option value="兽形">兽形（野兽/动物）</option>
            <option value="非人形">非人形（召唤物/怪物/触手）</option>
          </select>
        </div>

        {/* 基底外观（生图基准·可点击编辑）*/}
        <div className="p-3 border-b border-edge">
          <div className="text-sm text-dim font-mono mb-1.5">基底外观 <span className="text-[11px] text-dim/40">常驻长相·不随剧情漂移·生图始终包含</span></div>
          <EditText
            value={profile.baseAppearance || ''}
            onSave={(v) => setProfile({ baseAppearance: v })}
            placeholder="点击填写常驻长相（身高 / 脸型 / 瞳色 / 发色发型 / 肤色 / 体型 / 标志特征等不变的长相基准）…"
            multiline
            segmented
            className="text-[13px] leading-relaxed block w-full"
          />
        </div>

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
          // 最大HP/EP = (基础六维 + 技能树 + 团队的六维加成) 换算 + 装备/被动里明确写"增加HP/EP上限"的平值 + 百分比加成(如被动"10%生命加成")；与上方属性面板同口径，技能树加的体质/智力同步抬高 HP/EP 上限
          const teamAttrsBase = withAttrDelta(withAttrDelta(withAttrDelta(profile.attrs, playerTreeAttrBonus()), playerTeamAttrBonus()), profile.realAttrs);   // 技能树 + 团队 + 真实属性点直加(realAttrs) 的六维加成（体/智→HP/EP，与战斗/属性面板同口径）
          const teamPerkAbil = playerTeamPerkAbilities();                              // 团队效果显式「HP/EP上限」文本
          const rmP = realAttrMult(profile.tier, profile.level);   // 四阶起 HP/EP×5（与战斗/AI一致）
          const maxHp = fullMaxHp(teamAttrsBase, equippedFull, b1?.skills, [...(b1?.traits ?? []), ...teamPerkAbil], rmP, ratioOf(profile));
          const maxEp = fullMaxEp(teamAttrsBase, equippedFull, b1?.skills, [...(b1?.traits ?? []), ...teamPerkAbil], rmP, ratioOf(profile));
          return (
            <>
              <div className="space-y-2">
                <div onClick={() => setVitalPop(vitalPop === 'hp' ? null : 'hp')} className="cursor-pointer" title="点击查看 HP 上限构成（基础六维 + 各效果加成）">
                  <Bar value={effectiveResource(p.hp, p.maxHp, maxHp)} max={maxHp} color="bg-blood" label={profile.hpLabel || '生命 HP'} styleId={profile.barStyle} kind="hp" />
                </div>
                <div onClick={() => setVitalPop(vitalPop === 'ep' ? null : 'ep')} className="cursor-pointer" title="点击查看 EP 上限构成（基础六维 + 各效果加成）">
                  <Bar value={effectiveResource(p.mp, p.maxMp, maxEp)} max={maxEp} color="bg-sky-500" label={profile.epLabel || '蓝量 EP'} styleId={profile.barStyle} kind="ep" />
                </div>
              </div>
              {/* HP/EP 上限构成弹层：基础六维换算 + 各效果(装备/技能/天赋)平值+百分比+跨资源加成，合计=真实上限 */}
              {vitalPop && (() => {
                const bd = computeVitalBreakdown(vitalPop, teamAttrsBase, equippedFull, b1?.skills ?? [], [...(b1?.traits ?? []), ...teamPerkAbil], rmP, ratioOf(profile));
                const label = vitalPop === 'hp' ? (profile.hpLabel || '生命 HP') : (profile.epLabel || '蓝量 EP');
                const color = vitalPop === 'hp' ? 'text-blood' : 'text-sky-400';
                const has = bd.flatItems.length || bd.pctItems.length || bd.crossItems.length;
                const nm = (src: string, name: string) => (<span className="truncate mr-2"><span className="text-dim/35">{src}·</span>{name}</span>);
                return (
                  <div className="rounded-lg border border-god/30 bg-void/50 px-3 py-2 text-[12px] font-mono space-y-1">
                    <div className="flex items-center justify-between">
                      <span className={`${color}/90`}>{label} · 上限构成</span>
                      <button onClick={() => setVitalPop(null)} className="text-dim/40 hover:text-blood">✕</button>
                    </div>
                    <div className="flex justify-between"><span className="text-dim/60">六维换算{bd.realMult > 1 && <span className="text-amber-300/70"> ×{bd.realMult} 真实倍率</span>}</span><span className="text-slate-200">{bd.attrBase}</span></div>
                    {bd.flatItems.map((x, i) => <div key={`f${i}`} className="flex justify-between">{nm(x.source, x.name)}<span className="text-amber-300/80 shrink-0">上限 +{x.amount}</span></div>)}
                    {bd.pctItems.map((x, i) => <div key={`p${i}`} className="flex justify-between">{nm(x.source, x.name)}<span className="text-emerald-300/80 shrink-0">+{x.pct}%</span></div>)}
                    {bd.pctTotal !== 0 && <div className="flex justify-between"><span className="text-dim/45">└ 百分比合计 +{bd.pctTotal}%（作用于六维+平值）</span><span className="text-emerald-300/80">+{bd.pctAdd}</span></div>}
                    {bd.crossItems.map((x, i) => <div key={`c${i}`} className="flex justify-between">{nm(x.source, `${x.name} 跨资源`)}<span className="text-fuchsia-300/80 shrink-0">+{x.amount}</span></div>)}
                    <div className="flex justify-between border-t border-edge/40 pt-1"><span className="text-slate-300">合计上限</span><span className={`${color} font-bold`}>{bd.total}</span></div>
                    {!has && <div className="text-dim/40 text-[11px]">暂无装备/技能/天赋的上限加成；上限全部来自六维换算</div>}
                    <div className="text-dim/35 text-[10px] leading-snug">六维换算＝Σ(六维×转化比){bd.realMult > 1 ? '×真实倍率' : ''}；平值/百分比来自装备词缀与技能天赋被动。</div>
                  </div>
                );
              })()}
              {/* 一键回满（主角 + 在场队友）：手动逃生口——治"队友总是 400/4000 残疾、刷新也回不满"。当前 HP/EP 平时忠于正文、不自动补血，这里玩家主动点才回满。 */}
              <button
                onClick={(e) => { e.stopPropagation(); const r = refillAllVitals(); setRefillMsg(`已回满 · 主角${r.team ? ` + ${r.team} 名队友` : ''}`); setTimeout(() => setRefillMsg(''), 2500); }}
                className="w-full text-[11px] py-1 rounded border border-blood/40 text-blood/80 hover:bg-blood/10 font-mono transition-colors"
                title="把主角和在场/常驻队友的 HP/EP 一键回满到各自上限（手动，不影响正文驱动）"
              >💧 一键回满 HP/EP（主角＋在场队友）</button>
              {refillMsg && <div className="text-[10px] text-emerald-400/80 font-mono text-center">{refillMsg}</div>}
              {/* 自定义能量条（剧情资源）：当前值由正文 res.B1.<id> 驱动，上限按固定值/六维公式算 */}
              {resources.map((r) => { const rmax = playerResourceMax(r); return <Bar key={r.id} value={Math.min(Math.max(0, r.cur ?? 0), rmax)} max={rmax} color={r.color || 'bg-emerald-500'} label={r.name} />; })}
              <div className="text-[10px] text-dim/35 font-mono text-center">HP=体质×20 · EP=智力×15（按属性自动换算）</div>
            </>
          );
        })()}
        {/* 自定义血条称呼（换皮）：默认收起，点小按钮展开填写；留空=默认「生命 HP / 蓝量 EP」。仅改显示，hp/ep 数值与指令通道不变 */}
        <button
          onClick={() => setLabelOpen((o) => !o)}
          className="w-full text-[10px] text-dim/40 hover:text-god/70 font-mono text-center transition-colors"
        >
          {labelOpen ? '收起 ▲' : '✎ 自定义血条'}
        </button>
        {labelOpen && (
          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2 text-[11px] font-mono">
              <span className="w-10 shrink-0 text-dim/60">HP 条</span>
              <input
                value={profile.hpLabel || ''}
                onChange={(e) => setProfile({ hpLabel: e.target.value })}
                placeholder="留空=生命 HP，如 血池"
                className="flex-1 min-w-0 bg-void border border-edge rounded px-2 py-0.5 text-[12px] text-slate-200 outline-none focus:border-god/50"
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] font-mono">
              <span className="w-10 shrink-0 text-dim/60">EP 条</span>
              <input
                value={profile.epLabel || ''}
                onChange={(e) => setProfile({ epLabel: e.target.value })}
                placeholder="留空=蓝量 EP，如 血怒"
                className="flex-1 min-w-0 bg-void border border-edge rounded px-2 py-0.5 text-[12px] text-slate-200 outline-none focus:border-god/50"
              />
            </label>
            {/* 多属性转化比矩阵：每个属性都能按自定义系数同时供给 HP / EP（留空=默认 体×20→HP、智×15→EP）*/}
            <div className="pt-0.5">
              <div className="text-[10px] text-dim/50 font-mono mb-1">多属性转化比（每点属性→上限）</div>
              <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-x-2 gap-y-1 items-center">
                <span className="text-[10px] text-dim/40" />
                <span className="text-[10px] text-dim/50 font-mono text-center">→HP</span>
                <span className="text-[10px] text-dim/50 font-mono text-center">→EP</span>
                {ATTR_KEYS.map((k) => (
                  <div key={k} className="contents">
                    <span className="text-[11px] text-dim/60 font-mono">{ATTR_LABEL[k]}</span>
                    <input
                      type="number" min={0} step={1}
                      value={profile.hpRatio?.[k] ?? ''}
                      onChange={(e) => { const cur = { ...(profile.hpRatio ?? {}) }; const raw = e.target.value.trim(); if (raw === '') delete cur[k]; else cur[k] = Number(raw); setProfile({ hpRatio: Object.keys(cur).length ? cur : undefined }); }}
                      placeholder={k === 'con' ? '20' : '0'}
                      className="w-full min-w-0 bg-void border border-edge rounded px-1.5 py-0.5 text-[12px] text-slate-200 outline-none focus:border-god/50"
                    />
                    <input
                      type="number" min={0} step={1}
                      value={profile.epRatio?.[k] ?? ''}
                      onChange={(e) => { const cur = { ...(profile.epRatio ?? {}) }; const raw = e.target.value.trim(); if (raw === '') delete cur[k]; else cur[k] = Number(raw); setProfile({ epRatio: Object.keys(cur).length ? cur : undefined }); }}
                      placeholder={k === 'int' ? '15' : '0'}
                      className="w-full min-w-0 bg-void border border-edge rounded px-1.5 py-0.5 text-[12px] text-slate-200 outline-none focus:border-god/50"
                    />
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-dim/40 font-mono mt-1">HP / EP = 各属性×系数之和。留空=默认（体×20→HP、智×15→EP，其余 0）。可混多属性，如 HP=体×10+智×5；四阶起仍自动×5。</div>
            </div>
            {/* 血条皮肤切换（10 款，点格即换；每格为实时迷你预览）*/}
            <div>
              <div className="text-[10px] text-dim/50 font-mono mb-1">血条皮肤</div>
              <div className="grid grid-cols-2 gap-1.5 lg:max-h-[46dvh] lg:overflow-y-auto pr-0.5">
                {BAR_STYLES.map((s) => {
                  const sel = (profile.barStyle || 'classic') === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setProfile({ barStyle: s.id })}
                      className={`rounded border px-1.5 py-1 transition-colors ${sel ? 'border-god/70 bg-god/10' : 'border-edge hover:border-god/40'}`}
                    >
                      <div className={`text-[10px] font-mono mb-1 text-left ${sel ? 'text-god' : 'text-dim/70'}`}>{sel ? '✓ ' : ''}{s.name}</div>
                      <div className="h-2 rounded-full bg-void border border-edge mb-1"><div className={`barfill bf-${s.id}-hp`} style={{ width: '85%' }} /></div>
                      <div className="h-2 rounded-full bg-void border border-edge"><div className={`barfill bf-${s.id}-ep`} style={{ width: '68%' }} /></div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {/* ⚡ 自定义能量条（HP/EP 之外的剧情资源·仅主角）：定义后渲染成条 + 注入正文供 AI 驱动 */}
        <button
          onClick={() => setResOpen((o) => !o)}
          className="w-full text-[10px] text-dim/40 hover:text-god/70 font-mono text-center transition-colors"
        >
          {resOpen ? '收起 ▲' : `⚡ 自定义能量条${resources.length ? `（${resources.length}）` : ''}`}
        </button>
        {resOpen && (
          // 桌面端(lg+)：限高 + 独立滚动条，避免撑破底部固定区；手机端：不限高，跟随整个侧栏一起上下滑（无嵌套双滚动）。
          <div className="space-y-2 pt-1 lg:max-h-[46dvh] lg:overflow-y-auto lg:overscroll-contain pr-1">
            {resources.length === 0 && <div className="text-[10px] text-dim/40 font-mono text-center">还没有能量条。点下方「+ 添加」新建（如 怒气值 / 堕落值 / 灵力）。</div>}
            {resources.map((r) => {
              const hasFormula = !!(r.maxFormula && Object.keys(r.maxFormula).length);
              return (
                <div key={r.id} className="border border-edge rounded p-2 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <input value={r.name} onChange={(e) => updateResource(r.id, { name: e.target.value })} placeholder="名称（怒气值）" className="flex-1 min-w-0 bg-void border border-edge rounded px-1.5 py-0.5 text-[12px] text-slate-200 outline-none focus:border-god/50" />
                    <button onClick={() => removeResource(r.id)} title="删除" className="shrink-0 text-rose-400/70 hover:text-rose-400 text-[12px] px-1">✕</button>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-dim/55 font-mono">
                    <span className="shrink-0">指令键</span>
                    <input value={r.id} onChange={(e) => updateResource(r.id, { id: e.target.value })} placeholder="rage" title="AI 用 res.B1.<键> 改值，仅限英文/数字" className="w-20 bg-void border border-edge rounded px-1.5 py-0.5 text-[11px] text-slate-300 outline-none focus:border-god/50" />
                    <span className="shrink-0 ml-auto">当前</span>
                    <input type="number" value={r.cur ?? 0} onChange={(e) => updateResource(r.id, { cur: Number(e.target.value) || 0 })} className="w-16 bg-void border border-edge rounded px-1.5 py-0.5 text-[11px] text-slate-200 outline-none focus:border-god/50" />
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-dim/55 font-mono">
                    <span className="shrink-0">上限</span>
                    <label className="flex items-center gap-1"><input type="radio" checked={!hasFormula} onChange={() => updateResource(r.id, { maxFormula: undefined })} />固定</label>
                    {!hasFormula && <input type="number" value={r.max ?? 100} onChange={(e) => updateResource(r.id, { max: Number(e.target.value) || 0 })} className="w-16 bg-void border border-edge rounded px-1.5 py-0.5 text-[11px] text-slate-200 outline-none focus:border-god/50" />}
                    <label className="flex items-center gap-1"><input type="radio" checked={hasFormula} onChange={() => updateResource(r.id, { maxFormula: { int: 15 } })} />六维公式</label>
                  </div>
                  {hasFormula && (
                    <div className="grid grid-cols-6 gap-1">
                      {ATTR_KEYS.map((k) => (
                        <label key={k} className="flex flex-col items-center text-[9px] text-dim/50 font-mono">
                          <span>{ATTR_SHORT[k]}</span>
                          <input type="number" min={0} value={r.maxFormula?.[k] ?? ''} onChange={(e) => { const m = { ...(r.maxFormula ?? {}) }; const raw = e.target.value.trim(); if (raw === '') delete m[k]; else m[k] = Number(raw); updateResource(r.id, { maxFormula: Object.keys(m).length ? m : { int: 15 } }); }} placeholder="0" className="w-full bg-void border border-edge rounded px-1 py-0.5 text-[11px] text-slate-200 outline-none focus:border-god/50" />
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1 flex-wrap">
                    {['bg-emerald-500', 'bg-rose-500', 'bg-amber-500', 'bg-violet-500', 'bg-cyan-500', 'bg-orange-500', 'bg-lime-500', 'bg-pink-500'].map((c) => (
                      <button key={c} onClick={() => updateResource(r.id, { color: c })} className={`w-4 h-4 rounded ${c} ${(r.color || 'bg-emerald-500') === c ? 'ring-2 ring-god' : 'opacity-70 hover:opacity-100'}`} />
                    ))}
                  </div>
                  <textarea value={r.desc ?? ''} onChange={(e) => updateResource(r.id, { desc: e.target.value })} rows={2} placeholder="说明（给 AI：这值代表什么、何时涨/落，例：受击或攻击+10，发动怒气技-40，满100可狂暴）" className="w-full bg-void border border-edge rounded px-1.5 py-0.5 text-[11px] text-slate-300 outline-none focus:border-god/50 resize-none" />
                  <label className="flex items-center gap-1.5 text-[10px] text-dim/55 font-mono"><input type="checkbox" checked={r.inject !== false} onChange={(e) => updateResource(r.id, { inject: e.target.checked })} />注入正文（让 AI 知道并按剧情驱动）</label>
                  {/* 战斗内累积：攻击/受击/击杀/每回合自动 +N（留空=战斗中不自动变，仅技能消耗/剧情驱动）*/}
                  <div className="flex items-center gap-1 flex-wrap text-[10px] text-dim/55 font-mono pt-0.5 border-t border-edge/40">
                    <span className="shrink-0" title="战斗内自动累积（每格留空=该事件不加）">⚔️攒</span>
                    {([['onAttack', '攻'], ['onHitTaken', '受'], ['onKill', '杀'], ['onTurn', '回']] as const).map(([k, lbl]) => (
                      <label key={k} className="flex items-center gap-0.5" title={k}>{lbl}
                        <input type="number" value={r.combat?.[k] ?? ''} onChange={(e) => { const raw = e.target.value.trim(); updateResource(r.id, { combat: { ...(r.combat ?? {}), [k]: raw === '' ? undefined : Number(raw) } }); }} className="w-8 bg-void border border-edge rounded px-0.5 py-0.5 text-[11px] text-slate-200 outline-none focus:border-god/50" />
                      </label>
                    ))}
                    <label className="flex items-center gap-0.5" title="每场战斗开始归零（如怒气从0攒）"><input type="checkbox" checked={!!r.combat?.resetEachBattle} onChange={(e) => updateResource(r.id, { combat: { ...(r.combat ?? {}), resetEachBattle: e.target.checked } })} />每战归零</label>
                  </div>
                </div>
              );
            })}
            <button onClick={() => addResource()} className="w-full text-[11px] text-god/70 hover:text-god border border-dashed border-edge hover:border-god/40 rounded py-1 transition-colors">+ 添加能量条</button>
            {/* 🎯 技能战斗消耗绑定：给主角技能挂上能量条消耗，战斗中不足则禁用、施放即扣 */}
            {resources.length > 0 && (b1?.skills?.some((s) => !/被动/.test(s.skillType ?? '')) ?? false) && (
              <div className="pt-1.5 mt-1 border-t border-edge/50">
                <div className="text-[10px] text-dim/50 font-mono mb-1">🎯 技能战斗消耗（耗=施放消耗，槛=可放门槛需≥；不足/未达则该技能禁用）</div>
                <div className="space-y-1">
                  {b1!.skills.filter((s) => !/被动/.test(s.skillType ?? '')).map((sk) => (
                    <div key={sk.id} className="flex items-center gap-1 text-[11px] font-mono">
                      <span className="flex-1 min-w-0 truncate text-dim/70" title={sk.name}>{sk.name}</span>
                      <select value={skillResId(sk)} onChange={(e) => setSkillResId(sk, e.target.value)} className="bg-void border border-edge rounded px-1 py-0.5 text-[11px] text-slate-200 outline-none focus:border-god/50 max-w-[4.5rem]">
                        <option value="">无</option>
                        {resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                      {skillResId(sk) && (
                        <>
                          <span className="text-dim/40 shrink-0" title="施放消耗">耗</span>
                          <input type="number" min={0} value={sk.numeric?.resCost?.amount ?? ''} onChange={(e) => setSkillAmt(sk, 'resCost', Number(e.target.value) || 0)} className="w-9 bg-void border border-edge rounded px-1 py-0.5 text-[11px] text-slate-200 outline-none focus:border-god/50" />
                          <span className="text-dim/40 shrink-0" title="可放门槛(需≥)">槛</span>
                          <input type="number" min={0} value={sk.numeric?.resGate?.amount ?? ''} onChange={(e) => setSkillAmt(sk, 'resGate', Number(e.target.value) || 0)} className="w-9 bg-void border border-edge rounded px-1 py-0.5 text-[11px] text-slate-200 outline-none focus:border-god/50" />
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="text-[10px] text-dim/40 font-mono leading-relaxed">当前值由正文 AI 按「说明」用 <code>res.B1.&lt;键&gt;</code> 增减；上方可把技能绑成消耗能量条（战斗内生效）。</div>
          </div>
        )}
      </div>

      {/* 属性里程碑·四选一逆天天赋（主角）：一次确认可能跨多个里程碑 → 逐个出列 */}
      {pickerQueue[0] && (
        <AttrTalentPicker
          key={`${pickerQueue[0].key}-${pickerQueue[0].milestone}-${pickerQueue.length}`}
          charId="B1"
          charName={profile.name || '主角'}
          charTier={profile.tier}
          attrLabel={pickerQueue[0].label}
          milestone={pickerQueue[0].milestone}
          trueValue={pickerQueue[0].milestone}
          isPlayer
          moreCount={pickerQueue.length - 1}
          onClose={() => setPickerQueue((q) => q.slice(1))}
        />
      )}
    </>
  );
}
