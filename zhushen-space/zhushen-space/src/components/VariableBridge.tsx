/* 变量系统 · 透明引用
   渲染在「变量管理页」底部。两块：
   ① 可用变量目录（实时）—— 列出每个能在正文预设/世界书里引用的变量名 + 当前值，一键复制 {{getvar::名}}。
      核心游戏态自动采集（主角./货币./世界.）；自定义变量由作者在下方定义、正文 AI 经 <state> 更新。
   ② 自定义变量编辑器 —— 新增/改值/删除（值也可手动改，便于调试）。
   目的：二创只要照目录抄变量名写进 CoT 的对应步骤即可，不必再去代码里找注入点。 */
import { useState } from 'react';
import { useVariables, type GameVariable } from '../store/variableStore';
import { usePlayer } from '../store/playerStore';
import { useGame } from '../store/gameStore';
import { useItems } from '../store/itemStore';
import { useMisc } from '../store/miscStore';
import { runtimeVarCatalog } from '../systems/runtimeVars';

function CopyBtn({ name }: { name: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        const macro = `{{getvar::${name}}}`;
        try { navigator.clipboard?.writeText(macro); } catch { /* 剪贴板不可用则忽略 */ }
        setDone(true); setTimeout(() => setDone(false), 1200);
      }}
      title={`复制 {{getvar::${name}}}`}
      className={`shrink-0 px-2 py-0.5 rounded text-[11px] font-mono border transition-colors ${
        done ? 'border-emerald-500/60 text-emerald-300' : 'border-edge text-dim/70 hover:border-god/50 hover:text-god'
      }`}
    >
      {done ? '已复制' : '复制引用'}
    </button>
  );
}

function VarRow({ name, value, desc, right }: { name: string; value: string; desc?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-god/[0.04]">
      <code className="shrink-0 text-[12px] font-mono text-god/90">{`{{getvar::${name}}}`}</code>
      <span className="shrink-0 text-dim/30">=</span>
      <span className="flex-1 min-w-0 truncate text-[12.5px] text-slate-200" title={value}>{value || <span className="text-dim/40">（空）</span>}</span>
      {desc && <span className="hidden md:inline shrink-0 max-w-[30%] truncate text-[11px] text-dim/40" title={desc}>{desc}</span>}
      {right ?? <CopyBtn name={name} />}
    </div>
  );
}

const EMPTY_FORM = { key: '', label: '', type: 'number' as GameVariable['type'], value: '0', min: '', max: '', desc: '', showInStatusBar: false };

export default function VariableBridge() {
  // 订阅相关切片 → 游戏态变化时目录实时刷新
  usePlayer((s) => s.profile);
  useGame((s) => s.player);
  useItems((s) => s.currency);
  useMisc((s) => s.worldName); useMisc((s) => s.turnCount); useMisc((s) => s.paradiseTime); useMisc((s) => s.worldTime); useMisc((s) => s.weather);
  const customVars = useVariables((s) => s.variables);
  const upsertDefinition = useVariables((s) => s.upsertDefinition);
  const removeVariable = useVariables((s) => s.removeVariable);
  const setVariable = useVariables((s) => s.setVariable);

  const coreRows = runtimeVarCatalog().filter((r) => r.group === '核心游戏态');
  const [form, setForm] = useState(EMPTY_FORM);
  const [err, setErr] = useState('');

  function addVar() {
    const key = form.key.trim();
    if (!key) { setErr('引用名不能为空'); return; }
    if (customVars.some((v) => v.key === key)) { setErr(`已存在变量「${key}」`); return; }
    const def: GameVariable = {
      key,
      label: form.label.trim() || key,
      type: form.type,
      value: form.type === 'number' ? Number(form.value) || 0 : form.type === 'boolean' ? form.value === 'true' : form.value,
      showInStatusBar: form.showInStatusBar,
      ...(form.desc.trim() ? { desc: form.desc.trim() } : {}),
      ...(form.type === 'number' && form.min !== '' ? { min: Number(form.min) } : {}),
      ...(form.type === 'number' && form.max !== '' ? { max: Number(form.max) } : {}),
    };
    upsertDefinition(def);
    setForm(EMPTY_FORM); setErr('');
  }

  const inputCls = 'rounded-md border border-edge bg-black/30 px-2 py-1 text-[12.5px] text-slate-100 focus:border-god/60 outline-none';

  return (
    <div className="mt-12">
      <div className="flex items-center gap-3 mb-3.5">
        <span className="text-[12px] font-mono uppercase tracking-[0.25em] text-dim/45">变量系统 · 透明引用</span>
        <div className="h-px flex-1 bg-edge/50" />
      </div>

      <div className="rounded-2xl border border-edge bg-panel/50 p-5 space-y-6">
        <p className="text-[13px] text-dim/70 leading-relaxed">
          下列变量可在<span className="text-god">任意正文预设 / 世界书</span>里直接引用：写
          <code className="mx-1 px-1 rounded bg-black/40 font-mono text-god/90">{'{{getvar::名}}'}</code>或
          <code className="mx-1 px-1 rounded bg-black/40 font-mono text-god/90">{'${名}'}</code>，
          前端在拼装预设时即时替换成当前值。CoT 思维链按步走，把引用写在<span className="text-dim/90">对应步骤</span>即可——无需改代码注入点。
          <br />
          自定义变量由正文 AI 经 <code className="mx-0.5 px-1 rounded bg-black/40 font-mono text-god/90">{'<state>'}</code> 指令更新（
          <code className="mx-0.5 px-1 rounded bg-black/40 font-mono text-dim/80">名 = 值</code> /
          <code className="mx-0.5 px-1 rounded bg-black/40 font-mono text-dim/80">名 += 值</code>），先在下方「定义」后才会被采纳。
        </p>

        {/* ① 核心游戏态目录 */}
        <div>
          <div className="text-[12px] font-mono text-dim/55 mb-1.5">核心游戏态 · 自动采集（{coreRows.length}）</div>
          <div className="rounded-xl border border-edge/60 bg-black/20 divide-y divide-edge/30 max-h-[280px] overflow-y-auto">
            {coreRows.map((r) => <VarRow key={r.name} name={r.name} value={r.value} desc={r.desc} />)}
          </div>
        </div>

        {/* ② 自定义变量目录 + 编辑 */}
        <div>
          <div className="text-[12px] font-mono text-dim/55 mb-1.5">自定义变量（{customVars.length}）</div>
          {customVars.length === 0 ? (
            <div className="rounded-xl border border-dashed border-edge/60 bg-black/10 px-3 py-4 text-[12.5px] text-dim/45">
              还没有自定义变量。用下方表单新增，例如「好感度」「堕落值」「主线进度」——定义后即可被预设引用、被正文 AI 更新。
            </div>
          ) : (
            <div className="rounded-xl border border-edge/60 bg-black/20 divide-y divide-edge/30">
              {customVars.map((v) => (
                <VarRow
                  key={v.key}
                  name={v.key}
                  value={v.type === 'boolean' ? (v.value ? '是' : '否') : String(v.value ?? '')}
                  desc={v.label !== v.key ? v.label : v.desc}
                  right={
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* 手动改值（调试用） */}
                      {v.type === 'boolean' ? (
                        <button
                          onClick={() => setVariable(v.key, !v.value)}
                          className="px-2 py-0.5 rounded text-[11px] font-mono border border-edge text-dim/70 hover:border-god/50 hover:text-god"
                        >切换</button>
                      ) : (
                        <input
                          type={v.type === 'number' ? 'number' : 'text'}
                          value={String(v.value ?? '')}
                          onChange={(e) => setVariable(v.key, v.type === 'number' ? (Number(e.target.value) || 0) : e.target.value)}
                          className={`${inputCls} w-20`}
                        />
                      )}
                      <CopyBtn name={v.key} />
                      <button
                        onClick={() => { if (window.confirm(`删除变量「${v.key}」？`)) removeVariable(v.key); }}
                        title="删除"
                        className="px-1.5 py-0.5 rounded text-[12px] border border-edge text-dim/50 hover:border-rose-500/60 hover:text-rose-300"
                      >🗑</button>
                    </div>
                  }
                />
              ))}
            </div>
          )}

          {/* 新增表单 */}
          <div className="mt-3 rounded-xl border border-edge bg-black/20 p-3 space-y-2.5">
            <div className="text-[12px] font-mono text-dim/55">＋ 新增自定义变量</div>
            <div className="flex flex-wrap items-center gap-2">
              <input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="引用名 如 好感度" className={`${inputCls} w-32`} />
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="显示名（可选）" className={`${inputCls} w-32`} />
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as GameVariable['type'], value: e.target.value === 'boolean' ? 'false' : e.target.value === 'number' ? '0' : '' })} className={inputCls}>
                <option value="number">数值</option>
                <option value="string">文本</option>
                <option value="boolean">真假</option>
              </select>
              {form.type === 'boolean' ? (
                <select value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className={inputCls}>
                  <option value="false">否</option>
                  <option value="true">是</option>
                </select>
              ) : (
                <input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} type={form.type === 'number' ? 'number' : 'text'} placeholder="初始值" className={`${inputCls} w-24`} />
              )}
              {form.type === 'number' && (
                <>
                  <input value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} type="number" placeholder="最小" className={`${inputCls} w-20`} />
                  <input value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} type="number" placeholder="最大" className={`${inputCls} w-20`} />
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} placeholder="说明（可选，目录里展示）" className={`${inputCls} flex-1 min-w-[180px]`} />
              <label className="flex items-center gap-1.5 text-[12px] text-dim/70 cursor-pointer select-none">
                <input type="checkbox" checked={form.showInStatusBar} onChange={(e) => setForm({ ...form, showInStatusBar: e.target.checked })} className="accent-god" />
                顶栏状态条显示
              </label>
              <button onClick={addVar} className="px-3.5 py-1.5 rounded-lg border border-god/40 text-god text-[13px] font-mono hover:bg-god/10 transition-colors">添加</button>
              {err && <span className="text-[12px] text-rose-400">{err}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
