# 开发规约 / 改动流程（DEV_WORKFLOW）

> **每次「加新功能」或「改老功能」都按这份走。** 配合 `CLAUDE.md`（总则铁律）、`CODE_MAP.md`（代码定位）、`FEATURES.md`（功能细节）。
> 一句话：**定位 → 小步改 → 过「验证四件套」→ commit**；新代码按「该放哪」表归位；动核心前先备份、分小步。

---

## 0. 黄金循环（每次改动都走这 4 步）

1. **定位**：先查 `CODE_MAP.md` 找 文件+函数名 → `Grep` 拿行号 → 只读那一段。**App.tsx 6800+ 行，禁止整文件读**；SettingsPanel / NpcDetail 也巨大。
2. **小步改**：一次只改一件事。改 AI 提示词 → 优先改 `src/promptRules.ts` 的 `*_RULE` 常量（即时生效）。
3. **验证四件套**（缺一不可，全在内层 `zhushen-space/zhushen-space/`）：
   | 命令 | 期望 |
   |---|---|
   | `npm run typecheck` | **0 新增类型错误**（严格门禁，见 §3） |
   | `npm test` | 全绿（确定性引擎单测，见 §4） |
   | `.\node_modules\.bin\vite build` | 见 `✓ built in …` 即成功 |
   | 浏览器/预览实测 | reload 后 **console 无报错**；能交互的功能**实际点一遍** |
4. **commit + push**（你来）：push 时 `.githooks/pre-push` 会再跑一遍门禁；有新类型错误会**拦下 push**（这是它该干的事，不是 bug）。

> 改了 `src/` **必须重 `vite build`** 才会更新 `dist/`（前端加载 `dist/`，已 gitignore）。

---

## 1. 新代码该放哪（架构约定）

| 你要加的东西 | 放哪 | 备注 |
|---|---|---|
| 纯逻辑 / 只读 store 的助手 | `src/systems/*.ts` | **别塞进 App 组件**；纯函数能单测。已有：derivedStats / stateApply / playerVitals / statusCommands / npcEvolutionHelpers / combatHelpers / promptInjections / flattenAiText / phasePipeline |
| 按需面板·弹窗 | `src/components/*.tsx` + **`React.lazy`** | 在 App 顶部 lazy import 区；render 处在 `<Suspense fallback={null}>` 内（首屏不下载，点开才加载） |
| 常驻 / 首屏组件 | `src/components/*.tsx`（eager 普通 import） | StartScreen / PlayerSidebar / 无条件渲染的小 toast |
| AI 提示词规则 | `src/promptRules.ts` 的 `*_RULE` 常量 | 即时生效；**勿散落进组件**字符串 |
| 回合后「演化阶段」 | `runPostNarrativePhases` 的 **phases 表**（声明式） | 调度器 `systems/phasePipeline.ts`；加阶段 = 加一行 `{ key, enabled, deps?, run, onDone?, awaitForSnapshot?, delayMs? }` |
| 正文系统提示注入块 | `systems/promptInjections.ts` | 返回 `{role:'system',content}[]`，由 `callApi` 拼进 sysPrompt |
| 新的持久化 store | zustand + persist，key `drpg-<name>` | **必须**同步进 `saveManager.ts` 的 `STORES` 注册表，见 §2 |

---

## 2. 写 / 加 store 的规矩

- zustand + `persist`，key 用 `drpg-<name>`（**gameStore 例外**：自定义 `writeSave` → key `zhushen-save-v1`）。
- **creator 标返回类型**：`create<XState>()(persist((set): XState => ({ ... }), {...}))`。不标的话 persist 让泛型不流过 → `set` 和所有 action 参数全成隐式 `any`。
- **新 store 三件事**（漏一个就会出「存档抓不到 / 新游戏清不掉 / 配置没导出」的 bug）：
  1. 加进 `saveManager.ts` 的单一注册表 `STORES`（驱动存档快照 + 新游戏清空）。
  2. 若是「**进度**」store → 给它 `clear: () => useX.getState().clearXxx()`（新游戏会清）；若是「**配置/预设**」store → **不给 `clear`**（自动随新游戏保留）。
  3. 若属「配置」且要随全局配置导出 → 加进 `systems/configExport.ts`。
- **持久化即存档**：`drpg-*` 刷新不丢。改了血蓝/属性这类要走 store 的 setter 落盘（别只改内存对象）。

---

## 3. 类型门禁（红线·保持 0）

- `npm run typecheck` = `scripts/check-types.mjs`：跑 `tsc --noEmit`，对比 `scripts/tsc-baseline.json`，**只有基线之外的新错误才失败**。基线现已 **清零**，等于 **0 容忍严格门禁**。
- 真有意保留的已知错误才 `npm run typecheck:update` 纳入基线；**默认目标是 0**。
- **test 文件在 `src/` 内 → 也被门禁检查**，必须类型干净。
- 失败路径会复跑一次 tsc，只报两次都在的错误（滤掉瞬时抖动）。

---

## 4. 加测试（vitest）

- **确定性 / 纯函数**（换算、解析器、结算引擎、生成器）→ `src/<同目录>/<name>.test.ts`。
- 跑：`npm test`（`npm run test:watch` 监听）。独立 `vitest.config.ts`：node 环境 + `src/test-setup.ts` 的内存 `localStorage` 垫片（**部分 store 一被 import 就 hydrate persist**，没垫片会崩）。
- **带随机的**（种子 RNG / d20）只测「**同种子复现** + 区间 / 不变量」，不测精确随机值（要精确就 mock，通常不值）。
- 深度依赖大状态 + 多 store 的（如 combatEngine 的攻击伤害）只测「无 store 依赖的分支 + 不变量」，别为覆盖率硬造脆 fixture。

---

## 5. 大改动 / 重构（动多文件或核心）

1. **先备份**：`Copy-Item <src> 桌面\_zhushen_<tag>_backup_<date> -Recurse`。
2. **分小步**，每小步都过「验证四件套」+ 预览；能独立 review/回退。
3. **「把函数从 App 抽进 systems/」配方**（本轮把 App.tsx 8298→~6834 就靠这个）：
   1. 先确认那段**只读 store / 只用入参、不闭包组件的 `useState`/`useRef`/setter**（否则：要么把组件依赖改成**入参**，要么别动）。
   2. `[IO.File]::ReadAllLines` → **断言边界**（行内容精确比对，不符即 `ABORT` 不写）→ 去 2 空格缩进 + 加 `export` → 写新文件（**UTF-8 无 BOM、保 CRLF**）。
   3. 新模块**先单独 `tsc` 零错**，再删 App 里那块 + 加 `import`。
   4. **跑门禁收 orphan**：原块独占的 import 会变未用（TS6133 / 整行 TS6192），精确删掉。
- **高风险别硬上**：`callApi` / 战斗驱动 `useEffect`（共享 ref、effect 时序、与演化共享 `combatSettledRef`）这类深耦合核心，**单测覆盖不到、只能手动玩一遍验**；当收益只是「组织性」而风险=改坏主循环时，**就别动**。

---

## 6. 工具坑（Windows / PowerShell 5.1）

- **PowerShell 单引号串里 `''` 会塌成一个引号** → 用它做精确匹配会**静默失配**（本轮踩过：签名 replace 没生效）。含 `''`/`$`/反引号 的匹配串用**双引号串**，并先 `if ($t.Contains($old))` 验证再替换。
- 大块改文件用 `ReadAllLines`+断言+`WriteAllLines`（**UTF-8 无 BOM**）；**别对原生命令用 `2>$null`**（会把 chunk 警告当错、误报失败）。
- 调 AI 一律 `resolveApiChain(featureKey, legacy)` + `apiChatFallback`，**别裸 fetch**。
- `as any` 用于「AI 乱给的数据防御性摊平 / 异构 store 注册表」是 **OK 的惯用法**，别为降数字硬删（可能反而崩数据路径）。
- 性能优化（memo / 防抖）**先 profiling 再做**，没卡顿证据别盲改。
