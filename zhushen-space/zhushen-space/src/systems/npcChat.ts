import { resolveApiChain, useSettings } from '../store/settingsStore';
import { apiChatFallback } from './apiChat';
import { usePlayer } from '../store/playerStore';
import { useNpcChat } from '../store/npcChatStore';
import { useChannel } from '../store/channelStore';
import type { NpcRecord } from '../store/npcStore';
import { NSFW_WRITING_RULE, NPC_CHAT_RULE, NPC_TEAM_JOIN_CHAT_RULE } from '../promptRules';

/* NPC 私聊：拼人设(含 NSFW 写作指导) → 调 API（一次产出 对白 + 交互描述）→ 解析 → 写缓存。
   API 已并入「公共频道」：与私信一致走 resolveApiChain('channel', 频道接口兜底)；交互描述会随历史一并注入回 API 保证上下文连续。 */

const HISTORY_TURNS = 20;   // 每次调用回带的最近回合数

/* NPC 私密字段（与 NpcDetail 的「私密信息」一致；命名键 + 数字列双取）*/
const PRIVATE_FIELDS: { keys: string[]; label: string }[] = [
  { keys: ['性经验', '8'], label: '性经验' },
  { keys: ['表性癖', '17'], label: '表性癖' },
  { keys: ['里性癖', '18'], label: '里性癖' },
  { keys: ['敏感部位', '20'], label: '敏感部位' },
  { keys: ['性器状态', '21'], label: '性器状态' },
  { keys: ['情欲值', '22'], label: '情欲值' },
  { keys: ['快感值', '23'], label: '快感值' },
  { keys: ['性观念', '24'], label: '性观念' },
  { keys: ['淫纹'], label: '淫纹' },
  { keys: ['解锁服装'], label: '解锁服装' },
  { keys: ['独特技巧'], label: '独特技巧' },
  { keys: ['性爱姿势'], label: '性爱姿势' },
  { keys: ['开发玩法'], label: '开发玩法' },
];

function field(label: string, v?: string | number | null): string {
  const s = v == null ? '' : String(v).trim();
  return s ? `${label}：${s}` : '';
}

function serializeNpcPersona(npc: NpcRecord): string {
  const ex = (npc as any).extra ?? {};
  const privacy = PRIVATE_FIELDS
    .map((f) => { const k = f.keys.find((kk) => ex[kk] != null && String(ex[kk]).trim()); return k ? `${f.label}：${ex[k]}` : ''; })
    .filter(Boolean);
  const lines = [
    field('姓名', npc.name),
    field('性别', npc.gender),
    field('阶位·身份', npc.realm),
    field('标签', npc.npcTag),
    field('隶属冒险团', npc.affiliatedTeam),
    field('年龄', npc.age),
    field('称号', npc.title),
    field('职业', npc.profession),
    field('性格', npc.personality),
    field('外观', npc.appearance5),
    field('外观细节', (npc as any).appearanceDetail),
    field('背景经历', npc.background),
    field('内心想法', npc.innerThought),
    field('当前状态', npc.status),
    field('当前动机', npc.motiveNow),
    field('对主角的称呼', npc.callPlayer),
    field('与他人关系(含主角B1)', npc.relations),
    field('对主角好感', typeof npc.favor === 'number' ? `${npc.favor}（范围 -100~100）` : undefined),
  ].filter(Boolean);
  if (privacy.length) lines.push('【私密信息】', ...privacy);
  return lines.join('\n');
}

function playerBrief(): string {
  const p: any = usePlayer.getState().profile ?? {};
  const bits = [
    p.name ? `姓名：${p.name}` : '',
    p.gender ? `性别：${p.gender}` : '',
    p.tier ? `阶位：${p.tier}` : '',
    p.identity ? `身份：${p.identity}` : '',
    p.title ? `称号：${p.title}` : '',
  ].filter(Boolean);
  return bits.length ? bits.join('，') : '一名轮回乐园的契约者';
}

/** 拼一次 NPC 私聊的 system 提示词（NSFW 写作指导 + NPC 人设 + 输出格式）。
    NPC 隶属冒险团时，追加"加入意愿处理"规则（允许在同意时输出 <加入冒险团> 信号）。*/
export function buildNpcChatSystem(npc: NpcRecord): string {
  const hasTeam = !!(npc.affiliatedTeam && npc.affiliatedTeam.trim() && !/^无$|独行/.test(npc.affiliatedTeam.trim()));
  return [
    NSFW_WRITING_RULE,
    NPC_CHAT_RULE,
    ...(hasTeam ? [NPC_TEAM_JOIN_CHAT_RULE] : []),
    `【你要扮演的 NPC 档案】\n${serializeNpcPersona(npc)}`,
    `【对面的主角(玩家)】${playerBrief()}。这是你与主角私下独处的对话，与正文主线分开；请只产出 <对白> 与 <交互> 两块${hasTeam ? '（同意接纳主角进团时可额外附 <加入冒险团> 信号块）' : ''}。`,
  ].join('\n\n');
}

/** 解析回复 → 对白(dialogue) + 交互描述(scene) + 加入冒险团信号(joinTeam，缺省空串)。
    容错：缺标签则把非 <交互>/<加入冒险团> 文本当对白。*/
export function parseNpcChatReply(raw: string): { dialogue: string; scene: string; joinTeam: string } {
  const joinM = raw.match(/<加入冒险团>([\s\S]*?)<\/加入冒险团>/);
  const joinTeam = joinM ? joinM[1].trim() : '';
  const sceneM = raw.match(/<交互>([\s\S]*?)<\/交互>/);
  const scene = sceneM ? sceneM[1].trim() : '';
  const dM = raw.match(/<对白>([\s\S]*?)<\/对白>/);
  let dialogue: string;
  if (dM) dialogue = dM[1].trim();
  else dialogue = raw
    .replace(/<交互>[\s\S]*?<\/交互>/g, '')
    .replace(/<加入冒险团>[\s\S]*?<\/加入冒险团>/g, '')
    .replace(/<\/?对白>/g, '').trim();
  return { dialogue, scene, joinTeam };
}

/** 把缓存回合还原成 chat messages（交互描述一并注入，保证上下文连续）。*/
function turnsToMessages(turns: { role: 'player' | 'npc'; text: string; scene?: string }[]): { role: string; content: string }[] {
  return turns.map((t) =>
    t.role === 'player'
      ? { role: 'user', content: t.text }
      : { role: 'assistant', content: `<对白>${t.text}</对白>` + (t.scene ? `\n<交互>${t.scene}</交互>` : '') },
  );
}

/** 发送一轮 NPC 私聊：写入玩家发言 → 调 API → 解析 → 写入 NPC 回合。出错则写一条系统提示回合。*/
export async function sendNpcChat(npc: NpcRecord, userText: string): Promise<void> {
  const chatStore = useNpcChat.getState();
  const prior = chatStore.chats[npc.id] ?? [];          // 本轮调用前的历史（system/history 用）
  chatStore.appendTurn(npc.id, { role: 'player', text: userText });

  const ss = useSettings.getState();
  const cs = useChannel.getState();
  // NPC 私聊 API 已并入「公共频道」：与私信一致——走 channel 路由，兜底用频道接口（频道选共用则回退正文接口）
  const channelApi = cs.channelUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : cs.channelApi;
  const chain = resolveApiChain('channel', channelApi);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) {
    useNpcChat.getState().appendTurn(npc.id, { role: 'npc', text: '（还没配置可用的 AI 接口…NPC 私聊已并入「公共频道」接口：请到 设置→公共频道 配置其 API，或在 API 接口库 给「频道」路由挂接口）', scene: '' });
    return;
  }

  const messages = [
    { role: 'system', content: buildNpcChatSystem(npc) },
    ...turnsToMessages(prior.slice(-HISTORY_TURNS)),
    { role: 'user', content: userText },
  ];

  try {
    const { content } = await apiChatFallback(chain, messages, { timeoutMs: 120000 });
    const { dialogue, scene, joinTeam } = parseNpcChatReply(content);
    useNpcChat.getState().appendTurn(npc.id, { role: 'npc', text: dialogue || '（她沉默着）', scene, joinOffer: joinTeam || undefined });
  } catch (e: any) {
    useNpcChat.getState().appendTurn(npc.id, { role: 'npc', text: `（接口异常：${e?.message ?? '请求失败'}）`, scene: '' });
  }
}
