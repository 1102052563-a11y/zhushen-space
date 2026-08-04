/*
  四维声誉（v5.6 世界引擎「声誉系统」的轮回乐园实装）
  ────────────────────────────────────────────────────────
  前端此前只有 `favorToPlayer`（势力 −100~100）和 NPC 四轴态度（信任/尊重/情欲/沉沦）——
  **全是"某人／某势力对主角"的私人关系**，缺一层「社会性名声」。四维声誉补的正是这个：
  它是**公共的**，能解释"为什么一个素不相识的 NPC 见到主角是这个态度"。

      官方评价 / 民间口碑 / 暗域地位 / 业界声望   各 6 级，独立升降、互不冲销

  ★ 观察者按所属圈子读**对应维度**：江湖平民看民间、官府权贵看官方、黑道看暗域、同行看业界。
  ★ **可见性前提**（本实装的硬闸门）：无人知晓的隐秘行为**不影响**四维，只影响个人恩怨。
    这一条与 NPC_DECENTER_RULE 的"配额例外"是同一个口径——前端在解析指令时就拦，不靠 AI 自觉。

  轮回乐园特化（见 docs/WORLD_ENGINE_LUNHUI_ADAPT.md §4）：
  · 作用域 = **`world`**：任务世界的名声离世即失效，折算成一句 `WorldSummary.继承要点.主角名声`
  · 与**乐园声望**（systems/paradiseFame·`paradise` 作用域·永久）分层，两者互不相干：
    土著只看四维，契约者只看乐园声望。混起来就破了 NATIVE_UNAWARE_RULE。
*/

/** 六级（低→高），四个维度通用 */
export const REPUTE_LEVELS = ['天怒人怨', '声名狼藉', '默默无闻', '小有名气', '受人尊敬', '万众敬仰'] as const;
export type ReputeLevel = typeof REPUTE_LEVELS[number];

export const REPUTE_DIMS = ['official', 'folk', 'shadow', 'trade'] as const;
export type ReputeDim = typeof REPUTE_DIMS[number];

export const DIM_LABEL: Record<ReputeDim, string> = {
  official: '官方评价', folk: '民间口碑', shadow: '暗域地位', trade: '业界声望',
};

/** 默认「默默无闻」= index 2（不是 0——刚到一个世界是无名，不是天怒人怨） */
export const DEFAULT_LEVEL = 2;

export type Repute = Record<ReputeDim, number>;

export function defaultRepute(): Repute {
  return { official: DEFAULT_LEVEL, folk: DEFAULT_LEVEL, shadow: DEFAULT_LEVEL, trade: DEFAULT_LEVEL };
}

export function levelName(i: number): ReputeLevel {
  return REPUTE_LEVELS[Math.max(0, Math.min(REPUTE_LEVELS.length - 1, Math.round(i)))];
}

/** 归一 AI 写的等级串（容忍后缀），认不出返回 null（=不改） */
export function normLevel(raw?: string): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const i = REPUTE_LEVELS.findIndex((lv) => s.includes(lv));
  if (i >= 0) return i;
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, Math.min(5, Math.round(n))) : null;
}

/** 归一维度名（中英都认） */
export function normDim(raw?: string): ReputeDim | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('官') || s === 'official') return 'official';
  if (s.includes('民') || s === 'folk') return 'folk';
  if (s.includes('暗') || s.includes('地下') || s === 'shadow') return 'shadow';
  if (s.includes('业') || s.includes('同行') || s === 'trade') return 'trade';
  return null;
}

/* ── 可见性闸门（本实装的核心护栏）───────────────────────── */

export type Visibility = 'witnessed' | 'evidence' | 'rumored' | 'secret' | 'unknown';

/** 从 AI 给的 witness 串判定可见性；认不出一律当 unknown（=拦） */
export function normVisibility(raw?: string): Visibility {
  const s = (raw ?? '').trim();
  if (!s) return 'unknown';
  if (/目击|亲眼|众目|当众|围观|witness/i.test(s)) return 'witnessed';
  if (/物证|证据|留下|痕迹|文书|evidence/i.test(s)) return 'evidence';
  if (/传闻|流言|风声|传开|人尽皆知|议论|rumor/i.test(s)) return 'rumored';   // ⚠ 用「传开」而非「已传开」——"已在城中传开"这类自然写法也要认
  if (/无人知晓|隐秘|暗中|没人看见|secret/i.test(s)) return 'secret';
  return 'unknown';
}

/** 该次变动能否影响公共声誉。**无人知晓 / 说不清来源 → 不能**（只影响个人恩怨）。 */
export function canAffectRepute(v: Visibility): boolean {
  return v === 'witnessed' || v === 'evidence' || v === 'rumored';
}

/** 单次行为最多同时影响 3 个维度（卡里的硬约束，前端来数） */
export const MAX_DIMS_PER_ACT = 3;

export interface ReputeChange {
  dim: ReputeDim;
  delta: number;
}

export interface ApplyResult {
  next: Repute;
  applied: ReputeChange[];
  rejected: { dim: ReputeDim; reason: string }[];
}

/**
 * 应用一批声誉变动，带三道确定性护栏：
 *   ① 可见性：不可见 → 整批拒绝
 *   ② 维度数：超过 3 个 → 只取绝对值最大的 3 个
 *   ③ 跨级限速：单次最多动 **1 档**，除非 `collapse=true`（背叛/被揭穿/恶劣罪行等崩塌事件）
 * 纯函数：不读不写 store，便于单测。
 */
export function applyRepute(
  cur: Repute,
  changes: ReputeChange[],
  opts: { visibility: Visibility; collapse?: boolean } = { visibility: 'unknown' },
): ApplyResult {
  const next: Repute = { ...cur };
  const applied: ReputeChange[] = [];
  const rejected: { dim: ReputeDim; reason: string }[] = [];

  if (!canAffectRepute(opts.visibility)) {
    return { next, applied, rejected: changes.map((c) => ({ dim: c.dim, reason: '无人知晓的行为不影响公共声誉' })) };
  }

  const sorted = [...changes].filter((c) => c.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const take = sorted.slice(0, MAX_DIMS_PER_ACT);
  for (const c of sorted.slice(MAX_DIMS_PER_ACT)) rejected.push({ dim: c.dim, reason: `单次行为最多影响 ${MAX_DIMS_PER_ACT} 个维度` });

  for (const c of take) {
    const cap = opts.collapse ? Infinity : 1;   // 非崩塌事件：一次一档
    const step = Math.sign(c.delta) * Math.min(Math.abs(c.delta), cap);
    const before = next[c.dim];
    next[c.dim] = Math.max(0, Math.min(REPUTE_LEVELS.length - 1, before + step));
    if (next[c.dim] !== before) applied.push({ dim: c.dim, delta: next[c.dim] - before });
    else rejected.push({ dim: c.dim, reason: '已在该维度的上/下限' });
  }
  return { next, applied, rejected };
}

/* ── 观察者视角 ────────────────────────────────────────────── */

/** NPC 身份/所属 → 他看哪个维度。认不出默认看民间（绝大多数人是普通人）。 */
export function dimForObserver(identity?: string): ReputeDim {
  const s = (identity ?? '');
  if (/官|吏|衙|捕|军|将|王|侯|贵族|朝廷|城主|领主/.test(s)) return 'official';
  if (/匪|盗|贼|帮|黑|杀手|走私|地下|暗/.test(s)) return 'shadow';
  if (/商|匠|行会|同行|工坊|掌柜|医|学者|术士/.test(s)) return 'trade';
  return 'folk';
}

/** 该 NPC 眼中主角的名声档（供建档基线 / 注入用） */
export function reputeSeenBy(rep: Repute, identity?: string): { dim: ReputeDim; level: number; name: ReputeLevel } {
  const dim = dimForObserver(identity);
  const level = rep[dim] ?? DEFAULT_LEVEL;
  return { dim, level, name: levelName(level) };
}

/* ── 复合效应（确定性触发器）──────────────────────────────── */

export interface ReputeCombo { key: string; label: string; hint: string }

/** 组合达标 → 返回可供任务/事件系统消费的触发器。纯判定，不产生副作用。 */
export function checkCombos(rep: Repute): ReputeCombo[] {
  const out: ReputeCombo[] = [];
  const hi = (d: ReputeDim) => (rep[d] ?? DEFAULT_LEVEL) >= 4;   // 受人尊敬 以上
  const bottom = (d: ReputeDim) => (rep[d] ?? DEFAULT_LEVEL) <= 0;
  if (hi('folk') && hi('official')) out.push({ key: 'court', label: '庙堂之高', hint: '官民双高 → 可能被招安、封赏或延请出仕' });
  if (hi('trade') && hi('folk')) out.push({ key: 'arbiter', label: '民望商途', hint: '业界与民间双高 → 被推为区域仲裁者／行业地标' });
  if (hi('shadow') && hi('trade')) out.push({ key: 'bothways', label: '黑白通吃', hint: '暗域与业界双高 → 双线人脉，消息与门路都好使' });
  if (hi('official') && hi('shadow')) out.push({ key: 'twoface', label: '双面身份', hint: '官方与暗域双高 → 暴露风险随时间累积，随时可能被两边同时清算' });
  for (const d of REPUTE_DIMS) {
    if (bottom(d)) out.push({ key: `hunted-${d}`, label: `${DIM_LABEL[d]}·天怒人怨`, hint: `该圈子内出现通缉／追杀` });
  }
  return out;
}

/* ── 序列化 ────────────────────────────────────────────────── */

export function formatRepute(rep: Repute): string {
  return REPUTE_DIMS.map((d) => `${DIM_LABEL[d]}:${levelName(rep[d] ?? DEFAULT_LEVEL)}`).join(' | ');
}

/** 注入正文：四维 + 已触发的复合效应。全是默认档（从没动过）→ 不出块，省预算。 */
export function buildReputeInjection(rep: Repute, worldName: string): { role: 'system'; content: string }[] {
  const touched = REPUTE_DIMS.some((d) => (rep[d] ?? DEFAULT_LEVEL) !== DEFAULT_LEVEL);
  if (!touched) return [];
  const combos = checkCombos(rep);
  const comboLine = combos.length ? `\n· 复合效应：${combos.map((c) => `${c.label}（${c.hint}）`).join('；')}` : '';
  return [{
    role: 'system' as const,
    content: `<本世界名声>（主角在${worldName || '本世界'}的**公共**名声·四维独立：不同圈子的人看不同维度——`
      + `江湖平民看民间、官府权贵看官方、黑道看暗域、同行看业界。陌生 NPC 的初始态度据此定，`
      + `**但这只是社会评价，不等于某个人对主角的私人好感**）\n· ${formatRepute(rep)}${comboLine}\n</本世界名声>`,
  }];
}

/** 离世折算成一句话 → 写进 WorldSummary.继承要点.主角名声 */
export function summarizeRepute(rep: Repute): string {
  const notable = REPUTE_DIMS
    .filter((d) => (rep[d] ?? DEFAULT_LEVEL) !== DEFAULT_LEVEL)
    .map((d) => `${DIM_LABEL[d]}${levelName(rep[d])}`);
  return notable.length ? notable.join('、') : '默默无闻，未在此世留下名声';
}
