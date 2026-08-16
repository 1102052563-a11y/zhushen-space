/* ✨ NPC 档案精编（借鉴 SoulLink「档案精编」思想·代码与提示词自写）────────────────
   对单个 NPC 的「经历时间线(deedLog) + 关系网(relations)」做一次**只整理不创作**的 AI 精编：
   合并重复、规范时间锚点、称呼统一全名、关系网剥离事件细节——治长期游玩攒出的冗余档案。

   纪律（钉死）：
   · **绝不落库半步**：本模块只产出整理结果，落库必须走 applyNpcRefine，且只应在玩家在预览里点了确认之后调用；
   · **绝不碰**：数值/六维/技能/天赋/私密档案(extra·调教六格)/三层记忆(memoryTiers 有自己的衰退机制)/态度四轴；
   · 防清空红线：原有经历非空而整理结果为空 → 判失败抛错（宁可不精编，不许清档）；
     关系网整理为空而原有非空 → 保留原关系网（保守）；
   · 与三层记忆正交：衰退管 CharMemory，精编管 deedLog/relations，互不越界。 */
import type { NpcRecord } from '../store/npcStore';
import type { Deed } from '../store/characterStore';
import { useNpc } from '../store/npcStore';
import { resolveApiChain } from '../store/settingsStore';
import { apiChatFallback } from './apiChat';
import { getNpcApi } from './npcEvolutionHelpers';
import { lenientJsonParse } from './stateParser';
import { extractFirstJsonBlock } from './rosterGate';

export interface RefineOutcome {
  deeds: Deed[];        // 整理后的完整经历（全量替换）
  relations: string;    // 整理后的关系网（全量替换；'' 且原有非空时 apply 会保留原文）
  beforeDeeds: number;
  afterDeeds: number;
}

/* 精编规则（护栏性质·不进 promptRegistry——改坏红线会让玩家档案被清写） */
const NPC_REFINE_RULE = `【NPC 档案·精编】你是档案整理员。对下面这名角色的「经历记录」与「关系网」做一次**只整理、不创作**的精编：合并重复、规范格式、统一称呼，把长期游玩攒出来的冗余档案整理紧凑、可检索。
【红线（最高优先）】
- 只允许**重组已有信息**：不得新增档案里不存在的事实/细节/对话/情绪；不得曲解原意、不得改变时间先后。
- 不得删掉**关键信息**：时间、人名、地点、关系变化、承诺、秘密、伤势、能力获得、目标、已形成的习惯。
- **写谁都用全名**：简称/头衔映射到全名；不知全名用稳定身份称呼（如「灰袍老者」）且前后一致；禁止「他/她/那个人」这类裸代词。
【经历整理】
- 每条一件完整事，尽量一句写完（复杂事件不超过两句）；有时间锚点就保留并放 time 字段；地点放 location。
- 同一事件被拆成多条的合并为一条（保留关键事实与情绪转折）；日常重复互动合并成一条习惯性条目；过程性流水账压缩。
- 条目按时间先后排列；time/location 没有信息就给空串。
【关系网整理】
- 只写「与谁：关系性质＋现状＋关键转折」，沿用原有「名字:关系」的分段格式；总长尽量精简。
- 具体事件过程（谁做了什么、说了什么）不属于关系网：经历里已有对应记录就从关系网删去，没有则先并进经历再删。
【输出】只输出一个 JSON 对象（不要 markdown 围栏、不要解释）：
{"deeds":[{"time":"","location":"","description":""}],"relations":""}
- deeds=整理后的**完整**经历列表（不是增量）；relations=整理后的完整关系网字符串（没有内容给 ""）。`;

/** 喂给精编的档案快照：只给被整理的字段 + 身份抬头（绝不给数值/私密） */
export function serializeForRefine(npc: NpcRecord): string {
  const head = `[${npc.id}] ${npc.name}｜${npc.gender || '?'}｜${npc.npcTag || ''}${npc.profession ? `｜${npc.profession}` : ''}`;
  const deeds = (npc.deedLog ?? []).map((d, i) => `${i + 1}. ${(d.time || d.location) ? `[${d.time || '?'}@${d.location || '?'}] ` : ''}${d.description}`).join('\n');
  return `${head}\n\n【经历记录·现状（${npc.deedLog?.length ?? 0} 条）】\n${deeds || '（空）'}\n\n【关系网·现状】\n${npc.relations || '（空）'}`;
}

/** 解析 + 护栏校验（导出供单测）。失败抛错（调用方 toast）；绝不返回会清档的结果。 */
export function parseRefineReply(reply: string, npc: NpcRecord): RefineOutcome {
  const block = extractFirstJsonBlock(reply);
  const j = block ? lenientJsonParse(block) : undefined;
  if (!j || typeof j !== 'object') throw new Error('AI 回复解析不出 JSON');
  const rawDeeds: unknown[] = Array.isArray((j as any).deeds) ? (j as any).deeds : [];
  const deeds: Deed[] = rawDeeds
    .map((d: any): Deed | null => {
      const desc = String(d?.description ?? d?.desc ?? '').trim();
      if (!desc) return null;
      return { time: String(d?.time ?? '').trim().slice(0, 40), location: String(d?.location ?? '').trim().slice(0, 40), description: desc.slice(0, 400), addedAt: Date.now() };
    })
    .filter((d): d is Deed => !!d)
    .slice(0, 60);
  const before = npc.deedLog?.length ?? 0;
  if (before > 0 && deeds.length === 0) throw new Error('整理结果经历为空——为防清档已拒绝套用');
  if (before > 0 && deeds.length > before * 2 + 4) throw new Error(`整理结果条数异常膨胀（${before}→${deeds.length}）——精编只该压缩不该扩写，已拒绝`);
  const relations = String((j as any).relations ?? '').trim().slice(0, 2000);
  return { deeds, relations, beforeDeeds: before, afterDeeds: deeds.length };
}

/** 跑一次精编（不落库）。走 NPC 演化接口链。 */
export async function generateNpcRefine(npc: NpcRecord): Promise<RefineOutcome> {
  const chain = resolveApiChain('npc', getNpcApi());
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('未配置 AI 接口（设置→变量管理→NPC 演化→API，或综合设置→API 接口库选 NPC 路由）');
  if ((npc.deedLog?.length ?? 0) === 0 && !(npc.relations || '').trim()) throw new Error('该角色暂无可整理的经历/关系网');
  const { content } = await apiChatFallback(chain, [
    { role: 'system', content: NPC_REFINE_RULE },
    { role: 'user', content: `${serializeForRefine(npc)}\n\n按红线与整理规则输出精编后的完整 JSON。` },
  ], { timeoutMs: 90000, label: `档案精编·${npc.name}`, rawLang: true });
  return parseRefineReply(content, npc);
}

/** 玩家在预览里确认后才调用：全量替换 deedLog（同步旧字符串字段）+ relations（结果为空且原有非空→保留原文）。 */
export function applyNpcRefine(id: string, o: RefineOutcome): void {
  const npc = useNpc.getState().npcs[id];
  if (!npc) return;
  // 与 appendDeed 的旧字段口径一致：deeds 字符串留最近 6 条供旧 UI/导出
  const legacy = o.deeds
    .map((d) => (d.time || d.location ? `[${d.time}@${d.location}] ` : '') + d.description)
    .slice(-6).join('\n');
  const relations = o.relations.trim() ? o.relations : npc.relations;   // 防清空：空结果保留原关系网
  useNpc.getState().upsertNpc(id, { deedLog: o.deeds, deeds: legacy, relations }, { manual: true });
}
