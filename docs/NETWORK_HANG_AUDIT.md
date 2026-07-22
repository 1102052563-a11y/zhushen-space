# 卡网漏洞检查工作流（NETWORK_HANG_AUDIT）

> **目标**：系统排查「请求挂起 / 按钮一直转 / 停止无效 / 下一回合发不出去」类问题。  
> **核心链路**：`resolveApiChain` → `apiChatFallback` / 正文 `callApi` → `fetchWithProxy` → `apiThrottle`。  
> **改动流程仍走** `DEV_WORKFLOW.md`（定位 → 小步改 → 验证四件套）。

---

## 0. 什么叫「卡网」（本项目口径）

| 现象 | 典型根因 |
|---|---|
| 发送后一直转圈、无字无错 | 无 `timeoutMs` / 空闲超时未重置 / 流不结束 |
| 点「停止」仍挂 | 未挂 `_stopAll` / 正文 `abortRef` 与演化脱节 / 裸 `fetch` |
| 停掉后下一回合发不出 | `apiThrottle` 名额未 `release`（死锁） |
| 某一阶段永远 pending | 阶段 `await` 了别的慢阶段 / 异常未 catch |
| 直连失败后更慢 | `directFailedOrigins` 未命中仍先撞 CORS；代理也挂 |
| 429 / 假 CORS | 并发过高；上游 524 被浏览器显示成 CORS |

---

## 1. 黄金循环（每次审计）

```
复现 → 定层 → 静态扫 → 修一处 → 再复现 → 过门禁
```

1. **复现**：记下「操作路径 + 接口配置 + 是否开多演化 + Console 最后一条」。
2. **定层**（自上而下，命中即停）：
   - UI 状态层：`generating` / 各 panel `loading` 是否 finally 复位
   - 调度层：`runPostNarrativePhases` / `phasePipeline` 是否 await 错依赖
   - 调用层：`apiChatFallback` / 正文 `callApi` 超时·abort·fallback
   - 传输层：`fetchWithProxy` 直连/代理/Abort
   - 闸门层：`apiThrottle.acquireApiSlot` 是否泄漏
3. **静态扫**：按 §2 清单 grep（**禁止整读 App.tsx**）。
4. **修一处**：一次只修一类（超时 / abort / release / 裸 fetch）。
5. **再复现 + 验证四件套**（`DEV_WORKFLOW.md` §0）。

---

## 2. 静态扫描清单（必做）

> **本节已脚本化**：`npm run check-network`（`scripts/check-network.mjs`，与 tsc 门禁同款 baseline 思路：存量入 `scripts/network-baseline.json`，只拦新增违规；已挂进 `npm run build` 与 CI）。修掉存量后跑 `npm run check-network:update` 收紧基线。下述 grep 仍适用于手工深查/定位具体行。

在内层 `zhushen-space/zhushen-space/` 执行思路（PowerShell / 编辑器 Grep 均可）。

### 2.1 裸 fetch（最高危）

```text
Grep:  fetch\(
范围:  src/**/*.{ts,tsx}
排除:  apiChat.ts 内部、静态资源(presets/json)、/models 列表
```

**铁则**：业务 AI 调用必须 `resolveApiChain(featureKey, legacy)` + `apiChatFallback`。  
裸 `fetch` 没有：全局 abort、空闲超时、硬超时、节流 release、接口 fallback。

已知允许的裸 fetch（审计时跳过，但改动时别抄）：
- 静态资源：`presets/`、`lunhui-characters.json`、`ui-strings.json`
- store 里拉 `/models` 列表（短请求，无 stream）
- `apiChat.ts` 自身 `fetch` / `fetchViaProxy`
- 多人对战/云仓等非 chat 的 REST（`accountVaultCloud` 等）——**必须自带 timeout+abort**

### 2.2 缺 timeoutMs

```text
Grep:  apiChatFallback\(
```

对每个调用点检查第三参是否有 `timeoutMs`。

| 场景 | 建议 idleMs | 硬上限（代码内） |
|---|---|---|
| 正文后演化（物品/主角/NPC…） | 90000–120000 | `max(idle*4, 240000)` |
| 剧情指导 / 推进规划（挡正文） | 20000–30000 | 同上 |
| 频道/私信/短 JSON | 30000–60000 | 同上 |
| 混沌档案 / 长文 | 180000–240000 | 同上 |
| **未传 timeoutMs** | **=0 → 无空闲超时、无硬超时 → 可永久挂** | 🔴 必修 |

`timeoutMs` 语义（`apiChat.ts`）：
- **空闲超时**：流还在吐字就 `bump()` 重置，不按总时长掐
- **硬超时**：`max(idleMs*4, 240s)`，防真卡死

### 2.3 abort 覆盖

| 入口 | 机制 | 检查点 |
|---|---|---|
| 停止正文 | `abortRef.current?.abort()` | `callApi` 是否把 signal 传给 fetch |
| 停止全部 | `abortAllApiCalls()` → `_stopAll` | 仅 `apiChatFallback` 监听；裸 fetch 无效 |
| 用户中止 vs CORS | `isAbortError` 不进 `directFailedOrigins` | 勿把 Abort 当 CORS 记脏 |

审计动作：
1. 生成中点「停止」→ Network 请求应变 cancelled，UI `generating=false`。
2. 演化中点「停止全部变量」→ 所有 `apiChatFallback` 应 abort，节流名额释放。
3. 停后立刻再发一轮 → **必须能发出**（验证 throttle 未死锁）。

### 2.4 节流死锁（卡「下一回合」）

文件：`systems/apiThrottle.ts` + `apiChat.ts` 的 `finally { release() }`。

检查：
- [ ] `apiChatFallback` 所有退出路径（成功 / 抛错 / abort）都进 `finally release`
- [ ] 没有「拿到 slot 后 `return` 绕过 finally」的改写
- [ ] `maxConcurrent` 过小 + 某请求永不结束 → 队列永久堵（根因仍是缺超时）

### 2.5 UI loading 泄漏

```text
Grep:  setGenerating\(|loading:\s*true|setLoading\(true\)
```

每个 `true` 必须有对应 `finally`/`catch` 复位。重点：
- `App.tsx`：`setGenerating(true/false)`（正文）
- `outlineModal` / `planModal` 的 `loading`
- 各 panel 本地 `loading`（强化/合成/深渊/竞技场…）

### 2.6 阶段调度卡死

文件：`systems/phasePipeline.ts` + `App.tsx` → `runPostNarrativePhases`。

检查：
- [ ] 物品阶段**不 await NPC**（历史 bug：物品被慢 NPC 拖死）
- [ ] `deps` 是否误把快阶段绑到慢阶段
- [ ] 阶段 `run` 内部异常是否吞掉并 `onDone`（避免整表 pending）
- [ ] `awaitForSnapshot` 是否只等必要阶段

### 2.7 代理 / 直连回退

`fetchWithProxy`：
- [ ] Abort 不写入 `directFailedOrigins`
- [ ] 已知失败 origin 直接走代理（避免每回合 CORS 红错）
- [ ] 本地 dev 无 Pages Function → 应落 `gwProxyBase()`，不是死等 `/proxy/llm`
- [ ] 用户填了 `drpg-gateway-url` 时优先本地 worker

---

## 3. 运行时复现矩阵（浏览器）

**前置**：设置 → 打开 API 调试日志（若有）/ DevTools Network + Console。  
**节流建议试两组**：`maxConcurrent=3,minGap=0`（默认）与 `=1,minGap=500`（放大排队）。

| # | 步骤 | 期望 | 失败=漏洞点 |
|---|---|---|---|
| R1 | 正常发一轮正文 | 流式出字；结束后 `generating=false` | 正文 callApi 超时/状态 |
| R2 | 出字中点停止 | 立即停；可再发 | abortRef / finally |
| R3 | 正文完、多演化进行中 → 停止全部 | 全部 cancelled；Console 无未捕获 | `_stopAll` + release |
| R4 | 停后立刻再发 | 立刻有新请求 | throttle 死锁 |
| R5 | 关掉一半演化，只留物品+主角 | 两阶段各自完成/超时，互不堵 | phase deps |
| R6 | 故意填坏 baseUrl / 错误 key | 应 fallback 下一条或清晰报错，**不永久转** | fallback + timeout |
| R7 | 仅 1 条接口且上游不回 body | 空闲/硬超时后失败提示 | idle+hard timer |
| R8 | 本地 vite + 需 CORS 的中转 | 一次失败后走网关，不再每回合红 CORS | directFailedOrigins |
| R9 | 并发拉满（NPC 策略 B + 全演化） | 429 应报「上游限流」并切链；UI 不假死 | 429 解析 + throttle |
| R10 | 刷新页面中途有在飞请求 | 无「幽灵写入」；新会话干净 | 无跨页 abort 要求，但 store 不应半写入脏状态 |

录证：失败时保存 **Console 截图 + Network 里卡住的请求 URL/状态/耗时 + 操作路径**。

---

## 4. 代码层「高危清单」（优先看）

| 文件 | 关注点 |
|---|---|
| `systems/apiChat.ts` | `timeoutMs=0`、`_stopAll`、`hardTimer`、`finally release`、`readChatContent` 流不结束 |
| `systems/apiThrottle.ts` | `active`/`queue` 泄漏；`pump` 不唤醒 |
| `App.tsx` `callApi` / `setGenerating` / `stopGeneration` | 正文 abort 与演化 abort 是否齐 |
| `App.tsx` `runPostNarrativePhases` | 并发阶段、deps、物品≠await NPC |
| `systems/phasePipeline.ts` | 调度器 await / 错误隔离 |
| `systems/npcEvolutionHelpers.ts` | 策略 B 批并发；单 NPC 超时 |
| 各 `*Store` 的裸 `fetch(.../models)` | 可选加 AbortSignal.timeout |
| 面板内 `apiChatFallback` 无 timeout | Achievement / 赌场 / 深渊 / 混沌等 |

**快速 Grep 找「无 timeout 的 apiChatFallback」**（人工过一遍匹配行）：

```text
# 有 timeout 的附近会有 timeoutMs；无则标红
apiChatFallback\([^)]*\)(?![\s\S]{0,80}timeoutMs)
```

（编辑器不支持则：列出所有 `apiChatFallback(` 行，逐条看第三参。）

---

## 5. 修复配方（按症状）

### 5.1 永久转圈、Network 一直 pending

```ts
// 调用处补空闲超时（推荐 60s–120s）
await apiChatFallback(chain, msgs, { timeoutMs: 120000, label: 'xxx' });
```

若必须超长（推理模型）：保持较大 idle，依赖 hard cap；**禁止 timeoutMs 省略**。

### 5.2 停止无效

- 正文：确保 fetch `signal: abortRef.current.signal`
- 演化：只走 `apiChatFallback`（自动挂 `_stopAll`）
- UI 按钮：`stopGeneration` + 需要时 `abortAllApiCalls()`

### 5.3 停后发不出下一回合

检查 `apiChat.ts`：

```ts
const release = await acquireApiSlot(...);
try {
  // ...
} finally {
  release();   // 必须存在且唯一出口
}
```

临时自检（仅 dev）：在 `apiThrottle` 暴露 `active`/`queue.length` 打 log，停后应为 0。

### 5.4 裸 fetch → 正规调用

```ts
// 前
const r = await fetch(url, { method:'POST', body, headers });
// 后
const chain = resolveApiChain('featureKey', legacyApi);
const { content } = await apiChatFallback(chain, messages, { timeoutMs: 60000 });
```

非 chat REST：至少

```ts
const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 30000);
try {
  await fetch(url, { ...init, signal: ctrl.signal });
} finally {
  clearTimeout(t);
}
```

### 5.5 阶段互相拖死

- 声明式 phases：快阶段 `deps` 勿依赖慢阶段
- 物品 / 主角对账合并走 `runMergedAuditPhase`，**不**串 NPC
- 单阶段内部 `try/catch`，失败记 log，不抛穿调度器

### 5.6 429 / 假 CORS

- 降 `apiThrottle.maxConcurrent`、加 `minGapMs`
- NPC 策略 B 降批并发 / 切策略 A
- 多 key 填进接口库路由，靠 `apiChatFallback` 轮换
- 看 Console：`上游限流 429` 才是真限流；`Failed to fetch`+status 0 才可能是 CORS/断网

---

## 6. 审计交付模板（可贴 issue / 备忘）

```markdown
## 卡网审计报告 · YYYY-MM-DD

### 复现
- 路径：
- 接口：
- 演化开关：

### 分层结论
- [ ] UI loading
- [ ] phase 调度
- [ ] apiChatFallback 超时/abort
- [ ] fetchWithProxy
- [ ] apiThrottle

### 发现（按严重度）
1. [P0] 文件:行号 — 现象 — 根因 — 修复
2. [P1] ...

### 验证
- R1–R10：通过 / 失败项
- typecheck / test / vite build：
```

---

## 7. 与日常开发的衔接

| 你在… | 做什么 |
|---|---|
| 加新 AI 功能 | 强制：`resolveApiChain` + `apiChatFallback` + **显式 timeoutMs** + label |
| 加新阶段 | `phasePipeline` 一行；默认不 await 慢邻居；失败自吞 |
| 改 apiChat/throttle | **高风险**：先备份；R2–R4 必测；勿为「整洁」重写硬超时语义 |
| 修用户反馈卡网 | 先走本文件 §1→§3，再改代码；忌盲加 loading |

---

## 8. 一页速查（打印级）

```
AI 调用？ → resolveApiChain + apiChatFallback + timeoutMs
停止？   → abortRef(正文) + abortAllApiCalls(演化)
节流？   → acquire 后 finally release
阶段？   → 并发、物品不 await NPC、异常隔离
代理？   → Abort≠CORS；失败 origin 直连跳过
UI？     → generating/loading 必须 finally 复位
验证？   → R2 停止 / R3 全停 / R4 再发 / R7 坏接口超时
```
