import { useState } from 'react';
import {
  PROMPT_REGISTRY, promptEffective, promptIsCustom, promptSetCustom, promptReset,
  exportPromptOverrides, importPromptOverrides, type PromptEntry,
} from '../systems/promptRegistry';
import { usePromptOverride } from '../store/promptOverrideStore';

/* 预设中心：各功能主提示词的统一编辑页（罗列 → 编辑 / 恢复默认 / 导入 / 导出）。
   只收录「主提示词」（各功能人设/CoT/规划/风格）；底层护栏规则不在此、玩家改不到。
   底层：field 类绑现有 store 字段、override 类走 promptOverride store（见 systems/promptRegistry.ts）。 */
export default function PromptCenterPanel({ onClose }: { onClose: () => void }) {
  const overrides = usePromptOverride((s) => s.overrides);   // 订阅：override 变→重渲徽标
  void overrides;
  const [editing, setEditing] = useState<PromptEntry | null>(null);
  const [draft, setDraft] = useState('');
  const [view, setView] = useState<'list' | 'io'>('list');
  const [ioText, setIoText] = useState('');
  const [msg, setMsg] = useState('');

  const groups = [...new Set(PROMPT_REGISTRY.map((e) => e.group))];

  const openEdit = (e: PromptEntry) => { setEditing(e); setDraft(promptEffective(e)); setMsg(''); };
  const doSave = () => { if (editing) { promptSetCustom(editing, draft); setMsg('✓ 已保存'); setEditing(null); } };
  const doResetOne = (e: PromptEntry) => { promptReset(e); setDraft(e.def); setMsg('已恢复默认'); };
  const copy = (t: string) => { try { void navigator.clipboard?.writeText(t); setMsg('✓ 已复制到剪贴板'); } catch { setMsg('复制失败（浏览器不允许）'); } };

  const openExport = () => { setIoText(JSON.stringify(exportPromptOverrides(), null, 2)); setView('io'); setMsg(''); };
  const doImport = () => {
    try {
      const parsed = JSON.parse(ioText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const n = importPromptOverrides(parsed as Record<string, unknown>);
        setMsg(`✓ 已导入 ${n} 条`); setView('list'); setIoText('');
      } else setMsg('导入失败：JSON 顶层要是对象');
    } catch { setMsg('导入失败：不是合法 JSON'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-3xl max-h-[90dvh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/70 text-lg">🎛️</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">预设中心 · 各功能主提示词</div>
            <div className="text-[11px] font-mono text-dim/60 truncate">编辑各功能主提示词 · 恢复默认=用内置 · 底层护栏规则不在此</div>
          </div>
          {editing && <button onClick={() => setEditing(null)} className="shrink-0 text-dim/60 hover:text-slate-200 text-[12px] font-mono px-2 py-1 rounded border border-edge transition-colors">← 返回</button>}
          {!editing && view === 'list' && <button onClick={openExport} className="shrink-0 text-dim/60 hover:text-slate-200 text-[12px] font-mono px-2 py-1 rounded border border-edge transition-colors">导入 / 导出</button>}
          {view === 'io' && <button onClick={() => setView('list')} className="shrink-0 text-dim/60 hover:text-slate-200 text-[12px] font-mono px-2 py-1 rounded border border-edge transition-colors">← 返回</button>}
          <button onClick={onClose} className="shrink-0 text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {msg && <div className="shrink-0 px-5 py-1.5 text-[12px] font-mono text-god/80 bg-god/5 border-b border-edge/40">{msg}</div>}

        <div className="flex-1 overflow-y-auto">
          {editing ? (
            <div className="p-4 space-y-3">
              <div>
                <div className="text-sm font-bold text-slate-100">{editing.label}</div>
                {editing.desc && <div className="text-[12px] text-dim/60 mt-0.5">{editing.desc}</div>}
                <div className="text-[11px] font-mono text-dim/40 mt-0.5">键：{editing.key} · {editing.kind === 'field' ? '绑定设置字段' : '提示词覆盖'} · {promptIsCustom(editing) ? '已自定义' : '当前用默认'}</div>
              </div>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={18}
                className="w-full px-3 py-2 bg-black/40 border border-edge rounded-md text-[13px] text-slate-200 font-mono resize-y focus:border-god/50 focus:outline-none leading-relaxed"
                placeholder={editing.def ? '（在此编辑以覆盖内置默认；清空并保存=恢复默认）' : '（留空=不注入）'} />
              <div className="text-[11px] text-dim/50 leading-relaxed bg-black/20 border border-edge/40 rounded-md px-2.5 py-1.5">
                💡 <b className="text-dim/70">支持变量标签</b>（内置默认与你的自定义都支持 · 发送时实时替换 · 未定义的变量原样保留）：
                <span className="text-god/70 font-mono">{' {{user}} {{char}} {{getvar::名}} ${自定义变量} {{roll 1d100}} {{random::A::B}}'}</span>
                {' '}等；变量取自「设置 → 变量管理」的核心态 + 自定义变量（和正文预设同一套宏）。
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={doSave} className="text-[13px] px-3 py-1.5 rounded bg-god/15 border border-god/40 text-god hover:bg-god/25 transition-colors">💾 保存</button>
                {editing.def && <button onClick={() => setDraft(editing.def)} className="text-[13px] px-3 py-1.5 rounded border border-edge text-dim/70 hover:text-slate-200 transition-colors">载入默认全文</button>}
                <button onClick={() => doResetOne(editing)} className="text-[13px] px-3 py-1.5 rounded border border-edge text-dim/70 hover:text-blood transition-colors">↺ 恢复默认</button>
                <button onClick={() => copy(draft)} className="text-[13px] px-3 py-1.5 rounded border border-edge text-dim/70 hover:text-slate-200 transition-colors">📋 复制</button>
                <span className="text-[11px] font-mono text-dim/40 ml-auto">{draft.length} 字</span>
              </div>
            </div>
          ) : view === 'io' ? (
            <div className="p-4 space-y-3">
              <div className="text-[12px] text-dim/70 leading-relaxed">下框是你<b>已自定义</b>的主提示词包（JSON，按功能键）。复制它备份；或粘贴一份 JSON 后点「导入」<b>合并</b>进来（不动未提及的项）。<br /><span className="text-dim/40">提示：全局配置导出也会带上这些（随各自设置一起），此处是可单独分享的主提示词包。</span></div>
              <textarea value={ioText} onChange={(e) => setIoText(e.target.value)} rows={16}
                className="w-full px-3 py-2 bg-black/40 border border-edge rounded-md text-[12px] text-slate-200 font-mono resize-y focus:border-god/50 focus:outline-none"
                placeholder={'{\n  "ITEM_COT_RULE": "...",\n  "guidancePrompt": "..."\n}'} />
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => copy(ioText)} className="text-[13px] px-3 py-1.5 rounded border border-edge text-dim/70 hover:text-slate-200 transition-colors">📋 复制</button>
                <button onClick={doImport} className="text-[13px] px-3 py-1.5 rounded bg-god/15 border border-god/40 text-god hover:bg-god/25 transition-colors">⬇ 导入（合并）</button>
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {groups.map((g) => (
                <div key={g}>
                  <div className="text-xs font-mono text-god/60 uppercase tracking-widest mb-2 px-1">{g}</div>
                  <div className="space-y-1.5">
                    {PROMPT_REGISTRY.filter((e) => e.group === g).map((e) => {
                      const custom = promptIsCustom(e);
                      return (
                        <button key={e.key} onClick={() => openEdit(e)}
                          className="w-full flex items-center gap-3 rounded-lg border border-edge/60 bg-panel/40 px-3 py-2.5 hover:border-god/40 hover:bg-god/[0.04] transition-colors text-left">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-slate-200 truncate">{e.label}</div>
                            {e.desc && <div className="text-[11px] text-dim/50 truncate mt-0.5">{e.desc}</div>}
                          </div>
                          {custom
                            ? <span className="shrink-0 text-[10.5px] font-mono text-amber-300/90 bg-amber-400/10 border border-amber-400/25 rounded-full px-2 py-0.5">已自定义</span>
                            : <span className="shrink-0 text-[10.5px] font-mono text-dim/40 border border-edge/50 rounded-full px-2 py-0.5">默认</span>}
                          <span className="shrink-0 text-dim/30">›</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="text-[11px] font-mono text-dim/40 text-center pt-1">共 {PROMPT_REGISTRY.length} 项主提示词 · 更多功能将陆续接入</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
