#!/usr/bin/env node
/**
 * 把 仓库根 图片/ 和 欢愉宫图片/ 上传到 Cloudflare R2（R2-only 部署），并生成/上传 manifest.json。
 *   一次性安装依赖：npm i -D @aws-sdk/client-s3
 *   填好 config.json（accountId/accessKeyId/secretAccessKey/bucket）后：npm run upload-r2
 *
 * R2 里的键结构与前端预期一致：
 *   enhance-bosses/<角色>/阶段N/xxx.png   + enhance-bosses/manifest.json
 *   joy-girls/<美女>/阶段N/xxx.png        + joy-girls/manifest.json
 * Pages Function 在 /enhance-bosses/*、/joy-girls/* 上把它们取出来，前端无需改动。
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const HERE = dirname(fileURLToPath(import.meta.url));
let cfg;
try { cfg = JSON.parse(await readFile(join(HERE, 'config.json'), 'utf8')); }
catch { console.error('✗ 缺 config.json —— 复制 config.example.json 为 config.json 并填 R2 凭据'); process.exit(1); }
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

// 仓库根 源目录 → R2 前缀
const SETS = [
  { src: join(HERE, '../../../../图片'), prefix: 'enhance-bosses' },
  { src: join(HERE, '../../../../欢愉宫图片'), prefix: 'joy-girls' },
];

let grandTotal = 0;
for (const { src, prefix } of SETS) {
  if (!existsSync(src)) { console.log(`· 跳过（不存在）：${src}`); continue; }
  console.log(`\n=== ${prefix}  ←  ${src} ===`);
  const manifest = {};
  let uploaded = 0;
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
        try { await put(`${prefix}/${rel}`, await readFile(join(dir, f)), ctype(f)); urls.push(rel); uploaded++; }
        catch (e) { console.error(`  ✗ ${rel}: ${e?.message || e}`); }
      }
      if (urls.length) stages[String(no)] = urls;
    }
    if (Object.keys(stages).length) { manifest[boss.name] = stages; console.log(`  ✓ ${boss.name}: ${Object.values(stages).reduce((s, a) => s + a.length, 0)} 张`); }
  }
  await put(`${prefix}/manifest.json`, JSON.stringify(manifest, null, 2), 'application/json');
  grandTotal += uploaded;
  console.log(`  → 共上传 ${uploaded} 张 + manifest.json（${Object.keys(manifest).length} 个角色）`);
}
console.log(`\n完成：总计 ${grandTotal} 张已上传到 R2 桶「${cfg.bucket}」。`);
