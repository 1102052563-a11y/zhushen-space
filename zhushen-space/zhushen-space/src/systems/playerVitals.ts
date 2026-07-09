import { useGame } from '../store/gameStore';
import { useNpc } from '../store/npcStore';
import { useMisc } from '../store/miscStore';
import { useFaction } from '../store/factionStore';
import { usePlayer, type PlayerAttrs } from '../store/playerStore';
import { useCharacters } from '../store/characterStore';
import { useItems } from '../store/itemStore';
import { playerTreeAttrBonus } from '../store/skillTreeStore';
import { playerTeamAttrBonus, playerTeamPerkAbilities } from '../store/adventureTeamStore';
import { withAttrDelta } from './attrBonus';
import { playerStatusAttrDelta } from './statusAttrs';
import { computeMaxHp, computeMaxEp, fullMaxHp, fullMaxEp, ratioOf, computeAttrPool, realAttrMult, type AttrCoef } from './derivedStats';
import { useResource } from '../store/resourceStore';

export function isHomeWorld(name?: string): boolean {
  return /轮回乐园|专属房间|主神空间/.test(name ?? '');   // 含「主神空间」仅为兼容旧存档的家园判定，非展示文案
}
/* 回归乐园后的一致性兜底（每回合开头跑，基于上一回合落库的状态）：
   ① 顶/底时间一致：home 时 worldTime = paradiseTime
   ② 任务世界的势力移出"当前世界"：home 时，worldName 属于任务世界(非家园)的势力 inCurrentWorld=false */
export function reconcileHomeWorld(): void {
  const M = useMisc.getState();
  if (!isHomeWorld(M.worldName)) return;
  if (M.paradiseTime && M.worldTime !== M.paradiseTime) M.setTime({ worldTime: M.paradiseTime });
  const F = useFaction.getState();
  for (const f of Object.values(F.factions)) {
    if (f.inCurrentWorld && f.worldName && !isHomeWorld(f.worldName)) F.setWorld(f.id, false);
  }
  // ★世界之源·回归乐园必归零（确定性保障，不靠 AI 记得发 = 0）：世界之源是「当前任务世界累计」，
  //   每个任务世界独立、绝不跨世界带入。人在轮回乐园（含专属房间/主神空间）时它恒为 0——
  //   下个任务世界从 0 重新累计。settlement 评级在任务世界内(未回归)读值，不受影响。
  const P = usePlayer.getState();
  if ((P.profile.worldSource ?? 0) !== 0) { P.setProfile({ worldSource: 0 }); console.log('[世界之源] 回归乐园→归零'); }
}

/* HP/EP 兜底：主角 HP/EP 仍是旧硬编码默认(100/100 & 50/50，从未被正文改过)时，按六维(体质×20 / 智力×15)重算为满。
   解决「主角 HP/EP 永远停在 100/50、不随体质/智力变化」。任一值被正文动过(≠默认)即不再插手，避免覆盖剧情伤害。
   （NPC 的 hp/mp 默认 undefined→effectiveResource 已按属性算满，本来就正常；只有主角有硬编码默认值需兜底。）*/
export function reconcilePlayerVitals(): void {
  const g = useGame.getState();
  const p = g.player;
  if (p.hp === 100 && p.maxHp === 100 && p.mp === 50 && p.maxMp === 50) {
    const prof = usePlayer.getState().profile;
    const a = prof.attrs;
    const r = ratioOf(prof);   // 主角自定义「体质→HP / 智力→EP」转化比（空=默认 20/15）
    const mh = computeMaxHp(a, 1, r), me = computeMaxEp(a, 1, r);
    if (mh !== 100 || me !== 50) {
      g.setPlayerField('maxHp', mh); g.setPlayerField('hp', mh);
      g.setPlayerField('maxMp', me); g.setPlayerField('mp', me);
    }
  }
}

/* 主角「HP/EP 基础六维」= 基础 attrs + 技能树 + 冒险团 + **真实属性点直加(realAttrs)**。
   与战斗 buildCombatant(baseTT)、属性面板 breakdownReal 严格同口径：realAttrs 直加并入六维，自动进 攻防/HP/EP。
   ⚠ 曾漏加 realAttrs → 真实属性点加到体质/智力后，属性面板与战斗都涨、唯独 HP/EP 上限不涨
   （用户报"真实体质没计入血量计算"）。所有主角 vitals 计算都走这里，防再次漂移。 */
function playerBaseAttrs(prof: { attrs?: PlayerAttrs; realAttrs?: Partial<PlayerAttrs> }): PlayerAttrs {
  return withAttrDelta(withAttrDelta(withAttrDelta(withAttrDelta(prof.attrs, playerTreeAttrBonus()), playerTeamAttrBonus()), prof.realAttrs), playerStatusAttrDelta());
}

/* 主角 HP/EP 真实上限 = 体质/智力×系数 + 装备上限加成 + 被动/天赋上限加成（如「生命上限+100」被动）。
   各处统一用这两个，确保正文/面板/AI快照/短指令钳制一致。 */
export function playerMaxHp(): number {
  const prof = usePlayer.getState().profile;
  const a = playerBaseAttrs(prof);   // 基础六维 + 技能树 + 团队 + 真实属性点直加（体质→HP，与属性面板/战斗同口径）
  const b1 = useCharacters.getState().characters['B1'];
  const eq = useItems.getState().items.filter((i) => i.equipped) as any[];
  // ★realMult 必须 = realAttrMult(tier,level)（四阶起×5），与血条/属性面板/战斗同口径——曾误传 1，导致四阶+主角"钳制上限"偏低、把正文当前 HP/EP 钳下去（用户报"血条和状态结算对不上"）。
  return fullMaxHp(a, eq, b1?.skills, [...(b1?.traits ?? []), ...playerTeamPerkAbilities()], realAttrMult(prof.tier, prof.level), ratioOf(prof));   // 团队效果里「生命上限+N / X%生命加成」一并计入；自定义体质→HP 转化比
}
export function playerMaxEp(): number {
  const prof = usePlayer.getState().profile;
  const a = playerBaseAttrs(prof);   // 基础六维 + 技能树 + 团队 + 真实属性点直加（智力→EP，与属性面板/战斗同口径）
  const b1 = useCharacters.getState().characters['B1'];
  const eq = useItems.getState().items.filter((i) => i.equipped) as any[];
  return fullMaxEp(a, eq, b1?.skills, [...(b1?.traits ?? []), ...playerTeamPerkAbilities()], realAttrMult(prof.tier, prof.level), ratioOf(prof));   // realMult 同 HP·四阶起×5；自定义智力→EP 转化比
}

/* 自定义能量条上限（仅主角）：有六维公式 maxFormula → 按公式×真实倍率(四阶起×5，与 HP/EP 同口径，作用于基础+技能树+团队六维)；
   否则固定 max（缺省 100）。供解析器钳制 res.B1.<id> 与 PlayerSidebar 渲染共用。 */
export function playerResourceMax(def: { max?: number; maxFormula?: AttrCoef }): number {
  const f = def.maxFormula;
  if (!f || Object.keys(f).length === 0) return Math.max(1, Math.round(def.max ?? 100));
  const prof = usePlayer.getState().profile;
  const a = playerBaseAttrs(prof);   // 六维基（含技能树/团队加成 + 真实属性点直加，与 HP/EP 同口径）
  return Math.max(1, computeAttrPool(a, f, realAttrMult(prof.tier, prof.level)));
}

/* 战斗内累积（仅 B1·在战斗驱动 resolveAndNarrate 里调，不碰战斗引擎）：每次出手后调一次（actorId=出手者）；
   advanceTurn 后回合开始的 DoT/领域持续伤害也补调一次（actorId='__dot__'，只走 onHitTaken）。
   b1HpDelta=B1 本次 HP 变化(负=受伤)；killed=本次 B1 击杀的敌人数。
   据每条能量条的 combat 规则增减并钳到 [0,上限]；无 combat 配置的能量条不受影响。 */
export function applyCombatResourceGains(actorId: string, kind: string, b1HpDelta: number, killed: number): void {
  const R = useResource.getState();
  if (!R.resources.some((r) => r.combat)) return;
  for (const r of R.resources) {
    const cb = r.combat; if (!cb) continue;
    let gain = 0;
    if (actorId === 'B1') {
      if ((kind === 'attack' || kind === 'skill' || kind === 'charge') && cb.onAttack) gain += cb.onAttack;
      if (cb.onTurn) gain += cb.onTurn;
      if (killed > 0 && cb.onKill) gain += cb.onKill * killed;
    }
    if (b1HpDelta < 0 && cb.onHitTaken) gain += cb.onHitTaken;   // B1 掉血（任意来源的直接出手命中）
    if (gain === 0) continue;
    const max = playerResourceMax(r);
    R.setCur(r.id, Math.min(max, Math.max(0, Math.round((r.cur ?? 0) + gain))));
  }
}
/* 每场战斗开始：把标了 resetEachBattle 的能量条归零（如怒气从 0 攒起）。 */
export function resetCombatResources(): void {
  const R = useResource.getState();
  for (const r of R.resources) if (r.combat?.resetEachBattle && (r.cur ?? 0) !== 0) R.setCur(r.id, 0);
}

/* HP/EP 上限同步（忠于正文末尾结算·2026-06-18 用户最终拍板：刷新只夹到正确上限、不强行拉满）。
   当前 HP/EP 一律由正文末尾 <状态结算>(applyNarrativeVitals)、战斗结算、hp.B1 指令驱动并**原样保留**——本函数绝不补血。
   只把存储上限 game.player.maxHp/maxMp 同步到真实上限(playerMaxHp/EP，含技能树)，让 StatusBar/钳制口径正确；
   setPlayerField 经 gameStore.clampPlayer(hp=min(hp,maxHp)) 顺带处理：上限调小(洗点/卸装)时当前自动夹回新上限，上限调大时当前原样不动(不回血)。
   在 刷新挂载 / 每回合 callApi 开头 / 关技能树面板 各跑一次。 */
export function syncPlayerVitalsMax(): void {
  const g = useGame.getState();
  const p = g.player;
  const liveHp = playerMaxHp(), liveEp = playerMaxEp();
  if (p.maxHp !== liveHp) g.setPlayerField('maxHp', liveHp);   // clampPlayer 顺带把超出新上限的 hp 夹回(只降不升)
  if (p.maxMp !== liveEp) g.setPlayerField('maxMp', liveEp);
}

/* 手动「回满 HP/EP」（主角 + 在场/常驻队友）——纯前端确定性满血满蓝。
   设计上当前 HP/EP 忠于正文、不自动补血（auto-forcefill 被否决过）；但**玩家主动点**的回满是允许的逃生口，
   专治"队友总是 400/4000 残疾状态、刷新也回不满"。回满到各自**当前真实上限**（主角含技能树/装备/团队；NPC 用其已算 maxHp/maxMp）。*/
export function refillAllVitals(): { team: number } {
  const g = useGame.getState();
  const mh = playerMaxHp(), me = playerMaxEp();
  g.setPlayerField('maxHp', mh); g.setPlayerField('hp', mh);
  g.setPlayerField('maxMp', me); g.setPlayerField('mp', me);
  const npc = useNpc.getState();
  let team = 0;
  for (const r of Object.values(npc.npcs)) {
    const rec: any = r;
    if (rec.isDead) continue;
    if (!(rec.onScene || rec.partyMember || rec.keepForever)) continue;   // 只回满在场/常驻队友，不动满世界的路人 NPC
    const cmh = rec.maxHp ?? 0, cmm = rec.maxMp ?? 0;
    if (cmh > 0 || cmm > 0) { npc.upsertNpc(rec.id, { hp: cmh, mp: cmm }); team++; }
  }
  return { team };
}
