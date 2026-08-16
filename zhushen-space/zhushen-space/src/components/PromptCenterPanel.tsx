import { useEffect, useMemo, useState } from 'react';
import {
  PROMPT_REGISTRY, promptEffective, promptIsCustom, promptSetCustom, promptReset,
  exportPromptOverrides, importPromptOverrides, reconcilePromptDefaults, promptDefUpdated, type PromptEntry,
} from '../systems/promptRegistry';
import { usePromptOverride } from '../store/promptOverrideStore';
import { useSnippets, newSnippet } from '../store/snippetStore';            // 🧩 片段库（{{include::名}}）
import { newPromptInject, type PromptInject } from '../systems/customInject';   // 🎯 自定义注入条目
import { lintPromptTemplate, lintCondExpr } from '../systems/promptLint';       // 🩺 模板语法体检（只提示不阻断）
import { runtimeVarCatalog } from '../systems/runtimeVars';                     // 体检用：当前可用变量名清单

/* 预设中心：各功能主提示词的统一编辑页（罗列 → 编辑 / 恢复默认 / 导入 / 导出）。
   只收录「主提示词」（各功能人设/CoT/规划/风格）；底层护栏规则不在此、玩家改不到。
   底层：field 类绑现有 store 字段、override 类走 promptOverride store（见 systems/promptRegistry.ts）。 */
export default function PromptCenterPanel({ onClose }: { onClose: () => void }) {
  const overrides = usePromptOverride((s) => s.overrides);   // 订阅：override 变→重渲徽标
  void overrides;
  const [editing, setEditing] = useState<PromptEntry | null>(null);
  const [draft, setDraft] = useState('');
  const [view, setView] = useState<'list' | 'io' | 'snippets' | 'injects'>('list');
  const [ioText, setIoText] = useState('');
  const [msg, setMsg] = useState('');
  // 开面板先对账一次底稿版本（幂等）：没真改过的旧副本自动升级到新版默认，并在 msg 里告知。
  // ⚠ 放 useEffect 而非 useState 初始化器——对账会写 promptOverride store，渲染期 setState 会触发 React 警告
  useEffect(() => {
    try {
      const r = reconcilePromptDefaults();
      if (r.upgraded.length) setMsg(`✨ ${r.upgraded.length} 项未修改的预设已自动升级到新版底稿：${r.upgraded.slice(0, 5).join('、')}${r.upgraded.length > 5 ? '…' : ''}`);
    } catch { /* 对账失败不影响面板 */ }
  }, []);

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
          {!editing && view === 'list' && <button onClick={() => setView('snippets')} className="shrink-0 text-dim/60 hover:text-slate-200 text-[12px] font-mono px-2 py-1 rounded border border-edge transition-colors">🧩 片段库</button>}
          {!editing && view === 'list' && <button onClick={() => setView('injects')} className="shrink-0 text-dim/60 hover:text-slate-200 text-[12px] font-mono px-2 py-1 rounded border border-edge transition-colors">🎯 自定义注入</button>}
          {!editing && view === 'list' && <button onClick={openExport} className="shrink-0 text-dim/60 hover:text-slate-200 text-[12px] font-mono px-2 py-1 rounded border border-edge transition-colors">导入 / 导出</button>}
          {(view === 'io' || view === 'snippets' || view === 'injects') && <button onClick={() => setView('list')} className="shrink-0 text-dim/60 hover:text-slate-200 text-[12px] font-mono px-2 py-1 rounded border border-edge transition-colors">← 返回</button>}
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
                {promptIsCustom(editing) && promptDefUpdated(editing) && (
                  <div className="text-[12px] text-sky-300/85 bg-sky-400/10 border border-sky-400/25 rounded-md px-2.5 py-1.5 mt-2 leading-relaxed">
                    🔔 <b>内置底稿已更新</b>：你的自定义是基于旧版底稿改的。可点下方「载入默认全文」到编辑框对照新版（不保存不生效），或「恢复默认」直接吃新版后再改。
                  </div>
                )}
              </div>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={18}
                className="w-full px-3 py-2 bg-black/40 border border-edge rounded-md text-[13px] text-slate-200 font-mono resize-y focus:border-god/50 focus:outline-none leading-relaxed"
                placeholder={editing.def ? '（在此编辑以覆盖内置默认；清空并保存=恢复默认）' : '（留空=不注入）'} />
              <div className="text-[11px] text-dim/50 leading-relaxed bg-black/20 border border-edge/40 rounded-md px-2.5 py-1.5">
                💡 <b className="text-dim/70">支持变量标签</b>（内置默认与你的自定义都支持 · 发送时实时替换 · 未定义的变量原样保留）：
                <span className="text-god/70 font-mono">{' {{user}} {{char}} {{getvar::名}} ${自定义变量} {{roll 1d100}} {{random::A::B}}'}</span>
                {' '}等；变量取自「设置 → 变量管理」的核心态 + 自定义变量（和正文预设同一套宏）。
              </div>
              <LintHints text={draft} />
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={doSave} className="text-[13px] px-3 py-1.5 rounded bg-god/15 border border-god/40 text-god hover:bg-god/25 transition-colors">💾 保存</button>
                {editing.def && <button onClick={() => setDraft(editing.def)} className="text-[13px] px-3 py-1.5 rounded border border-edge text-dim/70 hover:text-slate-200 transition-colors">载入默认全文</button>}
                <button onClick={() => doResetOne(editing)} className="text-[13px] px-3 py-1.5 rounded border border-edge text-dim/70 hover:text-blood transition-colors">↺ 恢复默认</button>
                <button onClick={() => copy(draft)} className="text-[13px] px-3 py-1.5 rounded border border-edge text-dim/70 hover:text-slate-200 transition-colors">📋 复制</button>
                <span className="text-[11px] font-mono text-dim/40 ml-auto">{draft.length} 字</span>
              </div>
            </div>
          ) : view === 'snippets' ? (
            <SnippetsView />
          ) : view === 'injects' ? (
            <InjectsView />
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
                      const defUpdated = custom && promptDefUpdated(e);
                      return (
                        <button key={e.key} onClick={() => openEdit(e)}
                          className="w-full flex items-center gap-3 rounded-lg border border-edge/60 bg-panel/40 px-3 py-2.5 hover:border-god/40 hover:bg-god/[0.04] transition-colors text-left">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-slate-200 truncate">{e.label}</div>
                            {e.desc && <div className="text-[11px] text-dim/50 truncate mt-0.5">{e.desc}</div>}
                          </div>
                          {defUpdated && <span className="shrink-0 text-[10.5px] font-mono text-sky-300/90 bg-sky-400/10 border border-sky-400/25 rounded-full px-2 py-0.5" title="你的自定义基于旧版内置底稿；内置默认已更新，可进入对照">🔔 底稿已更新</span>}
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

/* ── 🧩 片段库（{{include::片段名}} 复用片段）──────────────────────────────
   模块级组件：绝不定义在父组件体内（每键重挂断 IME 的老坑）。 */
function SnippetsView() {
  const items = useSnippets((s) => s.items);
  const upsert = useSnippets((s) => s.upsert);
  const remove = useSnippets((s) => s.remove);
  return (
    <div className="p-4 space-y-3">
      <div className="text-[12px] text-dim/70 leading-relaxed bg-black/20 border border-edge/40 rounded-md px-2.5 py-1.5">
        🧩 可复用提示词片段：在任意<b>正文预设 / 世界书 / 自定义主提示词 / 自定义注入</b>里写{' '}
        <span className="text-god/70 font-mono">{'{{include::片段名}}'}</span>{' '}
        即在发送时展开为片段内容（嵌套引用最多 3 层防循环 · 未定义的名字置空并在控制台提示）。改一处片段，处处生效。
      </div>
      {items.map((it) => (
        <div key={it.id} className="rounded-lg border border-edge/60 bg-panel/40 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input value={it.name} onChange={(e) => upsert({ ...it, name: e.target.value })} placeholder="片段名（引用时用）"
              className="flex-1 px-2 py-1 bg-black/40 border border-edge rounded text-[13px] text-slate-200 font-mono focus:border-god/50 focus:outline-none" />
            <span className="text-[11px] font-mono text-dim/40 shrink-0 hidden sm:inline">{'{{include::' + (it.name.trim() || '…') + '}}'}</span>
            <button onClick={() => { if (confirm('删除片段「' + (it.name || '未命名') + '」？')) remove(it.id); }} className="shrink-0 text-dim/40 hover:text-blood text-sm">🗑</button>
          </div>
          <textarea value={it.content} onChange={(e) => upsert({ ...it, content: e.target.value })} rows={4} placeholder="片段内容（支持宏 / <if var> 等模板语法）"
            className="w-full px-2 py-1.5 bg-black/40 border border-edge rounded text-[12px] text-slate-200 font-mono resize-y focus:border-god/50 focus:outline-none leading-relaxed" />
        </div>
      ))}
      <button onClick={() => upsert(newSnippet())} className="w-full py-2 rounded-lg border border-dashed border-edge text-dim/60 hover:text-god hover:border-god/40 text-[13px] transition-colors">＋ 添加片段</button>
    </div>
  );
}

/* ── 🎯 自定义注入（借鉴 ST-PT @INJECT 思想·作用于发给 AI 的最终消息序列）──
   模块级组件（同上 IME 铁律）。应用逻辑在 systems/customInject.ts（App 发送前最后一步）。 */
const INJ_POS_OPTIONS: [PromptInject['pos'], string][] = [
  ['start', '整轮最前'],
  ['end', '整轮最后（预填充之前）'],
  ['depth', '倒数第 N 楼之前'],
  ['regex', '正则命中楼（从最新往前找）'],
];
function InjectsView() {
  const injects = usePromptOverride((s) => s.injects);
  const upsert = usePromptOverride((s) => s.upsertInject);
  const remove = usePromptOverride((s) => s.removeInject);
  const list = Array.isArray(injects) ? injects : [];
  return (
    <div className="p-4 space-y-3">
      <div className="text-[12px] text-dim/70 leading-relaxed bg-black/20 border border-edge/40 rounded-md px-2.5 py-1.5">
        🎯 把你的内容插进<b>发给 AI 的最终消息序列</b>的任意位置（正文调用生效 · 组装完成后最后一步应用）。
        内容支持宏 / {'<if var>'} / {'{{include::片段名}}'}；「激活条件」满足才注入（语法同 {'<if cond>'}，如{' '}
        <span className="text-god/70 font-mono">var:主角.HP百分比 {'<'} 30 & seed:战斗</span>，空=总是）。正则未命中 / 条件不满足 / 内容为空 = 本回合自动跳过。
      </div>
      {list.map((j) => (
        <div key={j.id} className="rounded-lg border border-edge/60 bg-panel/40 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 shrink-0 text-[12px] text-dim/70">
              <input type="checkbox" checked={j.enabled} onChange={(e) => upsert({ ...j, enabled: e.target.checked })} />启用
            </label>
            <input value={j.label} onChange={(e) => upsert({ ...j, label: e.target.value })} placeholder="条目名"
              className="flex-1 min-w-[8rem] px-2 py-1 bg-black/40 border border-edge rounded text-[13px] text-slate-200 focus:border-god/50 focus:outline-none" />
            <select value={j.role} onChange={(e) => upsert({ ...j, role: e.target.value as PromptInject['role'] })} className="shrink-0 px-1.5 py-1 bg-black/40 border border-edge rounded text-[12px] text-slate-200">
              <option value="system">system</option><option value="user">user</option><option value="assistant">assistant</option>
            </select>
            <button onClick={() => { if (confirm('删除注入条目「' + (j.label || '未命名') + '」？')) remove(j.id); }} className="shrink-0 text-dim/40 hover:text-blood text-sm">🗑</button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={j.pos} onChange={(e) => upsert({ ...j, pos: e.target.value as PromptInject['pos'] })} className="px-1.5 py-1 bg-black/40 border border-edge rounded text-[12px] text-slate-200">
              {INJ_POS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {j.pos === 'depth' && (
              <input type="number" min={0} value={j.depth ?? 1} onChange={(e) => upsert({ ...j, depth: parseInt(e.target.value) || 0 })}
                className="w-20 px-2 py-1 bg-black/40 border border-edge rounded text-[12px] text-slate-200" title="倒数第 N 楼之前（1=最后一楼前·0=最后）" />
            )}
            {j.pos === 'regex' && (<>
              <input value={j.regex ?? ''} onChange={(e) => upsert({ ...j, regex: e.target.value })} placeholder="正则（不区分大小写）"
                className="flex-1 min-w-[8rem] px-2 py-1 bg-black/40 border border-edge rounded text-[12px] text-slate-200 font-mono" />
              <select value={j.at ?? 'before'} onChange={(e) => upsert({ ...j, at: e.target.value as 'before' | 'after' })} className="px-1.5 py-1 bg-black/40 border border-edge rounded text-[12px] text-slate-200">
                <option value="before">命中楼之前</option><option value="after">命中楼之后</option>
              </select>
            </>)}
          </div>
          <input value={j.activeWhen ?? ''} onChange={(e) => upsert({ ...j, activeWhen: e.target.value })}
            placeholder="激活条件（可选·空=总是）例：var:主角.阶位 ~= 五阶 & seed:战斗"
            className="w-full px-2 py-1 bg-black/40 border border-edge rounded text-[12px] text-slate-200 font-mono focus:border-god/50 focus:outline-none" />
          <textarea value={j.content} onChange={(e) => upsert({ ...j, content: e.target.value })} rows={3} placeholder="注入内容（支持宏 / <if var> / {{include::片段名}}）"
            className="w-full px-2 py-1.5 bg-black/40 border border-edge rounded text-[12px] text-slate-200 font-mono resize-y focus:border-god/50 focus:outline-none leading-relaxed" />
          <LintHints text={j.content} cond={j.activeWhen} />
        </div>
      ))}
      <button onClick={() => upsert(newPromptInject())} className="w-full py-2 rounded-lg border border-dashed border-edge text-dim/60 hover:text-god hover:border-god/40 text-[13px] transition-colors">＋ 添加注入条目</button>
    </div>
  );
}

/* ── 🩺 模板语法体检提示条（P2·借鉴 ST-PT getSyntaxErrorInfo 思想）────────────
   静态 dry-run：<if> 配平/类型、var 表达式、{{include}}/{{getvar}} 已知性——只提示不阻断保存。
   模块级组件（IME 铁律）；SettingsPanel 的世界书条目编辑器也复用（named export）。
   known 集合每次挂载采集一份（编辑中途新建片段/变量 → 重开面板刷新，够用）。 */
export function LintHints({ text, cond }: { text: string; cond?: string }) {
  const known = useMemo(() => ({
    vars: new Set(runtimeVarCatalog().map((r) => r.name)),
    snippets: new Set(useSnippets.getState().items.map((s) => (s.name || '').trim()).filter(Boolean)),
  }), []);
  const issues = useMemo(() => [
    ...lintPromptTemplate(text || '', known),
    ...lintCondExpr(cond || '', known.vars).map((i) => ({ ...i, msg: '激活条件：' + i.msg })),
  ], [text, cond, known]);
  if (!issues.length) return null;
  return (
    <div className="text-[11px] leading-relaxed rounded-md border border-amber-400/25 bg-amber-400/5 px-2.5 py-1.5 space-y-0.5">
      {issues.map((i, idx) => (
        <div key={idx} className={i.level === 'error' ? 'text-blood/90' : 'text-amber-300/80'}>{i.level === 'error' ? '⛔' : '⚠'} {i.msg}</div>
      ))}
    </div>
  );
}
