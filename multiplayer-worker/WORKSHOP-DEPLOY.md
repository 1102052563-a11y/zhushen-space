# 创意工坊后端 · 部署步骤

工坊接口已并入现有 `zhushen-multiplayer` Worker（`src/workshop.js`，路由 `/api/workshop/*`），存储用 **Cloudflare D1**。前端默认连这个 Worker（`mpBase()`），所以**部署完即可用，无需改前端**。

## 一次性：建 D1 库并填 id

> 注意：本机没有全局 `wrangler`，它装在项目本地，命令前加 `npx`（或用 `npm run deploy`）。

```powershell
cd multiplayer-worker

# 1) 建库（返回里有 database_id）
npx wrangler d1 create zhushen-workshop

# 2) 把返回的 database_id 填进 wrangler.toml 的 [[d1_databases]] → database_id
#    （把 REPLACE_WITH_YOUR_D1_DATABASE_ID 换掉）

# 3) 建表（worker 首次请求也会自动建，这步可选；远程库执行一次更稳）
npx wrangler d1 execute zhushen-workshop --remote --file=schema-workshop.sql
```

## 部署

```powershell
npx wrangler deploy      # 或 npm run deploy
```

部署后自检：

```
GET  https://<你的worker域名>/api/workshop/items      → {"items":[]}（空库正常）
```

## 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/workshop/items?type=&category=&q=&sort=recent|downloads&limit=` | 列表（只回元数据 + 下载数，不含 payload） |
| POST | `/api/workshop/items` | 上传一条（**无审核**，实时可见）。体 `{type,name,category?,author?,version?,summary?,tags?,contentHash?,payload}` |
| GET | `/api/workshop/items/:id` | 取单条（含 payload） |
| POST | `/api/workshop/items/:id/download` | 下载数 +1，回 `{downloads}` |

## 防护 / 成本

- 单条 payload ≤ 256KB；同 IP（盐哈希）1 小时最多 20 条；字段长度截断。
- 无审核公开上传 = 有滥用面（垃圾/违规）。**管理员删除**：在 worker 设一个密钥，之后在游戏里「创意工坊 → 设置 → 管理员密钥」填同一个，即可删除任意条目（内容审核）：
  ```powershell
  npx wrangler secret put WS_ADMIN_KEY      # 按提示输入你的密钥；改完无需手动 deploy（secret 即时生效）
  ```
- 也可命令行直接删：
  `npx wrangler d1 execute zhushen-workshop --remote --command "DELETE FROM workshop_items WHERE id='xxx'"`
- D1/Workers 免费额度对这种体量基本 $0；详见 Cloudflare 计费。可选给上传加道口令：在 worker env 设 `WS_SALT` 仅影响限流哈希（非鉴权）。
