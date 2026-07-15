import { useRef, useState } from 'react';
import { useNpcEvo, extractNpcPresetFromJson, type NpcPresetEntry } from '../store/npcEvoStore';
import { useNpc } from '../store/npcStore';
import { usePlayer } from '../store/playerStore';
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
      <div
        className="w-3 h-3 rounded-full bg-white mx-1 transition-all"
        style={{ transform: checked ? 'translateX(16px)' : 'none' }}
      />
    </button>
  );
}

/* ── 条目行 ── */
function EntryRow({ entry, onToggle }: { entry: NpcPresetEntry; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const updateEntry = useNpcEvo((s) => s.updatePresetEntry);
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
  const entries     = useNpcEvo((s) => s.settings.entries ?? []);
  const toggleEntry = useNpcEvo((s) => s.togglePresetEntry);

  const [page,        setPage]        = useState(0);
  const [searchQ,     setSearchQ]     = useState('');
  const [enabledOnly, setEnabledOnly] = useState(false);

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
      <div className="flex items-center gap-2 px-3 py-2 bg-panel2 border-b border-edge">
        <input
          value={searchQ}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="搜索条目名称或内容…"
          className="flex-1 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god placeholder:text-dim/30"
        />
        <button
          onClick={handleEnabledOnly}
          className={`shrink-0 px-2 py-1 rounded border text-[12px] font-mono transition-colors ${
            enabledOnly
              ? 'border-god/50 text-god bg-god/10'
              : 'border-edge text-dim hover:border-god/40 hover:text-god'
          }`}
        >
          {enabledOnly ? '✓ 仅启用' : '全部'}
        </button>
      </div>

      <div className="flex items-center gap-4 px-3 py-2 bg-panel2 border-b border-edge text-[12px] font-mono text-dim">
        <span className="flex-1">条目名称</span>
        <span>来源</span>
        <span className="w-12 text-right">词符</span>
        <span className="w-10" />
      </div>

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

/* ── NPC 图鉴面板 ── */
function NpcRoster() {
  const records = Object.values(useNpc((s) => s.npcs));
  const removeNpc = useNpc((s) => s.removeNpc);
  const hardRemoveNpc = useNpc((s) => s.hardRemoveNpc);
  const upsertNpc = useNpc((s) => s.upsertNpc);
  const absorbOrphans = useNpc((s) => s.absorbOrphans);
  const clearAll  = useNpc((s) => s.clearAll);
  const [confirmClear, setConfirmClear] = useState(false);
  const [mergeMsg, setMergeMsg] = useState('');

  const onScene  = records.filter((r) => r.onScene);
  const offScene = records.filter((r) => !r.onScene);
  const orphanCount = records.filter(
    (r) => (r.items?.length ?? 0) > 0 && !(r.name && r.name !== r.id && (r.realm || r.personality || r.background)),
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">NPC 档案库</div>
        <div className="flex gap-2">
          {orphanCount > 0 && (
            <button
              onClick={() => {
                const n = absorbOrphans();
                setMergeMsg(n > 0 ? `✓ 已并入 ${n} 个空壳档案` : '无可合并目标');
                setTimeout(() => setMergeMsg(''), 4000);
              }}
              title="把只有物品、没有姓名/阶位的空壳档案并入最近的真实在场NPC"
              className="px-3 py-1.5 text-sm rounded-lg border border-amber-600/50 text-amber-400 font-mono hover:bg-amber-900/20 transition-colors"
            >
              整理空壳档案 ({orphanCount})
            </button>
          )}
          {mergeMsg && <span className="text-sm font-mono text-god self-center">{mergeMsg}</span>}
          {records.length > 0 && (
            <button
              onClick={() => {
                if (!confirmClear) { setConfirmClear(true); return; }
                clearAll();
                setConfirmClear(false);
              }}
              onBlur={() => setConfirmClear(false)}
              className={`px-3 py-1.5 text-sm rounded-lg border font-mono transition-colors ${
                confirmClear
                  ? 'border-blood/60 text-blood bg-blood/10'
                  : 'border-edge text-dim hover:border-blood/40 hover:text-blood'
              }`}
            >
              {confirmClear ? '确认清空？' : `清空档案 (${records.length})`}
            </button>
          )}
        </div>
      </div>

      {records.length === 0 && (
        <div className="text-sm text-dim/40 font-mono py-4 text-center border border-dashed border-edge rounded-lg">
          暂无 NPC 档案。AI 回复中的 add() 指令会自动创建档案。
        </div>
      )}

      {onScene.length > 0 && (
        <div className="space-y-2">
          <div className="text-[12px] font-mono text-god/50 uppercase tracking-widest">在场 A 区 ({onScene.length})</div>
          <div className="divide-y divide-edge/30 border border-edge rounded-xl overflow-hidden bg-panel">
            {onScene.map((npc) => (
              <NpcRow key={npc.id} npc={npc} onRemove={() => removeNpc(npc.id)} />
            ))}
          </div>
        </div>
      )}

      {offScene.length > 0 && (
        <div className="space-y-2">
          <div className="text-[12px] font-mono text-dim/40 uppercase tracking-widest">离场 B 区 ({offScene.length})</div>
          <div className="text-[11px] font-mono text-dim/30">归档≠删除：这些角色已离场保留在档，随时可「↑上场」拉回；「删除」才是彻底清除、不可恢复。</div>
          <div className="divide-y divide-edge/30 border border-edge rounded-xl overflow-hidden bg-panel opacity-60">
            {offScene.map((npc) => (
              <NpcRow key={npc.id} npc={npc} onRemove={() => hardRemoveNpc(npc.id)} onRestore={() => upsertNpc(npc.id, { onScene: true })} danger />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NpcRow({ npc, onRemove, onRestore, danger }: { npc: import('../store/npcStore').NpcRecord; onRemove: () => void; onRestore?: () => void; danger?: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);   // danger=物理删除时两步确认，防误触把归档角色永久清掉

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${
          npc.onScene ? 'border-god/40 text-god/70 bg-god/5' : 'border-edge text-dim/40'
        }`}>
          {npc.id}
        </span>
        <span className="flex-1 text-sm text-slate-300 font-mono truncate">
          {npc.name}{npc.gender ? `·${npc.gender}` : ''}{npc.realm ? ` [${npc.realm}]` : ''}
        </span>
        {npc.favor !== 0 && (
          <span className={`text-[12px] font-mono ${npc.favor > 0 ? 'text-god/70' : 'text-blood/70'}`}>
            好感:{npc.favor > 0 ? '+' : ''}{npc.favor}
          </span>
        )}
        <button onClick={() => setOpen(!open)} className="text-[12px] font-mono text-dim/50 hover:text-god transition-colors">
          {open ? '收起' : '详情'}
        </button>
        {onRestore && (
          <button onClick={onRestore} title="拉回·重新上场（归档角色不会丢，随时可召回）"
            className="text-[12px] font-mono text-dim/50 hover:text-god transition-colors">↑ 上场</button>
        )}
        <button
          onClick={() => { if (danger && !confirmDel) { setConfirmDel(true); return; } setConfirmDel(false); onRemove(); }}
          onBlur={() => setConfirmDel(false)}
          title={danger ? '彻底删除该 NPC（不可恢复）' : '令其离场·归档（可在 B 区拉回）'}
          className={`text-[12px] font-mono transition-colors ${confirmDel ? 'text-blood' : 'text-dim/30 hover:text-blood'}`}
        >
          {npc.onScene ? '离场' : confirmDel ? '确认删除' : '删除'}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-1 text-[13px] font-mono text-dim/70 pl-2 border-l border-edge/50">
          {npc.personality && <div><span className="text-god/50">性格·</span>{npc.personality}</div>}
          {npc.status && npc.status !== '一切正常' && <div><span className="text-god/50">状态·</span>{npc.status}</div>}
          {npc.innerThought && <div><span className="text-god/50">心理·</span>{npc.innerThought}</div>}
          {npc.relations && <div><span className="text-god/50">关系·</span>{npc.relations}</div>}
          {npc.motiveNow && <div><span className="text-god/50">动机·</span>{npc.motiveNow}</div>}
          {npc.background && <div><span className="text-god/50">背景·</span>{npc.background.slice(0, 100)}{npc.background.length > 100 ? '…' : ''}</div>}
          {Object.keys(npc.extra).length > 0 && (
            <div><span className="text-god/50">其他·</span>{JSON.stringify(npc.extra).slice(0, 80)}</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 预设设置面板 ── */
function PresetSettings() {
  const settings       = useNpcEvo((s) => s.settings);
  const setSettings    = useNpcEvo((s) => s.setSettings);
  const setEntries     = useNpcEvo((s) => s.setPresetEntries);
  const clearPreset    = useNpcEvo((s) => s.clearPreset);
  const deleteDisabled = useNpcEvo((s) => s.deleteDisabledEntries);
  const smartFilter    = useNpcEvo((s) => s.smartFilterEntries);
  const fileRef        = useRef<HTMLInputElement>(null);
  const [msg, setMsg]  = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  const disabledCount = (settings.entries ?? []).filter((e) => !e.enabled).length;

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
        setEntries(result.entries, result.name, result.version);
        setMsg(`✓ 已导入「${result.name}」${result.version ? ` v${result.version}` : ''}，共 ${result.entries.length} 条`);
      }
      setTimeout(() => setMsg(''), 5000);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  function handleExport() {
    const entries = settings.entries ?? [];
    const payload = {
      name: settings.presetName || 'NPC演化预设',
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
    a.download = `${settings.presetName || 'npc-preset'}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
              onChange={() => setSettings({ frequency: settings.frequency === 1 ? 2 : settings.frequency })}
              className="accent-god"
            />
            <span className="text-sm text-slate-300">每</span>
            <input
              type="number" min={2} max={99}
              value={settings.frequency > 1 ? settings.frequency : 2}
              onChange={(e) => setSettings({ frequency: Math.max(2, parseInt(e.target.value) || 2) })}
              className="w-16 bg-void border border-edge rounded px-2 py-0.5 text-sm font-mono text-slate-200 outline-none focus:border-god text-center"
            />
            <span className="text-sm text-slate-300">回合</span>
          </label>
        </div>
        <div className="text-sm font-mono px-3 py-2 rounded border border-god/30 text-god/80 bg-god/5">
          {settings.frequency === 1
            ? '● 每次 AI 回复完成后处理 NPC 演化'
            : `● 每隔 ${settings.frequency} 回合处理一次 NPC 演化（推荐 2-3 回合节省 token）`}
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
            未加载预设，导入 NPC演化.json 后可逐条启用/禁用规则
          </div>
        )}

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
                setMsg(`✓ 智能筛选完成：保留 ${kept} 条 NPC 演化相关条目，其余已禁用`);
                setTimeout(() => setMsg(''), 5000);
              }}
              className="px-3 py-2 border border-amber-600/50 text-amber-400 text-sm rounded-lg hover:bg-amber-900/20 transition-colors font-mono"
              title="按当前策略保留所需条目（策略B额外启用登场判断与单角色约束条目）"
            >
              ⚡ 智能筛选
            </button>
          )}

          {disabledCount > 0 && (
            <button
              onClick={() => {
                if (!confirmDel) { setConfirmDel(true); return; }
                const removed = deleteDisabled();
                setConfirmDel(false);
                setMsg(`✓ 已删除 ${removed} 条未开启条目`);
                setTimeout(() => setMsg(''), 4000);
              }}
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

      {/* NPC 档案 */}
      <NpcRoster />
    </div>
  );
}

/* ── API 设置 ── */
function NpcApiSection() {
  return (
    <div className="space-y-6">
      <div className="border-b border-edge pb-3">
        <h2 className="text-base font-bold text-slate-100">NPC 演化 API</h2>
        <p className="text-sm text-dim mt-0.5">
          用于 NPC 演化阶段的语言模型接口——从下方接口路由勾选（在「综合设置 → API 接口库」新增 / 编辑接口）
        </p>
      </div>

      <ApiRoutePicker routeKey="npc" />

      <div className="space-y-1.5 p-3 bg-panel/60 border border-edge rounded-lg">
        <div className="text-sm text-slate-200">登场判断·专用接口（可选）</div>
        <div className="text-xs text-dim leading-snug">登场判断负责给<b>新 NPC 定阶位 / 等级 / 生物强度档</b>，很吃模型的判断力（判飘了小兵也能给五阶）。可在此单独挂一个更强的接口（如 Opus / Gemini）专跑登场判断；它会读到内置「阶位·生物强度战力图鉴」世界书作参照。<b>留空则沿用上面的 NPC 接口</b>，行为不变。</div>
        <ApiRoutePicker routeKey="npcEntry" />
      </div>
    </div>
  );
}

/* ── 调度面板（策略B：触发频率 + 调度预算 + 清理提醒）── */
function Scheduling() {
  const strategy      = useNpcEvo((s) => s.settings.strategy);
  const scheduling    = useNpcEvo((s) => s.settings.scheduling);
  const setScheduling = useNpcEvo((s) => s.setScheduling);
  const npcs          = useNpc((s) => s.npcs);
  const setSchedule   = useNpc((s) => s.setSchedule);
  const upsertNpc     = useNpc((s) => s.upsertNpc);

  const records = Object.values(npcs);
  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [batchMode, setBatchMode]       = useState<'turn' | 'date'>(scheduling.defaultFreqMode);
  const [batchInterval, setBatchInterval] = useState(scheduling.defaultFreqInterval);
  const [msg, setMsg] = useState('');

  function effFreq(r: import('../store/npcStore').NpcRecord): string {
    if (r.isDead) return '已死亡';
    if (r.onScene) return '在场·必演化';
    const mode = r.freqMode ?? scheduling.defaultFreqMode;
    const iv   = r.freqInterval ?? scheduling.defaultFreqInterval;
    return mode === 'turn' ? `每${iv}回合` : `每${iv}日变化`;
  }
  function toggleSel(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function applyBatch() {
    if (selected.size === 0) { setMsg('请先勾选目标'); setTimeout(() => setMsg(''), 2500); return; }
    selected.forEach((id) => setSchedule(id, { freqMode: batchMode, freqInterval: Math.max(1, batchInterval) }));
    setMsg(`✓ 已应用到 ${selected.size} 个目标`);
    setTimeout(() => setMsg(''), 3000);
  }
  function toggleFocus(id: string) {
    const cur = new Set(scheduling.manualFocusIds ?? []);
    cur.has(id) ? cur.delete(id) : cur.add(id);
    setScheduling({ manualFocusIds: [...cur] });
  }
  const manualSet = new Set(scheduling.manualFocusIds ?? []);

  return (
    <div className="space-y-5">
      {strategy === 'A' && (
        <div className="text-sm font-mono px-3 py-2 rounded border border-amber-600/40 text-amber-400/90 bg-amber-900/10">
          ⚠ 当前为「策略A：单次合并调用」，调度设置仅在「策略B」下生效。可在顶部切换策略。
        </div>
      )}

      {/* 目标选择模式 */}
      <div className="p-4 bg-panel border border-edge rounded-xl space-y-3">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">目标选择模式</div>
        <p className="text-[13px] text-dim">决定本轮由系统自动调度，还是只推进手动重点列表。</p>
        <div className="flex gap-1">
          {([['auto', '自动 NPC 调度（推荐）'], ['manual', '手动重点列表']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setScheduling({ targetMode: v })}
              className={`flex-1 py-1.5 rounded text-sm font-mono border transition-colors ${
                scheduling.targetMode === v ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'
              }`}>{label}</button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-4 pt-1">
          <div>
            <div className="text-sm text-slate-200">跳过已死亡角色</div>
            <div className="text-[13px] text-dim mt-0.5">自动调度候选中先过滤已死亡角色，避免浪费请求。</div>
          </div>
          <Toggle checked={scheduling.skipDead !== false} onChange={() => setScheduling({ skipDead: !(scheduling.skipDead !== false) })} />
        </div>
        {scheduling.targetMode === 'manual' && (
          <div className="text-[13px] text-amber-300/80">
            手动模式：只演化下方列表里勾选「★重点」的 NPC（+本轮新登场）。已选 {manualSet.size} 个。
          </div>
        )}
      </div>

      {/* 触发频率 */}
      <div className="p-4 bg-panel border border-edge rounded-xl space-y-3">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">触发频率（逐目标）</div>
        <p className="text-[13px] text-dim">
          B1 固定每回合参与；在场 / 刚登场目标无视频率必演化；只有<strong className="text-slate-300">离场 NPC</strong> 受此频率限制。
        </p>

        {/* 批量改选 */}
        <div className="flex flex-wrap items-end gap-2 p-3 bg-void/40 border border-edge rounded-lg">
          <div className="flex gap-1">
            {(['turn', 'date'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setBatchMode(mode)}
                className={`px-3 py-1.5 rounded text-sm font-mono border transition-colors ${
                  batchMode === mode ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'
                }`}
              >
                {mode === 'turn' ? '按回合计数' : '按日期变化'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] text-dim font-mono">间隔</span>
            <input
              type="number" min={1}
              value={batchInterval}
              onChange={(e) => setBatchInterval(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-16 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 text-center outline-none focus:border-god"
            />
          </div>
          <button
            onClick={applyBatch}
            className="px-3 py-1.5 text-sm border border-god/40 text-god rounded-lg hover:bg-god/10 transition-colors font-mono"
          >
            应用到选中 ({selected.size})
          </button>
          {records.length > 0 && (
            <button
              onClick={() => setSelected(new Set(records.filter((r) => !r.onScene && !r.isDead).map((r) => r.id)))}
              className="px-2 py-1.5 text-[13px] border border-edge text-dim rounded hover:text-slate-200 font-mono"
            >全选离场</button>
          )}
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className="px-2 py-1.5 text-[13px] border border-edge text-dim rounded hover:text-slate-200 font-mono">清空</button>
          )}
          {msg && <span className="text-sm font-mono text-god">{msg}</span>}
        </div>

        {/* 目标列表 */}
        <div className="divide-y divide-edge/30 border border-edge rounded-lg overflow-hidden bg-panel">
          <div className="px-3 py-2 flex items-center gap-2 bg-panel2 text-[13px] font-mono">
            <span className="w-4" />
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-god/40 text-god/70 bg-god/5">B1</span>
            <span className="flex-1 text-slate-300">{usePlayer.getState().profile.name || '主角'}（你）</span>
            <span className="text-god/60">固定每回合</span>
          </div>
          {records.length === 0 ? (
            <div className="py-6 text-center text-dim/40 text-sm font-mono">暂无 NPC 档案</div>
          ) : (
            records.map((r) => (
              <div key={r.id} className="px-3 py-2 flex items-center gap-2 text-[13px] font-mono">
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  disabled={r.onScene || r.isDead}
                  onChange={() => toggleSel(r.id)}
                  className="accent-god w-4 disabled:opacity-30"
                />
                <span className={`text-[11px] px-1.5 py-0.5 rounded border ${
                  r.isDead ? 'border-blood/40 text-blood/60' : r.onScene ? 'border-god/40 text-god/70 bg-god/5' : 'border-edge text-dim/50'
                }`}>{r.id}</span>
                <span className="flex-1 text-slate-300 truncate">
                  {r.name}
                  <span className={`ml-1.5 text-[11px] ${r.onScene ? 'text-god/50' : 'text-dim/40'}`}>
                    {r.isDead ? '已死亡' : r.onScene ? '在场' : '离场'}
                  </span>
                </span>
                {(r.isBond || r.keepForever) && <span className="text-[11px] text-sky-400/70">保留</span>}
                {scheduling.targetMode === 'manual' && !r.isDead && (
                  <button onClick={() => toggleFocus(r.id)}
                    className={`text-[11px] px-1.5 py-0.5 rounded border transition-colors ${
                      manualSet.has(r.id) ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim/50 hover:text-slate-200'
                    }`}>★重点</button>
                )}
                <span className={r.onScene ? 'text-god/60' : 'text-dim/60'}>{effFreq(r)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 并发与超时 */}
      <div className="p-4 bg-panel border border-edge rounded-xl space-y-3">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">并发与超时（策略B）</div>
        <p className="text-[13px] text-dim">
          并发越大越快，也越容易限流/524（表现为 CORS 报错）；超时秒数控制单条请求最长等待。
        </p>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-slate-200">最大并发</div>
            <div className="text-[13px] text-dim mt-0.5">同时发起的 LLM 请求数。范围 1–30。</div>
          </div>
          <input
            type="number" min={1} max={30}
            value={scheduling.concurrency ?? 2}
            onChange={(e) => setScheduling({ concurrency: Math.min(30, Math.max(1, parseInt(e.target.value) || 1)) })}
            className="w-20 bg-void border border-edge rounded px-2 py-1.5 text-sm font-mono text-slate-200 text-center outline-none focus:border-god"
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-slate-200">请求超时（秒）</div>
            <div className="text-[13px] text-dim mt-0.5">单条请求最长等待，超时后按重试次数处理。范围 ≥60。</div>
          </div>
          <input
            type="number" min={60} max={600}
            value={scheduling.requestTimeout ?? 90}
            onChange={(e) => setScheduling({ requestTimeout: Math.min(600, Math.max(60, parseInt(e.target.value) || 90)) })}
            className="w-20 bg-void border border-edge rounded px-2 py-1.5 text-sm font-mono text-slate-200 text-center outline-none focus:border-god"
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-slate-200">重试次数</div>
            <div className="text-[13px] text-dim mt-0.5">单条请求失败后的额外重试次数；范围 0–5。</div>
          </div>
          <input
            type="number" min={0} max={5}
            value={scheduling.retryCount ?? 2}
            onChange={(e) => setScheduling({ retryCount: Math.min(5, Math.max(0, parseInt(e.target.value) || 0)) })}
            className="w-20 bg-void border border-edge rounded px-2 py-1.5 text-sm font-mono text-slate-200 text-center outline-none focus:border-god"
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-slate-200">每回合最多演化数</div>
            <div className="text-[13px] text-dim mt-0.5">本回合最多处理几个 NPC；0 = 不限。</div>
          </div>
          <input
            type="number" min={0} max={99}
            value={scheduling.modelPerTurnLimit ?? 0}
            onChange={(e) => setScheduling({ modelPerTurnLimit: Math.min(99, Math.max(0, parseInt(e.target.value) || 0)) })}
            className="w-20 bg-void border border-edge rounded px-2 py-1.5 text-sm font-mono text-slate-200 text-center outline-none focus:border-god"
          />
        </div>
      </div>

      {/* 调度预算 */}
      <div className="p-4 bg-panel border border-edge rounded-xl space-y-3">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">NPC 调度预算</div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-slate-200">离场活跃名额</div>
            <div className="text-[13px] text-dim mt-0.5">每轮允许多少离场 NPC 进入后台演化；在场/返场/刚登场不占名额。范围 1–999。</div>
          </div>
          <input
            type="number" min={1} max={999}
            value={scheduling.offSceneQuota}
            onChange={(e) => setScheduling({ offSceneQuota: Math.min(999, Math.max(1, parseInt(e.target.value) || 1)) })}
            className="w-20 bg-void border border-edge rounded px-2 py-1.5 text-sm font-mono text-slate-200 text-center outline-none focus:border-god"
          />
        </div>
      </div>

      {/* 清理提醒 */}
      <div className="p-4 bg-panel border border-edge rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-mono text-god/70 uppercase tracking-widest">长期不出场 NPC 清理提醒</div>
          <Toggle checked={scheduling.cleanupEnabled} onChange={() => setScheduling({ cleanupEnabled: !scheduling.cleanupEnabled })} />
        </div>
        <p className="text-[13px] text-dim">
          每隔固定回合提示可清理的长期离场路人；羁绊角色与「永久保留」标记的角色一律不进入清理名单——无论在场或离场、也不受死亡自动清除影响，勾了就绝不会被移除。
        </p>
        {scheduling.cleanupEnabled && (
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-slate-200">清理建议周期</div>
            <input
              type="number" min={1} max={999}
              value={scheduling.cleanupCycle}
              onChange={(e) => setScheduling({ cleanupCycle: Math.min(999, Math.max(1, parseInt(e.target.value) || 1)) })}
              className="w-20 bg-void border border-edge rounded px-2 py-1.5 text-sm font-mono text-slate-200 text-center outline-none focus:border-god"
            />
          </div>
        )}
        {records.some((r) => r.keepForever || r.isBond) && (
          <div className="text-[13px] text-dim">
            已保留：{records.filter((r) => r.keepForever || r.isBond).map((r) => `${r.id}`).join(', ')}
          </div>
        )}
        {/* 永久保留：勾了就在场/离场/清理都绝不移除。列表含【全部已保留角色·不分在场离场】——防"角色一在场 chip 就从列表消失、让人以为保留丢了"（其实 flag 始终在）——外加可继续勾选的离场路人。 */}
        {records.filter((r) => !r.isBond && (r.keepForever || !r.onScene)).length > 0 && (
          <div className="space-y-1 pt-1">
            <div className="text-[12px] font-mono text-dim/50 uppercase tracking-widest">永久保留（勾选后·在场/离场/清理都绝不移除）</div>
            <div className="flex flex-wrap gap-1.5">
              {records.filter((r) => !r.isBond && (r.keepForever || !r.onScene))
                .sort((a, b) => (b.keepForever ? 1 : 0) - (a.keepForever ? 1 : 0))   // 已保留的排在前面，一眼可见、永不因在场而消失
                .map((r) => (
                <button
                  key={r.id}
                  onClick={() => upsertNpc(r.id, { keepForever: !r.keepForever })}
                  title={r.keepForever ? '已永久保留——点击取消保留' : '点击永久保留：此角色在场/离场/清理时都不会被移除'}
                  className={`px-2 py-1 text-[12px] font-mono rounded border transition-colors ${
                    r.keepForever ? 'border-sky-500/50 text-sky-300 bg-sky-900/20' : 'border-edge text-dim hover:text-slate-200'
                  }`}
                >
                  {r.keepForever ? '✓ ' : ''}{r.id} {r.name}{r.onScene ? ' ·在场' : ''}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 死亡 NPC 自动清除 */}
      <div className="p-4 bg-panel border border-edge rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-mono text-god/70 uppercase tracking-widest">死亡 NPC 自动清除</div>
          <Toggle checked={!!scheduling.autoPurgeDead} onChange={() => setScheduling({ autoPurgeDead: !scheduling.autoPurgeDead })} />
        </div>
        <p className="text-[13px] text-dim leading-relaxed">
          确认死亡的 NPC 延迟若干回合后<span className="text-blood/80">物理删除</span>（连同其技能/天赋档案），精简存档。
          <span className="text-amber-300/80"> 护栏：仅强死亡证据触发；羁绊角色与「永久保留」标记不删；延迟期内被复活/纠偏则取消删除。</span>
        </p>
        {scheduling.autoPurgeDead && (
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-slate-200">死亡后延迟回合数</div>
            <input
              type="number" min={0} max={99}
              value={scheduling.deadPurgeDelay ?? 3}
              onChange={(e) => setScheduling({ deadPurgeDelay: Math.min(99, Math.max(0, parseInt(e.target.value) || 0)) })}
              className="w-20 bg-void border border-edge rounded px-2 py-1.5 text-sm font-mono text-slate-200 text-center outline-none focus:border-god"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   主组件
════════════════════════════════════════════ */
type NpcTab = 'settings' | 'schedule' | 'api';

export default function NpcManager() {
  const enabled     = useNpcEvo((s) => s.settings.enabled);
  const strategy    = useNpcEvo((s) => s.settings.strategy);
  const setSettings = useNpcEvo((s) => s.setSettings);
  const autonomyOn       = useSettings((s) => s.npcAutonomyOn);
  const setAutonomyOn    = useSettings((s) => s.setNpcAutonomyOn);
  const autonomyDeath    = useSettings((s) => s.npcAutonomyDeath);
  const setAutonomyDeath = useSettings((s) => s.setNpcAutonomyDeath);
  const autonomyMax      = useSettings((s) => s.npcAutonomyMax);
  const setAutonomyMax   = useSettings((s) => s.setNpcAutonomyMax);
  const autonomyEvery    = useSettings((s) => s.npcAutonomyEvery);
  const setAutonomyEvery = useSettings((s) => s.setNpcAutonomyEvery);
  const [tab, setTab] = useState<NpcTab>('settings');

  const tabs: { key: NpcTab; label: string; icon: string }[] = [
    { key: 'settings', label: '预设设置', icon: '📋' },
    { key: 'schedule', label: '调度',     icon: '🗓' },
    { key: 'api',      label: 'API 设置', icon: '⚡' },
  ];

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-edge pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-100">NPC 演化</h2>
          <p className="text-sm text-dim mt-0.5">
            AI 正文完成后独立运行，为场景中每个 NPC 维护角色档案（阶位、状态、好感度、动机等）
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-dim font-mono">
            {enabled ? '已启用' : '已停用'}
          </span>
          <Toggle checked={enabled} onChange={() => setSettings({ enabled: !enabled })} />
        </div>
      </div>

      {/* 策略切换 A / B */}
      <div className="p-3 bg-panel border border-edge rounded-xl space-y-2">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">运行策略</div>
        <div className="flex gap-2">
          <button
            onClick={() => setSettings({ strategy: 'A' })}
            className={`flex-1 px-3 py-2 rounded-lg border text-sm font-mono text-left transition-colors ${
              strategy === 'A' ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'
            }`}
          >
            <div className="font-bold">策略 A · 单次合并</div>
            <div className="text-[12px] opacity-70 mt-0.5">每回合一次调用处理所有 NPC，省 token</div>
          </button>
          <button
            onClick={() => setSettings({ strategy: 'B' })}
            className={`flex-1 px-3 py-2 rounded-lg border text-sm font-mono text-left transition-colors ${
              strategy === 'B' ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'
            }`}
          >
            <div className="font-bold">策略 B · 逐 NPC 并发</div>
            <div className="text-[12px] opacity-70 mt-0.5">登场判断 + 调度 + 每 NPC 单独演化，忠实原版</div>
          </button>
        </div>
      </div>

      {/* 离场角色自治（轨道A·零 API）：演化 AI 管在场，本开关管离场 NPC 自己活 */}
      <div className="p-3 bg-panel border border-edge rounded-xl space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-mono text-god/70 uppercase tracking-widest">离场角色自治 · 轨道A</div>
          <Toggle checked={autonomyOn} onChange={() => setAutonomyOn(!autonomyOn)} />
        </div>
        <div className="text-[12px] text-dim leading-relaxed">
          开启后<b className="text-slate-200">不在场的契约者/土著</b>每回合<b className="text-slate-200">零 API</b> 地自行过日子——出任务 / 强化 / 竞技 / 结仇结盟 / 壁障考核，土著在故土营生御敌；近况写进各自档案并注入正文，好结局会<b className="text-slate-200">档内有界</b>地涨等级六维（按阶位封顶、不越档）。纯前端确定性、不花 token。默认关。
        </div>
        {autonomyOn && (
          <div className="flex items-start gap-3 pt-2 mt-1 border-t border-edge/60">
            <Toggle checked={autonomyDeath} onChange={() => setAutonomyDeath(!autonomyDeath)} />
            <div className="text-[12px] text-dim leading-relaxed">
              <b className="text-amber-300/90">允许任务致死（陨落）</b>：离场契约者出 E 级任务有<b className="text-slate-200">小概率回不来</b>。<b className="text-slate-200">好友 / 羁绊 / 长留 / 队友永不会死</b>。默认关，怕丢 NPC 就别开。
            </div>
          </div>
        )}
        {autonomyOn && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 mt-1 border-t border-edge/60 text-[12px] text-dim">
            <label className="flex items-center gap-1.5">每次最多演化
              <input type="number" min={1} max={60} value={autonomyMax} onChange={(e) => setAutonomyMax(Number(e.target.value))}
                className="w-14 px-1.5 py-0.5 bg-black/30 border border-edge rounded text-center text-slate-200" /> 人
            </label>
            <label className="flex items-center gap-1.5">每
              <input type="number" min={1} max={30} value={autonomyEvery} onChange={(e) => setAutonomyEvery(Number(e.target.value))}
                className="w-14 px-1.5 py-0.5 bg-black/30 border border-edge rounded text-center text-slate-200" /> 回合运行一次
            </label>
            <span className="text-dim/60">超出上限的离场 NPC 按轮换分批演化，不会漏掉。</span>
          </div>
        )}
      </div>

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

      {tab === 'settings' && <PresetSettings />}
      {tab === 'schedule' && <Scheduling />}
      {tab === 'api'      && <NpcApiSection />}
    </div>
  );
}
