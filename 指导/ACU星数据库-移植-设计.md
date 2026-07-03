# ACU 星数据库 III — 移植设计（把变量系统改成表格数据库）

> 目标：以 **ACU 星数据库**（酒馆助手「数据库本体」脚本）的表结构为**模板**，把 zhushen 现有的
> 「扁平变量 + 透明变量桥」彻底改成**表格数据库**，并让表成为**单一真相**（游戏 store 逐步变成表的投影）。
> 本文是持续累积的研究+设计记录，边细读 ACU 源码边补充。

---

## 0. 来源与坐标（细读时按这里定位）

- 载入器：仓库根 `酒馆助手脚本-数据库本体.json` → `import 'https://gcore.jsdelivr.net/gh/AlbusKen/shujuku@spv5.5.6/index.js'`
- 上游仓库：**`AlbusKen/shujuku`**，版本 tag **`spv5.5.6`**（发新版改 @ 后的英文+数字）
- 原名：**ACU 星数据库 III**（早期叫 AutoCardUpdater）。SillyTavern 酒馆助手脚本，「记忆表格」流派。
- 架构：四层 `shared ← data ← service ← presentation`（单向依赖）。用 IndexedDB + 一个 SQLite 运行时库（sql.js）双存储模式。
- raw 前缀：`https://raw.githubusercontent.com/AlbusKen/shujuku/spv5.5.6/<path>`

### 关键源码文件地图
| 关注点 | 文件 |
|---|---|
| **8 张默认表定义** | `src/shared/table-defaults/{global-state,protagonist-info,important-chars,protagonist-skills,inventory,quests-events,chronicle,options}.js` + `index.js`(组装) |
| 恋爱特化覆盖表 | `src/shared/table-defaults/romance-overrides.js`（20KB，同名表覆盖，当前默认套这个）+ `mate.js` |
| **AI 表指令解析（写路径核心）** | `src/service/ai/prompt-builder/table-edit-parser.ts`（27.6KB） |
| 严格 JSON 填表模式（SQL 的替代） | `src/service/ai/prompt-builder/strict-json-table-fill.ts`（12.8KB） |
| **更新总编排** | `src/service/table/update-orchestrator.ts`（118.7KB，巨） |
| 更新调度（何时填表） | `src/service/table/update-scheduler.ts`（15.7KB） |
| 表 CRUD 服务 | `src/service/table/table-service.ts`（29.3KB）、`native-table-service-adapter.ts`（数组模式） |
| SQLite 模式服务 | `src/service/table/sql-table-service.ts`（36.1KB）、`src/data/sqlite/sqlite-engine.ts` |
| 提交/队列/事务/增量 | `table-update-commit.ts`、`table-update-queue.ts`、`table-write-transaction.ts`、`table-delta.ts`、`table-history.ts` |
| 填表提示词（char card prompt） | `src/shared/defaults-json.js` 里 `DEFAULT_CHAR_CARD_PROMPT_ACU` / `_SQL_` / `_STRICT_JSON_` 变体 |
| 表定义模板常量 | `src/shared/defaults-json.js` 的 `DEFAULT_TABLE_TEMPLATE_ACU`（双重编码 JSON 字符串） |
| 语法/建表文档 | `docs/syntax-reference.md`、`docs/自定义表建表指南.md`、`docs/条件模板语法说明.md`、`docs/sqlite-runtime-db-design.md` |

---

## 1. 一张表的定义结构（AcuSheet —— 要照抄的模板）

```ts
interface AcuSheet {
  uid: string;              // 稳定唯一ID，如 "sheet_DpKcVGqg"
  name: string;             // 中文表名，如 "主角信息表"
  sourceData: {
    note: string;           // 表说明 + 逐列含义（AI 靠这个认列）
    initNode: string;       // 初始化触发：何时建初始行
    insertNode: string;     // 新增触发：何时/能否 INSERT
    updateNode: string;     // 更新触发：何时 UPDATE（带 SQL 示例）
    deleteNode: string;     // 删除触发：何时/能否 DELETE
    ddl: string;            // SQL 建表语句，每列带 -- 中文名 注释
  };
  content: string[][];      // 二维数组：content[0]=中文表头，其后每行是数据行（含 row_id）
  updateConfig: {           // 更新调度参数，-1 = 跟随全局设置
    uiSentinel; contextDepth; updateFrequency; batchSize; skipFloors;
  };
  exportConfig: {           // 这张表怎么注入正文（导出成世界书条目）
    enabled; splitByRow; entryName;
    entryType;              // "constant"=蓝灯常驻 / 其它=关键词绿灯
    keywords; preventRecursion; injectionTemplate;
    extraIndexEnabled; extraIndexEntryName; extraIndexColumns; ...;  // 额外索引条目
    entryPlacement: { position: 'at_depth_as_system'; depth: 2; order: 10000 };  // 位置/深度/顺序
    extraIndexPlacement; fixedEntryPlacement; fixedIndexPlacement;
  };
  orderNo: number;          // 表排序
}
```

**三条铁则（和现在 `key = 值` 天差地别，这就是「彻底改变」的核心）：**
1. **AI 写表用 SQL 语句**（见 §3）。不是键值赋值。
2. **列名双份**：DDL 用英文列（引擎按它操作）；note/content 表头用中文（AI 靠它认列）。
3. **DDL 的 CHECK / GLOB / NOT NULL / UNIQUE 是校验闸门**：AI 乱填会被拒（例：`is_absent IN ('是','否')`、`quantity>0`、时间 `GLOB '????-??-?? ??:??'`）。

### exportConfig 实例（主角信息表，来自 protagonist-info.js）
- `enabled:false`（默认不单独导出，靠总表注入）、`entryName:"主角信息"`、`entryType:"constant"`（蓝灯）
- `entryPlacement: { position:"at_depth_as_system", depth:2, order:10000 }` —— 以 system 角色注入到深度 2

---

## 2. ACU 自带 8 张表（真实 DDL，你的模板底表）

> 单行表：`row_id=1`，禁 INSERT，只 UPDATE。多行表：有 UNIQUE 业务键。

```sql
-- 全局数据表（单行）
CREATE TABLE global_state (
  row_id INTEGER PRIMARY KEY,
  current_location TEXT NOT NULL,                                   -- 主角当前所在地点
  cur_time TEXT NOT NULL CHECK(cur_time GLOB '????-??-?? ??:??'),   -- 当前时间
  prev_scene_time TEXT CHECK(prev_scene_time IS NULL OR prev_scene_time GLOB '????-??-?? ??:??'), -- 上轮场景时间
  elapsed_time TEXT                                                 -- 经过的时间
);

-- 主角信息表（单行）
CREATE TABLE protagonist_info (
  row_id INTEGER PRIMARY KEY,
  char_name TEXT NOT NULL,   -- 人物名称
  gender_age TEXT,           -- 性别/年龄
  appearance TEXT,           -- 外貌特征
  occupation TEXT,           -- 职业/身份
  past_experience TEXT,      -- 过往经历（增量更新，≤300字，超了压缩）
  personality TEXT           -- 性格特点
);

-- 重要角色表（多行）
CREATE TABLE important_characters (
  row_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,  -- 姓名
  gender_age TEXT,            -- 性别/年龄
  brief_intro TEXT,           -- 一句话介绍
  appearance TEXT,            -- 外貌特征
  key_items TEXT,             -- 持有的重要物品
  is_absent TEXT NOT NULL DEFAULT '否' CHECK(is_absent IN ('是','否')), -- 是否离场
  past_experience TEXT        -- 过往经历
);

-- 主角技能表（多行）
CREATE TABLE protagonist_skills (
  row_id INTEGER PRIMARY KEY,
  skill_name TEXT NOT NULL UNIQUE,                          -- 技能名称
  skill_type TEXT NOT NULL CHECK(skill_type IN ('被动','主动')), -- 技能类型
  skill_level TEXT,                                         -- 等级/阶段
  effect_desc TEXT                                          -- 效果描述
);

-- 背包物品表（多行）
CREATE TABLE inventory (
  row_id INTEGER PRIMARY KEY,
  item_name TEXT NOT NULL UNIQUE,                    -- 物品名称
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0), -- 数量
  description TEXT,                                  -- 描述/效果
  category TEXT                                      -- 类别
);

-- 任务与事件表（多行）
CREATE TABLE quests_events (
  row_id INTEGER PRIMARY KEY,
  quest_name TEXT NOT NULL UNIQUE,                              -- 任务名称
  quest_type TEXT NOT NULL CHECK(quest_type IN ('主线任务','支线任务')), -- 任务类型
  issuer TEXT,           -- 发布者
  detail_desc TEXT,      -- 详细描述
  current_progress TEXT, -- 当前进度
  time_limit TEXT,       -- 任务时限
  reward TEXT,           -- 奖励
  penalty TEXT           -- 惩罚
);

-- 纪要表（多行·日志）
CREATE TABLE chronicle (
  row_id INTEGER PRIMARY KEY,
  time_span TEXT NOT NULL CHECK(time_span GLOB '????-??-?? ??:?? ~ ????-??-?? ??:??'), -- 时间跨度
  location TEXT NOT NULL,      -- 地点
  chronicle_text TEXT NOT NULL, -- 纪要
  summary TEXT,               -- 概览
  code_index TEXT NOT NULL UNIQUE CHECK(code_index GLOB 'AM[0-9][0-9][0-9][0-9]') -- 编码索引
);

-- 选项表（单行）
CREATE TABLE options (
  row_id INTEGER PRIMARY KEY,
  option_1 TEXT NOT NULL, option_2 TEXT NOT NULL,
  option_3 TEXT NOT NULL, option_4 TEXT NOT NULL
);
```

---

## 3. AI 变量更新逻辑（★ 已细读 table-edit-parser.ts + 填表提示词）

### 3.0 大架构：填表是**独立的一次 AI 调用**（= zhushen 的演化阶段范式！）
ACU 不在正文里改表。它跑一个专门的 **「填表AI」** 二次调用（post-narrative），喂三类资料：
`<背景设定>`（人设）+ `<正文数据>`（上轮正文）+ `<当前表格数据>`（现表快照 $0）→ 让 AI 只输出表格编辑指令。
> **这与 zhushen `runPostNarrativePhases`/各 `run*Phase` 是同一个范式**：读正文+当前态→二次 API→解析→写回。
> 移植时「填表阶段」就是新加的一个 `run*Phase`，天然契合现有多阶段并发架构。

填表AI 的输出模板（`DEFAULT_CHAR_CARD_PROMPT_ACU`，mainSlot A）：
```
<thought>[分析剧情变化→读填表规则→定位要改的表/字段→逐步推理每步理由]</thought>
<content>
<tableEdit>
insertRow(表格ID, {"0":"字段0值","1":"字段1值","2":"字段2值"})
updateRow(表格ID, 行号, {"0":"字段0值","1":"字段1值"})
deleteRow(表格ID, 行号)
</tableEdit>
</content>
```

### 3.1 两种命令方言（默认=函数式，不是 SQL！）
- **函数式（默认 / 数组存储模式）**：`insertRow/updateRow/deleteRow`，本解析器 `table-edit-parser.ts` 直接跑。
- **SQL 式（SQLite 存储模式）**：`INSERT/UPDATE/DELETE`（`DEFAULT_CHAR_CARD_PROMPT_SQL_ACU`），由 `isSqlContent()` 识别后**转交 `table-update-commit` 提交模型**，解析器不直接改运行时 DB。
> 移植结论：**先移函数式**（纯 JS 数组操作，无需 SQL 引擎），SQLite 模式后置。

### 3.2 函数式命令语义（★ 照抄的写入契约）
- `insertRow(表格ID, data)`：新增一行。
- `updateRow(表格ID, 行号, data)`：改一行。
- `deleteRow(表格ID, 行号)`：删一行。
- **表格ID** = 表在**排序后序号**（`getSortedSheetKeys_ACU` 的下标），非表名。
- **行号** = 0 基的数据行号；实际 `content` 数组下标 = 行号+1（`content[0]` 是表头）。
- **data 对象按「列索引」为键**（0 基，**跳过 row_id**）：`{"0":值,"1":值,...}`。取值 `data[colIndex] || data[String(colIndex)] || ""`。
- insertRow 的新 row_id = `String(table.content.length)`（表头占 0，首条数据行 row_id="1"）。
- **格式硬规则**（提示词强制）：表格ID/行号纯数字；每列显式 `"数字键":"值"`；双引号；逗号后不加空格；值内引号转义 `\"`、换行 `\n`。

### 3.3 健壮性（AI 输出很脏，ACU 做了大量兜底 —— 移植要抄）
- **提取**：`<tableEdit>...</tableEdit>`，默认只取**最后一对**（`tableEditLastPairOnly`）；标签缺失时回退到含命令的 `<!-- -->` 注释块。
- **指令重组**：处理跨行指令（花括号配平判断 JSON 块未闭合）、一行挤多条（按 `;` + 命令前缀拆分）、行内 `//` 注释剥除。
- **JSON 抢救管线**（`json-sanitizer.ts`）：主 `JSON.parse` 失败 → `coerceLooseRowObject_ACU`（裸键/宽松）→ `sanitizeJsonPipeline_ACU`（多层清洗）→ 再抢救，全失败才丢弃该行。
- **全角冒号 `：`→`:`**、`'a'+'b'` 拼接清理、外层单引号剥除等预清洗。

### 3.4 闸门 / 保护（移植时对应「派生·校验闸门」）
- **锁系统**（`getTableLocksForSheet_ACU`）：行锁/列锁/单元格锁；`updateRow` 命中锁则跳过该行/列/格。玩家可锁定不让 AI 改。
- **更新模式** `updateMode`：`standard`/`summary`/`unified`/`manual*` 变体，闸门决定本轮能改**标准表**还是**总结表/总体大纲**（多趟更新分离）。
- **总结/大纲同步检查**：总结表与总体大纲的 insert 必须成对（各 1 条），否则本轮两表都不写（防错位）。
- **总结表/大纲禁 update/delete**（只 insert 追加日志）；含自动序号列（AM#### 由 `formatSummaryIndexCode_ACU` 重排）。
- **seedRows 物化**：空表（仅表头）在编辑前先把种子行铺进 content。
- **DDL 的 CHECK/GLOB/UNIQUE/NOT NULL** 是声明式校验（SQLite 模式由引擎强制；数组模式需移植方自己实现校验，否则只是给 AI 看的约束提示）。

### 3.5 更新触发调度（★ 已读 update-scheduler.ts）
按**楼层（AI 消息数）**驱动，**每张表独立**判断是否该更新：
- 每表 `updateConfig`：`updateFrequency`（0=该表不自动更新，N=每 N 个未记录楼层触发）、`contextDepth`/threshold（喂最近几楼当上下文，默认 3）、`skipFloors`（忽略最新 N 楼，防未定稿）、`batchSize`、`groupId`。
- 触发式：`未记录楼层 = (总AI楼 - skipFloors) - 上次更新楼 ≥ frequency`，且只更新落在最近 threshold 楼范围内的行。
- **分组并发**：按 `(groupId+indices+batchSize)` 把多表并成一组 → 一次「填表AI」调用批量填多表，多组并发（`maxConcurrentGroups`）。
- 前置：`autoUpdateEnabled` + API 就绪 + 未在更新中 + 对话≥2。楼层增长时先 `delayMs`(默认2000) 防抖。
- 更新后链条：刷新 → **自动合并总结**（`merge-logic`：把旧纪要压成长期记忆）→ **清理超保留层旧数据**。
> 移植取舍：zhushen 现在每回合都跑演化阶段，等价于 frequency=1、threshold=全部。ACU 的 per-table 频率/批量/分组是**省 token 优化**，MVP 可先全表每回合填，之后再加 updateConfig 调度。

### 3.6 三种填表模式对比（选移植目标）
| 模式 | AI 输出 | 定位方式 | 健壮性 | 移植建议 |
|---|---|---|---|---|
| **函数式 ops**（默认/数组存储） | `insertRow(表序,{列索引:值})` 等 | 表序号 + 行号 + **列索引** | 中（靠 JSON 抢救管线） | **先移这个**，纯 JS 数组操作 |
| **SQL**（SQLite 存储） | `INSERT/UPDATE/DELETE ... WHERE` | UNIQUE键/CHECK列/row_id | 高（引擎强校验） | 后置，需 sql.js |
| **strict-json**（结构化输出） | 严格 JSON 对象 | **列名 + where 字段匹配** | **最高**（schema 约束+唯一匹配） | **推荐最终目标**：列名比索引可维护，可配结构化输出 |

> strict-json（`strict-json-table-fill.ts`）用中文**列名**而非列索引、update 用 `where:{字段:值}` 唯一定位，
> 再规范化成 ops 或 SQL。对现代 LLM 最稳。zhushen 移植可直接瞄准 strict-json 风格（列名+where），跳过脆弱的列索引。

### 3.7 待续读
> 读/注入路径（§4：表→世界书条目 + `{[db...]}` 查询求值器）、table-update-commit/table-delta（增量提交/差异）、update-orchestrator.ts（118KB 总编排）、存储层（IndexedDB/SQLite 双模式、隔离 isolation）。

---

## 4. 读 / 注入路径（★ 已读 sql-query-var.ts + if-block-parser.ts）

三条读出去的通道：

### 4.1 表 → 世界书条目注入（exportConfig）
每张表按自己的 `exportConfig` 渲染成一个世界书条目注入上下文：`entryType`（constant=蓝灯常驻 / 关键词绿灯）、
`injectionTemplate`（渲染模板）、`entryPlacement:{position:'at_depth_as_system', depth, order}`（位置/深度/顺序）、
可选 `extraIndex`（额外索引条目）、`splitByRow`（按行拆条目）。实现在 `src/service/worldbook/injection-engine-*.ts` + `pipeline.ts`（未细读，量大）。

### 4.2 模板查询变量 `{[db...]}` / `{[sql...]}`（sql-query-var.ts，ORM 风格）
```
{[db.表名.where("列名","值").get("列名")]}          # 单值
{[db.表名.where("列名",">",数值).count()]}          # 计数
{[db.表名.all()]}                                    # 全部
{[sql "SELECT 列名 FROM 表名 WHERE 条件"]}           # 原生 SQL 兜底
{[db.表名.where(...).get(...) as 库存数量]}          # 存进变量，后续 $v:库存数量 复用
```
- **链式构建器 `TableQueryBuilder`**：`where/orWhere/whereIn/whereBetween/orderBy/limit/groupBy/having/distinct/offset/get/count/all/sum/avg/max/min/exists`。**⚠内部拼 SQL → `provider.executeQuery(sql)`，仅 SQLite 模式可用；native/数组模式 `executeQuery` 直接抛错**（见 native-table-service-adapter.ts）。即 ACU 的 `{[db]}`/`{[sql]}`/`<if db|sql>` 全是 **SQLite 专属**。
- **NameMapper**：`resolveTableName/resolveColumnName` 把**中文表名/列名 → 英文**，模板里可直接写中文。
- `as X` 把结果存进模块级 `_dbSqlVars`（每轮 `clearDbSqlVariables` 重置），供 `$v:X` 和 `<if>` 复用。
- 结果替换：单值替换标签；多行/多列格式化。

### 4.3 条件模板 `<if ...>`（if-block-parser.ts，递归 + else + 嵌套）
5 类条件（`<if 类型="表达式">…<else>…</if>`）：
| 类型 | 求值 | 含义 |
|---|---|---|
| `seed` | evaluateSeedExpression | 最新一条 AI 正文里是否含关键词 |
| `cell` | evaluateCellExpression | 表单元格表达式（如 `inventory/铁剑/数量 > 2`） |
| `cond` | evaluateCondExpression | 复合条件（`db:... & random:1-100 > 50`） |
| `db` | evaluateDbCondition | ORM 查询真假 |
| `sql` | evaluateSqlCondition | SQL 查询真假 |
- 递归解析（`maxNestingDepth` 默认 10），支持 `<else>` 与任意嵌套；选中分支先替换 `$v:` 变量再递归。

### 4.4 计算标签层（var-store-and-tags.ts，★ 全 native 可移植）
预设/世界书里还有一层「计算变量」标签，纯前端、不碰 SQL，对二创很实用：
- `<random min="1" max="100" />`（内联）/ `<random id="dice" min="1" max="6" />`（存变量）→ `$random:dice`。
- `<calc id="hp2" expr="cell:主角信息表/1/HP + 5 * $random:dice" />` → `$calc:hp2`。四则+括号，`new Function` 求值（正则白名单 `[\d+\-*/%().\s]` 防注入）。
- `<max id="m" values="v1,v2,…" />` / `<min …>` → `$max:m`/`$min:m`。
- 表达式取值来源：字面数字 / `cell:表名/行名/列名`（getCellValue）/ `$random|$calc|$max|$min:id`。

### 4.5 读路径 native 可移植性分层（★ Step 4 的准绳）
| 能力 | native/数组能用？ | zhushen 移植 |
|---|---|---|
| exportConfig 表→世界书条目注入 | ✅ | 照搬进 callApi 注入点 |
| `<if seed>` / `<if cell>`（cell-utils）| ✅ 纯数组 | 直接移（`表名/行/列 op 值`，全角运算符归一，数值自适应）|
| `<random>/<calc>/<max>/<min>` + `cell:`/`$*` 引用 | ✅ 纯前端 | 直接移，二创利器 |
| `{[db.表.where().get()]}`（TableQueryBuilder）| ❌ 抛错 | **走 sql.js 只读镜像**（方案 A·懒加载·可移 sql-query-var 或直接给 AI 生成的 SQL）|
| `{[sql …]}` / `<if db\|sql>` | ❌ 抛错 | 同上 sql.js 镜像 |

> **决策（2026-07-01）：SQLite 专属查询走【方案 A：tableStore 权威 + sql.js 只读镜像】**
> - 写：仍走 ops 解析 → `tableStore`（唯一真相；AI 用 `insertRow(...)` 比写 SQL 稳）。
> - 读：`{[db]}`/`{[sql]}`/`<if db|sql>` 需要时**从 tableStore 现建 sql.js 内存库**（每表 `CREATE TABLE`(ddl)+`INSERT`(content)，14 小表 <10ms，每回合建一次复用）→ 跑查询取结果。**查询面 100% 等于 ACU 真 SQLite，无双真相**。
> - sql.js（≈1MB wasm）**懒加载独立 chunk**，只在预设真用到时拉，不碰主 chunk/初始加载；.wasm 当 Pages 静态资源 + `locateFile`。
> - 备选 B（sql.js 当唯一真相、AI 用 SQL 写、facade 从 DB 投影）已评估**否决**（WASM 常载/DB 序列化/面板改读 SQL，代价大收益小）。
>
> **移植落点**：`<if cell/seed>` + 计算标签 = native 直接移（进 `stMacros.processMacros` 前置 pass）；`{[db]}`/`{[sql]}` = 新建懒加载 `tableSqlite.ts` Provider（Step 4 读路径一起落）。
> **写路径 Step 3** = 照 native 适配器：`applyEdits` 即 `parseAndApplyTableEdits`（ops 函数式解析），复刻进新 `tableEditParser.ts` → `tableStore`。

---

## 4A. 存储层（★ 事件溯源 —— 直接命中 item-evolution 理想）

**持久化模型 = 表状态挂在每条 AI 消息上**（SillyTavern message-variable 模式），按 **isolation 隔离槽**分库（≈ zhushen 存档槽，历史上限 20），Provider 启动/换档靠 `loadFromChat()` 从聊天记录**重放**重建。

**三种旧 per-message 模式 + v2 事件日志帧**：
- `checkpoint`（整表快照）/ `delta`（按 row_id 行级增量）/ `legacy`（无标记整快照）。
- **delta**（`table-delta.ts` 纯函数）：`buildTableDelta(base,next)`→ 行级 upsert/delete（按 row_id）+ 元数据变更；列结构变 / row_id 缺失或重复 → **退化成 checkpoint**。`applyTableDelta` 重放。**纯函数，可早移**。
- **v2 帧 `TableStorageFrameV2`** = `{version:2, headRevision, checkpoint, logEntries[]}`；每条 `logEntry`：`seq/entryId/createdAt/source/aiFloor/operations[]/baseRevision/parentRevision/commitRevision/writeSet`。`operations` 有 `sql_batch`（带参数绑定）/`table_edit_dsl`（insertRow 文本）/`sheet_replace`/`data_replace`。

> **★ 这一套 = 你 [[item-evolution-architecture-redesign]] 记的「理想 8 条」全套，已生产验证**：
> 事件溯源 ledger（logEntries）✓ 幂等键（entryId/seq）✓ 稳定 UID（row_id）✓ 单一闸门（commit）✓
> 审计（source/aiFloor/createdAt）✓ 确定性重放✓ 增量感知（delta）✓ 冲突集 writeSet（sheet/row/cell/schema）✓。
> **移植 ACU 顺带把你全局状态想要的架构带过来了**——不止是变量表，是整套可审计/可回滚/可对账的状态层。

**双 Provider**：`NativeTableServiceAdapter`（数组）/ `SqlTableService`（sql.js）；SQLite 加载失败**自动回退 native**。
> 移植取舍：MVP 用普通快照 store（`drpg-tables` 就地改）+ saveManager autosnap 当 undo；`table-delta` 纯函数可早移拿到审计/增量；要完整可回滚再上 v2 日志帧（建在 zhushen `chatDb` 每回合存 delta，天然契合你「读档靠 reload 重放」）。

## 4B. 编排与事务（★ 单一提交闸门 runTableUpdateCommit）

`executeCardUpdateCore_ACU` 一次填表的端到端：
1. 快照当前表 `rawBaseSnapshot` + 从 writeSet 捕获 `baseRevision`（乐观并发基线）。
2. `collectGroupFillResponse` —— 拼「填表AI」prompt（背景+正文+当前表）+ 调 API（带 retry）→ `aiResponse` + `tableEditText`。
3. 解析：`isSqlContent` 判 SQL 还是 DSL。
4. **`runTableUpdateCommit`（唯一写入闸门）**：`provider.applyEdits(text, updateMode)` → 更新 runtime → 把 checkpoint/delta/日志条目**挂到目标消息**（import 模式跳过存盘）。
5. **重试** `maxRetries=3`，失败把 `lastSqlError` 回喂 AI 重来。
6. **乐观并发**：`baseRevision + writeSet` 检测期间是否有并发写（sheet/row/cell/schema 粒度冲突）。

> 移植：对应 zhushen 一个新的 `runTableFillPhase`（post-narrative，并入 `runPostNarrativePhases`），内部 `stateParser` 解析 → `tableStore` 提交。
> 单机单写**不需要乐观并发**（可省 baseRevision/writeSet）；**retry-with-error 值得留**（AI 填表常出格式错）。所有写入走**单一 commit 函数** = item-evolution 想要的单一闸门。

## 5. 套到 zhushen（结构不动，改 DDL 的列装自己的东西）

- **protagonist_info 扩列**：`tier 阶位`、`level 等级`、`title 称号`、六维 `str/agi/con/int/cha/luck`、
  `hp/max_hp/ep/max_ep/san/max_san`、`hp_ratio/ep_ratio`、`world_source 世界之源`。
- **inventory 扩列**：`grade 品级`、`affix 词缀`、`slot 装备槽`、`equipped 已装备`、`enhance 强化`、`gems 宝石`。
- **protagonist_skills 扩列**：`grade 品级`、`belong 归属(B1/Cx)`、`cooldown 冷却`。
- **新增同结构表**：货币表 / 天赋表 / 称号表 / 势力表 / 领地表 / 冒险团表。
- CHECK 约束沿用轮回乐园术语（阶位 D–SSS、品级 7 档），当校验闸门防 AI 幻觉。

---

## 6. 移植步骤（表为单一真相）

| # | 文件 | 干什么 | 风险 |
|---|---|---|---|
| 1 | `src/systems/acuTableSpec.ts` ✅ | `AcuSheet` 类型 + **14 张表**（ACU 8 表模板 + zhushen 扩表/扩列，单行表预置 row_id=1 空行） | 零 |
| 2 | `src/store/tableStore.ts` ✅ | Zustand+persist(`drpg-tables`)，content 二维数组 CRUD（行号0基·data按列索引或中文列名·单行表禁insert/delete）+query+快照导入导出 | 低 |

> **进度**：Step 1–10 + 收尾 + **1c 投影** 全部完成并验证 —— tsc 0 新增 + **641 例全绿**（含 1c 投影 5 + 守卫 5 + 自愈 3）+ `vite build ✓` + **UI/迁移/自愈/投影实机预览验证通过**。数据层 + 写 + 读(native+sql.js) + 存档 + UI + 迁移 + 事件溯源(货币pilot) + 看门狗(抓+自愈) + **1c 单向投影** 全通。**核心移植完成，可实机玩**。Step 6c **明确不做(YAGNI·见下)**；**完整 facade(表当家)经 ROI 权衡用户选择跳过**，改走 **1c（store=真相·表=只读投影·见 §10-1c）根除漂移**。
> **✅ 遗留已清（原 ddl 不一致）**：acuTableSpec 各表 `sourceData.ddl` 现与 headers **列数完全一致**（早前某步已同步）；且新增 `acuTableSpec.test.ts` 把「ddl 列数==headers 列数」**下沉成机器守卫**（漂移即红），不再靠自觉。ddl 定位=纯规格/文档（英文列名+类型+CHECK 约束），运行时引擎/镜像走中文 headers。
| 3 | `src/systems/tableEditParser.ts` ✅ | 复刻 ACU ops 解析：`<tableEdit>` 提取(最后一对/`<!--`注释兜底) + 跨行重组/一行多条拆/剥`//` + `insertRow/updateRow/deleteRow` + lenientJsonParse 抢救 → applyTableEdits 写 tableStore。**比 ACU 稳**：表引用认 序号/uid/中文名，补裸数字键引号，全角逗号归一 | 中 |
| 4 | 改 `src/systems/stateApply.ts` ✅ | 在中枢 `applyAllUpdates`（正文/阶段回复应用唯一 chokepoint，物品也走这）末尾接 `applyTableEdits(raw)` → 写 tableStore（与 `<state>`/`<upstore>` 并存·仅含 `<tableEdit>` 的回复动手·其余 no-op）。单一提交闸门/幂等留作 §4B 硬化 | 中 |
| 5 | `promptRules.TABLE_FILL_RULE` + `systems/tablePrompt.ts` + `stateParser.stripStateBlocks` + App.tsx ✅ | 填表规则(ACU ops 契约+本作风格)+`buildTableFillPrompt()`(规则+当前表结构与数据快照=ACU`<当前表格数据>`)注入主正文；`<tableEdit>` 加进 stripStateBlocks 展示剥离。**无条件每回合注入**(可后续加设置开关) | 中 |
| 6a | `src/systems/tableTemplate.ts`（新）+ App.tsx ✅ | 读路径 native：`<if cell/seed>`（递归+else）+ 计算标签 `<random>/<calc>/<max>/<min>` + `cell:`/`$*` 引用，over tableStore。接进 `buildPresetMessages`（processMacros 之前对每块 content 求值·seedContent=末条正文）。cond/db/sql 判否留 6b | 中 |
| 6b | `src/systems/tableSqlite.ts`（新·懒加载 sql.js）+ tableTemplate/App.tsx ✅ | `{[db.表.where().get()]}` / `{[sql …]}` / `<if db\|sql>` / `as X`+`$v:`：从 tableStore 现建内存库（**中文表/列直建·类型按数据推断·无 NameMapper 无 ddl 依赖**）。App.tsx 拼预设前按 needsSqlite 懒加载 → tableTemplate 前置同步求值。wasm/js 独立 chunk 不碰主包 | 中 |
| 6c | exportConfig 注入 | **❎ 评估后不做（YAGNI）**：①数据已注入——Step 5 填表快照已给填表 AI 全量表数据，正文 AI 需要的游戏态又由现有 store 注入路径给到，6c 是冗余第二路径；②表还不是正文权威源（用户跳过 facade，表=store 镜像），给非权威数据建注入管道空转；③表原生数据也已覆盖——chronicle↔叙事/向量记忆、custom_vars↔[[transparent-variable-bridge]] `{{getvar}}/${名}`。exportConfig 结构体保留为 ACU 忠实字段+未来扩展点。| — |
| 7 | `src/systems/tableMigrate.ts`（新）+ TableManager 按钮 ✅ | `migrateStoresToTables({overwrite})` 把现有 store 播种进 5 核心表（主角/世界/货币/背包/NPC·best-effort·跳过无名NPC）；overwrite=false 只填空表、true 清空重灌。TableManager 加「↻ 从游戏态导入」按钮（overwrite+确认）。实机验证通过。**手动触发**（未做自动·避免 facade 前与 store 打架） | 中 |
| 8 | `src/components/TableManager.tsx`（新）+ SettingsPanel/VariableManager ✅ | 表编辑器：选表+可编辑网格+加/删行+单行护栏+重置；挂进 设置→变量管理→🗃表格数据库 卡片（Page 路由 table-manager·青光主题）。实机预览验证通过 | 低 |
| 9 | `systems/saveManager.ts` ✅ | `drpg-tables` 加进单一 `STORES` 注册表（=快照/读档/clearProgress/autosnap 全覆盖）+ `CLEAR_ON_MISSING`（老档无表→重置防泄漏）；clear=resetAll。**不进 configExport**（表是进度非配置） | 低 |
| 10 | **事件溯源内核**（重构方向·用户点破"补丁修了还复发"）| 根因=就地改可变状态·多写入方·无日志/幂等/重放/对账→反应式补丁追不上结构。真解=事件溯源（[[理想8条]]=ACU v2帧）。**10a✅** `eventCore.ts`（纯·域无关：commit单一闸门+幂等键+不可变日志+确定性rebuild+checkpoint+对账watchdog+snapshot；10测试证8性质）。**10b✅货币pilot(影子阶段)** `walletCore.ts`：货币真相接eventCore（复刻itemStore行为·零差），挂itemStore.adjustCurrency/setCurrency影子记账+seed对齐+每回合stateApply自动reconcile+saveManager纳drpg-wallet+TableManager「💰货币对账」状态栏；**实机验证:注入漂移→看门狗当场在面板抓出「⚠漂移 核心999/游戏0」**；64测试绿。**10c✅看门狗扩items/NPC(方向A)** `watchdog.ts`(纯只读不变量:货币漂移/物品重复id·无名·槽冲突/NPC幽灵·重名·id不一致)+接stateApply每回合自动跑+TableManager「🛡状态对账」栏；**实机验证:注入幽灵NPC→看门狗当场抓「幽灵NPC:C11」**；61 ledger测试绿。**10d✅看门狗自愈(抓→抓+自愈)** `watchdog.healWatchdog()`：检测到重复就调**现成已验证**修复(itemStore.dedupeByName/npcStore.dedupeByName/dedupeAliasNpcs/dedupeNpcItems)就地合并·返回 HealReport；接 App.tsx 回合末 pruneGhostNpcs 旁自动跑(幽灵归 pruneGhostNpcs·重复归 healWatchdog)+TableManager「🩹立即自愈」手动按钮；**实机验证:TableManager 渲染正常+按钮点击「无需自愈」+看门狗实时抓幽灵 C11**；81测试绿(含自愈3)。至此 recurring bug 每回合**自动抓+自动修+可见**。**完整 facade 翻转:经 ROI 权衡用户选择跳过**——表非 store 超集(PlayerProfile~40字段 vs 22列·物品含数组/对象不进扁平格)·翻转有损且高危·现有闸门(itemLedger reason去重+pruneGhostNpcs每回合)已覆盖主要 recurring bug。facade 若将来做:保 store API 不删只换内部 | 高 |
| §10-1c | **1c 单向投影（store=真相·表=只读投影·用户在 facade/并行间选的路）** ✅ | 治「表↔store 各填各的会漂移」：镜像表不再由 AI 填，**每回合从 store 派生**。落点：①`tableMigrate.ts` 重构成 13 张镜像表的**共享纯 builder**(主角/世界/货币/背包/NPC/技能/天赋/称号/势力/领地/冒险团/任务/自定义变量·从 player/game/item/npc/misc/character(B1)/faction/territory/team/variable 十 store 抽)；②新 `projectStoresToTables()` 在 `stateApply.applyAllUpdates` 于 store 更新后每回合跑(多行走新 `tableStore.replaceRows` 一表一次 set·高性能·单行 updateRow(0))；③`TABLE_FILL_RULE`+`buildTableFillPrompt` **收窄成只让 AI 填「纪要表」**(编年史·唯一表原生·store 无对应)，镜像表明示「别写·写了也被覆盖」，不再 dump 全表结构(省 token)；④`纪要表`故意不在镜像清单→投影绝不碰。**单一写入方=store → 表↔store 漂移从构造上不可能**(不是修·是让它没法发生)。**实机验证:TableManager 渲染正常+「从游戏态导入」对真实 store 跑通不崩(导入世界/货币)+ replaceRows 生效**；641 测试绿(1c 投影 5:漂移覆盖/纪要表不动/技能天赋称号·势力抽取/幂等)。**代价诚实说**:表由此变**store 的只读镜像/二创查询层**，非「表为单一真相」(那是 facade)；旧 `<state>`/`<upstore>`/variableStore **仍是权威**、未删——1c 只让表安全跟随，不动老写路径 | 中 |

> **字段审计补全（用户「表里缺变量·真实属性·没理智值」）**：①`主角信息表` 22→32 列——补 **真实属性**六维（真实力量…真实幸运 = 基础六维 + 真实属性点直加 `realAttrs`；口径同 PlayerSidebar「基础/真实」切换）+ 属性点/真实属性点/职业/生物强度；理智映射本就正确（`gameStore.player.san`，PlayerProfile 无 san/hp，都在 gameStore）。②`重要角色表` NPC 六维列原留空 → 填（`realAttr(npc)=attrs+realAttrs直加`）。③**加列必带持久化迁移**：老存档 `drpg-tables` 表头是旧的、`updateRow` 按列名加不进新列 → tableStore persist **version 1→2** `evolveTables()`（纯函数·按列名把旧行重映射进新表头·新列留空·旧数据不丢·保留用户自建表）。646 测试绿 + 实机（reload 触发迁移·主角表 33 列新列全到齐·无损无崩）。**加表列的定式**：改 `acuTableSpec`(headers+ddl 同步·守卫测试盯)→填 `tableMigrate` builder→若动列则 bump tableStore version + 扩 `evolveTables`。

> **补漏表（用户「有表被遗漏吗」·审计 51 个 store）**：14→17 张。补 ①`副职业表`(characterStore.subProfessions·和已建 技能/天赋/称号 同级·最该补·含配方名汇总) ②`成就表`(playerStore.achievements) ③`自定义能量条表`(resourceStore·怒气/堕落值等主角自设资源)；主角表加 `状态` 列(status+statusEffects 汇总)。**⚠序号铁则**：AI 引用表的「序号」= `sortedSheets()[idx]`(按 orderNo 排的 0 基位)，**新表 orderNo 必须追加(15/16/17)、绝不能插到中间**——否则顶掉已有序号(初用 1.5 插 currency 前→序号1/2 错位·3 个 tableEditParser 测试红)。tableStore **version 2→3**(`evolveTables` 幂等·老存档自动补新表+新列)。650 测试绿 + 实机(reload 触发 v2→v3·17 表齐·无崩无损)。**正确排除的 ~34 个非游戏态 store**：配置/生图/联机社交/创作模板/记忆召回/世界百科/战斗临时/基建。
> **万族/技能树/竞技场/深渊/丰碑 评估→都不做成游戏态表**：深渊=单局 run 态(腐蚀永不外泄)；丰碑=跨档元数据(独立存 drpg-monument)；技能树=解锁技能/天赋已进表·剩潜能点(标量)+树形图不适合扁平表；竞技场=榜单功能缓存·主角排名本在 profile.arenaRank；万族=宇宙背景设定非玩家态(想要"万族图鉴参考表"才做)。**改补更值的：6 个主角身份字段列**(profile 现成漏了：种族/性别/所属乐园/契约者编号/烙印等级/竞技场排名)→主角表 40 列·version 3→4·651 测试绿+实机(reload v3→v4·全到齐无崩)。**主角信息表至此最全**：身份 10 项 + 生物强度 + 基础六维 + 真实六维 + 属性点×2 + HP/EP/理智×2 + 状态 + 外貌/性格/经历。

> **按演化固定格式全字段补全（用户「真实属性和普通重合了 + 装备条目表里没有」）**：①**真实属性重合修**=`realAttrCell` 只在有真实属性点直加(`realAttrs>0`)才显示 基础+直加，无直加留空（治与基础六维数值重复）。②**背包表 10→25 列**（对齐 `InventoryItem`「固定条目模板·生成卡格式」：物品ID/类型细分/攻击防御/耐久度/觉醒/镶嵌孔/评分/获得途径/装备需求/产地/杀敌数/简介/外观/备注/标签）；③技能 7→15、④天赋 3→9、⑤称号 4→8（对齐各自固定格式）。字段权威来源=store interface 的「固定条目模板/固定格式」注释=演化提示词字段集。**⚠列索引铁则**：AI/parser 可按**列索引**写（如背包 `insertRow(2,{"0":名,"1":类,"2":级,"3":量})`）→ **新列必须追加、已有列位置不能动**（初把物品ID 插到第 0 列顶掉索引→3 个 tableEditParser 测试红→背包改「原 10 列位置固定 + 新列追加在后」修复；技能/天赋/称号无索引依赖可自由排）。version 4→5·652 测试绿·实机(强制 v1 重跑 migrate→inventory 26 列含全字段·前 5 列索引稳定·无崩；dev HMR 有竞态、生产一次性加载无此问题)。
> **NPC 完整信息（用户「NPC 物品栏/技能/天赋/其他都没记进表」）**：NPC 数据散在两 store（npcStore=身份+items；characterStore.characters[C-id]=skills/traits/titles）。用户选**独立 NPC 明细表**：17→20 张，加 `NPC物品表`/`NPC技能表`/`NPC天赋表`（各带「归属NPC」=姓名列·关系型·`WHERE 归属NPC=X` 查·orderNo 18/19/20 追加保序号）+ `重要角色表` 14→33 列补 NPC 标量（性别/职业/生物强度/年龄/标签/契约者编号/烙印/竞技场/HP·EP/称呼/背景/外观/动机/短长目标/内心·追加保列索引）。version 5→6·655 测试绿·实机(20 表·3 NPC 表全在·重要角色表 34 列·无崩)。`realNpcs()` 筛真名 NPC 共用。**NPC 真实属性（用户「角色也有真实属性」）**：NpcRecord 同样有 attrs+realAttrs → 重要角色表六维改回基础值 + 加 6 真实六维列（`realAttrCell` 主角/NPC 共用·无直加留空·追加保索引），与主角表口径一致。version 6→7·重要角色表 39 列·655 测试绿·实机(v7·40 列含真实六维·无崩)。
> **物品事件核心（用户「把物品也升级成钱那样的事件溯源」）**：继货币后第 2 域 `systems/ledger/itemCore.ts`（影子模式·仿 walletCore）。**关键=内容签名（名称｜品级）而非 id**——物品有堆叠/装备/强化/换 id，逐 id 影子会因两侧 id 分配不同产生假漂移；签名只认「这类物品总共几个」，稳健不误报。ops=create/consume/remove/seed·显式 id 才幂等（治双计）。挂 itemStore.addItem/consumeItem/removeItem 影子记账+stateApply 每回合 seedItemsIfEmpty 对齐+看门狗「物品」域加 itemDiagnostics 漂移+saveManager 纳 drpg-items-core。guard：核心空跳过对账。668 测试绿(itemCore 14)+实机启动无崩。**诚实**：主路径双计已被 itemLedger reason 去重挡；itemCore 增量价值=全域对账抓「绕过闸门/静默消失/非主路径双计」+审计日志+确定性重放。真根治全物品要翻 facade（未做）。
> **NPC 事件核心（用户「NPC 幽灵/重复建档也上影子对账」）**：第 3 域 `systems/ledger/npcCore.ts`。**诚实**：幽灵(name===id)/重复建档(同真名多 id)本就被 watchdog.npcChecks 点态抓 + pruneGhostNpcs/dedup 自愈；npcCore 独立增量价值=**溯源审计**（register 事件带 source·roster 记每个 NPC 首建来源/回合 → 追「反复冒的幽灵是哪个源造的」，重复报「首建源：登场判断·回合3」）+ 事件溯源结构。**对账 store-based** `reconcileNpcs`（只按 npcStore 现态报 幽灵/重复建档/id不一致·离场/漏挂路径不误报），已把 watchdog 的 npcChecks 逻辑并进来（去重不双报）。挂 upsertNpc 影子 register + stateApply seedNpcsIfEmpty + 看门狗 NPC 域改用 npcDiagnostics + saveManager 纳 drpg-npc-core。679 测试绿(npcCore 11)+实机启动无崩。**三域事件溯源影子（货币/物品/NPC）+ 每回合对账全落地**。**物品 facade 已翻（用户「现在就翻物品 facade」·本会话第一个真 facade）**：**关键=subscribe 闸门而非改 13 处 action**——`itemCore.commitItems(arr)` 按 **id 键去重**（同 id 只留首条·结构上根除"背包两条同 id 双计"）+ 塌缩审计；itemStore 加一个 `useItems.subscribe` 唯一 chokepoint（任何 items 变化含外部 setState/撤销都经它·塌缩才回写·循环护栏+try 兜底）→ **itemStore.items 结构上不可能有重复 id**。三重覆盖：subscribe（运行时）+ merge（读档 rehydrate·时序更可靠）+ init（补刀）。saveManager 纳 drpg-items-core。**实机双路径确证**（注入重复 id→reload→merge 塌掉 `DUP3 kept甲 dropped乙 source:rehydrate`；单测 setState 重复 id→subscribe 塌成一条）。685 测试绿。踩坑：persist name 是 `drpg-items`（复数）。看门狗"重复 id 被抓"测试改成"被 facade 结构性根除·无从抓"。**物品双计从根上杜绝**（不是抓+修·是让它没法存在）；货币/NPC 同法可扩。**NPC facade 已翻（用户「套到 NPC 幽灵/重复建档」）**：NPC 不像物品能按 id 键天然去重（npcStore 到处用 C-id 引用），故闸门=`useNpc.subscribe` 检测"两个 id 同一真名"→ 立即调**现成 careful `dedupeByName`** 合并（复用谨慎逻辑·不误吞装备）→ 重复建档无法跨状态变动存活。**幽灵刻意不进闸门**：pruneGhostNpcs 有严格登场时序（避免误删本回合正建档的新角色），eager 删会误伤——幽灵仍由 防建守卫 + pruneGhostNpcs 兜。687 测试绿·实机启动无崩。看门狗/heal 的 NPC 重复测试改成"被 facade 即时合并·无从抓/去"。**诚实边界**：NPC facade 是"eager 合并·重复不能持久"，非物品那种"结构上不可能"（NPC 没法按名键）；幽灵仍靠现有机制。

Step 1–3 全是新文件、零风险、可独立验证。

---

## 7. 关键决策 / 待办

- [x] 深度：**表为单一真相**（游戏 store 逐步变表的投影）
- [x] 结构：**照抄 ACU 的 AcuSheet 结构**，表清单是超集（ACU 8 表 + zhushen 扩表）
- [x] AI 写表命令：**ops 函数式**（`insertRow/updateRow/deleteRow`）为主，AI 稳、native 直跑；SQL 写不做（ACU SQLite 写属方案 B，已否决）
- [x] SQLite 读查询：**方案 A** —— tableStore 权威 + **懒加载 sql.js 只读镜像**跑 `{[db]}`/`{[sql]}`，查询面 100% 等 ACU，不碰主 chunk（Step 6 落）
- [ ] strict-json 填表模式要不要一起移（更稳但更啰嗦）
- [ ] 派生/不变量闸门（HP上限=六维加权等）如何叠在裸表上

### 细读进度
- [x] 表定义结构（AcuSheet）+ 8 表真实 DDL + exportConfig 形状
- [x] table-edit-parser.ts（写入解析：ops 命令 + 提取/重组/JSON 抢救/锁/更新模式）
- [x] 填表 char card prompt 全文（native ops 版 + SQL 版）
- [x] update-scheduler.ts（楼层触发 + per-table 频率/深度/跳过/批量/分组 + 自动合并 + 清理）
- [x] strict-json-table-fill.ts（JSON 填表模式：列名+where，最健壮）
- [x] 读路径：sql-query-var.ts（`{[db/sql]}` ORM+NameMapper）+ if-block-parser.ts（`<if>` 5 类条件）
- [x] 存储层：checkpoint/delta/v2 事件日志帧 + isolation 隔离槽 + native vs sqlite Provider（§4A）
- [x] 编排/事务：executeCardUpdateCore + 单一提交闸门 runTableUpdateCommit + 乐观并发 + retry（§4B，核心已读）
- [x] native-table-service-adapter.ts（applyEdits=parseAndApplyTableEdits；executeQuery/Mutation native 抛错=`{[db]}`SQLite专属）
- [x] name-mapper.ts（DDL 注释建中↔英映射；native 路径中文headers+列索引本就够，英文名可选）
- [x] cell-utils.ts（`<if cell>`/getCellValue：`表名/行/列 op 值` 纯数组·全角归一·数值自适应）
- [x] var-store-and-tags.ts（`<random>/<calc>/<max>/<min>`+`cell:`/`$*` 计算标签层·全 native）
- [x] sql-query-var.ts 全文（get/count/all/sum/exists 全走 provider.executeQuery=SQLite）
- [~] table-service.ts（547行·loadOrCreateJsonTableFromChatHistory 从聊天重建，ST专属不移，概念已懂）
- [ ] injection-engine-entries/custom（表→世界书条目的**具体渲染格式**，Step 4 注入时再读）
- [ ] sql-table-service.ts（SQLite Provider，仅上 sql.js 才需要）
- [ ] storage-frame-v2-persist/replay + table-write-transaction（v2 日志帧读写，上完整事件溯源时再读）
- [ ] seed-condition.ts（`<if seed>`/`<if cond>` 细节，Step 4 时读）
