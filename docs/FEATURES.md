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
7. 势力 / 领地 / 冒险团 / 万族 演化（7b. 冒险团派遣·离线委托）
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
19b. 装备工艺（🔨锻造潜力耗尽封盘·精髓提取灌注·虚空腐蚀赌局·AI自创工艺+工坊分享·风险定价平衡阀）
19c. 编年史 / 传奇模式（📜本纪+前尘双视图·卷页注三层·实录→AI修正史·金银灰分级·实体互链）
19d. 正文关键词悬浮图鉴（名词 tooltip·惰性词典·只标首次·四色系·可并入轮回wiki人物）
19e. 楼层分支树（🌿时间线视图·⟳重生成/↩回退的弃稿自动收成可回收平行线·🔖主动分岔）

---

## 1. 正文渲染与数据化风格

**`toHtml`（App.tsx）始终走 HTML 感知的 `wrapSettlementBlocks`**：含 HTML 标签的行/未闭合 HTML 块原样透传（ST 正则卡片照常渲染），同一条消息里的 `>` 模块块 / `【…】` 块仍打**琥珀边框格子**。打包规则：① 连续 `>` 引用行整段打包（时间结算/动作日志/击杀/成长/判定/战斗/信息卡/登场离场/任务/资源等）；② 无 `>` 时以 `【…结算/日志/战报/登场/资源/判定…】` 标题兜底。`renderSettleBlock` 拆出 `【标题】`（AI 常把「【动作日志】+整段」写一行）、正文按句末标点 `。；！？` 分行（`space-y-0.5`）。字号：正文 `text-[17px]`、结算格子正文 `text-[15px]`/标题 `text-[13px]`。入口 `dangerouslySetInnerHTML={{__html: toHtml(msg.content)}}`。正文配图见 §11（`toHtmlWithImages`）。

**数据化风格**（参考 `ST_WI_Modular_Output`）：技能/物品/装备/天赋的 effect/描述**必须写具体数值**（+X攻击、+X%暴击、减伤X%、恢复X点、持续/冷却X回合、消耗X）。三预设已把旧「不写数值」禁令翻转为要求 + override（zhushen 无 numeric 战斗引擎，数值只在文本可见）。

**楼层信息条（正文末尾扁条）**：贴在**最新一段正文下方**的一条 12px 扁条，三段——① 世界时间·天气（`miscStore.worldName/worldTime/paradiseTime/weather`，天气串走 `weatherGlyph` 转 emoji）② 任务（`miscStore.tasks`·主线置顶·显示当前环 `N/总`、环目标、上回合进度、🔒锁定、截止）③ 伏笔（伏笔表未回收线头·催收项置顶）。点某段就**就地展开**该段详情，再点收起（同时只开一段）。
- **⚠ 与 AI 同一口径**：伏笔段的 ⚠ 直接复用 `plotThreads.collectStaleThreads` 的账龄判定——玩家看到的「21 回合无进展」正是这一回合前端已在 `<伏笔催收>` 里催 AI 回收的那几条，不是另算的一套。
- **纯只读**：不调 API、不写 store、不注入 AI；三段全空（新档/无任务无伏笔）自动隐藏，不平白多一条空条。
- **性能铁则**：`components/StoryStrip.tsx` 是**零 props 的 memo 组件** → App 每次重渲（打字 / 流式 100ms 合帧 / 任意 state 变化）都判「props 未变」整棵子树跳过，只有它自己订阅的 store 变了才重渲。**绝不要给它加 props**，否则等于把 App 的高频重渲引进来（同「打字卡顿」教训）。取数纯函数在 `systems/storyStrip.ts`（有单测）。
- 开关：设置→界面外观美化→「楼层信息条」（总开关 + 四段各自开关，`settingsStore.storyStrip`）。

**🗓 世界历（节日 / 生日 / 纪念日）**：只收「**每年固定到期、会反复来一次**」的日子——与任务（会结算掉）、世界大事（一次性）分开存。只记 **(月, 日) + 持续天数**，年份在扮演里无意义；异界写法（腊月廿三 / 火之月第三日）另存 `displayDate` 原样展示。条目分「本世界专属」（绑世界名）与「跨世界」（主角生日、乐园级纪念日）。
- **今天是几月几日 = 零 API**：直接从 `miscStore.worldTime` 正则抠（`calendar.extractMonthDay`，认得「斗罗历 2 月 17 日」「2024-03-15」「三月十五」「7/4」）。参考插件必须为此**额外调一次 AI**，本项目的双时间本来就由杂项演化每回合维护，白捡。抠不出（如「进入世界第 3 天」）→ **降级**：不排七天、只按月日列清单，绝不瞎猜。
- **数据来源两条，都不新增 API 调用**：① 玩家在 📋任务面板→「历」tab 手动增删改 ② 杂项演化阶段（已有的那次调用）顺带输出 `almanac([{...}])` / `almanacRemove("名")` 指令 → `miscParser` 落 `calendarStore`。规则见 `promptRules.ALMANAC_MAINTAIN_RULE`（明确「什么该进历/什么不该进」+「没新增就别输出这行」）。
- **回到正文**：未来 7 天内到期的条目并进 `<当前时空>` 尾部（`promptInjections.buildAlmanacLines`），让市井氛围/NPC 言行/主角安排自然受节庆影响。**历里没条目、或抠不出今天 → 整段不出现，一个 token 都不加**。
- **回到眼前**：楼层信息条第四段「历」= 未来七天格（今天/明天/后天/+N + 月日，有日子的格子打类型 emoji、可点开看当天）。
- **世界作用域（worldScope 铁则）**：历是 world+paradise 混合——`world` 填了世界名=本世界专属，留空=跨世界。**所有读取点统一走 `visibleIn(items, worldName)`**（楼层信息条 / 历面板 / 参谋现状清单 / `<当前时空>` 注入），离开该世界即不可见、不注入。
  - ⚠ **归属兜底**：AI 输出 `almanac(...)` / 提案卡时**没给 `world` 键** → 落库时默认归**当前任务世界**（`calendarStore.resolveWorld`）。反过来默认跨世界更糟：某个世界的节日会跟着主角进下一个世界并注入正文串味；误归本世界只是「离开后看不见」，玩家在历面板取消「仅本世界可见」即可捞回。
  - 只看**键在不在**：面板永远显式传 `world`（勾了=世界名／没勾=`''`），所以手动设「跨世界」不会被兜底吃掉；AI 显式写 `world:""` 表达跨世界意图同样被尊重。在乐园/枢纽时不兜底。
- 跨年长假算得对（12/30 起 4 天 → 覆盖到次年 1/2），首日已过但仍在会期内的记为「就是今天」。

**🧭 参谋（局外顾问 + 提案卡）**：右侧导航「参谋」。在**剧情之外**跟 AI 商量——「给我设计一条三环支线」「埋一条关于黑袍人的伏笔」「把宁荣荣的生日记到历上」「T_1 的奖励太高了改一下」。它给**提案卡**，玩家点「应用」才写进存档。
- **与演化互补**：演化阶段是「AI 替你记账」（自动落库），提案卡是「你想加点什么，让 AI 帮你拟稿」（人拍板）。三种卡：`quest` 任务（含多环路线图）/ `thread` 伏笔 / `almanac` 历。
- **改已有条目**：卡片开标签带 `ref="T_3"` / `ref="4"`(伏笔 row_id) / `ref="alm_x"` → 更新而非新建。id 来自每次重拼的【存档现状】清单，AI 编不出清单里没有的 id。
- **防抄旧卡**（参考插件踩过的坑）：历史消息喂回 AI 前一律 `stripProposalsForApi`，把卡片块换成「此处曾给出一张卡；现状以下方清单为准」。否则模型会照抄自己上一轮的卡片——而那些内容可能压根没被应用、或已被玩家改过。
- **与正文彻底隔离**：本窗对话永不进正文上下文，正文也不知道这里聊过什么；它只读存档现状。
- ⚠ **现状清单按世界过滤**：历条目走 `visibleIn(items, worldName)`，别的任务世界的节日不进参谋视野（否则它会据此讨论/出提案 → 跨世界串味）。任务与伏笔目前是全量——见下方「已知跨世界残留」。
- 接口：`resolveApiChain('advisor', 杂项接口)`——**留空即跟随杂项演化的接口**，不必另配一份；想分流可在面板 ⚙ 里选。
**🎭 小剧场·花样模板库**（设置→正文生成→API 配置→小剧场开关下方）：把「这一则该怎么写」从**写死在 `MINI_THEATER_RULE` 里的一行风格词**变成玩家可增删改的模板。
- 原状：15 个风格词硬编码在提示词里，改不了、加不了、只留爱看的那几种也做不到；而且只有词没有写法，模型每次自由发挥、越写越同质。现状：每条模板 = 花样名 + **一句具体写法指导**，生成时只从**启用的**里随机抽 `pickCount`（1~3，默认 2）条注入。
- 15 条内置（即原先那批）首次自动种入，可改可禁可删；删了点「恢复内置」按 id 补回，**玩家自建的不受影响**。内置只种一次——删掉的不会下次启动又冒出来。
- ⚠ **兜底**：模板被全部禁用或删空时 `pickTemplates` **回退内置全集**，绝不返回空清单，小剧场不会因为空指令写崩。
- 模板是玩家资产不是本档进度 → `theaterStore` 是**配置类**：进 saveManager 的 STORES 但**不给 clear**（新游戏保留），并进 `configExport`（随全局配置导出）。

**⭐ 坐标（收藏楼层）**：把鼠标移到任意一段 AI 正文上，右上角的 ☆ 一点就收藏；右侧导航「坐标」里搜索 / 按标签筛 / 写备注 / 跳回原楼 / 导出 Markdown。
- **存快照，不存指针**（核心设计）：收藏时把当时的正文**整段拷进来**。楼层日后被编辑、重生成、回退、被 `historyLimit` 挤出显示窗口、甚至切世界清空对话——收藏照样读得到原文。`msgId` 只用来「尽力跳回原楼」，跳不到就明说（不假装成功），退化成纯档案。
- **性能**：`BookmarkButton` 只订阅「本楼是否已收藏」这一个布尔值，App **完全不订阅** bookmarkStore → 收藏/取消只重渲那一颗星，不波及聊天列表（同 StoryStrip 的零订阅思路）。
- 上限 200 条（新挤旧）、单条快照 6000 字截断、标签去重限 8 个；正文长 → 走 `lzStorage` 压缩存。
- **作用域＝paradise**：跨世界全留着（回忆册本就该跨世界），收藏时连 `worldName/worldTime/turn` 一起存快照；面板顶部按世界筛（收藏跨过 2 个以上世界时才出现这排）。

**🌍 任务与伏笔的世界作用域**（2026-08-04 补齐，此前二者都会跨世界残留）：

- **任务＝物理封存**。`MiscTask.worldName` 建档时自动记（在乐园接的留空＝跨世界，永不封存）。离开该世界时 `freezeTasksOfWorld` 把它未结算的任务整体挪进 `miscStore.frozenTasks`；同名再入选「继承」→ `thawTasksOfWorld` 原样捞回（清 `frozenAt`）。两个调用点紧挨着 `freezeWorld`/`thawWorld` 放在 `App.enterWorld`。
  - ⚠ **为什么物理挪走而不是读时过滤**：`tasks` 的读取点散在正文注入 / 演化快照 / 面板 / 结算 / 参谋等十来处，靠每处记得加过滤条件**必然会漏**（本轮就先在历上漏过一次）。挪出数组 ⇒ 所有既有读取点自动生效、零遗漏。
  - ⚠ 封存 ≠ 删除（铁律「库房只存不删」）：📋任务面板有「🧊 已封存」区，可逐条「↩ 捞回」或整体清空。
  - ⚠ **不在 `worldScope.ts` 内部调**：miscStore 已 import 了 worldScope 的 `isHomeWorld/sameWorld`，反向再引就成 ESM 循环，故由调用点执行、结果回填 `FreezeReport.tasksFrozen`。
- **伏笔＝旁路索引 + 读时过滤**。伏笔表是 AI 原生填写的表，加列要动 acuTableSpec/ddl/迁移/提示词且多一个 AI 会填错的字段，故照 `chronicleStore.rowMeta` 的先例走旁路：`store/rowScopeStore.ts`（`drpg-row-scope`，key=`${uid}:${rowId}`，**必须带表前缀**否则跨表 row_id 撞车）在埋下那一刻记世界名。写入点两处：`applyTableEdits` 的 insertRow、以及提案卡的 `applyProposal`（那条是旁路，两样旁路记录都得补）。
  - 过滤走 `plotThreads.threadInCurrentWorld`，三个读取点同口径：`<伏笔催收>` / 楼层信息条伏笔段 / 参谋现状清单。
  - ⚠ 判定取向「宁可多显示，不可弄丢」：**无索引一律保留**（老存档历史行、玩家在表格管理里手动加的行都没索引）；乐园埋的线跨世界有效；人在乐园时不过滤。只有「明确记了别的任务世界」才滤掉。

- ⚠ **埋伏笔必须补记表编辑日志**：伏笔账龄（`plotThreads.lastTouchTurn`）只认 `tableJournal`，而日志平时由 `applyTableEdits` 写。提案卡走的是 `useTables.insertRow` 这条旁路，不补记的话「刚埋下的伏笔」查无记录＝判定为「久远」，下一回合就被 `<伏笔催收>` 当陈债催 AI 回收。

## 2. AI 多阶段流程 + 综合对账 + 阶段编排

**阶段**（除主叙事外都在正文完成后**并发**，`runPostNarrativePhases`）：① 主叙事→解析 `<state>`/`<upstore>` ② 物品管理 ③ 主角演化 ④ NPC 演化 ⑤ 生平压缩 ⑥ 杂项 ⑦ 领地 ⑧ 冒险团 ⑨ 万族 ⑩ 势力 ⑪ 叙事记忆回写 ⑫ 生图。物品管理**绝不 await NPC**（早期曾被慢NPC拖死=「物品管理失效」，已解耦）。

**综合对账纠错 `runMergedAuditPhase`**（物品+主角**合并一次**调用）：`Promise.allSettled([itemP, playerP]).then(...)`——两阶段都跑完只调一次 AI，看「应用后真实数据 + 最近两回合正文」逐项纠正遗漏/错误更新。两个 `auditEnabled` 开关（itemStore/playerStore）共用这一次：`checkPlayer`/`checkItems` 控制各段是否纳入，都关则不调。安全网：物品段硬过滤 createItem/货币（仅删/扣/穿脱）；主角段过滤 `charId==='B1'`；**NPC 物品只纠正 `npcTag∈{随从,宠物}`**。`MERGED_AUDIT_SYSTEM`/`MERGED_AUDIT_PROMPT`。

**NPC owner 解析器**（`stateParser.setNpcOwnerResolver`）：物品阶段常给 NPC 物品编幻觉 ID（C66）与登场判断的真实 ID（C1）对不上 → 解析器把未知/空壳 owner 重定向到真实 NPC（优先本回合 `npcPreferredOwners`，退化到最近更新的在场真实 NPC）。登场判断（快）通常先于物品阶段完成，故并发下 ID 仍映射正确。

**`applyAllUpdates` 顺序**：先应用 `<upstore>` 创建物品，再应用 `<state>`（含 `eq` 装备短指令），否则装备指令在物品尚未创建时失败。

## 3. 状态指令解析（`systems/stateParser.ts`）

**`lenientJsonParse`（防"指令解析失败"）**：AI 常把指令写成 JS 字面量——裸键（`{name:"…"}`）、单引号、尾随逗号。逐级放宽：标准 JSON → 给 `{`/`,` 后 ASCII 裸键补引号（正则只碰 ASCII 键，不误伤中文值里全角「：，」）→ 单引号转双引号 → 去尾逗号。所有命令解析器统一用它。

**`<state>` 块**（逐行 `key = / +=` ）：内置玩家 key（hp/maxHp/mp/maxMp/san/maxSan/points/atk/def）；角色资源短指令 `hp.B1 -= 20`/`mp.C1 = 35`（路由玩家/NPC）；货币 `乐园币 += 100`/`currency.魂币 -= 10`（⚠ parseLine 的 key 正则是 ASCII \w 认不出中文键——中文币名行由 `stateApply.scanCjkCurrencyUpdates` 只扫 `<state>` 块补合成 StateUpdate，08-03 前这条通道整个空转；结算回合再经 `reconcileSettlementCurrency` 忠于「获得货币」面板并在无指令幸存时补入账）；装备 `eq.B1 = weapon:main:I_B1_01|主武器`/`uneq.B1 = …`（物品不在背包时 `equipNpcItemFallback`/`unequipNpcItemFallback` 在 NPC 持有物里就地装卸）；`cr./pr./ca./character.*/npc./loc./tm./ap./rc.` 等前缀按功能解析或静默跳过。其余 key 从 `variableStore` 查。

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

**同名堆叠+防重复（六层）**：① 数据层 `addItem`/`addNpcItem` 对可堆叠类(`isStackableCat`,非装备)未装备同名同品质累加数量；② 每回合 `dedupeByName`/`dedupeNpcItems` 合并；③ 提示词注入 `${player_items}`+`${npc_items}` 要求别重复 createItem；④ 对账合并（注入最近两回合正文，相似名同一物 → destroy 多余，保守/保完整那条）；⑤ **延后建物对账的补建前置判定** `deferredCreateSkipReason`（stateParser）；⑥ **空壳重复清理** `pruneBlankDupItems`（itemWatchdog）。

**「同一件物品两条：一条有详细信息、一条只有名字」的根治（⑤⑥）**：正文的 `createItem` 被 `deferItemCreate` 摘走交物品阶段独占建，阶段落地的那件**通常被润色过**（补前缀"暗金·"、品级"精良"→"绿色"、换分类），于是 `reconcileDeferredCreates` 回头补建时，创建闸门的严格判重（`findIdenticalItem`＝同名 + 品级互相包含）判不出重复 → 按正文原指令又建一条**只有名字/分类/品级的空壳**。
- ⑤ 源头：补建前先过 `deferredCreateSkipReason` 三道 —— **设施已发放物**(开箱/合成的 `suppressCreateNames`,此前只在正文侧生效、补建路径整个绕过了它) / **账本**(`itemPhaseRefsOfTurn`：本回合 item-phase 已 create/入账/改数量过同名引用；**货币伪物品靠这道防重复发钱**) / **唯一物已在玩家或任一 NPC 身上**（同 `itemWatchdog.existsSomewhere` 口径·防刷）。可堆叠物**不走**第三道（靠数量累加，误判会吞掉这次真捡到的数量）；同名判定用保守版 `looseSameName`（全等/包含/核心名相等，**不做 bigram 相似度猜测**——补建路径误判＝物品凭空少一件）。
- ⑥ 收口：回合末 `pruneBlankDupItems` 把漏进来的、以及老存档里已躺着的空壳并进完整那条（字段回填 + 可堆叠累加数量）。苛刻到只动"空壳方**一条实质细节都没有**(攻防/词缀/评分/简介/需求/耐久/强化/宝石全空) + 留下方**至少两条** + 两者都未装备未锁定"的组合——同名两件真装备是合法独立实例，悄悄吞掉一件就是老病根「经常丢装备」。

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

**🕸 关系图谱**（`systems/relationGraph.ts` 数据层 + `components/RelationGraph.tsx` 纯 SVG 渲染，零第三方图库=包体与许可证都干净）。数据源就是既有的 `relations`(列13) 扁平串，**存储格式一个字没改**——AI 演化写的 `C2:宿敌` 与轨道A `addRelation` 写的 `张三:盟友` 两种写法都解析；认不出的短名保留成**悬空 ghost 节点**（角色可能已死/被并档，仍是叙事线索），像句子的长目标（>12字）丢弃。`|好感|≥60` 额外连一条虚线**好感边**（全量连成星形只会糊成一团）。关系词按关键词归六类着色（宿敌/盟友/情缘/亲缘/主从/其他，**顺序即优先级**：含「敌」最先、同门先于师徒、「爱徒」不被亲缘的「弟」抢走）；双向关系词不一致时取更强的一类。布局＝确定性 Fruchterman-Reingold，**种子来自节点 id 集合**→同一批角色两次打开不跳位；`centerId` 钉画布中心（缺省主角）。两个入口：① `NpcPanel` 头部「🕸 图谱」→ 全局弹窗（好感边/只看在场/含宠物/含孤立 四开关）② `NpcDetail` 关系页顶部 **ego 局部图**（以该角色为中心 1~2 跳，Obsidian local graph 范式；保留入选点**彼此**的边，那才是"我的圈子里谁跟谁有关系"）。交互：滚轮/双指缩放、拖拽平移、悬停高亮邻居、点真实角色跳其档案。⚠ 宠物/召唤物默认排除（只连主人，画进来全是毛刺），ego 图里例外纳入。

**📖 成长小传（`lifeStory`）**：治"背景只有一句话、AI 每次按刻板印象重新脑补这个人的过去"。与 `background`(列10) **分工明确**——列10 是每回合注入正文的一句话简介；小传是 400~700 字一次性长文，**绝不进每回合注入**（演化只注一行"已生成 N 字·勿重写"标记），全文只在 NPC 私聊(`npcChat`)、详情页、手动补写时取用。结构＝出身与童年 → 2~3 件有代价的转折 → 明写"所以 TA 成了现在这样"（已有性格是**结论不许改写**，只补通向它的路）→ 与当下动机的连接。硬约束：忠于既有档案、**不许发明数值/等级/天赋/势力**、契约者写被选中之前的人生、土著不知乐园、用乐园术语不回流修仙词。生成走**与自述同一套门控三件套**（规则常量→`<小传 id="C1">` 块→"已生成"标记），但**错开一回合**触发（等自述/原则/台词那批写完下次再要，免得一次回复里塞四个长块）。玩家侧：详情页「经历」栏 `LifeStoryBox` 可展开/编辑/♻重写(二次确认)，空时「✍ 补写小传」即时单发生成（`systems/npcLifeStory.ts`，走 `resolveApiChain('npc')`）。规则已进预设中心可玩家改（`NPC_LIFE_STORY_RULE`）。

## 7. 势力 / 领地 / 冒险团 / 万族 演化

**势力**（仿 NPC）：`factionStore`(`drpg-faction`) `FactionRecord`(`inCurrentWorld`=当前世界活跃,类比在场)。`factionEvoStore`(`drpg-faction-evo`,A/B策略,`offWorldQuota`,独立API)。指令 `addFaction("F1",{命名键})/deFaction` + 短指令 `faction.F1.favorToPlayer+=N`/`inCurrentWorld=true` + `addDeed("F1")`。两策略 `runFactionWorldJudgment`(当前世界判断)+`runFactionFocusEvolution`(逐势力)。UI 🏛势力→`FactionPanel`(当前世界/非当前/已覆灭);设置→🏛势力演化→`FactionManager`。预设 `预设/势力演化.json`(双区)。**换世界清理**：`FACTION_FULL_FORMAT_RULE` 强制每次填全字段尤其 worldName(缺失=换世界后旧势力出不去的根因);`enterWorld` 兜底把 worldName 不属新世界的势力 `setWorld(false)`;`FACTION_HOME_EXIT_RULE`/`reconcileHomeWorld`(回归乐园移出任务世界势力)。

**领地**（主神空间个人基地·单一记录,跨世界保留,无防御绝对安全）：`territoryStore`(`drpg-territory`,数据+设置+API 合一)。`unlocked`/`name`(读正文称呼,不硬编默认名)/`level`(走阶位 `realmFromLevel`)/`buildProgress`(0~100满升级)/`effects`/`appearance`/`passiveOutput`/`members`(C-id)/`buildings`(全自定义,`buildingCap=level+2`,单栋≤5级)/`storageItems`。建设进度三来源(建筑/成员质量/投入资源,`territory.progress+=N`)。指令 `unlockTerritory/setTerritory/addBuilding/upgradeBuilding/deBuilding/addTerritoryEffect/addMember/storeItem/takeItem`(`applyTerritoryCommands`)+短指令 `territory.progress+=N`/`level=N`。被动产出落仓库 storeItem、货币走 transferSpiritStones(故领地阶段也跑 applyItemCommands)。UI 🏯领地→`TerritoryPanel`。预设 `src/data/territoryDefaultPreset.json`(8条)。

**冒险团**（仅主角单一团,其他冒险团归势力）：`adventureTeamStore`(`drpg-team`,数据+设置+API)。established/disbanded/name/rank(E~SSS)/teamExp(0~100晋级主轴)/activity(0~100每回合-2)/members(C-id,主角B1=团长)/perks/deeds/assessment。`memberCap=3+idx`/`ACTIVITY_GATE=60`。双计量晋级(`addExp`)：满100时 E→A 且 activity≥60 自动;→S/SS/SSS 触发考核(不自动)。考核(建团+大阶位,纯剧情)：`establish`/`startAssessment`/`resolveAssessment('pass'|'fail'|'disband')`。仅正文明确建团才 `establishTeam`。指令 `establishTeam/addTeamMember/removeTeamMember/addTeamPerk/startAssessment/resolveAssessment`(`applyTeamCommands`,注意成员 store action 是 `upsertMember`)+短指令 `team.exp+=N`/`activity+=/-=N`/`rank="S"`。UI 🛡冒险团→`AdventureTeamPanel`（两 tab：🛡团队 / ⚔派遣）。预设 `src/data/teamDefaultPreset.json`(6条)。
> ⚠ **本文档旧版称「activity 每回合 -2、`callApi` 开头 `decayActivity()`」——代码里没有这个函数**（2026-07-25 全仓 grep 零命中）。实际活跃度只会因 AI 的 `team.activity+=N`、考核失败 -20、以及**派遣归来**变动。要不要加回自然衰减是个待定的平衡问题，别当既成事实。

### 7b. 冒险团派遣（⚔ 离线委托·倒数封条）

派已建档的团队成员去打限时委托，到点归来出战报+战利品，疲劳/伤势强制轮换。参考 FF14 冒险者小队 / Battle Brothers。落点是补上冒险团的空洞：**活跃度此前没有任何玩家杠杆**，派遣就是那个杠杆。

**三条铁则**（改动前先读 `systems/dispatchEngine.ts` 文件头）：
1. **封条**：`DispatchRecord.ledger` 在倒数走完前**在数据里不存在**（不是 UI 藏起来）。到点由 `runDispatchTick` 一次性算出并封存 → 翻 store / 改 localStorage 都偷看不到。实机验证过：出发后 raw `drpg-team` 里 `dispatchActive.ledger` 是 `undefined`。
2. **结算前端算死、AI 只写散文**：账本（评级 E~SSS / 伤亡 / 战利品 / 货币）由 `settleDispatch` 确定性生成；`dispatchReport.ts` 把这份锁死的账本喂给 AI 让它叙述。让 AI 同时决定"打赢没"和"掉了什么"＝每次派遣都通胀（同 bioStrength 机械判定的由来）。战报框里明写「数值已在归来时定死，重写战报不会改动它们」。
3. **不开成长/致死后门**：战利品走轨道A 的 `makeEquipItem` + `autoGearFull`（**同一条 8 件上限**，两边同标 `acquisition='离场历练所得'`）；陨落走同一个 `settings.npcAutonomyDeath` 开关 + `isProtected`（好友/羁绊/永久保留/临时队友）。**主角 B1 永不出勤**（人在正文里，也避开"主角数值在正文外被改"的铁律）。

**时间口径**：倒数用**回合**不用挂钟（全局时钟就是回合；挂钟招读档刷时间）。记的是**绝对回合 `endTurn`**、不逐回合自减——漏跑一回合不会卡死，回退时间自然延长。`paradiseTime` 只作战报里的"历时"风味。

**与轨道A 的分流**（⚠ 头号 bug 风险）：分流从两方变三方——在场→演化AI / **派遣中→派遣引擎** / 其余离场→轨道A。`runNpcAutonomy` 里用 `dispatchActive.memberIds` 这份唯一真相排除；派遣记录一丢，人自动回落轨道A，**自愈**（所以刻意**不**新增 `auto.phase='dispatch'`，那样记录丢了人会永远卡在"任务中"）。心跳排在 `runNpcAutonomy` **之后**，这样归来当回合不会既写"委托归来"又写一条 hub 行动。

**委托板·两条来源**
- **自动（默认·零 token）**：`rollOfferBoard` 按 `seedFrom(floor(turn/BOARD_REFRESH))` 播种，从轨道A 语料库的 `banks.worldTheme`（98 条）× 12 类委托组合而成。阶位成梯度（低阵容 1 阶 → 持平 → 高 1 → 高 2，最后一条永远是"够一够"）。`BOARD_SIZE=4`、`BOARD_REFRESH=6` 回合换批。**`ensureBoard` 在面板打开时也调**——委托板是派生数据，不该"必须先走一个回合才有得看"（实机踩过这个空板）。
- **AI 生成（手动·`systems/dispatchGen.ts`）**：面板「🔮 AI 生成委托」按钮是**唯一触发点，没有任何自动调用**。读主角档案（阶位/身份/职业/生物强度/所在世界/双时间）+ 冒险团现状（阶位/双计量/团队效果）+ **每个可派遣成员的完整档案**（阶位/职业/战斗原型/战力档/疲劳/性格/关系网），让 AI 出四条贴着这支队伍写的委托，带 雇主/背景简报/目标/已知风险。走 `resolveApiChain('dispatch')`。
  - **联网搜索**（`dispatchWebSearch`，默认关）：开了才给 Gemini 原生 `extra:{tools:[{google_search:{}}]}`（同混沌世界/登场判断那条 extra 通道）——同人世界据原作真实设定出委托。关着就凭模型已有认知，提示词里明禁"声称已联网核实"。
  - ⚠ **AI 板永不自动换批**：`boardSource==='ai'` 时 `ensureBoard` 直接让开。玩家花 token 换来的委托（还带着看得见的奖励物品）绝不能被免费的自动委托悄悄顶掉——这也是"手动生成，不要自动生成"的字面落实。要换只能再点一次生成、或点「换回自动」。

**委托奖励物品**（AI 委托专有，`DispatchOffer.reward`）
- **接单前就看得见**：委托卡上直接摊开整件物品（点「🎁 达成酬劳」展开全字段），这才是选这条委托的理由。
- **字段照物品演化的固定格式全填**：注入 `ITEM_FIXED_FORMAT_RULE`（含词缀/效果/数值三分铁则）+ `ITEM_GRADE_TABLE_RULE` + `EQUIP_CODEX`，与开箱/合成/福袋同一套。name/category/subType/origin/combatStat/durability/requirement/attrBonus/score/affix/effect/activeEffect/intro/**appearance**(生图唯一依据·必填)/killCount/quantity/tags。
- ⚠ **品级前端锁死**：`gradeForTier(tier)` 按委托阶位定档（吃【世界阶·装备品质上限】那张表：1阶≤紫/2≤暗紫/3≤淡金/4≤金/5≤暗金/6≤传说/7≤史诗/8≤圣灵/9≤不朽，45% 顶格 55% 下浮一档），锁死后喂给 AI，**AI 写什么品级都不采信**——照搬开箱的做法，结构上杜绝越级爆品。category 非法则回落「特殊物品」。
- **达成才发**（评级非 E/D），失利不发，面板与战报都写明。发放走 `useItems.addItem` 直投（前端权威，不是正文指令），`attrBonus` 并进 `effect`（否则 effectiveAttrs 读不到＝死数据），随后 `pushFacilityGranted` + `pushSceneNotice`——**不这么做物品演化阶段会把同一件再 createItem 一遍、正文也可能改写它的名称效果**。

**提示词可编辑**：`DISPATCH_GEN_RULE` / `DISPATCH_REPORT_RULE` 在 `systems/dispatchPrompts.ts`（单独成文件是为了断环：promptRegistry 要 import 它们，两个消费者又要 import `getPrompt`），已注册进「预设中心」→ 玩法设施。

**胜算评估**（`estimateDispatch`，面板与结算同一套算法，逐项拆解可见）：战力 `top*0.6+avg*0.4` vs 委托阶 ×12 / 缺人 -15 每人 / 原型对口 +10~14 不对口 -6 / 平均疲劳 -fat÷10 / **队内宿敌 -10、盟友 +6**（白嫖轨道A 后台织的 `relations` 图）/ 团阶 +2 每档 → 0~100 分。结算 = 分数 ±15 随机 → `ratingOf`。

**强制轮换**：`FATIGUE_GATE=70` 不可出勤、`FATIGUE_DECAY=6`/回合（出勤中不恢复）；坏结算 + 危险度掷骰 → 伤势 3~6 回合（期间不可出勤）。E 阶团只有 3 名额 → 两趟就得换人，板凳深度成真需求。

## 酒馆美化适配（渲染层·参考 SillyTavern，2026-08-07）

**背景**：ST 美化包（楼内 HTML/CSS 卡、全局自定义 CSS、思维链美化、前端卡）此前全不可用；且旧管线对含标签行**裸透传**（零消毒零作用域，多行 `<style>` 被打碎、块内被 join 插 `<br>`）。四层方案全部落地：

1. **楼内 HTML/CSS**（`systems/htmlSanitize.ts` + `narrativeHtml.ts`）：`<style>` 整块抽取 → `scopeCss` 给每条选择器强制加 `.narrative-content` 前缀（ST 锁 `.mes_text` 同款；`body/html/:root` 视为容器本身、@media/@supports 递归、@keyframes/@font-face 保留、@import/未知 at 丢弃）→ 消毒还原；HTML 块按嵌套深度**整块吃**、块内 `\n` 拼接（修复 `<br>` 打碎表格/卡片）；整块过 **DOMPurify**（禁 script/事件属性/javascript:；`htmlExternalMedia` 开关管外链 img/css url()，默认允许）。流式未闭合 `<style>` 截断+「🎨 样式加载中」占位；scopeCss 为手写解析器（引号/括号/嵌套感知·node 可单测）+LRU；外链开关进 `toHtmlWithImagesCached` 签名。**消毒无条件**（顺手堵掉旧裸透传的 XSS 面）。
2. **思维链折叠**（`thinkDisplay: hidden|fold|open`，默认 fold）：`splitThinkStream`（流式二分·思考实时直播进折叠块）+ `extractLeakedThinking`（结算定稿·**严格镜像 stripLeakedThinking 口径**——strip 不删的 extract 也不抓，防同段字双显）→ 楼层 `msg.think`（随 chatDb 整对象持久化）；MessageRow 渲染 ST 同构 DOM（`mes_reasoning_details/summary/header_title` + `.mes_reasoning`，React 文本渲染天然转义）；思考中自动展开、正文出现自动收起。⚠ think 只进显示层：提示词历史/演化/小说导出照旧用剥净的 content。hidden=旧行为（💭 占位）。
3. **全局自定义 CSS**（设置→界面外观美化）：`customCss{text, scope:'chat'|'global', enabled}`；`<CustomCssStyle/>` 自订阅（App 零新增订阅·主返回+设置早退分支都挂）维护 `<style id="drpg-custom-css">`（textContent 注入，字面 `</style>` 无法逃逸）；scope=chat 整段 scopeCss 前缀 `#chat`。可导入 ST 主题 `.json`（`custom_css` + 颜色字段→生成 `--SmartTheme*` :root 覆盖块）或纯 `.css`。**ST 兼容锚点**：`#chat`（消息滚动容器）/`.mes`+`is_user` 属性/`.mes_block`/`.mes_text`/`.last_mes`（纯挂名零样式）；`:root` 内置 `--SmartTheme*` 映射 `--c-*`（随主题/护眼自动联动）。
4. **前端卡沙箱**（`renderHtmlSandbox`，默认关）：```` ```html ````围栏/完整 HTML 文档（`extractHtmlFences`，只认**闭合**围栏）→ `<HtmlSandbox/>`（模块级 memo）sandbox iframe（`allow-scripts` **无 same-origin**：脚本全量可跑、摸不到宿主 DOM/localStorage/store）；srcdoc 注入 ResizeObserver 上报高度（postMessage 只认本 iframe 来源+60~2000 夹取）。围栏在 MessageRow 层抽出、iframe 渲染在 innerHTML **之外** → 流式每帧重渲不重建 iframe（防 reload 风暴），无需感知流式状态。

**共存铁则**：三重隔离——楼内 style 作用域化 / 全局 CSS 默认限 `#chat`（global 需显式选择）/ JS 关 iframe；主 React 壳永不被隐式命中，出问题「清空/停用」即刻还原。测试：`htmlSanitize.test.ts`（scopeCss/抽取/管线 e2e）+ `thinkSplit.test.ts`（流式二分/结算镜像口径）。

**奖励**（刻意压在「任务每环基础给量」之下，派遣是可重复被动收入）：货币严格按既定门槛——**≤三阶发乐园币**（250/700/1800 基数）、**≥四阶发魂币**（1/2/3/6/12/25），按评级 ×0~2 缩放，绝不混发。teamExp 0~20 + 阶位加成；activity 出勤 +10、成功再 +8。战利品仅 S 及以上、只落一名生还者。

**独立 API**：战报走 `resolveApiChain('dispatch', legacy)`（legacy=`dispatchApi`/`dispatchUseSharedApi`）。**不是每回合的演化阶段**——一次派遣归来才调一次，token 随派遣次数走。没接口/失败 → 回落 `fallbackReport` 确定性纪要（轨道A「活着不花钱」的承诺不破）。设置在 变量管理→🛡冒险团演化→⚡API 设置（含「归来时自动生成战报」开关）；`apiSlots` 里标「派遣战报·独立接口」。

**存档**：全部住 `adventureTeamStore`（`drpg-team` 已在 saveManager + `clearTeam` 清），零存档管线改动。`configExport` 靠 `*Api` 模式自动覆盖 `dispatchApi`。

**未做**：主角加入他人团时反向派遣（团长派你出任务→流进 miscStore 成任务钩子，同结构反方向）；多支队伍同时出勤（store 刻意单团）。

**万族演化**（cosmosStore,宇宙背景层七乐园/万族/深渊,头顶自转）：三子模式+独立API+判词注入。`runCosmosEvolutionPhase`/`buildCosmosInjection`(<万族态势>独立于叙事记忆开关)。详见记忆 `cosmos-evolution-feature`。

## 8. 杂项演化 / 生平压缩

**杂项**（`miscStore`+`miscParser`+`runMiscEvolutionPhase`,并发阶段,只读正文只写变量）：分段总结 `addSmallSummary/addLargeSummary`、世界大事 `addWorldEvent`、天气、契约者人口、truths、canon*、**双时间**（`paradiseTime` 轮回历X年X月X日 + `worldTime` 任务世界时间 + `worldName`）。**⚠任务已拆出**(2026-07)：主角任务(`T_<数字>`)的演化归独立「任务演化」阶段(见下),杂项解析用 `applyMiscCommands({domain:'world'})` 硬过滤任务指令+`MISC_NO_TASK_RULE` 提示词禁写;misc-codex 只注世界侧条目(①⑤⑥⑦⑧)。**回归乐园兜底**(`isHomeWorld`/`reconcileHomeWorld` 每回合开头)：worldName 命中 主神空间/专属房间/轮回乐园 → worldTime 同步 paradiseTime + 旧任务世界势力移出当前世界。`MISC_HOME_TIME_RULE`+`FACTION_HOME_EXIT_RULE` 双保险(已写入预设)。预设条目化 `settings.entries`(默认 `src/data/miscDefaultPreset.json` **v4 8条**,任务条目已剔,导入导出;每刷新强制覆盖为内置)。入口 🧩杂项演化→`MiscManager`;📋任务→`MiscPanel`。⚠纪元名是「轮回历」(曾误「轮回力」)。

**任务演化**（独立阶段,2026-07 从杂项拆出）：`runQuestEvolutionPhase`(App.tsx)——主角任务 `T_` 的新建/推进/进度/结算专职阶段。**独立 API** `resolveApiChain('quest', legacy)`,legacy=`miscStore.questApi`/`questUseSharedApi`;**独立开关** `miscStore.settings.questEnabled`(persist merge 迁移:旧档缺省继承 `enabled`,行为无缝)。规则链全代码注入：`QUEST_PHASE_FORMAT_RULE`(身份+指令定义+ID/时间纪律+输出格式)+TASK_SYSTEM_ROLE/OUTCOME/SOURCE/PROGRESS/CANON+QUEST_PLANNING/KILL_TIER/RATING/HOME_NO_GEN+ADVANCED_TASK_PROTOCOL+TASK_RECONCILE+`TASK_DETAIL_QUALITY_RULE`(原预设质量边界迁入)+misc-codex 任务条目(②③④按 comment 筛)+`worldLoreTaskInjection`+canon剧本参照(只读,canon* 指令仍归杂项)+`QUEST_COT_RULE`(<quest_cot>)。进入新世界检测(`prevWorldNameRef`)/`markWorldSettled` 边界戳/worldTier 锁定随任务职责迁到本阶段(杂项保留幂等补锁)。解析 `applyMiscCommands({domain:'tasks'})` 只应用任务四类指令;任务数据仍存 miscStore(面板/结算/正文注入不变)。手动生成主线 `manualGenTask` 同走 quest 接口。UI：变量管理→🎯任务演化→`QuestManager`(启用/任务注入正文/任务闸门/API,原 MiscManager 两区块迁入);演化调度加 `quest` 行;♻重算变量加「任务演化」项。

**生平压缩**（`memoryStore`+`characterStore.memory`）：逐角色 `memory.shortTerm/longTerm`(`MemoryEntry{time,location,content}`)。`addMemory("B1"/"C1",{...})` 追加 shortTerm;达阈值(短25→5、长50→20,可调)`runMemoryCompressionPhase` 调 AI 压缩(轮回乐园档案官提示词,不可逆事实自检)。入口 📜生平压缩→`MemoryManager`(独立API)。

## 9. 叙事记忆 + 结构化召回 + 向量资料库

**叙事记忆**（`settingsStore.narrativeMemory`+`systems/narrativeMemory.ts`,默认关）：① 关键词召回——当前输入+上条正文 `tokenize`(中文2-gram)→在 facts(narrativeFacts/小总结/大总结/世界大事)按命中取 TopK→拼 `<相关记忆>`,启用时替换 historyLimit 切片。② LLM 两步法——发送前 `narrativeCompile`(LLM 改写检索关键词,找"相关"非"最新")+回复后 `runNarrativeIngestPhase`(LLM 抽长期事实存 `miscStore.narrativeFacts`,max300)。独立 `nmApi`,可分别选 compile/ingest 模型。入口 设置→🧠叙事记忆;🧠记忆→`SummaryPanel`。

**结构化档案召回**（`systems/structuredRecall.ts`+`buildStructuredRecall`,默认开）：解决主正文 API 读不到结构化数据——把主角(必含)+预测/在场 NPC 完整档案序列化成 `<在场与相关档案>` system 块注入正文。NPC 选择：开 LLM 两步法时 `narrativeSelectChars` 预测下回合登场 → 否则 `rankNpcsLocal` 兜底。当前世界势力 `serializeFactionsSection`(全量,限 `structMaxFactions` 默认4)。限量(叙事记忆设置页)：`structMaxNpcs`默认2(选中NPC给全量,不截断)、`structMaxSkills`/`structMaxItems` 仅主角。主角装备精简注入 `playerItemLine`(仅 名称/强化+N/类型/品级/killCount/affix/镶嵌宝石/套装部件/effect)。**套装加成栏**(`setDetailLines`)：宝石套装(`gemSetDetailLines`)+锻造装备套装(`equipSetDetailLines`)按件数已激活的各档 bonus 原文成块注入,并提示下一档还差几件;同时套装六维经 `setBonus.setAttrEntries` 并进注入的实战六维(与属性面板 / 战斗 `buildCombatant` / NpcDetail **四处同口径**,见 `systems/setBonus.ts`)——此前**只注入每颗宝石写进 effect 的【镶嵌加成】、套装档从不注入且六维漏算**,AI 把套装当不存在。NPC 卡同样处理（NPC 也能镶宝石成套/拿到锻造套装部件：`NpcOwnedItem` 已补 `equipSet`/`gemSet` 字段,主角⇄NPC 转移(`itemTransfer`)与私信交易(`dmTrade`)都带着强化/镶嵌/套装归属过户,NPC 详情页也多了「套装加成」栏）。冒险团已建立只注入 等级/成员/团队效果。临时队伍注入「【主角的临时队伍】」段。

**向量资料库**（原著当世界书,`store/novelVecStore.ts`+`systems/novelVec.ts`+`NovelVecManager`,默认关）：**双索引**——小说全本(`public/novel-vectors/`)+世界书 `______.json`(`public/worldbook-vectors/`)预建 bge-m3 向量内置前端,运行时查询 embed 一次→在两个库各 cosine→合并 topK→注入 worldInfoText(标 `〔原著·第X章〕`/`〔世界书·猎杀者〕`)。int8 量化(单位归一化×127),cosine=(q·int8)/127。IndexedDB `drpg-novelvec` v2(多源,chunk 键 `<name>#<id>`)。`gunzipJson` 魔数检测(Vite dev 透明解压 .gz → 直接 parse)。建库 `tools/build-novel-vectors.mjs`(`npm run build-vectors` 小说 / `build-vectors-wb` 世界书)。查询 embed 与叙事记忆同句可合并只调一次。详见记忆 `novel-vector-ragbook`。

## 10. 中心 API 库 + 多接口路由

`settingsStore.apiLibrary: ApiEndpoint[]`(增删改启停排序,Key 仅本地)+`apiRoutes: Record<featureKey,string[]>`(有序 endpoint id,上=先调)。`resolveApiChain(key,legacy): ApiConfig[]`——路由有启用接口则返回链,否则回退 legacy 单配置。调用器 `apiChatFallback(chain,messages,{timeoutMs,extra})` 逐个尝试失败切下一条;主正文 callApi 内置同款流式 fallback 循环。featureKey：text/world/item/player/npc/faction/territory/team/misc/quest/memory/nm/image_story_llm/channel。各功能 ApiSection 用 `ApiRoutePicker`(多选+排序)。⚠ 世界选择(world)曾漏接,`WorldSelector.generate()` 早期裸 fetch,已改 `resolveApiChain('world',api)`。维护入口：综合设置→「API 接口库」。

## 11. 生图系统（三条线）

多服务(NAI/OpenAI/Gemini/ComfyUI/自定义),三条独立线各选服务+模板+自动开关。入口 综合设置→🖼生图设置→`ImageGenManager`(4子页)。生成器 `systems/imageGen.ts` `generateImage(service,{prompt,negative,size,signal})→dataURL`：`genNai`(返回ZIP,`extractImageFromZip` 解 stored/deflate+PNG兜底,v4 用 `v4_prompt`,画师串追加)/`genOpenAI`(/images/generations,共用 OpenAI/Gemini/自定义)/`genComfy`(注入 seed→/prompt→轮询/history→/view)。

**三预留框+手动✨生成**：NPC 肖像→`NpcRecord.avatar`(`AvatarBlock`)、主角立绘→`PlayerProfile.avatar`(`PlayerAvatar`)、装备图→`InventoryItem.image`/`NpcOwnedItem.image`(`npcStore.updateNpcItem`)。**自动阶段**(`runPostNarrativePhases` 末尾,各开关门控,延后6秒等演化写档,串行避免打爆NAI)：`runPortraitPhase`(autoPortrait,外观变化自动重绘 `refreshOnLook` 默认true,主角 appearance 文字变也触发 `forceRetag`)/`runEquipImagePhase`(autoEquip,`buildEquipPrompt` 用可编辑 `equipTemplate`)/`runStoryImagePhase`(autoStory,正文配图,独立LLM `image_story_llm` 跑 `storyTemplate`→`<image>` 块→存 `ChatMessage.images[]`,渲染 `toHtmlWithImages` 在 anchor 命中插 `<img class="story-illust">`)。

**肖像 tags(列19,仅角色)**：英文 danbooru tags 演化生成,存 `imageTags`,`buildPortraitPrompt` 优先用。`IMAGE_TAGS_RULE`(主角+NPC演化,英文/性别开头/仅长期外观变化更新/勿修仙词/同人角色准确 danbooru 名+作品+经典外观)。

**图片存 IndexedDB `drpg-images`**(非 localStorage,会爆5MB)：`systems/imageDb.ts`(键 player/npc:<id>/item:<itemId>/npcitem:<owner>:<itemId>)+`imageSync.ts`(订阅 store 镜像+`hydrateImages` 回填迁移+`snapshotImages` 供存档)。各 store 用 partialize 排除图片出 localStorage。`imageTags`(小文本)仍随 drpg-*。`ChatMessage.images` 随 chatDb。状态栏 `imagePhaseLog`。详见记忆 `image-gen-feature`。

### 11.5 📖 漫画工坊（楼层→分镜→并发绘画·工作流思想借鉴 comic-orb·代码提示词全自写）

入口 生图设置→「漫画」Tab(`ComicTabPage`)。流程：选楼层范围(默认最近3层AI楼) → `toProse` 剥游戏数据 + 角色档案外观 roster(主角+正文点名NPC≤8,结构化字段直注,不让AI猜外观) → 分镜 LLM(`resolveApiChain('comic_storyboard_llm')`,留空回退正文API,`COMIC_STORYBOARD_RULE`)出严格 JSON `zs_comic_v1`{title/style/characters[外观锁]/pages[{page,goal,panels,prompt}]} → 每页 prompt **完全自包含**(并发绘画的前提) → 并发错峰(staggerMs 默认1.5s)调 `generateImage`(每页拼 画风+出场角色外观锁+参考图映射+`COMIC_DRAW_GUARD`) → 成功页**立即**落 IndexedDB。

- **单页失败不拖累**：Promise.allSettled,失败只标记该页,库里「🩹补齐缺页」只画缺的;「🎨重绘本页」复用存储的 `finalPrompt` 原位覆盖;「📋查看提示词」。
- **漫画库=库房**(`drpg-comics` 独立 IndexedDB,batches+pages)：**不进 saveManager 快照**(整页1~3MB×N会撑爆存档),清进度不清漫画,删除=玩家显式二次确认。设置在 `comicStore`(drpg-comic,配置类,进 saveManager STORES 保留 + configExport)。
- **参考图锁长相**：`sendCharRefs` 开时把出场角色 avatar(≤4张)发给绘画模型——**仅 `chatimg`(多模态Chat出图)服务生效**,prompt 里给「参考图N=角色名」映射。新服务 `chatimg`=chat/completions 多模态(nano-banana系/OpenRouter/中转),`genChatImg` 兼容五种响应形状提图(message.images/parts/dataURL/markdown链/images API形状),配置复用 `OpenAIImgConfig`(生图API配置里选「多模态Chat出图」)。
- **送审软化** `soften`(默认开,`COMIC_SOFTEN_RULE`)：直白亲密/血腥→含蓄画面语言,只软化画面表达不改剧情事实,防 Gemini 系拒绘;NAI 线可关。
- 任务后台跑(`useComicJob` 运行时进度,关面板不中断);「取消」AbortController 中断各阶段。正文超4万字截断保尾。
- **完整复刻 comic-orb（已获授权·08-04）**：①**双工作流**——直接分镜(1~4页一次直出)/演绎分镜(长剧情:演绎LLM切1-20段·entity_bible跨段共享→**错峰并发分镜**(400ms间隔·首段失败中止余段省钱)→合并重编页码);总页数2-20+每段页数规格("2"/"1-2"),`assertPageAllocation` 提前拦无解组合。②**完整分镜协议** comic_orb_storyboard_v1(panels数组/dialogue+visual_anchor证据/continuity_in-out/climax_panel/appearance_lock/entity_bible)+运行时守卫块(校验范围/对白证据/本地化/色彩/实体/外貌保真)。③**安全三档** off(NAI线不转换)/soft(少年漫软适配:保留战斗张力暧昧台词只转真越界局部·含权力胁迫最低限度转换)/safe(安全适配成功率优先:命中特写→轨迹烟尘结果证据+最终复核pass+绘画安全前缀)。④**运输副本处理**(comicTransport.ts):措辞中性化(罩杯/凝视修辞/猎奇伤害→中性等价)+年龄学龄剔除(配合成人身份约束)——**只改请求副本,正文原文不动**。⑤可恢复错误(429/5xx/超时/网络)自动重试1次(演绎/分镜/每页绘画)。⑥**写回楼层**:全页成功且开关开→CustomEvent `zs-comic-insert`→App 追加进目标楼层 ChatMessage.images(anchor空=正文末尾,随 chatDb 持久)。⑦**重新分镜**(按当前设置重跑同批楼层+全页重画)+**单页重绘版本管理**(旧版进 versions cap3·阅读器↺循环切换)。**未复刻(有意)**:原作画风分析子系统(zhushen画风由玩家画风系统管)/Gemini官方分辨率表(中转普遍自适应)/服务端插件(纯前端无Node后端,长请求靠重试+补齐缺页兜底)。
- **NAI/ComfyUI 标签线双路**(`isTagService` 分流):标签模型画不了多格+对白→降级为**每页一张关键画面插画**——分镜系统提示词追加 `COMIC_TAGS_RULE`,要求每页多给 `tags` 字段(25~40 个英文 danbooru,并入角色画像锚点锁长相,禁分格/文字类标签);绘画阶段直接用 tags(不拼中文守卫/不发参考图,负面用 `cs.negative`,NAI 自动套画师串+队列限速,尺寸留空用 NAI 配置宽高);tags 缺失兜底=出场角色画像锚点+通用构图标签(`fallbackPageTags`)。UI 选中 NAI/Comfy 时显示琥珀色说明。真分格漫画页仍走 多模态Chat/Gemini 自然语言线。

### 11.5.5 👗 衣柜（穿搭预设·概念借鉴 ST 插件 Outfit-Manager，代码全自写）

痛点：角色穿着(appearance5 穿着段)是 AI 演化动态字段会漂,同角色生图服装不一致。衣柜=玩家钦定的权威穿搭库：`outfitStore`(drpg-outfit) 每角色若干套 {名称/中文描述/场景标签/英文服装标签/参考图},**激活的那套=服装单一权威源**,注入三条生图线——①立绘 `buildPortraitPrompt` 加 `charId` 字段:自然语言线 `${attire}`=钦定穿搭>装备栏>外观穿着,标签线并入英文服装标签(没填并中文描述);②正文配图 `genStoryImagesFor` charLine 追加「钦定穿搭…服装以此为准·最高优先」;③漫画 `comic.buildRoster` 同款(分镜外观锁引用)。不激活任何一套=完全维持原逻辑。UI `OutfitPanel` 弹层(增删改+激活单选+「从当前穿着导入」预填+📷参考图),入口=主角侧栏立绘下 👗 按钮 / NPC 详情肖像绘卷 Tab。**进度类** store:进 STORES 带 clear(穿搭绑定本存档角色,随快照/新游戏清)。单测 outfit.test.ts 6例。

**P1 正文闭环（08-04）**：①`<钦定穿搭>` 正文注入(`buildOutfitInjection`·两注入位=主正文+细纲规划):当前穿着+衣柜清单(名称+场景标签),**正文描写衣着以此为准**;范围=主角+在场存活NPC,上限8行,全空不出块。②**AI 换装指令** `outfit.<角色ID>=穿搭名`(stateApply·`applyOutfitCommand`):名称模糊/场景标签命中(如 `outfit.B1=战斗` 命中带"战斗"标签那套)/「无|脱下|取消」=取消钦定/角色ID误写成NPC名且唯一时自动纠正;只能选衣柜已有,未命中忽略不动。闭环=AI 按剧情换装→store→下回合注入与生图全部跟随(场景切换靠 AI 驱动,不做机械钩子)。③**穿搭参考图**:每套可传一张(shrink 768px→imageDb `outfit:<charId>:<id>`,**随存档快照**;删穿搭连图删);chatimg 多模态线绘漫画时 `collectRefs` 把「角色头像+激活穿搭图」一起当参考图发送(合计上限4张,hint 注明"服装以此图为准")。

**✨按装备生成（08-05）**：衣柜表单加「✨ 按装备生成」——`systems/outfitGen.ts` 读该角色**已装备**物品（主角=itemStore equipped/NPC=npc.items equipped）的 名称/槽位/类别/品级/外观(生图依据) → `OUTFIT_GEN_RULE` 走 `image_story_llm` 路由（与外观→标签翻译同线,留空回退正文API）→ JSON{desc,tags} 回填表单（desc≤600/tags≤400,用户可改再存;名称空则预填「当前装备」）。铁则:只依据清单明确外观事实禁编造,缺外观按名称类别保守呈现;从上到下组织+武器携带方式;同产英文服装标签(12~25个,不含主体/画质标签)。无已装备物品/未配路由都给人话错误。`collectEquippedForOutfit` 可单测(已装备过滤/槽位/缺外观占位/空抛错)。

**P2（08-04）**：①**跨存档模板库** `outfitTemplateStore`(drpg-outfit-tpl,上限60套,**同名保存=覆盖返回原id**)——⚠**不进 saveManager STORES**(monument 同款):新游戏不清、读档不回滚,真·账号级;模板参考图也因此不能放 imageDb,放独立 IndexedDB `drpg-outfit-templates`(systems/outfitTemplateDb.ts)。UI=衣柜每套 ⭐存为模板(带图拷贝),面板底部 📚模板库(折叠·⤵导入到当前角色衣柜含图/🗑删除)。②**立绘线穿搭参考图** `outfit.outfitRefImages(charId)`+`OUTFIT_REF_HINT`:接入 5 个立绘生成点(PlayerSidebar 手动✨/编辑提示词重生成、NpcDetail 同两处、App 自动肖像阶段)——chatimg 服务时激活穿搭图随请求发送并在 prompt 尾注明"服装以图为准,脸型发色仍按文字";其余服务自动忽略。单测扩到 7 例。

### 11.6 🖼 生成图片库（生图设置→「图片库」Tab）

`systems/gallery.ts` `collectGallery`——**只读聚合不新增存储**,四类分组：角色(主角/NPC 当前立绘,一人一组,亡故标注)/装备·物品(InventoryItem.image+NpcOwnedItem.image,**同名合并一组**,caption=持有人)/正文配图(chatDb 消息行内 `images[]`,带当时生图提示词,楼层新→旧,默认限150张防内存)/漫画(**自成一类**,comicDb 一批=一组《标题》,带每页 finalPrompt)。UI `GalleryTabPage`：分类筛选 chips+计数 → 每类一节、名字瓷砖网格(封面+×N) → 点开灯箱(上一张/下一张/📋提示词/⬇下载/📤分享到交流室)。注意角色/装备图重生成是原位覆盖(store 只留当前版),正文配图与漫画天然留历史。

### 11.7 🖼 交流室「图片分享」频道（公共图片区·⚠需 redeploy relay）

真人聊天室(ChatDO)开第二频道 `images`(前端页签 💬闲聊/🖼图片分享,切换=按 `?ch=` 重连,backlog 各频道独立)。**图片走公共区、聊天只传引用**(沿用「绝不广播大图」铁则)：上传 `POST /api/chat/image`(Bearer chatToken,≤3MB,前端先缩≤1600px)→R2 `img/<sha256>` 内容寻址(同图全局一份)+D1 `chat_images` 记谁传的(每人上限200);聊天消息只发 `{hash,w,h,caption}`(caption≤120,ChatDO `case "image"` 白名单校验),各端 `GET /api/chat/image/<hash>` 取图(公开·不可变长缓存)。**公共图池**=`GET /api/chat/images?scope=public`(按hash去重·最近300),频道输入区 🗂 打开网格点选直接转发;📷 上传并发送(输入框文字=图片说明);消息里图片点击开灯箱。**图片库一键分享**：灯箱📤按钮走 `systems/chatImages.ts shareImageToChannel`(上传→自动连 images 频道→发引用;未登录给引导错误)。删除只删自己的 D1 索引,R2 对象留作他人共用(内容寻址)。worker 零新增绑定(复用 DB+CLOUD_BUCKET),但 **chatImage.js/ChatDO/index.js 改动需 redeploy**;未部署时前端优雅降级(公共池空、上传报错、旧 DO 静默丢弃 image 消息)。

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

**生物强度** `bioStrength`(如 `T3·勇士`,T0~T16)：`character.<id>.bioStrength="..."`。两预设 `生物强度生成框架(T0-T9属性预算)`——按 阶位Tier预算+模板+身份层+流派分配六维,宁低勿高禁全满。**非人生物(阴影/魔物/Boss)同样必须生成六维**。六维纯AI生成,前端只算衍生ATK/DEF。

**生物强度徽章**（`components/BioBadge.tsx`,2026-07-25）：把 `bioStrengthLabel` 的「资质T0·杂鱼 / 战力T1·兵卒」渲染成**一档一色小胶囊徽章**（指示点+资质/战力前缀+T档号+渐变档名）,主角侧栏 / NPC详情 / 临时队伍 / NPC分享卡共用（`size='sm'|'xs'`）。挂钩 `bioStrength.bioVarClass/bioFxClass` → index.css `.bio-chip/.bio-pip/.bio-fx/.bio-b0..b16`：**每档只写一行主色 `--bc`**,胶囊底/描边/指示点/档名渐变全部 color-mix 派生（加档只加一行）。性能纪律同品级/阶位特效：b0~b7 静态(b2 起悬停才流光)、b8 起常驻缓流、光环 b12 起、旋环仅 b16,全部 reduced-motion 门控。解析走 `parseBioChips`,兼容旧存档自由文本（`真神`/`T2·二阶`）,**认不出档位就原样显示纯文字不猜档**。

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

**世界详情库**（世界详情工坊产物消费层,`systems/worldDetail.ts`,零配置默认生效）：仓库根 `世界书/世界详情库·主库.json`+`·休闲.json`(每世界两条目 `<名>·剧情`≥1万字/`<名>·阶位切入点|·休闲切入点`,由 `世界详情工坊/scripts/compile-worldbook.mjs` 编译)合计 ~137MB 不能整本进前端 → vite 插件 `buildWorldDetailShards`(vite.config.ts)构建时按世界名 FNV-1a 切 **256 哈希分桶** `public/worlddetail/s<i>.json`(单片~0.5MB)+`manifest.json`(名→分桶号,~228KB)；产物 gitignore,源 size+mtime 记 `srcStamp` 没变秒跳(工坊重编译后下次 build 自动重切)。前端按需 fetch+进程内缓存：**C1 世界卡生成**(`WorldSelector.generate`)按点名世界名 `fetchWorldDetailsFor` 注 剧情+切入点 两段(总预算 `WORLD_DETAIL_BUDGET`=6万字,超则切入点保全量、剧情从头保留截尾;命中的卡片字段严格照档案);**C2 入世正文**(`callApi`)`ensureWorldDetailFor(misc.worldName)` 回合前预取(超时5s放行)+`buildWorldDetailInjection({ctxText})` 在世界志旁**分层注入**(切入点仍不注,引擎 `systems/worldDetailInject.ts` 纯函数):按 `**【节名】**` 分节(重复节头去重·无节结构=整段截6000)→ ①**常驻核心**=作品来源/世界定位/力量体系|舞台设定/基调·雷区(单节≤1200/合计≤2800)＋③**进度门控**=「世界剧情线|故事主线」①②③条目(金标准批次 `**卷N` 同识别)只放1..当前阶段+1、**未来阶段与【隐藏剧情】对正文不可见**(治抢进度/泄底;阶段=条目专名对ctx词法打分argmax·置信<6回退1·stageMemory会话内只进不退)＋②**相关性层**=其余节(人物/势力/地理/大事记/场景质感…)切≤600字块、粗体/引号/段首专名对ctx(最近3楼+本回合输入尾4000字)命中打分取top(合计≤2200·零命中不注)。**细纲分支 `{mode:'full'}` 拿完整档案**(含未来阶段+隐藏剧情)——规划者知全局、叙事者只知眼前。每回合~1.1万字→~4-5千字且密度更高;预算常量在 worldDetailInject.ts 顶部。**玩家设置**(变量管理→🗂世界详情注入·`settingsStore.worldDetailInject`+`WorldDetailInjectBar`)：注入模式 分层(默认)/全量(旧行为)/关闭 · 体量档位 精简0.6/标准1/充裕1.6(`BUDGET_SCALE`成套缩放三层预算) · 细纲全量开关(关=细纲也退分层)。世界名漂移(「世界名+地点」等)用 `resolveWorldNameFrom` 三级匹配(精确>归一>双向子串取最长,与 worldCodexStore 同款 norm)。查无此世界/无产物/断网一律静默降级。

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

### 19b. 装备工艺（🔨 工艺页签 · 玩家主动锻造）

**定位**：强化所第三个页签，与「⚒ 强化」**正交并存**——强化赌等级（随机、可爆装），工艺改词条（确定性为主）。引擎 `systems/equipCraft.ts`，数据 `store/equipCraftStore.ts`(`drpg-equipcraft`)，UI = `EnhancePanel.tsx` 的 `CraftView`（模块级组件，守"受控输入面板别内联子组件"铁则）。API 复用 `resolveApiChain('enhance')`，不另开一路。

**锻造潜力（核心约束）**：每件装备有 `potentialMax = 6 + 品级档×2`（白色 8 … 创世 36），状态存 `item.craft.potUsed`（随物品转移/分享/存档走）。每次工艺扣潜力，**耗尽即封盘**，这件装备此后再不能施艺。**品级进阶会抬高潜力上限**（公式依赖品级档，已用量保留）→ 进阶因此额外获得新的锻造空间，两系统正向联动。

**三条内置工艺线**：
- **🔨 潜能锻打**（确定性）：必定 +1 条新词缀，消耗 5 点潜力。
- **🧪 精髓灌注**（确定性）：拆解装备把一条词缀永久录入**精髓图鉴**（装备本体消耗），再花潜力把图鉴精髓灌注到别的装备。图鉴遵守「库房只存不删」——录入后永久可反复灌注，闸门由潜力 + **品级门槛**（`canInfuse`：精髓来源品级不得高过目标 2 档以上）承担，而不是靠销毁条目。
- **☠ 虚空腐蚀**（赌博）：不耗潜力、蓝色+ 可用。八档赔率：品级跃升/词缀升华/附着/锋芒增益 ↔ 无事 ↔ 锋芒钝挫/词缀剥落/**崩毁**。**腐蚀后 `craft.corrupted=true` 封死一切工艺**（强化不受影响，两系统仍正交）。

**两种执行路径**（`isPreviewMode`：结果表长度决定）：结果唯一=**确定性工艺**→出预览、可「🔄 重写词缀」、确认才扣费落库；多结果=**赌博工艺**→点下即摇定并扣费，无预览无反悔（风险感来自不可撤销）。

**✨ 自创工艺（玩家 AI 造工艺）**：面板「✨ 自创工艺」写构想 → `runCraftProcessGenPhase` 调 AI（`CRAFT_PROCESS_GEN_RULE`）填**受限参数空间**（potCost/costRatio/gradeMin/结果权重表/词缀方向）→ 入库即出现在工艺列表 → 可「📤 上传工坊」分享（`workshop.ts` KIND `craftProcess`）。
- **平衡阀（关键设计）**：一切入库路径（AI 生成 / 工坊下载 / 手改 localStorage 回读）都过 `sanitizeProcess`——非法 kind 降级为 nothing、同 kind 合并权重（防伪造高概率）、数值夹进合法区间；再经 `riskPricing` 按**期望收益**自动加价（`expectedValue > 0` 时潜力与费用同步抬升，ev=+8 约 ×5.4）。**故提示词无法绕过经济**：玩家可以让 AI 写"必定品级跃升"的工艺，但它会贵到与直接买一件同档装备等价，只改变"花钱买什么"，不改变"能白嫖多少"。

**前端拍板 / AI 只写文本**（同 `equipAscend` 范式）：`resolveCraft` 定 outcome + 潜力 + 费用 + 品级变动 + 攻防增幅 + 被作用的词缀下标；AI（`EQUIP_CRAFT_RULE`）**只写那一条词缀**，且明确不采信其 gradeDesc/score/combatStat。品级变动一律 `targetScoreFor` 写死评分落新档区间（防 `normalizeGrades` 钳回）。

**坑**：① `item.craft` 字段在 `itemStore` 定义、类型从 `equipCraft` **仅类型导入**（运行时擦除，故循环引用不成环——改这里别写成值导入）。② 内置工艺 `builtin:true`，`upsertProcess` 拒绝覆盖内置、`resetProcesses` 只重置内置不动自创（自创可能已上传工坊）。③ 精髓图鉴是**进度**（进 saveManager 快照、新游戏清空），工艺库是**配置**（进 configExport、跨新游戏保留）——两者生命周期不同，别混。④ 提取精髓会**消耗装备本体**，已装备/已锁定的装备拒绝提取。

### 19c. 编年史 / 传奇模式（📜 右侧导航「编年史」）

**史观（一句话记住）**：**当朝为实录、前朝方有正史**。当前世界现场投影纪要实录；世界结算/离世后点「✒ 修史」由 AI 一次删繁就简编成正史。正史**不覆盖**实录源数据，可随时重修。引擎 `systems/chronicle.ts`（只读投影、不写 store），数据 `store/chronicleStore.ts`(`drpg-chronicle`)，UI `components/ChroniclePanel.tsx`。

**两个视图·刻意不合并**：
- **📖 本纪**＝当前存档。**卷**(WorldRecord·一个世界一卷) → **页**(chronicle 纪要表逐回合行 + deedLog 事迹) → **注**(离世总结/归档任务/本卷之最)。
- **🪦 前尘**＝历代主角丰碑（`drpg-monument` 是**账号级**、跨存档常驻）。它们的回合号来自**不同存档**，并进本纪的时间轴语义上是错的，故独立成卷。

**分卷（关键机制）**：纪要表只有 AI 写的自由文本「时间」列（游戏内时间，对史书比回合号好用），**没有回合号**。故 `applyTableEdits` 在纪要行 `insertRow` 成功后**旁路记** `rowMeta[row_id] = {turn, world}`（不改表结构、不污染 AI 视图）。`volumeIdForRow` 三级降级：turn 落进 `[enteredAt.turn, leftAt.turn]` 区间 → 按世界名匹配 → **散佚残卷**。老存档没有 rowMeta 也不丢数据，只是降级进散佚卷。进行中的卷是**开区间**（无 leaveTurn），故新行不会误判散佚。

**重要性三级**（`classifyText`·确定性关键词表·不花 API）：金=生死/突破/通关/缔约/覆灭；银=战斗/结识/交易/任务；灰=日常，**默认折叠**。⚠ 金词表必须覆盖本作的杀伐说法（斩杀/诛杀/殒命…不只是「击杀」），否则一卷史事全是灰——这是单测抓出来的真实缺口。

**修史**（`runChronicleCompilePhase` + `CHRONICLE_COMPILE_RULE`，走 `resolveApiChain('misc')`）：只送**灰+银流水**给 AI（金料已提炼过，作为"必须保留的事实"另行告知），硬限 160 行防超 token；AI 只做合并/剔除/提炼，**不得杜撰实录里没有的事**；产出经 `sanitizeCompiled` 前端夹取条数(≤40)与字段长度。

**互链**：`extractEntities` 在史事文本里扫已知 NPC/势力/主角名（<2 字的名跳过防误命中），点人名经 `NpcPanel.initialSelectedId` 直落该角色详情页。

**生平留存放宽**（编年史「人物列传」的数据基础）：主角 deedLog 20→**400**；NPC 按 `deedCapOf` 分层——重要角色（好友/随从/常驻/已故/契约者/召唤物）**120**、路人 **30**。npcStore 走 lzStorage 压缩，体积可接受。

**坑**：① 纪要行分卷索引写失败**绝不阻断填表主流程**（没索引只是降级进散佚卷）。② 小/大总结是裸 `string[]`、**零元数据**，故意没接进编年史（改结构要动一片读取点，且与纪要表功能重叠）。③ 世界结算**没有结构化产物**（`lastWorldSettleAt` 只是个被反复覆盖的标量、结算卡只是聊天文本），编年史用 `WorldSummary` 当代理。④ ACU 事件核心（wallet/item/npc）**读档即清零**且是机器口吻，**不能**当史料源——史书≠流水账。

### 19d. 正文关键词悬浮图鉴（阅读设置「关键词悬浮图鉴」开关）

对标 Tyranny / Pillars of Eternity 的名词 tooltip：正文里的专有名词带虚线下划线，悬浮（手机点按）弹百科卡。**纯渲染层**——不需要 AI 配合任何格式、不占 token、不新增演化阶段，词典由存档现状实时编成。

**三段结构**：① 词典 `systems/codexIndex.ts` → ② 标注 `narrativeHtml.ts`→`markEntities` → ③ 悬浮卡 `components/CodexHover.tsx`。

**词源与撞名优先级**（注册顺序即优先级，先注册的赢）：NPC（在场/好友/随从 > 离场 > 归档）→ 势力 → 物品 → 技能/天赋/称号/副职业+配方（主角 B1 先）→ 万族（**仅 `isPlayerKnown`**，没接触过的不剧透）→ 领地本体/建筑/效果 → 冒险团效果 → **阶位 14 阶（常驻）** → 轮回 wiki 人物（可选层·垫底，永远让位于本档实体）。

**⚠ 性能三条铁则**（打字卡顿的教训，改这块前先看）：
1. **零订阅**：codexIndex 一律 `getState()`；`MessageRow` 里没有任何新 hook；悬浮卡靠 **document 委托监听**（正文几十个实体名 = 0 个监听器），行级 memo 完全不受影响。
2. **惰性重建**：`getCodexIndex()` 每次只做 ~12 次 store 切片**引用比较**（zustand 不可变更新保证写入必换引用），没变直接返回上次索引。流式每帧（100ms）都会调它，靠这个免于重建。
3. **首字快筛**：扫描按 `heads`(Set<首字>) 过一遍，未命中 O(1) 跳过；命中才按长度降序探 Map。复杂度 ≈ O(正文长度)，**与词典大小无关**。

**匹配铁则**：**位置保持**——不做 `normName` 那种「删标点再比对」的归一（下标会对不上原文、span 插不回去）。变体靠「同一词条注册多个字面名」：全名 + 分隔段（`神威·空洞褫夺` → 也收 `空洞褫夺`，≥3 字才收）+ wiki 别名。ASCII 名要求词边界（`Fire` 不命中 `Firewall`），大小写不敏感（长度不变形）。

**防噪三招**：① `usableName` 拒收 <2 字 / 纯 ASCII <4 字 / `C1`-`G12` 这类 id 形态 / 停用词表（世界·乐园·技能·状态…宁可漏一个也不能满屏下划线）；② **每条消息只标首次**（`ProseCtx.seen` 跨行、跨结算卡共享）；③ 品级色名（白色/紫色…）**故意没进词典**——正文里「紫色的光芒」会被误标。

**标注落点**：挂在 `styleProse` 末尾（只吃**普通散文行**；结算块/HTML 透传行/占位符行压根不进这里）。`markEntities` 走状态机，`<标签>` / `&实体;` / `@@ZS…@@` 占位符**整体透传**，故不会切坏 `narr-dialogue`/`narr-inner` 的 span、不污染小喇叭的 `data-line`、不切断待替换的骰子卡/配图占位符。key 进属性前必须 `attrEsc`（名字是 AI 写的、可能带引号）。

**开关与缓存**：`settings.reading.codexHl`（缺省=开）/ `codexWiki`（缺省=关·含原著剧透·首次开启拉 2.2MB）。与对话高亮不同，**这个不能纯 CSS 切**——它依赖词典内容，故开关 + `索引 version` 一起进 `toHtmlWithImagesCached` 的签名：开关翻转或实体增删后，楼层重渲时自动重标，不会停在旧标注。

**坑**：① 设置页是**整棵树的早退**（不是叠加层），主返回里那份 `CodexHover` 此刻是卸载的 → 设置页必须自带一份，否则阅读设置里的示例词条悬浮不出卡。② `lookupCodex` **只查不重建**（实体被删就不弹卡，好过为一次悬浮重跑词典）；只有索引压根没建过时才建一次——这条专为设置页示例词条而留。③ 名字含 `&`/`<`/`>` 的实体永远匹配不到（正文里这些字符已被 `escapeHtml` 转义），只有双引号能原样进属性，故转义只需管它。④ 用户消息**没接**标注（价值在 AI 正文，且 `userToHtml` 走另一条渲染路径）。

### 19e. 楼层分支树（🌿 右侧导航「分支树」）

对标 SillyTavern 的 Timelines 扩展：聊天历史画成时间线，任意节点开分支。本作的落点是——**⟳重新生成 / ↩回退 丢掉的那条时间线，不再真的丢**。

**一条支线 = 一个普通存档槽**（前缀 `branch_`，多带 `branch` 元数据）。为什么这么设计：
- **抓取时机是命门**：`回退`/`重新生成` 都是「`loadSlot(UNDO_ID)` → reload」，`stashDiscardedBranch` 必须插在 **loadSlot 之前**——此刻 live store 里还完整保留着这一回合的演化结果，整存一份拿到的就是被丢弃那条线的**忠实终态**。晚一步就只剩"回合前状态 + 一段孤立文本"，恢复后会出现「正文说打赢了、数值还没打」的错位。
- **恢复 = `loadSlot(分支槽 id)`**，一行复用现成读档全链路（reload / 事件核心 reseed / 图片回填）。这也是**唯一**能把 `gameStore`（模块级 `loadSave()` 初始化、无 persist 中间件）一并还原的路径——`rollbackEvoDomains` 那条免 reload 的路只覆盖 10 个 store，做不了分支。
- **元数据放槽顶层而非 `data` 里**：`saveDb.allMeta()` 游标会剥掉 `data`，放顶层才能**零存档数据加载**画出整棵树（几十个大档也不卡）。

**挂载靠两个 id**：`SaveSlot.tipMsgId`（本槽对话末端楼层，`buildSlot` 统一写入 → 每个存档/备份都知道自己在时间线的哪一格）+ `branch.parentMsgId`（分叉点＝与主干最后共有的楼层）。旧档没有 `tipMsgId` → 只是树上不显示它的跳转点，不报错不丢数据。

**树上三种节点**：◉ 主干末端（你在这里）· ◍⤺ 有快照可跳回的回合（🛟滚动备份 15 深 / ⏱自动 / 手动存档）· ○ 只留正文、跳不回去。支线用虚线挂出去，⟳弃稿 / ↩回退丢的线 / 🔖主动埋的点三色区分。

**体积**：每条支线≈一个 🛟 滚动备份（不含图）。未收藏的只留 `BRANCH_KEEP=12` 条，超出删最旧；📌收藏豁免裁剪。开关 `settings.branchCapture`（缺省开，在分支树面板里）。

**坑**：① 抓取失败一律静默——分支是锦上添花，**绝不能挡住玩家回退/重生成**。② 切支线前会先把当前这条线也存成支线，否则"跳过去"等于把现在这条丢了。③ `listSlots()` 必须排除 `BRANCH_PREFIX`，否则支线会把存档主列表刷屏（已加，且实机验证过）。④ `clearProgress` 清空支线（属"进度"）。⑤ 分叉点不在当前对话里的支线归**游离支线**（读档换了时间线，或分叉点被时间线截断），另列不上树、不删。⑥ 联机房间内禁止切支线（会 reload + 断房）。

## 20. 🤖 Agent 正文模式（另一种可选的正文生成·仿 TauriTavern）

**是什么**：开关开启后，正文不再"一次调用一段流"，而是模型带**工具循环**工作（查主角/NPC/任务/势力档案、搜历史楼层、查世界书与向量库、`db_query` 只读查状态表、在虚拟工作区打草稿修订），最后 `workspace_commit` 把成稿发布为楼层、`workspace_finish` 收尾；**成稿格式与 legacy 完全一致**（状态栏/`<state>`/`<upstore>` 照常），终态后走原有解析+演化管线。设计与行为规范全文：`docs/AGENT_MODE_PLAN.md`（头部有实施状态与偏差记录）；代码定位：`CODE_MAP.md §1`「🤖 Agent 正文模式」。

**铁则**：① 默认关；关闭时 `callApi` 路径一字节不变，**其 API 绝不被调用**。② API 完全独立：`'agent'` 路由 > `agentApi` 独立配置；勾「复用正文 API」才共用（用户明确要求）。③ 传输层恒 `stream:true`（防假流式中转 204），语义仍是整轮非流式。④ Agent 模式跳过思维链预填（assistant 预填与 tools 互斥）。⑤ 楼层在**首次 commit** 才出现；取消/失败不解析不演化（partial=有 commit 的失败，保留成稿并照常结算）。

**P1 能力**：`persist/` 跨回合记忆（**仅 completed 收尾才保存**，单文件24k/总96k）；运行中再发送=「中途指引」注入下一轮（确认框；8条/16k/64k 限额；发送钮运行中变 🎯）；`maxCallsPerTool` 单工具上限（软错误·暂无 UI）；run 概要归档回合洞察。

**坑**：① drift（模型直出纯文本）不是失败——文本存 `output/direct_output.md` 并提醒模型可直接 commit 该文件回收，共享轮数预算；② 只有「未知工具名」「finish 后还有调用」致命，其余工具错误一律软回喂让模型自救；③ 文本协议 `<tool_call>{json}</tool_call>` 是无函数调用端点的降级（auto 模式 HTTP 报错提及 tools 才切换），解析走 lenientJsonParse；④ 中途指引的拦截在 `sendMessage` **忙碌门之前**（否则 generating=true 永远进不去）；⑤ 新增工具记得同步 `SettingsPanel.AGENT_TOGGLEABLE_TOOLS`（核心 workspace 读写/commit/finish 恒开不进列表）。
**P2 能力**：🗂 **配置档案**（命名快照：cfg+独立API+agent/agentReview 路由，一键应用切换"快速档/深度档"；应用不改启用开关，提示词仍走预设中心）；✍️ **末轮流式预览**（模型经 write_file 写 output/main.md 时，从 SSE 参数流渐进抽 content 做草稿流式（120ms 节流）流进楼层，commit 后由清洗稿接管；⚠ **0 次 commit 就终止的 run 会撤掉预览楼层**——"没 commit 就什么都不留"语义不破）；🧐 **评稿子代理**（finish 拦截：评稿人走 'agentReview' 路由（留空回退 Agent 主接口）审成稿，首行 PASS/REVISE 协议，REVISE 以软错误回喂逼修订再 commit，最多 reviewerPasses(1~3) 轮，评稿调用失败 best-effort 放行；修订消耗正常轮数，超轮按已提交版 partial 保留）。
**Agent 专属预设（正文生成→🤖 Agent 预设页签）**：内置三枚——`轮回乐园 Alu v4.1 破晓-Agent`（**本作世界观专用流水线**·134 条/启用 76 条≈3.4 万字·自带 6 规则书 + 4 审查子代理（禁词/战斗结算/人设/世界观）+ 主写手 9134 字工作流 + 8 条内嵌正则；⚠ **该 JSON 无 `name` 字段**，预设名取 seeds 里的 fileName——它同时是内嵌资产的作用域锚点，**改名 = 资产全部失配**）、`[Agent] V14.7 狐神抚 · 毓忻`（214 条·启用 58 条非 marker≈1.4 万字·原生带 TauriTavern agentSystemPrompt/agentTask 槽位，本作不消费该槽、指令仍深注入输入前）与 `Fairy_Tale 2.3.0`（轻量·双 prompt_order）。选中后 Agent 回合的**整条组装链**（条目/正则/深注入/采样参数）换用该预设；默认「跟随正文预设」；玩家改过的同名版优先（`resolveAgentPreset`）。⚠ 解析语义（2026-08-02 事故后定版）：`parseSTPreset` 的**忠实 ST 语义**（按 order 序拼装、库存条目禁用）只能 **opt-in**（第 4 参 `stOrderFaithful`，当前仅两枚 Agent 内置预设的补种用）——曾默认忠实化导致玩家重导旧预设后条目顺序/启用集突变、正文格式崩，已回退；**默认行为只保留一处增强：多份 prompt_order 时优先取 `character_id=100001`**（单 order 预设与旧版逐字节一致）。勿再改默认；回归守卫在 `agentPresetEmbed.test.ts`。

**P3 · 子代理与技能包（TT 内嵌资产完整承接）**：导入含 `extensions.tauritavern` 的预设（内置补种/玩家手动导入都算）自动入库 `agentSkillStore`（`drpg-agentskills`·配置类）——① **skill 包**：`ttskill-archive-base64-v1`（base64 zip）经零依赖 `miniZip.ts`（DecompressionStream deflate-raw）解为文本文件，作用域挂到导入预设名，`skill_list/skill_search/skill_read` 三工具按需读取（单次 20k/全程 60k 预算）；② **子代理**：`allowAsSubagent` 档案 → `SubAgentDef`（作者 instructions 作其系统提示词主体、技能可见性、轮数夹到 ≤12），主模型经 `agent_delegate` **同步**委派（结果直接随工具返回——TT 的后台并发/`agent_await` 不移植，await 留兼容桩、handoff 软拒绝），子代理共享父工作区（可读 output/main.md 写 scratch/）、以 `task_return` 收尾、可挂独立接口路由 `agentSub-<id>`（V14.7 实测流水线：主写手→禁词检查员/人设审查员，"正文强模型+审查便宜模型"在此配）；③ **作者工作流指令**：主档案 instructions 挂 `writerNotes[预设名]`，选中该 Agent 预设时追加进系统提示词（带同步适配说明）。UI 在「Agent 预设」页签下方（子代理开关+独立路由+技能清单）；坑：① 子代理内**未知工具不致命**（软回喂，别把便宜模型一杆子打死）；② **作用域锚点必须是"本回合实际生效的预设名"**（callApi 传 `preset.name` 进 RunAgentParams.presetName）——曾用 settings.presetName 当锚点，「跟随当前正文预设」时为空串导致预设专属 skill/子代理/作者指令全部静默不生效（Discord 实报，08-02 修）。

**P4 · 初始历史裁剪（Agent 省 token 核心开关·仿 TT initialChatHistoryMessages）**：`agentNarrative.initialHistoryMsgs`（-1=跟随全局楼层限制·默认；0=不注入任何楼层；N=只带最近 N 楼），设置区「初始历史」输入。切点在 callApi 的 recent 四分支汇合+记忆去重**之后**单点裁剪——**只裁发给模型的原文楼层**，世界书关键词匹配/向量与叙事召回/结构化档案/记忆去重都照常用完整近况；系统提示词自动注明「本回合只注入最近 N 楼，用 chat_search/chat_read_messages 查更早剧情」。工作区根同时补齐 `summaries/`（对齐 TT 五根）。已列过**不做**的（勿重复挖）：异步委派+真 agent_await/handoff、run 历史浏览面板、skill 手动导入导出 UI、逐端点重试间隔、includeActivatedWorldInfo=false、checkpoint 回滚——低价值或 TT 自身未完成。