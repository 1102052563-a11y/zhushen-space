import { useRef, useState } from 'react';
import { useFactionEvo, extractFactionPresetFromJson } from '../store/factionEvoStore';
import { useSettings } from '../store/settingsStore';
import ApiRoutePicker from './ApiRoutePicker';

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className={`shrink-0 w-9 h-5 rounded-full border transition-colors ${checked ? 'bg-god/30 border-god/50' : 'bg-void border-edge'}`}>
      <div className="w-3 h-3 rounded-full bg-white mx-1 transition-all" style={{ transform: checked ? 'translateX(16px)' : 'none' }} />
    </button>
  );
}
function Num({ label, value, onChange, min = 0, hint }: { label: string; value: number; onChange: (n: number) => void; min?: number; hint?: string }) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm text-dim">
      <span className="flex-1">{label}{hint && <span className="text-[11px] text-dim/50 ml-1">{hint}</span>}</span>
      <input type="number" min={min} value={value} onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
        className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
    </label>
  );
}

type Tab = 'preset' | 'schedule' | 'api';

export default function FactionManager() {
  const settings = useFactionEvo((s) => s.settings);
  const setSettings = useFactionEvo((s) => s.setSettings);
  const setScheduling = useFactionEvo((s) => s.setScheduling);
  const setPresetEntries = useFactionEvo((s) => s.setPresetEntries);
  const togglePresetEntry = useFactionEvo((s) => s.togglePresetEntry);
  const clearPreset = useFactionEvo((s) => s.clearPreset);
  const factionApi = useFactionEvo((s) => s.factionApi);
  const useShared = useFactionEvo((s) => s.factionUseSharedApi);
  const setFactionApi = useFactionEvo((s) => s.setFactionApi);
  const setUseShared = useFactionEvo((s) => s.setFactionUseSharedApi);
  const models = useFactionEvo((s) => s.factionAvailableModels);
  const fetchModels = useFactionEvo((s) => s.fetchFactionModels);
  const modelsErr = useFactionEvo((s) => s.factionModelsError);
  const modelsLoading = useFactionEvo((s) => s.factionModelsLoading);
  const textApi = useSettings((s) => s.textUseSharedApi ? s.api : s.textApi);
  const [tab, setTab] = useState<Tab>('preset');
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const sc = settings.scheduling;
  const entries = settings.entries ?? [];

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const r = extractFactionPresetFromJson(ev.target?.result as string);
      if (!r) setMsg('❌ 未识别到有效条目');
      else { setPresetEntries(r.entries, r.name, r.version); setMsg(`✓ 已导入「${r.name}」，共 ${r.entries.length} 条`); }
      setTimeout(() => setMsg(''), 5000);
    };
    reader.readAsText(file, 'utf-8'); e.target.value = '';
  }
  function handleExport() {
    const payload = { name: settings.presetName || '势力演化预设', version: settings.presetVersion,
      entrySharedRules: entries.filter((x) => x.source === 'entrySharedRules').map((x) => ({ id: x.identifier, name: x.name, content: x.content, enabled: x.enabled, role: x.role })),
      prompts: { faction: { rules: entries.filter((x) => x.source !== 'entrySharedRules').map((x) => ({ id: x.identifier, name: x.name, content: x.content, enabled: x.enabled, role: x.role })) } } };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `${settings.presetName || 'faction-preset'}.json`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="border-b border-edge pb-3">
        <h2 className="text-base font-bold text-slate-100">势力演化</h2>
        <p className="text-xs text-dim mt-0.5">为世界中的势力（帮派/政府/企业/教会/军团…）维护档案。当前世界势力=活跃，非当前世界势力=后台推演。独立 API。</p>
      </div>

      {/* 启用 + 策略 */}
      <div className="border border-edge rounded-lg p-4 bg-panel space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div><div className="text-sm font-semibold text-slate-200">启用势力演化</div><div className="text-xs text-dim mt-0.5">正文完成后并发触发，不阻塞主叙事</div></div>
          <Toggle checked={settings.enabled} onChange={() => setSettings({ enabled: !settings.enabled })} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-dim">策略</span>
          {(['B', 'A'] as const).map((s) => (
            <button key={s} onClick={() => setSettings({ strategy: s })}
              className={`px-3 py-1 text-sm rounded border font-mono transition-colors ${settings.strategy === s ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>
              {s === 'B' ? 'B · 当前世界判断+逐势力（默认）' : 'A · 单次合并'}
            </button>
          ))}
        </div>
      </div>

      {/* Tab */}
      <div className="flex gap-1 border-b border-edge">
        {([['preset', '预设设置'], ['schedule', '调度'], ['api', 'API 设置']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-sm font-mono border-b-2 -mb-px transition-colors ${tab === k ? 'border-god text-god' : 'border-transparent text-dim hover:text-slate-200'}`}>{label}</button>
        ))}
      </div>

      {tab === 'preset' && (
        <div className="space-y-3">
          {settings.strategy === 'A' && <Num label="策略A 触发频率" hint="每N回合一次" value={settings.frequency} min={1} onChange={(n) => setSettings({ frequency: n })} />}
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            <button onClick={() => fileRef.current?.click()} className="px-3 py-1.5 text-sm font-mono border border-god/40 text-god rounded hover:bg-god/10 transition-colors">导入 JSON</button>
            <button onClick={handleExport} className="px-3 py-1.5 text-sm font-mono border border-edge text-dim rounded hover:border-god/40 hover:text-god transition-colors">导出</button>
            <button onClick={clearPreset} className="px-3 py-1.5 text-sm font-mono border border-edge text-dim rounded hover:border-blood/40 hover:text-blood transition-colors">清空</button>
            <span className="text-xs text-dim/60 ml-auto truncate">{settings.presetName || '（未导入）'} · {entries.length} 条</span>
          </div>
          {msg && <div className="text-xs text-god/80 font-mono">{msg}</div>}
          <div className="border border-edge rounded-lg divide-y divide-edge max-h-80 overflow-y-auto">
            {entries.length === 0 && <div className="p-4 text-center text-dim/40 text-sm">未导入预设。可参考「NPC演化」预设结构新建 势力演化.json 导入。</div>}
            {entries.map((e) => (
              <div key={e.identifier} className={`flex items-center gap-2 px-3 py-2 ${!e.enabled ? 'opacity-40' : ''}`}>
                <Toggle checked={e.enabled} onChange={() => togglePresetEntry(e.identifier)} />
                <span className="flex-1 text-sm text-slate-300 truncate font-mono">{e.name}</span>
                <span className="text-[11px] font-mono text-dim/40 shrink-0">{e.source === 'entrySharedRules' ? '判断' : '演化'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'schedule' && (
        <div className="border border-edge rounded-lg p-4 bg-panel space-y-3">
          <Num label="非当前世界活跃名额" hint="每回合后台推演几个" value={sc.offWorldQuota} onChange={(n) => setScheduling({ offWorldQuota: n })} />
          <Num label="逐势力并发数" hint="策略B" value={sc.concurrency} min={1} onChange={(n) => setScheduling({ concurrency: n })} />
          <Num label="每回合最多演化数" hint="0=不限" value={sc.modelPerTurnLimit} onChange={(n) => setScheduling({ modelPerTurnLimit: n })} />
          <Num label="请求超时（秒）" value={sc.requestTimeout} min={30} onChange={(n) => setScheduling({ requestTimeout: n })} />
          <label className="flex items-center justify-between gap-2 text-sm text-dim">
            <span>调度模式</span>
            <select value={sc.targetMode} onChange={(e) => setScheduling({ targetMode: e.target.value as 'auto' | 'manual' })}
              className="bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200">
              <option value="auto">自动</option><option value="manual">手动重点</option>
            </select>
          </label>
        </div>
      )}

      {tab === 'api' && (
        <div className="border border-edge rounded-lg p-4 bg-panel space-y-3">
          <ApiRoutePicker routeKey="faction" />
        </div>
      )}
    </div>
  );
}
