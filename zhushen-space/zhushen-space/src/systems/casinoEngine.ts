import { TIERS, normalizeTier } from './derivedStats';

/* ════════════════════════════════════════════
   轮回赌坊 · 确定性结算引擎（drpg-casino）
   - 摇率 / 赔率 / 抽水 / 限红 全在这里算，不花 API（与 enhanceEngine / diceEngine 同构）
   - 真随机用 rng()（Math.random），原始点数对外暴露 → 公平可审计
   - MVP 三玩法：猜大小·骰宝 / 轮回转盘 / 天命翻倍梯子
   - 货币：普通厅吃乐园币→普通筹码，贵宾厅(≥vipMinTier 阶位)吃魂币→魂筹
   - 设计见记忆 casino-feature
════════════════════════════════════════════ */

export type ChipKind = 'normal' | 'soul';

/** 全场可调参（CasinoManager 滑块旋钮，2/3 期接）。庄家优势透明展示用。 */
export interface CasinoConfig {
  enabled: boolean;
  exchangeFeePct: number;   // 买筹码抽水（乐园币/魂币 → 筹码的损耗），0~0.2
  cashoutFeePct: number;    // 兑现损耗（筹码 → 乐园币/魂币）
  vipMinTier: number;       // 贵宾厅解锁阶位（1-based，默认 5 = 五阶起）
  ladderWinChance: number;  // 翻倍梯子每级胜率（<0.5 即庄家优势），默认 0.47
  ladderMaxSteps: number;   // 翻倍梯子封顶级数，默认 10（最高 2^10=1024 倍）
  bankruptcyGrant: number;  // 破产保护：筹码归零时补发的普通筹码
  gachaCostSoul: number;    // 命运福袋单抽花费（魂币）；十连 = ×10
  limits: { normalMin: number; normalMax: number; soulMin: number; soulMax: number };
  version: number;
}

export const CONFIG_VERSION = 2;

export const DEFAULT_CASINO_CONFIG: CasinoConfig = {
  enabled: true,
  exchangeFeePct: 0.02,
  cashoutFeePct: 0,
  vipMinTier: 5,
  ladderWinChance: 0.47,
  ladderMaxSteps: 10,
  bankruptcyGrant: 100,
  gachaCostSoul: 1,
  limits: { normalMin: 10, normalMax: 5000, soulMin: 1, soulMax: 200 },
  version: CONFIG_VERSION,
};

/** 1 乐园币 = 1 普通筹码；1 魂币 = 1 魂筹（基线 1:1，损耗在兑换费里体现）。 */
export const COIN_PER_CHIP = 1;

function rng(): number { return Math.random(); }
function dieRoll(): number { return Math.floor(rng() * 6) + 1; }

/* ─────────── 筹码兑换 ─────────── */

/** 买筹码：花 spend 单位货币，扣 feePct 抽水后到手筹码（向下取整）。 */
export function buyChipsQuote(spend: number, feePct: number): { chips: number; spend: number } {
  const s = Math.max(0, Math.floor(spend));
  const chips = Math.floor((s / COIN_PER_CHIP) * (1 - feePct));
  return { chips, spend: s };
}
/** 兑现：拿 chips 筹码换回货币，扣 feePct 抽水。 */
export function cashOutQuote(chips: number, feePct: number): { coins: number; chips: number } {
  const c = Math.max(0, Math.floor(chips));
  const coins = Math.floor(c * COIN_PER_CHIP * (1 - feePct));
  return { coins, chips: c };
}

/* ─────────── 玩法 1：猜大小·骰宝 ─────────── */

export type SicboBetKind = 'big' | 'small' | 'triple' | 'single';
export interface SicboBet { kind: SicboBetKind; point?: number; amount: number; }
export interface SicboRoll { dice: [number, number, number]; sum: number; isTriple: boolean; }

/** 赔率（净赔付倍数，押注本金另返）。豹子=任意三同；single=按出现次数 k 赔 k:1。 */
export const SICBO_ODDS = { big: 1, small: 1, triple: 30 } as const;

export function rollSicbo(): SicboRoll {
  const dice: [number, number, number] = [dieRoll(), dieRoll(), dieRoll()];
  const sum = dice[0] + dice[1] + dice[2];
  const isTriple = dice[0] === dice[1] && dice[1] === dice[2];
  return { dice, sum, isTriple };
}

/** 结算：返回净筹码变动 profit（赢=+本金×赔率，输=−本金）。 */
export function settleSicbo(bet: SicboBet, roll: SicboRoll): { win: boolean; payoutOdds: number; profit: number; label: string } {
  const a = bet.amount;
  if (bet.kind === 'big' || bet.kind === 'small') {
    if (roll.isTriple) return { win: false, payoutOdds: 1, profit: -a, label: '豹子通杀' };
    const isBig = roll.sum >= 11 && roll.sum <= 17;
    const win = bet.kind === 'big' ? isBig : !isBig;
    return { win, payoutOdds: 1, profit: win ? a : -a, label: isBig ? '大' : '小' };
  }
  if (bet.kind === 'triple') {
    const win = roll.isTriple;
    return { win, payoutOdds: SICBO_ODDS.triple, profit: win ? a * SICBO_ODDS.triple : -a, label: win ? `豹子 ${roll.dice[0]}` : '非豹子' };
  }
  // single：押某点数，出现 k 次赔 k:1
  const k = roll.dice.filter((d) => d === bet.point).length;
  return { win: k > 0, payoutOdds: k, profit: k > 0 ? a * k : -a, label: k > 0 ? `点${bet.point}×${k}` : `无${bet.point}` };
}

/* ─────────── 玩法 2：轮回转盘（单零欧式） ─────────── */

export type RouletteBetKind = 'red' | 'black' | 'odd' | 'even' | 'high' | 'low' | 'straight';
export interface RouletteBet { kind: RouletteBetKind; number?: number; amount: number; }

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export function rouletteColor(n: number): 'red' | 'black' | 'green' {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

/** 0 = 「轮回归零」绿格，通杀所有平赔注。 */
export function spinRoulette(): number { return Math.floor(rng() * 37); }

export function settleRoulette(bet: RouletteBet, pocket: number): { win: boolean; payoutOdds: number; profit: number; label: string } {
  const a = bet.amount;
  const color = rouletteColor(pocket);
  if (bet.kind === 'straight') {
    const win = bet.number === pocket;
    return { win, payoutOdds: 35, profit: win ? a * 35 : -a, label: `${pocket}` };
  }
  if (pocket === 0) return { win: false, payoutOdds: 1, profit: -a, label: '轮回归零·通杀' };
  let win = false;
  if (bet.kind === 'red') win = color === 'red';
  else if (bet.kind === 'black') win = color === 'black';
  else if (bet.kind === 'odd') win = pocket % 2 === 1;
  else if (bet.kind === 'even') win = pocket % 2 === 0;
  else if (bet.kind === 'high') win = pocket >= 19;
  else if (bet.kind === 'low') win = pocket <= 18;
  return { win, payoutOdds: 1, profit: win ? a : -a, label: `${pocket} ${color === 'red' ? '红' : '黑'}` };
}

/* ─────────── 玩法 3：天命翻倍梯子 ─────────── */

/** 单级开盅：胜→true（彩池翻倍），负→false（彩池清零）。 */
export function ladderRoll(winChance: number): boolean { return rng() < winChance; }

/** 第 step 级（0-based 已赢级数）继续后的潜在彩池。 */
export function ladderPotAt(bet: number, step: number): number { return bet * Math.pow(2, step); }

/* ─────────── 玩法 4：角斗场对赌（两名角斗士对战，押注谁胜） ───────────
   - 两名角斗士由一次 API 生成（含种族/阶位/战斗风格/六维/技能/专家评估），阶位差≤1
   - 赔率由前端按生物战力差**确定性**算（公开透明、不可被 AI 幻觉操纵），庄家抽水 8%
   - 胜负在玩家下注后由前端按胜率**预先掷定**，再让 AI 据此叙述整场数据化战斗（保证赔率公平）
   - 战斗过程（分回合 HP/buff/技能）由 AI 生成结构化数据，前端动画逐回合回放 */

export interface Gladiator {
  name: string;
  race: string;          // 种族（取自万族「种族」列表或 AI 自创）
  tier: string;          // 阶位
  level: number;         // 等级（影响赔率）
  profession: string;    // 职业（影响技能/物品/天赋走向）
  rareProfession: boolean; // 是否稀有/隐藏职业（影响赔率）
  bioStrength: string;   // 生物强度档（T0~T9，如「T5·战将」，影响赔率）
  gender: string;
  style: string;         // 战斗风格（如 狂战压制 / 元素远击 / 刺杀游斗）
  attrs: { str: number; agi: number; con: number; int: number; cha: number; luck: number };
  skills: { name: string; effect: string }[];   // 数量随阶位递增（一阶≥5 … 七阶≥11）
  talents: { name: string; effect: string }[];   // 天赋，数量随阶位递增（一阶1~2 … 七阶5~6）
  items: { name: string; effect: string }[];     // 储存空间，数量随阶位递增（一阶≥6 … 七阶≥12）
  appearance: string;
  imagePrompt?: string;   // 生图提示词（AI 据外观生成的英文标签）
  portrait?: string;      // 立绘 dataURL（自动肖像开启时生成；不持久化到 localStorage）
  hpMax: number;
}
export interface GladiatorEval { strengths: string; weaknesses: string; comment: string; verdict: string; }
/** 一个战斗回合的结构化数据（AI 生成 → 前端动画回放） */
export interface BattleRound {
  round: number;
  actor: 0 | 1;            // 本回合出手方
  action: string;         // 招式/技能名
  desc: string;           // 详细叙述（攻防化解过程）
  damage: number;         // 本回合造成的伤害
  hp: [number, number];   // 本回合结束后双方剩余 HP
  buffs: [string[], string[]];   // 本回合结束后双方身上的增益/减益标签
  os: [string, string];   // 本回合双方的内心独白（OS），[一号位, 二号位]
}
export interface GladiatorMatch {
  id: string;
  fighters: [Gladiator, Gladiator];
  evals: [GladiatorEval, GladiatorEval];
  odds: [number, number];        // 十进制赔率（含本金，净赢 = 注 ×(odds−1)）
  winProb: [number, number];
  kind: ChipKind;
  status: 'ready' | 'fighting' | 'done';
  bet: { side: 0 | 1; amount: number } | null;
  result: { winner: 0 | 1; rounds: BattleRound[]; summary: string } | null;
}

/** 生物战力：六维加权 + 阶位权重 + 等级 + 生物强度档 + 稀有职业加成（同阶位也据此拉开赔率）。 */
export function gladiatorPower(g: Gladiator): number {
  const a = g.attrs;
  const base = a.str * 1 + a.agi * 0.85 + a.con * 1 + a.int * 0.85 + a.cha * 0.2 + a.luck * 0.3;
  const ti = TIERS.indexOf(normalizeTier(g.tier) as typeof TIERS[number]);
  const tierW = Math.max(0, ti) * 45;
  const lvW = Math.max(0, g.level || 0) * 0.6;                       // 等级权重
  const bs = parseInt((g.bioStrength || '').match(/T(\d+)/)?.[1] || '0', 10);
  const bsW = bs * 28;                                               // 生物强度档 T0~T9 权重
  const rareMul = g.rareProfession ? 1.12 : 1;                       // 稀有/隐藏职业整体加成
  return (base + tierW + lvW + bsW) * rareMul;
}

const GLAD_HOUSE_EDGE = 0.08;

/** 按战力差算赔率与胜率。胜率夹在 [0.25,0.75] 保证两边都可下注。 */
export function computeGladiatorOdds(a: Gladiator, b: Gladiator): { odds: [number, number]; winProb: [number, number] } {
  const pa = gladiatorPower(a), pb = gladiatorPower(b);
  let wa = pa / (pa + pb || 1);
  wa = Math.max(0.25, Math.min(0.75, wa));
  const wb = 1 - wa;
  const mk = (w: number) => Math.max(1.05, Math.round((1 / w) * (1 - GLAD_HOUSE_EDGE) * 100) / 100);
  return { odds: [mk(wa), mk(wb)], winProb: [wa, wb] };
}

/** 下注后按胜率掷定胜者（确定性结果 → 再交给 AI 叙述）。 */
export function rollGladiatorWinner(winProbA: number): 0 | 1 { return rng() < winProbA ? 0 : 1; }

/** 角斗场结算：押中 → 净赢 注 ×(赔率−1)，押错 → −注。 */
export function settleGladiatorBet(betSide: 0 | 1, amount: number, winner: 0 | 1, odds: [number, number]): { win: boolean; profit: number } {
  const win = betSide === winner;
  return { win, profit: win ? Math.round(amount * (odds[betSide] - 1)) : -amount };
}

/* ─────────── 玩法 5：夺命21点（Blackjack） ───────────
   与荷官比点，越接近 21 越好、超过即爆；庄家停在 17。天生黑杰克(首两张=21) 赔 1.5。 */
export interface Card { rank: number; suit: number; }   // rank 1-13(A=1), suit 0-3
export type BlackjackOutcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';
export interface BlackjackState {
  kind: ChipKind;
  bet: number;
  player: Card[];
  dealer: Card[];
  status: 'playing' | 'done';
  doubled: boolean;
  outcome?: BlackjackOutcome;
}

export function drawCard(): Card { return { rank: Math.floor(rng() * 13) + 1, suit: Math.floor(rng() * 4) }; }

/** 手牌点数：花牌=10、A 先记 1，若整手+10 不爆则升一张 A 为 11（soft）。 */
export function handValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0, aces = 0;
  for (const c of cards) { total += c.rank >= 10 ? 10 : c.rank; if (c.rank === 1) aces++; }
  if (aces > 0 && total + 10 <= 21) return { total: total + 10, soft: true };
  return { total, soft: false };
}
export function isBlackjack(cards: Card[]): boolean { return cards.length === 2 && handValue(cards).total === 21; }

/** 庄家补牌：停在 17（含软17停）。 */
export function dealerPlay(dealer: Card[]): Card[] {
  const d = [...dealer];
  let guard = 0;
  while (handValue(d).total < 17 && guard++ < 12) d.push(drawCard());
  return d;
}

/** 结算：黑杰克 1.5×，胜 1×，平 0，负/爆 −注（doubled 时注金翻倍，但天生黑杰克不受 double 影响）。 */
export function settleBlackjack(player: Card[], dealer: Card[], bet: number, doubled: boolean): { outcome: BlackjackOutcome; profit: number } {
  const stake = doubled ? bet * 2 : bet;
  const pv = handValue(player).total, dv = handValue(dealer).total;
  const pBJ = isBlackjack(player), dBJ = isBlackjack(dealer);
  if (pv > 21) return { outcome: 'bust', profit: -stake };
  if (pBJ && !dBJ) return { outcome: 'blackjack', profit: Math.round(bet * 1.5) };
  if (pBJ && dBJ) return { outcome: 'push', profit: 0 };
  if (dBJ) return { outcome: 'lose', profit: -stake };
  if (dv > 21 || pv > dv) return { outcome: 'win', profit: stake };
  if (pv < dv) return { outcome: 'lose', profit: -stake };
  return { outcome: 'push', profit: 0 };
}

/* ─────────── 玩法 6：魂赌剧情局（魂币贵宾厅·魔笼主持·AI 叙述） ───────────
   押珍贵之物与命运对赌：胜负前端按 winChance 掷定（公平），AI 据预定结果叙述剧情；奖惩前端确定性发放。 */
export type SoulStakeKind = 'soulcoin' | 'item' | 'talent';
export interface SoulStakeDef {
  kind: SoulStakeKind;
  label: string;
  emoji: string;
  desc: string;
  winChance: number;    // 高风险高回报 → 略低于五成
  payoutMul: number;    // 数额型赢面倍数（净赢 = 注 ×(payoutMul−1)）；非数额型为 0
  needsAmount: boolean;
  needsItem: boolean;
}
export const SOUL_STAKES: SoulStakeDef[] = [
  { kind: 'soulcoin', label: '魂币',     emoji: '💠', desc: '押上魂币，赢则翻倍有余，输则尽数没入笼中。',           winChance: 0.45, payoutMul: 2.2, needsAmount: true,  needsItem: false },
  { kind: 'item',     label: '本命装备', emoji: '⚔️', desc: '押上一件装备，赢得魂币彩头并保住它，输则装备当场销毁。', winChance: 0.48, payoutMul: 0,   needsAmount: false, needsItem: true  },
  { kind: 'talent',   label: '一分天资', emoji: '🩸', desc: '押上自身天资，赢得丰厚回报，输则一项六维受损。',         winChance: 0.40, payoutMul: 0,   needsAmount: false, needsItem: false },
];
export function soulStake(kind: SoulStakeKind): SoulStakeDef { return SOUL_STAKES.find((s) => s.kind === kind) ?? SOUL_STAKES[0]; }
export function rollSoulWin(chance: number): boolean { return rng() < chance; }

/* ─────────── 展示用：庄家优势/返还率 ─────────── */

export function houseEdgeLabel(game: 'sicbo' | 'roulette' | 'ladder' | 'gladiator' | 'blackjack', cfg: CasinoConfig): string {
  if (game === 'sicbo') return '大/小 ≈2.8% · 豹子30:1 · 单点按次数';
  if (game === 'roulette') return '平赔≈2.7% · 单号35:1（0 通杀）';
  if (game === 'gladiator') return '赔率按战力差实算 · 抽水8%';
  if (game === 'blackjack') return '庄家停17 · 黑杰克1.5× · 可加倍';
  return `每级胜率 ${Math.round(cfg.ladderWinChance * 100)}%（见好就收）`;
}
