import { useRef, useState } from 'react';
import { usePetEvo } from '../store/petEvoStore';
import { extractNpcPresetFromJson } from '../store/npcEvoStore';
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
      <div
        className="w-3 h-3 rounded-full bg-white mx-1 transition-all"
        style={{ transform: checked ? 'translateX(16px)' : 'none' }}
      />
    </button>
  );
}

/* ════════════════════════════════════════════
   宠物 / 召唤物演化管理器（精简合并版）
   —— 与 NPC 演化「规则一致、数据同构」，唯一差异＝独立开关/API/频率 + 「不自行成长」铁则。
════════════════════════════════════════════ */
export default function PetManager() {
  const settings    = usePetEvo((s) => s.settings);
  const setSettings  = usePetEvo((s) => s.setSettings);
  const setEntries   = usePetEvo((s) => s.setPresetEntries);
  const togglePreset = usePetEvo((s) => s.togglePresetEntry);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  const entries = settings.entries ?? [];
  const enabledCount = entries.filter((e) => e.enabled).length;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const raw = ev.target?.result as string;
      const result = extractNpcPresetFromJson(raw);
      if (!result) {
        setMsg('❌ 未识别到有效条目，请确认文件格式');
      } else {
        setEntries(result.entries.filter((x) => x.source !== 'entrySharedRules'), result.name, result.version);
        setMsg(`✓ 已导入「${result.name}」${result.version ? ` v${result.version}` : ''}，共 ${result.entries.length} 条`);
      }
      setTimeout(() => setMsg(''), 5000);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  function handleExport() {
    const payload = {
      name: settings.presetName || '宠物召唤物演化预设',
      version: settings.presetVersion,
      entrySharedRules: entries.map((e) => ({
        id: e.identifier, name: e.name, content: e.content, enabled: e.enabled, role: e.role,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${settings.presetName || 'pet-preset'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {/* 标题 + 启用 */}
      <div className="flex items-start justify-between gap-4 border-b border-edge pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-100">🐾 宠物 / 召唤物演化</h2>
          <p className="text-sm text-dim mt-0.5">
            正文完成后独立运行，为主角豢养的<b className="text-slate-200">宠物</b>与召唤出的<b className="text-slate-200">召唤物</b>维护档案。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-dim font-mono">{settings.enabled ? '已启用' : '已停用'}</span>
          <Toggle checked={settings.enabled} onChange={() => setSettings({ enabled: !settings.enabled })} />
        </div>
      </div>

      {/* 专属说明 */}
      <div className="p-3 bg-teal-500/5 border border-teal-500/30 rounded-xl space-y-1.5 text-[12px] text-dim leading-relaxed">
        <div className="text-sm font-mono text-teal-300/80 uppercase tracking-widest">与 NPC 演化的区别</div>
        <div>· <b className="text-slate-200">严格分流</b>：标签为<b className="text-slate-200">宠物 / 召唤物</b>的角色<b className="text-slate-200">只</b>由本阶段演化，NPC 演化与离场自治都不再碰它们。</div>
        <div>· <b className="text-slate-200">不自行成长</b>：阶位 / 等级 / 六维默认冻结，<b className="text-slate-200">只有正文写明"主人的投入"</b>（喂养 / 灌注 / 契约升级 / 血脉进化 / 并肩历练）才涨，忠于正文不灌水。</div>
        <div>· <b className="text-slate-200">其余完全一致</b>：能穿装备、有性格、六维/HP·EP、11 栏详情全与 NPC 相同，就是标签不一样。花名册在右侧「📇 NPC」面板里按标签筛选查看。</div>
        <div className="text-teal-300/60">演化规则默认复用 NPC 规则体系（每次启动同步为内置最新）；「不自行成长」由代码即时注入，改预设也不会丢。</div>
      </div>

      {/* 更新频率 */}
      <div className="p-4 bg-panel border border-edge rounded-xl space-y-3">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">更新频率</div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={settings.frequency === 1}
              onChange={() => setSettings({ frequency: 1 })} className="accent-god" />
            <span className="text-sm text-slate-300">每回合</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={settings.frequency > 1}
              onChange={() => setSettings({ frequency: settings.frequency === 1 ? 2 : settings.frequency })} className="accent-god" />
            <span className="text-sm text-slate-300">每</span>
            <input type="number" min={2} max={99}
              value={settings.frequency > 1 ? settings.frequency : 2}
              onChange={(e) => setSettings({ frequency: Math.max(2, parseInt(e.target.value) || 2) })}
              className="w-16 bg-void border border-edge rounded px-2 py-0.5 text-sm font-mono text-slate-200 outline-none focus:border-god text-center" />
            <span className="text-sm text-slate-300">回合</span>
          </label>
        </div>
        <div className="text-sm font-mono px-3 py-2 rounded border border-god/30 text-god/80 bg-god/5">
          {settings.frequency === 1 ? '每回合都演化在场 / 羁绊的宠物 / 召唤物' : `每 ${settings.frequency} 回合演化一次（一次合并调用处理所有在场 / 羁绊宠物）`}
        </div>
      </div>

      {/* 预设 */}
      <div className="p-4 bg-panel border border-edge rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-mono text-god/70 uppercase tracking-widest">演化预设</div>
          <div className="text-xs text-dim font-mono">{settings.presetName || '（默认·同 NPC）'} · {enabledCount}/{entries.length} 启用</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".json" onChange={handleFile} className="hidden" />
          <button onClick={() => fileRef.current?.click()}
            className="px-3 py-1.5 rounded-lg border border-edge text-sm text-slate-200 hover:border-god/50 transition-colors">导入预设 JSON</button>
          <button onClick={handleExport} disabled={entries.length === 0}
            className="px-3 py-1.5 rounded-lg border border-edge text-sm text-slate-200 hover:border-god/50 transition-colors disabled:opacity-40">导出</button>
        </div>
        {msg && <div className="text-xs text-god/80 font-mono">{msg}</div>}
        {entries.length > 0 && (
          <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
            {entries.map((e) => (
              <label key={e.identifier} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-void/50 cursor-pointer">
                <input type="checkbox" checked={e.enabled} onChange={() => togglePreset(e.identifier)} className="accent-god" />
                <span className={`text-[13px] truncate ${e.enabled ? 'text-slate-200' : 'text-dim line-through'}`}>{e.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* API */}
      <div className="p-4 bg-panel border border-edge rounded-xl space-y-3">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">API 设置（独立路由）</div>
        <p className="text-xs text-dim leading-snug">
          宠物 / 召唤物演化走<b className="text-slate-200">独立的接口路由</b>——从下方勾选（在「综合设置 → API 接口库」新增 / 编辑接口）。<b className="text-slate-200">留空则回退到正文共享接口</b>。
        </p>
        <ApiRoutePicker routeKey="pet" />
      </div>
    </div>
  );
}
