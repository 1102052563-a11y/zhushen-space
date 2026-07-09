import { usePlayer, type StatusEffect, type PlayerAttrs } from '../store/playerStore';
import { useMisc } from '../store/miscStore';
import { ATTR_KEYS, parseAttrBonus, type AttrDelta } from './attrBonus';
import { parseDurationTurns } from './gameClock';

/* 限时状态·六维加成汇总（发动/服药类临时增益）。
   与"常驻装备加成"分开：限时状态存续期间把 StatusEffect.attrs 折进有效六维，
   到期由 expireStatuses 自动移除→六维自动回落。故临时 buff 不必写进基础 attrs，
   既躲开"防膨胀守卫/永久化"，又不依赖 AI 记得撤销。主角与 NPC 共用（结构同源）。 */

/** 把一组限时状态里的六维加成累加成一个 delta（正=增益、负=减益，都计入）。*/
export function sumStatusAttrs(effects?: StatusEffect[]): AttrDelta {
  const d: AttrDelta = {};
  for (const e of effects ?? []) {
    const a = e?.attrs;
    if (!a) continue;
    for (const k of ATTR_KEYS) {
      const v = (a as Partial<PlayerAttrs>)[k];
      if (v) d[k] = (d[k] ?? 0) + v;
    }
  }
  return d;
}

/** 主角当前全部限时状态的六维加成合计（读 getState·非响应式；折进各处有效六维）。*/
export function playerStatusAttrDelta(): AttrDelta {
  return sumStatusAttrs(usePlayer.getState().profile.statusEffects);
}

/** 某 NPC 当前全部限时状态的六维加成合计（供 NPC 有效六维折入，可选）。*/
export function npcStatusAttrDelta(npc?: { statusEffects?: StatusEffect[] }): AttrDelta {
  return sumStatusAttrs(npc?.statusEffects);
}

/** 「⚡ 发动」装备主动效果 → 给主角登记一条限时状态（六维即时折进有效属性，存续期到点由 expireStatuses 自动撤销）。
   六维取自 activeEffect 文本的 parseAttrBonus；时长取"持续N回合"，缺省 3 回合（保证一定会自动回落）。返回是否登记成功。 */
export function applyItemActiveBuff(item: { name: string; activeEffect?: string }): boolean {
  const text = (item?.activeEffect ?? '').trim();
  if (!text) return false;
  const attrs = parseAttrBonus(text);
  const turns = parseDurationTurns(text) ?? 3;   // 无明确回合数→默认 3 回合，必定自动过期
  const turn = useMisc.getState().turnCount ?? 0;
  const nameMatch = text.match(/「([^」]{1,14})」/);   // 取"「余烬血脉」状态"里的状态名，否则用物品名
  const name = (nameMatch?.[1] || `${item.name}·主动`).trim();
  const eff: StatusEffect = {
    id: `ST_B1_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    name,
    type: '增益',
    emoji: '⚡',
    tone: 'buff',
    effect: text,
    source: item.name,
    startTurn: turn,
    durationTurns: turns,
    durationDesc: `${turns}回合`,
    startGameMin: null,
    expireAtMin: null,
    attrs: Object.keys(attrs).length ? attrs : undefined,
    addedAt: Date.now(),
  };
  usePlayer.getState().addStatusEffect(eff);
  return true;
}
