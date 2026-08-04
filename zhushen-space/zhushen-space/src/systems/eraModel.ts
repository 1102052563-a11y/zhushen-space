/*
  时代演化模型（v5.6 世界引擎「时代快讯」的轮回乐园实装 —— **搬到宇宙层**）
  ──────────────────────────────────────────────────────────────────────────
  卡里这套挂在单个世界上：潜在时代慢慢涨进度、涨到临界派生转折点、定鼎或归墟写进岁月史书。
  **在任务世界完全跑不动**——一个世界几十回合就通关离开，进度涨不到 80%，整套机制形同虚设。

  但 `cosmosStore`（万族/七乐园/深渊）是**跨世界永久层**，进度慢慢涨恰好合适：
  主角闯十个世界回来，发现某个乐园的「灵潮复苏」终于从 30% 涨到了临界——这才是它该有的节奏。

  ★ 确定性部分全部前端算（同 派遣/强化/传闻压缩 一脉相承）：
      净干预值：高强度 ±2 / 中 ±1 / 低 ±0.5 求和 → 偏推动=定鼎、偏抑止=归墟、平衡=派生后续
      进度 ≥80% 且无关联临界事件 → 强制派生一个
      逻辑关联的潜在时代 → 合并（取最早开始日期）
    AI 只负责：命名、描述、节点文本、结局叙述。

  ★ 「演变纪命名规范」那段（禁「蒸汽时代至电气时代」式拼接）已在第 1 批单独抄进
    `CHRONICLE_COMPILE_RULE` —— 定鼎/归墟产出的演变纪投影进编年史时复用同一套命名要求，不重复造。
*/

export type EraPhase = '萌芽' | '发展' | '临界';
export type Intensity = '高' | '中' | '低';
export type Direction = '推动' | '抑止';

/** 进度 ≥ 此值即锁定并派生临界事件 */
export const CRITICAL_AT = 80;
/** 干预强度 → 权重（卡里的 ±2 / ±1 / ±0.5） */
export const INTENSITY_WEIGHT: Record<Intensity, number> = { 高: 2, 中: 1, 低: 0.5 };
/** 净干预值绝对值低于此，视为势均力敌 → 派生后续而不是定论 */
export const BALANCE_BAND = 1;

export interface ChainNode {
  date?: string;
  direction: Direction;
  intensity: Intensity;
  desc?: string;
}

export interface PotentialEra {
  name: string;
  startDate?: string;
  pct: number;          // 0~100·**单向不可回退**
  phase: EraPhase;
  drivers: string;      // 推动因子
  blockers: string;     // 抑止因子
  desc: string;
  /** 关联的临界事件名（进度锁定后由前端派生并记在这里） */
  criticalEvent?: string;
  /** 事件脉络（含干预标注）——净干预值从这里算 */
  chain: ChainNode[];
}

/* ── 归一 ─────────────────────────────────────────────────── */

export function normIntensity(raw?: string): Intensity {
  const s = (raw ?? '');
  if (/高|强|剧烈/.test(s)) return '高';
  if (/低|弱|轻微/.test(s)) return '低';
  return '中';
}
export function normDirection(raw?: string): Direction {
  return /抑|阻|遏|压/.test(raw ?? '') ? '抑止' : '推动';
}
export function phaseOf(pct: number): EraPhase {
  if (pct >= CRITICAL_AT) return '临界';
  if (pct >= 35) return '发展';
  return '萌芽';
}

/* ── 净干预 ───────────────────────────────────────────────── */

/** 净干预值：推动为正、抑止为负，按强度加权求和 */
export function netIntervention(chain: ChainNode[]): number {
  return (chain ?? []).reduce((sum, n) => {
    const w = INTENSITY_WEIGHT[n.intensity] ?? 1;
    return sum + (n.direction === '抑止' ? -w : w);
  }, 0);
}

export type Verdict = 'settle' | 'void' | 'derive';

export const VERDICT_LABEL: Record<Verdict, string> = {
  settle: '定鼎', void: '归墟', derive: '派生后续',
};

/**
 * 临界事件走完后的裁决。
 * · 净干预偏推动 → **定鼎**（该潜在时代成为新的时代阶段）
 * · 偏抑止 → **归墟**（被遏制／扭转，留下创伤）
 * · 势均力敌（|净值| < BALANCE_BAND）→ **派生后续**，由下一个转折点决定
 */
export function verdictOf(net: number): Verdict {
  if (Math.abs(net) < BALANCE_BAND) return 'derive';
  return net > 0 ? 'settle' : 'void';
}

/* ── 进度推进 ─────────────────────────────────────────────── */

/**
 * 进度**单向线性增长、不可回退**（卡里的硬规则）。
 * 增量由本轮新增节点的净干预决定：推动多则涨得快，抑止多则几乎不涨（但也不倒退）。
 */
export function stepProgress(cur: number, newNodes: ChainNode[]): number {
  const net = netIntervention(newNodes);
  const gain = net <= 0 ? 0.5 : Math.min(12, 2 + net * 2);   // 被压制时也仍缓慢推进，只是很慢
  return Math.max(cur, Math.min(100, Math.round((cur + gain) * 10) / 10));
}

/** 进度到临界且还没有关联临界事件 → 该派生一个 */
export function needsCriticalEvent(era: PotentialEra): boolean {
  return era.pct >= CRITICAL_AT && !era.criticalEvent;
}

/** 派生的临界事件名（AI 可覆盖成更贴合世界观的；这里给一个能用的确定性默认） */
export function defaultCriticalName(era: PotentialEra): string {
  return `${era.name}·存亡之辩`;
}

/* ── 合并逻辑关联的潜在时代 ───────────────────────────────── */

export interface MergePlan { keep: string; absorb: string[]; startDate?: string }

/**
 * 找出该合并的潜在时代组。判据是**名称/描述的关键词重叠**——刻意保守：
 * 至少 2 个长度 ≥2 的公共词才算关联，宁可不合并，也不要把不相干的两条并成一条。
 */
export function planMerges(eras: PotentialEra[]): MergePlan[] {
  const words = (e: PotentialEra) =>
    new Set(`${e.name} ${e.desc}`.split(/[\s，。、,.；;·]+/).filter((w) => w.length >= 2));
  const plans: MergePlan[] = [];
  const used = new Set<string>();
  for (let i = 0; i < eras.length; i++) {
    if (used.has(eras[i].name)) continue;
    const a = words(eras[i]);
    const absorb: string[] = [];
    for (let j = i + 1; j < eras.length; j++) {
      if (used.has(eras[j].name)) continue;
      const b = words(eras[j]);
      let shared = 0;
      for (const w of a) if (b.has(w)) shared++;
      if (shared >= 2) { absorb.push(eras[j].name); used.add(eras[j].name); }
    }
    if (absorb.length) {
      const group = [eras[i], ...eras.filter((e) => absorb.includes(e.name))];
      const dates = group.map((e) => e.startDate).filter(Boolean) as string[];
      plans.push({ keep: eras[i].name, absorb, startDate: dates.sort()[0] });
      used.add(eras[i].name);
    }
  }
  return plans;
}

/** 执行合并：进度取最高、脉络合并、因子拼接、开始日期取最早 */
export function applyMerge(eras: PotentialEra[], plan: MergePlan): PotentialEra[] {
  const keep = eras.find((e) => e.name === plan.keep);
  if (!keep) return eras;
  const group = eras.filter((e) => plan.absorb.includes(e.name));
  if (!group.length) return eras;
  const merged: PotentialEra = {
    ...keep,
    startDate: plan.startDate ?? keep.startDate,
    pct: Math.max(keep.pct, ...group.map((e) => e.pct)),
    drivers: [keep.drivers, ...group.map((e) => e.drivers)].filter(Boolean).join('、'),
    blockers: [keep.blockers, ...group.map((e) => e.blockers)].filter(Boolean).join('、'),
    chain: [...keep.chain, ...group.flatMap((e) => e.chain)],
  };
  merged.phase = phaseOf(merged.pct);
  return [merged, ...eras.filter((e) => e.name !== plan.keep && !plan.absorb.includes(e.name))];
}

/* ── 序列化 ───────────────────────────────────────────────── */

export function formatEra(e: PotentialEra): string {
  const net = netIntervention(e.chain);
  const critical = e.criticalEvent ? `　⚡临界事件:${e.criticalEvent}` : (needsCriticalEvent(e) ? '　⚠已达临界·待派生临界事件' : '');
  return `- 「${e.name}」${e.pct}% [${e.phase}]　净干预:${net > 0 ? '+' : ''}${net}${critical}\n`
    + `    推动:${e.drivers || '—'}　抑止:${e.blockers || '—'}\n`
    + `    ${e.desc || ''}`;
}

/** 喂给万族演化：当前潜在时代 + 前端已算好的待办 */
export function serializeErasForEvo(eras: PotentialEra[]): string {
  if (!eras.length) return '（当前无正在酝酿的潜在时代）';
  const rows = eras.map(formatEra);
  const pending = eras.filter(needsCriticalEvent).map((e) => e.name);
  const merges = planMerges(eras).map((p) => `${p.keep} ← ${p.absorb.join('、')}`);
  const notes: string[] = [];
  if (pending.length) notes.push(`⚡ 已达临界待派生临界事件：${pending.join('、')}`);
  if (merges.length) notes.push(`🔗 检测到逻辑关联、建议合并：${merges.join('；')}`);
  return `${rows.join('\n')}${notes.length ? `\n\n${notes.join('\n')}` : ''}`;
}
