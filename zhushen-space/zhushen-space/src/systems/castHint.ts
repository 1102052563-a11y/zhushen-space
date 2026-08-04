/*
  角色动向提示（v5.6 世界引擎 stage2 `<cast>` 的轮回乐园实装）
  ────────────────────────────────────────────────────────────
  治的病：**NPC 一离场就等于事实性消失**。
  轨道A 每回合都在后台给离场 NPC 织行动（他们确实在"过日子"），但没有任何机制把
  「这个人快回来了 / 他刚往哪儿去了」告诉正文——`buildPlotGuardInjection` 管剧情线，不管人。
  这是一条**数据早就攒好、只差最后一公里注入**的链路。

  轮回乐园特化（见 docs/WORLD_ENGINE_LUNHUI_ADAPT.md §3②）：入场理由**按 npcTag 分流**，
  否则 AI 会给土著编出「感应到契约者气息」这种直接破防全知铁则的理由。
    · 土著   → 只能是世界内的生活理由（赶集/送货/探亲/换防/对账）
    · 契约者 → 可以是任务/交易/结盟，但**不得**写成"察觉到主角"（既有认知障壁：
               碰面无法感知同类身份，除非露马脚）
    · 随从/宠物 → 本来就在身边，不走这条

  ⚠ 注入措辞必须是「可能/背景事实」，不能写成命令——否则每回合都有人推门进来。
*/
import { makeRng, seedFrom } from './autonomyCorpus';
import type { NpcRecord } from '../store/npcStore';
import { useNpc } from '../store/npcStore';

/** 每回合每人变成"可能登场"的基础概率。刻意压低——常态是没人来。 */
export const ENTER_CHANCE = 0.12;

/* 入场理由语料：全部是**世界内的生活/事务**，没有任何一条与主角的隐秘行为挂钩。 */
const NATIVE_ENTER = [
  '进城赶集，会路过',
  '送货途中要经过这一带',
  '来还上回借的东西',
  '照例来铺子对账',
  '换防轮到这一班',
  '受人之托来捎句话',
  '赶在天黑前回镇上',
  '听说市集今日开张，来看看货',
] as const;

const CONTRACTOR_ENTER = [
  '委托刚结了，来核对分成',
  '按先前约好的时辰来交货',
  '手头东西要出，正找买家',
  '路过此地，顺道歇脚',
  '同一片区域接了活，会撞上',
  '打算凑队，正在物色人手',
] as const;

const NATIVE_EXIT = [
  '回家吃饭去了', '赶着去送货', '回铺子照看生意', '轮到他当值', '天色晚了先回镇上', '去集上采买',
] as const;

const CONTRACTOR_EXIT = [
  '去接下一单委托', '回主神空间兑换', '说是要去趟拍卖行', '另有约在身', '去处理自己的事',
] as const;

export interface CastHint {
  readyToEnter?: boolean;
  enterReason?: string;
  exitReason?: string;
}

const isNativeTag = (n: NpcRecord): boolean => n.npcTag === '土著';
const isEscort = (n: NpcRecord): boolean => n.npcTag === '随从' || n.npcTag === '宠物' || n.npcTag === '召唤物';

/**
 * 确定性地决定某离场 NPC 本轮是否"可能登场"。纯函数，同 (npc, turn) 必得同结果。
 *
 * 不给提示的情况：在场 / 已冻结 / 归档 / 死亡 / 随从宠物（本来就在身边）/
 * 契约者正在任务世界相（人不在乐园，回不来）。
 */
export function decideCastHint(npc: NpcRecord, turn: number): CastHint {
  if (npc.onScene || npc.frozenAt || npc.archived || npc.isDead) return {};
  if (isEscort(npc)) return {};
  if (!isNativeTag(npc) && npc.auto?.phase === 'mission') return {};   // 契约者外派中

  const rng = makeRng((seedFrom(turn, npc.id) ^ 0x0ca57e1f) >>> 0);
  if (rng() >= ENTER_CHANCE) return {};

  const bank = isNativeTag(npc) ? NATIVE_ENTER : CONTRACTOR_ENTER;
  return { readyToEnter: true, enterReason: bank[Math.floor(rng() * bank.length)] };
}

/** 离场去向（在 setScene(false) 时取一条，纯确定性） */
export function pickExitReason(npc: NpcRecord, turn: number): string {
  const rng = makeRng((seedFrom(turn, npc.id) ^ 0x3f1a7b25) >>> 0);
  const bank = isNativeTag(npc) ? NATIVE_EXIT : CONTRACTOR_EXIT;
  return bank[Math.floor(rng() * bank.length)];
}

/** 一行展示用文案：`王五（土著·进城赶集，会路过）` */
export function castHintLine(n: NpcRecord): string {
  const tag = n.npcTag && n.npcTag !== '土著' ? n.npcTag : '土著';
  const why = n.auto?.enterReason || '';
  return `${n.name}（${tag}${why ? `·${why}` : ''}）`;
}

export interface CastHintData {
  entering: NpcRecord[];
  leaving: NpcRecord[];
}

/** 从 store 收集本轮的动向提示数据（可能登场 / 刚离场）。cap 防注入块膨胀。 */
export function collectCastHints(cap = 3): CastHintData {
  try {
    const all = Object.values(useNpc.getState().npcs)
      .filter((n) => n.name && !n.frozenAt && !n.archived && !n.isDead && !n.onScene);
    return {
      entering: all.filter((n) => n.auto?.readyToEnter).slice(0, cap),
      leaving: all.filter((n) => n.auto?.exitReason && !n.auto?.readyToEnter).slice(0, cap),
    };
  } catch { return { entering: [], leaving: [] }; }
}

/**
 * 构建 `<角色动向提示>` 注入块。挂在注入链**最末**（贴近用户输入 = 离生成最近）。
 * 两边都空 → 不出块。
 */
export function buildCastHintInjection(cap = 3): { role: 'system'; content: string }[] {
  const { entering, leaving } = collectCastHints(cap);
  if (!entering.length && !leaving.length) return [];
  const parts: string[] = [];
  if (entering.length) parts.push(`即将可能登场：\n${entering.map((n) => `· ${castHintLine(n)}`).join('\n')}`);
  if (leaving.length) parts.push(`刚刚离场：\n${leaving.map((n) => `· ${n.name}（${n.auto?.exitReason}）`).join('\n')}`);
  return [{
    role: 'system' as const,
    content: `<角色动向提示>（**背景事实，不是本回合的剧本**——这些人各自过着自己的日子，恰好可能与主角的路径交汇。`
      + `合适就让他自然出现，不合适就让他继续忙自己的，**绝不要为了用上提示而强行安排相遇**；一轮里最多让一人登场，多数回合一个都不该来。`
      + `⚠ 登场理由只能是他本人的生活/事务，**严禁**写成"察觉到主角""感应到气息""追查异动"之类的超距感应）\n`
      + `${parts.join('\n')}\n</角色动向提示>`,
  }];
}
