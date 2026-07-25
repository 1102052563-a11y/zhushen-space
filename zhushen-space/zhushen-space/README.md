# 诸神空间 · 轮回乐园（无限流 AI RPG）

**Vite + React 18 + TypeScript + Tailwind + Zustand** 的网页 AI RPG。玩家在「轮回乐园」接任务、进入一个个世界，全部剧情由 AI 生成；前端负责把 AI 的叙事**结算成数值与状态**（六维 / 阶位 / 物品 / NPC / 势力 / 领地 / 冒险团…），并在多个「演化阶段」里把结果写回存档。

> ⚠ 仓库有**两层同名目录**：`zhushen-space/zhushen-space/` 才是真项目（带 `package.json`）。所有 npm 命令都要在内层跑。

## 文档在哪

代码之外的一切都在仓库根的 `docs/`：

| 文件 | 用途 |
|---|---|
| `../../CLAUDE.md` | 总览与跨切面铁则（改任何东西前先看） |
| `../../docs/FEATURES.md` | 功能细节：为什么这么设计、规则、踩过的坑 |
| `../../docs/CODE_MAP.md` | 代码定位：功能 → 文件 + 函数名 |
| `../../docs/DEV_WORKFLOW.md` | **改动流程与规约**（加/改功能照这个走） |

## 本地运行

需要 Node.js 18+。

```bash
npm install
npm run dev
```

构建：

```bash
npm run build
```

`build` = 类型门禁 → 网络门禁 → `vite build`。快速迭代时可以直接跑 `.\node_modules\.bin\vite build` 跳过门禁，但**收尾前门禁必须绿**（CI 也会跑同样的关卡）。

> 前端加载的是 `dist/`（已 gitignore）。改完 `src/` 不重新 build，页面不会变。

## 门禁与测试

```bash
npm run typecheck      # tsc 基线门禁：只拦「新增」的类型错误
npm run check-network  # 网络门禁：拦裸 fetch / 漏 timeoutMs 的 AI 调用
npm run lint           # ESLint，只开 hooks correctness 一类规则
npm test               # vitest（引擎层单测；组件层无测试）
```

四道关加上 `vite build` 就是 `.github/workflows/ci.yml` 里跑的五道关。两个基线文件（`scripts/tsc-baseline.json` / `scripts/network-baseline.json`）用 `npm run typecheck:update` / `check-network:update` 重建。

## 目录结构

```
src/
  components/   # UI。按需面板一律 lazy() + Suspense，只有首屏/常驻组件是 eager
  store/        # Zustand + persist，键名 drpg-*，落 localStorage（部分 lz 压缩）
  systems/      # 纯逻辑：解析器、结算引擎、演化阶段助手、持久化层
  data/         # 静态配置表
  i18n/         # 运行时 DOM 翻译层（正文永不翻译）
  utils/        # 零散小工具（日志等）
  App.tsx       # 主视图 + callApi + 演化阶段编排（很大，别整文件读）
scripts/        # 门禁脚本
tools/          # 离线工具：向量库构建、批量生图、R2 上传
functions/      # Cloudflare Pages Functions（AI 网关反代、崩溃上报…）
```

## 两条要记住的架构约定

**持久化是双轨的。** 结构化状态走 Zustand persist → `localStorage` 的 `drpg-*` 键；大块数据（对话、存档、图片、向量、世界书）走 IndexedDB。**加新 store 必须同时纳入 `systems/saveManager.ts` 的 `STORES` 注册表**，否则它不进存档、也不被「新游戏」清空。

**调 AI 不要裸 `fetch`。** 统一走 `resolveApiChain(featureKey, legacy)` + `apiChatFallback(chain, messages, opts)`，并传 `opts.timeoutMs`——网络门禁会拦下漏传的调用点。

## 部署

推到 GitHub 后由 Cloudflare Pages 自动构建部署（`zhushen-space.pages.dev`）。构建输出目录 `dist`。

> Pages 单文件上限 **25 MiB**，向量库分片阈值因此压在 20 MiB。
