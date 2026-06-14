# 主神空间 · 无限流（原型）

一个用 **Vite + React + TypeScript + Tailwind CSS** 搭建的无限流题材网页游戏骨架。
主神把你拉进一个个致命副本，活着回来赚奖励点，强化属性，再挑战更难的世界。

## 已实现

- **副本系统**：4 个难度递增的副本（废弃医院 / 浣熊市 / 异形飞船 / 七夜古宅），每个副本是「事件 + 战斗 + 首领」的节点序列。
- **回合制战斗**：攻击 / 格挡，伤害 = max(1, 攻击 − 防御) 带浮动。
- **精神值（SAN）**：灵异/异形类敌人和事件会侵蚀精神，归零即「精神崩溃」失败。
- **抉择事件**：带风险与收益的文字选择。
- **强化商店**：用奖励点永久提升生命 / 攻击 / 防御 / 精神上限，成本指数增长。
- **本地存档**：进度自动存入 localStorage，支持导出 / 导入存档码、重置进度。

## 本地运行

需要 Node.js 18+。

```bash
npm install
npm run dev      # 打开终端给出的本地地址（默认 http://localhost:5173）
```

打包静态文件：

```bash
npm run build    # 产物在 dist/
npm run preview  # 本地预览打包结果
```

## 部署到 Cloudflare Pages（和你看到的那些 *.pages.dev 一样）

1. 把项目推到 GitHub / GitLab 仓库。
2. Cloudflare 控制台 → Workers & Pages → Create → Pages → 连接你的仓库。
3. 构建配置：
   - 框架预设：**Vite**（或留空）
   - 构建命令：`npm run build`
   - 构建输出目录：`dist`
4. 部署完成后会得到一个 `你的项目名.pages.dev` 域名，之后每次 push 自动重新部署。

## 项目结构

```
src/
  data/           # 纯配置表：怪物、副本、事件、强化（改这里即可加内容）
    monsters.ts
    instances.ts
    events.ts
    enhancements.ts
  systems/
    combat.ts      # 伤害与战力计算（纯函数）
  store/
    gameStore.ts   # Zustand 全局状态 + 所有游戏逻辑
  utils/
    save.ts        # localStorage 存档读写 + 导入导出
  components/      # UI：状态栏、主神空间、副本/战斗界面
  App.tsx          # 视图切换
  main.tsx
```

## 怎么扩展内容

- **加怪物**：在 `data/monsters.ts` 添加一条，再到某个副本的 `nodes` 里 `{ type: 'combat', monsterId: '你的id' }` 引用。
- **加副本**：在 `data/instances.ts` 数组里加一个对象，排好节点序列即可，UI 会自动列出。
- **加事件**：在 `data/events.ts` 添加，再在副本节点里用 `{ type: 'event', eventId: '...' }` 引用。
- **加强化项**：在 `data/enhancements.ts` 添加，商店自动显示。

逻辑和数据是分开的——绝大多数内容扩展都只动 `data/` 下的文件，不用碰组件和 store。

## 后续可加的方向

道具/背包系统、技能与天赋、装备掉落、多结局事件、随机词条副本、剧情对话、BGM/音效、成就系统。
