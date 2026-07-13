import { useState } from 'react';
import { useDbAdvance } from '../store/dbAdvanceStore';
import type { DbAdvancePreset, DbAdvanceModule } from '../systems/dbAdvancePreset';

/* 数据库推进（Stitches）预设编辑器：在应用内直接改预设的模块提示词 / 最终注入指令 / 排除规则。
   主用途：给「召回 / 推进」模块**缝破限**（加 system 破限消息），治「AI 拒答→数据库推进空回」。
   本地深拷贝编辑，点保存才写回 store（useDbAdvance.setPreset）。⚠ 全 JSX 内联、不内联定义子组件（否则受控 textarea 每键重挂断输入法）。
   占位符：$U 主角 · $C 卡片 · $1 背景 · $5 事件概览 · $7 前文 · $8 本轮输入 · {{tabletop}} 上轮桌面态 · {{stage}}/{{scene}}/{{recall}} 本轮产出。 */
const ROLES = ['system', 'user', 'assistant'];
const inputCls = 'w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 focus:outline-none focus:border-god/50';
const miniBtn = 'text-[11px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim hover:text-god hover:border-god/40 transition-colors shrink-0';
const delBtn = 'text-[11px] font-mono px-1.5 py-0.5 rounded border border-blood/40 text-blood/60 hover:bg-blood/10 shrink-0';

export default function DbAdvancePresetEditor({ onClose }: { onClose: () => void }) {
  const preset0 = useDbAdvance((s) => s.preset);
  const setPreset = useDbAdvance((s) => s.setPreset);
  const [p, setP] = useState<DbAdvancePreset | null>(() => (preset0 ? JSON.parse(JSON.stringify(preset0)) : null));
  const [saved, setSaved] = useState('');

  // ── 不可变更新助手（全部走 setP 函数式，安全应对连续编辑）──
  const modUp = (mi: number, fn: (m: DbAdvanceModule) => DbAdvanceModule) =>
    setP((c) => (c ? { ...c, plotTasks: c.plotTasks.map((m, i) => (i === mi ? fn(m) : m)) } : c));
  const msgSet = (mi: number, ji: number, key: 'role' | 'content', v: string) =>
    modUp(mi, (m) => ({ ...m, promptGroup: m.promptGroup.map((x, j) => (j === ji ? { ...x, [key]: v } : x)) }));
  const addMsg = (mi: number, role: string, top: boolean) =>
    modUp(mi, (m) => ({ ...m, promptGroup: top ? [{ role, content: '' }, ...m.promptGroup] : [...m.promptGroup, { role, content: '' }] }));
  const delMsg = (mi: number, ji: number) => modUp(mi, (m) => ({ ...m, promptGroup: m.promptGroup.filter((_, j) => j !== ji) }));
  const moveMsg = (mi: number, ji: number, dir: number) =>
    modUp(mi, (m) => { const a = [...m.promptGroup]; const nj = ji + dir; if (nj < 0 || nj >= a.length) return m; [a[ji], a[nj]] = [a[nj], a[ji]]; return { ...m, promptGroup: a }; });
  const addModule = () =>
    setP((c) => (c ? { ...c, plotTasks: [...c.plotTasks, { id: 'mod_' + Date.now().toString(36), name: '新模块', promptGroup: [{ role: 'system', content: '' }], extractTags: '', extractInjectTags: '', minLength: 0, order: c.plotTasks.length ? Math.max(...c.plotTasks.map((t) => t.order)) + 1 : 0 }] } : c));
  const delModule = (mi: number) => setP((c) => (c ? { ...c, plotTasks: c.plotTasks.filter((_, i) => i !== mi) } : c));
  const exclSet = (i: number, key: 'start' | 'end', v: string) =>
    setP((c) => (c ? { ...c, contextExcludeRules: c.contextExcludeRules.map((r, k) => (k === i ? { ...r, [key]: v } : r)) } : c));

  const save = () => {
    if (!p) return;
    setPreset({ ...p, plotTasks: [...p.plotTasks].sort((a, b) => a.order - b.order) });   // 保存按 order 升序（管线依赖召回0→推进1）
    setSaved('✓ 已保存');
    setTimeout(() => { setSaved(''); onClose(); }, 700);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-god/30 rounded-2xl w-full max-w-3xl max-h-[90dvh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.85)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 p-4 border-b border-edge shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><span className="text-lg">🎬</span><h2 className="text-base font-bold text-slate-100">数据库推进预设编辑器</h2></div>
            <p className="text-[12px] text-dim/60 mt-0.5 leading-relaxed">改召回/推进模块的提示词——给它加 <b className="text-blood/80">system 破限</b> 治「AI 拒答→空回」。占位符：$8 本轮输入 · $7 前文 · $5 事件 · {'{{tabletop}}'} 上轮桌面态。</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saved && <span className="text-[12px] text-emerald-300/80">{saved}</span>}
            <button onClick={save} disabled={!p} className="text-[13px] font-semibold px-3 py-1.5 rounded-lg border border-god/50 text-god bg-god/10 hover:bg-god/20 transition-colors disabled:opacity-40">保存</button>
            <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
          </div>
        </header>

        {!p ? (
          <div className="p-8 text-center text-dim/50 text-sm">尚未载入推进预设——请先在「数据库推进管线」里「载入内置 Stitches」或「导入 JSON」，再来编辑。</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* 预设名 */}
            <label className="block">
              <span className="text-[12px] font-mono text-dim/50">预设名</span>
              <input value={p.name} onChange={(e) => setP((c) => (c ? { ...c, name: e.target.value } : c))} className={`${inputCls} mt-0.5`} />
            </label>

            {/* 模块 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono text-god/70 uppercase tracking-widest">模块（plotTasks · 按 order 升序跑：召回→推进）</span>
                <button onClick={addModule} className={miniBtn}>+ 新增模块</button>
              </div>
              {p.plotTasks.map((mod, mi) => (
                <div key={mod.id || mi} className="border border-edge rounded-lg p-3 bg-panel space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input value={mod.name} onChange={(e) => modUp(mi, (m) => ({ ...m, name: e.target.value }))} placeholder="模块名(召回/推进)" className={`${inputCls} flex-1 min-w-[110px] font-semibold`} />
                    <label className="text-[11px] font-mono text-dim/50 flex items-center gap-1">order<input type="number" value={mod.order} onChange={(e) => modUp(mi, (m) => ({ ...m, order: Number(e.target.value) || 0 }))} className="w-12 bg-void border border-edge rounded px-1 py-0.5 text-slate-200" /></label>
                    <button onClick={() => delModule(mi)} className={delBtn}>删模块</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="text-[11px] font-mono text-dim/50 block">抽取标签 extractTags<input value={mod.extractTags} onChange={(e) => modUp(mi, (m) => ({ ...m, extractTags: e.target.value }))} placeholder="stage,scene / recall" className={`${inputCls} mt-0.5 font-mono text-[12px]`} /></label>
                    <label className="text-[11px] font-mono text-dim/50 block">存下轮注入 extractInjectTags<input value={mod.extractInjectTags} onChange={(e) => modUp(mi, (m) => ({ ...m, extractInjectTags: e.target.value }))} placeholder="tabletop" className={`${inputCls} mt-0.5 font-mono text-[12px]`} /></label>
                  </div>
                  {/* promptGroup 消息 */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-mono text-dim/50">提示词 promptGroup（{mod.promptGroup.length} 条）</span>
                      <button onClick={() => addMsg(mi, 'system', true)} className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-blood/50 text-blood hover:bg-blood/10 shrink-0" title="在最前面加一条 system 破限消息">+ 破限(system·置顶)</button>
                      <button onClick={() => addMsg(mi, 'system', false)} className={miniBtn}>+ 消息</button>
                    </div>
                    {mod.promptGroup.map((m, ji) => (
                      <div key={ji} className="flex gap-1.5 items-start">
                        <select value={m.role} onChange={(e) => msgSet(mi, ji, 'role', e.target.value)} className={`bg-void border rounded px-1 py-1 text-[12px] shrink-0 ${m.role === 'system' ? 'border-blood/40 text-blood/80' : 'border-edge text-slate-300'}`}>
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <textarea value={m.content} onChange={(e) => msgSet(mi, ji, 'content', e.target.value)} rows={m.content.length > 140 ? 4 : 2} placeholder="提示词内容（可粘破限）" className={`${inputCls} flex-1 resize-y font-mono text-[12px]`} />
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button onClick={() => moveMsg(mi, ji, -1)} className={miniBtn}>↑</button>
                          <button onClick={() => moveMsg(mi, ji, 1)} className={miniBtn}>↓</button>
                          <button onClick={() => delMsg(mi, ji)} className={delBtn}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* 最终注入指令 */}
            <label className="block">
              <span className="text-[12px] font-mono text-dim/50">最终注入指令 finalSystemDirective（含 $8 / {'{{stage}}'} / {'{{scene}}'} / {'{{recall}}'}·注回正文让正文预设据此写散文）</span>
              <textarea value={p.finalSystemDirective} onChange={(e) => setP((c) => (c ? { ...c, finalSystemDirective: e.target.value } : c))} rows={5} className={`${inputCls} mt-0.5 resize-y font-mono text-[12px]`} />
            </label>

            {/* 排除规则 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] font-mono text-dim/50">上下文排除规则 contextExcludeRules（start…end 之间从推进输出剥掉·可空）</span>
                <button onClick={() => setP((c) => (c ? { ...c, contextExcludeRules: [...c.contextExcludeRules, { start: '', end: '' }] } : c))} className={miniBtn}>+ 规则</button>
              </div>
              {p.contextExcludeRules.map((r, i) => (
                <div key={i} className="flex gap-1.5 items-center">
                  <input value={r.start} onChange={(e) => exclSet(i, 'start', e.target.value)} placeholder="start" className={`${inputCls} flex-1 font-mono text-[12px]`} />
                  <input value={r.end} onChange={(e) => exclSet(i, 'end', e.target.value)} placeholder="end" className={`${inputCls} flex-1 font-mono text-[12px]`} />
                  <button onClick={() => setP((c) => (c ? { ...c, contextExcludeRules: c.contextExcludeRules.filter((_, k) => k !== i) } : c))} className={delBtn}>✕</button>
                </div>
              ))}
              {p.contextExcludeRules.length === 0 && <div className="text-[11px] text-dim/35 font-mono">（无·推进输出原样保留）</div>}
            </div>

            <div className="text-[11px] text-dim/40 leading-relaxed border-t border-edge/50 pt-2">
              💡 缝破限：在「召回」和「推进」模块各点一次 <b className="text-blood/70">+ 破限(system·置顶)</b>，把你的破限文粘进去 → 保存。破限置顶 = 每次子调用最先喂给模型，压住拒答。改完记得 commit+push（这是纯前端存到 <span className="font-mono">drpg-dbadvance</span>，本机即时生效）。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
