import { useState, useRef, useEffect } from 'react';
import { useVariables, type GameVariable } from '../store/variableStore';

/* ── 类型徽章 ── */
const TYPE_CFG = {
  number:  { label: '数字',   cls: 'bg-sky-900/50 text-sky-400 border-sky-700/40' },
  boolean: { label: '布尔',   cls: 'bg-amber-900/50 text-amber-400 border-amber-700/40' },
  string:  { label: '字符串', cls: 'bg-violet-900/50 text-violet-400 border-violet-700/40' },
} as const;

function TypeBadge({ type }: { type: GameVariable['type'] }) {
  const cfg = TYPE_CFG[type];
  return (
    <span className={`text-[12px] font-mono px-1.5 py-0.5 rounded border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`shrink-0 w-9 h-5 rounded-full border transition-colors ${checked ? 'bg-god/30 border-god/50' : 'bg-void border-edge'}`}
    >
      <div
        className="w-3 h-3 rounded-full bg-white mx-1 transition-all"
        style={{ transform: checked ? 'translateX(16px)' : 'none' }}
      />
    </button>
  );
}

/* ── 值显示 + 行内编辑 ── */
function ValueCell({ v }: { v: GameVariable }) {
  const setVariable = useVariables((s) => s.setVariable);
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setLocal(String(v.value));
    setEditing(true);
  }
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function commit() {
    const parsed: GameVariable['value'] = v.type === 'number' ? (Number(local) || 0) : local;
    setVariable(v.key, parsed);
    setEditing(false);
  }

  if (v.type === 'boolean') {
    return (
      <button
        onClick={() => setVariable(v.key, !v.value)}
        className={`text-sm font-bold font-mono transition-colors ${v.value ? 'text-god' : 'text-dim/50'}`}
      >
        {v.value ? '✓  true' : '✗  false'}
      </button>
    );
  }

  const num = v.type === 'number' ? (v.value as number) : null;
  const hasRange = num !== null && v.max !== undefined;
  const pct = hasRange
    ? Math.max(0, Math.min(100, ((num! - (v.min ?? 0)) / (v.max! - (v.min ?? 0))) * 100))
    : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-1.5">
        {editing ? (
          <input
            ref={inputRef}
            type={v.type === 'number' ? 'number' : 'text'}
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
            className="w-24 bg-void border border-god/40 rounded px-2 py-0.5 text-base font-mono text-god outline-none text-center"
          />
        ) : (
          <button
            onClick={startEdit}
            className="text-xl font-bold font-mono text-slate-100 hover:text-god transition-colors leading-none"
          >
            {String(v.value)}
          </button>
        )}
        {v.max !== undefined && (
          <span className="text-sm font-mono text-dim/50">/ {v.max}</span>
        )}
      </div>
      {hasRange && (
        <div className="h-1.5 rounded-full bg-void border border-edge/40 overflow-hidden">
          <div
            className="h-full bg-god/50 rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

/* ── 变量卡片 ── */
function VariableCard({
  v, selected, onSelect, onEdit, onDelete,
}: {
  v: GameVariable;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`border rounded-xl overflow-hidden transition-colors bg-panel ${
        selected ? 'border-god/50 shadow-[0_0_12px_rgba(70,227,207,0.08)]' : 'border-edge hover:border-edge/80'
      }`}
    >
      {/* Card header */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b border-edge/50 ${selected ? 'bg-god/5' : 'bg-panel2'}`}>
        {/* Checkbox */}
        <button
          onClick={onSelect}
          className={`shrink-0 w-4 h-4 rounded border transition-colors flex items-center justify-center ${
            selected ? 'bg-god/30 border-god text-god' : 'border-dim/40 hover:border-god/60'
          }`}
        >
          {selected && <span className="text-[12px] leading-none">✓</span>}
        </button>

        <TypeBadge type={v.type} />

        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-mono text-dim/70 truncate">{v.key}</span>
        </div>

        {v.showInStatusBar && (
          <span className="text-[12px] font-mono text-god/60 border border-god/20 rounded px-1 py-0.5">
            状态栏
          </span>
        )}

        <div className="flex gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="text-[12px] px-2 py-0.5 border border-edge text-dim hover:border-god/40 hover:text-god rounded font-mono transition-colors"
          >
            编辑
          </button>
          <button
            onClick={onDelete}
            className="text-[12px] px-2 py-0.5 border border-edge text-dim hover:border-blood/40 hover:text-blood rounded font-mono transition-colors"
          >
            删除
          </button>
        </div>
      </div>

      {/* Card body */}
      <div className="px-3 py-3 space-y-2">
        <div className="text-sm font-semibold text-slate-200">{v.label || v.key}</div>
        <ValueCell v={v} />
        {v.desc && <div className="text-[13px] text-dim/60 leading-relaxed">{v.desc}</div>}
        {v.type === 'number' && (v.min !== undefined || v.max !== undefined) && (
          <div className="text-[12px] font-mono text-dim/40">
            范围 {v.min ?? '—'} ~ {v.max ?? '∞'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 新建/编辑表单 ── */
function VariableForm({
  initial,
  existingKeys,
  onSave,
  onCancel,
}: {
  initial: GameVariable | null;
  existingKeys: string[];
  onSave: (v: GameVariable) => void;
  onCancel: () => void;
}) {
  const isEdit = initial !== null;
  const [key, setKey]         = useState(initial?.key ?? '');
  const [label, setLabel]     = useState(initial?.label ?? '');
  const [type, setType]       = useState<GameVariable['type']>(initial?.type ?? 'number');
  const [value, setValue]     = useState(String(initial?.value ?? '0'));
  const [min, setMin]         = useState(initial?.min !== undefined ? String(initial.min) : '');
  const [max, setMax]         = useState(initial?.max !== undefined ? String(initial.max) : '');
  const [showBar, setShowBar] = useState(initial?.showInStatusBar ?? false);
  const [desc, setDesc]       = useState(initial?.desc ?? '');
  const [err, setErr]         = useState('');

  function handleTypeChange(t: GameVariable['type']) {
    setType(t);
    setValue(t === 'number' ? '0' : t === 'boolean' ? 'false' : '');
    if (t !== 'number') { setMin(''); setMax(''); }
  }

  function coerceValue(): GameVariable['value'] {
    if (type === 'number') return Number(value) || 0;
    if (type === 'boolean') return value === 'true';
    return value;
  }

  function handleSave() {
    const k = key.trim();
    if (!k) { setErr('key 不能为空'); return; }
    if (!/^[\w.]+$/.test(k)) { setErr('key 只能包含字母、数字、下划线和点'); return; }
    if (!isEdit && existingKeys.includes(k)) { setErr(`key "${k}" 已存在`); return; }
    setErr('');

    const v: GameVariable = {
      key: k,
      label: label.trim() || k,
      type,
      value: coerceValue(),
      showInStatusBar: showBar,
      desc: desc.trim() || undefined,
    };
    if (type === 'number') {
      const mn = min !== '' ? Number(min) : undefined;
      const mx = max !== '' ? Number(max) : undefined;
      if (mn !== undefined && !isNaN(mn)) v.min = mn;
      if (mx !== undefined && !isNaN(mx)) v.max = mx;
    }
    onSave(v);
  }

  return (
    <div className="border border-god/25 rounded-xl bg-void/60 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-god/80 font-mono">
          {isEdit ? `编辑变量 · ${initial!.key}` : '新建变量'}
        </div>
        <button onClick={onCancel} className="text-dim/50 hover:text-blood text-sm font-mono transition-colors">✕ 取消</button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {/* Key */}
        <div className="space-y-1">
          <label className="text-[12px] font-mono text-dim">Key（唯一标识）</label>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={isEdit}
            placeholder="gold / flag.metKing"
            className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-slate-200 font-mono outline-none focus:border-god disabled:opacity-40"
          />
        </div>

        {/* Label */}
        <div className="space-y-1">
          <label className="text-[12px] font-mono text-dim">显示名称</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="金币"
            className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-god"
          />
        </div>

        {/* Type */}
        <div className="space-y-1">
          <label className="text-[12px] font-mono text-dim">类型</label>
          <select
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as GameVariable['type'])}
            className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-god"
          >
            <option value="number">数字</option>
            <option value="boolean">布尔</option>
            <option value="string">字符串</option>
          </select>
        </div>

        {/* Current value */}
        <div className="space-y-1">
          <label className="text-[12px] font-mono text-dim">当前值</label>
          {type === 'boolean' ? (
            <select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-god"
            >
              <option value="false">false</option>
              <option value="true">true</option>
            </select>
          ) : (
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              type={type === 'number' ? 'number' : 'text'}
              className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-slate-200 font-mono outline-none focus:border-god"
            />
          )}
        </div>

        {/* Min/Max only for number */}
        {type === 'number' ? (
          <>
            <div className="space-y-1">
              <label className="text-[12px] font-mono text-dim">最小值（留空不限）</label>
              <input
                value={min}
                onChange={(e) => setMin(e.target.value)}
                type="number"
                placeholder="0"
                className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-slate-200 font-mono outline-none focus:border-god"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-mono text-dim">最大值（留空不限）</label>
              <input
                value={max}
                onChange={(e) => setMax(e.target.value)}
                type="number"
                placeholder="100"
                className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-slate-200 font-mono outline-none focus:border-god"
              />
            </div>
          </>
        ) : (
          <div className="col-span-2" />
        )}
      </div>

      {/* Desc + status bar */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[12px] font-mono text-dim">备注（可选）</label>
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="变量说明…"
            className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-god"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[12px] font-mono text-dim">显示设置</label>
          <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg border border-edge bg-panel hover:border-god/30 transition-colors">
            <Toggle checked={showBar} onChange={() => setShowBar(!showBar)} />
            <span className="text-sm text-slate-300">显示在角色面板状态栏</span>
          </label>
        </div>
      </div>

      {err && <div className="text-sm text-blood font-mono px-1">{err}</div>}

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-sm border border-edge text-dim rounded-lg hover:border-blood/40 hover:text-blood transition-colors font-mono"
        >
          取消
        </button>
        <button
          onClick={handleSave}
          className="px-6 py-1.5 text-sm border border-god/50 text-god rounded-lg hover:bg-god/10 transition-colors font-mono"
        >
          {isEdit ? '保存修改' : '创建变量'}
        </button>
      </div>
    </div>
  );
}

/* ── 提示词模板面板 ── */
function PromptTemplate({ variables }: { variables: GameVariable[] }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const varList = variables.length > 0
    ? variables.map((v) => `  ${v.key}（${v.label || v.key}，${TYPE_CFG[v.type].label}）`).join('\n')
    : '  （此处自动填入已定义的变量）';

  const template = `每轮回复结束后，在正文之后输出一个 <state> 块，包含本轮数值变化。
格式说明（每行一条指令）：
  key = 值        直接赋值
  key += 数字     加法（仅数字类型）
  key -= 数字     减法（仅数字类型）
  item.add = 物品名    背包加入物品
  item.remove = 物品名  背包移除物品

内置变量：hp、maxHp、san、maxSan、points、atk、def

自定义变量：
${varList}

规则：
- 无变化时不输出 <state> 块
- // 开头为注释，忽略
- 未定义的变量 key 会被跳过

示例：
<state>
// 战斗结算
hp -= 20
san -= 5
gold += 100
item.add = 铁剑
flag.metKing = true
</state>`;

  function copy() {
    navigator.clipboard.writeText(template).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="border border-edge rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-panel hover:bg-panel2 transition-colors text-left"
      >
        <div>
          <div className="text-sm font-semibold text-slate-200">提示词模板</div>
          <div className="text-sm text-dim mt-0.5">将此模板加入 system prompt，让 AI 知道如何输出 &lt;state&gt; 块</div>
        </div>
        <span className="text-dim text-sm ml-4">{open ? '∧' : '∨'}</span>
      </button>

      {open && (
        <div className="border-t border-edge bg-void">
          <div className="flex justify-end px-4 pt-3">
            <button
              onClick={copy}
              className={`text-sm font-mono px-3 py-1 border rounded transition-colors ${
                copied ? 'border-god text-god bg-god/10' : 'border-edge text-dim hover:border-god/40 hover:text-god'
              }`}
            >
              {copied ? '✓ 已复制' : '复制'}
            </button>
          </div>
          <pre className="px-4 py-3 text-[13px] font-mono text-slate-400 whitespace-pre-wrap leading-relaxed">
            {template}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════
   主组件
════════════════════════════════════════════ */
export default function VariableManager({
  onOpenItemManager,
  onOpenPlayerManager,
  onOpenNpcManager,
  onOpenFactionManager,
  onOpenTerritoryManager,
  onOpenTeamManager,
  onOpenMemoryManager,
  onOpenMiscManager,
  onOpenChannelManager,
}: {
  onOpenItemManager?: () => void;
  onOpenPlayerManager?: () => void;
  onOpenNpcManager?: () => void;
  onOpenFactionManager?: () => void;
  onOpenTerritoryManager?: () => void;
  onOpenTeamManager?: () => void;
  onOpenMemoryManager?: () => void;
  onOpenMiscManager?: () => void;
  onOpenChannelManager?: () => void;
}) {
  const variables   = useVariables((s) => s.variables);
  const setVariable = useVariables((s) => s.setVariable);
  const upsert      = useVariables((s) => s.upsertDefinition);
  const remove      = useVariables((s) => s.removeVariable);
  const resetAll    = useVariables((s) => s.resetAll);

  const [editing, setEditing]   = useState<GameVariable | 'new' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchQ, setSearchQ]   = useState('');
  const [filterType, setFilterType] = useState<GameVariable['type'] | 'all'>('all');
  const [page, setPage]         = useState(0);
  const PAGE_SIZE = 10;

  // 过滤
  const filtered = variables.filter((v) => {
    const q = searchQ.toLowerCase();
    const matchQ = !q || v.key.toLowerCase().includes(q) || (v.label ?? '').toLowerCase().includes(q) || (v.desc ?? '').toLowerCase().includes(q);
    const matchType = filterType === 'all' || v.type === filterType;
    return matchQ && matchType;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages - 1);
  const paged      = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(paged.map((v) => v.key)));
  }

  function clearSelect() {
    setSelected(new Set());
  }

  function batchDelete() {
    selected.forEach((k) => remove(k));
    setSelected(new Set());
  }

  function batchReset() {
    const vars = useVariables.getState().variables;
    selected.forEach((key) => {
      const def = vars.find((v) => v.key === key);
      if (!def) return;
      const resetVal: GameVariable['value'] =
        def.type === 'number' ? (def.min ?? 0) :
        def.type === 'boolean' ? false : '';
      setVariable(key, resetVal);
    });
    setSelected(new Set());
  }

  function handleUpsert(v: GameVariable) {
    upsert(v);
    setEditing(null);
  }

  const hasSelected = selected.size > 0;
  const allSelectedOnPage = paged.length > 0 && paged.every((v) => selected.has(v.key));

  return (
    <div className="space-y-4">

      {/* ── 页头 ── */}
      <div className="flex items-start justify-between gap-4 border-b border-edge pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-100">变量管理</h2>
          <p className="text-sm text-dim mt-0.5">
            定义游戏变量，AI 通过 &lt;state&gt; 块自动更新。点击数值可直接修改。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onOpenNpcManager && (
            <button
              onClick={onOpenNpcManager}
              className="px-3 py-1.5 text-sm border border-violet-600/50 text-violet-400 rounded-lg hover:bg-violet-900/20 transition-colors font-mono"
            >
              🧑‍🤝‍🧑 NPC 演化
            </button>
          )}
          {onOpenFactionManager && (
            <button
              onClick={onOpenFactionManager}
              className="px-3 py-1.5 text-sm border border-orange-600/50 text-orange-400 rounded-lg hover:bg-orange-900/20 transition-colors font-mono"
            >
              🏛 势力演化
            </button>
          )}
          {onOpenTerritoryManager && (
            <button
              onClick={onOpenTerritoryManager}
              className="px-3 py-1.5 text-sm border border-emerald-600/50 text-emerald-400 rounded-lg hover:bg-emerald-900/20 transition-colors font-mono"
            >
              🏯 领地演化
            </button>
          )}
          {onOpenTeamManager && (
            <button
              onClick={onOpenTeamManager}
              className="px-3 py-1.5 text-sm border border-cyan-600/50 text-cyan-400 rounded-lg hover:bg-cyan-900/20 transition-colors font-mono"
            >
              🛡 冒险团演化
            </button>
          )}
          {onOpenPlayerManager && (
            <button
              onClick={onOpenPlayerManager}
              className="px-3 py-1.5 text-sm border border-sky-600/50 text-sky-400 rounded-lg hover:bg-sky-900/20 transition-colors font-mono"
            >
              🧬 主角演化
            </button>
          )}
          {onOpenItemManager && (
            <button
              onClick={onOpenItemManager}
              className="px-3 py-1.5 text-sm border border-amber-600/50 text-amber-400 rounded-lg hover:bg-amber-900/20 transition-colors font-mono"
            >
              ⚔ 物品管理
            </button>
          )}
          {onOpenMemoryManager && (
            <button
              onClick={onOpenMemoryManager}
              className="px-3 py-1.5 text-sm border border-rose-600/50 text-rose-400 rounded-lg hover:bg-rose-900/20 transition-colors font-mono"
            >
              📜 生平压缩
            </button>
          )}
          {onOpenMiscManager && (
            <button
              onClick={onOpenMiscManager}
              className="px-3 py-1.5 text-sm border border-teal-600/50 text-teal-400 rounded-lg hover:bg-teal-900/20 transition-colors font-mono"
            >
              🧩 杂项演化
            </button>
          )}
          {onOpenChannelManager && (
            <button
              onClick={onOpenChannelManager}
              className="px-3 py-1.5 text-sm border border-indigo-500/50 text-indigo-300 rounded-lg hover:bg-indigo-900/20 transition-colors font-mono"
            >
              📡 公共频道
            </button>
          )}
          <button
            onClick={resetAll}
            className="px-3 py-1.5 text-sm border border-edge text-dim rounded-lg hover:border-blood/40 hover:text-blood transition-colors font-mono"
          >
            重置全部值
          </button>
          <button
            onClick={() => { setEditing('new'); }}
            className="px-4 py-1.5 text-sm border border-god/50 text-god rounded-lg hover:bg-god/10 transition-colors font-mono"
          >
            + 新建变量
          </button>
        </div>
      </div>

      {/* ── 新建/编辑表单 ── */}
      {editing !== null && (
        <VariableForm
          initial={editing === 'new' ? null : editing}
          existingKeys={variables.map((v) => v.key)}
          onSave={handleUpsert}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* ── 搜索 + 过滤 + 批量操作 ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* 搜索框 */}
        <div className="flex items-center gap-1.5 flex-1 min-w-48 bg-panel border border-edge rounded-lg px-3 py-1.5 focus-within:border-god/40 transition-colors">
          <span className="text-dim/50 text-sm">🔍</span>
          <input
            value={searchQ}
            onChange={(e) => { setSearchQ(e.target.value); setPage(0); }}
            placeholder="搜索变量 key、名称或备注…"
            className="flex-1 bg-transparent text-sm text-slate-200 outline-none placeholder:text-dim/40 font-mono text-sm"
          />
          {searchQ && (
            <button onClick={() => setSearchQ('')} className="text-dim/50 hover:text-blood text-sm">✕</button>
          )}
        </div>

        {/* 类型过滤 */}
        <div className="flex items-center gap-1 text-sm font-mono">
          {(['all', 'number', 'boolean', 'string'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setFilterType(t); setPage(0); }}
              className={`px-2.5 py-1 rounded-lg border transition-colors ${
                filterType === t
                  ? 'bg-god/10 border-god/40 text-god'
                  : 'border-edge text-dim hover:border-god/30 hover:text-slate-300'
              }`}
            >
              {t === 'all' ? '全部' : TYPE_CFG[t].label}
            </button>
          ))}
        </div>

        {/* 批量操作 */}
        {variables.length > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            {hasSelected && (
              <>
                <span className="text-sm font-mono text-dim">已选 {selected.size}</span>
                <button
                  onClick={batchReset}
                  className="px-3 py-1 text-sm border border-edge text-dim rounded-lg hover:border-god/40 hover:text-god transition-colors font-mono"
                >
                  重置所选
                </button>
                <button
                  onClick={batchDelete}
                  className="px-3 py-1 text-sm border border-edge text-dim rounded-lg hover:border-blood/40 hover:text-blood transition-colors font-mono"
                >
                  删除所选
                </button>
              </>
            )}
            <button
              onClick={allSelectedOnPage ? clearSelect : selectAll}
              className="px-3 py-1 text-sm border border-edge text-dim rounded-lg hover:border-god/40 hover:text-god transition-colors font-mono"
            >
              {allSelectedOnPage ? '取消全选' : '全选'}
            </button>
          </div>
        )}
      </div>

      {/* ── 变量卡片网格 ── */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-edge rounded-xl">
          {variables.length === 0 ? (
            <>
              <div className="text-dim text-sm font-mono mb-2">暂无自定义变量</div>
              <div className="text-dim/50 text-sm">点击「新建变量」开始添加，AI 将通过 &lt;state&gt; 块自动更新它们</div>
            </>
          ) : (
            <div className="text-dim text-sm font-mono">无匹配的变量</div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {paged.map((v) => (
            <VariableCard
              key={v.key}
              v={v}
              selected={selected.has(v.key)}
              onSelect={() => toggleSelect(v.key)}
              onEdit={() => setEditing(editing === v ? null : v)}
              onDelete={() => { remove(v.key); setSelected((prev) => { const n = new Set(prev); n.delete(v.key); return n; }); }}
            />
          ))}
        </div>
      )}

      {/* ── 翻页 ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1 text-sm font-mono">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="px-3 py-1 border border-edge rounded text-dim hover:border-god/40 hover:text-god disabled:opacity-30 transition-colors"
          >
            ← 上一页
          </button>
          <span className="text-dim/60">
            第 {safePage + 1} / {totalPages} 页
            <span className="ml-2 text-dim/40">共 {filtered.length} 条</span>
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            className="px-3 py-1 border border-edge rounded text-dim hover:border-god/40 hover:text-god disabled:opacity-30 transition-colors"
          >
            下一页 →
          </button>
        </div>
      )}

      {/* ── 统计栏 ── */}
      {variables.length > 0 && (
        <div className="flex items-center gap-4 text-[12px] font-mono text-dim/60 px-1">
          <span>共 {variables.length} 个变量</span>
          <span>数字 {variables.filter(v => v.type === 'number').length}</span>
          <span>布尔 {variables.filter(v => v.type === 'boolean').length}</span>
          <span>字符串 {variables.filter(v => v.type === 'string').length}</span>
          <span>状态栏显示 {variables.filter(v => v.showInStatusBar).length}</span>
        </div>
      )}

      {/* ── 提示词模板 ── */}
      <PromptTemplate variables={variables} />
    </div>
  );
}
