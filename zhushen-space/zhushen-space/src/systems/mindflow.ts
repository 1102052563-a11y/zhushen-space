/* 🫀 逐角色心流独白（借鉴 SoulLink「发送前角色推演」思想·代码自写·默认关）────────────
   每回合对排序前 N 位**在场**角色各发一次独立小调用：每个角色只拿到**自己的瘦人格档案**+最近剧情尾段+玩家本回合言行，
   产出第一人称心流（情绪/解读/行动倾向），拼成一块「导演注」注入正文调用。

   为什么逐角色而不是并进简报那一次调用：单次合并调用做不到「这个角色不知道什么」——
   规划模型看得见所有人的档案，信息盲区只能靠嘴上约束；逐角色调用把盲区做成**物理隔离**（档案之外真给不到它）。
   与简报的分工：简报=群像意向书（零新增调用·默认开）；心流=逐人深推演（每人一调·默认关·玩家显式开）。

   纪律（钉死）：
   · **并行不串行**：调用方在发送流程一开始就起跑本批（与检定/细纲/推进的等待窗口重叠），正文组装时限时收割；
   · fail-open：单角色失败丢该角色、整批失败/超时=不注入，绝不拦正文；
   · 污染检测（照 npcObserve 的 observeContaminated 思路）：输出混入 <state>/状态栏 等结构模块 → 整段丢弃；
   · 产物只进本回合正文调用，不落任何 store——⟳重生成/回退天然不残留。 */
import type { NpcRecord } from '../store/npcStore';
import type { ApiConfig } from '../store/settingsStore';
import { apiChatFallback } from './apiChat';
import { getPrompt } from '../store/promptOverrideStore';
import { NPC_MINDFLOW_RULE } from '../promptRules';
import { pickCastCandidates, serializeCastDossier } from './castBrief';

export interface MindflowResult { name: string; text: string }

/** 结构污染检测：心流该是纯内心独白，出现这些标记＝模型跑去写正文/指令了，整段作废 */
const CONTAMINATED = /<state\b|<upstore\b|<tableEdit\b|【正文】|状态栏|<状态结算|【主角资源/i;

/** 挑本批推演对象：复用简报的候选排序（点名>在场>随从>好感），但只留**在场**的——
 *  心流是"此刻在场者对玩家言行的即时反应"，离场的人物有轨道A/来讯管道，不在这儿烧调用。 */
export function pickMindflowTargets(npcs: NpcRecord[], userText: string, max: number): NpcRecord[] {
  return pickCastCandidates(npcs, userText, Math.max(1, max) * 2).filter((r) => r.onScene).slice(0, Math.max(1, max));
}

/** 单角色推演的请求消息（导出供单测）。角色只见自己的档案——信息盲区物理隔离。 */
export function buildMindflowMessages(r: NpcRecord, userText: string, recentTail: string): { role: string; content: string }[] {
  const sys = getPrompt('NPC_MINDFLOW_RULE', NPC_MINDFLOW_RULE);
  const user =
    `<该角色人格档案>（这是你的唯一身份依据：只知道档案里写的+这个角色亲历/被告知/目击的，其余一律不知道）\n${serializeCastDossier(r)}\n</该角色人格档案>\n\n`
    + (recentTail ? `<最近剧情>\n${recentTail}\n</最近剧情>\n\n` : '')
    + `<玩家刚才的言行>\n${userText}\n</玩家刚才的言行>\n\n`
    + `现在，以「${r.name}」的身份写 TA 此刻的第一人称心流（只输出心流本身）。`;
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

/** 校验单角色产出：太短/污染 → null（丢该角色不拖累整批） */
export function sanitizeMindflowReply(name: string, content: string): MindflowResult | null {
  const t = (content || '').replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim();
  if (!t || t.length < 10) return null;
  if (CONTAMINATED.test(t)) { console.warn(`[心流] ${name} 输出混入结构模块，丢弃`); return null; }
  return { name, text: t.slice(0, 1200) };
}

/** 把各角色心流拼成注入正文的导演注块（导出供单测）。 */
export function buildMindflowBlock(list: MindflowResult[]): string {
  if (!list.length) return '';
  return [
    '<角色心流·导演注>',
    '【系统导演注·本块不是正文】以下是发送前按各角色人格档案独立推演出的**此刻真实内心状态**（第一人称心流）。执行规则：',
    '1. 用它驱动各角色本回合的言行开场与反应基调——心流是"为什么这么做"，不是台词稿；',
    '2. 严禁把心流文字直接引用/复述/改写成旁白、对白或心声独白（信息差与悬念会全毁）；',
    '3. 角色隔离：每段心流只属于该角色本人，其他角色（包括主角）不知道、也绝不能表现得像知道；',
    '4. 若心流与既定人设/档案冲突，以档案为准：保留其行动意图，改换更贴人设的表达；',
    '5. 若剧情走向与心流相左（局面被玩家行动改变），允许角色临场改变反应——心流是此刻倾向，不是剧本；',
    '6. 仅本回合有效；正文的一切结构模块照常严格输出，不因本块而改变。',
    ...list.map((x) => `\n【${x.name}·内心】\n${x.text}`),
    '</角色心流·导演注>',
  ].join('\n');
}

/** 跑一批逐角色心流推演，返回拼好的导演注块（''=没有可注入的）。任何失败都不抛。 */
export async function runMindflowBatch(opts: {
  npcs: NpcRecord[];
  userText: string;
  recentTail: string;      // 最近正文尾段（调用方裁剪好）
  chain: ApiConfig[];
  max: number;             // 最多几位（每位=一次独立调用）
  timeoutMs?: number;      // 单调用空闲超时（默认 25s）
}): Promise<string> {
  try {
    if (!opts.chain?.[0]?.baseUrl || !opts.chain?.[0]?.apiKey) return '';
    const targets = pickMindflowTargets(opts.npcs, opts.userText, opts.max);
    if (!targets.length) return '';
    const results = await Promise.all(targets.map(async (r): Promise<MindflowResult | null> => {
      try {
        const { content } = await apiChatFallback(opts.chain, buildMindflowMessages(r, opts.userText, opts.recentTail), {
          timeoutMs: opts.timeoutMs ?? 25000,
          extra: { max_tokens: 1024 },     // 心流 3~6 句，收紧防话痨/思考模型拖时
          label: `心流·${r.name}`,
          rawLang: true,                    // 独白语言跟档案走，不注多语言指令
        });
        return sanitizeMindflowReply(r.name, content);
      } catch (e) {
        console.warn(`[心流] ${r.name} 推演失败（跳过该角色）`, e);
        return null;
      }
    }));
    const ok = results.filter((x): x is MindflowResult => !!x);
    if (ok.length) console.log(`[心流] ${ok.length}/${targets.length} 位角色推演完成：${ok.map((x) => x.name).join('、')}`);
    return buildMindflowBlock(ok);
  } catch (e) {
    console.warn('[心流] 整批推演异常（本回合不注入）', e);
    return '';
  }
}
