import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';
import { normalizeEquipSlot } from '../systems/equipSlots';
import { walletAdjust, walletSet } from '../systems/ledger/walletCore';   // Step 10 事件核心·货币影子记账
import { noteCurrencyChange } from '../systems/allocNotice';   // 场外货币变动 → 正文一次性通报（防"花到5000正文却记10000"OOC）
import { itemCreate, itemConsume, commitItems } from '../systems/ledger/itemCore';   // Step 10 事件核心·物品影子记账 + facade 规范化闸门

export type ItemCategory =
  // 装备类
  | '武器' | '防具' | '饰品' | '宝石'
  // 消耗品/材料
  | '消耗品' | '材料' | '工具'
  // 特殊类
  | '重要物品' | '特殊物品' | '凡物' | '其他物品'
  // 旧版兼容（xianxia），保留以兼容旧存档
  | '功法' | '法宝' | '丹药' | '符箓' | '灵药' | '阵具';

export const ITEM_CATEGORIES: ItemCategory[] = [
  // 轮回乐园主分类（UI 只提供这些；旧版修仙分类 功法/法宝/丹药/符箓/灵药/阵具 仍保留在
  // ItemCategory 类型里以兼容老存档的既有物品，但不再作为可选项展示/生成）
  '武器', '防具', '饰品', '宝石',
  '消耗品', '材料', '工具',
  '重要物品', '特殊物品', '凡物', '其他物品',
];

/** 轮回乐园物品/装备品级（颜色品质，由低到高），存入 gradeDesc。
 *  低阶 白→绿→蓝；中阶 紫→暗紫；高阶 淡金→金→暗金；顶阶 传说→史诗→圣灵；
 *  虚空阶 不朽→起源→永恒（永恒=成长终点档），创世为旧版保留的最高档（在永恒之上）。*/
export const ITEM_GRADES = [
  '白色', '绿色', '蓝色', '紫色', '暗紫色', '淡金', '金色', '暗金',
  '传说级', '史诗级', '圣灵级', '不朽级', '起源', '永恒', '创世',
] as const;
export type ItemGrade = typeof ITEM_GRADES[number];

/** 把词缀/效果文本按【…】拆成分条，逐条展示（每条「【名】：说明」自成一行，排版更清晰）；
 *  无【】则整段当一条。前瞻 split 只在每个【前断开，说明里的「：；」不会被拆碎。
 *  兼容 AI 偶尔把词缀写成**数组**或**JSON 数组串** `["条1","条2"]`：逐条拆出、剥掉 [ " , ] 引号括号噪音
 *  （治"词缀显示成 ["…","…"] 这种怪格式"）。String() 兜底：万一是数字/对象也不崩。供各物品面板复用。*/
/** 单条词缀 → 文本：兼容 AI 把每条词缀写成对象 `{name,desc}`（→ "【名】：说明"）/ 纯字符串 / 其它。*/
function affixEntryToStr(x: any): string {
  if (x == null) return '';
  if (typeof x === 'string') return x.trim();
  if (typeof x === 'object' && !Array.isArray(x)) {
    // 用 asText 取字段（非裸 String）：字段值本身若又是对象——如 AI 按「词缀/效果/数值三分」写成
    // {name, effect:{desc,value}} 或缺 name 只给 {effect:{...}}——也会被递归扁平化，绝不吐 [object Object]
    // （频道/私信交易物品词缀显示成 [object Object] 的根因）。
    const name = asText(x.name ?? x.title ?? x.label ?? '').trim();
    const desc = asText(x.desc ?? x.description ?? x.text ?? x.effect ?? x.value ?? '').trim();
    if (name && desc) return `${name}${/[:：]\s*$/.test(name) ? '' : '：'}${desc}`;
    return name || desc || '';
  }
  return asText(x).trim();   // 数组等 → asText（原 String(x) 会把对象/对象数组变 [object Object]）
}

export function splitAffixEntries(text?: unknown): string[] {
  if (Array.isArray(text)) return text.map(affixEntryToStr).filter(Boolean);   // 数组(字符串或 {name,desc} 对象) → 逐条
  if (text && typeof text === 'object') { const s = affixEntryToStr(text); return s ? [s] : []; }   // 单个对象 → 走 asText 扁平化，不再 String()→[object Object]
  let t = String(text ?? '').trim();
  if (!t) return [];
  // JSON 数组串 ["a","b"] / [{...}] → 解析出来逐条（AI 把多条词缀打包成数组字符串时出现）
  if (t.startsWith('[') && t.endsWith(']')) {
    try { const arr = JSON.parse(t); if (Array.isArray(arr)) return arr.map(affixEntryToStr).filter(Boolean); } catch { /* 非合法 JSON → 往下按文本处理 */ }
    t = t.replace(/^\[\s*"?|"?\s*\]$/g, '').replace(/"\s*,\s*"/g, '\n');   // 解析失败兜底：剥掉首尾 [ " ] 与条目间 "," 噪音
  }
  if (!t.includes('【')) return t.split('\n').map((s) => s.trim()).filter(Boolean) || [t];
  return t.split(/(?=【)/g).map((s) => s.replace(/^["',\s]+|["',\s]+$/g, '').trim()).filter(Boolean);   // 每条再剥掉残留的引号/逗号
}

/** 安全把「本该是字符串、却被 AI 偶尔写成对象/数组」的字段转成可渲染文本，避免 React #31
 *  「Objects are not valid as a React child」整页崩（典型：combatStat 被写成 {atk:15}、词缀被写成 [{name,desc}]）。
 *  {name,desc} → "名：说明"；{atk:15,def:8} → "atk:15 def:8"；[a,b] → "a / b"；字符串/数字原样。供直接渲染这类字段的面板兜底。*/
export function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(' / ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const nm = o.name ?? o.title ?? o.label;   // 词缀/能力对象 {name,desc} → "名：说明"（不带机读味的 key:）
    if (typeof nm === 'string' && nm.trim()) {
      const ds = o.desc ?? o.description ?? o.text ?? o.effect;
      return ds != null && String(ds).trim() ? `${nm.trim()}：${String(ds).trim()}` : nm.trim();
    }
    try {
      return Object.entries(o).map(([k, val]) => { const t = asText(val); return t ? `${k}:${t}` : ''; }).filter(Boolean).join(' ');
    } catch { return ''; }
  }
  return String(v);
}

/** 货币/点数类「伪物品」：本应是 currency 计数（乐园币/灵魂钱币/技能点/黄金技能点/潜能点/属性点…），
 *  被 AI 误用 createItem 建成「特殊物品」时，绝不可装备、不进装备选择器、不能上装备栏。按名精确识别（无误伤真装备）。 */
const RESOURCE_PSEUDO_RE = /^(乐园币|灵魂钱币|魂币|魂钱币|金币)$|(技能点|黄金技能点|潜能点|进阶点|属性点|真实属性点)$/;
export function isResourcePseudoItem(item?: { name?: string }): boolean {
  return RESOURCE_PSEUDO_RE.test((item?.name ?? '').trim());
}

/** 品级字串 → 数值档位（1=白色 … 15=创世，由低到高）。
 *  供装备判定/排序在 AI 未给出 numeric.grade 时按品级文字兜底取档。
 *  关键字按「更具体的在前」匹配（暗金先于金、淡金先于金、暗紫先于紫），避免子串误命中。*/
export function gradeToNum(grade?: string): number {
  const g = String(grade ?? '');
  const order: [string, number][] = [
    ['创世', 15], ['永恒', 14], ['起源', 13], ['不朽', 12], ['圣灵', 11], ['史诗', 10], ['传说', 9],
    ['暗金', 8], ['淡金', 6], ['金', 7], ['暗紫', 5], ['紫', 4], ['蓝', 3], ['绿', 2], ['白', 1],
  ];
  for (const [k, v] of order) if (g.includes(k)) return v;
  return 1;
}

/** 评分(score) → 物品档位(1-14)。区间同 ITEM_GRADE_TABLE_RULE；非法/缺失返回 0。
 *  创世(15)为旧版神话档，不由评分自动落档（8000+ 落永恒14）。*/
export function scoreToGradeNum(score?: number | string): number {
  // 只认「首个数字 token」：score 文本常带区间说明（如「28（绿色区间11~30分）」），
  // 旧实现 replace(/[^\d.]/g) 会把所有数字拼成「281130」→ 误落永恒档。改为取第一个数字。
  const n = typeof score === 'number'
    ? score
    : (() => { const m = String(score ?? '').match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : NaN; })();
  if (!isFinite(n) || n <= 0) return 0;
  if (n <= 10) return 1;
  if (n <= 30) return 2;
  if (n <= 70) return 3;
  if (n <= 150) return 4;
  if (n <= 260) return 5;
  if (n <= 310) return 6;
  if (n <= 400) return 7;
  if (n <= 530) return 8;
  if (n <= 700) return 9;
  if (n <= 1000) return 10;
  if (n <= 1500) return 11;
  if (n <= 3000) return 12;
  if (n <= 8000) return 13;
  return 14;
}

/** 技能/天赋品级词（普通/精良/稀有/奥义/极境）——绝不该出现在物品 gradeDesc 里。 */
const SKILL_GRADE_WORDS = ['普通', '精良', '稀有', '奥义', '极境'];
// 物品 15 档全部拼写（长名/具体名在前，避免「暗金」被「金」抢匹配）。
const TIER_ALT =
  '暗紫色|暗紫|暗金|淡金|金色|创世|永恒|起源|不朽级|不朽|圣灵级|圣灵|史诗级|史诗|传说级|传说|白色|绿色|蓝色|紫色|白|绿|蓝|紫|金';
// 「档名 + 分隔符 + 档名」复合品级（如「紫色/史诗」「暗金·史诗级」）；两端用边界/分隔约束，
// 避免把描述里的品级字（如「暗金·金属之心」的「金属」）误判成第二个档。
const COMPOSITE_GRADE_RE = new RegExp(
  `(?<=^|[\\s/／、,，·•])(${TIER_ALT})\\s*[/／、,，·•]\\s*(${TIER_ALT})(?=$|[\\s/／、,，·•])`,
);
function gradeNumFromOpt(grade?: number | string): number {
  const n = typeof grade === 'number' ? grade : parseInt(String(grade ?? ''), 10);
  return Number.isFinite(n) && n >= 1 && n <= 15 ? n : 0;
}
/** 取 gradeDesc 开头的那个档名（按「具体名在前」匹配，避免「暗金」被「金」抢、「暗紫」被「紫」抢）；找不到返回 ''。 */
function leadingGradeName(g: string): string {
  for (const name of TIER_ALT.split('|')) if (g.startsWith(name)) return name;
  return '';
}

/** 把物品品级文字收敛成【单一档】（ITEM_GRADE_TABLE_RULE「一物一档」铁则的纯前端护栏）：
 *  ① 剥离误用的技能/天赋品级词（普通/精良/稀有/奥义/极境）；
 *  ② 折叠「紫色/史诗」这类复合品级 → 一个档名：评分(score)优先 → numeric.grade → 取较低档（防越级爆品）。
 *  单一档（含「紫色·带3条词缀」这类合法描述后缀）原样保留。确定性、无 API。*/
export function normalizeGradeLabel(
  gradeDesc?: string,
  opts?: { score?: number | string; grade?: number | string },
): { grade: string; changed: boolean } {
  const original = String(gradeDesc ?? '').trim();
  if (!original) return { grade: original, changed: false };
  let g = original;
  // ① 剥离技能/天赋品级词（连同其前导分隔符）
  for (const w of SKILL_GRADE_WORDS) g = g.replace(new RegExp(`[\\s/／、,，·•]*${w}`, 'g'), '');
  // ② 折叠复合品级（可能叠写三档以上，循环到收敛；每轮 tier-token 数严格减少必终止）
  for (let m = COMPOSITE_GRADE_RE.exec(g); m; m = COMPOSITE_GRADE_RE.exec(g)) {
    const pick =
      scoreToGradeNum(opts?.score) || gradeNumFromOpt(opts?.grade) || Math.min(gradeToNum(m[1]), gradeToNum(m[2]));
    const name = ITEM_GRADES[pick - 1] ?? m[1];
    g = g.slice(0, m.index) + name + g.slice(m.index + m[0].length);
  }
  // 清理剥离/折叠后残留的首尾分隔符
  g = g.replace(/^[\s/／、,，·•]+|[\s/／、,，·•]+$/g, '').trim();
  if (!g) g = original; // 防清空：万一全被剥掉，回退原值
  // ③ 单标签越级收敛（评分封顶·只降不升）：给了有效评分、而开头档名【高于】评分所属档（典型越级爆品，
  //    如「评分100却标史诗级」）→ 按评分把开头档名降到对应档（保留后缀描述）。评分缺失、或档名≤评分档时一律不动
  //    （不擅自抬升，避免把异常评分放大成爆品）。创世(15)是神话档、评分最高只折到永恒(14)，故评分本就极高(≥起源档)时保留创世。
  const tgt = scoreToGradeNum(opts?.score);
  if (tgt > 0) {
    const lead = leadingGradeName(g);
    const cur = lead ? gradeToNum(lead) : 0;
    const keepGenesis = cur === 15 && tgt >= 13;
    if (cur > tgt && !keepGenesis) {
      const want = ITEM_GRADES[tgt - 1];
      if (lead && want) g = want + g.slice(lead.length);
    }
  }
  return { grade: g, changed: g !== original };
}

/** 镶嵌孔系统上限（任何装备孔位都不超过这个数）*/
export const MAX_SOCKETS = 6;
/** 装备按品级自带的初始孔位（高品质自带更多孔）：白/绿0、蓝~暗紫1、淡金~暗金2、传说~圣灵3、不朽~永恒4、创世5 */
export function defaultSocketsByGrade(grade?: string): number {
  return Math.min(MAX_SOCKETS, Math.floor(gradeToNum(grade) / 3));
}
/** 装备的有效孔位数：显式 sockets（打孔后）优先，否则按品级派生 */
export function socketsOf(item: { sockets?: number; gradeDesc?: string }): number {
  return Math.min(MAX_SOCKETS, item.sockets ?? defaultSocketsByGrade(item.gradeDesc));
}

/** 品级 → 文字配色（用于品级标签/字样上色，与世界书品质色阶一致）*/
export function gradeColorClass(grade?: string): string {
  const g = String(grade ?? '');
  if (g.includes('创世')) return 'text-rose-300';
  if (g.includes('永恒')) return 'text-cyan-200';
  if (g.includes('起源')) return 'text-fuchsia-300';
  if (g.includes('不朽')) return 'text-indigo-300';
  if (g.includes('圣灵')) return 'text-teal-200';
  if (g.includes('史诗')) return 'text-rose-400';
  if (g.includes('传说')) return 'text-orange-300';
  if (g.includes('暗金')) return 'text-amber-500';
  if (g.includes('淡金')) return 'text-amber-200';
  if (g.includes('金'))   return 'text-yellow-300';   // 金色
  if (g.includes('暗紫')) return 'text-violet-400';
  if (g.includes('紫'))   return 'text-purple-300';
  if (g.includes('蓝'))   return 'text-sky-300';
  if (g.includes('绿'))   return 'text-emerald-300';
  if (g.includes('白'))   return 'text-slate-200';
  return 'text-dim/70';
}

/** 品级 → 完整徽章样式（品级越高越华丽：颜色→发光→渐变→流光→脉冲）。用于品级标签醒目展示。
 *  配合 index.css 的 .grade-* 类。元素须只包含品级文字（渐变文字会把内容设为透明）。*/
export function gradeBadgeClass(grade?: string): string {
  const g = String(grade ?? '');
  if (g.includes('创世')) return 'grade-badge grade-grad grade-grad-genesis grade-shimmer grade-pulse';
  if (g.includes('永恒')) return 'grade-badge grade-grad grade-grad-eternal grade-shimmer grade-pulse';
  if (g.includes('起源')) return 'grade-badge grade-grad grade-grad-origin grade-shimmer grade-glow-1';
  if (g.includes('不朽')) return 'grade-badge grade-grad grade-grad-immortal grade-shimmer grade-glow-1';
  if (g.includes('圣灵')) return 'grade-badge grade-grad grade-grad-holy grade-shimmer grade-glow-1';
  if (g.includes('史诗')) return 'grade-badge grade-grad grade-grad-epic grade-shimmer';
  if (g.includes('传说')) return 'grade-badge grade-grad grade-grad-legend grade-shimmer';
  if (g.includes('暗金')) return 'grade-badge grade-grad grade-grad-darkgold grade-shimmer';
  if (g.includes('金'))   return 'grade-badge grade-grad grade-grad-gold grade-glow-2';   // 淡金/金色
  if (g.includes('暗紫')) return 'grade-badge grade-grad grade-grad-darkpurple grade-glow-1';
  if (g.includes('紫'))   return 'grade-badge text-purple-300 grade-glow-1';
  if (g.includes('蓝'))   return 'grade-badge text-sky-300';
  if (g.includes('绿'))   return 'grade-badge text-emerald-300';
  if (g.includes('白'))   return 'grade-badge text-slate-200';
  return 'text-dim/70';
}

/** 品级 → 物品/装备**名称**配色（同 gradeBadgeClass 的逐级华丽特效，但无品级/未知品级时回退为常规白色，避免名称发暗）。*/
export function gradeNameClass(grade?: string): string {
  const g = String(grade ?? '').trim();
  if (!g) return 'text-slate-100';
  const cls = gradeBadgeClass(g);
  return cls === 'text-dim/70' ? 'text-slate-100' : cls;
}

/** @deprecated 旧版灵石，仅用于 localStorage 迁移兜底 */
export interface SpiritStoneWallet { 下品: number; 中品: number; 上品: number; 极品: number; }

export interface CurrencyWallet {
  乐园币: number;
  灵魂钱币: number;
  技能点: number;
  黄金技能点: number;
}

/** 宝石部位限制：只能镶嵌在对应大类装备上（通用=任意装备）*/
export type GemSlotKind = '武器' | '防具' | '饰品' | '通用';

/** 已镶嵌进装备的宝石快照（镶嵌时从宝石物品烘焙；数值在获得宝石时即已确定，镶嵌只套用，不再重算）*/
export interface SocketedGem {
  gemId: string;     // 源宝石物品 id（仅追溯；宝石已从背包消耗）
  name: string;
  tier: string;      // 品级 gradeDesc
  slot: GemSlotKind; // 部位限制
  attr: string;      // 属性类型（力量/锋利度/破甲/灵魂伤害…）
  statText: string;  // 加成文本：低阶面板"力量+8" / 高阶"无视12%防御"——并入装备属性计算与展示
  high: boolean;     // 高阶宝石（传说级+，提供高阶战斗属性；展示更华丽）
  set?: string;      // 所属套装 key（gemSets.GEM_SETS）——跨已装备装备集齐同套装宝石激活套装加成
}

export interface InventoryItem {
  id: string;
  name: string;
  category: ItemCategory;
  gradeDesc: string;
  effect: string;
  quantity: number;
  equipped: boolean;
  equipSlot?: string;
  tags: string[];
  appearance?: string;
  notes?: string;
  acquisition?: string;   // 获得途径
  locked?: boolean;       // 锁定后不可删除
  archived?: boolean;     // 放入「不常用空间」：主列表隐藏，仅在不常用空间可见（纯收纳·不影响装备/数值/演化）
  // ── 固定条目模板（物品/装备生成必填，对齐生成卡格式）──
  origin?: string;        // 产地（如 黑铁纪元·废都）
  subType?: string;       // 类型细分（如 单手短刀/劈砍武器；category 是大类）
  combatStat?: string;    // 攻击力/防御力数值（如 15-28 / 防御 8-12）—— 装备类
  durability?: string;    // 耐久度（如 45/45）—— 装备类
  requirement?: string;   // 装备需求（如 力量10可发挥最大威力…）—— 装备类
  affix?: string;         // 词缀（如 [撕裂] …）—— 装备类
  score?: string;         // 评分（含品质区间说明，如 28（绿色装备区间11~30分…））
  intro?: string;         // 简介（flavor 文本）
  killCount?: string;     // 杀敌数量（仅武器类，随战斗累计）
  enhanceLevel?: number;  // 强化等级 0-16（装备强化系统，仅装备类；0/缺省=未强化）
  maxEnhanceLevel?: number;  // 历史最高强化等级（高水位）：词缀只在峰值刷新时按此生成；降级不降此值（降级只降属性，词缀不消失）
  affixLevel?: number;    // 已用 AI 结算过词缀的等级（持久化）；待结算 = floor(maxEnhanceLevel/3) > floor(affixLevel/3)，故退出重开仍能结算，结算成功才推进到峰值
  awakenLv?: number;      // 深渊觉醒阶数（觉醒系统升品级+加词缀，0/缺省=未觉醒）
  // ── 宝石/镶嵌系统（仅装备类）──
  sockets?: number;       // 镶嵌孔总数（缺省时按品级 defaultSocketsByGrade 派生；打孔石可增至 MAX_SOCKETS）
  gems?: SocketedGem[];   // 已镶嵌宝石（length ≤ socketsOf(item)）
  // ── 宝石物品专属（category==='宝石' 时）──
  gemSlot?: GemSlotKind;  // 该宝石可镶嵌的部位
  gemAttr?: string;       // 该宝石的属性类型
  gemSet?: string;        // 该宝石所属套装 key（gemSets.GEM_SETS）——集齐同套装宝石激活套装加成
  image?: string;         // 物品图片（上传的自定义图片 dataURL / 未来生图位）
  numeric?: Record<string, unknown>;  // 原始数值结构（rarityTier/grade/statLines…）；多由 NPC 物品转入时带过来，保留以便round-trip
  addedAt: number;
}

/* 预设条目（对应 JSON 里每个 rule / entry） */
export interface ItemPresetEntry {
  identifier: string;
  name: string;
  content: string;
  enabled: boolean;
  role: string;        // 'system' | 'user' | 'assistant'
  source?: string;     // 来自哪个 section，如 'entrySharedRules' / 'prompts.player'
}

export interface ItemPresetSettings {
  enabled: boolean;
  frequency: number;
  entries: ItemPresetEntry[];
  presetName: string;
  presetVersion?: number;
  auditEnabled?: boolean;   // 物品阶段后追加一次"对账纠错"调用（默认开）
}

// 「最近删除」回收站条目：被 AI 自动删除/消耗的物品，记下删除回合（满 3 回合自动彻底清除）+ 删除原因
export type DeletedItem = InventoryItem & {
  deletedTurn: number;
  deleteKind?: 'used' | 'broken';   // used=被使用/消耗殆尽 · broken=损坏/丢弃/失去
  deleteReason?: string;            // 一句话原因（AI 给的 reason，或前端按指令类型合成）
};

interface ItemState {
  items: InventoryItem[];
  currency: CurrencyWallet;
  recentlyDeleted: DeletedItem[];   // 最近被 AI 自动删除/消耗的物品（回收站），可恢复；进入后满 3 回合自动彻底清除
  itemTurn: number;                 // 当前回合数（回收站「3 回合自动清除」计时用）
  settings: ItemPresetSettings;

  // 独立 API 配置
  itemApi: ApiConfig;
  itemUseSharedApi: boolean;   // true = 复用正文生成 API
  itemAvailableModels: string[];
  itemModelsLoading: boolean;
  itemModelsError: string;

  addItem: (item: Omit<InventoryItem, 'id' | 'addedAt'> & { id?: string }) => void;
  normalizeGrades: () => number;   // 一次性迁移：把已存背包物品的复合品级收敛为单一档，返回收敛件数
  updateItem: (id: string, patch: Partial<InventoryItem>) => void;
  removeItem: (id: string) => void;
  consumeItem: (id: string, quantity: number) => void;
  binItem: (item: InventoryItem, info?: { kind?: 'used' | 'broken'; reason?: string }) => void;   // 把物品移入「最近删除」回收站并从背包移除（供 AI 销毁 / 消耗到 0 时调用）；info=删除原因
  restoreDeleted: (id: string) => void;          // 从「最近删除」恢复回背包
  clearRecentlyDeleted: () => void;              // 清空「最近删除」
  setItemTurn: (turn: number) => void;           // 更新回合数 + 清除已进入回收站满 3 回合的物品
  equipItem: (id: string, slot: string) => void;
  unequipItem: (id: string) => void;
  normalizeEquipSlots: () => void;   // 规范化所有已装备物品的槽位（修复历史非规范槽）
  clearBag: () => number;   // 清空背包（保留已装备 / 已锁定），返回清除数量
  dedupeByName: () => number;   // 合并背包内同名重复物品（防 AI 重复 createItem），返回合并掉的数量
  clearAll: () => void;

  adjustCurrency: (type: keyof CurrencyWallet, delta: number, reason?: string, silent?: boolean) => void;   // reason=增减缘由（进货币流水·walletLedger 展示）；silent=true 时不生成场外通报（正文<state>/世界结算驱动·AI 自知）
  setCurrency: (wallet: Partial<CurrencyWallet>) => void;

  setSettings: (patch: Partial<Omit<ItemPresetSettings, 'entries'>>) => void;
  setPresetEntries: (entries: ItemPresetEntry[], name: string, version?: number) => void;
  togglePresetEntry: (identifier: string) => void;
  updatePresetEntry: (identifier: string, patch: Partial<Pick<ItemPresetEntry, 'name' | 'content' | 'role'>>) => void;
  smartFilterEntries: () => number;   // 智能过滤，返回保留的条目数
  clearPreset: () => void;
  deleteDisabledEntries: () => number;

  setItemApi: (patch: Partial<ApiConfig>) => void;
  setItemUseSharedApi: (v: boolean) => void;
  fetchItemModels: () => Promise<void>;
}

function generateId(items: InventoryItem[]): string {
  const max = items.reduce((m, it) => {
    const n = parseInt(it.id.replace(/^I_B1_/, '')) || 0;
    return Math.max(m, n);
  }, 0);
  return `I_B1_${String(max + 1).padStart(2, '0')}`;
}

/* 可堆叠判定：消耗品/材料等同名累加；装备类（武器/防具/饰品/特殊/法宝）不堆叠——保留各自杀敌数/耐久/词缀等单件数据 */
const NO_STACK_CATS = new Set<string>(['武器', '防具', '饰品', '宝石', '特殊物品', '法宝']);
export const isStackableCat = (cat?: string) => !NO_STACK_CATS.has(cat ?? '');

/* ── 物品演化底层重构 · Phase 2「移除登记」──
 * 一切**经官方 store 方法**离开背包的物品（binItem 销毁/消耗、removeItem 转出、consumeItem 整件用尽）都在此登记 id。
 * 看门狗(itemWatchdog)对账时排除这些「已登记移除」——它只对"绕过所有 store 方法、凭空消失"的真·静默 bug 出手，
 * 从而既**杜绝静默丢失**、又**不误捞**交易/赌坊/赠予这类玩家主动且不可恢复的正常移除（避免回收复制刷物）。
 * 由 itemWatchdog 在每回合快照时清空、对账时读取（放 itemStore 这边，避免与 itemWatchdog 形成循环 import）。*/
const _accountedRemovals = new Set<string>();
export const markAccountedRemoval = (id?: string): void => { if (id) _accountedRemovals.add(id); };
export const clearAccountedRemovals = (): void => { _accountedRemovals.clear(); };
export const isAccountedRemoval = (id: string): boolean => _accountedRemovals.has(id);

/* ── 物品演化底层重构 · Phase 4-lite「物品流水审计」──
 * 记录每件物品的【离场事件】(销毁/消耗/转出/合并/看门狗捞回)：回合 + 操作 + 物品名 + 原因/去向。
 * 这是对「最近删除」的补全——它只收可恢复的删除，而这里把交易转出/堆叠合并/守护捞回这些不进回收站的也记下，
 * 让"东西到底去哪了"永远可查。内存环形缓冲(末 300 条·不进 localStorage·随诊断包导出)，纯增量、零行为改动。*/
export interface ItemLogEvent { turn: number; op: string; name: string; detail?: string; at: number }
const _itemLog: ItemLogEvent[] = [];
export function logItemEvent(turn: number, op: string, name: string, detail?: string): void {
  _itemLog.push({ turn, op, name, detail, at: Date.now() });
  if (_itemLog.length > 300) _itemLog.splice(0, _itemLog.length - 300);
}
export function getItemLog(): ItemLogEvent[] { return _itemLog.slice(); }
export function clearItemLog(): void { _itemLog.length = 0; }

/** 把一件物品格式化成【含逻辑关键字段】的注入行——供物品演化/对账阶段让 AI 看到**现状全貌**
 *  (词缀/攻防/评分/强化等级/杀敌/耐久/需求/镶嵌/锁定)，而不只是"名称·品级·效果"摘要，
 *  否则 updateItem 无法"看着旧词缀保留+新增"、对账无法核对评分↔品级。外观/简介等纯 flavor 略去省 token。 */
export function formatItemLine(it: any): string {
  let head = `[${it.id}] ${it.name}（${it.category}${it.gradeDesc ? '·' + it.gradeDesc : ''}）×${it.quantity ?? 1}`;
  if (it.equipped) head += `【已装备${it.equipSlot ? ':' + it.equipSlot : ''}】`;
  const enh = Number(it.enhanceLevel) || 0;
  if (enh > 0) head += ` +${enh}`;
  if (it.locked) head += ' 🔒锁定';
  const d: string[] = [];
  if (it.combatStat) d.push(`攻防:${asText(it.combatStat)}`);
  if (it.affix) d.push(`词缀:${asText(it.affix)}`);
  if (it.score) d.push(`评分:${asText(it.score)}`);
  if (it.killCount) d.push(`杀敌:${asText(it.killCount)}`);
  if (it.durability) d.push(`耐久:${asText(it.durability)}`);
  if (it.requirement) d.push(`需求:${asText(it.requirement)}`);
  const gemN = Array.isArray(it.gems) ? it.gems.length : 0;
  if (gemN > 0) d.push(`镶嵌:${gemN}颗`);
  if (it.effect) d.push(`效果:${asText(it.effect)}`);
  return head + (d.length ? '  ' + d.join(' | ') : '');
}
// 归一化：去标点/空格，并去掉「的/之」等填充虚词——让"劣质餐刀"与"劣质的餐刀"视为同名
const stackNorm = (x?: string) => (x ?? '').replace(/[\s·•・\-—_,，.。、|｜【】（）()的之]/g, '').toLowerCase();

export const useItems = create<ItemState>()(
  persist(
    (set): ItemState => ({
      items: [],
      currency: { 乐园币: 0, 灵魂钱币: 0, 技能点: 0, 黄金技能点: 0 },
      recentlyDeleted: [],
      itemTurn: 0,
      settings: {
        enabled: false,
        frequency: 1,
        entries: [],
        presetName: '',
        auditEnabled: true,
      },

      itemApi: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        modelId: 'gpt-4o',
        temperature: 0.8,
        maxTokens: 2048,
        topP: 1,
      },
      itemUseSharedApi: true,
      itemAvailableModels: [],
      itemModelsLoading: false,
      itemModelsError: '',

      addItem: (item) =>
        set((s) => {
          // 防御网：任何入库路径(扭蛋/赠予/导入/对账)都把复合品级收敛为单一档（与 stateParser 同护栏）
          if (item.gradeDesc) {
            const ng = normalizeGradeLabel(item.gradeDesc, { score: (item as any).score, grade: (item as any).numeric?.grade });
            if (ng.changed) item = { ...item, gradeDesc: ng.grade };
          }
          try { itemCreate(item.name, item.gradeDesc, Number(item.quantity ?? 1) || 1); } catch { /* 物品影子记账失败绝不阻断主流程 */ }
          const wantId = (item as { id?: string }).id;
          const wantEquipped = !!(item as { equipped?: boolean }).equipped;
          // ① 指定 id 且该 id 已存在：同名→原地更新（防重复生成、保留装备/锁定）；异名→落到堆叠/新增
          if (wantId) {
            const existing = s.items.find((it) => it.id === wantId);
            if (existing && (existing.name ?? '') === (item.name ?? '')) {
              // 原地更新保留用户/固有状态：装备槽、锁定，**及品级/评分/类别**——AI 重生成同一件绝不改稀有度、
              //   **也不改类别**（治用户报"演化把饰品莫名改成武器/特殊物品、还卡在武器槽"；类别决定装备槽，一乱改就槽位错乱）。
              //   前端强化/觉醒/宝石、以及玩家在物品编辑里手动改类别走 store.updateItem 不经此路，不受影响。仅原本缺的才采用新值。
              return { items: s.items.map((it) => it.id === wantId ? { ...it, ...item, id: wantId, equipped: it.equipped, equipSlot: it.equipSlot, locked: it.locked, category: it.category || item.category, gradeDesc: it.gradeDesc || item.gradeDesc, score: (it as any).score ?? (item as any).score } as InventoryItem : it) };
            }
            if (existing) console.warn(`[Item] id ${wantId} 已被「${existing.name}」占用，新物品「${item.name}」改用新 id 防覆盖`);
          }
          // ② 同名堆叠：可堆叠类（消耗品/材料…）、未装备 → 累加数量到已有同名同品质条目，不再新建行
          if (!wantEquipped && isStackableCat(item.category)) {
            const stack = s.items.find((it) =>
              !it.equipped && isStackableCat(it.category) &&
              stackNorm(it.name) === stackNorm(item.name) && stackNorm(it.gradeDesc) === stackNorm(item.gradeDesc));
            if (stack) {
              return { items: s.items.map((it) => it.id === stack.id ? { ...it, quantity: (it.quantity || 1) + (item.quantity || 1) } : it) };
            }
          }
          // ③ 新增（id 未占用则沿用，否则生成）
          const id = wantId && !s.items.some((it) => it.id === wantId) ? wantId : generateId(s.items);
          return { items: [...s.items, { ...item, id, addedAt: Date.now() } as InventoryItem] };
        }),

      normalizeGrades: () => {
        let n = 0;
        set((s) => {
          const items = s.items.map((it) => {
            if (!it.gradeDesc) return it;
            const ng = normalizeGradeLabel(it.gradeDesc, { score: (it as any).score, grade: (it as any).numeric?.grade });
            if (ng.changed) { n++; return { ...it, gradeDesc: ng.grade }; }
            return it;
          });
          return n ? { items } : s;   // 无变化返回原 state，避免无谓通知/写盘
        });
        return n;
      },

      updateItem: (id, patch) =>
        set((s) => ({ items: s.items.map((it) => it.id === id ? { ...it, ...patch } : it) })),

      removeItem: (id) => {
        markAccountedRemoval(id);   // 经官方方法移除（多为交易/赌坊/赠予等主动转出）→ 登记，看门狗不误捞
        set((s) => {
          const it = s.items.find((x) => x.id === id);
          if (it) {
            logItemEvent(s.itemTurn, '转出/移除', it.name, '经 removeItem（交易/赌坊/赠予等主动转出）');
            try { itemConsume(it.name, it.gradeDesc, Number(it.quantity ?? 1) || 1); } catch { /* 物品影子记账失败绝不阻断 */ }
          }
          return { items: s.items.filter((x) => x.id !== id) };
        });
      },

      consumeItem: (id, quantity) =>
        set((s) => {
          const it0 = s.items.find((x) => x.id === id);
          if (it0) { try { itemConsume(it0.name, it0.gradeDesc, quantity); } catch { /* 物品影子记账失败绝不阻断 */ } }
          return {
            items: s.items.flatMap((it) => {
              if (it.id !== id) return [it];
              const next = it.quantity - quantity;
              if (next > 0) return [{ ...it, quantity: next }];
              markAccountedRemoval(id);   // 整件用尽/卖尽 → 登记移除，看门狗不误捞
              logItemEvent(s.itemTurn, '消耗用尽', it.name, `consumeItem ×${quantity}`);
              return [];
            }),
          };
        }),

      // 移入「最近删除」回收站：从背包移除 + 记下删除回合与原因（解除装备态，恢复时不占槽）；表头去重保最近，封顶 100
      binItem: (item, info) => {
        markAccountedRemoval(item.id);   // 进最近删除也登记（与 binIds 双保险，防 recentlyDeleted 单回合溢出 100 时漏判）
        set((s) => {
          logItemEvent(s.itemTurn, info?.kind === 'used' ? '消耗/使用' : '销毁/丢失', item.name, info?.reason);
          return {
            items: s.items.filter((it) => it.id !== item.id),
            recentlyDeleted: [
              { ...item, equipped: false, equipSlot: undefined, deletedTurn: s.itemTurn, deleteKind: info?.kind, deleteReason: info?.reason },
              ...s.recentlyDeleted.filter((d) => d.id !== item.id),
            ].slice(0, 100),
          };
        });
      },

      restoreDeleted: (id) =>
        set((s) => {
          const d = s.recentlyDeleted.find((it) => it.id === id);
          if (!d) return s;
          const { deletedTurn, deleteKind, deleteReason, ...rest } = d;   // 剥掉回收站专属字段，恢复成干净的背包物品
          const item = (s.items.some((it) => it.id === rest.id) ? { ...rest, id: generateId(s.items) } : rest) as InventoryItem;   // id 撞了就换新
          return { items: [...s.items, item], recentlyDeleted: s.recentlyDeleted.filter((it) => it.id !== id) };
        }),

      clearRecentlyDeleted: () => set({ recentlyDeleted: [] }),

      // 每回合调用：刷新回合数 + 清除「已进入回收站满 3 回合」的物品（deletedTurn 起算第 3 回合彻底消失）
      setItemTurn: (turn) =>
        set((s) => ({ itemTurn: turn, recentlyDeleted: s.recentlyDeleted.filter((it) => turn - it.deletedTurn < 3) })),

      equipItem: (id, slot) =>
        set((s) => {
          const target = s.items.find((it) => it.id === id);
          const norm = normalizeEquipSlot(slot, target?.category);   // 规范化槽位（armor:armor→armor:upper 等），与装备面板一致
          return { items: s.items.map((it) => {
            if (it.id === id) return { ...it, equipped: true, equipSlot: norm };
            // 同槽位的旧装备先卸回背包，避免被新装备"覆盖"后看不见
            if (norm && it.equipped && it.equipSlot === norm) return { ...it, equipped: false, equipSlot: undefined };
            return it;
          }) };
        }),

      /* 把已装备物品的槽位全部规范化（修复历史存档里 armor:armor/armor:legs 等非规范槽导致装备面板不显示）*/
      normalizeEquipSlots: () =>
        set((s) => ({ items: s.items.map((it) => (it.equipped && it.equipSlot ? { ...it, equipSlot: normalizeEquipSlot(it.equipSlot, it.category) } : it)) })),

      unequipItem: (id) =>
        set((s) => ({ items: s.items.map((it) => it.id === id ? { ...it, equipped: false, equipSlot: undefined } : it) })),

      clearBag: () => {
        let removed = 0;
        set((s) => {
          const kept = s.items.filter((it) => it.equipped || it.locked || it.archived);   // 已装备/已锁定/不常用空间(収納) 都保留
          removed = s.items.length - kept.length;
          return { items: kept };
        });
        return removed;
      },

      dedupeByName: () => {
        let removed = 0;
        set((s) => {
          const norm = (x?: string) => (x ?? '').replace(/[\s·•・\-—_,，.。、|｜【】（）()的之]/g, '').trim().toLowerCase();
          const idxByKey = new Map<string, number>();
          const out: InventoryItem[] = [];
          for (const it of s.items) {
            // 【只合并真·重复的可堆叠物】：装备/法宝/唯一物是**独立实例**——同名也可能是两件不同的东西
            //  （一件穿着+一件备用、两次掉落、强化过的+没强化的），按名合并会**悄悄吞掉一件装备、且不进「最近删除」**
            //  （用户报「经常丢装备、就是消失、最近删除不显示」的根因）。故装备/已装备/已锁定一律不参与合并、原样保留；
            //  只有「可堆叠类(消耗品/材料…) + 未装备 + 未锁定」且**同名同品质**的才视为同一种、累加数量。
            const mergeable = !it.equipped && !it.locked && isStackableCat(it.category);
            const key = mergeable ? norm(it.name) + '|' + norm(it.gradeDesc) : '';
            const at = key ? idxByKey.get(key) : undefined;
            if (!key || at === undefined) {
              if (key) idxByKey.set(key, out.length);
              out.push(it);
              continue;
            }
            const a = out[at];
            out[at] = { ...a, quantity: (a.quantity || 1) + (it.quantity || 1) };   // 同一种可堆叠物 → 累加（与 addItem 堆叠口径一致）
            logItemEvent(s.itemTurn, '同名合并', it.name, `并入同名同品质条目（数量累加，未丢失）`);
            removed++;
          }
          return removed ? { items: out } : s;
        });
        return removed;
      },

      clearAll: () => set({ items: [], currency: { 乐园币: 0, 灵魂钱币: 0, 技能点: 0, 黄金技能点: 0 }, recentlyDeleted: [], itemTurn: 0 }),

      adjustCurrency: (type, delta, reason, silent) => {
        try { walletAdjust(String(type), delta, reason ? { reason } : undefined); } catch { /* 影子记账失败绝不阻断主流程 */ }
        set((s) => ({ currency: { ...s.currency, [type]: Math.max(0, s.currency[type] + delta) } }));
        // 场外货币变动 → 一次性通报（下回合正文的 <前置须知> 播报当前余额，防 OOC）；正文<state>/世界结算传 silent 跳过（AI 自知）
        if (!silent) { try { noteCurrencyChange(String(type), delta, reason); } catch { /* 通报失败绝不阻断 */ } }
      },

      setCurrency: (wallet) => {
        try { walletSet(wallet as Record<string, number>); } catch { /* 影子记账失败绝不阻断 */ }
        set((s) => ({ currency: { ...s.currency, ...wallet } }));
      },

      setSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      setPresetEntries: (entries, name, version) =>
        set((s) => ({ settings: { ...s.settings, entries, presetName: name, presetVersion: version } })),

      togglePresetEntry: (identifier) =>
        set((s) => ({
          settings: {
            ...s.settings,
            entries: s.settings.entries.map((e) =>
              e.identifier === identifier ? { ...e, enabled: !e.enabled } : e
            ),
          },
        })),

      updatePresetEntry: (identifier, patch) =>
        set((s) => ({
          settings: {
            ...s.settings,
            entries: s.settings.entries.map((e) =>
              e.identifier === identifier ? { ...e, ...patch } : e
            ),
          },
        })),

      smartFilterEntries: () => {
        // 精确匹配名称：只保留以下条目，其余全部禁用
        const KEEP_NAMES = new Set([
          '身份定义',
          'Standalone 物品装备固定条目模板',
          'Standalone 容器开启与一次性消耗强制自检',
          'Standalone 状态命令契约（SSOT）',
          'JSON语法铁则',
          '品阶显示规则',
          '词条稀有度',
          '品阶语义对应表',
          '物品ID规则',
          '背包物品列定义',
          'numeric.v1装备数值模板',
          '装备特性介绍表',
          '物价和金融系统',
          '物品格式规范',
          '物品与装备领域契约',
          '原著剧情指导使用边界',
          '场景信息',
          '本轮正文',
          '用户行为',
          '在场人物与物品清单',
          '物品创建规则',
          'Standalone 属性解析边界',
          'Standalone 功法属性语义规则',          // 旧名（保留兼容已导入预设）
          'Standalone 技能书属性语义规则',        // 新名（去修仙）
          'Standalone 领悟类技能分流',
          'Standalone 丹药堆叠单位',              // 旧名（保留兼容）
          'Standalone 消耗品堆叠单位',            // 新名（去修仙）
          'Standalone 物品分类 enum',
          'Standalone 丹药/消耗品命名边界',        // 旧名（保留兼容）
          'Standalone 消耗品命名边界',            // 新名（去修仙）
          'Standalone 杂物入库硬边界',
          '操作判定规则',
          '离场角色经历参考',
          '轻便多槽位强制结算',
          'Standalone 功法属性语义思维链',        // 旧名（保留兼容）
          'Standalone 技能书属性语义思维链',      // 新名（去修仙）
          '思考流程',
          '既有角色补全边界',
          '输出格式',
          'Standalone Item Task Outcome Context',
          'Standalone Item Spirit Stone Currency',
          'Standalone Item Structured Grade Render',
        ]);
        let kept = 0;
        useItems.setState((s) => ({
          settings: {
            ...s.settings,
            entries: s.settings.entries.map((e) => {
              const isKeep = KEEP_NAMES.has(e.name);
              if (isKeep) kept++;
              return { ...e, enabled: isKeep };
            }),
          },
        }));
        return kept;
      },

      clearPreset: () =>
        set((s) => ({ settings: { ...s.settings, entries: [], presetName: '', presetVersion: undefined } })),

      deleteDisabledEntries: () => {
        let removed = 0;
        set((s) => {
          const next = s.settings.entries.filter((e) => e.enabled);
          removed = s.settings.entries.length - next.length;
          return { settings: { ...s.settings, entries: next } };
        });
        return removed;
      },

      setItemApi: (patch) =>
        set((s) => ({ itemApi: { ...s.itemApi, ...patch } })),

      setItemUseSharedApi: (v) => set({ itemUseSharedApi: v }),

      fetchItemModels: async () => {
        // 动态读取当前有效 API（shared 时用 settingsStore 的 textApi）
        const s = useItems.getState();
        let api: ApiConfig;
        if (s.itemUseSharedApi) {
          const ss = useSettings.getState();
          api = ss.textUseSharedApi ? ss.api : ss.textApi;
        } else {
          api = s.itemApi;
        }
        if (!api.baseUrl || !api.apiKey) {
          set({ itemModelsError: '请先填写 API 地址和 Key' });
          return;
        }
        set({ itemModelsLoading: true, itemModelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', {
            headers: { Authorization: `Bearer ${api.apiKey}` },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const models = (json.data ?? json.models ?? [])
            .map((m: any) => m.id ?? m.name ?? '')
            .filter(Boolean)
            .sort();
          set({ itemAvailableModels: models, itemModelsLoading: false });
        } catch (e: any) {
          set({ itemModelsError: e.message ?? '请求失败', itemModelsLoading: false });
        }
      },
    }),
    {
      name: 'drpg-items',
      // 物品图(image)体积大，不写 localStorage（改存 IndexedDB）
      partialize: (s: any) => ({
        ...s,
        items: Array.isArray(s.items) ? s.items.map((it: any) => ({ ...it, image: undefined })) : s.items,
        // ★「最近删除」条目同样剥掉大体积 image（图在 IndexedDB·恢复时回填）+ 条目封顶——否则删掉带生图的装备会把
        //   drpg-items 撑爆 localStorage 配额、persist 静默失败 → 这次删除没落盘，刷新后「最近删除」就空了（用户报此 bug）。
        recentlyDeleted: Array.isArray(s.recentlyDeleted)
          ? s.recentlyDeleted.slice(-100).map((it: any) => ({ ...it, image: undefined }))
          : s.recentlyDeleted,
      }),
      // 迁移：旧版用 systemPrompt: string，新版改为 entries[]
      // merge 确保旧 localStorage 数据不会因为缺 entries 字段而崩溃
      merge: (persisted: any, current) => {
        const m: any = {
          ...current,
          ...persisted,
          settings: {
            ...current.settings,
            ...(persisted?.settings ?? {}),
            entries: Array.isArray(persisted?.settings?.entries)
              ? persisted.settings.entries
              : current.settings.entries,
            systemPrompt: undefined,
          },
          // 货币迁移：旧版 spiritStones → 新版 currency（直接用默认值，旧数据丢弃）
          currency: { ...current.currency, ...(persisted?.currency ?? {}) },
          // 旧版没有 itemApi 时用默认值
          itemApi: { ...current.itemApi, ...(persisted?.itemApi ?? {}) },
          itemUseSharedApi: persisted?.itemUseSharedApi ?? current.itemUseSharedApi,
          // 运行时状态不持久化
          itemAvailableModels: [],
          itemModelsLoading: false,
          itemModelsError: '',
        };
        // 物品 facade：读档时就把持久化里已有的重复 id 塌掉（rehydrate 必经此处·比 subscribe 时序可靠）
        try { if (Array.isArray(m.items)) m.items = commitItems(m.items, 'rehydrate').items; } catch { /* */ }
        return m;
      },
    }
  )
);

/* ── 物品 facade 闸门（Step 10·唯一规范化 chokepoint）──────────────────────────
   任何 items 变化（含外部 setState/撤销·所有内部 action）都会触发此 subscribe，经 itemCore.commitItems
   按 **id 键去重**（结构上根除"背包两条同 id 双计"）。只有真塌掉重复时才回写（避免无谓 re-render）。
   循环护栏 `_canonicalizing` + try 兜底（绝不阻断/崩）。这就是"itemStore.items 经 itemCore 权威闸门"的物品 facade。 */
let _canonicalizing = false;
useItems.subscribe((state, prev) => {
  if (_canonicalizing || state.items === prev.items) return;
  try {
    const { items, collapsed } = commitItems(state.items, 'facade');
    if (collapsed > 0) {
      _canonicalizing = true;
      useItems.setState({ items });
      _canonicalizing = false;
      console.warn(`[物品facade] 规范化塌掉重复 id ×${collapsed}（背包同 id 双计已结构性根除）`);
    }
  } catch (e) { _canonicalizing = false; console.warn('[物品facade] 规范化失败（忽略）:', e); }
});
// 注册后立即规范化一次：rehydrate（读档/刷新）在 create() 内同步发生、早于上面 subscribe 挂载，
// 故初始态里若已有重复 id（老存档）不会被 subscribe 捕获——这里补一刀兜住。
try {
  const { items, collapsed } = commitItems(useItems.getState().items, 'init');
  if (collapsed > 0) { useItems.setState({ items }); console.warn(`[物品facade] 初始规范化塌掉重复 id ×${collapsed}`); }
} catch { /* */ }

/* ── 从 JSON 构建有效 system prompt（仅 enabled 条目） ── */
export function buildItemSystemPrompt(entries: ItemPresetEntry[]): string {
  return entries
    .filter((e) => e.enabled)
    .map((e) => e.content)
    .join('\n\n');
}

/* ── 从 concurrent-evo preset JSON 中提取所有条目 ── */
/* ──────────────────────────────────────────────────────────────
   从 preset JSON 提取所有条目
   - entrySharedRules + prompts.* 全部提取
   - 物品相关条目默认启用，其他默认禁用
   - 用户可用「⚡ 智能筛选」进一步调整
────────────────────────────────────────────────────────────── */


export function extractItemPresetFromJson(
  raw: string
): { name: string; version?: number; entries: ItemPresetEntry[] } | null {
  try {
    const data = JSON.parse(raw);
    const name: string = data.name ?? '未命名预设';
    const version: number | undefined = data.version;
    const entries: ItemPresetEntry[] = [];

    function push(rule: any, source: string) {
      if (!rule.id || !rule.content) return;
      entries.push({
        identifier: rule.id,
        name:       rule.name ?? rule.id,
        content:    rule.content,
        enabled:    rule.enabled !== false,   // 全部默认启用，需要精简时用智能筛选
        role:       rule.role ?? 'system',
        source,
      });
    }

    // 1. entrySharedRules
    if (Array.isArray(data.entrySharedRules)) {
      for (const rule of data.entrySharedRules) push(rule, 'entrySharedRules');
    }

    // 2. prompts.* — 所有 section
    if (data.prompts && typeof data.prompts === 'object') {
      for (const [sectionKey, section] of Object.entries(data.prompts) as [string, any][]) {
        if (section && Array.isArray(section.rules)) {
          for (const rule of section.rules) push(rule, `prompts.${sectionKey}`);
        }
      }
    }

    if (entries.length === 0) return null;
    return { name, version, entries };
  } catch {
    return null;
  }
}
