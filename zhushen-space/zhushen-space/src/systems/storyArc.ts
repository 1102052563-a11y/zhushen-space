/* 🧭 故事弧线（借鉴 story-oracle「故事弧线」思想·代码全自写——上游无 license，只借交互设计）
   多拍长线幕后引导：贯穿线+路标+难度+红线 → 一次规划调用分 3~5 拍（玩家可改）→ 每拍开始时**现编一次**
   该拍导演指令并缓存 → 每回合只把缓存注入正文（紧邻 <剧情指导> 槽·零额外串行调用，⚠正文前已 5~7 次调用）→
   完成判定**挂杂项演化阶段**（arcJudgeInjection 追加协议行 + applyArcJudgment 扫回包·零新增 API，世界历同款套路）→
   过拍自动现编下一拍；触红线自动退出；随时手动退出立刻复原（buildArcInjection 只认 active）。
   ⚠ 引导纪律：玩家行动永远优先，指令跑偏成正文（looksLikeNarrativeText 镜像 guidanceLooksLikeNarrative）即拒收。
   数据：store/arcStore.ts（drpg-arc·进 STORES+ROLLBACK_KEYS）；UI：components/StoryArcPanel.tsx（变量管理页底部）；
   提示词：ARC_PLAN_RULE / ARC_BEAT_RULE（promptRegistry 可改）；接口：featureKey 'storyArc'。 */
import { useArc, type ArcDraft, type ArcDifficulty } from '../store/arcStore';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { useMisc } from '../store/miscStore';
import { usePlayer } from '../store/playerStore';
import { apiChatFallback } from './apiChat';
import { getPrompt } from '../store/promptOverrideStore';
import { ARC_PLAN_RULE, ARC_BEAT_RULE } from '../promptRules';
import { buildAdvisorContext, buildAdvisorNarrativeTail } from './proposalCard';

/* ── 跑偏护栏：镜像 App.guidanceLooksLikeNarrative（组件内函数没法 import，这里复刻同口径）── */
export function looksLikeNarrativeText(t: string): boolean {
  const s = (t || '').trim();
  if (!s) return false;
  const markers = ['【正文】', '时间结算', '任务世界绝对时刻', '任务期限', '【主角资源', '状态栏', '<state', '<upstore', '状态结算'];
  const hit = markers.filter((m) => s.includes(m)).length;
  if (hit >= 2) return true;
  if (hit >= 1 && s.length > 1200) return true;
  if (s.length > 2200) return true;
  return false;
}

const arcChain = () => {
  const ss = useSettings.getState();
  const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
  const chain = resolveApiChain('storyArc', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('未配置 AI 接口（回退正文 API 也未配置）——先到 设置→综合设置 配正文接口，或在面板「接口路由」单独指定');
  return chain;
};

const DIFF_LINE: Record<ArcDifficulty, string> = {
  平和: '平和：低赌注慢热，多给喘息与温情空间',
  常规: '常规：标准起伏，压力与缓和交替',
  凛冽: '凛冽：高赌注高压，角色处境严峻——但永不写成无路可走的死局，退出通道始终存在',
};

/* ── 规划分拍（一次调用·产物玩家可编辑后再启动）── */
export interface ArcPlan { title: string; beats: { idx: number; goal: string }[] }

/** 解析「弧名:/拍N:」行协议（宽松：第N拍/全半角冒号都认；一拍都认不出=抛错让玩家重试）。 */
export function parsePlanReply(text: string, fallbackTitle: string): ArcPlan {
  const beats: { idx: number; goal: string }[] = [];
  let title = '';
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim().replace(/^[>*\-•]+\s*/, '');
    let m = /^弧名[:：]\s*(.+)$/.exec(line);
    if (m) { title = title || m[1].trim(); continue; }
    m = /^(?:拍\s*(\d+)|第\s*(\d+)\s*拍)\s*[:：]\s*(.+)$/.exec(line);
    if (m) beats.push({ idx: Number(m[1] ?? m[2]), goal: m[3].trim() });
  }
  if (!beats.length) throw new Error('模型没按「拍N: 目标」协议输出，请重试');
  beats.sort((a, b) => a.idx - b.idx);
  return { title: (title || fallbackTitle).slice(0, 40), beats: beats.slice(0, 6).map((b, i) => ({ idx: i + 1, goal: b.goal.slice(0, 300) })) };
}

/** 规划分拍（不写 store——产物回传面板，玩家可改每拍目标后再 startArc）。 */
export async function planArc(draft: ArcDraft): Promise<ArcPlan> {
  if (!draft.throughline.trim()) throw new Error('先写贯穿线（这条弧线到底讲什么）');
  const chain = arcChain();
  const tail = await buildAdvisorNarrativeTail();
  const ctx = [
    `【贯穿线】${draft.throughline.trim().slice(0, 500)}`,
    draft.landmarks.trim() ? `【路标（关键节点·要覆盖进拍子）】\n${draft.landmarks.trim().slice(0, 500)}` : '',
    `【难度】${DIFF_LINE[draft.difficulty]}`,
    draft.redlines.trim() ? `【红线（绝对禁区）】${draft.redlines.trim().slice(0, 300)}` : '',
    `【存档现状（供衔接·不必全用）】\n${buildAdvisorContext().slice(0, 2600)}`,
    tail ? `【最近正文（起点参考）】\n${tail}` : '',
  ].filter(Boolean).join('\n\n');
  const { content } = await apiChatFallback(chain, [
    { role: 'system', content: getPrompt('ARC_PLAN_RULE', ARC_PLAN_RULE) },
    { role: 'user', content: `${ctx}\n\n请拆拍并按行协议输出：` },
  ], { label: '弧线规划', timeoutMs: 180000, rawLang: true });
  return parsePlanReply(String(content ?? ''), draft.throughline.trim().slice(0, 12));
}

/* ── 每拍导演指令（现编一次·缓存·跑偏拒收）── */
export async function genBeatInstruction(idx: number): Promise<string> {
  const A = useArc.getState();
  const beat = A.beats.find((b) => b.idx === idx);
  if (!beat) throw new Error(`没有第 ${idx} 拍`);
  const chain = arcChain();
  const prev = A.beats.find((b) => b.idx === idx - 1);
  const tail = await buildAdvisorNarrativeTail();
  const M = useMisc.getState();
  const ctx = [
    `【贯穿线】${A.throughline.slice(0, 400)}`,
    `【全部拍子】\n${A.beats.map((b) => `拍${b.idx}${b.status === 'done' ? '（已完成）' : b.idx === idx ? '（当前·为它写指令）' : ''}：${b.goal}`).join('\n')}`,
    prev ? `【上一拍收尾】${prev.goal}${prev.status === 'done' ? '（已达成）' : ''}` : '【上一拍】（无·这是第一拍）',
    `【难度】${DIFF_LINE[A.difficulty]}`,
    A.redlines.trim() ? `【红线（绝对禁区）】${A.redlines.slice(0, 300)}` : '',
    `【当前时空】${[M.worldName, M.worldTime || M.paradiseTime, usePlayer.getState().profile.location].filter(Boolean).join('｜') || '（未设定）'}`,
    tail ? `【最近正文（衔接起点）】\n${tail}` : '',
  ].filter(Boolean).join('\n\n');
  const { content } = await apiChatFallback(chain, [
    { role: 'system', content: getPrompt('ARC_BEAT_RULE', ARC_BEAT_RULE) },
    { role: 'user', content: `${ctx}\n\n请为第 ${idx} 拍输出导演指令：` },
  ], { label: `弧线·第${idx}拍指令`, timeoutMs: 180000, rawLang: true });
  const text = String(content ?? '').trim();
  if (!text) throw new Error('模型没有返回指令');
  if (looksLikeNarrativeText(text)) throw new Error('产出跑偏成了正文（含正文结构标记或过长），已拒收——请重试');
  useArc.getState().setBeatInstruction(idx, text);
  return text;
}

/* ── 每回合注入（纯 store 读·App 历史组装处内联调用，紧邻 <剧情指导> 槽）── */
export function buildArcInjection(): { role: 'system'; content: string }[] {
  const A = useArc.getState();
  if (!A.active) return [];
  const cur = A.beats.find((b) => b.status === 'active');
  if (!cur) return [];
  const L: string[] = ['【故事弧线·幕后引导（对玩家保密——正文绝不点破"弧线/拍子/剧本"这类幕后词）】'];
  L.push(`贯穿线：${A.throughline.slice(0, 200)}`);
  L.push(`当前进度：第 ${cur.idx}/${A.beats.length} 拍｜本拍目标：${cur.goal.slice(0, 200)}`);
  if (cur.instruction) L.push(`本拍导演指令：\n${cur.instruction}`);
  else L.push('本拍导演指令：（现编中）本回合朝本拍目标自然铺垫即可——给场景机会与 NPC 动向，不强推。');
  if (A.redlines.trim()) L.push(`红线（任何情况不得触碰）：${A.redlines.slice(0, 300)}`);
  L.push('引导纪律：玩家行动永远优先——玩家明显走向别处时顺势让路、只留暗钩，绝不硬掰；引导用场景机会/NPC 动向/环境信号呈现，不写命运感说教。');
  return [{ role: 'system', content: L.join('\n') }];
}

/* ── 完成判定（挂杂项演化·零新增 API）── */

/** 追加进杂项阶段 system 的判定协议（弧线不活跃=空串零 token）。 */
export function arcJudgeInjection(): string {
  const A = useArc.getState();
  if (!A.active) return '';
  const cur = A.beats.find((b) => b.status === 'active');
  if (!cur) return '';
  return `\n\n【故事弧线·本拍完成判定（附加职责·在全部输出的最末尾另起独立行）】
当前第 ${cur.idx} 拍目标：${cur.goal.slice(0, 200)}
红线：${A.redlines.slice(0, 200) || '（无）'}
· 本轮正文已**实质达成**本拍目标（事件确已发生，不是将要/可能）→ 末尾输出一行：arcBeat.${cur.idx} = done｜一句依据
· 本轮正文**触碰了红线** → 末尾输出一行：arcRedline = 一句说明
· 两者都不满足（多数回合如此）→ 这两行都**不要**输出。判定要保守：拿不准=没完成。`;
}

/** 扫杂项回包应用判定：过拍（幂等：拍号必须=当前拍）/ 破红线退出。genNext=过拍后后台现编下一拍（测试传 false）。 */
export function applyArcJudgment(reply: string, opts?: { genNext?: boolean }): void {
  const A = useArc.getState();
  if (!A.active) return;
  const s = String(reply ?? '');
  const red = /arcRedline\s*[=＝]\s*([^\n]+)/.exec(s);
  if (red) { A.exitArc(`🛑 触碰红线，弧线自动退出：${red[1].trim().slice(0, 100)}`); return; }
  const m = /arcBeat\.(\d+)\s*[=＝]\s*done(?:[｜|]\s*([^\n]*))?/.exec(s);
  if (!m) return;
  const idx = Number(m[1]);
  const cur = A.beats.find((b) => b.status === 'active');
  if (!cur || cur.idx !== idx) return;   // 幂等：仅重算变量重放旧判定 / AI 报错拍号 → 忽略
  const reason = `✔ 第 ${idx} 拍完成${m[2]?.trim() ? `：${m[2].trim().slice(0, 80)}` : ''}`;
  const next = useArc.getState().advanceBeat(reason, useMisc.getState().turnCount || undefined);
  if (next > 0 && opts?.genNext !== false) {
    void genBeatInstruction(next).catch((e) => {
      useArc.getState().pushLog(`⚠ 第 ${next} 拍指令生成失败：${String((e as Error)?.message ?? e).slice(0, 60)}（先按拍目标兜底引导，可到弧线面板重编）`);
    });
  }
}
