import { ATTR_LABEL, parseAttrBonus, type AttrDelta } from './attrBonus';
import { inferPassiveFromSkill, mergePassive, type PassiveMod } from './combatTags';

/* ════════════════════════════════════════════
   装备套装（equipSets）—— 合成工坊「套装锻造」产出的整套主题装备，按**已装备的同套件数**阶梯激活套装效果。
   机制克隆 gemSets（宝石套装），差异只有一处：计数依据是**装备件本体**的 equipSet 字段（锻造入库时烘焙），
   而非装备上镶嵌的宝石。与宝石套装并联生效、互不干扰。
   - 效果解锁档位（tiers 的 need）由前端按件数确定性生成（tiersForPieces），AI 只写每档 bonus 文案。
   - 每档 bonus 是**自由文本**：六维（"力量+25"）经 parseAttrBonus 进有效六维；
     战斗被动（"暴击率+8%"/"穿透30%"/"减伤12%"…）经 inferPassiveFromSkill 进战斗结算；其余为风味。
   纯函数（sets 由调用方从 equipSetStore 传入），确定性、无副作用。
════════════════════════════════════════════ */

/** 一档套装效果：need 件数门槛 + 自由文本加成（六维/战斗 token 自动生效，其余风味）。 */
export interface EquipSetTier { need: number; bonus: string }

/** 一套锻造套装定义（合成工坊「套装锻造」确认入库时写入 equipSetStore）。 */
export interface EquipSetDef {
  key: string;          // 稳定 id（部件 InventoryItem.equipSet 引用；改名不改 key）
  name: string;
  emoji: string;
  theme: string;        // 套装主题（AI 生成）
  desc: string;
  gradeDesc: string;    // 全套品级（锻造品质掷骰锁定）
  pieces: number;       // 总件数（2~6，玩家锻造时自选）
  tiers: EquipSetTier[];   // 由低到高（need 递增，前端确定性生成）
  createdAt: number;
}

/** 待确认的套装定义（AI 生成预览态，confirmCraft 时补 key/createdAt 入库）。 */
export type PendingEquipSetDef = Omit<EquipSetDef, 'key' | 'createdAt'>;

/** 件数 → 效果解锁档位（确定性；AI/玩家不可改动档位本身，只写文案）。 */
export function tiersForPieces(n: number): number[] {
  const p = Math.max(2, Math.min(6, Math.round(n) || 2));
  return ({ 2: [2], 3: [2, 3], 4: [2, 4], 5: [2, 4, 5], 6: [2, 4, 6] } as Record<number, number[]>)[p];
}

type EquipSetItemLike = { equipped?: boolean; equipSet?: string };

/** 统计**已装备**装备按所属套装计数（equipSet 指向已删套装 → 不计）。 */
export function collectEquipSetCounts(items: EquipSetItemLike[], sets: EquipSetDef[]): Record<string, number> {
  const valid = new Set(sets.map((s) => s.key));
  const counts: Record<string, number> = {};
  for (const it of items ?? []) {
    if (!it.equipped) continue;
    const key = it.equipSet && valid.has(it.equipSet) ? it.equipSet : '';
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export interface ActiveEquipSet {
  key: string; name: string; emoji: string; theme: string; desc: string;
  gradeDesc: string; pieces: number; count: number;
  tiers: (EquipSetTier & { active: boolean })[];
}
/** 已装备的套装进度（count≥1 即收录供"已集齐 x/N"展示；含各档激活状态）。 */
export function activeEquipSets(items: EquipSetItemLike[], sets: EquipSetDef[]): ActiveEquipSet[] {
  const counts = collectEquipSetCounts(items, sets);
  const out: ActiveEquipSet[] = [];
  for (const set of sets) {
    const count = counts[set.key] ?? 0;
    if (count < 1) continue;
    const tiers = [...(set.tiers ?? [])].sort((a, b) => a.need - b.need);
    out.push({
      key: set.key, name: set.name, emoji: set.emoji, theme: set.theme, desc: set.desc,
      gradeDesc: set.gradeDesc, pieces: set.pieces, count,
      tiers: tiers.map((t) => ({ ...t, active: count >= t.need })),
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** 汇总所有激活套装档的**六维加成**（每档 bonus 文本经 parseAttrBonus 抽六维）。 */
export function equipSetAttrDelta(items: EquipSetItemLike[], sets: EquipSetDef[]): AttrDelta {
  const d: AttrDelta = {};
  for (const s of activeEquipSets(items, sets)) {
    for (const t of s.tiers) {
      if (!t.active) continue;
      const p = parseAttrBonus(t.bonus);
      for (const k of Object.keys(p) as (keyof AttrDelta)[]) d[k] = (d[k] ?? 0) + (p[k] ?? 0);
    }
  }
  return d;
}

/** 汇总所有激活套装档的**战斗被动修正**（每档 bonus 文本经 inferPassiveFromSkill 抽被动，再 mergePassive 合并）。 */
export function equipSetPassive(items: EquipSetItemLike[], sets: EquipSetDef[]): PassiveMod {
  let p: PassiveMod = {};
  for (const s of activeEquipSets(items, sets)) {
    for (const t of s.tiers) {
      if (!t.active) continue;
      const q = inferPassiveFromSkill({ name: '', effect: t.bonus } as any);
      if (q) p = mergePassive(p, q);
    }
  }
  return p;
}

/** 把套装六维加成格式化成"力量+25"文本，包成合成"装备条目"并入 effectiveAttrs（受阶位上限约束）。无则 null。 */
export function equipSetEquipEntry(items: EquipSetItemLike[], sets: EquipSetDef[]): { effect: string } | null {
  const d = equipSetAttrDelta(items, sets);
  const parts = (Object.keys(d) as (keyof AttrDelta)[]).filter((k) => d[k]).map((k) => `${ATTR_LABEL[k]}+${d[k]}`);
  return parts.length ? { effect: `【装备套装加成：${parts.join('；')}】` } : null;
}

/** 一句话套装摘要（供场外通报 / AI 一致性）。 */
export function equipSetSummaryLine(items: EquipSetItemLike[], sets: EquipSetDef[]): string {
  const active = activeEquipSets(items, sets);
  if (!active.length) return '';
  const segs = active.map((s) => {
    const on = s.tiers.filter((t) => t.active).map((t) => `${t.need}件`).join('/');
    return `${s.name}(${s.count}/${s.pieces}件${on ? `·激活${on}` : ''})`;
  });
  return `装备套装：${segs.join('，')}`;
}

/* ───────── AI 生成解析（套装锻造）───────── */

/** 校验/规整 AI 输出的套装定义部分（gradeDesc/pieces/tiers.need 由调用方按前端锁定值覆盖）。非法返回 null。 */
export function normalizeEquipSetDef(raw: unknown): Pick<PendingEquipSetDef, 'name' | 'emoji' | 'theme' | 'desc' | 'tiers'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = String(r.name ?? '').trim();
  if (!name) return null;
  const rawTiers = Array.isArray(r.tiers) ? r.tiers : [];
  const tiers: EquipSetTier[] = rawTiers
    .map((t) => {
      const tt = (t ?? {}) as Record<string, unknown>;
      const need = Math.max(1, Math.min(6, Math.round(Number(tt.need) || 0)));
      const bonus = String(tt.bonus ?? '').trim();
      return need && bonus ? { need, bonus } : null;
    })
    .filter((t): t is EquipSetTier => !!t)
    .sort((a, b) => a.need - b.need)
    .slice(0, 4);
  if (!tiers.length) return null;
  return {
    name: name.slice(0, 24),
    emoji: String(r.emoji ?? '🛡').trim().slice(0, 4) || '🛡',
    theme: String(r.theme ?? '自定义').trim().slice(0, 12) || '自定义',
    desc: String(r.desc ?? '').trim().slice(0, 120),
    tiers,
  };
}

/** 宽松抠**单个 object**（剥代码块、取最外层 `{...}`、容尾逗号/单引号）。
 *  不复用 gemSets.looseJson：它优先抓 `[...]`——含嵌套数组的顶层 object 会被抓成"首个[到末个]"的碎片。 */
function looseJsonObject(text: string): unknown {
  const t = String(text ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
  const obj = t.match(/\{[\s\S]*\}/);
  const body = obj ? obj[0] : t;
  for (const cand of [body, body.replace(/,\s*([}\]])/g, '$1'), body.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"')]) {
    try { return JSON.parse(cand); } catch { /* 下一个更宽松的候选 */ }
  }
  return null;
}

/** 解析套装锻造的 AI 输出：单个 object `{ set:{...}, pieces:[...] }`。部件字段的扁平化/截断由调用方（runCraftPhase）照合成惯例处理。 */
export function parsePendingSuit(text: string): { set: NonNullable<ReturnType<typeof normalizeEquipSetDef>>; pieces: Record<string, unknown>[] } | null {
  const j = looseJsonObject(String(text ?? '').replace(/<套装推演>[\s\S]*?<\/套装推演>/g, ' '));
  if (!j || typeof j !== 'object') return null;
  const r = j as Record<string, unknown>;
  const set = normalizeEquipSetDef(r.set ?? r);
  if (!set) return null;
  const pieces = (Array.isArray(r.pieces) ? r.pieces : [])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object');
  if (!pieces.length) return null;
  return { set, pieces };
}
