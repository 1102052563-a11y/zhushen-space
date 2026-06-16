#!/usr/bin/env node
/**
 * NAI 生图工作台：本地小服务 + 网页 GUI。
 *   npm run nai-ui   → 打开 http://localhost:5188
 * 浏览器里看/改正向·负向提示词、按行批量出图，图自动落地到指定文件夹。
 * 复用 nai-batch 同一套 NAI v4 调用 + ZIP 解码（这里自带一份，独立于 CLI，互不影响）。
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.NAI_UI_PORT) || 5188;
const OUT_DEFAULT = resolve(HERE, '../../public');

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanToken = (raw) => (raw || '').replace(/\s+/g, '').replace(/^Bearer/i, '').trim();
const naiUrl = (raw) => { const t = (raw || 'https://image.novelai.net').trim().replace(/\/+$/, ''); return /\/ai\/generate-image$/i.test(t) ? t : `${t}/ai/generate-image`; };

let config = {};
try { config = await readJson(join(HERE, 'config.json')); } catch { console.warn('⚠ 未找到 config.json'); }
const TOKEN = cleanToken(process.env.NAI_TOKEN || config.apiToken);
const API_URL = naiUrl(config.apiUrl);
const TIMEOUT_MS = Math.max(30, Number(config.timeoutSec) || 120) * 1000;

/* ── ZIP 解码（与 nai-batch 一致）── */
const isImgHead = (u) => (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) || (u[0] === 0xff && u[1] === 0xd8) || (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46);
const inflate = (b, m) => { if (m === 0) return b; if (m === 8) return zlib.inflateRawSync(b); throw new Error('不支持的 ZIP 压缩方式 ' + m); };
function extractImageFromZip(u8) {
  if (isImgHead(u8)) return u8;
  if (!(u8[0] === 0x50 && u8[1] === 0x4b)) return u8;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), td = new TextDecoder();
  const tryEntry = (name, start, comp, method) => { const end = start + comp; if (start < 0 || start >= u8.length || end > u8.length || comp <= 0 || !/\.(png|jpe?g|webp)$/i.test(name)) return null; return inflate(u8.subarray(start, end), method); };
  for (let i = 0; i + 46 < u8.length;) {
    if (dv.getUint32(i, true) !== 0x02014b50) { i += 1; continue; }
    const method = dv.getUint16(i + 10, true), comp = dv.getUint32(i + 20, true), nameLen = dv.getUint16(i + 28, true), extraLen = dv.getUint16(i + 30, true), commentLen = dv.getUint16(i + 32, true), localOff = dv.getUint32(i + 42, true);
    const name = td.decode(u8.subarray(i + 46, i + 46 + nameLen));
    if (localOff + 30 < u8.length && dv.getUint32(localOff, true) === 0x04034b50) {
      const lNameLen = dv.getUint16(localOff + 26, true), lExtraLen = dv.getUint16(localOff + 28, true);
      const r = tryEntry(name, localOff + 30 + lNameLen + lExtraLen, comp, method); if (r) return r;
    }
    i += 46 + nameLen + extraLen + commentLen;
  }
  for (let a = 0; a + 30 < u8.length;) {
    if (dv.getUint32(a, true) !== 0x04034b50) { a += 1; continue; }
    const method = dv.getUint16(a + 8, true), comp = dv.getUint32(a + 18, true), nameLen = dv.getUint16(a + 26, true), extraLen = dv.getUint16(a + 28, true);
    const dataStart = a + 30 + nameLen + extraLen, name = td.decode(u8.subarray(a + 30, a + 30 + nameLen));
    const r = tryEntry(name, dataStart, comp, method); if (r) return r;
    a = comp > 0 ? dataStart + comp : a + 1;
  }
  throw new Error('NAI 返回的图片包中未找到图片');
}

/* ── 单张生成（含 429/异常重试）── */
async function genImageOnce(o) {
  const positive = [o.artistTags, o.prompt].map((x) => (x || '').trim()).filter(Boolean).join(', ');
  const [w, h] = String(o.size || '1216x832').split(/[x×*]/).map((n) => parseInt(n) || 1024);
  const isV4 = /^nai-diffusion-4(?:-|$)/i.test(o.model);
  const params = {
    params_version: 3, width: w, height: h, steps: +o.steps || 28, scale: +o.scale || 5, sampler: o.sampler || 'k_dpmpp_2m_sde',
    n_samples: 1, ucPreset: 0, qualityToggle: true, sm: false, sm_dyn: false, dynamic_thresholding: false, controlnet_strength: 1,
    legacy: false, add_original_image: false, legacy_v3_extend: false, noise_schedule: 'karras', cfg_rescale: +o.cfgRescale || 0, uncond_scale: +o.uncondScale || 1, prompt: positive,
  };
  if (isV4) {
    params.v4_prompt = { use_coords: false, use_order: false, caption: { base_caption: positive, char_captions: [] } };
    params.v4_negative_prompt = { use_coords: false, use_order: false, caption: { base_caption: o.negative || '', char_captions: [] } };
  }
  if (o.negative) params.negative_prompt = o.negative;
  if (Number.isFinite(+o.seed) && o.seed !== '' && o.seed != null) params.seed = (+o.seed) >>> 0;
  if (o.sampler === 'k_euler_ancestral') { params.deliberate_euler_ancestral_bug = false; params.prefer_brownian = true; }
  const res = await fetch(API_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ input: positive, model: o.model || 'nai-diffusion-4-5-full', action: 'generate', parameters: params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`NAI ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return extractImageFromZip(Buffer.from(await res.arrayBuffer()));
}
async function genImage(o, tries = 3) {
  let err; for (let a = 1; a <= tries; a++) { try { return await genImageOnce(o); } catch (e) { err = e; if (a < tries) await sleep(4000); } } throw err;
}

const send = (res, code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b)); });

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === 'GET' && u.pathname === '/') {
      const html = await readFile(join(HERE, 'ui.html'), 'utf8');
      return send(res, 200, 'text/html; charset=utf-8', html);
    }
    if (req.method === 'GET' && u.pathname === '/api/config') {
      let lastJob = null;
      try { const jf = await readJson(join(HERE, 'jobs.json')); lastJob = (jf.jobs || [])[0] || null; } catch {}
      return send(res, 200, 'application/json', JSON.stringify({ hasToken: !!TOKEN, apiUrl: API_URL, artistTags: config.artistTags || '', defaults: config.defaults || {}, gapSec: config.gapSec ?? 3, lastJob }));
    }
    if (req.method === 'GET' && u.pathname === '/api/image') {
      const base = u.searchParams.get('base') || '', folder = u.searchParams.get('folder') || '', name = u.searchParams.get('name') || '';
      const file = resolve(base ? resolve(HERE, base) : OUT_DEFAULT, folder, name);
      try { const buf = await readFile(file); return send(res, 200, 'image/png', buf); }
      catch { return send(res, 404, 'text/plain', 'not found'); }
    }
    if (req.method === 'POST' && u.pathname === '/api/generate-one') {
      const o = JSON.parse(await readBody(req));
      if (!TOKEN) return send(res, 200, 'application/json', JSON.stringify({ ok: false, error: 'config.json 未填 apiToken' }));
      try {
        const png = await genImage(o);
        const name = `${o.prefix || 'img'}_${String(o.index || 1).padStart(2, '0')}.png`;
        const dir = resolve(o.outBase ? resolve(HERE, o.outBase) : OUT_DEFAULT, o.folder || 'misc');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, name), png);
        return send(res, 200, 'application/json', JSON.stringify({ ok: true, name, kb: Math.round(png.length / 1024) }));
      } catch (e) { return send(res, 200, 'application/json', JSON.stringify({ ok: false, error: e?.message || String(e) })); }
    }
    send(res, 404, 'text/plain', 'not found');
  } catch (e) { send(res, 500, 'text/plain', e?.message || 'error'); }
});
server.listen(PORT, () => console.log(`NAI 生图工作台 → http://localhost:${PORT}   (token: ${TOKEN ? '已配置' : '未配置'})`));
