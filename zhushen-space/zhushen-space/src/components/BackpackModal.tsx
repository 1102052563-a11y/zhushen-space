import { useState, useRef } from 'react';
import { useItems, ITEM_CATEGORIES, ITEM_GRADES, gradeColorClass, gradeBadgeClass, gradeNameClass, socketsOf, splitAffixEntries, isResourcePseudoItem, asText, getItemLog, type InventoryItem, type ItemCategory, type CurrencyWallet } from '../store/itemStore';
import { enhanceColorClass, enhancedCombat } from '../systems/enhanceEngine';
import { applyItemActiveBuff } from '../systems/statusAttrs';
import { walletLedger, type WalletTxn } from '../systems/ledger/walletCore';
import { usePlayer } from '../store/playerStore';
import { useTerritory } from '../store/territoryStore';
import { useSkillTree } from '../store/skillTreeStore';
import { availablePP } from '../systems/skillTree';
import { useImageGen, effectiveEquipService } from '../store/imageGenStore';
import { generateImage, buildEquipPrompt, shrinkDataUrl } from '../systems/imageGen';
import { useComposer } from '../store/composerStore';
import { genEquipTags, isTagService } from '../systems/imageTags';
import { parseAttrBonus, ATTR_KEYS, ATTR_LABEL } from '../systems/attrBonus';
import HoloCard from './HoloCard';
import HoloInspector from './HoloInspector';

/* 物品图片：上传/替换/移除/AI生成（dataURL 存 InventoryItem.image）*/
function ItemImageBlock({ item, onUpdate }: { item: InventoryItem; onUpdate: (patch: Partial<InventoryItem>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [gening, setGening] = useState(false);
  const [err, setErr] = useState('');
  const [inspectOpen, setInspectOpen] = useState(false);
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
  const affixText = splitAffixEntries((item as any).affix).join(' ');
  const bonusText = [asText(item.effect), affixText].filter(Boolean).join(' ');
  const bDelta = parseAttrBonus(bonusText);
  const bonusRows = ATTR_KEYS.filter((k) => bDelta[k]).map((k) => ({ label: ATTR_LABEL[k], value: (bDelta[k]! > 0 ? '+' : '') + bDelta[k] }));
  const scoreNum = (String((item as any).score ?? '').match(/\d+/) || [])[0];
  const scorePower = scoreNum ? { label: '评分', value: scoreNum } : undefined;
  return (
    <div className="flex items-center gap-3">
      {item.image
        ? <div className="shrink-0" title="点击放大检视">
            <HoloCard img={item.image} name={item.name} grade={item.gradeDesc} badge={item.gradeDesc || undefined} rows={bonusRows} power={scorePower} width={176} mode="hover" onClick={() => setInspectOpen(true)} />
          </div>
        : <div className="shrink-0 w-24 h-24 rounded-lg overflow-hidden border border-edge/60 bg-void/60 flex items-center justify-center">
            {gening ? <span className="text-[11px] font-mono text-god/70 animate-pulse">生成中…</span>
              : <span className="text-3xl text-dim/25">{CAT_ICON[item.category] ?? '◆'}</span>}
          </div>}
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
      <HoloInspector open={inspectOpen} onClose={() => setInspectOpen(false)} img={item.image} name={item.name} grade={item.gradeDesc} badge={item.gradeDesc || undefined} rows={bonusRows} power={scorePower} />
    </div>
  );
}

/* ── 分类颜色（与 ItemManager 一致）── */
export const CAT_CFG: Record<ItemCategory, { cls: string; dot: string; light: string }> = {
  // 装备类
  '武器':    { cls: 'bg-red-900/40 text-red-400 border-red-700/40',             dot: 'bg-red-400',     light: 'text-red-400' },
  '防具':    { cls: 'bg-sky-900/40 text-sky-400 border-sky-700/40',             dot: 'bg-sky-400',     light: 'text-sky-400' },
  '载具':    { cls: 'bg-indigo-900/40 text-indigo-400 border-indigo-700/40',   dot: 'bg-indigo-400',  light: 'text-indigo-400' },
  '饰品':    { cls: 'bg-violet-900/40 text-violet-400 border-violet-700/40',    dot: 'bg-violet-400',  light: 'text-violet-400' },
  '宝石':    { cls: 'bg-rose-900/40 text-rose-400 border-rose-700/40',          dot: 'bg-rose-400',    light: 'text-rose-400' },
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
/** 把背包物品打包成领地/账户仓库入库参数：携带**完整快照**（剥 image 防 localStorage 膨胀），
 *  取出时原样还原全字段（词缀/强化/宝石/评分/耐久…），杜绝「存进去再拿出来词缀等信息全没了」。 */
export function toStashPayload(item: InventoryItem) {
  const { image: _img, ...snap } = item;
  return {
    name: item.name, quantity: item.quantity, category: item.category,
    gradeDesc: item.gradeDesc, effect: item.effect, desc: item.notes, appearance: item.appearance,
    item: snap as InventoryItem,
  };
}

/* 详情弹窗字段包装。**必须定义在组件外**：若放在 ItemDetailModal 内，每次 setDraft（每敲一个键）重渲染都会
   生成一个新的 Field 组件类型，React 认成不同组件 → 卸载重挂它下面的 <textarea/input> → 输入法拼音组合被打断
   （用户报"改装备效果/词缀时打一个拼音就被断了、只能别处打好复制"）。提到模块级后类型稳定、不再重挂。 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[12px] font-mono text-dim/40 uppercase tracking-wide">{label}</div>
      <div>{children}</div>
    </div>
  );
}

export function ItemDetailModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const consumeItem = useItems((s) => s.consumeItem);
  const removeItem  = useItems((s) => s.removeItem);
  const unequipItem = useItems((s) => s.unequipItem);
  const updateItem  = useItems((s) => s.updateItem);
  const territoryUnlocked = useTerritory((s) => s.unlocked);
  const storeToTerritory  = useTerritory((s) => s.storeItem);
  // 背包 → 领地仓库：整件存入（携带完整快照，取出无损），再从背包移除
  const depositToTerritory = () => {
    storeToTerritory(toStashPayload(item));
    removeItem(item.id);
    onClose();
  };

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: item.name, gradeDesc: item.gradeDesc,
    category: item.category, subType: item.subType ?? '',   // 可改物品类别(决定装备槽)+类型细分——治 AI 演化把饰品乱改成武器/特殊物品
    effect: asText(item.effect),
    appearance: item.appearance ?? '',
    // affix/effect 若被 AI 写成对象数组 [{name,desc}] → 拆成干净多行文本，编辑+保存即把脏数据洗成字符串（治"词缀显示成 [object Object]"）
    notes: item.notes ?? '', acquisition: item.acquisition ?? '', affix: splitAffixEntries(item.affix).join('\n'),
    activeEffect: asText(item.activeEffect),
    activeDuration: item.activeDuration ?? '',
  });

  const cfg  = CAT_CFG[item.category] ?? CAT_CFG['其他物品'];
  const icon = CAT_ICON[item.category] ?? '◆';
  const canEquip   = (['武器','防具','饰品','法宝','功法','特殊物品'] as string[]).includes(item.category) && !isResourcePseudoItem(item);
  const canConsume = (['消耗品','丹药','符箓','灵药'] as string[]).includes(item.category);

  const saveEdit = () => {
    const catChanged = draft.category !== item.category;
    const patch: Partial<InventoryItem> = {
      name: draft.name, gradeDesc: draft.gradeDesc,
      category: draft.category as ItemCategory, subType: draft.subType.trim() || undefined,
      effect: draft.effect, appearance: draft.appearance, notes: draft.notes, acquisition: draft.acquisition, affix: draft.affix,
      activeEffect: draft.activeEffect.trim() || undefined,
      activeDuration: draft.activeDuration.trim() || undefined,
    };
    // 改了类别且此刻装备中 → 一并卸下：否则出现"饰品改成武器仍卡在武器槽 / 改成消耗品却还显示装备中"这类槽位错乱
    //   （用户报"饰品变成武器还在武器栏上面"）。改回正确类别后到装备面板重新穿戴即可。
    if (catChanged && item.equipped) { patch.equipped = false; patch.equipSlot = undefined; }
    updateItem(item.id, patch);
    setEditing(false);
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col max-h-[85dvh]">

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
              {editing ? (
                <select
                  value={draft.category}
                  onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as ItemCategory }))}
                  title="改物品类别：决定它算武器/防具/饰品…以及能装到哪个槽（治 AI 演化把饰品乱改成武器）"
                  className="text-[12px] font-mono px-1 py-0.5 rounded border border-god/50 bg-void text-slate-200 focus:outline-none focus:border-god/70"
                >
                  {ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <span className={`text-[12px] font-mono px-1.5 py-0.5 rounded border ${cfg.cls}`}>{item.category}</span>
              )}
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
          {(editing || item.origin || item.subType || item.combatStat || item.durability || item.score || item.killCount) && (
            <div className="grid grid-cols-2 gap-3 bg-panel2 rounded-xl p-3 border border-edge/40">
              {item.origin && (<div><div className="text-[12px] font-mono text-dim/40">产地</div><div className="text-[13px] text-dim/80">{item.origin}</div></div>)}
              {(item.subType || editing) && (<div><div className="text-[12px] font-mono text-dim/40">类型（细分）</div>{editing
                ? <input value={draft.subType} onChange={(e) => setDraft((d) => ({ ...d, subType: e.target.value }))} placeholder="如 长刀 / 戒指 / 护符" className="w-full bg-void border border-god/40 rounded px-1.5 py-0.5 text-[13px] text-slate-200 focus:outline-none focus:border-god/60" />
                : <div className="text-[13px] text-dim/80">{item.subType}</div>}</div>)}
              {item.combatStat && (() => {
                const ec = enhancedCombat(item.combatStat, item.enhanceLevel ?? 0);
                const cls = enhanceColorClass(item.enhanceLevel ?? 0);
                return (<div><div className="text-[12px] font-mono text-dim/40">攻击/防御</div>
                  {ec
                    ? <div className="text-[13px] font-mono flex flex-wrap items-baseline gap-x-1"><span className="text-dim/40 line-through">{ec.base}</span><span className="text-dim/40">→</span><span className={`font-bold ${cls}`}>{ec.enhanced}</span><span className={`text-[11px] ${cls}`}>强化+{item.enhanceLevel}·+{ec.pct}%</span></div>
                    : <div className="text-[13px] font-mono text-amber-300/90">{asText(item.combatStat)}</div>}
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
                  <div className="space-y-1">
                    {splitAffixEntries(item.effect).map((a, i) => <div key={i} className="text-[13px] leading-snug text-dim/80 border-l-2 border-god/25 pl-2">{a}</div>)}
                  </div>
                )}
              </div>
            </Field>
          )}

          {/* 主动效果（需发动/使用才生效·天然不计入常驻六维）*/}
          {(item.activeEffect || editing) && (
            <Field label="⚡ 主动效果（需发动 · 不常驻）">
              <div className="bg-amber-400/5 border border-amber-400/25 rounded-lg p-3 space-y-2">
                {editing ? (
                  <textarea
                    value={draft.activeEffect}
                    onChange={(e) => setDraft((d) => ({ ...d, activeEffect: e.target.value }))}
                    rows={3}
                    placeholder="要使用 / 发动才临时生效的效果（如：发动后 60 分钟攻击附带 20% 吸血、临时体质+15…）。写在这里的加成不会常驻算进属性，发动时交由正文结算。"
                    className="w-full bg-void border border-amber-400/30 rounded px-2 py-1 text-[13px] text-amber-100/90 focus:outline-none focus:border-amber-400/60 resize-none"
                  />
                ) : (
                  <div className="space-y-1">
                    {splitAffixEntries(item.activeEffect).map((a, i) => <div key={i} className="text-[13px] leading-snug text-amber-100/85 border-l-2 border-amber-400/40 pl-2">{a}</div>)}
                  </div>
                )}
                {/* 持续时长：变身/限时增益专用——⚡发动时按此精确定时（优先于上面文本里的时长；缺省默认3回合）。兼容"10回合"与"1小时/3天" */}
                {editing ? (
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-[12px] text-amber-300/70 font-mono">⏳ 持续时长</span>
                    <input
                      value={draft.activeDuration}
                      onChange={(e) => setDraft((d) => ({ ...d, activeDuration: e.target.value }))}
                      placeholder="如 10回合 / 1小时 / 3天（留空默认3回合）"
                      className="flex-1 min-w-0 bg-void border border-amber-400/30 rounded px-2 py-1 text-[13px] text-amber-100/90 focus:outline-none focus:border-amber-400/60"
                    />
                  </div>
                ) : item.activeDuration ? (
                  <div className="text-[12px] text-amber-300/75 font-mono">⏳ 持续 {item.activeDuration} · 发动后到点自动回落</div>
                ) : null}
              </div>
            </Field>
          )}

          {/* 装备需求 */}
          {item.requirement && (
            <Field label="装备需求">
              <div className="text-[13px] text-sky-200/80 leading-relaxed">{item.requirement}</div>
            </Field>
          )}

          {/* 词缀（可编辑：进入编辑模式后可改/加词缀）*/}
          {(item.affix || editing) && (
            <Field label="词缀">
              {editing ? (
                <textarea
                  value={draft.affix}
                  onChange={(e) => setDraft((d) => ({ ...d, affix: e.target.value }))}
                  rows={2}
                  placeholder="每条词缀写「【名】：说明」，如 【烈焰】：攻击附带 15% 火焰伤害"
                  className="w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-amber-200/85 focus:outline-none focus:border-god/50 resize-none"
                />
              ) : (
                <div className="space-y-1">
                  {splitAffixEntries(item.affix).map((a, i) => <div key={i} className="text-[13px] leading-snug text-amber-200/85 border-l-2 border-amber-400/25 pl-2">{a}</div>)}
                </div>
              )}
            </Field>
          )}

          {/* 六维加成生效方式：常驻 / 需发动。治"要发动才加的属性被常驻算进状态栏"——勾选后此装备词缀/效果里的六维加成不计入常驻有效属性 */}
          {canEquip && (
            <Field label="六维加成生效方式">
              <button
                onClick={() => updateItem(item.id, { condBonus: !item.condBonus })}
                title="切换：此装备的六维加成是常驻，还是需要使用/发动才临时生效"
                className={`w-full flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                  item.condBonus ? 'border-amber-400/50 bg-amber-400/5' : 'border-edge/50 bg-panel2 hover:border-god/30'
                }`}
              >
                <span className={`shrink-0 mt-0.5 w-9 h-5 rounded-full border relative transition-colors ${item.condBonus ? 'bg-amber-500/30 border-amber-400/50' : 'bg-void border-edge'}`}>
                  <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all ${item.condBonus ? 'left-[18px] bg-amber-300' : 'left-0.5 bg-dim/60'}`} />
                </span>
                <span className="min-w-0">
                  <span className={`block text-[12.5px] font-mono ${item.condBonus ? 'text-amber-200' : 'text-slate-300'}`}>{item.condBonus ? '需发动 · 不计入常驻属性' : '常驻加成（默认）'}</span>
                  <span className="block text-[11px] text-dim/55 leading-snug mt-0.5">
                    {item.condBonus
                      ? '此装备词缀/效果里的六维加成不会永久加进你的属性——适用于要使用/发动技能才临时生效的装备。'
                      : '点此改为"需发动"：适用于要服药/发动才临时加成的装备。系统也会自动跳过"使用后/触发/限时状态"类加成。'}
                  </span>
                </span>
              </button>
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

          {/* 发动主动效果：前端即时登记为「限时状态」（六维立刻生效、到点自动撤销），同时填输入框让 AI 叙述 */}
          {item.activeEffect && !editing && (
            <button
              onClick={() => {
                applyItemActiveBuff(item);   // 立刻建限时状态 → 六维即时跳、到点由 expireStatuses 自动回落
                useComposer.getState().fill(`发动【${item.name}】的主动效果：${asText(item.activeEffect)}${item.activeDuration ? `\n（持续时长：${item.activeDuration}——请按此时长叙述，勿改成其它回合数）` : ''}\n（已登记为限时状态、六维已即时生效，请在正文叙述发动过程与效果，勿再发 addStatus 重复加成）`);
                onClose();
              }}
              title="发动此装备的主动效果：立即登记为限时状态（六维即时生效、到点自动撤销），并把发动描述填入输入框交 AI 叙述"
              className="px-3 py-1.5 border border-amber-400/50 text-amber-300 hover:bg-amber-400/10 rounded-lg text-sm font-mono transition-colors"
            >⚡ 发动</button>
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

          {/* 放入/移出「不常用空间」（收纳·仅未装备物品；主背包列表将隐藏已收纳物品）*/}
          {!item.equipped && (
            <button
              onClick={() => { updateItem(item.id, { archived: !item.archived }); onClose(); }}
              className={`flex items-center gap-1 px-3 py-1.5 border rounded-lg text-sm font-mono transition-colors ${
                item.archived ? 'border-amber-400/50 text-amber-300 bg-amber-400/10' : 'border-edge text-dim hover:border-amber-400/40 hover:text-amber-400'
              }`}
              title={item.archived ? '从不常用空间移回主背包' : '放入不常用空间：主背包列表将不再显示它，需点顶部「📦 不常用空间」才能看到'}
            >
              📦 {item.archived ? '移出不常用空间' : '放入不常用空间'}
            </button>
          )}

          {/* 存入领地仓库（领地已开辟、未装备未锁定时可用；整摞转入领地仓库并从背包移除）*/}
          {territoryUnlocked && !item.equipped && (
            <button
              onClick={depositToTerritory}
              className="flex items-center gap-1 px-3 py-1.5 border rounded-lg text-sm font-mono transition-colors border-edge text-dim hover:border-amber-400/40 hover:text-amber-400"
              title="把这件物品整摞存入领地仓库（从背包移出）"
            >
              🏯 存入领地
            </button>
          )}

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
function ItemCard({ item, onOpen, selectable = false, selected = false, onToggleSelect }:
  { item: InventoryItem; onOpen: () => void; selectable?: boolean; selected?: boolean; onToggleSelect?: () => void }) {
  const removeItem  = useItems((s) => s.removeItem);
  const updateItem  = useItems((s) => s.updateItem);

  const cfg  = CAT_CFG[item.category] ?? CAT_CFG['其他物品'];
  const icon = CAT_ICON[item.category] ?? '◆';

  return (
    <div
      className={`rounded-xl overflow-hidden border transition-all cursor-pointer ${
        selectable && selected
          ? 'border-god/70 bg-god/10 ring-1 ring-god/50'
          : item.equipped ? 'border-god/50 bg-god/5 hover:border-god/40' : 'border-edge bg-panel hover:border-god/40'
      }`}
      onClick={selectable ? onToggleSelect : onOpen}
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
        {selectable && (
          <span className={`w-5 h-5 shrink-0 rounded border flex items-center justify-center text-[11px] font-mono ${
            selected ? 'border-god/70 bg-god/20 text-god' : 'border-edge text-transparent'
          }`}>✓</span>
        )}
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

        {/* 右侧操作按钮（阻止冒泡到卡片点击）；多选模式下隐藏，避免误点 */}
        {!selectable && (<div className="flex flex-col gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
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
        </div>)}
      </div>
    </div>
  );
}

/* ── 可点击编辑的数字（货币/点数手动修正用：AI 有时漏发结算奖励，玩家可在此对账调整）── */
function EditableNum({ value, onSave, className = '' }: { value: number; onSave: (v: number) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(String(value));
  if (editing) {
    const commit = () => { onSave(Math.max(0, Math.round(Number(local) || 0))); setEditing(false); };
    return (
      <input autoFocus type="number" value={local}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setEditing(false); }}
        className={`w-24 bg-void border border-god/50 rounded px-1.5 py-0.5 text-base font-bold font-mono text-right outline-none tabular-nums ${className}`}
      />
    );
  }
  return (
    <button onClick={(e) => { e.stopPropagation(); setLocal(String(value)); setEditing(true); }} title="点击修改"
      className={`text-base font-bold font-mono shrink-0 tabular-nums hover:underline decoration-dotted underline-offset-2 cursor-text ${className}`}>
      {value.toLocaleString()}
    </button>
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
  const setCurrency = useItems((s) => s.setCurrency);
  const setProfile = usePlayer((s) => s.setProfile);
  const grantBonusPP = useSkillTree((s) => s.grantBonusPP);
  const [showReal, setShowReal] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);   // 乐园币流水弹层
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('drpg-bp-cur-open') !== '0'; } catch { return true; } });
  const toggle = () => setOpen((v) => { const nv = !v; try { localStorage.setItem('drpg-bp-cur-open', nv ? '1' : '0'); } catch { /* */ } return nv; });
  return (
    <div className="border border-edge rounded-xl bg-panel overflow-hidden">
      <button onClick={toggle} title={open ? '收起货币列表' : '展开货币列表'}
        className="w-full flex items-center justify-between px-3 py-2 bg-panel2 border-b border-edge/50 text-[12px] font-mono text-dim/60 hover:text-slate-300 transition-colors">
        <span>货币与点数</span>
        <span className="text-[10px]">{open ? '收起 ▾' : '展开 ▸'}</span>
      </button>
      {open && <div className="divide-y divide-edge/30">
        {(Object.keys(CURRENCY_CFG) as (keyof CurrencyWallet)[]).map((type) => {
          const cfg = CURRENCY_CFG[type];
          return (
            <div key={type} className="flex items-center gap-2 px-3 py-2.5">
              <span className="text-base shrink-0">{cfg.icon}</span>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-mono font-semibold truncate ${cfg.color}`}>{type}</div>
                <div className="text-[11px] text-dim/50 truncate">{cfg.sub}</div>
              </div>
              <EditableNum value={wallet[type]} onSave={(v) => setCurrency({ [type]: v })} className={cfg.color} />
            </div>
          );
        })}
        {/* 属性点（左侧点击切换 真实属性点；右侧数字可点改）*/}
        <div className="w-full flex items-center gap-2 px-3 py-2.5">
          <button onClick={() => setShowReal((v) => !v)} title="点击切换属性点 / 真实属性点"
            className="flex items-center gap-2 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity">
            <span className="text-base shrink-0">{showReal ? '💠' : '🔶'}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-mono font-semibold truncate text-amber-300">{showReal ? '真实属性点' : '属性点'}</div>
              <div className="text-[11px] text-dim/50 truncate">点击切换{showReal ? '属性点' : '真实属性点'}</div>
            </div>
          </button>
          <EditableNum value={showReal ? realAttrPoints : attrPoints}
            onSave={(v) => setProfile(showReal ? { realAttrPoints: v } : { attrPoints: v })} className="text-amber-300" />
        </div>
        {/* 潜能点（技能树加点·确定性预算；手改走 grantBonusPP 调 aiBonusPP，增加精确、下调以自然预算为底）*/}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="text-base shrink-0">🌟</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-mono font-semibold truncate text-lime-300">潜能点</div>
            <div className="text-[11px] text-dim/50 truncate">技能树加点</div>
          </div>
          <EditableNum value={potPoints} onSave={(v) => grantBonusPP('B1', v - potPoints)} className="text-lime-300" />
        </div>
      </div>}
      {/* 货币流水：每笔增减 + 缘由（读事件溯源 walletCore 日志·乐园币 / 灵魂钱币 可切换）*/}
      <button onClick={() => setLedgerOpen(true)} title="查看每一笔货币增减与缘由（乐园币 / 灵魂钱币）"
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border-t border-edge/50 bg-panel2/30 text-[12px] font-mono text-amber-300/70 hover:text-amber-200 hover:bg-amber-400/5 transition-colors">
        📜 货币流水
      </button>
      {ledgerOpen && <CurrencyLedgerModal type="乐园币" onClose={() => setLedgerOpen(false)} />}
      {/* 货币兑换：1 灵魂钱币 = 150,000 乐园币（始终显示，不随货币列表折叠）*/}
      <CurrencyConverter wallet={wallet} />
    </div>
  );
}

/* ── 货币流水弹层（读 walletCore 事件日志·每笔增减 + 缘由 + 当时余额，最新在前；乐园币 / 灵魂钱币 可切换）── */
function CurrencyLedgerModal({ type, onClose }: { type: string; onClose: () => void }) {
  const [cur, setCur] = useState<'乐园币' | '灵魂钱币'>(type === '灵魂钱币' ? '灵魂钱币' : '乐园币');
  const txns = walletLedger(cur, 300);
  const fmt = (n: number) => n.toLocaleString();
  const tabCls = (t: string) => `px-2 py-0.5 rounded text-[12px] font-mono transition-colors ${cur === t ? (t === '乐园币' ? 'bg-amber-400/20 text-amber-200' : 'bg-violet-400/20 text-violet-200') : 'text-dim/45 hover:text-slate-300'}`;
  return (
    <div className="fixed inset-0 z-[85] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md max-h-[80dvh] flex flex-col rounded-xl border border-god/30 bg-panel shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge bg-panel2">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-mono text-dim/60">📜 流水</span>
            <button onClick={() => setCur('乐园币')} className={tabCls('乐园币')}>🪙 乐园币</button>
            <button onClick={() => setCur('灵魂钱币')} className={tabCls('灵魂钱币')}>💎 灵魂钱币</button>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg leading-none">✕</button>
        </div>
        {txns.length === 0 ? (
          <div className="p-8 text-center text-dim/40 text-[13px] font-mono">暂无{cur}流水记录<div className="text-[11px] mt-1 text-dim/30">此后每一笔 {cur} 增减都会带缘由记在这里</div></div>
        ) : (
          <div className="flex-1 overflow-y-auto divide-y divide-edge/25">
            {txns.map((t: WalletTxn) => (
              <div key={t.seq} className="flex items-center gap-2 px-4 py-2">
                <span className={`font-mono font-bold text-sm shrink-0 w-24 text-right ${t.delta >= 0 ? 'text-emerald-400' : 'text-blood'}`}>{t.delta >= 0 ? '+' : ''}{fmt(t.delta)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-slate-300 truncate" title={t.reason}>{t.reason}</div>
                  <div className="text-[10px] text-dim/40 font-mono">回合 {t.turn} · 余额 {fmt(t.balance)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="px-4 py-2 border-t border-edge/50 bg-panel2/40 text-[10px] text-dim/40 font-mono text-center">共 {txns.length} 笔（最新在前）· 来自事件溯源账本</div>
      </div>
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
          onClick={() => { adjustCurrency('乐园币', -cost, `货币兑换·买入 ${n} 灵魂钱币`); adjustCurrency('灵魂钱币', n, '货币兑换·由乐园币换入'); }}
          className={`px-2 py-1.5 rounded-lg border text-[12px] font-mono transition-colors ${canBuy ? 'border-violet-400/40 text-violet-200 hover:bg-violet-400/10' : 'border-edge/40 text-dim/25 cursor-not-allowed'}`}
          title={canBuy ? `花 ${cost.toLocaleString()} 乐园币换 ${n} 灵魂钱币` : '乐园币不足'}
        >
          🪙→💎 买入
        </button>
        <button
          disabled={!canSell}
          onClick={() => { adjustCurrency('灵魂钱币', -n, `货币兑换·卖出 ${n} 灵魂钱币`); adjustCurrency('乐园币', cost, '货币兑换·由灵魂钱币换出'); }}
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
  const recentlyDeleted     = useItems((s) => s.recentlyDeleted);
  const itemTurn            = useItems((s) => s.itemTurn);
  const restoreDeleted      = useItems((s) => s.restoreDeleted);
  const clearRecentlyDeleted = useItems((s) => s.clearRecentlyDeleted);
  const removeItem          = useItems((s) => s.removeItem);
  const binItems            = useItems((s) => s.binItems);
  const territoryUnlocked   = useTerritory((s) => s.unlocked);
  const storeToTerritory    = useTerritory((s) => s.storeItem);

  const [searchQ,      setSearchQ]      = useState('');
  const [filterCat,    setFilterCat]    = useState<ItemCategory | 'all'>('all');
  const [catOpen,      setCatOpen]      = useState(() => { try { return localStorage.getItem('drpg-bp-cat-open') !== '0'; } catch { return true; } });
  const [sortBy,       setSortBy]       = useState<SortKey>('original');
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showDeleted,  setShowDeleted]  = useState(false);
  const [confirmClearDel, setConfirmClearDel] = useState(false);
  const [showArchived, setShowArchived] = useState(false);   // 「不常用空间」：主背包 ↔ 不常用空间 切换视图
  const [selectMode,   setSelectMode]   = useState(false);           // 多选模式（批量存入领地 / 批量删除共用）
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set());
  const [confirmBatchDel, setConfirmBatchDel] = useState(false);     // 批量删除二次确认

  const clearableCount = items.filter((it) => !it.equipped && !it.locked && !it.archived).length;
  const archivedCount  = items.filter((it) => it.archived && !it.equipped).length;   // 不常用空间物品数（已装备的不算·恒在主视图）

  const detailItem = detailItemId ? items.find((it) => it.id === detailItemId) ?? null : null;

  /* 过滤（含「不常用空间」视图切换：主视图排除不常用物品，不常用视图只显不常用物品；
     已装备物品恒在主视图显示、绝不进不常用空间——防归档物品被装备后整个消失）*/
  const inView = (it: InventoryItem) => (showArchived ? (!!it.archived && !it.equipped) : (!it.archived || it.equipped));
  const filtered = items.filter((it) => {
    if (!inView(it)) return false;
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

  /* 批量存入领地：仅未装备未锁定可选；勾选后一次性 storeItem→领地仓库并从背包移除 */
  const eligibleInBag = inBag;   // 未装备的一切（含锁定物：仓库是安全存放不是删除，锁定的贵重物也该能存）
  const selectedCount = eligibleInBag.filter((it) => selectedIds.has(it.id)).length;
  const toggleSelect = (id: string) => setSelectedIds((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const exitSelect = () => { setSelectMode(false); setSelectedIds(new Set()); setConfirmBatchDel(false); };
  const selectAllEligible = () => setSelectedIds(new Set(eligibleInBag.map((it) => it.id)));
  const batchDeposit = () => {
    const chosen = eligibleInBag.filter((it) => selectedIds.has(it.id));
    if (chosen.length === 0) return;
    for (const it of chosen) {
      storeToTerritory(toStashPayload(it));   // 携带完整快照，取出无损
      removeItem(it.id);
    }
    exitSelect();
  };
  /* 批量删除：勾选的物品里，跳过锁定物（保护贵重物），一次性移入「最近删除」回收站（3 回合内可恢复）*/
  const deletableSelected = eligibleInBag.filter((it) => selectedIds.has(it.id) && !it.locked);
  const batchDelete = () => {
    if (deletableSelected.length === 0) return;
    binItems(deletableSelected, { reason: '储存空间·批量删除' });
    exitSelect();
  };

  /* 分类统计（只统计当前视图：主视图=非不常用+已装备，不常用视图=不常用未装备）*/
  const catCounts = items.reduce<Record<string, number>>((acc, it) => {
    if (!inView(it)) return acc;
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
      <div className="w-full max-w-5xl h-[88dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">

        {/* ── 顶部标题栏 ── */}
        <header className="shrink-0 flex flex-wrap items-center gap-3 max-lg:gap-2 px-5 max-lg:px-3 py-3 border-b border-edge bg-panel">
          <span className="text-god/60 text-lg shrink-0">🎒</span>
          <div className="shrink-0">
            <div className="text-sm font-bold text-slate-100">{showArchived ? '📦 不常用空间' : '储存空间'}</div>
            <div className="text-[12px] font-mono text-dim/60">
              {showArchived
                ? `${archivedCount} 件收纳中 · 点物品可「移出不常用空间」`
                : <>共 {items.length - archivedCount} 件 · 已装备 {items.filter(i => i.equipped).length} 件{archivedCount > 0 ? ` · 不常用 ${archivedCount}` : ''}</>}
            </div>
          </div>

          {/* 搜索 */}
          <div className="flex-1 min-w-0 flex items-center gap-1.5 bg-panel2 border border-edge rounded-lg px-3 py-1.5 focus-within:border-god/40 transition-colors ml-4 max-lg:ml-0 max-lg:basis-full">
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

          {/* 最近删除（回收站）按钮 */}
          <button
            onClick={() => setShowDeleted(true)}
            title="查看最近被 AI 自动删除 / 消耗的物品（可恢复；进入后满 3 回合自动彻底清除）"
            className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-sm font-mono transition-colors ${
              recentlyDeleted.length > 0
                ? 'border-sky-400/50 text-sky-300 hover:bg-sky-500/10'
                : 'border-edge text-dim hover:border-sky-400/40 hover:text-sky-400'
            }`}
          >
            ♻ 最近删除{recentlyDeleted.length > 0 ? ` (${recentlyDeleted.length})` : ''}
          </button>

          {/* 多选模式：勾选多件物品一次性【批量删除】或【存入领地】（删除无需领地；主背包视图可用）*/}
          {!showArchived && (
            <button
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              title="进入多选模式，勾选多件物品一次性批量删除，或存入领地仓库"
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-sm font-mono transition-colors ${
                selectMode ? 'border-amber-400/60 text-amber-300 bg-amber-400/10' : 'border-edge text-dim hover:border-amber-400/40 hover:text-amber-400'
              }`}
            >
              {selectMode ? '✕ 退出多选' : '☑ 批量'}
            </button>
          )}

          {/* 不常用空间：主背包 ↔ 不常用空间 视图切换（收纳不常用物品，主列表隐藏它们）*/}
          <button
            onClick={() => { exitSelect(); setShowArchived((v) => !v); }}
            title="不常用空间：把不常用的物品收纳进来，主背包列表就不显示它们；点此进入/返回。（纯收纳，不影响装备/数值/演化）"
            className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-sm font-mono transition-colors ${
              showArchived
                ? 'border-amber-400/60 text-amber-300 bg-amber-400/10'
                : archivedCount > 0
                  ? 'border-amber-400/50 text-amber-300/90 hover:bg-amber-500/10'
                  : 'border-edge text-dim hover:border-amber-400/40 hover:text-amber-400'
            }`}
          >
            {showArchived ? '← 返回背包' : `📦 不常用空间${archivedCount > 0 ? ` (${archivedCount})` : ''}`}
          </button>

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

        {/* ── 多选·操作条（批量删除 / 批量存入领地）── */}
        {selectMode && (
          <div className="shrink-0 flex flex-wrap items-center gap-3 max-lg:gap-2 px-5 max-lg:px-3 py-2 border-b border-amber-400/30 bg-amber-400/5">
            <span className="text-[13px] font-mono text-amber-200 shrink-0">已选 {selectedCount} 件</span>
            <button onClick={selectAllEligible} className="text-[12px] font-mono text-dim hover:text-amber-300 transition-colors shrink-0">全选（{eligibleInBag.length}）</button>
            <button onClick={() => { setSelectedIds(new Set()); setConfirmBatchDel(false); }} className="text-[12px] font-mono text-dim hover:text-slate-200 transition-colors shrink-0">清空所选</button>
            <span className="text-[11px] font-mono text-dim/40 shrink-0">（已装备的需先卸下；🔒锁定物不会被删除）</span>
            <span className="flex-1" />
            {/* 批量删除：跳过锁定物，移入「最近删除」回收站（3 回合内可恢复）*/}
            <button
              onClick={() => { if (!confirmBatchDel) { setConfirmBatchDel(true); return; } batchDelete(); }}
              onBlur={() => setConfirmBatchDel(false)}
              disabled={deletableSelected.length === 0}
              title="把勾选的物品（🔒锁定物除外）批量删除，移入「最近删除」回收站，3 回合内可恢复"
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-sm font-mono transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ${
                confirmBatchDel ? 'border-blood/60 text-blood bg-blood/10' : 'border-edge text-dim hover:border-blood/40 hover:text-blood'
              }`}
            >{confirmBatchDel ? `确认删除 ${deletableSelected.length} 件？` : `🗑 删除选中 (${deletableSelected.length})`}</button>
            {/* 存入领地：仅领地已开辟可用（锁定物也可存）*/}
            {territoryUnlocked && (
              <button
                onClick={batchDeposit}
                disabled={selectedCount === 0}
                title="把勾选的物品一次性存入领地仓库（从背包移出）"
                className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-sm font-mono transition-colors border-amber-400/50 text-amber-300 hover:bg-amber-400/10 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >🏯 存入领地 ({selectedCount})</button>
            )}
            <button onClick={exitSelect} className="text-[12px] font-mono text-dim/60 hover:text-blood transition-colors shrink-0">取消</button>
          </div>
        )}

        {/* ── 主体：左侧边栏 + 右侧内容（手机端竖叠，整体一个滚动区，货币可正常下拉）── */}
        <div className="flex max-lg:flex-col flex-1 overflow-hidden max-lg:overflow-y-auto">

          {/* 左侧边栏：货币 + 分类过滤 */}
          <aside className="shrink-0 w-56 max-lg:w-full border-r max-lg:border-r-0 max-lg:border-b border-edge bg-panel flex flex-col gap-4 p-3 overflow-y-auto max-lg:overflow-visible">
            <CurrencyBar wallet={currency} />

            <div className="space-y-1">
              <button onClick={() => setCatOpen((v) => { const nv = !v; try { localStorage.setItem('drpg-bp-cat-open', nv ? '1' : '0'); } catch { /* */ } return nv; })}
                title={catOpen ? '收起分类' : '展开分类'}
                className="w-full flex items-center justify-between text-[12px] font-mono text-dim/50 uppercase tracking-widest px-1 py-0.5 hover:text-slate-300 transition-colors">
                <span>分类筛选</span>
                <span className="text-[10px] normal-case">{catOpen ? '收起 ▾' : '展开 ▸'}</span>
              </button>
              {catOpen && (<>
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
              </>)}
            </div>
          </aside>

          {/* 右侧物品列表 */}
          <div className="flex-1 overflow-y-auto p-4 max-lg:p-2.5 space-y-4 max-lg:flex-none max-lg:overflow-visible">
            {filtered.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center text-dim/30 text-sm font-mono select-none px-6">
                {showArchived
                  ? '不常用空间是空的…\n在物品详情里点「📦 放入不常用空间」把不常用的物品收纳进来'.split('\n').map((s, i) => <div key={i}>{s}</div>)
                  : items.length === 0 ? '背包空空如也…' : '无匹配物品'}
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
                      {inBag.map((it) => (
                        <ItemCard key={it.id} item={it} onOpen={() => setDetailItemId(it.id)}
                          selectable={selectMode}
                          selected={selectedIds.has(it.id)}
                          onToggleSelect={() => toggleSelect(it.id)} />
                      ))}
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

      {/* ── 最近删除（回收站）面板 ── */}
      {showDeleted && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowDeleted(false); }}>
          <div className="w-full max-w-2xl max-h-[82dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
            <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
              <span className="text-sky-300/80 text-lg">♻</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-100">最近删除</div>
                <div className="text-[12px] font-mono text-dim/60">被 AI 自动删除 / 消耗的物品 · 进入后满 3 回合彻底清除 · 共 {recentlyDeleted.length} 件</div>
              </div>
              {recentlyDeleted.length > 0 && (
                <button
                  onClick={() => { if (!confirmClearDel) { setConfirmClearDel(true); return; } clearRecentlyDeleted(); setConfirmClearDel(false); }}
                  onBlur={() => setConfirmClearDel(false)}
                  className={`px-3 py-1.5 border rounded-lg text-sm font-mono transition-colors ${confirmClearDel ? 'border-blood/60 text-blood bg-blood/10' : 'border-edge text-dim hover:border-blood/40 hover:text-blood'}`}>
                  {confirmClearDel ? '确认清空？' : '🗑 清空'}
                </button>
              )}
              <button onClick={() => setShowDeleted(false)} className="text-dim/50 hover:text-blood text-lg">✕</button>
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {recentlyDeleted.length === 0 ? (
                <div className="text-center text-dim/40 text-sm font-mono py-16">暂无最近删除的物品
                  <div className="text-[12px] mt-1 text-dim/30">被 AI 误删 / 消耗的物品会暂存在这里，可点「恢复」找回</div>
                </div>
              ) : recentlyDeleted.map((it) => {
                const remain = 3 - (itemTurn - it.deletedTurn);
                return (
                  <div key={it.id} className="flex items-center gap-3 rounded-lg border border-edge bg-panel/50 px-3 py-2">
                    <span className="text-lg shrink-0">{CAT_ICON[it.category] ?? '◆'}</span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-semibold truncate ${gradeNameClass(it.gradeDesc)}`}>{it.name}{it.quantity > 1 ? <span className="text-dim/60 font-mono"> ×{it.quantity}</span> : null}</div>
                      <div className="text-[11px] font-mono text-dim/50 truncate">{[it.category, it.gradeDesc].filter(Boolean).join(' · ')} · {remain > 0 ? `${remain} 回合后清除` : '即将清除'}</div>
                      {(it.deleteKind || it.deleteReason) && (
                        <div className="text-[11px] font-mono mt-0.5 flex items-center gap-1.5 min-w-0">
                          <span className={`shrink-0 px-1 rounded border ${it.deleteKind === 'used'
                            ? 'text-sky-300/90 border-sky-500/40 bg-sky-900/20'
                            : 'text-amber-300/90 border-amber-500/40 bg-amber-900/20'}`}>
                            {it.deleteKind === 'used' ? '已使用' : '损坏丢弃'}
                          </span>
                          {it.deleteReason && <span className="text-dim/60 truncate min-w-0" title={it.deleteReason}>{it.deleteReason}</span>}
                        </div>
                      )}
                    </div>
                    <button onClick={() => restoreDeleted(it.id)} title="恢复回背包"
                      className="shrink-0 px-2.5 py-1 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 rounded-lg text-[12px] font-mono transition-colors">↺ 恢复</button>
                  </div>
                );
              })}

              {/* 物品离场流水：转出/合并/守护捞回 等不进回收站的离场也可查（回答「东西去哪了」） */}
              {getItemLog().length > 0 && (
                <div className="mt-3 pt-3 border-t border-edge/50">
                  <div className="text-[12px] font-mono text-dim/55 mb-1.5 px-0.5">📜 物品离场流水 · 末 {Math.min(getItemLog().length, 40)} 条（含转出 / 合并 / 守护捞回，未必可恢复，仅供查证去向）</div>
                  <div className="space-y-1">
                    {getItemLog().slice(-40).reverse().map((e, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px] font-mono px-2 py-1 rounded bg-panel/30 border border-edge/40">
                        <span className="shrink-0 text-dim/40">回合{e.turn}</span>
                        <span className="shrink-0 px-1 rounded border border-edge text-dim/75">{e.op}</span>
                        <span className="text-slate-300/90 truncate">{e.name}</span>
                        {e.detail && <span className="text-dim/45 truncate min-w-0" title={e.detail}>· {e.detail}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
