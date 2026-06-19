# 创意工坊 · 工坊源说明

诛神空间「创意工坊」走 **在线读取为主**：前端拉一个托管的索引 JSON → 浏览 → 一键安装，并按版本/内容哈希显示「新装 / 已装 / 有更新」。投稿走「导出投稿文件」，由维护者合进索引（无社区上传后端）。

本文件夹会随站点一起部署，`index.json` 是**默认内置源**（前端默认源 URL = `workshop/index.json`，同源）。要建自己的工坊：**编辑 `index.json` 后重新部署**即可；也可以把索引托管在别处（GitHub raw、任意 https），在面板「⚙ 管理源」里添加。

---

## 一、索引文件格式（index.json）

```jsonc
{
  "kind": "zhushen-workshop-index",   // 固定
  "formatVersion": 1,
  "name": "我的工坊",
  "updatedAt": "2026-06-19",
  "items": [ /* 条目数组，见下 */ ]
}
```

每个条目 = **元数据 + 内容**。内容二选一：内联 `payload`（小条目直接写在索引里）或外链 `payloadUrl`（指向单独的 JSON，相对索引 URL 解析）。

```jsonc
{
  "id": "tp-darknight-1",        // 全局唯一，更新检测靠它
  "type": "textPreset",          // 内容类型，见下表
  "name": "暗夜叙事风",
  "author": "某作者",
  "version": "1.2.0",            // 改版本号 → 已安装的人看到「↻ 更新」
  "updatedAt": "2026-06-19",
  "summary": "偏黑暗、强代入的正文风格…",
  "tags": ["正文", "黑暗"],
  "contentHash": "ab12cd34",     // 可选；不填则安装时按 payload 自动算
  "payload": { /* 内容本体，结构由 type 决定 */ }
  // 或者： "payloadUrl": "items/tp-darknight-1.json"
}
```

> 更新检测：已安装条目，当索引里的 `version` 与本地记录不同（或 `contentHash` 不同）时显示「↻ 更新」。所以**发新版务必改 `version`**。

---

## 二、内容类型与 payload 结构

| `type` | 说明 | `payload` 是什么 |
|---|---|---|
| `textPreset` | 正文预设 | 一个正文预设对象（`settings → 正文预设` 导出的那种） |
| `worldbook` | 世界书 | 一本世界书对象 `{ name, enabled, entries:[…] }` |
| `skillTree` | 职业技能树模板 | 一个 `TreeDef` 对象（技能树编辑器导出的 `.tree.json`） |
| `creationTemplate` | 角色创建模板 | `{ name, data }`（data = 开局设定） |
| `configBundle` | 整套配置（整包） | 一个 `zhushen-global-config` 对象（全局配置导出文件） |

**最省事的造条目方式**：在游戏里打开「创意工坊 → 投稿 / 导入」，选类型 + 本地条目，填好信息点「⤒ 导出投稿文件」。导出的 `工坊-xxx.json` 就是一个 `zhushen-workshop-item` 文件——

- 想内联进索引：把它的 `meta` 摊平进条目、`payload` 原样放进条目的 `payload`；
- 想外链：把整个文件丢进 `items/` 目录，条目写 `"payloadUrl": "items/工坊-xxx.json"`（前端会自动识别 `zhushen-workshop-item` 并取其 `payload`）。

---

## 三、托管方式

1. **同源（最简单）**：改本目录 `index.json` → 重新构建部署。默认源即生效，零额外服务。
2. **GitHub / 其它 https**：把 `index.json`（及 `items/*.json`）托管到任意可公开访问、带 CORS 的地址（GitHub raw 自带 `Access-Control-Allow-Origin: *`），在面板「⚙ 管理源 → 添加」填入索引 URL 即可。

> 要求：返回合法 JSON、`kind` 为 `zhushen-workshop-index`、浏览器可跨域读取。
