# CODE_MAP — 代码定位地图

> **改动前先读这个文件**，定位到具体文件 + 函数/组件名，再 `Grep` 那个名字拿到当前行号，最后 `Read` 那一段（用 offset/limit）。**不要整文件读**——App.tsx 32万字符、SettingsPanel 11万、NpcDetail 6万，整读极费 token。
> 行号是"写这份文档时"的近似值，会随编辑漂移；**以函数名为准去 grep**。

---

## 1. 功能 → 文件 反查表

| 想改… | 主要文件（函数/区域） |
|---|---|
| 主叙事调用 / 流式 / 召回注入 | `App.tsx` → `callApi` |
| 正文完成后并发触发哪些演化阶段 | `App.tsx` → `runPostNarrativePhases` |
| `<state>` / `<upstore>` 指令解析与应用 | `systems/stateParser.ts` |
| 物品/装备/货币指令 | `systems/stateParser.ts` → `applyItemCommands`；`store/itemStore.ts` |
| 物品阶段 / 综合对账纠错 | `App.tsx` → `runItemManagementPhaseCore` / `runMergedAuditPhase` |
| 主角演化 | `App.tsx` → `runPlayerEvolutionPhaseCore` / `applyPlayerProfileCommands`；`store/playerStore.ts` |
| NPC 演化（策略A/B、登场判断、调度） | `App.tsx` → `runNpcPipelineB` / `runEntryJudgment` / `computeFocusList`；`store/npcStore.ts` / `npcEvoStore.ts` |
| 势力演化 | `App.tsx` → `runFactionEvolutionPhase` 等；`store/factionStore.ts` / `factionEvoStore.ts` |
| 领地 / 冒险团 / 万族 演化 | `App.tsx` → `runTerritory…` / `runTeam…` / `runCosmos…`；对应 store |
| 杂项演化（任务/总结/双时间/天气） | `App.tsx` → `runMiscEvolutionPhase`；`systems/miscParser.ts`；`store/miscStore.ts` |
| 生平压缩 | `App.tsx` → `runMemoryCompressionPhase`；`store/memoryStore.ts` + `characterStore.memory` |
| 叙事记忆（召回/改写/抽取/结构化档案） | `App.tsx` → `buildStructuredRecall` / `narrativeCompile` / `runNarrativeIngestPhase`；`systems/narrativeMemory.ts` / `structuredRecall.ts` |
| 向量资料库（原著+世界书语义检索） | `systems/novelVec.ts`；`store/novelVecStore.ts`；`components/NovelVecManager.tsx`；建库 `tools/build-novel-vectors.mjs` |
| 技能/天赋/称号/副职业/成就/记忆 数据 | `store/characterStore.ts`（B1+Cx 共用）；成就在 `store/playerStore.ts` |
| 技能/天赋指令 | `systems/stateParser.ts` → `parseAllCharCommands` / `applyCharacterCommands` |
| 职业技能树（潜能点·节点解锁·可视化编辑） | `systems/skillTree.ts`（确定性结算/校验）；`store/skillTreeStore.ts`；`components/SkillTreePanel.tsx`(玩家🌳)/`TreeCanvas.tsx`(共享SVG)/`SkillTreeManager.tsx`(编辑器)；提示词 `SKILLTREE_GEN_PROMPT` |
| 自定义能量条（HP/EP外·剧情/技能消耗/战斗累积·仅主角） | `store/resourceStore.ts`；上限/累积 `systems/playerVitals.ts`(`playerResourceMax`/`applyCombatResourceGains`/`resetCombatResources`)+`derivedStats.ts`(`computeAttrPool` 六维公式)；指令 `res.B1.<id>` 在 `systems/stateApply.ts`；注入 `systems/structuredRecall.ts`；UI `components/PlayerSidebar.tsx`(⚡管理+🎯技能绑定)；技能消耗/门槛 `skill.numeric.resCost/resGate`+`components/CombatPanel.tsx`；战斗累积钩子 `App.tsx`→`resolveAndNarrate`(出手+DoT) |
| 衍生属性 / HP·EP 上限 / 阶位↔等级 | `systems/derivedStats.ts` |
| 装备槽位 | `systems/equipSlots.ts`；`components/EquipmentPanel.tsx` / `NpcEquip.tsx` |
| 骰子判定 | `systems/diceEngine.ts`（确定性）/ `diceJudge.ts`（AI裁判）；`components/DicePanel.tsx` / `DiceManager.tsx` |
| 装备强化（仅乐园·看板娘·爆装保底） | `systems/enhanceEngine.ts`（确定性摇率/费用/爆装/保底）+ `enhanceBosses.ts`（分阶段立绘 manifest）；`store/enhanceStore.ts`；`components/EnhancePanel.tsx` / `EnhanceManager.tsx`；`App.tsx`→`runEnhanceFinalizePhase`/`enhanceBanter`；立绘 vite 插件 `syncEnhanceBosses`(vite.config) |
| 生图（NAI/OpenAI/Gemini/Comfy） | `systems/imageGen.ts` / `imageTags.ts`；`store/imageGenStore.ts`；`App.tsx` → `runPortraitPhase`/`runEquipImagePhase`/`runStoryImagePhase` |
| 图片持久化（IndexedDB） | `systems/imageDb.ts` / `imageSync.ts` |
| 公共频道 / 系统商店 / 临时队伍 | `App.tsx` → `refreshChannel`/`replyToChannelPost`/`joinPartyFromPost`/`inviteToParty`；`store/channelStore.ts`；`systems/channelTrade.ts` |
| 私信（聊天/交易/讨价还价） | `App.tsx` → `dmReply`/`dmPropose`/`dmHaggle`/`dmAccept`；`store/dmStore.ts`；`systems/dmTrade.ts` |
| 好友栏 / 故友建档 | `App.tsx` → `addFriendByInfo`/`fleshOutContractor`；`store/npcStore.ts`（`setFriend`/`createArchivedContractor`）|
| 存档（多存档/新游戏/读档） | `systems/saveManager.ts` / `saveDb.ts`；`components/SaveLoadPanel.tsx` |
| 对话持久化（跨刷新） | `systems/chatDb.ts` |
| 中心 API 库 / 多接口路由 / fallback | `store/settingsStore.ts`（`apiLibrary`/`apiRoutes`/`resolveApiChain`）；`systems/apiChat.ts`（`apiChatFallback`）；`components/ApiRoutePicker.tsx` |
| 角色创建 / 开场白 / 进入世界 | `App.tsx` → `confirmCreation`/`buildOpening`/`enterWorld`；`components/CharacterCreation.tsx` |
| 世界选择（AI 生成乐园） | `components/WorldSelector.tsx`（`generate(mode,override?)`：批量出全部 Roll / 每张卡 ✨ 单独生成累加）；`worldGenPrompt.ts` |
| 世界详情库（工坊档案→卡片生成/正文注入） | `systems/worldDetail.ts`（`fetchWorldDetailsFor`/`ensureWorldDetailFor`/`buildWorldDetailInjection`·三层覆盖 本地修订>全局修订>内置分片）；**分层注入引擎** `systems/worldDetailInject.ts`（分节/词条打分/阶段门控/预算常量）；切片插件 `vite.config.ts` `buildWorldDetailShards`；注入点 `WorldSelector.generate` + `App.tsx` callApi 世界志旁（正文=layered 传 ctxText·细纲=full）|
| 世界资料库面板（浏览/编辑/提交审核/全局生效） | `components/WorldDetailLibPanel.tsx`；本地修订 `store/worldEditStore.ts`(`drpg-worldedit`)；提交/审核 API `systems/worldDetailShare.ts`；服务端 `multiplayer-worker/src/worldDetail.js`（D1·管理员=工坊 adminKey）|
| 设置页路由（哪个子面板） | `components/SettingsPanel.tsx`（大路由）|
| 变量管理页（演化功能中心启动台） | `components/VariableManager.tsx` |
| 全局配置导出/导入（全部功能预设·世界书·API 一键备份迁移） | `systems/configExport.ts`；UI 在 `components/VariableManager.tsx` 底部 `ConfigBackupBar`（变量管理页最下方「配置备份·迁移」）|
| 顶部状态栏 / 双时间显示 | `components/StatusBar.tsx` |
| 代码注入的"铁则"提示词常量 | 大部分 `src/promptRules.ts`，少数 `App.tsx` 顶部（见 §4）|

---

## 2. App.tsx（约 4900 行，主控）— 内部函数地图

> 全在 `App()` 组件内闭包。按关注点分组，名字后是当前近似行号。

**发送 / 正文 / 编排**
- `callApi` (~4521) — 主叙事：拼 system+历史+召回+结构化档案 → 流式 fetch（内置多接口 fallback 循环）→ 解析 `<state>`/`<upstore>` → 触发 `runPostNarrativePhases`
- `runPostNarrativePhases` (~4478) — 正文后**并发**触发全部演化阶段（互不阻塞）
- `sendMessage` (~4802) / `stopGeneration` (~4787) / `rollbackTurn` (~4789) / `regenerateTurn` (~4794) / `captureUndoPoint` (~4783)
- `buildPresetMessages` (~1338) / `applyRegex` (~1285) / `onChatScroll` (~1172)

**物品阶段**
- `runItemManagementPhaseCore` (~1390) / `runItemManagementPhase` (~1598) / `triggerItemPhaseManually` (~1377)
- `runMergedAuditPhase` (~1501) — 物品+主角**合并一次**对账纠错
- `runEnhanceFinalizePhase` / `enhanceBanter` — 装备强化：停止强化收尾刷装备(每+4级+1词缀,纯AI,按 growthCoef 品级×评分缩放) / 点立绘吐槽(分阶段×性别语气)；grep 函数名定位

**主角阶段**
- `runPlayerEvolutionPhaseCore` (~1614) / `runPlayerEvolutionPhase` (~1725)
- `applyPlayerProfileCommands` (~2076) — 解析 `add("B1",{列})` + `character.B1.*` 短指令 → profile

**NPC 阶段**（策略 B 为主）
- `runNpcPipelineB` (~2508) — 三段管线总入口；`runEntryJudgment` (~2348) 登场判断；`applyEntryResult` (~2278) 建档/归档/去重防撞；`computeFocusList` (~2387) 调度选焦点（含好友轮换）；`runNpcFocusEvolution` (~2476) + `runNpcEvolutionForTarget` (~2428) 逐NPC并发
- `runNpcEvolutionPhaseCoreA` (~2578) 策略A；`runNpcEvolutionPhase` (~2616) 分支入口
- `triggerNpcUpdateManually` (~2377) — NPC 面板「⟳ 手动更新」按钮：绕过启用/频率/调度，对单个 NPC 按最近正文跑一次 `runNpcEvolutionForTarget`（状态 `npcManualUpdatingId`，props 经 NpcPanel→NpcCard/NpcDetail）
- `applyNpcShortCommands` (~1924) — `character.<id>.*` / `cr.` / `hp.` / `ap.` 等短指令
- `serializeNpcSnapshot` (~1831) / `buildNpcPhaseSystemPrompt` (~1884) / `buildEntryPhaseSystemPrompt` (~1911)
- `npcChatCompletion` (~1760) / `buildNpcVars` (~1778) / `trimNarrative` (~1753) / `passFrequency` (~2380) / `maybeAskCleanup` (~2460) / `backfillNpcStarterKits` (~2528)

**限时状态**：`applyTimedStatusCommands` (~2178) / `expireStatuses` (~2229，每回合开头按回合/游戏时过期)

**势力**：`runFactionEvolutionPhase` (~4270) / `runFactionWorldJudgment` (~4199) / `runFactionFocusEvolution` (~4230) / `runFactionStrategyA` (~4256) / `computeFactionFocus` (~4185) / `applyFactionShortCommands` (~4159) / `serializeFactionSnapshot` (~4174)

**领地 / 冒险团 / 万族**：`runTerritoryEvolutionPhase` (~2820) + `serializeTerritorySnapshot` (~2803)；`runTeamEvolutionPhase` (~3081) + `serializeTeamSnapshot` (~3064)；`runCosmosEvolutionPhase` (~2955) + `serializeCosmosSnapshot` (~2870) + `buildCosmosInjection` (~2894)

**杂项 / 记忆压缩**：`runMiscEvolutionPhase` (~2728)；`runMemoryCompressionPhase` (~2650)

**叙事记忆**：`buildStructuredRecall` (~3402) / `narrativeCompile` (~3373) / `narrativeSelectChars` (~3385) / `runNarrativeIngestPhase` (~3492) / `nmChatCompletion` (~3362) / `getNmApi` (~3358)

**生图**：`runPortraitPhase` (~3123) / `runEquipImagePhase` (~3212) / `runStoryImagePhase` (~3276)

**频道 / 临时队伍**：`refreshChannel` (~3526) / `replyToChannelPost` (~3593) / `joinPartyFromPost` (~3673) / `inviteToParty` (~3686) / `reconcilePartyLifecycle` (~3720) / `getChannelApi` (~3521)

**系统商店**：`genShopItems` (~4050) / `genSellQuotes` (~4066) / `solicitQuotes` (~4087)

**私信**：`dmReply` (~3801) / `dmPropose` (~3840) / `dmHaggle` (~3898) / `dmAccept` (~3929) / `dmGenArchive` (~4007) / `dmPersonaPrompt` (~3752) / `dmPlayerCard` (~3740) / `openDmFor` (~3733)

**好友 / 故友建档**：`addFriendByInfo` (~4024) / `addFriendFromChannel` (~4033) / `fleshOutContractor` (~3952) / `stripDeadWords` (~3944) / `findNpcByName` (~4019)

**六维代码层生成 / 正文兜底**：`applyNarrativeAttrs` (~4287，扫正文人物卡照抄六维) / `applyNarrativeVitals` (~4318，扫"当前HP/EP") / `genVariedAttrs` (~4379) / `autoGenMissingAttrs` (~4401) / `reconcileScenePresence` (~4457)
> 另有 `reconcilePlayerVitals` / `isHomeWorld` / `reconcileHomeWorld`（回归乐园一致性兜底）—— grep 函数名定位（可能为 const 箭头或在别处）。

**回合洞察**：`captureTurnSnapshot` (~4413) / `buildRecentNarrative` (~4441)

**创建 / 世界**：`confirmCreation` (~4854) / `buildOpening` (~4813) / `enterWorld` (~4887)

---

## 3. systems/（纯逻辑，无 React）

| 文件 | 关键导出 / 职责 |
|---|---|
| `stateParser.ts` | **指令解析中枢**。`lenientJsonParse`(裸键容错)、`parseAllStateUpdates`、`applyItemCommands`(物品/货币/装备，含 destroyItem 自动卸下、equip fallback、`setNpcOwnerResolver`)、`parseAllCharCommands`/`applyCharacterCommands`(技能/天赋/称号/副职业/成就/记忆)、`parseAllNpcCommands`/`applyNpcCommands`(add/de)、`parseAllFactionCommands`/`applyFactionCommands`、`applyTerritoryCommands`、`applyTeamCommands`、`isEquippable`、`CATEGORY_MAP` |
| `derivedStats.ts` | `computeDerived`(物/法 ATK/DEF)、`computeMaxHp`/`computeMaxEp`(=Σ六维×系数表,默认 体×20/智×15)、`VitalRatio`{hp,ep 系数表}/`ratioOf`/`hpCoefOf`/`epCoefOf`/`vitalFormula`(主角·NPC 自定义多属性系数表,缺省回退默认·兼容旧扁平字段)、`effectiveResource`、`lvFromRealm`/`realmFromLevel`、`TIERS`/`normalizeTier`、`gear/abilityMaxHp/EpBonus` |
| `attrBonus.ts` | `ATTR_KEYS`/`ATTR_LABEL`、`parseAttrBonus`(从 effect 文本抽属性加成)、`effectiveAttrs`、`computeAttrBreakdown` |
| `diceEngine.ts` | 确定性判定：`resolve`、各 `*Mod`(属性/技能/天赋/好感/装备/强度差)、`rollExpr`、`buildCheckResultBlock`、难度/强度表 |
| `enhanceEngine.ts` | 装备强化确定性逻辑：`resolveEnhance`(摇率/爆装/降级/保底)、`enhanceCost`(品级×评分×老板)、`scoreCostMul`/`growthCoef`、`stageFromLevel`、`DEFAULT_BOSSES`/`DEFAULT_TABLES`、`enhanceFxClass`/`isEnhanceable` |
| `enhanceBosses.ts` | 老板分阶段立绘清单：`loadBossManifest`/`pickStagePortrait`(读 public/enhance-bosses/manifest.json，中文路径 encode，空阶段就近回退) |
| `diceJudge.ts` | AI 裁判：`aiJudge`、`aiSuggest`(✨建议属性难度)、`buildJudgeBlock` |
| `imageGen.ts` | `generateImage(service,opts)`(NAI ZIP解码/OpenAI/Comfy轮询)、`buildPortraitPrompt`/`buildEquipPrompt`、`shrinkDataUrl` |
| `imageTags.ts` | 列19 danbooru tags：`genPortraitTags`/`genEquipTags`、`tagsLlmReady`/`isTagService` |
| `imageDb.ts` / `imageSync.ts` | 图片存 IndexedDB `drpg-images`：`putImg`/`getAllImg`/`bulkPutImg`/`clearAllImg`；`imageSync` 订阅 store 镜像 + `hydrateImages`/`snapshotImages` |
| `novelVec.ts` | 向量资料库运行时：`loadNovelIndex`/`retrieveNovel`/`searchAll`/`embedQuery`/`novelVecStatus`（多源 novel+worldbook，IndexedDB `drpg-novelvec` v2） |
| `narrativeMemory.ts` | 关键词召回：`tokenize`/`recallFacts`/`buildNarrativeHistory`；提示词 `NM_COMPILE_PROMPT`/`NM_INGEST_PROMPT` |
| `structuredRecall.ts` | 结构化档案召回：序列化主角/NPC/势力卡（`serializePlayerCard` 等），供 `buildStructuredRecall` |
| `miscParser.ts` | 杂项指令：`applyMiscCommands`(总结/双时间/天气/世界大事/`T_`任务)、`extractTurnSummaries` |
| `gameClock.ts` | 游戏时间：`parseGameMinutes`/`parseDurationMinutes`/`parseDurationTurns`/`fmtMinutes` |
| `equipSlots.ts` | `SLOT_DEFS`、`normalizeEquipSlot`/`pickEquipSlot`/`resolveEquipSlot`/`slotAcceptsCategory` |
| `channelTrade.ts` | 频道交易：`buyFromListing`/`postWantToBuy`/`postSellItem`/`acceptQuote`/`isBuyable` |
| `dmTrade.ts` | 私信结算：`settleDmDeal`(确定性转账，对方收物入其NPC储存)/`dealSummary` |
| `apiChat.ts` | `apiChatFallback(chain,messages,opts)` 多接口轮流+失败切换 |
| `apiThrottle.ts` | `acquireApiSlot`(并发+最小间隔限流) |
| `chatDb.ts` | 对话 IndexedDB `drpg-chat`：`loadAll`/`putChanged`(增量)/`replaceAll`/`clearAll` |
| `saveDb.ts` / `saveManager.ts` | 多存档 IndexedDB `drpg-archive`：`saveSlot`/`loadSlot`/`newGame`/`autoSaveSlot`/`clearProgress` |
| `wbDb.ts` | 世界书条目 IndexedDB 存储 |
| `configExport.ts` | 全局配置导出/导入：`buildGlobalConfig`/`downloadGlobalConfig`/`importGlobalConfig`。白名单提取 15 个配置 store 的 `settings`+`*Api`+`*UseSharedApi`（剔运行时数据，世界书只导非 builtin），导入用 zustand `setState` 浅合并不污染游戏进度、无需 reload。**仅配置不含存档** |
| `combat.ts` | 旧战斗 `rollDamage`/`power`（大多未用） |

---

## 4. "代码注入铁则"提示词常量（**改即生效、无需重导预设**）

各 `run*Phase` 拼完导入预设后**追加**这些硬编码规则。改提示词规则**优先改这里**（对当前存档即时生效）：

`NARRATIVE_FIRST_RULE`(逐条参照正文) · `BUFF_AS_STATUS_RULE` · `SUBPROF_RULE` · `NPC_AGE_RULE` · `FACTION_WORLD_RULE` / `FACTION_FULL_FORMAT_RULE` / `FACTION_HOME_EXIT_RULE` · `ITEM_FIXED_FORMAT_RULE` / `ITEM_EXACT_REF_RULE` · `EVO_EXACT_REF_RULE` · `TALENT_NO_CAP_RULE` · `SKILL_TIER_RULE` · `IMAGE_TAGS_RULE` · `MISC_HOME_TIME_RULE` · `CHANNEL_AUTHOR_INFO_RULE` · `MERGED_AUDIT_SYSTEM`/`MERGED_AUDIT_PROMPT`
> **大部分常量已抽到 `src/promptRules.ts`（集中维护，改提示词来这里），少数仍在 App.tsx 顶部。grep 常量名即可跨文件定位。**

---

## 5. store/（Zustand + persist，localStorage 持久化）

| store | persist key | 职责 / 关键 action |
|---|---|---|
| `gameStore.ts` | `drpg-save` | 玩家 hp/mp/atk/def、副本/战斗。**手写持久化、无 rehydrate**（读档靠 reload）|
| `settingsStore.ts` | `drpg-settings` | API/世界书/文本预设/正则/`apiLibrary`/`apiRoutes`/`resolveApiChain`/`narrativeMemory`/`nmApi`/`customOpening` |
| `itemStore.ts` | `drpg-items` | 背包/4种货币/物品预设。`addItem`(可堆叠类累加)、`dedupeByName`、`isStackableCat`。图片经 partialize 排除 |
| `playerStore.ts` | `drpg-player-evo` | 主角演化预设/独立API/`profile`(身份档案)/`achievements` |
| `npcStore.ts` | `drpg-npc` | NPC 档案/持有物/场景/调度。`setFriend`/`createArchivedContractor`/`createPartyMember`/`dedupeNpcItems`/`absorbOrphans`/`hardRemoveNpc` |
| `npcEvoStore.ts` | `drpg-npc-evo` | NPC 演化预设/API/策略A·B/`scheduling`(并发/配额/好友数)；`buildNpcSystemPrompt`/`buildEntrySystemPrompt`/`smartFilterEntries` |
| `factionStore.ts` | `drpg-faction` | 势力档案 `FactionRecord`（`inCurrentWorld`）|
| `factionEvoStore.ts` | `drpg-faction-evo` | 势力演化设置/API |
| `adventureTeamStore.ts` | `drpg-team` | 冒险团（数据+设置+API 合一）。注意成员是 `upsertMember` 不是 addTeamMember |
| `territoryStore.ts` | `drpg-territory` | 领地（数据+设置+API 合一）|
| `cosmosStore.ts` | `drpg-cosmos` | 万族演化 |
| `characterStore.ts` | `drpg-characters` | 技能/天赋/称号/副职业/记忆（B1+Cx 共用）。`mergeKeepRich`(空字段保旧)、`nameEq`(归一化匹配)、`SKILL_TIER_*`/`normSkillTier`、`removeCharacter`/`purgeNpcCharacters` |
| `memoryStore.ts` | `drpg-memory` | 生平压缩设置+提示词+API |
| `miscStore.ts` | `drpg-misc` | 杂项(任务/总结/`narrativeFacts`/双时间/天气)+预设+API。`addNarrativeFacts` |
| `imageGenStore.ts` | `drpg-image-gen` | 生图服务/用途/模板/自动开关 |
| `channelStore.ts` | `drpg-channel` | 公共频道（数据+设置+API+预设）|
| `dmStore.ts` | `drpg-dm` | 私信线程/消息/交易卡 |
| `turnInsightStore.ts` | `drpg-turn-insight` | 回合洞察快照（滚动14份）|
| `creationTemplateStore.ts` | `drpg-creation-templates` | 角色创建模板 |
| `novelVecStore.ts` | `drpg-novelvec` | 向量资料库设置（embedding 接口/topK/阈值/maxChars）|
| `enhanceStore.ts` | `drpg-enhance` | 装备强化：老板名册/率表(配置)、`pity`垫子计数(账号级全局,不进存档/不导出)、`session`本轮日志。立绘 partialize→IndexedDB；`hydrateEnhancePortraits` |
| `skillTreeStore.ts` | `drpg-skilltree` | 职业技能树：`trees`模板库(配置/可分享) + 每角色`progress`(解锁进度/潜能点,随存档)。`unlockNode`(扣潜能点+灌 addSkill/addTrait)、`respec`、编辑器ops(addNode/addEdge拒环/...)。仅 B1 |
| `variableStore.ts` | — | 自定义变量（`<state>` 兜底查找）|
| `imageViewerStore` / `imageBusyStore` | — | UI 瞬时（看图/生图忙提示）|
| `composerStore` | — | UI 瞬时：`draft`/`fill(text)`，背包「使用」物品把「使用XX」填进主聊天输入框（App 订阅 draft→setInputValue+关背包+聚焦）|

> **所有 `drpg-*` 持久化，刷新不清是存档机制**。彻底重置=清 `drpg-` 开头 localStorage。图片大、存 IndexedDB `drpg-images`（不进 localStorage）。

---

## 6. components/（按用途）

**外壳/正文**：`StartScreen`(封面热区) · `CharacterCreation`(开局) · `SettingsPanel`(设置大路由) · `VariableManager`(演化功能中心启动台) · `StatusBar`(顶部双时间/天气) · `ErrorBoundary` · `Bar` · `VersionToast` · `ImageBusyToast` · `ImageViewer`

**主角侧**：`PlayerSidebar`(身份档案/六维/状态，点击即编辑) · `PlayerEquipPanel`(左浮窗装备) · `CharacterPanel`(✨技能/天赋，仅B*) · `TitlePanel`(🎖称号) · `AchievementPanel`(🏆成就) · `SubProfessionPanel`(🛠副职业) · `ItemListPanel`(右下物品栏浮窗) · `StatusEffectChips`/`StatusChips`(状态胶囊) · `CharEditForms`(`SkillEditForm`/`TraitEditForm` 技能·天赋手动编辑表单，主角 CharacterPanel + NPC NpcDetail 共用，写 `characterStore.updateSkill/updateTrait`)

**装备/背包**：`EquipmentPanel`(⚔玩家装备槽) · `BackpackModal`(🎒储存空间，含 `CurrencyConverter` 乐园币↔灵魂钱币 1:15万) · `NpcEquip`(NPC装备)；三者装备卡均显 `+N` 强化角标

**NPC**：`NpcPanel`(📇档案列表) · `NpcDetail`(单角色11栏，导出 `SegmentedText`/`StatusChips`) · `OnScenePanel`(右上在场浮窗)

**右侧导航面板**：`FactionPanel`(🏛) · `TerritoryPanel`(🏯) · `AdventureTeamPanel`(🛡) · `TurnInsightPanel`(🔍回合洞察) · `MiscPanel`(📋任务) · `SummaryPanel`(🧠记忆) · `CosmosPanel`(🌌) · `ChannelPanel`(📡频道) + `SystemShop`(🏪) · `DmPanel`(✉私信) · `FriendsPanel`(👥好友) · `SaveLoadPanel`(💾存档) · `DicePanel`(🎲in-chat骰子) · `EnhancePanel`(⚒强化所：左看板娘立绘+切换+吐槽气泡/中被强化装备+特效/右选装备+率+花费+日志)

**设置子页（演化管理）**：`ItemManager` · `PlayerManager` · `NpcManager` · `FactionManager` · `TerritoryManager` · `AdventureTeamManager` · `CosmosManager` · `MemoryManager` · `MiscManager` · `ChannelManager` · `ImageGenManager` · `NovelVecManager` · `DiceManager` · `EnhanceManager`(装备强化:老板名册/立绘文件夹/率表/API)

**API/其他**：`ApiRoutePicker`(多接口路由配置) · `ApiQuickPick`(旧,未引用) · `WorldSelector`(AI生成乐园) · `Hub`/`InstanceView`(旧副本，大多未用)

---

## 7. 其它

- **数据/工具**：`src/data/{monsters,events,instances,enhancements}.ts`(旧副本数据，多未用)、`src/worldGenPrompt.ts`、`src/types.ts`、`src/version.ts`
- **建库脚本**：`tools/build-novel-vectors.mjs`（`npm run build-vectors` 小说 / `build-vectors-wb` 世界书）
- **强化老板立绘**：源放仓库根 `图片/<老板>/阶段1~4/`(入库)；`vite.config` 插件 `syncEnhanceBosses` build/dev 同步进 `public/enhance-bosses/` + 生成 `manifest.json`(副本 gitignore)
- **Cloudflare 代理**：`functions/proxy/[[path]].js`（同源 CORS 透传，不存 key）
- **预设文件**（仓库根 `预设/*.json` + `src/data/*DefaultPreset.json`）：导入到各演化管理子页
