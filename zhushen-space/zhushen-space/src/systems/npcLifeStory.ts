import { resolveApiChain } from '../store/settingsStore';
import { apiChatFallback } from './apiChat';
import { getPrompt } from '../store/promptOverrideStore';
import { NPC_LIFE_STORY_RULE } from '../promptRules';
import { getNpcApi, serializeNpcSnapshot } from './npcEvolutionHelpers';
import type { NpcRecord } from '../store/npcStore';

/* 📖 成长小传 —— 手动补写/重写（详情页按钮）。
   自动生成走 NPC 演化阶段的门控（App.tsx runNpcEvolutionForTarget 里解析 <小传> 块）；
   这里是玩家不想等演化轮到 TA、或想重写时的即时单发通道。走 npc 路由，与演化同一接口。 */

/** 从回复里取出小传正文：优先 <小传> 块；AI 没按格式包块时退回整段裸文本（剥掉思维链与代码围栏）。 */
export function extractLifeStory(reply: string): string {
  const clean = String(reply ?? '').replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '');
  const m = clean.match(/<小传[^>]*>([\s\S]*?)<\/小传>/i);
  if (m) return m[1].trim();
  return clean.replace(/```[a-z]*/gi, '').replace(/<\/?[a-z][^>]*>/gi, '').trim();
}

export async function generateLifeStory(npc: NpcRecord, rewrite = false): Promise<string> {
  const chain = resolveApiChain('npc', getNpcApi());
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) {
    throw new Error('未配置 AI 接口（设置→变量管理→NPC 演化→API 设置，或综合设置→正文生成）');
  }
  const system = getPrompt('NPC_LIFE_STORY_RULE', NPC_LIFE_STORY_RULE);
  const user = `# 角色当前档案\n${serializeNpcSnapshot(npc)}\n\n---\n`
    + (rewrite
      ? `该角色**已有**一份成长小传，玩家要求**重写**——请无视系统提示里"已非空就不要重写"的那条，据上方档案重新写一份。\n\n【已有的旧小传（可参考其中仍成立的部分，但要写得更好）】\n${npc.lifeStory ?? ''}\n\n`
      : '')
    + `请**只**输出一个 <小传 id="${npc.id}">…</小传> 块，块内是成长小传正文。不要输出 <state>/<upstore> 指令、不要写正文剧情、不要有其它文字。`;
  const { content } = await apiChatFallback(chain, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], { timeoutMs: 180000, label: `小传:${npc.id}` });
  const story = extractLifeStory(content ?? '');
  if (!story) throw new Error('AI 没有返回可用的小传内容');
  return story;
}
