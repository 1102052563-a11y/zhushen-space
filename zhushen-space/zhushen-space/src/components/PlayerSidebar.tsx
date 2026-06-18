import { useState, useRef } from 'react';
import { usePlayer, type PlayerAttrs } from '../store/playerStore';
import { useGame } from '../store/gameStore';
import { useItems, gradeToNum } from '../store/itemStore';
import { StatusChips, SegmentedText } from './NpcDetail';
import StatusEffectChips from './StatusEffectChips';
import { computeDerived, tierFxClass, realmFromLevel, trueAttr, computeMaxHp, computeMaxEp, gearMaxHpBonus, gearMaxEpBonus, abilityMaxHpBonus, abilityMaxEpBonus, effectiveResource, fullMaxHp, fullMaxEp } from '../systems/derivedStats';
import { useCharacters } from '../store/characterStore';
import { computeAttrBreakdown, withAttrDelta, ATTR_LABEL, type AttrBreak } from '../systems/attrBonus';
import { playerTreeAttrBonus } from '../store/skillTreeStore';
import { playerTeamAttrBonus, playerTeamPerkAbilities } from '../store/adventureTeamStore';
import { bioInnate, bioPower, bioStrengthLabel, nominalTierNum } from '../systems/bioStrength';
import { useImageGen } from '../store/imageGenStore';
import { generateImage, buildPortraitPrompt, shrinkDataUrl } from '../systems/imageGen';
import { useImageViewer } from '../store/imageViewerStore';
import { PortraitPicker, PortraitLibraryModal } from './PortraitPicker';
import { genPortraitTags } from '../systems/imageTags';
import Bar, { BAR_STYLES } from './Bar';
import AttrTalentPicker from './AttrTalentPicker';
import { REAL_ATTR_STEP, milestonesCrossed } from '../systems/attrTalent';

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
      // 无英文生图标签(列19)时，先用 LLM 把中文外观翻成英文 danbooru tags（NAI 必须英文才像）
      let tags = profile.imageTags;
      if (!tags || !tags.trim()) {
        const desc = [profile.gender, profile.race, profile.baseAppearance, profile.appearance, profile.profession, realmFromLevel(profile.level), profile.background].filter(Boolean).join('，');
        const gen = await genPortraitTags(desc);
        if (gen) { tags = gen; setProfile({ imageTags: gen }); }
      }
      const prompt = buildPortraitPrompt({ gender: profile.gender, race: profile.race, appearance: profile.appearance, baseAppearance: profile.baseAppearance, profession: profile.profession, tier: realmFromLevel(profile.level), imageTags: tags });
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
  const [showTrueAttr, setShowTrueAttr] = useState(nominalTierNum(profile.tier, profile.level) >= 5);   // 五阶起默认显示真实属性点
  const b1 = useCharacters((s) => s.characters['B1']);
  const equippedFull = items.filter((it) => it.equipped);
  const equipped = equippedFull.map((it) => ({ category: it.category as string, grade: (it.numeric?.grade as number) ?? gradeToNum(it.gradeDesc) }));
  // 属性构成：原始 + 技能树 + 装备/技能/天赋 的属性加成（真实加载，不只是摆设）
  // 技能树六维折进 base（与战斗/骰子一致），资质档 bioInnate 仍用原始 profile.attrs
  const breakdown = computeAttrBreakdown(withAttrDelta(withAttrDelta(profile.attrs, playerTreeAttrBonus()), playerTeamAttrBonus()), b1?.skills ?? [], b1?.traits ?? [], equippedFull);
  const effAttrs = { str: breakdown.str.total, agi: breakdown.agi.total, con: breakdown.con.total, int: breakdown.int.total, cha: breakdown.cha.total, luck: breakdown.luck.total } as PlayerAttrs;
  const derived = computeDerived(effAttrs, profile.level, equipped);   // 衍生属性按"有效六维"计算
  const derivedNoEq = computeDerived(effAttrs, profile.level, []);     // 仅六维+等级部分（用于拆出装备贡献）
  const [attrPop, setAttrPop] = useState<keyof PlayerAttrs | null>(null);   // 点击查看属性构成
  const [derivedPop, setDerivedPop] = useState<keyof typeof derived | null>(null);
  // 属性加点（待确认 / 结算模型）：普通属性「+」消耗「属性点」(每点 +1 基础)，真实属性「+」消耗「真实属性点」(每点 +1 真实 = +80 基础)。
  // 点「+/−」只暂存待加点；点「✓ 确认加点」才一次性结算：扣点、加属性，并为本次跨过的所有里程碑(20/80/120)逐个弹四选一逆天天赋。
  const attrPts = profile.attrPoints ?? 0;
  const realPts = profile.realAttrPoints ?? 0;
  const [pending, setPending] = useState<Record<string, { ap: number; rap: number }>>({});  // 各属性暂存的 属性点/真实属性点
  const [pickerQueue, setPickerQueue] = useState<{ key: keyof PlayerAttrs; label: string; milestone: number }[]>([]);
  const stagedAp = Object.values(pending).reduce((s, v) => s + (v.ap || 0), 0);
  const stagedRap = Object.values(pending).reduce((s, v) => s + (v.rap || 0), 0);
  const apLeft = attrPts - stagedAp, rapLeft = realPts - stagedRap;
  const stage = (key: keyof PlayerAttrs) => setPending((p) => {
    const cur = p[key] ?? { ap: 0, rap: 0 };
    if (showTrueAttr) return rapLeft <= 0 ? p : { ...p, [key]: { ...cur, rap: cur.rap + 1 } };
    return apLeft <= 0 ? p : { ...p, [key]: { ...cur, ap: cur.ap + 1 } };
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
    const queue: { key: keyof PlayerAttrs; label: string; milestone: number }[] = [];
    let useAp = 0, useRap = 0;
    for (const def of ATTR_DEFS) {
      const pd = pending[def.key]; if (!pd || (!pd.ap && !pd.rap)) continue;
      const oldBase = cur.attrs[def.key] ?? 0;
      const newBase = oldBase + pd.ap + pd.rap * REAL_ATTR_STEP;
      newAttrs[def.key] = newBase; useAp += pd.ap; useRap += pd.rap;
      for (const m of milestonesCrossed(trueAttr(oldBase), trueAttr(newBase))) queue.push({ key: def.key, label: def.label, milestone: m });
    }
    if (!useAp && !useRap) return;
    setProfile({ attrs: newAttrs, attrPoints: Math.max(0, (cur.attrPoints ?? 0) - useAp), realAttrPoints: Math.max(0, (cur.realAttrPoints ?? 0) - useRap) });
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

      <div className="flex-1 overflow-y-auto">
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
          <Row label="生物强度" wrap><span className="text-[13px] text-amber-300/90 flex flex-col leading-snug" title="前端按六维机械判定：资质档(基础六维)/战力档(含装备技能天赋加成)">{(bioStrengthLabel(bioInnate(profile.attrs, profile.tier, profile.level), bioPower(effAttrs)) || '（六维待定）').split(' / ').map((p, i) => <span key={i}>{p}</span>)}</span></Row>
          <Row label="世界之源"><EditNum value={Math.round((profile.worldSource ?? 0) * 10) / 10} onSave={(v) => setProfile({ worldSource: Math.round(v * 10) / 10 })} /></Row>
        </div>

        {/* 基础属性 / 真实属性（切换；真实=普通÷80 向下取整，>80 才产生） */}
        <div className="p-3 border-b border-edge">
          <div className="text-sm text-god font-mono mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 min-w-0">⚔ {showTrueAttr ? '真实属性' : '基础属性'}
              <span className="text-[11px] font-mono text-amber-300/80 truncate" title={showTrueAttr ? '真实属性点：五阶后由任务结算发放；点「+」暂存、确认后消耗（每点真实+1）' : '属性点：任务结算发放；点「+」暂存、确认后消耗（每点基础+1）'}>
                {showTrueAttr ? `🔶真实属性点 ${rapLeft}` : `🔷属性点 ${apLeft}`}
                {(showTrueAttr ? stagedRap : stagedAp) > 0 && <span className="text-emerald-400/80"> (待确认 −{showTrueAttr ? stagedRap : stagedAp})</span>}
              </span>
            </span>
            <button
              onClick={() => setShowTrueAttr((v) => !v)}
              title="真实属性 = 每80点普通属性折算1点；两个视图都可加点（普通属性用属性点，真实属性用真实属性点）"
              className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/60 hover:border-god/40 hover:text-god transition-colors shrink-0"
            >{showTrueAttr ? '基础属性' : '真实属性'}</button>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {ATTR_DEFS.map(({ key, label }) => {
              const bk = breakdown[key];
              const bonus = bk.total - bk.base;
              const pd = pending[key] ?? { ap: 0, rap: 0 };
              const pendCount = showTrueAttr ? pd.rap : pd.ap;     // 当前视图单位下的待加点数
              const canStage = showTrueAttr ? rapLeft > 0 : apLeft > 0;
              return (
                <div key={key} className="flex items-center justify-between text-[13px]">
                  <span className="text-dim/60 font-mono">{showTrueAttr ? `真实${label}` : label}</span>
                  <span className="flex items-center gap-1">
                    {showTrueAttr
                      ? <span className="font-mono font-bold text-amber-300/90">{trueAttr(bk.total)}</span>
                      : <button onClick={() => setAttrPop(attrPop === key ? null : key)} title="点击查看属性构成"
                          className="font-mono font-bold text-slate-100 hover:text-god transition-colors">
                          {bk.total}{bonus !== 0 && <span className={`ml-0.5 text-[11px] ${bonus > 0 ? 'text-emerald-400/70' : 'text-blood/70'}`}>({bonus > 0 ? '+' : ''}{bonus})</span>}
                        </button>}
                    {pendCount > 0 && <span className="text-[11px] font-mono text-emerald-400/90" title="待确认的加点">+{pendCount}</span>}
                    {pendCount > 0 && <button onClick={() => unstage(key)} title="撤销一点待加点"
                      className="w-4 h-4 flex items-center justify-center rounded border border-edge text-dim/60 hover:text-blood hover:border-blood/40 text-[12px] font-bold leading-none">−</button>}
                    <button onClick={() => stage(key)} disabled={!canStage}
                      title={showTrueAttr
                        ? (canStage ? `暂存 1 真实属性点：真实${label} +1（基础 +80）` : '真实属性点不足')
                        : (canStage ? `暂存 1 属性点：${label} +1` : '属性点不足')}
                      className="w-5 h-5 flex items-center justify-center rounded border text-[14px] font-bold leading-none transition-colors border-god/40 text-god hover:bg-god/15 disabled:opacity-25 disabled:cursor-not-allowed">+</button>
                  </span>
                </div>
              );
            })}
          </div>
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
          // 最大HP/EP = (基础六维 + 技能树 + 团队的六维加成) 换算 + 装备/被动里明确写"增加HP/EP上限"的平值 + 百分比加成(如被动"10%生命加成")；与上方属性面板同口径，技能树加的体质/智力同步抬高 HP/EP 上限
          const teamAttrsBase = withAttrDelta(withAttrDelta(profile.attrs, playerTreeAttrBonus()), playerTeamAttrBonus());   // 技能树 + 团队效果的六维加成（体/智→HP/EP）
          const teamPerkAbil = playerTeamPerkAbilities();                              // 团队效果显式「HP/EP上限」文本
          const maxHp = fullMaxHp(teamAttrsBase, equippedFull, b1?.skills, [...(b1?.traits ?? []), ...teamPerkAbil]);
          const maxEp = fullMaxEp(teamAttrsBase, equippedFull, b1?.skills, [...(b1?.traits ?? []), ...teamPerkAbil]);
          return (
            <>
              <div onClick={() => setLabelOpen(true)} className="space-y-2 cursor-pointer" title="点击自定义血条皮肤 / 称呼">
                <Bar value={effectiveResource(p.hp, p.maxHp, maxHp)} max={maxHp} color="bg-blood" label={profile.hpLabel || '生命 HP'} styleId={profile.barStyle} kind="hp" />
                <Bar value={effectiveResource(p.mp, p.maxMp, maxEp)} max={maxEp} color="bg-sky-500" label={profile.epLabel || '蓝量 EP'} styleId={profile.barStyle} kind="ep" />
              </div>
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
            {/* 血条皮肤切换（10 款，点格即换；每格为实时迷你预览）*/}
            <div>
              <div className="text-[10px] text-dim/50 font-mono mb-1">血条皮肤</div>
              <div className="grid grid-cols-2 gap-1.5 max-h-[46vh] overflow-y-auto pr-0.5">
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
