/* 👗📦 内置成衣包分片构建：把仓库根的 Outfit-Manager 导出 outfit-mgr-char-*.json（可 40MB+）
   切成 ≤20MB 的分片放进 public/outfit-packs/，游戏「形象工坊→成衣库→内置成衣包」按需下载导入。
   为什么切片：Cloudflare Pages 单文件硬上限 25MiB（见 CLAUDE.md / cloudflare-pages-25mib 记忆），整包 47MB 传不上去。
   分片保持源格式 {type:'char',charName,outfits:[…]}——前端用同一个 parseOutfitPack 解析，零特殊分支。
   跑法（在内层 zhushen-space/zhushen-space/）：node scripts/build-outfit-pack.mjs
   源文件本体已 .gitignore（outfit-mgr-char-*.json）；产物 packN-sM.json + manifest.json 是要入库提交的。 */
import fs from 'node:fs';
import path from 'node:path';

const INNER = process.cwd();                                   // 期望=内层项目目录
const REPO_ROOT = path.resolve(INNER, '..', '..');             // 仓库根（源文件所在）
const OUT_DIR = path.join(INNER, 'public', 'outfit-packs');
const SHARD_LIMIT = 20 * 1024 * 1024;                          // 20MB/片（< Pages 25MiB 硬限，留余量）

const sources = fs.readdirSync(REPO_ROOT)
  .filter((f) => f.startsWith('outfit-mgr-char-') && f.endsWith('.json'))
  .sort();
if (!sources.length) {
  console.error(`[outfit-pack] 仓库根（${REPO_ROOT}）没找到 outfit-mgr-char-*.json，无事可做`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
// 清掉旧产物（逐文件 unlink——⚠本机 Node24 的 rmSync recursive 会静默失败，勿用）
for (const f of fs.readdirSync(OUT_DIR)) {
  if (/^pack\d+-s\d+\.json$/.test(f) || f === 'manifest.json') fs.unlinkSync(path.join(OUT_DIR, f));
}

const manifest = [];
sources.forEach((srcName, pi) => {
  const raw = fs.readFileSync(path.join(REPO_ROOT, srcName), 'utf8');
  let root;
  try { root = JSON.parse(raw); } catch (e) { console.error(`[outfit-pack] ${srcName} 不是有效 JSON，跳过：${e.message}`); return; }
  const outfits = Array.isArray(root?.outfits) ? root.outfits : [];
  if (!outfits.length) { console.error(`[outfit-pack] ${srcName} 没有 outfits，跳过`); return; }
  const charName = String(root?.charName ?? '').trim() || `导入包${pi + 1}`;
  const packId = `pack${pi + 1}`;

  // 按序切片：单条序列化超限也单独成片（不丢条目）
  const shards = [];
  let buf = [];
  let bufBytes = 0;
  const flush = () => {
    if (!buf.length) return;
    shards.push(buf);
    buf = []; bufBytes = 0;
  };
  for (const o of outfits) {
    const bytes = Buffer.byteLength(JSON.stringify(o), 'utf8');
    if (buf.length && bufBytes + bytes > SHARD_LIMIT) flush();
    buf.push(o); bufBytes += bytes;
  }
  flush();

  const shardFiles = [];
  shards.forEach((list, si) => {
    const file = `${packId}-s${si + 1}.json`;
    const body = JSON.stringify({ type: root?.type ?? 'char', charName, outfits: list });
    const size = Buffer.byteLength(body, 'utf8');
    if (size > 25 * 1024 * 1024) { console.error(`[outfit-pack] ❌ ${file} ${(size / 1048576).toFixed(1)}MiB 超 Pages 25MiB 硬限——有单条超大条目？中止`); process.exit(1); }
    fs.writeFileSync(path.join(OUT_DIR, file), body);
    shardFiles.push(file);
    console.log(`[outfit-pack] ${file}  ${list.length} 套  ${(size / 1048576).toFixed(1)} MiB`);
  });

  manifest.push({ id: packId, name: charName, count: outfits.length, source: srcName, shards: shardFiles });
});

if (!manifest.length) { console.error('[outfit-pack] 没有产出任何分片'); process.exit(1); }
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`[outfit-pack] ✓ manifest.json：${manifest.map((m) => `${m.name}(${m.count}套/${m.shards.length}片)`).join('、')}`);
