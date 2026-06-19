import { useRef, useState } from 'react';
import { usePlayer, extractPlayerPresetFromJson, type PlayerPresetEntry } from '../store/playerStore';
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

/* ── 条目行 ── */
function EntryRow({
  entry,
  onToggle,
}: {
  entry: PlayerPresetEntry;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const updateEntry = usePlayer((s) => s.updatePresetEntry);
  const [editName, setEditName] = useState(entry.name);
  const [editContent, setEditContent] = useState(entry.content);

  function saveEdit() {
    updateEntry(entry.identifier, { name: editName, content: editContent });
    setOpen(false);
  }

  return (
    <div className={`px-3 py-2 ${!entry.enabled ? 'opacity-40' : ''}`}>
      <div className="flex items-center gap-2">
        <Toggle checked={entry.enabled} onChange={onToggle} />
        <span className="flex-1 text-sm text-slate-300 truncate font-mono">{entry.name}</span>
        {entry.source && (
          <span className="text-[11px] font-mono text-dim/40 shrink-0 hidden sm:inline">
            {entry.source.replace('prompts.', '')}
          </span>
        )}
        <span className="text-[11px] font-mono text-dim/40 shrink-0 w-12 text-right">
          {Math.round(entry.content.length / 3.5)}t
        </span>
        <button
          onClick={() => { setOpen(!open); setEditName(entry.name); setEditContent(entry.content); }}
          className="text-[12px] font-mono text-dim/50 hover:text-god transition-colors shrink-0"
        >
          {open ? '收起' : '编辑'}
        </button>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god"
            placeholder="条目名称"
          />
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={6}
            className="w-full bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god resize-y"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="px-4 py-1.5 text-sm border border-edge text-dim rounded-lg hover:border-blood/40 hover:text-blood transition-colors font-mono"
            >
              取消
            </button>
            <button
              onClick={saveEdit}
              className="px-5 py-1.5 text-sm border border-god/50 text-god rounded-lg hover:bg-god/10 transition-colors font-mono"
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 条目列表（带搜索 / 只看已启用 / 分页） ── */
const PAGE_SIZE = 10;

function EntryList() {
  const entries     = usePlayer((s) => s.settings.entries ?? []);
  const toggleEntry = usePlayer((s) => s.togglePresetEntry);

  const [page,          setPage]          = useState(0);
  const [searchQ,       setSearchQ]       = useState('');
  const [enabledOnly,   setEnabledOnly]   = useState(false);

  const filtered = entries.filter((e) => {
    if (enabledOnly && !e.enabled) return false;
    if (!searchQ) return true;
    const q = searchQ.toLowerCase();
    return e.name.toLowerCase().includes(q) || e.content.toLowerCase().includes(q);
  });

  const enabledCount = entries.filter((e) => e.enabled).length;
  const totalPages   = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage     = Math.min(page, totalPages - 1);
  const paged        = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function handleSearch(v: string) { setSearchQ(v); setPage(0); }
  function handleEnabledOnly()     { setEnabledOnly((p) => !p); setPage(0); }

  return (
    <div className="border border-edge rounded-xl overflow-hidden">
      {/* 搜索 + 筛选栏 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-panel2 border-b border-edge">
        <input
          value={searchQ}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="搜索条目名称或内容…"
          className="flex-1 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god placeholder:text-dim/30"
        />
        <button
          onClick={handleEnabledOnly}
          title="只显示已启用条目"
          className={`shrink-0 px-2 py-1 rounded border text-[12px] font-mono transition-colors ${
            enabledOnly
              ? 'border-god/50 text-god bg-god/10'
              : 'border-edge text-dim hover:border-god/40 hover:text-god'
          }`}
        >
          {enabledOnly ? '✓ 仅启用' : '全部'}
        </button>
      </div>

      {/* 列表头 */}
      <div className="flex items-center gap-4 px-3 py-2 bg-panel2 border-b border-edge text-[12px] font-mono text-dim">
        <span className="flex-1">条目名称</span>
        <span>来源</span>
        <span className="w-12 text-right">词符</span>
        <span className="w-10" />
      </div>

      {/* 条目行 */}
      <div className="divide-y divide-edge/30 bg-panel">
        {paged.length === 0 ? (
          <div className="py-8 text-center text-dim/30 text-sm font-mono">无匹配条目</div>
        ) : (
          paged.map((entry) => (
            <EntryRow
              key={entry.identifier}
              entry={entry}
              onToggle={() => toggleEntry(entry.identifier)}
            />
          ))
        )}
      </div>

      {/* 底部：统计 + 翻页 */}
      <div className="flex items-center justify-between px-3 py-2 bg-panel2 border-t border-edge text-[12px] font-mono text-dim">
        <span className="text-dim/60">
          {searchQ || enabledOnly
            ? `${filtered.length} / ${entries.length} 条`
            : `共 ${entries.length} 条`}
          {' · '}已启用 {enabledCount} 条
          {enabledCount > 0 && (
            <span className={`ml-2 ${
              entries.filter((e) => e.enabled).reduce((s, e) => s + e.content.length, 0) > 8000
                ? 'text-blood/70'
                : 'text-god/50'
            }`}>
              · 约 {Math.round(
                entries.filter((e) => e.enabled).reduce((s, e) => s + e.content.length, 0) / 3.5
              )} tokens
              {entries.filter((e) => e.enabled).reduce((s, e) => s + e.content.length, 0) > 8000 && ' ⚠ 过长'}
            </span>
          )}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="px-2 py-0.5 border border-edge rounded hover:border-god/40 hover:text-god disabled:opacity-30 transition-colors"
            >
              ←
            </button>
            <span className="text-dim/70">{safePage + 1} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="px-2 py-0.5 border border-edge rounded hover:border-god/40 hover:text-god disabled:opacity-30 transition-colors"
            >
              →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 预设设置面板 ── */
function PresetSettings() {
  const settings          = usePlayer((s) => s.settings);
  const setSettings       = usePlayer((s) => s.setSettings);
  const setEntries        = usePlayer((s) => s.setPresetEntries);
  const clearPreset       = usePlayer((s) => s.clearPreset);
  const deleteDisabled    = usePlayer((s) => s.deleteDisabledEntries);
  const smartFilter       = usePlayer((s) => s.smartFilterEntries);
  const fileRef           = useRef<HTMLInputElement>(null);
  const [msg, setMsg]     = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  const disabledCount = (settings.entries ?? []).filter((e) => !e.enabled).length;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const raw = ev.target?.result as string;
      const result = extractPlayerPresetFromJson(raw);
      if (!result) {
        setMsg('❌ 未识别到有效条目，请确认文件格式');
      } else {
        setEntries(result.entries, result.name, result.version);
        setMsg(
          `✓ 已导入「${result.name}」${result.version ? ` v${result.version}` : ''}，共 ${result.entries.length} 条`
        );
      }
      setTimeout(() => setMsg(''), 5000);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  function handleExport() {
    const entries = settings.entries ?? [];
    const payload = {
      name: settings.presetName || '主角演化预设',
      version: settings.presetVersion,
      entrySharedRules: entries.map((e) => ({
        id:      e.identifier,
        name:    e.name,
        content: e.content,
        enabled: e.enabled,
        role:    e.role,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${settings.presetName || 'player-preset'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDeleteDisabled() {
    if (!confirmDel) { setConfirmDel(true); return; }
    const removed = deleteDisabled();
    setConfirmDel(false);
    setMsg(`✓ 已删除 ${removed} 条未开启条目`);
    setTimeout(() => setMsg(''), 4000);
  }

  return (
    <div className="space-y-5">

      {/* 更新频率 */}
      <div className="p-4 bg-panel border border-edge rounded-xl space-y-3">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">更新频率</div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={settings.frequency === 1}
              onChange={() => setSettings({ frequency: 1 })}
              className="accent-god"
            />
            <span className="text-sm text-slate-300">每回合</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={settings.frequency > 1}
              onChange={() => setSettings({ frequency: settings.frequency === 1 ? 3 : settings.frequency })}
              className="accent-god"
            />
            <span className="text-sm text-slate-300">每</span>
            <input
              type="number" min={2} max={99}
              value={settings.frequency > 1 ? settings.frequency : 3}
              onChange={(e) => setSettings({ frequency: Math.max(2, parseInt(e.target.value) || 2) })}
              className="w-16 bg-void border border-edge rounded px-2 py-0.5 text-sm font-mono text-slate-200 outline-none focus:border-god text-center"
            />
            <span className="text-sm text-slate-300">回合</span>
          </label>
        </div>
        <div className="text-sm font-mono px-3 py-2 rounded border border-god/30 text-god/80 bg-god/5">
          {settings.frequency === 1
            ? '● 每次 AI 回复完成后处理主角演化'
            : `● 每隔 ${settings.frequency} 回合处理一次主角演化`}
        </div>
      </div>

      {/* 主角面板对账纠错 */}
      <div className="p-4 bg-panel border border-edge rounded-xl space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.auditEnabled !== false}
            onChange={(e) => setSettings({ auditEnabled: e.target.checked })}
            className="accent-god w-4 h-4"
          />
          <span className="text-sm font-mono text-god/70 uppercase tracking-widest">主角面板对账纠错</span>
        </label>
        <div className="text-[13px] text-dim/70 leading-relaxed">
          勾选后，会把<b>主角面板检查</b>纳入回合末的<b>「综合对账纠错」</b>——它在<b>主角演化 + 物品演化都跑完后只调一次</b> AI：
          看「应用后真实面板 + 最近两回合正文」，逐项核对 六维/HP·EP·SAN/状态Buff/技能天赋/等级阶位/位置外观，补<b>遗漏更新</b>、改<b>错误更新</b>（不凭空想象、只管主角）。
          与「物品管理」里的同名开关<b>共用这一次调用</b>（不再各调一次）。关闭则综合对账不查主角面板。
        </div>
      </div>

      {/* 预设文件 */}
      <div className="p-4 bg-panel border border-edge rounded-xl space-y-3">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">预设文件</div>

        {settings.presetName ? (
          <div className="flex items-center justify-between p-3 bg-god/5 border border-god/20 rounded-lg">
            <div>
              <div className="text-sm font-semibold text-god">{settings.presetName}</div>
              {settings.presetVersion && (
                <div className="text-[13px] text-dim font-mono">v{settings.presetVersion}</div>
              )}
              <div className="text-[13px] text-dim mt-0.5">
                {(settings.entries ?? []).length} 条 · 已启用{' '}
                {(settings.entries ?? []).filter((e) => e.enabled).length} 条
              </div>
            </div>
            <button
              onClick={clearPreset}
              className="text-sm text-dim hover:text-blood font-mono transition-colors"
            >
              清除
            </button>
          </div>
        ) : (
          <div className="text-sm text-dim font-mono py-3 text-center border border-dashed border-edge rounded-lg">
            未加载预设，导入 JSON 后可逐条启用/禁用规则
          </div>
        )}

        {/* 操作按钮行 */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => fileRef.current?.click()}
            className="px-4 py-2 border border-god/40 text-god text-sm rounded-lg hover:bg-god/10 transition-colors font-mono"
          >
            导入预设 JSON
          </button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />

          {(settings.entries ?? []).length > 0 && (
            <button
              onClick={handleExport}
              className="px-4 py-2 border border-sky-600/50 text-sky-400 text-sm rounded-lg hover:bg-sky-900/20 transition-colors font-mono"
            >
              导出预设 JSON
            </button>
          )}

          {settings.entries.length > 0 && (
            <button
              onClick={() => {
                const kept = smartFilter();
                setMsg(`✓ 智能筛选完成：保留 ${kept} 条主角演化相关条目，其余已禁用`);
                setTimeout(() => setMsg(''), 5000);
              }}
              className="px-3 py-2 border border-amber-600/50 text-amber-400 text-sm rounded-lg hover:bg-amber-900/20 transition-colors font-mono"
              title="只保留主角演化所需条目，禁用 NPC、物品、地图等无关内容"
            >
              ⚡ 智能筛选
            </button>
          )}

          {disabledCount > 0 && (
            <button
              onClick={handleDeleteDisabled}
              onBlur={() => setConfirmDel(false)}
              className={`px-4 py-2 text-sm rounded-lg transition-colors font-mono border ${
                confirmDel
                  ? 'border-blood/60 text-blood bg-blood/10'
                  : 'border-edge text-dim hover:border-blood/40 hover:text-blood'
              }`}
            >
              {confirmDel ? `确认删除 ${disabledCount} 条？` : `删除未开启 (${disabledCount})`}
            </button>
          )}

          {msg && (
            <span className={`text-sm font-mono ${msg.startsWith('❌') ? 'text-blood' : 'text-god'}`}>
              {msg}
            </span>
          )}
        </div>
      </div>

      {/* 条目列表 */}
      {(settings.entries ?? []).length > 0 && <EntryList />}
    </div>
  );
}

/* ── API 设置 ── */
function PlayerApiSection() {

  const playerApi          = usePlayer((s) => s.playerApi);
  const playerUseSharedApi = usePlayer((s) => s.playerUseSharedApi);
  const availableModels    = usePlayer((s) => s.playerAvailableModels);
  const modelsLoading      = usePlayer((s) => s.playerModelsLoading);
  const modelsError        = usePlayer((s) => s.playerModelsError);
  const setPlayerApi       = usePlayer((s) => s.setPlayerApi);
  const setPlayerUseShared = usePlayer((s) => s.setPlayerUseSharedApi);
  const fetchModels        = usePlayer((s) => s.fetchPlayerModels);


  return (
    <div className="space-y-6">
      <div className="border-b border-edge pb-3">
        <h2 className="text-base font-bold text-slate-100">主角演化 API</h2>
        <p className="text-sm text-dim mt-0.5">
          用于主角演化阶段的独立语言模型接口，可复用正文生成的接口配置
        </p>
      </div>

      {/* 共用开关 */}
      <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
        <Toggle checked={playerUseSharedApi} onChange={() => setPlayerUseShared(!playerUseSharedApi)} />
        <div>
          <div className="text-sm text-slate-200">与正文生成共用 API</div>
          <div className="text-sm text-dim mt-0.5">
            开启时直接复用正文生成的 API 地址、Key 和模型（含其共用设置）
          </div>
        </div>
      </div>

      <ApiRoutePicker routeKey="player" />
      {/* 独立 API 字段 */}
      {!playerUseSharedApi && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm text-dim font-mono">API 地址</label>
            <input
              type="text"
              value={playerApi.baseUrl}
              onChange={(e) => setPlayerApi({ baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-god"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm text-dim font-mono">API Key</label>
            <input
              type="password"
              value={playerApi.apiKey}
              onChange={(e) => setPlayerApi({ apiKey: e.target.value })}
              placeholder="sk-..."
              className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-slate-200 font-mono outline-none focus:border-god"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm text-dim font-mono">模型</label>
            <div className="flex gap-2">
              {availableModels.length > 0 ? (
                <select
                  value={playerApi.modelId}
                  onChange={(e) => setPlayerApi({ modelId: e.target.value })}
                  className="flex-1 bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-god"
                >
                  {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  value={playerApi.modelId}
                  onChange={(e) => setPlayerApi({ modelId: e.target.value })}
                  placeholder="gpt-4o"
                  className="flex-1 bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-slate-200 font-mono outline-none focus:border-god"
                />
              )}
              <button
                onClick={fetchModels}
                disabled={modelsLoading}
                className="shrink-0 px-3 py-2 border border-god/40 text-god text-sm rounded-lg hover:bg-god/10 disabled:opacity-40 font-mono transition-colors"
              >
                {modelsLoading ? '获取中…' : '刷新模型'}
              </button>
            </div>
            {modelsError && <div className="text-sm text-blood font-mono mt-1">{modelsError}</div>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm text-dim font-mono">温度 ({playerApi.temperature})</label>
              <input
                type="range" min={0} max={2} step={0.05}
                value={playerApi.temperature}
                onChange={(e) => setPlayerApi({ temperature: parseFloat(e.target.value) })}
                className="w-full accent-god mt-1"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-dim font-mono">Top-P ({playerApi.topP})</label>
              <input
                type="range" min={0} max={1} step={0.05}
                value={playerApi.topP}
                onChange={(e) => setPlayerApi({ topP: parseFloat(e.target.value) })}
                className="w-full accent-god mt-1"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-dim font-mono">Max Tokens</label>
              <input
                type="number"
                value={playerApi.maxTokens}
                onChange={(e) => setPlayerApi({ maxTokens: parseInt(e.target.value) || 512 })}
                min={128} max={16384} step={128}
                className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-slate-200 font-mono outline-none focus:border-god"
              />
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

/* ════════════════════════════════════════════
   主组件
════════════════════════════════════════════ */
type PlayerTab = 'settings' | 'api';

export default function PlayerManager() {
  const enabled     = usePlayer((s) => s.settings.enabled);
  const setSettings = usePlayer((s) => s.setSettings);
  const [tab, setTab] = useState<PlayerTab>('settings');

  const tabs: { key: PlayerTab; label: string; icon: string }[] = [
    { key: 'settings', label: '预设设置', icon: '📋' },
    { key: 'api',      label: 'API 设置', icon: '⚡' },
  ];

  return (
    <div className="space-y-4 max-w-2xl">

      {/* 页头 */}
      <div className="flex items-start justify-between gap-4 border-b border-edge pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-100">主角演化</h2>
          <p className="text-sm text-dim mt-0.5">
            AI 正文完成后独立运行，解析并更新主角属性、状态、技能等数据
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-dim font-mono">
            {enabled ? '已启用' : '已停用'}
          </span>
          <Toggle checked={enabled} onChange={() => setSettings({ enabled: !enabled })} />
        </div>
      </div>

      {/* Tab 导航 */}
      <div className="flex gap-1 p-1 bg-panel rounded-lg border border-edge">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-sm font-mono transition-colors ${
              tab === t.key
                ? 'bg-god/10 text-god border border-god/30'
                : 'text-dim hover:text-slate-200'
            }`}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      {tab === 'settings' && <PresetSettings />}
      {tab === 'api'      && <PlayerApiSection />}
    </div>
  );
}
