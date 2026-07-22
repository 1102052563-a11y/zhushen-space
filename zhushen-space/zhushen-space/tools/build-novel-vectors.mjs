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

/* ── 分片：Cloudflare Pages 单文件上限 25 MiB，vectors.bin 超了就切成多片 ── */
const MAXPART = 24 * 1024 * 1024;   // 24 MiB，留余量
function writeVectorsMaybeSplit(outdir, buf) {
  const n = Math.ceil(buf.length / MAXPART);
  try { fs.unlinkSync(path.join(outdir, 'vectors.bin')); } catch { /* */ }          // 清旧单文件
  for (let i = 0; i < 64; i++) { const p = path.join(outdir, `vectors.bin.${i}`); if (fs.existsSync(p)) fs.unlinkSync(p); else break; }  // 清旧分片
  if (n <= 1) { fs.writeFileSync(path.join(outdir, 'vectors.bin'), buf); return 0; }  // 0 = 单文件
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(path.join(outdir, `vectors.bin.${i}`), buf.subarray(i * MAXPART, Math.min((i + 1) * MAXPART, buf.length)));
  }
  return n;
}

/* ── 仅分片模式：把已建好的 vectors.bin 切片 + 写 manifest.parts（不重新 embed）──
   用：node tools/build-novel-vectors.mjs --split-only --out=public/novel-vectors */
if (args['split-only'] || E.SPLIT_ONLY) {
  const mPath = path.join(OUTDIR, 'manifest.json');
  const vPath0 = path.join(OUTDIR, 'vectors.bin');
  if (!fs.existsSync(mPath)) { console.error(`✗ split-only: 找不到 ${mPath}`); process.exit(1); }
  if (!fs.existsSync(vPath0)) { console.error(`✗ split-only: 找不到 ${vPath0}（可能已切过片）`); process.exit(1); }
  const manifest = JSON.parse(fs.readFileSync(mPath, 'utf8'));
  const parts = writeVectorsMaybeSplit(OUTDIR, fs.readFileSync(vPath0));
  manifest.parts = parts;
  fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2));
  console.log(parts ? `✓ split-only: ${OUTDIR} → ${parts} 片（各 ≤24 MiB）` : `✓ split-only: ${OUTDIR} 无需切片`);
  process.exit(0);
}

const isDir = fs.existsSync(INPUT) && fs.statSync(INPUT).isDirectory();
// 只切块（统计预估 / 导出块明细），不调 embedding、不写产物 → 无需 EMBED_KEY
const DRY = !!(args['dry-run'] || E.DRY_RUN || args['dump-chunks']);

if (!KEY && !DRY) { console.error('✗ 缺少 EMBED_KEY（你的硅基流动 API Key）。例：$env:EMBED_KEY="sk-..."; node tools/build-novel-vectors.mjs'); process.exit(1); }
if (!fs.existsSync(INPUT)) { console.error(`✗ 找不到输入：${path.resolve(INPUT)}（用 --input=路径 指定，可为 txt / json / wiki 的 docs 目录）`); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ⚠ 代理对安全：JS 字符串按 UTF-16 码元索引，而 emoji（🆕⚠🏆…）是代理对（2 个码元）。
   在任意下标 slice 会把代理对劈成两半、留下孤立代理 —— 这种串 JSON 化后不是合法 UTF-8，
   embedding 接口会直接返回 HTTP 400（本 wiki 正文 emoji 极密，踩过这个坑）。
   sliceSafe: 切片边界对齐到完整码点;stripLone: 最终兜底清掉任何残留的孤立代理。 */
const isHigh = (c) => c >= 0xD800 && c <= 0xDBFF;
const isLow  = (c) => c >= 0xDC00 && c <= 0xDFFF;
function sliceSafe(s, a, b) {
  if (a > 0 && isLow(s.charCodeAt(a)) && isHigh(s.charCodeAt(a - 1))) a += 1;      // 别从代理对中间起
  if (b < s.length && isLow(s.charCodeAt(b)) && isHigh(s.charCodeAt(b - 1))) b -= 1; // 也别在中间断
  return s.slice(a, b);
}
function stripLone(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (isHigh(c)) {
      if (i + 1 < s.length && isLow(s.charCodeAt(i + 1))) { out += s[i] + s[i + 1]; i++; }
      continue;                       // 孤立高位代理：丢弃
    }
    if (isLow(c)) continue;           // 孤立低位代理：丢弃
    out += s[i];
  }
  return out;
}

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
      const piece = sliceSafe(t, i, end).trim();
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

/* ── 2b) 世界书 JSON → 每条 content 一块（过长再滑窗切）；comment 作标题、key 作来源标签 ── */
function chunkWorldBook(jsonText) {
  const j = JSON.parse(jsonText);
  const entries = j?.entries ? (Array.isArray(j.entries) ? j.entries : Object.values(j.entries)) : (Array.isArray(j) ? j : []);
  const out = [];
  for (const e of entries) {
    if (e?.disable === true || e?.enabled === false) continue;
    const content = String(e?.content ?? '').replace(/\r\n/g, '\n').trim();
    if (content.length < 10) continue;
    const title = String(e?.comment ?? e?.name ?? '').replace(/^\[[^\]]*\]\s*/, '').trim() || '设定';
    const keys = Array.isArray(e?.key) ? e.key.filter(Boolean).join('/') : '';
    if (content.length <= CHUNK * 1.6) { out.push({ t: content, v: keys, c: title }); continue; }
    let i = 0;
    while (i < content.length) {
      let end = Math.min(i + CHUNK, content.length);
      if (end < content.length) { let jx = end; while (jx < content.length && jx < end + 80 && !'。！？\n；'.includes(content[jx])) jx++; if (jx < content.length && jx < end + 80) end = jx + 1; }
      out.push({ t: sliceSafe(content, i, end).trim(), v: keys, c: title });
      if (end >= content.length) break;
      i = Math.max(i + 1, end - OVERLAP);
    }
  }
  return out;
}

/* ── 2c) 轮回WIKI（MkDocs docs/ 目录）→ 按「页面 + 小节」切块 ──
   与小说/世界书模式的差别：wiki 已经是结构化条目，天然按小节切最准。
   v = 分区路径（如 人物/烈阳星）、c = 「页名 › 小节名」，检索命中后可直接定位到条目。
   会跳过 front-matter、nav 指针行、表格分隔线；过长小节再滑窗切。 */
function chunkWikiDir(root) {
  const out = [];
  const SKIP_DIR = new Set(['assets', '.git']);
  const walk = (dir, rel) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) { if (!SKIP_DIR.has(name)) walk(p, rel ? `${rel}/${name}` : name); continue; }
      if (!name.endsWith('.md')) continue;
      let text = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
      // front-matter：取 title 作页名，其余丢弃
      let pageTitle = name.replace(/\.md$/, '');
      const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
      if (fm) {
        const m = fm[1].match(/^title:\s*(.+)$/m);
        if (m) pageTitle = m[1].trim().replace(/^["']|["']$/g, '');
        text = text.slice(fm[0].length);
      }
      // index.md 常无 title：退回 H1，再退回所在目录名（「世界/任务世界」比「index」有用得多）
      if (/^index$/i.test(pageTitle)) {
        const h1 = text.match(/^#\s+(.+?)\s*$/m);
        pageTitle = h1 ? h1[1].trim() : (rel ? rel.split('/').pop() : '首页');
      }
      // 逐行扫描，按 H2/H3 分节
      const lines = text.split('\n');
      let sec = '', buf = [];
      const flush = () => {
        let body = buf.join('\n')
          .replace(/^\s*⚠ 本[条节].*?已(独立成页|移入|并入).*$/gm, '')   // nav 指针行，无检索价值
          .replace(/^\s*\|[\s:\-|]+\|\s*$/gm, '')                        // 表格分隔线
          .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                          // 图片
          .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                       // 链接只留锚文本，路径不进嵌入
          .replace(/^\s*!!!\s+\S+\s*(?:"([^"]*)")?\s*$/gm, '$1')         // admonition 头留标题
          .replace(/^\s*```.*$/gm, '')                                   // 代码围栏
          .replace(/[*`_]{1,3}/g, '')                                    // 粗体/斜体/行内码标记
          .replace(/\n{3,}/g, '\n\n').trim();
        buf = [];
        if (body.length < 30) return;
        const label = sec ? `${pageTitle} › ${sec}` : pageTitle;
        const header = `【${label}】\n`;      // 把标题并进正文，短块也能靠标题命中
        if (body.length <= CHUNK * 1.6) { out.push({ t: header + body, v: rel || 'docs', c: label }); return; }
        let i = 0;
        while (i < body.length) {
          let end = Math.min(i + CHUNK, body.length);
          if (end < body.length) {
            let j = end;
            while (j < body.length && j < end + 80 && !'。！？\n；'.includes(body[j])) j++;
            if (j < body.length && j < end + 80) end = j + 1;
          }
          const piece = sliceSafe(body, i, end).trim();
          if (piece.length >= 30) out.push({ t: header + piece, v: rel || 'docs', c: label });
          if (end >= body.length) break;
          i = Math.max(i + 1, end - OVERLAP);
        }
      };
      for (const ln of lines) {
        const m = ln.match(/^(#{1,3})\s+(.+?)\s*$/);
        if (m) {
          flush();
          if (m[1].length >= 2) sec = m[2].replace(/[*`]/g, '').slice(0, 60);
          continue;
        }
        buf.push(ln);
      }
      flush();
    }
  };
  walk(root, '');
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
        const err = new Error(`HTTP ${res.status}: ${body}`);   // ⚠ 打全，别截断——400 的原因全在 message 里
        err.status = res.status;
        throw err;
      }
      const j = await res.json();
      return j.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    } catch (e) {
      if (attempt < 7) { await sleep(800 * 2 ** attempt); continue; }
      throw e;
    }
  }
}
/* ── 3b) 400 自愈：4xx 是永久错误（重试无用），二分定位到具体是哪一条，再对该条降级处理 ──
   400 常见成因：单条超模型上限、整批 token 总量超接口上限、文本里有接口不接受的内容。
   策略：批 >1 就对半拆开分别重试（自动把「整批太大」和「某条有问题」区分开）；
   拆到单条仍失败，则按 2000/1000/500/200 字梯度截断重试;仍失败就写零向量并记账
   （零向量 cosine 恒为 0、永不命中，等于该块不可检索，但不会让整次建库卡死）。 */
const badChunks = [];
async function embedSafe(texts, base) {
  try {
    return await embedBatch(texts);
  } catch (e) {
    const permanent = e.status >= 400 && e.status < 500 && e.status !== 429;
    if (!permanent) throw e;
    if (texts.length > 1) {
      const mid = texts.length >> 1;
      console.error(`\n  ↳ 批内二分定位（${texts.length} 条 → ${mid} + ${texts.length - mid}）…`);
      const a = await embedSafe(texts.slice(0, mid), base);
      const b = await embedSafe(texts.slice(mid), base);
      return a.concat(b);
    }
    const one = texts[0];
    for (const cap of [2000, 1000, 500, 200]) {
      if (one.length <= cap) continue;
      try {
        const r = await embedBatch([one.slice(0, cap)]);
        console.error(`  ↳ 第 ${base} 块截断到 ${cap} 字后成功（原 ${one.length} 字）`);
        return r;
      } catch { /* 继续降级 */ }
    }
    badChunks.push({ i: base, len: one.length, head: one.replace(/\n/g, ' ').slice(0, 70), err: String(e.message).slice(0, 300) });
    console.error(`  ↳ 第 ${base} 块无法嵌入，写零向量跳过。长度 ${one.length}\n     内容：${one.replace(/\n/g, ' ').slice(0, 70)}\n     原因：${String(e.message).slice(0, 300)}`);
    return [new Array(DIM).fill(0)];
  }
}

function quantize(vec, out, off) {            // 单位归一化 → ×127 → int8
  let n = 0; for (const x of vec) n += x * x; n = Math.sqrt(n) || 1;
  for (let k = 0; k < DIM; k++) { let q = Math.round((vec[k] / n) * 127); out[off + k] = q > 127 ? 127 : q < -127 ? -127 : q; }
}

/* ── main ── */
const t0 = Date.now();
console.log(`读取 ${INPUT} …`);
const isJson = /\.json$/i.test(INPUT);
const chunks = isDir ? chunkWikiDir(INPUT) : isJson ? chunkWorldBook(readText(INPUT)) : chunkNovel(readText(INPUT));
console.log(isDir ? '（轮回WIKI 目录模式：按「页面 + 小节」切块）'
  : isJson ? '（世界书 JSON 模式：每条目一块）' : '（小说 TXT 模式：按章滑窗切）');
/* ⚠ 全模式兜底：清掉任何残留的孤立代理（否则 embedding 接口会 400） */
let fixedSurrogate = 0;
for (const c of chunks) {
  const t = stripLone(c.t);
  if (t !== c.t) { c.t = t; fixedSurrogate++; }
}
if (fixedSurrogate) console.log(`（已修正 ${fixedSurrogate} 块被切断的 emoji 代理对）`);

const total = chunks.length;
console.log(`切出 ${total} 块（每块~${CHUNK}字）。模型 ${MODEL}，${DIM} 维，int8 量化。`);

/* 诊断：把每块的长度/来源/开头导出，用于排查建库失败（--dump-chunks[=文件]） */
if (args['dump-chunks']) {
  const f = typeof args['dump-chunks'] === 'string' ? args['dump-chunks'] : 'chunks-dump.json';
  fs.writeFileSync(f, JSON.stringify(chunks.map((c, i) => ({
    i, len: c.t.length, v: c.v, c: c.c, head: c.t.replace(/\n/g, ' ').slice(0, 60),
  })), null, 1));
  const lens = chunks.map((c) => c.t.length).sort((a, b) => b - a);
  console.log(`✓ 已导出 ${f}（${chunks.length} 块）`);
  console.log(`  最长 10 块：${lens.slice(0, 10).join(', ')}`);
  console.log(`  超 1200 字：${lens.filter((x) => x > 1200).length} 块;超 2000 字：${lens.filter((x) => x > 2000).length} 块`);
  process.exit(0);
}

if (DRY) {
  const chars = chunks.reduce((n, c) => n + c.t.length, 0);
  const byTop = new Map();
  for (const c of chunks) { const k = String(c.v).split('/')[0] || '(根)'; byTop.set(k, (byTop.get(k) || 0) + 1); }
  console.log(`\n正文合计 ${(chars / 10000).toFixed(1)} 万字，平均每块 ${Math.round(chars / total)} 字`);
  console.log('分区分布：');
  for (const [k, v] of [...byTop].sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padEnd(14)} ${v} 块`);
  console.log(`\n预估产物：vectors ${((total * DIM) / 1048576).toFixed(1)} MB（int8）`
    + `，需切 ${Math.ceil((total * DIM) / MAXPART)} 片;chunks.json.gz 约 ${(chars * 0.35 / 1048576).toFixed(1)} MB`);
  console.log(`预估请求：${Math.ceil(total / BATCH)} 批 × ${BATCH} 条`);
  console.log('\n样例（前 3 块）：');
  for (const c of chunks.slice(0, 3)) console.log(`  [${c.v}] ${c.c}\n    ${c.t.replace(/\n/g, ' ').slice(0, 90)}…`);
  console.log('\n（--dry-run：未调用 embedding、未写任何文件）');
  process.exit(0);
}

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
      const embs = await embedSafe(chunks.slice(s, e).map((c) => c.t), s);
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
const nparts = writeVectorsMaybeSplit(OUTDIR, Buffer.from(vectors.buffer));
fs.writeFileSync(path.join(OUTDIR, 'chunks.json.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(chunks), 'utf8')));
fs.writeFileSync(path.join(OUTDIR, 'manifest.json'), JSON.stringify({
  source: path.basename(INPUT), model: MODEL, dim: DIM, count: total, chunkSize: CHUNK, overlap: OVERLAP,
  normalized: true, quant: 'int8', parts: nparts, builtAt: new Date().toISOString(),
}, null, 2));
try { fs.unlinkSync(pPath); } catch { /* */ }

if (badChunks.length) {
  console.error(`\n⚠ 有 ${badChunks.length} 块最终无法嵌入，已写零向量（不可检索，但不影响其余）：`);
  for (const b of badChunks.slice(0, 20)) console.error(`   #${b.i}（${b.len}字）${b.head}`);
  fs.writeFileSync(path.join(OUTDIR, 'bad-chunks.json'), JSON.stringify(badChunks, null, 2));
  console.error(`   明细已写 ${OUTDIR}/bad-chunks.json`);
}

const mb = (p) => (fs.statSync(path.join(OUTDIR, p)).size / 1048576).toFixed(1);
console.log(`\n✓ 完成！${total} 块，用时 ${((Date.now() - t0) / 1000 / 60).toFixed(1)} 分钟`);
console.log(nparts ? `  ${OUTDIR}/vectors.bin.0..${nparts - 1}  （${nparts} 片，单文件 ≤24 MiB，过 Cloudflare 25 MiB 限制）` : `  ${OUTDIR}/vectors.bin       ${mb('vectors.bin')} MB`);
console.log(`  ${OUTDIR}/chunks.json.gz    ${mb('chunks.json.gz')} MB`);
console.log(`  ${OUTDIR}/manifest.json`);
console.log(`下一步：产物已在 public/，前端「向量资料库」开启后自动懒加载。`);
