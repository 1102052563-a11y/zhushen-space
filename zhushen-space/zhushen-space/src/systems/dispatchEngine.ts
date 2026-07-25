/* ════════════════════════════════════════════
   冒险团派遣引擎 —— 委托板生成 + 出勤评估 + 到点结算（**全部确定性、零 token**）

   参考 FF14 冒险者小队 / Battle Brothers 的「离线循环」：派 NPC 队伍去打限时委托，
   到点归来给战报 + 战利品，受伤疲劳强制轮换。

   ── 三条铁则（改这个文件前先读，都是踩过的坑换来的）──────────────────────
   ① **结算前端算死、AI 只写散文**。本文件产出 `DispatchLedger`（评级/伤亡/战利品/货币），
      `dispatchReport.ts` 拿着这份已锁死的账本让 AI 叙述。让 AI 同时决定"打赢没"和"掉了什么"，
      每次派遣都会通货膨胀——这正是 bioStrength 机械判定、NPC 成长闸门当年要治的病。
   ② **不新开成长/致死后门**。成长走 `boundedGrowth`（吃 attrCapForTier 封顶）、战利品走
      `makeEquipItem` + `autoGearFull` 的同一条 8 件上限、陨落走 `settings.npcAutonomyDeath`
      开关和 `isProtected`（好友/羁绊/永久保留/临时队友）。派遣不该比自己练更划算。
   ③ **主角(B1)永不出勤**。你人在正文里，同时"被派出去"是逻辑矛盾；也顺手避开了
      「主角数值在正文外被改」这条铁律（见 faithful-to-narrative-no-stat-inflation）。

   ── 时间口径 ────────────────────────────────────────────────────────
   倒数用**回合**不用挂钟：全局时钟本来就是回合，挂钟会招来读档刷时间、也不合"一坐两小时"的节奏。
   记的是**绝对回合** `endTurn`，不逐回合自减 —— 漏跑一回合不会卡住，回退时间能自然延长。
   主神空间时间（paradiseTime）只作为战报里的"历时"风味，不参与判定。
════════════════════════════════════════════ */
import { useNpc, hasRealNpcName, type NpcRecord } from '../store/npcStore';
import { useTeam, FATIGUE_GATE, BOARD_SIZE, BOARD_REFRESH, type DispatchOffer, type DispatchRecord, type DispatchLedger, type DispatchMemberResult, type TeamRank, TEAM_RANKS } from '../store/adventureTeamStore';
import { useSettings } from '../store/settingsStore';
import { useItems } from '../store/itemStore';
import { useMisc } from '../store/miscStore';
import { pushFacilityGranted, pushSceneNotice } from './allocNotice';
import { powerOf, archOf, makeEquipItem, autoGearFull, type Arch } from './npcAutonomy';
import { getCorpus, makeRng, pickFrom, hashStr, seedFrom } from './autonomyCorpus';
import { isPetLike } from './petEvolution';
import type { Deed } from '../store/characterStore';

/* ── 委托素材（组合式：前缀 × 词根 × 世界主题，套用轨道A 语料库的组合思路，零 token 无限变化）── */
const MISSION_KIND: ReadonlyArray<{ verb: string; noun: string; arch?: Arch; danger: number }> = [
  { verb: '清剿', noun: '盘踞的凶物', arch: 'melee', danger: 0.55 },
  { verb: '护送', noun: '一支商队', arch: 'tank', danger: 0.3 },
  { verb: '潜入', noun: '戒备森严的据点', arch: 'assassin', danger: 0.5 },
  { verb: '搜寻', noun: '失落的遗物', arch: 'ranged', danger: 0.35 },
  { verb: '镇压', noun: '暴动的残党', arch: 'control', danger: 0.5 },
  { verb: '驰援', noun: '被围困的营地', arch: 'support', danger: 0.4 },
  { verb: '勘定', noun: '异变的地脉', arch: 'caster', danger: 0.45 },
  { verb: '追缉', noun: '在逃的违规者', arch: 'assassin', danger: 0.6 },
  { verb: '拔除', noun: '据点里的巢穴', arch: 'summon', danger: 0.55 },
  { verb: '看守', noun: '一处封印', arch: 'tank', danger: 0.25 },
  { verb: '劫夺', noun: '敌方的辎重', arch: 'melee', danger: 0.5 },
  { verb: '斡旋', noun: '两方的争端', arch: 'support', danger: 0.3 },
];
export const ARCH_LABEL: Record<Arch, string> = {
  assassin: '刺杀', caster: '术法', melee: '近战', tank: '坚守',
  control: '控场', support: '支援', summon: '召唤', ranged: '远程',
};
const INJURY_POOL = ['断骨未愈', '内伤未平', '筋络挫伤', '失血过多', '灼伤溃烂', '寒毒入体', '神魂震荡', '旧伤复发'];

/* ── 数值表 ─────────────────────────────────────────────────────────
   奖励刻意压在「任务每环基础给量」之下（派遣是**可重复的被动收入**，不该比亲自做主线还赚）。
   货币种类严格照既定门槛：三阶及下发乐园币 / 四阶起改发灵魂钱币（魂币），绝不混发。 */
const PARADISE_COIN = [0, 250, 700, 1800];                    // idx = 委托阶 1~3
const SOUL_COIN = [0, 0, 0, 0, 1, 2, 3, 6, 12, 25];           // idx = 委托阶 4~9
const RATING_SCALE: Record<string, number> = { E: 0, D: 0.3, C: 0.6, B: 0.8, A: 1, S: 1.3, SS: 1.6, SSS: 2 };
const RATING_EXP: Record<string, number> = { E: 0, D: 2, C: 4, B: 6, A: 9, S: 12, SS: 16, SSS: 20 };
const RATINGS = ['E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];

export function ratingOf(roll: number): string {
  if (roll >= 96) return 'SSS';
  if (roll >= 88) return 'SS';
  if (roll >= 78) return 'S';
  if (roll >= 66) return 'A';
  if (roll >= 52) return 'B';
  if (roll >= 38) return 'C';
  if (roll >= 22) return 'D';
  return 'E';
}
const isGood = (r: string) => RATINGS.indexOf(r) >= RATINGS.indexOf('A');
const isBad = (r: string) => r === 'E' || r === 'D';

/* ══════════ 委托板 ══════════ */

/** 派遣候选：团队成员里**已建档、离场、活着、非宠物**的那些（主角 B1 与未建档成员天然不在列）。*/
export function dispatchCandidates(): NpcRecord[] {
  const T = useTeam.getState();
  if (!T.established || T.disbanded) return [];
  const npcs = useNpc.getState().npcs;
  const out: NpcRecord[] = [];
  for (const m of T.members) {
    if (!m.id || m.id === 'B1') continue;                     // 铁则③：主角不出勤
    const n = npcs[m.id];
    if (!n || n.isDead || n.archived || isPetLike(n) || !hasRealNpcName(n)) continue;
    out.push(n);
  }
  return out;
}

/** 这个人现在能不能派出去（面板置灰的唯一判据）。*/
export function memberBlockReason(n: NpcRecord): string | null {
  const T = useTeam.getState();
  if (T.dispatchActive?.memberIds.includes(n.id)) return '出勤中';
  if (n.onScene) return '在场';                                // 正文里正站在你旁边的人不能同时在外面执行委托
  const inj = T.injury[n.id];
  if (inj) return `疗伤中·${inj.turns}回合`;
  if ((T.fatigue[n.id] ?? 0) >= FATIGUE_GATE) return '需休整';
  return null;
}

/** 委托板：每 BOARD_REFRESH 回合换一批。按当前阵容强度定阶，永远给一条"够一够"的高阶委托。 */
export function rollOfferBoard(turn: number, rank: TeamRank, cands: NpcRecord[]): DispatchOffer[] {
  const rng = makeRng(seedFrom(Math.floor(turn / Math.max(1, BOARD_REFRESH)), 'dispatch-board'));
  const themes = getCorpus().banks.worldTheme;
  const top = cands.length ? Math.max(...cands.map(powerOf)) : 1;
  const base = Math.max(1, Math.min(9, top));
  const rankIdx = Math.max(0, TEAM_RANKS.indexOf(rank));
  const out: DispatchOffer[] = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const k = pickFrom(rng, MISSION_KIND);
    const world = pickFrom(rng, themes);
    // 阶梯：低于阵容 1 阶（稳）→ 持平 → 高 1 阶 → 高 2 阶（"够一够"，最后一条永远是挑战）
    const tier = Math.max(1, Math.min(9, base - 1 + i));
    const slots = Math.min(4, 1 + Math.floor((tier + rankIdx) / 3));
    out.push({
      id: `dp_${turn}_${i}_${hashStr(world + k.verb + i).toString(36)}`,
      title: `${k.verb}${k.noun}`,
      world,
      tier,
      turns: 3 + Math.floor(rng() * 4) + (tier >= 6 ? 2 : 0),   // 3~6 回合，高阶更久
      slots,
      arch: k.arch,
      archLabel: k.arch ? ARCH_LABEL[k.arch] : undefined,
      minPower: tier,
      danger: Math.min(0.95, k.danger + (tier >= 7 ? 0.15 : 0)),
    });
  }
  return out;
}

/* ══════════ 出勤评估（面板实时显示，与结算同一套算法）══════════ */

export interface DispatchEstimate {
  score: number;                 // 0~100 判定分
  detail: { label: string; delta: number }[];   // 逐项拆解（面板展示"为什么"）
  understaffed: boolean;
}

/** 关系网白嫖：轨道A 在后台一直在写 relations（宿敌/盟友），派谁跟谁一起走因此有了真实后果。 */
function relationDelta(members: NpcRecord[]): { delta: number; foes: number; allies: number } {
  let foes = 0, allies = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const rel = `${members[i].relations ?? ''}｜${members[j].relations ?? ''}`;
      const a = members[i].name ?? '', b = members[j].name ?? '';
      if (!a || !b) continue;
      const mentions = (s: string, who: string) => !!who && s.includes(who);
      if (mentions(rel, a) && mentions(rel, b)) {
        if (/宿敌|仇/.test(rel)) foes++;
        else if (/盟友|挚友|同伴/.test(rel)) allies++;
      }
    }
  }
  return { delta: allies * 6 - foes * 10, foes, allies };
}

export function estimateDispatch(offer: DispatchOffer, members: NpcRecord[], rank: TeamRank): DispatchEstimate {
  const detail: { label: string; delta: number }[] = [];
  if (!members.length) return { score: 0, detail: [{ label: '未编成', delta: 0 }], understaffed: true };

  const powers = members.map(powerOf);
  const top = Math.max(...powers);
  const avg = powers.reduce((a, b) => a + b, 0) / powers.length;
  const core = top * 0.6 + avg * 0.4;                 // 一个强者能带，但整体拖后腿照样扣
  const gap = Math.round((core - offer.tier) * 12);
  detail.push({ label: `战力 ${core.toFixed(1)} vs ${offer.tier}阶`, delta: gap });

  const miss = offer.slots - members.length;
  const staff = miss > 0 ? -15 * miss : Math.min(10, (members.length - offer.slots) * 5);
  if (staff !== 0) detail.push({ label: miss > 0 ? `缺 ${miss} 人` : `超编 ${-miss} 人`, delta: staff });

  let archD = 0;
  if (offer.arch) {
    const hit = members.filter((m) => archOf(m) === offer.arch).length;
    archD = hit >= 2 ? 14 : hit === 1 ? 10 : -6;
    detail.push({ label: hit ? `${offer.archLabel}系 ×${hit}` : `无${offer.archLabel}系`, delta: archD });
  }

  const T = useTeam.getState();
  const fat = members.reduce((a, m) => a + (T.fatigue[m.id] ?? 0), 0) / members.length;
  const fatD = -Math.round(fat / 10);
  if (fatD !== 0) detail.push({ label: `平均疲劳 ${Math.round(fat)}`, delta: fatD });

  const rel = relationDelta(members);
  if (rel.delta !== 0) detail.push({ label: rel.foes ? `队内宿敌 ×${rel.foes}` : `队内盟友 ×${rel.allies}`, delta: rel.delta });

  const rankD = Math.max(0, TEAM_RANKS.indexOf(rank)) * 2;
  if (rankD) detail.push({ label: `团队 ${rank} 阶`, delta: rankD });

  const score = Math.max(0, Math.min(100, 50 + gap + staff + archD + fatD + rel.delta + rankD));
  return { score, detail, understaffed: miss > 0 };
}

/* ══════════ 结算（到点才跑，一次算死）══════════ */

const isProtected = (n: NpcRecord) => !!(n.isFriend || n.isBond || n.keepForever || n.partyMember);

/** 纯函数：给定委托 + 出勤名单 + 种子，算出整份账本。单测直接打这里。 */
export function settleDispatch(
  rec: DispatchRecord, members: NpcRecord[], rank: TeamRank, turn: number,
  opts: { allowDeath?: boolean } = {},
): DispatchLedger {
  const rng = makeRng(seedFrom(rec.startTurn, rec.id));
  const { score } = estimateDispatch(rec.offer, members, rank);
  const roll = score + (rng() * 30 - 15);            // ±15 波动：强队也可能翻车，弱队也有冷门
  const rating = ratingOf(roll);
  const good = isGood(rating), bad = isBad(rating);
  const o = rec.offer;

  const results: DispatchMemberResult[] = [];
  const casualties: string[] = [];
  for (const m of members) {
    const gapUp = Math.max(0, o.tier - powerOf(m));                     // 越级出勤更累
    const fatigueAdd = Math.max(12, Math.min(45, 16 + o.turns * 2 + gapUp * 6));
    const maxHp = m.maxHp ?? 100;
    const lossPct = (bad ? 0.28 : good ? 0.06 : 0.15) * o.danger * (0.6 + rng() * 0.8);
    const hpLoss = Math.round(maxHp * lossPct);

    const r: DispatchMemberResult = { id: m.id, name: m.name ?? m.id, fatigueAdd, hpLoss, note: '' };

    // 受伤：坏结算 + 危险度掷骰。伤势期间不可出勤 → 这才是"强制轮换"真正咬人的地方
    if (bad && rng() < o.danger) {
      r.injured = pickFrom(rng, INJURY_POOL);
      r.injuryTurns = 3 + Math.floor(rng() * 4);
    }
    // 陨落：只在最差评级 + 玩家开了致死开关 + 非受保护对象。复用轨道A 的同一套门，不另开后门
    if (rating === 'E' && opts.allowDeath && !isProtected(m) && rng() < o.danger * 0.35) {
      r.dead = true; r.injured = undefined; r.injuryTurns = undefined;
      casualties.push(r.name);
      r.note = `在${o.world}折戟，没能回来。`;
    } else if (r.injured) {
      r.note = `重伤而归（${r.injured}），需静养 ${r.injuryTurns} 回合。`;
    } else if (good) {
      r.note = `表现出色，${o.title}一役出力最多。`;
    } else {
      r.note = `完成了分内的部分，疲惫但无碍。`;
    }
    results.push(r);
  }

  // 战利品：仅 S 及以上，且只落到一名生还者头上（吃轨道A 的同一条 8 件上限，见 applyLedger）
  if (RATINGS.indexOf(rating) >= RATINGS.indexOf('S')) {
    const alive = results.filter((r) => !r.dead);
    if (alive.length) {
      const pick = alive[Math.floor(rng() * alive.length)];
      const npc = members.find((m) => m.id === pick.id);
      if (npc) pick.lootName = makeEquipItem(npc, rng, turn).name;
    }
  }

  const scale = RATING_SCALE[rating] ?? 0;
  const kind = o.tier >= 4 ? '魂币' : '乐园币';                        // 四阶门槛：绝不混发
  const amount = Math.round((o.tier >= 4 ? SOUL_COIN[o.tier] : PARADISE_COIN[o.tier]) * scale);

  return {
    rating, success: !bad, score: Math.round(score),
    teamExp: (RATING_EXP[rating] ?? 0) + Math.max(0, o.tier - 2),
    activity: 10 + (bad ? 0 : 8),                                     // 出勤本身提活跃，成功再加——这是活跃度唯一的玩家杠杆
    currency: { kind, amount },
    members: results, casualties, sealedAt: turn,
  };
}

/* ══════════ 落库 ══════════ */

const mkDeed = (turn: number, location: string, description: string): Deed =>
  ({ time: `第${turn}回合`, location, description, addedAt: Date.now() });

/** 把账本真正应用到 NPC / 团队上。**只在封存那一刻调一次**。 */
function applyLedger(rec: DispatchRecord, ledger: DispatchLedger, turn: number): void {
  const T = useTeam.getState();
  const npcStore = useNpc.getState();
  const o = rec.offer;
  // 委托酬劳：达成才发（E/D 失利不发）。先发再落账，账本里记下发了什么。
  if (ledger.success) ledger.rewardGranted = grantReward(o);

  const updates: { id: string; deed?: Deed; patch?: Partial<NpcRecord> }[] = [];
  const fatDelta: Record<string, number> = {};
  for (const r of ledger.members) {
    const npc = npcStore.npcs[r.id];
    if (!npc) continue;
    const patch: Partial<NpcRecord> = {};
    if (r.dead) {
      patch.isDead = true; patch.deadTurn = turn; patch.status = '已死亡';
    } else {
      patch.status = '主神空间·休整';
      if (r.hpLoss > 0) patch.hp = Math.max(1, (npc.hp ?? npc.maxHp ?? 100) - r.hpLoss);   // 派遣绝不直接打死人，死只走上面那条门
      fatDelta[r.id] = r.fatigueAdd;
      if (r.injured && r.injuryTurns) useTeam.getState().setInjury(r.id, { turns: r.injuryTurns, name: r.injured });
    }
    updates.push({ id: r.id, deed: mkDeed(turn, o.world, `【${T.name || '冒险团'}·委托】${o.title}——${r.note}`), patch });

    // 战利品：走轨道A 的同一条上限，标同一个 acquisition，开了派遣也不能绕过 8 件
    if (r.lootName && !r.dead && !autoGearFull(npc)) {
      const item = makeEquipItem(npc, makeRng(hashStr(rec.id + r.id)), turn);
      npcStore.addNpcItem(r.id, { ...item, name: r.lootName, acquisition: '离场历练所得' });
    }
  }
  if (updates.length) npcStore.applyAutonomy(updates);
  if (Object.keys(fatDelta).length) useTeam.getState().patchFatigue(fatDelta);

  const t = useTeam.getState();
  t.addExp(ledger.teamExp);
  t.addActivity(ledger.activity);
  const money = ledger.currency.amount > 0 ? `，进账 ${ledger.currency.amount} ${ledger.currency.kind}` : '';
  const lost = ledger.casualties.length ? `，折损 ${ledger.casualties.join('、')}` : '';
  t.appendDeed(mkDeed(turn, o.world, `委托「${o.title}」评级 ${ledger.rating}${money}${lost}${ledger.rewardGranted ? `，酬劳「${ledger.rewardGranted}」入库` : ''}。`));
}

/** 委托酬劳入主角背包。**只在委托达成（评级非 E/D）时调**，失利不发。
 *  走 `addItem` 直投（前端权威发放，不是正文指令）；随后 `pushFacilityGranted` + `pushSceneNotice`
 *  ——不这么做，物品演化阶段会把同一件东西再 createItem 一遍，正文也可能改写它的名称/效果。 */
function grantReward(o: DispatchOffer): string | undefined {
  const r = o.reward;
  if (!r?.name) return undefined;
  // 六维/上限加成并进 effect：effectiveAttrs 只从 effect/affix/combatStat 读数值，
  // 单独留在 attrBonus 就是读不到的死数据（同开箱/合成/福袋的处理）。
  const effect = [r.effect, r.attrBonus].filter(Boolean).join('；');
  useItems.getState().addItem({
    name: r.name, category: r.category as never, gradeDesc: r.gradeDesc,
    subType: r.subType, origin: r.origin, combatStat: r.combatStat,
    durability: r.durability, requirement: r.requirement, score: r.score,
    affix: r.affix, effect, activeEffect: r.activeEffect, activeDuration: r.activeDuration,
    intro: r.intro, appearance: r.appearance, killCount: r.killCount,
    quantity: Math.max(1, r.quantity ?? 1), equipped: false,
    tags: r.tags ?? ['委托奖励'],
    acquisition: `冒险团委托·${o.title}（${o.world}）`,
  });
  try {
    pushFacilityGranted([r.name]);   // 本回合已入库 → 物品阶段绝不可再 createItem
    pushSceneNotice(`【场外·冒险团委托】外派队伍完成委托「${o.title}」（${o.world}），酬劳「${r.name}」已入主角储存空间（数值已由前端结算）。正文知晓即可，勿重复发放/结算，也**勿改写该物品的名称与效果**；可自然带过交接酬劳的一幕，不强求。`);
  } catch { /* 通报失败不阻断发放 */ }
  return r.name;
}

/* ══════════ 每回合心跳 ══════════ */

export interface DispatchTickResult { sealed: DispatchRecord | null; boardRolled: boolean }

/**
 * 每回合调用一次（挂在 runPostNarrativePhases，紧邻轨道A）。
 * - 疲劳恢复 / 伤势倒数
 * - 委托板到期换批
 * - **到点才结算**：`turn >= endTurn` 那一刻才算账本并封存。此前 `ledger` 在数据里根本不存在，
 *   所以"时间不到不能看结算"翻 store 也绕不过去（见 adventureTeamStore 文件头铁则①）。
 * 返回刚封存的那条（App 据此决定要不要自动生成战报）。
 */
export function runDispatchTick(turn: number): DispatchTickResult {
  const out: DispatchTickResult = { sealed: null, boardRolled: false };
  const T = useTeam.getState();
  if (!T.established || T.disbanded) return out;

  const active = T.dispatchActive;
  T.decayFatigue(active?.memberIds ?? []);        // 出勤中的不恢复疲劳
  T.tickInjury();

  if (active && turn >= active.endTurn) {
    const npcs = useNpc.getState().npcs;
    const members = active.memberIds.map((id) => npcs[id]).filter(Boolean);
    if (!members.length) {
      useTeam.getState().abortDispatch();          // 人全没了（被删档/归档）→ 撤回，不发奖也不报错
    } else {
      const allowDeath = !!useSettings.getState().npcAutonomyDeath;
      const ledger = settleDispatch(active, members, T.rank, turn, { allowDeath });
      applyLedger(active, ledger, turn);
      useTeam.getState().sealDispatch(ledger);
      out.sealed = useTeam.getState().dispatchHistory.at(-1) ?? null;
    }
  }

  out.boardRolled = ensureBoard(turn);
  return out;
}

/**
 * 保证委托板上有东西：过期或为空就换一批。返回是否真换了。
 * 面板打开时也调一次——委托板是**派生数据**，不该"必须先走一个回合才有得看"
 * （实机就是这么发现的：新档进游戏点开派遣页，一条委托都没有）。
 */
export function ensureBoard(turn: number): boolean {
  const T = useTeam.getState();
  if (!T.established || T.disbanded) return false;
  // ⚠ AI 生成的板**永不自动换批**：玩家花 token 换来的委托（还带着看得见的奖励物品），
  //   绝不能被免费的自动委托悄悄顶掉。要换只能玩家再点一次生成、或点「换回自动委托」。
  //   这也是"手动生成，不要自动生成"的字面落实。
  if (T.boardSource === 'ai' && T.dispatchBoard.length) return false;
  if (T.dispatchBoard.length && turn - (T.boardTurn ?? -1) < BOARD_REFRESH) return false;
  T.setBoard(rollOfferBoard(turn, T.rank, dispatchCandidates()), turn, 'auto');
  return true;
}

/** 面板「派出」按钮：组装记录并写进 store。返回 null＝没派出去（含原因由调用方自己校验）。 */
export function launchDispatch(offer: DispatchOffer, memberIds: string[], turn: number): DispatchRecord | null {
  const T = useTeam.getState();
  if (!T.established || T.disbanded || T.dispatchActive || !memberIds.length) return null;
  const npcs = useNpc.getState().npcs;
  const usable = memberIds.filter((id) => npcs[id] && !memberBlockReason(npcs[id]));
  if (!usable.length) return null;
  const rec: DispatchRecord = {
    id: `dr_${turn}_${offer.id}`,
    offer,
    memberIds: usable,
    memberNames: usable.map((id) => npcs[id]?.name || id),
    startTurn: turn,
    endTurn: turn + Math.max(1, offer.turns),
    startTime: useMisc.getState().paradiseTime || undefined,
    read: true,
  };
  useTeam.getState().beginDispatch(rec);
  if (!useTeam.getState().dispatchActive) return null;   // 竞态兜底：beginDispatch 拒绝覆盖已在跑的那支
  // 出勤即离场：正文侧不该再把他们当"待命"，状态同步过去（轨道A 已按 memberIds 让开，不会覆写）
  useNpc.getState().applyAutonomy(usable.map((id) => ({
    id,
    patch: { status: `执行委托中（${offer.world}）` },
    deed: mkDeed(turn, offer.world, `【${T.name || '冒险团'}·委托】受命前往${offer.world}，${offer.title}。`),
  })));
  return rec;
}
