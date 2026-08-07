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
| 物品重复（同物两条·一条有详情一条空壳） | `App.tsx` → `reconcileDeferredCreates`；`systems/stateParser.ts` → `deferredCreateSkipReason`(补建前三道判定) / `findIdenticalItem`(创建闸门判重)；`systems/itemWatchdog.ts` → `pruneBlankDupItems`(回合末空壳清理) |
| 主角演化 | `App.tsx` → `runPlayerEvolutionPhaseCore` / `applyPlayerProfileCommands`；`store/playerStore.ts` |
| NPC 演化（策略A/B、登场判断、调度） | `App.tsx` → `runNpcPipelineB` / `runEntryJudgment` / `computeFocusList`；`store/npcStore.ts` / `npcEvoStore.ts` |
| 🕸 NPC 关系图谱 | `systems/relationGraph.ts`(建图+ego子图+力导向布局·纯函数) → `components/RelationGraph.tsx`(SVG渲染)；入口：`NpcPanel` 头部「🕸 图谱」全局图 / `NpcDetail` 关系页 ego 局部图 |
| 📖 NPC 成长小传 | `npcStore.NpcRecord.lifeStory`；规则 `promptRules.NPC_LIFE_STORY_RULE`；自动生成 `App.tsx` → `runNpcEvolutionForTarget` 解析 `<小传>` 块；手动补写 `systems/npcLifeStory.ts` → `NpcDetail` 的 `LifeStoryBox` |
| 势力演化 | `App.tsx` → `runFactionEvolutionPhase` 等；`store/factionStore.ts` / `factionEvoStore.ts` |
| 领地 / 冒险团 / 万族 演化 | `App.tsx` → `runTerritory…` / `runTeam…` / `runCosmos…`；对应 store |
| 杂项演化（总结/双时间/天气/大事） | `App.tsx` → `runMiscEvolutionPhase`；`systems/miscParser.ts`（`applyMiscCommands` 支持 `domain:'tasks'/'world'` 域过滤）；`store/miscStore.ts` |
| 任务演化（独立阶段·主线路线图/环推进/结算·独立API featureKey='quest'） | `App.tsx` → `runQuestEvolutionPhase` / `manualGenTask`；开关+API 在 `miscStore.settings.questEnabled`/`questApi`；UI `components/QuestManager.tsx` |
| 生平压缩 | `App.tsx` → `runMemoryCompressionPhase`；`store/memoryStore.ts` + `characterStore.memory` |
| 叙事记忆（召回/改写/抽取/结构化档案） | `App.tsx` → `buildStructuredRecall` / `narrativeCompile` / `runNarrativeIngestPhase`；`systems/narrativeMemory.ts` / `structuredRecall.ts` |
| 向量资料库（原著+世界书语义检索） | `systems/novelVec.ts`；`store/novelVecStore.ts`；`components/NovelVecManager.tsx`；建库 `tools/build-novel-vectors.mjs` |
| 技能/天赋/称号/副职业/成就/记忆 数据 | `store/characterStore.ts`（B1+Cx 共用）；成就在 `store/playerStore.ts` |
| 技能/天赋指令 | `systems/stateParser.ts` → `parseAllCharCommands` / `applyCharacterCommands` |
| 职业技能树（潜能点·节点解锁·可点次数·可视化编辑） | `systems/skillTree.ts`（确定性结算/校验；`nodeMaxRank(node,tree)` 读 `tree.maxRankOverride`＝每节点豆子数统一设置、`clampRanksToMaxRank` 削平退点）；`store/skillTreeStore.ts`；`components/SkillTreePanel.tsx`(玩家🌳)/`TreeCanvas.tsx`(共享SVG)/`SkillTreeManager.tsx`(编辑器)；提示词 `SKILLTREE_GEN_PROMPT` |
| 自定义能量条（HP/EP外·剧情/技能消耗/战斗累积·仅主角） | `store/resourceStore.ts`；上限/累积 `systems/playerVitals.ts`(`playerResourceMax`/`applyCombatResourceGains`/`resetCombatResources`)+`derivedStats.ts`(`computeAttrPool` 六维公式)；指令 `res.B1.<id>` 在 `systems/stateApply.ts`；注入 `systems/structuredRecall.ts`；UI `components/PlayerSidebar.tsx`(⚡管理+🎯技能绑定)；技能消耗/门槛 `skill.numeric.resCost/resGate`+`components/CombatPanel.tsx`；战斗累积钩子 `App.tsx`→`resolveAndNarrate`(出手+DoT) |
| 衍生属性 / HP·EP 上限 / 阶位↔等级 | `systems/derivedStats.ts` |
| 装备槽位 | `systems/equipSlots.ts`；`components/EquipmentPanel.tsx` / `NpcEquip.tsx` |
| 骰子判定 | `systems/diceEngine.ts`（确定性）/ `diceJudge.ts`（AI裁判）；`components/DicePanel.tsx` / `DiceManager.tsx` |
| 装备强化（仅乐园·看板娘·爆装保底） | `systems/enhanceEngine.ts`（确定性摇率/费用/爆装/保底）+ `enhanceBosses.ts`（分阶段立绘 manifest）；`store/enhanceStore.ts`；`components/EnhancePanel.tsx` / `EnhanceManager.tsx`；`App.tsx`→`runEnhanceFinalizePhase`/`enhanceBanter`；立绘 vite 插件 `syncEnhanceBosses`(vite.config) |
| 装备工艺（🔨锻造潜力/精髓/腐化/自创） | `systems/equipCraft.ts`（潜力·结果摇号·参数夹取·风险定价）；`store/equipCraftStore.ts`；UI = `EnhancePanel.tsx`→`CraftView`；`App.tsx`→`runEquipCraftPhase`/`confirmEquipCraft`/`extractEssence`/`runCraftProcessGenPhase`；提示词 `EQUIP_CRAFT_RULE`/`CRAFT_PROCESS_GEN_RULE`；分享 `workshop.ts` KIND `craftProcess` |
| 编年史 / 传奇模式（📜本纪+前尘） | `systems/chronicle.ts`（史料投影·重要性分级·分卷·互链·摘要）；`store/chronicleStore.ts`（rowMeta 分卷索引 + 编纂正史）；`components/ChroniclePanel.tsx`；分卷索引钩子在 `systems/tableEditParser.ts`→`applyTableEdits`（纪要行 insertRow 处）；`App.tsx`→`runChronicleCompilePhase`/`collectDeedSources`/`knownEntities`；提示词 `CHRONICLE_COMPILE_RULE` |
| 楼层分支树（🌿弃稿=可回收平行线） | `systems/branchTree.ts`（切回合·挂载·泳道布局·纯函数）；`components/BranchTreePanel.tsx`（SVG 时间线 + `usePinchPanZoom`）；存取全在 `systems/saveManager.ts`→`BRANCH_PREFIX`/`saveBranchPoint`/`listBranchPoints`/`pruneBranchPoints`/`setBranchPinned`/`deleteBranchPoint`/`clearBranchPoints`；抓取点 `App.tsx`→`stashDiscardedBranch`(在 `rollbackTurn`/`regenerateTurn` 的 loadSlot **之前**)/`bookmarkBranchPoint`/`jumpToBranch`；开关 `settings.branchCapture` |
| 冒险团派遣（⚔离线委托·倒数封条） | `systems/dispatchEngine.ts`（委托板生成/胜算评估/**确定性结算**/心跳 `runDispatchTick`/`ensureBoard`/`launchDispatch`/`grantReward`）；AI 委托板 `systems/dispatchGen.ts`（手动）；提示词常量 `systems/dispatchPrompts.ts`；战报 `systems/dispatchReport.ts`（**独立 API featureKey='dispatch'**·只叙述不改数值·失败回落 `fallbackReport`）；数据+哑 reducer 在 `store/adventureTeamStore.ts`（`dispatchActive`/`dispatchHistory`/`fatigue`/`injury`/`dispatchApi`）；UI `components/DispatchPanel.tsx`（挂在 `AdventureTeamPanel` 的 ⚔派遣 tab）；心跳挂 `App.tsx`→`runPostNarrativePhases`（**排在 `runNpcAutonomy` 之后**）；⚠ 轨道A 靠 `npcAutonomy.runNpcAutonomy` 里的 `dispatched` 集合让开、防双写 |
| 内置原著WIKI（📚两本·MkDocs 静态站） | `components/WikiPanel.tsx`（`SITES` 表=选书卡+iframe；先选书后加载）；右栏入口 `App.tsx`→`rightMenuItems` 的 `原著WIKI` + `runNavAction`/`wikiOpen`；构建 `vite.config.ts`→**`WIKIS` 表** + `buildWiki()`（每次 build 跑 mkdocs，单站失败不阻断另一站与游戏）。源 = 仓库根 `lunhui-wiki/`→`public/wiki/`、`神秘复苏百科/`→`public/wiki-shenmi/`（产物均 gitignore）。⚠ 加书 = **两处表都要加**且产物目录对得上；各 `mkdocs.yml` 必须 `use_directory_urls: false`（否则目录式 URL 被 SPA 兜底吃回游戏）+ `navigation.prune`（否则整棵 nav 嵌进每页）。神秘复苏的 nav 由 `神秘复苏百科/scripts/gen-nav.py` 生成（新增条目后重跑） |
| 正文关键词悬浮图鉴（名词 tooltip） | `systems/codexIndex.ts`（名字→词条索引·惰性重建·扫描器）；标注在 `systems/narrativeHtml.ts`→`markEntities`（挂在 `styleProse` 末尾·`ProseCtx` 贯穿整条消息）；悬浮卡 `components/CodexHover.tsx`（document 委托·portal）；wiki 层 `systems/lunhuiChars.ts`；开关 `settings.reading.codexHl`/`codexWiki`；样式 `index.css` `.zs-ent` |
| 生图（NAI/OpenAI/Gemini/Comfy/多模态Chat） | `systems/imageGen.ts` / `imageTags.ts`；`store/imageGenStore.ts`；`App.tsx` → `runPortraitPhase`/`runEquipImagePhase`/`runStoryImagePhase` |
| 📖 漫画工坊（完整复刻 comic-orb·已授权） | `systems/comic.ts`（`generateComic`：direct=直接分镜 / interpretive=演绎切段→**错峰并发分镜(首败中止余段)**→合并重编页码 `runInterpretive`；`retryMissingPages`/`redrawPage`(旧版进 versions·cap3)/`restoryboardBatch`(重新分镜+全页重画)/`cancelComic`；可恢复错误 `withRetry` 自动重试；写回楼层=CustomEvent `zs-comic-insert`→App 监听追加 ChatMessage.images）；`systems/comicTransport.ts`（运输副本：`neutralizeForTransport` 措辞中性化+`removeAgeExpressions` 年龄剔除·只改请求副本）；`systems/comicDb.ts`（IndexedDB `drpg-comics`·**不进 saveManager**·页记录带 versions）；`store/comicStore.ts`（workflowMode/pagesMin-Max/workerPages/safetyLevel(off/soft/safe)/neutralize/insertToFloor）；提示词 `promptRules.ts`→`COMIC_STORYBOARD_RULE`(完整 comic_orb_storyboard_v1 协议)/`COMIC_RUNTIME_GUARDS`/`COMIC_ADAPTATION_RULE`/`COMIC_SAFETY_SOFT·SAFE·SAFE_FINAL`/`COMIC_AGE_NEUTRAL_RULE`/`COMIC_CLOSED_WORLD_RULE`×2/`COMIC_GAZE_RULE`/`COMIC_DRAW_SAFE_PREFIX`/`COMIC_ADULT_IDENTITY_RULE`/`COMIC_TAGS_RULE`(NAI/Comfy 标签线)；UI `ComicTabPage`；分镜/演绎 LLM 走 `resolveApiChain('comic_storyboard_llm')` |
| 👗 衣柜（穿搭预设·服装单一权威源） | `store/outfitStore.ts`（`drpg-outfit`·byChar[charId]={outfits,activeId}·进度类进 STORES 带 clear）；`systems/outfit.ts`（`activeOutfit`/`outfitRosterLine`/`applyOutfitCommand` AI换装/`outfitImageKey`）；接线：生图三线（`imageGen.buildPortraitPrompt` charId 字段·钦定穿搭>装备栏>外观/`App.genStoryImagesFor` charLine/`comic.buildRoster`+`collectRefs` 穿搭参考图）+ **正文**（`promptInjections.buildOutfitInjection` `<钦定穿搭>` 块·两注入位）+ **<state> 指令** `outfit.<角色ID>=穿搭名|场景标签|无`（`stateApply.applyOneUpdate`·名/标签模糊·NPC名唯一自纠）；参考图存 imageDb `outfit:<charId>:<id>`（随存档快照·chatimg 线随参考图发送·`outfitRefImages`+`OUTFIT_REF_HINT` 接立绘5生成点）；**跨存档模板库** `store/outfitTemplateStore.ts`（drpg-outfit-tpl·⚠不进 STORES·同名覆盖）+模板图 `systems/outfitTemplateDb.ts`（独立 IDB `drpg-outfit-templates`）；UI `components/OutfitPanel.tsx`（增删改+激活单选+从当前穿着导入+📷参考图+⭐存模板+📚模板库导入），入口 PlayerSidebar 👗 + NpcDetail 肖像绘卷；单测 `systems/outfit.test.ts`（7例） |
| 🖼 生成图片库（按名字分组浏览·漫画自成一类） | `systems/gallery.ts`（`collectGallery` 只读聚合：角色 avatar/装备 item.image(同名合并)/正文配图(chatDb 行内 images·带提示词·限150张)/漫画(comicDb 一批一组)）；UI `components/ImageGenManager.tsx`→`GalleryTabPage`（生图设置「图片库」Tab·分类筛选+名字瓷砖+灯箱翻看/提示词/下载/📤分享到交流室）|
| 🖼 交流室图片分享（公共图片区·频道） | worker：`multiplayer-worker/src/chatImage.js`（POST/GET `/api/chat/image[s]`·R2 `img/` 内容寻址+D1 `chat_images`·公共池 `?scope=public`·**需 redeploy relay**）+ `ChatDO.js` `case "image"`（只透传 {hash,w,h,caption} 引用·不广播大图）；前端：`systems/chatImages.ts`（`uploadChatImage`/`chatImageUrl`/`listPublicChatImages`/`shareImageToChannel`·频道名 `IMAGE_CHANNEL='images'`）、`chatProtocol.ts` `ChatImageRef`、`chatClient.image()/channel()`、`ChatRoomPanel` 频道页签(💬闲聊/🖼图片分享)+📷上传+🗂公共图池+灯箱 |
| 图片持久化（IndexedDB） | `systems/imageDb.ts` / `imageSync.ts` |
| 公共频道 / 系统商店 / 临时队伍 | `App.tsx` → `refreshChannel`/`replyToChannelPost`/`joinPartyFromPost`/`inviteToParty`；`store/channelStore.ts`；`systems/channelTrade.ts` |
| 私信（聊天/交易/讨价还价） | `App.tsx` → `dmReply`/`dmPropose`/`dmHaggle`/`dmAccept`；`store/dmStore.ts`；`systems/dmTrade.ts` |
| 好友栏 / 故友建档 | `App.tsx` → `addFriendByInfo`/`fleshOutContractor`；`store/npcStore.ts`（`setFriend`/`createArchivedContractor`）|
| 存档（多存档/新游戏/读档） | `systems/saveManager.ts` / `saveDb.ts`；`components/SaveLoadPanel.tsx` |
| 对话持久化（跨刷新） | `systems/chatDb.ts` |
| 中心 API 库 / 多接口路由 / fallback | `store/settingsStore.ts`（`apiLibrary`/`apiRoutes`/`resolveApiChain`）；`systems/apiChat.ts`（`apiChatFallback`）；`components/ApiRoutePicker.tsx` |
| `<state>` 中文货币指令（乐园币/灵魂钱币 ±=） | `systems/stateApply.ts` → `scanCjkCurrencyUpdates`（parseLine 的 key 正则是 ASCII \w 认不出中文键，此函数只扫 `<state>` 块补合成 StateUpdate）+ `reconcileSettlementCurrency`（结算忠于面板·含「面板有授予但无指令幸存→前端补入账」兜底）；测试 `settlementCurrency.test.ts` |
| 联机来宾奖励防回滚（离房 loadSlot 整档还原吞奖励） | `systems/mpPendingRewards.ts`（pending/replay 双键·**都不在 saveManager.STORES → 穿越还原**；进房 `clearMpPending`/离房先 `promoteMpPending` 再 loadSlot/开机 `replayMpPendingOnBoot` 补发）；记账点 App.tsx `applyRaidReward`+`raid_loot`+`raid_loot_result`、`systems/mpGift.ts` `acceptGift` |
| 五阶前「深渊→幽冥」UI 封印 | `systems/derivedStats.ts` → `isAbyssLocked`（从 App 抽出共用）；App `navItems`（导航/⌘K 显示名映射·`runNavAction` 认「幽冥」别名）+ `AbyssPanel` 标题；正文侧仍是 `ABYSS_LOCK_RULE`+`scrubAbyss` |
| P4 手机端加固（08-04·375px 全量过检无溢出） | 分组导航抽屉自带 overflow-y-auto 可滚；结晶兑换行 flex-wrap；`SystemShop` 头部三币行改 flex-1 min-w-0 truncate（标题 shrink-0，防长数字+当地货币名挤爆）；`JoyPanel` 头部标题/副标题补 truncate；VersionToast w-[min(560px,92vw)] 条目文本 min-w-0 自动换行；⌘K 列表 max-h-[52dvh] 自滚 |
| 全局 toast / 空态深链 / 洞察设施区（P4） | toast：`store/toastStore.ts`（pushToast·同文案去重·同屏≤4）+ `components/GlobalToasts.tsx`（App 常驻挂载）；facilityBridge 的 `toast: true` 选项=**仅后台事件**开（交易行成交/托管归还×5、派遣酬劳、来宾补发），面板内操作勿开防噪音。深链：`systems/navBus.ts` → `openSettingsPage(page)`（CustomEvent `zs-open-settings`）→ App 监听 `settingsDeepPage` → `SettingsPanel.initialPage`；9 面板空态已变可点按钮（Arena/Team/Faction/Territory/Cosmos/WorldCodex/Channel/SkillTree/SubProf）。洞察：facilityBridge `peekFacilityLog/clearFacilityLog`（清空在 callApi 与通报 drain 同窗口）→ `TurnSnapshot.facilityNotes` → TurnInsightPanel「🎡 设施动态」区 |
| ⌘K 深动作 / 导航红点 / 更新日志（P4） | 深动作表 `App.tsx` 模块级 `PALETTE_ACTIONS`（装备强化/技能升级/竞技场/赌场/系统商店/结算任务/重算变量·欢愉宫按开关追加）→ `paletteItems` memo 传 CommandPalette，run 分支在 `runNavAction`，拼音别名在 `CommandPalette.ALIAS`；红点泛化 `navBadges` memo（聊天室未读+派遣战报未读 `dispatchHistory[].read`）同喂导航与⌘K；更新日志 `version.ts` → `VERSION_NOTES[{text,nav?}]`（nav=点击经 runNavAction 直达）+ `VersionToast` 列表渲染（VERSION_NOTE 兼容保留=第一条） |
| 分组导航（P4·新版默认·可关回平铺） | `App.tsx` 模块级 `NAV_GROUPS`（7 组·成员按 label·「幽冥」按「深渊」归组·未归组新项自动落「其他」兜底）+ 组件内 `navSections` memo（`settings.navGrouped` 关=null→原平铺路径逐像素不变）；开关 `settingsStore.navGrouped`（默认 true）+ SettingsPanel 外观页「导航布局」区块 |
| 经济缝合（P3·死货币接汇） | 灵魂结晶→觉醒充能：`abyssStore.chargeWithCrystals`（小1/中2/大4 单位·凑4换1·AbyssPanel 觉醒区按钮·测试 `abyssCrystal.test.ts`）；烙印等级≥3=贵宾厅替代门槛（`CasinoPanel` vipUnlocked）；NPC 技能点→NPC 技能升级（`SkillUpgradePanel` 升级对象下拉·付费锚其自身 `npc.skillPoints`·`generateSkillUpgrade` 加 owner 参·黄金质变/副职业仍仅主角）；当地货币→系统商店三币路由（`SystemShop.curKind`+`genShopItems/genSellQuotes` 教当地计价·顺手补购/售通报）；结算货币表补十~十四阶魂币档+宝箱十阶不抬档名（promptRules 结算奖励节） |
| 叙事读回（P2·此前"只出不进"的死数据） | 天气+近3条世界大事进 `<当前时空>`：`promptInjections.buildWorldTimeInjection`；`<设施近况>`（赌坊战绩/深渊最深层·五阶前称幽冥/名下产业）：`promptInjections.buildFacilityInjection`；`<剧情坐标>`（约定表进行中+进程表·每回合小摘要）：`plotThreads.buildPlotStateBrief`（并入 `buildPlotGuardInjection` 排最前）；前尘提要（上一世界编纂正史→进世界过场）：`chronicle.buildPriorSaga`+`App.enterWorld`；外派状态（勿让外派成员现身）：App structRest 冒险团段读 `dispatchActive` |
| 🌍 任务/伏笔的世界作用域（切世界不串味） | **任务**＝物理封存：`miscStore` 的 `MiscTask.worldName`(建档自动记·乐园留空=跨世界) + `frozenTasks[]` + `freezeTasksOfWorld`/`thawTasksOfWorld`/`unfreezeTask`/`clearFrozenTasks`；调用点在 `App.enterWorld` 紧挨 `freezeWorld`/`thawWorld`（**不放进 worldScope 内部**——miscStore 已 import 它的 isHomeWorld/sameWorld，反向再引成 ESM 循环）；UI 在 MiscPanel 任务 tab 的「🧊 已封存」区。<br>**伏笔**＝旁路索引：`store/rowScopeStore.ts`(`drpg-row-scope`·key=`${uid}:${rowId}`·**必须带表前缀**) 记埋下时的世界，写入点＝`tableEditParser.applyTableEdits` 的 insertRow + `proposalCard.applyProposal`；过滤走 `plotThreads.threadInCurrentWorld`，三处同口径（`<伏笔催收>`/楼层条/参谋清单）。⚠ 无索引一律保留（老存档/手动加的行绝不弄丢） |
| ⚡ 面板秒开（加载态+预热·治「点按钮很久才出面板」） | `components/PanelLoading.tsx`（所有弹窗层 `<Suspense fallback>`，替换原 `fallback={null}`；160ms 延迟浮现＝热加载绝不闪烁，样式 `index.css .panel-loading-fade`）+ `App.tsx` 顶部 `PREFETCH_PANELS`(~55 个面板 dynamic import 清单·高频在前) + `prefetchPanelsOnIdle()`（进游戏 2.5s 后逐个预热·150ms 间隔·失败静默·完成打 `[Prefetch] N 个面板 chunk 预热完成`）+ `main.tsx` 的 `vite:preloadError` 兜底从静默刷新升级为「⚡ 检测到新版本，正在为你刷新…」横幅后再 reload。⚠ 新增 lazy 面板记得进 `PREFETCH_PANELS` 清单 |
| 🎭 小剧场·花样模板库 | `systems/theaterTemplates.ts`（15 条内置 + `pickTemplates` 抽取 + `buildTheaterStyleBlock` 注入块）+ `store/theaterStore.ts`（`drpg-theater`·**配置类·saveManager 不给 clear**·已进 configExport·`ensureSeeded` 只种一次·`restoreBuiltins` 按 id 补缺）+ SettingsPanel 的 `TheaterTemplateSection`（正文生成→API 配置页·小剧场开关下方）。注入点在 `App.runChoicesFanficPhase` 的 `wantTheater` 分支（MINI_THEATER_RULE → 人物档案 → **花样块**）。⚠ `MINI_THEATER_RULE` 里原先写死的 15 个风格词已改为「由随后的【本次小剧场·花样】指定」；⚠ 兜底：模板全禁用/删空 → `pickTemplates` 回退内置全集，绝不返回空 |
| ⭐ 坐标（收藏楼层·存快照非指针） | `store/bookmarkStore.ts`（`drpg-bookmarks`·lzStorage 压缩·CAP 200·单条快照 6000 字截断·同 msgId 幂等）+ `components/BookmarkButton.tsx`（挂每条 AI 正文右上角；**自订阅「本楼是否已收藏」这一个布尔**，App 不订阅 bookmarkStore）+ `components/BookmarkPanel.tsx`（lazy·搜索/标签筛/备注/跳回/导出 md）。楼层 DOM 上的 `data-msg-id` 是跳回的锚。⚠ **存的是收藏那一刻的正文快照**，原楼被编辑/重生成/挤出 historyLimit/切世界清空都不影响；`jumpToFloor` 找不到 DOM 就明说，不假装成功 |
| 🧭 参谋 · 提案卡（AI 出卡→点应用才落库） | `components/AdvisorPanel.tsx`（局外对话窗·lazy·导航「参谋」→`runNavAction`）+ `systems/proposalCard.ts`（`parseProposals` 剥卡 / `stripProposalsForApi` 防抄旧卡 / `applyProposal` **唯一写库入口** / `proposalLines` 卡面 / `buildAdvisorContext` 现状清单带 id）+ `store/advisorStore.ts`（`drpg-advisor`·滑窗 40·`applied[]` 防重复应用）+ `promptRules.ADVISOR_SYSTEM_RULE`。路由 `resolveApiChain('advisor', 杂项接口)`——**留空即回退杂项 API，不必另配**。⚠ 本窗对话**永不进正文上下文**；⚠ 落库走各 store 既有 action（quest→`upsertTask`/`editTask`、thread→`insertRow`**+必须补记 tableJournal**否则账龄查无记录＝久远、almanac→`useCalendar.upsert`） |
| 🗓 世界历（节日/生日/纪念日） | `systems/calendar.ts`（纯逻辑）+ `store/calendarStore.ts`（`drpg-calendar`·进度类·已进 saveManager STORES 带 clear·CAP 60·同名同世界判重）+ `systems/miscParser.ts` 的 `almanac([...])` / `almanacRemove("名")` 指令 + `promptRules.ALMANAC_MAINTAIN_RULE`（拼在杂项阶段 systemPrompt·**不新增 API 调用**）+ `systems/promptInjections.ts` → `buildAlmanacLines`（临近 7 天并进 `<当前时空>` 尾部·**空则整段不出、零 token**）。UI：`MiscPanel` 的「历」tab（增删改·`AlmanacEditModal`）+ 楼层信息条「历」段七天格。⚠ 只存 (月,日)，年份在扮演里无意义；异界写法存 `displayDate` |
| 楼层信息条（正文末尾扁条·状态贴脸） | `components/StoryStrip.tsx`（**零 props + memo**：App 打字/流式重渲一律跳过，只跟自己订阅的 store 走——⚠**绝不要给它加 props**）+ `systems/storyStrip.ts`（取数纯函数）+ `settingsStore.storyStrip{on,quest,thread,time}`（merge 有子对象回填）+ SettingsPanel 外观页「楼层信息条」区块。挂载点在 App 聊天滚动容器内、`visibleMsgs.map` 之后（`messages.length>0` 才挂）。纯只读：不调 API、不写 store、不注入 AI |
| **设施→正文统一接入口**（新设施接通报照这走） | `systems/facilityBridge.ts` → `reportFacilityOutcome({source,summary,granted,growth,guard})`：一次扇出 场外通报(pushSceneNotice)+发放登记(pushFacilityGranted)+成长交代(pushGrowthNotice)，守卫语统一。已接：赌坊(扭蛋批量`CasinoGacha`/魂赌`casinoSoul`/称号`casinoHonors`)、深渊(`abyssStore` 结算×3+觉醒+成就·五阶前称幽冥)、竞技场(`grantArenaReward`)、体系(`loadoutStore` apply/unapply)、私信交易(`dmTrade`)、交易行(`tradeClient` 上架/归还/成交双侧)、账户仓库(`AccountVaultPanel` 存/取/批量)、创意工坊(`workshop.installFromBackend`·仅进度类)、联机讨伐(`applyRaidReward`)、丰碑(召唤/遣散)、欢愉宫(**opt-in** `joyStore.leaveGirl`·`settings.narrativeSync` 默认关·JoyPanel 顶栏勾选)。NPC 私聊落痕另走 `NpcChatPanel` 卸载钩子→`appendDeed`（只记事实不摘内容） |
| 公会 perks 机械效果（guildPerkValue 消费点） | `App.tsx` → `rollAndApplyGemDrops`（`dropRate` 加成掉率 + 击杀强敌必记贡献·不再挂在掉宝后）/ 结算综合评级建议（`settlement` perk ×7 档换算）；数值表在 `multiplayer-worker/src/GuildDO.js` `PERK_TABLE` |
| 🤖 Agent 正文模式（工具循环产稿·仿 TauriTavern·独立旁路+独立API） | `systems/agent/`（`agentRuntime.ts` 循环+persist晋升+指引drain+评稿拦截`runReviewerOnce` / `agentTools.ts` 18工具 / `agentProtocol.ts` 双协议编解码+流式草稿抽取`extractNarrativePreview` / `agentWorkspace.ts` 虚拟FS+read-before-edit / `agentPrompt.ts` 拼系统提示词+指引/纠偏模板）；切口 `App.tsx`→`callApi` 内 `_agentCfg` 分支（onPreview 草稿楼层+0commit撤楼+reviewChain）；中途指引拦截 `App.tsx`→`sendMessage` 顶部（忙碌门之前）；开关钮 `ChatComposer.tsx`→`AgentModeToggle`（运行中发送钮=🎯提交指引）；时间线 `components/AgentTimeline.tsx`；journal+persist记忆+指引队列 `store/agentRunStore.ts`(`drpg-agentrun`·`persistFiles`/`submitGuidance`/`drainGuidance`)；配置档案 `settingsStore.agentProfiles`+`save/apply/deleteAgentProfile`；`db_query` 底层 `systems/tableSqlite.ts`→`agentSqlQuery`/`listSqliteTables`；洞察归档 `turnInsightStore.TurnSnapshot.agentRun`；设置 `SettingsPanel`→`AgentNarrativeSection`（`agentNarrative`/`agentApi`·featureKey='agent'/'agentReview'）；**Agent 专属预设** `SettingsPanel`→`AgentPresetSection`（正文生成第4页签·`agentNarrative.presetName`·`settingsStore.resolveAgentPreset` 玩家版优先·callApi 组装前整链换用·内置两枚 agent-huyu/agent-fairy.json 走 copyBuiltinPresets+seeds 补种）；⚠`parseSTPreset` 忠实 ST 语义只能 **opt-in**（第4参·仅内置 Agent 预设补种用；默认只留「多 order 优先 100001」——08-02 默认忠实化崩过玩家预设已回退，勿再改，守卫 `agentPresetEmbed.test.ts`）；**P3 子代理+技能包**：`store/agentSkillStore.ts`(`drpg-agentskills`·skills/subagents/writerNotes)+`systems/agent/agentAssets.ts`(extensions.tauritavern 导入·App 种子 flag `zs-agent-assets-v1`+importTextPreset 钩子)+`systems/agent/miniZip.ts`(零依赖 zip 解包)；工具 `skill_list/search/read`+`agent_list/delegate(同步·运行时接管)/await(桩)`+子代理侧 `task_return`；子代理循环在 `agentRuntime.ts`（共享父工作区·独立路由 `agentSub-<id>`·未知工具软回喂）；UI 在 `AgentPresetSection` 下方子代理/技能区；提示词 `AGENT_NARRATIVE_CONTRACT_RULE`/`AGENT_FLOW_RULE`/`AGENT_REVIEWER_RULE`；攻略 `docs/AGENT_MODE_GUIDE.md`；设计 `docs/AGENT_MODE_PLAN.md` |
| 🧊 世界作用域（离世冻结/再入解冻） | `systems/worldScope.ts`（`isHomeWorld` **单一真相在此**·playerVitals 只 re-export；`freezeWorld`/`thawWorld`/`reconcileWorldScope`/`activeNpcs`/`frozenNpcsByWorld`）；字段 `NpcRecord.worldName/frozenAt`（⚠ 与 `archived` 正交·`frozenAt ⟹ !onScene`）；挂载点 `App.tsx`→`enterWorld`(切世界冻/继承才解冻)+`reconcileWorldScope()`(每回合兜底·紧跟 `reconcileHomeWorld`)；消费侧 `computeFocusList`+`npcAutonomy.eligible` 跳过冻结。设计见 `docs/WORLD_ENGINE_LUNHUI_ADAPT.md` |
| ⚖ 因果权重（群体 vs 超凡个体） | `systems/causalWeight.ts`（`R = POWER_PER_TIER ^ 阶差`·四档 dominate/tactics_needed/crowd_valid/**outmatched**·`worldPowerReport` 群体基准取世界阶、巅峰另取 `peakPower` 扫最高阶名）；提示词 `CAUSAL_WEIGHT_RULE`；注入 `App.tsx`→`causalWeightInjection()`（NPC 演化 + 杂项演化） |
| ⏸ 驱动力闸门 / 静滞判定 | `systems/npcDrive.ts`（`driveOf` 按 npcTag 分流：在场>羁绊>任务>局势>社交；三无=静滞不花 API，**仍走轨道A**）；接线 `App.tsx`→`buildDriveCtx()`+`computeFocusList` 的 offCands 过滤 |
| 🔮 命运罗盘（占卜池·打破模式坍缩） | `systems/divination.ts`（易经64卦+大/小阿卡那·`drawDivination`/`divinationSeed` 绑「世界+事件」不绑回合·`buildDivinationInjection`）。⚠ **只进演化阶段永不进正文**（赛博/西幻跳卦象破沉浸）；封词兜底 `hasDivinationLeak`/`scrubDivination`（同 scrubAbyss 思路·杂项演化落库后清洗 worldEvents）；注入 `App.tsx`→`divinationInjection()` |
| 🧭 演化守卫 P0（借鉴 world-backstage） | `systems/evoGuard.ts`：①世界纪元 `bump/current/evoEpochStale`（只管不 reload 的 `enterWorld` 切世界；回退/读档走 reload 天然杀在途）②一致性哨兵 `reportConsistency(kind,detail)`→`turnInsightStore.consistency`（≤60滚动·只记不拦）③世界钟只进不退 `parseWorldTime/compareWorldTimes/guardTimeAdvance`（年/月日/第N日/钟点·认不出=放行）。接线：`miscParser` timeLocation 写入过闸（本块切世界或在乐园则跳）；`App.tsx`→`runPostNarrativePhases` 捕获 epoch+stale 阶段跳过+收尾对账 stale 不跑、`awaitPhaseBarrier`（**发送前一致性屏障**·sendMessage 在 captureUndoPoint 前 await·10s 超时放行）、`enterWorld` 开头 bump+`abortAllApiCalls`；`phasePipeline.ts` 新增 `Phase.barrier`+`handle.barrierReady`（barrier 阶段=item/player/audit/npc/pet/faction/misc/quest）；提示词 `promptRules.TIME_ANCHOR_RULE`（杂项阶段注入·锚点+增量·只进不退）；UI `TurnInsightPanel`→`ConsistencySection`（默认收起） |
| 💰 经济气候（相位/大宗/物价系数） | `systems/economy.ts`（`stepIndex` **价格公式前端算死**·单次±30%封顶·指数夹20~500／`priceFactor` ⚠**乘**在既有公允价阶梯上不替换·夹[0.6,1.8]／`seedEconomy` 按世界卡描述零API播种）；数据 `miscStore.economy`（world 作用域）；指令 `setEconomy({...})`；消费方 `App.genShopItems`；提示词 `ECONOMY_RULE` |
| 🕰 时代演化（宇宙层慢变量） | `systems/eraModel.ts`（`netIntervention` 高±2/中±1/低±0.5 → `verdictOf` 定鼎·归墟·派生／`stepProgress` **单向不可回退**／`needsCriticalEvent` ≥80%派生临界事件／`planMerges`+`applyMerge` 保守合并需≥2公共词）；数据 `cosmosStore.eras`（**宇宙层**·任务世界跑不动这套慢变量）；接线 `App.applyEraUpdates`（万族演化 JSON 的 `eras` 字段）；提示词 `ERA_EVOLUTION_RULE` |
| 📒 账本三护栏（不移植整套记账） | `systems/ledgerCheck.ts`（`settlementDue` 周期门禁·⚠个人钱包变动不算重大事件／`checkClosure`+`checkAll` 四点闭环 Pass-Fail·任一Fail不给净值／`checkRecurringIncome` **「正文未写成交≠无收入」**）；`LEDGER_GUARD_HINT` 供产业/领地阶段拼接 |
| 👥 社交圈（关系图谱派生层·非新 store） | `systems/socialCircle.ts`（`detectCircles` 确定性标签传播·零API零存档／`canKnowAbout` **信息传播判定**：不同圈≤2跳·同圈≤3跳·超出即拒＝可判定防超距／`relevantCircles` 关键词命中近期文本才注入）；⚠ 好感虚拟边不算同圈（那是主角私人关系）；⚠ 同圈也必须受跳数约束——长链会被并成一个大圈，无条件放行会让防超距失效 |
| 🏅 乐园声望（跨世界名号·纯派生） | `systems/paradiseFame.ts`（`paradiseFame()` 聚合竞技场/烙印/深渊/团阶/公会/历次通关评级→七档；`contractorBaseline()` 契约者初始 trust/respect；`isRenowned()` 第5档起他人听说过你）。**零 store／零存档改动**，每次现算；注入 `buildFameInjection()`。⚠ 只作用于契约者——土著对乐园声望一无所知 |
| ⚖ 四维声誉（本世界公共名声） | `systems/reputation.ts`（官方/民间/暗域/业界各6级·`applyRepute` 三护栏：**可见性闸门整批拒绝**／最多3维／一次一档；`dimForObserver` 不同圈子读不同维度；`checkCombos` 复合效应）；存 `playerStore.profile.repute`（**world 作用域**）；指令 `repute("维度","档名或±N","可见性依据")` 在 `systems/statusCommands.ts`；离世折算进 `继承要点.主角名声`（App.enterWorld）+ 回乐园兜底重置（playerVitals.reconcileHomeWorld）；提示词 `REPUTATION_RULE` |
| 🤝 势力外交八级 + 事件链闸门 | `systems/diplomacy.ts`（`canTransition` **跨≥2档必须有已完结事件链否则回落渐变1档**·例外直降只对降级有效；`CHAIN_TEMPLATES` **3阶段**版联姻/贸易/停战/宣战/背刺；`intervene` 玩家杠杆调解/挑拨/代行；`forceSettle` 离世按完成比例强制判定；`parseLegacyRelations` 老档自由文本迁移）；闸门挂在 `App.tsx`→`applyFactionShortCommands` 的 relations 分支（顺带修"AI只写两条其余被抹掉"）；注入 `buildDiplomacyInjection`；提示词 `DIPLOMACY_RULE` |
| 🧠 NPC 三层记忆 + 衰退 | `systems/memoryTiers.ts`（近期8→沉淀8→核心5；`planDecay` **前端机械算谁该动**·AI 只压文字；`reinterpretDirection` 四轴净变≥15 触发旧记忆重解读；`usesTieredMemory` **仅 paradise 作用域NPC**）；`characterStore.CharMemory.core?` 新增可选层（老档=空）；⚠ `buildMemoryInjection` **只给核心+最近3条**，沉淀层只在演化阶段用 |
| 🌍 世界事件生命周期（脉络/结算/派生） | `systems/worldEvent.ts`（`overflowIds` **背景≤3/区域≤3 分别计**／`latestChain` 老条目回退 desc／`pendingDerivations`+`buildDerivationInjection` 派生支线钩子／`serializeEventsForEvo(list, worldTime?)` 脉络只取近3节+可见性/⏰到期标注）；字段扩展在 `miscStore.WorldEvent`（`chain`/`settleCond`/`outcome`/`derivedAt`·全可选）；store `appendEventChain`(只追加)/`settleWorldEvent`(结算陈述并入脉络·**非hidden自动建 reveal 待显露**)/`markEventDerived`；指令 `newEvent/eventChain/settleEvent/setEvent/eventRevealed`；提示词 `WORLD_EVENT_LIFECYCLE_RULE`+`WORLD_EVENT_VISIBILITY_RULE`；维护 `App.tsx`→`reconcileWorldEvents()`(超配额标湮灭·**不物理删**)；派生钩子注入**任务演化阶段**(不绕过任务闸门)。⚠ **刻意不碰 worldSource**——那是 AI 每回合绝对赋值的单一权威口径，前端 += 会被覆盖 |
| 🌍 世界见闻 P2（任务世界的新闻/论坛·借鉴世界背面舆情层） | `systems/worldNews.ts`（`buildNewsCandidates` 候选=known/direct事件+trace表象+传闻told·**hidden连候选都进不来**·`parseNewsReply` 归一夹取——trace ref 的"新闻"硬降论坛+unofficial+claim≥mixed·news/forum各≤4）+`store/worldNewsStore.ts`(`drpg-worldnews`·快照≤8·带worldName读时过滤·进度类已注册saveManager)+提示词 `WORLD_NEWS_RULE`；调用 `App.refreshWorldNews`（featureKey='worldNews'·回退正文API·候选空不白花钱）；UI `ChannelPanel` 特殊页签 `'worldnews'`→`WorldNewsView`（模块级组件·手动刷新·⚙内嵌ApiRoutePicker·claim三档徽章·官方/小道chip·回帖`<details>`·≥6回合提示过期·每条「📣 让主角看到」=pushSceneNotice 走场外通报进下一回合正文）。⚠只读氛围层：绝不写回世界事实/认知/正文因果 |
| 👁 NPC 即时观测「看看TA」P2（借鉴世界背面） | `systems/npcObserve.ts`（`eventsKnownTo` **P1 knownBy 认知边界的第一个消费点**：公开事件全给·hidden/trace 只有点名知情才给；`buildObservePrompt` 第一人称即时片段·土著加"不知轮回乐园"铁则·镜头不切主角；`observeContaminated` 污染检测——混入 <state>/结构模块拒收不缓存）；调用 `App.observeNpc`（state `npcObservingId`+`npcObservations` 仅会话缓存·纯观看不落盘），API 走 `npcChatCompletion(sys,user,'observe')`→featureKey='npcObserve' 回退 NPC 演化接口；UI `NpcDetail` 头部「👁 看看TA」按钮（**仅 !onScene && !isDead**·在场的人正文自己会写）+观测浮层（obsOpen·再看一眼），props 经 NpcPanel 穿线（onObserve/observingId/observations·NPC与宠物面板都接）；💭**心声 innerVoice**（P2.5）：字段 `NpcRecord.innerVoice/innerVoiceAt`·NPC演化顺手维护（`NPC_INNER_VOICE_RULE` 已注册预设中心·指令 `character.<id>.innerVoice` 解析在 `applyNpcShortCommands` review 旁·截120字）·仅 NpcDetail 头部下方幕后条显示（`!effPreview&&!editing`）·观测提示词带上一条心声保口吻连续·**绝不注入正文**（结构化召回是白名单字段制，天然不漏） |
| 🫥 事件可见性/暗流到期/显露递交 P1（借鉴 world-backstage） | 全在 `systems/worldEvent.ts`：①可见性 `visibility` hidden/trace/known/direct（缺省known＝老档不变）+`publicTrace` 表象+`knownBy` 秘闻名单——`narrativeEventView` 是唯一正文视图门（hidden→null·trace只给表象**连事件名都不给**·秘闻附知情边界），消费在 `promptInjections.buildWorldTimeInjection`（先过门再取近3条·hidden不占名额）与 `buildActiveEventInjection`；②暗流到期 `due`（世界时间串）+`isEventDue`（parseGameMinutes 比对·解析不出=不催）→演化序列化标 ⏰逼当轮 settleEvent 或展期；③显露递交 `reveal{state:pending/delivered/shelved,attempts}`——`buildRevealInjection`「镜头外已落幕」块（≤2条·情境合适才带出），回合末 `App.runPostNarrativePhases` 同步段 `planRevealReconcile`（`revealAcked`=事件名整体或表象任意连续6字窗命中；没接住 attempts+1；**满3次且非direct→shelved**·direct永不过期），AI 侧 `eventRevealed("W_x")` 兜底；UI 徽章 `MiscPanel` events 页（`VIS_META` 四档+⏰/⏳+📬🔔🗄）。⚠面板是玩家上帝视角照常全显示，可见性只管正文注入 |
| 📢 传闻流变（真相/流传/偏差三分） | `systems/rumor.ts`（`isDue` 时效闸门·解析不出回落 8 回合兜底／`compressRumor` 阈值3／`pruneRumors` 上限5／`shouldPromote` 文化烙印升格／`seedRumorsFromWorldCard` 从 plotDrift+priorLegacy **零API播种**）；数据 `miscStore.rumors`（哑 reducer·`appendRumorNode` **只 append 新 seq**）；指令 `miscParser` 的 `addRumor/rumonNode/setRumor/deleteRumor`（domain:'world'）；提示词 `RUMOR_EVOLUTION_RULE`；机械维护 `App.tsx`→`reconcileRumors()`（杂项演化后）；⚠ **正文注入 `buildRumorInjection` 只给 told、绝不给 truth/drift**（有单测守卫），门槛=影响力≥局部焦点 |
| 🚪 角色动向提示（谁可能回来/谁刚走） | `systems/castHint.ts`（`decideCastHint` 确定性 12% 概率·理由语料**按 npcTag 分流**土著只能写世界内生活理由；`buildCastHintInjection` 排注入链最末）；字段 `NpcAuto.readyToEnter/enterReason/exitReason`；置位在 `npcAutonomy.runNpcAutonomy` 末尾(对全部 eligible 每轮重算)+`applyEntryResult` 的 exits 循环(`pickExitReason`) |
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

**杂项 / 任务 / 记忆压缩**：`runMiscEvolutionPhase`（总结/双时间/天气/大事，任务已拆出）；`runQuestEvolutionPhase`（任务演化独立阶段·紧邻其前）；`runMemoryCompressionPhase` (~2650)

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
| `chronicle.ts` | 编年史史料聚合（📜传奇模式）。`buildVolumes`(把纪要表/世界记录/deedLog/归档任务投影成**卷→页→注**三层)、`classifyText`(金银灰三级重要性·确定性关键词表·不花API)、`volumeIdForRow`(分卷:turn 落区间→世界名→散佚卷三级降级)、`extractEntities`(实体互链)、`digestVolume`/`overallDigest`(切入点·本卷之最)、`buildCompileInput`+`sanitizeCompiled`(修史输入/产出夹取)。**只读投影不写 store**，全部数据源以参数传入便于单测 |
| `theaterTemplates.ts` | 🎭 小剧场花样模板（可单测）。`BUILTIN_TEMPLATES`(15 条·每条=花样名 + **一句具体写法指导**，比原先只有风格词更能指挥模型)、`buildBuiltinTemplates`、`pickTemplates`(只从启用的抽·不重复·**全禁用/空→回退内置全集**，rand 可注入便于单测)、`buildTheaterStyleBlock`(注入块·声明优先于上面任何风格清单) |
| `proposalCard.ts` | 提案卡协议（可单测）。`parseProposals`(从 AI 回复剥 `<proposal kind="quest\|thread\|almanac" ref="可选id">{JSON}</proposal>`·走 lenientJsonParse·认不出的整块丢弃)、`stripProposalsForApi`(**历史消息喂回 AI 前必调**·卡片换占位符，否则模型照抄自己上一轮的旧卡片)、`applyProposal`(**唯一写库入口**·只应由玩家点击触发·复用各 store 既有 action)、`proposalLines`(卡面字段行)、`buildAdvisorContext`(存档现状清单·逐条带 id 供 `ref` 精确引用) |
| `calendar.ts` | 世界历纯逻辑（可单测）。`extractMonthDay`(**从 `miscStore.worldTime` 正则抠「今天」·零 API**——参考插件要额外调一次 AI 猜日期，本项目双时间本就每回合维护，抠不出就返回 null 走降级)、`dayOfYear`/`monthDayFromDoy`(月日↔年内序号·固定含闰日共 366·只为可比较可环绕，不代表世界用公历)、`itemCoversDoy`(多日节日跨年环绕)、`daysFrom`(未来七天格)、`upcoming`(窗口内到期+长假进行中记 0)、`visibleIn`(本世界专属+跨世界)、`dateLabel`/`sortByDate`/`TYPE_META` |
| `storyStrip.ts` | 楼层信息条取数层（纯转换·可单测）。`pickThreads`(伏笔表 content→未回收线头；剔除已回收/已废弃，账龄口径**直接复用** `plotThreads.collectStaleThreads`——条上标⚠的正是本回合注入 AI 的催收清单；催收项置顶、其余保持表内顺序)、`pickQuests`(miscStore.tasks→进行中任务；主线置顶，当前环优先按 `currentRing` 对齐 idx、否则取第一个 `status==='active'`)、`weatherGlyph`(自由中文天气串→emoji·包含匹配+占位兜底)。**零 API、零新增 store**，只把既有数据变现 |
| `equipCraft.ts` | 装备工艺确定性引擎（与强化的赌等级**正交**：强化赌等级、工艺改词条）。`potentialMax`/`potentialLeft`(锻造潜力·随品级递增·耗尽封盘·品级进阶会抬高上限)、`canCraft`(门禁)、`resolveCraft`(摇结果+拍板全部数值·rand 可注入便于单测)、`craftPatch`(落库补丁)、`craftCost`/`planCraftPayment`(锚 gradeMidPark)、`sanitizeProcess`+`riskPricing`(**自创工艺平衡阀**：参数夹取＋净得利越高自动越贵)、`BUILTIN_PROCESSES`(潜能锻打/精髓灌注/虚空腐蚀)、`isPreviewMode`(单结果=确定性走预览确认·多结果=赌博即时结算)、精髓 `affixName`/`canInfuse` |
| `diceJudge.ts` | AI 裁判：`aiJudge`、`aiSuggest`(✨建议属性难度)、`buildJudgeBlock` |
| `imageGen.ts` | `generateImage(service,opts)`(NAI ZIP解码/OpenAI/Comfy轮询/`genChatImg` 多模态Chat出图·`opts.refImages` 参考图仅 chatimg 线用)、`buildPortraitPrompt`/`buildEquipPrompt`、`shrinkDataUrl` |
| `comic.ts` / `comicDb.ts` | 漫画工坊：`generateComic`(楼层→`toProse`清洗+角色roster→分镜JSON `zs_comic_v1`→并发错峰绘画·单页失败不拖累·成功页即落库)、`retryMissingPages`/`redrawPage`(复用存储的 finalPrompt)、`parseComicPlan`(lenientJsonParse+夹取)；comicDb=IndexedDB `drpg-comics`(batches+pages·库房性质·不进存档快照) |
| `imageTags.ts` | 列19 danbooru tags：`genPortraitTags`/`genEquipTags`、`tagsLlmReady`/`isTagService` |
| `imageDb.ts` / `imageSync.ts` | 图片存 IndexedDB `drpg-images`：`putImg`/`getAllImg`/`bulkPutImg`/`clearAllImg`；`imageSync` 订阅 store 镜像 + `hydrateImages`/`snapshotImages` |
| `novelVec.ts` | 向量资料库运行时：`loadNovelIndex`/`retrieveNovel`/`searchAll`/`embedQuery`/`novelVecStatus`（多源 novel+worldbook，IndexedDB `drpg-novelvec` v2） |
| `narrativeMemory.ts` | 关键词召回：`tokenize`/`recallFacts`/`buildNarrativeHistory`；提示词 `NM_COMPILE_PROMPT`/`NM_INGEST_PROMPT` |
| `structuredRecall.ts` | 结构化档案召回：序列化主角/NPC/势力卡（`serializePlayerCard` 等），供 `buildStructuredRecall` |
| `setBonus.ts` | **套装加成单一口径**（宝石套装 `gemSets` + 锻造套装 `equipSets` 的"取两边+合并"）：`setAttrEntries`(六维→合成装备条目)/`setPassive`(战斗被动)/`setDetailLines`(逐套详情行)。**消费方一律走这里**——PlayerSidebar / combatEngine.buildCombatant / structuredRecall / NpcDetail；各写各的时代漏抄过两次（正文注入漏六维+详情、NpcDetail 漏六维） |
| `relationGraph.ts` | 🕸 关系图谱数据层（纯函数·`relationGraph.test.ts` 17 例）：`buildRelationGraph`(解析列13扁平串·C编号与姓名两种写法都认·认不出留 ghost 节点·`|好感|≥60` 连虚拟边)/`egoSubgraph`(N跳邻域·保留入选点彼此的边)/`layoutRelationGraph`(确定性 Fruchterman-Reingold·种子来自节点id集合→两次打开不跳位·`centerId` 钉中心)/`classifyRelation`(关键词归六类·顺序即优先级)/`tierColor` |
| `npcLifeStory.ts` | 📖 成长小传手动补写/重写：`generateLifeStory`(走 `resolveApiChain('npc')`)/`extractLifeStory`(取 `<小传>` 块·AI 没包块时退回裸文本) |
| `miscParser.ts` | 杂项指令：`applyMiscCommands`(总结/双时间/天气/世界大事/`T_`任务)、`extractTurnSummaries` |
| `gameClock.ts` | 游戏时间：`parseGameMinutes`/`parseDurationMinutes`/`parseDurationTurns`/`fmtMinutes` |
| `equipSlots.ts` | `SLOT_DEFS`、`normalizeEquipSlot`/`pickEquipSlot`/`resolveEquipSlot`/`slotAcceptsCategory` |
| `dispatchEngine.ts` | 派遣引擎（零 token）：`rollOfferBoard`(语料库播种造委托·阶梯难度)/`estimateDispatch`(战力·原型匹配·疲劳·**队内宿敌盟友**·团阶 → 0~100 分+逐项拆解)/`settleDispatch`(**纯函数**·评级 E~SSS·伤亡/疲劳/战利品/货币)/`runDispatchTick`(每回合心跳·**到点才封存账本**)/`ensureBoard`/`launchDispatch`/`memberBlockReason`。⚠ 货币按阶位门槛（≤三阶乐园币 / ≥四阶魂币）；战利品与陨落复用轨道A 的 `autoGearFull` 上限与 `npcAutonomyDeath` 开关，不另开后门 |
| `dispatchReport.ts` | 派遣战报：`generateDispatchReport`(仅对**已封存**记录有效)/`buildLedgerBrief`/`fallbackReport`。走 `resolveApiChain('dispatch')`，一次派遣一次调用（不是每回合阶段） |
| `dispatchGen.ts` | 委托板 AI 生成（**手动·唯一触发点是面板按钮**）：`generateDispatchBoard(turn)` 读主角+团+每个成员档案出委托，每条带一件**字段填满的奖励物品**；`gradeForTier` 按委托阶位定奖励品级（吃世界阶上限表，前端锁死后喂 AI）。联网＝`dispatchWebSearch` 开时给 `extra:{tools:[{google_search:{}}]}`。⚠ 生成的板 `boardSource='ai'`，`ensureBoard` 见到就让开，**永不自动换批** |
| `dispatchPrompts.ts` | `DISPATCH_GEN_RULE` / `DISPATCH_REPORT_RULE` 两条常量单独成文件——**断环**用（promptRegistry 要 import 它们，dispatchGen/Report 又要 import getPrompt）。照 `abyssPrompts.ts` 的做法 |
| `branchTree.ts` | 分支树纯模型：`splitTurns`(线性对话→回合·按 id 归位)/`attachIndex`(分叉点→挂哪一回合后)/`buildBranchTree`(节点+边+泳道+坐标·长档只画最近 N 回合)/`digest`(剥结算块/HTML/think 的正文摘要)。不碰 store/IDB/React |
| `codexIndex.ts` | 悬浮图鉴词典：`getCodexIndex`(**惰性重建·store 切片引用比对·version 单调自增**)/`scanEntities`(首字快筛+最长匹配+seen 只标首次)/`usableName`(停用词·≥2字·拒 id 形态)/`lookupCodex`(只查不重建)。⚠ 零订阅、位置保持匹配（不做 normName 归一） |
| `lunhuiChars.ts` | 轮回 wiki 人物库加载器（`loadLunhuiCharacters` 模块级缓存·2.2MB 只拉一次）+ `parseLunhuiChar`(前言区/首段/别名)/`stripMd`。小剧场取材与悬浮图鉴 wiki 层共用 |
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

`NPC_SELF_NARRATION_RULE`/`NPC_LIFE_STORY_RULE`(门控生成一次·前者第一人称自述、后者成长小传；均已进预设中心可玩家改) · `NARRATIVE_FIRST_RULE`(逐条参照正文) · `BUFF_AS_STATUS_RULE` · `SUBPROF_RULE` · `NPC_AGE_RULE` · `FACTION_WORLD_RULE` / `FACTION_FULL_FORMAT_RULE` / `FACTION_HOME_EXIT_RULE` · `ITEM_FIXED_FORMAT_RULE` / `ITEM_EXACT_REF_RULE` · `EVO_EXACT_REF_RULE` · `TALENT_NO_CAP_RULE` · `SKILL_TIER_RULE` · `IMAGE_TAGS_RULE` · `MISC_HOME_TIME_RULE` · `CHANNEL_AUTHOR_INFO_RULE` · `MERGED_AUDIT_SYSTEM`/`MERGED_AUDIT_PROMPT`
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
| `adventureTeamStore.ts` | `drpg-team` | 冒险团（数据+设置+API 合一）。注意成员是 `upsertMember` 不是 addTeamMember。**派遣**也住这里：`dispatchBoard`/`dispatchActive`/`dispatchHistory`/`fatigue`/`injury` + `dispatchApi`/`dispatchReportAuto`；⚠ 全是哑 reducer，算账在 `systems/dispatchEngine.ts`（这样 `npcAutonomy` 能 import 本 store 做分流过滤而不成环） |
| `territoryStore.ts` | `drpg-territory` | 领地（数据+设置+API 合一）|
| `cosmosStore.ts` | `drpg-cosmos` | 万族演化 |
| `characterStore.ts` | `drpg-characters` | 技能/天赋/称号/副职业/记忆（B1+Cx 共用）。`mergeKeepRich`(空字段保旧)、`nameEq`(归一化匹配)、`SKILL_TIER_*`/`normSkillTier`、`removeCharacter`/`purgeNpcCharacters` |
| `memoryStore.ts` | `drpg-memory` | 生平压缩设置+提示词+API |

## §酒馆美化适配（渲染层 2026-08-07，详见 FEATURES 同名节）
| 位置 | 内容 |
| --- | --- |
| `systems/htmlSanitize.ts` | `sanitizeHtmlBlock`(DOMPurify 白名单+外链媒体 hook) / `extractStyleBlocks` / `renderScopedStyles` / `scopeCss`(手写 CSS 作用域化·body/:root→容器) / `extractHtmlFences`(```html 围栏→前端卡) |
| `systems/narrativeHtml.ts` | `toHtml`：style 抽取→`wrapSettlementBlocks`(HTML 块按深度整块吃+消毒·块内 \n 拼接)→作用域化还原；`toHtmlWithImagesCached` 签名含 extTok（⚠sig 分隔符是 \x01 控制字符，肉眼不可见） |
| `systems/stateApply.ts` | `splitThinkStream`(流式思维链二分) / `extractLeakedThinking`(结算抽取·严格镜像 stripLeakedThinking 口径) / `streamVisibleNarrative`(旧接口=只取 visible) |
| `components/CustomCssStyle.tsx` | 全局自定义 CSS 注入器：自订阅 `customCss`，维护 `#drpg-custom-css`；scope=chat 过 scopeCss('#chat')；App 主返回+设置早退分支都挂（CodexHover 同款教训） |
| `components/HtmlSandbox.tsx` | 前端卡 sandbox iframe（模块级 memo·postMessage 高度自适应·allow-scripts 无 same-origin） |
| `App.tsx` | `ChatMessage.think`；MessageRow：`.mes/.mes_block/.mes_text/.last_mes/is_user` 别名 + `mes_reasoning_*` 折叠块 + fenceSplit(useMemo)；流式 `flushStreamUi` 按 `thinkDisplay` 分流；两处结算点抓 `leakedThink`；消息滚动容器 `id="chat"` |
| `store/settingsStore.ts` | 新字段 `thinkDisplay` / `htmlExternalMedia` / `customCss` / `renderHtmlSandbox`（+setters） |
| `index.css` | `:root` 里 `--SmartTheme*`→`--c-*` 映射；`.mes_reasoning_*` 默认样式（尾部） |
| `SettingsPanel.tsx` | TextApiSection：思维链显示三态（隐藏/折叠/展开）；外观区顶部：自定义 CSS 编辑框+导入 ST 主题 .json/.css+外链媒体开关+前端卡开关 |
| `miscStore.ts` | `drpg-misc` | 杂项(任务数据/总结/`narrativeFacts`/双时间/天气)+预设+API；另挂任务演化的 `settings.questEnabled`+`questApi`/`questUseSharedApi`（独立阶段，merge 迁移旧档继承 enabled）。`addNarrativeFacts` |
| `dbAdvanceStore.ts` | `drpg-dbadvance` | 数据库推进(Stitches 规划层)：**一键两域**——预设/`enabled`/`useRecall`=全局配置(读档不回滚)；`lastTabletop`({{tabletop}} 桌面态)/`lastStage`/`lastScene`/`lastRecall`=本时间线运行态，**随存档快照 + 读档/回退一起回滚**(规则 `systems/dbAdvanceRuntime.ts`·2026-08-07 修「回档后推进还记着之前内容」)。新游戏由 clearProgress 显式 `clearRuntime()`；手动清=设置→数据库推进→🧹清上轮记录 |
| `imageGenStore.ts` | `drpg-image-gen` | 生图服务/用途/模板/自动开关；服务含 `chatimg`(多模态Chat出图·nano-banana系) |
| `comicStore.ts` | `drpg-comic` | 漫画工坊设置（服务/页数/尺寸/语言/参考图/送审软化/错峰间隔）；`useComicJob`=运行时任务进度（不持久化）|
| `channelStore.ts` | `drpg-channel` | 公共频道（数据+设置+API+预设）|
| `dmStore.ts` | `drpg-dm` | 私信线程/消息/交易卡 |
| `turnInsightStore.ts` | `drpg-turn-insight` | 回合洞察快照（滚动14份）+ 🧭一致性哨兵 `consistency`（≤60滚动·`logConsistency`·evoGuard 上报）|
| `worldNewsStore.ts` | `drpg-worldnews` | 🌍 世界见闻快照（≤8·带 worldName 读时过滤·进度类随存档/新游戏清空）|
| `creationTemplateStore.ts` | `drpg-creation-templates` | 角色创建模板 |
| `novelVecStore.ts` | `drpg-novelvec` | 向量资料库设置（embedding 接口/topK/阈值/maxChars）|
| `enhanceStore.ts` | `drpg-enhance` | 装备强化：老板名册/率表(配置)、`pity`垫子计数(账号级全局,不进存档/不导出)、`session`本轮日志。立绘 partialize→IndexedDB；`hydrateEnhancePortraits` |
| `rowScopeStore.ts` | `drpg-row-scope` | 表行·世界归属旁路索引：`scopes[`${uid}:${rowId}`] = { world, turn }`。给「AI 原生填写的表」（伏笔表）补世界作用域而**不改表结构**（同 chronicleStore.rowMeta 取舍）。`note`/`noteMany`/`worldOf`/`clearRowScopes`，CAP 4000。⚠ key **必须带表前缀**：row_id 是每张表各自递增的，裸 id 会跨表撞车。⚠ 查不到 ⇒ 当「不确定」保留，绝不误藏 |
| `theaterStore.ts` | `drpg-theater` | 🎭 小剧场花样模板：`templates` + `seeded`(内置只种一次·玩家删掉的不会复活) + `pickCount`(每回合抽几条·1~3)。`ensureSeeded`/`upsert`/`toggle`/`remove`/`restoreBuiltins`/`setAllEnabled`/`setPickCount`。CAP 60。**配置类**——进 STORES 但**不给 clear**（新游戏保留），并进 `configExport` |
| `bookmarkStore.ts` | `drpg-bookmarks` | ⭐ 坐标（收藏楼层）：`marks`(msgId + **text 正文快照** + note/tags/turn/worldName/worldTime/ts)。`add`(同 msgId 幂等·空正文拒收·快照 6000 字截断) / `update`(只改 note/tags·标签去重限 8) / `removeByMsg`(楼上 ⭐ 再点一次) / `remove` / `clear`。CAP 200 新挤旧。走 lzStorage 压缩（正文长）。进度类 → 随存档快照、新游戏清空 |
| `advisorStore.ts` | `drpg-advisor` | 🧭 参谋对话：`msgs`(role/content/ts + `applied[]`＝本条消息里已应用的卡片序号·防重复应用+UI 打✓)。滑窗 40 条。进度类（聊的是本档剧情）→ 随存档快照、新游戏清空 |
| `calendarStore.ts` | `drpg-calendar` | 世界历：`items`(节日/生日/纪念日·只存月日+持续天数+本地写法+归属世界)。`upsert`(面板增改) / `applyMany`(AI `almanac([...])` 批量落库·**同名同世界→更新并保留原 id**) / `removeByName`(AI `almanacRemove`) / `remove` / `clearAll`。CAP 60 条，超出丢最旧。⚠ 离开世界**不自动清**——世界专属条目由 AI 按维护规则移除或玩家手删（与 truths 同策略） |
| `chronicleStore.ts` | `drpg-chronicle` | 编年史：`rowMeta`(纪要行 row_id→{turn,world}·**分卷地基**·由 applyTableEdits 旁路记·上限4000) + `compiled`(AI 修的正史·按 WorldRecord.id)。都是本存档进度，随快照/新游戏清空。⚠ 丰碑(drpg-monument)是账号级、不在此列 |
| `equipCraftStore.ts` | `drpg-equipcraft` | 装备工艺：`settings.processes` 工艺库(内置3+自创)=**配置**(进 configExport/可传工坊/跨新游戏保留)；`essences` 精髓图鉴=**进度**(进 saveManager 快照,新游戏清空,遵守"库房只存不删")。`upsertProcess` 入库必过 `sanitizeProcess`(AI/工坊/手改 localStorage 都夹取)；内置工艺不可被覆盖。API 复用 enhanceApi |
| `skillTreeStore.ts` | `drpg-skilltree` | 职业技能树：`trees`模板库(配置/可分享) + 每角色`progress`(解锁进度/潜能点,随存档)。`unlockNode`(扣潜能点+灌 addSkill/addTrait)、`respec`、`setMaxRankOverride`(每节点可点次数·1=一点点满·调低即削平+退小节点潜能点)、编辑器ops(addNode/addEdge拒环/...)。仅 B1 |
| `variableStore.ts` | — | 自定义变量（`<state>` 兜底查找）|
| `imageViewerStore` / `imageBusyStore` | — | UI 瞬时（看图/生图忙提示）|
| `composerStore` | — | UI 瞬时：`draft`/`fill(text)`，背包「使用」物品把「使用XX」填进主聊天输入框（App 订阅 draft→setInputValue+关背包+聚焦）|

> **所有 `drpg-*` 持久化，刷新不清是存档机制**。彻底重置=清 `drpg-` 开头 localStorage。图片大、存 IndexedDB `drpg-images`（不进 localStorage）。

---

## 6. components/（按用途）

**外壳/正文**：`StartScreen`(封面热区) · `CharacterCreation`(开局) · `SettingsPanel`(设置大路由) · `VariableManager`(演化功能中心启动台) · `StatusBar`(顶部双时间/天气) · `ErrorBoundary` · `Bar` · `VersionToast` · `ImageBusyToast` · `ImageViewer` · `CodexHover`(正文名词悬浮卡·document 委托·零 store 订阅；⚠**主返回与设置页早退各挂一份**，二者互斥不会同时出现) · `StoryStrip`(正文末尾楼层信息条：时间·天气/任务/伏笔/历 四段·点开就地展开；⚠**零 props + memo**，勿加 props)

**主角侧**：`PlayerSidebar`(身份档案/六维/状态，点击即编辑) · `PlayerEquipPanel`(左浮窗装备) · `CharacterPanel`(✨技能/天赋，仅B*) · `TitlePanel`(🎖称号) · `AchievementPanel`(🏆成就) · `SubProfessionPanel`(🛠副职业) · `ItemListPanel`(右下物品栏浮窗) · `StatusEffectChips`/`StatusChips`(状态胶囊) · `CharEditForms`(`SkillEditForm`/`TraitEditForm` 技能·天赋手动编辑表单，主角 CharacterPanel + NPC NpcDetail 共用，写 `characterStore.updateSkill/updateTrait`)

**装备/背包**：`EquipmentPanel`(⚔玩家装备槽) · `BackpackModal`(🎒储存空间，含 `CurrencyConverter` 乐园币↔灵魂钱币 1:15万) · `NpcEquip`(NPC装备)；三者装备卡均显 `+N` 强化角标

**NPC**：`NpcPanel`(📇档案列表·头部「🕸 图谱」入口) · `NpcDetail`(单角色11栏，导出 `SegmentedText`/`StatusChips`；关系页顶部嵌 ego 图，经历页含 `LifeStoryBox` 成长小传) · `OnScenePanel`(右上在场浮窗) · `RelationGraph`(🕸 纯SVG关系图·懒加载独立chunk：默认导出=全局弹窗，具名导出 `RelationGraphView`/`RelationEgoGraph`/`RelationLegend`)

**右侧导航面板**：`AdvisorPanel`(🧭参谋·局外顾问+提案卡·点应用才落库) · `BookmarkPanel`(⭐坐标·收藏楼层·存正文快照)+`BookmarkButton`(挂正文右上角·自订阅) · `FactionPanel`(🏛) · `TerritoryPanel`(🏯) · `AdventureTeamPanel`(🛡) · `TurnInsightPanel`(🔍回合洞察) · `MiscPanel`(📋任务) · `SummaryPanel`(🧠记忆) · `CosmosPanel`(🌌) · `ChannelPanel`(📡频道) + `SystemShop`(🏪) · `DmPanel`(✉私信) · `FriendsPanel`(👥好友) · `SaveLoadPanel`(💾存档) · `DicePanel`(🎲in-chat骰子) · `EnhancePanel`(⚒强化所：左看板娘立绘+切换+吐槽气泡/中被强化装备+特效/右选装备+率+花费+日志)

**设置子页（演化管理）**：`ItemManager` · `PlayerManager` · `NpcManager` · `FactionManager` · `TerritoryManager` · `AdventureTeamManager` · `CosmosManager` · `MemoryManager` · `MiscManager` · `QuestManager`(任务演化:启用/任务闸门/正文注入/独立API) · `ChannelManager` · `ImageGenManager` · `NovelVecManager` · `DiceManager` · `EnhanceManager`(装备强化:老板名册/立绘文件夹/率表/API)

**API/其他**：`ApiRoutePicker`(多接口路由配置) · `ApiQuickPick`(旧,未引用) · `WorldSelector`(AI生成乐园) · `Hub`/`InstanceView`(旧副本，大多未用)

---

## 7. 其它

- **数据/工具**：`src/data/{monsters,events,instances,enhancements}.ts`(旧副本数据，多未用)、`src/worldGenPrompt.ts`、`src/types.ts`、`src/version.ts`
- **建库脚本**：`tools/build-novel-vectors.mjs`（`npm run build-vectors` 小说 / `build-vectors-wb` 世界书）
- **强化老板立绘**：源放仓库根 `图片/<老板>/阶段1~4/`(入库)；`vite.config` 插件 `syncEnhanceBosses` build/dev 同步进 `public/enhance-bosses/` + 生成 `manifest.json`(副本 gitignore)
- **Cloudflare 代理**：`functions/proxy/[[path]].js`（同源 CORS 透传，不存 key）
- **预设文件**（仓库根 `预设/*.json` + `src/data/*DefaultPreset.json`）：导入到各演化管理子页
