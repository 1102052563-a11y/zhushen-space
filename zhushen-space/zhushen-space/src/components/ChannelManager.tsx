import { useRef, useState } from 'react';
import { useChannel, extractChannelPresetFromJson, CHANNEL_DEFS, type ChannelPresetEntry } from '../store/channelStore';
import ApiRoutePicker from './ApiRoutePicker';

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className={`shrink-0 w-9 h-5 rounded-full border transition-colors ${checked ? 'bg-god/30 border-god/50' : 'bg-void border-edge'}`}>
      <div className="w-3 h-3 rounded-full bg-white mx-1 transition-all" style={{ transform: checked ? 'translateX(16px)' : 'none' }} />
    </button>
  );
}

function EntryRow({ entry }: { entry: ChannelPresetEntry }) {
  const toggle = useChannel((s) => s.togglePresetEntry);
  return (
    <div className={`px-3 py-2 ${!entry.enabled ? 'opacity-40' : ''}`}>
      <div className="flex items-center gap-2">
        <Toggle checked={entry.enabled} onChange={() => toggle(entry.identifier)} />
        <span className="flex-1 text-sm text-slate-300 truncate font-mono">{entry.name}</span>
        <span className="text-[11px] font-mono text-dim/40 shrink-0">{Math.round(entry.content.length / 3.5)}t</span>
      </div>
    </div>
  );
}

function SettingsSection() {
  const settings = useChannel((s) => s.settings);
  const setSettings = useChannel((s) => s.setSettings);
  const toggleChannel = useChannel((s) => s.toggleChannel);
  const setPresetEntries = useChannel((s) => s.setPresetEntries);
  const resetPreset = useChannel((s) => s.resetPreset);
  const clearChannel = useChannel((s) => s.clearChannel);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const entries = settings.entries ?? [];

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = extractChannelPresetFromJson(ev.target?.result as string);
      if (!result) setMsg('❌ 未识别到有效条目，请确认文件格式');
      else { setPresetEntries(result.entries, result.name, result.version); setMsg(`✓ 已导入「${result.name}」，共 ${result.entries.length} 条`); }
      setTimeout(() => setMsg(''), 5000);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }
  function handleExport() {
    const payload = {
      name: settings.presetName || '公共频道预设',
      version: settings.presetVersion,
      entrySharedRules: entries.map((x) => ({ id: x.identifier, name: x.name, content: x.content, enabled: x.enabled, role: x.role })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${settings.presetName || 'channel-preset'}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  const numField = (label: string, key: 'genCount' | 'staleTurns' | 'maxMessages' | 'perChannelKeep', hint?: string) => (
    <label className="flex items-center justify-between gap-2 text-sm text-dim">
      <span>{label}{hint && <span className="text-dim/40 ml-1">{hint}</span>}</span>
      <input type="number" min={1} value={settings[key]}
        onChange={(e) => setSettings({ [key]: Math.max(1, Number(e.target.value) || 1) } as any)}
        className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
    </label>
  );

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-panel px-3 py-2.5">
        <div>
          <div className="text-sm text-slate-200">启用公共频道</div>
          <div className="text-[13px] text-dim/70 mt-0.5">轮回乐园·契约者公共广场（只读）：打开面板时若内容过期会自动刷新一批 AI 帖子</div>
        </div>
        <Toggle checked={settings.enabled} onChange={() => setSettings({ enabled: !settings.enabled })} />
      </div>

      {/* 频道开关 */}
      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-2">
        <div className="text-sm text-dim mb-1">启用的频道</div>
        {CHANNEL_DEFS.map((d) => (
          <label key={d.key} className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-300">{d.icon} {d.label}<span className="text-dim/40 text-[12px] ml-2">{d.desc}</span></span>
            <Toggle checked={settings.channels[d.key]} onChange={() => toggleChannel(d.key)} />
          </label>
        ))}
      </div>

      {/* 刷新节奏 */}
      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-2">
        <div className="text-sm text-dim mb-1">刷新节奏</div>
        {numField('每频道保留条数', 'perChannelKeep', '（每个频道只保留最新 N 条，老消息刷掉）')}
        {numField('每次刷新生成条数', 'genCount')}
        {numField('懒刷新间隔', 'staleTurns', '（打开时距上次刷新≥N回合才自动刷新）')}
        {numField('总池上限（兜底）', 'maxMessages')}
        <div className="flex justify-end pt-1">
          <button onClick={clearChannel} className="px-2.5 py-1 text-[12px] font-mono border border-edge text-dim/60 rounded hover:border-blood/40 hover:text-blood transition-colors">清空当前频道消息</button>
        </div>
        <div className="text-[12px] text-dim/50 leading-snug">混合刷新：打开频道面板时若内容过期（或为空）自动刷新；面板右上角 🔄 可随时强制刷新；旧帖按上限滚动淘汰。不在每回合后台消耗 token。</div>
      </div>

      {/* 预设 */}
      <div className="rounded-lg border border-edge bg-panel">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-edge">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-200">生成预设</div>
            <div className="text-[13px] text-dim/60 mt-0.5 truncate">{settings.presetName || '（未命名）'} · {entries.length} 条</div>
          </div>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <button onClick={() => fileRef.current?.click()} className="px-2.5 py-1 text-[13px] font-mono border border-god/40 text-god rounded hover:bg-god/10 transition-colors">导入 JSON</button>
          <button onClick={handleExport} className="px-2.5 py-1 text-[13px] font-mono border border-edge text-dim rounded hover:border-god/40 hover:text-god transition-colors">导出</button>
          <button onClick={resetPreset} className="px-2.5 py-1 text-[13px] font-mono border border-edge text-dim rounded hover:border-god/40 hover:text-god transition-colors">恢复默认</button>
        </div>
        {msg && <div className={`px-3 py-1.5 text-[13px] font-mono ${msg.includes('❌') ? 'text-blood' : 'text-god'}`}>{msg}</div>}
        <div className="divide-y divide-edge/50 max-h-[300px] overflow-y-auto">
          {entries.length === 0
            ? <div className="px-3 py-8 text-center text-sm text-dim/40 font-mono">无条目，点「导入 JSON」或「恢复默认」</div>
            : entries.map((e) => <EntryRow key={e.identifier} entry={e} />)}
        </div>
        <div className="px-3 py-2 text-[12px] text-dim/50 leading-relaxed border-t border-edge">
          占位符运行时替换：<code className="text-god/60">{'${player_name} ${player_tier} ${world_name} ${world_time} ${enabled_channels} ${recent_events} ${existing_messages} ${message_count}'}</code>
        </div>
      </div>
    </div>
  );
}

function ApiSection() {
  return (
    <div className="space-y-6 max-w-xl">
      <ApiRoutePicker routeKey="channel" />
    </div>
  );
}

type ChannelTab = 'settings' | 'api';

export default function ChannelManager() {
  const enabled = useChannel((s) => s.settings.enabled);
  const setSettings = useChannel((s) => s.setSettings);
  const [tab, setTab] = useState<ChannelTab>('settings');
  const tabs: { key: ChannelTab; label: string; icon: string }[] = [
    { key: 'settings', label: '频道设置', icon: '📡' },
    { key: 'api', label: 'API 设置', icon: '⚡' },
  ];

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-edge pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-100">公共频道</h2>
          <p className="text-sm text-dim mt-0.5">轮回乐园·契约者公共广场（一期·只读）：AI 模拟交易/组队/综合/情报帖子</p>
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
