#!/usr/bin/env node
/**
 * 清理 R2 桶里「本地已不存在」的旧图片对象（WebP 化后遗留的 .png 等）。
 *   默认 = dry-run：只扫描统计 + 列出待删清单，绝不删除。
 *   加 --apply 才真正删除。
 *
 * 判定规则（保守·三重保护，杜绝误删）：
 *   ① 只在 joy-girls/ 与 enhance-bosses/ 两个前缀内操作（其它前缀如 audio/bgm 一概不碰）；
 *   ② 只考虑图片扩展名的对象（manifest.json 等非图片天然排除）；
 *   ③ 只删「本地对应源文件确实不存在」的对象——现存的 .webp 本地都在，绝不会被删。
 * 前缀 → 本地源目录映射（与 upload-r2.mjs 的 SETS 一致）：
 *   joy-girls/<x>      ← 欢愉宫图片/<x>
 *   enhance-bosses/<x> ← 图片/<x>
 *
 * ⚠ 正确顺序：先 `npm run upload-r2`（传新 webp + 刷新 manifest），再跑本脚本删旧 png。
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

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
// 前缀 → 本地源目录（仓库根相对本脚本 ../../../../）
const MAP = [
  { prefix: 'joy-girls/', local: join(HERE, '../../../../欢愉宫图片') },
  { prefix: 'enhance-bosses/', local: join(HERE, '../../../../图片') },
];

// 列全前缀下的所有对象（分页）
async function listAll(prefix) {
  const keys = [];
  let token;
  do {
    const out = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of out.Contents || []) keys.push(o.Key);
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

const ext = (k) => (extname(k).toLowerCase().replace('.', '') || '(none)');
const bump = (m, key) => m.set(key, (m.get(key) || 0) + 1);

let grandDelete = [];
for (const { prefix, local } of MAP) {
  const keys = await listAll(prefix);
  const onlineByExt = new Map();      // 线上现有：按扩展名
  const toDelete = [];                // 本地不存在的图片对象
  let keepImg = 0, nonImg = 0;
  for (const key of keys) {
    if (!IMG.test(key)) { nonImg++; continue; }        // manifest.json 等：不动
    bump(onlineByExt, ext(key));
    const rel = key.slice(prefix.length);              // 去掉前缀 → 相对路径
    const localPath = join(local, ...rel.split('/'));  // 映射回本地源文件
    if (existsSync(localPath)) keepImg++;              // 本地还在（现存 webp）→ 保留
    else toDelete.push(key);                            // 本地已删（旧 png）→ 待删
  }
  const delByExt = new Map();
  for (const k of toDelete) bump(delByExt, ext(k));
  console.log(`\n■ ${prefix}`);
  console.log(`  线上图片对象：${[...onlineByExt].map(([e, n]) => `${e}×${n}`).join('、') || '无'}${nonImg ? `　(另有 ${nonImg} 个非图片对象·如 manifest，不动)` : ''}`);
  console.log(`  本地仍在(保留)：${keepImg}　│　本地已删(待删)：${toDelete.length}${toDelete.length ? `　[${[...delByExt].map(([e, n]) => `${e}×${n}`).join('、')}]` : ''}`);
  if (toDelete.length) console.log(`  抽样待删：${toDelete.slice(0, 4).join(' , ')}${toDelete.length > 4 ? ' …' : ''}`);
  grandDelete = grandDelete.concat(toDelete);
}

console.log(`\n══ 合计待删 ${grandDelete.length} 个对象 ══`);
if (!grandDelete.length) { console.log('（没有需要清理的旧对象——线上已干净或尚未上传新 webp）'); process.exit(0); }

if (!APPLY) {
  console.log('这是 dry-run（未删除任何对象）。确认无误后加 --apply 执行删除。');
  process.exit(0);
}

// 真删：DeleteObjects 每批 ≤1000
let deleted = 0, failed = 0;
for (let i = 0; i < grandDelete.length; i += 1000) {
  const batch = grandDelete.slice(i, i + 1000);
  try {
    const out = await s3.send(new DeleteObjectsCommand({ Bucket: cfg.bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
    deleted += batch.length - (out.Errors?.length || 0);
    if (out.Errors?.length) { failed += out.Errors.length; for (const e of out.Errors.slice(0, 5)) console.error(`  ✗ ${e.Key}: ${e.Message}`); }
  } catch (e) { failed += batch.length; console.error(`  ✗ 批次失败: ${e?.message || e}`); }
  process.stdout.write(`  已删 ${deleted}/${grandDelete.length}${failed ? `（失败 ${failed}）` : ''}\n`);
}
console.log(`\n完成：删除 ${deleted}、失败 ${failed}，桶「${cfg.bucket}」。`);
