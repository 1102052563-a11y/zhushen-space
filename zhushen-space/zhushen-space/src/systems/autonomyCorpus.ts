/*
  轨道A 自治语料库 · 选择器引擎
  ────────────────────────────────────────────────────────────────
  零 API：离场契约者每轮结算后，由 pickDeed() 从语料库拼一条「经历」写进 deedLog。
  数据驱动：句式/词库全在 src/data/autonomyCorpus.json，新增条目无需改本文件。
  确定性：同一 seed 必出同一句（seed = seedFrom(回合号, npcId)），刷新/读档稳定。
  可扩展（只增不改）：setCorpusOverride() 把手动编辑 / AI 扩库 / 导入分享包的语料
    并入默认池——是「加水」不是「换池」，老语料一律保留。
  守术语：封闭词表，修仙词从源头进不来；详见 JSON 的 _note。
*/

import defaultCorpusRaw from '../data/autonomyCorpus.json';

export interface AutonomyCorpus {
  version: number;
  banks: {
    worldTheme: string[];
    ratingFlavor: Record<string, string[]>;
    tone: Record<string, string[]>;
    emote: string[];
  };
  events: Record<string, string[]>;
  behaviorBias: Record<string, Record<string, number>>;
}

/** 已知事件给 IDE 补全；同时允许任意字符串——新增 event key 不破类型 */
type KnownDeedEvent =
  | 'mission_return' | 'mission_death' | 'mission_depart'
  | 'enhance' | 'acquire' | 'arena_win' | 'arena_lose'
  | 'feud' | 'betray' | 'team_join' | 'trade' | 'casino' | 'heal' | 'rank_up';
export type DeedEvent = KnownDeedEvent | (string & {});

export interface DeedCtx {
  name: string;
  paradise?: string;          // 所属乐园(homeParadise)；缺省回退「主神空间」
  world?: string;             // 任务世界名；不给则从 worldTheme 随机
  rating?: string;            // 评级 E~SSS
  realm?: string;             // 阶位/身份
  enemy?: string;             // 对手/队友名
  item?: string;              // 装备名
  skill?: string;             // 技能/天赋名
  coin?: number | string;     // 货币数
  n?: number | string;        // 通用数字槽（强化等级/排名…）
  personality?: string;       // 用于 tone 语气分桶
}

const defaultCorpus = defaultCorpusRaw as AutonomyCorpus;
let override: Partial<AutonomyCorpus> | null = null;

/* ── 语料读取 / 扩展 ──────────────────────────────────────────── */

/** 合并扩写语料（手动编辑 / AI 扩库 / 导入分享包都走这里）。传 null 清空覆盖。 */
export function setCorpusOverride(patch: Partial<AutonomyCorpus> | null): void {
  override = patch;
}

/** 当前生效语料 = 默认池 ⊕ 覆盖池（数组按 key 拼接，实现「只增不改」）。 */
export function getCorpus(): AutonomyCorpus {
  if (!override) return defaultCorpus;
  return {
    version: override.version ?? defaultCorpus.version,
    banks: {
      worldTheme: [...defaultCorpus.banks.worldTheme, ...(override.banks?.worldTheme ?? [])],
      ratingFlavor: concatArrMap(defaultCorpus.banks.ratingFlavor, override.banks?.ratingFlavor),
      tone: concatArrMap(defaultCorpus.banks.tone, override.banks?.tone),
      emote: [...defaultCorpus.banks.emote, ...(override.banks?.emote ?? [])],
    },
    events: concatArrMap(defaultCorpus.events, override.events),
    behaviorBias: { ...defaultCorpus.behaviorBias, ...(override.behaviorBias ?? {}) },
  };
}

function concatArrMap(
  base: Record<string, string[]>,
  add?: Record<string, string[]>,
): Record<string, string[]> {
  if (!add) return base;
  const out: Record<string, string[]> = { ...base };
  for (const k of Object.keys(add)) out[k] = [...(base[k] ?? []), ...add[k]];
  return out;
}

/* ── 确定性随机（字符串 seed → 可复现） ──────────────────────── */

/** 字符串 → 32 位整数（FNV-1a），给 npcId 这种字符串 seed 用 */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** seed = 回合号 ⊕ npcId 混合：每个 NPC 每回合独立且可复现 */
export function seedFrom(turn: number, npcId: string): number {
  return (hashStr(npcId) ^ Math.imul(turn + 1, 0x9e3779b1)) >>> 0;
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/* ── 性格分桶（自由文本 → 语气/行为原型） ───────────────────── */

const BUCKET_KEYWORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['嗜杀', ['嗜杀', '残忍', '残暴', '暴戾', '狂', '好斗', '嗜血', '凶', '血腥', '杀']],
  ['谨慎', ['谨慎', '稳重', '小心', '冷静', '理智', '沉稳', '保守', '缜密']],
  ['功利', ['功利', '贪婪', '算计', '精明', '现实', '逐利', '市侩', '商']],
  ['享乐', ['享乐', '好色', '放纵', '慵懒', '风流', '散漫', '贪图', '浪荡']],
  ['团队', ['团队', '义气', '忠诚', '重情', '护短', '仗义', '集体', '重义']],
];

/** 把自由文本性格映射到原型桶；无命中回退「中性」 */
export function personalityBucket(personality?: string): string {
  const p = personality ?? '';
  for (const [bucket, kws] of BUCKET_KEYWORDS) {
    if (kws.some((k) => p.includes(k))) return bucket;
  }
  return '中性';
}

/** 该性格的行为倾向权重表（一库两用：给轨道A 效用打分乘系数用）。 */
export function behaviorBiasFor(personality?: string): Record<string, number> {
  const c = getCorpus();
  const b = personalityBucket(personality);
  return c.behaviorBias[b] ?? c.behaviorBias['中性'] ?? {};
}

/* ── 评级回退（语料缺某档时找最近档） ──────────────────────── */

const RATING_ORDER = ['SSS', 'SS', 'S', 'A', 'B', 'C', 'D', 'E'];

function normRating(rating: string | undefined, flavor: Record<string, string[]>): string {
  if (rating && flavor[rating]?.length) return rating;
  const idx = rating ? RATING_ORDER.indexOf(rating) : -1;
  if (idx >= 0) {
    for (let d = 1; d < RATING_ORDER.length; d++) {
      const lo = RATING_ORDER[idx + d];
      const hi = RATING_ORDER[idx - d];
      if (lo && flavor[lo]?.length) return lo;
      if (hi && flavor[hi]?.length) return hi;
    }
  }
  return flavor['A']?.length ? 'A' : (Object.keys(flavor)[0] ?? '');
}

/* ── 主入口：拼一条经历 ──────────────────────────────────────── */

/**
 * 从语料库为某事件生成一条「经历」文本。
 * @param event  事件 key（mission_return / arena_win / feud …）
 * @param ctx    NPC + 本次结算的上下文（按事件提供所需槽位）
 * @param seed   确定性种子，建议 seedFrom(turn, npcId)
 * @returns      填好槽的一句话；该事件无语料时返回 ''（调用方据此跳过）
 */
export function pickDeed(event: DeedEvent, ctx: DeedCtx, seed: number): string {
  const corpus = getCorpus();
  const variants = corpus.events[event];
  if (!variants || variants.length === 0) return ''; // 优雅兜底：没语料就跳过，绝不报错
  const rng = mulberry32(seed >>> 0);
  const tmpl = pick(rng, variants);
  const out = tmpl.replace(/\{(\w+)\}/g, (_m, key: string) => resolveSlot(key, ctx, corpus, rng));
  return tidy(out);
}

function resolveSlot(key: string, ctx: DeedCtx, corpus: AutonomyCorpus, rng: () => number): string {
  switch (key) {
    case 'world':
      return ctx.world || pick(rng, corpus.banks.worldTheme);
    case 'emote':
      return pick(rng, corpus.banks.emote);
    case 'ratingFlavor': {
      const r = normRating(ctx.rating, corpus.banks.ratingFlavor);
      const arr = corpus.banks.ratingFlavor[r];
      return arr?.length ? pick(rng, arr) : '';
    }
    case 'tone': {
      const arr = corpus.banks.tone[personalityBucket(ctx.personality)] ?? corpus.banks.tone['中性'];
      return arr?.length ? pick(rng, arr) : '';
    }
    case 'paradise':
      return ctx.paradise || '主神空间';
    default: {
      const v = (ctx as unknown as Record<string, unknown>)[key];
      return v == null ? '' : String(v);
    }
  }
}

/** 清掉空槽留下的尴尬残留：空书名号、空括号、连续空格/标点、悬空标点 */
function tidy(s: string): string {
  return s
    .replace(/「」/g, '')
    .replace(/（\s*级）/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/，{2,}/g, '，')
    .replace(/\s+([，。；、）」])/g, '$1')
    .replace(/^[，。；、\s]+/, '')
    .trim();
}
