-- 创意工坊 D1 表结构。worker 首次请求会自动建表（CREATE IF NOT EXISTS），
-- 这份文件供手动初始化/查阅：wrangler d1 execute zhushen-workshop --remote --file=schema-workshop.sql

CREATE TABLE IF NOT EXISTS workshop_items (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,          -- skill/talent/title/subProfession/equipment/gem/item/npc/skillTree/creationTemplate
  category     TEXT,                   -- 子分类：装备(武器/防具/饰品/法宝) / NPC(召唤物/随从/契约者/土著)
  name         TEXT NOT NULL,
  author       TEXT,
  version      TEXT,
  summary      TEXT,
  tags         TEXT,                   -- JSON 数组字符串
  payload      TEXT NOT NULL,          -- 内容本体 JSON 字符串
  content_hash TEXT,
  downloads    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  ip_hash      TEXT                    -- 上传者 IP 的盐哈希（仅用于限流，不可逆）
);

CREATE INDEX IF NOT EXISTS idx_ws_type ON workshop_items(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ws_downloads ON workshop_items(downloads DESC);
