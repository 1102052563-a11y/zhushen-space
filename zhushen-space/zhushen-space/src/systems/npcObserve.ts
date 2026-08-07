/* 👁 NPC 即时观测「看看TA在做什么」（P2·借鉴 world-backstage）——纯逻辑层。
   给离场 NPC 生成一段第一人称即时片段：纯观看——不写状态、不推时间、不进正文、不进记忆；
   素材=她自己的档案 + 轨道A动向(status/deedLog) + **她有资格知道的**世界事件（P1 knownBy 认知边界的第一个消费点）。
   污染检测照抄参考插件 0.8.4 教训：结果混入正文协议/变量指令 → 拒收不缓存。 */
import type { NpcRecord } from '../store/npcStore';
import type { WorldEvent } from '../store/miscStore';
import { visibilityOf } from './worldEvent';

type SameFn = (a?: string, b?: string) => boolean;

/** 该角色有资格知道的活跃事件行：公开(known/direct)全给；hidden/trace 只有 knownBy 点名她才给（她是知情人）。 */
export function eventsKnownTo(events: WorldEvent[], npcName: string, worldName: string, same: SameFn): string[] {
  const nm = (npcName || '').trim();
  return events
    .filter((e) => (!e.worldName || same(e.worldName, worldName)) && !e.settledAt)
    .filter((e) => {
      const vis = visibilityOf(e);
      if (vis === 'known' || vis === 'direct') return true;
      return !!nm && (e.knownBy ?? '').includes(nm);
    })
    .slice(-4)
    .map((e) => {
      const latest = e.chain?.length ? e.chain[e.chain.length - 1].text : e.desc;
      return `${e.name || ''}${e.location ? `@${e.location}` : ''}：${latest ?? ''}`.slice(0, 60);
    })
    .filter((l) => l.length > 3);
}

export interface ObserveCtx {
  worldName: string;
  worldTime: string;
  playerName: string;
  knownEvents: string[];
}

/** 观测提示词：第一人称"我"的即时片段。她不知道的事绝不许出现（认知边界）。 */
export function buildObservePrompt(npc: NpcRecord, ctx: ObserveCtx): string {
  const deeds = (npc.deedLog ?? []).slice(-3).map((d) => `${d.time ? `${d.time}·` : ''}${d.location ? `${d.location}·` : ''}${d.description}`).join('\n');
  const loc = (npc.extra?.['位置'] as string) || '';
  const auto = npc.auto;
  const whereabouts = auto?.phase === 'mission' ? `正随队在「${auto.world || '任务世界'}」执行任务` : '';
  return `你是「此刻的${npc.name}」。写一段**第一人称（我）**的即时生活片段：她此刻正在哪、做什么、想什么。

【她是谁】
姓名：${npc.name}${npc.gender ? `｜${npc.gender}` : ''}${npc.realm ? `｜${npc.realm}` : ''}${npc.npcTag ? `｜${npc.npcTag}` : ''}
性格：${npc.personality || '（无档案）'}
近况状态：${npc.status || '（无）'}${loc ? `｜最后所在：${loc}` : ''}${whereabouts ? `｜${whereabouts}` : ''}
${npc.innerVoice ? `她最近的心声（保持口吻连续·可发展不要照抄）：${npc.innerVoice}` : ''}
${npc.background ? `背景：${npc.background.slice(0, 160)}` : ''}
${deeds ? `【她最近的经历（时间线）】\n${deeds}` : ''}
${ctx.knownEvents.length ? `【她知道的时局（只写她有资格知道的——名单之外的事她一无所知）】\n${ctx.knownEvents.map((l) => `- ${l}`).join('\n')}` : ''}

【当前时空】${ctx.worldName || '（未知）'}｜${ctx.worldTime || '（未知）'}

【铁则】
1. 150~300 字，第一人称"我"，写**此刻正在发生的一小段生活**（做事/走路/吃饭/发呆皆可），不是自我介绍、不是回忆录。
2. **认知边界**：上面没写的事她不知道——不许提及她不该知道的秘密、不许全知视角点评时局${npc.npcTag === '土著' ? '；她是本世界土著，**完全不知道**轮回乐园/契约者/任务这些概念，一个词都不能出现' : ''}。
3. **镜头不切**：${ctx.playerName || '主角'}不在她身边——不要让主角突然出现；若关系深可以让她想起主角一瞬，仅此而已。
4. 贴着她的性格与近况写；语气措辞随她的人设走。
5. **收束完整**：宁可短，不要停在半句话。
6. 禁止任何系统格式：不写标题、不写<state>之类指令、不写状态栏、不加旁白注解——只有她的片段本身。`;
}

/** 污染检测：观测结果混入正文协议/变量指令/结构模块 → 拒收（调用方不缓存、提示重试）。 */
export function observeContaminated(text: string): boolean {
  const s = (text || '').trim();
  if (!s) return true;
  return /<state|<upstore|<tableEdit|<proposal|【正文】|状态栏|【主角资源|时间结算|<击杀结算/i.test(s);
}
