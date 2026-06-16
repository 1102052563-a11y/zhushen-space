#!/usr/bin/env node
/**
 * NAI 批量生图：读 jobs.json → 逐个调 NovelAI → 解 ZIP → PNG 落地到 public/<folder>/
 *
 * 用法（在内层 zhushen-space/zhushen-space/ 下）：
 *   npm run nai                 跑 jobs.json 里所有任务（已存在的图自动跳过）
 *   npm run nai -- --force      重生（覆盖已存在的图）
 *   npm run nai -- --job=凯莉    只跑 folder/prefix 含「凯莉」的任务
 *   npm run nai -- --dry        只打印计划、不真的调接口
 *   npm run nai -- --list       列出任务清单
 *
 * Token：填进同目录 config.json 的 apiToken，或设环境变量 $env:NAI_TOKEN。
 * 接口与参数复用 App 的 systems/imageGen.ts（NAI v4 ZIP 流程），无需 CORS 代理（Node 直连）。
 */
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const hasFlag = (n) => args.includes(n);
const getOpt = (n) => { const p = args.find((a) => a.startsWith(n + '=')); return p ? p.slice(n.length + 1) : ''; };
const FORCE = hasFlag('--force');
const DRY = hasFlag('--dry');
const LIST = hasFlag('--list');
const ONLY = getOpt('--job'); // 只跑 folder/prefix 含此子串的任务

// ───────── 工具函数 ─────────
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const pick = (...vals) => { for (const v of vals) if (v !== undefined && v !== null && v !== '') return v; return undefined; };
// 从数组里不重复随机抽 n 条（与 GUI 一致）
const drawFrom = (arr, n) => { if (!Array.isArray(arr) || !arr.length || n <= 0) return []; if (n >= arr.length) return arr.slice(); const p = arr.slice(), out = []; for (let i = 0; i < n; i++) out.push(p.splice(Math.floor(Math.random() * p.length), 1)[0]); return out; };
const fileExists = async (p) => { try { await access(p, FS.F_OK); return true; } catch { return false; } };
const naiUrl = (raw) => { const t = (raw || '').trim().replace(/\/+$/, ''); return /\/ai\/generate-image$/i.test(t) ? t : `${t}/ai/generate-image`; };

// ───────── 读配置 ─────────
let config;
try { config = await readJson(join(HERE, 'config.json')); }
catch { console.error('✗ 缺少 config.json —— 请把 config.example.json 复制为 config.json，并在 apiToken 填入 NovelAI 持久化 Token'); process.exit(1); }
let jobsFile;
try { jobsFile = await readJson(join(HERE, 'jobs.json')); }
catch (e) { console.error('✗ 读取 jobs.json 失败：', e.message); process.exit(1); }

const token = (process.env.NAI_TOKEN || config.apiToken || '').replace(/\s+/g, '').replace(/^Bearer/i, '').trim();
if (!token && !DRY && !LIST) { console.error('✗ 未填 NAI Token：在 ' + join(HERE, 'config.json') + ' 的 apiToken 填入，或设 $env:NAI_TOKEN'); process.exit(1); }

const API_URL = naiUrl(config.apiUrl || 'https://image.novelai.net');
const ARTIST = config.artistTags ?? '';
const cfgDef = config.defaults || {};
const jobDef = jobsFile.defaults || {};
const OUT_BASE = resolve(HERE, jobsFile.outBase || '../../public');
const GAP_MS = Math.max(0, num(config.gapSec, 6)) * 1000; // 相邻请求间隔，避免 429
const TIMEOUT_MS = Math.max(30, num(config.timeoutSec, 120)) * 1000; // 单张请求超时，防止卡死整批（NAI 锁并发时可能挂起不返回）

// ───────── ZIP 解码（移植自 App 的 extractImageFromZip，改用 Node zlib）─────────
const isImgHead = (u) => (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) // PNG
  || (u[0] === 0xff && u[1] === 0xd8)                                                       // JPEG
  || (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46);                    // RIFF/WebP
const inflate = (bytes, method) => {
  if (method === 0) return bytes;                 // stored 未压缩
  if (method === 8) return zlib.inflateRawSync(bytes); // deflate-raw
  throw new Error('不支持的 ZIP 压缩方式 ' + method);
};
function extractImageFromZip(u8) {
  if (isImgHead(u8)) return u8;                         // 本就是原图
  if (!(u8[0] === 0x50 && u8[1] === 0x4b)) return u8;   // 不是 ZIP(PK) → 原样返回
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const td = new TextDecoder();
  const tryEntry = (name, start, compSize, method) => {
    const end = start + compSize;
    if (start < 0 || start >= u8.length || end > u8.length || compSize <= 0 || !/\.(png|jpe?g|webp)$/i.test(name)) return null;
    return inflate(u8.subarray(start, end), method);
  };
  // ① 中央目录（签名 0x02014b50）——尺寸最可靠，优先
  for (let i = 0; i + 46 < u8.length;) {
    if (dv.getUint32(i, true) !== 0x02014b50) { i += 1; continue; }
    const method = dv.getUint16(i + 10, true);
    const compSize = dv.getUint32(i + 20, true);
    const nameLen = dv.getUint16(i + 28, true);
    const extraLen = dv.getUint16(i + 30, true);
    const commentLen = dv.getUint16(i + 32, true);
    const localOff = dv.getUint32(i + 42, true);
    const name = td.decode(u8.subarray(i + 46, i + 46 + nameLen));
    if (localOff + 30 < u8.length && dv.getUint32(localOff, true) === 0x04034b50) {
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const r = tryEntry(name, localOff + 30 + lNameLen + lExtraLen, compSize, method);
      if (r) return r;
    }
    i += 46 + nameLen + extraLen + commentLen;
  }
  // ② 退化：扫本地文件头（签名 0x04034b50）
  for (let a = 0; a + 30 < u8.length;) {
    if (dv.getUint32(a, true) !== 0x04034b50) { a += 1; continue; }
    const method = dv.getUint16(a + 8, true);
    const compSize = dv.getUint32(a + 18, true);
    const nameLen = dv.getUint16(a + 26, true);
    const extraLen = dv.getUint16(a + 28, true);
    const dataStart = a + 30 + nameLen + extraLen;
    const name = td.decode(u8.subarray(a + 30, a + 30 + nameLen));
    const r = tryEntry(name, dataStart, compSize, method);
    if (r) return r;
    a = compSize > 0 ? dataStart + compSize : a + 1;
  }
  throw new Error('NAI 返回的图片包中未找到图片');
}

// ───────── 单张生成 ─────────
async function genOne(o) {
  const positive = [ARTIST, o.prompt].map((x) => (x || '').trim()).filter(Boolean).join(', ');
  const [w, h] = String(o.size || '1024x1024').split(/[x×*]/).map((n) => parseInt(n) || 1024);
  const isV4 = /^nai-diffusion-4(?:-|$)/i.test(o.model);
  const params = {
    params_version: 3, width: w, height: h, steps: o.steps, scale: o.scale, sampler: o.sampler,
    n_samples: 1, ucPreset: 0, qualityToggle: true, sm: false, sm_dyn: false,
    dynamic_thresholding: false, controlnet_strength: 1, legacy: false, add_original_image: false,
    legacy_v3_extend: false, noise_schedule: 'karras', cfg_rescale: o.cfgRescale, uncond_scale: o.uncondScale,
    prompt: positive,
  };
  if (isV4) {
    params.v4_prompt = { use_coords: false, use_order: false, caption: { base_caption: positive, char_captions: [] } };
    params.v4_negative_prompt = { use_coords: false, use_order: false, caption: { base_caption: o.negative || '', char_captions: [] } };
  }
  if (o.negative) params.negative_prompt = o.negative;
  if (Number.isFinite(o.seed)) params.seed = o.seed;
  if (o.sampler === 'k_euler_ancestral') { params.deliberate_euler_ancestral_bug = false; params.prefer_brownian = true; }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ input: positive, model: o.model, action: 'generate', parameters: params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`NAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return extractImageFromZip(Buffer.from(await res.arrayBuffer()));
}

// 把 job 的覆盖项与各级默认合并成最终参数
function resolveOpts(job) {
  return {
    prompt: job.prompt || '',
    negative: pick(job.negative, jobDef.negative, cfgDef.negative) ?? '',
    model: pick(job.model, jobDef.model, cfgDef.model, 'nai-diffusion-4-5-full'),
    size: pick(job.size, jobDef.size, cfgDef.size, '1024x1024'),
    steps: num(pick(job.steps, jobDef.steps, cfgDef.steps), 28),
    scale: num(pick(job.scale, jobDef.scale, cfgDef.scale), 5),
    cfgRescale: num(pick(job.cfgRescale, jobDef.cfgRescale, cfgDef.cfgRescale), 0),
    uncondScale: num(pick(job.uncondScale, jobDef.uncondScale, cfgDef.uncondScale), 1),
    sampler: pick(job.sampler, jobDef.sampler, cfgDef.sampler, 'k_dpmpp_2m_sde'),
  };
}

// ───────── 主循环 ─────────
const jobs = (jobsFile.jobs || []).filter((j) => !ONLY || (j.folder || '').includes(ONLY) || (j.prefix || '').includes(ONLY));
if (!jobs.length) { console.error(ONLY ? `没有匹配「${ONLY}」的任务` : 'jobs.json 里没有任务'); process.exit(1); }

const jobCount = (j) => (Array.isArray(j.poses) && j.poses.length ? j.poses.length : Math.max(1, num(j.count, 1)));
const MAX = num(getOpt('--max'), 0); // >0 时每个任务最多生成这么多张（冒烟测试用）
const COUNT_OVERRIDE = num(getOpt('--count'), 0); // >0 命令行覆盖张数（不必读/改 jobs.json）
const START_OVERRIDE = num(getOpt('--start'), 0); // >0 命令行覆盖起始序号
const FOLDER_OVERRIDE = getOpt('--folder'); // 命令行覆盖输出文件夹（不必读 jobs.json）
const PREFIX_OVERRIDE = getOpt('--prefix'); // 命令行覆盖文件名前缀

if (LIST) {
  console.log(`共 ${jobs.length} 个任务，输出根目录：${OUT_BASE}\n`);
  for (const j of jobs) { const o = resolveOpts(j); console.log(`• ${j.folder}/  ×${jobCount(j)}${Array.isArray(j.poses) && j.poses.length ? ' (各异姿势)' : ''}  [${o.size} ${o.model}]\n    ${o.prompt.slice(0, 100)}${o.prompt.length > 100 ? '…' : ''}`); }
  process.exit(0);
}

console.log(`NAI 批量生图 → ${OUT_BASE}\n接口：${API_URL}  间隔：${GAP_MS / 1000}s/张${FORCE ? '  [--force 覆盖]' : ''}${DRY ? '  [--dry 演练]' : ''}`);
let made = 0, skipped = 0, failed = 0, firstCall = true;
for (const job of jobs) {
  const folder = FOLDER_OVERRIDE || job.folder || 'misc';
  const prefix = PREFIX_OVERRIDE || job.prefix || folder.replace(/[\\/]/g, '_');
  const o = resolveOpts(job);
  if (!o.prompt) { console.warn(`\n⚠ 跳过「${folder}」：prompt 为空`); continue; }
  const poses = Array.isArray(job.poses) && job.poses.length ? job.poses : null; // 每张一个不同姿势，身份块共用
  let count = poses ? poses.length : Math.max(1, num(job.count, 1));
  if (COUNT_OVERRIDE > 0) count = COUNT_OVERRIDE;
  if (MAX > 0) count = Math.min(count, MAX);
  const start = START_OVERRIDE > 0 ? START_OVERRIDE : Math.max(1, num(job.start, 1)); // 文件起始序号，便于往已有集合里续号
  const base = job.outBase ? resolve(HERE, job.outBase) : OUT_BASE; // 可单任务指定输出根（如仓库根 图片/）
  const dir = join(base, folder);
  // 双随机正向池（与 GUI 一致）：每张从两池各随机抽 ≥drawCount 条接到正向后面
  const pool1 = Array.isArray(job.randomPool) ? job.randomPool.map((s) => String(s).trim()).filter(Boolean) : [];
  const pool2 = Array.isArray(job.randomPool2) ? job.randomPool2.map((s) => String(s).trim()).filter(Boolean) : [];
  const dN1 = Math.max(0, num(job.drawCount, 2)), dN2 = Math.max(0, num(job.drawCount2, 2));
  const hasPools = pool1.length || pool2.length;
  const mode = poses ? ' · 每张不同姿势' : (hasPools ? ` · 双池随机(各抽${dN1}/${dN2})` : '');
  console.log(`\n=== ${dir}  (${count} 张, ${o.size}, ${o.model})${mode} ===`);
  console.log(`    身份块: ${[ARTIST, o.prompt].filter(Boolean).join(', ').slice(0, 160)}…`);
  if (!DRY) await mkdir(dir, { recursive: true });
  for (let k = 0; k < count; k++) {
    const i = start + k; // 文件序号（支持续号，不覆盖已有图）
    const pose = poses ? (poses[k] || '') : '';
    const extra = hasPools ? [...drawFrom(pool1, dN1), ...drawFrom(pool2, dN2)] : []; // 两池各随机抽
    const tagLine = [pose, ...extra].filter(Boolean).join(', ');
    const prompt = [o.prompt, tagLine].filter(Boolean).join(', ');
    const file = join(dir, `${prefix}_${pad(i)}.png`);
    if (!FORCE && await fileExists(file)) { console.log(`  · 已存在，跳过 ${prefix}_${pad(i)}.png`); skipped++; continue; }
    const seed = Number.isFinite(job.seed) ? (job.seed + k) >>> 0 : Math.floor(Math.random() * 2 ** 32);
    if (DRY) { console.log(`  · [dry] ${prefix}_${pad(i)}.png  seed=${seed}${tagLine ? '  | ' + tagLine.slice(0, 70) : ''}`); continue; }
    if (!firstCall && GAP_MS) await sleep(GAP_MS); // 限速门
    firstCall = false;
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const png = await genOne({ ...o, prompt, seed });
        await writeFile(file, png);
        console.log(`  ✓ ${prefix}_${pad(i)}.png  (${(png.length / 1024) | 0} KB, seed=${seed})${tagLine ? '  | ' + tagLine.slice(0, 50) : ''}`);
        made++; ok = true;
      } catch (e) {
        const msg = e?.message || String(e);
        if (attempt < 3) { console.log(`  … 第 ${i} 张失败(${attempt}/3)：${msg} —— ${GAP_MS / 1000 || 5}s 后重试`); await sleep(GAP_MS || 5000); }
        else { console.error(`  ✗ ${prefix}_${pad(i)}.png 放弃：${msg}`); failed++; }
      }
    }
  }
}
console.log(`\n完成：新增 ${made}、跳过 ${skipped}、失败 ${failed}。输出根目录：${OUT_BASE}`);
