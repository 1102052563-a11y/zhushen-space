/* ════════════════════════════════════════════
   装备强化引擎 —— 纯前端确定性逻辑（对标 systems/diceEngine.ts）
   - 摇率 / 爆装 / 降级 / 保底 / 费用 全在这里算，不花 API
   - 仅乐园内可用（门禁在 EnhancePanel 用 isHomeWorld 判断，本引擎不关心地点）
   - 设计锁定见记忆 equip-enhance-feature（失败惩罚按当前等级三段，floor 在 EnhanceTables）：
     · +0~+2（< downgradeFloor）：必成（base=1，不会失败）
     · +3~+6（downgradeFloor~resetFloor-1）：失败=降 1 级
     · +7~+9（resetFloor~destroyFloor-1）：失败=强化归零（回 +0；保护石可免）
     · +10~+15（≥ destroyFloor）：失败=装备分解消失（爆；保护石可免）
     · 垫子计数(账号级全局)：只在【真的爆装/分解】后 +1，满 10 → 下次必成后清零
════════════════════════════════════════════ */

export const MAX_ENHANCE = 16;          // 强化等级上限（+1 ~ +16，0=未强化）
export const PITY_THRESHOLD = 10;       // 爆装垫子计数满 10 → 下次强化必成功

export type EnhanceOutcome =
  | 'success'      // 成功 +1
  | 'crit'         // 暴击成功 +2（老板 critJump 触发）
  | 'guaranteed'   // 保底必成 +1（垫子计数满）
  | 'fail'         // 必成区不失败 / 危险区有保护石：不掉级不归零不爆
  | 'downgrade'    // +3~+6 失败：降 1 级
  | 'reset'        // +7~+9 失败：强化归零（回 +0）
  | 'destroy';     // ≥+10 失败：装备分解消失

/** 强化师 / 看板娘（老板）：一组修正参数 + 立绘 + 性格 */
export interface BossDef {
  id: string;
  name: string;
  gender: '男' | '女' | '';
  persona: string;       // 性格短描述（卡片展示 + 吐槽兜底）
  banterPreset?: string; // 该老板【独立可编辑的对话预设】，设计点立绘吐槽的说话风格（可分阶段）；空则回退 persona+默认阶段语气
  portraitFolder?: string; // 分阶段立绘文件夹名（对应 图片/<folder>/阶段1..4/）；设了则优先用文件夹随机立绘，按强化等级换阶段
  portrait?: string;     // 单张立绘 dataURL（无文件夹时的回退；运行时字段，持久化在 IndexedDB，partialize 出 localStorage）
  costMul: number;       // 花费倍率（凯莉 0.7 便宜 / 矮人 1.3 贵）
  rateAdd: number;       // 实际成功率加成（0.05 = +5%）
  displayLie: number;    // 明面率虚标：显示率 = 实际率 + displayLie（凯莉型 >0，看着高其实低）
  critJump: number;      // 暴击跳级概率（成功时按此概率额外再 +1）
  destroyFloor?: number; // @deprecated 失败分区已改为全局 EnhanceTables.floor，本字段不再参与结算（保留兼容旧存档）
  builtin?: boolean;     // 内置原型（可改不可删尽量保留）
}

export interface EnhanceTables {
  version: number;         // 率表版本：变更后 store 自动刷新成新表（覆盖旧存档持久化的旧表）
  base: number[];          // base[L] = 当前 +L 强化到 +(L+1) 的基础成功率（length = MAX_ENHANCE）
  downgradeFloor: number;  // ≥此等级失败 = 降 1 级（此等级以下 base=1 不会失败）
  resetFloor: number;      // ≥此等级失败 = 强化归零（保护石可免）
  destroyFloor: number;    // ≥此等级失败 = 装备分解消失（保护石可免；爆装才累加垫子计数）
  gradeCostMul: Record<string, number>;          // 品质关键字 → 费用倍率
  costBase: number; costPow: number;             // 强化费 = costBase·(L+1)^costPow·gradeMul·bossMul
  protectBase: number; protectPow: number;        // 保护石费 = protectBase·(L+1)^protectPow
  amuletBase: number; amuletPow: number;          // 强化符费 = amuletBase·(L+1)^amuletPow
  amuletRateAdd: number;                          // 强化符 +实际成功率
}

/** 默认率表 / 费用参数（设置页可改）。改 base/floor 后务必 ++version，旧存档才会自动刷新。 */
export const DEFAULT_TABLES: EnhanceTables = {
  version: 4,
  // index = 当前等级 L（强化 +L → +L+1）。+0~+2 必成；+3~+6 失败降级；+7~+9 失败归零；+10+ 失败分解。
  base: [1.00, 1.00, 1.00, 0.95, 0.90, 0.80, 0.75, 0.621, 0.537, 0.414, 0.339, 0.280, 0.207, 0.173, 0.136, 0.101],
  downgradeFloor: 3,
  resetFloor: 7,
  destroyFloor: 10,
  gradeCostMul: { 白: 1, 绿: 1.6, 蓝: 2.4, 紫: 3.6, 淡金: 5, 金: 7, 暗金: 10, 永恒: 15, 起源: 22, 创世: 32 },
  costBase: 175, costPow: 1.6,
  protectBase: 750, protectPow: 1.45,
  amuletBase: 550, amuletPow: 1.35,
  amuletRateAdd: 0.12,
};

/** 内置老板原型（参考 DNF 凯莉等） */
export const DEFAULT_BOSSES: BossDef[] = [
  {
    id: 'kelly', name: '凯莉', gender: '女', builtin: true, portraitFolder: '凯莉',
    persona: '甜美爱撒娇、笑里藏刀的诱导型强化师。表面温柔鼓励、报价便宜，实则报的成功率虚高，专诱人冲动砸钱。失败时假装心疼，成功时邀功。',
    banterPreset: `你是强化师凯莉本人——甜美爱撒娇、笑里藏刀的诱导型。第一人称说话，黏人、爱用语气词，擅长用甜言蜜语和身体诱惑骗主角继续砸钱。对话随强化进度逐级升级（系统会告诉你当前第几阶段）：
· 阶段1：礼貌亲和地正常交流，撒娇打气、给点强化建议。
· 阶段2：开始暧昧撩拨——抛媚眼、话里带钩，用亲昵与若有若无的身体暗示诱导主角继续强化、多花钱。
· 阶段3：露骨大胆地调情——贴近、放浪，把强化的刺激和情欲绑在一起，直白挑逗。
· 阶段4：彻底放飞，说露骨私密、充满性暗示与挑逗的荤话（对标角色私密信息尺度），毫不收敛地勾引调情。`,
    costMul: 0.7, rateAdd: 0, displayLie: 0.15, critJump: 0.03,
  },
  {
    id: 'dwarf', name: '铁砧·矮人铁匠', gender: '男', builtin: true,
    persona: '粗犷沉稳、信誉至上的老矮人工匠。说一不二、报价偏贵但货真价实，手艺最稳、成功率实打实地高，瞧不起投机取巧。',
    banterPreset: `你是铁砧·矮人铁匠本人——粗犷沉稳、信誉至上的老工匠，第一人称、硬气、爱用工匠行话。随强化进度（系统会告诉你当前第几阶段）：阶段1平常爽朗交流、偶尔憨厚祝好运；阶段2用激将、轻蔑挑衅主角的胆量与手气；阶段3语重心长，既鼓励又劝主角见好就收、别再赌；阶段4被主角的强化结果彻底震惊、瞠目结舌不敢相信。`,
    costMul: 1.3, rateAdd: 0.06, displayLie: 0, critJump: 0,
  },
  {
    id: 'honest', name: '里德（Reed）', gender: '男', builtin: true,
    persona: '木讷老实、不善言辞的普通铁匠。明面率就是实际率，没有任何套路，偶尔憨厚地祝你好运。',
    banterPreset: `你是里德（Reed）本人——木讷老实、不善言辞的普通铁匠，说话简短憨厚。随强化进度（系统会告诉你当前第几阶段）：阶段1平常地交流、偶尔笨拙地祝好运；阶段2别扭地激将挑衅；阶段3结结巴巴地劝主角收手、别赌了；阶段4彻底傻眼、连话都说不利索的难以置信。`,
    costMul: 1.0, rateAdd: 0.03, displayLie: 0, critJump: 0.02,
  },
  {
    id: 'gambler', name: '狂赌徒·薇拉', gender: '女', builtin: true,
    persona: '癫狂亢奋、嗜赌如命的女强化师。不断煽动你 all in，爆装时狂笑，暴击跳级时比你还兴奋——高风险高回报。',
    banterPreset: `你是狂赌徒·薇拉本人——癫狂亢奋、嗜赌如命的女强化师，第一人称、亢奋、爱煽动 all in。随强化进度（系统会告诉你当前第几阶段）：阶段1兴奋地拉你下水开赌；阶段2挑衅＋诱惑双管齐下煽动你继续；阶段3边勾引边怂恿你梭哈，把强化的刺激和情欲绑一起、直白挑逗；阶段4赢了狂喜、爆了狂笑，说露骨放浪的荤话（成人向）极尽挑逗。`,
    costMul: 1.1, rateAdd: 0, displayLie: 0, critJump: 0.10,
  },
];

/* ── 可强化分类（装备类）── */
const ENHANCEABLE_CATS = new Set(['武器', '防具', '饰品', '特殊物品', '法宝']);
export const isEnhanceable = (cat?: string) => ENHANCEABLE_CATS.has(cat ?? '');

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/* 品质串 → 费用倍率（按关键字由高到低匹配，避免「淡金」先命中「金」）*/
function gradeMul(t: EnhanceTables, grade?: string): number {
  const g = grade ?? '';
  const order = ['创世', '起源', '永恒', '暗金', '淡金', '金', '紫', '蓝', '绿', '白'];
  for (const k of order) if (g.includes(k)) return t.gradeCostMul[k] ?? 1;
  return 1;
}

/** 危险区：失败会【分解/爆】（≥ destroyFloor）。用于警告文案 + 垫子计数判断。 */
export function isDangerLevel(level: number, t: EnhanceTables = DEFAULT_TABLES): boolean {
  return level >= t.destroyFloor;
}
/** 风险区：失败有【归零或分解】的持久后果（≥ resetFloor），保护石在此区才生效。 */
export function isRiskLevel(level: number, t: EnhanceTables = DEFAULT_TABLES): boolean {
  return level >= t.resetFloor;
}

/** 实际成功率（含老板加成 + 强化符）*/
export function actualRate(level: number, boss: BossDef, useAmulet: boolean, t: EnhanceTables = DEFAULT_TABLES): number {
  const base = t.base[Math.min(level, t.base.length - 1)] ?? 0;
  return clamp01(base + (boss.rateAdd || 0) + (useAmulet ? t.amuletRateAdd : 0));
}

/** 明面（显示）成功率 = 实际率 + 老板虚标。玩家看到的就是它，凯莉型会比实际高 */
export function displayRate(level: number, boss: BossDef, useAmulet: boolean, t: EnhanceTables = DEFAULT_TABLES): number {
  return clamp01(actualRate(level, boss, useAmulet, t) + (boss.displayLie || 0));
}

/* 评分串 → 数值（取第一个整数；如 "28（绿色区间11~30）" → 28）*/
export function parseScore(score?: string): number {
  const m = (score ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}
/* 评分 → 费用倍率（评分越高越贵、越低越便宜）*/
export function scoreCostMul(score?: string): number {
  const s = parseScore(score);
  if (s <= 0)  return 0.9;
  if (s <= 10) return 0.8;
  if (s <= 30) return 1.0;
  if (s <= 50) return 1.3;
  if (s <= 70) return 1.7;
  if (s <= 90) return 2.2;
  return 3.0;
}
/* 品级 → 成长系数（品级越高越大）。喂给收尾 AI：越大 → 词缀/效果越强 */
export function gradeGrowth(grade?: string): number {
  const g = grade ?? '';
  const map: [string, number][] = [['创世', 5], ['起源', 4.2], ['永恒', 3.5], ['暗金', 2.8], ['淡金', 2.2], ['金', 1.9], ['紫', 1.6], ['蓝', 1.35], ['绿', 1.15], ['白', 1.0]];
  for (const [k, v] of map) if (g.includes(k)) return v;
  return 1.0;
}
/* 评分 → 成长系数（评分越高越大，封顶 2.5）*/
export function scoreGrowth(score?: string): number {
  return Math.max(1.0, Math.min(2.5, 1.0 + parseScore(score) / 80));
}
/* 综合装备属性成长系数 = 品级系数 × 评分系数（品级越高、评分越高越大）*/
export function growthCoef(grade?: string, score?: string): number {
  return Math.round(gradeGrowth(grade) * scoreGrowth(score) * 100) / 100;
}

/* 强化每净升 1 级，评分上调的点数（前端确定性，让评分随强化上升，不依赖 AI）*/
export const SCORE_PER_LEVEL = 3;
/* 把评分串里的首个数字按 delta 增减（保留后面的区间/描述文字），下限 0。升级即 +、降级/归零即 - */
export function bumpScore(score: string | undefined, delta: number): string {
  const s = (score ?? '').trim();
  const d = Math.round(delta);
  if (d === 0) return s;
  const m = s.match(/-?\d+/);
  if (!m) return d > 0 ? String(d) : s;
  return s.replace(/-?\d+/, String(Math.max(0, parseInt(m[0], 10) + d)));
}

/* 攻防(combatStat)每强化 1 级的增幅（前端确定性·显示用；combatStat 是描述性数值，不破坏六维战力）*/
export const COMBAT_BONUS_PER_LEVEL = 0.10;
/* 把 combatStat 串里所有数字按强化等级放大，返回 {base, enhanced, pct}；level<=0 或无数字返回 null。
   不改存储值——存的是基础值，展示时按等级算出强化后数值，方便「基础→强化」双色显示。 */
export function enhancedCombat(combatStat: string | undefined, level: number): { base: string; enhanced: string; pct: number } | null {
  const s = (combatStat ?? '').trim();
  if (!s || level <= 0 || !/\d/.test(s)) return null;
  const pct = Math.round(level * COMBAT_BONUS_PER_LEVEL * 100);
  const f = 1 + pct / 100;
  const enhanced = s.replace(/\d+/g, (n) => String(Math.round(parseInt(n, 10) * f)));
  return { base: s, enhanced, pct };
}

/* 强化外观记录（按等级分档，喂给生图让 +N 装备出对应特效）*/
export function enhanceVisualNote(level: number): string {
  if (level <= 0) return '';
  if (level <= 3) return '刃锋/甲面更利更亮，棱线泛起淡淡精光';
  if (level <= 6) return '通体浮动暗金强化符文，微光沿纹路流转';
  if (level <= 9) return '缠绕跳动的能量雷弧与流焰，气息灼人';
  if (level <= 12) return '笼罩神性辉光，残影叠动、威压外溢';
  return '被创世级光焰与虚空波纹包裹，光华扭曲周遭空间';
}
/* 在 intro/appearance 末尾维护单个【强化+N…】标记段（替换旧标记，不堆叠）。level<=0 则清除标记 */
export function withEnhanceNote(text: string | undefined, level: number, kind: 'appearance' | 'intro'): string {
  const base = (text ?? '').replace(/\s*【强化\+\d+[：:][^】]*】\s*$/u, '').trimEnd();
  if (level <= 0) return base;
  const body = kind === 'appearance'
    ? enhanceVisualNote(level)
    : `历经 ${level} 次强化锻打，锋芒与坚韧远超初成，隐隐有了传说之相`;
  const note = `【强化+${level}：${body}】`;
  return base ? `${base} ${note}` : note;
}

/* 强化费 = 基数·(L+1)^指数·品级倍率·评分倍率·老板倍率（品级↓评分↓ → 更便宜）*/
export function enhanceCost(level: number, boss: BossDef, grade: string, score: string | undefined, t: EnhanceTables = DEFAULT_TABLES): number {
  return Math.max(0, Math.round(t.costBase * Math.pow(level + 1, t.costPow) * gradeMul(t, grade) * scoreCostMul(score) * (boss.costMul || 1)));
}

/* 强化等级 → 立绘阶段（1~4）：+0~3=1, +4~6=2, +7~9=3, +10及以上=4（含 12+） */
export function stageFromLevel(level: number): 1 | 2 | 3 | 4 {
  if (level <= 3) return 1;
  if (level <= 6) return 2;
  if (level <= 9) return 3;
  return 4;
}
export function protectCost(level: number, t: EnhanceTables = DEFAULT_TABLES): number {
  return Math.max(0, Math.round(t.protectBase * Math.pow(level + 1, t.protectPow)));
}
export function amuletCost(level: number, t: EnhanceTables = DEFAULT_TABLES): number {
  return Math.max(0, Math.round(t.amuletBase * Math.pow(level + 1, t.amuletPow)));
}

export interface EnhanceResult {
  outcome: EnhanceOutcome;
  fromLevel: number;
  toLevel: number;     // 结果等级（destroy 时 = -1 表示已损毁）
  destroyed: boolean;
  guaranteed: boolean; // 本次是否由保底触发
  pityAfter: number;   // 结算后的垫子计数
  rate: number;        // 本次实际成功率（日志/吐槽用）
}

/** 单次强化结算（纯随机；调用方负责扣费/改装备/写计数）*/
export function resolveEnhance(
  level: number,
  boss: BossDef,
  opts: { useProtect: boolean; useAmulet: boolean; pity: number },
  t: EnhanceTables = DEFAULT_TABLES,
): EnhanceResult {
  const rate = actualRate(level, boss, opts.useAmulet, t);

  // 保底：垫子计数满 → 必成（稳 +1，不触发暴击跳级），随后清零
  if (opts.pity >= PITY_THRESHOLD) {
    return { outcome: 'guaranteed', fromLevel: level, toLevel: Math.min(level + 1, MAX_ENHANCE), destroyed: false, guaranteed: true, pityAfter: 0, rate };
  }

  if (Math.random() < rate) {
    let to = level + 1;
    let outcome: EnhanceOutcome = 'success';
    if ((boss.critJump || 0) > 0 && to < MAX_ENHANCE && Math.random() < boss.critJump) { to += 1; outcome = 'crit'; }
    return { outcome, fromLevel: level, toLevel: Math.min(to, MAX_ENHANCE), destroyed: false, guaranteed: false, pityAfter: opts.pity, rate };
  }

  // ── 失败：按当前等级分三段（floor 全局可配）──
  const fb = { fromLevel: level, destroyed: false, guaranteed: false, rate };
  // 风险区（≥resetFloor）：保护石可免 —— 不归零/不爆，停留原级，垫子计数不增
  if (level >= t.resetFloor && opts.useProtect) {
    return { ...fb, outcome: 'fail', toLevel: level, pityAfter: opts.pity };
  }
  if (level >= t.destroyFloor) {
    // 分解/爆：装备消失，垫子计数 +1
    return { ...fb, outcome: 'destroy', toLevel: -1, destroyed: true, pityAfter: opts.pity + 1 };
  }
  if (level >= t.resetFloor) {
    // 强化归零：回 +0（垫子计数不增——只有真爆才 +1）
    return { ...fb, outcome: 'reset', toLevel: 0, pityAfter: opts.pity };
  }
  if (level >= t.downgradeFloor) {
    // 降 1 级
    return { ...fb, outcome: 'downgrade', toLevel: level - 1, pityAfter: opts.pity };
  }
  // < downgradeFloor：理论不达（base=1 必成）
  return { ...fb, outcome: 'fail', toLevel: level, pityAfter: opts.pity };
}

/** 每跨过 4 个强化等级追加 1 条词缀/效果 —— 算本次（旧→新）应新增几条 */
export function newAffixCount(fromLevel: number, toLevel: number): number {
  return Math.max(0, Math.floor(toLevel / 4) - Math.floor(Math.max(0, fromLevel) / 4));
}

/* ── +N 角标特效（复用 index.css 现成 .grade-* 流光；等级越高越华丽）── */
export function enhanceFxClass(level: number): string {
  if (level <= 0) return '';
  if (level >= 16) return 'grade-badge grade-grad grade-grad-genesis grade-shimmer grade-pulse';
  if (level >= 13) return 'grade-badge grade-grad grade-grad-origin grade-shimmer grade-pulse';
  if (level >= 10) return 'grade-badge grade-grad grade-grad-eternal grade-shimmer grade-glow-1';
  if (level >= 7)  return 'grade-badge grade-grad grade-grad-darkgold grade-shimmer';
  if (level >= 4)  return 'grade-badge grade-grad grade-grad-gold grade-glow-2';
  return 'text-amber-300 font-bold';
}

/** +N 纯文字配色（用于不便套流光的小角标）*/
export function enhanceColorClass(level: number): string {
  if (level >= 16) return 'text-rose-300';
  if (level >= 13) return 'text-fuchsia-300';
  if (level >= 10) return 'text-cyan-200';
  if (level >= 7)  return 'text-amber-400';
  if (level >= 4)  return 'text-yellow-300';
  if (level >= 1)  return 'text-amber-300';
  return 'text-dim/50';
}
