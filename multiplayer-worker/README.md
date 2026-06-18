# 轮回乐园 · 联机后端（Cloudflare Worker + Durable Objects）

房主权威 + 服务器中继 + 回合制快照同步。你**部署一次**，房主只是发 HTTP 建房，不部署任何东西。

## 结构
- `src/index.js` — 入口 Worker：REST 路由 + WS 升级转发
- `src/RoomDO.js` — 每房一个实例：WS 协调 + 房间权威状态（用 Hibernation API，空闲不计费）
- `src/LobbyDO.js` — 单例：公共大厅注册表
- `wrangler.toml` — DO 绑定 + SQLite 迁移

## 部署（约 2 分钟）
```powershell
cd multiplayer-worker
npm install
npx wrangler login      # 浏览器登录你的 Cloudflare 账号
npx wrangler deploy
```
部署成功后会打印地址，形如：
`https://zhushen-multiplayer.<你的子域>.workers.dev`

冒烟测试（应返回 `{"ok":true,...}`）：
```powershell
curl https://zhushen-multiplayer.<你的子域>.workers.dev/api/multiplayer/diagnostics
```

本地调试（无需登录，miniflare 跑在 http://localhost:8787）：
```powershell
npm run dev
```

## 配置前端来源（可选）
`wrangler.toml` 的 `ALLOWED_ORIGINS` 留空 = 反射任意来源（本后端无 cookie，能用）。
正式上线建议改成：
```
ALLOWED_ORIGINS = "https://zhushen-space.pages.dev,http://localhost:5173"
```
改完 `npx wrangler deploy` 重新部署。

## HTTP / WS 接口（前端按此对接）
| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/multiplayer/diagnostics` | 健康检查 |
| POST | `/api/multiplayer/rooms` | 建房 `{hostId,hostName,name,maxSeats,visibility}` → `{roomId}` |
| GET | `/api/multiplayer/rooms` | 公共大厅列表 |
| GET | `/api/multiplayer/rooms/:id` | 房间信息（加入前展示） |
| POST | `/api/multiplayer/rooms/:id/close` | 关房 `{playerId}`（须等于 hostId） |
| WS | `/api/multiplayer/rooms/:id/ws?pid=&name=&want=play\|watch` | 进房长连 |

### WS 消息协议（事件名照搬 fanren）
**客户端 → 服务器**：`start_turn`(房主) · `submit_input`{text,snapshot}(玩家) · `publish_world_snapshot`{payload}(房主) · `publish_combat_snapshot` · `start_combat_action` / `submit_combat_action` / `skip_combat_action` · `send_room_comment`{text} · `leave_room` · `close_room`(房主) · 心跳发**字符串** `"ping"`（运行时自动回 `pong`，不唤醒 DO）

**服务器 → 客户端**：`room_state` · `world_snapshot` · `combat_snapshot` · `player_snapshots` · `turn_started` / `turn_updated` / `turn_resolved` · `seats_updated` · `combat_action_required` / `combat_action_updated` · `room_comment` · `room_closed` · `error`

## v1 边界（已知，后续再加）
- 自动入座，无审批（`approve_join`/`reject_join` 已留类型）
- 身份只认客户端传的 `pid`，房主动作靠 `pid===hostId` 校验；**未做签名 token**（后续加）
- 战斗类消息已做透传中继，前端 CombatPanel 接上即用（Phase 2）
