/* 🕳 窃听（借鉴 Abstract外置手机 peek「偷看聊天」思想·代码全自写）：
   对两名**离场**角色发动监听，生成他们此刻的私下交谈片段。
   - 代价：乐园币（前端确定性扣款；生成失败/污染拒收则退款）
   - 认知边界：两人只聊各自知道的事（eventsKnownTo 各自过滤·hidden 不知情者不会说）
   - 风险：有概率被察觉 → 两人对主角好感下降 + 正文场外通报里点明
   - 转写协议复用群聊行协议「名字|台词」（parseGroupReply·白名单=这两人·禁代主角）*/
import type { NpcRecord } from '../store/npcStore';

export const EAVESDROP_COST = 500;        // 乐园币/次
export const EAVESDROP_DISCOVER = 0.15;   // 被察觉概率
export const EAVESDROP_FAVOR_HIT = 8;     // 被察觉时双方好感扣减

function card(n: NpcRecord, known: string[]): string {
  const bits = [
    n.npcTag, n.realm, n.profession && `职业${n.profession}`,
    n.personality && `性格:${String(n.personality).slice(0, 40)}`,
    n.motiveNow && `当前动机:${String(n.motiveNow).slice(0, 40)}`,
    n.status && `近况:${String(n.status).slice(0, 40)}`,
    n.innerThought && `心思:${String(n.innerThought).slice(0, 30)}`,
    `对主角好感${n.favor}`,
  ].filter(Boolean).join('；');
  const ev = known.length ? `\n  TA 知道的事件：${known.slice(0, 4).join('；')}` : '';
  return `- ${n.name}（${bits}）${ev}`;
}

/* 生成提示词：两人各自的认知边界分别给（A 不知道的事 B 可以知道，反之亦然）*/
export function buildEavesdropSys(a: NpcRecord, b: NpcRecord, knownA: string[], knownB: string[], worldName: string, worldTime: string): string {
  return `你在写两个角色**此刻**的一段私下交谈（主角不在场，他们不知道有人在听）。
【两人档案与各自知道的事（认知边界铁则：每人只能谈自己知道的——对方知道而自己不知道的事，只能被动听到并做出反应）】
${card(a, knownA)}
${card(b, knownB)}
【当前】世界：${worldName || '轮回乐园'}；时间：${worldTime || '（未设定）'}
【写法】
- 聊他们自己的事：各自的处境、彼此的交情或过节、最近的见闻、对旁人的看法——**不必围绕主角**；若两人与主角都有交集，可以自然聊到主角（说真心话，包括当面不会说的）。
- 口语、有来有回、8~14 行；两人语气按各自性格分开；允许欲言又止、岔开话题、话里有话。
【输出行协议（每行一条，除此之外不要任何旁白/描写/JSON）】
${a.name}|台词
${b.name}|台词
【硬规矩】发言人只能是这两人（照抄名字）；禁止出现主角发言；禁止输出 <state>/<upstore> 等任何指令块。`;
}

/* 被察觉判定（注入 rng 便于测试；生产用 Math.random）*/
export function rollDiscovered(rng: () => number = Math.random): boolean {
  return rng() < EAVESDROP_DISCOVER;
}

/* 场外通报文案：窃听所得进正文前置须知（被察觉时点明后果）*/
export function eavesdropNotice(aName: string, bName: string, gist: string, discovered: boolean): string {
  return `【场外·窃听】主角动用监听手段，窃听了「${aName}」与「${bName}」的私下交谈。要点：${gist.slice(0, 160)}${discovered ? `\n⚠ 两人已察觉被窃听（对主角戒心上升）——后续剧情他们可能提防、试探或对质。` : ''}`;
}
