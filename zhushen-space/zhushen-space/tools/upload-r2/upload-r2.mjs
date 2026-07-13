#!/usr/bin/env node
/**
 * 把 仓库根 图片/ 和 欢愉宫图片/ 上传到 Cloudflare R2（R2-only 部署），并生成/上传 manifest.json。
 *   一次性安装依赖：npm i -D @aws-sdk/client-s3
 *   填好 config.json 后：npm run upload-r2
 *   断点续传：默认跳过 R2 里已存在的同名对象；想全部重传加 --force。
 *
 * R2 键结构（前端 Function 在 /enhance-bosses/*、/joy-girls/* 上取用，前端无需改）：
 *   enhance-bosses/<角色>/阶段N/xxx.png + enhance-bosses/manifest.json
 *   joy-girls/<美女>/阶段N/xxx.png      + joy-girls/manifest.json
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const HERE = dirname(fileURLToPath(import.meta.url));
const FORCE = process.argv.includes('--force');
const CONCURRENCY = 6;

let cfg;
try { cfg = JSON.parse(await readFile(join(HERE, 'config.json'), 'utf8')); }
catch { console.error('✗ 缺 config.json'); process.exit(1); }
for (const k of ['accountId', 'accessKeyId', 'secretAccessKey', 'bucket']) {
  if (!cfg[k]) { console.error(`✗ config.json 缺字段：${k}`); process.exit(1); }
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
});

const IMG = /\.(png|jpe?g|webp|gif|avif)$/i;
const CT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };
const ctype = (f) => CT[extname(f).toLowerCase()] || 'application/octet-stream';
const stageNo = (n) => { const m = n.match(/(\d+)/); return m ? parseInt(m[1], 10) : 0; };
const put = (key, body, contentType) => s3.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }));
async function exists(key) {
  try { await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key })); return true; }
  catch (e) { if (e?.$metadata?.httpStatusCode === 404 || /NotFound|NoSuchKey/.test(e?.name || '')) return false; throw e; }
}
async function pool(items, n, worker) {
  let i = 0;
  const run = async () => { while (i < items.length) { const idx = i++; await worker(items[idx]); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

const SETS = [
  { src: join(HERE, '../../../../图片'), prefix: 'enhance-bosses' },
  { src: join(HERE, '../../../../欢愉宫图片'), prefix: 'joy-girls' },
];

// ① 扫描本地，收集上传任务 + 构建 manifest
const tasks = [];
const manifests = [];
for (const { src, prefix } of SETS) {
  if (!existsSync(src)) { console.log(`· 跳过（不存在）：${prefix}`); continue; }
  const manifest = {};
  for (const boss of await readdir(src, { withFileTypes: true })) {
    if (!boss.isDirectory()) continue;
    const stages = {};
    for (const stage of await readdir(join(src, boss.name), { withFileTypes: true })) {
      if (!stage.isDirectory()) continue;
      const no = stageNo(stage.name);
      if (no < 1 || no > 4) continue;
      const dir = join(src, boss.name, stage.name);
      const files = (await readdir(dir)).filter((f) => IMG.test(f));
      if (!files.length) continue;
      const urls = [];
      for (const f of files) {
        const rel = `${boss.name}/${stage.name}/${f}`;
        tasks.push({ key: `${prefix}/${rel}`, file: join(dir, f), ct: ctype(f) });
        urls.push(rel);
      }
      stages[String(no)] = urls;
    }
    if (Object.keys(stages).length) manifest[boss.name] = stages;
  }
  manifests.push({ prefix, manifest });
}

// ①.5 BGM：把音乐上传到 R2 的 audio/bgm/ 前缀 + 生成前端要的 [{file,name,bytes}] 清单（同源 Function /audio/bgm/* 取用）
const AUD = /\.(mp3|ogg|m4a|aac|flac|opus|wav)$/i;
const AUD_CT = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.opus': 'audio/opus', '.wav': 'audio/wav' };
const audCtype = (f) => AUD_CT[extname(f).toLowerCase()] || 'application/octet-stream';
const BGM_PREFIX = 'audio/bgm';
// 试水：只上《赛博朋克2077》一套；要全上改成 join(HERE, '../../../../BGM')（会递归所有子文件夹）
const BGM_SRC = join(HERE, '../../../../BGM/游戏bgm/2077');

let bgmManifest = null;
if (existsSync(BGM_SRC)) {
  bgmManifest = [];
  const walk = async (dir, rel) => {
    const category = basename(dir);   // 主题 = 文件所在文件夹名（2077 / 巫师三 / jpop …）
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { await walk(join(dir, e.name), relPath); continue; }
      if (!AUD.test(e.name)) continue;
      const full = join(dir, e.name);
      let bytes = 0; try { bytes = (await stat(full)).size; } catch { /* */ }
      tasks.push({ key: `${BGM_PREFIX}/${relPath}`, file: full, ct: audCtype(e.name) });
      bgmManifest.push({ file: relPath, name: e.name.replace(AUD, ''), category, bytes });
    }
  };
  await walk(BGM_SRC, '');
  bgmManifest.sort((a, b) => a.file.localeCompare(b.file, 'zh'));
  const mb = (bgmManifest.reduce((s, t) => s + t.bytes, 0) / 1048576).toFixed(0);
  console.log(`· BGM：扫描到 ${bgmManifest.length} 首 / 约 ${mb}MB（→ ${BGM_PREFIX}/）`);
} else {
  console.log(`· 跳过 BGM（源不存在）：${BGM_SRC}`);
}

// ② 并发上传图片（默认跳过已存在）
console.log(`共 ${tasks.length} 张待处理（并发 ${CONCURRENCY}${FORCE ? '，--force 全量重传' : '，跳过已存在'}）…`);
let up = 0, skip = 0, fail = 0, processed = 0;
const t0 = Date.now();
await pool(tasks, CONCURRENCY, async (t) => {
  try {
    if (!FORCE && await exists(t.key)) { skip++; }
    else { await put(t.key, await readFile(t.file), t.ct); up++; }
  } catch (e) { fail++; console.error(`  ✗ ${t.key}: ${e?.message || e}`); }
  if (++processed % 20 === 0 || processed === tasks.length) {
    process.stdout.write(`  进度 ${processed}/${tasks.length}（传 ${up} 跳 ${skip} 败 ${fail}）${Math.round((Date.now() - t0) / 1000)}s\n`);
  }
});

// ③ 上传/更新 manifest
for (const { prefix, manifest } of manifests) {
  await put(`${prefix}/manifest.json`, JSON.stringify(manifest, null, 2), 'application/json');
  console.log(`  ✓ ${prefix}/manifest.json（${Object.keys(manifest).length} 个角色）`);
}
if (bgmManifest) {   // BGM 清单（数组格式，前端 /audio/bgm/manifest.json 直接用）
  await put(`${BGM_PREFIX}/manifest.json`, JSON.stringify(bgmManifest, null, 2), 'application/json');
  console.log(`  ✓ ${BGM_PREFIX}/manifest.json（${bgmManifest.length} 首）`);
}
console.log(`\n完成：上传 ${up}、跳过 ${skip}、失败 ${fail}，桶「${cfg.bucket}」。`);
