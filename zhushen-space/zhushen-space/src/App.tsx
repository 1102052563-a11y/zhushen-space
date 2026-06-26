import { type StoryImage, userToHtml, toHtmlWithImages } from './systems/narrativeHtml';
import {
  buildPerspectiveRule,
  NARRATIVE_FIRST_RULE,
  TERRITORY_EFFECT_RULE,
  TERRITORY_STABILITY_RULE,
  TERRITORY_DEDUP_RULE,
  EVO_VERIFY_RULE,
  BUFF_AS_STATUS_RULE,
  STATUS_COUNTDOWN_TURN_RULE,
  ITEM_FIXED_FORMAT_RULE,
  AFFIX_EFFECT_RULE,
  ITEM_GRADE_TABLE_RULE,
  EQUIP_CODEX,
  CHANNEL_PRICE_CODEX,
  ITEM_ACQUIRE_RULE,
  ITEM_DESTROY_GUARD_RULE,
  ITEM_COT_RULE,
  ITEM_EVOLUTION_CODEX,
  PLAYER_COT_RULE,
  PARADISE_RULES_RULE,
  REAL_POINT_LOCK_RULE,
  NPC_COT_RULE,
  NPC_SELF_NARRATION_RULE,
  PLOT_GUIDANCE_RULE,
  ENTRY_COT_RULE,
  ENTRY_NAME_CN_RULE,
  ENTRY_DEDUP_RULE,
  FACTION_COT_RULE,
  TERRITORY_COT_RULE,
  TEAM_COT_RULE,
  ITEM_EXACT_REF_RULE,
  ITEM_UPDATE_RULE,
  MERGED_AUDIT_SYSTEM,
  MERGED_AUDIT_PROMPT,
  EVO_EXACT_REF_RULE,
  SUBPROF_RULE,
  SUBPROF_EVO_PROMPT,
  NPC_AGE_RULE,
  NPC_GEN_ATTR_RULE,
  NPC_ENTRY_BIO_RULE,
  NPC_REVIEW_TAG_RULE,
  NPC_TEAM_AFFILIATION_RULE,
  FACTION_WORLD_RULE,
  FACTION_DETECT_RULE,
  FACTION_FULL_FORMAT_RULE,
  NPC_DEAD_EXCLUDE_RULE,
  NPC_ID_RULE,
  NPC_SKILL_KEEP_RULE,
  PLAYER_SKILL_KEEP_RULE,
  ITEM_GRANTED_SKILL_RULE,
  SKILL_STABILITY_RULE,
  SKILL_COMBAT_TAG_RULE,
  TIER_RULE,
  SKILL_TALENT_NOTE_RULE,
  SKILL_TIER_RULE,
  SKILL_TALENT_GUIDE,
  IMAGE_TAGS_RULE,
  FIRST_UPDATE_COMPLETE_RULE,
  HPEP_NARRATIVE_ONLY_RULE,
  WORLDSOURCE_RULE,
  POINTS_NARRATIVE_RULE,
  ATTR_SANITY_RULE,
  ATTR_CAP_RULE,
  PLAYER_ATTR_LOCK_RULE,
  APPEARANCE_UPDATE_RULE,
  PLAYER_STATE_EMIT_RULE,
  ATTR_POINT_AUTHORITY_RULE,
  VITALS_SETTLEMENT_EMIT_RULE,
  CHOICES_FANFIC_SYSTEM,
  FANFIC_RULE,
  PLOT_CHOICES_RULE,
  MINI_THEATER_RULE,
  ENHANCE_FINALIZE_RULE,
  ENHANCE_BANTER_RULE,
  ARENA_LADDER_RULE,
  ARENA_OPPONENT_RULE,
  ARENA_REWARD_RULE,
  GLADIATOR_MATCH_RULE,
  GLADIATOR_BATTLE_RULE,
  GACHA_REWARD_RULE,
  CASINO_BANTER_RULE,
  SOUL_GAMBLE_RULE,
  POTENTIAL_POINT_RULE,
  WORLD_SETTLEMENT_RULE,
} from './promptRules';

import { useState, useRef, useEffect, lazy, Suspense, type PointerEvent as RPointerEvent } from 'react';
import { useGame } from './store/gameStore';
import { useSettings, resolveApiChain } from './store/settingsStore';
import { apiChatFallback, fetchWithProxy, abortAllApiCalls } from './systems/apiChat';
import { parseAllStateUpdates, stripStateBlocks, parseAllItemCommands, applyItemCommands, parseAllCharCommands, applyCharacterCommands, parseAllNpcCommands, applyNpcCommands, parseAllFactionCommands, applyFactionCommands, applyTerritoryCommands, applyTeamCommands, isEquippable, lenientJsonParse } from './systems/stateParser';
import { isRealNpc, sanitizeEntryName, stripLeakedThinking, setNpcPreferredOwners, applyStateUpdates, applyAllUpdates, stripKillBlocks, stripVitalsBlocks, stripWorldSourceBlocks, collapseRunaway } from './systems/stateApply';
import { flattenAiText } from './systems/flattenAiText';
import { runPhasePipeline, type Phase } from './systems/phasePipeline';
import { buildFanficInjection, buildFactInjection, buildCosmosInjection, buildPlayerCoreInjection, buildWorldTimeInjection, buildQuestInjection } from './systems/promptInjections';
import { takeSkillUpNote } from './systems/skillUpgrade';
import { applyPlayerProfileCommands, applyTimedStatusCommands, expireStatuses } from './systems/statusCommands';
import { getNpcApi, trimNarrative, npcChatCompletion, buildNpcVars, fillVars, serializeNpcSnapshot } from './systems/npcEvolutionHelpers';
import { combatFinalVitals, applyCombatVitals, buildCombatResultFallback, runBattleSummaryPhase } from './systems/combatHelpers';
import { pickEnemyAction } from './systems/enemyAI';
import { parseWeather, isLightSky, extractWeatherFxCss, sanitizeWeatherCss } from './systems/weatherFx';
import { runNpcAutonomy } from './systems/npcAutonomy';
import { useCombat, newLogId, type BattleState, type CombatStatBlock, type Side, type CombatActionKind } from './store/combatStore';
import { buildCombatant, assembleBattle, settleAction, advanceTurn, checkEnd, currentActorId, makeActionLog, playerControlled, setMpCombatItems, clearMpCombatItems, rollInitiative } from './systems/combatEngine';
import { generateRaidBoss, generateBakalDungeon, generateAntonDungeon, generateVykasDungeon, type RaidBoss, type RaidDifficulty } from './systems/raidBoss';
import { generateRaidLoot, generateRaidReward } from './systems/raidLoot';
import { useSkillTree } from './store/skillTreeStore';
import { useSubProfTree, subProfMastery } from './store/subProfTreeStore';
import RaidDungeonReward from './components/RaidDungeonReward';
const RaidLootModal = lazy(() => import('./components/RaidLootModal'));
const CombatPanel = lazy(() => import('./components/CombatPanel'));
import WeatherFx from './components/WeatherFx';
import CommandPalette from './components/CommandPalette';
import { setAudioSettings, playSfx, setAmbient } from './systems/audio';
import { readingFontStack, LXGW_WENKAI_CSS } from './systems/readingFonts';
import { applyUiTheme } from './systems/uiThemes';
const CombatSetup = lazy(() => import('./components/CombatSetup'));
import { useTerritory, buildTerritorySystemPrompt, buildingCap } from './store/territoryStore';
import { useTeam, buildTeamSystemPrompt, memberCap as teamMemberCap } from './store/adventureTeamStore';
import { useCosmos, buildCosmosSystemPrompt, cosmosNameEq, cleanCosmosName } from './store/cosmosStore';
import { realmFromLevel, normalizeTier, lvFromRealm, computeMaxHp, computeMaxEp, effectiveResource, attrCapForTier, clampBaseAttrs, fullMaxHp, fullMaxEp, TIERS, realAttrMult, ratioOf } from './systems/derivedStats';
import { isHomeWorld, reconcileHomeWorld, reconcilePlayerVitals, playerMaxHp, playerMaxEp, syncPlayerVitalsMax, applyCombatResourceGains, resetCombatResources } from './systems/playerVitals';
import { bioInnate, tierVitalMult } from './systems/bioStrength';
import { generateNpcAttrs, resolveForm, generateLuck } from './systems/npcAttrGen';
import { useImageGen, effectiveEquipService } from './store/imageGenStore';
import { generateImage, buildPortraitPrompt, buildEquipPrompt, equippedForPrompt, shrinkDataUrl, abortAllImageGen } from './systems/imageGen';
import { genPortraitTags, genEquipTags, isTagService, genderToTag } from './systems/imageTags';
import { hydrateImages, initImageSync } from './systems/imageSync';
import { loadWb, saveWb } from './systems/wbDb';
import { apiDebugLog } from './systems/apiDebugLog';
import { processMacros, makeMacroCtx } from './systems/stMacros';
import { buildRuntimeVars } from './systems/runtimeVars';
import ApiPromptPanel, { type PromptPart } from './components/ApiPromptPanel';
const TerritoryPanel = lazy(() => import('./components/TerritoryPanel'));
const CosmosPanel = lazy(() => import('./components/CosmosPanel'));
const WorldCodexPanel = lazy(() => import('./components/WorldCodexPanel'));
const WikiPanel = lazy(() => import('./components/WikiPanel'));
const AdventureTeamPanel = lazy(() => import('./components/AdventureTeamPanel'));
import ImageViewer from './components/ImageViewer';
import { useImageViewer } from './store/imageViewerStore';
import ImageBusyToast from './components/ImageBusyToast';
import { useItems, extractItemPresetFromJson } from './store/itemStore';
import type { ItemPresetEntry } from './store/itemStore';
import { useComposer } from './store/composerStore';
import { usePlayer, buildPlayerSystemPrompt, extractPlayerPresetFromJson } from './store/playerStore';
import { useNpcEvo, extractNpcPresetFromJson } from './store/npcEvoStore';
import { useEntryJudge } from './store/entryJudgeStore';
import { useFaction } from './store/factionStore';
import { useFactionEvo, buildFactionSystemPrompt, buildFactionEntryPrompt, extractFactionPresetFromJson } from './store/factionEvoStore';
const FactionPanel = lazy(() => import('./components/FactionPanel'));
import { useTurnInsight } from './store/turnInsightStore';
const TurnInsightPanel = lazy(() => import('./components/TurnInsightPanel'));
import { useNpc, looksDead } from './store/npcStore';
import PartyPromoteDialog from './components/PartyPromoteDialog';
import { useCharacters, type MemoryEntry } from './store/characterStore';
import { useMemory } from './store/memoryStore';
import { useMisc, buildMiscSystemPrompt } from './store/miscStore';
import { useChannel, buildChannelSystemPrompt, CHANNEL_DEFS } from './store/channelStore';
import { estimateFairValue, priceVerdict, formatFairRange, VERDICT_LABEL } from './systems/itemPricing';
import { applyMiscCommands, serializeTasks, serializeEvents, extractTurnSummaries } from './systems/miscParser';
import { buildNarrativeHistory, NM_COMPILE_PROMPT, NM_INGEST_PROMPT } from './systems/narrativeMemory';
import { buildMemPool, loadAll as factVecLoadAll, ensureVectors as factVecEnsure, embedOne as factVecEmbedOne, search as factVecSearch } from './systems/factVec';
import { serializePlayerCard, serializeNpcCard, buildNpcCandidateTitles, buildPlayerSkillCandidates, buildPlayerItemCandidates, rankNpcsLocal, serializeFactionsSection, namesMentionedIn, NM_STRUCT_SELECT_PROMPT, type RecallLimits } from './systems/structuredRecall';
import { drainAllocNotices } from './systems/allocNotice';
const MiscPanel = lazy(() => import('./components/MiscPanel'));
const DicePanel = lazy(() => import('./components/DicePanel'));
const EnhancePanel = lazy(() => import('./components/EnhancePanel'));
const SkillUpgradePanel = lazy(() => import('./components/SkillUpgradePanel'));
const CasinoPanel = lazy(() => import('./components/CasinoPanel'));
const AbyssPanel = lazy(() => import('./components/AbyssPanel'));
import { ABYSS_BOON_GEN_RULE, ABYSS_SIN_GEN_RULE, ABYSS_AWAKEN_RULE, ABYSS_JUDGE_RULE, ABYSS_ENEMY_GEN_RULE } from './systems/abyssPrompts';
import { materializeBoons, panelToEnemies, type SinFlavor, type SinTemplate, type BoonGenContext, type AwakenFlavor, type JudgeFlavor, type AbyssUnit as AbyssEnemyUnit } from './systems/abyssEngine';
import { BOON_PRIM_LIST, BOON_SCHOOLS, type BoonCard as AbyssBoonCard } from './data/abyssData';
import { useCasino } from './store/casinoStore';
import { computeGladiatorOdds, type Gladiator, type GladiatorEval, type BattleRound, type GladiatorMatch } from './systems/casinoEngine';
import { type GachaReward } from './systems/casinoGacha';
import { buildBattleWbInjection } from './systems/casinoBattleWb';
const JoyPanel = lazy(() => import('./components/JoyPanel'));
import { useJoy, hydrateJoyWorldBooks } from './store/joyStore';
import { buildJoySystem, parseJoyReply, buildGreetPrompt } from './systems/joyGirls';
import { buildJoyWbInjection } from './systems/joyWorldBook';
const ArenaPanel = lazy(() => import('./components/ArenaPanel'));
import { useArena } from './store/arenaStore';
import { ladderBadge, rewardTierFor, REWARD_BANDS, streakBonusMul, pickInt as arenaPickInt, effectiveTier as arenaEffectiveTier, type ArenaDef as ArenaDefType, type LadderEntry as ArenaLadderEntry } from './systems/arena';
import { useEnhance } from './store/enhanceStore';
import { PITY_THRESHOLD, stageFromLevel, growthCoef } from './systems/enhanceEngine';
const ChannelPanel = lazy(() => import('./components/ChannelPanel'));
import type { DmHandlers } from './components/DmPanel';
const DmPanel = lazy(() => import('./components/DmPanel'));
const MultiplayerPanel = lazy(() => import('./components/MultiplayerPanel'));
const ChatRoomPanel = lazy(() => import('./components/ChatRoomPanel'));
const TradePanel = lazy(() => import('./components/TradePanel'));
const AssistPanel = lazy(() => import('./components/AssistPanel'));
const MonumentPanel = lazy(() => import('./components/MonumentPanel'));
import { useMp, type HiddenCondition } from './store/multiplayerStore';
import { mpClient } from './systems/mpClient';
import { buildPlayerSnapshot, buildPartyTurnText, buildWorldSnapshot, applyWorldSnapshot, buildPartyProfiles, mpNarrativeRule, purgeMpCharacters } from './systems/mpSnapshot';
import { onGiftResponse } from './systems/mpGift';
import { myPlayerId } from './systems/mpConfig';
import { useChatRoom } from './store/chatRoomStore';
import { chatClient } from './systems/chatClient';
import { discordLoggedIn as chatDiscordLoggedIn, chatReady, chatName, chatToken } from './systems/chatIdentity';
import GiftPrompt from './components/GiftPrompt';
const FriendsPanel = lazy(() => import('./components/FriendsPanel'));
const PartyPanel = lazy(() => import('./components/PartyPanel'));
const WorkshopPanel = lazy(() => import('./components/WorkshopPanel'));
import { retrieveNovel } from './systems/novelVec';
import { useDm, isDmableTag } from './store/dmStore';
import { useFanfic } from './store/fanficStore';
import { useFact } from './store/factStore';
import { settleDmDeal, normCur as dmNormCur } from './systems/dmTrade';
const SystemShop = lazy(() => import('./components/SystemShop'));
const SummaryPanel = lazy(() => import('./components/SummaryPanel'));
const SaveLoadPanel = lazy(() => import('./components/SaveLoadPanel'));
import { PENDING_STARTED_KEY, clearProgress, autoSaveSlot, saveSlot, loadSlot, UNDO_ID, undoPointHasChat, requestPersistentStorage } from './systems/saveManager';
import { restoreB1IfWiped } from './systems/b1Mirror';
import * as chatDb from './systems/chatDb';
import PlayerSidebar from './components/PlayerSidebar';
import StartScreen from './components/StartScreen';
import CharacterCreation, { type CreationData, formatCreationTalent } from './components/CharacterCreation';
const SettingsPanel = lazy(() => import('./components/SettingsPanel'));
import WorldSelector, { type WorldOption } from './components/WorldSelector';
import WorldCardView from './components/WorldCardView';
const BackpackModal = lazy(() => import('./components/BackpackModal'));
const EquipmentPanel = lazy(() => import('./components/EquipmentPanel'));
const CharacterPanel = lazy(() => import('./components/CharacterPanel'));
const TitlePanel = lazy(() => import('./components/TitlePanel'));
const AchievementPanel = lazy(() => import('./components/AchievementPanel'));
const SubProfessionPanel = lazy(() => import('./components/SubProfessionPanel'));
const SkillTreePanel = lazy(() => import('./components/SkillTreePanel'));
const NpcPanel = lazy(() => import('./components/NpcPanel'));
const NpcDetail = lazy(() => import('./components/NpcDetail'));
import OnScenePanel from './components/OnScenePanel';
import PlayerEquipPanel from './components/PlayerEquipPanel';
import ItemListPanel from './components/ItemListPanel';
import VersionToast from './components/VersionToast';
import { APP_VERSION, VERSION_NOTE } from './version';

const PENDING_REGEN_KEY = 'drpg-pending-regen';   // reload 后自动重发的输入（重新生成用）
const PENDING_REVAR_KEY = 'drpg-pending-revar';   // reload 后「仅重算变量」用：JSON {input,narrative}——复用本回合原正文重跑演化，不重新生成正文
interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  smallSummary?: string;   // 该楼层小总结（叙事记忆三档注入用）
  largeSummary?: string;   // 该楼层大总结
  images?: StoryImage[];   // 正文配图（按 anchor 插入楼层正文）
  choices?: string[];      // 剧情选项（正文后生成的 8 个主角行动选项，点击填入输入框）
  fanficNote?: string;     // 同人搜索内容（本楼涉及的已知作品角色设定，折叠展示）
  factNote?: string;       // 事实查证（本楼涉及的现实可查证元素核实结果，折叠展示）
  theaterHtml?: string;    // 小剧场：番外彩蛋 HTML（<xiaojuchang> 块内的内容，直接渲染在正文末尾）
}

// 首次启动自动载入内置世界书 + 各演化预设（仅当对应项为空才填，永不覆盖玩家已有数据）。
// 文件放 public/presets/，按需 fetch、不进 JS 包；某项 fetch 失败则下次启动重试（因仍为空）。
/* 激活预设解析：同 id/同名可能有多副本（补种 builtin 版 + wbDb hydrate 的玩家编辑版竞态共存）；
   优先返回「非 builtin（玩家编辑/固化过）」副本，否则取首个——修「游戏里改预设没用」（旧 .find 可能命中未编辑的 builtin 副本）。 */
function resolveActivePreset(ss: { textPresets: any[]; activeTextPresetId: string | null; activeTextPresetName?: string }): any {
  const list = ss.textPresets || [];
  const byId = ss.activeTextPresetId ? list.filter((p) => p && p.id === ss.activeTextPresetId) : [];
  if (byId.length) return byId.find((p) => !p.builtin) ?? byId[0];
  const byName = ss.activeTextPresetName ? list.filter((p) => p && p.name === ss.activeTextPresetName) : [];
  if (byName.length) return byName.find((p) => !p.builtin) ?? byName[0];
  return list[0];
}

/* 内置补种就绪信号：正文生成前 await，确保正文世界书/预设已从 public 加载完，杜绝「首条消息赶在加载前→偶发没世界书注入」。
   8s 安全兜底：万一某 fetch 卡死也不永久阻塞生成。 */
let _resolveBuiltins: (() => void) | null = null;
const builtinsReady: Promise<void> = new Promise((r) => { _resolveBuiltins = r; });
function markBuiltinsReady() { if (_resolveBuiltins) { _resolveBuiltins(); _resolveBuiltins = null; } }
setTimeout(markBuiltinsReady, 8000);

async function loadBuiltinDefaults() {
  const base = import.meta.env.BASE_URL || '/';
  const grab = async (f: string): Promise<string | null> => {
    try { const r = await fetch(base + 'presets/' + f); return r.ok ? await r.text() : null; } catch { return null; }
  };
  try {
    // 一次性迁移：清掉早期误放进「世界选择」(worldBooks) 的正文世界书（它们属于正文 textWorldBooks，不该出现在选择世界里）
    try {
      if (!localStorage.getItem('zs-worldsel-cleaned-v1')) {
        const bad = ['轮回乐园世界书', 'ST模块化输出·铁律', 'ST模块化输出', '轮回乐园小说'];
        const wb0 = useSettings.getState().worldBooks ?? [];
        const wb1 = wb0.filter((b) => !bad.includes(b.name));
        if (wb1.length !== wb0.length) useSettings.setState({ worldBooks: wb1 } as any);
        localStorage.setItem('zs-worldsel-cleaned-v1', '1');
      }
    } catch { /* */ }
    // 世界选择世界书 → worldBooks（仅「选择世界」功能读取）；**每次启动强制覆盖成内置最新**：
    // 按 builtinKey 先删掉旧的(含玩家改过、已转正为 builtin:false 但仍保留 builtinKey 的副本)，再导入最新内置。
    // 仅在 fetch 成功时才替换，失败保留现有，避免断网把世界书清空。
    { const overwriteWb = (json: string | null, name: string, key: string) => {
        if (!json) return;
        useSettings.setState((s) => ({ worldBooks: (s.worldBooks ?? []).filter((b: any) => b.builtinKey !== key) }));
        useSettings.getState().importWorldBook(json, name, true, key);
      };
      overwriteWb(await grab('worldgen.json'), '世界选择', 'wb-worldsel');
      overwriteWb(await grab('leisure.json'),  '休闲世界', 'wb-leisure');   // 休闲/恋爱世界：同属「世界选择」世界书
    }
    // 正文世界书 → textWorldBooks（正文生成读取）；内置 ST模块化·铁律 + 轮回乐园小说 + 性爱姿势 + BDSM（______.json 不内置）。
    //   性爱姿势/BDSM 两本已转纯绿灯（constant 全 false）：仅关键词命中才注入，不污染日常正文；配套 WorldSelector 的🤸姿势/⛓BDSM快捷按钮按书名定位取条目标题。
    // 逐本按 builtinKey 判重：缺哪本补哪本（各自从 public 取最新）。旧的"整类非空即跳过"会在用户改/导入其中一本后，
    // 把其余未改的内置一并丢弃；改用 per-key 后，编辑某本转正持久化、未改的兄弟仍每次刷新重载。
    // **每次启动强制覆盖成内置最新**（含玩家改过的）：按 builtinKey 先删旧再导入最新；fetch 失败则保留现有。
    { const overwriteTwb = (json: string | null, name: string, key: string) => {
        if (!json) return;
        useSettings.setState((s) => ({ textWorldBooks: (s.textWorldBooks ?? []).filter((b: any) => b.builtinKey !== key) }));
        useSettings.getState().importTextWorldBook(json, name, true, key);
      };
      // 并发取五本（而非逐本 await）：取回后连续 apply，把「正文世界书尚未就绪」的竞态窗口压到最小（修偶发没世界书）。
      const [twMod, twNovel, twPose, twBdsm, twPower, twMisc] = await Promise.all([
        grab('modular-output.json'), grab('novel.json'), grab('pose.json'), grab('bdsm.json'), grab('power-codex.json'), grab('misc-codex.json'),
      ]);
      overwriteTwb(twMod,   'ST模块化输出·铁律', 'twb-modular');
      overwriteTwb(twNovel, '轮回乐园小说',     'twb-novel');
      overwriteTwb(twPose,  '性爱姿势·小鸟游六花', 'twb-pose');
      overwriteTwb(twBdsm,  'BDSM·调教束缚·S15',   'twb-bdsm');
      // 阶位·生物强度战力图鉴：登场判断专用参照系（buildEntryPhaseSystemPrompt 强制全量注入）；条目全为无关键词绿灯，正文默认不注入、不污染日常。
      overwriteTwb(twPower, '阶位·生物强度战力图鉴', 'twb-power');
      // 杂项演化·任务与世界规范图鉴：杂项演化阶段专用参照系（runMiscEvolutionPhase 强制全量注入）；条目全为无关键词绿灯，正文默认不注入、不污染日常。
      overwriteTwb(twMisc,  '杂项演化·任务与世界规范图鉴', 'twb-misc');
      // （已移除世界书自动去重：玩家手动导入的世界书一律不强制删——哪怕与内置同名/重复也保留；要去重请玩家自己在设置里删。）
    }
    // 双人成行内置已移除(2026-06-18)：不再自动加载/激活任何默认正文预设；新用户开局走最简兜底，自行去预设列表选（轮回乐园两份已内置但默认关闭）。
    // 轮回乐园特化预设(Claude/Gemini)→ 内置补种：按名判重(不覆盖玩家上传/已有预设)、默认不激活(activate=false)；玩家若编辑过(转非 builtin 入库、同名已在)则不再补
    {
      const has = (n: string) => useSettings.getState().textPresets.some((p) => p.name === n);
      if (!has('轮回乐园·Claude')) { const c = await grab('zhushen-claude.json'); if (c) useSettings.getState().importTextPreset(c, '轮回乐园·Claude', true, false); }
      if (!has('轮回乐园·Gemini')) { const g = await grab('zhushen-gemini.json'); if (g) useSettings.getState().importTextPreset(g, '轮回乐园·Gemini', true, false); }
      if (!has('轮回乐园·DeepSeek')) { const d = await grab('zhushen-deepseek.json'); if (d) useSettings.getState().importTextPreset(d, '轮回乐园·DeepSeek', true, false); }
      if (!has('双人成行 V7.1—长风渡')) { const sc = await grab('shuangren-changfeng.json'); if (sc) useSettings.getState().importTextPreset(sc, '双人成行 V7.1—长风渡', true, false); }
    }
    // 自动去重（仅清内置补种自身的重复，绝不碰玩家的预设）：玩家导入/编辑/激活固化过的(非 builtin)一律保留；
    //   只删「多余的同名 builtin」——同名 builtin 留一个、其余删；某 builtin 若已有同名的非 builtin(玩家版) 则该 builtin 多余、删（玩家版优先）。
    try {
      // 去重「按出现顺序保留第一个」：内置预设现用稳定 id(builtin:<名>)，StrictMode 双跑会产出同 id 副本，
      // 旧版收集「要删的 id」再 filter 会把同 id 的全部删掉（含该留的那个）→ textPresets 被清空；改成重建保留首个。
      const _list = useSettings.getState().textPresets as any[];
      const _nonBuiltinNames = new Set(_list.filter((x) => !x.builtin).map((x) => x.name));
      const _seenBuiltin = new Set<string>();
      const _kept: any[] = [];
      for (const x of _list) {
        if (!x.builtin) { _kept.push(x); continue; }
        if (_nonBuiltinNames.has(x.name) || _seenBuiltin.has(x.name)) continue;   // 同名有玩家版/已留过内置 → 丢弃多余
        _seenBuiltin.add(x.name);
        _kept.push(x);
      }
      if (_kept.length !== _list.length) useSettings.setState({ textPresets: _kept });
    } catch { /* */ }
    // 四个演化预设（主角/物品/NPC/势力）→ **每次启动强制覆盖成内置最新**（按要求：玩家对这些预设的改动不保留，始终以内置为准）。
    // 仅当 fetch+解析成功才覆盖；失败则保留现有，避免断网把预设清空。setPresetEntries 只换 entries/名称/版本，保留各自的 API 路由配置。
    { const t = await grab('player.json'); const p = t ? extractPlayerPresetFromJson(t) : null;
      if (p) usePlayer.getState().setPresetEntries(p.entries, p.name, p.version); }
    { const t = await grab('item.json'); const p = t ? extractItemPresetFromJson(t) : null;
      if (p) useItems.getState().setPresetEntries(p.entries, p.name, p.version); }
    { const t = await grab('npc.json'); const p = t ? extractNpcPresetFromJson(t) : null;
      // NPC 演化只取「重点演化」条目；登场判断条目(entrySharedRules)已分割到独立的「登场判断」模块(entryJudge)。
      if (p) useNpcEvo.getState().setPresetEntries(p.entries.filter((e) => e.source !== 'entrySharedRules'), p.name, p.version); }
    { const t = await grab('entry-judge.json'); const p = t ? extractNpcPresetFromJson(t) : null;   // 登场判断·独立预设
      if (p) useEntryJudge.getState().setPresetEntries(p.entries, p.name, p.version); }
    { const t = await grab('faction.json'); const p = t ? extractFactionPresetFromJson(t) : null;
      if (p) useFactionEvo.getState().setPresetEntries(p.entries, p.name, p.version); }
  } catch (e) { console.warn('[内置预设] 载入失败', e); }
}



/* ─── 物品管理阶段：构建注入 system prompt（替换模板变量）─── */
function buildItemPhaseSystemPrompt(entries: ItemPresetEntry[], narrative: string): string {
  const { items, currency } = useItems.getState();
  const { player } = useGame.getState();

  // 背包清单
  const inventoryText = items.length > 0
    ? items.map((it) =>
        `[${it.id}] ${it.name}（${it.category}${it.gradeDesc ? '·' + it.gradeDesc : ''}）×${it.quantity}` +
        (it.equipped ? `【已装备:${it.equipSlot ?? ''}】` : '') +
        (it.effect ? `  ${it.effect}` : '')
      ).join('\n')
    : '（背包为空）';

  // 装备槽
  const equippedItems = items.filter((it) => it.equipped);
  const equipmentText = equippedItems.length > 0
    ? equippedItems.map((it) => `${it.equipSlot ?? '未知槽位'}: ${it.name} [${it.id}]`).join('\n')
    : '（未装备任何物品）';

  // 货币
  const ssText = `乐园币:${currency.乐园币} 灵魂钱币:${currency.灵魂钱币}`;

  // 下一个可用物品 ID
  const maxId = items.reduce((m, it) => Math.max(m, parseInt(it.id.replace(/^I_B1_/, '')) || 0), 0);
  const nextItemId = `I_B1_${String(maxId + 1).padStart(2, '0')}`;

  // NPC 角色注册表（让物品管理阶段把装备挂到已存在的 NPC ID 上，而非新建）
  const npcRecords = Object.values(useNpc.getState().npcs);
  const npcExistingIds = ['B1（玩家）', ...npcRecords.map((r) => `${r.id}(${r.name})${r.onScene ? '·在场' : '·离场'}`)].join(', ');
  const npcCNums = npcRecords.map((r) => r.id.match(/^C(\d+)$/)?.[1]).filter(Boolean).map(Number);
  const npcNextId = `C${npcCNums.length > 0 ? Math.max(...npcCNums) + 1 : 1}`;
  const npcOnscreenText = npcRecords.filter((r) => r.onScene && !r.isDead).length > 0
    ? npcRecords.filter((r) => r.onScene && !r.isDead).map((r) => `[${r.id}] ${r.name} 阶位:${r.realm || '未知'}`).join('\n')
    : '（无在场NPC）';
  // 已持有的 NPC 物品清单（带真实ID + 持有者）——让物品阶段勿对已存在的 NPC 物品重复 createItem。
  // 纳入「在场 NPC」+「随行的随从/宠物（即便离场也跟着主角走）」：否则离场随从的持有物对物品阶段隐身，
  // 会被重复 createItem / updateItem·destroyItem 匹配不到（口径与综合对账阶段一致）。离场随行者标注「·随行(离场)」。
  const npcItemHolders = npcRecords.filter((r) => !r.isDead && (r.onScene || r.npcTag === '随从' || r.npcTag === '宠物'));
  const npcItemsList = npcItemHolders
    .flatMap((r) => (r.items ?? []).map((it) =>
      `[${it.id}] ${it.name}（${it.category}${it.gradeDesc ? '·' + it.gradeDesc : ''}）×${it.quantity}${it.equipped ? '【已装备】' : ''} —— 持有者 ${r.id}(${r.name || r.id})${r.onScene ? '' : '·随行(离场)'}`));
  const npcItemsText = npcItemsList.length > 0 ? npcItemsList.join('\n') : '（无在场NPC持有物）';

  // 玩家基本状态
  const _pMaxHp = playerMaxHp(), _pMaxEp = playerMaxEp();   // 真实上限：六维 + 装备 + 被动/天赋上限加成，让演化 AI 看到的也是真实值
  const playerSnapshot = `B1 玩家 HP:${effectiveResource(player.hp, player.maxHp, _pMaxHp)}/${_pMaxHp} EP:${effectiveResource(player.mp, player.maxMp, _pMaxEp)}/${_pMaxEp} SAN:${player.san}/${player.maxSan} ATK:${player.atk} DEF:${player.def} 积分:${player.points}`;

  const vars: Record<string, string> = {
    story_text:             narrative,
    user_input:             '',
    player_items:           inventoryText,
    npc_items:              npcItemsText,
    owner_items:            inventoryText,
    character_items:        inventoryText,
    player_equipment:       equipmentText,
    character_snapshot:     playerSnapshot,
    spirit_stones:          ssText,
    next_available_item_id: nextItemId,
    // NPC 角色注册表（让物品管理阶段复用正确的 NPC ID，避免把装备挂到新 ID 上）
    existing_character_ids: npcExistingIds,
    next_available_npc_id:  npcNextId,
    onscreen_characters:    npcOnscreenText,
    offscreen_biographies:  '',
    beasts_summary:         '',
    focus_list:             '',
    world_factors:          '',
    world_map_pois:         '',
    current_time:           '',
    current_location:       '',
  };

  return entries
    .filter((e) => e.enabled)
    .map((e) => {
      let content = e.content;
      for (const [k, v] of Object.entries(vars)) {
        // 同时替换 ${key} 和 {{key}} 两种格式
        content = content.replace(new RegExp(`\\$\\{${k}\\}`, 'g'), v);
        content = content.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
      }
      return content;
    })
    .join('\n\n');
}

/* ════════════════════════════════════════════
   各演化阶段「强制铁则」补丁（代码注入，独立于导入的预设，始终生效）
   解决：① 所有演化必须优先逐条参照正文、不遗漏；正文没有的再自行补全
        ② BUFF 也算当前状态  ③ 副职业中文且仅正文显式  ④ NPC 年龄
        ⑤ 势力所处世界  ⑥ 物品固定格式 + 武器杀敌数
════════════════════════════════════════════ */
function parseChoices(raw: string): string[] {
  const m = raw.match(/<choices>([\s\S]*?)<\/choices>/i);
  const body = m ? m[1] : raw;
  // 逐行扫描：遇到 A~H 标记起一个选项；后续不带标记的行并入当前选项（支持长/多行选项），
  // 遇到看似标签行（以 < 开头）则停止并入，避免把别的标签块吞进选项。
  const items: { L: string; text: string }[] = [];
  let cur: { L: string; text: string } | null = null;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    const lm = /^[\s>*\-—·]*([A-Ha-h])\s*[.、:：)）]\s*(.*)$/.exec(line);
    if (lm) {
      cur = { L: lm[1].toUpperCase(), text: lm[2].trim() };
      items.push(cur);
    } else if (cur && line && !/^</.test(line)) {
      cur.text += (cur.text ? ' ' : '') + line;   // 续行并入当前选项
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const t = it.text.trim();
    if (t && !seen.has(it.L)) { seen.add(it.L); out.push(t); }
  }
  return out.slice(0, 8);
}

/* 解析 <details> 同人搜索块 → 折叠展示文本 + 结构化条目（可多角色）*/
function parseFanficDetails(raw: string): { note: string; entries: Omit<import('./store/fanficStore').FanficEntry, 'updatedAt'>[] } | null {
  const blocks = [...raw.matchAll(/<details>([\s\S]*?)<\/details>/gi)].map((x) => x[1]);
  if (blocks.length === 0) return null;
  const notes: string[] = [];
  const entries: Omit<import('./store/fanficStore').FanficEntry, 'updatedAt'>[] = [];
  const field = (text: string, re: RegExp) => { const m = text.match(re); return m ? m[1].trim().replace(/^（填）$/, '') : ''; };
  for (const b of blocks) {
    if (/事实查证/.test(b)) continue;   // 事实查证块归 parseFactCheck，别混进同人
    const inner = b.replace(/<\/?summary>/gi, '').replace(/^同人搜索内容\s*/m, '').trim();
    if (!inner) continue;
    const work = field(inner, /角色所属作品[：:]\s*(.+)/);
    const nameAlias = field(inner, /角色名[\/／]?别名[：:]\s*(.+)/);
    const keySettings = field(inner, /(?:本轮参考的)?关键设定[：:]\s*(.+)/);
    const background = field(inner, /(?:补充的)?背景信息[：:]\s*(.+)/);
    if (!work && !nameAlias && !keySettings && !background) continue;   // 空壳跳过
    notes.push(inner);
    let name = nameAlias, aliases = '';
    const sp = nameAlias.split(/\s*[\/／、,，]\s*/).filter(Boolean);
    if (sp.length > 1) { name = sp[0]; aliases = sp.slice(1).join('、'); }
    if (name || work) entries.push({ name: name || work, work, aliases, keySettings, background });
  }
  if (notes.length === 0) return null;
  return { note: notes.join('\n\n'), entries };
}

// 事实增强（核实正文里的现实可查证元素 → 锁定时代/事实锚点 → 下回合注入防穿帮）。
const FACT_RULE = `<事实增强>
剧情涉及现实可查证元素时，必须确保准确，不确定时**主动联网搜索核实**，优先采用最新/权威信息：
· 历史事件的年份、经过；特定年代的社会风貌与科技水平；历史人物的事迹。
· 真实地名、街道、店铺、地标的名称与位置；建筑外观与布局。
· 商品/各类物品的品牌、型号、价格区间须符合时代；车辆的品牌车型与发售年份。
· 职业行为、法律制度、医学、军事等专业内容的准确性。
规则：可查证的事实**不得臆造**；无法确定时**宁可模糊、不可编造**；故事设定与现实矛盾时**以设定为准**；信息自然融入叙事，禁止百科罗列。
【事实查证】核对当前场景、物品与事件逻辑，确保其 100% 贴合当前时代，不引入任何违和感。
【输出格式】**仅当本轮正文涉及可查证的现实元素时**输出下面这个块（不涉及则完全省略、不要输出空块、不要写"无"）：
【字数硬要求】**「本轮可查证元素」一栏不少于 200 字（中文）**——逐条把元素核实清楚、写具体（给出准确年份/型号/位置/价格区间等，并说明应为何状、有误处如何修正），不要敷衍成一两条。
<details><summary>事实查证</summary>
本轮可查证元素：（逐条"元素 → 核实结论/应为…"；有误的标出修正；详尽展开，合计≥200字）
需锁定的时代/事实锚点：（几条简短事实，每条一句、用；分隔，供后续剧情保持一致；无则写 —）
</details>`;

/* 解析 <details> 事实查证块 → 折叠展示文本 + 需锁定的事实锚点（供下回合注入）*/
function parseFactCheck(raw: string): { note: string; anchors: string[] } | null {
  const blocks = [...raw.matchAll(/<details>([\s\S]*?)<\/details>/gi)].map((x) => x[1]);
  for (const b of blocks) {
    if (!/事实查证/.test(b)) continue;   // 只认事实查证块
    const inner = b.replace(/<\/?summary>/gi, '').replace(/^事实查证\s*/m, '').trim();
    if (!inner) continue;
    const am = inner.match(/锚点[：:]\s*([\s\S]*)$/);
    const anchors = (am ? am[1] : '')
      .split(/[\n；;]+/).map((s) => s.replace(/^[-·•\s]+/, '').trim())
      .filter((s) => s && s !== '—' && s !== '无' && s.length > 1);
    return { note: inner, anchors };
  }
  return null;
}

/* 解析 <xiaojuchang> 小剧场块 → 返回内部 HTML（番外彩蛋，含 <details> + 内联 CSS，直接渲染）。
   兼容多个并列 <xiaojuchang> 块（拼接）、被 ```html 围栏包裹、以及只给裸 <details> 不带外层标签的情况。*/
function parseTheater(raw: string): string | null {
  if (!raw) return null;
  const blocks = [...raw.matchAll(/<xiaojuchang>([\s\S]*?)<\/xiaojuchang>/gi)].map((x) => x[1].trim()).filter(Boolean);
  let html = blocks.join('\n');
  if (!html) {
    // 容错：AI 漏了外层标签，但给了番外用的 <details> 折叠块 → 直接收下
    const det = [...raw.matchAll(/<details>[\s\S]*?<\/details>/gi)].map((x) => x[0]);
    if (det.length) html = det.join('\n');
  }
  html = html.replace(/```[a-z]*\s*/gi, '').replace(/```/g, '').trim();   // 剥 markdown 围栏
  return html || null;
}

/* ── 小剧场取材：轮回 wiki「人物条目」（public/lunhui-characters.json，由 vite 插件 build-lunhui-characters 生成）── */
type LunhuiChar = { name: string; world: string; content: string };
let _lunhuiCharsCache: LunhuiChar[] | null = null;
async function loadLunhuiCharacters(): Promise<LunhuiChar[]> {
  if (_lunhuiCharsCache) return _lunhuiCharsCache;
  try {
    const base = import.meta.env.BASE_URL || '/';
    const r = await fetch(base + 'lunhui-characters.json');
    if (r.ok) { const data = await r.json(); _lunhuiCharsCache = Array.isArray(data) ? data : []; return _lunhuiCharsCache; }
  } catch { /* 取材失败 → 小剧场无档案，静默降级 */ }
  _lunhuiCharsCache = [];
  return _lunhuiCharsCache;
}
/* 随机挑 1~多位：1 位最常见，偶尔 2~4 位；多位时取自同一「世界」分组（彼此有关联）。*/
function pickTheaterCharacters(all: LunhuiChar[]): LunhuiChar[] {
  if (!all.length) return [];
  const r = Math.random();
  let count = r < 0.45 ? 1 : r < 0.8 ? 2 : r < 0.95 ? 3 : 4;
  if (count === 1) return [all[Math.floor(Math.random() * all.length)]];
  const byWorld = new Map<string, LunhuiChar[]>();
  for (const c of all) { const w = c.world || '未分组'; (byWorld.get(w) ?? byWorld.set(w, []).get(w)!).push(c); }
  const eligible = [...byWorld.values()].filter((g) => g.length >= 2);
  if (!eligible.length) return [all[Math.floor(Math.random() * all.length)]];
  const group = eligible[Math.floor(Math.random() * eligible.length)];
  count = Math.min(count, group.length);
  const pool = [...group]; const out: LunhuiChar[] = [];
  for (let k = 0; k < count; k++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}
/* 把抽到的人物档案拼成注入块（追加在 MINI_THEATER_RULE 之后的 system 段）。*/
function buildTheaterCharBlock(picked: LunhuiChar[]): string {
  const head = picked.length > 1
    ? `本次抽到 ${picked.length} 位人物（同属「${picked[0].world || '同一世界'}」、彼此存在关联）——写他们之间的互动小剧场`
    : `本次抽到 1 位人物——写他/她的个人日常小剧场`;
  const body = picked.map((c, i) => `── 人物档案 ${i + 1}：${c.name}（所属：${c.world || '未分组'}）──\n${c.content}`).join('\n\n');
  return `【本次小剧场·人物档案（只读取这些档案的信息，不要引入其它人物 / 设定 / 主线剧情）】\n${head}。\n\n${body}`;
}

const STATUS_FORMAT_RULE = `
【当前状态·固定格式铁则（主角+NPC）】「当前状态/Buff」(列4 / character.<id>.status) 必须按**固定格式**输出，供前端解析成状态胶囊：
- 每个状态写 \`状态名:Emoji(效果|激活条件|结束条件|来源)\`，**多个状态之间用中文分号 ；分隔**。
- 例：\`受伤:🩸(每回合-5HP|战斗中受创|休息或治疗后|被抓伤)；疲惫:😮‍💨(行动效率-20%|连续奔逃|充分休息后|长时间逃命)\`。
- 括号内四段用半角竖线 | 分隔，顺序固定为「效果|激活|结束|来源」；某段不详可留空但保留 |。状态名后紧跟一个 Emoji（半角冒号 : 连接）。
- **「结束条件」段若写持续回合数，必须与正文写明的回合数一致**：正文说该效果持续 3 回合，这里就写「持续3回合」，**不得另给 15 回合之类不一样的数字**，更不得把"每秒×N回合"按秒折算放大（回合是最小单位，只数回合）。
- **不要把当前状态写成整段自由文本/句子**，必须严格按上述结构，否则前端解析不出胶囊。没有任何状态时写「一切正常」或留空，不要编造。`;

const NPC_PRIVATE_EXTRA_RULE = `
【私密信息·物种前置硬门槛（最高优先，先判这条再谈其它）】所有私密信息——既包括下面这些命名字段（淫纹/解锁服装/独特技巧/性爱姿势/开发玩法），也包括性相关列（8性经验/17表性癖/18里性癖/20敏感部位/21性器状态/22情欲值/23快感值/24性观念）——**只适用于"人类或具人形人格的拟人化智慧种族"**：人类，以及猫女/兽娘/兽人/龙娘/精灵/魅魔/妖女等**有人形、有人格心智**的角色。**普通动物·野兽·宠物·坐骑·灵兽、以及无拟人化人形的魔物（如母猫、猎犬、灵猴、妖兽坐骑）一律不写任何私密信息**（命名字段与性相关列全部留空），即使其性别被标成「女/母」也不写。判据是"有没有人形人格"，**不是**看性别。例：母猫=不写；猫女=按下方规则照常维护。**本门槛凌驾预设中任何"不得遗漏此列／必须生成此列"之类措辞**：对非人形动物，性相关列即便预设要求"不得遗漏"，也一律留空、不得填写。
【女性 NPC 私密补充字段·铁则】**仅当目标是女性 NPC（第1列性别=女）、是上述"人形角色"、且本轮正文确有性接触/身体开发剧情时**才维护以下命名字段；无相关剧情、男性 NPC、或非人形的动物一律不写、留空。用 add("<id>",{...}) 写入（会展示在「私密信息」面板）：
- 淫纹：印刻在该女性**小腹**上的纹路，**每个女性随其性格与经历各不相同**，会随着被征服与开发的程度逐步浮现/演变（尚未开发可写「未显现」）。需描述纹路形态并与其性格/经历呼应。
- 解锁服装：该女性**已在性爱过程中穿过**的服装，分号分隔、**去重累积**（如「校服；护士服；婚纱」）。
- 独特技巧：属于该女性的**独特榨精技巧**——结合她的性格/身份/特点**发挥想象原创**（禁止套模板照抄），每次性爱后精进（可附熟练度/进化）。
- 性爱姿势：记录**已掌握**的体位（传教士/观音坐莲/后入/骑乘等），每次性爱把本轮新掌握的并入、**合并类似姿势**；下列仅参考，禁止不经思考照抄。
- 开发玩法：该女性被主角**开发过**的玩法，分号分隔累积。**参考库（仅供参考、禁止无脑照抄，按实际剧情思考选用）**：阿黑颜；性玩具[假阳具/口球/跳蛋/炮机/尿道塞/乳夹/阴蒂夹/肛塞/肛珠/肛勾/振动棒/圆头按摩棒/眼罩/手足枷/口衔]；装置[十字架/反省板/三角木马/拘束推车]；捆绑[后手反捆/龟甲缚/M字开腿缚/高抬腿缚/片足上吊缚]。
铁则：①只对女性 NPC、且正文有相应剧情才写；②**累积式更新**，不要每轮清空重来；无新进展则不输出这些字段；③参考库只是清单，必须结合角色与剧情思考，禁止照抄堆砌；④**【强制】本轮正文只要发生了**人形**女性的性行为（性接触/插入/口交/调教/被开发等；非人形的动物/野兽/宠物不适用），事后必须把该女性的全部私密条目逐项更新或新增——既包括上面这些命名字段，也包括性相关列（8性经验/17表性癖/18里性癖/20敏感部位/21性器状态/22情欲值/23快感值/24性观念），一项都不能漏；情欲值/快感值给具体数值，独特技巧/性爱姿势/开发玩法按本轮新进展累积。`;

const NPC_TIER_LOADOUT_RULE = `
【NPC 配置·档位强制表（生物强度档 T0~T9·建档基准）】给某 NPC 生成或补全「技能 / 天赋 / 储存空间物品」时，**数量与品级必须落在其档位区间内**。档位看该 NPC 的阶位＋战力定位：杂兵/平民≈T0–T1、精英/老兵≈T2、勇士/头目/小Boss≈T3、英雄/首领/主将≈T4、领主/魔将/Boss≈T5、王者/霸主/宗师≈T6、半神≈T7、真神≈T8、源初/神话/主神≈T9。
| 档 | 技能数 | 天赋数 | 物品数 | 技能品级(封顶) | 天赋品级(封顶) | 物品品级(封顶) |
|----|----|----|----|----|----|----|
| T0 杂鱼 | 1–2 | 0–1 | 0–2 | 普通 | D | 白色~绿色 |
| T1 兵卒 | 1–3 | 0–1 | 0–2 | 普通~精良 | D~C | 白色~蓝色 |
| T2 精英 | 2–3 | 1–2 | 1–3 | 精良~稀有 | C~B | 绿色~蓝色 |
| T3 勇士 | 2–4 | 1–2 | 1–3 | 稀有~史诗 | C~B | 蓝色~紫色 |
| T4 英雄 | 6–8 | 2–6 | 4–8 | 史诗 | B~A | 紫色~暗紫色 |
| T5 领主 | 6–10 | 4–6 | 4–8 | 史诗~传说 | A~S | 暗紫色~淡金 |
| T6 王者 | 8–10 | 4–6 | 4–10 | 传说~奥义 | S~SS | 金色~暗金 |
| T7 半神 | 8–12 | 4–8 | 6–10 | 奥义 | SS | 暗金~传说级 |
| T8 真神 | 10–14 | 6–8 | 6–12 | 奥义~极境 | SS~SSS | 史诗级~不朽级 |
| T9 源初 | 10–16 | 6–10 | 6–12 | 极境 | SSS | 圣灵级~创世 |
（注：T4 起数量较 T3 翻倍，对应"英雄级及以上"。）
铁则：
① **品级是封顶不是保底**：可低于封顶，**严禁越级**——低档 NPC 绝不能持有超出其档位的技能/天赋/物品品级（杜绝"杂兵爆神装/极境技能"）。三套品级阶梯：技能7档 普通<精良<稀有<史诗<传说<奥义<极境；天赋7档 D<C<B<A<S<SS<SSS；物品15档 白色<绿色<蓝色<紫色<暗紫色<淡金<金色<暗金<传说级<史诗级<圣灵级<不朽级<起源级<永恒级<创世。
② **数量是建档基准、非终身死锁**：剧情确有「觉醒/夺宝/传承/融合」等明确证据时，可再用 add 突破区间（与天赋解除上限规则共存）；无证据则按区间配齐、不要为凑数硬堆。
③ **形态修正**：野兽/虫群/无智(纯本能)形态——储存物品数=0(无背包携带)、技能取下限且多为天生本能、天赋0–1；凡人/平民——0 战斗技能、0 天赋、物品仅限白色~绿色的生活杂物。
④ **HP/EP 上限由前端按档位机械计算（体质×20 / 智力×15 再乘档位倍率，T4起翻倍），你写的 maxHp/maxMp 会被前端重算覆盖、不必纠结其数值**；你只需把六维、技能、天赋、物品按上表配齐。
⑤ **每一条都要按固定格式逐项填全·严禁偷懒只给名字**：凡新增的技能/天赋/物品（无论是首次建档还是后续给已有 NPC 新增的），**必须一次性把固定格式的每个字段都填上**，不得只写一个名字、不得留空、不得"以后再补"——
　· 技能（add skill）：名称｜等级｜类型(主动/被动/奥义/光环/领域…)｜品级(技能7档之一)｜消耗｜目标(单体/群体/自身/范围)｜效果｜伤害(数值化)｜层级｜属性加成｜描述｜标签，逐项填全。
　· 天赋（addTalent）：名称｜等级｜品级(D~SSS)｜来源(觉醒/血脉传承/顿悟…)｜效果｜属性加成｜描述，逐项填全。
　· 物品（createItem/储存空间）：名称｜数量｜品质(物品15档之一)｜类型(大类+细分)｜攻击力或防御力｜属性加成｜评分｜词缀｜效果｜描述｜外观｜获取途径，逐项填全（同【物品固定格式铁则】，评分/品级/grade 三者自洽）。
　名称、效果、描述都要贴合该 NPC 的身份/世界观与其所在档位的品级，**禁止占位式糊弄**（如"技能一""强力一击""神秘物品""效果待定"）。宁可少给一条，也不要给一条只有名字的空壳。`;

const SKILL_TALENT_ATTR_CAP_RULE = `
【技能/天赋·属性加成数值上限·铁则（最高优先，禁止越级·禁止迂回）】凡 add skill / addTalent 写出的 attrBonus（含六维直加与百分比加成），**单项数值、百分比、加成项数、累计总值四项任何一项都不得越过下表上限**——这套限制凌驾任何"剧情强大"的措辞：

【天赋·D~SSS】
| 评级 | 单项·六维+N | 单项·百分比 | 项数 | 累计加成总值 |
| 负面 | -3 ~ -1     | -10% ~ -5%  | 1-2  | 净 ≤ 0       |
| D    | +1          | +2%         | 1    | +1           |
| C    | +2          | +3%         | 1    | +3           |
| B    | +4          | +5%         | 2    | +6           |
| A    | +6          | +8%         | 2    | +10          |
| S    | +10         | +12%        | 3    | +18          |
| SS   | +15         | +18%        | 3    | +28          |
| SSS  | +25         | +25%        | 4    | +45          |

【技能·7档（仅被动/光环/领域/烙印等常驻类技能才有 attrBonus；主动技能的威力用 damage 字段表达，不挤进 attrBonus）】
| 品级 | 单项·六维+N | 单项·百分比 | 项数 | 累计加成总值 |
| 普通 | 0           | 0           | 0    | 0            |
| 精良 | +1          | +2%         | 1    | +1           |
| 稀有 | +2          | +3%         | 1    | +2           |
| 史诗 | +3          | +5%         | 2    | +4           |
| 传说 | +5          | +8%         | 2    | +8           |
| 奥义 | +8          | +12%        | 3    | +14          |
| 极境 | +15         | +20%        | 3    | +25          |

铁则：
① **四项任一超限即不合格**：单项数值 / 单项百分比 / 项数 / 累计总值——必须全部 ≤ 表上限。例：A 级天赋写「力+10、体+5」累计 +15 已超 +10，违规；改成「力+4、体+4」累计 +8 才合规。
② **百分比加成清单**（受 % 列约束）：暴击+% / 闪避+% / 物攻+% / 法攻+% / 法强+% / 各系抗性+% / HP 上限+% / EP 上限+% / 一切「+X%」字段，全部按品级上限钳制。
③ **damage 与 attrBonus 不串台**：技能的"攻击+200%""法伤+150%"等**威力公式**写进 damage 字段（不受本表约束），不要写到 attrBonus 当六维/百分比加成。
④ **禁止迂回**：禁止把数值加成藏进 effect 文本（如 effect 里写"实际增加力量 30"）绕开表上限——effect 只描述**效果概念/触发方式**，**所有数值加成只能写在 attrBonus 字段里**并受本表约束。
⑤ **档位与品级仍叠加**：高品级技能/天赋本身仍受【NPC 配置·档位强制表】的"品级封顶"约束——本表只是品级**已定**后的数值天花板。
⑥ **对账纠错（一次性·别做成每轮 churn）**：发现某技能/天赋的 attrBonus **确实越过**表上限时，才用同名 add skill / addTalent 把**超出的那部分**数值收敛到上限内（**只压超限数值，名称/效果文案/层数原样保留**）。**这是一次性修正——对没越限的、或已收敛过的稳定旧条目，绝不要每隔几轮回头再动它的加成**（否则就成了"加成每隔几楼被砍一次"的 bug）。`;

const FACTION_NAME_RULE = `
【势力命名·铁则】势力 name 必须是**符合当前世界观、有具体含义的中文名称**（如「青云宗」「黑鸦佣兵团」「哥布林巢穴·血牙部族」「圣盾骑士团」）。**严禁**用势力ID（F1/F2…）、英文代号、或「未命名/某势力/势力一」这类无意义占位文字当名字。正文已出现该势力名号则照用；未命名时按其类型/规模/首领/所处世界自拟一个贴切中文名。**若某势力当前的名字仍是 ID/英文/无意义占位（如 F1），必须在本次演化中把它改成贴切的中文名。**`;

const TITLE_DIVERSITY_RULE = `
【称号·授予 & 去重铁则】称号是角色**赢得的身份/成就/江湖外号/名声**，授予条件**可以放宽**——不必死等正文白纸黑字写"获得称号"，只要剧情里角色有了值得铭记的表现、战绩、名声、身份或里程碑，就**主动**冠以一个贴切的称号（旁人对其的称呼、自封的名号、势力册封、江湖流传的外号都算）。宁可适度多给一点，让角色的名号墙丰富起来。但仍守住"质量"两条线：
- **不为转瞬的情绪/场景造称号**：如「受惊的XX」「慌乱的XX」这类是**当前状态**（走状态/Buff），不是称号，别 addTitle。
- **不堆同主题近义变体**：已有「解析天才」就别再加「粉色天才」「绝顶解析者」这种换汤不换药的同义称号；同一侧面只留最贴切的一个——要升级就 addTitle 同名更新、或 deTitle 旧的再加新的，**不要平行堆叠近义称号**。
- 新称号尽量与已有称号**覆盖不同维度**（战斗实力 / 身份地位 / 重大成就 / 性格外号 / 职业专长 / 名声口碑 等各取其一）。
- 有合适契机就给，可以每隔几回合新增；称号库放宽到**通常 2~6 个**，不必刻意压到一两个。`;

const TALENT_NO_CAP_RULE = `
【天赋数量解除上限·覆盖旧规则】**本规则优先级高于任何预设里"每角色最多3个天赋/天赋不可超过3个"之类的限制**——天赋数量**不设上限**，同类型也不再强制唯一。仍遵守：只有正文出现明确"觉醒/获得/融合/传承"等证据时才用 addTalent 新增；同名天赋只更新不重复添加；无证据不要凭空堆叠。技能同理不卡死数量。`;

/* 是否身处轮回乐园（任务间歇·回归态）——worldName 指向家园 */

const MISC_HOME_TIME_RULE = `
【回归乐园·时间一致】当主角身处轮回乐园/专属房间（任务间歇或已回归）时，**世界时间(worldTime / current_world_time) 必须与轮回历(paradiseTime) 完全一致**，并把 worldName 设为「轮回乐园」或「轮回乐园·专属房间」。绝不要把上一个任务世界的时间（如 1943 年）继续留在世界时间里。`;

const WORLD_EVENT_LOCATION_RULE = `
【世界大事·地点写"全路径"（含所处世界）】addWorldEvent / updateWorldEvent 的「地点」字段一律写成**从所处世界开始的完整层级路径**：所处世界 → 大区域/城市 → 建筑/场所 → 具体位置，层级用空格或「·」分隔。
- 正例：「生化危机2 浣熊市 警察局 二楼回廊」「武侠世界 洛阳 听雨楼 三层雅间」「霍格沃茨 城堡 八楼 有求必应屋」。
- 反例（禁止）：只写「二楼回廊」「警察局」这种缺了所处世界与上级、孤零零的地点。
- 当前所处世界见【当前世界】；身处轮回乐园/专属房间时，世界就写「轮回乐园」。`;

const TASK_OUTCOME_RULE = `
【任务结算·严格据正文铁则（最高优先，覆盖预设里"禁止在此标记任务完成/失败""任务成功失败不在这里判定"等旧规则）】本阶段负责任务的**结算**：每轮必须逐条比对【当前任务列表】与本轮正文——
- 当正文**明确**写出某任务已达成目标/已完成/已交付/已成功 → 输出 add("T_x", {"5":"已完成"})。（**多环任务例外**：若达成的只是当前环而非终局，改用 ringAdvance 推进、别整条结算——详见下方【任务环·自适应推进】）
- 当正文**明确**写出某任务已失败/已错过时限/目标已死亡/已放弃/已不可能完成 → 输出 add("T_x", {"5":"已失败"}) 或 {"5":"已放弃"}。
- T_x **必须逐字照抄**【当前任务列表】里那条任务的真实 ID（如 T_3）；列表里没有的任务不要结算。
- 标记为 已完成/已失败/已放弃 的任务会被系统**自动归档移出"进行中"列表**，无需再额外 de()；也不要把它当新任务重新创建。
- **严格据正文、宁缺毋滥**：正文没有明确结算证据的任务一律保持"进行中"，绝不臆测完成或失败；仅"提出/尝试/谈判中/等待回应/进行到一半"都**不算**完成。`;

const QUEST_RATING_RULE = `
【任务评分（完成/失败时给定）】当某任务被标记为已完成/已达成/失败/放弃（status 进入结算态）时，在该任务的 updateTask 载荷里**额外给一个 rating 字段**，按完成质量评级（S/A/B/C/D/E；失败给 E，判断不了给 C）：
- 主线任务综合各环完成度评级；支线/隐藏任务按达成度评级。
- 形如：updateTask("T_5", {"5":"已完成","rating":"A"})。rating 会显示在任务面板"已结束"列表，并供世界结算综合参考。`;

const QUEST_HOME_NO_GEN_RULE = `
【乐园·枢纽禁止生成任务·铁则（最高优先，覆盖下方一切"新建/规划/补建任务"的示例）】当主角身处**乐园·枢纽**——轮回乐园 / 主神空间 / 专属房间 / 主角所属乐园 / 任一乐园（即【进入新世界信号】=否，且【当前世界】是上述任一枢纽，任务间歇·回归态）时——**禁止生成任何新任务**：主线 / 支线 / 隐藏 / 单环任务一律不建（不 set 新 T_、不补 rings 路线图、不把枢纽里的活动落成任务条目）。
- **尤其禁止"熟悉环境 / 适应乐园 / 熟悉规则 / 逛街采购 / 兑换装备 / 强化打磨 / 休整调息 / 参观设施 / 拜访某NPC / 报到登记"这类围绕枢纽日常的流程性·杂事性任务**——它们毫无主线意义、纯属凑数，无论正文怎么写都**一律不生成**。
- 原因：乐园·枢纽是任务的**间歇与回归地**，本身没有任务线；任务只在主角被投放进**具体任务世界（衍生世界）**后才产生。枢纽里的休整、采购、社交、备战靠正文叙述即可，绝不落成任务。
- 本规则**只禁止"新建/补建任务"**：对【当前任务列表】里既有任务的**结算 / 归档 / 推进**仍照常按【任务结算】【任务环·自适应推进】执行（若上个世界的任务尚未结清）；总结 / 天气 / 时间 / 世界大事等其它杂项输出也照常。`;

const QUEST_PLANNING_RULE = `
【主线路线图规划·铁则（就主线而言优先于预设里"保守不新建任务"的示例）】区分两类任务：**主线**=本任务世界的核心目标线，每个世界通常**只有一条 active 主线**；其余多回合目标一律**支线**（支线也可多环）。
- **【最高铁则·主线必须分环】新建主线一律用 rings 数组建成 3~5 个环（强制环+贪婪环，见下）；严禁建成"无 rings 的扁平主线"——扁平=错误，会丢失"一环一环"的路线图与逐环奖惩。支线若多回合也尽量分环。**
- **任务世界 vs 枢纽（先分清）**：任务世界 / 衍生世界 = 主角被投放进去的具体世界（有自己的地名、势力、反派、威胁与核心任务）；而**轮回乐园 / 主神空间 / 专属房间 / 各乐园都是枢纽（起点·任务间歇·回归地），不是任务世界**。
- **绝不规划主线的情形（最高优先，覆盖下方"何时规划"）**：① 当前世界是上述任一**枢纽**时——不规划任何主线；② **禁止生成"框架/流程"类套路主线**——诸如"适应乐园环境 / 进入衍生世界 / 获取身份 / 执行衍生世界主线 / 结算并回归轮回乐园 / 首次世界试炼"等围绕轮回乐园机制本身的流程性任务，**毫无剧情意义，一律不生成**。
- **何时规划主线**：仅当主角**真正进入一个具体任务世界（衍生世界，非枢纽）**——【进入新世界信号】=是、或本轮正文明确把主角投放进了一个新任务世界，且【当前任务列表】里**没有**属于当前世界的 active 主线时——把**该任务世界自身的核心目标**（用该世界真实的地名/反派/势力，绝不用框架套话）立成一条主线，**先定好"总环数"与"终局"，环内容则渐进式规划**：
  · 用 set 新建，带 \`kind:"主线"\`、\`finale\`(终局/最后一环的 climax 目标)、\`currentRing:1\`、\`rings\`(**3~5 个环**：通常 2~3 个强制环 + 0~2 个贪婪环，见下)。**总环数与 finale 一旦定下就固定不变**。
  · **不要一上来就把所有环的内容写死——渐进式规划**：rings 按总环数建满 N 项，但只把"当前环 + 下一环"写完整，再后面的留占位：
      ① **第1环(status="active") 与 第2环 写完整**：idx / goal / reward / penalty 全给（reward 六选三、penalty 三类，见下）。
      ② **第3环及以后只占位**：idx + status="planned" + goal 写「（待剧情展开后规划）」（最后一环可写 finale 的方向当钩子），**先不写 reward/penalty**，等推进到再补。
      ③ 之后**每推进一环，再把"新的下一环"补成完整内容**（见【任务环·自适应推进】），始终保持"当前环+下一环"写全、更后面的留占位。
  · **各环是规模/难度递增的"不同挑战"，不是一个目标的拆分步骤**——例：清剿哥布林巢穴 →(难度升)清剿大型巢穴 → 终局 牧场守卫战·硬抗海量哥布林；**绝不要写成 侦查→赶路→清剿 这类琐碎子步骤**（那会让推进很墨迹）。
  · **强制环 vs 贪婪环（结构命门，每环必标其一）**：一条主线 = 2~3 个**强制环** + 0~2 个**贪婪环(标 optional:true)**：
      - **强制环**(不写 optional)：保命底线、必经，**失败=死亡或重罚**(penalty 三类)。顺序：①入场钩子(低难度，把主角钉进本世界剧情、绑定动机) ②正式升级(硬仗，逼用本世界资源/规则、击杀中boss/夺关键物) ③高潮(最高强制难度，boss战/剧情爆点)。**打完高潮＝主线达成、可离场**(到此即完整闭环)；finale 写的就是高潮目标。
      - **贪婪环**(optional:true)：高潮之后的**可选延伸**(隐藏升级 / 顶点·隐藏boss)，难度陡增、奖励跳一大档；**失败只损失本环额外奖励、不致死、不强制抹除**，排在强制环之后。
  · **reward 固定"六选三"**：从【①属性点 ②技能点 ③乐园币 ④一件契合当前世界风格的装备 或 技能书 ⑤潜能点（职业技能树资源，按环规模给但**每环最多 +4**：普通环+1~3、贪婪环至多+4；完成时由【潜能点】规则用 \`pp.B1 += N\` 实际发放） ⑥一个贴合本世界题材的「世界专属宝箱」（以未开启物品发放·开启得本世界主题战利品，命名贴合本世界）】里**任选 3 类**，每类给具体数值/名目（如 「属性点+3、技能点+2、乐园币+500」 或 「乐园币+500、技能点+2、潜能点+3」，或把一项换成"当前世界风格的武器/技能书"）；**奖励超线性增长——每往后一环奖励近翻倍，贪婪环更跳一大档**（默认你已吃掉前几环奖励变强）。
  · **货币·每环基础给量（削减后·按世界阶·铁则）**：六选三里的货币奖励按当前世界阶给基础值、**别再随手大放**——**一阶~三阶发乐园币**：一阶+500 / 二阶+1500 / 三阶+4000；**四阶起改发灵魂钱币（魂币）·不再发乐园币**：四阶+1 / 五阶+3 / 六阶+6 / 七阶+12 / 八阶+25 / 九阶+50（**每环基础**·±50% 按环规模浮动；后续环超线性递增、贪婪环再跳一档，但起步以此为准）。此切换契合下条「灵魂钱币·四阶门槛」：三阶及以下绝不出灵魂钱币、四阶起货币奖励即为灵魂钱币。
  · **灵魂钱币·四阶门槛**：**三阶及以下世界货币奖励只发乐园币、严禁灵魂钱币**；**四阶及以上世界货币奖励改发「灵魂钱币(魂币)」**（与正文世界书蓝灯铁律「灵魂钱币·任务奖励四阶门槛」一致——四阶才解锁灵魂钱币）。
  · **世界之源（独立于 reward 六选三、完成必得）**：每一环（及单环任务）完成时，除 reward 六选三外**恒定额外发放「世界之源」%**——主线强制环 +10%~18%、贪婪环 +15%~25%、支线环 +3%~7%、隐藏任务 +8%~15%（按规模在区间取；口径见正文世界书「00-铁律」第15条「世界之源·获取标准」）。**reward 字段仍只写六选三那三类、不要把世界之源塞进 reward**；世界之源在正文📜任务模块单列展示，并于回合末【🌍世界之源】行计入累计、供世界结算评级。
  · **penalty 按环型分**：**强制环固定三类**（按严重度递进：①扣除乐园币 ②全属性永久下降 ③强制抹除＝契约者被处决，仅用于高潮/致命失败），**不要写"被伏击/受伤/暴露行踪"等普通剧情后果**；**贪婪环 penalty 写"仅损失本环额外奖励(不死)"**。reward 不许留空。
  · **每环时限(startTime/endTime，绝对游戏时间)·最低 7 天铁则**：给每一环（及单环任务）设执行窗口时，**endTime − startTime ≥ 7 天（任务世界时间）是地板**，绝不要设几小时/几天的紧逼窗口逼玩家赶场；**上不封顶、按难度与性质评估**——普通环 7~30 天起步，需长期经营/等待/养成/季节更替/远途的长线环给数月乃至一年以上（半年、一年、数年皆可）。startTime=本环开始时的绝对游戏时间，endTime=startTime+评估出的时长；推进到下一环时新环 startTime 接续上一环结束。
  · 顶层第2列(desc)同步写当前 active 环目标，第5列写"进行中"。
  · 新建主线的 T_ 编号用系统提供的"下一个可用任务ID"（同新建任务规则），下面示例里的 T_5 仅为占位。
  · 示例（一行内，双引号）：\`set({"0":"T_5","1":"哥布林讨伐","kind":"主线","2":"潜入受袭村庄、在哥布林夜袭中存活三日","5":"进行中","finale":"高潮·牧场守卫战，硬抗哥布林大军守住村庄","currentRing":1,"rings":[{"idx":1,"goal":"潜入受袭村庄、在哥布林夜袭中存活三日","status":"active","reward":"属性点+2、技能点+1、乐园币+500","penalty":"扣除乐园币500"},{"idx":2,"goal":"夺回被占的旧矿、击杀哥布林督军","status":"planned","reward":"属性点+3、乐园币+1500、督军战旗(当前世界风格)","penalty":"全属性永久-2"},{"idx":3,"goal":"（高潮，待推进到再规划）","status":"planned"},{"idx":4,"goal":"（贪婪·隐藏委托，待解锁）","status":"planned","optional":true}]})\`
- **何时不规划**：已存在当前世界的 active 主线时，**绝不重复新建主线**；主线的环推进交给【任务结算/推进】，这里不再造第二条主线。
- 路线图是**规划而非预言**：**总环数(3~5)、各环的强制/贪婪定位、finale 定下后保持不变**，但环的具体内容渐进式补全（当前环+下一环写全、其余占位）；不要一开始就把整条线写死。每一环都是要打好几回合的"实质挑战"、规模/难度递增，不是琐碎子步骤。
- **支线**：正文产生的其他多回合目标用 \`kind:"支线"\`（或不写 kind=默认支线）；需要分段的支线同样可带 rings，其每一环也要写全 goal/reward/penalty，reward 同样按"六选三"（属性点/技能点/乐园币/当前世界风格装备或技能书/潜能点/世界专属宝箱 任选3类；灵魂钱币同样仅四阶+世界可作奖励）给，penalty 同样从「扣除乐园币 / 全属性永久下降 / 强制抹除」三类里取；**时限同样适用上面的【每环时限·最低 7 天】**——支线的每一环、以及单环支线任务，都要设 startTime~endTime 执行窗口、且 endTime−startTime ≥ 7 天（上不封顶，按难度/需求评估，长线可数月乃至一年以上）。`;

const QUEST_KILL_TIER_RULE = `
【任务击杀目标·阶位上限铁则（防止给低阶主角派"正面单挑高阶强者"的送死任务）】凡任务（含主线/支线各环）要求主角**正面击杀/讨伐**的目标，其阶位按环型封顶：
- **强制环 / 任何必经的击杀目标（含高潮 boss）**：阶位 **≤ 主角当前阶位**（主角一阶 → 目标最高一阶）。主线推进必须打赢，绝不能逼主角越阶硬撼；难度靠**精英化 / 数量 / 机制 / 环境**做，不靠拔高阶位。
- **贪婪环（optional:true 的可选拔高）**：阶位 **≤ 主角当前阶位 +1**（主角一阶 → 最高二阶），作为高风险高回报的越阶挑战。
- **不得为凑上限而把剧情里本就强大的角色降级**：高阶 boss / 枭雄 / 原作强者维持其应有阶位与设定。正确做法是**给主角换一个与其阶位相称的击杀目标**——打高阶强者的下属 / 爪牙 / 外围、或迂回 / 非正面目标；高阶强者此刻只作背景威胁、旁观者、或暂时无法正面硬撼的存在，待主角成长后再正面对决。
- 例（主角一阶）：第一个任务**别**写"正面干掉二阶精英魔物"；应是"清剿一阶异化幼体""赶在二阶魔物现身前完成目标并撤离"这类一阶打得过的目标。`;

const TASK_RECONCILE_RULE = `
【任务环·自适应推进铁则（带环路线图的任务专用，优先于"任务达成即整条结算"的旧理解）】对【当前任务列表】里展开了 环1/环2… 的任务，每轮据正文按下列情形维护；**单条任务每轮最多一种环操作，无明确证据则不动**：
① 当前 active 环的目标在正文里**明确达成** → 输出 \`ringAdvance("T_x")\`（系统会把当前环标 done、下一 planned 环转 active）。**这不是结算整条任务**——多环任务达成的只是"这一环"，绝不能因为一环完成就写 \`{"5":"已完成"}\`。**推进后，若"新的下一环"还是占位（goal 含"待…规划"、或缺 reward/penalty）→ 同回合用 \`add("T_x",{"rings":[…完整新数组…]})\` 把它补全**（goal 给一个比上一环规模/难度更高的新挑战、reward 六选三、penalty 三类、指向 finale），**总环数保持不变**。
② 主角**提前/跳跃**完成了某个 planned 环，或另辟蹊径使中间环失去意义 → 用 \`add("T_x",{"rings":[…完整新数组…],"currentRing":N})\` 重排路线图：把已被跨越的环标 "done" 或 "skipped"，把当前正在做的设 "active"，并**重规划其后的 planned 环**使其仍自洽地指向 finale。（例：主角第1环就直捣巢穴主洞，则环1/2/3 视情况标 done/skipped，currentRing 跳到对应环，必要时补一个收尾环。）
③ 某个 planned 环被正文**作废**（目标NPC死亡 / 路径关闭 / 前提消失）→ 用 \`add("T_x",{"rings":[…]})\` 改写该环 goal 或移除它，保持整张图自洽指向 finale。
④ **高潮(最后一个强制环)达成＝主线达成**：**不要自动推进进贪婪环**。若该主线有贪婪环(optional:true) → 正文应向主角呈现"见好就收(主线已达成、可离场结算) / 继续赌(接受隐藏委托、进贪婪环)"的选择(附奖励预览+难度风险警告)；**仅当正文明确主角"接受/继续"才用 ringAdvance("T_x") 进贪婪环**，主角"见好就收/离场"则 add("T_x",{"5":"已完成"}) 结算。无贪婪环则高潮达成即直接结算。
⑤ **贪婪环**：成功给其超额奖励(再 ringAdvance 进下一贪婪环、或结算)；**失败只损失本环额外奖励、不致死、不强制抹除**，整条任务仍按"已达成"结算 add("T_x",{"5":"已完成"})。
⑥ 整条任务**失败/放弃**(强制环致命失败、或主角彻底放弃) → add("T_x",{"5":"已失败"}) 或 {"5":"已放弃"}。
⑦ **修复扁平主线（重要）**：若【当前任务列表】里当前世界的 active **主线没有 rings**（是扁平任务、没有一环一环）→ 立即用 \`add("T_x",{...})\` 给它补全 rings 路线图：把它现有目标作为第1环(status="active")、按其核心目标/finale 铺 3~5 环（强制环+贪婪环）、各环写全 goal/reward(六选三)/penalty(三类)/时限(startTime~endTime≥7天)，带 currentRing:1 与 finale。一次补好，此后正常按环推进。支线多回合且无环者同理可补。
- **防抖护栏**：环的 idx 要稳定，**不要无故重命名/重排既有环**；只在正文给出**明确证据**时才推进/重排/改写（重排/改写/补环时，新环同样写全 goal/reward(六选三)/penalty(三类)/时限(startTime~endTime≥7天)）；绝大多数回合主线**没有**任何环指令；**总环数一旦定下保持不变（只填占位环、补全下一环，不随意增删环）**，≤5。
- 支线的环同理可用 \`ringAdvance\` / \`add rings\` 维护，但**优先保证主线**的环准确。`;

const TASK_CANON_RULE = `
【同人世界·任务接地铁则（让任务贴合原作主线脉络，而非套通用模板）】当【当前世界】是**已知虚构作品**（动漫/游戏/小说/影视等同人世界）、且【同人增强】=开时，生成或规划任务（尤其主线路线图）前先做"接地"：
1. **主动联网搜索**该作品的：核心主线脉络与阶段走向、主要冲突与反派、关键势力/组织、重要地点与威胁、重大事件与时间线（该作品有大量公开资料，优先采用准确、最新信息）；可一并参考已锁定的 <同人设定>。
2. 用搜索到的**真实设定**设计任务的名称/描述/环目标/finale，使主线**沿着或平行于原作主线脉络推进**——反派/势力/地点/威胁都用原作真名与设定，不要套"讨伐巢穴/护送商队"之类通用模板，不要张冠李戴或编造不符的设定；原作未涉及处基于已知信息合理推演。
3. **结合主角当前处境**（见下方【主角当前处境】：阶位/强度/位置/所属乐园/身份/已有任务）来定任务的切入点、难度与节奏：别给与主角实力/位置脱节的目标——主角强则切入原作更核心的冲突，弱则从外围/前哨/情报起步。
4. 不以百科形式罗列、不引用来源；把原作设定自然融进任务名/描述/环目标。
- 非同人（原创/现实）世界、或【同人增强】=关：无需联网，按正文与世界设定生成即可。`;

const TASK_PROGRESS_RULE = `
【任务·当前进度（progress 字段）·每轮维护铁则】每条进行中任务都带一个 progress 字段，记录【上回合主角对该任务做了什么实质推进】，**1~2 句话、具体到动作/结果**（而非空泛的"在推进中"）。每轮杂项演化时：
- 本回合正文里主角对某任务有实际推进/进展/受挫/转折 → 用 \`add("T_x", {"progress":"……"})\` 更新该任务的 progress（覆盖上一轮的旧值）。
- 新建任务（set）时若本回合已有起步动作，一并在载荷里给 progress（如"刚接下委托、向情报贩子打听了线索"）；纯领取、尚无动作可不给。
- 本回合对某任务【没有任何推进】→ **不输出该任务的 progress**（自动保留上一轮旧值即可，别写"无推进/未推进/等待中"这类占位）。
- progress 只是"上回合做了啥"的纪实快照，**纯展示与续作连贯用，不参与任务完成/失败判定**（结算仍走 status / ringAdvance，互不替代）。
- 示例：\`add("T_5", {"progress":"在哥布林夜袭中守住村口栅栏、救下两名村民，但右臂负伤"})\``;

const WEATHER_FX_GEN_RULE = `
【顶栏天气特效·CSS 生成（仅奇异天气·可选）】前端对【晴/雨/雪/雾/阴/雷/风】等常规天气已内置精致动画——这些天气**不要**输出任何特效代码。仅当本回合天气是**特殊/奇异**天气（前端没有的，如 血雨 / 灵雾 / 沙暴 / 星陨 / 瘴气 / 雷劫 / 黑雾 / 灵气风暴 等），且**天气本回合刚发生变化**时，才追加一个 <weatherfx> 块，为它生成一层**自包含的纯 CSS 动画**做顶栏背景：
- 作用域：只针对容器 .wfx-ai（已绝对定位铺满顶栏）及其内部 3 个 .wfx-ai>span（三层可各做一种效果：底色 / 飘动物 / 光罩）；**不要写其它选择器**。
- **只允许 CSS**（含 @keyframes、渐变、transform、animation、opacity）；**严禁** <script>/JS、on事件、外部 url()/@import/expression/behavior。
- 低透明度、别盖住文字；深浅底都能看清；总长 ≤ 800 字符。
- 天气没变、或是常规天气 → **整个 <weatherfx> 块都不要输出**（前端自带预设，重复输出浪费且抖动）。
示例（血雨）：
<weatherfx>
.wfx-ai{background:linear-gradient(180deg,#3a0d12,#190406)}
.wfx-ai span:nth-child(1){background:repeating-linear-gradient(78deg,transparent 0 6px,rgba(200,45,55,.5) 6px 7px);animation:bloodrain .5s linear infinite}
@keyframes bloodrain{to{background-position:0 13px}}
</weatherfx>`;

const MISC_WEATHER_RULE = `
【天气·每回合必更新铁则】每回合杂项输出里**必须**给出当前任务世界的天气，用指令一行：timeLocation.weather = "天气词"。
- 天气词按本回合正文场景/世界设定/时间写，可含特殊异象（如 晴空万里 / 阴冷微雨 / 浓烈腐臭·火花闪烁 / 大雾弥漫 / 血雨 / 瘴气弥漫 / 雷暴交加 等）；顶栏靠它显示环境特效，**绝不能留空或不输出本行**。
- 随剧情/时间/地点变化即时更新；本回合没明显变化也**照抄当前天气重新输出一遍**（始终保持非空）。
- 仅写自然/环境天气（含异象）；室内场景可写当前室内氛围或"室内·<外面天气>"。`;

const MISC_SUMMARY_CADENCE_RULE = `
【总结分工铁则（最高优先，覆盖预设里"每轮都给大总结"的旧要求）】小总结与大总结**职责不同、节奏不同，绝不能内容雷同**：
- 小总结 addSmallSummary：**每轮必给**，只聚焦【本回合】发生的关键变化（关键人物 / 地点·时间 / 事件经过 / 结果 / 下一步），具体精炼，不要复述更早回合。
- 大总结 addLargeSummary：**不是每轮都写**。是否输出严格听从下方「本轮大总结开关」：
  · 开关=否 → **禁止输出任何 addLargeSummary**（即便写了也会被系统丢弃）。
  · 开关=是 → 必须且只输出 **1 条** addLargeSummary：它是对下方【最近小总结】的更高层「阶段压缩」——归纳这一阶段的整体走向、当前处境、未决任务与后续风险，**抹去单回合细节**，与任何一条小总结都明显不同；严禁把本回合小总结原样换句话当作大总结。`;

const MISC_COT_RULE = `
【杂项演化·强制思维链(CoT)铁则（最高优先；这是本阶段唯一允许在 <upstore> 之外输出的内容）】在产出 <upstore> 指令块之前，你**必须**先输出一段 <misc_cot>…</misc_cot> 思维链，逐项推演本轮产出的"合理性与原因"，再据此落指令。系统只解析 <upstore>，<misc_cot> 块会被自动忽略——但你必须先写它、把"为什么这么记"想清楚，以杜绝套路化、失衡、与正文脱节的产出。它与【输出格式铁律】不冲突：思维链是**唯一例外**；写完思维链后，最终指令仍只写进 <upstore>，**绝不要把指令草稿留在 <misc_cot> 里当成输出**。

<misc_cot> 必须按下列顺序推演（对照【杂项演化·任务与世界规范图鉴】各条；找不到正文依据/讲不出合理原因的，一律不输出）：
0. 本轮事实：从正文抽取会影响 总结/任务/天气/世界大事/时间 的关键事实；判定当前在【枢纽】还是【任务世界】（决定能否新建任务）。
1. 总结：本回合最关键的变化是什么（小总结要点，约120~220字）；大总结开关是否=是（=否则禁止输出大总结）。
2. ★任务（最重要、推演最详）——对每一个"新建/推进/重排/结算"的任务动作，逐条写明原因，缺一不可：
   · 触发证据：正文哪一句让这个任务"现在"该产生/推进/结算？（无明确证据 → 不动）
   · 合理性：是否贴合当前世界设定/原作脉络（同人增强开时）？是否契合主角当前处境（阶位/强度/位置/身份）？难度是否符合【击杀阶位上限】（强制环≤主角阶位、贪婪环≤+1）？是否落入被禁止的"枢纽日常/框架流程"套路（适应乐园/逛街采购/进入衍生世界…一律不建）？是否与既有任务重复（同目标 → 优先推进既有，不另起）？
   · 类型与环：从【任务类型库】挑了哪种、为何最贴切？若为主线/多回合：环路线图为何这样排——每环规模/难度如何递增、为何指向这个 finale、强制环/贪婪环如何划分？
   · 奖惩与时限：reward 为何这样配（六选三、按环超线性、带本世界风味）？若含灵魂钱币，当前衍生世界是否≥四阶（否则违规、应改乐园币）？penalty 是否取自规范三类？时限 endTime−startTime 是否≥7天且贴合任务性质？
   · 结算：要标"已完成/已失败"的，正文是否有明确达成/失败证据？多环任务达成的只是"当前环" → 应 ringAdvance 而非整条结算？
   · 进度：本回合主角对该任务有无实质推进？有则用 1~2 句具体动作/结果写进 progress 字段（覆盖上轮）；无推进则不输出 progress（保留旧值）。
   · 结论：本任务这一轮"动 or 不动"，动则给出最终指令草稿。
3. 天气：本轮正文/季节/地点是否导致天气变化？据【天气词库】挑一个贴切的（没变也照抄重出一遍，始终非空）。
4. 世界大事：是否达到"影响大范围格局"的阈值（对照【世界大事·类型库】）？达不到就一条不写；达到则地点写全路径。
5. 双时间：worldTime/paradiseTime 该不该推进、推进幅度是否贴合正文？在枢纽则两时间一致。
6. 自检：只输出允许的杂项指令；任务 ID 精确（T_<数字>不补零）、不可逆事实有据、总结长度合格。

铁律：**宁缺毋滥**——把"为什么合理"的推演写在 <misc_cot> 里，把经得起推敲的结论落进 <upstore>；任何讲不出原因的产出都不要写。`;

const FACTION_HOME_EXIT_RULE = `
【势力随世界进出·铁则】势力是**世界绑定**的：只有 worldName 与「当前世界」一致的势力才算"当前世界(inCurrentWorld)"。
- 当前世界为轮回乐园（主角已回归）时，**上一个任务世界（如哥布林杀手世界）的所有势力都必须放进 exits（移出当前世界）**，只保留轮回乐园本身的组织。
- 切换到新任务世界时，旧世界势力同样移出。判断 exits 时优先看势力的 worldName 是否等于当前世界。`;

/* ── 限时状态过期：硬控类应短暂，无明确时长的也要给默认回合数，避免"持续"类永不消失 ── */

/* 频道发帖人信息铁则（代码注入频道生成 + 发言回复）：每条帖子/回复都给发帖人补 性格/职业/生物强度，供后续生成临时队友 NPC */
const CHANNEL_AUTHOR_INFO_RULE = `
【发帖人信息·铁则】每条帖子/回复都要给发帖契约者补上这三项（作为该项的**同级 JSON 字段**，不要写进 content）：
- "persona"：性格，简短（如 狂热好战 / 谨慎多疑 / 吊儿郎当 / 沉默寡言 / 唯利是图 / 重情重义 / 高冷毒舌）。
- "job"：职业——**务必多样、有新意，别老用法师/牧师/战士这种古早设定**。多用网游 / 网络小说式职业，含隐藏职业·进阶职业·特殊血脉，例：毁灭术士、龙之子、噬魂者、时空裁决官、契约骑士、暗影行者、神机操纵者、瘟疫使徒、星陨炮手、傀儡师、血祭司、深渊代行者、符文铸造师、亡语者、机械先知、星语者……（贴合发帖人所在世界；同人世界用其原作职业设定）。
- "strength"：生物强度档（T0杂鱼 ~ T9源初，如 "T3·勇士"、"T6·王者"），与其阶位/语气相称。
这三项**每条都要给**，后续会用来生成该契约者的临时队友 NPC 档案。

【发帖人属性·自洽铁则（阶位 / 等级 / 强度档 / 职业必须互相匹配，禁止乱配）】发帖契约者按"角色生成"的同一套规则生成，"tier"(阶位·Lv)、"strength"、"job" 三项必须前后自洽，绝不能各填各的：
- **阶位 ↔ 等级一一对应**：一阶=Lv.1-10、二阶=11-20、三阶=21-30、四阶=31-40、五阶=41-50、六阶=51-60、七阶=61-70、八阶=71-80、九阶=81-90、绝强=91-100、至强=101-120、巅峰至强=121-140、无上之境=140+。阶位与 Lv **必须落在同一档**，绝不能写「四阶·Lv.15」这种阶位与等级错配的组合。
- **生物强度档 T0~T9 的称呼只能照抄这套**：T0杂鱼 / T1兵卒 / T2精英 / T3勇士 / T4英雄 / T5领主 / T6王者 / T7半神 / T8真神 / T9源初。绝不能错配称呼（如写「T6·领主」——T6 是「王者」、「领主」是 T5）。
- **四项彼此相称**：阶位越高 → 等级、强度档越高、职业越响亮、口气越大；低阶（一~三阶）就配 T0~T3 与朴实职业，别动辄 T7 半神或「噬神者 / 界之主」这类顶级职业名。务必内部一致、不自相矛盾。`;



const rightMenuItems = [
  { icon: '⚔', label: '装备' },
  { icon: '🎒', label: '储存空间' },
  { icon: '📇', label: 'NPC' },
  { icon: '✨', label: '技能' },
  { icon: '🛠', label: '副职业' },
  { icon: '🌳', label: '技能树' },
  { icon: '🎖', label: '称号' },
  { icon: '🏆', label: '成就' },
  { icon: '🏛', label: '势力' },
  { icon: '🏯', label: '领地' },
  { icon: '🛡', label: '冒险团' },
  { icon: '🤝', label: '队伍' },
  { icon: '🌌', label: '万族' },
  { icon: '📖', label: '世界百科' },
  { icon: '📚', label: '轮回WIKI' },
  { icon: '🎲', label: 'ROLL' },
  { icon: '⚔️', label: '战斗' },
  { icon: '🎡', label: '乐园设施' },
  { icon: '🕳', label: '深渊' },
  { icon: '🔍', label: '回合洞察' },
  { icon: '📋', label: '任务' },
  { icon: '📡', label: '频道' },
  { icon: '✉', label: '私信' },
  { icon: '👥', label: '好友' },
  { icon: '🌐', label: '联机' },
  { icon: '💬', label: '聊天室' },
  { icon: '🛒', label: '交易行' },
  { icon: '🆘', label: '助战' },
  { icon: '🪦', label: '纪念丰碑' },
  { icon: '🧠', label: '记忆' },
  { icon: '🧩', label: '创意工坊' },
  { icon: '💾', label: '存档' },
  { icon: '⚙', label: '设置' },
];

/* 右侧导航·每个图标的独特 hover 特效类（定义见 index.css 的 .fx-*）*/
const NAV_FX: Record<string, string> = {
  '装备': 'fx-sword', '储存空间': 'fx-bag', 'NPC': 'fx-card', '技能': 'fx-sparkle',
  '副职业': 'fx-wrench', '技能树': 'fx-tree', '称号': 'fx-medal', '成就': 'fx-trophy', '势力': 'fx-pillar',
  '领地': 'fx-castle', '冒险团': 'fx-shield', '队伍': 'fx-friends', '万族': 'fx-cosmos', '世界百科': 'fx-book', '轮回WIKI': 'fx-book', 'ROLL': 'fx-dice',
  '战斗': 'fx-clash', '乐园设施': 'fx-ferris', '深渊': 'fx-void', '回合洞察': 'fx-zoom', '任务': 'fx-quest',
  '频道': 'fx-signal', '私信': 'fx-mail', '好友': 'fx-friends', '聊天室': 'fx-signal', '交易行': 'fx-bag', '助战': 'fx-clash', '纪念丰碑': 'fx-pillar', '记忆': 'fx-brain', '创意工坊': 'fx-sparkle', '存档': 'fx-save', '设置': 'fx-gear',
};

export default function App() {
  const hasSave = useGame((s) => s.player.cleared.length > 0 || s.player.points > 0);

  // 综合设置
  const historyLimit = useSettings((s) => s.historyLimit);
  const disableEnterSend = useSettings((s) => s.disableEnterSend);
  const showNewlineButton = useSettings((s) => s.showNewlineButton);
  const reading = useSettings((s) => s.reading);
  const narrativeMem = useSettings((s) => s.narrativeMemory);

  // 正文生成设置
  const textApi          = useSettings((s) => s.textApi);
  const sharedApi        = useSettings((s) => s.api);
  const textUseShared    = useSettings((s) => s.textUseSharedApi);
  const textWorldBooks   = useSettings((s) => s.textWorldBooks);
  const textPresets      = useSettings((s) => s.textPresets);
  // activeTextPresetId/Name 现由 sendMessage/演化处直接走 useSettings.getState() 实时读取（免 stale 闭包），不再在此订阅
  const textStream           = useSettings((s) => s.textStream);
  const skipNarrativeThinking = useSettings((s) => s.skipNarrativeThinking);
  const plotGuidance         = useSettings((s) => s.plotGuidance);
  const guidancePrompt       = useSettings((s) => s.guidancePrompt);
  const globalRegexScripts   = useSettings((s) => s.globalRegexScripts);

  // 物品管理 + 主角演化：回合计数 + 阶段状态 + 最近正文缓存
  const turnCountRef         = useRef(0);
  const lastUserInputRef     = useRef('');
  const lastNarrativeRef     = useRef('');
  const lastRawNarrativeRef  = useRef('');   // 本回合正文「含 <state>/<upstore> 指令的原文」(仅剥思维链)，供「仅重算变量」回退后重放——刷新会丢
  // 物品演化「本回合快照」：每回合首次跑物品演化前，按当回合正文 key 存一份物品状态(主角背包+货币+各NPC持有物)的引用快照；
  // 同一回合再次触发(储存空间「手动更新」=重跑)时，先回退到这份快照(撤销本回合物品演化的修改)，再重新演化一次，避免在已改过的状态上叠加(重复/错乱)。
  const itemPhaseUndoRef     = useRef<{ key: number; items: any[]; currency: any; npcItems: Record<string, any[]> } | null>(null);
  const prevWorldNameRef     = useRef('');   // 上一次杂项演化时的世界名，检测"进入新世界"→触发主线路线图规划
  const [itemPhaseRunning,   setItemPhaseRunning]   = useState(false);
  const [itemPhaseLog,       setItemPhaseLog]       = useState('');
  const [itemAuditRunning,   setItemAuditRunning]   = useState(false);   // 物品对账纠正子阶段（独立指示，物品阶段后追加的那次调用）
  const [playerPhaseRunning, setPlayerPhaseRunning] = useState(false);
  const [playerPhaseLog,     setPlayerPhaseLog]     = useState('');
  const [npcPhaseRunning,    setNpcPhaseRunning]    = useState(false);
  const [npcPhaseLog,        setNpcPhaseLog]        = useState('');
  const [npcManualUpdatingId, setNpcManualUpdatingId] = useState<string | null>(null);   // 正在「手动更新」的单个 NPC id
  const [npcManualToast, setNpcManualToast] = useState<{ kind: 'info' | 'ok' | 'err'; text: string } | null>(null);   // NPC 手动更新浮层提示（盖在面板之上）
  const [factionPhaseLog,    setFactionPhaseLog]    = useState('');     // 势力演化阶段提示
  const [factionPanelOpen,   setFactionPanelOpen]   = useState(false);
  const [territoryPhaseLog,  setTerritoryPhaseLog]  = useState('');     // 领地演化阶段提示
  const [territoryPanelOpen, setTerritoryPanelOpen] = useState(false);
  const [cosmosPhaseLog,     setCosmosPhaseLog]     = useState('');     // 万族演化阶段提示
  const [miscPhaseLog,       setMiscPhaseLog]       = useState('');     // 杂项演化阶段提示（仅失败时显示「杂项更新失败」）
  const [cosmosPanelOpen,    setCosmosPanelOpen]    = useState(false);
  const [worldCodexOpen,     setWorldCodexOpen]     = useState(false);
  const [wikiOpen,           setWikiOpen]           = useState(false);
  const [cosmosTicker,       setCosmosTicker]       = useState('');     // 万族本回合更新（顶部滚动条）
  const [choicesRunning,     setChoicesRunning]     = useState(false);  // 剧情选项/同人增强后处理调用中
  const [promoteCandidates,  setPromoteCandidates]  = useState<string[]>([]);  // 临时队伍解散→待"转正进冒险团"的队友 id
  const [teamPhaseLog,       setTeamPhaseLog]       = useState('');     // 冒险团演化阶段提示
  const [teamPanelOpen,      setTeamPanelOpen]      = useState(false);
  const [dmPanelOpen,        setDmPanelOpen]        = useState(false);  // 私信面板
  const [dmFocusThread,      setDmFocusThread]      = useState<string | undefined>(undefined);  // 私信打开时聚焦的会话
  const [friendsPanelOpen,   setFriendsPanelOpen]   = useState(false);  // 好友面板
  const [partyPanelOpen,     setPartyPanelOpen]     = useState(false);  // 临时队伍面板
  const [workshopOpen,       setWorkshopOpen]       = useState(false);  // 创意工坊
  const [imagePhaseLog,      setImagePhaseLog]      = useState('');     // 生图（肖像/装备）阶段提示
  const [onSceneDetailId,    setOnSceneDetailId]    = useState<string | null>(null);  // 在场人物浮窗 → NPC 详情
  const [insightOpen,        setInsightOpen]        = useState(false);
  const [cleanupNpcs,        setCleanupNpcs]        = useState<{ id: string; name: string }[]>([]);  // NPC 定期清理提醒弹窗
  const [nmRecalling,        setNmRecalling]        = useState(false);  // 叙事记忆：正在进行记忆回溯
  const [nmPhaseLog,         setNmPhaseLog]         = useState('');     // 叙事记忆：回溯/整理结果提示
  const [guidanceRunning,    setGuidanceRunning]    = useState(false);  // 剧情指导：正在生成本回合剧情建议（状态栏提示）
  const [backpackOpen,     setBackpackOpen]     = useState(false);
  const [cmdkOpen,         setCmdkOpen]         = useState(false);   // 命令面板（⌘K / Ctrl+K / 顶栏🔍 快速跳转面板）
  const [revarOpen,        setRevarOpen]        = useState(false);   // 重算单项变量菜单（重 ROLL）
  const [phaseFail,        setPhaseFail]        = useState<Record<string, boolean>>({});   // 各演化阶段「上次更新失败」持久标记（重算菜单据此标红；key: item/player/npc/faction/territory/team/cosmos/misc/image）
  const [phaseBusy,        setPhaseBusy]        = useState<Record<string, boolean>>({});   // 各演化阶段「正在重 ROLL」标记（菜单内点重 ROLL 时置位，完成/失败/兜底超时清除）
  const [floorCfg,         setFloorCfg]         = useState<{ fk: string; label: string; total: number } | null>(null);   // 「按楼层批量更新」配置弹窗
  const [floorStart,       setFloorStart]       = useState('1');
  const [floorEnd,         setFloorEnd]         = useState('1');
  const [floorStep,        setFloorStep]        = useState('1');
  const [floorExtra,       setFloorExtra]       = useState('');   // 「按楼层更新」本次额外提示词（可留空，附到每批正文末尾一起喂给该变量演化）
  const [floorProg,        setFloorProg]        = useState<{ fk: string; cur: number; total: number } | null>(null);   // 批量更新进度（菜单行显示「批量 X/M」）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setCmdkOpen((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [showVer,          setShowVer]          = useState(false);   // 版本「已更新」提示横幅
  const [equipOpen,        setEquipOpen]        = useState(false);
  const [charPanelOpen,    setCharPanelOpen]    = useState(false);
  const [titlePanelOpen,   setTitlePanelOpen]   = useState(false);
  const [achievePanelOpen, setAchievePanelOpen] = useState(false);
  const [subProfOpen,      setSubProfOpen]      = useState(false);
  const [skillTreeOpen,    setSkillTreeOpen]    = useState(false);
  const [npcPanelOpen,     setNpcPanelOpen]     = useState(false);
  const [miscPanelOpen,    setMiscPanelOpen]    = useState(false);
  const [dicePanelOpen,    setDicePanelOpen]    = useState(false);
  const [enhancePanelOpen, setEnhancePanelOpen] = useState(false);
  const [skillUpPanelOpen, setSkillUpPanelOpen] = useState(false);
  const [casinoOpen,       setCasinoOpen]       = useState(false);
  const [abyssOpen,        setAbyssOpen]        = useState(false);
  const [joyPanelOpen,     setJoyPanelOpen]     = useState(false);
  const [facilitiesOpen,   setFacilitiesOpen]   = useState(false);   // 「乐园设施」聚合菜单（欢愉宫/竞技场/赌场）
  const joyEnabled = useJoy((s) => s.settings.enabled);
  const [channelPanelOpen, setChannelPanelOpen] = useState(false);
  const [mpPanelOpen, setMpPanelOpen] = useState(false);  // 联机面板
  const [chatRoomOpen, setChatRoomOpen] = useState(false);  // 全局实时聊天室
  // 聊天室悬浮气泡：可拖动（位置偏移记忆到 localStorage；拖动时按叙事区容器夹紧）
  const [chatBubbleOff, setChatBubbleOff] = useState<{ dx: number; dy: number }>(() => {
    try { return JSON.parse(localStorage.getItem('drpg-chat-bubble-off') || 'null') || { dx: 0, dy: 0 }; } catch { return { dx: 0, dy: 0 }; }
  });
  const chatBubbleHostRef = useRef<HTMLDivElement>(null);
  const chatBubbleDrag = useRef({ active: false, sx: 0, sy: 0, bx: 0, by: 0, moved: false, lx: 0, ly: 0 });
  const [tradeOpen, setTradeOpen] = useState(false);  // 全局交易行
  const [assistOpen, setAssistOpen] = useState(false);  // 全局助战大厅
  const [monumentOpen, setMonumentOpen] = useState(false);  // 纪念丰碑（跨存档英灵殿）
  const chatUnread = useChatRoom((s) => s.unread);   // 导航红点：聊天室未读
  const chatOnline = useChatRoom((s) => s.roster.length);   // 在线人数（= 当前在玩且已登录的人）
  // 已登录(有聊天身份) → 一进游戏就后台连接聊天室：「在玩存档即在线」（不必开聊天面板，新消息也进未读红点）
  useEffect(() => {
    if (chatDiscordLoggedIn() && chatReady()) {
      chatClient.ensureConnected(chatName() || '道友', chatToken());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [shopOpen, setShopOpen] = useState(false);
  const [summaryPanelOpen, setSummaryPanelOpen] = useState(false);
  const [saveOpen,         setSaveOpen]         = useState(false);
  // ── 战斗系统：响应式驱动（NPC/敌方回合自动推进；玩家回合等战斗面板出手）──
  const combatActive   = useCombat((s) => s.battle.active);
  const combatStage    = useCombat((s) => s.battle.stage);
  const combatTurn     = useCombat((s) => s.battle.turn);
  const combatRound    = useCombat((s) => s.battle.round);
  const combatApiBusy  = useCombat((s) => s.apiBusy);
  const combatAuto     = useCombat((s) => s.config.autoBattle);   // 自动战斗开关（变化即重驱动）
  const combatHasUndo  = useCombat((s) => s.undoSnapshot !== null);
  const mpRole = useMp((s) => s.role);
  const mpStatus = useMp((s) => s.status);
  const mpGuest = mpStatus === 'connected' && mpRole != null && mpRole !== 'host';   // 联机来宾(非房主)
  const mpMySeatId = useMp((s) => s.mySeatId);
  const mpMode: 'host' | 'guest' | null = mpStatus === 'connected' ? (mpRole === 'host' ? 'host' : 'guest') : null;
  const mpIncomingGift = useMp((s) => s.incomingGift);
  const mpRaidLoot = useMp((s) => s.raidLoot);
  const combatDrivingRef = useRef(false);
  const raidRef = useRef<{ boss: RaidBoss; phase: number; lastRound?: number; marked?: { id: string; round: number }; toughness?: number; bossHpMark?: number; poison?: number; armor?: number; armorMax?: number; breakUntil?: number; partArmor?: number; partIdx?: number } | null>(null);   // 组队讨伐：BOSS/阶段/回合机制/韧性/毒层/破核护甲/多部位
  const currentEncounterRef = useRef<{ encId: string; kind: 'dragon' | 'side' | 'boss' } | null>(null);   // 组队副本：当前战斗对应的 encounter（胜利后推进进度/控制掉落）
  const [hostTakeover, setHostTakeover] = useState<string[]>([]);   // 联机：房主因来宾(MP_)AFK 而临时接管的战斗角色 id
  const raidRollsRef = useRef<Record<string, Record<string, any>>>({});      // 战利 ROLL 收集（房主侧：lootId→playerId→{name,picks}）
  const appliedRewardRef = useRef<Record<string, boolean>>({});   // 副本豪华奖励去重（rewardId→已应用），防 relay 回显双发
  // 副本通关豪华奖励入账（房主本地直接调 + relay 回显也调，靠 rewardId 去重防双发）：
  // 关键——房主清掉本体后必须本地立即入账+弹窗，不能只 relay 等服务器回显（断线/单机时回显丢失会导致清本无奖励）。
  function applyRaidReward(rw: any) {
    if (!rw?.rewardId || appliedRewardRef.current[rw.rewardId]) return;
    appliedRewardRef.current[rw.rewardId] = true;
    try { const I = useItems.getState(); for (const [k, v] of Object.entries(rw.currency || {})) I.adjustCurrency(k as any, Number(v) || 0); } catch (e) { console.warn('[Raid] 奖励货币入账失败', e); }
    try { if (rw.potentialPoints) useSkillTree.getState().grantBonusPP('B1', Number(rw.potentialPoints) || 0); } catch (e) { console.warn('[Raid] 奖励潜能点入账失败', e); }
    try { for (const it of (rw.items || [])) useItems.getState().addItem({ name: it.name, category: it.category, gradeDesc: it.gradeDesc, effect: it.effect, quantity: it.quantity } as any); } catch (e) { console.warn('[Raid] 奖励物品入账失败', e); }
    try { if (rw.title) useCharacters.getState().addTitle('B1', rw.title); } catch (e) { console.warn('[Raid] 奖励称号入账失败', e); }
    useMp.getState()._set({ raidReward: rw });
  }
  const combatFinishingRef = useRef(false);
  // 战斗最终 HP/EP（finishBattle 写入）：下一回合（玩家发送战斗复盘后）防双扣——
  // 跳过正文 HP 抽取，并在演化对账后把战斗结算值压回，免得 AI 复盘把已扣的血再扣一遍。
  const combatSettledRef = useRef<{ hp: Record<string, number>; ep: Record<string, number> } | null>(null);
  useEffect(() => {
    const C = useCombat.getState();
    const b = C.battle;
    if (useMp.getState().status === 'connected' && useMp.getState().role && useMp.getState().role !== 'host') return;  // 来宾不本地驱动战斗，只渲染房主广播的快照
    if (!b.active || C.apiBusy || combatDrivingRef.current || combatFinishingRef.current) return;
    if (b.stage === 'ended') { raidRef.current = null; setHostTakeover((p) => (p.length ? [] : p)); return; }
    if (checkRaidPhase()) return;   // 组队讨伐：boss 血量跨阶段 → 换招+词缀+台词，本轮让位给重渲染
    if (raidRoundTick()) return;    // 组队讨伐：每回合机制（燃域群伤/点名重击），本轮让位给重渲染
    const victor = checkEnd(b);
    if (victor) { void finishBattle(victor); return; }
    const cur = currentActorId(b);
    if (!cur) return;
    const curSide = b.participants[cur]?.side ?? 'enemy';
    const isPC = playerControlled(cur, curSide, C.config.manualAllyControl);
    if (b.stage === 'awaiting_npc') {
      if (isPC) return;                                          // 保险：被玩家控的不自动
      void runNpcTurn(cur);                                       // NPC / AI 托管队友回合
    } else if (b.stage === 'awaiting_player' && C.config.autoBattle && isPC && !cur.startsWith('MP_')) {
      void runNpcTurn(cur);                                       // 自动战斗：本地玩家回合也由本地 AI 代打
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combatActive, combatStage, combatTurn, combatRound, combatApiBusy, combatAuto]);

  // 联机·房主：战斗每步把 battle 广播给全房（来宾观战，只读渲染）
  useEffect(() => {
    const mp = useMp.getState();
    if (mp.status !== 'connected' || mp.role !== 'host') return;
    mpClient.publishCombat({ battle: useCombat.getState().battle });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combatActive, combatStage, combatTurn, combatRound, combatApiBusy]);

  // 联机·房主：来宾(MP_)战斗角色 AFK 接管。每回合开局先收回该角色的接管标记（来宾回归即自动夺回控制权）；
  // 45s 无操作 → 解锁「房主接手该角色」（CombatPanel 显示其操作面板，房主可亲自出手）；再 45s 仍无人操作 → 自动防御兜底防卡死。
  useEffect(() => {
    if (!(mpStatus === 'connected' && mpRole === 'host')) { setHostTakeover((p) => (p.length ? [] : p)); return; }
    const b0 = useCombat.getState().battle;
    if (!b0.active || b0.stage !== 'awaiting_player') return;
    const cur = b0.order[b0.turn];
    if (!cur || !cur.startsWith('MP_')) return;   // 仅托管来宾(MP_)的回合
    setHostTakeover((prev) => (prev.includes(cur) ? prev.filter((id) => id !== cur) : prev));   // 新回合：先收回，给来宾一个出手窗口
    let t2: ReturnType<typeof setTimeout> | undefined;
    const t1 = setTimeout(() => {
      const cc = useCombat.getState();
      if (!(cc.battle.active && cc.battle.stage === 'awaiting_player' && cc.battle.order[cc.battle.turn] === cur && !cc.apiBusy)) return;
      setHostTakeover((prev) => (prev.includes(cur) ? prev : [...prev, cur]));   // 解锁接管：房主 CombatPanel 显示该来宾角色的操作面板
      t2 = setTimeout(() => {
        const c2 = useCombat.getState();
        if (c2.battle.active && c2.battle.stage === 'awaiting_player' && c2.battle.order[c2.battle.turn] === cur && !c2.apiBusy) {
          void submitCombatPlayerAction('defend', []);   // 房主也未接手 → 自动防御兜底，防 AFK 卡死全场
        }
      }, 45000);
    }, 45000);
    return () => { clearTimeout(t1); if (t2) clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpStatus, mpRole, combatStage, combatTurn, combatActive]);
  const [combatSetupOpen, setCombatSetupOpen] = useState(false);  // 外置发起战斗：在场 NPC 选择器
  const [arenaPanelOpen, setArenaPanelOpen] = useState(false);    // 竞技场面板
  const miscParadiseTime = useMisc((s) => s.paradiseTime);
  const miscWorldTime    = useMisc((s) => s.worldTime);
  const miscWorldName    = useMisc((s) => s.worldName);
  const miscWeather      = useMisc((s) => s.weather);
  const miscWeatherFxCss = useMisc((s) => s.weatherFxCss);
  const miscWeatherFxKey = useMisc((s) => s.weatherFxKey);
  const weatherFxOn      = useSettings((s) => s.weatherFx);
  const appearanceMode   = useSettings((s) => s.appearance);   // 外观护眼色调（classic/eyecare/warm）→ <html data-appearance>
  const uiVignette       = useSettings((s) => s.uiVignette);   // 背景暗角氛围 → <html data-vignette>
  const uiTheme          = useSettings((s) => s.uiTheme);      // 主题配色（整体界面色+文字色）→ 改写 <html> 上的 --c-* 变量
  // ── 游戏音效（懒加载 Howler·缺音频文件静默）──
  const audioCfg = useSettings((s) => s.audio);
  const prevChatUnread = useRef<number | null>(null);
  useEffect(() => { setAudioSettings(audioCfg); }, [audioCfg]);   // 设置 → 音效引擎
  // 外观美化：把护眼色调 / 暗角写到 <html> 属性，由 index.css 的固定滤镜层响应（全局生效、不影响布局与点击）
  useEffect(() => { document.documentElement.setAttribute('data-appearance', appearanceMode || 'classic'); }, [appearanceMode]);
  useEffect(() => { document.documentElement.setAttribute('data-vignette', uiVignette ? '1' : '0'); }, [uiVignette]);
  useEffect(() => { applyUiTheme(uiTheme); }, [uiTheme]);   // 主题配色：把 --c-* 变量改写到 <html>（含浅色标记 data-ui-light）
  // 正文字体选「霞鹜文楷」时才懒加载其 webfont CSS（分块 woff2，仅用到的字形下载）；加载一次即留存，切走不卸载
  useEffect(() => {
    if ((reading.fontFamily || 'default') === 'kai' && !document.getElementById('lxgw-wenkai-css')) {
      const l = document.createElement('link');
      l.id = 'lxgw-wenkai-css'; l.rel = 'stylesheet'; l.href = LXGW_WENKAI_CSS;
      document.head.appendChild(l);
    }
  }, [reading.fontFamily]);
  // 观察各演化阶段状态日志：命中「失败」→记一笔持久标记（日志 8s 后自动清空也不影响）；命中「✓」成功→清除。供「重算单项变量」菜单标红对应项。
  // 另两处清除：① 新回合重跑全部演化时(runPostNarrativePhases 开头 setPhaseFail({})) ② 从菜单重 ROLL 该项时乐观清除。
  useEffect(() => {
    const pairs: [string, string][] = [
      ['item', itemPhaseLog], ['player', playerPhaseLog], ['npc', npcPhaseLog],
      ['faction', factionPhaseLog], ['territory', territoryPhaseLog], ['team', teamPhaseLog],
      ['cosmos', cosmosPhaseLog], ['misc', miscPhaseLog], ['image', imagePhaseLog],
    ];
    setPhaseFail((prev) => {
      let n = prev, changed = false;
      for (const [k, log] of pairs) {
        if (/失败/.test(log) && !prev[k]) { if (!changed) { n = { ...prev }; changed = true; } n[k] = true; }
        else if (/✓/.test(log) && prev[k]) { if (!changed) { n = { ...prev }; changed = true; } delete n[k]; }
      }
      return changed ? n : prev;
    });
    // 「正在重 ROLL」：该阶段日志一出现 ✓/失败（=跑完）就清除（misc 无完成日志，靠 markBusy 的兜底超时清）
    setPhaseBusy((prev) => {
      let n = prev, changed = false;
      for (const [k, log] of pairs) {
        if (prev[k] && /✓|失败/.test(log)) { if (!changed) { n = { ...prev }; changed = true; } delete n[k]; }
      }
      return changed ? n : prev;
    });
  }, [itemPhaseLog, playerPhaseLog, npcPhaseLog, factionPhaseLog, territoryPhaseLog, teamPhaseLog, cosmosPhaseLog, miscPhaseLog, imagePhaseLog]);
  useEffect(() => {   // 天气环境音：随顶栏天气切换（仅任务世界有天气；回归乐园/无天气→停）
    const kind = (!!miscWeather && !isHomeWorld(miscWorldName)) ? parseWeather(miscWeather).kind : 'none';
    setAmbient(kind);
  }, [miscWeather, miscWorldName]);
  useEffect(() => {   // 聊天室新消息提示音（未读数变多时；首帧不响）
    if (prevChatUnread.current !== null && chatUnread > prevChatUnread.current) playSfx('msg');
    prevChatUnread.current = chatUnread;
  }, [chatUnread]);

  const [started, setStarted] = useState(false);
  const [creating, setCreating] = useState(false);   // 角色创建页
  const [b1Notice, setB1Notice] = useState('');       // 主角自检兜底：自动恢复后的提示横幅
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState<'player' | 'menu' | null>(null); // 手机端：左角色栏 / 右导航 抽屉
  const [inputValue, setInputValue] = useState(() => { try { return localStorage.getItem('drpg-chat-draft') || ''; } catch { return ''; } });   // 输入草稿持久化：误触返回/刷新/崩溃也不丢已输入的行动
  const [openChoiceIds, setOpenChoiceIds] = useState<Set<number>>(new Set());   // 剧情选项：按楼层展开（附在正文末尾，点击查看；默认收起）
  const [choicesRevarOpen, setChoicesRevarOpen] = useState(false);             // 「重新生成 选项/同人/事实/小剧场」方向提示词弹窗
  const [choicesDir, setChoicesDir] = useState('');                            // 上述弹窗的自定义方向提示词（可留空）
  const [worldBarOpen, setWorldBarOpen] = useState(false); // 选择世界/结算任务 按钮行（默认收起，点状态栏展开，省空间）
  const [rawResponse, setRawResponse] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [promptSent, setPromptSent] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [injectedMem, setInjectedMem] = useState('');   // 上次注入正文的记忆/档案块（叙事记忆+结构化档案）
  const [showInjected, setShowInjected] = useState(false);
  const [showDevPrompt, setShowDevPrompt] = useState(false);
  const [debugParts, setDebugParts] = useState<PromptPart[]>([]);
  const [worlds, setWorlds] = useState<WorldOption[]>([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [prevWorlds, setPrevWorlds] = useState<WorldOption[]>([]);
  const [prevInput, setPrevInput] = useState('');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);      // 对话滚动容器
  const stickBottomRef = useRef(true);                     // 是否吸附底部（用户上滑查看时置 false，流式生成不再强拉到底）
  const msgId = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);   // 始终镜像 messages，供 callApi 取到最新历史（避免 setState 后闭包仍是旧值）
  const illustClickTimer = useRef<number | null>(null);   // 正文配图单击/双击消歧：单击延时开灯箱，双击则取消并重生成
  const storyRegenBusy = useRef<Set<string>>(new Set());  // 正文配图重生成防连点（key=msgId:idx）
  const progImgRef = useRef<{ offset: number; dispatched: number }>({ offset: 0, dispatched: 0 });  // 「边写边出」：流式期间已处理到的字符 offset + 已派发出图段数（每回合重置）
  const [storyImgBusyId, setStoryImgBusyId] = useState<number | null>(null);   // 手动「为本回合生图」：正在生图的楼层 id（防并发 + 按钮态）
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoSaveTurn = useRef(-1);   // 本回合是否已自动存过：防同回合内(生图/选项等异步改 messages 反复触发定时器)重复自动存、刷出多份🛟备份
  const abortRef = useRef<AbortController | null>(null);   // 正文生成中止控制器（停止生成用）
  const stopAllRef = useRef(false);   // 「停止生成全部变量」：置位后各演化/生图循环 bail；新一轮生成开头复位
  const [canUndo, setCanUndo] = useState(false);           // 是否有可回退的上一回合
  const [confirmAction, setConfirmAction] = useState<null | { title: string; desc: string; run: () => void }>(null); // 回退/重新生成的确认弹窗
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);   // 正在编辑的正文楼层 id
  const [editDraft, setEditDraft] = useState('');                          // 编辑中的正文草稿
  const chatInputRef = useRef<HTMLTextAreaElement>(null);                  // 主聊天输入框（供「使用物品」填入后聚焦）

  // 输入框草稿通道：背包等深层组件把「使用XX」填入输入框（露出输入框 + 聚焦，由用户确认后再发送）
  const composerDraft = useComposer((s) => s.draft);
  useEffect(() => {
    if (!composerDraft) return;
    setInputValue(composerDraft);
    setBackpackOpen(false);   // 若从「储存空间」弹窗触发，关掉它露出输入框
    useComposer.getState().fill('');   // 一次性消费，清空草稿
    setTimeout(() => chatInputRef.current?.focus(), 0);
  }, [composerDraft]);
  // 输入草稿持久化：随输入存 localStorage，发送后(inputValue→'')自动清；刷新/误触返回/崩溃后自动恢复，绝不丢已输入的行动
  useEffect(() => {
    try { if (inputValue) localStorage.setItem('drpg-chat-draft', inputValue); else localStorage.removeItem('drpg-chat-draft'); } catch { /* */ }
  }, [inputValue]);

  useEffect(() => {
    messagesRef.current = messages;
    // 仅当用户已在底部附近时才自动跟随（上滑查看时不强拉到最新，解决"流式生成时被强制拽到底"）
    if (stickBottomRef.current) messagesEndRef.current?.scrollIntoView({ behavior: generating ? 'auto' : 'smooth' });
  }, [messages, generating]);

  // 联机·来宾：收到房主广播的正文 → 渲染进主聊天（房主自己已本地添加，跳过以免重复）
  useEffect(() => {
    useMp.getState().setHandlers({
      onWorld: (payload: any, isReplay?: boolean) => {
        if (useMp.getState().role === 'host') return;
        applyWorldSnapshot(payload?.world);   // 来宾：同步房主世界(NPC/势力/世界状态)进本地面板（恒收广播=单一房主权威正文，分头行动也由房主写在同一份里）
        if (isReplay) return;                 // 中途加入的状态回放：正文交给 narrative_log，不重复追加
        const t = payload?.narrative;
        if (t) {
          const mid = ++msgId.current;
          setMessages((prev) => [...prev, { id: mid, role: 'assistant', content: String(t) }]);
          if (useMp.getState().guestPovOn) void runGuestPovRewrite(String(t), mid);   // 来宾：用自己 API 把客观正文改写成本人视角(display-only，失败保留原文)
          void runGuestSelfEvolution(String(t));   // 来宾：用自己的 API 演化自己的角色(始终基于客观正文，不受改写影响)
        }
      },
      onNarrativeLog: (entries: { role: string; content: string }[]) => {
        if (useMp.getState().role === 'host' || !entries?.length) return;   // 中途加入：把房主正文进度补进聊天
        const msgs = entries.map((e) => ({ id: ++msgId.current, role: (e.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: String(e.content || '') }));
        setMessages((prev) => [...prev, { id: ++msgId.current, role: 'system' as const, content: '—— 已接入房主的剧情进度 ——' }, ...msgs]);
      },
      onCombat: (payload: any) => {
        if (useMp.getState().role === 'host') return;
        if (payload?.battle) useCombat.setState({ battle: payload.battle });   // 来宾：渲染房主广播的战斗态
        const seat = useMp.getState().mySeatId;   // 把自己的技能注到 MP_<座位> 下，战斗面板技能下拉才认得
        if (seat && !useCharacters.getState().characters[`MP_${seat}`]) {
          const sk = useCharacters.getState().characters['B1']?.skills || [];
          try { useCharacters.setState((s) => ({ characters: { ...s.characters, [`MP_${seat}`]: { id: `MP_${seat}`, skills: sk, traits: [] } } })); } catch {}
        }
      },
      onCombatAction: (payload: any) => {
        if (useMp.getState().role !== 'host') return;
        void submitCombatPlayerAction(payload?.kind, payload?.targetIds || [], payload?.skillId, payload?.itemId);   // 房主：替来宾的战斗角色结算其出手
      },
      onRelay: (m) => {
        const from = m.from;
        switch (m.event) {   // m.payload 按 event 收窄（见 mpProtocol RelayPayloads）
          case 'gift_offer':
            if (m.payload?.toPlayerId === myPlayerId()) useMp.getState()._set({ incomingGift: { ...m.payload, from } });   // 收件人弹窗
            break;
          case 'gift_response':
            onGiftResponse(m.payload);   // 赠予方：拒收/超时退回
            break;
          case 'share': {
            const c = { id: 'sh_' + Date.now() + Math.random().toString(36).slice(2, 5), name: from?.name || '', role: from?.role || 'player', share: m.payload, at: Date.now() };
            useMp.getState()._set({ comments: [...useMp.getState().comments, c].slice(-100) });   // 分享 → 房间聊天卡片
            break;
          }
          case 'raid_boss':
            if (useMp.getState().role !== 'host') useMp.getState()._set({ raidBoss: m.payload });   // 来宾：同步房主生成的 BOSS 预览
            break;
          case 'raid_loot':
            useMp.getState()._set({ raidLoot: { ...m.payload, results: null } });   // 全员：弹战利分配窗
            try { useItems.getState().adjustCurrency('乐园币', Number(m.payload.currency) || 0); } catch {}   // 货币全员均得
            break;
          case 'raid_roll':
            if (useMp.getState().role === 'host') {   // 房主：收集各人投点
              const lid = m.payload?.lootId; if (lid) { raidRollsRef.current[lid] = raidRollsRef.current[lid] || {}; raidRollsRef.current[lid][from?.playerId] = { name: from?.name, picks: m.payload.picks }; }
            }
            break;
          case 'raid_loot_result': {
            const lt = useMp.getState().raidLoot;
            if (lt && m.payload?.lootId === lt.lootId) {
              for (const it of (lt.items || [])) { const r = m.payload.results?.[it.id]; if (r?.winnerId === myPlayerId()) { try { useItems.getState().addItem({ name: it.name, category: it.category, gradeDesc: it.gradeDesc, effect: it.effect, quantity: it.quantity } as any); } catch {} } }
              useMp.getState()._set({ raidLoot: { ...lt, results: m.payload.results } });
            }
            break;
          }
          case 'raid_dungeon':
            if (useMp.getState().role !== 'host') useMp.getState()._set({ raidDungeon: m.payload });   // 来宾：同步副本进度（含解散=null）
            break;
          case 'raid_reward':
            applyRaidReward(m.payload);   // 副本通关豪华奖励：全员（含房主 relay 回显）各自把全套入账到自己 B1，并弹庆祝结算（rewardId 去重防双发）
            break;
          case 'solo_toggle': {   // 分头行动：维护全房「谁在分头行动」的显示列表（仅显示，行动仍由房主统一写进同一份正文）
            const sset = new Set(useMp.getState().splitSeats);
            if (m.payload.solo) sset.add(m.payload.seatId); else sset.delete(m.payload.seatId);
            useMp.getState()._set({ splitSeats: Array.from(sset) });
            break;
          }
          case 'hidden_sync':   // 隐藏结局：来宾同步房主广播的条件库（目标 + 解锁状态显示）
            if (useMp.getState().role !== 'host') useMp.getState()._set({ hiddenConditions: (m.payload.conditions || []) as any });
            break;
          default: { const _exhaustive: never = m; void _exhaustive; }   // 新增 relay 事件却没在此处理 → 编译期报错（穷尽性守卫）
        }
      },
      onGuestJoin: () => {   // 来宾进房：把当前单机态快照到保留槽，隔离单机存档（联机存档）
        try { void saveSlot('mp-solo-backup', '🔙 联机前·单机备份', messagesRef.current); } catch (e) { console.warn('[MP] 单机备份失败', e); }
      },
      onGuestRestore: async () => {   // 来宾离开/关房：还原单机存档（loadSlot 会整页 reload；无备份则 no-op）
        try { await loadSlot('mp-solo-backup'); } catch (e) { console.warn('[MP] 单机还原失败', e); }
      },
      onStartRaid: (boss: any) => { if (useMp.getState().role === 'host') startRaidCombat(boss); },   // 房主：开战组队讨伐
      onRaidTally: () => { if (useMp.getState().role === 'host') tallyRaidLoot(); },   // 房主：结算战利分配
      onGenRaidBoss: (opts: any) => { if (useMp.getState().role === 'host') void genRaidBossAI(opts?.theme || '', opts?.difficulty || 'normal'); },   // 房主：AI 现生 BOSS
      onStartDungeon: (opts: any) => { if (useMp.getState().role === 'host') startRaidDungeon(opts?.difficulty || 'normal', opts?.kind || 'bakal'); },   // 房主：开启副本（巴卡尔/安图恩）
      onStartDungeonEncounter: (encId: any) => { if (useMp.getState().role === 'host') startDungeonEncounter(String(encId)); },   // 房主：开打副本某一场
      onGenHidden: () => { void genHiddenConditions(); },   // 隐藏结局：房主编织跨玩家条件
    });
  }, []);

  // 滚动监听：判断是否贴近底部（贴近=继续吸附跟随；上滑超过阈值=暂停跟随）
  function onChatScroll() {
    const el = chatScrollRef.current;
    if (!el) return;
    stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  // 进入/返回游戏界面（关设置、选完世界、读档进入等）时，跳到最新对话底部——修复"返回后回到顶层最早对话"
  useEffect(() => {
    if (started && !settingsOpen && worlds.length === 0) {
      requestAnimationFrame(() => {
        const el = chatScrollRef.current;
        if (el) { el.scrollTop = el.scrollHeight; stickBottomRef.current = true; }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, started, worlds.length]);

  // 打开公共频道时：内容为空或距上次刷新过久则懒刷新一批（手动 🔄 强制刷新）
  useEffect(() => {
    if (channelPanelOpen) refreshChannel(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelPanelOpen]);

  /* 每回合结束（生成完成、末条为正文）后，延时自动存档到固定槽（覆盖式）。
     延时是为了等 NPC/物品/势力等并发演化阶段写完 store，使存档包含本回合变化。
     注：「回合洞察」快照已改为在 runPostNarrativePhases 里各演化阶段 settle 后即时抓（更准）；这里的 captureTurnSnapshot 仅作兜底（同回合覆盖，不会重复）。 */
  useEffect(() => {
    if (!started || generating) return;
    if (!chatHydrated.current) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      captureTurnSnapshot();   // 回合洞察快照(轻量·非存档)始终抓，与自动存档开关无关
      // 自动存档：受设置「自动存档总开关 + 每N回合」控制；关掉/未到频率则不写自动档（省内存·防大档撑爆）。手动「新建/覆盖存档」不受影响。
      const st = useSettings.getState();
      const t = turnCountRef.current;
      // 同一回合只自动存一次：生图/选项/同人等异步会在回合结束后陆续改 messages，每次都重排这个定时器并再次触发，
      // 不设这道闸就会一回合刷出好几份🛟自动备份。改用「本回合已存过就跳过」，每回合至多一份。
      if (st.autoSaveEnabled !== false && lastAutoSaveTurn.current !== t && t % Math.max(1, st.autoSaveEvery || 1) === 0) {
        lastAutoSaveTurn.current = t;
        void autoSaveSlot(messagesRef.current);
      }
    }, 20000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [messages, generating, started]);

  const chatHydrated = useRef(false);

  // 挂载：从 IndexedDB 读回上次对话（跨刷新自动保留）；读档后自动进入游戏
  useEffect(() => {
    (async () => {
      // 世界书/正文世界书/文本预设改存 IndexedDB（localStorage 太小）：先回填用户自有，迁移旧 localStorage 残留，再补内置，最后开镜像
      try {
        const wb = await loadWb();
        if (wb) {
          useSettings.setState({ worldBooks: wb.worldBooks ?? [], textWorldBooks: wb.textWorldBooks ?? [], textPresets: wb.textPresets ?? [] });
        } else {
          const c = useSettings.getState();   // IndexedDB 为空：把老版本残留在 localStorage 的世界书迁移过来
          if (c.worldBooks?.length || c.textWorldBooks?.length || c.textPresets?.length) {
            await saveWb({
              worldBooks: c.worldBooks.filter((b: any) => !b.builtin),
              textWorldBooks: c.textWorldBooks.filter((b: any) => !b.builtin),
              textPresets: c.textPresets.filter((p: any) => !p.builtin),
            });
          }
        }
      } catch { /* */ }
      void loadBuiltinDefaults().finally(markBuiltinsReady);   // 补内置（仅当对应仓库仍为空）；内置项标 builtin、不入库，每次从 public 重载
      try { reconcilePlayerVitals(); } catch { /* */ }   // 载入/旧档：HP/EP 仍是 100/50 旧默认时，开局即按六维拉满（不等到第一回合）
      try { syncPlayerVitalsMax(); } catch { /* */ }   // 刷新/读档：只同步存储上限到真实上限+夹回超出值；当前 HP/EP 忠于正文末尾结算、原样保留（不强行拉满）
      // 镜像：世界书/预设变化（剔除 builtin 内置项）→ 防抖写入 IndexedDB
      { let wbT: ReturnType<typeof setTimeout> | null = null; let wbLast: any[] | null = null;
        useSettings.subscribe((s) => {
          const ref = [s.worldBooks, s.textWorldBooks, s.textPresets];
          if (wbLast && wbLast[0] === ref[0] && wbLast[1] === ref[1] && wbLast[2] === ref[2]) return;
          wbLast = ref; if (wbT) clearTimeout(wbT);
          wbT = setTimeout(() => saveWb({
            worldBooks: s.worldBooks.filter((b: any) => !b.builtin),
            textWorldBooks: s.textWorldBooks.filter((b: any) => !b.builtin),
            textPresets: s.textPresets.filter((p: any) => !p.builtin),
          }), 800);
        });
      }
      // 版本「已更新」提示：仅老玩家、且版本号变化时弹一次（纯提示，不动存档/预设/世界书）
      try {
        const sv = localStorage.getItem('zs-seen-version');
        if (sv && sv !== APP_VERSION) setShowVer(true);
        localStorage.setItem('zs-seen-version', APP_VERSION);
      } catch { /* */ }
      // 申请持久化存储：防浏览器在存储紧张时整源淘汰 IndexedDB（"手动存档过段时间消失、只剩自动档"的根因）
      void requestPersistentStorage();
      // 图片：从 IndexedDB 回填 avatar/image 到各 store（localStorage 已不存图），再开启自动镜像
      try { await hydrateImages(); } catch { /* */ }
      initImageSync();
      const loaded = await chatDb.loadAll();
      if (loaded.length) {
        setMessages(loaded as any);
        msgId.current = loaded.reduce((mx, x) => Math.max(mx, x.id ?? 0), 0);
      }
      // 回合数：以持久化「累计总回合数」(miscStore.turnCount，每次发送+1·跨任务世界/刷新/读档都不归零) 为准；
      // 与对话里的用户消息数取较大值，兼容无此字段的旧档。**进入世界会清空对话**，若仍按"对话用户消息数"会被重置成
      // 新世界的局部回合数——这正是"回合数进世界就归零"的根因；改用持久化累计值后不再归零。
      turnCountRef.current = Math.max(useMisc.getState().turnCount ?? 0, (loaded as any[]).filter((m) => m.role === 'user').length);
      try { useMisc.getState().setTurnCount(turnCountRef.current); } catch { /* 回填持久化累计回合数：旧档迁移 + 与存档预览口径一致 */ }
      chatHydrated.current = true;
      try { useCharacters.getState().dedupeIds(); } catch { /* 修复历史存档的重复技能 id */ }
      try { useCharacters.getState().dedupeRecipes(); } catch { /* 修复历史存档的重复配方（去「配方：」前缀后合并） */ }
      try { useItems.getState().normalizeEquipSlots(); } catch { /* 规范化历史非规范装备槽（armor:armor→armor:upper 等），使装备面板与背包一致 */ }
      try { const f = useNpc.getState().normalizeNpcIds(); if (f) console.log(`[NPC] 启动时规范化非法ID ${f} 个`); } catch { /* 修复历史存档里 AI 自创的非法ID(如 P_Aesc)，否则其属性更新被丢弃、面板点不开 */ }
      try { ensureNpcLuck(); ensureNpcVitalsCap(); } catch { /* 载入时一次性把在场 NPC 幸运按前端独占规则重算(治旧档 AI 乱给的高/乱幸运；保留 luckDelta 剧情增减) */ }
      // 主角自检兜底：B1 技能/天赋异常空但对局在进行中 → 从镜像自动补回（治"读档/回退误清角色库后主角莫名空白"）
      try { const rb = restoreB1IfWiped(); if (rb) { setB1Notice(`检测到主角技能/天赋异常丢失，已自动从镜像兜底恢复：技能${rb.counts.skills} / 天赋${rb.counts.traits} / 副职业${rb.counts.subProfessions}`); console.warn('[B1自检] 已自动从镜像恢复', rb.counts); } } catch { /* */ }
      try { setCanUndo(await undoPointHasChat()); } catch { /* */ }   // 仅当回退点**有真实对话**才亮按钮（空回退点会清屏，当无回退点处理）
      if (sessionStorage.getItem(PENDING_STARTED_KEY)) {
        setStarted(true);
        sessionStorage.removeItem(PENDING_STARTED_KEY);
      }
      // 仅重算变量：回退点已 reload 恢复 → 复用本回合原正文重跑演化（不重新生成正文）
      const revar = sessionStorage.getItem(PENDING_REVAR_KEY);
      if (revar) {
        sessionStorage.removeItem(PENDING_REVAR_KEY);
        setStarted(true);
        try { const { input, narrative } = JSON.parse(revar); setTimeout(() => { reprocessVars(narrative, input || ''); }, 400); }
        catch (e) { console.warn('[Revar] 解析待重算数据失败:', e); }
      }
      // 重新生成：回退点已 reload 恢复，自动重发同一条输入（演化不叠加）
      const regen = sessionStorage.getItem(PENDING_REGEN_KEY);
      if (regen) {
        sessionStorage.removeItem(PENDING_REGEN_KEY);
        setStarted(true);
        // 等「补种」把 textPresets 填好再重发：loadBuiltinDefaults 要先 fetch 一堆大文件才填 textPresets，常超 400ms；
        //   若此刻就发会在空库瞬间发出→预设没注入(722)。轮询有了即发，最多 ~10s 兜底（真没预设也照发，不卡死）。
        // 等内置补种「全部」就绪（含正文世界书，非仅 textPresets）再重发——否则 reroll reload 后赶在世界书加载完前发出 → 偶发没世界书/722。
        { void builtinsReady.then(() => sendMessage(regen)); }
      }
    })();
  }, []);

  // 一次性迁移：把历史已存物品(背包+NPC持有)的复合品级收敛为单一档。
  // 读档=reload，故每个存档加载时自愈一次；幂等（清完后 normalize* 返 0、不写盘）。
  useEffect(() => {
    try {
      const a = useItems.getState().normalizeGrades();
      const b = useNpc.getState().normalizeItemGrades();
      if (a + b) console.log(`[Item] 历史品级收敛迁移：背包 ${a} 件 + NPC持有 ${b} 件 → 单一档`);
    } catch (e) { console.warn('[Item] 品级迁移失败:', e); }
  }, []);

  // 对话变化时增量写入 IndexedDB（流式只写变化的 1 条；hydrate 完成前不写，避免覆盖）
  useEffect(() => {
    if (!chatHydrated.current) return;
    chatDb.putChanged(messages as any);
  }, [messages]);

  // 对文本执行正则替换
  // placement=1 是我们的 AI输出，placement=2 是 ST 原始 AI输出（兼容已存储的旧数据）
  function applyRegex(text: string, preset: (typeof textPresets)[0] | undefined): string {
    const all = [...globalRegexScripts, ...(preset?.regexScripts ?? [])];
    const scripts = all.filter((s) => !s.disabled && (s.placement.includes(1) || s.placement.includes(2)) && s.findRegex);
    console.log(`[正则] 共 ${all.length} 条，过滤后执行 ${scripts.length} 条`, scripts.map((s) => ({ name: s.scriptName, find: s.findRegex, flags: s.flags, placement: s.placement })));

    let result = text;
    // ── 安全网：隐藏常见「思考/推理」标签块（dotAll），即便用户正则漏配或模型变体也兜底 ──
    //   覆盖 <thinking>/<think>/<reasoning>/<reason>/<plan>/<analysis>/<scratchpad>/<cot> 配对标签
    result = result.replace(/<(thinking|think|reasoning|reason|plan|analysis|scratchpad|cot)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    // ── 安全网：折叠失控复读（极其极其…），即便用户没配反复读正则也兜底，防最终文本仍带成千上万字重复 ──
    result = collapseRunaway(result);
    for (const s of scripts) {
      try {
        // 兼容存量数据：运行时再剥一次 /pattern/flags 格式
        let pattern = s.findRegex;
        let rawFlags = s.flags || '';
        if (pattern.startsWith('/')) {
          const last = pattern.lastIndexOf('/');
          if (last > 0) {
            rawFlags = pattern.slice(last + 1) + rawFlags;
            pattern  = pattern.slice(1, last);
          }
        }
        if (!pattern) continue;
        // 去重 + 只保留合法字符
        const flags = [...new Set(rawFlags)].filter((c) => /[gimsuy]/.test(c)).join('') || 'g';
        const re = new RegExp(pattern, flags);
        const before = result;
        result = result.replace(re, s.replaceString);
        // 兜底重试：未命中 + 含 `.` + 缺 dotAll 时，补 s 标志再试一次
        //   （绝大多数"隐藏思考过程/多行块"漏匹配都是因为忘了 s 标志，导致 . 不跨行）
        if (result === before && /\./.test(pattern) && !flags.includes('s')) {
          try {
            const reS = new RegExp(pattern, flags + 's');
            const retried = result.replace(reS, s.replaceString);
            if (retried !== result) {
              result = retried;
              console.log(`[正则] ✓ "${s.scriptName}" 命中（自动补 s/dotAll 标志后）`);
            } else {
              console.log(`[正则] ✗ "${s.scriptName}" 未命中（含补 s 重试）| pattern="${pattern}" flags="${flags}"`);
            }
          } catch { /* 补 s 失败则忽略 */ }
        } else if (result !== before) {
          console.log(`[正则] ✓ "${s.scriptName}" 命中并替换`);
        } else {
          console.log(`[正则] ✗ "${s.scriptName}" 未命中 | pattern="${pattern}" flags="${flags}"`);
        }
      } catch (e) {
        console.warn(`[正则] "${s.scriptName}" 执行失败:`, e);
      }
    }
    return result;
  }

  // 从 entries[] 构建系统提示和示例消息
  function buildPresetMessages(preset: (typeof textPresets)[0] | undefined, ctx: string, userInput = '') {
    // 仿 fanren 范式：认 chatHistory marker，把「相对块(非深度注入)」切成 前历史 / 后历史。
    //   前历史 system→合并系统提示、user/assistant→少样本；后历史块→插在真实楼层之后(post-history)。
    //   无 chatHistory marker 的预设（轮回乐园三本）→ 全部当前历史，行为不变。
    // ST 宏引擎：按预设顺序对每个块的 content 求值（setvar→后续 getvar 生效），未识别宏末尾清掉防泄漏。
    //   轮回乐园/双人成行无宏=无操作；让导入的任意 ST 预设不必再手工摊平宏。
    const _macroCtx = makeMacroCtx({
      user: usePlayer.getState().profile?.name || '主角',
      char: usePlayer.getState().profile?.name || '主角',
      lastUserMessage: userInput,
      // 透明变量桥：核心游戏态 + 自定义变量灌进宏上下文，预设可 {{getvar::主角.HP}} / ${世界.名} / {{getvar::好感度}} 直接引用
      runtimeVars: buildRuntimeVars(),
    });
    const enabled = (preset?.entries ?? []).filter((e) => e.enabled).map((e) => ({ ...e, content: processMacros(e.content || '', _macroCtx) }));
    const relative = enabled.filter((e) => e.injection_position !== 1);
    const chatIdx = relative.findIndex((e) => e.marker && e.identifier === 'chatHistory');
    const preRel = chatIdx >= 0 ? relative.slice(0, chatIdx) : relative;
    const postRel = chatIdx >= 0 ? relative.slice(chatIdx + 1) : [];

    // 前历史 system 块 → 拼成系统提示（同时留 sysSegments 给开发者面板）
    const sysBlocks = preRel.filter((e) => !e.marker && (e.role === 'system' || e.system_prompt) && e.content);
    const sysSegments: { label: string; content: string }[] = sysBlocks.map((e) => ({ label: '预设块 · ' + (e.name || e.identifier || '(无名)'), content: e.content }));
    const sysParts = sysBlocks.map((e) => e.content);
    let sysPrompt = sysParts.join('\n\n') || '你是一个沉浸式文字RPG的故事叙述者。';
    if (!sysBlocks.length) sysSegments.push({ label: '⚠ 预设无启用的 system 块（仅用最简默认）', content: sysPrompt });

    // 注入世界书：仿 fanren——若预设有 worldInfoBefore/After 或 charDescription marker，把世界书放到该 marker 的位置+角色（前/后历史）；
    //   否则回落 system 顶部（轮回乐园三本无此 marker → 行为不变）。世界书角色严格按该预设条目的 role。
    const wbMarker = relative.find((e) => e.marker && (e.identifier === 'worldInfoBefore' || e.identifier === 'worldInfoAfter'))
                  || relative.find((e) => e.marker && e.identifier === 'charDescription');
    const wbPost = !!wbMarker && chatIdx >= 0 && relative.indexOf(wbMarker) > chatIdx;
    const wbRole: 'system' | 'user' | 'assistant' = wbMarker
      ? ((wbMarker.role === 'system' || wbMarker.system_prompt) ? 'system' : (wbMarker.role as 'user' | 'assistant'))
      : 'system';
    let worldbook: { role: 'system' | 'user' | 'assistant'; content: string; post: boolean } | null = null;
    if (ctx) {
      if (wbMarker) {
        worldbook = { role: wbRole, content: '[世界书信息]\n' + ctx, post: wbPost };
        sysSegments.push({ label: '世界书 → ' + wbMarker.identifier + ' marker（' + wbRole + (wbPost ? ' · 后历史' : ' · 前历史') + '）', content: ctx });
      } else {
        // 缓存优化：世界书（含向量 RAG 每回合都变）不进 system 顶部——否则 system 每回合不一样、前缀缓存全失效；
        //   改作独立 system 消息放到聊天记录之后（稳定前缀之外、贴近生成）。system 保持稳定 → DeepSeek 等前缀缓存能命中。
        worldbook = { role: 'system', content: '[世界书信息]\n' + ctx, post: true };
        sysSegments.push({ label: '前端 · 世界书信息（独立消息 · 楼层后 · 稳定前缀外·利于缓存）', content: ctx });
      }
    }
    // 主角状态同步：让始终运行的主正文每回合输出位置/外观（前端解析后剥除），不依赖被节流的主角演化阶段
    sysPrompt += '\n\n' + PLAYER_STATE_EMIT_RULE; sysSegments.push({ label: '前端规则 · 主角状态输出', content: PLAYER_STATE_EMIT_RULE });
    // 属性点唯一真相：每回合注入，压住 AI 凭记忆复读"还有N点未用"、禁止其自行增减点数（前端面板加点消耗，注入余额为准）
    sysPrompt += '\n\n' + ATTR_POINT_AUTHORITY_RULE; sysSegments.push({ label: '前端规则 · 属性点唯一真相', content: ATTR_POINT_AUTHORITY_RULE });
    // HP/EP 结算：让主正文每回合末尾输出主角+在场NPC的当前 HP/EP（前端 applyNarrativeVitals/NpcVitals 解析，HP/EP 管理阶段也以此为最终值）
    sysPrompt += '\n\n' + VITALS_SETTLEMENT_EMIT_RULE; sysSegments.push({ label: '前端规则 · HP/EP 结算输出', content: VITALS_SETTLEMENT_EMIT_RULE });
    // 任务击杀目标阶位上限：强制环≤主角阶位、贪婪环≤+1；勿降级剧情高端战力，改派阶位相称的目标
    sysPrompt += '\n\n' + QUEST_KILL_TIER_RULE; sysSegments.push({ label: '前端规则 · 击杀阶位上限', content: QUEST_KILL_TIER_RULE });
    // 任务世界结算：仅当本回合输入含【结算任务】时才注入（平时不喂，省 token、避免误触发）
    if (/【结算任务】/.test(userInput)) { sysPrompt += '\n\n' + WORLD_SETTLEMENT_RULE; sysSegments.push({ label: '前端规则 · 任务世界结算（本回合触发）', content: WORLD_SETTLEMENT_RULE }); }
    // 装备世界书·生成总纲：本回合涉及装备/掉落/打造等时全量注入（让正文 createItem 的品级/评分/数值/词缀合理且机器可读；其余装备生成阶段恒注入）
    if (/装备|武器|防具|饰品|法宝|宝石|掉落|战利品|宝箱|开箱|打造|锻造|锻冶|合成|缴获|搜刮|结算任务/.test(userInput)) { sysPrompt += '\n\n' + EQUIP_CODEX; sysSegments.push({ label: '装备世界书 · 生成总纲（本回合触发）', content: EQUIP_CODEX }); }
    // 主角前端加点 → 一次性事件：玩家在属性面板自行加点(前端确定性结算)，正文看不到此动作 → 注入告知，让叙事"知道"并据此用最新余额（一次性，注入后即清空）
    const allocNotices = drainAllocNotices();
    if (allocNotices.length) {
      const allocBlock = '【主角属性分配·本回合事件】玩家刚在属性面板自行加点，以下为最新结算结果（点数已由前端消耗，正文据此自然带过、勿质疑、勿重发点数）：\n' + allocNotices.join('\n');
      sysPrompt += '\n\n' + allocBlock; sysSegments.push({ label: '前端事件 · 主角属性加点（本回合一次性）', content: allocBlock });
    }

    // 叙事人称：前端「叙事人称」开关 → 注入到 system 最末尾（权重最高，压过预设文风块/历史第三人称惯性）；off=不注入、沿用预设
    const povSel = useSettings.getState().narrativePov;
    if (povSel && povSel !== 'off') {
      const povName = usePlayer.getState().profile?.name || '主角';
      const povRule = buildPerspectiveRule(povSel, povName);
      sysPrompt += '\n\n' + povRule; sysSegments.push({ label: '前端规则 · 叙事人称（' + povSel + '）', content: povRule });
    }

    // 四阶前·真实属性绝对封锁：主角未达四阶(realAttrMult<5)时，正文严禁出现/给予真实属性·真实属性点（含技能/天赋/装备/掉落/任务）；与世界书常驻条目 + 解析器拒收三重保险。
    { const _pp = usePlayer.getState().profile; if (realAttrMult(_pp?.tier, _pp?.level) < 5) { sysPrompt += `\n\n${REAL_POINT_LOCK_RULE}`; sysSegments.push({ label: '前端规则 · 四阶前禁真实属性', content: REAL_POINT_LOCK_RULE }); } }

    // 前历史 user/assistant 条目 → 少样本示例
    const examples = preRel
      .filter((e) => !e.marker && e.role !== 'system' && !e.system_prompt && e.content && e.identifier !== 'prefill')
      .map((e) => ({ role: e.role as 'user' | 'assistant', content: e.content }));

    // 后历史块（chatHistory marker 之后的相对块）→ 插在真实楼层之后（post-history，仿 fanren）
    const tail = postRel
      .filter((e) => !e.marker && e.content && e.identifier !== 'prefill')
      .map((e) => ({
        label: e.name || e.identifier || '(无名)',
        role: (e.role === 'system' || e.system_prompt) ? ('system' as const) : (e.role as 'user' | 'assistant'),
        content: e.content,
      }));

    // 深度注入：injection_position===1 的块（全量，不分前后历史）→ 按 injection_depth 插到对话末尾附近（贴近生成＝高优先，ST 风格）
    const depthInjections = enabled
      .filter((e) => e.injection_position === 1 && e.content && e.identifier !== 'prefill')
      .map((e) => ({
        label: e.name || e.identifier || '(无名)',
        role: (e.role === 'system' || e.system_prompt) ? ('system' as const) : (e.role as 'user' | 'assistant'),
        content: e.content,
        depth: typeof e.injection_depth === 'number' ? e.injection_depth : 4,
      }));

    // 末尾预填充：identifier='prefill' 的 assistant 块改放 messages 最末尾让模型续写
    const prefillEntry = enabled.find((e) => e.identifier === 'prefill' && e.role === 'assistant' && e.content);
    const prefill = prefillEntry?.content ?? '';
    return { sysPrompt, examples, prefill, depthInjections, sysSegments, tail, worldbook };
  }

  // 无预设条目时的内置兜底提示词
  const ITEM_FALLBACK_PROMPT = `你是一个游戏状态追踪助手。根据玩家的正文内容，判断是否发生了物品变化或货币变化，并用结构化指令输出。

## 可用指令格式（<state> 块，每行一条）
- item.add = 物品名          # 玩家获得物品
- item.remove = 物品名       # 玩家失去/使用物品
- item.create = 名称|分类|数量  # 创建物品（分类：武器/防具/饰品/功法/法宝/丹药/符箓/材料/灵药/阵具/重要物品/凡物/其他物品）
- item.consume = 名称|数量   # 消耗物品数量
- 乐园币 += 数字             # 获得乐园币
- 乐园币 -= 数字             # 花费乐园币
- 灵魂钱币 += 数字           # 获得灵魂钱币
- 灵魂钱币 -= 数字           # 花费灵魂钱币

## 规则
- 只根据正文中明确发生的事件输出指令
- 无变化时输出空的 <state></state>
- 禁止输出正文内容，只输出指令块`;

  /* ─── 物品管理手动触发（跳过频率检查）─── */
  async function triggerItemPhaseManually() {
    if (itemPhaseRunning) return;
    // 读档/刷新后 lastNarrativeRef 为空 → 回退到对话历史最后一条正文（与「主角/NPC…」各重算项统一走 revarNarr，免去"先跑一回合"才能重 ROLL 物品）
    const narrative = revarNarr();
    if (!narrative) {
      setItemPhaseLog('⚠ 暂无正文内容，请先发送消息后再手动更新');
      setTimeout(() => setItemPhaseLog(''), 4000);
      return;
    }
    // 临时绕过频率检查：直接调用核心逻辑
    await runItemManagementPhaseCore(narrative);
  }

  /* ─── 物品管理核心执行（供自动和手动共用）─── */
  async function runItemManagementPhaseCore(narrative: string) {
    const itemState = useItems.getState();
    const { settings } = itemState;

    // 检查：API 配置
    const ss = useSettings.getState();
    const legacyApi = itemState.itemUseSharedApi
      ? (ss.textUseSharedApi ? ss.api : ss.textApi)
      : itemState.itemApi;
    const chain = resolveApiChain('item', legacyApi);

    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) {
      console.warn('[Item] API 未配置（设置→物品管理→API设置）');
      setItemPhaseLog('⚠ 物品阶段：API 未配置');
      setTimeout(() => setItemPhaseLog(''), 5000);
      return;
    }

    // 预设条目：有则用，无则用内置兜底
    const allEntries     = settings.entries ?? [];
    const enabledEntries = allEntries.filter((e) => e.enabled);
    const usingFallback  = enabledEntries.length === 0;

    // ── 诊断日志 ──
    console.log('[Item] ========= 物品阶段诊断 =========');
    console.log('[Item] 预设名称:', settings.presetName || '（无）');
    console.log('[Item] 总条目数:', allEntries.length, '| 已启用:', enabledEntries.length);
    console.log('[Item] 使用兜底:', usingFallback);
    if (enabledEntries.length > 0) {
      console.log('[Item] 已启用条目:', enabledEntries.map((e) => `"${e.name}"(${e.content.length}字)`).join(' / '));
    }

    // ── 本回合快照 / 回退 ──
    // 同一回合再次触发物品演化（储存空间「手动更新」=重跑）时，先回退本回合物品演化的修改，再重新演化一次；
    // 否则会在「已经改过一遍」的状态上再叠加（重复 createItem、数量翻倍等）。本回合首次跑则只存快照、不回退。
    // key 用回合数（不用正文串）：自动阶段喂的是「最近N回合窗口」正文、手动喂的是 lastNarrativeRef，串可能不同，但同一回合 turnCount 一致。
    const undoKey = turnCountRef.current;
    let rolledBack = false;
    if (itemPhaseUndoRef.current?.key === undoKey) {
      const snap = itemPhaseUndoRef.current;
      useItems.setState({ items: snap.items, currency: snap.currency });   // 回退主角背包 + 货币（store 更新不可变，旧引用未被改动）
      useNpc.setState((s) => {                                              // 回退各 NPC 持有物（只换 items，保留本回合 NPC 其它演化）
        const npcs = { ...s.npcs };
        for (const [id, its] of Object.entries(snap.npcItems)) if (npcs[id]) npcs[id] = { ...npcs[id], items: its };
        return { npcs };
      });
      rolledBack = true;
      console.log('[Item] 储存空间手动更新：已回退本回合物品演化的修改，重新演化…');
    } else {
      const cur = useItems.getState();
      const npcItems: Record<string, any[]> = {};
      for (const [id, rec] of Object.entries(useNpc.getState().npcs)) npcItems[id] = (rec as any).items ?? [];
      itemPhaseUndoRef.current = { key: undoKey, items: cur.items, currency: cur.currency, npcItems };
    }

    setItemPhaseRunning(true);
    setItemPhaseLog(rolledBack ? '已回退本回合物品变化，重新演化中…' : '物品管理阶段处理中…');
    console.log(`[Item] API 路由: ${chain.length} 条 | 首选 model: ${chain[0]?.modelId}`);

    try {
      // 物品演化发送【全部正文】（不截断），确保整段剧情里的物品/货币变化都能被处理
      const trimmedNarrative = narrative;
      // 注：NPC 初始装备/储物改由码内 backfillNpcStarterKits 在登场时确定性发放（不依赖本阶段时序）；
      //     本阶段对 NPC 物品也只按「明确入手」规则增减（与主角一致），不再强制补全，避免重复/换名生成。

      // system prompt：只放规则，正文放到 user 消息里
      const systemPrompt = (usingFallback
        ? ITEM_FALLBACK_PROMPT
        : buildItemPhaseSystemPrompt(enabledEntries, ''))   // 不在 system 里放正文
        + '\n\n' + NARRATIVE_FIRST_RULE + '\n' + ITEM_FIXED_FORMAT_RULE + '\n' + ITEM_GRADE_TABLE_RULE + '\n' + EQUIP_CODEX
        + '\n【穿戴装备处理·换装≠销毁】① **替换/换装**：穿上新装备时只需对**新装备** equipItem（引擎会自动把同槽位的旧装备卸回储存空间）——被换下来的旧装备**只是脱下放回储存空间、并没有消失，绝对不要对它 destroyItem 或 consumeItem**（这是最常见的误删，务必避免）。② 只有正文**明确**把某件装备"丢弃/扔掉/卖掉/损毁/被夺走/送人"时，才对那件 destroyItem（引擎会自动先卸下再销毁）。③ 不要无故销毁正在穿的装备；已装备物品一律不要 consumeItem。'
        + '\n【destroy/consume 必带物品名+原因】destroyItem/consumeItem **必须带 "name" 字段=物品全名**（与背包清单一致），itemId 用清单里的真实 ID；引擎优先按 name 匹配。**严禁臆造 itemId**——若不确定 ID，只写 name。**还必须带 "reason" 字段**＝一句话说明它为何消失，并据正文如实区分「被使用/消耗」(喝下、吃掉、开启、激活、引爆、投掷…) 还是「损坏/丢弃/失去」(碎裂、熔毁、报废、丢弃、卖掉、送人、被夺走…)——这句会原样显示在「最近删除」里给玩家看。例：destroyItem({"name":"白色宝箱","reason":"开启后化作光点消失"})；destroyItem({"name":"精钢长剑","reason":"被酸液彻底腐蚀熔毁"})；consumeItem({"name":"残旧的止血绷带","quantity":1,"reason":"包扎伤口用掉"})。'
        + '\n' + ITEM_ACQUIRE_RULE
        + '\n' + ITEM_DESTROY_GUARD_RULE
        + '\n【勿重复生成·读已有清单】生成前先核对两份"已有清单"：主角背包(player_items) 与 在场NPC持有物(npc_items)。'
        + '凡清单里**已存在**的物品（哪怕只是名称相近、明显是同一件，如"止血喷雾"vs"次级止血喷雾"）**一律不要再 createItem**——要改就用 updateItem(同 itemId)，数量增减用 updateItemQuantity。'
        + '只有正文里**确实新入手**、且清单里确实没有的物品才 createItem。重复消耗品（如又捡到一瓶同款药剂）也别新建条目，用 updateItemQuantity 给已有条目加数量。'
        + '\n【物品归属·唯一持有者铁则（防串包）】每件物品**只属于一个持有者**：createItem 的 owner 必须是该物品**真正拥有者**的确切编号（玩家=B1；某 NPC=其真实 C 编号，见「NPC 角色注册表」），不要用名字或编错的 ID。'
        + '**玩家给某一个队友买的/某个角色获得的装备，就只进那一个角色的包**——严禁因为"队伍/在场多人"就把同一件（或同名同款）装备复制分发给其他 NPC；正文里属于 A 的东西绝不写到 B 名下。'
        + '一件具体装备只 createItem 一次、owner 只填一个；归属拿不准时，宁可只发给最明确的那一个，也不要复制成多份分给多人。'
        + '\n' + ITEM_UPDATE_RULE + '\n' + FIRST_UPDATE_COMPLETE_RULE + '\n' + ITEM_EXACT_REF_RULE
        + '\n' + ITEM_COT_RULE + '\n' + ITEM_EVOLUTION_CODEX;

      // user 消息：正文 + 指令要求（先思维链 <think> 自检，再出指令块）
      const userContent = `# 本轮正文\n${trimmedNarrative}\n\n---\n请根据以上正文处理本轮物品与货币（乐园币、灵魂钱币）的变化。**先输出一个 <think>…</think> 思考块**，按系统提示里的「物品演化思维链」逐项自检、把跟物品/装备/货币有关的事想清楚；**随后**输出 <state> 和 <upstore> 指令块（无变化则输出空块）。除 <think> / <state> / <upstore> 外不要有任何其它文字。`;

      console.log('[Item] system prompt 长度:', systemPrompt.length,
        '| 前200字:', systemPrompt.slice(0, 200).replace(/\n/g, '↵'));
      console.log('[Item] user 消息长度:', userContent.length);

      // 参数优先使用 preset（覆盖接口默认）；多接口轮流 + 失败 fallback
      const ss2 = useSettings.getState();
      const activePreset = ss2.textPresets.find((p) => p.id === ss2.activeTextPresetId)
        ?? ss2.textPresets[0];
      const extra: Record<string, unknown> = {};
      if (activePreset?.temperature != null) extra.temperature = activePreset.temperature;
      if (activePreset?.max_tokens != null) extra.max_tokens = activePreset.max_tokens;
      if (activePreset?.top_p != null && activePreset.top_p > 0 && activePreset.top_p <= 1) extra.top_p = activePreset.top_p;

      const { content: reply } = await apiChatFallback(chain, [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userContent },
      ], { extra });
      console.log(`[Item] 物品阶段原始响应:`, reply);

      if (reply) {
        // 先剥掉思维链 <think> 块（只用于自检、不参与解析），避免其中的自然语言被误判成指令
        const cleanReply = reply.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim();
        applyAllUpdates(cleanReply);
        // 同名重复物品合并（防 AI 重复 createItem）：主角背包 + 全部 NPC 储存空间
        try { const m = useItems.getState().dedupeByName(); if (m) console.log(`[Item] 合并主角同名重复物品 ${m} 件`); } catch { /* */ }
        try { useNpc.getState().dedupeNpcItems(); } catch { /* */ }
        const itemCmds = parseAllItemCommands(cleanReply);
        const stateUpds = parseAllStateUpdates(cleanReply);
        const total = itemCmds.length + stateUpds.length;
        setItemPhaseLog(
          total > 0
            ? `✓ 物品阶段完成：${itemCmds.length} 条物品指令，${stateUpds.length} 条变量更新`
            : '✓ 物品阶段完成：本轮无变化'
        );
      } else {
        setItemPhaseLog('✓ 物品阶段完成：无输出');
      }
      // 对账纠错已合并：移到 runPostNarrativePhases 里，待主角+物品两阶段都跑完后统一调一次 runMergedAuditPhase
    } catch (e: any) {
      const msg = e.message ?? '未知错误';
      console.error('[Item] 物品管理阶段失败:', msg);
      setItemPhaseLog(`⚠ 物品更新失败：${msg.slice(0, 60)}`);
    } finally {
      setItemPhaseRunning(false);
      setTimeout(() => setItemPhaseLog(''), 8000);
    }
  }

  /* ─── 装备强化·收尾刷装备（主角停止强化时调一次，仅对净涨了强化等级的那件）───
     读装备整张卡 + 旧→新强化等级，让 AI 每跨 4 级加 1 条词缀、并刷新攻防/effect/外观/简介/评分。
     AI 只吐 <upstore> updateItem，复用现有解析；事后再保险把 enhanceLevel 钉回正确值。*/
  async function runEnhanceFinalizePhase(args: { itemId: string; startLevel: number; newLevel: number; tendency?: string }): Promise<{ ok: boolean; changed: boolean; error?: string }> {
    const it = useItems.getState().items.find((x) => x.id === args.itemId);
    if (!it) return { ok: false, changed: false, error: '物品不存在' };
    const lockedLevel = it.enhanceLevel ?? 0;   // 收尾前的"当前实际等级"（可能因降级低于峰值）——词缀按峰值生成，但等级保持此值
    const beforeAffix = it.affix ?? '', beforeEffect = it.effect ?? '';   // 收尾前快照，用于判断 AI 是否真的改动了词缀/效果
    const E = useEnhance.getState();
    const ss = useSettings.getState();
    const legacy = E.enhanceUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : E.enhanceApi;
    const chain = resolveApiChain('enhance', legacy);
    console.log('[Enhance] 收尾尝试', { 物品: it.name, 到加: args.newLevel, 模型: chain[0]?.modelId || '(无)', 地址: chain[0]?.baseUrl || '(无)', 有Key: !!chain[0]?.apiKey, 复用正文: E.enhanceUseSharedApi, 接口数: chain.length });
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) {
      const why = !chain[0]?.baseUrl ? '接口地址(baseUrl)为空' : 'API Key 为空';
      console.warn(`[Enhance] 收尾跳过·未发请求：${why}（复用正文=${E.enhanceUseSharedApi}）→ 去 设置→变量管理→装备强化 把接口填全，或勾「复用正文生成 API」`);
      return { ok: false, changed: false, error: `未发起调用：${why}（设置→变量管理→装备强化→API；或勾「复用正文生成 API」）` };
    }

    const addAffix = Math.max(0, Math.floor(args.newLevel / 3) - Math.floor(Math.max(0, args.startLevel) / 3));
    const card = [
      `itemId: ${it.id}`,
      `名称: ${it.name}`,
      `分类: ${it.category}${it.subType ? ' / ' + it.subType : ''}`,
      `品质(gradeDesc): ${it.gradeDesc || '—'}`,
      `强化峰值: 历史最高 +${args.startLevel} → +${args.newLevel}（词缀按历史最高等级生成；当前实际等级 +${lockedLevel}，降级不影响已有词缀）`,
      `本次强化档数 N=${addAffix}（每 3 级 1 档）：先把已有词缀威力按 ${addAffix} 档上调变强，再新增 ${addAffix} 条全新词缀（每条「【名】：触发+作用」自带说明，**贴合装备主用途、类型多样不只伤害**）；effect 是**非数值特殊性质描述**(对持有者的定性影响)、不写数值不出现词缀名；数值由系统/combatStat 处理`,
      args.tendency && `★【玩家指定的生成方向·最高优先·务必紧扣】：「${args.tendency}」——本次新增/强化的词缀与效果都要朝这个方向走（例：「攻击类」→给斩击破甲连击增伤系；「辅助类」→给增益光环治疗减控系；「挖矿类/采集类」→给采掘提速·产量·矿脉探测系；「隐匿类」→给潜行·消音·感知规避系）。仍要符合装备本身性质，且 effect 仍只写非数值的特殊性质描述（不写数值/不出现词缀名）。`,
      `装备属性成长系数: ${growthCoef(it.gradeDesc, it.score)}（品级×评分得出；越高 → 新词缀/效果越强、攻防增幅越大、越有传说感）`,
      it.combatStat && `当前攻防(combatStat): ${it.combatStat}`,
      it.requirement && `装备需求: ${it.requirement}`,
      it.affix && `现有词缀(affix): ${it.affix}`,
      it.effect && `现有效果(effect): ${it.effect}`,
      it.appearance && `现有外观(appearance): ${it.appearance}`,
      it.intro && `现有简介(intro): ${it.intro}`,
      it.score && `现有评分(score): ${it.score}`,
    ].filter(Boolean).join('\n');

    setItemPhaseLog(`✨ 强化收尾：刷新「${it.name}」+${args.newLevel}…`);
    try {
      const system = ENHANCE_FINALIZE_RULE + '\n' + ITEM_EXACT_REF_RULE + '\n' + EQUIP_CODEX;
      const user = `# 待刷新的强化装备\n${card}\n\n请按【装备强化·收尾刷新铁则】，输出这件装备强化到 +${args.newLevel} 后的 <upstore> updateItem 指令`
        + `（${addAffix > 0 ? `档数 N=${addAffix}：**先**把已有每条词缀威力按 ${addAffix} 档上调变强，**再**新增 ${addAffix} 条各不相同的全新词缀（每条「【名】：触发+作用+持续」自带说明、**禁止只写词缀名**，**且贴合装备主用途、绝不只给伤害类**）；effect 是**非数值的特殊性质描述**(对持有者的定性影响/特质，数值归 combatStat、**不写数值/不出现词缀名/不复述词缀**)；保留 effect 里的【镶嵌加成】不动` : '本次未跨过 3 级整数倍，可不动词缀/效果（攻防/评分/外观/简介已由系统处理）'}）。只输出这一条 updateItem，只改 affix 和 effect。`;
      console.log('[Enhance] 收尾·发起 API 调用 →', chain[0]?.modelId, chain[0]?.baseUrl);
      const { content: reply } = await apiChatFallback(chain, [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ], { timeoutMs: 120000 });   // 与 NPC/物品演化一致：用接口自带额度（apiChatFallback 已统一带 stream:true，假流式模型也能用）；2 分钟超时防挂起
      if (!reply || !reply.trim()) { setItemPhaseLog('⚠ 强化收尾：AI 无输出'); return { ok: false, changed: false, error: 'AI 返回空内容（思考型模型 / max_tokens 太小 / 被安全过滤 都可能；已调高 max_tokens，可重试；F12 看「content 为空」那行的 finish_reason）' }; }
      console.log('[Enhance] 收尾·AI 回复(前 800 字) ↓\n', reply.slice(0, 800));
      applyAllUpdates(reply);
      // 保险：收尾 AI 不应改 enhanceLevel；若被覆盖，钉回收尾前的"当前实际等级"（不是峰值——降级后等级须保持降级值）
      const cur = useItems.getState().items.find((x) => x.id === args.itemId);
      if (cur && (cur.enhanceLevel ?? 0) !== lockedLevel) useItems.getState().updateItem(args.itemId, { enhanceLevel: lockedLevel });
      const changed = !!cur && ((cur.affix ?? '') !== beforeAffix || (cur.effect ?? '') !== beforeEffect);
      if (changed) useItems.getState().updateItem(args.itemId, { affixLevel: args.newLevel });   // 结算成功 → 把"已结算基线"推进到峰值，消费这次机会（失败/未改动则不推进，退出重开仍可结算）
      if (!changed) console.warn('[Enhance] 收尾：AI 有回复但 affix/effect 没变——多半是没按 <upstore> updateItem 格式输出，或 itemId/name 没对上。期望 itemId=', args.itemId, '/ name=', it.name);
      setItemPhaseLog(changed ? `✓ 强化收尾完成：「${it.name}」+${args.newLevel}` : '⚠ 强化收尾：AI 未改动词缀/效果');
      return { ok: true, changed, error: changed ? undefined : 'AI 回复没按 <upstore> updateItem 格式生效（F12 看「收尾·AI 回复」那行原文）' };
    } catch (e: any) {
      console.error('[Enhance] 收尾失败:', e?.message);
      setItemPhaseLog(`⚠ 强化收尾失败：${(e?.message ?? '').slice(0, 50)}`);
      return { ok: false, changed: false, error: (e?.message ?? '接口调用失败').slice(0, 80) };
    } finally {
      setTimeout(() => setItemPhaseLog(''), 6000);
    }
  }

  /* ─── 装备强化·老板吐槽（点立绘触发；读会话实况，返回符合性格的一两句话，纯氛围不改状态）─── */
  /* 欢愉宫：看板娘迎宾「再说一句」（点立绘）*/
  async function onJoyGreet(madamId: string): Promise<string> {
    const J = useJoy.getState();
    const madam = J.settings.girls.find((g) => g.id === madamId);
    if (!madam) return '';
    const ss = useSettings.getState();
    const legacy = J.joyUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : J.joyApi;
    const chain = resolveApiChain('joy', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return '（欢愉宫的 AI 接口还没配置呢…去 设置→变量管理→欢愉宫 设置吧）';
    try {
      const { content } = await apiChatFallback(chain, [
        { role: 'system', content: buildGreetPrompt(madam) },
        { role: 'user', content: '（老板走进欢愉宫大厅）' },
      ], { timeoutMs: 60000 });
      return content.trim();
    } catch { return ''; }
  }

  /* 欢愉宫：包间一轮对话 —— 调 AI → 解析 <joy> → 写 store（情欲值/私密/立绘随之更新）*/
  async function onJoySend(girlId: string, text: string): Promise<void> {
    await hydrateJoyWorldBooks();   // 确保内置世界书已加载（幂等，只首次拉）
    const J = useJoy.getState();
    const girl = J.settings.girls.find((g) => g.id === girlId);
    if (!girl) return;
    const sess = J.sessions[girlId];   // 本轮调用前的会话快照（system/history 用它）
    J.appendMessage(girlId, 'user', text);
    const ss = useSettings.getState();
    const legacy = J.joyUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : J.joyApi;
    const chain = resolveApiChain('joy', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) {
      J.appendMessage(girlId, 'assistant', '（欢愉宫的 AI 接口还没配置…请到 设置→变量管理→欢愉宫 设置接口）');
      return;
    }
    const history = (sess?.messages ?? []).slice(-12).map((m) => ({ role: m.role, content: m.content }));
    // 世界书注入：matchCtx = 本轮输入 + 最近对话 → 蓝灯常驻 + 绿灯关键词命中
    const matchCtx = [text, ...(sess?.messages ?? []).slice(-8).map((m) => m.content)].join(' ');
    const wbText = buildJoyWbInjection(J.worldBooks, matchCtx);
    const messages = [
      { role: 'system', content: buildJoySystem(girl, sess) },
      ...(wbText ? [{ role: 'system', content: wbText }] : []),
      ...history,
      { role: 'user', content: text },
    ];
    try {
      const { content } = await apiChatFallback(chain, messages, { timeoutMs: 120000 });
      const { narrative, desireDelta, desireSet, affectionDelta, affectionSet, appellation, innerThought, privacyPatch } = parseJoyReply(content);
      J.appendMessage(girlId, 'assistant', narrative);
      J.applyTurn(girlId, { desireDelta, desireSet, affectionDelta, affectionSet, appellation, innerThought, privacyPatch });
    } catch (e: any) {
      J.appendMessage(girlId, 'assistant', `（接口异常：${e?.message ?? '请求失败'}）`);
    }
  }

  async function enhanceBanter(): Promise<string> {
    const E = useEnhance.getState();
    const sess = E.session;
    const boss = E.settings.bosses.find((b) => b.id === E.settings.selectedBossId) ?? E.settings.bosses[0];
    if (!boss) return '';
    const ss = useSettings.getState();
    const legacy = E.enhanceUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : E.enhanceApi;
    const chain = resolveApiChain('enhance', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return '（强化所的 AI 接口还没配置呢…去 设置→变量管理→装备强化 设置吧）';

    const it = sess ? useItems.getState().items.find((x) => x.id === sess.itemId) : null;
    const lv = it?.enhanceLevel ?? sess?.curLevel ?? 0;
    const stage = stageFromLevel(lv);
    // 分阶段语气：随强化进度逐级升级；女老板走勾引线、男老板走挑衅/劝退线
    const FEMALE_TONE: Record<number, string> = {
      1: '【本阶段·正常交流】礼貌、亲和、专业地正常交流，给点强化建议或打气。',
      2: '【本阶段·诱惑勾引】开始暧昧撩拨：抛媚眼、话里带钩，用亲昵与若有若无的身体暗示，诱导主角继续强化、多花钱。',
      3: '【本阶段·露骨勾引】毫不掩饰地大胆调情：贴近、放浪，把强化的刺激与情欲绑在一起，言语直白挑逗、极力撩拨。',
      4: '【本阶段·放飞自我·成人向】彻底放飞，说露骨、私密、充满性暗示与挑逗的荤话（尺度对标角色私密信息），毫不收敛地勾引调情。',
    };
    const MALE_TONE: Record<number, string> = {
      1: '【本阶段·平常交流】爽朗、平常地交流，偶尔憨厚地祝你好运。',
      2: '【本阶段·挑衅】用激将、轻蔑、嘲讽——看不起主角的手气与胆量，挑衅他敢不敢继续。',
      3: '【本阶段·鼓励并劝收手】语重心长，既鼓励又劝主角见好就收（"这把够了，别再赌了"），怕他血本无归。',
      4: '【本阶段·难以置信】被主角的强化结果彻底震惊——瞠目结舌、连连惊叹、不敢相信。',
    };
    const tone = (boss.gender === '女' ? FEMALE_TONE : MALE_TONE)[stage];
    // 该老板的【独立可编辑对话预设】优先；留空则回退「性格 + 默认阶段语气」
    const preset = (boss.banterPreset || '').trim();
    const styleBlock = preset
      ? `【该强化师·对话预设（设计其说话风格，请严格遵循）】\n${preset}`
      : `性格: ${boss.persona}\n${tone}`;
    const OUT: Record<string, string> = { success: '刚成功', crit: '刚暴击跳级', guaranteed: '刚靠保底必成', fail: '刚失败', downgrade: '刚失败还降了级', reset: '强化刚归零（掉回+0）', destroy: '装备刚分解爆了' };
    const lines = [
      `强化师: ${boss.name}（${boss.gender || '?'}）`,
      `当前阶段: 第 ${stage} 阶段（共 4 阶，随强化等级升级，预设里如有分阶段说明请按此阶段）`,
      it ? `正在强化: ${it.name}（${it.gradeDesc || '—'}），当前强化等级 +${lv}` : '主角还没选要强化的装备',
      sess ? `本轮战况: 成功${sess.success}次 / 失败${sess.fail + sess.downgrade}次 / 爆装${sess.destroy}次，已砸进 ${sess.spent.toLocaleString()} 乐园币` : '',
      sess?.lastOutcome ? `刚刚的结果: ${OUT[sess.lastOutcome] ?? sess.lastOutcome}` : '',
      `垫子计数: ${Math.min(E.pity, PITY_THRESHOLD)}/${PITY_THRESHOLD}（爆装攒满必成，还差 ${Math.max(0, PITY_THRESHOLD - E.pity)} 次爆装触发保底）`,
    ].filter(Boolean).join('\n');

    const { content } = await apiChatFallback(chain, [
      { role: 'system', content: ENHANCE_BANTER_RULE },
      { role: 'user', content: `【强化实况】\n${lines}\n\n${styleBlock}\n\n以「${boss.name}」本人的身份，**严格按上面的对话预设、并贴合「当前阶段」**，对正在强化的主角说一两句话。` },
    ]);
    return (content || '').replace(/^[「『"'\s]+|[」』"'\s]+$/g, '').trim();
  }

  /* ─── 综合对账纠错（主角演化 + 物品演化都跑完后【合并成一次调用】）───
     一次性检查：主角全部面板信息 + 主角物品 + 随从/宠物物品，对照最近两回合正文纠正"遗漏/错误更新"。
     物品只碰主角与"随从/宠物"，不创建新物品、不动货币。 */
  async function runMergedAuditPhase(narrative: string, ran: { player: boolean; item: boolean }) {
    const checkPlayer = ran.player && usePlayer.getState().settings.enabled && usePlayer.getState().settings.auditEnabled !== false;
    const checkItems = ran.item && useItems.getState().settings.enabled && useItems.getState().settings.auditEnabled !== false;
    if (!checkPlayer && !checkItems) return;

    const ss = useSettings.getState();
    // API：优先用主角演化路由（要查主角面板时），否则用物品路由
    const chain = checkPlayer
      ? resolveApiChain('player', usePlayer.getState().playerUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : usePlayer.getState().playerApi)
      : resolveApiChain('item', useItems.getState().itemUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : useItems.getState().itemApi);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return;

    // 最近两回合正文（上一回合 + 本回合）
    const am = (messagesRef.current ?? []).filter((m) => m.role === 'assistant').map((m) => String(m.content || ''));
    let prevNarr = '';
    for (let i = am.length - 1; i >= 0; i--) { if (am[i] && am[i] !== narrative) { prevNarr = am[i]; break; } }
    const twoTurnNarr = (prevNarr ? `【上一回合正文】\n${prevNarr}\n\n` : '') + `【本回合正文】\n${narrative}`;

    // ① 主角面板（检查全部信息）
    let panel = '（本次不检查主角面板）';
    if (checkPlayer) {
      const prof = usePlayer.getState().profile;
      const game = useGame.getState().player;
      const b1 = useCharacters.getState().characters['B1'];
      const a = prof.attrs;
      const maxHp = playerMaxHp(), maxEp = playerMaxEp();
      panel = [
        `姓名:${prof.name || '主角'} | 阶位:${prof.tier} Lv.${prof.level}`,
        prof.title && `称号:${prof.title}`,
        prof.profession && `职业:${prof.profession}`,
        `六维(基础·默认锁定·非正文逐字写明成长一律别改): 力${a.str} 敏${a.agi} 体${a.con} 智${a.int} 魅${a.cha} 幸${a.luck}`,
        `HP:${effectiveResource(game.hp, game.maxHp, maxHp)}/${maxHp} EP:${effectiveResource(game.mp, game.maxMp, maxEp)}/${maxEp} SAN:${game.san}/${game.maxSan}`,
        `【⚠当前回合数】${turnCountRef.current}（「当前状态/Buff」里的"过 N 回合结束 / 还剩 N 回合"倒计时以此为锚核算；已到点却还挂着的 debuff 属于卡死的旧倒计时→纠正清除）`,
        `当前状态/Buff: ${prof.status || '一切正常'}`,
        (prof.statusEffects?.length ?? 0) > 0 && `限时状态(引擎按回合自动过期,勿重复加): ${prof.statusEffects.map((e) => { const st = e.startTurn ?? turnCountRef.current; const rem = e.durationTurns != null ? Math.max(0, e.durationTurns - (turnCountRef.current - st)) : null; return `${e.name}${rem != null ? `(剩${rem}回合)` : ''}`; }).join('、')}`,
        prof.location && `当前位置: ${prof.location}`,
        prof.appearance && `当前外观: ${prof.appearance}`,
        `已有技能(${b1?.skills?.length ?? 0}): ${(b1?.skills ?? []).map((s) => `「${s.name}」${s.level ?? ''}`).join('、') || '（无）'}`,
        `已有天赋(${b1?.traits?.length ?? 0}): ${(b1?.traits ?? []).map((t) => `「${t.name}」${t.rarity ?? ''}`).join('、') || '（无）'}`,
      ].filter(Boolean).join('\n');
    }

    // ② 物品：主角背包 + 随从/宠物 持有物（其它 NPC 不查）
    let playerItems = '（本次不检查物品）';
    let petItems = '（本次不检查物品）';
    if (checkItems) {
      const items = useItems.getState().items;
      playerItems = items.length > 0
        ? items.map((it) => `[${it.id}] ${it.name}（${it.category}${it.gradeDesc ? '·' + it.gradeDesc : ''}）×${it.quantity}` + (it.equipped ? `【已装备:${it.equipSlot ?? ''}】` : '') + (it.effect ? `  ${it.effect}` : '')).join('\n')
        : '（背包为空）';
      const petRecs = Object.values(useNpc.getState().npcs).filter((r) => !r.isDead && (r.npcTag === '随从' || r.npcTag === '宠物'));
      const petLines = petRecs.flatMap((r) => (r.items ?? []).map((it) =>
        `[${it.id}] ${it.name}（${it.category}${it.gradeDesc ? '·' + it.gradeDesc : ''}）×${it.quantity}` + (it.equipped ? '【已装备】' : '') + ` —— 持有者 ${r.id}(${r.name || r.id}·${r.npcTag})`));
      petItems = petLines.length > 0 ? petLines.join('\n') : '（无随从/宠物持有物）';
      // 都没东西可查、又不查主角面板 → 省一次调用
      if (!checkPlayer && items.length === 0 && petLines.length === 0) return;
    }

    const userContent = MERGED_AUDIT_PROMPT
      .replaceAll('${story_text}', twoTurnNarr)
      .replaceAll('${player_panel}', panel)
      .replaceAll('${player_items}', playerItems)
      .replaceAll('${pet_items}', petItems);

    setItemAuditRunning(true);
    try {
      setItemPhaseLog('🔍 综合对账·纠正中…');
      const { content: reply } = await apiChatFallback(chain, [
        { role: 'system', content: MERGED_AUDIT_SYSTEM + '\n' + ITEM_GRADE_TABLE_RULE + '\n' + EQUIP_CODEX + '\n' + STATUS_COUNTDOWN_TURN_RULE + (checkItems ? '\n' + ITEM_EVOLUTION_CODEX : '') },
        { role: 'user', content: userContent },
      ]);
      console.log('[MergedAudit] 对账原始响应:', reply);
      if (reply) {
        // 「为什么纠正」= 模型 <think> 说明；剥离后再解析，避免说明文字被当指令
        const auditWhy = reply.match(/<think[^>]*>([\s\S]*?)<\/think>/i)?.[1]?.trim();
        const cleanReply = reply.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim();
        let did = 0;
        const auditWhat: Record<string, unknown> = {};   // 「纠正了什么」= 实际应用的各类指令
        if (checkPlayer) {
          try { const su = parseAllStateUpdates(cleanReply); if (su.length) { auditWhat['主角状态(六维/HP/状态/位置/等级等)'] = su; did += su.length; } } catch { /* */ }
          try { applyStateUpdates(cleanReply); } catch { /* hp.B1/mp.B1/san.B1/eq */ }
          try { applyPlayerProfileCommands(cleanReply, '', turnCountRef.current); } catch { /* character.B1.*：六维/状态/位置/外观/等级 */ }
          try { const c = parseAllCharCommands(cleanReply).filter((x) => x.charId === 'B1'); applyCharacterCommands(c, twoTurnNarr); did += c.length; if (c.length) auditWhat['主角技能/天赋'] = c; } catch { /* 仅主角技能/天赋 */ }
        }
        if (checkItems) {
          // 安全网：只允许删/扣/穿脱，硬过滤 createItem（防重复生成）+ 货币指令（防重复计数）
          const cmds = parseAllItemCommands(cleanReply).filter((c) => c.type !== 'createItem' && c.type !== 'transferSpiritStones' && c.type !== 'transferCurrency');
          if (cmds.length > 0) { applyItemCommands(cmds); did += cmds.length; auditWhat['物品(删除/扣减/穿脱)'] = cmds; }
          try { useItems.getState().dedupeByName(); } catch { /* */ }
          try { useNpc.getState().dedupeNpcItems(); } catch { /* */ }
        }
        // F12 友好输出：为什么纠正 + 纠正了什么
        try {
          console.group(`%c[纠正功能] 🔍 综合对账纠错 ${did > 0 ? `（共 ${did} 处）` : '（无改动）'}`, 'color:#f59e0b;font-weight:bold');
          console.log('%c为什么纠正：', 'color:#38bdf8;font-weight:bold', '\n' + (auditWhy || '（模型未给出说明文字，可能本轮无需纠正）'));
          if (Object.keys(auditWhat).length) console.log('%c纠正了什么：', 'color:#34d399;font-weight:bold', auditWhat);
          else console.log('%c纠正了什么：', 'color:#34d399;font-weight:bold', '（本轮无实际改动）');
          console.groupEnd();
        } catch { /* */ }
        setItemPhaseLog(did > 0 ? `✓ 综合对账：已纠正 ${did} 处` : '✓ 综合对账：无需纠正');
      }
    } catch (e: any) {
      console.warn('[MergedAudit] 对账失败:', e?.message ?? e);
    } finally {
      setItemAuditRunning(false);
      setTimeout(() => setItemPhaseLog(''), 6000);
    }
  }

  /* ─── 物品管理独立阶段（自动，含启用和频率检查）─── */
  async function runItemManagementPhase(narrative: string) {
    const { settings } = useItems.getState();

    if (!settings.enabled) {
      console.log('[Item] 物品管理阶段未启用');
      return;
    }
    const freq = settings.frequency || 1;
    if (turnCountRef.current % freq !== 0) {
      console.log(`[Item] 回合 ${turnCountRef.current} 不触发（每 ${freq} 回合一次）`);
      return;
    }
    await runItemManagementPhaseCore(narrative);
  }

  /* ─── 主角演化核心执行 ─── */
  async function runPlayerEvolutionPhaseCore(narrative: string) {
    const playerState = usePlayer.getState();
    const { settings } = playerState;

    const ss = useSettings.getState();
    const legacyApi = playerState.playerUseSharedApi
      ? (ss.textUseSharedApi ? ss.api : ss.textApi)
      : playerState.playerApi;
    const chain = resolveApiChain('player', legacyApi);

    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) {
      console.warn('[Player] API 未配置（设置→主角演化→API设置）');
      setPlayerPhaseLog('⚠ 主角演化：API 未配置');
      setTimeout(() => setPlayerPhaseLog(''), 5000);
      return;
    }

    const allEntries     = settings.entries ?? [];
    const enabledEntries = allEntries.filter((e) => e.enabled);

    if (enabledEntries.length === 0) {
      console.log('[Player] 无已启用的预设条目，跳过');
      return;
    }

    console.log('[Player] ========= 主角演化阶段诊断 =========');
    console.log('[Player] 预设名称:', settings.presetName || '（无）');
    console.log('[Player] 总条目数:', allEntries.length, '| 已启用:', enabledEntries.length);

    setPlayerPhaseRunning(true);
    setPlayerPhaseLog('主角演化阶段处理中…');

    try {
      // 主角演化发送【全部正文】（不截断）
      const trimmedNarrative = narrative;

      // 注入主角当前档案快照，让主角演化看到等级/已有技能天赋（避免重复生成）
      const prof = playerState.profile;
      const b1 = useCharacters.getState().characters['B1'];
      const pSkills = b1?.skills ?? [];
      const pTalents = b1?.traits ?? [];
      const a = prof.attrs;
      const playerProfileSnapshot = [
        `姓名:${prof.name || '主角'} | 阶位:${prof.tier} Lv.${prof.level} | 世界之源:${prof.worldSource ?? 0} | 属性点:${prof.attrPoints ?? 0} | 真实属性点:${prof.realAttrPoints ?? 0}`,
        prof.homeParadise && `所属乐园:${prof.homeParadise}`,
        prof.preParadiseJob && `主角背景(入园前职业):${prof.preParadiseJob}`,
        prof.contractorId && `契约者ID:${prof.contractorId}`,
        prof.title && `称号:${prof.title}`,
        prof.profession && `职业:${prof.profession}`,
        prof.arenaRank && `竞技场排名:${prof.arenaRank}`,
        a && `生物强度(前端按基础六维机械判定·资质档,勿写): ${bioInnate(a, prof.tier, prof.level)?.label ?? ''}`,
        `六维(基础·默认锁定·非正文逐字写明成长一律别改): 力${a.str} 敏${a.agi} 体${a.con} 智${a.int} 魅${a.cha} 幸${a.luck}`,
        `真实属性口径(重要): 四阶起上方六维数值本身即「真实属性」(勿÷80折算成另一套小数字)，1点真实≈5点普通之效、判定享绝对优先级；一~三阶为「普通属性」(≤99，99=普通绝对极限)。唯有自身锻炼/强化的裸装六维计入单属性极值突破，装备/技能/天赋加成不计极值。`,
        `生命HP上限=体质×20+被动天赋/装备的上限加成=${playerMaxHp()}，蓝量EP上限=智力×15+加成=${playerMaxEp()}（前端自动换算，勿写maxHp/maxMp；只有受伤/消耗时才用 hp.B1 -=N / mp.B1 -=N 改当前值）`,
        `【⚠当前回合数】${turnCountRef.current}（每过一回合自动+1。下方「当前状态/Buff」里任何"过 N 回合结束 / 还剩 N 回合 / 持续 N 回合 / 第 N 回合解除"的倒计时，务必以这个回合数为锚逐回合递减或比对，到点的 buff/debuff 必须清除——别原样复述同一句，详见限时状态·回合倒计时铁则）`,
        `当前状态/Buff: ${prof.status || '一切正常'}`,
        (prof.statusEffects?.length ?? 0) > 0 && `限时状态(引擎按回合自动过期,勿重复添加): ${prof.statusEffects.map((e) => { const st = e.startTurn ?? turnCountRef.current; const rem = e.durationTurns != null ? Math.max(0, e.durationTurns - (turnCountRef.current - st)) : null; return `${e.name}${e.durationDesc ? `(${e.durationDesc})` : ''}${rem != null ? `[起于第${st}回合·剩${rem}回合]` : ''}`; }).join('；')}`,
        `基底外观(常驻长相·开局设定·最高基准·绝不漂移): ${prof.baseAppearance || '（未设定）'}——身高/发色/瞳色/肤色/体型/标志特征一律以此为准；下面的「当前外观」「生图提示词(列19)」以及生图都【绝不可与之矛盾】：此处写"无肌肉/精瘦"就绝不能写成肌肉发达/肌肉线条紧绷，写明的瞳色/身高不许擅改。只有正文明确发生【改身高/染发/换瞳/肢体改造/异变/整容】才更新基底外观。`,
        `当前外观(即时状态·须与基底外观一致): ${prof.appearance || '（未填写）'}`,
        `当前位置: ${prof.location || '（未填写）'}`,
        `当前生图提示词(列19,有则沿用/仅长期外观变化时更新·须忠实反映上方基底外观,不得编出与之冲突的体型/瞳色/身高): ${prof.imageTags || '（未生成,请生成英文NAI tags）'}`,
        `已有技能(${pSkills.length}): ${pSkills.length ? pSkills.map((s) => `${s.id}「${s.name}」${s.level ?? ''}`).join('；') : '（无）'}`,
        `已有天赋(${pTalents.length}): ${pTalents.length ? pTalents.map((t) => `「${t.name}」${t.category ?? ''}·${t.rarity}级`).join('；') : '（无）'}`,
        (b1?.subProfessions?.length ?? 0) > 0 && `副职业(勿重复add,按需累加进度): ${b1!.subProfessions!.map((p) => `${p.name}[${p.tier} ${p.progress ?? 0}%]${p.recipes?.length ? `(${p.recipeLabel || '配方'}:${p.recipes.map((r) => r.name).join('、')})` : ''}`).join('；')}`,
      ].filter(Boolean).join('\n');
      const systemPrompt = buildPlayerSystemPrompt(enabledEntries)
        .replaceAll('${character_snapshot}', playerProfileSnapshot)
        .replaceAll('${player_skills}', pSkills.length ? pSkills.map((s) => `${s.id}「${s.name}」${s.level ?? ''}`).join('；') : '（无）')
        .replaceAll('${player_traits}', pTalents.length ? pTalents.map((t) => `「${t.name}」${t.category ?? ''}·${t.rarity}级`).join('；') : '（无）')
        + '\n\n' + PARADISE_RULES_RULE + '\n\n' + NARRATIVE_FIRST_RULE + '\n' + EVO_VERIFY_RULE + '\n' + BUFF_AS_STATUS_RULE + '\n' + SUBPROF_RULE + '\n' + TALENT_NO_CAP_RULE + '\n' + TITLE_DIVERSITY_RULE + '\n' + SKILL_TALENT_NOTE_RULE + '\n' + SKILL_TIER_RULE + '\n' + SKILL_TALENT_ATTR_CAP_RULE + '\n' + PLAYER_SKILL_KEEP_RULE + '\n' + ITEM_GRANTED_SKILL_RULE + '\n' + SKILL_STABILITY_RULE + '\n' + SKILL_COMBAT_TAG_RULE + '\n' + TIER_RULE +'\n' + IMAGE_TAGS_RULE + '\n' + HPEP_NARRATIVE_ONLY_RULE + '\n' + WORLDSOURCE_RULE + '\n' + POINTS_NARRATIVE_RULE + '\n' + ATTR_SANITY_RULE + '\n' + ATTR_CAP_RULE + '\n' + PLAYER_ATTR_LOCK_RULE + '\n' + APPEARANCE_UPDATE_RULE + '\n' + STATUS_FORMAT_RULE + '\n' + STATUS_COUNTDOWN_TURN_RULE + '\n' + FIRST_UPDATE_COMPLETE_RULE + '\n' + EVO_EXACT_REF_RULE + '\n' + SKILL_TALENT_GUIDE + '\n' + PLAYER_COT_RULE;
      const userContent  = `# 本轮正文\n${trimmedNarrative}\n\n---\n请根据以上正文处理本轮主角属性与状态的变化。**先输出一个 <think>…</think> 思考块**，按系统提示里的「主角演化思维链」逐项自检；**随后**输出 <state>（及如有需要的 <upstore>）指令块，无变化时输出空块。除 <think> / <state> / <upstore> 外不要有其它文字。`;

      const ss2 = useSettings.getState();
      const activePreset = ss2.textPresets.find((p) => p.id === ss2.activeTextPresetId)
        ?? ss2.textPresets[0];
      const extra: Record<string, unknown> = {};
      if (activePreset?.temperature != null) extra.temperature = activePreset.temperature;
      if (activePreset?.max_tokens != null) extra.max_tokens = activePreset.max_tokens;
      if (activePreset?.top_p != null && activePreset.top_p > 0 && activePreset.top_p <= 1) extra.top_p = activePreset.top_p;

      const { content: reply } = await apiChatFallback(chain, [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userContent },
      ], { extra });
      console.log('[Player] 主角演化原始响应:', reply);

      if (reply) {
        const cleanReply = reply.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim();   // 剥掉思维链，避免其自然语言被误判成指令
        applyAllUpdates(cleanReply);
        applyPlayerProfileCommands(cleanReply, narrative, turnCountRef.current);   // 主角身份/属性/外观/位置变量（传正文：基础六维只在正文写明成长时才许上调）
        const charCmds  = parseAllCharCommands(cleanReply);
        applyCharacterCommands(charCmds, trimmedNarrative);   // 传正文：全新副职业须正文有明确习得动作才建，杜绝凭空生成
        const stateUpds = parseAllStateUpdates(cleanReply);
        const total = stateUpds.length + charCmds.length;
        setPlayerPhaseLog(
          total > 0
            ? `✓ 主角演化完成：${stateUpds.length} 条属性更新，${charCmds.length} 条技能/天赋指令`
            : '✓ 主角演化完成：本轮无变化'
        );
      } else {
        setPlayerPhaseLog('✓ 主角演化完成：无输出');
      }
      // 对账纠错已合并：移到 runPostNarrativePhases 里，待主角+物品两阶段都跑完后统一调一次 runMergedAuditPhase
    } catch (e: any) {
      const msg = e.message ?? '未知错误';
      console.error('[Player] 主角演化阶段失败:', msg);
      setPlayerPhaseLog(`⚠ 主角更新失败：${msg.slice(0, 60)}`);
    } finally {
      setPlayerPhaseRunning(false);
      setTimeout(() => setPlayerPhaseLog(''), 8000);
    }
  }

  /* ─── 主角演化独立阶段（自动，含启用和频率检查）─── */
  async function runPlayerEvolutionPhase(narrative: string) {
    const { settings } = usePlayer.getState();
    if (!settings.enabled) {
      console.log('[Player] 主角演化阶段未启用');
      return;
    }
    const freq = settings.frequency || 1;
    if (turnCountRef.current % freq !== 0) {
      console.log(`[Player] 回合 ${turnCountRef.current} 不触发（每 ${freq} 回合一次）`);
      return;
    }
    await runPlayerEvolutionPhaseCore(narrative);
  }

  /* ════════════════════════════════════════════
     NPC 演化通用工具
  ════════════════════════════════════════════ */


  /* 重点演化 system prompt（策略B：单角色 charId / 策略A：留空→在场列表） */
  function buildNpcPhaseSystemPrompt(
    entries: import('./store/npcEvoStore').NpcPresetEntry[],
    narrative: string,
    charId?: string,
    entryCreatedIds?: Set<string>,
  ): string {
    const vars = buildNpcVars(narrative);
    const rec = charId ? useNpc.getState().npcs[charId] : undefined;
    const onSceneIds = Object.values(useNpc.getState().npcs).filter((r) => r.onScene && !r.isDead).map((r) => r.id);
    vars.character_id = charId ?? (onSceneIds.join(', ') || vars.next_available_npc_id);
    // 注入目标角色当前档案，让重点演化"继续"既有角色而非重新生成（尤其是姓名），对齐原版 ${character_snapshot}
    if (rec) {
      vars.character_snapshot = serializeNpcSnapshot(rec);
      vars.npc_biography = rec.background ?? '';
    }
    vars.scene_type = charId ? (rec?.onScene ? 'onscene' : 'offscene') : (onSceneIds.length > 0 ? 'onscene' : 'offscene');
    vars.is_offscene = charId ? String(!rec?.onScene) : String(onSceneIds.length === 0);
    vars.is_entry_created_target = String(!!(charId && entryCreatedIds?.has(charId)));

    return entries
      .filter((e) => e.enabled && e.source !== 'entrySharedRules')
      .map((e) => fillVars(e.content, vars))
      .join('\n\n')
      + '\n\n' + NARRATIVE_FIRST_RULE + '\n' + BUFF_AS_STATUS_RULE + '\n' + NPC_AGE_RULE + '\n' + TALENT_NO_CAP_RULE + '\n' + TITLE_DIVERSITY_RULE + '\n' + NPC_DEAD_EXCLUDE_RULE + '\n' + NPC_ID_RULE + '\n' + SKILL_TALENT_NOTE_RULE + '\n' + NPC_SKILL_KEEP_RULE + '\n' + ITEM_GRANTED_SKILL_RULE + '\n' + SKILL_STABILITY_RULE + '\n' + SKILL_COMBAT_TAG_RULE + '\n' + NPC_REVIEW_TAG_RULE +'\n' + NPC_TEAM_AFFILIATION_RULE + '\n' + TIER_RULE + '\n' + IMAGE_TAGS_RULE + '\n' + HPEP_NARRATIVE_ONLY_RULE + '\n' + POINTS_NARRATIVE_RULE + '\n' + NPC_GEN_ATTR_RULE + '\n' + ATTR_SANITY_RULE + '\n' + ATTR_CAP_RULE + '\n' + STATUS_FORMAT_RULE + '\n' + STATUS_COUNTDOWN_TURN_RULE + '\n' + NPC_PRIVATE_EXTRA_RULE + '\n' + NPC_TIER_LOADOUT_RULE + '\n' + SKILL_TALENT_ATTR_CAP_RULE + '\n' + FIRST_UPDATE_COMPLETE_RULE + '\n' + EVO_EXACT_REF_RULE + '\n' + SKILL_TALENT_GUIDE + '\n' + NPC_COT_RULE
      // 门控：仅当该 NPC 已有背景、却还没第一人称自述时，才追加"生成自述"规则（一次性·省 token）
      + (rec && rec.background && !rec.selfNarration ? '\n' + NPC_SELF_NARRATION_RULE : '');
  }

  /* 登场判断 system prompt（只取 entrySharedRules 条目） */
  function buildEntryPhaseSystemPrompt(
    entries: import('./store/npcEvoStore').NpcPresetEntry[],
    narrative: string,
  ): string {
    const vars = buildNpcVars(narrative);
    // 阶位·生物强度战力图鉴（builtinKey='twb-power'）：登场判断专用参照系，强制全量注入本书所有启用条目（不看蓝/绿灯）。
    // 整本书禁用或被删则优雅留空——治"杂兵虚高"的对照表来自这里，可在「正文世界书」列表里编辑、改即生效。
    const codexInjection = (() => {
      const book = useSettings.getState().textWorldBooks.find((b) => b.builtinKey === 'twb-power');
      if (!book || book.enabled === false) return '';
      const body = book.entries.filter((e) => e.enabled !== false).map((e) => e.content.trim()).filter(Boolean).join('\n\n');
      return body ? `\n\n【阶位·生物强度战力图鉴（登场判断参照系·定阶位/等级/生物强度档前务必逐条对照）】\n${body}` : '';
    })();
    return entries
      .filter((e) => e.enabled)   // entries 来自独立的「登场判断」预设(entryJudge)，整本都是登场判断条目
      .map((e) => fillVars(e.content, vars))
      .join('\n\n')
      + '\n\n' + NARRATIVE_FIRST_RULE + '\n' + EVO_VERIFY_RULE + '\n' + NPC_DEAD_EXCLUDE_RULE + '\n' + NPC_ID_RULE + '\n' + TIER_RULE + '\n' + SKILL_TIER_RULE + '\n' + NPC_GEN_ATTR_RULE + '\n' + NPC_TEAM_AFFILIATION_RULE + '\n' + NPC_ENTRY_BIO_RULE + '\n' + ENTRY_NAME_CN_RULE + '\n' + ENTRY_DEDUP_RULE + codexInjection + '\n' + SKILL_TALENT_GUIDE + '\n' + ENTRY_COT_RULE;
  }

  /* 解析 NPC <state> 短指令（favor/title/realm/hp），可按 charId 过滤 */
  function applyNpcShortCommands(reply: string, onlyId?: string): number {
    const npc = useNpc.getState();
    let n = 0;
    const ok = (id: string) => !onlyId || id === onlyId;
    let m: RegExpExecArray | null;

    const favorRe = /\bcharacter\.(C\d+)\.stats\.favor\s*=\s*(-?\d+)/g;
    while ((m = favorRe.exec(reply))) { if (ok(m[1])) { npc.applyColumns(m[1], { '15': Number(m[2]) }); n++; } }

    const titleRe = /\bcharacter\.(C\d+)\.identity\.title\s*=\s*"([^"]*)"/g;
    while ((m = titleRe.exec(reply))) { if (ok(m[1])) { npc.upsertNpc(m[1], { title: m[2] }); n++; } }

    // 状态短指令：character.C1.status = "..."（仅当状态表示"真的死亡"时才标记 isDead，避免"濒临死亡"等误杀）
    const statRe = /\bcharacter\.(C\d+)\.status\s*=\s*"([^"]*)"/g;
    while ((m = statRe.exec(reply))) {
      if (!ok(m[1])) continue;
      const dead = looksDead(m[2]);
      npc.upsertNpc(m[1], dead ? { status: m[2], isDead: true } : { status: m[2] });
      n++;
    }

    // 临时队友中途离队：partyLeave("C1") / leaveParty("C1")（剧情驱动，世界未结束时主动退队，仍在场待归档）
    const leaveRe = /\b(?:partyLeave|leaveParty)\(\s*["']?(C\d+)["']?\s*\)/g;
    while ((m = leaveRe.exec(reply))) { if (ok(m[1]) && npc.npcs[m[1]]?.partyMember) { npc.leaveParty(m[1]); n++; } }

    // cr.C1 = 一阶/8 → 列2 "一阶·Lv.8|（保留原身份）"；无 /Lv 时只写阶位
    const crRe = /\bcr\.(C\d+)\s*=\s*([^\n/]+?)(?:\/([\d.]+))?\s*(?:\n|$)/g;
    while ((m = crRe.exec(reply))) {
      if (!ok(m[1])) continue;
      const lv = m[3];
      // 阶位只接受合法名；非法则按 Lv 推导（保证只出现 一阶~无上之境）
      const tier = normalizeTier(m[2]) || (lv ? realmFromLevel(Number(lv)) : '一阶');
      const prev = npc.npcs[m[1]]?.realm ?? '';
      const idPart = prev.includes('|') ? prev.slice(prev.indexOf('|') + 1) : '';
      const realmStr = lv ? `${tier}·Lv.${lv}` : tier;
      npc.applyColumns(m[1], { '2': idPart ? `${realmStr}|${idPart}` : realmStr });
      n++;
    }

    // hp.C1 -= 20 / += 10 / = 80：上限=体质×20+装备/技能天赋的「HP上限」加成（与卡片/详情显示同口径，忽略 AI 写的 /上限），未记录当前值时以满血为基准
    const hpRe = /\bhp\.(C\d+)\s*(=|-=|\+=)\s*(\d+)(?:\s*\/\s*(\d+))?/g;
    while ((m = hpRe.exec(reply))) {
      if (!ok(m[1])) continue;
      const rec = npc.npcs[m[1]];
      const nc = useCharacters.getState().characters[m[1]];
      const dmax = fullMaxHp(rec?.attrs, (rec?.items ?? []).filter((it) => it.equipped) as any[], nc?.skills, nc?.traits, realAttrMult(rec?.realm, lvFromRealm(rec?.realm)), ratioOf(rec));
      const base = effectiveResource(rec?.hp, rec?.maxHp, dmax);
      const v = Number(m[3]);
      const next = m[2] === '=' ? v : m[2] === '+=' ? Math.min(base + v, dmax) : Math.max(0, base - v);
      npc.upsertNpc(m[1], { hp: next, maxHp: dmax });
      n++;
    }

    // identity 字段 → 写入 extra，供 NPC 档案"伪装身份/战斗属性"栏显示
    const idStr: Record<string, string> = { aliasName: '化名', disguiseRealm: '伪装境界', youthRetentionReason: '驻颜理由' };
    for (const [field, label] of Object.entries(idStr)) {
      const re = new RegExp(`\\bcharacter\\.(C\\d+)\\.identity\\.${field}\\s*=\\s*"([^"]*)"`, 'g');
      while ((m = re.exec(reply))) {
        if (!ok(m[1])) continue;
        const rec = npc.npcs[m[1]];
        npc.upsertNpc(m[1], { extra: { ...(rec?.extra ?? {}), [label]: m[2] } });
        n++;
      }
    }
    const idNum: Record<string, string> = { appearanceAge: '外貌年龄', extraShouyuan: '额外寿元' };
    for (const [field, label] of Object.entries(idNum)) {
      const re = new RegExp(`\\bcharacter\\.(C\\d+)\\.identity\\.${field}\\s*=\\s*(-?\\d+)`, 'g');
      while ((m = re.exec(reply))) {
        if (!ok(m[1])) continue;
        const rec = npc.npcs[m[1]];
        npc.upsertNpc(m[1], { extra: { ...(rec?.extra ?? {}), [label]: m[2] } });
        n++;
      }
    }

    // 新增身份字段：职业 / 竞技场排名 / 烙印等级 / 契约者ID
    const npcStr: Record<string, keyof import('./store/npcStore').NpcRecord> = {
      profession: 'profession', arenaRank: 'arenaRank', brandLevel: 'brandLevel', contractorId: 'contractorId', affiliatedTeam: 'affiliatedTeam',
    };
    for (const [field, key] of Object.entries(npcStr)) {
      const re = new RegExp(`\\bcharacter\\.(C\\d+)\\.identity\\.${field}\\s*=\\s*"([^"]*)"`, 'g');
      while ((m = re.exec(reply))) { if (ok(m[1])) { npc.upsertNpc(m[1], { [key]: m[2] } as any); n++; } }
    }
    // 隶属冒险团：character.C1.affiliatedTeam = "团名·角色"（非 identity 路径的简写）
    const teamAffRe = /\bcharacter\.(C\d+)\.affiliatedTeam\s*=\s*"([^"]*)"/g;
    while ((m = teamAffRe.exec(reply))) { if (ok(m[1])) { npc.upsertNpc(m[1], { affiliatedTeam: m[2] }); n++; } }
    // 外观描写 → 列34
    const apRe = /\bcharacter\.(C\d+)\.appearance\s*=\s*"([^"]*)"/g;
    while ((m = apRe.exec(reply))) { if (ok(m[1])) { npc.upsertNpc(m[1], { appearanceDetail: m[2] }); n++; } }
    // 生物强度模板（T0~T9，含非人生物）：character.C1.bioStrength = "T3·勇士"
    const bioRe = /\bcharacter\.(C\d+)\.bioStrength\s*=\s*"([^"]*)"/g;
    while ((m = bioRe.exec(reply))) { if (ok(m[1])) { npc.upsertNpc(m[1], { bioStrength: m[2] }); n++; } }
    // 年龄：character.C1.age = "约25岁"（正文有则照抄，没有则按设定生成）
    const ageRe = /\bcharacter\.(C\d+)\.age\s*=\s*"([^"]*)"/g;
    while ((m = ageRe.exec(reply))) { if (ok(m[1])) { npc.upsertNpc(m[1], { age: m[2] }); n++; } }
    // 诙谐评价：character.C1.review = "..."
    const reviewRe = /\bcharacter\.(C\d+)\.review\s*=\s*"([^"]*)"/g;
    while ((m = reviewRe.exec(reply))) { if (ok(m[1])) { npc.upsertNpc(m[1], { review: m[2] }); n++; } }
    // 标签（契约者/土著/随从/宠物/召唤物）：character.C1.npcTag = "随从"
    const tagRe = /\bcharacter\.(C\d+)\.npcTag\s*=\s*"([^"]*)"/g;
    while ((m = tagRe.exec(reply))) { if (ok(m[1])) { npc.upsertNpc(m[1], { npcTag: m[2] }); n++; } }
    // 所处位置 → extra.位置
    const locRe2 = /\bcharacter\.(C\d+)\.location\s*=\s*"([^"]*)"/g;
    while ((m = locRe2.exec(reply))) {
      if (!ok(m[1])) continue;
      const rec = npc.npcs[m[1]];
      npc.upsertNpc(m[1], { extra: { ...(rec?.extra ?? {}), 位置: m[2] } });
      n++;
    }
    // 六维基础属性（支持 = 绝对值 / += / -= 增减；含 C 与 G 系 NPC；可随剧情成长/受损更新）
    const npcAttrRe = /\bcharacter\.([CG]\d+)\.attrs\.(str|agi|con|int|cha|luck)\s*(=|\+=|-=)\s*(-?\d+)/g;
    while ((m = npcAttrRe.exec(reply))) {
      if (!ok(m[1])) continue;
      const key = m[2], op = m[3], v = Number(m[4]);
      // 幸运=前端独占的「特殊属性」：忽略 AI 的绝对赋值(luck=N)；只把剧情增减(+=/-=)累进 luckDelta，
      // 由 ensureNpcLuck 叠加到前端基础幸运上（前端重算不丢、绝对赋值不越权）。
      if (key === 'luck') {
        if (op === '=') continue;                                     // 绝对赋值忽略，幸运基础由前端定
        const live = useNpc.getState().npcs[m[1]];
        npc.upsertNpc(m[1], { luckDelta: (live?.luckDelta ?? 0) + (op === '+=' ? v : -v) });
        n++;
        continue;
      }
      // 每次都读「最新」记录：同一 NPC 本轮多条 attrs 指令时，upsertNpc 是不可变替换，
      // 若用函数开头捕获的 npc 快照取 base，第二条会用旧值覆盖掉第一条（与主角路径保持一致：逐次取最新）。
      const live = useNpc.getState().npcs[m[1]];
      const base = live?.attrs ?? { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 };
      const cur = (base as unknown as Record<string, number>)[key] ?? 5;
      const next = op === '=' ? v : op === '+=' ? cur + v : cur - v;
      const cap = attrCapForTier(live?.realm);   // 基础属性夹到本阶上限（装备/技能/天赋加成另算，不受限）
      npc.upsertNpc(m[1], { attrs: { ...base, [key]: Math.min(cap, Math.max(0, next)) } });
      n++;
    }
    // NPC 六维·机械生成(治 API 幻觉乱给离谱属性)：character.<id>.genAttrs = "阶位·Lv|生物强度档|类型|形态|定位"
    // 前端据 阶位/生物强度档/类型/形态/定位 用 generateNpcAttrs 反推六维(种子=id 可复现)；首次建档优先用它，不再让 AI 手写属性
    const genAttrRe = /\bcharacter\.([CG]\d+)\.genAttrs\s*=\s*"([^"]*)"/g;
    while ((m = genAttrRe.exec(reply))) {
      if (!ok(m[1])) continue;
      const [realmStr, bioTier, typeTag, form, role] = m[2].split('|').map((s) => s.trim());
      if (!bioTier) continue;
      const live = useNpc.getState().npcs[m[1]];
      const realm = realmStr || live?.realm || '';
      const attrs = generateNpcAttrs({ tier: realm, level: lvFromRealm(realm), bioTier, type: typeTag || live?.unitType, job: live?.profession, form, role, identity: live?.npcTag, seed: m[1] });
      npc.upsertNpc(m[1], { attrs, ...(realmStr && !live?.realm ? { realm: realmStr } : {}), ...(typeTag ? { unitType: typeTag } : {}) });
      n++;
    }
    // mp.C1（蓝量 EP）：上限=智力×15+装备/技能天赋的「EP上限」加成（与卡片/详情显示同口径，忽略 AI 写的 /上限），未记录当前值时以满蓝为基准
    const mpRe = /\bmp\.(C\d+)\s*(=|-=|\+=)\s*(\d+)(?:\s*\/\s*(\d+))?/g;
    while ((m = mpRe.exec(reply))) {
      if (!ok(m[1])) continue;
      const rec = npc.npcs[m[1]];
      const nc = useCharacters.getState().characters[m[1]];
      const dmax = fullMaxEp(rec?.attrs, (rec?.items ?? []).filter((it) => it.equipped) as any[], nc?.skills, nc?.traits, realAttrMult(rec?.realm, lvFromRealm(rec?.realm)), ratioOf(rec));
      const base = effectiveResource(rec?.mp, rec?.maxMp, dmax);
      const v = Number(m[3]);
      const next = m[2] === '=' ? v : m[2] === '+=' ? Math.min(base + v, dmax) : Math.max(0, base - v);
      npc.upsertNpc(m[1], { mp: next, maxMp: dmax });
      n++;
    }
    // 属性点 / 真实属性点 / 技能点：**只在「世界结算」时由正文发放**（同主角口径，平时不入账、不按"消耗"扣减）
    if (/<世界结算>/.test(reply)) {
      const npcPtRe = /\bcharacter\.([CG]\w*)\.(attrPoints|realAttrPoints|skillPoints)\s*(=|-=|\+=)\s*(\d+)/g;
      while ((m = npcPtRe.exec(reply))) {
        if (!ok(m[1])) continue;
        const key = m[2] as 'attrPoints' | 'realAttrPoints' | 'skillPoints';
        const cur = ((npc.npcs[m[1]] as any)?.[key]) ?? 0;
        const v = Number(m[4]);
        npc.upsertNpc(m[1], { [key]: m[3] === '=' ? v : m[3] === '+=' ? cur + v : Math.max(0, cur - v) } as any);
        n++;
      }
    }
    applyTimedStatusCommands(reply, turnCountRef.current, onlyId);   // NPC 限时状态 addStatus/deStatus
    return n;
  }


  /* ─── 策略B 第一段：登场判断 ─── */
  function parseEntryJson(reply: string): any {
    let t = reply.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim()   // 先剥掉思维链，避免 think 里的花括号被当成 JSON
      .replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const i = t.indexOf('{'); const j = t.lastIndexOf('}');
    if (i >= 0 && j > i) t = t.slice(i, j + 1);
    try { return JSON.parse(t); } catch { return null; }
  }

  // 解析 npc.<id> = {n:"..",r:"..",..} 短键骨架
  function parseSkeleton(stateCommands: string): { id: string; short: Record<string, unknown> } | null {
    const m = /npc\.([CG]\d+)\s*=\s*\{([\s\S]*)\}/.exec(stateCommands || '');
    if (!m) return null;
    const short: Record<string, unknown> = {};
    const kv = /(\w+)\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?)/g;
    let k: RegExpExecArray | null;
    while ((k = kv.exec(m[2]))) {
      const key = k[1]; let val = k[2];
      short[key] = val.startsWith('"') ? val.slice(1, -1).replace(/\\"/g, '"') : Number(val);
    }
    return { id: m[1], short };
  }

  function applyEntryResult(result: any, turn: number): Set<string> {
    const npc = useNpc.getState();
    const createdIds = new Set<string>();
    if (!result) return createdIds;

    // 已占用 id（含本批次新分配），用于防止"新角色复用已有 id 覆盖旧角色"
    const used = new Set(Object.keys(npc.npcs));
    const isReal = (r: any) =>
      !!(r && r.name && r.name !== r.id && (r.realm || r.personality || r.background));
    const nextFreeCId = () => { let n = 1; while (used.has(`C${n}`)) n++; return `C${n}`; };
    // ── 同名去重：name→id（含已有真实角色 + 本批次新建），避免一次生成两个同名 NPC ──
    const nameToId = new Map<string, string>();
    for (const r of Object.values(npc.npcs)) {
      if (isReal(r)) nameToId.set((r.name as string).split('|')[0].trim(), r.id);
    }

    // 本回合即死亡的角色不建档：登场条目里带死亡关键词的 new 直接跳过
    const DEATH_RE = /(死亡|死了|已死|身亡|毙命|丧命|气绝|阵亡|被杀|被击杀|被斩杀|被击毙|被秒杀|被消灭|被摧毁|灰飞烟灭|化为灰烬|当场死|一击毙命|尸体|尸首|断气)/;
    const narrativeNow = lastNarrativeRef.current || '';
    for (const e of result.entries ?? []) {
      if (!e?.id) continue;
      if (e.type === 'new') {
        const skel = parseSkeleton(e.stateCommands ?? '');
        const rawFull = String(e.name ?? skel?.short?.n ?? '').trim();
        const genderSuffix = rawFull.includes('|') ? rawFull.slice(rawFull.indexOf('|')) : '';
        const nameKey = sanitizeEntryName(rawFull.split('|')[0]);   // 去"|性别"后缀 + 剥罗马音注释(ENTRY_NAME_CN护栏)，确保同名能匹配
        const storeName = nameKey ? nameKey + genderSuffix : (e.name ?? '');   // 落档名：清洗后的名 + 保留原"|性别"后缀
        // 本回合即死亡：条目自带死亡关键词，或正文里该角色名紧邻死亡描述 → 不建档
        const blob = `${e.name ?? ''} ${e.status ?? ''} ${e.note ?? ''} ${e.stateCommands ?? ''}`;
        const deadInNarr = !!(nameKey && narrativeNow.includes(nameKey) &&
          DEATH_RE.test(narrativeNow.slice(Math.max(0, narrativeNow.indexOf(nameKey) - 40), narrativeNow.indexOf(nameKey) + 80)));
        if (DEATH_RE.test(blob) || deadInNarr) {
          console.warn(`[NPC] 跳过为本回合即死亡的新角色「${nameKey || e.id}」建档`);
          continue;
        }
        // 【杜绝无名编号NPC·根因】new 角色没有真实姓名（空 / 等于编号ID C\d+·G\d+）→ 一律不建档。
        // 哪怕带了骨架(六维/生物强度/血条)也丢弃：真实角色登场判断必给中文名(ENTRY_NAME_CN_RULE)，AI 连名都不给＝
        // 当它不存在，等它下次"带名"出现再建——无名骨架正是面板里"凭空冒出来的 C11/C22"。
        const nameReal = !!nameKey && nameKey !== e.id && !/^[CG]\d+$/i.test(nameKey);
        if (!nameReal) {
          console.warn(`[NPC] 丢弃无真实姓名的新角色（id=${e.id}, name=${nameKey || '∅'}${skel ? ' · 有骨架但无名' : ''}）`);
          continue;
        }
        // 纯英文/罗马音名无法机翻 → 不丢角色（它是真实角色），仅告警提示 AI 按 ENTRY_NAME_CN_RULE 重命名
        if (!/[一-鿿]/.test(nameKey)) console.warn(`[NPC] 新角色「${nameKey}」为纯英文/罗马音名（应中文·ENTRY_NAME_CN_RULE）；暂保留，待 AI 重命名`);
        // 已存在/本批已建同名真实角色 → 复用其ID当作"重新登场"，不再新建（防重复）
        const dupId = nameKey ? nameToId.get(nameKey) : undefined;
        if (dupId && npc.npcs[dupId]) {
          npc.setScene(dupId, true, turn);
          console.warn(`[NPC] 登场判断出现同名「${nameKey}」，复用已有ID ${dupId}，跳过新建（防重复）`);
          continue;
        }
        let id = skel?.id ?? e.id;
        const exist = npc.npcs[id];
        // 该 id 已被"另一个真实角色"占用，而本条是新角色 → 重新分配空闲 id，避免覆盖
        const sameChar = !!(exist && e.name && exist.name === e.name);
        if (exist && isReal(exist) && !sameChar) {
          const fresh = nextFreeCId();
          console.warn(`[NPC] 登场判断把新角色「${e.name ?? '?'}」分配到已占用ID ${id}（${exist.name}），改用空闲ID ${fresh} 防止覆盖`);
          id = fresh;
        }
        // 非 C/G 编号（AI 自创 P_xxx 等）→ 改用空闲 C 编号，保证后续短指令(均按 C\d+ 匹配)能识别、面板可点开
        if (!/^[CG]\d+$/.test(id) && !npc.npcs[id]) {
          const fresh = nextFreeCId();
          console.warn(`[NPC] 登场新角色「${e.name ?? '?'}」使用非法ID ${id}，改用 ${fresh}`);
          id = fresh;
        }
        used.add(id);
        if (nameKey) nameToId.set(nameKey, id);   // 登记新建名字，使本批后续同名条目并入此角色
        if (skel) npc.applySkeleton(id, skel.short);
        else npc.upsertNpc(id, { name: storeName || id, onScene: true });
        npc.setScene(id, true, turn);
        createdIds.add(id);
      } else {
        // reentry / 已存在
        let rid = e.id;
        // 重新登场也用了非法ID且该ID不存在 → 先按姓名找回已建档角色，找不到再分配空闲 C 编号，绝不新建非法ID空壳
        if (!/^[CG]\d+$/.test(rid) && !npc.npcs[rid]) {
          const byName = e.name ? nameToId.get(String(e.name).split('|')[0].trim()) : undefined;
          rid = byName ?? nextFreeCId();
          used.add(rid);
          console.warn(`[NPC] 重新登场用非法ID ${e.id}，改用 ${rid}`);
        }
        // 防臆造：reentry 指向的角色档案不存在、又没有真实姓名可立档 → 不要凭空 setScene 出一个无名编号空壳
        const reName = String(e.name ?? '').split('|')[0].trim();
        const reReal = !!reName && !/^[CG]\d+$/i.test(reName);
        if (!npc.npcs[rid] && !reReal) {
          console.warn(`[NPC] 跳过臆造的重入空壳 ${rid}（无既有档案且无真实姓名）`);
          continue;
        }
        npc.setScene(rid, true, turn);
        if (e.name) npc.upsertNpc(rid, { name: e.name });
        const loc = /loc\.[CG]\d+\s*=\s*([^\n]+)/.exec(e.stateCommands ?? '');
        if (loc) npc.upsertNpc(rid, { extra: { ...(npc.npcs[rid]?.extra ?? {}), 位置: loc[1].trim() } });
      }
    }
    for (const x of result.exits ?? []) { if (x?.id && npc.npcs[x.id]) npc.setScene(x.id, false); }   // 不为不存在的ID凭空建离场空壳
    for (const [id, deed] of Object.entries(result.deedsUpdates ?? {})) {
      if (typeof deed === 'string') npc.appendDeed(id, deed);
      else if (deed && typeof deed === 'object') npc.appendDeed(id, deed as any); // {time,location,description}
    }
    return createdIds;
  }

  async function runEntryJudgment(narrative: string): Promise<{ result: any; createdIds: Set<string> }> {
    const ej = useEntryJudge.getState();
    if (ej.enabled === false) {
      console.log('[NPC] 登场判断已在「登场判断」设置里关闭，跳过');
      return { result: null, createdIds: new Set() };
    }
    const entryEntries = (ej.entries ?? []).filter((e) => e.enabled);
    if (entryEntries.length === 0) {
      console.log('[NPC] 无启用的登场判断条目，跳过登场判断');
      return { result: null, createdIds: new Set() };
    }
    const trimmed = trimNarrative(narrative);
    const systemPrompt = buildEntryPhaseSystemPrompt(ej.entries, trimmed);
    const userContent = `# 本轮正文\n${trimmed}\n\n---\n**先输出一个 <think>…</think> 思考块**，按系统提示里的「登场判断思维链」逐项自检——尤其逐个新登场角色想清楚「阶位 + 生物强度档是否合理」（这会被前端机械生成属性采用，定离谱属性就离谱）；**随后**按【输出格式】输出登场/退场判断的 JSON object（含 entries/exits/deedsUpdates/globalCommands）。除 <think> 与该 JSON 外不要有多余文字，不要输出 <state>/<upstore> 块。`;
    const reply = await npcChatCompletion(systemPrompt, userContent, 'entry');
    console.log('[NPC] 登场判断响应:', reply);
    const result = parseEntryJson(reply);
    const createdIds = applyEntryResult(result, turnCountRef.current);
    try { const f = useNpc.getState().normalizeNpcIds(); if (f) console.log(`[NPC] 规范化非法ID ${f} 个`); } catch { /* 修复历史存档里 AI 自创的非法ID(如 P_Aesc) */ }
    try { useNpc.getState().dedupeByName(); } catch { /* 合并同名重复角色（防一回合内重复建档）*/ }
    refreshNpcPreferredOwners(createdIds);   // 登场判断完成后刷新物品 owner 重定向目标
    return { result, createdIds };
  }

  /* 刷新物品 owner 重定向优先目标：本轮新建 + 在场真实 NPC（最近优先）*/
  function refreshNpcPreferredOwners(created?: Set<string>) {
    const npcSt = useNpc.getState();
    setNpcPreferredOwners([
      ...(created ?? new Set<string>()),
      ...Object.values(npcSt.npcs)
        .filter((r) => r.onScene && isRealNpc(r))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((r) => r.id),
    ]);
  }

  /* ─── 策略B 第二段：调度（计算重点演化列表）─── */
  function passFrequency(rec: import('./store/npcStore').NpcRecord, turn: number, sch: import('./store/npcEvoStore').NpcScheduling): boolean {
    const interval = Math.max(1, rec.freqInterval ?? sch.defaultFreqInterval ?? 1);
    // date 模式暂回落到 turn 行为（无稳定游戏日期源）
    const last = rec.lastEvolvedTurn ?? -Infinity;
    return (turn - last) >= interval;
  }

  function computeFocusList(createdIds: Set<string>, turn: number): string[] {
    const { npcs } = useNpc.getState();
    const { scheduling } = useNpcEvo.getState().settings;
    const alive = (n: import('./store/npcStore').NpcRecord) => (scheduling.skipDead === false) || !n.isDead;

    // 手动模式：只推进「手动重点列表」（+本轮新登场，确保新角色至少建档一次）
    if (scheduling.targetMode === 'manual') {
      const ids = new Set<string>([...createdIds, ...(scheduling.manualFocusIds ?? [])]);
      return [...ids].filter((id) => npcs[id] && alive(npcs[id]));
    }

    const must = new Set<string>();
    createdIds.forEach((id) => { if (npcs[id] && alive(npcs[id])) must.add(id); });  // 本轮新建但已死亡的不强塞焦点
    Object.values(npcs).filter((n) => n.onScene && alive(n)).forEach((n) => must.add(n.id));

    const offCands = Object.values(npcs)
      .filter((n) => !n.onScene && alive(n) && !must.has(n.id))
      .filter((n) => passFrequency(n, turn, scheduling))
      .sort((a, b) => {
        const aB = /B1/.test(a.relations) ? 1 : 0;
        const bB = /B1/.test(b.relations) ? 1 : 0;
        if (aB !== bB) return bB - aB;
        return (b.lastSeenTurn ?? 0) - (a.lastSeenTurn ?? 0);
      })
      .slice(0, Math.max(0, scheduling.offSceneQuota))
      .map((n) => n.id);

    // 好友栏：处于好友栏的契约者每回合优先演化（与在场/离场配额独立，按"最久未演化"轮换）
    const friendsPerTurn = Math.max(0, scheduling.friendsPerTurn ?? 3);
    const friendIds = friendsPerTurn > 0
      ? Object.values(npcs)
          .filter((n) => n.isFriend && alive(n) && !must.has(n.id))
          .sort((a, b) => (a.lastEvolvedTurn ?? 0) - (b.lastEvolvedTurn ?? 0))
          .slice(0, friendsPerTurn)
          .map((n) => n.id)
      : [];

    return [...new Set([...must, ...friendIds, ...offCands])];
  }

  /* ─── 策略B 第三段：单 NPC 重点演化 ─── */
  async function runNpcEvolutionForTarget(charId: string, narrative: string, createdIds: Set<string>): Promise<number> {
    const { settings } = useNpcEvo.getState();
    const trimmed = trimNarrative(narrative);
    const systemPrompt = buildNpcPhaseSystemPrompt(settings.entries, trimmed, charId, createdIds);
    const recForSelf = useNpc.getState().npcs[charId];
    const needSelf = !!(recForSelf && recForSelf.background && !recForSelf.selfNarration);   // 门控：已有背景但还没自述 → 本轮一并生成
    const userContent = `# 本轮正文\n${trimmed}\n\n---\n**先输出一个 <think>…</think> 思考块**，按系统提示里的「NPC 演化思维链」对角色 ${charId} 逐项自检；**随后**只为角色 ${charId} 输出 <state> 与 <upstore> 指令（无变化输出空标签）${needSelf ? `，并按系统提示为该角色生成一个 <自述 id="${charId}"> 第一人称自述块` : ''}。禁止输出其他角色的指令、禁止输出正文；除 <think> / <state> / <upstore>${needSelf ? ' / <自述>' : ''} 外不要有其它文字。`;
    // 失败重试：单条请求失败/超时后额外重试 retryCount 次
    const retries = Math.max(0, settings.scheduling.retryCount ?? 0);
    let reply = '';
    for (let attempt = 0; attempt <= retries; attempt++) {
      try { reply = await npcChatCompletion(systemPrompt, userContent); if (reply) break; }
      catch (e) { if (attempt >= retries) throw e; console.warn(`[NPC] ${charId} 第${attempt + 1}次失败，重试…`); }
    }
    if (!reply) return 0;
    const cleanReply = reply.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim();   // 剥掉思维链再解析
    // 单角色作用域：过滤掉越界指令
    const npcCmds = parseAllNpcCommands(cleanReply).filter((c) => c.id === charId);
    applyNpcCommands(npcCmds);
    const charCmds = parseAllCharCommands(cleanReply).filter((c) => c.charId === charId);
    applyCharacterCommands(charCmds);
    const shorts = applyNpcShortCommands(cleanReply, charId);
    // 第一人称自述块（门控生成）：<自述 id="C1">…</自述> → selfNarration（仅写入本目标，幂等：已有则不会再生成）
    const selfRe = /<自述\s+id\s*=\s*["']?([CG]\d+)["']?\s*>([\s\S]*?)<\/自述>/gi;
    for (let sm = selfRe.exec(cleanReply); sm; sm = selfRe.exec(cleanReply)) {
      if (sm[1] === charId && sm[2].trim()) {
        useNpc.getState().upsertNpc(charId, { selfNarration: sm[2].trim() });
        console.log(`[NPC] ${charId} 第一人称自述已生成（${sm[2].trim().length} 字）`);
      }
    }
    useNpc.getState().markEvolved(charId, turnCountRef.current);
    console.log(`[NPC] ${charId} 演化：${npcCmds.length} 档案 / ${charCmds.length} 技能天赋 / ${shorts} 短指令`);
    return npcCmds.length + charCmds.length + shorts;
  }

  /* 手动更新单个 NPC：绕过启用/频率/调度，直接按最近一次正文对该 NPC 跑一次演化（供 NPC 面板按钮调用）。
     正文取 lastNarrativeRef；若为空（如刚读档/刷新本会话还没发消息）则回退到聊天历史里最后一条 AI 正文，
     避免"点了没反应"。反馈用浮层 toast（NPC 面板盖住了底部状态栏，状态栏日志看不见）。*/
  async function triggerNpcUpdateManually(charId: string) {
    if (npcManualUpdatingId) return;   // 一次只跑一个，避免并发打架
    const narrative = lastNarrativeRef.current
      || [...(messagesRef.current ?? [])].reverse().find((m) => m.role === 'assistant')?.content
      || '';
    const name = useNpc.getState().npcs[charId]?.name || charId;
    const toast = (kind: 'info' | 'ok' | 'err', text: string, ms = 4500) => {
      setNpcManualToast({ kind, text });
      if (kind !== 'info') setTimeout(() => setNpcManualToast((t) => (t && t.text === text ? null : t)), ms);
    };
    if (!narrative.trim()) {
      toast('err', '暂无正文内容——本会话还没生成过正文，先发一条消息再手动更新', 5000);
      return;
    }
    const npcChain = resolveApiChain('npc', getNpcApi());
    if (!npcChain[0]?.baseUrl || !npcChain[0]?.apiKey) {
      toast('err', 'NPC 演化 API 未配置（设置→NPC演化→API设置，或综合设置→API 接口库选 NPC 路由）', 6000);
      return;
    }
    setNpcManualUpdatingId(charId);
    toast('info', `正在更新「${name}」…`);
    try {
      const changes = await runNpcEvolutionForTarget(charId, narrative, new Set());
      toast('ok', `「${name}」更新完成：${changes} 项变化${changes === 0 ? '（AI 判定本轮无需改动）' : ''}`, 5000);
    } catch (e: any) {
      console.error(`[NPC] ${charId} 手动更新失败:`, e?.message ?? e);
      toast('err', `「${name}」更新失败：${String(e?.message ?? '').slice(0, 80)}`, 6000);
    } finally {
      setNpcManualUpdatingId(null);
    }
  }

  // 限并发批处理
  async function runBatched<T>(items: T[], size: number, fn: (it: T, idx: number) => Promise<void>) {
    for (let i = 0; i < items.length; i += size) {
      await Promise.allSettled(items.slice(i, i + size).map((it, k) => fn(it, i + k)));
    }
  }

  /* ─── 策略B 第四段：清理提醒（本地启发式建议）─── */
  function maybeAskCleanup(turn: number) {
    const { scheduling } = useNpcEvo.getState().settings;
    if (!scheduling.cleanupEnabled) return;
    if (turn % Math.max(1, scheduling.cleanupCycle) !== 0) return;
    const { npcs } = useNpc.getState();
    const stale = Object.values(npcs).filter(
      (n) => !n.onScene && !n.isBond && !n.keepForever && !n.isDead
        && (turn - (n.lastSeenTurn ?? 0)) >= scheduling.cleanupCycle * 2,
    );
    if (stale.length > 0) {
      console.log('[NPC] 长期不出场建议清理:', stale.map((n) => `${n.id}(${n.name})`).join(', '));
      setCleanupNpcs(stale.map((n) => ({ id: n.id, name: n.name || n.id })));  // 弹出清理提示框
    }
  }

  /* ─── 死亡 NPC 自动硬删（延迟扫描·带护栏）───
     每回合扫描：① 复活的清空 deadTurn；② 首次发现死亡的盖回合戳（给"误判复活纠偏"留窗口）；
     ③ 死亡满 deadPurgeDelay 回合、且非羁绊/非保留 → hardRemoveNpc 物理删除（连同 characterStore 档案）。
     默认关闭；强死亡证据(isDead 已经过 looksDead 严判)才会触发。 */
  function maybePurgeDead(turn: number) {
    const { scheduling } = useNpcEvo.getState().settings;
    if (!scheduling.autoPurgeDead) return;
    const delay = Math.max(0, scheduling.deadPurgeDelay ?? 3);
    const N = useNpc.getState();
    for (const n of Object.values(N.npcs)) {
      if (!n.isDead) {
        if (n.deadTurn != null) N.upsertNpc(n.id, { deadTurn: undefined });  // 复活/误判纠偏 → 清计时
        continue;
      }
      if (n.isBond || n.keepForever) continue;                                // 护栏：羁绊/手动保留不删
      if (n.deadTurn == null) { N.upsertNpc(n.id, { deadTurn: turn }); continue; }  // 首次盖戳，下回合起计延迟
      if (turn - n.deadTurn >= delay) {
        console.log(`[NPC] 死亡满 ${delay} 回合自动清除: ${n.id}(${n.name || ''})`);
        N.hardRemoveNpc(n.id);
      }
    }
  }

  /* ─── 策略B：登场判断之后的"调度 + 逐NPC演化" ─── */
  async function runNpcFocusEvolution(narrative: string, createdIds: Set<string>) {
    setNpcPhaseRunning(true);
    try {
      const turn = turnCountRef.current;
      const sched = useNpcEvo.getState().settings.scheduling;
      let focusIds = computeFocusList(createdIds, turn);
      // 每回合最多演化几个（0=不限）
      if ((sched.modelPerTurnLimit ?? 0) > 0) focusIds = focusIds.slice(0, sched.modelPerTurnLimit);
      console.log('[NPC] 重点演化列表:', focusIds.join(', ') || '（空）');
      if (focusIds.length === 0) { setNpcPhaseLog('✓ NPC 演化完成：本轮无目标'); return; }

      let done = 0;
      // 并发数可在 设置→NPC演化→调度 里调；太高会把慢端点打到 524 超时（表现为 CORS 报错）
      const conc = Math.max(1, sched.concurrency || 2);
      await runBatched(focusIds, conc, async (id) => {
        setNpcPhaseLog(`NPC 调度中 ${done + 1}/${focusIds.length}…`);
        try { await runNpcEvolutionForTarget(id, narrative, createdIds); }
        catch (e: any) { console.error(`[NPC] ${id} 演化失败:`, e?.message ?? e); }
        done++;
      });
      setNpcPhaseLog(`✓ NPC 演化完成：${focusIds.length} 个目标`);
      maybeAskCleanup(turn);
      maybePurgeDead(turn);   // 死亡 NPC 延迟自动清除（带护栏，默认关）
    } catch (e: any) {
      console.error('[NPC] 调度演化失败:', e?.message ?? e);
      setNpcPhaseLog(`⚠ NPC 更新失败：${String(e?.message ?? '').slice(0, 60)}`);
    } finally {
      setNpcPhaseRunning(false);
      setTimeout(() => setNpcPhaseLog(''), 8000);
    }
  }

  /* ─── 策略B 总管线（登场判断 → 调度 → 逐NPC，供直接调用）─── */
  async function runNpcPipelineB(narrative: string) {
    setNpcPhaseRunning(true);
    setNpcPhaseLog('NPC 登场判断中…');
    let createdIds = new Set<string>();
    try { createdIds = (await runEntryJudgment(narrative)).createdIds; }
    catch (e: any) { console.error('[NPC] 登场判断失败:', e?.message ?? e); }
    try { applyNarrativeAttrs(narrative); } catch { /* 新建NPC的卡六维 */ }   // 登场建档后照抄
    await runNpcFocusEvolution(narrative, createdIds);
    try { applyNarrativeAttrs(narrative); autoGenMissingAttrs(); ensureNpcLuck(); ensureNpcVitalsCap(); } catch { /* 重点演化后：先以正文卡为准覆盖，再给无卡NPC自动生成有起伏六维，最后前端独占重算幸运 */ }
    try { const merged = useNpc.getState().dedupeByName(); if (merged) console.log(`[NPC] 重点演化后合并了 ${merged} 个同名重复角色`); } catch { /* 防重复兜底 */ }
    try { backfillNpcStarterKits(); } catch (e) { console.warn('[NPC] 初始家当发放失败:', e); }   // 码内保证新NPC初次出现就有固定装备+储物
  }

  /* ── NPC 初始家当：码内确定性生成，保证 NPC 初次出现就携带固定数量的装备+储物物品 ──
     不依赖物品阶段时序（其与登场判断并发，新NPC常来不及）；后续增减由物品阶段按"明确入手"规则维护（与主角一致）。 */
  const NPC_KIT_STORAGE_N = 4;   // 初始储物件数（储存空间，可多给；穿戴装备改按身份强弱在提示词里分档发放）
  /* 给"在场、真实、且尚未发放过家当"的 NPC 由 AI **读其身份/职业/年龄/所处世界后**生成贴合人物的初始装备+储物
     （完整固定格式，与主角同标准）。彻底取代旧的"固定池随机发放"——避免给学生发军刺/战术装备这类离谱情况。
     每个 NPC 仅发一次（kitDone 立即置位防并发重复；无 API 则只标记、不乱发）。 */
  async function backfillNpcStarterKits() {
    const npc = useNpc.getState();
    const M = useMisc.getState();
    const allowEquip = useSettings.getState().allowAutoEquipNpc;
    const targets = Object.values(npc.npcs).filter((r) =>
      !r.isDead && r.onScene && r.name && r.name !== r.id && !r.kitDone && (r.items?.length ?? 0) === 0);
    if (targets.length === 0) return;
    for (const r of targets) npc.upsertNpc(r.id, { kitDone: true });   // 立即标记，防并发/重复发放
    const worldName = M.worldName || '轮回乐园';
    const list = targets.slice(0, 8).map((r) =>
      `${r.id} | 姓名:${r.name} | 性别:${r.gender || '?'} | 阶位等级:${r.realm || '?'} | 身份/职业:${r.profession || r.title || '?'} | 年龄:${r.age || '?'} | 背景:${(r.background || '').replace(/\s+/g, ' ').slice(0, 60)}`,
    ).join('\n');
    const sys = `你是"轮回乐园·NPC 初始物资"生成器。为下列 NPC 各生成**严格贴合其身份/职业/年龄/所处世界**的随身装备与储物。
- **必须先读懂每个 NPC 是什么人，再据此发物**：学生→课本/手机/校服/零食；上班族→公文包/工牌/西装；医生→医疗箱/手术刀/白大褂；士兵/战士→制式武器/战术护甲；街头混混→匕首/香烟；法师→法杖/魔导书；贵族→华服/首饰。**严禁给普通学生、平民、文职这类非战斗人物发军刺、军用武器、战术装备**——那是离谱错误。
- 所处世界=「${worldName}」，物品的风格/科技必须符合该世界（现代/校园/科幻/奇幻/末世等）。
- **可穿戴装备按身份/强弱给、宁少勿多**：平民/学生/杂兵/弱者 0~1 件(且多为日常衣物，绝不塞满身)，普通战斗者 1~2 件，精英 2~3 件，首领/强者/贵族才 3~5 件成套；**严禁给新手/平民/杂兵堆满装备**。每个 NPC 另给约 ${NPC_KIT_STORAGE_N} 件储物(随身杂物/消耗品/纪念品/钱袋等，储存空间可适当多给)。无战斗力的平民：装备位用**日常衣物/便服/制服**充当(category=防具)、武器可省或用日常工具，攻防可低或留空；品质(gradeDesc)按其身份与阶位给(平民多为白/绿色)。
- **完整固定格式、与主角物品同标准、不准偷懒**：每件给 name/category(武器/防具/饰品/消耗品/材料/工具/重要物品/特殊物品/其他物品)/subType(类型细分)/gradeDesc(颜色品质)/combatStat(装备攻防,平民可低/无)/durability(耐久)/requirement(装备需求)/affix(词缀)/score(评分)/effect(效果)/intro(简介)/appearance(**逐部件外观,必填不可空**)；武器另加 killCount。
- equip 每件给 equipSlot：武器→weapon:main，外衣/战甲/外套→armor:upper，**内衬/衬衣/打底→armor:inner**，头→armor:head，下装→armor:lower，鞋→armor:feet，手套→armor:hands，护臂/臂铠/护腕→armor:arms，肩→armor:shoulder，腰带→armor:belt，饰品→accessory:#1 等（按部位对号入座，别都堆 upper）。
只输出 JSON：{"kits":[{"npcId":"C1","equip":[{...固定格式字段, "equipSlot":"..."}],"storage":[{...固定格式字段}]}]}
${AFFIX_EFFECT_RULE}`;
    const user = `世界：${worldName}\nNPC 列表：\n${list}\n\n请为每个 NPC 生成贴合其身份的初始装备+储物（完整固定格式，别给学生/平民发军用装备）。`;
    try {
      const reply = await npcChatCompletion(sys, user);
      const j = parseEntryJson(reply);
      const kits = Array.isArray(j?.kits) ? j.kits : [];
      const mkItem = (id: string, it: any) => ({
        id: `I_${id}_${Date.now()}_${Math.floor(Math.random() * 1e5)}`,
        name: String(it.name ?? '物品'), category: it.category ?? '其他物品',
        gradeDesc: it.gradeDesc ?? it.grade ?? '白色', effect: it.effect ?? '', quantity: 1, equipped: false,
        equipSlot: it.equipSlot, appearance: it.appearance, acquisition: '初始携带', tags: ['初始'],
        origin: it.origin, subType: it.subType, combatStat: it.combatStat ?? it.attack ?? it.defense,
        durability: it.durability, requirement: it.requirement, affix: it.affix,
        score: it.score != null ? String(it.score) : undefined, intro: it.intro,
        killCount: it.killCount != null ? String(it.killCount) : undefined, addedAt: Date.now(),
      });
      let cnt = 0;
      for (const k of kits) {
        const id = String(k?.npcId ?? '');
        if (!useNpc.getState().npcs[id]) continue;
        for (const e of (Array.isArray(k.equip) ? k.equip : [])) {
          const item = mkItem(id, e); useNpc.getState().addNpcItem(id, item as any);
          if (allowEquip && item.equipSlot) useNpc.getState().equipNpcItem(id, item.id, item.equipSlot);
          cnt++;
        }
        for (const s of (Array.isArray(k.storage) ? k.storage : [])) { useNpc.getState().addNpcItem(id, mkItem(id, s) as any); cnt++; }
      }
      console.log(`[NPC] AI 按身份生成初始家当 ${cnt} 件（${kits.length} 个NPC）`);
    } catch (e: any) { console.warn('[NPC] AI 初始家当生成失败（本轮跳过，后续物品阶段会补）:', e?.message ?? e); }
  }

  /* ─── 策略A 核心：单次合并调用 ─── */
  async function runNpcEvolutionPhaseCoreA(narrative: string) {
    const { settings } = useNpcEvo.getState();
    const enabledEntries = (settings.entries ?? []).filter((e) => e.enabled);
    if (enabledEntries.length === 0) { console.log('[NPC] 无已启用的预设条目，跳过'); return; }

    setNpcPhaseRunning(true);
    setNpcPhaseLog('NPC 演化阶段处理中…');
    try {
      const trimmed = trimNarrative(narrative);
      const systemPrompt = buildNpcPhaseSystemPrompt(settings.entries, trimmed); // 无 charId → 在场列表
      const userContent  = `# 本轮正文\n${trimmed}\n\n---\n**先输出一个 <think>…</think> 思考块**，按系统提示里的「NPC 演化思维链」逐项自检；**随后**为正文中出现/相关的 NPC 输出 <state> 与 <upstore> 指令（无变化时输出空标签）。禁止输出正文；除 <think> / <state> / <upstore> 外不要有其它文字。`;
      const reply = await npcChatCompletion(systemPrompt, userContent);
      console.log('[NPC] 原始响应:', reply);
      if (reply) {
        const cleanReply = reply.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim();   // 剥掉思维链再解析
        const npcCmds  = parseAllNpcCommands(cleanReply); applyNpcCommands(npcCmds);
        const charCmds = parseAllCharCommands(cleanReply); applyCharacterCommands(charCmds);
        const shorts   = applyNpcShortCommands(cleanReply);
        try { useNpc.getState().dedupeByName(); } catch { /* 防同名重复建档 */ }
        try { backfillNpcStarterKits(); } catch { /* 初始家当 */ }
        try { applyNarrativeAttrs(narrative); autoGenMissingAttrs(); ensureNpcLuck(); ensureNpcVitalsCap(); } catch { /* 卡六维优先，无卡则自动生成有起伏六维，最后前端独占重算幸运 */ }
        const total = npcCmds.length + charCmds.length + shorts;
        setNpcPhaseLog(total > 0
          ? `✓ NPC 演化完成：${npcCmds.length} 条档案更新，${charCmds.length} 条技能/天赋指令`
          : '✓ NPC 演化完成：本轮无变化');
      } else {
        setNpcPhaseLog('✓ NPC 演化完成：无输出');
      }
    } catch (e: any) {
      const msg = e.message ?? '未知错误';
      console.error('[NPC] NPC 演化阶段失败:', msg);
      setNpcPhaseLog(`⚠ NPC 更新失败：${msg.slice(0, 60)}`);
    } finally {
      setNpcPhaseRunning(false);
      setTimeout(() => setNpcPhaseLog(''), 8000);
    }
  }

  /* ─── NPC 演化独立阶段（自动，按策略分支 + 频率检查）─── */
  async function runNpcEvolutionPhase(narrative: string) {
    const { settings } = useNpcEvo.getState();
    if (!settings.enabled) { console.log('[NPC] NPC 演化阶段未启用'); return; }

    // 用接口路由链判断（中心 API 接口库选了 NPC 路由也算已配置），不只看 NPC 自己的单配置
    const npcChain = resolveApiChain('npc', getNpcApi());
    if (!npcChain[0]?.baseUrl || !npcChain[0]?.apiKey) {
      console.warn('[NPC] API 未配置（设置→NPC演化→API设置，或综合设置→API 接口库选路由）');
      setNpcPhaseLog('⚠ NPC 演化：API 未配置');
      setTimeout(() => setNpcPhaseLog(''), 5000);
      return;
    }

    if (settings.strategy === 'B') {
      // 策略B：频率由调度层逐目标控制，这里每回合都进入管线
      await runNpcPipelineB(narrative);
    } else {
      const freq = settings.frequency || 1;
      if (turnCountRef.current % freq !== 0) {
        console.log(`[NPC] 回合 ${turnCountRef.current} 不触发（每 ${freq} 回合一次）`);
        return;
      }
      await runNpcEvolutionPhaseCoreA(narrative);
    }
  }

  /* ─── 正文完成后的后续阶段编排 ───
     三阶段**全部并发、互不阻塞**：物品管理绝不等待 NPC 登场判断
     （此前 await 登场判断会让慢/挂起的 NPC API 拖死物品管理）。
     登场判断（较快）通常先于体量巨大的物品阶段完成，并在完成时刷新
     `npcPreferredOwners`，配合 owner 解析器仍能把 NPC 装备挂到正确的 NPC 上。 */
  /* ════════════════════════════════════════════
     生平压缩 / 记忆整理阶段（达阈值时批量压缩 short/long 记忆）
  ════════════════════════════════════════════ */
  // 联机房主：真人队友不是NPC的铁则（附给 NPC + 物品阶段，避免房主把队友当NPC演化/给物品）
  function mpHostExcludeRule(): string {
    const mp = useMp.getState();
    if (mp.status !== 'connected' || mp.role !== 'host') return '';
    const names = (mp.seats || []).map((s) => s.name).filter(Boolean);
    if (!names.length) return '';
    return `\n\n【联机·真人队友铁则】以下是真人玩家操控的队友角色，**不是NPC**：${names.join('、')}。绝不要为他们建立或更新NPC档案、不要演化他们的属性/技能、不要给他们增减任何物品或装备——他们由各自的玩家自行演化。你只演化真正的NPC与世界本身。`;
  }

  // 联机来宾：用自己的 API 演化自己的角色(六维/身份/技能天赋/背包/生平)，不碰共享世界
  // ════ 联机·完整版双视角（主控-分支-对齐，建房勾选「双视角模式」启用）════
  function povJson(s: string): any { try { const m = (s || '').match(/\{[\s\S]*\}/); return lenientJsonParse(m ? m[0] : s) || {}; } catch { return {}; } }
  function myTextChain() { const ss = useSettings.getState(); return resolveApiChain('text', ss.textUseSharedApi ? ss.api : ss.textApi); }


  // ── 分头行动·隐藏结局（Phase 3 跨玩家条件触发）──
  // 全队合计持有的物品名集合（房主自己背包 + 各来宾上报卡里的装备/物品）
  function partyItemNames(): Set<string> {
    const norm = (s: any) => String(s || '').trim().toLowerCase();
    const set = new Set<string>();
    for (const it of (useItems.getState().items || [])) set.add(norm(it.name));
    for (const c of (useMp.getState().cards || [])) {
      const sn: any = c?.snapshot;
      for (const e of (sn?.equipment || [])) set.add(norm(e?.name));
      for (const it of (sn?.items || [])) set.add(norm(it?.name));
    }
    set.delete('');
    return set;
  }
  // 房主：检查未达成的隐藏条件是否已集齐（确定性·宽松名称匹配）；新达成则标记+广播+返回解锁注入
  function checkHiddenConditions(): string {
    if (useMp.getState().role !== 'host') return '';
    const conds = useMp.getState().hiddenConditions || [];
    if (!conds.length) return '';
    const have = partyItemNames();
    const satisfies = (req: string) => { const r = String(req || '').trim().toLowerCase(); if (!r) return false; for (const n of have) if (n.includes(r) || r.includes(n)) return true; return false; };
    const newly: HiddenCondition[] = [];
    let changed = false;
    const next = conds.map((c) => {
      if (c.met) return c;
      if ((c.requiredItems || []).length && (c.requiredItems || []).every(satisfies)) { changed = true; newly.push(c); return { ...c, met: true }; }
      return c;
    });
    if (changed) { useMp.getState()._set({ hiddenConditions: next }); try { mpClient.relay('hidden_sync', { conditions: next }); } catch { /* */ } }
    if (!newly.length) return '';
    return newly.map((c) => `【隐藏条件达成·${c.title}】队伍已集齐【${(c.requiredItems || []).join('、')}】！请据此触发隐藏剧情/结局：${c.reward}。让它成为本回合的高光转折，而非一笔带过。`).join('\n');
  }
  // 房主：用 AI 编织 1~2 个跨玩家隐藏条件（集齐剧情道具触发）→ 全房可见当目标
  async function genHiddenConditions() {
    if (useMp.getState().role !== 'host') return;
    const chain = myTextChain();
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { setGenError('编织隐藏结局需要房主配置「正文生成」API'); setTimeout(() => setGenError(''), 4000); return; }
    const myName = usePlayer.getState().profile.name || '主角';
    const cards = (useMp.getState().cards || []).map((c) => c?.snapshot).filter(Boolean) as any[];
    const roster = [myName, ...cards.map((s) => s?.name)].filter(Boolean).join('、');
    const haveItems = Array.from(partyItemNames()).slice(0, 30).join('、') || '（暂无）';
    const world = useMisc.getState().worldName || '当前世界';
    const sys = `你是「隐藏结局编织者」。为这局组队设计 1~2 个【跨玩家隐藏条件】——只有当队伍通过分头行动集齐特定「剧情道具」时才触发的隐藏剧情/结局，鼓励玩家分头去不同支线搜集稀有之物、再回援汇合。
每个条件：
- title：隐藏条件名（4~8字，有悬念）
- requiredItems：触发所需的剧情道具名数组（2~3件，应是需要冒险/支线才能得到的稀有之物，可以是当前还没有、需要玩家去争取的）
- reward：集齐后解锁的隐藏剧情/结局/合体能力（一句话，埋悬念）
严格只输出 JSON：{"conditions":[{"title":"...","requiredItems":["...","..."],"reward":"..."}]}，不要输出别的。
【队伍】${roster}　【当前已有关键物品】${haveItems}　【世界】${world}`;
    try {
      const { content } = await apiChatFallback(chain, [
        { role: 'system', content: sys },
        { role: 'user', content: '只输出 JSON 对象。' },
      ], { timeoutMs: 60000 });
      const arr = povJson(content).conditions;
      if (!Array.isArray(arr) || !arr.length) { setGenError('隐藏结局生成失败，请重试'); setTimeout(() => setGenError(''), 4000); return; }
      const conds: HiddenCondition[] = arr.slice(0, 3).map((c: any, i: number) => ({
        id: `hc_${Date.now()}_${i}`,
        title: String(c?.title || `隐藏条件${i + 1}`).slice(0, 20),
        requiredItems: (Array.isArray(c?.requiredItems) ? c.requiredItems : []).map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 4),
        reward: String(c?.reward || '').slice(0, 200),
        met: false,
      })).filter((c) => c.requiredItems.length);
      useMp.getState()._set({ hiddenConditions: conds });
      try { mpClient.relay('hidden_sync', { conditions: conds }); } catch { /* */ }
    } catch (e) { console.warn('[隐藏结局] 生成失败', e); setGenError('隐藏结局生成失败'); setTimeout(() => setGenError(''), 4000); }
  }

  // 来宾·视角改写（P2 双视角轻量版）：把房主广播的「客观群像正文」用来宾自己的正文 API 改写成本人视角。
  // 纯展示层——只替换聊天里那条消息的文本，绝不碰权威世界态、也不喂演化(runGuestSelfEvolution 仍用客观原文)。
  // 没配 key / 改写失败 / 返回过短 → 静默保留客观正文，不打断体验。
  async function runGuestPovRewrite(src: string, msgId: number) {
    try {
      const ss = useSettings.getState();
      const api = ss.textUseSharedApi ? ss.api : ss.textApi;
      const chain = resolveApiChain('text', api);
      if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return;   // 来宾没配正文 key → 保留客观正文
      const myName = usePlayer.getState().profile.name || '主角';
      const mpSt = useMp.getState();
      const others = Array.from(new Set([
        mpSt.room?.hostName,
        ...(mpSt.cards || []).map((c) => c?.snapshot?.name),
        ...(mpSt.seats || []).map((s) => s.name),
      ].filter((n): n is string => !!n && n !== myName)));
      const povSel = ss.narrativePov && ss.narrativePov !== 'off' ? ss.narrativePov : 'second';
      const povWord = povSel === 'first' ? '第一人称（我）' : povSel === 'third' ? '第三人称' : '第二人称（你）';
      const sys = `你是联机正文的「视角改写器」。下面给你一段【客观群像正文】(房主视角，多名真人玩家同场)。任务：以玩家【${myName}】为主视角，用${povWord}改写成【${myName}】本人的临场叙事。\n硬性要求：\n1. **客观事实/动作/结果/对白的含义一字不改**——谁做了什么、谁受伤、谁拿到什么、时间地点都必须与原文一致，只改叙述视角、感官与心理着墨重心。\n2. 突出【${myName}】的所见所感所想；${others.length ? `其他同伴（${others.join('、')}）是别人，保留其行动但**不要替他们新增戏份或心理**。` : '其他出场者是别人，不要替他们加戏。'}\n3. 不要新增剧情、不要总结、不要加旁白说明，直接输出改写后的正文本身。`;
      const { content } = await apiChatFallback(chain, [
        { role: 'system', content: sys },
        { role: 'user', content: src },
      ], { timeoutMs: 120000 });
      const out = (content || '').trim();
      if (out.length > 10 && useMp.getState().role === 'player') {   // 仍在房里当来宾才替换，避免离开后晚到的改写污染
        setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, content: out } : m));
      }
    } catch (e) { console.warn('[MP] 来宾视角改写失败，保留客观正文', e); }
  }

  async function runGuestSelfEvolution(narrative: string) {
    turnCountRef.current += 1;   // 来宾自己的回合推进（让各阶段频率门正常工作）
    try { useMisc.getState().setTurnCount(turnCountRef.current); } catch { /* 持久化累计回合数 */ }
    try { useItems.getState().setItemTurn(turnCountRef.current); } catch { /* */ }
    // 来宾在「房主视角群像正文」上演化自己 → 必须用真名硬锚点：正向「你叫X，只更新X」比泛泛的负向
    // 约束强得多，否则 AI 会把别的同伴(尤其房主角色)用的技能/拿的物品当成"主角"的收获加到本来宾身上(技能泄漏 bug)。
    const myName = usePlayer.getState().profile.name || '主角';
    const mpSt = useMp.getState();
    const others = Array.from(new Set([
      mpSt.room?.hostName,
      ...(mpSt.cards || []).map((c) => c?.snapshot?.name),
      ...(mpSt.seats || []).map((s) => s.name),
    ].filter((n): n is string => !!n && n !== myName)));
    const othersHint = others.length
      ? `本段是房主视角的群像叙事，里面的其他同伴（如 ${others.join('、')} 等）都不是你。`
      : '本段正文里除你之外出现的其他角色都不是你。';
    const selfRule = `\n\n【联机·只演化你自己】你本人操控的角色叫【${myName}】，你**只更新【${myName}】这一个角色及其物品**。${othersHint}他们的技能/天赋/物品/属性/成长一律与【${myName}】无关，**绝不要**加到【${myName}】身上；只有正文明确写到【${myName}】本人获得或成长时才更新。`;
    await Promise.allSettled([
      runPlayerEvolutionPhase(narrative + selfRule),
      runItemManagementPhase(narrative + selfRule),
    ]);
    try { await runMemoryCompressionPhase(true); } catch { /* */ }   // 只压自己 B*
  }

  async function runMemoryCompressionPhase(onlyPlayer = false) {
    const { settings } = useMemory.getState();
    if (!settings.enabled) return;

    const chars = useCharacters.getState().characters;
    const inScope = (id: string) => {
      const isPlayer = /^B\d+$/.test(id);
      const isNpc = /^[CG]\d+$/.test(id);
      if (onlyPlayer) return isPlayer;   // 联机来宾：只压自己(B*)，不碰房主同步来的 NPC
      if (settings.scope === 'player') return isPlayer;
      if (settings.scope === 'npc') return isNpc;
      return isPlayer || isNpc;
    };
    const overThreshold = (mem?: { shortTerm: MemoryEntry[]; longTerm: MemoryEntry[] }) =>
      !!mem && ((mem.shortTerm?.length ?? 0) >= settings.shortTermThreshold
        || (mem.longTerm?.length ?? 0) >= settings.longTermThreshold);

    const targets = Object.values(chars).filter((c) => inScope(c.id) && overThreshold(c.memory));
    if (targets.length === 0) return;

    // API：生平压缩独立 API（可共用正文 API）
    const memState = useMemory.getState();
    const ss = useSettings.getState();
    const legacyApi = memState.memoryUseSharedApi
      ? (ss.textUseSharedApi ? ss.api : ss.textApi)
      : memState.memoryApi;
    const chain = resolveApiChain('memory', legacyApi);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[Memory] API 未配置，跳过生平压缩'); return; }

    const npcs = useNpc.getState().npcs;
    const playerBg = usePlayer.getState().profile.background;
    const payload = targets.map((c) => ({
      id: c.id,
      name: /^B\d+$/.test(c.id) ? '主角' : (npcs[c.id]?.name ?? c.id),
      bio: /^B\d+$/.test(c.id) ? playerBg : (npcs[c.id]?.background ?? ''),
      shortTerm: c.memory?.shortTerm ?? [],
      longTerm: c.memory?.longTerm ?? [],
    }));

    const systemPrompt = settings.prompt.replace('${characters_payload}', JSON.stringify(payload, null, 2));
    console.log('[Memory] 生平压缩触发，目标:', targets.map((t) => t.id).join(', '));

    try {
      const { content: reply } = await apiChatFallback(chain, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '请按【输出格式】只输出 JSON 对象。' },
      ]);
      console.log('[Memory] 压缩响应:', reply);

      // 提取 JSON object
      const jsonText = (reply.match(/\{[\s\S]*\}/) ?? [''])[0];
      if (!jsonText) { console.warn('[Memory] 未解析到 JSON'); return; }
      const parsed = JSON.parse(jsonText);
      const results = parsed.results ?? {};

      const charStore = useCharacters.getState();
      const npcStore = useNpc.getState();
      for (const [id, r] of Object.entries(results) as [string, any][]) {
        const clamp = (arr: any, keep: number): MemoryEntry[] =>
          (Array.isArray(arr) ? arr : []).slice(0, keep).map((e: any) => ({
            time: String(e?.time ?? ''), location: String(e?.location ?? ''), content: String(e?.content ?? ''),
          })).filter((e: MemoryEntry) => e.content);
        const shortTerm = clamp(r.shortTerm, settings.shortTermKeep);
        const longTerm = clamp(r.longTerm, settings.longTermKeep);
        charStore.setMemory(id, { shortTerm, longTerm });
        if (typeof r.bio === 'string' && r.bio.trim()) {
          if (/^B\d+$/.test(id)) usePlayer.getState().setBackground(r.bio.trim());
          else if (npcStore.npcs[id]) npcStore.upsertNpc(id, { background: r.bio.trim() });
        }
        console.log(`[Memory] ${id} 压缩完成：short ${shortTerm.length} / long ${longTerm.length}`);
      }
    } catch (e: any) {
      console.error('[Memory] 生平压缩失败:', e.message ?? e);
    }
  }

  /* ════════════════════════════════════════════
     杂项演化阶段（分段总结 / 双时间 / 天气 / 世界大事 / 任务）
  ════════════════════════════════════════════ */
  async function runMiscEvolutionPhase(narrative: string) {
    const M = useMisc.getState();
    if (!M.settings.enabled) return;
    const ss = useSettings.getState();
    const legacyApi = M.miscUseSharedApi
      ? (ss.textUseSharedApi ? ss.api : ss.textApi)
      : M.miscApi;
    const chain = resolveApiChain('misc', legacyApi);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[Misc] API 未配置，跳过杂项演化'); return; }

    const enabledEntries = (M.settings.entries ?? []).filter((e) => e.enabled);
    if (enabledEntries.length === 0) { console.warn('[Misc] 无启用的预设条目，跳过杂项演化'); return; }
    // 大总结周期：每 largeEvery 个杂项演化回合才产一条大总结（聚合压缩近期小总结），其余回合只出小总结
    const round = M.bumpSummaryRound();
    const largeEvery = Math.max(1, M.settings.largeEvery || 6);
    const isLargeTurn = round % largeEvery === 0;
    const recentSmall = M.smallSummaries.slice(-(largeEvery + 2)).map((s, i) => `${i + 1}. ${s}`).join('\n') || '（暂无小总结）';
    const playerName = usePlayer.getState().profile.name || '主角';
    const tlRow = `${M.worldName || '轮回乐园'} ${M.worldTime || M.paradiseTime || ''}`.trim();
    // 进入新世界检测：当前世界名与上次杂项演化所见不同→触发主线路线图规划。
    // 首次（prev 为空）只设基线不触发，避免读档/刷新后误判（reload 会重置此 ref）。
    const enteredNewWorld =
      prevWorldNameRef.current !== '' && !!M.worldName && M.worldName !== prevWorldNameRef.current
      && !isHomeWorld(M.worldName);   // 只在进入"任务世界"才触发主线规划；轮回乐园/专属房间/各乐园(枢纽)不规划主线
    prevWorldNameRef.current = M.worldName || prevWorldNameRef.current;
    // 主角处境快照（供任务接地"结合主角处境"）+ 同人增强开关（控制是否联网搜原作设定）
    const _pp = usePlayer.getState().profile;
    const playerSituation = [
      _pp.name,
      _pp.tier && `${_pp.tier}${_pp.level != null ? `·Lv${_pp.level}` : ''}`,
      _pp.bioStrength && `强度:${_pp.bioStrength}`,
      _pp.homeParadise && `所属乐园:${_pp.homeParadise}`,
      _pp.identity && `身份:${_pp.identity}`,
      _pp.location && `位置:${_pp.location}`,
      `进行中任务:${M.tasks.length}`,
    ].filter(Boolean).join('｜');
    const fanficOn = useSettings.getState().fanficMode;
    // 杂项演化·任务与世界规范图鉴（builtinKey='twb-misc'）：杂项阶段专用参照系，强制全量注入本书所有启用条目（不看蓝/绿灯）。
    // 整本书禁用或被删则优雅留空——可在「正文世界书」列表里编辑，改即生效。
    const miscCodexInjection = (() => {
      const book = useSettings.getState().textWorldBooks.find((b) => b.builtinKey === 'twb-misc');
      if (!book || book.enabled === false) return '';
      const body = book.entries.filter((e) => e.enabled !== false).map((e) => e.content.trim()).filter(Boolean).join('\n\n');
      return body ? `\n\n【杂项演化·任务与世界规范图鉴（生成任务/世界大事/天气/总结前务必逐条对照）】\n${body}` : '';
    })();
    const systemPrompt = buildMiscSystemPrompt(M.settings.entries)
      .replaceAll('${story_text}', narrative)
      .replaceAll('${user_input}', '')
      .replaceAll('${current_paradise_time}', M.paradiseTime || '（未设定）')
      .replaceAll('${current_world_time}', M.worldTime || '（未设定）')
      .replaceAll('${current_world_name}', M.worldName || '轮回乐园')
      .replaceAll('${weather}', M.weather || '（未设定）')
      .replaceAll('${current_tasks}', serializeTasks(M.tasks))
      .replaceAll('${world_events}', serializeEvents(M.worldEvents))
      .replaceAll('${next_available_task_id}', M.nextTaskId())
      // ── 原版 13 条规则里残留的占位符（无小地图，按需填充/置空）──
      .replaceAll('${current_time}', M.worldTime || M.paradiseTime || '（未设定）')
      .replaceAll('${current_location}', M.worldName || '（未设定）')
      .replaceAll('${time_location_row}', tlRow || '（未设定）')
      .replaceAll('${world_map_pois}', '（未启用小地图）')
      .replaceAll('${current_scene_map}', '（未启用小地图）')
      .replaceAll('${world_factors}', '（无）')
      .replaceAll('${player_name}', playerName)
      .replaceAll('${player_traits}', '（略）')
      + '\n\n' + NARRATIVE_FIRST_RULE + '\n' + MISC_HOME_TIME_RULE
      + '\n\n' + WORLD_EVENT_LOCATION_RULE
      + '\n\n' + MISC_SUMMARY_CADENCE_RULE
      + '\n\n' + WEATHER_FX_GEN_RULE
      + '\n\n' + MISC_WEATHER_RULE
      + '\n\n' + TASK_OUTCOME_RULE
      + '\n\n' + POTENTIAL_POINT_RULE
      + '\n\n' + QUEST_HOME_NO_GEN_RULE
      + '\n\n' + QUEST_PLANNING_RULE
      + '\n\n' + QUEST_KILL_TIER_RULE
      + '\n\n' + QUEST_RATING_RULE
      + '\n\n' + TASK_RECONCILE_RULE
      + '\n\n' + TASK_PROGRESS_RULE
      + '\n\n' + TASK_CANON_RULE
      + miscCodexInjection
      + `\n【进入新世界信号】：${enteredNewWorld ? '是 —— 本轮检测到进入新的任务世界，请按【主线路线图规划】检查：当前任务世界若尚无 active 主线，则把该世界自身的核心目标立成主线并规划整张环路线图' : (isHomeWorld(M.worldName) ? '否 —— 当前在轮回乐园/专属房间(枢纽·任务间歇)，按【乐园·枢纽禁止生成任务】**禁止生成任何新任务**（主线/支线/隐藏/单环全不建），更不要"熟悉环境/适应乐园/逛街采购/进入衍生世界/获取身份/回归乐园"等流程·杂事任务；只对既有任务做结算/推进，等真正进入任务世界(衍生世界)再规划' : '否（沿用既有主线，勿重复新建）')}`
      + `\n【当前世界】：${M.worldName || '轮回乐园'}`
      + `\n【同人增强】：${fanficOn ? '开 —— 若当前世界为已知虚构作品，按【同人世界·任务接地】先联网搜索原作设定，再据此规划/生成任务' : '关（不联网搜索，按正文与世界设定生成任务）'}`
      + `\n【主角当前处境（任务须与之契合）】：${playerSituation || '（未建档）'}`
      + `\n【本轮大总结开关】：${isLargeTurn ? `是（本轮是第 ${round} 轮，到达大总结周期，必须压缩近期小总结输出 1 条大总结）` : `否（本轮第 ${round} 轮，未到周期，只写小总结，禁止输出大总结）`}`
      + `\n【最近小总结（供大总结压缩参考，仅在开关=是时使用）】：\n${recentSmall}`
      + '\n\n' + MISC_COT_RULE;

    try {
      const { content: reply } = await apiChatFallback(chain, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '请按【输出格式铁律】只输出 <upstore> 指令块。' },
      ]);
      console.log('[Misc] 杂项演化响应:', reply);
      const applied = applyMiscCommands(reply, { allowLarge: isLargeTurn });
      console.log(`[Misc] 杂项演化应用 ${applied} 条指令（第 ${round} 轮，大总结周期：${isLargeTurn ? '是' : '否'}）`);
      // 顶栏天气特效：AI 为奇异天气生成的纯 CSS（sanitize 后按当前天气缓存；常规天气无此块，走前端预设）
      try {
        const fxCss = sanitizeWeatherCss(extractWeatherFxCss(reply));
        if (fxCss) { useMisc.getState().setWeatherFx(useMisc.getState().weather, fxCss); console.log('[Misc] 天气特效CSS已缓存', useMisc.getState().weather); }
      } catch (e) { console.warn('[Misc] 天气特效CSS解析失败', e); }
      // 把本轮小/大总结挂到最近一条 assistant 楼层（供叙事记忆三档注入）；非大总结周期不挂大总结
      const { small, large: largeRaw } = extractTurnSummaries(reply);
      const large = isLargeTurn ? largeRaw : undefined;
      if (small || large) {
        setMessages((ms) => {
          for (let i = ms.length - 1; i >= 0; i--) {
            if (ms[i].role === 'assistant') {
              const next = [...ms];
              next[i] = { ...next[i], ...(small ? { smallSummary: small } : {}), ...(large ? { largeSummary: large } : {}) };
              return next;
            }
          }
          return ms;
        });
      }
    } catch (e: any) {
      console.error('[Misc] 杂项演化失败:', e.message ?? e);
      setMiscPhaseLog(`⚠ 杂项更新失败：${(e.message ?? '').slice(0, 50)}`);
      setTimeout(() => setMiscPhaseLog(''), 8000);
    }
  }

  /* ════════════════════════════════════════════
     领地演化阶段（单一基地，仿杂项演化：单目标 + 独立 API + frequency 门控）
  ════════════════════════════════════════════ */
  function serializeTerritorySnapshot(): string {
    const T = useTerritory.getState();
    if (!T.unlocked) return '（领地尚未开辟。若本回合正文中主角建立/获得了据点/基地/领地，用 unlockTerritory 开辟；name 取正文中该基地的既有称呼或主角为其起的名字，正文未命名则留空 name（待玩家自定义），**不要凭空编一个通用名如“轮回乐园基地/我的领地”**。）';
    const cap = buildingCap(T.level);
    const npcs = useNpc.getState().npcs;
    const lines: string[] = [
      `名称：${T.name || '（未命名）'}`,
      `等级：${realmFromLevel(T.level)}·Lv.${T.level}（建设进度 ${T.buildProgress}/100）`,
      `建筑：${T.buildings.length}/${cap} 栋${T.buildings.length ? '——' + T.buildings.map((b) => `${b.name}(Lv.${b.level})`).join('、') : '（无）'}`,
      `领地效果：${T.effects.length ? T.effects.map((e) => e.name).join('、') : '（无）'}`,
      // 成员标出 C-id↔NPC名：AI 关联只能用 C-id；已列出的 NPC 即已是成员，勿重复 addMember
      `成员（关联只用 C-id）：${T.members.length ? T.members.map((m) => { const nm = npcs[m.id]?.name; return `${m.id}${nm && nm !== m.id ? '·' + nm : ''}${m.role ? '(' + m.role + ')' : ''}`; }).join('、') : '（无）'}`,
      // 仓库列出现有全名+品级：入库已有物资须照抄全名使其累加，勿换写法另建
      `仓库（入库已有物资照抄全名）：${T.storageItems.length ? T.storageItems.map((i) => `${i.name}${i.gradeDesc ? '[' + i.gradeDesc + ']' : ''}×${i.quantity}`).slice(0, 20).join('、') : '（空）'}`,
      `外观：${T.appearance || '（未描写）'}`,
      `被动产出：${T.passiveOutput || '（无）'}`,
    ];
    return lines.join('\n');
  }

  async function runTerritoryEvolutionPhase(narrative: string) {
    const T = useTerritory.getState();
    if (!T.settings.enabled) return;
    if (turnCountRef.current % (T.settings.frequency || 1) !== 0) return;
    const ss = useSettings.getState();
    const legacyApi = T.territoryUseSharedApi
      ? (ss.textUseSharedApi ? ss.api : ss.textApi)
      : T.territoryApi;
    const chain = resolveApiChain('territory', legacyApi);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[Territory] API 未配置，跳过领地演化'); return; }

    const enabledEntries = (T.settings.entries ?? []).filter((e) => e.enabled);
    if (enabledEntries.length === 0) { console.warn('[Territory] 无启用预设条目，跳过'); return; }

    // 演化前先自愈存量重复条目（成员名字误当id / 仓库同名拆条），让快照与面板立即变干净
    T.reconcileMembers(useNpc.getState().npcs);
    T.dedupeStorage();

    const npcRecords = Object.values(useNpc.getState().npcs).filter((r) => !r.isDead);
    const onscreenNpcs = npcRecords.filter((r) => r.onScene).length > 0
      ? npcRecords.filter((r) => r.onScene).map((r) => `[${r.id}] ${r.name}（${r.realm || '阶位未知'}）`).join('\n')
      : '（无在场 NPC，addMember 只能用已建档的 C-id）';
    const playerName = usePlayer.getState().profile.name || '主角';

    const systemPrompt = buildTerritorySystemPrompt(T.settings.entries)
      .replaceAll('${story_text}', narrative)
      .replaceAll('${territory_snapshot}', serializeTerritorySnapshot())
      .replaceAll('${onscreen_npcs}', onscreenNpcs)
      .replaceAll('${player_name}', playerName)
      + '\n\n' + NARRATIVE_FIRST_RULE + '\n' + TERRITORY_EFFECT_RULE + '\n' + TERRITORY_STABILITY_RULE + '\n' + TERRITORY_DEDUP_RULE + '\n' + TERRITORY_COT_RULE;

    setTerritoryPhaseLog('领地演化中…');
    try {
      const { content: rawReply } = await apiChatFallback(chain, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '**先输出一个 <think>…</think> 思考块**，按「领地演化思维链」逐项自检（尤其：本轮没明确建立领地就绝不凭空造领地/建筑）；**随后**按【输出格式铁律】输出 <upstore> 指令块（必要时附 <state> 块），无变化输出空块。' },
      ]);
      console.log('[Territory] 领地演化响应:', rawReply);
      const reply = (rawReply || '').replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim();   // 剥掉思维链再解析
      const applied = applyTerritoryCommands(reply);
      // 被动产出/货币：复用物品指令通道（transferSpiritStones 进钱包）
      const itemCmds = parseAllItemCommands(reply);
      if (itemCmds.length > 0) applyItemCommands(itemCmds);
      console.log(`[Territory] 领地演化应用 ${applied} 条指令`);
      setTerritoryPhaseLog('✓ 领地演化完成');
    } catch (e: any) {
      console.error('[Territory] 领地演化失败:', e.message ?? e);
      setTerritoryPhaseLog(`⚠ 领地更新失败：${(e.message ?? '').slice(0, 50)}`);
    } finally { setTimeout(() => setTerritoryPhaseLog(''), 8000); }
  }

  /* ════════════════════════════════════════════
     副职业演化（subprof）——只据正文结算【配方熟练度】+ 对配方【质变】；副职业本体与「副职业熟练度」只由配方树管，这里不碰。
     机械预筛：正文提到某副职业名/某配方名，或某副职业熟练度档位较上次升了 → 才调 API（与副职业生成同 subproftree 路由）。
     熟练度增量按副职业熟练度档位的成长倍率放大；升档则对该副职业名下全部配方做一次质变。
  ════════════════════════════════════════════ */
  async function runSubProfEvolutionPhase(narrative: string) {
    const subs = useCharacters.getState().characters['B1']?.subProfessions ?? [];
    if (!subs.length) return;

    // 各副职业当前熟练度档 + 「升档」检测（与上次演化所见对比 → 全配方质变）
    const seen = useSubProfTree.getState().progress['B1']?.evoSeenTier ?? {};
    const masteryOf: Record<string, ReturnType<typeof subProfMastery>> = {};
    const tierUpProfs: string[] = [];
    for (const sp of subs) {
      const m = subProfMastery(sp.name, 'B1'); masteryOf[sp.name] = m;
      if (m.idx > (seen[sp.name] ?? 0)) tierUpProfs.push(sp.name);
    }
    const qualiaList = tierUpProfs.flatMap((prof) => (subs.find((x) => x.name === prof)?.recipes ?? []).map((r) => `${prof}::${r.name}`));

    // 机械预筛：正文提到任一副职业名 / 任一配方名，或本轮有副职业升档 → 才调 API
    const text = narrative || '';
    const mentioned = subs.some((sp) => (sp.name && text.includes(sp.name)) || (sp.recipes ?? []).some((r) => r.name && text.includes(r.name)));
    if (!mentioned && qualiaList.length === 0) return;

    const ss = useSettings.getState();
    const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
    const chain = resolveApiChain('subproftree', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[SubProf] API 未配置，跳过副职业演化'); return; }

    const ctxLines = subs.map((sp) => {
      const m = masteryOf[sp.name];
      const recs = (sp.recipes ?? []).map((r) => `  · ${r.name}（${r.tier ?? ''}·熟练${r.progress ?? 0}%）产物:${r.output ?? r.desc ?? ''}`).join('\n') || '  （暂无配方）';
      return `【${sp.name}】副职业熟练度:${m.tier}（第${m.idx + 1}档·配方成长×${m.growthMul}）\n${recs}`;
    }).join('\n');
    const qualiaLine = qualiaList.length ? qualiaList.join('、') : '（本轮无副职业升档；除非正文明确写某配方"被改良/做得远胜从前"，否则一律别质变）';
    const userContent = `# 主角副职业与配方\n${ctxLines}\n\n# 待质变清单（这些配方所属副职业刚晋升，请逐张 addRecipe 质变）\n${qualiaLine}\n\n# 本轮正文\n${narrative}\n\n---\n据上面【铁则】只输出 <upstore> 指令块（无变化输出空 <upstore></upstore>）。`;

    try {
      const { content: rawReply } = await apiChatFallback(chain, [
        { role: 'system', content: SUBPROF_EVO_PROMPT },
        { role: 'user', content: userContent },
      ]);
      const reply = (rawReply || '').replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim();
      const cmds = parseAllCharCommands(reply).filter((c) => c.charId === 'B1' && (c.type === 'bumpRecipe' || c.type === 'addRecipe'));
      let applied = 0;
      const chars = useCharacters.getState();
      for (const c of cmds) {
        const d: any = c.payload;
        const prof = d.prof ?? d.subProfession ?? d.profession;
        if (!prof) continue;
        const m = masteryOf[prof] ?? subProfMastery(prof, 'B1');
        if (c.type === 'bumpRecipe') {
          const name = d.name ?? d.recipe; const base = Number(d.delta ?? d.progress ?? d.amount);
          if (name && Number.isFinite(base) && base !== 0) { chars.bumpRecipe('B1', prof, name, Math.max(1, Math.round(base * m.growthMul))); applied++; }   // 副职业熟练度越高，配方涨得越快
        } else if (c.type === 'addRecipe' && d.name) {
          // 质变覆盖：只更新【已存在】的配方（不新增）；略去 progress → 保留熟练度；缺字段沿用旧值
          const old = (useCharacters.getState().characters['B1']?.subProfessions ?? []).find((sp) => sp.name === prof)?.recipes?.find((r) => r.name === d.name);
          if (old) { chars.addRecipe('B1', prof, { id: old.id, name: d.name, tier: d.tier ?? old.tier, materials: d.materials ?? old.materials, output: d.output ?? old.output, desc: d.desc ?? old.desc } as any); applied++; }
        }
      }
      for (const prof of tierUpProfs) useSubProfTree.getState().setEvoSeenTier('B1', prof, masteryOf[prof].idx);   // 记录已质变到的档，防重复全质变
      console.log(`[SubProf] 副职业演化应用 ${applied} 条（提到=${mentioned}，升档=${tierUpProfs.join('/') || '无'}）`);
    } catch (e: any) {
      console.error('[SubProf] 副职业演化失败:', e?.message ?? e);
    }
  }

  /* ════════════════════════════════════════════
     万族演化（cosmos）——宇宙背景层（七乐园/万族/文明/原生世界/神灵/深渊）
     - 独立 API + frequency(默认3)；代码选焦点 + 参与门槛，AI 出 JSON 推演
  ════════════════════════════════════════════ */
  function serializeCosmosSnapshot(focusIds: Set<string>): string {
    const all = useCosmos.getState().entities;
    if (all.length === 0) return '（宇宙棋盘为空，可据正文/设定按需新建实体）';
    const home = (usePlayer.getState().profile.homeParadise || '').trim() || '轮回乐园';
    const detail = all.filter((e) => focusIds.has(e.id)).map((e) => {
      const bits = [
        `「${cleanCosmosName(e.name)}」[${e.category}·优先级${e.priority}]`,
        `状态:${e.status}${e.destroyed ? '(已覆灭)' : ''}`,
        e.rank ? `排名:${e.rank}` : '',
        e.power && `实力:${e.power}`,
        e.territory && `疆域:${e.territory}`,
        e.goal && `动向:${e.goal}`,
        e.towardParadise && `对${home}:${e.towardParadise}`,
        e.relations.length ? `关系:${e.relations.map((r) => `${r.target}(${r.relation})`).join('、')}` : '',
        Object.keys(e.extra).length ? `备注:${Object.entries(e.extra).map(([k, v]) => `${k}:${v}`).join('；')}` : '',
        e.deeds.length ? `近期大事记(新→旧，据此延续走向、勿与之矛盾):${e.deeds.slice(0, 6).map((d) => (d.time ? `[${d.time}]` : '') + d.desc).join(' / ')}` : '',
      ].filter(Boolean);
      return '· ' + bits.join('；');
    });
    const others = all.filter((e) => !focusIds.has(e.id)).map((e) => `${cleanCosmosName(e.name)}(${e.status})`);
    return `【焦点实体（本轮重点推演）】\n${detail.join('\n') || '（无）'}\n\n【其余实体名录（一般不动，必要时可微调）】\n${others.join('、') || '（无）'}`;
  }

  /* 注入正文的 <万族态势> 块（独立于叙事记忆开关；轮回乐园 + 当前动荡 + 相关 + 不相关采样）*/
  /* 同人增强·下回合注入：把已锁定的虚构角色设定拼成 system 块注入正文，保持口癖/能力一致、防 OOC */

  async function runCosmosEvolutionPhase(narrative: string) {
    const C = useCosmos.getState();
    if (!C.settings.enabled) return;
    if (turnCountRef.current % (C.settings.frequency || 3) !== 0) return;
    // 首次运行：按种子模式播种（canon 自动，random/blank 交给 CosmosManager 手动）
    if (!C.seeded && C.settings.seedMode === 'canon') { C.seedFromCanon(); }
    const seededC = useCosmos.getState();
    if (seededC.entities.length === 0) { console.warn('[Cosmos] 棋盘为空，跳过（请在万族演化里选种子模式/生成）'); return; }
    // 适配主角所属乐园（七乐园之一 或 自定义乐园）：在棋盘上确保它存在并标为「主角母园」，不写死轮回乐园
    {
      const hp = (usePlayer.getState().profile.homeParadise || '').trim();
      if (hp) {
        const found = seededC.entities.find((e) => cosmosNameEq(e.name, hp));
        if (found) { if (!found.isPlayerKnown || !/母园/.test(found.towardParadise)) useCosmos.getState().upsertEntity({ name: found.name, towardParadise: '主角所属母园', isPlayerKnown: true }); }
        else { useCosmos.getState().upsertEntity({ name: hp, category: '乐园', priority: 0, status: '稳固', power: '主角所属乐园', towardParadise: '主角所属母园', isPlayerKnown: true }); }
      }
    }

    const ss = useSettings.getState();
    const legacyApi = seededC.cosmosUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : seededC.cosmosApi;
    const chain = resolveApiChain('cosmos', legacyApi);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[Cosmos] API 未配置，跳过万族演化'); return; }
    const enabledEntries = (seededC.settings.entries ?? []).filter((e) => e.enabled);
    if (enabledEntries.length === 0) { console.warn('[Cosmos] 无启用预设条目，跳过'); return; }

    // 焦点选择：分组轮换——乐园选 paradisePerTurn 个、其他选 otherPerTurn 个；每组从"上回合更新过的"随机保留 continueCount 个做延续，
    // 其余名额轮换给"上回合没更新的"(最久没更新优先)，避免某些势力一直更新、某些一直不更新。当前任务世界相关的势力始终纳入。
    const all = seededC.entities.filter((e) => !e.destroyed);
    const norm = (s: string) => s.replace(/[\s·•・\-—_,，。、|｜()（）【】]/g, '').toLowerCase();
    const nw = norm((useMisc.getState().worldName || '').trim());
    type CE = import('./store/cosmosStore').CosmosEntity;
    const lastRun = all.reduce((m, e) => Math.max(m, e.lastEvolvedTurn || 0), 0);   // 上一次演化的回合
    const lastFocus = new Set(lastRun > 0 ? all.filter((e) => (e.lastEvolvedTurn || 0) === lastRun).map((e) => e.id) : []);
    const pickRand = (arr: CE[], n: number): CE[] => { const a = [...arr]; const out: CE[] = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]); return out; };
    const selectGroup = (group: CE[], quota: number, cont: number): CE[] => {
      const q = Math.min(Math.max(0, quota), group.length);
      if (q === 0) return [];
      const prev = group.filter((e) => lastFocus.has(e.id));                                   // 上回合更新过的(可延续)
      const fresh = group.filter((e) => !lastFocus.has(e.id)).sort((a, b) => (a.lastEvolvedTurn || 0) - (b.lastEvolvedTurn || 0));  // 上回合没更新的，最久优先
      const continued = pickRand(prev, Math.min(cont, q));                                      // 延续：随机保留
      let out = [...continued, ...fresh.slice(0, q - continued.length)];                        // 其余名额给轮换
      if (out.length < q) out = [...out, ...prev.filter((e) => !out.includes(e)).slice(0, q - out.length)];  // fresh 不够则用剩余 prev 补
      return out;
    };
    const cont = Math.max(0, seededC.settings.continueCount ?? 1);
    const focus = new Map<string, CE>();
    selectGroup(all.filter((e) => e.category === '乐园'), seededC.settings.paradisePerTurn ?? 3, cont).forEach((e) => focus.set(e.id, e));
    selectGroup(all.filter((e) => e.category !== '乐园'), seededC.settings.otherPerTurn ?? 5, cont).forEach((e) => focus.set(e.id, e));
    if (nw) all.filter((e) => { const n = norm(e.name); return n.length >= 2 && (nw.includes(n) || n.includes(nw)); }).forEach((e) => focus.set(e.id, e));  // 当前世界相关始终纳入
    const focusIds = new Set(focus.keys());
    const focusList = [...focus.values()].map((e) => e.name).join('、') || '（无）';

    // 参与门槛
    const profile = usePlayer.getState().profile;
    const turn = turnCountRef.current;
    let unlocked = false;
    const g = seededC.settings.participationGate;
    if (g === 'off') unlocked = false;
    else if (g === 'manual') unlocked = seededC.settings.participationUnlocked;
    else { const auto = (profile.level ?? 1) >= 61 || turn >= 50; unlocked = seededC.settings.participationUnlocked || auto; if (unlocked && !seededC.settings.participationUnlocked) useCosmos.getState().setSettings({ participationUnlocked: true }); }
    const participation = unlocked
      ? '【参与状态】已解锁（中后期）：主角已有资格搅动宇宙格局，可把其世界级战功/重大事件顺着因果反馈到宏观层（需正文有相应分量）。'
      : '【参与状态】未解锁（前期）：主角还没资格影响宏观大势，本轮只推演宇宙自身运转，不要因主角行为去改乐园排行/大阵营态度。';

    const systemPrompt = buildCosmosSystemPrompt(seededC.settings.entries)
      .replaceAll('${cosmos_snapshot}', serializeCosmosSnapshot(focusIds))
      .replaceAll('${story_text}', narrative)
      .replaceAll('${focus_list}', focusList)
      .replaceAll('${player_name}', profile.name || '主角')
      .replaceAll('${player_tier}', `${profile.tier || '一阶'} Lv.${profile.level ?? 1}`)
      .replaceAll('${home_paradise}', (profile.homeParadise || '').trim() || '轮回乐园')
      .replaceAll('${turn}', String(turn))
      .replaceAll('${participation}', participation);

    setCosmosPhaseLog('万族演化中…');
    try {
      const { content: reply } = await apiChatFallback(chain, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '只输出一个 JSON 对象 {"entities":[...],"digest":"..."}，不要任何多余文字。' },
      ], { timeoutMs: 90000 });
      const j = parseEntryJson(reply);
      const arr = Array.isArray(j?.entities) ? j.entities : [];
      let n = 0;
      for (const e of arr) {
        if (!e || !e.name) continue;
        useCosmos.getState().upsertEntity(e);
        useCosmos.getState().markEvolved(String(e.name), turn);
        n++;
      }
      try { useCosmos.getState().dedupeEntities(); } catch { /* 防御：本轮即合并任何漏网的同名重复 */ }
      const digest = typeof j?.digest === 'string' ? j.digest : '';
      console.log(`[Cosmos] 万族演化应用 ${n} 个实体变更`, digest);
      setCosmosPhaseLog(digest ? `✓ 万族演化：${digest.slice(0, 40)}` : `✓ 万族演化完成（${n} 项变更）`);
      // 顶部滚动条：本回合宇宙更新（digest + 变动实体），持续滚动到下次更新
      const safeStr = (v: any) => (typeof v === 'string' ? v : '');
      const detail = arr.filter((e: any) => e?.name).map((e: any) => {
        const d = safeStr(Array.isArray(e.deeds) && e.deeds[0] ? e.deeds[0].desc : '') || safeStr(e.status);
        return d ? `${safeStr(e.name) || '某势力'}（${d}）` : safeStr(e.name);
      }).filter(Boolean).slice(0, 12);
      const ticker = [digest, ...detail].filter(Boolean).join('　•　');
      if (ticker) setCosmosTicker('🌌 ' + ticker);
    } catch (e: any) {
      console.error('[Cosmos] 万族演化失败:', e.message ?? e);
      setCosmosPhaseLog(`⚠ 万族更新失败：${(e.message ?? '').slice(0, 50)}`);
    } finally { setTimeout(() => setCosmosPhaseLog(''), 8000); }
  }

  /* ════════════════════════════════════════════
     冒险团演化阶段（仅主角单一冒险团，仿领地：单目标 + 独立 API + frequency）
  ════════════════════════════════════════════ */
  function serializeTeamSnapshot(): string {
    const T = useTeam.getState();
    if (!T.established) return '（主角尚未建立冒险团。仅当本回合正文明确写出主角"建立/正式组建永久冒险团"时，才用 establishTeam 建团；否则输出空指令、不要创建。）';
    const cap = teamMemberCap(T.rank);
    const a = T.assessment;
    const asLine = a.pending
      ? `考核中：${a.note || ''}（目标阶位 ${a.targetRank || '?'}，状态 ${a.status}）——进入考核世界后 startAssessment，出结果用 resolveAssessment(pass/fail/disband）`
      : (a.status !== 'none' ? `上次考核：${a.status}` : '无');
    const joined = !!T.leaderId && T.leaderId !== 'B1';   // 加入他人团：主角非团长
    const leaderLine = joined
      ? `团长(领导人)：${T.leaderId.startsWith('C') ? T.leaderId + (T.leaderName ? '·' + T.leaderName : '') : (T.leaderName || '某 NPC')}（**主角不是团长，只是成员，勿改成主角领导**）`
      : `团长(领导人)：主角(B1)`;
    return [
      `团名：${T.name || '（未命名）'}${T.disbanded ? '（已解散）' : ''}`,
      leaderLine,
      `阶位：${T.rank}　团队经验：${T.teamExp}/100　活跃度：${T.activity}/100（晋级需活跃度≥${60}）`,
      `成员：${T.members.length}/${cap}${T.members.length ? '——' + T.members.map((m) => `${m.id || m.name}${m.role ? '(' + m.role + ')' : ''}`).join('、') : (joined ? '（无）' : '（仅团长主角）')}`,
      `团队效果：${T.perks.length ? T.perks.map((p) => p.name).join('、') : '（无）'}`,
      `考核：${asLine}`,
    ].join('\n');
  }

  async function runTeamEvolutionPhase(narrative: string) {
    const T = useTeam.getState();
    if (!T.settings.enabled) return;
    if (turnCountRef.current % (T.settings.frequency || 1) !== 0) return;
    const ss = useSettings.getState();
    const legacyApi = T.teamUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : T.teamApi;
    const chain = resolveApiChain('team', legacyApi);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[Team] API 未配置，跳过冒险团演化'); return; }
    const enabledEntries = (T.settings.entries ?? []).filter((e) => e.enabled);
    if (enabledEntries.length === 0) { console.warn('[Team] 无启用预设条目，跳过'); return; }

    const npcRecords = Object.values(useNpc.getState().npcs).filter((r) => !r.isDead);
    const onscreenNpcs = npcRecords.filter((r) => r.onScene).length > 0
      ? npcRecords.filter((r) => r.onScene).map((r) => `[${r.id}] ${r.name}（${r.realm || '阶位未知'}）`).join('\n')
      : '（无在场 NPC，addTeamMember 只能用已建档的 C-id）';
    const systemPrompt = buildTeamSystemPrompt(T.settings.entries)
      .replaceAll('${story_text}', narrative)
      .replaceAll('${team_snapshot}', serializeTeamSnapshot())
      .replaceAll('${onscreen_npcs}', onscreenNpcs)
      .replaceAll('${player_name}', usePlayer.getState().profile.name || '主角')
      + '\n\n' + NARRATIVE_FIRST_RULE + '\n' + TEAM_COT_RULE;

    setTeamPhaseLog('冒险团演化中…');
    try {
      const { content: rawReply } = await apiChatFallback(chain, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '**先输出一个 <think>…</think> 思考块**，按「冒险团演化思维链」逐项自检（尤其：团队未建立且本轮未明确建团就绝不凭空建团）；**随后**按【输出格式铁律】输出 <upstore> 指令块（必要时附 <state> 块），无变化输出空块。' },
      ]);
      console.log('[Team] 冒险团演化响应:', rawReply);
      const reply = (rawReply || '').replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim();   // 剥掉思维链再解析
      const applied = applyTeamCommands(reply);
      console.log(`[Team] 冒险团演化应用 ${applied} 条指令`);
      setTeamPhaseLog('✓ 冒险团演化完成');
    } catch (e: any) {
      console.error('[Team] 冒险团演化失败:', e.message ?? e);
      setTeamPhaseLog(`⚠ 冒险团更新失败：${(e.message ?? '').slice(0, 50)}`);
    } finally { setTimeout(() => setTeamPhaseLog(''), 8000); }
  }

  /* ════════════════════════════════════════════
     生图·肖像自动化：为在场且无立绘的角色（主角 + NPC）补肖像
     —— 受 imageGen.autoPortrait 开关门控；串行生成，避免打爆服务（尤其 NAI）
  ════════════════════════════════════════════ */
  async function runPortraitPhase() {
    const ig = useImageGen.getState();
    if (!ig.autoPortrait) { console.log('[Portrait] 自动肖像未开启，跳过'); return; }
    const service = ig.portraitService;
    console.log('[Portrait] 自动肖像阶段触发，服务=', service);

    // 目标：在场存活、无 avatar、且有外观线索的 NPC + 无立绘的主角
    type Job = { kind: 'npc' | 'player'; id: string; name: string; fields: any; descForTags: string; imageTags?: string; forceRetag?: boolean; appSig?: string };
    const jobs: Job[] = [];

    const refresh = ig.refreshOnLook;   // 外观(imageTags)变化时刷新已有立绘
    const pf = usePlayer.getState().profile;
    const pfApp = (pf.appearance || '').trim();
    const pfTagsChanged = !!pf.imageTags && pf.imageTags !== pf.avatarTags;            // 列19 生图标签变了
    const pfLookChanged = !!pfApp && pfApp !== (pf.avatarAppearance ?? '').trim();      // 外观文字变了
    const pfNeedNew = !pf.avatar && (pf.imageTags || pf.appearance || pf.profession);
    const pfNeedRefresh = refresh && !!pf.avatar && (pfTagsChanged || pfLookChanged);   // 标签或外观任一变化即刷新立绘
    if (pfNeedNew || pfNeedRefresh) {
      jobs.push({
        kind: 'player', id: 'B1', name: pf.name || '主角',
        fields: { gender: pf.gender, race: pf.race, appearance: pf.appearance, baseAppearance: pf.baseAppearance, bodyType: pf.bodyType, equipment: equippedForPrompt(useItems.getState().items), profession: pf.profession, tier: realmFromLevel(pf.level) },
        descForTags: [pf.gender, pf.race, pf.baseAppearance, pf.appearance, equippedForPrompt(useItems.getState().items), pf.profession, realmFromLevel(pf.level), pf.background].filter(Boolean).join('，'),
        imageTags: pf.imageTags,
        forceRetag: !!pf.avatar && pfLookChanged && !pfTagsChanged,   // 仅外观文字变(标签没跟着变)→ 重新翻译标签，让新图真的不同
        appSig: pfApp,
      });
    }
    for (const r of Object.values(useNpc.getState().npcs)) {
      if (r.isDead || !r.onScene) continue;
      const needNew = !r.avatar;
      const needRefresh = refresh && !!r.avatar && !!r.imageTags && r.imageTags !== r.avatarTags;
      if (!needNew && !needRefresh) continue;
      const seg = (r.appearance5 || '').split('|');
      const appearance = [seg[4], seg[3], seg[1], r.appearanceDetail].map((x) => (x || '').trim()).filter(Boolean).join('，');
      // 只跳过"只有物品没档案"的空壳（名字=ID）；真实在场 NPC 即使外观稀疏也生成（genPortraitTags 会按 名字/性别/阶位 翻译）
      if ((!appearance && !r.imageTags) && (!r.name || r.name === r.id)) continue;
      const head = (r.realm || '').split('|')[0];
      const lv = /Lv\.?\s*\d+/i.test(r.realm || '') ? lvFromRealm(r.realm) : null;
      const tier = normalizeTier(head || '') || (lv != null ? realmFromLevel(lv) : '');
      jobs.push({
        kind: 'npc', id: r.id, name: r.name,
        fields: { gender: r.gender, age: r.age, appearance, baseAppearance: r.baseAppearance, bodyType: r.bodyType, equipment: equippedForPrompt(r.items), profession: r.profession, tier, npcTag: r.npcTag,
          action: seg[0], attire: seg[1], location: seg[2], figure: seg[3], appearanceDetails: r.appearanceDetail },
        descForTags: [r.baseAppearance, r.name, r.gender, appearance, equippedForPrompt(r.items), r.profession, tier, r.npcTag].filter(Boolean).join('，'),
        imageTags: r.imageTags,
      });
    }
    const MAX_PORTRAIT_PER_TURN = 6;
    if (jobs.length > MAX_PORTRAIT_PER_TURN) jobs.length = MAX_PORTRAIT_PER_TURN;   // 本回合限量，余下下回合继续
    if (jobs.length === 0) {
      console.log('[Portrait] 自动肖像：没有需要生成的目标（主角已有立绘 / 在场NPC都已有头像或缺外观线索）');
      setImagePhaseLog('自动肖像：无需生成（都已有图或缺外观）');
      setTimeout(() => setImagePhaseLog(''), 6000);
      return;
    }
    console.log(`[Portrait] 自动肖像：待生成 ${jobs.length} 张 →`, jobs.map((j) => j.name).join('、'));

    setImagePhaseLog(`肖像生成中…（0/${jobs.length}）`);
    let done = 0, ok = 0;
    for (const job of jobs) {
      if (stopAllRef.current) break;   // 「停止生成」：不再生成后续肖像
      try {
        // 无英文标签时先用 LLM 翻译（NAI 必须英文才像），存回 imageTags 供复用
        let tags = job.imageTags;
        if (!tags || !tags.trim() || job.forceRetag) {   // 无标签 或 外观文字变了(forceRetag) → (重新)翻译标签
          const gen = await genPortraitTags(job.descForTags);
          if (gen) {
            tags = gen;
            if (job.kind === 'player') usePlayer.getState().setProfile({ imageTags: gen });
            else useNpc.getState().upsertNpc(job.id, { imageTags: gen });
          }
        }
        const prompt = buildPortraitPrompt({ ...job.fields, imageTags: tags });
        const url = await shrinkDataUrl(await generateImage(service, { prompt, negative: ig.portraitNegative, label: `自动肖像 · ${job.name}` }));
        // 记下本次所用 imageTags + 外观文本，供"标签/外观变化时刷新"对比
        if (job.kind === 'player') usePlayer.getState().setProfile({ avatar: url, avatarTags: tags || '', avatarAppearance: job.appSig ?? '' });
        else useNpc.getState().upsertNpc(job.id, { avatar: url, avatarTags: tags || '' });
        ok++;
      } catch (e: any) { console.warn(`[Portrait] ${job.name} 生成失败:`, e.message ?? e); }
      done++;
      setImagePhaseLog(`肖像生成中…（${done}/${jobs.length}）`);
    }
    setImagePhaseLog(ok > 0 ? `✓ 肖像生成完成（${ok}/${jobs.length}）` : `⚠ 肖像生成失败（0/${jobs.length}）`);
    setTimeout(() => setImagePhaseLog(''), 8000);
  }

  /* ════════════════════════════════════════════
     生图·装备自动化：为有外观无图的装备补设定图（主角背包 + NPC 持有物）
     —— 受 autoEquipPlayer / autoEquipNpc 开关门控；串行生成
  ════════════════════════════════════════════ */
  async function runEquipImagePhase() {
    const ig = useImageGen.getState();
    if (!ig.autoEquipPlayer && !ig.autoEquipNpc) return;
    const service = effectiveEquipService(ig);

    type EJob = { run: (url: string) => void; name: string; fields: any; descForTags: string };
    const jobs: EJob[] = [];

    // 只给「装备类」补设定图（武器/防具/饰品/特殊/法宝/功法）；不再要求 appearance（AI 常不填→以前几乎都被跳过）。
    // 已穿戴的优先，且每回合限量（其余下回合继续补），避免一次打爆生图接口。
    const MAX_EQUIP_PER_TURN = 6;
    if (ig.autoEquipPlayer) {
      const items = useItems.getState();
      for (const it of [...items.items].sort((a, b) => (b.equipped ? 1 : 0) - (a.equipped ? 1 : 0))) {
        if (it.image || !isEquippable(it.category)) continue;
        jobs.push({
          name: it.name,
          fields: { name: it.name, category: it.category, gradeDesc: it.gradeDesc, appearance: it.appearance, effect: it.effect },
          descForTags: [it.name, it.category, it.gradeDesc, it.appearance, it.effect].filter(Boolean).join('，'),
          run: (url) => useItems.getState().updateItem(it.id, { image: url }),
        });
      }
    }
    if (ig.autoEquipNpc) {
      const npcState = useNpc.getState();
      for (const r of Object.values(npcState.npcs)) {
        if (r.isDead) continue;
        for (const it of [...(r.items ?? [])].sort((a, b) => (b.equipped ? 1 : 0) - (a.equipped ? 1 : 0))) {
          if ((it as any).image || !isEquippable(it.category)) continue;
          const itemId = it.id;
          jobs.push({
            name: `${r.name}·${it.name}`,
            fields: { name: it.name, category: it.category, gradeDesc: (it as any).gradeDesc, appearance: it.appearance, effect: it.effect, ownerGender: r.gender },
            descForTags: [it.name, it.category, (it as any).gradeDesc, it.appearance, it.effect].filter(Boolean).join('，'),
            run: (url) => useNpc.getState().updateNpcItem?.(r.id, itemId, { image: url }),
          });
        }
      }
    }
    if (jobs.length === 0) return;
    if (jobs.length > MAX_EQUIP_PER_TURN) jobs.length = MAX_EQUIP_PER_TURN;   // 本回合限量，余下下回合继续

    setImagePhaseLog(`装备生图中…（0/${jobs.length}）`);
    let done = 0, ok = 0;
    for (const job of jobs) {
      if (stopAllRef.current) break;   // 「停止生成」：不再生成后续装备图
      try {
        // NAI/ComfyUI 标签模型：把中文描述翻成英文 tags；自然语言模型用中文模板
        let prompt = '';
        if (isTagService(service)) prompt = await genEquipTags(job.descForTags);
        if (!prompt) prompt = buildEquipPrompt(job.fields);
        const url = await shrinkDataUrl(await generateImage(service, { prompt, negative: ig.equipNegative, label: `自动装备图 · ${job.name}` }), 768);
        job.run(url); ok++;
      } catch (e: any) { console.warn(`[EquipImage] ${job.name} 生成失败:`, e.message ?? e); }
      done++;
      setImagePhaseLog(`装备生图中…（${done}/${jobs.length}）`);
    }
    setImagePhaseLog(ok > 0 ? `✓ 装备生图完成（${ok}/${jobs.length}）` : `⚠ 装备生图失败（0/${jobs.length}）`);
    setTimeout(() => setImagePhaseLog(''), 8000);
  }

  /* ════════════════════════════════════════════
     生图·正文配图：独立 LLM 抽锚点(<image>/<anchor>/<nsfw_rating>/<prompt>) → 逐张生成 → 按 anchor 插入该楼层
     —— 受 autoStory 开关门控；LLM 走 image_story_llm 路由，配图走 storyService
  ════════════════════════════════════════════ */
  // 抽取+生成正文配图（被一次性 runStoryImagePhase 与「边写边出」逐段共用）。返回成功生成张数。
  async function genStoryImagesFor(narrative: string, count: number, msgId: number): Promise<number> {
    const ig = useImageGen.getState();
    const ss = useSettings.getState();
    const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
    const chain = resolveApiChain('image_story_llm', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[StoryImg] 正文生图 LLM 未配置（综合设置→生图设置→正文生图→独立 LLM 路由），跳过'); return 0; }

    // 在场角色外观资料（含主角 B1）：性别显式映射成 1girl/1boy/futanari，避免被外观特征误判成异性
    const genderLabel = (g?: string) => {
      const tag = genderToTag(g);
      const raw = (g || '').trim();
      return tag ? (raw ? `${raw} → ${tag}` : tag) : (raw || '性别未知');
    };
    const p = usePlayer.getState().profile;
    const rosterLines: string[] = [];
    if (p?.name) {
      const pa = (p.appearance || p.baseAppearance || '').trim();
      const ptags = (p.imageTags || '').trim();
      rosterLines.push(
        `[B1] ${p.name}（主角／${genderLabel(p.gender)}）：${pa || '外观见正文'}` +
        (ptags ? `。画像锚点(imageTags)：${ptags}` : ''),
      );
    }
    const onNpcs = Object.values(useNpc.getState().npcs).filter((r) => !r.isDead && r.onScene);
    for (const r of onNpcs) {
      const seg = (r.appearance5 || '').split('|');
      const ap = [seg[4], seg[3], seg[1], r.appearanceDetail].map((x) => (x || '').trim()).filter(Boolean).join('，');
      rosterLines.push(`[${r.id}] ${r.name}（${genderLabel(r.gender)}）：${ap || '外观未知'}`);
    }
    const charsFull = rosterLines.length ? rosterLines.join('\n') : '（无在场角色资料）';
    const M = useMisc.getState();

    // 模板占位符填充（NAI 标签模型 / GPT 自然语言模型 共用）
    const fill = (tpl: string) => tpl
      .replaceAll('${image_count}', String(count))
      .replaceAll('${onscreen_characters_full}', charsFull)
      .replaceAll('${current_time}', M.worldTime || M.paradiseTime || '（未设定）')
      .replaceAll('${current_location}', M.worldName || '（未设定）')
      .replaceAll('${entry_decision_new_characters}', '（见正文）')
      .replaceAll('${story_text}', narrative);
    const userTail = `请只输出 ${count} 个 <image> 块（含 <anchor>/<nsfw_rating>/<prompt>），不要其它内容。`;
    type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

    const get = (s: string, tag: string) => (s.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] ?? '').trim();
    const parseSpecs = (reply: string) => {
      const blocks = reply.match(/<image>[\s\S]*?<\/image>/gi) ?? [];
      let arr = blocks.map((b) => ({ anchor: get(b, 'anchor'), nsfw: get(b, 'nsfw_rating') || 'sfw', prompt: get(b, 'prompt') })).filter((s) => s.prompt);
      if (arr.length === 0) {   // 兜底：没用 <image> 外层包裹但给了 <prompt> 块
        const proms = reply.match(/<prompt>[\s\S]*?<\/prompt>/gi) ?? [];
        arr = proms.map((pp) => ({ anchor: get(pp, 'anchor'), nsfw: 'sfw', prompt: get(pp, 'prompt') })).filter((s) => s.prompt);
      }
      return arr;
    };
    const extract = async (msgs: Msg[], label: string) => {
      try { const r = await apiChatFallback(chain, msgs); return { specs: parseSpecs(r.content), raw: r.content }; }
      catch (e: any) { console.error(`[StoryImg] 抽取失败(${label}):`, e.message ?? e); return { specs: [] as ReturnType<typeof parseSpecs>, raw: '' }; }
    };

    let specs: ReturnType<typeof parseSpecs> = [];
    let raw = '';
    if (!isTagService(ig.storyService)) {
      // 自然语言图像模型(gpt-image-2 / OpenAI / Gemini / 自定义)：用 GPT 自然语言模板（<prompt> 内是中文自然语言，不用 NAI 标签/破限预设——gpt-image-2 受审查，破限反而被拒）
      const gptMessages: Msg[] = [{ role: 'system', content: fill(ig.gptStoryTemplate) }, { role: 'user', content: userTail }];
      ({ specs, raw } = await extract(gptMessages, 'GPT模板'));
    } else {
      // 标签模型(NAI / ComfyUI)：内置破限预设优先 → 抽不到(被拦/拒绝/体积过大) 回退普通标签模板
      const plainMessages: Msg[] = [{ role: 'system', content: fill(ig.storyTemplate) }, { role: 'user', content: userTail }];
      let presetMessages: Msg[] | null = null;
      try {
        const mod = await import('./systems/imagePromptPreset');
        const preset = mod.getImgPromptPreset();
        if (preset.entries.length) presetMessages = mod.buildImagePromptMessages(preset.entries, {
          story: narrative, charsFull, count, time: M.worldTime || M.paradiseTime || '', location: M.worldName || '',
        });
      } catch (e) { console.warn('[StoryImg] 生图预设加载失败，仅用普通模板:', e); }
      ({ specs, raw } = presetMessages ? await extract(presetMessages, '预设') : { specs: [], raw: '' });
      if (specs.length === 0) {
        console.warn('[StoryImg] 预设抽取无结果，回退普通标签模板（端点可能拦了 NSFW 预设或体积过大）');
        ({ specs, raw } = await extract(plainMessages, '普通模板'));
      }
    }
    if (specs.length === 0) {
      console.warn('[StoryImg] 未解析到有效 <image> 块。最后回复前 200 字：', (raw || '（空回复）').slice(0, 200));
      return 0;
    }
    specs = specs.slice(0, count);   // 不超过本次请求张数

    const size = ig.storySize && ig.storySize !== 'inherit' ? ig.storySize : undefined;
    let ok = 0;
    for (const sp of specs) {
      try {
        // 按 NSFW 等级补一个 nsfw tag（忠实正文，仅做强度提示）
        const prompt = sp.nsfw && sp.nsfw !== 'sfw' ? `${sp.prompt}, nsfw` : sp.prompt;
        const url = await generateImage(ig.storyService, { prompt, size });
        const img: StoryImage = { anchor: sp.anchor, url, prompt: sp.prompt, nsfw: sp.nsfw, ts: Date.now() };
        setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, images: [...(m.images ?? []), img] } : m));
        ok++;
      } catch (e: any) { console.warn('[StoryImg] 生成失败:', e.message ?? e); }
    }
    return ok;
  }

  /* 正文配图（一次性）：整段正文写完后抽 N 张。若「边写边出」已在流式期间逐段处理过本回合 → 跳过避免重复。 */
  async function runStoryImagePhase(narrative: string, msgId: number) {
    const ig = useImageGen.getState();
    if (!ig.autoStory) return;
    if (progImgRef.current.dispatched > 0) { progImgRef.current = { offset: 0, dispatched: 0 }; return; }   // 边写边出已逐段处理本回合
    const count = Math.max(1, Math.min(9, ig.storyImageCount || 4));
    setImagePhaseLog('正文配图·抽取画面中…');
    const ok = await genStoryImagesFor(narrative, count, msgId);
    setImagePhaseLog(ok > 0 ? `✓ 正文配图完成（${ok}）` : '⚠ 正文配图：未生成（模型未按格式/拒绝NSFW/未配置）');
    setTimeout(() => setImagePhaseLog(''), 8000);
  }

  /* 「边写边出」：流式期间每写完一整段(空行分段)就给那段抽 1 张图，fire-and-forget，本回合累计上限=storyImageCount。 */
  function maybeDispatchProgressiveImages(text: string, msgId: number) {
    const ig = useImageGen.getState();
    if (!ig.autoStory || !ig.storyProgressive) return;
    const st = progImgRef.current;
    const count = Math.max(1, Math.min(9, ig.storyImageCount || 4));
    if (st.dispatched >= count) return;
    const lastBreak = text.lastIndexOf('\n\n');
    if (lastBreak <= st.offset) return;                       // 没有新写完的整段
    const fresh = text.slice(st.offset, lastBreak);
    st.offset = lastBreak;
    const paras = fresh.split(/\n\s*\n/).map((p) => p.trim())
      .filter((p) => p.length >= 60 && !/^[<【]|<state|<upstore|<状态结算|<世界|<击杀|<battle/i.test(p));   // 够长、且不是指令/结算块
    for (const para of paras) {
      if (st.dispatched >= count) break;
      st.dispatched++;
      setImagePhaseLog(`正文配图·边写边出（${st.dispatched}/${count}）`);
      void genStoryImagesFor(para, 1, msgId);                 // 不 await：立即开始出图、不挡流式
    }
  }

  /* 手动「为本回合生图」：拿该楼正文重新抽画面+出图（追加到该楼 images，不重写正文）。Muyi 反馈：救"失败/没出图"的错，不用重 roll 正文。 */
  async function manualStoryImagesForMsg(msgId: number) {
    if (storyImgBusyId != null) return;                                          // 防并发
    const msg = (messagesRef.current ?? []).find((m) => m.id === msgId);
    if (!msg || !msg.content?.trim()) return;
    const ig = useImageGen.getState();
    const count = Math.max(1, Math.min(9, ig.storyImageCount || 4));
    setStoryImgBusyId(msgId);
    setImagePhaseLog('手动正文生图·抽取中…');
    try {
      const ok = await genStoryImagesFor(msg.content, count, msgId);
      setImagePhaseLog(ok > 0 ? `✓ 已生成 ${ok} 张配图` : '⚠ 没生成（模型未按格式/拒绝NSFW/未配置生图标签 LLM）');
    } catch (e: any) { setImagePhaseLog(`⚠ 生图失败：${String(e?.message ?? e).slice(0, 40)}`); }
    finally { setStoryImgBusyId(null); setTimeout(() => setImagePhaseLog(''), 7000); }
  }

  /* 双击正文配图 → 用该张原 prompt 重新生成（不重抽锚点、不动其它图）。复用 storyService 与 storySize。 */
  async function regenerateStoryImage(msgId: number, idx: number) {
    if (!Number.isInteger(idx) || idx < 0) return;
    const key = `${msgId}:${idx}`;
    if (storyRegenBusy.current.has(key)) return;                 // 防连点重复触发
    const cur = (messagesRef.current ?? []).find((m) => m.id === msgId)?.images?.[idx];
    if (!cur) return;
    const ig = useImageGen.getState();
    const size = ig.storySize && ig.storySize !== 'inherit' ? ig.storySize : undefined;
    const prompt = cur.nsfw && cur.nsfw !== 'sfw' ? `${cur.prompt}, nsfw` : cur.prompt;   // 与首次生成同样按等级补 nsfw
    storyRegenBusy.current.add(key);
    setImagePhaseLog('正文配图·重新生成中…');
    try {
      const url = await generateImage(ig.storyService, { prompt, size, label: '重新生成配图' });
      setMessages((prev) => prev.map((m) => m.id === msgId
        ? { ...m, images: (m.images ?? []).map((x, i) => (i === idx ? { ...x, url, ts: Date.now() } : x)) }
        : m));
      setImagePhaseLog('✓ 配图已重新生成');
      setTimeout(() => setImagePhaseLog(''), 4000);
    } catch (e: any) {
      console.warn('[StoryImg] 重新生成失败:', e?.message ?? e);
      setImagePhaseLog(`⚠ 重新生成失败：${String(e?.message ?? e).slice(0, 40)}`);
      setTimeout(() => setImagePhaseLog(''), 7000);
    } finally {
      storyRegenBusy.current.delete(key);
    }
  }

  /* ════════════════════════════════════════════
     叙事记忆 LLM 两步法（发送前查询改写 / 回复后事实抽取）
  ════════════════════════════════════════════ */
  function getNmApi() {
    const ss = useSettings.getState();
    return ss.nmUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : ss.nmApi;
  }
  async function nmChatCompletion(systemPrompt: string, userContent: string, modelId?: string): Promise<string> {
    const chain = resolveApiChain('nm', getNmApi());
    const cfg = useSettings.getState().narrativeMemory;
    const { content } = await apiChatFallback(
      chain,
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      { timeoutMs: Math.max(30, cfg.requestTimeout || 90) * 1000, extra: modelId ? { model: modelId } : undefined },
    );
    return content;
  }
  /* 发送前整理：LLM 改写检索查询 → 返回关键词（让召回找"相关"而非"最新"）*/
  async function narrativeCompile(context: string, candidateTitles: string): Promise<string[]> {
    const chain = resolveApiChain('nm', getNmApi());   // 优先用接口路由；路由为空才回退到单独配置的 nmApi
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return [];
    const cfg = useSettings.getState().narrativeMemory;
    const sys = NM_COMPILE_PROMPT.replaceAll('${context}', context).replaceAll('${candidates}', candidateTitles || '（无）');
    try {
      const reply = await nmChatCompletion(sys, '请只输出 JSON 对象。', cfg.compileModelId || undefined);
      const j = parseEntryJson(reply);
      return Array.isArray(j?.keywords) ? j.keywords.map(String).filter(Boolean) : [];
    } catch (e) { console.warn('[NM] 发送前整理失败:', e); return []; }
  }
  /* 结构化召回·LLM 预测下回合相关 NPC → 返回 id 列表（失败/未开 LLM 回 []）*/
  /* 结构化条目 API 选取：一次调用，按「用户输入+最近正文」返回该注入的 NPC(id) + 主角技能/装备(名称) */
  async function narrativeSelectStruct(
    context: string, npcCandidates: string, skillCandidates: string, itemCandidates: string,
    maxNpcs: number, maxSkills: number, maxItems: number,
  ): Promise<{ npcs: string[]; skills: string[]; items: string[] }> {
    const empty = { npcs: [], skills: [], items: [] };
    const chain = resolveApiChain('nm', getNmApi());   // 优先用接口路由；路由为空才回退到单独配置的 nmApi
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return empty;
    const cfg = useSettings.getState().narrativeMemory;
    const sys = NM_STRUCT_SELECT_PROMPT
      .replaceAll('${context}', context)
      .replaceAll('${candidates}', npcCandidates || '（无）')
      .replaceAll('${skill_candidates}', skillCandidates || '（无）')
      .replaceAll('${item_candidates}', itemCandidates || '（无）')
      .replaceAll('${max_npcs}', String(maxNpcs))
      .replaceAll('${max_skills}', String(maxSkills))
      .replaceAll('${max_items}', String(maxItems));
    try {
      const reply = await nmChatCompletion(sys, '请只输出 JSON 对象。', cfg.compileModelId || undefined);
      const j = parseEntryJson(reply);
      const arr = (v: any) => Array.isArray(v) ? v.map(String).filter(Boolean) : [];
      return { npcs: arr(j?.npcs), skills: arr(j?.skills), items: arr(j?.items) };
    } catch (e) { console.warn('[NM] 结构化选取失败:', e); return empty; }
  }

  /* 结构化档案召回：主角必含 + 选中 NPC，序列化成 <在场与相关档案> system 块。
     返回 system 消息数组（空数组=不注入）。在 callApi 召回阶段 await 调用。*/
  async function buildStructuredRecall(context: string, opts: { noLlmSelect?: boolean; userInput?: string } = {}): Promise<{ player: { role: 'system'; content: string }[]; rest: { role: 'system'; content: string }[] }> {
    const cfg = useSettings.getState().narrativeMemory;
    if (cfg.structEnabled === false) return { player: [], rest: [] };   // 仅显式关闭才停；旧存档无此字段时默认开
    const limits: RecallLimits = {
      maxNpcs: Math.max(0, cfg.structMaxNpcs ?? 2),
      maxSkills: Math.max(0, cfg.structMaxSkills ?? 3),
      maxItems: Math.max(0, cfg.structMaxItems ?? 2),
      maxSubProfs: Math.max(0, cfg.structMaxSubProfs ?? 4),
    };
    const chars = useCharacters.getState().characters;
    const npcs = Object.values(useNpc.getState().npcs);
    const profile = usePlayer.getState().profile;
    const game = useGame.getState().player;
    const b1 = chars['B1'];
    const allItems = useItems.getState().items;

    // ── API 选取（开「用 API 选条目」开关 / 旧 LLM 模式）：**一次调用**判定注入哪些 NPC + 主角技能/装备（按"用户输入+最近正文"）──
    // structApiSelect 开 → 不论向量/关键词模式都调一次；关 / 失败 / 接口没配 → 下面各自走本地兜底（NPC 本地排序、技能装备本地 pickTop）。副职业不走 API，仍机械取。
    const wantApi = cfg.structApiSelect || (cfg.llmMode && !opts.noLlmSelect);
    let apiPick: { npcs: string[]; skills: string[]; items: string[] } | null = null;
    if (wantApi) {
      apiPick = await narrativeSelectStruct(
        context,
        buildNpcCandidateTitles(npcs),
        buildPlayerSkillCandidates(b1?.skills ?? []),
        buildPlayerItemCandidates(allItems),
        limits.maxNpcs, limits.maxSkills, limits.maxItems,
      );
    }

    // ── 主角卡（必含；API 选取的技能/装备覆盖本地 pickTop，副职业仍机械取）──
    const cards: string[] = [
      serializePlayerCard(profile, game, b1?.skills ?? [], b1?.traits ?? [], allItems, limits, b1?.titles, b1?.subProfessions, useItems.getState().currency,
        apiPick ? { skills: apiPick.skills, items: apiPick.items } : undefined, context, opts.userInput, true),   // leanItems=true：精简物品栏（用户输入提到/已装备→全量，其余→仅名称）
    ];

    // ── NPC 选择：用上面那次 API 选的 npc → 本地在场优先兜底 ──
    if (limits.maxNpcs > 0 && npcs.length > 0) {
      let chosen: import('./store/npcStore').NpcRecord[] = [];
      if (apiPick?.npcs.length) {
        const byId = new Map(npcs.map((r) => [r.id, r]));
        chosen = apiPick.npcs.map((id) => byId.get(id)).filter((r): r is import('./store/npcStore').NpcRecord => !!r && !r.isDead).slice(0, limits.maxNpcs);
      }
      if (chosen.length === 0) chosen = rankNpcsLocal(npcs, limits.maxNpcs);  // 兜底（API 关闭/失败/无配置）
      // 护栏：情境里字面点名的 NPC 强制并入（绕过 API 漏选 / maxNpcs 上限；已死的仍排除）——与主角技能护栏同源
      for (const r of namesMentionedIn(npcs, context)) if (!r.isDead && !chosen.includes(r)) chosen.unshift(r);
      for (const r of chosen) {
        const cd = chars[r.id];
        cards.push(serializeNpcCard(r, cd?.skills ?? [], cd?.traits ?? [], cd?.titles));  // NPC 全量，无上限（副职业仅主角）
      }
    }

    // ── 当前世界势力（按对主角态度绝对值 + 近况排序，限量）──
    const maxFac = Math.max(0, cfg.structMaxFactions ?? 4);
    if (maxFac > 0) {
      const facs = Object.values(useFaction.getState().factions)
        .filter((f) => f.inCurrentWorld && !f.isDestroyed)
        .sort((a, b) => (Math.abs(b.favorToPlayer) - Math.abs(a.favorToPlayer)) || ((b.lastSeenTurn ?? 0) - (a.lastSeenTurn ?? 0)));
      const facSection = serializeFactionsSection(facs, maxFac);
      if (facSection) cards.push(facSection);
    }

    // ── 领地（已开辟才注入概况，让正文知道主角基地现状）──
    const T = useTerritory.getState();
    if (T.unlocked) {
      const cap = buildingCap(T.level);
      const tLines = [
        `【领地】${T.name || '（未命名）'}　${realmFromLevel(T.level)}·Lv.${T.level}（建设进度 ${T.buildProgress}/100）`,
        T.buildings.length ? `建筑(${T.buildings.length}/${cap})：${T.buildings.map((b) => `${b.name} Lv.${b.level}`).join('、')}` : '',
        T.effects.length ? `领地效果：${T.effects.map((e) => e.name + (e.desc ? '(' + e.desc + ')' : '')).join('；')}` : '',
        T.members.length ? `驻留成员：${T.members.map((m) => `${m.id}${m.role ? '·' + m.role : ''}`).join('、')}` : '',
        T.appearance ? `外观：${T.appearance}` : '',
      ].filter(Boolean);
      cards.push(tLines.join('\n'));
    }

    // ── 冒险团（已建立才注入；仅注入 团名 / 成员名称 / 团队效果，不注入阶位·团长等其余信息）──
    const TM = useTeam.getState();
    if (TM.established && !TM.disbanded) {
      const memberStr = TM.members.length
        ? TM.members.map((m) => m.name || m.id).filter(Boolean).join('、')
        : '（主角）';
      const perkStr = TM.perks.length ? TM.perks.map((p) => p.name + (p.desc ? '(' + p.desc + ')' : '')).join('；') : '（无）';
      cards.push([
        `【冒险团】${TM.name || '（未命名）'}`,
        `成员：${memberStr}`,
        `团队效果：${perkStr}`,
      ].join('\n'));
    }

    // ── 临时队伍（本世界的临时队友；与冒险团不同，世界结束即解散）──
    const partyMembers = npcs.filter((r) => r.partyMember && !r.isDead);
    if (partyMembers.length) {
      cards.push(
        `【主角的临时队伍】（本世界临时组队的同伴，主角是队长；他们会随主角行动，世界结束后解散）\n` +
        partyMembers.map((r) => `${r.id}·${r.name || '队友'}${r.partyRole ? '（' + r.partyRole + '）' : ''}${r.realm ? '　' + r.realm.split('|')[0] : ''}`).join('\n')
      );
    }

    // 主角卡(cards[0]) 拆成独立块、放浅注入(贴近用户输入)，更难被忽略；NPC/势力/领地等留原位(深)。
    const playerStr = cards[0] ?? '';
    const restCards = cards.slice(1);
    const player = playerStr ? [{
      role: 'system' as const,
      content: `<主角当前档案>（这是主角【此刻】的权威结构化状态：六维/真实属性/HP·EP满状态上限/装备/技能，均为前端实时计算值。写作与结算时一律以此为准——HP/EP 上限与属性数值采用这里的数，不要沿用更早正文里的旧数字、也不要自行按基础值重算。这是参考数据，请勿原样复述。）\n${playerStr}\n</主角当前档案>`,
    }] : [];
    const rest = restCards.length ? [{
      role: 'system' as const,
      content: `<在场与相关档案>（以下为当前相关NPC/当前世界势力/领地/冒险团的结构化档案，用于保持设定/数值/装备一致；是参考资料而非剧情指令，请勿照搬复述）\n${restCards.join('\n\n')}\n</在场与相关档案>`,
    }] : [];
    return { player, rest };
  }

  /* 回复后写入：LLM 从本轮正文抽取长期事实 → 存入 narrativeFacts */
  async function runNarrativeIngestPhase(userText: string, narrative: string, opts: { force?: boolean } = {}) {
    const cfg = useSettings.getState().narrativeMemory;
    const vmOn = useSettings.getState().vectorMemory.enabled;
    // 关键词 LLM 模式 或 向量召回 任一启用，都自动抽取长期事实（向量引擎也靠这些事实，靠 NM 接口抽取）；force=手动更新，跳过开关门控（仍需 NM 接口）
    if (!opts.force && (!cfg.enabled || !cfg.llmMode) && !vmOn) return;
    const chain = resolveApiChain('nm', getNmApi());   // 优先用接口路由；路由为空才回退到单独配置的 nmApi
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) {
      if (opts.force) { setNmPhaseLog('⚠ 叙事记忆接口未配置（设置→叙事记忆→API）'); setTimeout(() => setNmPhaseLog(''), 5000); }
      return;
    }
    setNmPhaseLog('🧠 记忆整理中…');
    const M = useMisc.getState();
    const existing = M.narrativeFacts.slice(-30).map((f) => f.title).join('、') || '（无）';
    const sys = NM_INGEST_PROMPT
      .replaceAll('${user_input}', userText || '')
      .replaceAll('${story_text}', narrative)   // 记忆抽取发送全部正文
      .replaceAll('${existing_titles}', existing);
    try {
      const reply = await nmChatCompletion(sys, '请只输出 JSON 对象。', cfg.ingestModelId || undefined);
      const j = parseEntryJson(reply);
      const facts = Array.isArray(j?.facts) ? j.facts : [];
      const items = facts.filter((f: any) => f && f.text).map((f: any) => ({
        title: String(f.title ?? ''), text: String(f.text), keywords: Array.isArray(f.keywords) ? f.keywords.map(String) : [],
      }));
      if (items.length) { useMisc.getState().addNarrativeFacts(items); console.log(`[NM] 抽取 ${items.length} 条长期事实`); }
      setNmPhaseLog(items.length ? `🧠 记忆整理：新增 ${items.length} 条长期事实` : '🧠 记忆整理：本轮无新事实');
      setTimeout(() => setNmPhaseLog(''), 8000);
    } catch (e) { console.warn('[NM] 回复后写入失败:', e); setNmPhaseLog('⚠ 记忆更新失败'); }
  }

  /* 长期记忆·手动更新：按最近一次正文(+用户输入)**强制**抽取一次长期事实（绕过自动开关门控，仍需 NM 接口）。供「记忆」面板长期事实页的按钮调用。*/
  async function triggerNmIngestManually(): Promise<void> {
    const narrative = lastNarrativeRef.current
      || [...(messagesRef.current ?? [])].reverse().find((m) => m.role === 'assistant')?.content
      || '';
    if (!narrative) { setNmPhaseLog('⚠ 暂无正文——先发一条消息再手动更新'); setTimeout(() => setNmPhaseLog(''), 4000); return; }
    const userText = lastUserInputRef.current
      || [...(messagesRef.current ?? [])].reverse().find((m) => m.role === 'user')?.content
      || '';
    await runNarrativeIngestPhase(userText, narrative, { force: true });
  }

  /* ════════════════════════════════════════════
     公共频道（一期·只读）：混合刷新——打开时若过期则刷新 + 手动刷新。
     AI 生成一批虚拟契约者帖子（交易/组队/综合/情报），不接结算。
  ════════════════════════════════════════════ */
  function getChannelApi() {
    const cs = useChannel.getState();
    if (cs.channelUseSharedApi) { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; }
    return cs.channelApi;
  }
  async function refreshChannel(force = false) {
    const C = useChannel.getState();
    if (!C.settings.enabled || C.refreshing) return;
    // 懒刷新：非强制时，已有帖子且距上次刷新不足 staleTurns 回合 → 跳过
    if (!force && C.messages.length > 0 && (turnCountRef.current - C.lastRefreshTurn) < C.settings.staleTurns) return;
    const enabledDefs = CHANNEL_DEFS.filter((d) => C.settings.channels[d.key]);
    if (enabledDefs.length === 0) return;
    const chain = resolveApiChain('channel', getChannelApi());
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[Channel] API 未配置（频道刷新跳过）'); return; }

    const prof = usePlayer.getState().profile;
    const M = useMisc.getState();
    const recent = [
      ...M.worldEvents.slice(-5).map((e) => `${e.time} ${e.location} ${e.desc}`),
      ...M.smallSummaries.slice(-3),
    ].filter(Boolean).join('；') || '（暂无）';
    const existing = C.messages.slice(0, 18).map((m) => `[${m.channel}] ${m.authorName}: ${m.content}`).join('\n') || '（暂无）';
    const enabledChannels = enabledDefs.map((d) => `${d.label}(${d.key})`).join('、');
    const enabledKeys = new Set(enabledDefs.map((d) => d.key));
    const homePara = prof.homeParadise || '轮回乐园';   // 主角所属乐园（开局选定）；公共频道隶属此乐园，而非默认轮回乐园
    const sys = buildChannelSystemPrompt(C.settings.entries)
      .replaceAll('${player_name}', prof.name || '主角')
      .replaceAll('${player_tier}', `${prof.tier || realmFromLevel(prof.level)}·Lv.${prof.level}`)
      .replaceAll('${home_paradise}', homePara)
      .replaceAll('${world_name}', M.worldName || homePara)
      .replaceAll('${world_time}', M.worldTime || M.paradiseTime || '（未设定）')
      .replaceAll('${enabled_channels}', enabledChannels)
      .replaceAll('${recent_events}', recent)
      .replaceAll('${existing_messages}', existing)
      .replaceAll('${message_count}', String(C.settings.genCount))
      + '\n\n【交易出售帖·固定格式铁则】交易频道里 kind="sell" 的出售帖，其 offer 必须按**物品固定格式给全所有属性**，供玩家查看与购买带入：offer={"itemName","category","subType","gradeDesc"(品质色),"origin"(产地),"combatStat"(攻防数值),"durability"(耐久),"requirement"(装备需求),"affix"(词缀),"score"(评分),"effect"(效果),"intro"(简介),"appearance"(逐部件外观),"killCount"(武器杀敌数),"qty","price","currency"}。装备类必给攻防/耐久/装备需求/词缀；消耗品必给效果；**技能书/技能卷轴/知识卷轴/图纸配方/天赋碎片类**必给 subType(类型，如「技能卷轴」「技能书」「知识卷轴」「图纸」「天赋碎片」) + effect(**明确写清学会/获得什么**——技能名及层阶(入门/精通/大师/宗师/极道)、或知识领域、或可制造产品、或天赋名及评级 D~SSS)；**外观一律必填、不准省略或偷懒**（与物品生成同标准）。'
      + '\n\n' + CHANNEL_AUTHOR_INFO_RULE
      + '\n\n' + EQUIP_CODEX;   // 交易频道 sell 帖会生成装备 → 全量注入装备世界书，品级/数值/词缀按体系来

    useChannel.getState().setRefreshing(true);
    try {
      const { content: reply } = await apiChatFallback(chain, [
        { role: 'system', content: sys },
        { role: 'user', content: '请按格式只输出 JSON 对象 {"messages":[...]}。' },
      ]);
      const j = parseEntryJson(reply);
      const arr = Array.isArray(j?.messages) ? j.messages : [];
      const items = arr
        .filter((x: any) => x && x.content && enabledKeys.has(x.channel))
        .map((x: any) => ({
          channel: x.channel,
          authorName: String(x.author ?? x.authorName ?? '某契约者').split('|')[0].trim(),
          authorTier: x.tier ?? x.authorTier,
          authorTag: x.tag ?? x.authorTag,
          authorJob: x.job ?? x.authorJob,
          authorPersona: x.persona ?? x.authorPersona,
          authorStrength: x.strength ?? x.authorStrength,
          kind: x.kind ?? 'chat',
          content: String(x.content),
          offer: x.offer && typeof x.offer === 'object' ? x.offer : undefined,
          recruit: x.recruit && typeof x.recruit === 'object' ? x.recruit : undefined,
          gameTime: M.worldTime || M.paradiseTime || '',
        }));
      if (items.length) useChannel.getState().addMessages(items);
      useChannel.getState().markRefreshed(turnCountRef.current);
      console.log(`[Channel] 刷新生成 ${items.length} 条帖子`);
    } catch (e: any) {
      console.warn('[Channel] 刷新失败:', e?.message ?? e);
    } finally {
      useChannel.getState().setRefreshing(false);
    }
    await solicitQuotes();   // 刷新后顺带为玩家未成交的求购/出售帖补报价
  }

  /* 主角在某频道发言 → 频道 API 生成 1~N 条契约者回复（语气随频道变化、数量不等），与发言一并存入 speak 流（限10条）。系统频道禁止。 */
  async function replyToChannelPost(channel: string, content: string, replyTo?: { authorName: string; content: string }) {
    const C = useChannel.getState();
    if (!C.settings.enabled || channel === 'system' || !content.trim()) return;
    const prof = usePlayer.getState().profile;
    const playerName = prof.name || '主角';
    const homePara = prof.homeParadise || '轮回乐园';   // 频道隶属主角所属乐园，而非默认轮回乐园
    // 先把主角发言立即上墙（回复随后逐条插到它上方，增加真实感）
    const postId = useChannel.getState().addPlayerSpeak(channel as any, playerName, content.trim(), replyTo?.authorName);
    const M = useMisc.getState();
    const chDef = CHANNEL_DEFS.find((d) => d.key === channel);

    // 频道近期对话（最多 20 条，排除刚发的这条）→ 给 AI 上下文，让回复有延续感、能接住之前回复过主角的人
    const history = useChannel.getState().messages
      .filter((m) => m.channel === channel && m.id !== postId)
      .slice(0, 20)
      .reverse();
    const histText = history.length
      ? history.map((m) => {
          const who = m.byPlayer ? `主角(${playerName})` : `${m.authorName}${m.authorTier ? '·' + m.authorTier : ''}`;
          const rt = m.replyToName ? `（回复@${m.replyToName}）` : '';
          return `${who}${rt}：${String(m.content).slice(0, 120)}`;
        }).join('\n')
      : '（暂无更早的对话）';

    let replies: { authorName: string; authorTier?: string; authorJob?: string; authorPersona?: string; authorStrength?: string; content: string }[] = [];
    const chain = resolveApiChain('channel', getChannelApi());
    if (chain[0]?.baseUrl && chain[0]?.apiKey) {
      const otherN = 2 + Math.floor(Math.random() * 3);   // 回复某人时，其他人插嘴 2~4 条
      const replyN = 2 + Math.floor(Math.random() * 5);   // 普通发言 2~6 条
      const common = `你是「${homePara}·公共频道」的回复生成器，模拟【${chDef?.label ?? channel}】频道里其他契约者/土著的真实回复。
- 语气务必**多样**、贴合频道氛围：嘲讽 / 认同 / 赞赏 / 吐槽 / 崇拜 / 抬杠 / 阴阳怪气 / 玩梗整活 / 看热闹 / 话不着边 / 提问 / 泼冷水 等（不止这些，自行发挥），别千篇一律、也别都正面。
- 不同频道风格不同：综合更整活玩梗，战斗更热血/支招，情报更分析推理，世界更见闻闲谈，交易更砍价吐槽，组队更搭话约人。
- 发帖人用游戏化网名（如 夜影剑心 / 量子咸鱼 / 虚空观测者）；贴合当前世界(${M.worldName || homePara})与主角阶位强度，别离谱。
- **务必延续上文**：顺着之前的话题接话、可回应之前回复过主角的人，保持对话连贯，别每条都另起炉灶。
- **只输出 JSON**：{"replies":[{"author":"网名","tier":"阶位·Lv","job":"职业(多样/隐藏职业)","persona":"性格","strength":"T档(如T3·勇士)","content":"回复正文"}]}，不要任何多余文字或 markdown。

【该频道近期对话（旧→新，供你延续）】
${histText}
${CHANNEL_AUTHOR_INFO_RULE}`;

      const sys = replyTo
        ? `${common}

【本次场景：主角“回复了某人”】
被回复者：${replyTo.authorName}
${replyTo.authorName} 之前说：「${String(replyTo.content).slice(0, 200)}」
主角(${playerName}·${prof.tier || '一阶'}Lv.${prof.level}) 回复 ${replyTo.authorName}：「${content.trim()}」

要求：
1. **第一条回复必须是「${replyTo.authorName}」本人**，直接回应主角（被当面回复自然要接话，可顺可怼，贴合其身份语气）。
2. 随后 ${otherN} 条是**其他不同契约者**围观插嘴（起哄/认同/抬杠/看热闹等）。
3. 第一条的 author 字段必须正好是「${replyTo.authorName}」。`
        : `${common}

【本次场景：主角发了一条新言】
主角(${playerName}·${prof.tier || '一阶'}Lv.${prof.level}) 说：「${content.trim()}」

要求：生成 ${replyN} 条回复，每条不同发帖人，结合上文自然回应。`;

      try {
        const { content: reply } = await apiChatFallback(chain, [
          { role: 'system', content: sys },
          { role: 'user', content: '只输出 JSON 对象 {"replies":[...]}。' },
        ], { timeoutMs: 60000 });
        const j = parseEntryJson(reply);
        const arr = Array.isArray(j?.replies) ? j.replies : (Array.isArray(j?.messages) ? j.messages : []);
        replies = arr
          .filter((x: any) => x && x.content)
          .map((x: any) => ({ authorName: String(x.author ?? x.authorName ?? '某契约者').split('|')[0].trim(), authorTier: x.tier ?? x.authorTier, authorJob: x.job ?? x.authorJob, authorPersona: x.persona ?? x.authorPersona, authorStrength: x.strength ?? x.authorStrength, content: String(x.content) }));
        // 回复某人时兜底：保证第一条确实是被回复者本人（模型偶尔不遵守）
        if (replyTo && replies.length) replies[0].authorName = replyTo.authorName;
      } catch (e: any) { console.warn('[Channel] 生成回复失败:', e?.message ?? e); }
    }
    // 回复逐条错峰插到主角发言上方（模拟陆续有人回帖，增加真实感）
    for (const r of replies) {
      await new Promise((res) => setTimeout(res, 450 + Math.random() * 700));
      useChannel.getState().addOneSpeakReply(channel as any, r, postId);
    }
  }

  /* 组队帖一键加入：把发帖契约者建成临时队友 NPC（确定性——他在招募，故直接入队）*/
  function joinPartyFromPost(m: import('./store/channelStore').ChannelMessage): string {
    const M = useMisc.getState();
    const id = useNpc.getState().createPartyMember({
      name: m.authorName, tier: m.authorTier, job: m.authorJob, persona: m.authorPersona, strength: m.authorStrength,
      role: m.recruit?.role || m.authorJob || '队友', world: M.worldName || '',
    });
    useChannel.getState().markTraded(m.id);   // 组队帖标记"已组队"（灰显）
    try { useNpc.getState().appendDeed(id, { time: M.worldTime || M.paradiseTime || '', location: M.worldName || '', description: '加入主角的临时队伍（来自组队帖）' } as any); } catch { /* */ }
    refreshNpcPreferredOwners();
    return id;
  }

  /* 邀请同世界契约者入队：AI 据【主角面板 + 该契约者自身性格/处境/目的】判定答应或拒绝；拒绝可再邀 */
  async function inviteToParty(m: import('./store/channelStore').ChannelMessage, inviteText: string): Promise<{ accept: boolean; reason: string }> {
    const chain = resolveApiChain('channel', getChannelApi());
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return { accept: false, reason: '（频道 API 未配置）' };
    const prof = usePlayer.getState().profile;
    const M = useMisc.getState();
    const playerCard = [
      `姓名:${prof.name || '主角'}`, `阶位:${prof.tier || '一阶'} Lv.${prof.level ?? 1}`,
      prof.homeParadise && `所属乐园:${prof.homeParadise}`, prof.profession && `职业:${prof.profession}`,
      prof.identity && `身份:${prof.identity}`, prof.arenaRank && `竞技场:${prof.arenaRank}`,
      prof.title && `称号:${prof.title}`, prof.bioStrength && `生物强度:${prof.bioStrength}`,
    ].filter(Boolean).join('，');
    const sys = `你扮演公共频道里的契约者「${m.authorName}」（${m.authorTier || ''}，职业「${m.authorJob || '未知'}」，性格「${m.authorPersona || '未知'}」，生物强度「${m.authorStrength || '未知'}」）。
主角想邀请你加入他的【临时队伍】（当前世界：${M.worldName || '轮回乐园'}）。主角的邀请词：「${inviteText || '（没多说，只是向你发出了邀请）'}」。
请**结合主角的实力/身份/态度 与 你本人的性格、处境和目的**，自行决定是否答应——可爽快答应、可条件答应、也可拒绝（嫌弃实力、另有图谋、性格使然等都行，别一律答应）。
**只输出一个 JSON 对象**：{"accept":true或false,"reason":"你答应或拒绝的理由，用你本人的口吻，1~2句","role":"若答应，你在队里的职责(坦克/治疗/输出/侦察/法术等)"}。不要任何多余文字。
【主角面板】${playerCard}`;
    try {
      const { content } = await apiChatFallback(chain, [{ role: 'system', content: sys }, { role: 'user', content: '只输出 JSON 对象。' }], { timeoutMs: 60000 });
      const j: any = parseEntryJson(content) || {};
      const accept = j.accept === true || j.accept === 'true' || j.accept === 1;
      const reason = String(j.reason || (accept ? '（答应了）' : '（婉拒了）')).slice(0, 240);
      if (accept) {
        const id = useNpc.getState().createPartyMember({
          name: m.authorName, tier: m.authorTier, job: m.authorJob, persona: m.authorPersona, strength: m.authorStrength,
          role: String(j.role || m.authorJob || '队友'), world: M.worldName || '',
        });
        try { useNpc.getState().appendDeed(id, { time: M.worldTime || M.paradiseTime || '', location: M.worldName || '', description: `应主角之邀加入临时队伍：${reason}` } as any); } catch { /* */ }
        refreshNpcPreferredOwners();
      }
      return { accept, reason };
    } catch (e: any) { return { accept: false, reason: `（判定失败：${(e?.message ?? '').slice(0, 40)}）` }; }
  }

  /* 临时队伍生命周期：世界切换/回归时，解散非当前世界的临时队友（离队+离场归档）；有冒险团则弹"转正" */
  function reconcilePartyLifecycle() {
    const world = useMisc.getState().worldName || '';
    const disbanded = useNpc.getState().disbandPartyForWorld(world);
    if (disbanded.length) {
      const team = useTeam.getState();
      if (team.established && !team.disbanded) setPromoteCandidates(disbanded);   // 有冒险团才弹转正询问
    }
  }

  /* ════════════ 私信（一对一私聊 + 私下交易）════════════ */
  const dmChain = () => resolveApiChain('channel', getChannelApi());   // 私信复用频道 API 路由
  const dmDealId = () => `D${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  function openDmFor(info: { targetId?: string; targetName: string; targetTier?: string; targetJob?: string; targetPersona?: string; targetStrength?: string; targetTag?: string; sourceContent?: string }) {
    const id = useDm.getState().openThread(info);
    setDmFocusThread(id);
    setDmPanelOpen(true);
  }

  /* 主角面板摘要（供 NPC 判断交易/态度）*/
  function dmPlayerCard(): string {
    const p = usePlayer.getState().profile;
    const cur = useItems.getState().currency;
    return [
      `${p.name || '主角'}`, `阶位${p.tier || '一阶'} Lv.${p.level ?? 1}`,
      p.homeParadise && `所属${p.homeParadise}`, p.identity && `身份${p.identity}`,
      p.title && `称号${p.title}`,
      `财富 乐园币${cur.乐园币}·魂币${cur.灵魂钱币}`,
    ].filter(Boolean).join('，');
  }

  /* 对方人设 prompt：已建档 NPC 用其档案；频道未建档 NPC 用其发言/已知信息 */
  function dmPersonaPrompt(th: import('./store/dmStore').DmThread): string {
    const rec = th.targetId ? useNpc.getState().npcs[th.targetId] : undefined;
    if (rec) {
      const cdata = useCharacters.getState().characters[rec.id];
      const skills = cdata?.skills ?? [];
      const talents = cdata?.traits ?? [];
      const bag = (rec.items ?? []).filter((it) => !it.equipped);
      const lines = [
        `姓名：${rec.name || '（未命名）'}${rec.gender ? `（${rec.gender}）` : ''}`,
        rec.realm && `阶位/身份：${rec.realm}`,
        rec.npcTag && `身份标签：${rec.npcTag}`,
        rec.profession && `职业：${rec.profession}`,
        rec.bioStrength && `生物强度：${rec.bioStrength}`,
        rec.personality && `性格：${rec.personality}`,
        rec.background && `背景：${rec.background}`,
        (rec.appearance5 || rec.appearanceDetail) && `外观：${rec.appearance5 || rec.appearanceDetail}`,
        rec.motiveNow && `当前动机/目的：${rec.motiveNow}`,
        rec.innerThought && `内心想法：${rec.innerThought}`,
        rec.relations && `人际关系：${rec.relations}`,
        `对主角的好感：${rec.favor}（>30 亲近、<-30 敌视）`,
        rec.status && `当前状态：${rec.status}`,
        rec.callPlayer && `你对主角的称呼：${rec.callPlayer}`,
        skills.length > 0 && `你掌握的技能：${skills.map((s) => s.name).join('、')}`,
        talents.length > 0 && `你的天赋：${talents.map((t) => t.name).join('、')}`,
        `你储存空间里的物品：${bag.length ? bag.map((it) => `${it.name}${(it.quantity ?? 1) > 1 ? `×${it.quantity}` : ''}${it.gradeDesc ? `(${it.gradeDesc})` : ''}`).join('、') : '（不详/没什么值钱东西）'}`,
      ].filter(Boolean);
      return `你正在以【${rec.name}】本人的身份，私下回复主角发来的私信。你就是这个角色，请严格依照你的记忆、性格、目的与你和主角的关系来回应，不要跳脱人设、不要扮演旁白。\n${lines.join('\n')}`;
    }
    const lines = [
      `名号：${th.targetName}`,
      th.targetTier && `阶位：${th.targetTier}`,
      th.targetJob && `职业：${th.targetJob}`,
      th.targetStrength && `生物强度：${th.targetStrength}`,
      th.targetPersona && `性格：${th.targetPersona}`,
      th.targetTag && `身份标签：${th.targetTag}`,
      th.sourceContent && `你之前在公共频道发过言：「${th.sourceContent}」`,
    ].filter(Boolean);
    return `你是公共频道里的契约者【${th.targetName}】，主角私信了你。你和主角还没深入接触，请基于你已经展现出的信息（发言、职业、性格）即兴、自洽地回应，保持一致的人设，不要扮演旁白。\n${lines.join('\n')}`;
  }

  /* 取对话历史（喂给 AI，过滤系统消息）*/
  function dmHistory(th: import('./store/dmStore').DmThread, limit = 12): { role: 'user' | 'assistant'; content: string }[] {
    return th.messages.filter((m) => m.from !== 'system').slice(-limit).map((m) => ({
      role: m.from === 'player' ? 'user' as const : 'assistant' as const,
      content: m.text,
    }));
  }

  /* 聊天：NPC 据人设回一句 */
  async function dmReply(threadId: string, playerText: string) {
    const dm = useDm.getState();
    const th = dm.threads[threadId]; if (!th) return;
    dm.addMsg(threadId, { from: 'player', text: playerText });
    const chain = dmChain();
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { dm.addMsg(threadId, { from: 'system', text: '（私信 API 未配置：在「设置→变量管理→📡 公共频道」或接口路由 channel 配置）' }); return; }
    const sys = dmPersonaPrompt(th) + `\n\n【主角面板】${dmPlayerCard()}\n\n请以你本人的口吻回复主角这条私信，1~3 句，贴合你的性格与你和主角的关系。只输出对话内容本身，不要旁白、不要括号动作、不要 JSON。`;
    try {
      const { content } = await apiChatFallback(chain, [{ role: 'system', content: sys }, ...dmHistory(useDm.getState().threads[threadId]!)], { timeoutMs: 60000 });
      dm.addMsg(threadId, { from: 'npc', text: (content || '……').trim().slice(0, 600) });
    } catch (e: any) { dm.addMsg(threadId, { from: 'system', text: `（对方没有回应：${(e?.message ?? '').slice(0, 40)}）` }); }
  }

  /* 玩家发起一笔交易动作 → 人类可读的玩家消息行 */
  function dmActionPlayerLine(kind: import('./store/dmStore').DmDealKind, payload: any, giveName?: string): string {
    const q = (payload.qty && payload.qty > 1) ? ` ×${payload.qty}` : '';
    if (kind === 'buy') return `（我想向你购买：${payload.itemName}${q}）`;
    if (kind === 'sell') return `（我想把我的「${giveName}」${q}${payload.askPrice ? `卖给你，期望 ${payload.askPrice}` : '送给你'}）`;
    if (kind === 'request') return `（我想向你讨要：${payload.itemName}${q}${payload.plea ? `。${payload.plea}` : ''}）`;
    return `（我想用我的「${giveName}」${q}换你的「${payload.wantName}」）`;
  }

  /* 从 AI JSON 取物品（带固定格式字段，供入库）*/
  function dmJItem(o: any, fallbackName: string, qty: number): import('./store/dmStore').DmDealItem {
    const x = o || {};
    return {
      name: String(x.name || fallbackName || '物品').slice(0, 40),
      gradeDesc: x.gradeDesc || x.grade || x.quality || undefined,
      category: x.category || undefined, qty: Math.max(1, qty || 1),
      effect: x.effect || undefined, appearance: x.appearance || undefined,
      subType: x.subType || undefined, origin: x.origin || undefined,
      combatStat: x.combatStat || x.attack || x.defense || undefined, durability: x.durability || undefined,
      requirement: x.requirement || undefined, affix: x.affix || undefined,
      score: x.score != null && x.score !== '' ? String(x.score) : undefined, intro: x.intro || undefined,
    };
  }
  const dmPrice = (j: any): number => { const n = parseInt(String(j?.price ?? '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? Math.max(0, n) : 0; };

  /* 发起交易：buy/sell/request/barter → AI 报价 → 生成交易卡（或仅回话=拒绝）*/
  async function dmPropose(threadId: string, kind: import('./store/dmStore').DmDealKind, payload: any) {
    const dm = useDm.getState();
    const th = dm.threads[threadId]; if (!th) return;
    let giveItem: import('./store/dmStore').DmDealItem | undefined;
    if (kind === 'sell' || kind === 'barter') {
      const it = useItems.getState().items.find((x) => x.id === payload.itemId);
      if (it) giveItem = { name: it.name, gradeDesc: it.gradeDesc, category: it.category, qty: Math.max(1, payload.qty || 1), effect: it.effect, appearance: it.appearance, affix: it.affix, score: it.score, subType: it.subType, combatStat: it.combatStat };
    }
    dm.addMsg(threadId, { from: 'player', text: dmActionPlayerLine(kind, payload, giveItem?.name) });
    const chain = dmChain();
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { dm.addMsg(threadId, { from: 'system', text: '（私信 API 未配置）' }); return; }

    let instr = '';
    if (kind === 'buy') {
      instr = `\n\n主角想【向你购买】物品：「${payload.itemName}」${payload.qty > 1 ? ` ×${payload.qty}` : ''}。请基于你的身份/库存/能力，三选一：
- "have"：你正好有 → 给售价。
- "source"：你没有，但能从别处弄来再转卖给主角（赚差价，价偏高）。
- "no"：没有也弄不到 → 婉拒。
**只输出 JSON**：{"available":"have|source|no","reply":"你的话(本人口吻,1~2句)","price":数字,"currency":"乐园币|灵魂钱币","item":{"name":"","gradeDesc":"白色/绿色/蓝色/紫色/暗紫色/淡金/金色/暗金/传说级/史诗级/圣灵级/不朽级/起源级/永恒级/创世(按物品强度选合适档)","category":"武器/防具/消耗品/材料/特殊物品...","effect":"含具体数值的效果","appearance":"外观"}}。no 时可省略 price/item。价格贴合轮回乐园颜色品质定价。`;
    } else if (kind === 'sell') {
      instr = `\n\n主角想把自己的【${giveItem?.name || payload.itemName || '物品'}】${payload.qty > 1 ? ` ×${payload.qty}` : ''}（品质：${giveItem?.gradeDesc || '未知'}，效果：${giveItem?.effect || '未知'}）${payload.askPrice ? `卖给你，期望 ${payload.askPrice} 乐园币` : `无偿赠予你`}。请判断你是否收下、愿付多少（可爽快收下并付钱、可还价压价、可白拿道谢、也可嫌弃拒绝）。
**只输出 JSON**：{"accept":true或false,"reply":"你的话","price":你愿支付的数字(0=收下但不付钱/收礼道谢),"currency":"乐园币|灵魂钱币"}。`;
    } else if (kind === 'request') {
      instr = `\n\n主角向你【索取】物品：「${payload.itemName}」${payload.qty > 1 ? ` ×${payload.qty}` : ''}${payload.plea ? `，并说：「${payload.plea}」` : ''}（多半想白拿）。结合你和主角的关系/好感/性格、以及你是否有，三选一：
- "give"：赠予（白给）。
- "price"：不白给，但可卖给他 → 给价。
- "no"：拒绝（没有，或不愿给）。
**只输出 JSON**：{"decision":"give|price|no","reply":"你的话","price":数字(decision=price时),"currency":"乐园币|灵魂钱币","item":{"name":"","gradeDesc":"","category":"","effect":"","appearance":""}}。give/price 需给 item，no 可省略。`;
    } else {
      instr = `\n\n主角想用自己的【${giveItem?.name || '物品'}】（${giveItem?.gradeDesc || '?'}，效果 ${giveItem?.effect || '?'}）交换你的【${payload.wantName}】。判断这桩交换是否划算、你是否接受、是否需要一方补差价。
**只输出 JSON**：{"accept":true或false,"reply":"你的话","extraFromPlayer":数字(主角额外补给你的钱;负数=你补给主角;0=平换),"currency":"乐园币|灵魂钱币","item":{"name":"${payload.wantName}","gradeDesc":"","category":"","effect":"","appearance":""}}。`;
    }
    const sys = dmPersonaPrompt(th) + `\n\n【主角面板】${dmPlayerCard()}` + instr;
    try {
      const { content } = await apiChatFallback(chain, [{ role: 'system', content: sys }, ...dmHistory(useDm.getState().threads[threadId]!, 8)], { timeoutMs: 60000 });
      const j: any = parseEntryJson(content) || {};
      const reply = String(j.reply || j.note || '……').slice(0, 400);
      const cur = dmNormCur(j.currency);
      const ts = Date.now();
      let deal: import('./store/dmStore').DmDeal | null = null;
      if (kind === 'buy') {
        const av = String(j.available || '').toLowerCase();
        const p = dmPrice(j);
        if (av !== 'no' && (j.item || p > 0)) deal = { id: dmDealId(), kind: 'buy', giveCurrency: { amount: p, type: cur }, getItem: dmJItem(j.item, payload.itemName, payload.qty), note: reply, source: av === 'source' ? 'source' : 'have', status: 'pending', ts };
      } else if (kind === 'sell') {
        if (j.accept === true || j.accept === 'true') { const p = dmPrice(j); deal = { id: dmDealId(), kind: 'sell', giveItem: { ...(giveItem as any), qty: Math.max(1, payload.qty || 1) }, getCurrency: p > 0 ? { amount: p, type: cur } : undefined, note: reply, source: 'free', status: 'pending', ts }; }
      } else if (kind === 'request') {
        const d = String(j.decision || '').toLowerCase();
        if (d === 'give') deal = { id: dmDealId(), kind: 'request', getItem: dmJItem(j.item, payload.itemName, payload.qty), note: reply, source: 'free', status: 'pending', ts };
        else if (d === 'price') { const p = dmPrice(j); if (p > 0) deal = { id: dmDealId(), kind: 'buy', giveCurrency: { amount: p, type: cur }, getItem: dmJItem(j.item, payload.itemName, payload.qty), note: reply, source: 'have', status: 'pending', ts }; }
      } else {
        if (j.accept === true || j.accept === 'true') { const extra = parseInt(String(j.extraFromPlayer ?? 0), 10) || 0; deal = { id: dmDealId(), kind: 'barter', giveItem: { ...(giveItem as any), qty: Math.max(1, payload.qty || 1) }, getItem: dmJItem(j.item, payload.wantName, 1), giveCurrency: extra > 0 ? { amount: extra, type: cur } : undefined, getCurrency: extra < 0 ? { amount: -extra, type: cur } : undefined, note: reply, status: 'pending', ts }; }
      }
      dm.addMsg(threadId, { from: 'npc', text: reply, deal: deal ?? undefined });
    } catch (e: any) { dm.addMsg(threadId, { from: 'system', text: `（对方没有回应：${(e?.message ?? '').slice(0, 40)}）` }); }
  }

  /* 讨价还价：AI 重新报价 → 旧卡作废、生成新交易卡（或不卖了）*/
  async function dmHaggle(threadId: string, dealId: string, text: string) {
    const dm = useDm.getState();
    const th = dm.threads[threadId]; if (!th) return;
    const deal = th.messages.find((m) => m.deal?.id === dealId)?.deal;
    if (!deal) return;
    dm.addMsg(threadId, { from: 'player', text: `（讨价还价）${text}` });
    const chain = dmChain();
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { dm.addMsg(threadId, { from: 'system', text: '（私信 API 未配置）' }); return; }
    const curField: 'give' | 'get' = deal.giveCurrency ? 'give' : deal.getCurrency ? 'get' : (deal.kind === 'sell' ? 'get' : 'give');
    const curAmt = deal.giveCurrency?.amount ?? deal.getCurrency?.amount ?? 0;
    const curType = deal.giveCurrency?.type ?? deal.getCurrency?.type ?? '乐园币';
    const give = deal.giveItem ? `${deal.giveItem.name}${(deal.giveItem.qty ?? 1) > 1 ? `×${deal.giveItem.qty}` : ''}` : '';
    const get = deal.getItem ? `${deal.getItem.name}` : '';
    const sys = dmPersonaPrompt(th) + `\n\n当前这桩交易：${give ? `主角交出 ${give}；` : ''}${get ? `主角获得 ${get}；` : ''}涉及金额 ${curAmt} ${dmNormCur(curType)}。主角讨价还价说：「${text}」。你可以让步降价/抬价、坚持原价、或干脆不做这桩买卖。
**只输出 JSON**：{"reply":"你的话(口吻)","price":新的金额数字,"accept":true或false(是否仍愿意按此成交)}。`;
    try {
      const { content } = await apiChatFallback(chain, [{ role: 'system', content: sys }], { timeoutMs: 60000 });
      const j: any = parseEntryJson(content) || {};
      const reply = String(j.reply || '……').slice(0, 400);
      dm.updateDeal(threadId, dealId, { status: 'cancelled' });   // 旧卡作废
      if (j.accept === false || j.accept === 'false') { dm.addMsg(threadId, { from: 'npc', text: reply }); return; }
      const np = parseInt(String(j.price ?? curAmt).replace(/[^\d]/g, ''), 10);
      const newPrice = Number.isFinite(np) ? Math.max(0, np) : curAmt;
      const nd: import('./store/dmStore').DmDeal = { ...deal, id: dmDealId(), note: reply, status: 'pending', ts: Date.now() };
      if (curField === 'give') nd.giveCurrency = { amount: newPrice, type: curType };
      else nd.getCurrency = newPrice > 0 ? { amount: newPrice, type: curType } : undefined;
      dm.addMsg(threadId, { from: 'npc', text: reply, deal: nd });
    } catch (e: any) { dm.addMsg(threadId, { from: 'system', text: `（没有回应：${(e?.message ?? '').slice(0, 40)}）` }); }
  }

  /* 成交：确定性结算（扣货币/物品、对方收到的物品入其储存空间）*/
  function dmAccept(threadId: string, dealId: string): { ok: boolean; error?: string } {
    const dm = useDm.getState();
    const th = dm.threads[threadId]; if (!th) return { ok: false, error: '会话不存在' };
    const deal = th.messages.find((m) => m.deal?.id === dealId)?.deal;
    if (!deal || deal.status !== 'pending') return { ok: false, error: '该交易不可成交' };
    const r = settleDmDeal(th, deal);
    if (!r.ok) { dm.addMsg(threadId, { from: 'system', text: `成交失败：${r.error}` }); return r; }
    dm.updateDeal(threadId, dealId, { status: 'done' });
    if (r.npcId && !th.targetId) dm.patchThread(threadId, { targetId: r.npcId, archived: true });   // 结算时建了档→关联
    dm.addMsg(threadId, { from: 'system', text: r.summary || '已成交。' });
    refreshNpcPreferredOwners();
    return { ok: true };
  }

  /* 去掉 AI 误写进身份/阶位的"已阵亡/死亡"等字样（离场≠死亡）*/
  function stripDeadWords(s: any): string {
    return flattenAiText(s)
      .replace(/[（(][^）)]*(?:阵亡|死亡|已故|身亡|去世|战死|殒命)[^）)]*[）)]/g, '')
      .replace(/(?:已)?(?:阵亡|死亡|已故|身亡|去世|战死|殒命)/g, '')
      .replace(/[|｜]\s*$/, '').replace(/\s{2,}/g, ' ').trim();
  }

  /* 据已知信息为某契约者档案(cid)补全完整资料（AI 填 阶位/性格/背景/外观/动机/关系/六维/好感 + 随身物品/装备）*/
  async function fleshOutContractor(cid: string, info: { name: string; tier?: string; job?: string; persona?: string; strength?: string; source?: string }): Promise<boolean> {
    const chain = dmChain();
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return false;
    const M = useMisc.getState();
    const sys = `据以下公共频道契约者的已知信息，生成一份完整 NPC 档案（轮回乐园风格），须与其已展现的发言/职业/性格一致并合理补全。
**重要**：该角色当前只是【离场/不在主角身边/在别处活动】，但**活着、健康、状态正常**——身份与阶位里**绝对不要**出现"已阵亡/死亡/已故/身亡"等字样，favor 也按正常关系给。
已知：名号「${info.name}」；${info.tier ? `阶位 ${info.tier}；` : ''}${info.job ? `职业 ${info.job}；` : ''}${info.strength ? `生物强度 ${info.strength}；` : ''}${info.persona ? `性格 ${info.persona}；` : ''}${info.source ? `频道发言：「${info.source}」；` : ''}当前世界：${M.worldName || '轮回乐园'}。
**只输出一个 JSON 对象**：{"realm":"阶位·Lv.X|身份(活人身份,勿写已阵亡)","personality":"性格","background":"背景经历","appearance":"外观","motiveNow":"当前动机/目的","relations":"主要人际关系","attrs":{"str":数,"agi":数,"con":数,"int":数,"cha":数,"luck":数},"favor":对主角好感(-100~100整数),"items":[{"name":"物品名","category":"武器/防具/饰品/消耗品/材料/特殊物品","gradeDesc":"白色/绿色/蓝色/紫色/暗紫色/淡金/金色/暗金/传说级/史诗级/圣灵级/不朽级/起源级/永恒级/创世(按阶位选合适档)","effect":"含数值的效果(攻防/加成)","equipped":true或false,"appearance":"外观"}]}。
- 六维按阶位与职业合理分配（宁低勿高、禁五项全满）。
- items：给 **3~6 件**符合其阶位/职业的随身物品，其中 **1~3 件 equipped:true**（武器≤1、防具1~2、饰品≤1），其余放储存空间；武器/防具的 effect 要写具体攻防数值。`;
    try {
      const { content } = await apiChatFallback(chain, [{ role: 'system', content: sys }], { timeoutMs: 60000 });
      const j: any = parseEntryJson(content) || {};
      const a = (v: any) => Math.max(1, Math.min(60, parseInt(String(v), 10) || 5));
      const patch: any = { isDead: false };   // 明确：离场契约者不是死人
      if (j.realm) patch.realm = stripDeadWords(j.realm).slice(0, 60);
      if (j.personality) patch.personality = flattenAiText(j.personality).slice(0, 300);
      if (j.background) patch.background = flattenAiText(j.background).slice(0, 500);
      if (j.appearance) patch.appearance5 = flattenAiText(j.appearance).slice(0, 300);
      if (j.motiveNow) patch.motiveNow = flattenAiText(j.motiveNow).slice(0, 200);
      if (j.relations) patch.relations = flattenAiText(j.relations).slice(0, 300);
      if (j.attrs && typeof j.attrs === 'object') patch.attrs = { str: a(j.attrs.str), agi: a(j.attrs.agi), con: a(j.attrs.con), int: a(j.attrs.int), cha: a(j.attrs.cha), luck: a(j.attrs.luck) };
      if (j.favor != null) patch.favor = Math.max(-100, Math.min(100, parseInt(String(j.favor), 10) || 0));
      useNpc.getState().upsertNpc(cid, patch);

      // 随身物品/装备 → 写入该 NPC 的储存空间（部分 equipped 进装备面板）
      if (Array.isArray(j.items) && (useNpc.getState().npcs[cid]?.items?.length ?? 0) === 0) {
        const armorParts = ['armor:upper', 'armor:inner', 'armor:head', 'armor:lower', 'armor:feet', 'armor:hands', 'armor:arms', 'armor:shoulder', 'armor:belt'];
        let wN = 0, aN = 0, cN = 0, tN = 0;
        j.items.slice(0, 8).forEach((it: any, idx: number) => {
          if (!it || !it.name) return;
          const cat = String(it.category || '其他物品');
          let equipSlot: string | undefined;
          if (it.equipped) {
            if (/武器/.test(cat)) { equipSlot = wN === 0 ? 'weapon:main' : `weapon:off${wN}`; wN++; }
            else if (/防具|护甲|衣|甲/.test(cat)) { equipSlot = armorParts[Math.min(aN, armorParts.length - 1)]; aN++; }
            else if (/饰品|戒指|项链|护符/.test(cat)) { equipSlot = `accessory:#${++cN}`; }
            else { equipSlot = `treasure:#${++tN}`; }
          }
          useNpc.getState().addNpcItem(cid, {
            id: `I_${cid}_${(idx + 1).toString().padStart(2, '0')}`,
            name: flattenAiText(it.name).slice(0, 40), category: cat,
            gradeDesc: flattenAiText(it.gradeDesc || it.grade) || '白色', effect: flattenAiText(it.effect),
            quantity: Math.max(1, parseInt(String(it.qty ?? 1), 10) || 1), equipped: !!it.equipped, equipSlot,
            appearance: flattenAiText(it.appearance) || undefined,
            combatStat: flattenAiText(it.combatStat || it.attack || it.defense) || undefined,
            acquisition: '建档时初始携带', tags: ['初始'], addedAt: Date.now(),
          });
        });
      }
      return true;
    } catch { return false; }
  }

  /* 据频道发言/已知信息，为未建档的频道 NPC 生成完整档案（离场状态）*/
  async function dmGenArchive(threadId: string) {
    const dm = useDm.getState();
    const th = dm.threads[threadId]; if (!th || th.targetId) return;
    if (!dmChain()[0]?.baseUrl || !dmChain()[0]?.apiKey) { dm.addMsg(threadId, { from: 'system', text: '（私信 API 未配置，无法生成档案）' }); return; }
    const cid = useNpc.getState().createArchivedContractor({ name: th.targetName, tier: th.targetTier, job: th.targetJob, persona: th.targetPersona, strength: th.targetStrength, tag: th.targetTag });
    const ok = await fleshOutContractor(cid, { name: th.targetName, tier: th.targetTier, job: th.targetJob, persona: th.targetPersona, strength: th.targetStrength, source: th.sourceContent });
    dm.patchThread(threadId, { targetId: cid, archived: true });
    dm.addMsg(threadId, { from: 'system', text: ok ? `已为 ${th.targetName} 生成完整档案（离场状态），可在右侧「📇 NPC」查看。` : '（资料补全失败，已建立简易离场档案）' });
    refreshNpcPreferredOwners();
  }

  /* ════════════ 好友 ════════════ */
  function findNpcByName(name: string): import('./store/npcStore').NpcRecord | undefined {
    const q = (name || '').trim(); if (!q) return undefined;
    return Object.values(useNpc.getState().npcs).find((n) => !n.isDead && (n.name || '').trim() === q);
  }
  /* 加好友：已建档/重名→直接标记；频道未建档→建离场档案+标记+异步补全资料。返回提示与 cid */
  async function addFriendByInfo(info: { targetId?: string; name: string; tier?: string; job?: string; persona?: string; strength?: string; tag?: string; source?: string }): Promise<{ ok: boolean; msg: string; cid?: string }> {
    if (info.tag && !isDmableTag(info.tag)) return { ok: false, msg: '土著/召唤物不能加为好友' };
    const existing = info.targetId ? useNpc.getState().npcs[info.targetId] : findNpcByName(info.name);
    if (existing) { useNpc.getState().setFriend(existing.id, true); return { ok: true, msg: `已把 ${existing.name || info.name} 加为好友`, cid: existing.id }; }
    const cid = useNpc.getState().createArchivedContractor({ name: info.name, tier: info.tier, job: info.job, persona: info.persona, strength: info.strength, tag: info.tag });
    useNpc.getState().setFriend(cid, true);
    fleshOutContractor(cid, { name: info.name, tier: info.tier, job: info.job, persona: info.persona, strength: info.strength, source: info.source }).then(() => refreshNpcPreferredOwners());
    return { ok: true, msg: `已把 ${info.name} 加为好友（生成离场档案中…）`, cid };
  }
  async function addFriendFromChannel(m: import('./store/channelStore').ChannelMessage): Promise<{ ok: boolean; msg: string }> {
    const r = await addFriendByInfo({ name: m.authorName, tier: m.authorTier, job: m.authorJob, persona: m.authorPersona, strength: m.authorStrength, tag: m.authorTag, source: String(m.content) });
    return { ok: r.ok, msg: r.msg };
  }

  const dmHandlers: DmHandlers = {
    onReply: dmReply, onPropose: dmPropose, onHaggle: dmHaggle, onAccept: dmAccept, onGenArchive: dmGenArchive,
    onOpenNpc: (cid: string) => { setDmPanelOpen(false); setOnSceneDetailId(cid); },
    onAddFriend: async (threadId: string) => {
      const dm = useDm.getState(); const th = dm.threads[threadId]; if (!th) return;
      const r = await addFriendByInfo({ targetId: th.targetId, name: th.targetName, tier: th.targetTier, job: th.targetJob, persona: th.targetPersona, strength: th.targetStrength, tag: th.targetTag, source: th.sourceContent });
      if (r.ok && r.cid && !th.targetId) dm.patchThread(threadId, { targetId: r.cid, archived: true });
      dm.addMsg(threadId, { from: 'system', text: r.ok ? `⭐ ${r.msg}` : r.msg });
    },
  };

  /* 系统商店·补货：AI 生成 20 件商品（价偏高），供「系统商店」购买 */
  async function genShopItems() {
    const chain = resolveApiChain('channel', getChannelApi());
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[Shop] 频道 API 未配置'); return []; }
    const prof = usePlayer.getState().profile;
    const M = useMisc.getState();
    const sys = `你是「轮回乐园·系统商店」补货员。一次性生成 **10 件** 待售商品，类别要丰富搭配：消耗品、制式装备(武器/防具/饰品)、技能书/技能卷轴、材料、工具、特殊物品等。
- 贴合当前世界(${M.worldName || '轮回乐园'})与主角阶位(${prof.tier || '一阶'}·Lv.${prof.level})的强度区间；**价格一般偏高**（系统商店溢价，约市场价 1.2~1.8 倍）。
- 每件按物品固定格式给全字段。**只输出 JSON**：{"items":[{"name","category"(武器/防具/饰品/消耗品/材料/工具/特殊物品/重要物品等),"subType","gradeDesc"(品质色由低到高:白/绿/蓝/紫/暗紫/淡金/金/暗金/传说级/史诗级/圣灵级/不朽级/起源级/永恒级/创世,按强度选合适档),"price"(数字),"currency"("乐园币"或"魂币"),"effect","combatStat"(装备攻防机器可读如"法术攻击力 60-135"/"防御力 8-12"),"durability","requirement","affix","origin","intro","appearance","qty"(默认1)}]}，共 10 件，不要任何多余文字或 markdown。

${EQUIP_CODEX}`;
    try {
      const { content } = await apiChatFallback(chain, [{ role: 'system', content: sys }, { role: 'user', content: '只输出 JSON {"items":[…10件…]}。' }], { timeoutMs: 90000 });
      const j = parseEntryJson(content);
      return (Array.isArray(j?.items) ? j.items : []).slice(0, 10);
    } catch (e: any) { console.warn('[Shop] 生成失败:', e?.message ?? e); return []; }
  }

  /* 系统回收·估价：AI 给选中的背包物品逐件报价（回收价约市场 50~80%）*/
  async function genSellQuotes(list: { id: string; name: string; gradeDesc: string; category: string; effect?: string; qty: number }[]) {
    const chain = resolveApiChain('channel', getChannelApi());
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return {};
    const lines = list.map((it) => `${it.id} | ${it.name} | 品质:${it.gradeDesc} | 类型:${it.category} | x${it.qty}${it.effect ? ' | 效果:' + it.effect.slice(0, 40) : ''}`).join('\n');
    const sys = `你是「轮回乐园·系统回收」估价员，为主角要出售的物品逐件给出**回收报价**（系统回收价约市场价 50%~80%，按品质/效果/稀有度/数量估算；品质越高价越高）。
**只输出 JSON**：{"quotes":[{"id":"原样照抄物品id","price":数字,"currency":"乐园币"或"魂币"}]}，每件一条，不要多余文字。

【待估物品】
${lines}`;
    try {
      const { content } = await apiChatFallback(chain, [{ role: 'system', content: sys }, { role: 'user', content: '只输出 JSON {"quotes":[...]}。' }], { timeoutMs: 60000 });
      const j = parseEntryJson(content);
      const out: Record<string, { price: number; currency: string }> = {};
      (Array.isArray(j?.quotes) ? j.quotes : []).forEach((q: any) => {
        if (q?.id != null) out[String(q.id)] = { price: Math.max(0, Math.round(Number(q.price) || 0)), currency: (q.currency === '魂币' || q.currency === '灵魂钱币') ? '灵魂钱币' : '乐园币' };
      });
      return out;
    } catch (e: any) { console.warn('[Shop] 估价失败:', e?.message ?? e); return {}; }
  }

  /* 为玩家未成交的求购/出售帖生成契约者报价/出价（每条带留言）。成交结算仍由代码确定性处理。*/
  async function solicitQuotes() {
    const C = useChannel.getState();
    if (!C.settings.enabled) return;
    const open = C.messages.filter((m) => m.byPlayer && !m.fulfilled && (m.kind === 'buy' || m.kind === 'sell') && (m.quotes?.length ?? 0) < 4);
    if (open.length === 0) return;
    const chain = resolveApiChain('channel', getChannelApi());
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return;
    const prof = usePlayer.getState().profile;
    const M = useMisc.getState();
    const sys = buildChannelSystemPrompt(C.settings.entries)
      .replaceAll('${player_name}', prof.name || '主角')
      .replaceAll('${player_tier}', `${prof.tier || realmFromLevel(prof.level)}·Lv.${prof.level}`)
      .replaceAll('${world_name}', M.worldName || '轮回乐园')
      .replaceAll('${world_time}', M.worldTime || M.paradiseTime || '')
      .replaceAll('${enabled_channels}', '交易').replaceAll('${recent_events}', '').replaceAll('${existing_messages}', '').replaceAll('${message_count}', '0')
      + '\n\n【报价生成铁则】针对玩家在交易频道挂的求购/出售帖，扮演多位**不同**契约者给出报价/出价，每条务必：① 价格贴合该物品的颜色品质定价与玩家预算（有人急出压价、有人坐地起价、有人给替代品/附赠）；② **求购帖里你是卖家**（报价把东西卖给玩家），**出售帖里你是买家**（出价收购玩家的东西）；③ 必带一句符合该契约者身份口吻的【留言】（可砍价/吹嘘/吐槽/玩梗/讲价由头）。货币用 乐园币 或 灵魂钱币。\n④ **求购帖的卖家报价：必须按固定格式给出所提供物品的完整属性**——名称/产地(origin)/品质色(gradeDesc)/类型(category+subType)/攻防(combatStat)/耐久(durability)/装备需求(requirement)/词缀(affix)/评分(score)/效果(effect)/简介(intro)/外观(appearance)，武器另加杀敌数(killCount)；**若是技能书/技能卷轴/知识卷轴/图纸/天赋碎片**，subType 写明类型、effect 明确写学会/获得什么（技能名+层阶 / 知识领域 / 可制造产品 / 天赋名+评级）；**一个都不能省略、不准偷懒**（与物品生成同标准）。\n⑤ **出售帖里你是买家**，有两种回应方式，让多位买家**混合采用**更真实：(a) **纯现金收购**——`barter` 设 false、`itemName` 留空，只给 price/currency/note；(b) **以物换物（barter）**——拿出你自己的一件物品跟玩家换：`barter` 设 true，并按固定格式给出**你这件换购物品**的完整属性（itemName/gradeDesc/category/subType/origin/combatStat/durability/requirement/affix/score/effect/intro/appearance，武器加 killCount；技能书/卷轴/图纸/天赋碎片同求购帖标准写明 subType+effect），`price` 填你**额外找补给玩家的现金**（平换则填 0）。换购物品必须是**与玩家那件不同、且贴合玩家诉求**的真实物品，属性一个都不能空。'
      + '\n\n' + EQUIP_CODEX   // 求购帖卖家报价/以物换路换购物品都会生成装备 → 全量注入装备世界书
      + '\n\n' + CHANNEL_PRICE_CODEX;   // 物品价格世界书 → 报价/砍价以公允价为准，离谱定价要被戳破
    const priceNum = (p?: string) => { const n = parseInt(String(p ?? '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : 0; };
    const postsDesc = open.map((m) => {
      const o = m.offer ?? {};
      const base = `「${o.itemName}」${o.gradeDesc ? `(${o.gradeDesc})` : ''}${o.qty && o.qty > 1 ? ` ×${o.qty}` : ''}`;
      const side: 'buy' | 'sell' = m.kind === 'buy' ? 'buy' : 'sell';
      // 前端机械估价：出售帖以玩家物品的评分/品级为准，求购帖只有品级（玩家未持有该物）
      const fair = estimateFairValue({ score: side === 'sell' ? o.score : undefined, gradeDesc: o.gradeDesc, category: o.category, qty: o.qty });
      const pv = priceVerdict(side, priceNum(o.price), o.currency, fair);
      const ratioTxt = pv.ratio ? `（约公允价${pv.ratio >= 1 ? pv.ratio.toFixed(1) + '倍' : Math.round(pv.ratio * 100) + '%'}）` : '';
      const anchor = `〔系统估价：公允价≈${formatFairRange(fair)}；玩家定价判级：${VERDICT_LABEL[pv.verdict]}${ratioTxt}${fair.strategic ? '；战略级·宜以物换物' : ''}〕`;
      return side === 'buy'
        ? `${m.id} 求购：玩家想买 ${base}，预算 ${o.price || '面议'} ${o.currency || '乐园币'}；玩家留言：${o.note || '无'} ${anchor}`
        : `${m.id} 出售：玩家想卖 ${base}，期望 ${o.price || '面议'} ${o.currency || '乐园币'}；玩家留言：${o.note || '无'} ${anchor}`;
    }).join('\n');
    const user = `玩家挂出的帖子如下，请为每个帖子生成 2~4 条报价/出价：\n${postsDesc}\n\n【按估价锚点反应·务必执行】每帖末〔系统估价〕已给出该物公允价与玩家定价判级，据此回应：\n- 判级「离谱虚高」(出售要价远超公允价)→ 至少 1~2 条买家**戳破并拒绝/嘲笑/劝阻**，note 直说品级评分配不上这价，price 给贴近公允价的诚实出价，绝不照单全收。\n- 判级「严重偏离」(求购预算远低于公允价)→ 至少 1~2 条卖家**拒绝/调侃这点钱买不到、劝其加价**，price 给该档真实售价当还价，note 写明「加到 X 才有人卖」。\n- 判级「接近公允/偏高/偏低」→ 正常砍价还价，报价落在公允价区间附近。\n- 面议(玩家没填价)→ 按公允价主动给出合理报价。\n离谱定价必须有人说实话，切忌全场假装能成交；语气贴合各契约者人设(毒舌奸商/老好心前辈/看热闹/就事论事的行家)。\n\n只输出 JSON：{"quotes":[{"postId":"<帖子号如 M_5>","fromName":"昵称","fromTier":"三阶·Lv.25","fromTag":"契约者","barter":false,"itemName":"(求购帖=你提供的物品名；出售帖纯现金收购留空，以物换物则填你拿出交换的物品名)","gradeDesc":"品质色","category":"分类","subType":"类型细分","origin":"产地","combatStat":"攻防数值","durability":"耐久","requirement":"装备需求","affix":"词缀","score":"评分","effect":"效果","intro":"简介","appearance":"逐部件外观","killCount":"杀敌数(武器)","qty":1,"price":数字,"currency":"乐园币","note":"留言"}]}（求购帖的卖家报价务必填全 origin/subType/combatStat/durability/requirement/affix/score/effect/intro/appearance 等固定格式字段；出售帖：纯现金收购 barter:false 只给 price/currency/note，以物换物则 barter:true 并把换购物品按上述固定格式字段写全、price=额外找补现金/平换填0）`;
    useChannel.getState().setRefreshing(true);
    try {
      const { content } = await apiChatFallback(chain, [{ role: 'system', content: sys }, { role: 'user', content: user }]);
      const j = parseEntryJson(content);
      const arr = Array.isArray(j?.quotes) ? j.quotes : [];
      const byPost: Record<string, any[]> = {};
      for (const q of arr) { const pid = String(q?.postId ?? ''); if (pid && q?.price != null) (byPost[pid] ??= []).push(q); }
      let total = 0;
      const live = useChannel.getState().messages;
      for (const [pid, qs] of Object.entries(byPost)) {
        if (!live.some((m) => m.id === pid)) continue;
        useChannel.getState().addQuotes(pid, qs.map((q) => ({
          fromName: String(q.fromName ?? '某契约者').split('|')[0].trim(),
          fromTier: q.fromTier, fromTag: q.fromTag, barter: q.barter === true,
          itemName: q.itemName, category: q.category, gradeDesc: q.gradeDesc, qty: Number(q.qty) || 1,
          price: Number(q.price) || 0, currency: q.currency || '乐园币', note: q.note,
          // 固定格式完整字段（卖家报价的物品属性，供详情展示 + 购买带入）
          origin: q.origin, subType: q.subType, combatStat: q.combatStat, durability: q.durability,
          requirement: q.requirement, affix: q.affix, score: q.score != null ? String(q.score) : undefined,
          effect: q.effect, intro: q.intro, appearance: q.appearance,
          killCount: q.killCount != null ? String(q.killCount) : undefined,
        })));
        total += qs.length;
      }
      console.log(`[Channel] 为 ${Object.keys(byPost).length} 个玩家帖生成 ${total} 条报价`);
    } catch (e: any) { console.warn('[Channel] 报价生成失败:', e?.message ?? e); }
    finally { useChannel.getState().setRefreshing(false); }
  }

  /* ════════════════════════════════════════════
     势力演化（仿 NPC：当前世界=在场 / 非当前世界=离场；独立API；策略A/B）
  ════════════════════════════════════════════ */
  function getFactionApi() {
    const fs = useFactionEvo.getState();
    if (fs.factionUseSharedApi) { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; }
    return fs.factionApi;
  }
  async function factionChatCompletion(systemPrompt: string, userContent: string): Promise<string> {
    const chain = resolveApiChain('faction', getFactionApi());
    const cfg = useFactionEvo.getState().settings.scheduling;
    const { content } = await apiChatFallback(
      chain,
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      { timeoutMs: Math.max(30, cfg.requestTimeout || 90) * 1000 },
    );
    return content;
  }
  /* 势力短指令：faction.F1.favorToPlayer = N / faction.F1.status = "战争中" / faction.F1.inCurrentWorld = true */
  function applyFactionShortCommands(reply: string, onlyId?: string): number {
    const fac = useFaction.getState(); let n = 0; let m: RegExpExecArray | null;
    const ok = (id: string) => !onlyId || id === onlyId;
    const numRe = /\bfaction\.(F\d+)\.favorToPlayer\s*(=|\+=|-=)\s*(-?\d+)/g;
    while ((m = numRe.exec(reply))) { if (!ok(m[1])) continue; const cur = fac.factions[m[1]]?.favorToPlayer ?? 0; const v = Number(m[3]); fac.upsertFaction(m[1], { favorToPlayer: m[2] === '=' ? v : m[2] === '+=' ? cur + v : cur - v }); n++; }
    const boolRe = /\bfaction\.(F\d+)\.inCurrentWorld\s*=\s*(true|false)/g;
    while ((m = boolRe.exec(reply))) { if (!ok(m[1])) continue; fac.setWorld(m[1], m[2] === 'true', turnCountRef.current); n++; }
    const strFields = ['status', 'goal', 'territory', 'leader', 'resources', 'scale', 'powerLevel', 'type', 'relations'];
    for (const f of strFields) {
      const re = new RegExp(`\\bfaction\\.(F\\d+)\\.${f}\\s*=\\s*"([^"]*)"`, 'g');
      while ((m = re.exec(reply))) { if (ok(m[1])) { fac.upsertFaction(m[1], { [f]: m[2] } as any); n++; } }
    }
    return n;
  }
  /* 势力快照（重点演化注入） */
  function serializeFactionSnapshot(r: import('./store/factionStore').FactionRecord): string {
    return [
      `势力ID: ${r.id}`, `名称: ${r.name}`, r.type && `类型: ${r.type}`,
      `所在: ${r.inCurrentWorld ? '当前世界' : '非当前世界'}${r.worldName ? `(${r.worldName})` : ''}`,
      r.scale && `规模: ${r.scale}`, r.powerLevel && `实力: ${r.powerLevel}`, r.territory && `地盘: ${r.territory}`,
      r.leader && `首领: ${r.leader}`, r.members && `核心成员: ${r.members}`, r.relations && `势力关系: ${r.relations}`,
      `对主角态度: ${r.favorToPlayer}`, r.goal && `当前目标: ${r.goal}`, r.resources && `资源: ${r.resources}`,
      `状态: ${r.status}`, r.assets && `产业: ${r.assets}`, r.background && `背景: ${r.background}`,
    ].filter(Boolean).join('\n');
  }
  /* 当前世界势力 + 非当前世界配额，计算 focus 列表 */
  function computeFactionFocus(): string[] {
    const { scheduling } = useFactionEvo.getState().settings;
    const all = Object.values(useFaction.getState().factions).filter((f) => !f.isDestroyed);
    if (scheduling.targetMode === 'manual') return scheduling.manualFocusIds.filter((id) => useFaction.getState().factions[id]);
    const cur = all.filter((f) => f.inCurrentWorld).map((f) => f.id);
    const off = all.filter((f) => !f.inCurrentWorld)
      .sort((a, b) => (b.lastSeenTurn ?? 0) - (a.lastSeenTurn ?? 0))
      .slice(0, Math.max(0, scheduling.offWorldQuota)).map((f) => f.id);
    let focus = [...cur, ...off];
    const lim = scheduling.modelPerTurnLimit;
    if (lim > 0) focus = focus.slice(0, lim);
    return focus;
  }
  /* 策略B 第一段：当前世界判断 */
  async function runFactionWorldJudgment(narrative: string) {
    const { entries } = useFactionEvo.getState().settings;
    const sys = buildFactionEntryPrompt(entries) + '\n\n' + NARRATIVE_FIRST_RULE + '\n' + FACTION_DETECT_RULE + '\n' + FACTION_HOME_EXIT_RULE + '\n' + FACTION_WORLD_RULE + '\n' + FACTION_FULL_FORMAT_RULE + '\n' + FACTION_NAME_RULE;
    const facStore = useFaction.getState();
    const list = Object.values(facStore.factions);
    const known = list.map((f) => `${f.id}(${f.name})${f.worldName ? '·所属世界:' + f.worldName : ''}${f.inCurrentWorld ? '·当前世界' : '·非当前世界'}`).join(', ') || '（无）';
    const cNums = list.map((f) => f.id.match(/^F(\d+)$/)?.[1]).filter(Boolean).map(Number);
    const nextId = `F${cNums.length ? Math.max(...cNums) + 1 : 1}`;
    const M = useMisc.getState();
    const user = `# 本轮正文\n${trimNarrative(narrative)}\n\n当前世界: ${M.worldName || '轮回乐园'}\n已知势力: ${known}\n下一个可用势力ID: ${nextId}\n\n请把本轮正文里**出现、提到、暗示或主角遭遇的每一个势力都列出（宁多勿漏，可同时建/拉回多个）**：新势力建档(type:new)、已知势力重新活跃(type:reentry)、离开本世界(exits)。只输出 JSON：{"entries":[{"id":"F1","type":"new|reentry","name":"…","stateCommands":"faction.F1.type=\\"…\\""}],"exits":[{"id":"F2"}]}`;
    const reply = await factionChatCompletion(sys || '你判断当前世界有哪些势力。', user);
    const j = parseEntryJson(reply); if (!j) return;
    const used = new Set(Object.keys(facStore.factions));
    const nextFree = () => { let n = 1; while (used.has(`F${n}`)) n++; return `F${n}`; };
    for (const e of j.entries ?? []) {
      if (!e?.id) continue;
      let id = e.id;
      const exist = facStore.factions[id];
      const sameName = exist && e.name && exist.name === e.name;
      if (e.type === 'new' && exist && exist.name && exist.name !== exist.id && !sameName) { id = nextFree(); }
      // 同名去重
      const dup = Object.values(facStore.factions).find((f) => f.name && f.name === e.name && f.id !== id);
      if (e.type === 'new' && dup) { facStore.setWorld(dup.id, true, turnCountRef.current); used.add(dup.id); continue; }
      used.add(id);
      facStore.upsertFaction(id, { name: e.name ?? id, inCurrentWorld: true });
      facStore.setWorld(id, true, turnCountRef.current);
      if (e.stateCommands) applyFactionShortCommands(String(e.stateCommands), id);
    }
    for (const x of j.exits ?? []) { if (x?.id) facStore.setWorld(x.id, false); }
  }
  /* 策略B 第二段：逐势力重点演化 */
  async function runFactionFocusEvolution(narrative: string) {
    const focus = computeFactionFocus();
    if (focus.length === 0) return;
    const { entries, scheduling } = useFactionEvo.getState().settings;
    const sysBase = buildFactionSystemPrompt(entries) + '\n\n' + NARRATIVE_FIRST_RULE + '\n' + FACTION_WORLD_RULE + '\n' + FIRST_UPDATE_COMPLETE_RULE + '\n' + FACTION_FULL_FORMAT_RULE + '\n' + FACTION_NAME_RULE + '\n' + FACTION_COT_RULE;
    const trimmed = trimNarrative(narrative);
    const conc = Math.max(1, scheduling.concurrency || 2);
    for (let i = 0; i < focus.length; i += conc) {
      const batch = focus.slice(i, i + conc);
      await Promise.all(batch.map(async (id) => {
        const rec = useFaction.getState().factions[id]; if (!rec) return;
        const sys = `${sysBase}\n\n【目标势力当前档案（只补全+增量更新，勿重造）】\n${serializeFactionSnapshot(rec)}`;
        // 该势力名字仍是占位ID（如 F1）→ 本回合必须借正文/大事记把它正式命名，这不算"无变化"
        const unnamed = !rec.name || rec.name === rec.id || /^F\d+$/i.test(rec.name);
        const recoverHint = unnamed
          ? `\n\n⚠【该势力尚未正式命名】当前名称仍是占位ID「${rec.id}」。请**务必**结合本轮正文${(rec.deeds?.length ?? 0) > 0 ? `及其大事记（${rec.deeds!.slice(-3).map((d) => d.description).join('；')}）` : ''}，本回合就用 addFaction("${id}",{name:"…",…}) 为它起一个符合世界观、有具体含义的中文名并补全其余字段——这**不算**"无变化"，必须输出。`
          : '';
        const user = `# 本轮正文\n${trimmed}\n\n**先输出一个 <think>…</think> 思考块**，按「势力演化思维链」对势力 ${id}(${rec.name}) 逐项自检；**随后**只为势力 ${id} 输出 <upstore> 的 addFaction("${id}",{…}) 或 <state> 的 faction.${id}.* 短指令，无变化输出空。${recoverHint}`;
        try {
          const rawReply = await factionChatCompletion(sys, user);
          const reply = (rawReply || '').replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim();   // 剥掉思维链再解析
          if (reply) {
            applyFactionCommands(parseAllFactionCommands(reply).filter((c) => c.id === id));
            applyCharacterCommands(parseAllCharCommands(reply).filter((c) => c.charId === id));  // addDeed("F1",…)
            applyFactionShortCommands(reply, id);
            useFaction.getState().markEvolved(id, turnCountRef.current);
          }
        } catch (e: any) { console.warn(`[Faction] ${id} 演化失败:`, e?.message ?? e); }
      }));
    }
  }
  /* 策略A：单次合并 */
  async function runFactionStrategyA(narrative: string) {
    const { entries } = useFactionEvo.getState().settings;
    const sysBase = entries.filter((e) => e.enabled).map((e) => e.content).join('\n\n');
    if (!sysBase) return;
    const sys = sysBase + '\n\n' + FACTION_DETECT_RULE + '\n' + FACTION_FULL_FORMAT_RULE + '\n' + FACTION_NAME_RULE + '\n' + FACTION_COT_RULE;
    const list = Object.values(useFaction.getState().factions);
    const known = list.map((f) => `${f.id}(${f.name})${f.inCurrentWorld ? '·当前世界' : '·非'}`).join(', ') || '（无）';
    const user = `# 本轮正文\n${trimNarrative(narrative)}\n已知势力: ${known}\n**先输出一个 <think>…</think> 思考块**，按「势力演化思维链」逐项自检；**随后**把本轮正文里**出现/提到/遭遇的每一个势力都处理（宁多勿漏）**：新势力 addFaction() 建档、已变化的势力 faction.* 增量更新、覆灭的 deFaction()。无任何相关势力才输出空。`;
    const rawReply = await factionChatCompletion(sys, user);
    const reply = (rawReply || '').replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim();   // 剥掉思维链再解析
    if (reply) {
      applyFactionCommands(parseAllFactionCommands(reply));
      applyCharacterCommands(parseAllCharCommands(reply).filter((c) => /^F\d+$/.test(c.charId)));
      applyFactionShortCommands(reply);
    }
  }
  async function runFactionEvolutionPhase(narrative: string) {
    const { settings } = useFactionEvo.getState();
    if (!settings.enabled) return;
    // 用接口路由链判断（中心 API 接口库选了势力路由也算已配置），而不是只看势力自己的单配置
    const chain = resolveApiChain('faction', getFactionApi());
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[Faction] API 未配置（设置→势力演化→API，或综合设置→API 接口库选路由）'); return; }
    setFactionPhaseLog('势力演化中…');
    try {
      if (settings.strategy === 'B') { await runFactionWorldJudgment(narrative); await runFactionFocusEvolution(narrative); }
      else { if (turnCountRef.current % (settings.frequency || 1) === 0) await runFactionStrategyA(narrative); }
      setFactionPhaseLog('✓ 势力演化完成');
    } catch (e: any) { setFactionPhaseLog(`⚠ 势力更新失败：${(e.message ?? '').slice(0, 50)}`); }
    finally { setTimeout(() => setFactionPhaseLog(''), 8000); }
  }

  /* 直接从正文「人物信息卡」抽取六维并写入对应角色（主角/已建档NPC，按名字匹配）。
     解决"正文卡里写了六维但演化没照抄/漏项导致属性与正文不一致"。 */
  function applyNarrativeAttrs(narrative: string) {
    // 名称/姓名…(窗口内)…六维[属性]: 力X[｜| ]敏Y…幸C —— 容忍"姓名/名称"、"六维属性："、全角｜、空格、冒号
    const re = /(?:名称|姓名)\s*[:：]\s*([^\n（(｜|]{1,20})[\s\S]{0,320}?六维[^力\n]{0,8}?力[量]?\s*[:：]?\s*(\d{1,3})[^敏\n]{0,6}?敏[捷]?\s*[:：]?\s*(\d{1,3})[^体\n]{0,6}?体[质]?\s*[:：]?\s*(\d{1,3})[^智\n]{0,6}?智[力]?\s*[:：]?\s*(\d{1,3})[^魅\n]{0,6}?魅[力]?\s*[:：]?\s*(\d{1,3})[^幸\n]{0,6}?幸[运]?\s*[:：]?\s*(\d{1,3})/g;
    let m: RegExpExecArray | null; let applied = 0;
    const npc = useNpc.getState();
    const P = usePlayer.getState();
    const pName = P.profile.name?.trim();
    while ((m = re.exec(narrative)) !== null) {
      const name = m[1].trim();
      if (!name) continue;
      const attrs = { str: +m[2], agi: +m[3], con: +m[4], int: +m[5], cha: +m[6], luck: +m[7] };
      // 主角？仅当主角六维仍是未分配的默认(全5)时才用正文卡填充；已分配过(创建/加点)就不让正文卡覆盖，
      // 避免"创建时加好的点、进世界被 AI 卡写回 5"的清零 bug（主角属性以创建+主角演化 character.B1.attrs 为准）。
      if (pName && (name === pName || name.includes(pName) || pName.includes(name))) {
        const c = P.profile.attrs;
        const untouched = !c || (c.str === 5 && c.agi === 5 && c.con === 5 && c.int === 5 && c.cha === 5 && c.luck === 5);
        if (untouched) { P.setProfile({ attrs: clampBaseAttrs(attrs, P.profile.tier, P.profile.level) }); applied++; }
        continue;
      }
      // 已建档 NPC（按名字匹配；卡名常含前缀如"灰烬拾荒者·卡尔"，做包含匹配，名字≥2字防误配）
      const rec = Object.values(npc.npcs).find((r) => {
        const rn = r.name?.trim();
        return rn && rn !== r.id && rn.length >= 2 && (rn === name || name.includes(rn) || rn.includes(name));
      });
      // 幸运不照抄卡片(前端独占)：保留该 NPC 现有幸运，随后由 ensureNpcLuck 统一重算为 base+delta
      if (rec) { npc.upsertNpc(rec.id, { attrs: { ...clampBaseAttrs(attrs, rec.realm), luck: rec.attrs?.luck ?? attrs.luck } }); applied++; }
    }
    if (applied > 0) console.log(`[Attr] 从正文人物卡照抄六维：${applied} 个角色`);
  }

  // 敌怪 / 死亡 词：正文血量兜底用来识别「这行 HP 属于被击杀的对手，不是主角/友方」（主角与NPC共用）
  const OTHER_VITAL_WORDS = '敌|怪|魔物|魔兽|妖兽|对手|尸体|死亡|阵亡|殒命|陨落|被击败|被击杀|被斩杀|被斩|被杀|斩杀|击杀|灰飞烟灭|化作飞灰|消散|湮灭|Boss|BOSS';

  /* 从正文抽取主角「当前HP：X/Y」「当前EP/MP：X/Y」并写入 gameStore（取最后一次=最新状态）。
     解决"正文说 HP 恢复到 145/160、侧栏 HP 却没变"——AI 漏输出 hp.B1 时用正文显式数值兜底。仅认带"当前"的状态行，避免误抓 NPC 卡。
     防误抓：HP/EP 行的直接主语若是别的角色/敌怪（如战死敌人「当前HP：0」），或归零行没有「主角/你/我」主语，就不当作主角 → 修复"敌人死亡 HP=0 被写成主角 HP=0"。 */
  function applyNarrativeVitals(narrative: string) {
    const g = useGame.getState();
    const dmh = playerMaxHp(), dme = playerMaxEp();   // 真实上限：六维 + 装备 + 被动/天赋上限加成
    // 别的角色名（含敌怪死亡词）：HP 行紧前若出现，说明那行 HP 不是主角的
    const otherNames = Object.values(useNpc.getState().npcs)
      .map((r) => (r.name || '').split('|')[0].trim())
      .filter((n) => n.length >= 2 && !/^(主角|你|我)$/.test(n))
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const OTHER_RE = new RegExp([...otherNames, OTHER_VITAL_WORDS].join('|'));
    const SELF_RE = /(?:主角|你|我)的?$/;   // 直接主语是「主角/你/我」才算主角自己
    // 取「与主角关联」的最后一个 X/Y：直接主语是别人→跳过；主语空缺但同句前文有敌怪→跳过；HP 归零须有主角主语
    const grabLast = (src: string, guardZero: boolean): [number, number] | null => {
      const r = new RegExp(src, 'gi'); let m: RegExpExecArray | null, last: [number, number] | null = null;
      while ((m = r.exec(narrative)) !== null) {
        const before = narrative.slice(Math.max(0, m.index - 30), m.index);
        const seg = (before.split(/[。！？!?\n，,、；;]/).pop() || '').trim();   // 紧贴 HP 的那一小句（直接主语）
        const self = SELF_RE.test(seg);
        if (OTHER_RE.test(seg)) continue;               // 直接主语是别的角色/敌怪
        if (!self && OTHER_RE.test(before)) continue;   // 主语空缺，但同句前文提到敌怪（如「斩杀X，当前HP：0」）
        const cur = Number(m[1]);
        if (guardZero && cur === 0 && !self) continue;  // HP 归零须有「主角/你/我」直接主语（防战死敌人误判）
        last = [cur, Number(m[2])];
      }
      return last;
    };
    // 只有当正文报的"上限"与真实上限相符(±容差)时，才采信它的"当前值"；
    // 否则（如开局 AI 在人物卡瞎写「当前HP：100/100」）忽略，避免把刚拉满的主角写回默认值。只写当前值、不写 gameStore 上限。
    const within = (max: number, dm: number) => dm > 0 && Math.abs(max - dm) <= Math.max(6, dm * 0.12);
    // 先认「当前HP：X/Y」；没有则认成长块箭头「HP: 180/180 -> 400/400」取箭头后的最终值
    let hp = grabLast('当前\\s*(?:HP|血量|生命值?)\\s*[:：]\\s*(\\d{1,7})\\s*/\\s*(\\d{1,7})', true);
    if (!hp) hp = grabLast('(?:HP|血量|生命值?)\\s*[:：]?\\s*\\d{1,7}\\s*/\\s*\\d{1,7}\\s*(?:->|→|=>|➜|⟶)\\s*(\\d{1,7})\\s*/\\s*(\\d{1,7})', true);
    // 采信条件：① 受伤值（当前<上限）→ 直接采信（正文报的上限哪怕和前端算的略有出入，当前血量仍是真实的，钳到前端上限即可）；
    //          ② 满血值（当前=上限）→ 仍要求上限相符，防开局 AI 瞎写「100/100」把刚拉满的主角写回默认。
    const hpOk = !!hp && hp[0] >= 0 && hp[1] > 0 && (hp[0] < hp[1] || within(hp[1], dmh));
    if (hpOk) g.setPlayerField('hp', Math.min(hp![0], dmh));
    let ep = grabLast('当前\\s*(?:EP|MP|蓝量|法力|能量|精力)\\s*[:：]\\s*(\\d{1,7})\\s*/\\s*(\\d{1,7})', false);
    if (!ep) ep = grabLast('(?:EP|MP|蓝量|法力|能量|精力)\\s*[:：]?\\s*\\d{1,7}\\s*/\\s*\\d{1,7}\\s*(?:->|→|=>|➜|⟶)\\s*(\\d{1,7})\\s*/\\s*(\\d{1,7})', false);
    const epOk = !!ep && ep[0] >= 0 && ep[1] > 0 && (ep[0] < ep[1] || within(ep[1], dme));
    if (epOk) g.setPlayerField('mp', Math.min(ep![0], dme));
    if (hpOk || epOk) console.log(`[Vitals] 正文照抄主角 ${hpOk ? `HP ${hp![0]}/${dmh}` : ''} ${epOk ? `EP ${ep![0]}/${dme}` : ''}`);
  }

  /* 从正文抽取【NPC】「(当前)HP/EP：X/Y」写入 npcStore（参考主角 applyNarrativeVitals 逻辑，按 NPC 名字定位）：
     名字后窗口内找 HP/EP；仅当正文报的上限与该 NPC 真实上限(体×20/智×15)相符时才采信，
     既避免误抓邻近角色、也避免 AI 瞎写的数值；只写当前值、上限由六维自动算。AI 漏输出 hp.<id> 时兜底。
     防误抓：名字与 HP 之间若跨到了别的角色名/敌怪死亡词（如「李雷斩杀哥布林，哥布林当前HP：0」），这段 HP 属于别人 → 跳过。*/
  function applyNarrativeNpcVitals(narrative: string) {
    const npc = useNpc.getState();
    const recs = Object.values(npc.npcs).filter((r) => r.name && r.name !== r.id && r.name.trim().length >= 2 && !r.isDead && r.attrs);
    if (recs.length === 0) return;
    const within = (max: number, dm: number) => dm > 0 && Math.abs(max - dm) <= Math.max(8, dm * 0.15);
    const allNames = recs.map((r) => r.name.split('|')[0].trim());
    let applied = 0;
    for (const r of recs) {
      // 上限与面板/详情同口径：fullMaxHp/EP = 体×20/智×15 + 装备 + 技能/天赋的「HP/EP上限」加成（之前用 computeMaxHp 只算基础六维→与卡片显示的最大值对不上）
      const cdata = useCharacters.getState().characters[r.id];
      const eqp = (r.items ?? []).filter((it) => it.equipped) as any[];
      const rmR = realAttrMult(r.realm, lvFromRealm(r.realm));
      const dmh = fullMaxHp(r.attrs!, eqp, cdata?.skills, cdata?.traits, rmR, ratioOf(r)), dme = fullMaxEp(r.attrs!, eqp, cdata?.skills, cdata?.traits, rmR, ratioOf(r));
      const selfName = r.name.split('|')[0].trim();
      const nameEsc = selfName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 跨越词：别的角色名 + 敌怪死亡词；出现在 name→HP 之间，说明这段 HP 属于别人
      const others = allNames.filter((n) => n !== selfName).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const CROSS_RE = new RegExp([...others, OTHER_VITAL_WORDS].join('|'));
      const grab = (kws: string, dm: number): number | null => {
        if (dm <= 0) return null;
        const re = new RegExp(`${nameEsc}([\\s\\S]{0,160}?)(?:当前)?\\s*(?:${kws})\\s*[:：]\\s*(\\d{1,7})\\s*/\\s*(\\d{1,7})`, 'gi');
        let m: RegExpExecArray | null, last: [number, number] | null = null;
        while ((m = re.exec(narrative)) !== null) {
          if (CROSS_RE.test(m[1])) continue;   // name→HP 之间跨到别的角色/敌怪 → 不是本人的状态行
          last = [Number(m[2]), Number(m[3])];
        }
        // 受伤值(当前<上限)直接采信(钳到前端上限)；满血值才要求上限相符——与主角 applyNarrativeVitals 同口径
        return last && last[0] >= 0 && last[1] > 0 && (last[0] < last[1] || within(last[1], dm)) ? Math.min(last[0], dm) : null;
      };
      const hp = grab('HP|血量|生命值?', dmh);
      const ep = grab('EP|MP|蓝量|法力|能量|精力', dme);
      const patch: Partial<import('./store/npcStore').NpcRecord> = {};
      if (hp != null) patch.hp = hp;
      if (ep != null) patch.mp = ep;
      if (Object.keys(patch).length) { npc.upsertNpc(r.id, patch); applied++; }
    }
    if (applied > 0) console.log(`[Vitals] 正文照抄 NPC HP/EP：${applied} 个角色`);
  }

  function parseTierNum(realm?: string): number {
    const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const m = /([一二三四五六七八九])阶/.exec(realm ?? '');
    if (m) return map[m[1]];
    if (/无上|巅峰至强/.test(realm ?? '')) return 9;
    if (/至强|绝强/.test(realm ?? '')) return 9;
    return 1;
  }
  /* 给在场、缺六维（或五项全等=平均默认）的 NPC 自动生成六维——走 bioStrength 机械引擎
     (注水分配/形态压制/定位纠偏/闭环自检)，与属性面板·生物强度显示同尺度(ATTR_CAP)，治旧版尺度不一致+离谱 */
  function autoGenMissingAttrs() {
    const npc = useNpc.getState(); let n = 0;
    for (const r of Object.values(npc.npcs)) {
      if (r.isDead) continue;
      const a = r.attrs;
      const isDefault = !!a && a.str === 5 && a.agi === 5 && a.con === 5 && a.int === 5 && a.cha === 5; // 恰好默认 5/5/5/5/5
      if (!a || isDefault) {
        const mT = /[Tt]\s*(\d)/.exec(`${r.bioStrength ?? ''} ${r.realm ?? ''}`);
        const attrs = generateNpcAttrs({
          tier: r.realm, level: lvFromRealm(r.realm),
          bioTier: mT ? Number(mT[1]) : parseTierNum(r.realm),                  // realm/bio 写了 T 档就用，否则按阶位序估，再被定位/窗口夹正
          type: r.unitType,                                                     // 登场判断 ty 字段(封闭类型标签)→收编 职业排序/形态/凡人
          job: r.profession || r.realm,                                         // 类型缺失时的职业花名兜底(realm 身份段 神官/队长… 自动归类)
          role: `${r.profession ?? ''} ${r.realm ?? ''} ${r.npcTag ?? ''} ${r.bioStrength ?? ''}`,  // 身份段+职业+标签+AI给的bs定位 → 定位纠偏(首领抬、杂兵压)
          form: resolveForm(`${r.npcTag ?? ''}${r.profession ?? ''}${(r as any).species ?? ''}${r.name ?? ''}`),
          identity: r.npcTag, seed: r.id,
        });
        npc.upsertNpc(r.id, { attrs }); n++;
      }
    }
    if (n > 0) console.log(`[Attr] 机械生成六维(bioStrength引擎)：${n} 个NPC`);
  }

  /* 幸运·前端独占重算：幸运是「特殊属性」(不进六维预算/不算战力；diceEngine.luckMod 比的是相对六维均值)。
     基础幸运一律由前端按 NPC id 种子机械生成(常态 0~20 浮动；偶尔「天生幸运」随五维上下浮动可超 20；
     机械/虫群无命数≈0、亡灵/植物倒霉折半)，AI 给的绝对赋值忽略、只保留剧情 += / -=(累在 luckDelta)。
     每次正文/演化写完六维后 + 载入时各跑一次：把在场 NPC 的 attrs.luck 重置为 base+luckDelta（确定性·幂等）。 */
  function ensureNpcLuck() {
    const npc = useNpc.getState(); let n = 0;
    for (const r of Object.values(npc.npcs)) {
      if (r.isDead || !r.attrs) continue;   // 无六维者先由 autoGenMissingAttrs 生成，下一轮再算幸运
      const a = r.attrs;
      const cap = Math.max(20, attrCapForTier(r.realm));
      const base = generateLuck({
        mean5: (a.str + a.agi + a.con + a.int + a.cha) / 5,
        cap,
        form: `${r.npcTag ?? ''}${r.profession ?? ''}${(r as any).species ?? ''}${r.name ?? ''}`,
        themeText: `${r.profession ?? ''}${r.npcTag ?? ''}${r.unitType ?? ''}`,
        seed: r.id,
      });
      const want = Math.min(cap, Math.max(0, base + (r.luckDelta ?? 0)));
      if (a.luck !== want) { npc.upsertNpc(r.id, { attrs: { ...a, luck: want } }); n++; }
    }
    if (n > 0) console.log(`[Attr] 幸运·前端重算(base+delta)：${n} 个NPC`);
  }

  /* 前端机械·NPC 生命/能量上限（强制·覆盖 AI 写的 maxHp/maxMp）：按资质档(T0~T9)倍率把
     maxHp = 体质×20×倍率、maxMp = 智力×15×倍率（T4起翻倍，见 tierVitalMult）。满血/满蓝或未设→顶满到新上限；
     受伤(未满)→只钳上限不补血（与主角 HP 规则一致，不凭空回血）。仅对有六维(attrs)的 NPC 生效；确定性·幂等。 */
  function ensureNpcVitalsCap() {
    const npc = useNpc.getState(); let n = 0;
    for (const r of Object.values(npc.npcs)) {
      if (r.isDead || !r.attrs) continue;   // 无六维者先由 autoGenMissingAttrs 生成，下一轮再算上限
      const a = r.attrs;
      const mult = tierVitalMult(bioInnate(a, r.realm, lvFromRealm(r.realm))?.num ?? 0);
      const rmR = realAttrMult(r.realm, lvFromRealm(r.realm));   // 四阶起六维×5（与面板/战斗一致）
      const maxHp = Math.round(computeMaxHp(a, rmR, ratioOf(r)) * mult);
      const maxMp = Math.round(computeMaxEp(a, rmR, ratioOf(r)) * mult);
      const hpFull = (r.hp ?? 0) >= (r.maxHp ?? 0);   // 含未设(0)→视作满，顶满到新上限
      const epFull = (r.mp ?? 0) >= (r.maxMp ?? 0);
      const hp = hpFull ? maxHp : Math.min(r.hp ?? maxHp, maxHp);
      const mp = epFull ? maxMp : Math.min(r.mp ?? maxMp, maxMp);
      if (r.maxHp !== maxHp || r.maxMp !== maxMp || r.hp !== hp || r.mp !== mp) {
        npc.upsertNpc(r.id, { maxHp, maxMp, hp, mp }); n++;
      }
    }
    if (n > 0) console.log(`[Attr] HP/EP上限·前端按档位机械重算：${n} 个NPC`);
  }

  /* 抓取本回合精简快照，供「回合洞察」对比变化 */
  function captureTurnSnapshot() {
    try {
      const prof = usePlayer.getState().profile;
      const game = useGame.getState().player;
      const b1 = useCharacters.getState().characters['B1'];
      const mapSE = (list: any[]) => (list ?? []).map((e) => ({ name: e.name, type: e.type, effect: e.effect, source: e.source, desc: e.desc, durationDesc: e.durationDesc }));
      useTurnInsight.getState().pushSnapshot({
        turn: turnCountRef.current,
        time: Date.now(),
        worldName: useMisc.getState().worldName || '',
        player: (() => {
          // 上限走与面板/钳制一致的真实换算（体质×20 / 智力×15 + 装备/被动平值 + 百分比加成），勿用 gameStore 里滞后的 maxHp
          const maxHp = playerMaxHp(), maxMp = playerMaxEp();
          const it = useItems.getState();
          const equips = it.items.filter((i) => i.equipped).map((i) => ({ name: i.name, grade: i.gradeDesc, plus: i.enhanceLevel || 0 }));
          return {
            level: prof.level, attrs: { ...prof.attrs }, status: prof.status,
            statusEffects: mapSE(prof.statusEffects),
            hp: effectiveResource(game.hp, game.maxHp, maxHp), maxHp,
            mp: effectiveResource(game.mp, game.maxMp, maxMp), maxMp,
            skills: (b1?.skills ?? []).map((s) => s.name),
            titlesEquipped: (b1?.titles ?? []).find((t) => t.equipped)?.name,
            parkCoin: it.currency?.乐园币, soulCoin: it.currency?.灵魂钱币,
            equips,
          };
        })(),
        npcs: Object.fromEntries(Object.values(useNpc.getState().npcs).map((r) => [r.id, {
          name: r.name, favor: r.favor, status: r.status, motiveNow: r.motiveNow, realm: r.realm, onScene: r.onScene, statusEffects: mapSE(r.statusEffects ?? []),
        }])),
        factions: Object.fromEntries(Object.values(useFaction.getState().factions).map((f) => [f.id, {
          name: f.name, favorToPlayer: f.favorToPlayer, status: f.status, inCurrentWorld: f.inCurrentWorld,
          goal: f.goal, territory: f.territory, resources: f.resources, scale: f.scale, powerLevel: f.powerLevel, relations: f.relations, leader: f.leader,
        }])),
      });
    } catch (e) { console.warn('[Insight] 快照失败:', e); }
  }

  /* 取最近 N 回合正文拼接（read>1 时；末条用清洗后的当前正文）。供各演化"读取前N回合正文"设置使用。 */
  function buildRecentNarrative(latest: string, n: number): string {
    const k = Math.max(1, n || 1);
    if (k <= 1) return latest;
    const assistants = messagesRef.current.filter((m) => m.role === 'assistant').map((m) => String(m.content || ''));
    if (assistants.length === 0) return latest;
    const recent = assistants.slice(-k);
    recent[recent.length - 1] = latest;   // 当前回合用清洗后正文，确保一致
    return recent.map((c, i) => {
      const ago = recent.length - 1 - i;
      return `【${ago === 0 ? '本回合正文' : `前${ago}回合正文`}】\n${c}`;
    }).join('\n\n');
  }

  /* 在场/离场校正（兜底，解决"登场判断漏标 exits 导致离场B区一直空、离场角色不进档案"）：
     - 本轮正文提到姓名：离场角色→回到在场；在场角色→刷新出场回合。
     - 在场角色连续 ARCHIVE_AFTER 回合没在正文出现（且非羁绊/非手动保留）→ 自动归档到离场B区（仍在档案、可查看）。*/
  function reconcileScenePresence(narrative: string) {
    const npc = useNpc.getState();
    const turn = turnCountRef.current;
    const text = narrative || '';
    const ARCHIVE_AFTER = 2;
    for (const r of Object.values(npc.npcs)) {
      if (r.isDead || !r.name || r.name === r.id) continue;
      // 队友恒在场：随主角同行的队友若被（历史 bug 等）误判离场，对账时拉回在场——只有剧情明确离队 / leaveParty / 世界结束解散才真离场。
      if (r.partyMember && !r.onScene) { npc.setScene(r.id, true, turn); continue; }
      const nameKey = r.name.split('|')[0].trim();
      if (nameKey.length < 2) continue;                       // 单字名易误命中，跳过
      const mentioned = text.includes(nameKey);
      if (mentioned) {
        if (!r.onScene) npc.setScene(r.id, true, turn);       // 离场角色重新出现→回到在场
        else npc.upsertNpc(r.id, { lastSeenTurn: turn });
      } else if (r.onScene && !r.isBond && !r.keepForever && !r.partyMember) {
        // 豁免「随主角同行」的角色：羁绊/keepForever(助战)/队友——他们跟着主角走，正文不一定每回合点名，
        // 绝不能因 N 回合没被提名就自动判离场（队友只在剧情明确离队 / leaveParty 指令 / 世界结束解散时才离场）。
        const last = r.lastSeenTurn ?? turn;
        if (turn - last >= ARCHIVE_AFTER) npc.setScene(r.id, false);   // 久未出场→自动离场
        else if (r.lastSeenTurn == null) npc.upsertNpc(r.id, { lastSeenTurn: turn });
      }
    }
  }

  /* 清理"无名空壳"NPC：名字仍是占位ID且**毫无实质内容**（典型来源＝散落的 hp.C22 短指令把一个不存在的ID
     建成了"只有血条"的空壳，如 8/100·好感0·Lv.1）。严格判定：任何真实内容迹象（六维/阶位/背景/性格/称号/
     好感≠0/物品/技能天赋/羁绊·队友·好友·长期保留…）都保留。每回合在登场判断**之前**跑一次，清掉上一回合遗留的空壳。*/
  function pruneGhostNpcs(): number {
    const npc = useNpc.getState();
    const isGhost = (r: import('./store/npcStore').NpcRecord): boolean => {
      const placeholder = !r.name || r.name === r.id || /^[CG]\d+$/i.test(r.name);
      if (!placeholder) return false;
      // 自动生成的六维/血条/生图tag/生物强度**不算**真实身份——只有这些才保它：
      // 阶位带「身份」段(一阶|警员)、背景/性格/称号/职业/内心/关系/动机/目标/外观/上传头像、好感≠0、物品、技能天赋、羁绊队友好友长期保留。
      const realmId = (r.realm ?? '').includes('|') && (r.realm as string).split('|').slice(1).join('|').replace(/[·\s]/g, '').length > 0;
      if (realmId) return false;
      if (r.background || r.personality || r.title || r.profession || r.innerThought || r.relations ||
          r.motiveNow || r.shortGoal || r.longGoal || r.appearance5 || r.appearanceDetail || r.avatar) return false;
      if ((r.favor ?? 0) !== 0) return false;
      if ((r.items?.length ?? 0) > 0) return false;
      if (r.partyMember || r.isFriend || r.isBond || r.keepForever || r.contractorId || r.affiliatedTeam || r.isDead) return false;
      if (r.status && r.status !== '一切正常') return false;
      const cd = useCharacters.getState().characters[r.id];
      if ((cd?.skills?.length ?? 0) > 0 || (cd?.traits?.length ?? 0) > 0) return false;
      return true;   // 占位名 + 零真实身份（哪怕带自动生成的六维/血条）→ 空壳，清掉
    };
    const ghosts = Object.values(npc.npcs).filter(isGhost).map((r) => r.id);
    for (const id of ghosts) npc.hardRemoveNpc(id);   // hardRemoveNpc 会一并清掉 characterStore 里的孤儿数据
    if (ghosts.length) console.warn(`[NPC] 清理无名空壳 ${ghosts.length} 个: ${ghosts.join(', ')}`);
    return ghosts.length;
  }

  /* 选项/同人/事实/小剧场 共用判定上下文：主角全卡 + 在场 NPC 全信息 + (可选)当前任务 + 最近两回合正文 */
  function buildChoicesPhaseContext(text: string, includeQuest: boolean): string {
    const P = usePlayer.getState();
    const game = useGame.getState().player;
    const b1 = useCharacters.getState().characters['B1'];
    const playerCard = serializePlayerCard(
      P.profile, game, b1?.skills ?? [], b1?.traits ?? [], useItems.getState().items,
      { maxNpcs: 0, maxSkills: 99, maxItems: 99, maxSubProfs: 99 },
      b1?.titles, b1?.subProfessions, useItems.getState().currency,
      undefined, undefined, undefined, false, true,   // allItems=true：读全部物品栏（含效果），供「剧情选项」据能力/物品设计行动
    );
    const npcBlocks = Object.values(useNpc.getState().npcs)
      .filter((n) => n.onScene && !n.isDead)
      .map((r) => {
        const a = r.attrs;
        const bits = [
          `${r.name || r.id}${r.gender ? `(${r.gender})` : ''}`,
          r.npcTag && `标签:${r.npcTag}`, r.realm && `阶位/身份:${r.realm}`,
          r.profession && `职业:${r.profession}`, r.age && `年龄:${r.age}`,
          a && `六维:力${a.str} 敏${a.agi} 体${a.con} 智${a.int} 魅${a.cha} 幸${a.luck}`,
          r.personality && `性格:${r.personality}`, `好感:${r.favor}`,
          (r.items?.length ?? 0) > 0 && `持有物:${r.items.map((it) => `${it.name}(${it.category}${it.gradeDesc ? '·' + it.gradeDesc : ''})`).join('、')}`,
        ].filter(Boolean);
        return '· ' + bits.join(' | ');
      }).join('\n');
    // 当前任务（主线/支线）→ 供「任务导向」选项 A~D 生成（仅生成选项时才取）
    const questText = includeQuest ? serializeTasks(useMisc.getState().tasks ?? []) : '';
    const worldName = useMisc.getState().worldName || '';   // 当前世界名 → 供「原著接轨」判断是否已知原著并联网搜其剧情
    return [
      worldName ? `【当前世界】${worldName}（若为已知原著世界，按"原著接轨"要求联网搜其剧情、让选项接入原著剧情线）` : '',
      `【主角全部信息】\n${playerCard}`,
      `【在场角色全部信息（含持有物）】\n${npcBlocks || '（无）'}`,
      includeQuest ? `【当前任务（主线/支线 → 据此生成"任务导向"选项 A~D）】\n${questText}` : '',
      `【最近两回合正文】\n${buildRecentNarrative(text, 2).slice(-9000)}`,
    ].filter(Boolean).join('\n\n');
  }

  /* 选项 + 同人增强：正文生成后，共用一个 API、只调用一次，按开关产出 8 选项 / 同人设定块。
     direction：手动「重新生成」时玩家填的方向提示词（可空），作为最高优先的引导块注入。 */
  async function runChoicesFanficPhase(narrative: string, assistantMsgId?: number, direction?: string) {
    const ss = useSettings.getState();
    const wantChoices = ss.plotChoices, wantFanfic = ss.fanficMode, wantFact = ss.factCheck, wantTheater = ss.miniTheater;
    if (!wantChoices && !wantFanfic && !wantFact && !wantTheater) return;
    const text = (narrative || '').trim();
    if (!text) return;

    // 共用正文 API（featureKey 'plot'，未单独配路由则回退正文 API）；无可用接口则静默跳过
    const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
    const chain = resolveApiChain('plot', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return;

    const sysParts = [CHOICES_FANFIC_SYSTEM];
    if (wantFanfic) sysParts.push(FANFIC_RULE);
    if (wantFact) sysParts.push(FACT_RULE);
    if (wantChoices) sysParts.push(PLOT_CHOICES_RULE);
    if (wantTheater) {
      sysParts.push(MINI_THEATER_RULE);
      const picked = pickTheaterCharacters(await loadLunhuiCharacters());   // 从 wiki 人物条目随机抽 1~多位（多位则同世界·有关联）
      if (picked.length) sysParts.push(buildTheaterCharBlock(picked));
    }
    sysParts.push(`【本次输出顺序】${wantFanfic ? '先输出 <details>同人搜索内容</details> 块（涉及已知作品角色才输出，可多个）；' : ''}${wantFact ? '再输出 <details>事实查证</details> 块（涉及现实可查证元素才输出）；' : ''}${wantChoices ? '然后输出 <choices> 块（A~H 共 8 个选项）；' : ''}${wantTheater ? '最后输出 <xiaojuchang> 小剧场块（严格按「小剧场世界书」的 HTML/内联 CSS 折叠格式，与主线无关的番外彩蛋）。' : ''}除这些标签块外不要有任何其它文字。`);
    // 手动「重新生成」：玩家自定义方向（最高优先），并要求与上一版明显不同
    const dir = (direction || '').trim();
    if (dir) sysParts.push(`【本次为"重新生成"·玩家自定义方向（最高优先）】请在严格遵守上面各块的全部规则与格式（含各块各自的字数要求）的前提下，让本次产出整体贴合以下方向 / 侧重，并给出与之前明显不同的新内容、不要重复上一版：\n${dir}`);

    // 判定上下文：主角全卡(含物品) + 在场 NPC 全信息(含持有物) + (选项时)当前任务 + 最近两回合正文
    const userMsg = buildChoicesPhaseContext(text, wantChoices);

    setChoicesRunning(true);
    try {
      const { content } = await apiChatFallback(chain, [
        { role: 'system', content: sysParts.join('\n\n') },
        { role: 'user', content: userMsg },
      ], { timeoutMs: wantTheater ? 180000 : 140000, extra: { temperature: wantTheater ? 1.0 : 0.9, max_tokens: wantTheater ? 9000 : 6000 } });

      if (wantChoices) {
        const opts = parseChoices(content);
        if (opts.length && assistantMsgId != null) {
          setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? { ...m, choices: opts } : m)));
        }
      }
      if (wantFanfic) {
        const parsed = parseFanficDetails(content);
        if (parsed) {
          if (assistantMsgId != null) setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? { ...m, fanficNote: parsed.note } : m)));
          parsed.entries.forEach((e) => useFanfic.getState().upsert(e));
        }
      }
      if (wantFact) {
        const parsed = parseFactCheck(content);
        if (parsed) {
          if (assistantMsgId != null) setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? { ...m, factNote: parsed.note } : m)));
          if (parsed.anchors.length) useFact.getState().add(parsed.anchors);
        }
      }
      if (wantTheater) {
        const html = parseTheater(content);
        if (html && assistantMsgId != null) setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? { ...m, theaterHtml: html } : m)));
      }
    } catch (e) {
      console.warn('[选项/同人/事实/小剧场] 生成失败', e);
    } finally {
      setChoicesRunning(false);
    }
  }

  /* ════════════════════════════════════════════
     战斗系统编排器（仿 fanren 四阶段：battleData→npcAction→result→summary）。
     结算走 combatEngine（骰子引擎确定性），AI 只编排/决策/叙事/总结。响应式驱动见上方 useEffect。
  ════════════════════════════════════════════ */

  /* ════════════════════════════════════════════
     竞技场编排：排行榜（带记忆）/ 对手建档（≥6装备·≥4技能·≥4天赋）/ 胜利结算（取代名次+前100奖励+击败记录）
  ════════════════════════════════════════════ */
  function arenaChain() {
    const ss = useSettings.getState();
    const A = useArena.getState();
    const legacy = A.arenaUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : A.arenaApi;
    return resolveApiChain('arena', legacy);
  }
  // 从 AI 输出稳健抽取 JSON 数组（去 ``` 围栏 + 截取 [..]）
  const parseArenaArray = (content: string): any[] => {
    let t = (content || '').replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim()   // 先剥思维链，避免 think 里的方括号被当成数组边界
      .replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const i = t.indexOf('['); const j = t.lastIndexOf(']');
    if (i >= 0 && j > i) t = t.slice(i, j + 1);
    const v = lenientJsonParse(t);
    return Array.isArray(v) ? v : [];
  };
  const arenaGradeForRank = (rank: number) => (rank <= 10 ? '淡金' : rank <= 50 ? '紫色' : rank <= 200 ? '蓝色' : '绿色');
  const arenaSkillRarity = (rank: number) => (rank <= 10 ? '天阶' : rank <= 50 ? '地阶' : rank <= 200 ? '玄阶' : '黄阶');
  const arenaTraitRarity = (rank: number) => (rank <= 10 ? 'SS' : rank <= 50 ? 'S' : rank <= 200 ? 'A' : 'B');

  // 对手物品：保证 ≥6 件且 ≥6 件已装备（AI 不足则确定性补足）
  function ensureArenaItems(cid: string, raw: any[], entry: ArenaLadderEntry) {
    const npc = useNpc.getState();
    const armorParts = ['armor:upper', 'armor:inner', 'armor:head', 'armor:lower', 'armor:feet', 'armor:hands', 'armor:arms', 'armor:shoulder', 'armor:belt'];
    const grade = arenaGradeForRank(entry.rank);
    const list = raw.slice(0, 10).map((it: any) => ({
      name: flattenAiText(it.name).slice(0, 40), category: String(it.category || '特殊物品'),
      gradeDesc: flattenAiText(it.gradeDesc || it.grade) || grade, effect: flattenAiText(it.effect),
      equipped: !!it.equipped, combatStat: flattenAiText(it.combatStat || it.attack || it.defense) || undefined,
      appearance: flattenAiText(it.appearance) || undefined,
    })).filter((it) => it.name);
    const fillers = [
      { name: '竞技战甲', category: '防具', effect: '防御大幅提升、受伤减免', combatStat: '防御 120-160' },
      { name: '契约者佩剑', category: '武器', effect: '攻击力显著加成', combatStat: '攻击 140-180' },
      { name: '强者护符', category: '饰品', effect: '全属性+10%' },
      { name: '乐园战靴', category: '防具', effect: '敏捷+18、闪避+8%', combatStat: '防御 40-60' },
      { name: '秘宝法器', category: '法宝', effect: '每回合回能、技能威力+15%' },
      { name: '淬体腰带', category: '防具', effect: '体质+20、受伤减免', combatStat: '防御 50-70' },
    ];
    let fi = 0;
    while (list.length < 6 && fi < fillers.length) {
      const f = fillers[fi++];
      if (!list.some((x) => x.name === f.name)) list.push({ name: f.name, category: f.category, gradeDesc: grade, effect: f.effect, equipped: false, combatStat: (f as any).combatStat, appearance: undefined });
    }
    let wN = 0, aN = 0, cN = 0, tN = 0, equippedCount = 0;
    list.forEach((it, idx) => {
      let equipSlot: string | undefined;
      const key = it.category + it.name;
      if (it.equipped || equippedCount < 6) {
        if (/武器|剑|刀|枪|弓|杖/.test(key) && wN < 2) { equipSlot = wN === 0 ? 'weapon:main' : `weapon:off${wN}`; wN++; }
        else if (/防具|护甲|衣|甲|靴|腰带|战甲/.test(key)) { equipSlot = armorParts[Math.min(aN, armorParts.length - 1)]; aN++; }
        else if (/饰品|戒指|项链|护符|符/.test(key)) { equipSlot = `accessory:#${++cN}`; }
        else if (/法宝/.test(it.category) || equippedCount < 6) { equipSlot = `treasure:#${++tN}`; }
        if (equipSlot) equippedCount++;
      }
      npc.addNpcItem(cid, {
        id: `I_${cid}_${(idx + 1).toString().padStart(2, '0')}`, name: it.name, category: it.category,
        gradeDesc: it.gradeDesc, effect: it.effect, quantity: 1, equipped: !!equipSlot, equipSlot,
        combatStat: it.combatStat, appearance: it.appearance, acquisition: '竞技对手初始装备', tags: ['竞技'], addedAt: Date.now(),
      });
    });
  }
  // 对手技能（≥4）
  function ensureArenaSkills(cid: string, raw: any[], entry: ArenaLadderEntry) {
    const ch = useCharacters.getState();
    const list = raw.slice(0, 8).map((s: any) => ({
      name: flattenAiText(s.name).slice(0, 30), level: flattenAiText(s.level) || '精通·Lv.1',
      skillType: flattenAiText(s.skillType || s.type) || '主动', rarity: flattenAiText(s.rarity) || arenaSkillRarity(entry.rank),
      effect: flattenAiText(s.effect) || '造成可观伤害', desc: flattenAiText(s.desc) || '',
    })).filter((s) => s.name);
    const fillers = [
      { name: '裂空斩', skillType: '主动', effect: '对单体造成 180% 物理伤害' },
      { name: '秘能护盾', skillType: '主动', effect: '生成吸收 200 点伤害的护盾，持续2回合' },
      { name: '疾影突袭', skillType: '主动', effect: '位移并造成 140% 伤害，附眩晕1回合' },
      { name: '强者领域', skillType: '领域', effect: '展开领域，每回合对敌方造成 60 点伤害并降其10%攻击' },
    ];
    let fi = 0;
    while (list.length < 4 && fi < fillers.length) { const f = fillers[fi++]; if (!list.some((x) => x.name === f.name)) list.push({ name: f.name, level: '精通·Lv.1', skillType: f.skillType, rarity: arenaSkillRarity(entry.rank), effect: f.effect, desc: '' }); }
    list.slice(0, 8).forEach((s, idx) => ch.addSkill(cid, { id: `S_${cid}_${(idx + 1).toString().padStart(2, '0')}`, name: s.name, level: s.level, desc: s.desc, effect: s.effect, skillType: s.skillType, rarity: s.rarity }));
  }
  // 对手天赋（≥4）
  function ensureArenaTraits(cid: string, raw: any[], entry: ArenaLadderEntry) {
    const ch = useCharacters.getState();
    const list = raw.slice(0, 8).map((t: any) => ({
      name: flattenAiText(t.name).slice(0, 30), rarity: flattenAiText(t.rarity) || arenaTraitRarity(entry.rank),
      effect: flattenAiText(t.effect) || '属性显著增强', desc: flattenAiText(t.desc) || '',
    })).filter((t) => t.name);
    const fillers = [
      { name: '力量之心', effect: '力量+25%' }, { name: '战斗直觉', effect: '闪避+12%、暴击+10%' },
      { name: '不灭体魄', effect: '体质+30%，受伤减免8%' }, { name: '能量亲和', effect: '技能消耗-20%，能量回复+15%' },
    ];
    let fi = 0;
    while (list.length < 4 && fi < fillers.length) { const f = fillers[fi++]; if (!list.some((x) => x.name === f.name)) list.push({ name: f.name, rarity: arenaTraitRarity(entry.rank), effect: f.effect, desc: '' }); }
    list.slice(0, 8).forEach((t) => ch.addTrait(cid, { name: t.name, rarity: t.rarity, effect: t.effect, desc: t.desc }));
  }

  // ① 排行榜：据 ranks 生成 50 人榜，主角行用真实身份覆盖；写入 store（缓存=记忆）
  async function runArenaLadderPhase(arenaId: string, def: ArenaDefType, ranks: number[], windowKey: string): Promise<void> {
    const A = useArena.getState();
    const seeded = A.ensureLadder(arenaId, ranks[Math.floor(ranks.length / 2)] || 1000);
    const prof = usePlayer.getState().profile;
    const pTier = arenaEffectiveTier(prof.tier, prof.level);
    const playerRank = seeded.playerRank;
    const kindText = def.kind === 'tree' ? '树之竞技场(跨乐园/虚空/超脱·七阶+)' : def.kind === 'championship' ? '强者争霸战(跨乐园顶级赛事)' : '乐园内部竞技场';
    const user = `# 竞技场信息\n名称：${def.name}\n类型：${kindText}\n主角阶位：${pTier}\n\n# 待生成名次列表\n${ranks.join('、')}`;
    let entries: ArenaLadderEntry[] = [];
    try {
      const { content } = await apiChatFallback(arenaChain(), [{ role: 'system', content: ARENA_LADDER_RULE }, { role: 'user', content: user }], { timeoutMs: 60000 });
      const arr = parseArenaArray(content);
      if (arr.length) {
        const byRank = new Map<number, any>();
        for (const x of arr) { const r = parseInt(String(x?.rank), 10); if (r > 0 && !byRank.has(r)) byRank.set(r, x); }
        entries = ranks.map((r) => {
          const x = byRank.get(r) || {};
          return {
            rank: r, name: flattenAiText(x.name).slice(0, 24) || `契约者#${r}`, tier: flattenAiText(x.tier).slice(0, 12) || pTier,
            job: flattenAiText(x.job).slice(0, 16), strength: flattenAiText(x.strength).slice(0, 16),
            persona: flattenAiText(x.persona).slice(0, 16) || undefined, badge: ladderBadge(def.kind, r),
          } as ArenaLadderEntry;
        });
      }
    } catch (e) { console.warn('[Arena] 榜单生成失败:', e); }
    if (entries.length === 0) entries = ranks.map((r) => ({ rank: r, name: `契约者#${r}`, tier: prof.tier || '', job: '', strength: '', badge: ladderBadge(def.kind, r) }));
    for (const e of entries) {
      if (e.rank === playerRank) { e.isPlayer = true; e.name = prof.name || '我'; e.tier = pTier; e.job = prof.profession || e.job; e.strength = prof.bioStrength || e.strength; e.badge = ladderBadge(def.kind, e.rank); }
    }
    A.setEntries(arenaId, entries, windowKey);
    if (playerRank <= 50 && windowKey === 'home') A.setTop50(arenaId, entries.filter((e) => e.rank <= 50));
    usePlayer.getState().setProfile({ arenaRank: `${def.name}·第${playerRank}名` });
  }

  // ② 挑战对手建档（≥6装备·≥4技能·≥4天赋），返回临时对手 C-id
  async function genArenaOpponent(def: ArenaDefType, entry: ArenaLadderEntry): Promise<string | null> {
    const npc = useNpc.getState();
    const prof = usePlayer.getState().profile;
    const cid = npc.createArchivedContractor({ name: entry.name, tier: entry.tier, job: entry.job, persona: entry.persona, strength: entry.strength, tag: '竞技对手' });
    const user = `# 对手信息\n名号：${entry.name}\n阶位：${entry.tier}\n职业：${entry.job || '—'}\n生物强度：${entry.strength || '—'}\n竞技场名次：第${entry.rank}名（${def.name}）\n\n# 主角阶位\n${arenaEffectiveTier(prof.tier, prof.level)}（主角名次 #${useArena.getState().ladders[def.id]?.playerRank ?? '—'}）`;
    let j: any = {};
    try {
      const { content } = await apiChatFallback(arenaChain(), [{ role: 'system', content: ARENA_OPPONENT_RULE + '\n' + EQUIP_CODEX }, { role: 'user', content: user }], { timeoutMs: 75000 });
      j = parseEntryJson(content) || lenientJsonParse(content) || {};
    } catch (e) { console.warn('[Arena] 对手建档失败:', e); }
    const a = (v: any, d = 30) => Math.max(1, Math.min(99, parseInt(String(v), 10) || d));
    const patch: any = { isDead: false, onScene: true, npcTag: '竞技对手', arenaRank: `${def.name}·第${entry.rank}名` };
    patch.realm = stripDeadWords(flattenAiText(j.realm)).slice(0, 60) || `${entry.tier}|${entry.job || '竞技强者'}`;
    if (j.personality) patch.personality = flattenAiText(j.personality).slice(0, 300);
    if (j.appearance) patch.appearance5 = flattenAiText(j.appearance).slice(0, 300);
    patch.attrs = j.attrs && typeof j.attrs === 'object'
      ? { str: a(j.attrs.str), agi: a(j.attrs.agi), con: a(j.attrs.con), int: a(j.attrs.int), cha: a(j.attrs.cha), luck: a(j.attrs.luck) }
      : { str: 35, agi: 30, con: 40, int: 25, cha: 15, luck: 10 };
    npc.upsertNpc(cid, patch);
    ensureArenaItems(cid, Array.isArray(j.items) ? j.items.filter((it: any) => it && it.name) : [], entry);
    ensureArenaSkills(cid, Array.isArray(j.skills) ? j.skills : [], entry);
    ensureArenaTraits(cid, Array.isArray(j.traits) ? j.traits : [], entry);
    return cid;
  }

  // ③ 点对手：先建其完整面板（不开战），返回 cid 供 ArenaPanel 展示
  async function scoutArenaOpponent(def: ArenaDefType, entry: ArenaLadderEntry): Promise<string | null> {
    return await genArenaOpponent(def, entry);
  }
  // 丢弃未挑战的临时对手（关闭详情 / 关面板时）
  function discardArenaOpponent(cid: string) {
    try { useCharacters.getState().removeCharacter(cid); useNpc.getState().hardRemoveNpc(cid); } catch { /* */ }
  }
  // 清扫残留的竞技对手（兜底：异常中断/崩溃留下的孤儿）——保留正在战斗的那个
  function sweepArenaOpponents() {
    const npcs = useNpc.getState().npcs;
    const keep = useArena.getState().pendingChallenge?.opponentCid;
    for (const id of Object.keys(npcs)) {
      if (npcs[id]?.npcTag === '竞技对手' && id !== keep) {
        try { useCharacters.getState().removeCharacter(id); useNpc.getState().hardRemoveNpc(id); } catch { /* */ }
      }
    }
  }
  // 用已建好的对手发起挑战 → 记录待结算 → 进战斗
  function startArenaBattleWith(def: ArenaDefType, entry: ArenaLadderEntry, cid: string) {
    const C = useCombat.getState();
    if (C.battle.active) { discardArenaOpponent(cid); return; }
    // 清理上一次异常残留的临时对手（弃战未结算），避免孤儿累积
    const stale = useArena.getState().pendingChallenge;
    if (stale && stale.opponentCid !== cid) {
      try { useCharacters.getState().removeCharacter(stale.opponentCid); useNpc.getState().hardRemoveNpc(stale.opponentCid); } catch { /* */ }
      useArena.getState().setPendingChallenge(null);
    }
    useArena.getState().setPendingChallenge({
      arenaId: def.id, arenaName: def.name, opponentCid: cid, targetRank: entry.rank,
      opponent: { name: entry.name, tier: entry.tier, job: entry.job, strength: entry.strength, persona: entry.persona, rank: entry.rank },
    });
    startCombatWithSelection({ enemyIds: [cid], allyIds: [] });
  }

  /* ════════════════════════════════════════════
     赌场·角斗场：一次 API 生成两名角斗士 + 专家评估（赔率前端算）；下注后据预定胜者生成数据化分回合战斗
  ════════════════════════════════════════════ */
  function casinoChain() {
    const ss = useSettings.getState();
    const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;   // 赌坊无专用路由时回退到正文/共享 API
    return resolveApiChain('casino', legacy);
  }
  // ── 深渊地牢 AI 生成（铁则：AI 只挑原语/档位/文案，数值前端定；失败回退由调用方处理）──
  function abyssChain(key: string) {
    const ss = useSettings.getState();
    const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
    return resolveApiChain(key, legacy);   // 无专用路由→回退正文/共享 API
  }
  async function genAbyssBoons(ctx: BoonGenContext): Promise<AbyssBoonCard[]> {
    // 只读主角 kit（技能/天赋/职业/副职业）供生成「契合卡」——绝不写回真实面板（隔离）
    const prof = usePlayer.getState().profile;
    const b1 = useCharacters.getState().characters['B1'];
    const skillNames = (b1?.skills ?? []).map((s) => s.name).filter(Boolean).slice(0, 12);
    const traitNames = (b1?.traits ?? []).map((t) => t.name).filter(Boolean).slice(0, 12);
    const subProfNames = (b1?.subProfessions ?? []).map((p: any) => p.name).filter(Boolean).slice(0, 6);
    const kit = `职业：${prof.profession || '（无）'}\n技能：${skillNames.join('、') || '（无）'}\n天赋：${traitNames.join('、') || '（无）'}\n副职业：${subProfNames.join('、') || '（无）'}`;
    const user = `# 当前阶段\n险地#${ctx.biome} · 第 ${ctx.floor} 层 · 堕落 Lv${ctx.fallLevel}\n# 主角 kit（据此出 1-2 张契合卡）\n${kit}\n# 已选卡组（流派:卡名）\n${ctx.deck.map((d) => `${d.school}:${d.name}`).join('、') || '（空）'}\n# 偏向流派（堕落星图，优先多给这些）\n${ctx.affinity.join('、') || '（无）'}\n# 需要张数\n${ctx.want}\n# PRIMS（效果只能从此选）\n${BOON_PRIM_LIST.join(', ')}\n# SCHOOLS\n${BOON_SCHOOLS.join(', ')}`;
    try {
      const { content } = await apiChatFallback(abyssChain('abyss'), [{ role: 'system', content: ABYSS_BOON_GEN_RULE }, { role: 'user', content: user }], { timeoutMs: 60000 });
      const m = content.match(/\[[\s\S]*\]/);
      const arr = m ? lenientJsonParse(m[0]) : null;
      return materializeBoons(arr, ctx.depth);
    } catch (e) { console.warn('[Abyss] 加成卡生成失败:', e); return []; }
  }
  async function genAbyssSin(template: SinTemplate): Promise<SinFlavor | null> {
    const skeleton = { quality: template.quality, type: `${template.category}/${template.sub}`, biome: '黑渊', stats: template.stats, active: template.active, passive: template.passive, curse: template.curse };
    const user = `# 机械骨架（只配文，严禁改数值/改效果）\n${JSON.stringify(skeleton)}`;
    try {
      const { content } = await apiChatFallback(abyssChain('abyss'), [{ role: 'system', content: ABYSS_SIN_GEN_RULE + '\n' + EQUIP_CODEX }, { role: 'user', content: user }], { timeoutMs: 60000 });
      const m = content.match(/\{[\s\S]*\}/);
      const obj = m ? lenientJsonParse(m[0]) : null;
      return obj && typeof obj === 'object' ? obj as SinFlavor : null;
    } catch (e) { console.warn('[Abyss] 原罪物配文失败:', e); return null; }
  }
  async function genAbyssAwaken(item: { name: string; category: string; subType?: string; affix?: string; awakenLv?: number }): Promise<AwakenFlavor | null> {
    const ctx = { item: { name: item.name, type: item.category + (item.subType ? '/' + item.subType : ''), 已有词缀: item.affix || '（无）' }, awakenLv: (item.awakenLv ?? 0) + 1 };
    const user = `# 装备/原罪物（只配文+加1条新词缀，严禁改已有数值）\n${JSON.stringify(ctx.item)}\n# 觉醒后阶数\n${ctx.awakenLv}\n# PRIMS（新效果只能从此选）\n${BOON_PRIM_LIST.join(', ')}`;
    try {
      const { content } = await apiChatFallback(abyssChain('abyss'), [{ role: 'system', content: ABYSS_AWAKEN_RULE }, { role: 'user', content: user }], { timeoutMs: 60000 });
      const m = content.match(/\{[\s\S]*\}/);
      const obj = m ? lenientJsonParse(m[0]) : null;
      return obj && typeof obj === 'object' ? obj as AwakenFlavor : null;
    } catch (e) { console.warn('[Abyss] 觉醒配文失败:', e); return null; }
  }
  async function genAbyssJudge(options: { id: string; label: string }[]): Promise<JudgeFlavor | null> {
    const user = `# 选项倾向（同序同数配文）\n${JSON.stringify({ options })}`;
    try {
      const { content } = await apiChatFallback(abyssChain('abyss'), [{ role: 'system', content: ABYSS_JUDGE_RULE }, { role: 'user', content: user }], { timeoutMs: 60000 });
      const m = content.match(/\{[\s\S]*\}/);
      const obj = m ? lenientJsonParse(m[0]) : null;
      return obj && typeof obj === 'object' ? obj as JudgeFlavor : null;
    } catch (e) { console.warn('[Abyss] 裁判剧情局配文失败:', e); return null; }
  }
  async function genAbyssEnemies(ctx: { biome: number; biomeName: string; kind: 'elite' | 'boss'; depth: number; floor: number; seed: string }): Promise<AbyssEnemyUnit[] | null> {
    const user = `# 险地\n${ctx.biomeName}（#${ctx.biome}）· 全局第 ${ctx.depth} 层 · 本险地第 ${ctx.floor} 层\n# 强度档\n${ctx.kind === 'boss' ? '区主（强，1 只，可带 count 杂兵）' : '精英（1-2 只）'}`;
    try {
      const { content } = await apiChatFallback(abyssChain('abyss'), [{ role: 'system', content: ABYSS_ENEMY_GEN_RULE }, { role: 'user', content: user }], { timeoutMs: 60000 });
      const m = content.match(/\[[\s\S]*\]/);
      const arr = m ? lenientJsonParse(m[0]) : null;
      return panelToEnemies(arr, ctx.depth, ctx.seed);
    } catch (e) { console.warn('[Abyss] 敌人面板生成失败:', e); return null; }
  }
  const GLAD_SKILL_FILLERS = [
    { name: '裂空斩', effect: '挥刃斩出三道真空刃，对正面直线敌人造成 160% 物理伤害，命中后附加 2 回合「破甲」(防御−15%)' },
    { name: '守势架挡', effect: '举盾进入防御姿态，本回合受到的物理伤害减免 60%，并反弹其中 20% 给攻击者' },
    { name: '疾影突进', effect: '瞬步位移至目标身侧 8 米，打断其蓄力并造成 120% 伤害，自身获得 1 回合「先手」' },
    { name: '狂战乱舞', effect: '连续劈砍 4~6 段，每段 45% 伤害，每命中一次自身攻击力叠加 5%(最多 5 层)' },
    { name: '破绽反震', effect: '被攻击后瞬间反震，将所受伤害的 35% 弹回对手，并使其下回合命中率降低 10%' },
    { name: '聚气重击', effect: '蓄力 1 回合，下回合释放 280% 力量伤害的毁灭一击，命中必定击退并附 1 秒眩晕' },
    { name: '战吼震慑', effect: '发出震慑战吼，全场敌人攻击力降低 18%、持续 2 回合，并有 50% 几率陷入 1 回合恐惧' },
    { name: '血战狂暴', effect: '生命低于 40% 时进入狂暴，攻击力提升 40%、攻速提升 25%，但受到伤害增加 10%，持续 3 回合' },
    { name: '领域·裁决', effect: '展开裁决领域笼罩全场 3 回合，期间每回合对敌方造成 60 点真实伤害并压制其 15% 闪避' },
    { name: '奥义·灭杀', effect: '倾尽全力的奥义斩，消耗 50% 能量造成 350% 力量伤害，对生命低于 25% 的目标直接处决' },
    { name: '残影分身', effect: '留下三道残影迷惑对手，规避接下来 2 次攻击，并在下次出手时获得 30% 暴击率加成' },
    { name: '破甲穿刺', effect: '凝力一刺，无视目标 50% 防御造成 150% 伤害，命中后留下「裂创」每回合流失 3% 生命' },
  ];
  const GLAD_ITEM_FILLERS = [
    { name: '淬毒短匕', effect: '攻击时 25% 几率附加剧毒，每回合损失 4% 生命、持续 3 回合，可叠加 2 层' },
    { name: '护体重甲', effect: '提供 80 点物理防御，受到的暴击伤害降低 30%，生命低于 30% 时额外减伤 15%' },
    { name: '疾风战靴', effect: '闪避率提升 12%、先手值提升 20，每回合自动恢复 5 点能量' },
    { name: '回春丹', effect: '立即服下，瞬间回复 150 点生命，并在之后 2 回合每回合再生 40 点' },
    { name: '爆裂符', effect: '掷出引爆，对半径 5 米内敌人造成 130% 法术范围伤害并附 1 回合灼烧' },
    { name: '护身玉符', effect: '受到致命伤时自动碎裂，免疫该次伤害并回复 20% 生命，每场限一次' },
    { name: '蕴能法宝', effect: '蓄力一回合后释放，造成 220% 法术伤害的爆发一击，命中驱散对方一个增益' },
    { name: '净化香囊', effect: '立即解除自身全部减益状态，并在 2 回合内免疫中毒、灼烧、流血' },
    { name: '虚空披风', effect: '短暂隐遁 1 回合，期间无法被锁定，脱离时下次攻击必定暴击' },
    { name: '本命战旗', effect: '插旗鼓舞，自身全属性提升 12%、持续 4 回合，旗帜被摧毁则效果中断' },
    { name: '残魂宝珠', effect: '濒死(生命≤15%)时自动触发，回复 30% 生命并对最近敌人反击 100% 伤害' },
    { name: '镇魂符箓', effect: '抵御精神冲击，免疫接下来 2 次控制效果(眩晕/恐惧/魅惑)，并降低受到的法术伤害 20%' },
  ];
  const GLAD_TALENT_FILLERS = [
    { name: '力拔山兮', effect: '天生神力，力量提升 25%，普通攻击有 15% 几率造成双倍伤害' },
    { name: '疾如奔雷', effect: '身法卓绝，敏捷提升 20%、闪避提升 10%，每回合首次受击必定闪避' },
    { name: '不屈之躯', effect: '体质强化，受到伤害减免 12%，且生命不会因单次伤害低于 1(每场一次)' },
    { name: '战斗直觉', effect: '临战嗅觉敏锐，暴击率提升 12%、闪避提升 8%，对蓄力技能伤害减免 20%' },
    { name: '血脉觉醒', effect: '濒死时血脉觉醒，生命低于 30% 时攻击力提升 30%、攻速提升 15%' },
    { name: '万法亲和', effect: '亲和万法，技能威力提升 18%、能量回复提升 25%，技能消耗降低 15%' },
  ];
  const padNamed = (list: { name: string; effect: string }[], fillers: { name: string; effect: string }[], min: number) => {
    const out = [...list]; let i = 0;
    while (out.length < min && i < fillers.length) { const f = fillers[i++]; if (!out.some((x) => x.name === f.name)) out.push({ ...f }); }
    return out;
  };
  const mapNamed = (raw: any, cap: number) => (Array.isArray(raw) ? raw : []).slice(0, cap)
    .map((s: any) => ({ name: flattenAiText(s?.name).slice(0, 24), effect: flattenAiText(s?.effect).slice(0, 120) }))
    .filter((s: any) => s.name);
  function mkGladiator(f: any, pTier: string, tierNum = 1): Gladiator {
    // 数量下限随阶位递增（一阶 技5/天1/物6 … 七阶 技11/天6/物12），仅作兜底地板；真实数量由 AI 决定
    const tn = Math.max(1, Math.min(7, tierNum));
    const minSkills = 4 + tn, minItems = 5 + tn, minTalents = Math.max(1, tn - 1);
    const lvDefault = (tn - 1) * 10 + 5;   // 落在该阶位等级区间中段
    const name = flattenAiText(f?.name).slice(0, 24) || '无名角斗士';
    const race = flattenAiText(f?.race).slice(0, 16) || '人类';
    const tier = flattenAiText(f?.tier).slice(0, 12) || pTier;
    const level = Math.max(1, Math.min(140, parseInt(String(f?.level), 10) || lvDefault));
    const profession = flattenAiText(f?.profession).slice(0, 20) || '角斗士';
    const rareProfession = f?.rareProfession === true || /稀有|隐藏|传说/.test(flattenAiText(f?.profession));
    const bioStrength = flattenAiText(f?.bioStrength).slice(0, 16) || `T${Math.min(9, tn)}·勇士`;
    // 六维：复用 NPC 机械生成（生物强度档 + 阶位 + 职业排序 + 种族形态压制 + 等级成长），治 AI 乱给离谱属性、与强度自洽
    const attrs = generateNpcAttrs({ tier, level, bioTier: bioStrength, job: profession, form: race, seed: `glad_${name}_${bioStrength}_${tier}` });
    return {
      name, race, tier, level, profession, rareProfession, bioStrength,
      gender: flattenAiText(f?.gender).slice(0, 4) || '男',
      style: flattenAiText(f?.style).slice(0, 40) || '全能战士',
      appearance: flattenAiText(f?.appearance).slice(0, 200),
      imagePrompt: flattenAiText(f?.imagePrompt).slice(0, 400) || undefined,
      attrs,
      skills: padNamed(mapNamed(f?.skills, 16), GLAD_SKILL_FILLERS, minSkills),
      talents: padNamed(mapNamed(f?.talents, 12), GLAD_TALENT_FILLERS, minTalents),
      items: padNamed(mapNamed(f?.items, 18), GLAD_ITEM_FILLERS, minItems),
      hpMax: Math.max(100, attrs.con * 20),
    };
  }
  const mkGladEval = (e: any): GladiatorEval => ({
    strengths: flattenAiText(e?.strengths).slice(0, 160) || '攻守均衡，无明显短板。',
    weaknesses: flattenAiText(e?.weaknesses).slice(0, 160) || '暂未观察到致命破绽。',
    comment: flattenAiText(e?.comment).slice(0, 200) || '势均力敌，胜负在毫厘之间。',
    verdict: flattenAiText(e?.verdict).slice(0, 80) || '不到终局，难分高下。',
  });
  // ① 生成对战：一次调用出两名角斗士 + 评估，前端算赔率（races 可由玩家自定义）
  async function genGladiatorMatch(kind: 'normal' | 'soul', races?: [string, string], tierLo = 1, tierHi = 4): Promise<GladiatorMatch | null> {
    // 双方阶位随机但一致：在 [tierLo, tierHi] 内掷一个，两人都用它
    const lo = Math.max(1, Math.min(tierLo, tierHi)), hi = Math.min(13, Math.max(tierLo, tierHi));
    const tierNum = lo + Math.floor(Math.random() * (hi - lo + 1));
    const battleTier = TIERS[tierNum - 1] || '一阶';
    const raceEntities = useCosmos.getState().entities.filter((e) => e.category === '种族' && !e.destroyed).map((e) => e.name).filter(Boolean);
    const racePool = (raceEntities.length ? raceEntities.slice(0, 24) : ['羽族', '恶魔族', '龙族', '精灵', '兽人', '不死族', '机械体', '虚空魔裔', '星灵', '深渊爬虫']).join('、');
    const customRace = races && (races[0]?.trim() || races[1]?.trim())
      ? `\n\n# 指定种族（必须严格采用）\n一号位：${races[0]?.trim() || '（不限，你来定）'}\n二号位：${races[1]?.trim() || '（不限，你来定）'}`
      : '';
    const user = `# 可用种族池\n${racePool}\n\n# 对战阶位（两名角斗士的 tier 都必须等于此阶位；阶位越高技能/天赋/物品越多越离谱）\n${battleTier}${customRace}`;
    let j: any = {};
    try {
      const { content } = await apiChatFallback(casinoChain(), [{ role: 'system', content: GLADIATOR_MATCH_RULE + '\n' + EQUIP_CODEX }, { role: 'user', content: user }], { timeoutMs: 75000 });
      j = parseEntryJson(content) || lenientJsonParse(content) || {};
    } catch (e) { console.warn('[Casino] 角斗士生成失败:', e); }
    let fs = Array.isArray(j?.fighters) ? j.fighters : [];
    const es = Array.isArray(j?.evals) ? j.evals : [];
    if (fs.length < 2) {
      // 兜底：AI 失败也给一对可下注的角斗士（技能/天赋/物品由 mkGladiator 按阶位补足下限），功能不死锁；指定种族/阶位也尊重
      fs = [
        { name: '铁壁拉戈', race: races?.[0]?.trim() || '兽人', tier: battleTier, gender: '男', style: '重甲铁壁·消耗', profession: '重盾卫士', appearance: '魁梧厚重的重甲战士，覆甲持盾、伤疤遍布，立如磐石', imagePrompt: '1boy, huge, muscular, heavy plate armor, tower shield, battle scars, stern face, dark fantasy, dynamic pose', attrs: { str: 42, agi: 22, con: 48, int: 20, cha: 14, luck: 12 }, skills: [{ name: '巨盾突进', effect: '举盾冲撞 8 米，对沿途敌人造成 140% 力量伤害并击退，命中附 1 回合眩晕' }, { name: '铁骨横封', effect: '硬化筋骨，本回合受到的物理伤害减免 50%，并免疫击退与位移效果' }], talents: [{ name: '不屈之躯', effect: '体质强化，受伤减免 12%，生命不会因单次伤害降至 1 以下(每场一次)' }] },
        { name: '影刃赛拉', race: races?.[1]?.trim() || '精灵', tier: battleTier, gender: '女', style: '刺杀游斗·爆发', profession: '影刺客', appearance: '身形轻灵的刺客，双持短刃、步法飘忽，眼神锐利', imagePrompt: '1girl, agile, slender assassin, dual daggers, hooded light armor, sharp eyes, shadowy aura, dark fantasy, dynamic pose', attrs: { str: 30, agi: 46, con: 28, int: 34, cha: 22, luck: 18 }, skills: [{ name: '影袭', effect: '隐入暗影瞬移至目标背后，造成 180% 敏捷伤害且必定暴击，命中附 1 回合「流血」' }, { name: '风步', effect: '身随风动，闪避率提升 25%、持续 2 回合，期间每成功闪避一次反击 30% 伤害' }], talents: [{ name: '疾如奔雷', effect: '身法卓绝，敏捷提升 20%、闪避提升 10%，每回合首次受击必定闪避' }] },
      ];
    }
    const fighters: [Gladiator, Gladiator] = [mkGladiator(fs[0], battleTier, tierNum), mkGladiator(fs[1], battleTier, tierNum)];
    const evals: [GladiatorEval, GladiatorEval] = [mkGladEval(es[0]), mkGladEval(es[1])];
    const { odds, winProb } = computeGladiatorOdds(fighters[0], fighters[1]);
    return { id: `glad_${Date.now()}`, fighters, evals, odds, winProb, kind, status: 'ready', bet: null, result: null };
  }
  // 角斗士立绘：与「普通NPC自动肖像」共用 autoPortrait 开关；开则据 imagePrompt 生图，逐张异步补进 store（不阻塞卡片显示）
  async function genGladiatorPortraits(match: GladiatorMatch): Promise<void> {
    const ig = useImageGen.getState();
    if (!ig.autoPortrait) return;
    const service = ig.portraitService;
    for (let i = 0 as 0 | 1; i <= 1; i = (i + 1) as 0 | 1) {
      const g = match.fighters[i];
      if (!g) continue;
      try {
        const prompt = buildPortraitPrompt({ gender: g.gender, race: g.race, appearance: g.appearance, tier: g.tier, imageTags: g.imagePrompt });
        const url = await shrinkDataUrl(await generateImage(service, { prompt, negative: ig.portraitNegative, label: `角斗士 · ${g.name}` }));
        if (useCasino.getState().gladiator?.id !== match.id) return;   // 期间已换对局 → 丢弃
        useCasino.getState().setGladiatorPortrait(i, url);
      } catch (e: any) { console.warn(`[Casino] 角斗士立绘生成失败(${g.name}):`, e?.message ?? e); }
    }
  }
  const sanitizeRound = (r: any, idx: number): BattleRound => {
    const hp = Array.isArray(r?.hp) ? r.hp : [];
    const buffs = Array.isArray(r?.buffs) ? r.buffs : [];
    const bsan = (x: any) => (Array.isArray(x) ? x.map((s: any) => flattenAiText(s).slice(0, 12)).filter(Boolean).slice(0, 4) : []);
    const os = Array.isArray(r?.os) ? r.os : [];
    return {
      round: parseInt(String(r?.round), 10) || idx + 1,
      actor: parseInt(String(r?.actor), 10) === 1 ? 1 : 0,
      action: flattenAiText(r?.action).slice(0, 24) || '攻击',
      desc: flattenAiText(r?.desc).slice(0, 400) || '双方激烈交锋。',
      damage: Math.max(0, Math.round(Number(r?.damage) || 0)),
      hp: [Math.max(0, Math.round(Number(hp[0]) || 0)), Math.max(0, Math.round(Number(hp[1]) || 0))],
      buffs: [bsan(buffs[0]), bsan(buffs[1])],
      os: [flattenAiText(os[0]).slice(0, 140), flattenAiText(os[1]).slice(0, 140)],
    };
  };
  function fallbackBattle(match: GladiatorMatch, winner: 0 | 1): BattleRound[] {
    const out: BattleRound[] = [];
    const hp: [number, number] = [match.fighters[0].hpMax, match.fighters[1].hpMax];
    const loser: 0 | 1 = winner === 0 ? 1 : 0;
    const N = 6;
    for (let i = 0; i < N; i++) {
      const actor: 0 | 1 = (i % 2 === 0 ? winner : loser);
      const tgt: 0 | 1 = actor === 0 ? 1 : 0;
      const isLast = i === N - 1;
      let dmg = Math.round(hp[tgt] / Math.max(1, (N - i) + (actor === winner ? 0 : 2)));
      if (isLast && tgt === loser) dmg = hp[loser];
      hp[tgt] = Math.max(0, hp[tgt] - dmg);
      if (isLast) { hp[loser] = 0; if (hp[winner] <= 0) hp[winner] = Math.max(1, Math.round(match.fighters[winner].hpMax * 0.2)); }
      const sk = match.fighters[actor].skills;
      const OS_ATK = ['抓住破绽，结束这一切！', '力量，碾碎他！', '就是现在——一击制胜！', '别想躲开我的攻势！', '胜负，就在此刻！', '感受绝望吧。'];
      const OS_DEF = ['唔…这一下好重，必须稳住。', '还没到认输的时候！', '可恶，被压制了…', '撑住，等他露出破绽。', '再这样下去会输的…', '不能倒在这里！'];
      const atkOS = OS_ATK[i % OS_ATK.length], defOS = OS_DEF[i % OS_DEF.length];
      const os: [string, string] = actor === 0 ? [atkOS, defOS] : [defOS, atkOS];
      out.push({ round: i + 1, actor, action: sk[i % Math.max(1, sk.length)]?.name || '强袭', desc: `${match.fighters[actor].name}发动攻势，${match.fighters[tgt].name}勉力招架，仍被击中要害。`, damage: dmg, hp: [hp[0], hp[1]], buffs: [[], []], os });
    }
    return out;
  }
  // 随机戏剧桥段（~55% 触发、类型随机；不改变预定胜者）
  function pickGladTwist(winnerName: string, loserName: string): string {
    if (Math.random() < 0.45) return '';   // 多数场次打常规对决，不硬塞转折
    const twists = [
      `【反转】${winnerName} 前中段被 ${loserName} 死死压制、HP 一度跌到濒死边缘（某回合掉到极低），让全场以为要爆冷；最后关头才强行逆转翻盘。`,
      `【爆种】${winnerName} 在濒死/绝境中骤然爆发（觉醒/暴走/血脉之力/second wind），用一个醒目 buff 体现这股暴涨的战力，随后一波带走对手。`,
      `【临场突破】${winnerName} 在激战中当场突破到更高阶位或顿悟新招（desc 写明突破的瞬间、气息暴涨），实力跃升后锁定胜局。`,
      `【绝望结局】${loserName} 在末段意识到毫无胜算、战意崩溃或重伤难支而放弃抵抗，${winnerName} 以处决式的一击终结战斗，悲壮收场。`,
      `【险胜】双方鏖战到最后双双濒死、只差一口气，${winnerName} 凭一件储存空间物品或一个保命技能压线惨胜，HP 仅剩个位数。`,
    ];
    return twists[Math.floor(Math.random() * twists.length)];
  }
  // ② 战斗：据预定胜者叙述整场数据化分回合战斗（前端动画回放）
  async function genGladiatorBattle(match: GladiatorMatch, winner: 0 | 1): Promise<{ rounds: BattleRound[]; summary: string }> {
    const dossier = (g: Gladiator, i: number) => `【${i === 0 ? '一号位' : '二号位'}】${g.name}（${g.race}·${g.tier}·Lv.${g.level}·${g.profession}${g.rareProfession ? '(稀有职业)' : ''}·${g.bioStrength}·${g.style}）血量上限${g.hpMax}\n六维 力${g.attrs.str}/敏${g.attrs.agi}/体${g.attrs.con}/智${g.attrs.int}\n技能：${g.skills.map((s) => `${s.name}(${s.effect})`).join('；') || '近身搏斗'}\n天赋：${(g.talents ?? []).map((t) => `${t.name}(${t.effect})`).join('；') || '无'}\n储存空间：${g.items.map((it) => `${it.name}(${it.effect})`).join('；') || '无'}`;
    const loser: 0 | 1 = winner === 0 ? 1 : 0;
    const twist = pickGladTwist(match.fighters[winner].name, match.fighters[loser].name);
    const user = `# 两名角斗士档案\n${dossier(match.fighters[0], 0)}\n\n${dossier(match.fighters[1], 1)}\n\n# 预定胜者（必须获胜，败方最终HP归零）\n${winner === 0 ? '一号位 ' + match.fighters[0].name : '二号位 ' + match.fighters[1].name}（下标 ${winner}）${twist ? `\n\n# 本场特殊桥段（必须自然融入剧情、成为记忆点，但绝不改变预定胜者）\n${twist}` : ''}`;
    // 战斗写作指导世界书：按两名角斗士的种族/职业/风格/技能/桥段命中关键词，注入写作风格指引，提升战斗精彩度
    const wbCtx = [match.fighters[0], match.fighters[1]]
      .map((g) => `${g.race} ${g.profession} ${g.style} ${g.bioStrength} ${g.skills.map((s) => s.name).join(' ')} ${(g.talents ?? []).map((t) => t.name).join(' ')} ${g.items.map((it) => it.name).join(' ')}`)
      .join(' ') + ' ' + twist;
    const wbInj = buildBattleWbInjection(useCasino.getState().battleWorldBooks, wbCtx);
    const sys = wbInj ? `${GLADIATOR_BATTLE_RULE}\n\n${wbInj}` : GLADIATOR_BATTLE_RULE;
    let j: any = {};
    try {
      const { content } = await apiChatFallback(casinoChain(), [{ role: 'system', content: sys }, { role: 'user', content: user }], { timeoutMs: 90000 });
      j = parseEntryJson(content) || lenientJsonParse(content) || {};
    } catch (e) { console.warn('[Casino] 角斗战斗生成失败:', e); }
    let rounds: BattleRound[] = Array.isArray(j?.rounds) ? j.rounds.map((r: any, i: number) => sanitizeRound(r, i)) : [];
    if (rounds.length === 0) rounds = fallbackBattle(match, winner);
    // 钉死结局：最后一回合败方 HP=0、胜方 HP>0（保证赔率公平、与预定胜者一致）
    const last = rounds[rounds.length - 1];
    last.hp[loser] = 0;
    if (last.hp[winner] <= 0) last.hp[winner] = Math.max(1, Math.round(match.fighters[winner].hpMax * 0.15));
    const summary = flattenAiText(j?.summary).slice(0, 160) || `${match.fighters[winner].name} 笑到了最后。`;
    return { rounds, summary };
  }

  /* 命运福袋·物品奖励 AI 补全：前端已定稀有度/品级/大类，AI 一次生成全部固定格式信息（装备/材料/技能书）；
     gem/currency/advance/soulcoin 不走 AI；AI 失败则保留 rollGachaBatch 的确定性兜底物品。 */
  async function genGachaRewards(rewards: GachaReward[]): Promise<GachaReward[]> {
    const slots = rewards.map((r, i) => ({ i, r })).filter(({ r }) => r.kind === 'equip' || r.kind === 'material' || r.kind === 'skillbook');
    if (slots.length === 0) return rewards;
    const typeLabel = (k: string) => (k === 'equip' ? '装备' : k === 'material' ? '材料' : '技能书');
    const user = `# 待生成奖励槽（逐槽各生成一件，slot 顺序一一对应）\n` +
      slots.map(({ r }, n) => `${n + 1}. slot=${n + 1} 类型=${typeLabel(r.kind)}${r.kind === 'equip' ? ` 大类=${r.item?.category ?? '武器'}` : ''} 品级=${r.grade}`).join('\n');
    let arr: any[] = [];
    try {
      const { content } = await apiChatFallback(casinoChain(), [{ role: 'system', content: GACHA_REWARD_RULE + '\n' + EQUIP_CODEX }, { role: 'user', content: user }], { timeoutMs: 75000 });
      arr = parseArenaArray(content);
    } catch (e) { console.warn('[Casino] 福袋奖励生成失败:', e); }
    if (!arr.length) return rewards;   // 兜底：用确定性模板物品
    const out = rewards.map((r) => ({ ...r }));
    slots.forEach(({ i, r }, n) => {
      const j = arr.find((x) => parseInt(String(x?.slot), 10) === n + 1) || arr[n];
      const aiName = flattenAiText(j?.name).slice(0, 40);
      if (!j || !aiName) return;   // 该槽 AI 没给 → 保留确定性兜底
      const category = (r.item?.category ?? '特殊物品');   // 大类锁定（公平）
      const isWeapon = category === '武器' || /武器|剑|刀|枪|弓|杖|斧/.test(flattenAiText(j.subType));
      const effect = [flattenAiText(j.effect), flattenAiText(j.attrBonus)].filter(Boolean).join('；').slice(0, 300) || (r.item?.effect ?? '');
      out[i] = {
        ...r, name: aiName,
        item: {
          name: aiName, category: category as any, gradeDesc: r.grade,   // 品级锁定（公平）
          subType: flattenAiText(j.subType).slice(0, 30) || undefined,
          combatStat: r.kind === 'equip' ? (flattenAiText(j.combatStat).slice(0, 40) || undefined) : undefined,
          score: flattenAiText(j.score).slice(0, 60) || undefined,
          affix: r.kind === 'equip' ? (flattenAiText(j.affix).slice(0, 120) || undefined) : undefined,
          effect, intro: flattenAiText(j.intro).slice(0, 200) || undefined,
          appearance: flattenAiText(j.appearance).slice(0, 300) || undefined,
          killCount: isWeapon ? '0' : undefined,
          quantity: r.item?.quantity ?? 1, equipped: false, tags: ['命运福袋'], acquisition: '命运福袋',
        },
      };
    });
    return out;
  }

  // 荷官吐槽：据人设 + 本局输赢说一句话（无接口/失败 → 返回 '' 让前端用兜底语）
  async function casinoBanter(dealer: { name: string; gender: string; persona: string }, ctx: string): Promise<string> {
    const chain = casinoChain();
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return '';
    const user = `# 荷官\n${dealer.name}（${dealer.gender}）：${dealer.persona}\n\n# 本局情况\n${ctx}`;
    try {
      const { content } = await apiChatFallback(chain, [{ role: 'system', content: CASINO_BANTER_RULE }, { role: 'user', content: user }], { timeoutMs: 30000 });
      return flattenAiText(content).replace(/^[「『"']+|[」』"']+$/g, '').slice(0, 60);
    } catch { return ''; }
  }

  // 魂赌剧情局：前端已掷定胜负 → 魔笼据预定结果叙述一段命运对赌剧情（无接口/失败 → 空，前端用兜底文案）
  async function genSoulGamble(stakeLabel: string, win: boolean, dealerPersona: string): Promise<{ narrative: string; verdict: string }> {
    const chain = casinoChain();
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return { narrative: '', verdict: '' };
    const user = `# 主持荷官\n魔笼（${dealerPersona}）\n\n# 契约者押上的筹码\n${stakeLabel}\n\n# 命运的预定结果（必须据此叙述，绝不反转）\n${win ? '契约者赢' : '契约者输'}`;
    try {
      const { content } = await apiChatFallback(chain, [{ role: 'system', content: SOUL_GAMBLE_RULE }, { role: 'user', content: user }], { timeoutMs: 75000 });
      const j = parseEntryJson(content) || lenientJsonParse(content) || {};
      return { narrative: flattenAiText(j?.narrative).slice(0, 800), verdict: flattenAiText(j?.verdict).slice(0, 80) };
    } catch { return { narrative: '', verdict: '' }; }
  }

  // ④ 奖励发放（仅前100；AI 出物品名 + 前端定档/限品级/确定性货币），返回奖励摘要
  async function grantArenaReward(pending: { arenaId: string; arenaName: string }, rank: number): Promise<string> {
    const tier = rewardTierFor(rank);
    if (tier === 'none') return '';
    const band = REWARD_BANDS[tier];
    const prof = usePlayer.getState().profile;
    const user = `# 奖励档位\n${band.label}（名次 #${rank}）\n允许品级：${band.grades}\n物品件数：${band.itemCount[0]}~${band.itemCount[1]} 件\n是否附唯一称号：${band.giveTitle ? '是' : '否'}\n说明：${band.note}\n\n# 主角阶位\n${arenaEffectiveTier(prof.tier, prof.level)}\n竞技场：${pending.arenaName}`;
    let j: any = {};
    try {
      const { content } = await apiChatFallback(arenaChain(), [{ role: 'system', content: ARENA_REWARD_RULE + '\n' + EQUIP_CODEX }, { role: 'user', content: user }], { timeoutMs: 60000 });
      j = parseEntryJson(content) || lenientJsonParse(content) || {};
    } catch (e) { console.warn('[Arena] 奖励生成失败:', e); }
    const items = useItems.getState();
    const names: string[] = [];
    const arr = Array.isArray(j.items) ? j.items.slice(0, band.itemCount[1]) : [];
    for (const it of arr) {
      if (!it || !it.name) continue;
      items.addItem({
        name: flattenAiText(it.name).slice(0, 40), category: (String(it.category || '特殊物品')) as any,
        gradeDesc: flattenAiText(it.gradeDesc || it.grade) || band.grades.split('/')[0].trim(), effect: flattenAiText(it.effect),
        quantity: 1, equipped: false, tags: ['竞技奖励'], combatStat: flattenAiText(it.combatStat) || undefined,
        intro: flattenAiText(it.intro) || undefined, acquisition: `${pending.arenaName} 第${rank}名奖励`,
      });
      names.push(flattenAiText(it.name));
    }
    if (names.length === 0) {
      items.addItem({ name: `${band.label}宝箱`, category: '特殊物品' as any, gradeDesc: band.grades.split('/')[0].trim(), effect: '开启获得随机奖励', quantity: 1, equipped: false, tags: ['竞技奖励'], acquisition: `${pending.arenaName} 第${rank}名奖励` });
      names.push(`${band.label}宝箱`);
    }
    const mul = streakBonusMul(useArena.getState().ladders[pending.arenaId]?.streak ?? 1);
    const coin = Math.round(arenaPickInt(band.paradiseCoin) * mul);
    const soul = arenaPickInt(band.soulCoin);
    if (coin > 0) items.adjustCurrency('乐园币', coin);
    if (soul > 0) items.adjustCurrency('灵魂钱币', soul);
    let titleStr = '';
    if (band.giveTitle) {
      const tn = (j.title && j.title.name) ? flattenAiText(j.title.name).slice(0, 24) : '竞技天王';
      useCharacters.getState().addTitle('B1', { name: tn, rarity: flattenAiText(j.title?.rarity) || '暗金', effect: flattenAiText(j.title?.effect) || '竞技场首位专属', desc: flattenAiText(j.title?.desc) || `${pending.arenaName}登顶之证` });
      titleStr = `，获称号「${tn}」`;
    }
    const parts = [names.join('、')];
    if (coin > 0) parts.push(`乐园币+${coin}`);
    if (soul > 0) parts.push(`灵魂钱币+${soul}`);
    return `${band.label}奖励：${parts.join('，')}${titleStr}`;
  }

  // ⑤ 竞技场战斗结算：胜→取代名次+奖励+击败记录；负→断连胜；统一清理临时对手。返回播报
  async function runArenaWinSettlement(pending: NonNullable<ReturnType<typeof useArena.getState>['pendingChallenge']>, victor: Side | null): Promise<string> {
    const A = useArena.getState();
    let note = '';
    if (victor === 'player') {
      const newRank = A.winAtRank(pending.arenaId, pending.targetRank);
      A.setLadder(pending.arenaId, { entries: [], windowKey: '' });   // 名次已变，清缓存榜，下次进面板按新名次重生成
      usePlayer.getState().setProfile({ arenaRank: `${pending.arenaName}·第${newRank}名` });
      const reward = await grantArenaReward(pending, newRank);
      A.addDefeated({
        arenaId: pending.arenaId, arenaName: pending.arenaName, name: pending.opponent.name, tier: pending.opponent.tier,
        job: pending.opponent.job, strength: pending.opponent.strength, persona: pending.opponent.persona, rank: pending.opponent.rank,
        summary: `在${pending.arenaName}击败第${pending.opponent.rank}名「${pending.opponent.name}」，晋升至第${newRank}名。`,
        reward: reward || undefined,
      });
      note = `【竞技场】晋升至 ${pending.arenaName} 第${newRank}名。${reward}`;
    } else {
      A.setLadder(pending.arenaId, { streak: 0 });
      note = `【竞技场】挑战 ${pending.arenaName} 第${pending.targetRank}名失利，名次未变。`;
    }
    try { useCharacters.getState().removeCharacter(pending.opponentCid); } catch { /* */ }
    try { useNpc.getState().hardRemoveNpc(pending.opponentCid); } catch { /* */ }
    A.setPendingChallenge(null);
    return note;
  }

  // ① 外置手动开战：从「在场 NPC 选择」直接建战（不读正文、不调 AI）
  function startCombatWithSelection(picks: { enemyIds: string[]; allyIds: string[] }) {
    const C = useCombat.getState();
    if (C.battle.active || picks.enemyIds.length === 0) return;
    const blocks: Record<string, CombatStatBlock> = { B1: buildCombatant('B1', 'player') };
    for (const id of picks.allyIds) if (id !== 'B1' && !blocks[id]) blocks[id] = buildCombatant(id, 'player');
    for (const id of picks.enemyIds) if (!blocks[id]) blocks[id] = buildCombatant(id, 'enemy');
    // 联机：在座来宾各自加成玩家方战斗角色（用其上报的角色卡六维，瞬时 combatant，由该来宾远程出手）
    { const mp = useMp.getState();
      if (mp.status === 'connected' && mp.role === 'host') {
        purgeMpCharacters();   // 清掉上一场战斗注入的 MP_ 残留
        clearMpCombatItems();
        for (const seat of mp.seats) {
          const cid = `MP_${seat.seatId}`;
          if (blocks[cid]) continue;
          const card: any = mp.cards.find((c) => c.seatId === seat.seatId)?.snapshot;
          blocks[cid] = buildCombatant(cid, 'player', { isTransient: true, name: card?.name || seat.name, attrs: card?.attrs, tier: card?.tier || '', maxHp: card?.maxHp, maxEp: card?.maxEp });
          try { useCharacters.setState((s) => ({ characters: { ...s.characters, [cid]: { id: cid, skills: card?.skills || [], traits: card?.traits || [] } } })); } catch {}   // 注入来宾技能/天赋供房主结算
          try { setMpCombatItems(cid, card?.items || []); } catch {}   // 注入来宾战斗道具供房主结算
        }
      }
    }
    const npcs = useNpc.getState().npcs;
    const enemyNames = picks.enemyIds.map((id) => npcs[id]?.name || id).join('、');
    const battle = assembleBattle(blocks, {
      reason: `与${enemyNames}交战`,
      location: usePlayer.getState().profile.location || '',
      endConditions: ['击败所有敌人'],
    }, C.config.manualAllyControl);
    battle.log = [{ id: newLogId(), round: 0, type: 'opening', text: '', narration: `战斗开始——对手：${enemyNames}。`, timestamp: Date.now() }];
    resetCombatResources();   // 标了「每战归零」的自定义能量条开战清零（如怒气从 0 攒）
    C.setBattle(battle);
  }

  // ── 组队讨伐：开战 + 阶段引擎 ──
  function applyRaidAffixes(block: any, part: any, affixes: string[]) {
    if (!block || !part) return;
    if (affixes.includes('enrage')) { block.patk = Math.round(block.patk * 1.3); block.matk = Math.round(block.matk * 1.3); }   // 狂暴：攻击叠加
    if (affixes.includes('tough')) { block.pdef = Math.round(block.pdef * 1.25); block.mdef = Math.round(block.mdef * 1.25); }  // 坚韧：减伤
    if (affixes.includes('shield')) { const add = Math.round((block.maxHp || 0) * 0.15); part.curShield = (part.curShield || 0) + add; part.maxShield = Math.max(part.maxShield || 0, part.curShield); }  // 护壁
    if (affixes.includes('regen')) { const heal = Math.round((block.maxHp || 0) * 0.1); part.curHp = Math.min(block.maxHp || part.curHp, part.curHp + heal); }  // 再生：换阶段回血
  }

  // ── 组队副本：巴卡尔攻坚战（多场战斗串联，复用 startRaidCombat 打每一场） ──
  function startRaidDungeon(difficulty: string, kind: string = 'bakal') {
    const mp = useMp.getState();
    if (mp.status !== 'connected' || mp.role !== 'host') return;
    const pf = usePlayer.getState().profile;
    const partyTier = arenaEffectiveTier(pf.tier, pf.level || 1);   // 有效阶位，避免子目标被碾压秒杀
    const o = { partySize: (mp.seats.length || 0) + 1, partyTier };
    const dj = kind === 'anton' ? generateAntonDungeon(difficulty as RaidDifficulty, o) : kind === 'vykas' ? generateVykasDungeon(difficulty as RaidDifficulty, o) : generateBakalDungeon(difficulty as RaidDifficulty, o);
    mp._set({ raidDungeon: dj, raidBoss: null });
    try { mpClient.relay('raid_dungeon', dj); } catch (e) { console.warn('[Raid] 副本广播失败', e); }
  }
  function startDungeonEncounter(encId: string) {
    if (useCombat.getState().battle.active) return;
    const dj = useMp.getState().raidDungeon; if (!dj) return;
    const enc = dj.encounters.find((e: any) => e.id === encId);
    if (!enc || enc.status === 'cleared') return;
    if (dj.linear) {   // 线性门：前序门未清不可开（比阿基斯）
      const idx = dj.encounters.findIndex((e: any) => e.id === encId);
      if (idx > 0 && dj.encounters.slice(0, idx).some((e: any) => e.status !== 'cleared')) return;
    }
    if (enc.kind === 'boss' && dj.encounters.some((e: any) => e.kind === 'dragon' && e.status !== 'cleared')) return;   // 血锁：子目标未清，本体不可打
    currentEncounterRef.current = { encId: enc.id, kind: enc.kind };
    startRaidCombat(enc.boss);
  }

  function startRaidCombat(boss: RaidBoss) {
    const C = useCombat.getState();
    if (C.battle.active) return;
    purgeMpCharacters(); clearMpCombatItems();
    const blocks: Record<string, CombatStatBlock> = {
      BOSS: buildCombatant('BOSS', 'enemy', { isTransient: true, name: boss.name, attrs: boss.attrs, tier: boss.tier, maxHp: boss.maxHp, maxEp: boss.maxEp }),
      B1: buildCombatant('B1', 'player'),
    };
    try { useCharacters.setState((s) => ({ characters: { ...s.characters, BOSS: { id: 'BOSS', skills: boss.skillsByPhase[0] || [], traits: [] } } })); } catch {}
    const mp = useMp.getState();
    for (const seat of mp.seats) {
      const cid = `MP_${seat.seatId}`;
      const card: any = mp.cards.find((c) => c.seatId === seat.seatId)?.snapshot;
      blocks[cid] = buildCombatant(cid, 'player', { isTransient: true, name: card?.name || seat.name, attrs: card?.attrs, tier: card?.tier || '', maxHp: card?.maxHp, maxEp: card?.maxEp });
      try { useCharacters.setState((s) => ({ characters: { ...s.characters, [cid]: { id: cid, skills: card?.skills || [], traits: card?.traits || [] } } })); } catch {}
      try { setMpCombatItems(cid, card?.items || []); } catch {}
    }
    const battle = assembleBattle(blocks, { reason: `讨伐 ${boss.name}`, location: '讨伐战场', endConditions: ['击败 BOSS'] }, C.config.manualAllyControl);
    raidRef.current = { boss, phase: 0, toughness: Math.round(boss.maxHp * 0.22), bossHpMark: boss.maxHp };
    applyRaidAffixes(battle.initialState['BOSS'], battle.participants['BOSS'], boss.affixes);
    battle.log = [{ id: newLogId(), round: 0, type: 'opening', text: '', narration: boss.intro, timestamp: Date.now() }];
    C.setBattle(battle);
  }

  // 阶段引擎：boss 血量跨阈值 → 进下一阶段（换技能组 + 叠词缀 + 台词）。返回 true=本轮已推进
  function checkRaidPhase(): boolean {
    const raid = raidRef.current; if (!raid) return false;
    const C = useCombat.getState(); const b = C.battle;
    const part = b.participants['BOSS']; const block = b.initialState['BOSS'];
    if (!part || !block || part.curHp <= 0) return false;
    const next = raid.boss.phases[raid.phase + 1];
    if (!next || part.curHp / (block.maxHp || 1) > next.threshold) return false;
    raid.phase += 1;
    try { useCharacters.setState((s) => ({ characters: { ...s.characters, BOSS: { id: 'BOSS', skills: raid.boss.skillsByPhase[raid.phase] || [], traits: [] } } })); } catch {}
    const nb = JSON.parse(JSON.stringify(b));
    applyRaidAffixes(nb.initialState['BOSS'], nb.participants['BOSS'], raid.boss.affixes);
    nb.log = [...nb.log, { id: newLogId(), round: nb.round, type: 'system', text: '', narration: `${raid.boss.name} 进入${next.name}！${next.line}`, timestamp: Date.now() }];
    // 召唤：噩梦/深渊进入最终阶段时召唤爪牙助战
    if ((raid.boss.difficulty === 'nightmare' || raid.boss.difficulty === 'abyss') && raid.phase === raid.boss.phases.length - 1) {
      addRaidMinions(nb, raid.boss, raid.boss.difficulty === 'abyss' ? 2 : 1);
    }
    C.setBattle(nb);
    return true;
  }

  function raidLog(round: number, narration: string) { return { id: newLogId(), round, type: 'system' as const, text: '', narration, timestamp: Date.now() }; }

  // 组队讨伐·每回合机制（host 侧、raid 专属、回合变化跑一次）：燃域群伤 + 点名(标记→下回合重击)
  function raidRoundTick(): boolean {
    const raid = raidRef.current; if (!raid) return false;
    const C = useCombat.getState(); const b = C.battle;
    if (!b.active || b.stage === 'ended' || b.round < 1) return false;
    if (raid.lastRound === b.round) return false;
    raid.lastRound = b.round;
    const bossPart = b.participants['BOSS']; if (!bossPart || bossPart.curHp <= 0) return false;
    const affixes = raid.boss.affixes; let nb: any = null;
    const ensure = () => { if (!nb) nb = JSON.parse(JSON.stringify(b)); return nb; };
    // 韧性击破：本回合对 boss 造成的伤害削韧；削空→击破眩晕（全力输出窗口）
    const dealt = Math.max(0, (raid.bossHpMark ?? bossPart.curHp) - bossPart.curHp);
    raid.bossHpMark = bossPart.curHp;
    if (raid.boss.parts) {
      // 多部位破坏（比阿基斯）：无敌期还原 HP、扣当前部位护甲；破左翼/右翼各削攻、破心脏(末位)开破防窗口→重置重甲。与韧性互斥
      if (raid.partArmor == null) { raid.partIdx = 0; raid.partArmor = raid.boss.parts[0].armor; }
      if (raid.breakUntil != null && b.round >= raid.breakUntil) {   // 破防窗口到期 → 重置部位、重新护甲
        raid.breakUntil = undefined; raid.partIdx = 0; raid.partArmor = raid.boss.parts[0].armor;
        const x = ensure(); x.log = [...x.log, raidLog(b.round, `🛡 ${raid.boss.name} 重新护住要害——须重新破部位！`)];
      }
      const inBreak = raid.breakUntil != null && b.round < raid.breakUntil;
      if (!inBreak && dealt > 0) {
        const restored = Math.min(raid.boss.maxHp, bossPart.curHp + dealt);
        raid.bossHpMark = restored; raid.partArmor = Math.max(0, (raid.partArmor ?? 0) - dealt);
        const x = ensure(); x.participants['BOSS'].curHp = restored;
        const part = raid.boss.parts[raid.partIdx ?? 0];
        if (raid.partArmor <= 0) {
          if (part?.atkCut) {   // 破翼 → 永久削攻
            const blk = x.initialState['BOSS']; if (blk) { blk.patk = Math.round((blk.patk || 0) * (1 - part.atkCut)); blk.matk = Math.round((blk.matk || 0) * (1 - part.atkCut)); }
            x.log = [...x.log, raidLog(b.round, `🦋 击破「${part.name}」！${raid.boss.name} 攻击大幅下降。`)];
          }
          raid.partIdx = (raid.partIdx ?? 0) + 1;
          if (raid.partIdx >= raid.boss.parts.length) {   // 心脏(末位)破 → 破防窗口
            raid.breakUntil = b.round + 2;
            x.log = [...x.log, raidLog(b.round, `💥 击破「心脏」！${raid.boss.name} 破防——2 回合全力输出！`)];
          } else {
            raid.partArmor = raid.boss.parts[raid.partIdx].armor;
            x.log = [...x.log, raidLog(b.round, `▶ 转为攻击「${raid.boss.parts[raid.partIdx].name}」。`)];
          }
        } else {
          x.log = [...x.log, raidLog(b.round, `🛡 攻击被「${part?.name}」格挡（部位护甲 ${Math.round(raid.partArmor)}）。`)];
        }
      }
      { const x = ensure(); const cur = x.participants['BOSS']; const st = (cur.status || []).filter((s: any) => s.name !== '部位护甲' && s.name !== '破防');   // 部位/破防 状态条 + 复用护甲条 UI
        const showBreak = raid.breakUntil != null && b.round < raid.breakUntil;
        const part = raid.boss.parts[raid.partIdx ?? 0];
        st.push(showBreak
          ? { id: `cs_brk_${b.round}`, name: '破防', emoji: '💥', tone: 'debuff', type: '减益', effect: '破防·可被伤害', startTurn: b.round, durationTurns: 1, addedAt: Date.now() }
          : { id: `cs_part_${b.round}`, name: '部位护甲', emoji: '🛡', tone: 'buff', type: '增益', effect: `无敌·破「${part?.name ?? '部位'}」`, startTurn: b.round, durationTurns: 1, addedAt: Date.now() });
        cur.status = st;
        cur.coreArmor = Math.round(raid.partArmor || 0); cur.coreArmorMax = part?.armor || 1; cur.breaking = showBreak;
      }
    } else if (raid.boss.breakArmor) {
      // 破核破防（安图恩）：本体无敌→伤害先扣能量护甲→破甲后 2 回合破防窗口（可被伤害）→重新覆甲。与韧性击破互斥
      if (raid.armor == null) { raid.armorMax = raid.boss.breakArmor; raid.armor = raid.boss.breakArmor; }
      if (raid.breakUntil != null && b.round >= raid.breakUntil) {   // 破防窗口到期 → 重新覆甲
        raid.breakUntil = undefined; raid.armor = raid.armorMax;
        const x = ensure(); x.log = [...x.log, raidLog(b.round, `🛡 ${raid.boss.name} 重新覆上能量护甲——须再次破核才能伤到它！`)];
      }
      const inBreak = raid.breakUntil != null && b.round < raid.breakUntil;
      if (!inBreak && dealt > 0) {   // 无敌期：把本回合对 HP 的伤害还原、转移扣护甲
        const restored = Math.min(raid.boss.maxHp, bossPart.curHp + dealt);
        raid.bossHpMark = restored; raid.armor = Math.max(0, (raid.armor ?? 0) - dealt);
        const x = ensure(); x.participants['BOSS'].curHp = restored;
        if (raid.armor <= 0) {
          raid.breakUntil = b.round + 2;
          x.log = [...x.log, raidLog(b.round, `💥 能量核心击破！${raid.boss.name} 破防——2 回合全力输出窗口！`)];
        } else {
          x.log = [...x.log, raidLog(b.round, `🛡 攻击被能量护甲弹开（核心护甲 ${Math.round(raid.armor)}/${raid.armorMax}）。`)];
        }
      }
      { const x = ensure(); const cur = x.participants['BOSS']; const st = (cur.status || []).filter((s: any) => s.name !== '核心护甲' && s.name !== '破防');   // 护甲/破防 状态条（每回合刷新显示）
        const showBreak = raid.breakUntil != null && b.round < raid.breakUntil;
        st.push(showBreak
          ? { id: `cs_brk_${b.round}`, name: '破防', emoji: '💥', tone: 'debuff', type: '减益', effect: '破防·可被伤害', startTurn: b.round, durationTurns: 1, addedAt: Date.now() }
          : { id: `cs_arm_${b.round}`, name: '核心护甲', emoji: '🛡', tone: 'buff', type: '增益', effect: `无敌（护甲 ${Math.round(raid.armor || 0)}/${raid.armorMax}）`, startTurn: b.round, durationTurns: 1, addedAt: Date.now() });
        cur.status = st;
        cur.coreArmor = Math.round(raid.armor || 0); cur.coreArmorMax = raid.armorMax; cur.breaking = showBreak;   // 喂 CombatPanel 渲染核心护甲条/破防态
      }
    } else if (raid.toughness != null) {
      raid.toughness -= dealt;
      if (raid.toughness <= 0 && !bossPart.status?.some((s: any) => s.combat?.cannotAct)) {
        const x = ensure();
        x.participants['BOSS'].status = [...(x.participants['BOSS'].status || []).filter((s: any) => s.name !== '眩晕'), { id: `cs_break_${Date.now()}`, name: '眩晕', emoji: '💫', tone: 'debuff', type: '减益', effect: '韧性击破·无法行动', startTurn: x.round, durationTurns: 1, addedAt: Date.now(), combat: { cannotAct: true } }];
        x.log = [...x.log, raidLog(x.round, `🟡 韧性击破！${raid.boss.name} 硬直倒地，陷入眩晕——全力输出！`)];
        raid.toughness = Math.round(raid.boss.maxHp * 0.22);
      }
    }
    const alivePlayers = (x: any) => Object.keys(x.participants).filter((id) => x.initialState[id]?.side === 'player' && x.participants[id].curHp > 0 && !x.participants[id].left);
    // 恐惧值团灭计时（副本全局·贯穿各场战斗累积）：每回合涨，龙王/深阶段更快；满则团灭（判负·无额外惩罚）。击破子龙时回落见 finishBattle
    {
      const enc = currentEncounterRef.current;
      const dj: any = enc ? useMp.getState().raidDungeon : null;
      if (enc && dj && (dj.stage ?? 'ongoing') === 'ongoing') {
        const dmax = dj.dreadMax || 100;
        const mode = dj.dreadMode || 'wipe';   // wipe=巴卡尔·恐惧满团灭 / dot=安图恩·黑雾群毒不团灭
        const rate = enc.kind === 'boss' ? 5 + raid.phase * 2 : 3;   // 越深越快
        const dread = Math.min(dmax, (dj.dread || 0) + rate);
        if (mode === 'wipe' && dread >= dmax) {   // 满则团灭：本场判负 + 副本失败 + 广播
          const failed = { ...dj, dread: dmax, stage: 'failed' };
          useMp.getState()._set({ raidDungeon: failed });
          try { mpClient.relay('raid_dungeon', failed); } catch { /* */ }
          const x = ensure();
          x.log = [...x.log, raidLog(x.round, `☠️ ${dj.dreadLabel || '恐惧之龙王槽'}已满——全军覆没！副本失败。`)];
          C.setBattle(x);
          void finishBattle('enemy');   // 强制判负（不清玩家血→不额外惩罚）
          return true;
        }
        const nextDj = { ...dj, dread };
        useMp.getState()._set({ raidDungeon: nextDj });
        try { mpClient.relay('raid_dungeon', nextDj); } catch { /* */ }
        if (mode === 'dot' && dread > 0) {   // 黑雾 DoT：按浓度对全队群伤（不团灭·纯消耗→逼速通/清子目标压制）
          const x = ensure();
          const dmg = Math.max(1, Math.round((raid.boss.attrs.int || 20) * 1.5 * (dread / dmax)));
          for (const id of alivePlayers(x)) x.participants[id].curHp = Math.max(0, x.participants[id].curHp - dmg);
          x.log = [...x.log, raidLog(x.round, `🌫 ${dj.dreadLabel || '黑雾'}侵蚀全队（浓度 ${Math.round(dread)}%），各损 ${dmg} 生命——速清子目标压制！`)];
        }
      }
    }
    // 燃域：每回合群伤
    if (affixes.includes('burn')) {
      const dmg = Math.max(1, Math.round((raid.boss.attrs.int || 20) * 1.2));
      const x = ensure();
      for (const id of alivePlayers(x)) x.participants[id].curHp = Math.max(0, x.participants[id].curHp - dmg);
      x.log = [...x.log, raidLog(x.round, `🔥 ${raid.boss.name} 的燃域灼烧全队，各损 ${dmg} 生命。`)];
    }
    // 点名：先结算上回合标记的重击，再每 2 回合标记新目标（下回合落下）
    if (raid.marked && b.round > raid.marked.round) {
      const x = ensure(); const p = x.participants[raid.marked.id];
      if (p && p.curHp > 0) {
        const dmg = Math.max(1, Math.round((raid.boss.attrs.str || 20) * 2)); p.curHp = Math.max(0, p.curHp - dmg);
        let extra = '';
        if (currentEncounterRef.current?.encId === 'stun' && !p.status?.some((s: any) => s.combat?.cannotAct)) {   // 眩龙·麻痹点名：点名重击附带眩晕
          p.status = [...(p.status || []), { id: `cs_stun_${Date.now()}`, name: '麻痹', emoji: '⚡', tone: 'debuff', type: '减益', effect: '麻痹·无法行动', startTurn: x.round, durationTurns: 1, addedAt: Date.now(), combat: { cannotAct: true } }];
          extra = ' 并被麻痹（1 回合无法行动）';
        }
        x.log = [...x.log, raidLog(x.round, `🎯 点名重击落在 ${x.initialState[raid.marked.id]?.name} 身上，重创 ${dmg}${extra}！`)];
      }
      raid.marked = undefined;
    }
    if (!raid.marked && b.round % 2 === 1) {
      const x = ensure(); const ps = alivePlayers(x);
      if (ps.length) { const tid = ps[Math.floor(Math.random() * ps.length)]; raid.marked = { id: tid, round: x.round }; x.log = [...x.log, raidLog(x.round, `🎯 ${raid.boss.name} 锁定了 ${x.initialState[tid]?.name}——下回合将重击，速作防护！`)]; }
    }
    // 三龙差异化机制 + 龙王军团（副本专属·按当前 encounter 区分）
    const encId = currentEncounterRef.current?.encId;
    if (encId === 'ice' && b.round % 2 === 0) {   // 冰龙·寒霜冰封：定期冻结随机玩家（纯控制）
      const x = ensure(); const ps = alivePlayers(x).filter((id) => !x.participants[id].status?.some((s: any) => s.combat?.cannotAct));
      if (ps.length) { const tid = ps[Math.floor(Math.random() * ps.length)]; x.participants[tid].status = [...(x.participants[tid].status || []), { id: `cs_freeze_${Date.now()}`, name: '冻结', emoji: '❄️', tone: 'debuff', type: '减益', effect: '冰封·无法行动', startTurn: x.round, durationTurns: 1, addedAt: Date.now(), combat: { cannotAct: true } }]; x.log = [...x.log, raidLog(x.round, `❄️ 斯皮拉齐的寒霜冰封了 ${x.initialState[tid]?.name}，1 回合无法行动！`)]; }
    } else if (encId === 'poison') {   // 毒龙·剧毒叠层：每回合全队 DoT，层数递增（越拖越痛→速斩）
      raid.poison = (raid.poison || 0) + 1;
      const x = ensure(); const dmg = Math.max(1, Math.round((raid.boss.attrs.int || 20) * 0.5 * (raid.poison || 1)));
      for (const id of alivePlayers(x)) x.participants[id].curHp = Math.max(0, x.participants[id].curHp - dmg);
      x.log = [...x.log, raidLog(x.round, `🧪 斯卡萨的毒雾侵蚀全队（${raid.poison} 层中毒），各损 ${dmg} 生命——速斩！`)];
    } else if (encId === 'bakal' && b.round % 4 === 0) {   // 龙王·龙人军团：定期增援爪牙（上限 3·走现有 NPC 驱动行动）
      const x = ensure(); const live = Object.keys(x.participants).filter((id) => id.startsWith('ADD_') && x.participants[id].curHp > 0).length;
      if (live < 3) { addRaidMinions(x, raid.boss, 1); x.log = [...x.log, raidLog(x.round, '🐲 龙人军团增援登场——速清，别被夹击！')]; }
    }
    if (nb) { C.setBattle(nb); return true; }
    return false;
  }

  function addRaidMinions(nb: any, boss: RaidBoss, n: number) {
    const a = boss.attrs;
    const matt = { str: Math.round(a.str * 0.4), agi: Math.round(a.agi * 0.6), con: Math.round(a.con * 0.3), int: Math.round(a.int * 0.4), cha: a.cha, luck: a.luck };
    for (let i = 0; i < n; i++) {
      const id = `ADD_${Date.now()}_${i}`;
      const block = buildCombatant(id, 'enemy', { isTransient: true, name: `${boss.name}·爪牙`, attrs: matt as any, tier: boss.tier });
      nb.initialState[id] = block;
      nb.participants[id] = { id, side: 'enemy', initiative: rollInitiative(block), curHp: block.maxHp, curEp: block.maxEp, curShield: 0, maxShield: 0, status: [], cooldowns: {} };
      nb.order.push(id);
    }
    nb.log = [...nb.log, raidLog(nb.round, `👥 ${boss.name} 召唤了 ${n} 只爪牙助战！`)];
  }

  // 组队讨伐：房主结算战利 ROLL —— 每件取 需求>贪婪、同档最高 ROLL 者得，广播结果
  function tallyRaidLoot() {
    const lt = useMp.getState().raidLoot; if (!lt) return;
    const rolls = raidRollsRef.current[lt.lootId] || {};
    const results: Record<string, any> = {};
    for (const it of (lt.items || [])) {
      let best: any = null;
      for (const pid of Object.keys(rolls)) {
        const pk = rolls[pid]?.picks?.[it.id]; if (!pk || pk.type === 'pass') continue;
        const prio = pk.type === 'need' ? 2 : 1;
        if (!best || prio > best.prio || (prio === best.prio && pk.roll > best.roll)) best = { winnerId: pid, winnerName: rolls[pid].name, roll: pk.roll, type: pk.type, prio };
      }
      results[it.id] = best ? { winnerId: best.winnerId, winnerName: best.winnerName, roll: best.roll, type: best.type } : { winnerId: null };
    }
    mpClient.relay('raid_loot_result', { lootId: lt.lootId, results });
  }

  // 组队讨伐：AI 现生 BOSS（房主一次 API 出名/emoji/台词/词缀，套难度框架）
  async function genRaidBossAI(theme: string, difficulty: RaidDifficulty) {
    const api = textUseShared ? sharedApi : textApi;
    const chain = resolveApiChain('text', api);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { setGenError('请先在「正文生成→API」配置接口'); setTimeout(() => setGenError(''), 5000); return; }
    const sys = '你是「组队讨伐」BOSS 设定生成器。据主题生成一个强大的 BOSS。只输出 JSON：{"name":"名字(4~8字)","emoji":"单个emoji","intro":"登场威胁台词(一句)","affixes":["从 enrage shield regen tough bleed burn 里选若干,可空数组"]}。不要输出别的。';
    const user = `主题：${theme || '随机强敌'}；难度档：${difficulty}。`;
    try {
      const { content } = await apiChatFallback(chain, [{ role: 'system', content: sys }, { role: 'user', content: user }]);
      const j: any = lenientJsonParse(content) || {};
      const mp = useMp.getState();
      const partyTier = usePlayer.getState().profile?.tier;
      const boss = generateRaidBoss(difficulty, { partySize: mp.seats.length + 1, partyTier, name: j.name, emoji: j.emoji, intro: j.intro, affixes: Array.isArray(j.affixes) ? j.affixes : undefined });
      useMp.getState()._set({ raidBoss: boss });
      mpClient.relay('raid_boss', boss);
    } catch (e: any) { setGenError('BOSS 生成失败：' + (e?.message || e)); setTimeout(() => setGenError(''), 5000); }
  }


  async function resolveAndNarrate(state: BattleState, actorId: string, kind: CombatActionKind, targetIds: string[], skillId?: string, line?: string, itemId?: string) {
    const b1HpBefore = state.participants?.['B1']?.curHp;   // 自定义能量条·战斗累积：记 B1 出手前 HP（settleAction 克隆入参，不会被改）
    const out = settleAction({ state, actorId, kind, targetIds, skillId, itemId });
    if (out.consumedItem && actorId === 'B1') {
      try { useItems.getState().consumeItem(out.consumedItem.id, out.consumedItem.qty); } catch {}
    }
    // 战斗内累积（仅观察 B1 的 HP 变化/出手/击杀，绝不改引擎结算）：攻击/受击/击杀/每回合攒能量条
    try {
      const b1HpAfter = out.state.participants?.['B1']?.curHp;
      const killed = actorId === 'B1' ? out.defeated.filter((id) => out.state.initialState[id]?.side === 'enemy').length : 0;
      applyCombatResourceGains(actorId, kind, (b1HpAfter ?? b1HpBefore ?? 0) - (b1HpBefore ?? 0), killed);
    } catch {}
    // 标签 VM 结算明细即叙事来源（不再逐动作调 AI）；最终由 finishBattle 据完整战斗日志一次性润色。
    const narration = out.logLines.join(' ');
    const st = out.state;
    st.log = [...st.log, makeActionLog(st.round, actorId, out.logLines.join(' '), narration, line)];
    const victor = checkEnd(st);
    if (victor) {
      useCombat.getState().setBattle(st);
      await finishBattle(victor);
    } else {
      const b1HpPreTick = st.participants?.['B1']?.curHp;   // advanceTurn 内 tickRoundStart 会结算 DoT/领域持续伤害
      const advanced = advanceTurn(st, useCombat.getState().config.manualAllyControl);
      // DoT/领域 在回合开始对 B1 造成的持续伤害也算「受击」→ 补触发能量条 onHitTaken（actorId 非 B1，只走受击不走攻击/回合）
      try {
        const b1HpPostTick = advanced.participants?.['B1']?.curHp;
        const dotDelta = (b1HpPostTick ?? b1HpPreTick ?? 0) - (b1HpPreTick ?? 0);
        if (dotDelta < 0) applyCombatResourceGains('__dot__', 'dot', dotDelta, 0);
      } catch {}
      useCombat.getState().setBattle(advanced);
    }
  }

  async function runNpcTurn(actorId: string) {
    if (combatDrivingRef.current) return;
    combatDrivingRef.current = true;
    const C = useCombat.getState();
    C.setApiBusy(true); C.setApiStatus(`${C.battle.initialState[actorId]?.name ?? '对手'} 行动中…`);
    try {
      const state = useCombat.getState().battle;
      const action = pickEnemyAction(state, actorId);   // 本地启发式决策，0 API
      const sp = Math.max(1, C.config.combatSpeed || 1);   // 1/2/4 倍速：缩短回合间停顿
      await new Promise((r) => setTimeout(r, Math.round(320 / sp)));   // 节奏：让每个动作可见（非等待 API）
      await resolveAndNarrate(state, actorId, action.kind, action.targetIds, action.skillId, action.line);
    } catch (e: any) {
      console.error('[Combat] NPC 回合失败:', e?.message ?? e);
    } finally {
      combatDrivingRef.current = false;
      useCombat.getState().setApiBusy(false); useCombat.getState().setApiStatus('');
    }
  }

  async function submitCombatPlayerAction(kind: CombatActionKind, targetIds: string[], skillId?: string, itemId?: string) {
    const C = useCombat.getState();
    const state = C.battle;
    const cur = currentActorId(state);
    if (!cur || C.apiBusy) return;
    // 撤销快照：记下玩家本回合出手前的完整战况（含其后 NPC 连动），供「撤销」回滚
    try { C.setUndoSnapshot(JSON.parse(JSON.stringify(state))); } catch {}
    C.setApiBusy(true); C.setApiStatus('结算中…');
    try {
      await resolveAndNarrate(state, cur, kind, targetIds, skillId, undefined, itemId);
    } catch (e: any) {
      console.error('[Combat] 玩家回合失败:', e?.message ?? e);
    } finally {
      useCombat.getState().setApiBusy(false); useCombat.getState().setApiStatus('');
    }
  }

  function undoCombatAction() {
    const C = useCombat.getState();
    if (C.apiBusy || combatDrivingRef.current) return;
    const snap = C.undoSnapshot;
    if (!snap) return;
    C.setBattle(JSON.parse(JSON.stringify(snap)));
    C.setUndoSnapshot(null);
    C.setSelectedTargetIds([]);
  }

  function writeBackCombatVitals(state: BattleState) {
    const v = combatFinalVitals(state);
    applyCombatVitals(v);
    combatSettledRef.current = v;   // 标记本场战斗 HP/EP 已结算 → 下一回合防双扣
  }
  async function finishBattle(victor: Side | null) {
    if (combatFinishingRef.current) return;
    combatFinishingRef.current = true;
    const C = useCombat.getState();
    // 立即标记战斗结束：面板秒切「胜负 + 关闭按钮」，AI 总结在后台慢慢生成——不再「已打赢却卡在出手界面」。
    C.endBattle(victor, victor === 'player' ? '战斗胜利' : victor === 'enemy' ? '战斗失败' : '战斗结束');
    const state = useCombat.getState().battle;   // 已 ended 的快照（保留完整 log/participants/initialState 供总结与写回）
    C.setApiBusy(true); C.setApiStatus('战斗总结生成中…（可直接关闭）');
    try {
      // 组队讨伐胜利 → 房主生成战利并广播（经 relay 回显，全员统一发币+弹窗+ROLL）
      if (raidRef.current && victor === 'player' && useMp.getState().role === 'host') {
        const enc = currentEncounterRef.current;
        if (enc) {   // 副本场次：标记该 encounter 已击破并广播进度（解锁血锁/通关由 UI 据 status 判定）
          const dj = useMp.getState().raidDungeon;
          if (dj) {
            const e = dj.encounters.find((x: any) => x.id === enc.encId); if (e) e.status = 'cleared';
            const drop = enc.kind === 'side' ? 35 : enc.kind === 'dragon' ? 18 : 0;   // 清侧目标大幅压计时·子目标次之·本体不回落
            const dread = Math.max(0, (dj.dread || 0) - drop);
            const next = { ...dj, dread, stage: enc.kind === 'boss' ? 'cleared' : 'ongoing' };   // 本体击破=副本通关（侧目标可选·不影响通关）
            useMp.getState()._set({ raidDungeon: next });
            try { mpClient.relay('raid_dungeon', next); } catch (err) { console.warn('[Raid] 副本进度广播失败', err); }
          }
        }
        if (!enc) {   // 单 BOSS 讨伐 → 普通 ROLL 掉落
          try { mpClient.relay('raid_loot', generateRaidLoot(raidRef.current.boss.rewardTier, raidRef.current.boss.name)); } catch (e) { console.warn('[Raid] 掉落生成失败', e); }
        } else if (enc.kind === 'boss') {   // 副本龙王击破=全清通关 → 豪华奖励（按评级·全员均得全套）
          try {
            const dj2: any = useMp.getState().raidDungeon;
            const remainPct = dj2 ? Math.max(0, ((dj2.dreadMax || 100) - (dj2.dread || 0)) / (dj2.dreadMax || 100)) : 1;
            const rkind = dj2?.bossId || 'bakal';   // 按副本本体 id 取奖励主题（bakal/anton/vykas）
            const rw = generateRaidReward(rkind, dj2?.difficulty || 'normal', remainPct, dj2?.difficultyLabel || '');
            applyRaidReward(rw);   // 房主本地立即入账+弹窗（不依赖 relay 回显·断线/单机也保底）
            try { mpClient.relay('raid_reward', rw); } catch (err) { console.warn('[Raid] 奖励广播失败', err); }   // 再广播给来宾各自入账
          } catch (e) { console.warn('[Raid] 豪华奖励生成失败', e); }
        }
      }
      currentEncounterRef.current = null;
      const summary = await runBattleSummaryPhase(state, victor);
      const resultText = summary || buildCombatResultFallback(state, victor);
      const settledNote = '（系统：本场战斗的 HP/EP 已结算并写入面板，续写正文请从当前面板状态出发，不要重复结算战斗伤害或再加减 HP/EP。）';
      const full = resultText ? `${resultText}\n${settledNote}` : '';
      // 战斗结果写进用户输入框，由玩家确认/编辑后点发送续写正文（不自动插入正文楼层）
      if (full) setInputValue((prev) => (prev && prev.trim() ? `${prev}\n\n${full}` : full));
      writeBackCombatVitals(state);
      // 竞技场挑战结算（取代名次 + 前100奖励 + 击败记录 + 清理临时对手）
      const arenaPending = useArena.getState().pendingChallenge;
      if (arenaPending && state.initialState[arenaPending.opponentCid]) {
        try {
          const arenaNote = await runArenaWinSettlement(arenaPending, victor);
          if (arenaNote) setInputValue((prev) => (prev && prev.trim() ? `${prev}\n\n${arenaNote}` : arenaNote));
        } catch (e) { console.warn('[Arena] 战斗结算失败:', e); useArena.getState().setPendingChallenge(null); }
      }
      // 结束态已在开头置好（不再重复 endBattle，避免玩家已点「关闭」后又被顶回结算面板）
    } catch (e: any) {
      console.error('[Combat] 战斗收尾失败:', e?.message ?? e);
    } finally {
      combatFinishingRef.current = false;
      useCombat.getState().setApiBusy(false); useCombat.getState().setApiStatus('');
    }
  }
  function runPostNarrativePhases(narrative: string, assistantMsgId?: number) {
    setPhaseFail({});   // 新回合重跑全部演化：先清空上轮的「更新失败」标记，本轮哪个再失败由其状态日志重新标记
    stopAllRef.current = false;   // 新回合开始：解除上次的「停止生成」（chat/生图全局中止器在 stop 时已自重置，无需再动）
    // 战斗刚结算（本回合是玩家发送的"战斗复盘"）→ HP/EP 已由战斗系统定死：本回合不从正文再抽 HP（防 AI 复盘重复扣血），改以战斗结算值为准
    const combatSettled = combatSettledRef.current;
    combatSettledRef.current = null;
    // 轨道A：离场契约者零API自治（按 turnCount 推进；自带开关守卫；失败不影响演化阶段）
    try { runNpcAutonomy(useMisc.getState().turnCount); } catch (e) { console.warn('[轨道A] 自治模拟失败', e); }
    // 先从正文人物卡照抄六维（同步，先于各演化阶段，使快照与显示即刻正确）
    try { applyNarrativeAttrs(narrative); ensureNpcLuck(); ensureNpcVitalsCap(); } catch (e) { console.warn('[Attr] 六维抽取失败:', e); }
    if (combatSettled) {
      applyCombatVitals(combatSettled);   // 以战斗结算值为准，跳过正文 HP 抽取（避免双扣）
    } else {
      // 主角 HP/EP：正文出现"当前HP/EP：X/Y"就照抄（AI 漏写 hp.B1 时兜底，解决 HP 恢复了但侧栏不变）
      try { applyNarrativeVitals(narrative); } catch (e) { console.warn('[Vitals] HP/EP 抽取失败:', e); }
      // NPC HP/EP：正文按名字出现"(当前)HP/EP：X/Y"就照抄（参考主角逻辑，AI 漏写 hp.<id> 时兜底）
      try { applyNarrativeNpcVitals(narrative); } catch (e) { console.warn('[Vitals] NPC HP/EP 抽取失败:', e); }
    }
    // 在场/离场校正（兜底登场判断漏标，确保离场角色进入离场B区档案）
    try { reconcileScenePresence(narrative); } catch (e) { console.warn('[NPC] 在场/离场校正失败:', e); }
    // 清理上一回合遗留的"无名空壳"NPC（登场判断之前，避免误删本回合即将建档的新角色）
    try { pruneGhostNpcs(); } catch (e) { console.warn('[NPC] 空壳清理失败:', e); }
    // 先用当前已有 NPC 设一份重定向目标（登场判断完成后会再刷新）
    refreshNpcPreferredOwners();
    // 各演化阶段调度（综合设置→演化调度）：every=每N回合一次，read=读取最近N回合正文
    const sched = useSettings.getState().phaseSched ?? {};
    const turn = turnCountRef.current;
    const due = (key: string) => turn % Math.max(1, sched[key]?.every || 1) === 0;
    const narr = (key: string) => buildRecentNarrative(narrative, sched[key]?.read ?? 1);
    // 联机房主：把"真人队友不是NPC、别演化他们/别给他们物品"的铁则附给 NPC + 物品阶段
    const mpEx = mpHostExcludeRule();
    // 收集会改「回合洞察」快照变量的阶段(主角/物品/对账·NPC·势力)的 promise，全部 settle 后再抓快照，比固定 20s 估时更准
    const snapTurn = turnCountRef.current;
    const onCombat = () => { if (combatSettled) applyCombatVitals(combatSettled); };   // 战斗回合：演化跑完把 HP 压回战斗结算值（防复盘重复扣血）
    const dueItem = due('item'), duePlayer = due('player');
    // ── 演化阶段·声明式表（加阶段/调顺序/开关 gate/依赖都改这里；调度器见 systems/phasePipeline）──
    //   awaitForSnapshot=会改「回合洞察」快照变量的阶段，抓快照前需等它们 settle；delayMs=延后启动（生图等演化先写档）。
    const phases: Phase[] = [
      // 物品 / 主角各自并发，两者 settle 后合并成【一次】综合对账纠错（audit 依赖 item+player）
      { key: 'item',      enabled: dueItem,             awaitForSnapshot: true, run: () => runItemManagementPhase(narr('item') + mpEx) },
      { key: 'player',    enabled: duePlayer,           awaitForSnapshot: true, run: () => runPlayerEvolutionPhase(narr('player')) },
      { key: 'audit',     enabled: dueItem || duePlayer, deps: ['item', 'player'], awaitForSnapshot: true,
        run: () => runMergedAuditPhase(narrative, { player: duePlayer, item: dueItem }), onDone: onCombat },
      { key: 'npc',       enabled: due('npc'),          awaitForSnapshot: true, run: () => runNpcEvolutionPhase(narr('npc') + mpEx), onDone: onCombat },
      { key: 'faction',   enabled: due('faction'),      awaitForSnapshot: true, run: () => runFactionEvolutionPhase(narr('faction')) },
      { key: 'territory', enabled: due('territory'),    run: () => runTerritoryEvolutionPhase(narr('territory')) },
      { key: 'subprof',   enabled: due('subprof'),      run: () => runSubProfEvolutionPhase(narr('subprof')) },   // 内部机械预筛（提到副职业/配方 或 升档）才真正调 API
      { key: 'team',      enabled: due('team'),         run: () => runTeamEvolutionPhase(narr('team')) },
      { key: 'cosmos',    enabled: due('cosmos'),       run: () => runCosmosEvolutionPhase(narr('cosmos')) },
      { key: 'memory',    enabled: true,                run: () => runMemoryCompressionPhase() },   // 内部按阈值判定，不走回合门控
      { key: 'misc',      enabled: due('misc'),         run: () => runMiscEvolutionPhase(narr('misc')) },
      { key: 'nm',        enabled: due('nm'),           run: () => runNarrativeIngestPhase(lastUserInputRef.current, narr('nm')) },
      { key: 'choices',   enabled: true,                run: () => runChoicesFanficPhase(narrative, assistantMsgId) },   // 内部各自开关门控
      // 生图：延后约 6s 等演化先写档；正文配图需有楼层 id
      { key: 'portrait',  enabled: true, delayMs: 6000, run: () => runPortraitPhase() },
      { key: 'equipImg',  enabled: true, delayMs: 6000, run: () => runEquipImagePhase() },
      { key: 'storyImg',  enabled: assistantMsgId != null, run: () => runStoryImagePhase(narrative, assistantMsgId!) },
    ];
    const pipe = runPhasePipeline(phases);
    // 会改快照变量的阶段全部 settle 后抓「回合洞察」快照；若已被新回合取代则跳过（20s 定时器仍兜底，同回合覆盖）
    pipe.snapshotReady.then(() => {
      if (turnCountRef.current !== snapTurn) return;
      // 非战斗回合：以正文末尾「当前HP/EP：X/Y」为**最终权威**——演化阶段全跑完后再压回一次主角+NPC 的 HP/EP，纠正演化把血量改写导致面板与正文末尾对不上。(战斗回合以战斗结算值为准。)
      if (!combatSettled) { try { applyNarrativeVitals(narrative); applyNarrativeNpcVitals(narrative); } catch (e) { console.warn('[Vitals] settle 后压回失败', e); } }
      try { captureTurnSnapshot(); } catch (e) { console.warn('[Insight] settle 后抓快照失败', e); }
    });
  }

  /* 剧情指导：正文生成【前】先跑一次，据「最近5楼 + 玩家这步 + 当前任务/场景」产出剧情优化建议（提示词允许联网搜原作剧情让切入更合理）。
     建议像叙事回忆一样注入主正文，由主正文据此写。失败/无配置 → 返回 ''（不注入，正文照常生成）。可挂独立 guidance 路由。 */
  async function runPlotGuidance(userText: string): Promise<string> {
    const gApi = textUseShared ? sharedApi : textApi;
    const chain = resolveApiChain('guidance', gApi);   // 未配 guidance 路由则回退到正文 API
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[剧情指导] guidance 路由与正文 API 均未配置，跳过'); return ''; }
    // 上下文：最近5楼 + 玩家这步 + 当前任务/场景
    const recent5 = (messagesRef.current ?? []).slice(-5)
      .map((m) => `[${m.role === 'user' ? '玩家' : '正文'}] ${m.content}`).join('\n\n');
    const questScene = [...buildQuestInjection(), ...buildWorldTimeInjection()].map((m) => m.content).join('\n');
    const sys = (guidancePrompt && guidancePrompt.trim()) ? guidancePrompt : PLOT_GUIDANCE_RULE;
    const user = `【最近正文（最多5楼）】\n${recent5 || '（暂无）'}\n\n【玩家这一步】\n${userText || '（无显式输入，续写）'}\n\n【当前任务 / 场景】\n${questScene || '（暂无）'}\n\n请据上面，给出本回合的【剧情优化建议】（要点式，不写正文）。`;
    setGuidanceRunning(true);   // 状态栏「💡 剧情提示生成中…」
    try {
      // 剧情指导只是正文前的「锦上添花」前置建议，绝不能挡住正文生成：用墙钟硬超时兜底——
      // guidance 接口卡死/超慢（中转大请求挂起、节流排不到名额…）时，最多等 WALL_MS 就放弃、
      // 用空建议照常生成正文。修「开了剧情指导后正文一直转、生成不出来」（apiChatFallback 的
      // timeoutMs 是空闲超时·绝对上限达 4~6 分钟，会把正文挡死这么久）。
      const WALL_MS = 35000;
      const call = apiChatFallback(chain, [{ role: 'system', content: sys }, { role: 'user', content: user }], { timeoutMs: 20000 })
        .then(({ content }) => stripLeakedThinking(content || '').trim())
        .catch((e) => { console.warn('[剧情指导] 调用失败，本回合跳过：', e); return ''; });
      const g = await Promise.race([
        call,
        new Promise<string>((resolve) => setTimeout(() => { console.warn(`[剧情指导] 超过 ${WALL_MS}ms 未返回，跳过本回合、正文照常生成`); resolve(''); }, WALL_MS)),
      ]);
      if (g) console.log(`[剧情指导] 已生成建议（${g.length} 字）`);
      return g;
    } finally { setGuidanceRunning(false); }
  }

  async function callApi(userText: string, extraHistory: ChatMessage[] = []) {
    // 每次用户发消息计为一回合
    turnCountRef.current += 1;
    try { useMisc.getState().setTurnCount(turnCountRef.current); } catch { /* 持久化「累计总回合数」：跨任务世界/刷新/读档不归零 */ }
    try { useItems.getState().setItemTurn(turnCountRef.current); } catch { /* */ }   // 推进「最近删除」回收站回合数 + 清除满 3 回合的条目
    lastUserInputRef.current = userText;   // 供叙事记忆·回复后写入使用
    expireStatuses(turnCountRef.current);                      // 回合推进：清理已过期的限时状态（主角+NPC）
    reconcileHomeWorld();                  // 回归乐园一致性兜底：时间同步 + 任务世界势力移出当前世界
    reconcilePlayerVitals();               // HP/EP 兜底：仍是 100/50 旧默认时按六维重算为满
    syncPlayerVitalsMax();                  // 每回合：同步存储上限=真实上限（当前 HP/EP 由正文末尾<状态结算>驱动，本函数不补血）
    reconcilePartyLifecycle();             // 临时队伍：非当前世界的队友自动解散（离场归档；有冒险团则弹转正）

    const api = textUseShared ? sharedApi : textApi;
    const apiChain = resolveApiChain('text', api);   // 接口路由：多选轮流 + 失败 fallback
    if (!apiChain[0]?.baseUrl || !apiChain[0]?.apiKey) {
      setGenError('请先在设置→正文生成→API配置中填写 API 地址和 Key（或在综合设置→API 接口库添加后于此选择路由）');
      return;
    }

    // 解析激活预设：先按 id，再按名（id 失配兜底——内置预设跨刷新 id 可能变），最后退到库内第一个；
    // 只要预设库非空就一定注入某个预设，绝不因 activeId 为 null/失配而「裸奔」无预设（修「预设没注入」）。
    // **实时读 store**：重新生成走「reload+自动重发」，sendMessage 是挂载时的空闭包(textPresets 旧值为空)；
    //   从 useSettings.getState() 现取，免受 stale 闭包影响（配合下方重发前「等补种」轮询）→ 否则 reroll 预设没注入(722 裸奔)。
    await builtinsReady;   // 等内置正文世界书/预设加载完，杜绝首条消息偶发「没世界书注入」
    const _ssNarr = useSettings.getState();
    const preset = resolveActivePreset(_ssNarr);

    // 历史裁切：historyLimit > 0 时只取最近 N 条（即"显示楼层"范围）
    const allHistory = extraHistory.length > 0 ? extraHistory : messagesRef.current;
    const visibleHistory = historyLimit > 0 ? allHistory.slice(-historyLimit) : allHistory;

    // 世界书关键词匹配：用当前输入 + 可见历史内容一起匹配
    const matchCtx = ([
      userText,
      ...visibleHistory.slice(-10).map((m) => m.content),
    ]).join(' ').toLowerCase();

    // C：主角【所属乐园】专属世界书条目强制每回合纳入（不靠关键词命中），避免任务世界里整体串味成轮回乐园。
    //   只认乐园档案条目（comment 以「X乐园」结尾，如「[mvu_plot]天启乐园」），不误命中「战斗描写·轮回乐园(笔法)」等；
    //   轮回乐园无独立档案条目→不额外注入，自然回退到常驻世界观设定，无副作用。
    const homeBare = (usePlayer.getState().profile.homeParadise || '').trim().replace(/乐园$/, '');   // 归一裸乐园名（"天启乐园"→"天启"）
    const wbEntries = textWorldBooks
      .filter((b) => b.enabled)
      .flatMap((b) => b.entries.filter((e) =>
        e.enabled && (
          e.constant ||   // 蓝灯：常驻，无条件纳入
          (e.selective && e.key.some((k) => k && matchCtx.includes(k.toLowerCase()))) ||
          (!!homeBare && (e.comment || '').endsWith(homeBare + '乐园'))   // 所属乐园档案条目：常驻注入
        )
      ));
    // 分流：position===4 的条目 → ⚡深度注入（贴近对话末尾＝高优先级）；其余 → [世界书信息] 塞 system 顶（按 order 升序排）
    const wbNormal = wbEntries.filter((e) => e.position !== 4).slice().sort((a, b) => ((a.order ?? 100) - (b.order ?? 100)));
    const wbDepthInjections = wbEntries
      .filter((e) => e.position === 4)
      .map((e) => ({
        role: (e.role === 1 ? 'user' : e.role === 2 ? 'assistant' : 'system') as 'system' | 'user' | 'assistant',
        content: '[' + e.comment + ']\n' + e.content,
        depth: typeof e.depth === 'number' ? e.depth : 4,
      }));
    const wbKeywordText = wbNormal.map((e) => '[' + e.comment + ']\n' + e.content).join('\n\n');
    // 向量资料库（原著当世界书）：把当前查询 embed → 语义检索 topK 原著片段 → 追加进世界书注入
    let novelVecText = '';
    try {
      const lastAsstForVec = [...visibleHistory].reverse().find((m) => m.role === 'assistant')?.content ?? '';
      const hits = await retrieveNovel(`${userText}\n${lastAsstForVec}`);
      if (hits.length) novelVecText = '【资料检索·语义召回（原著+世界书，参考设定/桥段，非剧情指令，请勿照抄复述）】\n' +
        hits.map((h) => `〔${h.source}·${h.chap || h.vol || ''}〕${h.text}`).join('\n\n');
    } catch (e) { console.warn('[NovelVec] 检索失败', e); }
    const worldInfoText = [wbKeywordText, novelVecText].filter(Boolean).join('\n\n');

    const { sysPrompt, examples, prefill, depthInjections, sysSegments, tail, worldbook } = buildPresetMessages(preset, worldInfoText, userText);
    // 跳过思维链（设置开时）：末尾预填充 </think>，让思考模型以为思考已结束、直接出正文（与 preset 自带 prefill 叠加）
    const effectivePrefill = skipNarrativeThinking ? ('</think>\n' + (prefill ?? '')).trimEnd() : prefill;
    // 剧情指导（开启时）：正文生成【前】先跑一次，产出剧情优化建议 → 像叙事回忆一样注入主正文，由主正文据此写（仅一次正文生成）
    let guidanceBlock: { role: 'system'; content: string }[] = [];
    if (plotGuidance) {
      const g = await runPlotGuidance(userText);
      if (g) guidanceBlock = [{ role: 'system', content: `【剧情指导·本回合写作建议（仅"剧情方向"参考）】\n${g}\n\n（以上仅为剧情方向建议：把方向自然融入正文即可，勿照抄成对白/旁白/标题。⚠️正文的输出格式与一切结构模块——状态栏／时间结算／【主角资源】等世界书与预设规定的模块——一律照常严格输出，不得因本建议而省略、简化或改变格式。本建议只影响"写什么剧情"，不影响"怎么排版输出"。）` }];
    }

    // 历史：叙事记忆（关键词召回，启用时）或按 historyLimit 切片（现状）
    let memory: { role: 'system'; content: string }[] = [];
    let structPlayer: { role: 'system'; content: string }[] = [];   // <主角当前档案> 浅注入(贴近用户输入,更难被忽略)
    let structRest: { role: 'system'; content: string }[] = [];     // <在场与相关档案> NPC/势力/领地/冒险团(留原位)
    let recent: { role: 'user' | 'assistant'; content: string }[];
    const vm = useSettings.getState().vectorMemory;
    if (vm.enabled && vm.apiBase && vm.apiKey) {
      // ── 向量召回引擎（与关键词叙事记忆并行；开则接管，零 LLM 调用，快）──
      setNmRecalling(true);
      setNmPhaseLog('');
      try {
        const M = useMisc.getState();
        const pool = buildMemPool(M, vm.maxItems ?? 1000);
        await factVecLoadAll();
        const ev = await factVecEnsure(pool, vm, { max: 48 });   // 内联限量补缺；首次全量请用设置页"重建索引"
        const lastAsst = [...allHistory].reverse().find((m) => m.role === 'assistant')?.content ?? '';
        const ctx = `${userText}\n${lastAsst}`;
        const qvec = await factVecEmbedOne(ctx, vm);
        const hits = qvec ? factVecSearch(qvec, pool.map((p) => p.key), vm.topK ?? 6, vm.threshold ?? 0.3) : [];
        const byKey = new Map(pool.map((p) => [p.key, p]));
        const tagOf = (k: string) => k === 'event' ? '世界大事' : k === 'large' ? '阶段记忆' : k === 'fact' ? '长期事实' : '近期记忆';
        let lines = hits.map(({ key }) => { const p = byKey.get(key)!; return `[${tagOf(p.kind)}] ${p.body}`; });
        // 向量无命中(或尚未索引)·近期兜底：库里明明有却整轮空注入时，退而注入最近的长期事实
        if (lines.length === 0 && pool.length > 0) {
          const factPool = pool.filter((p) => p.kind === 'fact');
          lines = (factPool.length ? factPool : pool).slice(-(vm.topK ?? 6)).reverse().map((p) => `[${tagOf(p.kind)}] ${p.body}`);
        }
        memory = lines.length ? [{ role: 'system' as const, content: `<相关记忆>\n${lines.join('\n\n')}\n</相关记忆>` }] : [];
        const recentN = historyLimit > 0 ? historyLimit : (vm.recentFullTextCount ?? 5);
        recent = (recentN > 0 ? allHistory.slice(-recentN) : []).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
        { const sr = await buildStructuredRecall(ctx, { noLlmSelect: true, userInput: userText }); structPlayer = sr.player; structRest = sr.rest; }   // 向量模式：NPC 走本地排序，不调 LLM
        const note = ev.remaining > 0 ? `（剩 ${ev.remaining} 条将随后续回合自动补全，无需手动；想立即全量可去设置→向量记忆点"重建索引"）` : '';
        setNmPhaseLog(`🧠 向量召回：池 ${pool.length} 条 · 命中 ${hits.length}${(structPlayer.length || structRest.length) ? ' + 结构化档案' : ''}${note}`);
        setTimeout(() => setNmPhaseLog(''), 8000);
      } catch (e) {
        console.warn('[VecMem] 向量召回失败，回退最近楼层', e);
        const msg = e instanceof Error ? e.message : String(e);
        setNmPhaseLog(`⚠️ 向量记忆失败：${msg}（已回退最近楼层；请检查 设置→向量记忆 的接口/密钥/模型）`);
        setTimeout(() => setNmPhaseLog(''), 12000);
        recent = visibleHistory.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
      } finally {
        setNmRecalling(false);
      }
    } else if (narrativeMem.enabled) {
      setNmRecalling(true);          // 显示「正在进行记忆回溯…」
      setNmPhaseLog('');
      try {
        const M = useMisc.getState();
        const facts = [
          ...M.narrativeFacts.map((f) => ({ title: f.title, text: f.keywords.length ? `${f.text} ｜${f.keywords.join(' ')}` : f.text, kind: 'fact' as const })),
          ...M.largeSummaries.map((t) => ({ title: t.slice(0, 18), text: t, kind: 'large' as const })),
          ...M.smallSummaries.map((t) => ({ title: t.slice(0, 18), text: t, kind: 'small' as const })),
          ...M.worldEvents.map((e) => ({ title: `${e.time} ${e.location}`.trim(), text: `${e.time}@${e.location} ${e.desc}`, kind: 'event' as const })),
        ];
        const lastAssistant = [...allHistory].reverse().find((m) => m.role === 'assistant')?.content ?? '';
        const structContext = `${userText}\n${lastAssistant}`;   // 给结构化预测用的原始情境（不被关键词改写覆盖）
        let query = structContext;
        // 发送前整理：LLM 改写查询（仅在开启 LLM 模式且有素材时）
        if (narrativeMem.llmMode && facts.length > 0) {
          const titles = facts.map((f, i) => `${i}｜${f.title}`).join('\n');
          const kws = await narrativeCompile(query, titles);
          if (kws.length) query = kws.join(' ');
        }
        // 全局「历史楼层(historyLimit)」也对叙事记忆生效：正文 API 只读最近 historyLimit 楼原文（再叠加召回的长期事实）。
        // 否则开了叙事记忆后正文只发最近 recentFullTextCount(默认5) 楼、忽略你设的限制——"只读这几楼"形同虚设。
        const effCfg = historyLimit > 0
          ? { ...narrativeMem, recentFullTextCount: historyLimit }
          : narrativeMem;
        const built = buildNarrativeHistory(allHistory.filter((m) => m.role !== 'system').map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })), effCfg, facts, query);
        memory = built.memory;
        recent = built.recent;
        // 结构化档案召回（主角必含 + 预测/在场 NPC）
        { const sr = await buildStructuredRecall(structContext, { userInput: userText }); structPlayer = sr.player; structRest = sr.rest; }
        const structNote = (structPlayer.length || structRest.length) > 0 ? ' + 结构化档案' : '';
        setNmPhaseLog(
          facts.length === 0
            ? `🧠 记忆回溯：素材库为空（需先经总结/LLM抽取积累事实）${structNote}`
            : memory.length > 0
              ? `🧠 记忆回溯：已注入相关记忆（素材库 ${facts.length} 条）${structNote}`
              : `🧠 记忆回溯：素材库 ${facts.length} 条，本轮无强相关${structNote}`
        );
        setTimeout(() => setNmPhaseLog(''), 8000);
      } finally {
        setNmRecalling(false);
      }
    } else {
      recent = visibleHistory.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    }

    const mpPartyBlock = buildPartyProfiles();   // 联机房主：同行真人队友档案(技能/天赋/职业/装备/性格/外观/种族)
    const mpRuleBlock = mpNarrativeRule();        // 联机专用正文规则（建房时房主可选启用）
    const skillUpNote = takeSkillUpNote();        // 技能升级·一次性"点数已用掉"系统提示（注入一次即清）
    const history = [
      ...examples,
      ...(worldbook && !worldbook.post ? [{ role: worldbook.role, content: worldbook.content }] : []),   // <世界书> marker 在前历史 → 楼层前（罕见，ST 预设）
      ...recent,                                       // 最近原文楼层（与 system+示例 一起构成「稳定前缀」→ 利于 DeepSeek 等前缀缓存命中）
      // ↓↓ 缓存优化（2026-06-23）：把每回合都变的「记忆/档案/世界书」从聊天记录之前挪到之后——
      //    放在稳定前缀外、贴近生成处；既让长前缀可缓存（命中↑成本/延迟↓），又因「贴近生成」对相关性更好。
      ...memory,                                       // <过往记忆> system 块（如有）
      ...structRest,                                   // <在场与相关档案> NPC/势力/领地档案
      ...(mpRuleBlock ? [{ role: 'system' as const, content: mpRuleBlock }] : []),     // <联机正文规则>
      ...(mpPartyBlock ? [{ role: 'system' as const, content: mpPartyBlock }] : []),   // <同行队友>
      ...buildPlayerCoreInjection(),                    // <主角核心>
      ...buildWorldTimeInjection(),                     // <当前时空>
      ...buildQuestInjection(),                          // <当前任务>
      ...buildCosmosInjection(),                        // <万族态势>
      ...buildFanficInjection(),                        // <同人设定·已锁定>
      ...buildFactInjection(),                          // <事实锚点·已锁定>
      ...structPlayer,                                 // <主角当前档案> 浅注入：紧贴最近正文/用户输入
      ...(skillUpNote ? [{ role: 'system' as const, content: skillUpNote }] : []),   // 技能升级·一次性结算通知（仅告知点数已用掉）
      ...guidanceBlock,                                // <剧情指导> 本回合写作建议
      ...(worldbook && worldbook.post ? [{ role: worldbook.role, content: worldbook.content }] : []),   // <世界书+RAG> 无 marker → 楼层后（稳定前缀外·缓存友好）；marker 后历史亦此
      ...tail.map((t) => ({ role: t.role, content: t.content })),   // <后历史预设块> chatHistory marker 之后的预设块（破限/格式/规则等）→ 真实楼层之后（仿 fanren post-history）
      ...[...depthInjections, ...wbDepthInjections].sort((a, b) => b.depth - a.depth).map((inj) => ({ role: inj.role, content: inj.content })),
      { role: 'user' as const, content: userText },
      ...(effectivePrefill ? [{ role: 'assistant' as const, content: effectivePrefill }] : []),   // 末尾预填充（prefill 块 / 跳过思维链）
    ];

    // stream 以预设为准，统一一个变量
    const useStream = preset?.stream ?? textStream;

    setPromptSent(`=== SYSTEM ===\n${sysPrompt}\n\n=== HISTORY ===\n${history.map((m) => `[${m.role}] ${m.content}`).join('\n')}`);
    setShowPrompt(false);
    // 开发者·正文API提示词：把本回合「实际发给模型」的提示词拆成卡片（重点＝深度注入块），供「🛠 开发者」查看
    let narrLogId = -1;
    const narrParts = [
      { label: '📊 概览（本回合实际发送结构）', role: 'info', content:
        '激活预设：' + (preset?.name ?? '（无 → 最简默认）') + (preset ? (preset.builtin ? ' · ⚠️builtin(未固化,改动可能被补种覆盖)' : ' · ✓玩家副本') + ' · id=' + preset.id : '') + '\n' +
        (preset && _ssNarr.textPresets.filter((p) => p.id === preset.id).length > 1 ? '⚠️ 同 id 副本 ' + _ssNarr.textPresets.filter((p) => p.id === preset.id).length + ' 个 → 已优先取你编辑过的非 builtin 版（修「改预设没用」）\n' : '') +
        '世界书：启用 ' + textWorldBooks.filter((b) => b.enabled).length + '/' + textWorldBooks.length + ' 本 · 命中 ' + wbEntries.length + ' 条 → 注入 ' + wbKeywordText.length + ' 字' + (novelVecText ? ' +向量 ' + novelVecText.length + ' 字' : '') + (worldInfoText ? '' : ' · ⚠️本回合世界书空！(书未加载或全未命中)') + '\n' +
        '预设条目：' + ((preset?.entries ?? []).length) + ' 总 / ' + ((preset?.entries ?? []).filter((e: any) => e.enabled && !e.marker).length) + ' 启用\n' +
        '拆分去向：system 分段 ' + sysSegments.length + ' 段 · 少样本 ' + examples.length + ' 条 · 后历史块 ' + tail.length + ' 块 · 深度注入 ' + depthInjections.length + '（+世界书 ' + wbDepthInjections.length + '）· prefill ' + (effectivePrefill ? '有' : '无') + '\n' +
        (tail.length ? '✅ 已认出 chatHistory marker：' + tail.length + ' 个后历史块已插到真实楼层之后(仿 fanren)\n' : '（无 chatHistory marker：全部当前历史，行为同旧版）\n') +
        '总消息条数：' + (1 + history.length) + '（1 条合并 system ＋ ' + history.length + ' 条历史/注入/输入/prefill）\n' +
        '合并 system 总长：~' + Math.round(sysPrompt.length / 3.5) + ' 词符 · 流式 ' + ((preset?.stream ?? textStream) ? '开' : '关') },
      { label: '📦 预设原文（仅预设块合并 · 不含前端规则/世界书）', role: 'preset', content: sysSegments.filter((s) => s.label.startsWith('预设块')).map((s) => s.content).join('\n\n') || '（本预设无 system 块）' },
      ...sysSegments.map((s) => ({ label: (s.label.startsWith('预设块') ? '🧩 ' : s.label.includes('世界书') ? '📚 ' : '🔧 ') + s.label, role: 'system', content: s.content })),
      ...examples.map((e, i) => ({ label: '💬 少样本示例 #' + (i + 1) + '（' + e.role + '）', role: e.role as string, content: e.content })),
      ...tail.map((t) => ({ label: '📜 后历史块 · ' + (t as any).label, role: t.role as string, content: t.content })),
      ...depthInjections.map((inj) => ({ label: '⚡ 深度注入 · ' + ((inj as any).label ?? '块') + ' · depth ' + inj.depth, role: inj.role, content: inj.content })),
      ...wbDepthInjections.map((inj) => ({ label: '⚡ 世界书·深度注入 · depth ' + inj.depth, role: inj.role, content: inj.content })),
      ...(effectivePrefill ? [{ label: '🅰 末尾预填充 prefill（assistant 续写）', role: 'assistant', content: effectivePrefill }] : []),
      { label: '① 合并后完整 system（实际发送的整段）', role: 'system', content: sysPrompt },
      { label: '② 完整发送序列（全部消息）', role: 'all', content: '=== SYSTEM ===\n' + sysPrompt + '\n\n=== MESSAGES ===\n' + history.map((m) => '[' + m.role + '] ' + m.content).join('\n\n') },
    ];
    setDebugParts(narrParts);
    // 主正文也登记进全局 API 日志（带结构化 parts + 待补响应），让开发者面板与各演化阶段统一分选项卡浏览
    narrLogId = apiDebugLog.push('📖 正文', [{ role: 'system', content: sysPrompt }, ...history], narrParts);
    // 记录本回合实际注入正文的「记忆/档案」块，供「查看注入记忆」核对
    {
      const vmOn = vm.enabled && !!vm.apiBase && !!vm.apiKey;   // 向量召回是否在生效
      const recallActive = narrativeMem.enabled || vmOn;        // 任一召回引擎启用
      const memBlock = memory.map((m) => m.content).join('\n\n');
      const structBlock = [...structPlayer, ...structRest].map((m) => m.content).join('\n\n');
      const segs: string[] = [];
      if (memBlock) segs.push(`【${vmOn ? '向量召回' : '叙事记忆召回'}】\n${memBlock}`);
      if (structBlock) segs.push(`【结构化档案召回】\n${structBlock}`);
      setInjectedMem(
        !recallActive
          ? '（未启用记忆召回——本回合按历史楼层切片，无召回/档案注入）'
          : segs.length
            ? segs.join('\n\n──────────\n\n')
            : '（记忆召回已启用，但本回合无任何记忆/档案被注入：素材库为空 或 无相关命中 或 无 NPC/角色数据）'
      );
    }
    setGenerating(true);
    setGenError('');
    const ac = new AbortController();
    abortRef.current = ac;
    stopAllRef.current = false;   // 新一轮生成：解除上次「停止生成」

    try {
      // 接口路由：按优先级逐个尝试，失败/非 OK 自动 fallback 到下一条；首个成功者用于（流式）读取
      let res: Response | null = null;
      let usedApi = apiChain[0];
      let lastErr: unknown;
      for (let ci = 0; ci < apiChain.length; ci++) {
        const ep = apiChain[ci];
        if (!ep.baseUrl || !ep.apiKey) continue;
        const reqBody: Record<string, unknown> = {
          model:       ep.modelId,
          messages:    [{ role: 'system', content: sysPrompt }, ...history],
          temperature: preset?.temperature ?? ep.temperature,
          max_tokens:  preset?.max_tokens  ?? Math.max(ep.maxTokens || 0, 60000),   // 按用户要求保持 60000（若遇变慢/network error，多为大提示词+60000 撑爆上下文，可调小）
          top_p:       preset?.top_p       ?? ep.topP,
          stream:      useStream,
        };
        if ((preset?.frequency_penalty ?? 0) !== 0) reqBody.frequency_penalty = preset!.frequency_penalty;
        if ((preset?.presence_penalty  ?? 0) !== 0) reqBody.presence_penalty  = preset!.presence_penalty;
        if ((preset?.seed ?? -1) !== -1)             reqBody.seed              = preset!.seed;
        if ((preset?.n ?? 1) > 1)                    reqBody.n                 = preset!.n;
        try {
          const r = await fetchWithProxy(ep.baseUrl.replace(/\/$/, '') + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ep.apiKey}` },
            body: JSON.stringify(reqBody),
            signal: ac.signal,
          });
          if (!r.ok) { const errText = await r.text(); lastErr = new Error(`HTTP ${r.status}: ${errText.slice(0, 160)}`); console.warn(`[正文] 接口失败${ci < apiChain.length - 1 ? '，回退下一条' : ''}：${ep.modelId}`, lastErr); continue; }
          res = r; usedApi = ep; break;
        } catch (e) { lastErr = e; console.warn(`[正文] 接口异常${ci < apiChain.length - 1 ? '，回退下一条' : ''}：${ep.modelId}`, e); }
      }
      if (!res) throw (lastErr ?? new Error('全部正文接口调用失败'));
      void usedApi;

      if (useStream) {
        // ── 流式读取 SSE ──
        const streamMsgId = ++msgId.current;
        setMessages((prev) => [...prev, { id: streamMsgId, role: 'assistant', content: '' }]);

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        let buffer = '';
        let aborted = false;
        progImgRef.current = { offset: 0, dispatched: 0 };   // 「边写边出」：每回合开始重置已派发段落

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // SSE 按行处理
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';   // 最后一行可能不完整，留到下次

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const data = trimmed.slice(5).trim();
              if (data === '[DONE]') continue;
              try {
                const json = JSON.parse(data);
                const delta = json.choices?.[0]?.delta?.content ?? '';
                if (delta) {
                  accumulated += delta;
                  // 流式期间显示原始内容，避免正则对不完整结构误判导致内容闪烁。
                  // 但"失控复读"（极其极其…数万字）若原样渲染会直接卡死前端，故廉价预检末尾、命中才就地折叠 accumulated：
                  // 折叠后它不再膨胀（解析/渲染都有界）；卡死的复读循环本就不会再吐 <state>，折叠不影响后续状态解析。
                  if (accumulated.length > 64 && /(.{1,8}?)\1{7,}$/s.test(accumulated.slice(-128)))
                    accumulated = collapseRunaway(accumulated);
                  setMessages((prev) =>
                    prev.map((m) => m.id === streamMsgId ? { ...m, content: accumulated } : m)
                  );
                  maybeDispatchProgressiveImages(accumulated, streamMsgId);   // 「边写边出」：每写完一段就给那段配图
                }
              } catch { /* 忽略解析失败的行 */ }
            }
          }
        } catch (streamErr: any) {
          if (streamErr?.name === 'AbortError') aborted = true;   // 用户手动停止
          else throw streamErr;
        }

        if (aborted) {
          // 手动停止：只清洗已生成的部分用于显示，不解析 state、不触发任何演化（避免半截数据污染存档）
          const partial = stripWorldSourceBlocks(stripVitalsBlocks(stripStateBlocks(applyRegex(accumulated, preset))));
          setMessages((prev) =>
            prev.map((m) => m.id === streamMsgId ? { ...m, content: partial || accumulated || '（已停止生成）' } : m)
          );
          console.log('[正文] 已手动停止，保留部分正文（未触发演化）');
          apiDebugLog.finish(narrLogId, accumulated || '（已停止）', true);
          return;   // finally 仍会执行 setGenerating(false)
        }
        // 流结束后：先剥掉泄漏进正文的思维链块（中转把 <think> 拍平进 content / 末尾 </think> 预填充被回显），再解析/渲染
        const cleaned = stripLeakedThinking(accumulated);
        lastRawNarrativeRef.current = cleaned;   // 存含指令原文，供「仅重算变量」复用
        if (/<世界结算>/.test(cleaned)) playSfx('fanfare');   // 世界结算 → 号角音效
        applyAllUpdates(cleaned);
        try { applyPlayerProfileCommands(cleaned, '', turnCountRef.current); } catch { /* 主角位置/外观/身份：正文若直接输出 character.B1.* 也即时生效，不必等主角演化阶段 */ }
        const settledText = stripKillBlocks(cleaned);   // 过渡期：剥除旧 <kill> 清单（不再结算进阶点）
        // 演化/解析读的正文：剥 <state>/<upstore> 等，但【保留】<状态结算> HP/EP 块（解析器与 HP/EP 管理阶段要吃它）
        const narrativeForEvoRaw = stripStateBlocks(applyRegex(settledText, preset));
        // 显示给玩家的正文：在此之上再剥掉 <状态结算>（纯数据通道，玩家看不到 HP/EP 原词，侧栏照旧用自定义血条名）
        const finalDisplayed = stripWorldSourceBlocks(stripVitalsBlocks(narrativeForEvoRaw));
        setMessages((prev) =>
          prev.map((m) => m.id === streamMsgId ? { ...m, content: finalDisplayed } : m)
        );
        setRawResponse(accumulated);
        apiDebugLog.finish(narrLogId, accumulated, true);
        if (!accumulated) throw new Error('模型未返回内容');
        // 演化阶段读的正文：去 state 块外，再去掉击杀结算块（保留 <状态结算> 供 HP/EP 结算用，避免演化AI看到点数又重复发 ap）
        const narrativeForEvo = narrativeForEvoRaw.replace(/<击杀结算>[\s\S]*?<\/击杀结算>/gi, '').trimEnd();
        lastNarrativeRef.current = narrativeForEvo;
        // 正文完成后：策略B先登场判断再并发其余阶段
        runPostNarrativePhases(narrativeForEvo, streamMsgId);
        return finalDisplayed;

      } else {
        // ── 非流式：等待完整响应 ──
        const rawText = await res.text();
        setRawResponse(rawText);
        apiDebugLog.finish(narrLogId, rawText, true);
        const data = JSON.parse(rawText);
        const reply: string = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '';
        if (!reply) throw new Error('模型未返回内容');
        const cleanedReply = stripLeakedThinking(reply);   // 剥泄漏进正文的思维链块（同流式路径）
        lastRawNarrativeRef.current = cleanedReply;   // 存含指令原文，供「仅重算变量」复用
        if (/<世界结算>/.test(cleanedReply)) playSfx('fanfare');   // 世界结算 → 号角音效
        applyAllUpdates(cleanedReply);
        try { applyPlayerProfileCommands(cleanedReply, '', turnCountRef.current); } catch { /* 主角位置/外观/身份：正文直接输出 character.B1.* 即时生效 */ }
        const settledReply = stripKillBlocks(cleanedReply);   // 过渡期：剥除旧 <kill> 清单（不再结算进阶点）
        // 演化/解析读的正文：剥 <state>/<upstore> 等，但【保留】<状态结算> HP/EP 块（解析器与 HP/EP 管理阶段要吃它）
        const narrativeForEvoRaw = stripStateBlocks(applyRegex(settledReply, preset));
        // 显示给玩家的正文：在此之上再剥掉 <状态结算>（纯数据通道，玩家看不到 HP/EP 原词）
        const processed = stripWorldSourceBlocks(stripVitalsBlocks(narrativeForEvoRaw));
        const newMsgId = ++msgId.current;
        setMessages((prev) => [...prev, { id: newMsgId, role: 'assistant', content: processed }]);
        // 演化阶段读的正文：去 state 块外，再去掉击杀结算块（保留 <状态结算> 供 HP/EP 结算用，避免演化AI看到点数又重复发 ap）
        const narrativeForEvo = narrativeForEvoRaw.replace(/<击杀结算>[\s\S]*?<\/击杀结算>/gi, '').trimEnd();
        lastNarrativeRef.current = narrativeForEvo;
        runPostNarrativePhases(narrativeForEvo, newMsgId);
        return processed;
      }
    } catch (e: any) {
      apiDebugLog.finish(narrLogId, String(e?.message ?? e ?? '失败'), false);
      if (e?.name === 'AbortError') { setGenError(''); console.log('[正文] 已手动停止生成'); }
      else setGenError(e.message ?? '请求失败');
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }

  /* 记录回退点：每次发送前，把"上一回合结束时"的状态（所有演化 store + 对话）存到固定槽，供回退/重新生成 */
  async function captureUndoPoint() {
    // 没有任何对话历史时不记回退点：空回退点一旦被回退/读档载入会把聊天清空（"回退后清屏、之前信息全没"的根因）。
    // 开局/进入世界时 messagesRef 尚为空（setMessages 异步、ref 本回合还没同步）→ 跳过即可；真正第一回合发送时
    // 历史已非空，会记下正确回退点。注意：勿在此 setCanUndo(false)，以免误关掉一个已存在的有效回退点。
    if (!messagesRef.current || messagesRef.current.length === 0) return;
    // 回退点**不含图片**：图片同设备由 imageDb 现存回填；带图会让每回合写入几十 MB→内存/配额压力大(页面崩溃主因之一)。
    // 代价：回退不还原"本回合新生成的图片"——可接受，换稳定与省内存；状态/对话照常回退。
    try { await saveSlot(UNDO_ID, '↩ 回退点', messagesRef.current, false); setCanUndo(true); }
    catch (e) { console.warn('[Undo] 记录回退点失败:', e); setGenError('记录回退点失败，"回退/重新生成"暂不可用（可能浏览器存储空间已满）'); setTimeout(() => setGenError(''), 6000); }
  }
  function stopGeneration() { abortRef.current?.abort(); }
  /* 停止生成全部变量：中止主正文 + 所有演化阶段 chat 调用 + 所有生图，并置位 stopAllRef 让批量/生图循环立即 bail */
  function stopAllPhases() {
    stopAllRef.current = true;
    abortRef.current?.abort();   // 主正文（若在生成）
    abortAllApiCalls();          // 全部演化阶段（物品/主角/NPC/势力/领地/冒险团/万族/杂项/记忆…走 apiChatFallback）
    abortAllImageGen();          // 全部生图（肖像/装备/正文配图）
    setFloorProg(null); setPhaseBusy({});
    setItemPhaseRunning(false); setPlayerPhaseRunning(false); setNpcPhaseRunning(false);
    setGenError('已停止所有变量生成'); setTimeout(() => setGenError(''), 3000);
  }
  /* 重算单项变量：取本回合正文（无则回退到最后一条 AI 正文）；空则提示不跑 */
  function revarNarr(): string {
    return lastNarrativeRef.current || [...(messagesRef.current ?? [])].reverse().find((m) => m.role === 'assistant')?.content || '';
  }
  function revarRun(fn: (n: string) => void): () => void {
    return () => { const n = revarNarr(); if (!n) { setGenError('暂无正文可重算（先发一条消息再重算）'); setTimeout(() => setGenError(''), 4000); return; } fn(n); };
  }
  // 「按楼层批量更新」：把某变量的演化在指定「正文楼层」范围内分批重跑（每 N 层一批，逐批顺序调用其演化）。
  // 仅支持吃正文的 8 个阶段（item 走 core；其余 run*EvolutionPhase）；记忆/生图不吃正文不在此列。
  const BATCH_RUNNERS: Record<string, (n: string) => Promise<void> | void> = {
    item: runItemManagementPhaseCore, player: runPlayerEvolutionPhase, npc: runNpcEvolutionPhase,
    faction: runFactionEvolutionPhase, territory: runTerritoryEvolutionPhase, team: runTeamEvolutionPhase,
    cosmos: runCosmosEvolutionPhase, misc: runMiscEvolutionPhase,
  };
  function narrativeFloors(): string[] {   // 楼层 = 每条 AI 正文（从旧到新）
    return (messagesRef.current ?? []).filter((m) => m.role === 'assistant' && m.content).map((m) => m.content as string);
  }
  function openFloorCfg(fk: string, label: string) {
    const T = narrativeFloors().length;
    setFloorCfg({ fk, label, total: T });
    setFloorStart(String(T || 1)); setFloorEnd(String(T || 1)); setFloorStep('1'); setFloorExtra('');   // 默认=只更新最新一层（即原「最新正文」行为）·额外提示词清空
  }
  async function runFloorBatches() {
    const cfg = floorCfg; if (!cfg) return;
    const floors = narrativeFloors(); const T = floors.length;
    const runner = BATCH_RUNNERS[cfg.fk];
    setFloorCfg(null);
    stopAllRef.current = false;   // 开始批量更新：解除上次「停止生成」
    if (!runner || T === 0) return;
    let start = Math.max(1, Math.min(T, Math.round(Number(floorStart) || 1)));
    let end = Math.max(1, Math.min(T, Math.round(Number(floorEnd) || T)));
    if (start > end) { const t = start; start = end; end = t; }
    const step = Math.max(1, Math.round(Number(floorStep) || 1));
    const batches: [number, number][] = [];
    for (let lo = start; lo <= end; lo += step) batches.push([lo, Math.min(end, lo + step - 1)]);
    const extra = floorExtra.trim();   // 本次额外提示词：附到每批正文末尾喂给演化（trimNarrative 留尾，附末尾不会被截掉）
    setPhaseFail((p) => { if (!p[cfg.fk]) return p; const n = { ...p }; delete n[cfg.fk]; return n; });
    try {
      for (let bi = 0; bi < batches.length; bi++) {
        if (stopAllRef.current) break;   // 「停止生成」：不再发起后续批次
        const [lo, hi] = batches[bi];
        setFloorProg({ fk: cfg.fk, cur: bi + 1, total: batches.length });
        let chunk = floors.slice(lo - 1, hi).join('\n\n');
        if (extra) chunk += `\n\n【本次手动更新·玩家额外要求（请在更新该变量时优先遵循）】：${extra}`;
        if (chunk.trim()) { try { await runner(chunk); } catch (e) { console.warn('[按楼层更新] 批次失败', e); } }
      }
    } finally { setFloorProg(null); }
  }
  /* 聊天室悬浮气泡·拖动：夹紧在叙事区容器内；移动超过阈值算"拖动"（拖完那次 click 不开聊天室） */
  function clampBubbleOff(dx: number, dy: number) {
    const host = chatBubbleHostRef.current; if (!host) return { dx, dy };
    const r = host.getBoundingClientRect(); const S = 48, M = 8;
    const minDx = M - 16, maxDx = Math.max(minDx, r.width - S - M - 16);
    const minDy = M - (r.height - 64), maxDy = Math.max(minDy, 16 - M);
    return { dx: Math.max(minDx, Math.min(dx, maxDx)), dy: Math.max(minDy, Math.min(dy, maxDy)) };
  }
  function onChatBubbleDown(e: RPointerEvent<HTMLButtonElement>) {
    const d = chatBubbleDrag.current;
    d.active = true; d.sx = e.clientX; d.sy = e.clientY; d.bx = chatBubbleOff.dx; d.by = chatBubbleOff.dy; d.moved = false; d.lx = chatBubbleOff.dx; d.ly = chatBubbleOff.dy;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
  }
  function onChatBubbleMove(e: RPointerEvent<HTMLButtonElement>) {
    const d = chatBubbleDrag.current; if (!d.active) return;
    const ddx = e.clientX - d.sx, ddy = e.clientY - d.sy;
    if (Math.abs(ddx) + Math.abs(ddy) > 5) d.moved = true;
    const c = clampBubbleOff(d.bx + ddx, d.by + ddy);
    d.lx = c.dx; d.ly = c.dy; setChatBubbleOff(c);
  }
  function onChatBubbleUp(e: RPointerEvent<HTMLButtonElement>) {
    const d = chatBubbleDrag.current; if (!d.active) return; d.active = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* */ }
    if (d.moved) { try { localStorage.setItem('drpg-chat-bubble-off', JSON.stringify({ dx: d.lx, dy: d.ly })); } catch { /* */ } }
  }
  function onChatBubbleClick() {
    if (chatBubbleDrag.current.moved) { chatBubbleDrag.current.moved = false; return; }   // 刚拖动完，不当作点击
    setChatRoomOpen(true);
  }
  /* 右侧导航·标签 → 打开对应面板（命令面板与导航按钮共用同一份开法，保证一致） */
  function runNavAction(label: string) {
    const open =
      label === '设置' ? () => setSettingsOpen(true) :
      label === '储存空间' ? () => setBackpackOpen(true) :
      label === '装备' ? () => setEquipOpen(true) :
      label === '技能' ? () => setCharPanelOpen(true) :
      label === '称号' ? () => setTitlePanelOpen(true) :
      label === '成就' ? () => setAchievePanelOpen(true) :
      label === '副职业' ? () => setSubProfOpen(true) :
      label === '技能树' ? () => setSkillTreeOpen(true) :
      label === '势力' ? () => setFactionPanelOpen(true) :
      label === '领地' ? () => setTerritoryPanelOpen(true) :
      label === '冒险团' ? () => setTeamPanelOpen(true) :
      label === '万族' ? () => setCosmosPanelOpen(true) :
      label === '世界百科' ? () => setWorldCodexOpen(true) :
      label === '轮回WIKI' ? () => setWikiOpen(true) :
      label === '回合洞察' ? () => setInsightOpen(true) :
      label === 'ROLL' ? () => setDicePanelOpen(true) :
      label === '战斗' ? () => { if (mpGuest) { setGenError('联机中：战斗由房主发起'); setTimeout(() => setGenError(''), 4000); return; } setCombatSetupOpen(true); } :
      label === '乐园设施' ? () => setFacilitiesOpen(true) :
      label === '深渊' ? () => setAbyssOpen(true) :
      label === 'NPC'  ? () => setNpcPanelOpen(true) :
      label === '任务' ? () => setMiscPanelOpen(true) :
      label === '频道' ? () => setChannelPanelOpen(true) :
      label === '私信' ? () => { setDmFocusThread(undefined); setDmPanelOpen(true); } :
      label === '好友' ? () => setFriendsPanelOpen(true) :
      label === '队伍' ? () => setPartyPanelOpen(true) :
      label === '联机' ? () => setMpPanelOpen(true) :
      label === '聊天室' ? () => setChatRoomOpen(true) :
      label === '交易行' ? () => setTradeOpen(true) :
      label === '助战' ? () => setAssistOpen(true) :
      label === '纪念丰碑' ? () => setMonumentOpen(true) :
      label === '记忆' ? () => setSummaryPanelOpen(true) :
      label === '存档' ? () => setSaveOpen(true) :
      label === '创意工坊' ? () => setWorkshopOpen(true) :
      undefined;
    open?.();
  }
  /* 回退到上一回合：恢复所有演化/对话/图到发送本回合之前（整页 reload）*/
  async function rollbackTurn() {
    // 守卫：回退点为空(旧版遗留/开局所记)就不执行——否则会把聊天清成空白。同步关掉按钮。
    if (!(await undoPointHasChat())) { setCanUndo(false); setGenError('没有可回退的对话（回退点为空，避免清屏已取消）'); setTimeout(() => setGenError(''), 5000); return; }
    const ok = await loadSlot(UNDO_ID);
    if (!ok) { setGenError('没有可回退的回合（本局还没产生过回退点）'); setTimeout(() => setGenError(''), 5000); }
  }
  /* 重新生成本次正文：先回退到本回合之前，reload 后自动重发同一条输入（演化不会叠加）*/
  async function regenerateTurn() {
    // 输入优先用本会话内存值；刷新/读档后内存丢失，则回退到对话历史里最后一条用户消息
    // （读档恢复的对话仍含它）——这样读档后也能「重新生成」上一回合。
    const input = lastUserInputRef.current || ([...(messagesRef.current ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '');
    if (!input) { setGenError('找不到可重新生成的上一条输入（请直接重新输入）'); setTimeout(() => setGenError(''), 5000); return; }
    // 守卫：回退点为空则不执行——否则回退到空白聊天后再重发，会丢掉前文
    if (!(await undoPointHasChat())) { setCanUndo(false); setGenError('没有可重新生成的回合（回退点为空）'); setTimeout(() => setGenError(''), 5000); return; }
    try { sessionStorage.setItem(PENDING_REGEN_KEY, input); } catch { /* */ }
    const ok = await loadSlot(UNDO_ID);
    if (!ok) { try { sessionStorage.removeItem(PENDING_REGEN_KEY); } catch { /* */ } setGenError('没有回退点，无法重新生成'); setTimeout(() => setGenError(''), 5000); }
  }
  /* 仅重算变量（保留正文）：回退到本回合之前 → reload → 复用本回合原正文重跑「指令解析+全部演化」，不重新生成正文。
     必须先回退，否则会在已应用过的状态上二次叠加（HP/物品翻倍等）。原文(含 <state>)存 lastRawNarrativeRef，刷新会丢→须本会话内点。*/
  async function regenerateVarsOnly() {
    const raw = lastRawNarrativeRef.current;
    const input = lastUserInputRef.current;
    if (!raw) { setGenError('拿不到本回合正文原文（刷新后会丢失），请改用「重新生成」'); setTimeout(() => setGenError(''), 5000); return; }
    try { sessionStorage.setItem(PENDING_REVAR_KEY, JSON.stringify({ input, narrative: raw })); } catch { /* */ }
    const ok = await loadSlot(UNDO_ID);
    if (!ok) { try { sessionStorage.removeItem(PENDING_REVAR_KEY); } catch { /* */ } setGenError('没有回退点，无法重算变量'); setTimeout(() => setGenError(''), 5000); }
  }
  /* 回退点 reload 后：重建本回合对话(用户输入+原正文) + 重跑指令解析与全部演化。等价 callApi 收到正文后的处理，但跳过调用 AI 生成正文。*/
  function reprocessVars(rawNarrative: string, userInput: string) {
    turnCountRef.current += 1;
    try { useMisc.getState().setTurnCount(turnCountRef.current); } catch { /* */ }
    try { useItems.getState().setItemTurn(turnCountRef.current); } catch { /* */ }
    lastUserInputRef.current = userInput;
    expireStatuses(turnCountRef.current);
    reconcileHomeWorld(); reconcilePlayerVitals(); syncPlayerVitalsMax(); reconcilePartyLifecycle();
    if (userInput) setMessages((prev) => [...prev, { id: ++msgId.current, role: 'user', content: userInput }]);
    const cleaned = stripLeakedThinking(rawNarrative);
    lastRawNarrativeRef.current = cleaned;
    applyAllUpdates(cleaned);
    try { applyPlayerProfileCommands(cleaned, '', turnCountRef.current); } catch { /* */ }
    const settled = stripKillBlocks(cleaned);
    const _ssEvo = useSettings.getState();   // 同上：实时读 store，免 stale 闭包导致演化也拿不到预设
    const preset = resolveActivePreset(_ssEvo);
    const narrativeForEvoRaw = stripStateBlocks(applyRegex(settled, preset));
    const processed = stripWorldSourceBlocks(stripVitalsBlocks(narrativeForEvoRaw));
    const newMsgId = ++msgId.current;
    setMessages((prev) => [...prev, { id: newMsgId, role: 'assistant', content: processed }]);
    const narrativeForEvo = narrativeForEvoRaw.replace(/<击杀结算>[\s\S]*?<\/击杀结算>/gi, '').trimEnd();
    lastNarrativeRef.current = narrativeForEvo;
    runPostNarrativePhases(narrativeForEvo, newMsgId);
  }

  async function sendMessage(textArg?: string) {
    const text = (textArg ?? inputValue).trim();
    if (!text || generating || guidanceRunning) return;   // 剧情指导前置阶段也算「忙」，防重复发起并发调用

    // ── 联机分叉 ──
    const mp = useMp.getState();
    // 来宾：不调 AI，提交行动给房主 + 本地回显，等房主广播正文（恒提交·恒收广播 = 单一房主权威正文）
    // 分头行动：splitMode 时给提交文本加标记，房主在同一份正文里把你写成「脱离主队独自行动」（不再各端独立生成，杜绝剧情冲突/瞬移/NPC 不同步）
    if (mp.status === 'connected' && mp.role === 'player') {
      const submitText = mp.splitMode ? `【分头行动·脱离主队独自行动】${text}` : text;
      mpClient.submitInput(submitText, buildPlayerSnapshot());
      setMessages((prev) => [...prev, { id: ++msgId.current, role: 'user', content: mp.splitMode ? `🚶（分头行动）${text}` : text }]);
      if (textArg == null) setInputValue('');
      return;
    }

    await captureUndoPoint();   // 发送前记录回退点（=上一回合结束状态）
    // 房主：把队友本回合已提交的行动并进这一回合（无队友行动则与单人完全一致）
    const isMpHost = mp.status === 'connected' && mp.role === 'host';
    const inject = isMpHost ? checkHiddenConditions() : '';   // 隐藏条件达成 → 解锁注入（确定性检查全队物品）
    const withConv = (s: string) => inject ? `${inject}\n\n${s}` : s;

    const effectiveText = isMpHost ? withConv(buildPartyTurnText(text, mp.turn?.inputs, usePlayer.getState().profile.name || mp.room?.hostName || '房主')) : text;

    const userMsg: ChatMessage = { id: ++msgId.current, role: 'user', content: effectiveText };
    setMessages((prev) => [...prev, userMsg]);
    if (textArg == null) setInputValue('');
    const narrative = await callApi(effectiveText);

    // 房主：把算好的正文广播给全房，并开启下一回合（清空本回合已用的队友行动）
    if (isMpHost && narrative) {
      mpClient.publishWorld({ narrative, turnUser: effectiveText, turnId: mp.turn?.turnId || 0, world: buildWorldSnapshot() });
      if (mp.seats.length > 0) mpClient.startTurn();
    }
  }

  /* 角色创建·开场白：用创建数据填充模板（设置里有自定义则用自定义） */
  function buildOpening(d: CreationData): string {
    const custom = useSettings.getState().customOpening?.trim();
    const attrStr = `力${d.attrs.str} 敏${d.attrs.agi} 体${d.attrs.con} 智${d.attrs.int} 魅${d.attrs.cha} 幸${d.attrs.luck}`;
    const talentFull = formatCreationTalent(d);   // 天赋·正文固定格式整行（含评级/类型/等级/来源/效果/属性加成/简描）
    if (custom) {
      const A = d.attrs;
      // 占位符 → 值：英文名与中文别名都认，含单个六维(中英)、外观、契约者编号；未知占位符原样保留(便于发现拼错)。
      const vars: Record<string, string> = {
        name: d.name, 主角名: d.name, 名字: d.name, 姓名: d.name,
        age: d.age || '未知', 年龄: d.age || '未知',
        gender: d.gender || '未知', 性别: d.gender || '未知',
        race: d.race || '人类', 种族: d.race || '人类',
        raceDetail: d.raceDetail || '', 种族详情: d.raceDetail || '',
        personality: d.personality || '—', 性格: d.personality || '—',
        personalityDetail: d.personalityDetail || '', 性格描述: d.personalityDetail || '', 性格详情: d.personalityDetail || '',
        prevProfession: d.prevProfession || '普通人', 入园前职业: d.prevProfession || '普通人', 职业: d.prevProfession || '普通人',
        paradise: d.paradise, 乐园: d.paradise, 所属乐园: d.paradise,
        difficulty: d.difficulty, 难度: d.difficulty,
        appearance: d.appearance?.trim() || '（待你在后续描写中确立）', 外观: d.appearance?.trim() || '（待你在后续描写中确立）',
        talentName: d.talentName || '（无）', 天赋名: d.talentName || '（无）', 天赋: d.talentName || '（无）',
        talentEffect: d.talentEffect || '', 天赋效果: d.talentEffect || '',
        talentDesc: d.talentDesc || '', 天赋描述: d.talentDesc || '', 天赋简描: d.talentDesc || '',
        talentRarity: d.talentRarity || '', 天赋评级: d.talentRarity || '', 天赋品级: d.talentRarity || '',
        talentCategory: d.talentCategory || '', 天赋类型: d.talentCategory || '', 天赋类别: d.talentCategory || '',
        talentLevel: d.talentLevel || '', 天赋等级: d.talentLevel || '',
        talentSource: d.talentSource || '', 天赋来源: d.talentSource || '',
        talentAttrBonus: d.talentAttrBonus || '', 天赋属性加成: d.talentAttrBonus || '',
        talentFull: talentFull || '（无）', 天赋全文: talentFull || '（无）', 天赋固定格式: talentFull || '（无）',
        contractId: d.contractId || '随机分配中', 契约者ID: d.contractId || '随机分配中', 契约者编号: d.contractId || '随机分配中', 编号: d.contractId || '随机分配中',
        attrs: attrStr, 六维: attrStr, 属性: attrStr,
        str: String(A.str), 力: String(A.str),
        agi: String(A.agi), 敏: String(A.agi),
        con: String(A.con), 体: String(A.con),
        int: String(A.int), 智: String(A.int),
        cha: String(A.cha), 魅: String(A.cha),
        luck: String(A.luck), 幸: String(A.luck),
      };
      return custom.replace(/\$\{([^}]+)\}/g, (m, key) => {
        const k = String(key).trim();
        return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m;
      });
    }
    const park = d.paradise;
    const user = d.name;
    const talent = d.talentName || '（未觉醒）';
    const talentFmt = talentFull || '（未觉醒）';   // 天赋·正文固定格式整行
    const talentDesc = [d.talentEffect, d.talentDesc].filter(Boolean).join('；') || '（尚无明确说明，等待在试炼中显现）';
    const pastLife = `${d.age || '未知'}岁 · ${d.prevProfession || '普通人'}${d.personality ? `（${d.personality}）` : ''}`;
    const persona = d.personalityDetail?.trim() || d.personality?.trim() || '';   // 性格：优先用详细描述，回退到简短特质
    const contractNo = d.contractId || '随机分配中';
    return [
      `# ${park}·开局`,
      `你在彻底的黑暗中苏醒。没有呼吸，没有心跳，连身体的轮廓都仿佛被剥离，只剩下意识在冰冷虚空中漂浮。`,
      `下一瞬，一行行淡金色的文字在你面前浮现——它们不是光，而是直接烙进灵魂的讯息。`,
      `> 【${park}】正在校验灵魂。\n> 标识：${user}\n> 生理状态：死亡 / 临界。\n> 适配判定：通过。\n> 所属乐园：${park}\n> 难度评级：${d.difficulty}\n> 主角背景：${pastLife}${persona ? `\n> 性格：${persona}` : ''}\n> 性别：${d.gender || '未知'}\n> 种族：${d.race || '人类'}${d.raceDetail ? `（${d.raceDetail}）` : ''}\n> 外观：${d.appearance?.trim() || '（待你在后续描写中确立）'}\n> 六维属性：${attrStr}\n> 初始天赋：${talentFmt}\n> 契约者编号：${contractNo}`,
      `某种冷漠却并不敌意的目光，从上而下打量着你。那不是人类的视角，更像是在审阅一份可回收资源。`,
      `它向你伸出了一只手——不是肉体的手，而是一份连注释都冷冰冰的契约。`,
      `只要应答，你将被记录为「${park}·一阶预备契约者」，以「${talent}」之天赋记录，投放诸多世界。`,
      `成功者获得力量、地位与不可名状之物。失败者，则被执行【强制处决】——灵魂拆解，全部收益与残渣一并回收。`,
      `作为「${talent}」天赋的持有者，你被允许携带如下倾向与缺陷：\n${talentDesc}`,
      `没有人向你解释更多规则，因为在这里，"不清楚"本身也是一种测试。`,
      `黑暗深处，有某种东西在注视你。你伸出手。指尖碰到那枚悬浮的乐园印记。`,
      `——刺痛、自我剥离、数据化、编号写入。`,
      `当意识再度聚拢时，你已经站在一座陌生而冰冷的大厅中。【${park}】的提示音在耳边响起：`,
      `> 欢迎加入，契约者。\n> 初始天赋：${talent} 已记录完毕。\n> ${d.contractId ? `契约者编号：${d.contractId} 已写入。` : '随机分配契约者编号中。'}\n> 请查看您的天赋与技能情况。\n> - 系统载入中……\n>   - 请做好准备。`,
      `从这一刻起，你的每一次"活着"，都将写在乐园的结算列表里。你将有三小时的时间适应环境，乐园将不会为你安排任务。`,
    ].join('\n\n');
  }

  /* 角色创建确认：清空旧进度 → 写入主角演化变量 → 发送开场白（全新存档） */
  async function confirmCreation(d: CreationData) {
    await clearProgress();   // 开始游戏=全新存档：先清空之前的玩家/NPC/物品/角色/杂项/对话
    msgId.current = 0;
    turnCountRef.current = 0;   // 新存档：回合数归零（不依赖刷新；下方 setStarted/setMessages 会触发重渲染刷新显示）
    try { useMisc.getState().setTurnCount(0); } catch { /* 累计回合数归零（clearProgress 也会清，双保险） */ }
    messagesRef.current = [];   // 立即清空内存历史，杜绝上一局聊天/回合残留
    const P = usePlayer.getState();
    P.setProfile({
      name: d.name,
      gender: d.gender || undefined,      // 性别（开局设定，生图据此强制 1boy/1girl）
      race: d.race || undefined,          // 种族（开局设定）
      raceDetail: d.raceDetail || undefined,   // 种族详情（自由文本）
      personality: d.personality || undefined,           // 性格特质（简短）
      personalityDetail: d.personalityDetail || undefined,   // 性格详细描述（主角面板点击查看 + 注入 AI 上下文）
      homeParadise: d.paradise,
      preParadiseJob: d.prevProfession,   // 主角背景=入园前职业（开局设定）
      contractorId: d.contractId,         // 契约者ID（开局设定，可留空）
      baseAppearance: d.appearance || undefined,   // 基底外观（不可变，生图始终包含）
      appearance: d.appearance || '',     // 初始外观=基底外观（之后随剧情演化）
      attrs: { ...d.attrs },
      background: `【开局设定】所属乐园：${d.paradise}｜游戏难度：${d.difficulty}（${d.points}属性点）｜性别：${d.gender || '未知'}｜种族：${d.race || '人类'}${d.raceDetail ? `（${d.raceDetail}）` : ''}｜年龄：${d.age || '未知'}｜性格：${d.personality || '—'}｜主角背景：${d.prevProfession || '普通人'}`,
    });
    // 开局按六维换算 HP/EP 上限（体质×20 / 智力×15）并拉满，避免主角永远停在 100/50 默认值
    { const g = useGame.getState(); const pf = usePlayer.getState().profile; const rmC = realAttrMult(pf.tier, pf.level); const mh = computeMaxHp(d.attrs, rmC), me = computeMaxEp(d.attrs, rmC);
      g.setPlayerField('maxHp', mh); g.setPlayerField('hp', mh); g.setPlayerField('maxMp', me); g.setPlayerField('mp', me); }
    if (d.talentName) {
      useCharacters.getState().addTrait('B1', {
        name: d.talentName,
        desc: d.talentDesc?.trim() || d.talentEffect,
        effect: d.talentEffect,
        rarity: d.talentRarity?.trim() || 'C',
        category: d.talentCategory?.trim() || '特殊异能类',
        level: d.talentLevel?.trim() || undefined,
        source: d.talentSource?.trim() || '开局自带',
        attrBonus: d.talentAttrBonus?.trim() || undefined,
      });
    }
    setCreating(false);
    setStarted(true);
    const opening = buildOpening(d);
    const userMsg: ChatMessage = { id: ++msgId.current, role: 'user', content: opening };
    messagesRef.current = [];   // 全新存档：历史清空，避免 callApi 取到旧对话
    setMessages([userMsg]);
    await captureUndoPoint();   // 记录开局回退点（角色已建、对话为空）→ 让开局也能「重新生成/回退」
    await callApi(opening, []);
  }

  // 选择世界：把卡片全部内容作为上下文发给 API
  async function enterWorld(world: WorldOption) {
    setWorlds([]);
    setCardIndex(0);

    const lines: string[] = [`【进入世界：${world.name}】`];
    if (world.worldType)   lines.push(`类型：${world.worldType}`);
    if (world.tier)        lines.push(`阶位：${world.tier}`);
    if (world.dangerLevel) lines.push(`难度：${world.dangerLevel}`);
    if (world.desc)        lines.push(`\n世界简介：\n${world.desc}`);
    if (world.peakPower)   lines.push(`\n巅峰战力：${world.peakPower}`);
    if (world.entryPoint)  lines.push(`\n切入点：\n${world.entryPoint}`);
    if (world.mainMission) lines.push(`\n主线任务：\n${world.mainMission}`);
    if (world.sideMission) lines.push(`\n支线任务：\n${world.sideMission}`);
    if (world.warning)     lines.push(`\n警告：\n${world.warning}`);
    if (world.reward)      lines.push(`\n奖励预览：${world.reward}`);
    if (world.region)      lines.push(`\n任务区域：${world.region}`);

    const contextText = lines.join('\n');
    // 进入任务世界：立即把「当前世界」设为该世界名、清空世界时间（底部状态栏即时反映当前世界，
    // 之后由杂项演化按正文细化 worldTime；worldName 始终跟随正文/所在世界，不写死轮回乐园）
    try { useMisc.getState().setTime({ worldName: world.name || '', worldTime: '' }); } catch { /* */ }
    // 进入新任务世界：把"所处世界已知、且明显不属于新世界"的旧势力移出当前世界（避免上个世界的势力继续挂在新世界出不去）
    try {
      const F = useFaction.getState();
      const norm = (s: string) => s.replace(/[\s·•・\-—_,，。、|｜（）()【】]/g, '').toLowerCase();
      const nn = norm((world.name || '').trim());
      if (nn) for (const f of Object.values(F.factions)) {
        if (!f.inCurrentWorld) continue;
        const fw = norm((f.worldName || '').trim());
        if (fw && !fw.includes(nn) && !nn.includes(fw)) F.setWorld(f.id, false);
      }
    } catch { /* */ }
    const systemMsg: ChatMessage = { id: ++msgId.current, role: 'user', content: contextText };
    // 切换世界**不再清空对话**：把世界入场作为新楼层追加，旧世界正文继续保留在聊天里（不会"页面被清空"）。
    // 给正文 AI 的上下文仍由「历史楼层限制 historyLimit」截断——callApi 取 messagesRef.current 的最近 N 楼，
    // 故旧世界几楼后自然滚出上下文，不串味；导出小说时整条 messages 跨全部世界，天然完整。
    setMessages((prev) => [...prev, systemMsg]);
    await captureUndoPoint();   // 记录进入世界前的回退点 → 让「进入世界」的首条正文也能重新生成/回退
    await callApi(contextText, []);   // extraHistory=[] → callApi 内部回退用 messagesRef.current（按 historyLimit 截断）
  }

  if (settingsOpen) {
    return <Suspense fallback={null}><SettingsPanel onClose={() => setSettingsOpen(false)} onOpenSaveLoad={() => { setSettingsOpen(false); setSaveOpen(true); }} /></Suspense>;
  }

  if (!started) {
    return (
      <Suspense fallback={null}>
        <StartScreen
          hasSave={hasSave}
          onStart={() => setCreating(true)}
          onContinue={() => setSaveOpen(true)}
          onSettings={() => setSettingsOpen(true)}
        />
        {creating && (
          <CharacterCreation onConfirm={confirmCreation} onCancel={() => setCreating(false)} />
        )}
        {saveOpen && (
          <SaveLoadPanel messages={messages} onClose={() => setSaveOpen(false)} />
        )}
      </Suspense>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-void text-slate-300 overflow-hidden" style={{ fontFamily: 'var(--app-font)' }}>

      {/* 主角自检兜底：自动从镜像恢复后的提示横幅（可关） */}
      {b1Notice && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-god/15 border-b border-god/40 text-god text-[13px] font-mono">
          <span className="shrink-0">🛟</span>
          <span className="flex-1 leading-snug">{b1Notice}</span>
          <button onClick={() => setB1Notice('')} className="shrink-0 px-2 py-0.5 border border-god/40 rounded hover:bg-god/10">知道了</button>
        </div>
      )}

      {/* ── 顶部状态栏 ── */}
      <header className={`shrink-0 h-14 flex items-center justify-between px-3 border-b border-edge bg-panel z-10 relative overflow-hidden ${(weatherFxOn && !!miscWeather && !isHomeWorld(miscWorldName) && isLightSky(parseWeather(miscWeather).kind)) ? 'wfx-lt' : ''}`}>
        <WeatherFx weather={miscWeather} active={weatherFxOn && !!miscWeather && !isHomeWorld(miscWorldName)} aiCss={miscWeatherFxKey === miscWeather ? miscWeatherFxCss : ''} />
        <div className="flex-1 flex items-center gap-2 text-xs font-mono min-w-0 relative z-10">
          <button
            onClick={() => setMobileDrawer((d) => (d === 'player' ? null : 'player'))}
            aria-label="角色面板"
            className="lg:hidden w-8 h-8 flex items-center justify-center border border-edge rounded text-god hover:bg-god/10 transition-colors text-base"
          >
            ☰
          </button>
          <button
            onClick={() => setStarted(false)}
            className="px-2 py-0.5 border border-edge rounded text-dim hover:border-blood/40 hover:text-blood transition-colors"
          >
            ← <span className="max-lg:hidden">主界面</span>
          </button>
        </div>
        <div className="text-center font-mono shrink-0 max-lg:min-w-0 max-lg:max-w-[46vw] relative z-10">
          <div className="hdr-time text-slate-100 text-lg max-lg:text-[13px] max-lg:leading-tight font-bold max-lg:truncate">🕒 {miscParadiseTime || '——'}</div>
          <div className="hdr-sub text-dim text-xs max-lg:text-[9px] mt-0.5 max-lg:truncate">
            {miscWorldName || '轮回乐园'}
            {/* 回归乐园时显示与轮回历一致的时间（兜底：底层数据下回合同步）*/}
            {(() => { const wt = isHomeWorld(miscWorldName) ? (miscParadiseTime || miscWorldTime) : miscWorldTime; return wt ? ` · ${wt}` : ''; })()}
            {miscWeather ? ` · ${miscWeather}` : ''}
          </div>
        </div>
        {/* 右半区：万族滚动条（居中于「时间 ↔ 存档」之间，时间保持正中）+ 存档/菜单按钮 */}
        <div className="flex-1 flex items-center justify-end gap-2 min-w-0 relative z-10">
          {cosmosTicker && (
            <div className="hidden lg:flex flex-1 min-w-0 items-center mx-2 h-7 overflow-hidden px-2" title={cosmosTicker}>
              <div className="flex-1 min-w-0 overflow-hidden whitespace-nowrap">
                <span className="hdr-ticker we-marquee inline-block text-[12px] font-mono text-slate-300/90">{cosmosTicker}</span>
              </div>
            </div>
          )}
          <button
            onClick={() => setSaveOpen(true)}
            className="px-2.5 py-1 border border-god/40 rounded text-god hover:bg-god/10 text-xs font-bold font-mono transition-colors max-lg:hidden"
          >
            💾<span className="max-lg:hidden"> 存档</span>
          </button>
          {/* 🔍 命令面板（放在原「功能菜单 ⊞」位置·靠右远离返回键防误触；桌面 Ctrl/⌘K 亦可）*/}
          <button
            onClick={() => setCmdkOpen(true)}
            title="命令面板 · 快速跳转面板（Ctrl/⌘ K）"
            aria-label="命令面板"
            className="w-8 h-8 flex items-center justify-center border border-edge rounded text-god hover:bg-god/10 transition-colors text-base shrink-0"
          >🔍</button>
        </div>
      </header>

      {/* ── 主体3栏 ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* 手机端抽屉遮罩（点击关闭）*/}
        {mobileDrawer && (
          <div
            className="lg:hidden fixed inset-x-0 top-14 bottom-0 z-40 bg-black/50"
            onClick={() => setMobileDrawer(null)}
          />
        )}

        {/* ── 左侧角色面板（桌面常驻列 / 手机左侧抽屉）── */}
        <aside
          className={`shrink-0 w-72 border-r border-edge bg-panel flex flex-col overflow-hidden
            max-lg:fixed max-lg:top-14 max-lg:bottom-0 max-lg:left-0 max-lg:z-50 max-lg:max-w-[82vw]
            max-lg:shadow-[8px_0_40px_rgba(0,0,0,0.7)] max-lg:transition-transform max-lg:duration-300
            ${mobileDrawer === 'player' ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full'}`}
        >
          <PlayerSidebar />
        </aside>

        {/* ── 中间主内容区 ── */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* 叙事/对话滚动区 */}
          <div ref={chatBubbleHostRef} className="flex-1 overflow-hidden relative">
            {/* 💬 聊天室悬浮气泡（可拖动·点击开聊天室·拖动位置记忆 localStorage）*/}
            <button
              onPointerDown={onChatBubbleDown}
              onPointerMove={onChatBubbleMove}
              onPointerUp={onChatBubbleUp}
              onPointerCancel={onChatBubbleUp}
              onClick={onChatBubbleClick}
              title="聊天室（可拖动）"
              style={{ transform: `translate(${chatBubbleOff.dx}px, ${chatBubbleOff.dy}px)` }}
              className="absolute bottom-4 left-4 z-30 w-12 h-12 rounded-full bg-god/20 border border-god/50 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,0,0,0.55)] flex items-center justify-center text-xl hover:bg-god/30 transition-colors cursor-grab active:cursor-grabbing touch-none select-none"
            >
              💬
              {chatUnread > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-blood text-white text-[10px] font-bold flex items-center justify-center leading-none animate-pulse shadow">{chatUnread > 99 ? '99+' : chatUnread}</span>
              )}
              {chatOnline > 0 && (
                <span className="absolute -bottom-1 -right-1 flex items-center gap-0.5 px-1 h-[15px] rounded-full bg-emerald-600 border border-void text-white text-[9px] font-bold leading-none" title={`${chatOnline} 人在线`}>
                  <span className="w-1 h-1 rounded-full bg-emerald-200" />{chatOnline > 99 ? '99+' : chatOnline}
                </span>
              )}
            </button>
            {/* 左上角「主角装备」/ 右上角「在场人物」/ 右下角「物品栏」浮窗（仅叙事视图；手机端隐藏，改用左/右抽屉）*/}
            {worlds.length === 0 && started && (
              <div className="max-lg:hidden">
                <PlayerEquipPanel />
                <OnScenePanel onOpenNpc={setOnSceneDetailId} />
                <ItemListPanel />
              </div>
            )}
            {worlds.length > 0 ? (
              <WorldCardView
                worlds={worlds}
                index={cardIndex}
                onPrev={() => setCardIndex((i) => (i - 1 + worlds.length) % worlds.length)}
                onNext={() => setCardIndex((i) => (i + 1) % worlds.length)}
                onJump={(i) => setCardIndex(i)}
                onEdit={(i, patch) => setWorlds((ws) => ws.map((w, idx) => idx === i ? { ...w, ...patch } : w))}
                onSelect={(_, world) => {
                  setPrevWorlds(worlds);
                  enterWorld(world);
                }}
                onClose={() => { setWorlds([]); setCardIndex(0); }}
              />
            ) : (
              <div ref={chatScrollRef} onScroll={onChatScroll} className="h-full overflow-y-auto px-6 max-lg:px-3 py-4 space-y-4 max-w-4xl mx-auto w-full border-x border-edge">
                {messages.length === 0 && !generating && (
                  <div className="h-full flex items-center justify-center text-dim/30 text-sm font-mono select-none">
                    在此输入行动，故事将在这里展开…
                  </div>
                )}
                {(() => {
                  const visibleMsgs = historyLimit > 0 ? messages.slice(-historyLimit) : messages;
                  const hiddenCount = messages.length - visibleMsgs.length;
                  return (
                    <>
                      {hiddenCount > 0 && (
                        <div className="text-center text-xs font-mono text-dim/40 py-1 select-none">
                          — 已隐藏 {hiddenCount} 条历史记录（共 {messages.length} 楼）—
                        </div>
                      )}
                      {visibleMsgs.map((msg) => (
                        <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : ''}>
                          {msg.role === 'user' ? (
                            <div className="max-w-sm px-4 py-2 rounded-xl bg-god/10 border border-god/20 text-sm text-god/90 font-mono"
                              dangerouslySetInnerHTML={{ __html: userToHtml(msg.content) }} />
                          ) : editingMsgId === msg.id ? (
                            <div className="space-y-2">
                              <textarea
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                rows={Math.min(28, Math.max(6, editDraft.split('\n').length + 1))}
                                autoFocus
                                className="w-full bg-void border border-god/40 rounded-lg px-3 py-2 text-[16px] text-slate-200 leading-relaxed outline-none focus:border-god/70 resize-y"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, content: editDraft } : m));
                                    setEditingMsgId(null);
                                  }}
                                  className="px-3 py-1 rounded border border-god/40 text-god bg-god/10 hover:bg-god/20 text-[13px] font-mono transition-colors"
                                >✓ 保存</button>
                                <button
                                  onClick={() => setEditingMsgId(null)}
                                  className="px-3 py-1 rounded border border-edge text-dim hover:text-slate-300 text-[13px] font-mono transition-colors"
                                >取消</button>
                                <span className="text-[11px] text-dim/40 font-mono">仅修改本楼显示文本，不会重新触发演化</span>
                              </div>
                            </div>
                          ) : (
                            <div className="group relative">
                              <button
                                onClick={() => { setEditDraft(msg.content); setEditingMsgId(msg.id); }}
                                title="编辑这段正文"
                                className="absolute top-0 right-0 z-10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity w-7 h-7 flex items-center justify-center rounded-md border border-edge bg-void/85 text-dim/60 hover:text-god hover:border-god/40"
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                              </button>
                              <div
                                className="text-slate-300 narrative-content"
                                style={{ fontSize: `${reading.fontSize}px`, letterSpacing: `${reading.letterSpacing}px`, fontFamily: readingFontStack(reading.fontFamily), '--narr-lh': String(reading.lineHeight) } as any}
                                onClick={(e) => {
                                  const el = (e.target as HTMLElement).closest('.story-illust') as HTMLElement | null;
                                  if (!el) return;
                                  const idx = Number(el.dataset.imgIdx);
                                  if (illustClickTimer.current) { clearTimeout(illustClickTimer.current); illustClickTimer.current = null; }
                                  illustClickTimer.current = window.setTimeout(() => {   // 延时开灯箱：若紧跟双击会被取消
                                    illustClickTimer.current = null;
                                    const im = msg.images?.[idx];
                                    if (im) useImageViewer.getState().open(im.url, im.nsfw || '正文配图');
                                  }, 250);
                                }}
                                onDoubleClick={(e) => {
                                  const el = (e.target as HTMLElement).closest('.story-illust') as HTMLElement | null;
                                  if (!el) return;
                                  if (illustClickTimer.current) { clearTimeout(illustClickTimer.current); illustClickTimer.current = null; }   // 取消单击开灯箱
                                  void regenerateStoryImage(msg.id, Number(el.dataset.imgIdx));
                                }}
                                dangerouslySetInnerHTML={{ __html: toHtmlWithImages(msg.content, msg.images) }}
                              />
                              {/* 手动正文生图：重新为本回合配图（不重 roll 正文，救"没出图/失败"的错）*/}
                              <div className="mt-1">
                                <button
                                  onClick={() => void manualStoryImagesForMsg(msg.id)}
                                  disabled={storyImgBusyId === msg.id}
                                  title="重新为本回合正文生成配图（不会改写正文）"
                                  className="text-[11px] font-mono text-dim/45 hover:text-god transition-colors disabled:opacity-50">
                                  {storyImgBusyId === msg.id ? '◌ 生图中…' : (msg.images?.length ? '🖼 追加配图' : '🖼 为本回合生图')}
                                </button>
                              </div>
                              {msg.fanficNote && (
                                <details className="mt-2 rounded-lg border border-fuchsia-500/25 bg-fuchsia-500/5 px-3 py-2 text-[13px]">
                                  <summary className="cursor-pointer text-fuchsia-300/80 font-mono select-none">🔍 同人搜索内容</summary>
                                  <div className="mt-2 text-slate-300 whitespace-pre-wrap leading-relaxed">{msg.fanficNote}</div>
                                </details>
                              )}
                              {msg.factNote && (
                                <details className="mt-2 rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-[13px]">
                                  <summary className="cursor-pointer text-sky-300/80 font-mono select-none">🔎 事实查证</summary>
                                  <div className="mt-2 text-slate-300 whitespace-pre-wrap leading-relaxed">{msg.factNote}</div>
                                </details>
                              )}
                              {/* 剧情选项：附在本楼正文末尾，点击展开查看（点选叠加进输入框）*/}
                              {msg.choices && msg.choices.length > 0 && (() => {
                                const opts = msg.choices!;
                                const open = openChoiceIds.has(msg.id);
                                return (
                                  <div className="mt-2 rounded-lg border border-fuchsia-500/25 bg-fuchsia-500/5">
                                    <button
                                      onClick={() => setOpenChoiceIds((prev) => {
                                        const n = new Set(prev);
                                        if (n.has(msg.id)) n.delete(msg.id); else n.add(msg.id);
                                        return n;
                                      })}
                                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] font-mono text-fuchsia-300/80 hover:text-fuchsia-200 transition-colors">
                                      <span>🎭 剧情选项</span>
                                      <span className="px-1 rounded bg-void/60 text-dim/70">{opts.length}</span>
                                      <span className="flex-1 text-left text-dim/40 truncate">{open ? '可多选 · 点选叠加，再点取消' : '点击展开 · 可多选叠加'}</span>
                                      <span className={`transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
                                    </button>
                                    {open && (
                                      <div className="px-3 pb-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {opts.map((opt, i) => {
                                          const letter = String.fromCharCode(65 + i);
                                          const picked = !!inputValue.trim() && inputValue.includes(opt);   // 已叠加进输入框 → 显示 ✓
                                          return (
                                            <button key={i} title="点选叠加进输入框，再点取消（可多选，编辑后发送）"
                                              onClick={() => setInputValue((prev) => {
                                                const cur = prev ?? '';
                                                const o = opt.trim();
                                                if (cur.includes(o)) {                                          // 再点已选项 → 取消：移除该项并规整逗号（保留手输文字）
                                                  return cur.replace(o, '').replace(/，\s*，/g, '，').replace(/^[，\s]+|[，\s]+$/g, '');
                                                }
                                                const base = cur.replace(/[，,\s]+$/, '');                       // 末尾已有分隔则复用，避免叠重
                                                return base ? `${base}，${o}` : o;                              // 叠加而非覆盖；单行输入框用「，」分隔（换行会被 input 吞掉看不见）
                                              })}
                                              className={`text-left rounded-lg border px-3 py-2 text-sm leading-snug transition-colors border-edge bg-panel/40 text-slate-300 hover:border-god/40 hover:text-god ${picked ? 'ring-1 ring-god/50' : ''}`}>
                                              <span className="font-mono text-[12px] text-dim/50 mr-1.5">{picked ? '✓' : letter}</span>{opt}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              {/* 小剧场：番外彩蛋 HTML（与主线无关·直接渲染世界书产出的折叠块）*/}
                              {msg.theaterHtml && (
                                <div className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.04] px-3 py-2">
                                  <div className="text-[12px] font-mono text-amber-300/80 mb-1.5 select-none">🎭 小剧场 · 番外彩蛋</div>
                                  <div className="zs-theater text-[13px] leading-relaxed text-slate-200" dangerouslySetInnerHTML={{ __html: msg.theaterHtml }} />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  );
                })()}
                {generating && (
                  <div className="flex items-center gap-2 text-dim text-xs font-mono">
                    <span className="animate-spin inline-block">◌</span>
                    <span>正在生成…</span>
                  </div>
                )}
                {genError && (
                  <div className="text-xs text-blood font-mono px-3 py-2 border border-blood/30 rounded-lg bg-blood/5">
                    ⚠ {genError}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* 状态命令栏 */}
          <div className="shrink-0 border-t border-edge bg-panel px-4 py-1.5 flex items-center max-lg:flex-wrap gap-2 text-[11px] font-mono text-dim">
            <button
              onClick={() => setWorldBarOpen((v) => !v)}
              title="点击展开 / 收起「选择世界 · 结算任务」"
              className="flex items-center gap-1.5 hover:text-god transition-colors"
            >
              <span className="text-god/60">📋</span>
              <span>本回合状态命令 · {turnCountRef.current} 回合</span>
              <span className={`text-god/50 transition-transform ${worldBarOpen ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {guidanceRunning && (
              <span className="flex items-center gap-1 text-indigo-300/90">
                <span className="animate-spin inline-block">◌</span>
                💡 剧情提示生成中…
              </span>
            )}
            {choicesRunning && (
              <span className="flex items-center gap-1 text-fuchsia-300/90">
                <span className="animate-spin inline-block">◌</span>
                🎭 选项/同人/小剧场生成中…
              </span>
            )}
            {itemPhaseRunning && (
              <span className="flex items-center gap-1 text-amber-400">
                <span className="animate-spin inline-block">◌</span>
                物品管理处理中…
              </span>
            )}
            {itemAuditRunning && (
              <span className="flex items-center gap-1 text-amber-300">
                <span className="animate-spin inline-block">◌</span>
                🔍 物品对账·正在纠正…
              </span>
            )}
            {!itemPhaseRunning && itemPhaseLog && (
              <span className={itemPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-god/80'}>
                {itemPhaseLog}
              </span>
            )}
            {playerPhaseRunning && (
              <span className="flex items-center gap-1 text-sky-400">
                <span className="animate-spin inline-block">◌</span>
                主角演化处理中…
              </span>
            )}
            {!playerPhaseRunning && playerPhaseLog && (
              <span className={playerPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-sky-400/80'}>
                {playerPhaseLog}
              </span>
            )}
            {npcPhaseRunning && (
              <span className="flex items-center gap-1 text-violet-400">
                <span className="animate-spin inline-block">◌</span>
                NPC 演化处理中…
              </span>
            )}
            {!npcPhaseRunning && npcPhaseLog && (
              <span className={npcPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-violet-400/80'}>
                {npcPhaseLog}
              </span>
            )}
            {factionPhaseLog && (
              <span className={factionPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-orange-400/80'}>
                {factionPhaseLog}
              </span>
            )}
            {territoryPhaseLog && (
              <span className={territoryPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-emerald-400/80'}>
                {territoryPhaseLog}
              </span>
            )}
            {teamPhaseLog && (
              <span className={teamPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-cyan-400/80'}>
                {teamPhaseLog}
              </span>
            )}
            {cosmosPhaseLog && (
              <span className={cosmosPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-fuchsia-400/80'}>
                {cosmosPhaseLog}
              </span>
            )}
            {miscPhaseLog && (
              <span className={miscPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-slate-300/80'}>
                {miscPhaseLog}
              </span>
            )}
            {imagePhaseLog && (
              <span className={imagePhaseLog.startsWith('⚠') ? 'text-blood' : 'text-pink-400/80'}>
                {imagePhaseLog}
              </span>
            )}
            {nmRecalling && (
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="animate-spin inline-block">◌</span>
                正在进行记忆回溯…
              </span>
            )}
            {!nmRecalling && nmPhaseLog && (
              <span className={nmPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-emerald-400/80'}>
                {nmPhaseLog}
              </span>
            )}
            {prevWorlds.length > 0 && worlds.length === 0 && (
              <button
                onClick={() => {
                  setWorlds(prevWorlds);
                  setCardIndex(0);
                  setInputValue(prevInput);
                  setPrevWorlds([]);
                  setPrevInput('');
                }}
                className="px-2 py-0.5 border border-amber-500/40 text-amber-400 rounded hover:bg-amber-900/20 font-mono text-[10px] transition-colors"
              >
                ↺ 撤销选择
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {debugParts.length > 0 && (
                <button
                  onClick={() => setShowDevPrompt(true)}
                  className="px-2 py-0.5 border rounded transition-colors font-mono text-[10px] border-god/30 text-god/80 hover:border-god/50 hover:text-god"
                  title="查看本回合实际发给模型的提示词 + 注入块（调试用）"
                >🛠 开发者</button>
              )}
              {injectedMem && (
                <button
                  onClick={() => { setShowInjected((v) => !v); setShowPrompt(false); setShowRaw(false); }}
                  className={`px-2 py-0.5 border rounded transition-colors font-mono text-[10px] ${
                    showInjected ? 'border-emerald-400/40 text-emerald-400 bg-emerald-900/10' : 'border-edge text-dim hover:border-emerald-400/40 hover:text-emerald-400'
                  }`}
                >
                  {showInjected ? '隐藏注入' : '🧠 查看注入记忆'}
                </button>
              )}
              {promptSent && (
                <button
                  onClick={() => { setShowPrompt((v) => !v); setShowRaw(false); setShowInjected(false); }}
                  className={`px-2 py-0.5 border rounded transition-colors font-mono text-[10px] ${
                    showPrompt ? 'border-sky-400/40 text-sky-400 bg-sky-900/10' : 'border-edge text-dim hover:border-sky-400/40 hover:text-sky-400'
                  }`}
                >
                  {showPrompt ? '隐藏输入' : '查看输入'}
                </button>
              )}
              {rawResponse && (
                <button
                  onClick={() => { setShowRaw((v) => !v); setShowPrompt(false); }}
                  className={`px-2 py-0.5 border rounded transition-colors font-mono text-[10px] ${
                    showRaw ? 'border-god/40 text-god bg-god/5' : 'border-edge text-dim hover:border-god/40 hover:text-god'
                  }`}
                >
                  {showRaw ? '隐藏返回' : '查看返回'}
                </button>
              )}
            </div>
          </div>
          {showDevPrompt && <ApiPromptPanel onClose={() => setShowDevPrompt(false)} />}
          {showInjected && injectedMem && (
            <div className="shrink-0 border-t border-emerald-900/40 bg-void px-4 py-3 max-h-72 overflow-y-auto">
              <div className="text-[10px] font-mono text-emerald-400/70 mb-1.5">本回合实际注入正文的记忆 / 结构化档案（即主叙事 API 能看到的内容）</div>
              <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-all">{injectedMem}</pre>
            </div>
          )}
          {showPrompt && promptSent && (
            <div className="shrink-0 border-t border-sky-900/40 bg-void px-4 py-3 max-h-52 overflow-y-auto">
              <pre className="text-[11px] font-mono text-slate-400 whitespace-pre-wrap break-all">{promptSent}</pre>
            </div>
          )}
          {showRaw && rawResponse && (
            <div className="shrink-0 border-t border-edge bg-void px-4 py-3 max-h-52 overflow-y-auto">
              <pre className="text-[11px] font-mono text-slate-400 whitespace-pre-wrap break-all">{rawResponse}</pre>
            </div>
          )}

          {/* 选择世界 */}
          <WorldSelector
            expanded={worldBarOpen}
            onSelect={(text) => setInputValue(text)}
            onSettle={() => setInputValue((prev) => (prev && prev.trim() ? `${prev}\n【结算任务】` : '【结算任务】'))}
            onInsertText={(t) => setInputValue((prev) => (prev && prev.trim() ? `${prev.replace(/\s+$/, '')} ${t}` : t))}
            onRawResponse={(raw) => { setRawResponse(raw); setShowRaw(false); }}
            onPromptSent={(p) => { setPromptSent(p); setShowPrompt(false); }}
            onWorlds={(list) => { setWorlds(list); setCardIndex(0); }}
          />

          {/* 操作行：停止生成 / 重新生成 / 回退上一回合 */}
          {started && messages.length > 0 && (
            <div className="shrink-0 border-t border-edge bg-panel/60 flex flex-wrap items-center gap-2 px-3 py-1 text-[12px] font-mono">
              {generating ? (
                <>
                  <span className="flex items-center gap-1.5 text-god/85"><span className="animate-spin inline-block text-god">◌</span>正在进行剧情生成</span>
                  <button onClick={stopGeneration}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-blood/40 text-blood hover:bg-blood/10 transition-colors">■ 停止生成</button>
                </>
              ) : guidanceRunning ? (
                <span className="flex items-center gap-1.5 text-indigo-300/90"><span className="animate-spin inline-block">◌</span>💡 正在生成剧情指导…（最多 ~35 秒，完成后自动开始正文）</span>
              ) : (
                <>
                  <button onClick={() => setConfirmAction({
                      title: '重新生成本回合',
                      desc: '将撤销本回合（含正文与所有演化：NPC / 物品 / 势力 / 领地 / 冒险团 / 杂项 / 记忆等），并用同一条输入重新生成。操作会刷新页面，确定继续？',
                      run: regenerateTurn })} disabled={!canUndo}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-edge text-dim hover:border-god/40 hover:text-god disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                    title="撤销本回合（含所有演化）并用同一条输入重新生成">⟳ 重新生成</button>
                  <button onClick={() => setConfirmAction({
                      title: '回退上一回合',
                      desc: '将撤销本回合的正文与所有演化（NPC / 物品 / 势力 / 领地 / 冒险团 / 杂项 / 记忆等），恢复到上一回合结束时的状态。操作会刷新页面，确定继续？',
                      run: rollbackTurn })} disabled={!canUndo}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-edge text-dim hover:border-amber-500/40 hover:text-amber-300 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                    title="回退到上一回合结束时的状态（撤销本回合的正文+所有演化）">↩ 回退上一回合</button>
                  <button onClick={() => setRevarOpen(true)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-edge text-dim hover:border-sky-500/40 hover:text-sky-300 transition-colors"
                    title="重算单项变量：打开菜单，单独重 ROLL 物品/主角/NPC/势力… 某一项（或全部）">♻ 重算变量</button>
                  <button onClick={stopAllPhases}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-blood/40 text-blood/80 hover:border-blood hover:text-blood hover:bg-blood/10 transition-colors"
                    title="停止正在进行的全部变量演化与生图（物品/主角/NPC/势力/领地/冒险团/万族/杂项/记忆/生图，及批量更新）；点后可再发消息/重算继续">⛔ 停止生成</button>
                  {canUndo && <span className="text-dim/35">回退/重生会撤销上一回合的全部演化</span>}
                </>
              )}
            </div>
          )}

          {/* 输入框 */}
          <div className="shrink-0 border-t border-edge bg-panel flex items-center gap-2 px-3 py-2">
            <button
              onClick={() => setMessages([])}
              title="清空对话"
              className="w-7 h-7 max-lg:w-9 max-lg:h-9 flex items-center justify-center text-blood bg-blood/10 border border-blood/30 rounded text-sm hover:bg-blood/20 shrink-0"
            >
              ↺
            </button>
            <textarea
              ref={chatInputRef}
              rows={1}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 128) + 'px'; }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { if (disableEnterSend) return; e.preventDefault(); sendMessage(); } }}
              placeholder={disableEnterSend ? '在此输入你的行动…（回车发送已禁用，点 ▶ 发送）' : (showNewlineButton ? '在此输入你的行动…（Shift+Enter 或点 ↵ 换行）' : '在此输入你的行动…（Shift+Enter 换行）')}
              className="flex-1 bg-transparent text-sm max-lg:text-base text-slate-200 placeholder:text-dim outline-none resize-none max-h-32 overflow-y-auto leading-relaxed py-1"
            />
            {showNewlineButton && (
            <button
              onClick={() => {
                const el = chatInputRef.current;
                const start = el?.selectionStart ?? inputValue.length;
                const end = el?.selectionEnd ?? inputValue.length;
                const next = inputValue.slice(0, start) + '\n' + inputValue.slice(end);
                setInputValue(next);
                setTimeout(() => {
                  if (!el) return;
                  el.focus();
                  const pos = start + 1;
                  el.setSelectionRange(pos, pos);
                  el.style.height = 'auto';
                  el.style.height = Math.min(el.scrollHeight, 128) + 'px';
                }, 0);
              }}
              title="插入换行（Shift+Enter 同效）"
              className="w-7 h-7 max-lg:w-9 max-lg:h-9 flex items-center justify-center text-dim border border-edge rounded text-sm hover:bg-panel2 hover:text-slate-200 shrink-0 transition-colors"
            >
              ↵
            </button>
            )}
            <button
              onClick={() => sendMessage()}
              disabled={generating || !inputValue.trim()}
              className="w-7 h-7 max-lg:w-9 max-lg:h-9 flex items-center justify-center text-god border border-god/30 rounded hover:bg-god/10 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {generating ? <span className="animate-spin text-xs">◌</span> : '▶'}
            </button>
          </div>
        </main>

        {/* ── 右侧导航菜单（桌面常驻列 / 手机右侧抽屉）── */}
        <aside
          className={`shrink-0 w-44 border-l border-edge bg-panel overflow-y-auto
            max-lg:fixed max-lg:top-14 max-lg:bottom-0 max-lg:right-0 max-lg:z-50 max-lg:w-52 max-lg:max-w-[78vw]
            max-lg:shadow-[-8px_0_40px_rgba(0,0,0,0.7)] max-lg:transition-transform max-lg:duration-300
            ${mobileDrawer === 'menu' ? 'max-lg:translate-x-0' : 'max-lg:translate-x-full'}`}
        >
          <nav className="py-1">
            {rightMenuItems.map((item) => (
              <button
                key={item.label}
                onClick={() => { runNavAction(item.label); setMobileDrawer(null); }}
                className="nav-btn w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left text-dim hover:text-slate-200 hover:bg-panel2"
              >
                <span className={`nav-ico ${NAV_FX[item.label] || ''} w-4 text-center text-xs opacity-70`}>{item.icon}</span>
                <span>{item.label}</span>
                {item.label === '聊天室' && chatUnread > 0 && (
                  <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-blood text-white text-[10px] font-bold flex items-center justify-center leading-none animate-pulse">{chatUnread > 99 ? '99+' : chatUnread}</span>
                )}
              </button>
            ))}
          </nav>
        </aside>
      </div>

      {/* ── 命令面板（⌘K/Ctrl+K/顶栏🔍 → 模糊搜索快速跳转面板）── */}
      <CommandPalette
        open={cmdkOpen}
        items={rightMenuItems}
        unread={{ '聊天室': chatUnread }}
        onClose={() => setCmdkOpen(false)}
        onPick={(label) => { setCmdkOpen(false); setMobileDrawer(null); runNavAction(label); }}
      />

      {/* ── 重算单项变量菜单（重 ROLL，样式同命令面板）：选一项 → 确认 → 仅重跑该演化 ── */}
      {revarOpen && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 pt-[12vh] max-lg:pt-[8vh]"
          onClick={(e) => { if (e.target === e.currentTarget) setRevarOpen(false); }}>
          <div className="w-full max-w-lg rounded-2xl border border-god/30 bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-edge">
              <span className="text-god/70 text-base">♻</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-100">重算单项变量（重 ROLL）</div>
                <div className="text-[11px] text-dim/60 leading-snug">选一项 → 确认后仅重跑该演化（基于本回合正文）、其它变量不动；「全部」=旧的整体重算</div>
              </div>
              <button onClick={() => setRevarOpen(false)} aria-label="关闭" className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-edge text-dim/70 hover:text-blood hover:border-blood/40 transition-colors text-base">✕</button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto py-1">
              {[
                { icon: '♻', label: '全部变量', desc: '撤销并重跑本回合全部演化（原「重算变量」行为·会刷新页面）。确定？', run: regenerateVarsOnly, all: true },
                { icon: '🎒', label: '物品 / 背包', fk: 'item', batch: true, run: () => triggerItemPhaseManually() },
                { icon: '🧬', label: '主角属性', fk: 'player', batch: true, run: revarRun(runPlayerEvolutionPhase) },
                { icon: '📇', label: 'NPC', fk: 'npc', batch: true, run: revarRun(runNpcEvolutionPhase) },
                { icon: '🏛', label: '势力', fk: 'faction', batch: true, run: revarRun(runFactionEvolutionPhase) },
                { icon: '🏯', label: '领地', fk: 'territory', batch: true, run: revarRun(runTerritoryEvolutionPhase) },
                { icon: '🛡', label: '冒险团', fk: 'team', batch: true, run: revarRun(runTeamEvolutionPhase) },
                { icon: '🌌', label: '万族', fk: 'cosmos', batch: true, run: revarRun(runCosmosEvolutionPhase) },
                { icon: '📋', label: '任务 / 世界 / 杂项', fk: 'misc', batch: true, run: revarRun(runMiscEvolutionPhase) },
                { icon: '🧠', label: '记忆整理', run: () => runMemoryCompressionPhase() },
                { icon: '🖼', label: '生图（肖像 + 装备）', fk: 'image', run: () => { runPortraitPhase(); runEquipImagePhase(); } },
                { icon: '🎭', label: '选项 / 同人 / 事实 / 小剧场', fk: 'choices', direct: true, run: () => { setChoicesDir(''); setChoicesRevarOpen(true); } },
              ].map((it) => {
                const x = it as { icon: string; label: string; run: () => void; desc?: string; all?: boolean; fk?: string; batch?: boolean; direct?: boolean };
                const prog = (floorProg && x.fk && floorProg.fk === x.fk) ? floorProg : null;
                const busy = !prog && (x.fk === 'choices' ? choicesRunning : !!(x.fk && phaseBusy[x.fk]));
                const failed = !prog && !busy && !!(x.fk && phaseFail[x.fk]);
                return (
                <button key={x.label} disabled={busy || !!prog}
                  onClick={() => {
                    if (x.direct) { x.run(); return; }   // 自带弹窗的项（选项/同人/事实/小剧场 → 弹方向提示词框），不走确认/楼层
                    if (x.batch && x.fk) { openFloorCfg(x.fk, x.label); return; }   // 吃正文的阶段 → 弹「按楼层更新」配置框
                    setConfirmAction({ title: x.all ? '重算全部变量' : `重 ROLL「${x.label}」`, desc: x.desc || `仅重新生成「${x.label}」这一项（基于本回合正文重跑该演化）、其它变量不动。确定？`, run: () => {
                      if (x.all) { setRevarOpen(false); x.run(); return; }
                      if (x.fk) {
                        const k = x.fk;
                        setPhaseFail((p) => { if (!p[k]) return p; const n = { ...p }; delete n[k]; return n; });
                        setPhaseBusy((p) => ({ ...p, [k]: true }));
                        setTimeout(() => setPhaseBusy((p) => { if (!p[k]) return p; const n = { ...p }; delete n[k]; return n; }), 45000);
                      }
                      x.run();
                    } });
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors disabled:cursor-default ${(prog || busy) ? 'text-god bg-god/5' : failed ? 'text-slate-200 hover:bg-blood/10' : 'text-dim hover:text-god hover:bg-god/10'}`}>
                  <span className="w-5 text-center text-xs opacity-80">{x.icon}</span>
                  <span className="flex-1">{x.label}</span>
                  {x.all
                    ? <span className="text-[10px] font-mono text-amber-300/70 border border-amber-600/40 rounded px-1.5 py-0.5 shrink-0">刷新页面</span>
                    : <span className="flex items-center gap-1.5 shrink-0">
                        {prog
                          ? <span className="text-[10px] font-mono text-god border border-god/50 bg-god/10 rounded px-1.5 py-0.5 flex items-center gap-1"><span className="inline-block animate-spin">⟳</span>批量 {prog.cur}/{prog.total}</span>
                          : busy
                          ? <span className="text-[10px] font-mono text-god border border-god/50 bg-god/10 rounded px-1.5 py-0.5 flex items-center gap-1"><span className="inline-block animate-spin">⟳</span>正在重 ROLL…</span>
                          : <>
                              {failed && <span className="text-[10px] font-mono text-blood border border-blood/40 bg-blood/10 rounded px-1.5 py-0.5">⚠ 更新失败</span>}
                              <span className="text-[10px] font-mono text-dim/40">{x.batch ? '按楼层 ›' : '重 ROLL ›'}</span>
                            </>}
                      </span>}
                </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── 重新生成「选项 / 同人 / 事实 / 小剧场」：方向提示词弹窗（从重算菜单 🎭 项点开；叠在菜单上方 z-130）── */}
      {choicesRevarOpen && (() => {
        const ss = useSettings.getState();
        const flags: [string, boolean][] = [['选项', ss.plotChoices], ['同人', ss.fanficMode], ['事实', ss.factCheck], ['小剧场', ss.miniTheater]];
        const enabled = flags.filter(([, v]) => v).map(([k]) => k);
        const run = () => {
          const latest = [...(messagesRef.current ?? [])].reverse().find((m) => m.role === 'assistant' && m.content);
          setChoicesRevarOpen(false); setRevarOpen(false);
          if (!latest) { setGenError('暂无正文可重算（先发一条消息再重算）'); setTimeout(() => setGenError(''), 4000); return; }
          let dir = choicesDir.trim();
          const prev = latest.choices ?? [];
          if (prev.length) dir += `${dir ? '\n\n' : ''}【上一版选项，请换全新角度、不要重复以下任何一条】\n${prev.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}`;
          void runChoicesFanficPhase(latest.content as string, latest.id, dir);
        };
        return (
          <div className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={(ev) => { if (ev.target === ev.currentTarget) setChoicesRevarOpen(false); }}>
            <div className="w-full max-w-md rounded-2xl border border-fuchsia-500/30 bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] overflow-hidden">
              <div className="px-5 py-3 border-b border-edge bg-panel flex items-center gap-2">
                <span className="text-fuchsia-300/80 text-lg">🎭</span>
                <div className="text-sm font-bold text-slate-100">重新生成 选项 / 同人 / 事实 / 小剧场</div>
              </div>
              <div className="px-5 py-4 space-y-3 text-[13px] text-slate-300">
                <div className="text-dim leading-relaxed">基于<b className="text-slate-200">最新一条正文</b>，对当前已开启的项重新生成一遍（覆盖本楼旧结果）。</div>
                <div className="text-[12px] font-mono">
                  本次将重生成：{enabled.length ? <b className="text-fuchsia-300">{enabled.join(' · ')}</b> : <span className="text-blood/90">（四项都未开启 —— 请先到「设置 → 正文生成」打开至少一项）</span>}
                </div>
                <div className="space-y-1">
                  <div className="text-dim/70 font-mono text-[12px]">方向提示词（可留空）</div>
                  <textarea value={choicesDir} onChange={(ev) => setChoicesDir(ev.target.value)} rows={3}
                    placeholder="例：选项更激进 / 偏感情线 / 围绕逃离展开；小剧场走治愈风…（留空=自由发挥，仅要求与上一版不同）"
                    className="w-full bg-void border border-edge rounded px-2 py-1.5 text-[13px] text-slate-200 outline-none focus:border-fuchsia-500/50 resize-y leading-relaxed" />
                </div>
                <div className="text-[11px] text-dim/50 leading-relaxed">将调用 1 次「选项 / 同人 / 事实 / 小剧场」API（与正文后处理同一路由），耗时取决于开启项数量；生成中底部状态栏会显示进度。</div>
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setChoicesRevarOpen(false)}
                    className="px-3 py-1.5 text-[13px] rounded-md border border-edge text-dim hover:text-slate-200 transition-colors">取消</button>
                  <button onClick={run} disabled={!enabled.length || choicesRunning}
                    className="px-3 py-1.5 text-[13px] rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    {choicesRunning ? '◌ 生成中…' : '🔄 开始重新生成'}</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 按楼层批量更新·配置弹窗（从重算菜单某项点开；叠在菜单上方 z-130）── */}
      {floorCfg && (() => {
        const T = floorCfg.total;
        const s = Math.max(1, Math.min(T || 1, Math.round(Number(floorStart) || 1)));
        const e = Math.max(1, Math.min(T || 1, Math.round(Number(floorEnd) || (T || 1))));
        const lo = Math.min(s, e), hi = Math.max(s, e);
        const step = Math.max(1, Math.round(Number(floorStep) || 1));
        const span = hi - lo + 1;
        const times = Math.max(1, Math.ceil(span / step));
        return (
          <div className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={(ev) => { if (ev.target === ev.currentTarget) setFloorCfg(null); }}>
            <div className="w-full max-w-md rounded-2xl border border-god/30 bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] overflow-hidden">
              <div className="px-5 py-3 border-b border-edge bg-panel flex items-center gap-2">
                <span className="text-god/70 text-lg">♻</span>
                <div className="text-sm font-bold text-slate-100">按楼层更新「{floorCfg.label}」</div>
              </div>
              <div className="px-5 py-4 space-y-3 text-[13px] text-slate-300">
                <div className="text-dim leading-relaxed">楼层 = 第几条 AI 正文（从旧到新，共 <b className="text-slate-200">{T}</b> 层，最新 = 第 {T} 层）。默认只更新最新一层；可指定一段楼层范围，每隔几层做一次更新（用历史正文重跑该变量的演化）。</div>
                {T === 0 ? (
                  <div className="text-blood/90 font-mono">暂无正文楼层 —— 先发一条消息再来。</div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="w-20 shrink-0 text-dim/70 font-mono">楼层范围</span>
                      <input type="number" min={1} max={T} value={floorStart} onChange={(ev) => setFloorStart(ev.target.value)}
                        className="w-20 bg-void border border-edge rounded px-2 py-1 font-mono text-slate-100 outline-none focus:border-god/50" />
                      <span className="text-dim/60 font-mono">→</span>
                      <input type="number" min={1} max={T} value={floorEnd} onChange={(ev) => setFloorEnd(ev.target.value)}
                        className="w-20 bg-void border border-edge rounded px-2 py-1 font-mono text-slate-100 outline-none focus:border-god/50" />
                      <button onClick={() => { setFloorStart('1'); setFloorEnd(String(T)); }}
                        className="text-[11px] font-mono text-dim hover:text-god ml-auto">全部楼层</button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-20 shrink-0 text-dim/70 font-mono">每几层一次</span>
                      <input type="number" min={1} max={Math.max(1, span)} value={floorStep} onChange={(ev) => setFloorStep(ev.target.value)}
                        className="w-20 bg-void border border-edge rounded px-2 py-1 font-mono text-slate-100 outline-none focus:border-god/50" />
                    </div>
                    <div className="rounded-lg border border-god/20 bg-god/5 px-3 py-2 text-[12px] font-mono text-god/80">
                      第 {lo}–{hi} 层（共 {span} 层）· 每 {step} 层一次 → <b className="text-god">本次更新 {times} 次</b>
                    </div>
                    <div className="space-y-1">
                      <div className="text-dim/70 font-mono text-[12px]">额外提示词（可留空）</div>
                      <textarea value={floorExtra} onChange={(ev) => setFloorExtra(ev.target.value)} rows={2}
                        placeholder="例：重点更新主角心境变化 / 把 NPC 关系网补全 / 只记录本段新出现的势力…"
                        className="w-full bg-void border border-edge rounded px-2 py-1.5 text-[13px] text-slate-200 outline-none focus:border-god/50 resize-y leading-relaxed" />
                    </div>
                    <div className="text-[11px] text-dim/50 leading-relaxed">将按顺序逐批调用「{floorCfg.label}」演化（{times} 次 API，耗时较久、请勿关页）；失败的批次会自动跳过。额外提示词会附在每批正文末尾一起发给 AI。</div>
                  </>
                )}
              </div>
              <div className="px-5 py-3 border-t border-edge bg-panel/60 flex justify-end gap-2">
                <button onClick={() => setFloorCfg(null)} className="px-3 py-1.5 rounded border border-edge text-dim hover:text-slate-200 text-sm font-mono transition-colors">取消</button>
                <button disabled={T === 0} onClick={runFloorBatches} className="px-3 py-1.5 rounded border border-god/50 text-god hover:bg-god/10 disabled:opacity-40 text-sm font-mono transition-colors">开始更新（{times} 次）</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 底部状态栏 ── */}
      <footer className="shrink-0 h-7 flex items-center justify-between px-4 border-t border-edge bg-panel text-[10px] font-mono text-dim/60">
        <span>DRPG // DIGITAL ROLE PLAYING GAME</span>
        <span>VERSION V0.0.1 // ONLINE 2</span>
      </footer>

      <Suspense fallback={null}>
      {/* ── 背包弹窗 ── */}
      {backpackOpen && (
        <BackpackModal
          onClose={() => setBackpackOpen(false)}
          onManualUpdate={triggerItemPhaseManually}
          itemPhaseRunning={itemPhaseRunning}
          itemPhaseLog={itemPhaseLog}
        />
      )}

      {/* ── NPC 档案面板 ── */}
      {npcPanelOpen && (
        <NpcPanel
          onClose={() => setNpcPanelOpen(false)}
          onManualUpdate={triggerNpcUpdateManually}
          manualUpdatingId={npcManualUpdatingId}
          onDm={(r) => { setNpcPanelOpen(false); openDmFor({ targetId: r.id, targetName: r.name || r.id, targetTier: (r.realm || '').split(/[·|]/)[0] || undefined, targetJob: r.profession, targetPersona: r.personality, targetStrength: r.bioStrength, targetTag: r.npcTag }); }}
        />
      )}

      {/* ── NPC 手动更新浮层提示（z 高于 NPC 面板/详情，确保盖在最上层可见）── */}
      {npcManualToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] pointer-events-none">
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border shadow-[0_4px_24px_rgba(0,0,0,0.55)] font-mono text-sm backdrop-blur-sm ${
            npcManualToast.kind === 'ok' ? 'border-god/50 text-god bg-god/15'
            : npcManualToast.kind === 'err' ? 'border-blood/50 text-blood bg-blood/15'
            : 'border-violet-500/50 text-violet-200 bg-violet-900/30'
          }`}>
            <span>{npcManualToast.kind === 'info' ? <span className="animate-spin inline-block">◌</span> : npcManualToast.kind === 'ok' ? '✓' : '⚠'}</span>
            <span>{npcManualToast.text}</span>
          </div>
        </div>
      )}

      {/* ── NPC 定期清理提示框（策略B 调度提醒）── */}
      {cleanupNpcs.length > 0 && (
        <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setCleanupNpcs([]); }}>
          <div className="w-full max-w-md bg-void border border-edge rounded-2xl overflow-hidden flex flex-col max-h-[80vh] shadow-[0_0_60px_rgba(0,0,0,0.8)]">
            <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
              <span className="text-amber-400 text-lg">🧹</span>
              <div className="flex-1">
                <div className="text-sm font-bold text-slate-100">NPC 清理提醒</div>
                <div className="text-[10px] font-mono text-dim/60">以下 {cleanupNpcs.length} 个 NPC 长期未出场，可归档以精简档案库</div>
              </div>
              <button onClick={() => setCleanupNpcs([])} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {cleanupNpcs.map((n) => (
                <div key={n.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-edge bg-panel/60">
                  <span className="text-[10px] font-mono text-dim/50 shrink-0">{n.id}</span>
                  <span className="flex-1 text-sm text-slate-200 truncate">{n.name}</span>
                  <button
                    onClick={() => { useNpc.getState().hardRemoveNpc(n.id); setCleanupNpcs((p) => p.filter((x) => x.id !== n.id)); }}
                    className="text-[10px] font-mono px-2 py-1 rounded border border-amber-700/40 text-amber-400/80 hover:bg-amber-900/20 transition-colors shrink-0"
                  >归档</button>
                </div>
              ))}
            </div>
            <div className="shrink-0 flex gap-2 px-4 py-3 border-t border-edge bg-panel">
              <button
                onClick={() => { cleanupNpcs.forEach((n) => useNpc.getState().hardRemoveNpc(n.id)); setCleanupNpcs([]); }}
                className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-amber-600/50 text-amber-300 hover:bg-amber-900/20 transition-colors"
              >全部归档 ({cleanupNpcs.length})</button>
              <button
                onClick={() => setCleanupNpcs([])}
                className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-edge text-dim hover:text-slate-200 transition-colors"
              >保留全部</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 杂项（任务/世界大事）面板 ── */}
      {channelPanelOpen && (
        <ChannelPanel onClose={() => setChannelPanelOpen(false)} onRefresh={refreshChannel} onSolicit={solicitQuotes} onPost={replyToChannelPost} onOpenShop={() => setShopOpen(true)} onJoin={joinPartyFromPost} onInvite={inviteToParty}
          onDm={(m) => { if (!isDmableTag(m.authorTag)) return; openDmFor({ targetName: m.authorName, targetTier: m.authorTier, targetJob: m.authorJob, targetPersona: m.authorPersona, targetStrength: m.authorStrength, targetTag: m.authorTag, sourceContent: String(m.content) }); }}
          onAddFriend={addFriendFromChannel} />
      )}
      {dmPanelOpen && <DmPanel onClose={() => setDmPanelOpen(false)} focusThreadId={dmFocusThread} h={dmHandlers} />}
      {mpPanelOpen && <MultiplayerPanel onClose={() => setMpPanelOpen(false)} />}
      {chatRoomOpen && <ChatRoomPanel onClose={() => setChatRoomOpen(false)} />}
      {tradeOpen && <TradePanel onClose={() => setTradeOpen(false)} />}
      {assistOpen && <AssistPanel onClose={() => setAssistOpen(false)} />}
      {monumentOpen && <MonumentPanel onClose={() => setMonumentOpen(false)} />}
      {mpIncomingGift && <GiftPrompt gift={mpIncomingGift} onClose={() => useMp.getState()._set({ incomingGift: null })} />}
      {mpRaidLoot && <RaidLootModal onClose={() => useMp.getState()._set({ raidLoot: null })} />}
      <RaidDungeonReward />
      {friendsPanelOpen && <FriendsPanel onClose={() => setFriendsPanelOpen(false)} turn={turnCountRef.current}
        onOpenNpc={(cid) => { setFriendsPanelOpen(false); setOnSceneDetailId(cid); }}
        onDm={(cid) => { const r = useNpc.getState().npcs[cid]; if (!r) return; setFriendsPanelOpen(false); openDmFor({ targetId: r.id, targetName: r.name || r.id, targetTier: (r.realm || '').split(/[·|]/)[0] || undefined, targetJob: r.profession, targetPersona: r.personality, targetStrength: r.bioStrength, targetTag: r.npcTag }); }} />}
      {partyPanelOpen && <PartyPanel onClose={() => setPartyPanelOpen(false)}
        onOpenNpc={(cid) => { setPartyPanelOpen(false); setOnSceneDetailId(cid); }}
        onDm={(cid) => { const r = useNpc.getState().npcs[cid]; if (!r) return; setPartyPanelOpen(false); openDmFor({ targetId: r.id, targetName: r.name || r.id, targetTier: (r.realm || '').split(/[·|]/)[0] || undefined, targetJob: r.profession, targetPersona: r.personality, targetStrength: r.bioStrength, targetTag: r.npcTag }); }} />}
      {workshopOpen && <WorkshopPanel onClose={() => setWorkshopOpen(false)} />}
      {promoteCandidates.length > 0 && <PartyPromoteDialog ids={promoteCandidates} onClose={() => setPromoteCandidates([])} />}
      {shopOpen && <SystemShop onGenShop={genShopItems} onQuoteSell={genSellQuotes} onClose={() => setShopOpen(false)} />}
      {miscPanelOpen && (
        <MiscPanel onClose={() => setMiscPanelOpen(false)} />
      )}

      {/* ── ROLL 点 · 摇骰检定面板 ── */}
      {dicePanelOpen && (
        <DicePanel onClose={() => setDicePanelOpen(false)} onInject={(t) => { setDicePanelOpen(false); setInputValue((prev) => (prev && prev.trim() ? `${prev}\n${t}` : t)); }} />
      )}

      {/* ── 战斗系统 · 发起战斗（选在场 NPC）+ 回合制战斗面板 ── */}
      {combatSetupOpen && (
        <CombatSetup
          onClose={() => setCombatSetupOpen(false)}
          onStart={(picks) => { setCombatSetupOpen(false); startCombatWithSelection(picks); }}
        />
      )}
      {(combatActive || combatStage === 'ended') && <CombatPanel
        onPlayerAction={mpMode === 'guest' ? ((kind, targetIds, skillId, itemId) => { if (kind === 'item' && itemId) { try { useItems.getState().consumeItem(itemId, 1); } catch {} } mpClient.submitCombatAction({ kind, targetIds, skillId, itemId }); }) : submitCombatPlayerAction}
        onUndo={undoCombatAction} canUndo={combatHasUndo && !combatApiBusy} mpMode={mpMode} mySeatId={mpMySeatId} takeover={hostTakeover} />}

      {/* ── 乐园设施聚合菜单：欢愉宫 / 竞技场 / 赌场 ── */}
      {facilitiesOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setFacilitiesOpen(false)}>
          <div className="w-full max-w-xs rounded-2xl border border-edge bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">🎡 乐园设施</h2>
              <button onClick={() => setFacilitiesOpen(false)} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
            </div>
            <div className="text-[12px] text-dim/50">主神空间的功能与娱乐设施。</div>
            <div className="space-y-2">
              <button onClick={() => { setFacilitiesOpen(false); setEnhancePanelOpen(true); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-edge text-slate-200 hover:border-god/50 hover:bg-panel2 transition-colors text-left">
                <span className="text-lg">⚒</span><span>装备强化</span>
              </button>
              <button onClick={() => { setFacilitiesOpen(false); setSkillUpPanelOpen(true); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-edge text-slate-200 hover:border-god/50 hover:bg-panel2 transition-colors text-left">
                <span className="text-lg">🔼</span><span>技能升级</span>
              </button>
              {joyEnabled && (
                <button onClick={() => { setFacilitiesOpen(false); setJoyPanelOpen(true); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-pink-500/40 joy-glow font-semibold text-pink-200 hover:bg-pink-500/10 transition-colors text-left">
                  <span className="text-lg">💗</span><span>欢愉宫</span>
                </button>
              )}
              <button onClick={() => { setFacilitiesOpen(false); sweepArenaOpponents(); setArenaPanelOpen(true); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-edge text-slate-200 hover:border-god/50 hover:bg-panel2 transition-colors text-left">
                <span className="text-lg">🏟</span><span>竞技场</span>
              </button>
              <button onClick={() => { setFacilitiesOpen(false); setCasinoOpen(true); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-edge text-slate-200 hover:border-god/50 hover:bg-panel2 transition-colors text-left">
                <span className="text-lg">🎰</span><span>赌场</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {arenaPanelOpen && (
        <ArenaPanel
          onClose={() => setArenaPanelOpen(false)}
          onGenerateLadder={runArenaLadderPhase}
          onScout={scoutArenaOpponent}
          onChallengeBuilt={startArenaBattleWith}
          onDiscardOpponent={discardArenaOpponent}
        />
      )}

      {enhancePanelOpen && (
        <EnhancePanel
          onClose={() => setEnhancePanelOpen(false)}
          onBanter={enhanceBanter}
          onFinalize={runEnhanceFinalizePhase}
        />
      )}

      {skillUpPanelOpen && <SkillUpgradePanel onClose={() => setSkillUpPanelOpen(false)} />}

      {casinoOpen && <CasinoPanel onClose={() => setCasinoOpen(false)} onGenMatch={genGladiatorMatch} onGenBattle={genGladiatorBattle} onGenRewards={genGachaRewards} onBanter={casinoBanter} onGenSoul={genSoulGamble} onGenPortraits={genGladiatorPortraits} />}
      {abyssOpen && <AbyssPanel onClose={() => setAbyssOpen(false)} onGenBoons={genAbyssBoons} onGenSin={genAbyssSin} onGenAwaken={genAbyssAwaken} onGenJudge={genAbyssJudge} onGenEnemies={genAbyssEnemies} />}

      {joyPanelOpen && (
        <JoyPanel
          onClose={() => setJoyPanelOpen(false)}
          onSend={onJoySend}
          onGreet={onJoyGreet}
        />
      )}

      {/* ── 记忆（小总结/大总结）面板 ── */}
      {summaryPanelOpen && (
        <SummaryPanel onClose={() => setSummaryPanelOpen(false)} onManualUpdate={triggerNmIngestManually} />
      )}

      {/* ── 存档管理面板 ── */}
      {saveOpen && (
        <SaveLoadPanel messages={messages} onClose={() => setSaveOpen(false)} />
      )}

      {/* ── 技能/天赋面板 ── */}
      {titlePanelOpen && <TitlePanel onClose={() => setTitlePanelOpen(false)} />}
      {achievePanelOpen && <AchievementPanel onClose={() => setAchievePanelOpen(false)} />}
      {subProfOpen && <SubProfessionPanel onClose={() => setSubProfOpen(false)} />}
      {skillTreeOpen && <SkillTreePanel onClose={() => { setSkillTreeOpen(false); try { syncPlayerVitalsMax(); } catch { /* */ } }} />}
      {factionPanelOpen && <FactionPanel onClose={() => setFactionPanelOpen(false)} />}
      {territoryPanelOpen && <TerritoryPanel onClose={() => setTerritoryPanelOpen(false)} />}
      {teamPanelOpen && <AdventureTeamPanel onClose={() => setTeamPanelOpen(false)} />}
      {cosmosPanelOpen && <CosmosPanel onClose={() => setCosmosPanelOpen(false)} />}
      {worldCodexOpen && <WorldCodexPanel onClose={() => setWorldCodexOpen(false)} />}
      {wikiOpen && <WikiPanel onClose={() => setWikiOpen(false)} />}
      <ImageViewer />
      <ImageBusyToast />
      {showVer && <VersionToast version={APP_VERSION} note={VERSION_NOTE} onClose={() => setShowVer(false)} />}
      {/* 回退 / 重新生成 确认弹窗（破坏性操作，先确认）*/}
      {confirmAction && (
        <div className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmAction(null); }}>
          <div className="w-full max-w-sm rounded-2xl border border-edge bg-void shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="px-5 py-3 border-b border-edge bg-panel flex items-center gap-2">
              <span className="text-amber-300/80 text-lg">⚠</span>
              <span className="text-base font-bold text-slate-100">{confirmAction.title}</span>
            </div>
            <div className="px-5 py-4 text-[13px] text-slate-300 leading-relaxed">{confirmAction.desc}</div>
            <div className="px-5 py-3 border-t border-edge bg-panel/60 flex justify-end gap-2">
              <button onClick={() => setConfirmAction(null)}
                className="px-3 py-1.5 rounded border border-edge text-dim hover:text-slate-200 text-sm font-mono transition-colors">取消</button>
              <button onClick={() => { const run = confirmAction.run; setConfirmAction(null); run(); }}
                className="px-3 py-1.5 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-sm font-mono transition-colors">确定</button>
            </div>
          </div>
        </div>
      )}
      {onSceneDetailId && useNpc.getState().npcs[onSceneDetailId] && (
        <NpcDetail
          npc={useNpc.getState().npcs[onSceneDetailId]}
          list={Object.values(useNpc.getState().npcs)}
          onClose={() => setOnSceneDetailId(null)}
          onSelect={(id) => setOnSceneDetailId(id)}
        />
      )}
      {insightOpen && <TurnInsightPanel onClose={() => setInsightOpen(false)} />}
      {charPanelOpen && (
        <CharacterPanel onClose={() => setCharPanelOpen(false)} />
      )}

      {/* ── 装备面板弹窗 ── */}
      {equipOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setEquipOpen(false); }}
        >
          <div className="w-full max-w-3xl h-[88vh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
            {/* 标题栏 */}
            <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
              <span className="text-god/60 text-lg">⚔</span>
              <div>
                <div className="text-sm font-bold text-slate-100">装备栏</div>
                <div className="text-[10px] font-mono text-dim/60">主角当前装备配置</div>
              </div>
              <div className="flex-1"/>
              <button
                onClick={() => setEquipOpen(false)}
                className="text-dim hover:text-blood text-lg font-mono transition-colors"
              >✕</button>
            </header>
            {/* 装备面板内容 */}
            <EquipmentPanel onDetailOpen={() => {}} />
          </div>
        </div>
      )}

      {/* ── 全局 API 工作指示器（顶部滑动光条，仅剧情生成时）；物品更新的"小药丸"已移除，物品阶段状态见底部「状态命令栏」── */}
      {generating && (
        <div className="fixed inset-x-0 top-0 z-[200] pointer-events-none flex flex-col">
          {/* 滑动光条 */}
          <div className="h-[2px] bg-god/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-transparent via-god to-transparent"
              style={{ width: '40%', animation: 'apiSlide 1.4s ease-in-out infinite' }}
            />
          </div>
        </div>
      )}
      </Suspense>
    </div>
  );
}
