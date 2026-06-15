#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────
   轮回乐园原著 → 向量资料库 一次性建库脚本
   读 UTF-16 LE 全文 → 按章切 ~700 字块 → 批量调 embedding(bge-m3) →
   单位归一化 + int8 量化 → 输出 public/novel-vectors/{vectors.bin, chunks.json.gz, manifest.json}

   用法（在 zhushen-space/zhushen-space/ 目录下）：
     PowerShell:  $env:EMBED_KEY="sk-你的硅基流动key"; node tools/build-novel-vectors.mjs
     或 npm run build-vectors（package.json 已加该脚本）
   可选环境变量：EMBED_BASE / EMBED_MODEL / INPUT / CHUNK / OVERLAP / BATCH / CONCURRENCY / DIM
   断点续传：中途 Ctrl+C 后再次运行会从已完成处继续（靠 public/novel-vectors/.progress.json）。
   ────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const E = process.env;
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));

const INPUT   = args.input || E.INPUT || '../../轮回乐园（精校版）.txt';   // 相对项目根
const OUTDIR  = args.out || E.OUT || 'public/novel-vectors';
const BASE    = (E.EMBED_BASE || args.base || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
const KEY     = E.EMBED_KEY || args.key;
const MODEL   = E.EMBED_MODEL || args.model || 'Pro/BAAI/bge-m3';
const CHUNK   = +(E.CHUNK || args.chunk || 700);
const OVERLAP = +(E.OVERLAP || args.overlap || 100);
const BATCH   = +(E.BATCH || args.batch || 32);
const CONC    = +(E.CONCURRENCY || args.concurrency || 3);
const DIM     = +(E.DIM || args.dim || 1024);

if (!KEY) { console.error('✗ 缺少 EMBED_KEY（你的硅基流动 API Key）。例：$env:EMBED_KEY="sk-..."; node tools/build-novel-vectors.mjs'); process.exit(1); }
if (!fs.existsSync(INPUT)) { console.error(`✗ 找不到原著文件：${path.resolve(INPUT)}（用 --input=路径 指定）`); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 1) 读 + 解码（UTF-16 LE / UTF-8 BOM 自动识别）── */
function readText(p) {
  const raw = fs.readFileSync(p);
  if (raw[0] === 0xFF && raw[1] === 0xFE) return raw.toString('utf16le').replace(/^﻿/, '');
  if (raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) return raw.toString('utf8').replace(/^﻿/, '');
  return raw.toString('utf8');
}

/* ── 2) 按卷/章切，再章内滑窗 ~CHUNK 字（带 OVERLAP，尽量句末断）── */
const NUM = '\\d一二三四五六七八九十百千零两';
const VOL_RE  = new RegExp(`^第[${NUM}]{1,8}卷`);
const CHAP_RE = new RegExp(`^第[${NUM}]{1,8}章`);
function chunkNovel(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/　/g, '  ').split('\n');
  const out = [];
  let vol = '', chap = '', buf = '';
  const flush = () => {
    const t = buf.replace(/\n{2,}/g, '\n').trim(); buf = '';
    if (t.length < 20) return;
    let i = 0;
    while (i < t.length) {
      let end = Math.min(i + CHUNK, t.length);
      if (end < t.length) { // 向后最多 80 字找句末断点
        let j = end; while (j < t.length && j < end + 80 && !'。！？\n”』'.includes(t[j])) j++;
        if (j < t.length && j < end + 80) end = j + 1;
      }
      const piece = t.slice(i, end).trim();
      if (piece.length >= 20) out.push({ t: piece, v: vol, c: chap });
      if (end >= t.length) break;
      i = Math.max(i + 1, end - OVERLAP);
    }
  };
  for (const ln of lines) {
    const s = ln.trim();
    if (VOL_RE.test(s))  { flush(); vol = s.slice(0, 40); continue; }
    if (CHAP_RE.test(s)) { flush(); chap = s.slice(0, 40); continue; }
    buf += ln + '\n';
    if (buf.length > CHUNK * 4) flush();
  }
  flush();
  return out;
}

/* ── 3) 调 embedding（含重试/退避）── */
async function embedBatch(texts) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${BASE}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: MODEL, input: texts, encoding_format: 'float' }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if ((res.status === 429 || res.status >= 500) && attempt < 7) { await sleep(800 * 2 ** attempt); continue; }
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 240)}`);
      }
      const j = await res.json();
      return j.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    } catch (e) {
      if (attempt < 7) { await sleep(800 * 2 ** attempt); continue; }
      throw e;
    }
  }
}
function quantize(vec, out, off) {            // 单位归一化 → ×127 → int8
  let n = 0; for (const x of vec) n += x * x; n = Math.sqrt(n) || 1;
  for (let k = 0; k < DIM; k++) { let q = Math.round((vec[k] / n) * 127); out[off + k] = q > 127 ? 127 : q < -127 ? -127 : q; }
}

/* ── main ── */
const t0 = Date.now();
console.log(`读取 ${INPUT} …`);
const chunks = chunkNovel(readText(INPUT));
const total = chunks.length;
console.log(`切出 ${total} 块（每块~${CHUNK}字）。模型 ${MODEL}，${DIM} 维，int8 量化。`);
fs.mkdirSync(OUTDIR, { recursive: true });

const vectors = new Int8Array(total * DIM);
const vPath = path.join(OUTDIR, 'vectors.bin');
const pPath = path.join(OUTDIR, '.progress.json');
let doneCount = 0;
if (fs.existsSync(vPath) && fs.existsSync(pPath)) {
  try {
    const prog = JSON.parse(fs.readFileSync(pPath, 'utf8'));
    if (prog.dim === DIM && prog.model === MODEL && prog.total === total && prog.count <= total) {
      const saved = fs.readFileSync(vPath);
      vectors.set(new Int8Array(saved.buffer, saved.byteOffset, prog.count * DIM));
      doneCount = prog.count;
      console.log(`续传：已完成 ${doneCount}/${total}`);
    }
  } catch { /* */ }
}

const batches = [];
for (let i = doneCount; i < total; i += BATCH) batches.push([i, Math.min(i + BATCH, total)]);
const batchDone = new Array(batches.length).fill(false);
let next = 0, failed = 0;
const contiguous = () => { let n = doneCount; for (let i = 0; i < batches.length; i++) { if (batchDone[i]) n = batches[i][1]; else break; } return n; };
const flushCkpt = () => {
  const c = contiguous();
  fs.writeFileSync(vPath, Buffer.from(vectors.buffer, 0, c * DIM));
  fs.writeFileSync(pPath, JSON.stringify({ count: c, total, dim: DIM, model: MODEL }));
};
async function worker() {
  while (next < batches.length) {
    const idx = next++; const [s, e] = batches[idx];
    try {
      const embs = await embedBatch(chunks.slice(s, e).map((c) => c.t));
      for (let k = 0; k < embs.length; k++) quantize(embs[k], vectors, (s + k) * DIM);
      batchDone[idx] = true;
    } catch (err) { failed++; console.error(`\n批次 ${idx}(${s}-${e}) 失败：${err.message}`); }
    if (idx % 8 === 0) { flushCkpt(); const c = contiguous(); process.stdout.write(`\r已嵌入 ${c}/${total} (${((c / total) * 100).toFixed(1)}%)  失败批 ${failed}`); }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
flushCkpt();

if (contiguous() < total) {
  console.error(`\n⚠ 还有未完成的块（contiguous=${contiguous()}/${total}，失败批 ${failed}）。已存进度，重跑本脚本可续传。`);
  process.exit(1);
}

/* ── 写出成品 ── */
fs.writeFileSync(vPath, Buffer.from(vectors.buffer));
fs.writeFileSync(path.join(OUTDIR, 'chunks.json.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(chunks), 'utf8')));
fs.writeFileSync(path.join(OUTDIR, 'manifest.json'), JSON.stringify({
  source: path.basename(INPUT), model: MODEL, dim: DIM, count: total, chunkSize: CHUNK, overlap: OVERLAP,
  normalized: true, quant: 'int8', builtAt: new Date().toISOString(),
}, null, 2));
try { fs.unlinkSync(pPath); } catch { /* */ }

const mb = (p) => (fs.statSync(path.join(OUTDIR, p)).size / 1048576).toFixed(1);
console.log(`\n✓ 完成！${total} 块，用时 ${((Date.now() - t0) / 1000 / 60).toFixed(1)} 分钟`);
console.log(`  ${OUTDIR}/vectors.bin       ${mb('vectors.bin')} MB`);
console.log(`  ${OUTDIR}/chunks.json.gz    ${mb('chunks.json.gz')} MB`);
console.log(`  ${OUTDIR}/manifest.json`);
console.log(`下一步：这三个文件已在 public/，前端「向量资料库」开启后会自动懒加载。`);
