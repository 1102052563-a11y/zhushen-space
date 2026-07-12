/* 随从·队友「世界结算」同步发放（前端确定性）。
   背景：世界结算只给主角发属性点/技能点，标记为「随从/宠物/召唤/羁绊/临时队友」的 NPC 明明一路随主角闯世界，
        却拿不到任何成长——用户反馈「标记为随从的 NPC 没有同步结算」。
   方案：主角结算发点的**同一回合**，前端读主角本次所得，按同项折算（默认主角的一半）为每名合格随从一并入账：
        · 四阶及以上随从 → 发「真实属性点」(realAttrPoints)；三阶及以下 → 发「普通属性点」(attrPoints)（与主角口径一致）；
        · 技能点(skillPoints)照发。
   为何不让正文 AI 逐个写 `character.C*.attrPoints`：AI 易漏人、写错 ID、凭空膨胀（违背「忠于原文不膨胀」铁律）；
        确定性发放稳、可测、且与主角结算同源（读主角 += 点数），不会双入账。随从加点消耗仍走 NpcDetail 面板。 */
import { TIERS, normalizeTier } from './derivedStats';

export interface CompanionLike {
  id: string;
  name?: string;
  realm?: string;
  onScene?: boolean;
  isDead?: boolean;
  isBond?: boolean;       // 羁绊/开局随行（createCompanion）——主角核心随从
  partyMember?: boolean;  // 当前临时队友
  npcTag?: string;        // 标签：契约者/土著/随从/宠物/召唤物
}

export interface PlayerSettlementAward {
  attrPoints: number;      // 主角本次结算获得的普通属性点
  realAttrPoints: number;  // 主角本次结算获得的真实属性点
  skillPoints: number;     // 主角本次结算获得的技能点
}

export interface CompanionAward {
  id: string;
  name: string;
  attrPoints: number;      // 本次应发增量（普通属性点·三阶及下随从）
  realAttrPoints: number;  // 本次应发增量（真实属性点·四阶+随从）
  skillPoints: number;     // 本次应发增量（技能点）
}

/** 随从结算折算比例：随从每人所得 = 主角同项 × 此比例（向下取整）。
 *  0.5＝主角的一半——既让随行队伍随主角同步成长，又保主角作为主角领先。想更慷慨/更保守改这里即可。 */
export const COMPANION_SETTLE_RATIO = 0.5;
/** 单次结算最多同步这么多随从，防病态大队伍拖慢/无限。 */
export const MAX_SETTLE_COMPANIONS = 24;

/** 该 NPC 本次是否参与随从结算：未死亡、有真名，且为主角的随行者——
 *  羁绊(isBond)或临时队友(partyMember)恒计入；否则须「在场」且标签为 随从/宠物/召唤/眷属/伙伴。
 *  纯路人契约者、土著不计（他们不随主角结算世界之源）。 */
export function isSettlingCompanion(n: CompanionLike): boolean {
  if (!n || n.isDead) return false;
  if (!n.name || n.name === n.id) return false;            // 无真名的占位/幻觉档不发
  if (n.isBond || n.partyMember) return true;              // 核心随从 / 当前队友：恒结算
  return !!n.onScene && /随从|宠物|召唤|眷属|伙伴/.test(n.npcTag || '');
}

/** 某阶位是否「四阶及以上」（六维即真实属性 → 发真实属性点）。取不到阶位按普通(false)。 */
function isTrueAttrTier(realm?: string): boolean {
  return TIERS.indexOf((normalizeTier(realm) || '') as (typeof TIERS)[number]) >= 3;   // 四阶=idx3
}

/** 据主角本次结算所得 + 全体 NPC 名单，算出每名合格随从应发的属性点/技能点增量（只返回有增量者）。
 *  纯函数、无副作用、可单测；调用方负责把增量 upsert 进各 NPC。 */
export function computeCompanionAwards(
  player: PlayerSettlementAward,
  npcs: CompanionLike[],
  opts?: { ratio?: number },
): CompanionAward[] {
  const ratio = opts?.ratio ?? COMPANION_SETTLE_RATIO;
  // 主角本次「属性点池」= 普通 + 真实（主角只会拿其一，合计即为其档位对应的属性点数）
  const attrTotal = Math.max(0, Math.round(player.attrPoints || 0)) + Math.max(0, Math.round(player.realAttrPoints || 0));
  const skillTotal = Math.max(0, Math.round(player.skillPoints || 0));
  const awardAttr = Math.floor(attrTotal * ratio);
  const awardSkill = Math.floor(skillTotal * ratio);
  if (awardAttr <= 0 && awardSkill <= 0) return [];          // 主角这次几乎没拿点数 → 随从也不发（E/D 微通关）
  const out: CompanionAward[] = [];
  for (const c of npcs) {
    if (out.length >= MAX_SETTLE_COMPANIONS) break;
    if (!isSettlingCompanion(c)) continue;
    const real = isTrueAttrTier(c.realm);                    // 随从按**自己的**阶位决定发真实还是普通属性点
    out.push({
      id: c.id,
      name: c.name || c.id,
      attrPoints: real ? 0 : awardAttr,
      realAttrPoints: real ? awardAttr : 0,
      skillPoints: awardSkill,
    });
  }
  return out;
}
