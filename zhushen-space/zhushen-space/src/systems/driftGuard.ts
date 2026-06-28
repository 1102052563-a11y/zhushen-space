/* 防漂哨（差分对账·确定性强制）——专治"队友前回合1500血肉盾、后回合300血脆皮"这类六维/HP 无据漂移。
 *
 * 思路对齐原版数据库：它的 NPC 六维是表里的单元格，没被 UPDATE 就字节级冻结。我们演化是"重生成"，
 * 所以改用**事后强制**：拿演化后的六维和"回合初基线"逐项比对——凡是变了、但本回合正文没给出理由的，一律退回基线。
 * 幸运(luck)由 ensureNpcLuck 独占机械生成，不在此守，只守 力/敏/体/智/魅 这五维（HP 上限由体质驱动，守住即不再崩）。
 */

/** 受守护的稳定五维（幸运另有机制）。*/
export const STABLE_DIMS = ['str', 'agi', 'con', 'int', 'cha'] as const;

type Attrs = Record<string, number | undefined>;

/* 能"正当地"让六维变动的剧情关键词：成长/突破/受创/中毒/转化…正文出现其一且点了该角色名，才放行本轮的六维改动。*/
const ATTR_CHANGE_KW = /突破|进阶|晋阶|晋级|升阶|越阶|成长|蜕变|觉醒|进化|转职|变身|化形|筑基|破境|淬体|脱胎|易筋|血脉|重伤|受创|残废|断[肢臂腿]|被废|废[了掉]|衰弱|虚弱|中毒|腐蚀|削弱|压制|封印|诅咒|衰老|返老|吞噬|夺[取走]|融合|强化|暴涨|飙升|锐减|暴跌|提升|增强|恢复|痊愈|大成|突飞猛进|脱胎换骨/;

/** 稳定五维是否发生了变化（任一不等即 true）。*/
export function attrsDiffer(a?: Attrs, b?: Attrs): boolean {
  if (!a || !b) return false;
  return STABLE_DIMS.some((k) => Number(a[k] ?? 0) !== Number(b[k] ?? 0));
}

/** 本轮该角色的六维变动是否"有正文理由"：阶位/等级变了，或正文点了其名 + 出现成长/受创类关键词。*/
export function attrChangeJustified(name: string, realmBefore: string, realmAfter: string, narrative: string): boolean {
  if ((realmBefore || '').trim() !== (realmAfter || '').trim()) return true;   // 阶位/等级变了 → 六维随之变合理
  const nm = (name || '').trim();
  if (!narrative || nm.length < 2 || !narrative.includes(nm)) return false;
  return ATTR_CHANGE_KW.test(narrative);
}

/** 把 next 的稳定五维退回 base，保留 next 的其余字段（含幸运）。*/
export function revertStableDims(base: Attrs, next: Attrs): Attrs {
  const out: Attrs = { ...next };
  for (const k of STABLE_DIMS) out[k] = base[k];
  return out;
}

/* ── 技能 / 天赋 效果防漂（治"一个技能5回合改3次效果""队友天赋乱变"）── */

/** 技能里"已确立、不该每回合被重写"的字段。*/
export const SKILL_GUARD_FIELDS = ['effect', 'desc', 'level', 'rarity', 'attrBonus', 'damage', 'layers', 'layerEffects', 'cost', 'cooldown'] as const;
/** 天赋同理。*/
export const TRAIT_GUARD_FIELDS = ['effect', 'desc', 'rarity', 'attrBonus', 'level', 'category'] as const;

/* 能"正当地"让技能/天赋变动的剧情关键词：升级/突破/精进/受创/封印…。*/
const ENTITY_CHANGE_KW = /升级|进阶|晋级|升阶|越阶|突破|精进|领悟|参悟|顿悟|蜕变|强化|觉醒|进化|提升|增强|熟练|大成|圆满|层数|进步|精通|改良|淬炼|演化|融合|变招|新招|残缺|削弱|遗忘|封印|损坏|被夺|失传|废[了掉]|重伤|受创/;

const isEmpty = (v: unknown): boolean =>
  v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

/** 返回 base→next 之间**漂移**的字段：仅当 base 的该字段**非空**且与 next 不同才算（base 为空=允许首次补全，不算漂移）。*/
export function changedFields(base: any, next: any, fields: readonly string[]): string[] {
  if (!base || !next) return [];
  return fields.filter((f) => {
    if (isEmpty(base[f])) return false;            // 基线为空 → 允许补全，不守
    return JSON.stringify(base[f]) !== JSON.stringify(next[f]);
  });
}

/** 该条目（技能/天赋）本轮变动是否"有正文理由"：正文点了其名 + 出现升级/受创类关键词。*/
export function entityChangeJustified(name: string, narrative: string): boolean {
  const nm = (name || '').trim();
  if (!narrative || nm.length < 2 || !narrative.includes(nm)) return false;
  return ENTITY_CHANGE_KW.test(narrative);
}

/** 取 base 里指定字段，组成一个回退用的 patch。*/
export function pickFields(base: any, fields: readonly string[] | string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of fields) out[f] = base?.[f];
  return out;
}

/* ── 物品字段防漂（治"已有物品被无故改属性/词缀/品级"）──
 * 物品有合法的"非剧情churn"(强化刷词缀/镶嵌宝石/堆叠数量)，故分两档守：
 *  - 身份字段：永不该漂，恒守（强化/镶嵌/堆叠都不碰它们）。
 *  - 战斗字段：仅当该物本回合**没被强化/镶嵌/改数量**时才守（被动过→那几项变化是确定性系统的合法结果，不退）。 */
export const ITEM_ID_FIELDS = ['name', 'category', 'subType', 'origin', 'requirement'] as const;
export const ITEM_COMBAT_FIELDS = ['effect', 'affix', 'combatStat', 'gradeDesc', 'score', 'intro', 'appearance'] as const;

/** 势力里"身份/实力锚点"字段：类型/规模/实力/首领——不该无剧情地翻（大宗门变小帮派、首领凭空换人）。
 *  goal/resources/background/status/favorToPlayer 等会随剧情自然增长/变化，不守。*/
export const FACTION_GUARD_FIELDS = ['type', 'scale', 'powerLevel', 'leader'] as const;

/** NPC 描述/身份字段：外貌基底/性别/性格/职业——没明确事件不该变（治"外貌描写乱变""肉盾→法师"角色翻转）。
 *  realm 含 Lv（升级合法变）、background 会增长，故不在此守。*/
export const NPC_PROFILE_GUARD_FIELDS = ['appearanceDetail', 'gender', 'personality', 'profession'] as const;
/** 主角描述/身份字段：基底外观(不可变) + 职业。六维由前端加点掌控、技能由 characterStore 守，故不在此。*/
export const PLAYER_PROFILE_GUARD_FIELDS = ['baseAppearance', 'profession'] as const;

/* 外貌/身份类变动的正文事件关键词（染发/换瞳/整容/变身/转职…）：无需点名，主角/在场角色都适用。*/
const PROFILE_CHANGE_KW = /染发|换瞳|改造|异变|整容|易容|毁容|改头换面|返老|衰老|断[肢臂腿手]|增高|长高|变身|化形|蜕变|觉醒|进化|脱胎换骨|血脉|易筋|改身高|转职|改行|拜师|入门|转换/;
export function profileChangeJustified(narrative: string): boolean {
  return !!narrative && PROFILE_CHANGE_KW.test(narrative);
}

/** 名称归一相等（去标点/空格），技能用 id 匹配不到时的兜底。*/
export function sameName(a?: string, b?: string): boolean {
  const n = (x?: string) => (x ?? '').replace(/[\s·•・\-—_,，.。、|｜【】（）()的之]/g, '').trim().toLowerCase();
  const x = n(a), y = n(b);
  return !!x && x === y;
}
