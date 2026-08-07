// 👗✨ 按装备生成穿搭描述：读该角色**已装备**物品的外观（生图依据）等字段 → LLM 整理成
// 完整中文穿搭描述 + 英文服装标签，回填衣柜表单（用户可改再存）。
// 路由复用「生图标签 LLM」image_story_llm（与 中文外观→英文标签翻译 同一条线），留空回退正文 API。
import { useItems } from '../store/itemStore';
import { useNpc } from '../store/npcStore';
import { usePlayer } from '../store/playerStore';
import { resolveApiChain, useSettings } from '../store/settingsStore';
import { apiChatFallback } from './apiChat';
import { lenientJsonParse } from './stateParser';
import { OUTFIT_GEN_RULE } from '../promptRules';

/** 收集角色信息 + 已装备物品清单（纯 store 读取，可单测）。没有已装备物品时抛错。 */
export function collectEquippedForOutfit(charId: string): string {
  let who = '';
  let items: { name: string; category?: string; subType?: string; gradeDesc?: string; appearance?: string; equipSlot?: string }[] = [];
  if (charId === 'B1') {
    const p = usePlayer.getState().profile;
    who = `${p?.name || '主角'}（${(p?.gender || '性别未知').trim()}）`;
    items = useItems.getState().items.filter((it) => it.equipped);
  } else {
    const npc = useNpc.getState().npcs[charId];
    if (!npc) throw new Error('角色不存在');
    const seg = (npc.appearance5 || '').split('|');
    who = `${npc.name}（${(npc.gender || '性别未知').trim()}${(seg[3] || '').trim() ? `·身段：${seg[3].trim()}` : ''}）`;
    items = (npc.items ?? []).filter((it) => it.equipped);
  }
  if (!items.length) throw new Error('该角色没有已装备的物品——先在装备栏穿上，再来按装备生成');
  const lines = items.map((it) => {
    const head = [it.equipSlot, it.category, it.subType].map((x) => (x || '').trim()).filter(Boolean).join('/');
    const grade = (it.gradeDesc || '').trim();
    const ap = (it.appearance || '').trim();
    return `- ${head ? `[${head}] ` : ''}${it.name}${grade ? `（${grade}）` : ''}：${ap || '（未写外观，按名称与类别保守呈现）'}`;
  });
  return `【角色信息】${who}\n【已装备物品清单】\n${lines.join('\n')}`;
}

/** 调 LLM 生成 {desc, tags}；配置缺失/解析失败抛人话错误。 */
export async function generateOutfitFromEquipment(charId: string): Promise<{ desc: string; tags: string }> {
  const input = collectEquippedForOutfit(charId);
  const ss = useSettings.getState();
  const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
  const chain = resolveApiChain('image_story_llm', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('没配置「生图标签 LLM」——设置→生图设置→正文生图，给它选个接口（留空则回退正文 API，但正文 API 也未配置）');
  const { content } = await apiChatFallback(
    chain,
    [{ role: 'system', content: OUTFIT_GEN_RULE }, { role: 'user', content: input }],
    { label: '按装备生成穿搭', rawLang: true, timeoutMs: 120000 },
  );
  let s = (content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('模型没有输出 JSON：' + s.replace(/\s+/g, ' ').slice(0, 100));
  const obj: any = lenientJsonParse(s.slice(a, b + 1));
  const desc = String(obj?.desc ?? '').trim();
  const tags = String(obj?.tags ?? '').trim();
  if (!desc) throw new Error('模型没给出穿搭描述（desc 为空）');
  return { desc: desc.slice(0, 600), tags: tags.slice(0, 400) };
}
