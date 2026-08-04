# 世界后台引擎 · 轮回乐园适配方案

> 配套文档：`docs/WORLD_ENGINE_PORT_PLAN.md`（v5.6 卡的原始解剖与通用移植清单）。
> **本文是可执行版**——原方案是照搬一张为「长期连载单世界」设计的卡；轮回乐园是**短命任务世界 + 永久乐园**的双层结构，直接照搬会有一半机制跑不起来。
> 本文先立四条适配公理，再给地基、逐项改写、以及只有无限流才有的缝合点。

---

## 0. 为什么必须适配（三条结构性差异）

| | v5.6 卡假设 | 轮回乐园现实 | 后果 |
|---|---|---|---|
| **世界寿命** | 一个世界连载数百轮，时代慢慢演进 | 一个世界**几十回合就通关离开** | 时代演化（进度 ≥80% 才临界）、外交事件链（5 阶段）、传闻流变（≥5 节点才压缩）**全都跑不完** |
| **主角位置** | 主角是世界的居民 | 主角是**外来闯关者**，世界不是他的家 | NPC 分土著/契约者两种知情面；数据有的跟着走、有的留在原地 |
| **数据归宿** | 数据一直累积 | 离世 = **冻结归档**，同名再入 = **继承复原** | 每个新结构都要回答「离世怎么办」，否则上个世界的势力/事件/传闻会跟着串进新世界 |

---

## 1. 四条适配公理

### 公理 1 — 每个新数据结构必须声明作用域

这是你举的例子（势力只存在于特定世界）的一般化。**三种作用域，建模时必须选一个**：

| 作用域 | 含义 | 离世行为 | 已有的 / 新增的 |
|---|---|---|---|
| `world` | 绑当前任务世界 | **冻结进 WorldRecord**，从活跃视图消失；同名再入可解冻 | 势力（已有 `inCurrentWorld`）、**土著 NPC（缺）**、世界事件、传闻、当地货币、世界内声誉 |
| `paradise` | 绑轮回乐园 | 不受影响，跨世界累积 | 契约者 NPC、随从/宠物/召唤物、冒险团、公会、领地、乐园币/魂币、竞技场排名、烙印等级 |
| `cosmos` | 宇宙背景层 | 完全独立于主角行踪 | 万族/七乐园/深渊（`cosmosStore`）、**时代演化（从任务世界搬来）** |

> ⚠ 冻结 ≠ 删除。遵守既有铁律 `db-as-library-never-delete`：离世的世界数据进「库房」，玩家能在世界记录里翻到，同名再入能捞回来。

### 公理 2 — 时间尺度按世界寿命重标定

卡里所有周期参数都是为长连载调的，**直接抄会全部失效**：

| 参数 | 卡里 | 轮回乐园应取 | 理由 |
|---|---|---|---|
| 世界演化调度 | 每 1 周世界时间 | **进世界一次性播种 + 每 3~5 回合微调** | 世界总共活不了几周 |
| 传闻 `预计时效` | 数周 | **1~3 天世界时间** | 否则一条传闻从生到死都没动过 |
| 传闻流变压缩阈值 | ≥5 节点 | **≥3 节点** | 撑不到 5 |
| 事件脉络压缩 | ≥5 节点 | **≥3 节点** | 同上 |
| 外交事件链 | 5 阶段 | **压到 3 阶段**（起手 → 推进 → 终局） | 5 阶段走不完 |
| 时代演化临界 | 进度 ≥80% | **不在任务世界做**，整套搬 `cosmos` 层 | 涨不到 |
| 事件配额 | 背景 ≤5 / 区域 ≤3 | **背景 ≤3 / 区域 ≤3** | 世界短，背景事件多了是噪音 |

### 公理 3 — 主角是外来者，数据的「知情面」分三层

卡里所有 NPC 一视同仁。前端必须按 `npcTag` 分流：

| npcTag | 知情面 | 作用域 | 离世 | 演化方式 |
|---|---|---|---|---|
| 土著 | **不知契约者体系**（已有 `NATIVE_UNAWARE_RULE`） | `world` | 冻结 | 轨道 A `decideNativeTick` 为主，有羁绊/剧情关联才花 API |
| 契约者 | 知道，但碰面**无法感知同类身份**（已有认知障壁） | `paradise` | 跟着走，可在乐园重逢（已有 `createArchivedContractor`） | 轨道 A `decideContractorTick` 双相循环 |
| 随从 / 宠物 / 召唤物 | 跟主角一致 | `paradise` | 跟着走 | 恒在场，不进后台推演 |

**这条直接产出一个新需求**：`NpcRecord` 需要补 `worldName`（土著专用），否则离世后无从判断谁该冻结。

### 公理 4 — 世界结算是硬边界，一切未完的都要有归宿

离世时（`runWorldSummaryPhase` / `markWorldSettled`）必须给每类数据一个终局：

| 数据 | 离世归宿 | 落点（**都是已有字段**） |
|---|---|---|
| 未结算的世界事件 | 写进未了伏笔 | `WorldSummary.未了伏笔` |
| 进行中的传闻 | `文化烙印` 级 → 升格进编年史；其余湮灭 | `chronicleStore` / 丢弃 |
| 未走完的外交事件链 | 按已完成阶段比例强制判定 | `WorldSummary.关键事件` |
| 世界内声誉 | 折算成一句名声 | `WorldSummary.继承要点.主角名声` |
| 存活的重要土著 | 结局定格 | `WorldSummary.人物结局` |
| 当地经济状态 | 丢弃（当地货币已归零，见既有 `local-currency-feature`） | — |

**反向收益**：这些结算结果可以喂给世界结算评级（既有口径：评级环 0.75 + 世界之源 0.25），让「后台世界演化」第一次对玩家产生**可见的机械回报**——否则它永远只是背景装饰。

---

## 2. 地基：`systems/worldScope.ts`（先做这个）

不做这一层，后面每个系统都要各自打补丁，最后一定会串世界。

```ts
// systems/worldScope.ts —— 纯函数 + 一个统一的冻结/解冻入口
export type Scope = 'world' | 'paradise' | 'cosmos';

export interface WorldScoped {
  worldName?: string;      // scope==='world' 时必填
  frozenAt?: number;       // 冻结时的回合号；有值 = 已归档，不参与活跃视图
}

/** 该条数据此刻是否活跃（当前世界匹配 且 未冻结） */
export function isActive(rec: WorldScoped, currentWorld: string): boolean;

/** 世界名归一比对——复用 worldRecordStore.normWorldName，别再写第二套 */
export function sameWorld(a?: string, b?: string): boolean;

/** 离世统一冻结：势力 / 土著NPC / 世界事件 / 传闻 / 世界内声誉 一次扇出 */
export function freezeWorld(worldName: string, turn: number): FreezeReport;

/** 同名再入解冻：按 WorldRecord.inheritAnchors 决定复原哪些 */
export function thawWorld(worldName: string, anchors?: WorldSummary['继承要点']): ThawReport;
```

**挂载点**（都已存在，只是加调用）：
- `App.tsx → enterWorld`：现在只处理势力那一段（把 `worldName` 对不上的 `setWorld(false)`）→ 换成 `freezeWorld(上个世界)` + `thawWorld(新世界)`。**这是你举的例子的正式落地**，顺带把 NPC/事件/传闻一起管了。
- `App.tsx → isHomeWorld / reconcileHomeWorld`：回乐园时同样走 `freezeWorld`。
- `runWorldSummaryPhase`：冻结前先把公理 4 那张表的内容抽进 `WorldSummary`。

**补字段**（全部可选，老档无缝）：
- `NpcRecord.worldName?: string` —— 只对 `npcTag==='土著'` 有意义；建档时从 `miscStore.worldName` 自动填
- `NpcRecord.frozenAt?: number` —— 冻结态。⚠ 与既有三态（在场/离场/归档）**正交**：归档是玩家主动收纳，冻结是世界切换的系统行为，UI 上要分开显示（`🧊 上个世界` vs `📦 已归档`）

> 这一步单独做完就已经修了一个既有 bug：现在换世界后，上个世界的土著仍会被 `computeFocusList` 选中去花 API 演化，也仍会被轨道 A 每回合织行动。

---

## 3. P0 五项 · 轮回乐园化

### ① 占卜池 → 「命运罗盘」

**必须改的一点**：卡里把卦象/塔罗原文写进事件字段，且这些字段会随世界状态注入正文。在轮回乐园会出戏——赛博世界跳出「䷿·未济」、西幻世界跳出「星币五」，直接破沉浸。

**适配**：
- 占卜结果**只作演化阶段的内部随机锚，永不进正文注入**。演化 AI 读到它、据它决定走向、然后只把中文的「走向描述」写进事件字段。
- 前端存原文（保证同一事件的命运气候稳定、跨读档不跳），但注入侧只给走向描述。
- **UI 上反而要显示**：世界事件卡右上角三枚小徽章（卦象 Unicode `䷀`–`䷿` + 塔罗名）。玩家侧看到「命运罗盘」很有无限流味道，而 NPC 侧一无所知——正好是主角/系统视角与世界内视角的分野。
- **种子绑 `worldRecord.id + 事件 id`**（用既有 `seedFrom`/`hashStr`），不绑回合号——否则回退重放会换一套卦象。

### ② 入场/离场提示 → 按 npcTag 分流写理由

无限流里「谁要上场」的理由天然分两类，注入时要分开写，否则 AI 会给土著编出「感应到契约者气息」这种理由：

```
<角色动向提示>（背景事实·不是剧本；勿强行安排相遇）
即将可能登场：
· 王五（土著·明日进城赶集，会路过主角落脚的客栈）
· 陈九（契约者·同接了猎杀委托，正在向同一区域移动）
刚刚离场：张三（土著·去码头交货）
</角色动向提示>
```

- 土著的入场理由**只能来自世界内生活**（赶集/送货/探亲/换防）
- 契约者的入场理由可以是任务/猎杀/结盟，但**不得写成"察觉到主角"**（既有认知障壁：碰面无法感知同类身份，除非露马脚）
- 随从/宠物本来就在身边，不走这条
- 数据源已经有了：轨道 A 每回合在织 deed，只需在 `decideNativeTick`/`decideContractorTick` 命中「回程/路过/办完事」类事件时置 `readyToEnter`

### ③ 驱动力校验 → 三驱动力按 npcTag 重定义

原方案的 A 命定羁绊 / B 剧情关联 / C 局势关联，在轮回乐园要这样落：

| npcTag | 驱动力判定 | 无驱动力时 |
|---|---|---|
| 土著 | 羁绊/永久保留 · 出现在当前任务的目标/委托人 · 出现在近 3 条世界事件 | **静滞**，只走轨道 A `decideNativeTick`（零 API） |
| 契约者 | 同上 + 竞技场对手/宿敌/交易对象/同团成员 | 走 `decideContractorTick`（零 API，双相循环） |
| 随从/宠物 | 恒定有驱动力（在场） | — |
| **已冻结（上个世界的土著）** | **恒无驱动力** | 完全跳过，连轨道 A 也不跑 |

最后一行是公理 1 的直接收益：现在换世界后旧土著仍在被轨道 A 每回合织行动，冻结后这部分开销直接归零。

### ④ 因果权重 R → 这是全套里最契合无限流的一项

轮回乐园的核心张力就是**跨阶位闯关**：四阶契约者进一阶世界（碾压）/ 二阶契约者进五阶世界（被碾）。R 值把这件事变成可计算的。

**数据源全部现成**：
- 个体天花板 = 主角/契约者的 `阶位` → `attrCapForTier`
- 群体基准 = 世界卡 `tier`；本世界个体天花板 = 世界卡 `peakPower`（⚠ 既有铁律 `world-peak-power-can-exceed-tier`：巅峰可超世界阶，要读 `peakPower` 而不是从 tier 推）
- 生物强度 `bioStrength` T0–T9 已是机械判定

```ts
// systems/causalWeight.ts
export function worldPowerRatio(actorTier: string, world: { tier?: string; peakPower?: string }): {
  R: number;
  verdict: 'dominate' | 'tactics_needed' | 'crowd_valid' | 'outmatched';
};
```

四种判定（比卡里多一档——卡里没考虑主角处于劣势的情况，无限流必须有）：

| R | 判定 | 叙事约束 |
|---|---|---|
| ≥1000 | `dominate` | 土著群体物理反抗成功率 = 0；世界只能靠规则死穴/更高存在/非直接对抗（政治·信息·信仰）应对 |
| 10~1000 | `tactics_needed` | 可被「精心策划的群体战术 + 重大代价」克制 |
| 1~10 | `crowd_valid` | 数量/组织度/资源正常生效 |
| **<1** | **`outmatched`** | **群体逻辑对主角生效**——治「低阶主角在高阶世界横着走」 |

**注入点**：势力演化 / 领地 / 万族 / 世界事件 / 战斗结算前 / 任务结算。输出一行 `[因果权重] 主角(四阶) vs 本世界(一阶·巅峰=二阶) R≈64 → tactics_needed`。

**与既有系统的关系**：这与 `bioStrength` 机械判定、`npcGrowthGuard`、派遣的确定性结算是同一套哲学（前端算死、AI 只叙述），不是新范式。

### ⑤ 去主角中心填表 → 加一个「可见性」例外

原样照抄会矫枉过正：主角在本世界杀了城主、平了灾，土著**应该**反应。卡里的配额 = 0 是针对「非公开行为」的。

**适配**：把配额规则挂到四维声誉的**可见性前提**上——
- 有目击者 / 留下物证 / 传闻已发酵 → 允许 NPC 因此行动（且必须能指出信息是从哪条传闻/哪个目击者来的）
- 无人知晓的隐秘行为 → 配额 0，一个 NPC 都不许因此行动
- 这条与既有 `ANTI_OMNISCIENCE_RULE`（管认知）互补：那条管「知不知道」，这条管「动机能不能建立在这上面」

---

## 4. P1 重排（作用域一确定，优先级就变了）

| 原编号 | 项 | 轮回乐园裁决 |
|---|---|---|
| ⑥ | 世界事件生命周期 | **保留，作用域 `world`**。配额降到背景 ≤3。离世未结算 → `未了伏笔` |
| ⑦ | 传闻流变 | **保留且提前**——见 §5.1，无限流里它是最香的一项。时效压到 1~3 天 |
| ⑧ | 四维声誉 | **拆成两套**：世界内声誉（`world`·离世折算成一句名声）+ 乐园声望（`paradise`·永久，见 §5.5） |
| ⑨ | 势力外交八级 | **保留，事件链压到 3 阶段**，离世按完成比例强制判定 |
| ⑩ | NPC 三层记忆 | **保留，但只给 `paradise` 作用域的 NPC**（契约者/随从/宠物）——土著几十回合内积累不出三层记忆，给了也是浪费 |
| ⑪ | 时代演化 | **从任务世界移除，整套搬到 `cosmosStore`**——见 §5.6 |
| ⑫ | 经济简报 | **降级**：任务世界只做「进世界一次性播种物价气候 + 大事件才动」，不做周期演进 |
| ⑬ | 资产账本 | 维持原判：只取三条护栏（门禁 / 闭环 Pass-Fail / 常备收支对称） |
| ⑭ | 社交圈 | 维持原判：改造成 `relationGraph` 的社区检测派生层 |

---

## 5. 只有轮回乐园才有的缝合点

这一节是适配的真正价值——**卡里没有、但前端已有现成数据可以白嫖的接口**。

### 5.1 `plotDrift` / `priorLegacy` → 传闻系统的免费种子

`enterWorld` 已经在往正文里注入两段：
- **剧情偏移**：「本世界已被前任契约者改写·相对原著已偏移成如下现状」
- **前人遗产**：「主角会遇到前任契约者留下的遗物/组织/传说/改变的人物/烂摊子」

这两段**天生就是传闻**——它们描述的正是「世界上流传着关于某个来历不明的强者的说法」。

**做法**：进世界时用它们直接播种 2~3 条初始传闻（零额外 API，纯文本切分 + 一次已有调用顺带产出）：

```
传闻「铁面客的赌约」
  影响力: 圈内谈资        流传范围: 城南赌坊一带
  节点1  真相: 三年前一名契约者在此屠了黑帮堂口，事后离世
         传闻描述: 有个戴铁面的外乡人一夜之间清了南堂，赢走了全部赌本
         事实偏差: 世人以为是赌债纠纷，不知对方是外来者、也不知他早已不在此世
         流变诱因: 前任契约者留下的遗产（世界卡·前人遗产）
```

这一条就把「前人遗产」从**一次性入场白**变成了**可被主角调查、可继续流变、可在离世时升格进编年史的活对象**。

### 5.2 `contractorDist` → 世界事件的参与者名册

世界卡的「契约者分布」已经写明本世界还有哪些契约者/重要人物。世界事件的 `参与角色` 字段直接从这里取，不用 AI 现编——顺带解决「世界空无一人」的老问题（世界卡里那段提示词本来就是为此写的）。

### 5.3 原著路线（canon）→ 事件派生的硬闸门

若当前世界是原著世界（`canonRouteStore` 有站点数据）：
- 世界事件**必须贴着站点走**，不许派生偏离主线的背景事件
- `isCanonLocked` 的人物（白夜/苏晓等）**不能被世界事件杀死或改数值**——既有 `enforceCanonLock` 每回合复位，事件系统必须在生成侧就拦住，否则每回合打架
- 传闻可以自由生成（传闻是"说法"，不改事实，天然安全）

### 5.4 事件结算 → 世界之源 + 派生任务

这是让玩家**有理由关心后台演化**的关键。没有这一步，世界事件永远是背景装饰。

- 事件结算判定为「重大历史事件」→ 贡献世界之源 %（走既有结算口径，评级环 0.75 + 源 0.25）
- 事件结算判定为「活跃事件」→ **派生一条支线任务**进 `miscStore.tasks`（走既有任务闸门：新建配额支线 4 条）
- 主角**主动介入**某个世界事件 → 该事件的结算条件里记一笔，离世评级时可见

⚠ 遵守既有铁律 `world-settlement-and-quest-rules`：一世界一主线、路线图即锁。世界事件只能派生**支线**，绝不能改主线。

### 5.5 乐园声望：卡里完全没有，但无限流必须有

四维声誉在任务世界里活不了几十回合就归零，价值有限。真正该永久累积的是**主角在轮回乐园的名声**——而前端已经攒了一堆数据却从没汇总过：

| 已有数据 | 现状 |
|---|---|
| `arenaRank` 竞技场排名 | 只在主角卡显示 |
| `brandLevel` 烙印等级 | 只当赌坊贵宾厅门槛 |
| 深渊最深层 / 通关次数 | 只在设施近况一行 |
| 冒险团阶位 E~SSS | 只在团队面板 |
| 公会贡献 / perks | 只算机械加成 |
| 丰碑 / 时长排行 | 各自独立 |
| 历次世界结算评级 | 散在各 `WorldRecord.summary.综合评价` |

**做法**：`systems/paradiseFame.ts` 做一个**纯派生**的乐园声望（不新建 store，零存档改动）：

```ts
export function paradiseFame(): { tier: string; sources: { label: string; weight: number }[] };
// 例：'名号在外' ← 竞技场前100(0.3) + 深渊第37层(0.2) + 冒险团A阶(0.2) + 三次S级通关(0.3)
```

用途：
- 注入正文的 `<设施近况>`（已有）升级成「乐园声望」一行，让契约者 NPC 的初始态度、私信砍价、频道互动都读它
- 契约者 NPC 建档时的初始 `trust/respect` 基线从它派生（而不是恒定 10）
- **跨世界传闻**：进新世界时，若声望够高，本世界的其他契约者可能"听说过你"——这才是无限流该有的爽点，且完全不破坏土著的认知隔离（土著仍然一无所知）

### 5.6 时代演化 → 搬到万族层（`cosmosStore`）

原方案 ⑪ 在任务世界跑不动，但 `cosmosStore` 是**跨世界永久层**，进度慢慢涨恰好合适。而且它已经有对应字段：

| 卡里的时代模型 | `CosmosEntity` 现有字段 |
|---|---|
| 世界时代阶段 | `era`（纪元变动） |
| 潜在时代演化（进度/萌芽·发展·临界） | 需新增 `eraProgress?: { name; pct; phase; drivers; blockers }[]` |
| 时代关键转折点（干预方向/强度） | 可挂 `deeds`（大事记）+ 新增干预标注 |
| 岁月史书·正史 | **投影进 `chronicleStore`**（已有卷→页→注三层） |
| 史诗传奇 | 已有 `deeds` + 编年史，不必新建 |

确定性算法（`systems/eraModel.ts`）全部前端算：净干预值（高 ±2 / 中 ±1 / 低 ±0.5 求和）→ 定鼎/归墟/派生；进度 ≥80% 派生临界事件；相关潜在时代自动合并。AI 只负责命名与叙述。

**唯一无条件值得先抄的**是卡里那段「演变纪命名规范」——它禁止「蒸汽时代至电气时代」式的时代标签拼接，要求用「环海争贡之乱」「银票挤兑风潮」这类**具体事象专名**（给了 6 正例 6 反例）。这段直接搬给 `chronicle` 的修史阶段（`CHRONICLE_COMPILE_RULE`）即可见效，**不依赖任何其他改动**。

---

## 6. 修订后的实施顺序

### 第 0 批 · 地基（必须最先）— ✅ 已实装 2026-08-04

- **`systems/worldScope.ts`**（+ `worldScope.test.ts` 18 例全绿）
  - `isHomeWorld` 的**单一真相迁到此处**，`playerVitals` 改为 re-export → 全仓 ~20 处调用点一字未改，
    且 worldScope 零重依赖，`npcAutonomy` 这类底层模块可安全 import（依赖单向：playerVitals → worldScope）
  - `freezeWorld(world, turn)` / `thawWorld(world)` / `reconcileWorldScope(current, turn)` / `activeNpcs` / `frozenNpcsByWorld`
- **`NpcRecord.worldName?` / `frozenAt?`**（均可选·老档无缝）；不变量 `frozenAt ⟹ !onScene`，与 `archived` 正交
- **建档即落归属**：`applyEntryResult` 的新建 + 重入两处，在打 `npcTag` 的同一位置补 `worldName`（重入那处顺带迁移老档）
- **`enterWorld`**：先抓 `prevWorldForScope`（必须在 `setTime({worldName})` 覆盖之前），
  离开旧世界 → `freezeWorld`；同名再入且玩家选「继承」→ `thawWorld`（选「重置」不解冻）
- **每回合兜底** `reconcileWorldScope()`：紧跟 `reconcileHomeWorld()`，覆盖读档 / AI 改写 worldName / 历史遗留
- **消费侧跳过冻结**：`computeFocusList`（在场·离场·好友三处）+ `npcAutonomy` 的 `eligible`
- **顺带修的既有 leak**：`WorldEvent.worldName?` + `addWorldEvent` 自动落归属 +
  `buildWorldTimeInjection` 读时按世界过滤 —— 此前换世界后仍在把**上个世界的大事**喂进每一次正文

**保护名单**（永不冻结）：`isBond` / `keepForever` / `isFriend` / `partyMember` / `monumentId` / `assistOwnerId` / `isCanonLocked`。
**宁漏勿误**：`worldName` 为空一律不冻；势力 `worldName` 为空也不动（可能是乐园势力，误关会让它从面板消失）。

> 门禁：`npm run typecheck` ✓ · `npm test` 1827 例全绿 ✓ · `npm run lint` ✓ · `vite build` ✓ · dist 预览启动无控制台报错 ✓
> ⚠ **未做端到端实机验证**——完整走一遍「建角色→进世界→攒NPC→换世界」需要可用的正文 API，
> 冻结/解冻语义由 18 个单测覆盖（用的是真实 zustand store 不是 mock），App.tsx 侧的接线只经人工复核 + 类型门禁。

### 第 1 批 · P0 五项 — ✅ 已实装 2026-08-04

| 项 | 新增 | 落点 |
|---|---|---|
| ④ 因果权重 R | `systems/causalWeight.ts` + 12 例测试 | `R = POWER_PER_TIER(=4) ^ 阶差`，四档；`worldPowerReport` **群体基准取世界阶、巅峰另取 `peakPower` 扫最高阶名**（铁律：巅峰可超世界阶）。`CAUSAL_WEIGHT_RULE` + `causalWeightInjection()` 注入 NPC 演化 + 杂项演化 |
| ③ 驱动力闸门 | `systems/npcDrive.ts` + 13 例测试 | `driveOf` 按 npcTag 分流（在场>羁绊>任务>局势>社交）；接 `computeFocusList` 的 offCands。**静滞者仍走轨道A**，只是不花演化 API |
| ① 命运罗盘 | `systems/divination.ts` + 13 例测试 | 易经 64 卦 + 大/小阿卡那；种子绑「世界+事件段」不绑回合。⚠ **只进演化阶段永不进正文**；注入块自带封词铁则，另有 `hasDivinationLeak`/`scrubDivination` 在杂项演化落库后兜底清洗 worldEvents |
| ② 入场/离场提示 | `systems/castHint.ts` | `NpcAuto.readyToEnter/enterReason/exitReason`；`runNpcAutonomy` 末尾对**全部 eligible 每轮重算**（不只 ranked，否则会"永远在门口徘徊"）；`buildCastHintInjection` 排注入链最末。入场理由语料按 npcTag 分流——土著只能写世界内生活理由 |
| ⑤ 去中心填表 | — | `promptRules.NPC_DECENTER_RULE`：动机独立性逐人填表 + 非公开行为关联**配额=0**，可见性例外挂在"目击者/物证/传闻"上（主角公开做的大事土著本来就该反应） |
| **附赠** | — | 「卷名/条目命名·史学式专名」并入 `CHRONICLE_COMPILE_RULE`（6 正例 6 反例·禁「XX时代至YY时代」式拼接） |

两条新提示词已注册进**预设中心**（`promptRegistry` → 演化阶段组），玩家可改。

> 门禁：`npm run typecheck` ✓ · `npm test` **1894 例全绿**（新增 38 例）· `npm run lint` 0 error ✓ · `vite build` ✓ · dist 预览启动无控制台报错 ✓
> ⚠ 同第 0 批：**未做端到端实机验证**（需可用的正文 API 才能真跑一轮演化）。纯函数层由单测覆盖，注入与接线经人工复核 + 类型门禁。

### 第 2 批 · 传闻优先

**⑦ 传闻流变 + §5.1 播种 — ✅ 已实装 2026-08-04**

- **`systems/rumor.ts`**（+ 21 例测试）：`Rumor`/`RumorNode` 模型 = **真相 / 流传 / 偏差 / 诱因** 四分；
  `isDue`（时效闸门·世界时间比对，解析不出回落 `FALLBACK_DUE_TURNS=8` 回合兜底，绝不永冻）、
  `needsCompress`+`compressRumor`（阈值 **3**·保留最早日期 + 最新认知 + 全程诱因串）、
  `pruneRumors`（上限 **5**·按影响力为主的价值分裁剪）、`shouldPromote`（文化烙印 → 升格）、
  `worldRumors`（world 作用域·空 worldName 放行，与 worldScope 同口径）
- **`miscStore.rumors`** + `addRumor`/`appendRumorNode`（**只 append 新 seq，绝不覆盖历史**）/`updateRumor`/`removeRumor`/`setRumors`；进 `clearMisc`
- **指令**（`miscParser`·`domain:'world'`）：`addRumor` / `rumorNode` / `setRumor` / `deleteRumor`，中英键名都认
- **提示词** `RUMOR_EVOLUTION_RULE`（已进预设中心）：三分铁则 + **时效闸门（未到期一条指令都不发＝省 token）** +
  影响力一次只动一档 + 禁止给主角**非公开**行为编传闻
- **前端确定性维护** `reconcileRumors()`（演化阶段之后跑）：压缩 / 「文化烙印」升格成世界大事并移除 / 超额裁剪 —— 机械活不交给 AI
- **§5.1 播种**：`seedRumorsFromWorldCard` 在 `enterWorld` 把世界卡的 `plotDrift`/`priorLegacy` 切成 1~2 条初始传闻
  （**零 API**）。真相写「实为前任契约者所为，其人早已离开」，偏差写「世人只当是奇人异事」——三分在这里天然成立。仅新世界播种，继承时沿用旧传闻。
- **⚠ 正文注入只给 `told`**：`<市井流言>` 块只出流传版本 + 影响力/范围，**绝不出真相与偏差**（有专门单测守卫）。
  门槛 = 影响力 ≥「局部焦点」，最多 4 条。真相只进演化阶段与玩家面板。

> 门禁：`typecheck` ✓ · `npm test` **1915 例全绿**（新增 21）· `lint` 0 error ✓ · `build` ✓ · dist 预览启动无报错 ✓

**⑥ 世界事件生命周期 + §5.4 派生支线 + 面板 UI — ✅ 已实装 2026-08-04**

- **`systems/worldEvent.ts`**（+ 16 例测试）：`scopeOf`（背景/区域·缺省区域）、`latestChain`（老条目回退 desc）、
  `activeEvents`（world 作用域 + 未结算）、`overflowIds`（**背景 ≤3 / 区域 ≤3 分别计**·按"有结算条件 > 脉络长 > 新的"保留）、
  `pendingDerivations`/`buildDerivationInjection`、`serializeEventsForEvo`（脉络只取最近 3 节防膨胀）
- **`WorldEvent` 扩展**（全可选·老档=单节点扁平事件）：`name`/`scope`/`guide`/`actors`/**`chain`**/`settleCond`/`settledAt`/`outcome`/`derivedAt`
- **store**：`appendEventChain`（**只追加**）/`settleWorldEvent`（结算陈述并入脉络末尾而非覆盖 desc）/`markEventDerived`
- **指令**：`newEvent` / `eventChain` / `settleEvent` / `setEvent`（旧三参 `addWorldEvent` 仍兼容）
- **提示词** `WORLD_EVENT_LIFECYCLE_RULE`（已进预设中心）：**推进=追加脉络、绝不覆盖描述**；结算条件必填；三级结算
- **前端维护** `reconcileWorldEvents()`：超配额标为「湮灭」而**不物理删**（铁律「库房只存不删」）
- **§5.4 派生支线**：`outcome='derived'` → `buildDerivationInjection` 注入**任务演化阶段**当候选钩子，
  建不建仍由既有任务闸门定（不绕过支线新建配额）；跑完即 `markEventDerived` 防重复劝
- **正文注入升级**：`buildWorldTimeInjection` 改取**最新脉络节点**而非最初 desc（此前推进几轮后正文读到的还是"刚发生时那一句"），并排除已结算事件
- **UI**：`MiscPanel` 加「📢 传闻」页签（影响力五档色阶 · **真相/偏差默认折叠**·逐条独立展开）；
  「世界大事」页升级成脉络时间线 + 档位徽章 + 结算条件 + 🏁 落幕标记（已结算条目淡化）

> ⚠ **刻意不碰 `worldSource`**：世界之源的唯一权威口径是 AI 每回合按正文末尾隐藏块发一条
> `character.B1.worldSource = X`（**绝对赋值**）。前端 `+=` 会在下一回合被整个覆盖，看着像"加了又没加"。
> 所以重大事件的回报走「进世界大事 + 编年史 + 派生支线」，不动那个数。

> 门禁：`npm test` **1957 例全绿**（新增 16）· `lint` 0 error ✓ · `build` ✓
> **实机验证（本批首次真跑 UI）**：注入测试数据 → 页签计数正确（世界大事 (2)：3 条里 1 条已结算被排除）→
> 传闻页 `told` 可见、**`truth`/`drift` 不在 DOM 里**、展开后才出现且逐条独立 → 世界大事页脉络双节点/结算条件/🏁湮灭标记/老条目回退 desc 均正确。验完已清除测试数据。
> ⚠ 仍未验的是**演化阶段真跑一轮**（需可用的正文 API）——指令解析与提示词只经单测与人工复核。

### 第 3 批 · 声望与格局 — ✅ 已实装 2026-08-04

| 项 | 新增 | 要点 |
|---|---|---|
| §5.5 乐园声望 | `systems/paradiseFame.ts` + 14 例 | **纯派生·零 store／零存档改动**。聚合竞技场名次／烙印等级／深渊层深与通关／团阶／公会／历次通关评级（取最好 3 次）→ 七档名号。用途：注入 `<乐园声望>`、`contractorBaseline()` 给契约者 NPC 铺初始 trust/respect（**只给契约者**，土著一无所知）、`isRenowned()` 第 5 档起"其他契约者可能听说过你" |
| ⑧ 四维声誉 | `systems/reputation.ts` + 21 例 | 官方/民间/暗域/业界各 6 级、独立升降。**三道确定性护栏**：① **可见性闸门**——写不出"谁看见的/什么物证/哪条传闻"就**整批拒绝**（无人知晓只影响个人恩怨）② 单次最多 3 维 ③ 非崩塌事件一次一档。`dimForObserver` 让不同圈子的 NPC 读不同维度。`world` 作用域：离世折算成一句写进 `继承要点.主角名声` 后重置，回乐园也兜底重置 |
| ⑨ 势力外交八级 | `systems/diplomacy.ts` + 22 例 | 血盟→世仇八级 + **跨级闸门**：相邻一档随时可动，跨 ≥2 档必须走完对应事件链，否则**回落成渐变 1 档**（在 `applyFactionShortCommands` 里拦）。事件链**压到 3 阶段**（卡里 5 阶段在任务世界走不完）。例外直降只对降级有效。玩家杠杆 `intervene()`：调解／挑拨／代行。`forceSettle()` 离世按已完成阶段比例强制判定，不留悬案。顺带修了"AI 每次只写两条关系、其余全被抹掉" |
| ⑩ NPC 三层记忆 | `systems/memoryTiers.ts` + 19 例 | 近期(8)→沉淀(8)→核心(5)。`planDecay` **前端机械算"谁该动"**、AI 只负责"压缩成什么文字"。`reinterpretDirection` 四轴净变 ≥15 触发旧记忆重解读（warm 善意重解／cold 扭曲）。**⚠ 注入只给核心 + 最近 3 条**，沉淀层只在演化阶段用（此前全量注入是浪费大头）。`usesTieredMemory` 只给 paradise 作用域 NPC——土著攒不出三层 |

四条新提示词（`REPUTATION_RULE`／`DIPLOMACY_RULE`／`RUMOR_EVOLUTION_RULE`／`WORLD_EVENT_LIFECYCLE_RULE`）均已进**预设中心**。

> 门禁：`npm test` **2047 例全绿**（新增 76）· `tsc` **0 错** · `lint` 0 error · `build` ✓ · dist 预览启动正常 ✓
> ⚠ 未做端到端实机验证（需正文 API）——纯函数层单测覆盖，注入与闸门接线经人工复核 + 类型门禁。

### 第 4 批 · 长线
9. **§5.6 时代演化搬进 `cosmosStore`**
10. ⑫ 精简经济（进世界播种物价气候）
11. ⑬ 账本三护栏 / ⑭ 社交圈社区检测

---

## 7. 贯穿全程的注意事项

- **存档**：新 store 进 `saveManager.STORES` + `clearProgress`；⚠ `drpg-ledger` 已被物品闸门审计占用，别复用
- **世界时间调度**：`phaseSched` 只有 `every`（回合）。第 2 批的传闻时效判定需要 `everyGameDays?: number`，用 `gameClock.parseGameMinutes` 比对 `miscStore.worldTime` —— 这是第 2 批的前置小基建
- **提示词**：新常量进 `src/promptRules.ts` 并注册 `promptRegistry`（改即生效）
- **数值权威**：R 值 / 进度 / 净干预 / 传闻时效 / 记忆衰退 / 配额裁剪 **一律前端算死，AI 只写散文**——与派遣、强化、bioStrength、开箱一致
- **术语**：所有新提示词沿用统一映射（阶位/天赋 D-SSS/技能品级 7 档/进阶点数/乐园币·魂币），别让修仙词回流；五阶前「深渊」仍走 `scrubAbyss` 封词
- **设施接入**：任何新玩法产出（事件奖励/传闻调查所得）走 `facilityBridge.reportFacilityOutcome`，别自己写通报
- **导航**：新面板项须归入 `NAV_GROUPS`

---

## 8. 一句话总结

原方案是「把一张长连载世界卡的机制搬过来」；适配后的方案是**「把它拆成三个作用域，短命的留在任务世界并按世界寿命重标周期，永久的搬去乐园/宇宙层，然后在离世那一刻给每一类数据一个归宿」**。

你举的势力例子是公理 1 的一个实例——而真正该先做的，是把它一般化成 `worldScope.ts` 这层地基，因为接下来每个新系统都要回答同一个问题：**离开这个世界之后，你消失、你跟着走、还是你根本不在这一层？**
