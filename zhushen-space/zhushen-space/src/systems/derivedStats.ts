import type { PlayerAttrs } from '../store/playerStore';

/* 衍生属性（主角与 NPC 共用）：由六维 + 等级 + 已装备物品换算
   - 物理ATK：max(力,敏)主导 + 武器          - 物理DEF：体质 + 防具
   - 法术ATK：智力 + 装备                     - 法术DEF：智力(感知/精神) + 魅力 + 装备法抗
   公式系数可调；换装/升级/加点会让上层组件重新调用本函数 */
export interface EquipLite { category: string; grade: number }
export interface DerivedStats { patk: number; pdef: number; matk: number; mdef: number }

export function computeDerived(attrs: PlayerAttrs | undefined, level: number, equipped: EquipLite[]): DerivedStats {
  const a = attrs ?? { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 };
  const lv = Math.max(1, level || 1);
  const eq = equipped.reduce((acc, it) => {
    const g = Math.max(1, it.grade);
    if (it.category === '武器') { acc.patk += g * 8; acc.matk += g * 4; }
    else if (it.category === '防具') { acc.pdef += g * 6; acc.mdef += g * 4; }
    else { acc.patk += g * 2; acc.pdef += g * 2; acc.matk += g * 2; acc.mdef += g * 2; } // 饰品/特殊/其他
    return acc;
  }, { patk: 0, pdef: 0, matk: 0, mdef: 0 });
  return {
    patk: Math.round(Math.max(a.str, a.agi) * 3 + a.str * 1 + lv * 2 + eq.patk),
    pdef: Math.round(a.con * 3 + lv * 2 + eq.pdef),
    matk: Math.round(a.int * 3 + lv * 2 + eq.matk),
    mdef: Math.round(a.int * 1.6 + a.cha * 1.4 + lv * 2 + eq.mdef),
  };
}

/* ── 生命 HP / 蓝量 EP 上限换算（主角与 NPC 共用，纯前端计算，AI 不写）──
   - 生命 HP 上限 = 体质(con) × 20
   - 蓝量 EP 上限 = 智力(int) × 15
   六维按「普通属性」存储；真实属性（每 80 普通 = 1 真实，见 trueAttr）只是显示折算，
   故公式直接作用于存储的普通值即可自动适配后期：1 点真实体力(=80 普通) → 1600 HP。 */
export const HP_PER_CON = 20;
export const EP_PER_INT = 15;
export function computeMaxHp(attrs?: PlayerAttrs): number {
  const con = Math.max(0, attrs?.con ?? 5);
  return Math.round(con * HP_PER_CON);
}
export function computeMaxEp(attrs?: PlayerAttrs): number {
  const intel = Math.max(0, attrs?.int ?? 5);
  return Math.round(intel * EP_PER_INT);
}

/* 从装备的效果/词缀文本里解析"增加 HP/EP 上限"的加成——只有**明确写到"上限/最大值"**的装备效果才计入最大值，
   "回复X生命""每秒恢复X"等只是当前值变化，不计入上限。供 最大HP/EP = 六维换算 + 装备上限加成。 */
function vitalMaxBonus(texts: (string | undefined)[], kind: 'hp' | 'ep'): number {
  const names = kind === 'hp' ? '生命|HP|血量|气血|体力|血量值' : '蓝量|EP|法力|魔力|能量|精力|内力|蓝';
  const res = [
    new RegExp(`(?:${names})(?:值)?\\s*(?:上限|最大值)\\s*[:：]?\\s*[+＋]?\\s*(\\d+)`, 'gi'),
    new RegExp(`最大\\s*(?:${names})(?:值)?\\s*[:：]?\\s*[+＋]?\\s*(\\d+)`, 'gi'),
    new RegExp(`(?:增加|提升|提高|额外|附加)\\s*(\\d+)\\s*点?\\s*(?:${names})(?:值)?\\s*(?:上限|最大值)`, 'gi'),
    new RegExp(`(?:${names})(?:值)?\\s*(?:上限|最大值)\\s*(?:增加|提升|提高)\\s*(\\d+)`, 'gi'),
  ];
  let sum = 0;
  for (const raw of texts) {
    if (!raw) continue;
    const t = String(raw);
    const seen = new Set<number>();
    for (const re of res) { let m: RegExpExecArray | null; while ((m = re.exec(t)) !== null) { if (!seen.has(m.index)) { seen.add(m.index); sum += Number(m[1]); } } }
  }
  return sum;
}
/* 已装备物品对 最大HP / 最大EP 的上限加成合计（装备效果/词缀里写明"X上限"的部分）*/
export function gearMaxHpBonus(equipped: { effect?: string; affix?: string }[] = []): number {
  return equipped.reduce((s, it) => s + vitalMaxBonus([it.effect, it.affix], 'hp'), 0);
}
export function gearMaxEpBonus(equipped: { effect?: string; affix?: string }[] = []): number {
  return equipped.reduce((s, it) => s + vitalMaxBonus([it.effect, it.affix], 'ep'), 0);
}
/* 「当前值」显示：
   - 从未设过(undefined) → 视为满（= 当前上限），仅用于角色刚建档、还没发生任何增减时
   - 已有具体当前值 → **原样保留**，只夹到 [0, 上限] 内
   注意：**上限变大时绝不自动把当前值顶上去**（否则体质/智力一变，HP/EP 会"自己回血"）——
   当前值只应由正文驱动的 hp.<id>/mp.<id> 增减来改变。storedMax 参数已不再参与判断，保留仅为兼容调用签名。 */
export function effectiveResource(cur: number | undefined, _storedMax: number | undefined, derivedMax: number): number {
  if (cur == null) return derivedMax;
  return Math.min(Math.max(0, cur), derivedMax);
}

/* 从 realm 字符串（如 "一阶·Lv.8|身份"）提取 Lv 数字；取不到默认 1 */
export function lvFromRealm(realm?: string): number {
  const m = /Lv\.?\s*(\d+)/i.exec(realm ?? '');
  return m ? Number(m[1]) : 1;
}

/* 等级 → 阶位名（轮回乐园阶位表，与角色阶位体系一致）
   一阶 Lv.1-10 … 九阶 Lv.81-90 / 绝强 91-100 / 至强 101-120 / 巅峰至强 121-140 / 无上之境 140+ */
export function realmFromLevel(level: number): string {
  const lv = Math.max(1, Math.round(level || 1));
  if (lv <= 10) return '一阶';
  if (lv <= 20) return '二阶';
  if (lv <= 30) return '三阶';
  if (lv <= 40) return '四阶';
  if (lv <= 50) return '五阶';
  if (lv <= 60) return '六阶';
  if (lv <= 70) return '七阶';
  if (lv <= 80) return '八阶';
  if (lv <= 90) return '九阶';
  if (lv <= 100) return '绝强';
  if (lv <= 120) return '至强';
  if (lv <= 140) return '巅峰至强';
  return '无上之境';
}

/* 真实属性换算：每 80 点普通属性 = 1 点真实属性（floor(值/80)）。
   仅当属性 > 80 时才开始产生真实属性（80→1，160→2…，<80→0）。 */
export function trueAttr(value: number): number {
  return Math.floor(Math.max(0, value || 0) / 80);
}
export function trueAttrs<T extends Record<string, number>>(attrs: T): T {
  const out = {} as Record<string, number>;
  for (const k of Object.keys(attrs)) out[k] = trueAttr(attrs[k]);
  return out as T;
}

/* 合法阶位枚举（轮回乐园），由低到高。阶位字段只允许这些值。 */
export const TIERS = ['一阶', '二阶', '三阶', '四阶', '五阶', '六阶', '七阶', '八阶', '九阶', '绝强', '至强', '巅峰至强', '无上之境'] as const;

/* 把 AI 写的任意阶位字符串规范化成合法阶位名（如 "三阶中期"→"三阶"、"结丹"→""）。
   取不到合法阶位时返回 ''（调用方可回退到按等级推导 realmFromLevel）。多字阶位优先匹配。 */
export function normalizeTier(raw?: string): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  for (const t of ['巅峰至强', '无上之境', '至强', '绝强', '九阶', '八阶', '七阶', '六阶', '五阶', '四阶', '三阶', '二阶', '一阶']) {
    if (s.includes(t)) return t;
  }
  return '';
}
