import { useRef, useState } from 'react';
import { useMisc, extractMiscPresetFromJson, type MiscPresetEntry } from '../store/miscStore';
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
function EntryRow({ entry }: { entry: MiscPresetEntry }) {
  const toggle = useMisc((s) => s.togglePresetEntry);
  const update = useMisc((s) => s.updatePresetEntry);
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
  const settings = useMisc((s) => s.settings);
  const setSettings = useMisc((s) => s.setSettings);
  const setPresetEntries = useMisc((s) => s.setPresetEntries);
  const resetPreset = useMisc((s) => s.resetPreset);
  const paradiseTime = useMisc((s) => s.paradiseTime);
  const worldTime = useMisc((s) => s.worldTime);
  const worldName = useMisc((s) => s.worldName);
  const setTime = useMisc((s) => s.setTime);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  const entries = settings.entries ?? [];

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = extractMiscPresetFromJson(ev.target?.result as string);
      if (!result) setMsg('❌ 未识别到有效条目，请确认文件格式');
      else { setPresetEntries(result.entries, result.name, result.version); setMsg(`✓ 已导入「${result.name}」，共 ${result.entries.length} 条`); }
      setTimeout(() => setMsg(''), 5000);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }
  function handleExport() {
    const payload = {
      name: settings.presetName || '杂项演化预设',
      version: settings.presetVersion,
      entrySharedRules: entries.map((x) => ({ id: x.identifier, name: x.name, content: x.content, enabled: x.enabled, role: x.role })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${settings.presetName || 'misc-preset'}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  const numField = (label: string, key: 'largeEvery') => (
    <label className="flex items-center justify-between gap-2 text-sm text-dim">
      <span>{label}</span>
      <input type="number" min={1} value={settings[key]}
        onChange={(e) => setSettings({ [key]: Math.max(1, Number(e.target.value) || 1) } as any)}
        className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
    </label>
  );

  // 记忆保留上限（0=无限）；与 numField 区别在允许 0
  const capField = (label: string, key: 'factCap' | 'smallCap' | 'largeCap') => (
    <label className="flex items-center justify-between gap-2 text-sm text-dim">
      <span>{label}</span>
      <input type="number" min={0} value={settings[key] ?? 0}
        onChange={(e) => setSettings({ [key]: Math.max(0, Number(e.target.value) || 0) } as any)}
        className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
    </label>
  );

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-panel px-3 py-2.5">
        <div>
          <div className="text-sm text-slate-200">启用杂项演化</div>
          <div className="text-[13px] text-dim/70 mt-0.5">正文完成后维护：分段总结 / 双时间 / 天气 / 世界大事 / 主角任务</div>
        </div>
        <Toggle checked={settings.enabled} onChange={() => setSettings({ enabled: !settings.enabled })} />
      </div>

      {/* 双时间初始值 */}
      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-2">
        <div className="text-sm text-dim mb-1">双时间 / 世界（可手动初始化，AI 会接着推进）</div>
        <Field label="轮回历时间">
          <input value={paradiseTime} onChange={(e) => setTime({ paradiseTime: e.target.value })}
            placeholder="轮回历0001年01月01日 08:00"
            className="w-full bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god" />
        </Field>
        <Field label="当前世界">
          <input value={worldName} onChange={(e) => setTime({ worldName: e.target.value })}
            placeholder="轮回乐园"
            className="w-full bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god" />
        </Field>
        <Field label="世界时间">
          <input value={worldTime} onChange={(e) => setTime({ worldTime: e.target.value })}
            placeholder="（进入任务世界后由 AI 维护）"
            className="w-full bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god" />
        </Field>
      </div>

      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-2">
        <div className="text-sm text-dim mb-1">总结节奏</div>
        {numField('大总结周期（每 N 回合产 1 条大总结）', 'largeEvery')}
        <div className="text-[12px] text-dim/50 leading-snug">小总结每回合都出（聚焦本回合）；大总结每 N 回合才出一条，对最近若干小总结做阶段压缩，二者内容不再雷同。</div>
      </div>

      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-2">
        <div className="text-sm text-dim mb-1">记忆保留上限（0 = 无限）</div>
        {capField('长期事实', 'factCap')}
        {capField('小总结', 'smallCap')}
        {capField('大总结', 'largeCap')}
        <div className="text-[12px] text-dim/50 leading-snug">默认 0=不限。担心存档体积时填正数=只保留最近 N 条（仅影响存储与召回候选，不影响每回合注入）。小总结每回合都产、增长最快。</div>
      </div>

      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-slate-200">任务注入正文</div>
            <div className="text-[13px] text-dim/70 mt-0.5">把当前主线（重·含当前环目标/下一步/终局）与相关支线（轻）回流到正文上下文，给主线存在感、由系统把控节奏</div>
          </div>
          <Toggle checked={settings.questInjectEnabled !== false}
            onChange={() => setSettings({ questInjectEnabled: settings.questInjectEnabled === false })} />
        </div>
        <label className="flex items-center justify-between gap-2 text-sm text-dim">
          <span>注入正文的支线条数上限（0 = 只注主线）</span>
          <input type="number" min={0} max={10} value={settings.questSideCap ?? 3}
            onChange={(e) => setSettings({ questSideCap: Math.max(0, Math.min(10, Number(e.target.value) || 0)) } as any)}
            className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
        </label>
        <div className="text-[12px] text-dim/50 leading-snug">支线按"贴合当前地点 / 在场 NPC"相关性排序后取前 N 条注入；主线始终全量注入。关掉开关则正文完全不注入任务（回到旧行为）。</div>
      </div>

      {/* 预设：导入 / 导出 / 恢复默认 + 条目列表 */}
      <div className="rounded-lg border border-edge bg-panel">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-edge">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-200">预设规则</div>
            <div className="text-[13px] text-dim/60 mt-0.5 truncate">{settings.presetName || '（未命名）'} · {entries.length} 条</div>
            <div className="text-[11px] text-god/55 mt-0.5">⟳ 每次刷新自动同步为内置最新；下方手改 / 导入仅当次会话有效</div>
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
          占位符运行时替换：<code className="text-god/60">{'${story_text} ${current_paradise_time} ${current_world_time} ${current_world_name} ${weather} ${current_tasks} ${world_events} ${next_available_task_id}'}</code>
        </div>
      </div>

      {/* 杂项演化专属世界书 + CoT 提示（指引去正文世界书编辑）*/}
      <div className="rounded-lg border border-god/25 bg-god/5 px-3 py-2.5 text-[12px] text-dim/70 leading-relaxed">
        <div className="text-god/80 font-mono mb-1">📖 杂项演化·专属世界书 + 思维链</div>
        已内置「<span className="text-slate-300">杂项演化·任务与世界规范图鉴</span>」专属世界书（任务类型库 / 环结构 / 奖惩时限 / 世界大事 / 天气词库 / 双时间 / 总结规范），每轮杂项演化时<b className="text-slate-300">强制注入</b>——要编辑或关闭，去「设置 → 正文世界书」找这本书。<br />
        另已加入<b className="text-slate-300">强制思维链(CoT)</b>：每轮先在 <code className="text-god/60">{'<misc_cot>'}</code> 里推演产出的合理性与原因（<b className="text-slate-300">尤其任务</b>：触发证据 / 合理性 / 类型与环 / 奖惩时限 / 结算），再落 <code className="text-god/60">{'<upstore>'}</code> 指令。两者均即时生效、无需重导预设。
      </div>
    </div>
  );
}

/* ── API 设置 ── */
function ApiSection() {
  return (
    <div className="space-y-6 max-w-xl">
      <ApiRoutePicker routeKey="misc" />
    </div>
  );
}

type MiscTab = 'settings' | 'api';

export default function MiscManager() {
  const enabled = useMisc((s) => s.settings.enabled);
  const setSettings = useMisc((s) => s.setSettings);
  const [tab, setTab] = useState<MiscTab>('settings');
  const tabs: { key: MiscTab; label: string; icon: string }[] = [
    { key: 'settings', label: '演化设置', icon: '🧩' },
    { key: 'api', label: 'API 设置', icon: '⚡' },
  ];

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-edge pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-100">杂项演化</h2>
          <p className="text-sm text-dim mt-0.5">维护世界级杂项：分段总结 / 双时间 / 天气 / 世界大事 / 主角任务（小地图暂未启用）</p>
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
