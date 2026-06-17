import { resolveApiChain, useSettings } from '../store/settingsStore';
import { apiChatFallback } from './apiChat';
import { lenientJsonParse } from './stateParser';
import { usePlayer } from '../store/playerStore';
import { useNpc, type NpcRecord } from '../store/npcStore';
import { useTeam, TEAM_RANKS, buildTeamSystemPrompt, type TeamRank, type TeamMember, type JoinTeamPayload } from '../store/adventureTeamStore';

/* ════════════════════════════════════════════
   加入他人冒险团·全量生成（systems/adventureTeamGen.ts）
   - 触发：私聊中 NPC 同意接纳主角 → 弹窗确认 → 调用本模块
   - 用「冒险团演化」的 API（resolveApiChain('team', 正文API兜底)），一次性产出整支冒险团信息
   - 主角【不是】领导人；按冒险团固定格式给"所有信息"（团名/阶位/团长/全部成员/团队效果/大事记）
   - 解析 <冒险团>{JSON}</冒险团> → useTeam.joinTeam(...)（全量写入，B1 作为普通成员）
════════════════════════════════════════════ */

const VALID_RANK = (r: any): TeamRank | undefined => {
  const s = String(r ?? '').toUpperCase().trim();
  return (TEAM_RANKS as readonly string[]).includes(s) ? (s as TeamRank) : undefined;
};

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

/** 在场/已建档 NPC 列表（供 AI 复用真实 C-id 当团队成员）。*/
function knownNpcList(excludeId?: string): string {
  const rows = Object.values(useNpc.getState().npcs)
    .filter((r) => !r.isDead && r.id !== excludeId && r.name && r.name !== r.id)
    .slice(0, 40)
    .map((r) => `[${r.id}] ${r.name}（${r.realm || '阶位未知'}${r.affiliatedTeam ? '，隶属：' + r.affiliatedTeam : ''}）`);
  return rows.length ? rows.join('\n') : '（暂无其他已建档 NPC）';
}

const FORMAT_RULE = `你是【冒险团生成器】。主角（玩家）刚刚得到一位契约者的引荐，**即将加入对方所属的冒险团**。请据该 NPC 的所属冒险团，**一次性生成这支冒险团的全部信息**。铁则：
1. **主角不是领导人**：团长/领队必须是该 NPC 本人或其团队里既有的某位角色，**绝不能**把主角写成团长。主角只是刚加入的普通成员。
2. **信息必须齐全**（参考冒险团固定格式）：团名、阶位(E/D/C/B/A/S/SS/SSS 其一，按团队实力合理给，新人能加入的团多在 E~B)、团长、**全部成员名单**（含团长、引荐你的这位 NPC、其余 2~6 名成员、以及主角自己 B1）、团队效果/权限若干、团队大事记若干。
3. **复用真实 C-id**：引荐的 NPC 用其真实 C-id；其余成员若在"已建档 NPC"列表中就用其 C-id，否则只给姓名(name)+阶位(tier)。主角固定用 id "B1"。
4. 风格贴合轮回乐园·无限流设定与该 NPC 所在世界，**不要**修仙味词汇（除非其设定本就是修仙者）。
5. **只输出一个 <冒险团></冒险团> 块，内含一段 JSON**，不要任何解释/正文/Markdown。

输出格式：
<冒险团>
{
  "name": "团名",
  "rank": "C",
  "leader": { "id": "C3", "name": "引荐NPC或既有领队", "role": "团长" },
  "members": [
    { "id": "C3", "name": "…", "role": "团长" },
    { "name": "某成员", "tier": "四阶", "role": "副团长" },
    { "id": "B1", "role": "新晋成员" }
  ],
  "perks": [ { "name": "协同作战", "desc": "全员同场伤害+8%", "source": "C阶团队" } ],
  "deeds": [ { "time": "", "location": "", "description": "冒险团早年某场战役…" } ],
  "teamExp": 40,
  "activity": 70
}
</冒险团>`;

function buildJoinGenSystem(npc: NpcRecord): string {
  const T = useTeam.getState();
  // 带上团队演化预设里"已启用"的世界观/格式条目作为风味参考（去掉 ${占位}）
  const presetFlavor = buildTeamSystemPrompt(T.settings.entries ?? []).replace(/\$\{[^}]*\}/g, '').trim();
  const npcInfo = [
    `引荐NPC：[${npc.id}] ${npc.name || npc.id}`,
    npc.gender && `性别：${npc.gender}`,
    npc.realm && `阶位/身份：${npc.realm}`,
    npc.affiliatedTeam && `其所属冒险团：${npc.affiliatedTeam}`,
    npc.personality && `性格：${npc.personality}`,
    npc.background && `背景：${npc.background}`,
  ].filter(Boolean).join('\n');
  return [
    FORMAT_RULE,
    presetFlavor && `【冒险团世界观·风味参考（仅供风格统一，不要照搬其建团/晋阶流程指令）】\n${presetFlavor}`,
    `【引荐主角入团的 NPC】\n${npcInfo}`,
    `【主角(玩家)·B1】${playerBrief()}（主角即将作为普通新成员加入，不是团长）`,
    `【已建档 NPC（可复用其 C-id 当成员）】\n${knownNpcList(npc.id)}`,
  ].filter(Boolean).join('\n\n');
}

/** 把 AI 生成的 JSON 规整成 JoinTeamPayload（带 NPC 兜底，确保团长是 NPC、含 B1）。*/
function toPayload(data: any, npc: NpcRecord): JoinTeamPayload {
  const rawMembers: any[] = Array.isArray(data?.members) ? data.members : [];
  const members: TeamMember[] = rawMembers.map((m) => ({
    id: typeof m?.id === 'string' && /^[BC]\d+$/.test(m.id.trim()) ? m.id.trim() : undefined,
    name: m?.name ? String(m.name).trim() : undefined,
    tier: m?.tier ? String(m.tier).trim() : undefined,
    role: m?.role ? String(m.role).trim() : undefined,
    note: m?.note ? String(m.note).trim() : undefined,
  })).filter((m) => m.id || m.name);

  const leader = data?.leader ?? {};
  let leaderId = typeof leader?.id === 'string' && /^C\d+$/.test(leader.id.trim()) ? leader.id.trim() : '';
  let leaderName = leader?.name ? String(leader.name).trim() : '';
  // 兜底：没给合法团长时，让引荐的 NPC 当团长
  if (!leaderId && !leaderName) { leaderId = npc.id; leaderName = npc.name || npc.id; }
  // 确保引荐 NPC 在成员里
  if (!members.some((m) => m.id === npc.id || (m.name && m.name === npc.name))) {
    members.unshift({ id: npc.id, name: npc.name || npc.id, role: leaderId === npc.id ? '团长' : '成员' });
  }

  return {
    name: data?.name ? String(data.name).trim() : (npc.affiliatedTeam || '').split(/[·・|｜（(]/)[0].trim(),
    rank: VALID_RANK(data?.rank),
    leaderId, leaderName,
    members,
    perks: Array.isArray(data?.perks) ? data.perks.filter((p: any) => p?.name).map((p: any) => ({ name: String(p.name).trim(), desc: String(p.desc ?? p.effect ?? '').trim(), source: p?.source ? String(p.source).trim() : undefined })) : [],
    deeds: Array.isArray(data?.deeds) ? data.deeds.filter((d: any) => d?.description ?? d?.desc).map((d: any) => ({ time: String(d.time ?? ''), location: String(d.location ?? ''), description: String(d.description ?? d.desc), addedAt: Date.now() })) : [],
    teamExp: Number.isFinite(Number(data?.teamExp)) ? Number(data.teamExp) : undefined,
    activity: Number.isFinite(Number(data?.activity)) ? Number(data.activity) : undefined,
  };
}

export interface JoinGenResult { ok: boolean; teamName?: string; error?: string }

/** 主流程：调团队 API 全量生成冒险团 → 写入 useTeam（主角作为非团长成员加入）。*/
export async function generateJoinedTeam(npc: NpcRecord): Promise<JoinGenResult> {
  const T = useTeam.getState();
  const ss = useSettings.getState();
  const legacy = T.teamUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : T.teamApi;
  const chain = resolveApiChain('team', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) {
    return { ok: false, error: '冒险团 API 未配置（设置→变量管理→🛡 冒险团演化→API；或复用正文接口）' };
  }

  const messages = [
    { role: 'system', content: buildJoinGenSystem(npc) },
    { role: 'user', content: `主角已获 ${npc.name || npc.id} 同意，加入其所属冒险团${npc.affiliatedTeam ? `「${npc.affiliatedTeam.split(/[·・|｜（(]/)[0].trim()}」` : ''}。请按【输出格式】生成这支冒险团的全部信息（主角不是团长，作为新成员 B1 列入名单）。` },
  ];

  try {
    const { content } = await apiChatFallback(chain, messages, { timeoutMs: 120000 });
    const blockM = content.match(/<冒险团>([\s\S]*?)<\/冒险团>/);
    const jsonStr = blockM ? blockM[1].trim() : content.trim();
    const data = lenientJsonParse(jsonStr);
    if (!data || typeof data !== 'object') return { ok: false, error: '生成结果解析失败（未拿到有效 JSON）' };
    const payload = toPayload(data, npc);
    if (!payload.name) return { ok: false, error: '生成结果缺少团名' };
    useTeam.getState().joinTeam(payload);
    return { ok: true, teamName: payload.name };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? '请求失败' };
  }
}
