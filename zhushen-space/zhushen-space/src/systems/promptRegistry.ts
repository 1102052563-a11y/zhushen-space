/* 预设中心·「可编辑主提示词」注册表：驱动 PromptCenterPanel 的罗列 + 默认回退 + 读写分派。
   两类条目：
   - kind='field'：绑定现有 store 字段（剧情指导/选项/细纲/前置/记忆…已有的可编辑提示词）——读写走各自 store，零接入。
   - kind='override'：走 promptOverride store（各演化阶段主提示词），接入点用 getPrompt('KEY', 内置常量) 生效。
   ⚠ 只登记「主提示词」；底层护栏规则（去重/锁值/数值守卫…）不进这里，玩家改不到、拼接处也不包 getPrompt。 */
import { useSettings } from '../store/settingsStore';
import { useMemory, DEFAULT_MEMORY_PROMPT } from '../store/memoryStore';
import { usePromptOverride } from '../store/promptOverrideStore';
import {
  PLOT_GUIDANCE_RULE, PLOT_CHOICES_RULE, OUTLINE_GEN_RULE,
  ITEM_COT_RULE, PLAYER_COT_RULE, NPC_COT_RULE, ENTRY_COT_RULE,
  FACTION_COT_RULE, TERRITORY_COT_RULE, TEAM_COT_RULE,
  EQUIP_CODEX, ITEM_EVOLUTION_CODEX, PARADISE_RULES_RULE,
  COMBAT_NARRATE_RULE, NPC_CHAT_RULE, NSFW_WRITING_RULE, NPC_TEAM_JOIN_CHAT_RULE,
  MONUMENT_EULOGY_RULE, CHOICES_FANFIC_SYSTEM, FANFIC_RULE, MINI_THEATER_RULE,
  WORLD_SETTLEMENT_RULE, WORLD_SETTLEMENT_COT_RULE, ATTR_POWER_CODEX, NPC_INDEPENDENCE_RULE, DISPOSITION_STAGE_RULE,
  SKILL_LEVELUP_PROMPT, SKILL_FUSION_RULE, TITLE_GEN_RULE, TITLE_FUSION_RULE, ACHIEVEMENT_GEN_RULE,
  JOY_SYSTEM_RULE, JOY_OUTPUT_RULE, JOY_PRIVATE_FIELDS_RULE,
  CHEST_OPEN_RULE, ARENA_OPPONENT_RULE, ARENA_REWARD_RULE, GLADIATOR_MATCH_RULE, GACHA_REWARD_RULE,
  CRAFT_RULE, WORLDVIEW_GEN_PROMPT, WORLD_SUMMARY_PROMPT,
} from '../promptRules';
import { COMBAT_WRITING_GUIDE_RULE } from './combatWritingGuide';
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
  // ── 各演化阶段 · 思维链（override·留空=内置默认）──
  { key: 'ITEM_COT_RULE', label: '物品演化 · 思维链', group: '演化阶段', kind: 'override', def: ITEM_COT_RULE, desc: '物品增删改的逐项自检 CoT' },
  { key: 'PLAYER_COT_RULE', label: '主角演化 · 思维链', group: '演化阶段', kind: 'override', def: PLAYER_COT_RULE, desc: '主角属性/技能/状态演化 CoT' },
  { key: 'NPC_COT_RULE', label: 'NPC 演化 · 思维链', group: '演化阶段', kind: 'override', def: NPC_COT_RULE, desc: '在场 NPC 演化 CoT' },
  { key: 'ENTRY_COT_RULE', label: 'NPC 登场 · 思维链', group: '演化阶段', kind: 'override', def: ENTRY_COT_RULE, desc: '新 NPC 登场建档 CoT' },
  { key: 'FACTION_COT_RULE', label: '势力演化 · 思维链', group: '演化阶段', kind: 'override', def: FACTION_COT_RULE, desc: '势力登场/演化 CoT' },
  { key: 'TERRITORY_COT_RULE', label: '领地演化 · 思维链', group: '演化阶段', kind: 'override', def: TERRITORY_COT_RULE, desc: '领地建设演化 CoT' },
  { key: 'TEAM_COT_RULE', label: '冒险团 · 思维链', group: '演化阶段', kind: 'override', def: TEAM_COT_RULE, desc: '冒险团演化 CoT' },
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
  { key: 'NSFW_WRITING_RULE', label: 'NSFW 写作宪章', group: '私信 / 聊天', kind: 'override', def: NSFW_WRITING_RULE, desc: '私聊 / 欢愉宫等成人向写作规则' },
  { key: 'NPC_TEAM_JOIN_CHAT_RULE', label: '私聊 · 入团意愿', group: '私信 / 聊天', kind: 'override', def: NPC_TEAM_JOIN_CHAT_RULE, desc: '队友在私聊里处理入团 / 邀约' },
  // ── 剧情选项 / 番外 ──
  { key: 'CHOICES_FANFIC_SYSTEM', label: '选项 / 番外 · 处理器底座', group: '剧情选项 / 番外', kind: 'override', def: CHOICES_FANFIC_SYSTEM, desc: '正文后幕后处理器 system 底座' },
  { key: 'FANFIC_RULE', label: '同人增强', group: '剧情选项 / 番外', kind: 'override', def: FANFIC_RULE, desc: '同人梗 / 桥段增强' },
  { key: 'MINI_THEATER_RULE', label: '小剧场 · 番外彩蛋', group: '剧情选项 / 番外', kind: 'override', def: MINI_THEATER_RULE, desc: '正文后的小剧场 / 番外彩蛋' },
  // ── 生平 / 纪念 ──
  { key: 'MONUMENT_EULOGY_RULE', label: '英灵生平 · 悼词', group: '生平 / 纪念', kind: 'override', def: MONUMENT_EULOGY_RULE, desc: '陨落契约者的生平总结 + 结语' },
  // ── 世界结算（第三批·addRule 门控注入）──
  { key: 'WORLD_SETTLEMENT_RULE', label: '世界结算 · 总纲', group: '世界结算', kind: 'override', def: WORLD_SETTLEMENT_RULE, desc: '结算总纲 / 报酬 / 评级（【结算任务】触发）' },
  { key: 'WORLD_SETTLEMENT_COT_RULE', label: '世界结算 · 思维链', group: '世界结算', kind: 'override', def: WORLD_SETTLEMENT_COT_RULE, desc: '结算前逐项推演是否公正 / 忠于原文' },
  // ── NPC 演化 · 人格与校准（正文常驻 + 演化两处一致 override）──
  { key: 'ATTR_POWER_CODEX', label: '属性 · 战力量化表', group: '演化阶段', kind: 'override', def: ATTR_POWER_CODEX, desc: '单属性↔阶位↔战力↔生物强度档 校准基准' },
  { key: 'NPC_INDEPENDENCE_RULE', label: 'NPC · 独立人格反谄媚', group: '演化阶段', kind: 'override', def: NPC_INDEPENDENCE_RULE, desc: '配角有独立人格 · 不围着主角转' },
  { key: 'DISPOSITION_STAGE_RULE', label: 'NPC · 对主角态度四轴', group: '演化阶段', kind: 'override', def: DISPOSITION_STAGE_RULE, desc: '信任 / 尊重 / 情欲 / 沉沦 · 渐进不跳级' },
  // ── 技能 / 称号 / 成就 ──
  { key: 'SKILL_LEVELUP_PROMPT', label: '技能升级', group: '技能 / 称号 / 成就', kind: 'override', def: SKILL_LEVELUP_PROMPT, desc: '技能点升级 / 黄金点质变（含技能天赋世界书 + COT）' },
  { key: 'SKILL_FUSION_RULE', label: '技能融合', group: '技能 / 称号 / 成就', kind: 'override', def: SKILL_FUSION_RULE, desc: '技能融合铁则' },
  { key: 'TITLE_GEN_RULE', label: '称号生成', group: '技能 / 称号 / 成就', kind: 'override', def: TITLE_GEN_RULE, desc: '称号生成规则' },
  { key: 'TITLE_FUSION_RULE', label: '称号融合', group: '技能 / 称号 / 成就', kind: 'override', def: TITLE_FUSION_RULE, desc: '称号融合规则' },
  { key: 'ACHIEVEMENT_GEN_RULE', label: '成就生成', group: '技能 / 称号 / 成就', kind: 'override', def: ACHIEVEMENT_GEN_RULE, desc: '成就生成规则' },
  // ── 欢愉宫 ──
  { key: 'JOY_SYSTEM_RULE', label: '欢愉宫 · 系统', group: '欢愉宫', kind: 'override', def: JOY_SYSTEM_RULE, desc: '看板娘演绎系统规则' },
  { key: 'JOY_OUTPUT_RULE', label: '欢愉宫 · 输出格式', group: '欢愉宫', kind: 'override', def: JOY_OUTPUT_RULE, desc: '欢愉宫输出格式' },
  { key: 'JOY_PRIVATE_FIELDS_RULE', label: '欢愉宫 · 私密字段', group: '欢愉宫', kind: 'override', def: JOY_PRIVATE_FIELDS_RULE, desc: '情欲 / 私密状态字段 schema' },
  // ── 玩法设施 ──
  { key: 'CHEST_OPEN_RULE', label: '开箱', group: '玩法设施', kind: 'override', def: CHEST_OPEN_RULE, desc: '开宝箱产出规则' },
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
  // ── 世界生成 / 总结 ──
  { key: 'WORLDVIEW_GEN_PROMPT', label: '世界观生成', group: '世界生成 / 总结', kind: 'override', def: WORLDVIEW_GEN_PROMPT, desc: '进入世界时生成世界观设定' },
  { key: 'WORLD_SUMMARY_PROMPT', label: '离世总结', group: '世界生成 / 总结', kind: 'override', def: WORLD_SUMMARY_PROMPT, desc: '离开世界时的世界志总结' },
  { key: 'PROFESSION_QUEST_PROMPT', label: '职业任务生成', group: '世界生成 / 总结', kind: 'override', def: PROFESSION_QUEST_PROMPT, desc: '世界卡按钮 · 读技能 / 副职业树生成职业任务' },
  // ── 叙事记忆 RAG ──
  { key: 'NM_COMPILE_PROMPT', label: '记忆召回 · 关键词规划', group: '叙事记忆 RAG', kind: 'override', def: NM_COMPILE_PROMPT, desc: '检索关键词规划（LLM 召回模式）' },
  { key: 'NM_INGEST_PROMPT', label: '记忆抽取 · 长期事实', group: '叙事记忆 RAG', kind: 'override', def: NM_INGEST_PROMPT, desc: '从正文抽取长期事实入库' },
  { key: 'NM_STRUCT_SELECT_PROMPT', label: '结构化召回 · 选取', group: '叙事记忆 RAG', kind: 'override', def: NM_STRUCT_SELECT_PROMPT, desc: 'API 选取该注入哪些 NPC / 技能 / 装备' },
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
