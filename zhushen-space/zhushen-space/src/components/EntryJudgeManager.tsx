import { useRef, useState } from 'react';
import { useEntryJudge } from '../store/entryJudgeStore';
import { useSettings } from '../store/settingsStore';
import ApiRoutePicker from './ApiRoutePicker';

/* ── 小开关 ── */
function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${checked ? 'bg-god' : 'bg-edge'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}

/* ── 区块外壳 ── */
function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-edge bg-panel/50 p-5 space-y-4">
      <div>
        <div className="text-[15px] font-bold text-slate-100">{title}</div>
        {desc && <div className="text-xs text-dim mt-1 leading-snug">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

/* ── 可折叠条目（标题 + 启用开关 + 内容编辑）── */
function EntryRow({ title, content, enabled, onToggle, onEdit }: {
  title: string; content: string; enabled: boolean; onToggle: () => void; onEdit?: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-edge bg-panel/60">
      <div className="flex items-center gap-2 px-3 py-2">
        <Toggle checked={enabled} onChange={onToggle} />
        <button onClick={() => setOpen((o) => !o)} className="flex-1 text-left text-sm text-slate-200 truncate hover:text-god">
          {open ? '▾ ' : '▸ '}{title}
        </button>
        <span className="text-[11px] text-dim/70 font-mono shrink-0">{content.length}字</span>
      </div>
      {open && (
        <div className="px-3 pb-3">
          {onEdit ? (
            <textarea
              value={content}
              onChange={(e) => onEdit(e.target.value)}
              rows={Math.min(18, Math.max(4, Math.ceil(content.length / 60)))}
              className="w-full bg-void border border-edge rounded-lg px-3 py-2 text-xs text-slate-300 font-mono leading-relaxed outline-none focus:border-god resize-y"
            />
          ) : (
            <pre className="whitespace-pre-wrap text-xs text-dim leading-relaxed max-h-72 overflow-y-auto">{content}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function EntryJudgeManager() {
  const enabled        = useEntryJudge((s) => s.enabled);
  const webSearch      = useEntryJudge((s) => s.webSearch);
  const requestTimeout = useEntryJudge((s) => s.requestTimeout);
  const presetName     = useEntryJudge((s) => s.presetName);
  const entries        = useEntryJudge((s) => s.entries);
  const setEnabled     = useEntryJudge((s) => s.setEnabled);
  const setWebSearch   = useEntryJudge((s) => s.setWebSearch);
  const setRequestTimeout = useEntryJudge((s) => s.setRequestTimeout);
  const toggleEntry    = useEntryJudge((s) => s.toggleEntry);
  const updateEntry    = useEntryJudge((s) => s.updateEntry);
  const importPreset   = useEntryJudge((s) => s.importPreset);

  const textWorldBooks = useSettings((s) => s.textWorldBooks);
  const toggleTextWorldBook = useSettings((s) => s.toggleTextWorldBook);
  const toggleTextWorldBookEntry = useSettings((s) => s.toggleTextWorldBookEntry);
  const updateTextWorldBookEntry = useSettings((s) => s.updateTextWorldBookEntry);
  const importTextWorldBook = useSettings((s) => s.importTextWorldBook);

  const codex = textWorldBooks.find((b) => b.builtinKey === 'twb-power');
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 4000); };

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const r = importPreset(text);
      flash(r.message);
    } catch (e: any) { flash(`导入失败：${e?.message ?? ''}`); }
  };

  const onExport = () => {
    const data = {
      name: presetName,
      entrySharedRules: entries.map((e) => ({ id: e.identifier, name: e.name, content: e.content, enabled: e.enabled, role: e.role })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '登场判断预设.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onResetCodex = async () => {
    try {
      const base = import.meta.env.BASE_URL || '/';
      const r = await fetch(base + 'presets/power-codex.json');
      if (!r.ok) { flash('重置失败：拉取内置图鉴出错'); return; }
      const json = await r.text();
      importTextWorldBook(json, '阶位·生物强度战力图鉴', true, 'twb-power');
      flash('✓ 战力图鉴已重置为内置最新');
    } catch (e: any) { flash(`重置失败：${e?.message ?? ''}`); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="rounded-2xl border border-god/30 bg-god/5 p-5">
        <div className="text-lg font-bold text-god">🚪 登场判断</div>
        <div className="text-sm text-dim mt-1.5 leading-relaxed">
          每回合先于 NPC 演化运行：判断<b>谁登场 / 谁退场</b>，并给新 NPC 定<b>阶位 · 等级 · 生物强度档</b>（前端据此机械生成六维）。
          已与 NPC 演化<b>彻底分割</b>——拥有独立的 API、世界书、提示词预设与联网开关。
        </div>
      </div>

      {msg && <div className="rounded-lg border border-god/40 bg-god/10 px-4 py-2 text-sm text-god">{msg}</div>}

      {/* ── 总开关 + 联网 ── */}
      <Section title="运行设置">
        <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
          <Toggle checked={enabled} onChange={() => setEnabled(!enabled)} />
          <div>
            <div className="text-sm text-slate-200">启用登场判断</div>
            <div className="text-xs text-dim mt-0.5">关掉后 NPC 管线跳过登场判断阶段（不再自动建档新角色）。</div>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
          <Toggle checked={webSearch} onChange={() => setWebSearch(!webSearch)} />
          <div>
            <div className="text-sm text-slate-200">联网搜索（Gemini google_search）</div>
            <div className="text-xs text-dim mt-0.5">
              开启后给请求加 <code className="text-god/80">tools:[{'{'}google_search:{'{}'}{'}'}]</code>，让模型<b>联网查同人 / 角色资料</b>后再定阶位。
              需所选接口为支持该工具的 Gemini 模型；不支持的接口会报错，请关掉本开关。
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-dim font-mono shrink-0">请求超时(秒)</label>
          <input
            type="number" min={10} max={600} value={requestTimeout}
            onChange={(e) => setRequestTimeout(parseInt(e.target.value) || 90)}
            className="w-28 bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm text-slate-200 font-mono outline-none focus:border-god"
          />
        </div>
      </Section>

      {/* ── API·集成路由 ── */}
      <Section title="API · 集成路由" desc="登场判断走独立路由键 npcEntry。建议从『API 库』选一个更强的模型（如 Opus / Gemini）专跑登场判断，判阶位/强度更准。">
        <ApiRoutePicker routeKey="npcEntry" />
      </Section>

      {/* ── 战力图鉴世界书 ── */}
      <Section title="阶位 · 生物强度战力图鉴（世界书）" desc="登场判断常驻注入这本图鉴当参照系（对照表 + 防虚高红线），专治『小兵给五阶』。在此开关 / 编辑各条；也可在『正文世界书』列表里改。">
        {codex ? (
          <>
            <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
              <Toggle checked={codex.enabled !== false} onChange={() => toggleTextWorldBook(codex.id)} />
              <div className="flex-1">
                <div className="text-sm text-slate-200">{codex.name}</div>
                <div className="text-xs text-dim mt-0.5">{codex.entries.length} 条 · 关掉则登场判断不再注入图鉴</div>
              </div>
              <button onClick={onResetCodex} className="text-xs text-dim hover:text-god border border-edge rounded-lg px-2.5 py-1.5">重置内置</button>
            </div>
            {codex.enabled !== false && (
              <div className="space-y-2">
                {codex.entries.map((e) => (
                  <EntryRow
                    key={e.uid}
                    title={e.comment || `条目${e.uid}`}
                    content={e.content}
                    enabled={e.enabled !== false}
                    onToggle={() => toggleTextWorldBookEntry(codex.id, e.uid)}
                    onEdit={(v) => updateTextWorldBookEntry(codex.id, e.uid, { content: v })}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-dim">未找到内置图鉴（power-codex）。<button onClick={onResetCodex} className="underline text-god hover:text-god/80">点此载入内置</button></div>
        )}
      </Section>

      {/* ── 登场判断提示词预设 ── */}
      <Section title="登场判断提示词预设" desc={`独立于 NPC 演化的提示词条目（当前：${presetName} · ${entries.length} 条）。可导入自定义预设 / 导出当前。注：与其它演化预设一样，刷新会重载内置默认，编辑用于当次会话调试。`}>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => fileRef.current?.click()} className="text-sm text-slate-200 border border-edge rounded-lg px-3 py-1.5 hover:border-god">📥 导入预设</button>
          <button onClick={onExport} className="text-sm text-slate-200 border border-edge rounded-lg px-3 py-1.5 hover:border-god">📤 导出当前</button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ''; }} />
        </div>
        <div className="space-y-2">
          {entries.length === 0
            ? <div className="text-sm text-dim">（暂无条目，刷新页面会自动从内置 entry-judge.json 补种）</div>
            : entries.map((e) => (
              <EntryRow
                key={e.identifier}
                title={e.name || e.identifier}
                content={e.content}
                enabled={e.enabled !== false}
                onToggle={() => toggleEntry(e.identifier)}
                onEdit={(v) => updateEntry(e.identifier, { content: v })}
              />
            ))}
        </div>
      </Section>
    </div>
  );
}
