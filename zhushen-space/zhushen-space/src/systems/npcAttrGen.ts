import type { PlayerAttrs } from '../store/playerStore';
import { tierBounds, nominalTierNum, clampToTierWindow, TEMPLATE_FLEX_RANGES, templateFromRatio, PEAK_PCT, bioInnate } from './bioStrength';

/* ── NPC 六维·机械生成（生物强度反推，治 API 幻觉乱给离谱属性）─────────────────────
   是 bioStrength「读数(六维→档)」的逆运算「回填(档→六维)」，共用同一把尺子(tierBounds/窗口/模板 Flex%)，
   故生成出的六维用 bioInnate 反算回去 = 给定档位，天然闭环自洽。

   输入(AI 只需给元字段，判这些比算属性可靠)：阶位 tier / 等级 level / 生物强度档 bioTier /
   职业 job(花名→归类) / [流派 style] / [形态 form]。前端确定性生成六维：
   1.校正档位进本阶窗口 2.定预算池[Min,Cap] 3.档内随机取 Flex 占用率→目标总和
   4.按职业排序+流派百分比铺分 Flex 增量 5.两次按阶缩放的 roll 给前两主属性(并从短板守预算回收)
   6.形态压制非人 int/cha/luck + 第3~5项微抖动 7.clamp+幸运单列+闭环自检纠偏。
   全程用 npc.id 作种子(seeded RNG)：可复现、一次固化、不同 NPC 各异。 */

// ── 职业归类 → 五维排序(高→低)。花名经 resolveJob 归到这 9 类之一(底层逻辑类同) ──
export type JobArchetype = 'warrior' | 'assassin' | 'tank' | 'mage' | 'warlock' | 'priest' | 'summoner' | 'leader' | 'allrounder';
const JOB_ORDER: Record<JobArchetype, (keyof PlayerAttrs)[]> = {
  warrior:    ['str', 'con', 'agi', 'cha', 'int'], // 战士/骑士
  assassin:   ['agi', 'str', 'con', 'cha', 'int'], // 刺客/游侠
  tank:       ['con', 'str', 'agi', 'cha', 'int'], // 坦克/守护者
  mage:       ['int', 'cha', 'agi', 'con', 'str'], // 法师/学者
  warlock:    ['cha', 'int', 'agi', 'con', 'str'], // 术士/契约者
  priest:     ['cha', 'int', 'con', 'agi', 'str'], // 牧师/圣职者
  summoner:   ['int', 'cha', 'con', 'agi', 'str'], // 召唤师/支援者
  leader:     ['cha', 'con', 'int', 'str', 'agi'], // 领袖/统御者
  allrounder: ['str', 'agi', 'con', 'int', 'cha'], // 万金油冒险者
};
// 花名关键词 → 归类(具体在前、宽泛在后；命中即取，兜底 allrounder)
const JOB_ALIASES: [JobArchetype, string[]][] = [
  ['tank', ['坦克', '守护', '护卫', '重装', '盾', '壁垒', '铁卫']],
  ['assassin', ['刺客', '游侠', '盗', '潜行', '暗影', '弓', '猎手', '猎人', '刃', '影', '杀手']],
  ['priest', ['牧师', '圣职', '祭司', '神官', '治疗', '医', '德鲁伊', '主教', '修女']],
  ['summoner', ['召唤', '支援', '傀儡师', '操控', '役使', '驭', '通灵', '咒灵']],
  ['warlock', ['术士', '契约', '恶魔', '深渊', '诅咒', '血法', '邪术', '巫']],
  ['mage', ['法师', '学者', '术师', '魔导', '元素', '咒', '智者', '贤者', '炮手', '星']],
  ['leader', ['领袖', '统御', '指挥', '队长', '统帅', '将', '帝', '皇', '督']],
  ['warrior', ['战士', '骑士', '武者', '剑', '枪', '格斗', '狂战', '武', '斗', '兵', '勇士', '战']],
  ['allrounder', ['冒险', '万金油', '游民', '杂', '多面']],
];

// ── 流派 → 前 N 名次占「Flex 增量」的百分比区间；余下名次均分剩余 ──
export type AttrStyle = 'specialist' | 'dual' | 'balanced' | 'glass' | 'low' | 'underdog';
const STYLE_PCT: Record<AttrStyle, [number, number][]> = {
  specialist: [[0.50, 0.70], [0.15, 0.25]],            // 单核+明显短板
  dual:       [[0.35, 0.45], [0.25, 0.35]],            // 双核
  balanced:   [[0.24, 0.30], [0.20, 0.24], [0.16, 0.22]], // 三核均衡
  glass:      [[0.55, 0.75], [0.15, 0.25]],            // 玻璃大炮
  low:        [[0.40, 0.55], [0.15, 0.25]],            // 低强度单核
  underdog:   [[0.28, 0.35], [0.18, 0.24]],            // 较平均(成长型)
};

// ── 形态 → 强制压到 Floor 的维度(非人/低智 int/cha/luck 很低，框架硬要求) ──
export type CreatureForm = 'humanoid' | 'beast' | 'undead' | 'construct' | 'mindless';
const FORM_SUPPRESS: Record<CreatureForm, (keyof PlayerAttrs)[]> = {
  humanoid: [],
  beast: ['int', 'cha'],
  undead: ['cha'],
  construct: ['cha', 'luck'],
  mindless: ['int', 'cha', 'luck'],
};

// 幸运自然上限(按阶位序号 一阶..九阶；更高阶外推)。幸运不进 5 项预算、无来源优先低值。
const LUCK_CAP_BY_TIER = [2, 3, 4, 5, 6, 8, 10, 12, 15];

// 本阶内「等级成长起点」：Lv 处在本阶最低级时，占满级占用率的比例(治"1级却满属性")。
// 越小→低等级越弱；Lv 满则恒为 1(不压)。可调。
const LV_GROWTH_START = 0.5;

// ── 角色定位/段位 → 生物强度档区间 [下限,上限]（纠偏 AI 判档）──
// 让 AI 判「杂兵/精英/头目/首领…」这种粗粒度(易判准)，前端把它给的细档夹进对应区间 ∩ 阶位窗口，
// 即便 AI 把杂兵报成 T5、或把首领报成 T1，也会被拉回合理范围。关键词命中即取，未命中返回 null(只用阶位窗口)。
const ROLE_BANDS: [string[], [number, number]][] = [
  [['杂兵', '路人', '炮灰', '喽啰', '小兵', '蝼蚁', '杂鱼'], [0, 1]],
  [['普通', '士兵', '卫兵', '守卫', '常规', '一般兵', '民兵'], [1, 2]],
  [['精英', '骨干', '老兵', '高手', '好手'], [2, 3]],
  [['头目', '勇者', '勇士', '悍将', '强者', '队长', '小队长', '小首领', '小Boss', '小boss'], [3, 4]],
  [['首领', '头领', '主将', '大将', '统领', 'Boss', 'BOSS', 'boss', '魔将', '霸者'], [4, 5]],
  [['霸主', '枭雄', '宗师', '魔头', '王者', '大能', '传说'], [5, 6]],
  [['神话', '世界级', '半神', '真神', '神祇', '至高', '源初', '规则级', '主神'], [6, 9]],
];
function roleBand(role?: string): [number, number] | null {
  const t = (role ?? '').toString();
  if (!t) return null;
  for (const [ks, band] of ROLE_BANDS) if (ks.some((k) => t.includes(k))) return band;
  return null;
}

// ── 种子随机(mulberry32)：同一 npc.id 复现，不同 id 各异 ──
function hashSeed(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return h >>> 0;
}
function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* 花名 → 职业归类(底层逻辑类同) */
export function resolveJob(job?: string): JobArchetype {
  const t = (job ?? '').toString();
  for (const [arch, ks] of JOB_ALIASES) if (ks.some((k) => t.includes(k))) return arch;
  return 'allrounder';
}
/* 形态文本 → 归类(默认人形) */
export function resolveForm(form?: string): CreatureForm {
  const t = (form ?? '').toString();
  if (/无智|本能|植物|史莱姆|菌|虫群|尸潮/.test(t)) return 'mindless';
  if (/机械|构装|傀儡|魔像|装置|自动|改造体/.test(t)) return 'construct';
  if (/亡灵|不死|尸|骷髅|幽魂|怨灵|鬼/.test(t)) return 'undead';
  if (/兽|龙|魔兽|妖兽|野|虫|蛇|狼|禽|爬虫|巨/.test(t)) return 'beast';
  return 'humanoid';
}
/* 流派：AI 给则用，否则按 职业+档位+身份 兜底推导 */
export function resolveStyle(style: AttrStyle | undefined, bioNum: number, arch: JobArchetype, identity?: string): AttrStyle {
  if (style) return style;
  const id = (identity ?? '').toString();
  if (/首领|王者|领主|BOSS|Boss|boss|霸主|至尊/.test(id) || bioNum >= 4) return 'dual';
  if (arch === 'mage' || arch === 'warlock' || arch === 'summoner') return 'glass';
  if (arch === 'tank' || arch === 'assassin') return 'specialist';
  if (bioNum <= 1) return 'low';
  return 'balanced';
}

// 'T3·勇士' / 'T3' / 3 → 档位数字 0..9
function parseBioNum(b: string | number | undefined): number {
  if (typeof b === 'number') return clamp(Math.round(b), 0, 9);
  const m = /T?(\d)/i.exec((b ?? '').toString());
  return m ? clamp(Number(m[1]), 0, 9) : 2;
}

export interface GenAttrOpts {
  tier?: string; level?: number;
  bioTier: string | number;       // 生物强度档 T0~T9
  job?: string;                   // 职业花名(自动归类)
  style?: AttrStyle;              // 流派(可选；不给则推导)
  form?: string | CreatureForm;   // 形态(可选；不给当人形)
  role?: string;                  // 角色定位/段位(杂兵/精英/头目/首领/霸主/神话…)，前端据此把档位夹进合理区间、纠偏 AI 判档
  identity?: string;              // 身份(用于流派推导)
  seed?: string;                  // 随机种子(传 npc.id 以复现)
}

/* 核心：生物强度 + 阶位 + 职业 → 机械生成六维 */
export function generateNpcAttrs(opts: GenAttrOpts): PlayerAttrs {
  const rng = mulberry32(hashSeed(opts.seed ?? 'npc') ^ (parseBioNum(opts.bioTier) * 2654435761));
  const tierNum = nominalTierNum(opts.tier, opts.level);
  const [min, cap] = tierBounds(tierNum);
  const flexTotal = (cap - min) * 5;

  // 1+3. 档位校正：AI 档位 → 本阶窗口 ∩ 角色定位区间(纠偏 AI 判档偏高/偏低) → 在该档 Flex% 区间随机取占用率
  let tk = clampToTierWindow(parseBioNum(opts.bioTier), tierNum);
  const band = roleBand(opts.role);
  if (band) {
    const wlo = Math.min(9, Math.max(0, tierNum - 1)), whi = Math.min(9, tierNum + 2);
    const lo = Math.max(band[0], wlo), hi = Math.min(band[1], whi);
    if (lo <= hi) tk = Math.max(lo, Math.min(hi, tk));   // 定位×阶位有交集：把 AI 档位夹进交集
    else tk = band[1] < wlo ? wlo : whi;                 // 无交集(三阶却报杂兵/一阶却报神话)：贴到阶位窗口靠定位的那一端
  }
  const [flo, fhi] = TEMPLATE_FLEX_RANGES[Math.min(6, tk)];
  // 取档内「内段」：避开正好落在档位边界 lo 上——templateFromRatio 用 <= 会把边界值归到下一档、造成掉档
  const baseRatio = clamp(flo + (0.12 + 0.76 * rng()) * (fhi - flo), 0, 1);
  // 等级成长：本阶内低等级压低占用率(治"1级却满属性")。Lv 满则不压；高阶仍受窗口下界保底、不跌破本阶基线
  const tierFloorLv = (tierNum - 1) * 10 + 1;
  const lvProg = clamp(((opts.level ?? 1) - tierFloorLv) / 9, 0, 1);
  const ratio = clamp(baseRatio * (LV_GROWTH_START + (1 - LV_GROWTH_START) * lvProg), 0, 1);
  const targetFlex = ratio * flexTotal;
  const tkEff = clampToTierWindow(templateFromRatio(ratio), tierNum); // 等级压低后的「实际档」，自检对齐它(资质潜力档 tk 仅定占用区间/流派)

  // 职业排序 + 流派百分比 + 形态压制维度
  const arch = resolveJob(opts.job);
  const order = JOB_ORDER[arch];
  const form = (typeof opts.form === 'string' ? resolveForm(opts.form) : opts.form) ?? 'humanoid';
  const suppressed = new Set<keyof PlayerAttrs>(FORM_SUPPRESS[form]);
  const style = resolveStyle(opts.style, tk, arch, opts.identity);

  // 4. 每名次占 Flex 的比例：前 N 名按流派区间随机，其余均分剩余，再归一化
  const sp = STYLE_PCT[style];
  const pct: number[] = [];
  let used = 0;
  for (let i = 0; i < 5; i++) {
    if (i < sp.length) { const [lo, hi] = sp[i]; const p = lo + rng() * (hi - lo); pct.push(p); used += p; }
    else pct.push(-1);
  }
  const restCnt = 5 - sp.length;
  const restEach = restCnt > 0 ? Math.max(0, 1 - used) / restCnt : 0;
  for (let i = 0; i < 5; i++) if (pct[i] < 0) pct[i] = restEach;
  const sum = pct.reduce((a, b) => a + b, 0) || 1;

  // 铺分 Flex：按 pct 权重「注水式」分配 targetFlex 到未压维度——单维触及本阶上限则把溢出回灌其它维度，
  // 守恒总预算（避免集中型流派把主属性顶到 Cap 后浪费预算、导致反算档位偏低、闭环失守）
  const val: Record<keyof PlayerAttrs, number> = { str: min, agi: min, con: min, int: min, cha: min, luck: 0 };
  const capRoom = cap - min;
  const baseW = order.map((a, i) => (suppressed.has(a) ? 0 : pct[i] / sum));
  const extra = [0, 0, 0, 0, 0];
  let remaining = targetFlex;
  for (let pass = 0; pass < 6 && remaining > 0.5; pass++) {
    let wTot = 0;
    order.forEach((a, i) => { if (!suppressed.has(a) && extra[i] < capRoom) wTot += baseW[i]; });
    if (wTot <= 0) break;
    let spilled = 0;
    order.forEach((a, i) => {
      if (suppressed.has(a) || extra[i] >= capRoom) return;
      let give = remaining * (baseW[i] / wTot);
      const room = capRoom - extra[i];
      if (give > room) { spilled += give - room; give = room; }
      extra[i] += give;
    });
    remaining = spilled;
  }
  order.forEach((a, i) => { val[a] = min + extra[i]; });
  const mainAttr = order.find((a) => !suppressed.has(a)) ?? order[0];

  // 5. 两次 roll(0~7，按阶缩放) 给前两主属性 + 从短板守预算回收
  const scale = flexTotal / 225; // 以一阶 Flex_total=225 为基准，高阶放大 roll 幅度
  const m1 = order[0], m2 = order[1];
  let added = 0;
  for (const m of [m1, m2]) {
    if (suppressed.has(m)) continue;
    const r = Math.round(rng() * 7 * scale);
    const real = Math.min(r, Math.max(0, cap - val[m])); // 只算「真加进去」的量(主属性已触顶则加不进)
    val[m] += real; added += real;                       // 守预算只回收 real，避免顶档主属性把预算白白漏掉→掉档
  }
  for (let i = 4; i >= 2 && added > 0; i--) {
    const a = order[i]; if (suppressed.has(a)) continue;
    const take = Math.min(val[a] - min, added); val[a] -= take; added -= take;
  }

  // 6. 第3~5名次微抖动(被压维度跳过)
  const jit = Math.max(1, flexTotal * 0.01);
  for (let i = 2; i < 5; i++) { const a = order[i]; if (suppressed.has(a)) continue; val[a] += Math.round((rng() - 0.5) * 2 * jit); }

  // clamp 五维 + 幸运单列(无来源低值；被压形态更低)
  for (const a of order) val[a] = clamp(Math.round(val[a]), min, cap);
  const luckCap = LUCK_CAP_BY_TIER[Math.min(8, tierNum - 1)] ?? 2;
  let luck = Math.round(rng() * rng() * luckCap); // 平方偏低
  if (suppressed.has('luck')) luck = Math.min(luck, Math.ceil(luckCap * 0.2));
  val.luck = clamp(luck, 0, luckCap);

  // 7. 闭环自检：用 bioInnate 反算，若档位被 roll/抖动顶飞则微调主属性纠回
  const step = Math.max(1, Math.ceil((cap - min) * 0.04));
  for (let iter = 0; iter < 12; iter++) {
    const got = bioInnate(val as PlayerAttrs, opts.tier, opts.level);
    if (!got || got.num === tkEff) break;
    // 顶飞→降主属性；不够→抬主属性；主属性触顶/触底时改调次主属性，避免卡死
    const target = (got.num > tkEff) ? -step : step;
    const a = (target < 0 ? (val[mainAttr] > min ? mainAttr : order[1]) : (val[mainAttr] < cap ? mainAttr : order[1]));
    val[a] = clamp(val[a] + target, min, cap);
  }

  // 8. 生物强度档 → 单属性峰值上限：把最高单属性压进该档上限(如杂鱼一阶≤10)，
  //    整体等比例缩放、保留职业主次形状(治"档已压低但主属性仍偏高")
  const peakCap = Math.min(cap, Math.round(min + (cap - min) * (PEAK_PCT[tkEff] ?? 1)));
  const curPeak = Math.max(val.str, val.agi, val.con, val.int, val.cha);
  if (curPeak > peakCap && curPeak > min) {
    const k = (peakCap - min) / (curPeak - min);
    for (const a of order) val[a] = Math.max(min, Math.round(min + (val[a] - min) * k));
  }
  return { str: val.str, agi: val.agi, con: val.con, int: val.int, cha: val.cha, luck: val.luck };
}
