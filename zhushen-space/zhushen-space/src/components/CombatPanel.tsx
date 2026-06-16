import { useEffect, useMemo, useState } from 'react';
import { useCombat, type CombatActionKind, type Combatant, type CombatStatBlock } from '../store/combatStore';
import { useCharacters } from '../store/characterStore';
import { usePlayer } from '../store/playerStore';
import { useNpc } from '../store/npcStore';

/* 模态战斗面板（仿 fanren-remake）。结算由引擎/编排器在 App 里完成；本组件只负责展示
   战况 + 收集玩家（B1）这一回合的动作，确认后回调 onPlayerAction。 */

const ACTION_LABELS: Record<CombatActionKind, string> = {
  attack: '普攻', skill: '技能', item: '道具', defend: '防御', flee: '逃跑',
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
  const avatar = id === 'B1' ? playerAvatar : npcAvatar;
  const c = battle.participants[id];
  const b = battle.initialState[id];
  if (!c || !b) return null;
  const dead = c.curHp <= 0 || c.left;
  const enemy = b.side === 'enemy';
  return (
    <button
      type="button"
      disabled={!onPick}
      onClick={onPick}
      className={`w-full text-left rounded-lg border p-2 transition
        ${dead ? 'opacity-40 grayscale' : ''}
        ${enemy ? 'border-rose-500/30 bg-rose-950/30' : 'border-cyan-500/30 bg-cyan-950/20'}
        ${isCurrent ? 'ring-2 ring-amber-400' : ''}
        ${isTarget ? 'ring-2 ring-rose-400' : ''}
        ${onPick ? 'hover:brightness-125 cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-center gap-2 mb-1">
        {avatar && <img src={avatar} alt="" className="w-9 h-9 rounded object-cover flex-none" />}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-slate-100 truncate">{b.name}{c.defending ? ' 🛡' : ''}</div>
          <div className="text-[10px] text-slate-400 truncate">{b.tier || ''}{b.bioStrength ? ` · ${b.bioStrength}` : ''}</div>
        </div>
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
      </div>
      {c.status.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {c.status.map((s, i) => (
            <span key={i} className="text-[9px] px-1 rounded bg-slate-700/60 text-slate-200">{s.emoji ?? ''}{s.name}</span>
          ))}
        </div>
      )}
    </button>
  );
}

export default function CombatPanel({ onPlayerAction }: {
  onPlayerAction: (kind: CombatActionKind, targetIds: string[], skillId?: string) => void;
}) {
  const battle = useCombat((s) => s.battle);
  const apiBusy = useCombat((s) => s.apiBusy);
  const apiStatus = useCombat((s) => s.apiStatus);
  const exitCombat = useCombat((s) => s.exitCombat);
  const characters = useCharacters((s) => s.characters);

  const curId = battle.order[battle.turn];
  const curActor = curId ? battle.participants[curId] : undefined;
  // 当前角色由玩家操控时才轮到玩家出手（含「手动控制队友」时的队友）
  const myTurn = battle.stage === 'awaiting_player' && battle.active && !!curActor;
  const stunned = !!curActor?.status?.some((s) => s.combat?.cannotAct);
  const charging = curActor?.charging;
  const actorSkills = (curId ? characters[curId]?.skills : undefined) ?? [];
  const isChargeSkill = (s: any) => /蓄力|蓄势|充能|聚能|聚力|过载|引导|凝聚|积蓄|灌注|吟唱/.test(`${s?.name ?? ''}${s?.skillType ?? ''}${s?.effect ?? ''}${(s?.tags ?? []).join('')}`);
  const isDomainSkillUI = (s: any) => /领域|结界|阵法|法阵|大阵|绝阵|场域|领地之|神域|封印之地|囚笼|阵图/.test(`${s?.name ?? ''}${s?.skillType ?? ''}${s?.effect ?? ''}${(s?.tags ?? []).join('')}`);

  const [action, setAction] = useState<CombatActionKind>('attack');
  const [skillId, setSkillId] = useState<string>('');
  const [targets, setTargets] = useState<string[]>([]);

  // 轮到（玩家操控的）当前角色时重置选择
  useEffect(() => {
    if (myTurn) { setAction('attack'); setSkillId(''); setTargets([]); }
  }, [myTurn, curId, battle.round, battle.turn]);

  const activeSkills = useMemo(() => actorSkills.filter((s) => !/被动/.test(s.skillType ?? '')), [actorSkills]);
  const selSkill = activeSkills.find((s) => s.id === skillId);
  const skillCd = (id: string) => curActor?.cooldowns?.[id] ?? 0;
  const skText = (s: any) => `${s?.skillType ?? ''}${s?.target ?? ''}${s?.effect ?? ''}${s?.name ?? ''}${(s?.tags ?? []).join('')}`;
  const isHeal = action === 'skill' && !!selSkill && /治疗|治愈|回复|恢复|疗伤|救治|加血/.test(skText(selSkill));
  const isAoe = action === 'skill' && !!selSkill && /群体|全体|范围|周围|所有|群攻|横扫|波及|溅射/.test(skText(selSkill));
  const isSelfCast = action === 'skill' && !!selSkill && !isHeal && !isAoe && /自身|自我|己身|自己|self/i.test(`${selSkill.target ?? ''}`);
  const isDomain = action === 'skill' && !!selSkill && isDomainSkillUI(selSkill);

  const aliveEnemies = battle.order.filter((id) => battle.participants[id]?.side === 'enemy' && !battle.participants[id]?.left && battle.participants[id]?.curHp > 0);
  const aliveAllies = battle.order.filter((id) => battle.participants[id]?.side === 'player' && !battle.participants[id]?.left && battle.participants[id]?.curHp > 0);
  const needsTarget = (action === 'attack' || action === 'skill') && !isAoe && !isSelfCast && !isDomain;

  function toggleTarget(id: string) {
    setTargets((t) => (t.includes(id) ? t.filter((x) => x !== id) : [id]));  // 单目标
  }
  function confirm() {
    if (!myTurn || stunned) return;
    if (needsTarget && targets.length === 0) return;
    onPlayerAction(action, needsTarget ? targets : [], action === 'skill' ? skillId : undefined);
  }
  function skip() { if (myTurn) onPlayerAction('defend', []); }

  const playerTeam = battle.order.filter((id) => battle.participants[id]?.side === 'player');
  const enemyTeam = battle.order.filter((id) => battle.participants[id]?.side === 'enemy');
  const log = battle.log;
  const ended = battle.stage === 'ended' || (!battle.active && battle.victor !== null);

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-3xl max-h-[94vh] flex flex-col rounded-xl border border-cyan-500/30 bg-slate-900/95 shadow-2xl overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700/60 bg-slate-950/60">
          <div className="flex items-center gap-2">
            <span className="text-rose-400">⚔️</span>
            <span className="text-sm font-semibold text-slate-100">战斗 · 第 {battle.round} 回合</span>
            {battle.context.location && <span className="text-xs text-slate-400">· {battle.context.location}</span>}
          </div>
          {apiBusy && <span className="text-xs text-amber-300 animate-pulse">{apiStatus || 'AI 思考中…'}</span>}
        </div>

        {/* 双方阵容 */}
        <div className="grid grid-cols-2 gap-3 p-3 border-b border-slate-800">
          <div className="space-y-2">
            <div className="text-[11px] text-cyan-300 font-medium">我方</div>
            {playerTeam.map((id) => (
              <Card key={id} id={id} isCurrent={curId === id} isTarget={targets.includes(id)}
                onPick={myTurn && needsTarget && isHeal ? () => toggleTarget(id) : undefined} />
            ))}
          </div>
          <div className="space-y-2">
            <div className="text-[11px] text-rose-300 font-medium">敌方</div>
            {enemyTeam.map((id) => (
              <Card key={id} id={id} isCurrent={curId === id} isTarget={targets.includes(id)}
                onPick={myTurn && needsTarget && !isHeal ? () => toggleTarget(id) : undefined} />
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
          {ended ? (
            <div className="flex items-center justify-between">
              <div className={`text-sm font-semibold ${battle.victor === 'player' ? 'text-emerald-300' : 'text-rose-300'}`}>
                {battle.victor === 'player' ? '🎉 战斗胜利' : battle.victor === 'enemy' ? '💀 战斗失败' : '战斗结束'}
                {battle.endReason ? ` · ${battle.endReason}` : ''}
              </div>
              <button onClick={exitCombat} className="px-4 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-sm">关闭</button>
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
              <div className="text-[11px] text-cyan-300">当前出手：{battle.initialState[curId]?.name ?? curId}</div>
              <div className="flex flex-wrap gap-1.5">
                {(['attack', 'skill', 'defend', 'flee'] as CombatActionKind[]).map((a) => (
                  <button key={a} onClick={() => { setAction(a); setTargets([]); }}
                    className={`px-3 py-1 rounded-md text-sm border ${action === a ? 'bg-cyan-600 border-cyan-400 text-white' : 'border-slate-600 text-slate-300 hover:bg-slate-800'}`}>
                    {ACTION_LABELS[a]}
                  </button>
                ))}
              </div>
              {action === 'skill' && (
                <select value={skillId} onChange={(e) => { setSkillId(e.target.value); setTargets([]); }}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200">
                  <option value="">— 选择技能 —</option>
                  {activeSkills.map((s) => { const cd = skillCd(s.id); return (
                    <option key={s.id} value={s.id} disabled={cd > 0}>{s.name}{s.level ? ` · ${s.level}` : ''}{s.cost ? ` (${s.cost})` : ''}{isChargeSkill(s) ? ' 🔋蓄力' : ''}{isDomainSkillUI(s) ? ' 🌀领域' : ''}{cd > 0 ? ` ⏳冷却${cd}` : ''}</option>
                  ); })}
                </select>
              )}
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-400">
                  {isAoe
                    ? `群体技能 · ${isHeal ? '我方全体' : '敌方全体'}（自动命中）`
                    : isSelfCast
                    ? '自身增益（无需目标）'
                    : isDomain
                    ? '展开领域（笼罩全场，无需目标）'
                    : needsTarget
                    ? (targets.length ? `目标：${battle.initialState[targets[0]]?.name ?? targets[0]}` : `点上方${isHeal ? '我方' : '敌方'}角色卡选目标`)
                    : action === 'defend' ? '本回合承伤减半' : '尝试脱离战斗'}
                </div>
                <button onClick={confirm}
                  disabled={(action === 'skill' && !skillId) || (needsTarget && targets.length === 0)}
                  className="px-5 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium">
                  出手
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center text-sm text-slate-400 py-1">
              {battle.active ? `${battle.initialState[curId]?.name ?? '对手'} 行动中…` : '战斗进行中…'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
