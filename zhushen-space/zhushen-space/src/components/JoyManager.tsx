import { useEffect, useRef, useState } from 'react';
import { useJoy, hydrateJoyPortraits, DEFAULT_GIRLS, JOY_PRIVATE_COLS, type JoyGirl } from '../store/joyStore';
import { shrinkDataUrl } from '../systems/imageGen';
import ApiRoutePicker from './ApiRoutePicker';

/* 欢愉宫配置：美女名册（含看板娘）—— 立绘/人设/迎宾词/对话预设/四阶段递进/初始私密 + 独立 API。
   挂在 设置→变量管理→欢愉宫。属全局配置（走 configExport，立绘存 IndexedDB；情欲值/聊天进度不导出）。*/

const inputCls = 'bg-void border border-edge rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-pink-400/40';
const RACE_EMOJI = (race = ''): string =>
  /蛇/.test(race) ? '🐍' : /魅魔|梦魔|魔/.test(race) ? '😈' : /精灵/.test(race) ? '🧝‍♀️'
  : /青楼|花魁|古/.test(race) ? '🏮' : '💋';

function GirlCard({ girl, onEditPreset }: { girl: JoyGirl; onEditPreset: () => void }) {
  const upsertGirl = useJoy((s) => s.upsertGirl);
  const removeGirl = useJoy((s) => s.removeGirl);
  const setGirlPortrait = useJoy((s) => s.setGirlPortrait);
  const girlCount = useJoy((s) => s.settings.girls.length);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = (p: Partial<JoyGirl>) => upsertGirl({ ...girl, ...p });

  const onFile = async (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try { const shrunk = await shrinkDataUrl(String(reader.result), 1280, 0.85); setGirlPortrait(girl.id, shrunk); }
      catch { setGirlPortrait(girl.id, String(reader.result)); }
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="rounded-xl border border-pink-500/20 bg-panel p-3 flex max-lg:flex-col gap-3">
      <div className="shrink-0 w-24 flex flex-col gap-1.5">
        <div className="w-24 h-32 rounded-lg border border-edge bg-void overflow-hidden flex items-center justify-center">
          {girl.portrait
            ? <img src={girl.portrait} alt={girl.name} className="w-full h-full object-cover" />
            : <span className="text-4xl text-pink-300/30">{RACE_EMOJI(girl.race)}</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        <button onClick={() => fileRef.current?.click()} className="text-[11px] font-mono py-1 rounded border border-edge text-dim hover:text-pink-100 hover:border-pink-400/40">上传立绘</button>
        {girl.portrait && <button onClick={() => setGirlPortrait(girl.id, undefined)} className="text-[11px] font-mono py-0.5 rounded text-blood/60 hover:text-blood">清除</button>}
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <input value={girl.name} onChange={(e) => patch({ name: e.target.value })} placeholder="芳名" className={`${inputCls} flex-1 font-semibold min-w-0`} />
          <input value={girl.race} onChange={(e) => patch({ race: e.target.value })} placeholder="种族" className={`${inputCls} w-24`} />
          {girlCount > 1 && <button onClick={() => removeGirl(girl.id)} className="text-blood/60 hover:text-blood text-sm px-1 shrink-0" title="删除">✕</button>}
        </div>
        <div className="flex items-center gap-2">
          <input value={girl.title ?? ''} onChange={(e) => patch({ title: e.target.value.trim() || undefined })} placeholder="头衔（花魁/女主人…可空）" className={`${inputCls} flex-1 min-w-0`} />
          <label className="flex items-center gap-1.5 text-[12px] text-pink-200/80 cursor-pointer shrink-0 px-1">
            <input type="checkbox" checked={!!girl.isMadam} onChange={(e) => patch({ isMadam: e.target.checked })} className="accent-pink-500" />
            看板娘
          </label>
        </div>
        <textarea value={girl.persona} onChange={(e) => patch({ persona: e.target.value })} rows={2}
          placeholder="性格简介（一句话 · 卡片摘要；详细性格/经历/外观点下方编辑）" className={`${inputCls} w-full resize-none leading-snug`} />
        <button onClick={onEditPreset}
          className="w-full text-left text-[12px] font-mono px-2 py-1.5 rounded-lg border border-pink-500/30 text-pink-200/90 bg-pink-500/5 hover:bg-pink-500/10 transition-colors">
          ✎ 迎宾词 · 对话预设 · 四阶段递进 · 初始私密（点击编辑）
        </button>
        <input value={girl.portraitFolder ?? ''} onChange={(e) => patch({ portraitFolder: e.target.value.trim() || undefined })}
          placeholder="分阶段立绘文件夹名（仓库根 欢愉宫图片/<此名>/阶段1..4/）— 留空用上方单张立绘"
          className={`${inputCls} w-full font-mono text-[12px]`} />
      </div>
    </div>
  );
}

function PresetModal({ girl, onClose }: { girl: JoyGirl; onClose: () => void }) {
  const upsertGirl = useJoy((s) => s.upsertGirl);
  const [personality, setPersonality] = useState(girl.personality ?? '');
  const [background, setBackground] = useState(girl.background ?? '');
  const [appearance, setAppearance] = useState(girl.appearance ?? '');
  const [appellation, setAppellation] = useState(girl.appellation ?? '');
  const [greeting, setGreeting] = useState(girl.greetingPreset ?? '');
  const [chat, setChat] = useState(girl.chatPreset ?? '');
  const [s1, setS1] = useState(girl.stageDesc?.['1'] ?? '');
  const [s2, setS2] = useState(girl.stageDesc?.['2'] ?? '');
  const [s3, setS3] = useState(girl.stageDesc?.['3'] ?? '');
  const [s4, setS4] = useState(girl.stageDesc?.['4'] ?? '');
  const [priv, setPriv] = useState(
    Object.entries(girl.initPrivacy ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'),
  );
  const dflt = DEFAULT_GIRLS.find((d) => d.id === girl.id);

  const save = () => {
    const initPrivacy: Record<string, string> = {};
    for (const line of priv.split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0) { const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim(); if (k && v) initPrivacy[k] = v; }
    }
    upsertGirl({
      ...girl,
      personality: personality.trim() || undefined,
      background: background.trim() || undefined,
      appearance: appearance.trim() || undefined,
      appellation: appellation.trim() || undefined,
      greetingPreset: greeting.trim() || undefined,
      chatPreset: chat.trim() || undefined,
      stageDesc: { '1': s1.trim(), '2': s2.trim(), '3': s3.trim(), '4': s4.trim() },
      initPrivacy: Object.keys(initPrivacy).length ? initPrivacy : undefined,
    });
    onClose();
  };

  const ta = 'w-full bg-void border border-edge rounded-lg px-3 py-2 text-[13px] text-slate-200 leading-relaxed resize-y focus:outline-none focus:border-pink-400/40';

  return (
    <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl rounded-2xl border border-pink-500/30 bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] flex flex-col max-h-[90vh]">
        <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-pink-500/20 bg-panel">
          <span className="text-base">✎</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-pink-100 truncate">{girl.name} · 预设编辑</div>
            <div className="text-[11px] font-mono text-pink-300/50">迎宾词 / 对话风格 / 四阶段递进 / 初始私密</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </header>
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          <div className="text-[12px] font-mono text-pink-300/55">人物档案</div>
          <Field label="性格（详细 · AI 优先采用，留空则用卡片上的性格简介）">
            <textarea value={personality} onChange={(e) => setPersonality(e.target.value)} rows={3} className={ta} />
          </Field>
          <Field label="个人经历 / 身世">
            <textarea value={background} onChange={(e) => setBackground(e.target.value)} rows={3} className={ta} />
          </Field>
          <Field label="外观（容貌 · 身段 · 衣着）">
            <textarea value={appearance} onChange={(e) => setAppearance(e.target.value)} rows={3} className={ta} />
          </Field>
          <Field label="初始称谓（她一开始怎么称呼你；之后随好感度自动演变）">
            <input value={appellation} onChange={(e) => setAppellation(e.target.value)} className={`${inputCls} w-full`} placeholder="如：公子 / 客人 / 小可怜 / 你" />
          </Field>
          <div className="text-[12px] font-mono text-pink-300/55 pt-1">台词 · 演绎</div>
          <Field label="迎宾词（看板娘在大厅的固定招呼）">
            <textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={2} className={ta} placeholder="（仅当她是看板娘时用于大厅迎宾）" />
          </Field>
          <Field label="对话/演绎预设（她在包间陪侍时的口吻与风格）">
            <textarea value={chat} onChange={(e) => setChat(e.target.value)} rows={4} className={`${ta} font-mono`} />
          </Field>
          <div className="text-[12px] font-mono text-pink-300/55 pt-1">四阶段递进（按情欲值注入·语言变化 + 身体变化）</div>
          <Field label="① 25% 以下"><textarea value={s1} onChange={(e) => setS1(e.target.value)} rows={2} className={ta} /></Field>
          <Field label="② 25–50%"><textarea value={s2} onChange={(e) => setS2(e.target.value)} rows={2} className={ta} /></Field>
          <Field label="③ 50–75%"><textarea value={s3} onChange={(e) => setS3(e.target.value)} rows={2} className={ta} /></Field>
          <Field label="④ 75–100%"><textarea value={s4} onChange={(e) => setS4(e.target.value)} rows={2} className={ta} /></Field>
          <Field label={`初始私密字段（每行「字段=值」，可用字段：${JOY_PRIVATE_COLS.map((c) => c.label).join('、')}）`}>
            <textarea value={priv} onChange={(e) => setPriv(e.target.value)} rows={4} className={`${ta} font-mono`} placeholder={'性经验=一片空白\n敏感部位=耳后、腰窝'} />
          </Field>
        </div>
        <footer className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-pink-500/20 bg-panel">
          {dflt && <button onClick={() => { setPersonality(dflt.personality ?? ''); setBackground(dflt.background ?? ''); setAppearance(dflt.appearance ?? ''); setAppellation(dflt.appellation ?? ''); setGreeting(dflt.greetingPreset ?? ''); setChat(dflt.chatPreset ?? ''); setS1(dflt.stageDesc?.['1'] ?? ''); setS2(dflt.stageDesc?.['2'] ?? ''); setS3(dflt.stageDesc?.['3'] ?? ''); setS4(dflt.stageDesc?.['4'] ?? ''); setPriv(Object.entries(dflt.initPrivacy ?? {}).map(([k, v]) => `${k}=${v}`).join('\n')); }}
            className="text-[12px] font-mono py-1.5 px-3 rounded-lg border border-edge text-dim hover:text-slate-100">恢复默认</button>}
          <div className="flex-1" />
          <button onClick={onClose} className="text-[12px] font-mono py-1.5 px-3 rounded-lg border border-edge text-dim hover:text-slate-100">取消</button>
          <button onClick={save} className="text-[13px] font-mono py-1.5 px-4 rounded-lg border border-pink-400/50 text-pink-100 bg-pink-500/15 hover:bg-pink-500/25">保存</button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-mono text-dim/55">{label}</span>
      {children}
    </label>
  );
}

export default function JoyManager() {
  const settings = useJoy((s) => s.settings);
  const setSettings = useJoy((s) => s.setSettings);
  const upsertGirl = useJoy((s) => s.upsertGirl);
  const resetGirls = useJoy((s) => s.resetGirls);

  const joyApi = useJoy((s) => s.joyApi);
  const useShared = useJoy((s) => s.joyUseSharedApi);
  const setApi = useJoy((s) => s.setJoyApi);
  const setShared = useJoy((s) => s.setJoyUseSharedApi);
  const models = useJoy((s) => s.joyAvailableModels);
  const modelsLoading = useJoy((s) => s.joyModelsLoading);
  const modelsError = useJoy((s) => s.joyModelsError);
  const fetchModels = useJoy((s) => s.fetchJoyModels);

  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => { hydrateJoyPortraits(); }, []);

  const addGirl = () => {
    const id = `girl_${Date.now()}`;
    upsertGirl({ id, name: '新姑娘', race: '人类', persona: '', stageDesc: {} });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h3 className="text-lg font-bold text-pink-100">💗 欢愉宫</h3>
        <p className="text-[13px] text-dim/60 mt-1 leading-relaxed">
          成人向角色互动（角色均为成年奇幻种族）。在这里管理「美女 / 看板娘」名册：人设、迎宾词、对话预设、<strong>四阶段递进</strong>（按情欲值变化语言与身体）、初始私密、立绘。
          <br />立绘可<strong>分阶段</strong>：把图（标准 1215×832）放进仓库根 <code className="text-pink-300/80">欢愉宫图片/&lt;美女名/文件夹名&gt;/阶段1~4/</code>，情欲值 &lt;25 用阶段1、&lt;50 阶段2、&lt;75 阶段3、≥75 阶段4，每次对话随机换一张（build/启动自动同步，空阶段就近回退）。
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-pink-500/20 bg-panel px-3 py-2.5">
        <div>
          <div className="text-sm text-slate-200">启用欢愉宫</div>
          <div className="text-[12px] text-dim/55 mt-0.5">关闭后右导航「💗 欢愉宫」入口隐藏</div>
        </div>
        <button onClick={() => setSettings({ enabled: !settings.enabled })}
          className={`shrink-0 w-9 h-5 rounded-full border transition-colors ${settings.enabled ? 'bg-pink-500/40 border-pink-400/50' : 'bg-void border-edge'}`}>
          <div className="w-3 h-3 rounded-full bg-white mx-1 transition-all" style={{ transform: settings.enabled ? 'translateX(16px)' : 'none' }} />
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-200">美女 / 看板娘（{settings.girls.length}）</span>
          <div className="flex items-center gap-2">
            <button onClick={addGirl} className="text-[12px] font-mono py-1 px-2.5 rounded-lg border border-pink-400/40 text-pink-200 hover:bg-pink-500/10">+ 新增</button>
            <button onClick={() => { if (confirm('恢复为 4 位内置看板娘？自定义的美女将被移除（情欲值/聊天进度不动）。')) resetGirls(); }}
              className="text-[12px] font-mono py-1 px-2.5 rounded-lg border border-edge text-dim hover:text-slate-100">恢复默认</button>
          </div>
        </div>
        {settings.girls.map((g) => <GirlCard key={g.id} girl={g} onEditPreset={() => setEditId(g.id)} />)}
      </div>

      <div className="space-y-2.5 rounded-xl border border-pink-500/20 bg-panel p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-200">欢愉宫 AI 接口</span>
          <label className="flex items-center gap-2 text-[12px] text-dim/70 cursor-pointer">
            <input type="checkbox" checked={useShared} onChange={(e) => setShared(e.target.checked)} className="accent-pink-500" />
            复用正文生成 API
          </label>
        </div>
        <ApiRoutePicker routeKey="joy" />
        <p className="text-[11px] font-mono text-dim/50">↑ 选「API 接口库」里的接口（多选·按优先级轮流·失败自动切下一条）。留空则用下方兜底配置。建议选一个尺度宽松的模型。</p>
        {!useShared && (
          <div className="space-y-2">
            <input value={joyApi.baseUrl} onChange={(e) => setApi({ baseUrl: e.target.value })} placeholder="API 地址 (baseUrl)" className={`${inputCls} w-full font-mono`} />
            <input value={joyApi.apiKey} onChange={(e) => setApi({ apiKey: e.target.value })} placeholder="API Key" type="password" className={`${inputCls} w-full font-mono`} />
            <div className="flex items-center gap-2">
              <input value={joyApi.modelId} onChange={(e) => setApi({ modelId: e.target.value })} placeholder="模型 ID" className={`${inputCls} flex-1 font-mono`} list="joy-models" />
              <datalist id="joy-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
              <button onClick={() => fetchModels()} disabled={modelsLoading} className="text-[12px] font-mono py-1 px-2.5 rounded-lg border border-edge text-dim hover:text-slate-100 shrink-0">{modelsLoading ? '…' : '拉取模型'}</button>
            </div>
            {modelsError && <div className="text-[12px] text-blood/70 font-mono">{modelsError}</div>}
          </div>
        )}
        <div className="text-[11px] font-mono text-dim/40 leading-snug">用于包间对话与看板娘迎宾。每轮对话独立调用，不影响正文生成。</div>
      </div>

      {editId && (() => {
        const g = settings.girls.find((x) => x.id === editId);
        return g ? <PresetModal girl={g} onClose={() => setEditId(null)} /> : null;
      })()}
    </div>
  );
}
