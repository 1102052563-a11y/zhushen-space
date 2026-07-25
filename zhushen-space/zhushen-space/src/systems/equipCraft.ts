import { ITEM_GRADES, gradeToNum, splitAffixEntries, type InventoryItem } from '../store/itemStore';
import { isEnhanceable } from './enhanceEngine';
import { gradeMidPark, SOUL_TO_PARK } from './itemPricing';
import { targetScoreFor } from './equipAscend';

/* ════════════════════════════════════════════
   装备工艺 · 确定性引擎（强化所「🔨 工艺」页签，纯逻辑无 React）
   —— 与「⚒ 强化」的赌博式随机【正交并存】：强化赌等级，工艺改词条。

   三条内置工艺线（对标业界成熟设计，按本作术语重写）：
   ① 锻造潜力 forge   ：确定性上词缀，每次消耗【锻造潜力】，潜力耗尽即封盘（Last Epoch 口径）
   ② 精髓 essence     ：拆解装备把词缀存进【精髓图鉴】，再灌注到别的装备（D4 口径 + 本作「库房不删」铁律：
                        图鉴永久留存可反复查阅/复用，闸门改由潜力与品级门槛承担）
   ③ 腐化 corrupt     ：不消耗潜力的高风险重铸，大成/劣化/崩毁一次摇定、结果不可撤销、腐化后封死一切工艺（PoE 瓦尔口径）
   ④ 自定义 custom    ：玩家用提示词让 AI 自创工艺 —— AI 只填【受限参数空间】，
                        全部数值经 sanitizeProcess 夹取 + riskPricing 定价，越贪的工艺越贵越费潜力，平衡不可被提示词绕过。

   ⚠ 前端拍板一切数值（潜力/费用/品级变动/攻防增幅/结果摇号），AI 只写词缀与效果【文本】——同 equipAscend 范式。
   ⚠ 费用一律锚 itemPricing 的 GRADE_PARK_BAND（gradeMidPark），禁止自拍指数曲线（见 equipAscend 的套利黑洞注释）。
════════════════════════════════════════════ */

/* ── 一、锻造潜力 ───────────────────────────── */

/** 潜力上限 = BASE + 品级档 × PER_GRADE（品级越高、可锻造的余地越大）。
 *  品级进阶会抬高上限（已用量保留）→ 进阶因此额外获得新的锻造空间，两系统正向联动。 */
export const POT_BASE = 6;
export const POT_PER_GRADE = 2;

export function potentialMax(item: Pick<InventoryItem, 'gradeDesc'>): number {
  const g = Math.max(1, Math.min(ITEM_GRADES.length, gradeToNum(item.gradeDesc) || 1));
  return POT_BASE + g * POT_PER_GRADE;   // 白色 8 … 创世 36
}

/** 每件装备的工艺状态（存在 item.craft 上，随物品转移/分享/存档走）。 */
export interface EquipCraftState {
  potUsed?: number;      // 已消耗的锻造潜力
  corrupted?: boolean;   // 已腐化 —— 封死一切工艺（强化不受影响）
  bricked?: boolean;     // 腐化崩毁 —— 已成残骸
  history?: string[];    // 工艺履历（最近 12 条，展示 + 喂 AI 防重复）
}

export function craftStateOf(item?: Pick<InventoryItem, 'craft'> | null): EquipCraftState {
  return (item?.craft ?? {}) as EquipCraftState;
}
export function potentialLeft(item: Pick<InventoryItem, 'gradeDesc' | 'craft'>): number {
  return Math.max(0, potentialMax(item) - (craftStateOf(item).potUsed ?? 0));
}

/** 可做工艺：装备类 + 未腐化。潜力是否够由各工艺自己判。 */
export function isCraftable(item: Pick<InventoryItem, 'category' | 'craft'>): boolean {
  return isEnhanceable(item.category) && !craftStateOf(item).corrupted;
}

/* ── 二、工艺定义（内置 + 玩家自创共用一套结构）───── */

/** 单次工艺可能产生的结果。前端据此改装备；标 needsAi 的那几种要 AI 补写文本。 */
export type CraftOutcomeKind =
  | 'addAffix'      // +1 条新词缀
  | 'upgradeAffix'  // 现有词缀威力上调一档
  | 'rerollAffix'   // 重铸一条现有词缀（换成同强度的另一条）
  | 'removeAffix'   // 抹去一条现有词缀
  | 'gradeUp'       // 品级 +1 档
  | 'gradeDown'     // 品级 -1 档
  | 'combatUp'      // 攻防基础值上调
  | 'combatDown'    // 攻防基础值下调
  | 'nothing'       // 无事发生
  | 'brick';        // 崩毁：品级 -1 且永久锁死一切工艺

export const OUTCOME_LABEL: Record<CraftOutcomeKind, string> = {
  addAffix: '附着新词缀', upgradeAffix: '词缀升华', rerollAffix: '词缀重铸', removeAffix: '词缀剥落',
  gradeUp: '品级跃升', gradeDown: '品级跌落', combatUp: '锋芒增益', combatDown: '锋芒钝挫',
  nothing: '毫无变化', brick: '崩毁成残骸',
};
/** 需要 AI 补写词缀/效果文本的结果（其余纯前端算完即可）。 */
export const AI_OUTCOMES = new Set<CraftOutcomeKind>(['addAffix', 'upgradeAffix', 'rerollAffix']);

/** 结果价值分（riskPricing 用）：正=对玩家有利，负=不利。用于给自创工艺自动定价。 */
const OUTCOME_VALUE: Record<CraftOutcomeKind, number> = {
  gradeUp: 8, addAffix: 4, upgradeAffix: 3, combatUp: 2, rerollAffix: 0.5,
  nothing: 0, combatDown: -2, removeAffix: -3, gradeDown: -5, brick: -9,
};

export interface CraftOutcomeWeight { kind: CraftOutcomeKind; weight: number }

export interface CraftProcessDef {
  id: string;
  name: string;
  emoji: string;
  desc: string;              // 一句话说明（列表展示）
  flavor?: string;           // 世界观风味（展示 + 喂 AI 定调）
  builtin?: boolean;
  base: 'forge' | 'essence' | 'corrupt' | 'custom';   // 基型：决定走哪套结算与 UI
  potCost: number;           // 潜力消耗（essence 的提取端为 0）
  costRatio: number;         // 费用 = 该档公允价 × costRatio
  gradeMin?: number;         // 最低品级档要求（1~15）
  outcomes: CraftOutcomeWeight[];   // 结果权重表；长度 1 = 确定性工艺（走预览确认），>1 = 赌博工艺（即时结算）
  affixHint?: string;        // 词缀生成方向（喂 AI）
  author?: string;           // 自创工艺署名（工坊分享用）
  createdAt?: number;
}

/* ── 三、参数夹取（AI 自创工艺的护栏：任凭提示词怎么写，落地的数值都在这里被夹回合法区间）── */

export const POT_COST_MAX = 14;
export const COST_RATIO_MAX = 0.6;
const OUTCOME_KINDS = Object.keys(OUTCOME_LABEL) as CraftOutcomeKind[];

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : lo));
const txt = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** 结果表的期望价值（按权重归一）。>0 = 净得利工艺，越高越该贵。 */
export function expectedValue(outcomes: CraftOutcomeWeight[]): number {
  const tot = outcomes.reduce((s, o) => s + Math.max(0, o.weight), 0);
  if (tot <= 0) return 0;
  return outcomes.reduce((s, o) => s + (OUTCOME_VALUE[o.kind] ?? 0) * Math.max(0, o.weight), 0) / tot;
}

/** 风险定价：净得利越高 → 潜力消耗与费用同步抬升。
 *  这是自创工艺唯一的平衡阀 —— 玩家可以让 AI 写"必定品级跃升"的工艺，但它会贵到与直接买一件同档装备等价，
 *  因此提示词无法绕过经济，只能改变"花钱买什么"。*/
export function riskPricing(ev: number, potCost: number, costRatio: number): { potCost: number; costRatio: number } {
  const greed = Math.max(0, ev);            // 只对净得利加价，负期望（纯赌博）不罚
  const mul = 1 + greed * 0.55;             // ev=+8（必定品级跃升）→ ×5.4
  return {
    potCost: clamp(Math.round(potCost * mul), 0, POT_COST_MAX),
    costRatio: clamp(Math.round(costRatio * mul * 1000) / 1000, 0.01, COST_RATIO_MAX * 3),
  };
}

/** 把任意（可能来自 AI / 工坊下载 / 旧存档）的工艺对象夹成合法定义。绝不信任入参。 */
export function sanitizeProcess(raw: any, opts: { id?: string; author?: string } = {}): CraftProcessDef {
  const base: CraftProcessDef['base'] = ['forge', 'essence', 'corrupt', 'custom'].includes(raw?.base) ? raw.base : 'custom';
  let outcomes: CraftOutcomeWeight[] = (Array.isArray(raw?.outcomes) ? raw.outcomes : [])
    .map((o: any) => ({ kind: OUTCOME_KINDS.includes(o?.kind) ? o.kind : 'nothing', weight: clamp(Number(o?.weight), 0, 100) }))
    .filter((o: CraftOutcomeWeight) => o.weight > 0)
    .slice(0, 8);
  // 同类结果合并权重，避免 AI 用「addAffix ×5 条」堆出伪高概率
  const merged = new Map<CraftOutcomeKind, number>();
  for (const o of outcomes) merged.set(o.kind, (merged.get(o.kind) ?? 0) + o.weight);
  outcomes = [...merged].map(([kind, weight]) => ({ kind, weight }));
  if (!outcomes.length) outcomes = [{ kind: 'nothing', weight: 1 }];

  const priced = riskPricing(
    expectedValue(outcomes),
    clamp(Number(raw?.potCost), 0, POT_COST_MAX),
    clamp(Number(raw?.costRatio), 0.005, COST_RATIO_MAX),
  );
  return {
    id: opts.id || txt(raw?.id, 40) || `cp_${Math.random().toString(36).slice(2, 9)}`,
    name: txt(raw?.name, 20) || '无名工艺',
    emoji: [...txt(raw?.emoji, 4)][0] ?? '🔨',
    desc: txt(raw?.desc, 90) || '玩家自创的锻造工艺',
    flavor: txt(raw?.flavor, 260) || undefined,
    base,
    potCost: priced.potCost,
    costRatio: priced.costRatio,
    gradeMin: raw?.gradeMin == null ? undefined : clamp(Math.round(Number(raw.gradeMin)), 1, ITEM_GRADES.length),
    outcomes,
    affixHint: txt(raw?.affixHint, 160) || undefined,
    author: opts.author ?? (txt(raw?.author, 24) || undefined),
    createdAt: Number(raw?.createdAt) || Date.now(),
    builtin: false,
  };
}

/* ── 四、内置三工艺 ──────────────────────────── */

export const BUILTIN_PROCESSES: CraftProcessDef[] = [
  {
    id: 'forge', name: '潜能锻打', emoji: '🔨', builtin: true, base: 'forge',
    desc: '确定性附着一条新词缀，消耗锻造潜力；潜力耗尽即封盘，此后再不能锻打。',
    flavor: '强化所后堂的古老锻台。匠人循着装备本身残存的「可塑之机」下锤——机会有数，锤尽则形定，' +
      '再高明的手艺也无法在一件已经定形的兵刃上多添一分。',
    potCost: 5, costRatio: 0.08,
    outcomes: [{ kind: 'addAffix', weight: 1 }],   // 单一结果 = 确定性，走预览确认
    affixHint: '按装备主用途配一条全新的、与既有词缀不重复的词缀',
  },
  {
    id: 'essence', name: '精髓灌注', emoji: '🧪', builtin: true, base: 'essence',
    desc: '拆解装备可把它的一条词缀录入精髓图鉴（永久留存）；再消耗潜力把图鉴里的精髓灌注到另一件装备上。',
    flavor: '把一件兵器的「意」从铁里抽出来，封进琉璃管。器物会碎，意不会——' +
      '录入图鉴的精髓永远躺在那儿，随时可以再取一次，只看你还有没有可承载它的余地。',
    potCost: 4, costRatio: 0.06,
    outcomes: [{ kind: 'addAffix', weight: 1 }],
    affixHint: '按被灌注的精髓原义复现该词缀，并让措辞贴合新宿主装备',
  },
  {
    id: 'corrupt', name: '虚空腐蚀', emoji: '☠', builtin: true, base: 'corrupt',
    desc: '不耗潜力的高风险重铸：可能跃升品级或大幅强化，也可能剥落词缀甚至崩毁。一次摇定、不可撤销，腐蚀后封死一切工艺。',
    flavor: '把装备浸进虚空裂隙渗出的漆黑液体。它会改写器物的命理——变强、变废，或者当场碎成一堆认不出的残渣。' +
      '被虚空碰过的东西，此后任何工艺都吃不进去了。',
    potCost: 0, costRatio: 0.22, gradeMin: 3,
    outcomes: [
      { kind: 'gradeUp', weight: 6 },
      { kind: 'upgradeAffix', weight: 14 },
      { kind: 'addAffix', weight: 10 },
      { kind: 'combatUp', weight: 12 },
      { kind: 'nothing', weight: 22 },
      { kind: 'combatDown', weight: 12 },
      { kind: 'removeAffix', weight: 14 },
      { kind: 'brick', weight: 10 },
    ],
    affixHint: '词缀要带虚空侵蚀的气质：强大而略带代价或不祥',
  },
];

export function isPreviewMode(p: CraftProcessDef): boolean {
  return p.outcomes.length <= 1;   // 单一结果 = 确定性 → 先预览后确认；多结果 = 赌博 → 即时结算
}

/* ── 五、精髓图鉴 ───────────────────────────── */

export interface EssenceEntry {
  id: string;
  text: string;        // 词缀原文（「【名】：说明」）
  name: string;        // 词缀名（去掉【】，展示/去重用）
  fromItem: string;    // 来源装备名
  fromGrade: string;   // 来源装备品级（灌注门槛：不得灌进低太多档的装备）
  gradeNum: number;
  at: number;
}

/** 从词缀原文抽名字（「【裂空】：…」→「裂空」；无【】则取前 8 字）。 */
export function affixName(text: string): string {
  const m = String(text).match(/^\s*[【\[]([^】\]]{1,20})[】\]]/);
  return (m ? m[1] : String(text).split(/[:：]/)[0] ?? '').trim().slice(0, 20) || String(text).trim().slice(0, 8);
}

/** 精髓的来源品级档（旧存档缺 gradeNum 时从 fromGrade 文本回推）。 */
export function gradeNumOfEssence(e: Partial<EssenceEntry>): number {
  const n = Number(e?.gradeNum);
  if (Number.isFinite(n) && n >= 1) return Math.min(ITEM_GRADES.length, Math.round(n));
  return Math.max(1, gradeToNum(e?.fromGrade) || 1);
}

/** 灌注门槛：精髓来源品级不得高于目标装备 GRADE_GAP 档以上（防低阶装备白嫖顶阶词缀）。 */
export const ESSENCE_GRADE_GAP = 2;
export function canInfuse(essence: Pick<EssenceEntry, 'gradeNum'>, target: Pick<InventoryItem, 'gradeDesc'>): boolean {
  return essence.gradeNum - (gradeToNum(target.gradeDesc) || 1) <= ESSENCE_GRADE_GAP;
}

/* ── 六、费用 ───────────────────────────────── */

/** 工艺费用（乐园币）= 该档装备公允价中位 × costRatio × 分类系数（gradeMidPark 已含分类）。 */
export function craftCost(p: CraftProcessDef, item: Pick<InventoryItem, 'gradeDesc' | 'category'>): number {
  const g = Math.max(1, Math.min(ITEM_GRADES.length, gradeToNum(item.gradeDesc) || 1));
  return Math.max(50, Math.round(gradeMidPark(g, item.category) * p.costRatio));
}

/** 付款方案：优先乐园币，缺口按 1:SOUL_TO_PARK 用魂币补，找零退回。钱不够返回 null。（同 equipAscend.planAscendPayment 口径）*/
export function planCraftPayment(cost: number, wallet: { park: number; soul: number }): { parkDelta: number; soulDelta: number } | null {
  const need = Math.max(0, Math.round(cost));
  const park = Math.max(0, Math.floor(wallet.park || 0));
  const soul = Math.max(0, Math.floor(wallet.soul || 0));
  if (park >= need) return { parkDelta: -need, soulDelta: 0 };
  const soulNeed = Math.ceil((need - park) / SOUL_TO_PARK);
  if (soulNeed > soul) return null;
  const change = soulNeed * SOUL_TO_PARK - (need - park);
  return { parkDelta: change - park, soulDelta: -soulNeed };
}

/* ── 七、可行性判定 ─────────────────────────── */

export interface CraftFeasibility { ok: boolean; reason?: string }

export function canCraft(item: InventoryItem, p: CraftProcessDef): CraftFeasibility {
  if (!isEnhanceable(item.category)) return { ok: false, reason: '只有装备类（武器/防具/饰品/法宝/特殊物品）可做工艺' };
  const st = craftStateOf(item);
  if (st.corrupted) return { ok: false, reason: st.bricked ? '已崩毁成残骸，无法再施加任何工艺' : '已被虚空腐蚀，无法再施加任何工艺' };
  const g = gradeToNum(item.gradeDesc) || 1;
  if (p.gradeMin && g < p.gradeMin) return { ok: false, reason: `本工艺要求 ${ITEM_GRADES[p.gradeMin - 1]} 及以上品级` };
  if (p.potCost > potentialLeft(item)) {
    return { ok: false, reason: `锻造潜力不足（需 ${p.potCost}，剩 ${potentialLeft(item)}）—— 这件装备已锻打到极限` };
  }
  // 需要"现有词缀"才成立的结果：若装备一条词缀都没有，且工艺只可能产出这类结果 → 不可做
  const need = new Set<CraftOutcomeKind>(['upgradeAffix', 'rerollAffix', 'removeAffix']);
  if (!splitAffixEntries(item.affix).length && p.outcomes.every((o) => need.has(o.kind))) {
    return { ok: false, reason: '这件装备还没有任何词缀，本工艺无从下手' };
  }
  return { ok: true };
}

/* ── 八、结算 ───────────────────────────────── */

export interface CraftResolution {
  outcome: CraftOutcomeKind;
  potCost: number;
  cost: number;
  affixIndex?: number;       // 被作用的现有词缀下标（upgrade/reroll/remove）
  affixTarget?: string;      // 该词缀原文（喂 AI）
  gradeFrom?: string;
  gradeTo?: string;
  gradeToNum?: number;
  combatPct?: number;        // 攻防增减百分比（combatUp/Down）
  needsAi: boolean;
}

/** 按权重摇一个结果（rand 可注入，便于单测）。 */
export function rollOutcome(outcomes: CraftOutcomeWeight[], rand: () => number = Math.random): CraftOutcomeKind {
  const tot = outcomes.reduce((s, o) => s + Math.max(0, o.weight), 0);
  if (tot <= 0) return 'nothing';
  let r = rand() * tot;
  for (const o of outcomes) { r -= Math.max(0, o.weight); if (r < 0) return o.kind; }
  return outcomes[outcomes.length - 1].kind;
}

/** 品级 ±1 档（越界则退化为 nothing 的等价：返回 null）。 */
function shiftGrade(gradeDesc: string | undefined, dir: 1 | -1): { from: string; to: string; toNum: number } | null {
  const n = gradeToNum(gradeDesc) || 0;
  const to = n + dir;
  if (n < 1 || to < 1 || to > ITEM_GRADES.length) return null;
  return { from: ITEM_GRADES[n - 1], to: ITEM_GRADES[to - 1], toNum: to };
}

/** 攻防增减幅度（前端定，随品级档轻微上浮）。 */
const COMBAT_STEP = 0.12;

/**
 * 单次工艺结算：拍定 outcome + 全部数值。**不改任何状态**，调用方负责扣费/落库。
 * 词缀文本由调用方在 needsAi 时另找 AI 生成。
 */
export function resolveCraft(
  item: InventoryItem,
  p: CraftProcessDef,
  opts: { rand?: () => number; forcedOutcome?: CraftOutcomeKind } = {},
): CraftResolution {
  const rand = opts.rand ?? Math.random;
  const affixes = splitAffixEntries(item.affix);
  let outcome = opts.forcedOutcome ?? rollOutcome(p.outcomes, rand);

  // 结果与装备现状不符时的退化（没有词缀却摇到"改词缀" → 改判为加词缀 / 无事）
  if ((outcome === 'upgradeAffix' || outcome === 'rerollAffix' || outcome === 'removeAffix') && !affixes.length) {
    outcome = outcome === 'removeAffix' ? 'nothing' : 'addAffix';
  }
  const res: CraftResolution = {
    outcome,
    potCost: p.potCost,
    cost: craftCost(p, item),
    needsAi: AI_OUTCOMES.has(outcome),
  };
  if (outcome === 'upgradeAffix' || outcome === 'rerollAffix' || outcome === 'removeAffix') {
    res.affixIndex = Math.floor(rand() * affixes.length);
    res.affixTarget = affixes[res.affixIndex];
  }
  if (outcome === 'gradeUp' || outcome === 'brick' || outcome === 'gradeDown') {
    const g = shiftGrade(item.gradeDesc, outcome === 'gradeUp' ? 1 : -1);
    if (g) { res.gradeFrom = g.from; res.gradeTo = g.to; res.gradeToNum = g.toNum; }
    else if (outcome === 'gradeUp' || outcome === 'gradeDown') { res.outcome = 'nothing'; res.needsAi = false; }
    // brick 即便品级已到底（无法再降）仍然成立 —— 崩毁的核心是锁死，不是降档
  }
  if (outcome === 'combatUp' || outcome === 'combatDown') {
    const g = Math.max(1, gradeToNum(item.gradeDesc) || 1);
    const pct = Math.round((COMBAT_STEP + g * 0.004) * 100);
    res.combatPct = outcome === 'combatUp' ? pct : -pct;
    if (!/\d/.test(String(item.combatStat ?? ''))) { res.outcome = 'nothing'; res.combatPct = undefined; }   // 没有可缩放的攻防数值 → 无事
  }
  return res;
}

/** 把 combatStat 里的所有数字按百分比缩放（存的是 +0 基础值，同 enhanceEngine.enhancedCombat 口径）。 */
export function scaleCombat(combatStat: string | undefined, pct: number): string | undefined {
  const s = String(combatStat ?? '').trim();
  if (!s || !/\d/.test(s)) return combatStat;
  const f = 1 + pct / 100;
  return s.replace(/\d+/g, (n) => String(Math.max(1, Math.round(parseInt(n, 10) * f))));
}

/** 替换/删除词缀列表里的第 i 条，返回重新拼好的 affix 串（多条用换行分隔，同 splitAffixEntries 的读法）。 */
export function spliceAffix(affix: unknown, index: number, replacement: string | null): string {
  const list = splitAffixEntries(affix);
  if (index < 0 || index >= list.length) return replacement ? [...list, replacement].join('\n') : list.join('\n');
  const next = replacement === null ? list.filter((_, i) => i !== index) : list.map((a, i) => (i === index ? replacement : a));
  return next.join('\n');
}

/** 工艺结果 → 落库补丁（不含 AI 文本；调用方把 AI 写好的词缀经 affixPatch 合进来）。
 *  返回 undefined 表示这次工艺不改任何字段（nothing）。 */
export function craftPatch(
  item: InventoryItem,
  res: CraftResolution,
  aiAffix?: string,
): Partial<InventoryItem> {
  const st = craftStateOf(item);
  const patch: Partial<InventoryItem> = {};
  const nextState: EquipCraftState = { ...st, potUsed: (st.potUsed ?? 0) + res.potCost };

  switch (res.outcome) {
    case 'addAffix':
      if (aiAffix) patch.affix = [...splitAffixEntries(item.affix), aiAffix].join('\n');
      break;
    case 'upgradeAffix':
    case 'rerollAffix':
      if (aiAffix && res.affixIndex != null) patch.affix = spliceAffix(item.affix, res.affixIndex, aiAffix);
      break;
    case 'removeAffix':
      if (res.affixIndex != null) patch.affix = spliceAffix(item.affix, res.affixIndex, null);
      break;
    case 'combatUp':
    case 'combatDown':
      if (res.combatPct) patch.combatStat = scaleCombat(item.combatStat, res.combatPct);
      break;
    case 'gradeUp':
    case 'gradeDown':
      if (res.gradeTo && res.gradeToNum) {
        patch.gradeDesc = res.gradeTo;
        patch.score = String(targetScoreFor(res.gradeToNum));   // 评分前端写死落新档区间，防 normalizeGrades 钳回
        patch.numeric = { ...(item.numeric ?? {}), grade: res.gradeToNum };
      }
      break;
    case 'brick':
      nextState.corrupted = true;
      nextState.bricked = true;
      if (res.gradeTo && res.gradeToNum) {
        patch.gradeDesc = res.gradeTo;
        patch.score = String(targetScoreFor(res.gradeToNum));
        patch.numeric = { ...(item.numeric ?? {}), grade: res.gradeToNum };
      }
      break;
    default:
      break;
  }
  patch.craft = nextState;
  return patch;
}

/** 一次工艺的完整结果（确定性工艺=待确认预览；赌博工艺=已落定的战报）。 */
export interface CraftPreview {
  itemId: string;
  itemName: string;
  processId: string;
  processName: string;
  processEmoji: string;
  res: CraftResolution;
  aiAffix?: string;      // AI 写的那一条词缀（needsAi 时）
  notice?: string;       // AI 的正文通报
  essenceId?: string;    // 精髓灌注消耗的图鉴条目
  instant: boolean;      // true = 赌博工艺，已即时扣费落库，无需确认
}

/** 履历行（写进 craft.history，最近 12 条）。 */
export function historyLine(p: CraftProcessDef, res: CraftResolution): string {
  const bits = [`${p.emoji}${p.name}`, OUTCOME_LABEL[res.outcome]];
  if (res.gradeFrom && res.gradeTo) bits.push(`${res.gradeFrom}→${res.gradeTo}`);
  if (res.combatPct) bits.push(`攻防${res.combatPct > 0 ? '+' : ''}${res.combatPct}%`);
  if (res.potCost) bits.push(`潜力-${res.potCost}`);
  return bits.join('·');
}

export function pushHistory(st: EquipCraftState, line: string): string[] {
  return [line, ...(st.history ?? [])].slice(0, 12);
}
