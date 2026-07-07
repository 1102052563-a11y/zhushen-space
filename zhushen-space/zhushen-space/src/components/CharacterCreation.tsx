import { lazy, Suspense, useState } from 'react';
import { useCreationTemplates, type CreationTemplateData } from '../store/creationTemplateStore';
import { useCreationContent } from '../store/creationContentStore';
const WorkshopPanel = lazy(() => import('./WorkshopPanel'));

/* ════════════════════════════════════════════
   开局·角色创建
   难度→属性点 / 选择乐园 / 基本信息 / 六维分配 / 天赋 / 确认表
   确认后由 App 写入主角演化变量并自动发送开场白。
════════════════════════════════════════════ */

export interface CreationData {
  difficulty: string;
  points: number;
  paradise: string;
  name: string;
  gender: string;       // 性别（解析后：男/女/自定义文本）——生图据此强制 1boy/1girl
  race: string;         // 种族（解析后）
  raceDetail: string;   // 种族详情（自由文本）
  age: string;
  personality: string;
  personalityDetail: string;   // 性格详细描述（自由文本，写入档案 + 注入开场白/AI 上下文）
  prevProfession: string;
  appearance: string;   // 基底外观（不可变，生图始终包含）
  attrs: { str: number; agi: number; con: number; int: number; cha: number; luck: number };
  talentName: string;
  talentEffect: string;
  talentRarity?: string;     // 天赋评级 D~SSS（固定格式）
  talentCategory?: string;   // 天赋类型（属性类/特殊异能类/能量类/技巧类）
  talentLevel?: string;      // 天赋等级（成长档，如 觉醒·Lv.1 / 一阶）
  talentSource?: string;     // 来源/觉醒方式
  talentAttrBonus?: string;  // 属性加成（如 力量+10、智力+15%）
  talentDesc?: string;       // 简描（flavor/点评）
  contractId: string;
  startItemsPrompt?: string;   // 开局携带物品·生成提示词
  startItems?: any[];          // 已生成的携带物品（确认开局入库）
  companionsPrompt?: string;   // 开局随行人物·生成提示词
  companions?: any[];          // 已生成的随行随从（确认开局在场入队）
}

const DIFFICULTIES: { key: string; points: number; desc: string }[] = [
  { key: '简单',     points: 50, desc: '50 属性点 · 天赋异禀的强者起点' },
  { key: '普通',     points: 40, desc: '40 属性点 · 标准轮回者' },
  { key: '困难',     points: 30, desc: '30 属性点 · 平凡却坚韧' },
  { key: '绝望',     points: 20, desc: '20 属性点 · 先天不足，步步惊心' },
  { key: '无用之人', points: 10, desc: '10 属性点 · 几乎一无所长的废柴开局' },
];

const PARADISES = ['轮回乐园', '死亡乐园', '圣域乐园', '天启乐园', '圣光乐园', '曙光乐园', '守望乐园', '自定义'];
const GENDERS = ['男', '女', '其他'];
const RACES = ['人类', '精灵', '兽人', '妖族', '龙族', '不死族', '机械体', '神祇', '自定义'];
const TALENT_RARITIES = ['D', 'C', 'B', 'A', 'S', 'SS', 'SSS', '负面'];   // 天赋评级（与正文固定格式一致）
const TALENT_CATEGORIES = ['属性类', '特殊异能类', '能量类', '技巧类'];   // 天赋类型（不可重复类型约束）

const ATTRS: { key: keyof CreationData['attrs']; label: string }[] = [
  { key: 'str', label: '力量' }, { key: 'agi', label: '敏捷' }, { key: 'con', label: '体质' },
  { key: 'int', label: '智力' }, { key: 'cha', label: '魅力' }, { key: 'luck', label: '幸运' },
];
const ATTR_MAX = 10;

export default function CharacterCreation({ onConfirm, onCancel, onGenItems, onGenCompanions }: {
  onConfirm: (d: CreationData) => void;
  onCancel: () => void;
  onGenItems?: (prompt: string, ctx: CreationData) => Promise<any[]>;        // 携带物品·走物品演化 API 生成
  onGenCompanions?: (prompt: string, ctx: CreationData) => Promise<any[]>;   // 随行人物·走 NPC 演化 API 生成
}) {
  const [phase, setPhase] = useState<'form' | 'confirm'>('form');
  const [difficulty, setDifficulty] = useState('普通');
  const [paradise, setParadise] = useState('轮回乐园');
  const [paradiseCustom, setParadiseCustom] = useState('');
  const [gender, setGender] = useState('男');
  const [genderCustom, setGenderCustom] = useState('');
  const [race, setRace] = useState('人类');
  const [raceCustom, setRaceCustom] = useState('');
  const [raceDetail, setRaceDetail] = useState('');
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [personality, setPersonality] = useState('');
  const [personalityDetail, setPersonalityDetail] = useState('');
  const [prevProfession, setPrevProfession] = useState('');
  const [appearance, setAppearance] = useState('');
  const [attrs, setAttrs] = useState({ str: 0, agi: 0, con: 0, int: 0, cha: 0, luck: 0 });
  const [talentName, setTalentName] = useState('');
  const [talentEffect, setTalentEffect] = useState('');
  const [talentRarity, setTalentRarity] = useState('C');
  const [talentCategory, setTalentCategory] = useState('特殊异能类');
  const [talentLevel, setTalentLevel] = useState('');
  const [talentSource, setTalentSource] = useState('开局自带');
  const [talentAttrBonus, setTalentAttrBonus] = useState('');
  const [talentDesc, setTalentDesc] = useState('');
  const [contractId, setContractId] = useState('');
  // 开局携带物品 / 随行人物（提示词 + 生成结果预览；生成走物品演化 / NPC演化 API）
  const [startItemsPrompt, setStartItemsPrompt] = useState('');
  const [startItems, setStartItems] = useState<any[]>([]);
  const [companionsPrompt, setCompanionsPrompt] = useState('');
  const [companions, setCompanions] = useState<any[]>([]);
  const [genItemsBusy, setGenItemsBusy] = useState(false);
  const [genCompBusy, setGenCompBusy] = useState(false);
  const [genMsg, setGenMsg] = useState('');   // 生成状态/错误提示
  // 模板
  const templates = useCreationTemplates((s) => s.templates);
  const addTemplate = useCreationTemplates((s) => s.addTemplate);
  const removeTemplate = useCreationTemplates((s) => s.removeTemplate);
  const [tplMode, setTplMode] = useState<'none' | 'save' | 'import'>('none');
  const [tplName, setTplName] = useState('');
  // 创意工坊·自定义内容库（乐园/种族/天赋）
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const customParadises = useCreationContent((s) => s.paradises);
  const customRaces = useCreationContent((s) => s.races);
  const customTalents = useCreationContent((s) => s.talents);
  const addCustomParadise = useCreationContent((s) => s.addParadise);
  const addCustomRace = useCreationContent((s) => s.addRace);
  const addCustomTalent = useCreationContent((s) => s.addTalent);
  const removeCustomParadise = useCreationContent((s) => s.removeParadise);
  const removeCustomRace = useCreationContent((s) => s.removeRace);
  const removeCustomTalent = useCreationContent((s) => s.removeTalent);

  function currentData(): CreationTemplateData {
    return { difficulty, paradise, paradiseCustom, name, gender, genderCustom, race, raceCustom, raceDetail, age, personality, personalityDetail, prevProfession, appearance, attrs: { ...attrs }, talentName, talentEffect, talentRarity, talentCategory, talentLevel, talentSource, talentAttrBonus, talentDesc, contractId, startItemsPrompt, startItems, companionsPrompt, companions };
  }
  function loadTemplate(d: CreationTemplateData) {
    setDifficulty(d.difficulty); setParadise(d.paradise); setParadiseCustom(d.paradiseCustom ?? '');
    setName(d.name ?? ''); setAge(d.age ?? ''); setPersonality(d.personality ?? ''); setPersonalityDetail(d.personalityDetail ?? ''); setPrevProfession(d.prevProfession ?? '');
    setGender(d.gender ?? '男'); setGenderCustom(d.genderCustom ?? '');
    setRace(d.race ?? '人类'); setRaceCustom(d.raceCustom ?? ''); setRaceDetail(d.raceDetail ?? '');
    setAppearance(d.appearance ?? '');
    setAttrs(d.attrs ? { ...d.attrs } : { str: 0, agi: 0, con: 0, int: 0, cha: 0, luck: 0 });
    setTalentName(d.talentName ?? ''); setTalentEffect(d.talentEffect ?? '');
    setTalentRarity(d.talentRarity ?? 'C'); setTalentCategory(d.talentCategory ?? '特殊异能类'); setTalentLevel(d.talentLevel ?? ''); setTalentSource(d.talentSource ?? '开局自带'); setTalentAttrBonus(d.talentAttrBonus ?? ''); setTalentDesc(d.talentDesc ?? '');
    setContractId(d.contractId ?? '');
    setStartItemsPrompt(d.startItemsPrompt ?? ''); setStartItems(Array.isArray(d.startItems) ? d.startItems : []);
    setCompanionsPrompt(d.companionsPrompt ?? ''); setCompanions(Array.isArray(d.companions) ? d.companions : []);
    setTplMode('none');
  }

  const totalPoints = DIFFICULTIES.find((d) => d.key === difficulty)!.points;
  const used = Object.values(attrs).reduce((a, b) => a + b, 0);
  const remaining = totalPoints - used;
  const resolvedParadise = paradise === '自定义' ? (paradiseCustom.trim() || '自定义乐园') : paradise;
  const resolvedGender = gender === '其他' ? (genderCustom.trim() || '其他') : gender;
  const resolvedRace = race === '自定义' ? (raceCustom.trim() || '自定义种族') : race;

  const setAttr = (k: keyof typeof attrs, v: number) => {
    const clamped = Math.max(0, Math.min(ATTR_MAX, v));
    const delta = clamped - attrs[k];
    if (delta > remaining) return; // 不够分
    setAttrs((a) => ({ ...a, [k]: clamped }));
  };

  const data: CreationData = {
    difficulty, points: totalPoints, paradise: resolvedParadise,
    name: name.trim() || '无名者', gender: resolvedGender, race: resolvedRace, raceDetail: raceDetail.trim(),
    age: age.trim(), personality: personality.trim(), personalityDetail: personalityDetail.trim(),
    prevProfession: prevProfession.trim(), appearance: appearance.trim(), attrs, talentName: talentName.trim(), talentEffect: talentEffect.trim(),
    talentRarity: talentRarity.trim(), talentCategory: talentCategory.trim(), talentLevel: talentLevel.trim(), talentSource: talentSource.trim(), talentAttrBonus: talentAttrBonus.trim(), talentDesc: talentDesc.trim(),
    contractId: contractId.trim(),
    startItemsPrompt: startItemsPrompt.trim(), startItems, companionsPrompt: companionsPrompt.trim(), companions,
  };

  async function doGenItems() {
    if (!onGenItems || genItemsBusy) return;
    const p = startItemsPrompt.trim();
    if (!p) { setGenMsg('请先填写「携带物品」的提示词'); return; }
    setGenItemsBusy(true); setGenMsg('🎒 正在按物品演化 API 生成携带物品…');
    try { const arr = await onGenItems(p, data); setStartItems(arr); setGenMsg(arr.length ? `✓ 已生成 ${arr.length} 件携带物品（可重新生成/逐件删除）` : '未生成到物品，调整提示词后重试'); }
    catch (e: any) { setGenMsg('❌ 携带物品生成失败：' + (e?.message ?? e)); }
    finally { setGenItemsBusy(false); }
  }
  async function doGenCompanions() {
    if (!onGenCompanions || genCompBusy) return;
    const p = companionsPrompt.trim();
    if (!p) { setGenMsg('请先填写「随行人物」的提示词'); return; }
    setGenCompBusy(true); setGenMsg('🧑‍🤝‍🧑 正在按 NPC 演化 API 生成随行人物…');
    try { const arr = await onGenCompanions(p, data); setCompanions(arr); setGenMsg(arr.length ? `✓ 已生成 ${arr.length} 名随行人物（开局在场·可重新生成/逐个删除）` : '未生成到人物，调整提示词后重试'); }
    catch (e: any) { setGenMsg('❌ 随行人物生成失败：' + (e?.message ?? e)); }
    finally { setGenCompBusy(false); }
  }

  /* ── 确认表 ── */
  if (phase === 'confirm') {
    const rows: [string, string][] = [
      ['游戏难度', `${difficulty}（${totalPoints} 属性点）`],
      ['所属乐园', resolvedParadise],
      ['姓名', data.name],
      ['年龄', age || '—'],
      ['性别', resolvedGender],
      ['种族', resolvedRace],
      ['种族详情', raceDetail.trim() || '—'],
      ['性格', personality || '—'],
      ['性格描述', personalityDetail.trim() || '—'],
      ['主角背景', prevProfession || '—'],
      ['基底外观', appearance || '（未填）'],
      ['契约者ID', contractId.trim() || '（随机分配）'],
      ['六维属性', ATTRS.map((a) => `${a.label}${attrs[a.key]}`).join(' / ') + `（已用 ${used}/${totalPoints}）`],
      ['天赋', formatCreationTalent(data) || '（无）'],
      ['携带物品', startItems.length ? startItems.map((it) => (typeof it?.name === 'string' ? it.name : '物品')).join('、') : '（无）'],
      ['随行人物', companions.length ? companions.map((c) => (typeof c?.name === 'string' ? c.name : '随从')).join('、') : '（无）'],
    ];
    return (
      <Shell title="最终确认" subtitle="请核对你的开局设定，确认后将写入档案并开始故事">
        <div className="border border-edge rounded-xl overflow-hidden">
          {rows.map(([k, v], i) => (
            <div key={k} className={`flex gap-3 px-4 py-2.5 text-sm ${i % 2 ? 'bg-panel/40' : 'bg-panel/70'}`}>
              <span className="w-24 shrink-0 text-dim/60 font-mono text-xs pt-0.5">{k}</span>
              <span className="flex-1 text-slate-200 leading-relaxed">{v}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={() => setPhase('form')} className="flex-1 py-2.5 rounded-lg border border-edge text-dim hover:text-slate-200 hover:border-god/40 transition-colors text-sm">← 返回修改</button>
          <button onClick={() => onConfirm(data)} className="flex-[2] py-2.5 rounded-lg bg-god/20 border border-god/50 text-god font-bold hover:bg-god/30 transition-colors text-sm">确认 · 进入{resolvedParadise}</button>
        </div>
      </Shell>
    );
  }

  /* ── 表单 ── */
  return (
    <Shell title="角色创建" subtitle="设定你的轮回者，确认后将直接写入主角档案">
      {/* 模板栏 */}
      <div className="border border-edge rounded-xl p-3 bg-panel/40 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-dim/60 flex-1">📁 模板：把当前设定存起来复用，或导入已存模板</span>
          <button onClick={() => { setTplName(name || ''); setTplMode(tplMode === 'save' ? 'none' : 'save'); }}
            className="px-2.5 py-1 text-[12px] font-mono border border-god/40 text-god rounded hover:bg-god/10 transition-colors">💾 存为模板</button>
          <button onClick={() => setTplMode(tplMode === 'import' ? 'none' : 'import')}
            className="px-2.5 py-1 text-[12px] font-mono border border-edge text-dim rounded hover:border-god/40 hover:text-god transition-colors">📥 导入模板{templates.length > 0 ? `（${templates.length}）` : ''}</button>
          <button onClick={() => setWorkshopOpen(true)}
            className="px-2.5 py-1 text-[12px] font-mono border border-god/40 text-god rounded hover:bg-god/10 transition-colors">🧩 创意工坊</button>
        </div>
        {tplMode === 'save' && (
          <div className="flex gap-2">
            <input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="模板名称（同名覆盖）"
              className="flex-1 bg-void border border-edge rounded px-2 py-1 text-sm text-slate-200 outline-none focus:border-god/50" />
            <button onClick={() => { addTemplate(tplName, currentData()); setTplMode('none'); }}
              className="px-3 py-1 text-sm font-mono border border-god/50 text-god rounded hover:bg-god/10">保存</button>
          </div>
        )}
        {tplMode === 'import' && (
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {templates.length === 0 && <div className="text-[12px] text-dim/40 py-2 text-center">还没有保存的模板</div>}
            {templates.map((t) => (
              <div key={t.id} className="flex items-center gap-2 bg-void/40 border border-edge/60 rounded px-2.5 py-1.5">
                <span className="flex-1 text-[13px] text-slate-200 truncate">{t.name}</span>
                <span className="text-[10px] font-mono text-dim/40">{t.data.difficulty}·{t.data.paradise === '自定义' ? (t.data.paradiseCustom || '自定义') : t.data.paradise}</span>
                <button onClick={() => loadTemplate(t.data)} className="text-[12px] font-mono text-god/80 hover:text-god">使用</button>
                <button onClick={() => removeTemplate(t.id)} className="text-[12px] font-mono text-blood/50 hover:text-blood">删</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Section n={1} title="游戏难度（决定可分配属性点）">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {DIFFICULTIES.map((d) => (
            <button key={d.key} onClick={() => setDifficulty(d.key)}
              className={`text-left px-3 py-2 rounded-lg border transition-colors ${difficulty === d.key ? 'border-god/60 bg-god/10' : 'border-edge hover:border-god/30'}`}>
              <div className="text-sm font-semibold text-slate-100">{d.key}</div>
              <div className="text-[11px] text-dim/60">{d.desc}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section n={2} title="选择进入的乐园">
        <div className="flex flex-wrap gap-2">
          {PARADISES.map((p) => (
            <button key={p} onClick={() => setParadise(p)}
              className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${paradise === p ? 'border-god/60 bg-god/10 text-god' : 'border-edge text-dim hover:border-god/30'}`}>
              {p}
            </button>
          ))}
          {customParadises.map((p) => (
            <span key={p.id} className={`inline-flex items-center rounded-lg border text-sm transition-colors ${paradise === p.name ? 'border-god/60 bg-god/10 text-god' : 'border-edge text-dim hover:border-god/30'}`}>
              <button onClick={() => setParadise(p.name)} title={p.desc || '自定义乐园'} className="pl-3 pr-1.5 py-1.5">🏝{p.name}</button>
              <button onClick={() => removeCustomParadise(p.id)} title="删除" className="pr-2 text-dim/40 hover:text-blood">×</button>
            </span>
          ))}
        </div>
        {paradise === '自定义' && (
          <div className="flex gap-2">
            <input value={paradiseCustom} onChange={(e) => setParadiseCustom(e.target.value)} placeholder="输入自定义乐园名称…"
              className="flex-1 bg-void border border-edge rounded px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-god/50" />
            {paradiseCustom.trim() && (
              <button onClick={() => { addCustomParadise({ name: paradiseCustom.trim() }); }} title="存入自定义库（之后可上传分享/复用）"
                className="shrink-0 px-2.5 py-1.5 text-[12px] font-mono border border-god/40 text-god rounded hover:bg-god/10 transition-colors">＋存为自定义</button>
            )}
          </div>
        )}
      </Section>

      <Section n={3} title="主角基本信息">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Labeled label="姓名"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="主角姓名" className={inputCls} /></Labeled>
          <Labeled label="年龄"><input value={age} onChange={(e) => setAge(e.target.value)} placeholder="如 23 岁" className={inputCls} /></Labeled>
          <Labeled label="性格"><input value={personality} onChange={(e) => setPersonality(e.target.value)} placeholder="如 冷静、谨慎、重情义" className={inputCls} /></Labeled>
          <Labeled label="主角背景"><input value={prevProfession} onChange={(e) => setPrevProfession(e.target.value)} placeholder="进入乐园前的身份/经历，如 退伍军人 / 急诊医生 / 大学生" className={inputCls} /></Labeled>
          <Labeled label="契约者ID"><input value={contractId} onChange={(e) => setContractId(e.target.value)} placeholder="留空＝由乐园随机分配" className={inputCls} /></Labeled>
        </div>

        <div className="mt-2">
          <Labeled label="性格描述（选填·自由展开：成长经历 / 价值观 / 行为模式 / 软肋与执念等，越详细 AI 越贴合人设）">
            <textarea value={personalityDetail} onChange={(e) => setPersonalityDetail(e.target.value)} rows={3}
              placeholder="如：表面吊儿郎当、爱用玩笑搪塞，实则极度谨慎，凡事先想退路；幼年寄人篱下养成的察言观色让他善于读人，却也难以真正信任谁；唯独对认定的伙伴会不计代价。"
              className={`${inputCls} resize-y leading-relaxed`} />
          </Labeled>
        </div>

        {/* 性别（影响生图：男→1boy / 女→1girl，避免马尾等特征被 AI 误判性别） */}
        <div className="mt-2">
          <Labeled label="性别（影响生图：男→1boy / 女→1girl，避免马尾等特征被误判）">
            <div className="flex flex-wrap items-center gap-2">
              {GENDERS.map((g) => (
                <button key={g} onClick={() => setGender(g)}
                  className={`px-4 py-1.5 rounded-lg border text-sm transition-colors ${gender === g ? 'border-god/60 bg-god/10 text-god' : 'border-edge text-dim hover:border-god/30'}`}>
                  {g}
                </button>
              ))}
              {gender === '其他' && (
                <input value={genderCustom} onChange={(e) => setGenderCustom(e.target.value)} placeholder="自定义性别…"
                  className={`${inputCls} flex-1 min-w-[8rem]`} />
              )}
            </div>
          </Labeled>
        </div>

        {/* 种族 + 种族详情自定义框 */}
        <div className="mt-2 space-y-2">
          <Labeled label="种族">
            <div className="flex flex-wrap gap-2">
              {RACES.map((r) => (
                <button key={r} onClick={() => setRace(r)}
                  className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${race === r ? 'border-god/60 bg-god/10 text-god' : 'border-edge text-dim hover:border-god/30'}`}>
                  {r}
                </button>
              ))}
              {customRaces.map((r) => (
                <span key={r.id} className={`inline-flex items-center rounded-lg border text-sm transition-colors ${race === r.name ? 'border-god/60 bg-god/10 text-god' : 'border-edge text-dim hover:border-god/30'}`}>
                  <button onClick={() => { setRace(r.name); if (r.detail) setRaceDetail(r.detail); }} title={r.detail || '自定义种族'} className="pl-3 pr-1.5 py-1.5">🧝{r.name}</button>
                  <button onClick={() => removeCustomRace(r.id)} title="删除" className="pr-2 text-dim/40 hover:text-blood">×</button>
                </span>
              ))}
            </div>
          </Labeled>
          {race === '自定义' && (
            <input value={raceCustom} onChange={(e) => setRaceCustom(e.target.value)} placeholder="输入自定义种族名称…" className={inputCls} />
          )}
          {race === '自定义' && raceCustom.trim() && (
            <button onClick={() => addCustomRace({ name: raceCustom.trim(), detail: raceDetail.trim() })} title="把当前种族名+详情存入自定义库（之后可上传分享/复用）"
              className="px-2.5 py-1.5 text-[12px] font-mono border border-god/40 text-god rounded hover:bg-god/10 transition-colors">＋存为自定义种族</button>
          )}
          <Labeled label="种族详情（选填·自由填写：外貌特征 / 天生能力 / 弱点 / 文化等，越详细 AI 越贴合）">
            <textarea value={raceDetail} onChange={(e) => setRaceDetail(e.target.value)} rows={3}
              placeholder="如：吸血鬼一族——苍白肌肤、赤色竖瞳、犬齿尖利；夜视、迅捷、伤口速愈；惧强光与圣物，需定期饮血维系神智。"
              className={`${inputCls} resize-y leading-relaxed`} />
          </Labeled>
        </div>

        <div className="mt-2">
          <Labeled label="基底外观（不可变·生图基准）">
            <textarea value={appearance} onChange={(e) => setAppearance(e.target.value)} rows={3}
              placeholder="主角最底层的长相基准，开局设定后不再改变，生图时始终包含。如：黑色短发、琥珀色瞳、左眉有疤、身形精瘦、约178cm。建议写发型发色/瞳色/脸型/体型/标志性特征等长期不变的部分。"
              className={`${inputCls} resize-y leading-relaxed`} />
          </Labeled>
        </div>
      </Section>

      <Section n={4} title="属性分配（六维，每项 ≤ 10）">
        <div className={`text-xs font-mono mb-1 ${remaining < 0 ? 'text-blood' : 'text-god/80'}`}>
          剩余可分配点数：{remaining} / {totalPoints}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ATTRS.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2 bg-void/40 border border-edge rounded-lg px-3 py-1.5">
              <span className="w-10 text-sm text-dim/70">{label}</span>
              <button onClick={() => setAttr(key, attrs[key] - 1)} className="w-6 h-6 rounded border border-edge text-dim hover:text-god hover:border-god/40">−</button>
              <input value={attrs[key]} onChange={(e) => setAttr(key, parseInt(e.target.value) || 0)}
                className="w-12 bg-void border border-edge rounded text-center text-sm font-mono text-god outline-none focus:border-god/50" />
              <button onClick={() => setAttr(key, attrs[key] + 1)} className="w-6 h-6 rounded border border-edge text-dim hover:text-god hover:border-god/40">＋</button>
              <span className="text-[10px] text-dim/30 font-mono ml-auto">/{ATTR_MAX}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section n={5} title="天赋设定（固定格式·自填）">
        {customTalents.length > 0 && (
          <Labeled label="自定义/工坊天赋（点击填入名称+效果）">
            <div className="flex flex-wrap gap-2">
              {customTalents.map((t) => (
                <span key={t.id} className={`inline-flex items-center rounded-lg border text-sm transition-colors ${talentName === t.name ? 'border-god/60 bg-god/10 text-god' : 'border-edge text-dim hover:border-god/30'}`}>
                  <button onClick={() => { setTalentName(t.name); setTalentEffect(t.effect ?? ''); setTalentDesc(t.desc ?? ''); setTalentRarity(t.rarity || 'C'); setTalentCategory(t.category || '特殊异能类'); setTalentLevel(t.level ?? ''); setTalentSource(t.source || '开局自带'); setTalentAttrBonus(t.attrBonus ?? ''); }} title={t.effect || ''} className="pl-3 pr-1.5 py-1.5">🧬{t.name}</button>
                  <button onClick={() => removeCustomTalent(t.id)} title="删除" className="pr-2 text-dim/40 hover:text-blood">×</button>
                </span>
              ))}
            </div>
          </Labeled>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="天赋名称"><input value={talentName} onChange={(e) => setTalentName(e.target.value)} placeholder="如 不死之身 / 过目不忘" className={inputCls} /></Labeled>
          <Labeled label="评级（D~SSS）"><select value={talentRarity} onChange={(e) => setTalentRarity(e.target.value)} className={inputCls}>{TALENT_RARITIES.map((r) => <option key={r} value={r}>{r === '负面' ? '负面' : r + '级'}</option>)}</select></Labeled>
          <Labeled label="类型"><select value={talentCategory} onChange={(e) => setTalentCategory(e.target.value)} className={inputCls}>{TALENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Labeled>
          <Labeled label="等级（可空）"><input value={talentLevel} onChange={(e) => setTalentLevel(e.target.value)} placeholder="如 觉醒·Lv.1 / 一阶" className={inputCls} /></Labeled>
          <Labeled label="来源 / 觉醒方式"><input value={talentSource} onChange={(e) => setTalentSource(e.target.value)} placeholder="如 开局自带 / 血脉传承" className={inputCls} /></Labeled>
          <Labeled label="属性加成（可空）"><input value={talentAttrBonus} onChange={(e) => setTalentAttrBonus(e.target.value)} placeholder="如 力量+10、智力+15%" className={inputCls} /></Labeled>
        </div>
        <Labeled label="效果"><textarea value={talentEffect} onChange={(e) => setTalentEffect(e.target.value)} rows={3} placeholder="描述这个天赋的具体效果（尽量写数值/机制）…" className={inputCls + ' resize-y'} /></Labeled>
        <Labeled label="简描（可空·flavor / 点评）"><textarea value={talentDesc} onChange={(e) => setTalentDesc(e.target.value)} rows={2} placeholder="一句话点评 / 寓言风描述（可空）…" className={inputCls + ' resize-y'} /></Labeled>
        {talentName.trim() && (
          <div className="rounded-lg border border-god/20 bg-god/5 px-3 py-2 text-[12px] text-dim/80 font-mono leading-relaxed break-all">
            <span className="text-god/60">固定格式预览：</span>{formatCreationTalent(data)}
          </div>
        )}
        {talentName.trim() && (
          <button onClick={() => addCustomTalent({ name: talentName.trim(), effect: talentEffect.trim(), desc: talentDesc.trim(), rarity: talentRarity.trim(), category: talentCategory.trim(), level: talentLevel.trim(), source: talentSource.trim(), attrBonus: talentAttrBonus.trim() })} title="把当前天赋（全部固定格式字段）存入自定义库（之后可上传分享/复用）"
            className="px-2.5 py-1.5 text-[12px] font-mono border border-god/40 text-god rounded hover:bg-god/10 transition-colors">＋存为自定义天赋</button>
        )}
      </Section>

      <Section n={6} title="开局携带物品（可选 · 物品演化 API 生成）">
        <Labeled label="携带物品 · 提示词（想开局带什么，写清数量/品质/类型即可）">
          <textarea value={startItemsPrompt} onChange={(e) => setStartItemsPrompt(e.target.value)} rows={2}
            placeholder="如：一把家传的生锈铁剑、三瓶止血药、一枚刻着家徽的银戒指…（留空则不携带）" className={inputCls + ' resize-y'} />
        </Labeled>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={doGenItems} disabled={genItemsBusy || !onGenItems || !startItemsPrompt.trim()}
            className="px-3 py-1.5 text-[13px] font-mono border border-god/40 text-god rounded hover:bg-god/10 disabled:opacity-40 transition-colors">
            {genItemsBusy ? '⏳ 生成中…' : (startItems.length ? '🔄 重新生成' : '🎒 生成携带物品')}</button>
          {startItems.length > 0 && <button onClick={() => setStartItems([])} className="px-2.5 py-1.5 text-[12px] font-mono border border-edge text-dim rounded hover:border-blood/40 hover:text-blood">清空</button>}
          <span className="text-[11px] text-dim/40 font-mono">走「物品演化」API · 确认开局即入背包</span>
        </div>
        {startItems.length > 0 && (
          <div className="space-y-1.5 mt-1">
            {startItems.map((it, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-edge/50 bg-void/40 px-2.5 py-1.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-slate-200">📦 {typeof it?.name === 'string' ? it.name : '物品'}
                    {typeof it?.gradeDesc === 'string' && it.gradeDesc && <span className="text-[11px] text-dim/50 ml-1.5">{it.gradeDesc}</span>}
                    {typeof it?.category === 'string' && it.category && <span className="text-[11px] text-dim/40 ml-1.5">{it.category}{typeof it?.subType === 'string' && it.subType ? '·' + it.subType : ''}</span>}</div>
                  {typeof it?.combatStat === 'string' && it.combatStat && <div className="text-[11.5px] text-amber-300/70 font-mono leading-snug">{it.combatStat}</div>}
                  {typeof it?.effect === 'string' && it.effect && <div className="text-[11.5px] text-dim/55 leading-snug break-all">{it.effect.slice(0, 90)}</div>}
                </div>
                <button onClick={() => setStartItems((a) => a.filter((_, j) => j !== i))} title="删除" className="shrink-0 text-dim/40 hover:text-blood text-sm">×</button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section n={7} title="开局随行人物（可选 · NPC 演化 API 生成 · 开局在场随从）">
        <Labeled label="随行人物 · 提示词（想要什么样的同伴，写清身份/性格/强度）">
          <textarea value={companionsPrompt} onChange={(e) => setCompanionsPrompt(e.target.value)} rows={2}
            placeholder="如：一个沉默寡言的护卫剑客，一阶、忠诚；一个古灵精怪的少女法师，二阶、话痨…（留空则无随从）" className={inputCls + ' resize-y'} />
        </Labeled>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={doGenCompanions} disabled={genCompBusy || !onGenCompanions || !companionsPrompt.trim()}
            className="px-3 py-1.5 text-[13px] font-mono border border-god/40 text-god rounded hover:bg-god/10 disabled:opacity-40 transition-colors">
            {genCompBusy ? '⏳ 生成中…' : (companions.length ? '🔄 重新生成' : '🧑‍🤝‍🧑 生成随行人物')}</button>
          {companions.length > 0 && <button onClick={() => setCompanions([])} className="px-2.5 py-1.5 text-[12px] font-mono border border-edge text-dim rounded hover:border-blood/40 hover:text-blood">清空</button>}
          <span className="text-[11px] text-dim/40 font-mono">走「NPC演化」API · 确认开局即在场入队</span>
        </div>
        {companions.length > 0 && (
          <div className="space-y-1.5 mt-1">
            {companions.map((c, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-edge/50 bg-void/40 px-2.5 py-1.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-slate-200">🧑 {typeof c?.name === 'string' ? c.name : '随从'}
                    {typeof c?.realm === 'string' && c.realm && <span className="text-[11px] text-god/60 ml-1.5">{c.realm}</span>}
                    {typeof c?.gender === 'string' && c.gender && <span className="text-[11px] text-dim/40 ml-1.5">{c.gender}</span>}</div>
                  {typeof c?.personality === 'string' && c.personality && <div className="text-[11.5px] text-dim/60 leading-snug">{c.personality.slice(0, 60)}</div>}
                  {typeof c?.background === 'string' && c.background && <div className="text-[11.5px] text-dim/45 leading-snug break-all">{c.background.slice(0, 100)}</div>}
                </div>
                <button onClick={() => setCompanions((a) => a.filter((_, j) => j !== i))} title="删除" className="shrink-0 text-dim/40 hover:text-blood text-sm">×</button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {genMsg && <div className="text-[12px] font-mono text-god/75 px-1 leading-snug">{genMsg}</div>}

      <div className="flex gap-3 pt-1">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-lg border border-edge text-dim hover:text-slate-200 transition-colors text-sm">取消</button>
        <button
          disabled={remaining < 0}
          onClick={() => setPhase('confirm')}
          className={`flex-[2] py-2.5 rounded-lg font-bold text-sm transition-colors ${remaining < 0 ? 'border border-edge text-dim/40 cursor-not-allowed' : 'bg-god/20 border border-god/50 text-god hover:bg-god/30'}`}>
          {remaining < 0 ? '属性点超额，请调整' : '下一步 · 确认设定'}
        </button>
      </div>

      {workshopOpen && (
        <Suspense fallback={null}>
          <WorkshopPanel creationMode onClose={() => setWorkshopOpen(false)} />
        </Suspense>
      )}
    </Shell>
  );
}

const inputCls = 'w-full bg-void border border-edge rounded px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-god/50';

/** 把开局天赋按「正文固定格式」拼成一行（与 structuredRecall 的 talentLine 同款）：
 *  「名」·评级级·类型·等级 — 来源:…；简描；效果:…；属性加成:… 。无 talentName 返回空串。 */
export function formatCreationTalent(d: Pick<CreationData, 'talentName' | 'talentRarity' | 'talentCategory' | 'talentLevel' | 'talentSource' | 'talentEffect' | 'talentAttrBonus' | 'talentDesc'>): string {
  const nm = d.talentName?.trim();
  if (!nm) return '';
  const rar = d.talentRarity ? (d.talentRarity === '负面' ? '·负面' : `·${d.talentRarity}级`) : '';
  const head = `「${nm}」${rar}${d.talentCategory ? `·${d.talentCategory}` : ''}${d.talentLevel ? `·${d.talentLevel}` : ''}`;
  const body = [
    d.talentSource && `来源:${d.talentSource}`,
    d.talentDesc,
    d.talentEffect && `效果:${d.talentEffect}`,
    d.talentAttrBonus && `属性加成:${d.talentAttrBonus}`,
  ].filter(Boolean).join('；');
  return `${head}${body ? ` — ${body}` : ''}`;
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="border border-edge rounded-xl p-4 bg-panel/60 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-5 h-5 flex items-center justify-center rounded-full bg-god/20 text-god text-[11px] font-mono">{n}</span>
        <span className="text-sm font-bold text-slate-100">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-mono text-dim/60">{label}</span>
      {children}
    </label>
  );
}

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-void/95 overflow-y-auto" style={{ fontFamily: 'var(--app-font)' }}>
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        <div className="text-center pb-2">
          <h1 className="text-2xl font-bold text-slate-100">{title}</h1>
          <p className="text-xs text-dim/60 mt-1">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
