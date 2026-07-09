import { useState } from 'react';
import { useMemory } from '../store/memoryStore';
import { useSettings } from '../store/settingsStore';
import ApiRoutePicker from './ApiRoutePicker';

/* ── 开关 ── */
function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`shrink-0 w-9 h-5 rounded-full border transition-colors ${
        checked ? 'bg-god/30 border-god/50' : 'bg-void border-edge'
      }`}
    >
      <div className="w-3 h-3 rounded-full bg-white mx-1 transition-all" style={{ transform: checked ? 'translateX(16px)' : 'none' }} />
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm text-dim font-mono">{label}</label>
      {children}
    </div>
  );
}

/* ════════════════════════════════════════════
   设置（开关 / 范围 / 阈值 / 提示词）
════════════════════════════════════════════ */
function SettingsSection() {
  const settings = useMemory((s) => s.settings);
  const setSettings = useMemory((s) => s.setSettings);
  const resetPrompt = useMemory((s) => s.resetPrompt);

  const numField = (label: string, key: 'shortTermThreshold' | 'shortTermKeep' | 'longTermThreshold' | 'longTermKeep') => (
    <label className="flex items-center justify-between gap-2 text-sm text-dim">
      <span>{label}</span>
      <input
        type="number" min={1}
        value={settings[key]}
        onChange={(e) => setSettings({ [key]: Math.max(1, Number(e.target.value) || 1) } as any)}
        className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right"
      />
    </label>
  );

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-panel px-3 py-2.5">
        <div>
          <div className="text-sm text-slate-200">启用生平压缩</div>
          <div className="text-[13px] text-dim/70 mt-0.5">记忆达阈值时，AI 自动合并/提炼角色短期与长期记忆</div>
        </div>
        <Toggle checked={settings.enabled} onChange={() => setSettings({ enabled: !settings.enabled })} />
      </div>

      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-2">
        <div className="text-sm text-dim mb-1">压缩范围</div>
        <div className="flex gap-1">
          {([['both', '主角+NPC'], ['player', '仅主角'], ['npc', '仅NPC']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setSettings({ scope: v })}
              className={`flex-1 py-1.5 rounded text-sm font-mono border transition-colors ${
                settings.scope === v ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'
              }`}
            >{label}</button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-2">
        <div className="text-sm text-dim mb-1">触发阈值 / 压缩后保留</div>
        {numField('短期记忆触发条数', 'shortTermThreshold')}
        {numField('短期压缩后保留', 'shortTermKeep')}
        {numField('长期记忆触发条数', 'longTermThreshold')}
        {numField('长期压缩后保留', 'longTermKeep')}
      </div>

      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm text-dim">压缩提示词（可直接编辑）</div>
          <button onClick={resetPrompt} className="text-[12px] font-mono text-dim/50 hover:text-god transition-colors">恢复默认</button>
        </div>
        <textarea
          value={settings.prompt}
          onChange={(e) => setSettings({ prompt: e.target.value })}
          rows={16}
          className="w-full bg-void border border-edge rounded px-2 py-1.5 text-[13px] font-mono text-slate-200 outline-none focus:border-god leading-relaxed resize-y"
        />
        <div className="text-[12px] text-dim/50">
          占位符 <code className="text-god/60">{'${characters_payload}'}</code> 会被替换为待压缩角色的记忆数据；要求 AI 只输出 JSON
          <code className="text-god/60">{' {results:{<id>:{shortTerm,longTerm,bio}}} '}</code>。
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   API 设置（可共用正文 API，或独立配置）
════════════════════════════════════════════ */
function ApiSection() {
  return (
    <div className="space-y-6 max-w-xl">
      <ApiRoutePicker routeKey="memory" />
    </div>
  );
}

/* ════════════════════════════════════════════
   主组件
════════════════════════════════════════════ */
type MemTab = 'settings' | 'api';

export default function MemoryManager() {
  const enabled = useMemory((s) => s.settings.enabled);
  const setSettings = useMemory((s) => s.setSettings);
  const [tab, setTab] = useState<MemTab>('settings');

  const tabs: { key: MemTab; label: string; icon: string }[] = [
    { key: 'settings', label: '压缩设置', icon: '📜' },
    { key: 'api',      label: 'API 设置', icon: '⚡' },
  ];

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-edge pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-100">生平压缩 · 记忆整理</h2>
          <p className="text-sm text-dim mt-0.5">
            角色短期/长期记忆达阈值时，AI 自动合并、提炼、迁移并沉淀为生平
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-dim font-mono">{enabled ? '已启用' : '已停用'}</span>
          <Toggle checked={enabled} onChange={() => setSettings({ enabled: !enabled })} />
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-panel rounded-lg border border-edge">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-sm font-mono transition-colors ${
              tab === t.key ? 'bg-god/10 text-god border border-god/30' : 'text-dim hover:text-slate-200'
            }`}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'settings' && <SettingsSection />}
      {tab === 'api'      && <ApiSection />}
    </div>
  );
}
