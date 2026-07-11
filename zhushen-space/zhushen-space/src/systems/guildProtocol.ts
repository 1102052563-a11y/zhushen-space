// 公会系统·线协议（client ⇄ GuildDO 每公会一实例 / GuildListDO 注册表单例）—— 前端侧单一事实来源（范式同 shopProtocol）。
// 见 指导/家族系统-设计.md。**异步公会**：贡献/等级/仓库/周任务/公会战全累计式，不要求成员同时在线。
// 改协议时同步比对 multiplayer-worker/src/GuildDO.js / GuildListDO.js。

export type GuildRank = 'leader' | 'viceLeader' | 'elder' | 'member';

export interface GuildPerk { key: string; label: string; value: number; }   // 已解锁公会增益（如 {key:'expBoost',value:0.05}）

export interface GuildMember {
  pid: string; name: string; rank: GuildRank;
  contribTotal: number; contribWeek: number;
  joinedAt: number; lastActive: number;
  du?: number; avv?: number; ds?: string; nc?: string;   // 聊天身份（头像/名牌色/靓号）
}

export interface WeeklyGoal { key: string; label: string; target: number; cur: number; reward: string; }
export interface WeeklyTasks { weekId: string; goals: WeeklyGoal[]; claimed: string[]; rewardCoin?: number; }

export interface ChronicleEntry { at: number; text: string; kind?: string; }

/** 公会全量（GuildDO → 客户端）。 */
export interface GuildFull {
  id: string; name: string; tag: string; emblem?: string; manifesto?: string; recruiting?: boolean;
  ownerId: string; createdAt: number;
  level: number; exp: number;
  perks: GuildPerk[];
  members: GuildMember[];
  applicants: { pid: string; name: string; at: number }[];
  chest: any[];                 // 公会仓库（带完整物品快照）
  weekTasks?: WeeklyTasks;
  chronicle: ChronicleEntry[];
  chain?: { count: number; lastAt: number; best: number };   // 公会连击（Torn 式·击杀累计冲里程碑）
  hallOfFame?: { name: string; contribTotal: number; rank?: string; at: number; reason?: string }[];   // 公会丰碑（创立者 + 离场英灵·跨存档铭记）
  wars?: { wins: number; losses: number };   // 公会战·战绩
  base?: { buildings: { id: string; name: string; desc?: string; effect?: string; level: number; aiGen?: boolean }[] };   // 公会据点·自定义建筑（成员手写/AI 提示词生成·集资升级·非正文生成）
  baseSnapshot?: any;           // (旧·未用)
}

/** 公开公会卡（GuildListDO 注册表列表·搜索/申请用）。 */
export interface GuildCard {
  id: string; name: string; tag: string; emblem?: string; manifesto?: string;
  level: number; members: number; recruiting?: boolean; ownerName?: string; weeklyContrib?: number; power?: number; at: number; bumpedAt: number;
}

export interface GuildMe { playerId: string; name: string }

// ── GuildDO：服务端 → 客户端 ──（心跳 "pong" 裸字符串不属本联合）
export type GuildInbound =
  | { type: 'hello'; you?: GuildMe; guild: GuildFull | null; online: number }
  | { type: 'guild_synced'; guild: GuildFull }
  | { type: 'member_joined'; member: GuildMember }
  | { type: 'member_left'; pid: string }
  | { type: 'rank_changed'; pid: string; rank: GuildRank }
  | { type: 'contrib_bumped'; pid: string; contribTotal: number; contribWeek: number; exp: number }
  | { type: 'level_up'; level: number; perks: GuildPerk[] }
  | { type: 'task_progress'; weekTasks: WeeklyTasks }
  | { type: 'task_reward'; amount: number; currency: string }   // 领取周任务奖励 → 客户端本地入账
  | { type: 'chain_bumped'; chain: { count: number; lastAt: number; best: number } }
  | { type: 'chest_changed'; chest: any[] }
  | { type: 'chronicle_added'; entry: ChronicleEntry }
  | { type: 'applicant_added'; applicant: { pid: string; name: string; at: number } }
  | { type: 'kicked'; reason?: string }                 // 我被踢 / 公会解散
  | { type: 'rate_limited' }
  | { type: 'error'; reason?: string; error?: string };

// ── GuildDO：客户端 → 服务端 ──（心跳 "ping" 裸字符串不走 JSON）
export type GuildOutbound =
  | { type: 'create_guild'; name: string; tag: string; emblem?: string; manifesto?: string }
  | { type: 'apply'; guildId: string }
  | { type: 'approve'; pid: string }
  | { type: 'kick'; pid: string }
  | { type: 'set_rank'; pid: string; rank: GuildRank }
  | { type: 'contribute'; kind: string; amount: number; detail?: string }   // 贡献上报（击杀/通关/捐币…确定性）
  | { type: 'deposit'; item: any }
  | { type: 'withdraw'; index: number }
  | { type: 'edit'; patch: { name?: string; tag?: string; emblem?: string; manifesto?: string; recruiting?: boolean } }
  | { type: 'claim_task' }
  | { type: 'leave' }
  | { type: 'add_building'; building: { name?: string; desc?: string; effect?: string; aiGen?: boolean } }   // 公会据点：手写加建筑（会长/长老）
  | { type: 'add_buildings'; buildings: { name?: string; desc?: string; effect?: string }[] }                // 公会据点：AI 生成批量入据点
  | { type: 'edit_building'; id: string; patch: { name?: string; desc?: string; effect?: string } }
  | { type: 'remove_building'; id: string }
  | { type: 'upgrade_building'; id: string }   // 任何成员出资建设一级（乐园币客户端本地扣）
  | { type: 'war_result'; win: boolean; opponentName: string; myScore: number; theirScore: number }   // 公会战·确定性对决结果上报（server 记战绩+胜奖·每日限次）
  | { type: 'disband' };

// ── GuildListDO（注册表·单例·仿 LobbyDO/AssistDO）──
export type GuildListInbound =
  | { type: 'guilds'; guilds: GuildCard[] }
  | { type: 'created'; guildId: string; summary: any }   // summary = GuildSummary（客户端 setMy + 连 GuildDO）
  | { type: 'joined'; guildId: string; summary: any }
  | { type: 'error'; reason?: string };
export type GuildListOutbound =
  | { type: 'list' }
  | { type: 'search'; q: string };
