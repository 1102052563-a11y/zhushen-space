/*
  世界经济气候（v5.6 世界引擎「世界经济简报」的**精简版**轮回乐园实装）
  ────────────────────────────────────────────────────────────────────
  卡里那套很全（大宗商品 + 多币种汇率 + 信贷 + 投机市场 + 期货 + 商路 + 经济事件），
  但对「一个世界只待几十回合」的乐园流是过量设计。本实装只留能真正影响玩法的三样：

      经济气候相位（繁荣/衰退/萧条/复苏）  ← 一个乘数，直接进物价
      大宗三类（粮食/矿产/能源）的供需与趋势 ← 影响相关品类售价
      经济事件 ≤3                          ← 给叙事与任务提供钩子

  砍掉的：投机市场／期货／信贷／汇率波动指数。那套要玩得起来得专门做一个「证券所」设施，
  不是顺手加两个字段能撑起来的——真要做再回头抄卡里的完整版。

  ★ **价格公式前端算死**（照搬卡里的公式，这是它少数几处真正确定性的地方）：
        新价 = 旧价 × (1 + 基础趋势因子 ± 扰动)，基础趋势 ∈ [−0.15, 0.15]，最终涨跌封顶 ±30%
    AI 只负责给「驱动事件」与「方向」，具体数字由前端摇——同 派遣/强化/开箱 一脉相承。

  ★ ⚠ **与既有物价权威相乘，绝不替换**：物品价格世界书的「品级颜色 × 评分 × 分类 × 数量」
    公允价阶梯仍是唯一定价基准，本模块只产出一个**系数**乘上去。替换掉那套会让整个交易体系崩掉。

  ★ 作用域 = `world`：跟当地货币一样，离世即弃（`clearMisc` / 换世界重置）。
*/
import { makeRng, hashStr } from './autonomyCorpus';

export const PHASES = ['繁荣', '复苏', '衰退', '萧条'] as const;
export type EconPhase = typeof PHASES[number];

export const SUPPLY = ['紧缺', '平稳', '过剩'] as const;
export type Supply = typeof SUPPLY[number];

export const TREND = ['↑', '→', '↓'] as const;
export type Trend = typeof TREND[number];

/** 大宗三类。key 同时用于把物品分类映射到对应商品。 */
export const COMMODITIES = ['粮食', '矿产', '能源'] as const;
export type CommodityKey = typeof COMMODITIES[number];

export interface Commodity {
  key: CommodityKey;
  supply: Supply;
  trend: Trend;
  note: string;      // 行情要点
  driver: string;    // 主要影响因素
}

export interface EconEvent {
  name: string;
  desc: string;
  stage: '酝酿' | '推进中' | '趋稳' | '消退' | '转折';
}

export interface Economy {
  worldName?: string;
  phase: EconPhase;
  phaseNote: string;
  commodities: Commodity[];
  events: EconEvent[];
  /** 物价指数（100 = 基准）。前端按公式推进，AI 不直接写。 */
  index: number;
  updatedTurn: number;
}

export const ECON_EVENT_CAP = 3;

/* ── 归一 ─────────────────────────────────────────────────── */

export function normPhase(raw?: string): EconPhase {
  const s = (raw ?? '').trim();
  return PHASES.find((p) => s.includes(p)) ?? '复苏';
}
export function normSupply(raw?: string): Supply {
  const s = (raw ?? '').trim();
  return SUPPLY.find((x) => s.includes(x)) ?? '平稳';
}
export function normTrend(raw?: string): Trend {
  const s = (raw ?? '').trim();
  if (/↑|涨|升|上行/.test(s)) return '↑';
  if (/↓|跌|降|下行/.test(s)) return '↓';
  return '→';
}
export function normCommodityKey(raw?: string): CommodityKey | null {
  const s = (raw ?? '').trim();
  if (/粮|食|米|麦|谷/.test(s)) return '粮食';
  if (/矿|铁|铜|银|金属|石材/.test(s)) return '矿产';
  if (/能源|煤|油|木|燃|柴/.test(s)) return '能源';
  return COMMODITIES.find((c) => s.includes(c)) ?? null;
}

/* ── 价格 ─────────────────────────────────────────────────── */

/** 相位 → 整体物价乘数。萧条时东西便宜、繁荣时贵。 */
export const PHASE_MUL: Record<EconPhase, number> = { 繁荣: 1.15, 复苏: 1.05, 衰退: 0.95, 萧条: 0.85 };
/** 供需 → 该品类的额外乘数 */
export const SUPPLY_MUL: Record<Supply, number> = { 紧缺: 1.25, 平稳: 1.0, 过剩: 0.8 };

/** 涨跌封顶（卡里的 ±30%） */
export const MAX_SWING = 0.3;
/** 基础趋势因子区间（卡里的 [-0.15, 0.15]） */
export const BASE_TREND = 0.15;

/**
 * 按公式推进物价指数。**确定性**：同 (index, phase, turn, seedKey) 必得同结果。
 * 趋势方向由相位决定，扰动由种子摇；最终单次涨跌封顶 ±30%。
 */
export function stepIndex(index: number, phase: EconPhase, turn: number, seedKey = 'econ'): number {
  const rng = makeRng(hashStr(`${seedKey}#${turn}#${phase}`) >>> 0);
  const dir = phase === '繁荣' ? 1 : phase === '复苏' ? 0.5 : phase === '衰退' ? -0.5 : -1;
  const base = dir * BASE_TREND * (0.5 + rng() * 0.5);     // 方向内的强度随机
  const noise = (rng() - 0.5) * 0.12;                       // ±6% 扰动
  const swing = Math.max(-MAX_SWING, Math.min(MAX_SWING, base + noise));
  const next = index * (1 + swing);
  return Math.round(Math.max(20, Math.min(500, next)) * 10) / 10;   // 夹在 20~500，防跑飞
}

/**
 * 给某件商品/物品算物价系数（消费方**乘**在公允价上，不是替换）。
 * `category` 是物品分类文本，命中大宗三类就叠上该品类的供需乘数。
 * 返回值夹在 [0.6, 1.8]——再极端的行情也不该让一件装备贵到离谱。
 */
export function priceFactor(econ: Economy | null | undefined, category?: string): number {
  if (!econ) return 1;
  let f = (PHASE_MUL[econ.phase] ?? 1) * (econ.index / 100);
  const key = normCommodityKey(category);
  if (key) {
    const c = econ.commodities.find((x) => x.key === key);
    if (c) f *= SUPPLY_MUL[c.supply] ?? 1;
  }
  return Math.round(Math.max(0.6, Math.min(1.8, f)) * 100) / 100;
}

/* ── 播种（进世界·零 API）─────────────────────────────────── */

/**
 * 进世界时按世界卡文本**确定性**播下初始经济气候，让经济系统一进世界就不是空的。
 * 从世界描述里扫关键词定相位：战乱/灾荒→萧条、繁盛/富庶→繁荣，其余按种子摇一个温和的。
 */
export function seedEconomy(input: { worldName: string; desc?: string; turn?: number }): Economy {
  const text = `${input.desc ?? ''}`;
  let phase: EconPhase;
  if (/战乱|战火|饥荒|灾荒|瘟疫|末日|废土|崩坏/.test(text)) phase = '萧条';
  else if (/繁盛|富庶|盛世|太平|商贸发达|黄金时代/.test(text)) phase = '繁荣';
  else {
    const rng = makeRng(hashStr(`econ-seed#${input.worldName}`) >>> 0);
    phase = rng() < 0.5 ? '复苏' : '衰退';
  }
  const rng2 = makeRng(hashStr(`econ-comm#${input.worldName}`) >>> 0);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng2() * arr.length)];
  const commodities: Commodity[] = COMMODITIES.map((key) => ({
    key,
    supply: phase === '萧条' ? '紧缺' : pick(SUPPLY),
    trend: phase === '萧条' ? '↑' : phase === '繁荣' ? '→' : pick(TREND),
    note: '', driver: '进入世界时的初始行情（尚未经演化细化）',
  }));
  return {
    worldName: input.worldName,
    phase,
    phaseNote: phase === '萧条' ? '战乱/灾异之下，百业凋敝' : phase === '繁荣' ? '商贸兴盛，市面活络' : '市面平常，冷热参半',
    commodities,
    events: [],
    index: 100,
    updatedTurn: input.turn ?? 0,
  };
}

/* ── 序列化 ───────────────────────────────────────────────── */

export function formatEconomy(e: Economy): string {
  const cs = e.commodities.map((c) => `${c.key}:${c.supply}${c.trend}${c.note ? `(${c.note})` : ''}`).join('　');
  const evs = e.events.length ? `\n经济事件：${e.events.map((x) => `${x.name}[${x.stage}]`).join('、')}` : '';
  return `经济气候：${e.phase}${e.phaseNote ? `（${e.phaseNote}）` : ''}　物价指数：${e.index}\n大宗行情：${cs}${evs}`;
}

/** 注入正文：让物价、生计、商队这些细节与经济状态一致 */
export function buildEconomyInjection(e: Economy | null | undefined): { role: 'system'; content: string }[] {
  if (!e) return [];
  return [{
    role: 'system' as const,
    content: `<本世界经济>（背景事实·让物价/生计/商队/雇工价码与之一致；**勿据此另行结算数值**，交易价由系统给出）\n${formatEconomy(e)}\n</本世界经济>`,
  }];
}

/** 喂给杂项演化：当前态 + 待办提示 */
export function serializeEconomyForEvo(e: Economy | null | undefined): string {
  if (!e) return '（本世界尚未建立经济气候）';
  return `${formatEconomy(e)}\n（物价指数由前端按公式推进，你只需给相位/供需/趋势/驱动事件；活跃经济事件上限 ${ECON_EVENT_CAP} 条）`;
}
