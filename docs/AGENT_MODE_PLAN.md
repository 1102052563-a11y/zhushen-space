# Agent 正文模式 — 移植设计方案（参考 TauriTavern v2.2.0）

> **状态（2026-08-01）：P0 + P1 + P2 全部实施完毕**。代码位置见 `CODE_MAP.md §1` 的「🤖 Agent 正文模式」行；42 个单测（workspace/protocol/runtime/P1/P2）已入 vitest。
> P2 落地明细：① **多档案**（`AgentProfileSnapshot` 命名快照：cfg+独立API+agent/agentReview 路由；`saveAgentProfile`/`applyAgentProfile`/`deleteAgentProfile`；应用不改 enabled；提示词仍走全局预设中心）；② **末轮流式预览**（transport 加 `onProgress`，`extractJsonStringField`/`extractNarrativePreview` 从未完成的 JSON 参数流渐进抽 `output/main.md` 的 content 字段，120ms 节流回调 `onPreview` 流进楼层；commit 后预览让位清洗稿；**0 commit 终止时撤预览楼层**，维持"没 commit 就什么都不留"）；③ **评稿子代理**（运行时驱动的 finish 拦截：`runReviewerOnce` 走 `agentReview` 路由（回退 Agent 主接口）一次性审稿，首行 PASS 放行 / REVISE 作软错误 `agent.review_revision_requested` 回喂逼修订再 commit，最多 `reviewerPasses`(1~3) 轮，评稿调用失败 best-effort 放行；提示词 `AGENT_REVIEWER_RULE` 可在预设中心编辑）。
> P1 落地明细：① `persist/` 跨回合记忆（第 4 个工作区根·run 开始种入 `agentRunStore.persistFiles`、**仅 completed 收尾后 promote 回写**，单文件 24k/总 96k 上限；系统提示词已加 persist 用法两条）；② 运行中「中途指引」（Agent 运行时再发送→确认框→`submitGuidance` 入队（8 条/单 16k/总 64k），运行时**每轮开头 drain** 以 `<user_guidance>` 单条 user 注入；发送钮运行中保持可点、图标变 🎯；未消化的随 endRun 记 warn 丢弃）；③ 新工具 `quest_get`（复用 buildQuestInjection）/ `faction_get`（serializeFactionsSection）/ `db_query`（tableSqlite 新增 `agentSqlQuery` 只读单条 SELECT·强制 LIMIT 50·无参列表名）；④ per-tool 预算 `maxCallsPerTool`（软错误·暂无 UI）；⑤ run 概要归档回合洞察（TurnSnapshot.agentRun + InsightBody 一行展示）。P2 未动。
> 实施与方案的偏差：① 传输层始终 `stream:true`（防「假流式」中转对非流式回 204——项目已知坑），语义仍为非流式整轮处理；② API 独立性从「回退正文 API」收紧为「默认完全独立（agentApi + 'agent' 路由），勾选 useTextApi 才复用正文 API」（用户要求）；③ dice_roll 走内置极简公式骰（默认关）。

> 目标：在**不动现有正文生成方式**的前提下，新增一种**可选**的正文生成方式「Agent 模式」——
> 模型不再一次性吐正文，而是带工具循环工作：主动查游戏数据/搜历史/查世界书/打草稿/自我修订，
> 最后把成稿「提交」为聊天楼层，再走与现在完全相同的 `<state>` 解析与演化管线。
> 参考实现：TauriTavern（github.com/Darkatse/TauriTavern）的 Agent Mode（Rust 运行时 + 前端桥），本文已把其**行为规范**吃透并适配为纯浏览器 TS 实现。

---

## 0. 结论速览（TL;DR）

| 问题 | 决定 |
|---|---|
| 核心思想 | 照抄 TauriTavern 的定义：*一次生成 = 模型对一个受约束的虚拟 workspace 做一组可审计的编辑，最后由运行时把 artifact 提交为聊天消息*。工具循环、drift 纠偏、commit 闸门、partial success 全部照其行为规范复刻 |
| 在哪实现 | 纯前端 TS（它的 Rust 运行时是纯逻辑，无需要后端的东西）；新模块 `src/systems/agent/`，App.tsx 只开一个最小分支切口 |
| 原有方式 | **一行不改**。`agentMode off` 时 callApi 走原有流式路径；off 是默认值 |
| 上下文 | Agent 首轮 = 与 legacy **完全相同**的 prompt 快照（预设/世界书/召回/细纲/指导全带上），即 TauriTavern 的 `startRunFromLegacyGenerate` 思路 |
| 输出契约 | 最终正文格式与 legacy 完全一致（含状态栏 / `<state>` / `<upstore>` 等预设规定的模块）→ 下游解析/演化/UI **零改动** |
| 工具协议 | OpenAI 原生 function calling 为主 + **文本标签协议降级**（`<tool_call>{json}</tool_call>`，lenientJsonParse 解析）——TauriTavern 无降级路径（不支持 FC 即失败），我们的中转站生态必须有兜底 |
| 工具面 | 它的 workspace/chat/worldinfo/dice 工具 + **本项目特有数据源**：主角/NPC 档案、任务、向量资料库检索（这是移植的最大价值放大点） |
| 流式 | Agent 运行全程**非流式**（TauriTavern 同款；其 streaming Agent loop 也是未实现项）。运行过程用 Timeline 面板展示，正文在 commit 时整段出现 |
| UI | 发送按钮旁三态开关（off/on/running）+ 输入框上方一条可折叠 Timeline；聊天区不放占位楼层 |
| 不做 | 子代理/handoff、skill 系统、审批、checkpoint 回滚（TauriTavern 里三个也是未实现/纯审计）——列为远期可选 |

---

## 1. TauriTavern Agent 机制解读（浓缩）

### 1.1 一次 Agent Run 的生命周期

```
用户发送（agent 开关开）
  ↓ 照常执行 legacy 的 prompt 组装（预设/世界书/历史/宏），但不发请求
  ↓ 把组装好的 chat-completion payload「冻结」为 prompt snapshot
  ↓ 进入工具循环（非流式，round 1..=maxRounds，默认 80）：
      每轮 = 一次模型调用（带 tools 定义）
      ├─ 返回 tool_calls → 逐个执行 → 结果以 role=tool 回喂 → 下一轮
      ├─ 返回纯文本（drift）→ 文本存 workspace 的 direct_output.md
      │    → 把跑偏的 assistant 回合 + 一条合成 user 提醒推进历史 → 下一轮（共享轮数预算，无独立重试预算）
      ├─ workspace_commit → 宿主把 output/main.md 写成聊天楼层（首次=新建，再次=原地改写/追加）
      └─ workspace_finish → 结束（前台 run 必须已 commit ≥1 次，否则 finish 被降级为软错误提醒）
  ↓ 终态四种：completed / partial_success（有 commit 但没走完）/ failed / cancelled
```

### 1.2 必须照抄的行为规则（其代码里验证过的设计）

1. **轮数与预算双计数**：`maxRounds`（模型调用次数）与 `maxCallsPerRun`（工具调用总数）独立；**预算耗尽是软错误**（回喂模型 `agent.tool_budget_exhausted`），不是终止。
2. **致命 vs 可恢复的分界**：只有「模型调了注册表不存在的工具」和「finish 之后还有更多调用」是致命错误；**其余一切工具问题**（参数错、路径错、预算尽、policy 拒绝）都以 `is_error:true` 回喂模型让它自我修正。
3. **前台 commit 闸门**（三层）：系统提示词要求 → finish 时无 commit 则降级为软错误让模型补 → 超轮数才终止。
4. **partial success 唯一判据**：commit 台账非空。有 commit 的失败保留已提交楼层、`retryable=false`；无 commit 的失败什么都不留、模型违约类错误码（`model.tool_call_required` / `agent.tool_after_finish` / `agent.max_tool_rounds_exceeded`）给 `userRetryable=true`（UI 出重试按钮）。
5. **drift recovery**：直出文本先存 `direct_output.md`，提醒里明说「你的文本已存到 {path}，若这就是想要的回复，commit 该文件即可」——给模型一条低成本回收路径。
6. **read-before-edit 粘性规则**：改文件必须先读；部分读状态下 patch 一旦失败就置「必须整读」粘性标志；sha256 乐观锁防陈旧写。
7. **写类工具只回摘要**（"Wrote N chars to path"），不回全文——控制上下文膨胀。上下文**不裁剪不摘要**，全靠工具读上限（单条 8k 字符 / 单次 20k / workspace 单读 80k）控制。
8. **tool result 编码**：`role:"tool"` 消息的 content 是固定五字段 JSON 字符串 `{ok, content, structured, errorCode, resourceRefs}`；assistant 的 `tool_calls[].function.arguments` 是**字符串化 JSON**。
9. **UI 路由哲学**：不劫持生成函数，而是「生成前算出一个 options 对象」，空对象 = legacy 完全不变；错误码 `code: message` 结构化串 → 人话文案表。
10. **聊天区不放占位**：用户消息照常入档，AI 楼层直到首次 commit 才「凭空出现」；进度全在输入框上方的 timeline 条。
11. **系统提示词按实际启用的工具动态拼装**，头部 YAML 列工具清单，尾部给「基本调用流程模板」（commit 一次 / commit-N 次两种范式）。

### 1.3 它未实现/非目标（我们也不做，避免复刻空气）

流式 Agent 循环、工具审批、checkpoint 回滚（其 checkpoint 只写不读，纯审计）、MCP、plan 模式、多 agent 抢答。子代理/handoff 它已实现但复杂度高 → 我们列为远期。

---

## 2. 移植总体设计

### 2.1 三条铁则

1. **关闭即零改动**：`settings.agentNarrative.enabled=false`（默认）时，callApi 的执行路径与今天逐字节相同。切口只有一个 `if`。
2. **Agent 是旁路不是替代**：首轮上下文 = legacy 同款 `outMessages` 快照；终点回到同一条后处理管线。Agent 只改变「正文如何被生产」，不改变「正文长什么样、如何被消费」。
3. **输出契约不变**：预设照常注入 → 模型在 `output/main.md` 里写的就是带全部结构模块的正文 → commit 后走 `applyRegex → stripLeakedThinking → <state>/<upstore> 解析 → runPostNarrativePhases`，全部现有代码零改动。

### 2.2 与 TauriTavern 的差异适配（关键决策）

| # | TauriTavern | 本项目适配 | 理由 |
|---|---|---|---|
| D1 | Rust 后端运行时 + 前端轮询事件 | 纯前端 TS 运行时 + 同进程回调事件 | 无后端；同进程无需轮询/序列化，事件直接驱动 React |
| D2 | 仅原生 function calling，不支持即失败 | 原生 FC 为主 + 文本标签协议降级（`protocol:'auto'|'native'|'text'`） | 中转站生态里 FC 支持参差（有网关吞 `response_format` 的前科）；本项目全家桶本就靠文本标签协议（`<state>`）活着 |
| D3 | 真实文件系统 workspace（Rust 落盘） | 内存虚拟 FS（`Map<path,string>`），run 结束即弃；`persist/` 根落 store 持久化（P1） | 浏览器无 FS；审计文件（model-responses 等）改为 run journal 内存对象 |
| D4 | commit → 宿主经 saveReply 写楼层，多次 commit 原地改写 | commit → `setMessages` 建/改楼层（display 视图），**finish/partial 后才跑一次**清洗+`<state>` 解析+演化 | 本项目正文后处理很重（十余个演化阶段），绝不能每次 commit 都触发；必须等终态一次性结算 |
| D5 | 工具面向通用写作（chat/worldinfo/skill/workspace） | 保留其核心 + 新增 RPG 数据工具：`player_get`/`npc_get`/`npc_list`/`quest_get`/`lore_search`（向量检索）等 | 本项目数据源远比它丰富（20 张表/档案/RAG），这是 agent 模式真正的价值：**按需取数替代一股脑塞满提示词** |
| D6 | 完整 Agent Profile 体系（预设绑定/模型绑定/委派配置） | 单一设置组（settingsStore），API 路由走现成 `resolveApiChain('agent', 正文回退)` | 先把循环跑通；profile 化是纯增量，P2 再说 |
| D7 | maxRounds 默认 80 | 默认 **16**（可调 1~80），工具调用总预算默认 **40** | 它 80 轮服务于重度写作工坊；RPG 一回合典型 4~8 轮。每轮都带全量首轮上下文，成本随轮数线性涨，默认值要保守 |
| D8 | 运行中用户打字 → 「用户指引」注入下一轮 | P1 实现（照抄其 guidance 语义：单条 user 消息、`<user_guidance>` 包裹、限 8 条/64k 字） | P0 先保证取消可用（现有 stopGeneration/abortRef 直通） |
| D9 | swipe/regenerate 支持 + deleteSwipe 回滚策略 | 复用现有 ⟳重生成（reload+重发=天然新 run）；无 swipe 概念 → 无需回滚策略字段 | 本项目重生成本就是「回退再重放」，语义更简单 |
| D10 | 思考预填无此概念 | agent 模式下**跳过** `forceNarrativeThinking`/`skipNarrativeThinking` 的 assistant 预填 | 末尾 assistant 预填与 tools 请求在多数端点互斥；模型思考由其自然 CoT / reasoning_content 承担 |

---

## 3. 架构与数据流

### 3.1 数据流

```
sendMessage → callApi(userText)
  │（以下全部照旧：回合记账/细纲/剧情指导/推进/世界书匹配/向量召回/结构化档案/预设组装/深度注入）
  ├─→ outMessages 构建完成 ────────────────────────────────┐
  │                                                        │
  ├─ agent off（默认）→ 原有流式 fetch 循环（不动）          │
  │                                                        ▼
  └─ agent on → runAgentNarrative({                 ← src/systems/agent/agentRuntime.ts
        baseMessages: outMessages（去掉末尾 assistant 预填）,
        apiChain: resolveApiChain('agent', 正文API回退),
        inputs: { wbHits: 本回合命中的世界书条目, userText, ... },   // 供 worldinfo_read_activated 等工具读
        signal: ac.signal,                                  // 现有停止按钮直通
        onEvent: (ev) => {...timeline + 楼层 commit...},
      })
        │ 循环（§4 规范）……
        ▼
      终态 { status, narrative, journal }
        ├─ completed / partial → narrative 作为 accumulated 汇入 callApi 既有的
        │     「非流式完成处理」段：建/定稿楼层 → 清洗 → <state>/<upstore> → runPostNarrativePhases
        ├─ cancelled → 已 commit 的文本保留显示、不解析不演化（对齐 legacy 手动停止的语义）
        └─ failed → setGenError(错误码→中文文案)，无楼层残留
```

### 3.2 新增文件（按 DEV_WORKFLOW「新代码该放哪」归位）

| 文件 | 内容 | 约行数 |
|---|---|---|
| `src/systems/agent/agentTypes.ts` | 类型：`AgentToolSpec`/`AgentToolResult`/`AgentRunEvent`/`AgentRunResult`/设置类型 | ~120 |
| `src/systems/agent/agentWorkspace.ts` | 虚拟 FS + read-state 追踪（sha/observed_texts/粘性整读标志）+ list/search/read/write/patch 纯函数 | ~260 |
| `src/systems/agent/agentTools.ts` | 工具注册表（schema+实现）：workspace 系 + 游戏数据系；按设置过滤启用 | ~400 |
| `src/systems/agent/agentProtocol.ts` | 请求编码（native FC / 文本协议）+ 响应解码（tool_calls 解析、`<tool_call>` 标签解析、canonical 名回写、lenient 容错） | ~220 |
| `src/systems/agent/agentRuntime.ts` | 循环主体：轮数/预算/drift/commit 闸/取消/终态判定/事件发射 | ~300 |
| `src/systems/agent/agentPrompt.ts` | `buildAgentSystemPrompt(tools, opts)` 动态拼装 + drift 提醒模板（常量在 promptRules.ts） | ~120 |
| `src/promptRules.ts`（增量） | `AGENT_SYSTEM_RULE_*` 常量组 + 注册进 `promptRegistry.ts`（玩家可编辑） | +~80 |
| `src/store/agentRunStore.ts` | `drpg-agentrun`：最近 run journal（capped 10 条）+（P1）persist 文件；**saveManager STORES 注册 + clear**（进度类） | ~80 |
| `src/components/AgentTimeline.tsx` | 输入框上方折叠条（lazy 不必要——常驻小组件，eager） | ~180 |
| `App.tsx`（切口） | callApi 内一个 if 分支 + stopGeneration 无需改（signal 直通）+ ChatComposer 传 props | +~60 |
| `components/SettingsPanel.tsx`（增量） | 「正文生成」下新增 Agent 模式设置区（含 ApiRoutePicker `featureKey='agent'`） | +~120 |
| `components/ChatComposer.tsx`（增量） | 发送钮旁 🤖 三态开关 | +~30 |
| 测试 `src/systems/agent/*.test.ts` | 协议编解码 / workspace read-state / runtime mock 循环（§9） | ~300 |

---

## 4. 运行时行为规范（可直接照此实现）

### 4.1 循环

```ts
for (round = 1; round <= maxRounds; round++) {
  if (signal.aborted) return cancelled();
  const resp = await callModel(messages, tools, protocol);    // 非流式；HTTP 失败沿 apiChain fallback；
                                                              // 模型级重试：同端点重试 2 次、间隔 3s（照抄其 modelRetry {maxRetries:3, intervalMs:3000} 的精神，取保守值）
  journal.push(model_completed { round, toolCallCount, textChars, narration });
  const calls = resp.toolCalls;
  if (calls.length === 0) {                                   // ← drift
    if (resp.text.trim()) workspace.write('output/direct_output.md', resp.text);   // + 事件 direct_output_captured
    if (round >= maxRounds) return fatal('model.tool_call_required');
    messages.push(resp.assistantTurn);                        // 跑偏的回合也进历史（让模型"认账"）
    messages.push(user(driftNudge(attempt, committedCount, 'output/direct_output.md')));
    continue;
  }
  let finished = false;
  for (const [i, call] of calls.entries()) {
    if (finished) return fatal('agent.tool_after_finish');    // finish 后还有调用 → 致命
    const r = await dispatch(call);                           // 未知工具名 → 致命 fatal('model.unknown_tool_call')
    results.push(r);                                          // 其余错误一律 is_error 回喂
    if (r.effect === 'finish') {
      if (commitLedger.length === 0)                          // 前台闸门：无 commit 的 finish 降级为软错误
        results[last] = softError('agent.foreground_commit_required', '必须先成功调用 workspace_commit 再 finish');
      else finished = true;
    }
    if (r.effect === 'commit') commitLedger.push({ path, mode, round });  // + 楼层建/改（§4.3）
  }
  if (finished) return completed();
  messages.push(resp.assistantTurn, ...results.map(toToolMessage));
}
// 跑完未 finish：
return commitLedger.length ? partialSuccess() : fatal('agent.max_tool_rounds_exceeded');
```

**预算**：`toolCallCount > maxToolCalls` 时不终止，回喂软错误 `agent.tool_budget_exhausted`（提示模型「预算已尽，请立即 commit + finish」）。

### 4.2 终态与后处理

| 终态 | 判据 | 楼层 | `<state>` 解析+演化 | 错误提示 | 重试按钮 |
|---|---|---|---|---|---|
| completed | finish 且有 commit | 保留（commit 的最终版） | ✅ 跑 | — | — |
| partial_success | 未 finish 但 ledger 非空 | 保留 | ✅ 跑 | ⚠「已保留成稿但运行未干净结束」 | ❌ |
| failed | 致命错误且 ledger 空 | 无 | ❌ | 错误码→中文文案 | 三个违约码 ✅（走现有 ⟳ 重生成） |
| cancelled | signal aborted | 已 commit 的保留 | ❌（同 legacy 手动停止） | 「已停止」 | — |

### 4.3 commit 语义

- `workspace_commit {path?='output/main.md', mode?='replace'|'append'}`：
  - 校验：path 必须存在且非空（空 → 软错误 `workspace.required_artifact_empty`）。
  - 首次 commit：`setMessages` 追加新楼层（`++msgId.current`），内容 = **display 视图**（`stripStateBlocks` 等清洗后）；原始全文存 `rawCommitted`。
  - 再次 commit：`mode=replace` 整体替换该楼层；`append` 时 `rawCommitted += text` 后**整体重新清洗**再更新楼层（照抄其「原始文本层拼接再整体清洗，让正则能跨 commit 块匹配」的设计）。
  - 回给模型的 content（照抄）：`已把 {path} 提交为当前聊天楼层（mode={mode}）。可继续编辑并再次 commit；全部完成后调用 workspace_finish 结束。不要用纯文本作为最终回答。`
- 终态 completed/partial 后，`rawCommitted` 作为 `accumulated` 交回 callApi 既有完成段做正式结算（此时才解析 `<state>`、触发演化、叙事记忆写入、配图阶段）。

### 4.4 drift 提醒模板（中文化，保留其结构；常量进 promptRules.ts）

- 无 commit 版：`【系统提醒·纠偏第{n}次】你输出了纯文本，但本次运行必须通过 Agent 工具完成直至 workspace_finish。请把正文通过 workspace_write_file 写入 output/main.md 并 workspace_commit，最后调用 workspace_finish。{hint}不要再直接输出纯文本。`
- 已 commit 版：`【系统提醒·纠偏第{n}次】你输出了纯文本，但运行仍未结束。你已成功提交 {c} 次楼层；若需修改成稿请改 workspace 文件后再次 commit，否则请直接调用 workspace_finish 干净收尾。{hint}不要把内容再以纯文本重复一遍。`
- `{hint}`（有落盘时）：`你的这段文本已保存到 {path}；如果它就是你想要的正文，直接 workspace_commit 该文件即可。`

### 4.5 上下文控制常量（沿用其值，按 RPG 缩小）

| 常量 | TauriTavern | 本项目 |
|---|---|---|
| 单楼层读上限 | 8,000 字符 | 8,000 |
| 单次 chat 读总量 | 20,000 | 12,000 |
| chat_search 命中数 | 默认 20 / max 50 | 默认 10 / max 30 |
| workspace 单读 | 80,000 字符 / 1200 行 | 30,000 / 800 行 |
| worldinfo 单条/总量 | 8,000 / 20,000 | 沿用 |
| 历史不裁剪 | ✅（单调追加） | 沿用（写类工具只回摘要是前提） |

---

## 5. 工具系统

### 5.1 协议（`agentProtocol.ts`）

**native（主）**——完全照抄其编码：

```jsonc
// 请求
{ ...正文同款采样参数, stream: false,
  "tools": [{"type":"function","function":{"name":"workspace_commit","description":"…","parameters":{…}}}],
  "tool_choice": "auto" }
// assistant 回喂（含 tool_calls 时 arguments 必须是字符串化 JSON）
{ "role":"assistant", "content":"…可空…", "tool_calls":[{"id":"…","type":"function","function":{"name":"…","arguments":"{…}"}}] }
// 工具结果（content 是五字段 JSON 字符串）
{ "role":"tool", "tool_call_id":"…", "name":"…",
  "content":"{\"ok\":true,\"content\":\"…\",\"structured\":{…},\"errorCode\":null,\"resourceRefs\":[]}" }
```

解码容错（比它宽松，服务中转站生态）：`arguments` 是对象也收、缺 `id` 自动补 `call_{n}`、`function.args` 别名也认；名字按 model_name 回写 canonical。

**text（降级）**——系统提示词教模型输出：

```
<tool_call>{"name":"workspace_write_file","arguments":{"path":"output/main.md","content":"…"}}</tool_call>
```

- 一轮可含多个 `<tool_call>` 块，按序执行；块外文本视为 narration（记 journal，不算 drift）；整轮无任何块才算 drift。
- 解析走 `lenientJsonParse`（容忍裸键/单引号/尾逗号——现成基建）。
- 工具结果以 `role:'user'` 回喂：`<tool_result name="…" ok="true">{content}</tool_result>`（无 FC 的端点没有 role:tool）。

**auto（默认）**：先 native；HTTP 报错且错误体含 `tools/function/tool_choice` 字样 → 本 run 切 text 并重发当轮。drift 不触发切换（drift 有自己的恢复机制）。

### 5.2 工具清单（P0 = 15 个）

统一：`{"type":"object","additionalProperties":false,…}`；错误一律 `{error:{code,message}}` 软回喂。

**workspace 系**（内存虚拟 FS；根：`output/`、`scratch/`、`plan/`）

| 工具 | 参数 | 行为要点 |
|---|---|---|
| `workspace_list_files` | `path?`,`depth?=2` | 列虚拟 FS |
| `workspace_search_files` | `query`,`limit?=10` | 子串+行上下文 |
| `workspace_read_file` | `path`,`start_line?`,`line_count?`,`start_char?`,`max_chars?` | 返回带行号正文+元数据首行；记 read-state（sha、observed_texts、full_read） |
| `workspace_write_file` | `path`,`content`,`mode?=replace\|append` | replace 已存在文件须先读过（`workspace.write_requires_read`）；append 免读；只回摘要 |
| `workspace_apply_patch` | `path`,`old_string`,`new_string`,`replace_all?` | 全套粘性规则：未读→`patch_requires_read`；部分读失败→置「必须整读」；非唯一→`patch_old_string_not_unique`；sha 陈旧→`patch_stale_file`；只回摘要 |
| `workspace_commit` | `path?`,`mode?`,`reason?` | §4.3 |
| `workspace_finish` | `reason?` | §4.1 闸门 |

**上下文系**（只读，数据来自 run 输入快照与 store）

| 工具 | 参数 | 数据源 |
|---|---|---|
| `chat_search` | `query`,`limit?`,`role?` | `messagesRef` 楼层；关键词计分+片段 |
| `chat_read_messages` | `messages:[{index,start_char?,max_chars?}]` | 楼层原文（prompt 视图） |
| `worldinfo_read_activated` | `entries?:[{ref,…}]` | **本回合命中**的世界书条目 + novelVec 命中（callApi 已算好，随 inputs 传入；无参=只列索引） |
| `lore_search` | `query`,`limit?=5` | `retrieveNovel()` 向量检索（**超越快照的主动查询**——模型可查原著桥段/世界书细节） |
| `player_get` | — | 主角档案 structured（复用结构化档案序列化：六维/HP/EP/装备/技能/称号/货币） |
| `npc_get` / `npc_list` | `name` / `onScene?` | `serializeNpcSnapshot` 复用；list 只回名字+一句话（在场优先） |
| `dice_roll` | `formula` | `diceEngine` 确定性；`Rolled 3d6+4: 2+5+6+4 = 17.` |

**P1 增补**：`quest_get`（任务/路线图）、`faction_get`、`db_query`（ACU sql.js 只读 SELECT，护栏：仅 SELECT/LIMIT 强制）、`persist_read/write`（跨回合备忘，或作为 `persist/` 根并入 workspace 工具）。

### 5.3 与它的关键一致性

- 工具名对模型用下划线（`workspace_write_file`），内部/journal 用点号（`workspace.write_file`）。
- 软/硬错误分界照 §1.2-2。
- 读上限写进 schema description（模型自我约束）。

---

## 6. 系统提示词（`AGENT_SYSTEM_RULE`）

拼装函数 `buildAgentSystemPrompt(enabledTools)`，追加在合并 system **末尾**（同现有 `*_RULE` 惯例），结构照抄它：

1. **头部**：`--- tools: [清单] ---` + `# Agent 模式已激活`（工具结果是工作上下文，不是聊天消息）。
2. **逐工具指引**（仅启用的才出现，中文化）：何时用 chat_search/lore_search/npc_get…；read-before-edit；`绝不在 commit 前读 output/main.md`。
3. **RPG 特化段（与 TauriTavern 的最大差异，必须写死）**：
   > `output/main.md` 必须是**一篇完整的正文回复**，格式与平时完全一致：遵循预设的全部写作与排版要求，**包含预设/世界书规定的一切结构模块（状态栏、时间结算、<state> 状态指令块、任务模块等），一个都不能少**。工具查到的资料是你的参考，不要把工具调用过程、文件路径、JSON 写进正文。
4. **收尾铁则**：前台必须先 `workspace_commit` 成功至少一次再 `workspace_finish`；**禁止用纯文本作为最终回答**。
5. **流程模板**（照抄其两种范式，改成 RPG 剧本）：
   ```
   推荐流程：
   (思考本回合要写什么；需要补充信息就先查)
   (chat_search / npc_get / lore_search …)          ← 可选
   (workspace_write_file 把完整正文写入 output/main.md)
   (workspace_commit)
   (workspace_finish)
   ```
6. 常量放 `promptRules.ts`，注册 `PROMPT_REGISTRY`（kind:'override'，玩家可在预设中心编辑），组名「Agent 正文模式」。drift 提醒模板同样注册。

---

## 7. UI / 交互

### 7.1 开关（ChatComposer）

- 发送钮旁 🤖 按钮，三态：`off`（灰）/ `on`（点亮）/ `running`（脉冲动画）。单击翻转 `settings.agentNarrative.enabled`；running 时点击弹 toast「Agent 运行中——用停止按钮取消」。
- 仅作用于**正常发送**与 ⟳ 重生成；细纲/指导/推进等前置调用、各演化阶段一概不走 agent（它们已有独立管线）。

### 7.2 Timeline（AgentTimeline.tsx）

- 位置：输入框上方一条窄条（agent 开启时常驻），折叠态一行 `🤖 第{n}轮 · {最新事件}`，展开显示事件列表（高度上限 ~200px 滚动）。
- 事件→行渲染（照抄其降噪规则）：
  - `tool_call_requested`（⏳{工具}…）被对应 `tool_call_completed/failed` **顶替**（不是并列）。
  - 写类完成事件用语义行：`✏️ 写入 output/main.md（1420字）`、`🔧 修改 …（2处替换）`、`📤 已提交楼层（第{n}次）`、`⚠️ 纠偏（{n}/{max}）`、`🎲 3d6+4=17`。
  - 模型旁白（工具调用间的短文本）显示为引用行。
  - 终态行：✅ 完成 / ⚠️ 部分成功（已保留成稿）/ ❌ 失败{文案} / ⏹ 已取消。
- run 结束后保留可查，下一次 run 清空；journal 存 `agentRunStore`（capped 10 条），P1 在回合洞察里归档。

### 7.3 取消与错误

- 停止按钮：现有 `stopGeneration` 已 `abortRef.abort()` → runtime 的 signal 监听即生效，**零新增 UI**。
- 错误码→中文文案表（`AGENT_ERROR_TEXT`，照抄其分级）：
  - `model.tool_call_required`：「模型未按工具流程工作，未产生正文。建议重试；反复出现请换支持函数调用的模型或切文本协议。」
  - `agent.max_tool_rounds_exceeded`：「工具轮次预算耗尽。可在设置调高轮数，或收紧提示词。」
  - `agent.tool_after_finish`：「模型在收尾后仍尝试调用工具（违约）。建议降温度或换模型。」
  - 其余回退原始 message。三个违约码提示「可重试」，直接用现有 ⟳。

---

## 8. 设置与持久化

### 8.1 settingsStore 新字段组（配置类·不清进度·随 configExport 导出）

```ts
agentNarrative: {
  enabled: false,            // 主开关（composer 快捷钮同步）
  protocol: 'auto',          // 'auto' | 'native' | 'text'
  maxRounds: 16,             // 1~80
  maxToolCalls: 40,
  toolToggles: {},           // Record<toolName, boolean>，默认全开；dice_roll 默认关（对齐它的默认）
  timelineOpen: true,
}
```

- API 路由：`resolveApiChain('agent', 正文API)`——SettingsPanel 用现成 `ApiRoutePicker featureKey='agent'`；**记得在接口槽审计工具（ApiSlotAudit）的槽位清单里登记 'agent'**。

### 8.2 agentRunStore（`drpg-agentrun`，进度类）

- `runs: AgentRunJournal[]`（capped 10：事件流+终态+轮数+耗时+token 估算）；（P1）`persistFiles: Record<path,string>`。
- **新 store 三件事**：`saveManager.STORES` 注册；给 `clear`（新游戏清空）；不进 configExport（进度）。

---

## 9. 测试与验收

### 9.1 vitest（纯函数，node 环境）

- `agentProtocol.test.ts`：native 编码（arguments 字符串化/五字段 tool content）；解码（canonical 回写、缺 id 补齐、args 别名）；文本协议多块解析+lenient 容错+块外 narration。
- `agentWorkspace.test.ts`：read-before-edit 九种错误码场景、粘性整读标志置位/清除、sha 陈旧、append 免读、行/字符模式互斥。
- `agentRuntime.test.ts`（mock 模型函数注入）：正常 write→commit→finish；drift 两轮后恢复；超轮数且有 commit → partial；无 commit → failed+`model.tool_call_required`；finish 后调用 → 致命；无 commit 的 finish → 降级软错误；signal 中止 → cancelled；预算耗尽 → 软错误回喂。
- `agentTools.test.ts`：dice 公式解析边界、chat_search 计分、读上限截断。

### 9.2 验证四件套 + 手测清单

1. `npm run typecheck` 0 新增；`npm test` 全绿；`vite build` ✓；预览 console 无报错。
2. 手测：① 开关开→发消息→timeline 出事件→正文落楼层→状态栏/演化照常；② 中途停止→已 commit 文本保留、无演化；③ 开关关→行为与现在逐字节一致（对照一回合）；④ 强制 `protocol:'text'` 走通一回合（模拟无 FC 中转）；⑤ ⟳ 重生成走通；⑥ 刷新后 journal 还在、新游戏清空。

---

## 10. 与现有功能交互矩阵

| 现有功能 | Agent 模式下 | 说明 |
|---|---|---|
| 细纲 / 剧情指导 / 数据库推进 | ✅ 照常 | 前置产物已在首轮快照里；agent 只接管「正文那一次调用」 |
| 结构化召回 / 向量召回 / 世界书 | ✅ 照常注入首轮 | 且模型还能用工具主动查更多 |
| 思考预填（force/skip） | ⏭ agent 模式跳过 | assistant 预填与 tools 互斥；设置区加说明 |
| 流式显示 / 边写边出配图 | ⏭ 不适用 | 非流式；配图由终态后的 `runStoryImagePhase` 照常出 |
| 复读折叠 collapseRunaway | ✅ 对每轮响应文本套用 | 防失控膨胀 |
| 多模态贴图 / 输出语言 / ST宏 | ✅ 照常 | 都发生在快照构建期 |
| `<state>`/`<upstore>` 解析、全部演化阶段 | ✅ 完全不动 | 终态后一次性结算 |
| ⟳重生成 / ↩回退 / 分支树 | ✅ 照常 | 重生成=新 run |
| 手动摇骰子 | ✅ 不冲突 | 注入照旧；`dice_roll` 是模型主动骰（默认关） |
| NPC 私聊 / 频道 / 各后台调用 | ✅ 不受影响 | 它们走 `apiChatFallback`，与 agent 运行时无共享状态 |

---

## 11. 成本与风险

1. **token 成本**（最大风险）：每轮请求都带全量首轮上下文（不裁剪），n 轮 ≈ n×首轮 + 工具增量。默认 16 轮上限、典型 4~8 轮 ≈ **正文成本的 4~8 倍**。缓解：设置区明示成本；`agent` 路由可指到便宜/快模型；工具读上限收紧；预算软错误逼模型尽快收尾。
2. **FC 兼容性**：auto 协议 + 文本降级双轨兜底；开发者面板（apiDebugLog）照常记录每轮请求便于排障。
3. **模型纪律**：弱模型可能反复 drift。drift 恢复 + `direct_output.md` 回收路径 + 违约码可重试；文案建议换模型。
4. **callApi 高风险区**：切口保持单个 if 分支 + 全部新逻辑在独立模块；不重构既有代码（DEV_WORKFLOW §5 红线）。
5. **一致性坑**：commit 楼层用 display 清洗视图、终态才结算——避免半成品 `<state>` 污染存档（对齐 legacy「手动停止不解析」的既有语义）。

---

## 12. 分期实施

| 期 | 内容 | 验收 |
|---|---|---|
| **P0 最小可用** | runtime + 双协议 + workspace（3 根）+ 15 工具 + callApi 切口 + 🤖开关 + 简版 timeline + 设置区 + 错误文案 + 单测 | §9 手测 ①~⑥ 全过 |
| **P1 体验完善** | `persist/` 跨回合记忆（含提示词 persist 段）+ 运行中「用户指引」注入 + `quest_get`/`faction_get`/`db_query` + journal 归档回合洞察 + per-tool 预算 | 指引/记忆各走通一回合 |
| **P2 远期可选** | 多 profile（不同工具集/模型/提示词）+ 末轮流式体验 + 评稿子代理（写完让另一模型批稿再修订） | 另行设计 |

---

## 附录 A：TauriTavern 关键原文摘录（实现对照用）

- 核心定义：*"一次生成不是 LLM 返回一段字符串，而是 Agent 对一个受策略约束的 Workspace 进行一组可审计、可回滚的编辑，最后由运行时把 Artifact 组装并提交为聊天消息。"*
- 系统提示词收尾三连（其原文）：
  `# **Important**: Before calling workspace_finish, you **must successfully call workspace_commit at least once** so that the user can see the final chat message.`
  `# **Important**: Do not answer in plain text. Finish by calling workspace_finish.`
  `Anyway: TOOLS&SKILLS IS ALL YOU NEED`
- commit 回执（其原文）：`Committed {path} to the current chat message with mode {mode}. You may continue editing and commit again if needed. When all intended commits are complete, call workspace_finish to end the run. Do not use plain text as the final answer; the run must finish through workspace_finish.`
- drift 提醒骨架（其原文）：`[system reminder, direct output recovery attempt {n}] You replied with plain text, but this run must continue through Agent tools until workspace_finish. … I saved your direct text to {path}. If that text is the intended reply, call workspace_commit with path "{path}" before workspace_finish. Do NOT answer directly in plain text.`
- 行为要点速查（其代码验证）：轮数从 1 计含 drift；软/硬错误分界（仅未知工具与 finish 后调用致命）；partial success 唯一判据 = commit 台账非空且强制不可重试；read-before-edit 粘性整读；写类只回摘要；tool result 五字段 JSON 字符串；arguments 字符串化；上下文不裁剪全靠读上限。
