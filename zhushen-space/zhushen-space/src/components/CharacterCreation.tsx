import { useState } from 'react';
import { useCreationTemplates, type CreationTemplateData } from '../store/creationTemplateStore';

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
  age: string;
  personality: string;
  prevProfession: string;
  appearance: string;   // 基底外观（不可变，生图始终包含）
  attrs: { str: number; agi: number; con: number; int: number; cha: number; luck: number };
  talentName: string;
  talentEffect: string;
  contractId: string;
}

const DIFFICULTIES: { key: string; points: number; desc: string }[] = [
  { key: '简单',     points: 50, desc: '50 属性点 · 天赋异禀的强者起点' },
  { key: '普通',     points: 40, desc: '40 属性点 · 标准轮回者' },
  { key: '困难',     points: 30, desc: '30 属性点 · 平凡却坚韧' },
  { key: '绝望',     points: 20, desc: '20 属性点 · 先天不足，步步惊心' },
  { key: '无用之人', points: 10, desc: '10 属性点 · 几乎一无所长的废柴开局' },
];

const PARADISES = ['轮回乐园', '死亡乐园', '圣域乐园', '天启乐园', '圣光乐园', '曙光乐园', '守望乐园', '自定义'];

const ATTRS: { key: keyof CreationData['attrs']; label: string }[] = [
  { key: 'str', label: '力量' }, { key: 'agi', label: '敏捷' }, { key: 'con', label: '体质' },
  { key: 'int', label: '智力' }, { key: 'cha', label: '魅力' }, { key: 'luck', label: '幸运' },
];
const ATTR_MAX = 10;

export default function CharacterCreation({ onConfirm, onCancel }: { onConfirm: (d: CreationData) => void; onCancel: () => void }) {
  const [phase, setPhase] = useState<'form' | 'confirm'>('form');
  const [difficulty, setDifficulty] = useState('普通');
  const [paradise, setParadise] = useState('轮回乐园');
  const [paradiseCustom, setParadiseCustom] = useState('');
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [personality, setPersonality] = useState('');
  const [prevProfession, setPrevProfession] = useState('');
  const [appearance, setAppearance] = useState('');
  const [attrs, setAttrs] = useState({ str: 0, agi: 0, con: 0, int: 0, cha: 0, luck: 0 });
  const [talentName, setTalentName] = useState('');
  const [talentEffect, setTalentEffect] = useState('');
  const [contractId, setContractId] = useState('');
  // 模板
  const templates = useCreationTemplates((s) => s.templates);
  const addTemplate = useCreationTemplates((s) => s.addTemplate);
  const removeTemplate = useCreationTemplates((s) => s.removeTemplate);
  const [tplMode, setTplMode] = useState<'none' | 'save' | 'import'>('none');
  const [tplName, setTplName] = useState('');

  function currentData(): CreationTemplateData {
    return { difficulty, paradise, paradiseCustom, name, age, personality, prevProfession, appearance, attrs: { ...attrs }, talentName, talentEffect, contractId };
  }
  function loadTemplate(d: CreationTemplateData) {
    setDifficulty(d.difficulty); setParadise(d.paradise); setParadiseCustom(d.paradiseCustom ?? '');
    setName(d.name ?? ''); setAge(d.age ?? ''); setPersonality(d.personality ?? ''); setPrevProfession(d.prevProfession ?? '');
    setAppearance(d.appearance ?? '');
    setAttrs(d.attrs ? { ...d.attrs } : { str: 0, agi: 0, con: 0, int: 0, cha: 0, luck: 0 });
    setTalentName(d.talentName ?? ''); setTalentEffect(d.talentEffect ?? ''); setContractId(d.contractId ?? '');
    setTplMode('none');
  }

  const totalPoints = DIFFICULTIES.find((d) => d.key === difficulty)!.points;
  const used = Object.values(attrs).reduce((a, b) => a + b, 0);
  const remaining = totalPoints - used;
  const resolvedParadise = paradise === '自定义' ? (paradiseCustom.trim() || '自定义乐园') : paradise;

  const setAttr = (k: keyof typeof attrs, v: number) => {
    const clamped = Math.max(0, Math.min(ATTR_MAX, v));
    const delta = clamped - attrs[k];
    if (delta > remaining) return; // 不够分
    setAttrs((a) => ({ ...a, [k]: clamped }));
  };

  const data: CreationData = {
    difficulty, points: totalPoints, paradise: resolvedParadise,
    name: name.trim() || '无名者', age: age.trim(), personality: personality.trim(),
    prevProfession: prevProfession.trim(), appearance: appearance.trim(), attrs, talentName: talentName.trim(), talentEffect: talentEffect.trim(),
    contractId: contractId.trim(),
  };

  /* ── 确认表 ── */
  if (phase === 'confirm') {
    const rows: [string, string][] = [
      ['游戏难度', `${difficulty}（${totalPoints} 属性点）`],
      ['所属乐园', resolvedParadise],
      ['姓名', data.name],
      ['年龄', age || '—'],
      ['性格', personality || '—'],
      ['主角背景', prevProfession || '—'],
      ['基底外观', appearance || '（未填）'],
      ['契约者ID', contractId.trim() || '（随机分配）'],
      ['六维属性', ATTRS.map((a) => `${a.label}${attrs[a.key]}`).join(' / ') + `（已用 ${used}/${totalPoints}）`],
      ['天赋', talentName ? `「${talentName}」${talentEffect ? '：' + talentEffect : ''}` : '（无）'],
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
        </div>
        {paradise === '自定义' && (
          <input value={paradiseCustom} onChange={(e) => setParadiseCustom(e.target.value)} placeholder="输入自定义乐园名称…"
            className="w-full bg-void border border-edge rounded px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-god/50" />
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

      <Section n={5} title="天赋设定（自填）">
        <Labeled label="天赋名称"><input value={talentName} onChange={(e) => setTalentName(e.target.value)} placeholder="如 不死之身 / 过目不忘" className={inputCls} /></Labeled>
        <Labeled label="天赋效果"><textarea value={talentEffect} onChange={(e) => setTalentEffect(e.target.value)} rows={3} placeholder="描述这个天赋的具体效果（尽量写数值/机制）…" className={inputCls + ' resize-y'} /></Labeled>
      </Section>

      <div className="flex gap-3 pt-1">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-lg border border-edge text-dim hover:text-slate-200 transition-colors text-sm">取消</button>
        <button
          disabled={remaining < 0}
          onClick={() => setPhase('confirm')}
          className={`flex-[2] py-2.5 rounded-lg font-bold text-sm transition-colors ${remaining < 0 ? 'border border-edge text-dim/40 cursor-not-allowed' : 'bg-god/20 border border-god/50 text-god hover:bg-god/30'}`}>
          {remaining < 0 ? '属性点超额，请调整' : '下一步 · 确认设定'}
        </button>
      </div>
    </Shell>
  );
}

const inputCls = 'w-full bg-void border border-edge rounded px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-god/50';

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
