// 表情包·R2 托管工具（大体积表情包跟图片一样走 R2，不进仓库）。
// 读 zhushen-space/zhushen-space/_sticker_upload/<包名>/*.{gif,png,jpg,webp}（本地·已 gitignore），
// 按 SHA-256 内容哈希作 R2 key `stk/<hash>`（与 worker 的 /api/chat/sticker/<hash> 取图端点一致）。
//
//   node tools/stickers-r2.mjs manifest   # 生成前端哈希清单 src/data/r2StickerPacks.ts（仅哈希·约 10KB·不含图）
//   node tools/stickers-r2.mjs upload      # 把图传到 R2（需 wrangler 已登录 + 已建桶 zhushen-cloud-saves）
//   node tools/stickers-r2.mjs both        # 先 manifest 再 upload
//
// 前端：r2StickerPacks 里每张是 {id,hash,label}，stickerSrc 已支持 hash → mpBase/api/chat/sticker/<hash>（走 R2）。

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const HERE = path.dirname(fileURLToPath(import.meta.url));            // …/zhushen-space/zhushen-space/tools
const SRC = path.resolve(HERE, '../_sticker_upload');                 // 本地 staging（gitignore）
const OUT = path.resolve(HERE, '../src/data/r2StickerPacks.ts');     // 生成的前端哈希清单
const BUCKET = 'zhushen-cloud-saves';                                 // 与云存档同一 R2 桶
// wrangler 的 node 入口：用 `node wrangler.js` 直接跑，绕开 Windows 上 spawn 找不到 .cmd shim 的坑（ENOENT）。
const WRANGLER_JS = [
  path.resolve(HERE, '../../../multiplayer-worker/node_modules/wrangler/bin/wrangler.js'),
  path.resolve(HERE, '../node_modules/wrangler/bin/wrangler.js'),
].find((c) => existsSync(c));
const EMOJI = { '动态奶龙': '🐉' };                                    // 包标签 emoji（缺省 🖼）
const IMG = /\.(gif|png|jpe?g|webp)$/i;
const ctOf = (f) => /\.gif$/i.test(f) ? 'image/gif' : /\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg';

function scan() {
  if (!existsSync(SRC)) { console.error('没有 staging 目录:', SRC, '（把压缩好的图放进 _sticker_upload/<包名>/）'); process.exit(1); }
  const packs = [];
  for (const dir of readdirSync(SRC, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const stickers = [];
    for (const f of readdirSync(path.join(SRC, dir.name))) {
      if (!IMG.test(f)) continue;
      const file = path.join(SRC, dir.name, f);
      const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
      stickers.push({ id: f.replace(/\.[^.]+$/, ''), hash, ct: ctOf(f), file });
    }
    if (stickers.length) packs.push({ id: dir.name, label: dir.name, emoji: EMOJI[dir.name] || '🖼', stickers });
  }
  return packs;
}

function writeManifest(packs) {
  const data = packs.map((p) => ({ id: p.id, label: p.label, emoji: p.emoji, stickers: p.stickers.map((s) => ({ id: s.id, label: s.id, hash: s.hash })) }));
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT,
    `// 自动生成（tools/stickers-r2.mjs manifest）——R2 托管表情包的哈希清单：图在 R2，按 hash 经 worker 取，仓库不存图。勿手改。\n` +
    `import type { StickerPack } from '../systems/chatStickers';\n` +
    `export const R2_STICKER_PACKS: StickerPack[] = ${JSON.stringify(data, null, 2)};\n`);
  console.log('✓ 写出', path.relative(path.resolve(HERE, '../..'), OUT), '—', data.map((p) => p.id + ':' + p.stickers.length).join(', '));
}

function upload(packs) {
  if (!WRANGLER_JS) { console.error('找不到 wrangler（在 multiplayer-worker 里 npm install 过吗？）'); process.exit(1); }
  let n = 0, fail = 0;
  const total = packs.reduce((a, p) => a + p.stickers.length, 0);
  for (const p of packs) for (const s of p.stickers) {
    try {
      // 用 node 直接跑 wrangler.js（绕开 Windows .cmd 坑）；put 覆盖式幂等，重跑只是重传无副作用
      execFileSync(process.execPath, [WRANGLER_JS, 'r2', 'object', 'put', `${BUCKET}/stk/${s.hash}`, '--file', s.file, '--content-type', s.ct, '--remote'], { stdio: ['ignore', 'ignore', 'inherit'] });
      n++;
      if (n % 10 === 0 || n === total) console.log(`  ${n}/${total} 已传…`);
    } catch (e) { fail++; console.error('上传失败', s.file, e.message); }
  }
  console.log(`✓ 上传完成：成功 ${n} / 失败 ${fail} / 共 ${total}`);
}

const mode = process.argv[2] || 'manifest';
const packs = scan();
console.log('扫描到', packs.reduce((a, p) => a + p.stickers.length, 0), '张，分', packs.length, '包');
if (mode === 'manifest' || mode === 'both') writeManifest(packs);
if (mode === 'upload' || mode === 'both') upload(packs);
