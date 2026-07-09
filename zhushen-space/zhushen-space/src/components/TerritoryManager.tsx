import { useRef, useState } from 'react';
import { useTerritory, extractTerritoryPresetFromJson, type TerritoryPresetEntry } from '../store/territoryStore';
import { useSettings } from '../store/settingsStore';
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

/* ── 单条预设规则行（开关 + 编辑）── */
function EntryRow({ entry }: { entry: TerritoryPresetEntry }) {
  const toggle = useTerritory((s) => s.togglePresetEntry);
  const update = useTerritory((s) => s.updatePresetEntry);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState(entry.content);
  return (
    <div className={`px-3 py-2 ${!entry.enabled ? 'opacity-40' : ''}`}>
      <div className="flex items-center gap-2">
        <Toggle checked={entry.enabled} onChange={() => toggle(entry.identifier)} />
        <span className="flex-1 text-sm text-slate-300 truncate font-mono">{entry.name}</span>
        <span className="text-[11px] font-mono text-dim/40 shrink-0">{Math.round(entry.content.length / 3.5)}t</span>
        <button onClick={() => { setOpen(!open); setContent(entry.content); }}
          className="text-[12px] font-mono text-dim/50 hover:text-god transition-colors shrink-0">
          {open ? '收起' : '编辑'}
        </button>
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

/* ── 设置 + 预设（导入/导出/编辑）── */
function SettingsSection() {
  const settings = useTerritory((s) => s.settings);
  const setSettings = useTerritory((s) => s.setSettings);
  const setPresetEntries = useTerritory((s) => s.setPresetEntries);
  const resetPreset = useTerritory((s) => s.resetPreset);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  const entries = settings.entries ?? [];

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = extractTerritoryPresetFromJson(ev.target?.result as string);
      if (!result) setMsg('❌ 未识别到有效条目，请确认文件格式');
      else { setPresetEntries(result.entries, result.name, result.version); setMsg(`✓ 已导入「${result.name}」，共 ${result.entries.length} 条`); }
      setTimeout(() => setMsg(''), 5000);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }
  function handleExport() {
    const payload = {
      name: settings.presetName || '领地演化预设',
      version: settings.presetVersion,
      entrySharedRules: entries.map((x) => ({ id: x.identifier, name: x.name, content: x.content, enabled: x.enabled, role: x.role })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${settings.presetName || 'territory-preset'}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-panel px-3 py-2.5">
        <div>
          <div className="text-sm text-slate-200">启用领地演化</div>
          <div className="text-[13px] text-dim/70 mt-0.5">正文完成后维护轮回乐园个人基地：等级/建设进度 / 建筑 / 领地效果 / 成员 / 仓库</div>
        </div>
        <Toggle checked={settings.enabled} onChange={() => setSettings({ enabled: !settings.enabled })} />
      </div>

      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5">
        <label className="flex items-center justify-between gap-2 text-sm text-dim">
          <span>触发频率（每 N 回合演化一次）</span>
          <input type="number" min={1} value={settings.frequency}
            onChange={(e) => setSettings({ frequency: Math.max(1, Number(e.target.value) || 1) })}
            className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
        </label>
      </div>

      {/* 预设：导入 / 导出 / 恢复默认 + 条目列表 */}
      <div className="rounded-lg border border-edge bg-panel">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-edge">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-200">预设规则</div>
            <div className="text-[13px] text-dim/60 mt-0.5 truncate">{settings.presetName || '（未命名）'} · {entries.length} 条</div>
          </div>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <button onClick={() => fileRef.current?.click()} className="px-2.5 py-1 text-[13px] font-mono border border-god/40 text-god rounded hover:bg-god/10 transition-colors">导入 JSON</button>
          <button onClick={handleExport} className="px-2.5 py-1 text-[13px] font-mono border border-edge text-dim rounded hover:border-god/40 hover:text-god transition-colors">导出</button>
          <button onClick={resetPreset} className="px-2.5 py-1 text-[13px] font-mono border border-edge text-dim rounded hover:border-god/40 hover:text-god transition-colors">恢复默认</button>
        </div>
        {msg && <div className={`px-3 py-1.5 text-[13px] font-mono ${msg.includes('❌') ? 'text-blood' : 'text-god'}`}>{msg}</div>}
        <div className="divide-y divide-edge/50 max-h-[420px] overflow-y-auto">
          {entries.length === 0
            ? <div className="px-3 py-8 text-center text-sm text-dim/40 font-mono">无条目，点「导入 JSON」或「恢复默认」</div>
            : entries.map((e) => <EntryRow key={e.identifier} entry={e} />)}
        </div>
        <div className="px-3 py-2 text-[12px] text-dim/50 leading-relaxed border-t border-edge">
          占位符运行时替换：<code className="text-god/60">{'${story_text} ${territory_snapshot} ${onscreen_npcs} ${player_name}'}</code>
        </div>
      </div>
    </div>
  );
}

/* ── API 设置 ── */
function ApiSection() {
  return (
    <div className="space-y-6 max-w-xl">
      <ApiRoutePicker routeKey="territory" />
    </div>
  );
}

type TerritoryTab = 'settings' | 'api';

export default function TerritoryManager() {
  const enabled = useTerritory((s) => s.settings.enabled);
  const setSettings = useTerritory((s) => s.setSettings);
  const [tab, setTab] = useState<TerritoryTab>('settings');
  const tabs: { key: TerritoryTab; label: string; icon: string }[] = [
    { key: 'settings', label: '演化设置', icon: '🏯' },
    { key: 'api', label: 'API 设置', icon: '⚡' },
  ];

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-edge pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-100">领地演化</h2>
          <p className="text-sm text-dim mt-0.5">维护轮回乐园个人基地：等级/建设进度 / 自定义建筑 / 领地效果 / 成员 / 仓库（跨任务世界保留）</p>
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
