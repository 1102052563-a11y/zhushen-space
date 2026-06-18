import { useRef, useState } from 'react';
import { useCosmos, extractCosmosPresetFromJson, type CosmosPresetEntry } from '../store/cosmosStore';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { apiChatFallback } from '../systems/apiChat';
import ApiRoutePicker from './ApiRoutePicker';

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className={`shrink-0 w-9 h-5 rounded-full border transition-colors ${checked ? 'bg-god/30 border-god/50' : 'bg-void border-edge'}`}>
      <div className="w-3 h-3 rounded-full bg-white mx-1 transition-all" style={{ transform: checked ? 'translateX(16px)' : 'none' }} />
    </button>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><label className="text-sm text-dim font-mono">{label}</label>{children}</div>;
}

function EntryRow({ entry }: { entry: CosmosPresetEntry }) {
  const toggle = useCosmos((s) => s.togglePresetEntry);
  const update = useCosmos((s) => s.updatePresetEntry);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState(entry.content);
  return (
    <div className={`px-3 py-2 ${!entry.enabled ? 'opacity-40' : ''}`}>
      <div className="flex items-center gap-2">
        <Toggle checked={entry.enabled} onChange={() => toggle(entry.identifier)} />
        <span className="flex-1 text-sm text-slate-300 truncate font-mono">{entry.name}</span>
        <span className="text-[11px] font-mono text-dim/40 shrink-0">{Math.round(entry.content.length / 3.5)}t</span>
        <button onClick={() => { setOpen(!open); setContent(entry.content); }} className="text-[12px] font-mono text-dim/50 hover:text-god transition-colors shrink-0">{open ? '收起' : '编辑'}</button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={10}
            className="w-full bg-void border border-edge rounded px-2 py-1.5 text-[13px] font-mono text-slate-200 outline-none focus:border-god leading-relaxed resize-y" />
          <div className="flex justify-end">
            <button onClick={() => { update(entry.identifier, { content }); setOpen(false); }}
              className="px-3 py-1 text-[13px] font-mono border border-god/40 text-god rounded hover:bg-god/10 transition-colors">保存</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 种子区：忠于原著 / 随机生成 / 空白 ── */
function SeedSection() {
  const settings = useCosmos((s) => s.settings);
  const setSettings = useCosmos((s) => s.setSettings);
  const seedFromCanon = useCosmos((s) => s.seedFromCanon);
  const seedEntities = useCosmos((s) => s.seedEntities);
  const clearCosmos = useCosmos((s) => s.clearCosmos);
  const dedupeEntities = useCosmos((s) => s.dedupeEntities);
  const count = useCosmos((s) => s.entities.length);
  const useShared = useCosmos((s) => s.cosmosUseSharedApi);
  const cosmosApi = useCosmos((s) => s.cosmosApi);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 5000); }

  async function genRandom() {
    if (busy) return;
    const ss = useSettings.getState();
    const legacy = useShared ? (ss.textUseSharedApi ? ss.api : ss.textApi) : cosmosApi;
    const chain = resolveApiChain('cosmos', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { flash('❌ 未配置 API（去 API 设置填写或选路由）'); return; }
    setBusy(true); flash('🎲 正在生成宇宙棋盘…');
    const theme = settings.seedTheme.trim() || '轮回乐园式无限流（七乐园争霸 + 虚空万族 + 深渊反派）';
    const sys = `你是世界观生成器。按题材「${theme}」生成一套【宇宙宏观大阵营花名册】（20~30 个宏观势力，分 6 类：乐园/种族/文明组织/原生世界/神灵/深渊）。
要求：有强弱排名（顶层阵营给 rank）、有兴衰动态（几个处于扩张/复苏/衰退/濒临覆灭）、要有一个反派根源体系（深渊类）、阵营间关系交织。
**只输出一个 JSON 对象**，不要任何解释/markdown：
{"entities":[{"name":"中文名","category":"乐园|种族|文明组织|原生世界|神灵|深渊","priority":0,"power":"实力描述","rank":1,"status":"鼎盛|扩张|稳固|衰退|困顿|沉寂|封印|复苏|覆灭","territory":"疆域","resources":"资源","goal":"动向","towardParadise":"对主角阵营态度","relations":[{"target":"对谁","relation":"关系"}],"extra":{"键":"值"},"era":"纪元/近况"}]}
priority: 0核心/1次要/2边缘。顶层最重要的给 0。`;
    try {
      const { content } = await apiChatFallback(chain, [
        { role: 'system', content: sys },
        { role: 'user', content: '只输出 JSON 对象 {"entities":[...]}。' },
      ], { timeoutMs: 120000 });
      let txt = String(content || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
      const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
      const j = JSON.parse(s >= 0 && e > s ? txt.slice(s, e + 1) : txt);
      const arr = Array.isArray(j?.entities) ? j.entities : [];
      if (arr.length === 0) { flash('❌ 生成结果为空/无法解析，重试一次'); return; }
      seedEntities(arr, true);
      flash(`✓ 已生成 ${arr.length} 个宇宙阵营`);
    } catch (err: any) { flash(`❌ 生成失败：${(err?.message ?? '').slice(0, 40)}`); }
    finally { setBusy(false); }
  }

  const mode = settings.seedMode;
  const ModeBtn = ({ v, label, desc }: { v: 'canon' | 'random' | 'blank'; label: string; desc: string }) => (
    <button onClick={() => setSettings({ seedMode: v })}
      className={`flex-1 text-left px-3 py-2 rounded-lg border transition-colors ${mode === v ? 'border-god/50 bg-god/10' : 'border-edge bg-panel/50 hover:border-god/30'}`}>
      <div className={`text-sm font-mono ${mode === v ? 'text-god' : 'text-slate-200'}`}>{label}</div>
      <div className="text-[12px] text-dim/60 mt-0.5 leading-snug">{desc}</div>
    </button>
  );

  return (
    <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-200">宇宙种子</div>
        <div className="text-[12px] font-mono text-dim/50">当前棋盘 {count} 个阵营</div>
      </div>
      <div className="flex gap-2 flex-col sm:flex-row">
        <ModeBtn v="canon" label="忠于原著" desc="载入《轮回乐园》真实宇宙格局（七乐园/万族/深渊…）" />
        <ModeBtn v="random" label="随机生成" desc="按题材让 AI 现编一套全新宇宙，适配任意世界书" />
        <ModeBtn v="blank" label="空白起步" desc="不预置，纯靠演化从正文里慢慢长出来" />
      </div>

      {mode === 'random' && (
        <Field label="题材 / 风格提示（随机生成用）">
          <input type="text" value={settings.seedTheme} onChange={(e) => setSettings({ seedTheme: e.target.value })}
            placeholder="如：克苏鲁神话星界 / 科幻星际文明 / 仙侠万族（留空=轮回乐园式）" className="input-base text-sm" />
        </Field>
      )}

      <div className="flex flex-wrap gap-2">
        {mode === 'canon' && (
          <button onClick={() => { seedFromCanon(); flash('✓ 已载入原著宇宙棋盘'); }}
            className="px-3 py-1.5 text-[13px] font-mono border border-god/40 text-god rounded hover:bg-god/10 transition-colors">📜 载入原著棋盘</button>
        )}
        {mode === 'random' && (
          <button onClick={genRandom} disabled={busy}
            className="px-3 py-1.5 text-[13px] font-mono border border-fuchsia-500/40 text-fuchsia-300 rounded hover:bg-fuchsia-900/20 disabled:opacity-40 transition-colors">{busy ? '生成中…' : '🎲 随机生成'}</button>
        )}
        <button onClick={() => { const before = useCosmos.getState().entities.length; dedupeEntities(); const removed = before - useCosmos.getState().entities.length; flash(removed > 0 ? `✓ 已合并 ${removed} 条重复实体` : '✓ 无重复实体'); }}
          className="px-3 py-1.5 text-[13px] font-mono border border-edge text-dim rounded hover:border-god/40 hover:text-god transition-colors">🧹 清理重复</button>
        <button onClick={() => { clearCosmos(); flash('✓ 已清空棋盘'); }}
          className="px-3 py-1.5 text-[13px] font-mono border border-edge text-dim rounded hover:border-blood/40 hover:text-blood transition-colors">清空棋盘</button>
      </div>
      {msg && <div className={`text-[13px] font-mono ${msg.includes('❌') ? 'text-blood' : 'text-god'}`}>{msg}</div>}
      <div className="text-[12px] text-dim/45 leading-relaxed">忠于原著=开局即完整的轮回乐园格局；随机=AI 现编；空白=从零涌现。启用演化后，canon 模式首次推演会自动载入。</div>
    </div>
  );
}

function SettingsSection() {
  const settings = useCosmos((s) => s.settings);
  const setSettings = useCosmos((s) => s.setSettings);
  const setPresetEntries = useCosmos((s) => s.setPresetEntries);
  const resetPreset = useCosmos((s) => s.resetPreset);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const entries = settings.entries ?? [];

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = extractCosmosPresetFromJson(ev.target?.result as string);
      if (!result) setMsg('❌ 未识别到有效条目');
      else { setPresetEntries(result.entries, result.name, result.version); setMsg(`✓ 已导入「${result.name}」，共 ${result.entries.length} 条`); }
      setTimeout(() => setMsg(''), 5000);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }
  function handleExport() {
    const payload = { name: settings.presetName || '万族演化预设', version: settings.presetVersion,
      entrySharedRules: entries.map((x) => ({ id: x.identifier, name: x.name, content: x.content, enabled: x.enabled, role: x.role })) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${settings.presetName || 'cosmos-preset'}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-panel px-3 py-2.5">
        <div>
          <div className="text-sm text-slate-200">启用万族演化</div>
          <div className="text-[13px] text-dim/70 mt-0.5">正文完成后推演宇宙背景层：七乐园/虚空万族/文明/原生世界/神灵/深渊（跨世界永久）</div>
        </div>
        <Toggle checked={settings.enabled} onChange={() => setSettings({ enabled: !settings.enabled })} />
      </div>

      <SeedSection />

      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-3">
        <label className="flex items-center justify-between gap-2 text-sm text-dim">
          <span>触发频率（每 N 回合演化一次）</span>
          <input type="number" min={1} value={settings.frequency}
            onChange={(e) => setSettings({ frequency: Math.max(1, Number(e.target.value) || 3) })}
            className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm text-dim">
          <span>注入"不相关势力"采样数（增加真实感）</span>
          <input type="number" min={0} max={6} value={settings.injectIrrelevantCount}
            onChange={(e) => setSettings({ injectIrrelevantCount: Math.max(0, Math.min(6, Number(e.target.value) || 0)) })}
            className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm text-dim">
          <span>每回合更新几个乐园</span>
          <input type="number" min={0} max={7} value={settings.paradisePerTurn}
            onChange={(e) => setSettings({ paradisePerTurn: Math.max(0, Math.min(7, Number(e.target.value) || 0)) })}
            className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm text-dim">
          <span>每回合更新几个其他势力</span>
          <input type="number" min={0} max={30} value={settings.otherPerTurn}
            onChange={(e) => setSettings({ otherPerTurn: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })}
            className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm text-dim">
          <span>每组延续上回合几个（其余轮换）</span>
          <input type="number" min={0} max={10} value={settings.continueCount}
            onChange={(e) => setSettings({ continueCount: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
            className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
        </label>
        <div className="text-[12px] text-dim/45 leading-relaxed">乐园/其他各按数量选取；每组先从上回合更新过的随机保留「延续数」个继续推进剧情，其余名额轮换给上回合没更新的——防止有的势力一直更新、有的一直不动。</div>
      </div>

      {/* 参与门槛 */}
      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-2">
        <div className="text-sm text-slate-200">主角参与门槛</div>
        <div className="text-[12px] text-dim/60 leading-snug">前期纯背景；达门槛后主角的世界级战功才能反馈到宇宙格局。</div>
        <div className="flex gap-2 flex-wrap">
          {([['off', '永不参与'], ['auto', '自动（七阶/满50回合解锁）'], ['manual', '手动']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setSettings({ participationGate: v })}
              className={`px-2.5 py-1 rounded text-[13px] font-mono border transition-colors ${settings.participationGate === v ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>{label}</button>
          ))}
        </div>
        {settings.participationGate === 'manual' && (
          <label className="flex items-center gap-2 text-sm text-dim pt-1">
            <Toggle checked={settings.participationUnlocked} onChange={() => setSettings({ participationUnlocked: !settings.participationUnlocked })} />
            <span>{settings.participationUnlocked ? '已解锁主角参与' : '尚未解锁（纯背景）'}</span>
          </label>
        )}
      </div>

      {/* 预设 */}
      <div className="rounded-lg border border-edge bg-panel">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-edge">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-200">演化预设规则</div>
            <div className="text-[13px] text-dim/60 mt-0.5 truncate">{settings.presetName || '（未命名）'} · {entries.length} 条</div>
          </div>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <button onClick={() => fileRef.current?.click()} className="px-2.5 py-1 text-[13px] font-mono border border-god/40 text-god rounded hover:bg-god/10 transition-colors">导入</button>
          <button onClick={handleExport} className="px-2.5 py-1 text-[13px] font-mono border border-edge text-dim rounded hover:border-god/40 hover:text-god transition-colors">导出</button>
          <button onClick={resetPreset} className="px-2.5 py-1 text-[13px] font-mono border border-edge text-dim rounded hover:border-god/40 hover:text-god transition-colors">恢复默认</button>
        </div>
        {msg && <div className={`px-3 py-1.5 text-[13px] font-mono ${msg.includes('❌') ? 'text-blood' : 'text-god'}`}>{msg}</div>}
        <div className="divide-y divide-edge/50 max-h-[360px] overflow-y-auto">
          {entries.length === 0
            ? <div className="px-3 py-8 text-center text-sm text-dim/40 font-mono">无条目，点「导入」或「恢复默认」</div>
            : entries.map((e) => <EntryRow key={e.identifier} entry={e} />)}
        </div>
        <div className="px-3 py-2 text-[12px] text-dim/50 leading-relaxed border-t border-edge">
          占位符运行时替换：<code className="text-god/60">{'${cosmos_snapshot} ${story_text} ${focus_list} ${player_name} ${player_tier} ${turn} ${participation}'}</code>
        </div>
      </div>
    </div>
  );
}

function ApiSection() {
  const api = useSettings((s) => s.api);
  const textApi = useSettings((s) => s.textApi);
  const textUseSharedApi = useSettings((s) => s.textUseSharedApi);
  const cApi = useCosmos((s) => s.cosmosApi);
  const useShared = useCosmos((s) => s.cosmosUseSharedApi);
  const models = useCosmos((s) => s.cosmosAvailableModels);
  const loading = useCosmos((s) => s.cosmosModelsLoading);
  const error = useCosmos((s) => s.cosmosModelsError);
  const setApi = useCosmos((s) => s.setCosmosApi);
  const setUseShared = useCosmos((s) => s.setCosmosUseSharedApi);
  const fetchModels = useCosmos((s) => s.fetchCosmosModels);
  const effective = useShared ? (textUseSharedApi ? api : textApi) : cApi;

  return (
    <div className="space-y-6 max-w-xl">
      <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
        <Toggle checked={useShared} onChange={() => setUseShared(!useShared)} />
        <div>
          <div className="text-sm text-slate-200">与正文生成共用 API</div>
          <div className="text-sm text-dim mt-0.5">开启时复用正文/世界选择 API；关闭则为万族演化单独配置</div>
        </div>
      </div>
      <ApiRoutePicker routeKey="cosmos" />
      {!useShared && (
        <div className="space-y-4">
          <Field label="API 地址"><input type="text" value={cApi.baseUrl} onChange={(e) => setApi({ baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" className="input-base" /></Field>
          <Field label="API Key"><input type="password" value={cApi.apiKey} onChange={(e) => setApi({ apiKey: e.target.value })} placeholder="sk-..." className="input-base font-mono" /></Field>
          <Field label="模型">
            <div className="flex gap-2">
              {models.length > 0 ? (
                <select value={cApi.modelId} onChange={(e) => setApi({ modelId: e.target.value })} className="input-base flex-1">{models.map((m) => <option key={m} value={m}>{m}</option>)}</select>
              ) : (
                <input type="text" value={cApi.modelId} onChange={(e) => setApi({ modelId: e.target.value })} placeholder="gpt-4o" className="input-base flex-1 font-mono" />
              )}
              <button onClick={fetchModels} disabled={loading} className="shrink-0 px-3 py-2 border border-god/40 text-god text-sm rounded hover:bg-god/10 disabled:opacity-40 font-mono transition-colors">{loading ? '获取中…' : '刷新模型'}</button>
            </div>
            {error && <div className="text-sm text-blood mt-1 font-mono">{error}</div>}
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label={`温度 (${cApi.temperature})`}><input type="range" min={0} max={2} step={0.05} value={cApi.temperature} onChange={(e) => setApi({ temperature: parseFloat(e.target.value) })} className="w-full accent-god mt-1" /></Field>
            <Field label={`Top-P (${cApi.topP})`}><input type="range" min={0} max={1} step={0.05} value={cApi.topP} onChange={(e) => setApi({ topP: parseFloat(e.target.value) })} className="w-full accent-god mt-1" /></Field>
            <Field label="Max Tokens"><input type="number" value={cApi.maxTokens} onChange={(e) => setApi({ maxTokens: parseInt(e.target.value) || 512 })} min={128} max={32768} step={128} className="input-base" /></Field>
          </div>
        </div>
      )}
      <div className="border border-edge rounded-lg p-3 bg-panel text-sm font-mono text-dim space-y-1">
        <div><span className="text-god/60">URL ·</span> {effective.baseUrl || '—'}</div>
        <div><span className="text-god/60">MODEL ·</span> {effective.modelId || '—'}</div>
        <div><span className="text-god/60">TEMP ·</span> {effective.temperature} &nbsp;<span className="text-god/60">MAX ·</span> {effective.maxTokens}</div>
      </div>
    </div>
  );
}

type CosmosTab = 'settings' | 'api';

export default function CosmosManager() {
  const enabled = useCosmos((s) => s.settings.enabled);
  const setSettings = useCosmos((s) => s.setSettings);
  const [tab, setTab] = useState<CosmosTab>('settings');
  const tabs: { key: CosmosTab; label: string; icon: string }[] = [
    { key: 'settings', label: '演化设置', icon: '🌌' },
    { key: 'api', label: 'API 设置', icon: '⚡' },
  ];
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-edge pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-100">万族演化</h2>
          <p className="text-sm text-dim mt-0.5">推演宇宙背景层（七乐园/虚空万族/文明/原生世界/神灵/深渊）。头顶自转、跨世界永久；前期纯背景，中后期主角才够格搅动。</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-dim font-mono">{enabled ? '已启用' : '已停用'}</span>
          <Toggle checked={enabled} onChange={() => setSettings({ enabled: !enabled })} />
        </div>
      </div>
      <div className="flex gap-1 p-1 bg-panel rounded-lg border border-edge">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-sm font-mono transition-colors ${tab === t.key ? 'bg-god/10 text-god border border-god/30' : 'text-dim hover:text-slate-200'}`}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>
      {tab === 'settings' && <SettingsSection />}
      {tab === 'api' && <ApiSection />}
    </div>
  );
}
