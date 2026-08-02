/* Agent 正文模式 · 系统提示词动态拼装 + drift 纠偏提醒模板
   结构照抄 TauriTavern（头部工具清单 → 逐工具指引 → 成稿契约 → 收尾铁则/流程模板），
   按「实际启用的工具」条件性拼行；text 协议追加 <tool_call> 标签用法附录。
   成稿契约/收尾铁则两段走 getPrompt 覆盖（玩家可在预设中心编辑）。 */
import { AGENT_NARRATIVE_CONTRACT_RULE, AGENT_FLOW_RULE } from '../../promptRules';
import { getPrompt } from '../../store/promptOverrideStore';
import { DIRECT_OUTPUT_PATH, MAIN_ARTIFACT_PATH } from './agentWorkspace';
import type { AgentToolSpec } from './agentTypes';
import type { AgentProtocol } from './agentProtocol';

/** 逐工具指引（有该工具才出现；key=modelName） */
const TOOL_GUIDE: Record<string, string> = {
  chat_search: '- 需要更多往期剧情时，用 chat_search 按关键词搜历史楼层（窗口外的更早剧情也能搜到）。',
  chat_read_messages: '- 用 chat_read_messages 按 chat_search 返回的楼层号读原文；长楼层用 start_char/max_chars 分段读。',
  worldinfo_read_activated: '- 本回合已激活的世界书条目可用 worldinfo_read_activated 查看（先不带参数列索引，再按 ref 读正文）。',
  lore_search: '- 拿不准设定/桥段/人物往事时，用 lore_search 语义检索原著与世界书资料库。',
  player_get: '- 写主角相关数值/技能/物品前，用 player_get 读主角当前完整档案，保证与档案一致。',
  npc_list: '- 用 npc_list 查看 NPC 名册（在场优先）。',
  npc_get: '- 涉及某个 NPC 的设定/数值/关系时，用 npc_get 读其完整档案。',
  quest_get: '- 涉及任务推进/结算时，用 quest_get 复查当前任务态势与路线图。',
  faction_get: '- 写势力戏前用 faction_get 查各势力对主角的态度与近况，保持立场一致。',
  db_query: '- 需要精确盘点（背包/纪要/伏笔账等）时，用 db_query 对中文状态表跑只读 SELECT（先不带参数列出表名）。',
  dice_roll: '- 仅在剧情确需随机检定时用 dice_roll 掷骰，绝不虚构骰点。',
  workspace_list_files: '- 用 workspace_list_files 查看工作区文件。',
  workspace_search_files: '- 用 workspace_search_files 在工作区文件里定位文本。',
  workspace_read_file: '- 修改已有文件前必须先 workspace_read_file 读它；返回内容带行号，写回时**绝不要**带行号前缀。若 patch 失败，先整读文件再重试。',
  workspace_apply_patch: '- 用 workspace_apply_patch 做精确修改：old_string 必须与当前内容完全一致且唯一（否则补上下文或 replace_all=true）。',
  workspace_write_file: '- 用 workspace_write_file 创建文件、追加（append）或整篇重写（replace）。',
  workspace_commit: `- 用 workspace_commit 把工作区文件发布为本回合正文楼层：不带参数=用 ${MAIN_ARTIFACT_PATH} 整体替换本次运行的楼层；mode=append 在同一楼层后追加。`,
  workspace_finish: '- 全部提交完成后调用 workspace_finish 结束本次运行。',
};

/** text 协议附录：教模型用 <tool_call> 标签（无 function calling 端点的降级） */
export const AGENT_TEXT_PROTOCOL_APPENDIX = `【工具调用格式（本会话专用）】本端点不支持函数调用，你必须用如下标签调用工具（JSON 用双引号，一次可连续多个标签，按顺序执行）：
<tool_call>{"name": "workspace_write_file", "arguments": {"path": "output/main.md", "content": "…完整正文…"}}</tool_call>
<tool_call>{"name": "workspace_commit", "arguments": {}}</tool_call>
标签外的少量文字视为你的工作旁白（不会展示给玩家）。除标签外**不要**输出正文内容；工具结果会以 <tool_result> 块回给你。`;

/** 组装 Agent 系统提示词（追加在 legacy 快照的最深处、用户输入之前） */
export function buildAgentSystemPrompt(tools: AgentToolSpec[], protocol: AgentProtocol): string {
  const names = tools.map((t) => t.modelName);
  const lines: string[] = [];
  lines.push('---');
  lines.push('tools:');
  for (const n of names) lines.push(`- ${n}`);
  lines.push('---');
  lines.push('');
  lines.push('# Agent 模式已激活');
  lines.push('- 本回合你通过工具循环完成正文创作：工具结果是你的**工作上下文**，不是聊天内容。');
  for (const n of names) { const g = TOOL_GUIDE[n]; if (g) lines.push(g); }
  lines.push('- 工作区可写根目录：output/、scratch/（草稿/笔记）、plan/（构思）、persist/（跨回合记忆）。遇到「No visible workspace files found.」属正常（尚无文件），继续即可。');
  lines.push('- persist/ 是**跨回合持久**的记忆目录：把值得带到后续回合的**精炼**信息存这里——未了的伏笔/约定、关系近况、玩家偏好、长线剧情备忘（建议集中在 persist/notes.md，先读再改）。运行干净收尾（finish）后 persist/ 的改动才会保存。');
  lines.push('- **不要**把完整聊天史、成稿全文、工具结果原文或临时推理塞进 persist/；只存几行精炼条目。');
  lines.push('');
  lines.push(getPrompt('AGENT_NARRATIVE_CONTRACT_RULE', AGENT_NARRATIVE_CONTRACT_RULE));
  lines.push('');
  lines.push(getPrompt('AGENT_FLOW_RULE', AGENT_FLOW_RULE));
  if (protocol === 'text') { lines.push(''); lines.push(AGENT_TEXT_PROTOCOL_APPENDIX); }
  return lines.join('\n');
}

/** drift 纠偏提醒（合成 user 消息；照抄 TauriTavern 的两种形态 + direct_output 回收提示）
    回收路径必须是「两步收尾」而不是「读→小修→反复提交」——实测弱模型会把打捞变成 7 轮仪式（读自己 3099 字→patch 改 20 字×2→commit×2），全是白烧的轮次。 */
export function buildDriftNudge(attempt: number, committedCount: number, savedDirectOutput: boolean, protocol: AgentProtocol): string {
  const hint = savedDirectOutput
    ? `你刚输出的**全文已被原样保存**到 ${DIRECT_OUTPUT_PATH}——不需要 read 去确认，也不要为小改动去 patch。若它就是完整正文，下一轮**只做两步**：workspace_commit（path="${DIRECT_OUTPUT_PATH}"）→ workspace_finish。只有需要**实质性修改**（缺结构模块/情节要改）时才读改它。`
    : '';
  const how = protocol === 'text' ? '（用 <tool_call>{"name":…,"arguments":{…}}</tool_call> 标签调用工具）' : '';
  if (committedCount > 0) {
    return `【系统提醒·纠偏第${attempt}次】你输出了纯文本，但本次运行尚未收尾。你已成功提交 ${committedCount} 次楼层：若需修订成稿，请修改工作区文件后再次 workspace_commit；否则请直接调用 workspace_finish 干净收尾。${hint}不要把内容再以纯文本重复一遍。${how}`;
  }
  return `【系统提醒·纠偏第${attempt}次】你输出了纯文本，但本次运行必须通过 Agent 工具完成直至 workspace_finish。请把完整正文用 workspace_write_file 写入 ${MAIN_ARTIFACT_PATH}，然后 workspace_commit 发布、workspace_finish 收尾。${hint}不要再直接输出纯文本。${how}`;
}

/** 工具预算耗尽的软提醒（回喂给模型的 error content） */
export function budgetExhaustedMsg(maxCalls: number): string {
  return `工具调用总预算（${maxCalls} 次）已用尽。请立即用现有材料完成正文：workspace_write_file 写入 ${MAIN_ARTIFACT_PATH} → workspace_commit → workspace_finish。`;
}

/** 单工具调用上限的软提醒（P1·maxCallsPerTool） */
export function perToolCapMsg(tool: string, cap: number): string {
  return `对 ${tool} 的调用已达单工具上限（${cap} 次）。请改用其他工具或直接用现有材料完成正文并收尾。`;
}

/** 运行中「用户指引」注入消息（P1·照抄 TauriTavern <user_guidance> 语义：单条 user、按序应用、不越权） */
export function buildGuidanceMessage(items: string[]): string {
  const body = items.length === 1 ? items[0] : items.map((g, i) => `<guidance index="${i + 1}">\n${g}\n</guidance>`).join('\n');
  return `<user_guidance>\n玩家在你工作期间发来以下指引。请把它当作玩家对你下一步行动的最新指示，在既有指令与工具规则内**按顺序**应用；它不改变成稿契约与收尾铁则。\n\n${body}\n</user_guidance>`;
}
