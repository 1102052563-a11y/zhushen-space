import { useImageGen, type ImgService, type NaiConfig, type OpenAIImgConfig, type ComfyConfig } from '../store/imageGenStore';
import { useImageBusy } from '../store/imageBusyStore';

/* ════════════════════════════════════════════
   生图统一入口：generateImage(service, {prompt,...}) → dataURL
   支持 NAI(zip解码) / OpenAI·Gemini·自定义(/images/generations) / ComfyUI(提交→轮询→取图)
   见 生图功能-集成指导.md
════════════════════════════════════════════ */

export interface GenOpts {
  prompt: string;
  negative?: string;
  size?: string;          // "1024x1024"，留空用服务默认
  signal?: AbortSignal;
  label?: string;         // toast 标题（如「生成主角立绘」）
}

/* ───────── 通用工具 ───────── */
function sniffMime(u8: Uint8Array): string {
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'image/png';
  if (u8[0] === 0xff && u8[1] === 0xd8) return 'image/jpeg';
  if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46) return 'image/webp';
  return 'image/png';
}
function u8ToDataUrl(u8: Uint8Array, mime?: string): string {
  const m = mime ?? sniffMime(u8);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) bin += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunk)) as any);
  return `data:${m};base64,${btoa(bin)}`;
}
function withTimeout(signal: AbortSignal | undefined, timeoutSec: number): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  const to = timeoutSec > 0 ? setTimeout(() => ctrl.abort(), timeoutSec * 1000) : null;
  return { signal: ctrl.signal, clear: () => { if (to) clearTimeout(to); if (signal) signal.removeEventListener('abort', onAbort); } };
}

/* 把 fetch 的原生 TypeError("Failed to fetch") 翻译成可定位的中文说明。
   fetch 抛 TypeError = 请求根本没送达（非 HTTP 错误码）：跨域(CORS) / 混合内容 / 地址不通 / 被拦截。*/
async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('图片请求超时/被取消');
    const msg = String(e?.message ?? e);
    if (e instanceof TypeError || /failed to fetch|load failed|networkerror|fetch/i.test(msg)) {
      let hint = `无法连接图片接口（请求未送达，非接口报错）：\n`;
      try {
        const u = new URL(url);
        if (location.protocol === 'https:' && u.protocol === 'http:') {
          hint += `• 混合内容：当前页面是 HTTPS，却调用 HTTP 接口（${u.origin}），被浏览器拦截。请改用 HTTPS 接口，或用 http:// 打开本应用。\n`;
        }
      } catch { /* ignore */ }
      hint += `• 跨域(CORS)：NAI / OpenAI / Gemini 官方端点不允许浏览器直连——这是最常见原因。NAI 请在「生图API配置 → NAI」填写「CORS 代理地址」（部署一个放行 CORS 的代理；见文档的 Cloudflare Worker 示例）；OpenAI/Gemini 可改用「自定义(OpenAI兼容)」填支持 CORS 的中转地址。\n`;
      hint += `• 地址写错或服务未启动（ComfyUI/本地服务请确认已运行、端口正确）。\n`;
      hint += `接口地址：${url}`;
      throw new Error(hint);
    }
    throw e instanceof Error ? e : new Error(msg);
  }
}

/* ───────── NAI 全局串行限速门 ───────── */
/* NAI 同时/过快请求会失败（429/超时）。所有 NAI 请求排队串行，且相邻请求至少间隔 queueGapSec 秒。*/
let naiChain: Promise<unknown> = Promise.resolve();
let lastNaiAt = 0;
function naiGate(gapSec: number): Promise<void> {
  const gapMs = Math.max(0, (gapSec || 0) * 1000);
  const run = naiChain.then(async () => {
    const wait = Math.max(0, lastNaiAt + gapMs - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNaiAt = Date.now();
  });
  naiChain = run.catch(() => {});
  return run;
}

/* ───────── NAI ───────── */
function naiUrl(raw: string): string {
  const t = (raw || '').trim().replace(/\/+$/, '');
  if (!t) return '';
  return /\/ai\/generate-image$/i.test(t) ? t : `${t}/ai/generate-image`;
}
/* CORS 代理：返回实际 fetch 的地址 + 需附加的请求头。
   - 含 {url}：前缀式代理，替换为 encodeURIComponent(真实地址)；
   - 否则：头式代理（兼容 fanren），请求发到代理地址、把真实地址放 X-Upstream 头。*/
function applyProxy(proxy: string, realUrl: string): { url: string; headers: Record<string, string> } {
  const p = (proxy || '').trim();
  if (!p) return { url: realUrl, headers: {} };
  if (p.includes('{url}')) return { url: p.replace('{url}', encodeURIComponent(realUrl)), headers: {} };
  return { url: p.replace(/\/+$/, ''), headers: { 'X-Upstream': realUrl } };
}
/* OpenAI/Gemini/自定义 图片接口的 CORS 代理：绕过浏览器跨域（中转站转发成功、浏览器却拦截无 CORS 头的响应 → Failed to fetch / 白扣次数）。
   - 含 {url}：前缀式，替换为 encodeURIComponent(真实地址)；
   - 否则：路径前缀式 代理/<去协议的真实地址>（兼容 Pages 同源 /proxy/<upstream>）。留空=直连。*/
function proxifyImg(proxy: string | undefined, realUrl: string): string {
  const p = (proxy || '').trim();
  if (!p) return realUrl;
  if (p.includes('{url}')) return p.replace('{url}', encodeURIComponent(realUrl));
  return p.replace(/\/+$/, '') + '/' + realUrl.replace(/^https?:\/\//i, '');
}
/* NAI 返回 ZIP。仿 fanren 的正规 ZIP 解析：先读「中央目录」(尺寸/压缩方式最可靠，即便本地头因数据描述符把大小写成0也不受影响)，
   再退化扫「本地文件头」；按文件名后缀挑图、按压缩方式还原(0=stored 直接用 / 8=deflate-raw 解压)。比启发式扫描稳得多。*/
async function inflateEntry(bytes: Uint8Array, method: number): Promise<Uint8Array> {
  if (method === 0) return bytes;                          // stored 未压缩
  if (method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('NAI 返回了浏览器暂不支持解析的压缩图片包');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function isImgHead(u8: Uint8Array): boolean {
  return (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47)        // PNG
    || (u8[0] === 0xff && u8[1] === 0xd8)                                              // JPEG
    || (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46);         // RIFF/WebP
}
async function extractImageFromZip(buf: ArrayBuffer): Promise<Uint8Array> {
  const u8 = new Uint8Array(buf);
  if (isImgHead(u8)) return u8;                                  // 本就是原图
  if (!(u8[0] === 0x50 && u8[1] === 0x4b)) return u8;            // 不是 ZIP(PK) → 原样返回让浏览器试
  const dv = new DataView(buf);
  const td = new TextDecoder();
  const tryEntry = async (name: string, start: number, compSize: number, method: number): Promise<Uint8Array | null> => {
    const end = start + compSize;
    if (start < 0 || start >= u8.length || end > u8.length || compSize <= 0 || !/\.(png|jpe?g|webp)$/i.test(name)) return null;
    return await inflateEntry(u8.slice(start, end), method);
  };
  // ① 中央目录（签名 0x02014b50）——尺寸最可靠，优先
  for (let i = 0; i + 46 < u8.length; ) {
    if (dv.getUint32(i, true) !== 0x02014b50) { i += 1; continue; }
    const method = dv.getUint16(i + 10, true);
    const compSize = dv.getUint32(i + 20, true);
    const nameLen = dv.getUint16(i + 28, true);
    const extraLen = dv.getUint16(i + 30, true);
    const commentLen = dv.getUint16(i + 32, true);
    const localOff = dv.getUint32(i + 42, true);
    const name = td.decode(u8.slice(i + 46, i + 46 + nameLen));
    if (localOff + 30 < u8.length && dv.getUint32(localOff, true) === 0x04034b50) {
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const r = await tryEntry(name, localOff + 30 + lNameLen + lExtraLen, compSize, method);
      if (r) return r;
    }
    i += 46 + nameLen + extraLen + commentLen;
  }
  // ② 退化：扫本地文件头（签名 0x04034b50）
  for (let a = 0; a + 30 < u8.length; ) {
    if (dv.getUint32(a, true) !== 0x04034b50) { a += 1; continue; }
    const method = dv.getUint16(a + 8, true);
    const compSize = dv.getUint32(a + 18, true);
    const nameLen = dv.getUint16(a + 26, true);
    const extraLen = dv.getUint16(a + 28, true);
    const dataStart = a + 30 + nameLen + extraLen;
    const name = td.decode(u8.slice(a + 30, a + 30 + nameLen));
    const r = await tryEntry(name, dataStart, compSize, method);
    if (r) return r;
    a = compSize > 0 ? dataStart + compSize : a + 1;
  }
  throw new Error('NAI 返回的图片包中未找到图片');
}
/* 清洗鉴权 token：去掉所有空白（结尾换行/空格是 401 与"Failed to fetch"的常见元凶）+ 多余的 Bearer 前缀 */
function cleanToken(raw: string): string {
  return (raw || '').replace(/\s+/g, '').replace(/^Bearer/i, '').trim();
}
async function genNai(cfg: NaiConfig, o: GenOpts): Promise<string> {
  const url = naiUrl(cfg.apiUrl);
  const token = cleanToken(cfg.apiToken);
  if (!url || !token) throw new Error('请先在「生图API配置」填写 NAI 地址与 Token');
  const positive = [cfg.artistTags, o.prompt].map((x) => (x || '').trim()).filter(Boolean).join(', ');
  // 负面不叠加：有传入用途负面(肖像/装备)就用它，否则回退 NAI 全局负面
  const negative = ((o.negative && o.negative.trim()) ? o.negative : (cfg.negativePrompt || '')).trim();
  console.log(`[NAI] 最终正向(含画师串):\n${positive}\n[NAI] 最终负向:\n${negative || '（空）'}`);
  const [w, h] = (o.size || `${cfg.width}x${cfg.height}`).split(/[x×*]/).map((n) => parseInt(n) || 1024);
  const isV4 = /^nai-diffusion-4(?:-|$)/i.test(cfg.model);
  const params: Record<string, unknown> = {
    params_version: 3, width: w, height: h, steps: cfg.steps || 28,
    scale: cfg.promptGuidance ?? 5, sampler: cfg.sampler || 'k_dpmpp_2m_sde',
    n_samples: 1, ucPreset: 0, qualityToggle: true, sm: false, sm_dyn: false,
    dynamic_thresholding: false, controlnet_strength: 1, legacy: false,
    add_original_image: false, legacy_v3_extend: false, noise_schedule: 'karras',
    cfg_rescale: cfg.promptGuidanceRescale ?? 0, uncond_scale: cfg.undesiredContentStrength ?? 1,
    prompt: positive,
  };
  if (isV4) {
    params.v4_prompt = { use_coords: false, use_order: false, caption: { base_caption: positive, char_captions: [] } };
    params.v4_negative_prompt = { use_coords: false, use_order: false, caption: { base_caption: negative, char_captions: [] } };
  }
  if (negative) params.negative_prompt = negative;
  if (cfg.seed.trim()) params.seed = parseInt(cfg.seed) || 0;
  if (cfg.sampler === 'k_euler_ancestral') { params.deliberate_euler_ancestral_bug = false; params.prefer_brownian = true; }

  // 限速门：开启队列时，相邻 NAI 请求至少间隔 queueGapSec 秒，避免一次性太多调用失败
  if (cfg.queueEnabled) await naiGate(cfg.queueGapSec);
  const { signal, clear } = withTimeout(o.signal, cfg.timeoutSec);
  try {
    const { url: fetchUrl, headers: proxyHeaders } = applyProxy(cfg.corsProxy, url);
    const res = await safeFetch(fetchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...proxyHeaders },
      body: JSON.stringify({ input: positive, model: cfg.model || 'nai-diffusion-4-5-full', action: 'generate', parameters: params }),
      signal,
    });
    if (!res.ok) throw new Error(`NAI 生图失败 (${res.status}): ${(await res.text()).slice(0, 160)}`);
    let buf: ArrayBuffer;
    try {
      buf = await res.arrayBuffer();
    } catch (e: any) {
      throw new Error(`已连到接口、HTTP 200，但读取图片数据失败（多半是代理把 NAI 的 Content-Encoding/Content-Length 等响应头原样转发、与实际 body 对不上）。请改用"更干净版 Worker"（读完整 body 再发、只保留 ACAO+Content-Type）。原始错误：${e?.message ?? e}`);
    }
    return u8ToDataUrl(await extractImageFromZip(buf));
  } finally { clear(); }
}

/* ───────── OpenAI / Gemini / 自定义（/images/generations）───────── */
async function genOpenAI(cfg: OpenAIImgConfig, o: GenOpts): Promise<string> {
  const key = cleanToken(cfg.apiKey);
  if (!cfg.baseUrl || !key) throw new Error('请先在「生图API配置」填写图片接口地址与 Key');
  const body: Record<string, unknown> = {
    model: cfg.model, prompt: o.prompt, size: o.size || cfg.size || '1024x1024',
    quality: cfg.quality || 'high', n: 1,
  };
  const { signal, clear } = withTimeout(o.signal, 600);
  try {
    const realUrl = cfg.baseUrl.replace(/\/$/, '') + '/images/generations';
    const res = await safeFetch(proxifyImg(cfg.corsProxy, realUrl), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body), signal,
    });
    if (!res.ok) throw new Error(`图片生成失败 (${res.status}): ${(await res.text()).slice(0, 160)}`);
    const data = await res.json();
    const item = data.data?.[0] ?? {};
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (item.url) {
      const r2 = await fetch(proxifyImg(cfg.corsProxy, item.url));
      return u8ToDataUrl(new Uint8Array(await r2.arrayBuffer()), r2.headers.get('content-type') || 'image/png');
    }
    throw new Error('图片接口未返回图像数据');
  } finally { clear(); }
}

/* ───────── ComfyUI（提交→轮询→取图）───────── */
function comfyBase(raw: string): string { return (raw || '').trim().replace(/\/+$/, ''); }
function injectWorkflow(cfg: ComfyConfig, o: GenOpts): any {
  const wf = JSON.parse(cfg.workflowJson);
  const setInput = (nodeId: string, input: string, val: unknown) => { if (nodeId && wf[nodeId]?.inputs) wf[nodeId].inputs[input] = val; };
  setInput(cfg.positiveNode, cfg.positiveInput || 'text', o.prompt);
  if (o.negative && cfg.negativeNode) setInput(cfg.negativeNode, cfg.negativeInput || 'text', o.negative);
  // seed：自动探测含 seed/noise_seed 的节点
  const seed = cfg.seed.trim() ? (parseInt(cfg.seed) || 0) : Math.floor(Math.random() * 2 ** 31);
  for (const id of Object.keys(wf)) {
    const inp = wf[id]?.inputs ?? {};
    for (const k of ['seed', 'noise_seed']) if (k in inp) inp[k] = seed;
  }
  return wf;
}
async function genComfy(cfg: ComfyConfig, o: GenOpts): Promise<string> {
  const base = comfyBase(cfg.apiUrl);
  if (!base) throw new Error('请先在「生图API配置」填写 ComfyUI 地址');
  if (!cfg.workflowJson.trim()) throw new Error('请先填写 ComfyUI 工作流 JSON');
  let wf: any;
  try { wf = injectWorkflow(cfg, o); } catch { throw new Error('ComfyUI 工作流 JSON 解析失败，请检查格式'); }
  const clientId = 'zhushen_' + Math.random().toString(36).slice(2);
  const sub = await safeFetch(`${base}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: clientId }), signal: o.signal ?? null });
  if (!sub.ok) throw new Error(`ComfyUI 提交失败 (${sub.status}): ${(await sub.text()).slice(0, 160)}`);
  const promptId = (await sub.json()).prompt_id;
  if (!promptId) throw new Error('ComfyUI 未返回 prompt_id');
  const interval = Math.min(10000, Math.max(250, cfg.pollIntervalMs || 1200));
  const deadline = cfg.timeoutSec > 0 ? Date.now() + cfg.timeoutSec * 1000 : Infinity;
  while (Date.now() < deadline) {
    if (o.signal?.aborted) throw new Error('已取消');
    await new Promise((r) => setTimeout(r, interval));
    const h = await fetch(`${base}/history/${encodeURIComponent(promptId)}`, { signal: o.signal ?? null });
    if (!h.ok) continue;
    const hist = await h.json();
    const entry = hist[promptId];
    const outputs = entry?.outputs ?? {};
    for (const node of Object.values(outputs) as any[]) {
      const img = node.images?.[0];
      if (img?.filename) {
        const v = new URL(`${base}/view`);
        v.searchParams.set('filename', img.filename);
        if (img.subfolder) v.searchParams.set('subfolder', img.subfolder);
        if (img.type) v.searchParams.set('type', img.type);
        const r = await fetch(v.toString(), { signal: o.signal ?? null });
        return u8ToDataUrl(new Uint8Array(await r.arrayBuffer()), r.headers.get('content-type') || 'image/png');
      }
    }
    const st = entry?.status;
    if (st?.completed && st.status_str && st.status_str !== 'success') throw new Error(`ComfyUI 任务失败: ${st.status_str}`);
  }
  throw new Error('ComfyUI 生成超时');
}

/* 把肖像 tags 里的性别标签强制成与设定一致：男→1boy / 女→1girl，并移除相反性别的计数标签。
   解决"男主角因马尾/精致五官等被标签 LLM 误判成 1girl"——人物设定的性别优先于 AI 的视觉猜测。
   仅对明确的男/女生效；"其他/非人形/未设"一律不动（交给 1other 或 LLM 判断）。*/
export function forceGenderTag(tags: string, gender?: string): string {
  const t0 = (tags || '').trim();
  if (!t0) return t0;
  const g = (gender || '').trim();
  const male = /男/.test(g) && !/女/.test(g);
  const female = /女/.test(g) && !/男/.test(g);
  if (!male && !female) return t0;
  const want = male ? '1boy' : '1girl';
  const dropRe = male ? /\b(?:\d+\s*girls?|multiple girls)\b/gi : /\b(?:\d+\s*boys?|multiple boys)\b/gi;
  const t = t0.replace(dropRe, '').replace(/\s*,(?:\s*,)+/g, ', ').replace(/^\s*,\s*|\s*,\s*$/g, '').trim();
  if (new RegExp(`\\b${want}\\b`, 'i').test(t)) return t;   // 已含正确性别标签
  return t ? `${want}, ${t}` : want;
}

/* 读取「当前已装备」的物品(服装/护甲/主武器)拼成生图可读字符串。
   解决"外观描述每回合漏掉服装"：生图直接读装备栏真实穿戴，不再指望 AI 把衣着写进外观。
   传入主角背包(useItems.items)或 NPC.items 即可；只取 equipped=true 的。 */
export function equippedForPrompt(
  items?: Array<{ name?: string; appearance?: string; category?: string; subType?: string; equipped?: boolean; equipSlot?: string }>,
): string {
  if (!Array.isArray(items)) return '';
  const eq = items.filter((it) => it && it.equipped && it.name);
  if (!eq.length) return '';
  const isWeapon = (it: { category?: string; subType?: string; equipSlot?: string }) =>
    /武器|weapon|剑|刀|枪|炮|弓|弩|杖|锤|斧|matchlock|gun|sword|blade|spear|bow|staff/i.test(
      `${it.category || ''}${it.subType || ''}${it.equipSlot || ''}`,
    );
  const fmt = (it: { name?: string; appearance?: string }) => {
    const ap = String(it.appearance || '').trim().replace(/\s+/g, ' ').slice(0, 36);
    return `${it.name}${ap ? `（${ap}）` : ''}`;
  };
  const weapons = eq.filter(isWeapon).map(fmt);
  const wears = eq.filter((it) => !isWeapon(it)).map(fmt);
  const segs: string[] = [];
  if (wears.length) segs.push(`身着：${wears.join('、')}`);
  if (weapons.length) segs.push(`手持：${weapons.join('、')}`);
  return segs.join('；');
}

/* 形态自动识别：召唤物/野兽/非人形 NPC 常被 AI 建档时漏标 bodyType → 默认人形 → 强套 1girl 长出四肢。
   bodyType 留空(自动)时，按角色外观/容貌/标签里的强信号兜底判断，免得用户给每个 AI 召唤物手动切。
   有明确拟人标记(少女/兽耳/1girl 等)则不擅自改，交回人形/手动。 */
export function inferBodyType(text?: string): '' | '兽形' | '非人形' {
  const t = (text || '').toLowerCase();
  if (!t) return '';
  // ① 明确"无人形/非人形"字样 → 直接非人形（最确定信号，AI 给召唤物写容貌常有"无人形…"）
  if (/无人形|非人形|无人型|无人类|无四肢|无固定形态|不定形|无实体|formless|no humans|non-?human/i.test(t)) return '非人形';
  // ② 有拟人标记（少女/兽耳娘/1girl 之类）→ 不自动改，留给"人形/手动"
  if (/兽人|兽耳|猫娘|狐娘|龙娘|蛇娘|拟人|半兽|人形|少女|少年|女性|男性|美少女|humanoid|kemonomimi|anthro|1girl|1boy|\bgirl\b|\bboy\b|\bwoman\b|\bman\b/i.test(t)) return '';
  // ③ 无拟人标记 + 软体/触手/集群/元素 等强信号 → 非人形
  if (/触手|史莱姆|粘液|黏液|软体|集群|虫群|蜂群|菌|孢子|结晶体|元素体|气态|液态|球状|雾状|slime|tentacl|amorphous|swarm|ooze|eldritch|aberration|gelatinous/i.test(t)) return '非人形';
  // ④ 无拟人标记 + 纯野兽/四足/龙蛇 → 兽形
  if (/野兽|巨兽|魔兽|妖兽|走兽|凶兽|四足|四肢着地|龙形|蛇形|纯血龙|兽形|feral|quadruped|\bbeast\b|\bdragon\b|\bwolf\b|\bserpent\b/i.test(t)) return '兽形';
  return '';
}

/* 由角色档案字段拼肖像提示词（MVP：自然语言+少量 tags，NAI/OpenAI 都可用；
   未来可换成重点演化生成的英文 NAI tags(col19/imageTags) 以求同角色一致）。*/
export function buildPortraitPrompt(f: {
  gender?: string; race?: string; age?: string; appearance?: string; profession?: string; tier?: string; npcTag?: string; imageTags?: string;
  action?: string; attire?: string; location?: string; figure?: string; appearanceDetails?: string;
  baseAppearance?: string;   // 基底外观（开局设定，不可变）——始终并入提示词
  bodyType?: string;         // 形态：人形(默认)/兽形/非人形——非人形(召唤物/野兽/怪物)绕开 1girl/半身肖像 人形框架
  equipment?: string;        // 当前装备栏实际穿戴(服装/护甲/主武器)——直接读装备栏，免得 AI 每回合把服装写漏
}): string {
  const s = useImageGen.getState();
  const base = (f.baseAppearance ?? '').trim();   // 基底外观：所有路径都要带上
  const equip = (f.equipment ?? '').trim();       // 已装备的衣着/武器：机械读取，比"外观描述里的服装"可靠
  // 形态：显式设定优先；留空(自动)则按外观/容貌/标签兜底识别（修"AI 召唤物没标形态→默认人形→强套1girl长四肢"）
  const bt = (f.bodyType || '').trim() || inferBodyType([f.race, f.baseAppearance, f.appearance, f.appearanceDetails, f.npcTag].map((x) => x || '').join(' '));
  const humanoid = !bt || bt === '人形';
  const imageTags = humanoid ? forceGenderTag((f.imageTags ?? '').trim(), f.gender) : (f.imageTags ?? '').trim();   // 非人形不强制 1girl/1boy 性别 tag
  const tagSvc = s.portraitService === 'nai' || s.portraitService === 'comfy';

  // —— 非人形（召唤物/野兽/怪物）：走专用「生物」框架，绕开人形肖像（无 1girl、无半身肖像、无人脸五官）——
  if (!humanoid) {
    const creatureDesc = [base, f.race, f.appearance, f.appearanceDetails].map((x) => (x || '').trim()).filter(Boolean).join('，');
    if (!tagSvc) {
      // 自然语言模型(gpt-image-2/Gemini/自定义)：明确"只有一只非人生物、无人类无人脸"
      return `请生成一张【${bt === '兽形' ? '兽形·野兽/动物' : '非人形·怪物/生物'}】的全身概念图。画面**只有这一只生物本体**，**绝对没有任何人类、没有人形身体、没有人类面孔与五官**（这不是人、也不是拟人化角色，是一只纯粹的${bt === '兽形' ? '野兽/动物' : '非人生物/怪物'}）。生物外观（严格据此，绝不要套成人形）：${creatureDesc || '（按设定）'}。构图：完整展示生物全貌(full body)，背景简洁只作氛围。${s.styleGuide || ''}`.trim();
    }
    // 标签模型(NAI/ComfyUI)：生物 tag，不加 1girl/1boy；用 no humans / monster / full body 框定
    const subj = bt === '兽形' ? 'no humans, solo, full body, animal, creature, feral' : 'no humans, solo, full body, monster, creature, eldritch';
    const parts = [subj, imageTags, base, f.race, f.appearance, f.appearanceDetails].map((x) => (x || '').trim()).filter(Boolean);
    if (s.portraitPositive.trim()) parts.push(s.portraitPositive.trim());
    return parts.join(', ');
  }
  // —— 自然语言模型(OpenAI/Gemini/自定义)：填充画风模板（仿 fanren 结构化组装）——
  if (!tagSvc) {
    const t = s.portraitTemplate || '';
    if (t.trim()) {
      return t
        .replaceAll('${gender}', f.gender || '（性别未知）')
        .replaceAll('${age}', f.age || '')
        .replaceAll('${tier}', f.tier || '')
        .replaceAll('${appearance}', [f.race, base, f.appearance, f.profession].filter(Boolean).join('，') || '（按设定）')
        .replaceAll('${appearance_details}', [f.race, base, f.appearanceDetails || f.appearance].filter(Boolean).join('，') || '（按设定）')
        .replaceAll('${attire}', equip || f.attire || '（按设定）')   // 优先用装备栏真实穿戴
        .replaceAll('${equipment}', equip || '（无特别装备）')
        .replaceAll('${装备}', equip || '（无特别装备）')
        .replaceAll('${figure}', f.figure || '（按设定）')
        .replaceAll('${action}', f.action || '自然端庄的姿态')
        .replaceAll('${location}', f.location || '简洁背景')
        .replaceAll('${portrait_prompt}', imageTags || '（无）')
        .replaceAll('${style_guide}', s.styleGuide || '');
    }
  }
  // —— 标签型(NAI/ComfyUI)：优先用演化生成的英文 NAI tags（同角色一致；性别标签已按设定强制）——
  if (imageTags) {
    const parts = [imageTags];
    if (base) parts.push(base);                       // 基底外观始终并入
    if (equip) parts.push(equip);                     // 装备栏实际穿戴并入（服装/武器不再漏）
    if (s.portraitPositive.trim()) parts.push(s.portraitPositive.trim());
    return parts.join(', ');
  }
  const male = /男/.test(f.gender || '') && !/女/.test(f.gender || '');
  const female = /女/.test(f.gender || '') && !/男/.test(f.gender || '');
  const g = female ? '1girl, solo' : male ? '1boy, solo' : 'solo';
  const parts = [g, 'upper body portrait, character art', base, equip, f.race, f.appearance, f.age, f.profession, f.tier, f.npcTag]
    .map((x) => (x || '').trim()).filter(Boolean);
  if (s.portraitPositive.trim()) parts.push(s.portraitPositive.trim());
  return parts.join(', ');
}

/* 由物品档案 + 装备模板拼装备生图提示词 */
export function buildEquipPrompt(item: { name?: string; category?: string; gradeDesc?: string; appearance?: string; effect?: string; ownerGender?: string }): string {
  const s = useImageGen.getState();
  // 仿 fanren：用可编辑的装备设定图模板 + 物品字段拼提示词（不走演化生成的专用 tags）
  return s.equipTemplate
    .replaceAll('${item_name}', item.name ?? '')
    .replaceAll('${item_category}', item.category ?? '')
    .replaceAll('${item_grade}', item.gradeDesc ?? '')
    .replaceAll('${item_appearance}', item.appearance ?? '')
    .replaceAll('${item_effect}', item.effect ?? '')
    .replaceAll('${owner_gender}', item.ownerGender ?? '')
    .replaceAll('${wearer_gender}', item.ownerGender ?? '')
    .replaceAll('${equipment_user_gender}', item.ownerGender ?? '')
    .replaceAll('${portrait_style}', '');
}

/* 缩小图片 dataURL：头像/装备图存 localStorage，原图太大(1~3MB)会爆配额。
   **一律 canvas 重编码为小 JPEG**（顺带清掉 ZIP 解出的 PNG 可能带的尾部杂字节 → 修"格式不对"）。
   解码失败 = 图损坏 → **抛错**（绝不把这坨大数据塞进 localStorage，否则白占空间 + 爆配额）。*/
export async function shrinkDataUrl(dataUrl: string, maxDim = 1024, quality = 0.9): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
  let img: HTMLImageElement;
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('decode'));
      im.src = dataUrl;
    });
  } catch {
    throw new Error('生成的图片无法解码（接口返回格式异常/图片损坏），已放弃保存');
  }
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  if (!W || !H) throw new Error('生成的图片尺寸异常，已放弃保存');
  const scale = Math.min(1, maxDim / Math.max(W, H));
  const w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, w, h);   // JPEG 无透明通道，垫个底
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);   // 一律转小 JPEG，保证体积可控
}

/* ───────── 统一入口 ───────── */
// 「停止生成全部变量」：模块级图片中止器。abortAllImageGen() 一调，正在进行的生图立即 abort，随后重置。
let _stopImg = new AbortController();
export function abortAllImageGen(): void { try { _stopImg.abort(); } catch { /* */ } _stopImg = new AbortController(); }
function mergeStopSignal(sig?: AbortSignal): AbortSignal {
  const stop = _stopImg.signal;
  if (!sig) return stop;
  const ctrl = new AbortController();
  for (const s of [sig, stop]) { if (s.aborted) { ctrl.abort(); return ctrl.signal; } s.addEventListener('abort', () => ctrl.abort(), { once: true }); }
  return ctrl.signal;
}

export async function generateImage(service: ImgService, o: GenOpts): Promise<string> {
  o = { ...o, signal: mergeStopSignal(o.signal) };   // 并入全局「停止生成」信号
  const s = useImageGen.getState();
  // 全局「生成中」提示 + 控制台日志（便于确认实际使用的提示词/画风）
  useImageBusy.getState().start(o.label || '生成图片中…', (o.prompt || '').slice(0, 180));
  console.log(`[ImageGen] ${service} ${o.label || ''}\n提示词: ${o.prompt}`);
  try {
    switch (service) {
      case 'nai': return await genNai(s.nai, o);
      case 'openai': return await genOpenAI(s.openai, o);
      case 'gemini': return await genOpenAI(s.gemini, o);
      case 'custom': return await genOpenAI(s.custom, o);
      case 'comfy': return await genComfy(s.comfy, o);
      default: throw new Error('未知生图服务');
    }
  } finally {
    useImageBusy.getState().done();
  }
}
