/*
  势力外交八级 + 事件链闸门（v5.6 世界引擎「团体动态·外交关系」的轮回乐园实装）
  ────────────────────────────────────────────────────────────────────────────
  前端此前 `FactionRecord.relations` 是自由文本 `"F2:敌对;F3:同盟"`——AI 每回合想改就改，
  上一轮血盟下一轮世仇，关系毫无重量。这套给它加**结构 + 闸门**：

      血盟 > 盟友 > 友好 > 中立 > 冷淡 > 紧张 > 敌对 > 世仇     （8→1）

  ★ **闸门**：跨级变动必须先有对应事件链推进至终局，否则前端拒绝（照 npcGrowthGuard 的做法）。
    例外直降：核心人物被杀 / 重大背叛 / 公开宣战 —— 这三种可不经事件链直接跨级降。

  轮回乐园特化（见 docs/WORLD_ENGINE_LUNHUI_ADAPT.md §4）：
  · 事件链**压到 3 阶段**（起手 → 推进 → 终局）。卡里是 5 阶段（议婚→聘礼→大婚筹备→大婚→蜜月期），
    一个任务世界几十回合根本走不完，走不完就等于这套闸门形同虚设。
  · 离世时未走完的链**按已完成阶段比例强制判定**（见 `forceSettle`），不留悬案。
  · 玩家杠杆（调解/挑拨/代行）才是重点——这是主角能对世界格局施加影响的可玩动作。

  纯函数：不读不写 store，事件链本体挂在 `WorldEvent.chain` 上（`chainId` 外键）。
*/

/** 8→1（高→低）。数组下标 0 = 世仇(1级)，7 = 血盟(8级)。 */
export const DIPLO_LEVELS = ['世仇', '敌对', '紧张', '冷淡', '中立', '友好', '盟友', '血盟'] as const;
export type DiploLevel = typeof DIPLO_LEVELS[number];

/** 默认起点：中立 */
export const DEFAULT_DIPLO = 4;

export function diploIndex(name?: string): number {
  const i = DIPLO_LEVELS.indexOf((name ?? '').trim() as DiploLevel);
  return i < 0 ? DEFAULT_DIPLO : i;
}
export function diploName(i: number): DiploLevel {
  return DIPLO_LEVELS[Math.max(0, Math.min(DIPLO_LEVELS.length - 1, Math.round(i)))];
}
/** 归一 AI 写的关系串（容忍「同盟」「敌视」等近义写法），认不出返回 null（=不改） */
export function normDiplo(raw?: string): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const exact = DIPLO_LEVELS.findIndex((lv) => s.includes(lv));
  if (exact >= 0) return exact;
  if (/同盟|结盟/.test(s)) return diploIndex('盟友');
  if (/敌视|仇视|宣战/.test(s)) return diploIndex('敌对');
  if (/交好|亲善/.test(s)) return diploIndex('友好');
  if (/疏远|冷落/.test(s)) return diploIndex('冷淡');
  return null;
}

/* ── 事件链模板（3 阶段版）───────────────────────────────── */

export interface ChainTemplate {
  key: string;
  label: string;
  stages: [string, string, string];
  /** 允许的迁移：from→to（都用 index） */
  from: number[];
  to: number[];
  /** 前置条件说明（供提示词展示） */
  precond?: string;
}

export const CHAIN_TEMPLATES: ChainTemplate[] = [
  { key: 'marriage', label: '联姻', stages: ['议婚试探', '聘礼与筹备', '大婚落定'],
    from: [diploIndex('友好'), diploIndex('盟友')], to: [diploIndex('盟友'), diploIndex('血盟')] },
  { key: 'trade', label: '贸易协定', stages: ['磋商', '草签', '正式签署'],
    from: [diploIndex('中立'), diploIndex('友好')], to: [diploIndex('友好'), diploIndex('盟友')] },
  { key: 'truce', label: '停战谈判', stages: ['试探接触', '和谈', '签订执行'],
    from: [diploIndex('紧张'), diploIndex('敌对')], to: [diploIndex('冷淡'), diploIndex('紧张')],
    precond: '需一方实力明显衰退' },
  { key: 'war', label: '宣战', stages: ['宣战调兵', '首战交锋', '决战'],
    from: [diploIndex('敌对')], to: [diploIndex('世仇')] },
  { key: 'betray', label: '背刺', stages: ['暗中筹谋', '试探反水', '公开决裂'],
    from: [diploIndex('盟友'), diploIndex('血盟')], to: [diploIndex('敌对'), diploIndex('世仇')] },
];

export function templateOf(key?: string): ChainTemplate | null {
  return CHAIN_TEMPLATES.find((t) => t.key === key) ?? null;
}

/** 某组迁移该走哪条链（找不到=没有对应模板，只能靠例外直降或逐级渐变） */
export function templateFor(from: number, to: number): ChainTemplate | null {
  return CHAIN_TEMPLATES.find((t) => t.from.includes(from) && t.to.includes(to)) ?? null;
}

/* ── 闸门 ─────────────────────────────────────────────────── */

/** 例外直降：这三种可不经事件链直接跨级**降**（升级永远要走链） */
export type DiploException = 'kill' | 'betray' | 'declare';

export function normException(raw?: string): DiploException | null {
  const s = (raw ?? '');
  if (/核心人物.*(被杀|身亡|遇刺)|刺杀|斩杀首领/.test(s)) return 'kill';
  if (/重大背叛|背刺得手|出卖/.test(s)) return 'betray';
  if (/公开宣战|下战书|宣战/.test(s)) return 'declare';
  return null;
}

export interface TransitionCtx {
  /** 已完结的事件链 key（该组织对该组织的）——由调用方从 WorldEvent 里查 */
  chainDone?: string;
  exception?: DiploException | null;
}

export interface TransitionVerdict {
  ok: boolean;
  reason: string;
  /** 被拒时，前端实际落库的档（通常=原档，或降 1 档的渐变） */
  fallback: number;
}

/**
 * 判定一次外交变动是否放行。
 *
 * 规则：
 * ① 同档 → 放行（无变化）
 * ② 相邻一档的**渐变** → 放行（日常摩擦/一次合作，这是常态，不必走链）
 * ③ 跨 ≥2 档 → **必须**有对应已完结事件链；否则：
 *    · 降级方向 + 命中例外（核心人物被杀/重大背叛/公开宣战）→ 放行
 *    · 其余一律拒绝，回落到"朝目标方向渐变 1 档"（不是完全不动——冲突确实发生了，只是没那么剧烈）
 */
export function canTransition(from: number, to: number, ctx: TransitionCtx = {}): TransitionVerdict {
  if (from === to) return { ok: true, reason: '无变化', fallback: to };
  const gap = Math.abs(to - from);
  const descending = to < from;

  if (gap === 1) return { ok: true, reason: '相邻档渐变（日常摩擦/一次合作）', fallback: to };

  const tpl = templateFor(from, to);
  if (tpl && ctx.chainDone === tpl.key) {
    return { ok: true, reason: `事件链「${tpl.label}」已推进至终局`, fallback: to };
  }
  if (descending && ctx.exception) {
    const label = ctx.exception === 'kill' ? '核心人物被杀' : ctx.exception === 'betray' ? '重大背叛' : '公开宣战';
    return { ok: true, reason: `例外直降：${label}`, fallback: to };
  }
  const step = descending ? from - 1 : from + 1;
  return {
    ok: false,
    fallback: Math.max(0, Math.min(DIPLO_LEVELS.length - 1, step)),
    reason: tpl
      ? `跨 ${gap} 档需先走完事件链「${tpl.label}」（当前未完结）→ 只渐变 1 档`
      : `跨 ${gap} 档且无对应事件链模板 → 只渐变 1 档`,
  };
}

/* ── 玩家杠杆（主角介入）────────────────────────────────── */

export type Intervention = 'mediate' | 'incite' | 'proxy';

export const INTERVENTION_LABEL: Record<Intervention, string> = {
  mediate: '调解', incite: '挑拨', proxy: '代行',
};

export interface InterventionResult { ok: boolean; next: number; reason: string }

/**
 * 主角介入两方关系。这是**玩家能对世界格局施加影响**的可玩动作。
 * · 调解：紧张/敌对 升一档；**世仇不可调**（永不和解是世仇的定义）
 * · 挑拨：友好/盟友/血盟 降一档；血盟需重大把柄（`leverage`）
 * · 代行：仅血盟——代开事件链，本函数不改档位，只判定资格
 */
export function intervene(cur: number, kind: Intervention, opts: { leverage?: boolean } = {}): InterventionResult {
  const name = diploName(cur);
  if (kind === 'mediate') {
    if (cur === diploIndex('世仇')) return { ok: false, next: cur, reason: '世仇不可调解——永不和解正是它的定义' };
    if (cur >= diploIndex('中立')) return { ok: false, next: cur, reason: `${name}已非敌对，无从调解` };
    return { ok: true, next: cur + 1, reason: `调解成功：${name} → ${diploName(cur + 1)}` };
  }
  if (kind === 'incite') {
    if (cur < diploIndex('友好')) return { ok: false, next: cur, reason: `${name}本就不睦，无从挑拨` };
    if (cur === diploIndex('血盟') && !opts.leverage) {
      return { ok: false, next: cur, reason: '挑拨血盟需要重大把柄（背叛证据/致命利害冲突）' };
    }
    return { ok: true, next: cur - 1, reason: `挑拨得手：${name} → ${diploName(cur - 1)}` };
  }
  if (cur !== diploIndex('血盟')) return { ok: false, next: cur, reason: '只有血盟才能代行外交决策' };
  return { ok: true, next: cur, reason: '可代开事件链（仍须走完三阶段；违逆核心人物意愿会致血盟降为盟友）' };
}

/* ── 离世强制结算 ─────────────────────────────────────────── */

/**
 * 主角离开世界时，未走完的事件链按**已完成阶段比例**强制判定，不留悬案。
 * 完成 ≥2/3 → 目标档；完成 1/3 → 朝目标渐变 1 档；一步没走 → 维持原档。
 */
export function forceSettle(from: number, to: number, stagesDone: number, stagesTotal = 3): { level: number; note: string } {
  const ratio = stagesTotal > 0 ? stagesDone / stagesTotal : 0;
  if (ratio >= 2 / 3) return { level: to, note: `事件链已推进 ${stagesDone}/${stagesTotal}，视同达成` };
  if (ratio >= 1 / 3) {
    const step = to > from ? from + 1 : from - 1;
    const lv = Math.max(0, Math.min(DIPLO_LEVELS.length - 1, step));
    return { level: lv, note: `事件链仅推进 ${stagesDone}/${stagesTotal}，折算为渐变 1 档` };
  }
  return { level: from, note: `事件链几乎未推进（${stagesDone}/${stagesTotal}），维持原状` };
}

/* ── 序列化 ───────────────────────────────────────────────── */

export interface DiploEdge { target: string; level: number; chainId?: string }

/** 解析既有的自由文本 `"F2:敌对;F3:同盟"` → 结构化边（迁移老档用） */
export function parseLegacyRelations(text?: string): DiploEdge[] {
  const out: DiploEdge[] = [];
  for (const seg of (text ?? '').split(/[;；\n]+/)) {
    const m = /^\s*([^:：]+)[:：]\s*(.+?)\s*$/.exec(seg);
    if (!m) continue;
    const lv = normDiplo(m[2]);
    if (lv == null) continue;
    out.push({ target: m[1].trim(), level: lv });
  }
  return out;
}

export function formatEdges(edges: DiploEdge[]): string {
  return edges.map((e) => `${e.target}:${diploName(e.level)}`).join('；');
}

/** 注入用：本世界势力间的外交格局 + 可用的玩家杠杆提示 */
export function buildDiplomacyInjection(rows: { name: string; edges: DiploEdge[] }[]): string {
  const lines = rows.filter((r) => r.edges.length).slice(0, 5).map((r) => `· ${r.name} → ${formatEdges(r.edges)}`);
  if (!lines.length) return '';
  return `<势力外交>（八级：血盟>盟友>友好>中立>冷淡>紧张>敌对>世仇。**跨级变动必须先走完对应事件链**——`
    + `联姻／贸易协定／停战谈判／宣战／背刺，各三阶段；只有核心人物被杀、重大背叛、公开宣战可不经事件链直接跨级降。`
    + `主角可介入：调解（升一档·世仇不可调）／挑拨（降一档·血盟需重大把柄）／代行（仅血盟））\n${lines.join('\n')}\n</势力外交>`;
}
