import { useEffect, useMemo, useRef, useState } from 'react';
import { useCombat, type CombatActionKind, type Combatant, type CombatStatBlock } from '../store/combatStore';
import { useCharacters } from '../store/characterStore';
import { usePlayer } from '../store/playerStore';
import { useNpc } from '../store/npcStore';
import { useItems } from '../store/itemStore';
import { useResource } from '../store/resourceStore';
import { useMp } from '../store/multiplayerStore';
import { telegraphIntent } from '../systems/enemyAI';
import { combatIconFor } from './combatIcons';

/* 模态战斗面板（仿 fanren-remake）。结算由引擎/编排器在 App 里完成；本组件只负责展示
   战况 + 收集玩家（B1）这一回合的动作，确认后回调 onPlayerAction。 */

const ACTION_LABELS: Record<CombatActionKind, string> = {
  attack: '普攻', skill: '技能', item: '道具', defend: '防御', protect: '保护', flee: '逃跑', charge: '蓄力', cancel: '撤销',
};

function hpPct(c: Combatant, b: CombatStatBlock) { return b.maxHp > 0 ? Math.max(0, Math.min(100, (c.curHp / b.maxHp) * 100)) : 0; }
function epPct(c: Combatant, b: CombatStatBlock) { return b.maxEp > 0 ? Math.max(0, Math.min(100, (c.curEp / b.maxEp) * 100)) : 0; }

function Bar({ pct, color, track }: { pct: number; color: string; track: string }) {
  return (
    <div className={`h-2 rounded-full overflow-hidden ${track}`}>
      <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Card({ id, isCurrent, isTarget, onPick }: { id: string; isCurrent: boolean; isTarget: boolean; onPick?: () => void }) {
  const battle = useCombat((s) => s.battle);
  // 肖像实时按 id 取（图片存 store/IndexedDB，不进战斗存档）：主角 B1 取 profile.avatar，NPC 取 npc.avatar
  const playerAvatar = usePlayer((s) => s.profile.avatar);
  const npcAvatar = useNpc((s) => s.npcs[id]?.avatar);
  const c = battle.participants[id];
  const b = battle.initialState[id];
  const curHp = c?.curHp ?? 0;
  // 受击/治疗动效：HP 变化 → 浮动伤害数字 + 红闪（hooks 必须先于任何 return）
  const prevHp = useRef(curHp);
  const [pop, setPop] = useState<{ amt: number; key: number } | null>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const d = prevHp.current - curHp; prevHp.current = curHp;   // >0 掉血 / <0 回血
    if (d === 0) return;
    const key = Date.now() + Math.random();
    setPop({ amt: d, key });
    const timers = [setTimeout(() => setPop((p) => (p && p.key === key ? null : p)), 950)];
    if (d > 0) { setFlash(true); timers.push(setTimeout(() => setFlash(false), 400)); }
    return () => timers.forEach(clearTimeout);
  }, [curHp]);
  if (!c || !b) return null;
  const avatar = id === 'B1' ? playerAvatar : npcAvatar;
  const dead = c.curHp <= 0 || c.left;
  const enemy = b.side === 'enemy';
  const realTop = Math.max(0, ...[b.attrs.str, b.attrs.agi, b.attrs.con, b.attrs.int, b.attrs.cha, b.attrs.luck].map((v) => Math.floor((v || 0) / 80)));  // 最高真实属性（每80普通=1真实）
  return (
    <button
      type="button"
      disabled={!onPick}
      onClick={onPick}
      className={`relative w-full text-left rounded-lg border p-2 transition
        ${dead ? 'opacity-40 grayscale' : ''}
        ${enemy ? 'border-rose-500/30 bg-gradient-to-b from-rose-950/40 to-slate-900/30' : 'border-cyan-500/30 bg-gradient-to-b from-cyan-950/30 to-slate-900/20'}
        ${isCurrent ? 'ring-2 ring-amber-400 turn-glow' : ''}
        ${isTarget ? 'ring-2 ring-rose-400' : ''}
        ${flash ? 'hit-flash' : ''}
        ${onPick ? 'hover:brightness-125 cursor-pointer' : 'cursor-default'}`}
    >
      {pop && <span className={`dmg-pop text-sm ${pop.amt > 0 ? 'dmg-hurt' : 'dmg-heal'}`}>{pop.amt > 0 ? `-${pop.amt}` : `+${-pop.amt}`}</span>}
      <div className="flex items-center gap-2 mb-1">
        {avatar && <img src={avatar} alt="" className="w-9 h-9 rounded object-cover flex-none" />}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-slate-100 truncate">{b.name}{c.defending ? ' 🛡' : ''}</div>
          <div className="text-[10px] text-slate-400 truncate">{b.tier || ''}{b.bioStrength ? ` · ${b.bioStrength}` : ''}{realTop > 0 && <span className="text-amber-300"> · 真{realTop}</span>}</div>
        </div>
        {enemy && !dead && battle.active && (() => {
          const it = telegraphIntent(battle, id);
          return it.label ? <span className="self-start text-[9px] px-1 rounded bg-rose-950/70 text-rose-200 border border-rose-700/40 flex-none" title="敌方意图（预判）">{it.emoji}{it.label}</span> : null;
        })()}
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-emerald-300 w-5">HP</span>
          <div className="flex-1"><Bar pct={hpPct(c, b)} color="bg-emerald-500" track="bg-slate-800" /></div>
          <span className="text-[9px] text-slate-300 tabular-nums w-14 text-right">{Math.max(0, c.curHp)}/{b.maxHp}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-sky-300 w-5">EP</span>
          <div className="flex-1"><Bar pct={epPct(c, b)} color="bg-sky-500" track="bg-slate-800" /></div>
          <span className="text-[9px] text-slate-300 tabular-nums w-14 text-right">{Math.max(0, c.curEp)}/{b.maxEp}</span>
        </div>
        {c.curShield > 0 && (
          <div className="text-[9px] text-amber-300">护盾 {c.curShield}</div>
        )}
        {(c as any).coreArmorMax > 0 && ((c as any).breaking
          ? <div className="text-[9px] text-rose-300 font-medium">💥 破防中——全力输出！</div>
          : <div className="flex items-center gap-1">
              <span className="text-[9px] text-violet-300 w-5">护甲</span>
              <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden"><div className="h-full bg-violet-500 transition-all" style={{ width: `${Math.min(100, ((c as any).coreArmor / ((c as any).coreArmorMax || 1)) * 100)}%` }} /></div>
              <span className="text-[9px] text-slate-300 tabular-nums w-12 text-right">{(c as any).coreArmor}/{(c as any).coreArmorMax}</span>
            </div>
        )}
      </div>
      {c.status.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {c.status.map((s, i) => {
            const tone = s.tone === 'buff' ? 'bg-emerald-800/50 text-emerald-200 border-emerald-600/30'
              : s.tone === 'debuff' ? 'bg-rose-900/50 text-rose-200 border-rose-600/30'
              : 'bg-slate-700/60 text-slate-200 border-slate-600/30';
            const m = s.combat ?? {};
            const stacks = m.poisonStacks ?? m.strengthStacks ?? m.dexterityStacks ?? m.thorns;
            const turns = s.durationTurns != null ? Math.max(0, s.durationTurns - (battle.round - (s.startTurn ?? battle.round))) : undefined;
            const badge = stacks != null ? `×${stacks}` : turns != null ? `${turns}回` : '';
            const Ic = combatIconFor(s.name);
            return (
              <span key={i} title={s.effect || s.name} className={`text-[9px] px-1 rounded border inline-flex items-center gap-0.5 ${tone}`}>{Ic ? <Ic className="shrink-0" /> : (s.emoji ?? '')}{s.name}{badge ? ` ${badge}` : ''}</span>
            );
          })}
        </div>
      )}
    </button>
  );
}

export default function CombatPanel({ onPlayerAction, onUndo, canUndo, mpMode, mySeatId, takeover }: {
  onPlayerAction: (kind: CombatActionKind, targetIds: string[], skillId?: string, itemId?: string) => void;
  onUndo?: () => void;
  canUndo?: boolean;
  mpMode?: 'host' | 'guest' | null;   // 联机角色；null/缺省=单机
  mySeatId?: string | null;           // 来宾自己的座位（决定能控哪个 MP_ 战斗角色）
  takeover?: string[];                 // 房主因来宾 AFK 而可接手的 MP_ 战斗角色 id
}) {
  const battle = useCombat((s) => s.battle);
  const apiBusy = useCombat((s) => s.apiBusy);
  const apiStatus = useCombat((s) => s.apiStatus);
  const exitCombat = useCombat((s) => s.exitCombat);
  const characters = useCharacters((s) => s.characters);
  const playerItems = useItems((s) => s.items);
  const npcsMap = useNpc((s) => s.npcs);
  const raidDungeon = useMp((s) => s.raidDungeon);   // 副本：恐惧值团灭计时条（房主权威·relay 同步给来宾）
  const playerAvatar = usePlayer((s) => s.profile.avatar);   // 行动顺序条头像（B1）
  const config = useCombat((s) => s.config);
  const setConfig = useCombat((s) => s.setConfig);
  const speed = config.combatSpeed || 1;          // 1/2/4 倍速
  const autoOn = !!config.autoBattle;             // 自动战斗
  const sfxOn = config.sfxOn !== false;           // 音效开关
  const actLabel = (a: CombatActionKind) => a === 'skill' ? (config.skillLabel || '技能') : a === 'item' ? (config.itemLabel || '道具') : ACTION_LABELS[a];   // 武功/物品 可配置命名

  const curId = battle.order[battle.turn];
  const curActor = curId ? battle.participants[curId] : undefined;
  // 当前角色由玩家操控时才轮到玩家出手（含「手动控制队友」时的队友）
  // 谁能本地出手：单机=stage 已保证；房主=非 MP_ 角色；来宾=自己的 MP_<座位> 角色
  const curIsGuestOwned = !!curId && curId.startsWith('MP_');
  const canTakeOver = mpMode === 'host' && !!curId && (takeover ?? []).includes(curId);   // 来宾 AFK → 房主已解锁接手该角色
  const mineToControl = mpMode === 'guest' ? curId === `MP_${mySeatId}` : mpMode === 'host' ? (!curIsGuestOwned || canTakeOver) : true;
  const myTurn = battle.stage === 'awaiting_player' && battle.active && !!curActor && mineToControl;
  const stunned = !!curActor?.status?.some((s) => s.combat?.cannotAct);
  const charging = curActor?.charging;
  const actorSkills = (curId ? characters[curId]?.skills : undefined) ?? [];
  const isChargeSkill = (s: any) => /蓄力|蓄势|充能|聚能|聚力|过载|引导|凝聚|积蓄|灌注|吟唱/.test(`${s?.name ?? ''}${s?.skillType ?? ''}${s?.effect ?? ''}${(s?.tags ?? []).join('')}`);
  const isDomainSkillUI = (s: any) => /领域|结界|阵法|法阵|大阵|绝阵|场域|领地之|神域|封印之地|囚笼|阵图/.test(`${s?.name ?? ''}${s?.skillType ?? ''}${s?.effect ?? ''}${(s?.tags ?? []).join('')}`);

  const [action, setAction] = useState<CombatActionKind>('attack');
  const [skillId, setSkillId] = useState<string>('');
  const [itemId, setItemId] = useState<string>('');
  const [targets, setTargets] = useState<string[]>([]);

  // 轮到（玩家操控的）当前角色时重置选择
  useEffect(() => {
    if (myTurn) { setAction('attack'); setSkillId(''); setItemId(''); setTargets([]); }
  }, [myTurn, curId, battle.round, battle.turn]);

  // 当前出手角色可用的战斗道具（B1 取背包，队友取 NPC 物品；排除装备/已装备/空数量；要有效果或属消耗类）
  const actorItems = (curId === 'B1' || (mpMode === 'guest' && curId === `MP_${mySeatId}`)) ? playerItems : (npcsMap[curId ?? '']?.items ?? []);
  const usableItems = useMemo(() => actorItems.filter((i: any) =>
    !i.equipped && (i.quantity ?? 0) > 0 && !/武器|防具|饰品|宝石/.test(i.category ?? '')
    && (!!i.effect || /消耗品|丹药|灵药|符箓/.test(i.category ?? ''))
  ), [actorItems]);
  const selItem = usableItems.find((i: any) => i.id === itemId);
  const itemText = selItem ? `${selItem.name ?? ''}${selItem.subType ?? ''}${selItem.effect ?? ''}${(selItem.tags ?? []).join('')}` : '';
  // UI 侧镜像 combatEngine.inferItemEffect 的「打谁」判断（攻击向→敌方，其余→友方）
  const itemToEnemy = !!selItem && ((/炸弹|手雷|爆|燃烧弹|火焰弹|雷弹|轰|霰弹|爆裂/.test(itemText) && !/护|防/.test(itemText)) || /毒瓶|毒弹|剧毒|腐蚀|酸液/.test(itemText));
  const itemAoe = !!selItem && /范围|全体|群|溅射|波及|周围|所有/.test(itemText);

  const activeSkills = useMemo(() => actorSkills.filter((s) => !/被动/.test(s.skillType ?? '')), [actorSkills]);
  const selSkill = activeSkills.find((s) => s.id === skillId);
  const skillCd = (id: string) => curActor?.cooldowns?.[id] ?? 0;
  // 技能自定义能量条消耗（仅 B1·能量条存在才生效；引用已删能量条→视为无消耗，不拦不扣）
  const resources = useResource((s) => s.resources);
  const setResCur = useResource((s) => s.setCur);
  const rcOf = (s: any) => {
    const rc = s?.numeric?.resCost;
    if (!rc || curId !== 'B1' || !rc.id || !(rc.amount > 0)) return null;
    const def = resources.find((r) => r.id === rc.id);
    return def ? { id: rc.id as string, amount: rc.amount as number, name: def.name, avail: Math.max(0, def.cur ?? 0) } : null;
  };
  const gateOf = (s: any) => {   // 门槛：需该能量条 ≥ amount 才能放（不消耗）
    const g = s?.numeric?.resGate;
    if (!g || curId !== 'B1' || !g.id || !(g.amount > 0)) return null;
    const def = resources.find((r) => r.id === g.id);
    return def ? { id: g.id as string, amount: g.amount as number, name: def.name, avail: Math.max(0, def.cur ?? 0) } : null;
  };
  const resBlocked = (s: any) => {
    const rc = rcOf(s); if (rc && rc.avail < rc.amount) return true;   // 消耗不足
    const g = gateOf(s); if (g && g.avail < g.amount) return true;     // 门槛未达
    return false;
  };
  const skText = (s: any) => `${s?.skillType ?? ''}${s?.target ?? ''}${s?.effect ?? ''}${s?.name ?? ''}${(s?.tags ?? []).join('')}`;
  const isHeal = action === 'skill' && !!selSkill && /治疗|治愈|回复|恢复|疗伤|救治|加血/.test(skText(selSkill));
  const isAoe = action === 'skill' && !!selSkill && /群体|全体|范围|周围|所有|群攻|横扫|波及|溅射/.test(skText(selSkill));
  const isSelfCast = action === 'skill' && !!selSkill && !isHeal && !isAoe && /自身|自我|己身|自己|self/i.test(`${selSkill.target ?? ''}`);
  const isDomain = action === 'skill' && !!selSkill && isDomainSkillUI(selSkill);
  // 增益/支援类（buff/护盾/治疗、无攻击意图）→ 选友方目标（可给队友或主角加）
  const isSupport = action === 'skill' && !!selSkill && !isSelfCast && !isDomain
    && !/攻击|斩|劈|击|射|刺|炮|轰|冲|噬|咬|拳|爪/.test(skText(selSkill))
    && /强化|增幅|狂暴|战意|护体|守护|护盾|护罩|铁壁|金钟|再生|回春|不死|不屈|锁血|加持|祝福|庇护|鼓舞|激励|治疗|治愈|回复|恢复|疗|加血/.test(skText(selSkill));
  const isProtect = action === 'protect';   // 保护：选一名友方替其挡刀
  // 目标取友方：治疗/支援技能、保护，或「非攻击向」道具（药剂/护盾/净化等）
  const isAllyTarget = isHeal || isSupport || isProtect || (action === 'item' && !!selItem && !itemToEnemy);

  const needsTarget = ((action === 'attack' || action === 'skill') && !isAoe && !isSelfCast && !isDomain)
    || isProtect
    || (action === 'item' && !!selItem && !itemAoe);

  function toggleTarget(id: string) {
    setTargets((t) => (t.includes(id) ? t.filter((x) => x !== id) : [id]));  // 单目标
  }
  function confirm() {
    if (!myTurn || stunned) return;
    if (action === 'item' && !itemId) return;
    if (needsTarget && targets.length === 0) return;
    if (action === 'skill') {
      if (resBlocked(selSkill)) return;                // 消耗不足 / 门槛未达 → 拦下
      const rc = rcOf(selSkill);
      if (rc) setResCur(rc.id, rc.avail - rc.amount);  // 施放即扣减消耗（门槛 resGate 不消耗）
    }
    onPlayerAction(action, needsTarget ? targets : [], action === 'skill' ? skillId : undefined, action === 'item' ? itemId : undefined);
  }
  function skip() { if (myTurn) onPlayerAction('defend', []); }

  const playerTeam = battle.order.filter((id) => battle.participants[id]?.side === 'player');
  const enemyTeam = battle.order.filter((id) => battle.participants[id]?.side === 'enemy');
  const log = battle.log;
  const ended = battle.stage === 'ended' || (!battle.active && battle.victor !== null);

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-3xl max-h-[94dvh] flex flex-col rounded-xl border border-cyan-500/30 bg-slate-900/95 shadow-2xl overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700/60 bg-slate-950/60">
          <div className="flex items-center gap-2">
            <span className="text-rose-400">⚔️</span>
            <span className="text-sm font-semibold text-slate-100">战斗 · 第 {battle.round} 回合</span>
            {battle.context.location && <span className="text-xs text-slate-400">· {battle.context.location}</span>}
          </div>
          {apiBusy && <span className="text-xs text-amber-300 animate-pulse">{apiStatus || 'AI 思考中…'}</span>}
        </div>

        {/* 行动顺序条（先攻时间轴·连线 + 高亮当前出手者） */}
        {battle.active && battle.order.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 bg-slate-950/40 overflow-x-auto">
            <span className="text-[10px] text-amber-300/70 shrink-0 font-mono">⏱ 行动顺序</span>
            <div className="relative flex items-center gap-3 min-w-max">
              <div className="absolute left-2 right-2 top-[18px] h-px bg-gradient-to-r from-amber-500/25 via-slate-600/40 to-transparent pointer-events-none" />
              {battle.order.map((id, i) => {
                const c = battle.participants[id]; const b = battle.initialState[id];
                if (!c || !b) return null;
                const dead = c.curHp <= 0 || c.left;
                const isCur = i === battle.turn;
                const av = id === 'B1' ? playerAvatar : npcsMap[id]?.avatar;
                const ring = isCur ? 'border-amber-400' : b.side === 'enemy' ? 'border-rose-500/50' : 'border-cyan-500/50';
                return (
                  <div key={id} title={`${b.name}${isCur ? '（当前出手）' : ''}`} className={`relative shrink-0 flex flex-col items-center gap-0.5 ${dead ? 'opacity-30 grayscale' : ''}`}>
                    <div className={`rounded-full ${isCur ? 'turn-glow' : ''}`}>
                      {av
                        ? <img src={av} alt="" className={`w-9 h-9 rounded-full object-cover border-2 ${ring}`} />
                        : <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${ring} ${isCur ? 'text-amber-200 bg-amber-950/50' : b.side === 'enemy' ? 'text-rose-200/80 bg-rose-950/40' : 'text-cyan-200/80 bg-cyan-950/40'}`}>{(b.name || id).slice(0, 2)}</div>}
                    </div>
                    <span className={`text-[8px] leading-none max-w-[3.6rem] truncate ${isCur ? 'text-amber-300 font-semibold' : 'text-slate-500'}`}>{b.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 组队副本：恐惧之龙王槽（团灭计时） */}
        {raidDungeon && (
          <div className="px-4 py-1.5 border-b border-slate-800 bg-slate-950/40">
            <div className="flex items-center justify-between text-[11px] mb-0.5">
              <span className="text-rose-300/90">🔥 {raidDungeon.dreadLabel || '恐惧之龙王槽'} · {(raidDungeon as any).dreadMode === 'dot' ? '越满越痛' : '满则团灭'}</span>
              <span className="font-mono text-rose-300/70">{Math.round(raidDungeon.dread || 0)}/{raidDungeon.dreadMax || 100}</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-amber-500 to-rose-600 transition-all duration-300" style={{ width: `${Math.min(100, ((raidDungeon.dread || 0) / (raidDungeon.dreadMax || 100)) * 100)}%` }} />
            </div>
          </div>
        )}

        {/* 双方阵容 */}
        <div className="grid grid-cols-2 gap-3 p-3 border-b border-slate-800">
          <div className="space-y-2">
            <div className="text-[11px] text-cyan-300 font-medium">我方</div>
            {playerTeam.map((id) => (
              <Card key={id} id={id} isCurrent={curId === id} isTarget={targets.includes(id)}
                onPick={myTurn && needsTarget && isAllyTarget ? () => toggleTarget(id) : undefined} />
            ))}
          </div>
          <div className="space-y-2">
            <div className="text-[11px] text-rose-300 font-medium">敌方</div>
            {enemyTeam.map((id) => (
              <Card key={id} id={id} isCurrent={curId === id} isTarget={targets.includes(id)}
                onPick={myTurn && needsTarget && !isAllyTarget ? () => toggleTarget(id) : undefined} />
            ))}
          </div>
        </div>

        {/* 已展开的领域/阵法 */}
        {battle.activeArrays.length > 0 && (
          <div className="px-3 py-1.5 border-b border-slate-800 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-indigo-300">领域</span>
            {battle.activeArrays.map((d) => (
              <span key={d.id} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/50 text-indigo-100 border border-indigo-500/30">
                {d.emoji}{d.name}（{d.effectDesc}·剩{d.roundsLeft}）
              </span>
            ))}
          </div>
        )}

        {/* 战斗日志 */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1.5 min-h-[100px] text-sm">
          {log.length === 0 && <div className="text-slate-500 text-xs">战斗开始…</div>}
          {log.map((e) => (
            <div key={e.id} className={e.type === 'opening' || e.type === 'context' ? 'text-slate-300 italic' : 'text-slate-200'}>
              {e.narration && <div>{e.narration}</div>}
              {e.dialogue && <div className="text-cyan-200">「{e.dialogue}」</div>}
              {e.text && <div className="text-[11px] text-slate-400">{e.text}</div>}
            </div>
          ))}
        </div>

        {/* 行动区 / 结算区 */}
        <div className="border-t border-slate-700/60 bg-slate-950/60 p-3">
          {battle.active && (
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              <button onClick={() => setConfig({ autoBattle: !autoOn })} title="自动战斗：你的回合也交给本地 AI 代打（再点关闭）"
                className={`px-2.5 py-1 rounded text-xs border ${autoOn ? 'bg-emerald-600 border-emerald-400 text-white' : 'border-slate-600 text-slate-300 hover:bg-slate-800'}`}>{autoOn ? '⏸ 自动中' : '▶ 自动'}</button>
              {[2, 4].map((sp) => (
                <button key={sp} onClick={() => setConfig({ combatSpeed: speed === sp ? 1 : sp })} title="加快回合节奏（再点回 1x）"
                  className={`px-2.5 py-1 rounded text-xs border ${speed === sp ? 'bg-cyan-600 border-cyan-400 text-white' : 'border-slate-600 text-slate-300 hover:bg-slate-800'}`}>{sp}x</button>
              ))}
              <button onClick={() => setConfig({ sfxOn: !sfxOn })} title="战斗音效开关"
                className={`px-2.5 py-1 rounded text-xs border ${sfxOn ? 'bg-slate-700 border-slate-500 text-slate-200' : 'border-slate-600 text-dim/60 hover:bg-slate-800'}`}>{sfxOn ? '🔊 音效开' : '🔇 音效关'}</button>
            </div>
          )}
          {ended ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className={`text-sm font-semibold ${battle.victor === 'player' ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {battle.victor === 'player' ? '🎉 战斗胜利' : battle.victor === 'enemy' ? '💀 战斗失败' : '战斗结束'}
                  {battle.endReason ? ` · ${battle.endReason}` : ''}
                </div>
                <button onClick={exitCombat} className="px-4 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium">关闭</button>
              </div>
              {apiBusy
                ? <div className="text-[11px] text-amber-300/90 animate-pulse">📝 {apiStatus || '战斗总结生成中…'}——生成后会写入输入框，可直接关闭、稍后再发。</div>
                : <div className="text-[11px] text-slate-400">战斗结果已写入输入框，确认/编辑后发送即可续写正文。</div>}
            </div>
          ) : myTurn && stunned ? (
            <div className="flex items-center justify-between">
              <div className="text-sm text-amber-300">💫 {battle.initialState[curId]?.name ?? '当前角色'} 被控制，本回合无法行动。</div>
              <button onClick={skip} className="px-5 py-1.5 rounded-md bg-slate-600 hover:bg-slate-500 text-white text-sm">跳过</button>
            </div>
          ) : myTurn && charging ? (
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm text-amber-300">🔋 蓄力「{charging.name}」中（还需 {charging.turnsLeft} 回合）</div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => onPlayerAction('cancel', [])} className="px-3 py-1.5 rounded-md bg-slate-600 hover:bg-slate-500 text-white text-sm">中断</button>
                <button onClick={() => onPlayerAction('charge', charging.targetIds)}
                  className="px-5 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium">
                  {charging.turnsLeft <= 1 ? '🔥 释放大招' : '继续蓄力'}
                </button>
              </div>
            </div>
          ) : myTurn ? (
            <div className="space-y-2">
              {canTakeOver && (
                <div className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-600/30 rounded px-2 py-1">🎮 来宾挂机，你已接手「{battle.initialState[curId]?.name ?? curId}」——可替其出手（其回归后自动收回控制权）</div>
              )}
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-cyan-300">当前出手：{battle.initialState[curId]?.name ?? curId}</div>
                {canUndo && onUndo && (
                  <button onClick={onUndo} className="text-[11px] text-slate-400 hover:text-amber-300 underline decoration-dotted">↩ 撤销上一手</button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(['attack', 'skill', 'item', 'defend', 'protect', 'flee'] as CombatActionKind[]).map((a) => {
                  const Ic = combatIconFor(a);
                  return (
                  <button key={a} onClick={() => { setAction(a); setTargets([]); }}
                    className={`px-3 py-1 rounded-md text-sm border inline-flex items-center gap-1 ${action === a ? 'bg-cyan-600 border-cyan-400 text-white' : 'border-slate-600 text-slate-300 hover:bg-slate-800'}`}>
                    {Ic && <Ic className="text-[15px] opacity-90" />}{actLabel(a)}
                  </button>
                  );
                })}
              </div>
              {action === 'skill' && (
                <select value={skillId} onChange={(e) => { setSkillId(e.target.value); setTargets([]); }}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200">
                  <option value="">— 选择技能 —</option>
                  {activeSkills.map((s) => { const cd = skillCd(s.id); const rc = rcOf(s); const g = gateOf(s); return (
                    <option key={s.id} value={s.id} disabled={cd > 0 || resBlocked(s)}>{s.name}{s.level ? ` · ${s.level}` : ''}{s.cost ? ` (${s.cost})` : ''}{rc ? ` ⚡${rc.name}${rc.amount}${rc.avail < rc.amount ? `·不足(${rc.avail})` : ''}` : ''}{g ? ` 🔒${g.name}≥${g.amount}${g.avail < g.amount ? `·未达(${g.avail})` : ''}` : ''}{isChargeSkill(s) ? ' 🔋蓄力' : ''}{isDomainSkillUI(s) ? ' 🌀领域' : ''}{cd > 0 ? ` ⏳冷却${cd}` : ''}</option>
                  ); })}
                </select>
              )}
              {action === 'item' && (
                usableItems.length > 0 ? (
                  <select value={itemId} onChange={(e) => { setItemId(e.target.value); setTargets([]); }}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200">
                    <option value="">— 选择道具 —</option>
                    {usableItems.map((i: any) => (
                      <option key={i.id} value={i.id}>{i.name}{i.gradeDesc ? ` · ${i.gradeDesc}` : ''} ×{i.quantity}{i.effect ? ` — ${String(i.effect).slice(0, 16)}` : ''}</option>
                    ))}
                  </select>
                ) : (
                  <div className="text-xs text-slate-500">没有可用于战斗的道具（炸弹/药剂/丹药等）。</div>
                )
              )}
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-400">
                  {isAoe
                    ? `群体技能 · ${isAllyTarget ? '我方全体' : '敌方全体'}（自动命中）`
                    : isSelfCast
                    ? '自身增益（无需目标）'
                    : isDomain
                    ? '展开领域（笼罩全场，无需目标）'
                    : action === 'item' && selItem && itemAoe
                    ? `范围道具 · ${itemToEnemy ? '敌方全体' : '我方全体'}（自动命中）`
                    : needsTarget
                    ? (targets.length ? `${isProtect ? '保护' : '目标'}：${battle.initialState[targets[0]]?.name ?? targets[0]}` : `点上方${isAllyTarget ? '我方' : '敌方'}角色卡选${isProtect ? '要保护的队友（本回合替其挡下来袭）' : isAllyTarget ? '目标（给队友/自己加增益）' : action === 'item' ? '目标（投向敌人）' : '目标'}`)
                    : action === 'item' ? '选择一件道具' : action === 'defend' ? '本回合承伤减半 · 回复 EP' : '尝试脱离战斗'}
                </div>
                <button onClick={confirm}
                  disabled={(action === 'skill' && (!skillId || resBlocked(selSkill))) || (action === 'item' && !itemId) || (needsTarget && targets.length === 0)}
                  className="px-5 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium">
                  出手
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center text-sm text-slate-400 py-1">
              {mpMode === 'guest' ? '👀 观战中…（轮到你的角色时可出手）' : battle.active ? `${battle.initialState[curId]?.name ?? '对手'} 行动中…` : '战斗进行中…'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
