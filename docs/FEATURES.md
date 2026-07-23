# FEATURES — 功能细节 / 规则 / 历史坑

> 各功能的长篇细节、AI 指令格式、设计决策、踩过的坑。**按需查阅**（用 offset/limit 读对应小节，别整文件读）。
> 概览/构建/架构在 `CLAUDE.md`；代码定位在 `docs/CODE_MAP.md`。
> 轮回乐园术语：阶位/天赋(D-SSS)/战斗属性/进阶点数/乐园币·魂币。改预设须沿用统一映射（境界→阶位、灵根→天赋、灵兽妖兽→召唤物、功法→技能书、词条→天赋、百艺炼丹→副职业…），勿让修仙词回流。

## 目录
1. 正文渲染与数据化风格
2. AI 多阶段流程 + 综合对账 + 阶段编排
3. 状态指令解析（lenientJsonParse / 三件套 / 去重）
4. 物品系统（分类/结构/模板/槽位/定价/货币/删除策略/堆叠）
5. 主角演化系统
6. NPC 演化系统（含关键修复）
7. 势力 / 领地 / 冒险团 / 万族 演化
8. 杂项演化 / 生平压缩
9. 叙事记忆 + 结构化召回 + 向量资料库
10. 中心 API 库 + 多接口路由
11. 生图系统（三条线）
12. 公共频道 / 私信 / 好友
13. 存档 / 封面 / 角色创建
14. 回合洞察 / 自动存档 / 六维代码生成
15. 身份档案字段（生物强度/六维/经历/限时状态/状态胶囊）
16. 技能·天赋·称号固定格式 / 成就 / HP·EP上限
17. 名称模糊匹配 + 照抄铁则
18. 世界书体系 / 预设文件
19. 装备强化系统（仅乐园·+0~16·看板娘分阶段立绘·爆装垫子保底·品级评分缩放·收尾AI刷词缀·货币兑换）

---

## 1. 正文渲染与数据化风格

**`toHtml`（App.tsx）始终走 HTML 感知的 `wrapSettlementBlocks`**：含 HTML 标签的行/未闭合 HTML 块原样透传（ST 正则卡片照常渲染），同一条消息里的 `>` 模块块 / `【…】` 块仍打**琥珀边框格子**。打包规则：① 连续 `>` 引用行整段打包（时间结算/动作日志/击杀/成长/判定/战斗/信息卡/登场离场/任务/资源等）；② 无 `>` 时以 `【…结算/日志/战报/登场/资源/判定…】` 标题兜底。`renderSettleBlock` 拆出 `【标题】`（AI 常把「【动作日志】+整段」写一行）、正文按句末标点 `。；！？` 分行（`space-y-0.5`）。字号：正文 `text-[17px]`、结算格子正文 `text-[15px]`/标题 `text-[13px]`。入口 `dangerouslySetInnerHTML={{__html: toHtml(msg.content)}}`。正文配图见 §11（`toHtmlWithImages`）。

**数据化风格**（参考 `ST_WI_Modular_Output`）：技能/物品/装备/天赋的 effect/描述**必须写具体数值**（+X攻击、+X%暴击、减伤X%、恢复X点、持续/冷却X回合、消耗X）。三预设已把旧「不写数值」禁令翻转为要求 + override（zhushen 无 numeric 战斗引擎，数值只在文本可见）。

## 2. AI 多阶段流程 + 综合对账 + 阶段编排

**阶段**（除主叙事外都在正文完成后**并发**，`runPostNarrativePhases`）：① 主叙事→解析 `<state>`/`<upstore>` ② 物品管理 ③ 主角演化 ④ NPC 演化 ⑤ 生平压缩 ⑥ 杂项 ⑦ 领地 ⑧ 冒险团 ⑨ 万族 ⑩ 势力 ⑪ 叙事记忆回写 ⑫ 生图。物品管理**绝不 await NPC**（早期曾被慢NPC拖死=「物品管理失效」，已解耦）。

**综合对账纠错 `runMergedAuditPhase`**（物品+主角**合并一次**调用）：`Promise.allSettled([itemP, playerP]).then(...)`——两阶段都跑完只调一次 AI，看「应用后真实数据 + 最近两回合正文」逐项纠正遗漏/错误更新。两个 `auditEnabled` 开关（itemStore/playerStore）共用这一次：`checkPlayer`/`checkItems` 控制各段是否纳入，都关则不调。安全网：物品段硬过滤 createItem/货币（仅删/扣/穿脱）；主角段过滤 `charId==='B1'`；**NPC 物品只纠正 `npcTag∈{随从,宠物}`**。`MERGED_AUDIT_SYSTEM`/`MERGED_AUDIT_PROMPT`。

**NPC owner 解析器**（`stateParser.setNpcOwnerResolver`）：物品阶段常给 NPC 物品编幻觉 ID（C66）与登场判断的真实 ID（C1）对不上 → 解析器把未知/空壳 owner 重定向到真实 NPC（优先本回合 `npcPreferredOwners`，退化到最近更新的在场真实 NPC）。登场判断（快）通常先于物品阶段完成，故并发下 ID 仍映射正确。

**`applyAllUpdates` 顺序**：先应用 `<upstore>` 创建物品，再应用 `<state>`（含 `eq` 装备短指令），否则装备指令在物品尚未创建时失败。

## 3. 状态指令解析（`systems/stateParser.ts`）

**`lenientJsonParse`（防"指令解析失败"）**：AI 常把指令写成 JS 字面量——裸键（`{name:"…"}`）、单引号、尾随逗号。逐级放宽：标准 JSON → 给 `{`/`,` 后 ASCII 裸键补引号（正则只碰 ASCII 键，不误伤中文值里全角「：，」）→ 单引号转双引号 → 去尾逗号。所有命令解析器统一用它。

**`<state>` 块**（逐行 `key = / +=` ）：内置玩家 key（hp/maxHp/mp/maxMp/san/maxSan/points/atk/def）；角色资源短指令 `hp.B1 -= 20`/`mp.C1 = 35`（路由玩家/NPC）；货币 `乐园币 += 100`/`currency.魂币 -= 10`；装备 `eq.B1 = weapon:main:I_B1_01|主武器`/`uneq.B1 = …`（物品不在背包时 `equipNpcItemFallback`/`unequipNpcItemFallback` 在 NPC 持有物里就地装卸）；`cr./pr./ca./character.*/npc./loc./tm./ap./rc.` 等前缀按功能解析或静默跳过。其余 key 从 `variableStore` 查。

**`<upstore>` 块**（helper 调用）：物品 `createItem/consumeItem/destroyItem/transferSpiritStones/transferCurrency/equipItem/unequipItem/updateItem/updateItemQuantity/transferItem`；角色（双参 `funcName("charId", payload)`）`addSkill/deSkill/addTalent/deTalent`(别名 addTrait/deTrait)/`addTitle/deTitle/equipTitle`/`addAchievement/deAchievement`(仅B*)/`addSubProfession/deSubProfession/addRecipe/deRecipe`(仅B*)/`addDeed/addMemory`；NPC `add("C1",{列})/de("C1")`；势力 `addFaction/deFaction`。`CHAR_CMD_RE`/`NPC_ADD_RE` 用负向断言 `add(?!Skill|Trait|Talent|Title|Achievement)`、`de(?![A-Za-z])` 防误吞。`CATEGORY_MAP` 归一化物品分类别名。

**技能/天赋"按正文更新+不拥挤"三件套**：① 字段别名——`desc` 接受 `description`、`rarity` 接受 `tier/grade`（否则正文详细效果被丢）；② 同名 upsert 保旧（`characterStore.mergeKeepRich`：新条目空字段保留旧值，防极简重复 add 冲掉详细 desc）；③ 卡片断行（`breakSentences` 按句末标点）。

**物品近似重名去重**：`劣质餐刀` vs `劣质的餐刀` 只差「的」——去重归一化（stackNorm/dedupeByName/npcStackNorm）把 `的/之` 并入剥除标点集，确定性合并。

## 4. 物品系统（`store/itemStore.ts`）

**分类 `ItemCategory`**：装备(武器/防具/饰品)、消耗品/材料(消耗品/材料/工具)、特殊(重要物品/特殊物品/凡物/其他物品)、旧版兼容(功法/法宝/丹药/符箓/灵药/阵具)。`smartFilterEntries()` 用 `KEEP_NAMES` 过滤物品管理条目。

**`InventoryItem`**：id(`I_B1_XX`)/name/category/gradeDesc(品质,第3列)/effect/quantity/equipped/equipSlot/tags/appearance/acquisition/locked/notes + **固定模板**：origin(产地)/subType/combatStat(攻防)/durability/requirement/affix(词缀)/score(评分)/intro(简介)/killCount(仅武器,杀敌数)。NpcOwnedItem 同字段。`createItem` 接受命名键（`quality`→gradeDesc、`attack/defense`→combatStat 别名）。预设 `物品装备固定条目模板`（高优先级,已入 KEEP_NAMES）强制全字段+数值化。⚠ 旧版生成的 NPC 物品没这些字段，需重新生成。

**装备槽位 `equipSlot`**（`components/EquipmentPanel.tsx` / `systems/equipSlots.ts`）：`weapon:main`/`weapon:off1~3`、`armor:head/upper/lower/feet/hands/shoulder/belt`、`accessory:#1~6`、`treasure:#1~5`、`technique:0~N`(技能,无上限,无`#`)。AI `eq.*` 短指令 + `equipItem` upstore（`{owner,slot,weaponHand/armorPart/slotIndex,itemId,reason}`）。旧格式槽名(`weapon:right`)`normalizeSlot` 归一化，无法归类进"其他已装备"。入口：右侧「⚔装备」独立弹窗；「🎒背包」=`BackpackModal`(纯物品视图)。

**评分与定价**（预设 `物品定价核心机制`）：轮回乐园**颜色品质定价**（已替换修仙一品~二十二品+俸禄；俸禄已删）。9 项因素（品质/稀有度/效果强度/潜力/制造代价/需求限制/文化/供需/耐久）。白300-800→绿1.5k-2.5k→蓝3.5k-5.5k→紫8k-35k 乐园币；淡金100k-250k乐园币/50-100魂币；金色数百~数万魂币；暗金战略级(以物换物);永恒/起源/创世 不流通。收入=击杀掉落/系统任务/交易(售价约参考价50-80%)。

**rarityTier 色阶**：ren(白绿,grade0-2)/xuan(蓝紫,3-4)/di(淡金金,5-6)/tian(暗金+,7+)。

**已装备物品删除策略**：`consumeItem` 对 equipped 一律拒绝（消耗品不会穿戴态，多为幻觉）；`destroyItem` 对 equipped **自动先卸下再移除**（销毁=丢弃/卖掉/损毁/被夺走；主角 `unequipItem`+`removeItem`，NPC `removeNpcItem`）。**换装≠销毁**（铁则,物品阶段+对账都注入）：替换装备只对新装备 equipItem，引擎自动把同槽旧装备卸回储存空间，**绝不对换下的旧装备 destroy/consume**。`transferSpiritStones` 曾被当废弃指令忽略（乐园币永不更新），已修，`normalizeCurrencyType` 归一化。

**同名堆叠+防重复（四层）**：① 数据层 `addItem`/`addNpcItem` 对可堆叠类(`isStackableCat`,非装备)未装备同名同品质累加数量；② 每回合 `dedupeByName`/`dedupeNpcItems` 合并；③ 提示词注入 `${player_items}`+`${npc_items}` 要求别重复 createItem；④ 对账合并（注入最近两回合正文，相似名同一物 → destroy 多余，保守/保完整那条）。

**容器/一次性**：预设 `容器开启与一次性消耗强制自检`——开宝箱(destroyItem容器+createItem内容物)/用消耗品即 consumeItem，itemId 找不到用全名兜底（parser `findItemById ?? findItemByName`，根因是 AI 漏输出指令）。**技能书**：`numeric.kind` = skillBook(学技能,consume销毁)/knowledge/schematic/talentFragment。

## 5. 主角演化系统

入口：设置→变量管理→🧬主角演化→`PlayerManager`(预设/API 两Tab)。`playerStore`(`drpg-player-evo`)：`PlayerPresetSettings{enabled,frequency,entries,presetName}`+`profile`(身份档案)+`achievements`。`smartFilterEntries`(`PLAYER_KEEP_NAMES` 54条)。预设 `预设/主角演化.json`(66条 entrySharedRules)。

**注入快照（重要修复）**：`buildPlayerSystemPrompt` 只拼条目、从不填 `${...}`——曾导致主角演化看不到自身等级/技能/天赋。现 `runPlayerEvolutionPhaseCore` 拼接后 `replaceAll` 填 `${character_snapshot}`(姓名/阶位Lv/进阶点数/六维/已有技能天赋/当前外观位置)+`${player_skills}`/`${player_traits}`，获得反累积可见性。

**技能/天赋纯正文驱动**：进阶点数只用于阶位/Lv 升级；技能层阶提升、天赋觉醒**不消耗进阶点数**，只凭正文证据 `addSkill`/`addTalent`。删除了修仙修为卡系统(`<skill_card>`/`cr.B1.p`)。

**副职业系统**（仅 B*，已真实持久化）：非战斗生活/制造手艺，名称全自定义。两层熟练度：总(五档 新手→宗师,满100晋级)+每配方(0~100)。指令 `addSubProfession/deSubProfession/addRecipe/deRecipe`(仅 B*,`^B\d+$` 守卫)+短指令 `ca.B1.<副职业>=档位/进度`/`rc.B1.<副职业>::<配方>+=N`。UI 右侧🛠副职业→`SubProfessionPanel`。制作=物品阶段走配方 output/materials，本阶段累加熟练度（松耦合）。

## 6. NPC 演化系统

入口：设置→变量管理→🧑‍🤝‍🧑NPC演化→`NpcManager`(预设/调度/API 三Tab)。右侧📇NPC→`NpcPanel`(死亡 isDead 不显示)→`NpcDetail`(11栏)。在场浮窗 `OnScenePanel`(`onScene&&!isDead`,头像位)。装备 `NpcEquip`(无技能槽/副职业,`normalizeSlot` 归一)。

**`npcStore`(`drpg-npc`)** `NpcRecord`（对应世界书 0~34 列）：name/gender(列1)、realm(列2 `阶位·Lv.X|身份`)、personality(列3)、status(列4)、callPlayer(列7)、background(列10)、innerThought(列12)、relations(列13)、favor(列15)、appearance5(列16)、motiveNow(列27)、appearanceDetail(列34)、items、avatar、imageTags(列19)、profession/arenaRank/brandLevel/contractorId/attrs/mp/age/bioStrength、onScene/isDead/isBond/keepForever/isFriend/partyMember…。action：`applyColumns`/`applySkeleton`/`setScene`/`markEvolved`/`removeNpc`(软删)/`hardRemoveNpc`(物理,同步 `characterStore.removeCharacter`)/`absorbOrphans`/`dedupeNpcItems`/`setFriend`/`createArchivedContractor`/`createPartyMember`。

**`npcEvoStore`(`drpg-npc-evo`)**：`strategy:'A'|'B'`(默认B)、`frequency`、`scheduling`(defaultFreq/`offSceneQuota`默认5/cleanup/`friendsPerTurn`默认3/concurrency默认2/modelPerTurnLimit/skipDead默认true)、`entries`。`smartFilterEntries` 按策略感知(`NPC_KEEP_NAMES`/`ENTRY_KEEP_NAMES`22条/`B_CONSTRAINT_NAMES`仅B)。prompt 按 `source` 拆 `buildNpcSystemPrompt`/`buildEntrySystemPrompt`。

**两策略**：A=单次合并(全局 frequency 门控,省 token)；B=三段管线 `runNpcPipelineB`——① `runEntryJudgment`(22条 entrySharedRules,输出 JSON `entries/exits/deedsUpdates/globalCommands`)→`applyEntryResult` 建档/归档/记事迹 ② `computeFocusList`(在场必演化+离场受频率/`offSceneQuota`截断+好友 `friendsPerTurn` 按 lastEvolvedTurn 轮换) ③ `runNpcEvolutionForTarget`(每NPC各1次调用,限并发5/批,按charId过滤)。`maybeAskCleanup` 周期弹清理框。死亡不演化(`skipDead`+`alive` 过滤+`NPC_DEAD_EXCLUDE_RULE`)。

**预设 `预设/NPC演化.json`(84条=62重点演化 prompts.npc + 22登场判断 entrySharedRules)**，`extractNpcPresetFromJson` 按区赋 source。⚠ 旧版单区升级到策略B必须重导 v2。

**关键修复**（防覆盖/重复）：ID 防撞（new 撞已有真实ID→改分配空闲C\<n\>）；同名去重（`nameToId` map，new 撞已有/本批同名→复用ID当重新登场）；防改名（已有真名后续不能用列1改）；补全不重造（`serializeNpcSnapshot` 注入当前档案，"已建档只补全"）；技能/天赋反累积（快照注入已有技能天赋+封顶：技能≥6/天赋≥3 不新增）；建档生成 HP/MP/六维/契约者身份（rule-45/50「建档初始化例外」放宽首次写默认值）；阶位等级分离(`一阶·Lv.8`,`cr.<id>=一阶/8`)；进阶点数系统(`advancePoints`,`ap.<id>+=/-=/=`,取代修仙进度%,每级递增表)；并发调度(524超时表现为CORS报错,缓解=降并发/切A/换端点)。

## 7. 势力 / 领地 / 冒险团 / 万族 演化

**势力**（仿 NPC）：`factionStore`(`drpg-faction`) `FactionRecord`(`inCurrentWorld`=当前世界活跃,类比在场)。`factionEvoStore`(`drpg-faction-evo`,A/B策略,`offWorldQuota`,独立API)。指令 `addFaction("F1",{命名键})/deFaction` + 短指令 `faction.F1.favorToPlayer+=N`/`inCurrentWorld=true` + `addDeed("F1")`。两策略 `runFactionWorldJudgment`(当前世界判断)+`runFactionFocusEvolution`(逐势力)。UI 🏛势力→`FactionPanel`(当前世界/非当前/已覆灭);设置→🏛势力演化→`FactionManager`。预设 `预设/势力演化.json`(双区)。**换世界清理**：`FACTION_FULL_FORMAT_RULE` 强制每次填全字段尤其 worldName(缺失=换世界后旧势力出不去的根因);`enterWorld` 兜底把 worldName 不属新世界的势力 `setWorld(false)`;`FACTION_HOME_EXIT_RULE`/`reconcileHomeWorld`(回归乐园移出任务世界势力)。

**领地**（主神空间个人基地·单一记录,跨世界保留,无防御绝对安全）：`territoryStore`(`drpg-territory`,数据+设置+API 合一)。`unlocked`/`name`(读正文称呼,不硬编默认名)/`level`(走阶位 `realmFromLevel`)/`buildProgress`(0~100满升级)/`effects`/`appearance`/`passiveOutput`/`members`(C-id)/`buildings`(全自定义,`buildingCap=level+2`,单栋≤5级)/`storageItems`。建设进度三来源(建筑/成员质量/投入资源,`territory.progress+=N`)。指令 `unlockTerritory/setTerritory/addBuilding/upgradeBuilding/deBuilding/addTerritoryEffect/addMember/storeItem/takeItem`(`applyTerritoryCommands`)+短指令 `territory.progress+=N`/`level=N`。被动产出落仓库 storeItem、货币走 transferSpiritStones(故领地阶段也跑 applyItemCommands)。UI 🏯领地→`TerritoryPanel`。预设 `src/data/territoryDefaultPreset.json`(8条)。

**冒险团**（仅主角单一团,其他冒险团归势力）：`adventureTeamStore`(`drpg-team`,数据+设置+API)。established/disbanded/name/rank(E~SSS)/teamExp(0~100晋级主轴)/activity(0~100每回合-2)/members(C-id,主角B1=团长)/perks/deeds/assessment。`memberCap=3+idx`/`ACTIVITY_GATE=60`。双计量晋级(`addExp`)：满100时 E→A 且 activity≥60 自动;→S/SS/SSS 触发考核(不自动)。考核(建团+大阶位,纯剧情)：`establish`/`startAssessment`/`resolveAssessment('pass'|'fail'|'disband')`。仅正文明确建团才 `establishTeam`。指令 `establishTeam/addTeamMember/removeTeamMember/addTeamPerk/startAssessment/resolveAssessment`(`applyTeamCommands`,注意成员 store action 是 `upsertMember`)+短指令 `team.exp+=N`/`activity+=/-=N`/`rank="S"`。`callApi` 开头 `decayActivity()`。UI 🛡冒险团→`AdventureTeamPanel`。预设 `src/data/teamDefaultPreset.json`(6条)。

**万族演化**（cosmosStore,宇宙背景层七乐园/万族/深渊,头顶自转）：三子模式+独立API+判词注入。`runCosmosEvolutionPhase`/`buildCosmosInjection`(<万族态势>独立于叙事记忆开关)。详见记忆 `cosmos-evolution-feature`。

## 8. 杂项演化 / 生平压缩

**杂项**（`miscStore`+`miscParser`+`runMiscEvolutionPhase`,第4并发阶段,只读正文只写变量）：分段总结 `addSmallSummary/addLargeSummary`、世界大事 `addWorldEvent`、主角任务(仅 `T_<数字>`)、天气、**双时间**（`paradiseTime` 轮回历X年X月X日 + `worldTime` 任务世界时间 + `worldName`）。**回归乐园兜底**(`isHomeWorld`/`reconcileHomeWorld` 每回合开头)：worldName 命中 主神空间/专属房间/轮回乐园 → worldTime 同步 paradiseTime + 旧任务世界势力移出当前世界。`MISC_HOME_TIME_RULE`+`FACTION_HOME_EXIT_RULE` 双保险(已写入预设)。预设条目化 `settings.entries`(默认 `src/data/miscDefaultPreset.json` 14条,导入导出)。入口 🧩杂项演化→`MiscManager`;📋任务→`MiscPanel`。⚠纪元名是「轮回历」(曾误「轮回力」)。

**生平压缩**（`memoryStore`+`characterStore.memory`）：逐角色 `memory.shortTerm/longTerm`(`MemoryEntry{time,location,content}`)。`addMemory("B1"/"C1",{...})` 追加 shortTerm;达阈值(短25→5、长50→20,可调)`runMemoryCompressionPhase` 调 AI 压缩(轮回乐园档案官提示词,不可逆事实自检)。入口 📜生平压缩→`MemoryManager`(独立API)。

## 9. 叙事记忆 + 结构化召回 + 向量资料库

**叙事记忆**（`settingsStore.narrativeMemory`+`systems/narrativeMemory.ts`,默认关）：① 关键词召回——当前输入+上条正文 `tokenize`(中文2-gram)→在 facts(narrativeFacts/小总结/大总结/世界大事)按命中取 TopK→拼 `<相关记忆>`,启用时替换 historyLimit 切片。② LLM 两步法——发送前 `narrativeCompile`(LLM 改写检索关键词,找"相关"非"最新")+回复后 `runNarrativeIngestPhase`(LLM 抽长期事实存 `miscStore.narrativeFacts`,max300)。独立 `nmApi`,可分别选 compile/ingest 模型。入口 设置→🧠叙事记忆;🧠记忆→`SummaryPanel`。

**结构化档案召回**（`systems/structuredRecall.ts`+`buildStructuredRecall`,默认开）：解决主正文 API 读不到结构化数据——把主角(必含)+预测/在场 NPC 完整档案序列化成 `<在场与相关档案>` system 块注入正文。NPC 选择：开 LLM 两步法时 `narrativeSelectChars` 预测下回合登场 → 否则 `rankNpcsLocal` 兜底。当前世界势力 `serializeFactionsSection`(全量,限 `structMaxFactions` 默认4)。限量(叙事记忆设置页)：`structMaxNpcs`默认2(选中NPC给全量,不截断)、`structMaxSkills`/`structMaxItems` 仅主角。主角装备精简注入 `playerItemLine`(仅 名称/类型/品级/killCount/affix/effect)。冒险团已建立只注入 等级/成员/团队效果。临时队伍注入「【主角的临时队伍】」段。

**向量资料库**（原著当世界书,`store/novelVecStore.ts`+`systems/novelVec.ts`+`NovelVecManager`,默认关）：**双索引**——小说全本(`public/novel-vectors/`)+世界书 `______.json`(`public/worldbook-vectors/`)预建 bge-m3 向量内置前端,运行时查询 embed 一次→在两个库各 cosine→合并 topK→注入 worldInfoText(标 `〔原著·第X章〕`/`〔世界书·猎杀者〕`)。int8 量化(单位归一化×127),cosine=(q·int8)/127。IndexedDB `drpg-novelvec` v2(多源,chunk 键 `<name>#<id>`)。`gunzipJson` 魔数检测(Vite dev 透明解压 .gz → 直接 parse)。建库 `tools/build-novel-vectors.mjs`(`npm run build-vectors` 小说 / `build-vectors-wb` 世界书)。查询 embed 与叙事记忆同句可合并只调一次。详见记忆 `novel-vector-ragbook`。

## 10. 中心 API 库 + 多接口路由

`settingsStore.apiLibrary: ApiEndpoint[]`(增删改启停排序,Key 仅本地)+`apiRoutes: Record<featureKey,string[]>`(有序 endpoint id,上=先调)。`resolveApiChain(key,legacy): ApiConfig[]`——路由有启用接口则返回链,否则回退 legacy 单配置。调用器 `apiChatFallback(chain,messages,{timeoutMs,extra})` 逐个尝试失败切下一条;主正文 callApi 内置同款流式 fallback 循环。featureKey：text/world/item/player/npc/faction/territory/team/misc/memory/nm/image_story_llm/channel。各功能 ApiSection 用 `ApiRoutePicker`(多选+排序)。⚠ 世界选择(world)曾漏接,`WorldSelector.generate()` 早期裸 fetch,已改 `resolveApiChain('world',api)`。维护入口：综合设置→「API 接口库」。

## 11. 生图系统（三条线）

多服务(NAI/OpenAI/Gemini/ComfyUI/自定义),三条独立线各选服务+模板+自动开关。入口 综合设置→🖼生图设置→`ImageGenManager`(4子页)。生成器 `systems/imageGen.ts` `generateImage(service,{prompt,negative,size,signal})→dataURL`：`genNai`(返回ZIP,`extractImageFromZip` 解 stored/deflate+PNG兜底,v4 用 `v4_prompt`,画师串追加)/`genOpenAI`(/images/generations,共用 OpenAI/Gemini/自定义)/`genComfy`(注入 seed→/prompt→轮询/history→/view)。

**三预留框+手动✨生成**：NPC 肖像→`NpcRecord.avatar`(`AvatarBlock`)、主角立绘→`PlayerProfile.avatar`(`PlayerAvatar`)、装备图→`InventoryItem.image`/`NpcOwnedItem.image`(`npcStore.updateNpcItem`)。**自动阶段**(`runPostNarrativePhases` 末尾,各开关门控,延后6秒等演化写档,串行避免打爆NAI)：`runPortraitPhase`(autoPortrait,外观变化自动重绘 `refreshOnLook` 默认true,主角 appearance 文字变也触发 `forceRetag`)/`runEquipImagePhase`(autoEquip,`buildEquipPrompt` 用可编辑 `equipTemplate`)/`runStoryImagePhase`(autoStory,正文配图,独立LLM `image_story_llm` 跑 `storyTemplate`→`<image>` 块→存 `ChatMessage.images[]`,渲染 `toHtmlWithImages` 在 anchor 命中插 `<img class="story-illust">`)。

**肖像 tags(列19,仅角色)**：英文 danbooru tags 演化生成,存 `imageTags`,`buildPortraitPrompt` 优先用。`IMAGE_TAGS_RULE`(主角+NPC演化,英文/性别开头/仅长期外观变化更新/勿修仙词/同人角色准确 danbooru 名+作品+经典外观)。

**图片存 IndexedDB `drpg-images`**(非 localStorage,会爆5MB)：`systems/imageDb.ts`(键 player/npc:<id>/item:<itemId>/npcitem:<owner>:<itemId>)+`imageSync.ts`(订阅 store 镜像+`hydrateImages` 回填迁移+`snapshotImages` 供存档)。各 store 用 partialize 排除图片出 localStorage。`imageTags`(小文本)仍随 drpg-*。`ChatMessage.images` 随 chatDb。状态栏 `imagePhaseLog`。详见记忆 `image-gen-feature`。

## 12. 公共频道 / 私信 / 好友

**公共频道**（契约者公共广场,`channelStore`/`channelTrade`/`ChannelPanel`）：七频道,单机=AI 模拟虚拟契约者,懒刷新,走 `resolveApiChain('channel',textApi)`。交易(出售帖一键买/玩家挂单 `solicitQuotes`→`acceptQuote` 确定性成交,成交自动删帖)、系统商店(`SystemShop`,买=`genShopItems`/卖=`genSellQuotes`)、主角发言(`addPlayerSpeak` 立即上墙→AI 逐条错峰回复,注入近20条上下文,「↩回复」定向)、发帖人信息(authorPersona/Job/Strength,`CHANNEL_AUTHOR_INFO_RULE` 职业多样化)、临时队伍(复用 NPC:`createPartyMember`/`leaveParty`/`disbandPartyForWorld`;加入组队帖 `joinPartyFromPost`/邀请 `inviteToParty`AI判定/世界结束自动解散 `reconcilePartyLifecycle`/转正 `PartyPromoteDialog`→`upsertMember`/中途 `partyLeave`)。`partyMember` 打「队」蓝徽章。详见记忆 `public-channel-feature`。

**私信**（一对一,`dmStore`/`dmTrade`/`DmPanel`,独立界面 ✉私信）：可私信 `isDmableTag`(契约者/随从/宠物/无标签;土著/召唤物不可)。`DmThread`(key `c:<cid>`/`n:<name>`)+`DmMessage`+`DmDeal`(buy/sell/request/barter)。结算 `settleDmDeal`(确定性,对方收物入其NPC储存,未建档就地 `createArchivedContractor` 兜底)。处理器(走 channel API)`dmReply`/`dmPropose`/`dmHaggle`/`dmAccept`/`dmGenArchive`。物品流向：买/索取/换→主角背包;给予/出售/换出→对方NPC储存。详见记忆 `private-message-feature`。

**好友**（好友栏+每回合参与NPC演化）：`NpcRecord.isFriend`+`setFriend`。整合(仅策略B)`scheduling.friendsPerTurn` 默认3,`computeFocusList` 按 lastEvolvedTurn 升序轮换。加好友：📇NPC☆切换/频道「⭐加好友」`addFriendFromChannel`/私信头「⭐加好友」。落地 `addFriendByInfo`(已建档直接 setFriend;未建档 `createArchivedContractor`+异步 `fleshOutContractor` AI 补全档案+3~6件物品)。**离场≠死亡**(`fleshOutContractor` 提示词明确活着+`stripDeadWords`+`isDead:false`,修"频道加好友显示已阵亡")。UI 👥好友→`FriendsPanel`。

## 13. 存档 / 封面 / 角色创建

**存档**（IndexedDB 多存档,`saveDb`/`saveManager`/`SaveLoadPanel`）：一个存档=全部 `drpg-*` 快照+对话+图片(`snapshotImages`)+预览。`saveSlot/loadSlot/renameSlot/deleteSlot/exportSlot/importSlot`。**读档用 reload**(gameStore 手写持久化无 rehydrate,写回 localStorage→整页 reload;对话经 chatDb 恢复,sessionStorage `PENDING_STARTED_KEY` 决定是否自动进游戏)。对话跨刷新：chatDb 逐条增量写。**新游戏** `newGame()` 清进度保配置 reload。自动存档 `AUTOSAVE_ID='autosave'`(回合后延时20秒 `captureTurnSnapshot`+覆盖式存)。入口 💾存档;开始界面读档热区。

**封面 `StartScreen`**：全屏 `public/cover.jpg`(原比例居中不裁),三按钮透明热区(开始/读档/设置)。

**角色创建 `CharacterCreation`**：两阶段(form→confirm)。难度→属性点(简单50~无用之人10)、选乐园、基本信息、六维(每项≤10总和≤难度点)、天赋。`confirmCreation` 写 playerStore+`addTrait('B1',天赋)`→`setStarted`→`buildOpening` 自动发首条。开场白 `settingsStore.customOpening` 可自定义(占位符 `${name}/${age}/…/${attrs}`)。所属乐园 `profile.homeParadise`(开局选定,`character.B1.homeParadise` 仅重大事件改)。**新开档历史泄漏修复** `messagesRef`(callApi 读 `messagesRef.current`,confirmCreation/enterWorld 发请求前清空)。

## 14. 回合洞察 / 自动存档 / 六维代码生成

**回合洞察**（`turnInsightStore`+`TurnInsightPanel`）：每回合精简快照(主角六维/状态/技能/称号+全NPC好感/状态/动机+势力好感/目标/地盘…),滚动14份,`captureTurnSnapshot` 在自动存档同点调。面板最新vs上一份结构化 diff(纯 store diff 不调LLM)。🔍回合洞察。

**NPC 六维代码层生成**（解决属性与正文不一致）：`applyNarrativeAttrs` 扫正文人物卡六维逐项照抄(登场判断后+重点演化后);`genVariedAttrs`+`autoGenMissingAttrs` 无卡时按 阶位预算+职业排序+生物强度模板T0~T9 生成有起伏六维(仅兜底,不覆盖卡/演化)。`applyNarrativeVitals` 扫"当前HP/EP：X/Y"照抄。演化阶段发全文(物品/主角/记忆抽取去掉2000字截断;NPC/势力仍 trimNarrative 控token)。同人作品遇二创优先 Google Search 原作设定。

## 15. 身份档案字段

主角(`playerStore.profile`,左栏 `PlayerSidebar` 点击即编辑)+NPC(`NpcRecord`,`NpcDetail`)：姓名/等级/阶位/称号/职业/竞技场排名/身份/烙印/契约者ID/生物强度/六维(力str敏agi体con智int魅cha幸luck)/外观/位置/HP·EP。叙事区左右浮窗：左 `PlayerEquipPanel`(主角装备)↔右 `OnScenePanel`(在场人物);右下 `ItemListPanel`(物品栏简表)。新增字段 `advancePoints`(进阶点数)/`worldSource`(世界之源,任务世界累计,回归=0)。

**生物强度** `bioStrength`(如 `T3·勇士`,T0~T9)：`character.<id>.bioStrength="..."`。两预设 `生物强度生成框架(T0-T9属性预算)`——按 阶位Tier预算+模板+身份层+流派分配六维,宁低勿高禁全满。**非人生物(阴影/魔物/Boss)同样必须生成六维**。六维纯AI生成,前端只算衍生ATK/DEF。

**衍生属性**（`systems/derivedStats.ts` `computeDerived`,主角侧栏+NPC详情共用）：物/法 ATK/DEF 由六维+等级+装备实时换算,换装自动重算。NPC 等级 `lvFromRealm`。纯前端算 AI 不写。

**经历 deeds**：`profile.deedLog`/`NpcRecord.deedLog`(`{time,location,description}`),`addDeed("B1"/"C1",{...})`。「经历」tab 时间线。

**列写法兼容**（重要）：主角侧栏读 `profile.status/appearance/location/background`,但预设用旧列写法 `add("B1",{"4":状态,"16":动作|穿着|位置|身段|样貌,"10":背景})`→`applyPlayerProfileCommands` 解析列4→status、列16→appearance(+位置→location)、列10→background;直写短指令 `character.B1.status/appearance/location="..."` 仍有效。

**分段显示 `SegmentedText`**（NpcDetail 导出）：按 `；;`/空格包围 `|`/换行切多行,识别 `[标签]`/`【标签】` 前缀。用于性格/内心/私密。**状态胶囊 `StatusChips`**：列4 `状态名:Emoji(效果|激活|结束|来源)`(多个 ；分隔)解析成 chip,buff绿/debuff红/中性琥珀。

**限时状态**（引擎自动过期 `StatusEffect`,与自由文本 status 并存）：`profile.statusEffects`/`NpcRecord.statusEffects`。`addStatus("B1"/"C1",{name,emoji,tone,effect,source,duration})`/`deStatus`(`applyTimedStatusCommands`)。duration "3回合"→回合制,"5分钟/2小时"→游戏时间(`gameClock`)。`expireStatuses` 每回合开头按 turnCount-startTurn 或游戏分钟过期(无需AI移除)。展示 `StatusEffectChips`(胶囊只显"数字+单位"短时长,长解除条件进 `durationDesc`)。两预设 `限时状态系统`。

**年龄 age**：NpcDetail 战斗属性栏,`character.<id>.age="约25岁"`,正文有照抄无则生成(`NPC_AGE_RULE`)。

## 16. 技能·天赋·称号固定格式 / 成就 / HP·EP上限

三者走 `characterStore`(B1+Cx 共用),指令 `parseAllCharCommands`/`applyCharacterCommands`。

**技能 `Skill`**（名称|等级|类型|品级|消耗|目标|效果|伤害|层级|属性加成|描述|标签）：`addSkill("B1",{命名键})`。**7档品级** `skill.rarity` 普通→精良→稀有→史诗→传说→奥义→极境(`SKILL_TIER_CLS/normSkillTier`,含旧值/D-SSS归一化,极境给渐变辉光)。**等级** Lv.1→Lv.10→Lv.EX(满级,升一档品级重置Lv.1)。奥义=常带唯一被动;极境=实战体悟+技能融合练成。`SKILL_TIER_RULE`(App注入,改即生效)+预设 `技能品级与等级系统`。同名 upsert `mergeKeepRich`,卡片 `breakSentences` 断行。

**天赋 `Talent`**（名称|等级|品级|效果|属性加成|描述）：评级 D→C→B→A→S→SS→SSS,**数量不设上限**(旧"最多3个/同类型唯一"已解除,`TALENT_NO_CAP_RULE` override)。激活需明确证据(宿主绑定/启蒙之石/突破卷轴/融合精华/试炼/顿悟/血脉),提升困难每次质变,同名只更新。`addTalent`/`addTrait`(别名)。`category`(技巧/属性/能量/特殊异能)。

**称号 `Title`**（名称|获得时间|品级|来源|效果|描述|装备）：每角色最多1个 equipped。`addTitle/deTitle/equipTitle`。NPC 生成自带1个称号。结构化召回只注入 equipped 那个。UI 主角 🎖称号→`TitlePanel`;NPC 在 NpcDetail。

**成就**（仅主角 `playerStore.achievements`）：`Achievement{id,name,desc,category,type,rarity,hidden,condition,unlockTime}`。`addAchievement("B1",{...})/deAchievement`(仅B*,NPC不建模)。UI 🏆成就→`AchievementPanel`(隐藏带🔒)。不计入叙事记忆注入。

**HP/EP 上限可成长**：`maxHp/maxMp` 不固定,升级/阶位/体质成长可抬高。主角 `maxHp.B1=N`;NPC `hp.C1=当前/新上限`。**主角 HP/EP 始终按六维换算**(`computeMaxHp`/`computeMaxEp`=Σ六维×**自定义系数表**,**默认 体×20→HP / 智×15→EP,主角/NPC 各自可自定义** `hpRatio`/`epRatio`={属性:系数}(多属性混合,如 HP=体×10+智×5),缺省回退默认,调用方经 `ratioOf()` 传入；主角在血条「✎自定义血条」的 6×2 矩阵改、NPC 在详情编辑矩阵里改),三处兜底：confirmCreation 开局拉满、`reconcilePlayerVitals`(仍100/50旧默认时重算)、`applyNarrativeVitals`(扫正文照抄)。

**自定义能量条**（HP/EP 之外·仅主角·`store/resourceStore.ts`，键 `drpg-resource`）：玩家在主角血条「⚡自定义能量条」面板自建额外资源条（怒气/堕落值/灵力…），机器键 id(ASCII，供指令)+显示名。**上限**=固定值或**六维系数表**(`computeAttrPool`，复用 HP/EP 同款加权·四阶起×5)。**当前值**由正文 `res.B1.<id> +=/-=/=`(`stateApply`)驱动并钳 [0,上限]、**忠于正文不自动回**；`structuredRecall` 每回合注入「当前/上限+说明+更新指令」(`inject` 可关)；**AI 不能自创**(未定义 id 的指令忽略·名称只出不进)。**三种深度**：① 纯剧情展示；② **技能消耗/门槛**(`skill.numeric.resCost` 消耗/`resGate` 门槛需≥·玩家在🎯面板绑定·`CombatPanel` 不足/未达则禁用、施放即扣，门槛不耗)；③ **战斗内累积**(`resource.combat`={onAttack/onHitTaken/onKill/onTurn/resetEachBattle}·`applyCombatResourceGains` 在 `App.resolveAndNarrate` 观察 B1 的 HP 差/出手/击杀、回合开始 DoT/领域走 advanceTurn 后钩子·**全程不碰战斗引擎**)。随存档、新游戏清(`saveManager` 已纳入)。

## 17. 名称模糊匹配 + 照抄铁则

防"简写/标点差异匹配失败":① 代码 `nameEq`(去空白/标点/大小写后相等,不做子串以免误并 `烈焰斩`vs`烈焰斩·改`)——characterStore/territoryStore/adventureTeamStore 的"同名更新/按名删除"用它;② 物品 `fuzzyFindItem`(子串含+反向含,"止血喷雾"→"次级止血喷雾"取最短),消耗/销毁经 `pickTargetItem`(name 优先于幻觉 itemId);③ 提示词照抄铁则 `ITEM_EXACT_REF_RULE`(物品阶段)/`EVO_EXACT_REF_RULE`(主角+NPC演化,删除/升级照抄快照完整名)。

## 18. 世界书体系 / 预设文件

**世界书 `______.json`**（127条 uid 0-146）：**阶位**(列2)一阶 Lv.1-10~无上之境 Lv.140+,格式 `阶位·Lv.当前|身份`。**技能层阶**(与阶位独立)入门 Lv1-30→精通→大师→宗师→极道。**物品品质**白→绿→蓝→紫→淡金→金→暗金→永恒→起源→创世。**货币**乐园币+魂币+技能点+黄金技能点(固定显示储存空间货币栏,1魂币≈15万乐园币)。**天赋评级** D-SSS。修改直接编辑 JSON 在界面重导。

**预设文件**（仓库根 `预设/*.json` + `src/data/*DefaultPreset.json`）：导入到各演化管理子页(`entrySharedRules` 格式)。原版蓝本 `完整版-主角演化（轮回乐园适配）.json`(全阶段 prompts)。各子页有 条目搜索/仅看已启用/导出/删除未开启/⚡智能筛选。**统一映射**(改预设必守)：灵石→货币、功法→技能书、灵兽妖兽→召唤物、御兽→召唤物指挥、词条→天赋(D-SSS)、百艺炼丹炼器→副职业、修炼速度→战斗速度、境界→阶位、修为→等阶、灵根→天赋、修仙世界→轮回乐园。聚灵阵/灵脉/闭关公式/万物炼制DC已删,双修保留。

**世界详情库**（世界详情工坊产物消费层,`systems/worldDetail.ts`,零配置默认生效）：仓库根 `世界书/世界详情库·主库.json`+`·休闲.json`(每世界两条目 `<名>·剧情`≥1万字/`<名>·阶位切入点|·休闲切入点`,由 `世界详情工坊/scripts/compile-worldbook.mjs` 编译)合计 ~137MB 不能整本进前端 → vite 插件 `buildWorldDetailShards`(vite.config.ts)构建时按世界名 FNV-1a 切 **256 哈希分桶** `public/worlddetail/s<i>.json`(单片~0.5MB)+`manifest.json`(名→分桶号,~228KB)；产物 gitignore,源 size+mtime 记 `srcStamp` 没变秒跳(工坊重编译后下次 build 自动重切)。前端按需 fetch+进程内缓存：**C1 世界卡生成**(`WorldSelector.generate`)按点名世界名 `fetchWorldDetailsFor` 注 剧情+切入点 两段(总预算 `WORLD_DETAIL_BUDGET`=6万字,超则切入点保全量、剧情从头保留截尾;命中的卡片字段严格照档案);**C2 入世正文**(`callApi`)`ensureWorldDetailFor(misc.worldName)` 回合前预取(超时5s放行)+`buildWorldDetailInjection()` 在世界志旁注 **·剧情全文(切入点不注**——选择期资料,入世后会诱导复述开场);细纲分支同注。世界名漂移(「世界名+地点」等)用 `resolveWorldNameFrom` 三级匹配(精确>归一>双向子串取最长,与 worldCodexStore 同款 norm)。查无此世界/无产物/断网一律静默降级。

**世界资料库面板**（右侧导航🗂,`WorldDetailLibPanel.tsx`,lazy）：浏览/搜索全部世界档案+**编辑修订链路**。读取三层覆盖(见 worldDetail.ts `getWorldDetail`)：**本地修订**(`worldEditStore`,key `drpg-worldedit`·lz压缩·不进saveManager同workshopStore)＞**全局修订**(worker `/api/worlddetail/overrides`,会话内拉一次,失败5分钟后才重试防墙外每回合白等)＞内置分片。编辑保存→本机立即生效(面板调 `invalidateWorldDetail`)→弹「是否提交站长审核」→`wdSubmit`(systems/worldDetailShare.ts,署名=工坊昵称,owner=mpConfig `myPlayerId`)。「我的提交」查状态(待审/已通过/已拒绝)。**审核页签仅站长可见**：复用创意工坊管理员密钥(`workshopStore.adminKey`=worker `env.WS_ADMIN_KEY`,创意工坊→设置里验证)，现行版vs提交版对照→通过=写 D1 `worlddetail_overrides` 对所有玩家生效(前端 `refreshOverrides` 本机即时换新)/拒绝=标记。服务端 `multiplayer-worker/src/worldDetail.js`(D1共用workshop库·懒建表·同IP限流10/时·全文≤300K字符·同owner同世界旧待审自动替换)，路由挂 index.js `/api/worlddetail/*`——**改动后 worker 需 redeploy**。

---

## 19. 装备强化系统

**入口/门禁**：右侧导航「⚒强化」开 `EnhancePanel`；仅 `isHomeWorld(misc.worldName)`（轮回乐园/专属房间）可强化，否则置灰。配置在 设置→变量管理→装备强化（`EnhanceManager`）。引擎 `systems/enhanceEngine.ts`（纯前端确定性，不花 API），数据 `store/enhanceStore.ts`(`drpg-enhance`)。

**强化等级**：装备 `enhanceLevel` 0~16（`InventoryItem`+`NpcOwnedItem`），卡片右上 `+N` 流光角标（`enhanceFxClass`，按档复用 `.grade-*`，越高越华丽）。

**摇率/结算**（`resolveEnhance`；率表 `EnhanceTables.version` 化迁移——改 base/floor 必 ++version，旧存档自动刷新）：固定成功率表 +1→2/+2→3=100%、+3→4=95%…+15→16=10.1%（老板 `displayLie` 只虚标明面、不改实际摇率）。**失败三段**（floor 全局可配 3/7/10）：**+0~+2 必成**；**+3~+6 失败降 1 级**；**+7~+9 失败强化归零(回 +0)**；**+10+ 失败装备分解消失(爆)**。`isRiskLevel`(≥7,保护石生效)/`isDangerLevel`(≥10)；暴击跳级(`boss.critJump`)=成功额外 +1；中央五特效 `.enh-success/.enh-crit/.enh-fail/.enh-reset/.enh-destroy`。

**垫子计数/保底**：`pity` **只在真爆装后 +1**（不是每次失败！），满 `PITY_THRESHOLD=10` 下次必成后清零。**账号级全局**——存 drpg-enhance localStorage，不进存档、不导出。可拿便宜装推危险区故意爆刷保底。

**费用**（`enhanceCost`，扣乐园币，现买现用不占背包）= 基数·(L+1)^指数·**品级倍率**·**评分倍率**(`scoreCostMul`)·老板倍率；品级↓评分↓→更便宜。保护石（危险区免爆）/强化符（+实际率）费用随等级涨。

**老板/看板娘**（`DEFAULT_BOSSES`，可增删改，配置全局走 configExport）：每个=costMul/rateAdd/displayLie(明面率虚标,凯莉型显示≠实际)/destroyFloor/critJump/persona。**分阶段立绘**：图放仓库根 `图片/<老板>/阶段1~4/`→vite 插件 `syncEnhanceBosses` build/dev 同步进 `public/enhance-bosses/` + 生成 manifest（`systems/enhanceBosses.ts` 运行时 `loadBossManifest`/`pickStagePortrait` 读取；副本 gitignore，源入库）。`stageFromLevel`：+0~3=阶段1 / +4~6=2 / +7~9=3 / +10及以上=4，**每强化随机换该阶段一张**，空阶段就近回退；无文件夹回退上传单图(IndexedDB)。

**两个 AI 点**（`resolveApiChain('enhance')`，默认复用正文 API）：① 点立绘**吐槽** `enhanceBanter`——读会话实况，**分阶段×性别**语气（女:正常→诱惑→露骨→放飞成人向；男:平常→挑衅→劝收手→难以置信）。② **收尾刷装备** `runEnhanceFinalizePhase`——由面板「✓ 结束强化」按钮（或关面板/切装备）触发，仅本轮净涨等级且未损毁时；每跨 4 级 +1 词缀，纯 AI 重算攻防/affix/effect/外观/评分，按 `growthCoef`(品级×评分)缩放强度、词缀参照网络小说词条风格；只吐 `updateItem`，事后钉回 enhanceLevel。

**货币兑换**：储存空间(`BackpackModal`)货币栏底 `CurrencyConverter`，**1 灵魂钱币 = 150,000 乐园币**，双向（`adjustCurrency`）。

**坑**：① 立绘大图 partialize 出 localStorage（存 IndexedDB key `enhance-boss:<id>`，`hydrateEnhancePortraits` 回填）。② 爆装动画用 `dying` 快照渲染（物品已 `removeItem`）。③ 改 `vite.config` 的图片同步插件需**重启 dev**。④ 立绘 `object-contain` 完整显示（不裁切）。
