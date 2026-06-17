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
import { parseWorldBook, type WorldBook, type WorldBookEntry } from './settingsStore';

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

/* ── 内置「战斗写作指导」世界书 ──
   注入角斗场/灵魂决斗场的「战斗过程生成」(genGladiatorBattle)，让 AI 把战斗写得更精彩。
   蓝灯(constant)常驻必注入；绿灯(selective)按本场两名角斗士的种族/职业/风格/桥段命中关键词才注入。
   builtin 本不写入 localStorage（partialize 剥离），每次启动由 ensureBattleWbDefaults 重挂；
   用户一旦编辑/开关，forkCasinoWb 把它转为非内置本 → 随存档持久化。 */
const BATTLE_WB_KEY = 'casino-combat-guide';
function bwbEntry(uid: number, comment: string, content: string, key: string[] = []): WorldBookEntry {
  const green = key.length > 0;
  return {
    uid, comment, content, key, keysecondary: [],
    constant: !green, selective: green,   // 无关键词 = 蓝灯常驻；有关键词 = 绿灯触发
    enabled: true, order: 100 + uid, position: 1,
  };
}
const DEFAULT_BATTLE_WB: WorldBook = {
  id: 'cwb_builtin_combat', name: '战斗写作指导（内置）',
  builtin: true, builtinKey: BATTLE_WB_KEY, enabled: true, createdAt: 0,
  entries: [
    bwbEntry(1, '运镜与节奏', '像分镜导演：远景立势→中景交锋→特写定格。每个回合给一个清晰的战术意图与转折，张弛交替——蓄力、试探、爆发、收势各有轻重，忌一路平推、流水账。'),
    bwbEntry(2, '感官与具象', '调动五感：兵刃破空的锐响、血与硫磺的气味、肌肉的灼痛、脚下地面的震颤。用具体动词与画面代替"发动攻击/进行防御"，让读者看见、听见、闻到这一击。'),
    bwbEntry(3, '数值翻译成画面', '把伤害与 HP 变化写成可感的后果：护甲凹陷、肋骨闷响、踉跄半步、视野发白，而不是"造成 37 点伤害"。血量越低，动作越沉、呼吸越乱，让数字有体感。'),
    bwbEntry(4, '内心独白(OS)', '双方 OS 要贴各自的性格、职业与出身，并随战况起伏：从轻敌、试探，到焦灼、不甘，再到决死或绝望。一句直击要害，忌空喊口号、忌两人 OS 雷同。'),
    bwbEntry(5, '招式与资源博弈', '点名复用角斗士的技能/天赋/储存空间物品，写清"起手—命中—效果"的因果链。让 buff 叠加、技能进 CD、消耗品的取舍成为看点：何时交底牌、何时赌一把。'),
    bwbEntry(6, '终局的仪式感', '终结回合要有落幅：致命一击前的静默、慢镜般的定格、尘埃落定后的余韵与一句点题。但无论过程多惊险，绝不更改系统给定的预定胜者与"败方 HP 归零"。'),
    bwbEntry(7, '逆转时刻', '先把人逼到死角——血条见底、招式被破、底牌用尽；再以明确的代价点燃逆转（燃烧寿命、解封禁术、以伤换伤），让翻盘有重量、有牺牲，而非凭空爆发。', ['反转', '逆转', '绝境', '绝望', '爆种', '突破', '险胜']),
    bwbEntry(8, '法系交锋', '法师/术士之战重在咏唱博弈与法术克制：读条被打断的风险、护盾与穿透的拉扯、元素相生相克、禁咒登场的视觉奇观与反噬代价。', ['法师', '术士', '亡灵法师', '咒', '符文', '法术', '元素', '巫']),
    bwbEntry(9, '敏捷·刺杀流', '刺客/敏捷流强调身法、视野盲区与一击脱离。善用"快"的留白——对手反应不及、残影错位、致命一击来自意料之外的角度；节奏短促、危险贴身。', ['刺客', '影', '潜行', '暗杀', '敏捷', '游侠', '盗']),
    bwbEntry(10, '重装·磨耗流', '重盾/坦克流是钢铁意志与消耗战：格挡迸出的火花、纹丝不动的压制、以血肉换时间、反震之力后发制人。把"扛住"写得比"打出"更惊心。', ['重盾', '坦克', '守护', '重甲', '壁', '骑士', '卫士']),
    bwbEntry(11, '非人形态', '亡灵/恶魔/异兽等非人战法：不惧痛楚、肢体异变、再生与腐蚀、诅咒与血怒等种族异能；以扭曲感、气味与超出常理的动作，凸显其"非人"。', ['亡灵', '不死', '死灵', '恶魔', '魔鬼', '妖', '兽', '龙', '魔']),
  ],
};
function cloneDefaultBattleWb(): WorldBook { return JSON.parse(JSON.stringify(DEFAULT_BATTLE_WB)); }
function forkCasinoWb(b: WorldBook): WorldBook { return b.builtin ? { ...b, builtin: false } : b; }

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
  battleWorldBooks: WorldBook[];     // 战斗写作指导世界书（注入角斗场战斗生成；内置1本 + 用户导入）

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

  /* ── 战斗写作指导世界书 ── */
  importBattleWorldBook: (raw: string, fileName?: string) => { ok: boolean; message: string };
  toggleBattleWorldBook: (id: string) => void;
  removeBattleWorldBook: (id: string) => void;
  toggleBattleWbEntry: (bookId: string, uid: number) => void;
  updateBattleWbEntry: (bookId: string, uid: number, patch: Partial<WorldBookEntry>) => void;
  addBattleWbEntry: (bookId: string) => void;
  removeBattleWbEntry: (bookId: string, uid: number) => void;
  resetBattleWorldBooks: () => void;

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
      battleWorldBooks: [],

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

      importBattleWorldBook: (raw, fileName = '') => {
        try {
          const { name, entries } = parseWorldBook(raw, fileName);
          if (!entries.length) return { ok: false, message: '未解析到任何条目' };
          set((s) => ({ battleWorldBooks: [...s.battleWorldBooks, { id: `cwb_${Date.now()}`, name, entries, enabled: true, createdAt: Date.now() }] }));
          return { ok: true, message: `已导入「${name}」（${entries.length} 条）` };
        } catch (e: any) { return { ok: false, message: e?.message || '解析失败：不是有效的世界书 JSON' }; }
      },
      toggleBattleWorldBook: (id) => set((s) => ({ battleWorldBooks: s.battleWorldBooks.map((b) => b.id === id ? forkCasinoWb({ ...b, enabled: !b.enabled }) : b) })),
      removeBattleWorldBook: (id) => set((s) => ({ battleWorldBooks: s.battleWorldBooks.filter((b) => b.id !== id) })),
      toggleBattleWbEntry: (bookId, uid) => set((s) => ({ battleWorldBooks: s.battleWorldBooks.map((b) => b.id !== bookId ? b : forkCasinoWb({ ...b, entries: b.entries.map((e) => e.uid === uid ? { ...e, enabled: !e.enabled } : e) })) })),
      updateBattleWbEntry: (bookId, uid, patch) => set((s) => ({ battleWorldBooks: s.battleWorldBooks.map((b) => b.id !== bookId ? b : forkCasinoWb({ ...b, entries: b.entries.map((e) => e.uid === uid ? { ...e, ...patch } : e) })) })),
      addBattleWbEntry: (bookId) => set((s) => ({ battleWorldBooks: s.battleWorldBooks.map((b) => {
        if (b.id !== bookId) return b;
        const maxUid = b.entries.reduce((m, e) => Math.max(m, e.uid), 0);
        const maxOrder = b.entries.reduce((m, e) => Math.max(m, e.order), 100);
        return forkCasinoWb({ ...b, entries: [...b.entries, { uid: maxUid + 1, key: [], keysecondary: [], comment: '新条目', content: '', constant: true, selective: false, enabled: true, order: maxOrder + 1, position: 1 }] });
      }) })),
      removeBattleWbEntry: (bookId, uid) => set((s) => ({ battleWorldBooks: s.battleWorldBooks.map((b) => b.id !== bookId ? b : forkCasinoWb({ ...b, entries: b.entries.filter((e) => e.uid !== uid) })) })),
      resetBattleWorldBooks: () => set((s) => ({ battleWorldBooks: [cloneDefaultBattleWb(), ...s.battleWorldBooks.filter((b) => b.builtinKey !== BATTLE_WB_KEY)] })),

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
        // 内置战斗写作指导本不持久化（启动重挂）；只存用户导入/改过(已 fork 成非内置)的
        battleWorldBooks: (s.battleWorldBooks ?? []).filter((b) => !b.builtin),
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
        battleWorldBooks: Array.isArray(persisted?.battleWorldBooks) ? persisted.battleWorldBooks : [],   // 内置本由 ensureBattleWbDefaults 加回
      }),
    },
  ),
);

/** 确保内置「战斗写作指导」世界书存在（builtin 本不持久化，启动时按 builtinKey 判重重挂；
 *  用户删/改后已 fork 成非内置本仍带 builtinKey，故不会重复添加）。 */
export function ensureBattleWbDefaults() {
  const have = useCasino.getState().battleWorldBooks.some((b) => b.builtinKey === BATTLE_WB_KEY);
  if (!have) useCasino.setState((s) => ({ battleWorldBooks: [cloneDefaultBattleWb(), ...s.battleWorldBooks] }));
}
ensureBattleWbDefaults();
