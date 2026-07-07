import { ATTR_LABEL, parseAttrBonus, type AttrDelta } from './attrBonus';
import { inferPassiveFromSkill, mergePassive, type PassiveMod } from './combatTags';
import type { SocketedGem } from '../store/itemStore';

/* ════════════════════════════════════════════
   宝石套装（gemSets）—— 「集齐同一套装的宝石」激活阶梯式套装加成。
   ★套装定义不写死：内置 DEFAULT_GEM_SETS 只作种子，实际以 gemSetStore 里**玩家可编辑 / AI 可生成**的套装列表为准。
   - 每颗宝石按其属性(gemAttr)归入某套装（setForGem·按套装的 members 关键词匹配）；生成时烘焙 gemSet / SocketedGem.set。
   - 统计**已装备装备**上所有已镶嵌宝石，按套装计数；≥2/≥4/≥6（各套装 tiers 的 need）逐档激活。
   - 套装每档加成写成**自由文本**（bonus）：六维（"力量+25"）经 parseAttrBonus 进有效六维；
     战斗被动（"暴击率+8%"/"穿透30%"/"减伤12%"/"造成伤害+18%"/"冷却缩减1回合"/"额外1段"）经 inferPassiveFromSkill 进战斗；其余为风味。
   纯函数（sets 由调用方从 store 传入），确定性、无副作用。
════════════════════════════════════════════ */

/** 一档套装效果：need 件数门槛 + 自由文本加成（六维/战斗 token 自动生效，其余风味）。 */
export interface GemSetTier { need: number; bonus: string }

/** 一套宝石套装定义（内置或玩家自定义/AI 生成）。 */
export interface GemSetDef {
  key: string;          // 稳定 id（宝石烘焙时记录；改名不改 key）
  name: string;
  emoji: string;
  theme: string;        // 主题（攻/防/元素/敏/财/自定义）
  desc: string;
  members: string[];    // 归属该套装的宝石属性/关键词（力量、暴击率…）——决定新宝石归哪套
  tiers: GemSetTier[];  // 由低到高（need 递增）
  builtin?: boolean;    // 内置种子（可被玩家编辑/删除）
}

/** 内置五大套装（**仅种子**，玩家可在套装管理里改名/改数值/改归属/删除，或 AI 另生成）。 */
export const DEFAULT_GEM_SETS: GemSetDef[] = [
  {
    key: 'rift', name: '裂空杀阵', emoji: '⚔️', theme: '攻', builtin: true,
    desc: '锋锐、穿刺、必杀——为极致输出而生的杀伐套装。',
    members: ['力量', '基础攻击', '武器锋利度', '无视防御', '护甲穿透', '真实伤害', '暴击率', '暴击伤害', '会心一击', '真实属性判定'],
    tiers: [
      { need: 2, bonus: '暴击率+8%' },
      { need: 4, bonus: '暴击伤害+30%' },
      { need: 6, bonus: '穿透30%，力量+25' },
    ],
  },
  {
    key: 'bulwark', name: '不灭壁垒', emoji: '🛡️', theme: '防', builtin: true,
    desc: '磐石之躯、金刚不坏——把伤害层层卸去的守御套装。',
    members: ['体质', '生命', '基础防御', '伤害减免', '格挡', '荆棘反伤', '真实防御', '坚韧抗控', '全抗性', '环境适应'],
    tiers: [
      { need: 2, bonus: '体质+15' },
      { need: 4, bonus: '减伤12%' },
      { need: 6, bonus: '减伤18%，体质+20' },
    ],
  },
  {
    key: 'element', name: '元素共鸣', emoji: '🔥', theme: '元素', builtin: true,
    desc: '烈焰、寒霜、惊雷共振——法术与元素伤害的增幅套装。',
    members: ['智力', '法力', '烈焰附魔', '霜寒附魔', '惊雷附魔', '灵魂伤害'],
    tiers: [
      { need: 2, bonus: '智力+15' },
      { need: 4, bonus: '造成伤害+18%' },
      { need: 6, bonus: '造成伤害+22%，智力+20' },
    ],
  },
  {
    key: 'gale', name: '疾风迅捷', emoji: '💨', theme: '敏', builtin: true,
    desc: '身法如电、连击不断——追求速度与连段的机动套装。',
    members: ['敏捷', '急速', '移动速度', '冷却缩减', '生命吸取', '脱战回复', '自动拾取'],
    tiers: [
      { need: 2, bonus: '敏捷+15' },
      { need: 4, bonus: '暴击率+6%' },
      { need: 6, bonus: '冷却缩减1回合，额外1段，敏捷+20' },
    ],
  },
  {
    key: 'fortune', name: '聚宝天工', emoji: '💰', theme: '财', builtin: true,
    desc: '招财、寻宝、匠心巧手——财富与生活产出的丰饶套装。',
    members: ['魅力', '幸运', '招财', '魔法寻宝', '历练', '采掘', '采集', '垂钓', '匠艺', '探脉', '庖厨', '交涉', '魅力社交', '御兽', '负重上限', '耐久节省'],
    tiers: [
      { need: 2, bonus: '幸运+12' },
      { need: 4, bonus: '稀有掉落率+20%、乐园币收益+30%、幸运+8' },
      { need: 6, bonus: '寻宝与生活产出大幅提升、魅力+20、幸运+10' },
    ],
  },
];

export function gemSetName(key: string | undefined, sets: GemSetDef[]): string {
  return key ? (sets.find((s) => s.key === key)?.name ?? '') : '';
}
export function gemSetMeta(key: string | undefined, sets: GemSetDef[]): GemSetDef | undefined {
  return key ? sets.find((s) => s.key === key) : undefined;
}

/** 宝石属性 → 所属套装 key：先精确命中 members，再按关键词包含（长度≥2）匹配；都不中返回 ''（不归任何套装）。 */
export function setForGem(attr: string | undefined, sets: GemSetDef[]): string {
  const a = String(attr ?? '').trim();
  if (!a) return '';
  for (const s of sets) if ((s.members ?? []).some((m) => m === a)) return s.key;                       // 精确
  for (const s of sets) if ((s.members ?? []).some((m) => m.length >= 2 && (a.includes(m) || m.includes(a)))) return s.key;   // 关键词
  return '';
}

type EquipLike = { equipped?: boolean; gems?: SocketedGem[] };

/** 统计**已装备**装备上的镶嵌宝石按套装计数（宝石无 set 或指向已删套装 → 按属性用当前 sets 回填/重判）。 */
export function collectSetCounts(equippedItems: EquipLike[], sets: GemSetDef[]): Record<string, number> {
  const valid = new Set(sets.map((s) => s.key));
  const counts: Record<string, number> = {};
  for (const it of equippedItems ?? []) {
    if (it.equipped === false) continue;
    for (const g of it.gems ?? []) {
      const key = g.set && valid.has(g.set) ? g.set : setForGem(g.attr, sets);
      if (!key) continue;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

export interface ActiveSet {
  key: string; name: string; emoji: string; theme: string; desc: string; count: number;
  tiers: (GemSetTier & { active: boolean })[];
}
/** 已装备装备上激活的套装（count≥2 才收录；含全档激活状态供展示）。 */
export function activeGemSets(equippedItems: EquipLike[], sets: GemSetDef[]): ActiveSet[] {
  const counts = collectSetCounts(equippedItems, sets);
  const out: ActiveSet[] = [];
  for (const set of sets) {
    const count = counts[set.key] ?? 0;
    if (count < 2) continue;
    const tiers = [...(set.tiers ?? [])].sort((a, b) => a.need - b.need);
    out.push({
      key: set.key, name: set.name, emoji: set.emoji, theme: set.theme, desc: set.desc, count,
      tiers: tiers.map((t) => ({ ...t, active: count >= t.need })),
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** 汇总所有激活套装档的**六维加成**（每档 bonus 文本经 parseAttrBonus 抽六维）。 */
export function gemSetAttrDelta(equippedItems: EquipLike[], sets: GemSetDef[]): AttrDelta {
  const d: AttrDelta = {};
  for (const s of activeGemSets(equippedItems, sets)) {
    for (const t of s.tiers) {
      if (!t.active) continue;
      const p = parseAttrBonus(t.bonus);
      for (const k of Object.keys(p) as (keyof AttrDelta)[]) d[k] = (d[k] ?? 0) + (p[k] ?? 0);
    }
  }
  return d;
}

/** 汇总所有激活套装档的**战斗被动修正**（每档 bonus 文本经 inferPassiveFromSkill 抽被动，再 mergePassive 合并）。 */
export function gemSetPassive(equippedItems: EquipLike[], sets: GemSetDef[]): PassiveMod {
  let p: PassiveMod = {};
  for (const s of activeGemSets(equippedItems, sets)) {
    for (const t of s.tiers) {
      if (!t.active) continue;
      const q = inferPassiveFromSkill({ name: '', effect: t.bonus } as any);
      if (q) p = mergePassive(p, q);
    }
  }
  return p;
}

/** 把套装六维加成格式化成"力量+25"文本，包成合成"装备条目"并入 effectiveAttrs（受阶位上限约束）。无则 null。 */
export function gemSetEquipEntry(equippedItems: EquipLike[], sets: GemSetDef[]): { effect: string } | null {
  const d = gemSetAttrDelta(equippedItems, sets);
  const parts = (Object.keys(d) as (keyof AttrDelta)[]).filter((k) => d[k]).map((k) => `${ATTR_LABEL[k]}+${d[k]}`);
  return parts.length ? { effect: `【套装加成：${parts.join('；')}】` } : null;
}

/** 一句话套装摘要（供场外通报 / AI 一致性）。 */
export function gemSetSummaryLine(equippedItems: EquipLike[], sets: GemSetDef[]): string {
  const active = activeGemSets(equippedItems, sets);
  if (!active.length) return '';
  const segs = active.map((s) => {
    const on = s.tiers.filter((t) => t.active).map((t) => `${t.need}件`).join('/');
    return `${s.name}(${s.count}件·激活${on})`;
  });
  return `宝石套装：${segs.join('，')}`;
}

/* ───────── AI 生成套装 ───────── */

/** 生成套装的系统提示词：让 AI 按固定 JSON 结构、用可识别 token 造一套主题化套装。 */
export const SET_GEN_PROMPT = [
  '你是「轮回乐园」宝石套装设计师。请设计**宝石套装**并只输出 JSON（不要多余解说、不要 markdown 代码块）。',
  '输出一个 JSON 数组，每个元素是一套套装，字段：',
  '- name：套装名（4~6字，有轮回乐园/无限流气质，勿与已有重名）',
  '- emoji：一个代表 emoji',
  '- theme：主题（攻/防/元素/敏/财/生活/自定义其一或自拟）',
  '- desc：一句话风味描述',
  '- members：字符串数组，列出归属该套装的宝石属性关键词（从下方属性池选，可 4~12 个）',
  '- tiers：数组，恰好 3 档，每档 {"need":2/4/6,"bonus":"加成文本"}',
  '',
  '【bonus 文本务必用可识别 token（否则不会真正生效，只当风味）】：',
  '- 六维：力量+N / 敏捷+N / 体质+N / 智力+N / 魅力+N / 幸运+N',
  '- 战斗被动：暴击率+N% / 暴击伤害+N% / 穿透N%（破甲/无视防御）/ 减伤N% / 造成伤害+N% / 冷却缩减N回合 / 额外N段',
  '- 可叠多条，用「，」分隔；也可加一句风味描述（会照显但不额外生效）',
  '【数值梯度参考·勿膨胀】：2件小(暴击率≤8%/六维≤15)、4件中(暴伤≤30%/减伤≤12%/增伤≤18%)、6件大(穿透≤30%/六维≤25，可含质变风味)。',
  '',
  '【宝石属性池（members 取材）】：力量/敏捷/体质/智力/魅力/幸运/基础攻击/基础防御/生命/法力/武器锋利度/无视防御/护甲穿透/真实伤害/灵魂伤害/生命吸取/暴击率/暴击伤害/烈焰附魔/霜寒附魔/惊雷附魔/伤害减免/格挡/荆棘反伤/真实防御/坚韧抗控/急速/会心一击/移动速度/招财/魔法寻宝/历练/全抗性/冷却缩减/采掘/采集/垂钓/匠艺/探脉/交涉/御兽。',
  '示例：[{"name":"焚天赤鳞","emoji":"🐉","theme":"元素","desc":"龙焰缠身，愈战愈炽。","members":["烈焰附魔","智力","真实伤害"],"tiers":[{"need":2,"bonus":"智力+12"},{"need":4,"bonus":"造成伤害+15%"},{"need":6,"bonus":"造成伤害+25%，智力+20，攻击附带龙焰灼烧"}]}]',
].join('\n');

/** 宽松解析（剥代码块、取最外层 JSON、容忍尾逗号/单引号）。供套装 / 自定义宝石 AI 生成共用。 */
export function looseJson(text: string): unknown {
  let t = String(text ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
  const arr = t.match(/\[[\s\S]*\]/); const obj = t.match(/\{[\s\S]*\}/);
  const body = arr ? arr[0] : obj ? obj[0] : t;
  for (const cand of [body, body.replace(/,\s*([}\]])/g, '$1'), body.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"')]) {
    try { return JSON.parse(cand); } catch { /* 下一个更宽松的候选 */ }
  }
  return null;
}

/** 校验/规整一条 AI/导入的套装（无 key/builtin；调用方补 key）。非法返回 null。 */
export function normalizeSetDef(raw: unknown): Omit<GemSetDef, 'key' | 'builtin'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = String(r.name ?? '').trim();
  if (!name) return null;
  const members = Array.isArray(r.members) ? r.members.map((m) => String(m).trim()).filter(Boolean).slice(0, 20) : [];
  const rawTiers = Array.isArray(r.tiers) ? r.tiers : [];
  const tiers: GemSetTier[] = rawTiers
    .map((t) => {
      const tt = (t ?? {}) as Record<string, unknown>;
      const need = Math.max(1, Math.min(6, Math.round(Number(tt.need) || 0)));
      const bonus = String(tt.bonus ?? '').trim();
      return need && bonus ? { need, bonus } : null;
    })
    .filter((t): t is GemSetTier => !!t)
    .sort((a, b) => a.need - b.need)
    .slice(0, 4);
  if (!tiers.length) return null;
  return {
    name: name.slice(0, 20),
    emoji: String(r.emoji ?? '💎').trim().slice(0, 4) || '💎',
    theme: String(r.theme ?? '自定义').trim().slice(0, 8) || '自定义',
    desc: String(r.desc ?? '').trim().slice(0, 80),
    members,
    tiers,
  };
}

/** 解析 AI 输出为若干套装（无 key；调用方补稳定 key）。 */
export function parseGeneratedSets(text: string): Omit<GemSetDef, 'key' | 'builtin'>[] {
  const j = looseJson(text);
  if (!j) return [];
  const arr = Array.isArray(j) ? j : [j];
  return arr.map(normalizeSetDef).filter((s): s is Omit<GemSetDef, 'key' | 'builtin'> => !!s);
}
