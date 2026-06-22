import type { PlayerAttrs } from '../store/playerStore';
import { tierBounds, nominalTierNum, clampToTierWindow, peakCapForTier } from './bioStrength';

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

// ── 流派 → 各名次「相对主属性」的比例(主=1，副属性递减)。峰值口径：主属性=该档峰值上限，副按此递减 ──
export type AttrStyle = 'specialist' | 'dual' | 'balanced' | 'glass' | 'low' | 'underdog';
const STYLE_FALLOFF: Record<AttrStyle, number[]> = {
  specialist: [1, 0.38, 0.20, 0.13, 0.10],  // 单核+明显短板
  dual:       [1, 0.72, 0.34, 0.22, 0.16],  // 双核
  balanced:   [1, 0.86, 0.72, 0.56, 0.46],  // 三核均衡
  glass:      [1, 0.30, 0.16, 0.12, 0.10],  // 玻璃大炮
  low:        [1, 0.42, 0.24, 0.16, 0.12],  // 低强度单核
  underdog:   [1, 0.74, 0.56, 0.44, 0.36],  // 较平均(成长型)
};

// ── 形态档 FORM_PROFILE：逐维处理策略，治"非人缺维度"且修高阶压制失效 ──
//   keep=正常按职业 / weak=退化(绝对低值,脱离阶位) / none=缺失(≈1~3) / boost=增强(顶到本阶峰值)
//   关键修复：旧版把缺失维压到「本阶 Min」，而高阶 Min 达数千(九阶=8641)→九阶妖兽智力 8641、EP 13万，压了个寂寞。
//   现在 weak/none 用**绝对低值**(与阶位无关)：「没有智力的妖兽」无论几阶 int 都≈2~12。boost 顶到本阶峰值(不超 cap,保闭环)。
export type DimRule = 'keep' | 'weak' | 'none' | 'boost';
export type CreatureForm =
  | 'humanoid' | 'beast' | 'greatbeast' | 'undead' | 'construct'
  | 'mindless' | 'plant' | 'ooze' | 'elemental' | 'spirit' | 'divine';
type FormDims = Record<keyof PlayerAttrs, DimRule>;
const FORM_PROFILE: Record<CreatureForm, FormDims> = {
  //            力          体          敏          智          魅          幸
  humanoid:   { str: 'keep',  con: 'keep',  agi: 'keep',  int: 'keep',  cha: 'keep', luck: 'keep' },
  beast:      { str: 'keep',  con: 'keep',  agi: 'keep',  int: 'weak',  cha: 'weak', luck: 'keep' }, // 妖兽·有本能无理智
  greatbeast: { str: 'boost', con: 'boost', agi: 'keep',  int: 'weak',  cha: 'weak', luck: 'keep' }, // 巨兽/龙·力体碾压
  undead:     { str: 'keep',  con: 'keep',  agi: 'keep',  int: 'weak',  cha: 'none', luck: 'weak' }, // 亡灵·无魅(惊悚)·智看生前
  construct:  { str: 'keep',  con: 'keep',  agi: 'keep',  int: 'weak',  cha: 'none', luck: 'none' }, // 机械·无情感无命运
  mindless:   { str: 'keep',  con: 'keep',  agi: 'keep',  int: 'none',  cha: 'none', luck: 'none' }, // 虫群·纯本能·无智
  plant:      { str: 'keep',  con: 'boost', agi: 'none',  int: 'none',  cha: 'none', luck: 'weak' }, // 植物·固着高耐久
  ooze:       { str: 'keep',  con: 'boost', agi: 'keep',  int: 'none',  cha: 'none', luck: 'weak' }, // 黏物·软体
  elemental:  { str: 'keep',  con: 'keep',  agi: 'boost', int: 'keep',  cha: 'weak', luck: 'keep' }, // 元素·能量态
  spirit:     { str: 'none',  con: 'keep',  agi: 'keep',  int: 'boost', cha: 'keep', luck: 'keep' }, // 精神体·无形体力·心识强
  divine:     { str: 'boost', con: 'boost', agi: 'boost', int: 'boost', cha: 'boost',luck: 'keep' }, // 神性·高位全能
};
// 缺维绝对值(脱离阶位)：none≈"根本没有"、weak≈"退化/动物级"
const absNone = (rng: () => number) => 1 + Math.floor(rng() * 3);   // 1~3
const absWeak = (rng: () => number) => 3 + Math.floor(rng() * 10);  // 3~12

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
const FORM_ENUM = new Set<CreatureForm>(['humanoid', 'beast', 'greatbeast', 'undead', 'construct', 'mindless', 'plant', 'ooze', 'elemental', 'spirit', 'divine']);
/* 形态文本 → 归类(默认人形)。顺序敏感：具体/易混的先判(幽灵→spirit先于幽魂→undead；龙→greatbeast先于兽→beast) */
export function resolveForm(form?: string): CreatureForm {
  const t = (form ?? '').toString();
  // 已是枚举值则直接返回——防"调用方先 resolveForm 成 'beast' 再传进来被二次解析(英文不匹配中文)→退化成 humanoid、形态压制失效"
  if (FORM_ENUM.has(t as CreatureForm)) return t as CreatureForm;
  if (/神性|神格|概念体|本源|至高神|主神|神祇|神明|造物主/.test(t)) return 'divine';
  if (/精神体|灵体|怨念|幽灵|魂魄|鬼魂|残魂|魅影|魂灵/.test(t)) return 'spirit';
  if (/元素|能量体|火灵|水灵|风灵|岩灵|焰魔|冰魄/.test(t)) return 'elemental';
  if (/黏|粘|软体|泥|胶|史莱姆|斯莱姆/.test(t)) return 'ooze';
  if (/植物|草木|树|花|藤|真菌|菌|苔|藓/.test(t)) return 'plant';
  if (/无智|纯本能|虫群|蜂群|尸潮|菌潮/.test(t)) return 'mindless';
  if (/机械|构装|傀儡|魔像|装置|自动|改造体|金属躯/.test(t)) return 'construct';
  if (/亡灵|不死|死灵|尸|骷髅|幽魂|怨灵|鬼|僵|亡魂|死徒/.test(t)) return 'undead';
  if (/巨龙|巨兽|泰坦|巨虫|远古龙|龙|巨/.test(t)) return 'greatbeast';
  if (/兽|魔兽|妖兽|野|虫|蛇|狼|禽|爬虫|甲壳/.test(t)) return 'beast';
  return 'humanoid';
}
// ── 类型标签 UNIT_TYPE：一个封闭枚举一站式定 {职业排序 + 流派 + 凡人 + 形态}。AI 从清单选(选择题>填空题，治"自由职业花名匹配失败兜底力主") ──
//   [标签, 别名关键词[], 规格]。命中标签或任一别名即取；顺序敏感(狂战在武者前，免得"狂战士"被武者的'战士'抢走)。
export interface TypeSpec { arch: JobArchetype; style?: AttrStyle; mundane?: boolean; form?: CreatureForm; civBias?: keyof PlayerAttrs; }
const UNIT_TYPE: [string, string[], TypeSpec][] = [
  // 人形·战斗
  ['狂战蛮兵', ['狂战', '蛮兵', '野蛮', '狂暴', '嗜血'], { arch: 'warrior', style: 'glass' }],
  ['武者战士', ['武者', '战士', '剑', '枪', '骑士', '武士', '刀客', '勇士', '枪兵'], { arch: 'warrior', style: 'specialist' }],
  ['武僧格斗', ['武僧', '格斗', '拳', '体术', '搏击'], { arch: 'warrior', style: 'dual' }],
  ['重装坦克', ['重装', '坦克', '守护', '护卫', '盾', '铁卫', '壁垒'], { arch: 'tank', style: 'specialist' }],
  ['敏捷刺客', ['刺客', '暗杀', '潜行', '暗影', '杀手', '盗'], { arch: 'assassin', style: 'glass' }],
  ['远程射手', ['射手', '弓', '弩', '炮手', '狙', '箭'], { arch: 'assassin', style: 'glass' }],
  ['游侠猎手', ['游侠', '猎手', '猎人', '驯兽', '游骑'], { arch: 'assassin', style: 'dual' }],
  ['死灵巫师', ['死灵', '尸术', '骨法', '亡灵法师', '操尸'], { arch: 'summoner', style: 'glass' }],
  ['元素法师', ['法师', '元素法', '术师', '魔导', '咒术师', '贤者', '学者', '炮'], { arch: 'mage', style: 'glass' }],
  ['咒术邪法', ['术士', '邪术', '契约', '诅咒', '血法', '巫', '深渊'], { arch: 'warlock', style: 'glass' }],
  ['圣职牧师', ['牧师', '圣职', '祭司', '神官', '治疗', '医', '德鲁伊', '修女'], { arch: 'priest', style: 'dual' }],
  ['圣骑战僧', ['圣骑', '战僧', '圣战', '圣殿'], { arch: 'warrior', style: 'dual' }],
  ['召唤操控', ['召唤', '操控', '傀儡师', '通灵', '役使', '咒灵'], { arch: 'summoner', style: 'dual' }],
  ['魅惑吟游', ['吟游', '魅惑', '歌者', '诗人'], { arch: 'leader', style: 'dual' }],
  ['统御指挥', ['统御', '指挥', '领袖', '队长', '统帅', '将', '帝', '皇'], { arch: 'leader', style: 'dual' }],
  ['全能斗士', ['全能', '冒险', '万金油', '多面', '游民'], { arch: 'allrounder', style: 'balanced' }],
  // 人形·非战斗(凡人)
  ['平民百姓', ['平民', '百姓', '村民', '路人', '侍应', '侍女', '仆', '奴', '乞', '难民', '居民', '市民'], { arch: 'allrounder', mundane: true }],
  ['匠人工役', ['匠', '铁匠', '苦力', '农夫', '渔夫', '樵夫', '船夫', '车夫', '杂役'], { arch: 'allrounder', mundane: true, civBias: 'con' }],
  ['商贾文人', ['商人', '商贩', '掌柜', '货郎', '账房', '文官', '书生', '学童', '文人'], { arch: 'allrounder', mundane: true, civBias: 'int' }],
  ['艺伶乐者', ['歌姬', '舞姬', '乐师', '艺伶', '伶', '妓', '优伶'], { arch: 'allrounder', mundane: true, civBias: 'cha' }],
  // 非人(form)
  ['巨兽龙类', ['巨兽', '巨龙', '泰坦', '远古龙', '龙'], { arch: 'warrior', style: 'specialist', form: 'greatbeast' }],
  ['凶兽魔兽', ['凶兽', '妖兽', '魔兽', '野兽', '兽'], { arch: 'warrior', style: 'specialist', form: 'beast' }],
  ['亡灵不死', ['亡灵', '不死', '骷髅', '幽魂', '怨灵', '僵尸', '尸'], { arch: 'warrior', style: 'specialist', form: 'undead' }],
  ['机械构装', ['机械', '构装', '傀儡兵', '魔像', '装置', '自动机'], { arch: 'tank', style: 'specialist', form: 'construct' }],
  ['虫群本能', ['虫群', '蜂群', '纯本能', '尸潮'], { arch: 'assassin', style: 'glass', form: 'mindless' }],
  ['植物真菌', ['植物', '草木', '树人', '花妖', '藤', '真菌', '菌'], { arch: 'tank', style: 'low', form: 'plant' }],
  ['黏物软体', ['黏', '粘', '软体', '泥', '胶', '史莱姆'], { arch: 'tank', style: 'low', form: 'ooze' }],
  ['元素能量', ['元素体', '能量体', '火灵', '水灵', '风灵', '岩灵'], { arch: 'mage', style: 'glass', form: 'elemental' }],
  ['精神怨灵', ['精神体', '灵体', '怨念', '幽灵', '魂魄', '残魂', '魅影'], { arch: 'mage', style: 'glass', form: 'spirit' }],
  ['神性概念', ['神性', '神格', '概念体', '本源', '至高神', '造物主'], { arch: 'leader', style: 'dual', form: 'divine' }],
];
/* 类型标签 → 生成规格(收编 职业排序+流派+凡人+形态)。AI 从封闭清单选；未识别则退回职业花名归类(向后兼容旧花名/旧 genAttrs) */
export function resolveType(tag?: string): TypeSpec {
  const t = (tag ?? '').toString();
  if (t) for (const [label, ks, spec] of UNIT_TYPE) if (t.includes(label) || ks.some((k) => t.includes(k))) return spec;
  return { arch: resolveJob(t) };   // 兜底：按职业花名归类(arch)，其余维度走原 isMundane/resolveForm/resolveStyle
}
/* 类型标签清单(供手动 UI 下拉；与 UNIT_TYPE 同源不漂移) */
export const UNIT_TYPE_LABELS: string[] = UNIT_TYPE.map(([label]) => label);

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
  type?: string;                  // 类型标签(封闭枚举,收编 职业排序+流派+凡人+形态；优先于 job)
  job?: string;                   // 职业花名(自动归类；type 缺失时的兜底)
  style?: AttrStyle;              // 流派(可选；不给则按类型/推导)
  form?: string | CreatureForm;   // 形态(可选；显式给则覆盖类型自带形态；都没有当人形)
  role?: string;                  // 角色定位/段位(杂兵/精英/头目/首领/霸主/神话…)，前端据此把档位夹进合理区间、纠偏 AI 判档
  identity?: string;              // 身份(用于流派推导)
  seed?: string;                  // 随机种子(传 npc.id 以复现)
  force?: boolean;                // true=手动指定了档位，跳过「凡人档」(把平民也按所选战斗档生成，用于隐藏高手)
}

// 平民/非战斗身份关键词 → 默认走「凡人档」(极低常人属性，不套战斗职业框架)；含战斗词则不算平民。
const MUNDANE_RE = /侍应|侍女|丫鬟|婢女|女佣|佣人|仆从|仆人|店小二|小二|跑堂|掌柜|老板娘|老板|店主|村民|村姑|村妇|农夫|农妇|渔夫|樵夫|平民|路人|百姓|居民|市民|难民|流民|商人|商贩|小贩|货郎|摊主|船夫|车夫|马夫|乐师|歌姬|舞姬|厨子|厨娘|裁缝|绣娘|账房|杂役|苦力|乞丐|奴隶|侍童|书童|孩童|幼童|学童/;
const COMBAT_HINT_RE = /战|剑|刀|枪|矛|斧|弓|箭|盾|法师|术士|巫|咒|骑士|武|斗|猎|杀|刺客|游侠|卫兵|护卫|镖|将|统领|首领|领主|圣骑|修士|战姬|佣兵|雇佣|强者|高手|宗师|魔|妖|兽|龙|神/;
function isMundane(job?: string, tier?: string, identity?: string): boolean {
  const t = `${job ?? ''} ${tier ?? ''} ${identity ?? ''}`;
  if (/零阶|凡人|无修为|普通人|手无缚鸡|不会武/.test(t)) return true;   // 明确凡人
  if (COMBAT_HINT_RE.test(t)) return false;                              // 有战斗身份 → 不算平民(可能隐藏高手)
  return MUNDANE_RE.test(t);
}

/* 核心：生物强度 + 阶位 + 职业 → 机械生成六维 */
export function generateNpcAttrs(opts: GenAttrOpts): PlayerAttrs {
  const rng = mulberry32(hashSeed(opts.seed ?? 'npc') ^ (parseBioNum(opts.bioTier) * 2654435761));
  const tierNum = nominalTierNum(opts.tier, opts.level);
  const [min, tierCap] = tierBounds(tierNum);

  // 类型规格(收编 职业排序+流派+凡人+形态)：type 优先，缺失退回 job 花名归类(向后兼容)
  const ts = resolveType(opts.type || opts.job);

  // 0. 凡人档：类型判平民、或 isMundane 命中(平民/非战斗/零阶)且未手动指定档 → 极低常人属性，不套战斗框架(治"零阶酒馆女侍应力22")
  //    civBias 让匠人(体)/商文(智)/艺伶(魅)略高于纯平民；手动选档(force)则尊重(隐藏高手)。
  if (!opts.force && (ts.mundane ?? isMundane(opts.job, opts.tier, opts.identity))) {
    const r = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
    const civ: PlayerAttrs = { str: r(2, 6), agi: r(3, 8), con: r(3, 8), int: r(2, 7), cha: r(3, 9), luck: r(1, 7) };
    if (ts.civBias) civ[ts.civBias] = r(7, 16);   // 侧重维(体/智/魅)略高，仍属常人范围
    return civ;
  }

  // 1. 资质潜力档：AI 档位 → 本阶窗口 ∩ 角色定位区间(纠偏 AI 判档偏高/偏低)
  let tk = clampToTierWindow(parseBioNum(opts.bioTier), tierNum);
  const [winLo, winHi] = [Math.min(9, Math.max(0, tierNum - 1)), Math.min(9, tierNum + 2)];
  const band = roleBand(opts.role);
  if (band) {
    const lo = Math.max(band[0], winLo), hi = Math.min(band[1], winHi);
    tk = lo <= hi ? Math.max(lo, Math.min(hi, tk)) : (band[1] < winLo ? winLo : winHi);
  }
  // 2. 等级成长：本阶内低等级把「实际档」往窗口下界压(治"1级却满属性")；Lv 满则 = tk
  const tierFloorLv = (tierNum - 1) * 10 + 1;
  const lvProg = clamp(((opts.level ?? 1) - tierFloorLv) / 9, 0, 1);
  const lvGrowth = LV_GROWTH_START + (1 - LV_GROWTH_START) * lvProg;
  const tkEff = clampToTierWindow(Math.round(winLo + (tk - winLo) * lvGrowth), tierNum);
  // 3. 生物强度档 → 单属性峰值上限(窗口顶档=满 Cap)；主属性 roll 到接近该上限
  const peakCap = peakCapForTier(tkEff, tierNum);
  const mainPeak = Math.round(min + (peakCap - min) * (0.92 + 0.08 * rng()));

  // 职业排序(类型/职业) + 流派(类型/推导) + 形态档(逐维处理策略)
  const arch = ts.arch;
  const order = JOB_ORDER[arch];
  // 形态：显式 form 段「只在非人形时」覆盖类型自带形态(免得 AI 习惯性填"人形"把 凶兽魔兽 的兽形打回人形)
  const explicitForm = (typeof opts.form === 'string' && opts.form) ? resolveForm(opts.form) : (opts.form as CreatureForm | undefined);
  const form: CreatureForm = (explicitForm && explicitForm !== 'humanoid') ? explicitForm : (ts.form || explicitForm || 'humanoid');
  const prof = FORM_PROFILE[form];
  const style = opts.style ?? ts.style ?? resolveStyle(undefined, tkEff, arch, opts.identity);
  const fall = STYLE_FALLOFF[style];

  // 4. 主属性=该档峰值 mainPeak，副属性按流派比例从主属性递减(+小抖动)
  const val: Record<keyof PlayerAttrs, number> = { str: min, agi: min, con: min, int: min, cha: min, luck: 0 };
  const span = Math.max(0, mainPeak - min);
  order.forEach((a, i) => {
    const jitter = i === 0 ? 0 : (rng() - 0.5) * 0.10 * span;   // 主属性不抖(锁峰值)，副属性小幅起伏
    val[a] = clamp(Math.round(min + span * fall[i] + jitter), min, peakCap);
  });
  val[order[0]] = clamp(mainPeak, min, peakCap);                // 主属性锁定该档峰值
  // 形态档逐维改写：weak/none 用绝对低值(脱离阶位，治"九阶妖兽智力8641")，boost 顶到本阶峰值(≤cap 保闭环)。
  // 主/次属性(order[0..1])受类型保护、形态不削——治"巫妖(warlock)int 被 undead 压成 9"，让智慧亡灵/法系非人保留核心维(骷髅兵 int 仍低=warrior 末位)。
  const protectedDims = new Set<keyof PlayerAttrs>([order[0], order[1]]);
  (['str', 'con', 'agi', 'int', 'cha'] as (keyof PlayerAttrs)[]).forEach((a) => {
    const rule = prof[a];
    if (rule === 'boost') val[a] = clamp(Math.round(min + span * (0.85 + 0.15 * rng())), min, peakCap); // 增强(可作用于主维)
    else if (protectedDims.has(a)) return;                                               // 主/次属性不被形态削弱
    else if (rule === 'none') val[a] = absNone(rng);                                     // 缺失≈1~3
    else if (rule === 'weak') val[a] = Math.min(val[a], absWeak(rng));                   // 退化≈3~12
  });

  // 4.5 五维总和上限（前端硬护栏·防"五维全顶"）：sumCap = 2×阶位上限 + 3×阶位下限（≈"至多两项满配 + 三项保底"）。
  //     超出则把「高于地板 min 的部分」等比例压回预算内：保留主次结构、不破 min 地板、不动被形态压到 min 以下的维(none/weak)。
  const sumCap = 2 * tierCap + 3 * min;
  const dims5: (keyof PlayerAttrs)[] = ['str', 'agi', 'con', 'int', 'cha'];
  const sum5 = dims5.reduce((t, a) => t + val[a], 0);
  if (sum5 > sumCap) {
    const lowBase = dims5.reduce((t, a) => t + Math.min(val[a], min), 0);  // 每维 ≤min 的部分(地板及被压维原样保留)
    const headroom = sum5 - lowBase;                                       // 高于地板的总余量
    const budget = Math.max(0, sumCap - lowBase);                         // 可保留的余量预算
    if (headroom > budget && headroom > 0) {
      const scale = budget / headroom;
      for (const a of dims5) if (val[a] > min) val[a] = min + Math.round((val[a] - min) * scale);
      console.log(`[NpcAttr] 五维总和 ${sum5}>${sumCap}（${tierNum}阶）→ 等比压回上限`);
    }
  }

  // 5. 幸运(单列，不进 5 项预算/不算战力)：抽到 generateLuck() 独立函数(前端独占·确定性)，正文 NPC 也复用同一套。
  const mean5 = (val.str + val.agi + val.con + val.int + val.cha) / 5;
  val.luck = generateLuck({ mean5, cap: peakCap, form, themeText: `${opts.job ?? ''}${opts.identity ?? ''}${opts.type ?? ''}`, seed: opts.seed });

  return { str: val.str, agi: val.agi, con: val.con, int: val.int, cha: val.cha, luck: val.luck };
}

/* ── 幸运·独立生成(前端独占·确定性)──────────────────────────────────────────────
   幸运是"特殊属性"：① 不进 5 项预算/不算战力(derivedStats 不读 luck)；② diceEngine.luckMod 比的是
   "幸运相对六维均值"，故常态压在 0~20 小数值、偶尔"天生幸运"才与五维同量级。由前端独占(AI 不定基础)，
   种子=NPC id → 确定性可复现；正文 NPC 的 ensureNpcLuck 与本函数同源，结果一致。
   常态=0~20 浮动；天生幸运(形态 boost / 幸运主题词命中 / ~15% 偶发)=mean5×(0.6~1.5) 随五维上下浮动(可远超 20)；
   形态档：none(机械·虫群·无命数)≈0~2、weak(亡灵·植物·黏)整体折半(倒霉)。 */
export const LUCK_THEME_RE = /幸运|福将|福星|气运|锦鲤|天命|吉运|好运|侥幸|赌|彩|鸿运|洪福|气数|命硬/;
export interface LuckOpts {
  mean5: number;                  // 五维均值(决定"天生幸运"档的量级，随五维上下浮动)
  cap?: number;                   // 上限(同单属性峰值；低阶<20 时仍放行到 20 以兑现"0~20")
  form?: string | CreatureForm;   // 形态(决定 none/weak/boost/keep)
  themeText?: string;             // 职业/身份/类型文本(命中幸运主题词→必走运)
  seed?: string;                  // 种子(NPC id)：独立 RNG，确定性可复现
}
export function generateLuck(o: LuckOpts): number {
  const rng = mulberry32(hashSeed(`${o.seed ?? 'luck'}|luck#`));
  const form: CreatureForm = (typeof o.form === 'string' && o.form) ? resolveForm(o.form) : ((o.form as CreatureForm) || 'humanoid');
  const rule: DimRule = FORM_PROFILE[form].luck;
  const themed = !!o.themeText && LUCK_THEME_RE.test(o.themeText);
  const luckyBorn = rule === 'boost' || themed || rng() < 0.15;        // 偶发/主题/形态 → 天生幸运
  // 幸运恒锁死在 0~20（特殊属性，量级与五维无关，绝不随五维膨胀）：天生幸运取高位 12~20，常态全区间 0~20。
  let luck = luckyBorn ? 12 + Math.floor(rng() * 9) : Math.floor(rng() * 21);
  if (rule === 'none') luck = Math.floor(rng() * 3);                   // 机械/虫群·无命数≈0~2
  else if (rule === 'weak') luck = Math.round(luck * 0.5);             // 亡灵/植物/黏·倒霉折半
  return clamp(luck, 0, 20);
}
