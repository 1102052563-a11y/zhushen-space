import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_CASINO_CONFIG, CONFIG_VERSION,
  drawCard, dealerPlay, settleBlackjack, isBlackjack, handValue,
  type CasinoConfig, type ChipKind, type GladiatorMatch, type BattleRound,
  type BlackjackState, type BlackjackOutcome,
} from '../systems/casinoEngine';
import { awardCasinoHonors } from '../systems/casinoHonors';
import { bestRarity, type GachaReward } from '../systems/casinoGacha';

const BJ_LABEL: Record<BlackjackOutcome, string> = { blackjack: '黑杰克!', win: '胜', push: '平局', lose: '负', bust: '爆牌' };

/* ════════════════════════════════════════════
   轮回赌坊 store（drpg-casino）
   - chips/soulChips = 筹码余额（属游戏进度，新游戏清空；由乐园币/魂币兑换而来）
   - stats = 战绩（输赢/连胜连败/最大单局，达标可授称号·成就，2 期接）
   - ladder = 天命翻倍梯子的进行态（持久化 → 刷新可恢复，仿 dice 草稿）
   - config = 全场可调参（限红/抽水/胜率，配置项，新游戏保留、走 configExport，3 期接）
   - 设计见记忆 casino-feature
════════════════════════════════════════════ */

export interface CasinoStats {
  hands: number;
  wagered: number;
  won: number;       // 累计赢得筹码（毛）
  lost: number;      // 累计输掉筹码（毛）
  biggestWin: number;
  winStreak: number;
  loseStreak: number;
  bestWinStreak: number;
}

export interface LadderState {
  kind: ChipKind;
  bet: number;       // 底注
  pot: number;       // 当前彩池
  step: number;      // 已赢级数
  busted: boolean;   // 翻错清零
}

export interface CasinoLogEntry {
  game: 'sicbo' | 'roulette' | 'ladder' | 'gladiator' | 'blackjack' | 'gacha' | 'soul' | 'exchange';
  text: string;
  delta: number;     // 净筹码变动（兑换记 0）
  kind: ChipKind;
  ts: number;
}

const DEFAULT_STATS: CasinoStats = {
  hands: 0, wagered: 0, won: 0, lost: 0, biggestWin: 0,
  winStreak: 0, loseStreak: 0, bestWinStreak: 0,
};

interface CasinoState {
  chips: number;        // 普通筹码（乐园币兑换）
  soulChips: number;    // 魂筹（魂币兑换，贵宾厅）
  config: CasinoConfig;
  stats: CasinoStats;
  ladder: LadderState | null;
  gladiator: GladiatorMatch | null;
  blackjack: BlackjackState | null;
  gachaPity: number;                 // 命运福袋账号级保底计数
  gachaLast: GachaReward[] | null;   // 最近一次抽取结果（展示用）
  log: CasinoLogEntry[];

  addChips: (kind: ChipKind, delta: number) => void;
  /** 结算一局：profit 为净筹码变动（赢正输负），wagered 为本金。更新余额/战绩/流水。 */
  recordResult: (game: CasinoLogEntry['game'], kind: ChipKind, profit: number, wagered: number, text: string) => void;
  logExchange: (kind: ChipKind, text: string) => void;

  startLadder: (kind: ChipKind, bet: number) => void;
  ladderAdvance: (won: boolean, newPot: number, step: number) => void;
  cashoutLadder: () => void;     // 把当前 pot 计入余额并清掉梯子
  clearLadder: () => void;

  setGladiatorMatch: (m: GladiatorMatch | null) => void;
  setGladiatorBet: (side: 0 | 1, amount: number) => void;
  setGladiatorResult: (winner: 0 | 1, rounds: BattleRound[], summary: string) => void;
  setGladiatorPortrait: (idx: 0 | 1, url: string) => void;
  clearGladiator: () => void;

  startBlackjack: (kind: ChipKind, bet: number) => void;
  bjHit: () => void;
  bjStand: () => void;
  bjDouble: () => void;
  clearBlackjack: () => void;

  /** 应用一次福袋抽取：记结果 + 推进保底 + 流水（魂币扣除/奖励发放在调用方）。 */
  applyGachaPull: (rewards: GachaReward[], newPity: number) => void;
  clearGachaLast: () => void;

  /** 魂赌一局收尾：记一条流水（奖惩已由调用方落库）。 */
  logSoul: (text: string, delta: number) => void;

  /** 破产保护：两种筹码都为 0 时补发普通筹码，返回是否补发。 */
  claimBankruptcyGrant: () => boolean;

  setConfig: (patch: Partial<CasinoConfig>) => void;
  resetStats: () => void;
  clearCasino: () => void;
}

export const useCasino = create<CasinoState>()(
  persist(
    (set, get) => ({
      chips: 0,
      soulChips: 0,
      config: { ...DEFAULT_CASINO_CONFIG },
      stats: { ...DEFAULT_STATS },
      ladder: null,
      gladiator: null,
      blackjack: null,
      gachaPity: 0,
      gachaLast: null,
      log: [],

      addChips: (kind, delta) =>
        set((s) => kind === 'soul'
          ? { soulChips: Math.max(0, s.soulChips + delta) }
          : { chips: Math.max(0, s.chips + delta) }),

      recordResult: (game, kind, profit, wagered, text) => {
        set((s) => {
          const balKey = kind === 'soul' ? 'soulChips' : 'chips';
          const bal = Math.max(0, (s as any)[balKey] + profit);
          const win = profit > 0;
          const stats: CasinoStats = {
            ...s.stats,
            hands: s.stats.hands + 1,
            wagered: s.stats.wagered + Math.max(0, wagered),
            won: s.stats.won + (profit > 0 ? profit : 0),
            lost: s.stats.lost + (profit < 0 ? -profit : 0),
            biggestWin: Math.max(s.stats.biggestWin, profit),
            winStreak: win ? s.stats.winStreak + 1 : 0,
            loseStreak: win ? 0 : s.stats.loseStreak + 1,
            bestWinStreak: Math.max(s.stats.bestWinStreak, win ? s.stats.winStreak + 1 : 0),
          };
          const entry: CasinoLogEntry = { game, kind, text, delta: profit, ts: Date.now() };
          return { [balKey]: bal, stats, log: [entry, ...s.log].slice(0, 60) } as any;
        });
        awardCasinoHonors(get().stats);
      },

      logExchange: (kind, text) =>
        set((s) => ({ log: [{ game: 'exchange', kind, text, delta: 0, ts: Date.now() }, ...s.log].slice(0, 60) })),

      startLadder: (kind, bet) =>
        set((s) => {
          const balKey = kind === 'soul' ? 'soulChips' : 'chips';
          if ((s as any)[balKey] < bet) return {} as any;   // 余额不足，调用方应先校验
          return { [balKey]: (s as any)[balKey] - bet, ladder: { kind, bet, pot: bet, step: 0, busted: false } } as any;
        }),

      ladderAdvance: (won, newPot, step) =>
        set((s) => {
          if (!s.ladder) return {};
          if (!won) return { ladder: { ...s.ladder, pot: 0, busted: true } };
          return { ladder: { ...s.ladder, pot: newPot, step } };
        }),

      cashoutLadder: () => {
        set((s) => {
          const l = s.ladder;
          if (!l || l.busted) return { ladder: null };
          const balKey = l.kind === 'soul' ? 'soulChips' : 'chips';
          const profit = l.pot - l.bet;   // 净赢（已先扣过底注）
          const stats: CasinoStats = {
            ...s.stats,
            hands: s.stats.hands + 1,
            wagered: s.stats.wagered + l.bet,
            won: s.stats.won + (profit > 0 ? profit : 0),
            lost: s.stats.lost + (profit < 0 ? -profit : 0),
            biggestWin: Math.max(s.stats.biggestWin, profit),
            winStreak: profit > 0 ? s.stats.winStreak + 1 : 0,
            loseStreak: profit > 0 ? 0 : s.stats.loseStreak + 1,
            bestWinStreak: Math.max(s.stats.bestWinStreak, profit > 0 ? s.stats.winStreak + 1 : 0),
          };
          const entry: CasinoLogEntry = { game: 'ladder', kind: l.kind, text: `收手 ×${Math.pow(2, l.step)}`, delta: profit, ts: Date.now() };
          return { [balKey]: (s as any)[balKey] + l.pot, ladder: null, stats, log: [entry, ...s.log].slice(0, 60) } as any;
        });
        awardCasinoHonors(get().stats);
      },

      clearLadder: () => {
        const busted = !!get().ladder?.busted;
        set((s) => {
          // 翻错清零的梯子收尾：仅记一笔输（底注已先扣，无需再动余额）
          const l = s.ladder;
          if (l && l.busted) {
            const stats: CasinoStats = {
              ...s.stats, hands: s.stats.hands + 1, wagered: s.stats.wagered + l.bet, lost: s.stats.lost + l.bet,
              winStreak: 0, loseStreak: s.stats.loseStreak + 1,
            };
            const entry: CasinoLogEntry = { game: 'ladder', kind: l.kind, text: `翻车 −${l.bet}`, delta: -l.bet, ts: Date.now() };
            return { ladder: null, stats, log: [entry, ...s.log].slice(0, 60) };
          }
          return { ladder: null };
        });
        if (busted) awardCasinoHonors(get().stats);
      },

      setGladiatorMatch: (m) => set({ gladiator: m }),
      setGladiatorBet: (side, amount) =>
        set((s) => (s.gladiator ? { gladiator: { ...s.gladiator, bet: { side, amount }, status: 'fighting' } } : {})),
      setGladiatorResult: (winner, rounds, summary) =>
        set((s) => (s.gladiator ? { gladiator: { ...s.gladiator, status: 'done', result: { winner, rounds, summary } } } : {})),
      setGladiatorPortrait: (idx, url) =>
        set((s) => {
          if (!s.gladiator) return {};
          const fighters = [...s.gladiator.fighters] as typeof s.gladiator.fighters;
          fighters[idx] = { ...fighters[idx], portrait: url };
          return { gladiator: { ...s.gladiator, fighters } };
        }),
      clearGladiator: () => set({ gladiator: null }),

      startBlackjack: (kind, bet) => {
        const player = [drawCard(), drawCard()];
        const dealer = [drawCard(), drawCard()];
        if (isBlackjack(player) || isBlackjack(dealer)) {
          const { outcome, profit } = settleBlackjack(player, dealer, bet, false);
          set({ blackjack: { kind, bet, player, dealer, status: 'done', doubled: false, outcome } });
          get().recordResult('blackjack', kind, profit, bet, `21点 ${BJ_LABEL[outcome]}`);
        } else {
          set({ blackjack: { kind, bet, player, dealer, status: 'playing', doubled: false } });
        }
      },
      bjHit: () => {
        const bj = get().blackjack;
        if (!bj || bj.status !== 'playing') return;
        const player = [...bj.player, drawCard()];
        if (handValue(player).total > 21) {
          const stake = bj.doubled ? bj.bet * 2 : bj.bet;
          set({ blackjack: { ...bj, player, status: 'done', outcome: 'bust' } });
          get().recordResult('blackjack', bj.kind, -stake, stake, '21点 爆牌');
        } else {
          set({ blackjack: { ...bj, player } });
        }
      },
      bjStand: () => {
        const bj = get().blackjack;
        if (!bj || bj.status !== 'playing') return;
        const dealer = dealerPlay(bj.dealer);
        const { outcome, profit } = settleBlackjack(bj.player, dealer, bj.bet, bj.doubled);
        set({ blackjack: { ...bj, dealer, status: 'done', outcome } });
        get().recordResult('blackjack', bj.kind, profit, bj.doubled ? bj.bet * 2 : bj.bet, `21点 ${BJ_LABEL[outcome]}`);
      },
      bjDouble: () => {
        const bj = get().blackjack;
        if (!bj || bj.status !== 'playing' || bj.player.length !== 2) return;
        const player = [...bj.player, drawCard()];
        if (handValue(player).total > 21) {
          set({ blackjack: { ...bj, player, doubled: true, status: 'done', outcome: 'bust' } });
          get().recordResult('blackjack', bj.kind, -bj.bet * 2, bj.bet * 2, '21点 加倍爆牌');
          return;
        }
        const dealer = dealerPlay(bj.dealer);
        const { outcome, profit } = settleBlackjack(player, dealer, bj.bet, true);
        set({ blackjack: { ...bj, player, dealer, doubled: true, status: 'done', outcome } });
        get().recordResult('blackjack', bj.kind, profit, bj.bet * 2, `21点 加倍·${BJ_LABEL[outcome]}`);
      },
      clearBlackjack: () => set({ blackjack: null }),

      applyGachaPull: (rewards, newPity) =>
        set((s) => ({
          gachaLast: rewards,
          gachaPity: newPity,
          log: [{ game: 'gacha', kind: 'soul', text: `命运福袋 ×${rewards.length} · 最佳 ${bestRarity(rewards)}`, delta: 0, ts: Date.now() }, ...s.log].slice(0, 60),
        })),
      clearGachaLast: () => set({ gachaLast: null }),

      logSoul: (text, delta) =>
        set((s) => ({ log: [{ game: 'soul', kind: 'soul', text, delta, ts: Date.now() }, ...s.log].slice(0, 60) })),

      claimBankruptcyGrant: () => {
        const s = get();
        if (s.chips > 0 || s.soulChips > 0 || s.ladder) return false;
        set({ chips: Math.max(0, s.config.bankruptcyGrant) });
        get().logExchange('normal', `破产保护：补发 ${s.config.bankruptcyGrant} 普通筹码`);
        return true;
      },

      setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
      resetStats: () => set({ stats: { ...DEFAULT_STATS } }),
      clearCasino: () => set({ chips: 0, soulChips: 0, stats: { ...DEFAULT_STATS }, ladder: null, gladiator: null, blackjack: null, gachaPity: 0, gachaLast: null, log: [] }),
    }),
    {
      name: 'drpg-casino',
      partialize: (s) => ({
        chips: s.chips, soulChips: s.soulChips, config: s.config, stats: s.stats, ladder: s.ladder,
        // 角斗士立绘 dataURL 不进 localStorage（太大）——剥离 portrait
        gladiator: s.gladiator ? { ...s.gladiator, fighters: s.gladiator.fighters.map((f) => ({ ...f, portrait: undefined })) as typeof s.gladiator.fighters } : null,
        blackjack: s.blackjack, gachaPity: s.gachaPity, gachaLast: s.gachaLast, log: s.log,
      }),
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        config: persisted?.config?.version === CONFIG_VERSION
          ? { ...DEFAULT_CASINO_CONFIG, ...persisted.config }
          : { ...DEFAULT_CASINO_CONFIG },   // 版本变更/旧存档无 version → 重置成新默认配置
        stats: { ...DEFAULT_STATS, ...(persisted?.stats ?? {}) },
        ladder: persisted?.ladder ?? null,
        gladiator: persisted?.gladiator ?? null,
        blackjack: persisted?.blackjack ?? null,
        gachaPity: typeof persisted?.gachaPity === 'number' ? persisted.gachaPity : 0,
        gachaLast: persisted?.gachaLast ?? null,
        log: Array.isArray(persisted?.log) ? persisted.log : [],
      }),
    },
  ),
);
