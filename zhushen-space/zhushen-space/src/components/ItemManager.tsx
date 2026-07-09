import { useState, useRef } from 'react';
import { useItems, ITEM_CATEGORIES, extractItemPresetFromJson, type InventoryItem, type ItemCategory, type CurrencyWallet, type ItemPresetEntry } from '../store/itemStore';
import ApiRoutePicker from './ApiRoutePicker';

/* ── 分类颜色 ── */
const CAT_CFG: Record<ItemCategory, { cls: string; dot: string }> = {
  '武器':   { cls: 'bg-red-900/40 text-red-400 border-red-700/40',       dot: 'bg-red-400' },
  '防具':   { cls: 'bg-sky-900/40 text-sky-400 border-sky-700/40',       dot: 'bg-sky-400' },
  '饰品':   { cls: 'bg-violet-900/40 text-violet-400 border-violet-700/40', dot: 'bg-violet-400' },
  '功法':   { cls: 'bg-amber-900/40 text-amber-400 border-amber-700/40', dot: 'bg-amber-400' },
  '法宝':   { cls: 'bg-yellow-900/40 text-yellow-400 border-yellow-700/40', dot: 'bg-yellow-400' },
  '丹药':   { cls: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40', dot: 'bg-emerald-400' },
  '符箓':   { cls: 'bg-teal-900/40 text-teal-400 border-teal-700/40',    dot: 'bg-teal-400' },
  '材料':   { cls: 'bg-slate-700/40 text-slate-400 border-slate-600/40', dot: 'bg-slate-400' },
  '灵药':   { cls: 'bg-green-900/40 text-green-400 border-green-700/40', dot: 'bg-green-400' },
  '阵具':   { cls: 'bg-cyan-900/40 text-cyan-400 border-cyan-700/40',    dot: 'bg-cyan-400' },
  '重要物品':{ cls: 'bg-orange-900/40 text-orange-400 border-orange-700/40', dot: 'bg-orange-400' },
  '凡物':   { cls: 'bg-zinc-800/40 text-zinc-500 border-zinc-700/40',    dot: 'bg-zinc-500' },
  '其他物品':{ cls: 'bg-panel2 text-dim border-edge',                    dot: 'bg-dim' },
  '宝石':   { cls: 'bg-rose-900/40 text-rose-400 border-rose-700/40',   dot: 'bg-rose-400' },
  '消耗品': { cls: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40', dot: 'bg-emerald-400' },
  '工具':   { cls: 'bg-cyan-900/40 text-cyan-400 border-cyan-700/40',    dot: 'bg-cyan-400' },
  '特殊物品':{ cls: 'bg-amber-900/40 text-amber-400 border-amber-700/40', dot: 'bg-amber-400' },
};

function CatBadge({ cat }: { cat: ItemCategory }) {
  const c = CAT_CFG[cat] ?? CAT_CFG['其他物品'];
  return <span className={`text-[12px] font-mono px-1.5 py-0.5 rounded border ${c.cls}`}>{cat}</span>;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className={`shrink-0 w-9 h-5 rounded-full border transition-colors ${checked ? 'bg-god/30 border-god/50' : 'bg-void border-edge'}`}>
      <div className="w-3 h-3 rounded-full bg-white mx-1 transition-all" style={{ transform: checked ? 'translateX(16px)' : 'none' }} />
    </button>
  );
}

/* ── 物品卡片 ── */
function ItemCard({ item, onEdit, onDelete }: {
  item: InventoryItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const consumeItem = useItems((s) => s.consumeItem);
  const equipItem   = useItems((s) => s.equipItem);
  const unequipItem = useItems((s) => s.unequipItem);

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors bg-panel ${item.equipped ? 'border-god/40' : 'border-edge hover:border-edge/70'}`}>
      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b border-edge/50 ${item.equipped ? 'bg-god/5' : 'bg-panel2'}`}>
        <div className={`w-2 h-2 rounded-full shrink-0 ${CAT_CFG[item.category]?.dot ?? 'bg-dim'}`} />
        <CatBadge cat={item.category} />
        <span className="text-[12px] font-mono text-dim/60 truncate flex-1">{item.id}</span>
        {item.equipped && (
          <span className="text-[12px] font-mono text-god/70 border border-god/30 rounded px-1 py-0.5">已装备</span>
        )}
        {item.quantity > 1 && (
          <span className="text-sm font-bold font-mono text-slate-300">×{item.quantity}</span>
        )}
        <div className="flex gap-1 shrink-0">
          <button onClick={onEdit} className="text-[12px] px-1.5 py-0.5 border border-edge text-dim hover:border-god/40 hover:text-god rounded font-mono transition-colors">编辑</button>
          <button onClick={onDelete} className="text-[12px] px-1.5 py-0.5 border border-edge text-dim hover:border-blood/40 hover:text-blood rounded font-mono transition-colors">删除</button>
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-1">
        <div className="font-semibold text-sm text-slate-100">{item.name}</div>
        {item.gradeDesc && <div className="text-[13px] text-amber-400/70 font-mono">{item.gradeDesc}</div>}
        {item.effect && <div className="text-[13px] text-dim/80 leading-relaxed line-clamp-2">{item.effect}</div>}
        {(item.tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {(item.tags ?? []).map((t) => (
              <span key={t} className="text-[11px] font-mono px-1 py-0.5 bg-void border border-edge/50 text-dim/60 rounded">{t}</span>
            ))}
          </div>
        )}
        {/* Quick actions */}
        <div className="flex gap-1.5 pt-1">
          {item.quantity > 0 && (
            <button
              onClick={() => consumeItem(item.id, 1)}
              className="text-[12px] px-2 py-0.5 border border-edge text-dim hover:border-amber-400/40 hover:text-amber-400 rounded font-mono transition-colors"
            >
              使用×1
            </button>
          )}
          {item.equipped ? (
            <button
              onClick={() => unequipItem(item.id)}
              className="text-[12px] px-2 py-0.5 border border-god/30 text-god/70 hover:border-blood/40 hover:text-blood rounded font-mono transition-colors"
            >
              卸下
            </button>
          ) : (
            <button
              onClick={() => equipItem(item.id, item.category === '武器' ? 'weapon:right' : item.category === '防具' ? 'armor:armor' : 'treasure:#1')}
              className="text-[12px] px-2 py-0.5 border border-edge text-dim hover:border-god/40 hover:text-god rounded font-mono transition-colors"
            >
              装备
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 物品表单 ── */
const DEFAULT_ITEM: Omit<InventoryItem, 'id' | 'addedAt'> = {
  name: '', category: '其他物品', gradeDesc: '', effect: '', quantity: 1,
  equipped: false, tags: [], appearance: '', notes: '',
};

function ItemForm({ initial, onSave, onCancel }: {
  initial: InventoryItem | null;
  onSave: (item: Omit<InventoryItem, 'id' | 'addedAt'>) => void;
  onCancel: () => void;
}) {
  const isEdit = initial !== null;
  const [form, setForm] = useState<Omit<InventoryItem, 'id' | 'addedAt'>>(
    isEdit ? { ...initial! } : { ...DEFAULT_ITEM }
  );
  const [tagInput, setTagInput] = useState('');

  function addTag() {
    const t = tagInput.trim();
    if (t && !form.tags.includes(t)) setForm({ ...form, tags: [...form.tags, t] });
    setTagInput('');
  }

  function handleSave() {
    if (!form.name.trim()) return;
    onSave({ ...form, name: form.name.trim() });
  }

  return (
    <div className="border border-god/25 rounded-xl bg-void/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-god/80 font-mono">{isEdit ? `编辑 · ${initial!.name}` : '新建物品'}</span>
        <button onClick={onCancel} className="text-dim/50 hover:text-blood text-sm font-mono">✕</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="col-span-2 space-y-1">
          <label className="text-[12px] font-mono text-dim">名称</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="物品名称" className="w-full bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-god" />
        </div>
        <div className="space-y-1">
          <label className="text-[12px] font-mono text-dim">数量</label>
          <input type="number" min={0} value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 0 })}
            className="w-full bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm text-slate-200 font-mono outline-none focus:border-god" />
        </div>
        <div className="space-y-1">
          <label className="text-[12px] font-mono text-dim">分类</label>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ItemCategory })}
            className="w-full bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-god">
            {ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="col-span-2 space-y-1">
          <label className="text-[12px] font-mono text-dim">品阶描述</label>
          <input value={form.gradeDesc} onChange={(e) => setForm({ ...form, gradeDesc: e.target.value })}
            placeholder="三品玄阶法宝" className="w-full bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-god" />
        </div>
        <div className="col-span-3 space-y-1">
          <label className="text-[12px] font-mono text-dim">效果 / 描述</label>
          <textarea value={form.effect} onChange={(e) => setForm({ ...form, effect: e.target.value })}
            rows={2} placeholder="物品效果或描述…"
            className="w-full bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-god resize-none" />
        </div>
        {/* Tags */}
        <div className="col-span-3 space-y-1">
          <label className="text-[12px] font-mono text-dim">用途标签</label>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {form.tags.map((t) => (
              <span key={t} className="flex items-center gap-1 text-[12px] font-mono px-1.5 py-0.5 bg-god/10 text-god/80 border border-god/20 rounded">
                {t}
                <button onClick={() => setForm({ ...form, tags: form.tags.filter((x) => x !== t) })} className="opacity-60 hover:opacity-100">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <input value={tagInput} onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              placeholder="炼丹素材 / 修炼辅材 / 突破辅材…"
              className="flex-1 bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-god" />
            <button onClick={addTag} className="px-2 border border-edge text-dim hover:text-god rounded font-mono text-sm">+</button>
          </div>
        </div>
        <div className="col-span-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <Toggle checked={form.equipped} onChange={() => setForm({ ...form, equipped: !form.equipped })} />
            <span className="text-sm text-slate-300">已装备</span>
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-1.5 text-sm border border-edge text-dim rounded-lg hover:border-blood/40 hover:text-blood transition-colors font-mono">取消</button>
        <button onClick={handleSave} disabled={!form.name.trim()}
          className="px-5 py-1.5 text-sm border border-god/50 text-god rounded-lg hover:bg-god/10 transition-colors font-mono disabled:opacity-40">
          {isEdit ? '保存' : '创建'}
        </button>
      </div>
    </div>
  );
}

/* ── 货币面板（可编辑）── */
const CURRENCY_CFG: Record<keyof CurrencyWallet, { color: string; icon: string; sub: string }> = {
  乐园币:   { color: 'text-amber-300',  icon: '🪙', sub: '通用货币' },
  灵魂钱币: { color: 'text-violet-300', icon: '💎', sub: '稀有货币' },
  技能点:   { color: 'text-sky-300',    icon: '📘', sub: '技能升级' },
  黄金技能点:{ color: 'text-yellow-300', icon: '🌟', sub: '稀有技能点' },
};

function CurrencyPanel() {
  const wallet = useItems((s) => s.currency);
  const adj    = useItems((s) => s.adjustCurrency);
  const [edits, setEdits] = useState<Partial<Record<keyof CurrencyWallet, string>>>({});

  return (
    <div className="border border-edge rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-panel2 border-b border-edge text-sm font-mono text-dim/70">
        货币钱包
      </div>
      <div className="grid grid-cols-2 divide-x divide-edge">
        {(Object.keys(CURRENCY_CFG) as (keyof CurrencyWallet)[]).map((type) => {
          const cfg = CURRENCY_CFG[type];
          return (
            <div key={type} className="px-4 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <span>{cfg.icon}</span>
                <div className={`text-sm font-mono font-semibold ${cfg.color}`}>{type}</div>
              </div>
              <div className="text-[12px] text-dim/40 mb-2">{cfg.sub}</div>
              {edits[type] !== undefined ? (
                <input
                  autoFocus
                  type="number"
                  value={edits[type]}
                  onChange={(e) => setEdits({ ...edits, [type]: e.target.value })}
                  onBlur={() => {
                    const n = parseInt(edits[type]!) || 0;
                    adj(type, n - wallet[type], '手动调整（物品管理器）');
                    setEdits((prev) => { const next = { ...prev }; delete next[type]; return next; });
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className={`w-full bg-void border border-god/40 rounded px-2 py-1 text-lg font-mono text-god text-center outline-none`}
                />
              ) : (
                <button
                  onClick={() => setEdits({ ...edits, [type]: String(wallet[type]) })}
                  className={`text-2xl font-bold font-mono hover:text-god transition-colors ${cfg.color}`}
                >
                  {wallet[type].toLocaleString()}
                </button>
              )}
              <div className="flex justify-center gap-1 mt-2">
                <button onClick={() => adj(type, -1, '手动调整（物品管理器）')} className="w-6 h-6 text-sm border border-edge rounded text-dim hover:text-blood hover:border-blood/40 transition-colors">-</button>
                <button onClick={() => adj(type,  1, '手动调整（物品管理器）')} className="w-6 h-6 text-sm border border-edge rounded text-dim hover:text-god  hover:border-god/40  transition-colors">+</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── 单条条目行 ── */
function EntryRow({ entry, onToggle }: { entry: ItemPresetEntry; onToggle: () => void }) {
  const updateEntry = useItems((s) => s.updatePresetEntry);
  const [mode, setMode] = useState<'collapsed' | 'view' | 'edit'>('collapsed');

  // 编辑草稿
  const [draftName, setDraftName]       = useState(entry.name);
  const [draftContent, setDraftContent] = useState(entry.content);
  const [draftRole, setDraftRole]       = useState(entry.role);

  function startEdit() {
    setDraftName(entry.name);
    setDraftContent(entry.content);
    setDraftRole(entry.role);
    setMode('edit');
  }

  function saveEdit() {
    updateEntry(entry.identifier, { name: draftName.trim() || entry.name, content: draftContent, role: draftRole });
    setMode('collapsed');
  }

  const tokens = Math.round(entry.content.length / 3.5);
  const sourceBadge = entry.source?.replace('prompts.', '') ?? '';

  return (
    <div className={`border-b border-edge/40 last:border-0 ${!entry.enabled ? 'opacity-50' : ''}`}>
      {/* ── 行头 ── */}
      <div className="flex items-center gap-2 px-3 py-2 hover:bg-panel2 transition-colors">
        {/* 启用开关 */}
        <button
          onClick={onToggle}
          className={`shrink-0 w-7 h-4 rounded-full border transition-colors ${entry.enabled ? 'bg-god/30 border-god/50' : 'bg-void border-edge'}`}
        >
          <div
            className="w-2.5 h-2.5 rounded-full bg-white mx-0.5 transition-all"
            style={{ transform: entry.enabled ? 'translateX(12px)' : 'none' }}
          />
        </button>

        {/* 名称 */}
        <span className="flex-1 text-sm text-slate-300 truncate font-mono">{entry.name}</span>

        {/* 来源 */}
        {sourceBadge && (
          <span className="text-[11px] font-mono px-1.5 py-0.5 border border-edge text-dim/50 rounded shrink-0">
            {sourceBadge}
          </span>
        )}

        {/* token 估算 */}
        <span className="text-[12px] font-mono text-dim/50 w-12 text-right shrink-0">
          {tokens > 0 ? `~${tokens}` : '—'}
        </span>

        {/* 查看 / 编辑 按钮 */}
        <button
          onClick={() => setMode(mode === 'view' ? 'collapsed' : 'view')}
          className={`text-[12px] px-2 py-0.5 rounded border font-mono transition-colors shrink-0 ${
            mode === 'view' ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:border-god/40 hover:text-god'
          }`}
        >
          {mode === 'view' ? '收起' : '查看'}
        </button>
        <button
          onClick={() => mode === 'edit' ? setMode('collapsed') : startEdit()}
          className={`text-[12px] px-2 py-0.5 rounded border font-mono transition-colors shrink-0 ${
            mode === 'edit' ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:border-god/40 hover:text-god'
          }`}
        >
          {mode === 'edit' ? '取消' : '编辑'}
        </button>
      </div>

      {/* ── 只读展开 ── */}
      {mode === 'view' && (
        <div className="px-3 pb-3">
          <pre className="bg-void border border-edge/50 rounded-lg p-3 text-[13px] font-mono text-slate-400 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
            {entry.content}
          </pre>
        </div>
      )}

      {/* ── 编辑面板 ── */}
      {mode === 'edit' && (
        <div className="bg-void border-t border-god/20 px-4 py-4 space-y-3">
          {/* 名称 + role */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[12px] font-mono text-dim">名称</label>
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="w-full bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-god"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-mono text-dim">role</label>
              <select
                value={draftRole}
                onChange={(e) => setDraftRole(e.target.value)}
                className="w-full bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-god"
              >
                <option value="system">system</option>
                <option value="user">user</option>
                <option value="assistant">assistant</option>
              </select>
            </div>
          </div>

          {/* 内容 */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[12px] font-mono text-dim">content</label>
              <span className="text-[12px] font-mono text-dim/50">
                {draftContent.length} 字符 · ~{Math.round(draftContent.length / 3.5)} 词符
              </span>
            </div>
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              rows={10}
              className="w-full bg-panel border border-edge rounded-lg p-3 text-sm text-slate-200 font-mono leading-relaxed resize-y focus:border-god outline-none"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setMode('collapsed')}
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
const ENTRY_PAGE_SIZE = 10;

function EntryList() {
  const entries     = useItems((s) => s.settings.entries ?? []);
  const toggleEntry = useItems((s) => s.togglePresetEntry);

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
  const totalPages   = Math.max(1, Math.ceil(filtered.length / ENTRY_PAGE_SIZE));
  const safePage     = Math.min(page, totalPages - 1);
  const paged        = filtered.slice(safePage * ENTRY_PAGE_SIZE, (safePage + 1) * ENTRY_PAGE_SIZE);

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
            <EntryRow key={entry.identifier} entry={entry} onToggle={() => toggleEntry(entry.identifier)} />
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
              entries.filter(e => e.enabled).reduce((s, e) => s + e.content.length, 0) > 8000
                ? 'text-blood/70'
                : 'text-god/50'
            }`}>
              · 约 {Math.round(entries.filter(e => e.enabled).reduce((s, e) => s + e.content.length, 0) / 3.5)} tokens
              {entries.filter(e => e.enabled).reduce((s, e) => s + e.content.length, 0) > 8000 && ' ⚠ 过长'}
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
  const settings       = useItems((s) => s.settings);
  const setSettings    = useItems((s) => s.setSettings);
  const setEntries     = useItems((s) => s.setPresetEntries);
  const clearPreset    = useItems((s) => s.clearPreset);
  const smartFilter    = useItems((s) => s.smartFilterEntries);
  const deleteDisabled = useItems((s) => s.deleteDisabledEntries);
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
      const result = extractItemPresetFromJson(raw);
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
      name: settings.presetName || '物品管理预设',
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
    a.download = `${settings.presetName || 'item-preset'}.json`;
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

      <div className="p-4 bg-panel border border-edge rounded-xl space-y-3">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">更新频率</div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={settings.frequency === 1} onChange={() => setSettings({ frequency: 1 })} className="accent-god" />
            <span className="text-sm text-slate-300">每回合</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={settings.frequency > 1}
              onChange={() => setSettings({ frequency: settings.frequency === 1 ? 3 : settings.frequency })}
              className="accent-god" />
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
            ? '● 每次 AI 回复完成后处理物品更新'
            : `● 每隔 ${settings.frequency} 回合处理一次物品更新`}
        </div>
      </div>

      {/* 物品对账纠错 */}
      <div className="p-4 bg-panel border border-edge rounded-xl space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.auditEnabled !== false}
            onChange={(e) => setSettings({ auditEnabled: e.target.checked })}
            className="accent-god w-4 h-4"
          />
          <span className="text-sm font-mono text-god/70 uppercase tracking-widest">物品对账纠错</span>
        </label>
        <div className="text-[13px] text-dim/70 leading-relaxed">
          勾选后，会把<b>物品检查</b>纳入回合末的<b>「综合对账纠错」</b>——它在<b>主角演化 + 物品演化都跑完后只调一次</b> AI：
          看「应用后真实清单(真实ID) + 最近两回合正文」，补正文已发生、但清单没落实的 消耗/丢弃/数量/穿脱 差异 + 合并重复条目（不创建新物品、不动货币）。
          <b>NPC 物品只纠正标签为「随从/宠物」的，其它 NPC 不碰</b>。与「主角演化」里的同名开关共用这一次调用。关闭则综合对账不查物品。
        </div>
      </div>

      {/* 预设文件 */}
      <div className="p-4 bg-panel border border-edge rounded-xl space-y-3">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">预设文件</div>

        {settings.presetName ? (
          <div className="flex items-center justify-between p-3 bg-god/5 border border-god/20 rounded-lg">
            <div>
              <div className="text-sm font-semibold text-god">{settings.presetName}</div>
              {settings.presetVersion && <div className="text-[13px] text-dim font-mono">v{settings.presetVersion}</div>}
              <div className="text-[13px] text-dim mt-0.5">
                {(settings.entries ?? []).length} 条 · 已启用 {(settings.entries ?? []).filter(e => e.enabled).length} 条
              </div>
            </div>
            <button onClick={clearPreset} className="text-sm text-dim hover:text-blood font-mono transition-colors">清除</button>
          </div>
        ) : (
          <div className="text-sm text-dim font-mono py-3 text-center border border-dashed border-edge rounded-lg">
            未加载预设，导入 JSON 后可逐条启用/禁用规则
          </div>
        )}

        {/* 操作按钮行 */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => fileRef.current?.click()}
            className="px-4 py-2 border border-god/40 text-god text-sm rounded-lg hover:bg-god/10 transition-colors font-mono">
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

          {/* 智能筛选：只保留物品相关条目 */}
          {settings.entries.length > 0 && (
            <button
              onClick={() => {
                const kept = smartFilter();
                setMsg(`✓ 智能筛选完成：保留 ${kept} 条物品相关条目，其余已禁用`);
                setTimeout(() => setMsg(''), 5000);
              }}
              className="px-3 py-2 border border-amber-600/50 text-amber-400 text-sm rounded-lg hover:bg-amber-900/20 transition-colors font-mono"
              title="只保留物品/装备相关条目，禁用角色、地图、NPC等无关内容"
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

          {/* 诊断按钮 */}
          <button
            onClick={() => {
              const s = useItems.getState().settings;
              console.log('[Preset诊断] 预设名:', s.presetName);
              console.log('[Preset诊断] 总条目:', s.entries?.length ?? 0);
              console.log('[Preset诊断] 已启用:', s.entries?.filter(e => e.enabled).length ?? 0);
              console.log('[Preset诊断] 条目列表:', s.entries?.map(e => `${e.name}(enabled=${e.enabled})`));
              alert(`预设: ${s.presetName || '无'}\n总条目: ${s.entries?.length ?? 0}\n已启用: ${s.entries?.filter(e => e.enabled).length ?? 0}\n(详细见 Console)`);
            }}
            className="px-3 py-2 border border-edge text-dim text-sm rounded-lg hover:border-god/40 hover:text-god transition-colors font-mono"
          >
            🔍 诊断
          </button>

          {msg && <span className={`text-sm font-mono ${msg.startsWith('❌') ? 'text-blood' : 'text-god'}`}>{msg}</span>}
        </div>
      </div>

      {/* 条目列表 */}
      {(settings.entries ?? []).length > 0 && <EntryList />}
    </div>
  );
}

/* ════════════════════════════════════════════
   API 设置
════════════════════════════════════════════ */
function ItemApiSection() {
  return (
    <div className="space-y-6">
      <div className="border-b border-edge pb-3">
        <h2 className="text-base font-bold text-slate-100">物品管理 API</h2>
        <p className="text-sm text-dim mt-0.5">用于物品管理阶段的语言模型接口——从下方接口路由勾选（在「综合设置 → API 接口库」新增 / 编辑接口）</p>
      </div>

      <ApiRoutePicker routeKey="item" />
    </div>
  );
}

/* ════════════════════════════════════════════
   主组件
════════════════════════════════════════════ */
type ItemTab = 'inventory' | 'settings' | 'api';

export default function ItemManager() {
  const items      = useItems((s) => s.items);
  const addItem    = useItems((s) => s.addItem);
  const removeItem = useItems((s) => s.removeItem);
  const updateItem = useItems((s) => s.updateItem);
  const enabled    = useItems((s) => s.settings.enabled);
  const setSettings= useItems((s) => s.setSettings);

  const [tab, setTab]       = useState<ItemTab>('inventory');
  const [editing, setEditing] = useState<InventoryItem | 'new' | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [filterCat, setFilterCat] = useState<ItemCategory | 'all'>('all');

  const filtered = items.filter((it) => {
    const q = searchQ.toLowerCase();
    const matchQ = !q || it.name.toLowerCase().includes(q) || it.gradeDesc.toLowerCase().includes(q) || it.effect.toLowerCase().includes(q);
    const matchCat = filterCat === 'all' || it.category === filterCat;
    return matchQ && matchCat;
  });

  function handleSave(form: Omit<InventoryItem, 'id' | 'addedAt'>) {
    if (editing === 'new') {
      addItem(form);
    } else if (editing) {
      updateItem(editing.id, form);
    }
    setEditing(null);
  }

  // 各分类有几件
  const catCounts = items.reduce<Record<string, number>>((acc, it) => {
    acc[it.category] = (acc[it.category] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div className="flex max-lg:flex-wrap items-center justify-between gap-4 border-b border-edge pb-4">
        {/* 左：标题 + 启用开关 */}
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-100">物品管理</h2>
            <p className="text-sm text-dim mt-0.5">追踪角色背包，AI 自动更新物品与货币</p>
          </div>
          {/* 启用开关 — 常驻页头，任意 Tab 均可见 */}
          <label className={`flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg border transition-colors ${
            enabled
              ? 'border-god/40 bg-god/8'
              : 'border-edge bg-panel hover:border-god/30'
          }`}>
            <Toggle checked={enabled} onChange={() => setSettings({ enabled: !enabled })} />
            <span className={`text-sm font-mono ${enabled ? 'text-god' : 'text-dim'}`}>
              {enabled ? '物品更新 已启用' : '物品更新 已停用'}
            </span>
          </label>
        </div>

        {/* 右：Tab */}
        <div className="flex items-center gap-2 shrink-0">
          {[
            { key: 'inventory', label: '背包' },
            { key: 'settings',  label: '预设设置' },
            { key: 'api',       label: 'API 设置' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as ItemTab)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors font-mono ${
                tab === t.key ? 'bg-god/10 border-god/40 text-god' : 'border-edge text-dim hover:border-god/30 hover:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'api' ? (
        <ItemApiSection />
      ) : tab === 'settings' ? (
        <PresetSettings />
      ) : (
        <>
          {/* 货币 */}
          <CurrencyPanel />

          {/* 新建/编辑表单 */}
          {editing !== null && (
            <ItemForm
              initial={editing === 'new' ? null : editing}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
            />
          )}

          {/* 搜索 + 过滤 + 新建 */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-1 min-w-48 bg-panel border border-edge rounded-lg px-3 py-1.5 focus-within:border-god/40 transition-colors">
              <span className="text-dim/50 text-sm">🔍</span>
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="搜索物品名称、品阶、效果…"
                className="flex-1 bg-transparent text-sm text-slate-200 outline-none placeholder:text-dim/40 font-mono"
              />
              {searchQ && <button onClick={() => setSearchQ('')} className="text-dim/50 hover:text-blood text-sm">✕</button>}
            </div>

            {/* 分类过滤 */}
            <div className="flex items-center gap-1 flex-wrap text-[12px] font-mono">
              <button
                onClick={() => setFilterCat('all')}
                className={`px-2 py-1 rounded border transition-colors ${filterCat === 'all' ? 'bg-god/10 border-god/40 text-god' : 'border-edge text-dim hover:border-god/30'}`}
              >
                全部 ({items.length})
              </button>
              {ITEM_CATEGORIES.filter((c) => catCounts[c]).map((c) => (
                <button
                  key={c}
                  onClick={() => setFilterCat(filterCat === c ? 'all' : c)}
                  className={`px-2 py-1 rounded border transition-colors ${
                    filterCat === c
                      ? `${CAT_CFG[c].cls} border-opacity-80`
                      : 'border-edge text-dim hover:border-god/30'
                  }`}
                >
                  {c} ({catCounts[c]})
                </button>
              ))}
            </div>

            <button
              onClick={() => setEditing('new')}
              className="px-4 py-1.5 text-sm border border-god/50 text-god rounded-lg hover:bg-god/10 transition-colors font-mono shrink-0"
            >
              + 新建物品
            </button>
          </div>

          {/* 物品网格 */}
          {filtered.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-edge rounded-xl">
              {items.length === 0 ? (
                <>
                  <div className="text-dim text-sm font-mono mb-1">背包空空如也</div>
                  <div className="text-dim/40 text-sm">手动添加物品，或等 AI 通过 &lt;upstore&gt; createItem 指令自动创建</div>
                </>
              ) : (
                <div className="text-dim text-sm font-mono">无匹配物品</div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {filtered.map((it) => (
                <ItemCard
                  key={it.id}
                  item={it}
                  onEdit={() => setEditing(editing === it ? null : it)}
                  onDelete={() => { removeItem(it.id); if (editing === it) setEditing(null); }}
                />
              ))}
            </div>
          )}

          {/* 统计 */}
          {items.length > 0 && (
            <div className="text-[12px] font-mono text-dim/50 px-1">
              共 {items.length} 件 · 已装备 {items.filter((it) => it.equipped).length} 件 ·
              总数量 {items.reduce((s, it) => s + it.quantity, 0)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
