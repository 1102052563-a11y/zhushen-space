import { useState, useRef } from 'react';
import { useItems, ITEM_CATEGORIES, ITEM_GRADES, gradeColorClass, gradeBadgeClass, gradeNameClass, socketsOf, type InventoryItem, type ItemCategory, type CurrencyWallet } from '../store/itemStore';
import { enhanceColorClass, enhancedCombat } from '../systems/enhanceEngine';
import { usePlayer } from '../store/playerStore';
import { useSkillTree } from '../store/skillTreeStore';
import { availablePP } from '../systems/skillTree';
import { useImageGen, effectiveEquipService } from '../store/imageGenStore';
import { generateImage, buildEquipPrompt, shrinkDataUrl } from '../systems/imageGen';
import { useImageViewer } from '../store/imageViewerStore';
import { useComposer } from '../store/composerStore';
import { genEquipTags, isTagService } from '../systems/imageTags';
import { pickEquipSlot } from '../systems/equipSlots';

/* 物品图片：上传/替换/移除/AI生成（dataURL 存 InventoryItem.image）*/
function ItemImageBlock({ item, onUpdate }: { item: InventoryItem; onUpdate: (patch: Partial<InventoryItem>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [gening, setGening] = useState(false);
  const [err, setErr] = useState('');
  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { alert('图片请小于 3MB'); return; }
    const reader = new FileReader();
    reader.onload = async () => onUpdate({ image: await shrinkDataUrl(String(reader.result), 768) });
    reader.readAsDataURL(file);
  }
  async function handleGen() {
    setGening(true); setErr('');
    try {
      const ig = useImageGen.getState();
      const service = effectiveEquipService(ig);
      // NAI/ComfyUI 等标签模型：把中文装备描述翻成英文 danbooru tags；自然语言模型用中文模板
      let prompt = '';
      if (isTagService(service)) {
        const desc = [item.name, item.category, item.gradeDesc, item.appearance, item.effect].filter(Boolean).join('，');
        prompt = await genEquipTags(desc);
      }
      if (!prompt) prompt = buildEquipPrompt({ name: item.name, category: item.category, gradeDesc: item.gradeDesc, appearance: item.appearance, effect: item.effect });
      const url = await generateImage(service, { prompt, negative: ig.equipNegative, label: `生成装备图 ${item.name}` });
      onUpdate({ image: await shrinkDataUrl(url, 768) });
    } catch (e: any) { setErr(e.message ?? '生成失败'); }
    finally { setGening(false); }
  }
  return (
    <div className="flex items-center gap-3">
      <div onClick={() => item.image && useImageViewer.getState().open(item.image, item.name)}
        title={item.image ? '点击查看大图' : ''}
        className={`shrink-0 w-24 h-24 rounded-lg overflow-hidden border border-edge/60 bg-void/60 flex items-center justify-center ${item.image ? 'cursor-zoom-in hover:border-god/40' : ''}`}>
        {gening ? <span className="text-[11px] font-mono text-god/70 animate-pulse">生成中…</span>
          : item.image
          ? <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
          : <span className="text-3xl text-dim/25">{CAT_ICON[item.category] ?? '◆'}</span>}
      </div>
      <div className="flex flex-col gap-2">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        <button onClick={handleGen} disabled={gening}
          className="px-3 py-1.5 text-[13px] font-mono border border-god/50 text-god rounded hover:bg-god/10 disabled:opacity-40 transition-colors">
          {gening ? '生成中…' : '✨ AI 生成'}
        </button>
        <button onClick={() => fileRef.current?.click()}
          className="px-3 py-1.5 text-[13px] font-mono border border-edge text-dim rounded hover:border-god/40 hover:text-god transition-colors">
          {item.image ? '替换图片' : '上传图片'}
        </button>
        {item.image && (
          <button onClick={() => onUpdate({ image: '' })}
            className="px-3 py-1.5 text-[13px] font-mono border border-edge text-dim rounded hover:border-blood/40 hover:text-blood transition-colors">移除</button>
        )}
        {err && <div className="text-[11px] text-blood font-mono max-w-[240px] leading-snug whitespace-pre-line">{err}</div>}
      </div>
    </div>
  );
}

/* ── 分类颜色（与 ItemManager 一致）── */
export const CAT_CFG: Record<ItemCategory, { cls: string; dot: string; light: string }> = {
  // 装备类
  '武器':    { cls: 'bg-red-900/40 text-red-400 border-red-700/40',             dot: 'bg-red-400',     light: 'text-red-400' },
  '防具':    { cls: 'bg-sky-900/40 text-sky-400 border-sky-700/40',             dot: 'bg-sky-400',     light: 'text-sky-400' },
  '饰品':    { cls: 'bg-violet-900/40 text-violet-400 border-violet-700/40',    dot: 'bg-violet-400',  light: 'text-violet-400' },
  // 轮回乐园主分类
  '消耗品':  { cls: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40', dot: 'bg-emerald-400', light: 'text-emerald-400' },
  '材料':    { cls: 'bg-slate-700/40 text-slate-400 border-slate-600/40',       dot: 'bg-slate-400',   light: 'text-slate-400' },
  '工具':    { cls: 'bg-cyan-900/40 text-cyan-400 border-cyan-700/40',          dot: 'bg-cyan-400',    light: 'text-cyan-400' },
  '重要物品':{ cls: 'bg-orange-900/40 text-orange-400 border-orange-700/40',    dot: 'bg-orange-400',  light: 'text-orange-400' },
  '特殊物品':{ cls: 'bg-amber-900/40 text-amber-400 border-amber-700/40',       dot: 'bg-amber-400',   light: 'text-amber-400' },
  '凡物':    { cls: 'bg-zinc-800/40 text-zinc-500 border-zinc-700/40',          dot: 'bg-zinc-500',    light: 'text-zinc-500' },
  '其他物品':{ cls: 'bg-panel2 text-dim border-edge',                           dot: 'bg-dim',         light: 'text-dim' },
  // 旧版兼容
  '功法':    { cls: 'bg-amber-900/40 text-amber-400 border-amber-700/40',       dot: 'bg-amber-400',   light: 'text-amber-400' },
  '法宝':    { cls: 'bg-yellow-900/40 text-yellow-400 border-yellow-700/40',    dot: 'bg-yellow-400',  light: 'text-yellow-400' },
  '丹药':    { cls: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40', dot: 'bg-emerald-400', light: 'text-emerald-400' },
  '符箓':    { cls: 'bg-teal-900/40 text-teal-400 border-teal-700/40',          dot: 'bg-teal-400',    light: 'text-teal-400' },
  '灵药':    { cls: 'bg-green-900/40 text-green-400 border-green-700/40',       dot: 'bg-green-400',   light: 'text-green-400' },
  '阵具':    { cls: 'bg-cyan-900/40 text-cyan-400 border-cyan-700/40',          dot: 'bg-cyan-400',    light: 'text-cyan-400' },
};

/* ── 货币样式 ── */
const CURRENCY_CFG: Record<keyof CurrencyWallet, { color: string; sub: string; icon: string }> = {
  乐园币:     { color: 'text-amber-300',   sub: '通用货币',    icon: '🪙' },
  灵魂钱币:   { color: 'text-violet-300',  sub: '稀有货币',    icon: '💎' },
  技能点:     { color: 'text-emerald-300', sub: '技能升级点',  icon: '🔹' },
  黄金技能点: { color: 'text-yellow-300',  sub: '高阶技能升级点', icon: '🔸' },
};

type SortKey = 'original' | 'category' | 'name';

/* ── 图标 ── */
export const CAT_ICON: Record<string, string> = {
  '武器': '⚔', '防具': '🛡', '饰品': '💍', '宝石': '💎', '消耗品': '🧪', '材料': '📦',
  '工具': '🔧', '重要物品': '📜', '特殊物品': '📖', '凡物': '👕', '其他物品': '◆',
  '功法': '📖', '法宝': '🔱', '丹药': '💊', '符箓': '📋', '灵药': '🌿', '阵具': '🔮',
};

/* SVG 图标辅助 */
const Ico = ({ d, size = 14 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d={d}/>
  </svg>
);
const ICO_LOCK_CLOSED = 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z';
const ICO_LOCK_OPEN   = 'M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z';
const ICO_EDIT        = 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z';
const ICO_TRASH       = 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16';
const ICO_SAVE        = 'M5 13l4 4L19 7';

/* ════════════════════════════════════════════
   物品详情浮窗
════════════════════════════════════════════ */
export function ItemDetailModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const consumeItem = useItems((s) => s.consumeItem);
  const removeItem  = useItems((s) => s.removeItem);
  const equipItem   = useItems((s) => s.equipItem);
  const unequipItem = useItems((s) => s.unequipItem);
  const updateItem  = useItems((s) => s.updateItem);
  const allItems    = useItems((s) => s.items);   // 用于「一键装备」时挑选空槽，避免不同部位互相覆盖

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: item.name, gradeDesc: item.gradeDesc, effect: item.effect,
    appearance: item.appearance ?? '',
    notes: item.notes ?? '', acquisition: item.acquisition ?? '',
  });

  const cfg  = CAT_CFG[item.category] ?? CAT_CFG['其他物品'];
  const icon = CAT_ICON[item.category] ?? '◆';
  const canEquip   = (['武器','防具','饰品','法宝','功法','特殊物品'] as string[]).includes(item.category);
  const canConsume = (['消耗品','丹药','符箓','灵药'] as string[]).includes(item.category);

  const saveEdit = () => {
    updateItem(item.id, { name: draft.name, gradeDesc: draft.gradeDesc,
      effect: draft.effect, appearance: draft.appearance, notes: draft.notes, acquisition: draft.acquisition });
    setEditing(false);
  };

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-1">
      <div className="text-[12px] font-mono text-dim/40 uppercase tracking-wide">{label}</div>
      <div>{children}</div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col max-h-[85vh]">

        {/* ── 顶部标题栏 ── */}
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-edge bg-panel">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl border ${
            item.equipped ? 'border-god/40 bg-god/10' : 'border-edge/60 bg-panel2'
          }`}>{icon}</div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="w-full bg-void border border-god/40 rounded px-2 py-0.5 text-sm font-bold text-slate-100 focus:outline-none"
              />
            ) : (
              <div className={`text-sm font-bold truncate ${gradeNameClass(item.gradeDesc)}`}>{item.name}</div>
            )}
            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
              <span className={`text-[12px] font-mono px-1.5 py-0.5 rounded border ${cfg.cls}`}>{item.category}</span>
              {item.equipped && (
                <span className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-god/40 text-god bg-god/10">装备中</span>
              )}
              {(item.enhanceLevel ?? 0) > 0 && (
                <span className={`text-[12px] font-mono px-1.5 py-0.5 rounded border border-amber-400/40 bg-amber-400/5 ${enhanceColorClass(item.enhanceLevel!)}`}>强化 +{item.enhanceLevel}</span>
              )}
              {item.locked && (
                <span className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-blue-500/40 text-blue-400">锁定</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
        </header>

        {/* ── 滚动内容区 ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* 物品图片（上传/替换/移除；未来生图位）*/}
          <ItemImageBlock item={item} onUpdate={(patch) => updateItem(item.id, patch)} />

          {/* 基础信息格子 */}
          <div className="grid grid-cols-2 gap-3 bg-panel2 rounded-xl p-3 border border-edge/40">
            <div>
              <div className="text-[12px] font-mono text-dim/40">数量</div>
              <div className="text-sm font-mono font-bold text-slate-200">×{item.quantity}</div>
            </div>
            {item.equipped && item.equipSlot && (
              <div>
                <div className="text-[12px] font-mono text-dim/40">装备槽</div>
                <div className="text-sm font-mono text-god/80">{item.equipSlot}</div>
              </div>
            )}
            <div>
              <div className="text-[12px] font-mono text-dim/40">物品 ID</div>
              <div className="text-[12px] font-mono text-dim/50">{item.id}</div>
            </div>
            {(item.tags?.length ?? 0) > 0 && (
              <div>
                <div className="text-[12px] font-mono text-dim/40">标签</div>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {(item.tags ?? []).map((t) => (
                    <span key={t} className="text-[11px] font-mono px-1 py-0.5 bg-void border border-edge/50 text-dim/50 rounded">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 固定模板属性（产地/类型/战斗数值/耐久/评分）*/}
          {(item.origin || item.subType || item.combatStat || item.durability || item.score || item.killCount) && (
            <div className="grid grid-cols-2 gap-3 bg-panel2 rounded-xl p-3 border border-edge/40">
              {item.origin && (<div><div className="text-[12px] font-mono text-dim/40">产地</div><div className="text-[13px] text-dim/80">{item.origin}</div></div>)}
              {item.subType && (<div><div className="text-[12px] font-mono text-dim/40">类型</div><div className="text-[13px] text-dim/80">{item.subType}</div></div>)}
              {item.combatStat && (() => {
                const ec = enhancedCombat(item.combatStat, item.enhanceLevel ?? 0);
                const cls = enhanceColorClass(item.enhanceLevel ?? 0);
                return (<div><div className="text-[12px] font-mono text-dim/40">攻击/防御</div>
                  {ec
                    ? <div className="text-[13px] font-mono flex flex-wrap items-baseline gap-x-1"><span className="text-dim/40 line-through">{ec.base}</span><span className="text-dim/40">→</span><span className={`font-bold ${cls}`}>{ec.enhanced}</span><span className={`text-[11px] ${cls}`}>强化+{item.enhanceLevel}·+{ec.pct}%</span></div>
                    : <div className="text-[13px] font-mono text-amber-300/90">{item.combatStat}</div>}
                </div>);
              })()}
              {item.durability && (<div><div className="text-[12px] font-mono text-dim/40">耐久度</div><div className="text-[13px] font-mono text-slate-300">{item.durability}</div></div>)}
              {item.score && (<div><div className="text-[12px] font-mono text-dim/40">评分</div><div className="text-[13px] font-mono text-emerald-300/90">{item.score}</div></div>)}
              {item.killCount && (<div><div className="text-[12px] font-mono text-dim/40">杀敌数量</div><div className="text-[13px] font-mono text-blood/90">{item.killCount}</div></div>)}
            </div>
          )}

          {/* 品级（颜色品质）*/}
          {(item.gradeDesc || editing) && (
            <Field label="品级">
              {editing ? (
                <select
                  value={draft.gradeDesc}
                  onChange={(e) => setDraft((d) => ({ ...d, gradeDesc: e.target.value }))}
                  className={`w-full bg-void border border-edge rounded px-2 py-1 text-[13px] font-mono focus:outline-none focus:border-god/50 ${gradeColorClass(draft.gradeDesc)}`}
                >
                  <option value="">（未定级）</option>
                  {ITEM_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                  {!ITEM_GRADES.includes(draft.gradeDesc as any) && draft.gradeDesc && <option value={draft.gradeDesc}>{draft.gradeDesc}（自定义）</option>}
                </select>
              ) : (
                <div className={`text-[13px] font-mono leading-relaxed ${gradeBadgeClass(item.gradeDesc)}`}>{item.gradeDesc}</div>
              )}
            </Field>
          )}

          {/* 获得途径 */}
          {(item.acquisition || editing) && (
            <Field label="获得途径">
              {editing ? (
                <input
                  value={draft.acquisition}
                  onChange={(e) => setDraft((d) => ({ ...d, acquisition: e.target.value }))}
                  className="w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-dim/80 focus:outline-none focus:border-god/50"
                />
              ) : (
                <div className="text-[13px] text-dim/70 leading-relaxed">{item.acquisition}</div>
              )}
            </Field>
          )}

          {/* 效果 */}
          {(item.effect || editing) && (
            <Field label="效果">
              <div className="bg-panel2 border border-edge/40 rounded-lg p-3">
                {editing ? (
                  <textarea
                    value={draft.effect}
                    onChange={(e) => setDraft((d) => ({ ...d, effect: e.target.value }))}
                    rows={4}
                    className="w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-dim/80 focus:outline-none focus:border-god/50 resize-none"
                  />
                ) : (
                  <div className="text-[13px] text-dim/80 leading-relaxed">{item.effect}</div>
                )}
              </div>
            </Field>
          )}

          {/* 装备需求 */}
          {item.requirement && (
            <Field label="装备需求">
              <div className="text-[13px] text-sky-200/80 leading-relaxed">{item.requirement}</div>
            </Field>
          )}

          {/* 词缀 */}
          {item.affix && (
            <Field label="词缀">
              <div className="text-[13px] text-amber-200/85 leading-relaxed">{item.affix}</div>
            </Field>
          )}

          {/* 镶嵌孔（装备类，按品级自带孔位；宝石加成展示）*/}
          {(['武器', '防具', '饰品'] as string[]).includes(item.category) && socketsOf(item) > 0 && (
            <Field label={`镶嵌孔　${(item.gems ?? []).length} / ${socketsOf(item)}`}>
              <div className="space-y-1">
                {Array.from({ length: socketsOf(item) }).map((_, i) => {
                  const g = (item.gems ?? [])[i];
                  return g ? (
                    <div key={i} className={`rounded-lg border p-2 ${g.high ? 'border-amber-500/30 bg-amber-500/5' : 'border-edge/50 bg-panel2'}`}>
                      <div className="flex items-center gap-1.5">
                        <span>💎</span>
                        <span className={`text-[12.5px] font-bold ${gradeNameClass(g.tier)}`}>{g.name}</span>
                      </div>
                      <div className={`text-[12px] leading-snug mt-0.5 ${g.high ? 'text-amber-200/85' : 'text-slate-200/80'}`}>{g.statText}</div>
                    </div>
                  ) : (
                    <div key={i} className="rounded-lg border border-dashed border-edge/50 p-1.5 text-center text-[11px] font-mono text-dim/30">○ 空孔（强化所→💎宝石 镶嵌）</div>
                  );
                })}
              </div>
            </Field>
          )}

          {/* 简介 */}
          {item.intro && (
            <Field label="简介">
              <div className="text-[13px] text-dim/50 leading-relaxed italic border-l-2 border-edge/40 pl-2">{item.intro}</div>
            </Field>
          )}

          {/* 外观（生图依据——务必填写，AI 据此生成装备图）；始终显示，空则提示补充 */}
          <Field label="外观（生图依据）">
            {editing ? (
              <textarea
                value={draft.appearance}
                onChange={(e) => setDraft((d) => ({ ...d, appearance: e.target.value }))}
                rows={3}
                placeholder="描述物品的外形/材质/颜色/纹饰等，用于生成配图"
                className="w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-dim/80 focus:outline-none focus:border-god/50 resize-none"
              />
            ) : item.appearance ? (
              <div className="text-[13px] text-dim/60 leading-relaxed italic border-l-2 border-edge/40 pl-2">
                {item.appearance}
              </div>
            ) : (
              <div className="text-[12px] text-dim/35 italic leading-relaxed border-l-2 border-edge/30 pl-2">
                （未填写外观——点下方「编辑物品」补充，AI 生成配图需要它）
              </div>
            )}
          </Field>

          {/* 备注 */}
          {(item.notes || editing) && (
            <Field label="备注">
              {editing ? (
                <textarea
                  value={draft.notes}
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                  rows={2}
                  className="w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-dim/60 focus:outline-none focus:border-god/50 resize-none"
                />
              ) : (
                <div className="text-[13px] text-dim/60 leading-relaxed italic">{item.notes}</div>
              )}
            </Field>
          )}
        </div>

        {/* ── 底部操作栏 ── */}
        <footer className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-edge bg-panel">
          {/* 使用：把「使用此物品」填入输入框，发送后由 AI 结算效果（如增加属性）；旁边「−1」仅直接减数量不走 AI */}
          {canConsume && item.quantity > 0 && (
            <>
              <button
                onClick={() => {
                  const eff = item.effect?.trim();
                  useComposer.getState().fill(eff ? `使用【${item.name}】（效果：${eff}）` : `使用【${item.name}】`);
                  onClose();
                }}
                title="把「使用此物品」填入输入框，发送给 AI 结算效果（如增加属性）"
                className="px-3 py-1.5 border border-emerald-700/50 text-emerald-400 hover:bg-emerald-900/20 rounded-lg text-sm font-mono transition-colors"
              >
                使用
              </button>
              <button
                onClick={() => { consumeItem(item.id, 1); if (item.quantity <= 1) onClose(); }}
                title="直接消耗 1 个（仅减少数量，不触发 AI 结算）"
                className="px-2 py-1.5 border border-edge text-dim/70 hover:text-emerald-400 hover:border-emerald-700/50 rounded-lg text-sm font-mono transition-colors"
              >
                −1
              </button>
            </>
          )}
          {/* 装备/卸下 */}
          {canEquip && (
            item.equipped ? (
              <button
                onClick={() => unequipItem(item.id)}
                className="px-3 py-1.5 border border-god/30 text-god/70 hover:border-blood/40 hover:text-blood rounded-lg text-sm font-mono transition-colors"
              >
                卸下
              </button>
            ) : (
              // 不在背包里直接装备：请到「⚔ 装备」面板先选槽位再穿戴
              <span className="px-3 py-1.5 text-[12px] font-mono text-dim/40 border border-dashed border-edge rounded-lg">到「⚔ 装备」面板穿戴</span>
            )
          )}

          <div className="flex-1"/>

          {/* 锁定 */}
          <button
            onClick={() => updateItem(item.id, { locked: !item.locked })}
            className={`p-1.5 rounded-lg transition-colors ${item.locked ? 'text-blue-400 bg-blue-900/20' : 'text-dim/40 hover:text-dim'}`}
            title={item.locked ? '解锁' : '锁定'}
          >
            <Ico d={item.locked ? ICO_LOCK_CLOSED : ICO_LOCK_OPEN} />
          </button>

          {/* 编辑/保存 */}
          <button
            onClick={editing ? saveEdit : () => setEditing(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-sm font-mono transition-colors ${
              editing
                ? 'border-god/40 text-god bg-god/10 hover:bg-god/20'
                : 'border-edge text-dim hover:border-god/40 hover:text-god'
            }`}
          >
            <Ico d={editing ? ICO_SAVE : ICO_EDIT} size={12}/>
            {editing ? '保存' : '编辑物品'}
          </button>

          {/* 删除（装备中不可删除，需先卸下）*/}
          {!item.locked && !item.equipped && (
            <button
              onClick={() => { if (confirm(`确认丢弃「${item.name}」？`)) { removeItem(item.id); onClose(); } }}
              className="p-1.5 rounded-lg text-dim/40 hover:text-blood transition-colors"
              title="丢弃"
            >
              <Ico d={ICO_TRASH} />
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   紧凑物品卡片（列表用）
════════════════════════════════════════════ */
function ItemCard({ item, onOpen }: { item: InventoryItem; onOpen: () => void }) {
  const removeItem  = useItems((s) => s.removeItem);
  const updateItem  = useItems((s) => s.updateItem);

  const cfg  = CAT_CFG[item.category] ?? CAT_CFG['其他物品'];
  const icon = CAT_ICON[item.category] ?? '◆';

  return (
    <div
      className={`rounded-xl overflow-hidden border transition-all cursor-pointer hover:border-god/40 ${
        item.equipped ? 'border-god/50 bg-god/5' : 'border-edge bg-panel'
      }`}
      onClick={onOpen}
    >

      {/* ── 装备状态条 ── */}
      {item.equipped && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-god/10 border-b border-god/30">
          <span className="text-god text-[12px]">✦</span>
          <span className="text-[12px] font-mono text-god/80">装备中</span>
          {item.equipSlot && (
            <>
              <span className="text-god/40 text-[12px]">·</span>
              <span className="text-[12px] font-mono text-god/60">{item.equipSlot}</span>
            </>
          )}
        </div>
      )}

      {/* ── 主体（紧凑） ── */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        {/* 图标 */}
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0
          border ${item.equipped ? 'border-god/40 bg-god/10' : 'border-edge/60 bg-panel2'}`}>
          {icon}
        </div>

        {/* 名称 + 徽章 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold truncate ${gradeNameClass(item.gradeDesc)}`}>{item.name}</span>
            {item.quantity !== 1 && (
              <span className="text-sm font-mono text-dim/50 shrink-0">×{item.quantity}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className={`text-[12px] font-mono px-1.5 py-0.5 rounded border ${cfg.cls}`}>{item.category}</span>
            {item.gradeDesc && <span className={`text-[12px] font-mono ${gradeBadgeClass(item.gradeDesc)}`}>{item.gradeDesc}</span>}
            {item.locked && <span className="text-[11px] font-mono text-blue-400">🔒</span>}
            {/* 简要效果预览 */}
            {item.effect && (
              <span className="text-[12px] text-dim/50 truncate max-w-[120px]">{item.effect}</span>
            )}
          </div>
        </div>

        {/* 右侧操作按钮（阻止冒泡到卡片点击）*/}
        <div className="flex flex-col gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => updateItem(item.id, { locked: !item.locked })}
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
              item.locked ? 'text-blue-400' : 'text-dim/25 hover:text-dim/60'
            }`}
            title={item.locked ? '解锁' : '锁定'}
          >
            <Ico d={item.locked ? ICO_LOCK_CLOSED : ICO_LOCK_OPEN} />
          </button>
          <button
            onClick={onOpen}
            className="w-6 h-6 flex items-center justify-center text-dim/25 hover:text-god rounded transition-colors"
            title="编辑"
          >
            <Ico d={ICO_EDIT} />
          </button>
          {!item.locked && !item.equipped && (
            <button
              onClick={() => { if (confirm(`确认丢弃「${item.name}」？`)) removeItem(item.id); }}
              className="w-6 h-6 flex items-center justify-center text-dim/25 hover:text-blood rounded transition-colors"
              title="丢弃"
            >
              <Ico d={ICO_TRASH} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 货币面板 ── */
function CurrencyBar({ wallet }: { wallet: CurrencyWallet }) {
  const attrPoints = usePlayer((s) => s.profile.attrPoints ?? 0);
  const realAttrPoints = usePlayer((s) => s.profile.realAttrPoints ?? 0);
  const level = usePlayer((s) => s.profile.level);
  const tier = usePlayer((s) => s.profile.tier);
  const treeProg = useSkillTree((s) => s.progress['B1']);
  const potPoints = Math.max(0, availablePP(treeProg, { level, tier }));   // 技能树可用潜能点（预算+兑换−已花）
  const [showReal, setShowReal] = useState(false);
  return (
    <div className="border border-edge rounded-xl bg-panel overflow-hidden">
      <div className="px-3 py-2 bg-panel2 border-b border-edge/50 text-[12px] font-mono text-dim/60">
        货币与点数
      </div>
      <div className="divide-y divide-edge/30">
        {(Object.keys(CURRENCY_CFG) as (keyof CurrencyWallet)[]).map((type) => {
          const cfg = CURRENCY_CFG[type];
          return (
            <div key={type} className="flex items-center gap-2 px-3 py-2.5">
              <span className="text-base shrink-0">{cfg.icon}</span>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-mono font-semibold truncate ${cfg.color}`}>{type}</div>
                <div className="text-[11px] text-dim/50 truncate">{cfg.sub}</div>
              </div>
              <span className={`text-base font-bold font-mono shrink-0 tabular-nums ${cfg.color}`}>
                {wallet[type].toLocaleString()}
              </span>
            </div>
          );
        })}
        {/* 属性点（点击切换显示 真实属性点）*/}
        <button onClick={() => setShowReal((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-panel2/40 transition-colors text-left">
          <span className="text-base shrink-0">{showReal ? '💠' : '🔶'}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-mono font-semibold truncate text-amber-300">{showReal ? '真实属性点' : '属性点'}</div>
            <div className="text-[11px] text-dim/50 truncate">点击切换{showReal ? '属性点' : '真实属性点'}</div>
          </div>
          <span className="text-base font-bold font-mono shrink-0 tabular-nums text-amber-300">
            {(showReal ? realAttrPoints : attrPoints).toLocaleString()}
          </span>
        </button>
        {/* 潜能点（技能树加点·确定性预算，随等级/阶位增长，−已花、+兑换）*/}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="text-base shrink-0">🌟</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-mono font-semibold truncate text-lime-300">潜能点</div>
            <div className="text-[11px] text-dim/50 truncate">技能树加点</div>
          </div>
          <span className="text-base font-bold font-mono shrink-0 tabular-nums text-lime-300">
            {potPoints.toLocaleString()}
          </span>
        </div>
      </div>
      {/* 货币兑换：1 灵魂钱币 = 150,000 乐园币 */}
      <CurrencyConverter wallet={wallet} />
    </div>
  );
}

/* ── 乐园币 ⇄ 灵魂钱币 兑换（1 灵魂钱币 = 150,000 乐园币）── */
const SOUL_RATE = 150000;
function CurrencyConverter({ wallet }: { wallet: CurrencyWallet }) {
  const adjustCurrency = useItems((s) => s.adjustCurrency);
  const [amt, setAmt] = useState(1);
  const n = Math.max(1, Math.floor(Number(amt) || 1));
  const cost = n * SOUL_RATE;
  const canBuy = wallet.乐园币 >= cost;
  const canSell = wallet.灵魂钱币 >= n;
  return (
    <div className="border-t border-edge/50 px-3 py-3 space-y-2 bg-panel2/30">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-mono text-dim/60">货币兑换</span>
        <span className="text-[11px] font-mono text-dim/40">1 💎 = 150,000 🪙</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-dim/60 shrink-0">灵魂钱币</span>
        <input
          type="number" min={1} value={amt}
          onChange={(e) => setAmt(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-violet-200 focus:outline-none focus:border-violet-400/50"
        />
        <span className="text-[11px] font-mono text-dim/40 truncate">= {cost.toLocaleString()} 🪙</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          disabled={!canBuy}
          onClick={() => { adjustCurrency('乐园币', -cost); adjustCurrency('灵魂钱币', n); }}
          className={`px-2 py-1.5 rounded-lg border text-[12px] font-mono transition-colors ${canBuy ? 'border-violet-400/40 text-violet-200 hover:bg-violet-400/10' : 'border-edge/40 text-dim/25 cursor-not-allowed'}`}
          title={canBuy ? `花 ${cost.toLocaleString()} 乐园币换 ${n} 灵魂钱币` : '乐园币不足'}
        >
          🪙→💎 买入
        </button>
        <button
          disabled={!canSell}
          onClick={() => { adjustCurrency('灵魂钱币', -n); adjustCurrency('乐园币', cost); }}
          className={`px-2 py-1.5 rounded-lg border text-[12px] font-mono transition-colors ${canSell ? 'border-amber-400/40 text-amber-200 hover:bg-amber-400/10' : 'border-edge/40 text-dim/25 cursor-not-allowed'}`}
          title={canSell ? `${n} 灵魂钱币换 ${cost.toLocaleString()} 乐园币` : '灵魂钱币不足'}
        >
          💎→🪙 兑出
        </button>
      </div>
    </div>
  );
}

/* ── 物品分组标题 ── */
function GroupHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-3 py-1 px-1">
      <span className="text-sm font-mono text-god/60 uppercase tracking-widest">{title}</span>
      <span className="text-[12px] font-mono text-dim/50 border border-edge/50 px-1.5 py-0.5 rounded">{count}</span>
      <div className="flex-1 h-px bg-edge/30" />
    </div>
  );
}

/* ════════════════════════════════════════════
   主组件
════════════════════════════════════════════ */
export default function BackpackModal({
  onClose,
  onManualUpdate,
  itemPhaseRunning = false,
  itemPhaseLog = '',
}: {
  onClose: () => void;
  onManualUpdate?: () => void;
  itemPhaseRunning?: boolean;
  itemPhaseLog?: string;
}) {
  const items       = useItems((s) => s.items);
  const currency    = useItems((s) => s.currency);
  const clearBag    = useItems((s) => s.clearBag);

  const [searchQ,      setSearchQ]      = useState('');
  const [filterCat,    setFilterCat]    = useState<ItemCategory | 'all'>('all');
  const [sortBy,       setSortBy]       = useState<SortKey>('original');
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const clearableCount = items.filter((it) => !it.equipped && !it.locked).length;

  const detailItem = detailItemId ? items.find((it) => it.id === detailItemId) ?? null : null;

  /* 过滤 */
  const filtered = items.filter((it) => {
    const q = searchQ.toLowerCase();
    const matchQ = !q
      || it.name.toLowerCase().includes(q)
      || it.effect.toLowerCase().includes(q)
      || it.gradeDesc.toLowerCase().includes(q)
      || (it.notes ?? '').toLowerCase().includes(q);
    const matchCat = filterCat === 'all' || it.category === filterCat;
    return matchQ && matchCat;
  });

  /* 排序 */
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'category') return a.category.localeCompare(b.category);
    return 0; // original
  });

  const equipped = sorted.filter((it) => it.equipped);
  const inBag    = sorted.filter((it) => !it.equipped);

  /* 分类统计（仅全量）*/
  const catCounts = items.reduce<Record<string, number>>((acc, it) => {
    acc[it.category] = (acc[it.category] ?? 0) + 1;
    return acc;
  }, {});

  return (
    /* 全屏遮罩 */
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* 主面板 */}
      <div className="w-full max-w-5xl h-[88vh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">

        {/* ── 顶部标题栏 ── */}
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/60 text-lg">🎒</span>
          <div>
            <div className="text-sm font-bold text-slate-100">储存空间</div>
            <div className="text-[12px] font-mono text-dim/60">
              共 {items.length} 件 · 已装备 {items.filter(i => i.equipped).length} 件
            </div>
          </div>

          {/* 搜索 */}
          <div className="flex-1 flex items-center gap-1.5 bg-panel2 border border-edge rounded-lg px-3 py-1.5 focus-within:border-god/40 transition-colors ml-4">
            <span className="text-dim/40 text-sm">🔍</span>
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="搜索名称、效果、品阶…"
              className="flex-1 bg-transparent text-sm text-slate-200 outline-none placeholder:text-dim/40 font-mono"
            />
            {searchQ && (
              <button onClick={() => setSearchQ('')} className="text-dim/50 hover:text-blood text-sm">✕</button>
            )}
          </div>

          {/* 排序 */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="bg-panel2 border border-edge text-dim text-sm font-mono rounded-lg px-2 py-1.5 outline-none focus:border-god/40 cursor-pointer"
          >
            <option value="original">原始顺序</option>
            <option value="name">按名称</option>
            <option value="category">按分类</option>
          </select>

          {/* 手动更新按钮 */}
          {onManualUpdate && (
            <button
              onClick={onManualUpdate}
              disabled={itemPhaseRunning}
              title="调用物品管理 API，根据最近一次正文更新背包"
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-sm font-mono transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                itemPhaseRunning
                  ? 'border-amber-500/40 text-amber-400 bg-amber-900/10'
                  : 'border-god/40 text-god hover:bg-god/10'
              }`}
            >
              {itemPhaseRunning
                ? <><span className="animate-spin inline-block">◌</span> 更新中…</>
                : <>⟳ 手动更新</>
              }
            </button>
          )}

          {/* 清空背包按钮（保留已装备 / 已锁定）*/}
          {clearableCount > 0 && (
            <button
              onClick={() => { if (!confirmClear) { setConfirmClear(true); return; } clearBag(); setConfirmClear(false); }}
              onBlur={() => setConfirmClear(false)}
              title="清空背包内未装备、未锁定的物品（已装备与已锁定的会保留）"
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-sm font-mono transition-colors ${
                confirmClear
                  ? 'border-blood/60 text-blood bg-blood/10'
                  : 'border-edge text-dim hover:border-blood/40 hover:text-blood'
              }`}
            >
              {confirmClear ? `确认清空 ${clearableCount} 件？` : `🗑 清空背包`}
            </button>
          )}

          {/* 物品阶段日志（内嵌显示）*/}
          {itemPhaseLog && !itemPhaseRunning && (
            <span className={`text-[12px] font-mono max-w-40 truncate ${
              itemPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-god/70'
            }`}>
              {itemPhaseLog}
            </span>
          )}

          {/* 关闭 */}
          <button
            onClick={onClose}
            className="text-dim hover:text-blood text-lg font-mono transition-colors ml-1"
          >✕</button>
        </header>

        {/* ── 主体：左侧边栏 + 右侧内容（手机端竖叠，整体一个滚动区，货币可正常下拉）── */}
        <div className="flex max-lg:flex-col flex-1 overflow-hidden max-lg:overflow-y-auto">

          {/* 左侧边栏：货币 + 分类过滤 */}
          <aside className="shrink-0 w-56 max-lg:w-full border-r max-lg:border-r-0 max-lg:border-b border-edge bg-panel flex flex-col gap-4 p-3 overflow-y-auto max-lg:overflow-visible">
            <CurrencyBar wallet={currency} />

            <div className="space-y-1">
              <div className="text-[12px] font-mono text-dim/50 uppercase tracking-widest px-1">分类筛选</div>
              <button
                onClick={() => setFilterCat('all')}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm font-mono transition-colors flex items-center justify-between ${
                  filterCat === 'all' ? 'bg-god/10 text-god border border-god/30' : 'text-dim hover:text-slate-300 hover:bg-panel2'
                }`}
              >
                <span>全部</span>
                <span className="text-[12px] text-dim/50">{items.length}</span>
              </button>
              {ITEM_CATEGORIES.filter((c) => catCounts[c]).map((c) => {
                const cfg = CAT_CFG[c];
                return (
                  <button
                    key={c}
                    onClick={() => setFilterCat(filterCat === c ? 'all' : c)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm font-mono transition-colors flex items-center gap-2 ${
                      filterCat === c ? `${cfg.cls} border` : 'text-dim hover:text-slate-300 hover:bg-panel2'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                    <span className="flex-1">{c}</span>
                    <span className="text-[12px] text-dim/50">{catCounts[c]}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* 右侧物品列表 */}
          <div className="flex-1 overflow-y-auto p-4 max-lg:p-2.5 space-y-4 max-lg:flex-none max-lg:overflow-visible">
            {filtered.length === 0 ? (
              <div className="h-full flex items-center justify-center text-dim/30 text-sm font-mono select-none">
                {items.length === 0 ? '背包空空如也…' : '无匹配物品'}
              </div>
            ) : (
              <>
                {equipped.length > 0 && (
                  <section className="space-y-2">
                    <GroupHeader title="已装备" count={equipped.length} />
                    <div className="grid grid-cols-2 gap-2">
                      {equipped.map((it) => <ItemCard key={it.id} item={it} onOpen={() => setDetailItemId(it.id)} />)}
                    </div>
                  </section>
                )}
                {inBag.length > 0 && (
                  <section className="space-y-2">
                    <GroupHeader title="背包" count={inBag.length} />
                    <div className="grid grid-cols-2 gap-2">
                      {inBag.map((it) => <ItemCard key={it.id} item={it} onOpen={() => setDetailItemId(it.id)} />)}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── 底部统计栏 ── */}
        <footer className="shrink-0 px-5 py-2 border-t border-edge bg-panel text-[12px] font-mono text-dim/50 flex items-center gap-4">
          <span>物品总数：{items.reduce((s, it) => s + it.quantity, 0)}</span>
          {ITEM_CATEGORIES.filter((c) => catCounts[c]).map((c) => (
            <span key={c} className={CAT_CFG[c].light}>
              {c}×{catCounts[c]}
            </span>
          ))}
        </footer>
      </div>

      {/* ── 物品详情浮窗 ── */}
      {detailItem && (
        <ItemDetailModal
          item={detailItem}
          onClose={() => setDetailItemId(null)}
        />
      )}
    </div>
  );
}
