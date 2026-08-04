import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  startRun, stepEnterRoom, applyBoon, descend, settleRun, corruptToFall,
  buildAllyUnit, applySinFlavor, combatAct, activateForm, applyAltar, advanceZone, boonSig, applyJudge, applyJudgeFlavor, applyEnemyPanels,
  ABYSS_TUNING, type AbyssRun, type PlayerSnapshot, type SinFlavor, type AwakenFlavor, type JudgeFlavor, type AbyssUnit,
} from '../systems/abyssEngine';
import { ABYSS_STARMAP, ABYSS_BIOMES, type AbyssLoot, type BoonCard } from '../data/abyssData';
import { usePlayer } from './playerStore';
import { useNpc } from './npcStore';
import { useCosmos } from './cosmosStore';
import { useCharacters } from './characterStore';
import { useItems, gradeToNum, ITEM_GRADES } from './itemStore';

/** 读某角色的技能（名+效果，战斗施放用；只读，隔离）。 */
function readSkills(charId: string): { name: string; effect: string }[] {
  const ch = useCharacters.getState().characters[charId];
  return (ch?.skills ?? []).map((s: any) => ({ name: String(s.name || '').slice(0, 16), effect: String(s.effect ?? s.desc ?? '').slice(0, 80) })).filter((s) => s.name).slice(0, 8);
}
import { lvFromRealm, isAbyssLocked } from '../systems/derivedStats';
import { reportFacilityOutcome } from '../systems/facilityBridge';

/* ════════════════════════════════════════════
   深渊地牢 store（drpg-abyss）—— 设计见 指导/深渊地牢-堕落流-设计.md
   - run  = 进行中的单局（断点续存）；沙盒，撤退/死亡/通关后清空（§13.3）
   - meta = 跨周目永久（结晶/通关数/觉醒充能/解锁），唯一跨出沙盒的存档
   - 战利品(装备/原罪物/材料)+结晶 走结算白名单带出主线；加成/腐蚀永不外泄
════════════════════════════════════════════ */

/** 卡牌库条目（§8.6，按签名去重累计）。 */
export interface CardLibEntry { card: BoonCard; school: string; count: number; fromBiome: number; }

export interface AbyssMeta {
  crystals: number;          // 堕落结晶
  deepestFloor: number;      // 最深层（全局层深）
  clearsCount: number;       // 通关累计
  awakenCharges: number;     // 觉醒充能（每 N 通关 +1）
  unlockedZones: number;     // 已解锁直达险地
  endlessUnlocked: boolean;  // 无尽模式（M4）
  starmapNodes: string[];    // 堕落星图已点亮节点
  cardLibrary: CardLibEntry[]; // 卡牌库（§8.6）
  startDeck: string[];       // 起手卡组（加成卡签名）
  sinCodex: Record<string, boolean>;  // 原罪物图鉴（按名收集）
}

const DEFAULT_META: AbyssMeta = {
  crystals: 0, deepestFloor: 0, clearsCount: 0, awakenCharges: 0,
  unlockedZones: 1, endlessUnlocked: false, starmapNodes: [], cardLibrary: [], startDeck: [], sinCodex: {},
};

/** 可调参（设置项，AbyssManager 编辑；属配置不随新游戏清空）。 */
export interface AbyssConfig { ticketCost: number; deathRetain: number; }
const DEFAULT_CONFIG: AbyssConfig = { ticketCost: ABYSS_TUNING.ticketCost, deathRetain: ABYSS_TUNING.deathRetain };

export interface StartRunOpts { hardcore?: boolean; allyIds?: string[]; startZone?: number; endless?: boolean; }

interface AbyssState {
  run: AbyssRun | null;
  meta: AbyssMeta;
  config: AbyssConfig;        // 可调参（门票/死亡保留）
  boonLoading: boolean;       // 加成卡 API 生成中
  lastSettle: { note: string; crystals: number; carry: number; cleared: boolean } | null;

  /** 开一局：扣门票(乐园币) + 快照主角(+队友) → startRun。返回是否成功（余额不足返回 false）。 */
  start: (opts?: StartRunOpts) => boolean;
  /** 进入下一房间（战斗房→建立战斗态；非战斗房→即时结算）。 */
  enter: () => void;
  /** 交互式战斗：玩家一次行动（攻击/技能/防御/撤离），推进一回合。 */
  act: (action: 'attack' | 'defend' | 'flee' | 'skill', targetIdx?: number, skillIdx?: number) => void;
  /** 面板把 AI 生成的敌人面板单位写回战斗（精英/区主；null=回退保留数据敌人）。 */
  setFightEnemies: (units: AbyssUnit[] | null) => void;
  /** 战斗中发动堕落形态（满堕落、本场未用过）。 */
  transform: () => void;
  /** 堕落祭坛：选献祭（idx<0=拒绝离开）。 */
  chooseAltar: (idx: number) => void;
  /** 深渊裁判剧情局：抉择一项（M4）。 */
  chooseJudge: (idx: number) => void;
  /** 面板把 AI 配文回来的剧情局写回（场景+选项文案）。 */
  enrichJudge: (flavor: JudgeFlavor | null) => void;
  /** 堕落星图：花结晶解锁节点（meta 永久）。返回是否成功。 */
  unlockStarmapNode: (id: string) => boolean;
  /** 设置起手卡组（加成卡签名，≤3，§8.6）。 */
  setStartDeck: (sigs: string[]) => void;
  /** 觉醒：花 1 充能给已带出装备/原罪物升品级+加词缀（flavor 来自 API，可空兜底）。返回是否成功。 */
  applyAwaken: (itemId: string, flavor: AwakenFlavor | null) => boolean;
  /** 战后三选一：选一张加成卡（并在 boss 层后自动下潜）。 */
  chooseBoon: (card: BoonCard) => void;
  /** 面板把生成好的加成卡（API 或种子兜底）写回 run。 */
  setPendingBoons: (cards: BoonCard[]) => void;
  setBoonLoading: (v: boolean) => void;
  /** 面板把 AI 配文回来的原罪物增强写回（按 run.pendingSin）。 */
  enrichSin: (flavor: SinFlavor | null) => void;
  /** 从回溯阵撤退（全额带出结算）。 */
  retreat: () => void;
  /** 确认死亡结算（保留 50%）。 */
  ackDeath: () => void;
  /** 确认通关结算。 */
  ackClear: () => void;
  /** 丢弃当前进行中的局（不结算，调试用）。 */
  abandon: () => void;
  /** 灵魂结晶 → 觉醒充能（小=1/中=2/大=4 单位，凑满 4 → +1 充能）。返回结果消息供面板展示。 */
  chargeWithCrystals: () => { ok: boolean; msg: string };
  clearLastSettle: () => void;
  /** clearProgress 用：清空 run + meta。 */
  clearAbyss: () => void;
  /** 调参（门票/死亡保留），AbyssManager 用。 */
  setConfig: (patch: Partial<AbyssConfig>) => void;
}

/* 把引擎战利品带出主线（白名单 §13.3）：货币进钱包、物品/原罪物进背包 */
function carryLootToMainline(loot: AbyssLoot[]): void {
  const I = useItems.getState();
  for (const l of loot) {
    if (l.kind === 'currency') {
      if (l.name === '乐园币') I.adjustCurrency('乐园币', l.qty ?? 0, '深渊地牢·战利品带出');
      else if (l.name === '灵魂钱币') I.adjustCurrency('灵魂钱币', l.qty ?? 0, '深渊地牢·战利品带出');
      continue;
    }
    I.addItem({
      name: l.name,
      category: (l.category as any) ?? '其他物品',
      gradeDesc: l.quality ?? '',
      effect: l.effect ?? l.desc ?? '',
      quantity: Math.max(1, l.qty ?? 1),
      equipped: false,
      tags: l.sin ? ['原罪', '深渊'] : ['深渊'],
      acquisition: '深渊地牢',
      notes: l.sin ? '原罪物（深渊夺得，力量与诅咒并存）' : undefined,
    });
  }
}

/* 结算场外通报：层数/结晶/带出物让正文知情（此前深渊玩完正文零感知——审计"准孤岛"次名）。
   五阶前按封印口径称「幽冥地牢」（与 scrubAbyss/导航同口径）。物品登记 granted 防物品阶段重复建档。 */
function reportAbyssSettle(r: { reachedDepth: number; crystals: number; carry: AbyssLoot[] }, kind: 'retreat' | 'dead' | 'cleared'): void {
  try {
    const place = isAbyssLocked(usePlayer.getState().profile) ? '幽冥地牢' : '深渊地牢';
    const names = r.carry.filter((l) => l.kind !== 'currency').map((l) => l.name);
    const verb = kind === 'cleared' ? '击破界之底、完成通关' : kind === 'dead' ? `力竭倒在全局第 ${r.reachedDepth} 层（地牢内败退不伤主线之身）` : `于全局第 ${r.reachedDepth} 层见好就收撤离`;
    reportFacilityOutcome({
      source: place,
      summary: `主角刚结束一次${place}探索：${verb}；${names.length ? `带出战利品 ${names.map((n) => `「${n}」`).join('、')}（已入背包）` : '带出少量收获'}，堕落结晶 +${r.crystals}。地牢内的加成与腐蚀**不外泄主线**`,
      granted: names,
    });
  } catch { /* 通报失败不阻断结算 */ }
}

function snapshotPlayer(): PlayerSnapshot {
  const p = usePlayer.getState().profile;
  const equipped = useItems.getState().items
    .filter((it) => it.equipped)
    .map((it) => ({ category: it.category as string, grade: gradeToNum(it.gradeDesc) }));
  return { name: p.name, attrs: p.attrs, level: p.level, tier: p.tier, equipped, skills: readSkills('B1'), hpRatio: p.hpRatio, epRatio: p.epRatio };
}

/* 结算吸收：本局选过的加成卡进卡牌库（去重累计）、原罪物进图鉴（§8.6） */
function absorbRunIntoMeta(meta: AbyssMeta, run: AbyssRun): Pick<AbyssMeta, 'cardLibrary' | 'sinCodex'> {
  const lib = meta.cardLibrary.map((e) => ({ ...e }));
  for (const card of run.boons) {
    if (card.id.startsWith('altar_')) continue;   // 祭坛献祭不入卡牌库
    const sig = boonSig(card);
    const idx = lib.findIndex((e) => boonSig(e.card) === sig);
    if (idx >= 0) lib[idx] = { ...lib[idx], count: lib[idx].count + 1 };
    else lib.push({ card, school: card.school, count: 1, fromBiome: run.biome });
  }
  const codex = { ...meta.sinCodex };
  for (const l of run.loot) if (l.sin) codex[l.name] = true;
  return { cardLibrary: lib, sinCodex: codex };
}

/* 深入深渊 → 反哺万族演化「深渊滋生」背景（M4，世界观自洽；无万族/无深渊实体则静默跳过） */
function feedCosmosAbyss(reachedDepth: number, cleared: boolean): void {
  if (reachedDepth < 6 && !cleared) return;   // 浅尝不扰动宇宙背景
  try {
    const C = useCosmos.getState();
    const target = C.entities.find((e) => e.category === '深渊' && /滋生/.test(e.name))
      || C.entities.find((e) => e.category === '深渊');
    if (!target) return;
    const prev = parseInt(target.extra?.['污染度'] || '0', 10) || 0;
    const pollute = Math.min(100, prev + Math.round(reachedDepth / 2) + (cleared ? 6 : 0));
    const status = pollute >= 70 ? '鼎盛' : pollute >= 40 ? '扩张' : target.status;
    C.upsertEntity({ name: target.name, category: '深渊', status, extra: { ...target.extra, 污染度: String(pollute) } });
    C.appendDeed(target.name, { desc: `契约者深入深渊·全局第 ${reachedDepth} 层${cleared ? '并击破区主' : ''}，${target.name}因之躁动壮大（污染度 ${pollute}）。` });
  } catch { /* 万族未启用/异常 → 不影响结算 */ }
}

/* 通关/极限/收集 → 称号（写主角成就）。新获得的走 growthNotice 让正文入戏交代。 */
function awardAbyssTitles(meta: AbyssMeta, hardcore: boolean): void {
  const P = usePlayer.getState();
  const owned = new Set((P.achievements ?? []).map((a: { id?: string }) => a.id));
  const fresh: string[] = [];
  const T = (id: string, name: string, desc: string, rarity: string) => {
    if (!owned.has(id)) fresh.push(name);
    P.addAchievement({ id, name, desc, category: '深渊', type: '特殊', rarity, hidden: false, condition: '通关深渊地牢' });
  };
  T('abyss_clear', '深渊征服者', '通关深渊地牢·界之底', '史诗级');
  if (hardcore) T('abyss_hardcore', '孤身入渊', '以极限模式（单人）通关深渊', '传说级');
  const codexCount = Object.keys(meta.sinCodex).length;
  if (codexCount >= 5) T('abyss_collector', '原罪收藏家', `收集 ${codexCount} 件原罪物`, '金色');
  if (fresh.length) {
    reportFacilityOutcome({ source: isAbyssLocked(P.profile) ? '幽冥地牢' : '深渊地牢', summary: '', growth: fresh.map((n) => `获得成就「${n}」——可自然带过这份印记的分量，不强求成段`) });
  }
}

export const useAbyss = create<AbyssState>()(
  persist(
    (set, get) => ({
      run: null,
      meta: { ...DEFAULT_META },
      config: { ...DEFAULT_CONFIG },
      boonLoading: false,
      lastSettle: null,

      start: (opts) => {
        if (get().run) return true;   // 已有进行中的局
        const I = useItems.getState();
        const ticket = get().config.ticketCost;
        if ((I.currency.乐园币 ?? 0) < ticket) return false;
        I.adjustCurrency('乐园币', -ticket, '深渊地牢·入场券');
        const hardcore = !!opts?.hardcore;
        const npcs = useNpc.getState().npcs;
        const allies = hardcore ? [] : (opts?.allyIds ?? []).slice(0, 3).map((id, i) => {
          const n = npcs[id];
          if (!n) return null;
          return buildAllyUnit({
            name: n.name, attrs: n.attrs ?? { str: 10, agi: 10, con: 10, int: 10, cha: 10, luck: 10 },
            level: lvFromRealm(n.realm) || 10, tier: n.realm, equipped: [], skills: readSkills(id),
          }, i + 1);
        }).filter((u): u is NonNullable<typeof u> => !!u);
        const m = get().meta;
        const startZone = Math.max(1, Math.min(m.unlockedZones, opts?.startZone || 1));
        const startDeckCards = m.startDeck
          .map((sig) => m.cardLibrary.find((e) => boonSig(e.card) === sig)?.card)
          .filter((c): c is BoonCard => !!c);
        const endless = !!opts?.endless && m.endlessUnlocked;
        set({ run: startRun(snapshotPlayer(), { hardcore, allies, startZone, starmap: m.starmapNodes, startDeckCards, endless }), boonLoading: false, lastSettle: null });
        return true;
      },

      unlockStarmapNode: (id) => {
        const node = ABYSS_STARMAP.find((n) => n.id === id);
        const m = get().meta;
        if (!node || m.starmapNodes.includes(id)) return false;
        if ((node.prereq ?? []).some((p) => !m.starmapNodes.includes(p))) return false;
        if (m.crystals < node.cost) return false;
        set({ meta: { ...m, crystals: m.crystals - node.cost, starmapNodes: [...m.starmapNodes, id] } });
        return true;
      },

      setStartDeck: (sigs) => set((s) => ({ meta: { ...s.meta, startDeck: sigs.slice(0, 3) } })),

      applyAwaken: (itemId, flavor) => {
        const m = get().meta;
        if (m.awakenCharges < 1) return false;
        const I = useItems.getState();
        const item = I.items.find((it) => it.id === itemId);
        if (!item) return false;
        const idx = ITEM_GRADES.indexOf(item.gradeDesc as any);
        const nextGrade = idx >= 0 && idx < ITEM_GRADES.length - 1 ? ITEM_GRADES[idx + 1] : item.gradeDesc;  // 升一档品级=基础数值大幅提升（grade 驱动 derivedStats）
        const awakenLv = (item.awakenLv ?? 0) + 1;
        const affixAdd = flavor?.affixName ? `[觉醒·${flavor.affixName}]${flavor.affixDesc ? ' ' + flavor.affixDesc : ''}` : `[觉醒+${awakenLv}]`;
        const affix = item.affix ? `${item.affix} ${affixAdd}` : affixAdd;
        const note = flavor?.awakenNarrative ? `${item.notes ? item.notes + '\n' : ''}【觉醒 ${awakenLv} 阶】${flavor.awakenNarrative}` : item.notes;
        I.updateItem(itemId, { gradeDesc: nextGrade, affix, awakenLv, notes: note });
        set({ meta: { ...m, awakenCharges: m.awakenCharges - 1 } });
        // 觉醒是硬成长事件：品级跳档 + 新词缀，正文该入戏交代一笔（growthNotice 档）
        reportFacilityOutcome({
          source: isAbyssLocked(usePlayer.getState().profile) ? '幽冥地牢' : '深渊地牢',
          summary: '',
          growth: `装备「${item.name}」经${isAbyssLocked(usePlayer.getState().profile) ? '幽冥' : '深渊'}之力觉醒至第 ${awakenLv} 阶（品级升至「${nextGrade}」·新增词缀 ${affixAdd}）——可自然带过觉醒仪式的一幕，不强求成段`,
        });
        return true;
      },

      enter: () => {
        const run = get().run;
        if (!run || run.status !== 'exploring') return;
        const next = stepEnterRoom(run);
        set({ run: next, meta: { ...get().meta, deepestFloor: Math.max(get().meta.deepestFloor, next.globalDepth) } });
      },

      act: (action, targetIdx = 0, skillIdx = 0) => {
        const run = get().run;
        if (!run || run.status !== 'fighting') return;
        set({ run: combatAct(run, action, targetIdx, skillIdx) });
      },

      setFightEnemies: (units) => set((s) => (s.run?.fight?.pendingPanel ? { run: applyEnemyPanels(s.run, units) } : {})),

      transform: () => {
        const run = get().run;
        if (!run) return;
        set({ run: activateForm(run) });
      },

      chooseAltar: (idx) => {
        const run = get().run;
        if (!run || run.status !== 'altar') return;
        set({ run: applyAltar(run, idx) });
      },

      chooseJudge: (idx) => {
        const run = get().run;
        if (!run || run.status !== 'judge') return;
        set({ run: applyJudge(run, idx) });
      },
      enrichJudge: (flavor) => set((s) => (s.run?.pendingJudge ? { run: applyJudgeFlavor(s.run, flavor) } : {})),

      chooseBoon: (card) => {
        const run = get().run;
        if (!run || run.status !== 'choosingBoon') return;
        let next = applyBoon(run, card);
        const room = next.map.rooms[next.posIdx];
        if (room?.type === 'boss') {
          if (next.floor < ABYSS_TUNING.floorsPerZone) {
            next = descend(next);                       // 层主 → 同险地下潜
          } else {
            // 区主：解锁下一险地直达（未到尽头时）+ 推进。普通模式 biome5 已在 applyCombatWin 通关，不到此；无尽模式总推进（回环）
            if (next.biome < ABYSS_BIOMES.length) {
              const nz = next.biome + 1;
              set((s) => ({ meta: { ...s.meta, unlockedZones: Math.max(s.meta.unlockedZones, nz) } }));
            }
            next = advanceZone(next);
          }
        }
        set({ run: next, boonLoading: false, meta: { ...get().meta, deepestFloor: Math.max(get().meta.deepestFloor, next.globalDepth) } });
      },

      setPendingBoons: (cards) => set((s) => (s.run ? { run: { ...s.run, pendingBoons: cards }, boonLoading: false } : {})),
      setBoonLoading: (v) => set({ boonLoading: v }),
      enrichSin: (flavor) => set((s) => {
        if (!s.run?.pendingSin) return {};
        const { idx, template } = s.run.pendingSin;
        return { run: applySinFlavor(s.run, idx, template, flavor) };
      }),

      retreat: () => {
        const run = get().run;
        if (!run) return;
        const r = settleRun(run, 'retreat', get().config.deathRetain);
        carryLootToMainline(r.carry);
        reportAbyssSettle(r, 'retreat');
        feedCosmosAbyss(r.reachedDepth, false);
        set((s) => ({
          run: null,
          lastSettle: { note: r.note, crystals: r.crystals, carry: r.carry.length, cleared: false },
          meta: { ...s.meta, ...absorbRunIntoMeta(s.meta, run), crystals: s.meta.crystals + r.crystals, deepestFloor: Math.max(s.meta.deepestFloor, r.reachedDepth) },
        }));
      },

      ackDeath: () => {
        const run = get().run;
        if (!run) return;
        const r = settleRun(run, 'dead', get().config.deathRetain);
        carryLootToMainline(r.carry);
        reportAbyssSettle(r, 'dead');
        feedCosmosAbyss(r.reachedDepth, false);
        set((s) => ({
          run: null,
          lastSettle: { note: r.note, crystals: r.crystals, carry: r.carry.length, cleared: false },
          meta: { ...s.meta, ...absorbRunIntoMeta(s.meta, run), crystals: s.meta.crystals + r.crystals, deepestFloor: Math.max(s.meta.deepestFloor, r.reachedDepth) },
        }));
      },

      ackClear: () => {
        const run = get().run;
        if (!run) return;
        const r = settleRun(run, 'cleared', get().config.deathRetain);
        carryLootToMainline(r.carry);
        reportAbyssSettle(r, 'cleared');
        set((s) => {
          const clears = s.meta.clearsCount + 1;
          const awaken = s.meta.awakenCharges + (clears % ABYSS_TUNING.awakenEveryClears === 0 ? 1 : 0);
          const absorbed = absorbRunIntoMeta(s.meta, run);
          return {
            run: null,
            lastSettle: { note: r.note, crystals: r.crystals, carry: r.carry.length, cleared: true },
            meta: {
              ...s.meta, ...absorbed,
              crystals: s.meta.crystals + r.crystals,
              deepestFloor: Math.max(s.meta.deepestFloor, r.reachedDepth),
              clearsCount: clears,
              awakenCharges: awaken,
              endlessUnlocked: true,
            },
          };
        });
        awardAbyssTitles({ ...get().meta }, run.hardcore);
        feedCosmosAbyss(r.reachedDepth, true);
      },

      /* 灵魂结晶 → 觉醒充能（P3 经济缝合）：世界结算 A 级+发放的「灵魂结晶(小/中/大)」此前全库零消耗
         （审计"有源无汇"头名）。兑换率：小=1 / 中=2 / 大=4 单位，凑满 4 单位 → +1 充能；
         大件优先、凑满即停（只剩中/大时可能略有溢价，不设找零·消息里写明）。确定性、零 AI。 */
      chargeWithCrystals: () => {
        const I = useItems.getState();
        const unitOf = (name: string): number => (/大/.test(name) ? 4 : /中/.test(name) ? 2 : 1);
        const stacks = I.items
          .filter((it) => /灵魂结晶/.test(it.name || ''))
          .map((it) => ({ id: it.id, name: it.name, unit: unitOf(it.name || ''), qty: Math.max(1, it.quantity || 1) }))
          .sort((a, b) => b.unit - a.unit);
        const total = stacks.reduce((s, x) => s + x.unit * x.qty, 0);
        if (total < 4) return { ok: false, msg: `灵魂结晶不足：现有 ${total} 单位（小=1/中=2/大=4），凑满 4 单位才能兑 1 次充能` };
        let need = 4;
        const used: string[] = [];
        for (const st of stacks) {
          if (need <= 0) break;
          let n = 0;
          while (need > 0 && n < st.qty) { n++; need -= st.unit; }
          if (n > 0) { try { I.consumeItem(st.id, n); } catch { /* */ } used.push(`${st.name}×${n}`); }
        }
        set((s) => ({ meta: { ...s.meta, awakenCharges: s.meta.awakenCharges + 1 } }));
        const over = need < 0 ? `（超出 ${-need} 单位·不设找零）` : '';
        reportFacilityOutcome({
          source: isAbyssLocked(usePlayer.getState().profile) ? '幽冥地牢' : '深渊地牢',
          summary: `主角把 ${used.join('、')} 炼入觉醒之炉，换得 1 次装备觉醒充能${over}`,
          guard: '结晶已消耗，勿在正文中当作仍持有',
        });
        return { ok: true, msg: `已消耗 ${used.join('、')} → 觉醒充能 +1${over}` };
      },
      abandon: () => set({ run: null }),
      clearLastSettle: () => set({ lastSettle: null }),
      clearAbyss: () => set({ run: null, meta: { ...DEFAULT_META }, lastSettle: null }),   // config 属设置，不随重置清空
      setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
    }),
    {
      name: 'drpg-abyss',
      partialize: (s) => ({ run: s.run, meta: s.meta, config: s.config }),
      merge: (persisted: any, current) => ({
        ...current,
        run: persisted?.run ?? null,
        meta: { ...DEFAULT_META, ...(persisted?.meta ?? {}) },
        config: { ...DEFAULT_CONFIG, ...(persisted?.config ?? {}) },
      }),
    },
  ),
);

/* 修正旧存档：腐蚀等级与腐蚀值一致 */
export function reconcileAbyssRun(): void {
  const run = useAbyss.getState().run;
  if (run && run.fallLevel !== corruptToFall(run.corruption)) {
    useAbyss.setState({ run: { ...run, fallLevel: corruptToFall(run.corruption) } });
  }
}
