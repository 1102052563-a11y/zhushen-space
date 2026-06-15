import type { InventoryItem, ItemCategory } from '../store/itemStore';

/* ════════════════════════════════════════════
   装备槽位定义（主角与 NPC 共用）
   —— 从 EquipmentPanel 抽出为独立模块，避免组件间循环依赖
════════════════════════════════════════════ */
export interface SlotDef {
  key: string;       // 对应 item.equipSlot
  label: string;
  icon: string;
  group: 'weapon' | 'armor' | 'accessory' | 'treasure';
  allowedCats: ItemCategory[];  // 可装入的物品分类
}

export const SLOT_DEFS: SlotDef[] = [
  // ── 武器 4槽 ──
  { key: 'weapon:main',  label: '主武器', icon: '⚔',  group: 'weapon',    allowedCats: ['武器'] },
  { key: 'weapon:off1',  label: '副武器1', icon: '🗡',  group: 'weapon',    allowedCats: ['武器', '饰品', '特殊物品', '法宝'] },
  { key: 'weapon:off2',  label: '副武器2', icon: '🗡',  group: 'weapon',    allowedCats: ['武器', '饰品', '特殊物品', '法宝'] },
  { key: 'weapon:off3',  label: '副武器3', icon: '🗡',  group: 'weapon',    allowedCats: ['武器', '饰品', '特殊物品', '法宝'] },
  // ── 防具 7槽 ──
  { key: 'armor:head',     label: '头部',   icon: '⛑',  group: 'armor',     allowedCats: ['防具'] },
  { key: 'armor:upper',    label: '上装',   icon: '🛡',  group: 'armor',     allowedCats: ['防具'] },
  { key: 'armor:lower',    label: '下装',   icon: '🩱',  group: 'armor',     allowedCats: ['防具'] },
  { key: 'armor:feet',     label: '鞋子',   icon: '👢',  group: 'armor',     allowedCats: ['防具'] },
  { key: 'armor:hands',    label: '手部',   icon: '🧤',  group: 'armor',     allowedCats: ['防具'] },
  { key: 'armor:shoulder', label: '肩部',   icon: '🪖',  group: 'armor',     allowedCats: ['防具'] },
  { key: 'armor:belt',     label: '腰带',   icon: '🪢',  group: 'armor',     allowedCats: ['防具'] },
  // ── 饰品 6槽 ──
  ...Array.from({ length: 6 }, (_, i) => ({
    key: `accessory:#${i + 1}`,
    label: `饰品 ${i + 1}`,
    icon: i === 0 ? '📿' : i === 1 ? '💍' : i === 2 ? '📎' : '💎',
    group: 'accessory' as const,
    allowedCats: ['饰品'] as ItemCategory[],
  })),
  // ── 特殊装备 5槽 ──
  ...Array.from({ length: 5 }, (_, i) => ({
    key: `treasure:#${i + 1}`,
    label: `特殊 ${i + 1}`,
    icon: '✨',
    group: 'treasure' as const,
    allowedCats: ['特殊物品', '法宝', '其他物品', '工具'] as ItemCategory[],
  })),
];

/* 把任意槽位串规范化成合法槽位 key（武器/防具7部位/饰品/特殊装备），
   修复 AI 写出的 armor:armor / armor:legs / weapon:right / technique:N 等非规范槽 → 装备面板找不到。
   已是合法 key 则原样返回（幂等）。 */
export function normalizeEquipSlot(raw?: string, category?: string): string {
  const s = (raw || '').trim().toLowerCase();
  const cat = category || '';
  if (s) {
    const [grp, partRaw = ''] = s.split(':');
    const part = partRaw.replace('#', '').trim();
    if (grp === 'weapon') {
      if (['off1', 'off', 'left', 'secondary', '2'].includes(part)) return 'weapon:off1';
      if (['off2', '3'].includes(part)) return 'weapon:off2';
      if (['off3', '4'].includes(part)) return 'weapon:off3';
      return 'weapon:main';
    }
    if (grp === 'armor') {
      const m: Record<string, string> = {
        head: 'armor:head', helmet: 'armor:head', hat: 'armor:head', cap: 'armor:head',
        upper: 'armor:upper', armor: 'armor:upper', body: 'armor:upper', chest: 'armor:upper', torso: 'armor:upper', robe: 'armor:upper', top: 'armor:upper', coat: 'armor:upper',
        lower: 'armor:lower', legs: 'armor:lower', leg: 'armor:lower', pants: 'armor:lower', bottom: 'armor:lower', skirt: 'armor:lower',
        feet: 'armor:feet', foot: 'armor:feet', boots: 'armor:feet', boot: 'armor:feet', shoes: 'armor:feet', shoe: 'armor:feet',
        hands: 'armor:hands', hand: 'armor:hands', gloves: 'armor:hands', glove: 'armor:hands', gauntlet: 'armor:hands',
        shoulder: 'armor:shoulder', shoulders: 'armor:shoulder', pauldron: 'armor:shoulder', cloak: 'armor:shoulder', cape: 'armor:shoulder',
        belt: 'armor:belt', waist: 'armor:belt', sash: 'armor:belt',
      };
      return m[part] ?? (SLOT_DEFS.some((d) => d.key === `armor:${part}`) ? `armor:${part}` : 'armor:upper');
    }
    if (grp === 'accessory') { const n = parseInt(part, 10); return `accessory:#${n >= 1 && n <= 6 ? n : 1}`; }
    if (grp === 'treasure') { const n = parseInt(part, 10); return `treasure:#${n >= 1 && n <= 5 ? n : 1}`; }
    if (grp === 'technique') return (cat === '特殊物品' || cat === '法宝') ? 'treasure:#1' : 'armor:upper'; // 技能槽已移除
    if (SLOT_DEFS.some((d) => d.key === raw)) return raw as string;   // 已是合法 key
  }
  // 无前缀/无法识别：按分类兜底
  if (cat === '武器') return 'weapon:main';
  if (cat === '防具') return 'armor:upper';
  if (cat === '饰品') return 'accessory:#1';
  if (['特殊物品', '法宝', '工具', '其他物品'].includes(cat)) return 'treasure:#1';
  return raw && SLOT_DEFS.some((d) => d.key === raw) ? raw : 'treasure:#1';
}

/* 防具子槽：按物品名推断 头/上/下/鞋/手/肩/腰（同子槽替换是正确语义——一个部位只能穿一件）*/
function inferArmorSlot(name: string): string | null {
  const n = name || '';
  if (/(头盔|头部|帽|盔|面罩|面具|头巾|发带|发冠|王冠|护目|眼罩|兜帽|斗笠|头环)/.test(n)) return 'armor:head';
  if (/(鞋|靴|履|足具|脚)/.test(n)) return 'armor:feet';
  if (/(手套|护手|手甲|拳套|臂铠|护臂|袖)/.test(n)) return 'armor:hands';
  if (/(肩甲|护肩|披风|斗篷|肩)/.test(n)) return 'armor:shoulder';
  if (/(腰带|腰封|护腰|腰)/.test(n)) return 'armor:belt';
  if (/(裤|下装|护腿|腿甲|战裙|胫甲|裙甲)/.test(n)) return 'armor:lower';
  if (/(战服|战甲|胸甲|铠甲|护甲|盔甲|上衣|上装|外套|大衣|风衣|长袍|道袍|袍|衣|甲|马甲|背心|罩袍|躯干|防护服|作战服|制服|胸)/.test(n)) return 'armor:upper';
  return null;
}

/* 自然主组：一个分类默认优先落入的槽位组 */
const NATURAL_GROUP: Partial<Record<string, SlotDef['group']>> = {
  '武器': 'weapon', '饰品': 'accessory',
  '法宝': 'treasure', '特殊物品': 'treasure', '其他物品': 'treasure', '工具': 'treasure',
};

/* 从物品栏/背包「一键装备」时挑选合适的槽位：
   - 防具：按名称推断头/上/下/鞋/手/肩/腰子槽（同子槽替换是正确语义）
   - 功法/技能书：无限技能槽，取下一个空号
   - 其余：自然主组第一个空槽 → 任意兼容空槽 → 兜底替换第一个兼容槽
   修复旧版把整个分类塞进同一个固定槽、导致不同部位互相覆盖的问题。*/
export function pickEquipSlot(item: InventoryItem, items: InventoryItem[]): string {
  const cat = item.category as string;
  const occupied = new Set(
    items.filter((i) => i.equipped && i.equipSlot && i.id !== item.id).map((i) => i.equipSlot as string),
  );

  // 防具：按名称推断子槽（推断不出再取第一个空防具槽）
  if (cat === '防具') {
    const inferred = inferArmorSlot(item.name);
    if (inferred) return inferred;
    const free = SLOT_DEFS.find((s) => s.group === 'armor' && !occupied.has(s.key));
    return free?.key ?? 'armor:upper';
  }

  // 其余分类：自然主组优先取第一个空槽
  const group = NATURAL_GROUP[cat];
  if (group) {
    const free = SLOT_DEFS.find((s) => s.group === group && (s.allowedCats as string[]).includes(cat) && !occupied.has(s.key));
    if (free) return free.key;
  }
  // 任意兼容空槽（自然组已满时溢出，如副武器位）
  const anyFree = SLOT_DEFS.find((s) => (s.allowedCats as string[]).includes(cat) && !occupied.has(s.key));
  if (anyFree) return anyFree.key;
  // 全满：兜底替换自然组第一个槽，否则第一个兼容槽
  const fb = (group && SLOT_DEFS.find((s) => s.group === group && (s.allowedCats as string[]).includes(cat)))
    || SLOT_DEFS.find((s) => (s.allowedCats as string[]).includes(cat));
  return fb?.key ?? 'unknown';
}

/* 某槽位是否允许装入该分类（按 SLOT_DEFS.allowedCats）。槽位不存在则返回 false。*/
export function slotAcceptsCategory(slotKey: string, category?: string): boolean {
  const def = SLOT_DEFS.find((d) => d.key === slotKey);
  if (!def) return false;
  return (def.allowedCats as string[]).includes(String(category ?? '').trim());
}

/* 解析「这件物品该装到哪个槽」：先按 AI 给的槽位串归一化；
   若归一化后的槽位与物品分类**不兼容**（如 AI 把武器塞进饰品槽），改用 pickEquipSlot
   按分类/名称自动挑一个对的槽——修复"自动装备把武器装到饰品栏之类"的错配。
   AI 槽位与分类兼容时（含副武器位允许饰品/特殊物品等刻意多类槽）则尊重 AI 的选择。*/
export function resolveEquipSlot(item: InventoryItem, items: InventoryItem[], rawSlot?: string): string {
  const norm = normalizeEquipSlot(rawSlot, item.category);
  if (slotAcceptsCategory(norm, item.category)) return norm;
  return pickEquipSlot(item, items);
}
