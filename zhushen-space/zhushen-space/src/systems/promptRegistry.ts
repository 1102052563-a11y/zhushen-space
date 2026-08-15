/* 预设中心·「可编辑主提示词」注册表：驱动 PromptCenterPanel 的罗列 + 默认回退 + 读写分派。
   两类条目：
   - kind='field'：绑定现有 store 字段（剧情指导/选项/细纲/前置/记忆…已有的可编辑提示词）——读写走各自 store，零接入。
   - kind='override'：走 promptOverride store（各演化阶段主提示词），接入点用 getPrompt('KEY', 内置常量) 生效。
   ⚠ 只登记「主提示词」；底层护栏规则（去重/锁值/数值守卫…）不进这里，玩家改不到、拼接处也不包 getPrompt。 */
import { useSettings } from '../store/settingsStore';
import { useMemory, DEFAULT_MEMORY_PROMPT } from '../store/memoryStore';
import { usePromptOverride } from '../store/promptOverrideStore';
import {
  PLOT_GUIDANCE_RULE, PLOT_CHOICES_RULE, OUTLINE_GEN_RULE, CAST_BRIEF_RULE, CAST_BRIEF_FOLLOW_RULE,
  ITEM_COT_RULE, PLAYER_COT_RULE, NPC_COT_RULE, ENTRY_COT_RULE,
  FACTION_COT_RULE, TERRITORY_COT_RULE, TEAM_COT_RULE,
  EQUIP_CODEX, ITEM_EVOLUTION_CODEX, PARADISE_RULES_RULE,
  COMBAT_NARRATE_RULE, NPC_CHAT_RULE, NSFW_WRITING_RULE, NPC_TEAM_JOIN_CHAT_RULE, INTERVIEW_RULE, TRAINING_CHAT_RULE, DM_REPLY_PROTOCOL_RULE,
  MONUMENT_EULOGY_RULE, CHOICES_FANFIC_SYSTEM, FANFIC_RULE, MINI_THEATER_RULE,
  WORLD_SETTLEMENT_RULE, WORLD_SETTLEMENT_COT_RULE, ATTR_POWER_CODEX, NPC_INDEPENDENCE_RULE, DISPOSITION_STAGE_RULE,
  NPC_SELF_NARRATION_RULE, NPC_LIFE_STORY_RULE,
  SKILL_LEVELUP_PROMPT, SKILL_FUSION_RULE, SKILL_FUSION_NPC_RULE, TITLE_GEN_RULE, TITLE_FUSION_RULE, ACHIEVEMENT_GEN_RULE,
  JOY_SYSTEM_RULE, JOY_OUTPUT_RULE, JOY_PRIVATE_FIELDS_RULE,
  CHEST_OPEN_RULE, ARENA_OPPONENT_RULE, ARENA_REWARD_RULE, GLADIATOR_MATCH_RULE, GACHA_REWARD_RULE,
  CRAFT_RULE, EQUIP_SET_RULE, EQUIP_ASCEND_RULE, EQUIP_CRAFT_RULE, CRAFT_PROCESS_GEN_RULE,
  CHRONICLE_COMPILE_RULE, WORLDVIEW_GEN_PROMPT, WORLD_SUMMARY_PROMPT,
  CHAOS_RECORD_PROMPT, CHAOS_WORLD_GEN_PROMPT,
  CANON_INERTIA_RULE, SUXIAO_PERSONA_RULE, CANON_MISC_RULE,
  TABLE_FILL_RULE, TABLE_FILL_MANUAL_RULE,
  NPC_DECENTER_RULE, CAUSAL_WEIGHT_RULE, RUMOR_EVOLUTION_RULE, WORLD_EVENT_LIFECYCLE_RULE, WORLD_EVENT_VISIBILITY_RULE, NPC_INNER_VOICE_RULE, REPUTATION_RULE, DIPLOMACY_RULE, ECONOMY_RULE, ERA_EVOLUTION_RULE, MEMORY_TIERS_RULE,
  NPC_SHIFT_GUARD_RULE, PROSE_BLACKLIST_RULE, POLISH_RULE, STATE_DOCTOR_RULE, ARC_PLAN_RULE, ARC_BEAT_RULE,
  AGENT_NARRATIVE_CONTRACT_RULE, AGENT_FLOW_RULE, AGENT_REVIEWER_RULE,
} from '../promptRules';
import { COMBAT_WRITING_GUIDE_RULE } from './combatWritingGuide';
import { DISPATCH_GEN_RULE, DISPATCH_REPORT_RULE } from './dispatchPrompts';
import { ABYSS_BOON_GEN_RULE, ABYSS_SIN_GEN_RULE, ABYSS_AWAKEN_RULE, ABYSS_JUDGE_RULE, ABYSS_ENEMY_GEN_RULE } from './abyssPrompts';
import { NM_COMPILE_PROMPT, NM_INGEST_PROMPT } from './narrativeMemory';
import { NM_STRUCT_SELECT_PROMPT } from './structuredRecall';
import { PROFESSION_QUEST_PROMPT } from '../worldGenPrompt';

export interface PromptEntry {
  key: string;                 // 稳定键（override 类=promptRules 常量名；field 类=字段名）
  label: string;
  group: string;
  kind: 'override' | 'field';
  def: string;                 // 内置默认文本
  desc?: string;
  read?: () => string;         // field 类：读现有 store 字段
  write?: (v: string) => void; // field 类：写现有 store 字段
  reset?: () => void;          // field 类：恢复默认（留空 or 写默认，各字段语义不同）
}

export const PROMPT_REGISTRY: PromptEntry[] = [
  // ── 正文前置 / 规划（已有可编辑字段·留空=用内置默认）──
  { key: 'guidancePrompt', label: '剧情指导', group: '正文前置 / 规划', kind: 'field', def: PLOT_GUIDANCE_RULE, desc: '正文前先给本回合剧情要点建议',
    read: () => useSettings.getState().guidancePrompt, write: (v) => useSettings.getState().setGuidancePrompt(v), reset: () => useSettings.getState().setGuidancePrompt('') },
  { key: 'choicesPrompt', label: '剧情选项', group: '正文前置 / 规划', kind: 'field', def: PLOT_CHOICES_RULE, desc: '正文后生成的行动选项（完全覆盖）',
    read: () => useSettings.getState().choicesPrompt, write: (v) => useSettings.getState().setChoicesPrompt(v), reset: () => useSettings.getState().setChoicesPrompt('') },
  { key: 'outlinePrompt', label: '细纲', group: '正文前置 / 规划', kind: 'field', def: OUTLINE_GEN_RULE, desc: '正文前的可编辑细纲（职业编剧·完全覆盖）',
    read: () => useSettings.getState().outlinePrompt, write: (v) => useSettings.getState().setOutlinePrompt(v), reset: () => useSettings.getState().setOutlinePrompt('') },
  { key: 'preludePrompt', label: '前置提示词', group: '正文前置 / 规划', kind: 'field', def: '', desc: '每回合注入正文最深处（留空=不注入·无内置默认）',
    read: () => useSettings.getState().preludePrompt, write: (v) => useSettings.getState().setPreludePrompt(v), reset: () => useSettings.getState().setPreludePrompt('') },
  { key: 'AGENT_NARRATIVE_CONTRACT_RULE', label: 'Agent 模式 · 成稿契约', group: '正文前置 / 规划', kind: 'override', def: AGENT_NARRATIVE_CONTRACT_RULE, desc: 'Agent 正文模式：output/main.md 必须是含全部结构模块的完整正文（⚠ 改坏会丢状态栏/<state>）' },
  { key: 'AGENT_FLOW_RULE', label: 'Agent 模式 · 收尾铁则与流程', group: '正文前置 / 规划', kind: 'override', def: AGENT_FLOW_RULE, desc: 'Agent 正文模式：必须 commit 后 finish、禁纯文本收尾、推荐工具流程' },
  { key: 'AGENT_REVIEWER_RULE', label: 'Agent 模式 · 评稿人', group: '正文前置 / 规划', kind: 'override', def: AGENT_REVIEWER_RULE, desc: 'P2 评稿子代理：finish 前审成稿，PASS 放行 / REVISE 回喂修改意见（⚠ 首行 PASS/REVISE 协议别改坏）' },
  { key: 'CAST_BRIEF_RULE', label: '角色立场简报 · 产出', group: '正文前置 / 规划', kind: 'override', def: CAST_BRIEF_RULE, desc: '让细纲/推进按人格档案排演各角色的反应（锁人格不锁语言）' },
  { key: 'CAST_BRIEF_FOLLOW_RULE', label: '角色立场简报 · 正文遵循', group: '正文前置 / 规划', kind: 'override', def: CAST_BRIEF_FOLLOW_RULE, desc: '正文侧：怎么用简报（上限不是配额·内心不写成旁白）' },
  { key: 'PROSE_BLACKLIST_RULE', label: '文风黑名单 · 陈词滥调禁令', group: '正文前置 / 规划', kind: 'override', def: PROSE_BLACKLIST_RULE, desc: '禁 AI 高频陈词（不是…而是…/指节泛白/嘴角勾起…）；只约束措辞不改结构模块（借鉴V3.2）' },
  { key: 'POLISH_RULE', label: '✨ 正文校正 · 校对规则', group: '正文前置 / 规划', kind: 'override', def: POLISH_RULE, desc: '一键校正楼层正文的总规则（只改措辞不改事实；⚠改坏分段标记条款会让多段正文拼不回）（借鉴story-oracle）' },
  { key: 'STATE_DOCTOR_RULE', label: '🩺 状态诊断 · 军医规则', group: '正文前置 / 规划', kind: 'override', def: STATE_DOCTOR_RULE, desc: '状态↔正文对账的保守补丁规则（⚠改坏「补丁:/依据:」行协议会解析不出补丁）（借鉴story-oracle）' },
  { key: 'ARC_PLAN_RULE', label: '🧭 故事弧线 · 分拍规划', group: '正文前置 / 规划', kind: 'override', def: ARC_PLAN_RULE, desc: '把贯穿线拆成 3~5 拍的规划师规则（⚠改坏「弧名:/拍N:」行协议会解析失败）（借鉴story-oracle）' },
  { key: 'ARC_BEAT_RULE', label: '🧭 故事弧线 · 每拍导演指令', group: '正文前置 / 规划', kind: 'override', def: ARC_BEAT_RULE, desc: '每拍现编的幕后引导指令规则（要点式·玩家优先让路条款·禁写正文）（借鉴story-oracle）' },
  // ── 各演化阶段 · 思维链（override·留空=内置默认）──
  { key: 'ITEM_COT_RULE', label: '物品演化 · 思维链', group: '演化阶段', kind: 'override', def: ITEM_COT_RULE, desc: '物品增删改的逐项自检 CoT' },
  { key: 'PLAYER_COT_RULE', label: '主角演化 · 思维链', group: '演化阶段', kind: 'override', def: PLAYER_COT_RULE, desc: '主角属性/技能/状态演化 CoT' },
  { key: 'NPC_COT_RULE', label: 'NPC 演化 · 思维链', group: '演化阶段', kind: 'override', def: NPC_COT_RULE, desc: '在场 NPC 演化 CoT' },
  { key: 'ENTRY_COT_RULE', label: 'NPC 登场 · 思维链', group: '演化阶段', kind: 'override', def: ENTRY_COT_RULE, desc: '新 NPC 登场建档 CoT' },
  { key: 'FACTION_COT_RULE', label: '势力演化 · 思维链', group: '演化阶段', kind: 'override', def: FACTION_COT_RULE, desc: '势力登场/演化 CoT' },
  { key: 'TERRITORY_COT_RULE', label: '领地演化 · 思维链', group: '演化阶段', kind: 'override', def: TERRITORY_COT_RULE, desc: '领地建设演化 CoT' },
  { key: 'TEAM_COT_RULE', label: '冒险团 · 思维链', group: '演化阶段', kind: 'override', def: TEAM_COT_RULE, desc: '冒险团演化 CoT' },
  { key: 'NPC_LIFE_STORY_RULE', label: 'NPC 成长小传 · 生成', group: '演化阶段', kind: 'override', def: NPC_LIFE_STORY_RULE, desc: '为 NPC 补一份"从小到大"的来历与性格成因（门控一次·不进每回合注入）' },
  { key: 'NPC_SELF_NARRATION_RULE', label: 'NPC 第一人称自述 · 生成', group: '演化阶段', kind: 'override', def: NPC_SELF_NARRATION_RULE, desc: 'NPC 的自我剖白（门控一次·私聊/演化的人格锚点）' },
  { key: 'NPC_DECENTER_RULE', label: 'NPC 演化 · 去主角中心自检', group: '演化阶段', kind: 'override', def: NPC_DECENTER_RULE, desc: '逐人填表：动机能否在"完全不知道主角"时成立；非公开行为的关联配额=0（可见性例外挂在传闻/目击上）' },
  { key: 'CAUSAL_WEIGHT_RULE', label: '因果权重 · 力量结构铁则', group: '演化阶段', kind: 'override', def: CAUSAL_WEIGHT_RULE, desc: '治"凡人海啸推翻元婴"与其反面；R 值由前端按阶差机械算，AI 只据判定档写（systems/causalWeight）' },
  { key: 'RUMOR_EVOLUTION_RULE', label: '传闻流变 · 维护规则', group: '演化阶段', kind: 'override', def: RUMOR_EVOLUTION_RULE, desc: '真相/流传/偏差三分 + 时效闸门（未到期不动=省 token）+ 影响力五档一次一档（systems/rumor）' },
  { key: 'WORLD_EVENT_LIFECYCLE_RULE', label: '世界事件 · 生命周期', group: '演化阶段', kind: 'override', def: WORLD_EVENT_LIFECYCLE_RULE, desc: '背景/区域各≤3 + 推进=追加脉络（不覆盖描述）+ 结算条件必填 + 三级结算（systems/worldEvent）' },
  { key: 'WORLD_EVENT_VISIBILITY_RULE', label: '世界事件 · 可见性与到期', group: '演化阶段', kind: 'override', def: WORLD_EVENT_VISIBILITY_RULE, desc: 'hidden/trace/known/direct 四档可见性 + trace 必带表象 + 秘闻知情者 + due 到期⏰催收 + eventRevealed 显露递交（P1·借鉴世界背面）' },
  { key: 'NPC_INNER_VOICE_RULE', label: 'NPC · 心声独白', group: '演化阶段', kind: 'override', def: NPC_INNER_VOICE_RULE, desc: '处境/情绪真变化时顺手更新一行内心独白（innerVoice·仅幕后视角显示·绝不进正文·P2.5 借鉴世界背面）' },
  { key: 'NPC_SHIFT_GUARD_RULE', label: 'NPC · 变化防误读三判据', group: '演化阶段', kind: 'override', def: NPC_SHIFT_GUARD_RULE, desc: '摄像头判据（只记可拍摄行为）+ 耐用性判据（数轮后仍有用）+「＝真实动机｜不要理解为X」注解（借鉴V3.2·治一次事件写崩人设）' },
  { key: 'REPUTATION_RULE', label: '四维声誉 · 维护规则', group: '演化阶段', kind: 'override', def: REPUTATION_RULE, desc: '官方/民间/暗域/业界各6级；⚠可见性依据必填否则前端整批拒绝（无人知晓不影响公共声誉）+ 一次一档 + 最多3维（systems/reputation）' },
  { key: 'DIPLOMACY_RULE', label: '势力外交 · 八级与事件链闸门', group: '演化阶段', kind: 'override', def: DIPLOMACY_RULE, desc: '血盟→世仇八级；⚠跨≥2档必须先走完三阶段事件链否则前端回落成渐变1档；主角可调解/挑拨/代行（systems/diplomacy）' },
  { key: 'ECONOMY_RULE', label: '经济气候 · 维护规则', group: '演化阶段', kind: 'override', def: ECONOMY_RULE, desc: '相位/大宗三类/经济事件≤3；⚠物价指数由前端按公式推进(±30%封顶)，AI 只给方向与理由（systems/economy）' },
  { key: 'ERA_EVOLUTION_RULE', label: '时代演化 · 潜在时代（宇宙层）', group: '演化阶段', kind: 'override', def: ERA_EVOLUTION_RULE, desc: '挂万族演化；⚠进度/净干预/临界派生/合并全由前端算，AI 只给方向与命名。进度单向不回退（systems/eraModel）' },
  { key: 'MEMORY_TIERS_RULE', label: '三层记忆 · 衰退规则', group: '演化阶段', kind: 'override', def: MEMORY_TIERS_RULE, desc: '近期8→沉淀8→核心5；⚠"谁该压缩/丢弃"由前端 planDecay 算好，AI 只负责改写成更短的版本（systems/memoryTiers）' },
  { key: 'TABLE_FILL_RULE', label: '填表 · 填表铁则', group: '演化阶段', kind: 'override', def: TABLE_FILL_RULE, desc: '剧情表（纪要/进程/伏笔/约定）该记什么、怎么记的规则' },
  { key: 'TABLE_FILL_MANUAL_RULE', label: '填表 · 输出格式铁则', group: '演化阶段', kind: 'override', def: TABLE_FILL_MANUAL_RULE, desc: '填表调用只吐 <tableEdit>、不写正文的格式约束（⚠ 改坏会导致填表解析失败）' },
  // ── 演化阶段 · 图鉴 / 总纲（第二批）──
  { key: 'ITEM_EVOLUTION_CODEX', label: '物品演化 · 图鉴总纲', group: '演化阶段', kind: 'override', def: ITEM_EVOLUTION_CODEX, desc: '物品演化的图鉴/总纲（物品阶段 + 对账）' },
  { key: 'EQUIP_CODEX', label: '装备生成 · 世界书图鉴', group: '演化阶段', kind: 'override', def: EQUIP_CODEX, desc: '装备生成总纲/品级/数值/词缀（物品·强化·开箱·交易·竞技场·深渊·福袋 通用）' },
  { key: 'PARADISE_RULES_RULE', label: '主角演化 · 乐园规则总纲', group: '演化阶段', kind: 'override', def: PARADISE_RULES_RULE, desc: '主角演化时的轮回乐园规则总纲' },
  // ── 记忆 ──
  { key: 'memoryPrompt', label: '记忆 / 生平整理', group: '记忆', kind: 'field', def: DEFAULT_MEMORY_PROMPT, desc: '压缩角色生平与短/长期记忆',
    read: () => useMemory.getState().settings.prompt, write: (v) => useMemory.getState().setSettings({ prompt: v }), reset: () => useMemory.getState().resetPrompt() },
  // ── 战斗 ──
  { key: 'COMBAT_NARRATE_RULE', label: '战斗叙事 · 铁则', group: '战斗', kind: 'override', def: COMBAT_NARRATE_RULE, desc: '战斗结算后一次性润色成正文的规则' },
  { key: 'COMBAT_WRITING_GUIDE_RULE', label: '战斗写作指导', group: '战斗', kind: 'override', def: COMBAT_WRITING_GUIDE_RULE, desc: '战斗镜头 / 力量标尺 / CoT 写作指导' },
  // ── 私信 / 聊天 ──
  { key: 'NPC_CHAT_RULE', label: '私聊 · 输出格式 / 入戏', group: '私信 / 聊天', kind: 'override', def: NPC_CHAT_RULE, desc: 'NPC 私聊的输出格式与入戏' },
  { key: 'DM_REPLY_PROTOCOL_RULE', label: '✉ 私信 · 回复行协议', group: '私信 / 聊天', kind: 'override', def: DM_REPLY_PROTOCOL_RULE, desc: '私信回复的状态头+消息花样行协议（状态/心声/说/撤回/引用/戳；⚠改坏字段名会解析不出，兜底成整段纯文本）（借鉴Abstract外置手机）' },
  { key: 'NSFW_WRITING_RULE', label: 'NSFW 写作宪章', group: '私信 / 聊天', kind: 'override', def: NSFW_WRITING_RULE, desc: '私聊 / 欢愉宫等成人向写作规则' },
  { key: 'NPC_TEAM_JOIN_CHAT_RULE', label: '私聊 · 入团意愿', group: '私信 / 聊天', kind: 'override', def: NPC_TEAM_JOIN_CHAT_RULE, desc: '队友在私聊里处理入团 / 邀约' },
  { key: 'INTERVIEW_RULE', label: '🎤 大采访 · 撰稿规则', group: '私信 / 聊天', kind: 'override', def: INTERVIEW_RULE, desc: '局外花絮采访的行协议与写法（借鉴V3.2·⚠改坏行前缀会让杂志排版解析失败回退纯文本）' },
  { key: 'TRAINING_CHAT_RULE', label: '🔗 调教 · 对话与档案更新', group: '私信 / 聊天', kind: 'override', def: TRAINING_CHAT_RULE, desc: '调教对话的 <对白>/<交互>/<调教> 三块协议 + 隐私字段只增不重置铁则（⚠改坏 <调教> 字段名会让变化落不进档案）' },
  // ── 剧情选项 / 番外 ──
  { key: 'CHOICES_FANFIC_SYSTEM', label: '选项 / 番外 · 处理器底座', group: '剧情选项 / 番外', kind: 'override', def: CHOICES_FANFIC_SYSTEM, desc: '正文后幕后处理器 system 底座' },
  { key: 'FANFIC_RULE', label: '同人增强', group: '剧情选项 / 番外', kind: 'override', def: FANFIC_RULE, desc: '同人梗 / 桥段增强' },
  { key: 'MINI_THEATER_RULE', label: '小剧场 · 番外彩蛋', group: '剧情选项 / 番外', kind: 'override', def: MINI_THEATER_RULE, desc: '正文后的小剧场 / 番外彩蛋' },
  // ── 生平 / 纪念 ──
  { key: 'MONUMENT_EULOGY_RULE', label: '英灵生平 · 悼词', group: '生平 / 纪念', kind: 'override', def: MONUMENT_EULOGY_RULE, desc: '陨落契约者的生平总结 + 结语' },
  // ── 世界结算（第三批·addRule 门控注入）──
  { key: 'WORLD_SETTLEMENT_RULE', label: '世界结算 · 总纲', group: '世界结算', kind: 'override', def: WORLD_SETTLEMENT_RULE, desc: '结算总纲 / 报酬 / 评级（【结算任务】触发）' },
  { key: 'WORLD_SETTLEMENT_COT_RULE', label: '世界结算 · 思维链', group: '世界结算', kind: 'override', def: WORLD_SETTLEMENT_COT_RULE, desc: '结算前逐项推演是否公正 / 忠于原文' },
  { key: 'CHAOS_RECORD_PROMPT', label: '混沌世界 · 影响记录', group: '世界结算', kind: 'override', def: CHAOS_RECORD_PROMPT, desc: '离世时生成「对世界的影响 + 剧情偏移点」的 COT（含联网核对原著）' },
  { key: 'CHAOS_WORLD_GEN_PROMPT', label: '混沌世界 · 世界卡生成', group: '世界结算', kind: 'override', def: CHAOS_WORLD_GEN_PROMPT, desc: '据多个世界的前人记录生成「被前人影响过」的世界卡 COT' },
  // ── NPC 演化 · 人格与校准（正文常驻 + 演化两处一致 override）──
  { key: 'ATTR_POWER_CODEX', label: '属性 · 战力量化表', group: '演化阶段', kind: 'override', def: ATTR_POWER_CODEX, desc: '单属性↔阶位↔战力↔生物强度档 校准基准' },
  { key: 'NPC_INDEPENDENCE_RULE', label: 'NPC · 独立人格反谄媚', group: '演化阶段', kind: 'override', def: NPC_INDEPENDENCE_RULE, desc: '配角有独立人格 · 不围着主角转' },
  { key: 'DISPOSITION_STAGE_RULE', label: 'NPC · 对主角态度四轴', group: '演化阶段', kind: 'override', def: DISPOSITION_STAGE_RULE, desc: '信任 / 尊重 / 情欲 / 沉沦 · 渐进不跳级' },
  // ── 技能 / 称号 / 成就 ──
  { key: 'SKILL_LEVELUP_PROMPT', label: '技能升级', group: '技能 / 称号 / 成就', kind: 'override', def: SKILL_LEVELUP_PROMPT, desc: '技能点升级 / 黄金点质变（含技能天赋世界书 + COT）' },
  { key: 'SKILL_FUSION_RULE', label: '技能融合', group: '技能 / 称号 / 成就', kind: 'override', def: SKILL_FUSION_RULE, desc: '技能融合铁则' },
  { key: 'SKILL_FUSION_NPC_RULE', label: '技能融合 · NPC/宠物', group: '技能 / 称号 / 成就', kind: 'override', def: SKILL_FUSION_NPC_RULE, desc: '熔铸对象是 NPC/随从/宠物/召唤物 时追加（强度锚该角色 · 不越主人 · 形态守恒）' },
  { key: 'TITLE_GEN_RULE', label: '称号生成', group: '技能 / 称号 / 成就', kind: 'override', def: TITLE_GEN_RULE, desc: '称号生成规则' },
  { key: 'TITLE_FUSION_RULE', label: '称号融合', group: '技能 / 称号 / 成就', kind: 'override', def: TITLE_FUSION_RULE, desc: '称号融合规则' },
  { key: 'ACHIEVEMENT_GEN_RULE', label: '成就生成', group: '技能 / 称号 / 成就', kind: 'override', def: ACHIEVEMENT_GEN_RULE, desc: '成就生成规则' },
  // ── 欢愉宫 ──
  { key: 'JOY_SYSTEM_RULE', label: '欢愉宫 · 系统', group: '欢愉宫', kind: 'override', def: JOY_SYSTEM_RULE, desc: '看板娘演绎系统规则' },
  { key: 'JOY_OUTPUT_RULE', label: '欢愉宫 · 输出格式', group: '欢愉宫', kind: 'override', def: JOY_OUTPUT_RULE, desc: '欢愉宫输出格式' },
  { key: 'JOY_PRIVATE_FIELDS_RULE', label: '欢愉宫 · 私密字段', group: '欢愉宫', kind: 'override', def: JOY_PRIVATE_FIELDS_RULE, desc: '情欲 / 私密状态字段 schema' },
  // ── 玩法设施 ──
  { key: 'CHEST_OPEN_RULE', label: '开箱', group: '玩法设施', kind: 'override', def: CHEST_OPEN_RULE, desc: '开宝箱产出规则' },
  { key: 'DISPATCH_GEN_RULE', label: '冒险团派遣 · 委托生成', group: '玩法设施', kind: 'override', def: DISPATCH_GEN_RULE, desc: '手动生成委托板（含奖励物品完整字段）' },
  { key: 'DISPATCH_REPORT_RULE', label: '冒险团派遣 · 归来战报', group: '玩法设施', kind: 'override', def: DISPATCH_REPORT_RULE, desc: '照已锁死的账本写战报散文' },
  { key: 'ARENA_OPPONENT_RULE', label: '竞技场 · 对手生成', group: '玩法设施', kind: 'override', def: ARENA_OPPONENT_RULE, desc: '竞技场对手生成' },
  { key: 'ARENA_REWARD_RULE', label: '竞技场 · 奖励', group: '玩法设施', kind: 'override', def: ARENA_REWARD_RULE, desc: '竞技场排名奖励' },
  { key: 'GLADIATOR_MATCH_RULE', label: '角斗 · 赛事', group: '玩法设施', kind: 'override', def: GLADIATOR_MATCH_RULE, desc: '角斗场赛事生成' },
  { key: 'GACHA_REWARD_RULE', label: '福袋 · 扭蛋', group: '玩法设施', kind: 'override', def: GACHA_REWARD_RULE, desc: '福袋 / 扭蛋产出' },
  // ── 深渊地牢 ──
  { key: 'ABYSS_BOON_GEN_RULE', label: '深渊 · 加成卡生成', group: '深渊地牢', kind: 'override', def: ABYSS_BOON_GEN_RULE, desc: '深渊馈赠 · 四选一加成卡' },
  { key: 'ABYSS_SIN_GEN_RULE', label: '深渊 · 原罪物文案', group: '深渊地牢', kind: 'override', def: ABYSS_SIN_GEN_RULE, desc: '原罪物命名与文案' },
  { key: 'ABYSS_AWAKEN_RULE', label: '深渊 · 觉醒仪式', group: '深渊地牢', kind: 'override', def: ABYSS_AWAKEN_RULE, desc: '觉醒充能升级文案 / 词缀' },
  { key: 'ABYSS_JUDGE_RULE', label: '深渊 · 裁判抉择', group: '深渊地牢', kind: 'override', def: ABYSS_JUDGE_RULE, desc: '深渊裁判 / 心魔抉择局' },
  { key: 'ABYSS_ENEMY_GEN_RULE', label: '深渊 · 敌人面板', group: '深渊地牢', kind: 'override', def: ABYSS_ENEMY_GEN_RULE, desc: '深渊敌人面板生成' },
  // ── 合成工坊 ──
  { key: 'CRAFT_RULE', label: '合成工坊 · 规则', group: '合成工坊', kind: 'override', def: CRAFT_RULE, desc: '合成 / 炼制守恒、格式、品质规则' },
  { key: 'EQUIP_SET_RULE', label: '套装锻造', group: '合成工坊', kind: 'override', def: EQUIP_SET_RULE, desc: '整套主题装备生成 · 套装效果按已装备件数递进解锁' },
  { key: 'EQUIP_ASCEND_RULE', label: '品级进阶', group: '玩法设施', kind: 'override', def: EQUIP_ASCEND_RULE, desc: '强化所 · 装备品级 +1 档进阶形态生成' },
  { key: 'EQUIP_CRAFT_RULE', label: '装备工艺', group: '玩法设施', kind: 'override', def: EQUIP_CRAFT_RULE, desc: '强化所 · 工艺产出的那一条词缀文本（结果由前端摇定）' },
  { key: 'CRAFT_PROCESS_GEN_RULE', label: '自创工艺', group: '玩法设施', kind: 'override', def: CRAFT_PROCESS_GEN_RULE, desc: '强化所 · 玩家提示词 → AI 生成新工艺定义（参数受夹取）' },
  // ── 世界生成 / 总结 ──
  { key: 'WORLDVIEW_GEN_PROMPT', label: '世界观生成', group: '世界生成 / 总结', kind: 'override', def: WORLDVIEW_GEN_PROMPT, desc: '进入世界时生成世界观设定' },
  { key: 'WORLD_SUMMARY_PROMPT', label: '离世总结', group: '世界生成 / 总结', kind: 'override', def: WORLD_SUMMARY_PROMPT, desc: '离开世界时的世界志总结' },
  { key: 'CHRONICLE_COMPILE_RULE', label: '编年史·修史', group: '世界生成 / 总结', kind: 'override', def: CHRONICLE_COMPILE_RULE, desc: '把一卷纪要实录删繁就简编纂成正史' },
  { key: 'PROFESSION_QUEST_PROMPT', label: '职业任务生成', group: '世界生成 / 总结', kind: 'override', def: PROFESSION_QUEST_PROMPT, desc: '世界卡按钮 · 读技能 / 副职业树生成职业任务' },
  // ── 叙事记忆 RAG ──
  { key: 'NM_COMPILE_PROMPT', label: '记忆召回 · 关键词规划', group: '叙事记忆 RAG', kind: 'override', def: NM_COMPILE_PROMPT, desc: '检索关键词规划（LLM 召回模式）' },
  { key: 'NM_INGEST_PROMPT', label: '记忆抽取 · 长期事实', group: '叙事记忆 RAG', kind: 'override', def: NM_INGEST_PROMPT, desc: '从正文抽取长期事实入库' },
  { key: 'NM_STRUCT_SELECT_PROMPT', label: '结构化召回 · 选取', group: '叙事记忆 RAG', kind: 'override', def: NM_STRUCT_SELECT_PROMPT, desc: 'API 选取该注入哪些 NPC / 技能 / 装备' },
  // ── 🛤 原著路线 ──
  { key: 'CANON_INERTIA_RULE', label: '原著惯性铁则', group: '🛤 原著路线', kind: 'override', def: CANON_INERTIA_RULE, desc: '原著事件=世界默认走向；玩家可改写、绝不剧情杀掰回、不剧透' },
  { key: 'SUXIAO_PERSONA_RULE', label: '白夜 · 演绎铁则', group: '🛤 原著路线', kind: 'override', def: SUXIAO_PERSONA_RULE, desc: '苏晓的人设/强度锁定、可敌可杀无护甲、脱轨联动、现身节制' },
  { key: 'CANON_MISC_RULE', label: '路线状态维护（杂项阶段）', group: '🛤 原著路线', kind: 'override', def: CANON_MISC_RULE, desc: 'canonPhase / canonDivergence / canonSuxiao / canonEncounter / canonChecklist 输出指令' },
];

/** 玩家当前自定义值（field=store 字段值 / override=override map 值；未自定义时可能为空或等于默认）。 */
export function promptCustom(e: PromptEntry): string {
  if (e.kind === 'field') return e.read?.() ?? '';
  return usePromptOverride.getState().overrides[e.key] ?? '';
}
/** 是否已被玩家改动（非空且不等于内置默认）。 */
export function promptIsCustom(e: PromptEntry): boolean {
  const c = promptCustom(e);
  return c.trim() !== '' && c !== e.def;
}
/** 当前实际生效文本（有自定义用自定义，否则内置默认）。 */
export function promptEffective(e: PromptEntry): string {
  const c = promptCustom(e);
  return c.trim() ? c : e.def;
}
/** 保存玩家自定义（空串按恢复默认处理）。 */
export function promptSetCustom(e: PromptEntry, v: string): void {
  if (e.kind === 'field') { if (v.trim()) e.write?.(v); else e.reset?.(); return; }
  const s = usePromptOverride.getState();
  if (v.trim()) s.setOverride(e.key, v); else s.clearOverride(e.key);
}
/** 恢复默认。 */
export function promptReset(e: PromptEntry): void {
  if (e.kind === 'field') { e.reset?.(); return; }
  usePromptOverride.getState().clearOverride(e.key);
}

/** 导出所有已自定义的主提示词（field + override 统一按注册表 key 打包）。 */
export function exportPromptOverrides(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of PROMPT_REGISTRY) { const c = promptCustom(e); if (c.trim() && c !== e.def) out[e.key] = c; }
  return out;
}
/** 导入主提示词包：按注册表 key 分派回各自 store，返回成功条数。 */
export function importPromptOverrides(map: Record<string, unknown>): number {
  let n = 0;
  for (const e of PROMPT_REGISTRY) {
    const v = map[e.key];
    if (typeof v === 'string' && v.trim()) { promptSetCustom(e, v); n++; }
  }
  return n;
}
