// 世界详情库（世界详情工坊产物）前端点取层。
// 数据源：public/worlddetail/manifest.json + s<i>.json 哈希分桶（vite 插件 buildWorldDetailShards 构建时从
//   仓库根 世界书/世界详情库·主库.json / ·休闲.json 切出；每世界 { p: ·剧情全文, c: ·切入点全文 }）。
// 消费方：
//   C1 世界卡生成（WorldSelector.generate）→ fetchWorldDetailsFor(点名世界名)：注 剧情+切入点 两段。
//   C2 入世后正文（App.callApi）→ ensureWorldDetailFor(当前世界) 回合前预取 + buildWorldDetailInjection() 同步注入：
//      只注 ·剧情——切入点是「怎么进入世界」的选择期资料，入世后没用且会诱导 AI 复述开场。
// 无产物 / 404 / 网络失败 → 一律静默降级为空（功能可整体缺席，不影响主流程）。
// 三层覆盖（getWorldDetail 读取顺序）：本地修订(worldEditStore·玩家在「世界资料库」面板的编辑，本机即时生效)
//   > 全局修订(服务端 /api/worlddetail/overrides·玩家提交+站长审核后对所有人生效) > 内置分片。
import { useMisc } from '../store/miscStore';
import { useWorldEdit } from '../store/worldEditStore';
import { isHomeWorld } from './playerVitals';
import { wdApiBase } from './worldDetailShare';
import { assembleInjection, BUDGET_SCALE } from './worldDetailInject';
import { useSettings } from '../store/settingsStore';

export type WorldDetail = { name: string; plot: string; cut?: string };
type ShardRec = { p: string; c?: string };
type Manifest = { version: number; shards: number; worlds: Record<string, { s: number; l: string }> };

let manifestP: Promise<Manifest | null> | null = null;
const shardP = new Map<number, Promise<Record<string, ShardRec> | null>>();
const detailCache = new Map<string, WorldDetail | null>();   // 键=库内正名；存 null=分片里确认没有（防重复拉）
const resolveCache = new Map<string, string | null>();       // 原始名（正文里可能漂移）→ 库内正名

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json() as T;
  } catch { return null; }
}
function loadManifest(): Promise<Manifest | null> {
  if (!manifestP) {
    manifestP = fetchJson<Manifest>('/worlddetail/manifest.json').then((m) => {
      const ok = m && m.worlds ? m : null;
      if (!ok) manifestP = null;   // 拉失败/无产物 → 不缓存失败，下次调用重试（无产物部署=每回合一次轻量 404，可忽略）
      return ok;
    });
  }
  return manifestP;
}
function loadShard(i: number): Promise<Record<string, ShardRec> | null> {
  let p = shardP.get(i);
  if (!p) { p = fetchJson<Record<string, ShardRec>>(`/worlddetail/s${i}.json`); shardP.set(i, p); }
  return p;
}

// 全局修订（站长已审）：会话内拉一次；失败 5 分钟后才重试（workers.dev 被墙时不能每回合白等一次）
let overridesP: Promise<Record<string, ShardRec> | null> | null = null;
let overridesFailedAt = 0;
function loadOverrides(): Promise<Record<string, ShardRec> | null> {
  if (!overridesP) {
    if (Date.now() - overridesFailedAt < 300_000) return Promise.resolve(null);
    overridesP = fetchJson<{ worlds?: Record<string, ShardRec> }>(`${wdApiBase()}/api/worlddetail/overrides`).then((r) => {
      const ok = r && r.worlds ? r.worlds : null;
      if (!ok) { overridesP = null; overridesFailedAt = Date.now(); }
      return ok;
    });
  }
  return overridesP;
}

// 归一（与 worldCodexStore 同款）：worldName 由杂项演化按正文改写，常见「格式/空格/世界名+地点」漂移
const norm = (s: string) => (s || '').replace(/[\s·•・\-—_,，。、|｜（）()【】]/g, '').toLowerCase();

/** 从候选名单里解析 raw 对应的库内正名：精确 > 归一相等 > 双向子串（归一后，取最长命中）。纯函数可单测。 */
export function resolveWorldNameFrom(names: string[], raw: string): string | null {
  const r = (raw || '').trim();
  if (!r) return null;
  if (names.includes(r)) return r;
  const n = norm(r);
  if (n.length < 2) return null;   // 太短不做模糊，防误并不同世界
  let best: string | null = null;
  for (const name of names) {
    const c = norm(name);
    if (c.length < 2) continue;
    if (c === n) return name;      // 归一相等即最优
    if (n.includes(c) || c.includes(n)) {
      if (!best || c.length > norm(best).length) best = name;   // 子串命中取最长（「火影忍者·木叶」→「火影忍者」）
    }
  }
  return best;
}

async function resolveName(raw: string): Promise<string | null> {
  const key = (raw || '').trim();
  if (!key) return null;
  const cached = resolveCache.get(key);
  if (cached !== undefined) return cached;
  const m = await loadManifest();
  const hit = m ? resolveWorldNameFrom(Object.keys(m.worlds), key) : null;
  if (m) resolveCache.set(key, hit);   // manifest 都没拉到（离线/无产物）→ 不缓存失败，下次再试
  return hit;
}

/** 按世界名取详情（三层覆盖：本地修订 > 全局修订 > 内置分片；进程内缓存合并结果）；查无此世界/无产物 → null。 */
export async function getWorldDetail(raw: string): Promise<WorldDetail | null> {
  const name = await resolveName(raw);
  if (!name) return null;
  const cached = detailCache.get(name);
  if (cached !== undefined) return cached;
  // ① 本地修订：玩家自己的编辑，本机最优先（面板保存后调 invalidateWorldDetail 使其立即生效）
  const local = useWorldEdit.getState().edits[name];
  if (local?.plot) { const d: WorldDetail = { name, plot: local.plot, cut: local.cut }; detailCache.set(name, d); return d; }
  // ② 全局修订：站长审核通过的社区修订
  const ov = (await loadOverrides())?.[name];
  if (ov?.p) { const d: WorldDetail = { name, plot: ov.p, cut: ov.c }; detailCache.set(name, d); return d; }
  // ③ 内置分片
  const base = await getBaseWorldDetail(name);
  if (base === undefined) return null;   // 分片网络失败：不定论，下次重试
  detailCache.set(name, base);           // 拿到分片才定论（null=确认库里没有）
  return base;
}

/** 内置原版（不吃本地/全局修订；供面板「查看原版/对比」）。undefined=分片网络失败（内部用），null=库里没有。 */
async function readBaseDetail(name: string): Promise<WorldDetail | null | undefined> {
  const m = await loadManifest();
  const meta = m?.worlds[name];
  if (!meta) return null;
  const shard = await loadShard(meta.s);
  if (!shard) { shardP.delete(meta.s); return undefined; }   // 网络失败：撤掉失败 promise 供下次重试
  const rec = shard[name];
  return rec?.p ? { name, plot: rec.p, cut: rec.c } : null;
}
export async function getBaseWorldDetail(raw: string): Promise<WorldDetail | null | undefined> {
  const name = await resolveName(raw);
  if (!name) return null;
  return readBaseDetail(name);
}

/** 当前「已发布」版（全局修订 || 内置原版，不含本地修订；站长审核对比用）。 */
export async function getPublishedDetail(raw: string): Promise<WorldDetail | null> {
  const name = await resolveName(raw);
  if (!name) return null;
  const ov = (await loadOverrides())?.[name];
  if (ov?.p) return { name, plot: ov.p, cut: ov.c };
  return (await readBaseDetail(name)) ?? null;
}

/** 面板列表用：全库索引（名 + 主库/休闲），按中文排序。 */
export async function loadWorldIndex(): Promise<{ name: string; lib: string }[]> {
  const m = await loadManifest();
  if (!m) return [];
  return Object.entries(m.worlds).map(([name, v]) => ({ name, lib: v.l })).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

/** 有全局修订的世界名集合（面板标徽章用）。 */
export async function getOverrideNames(): Promise<Set<string>> {
  const ov = await loadOverrides();
  return new Set(Object.keys(ov || {}));
}

/** 使缓存失效：传世界名（原始名或正名均可）只清那一个；不传清全部。面板保存/撤销本地修订后必调，注入立即换新。 */
export function invalidateWorldDetail(raw?: string): void {
  if (raw == null) { detailCache.clear(); return; }
  const key = raw.trim();
  detailCache.delete(resolveCache.get(key) || key);
}

/** 全局修订强制重拉（站长审核通过后调，本机立即看到新版）。 */
export function refreshOverrides(): void {
  overridesP = null;
  overridesFailedAt = 0;
  detailCache.clear();
}

/** C1 世界卡生成：并发取一批点名世界的详情（查无此世界的剔除，顺序保持）。 */
export async function fetchWorldDetailsFor(names: string[]): Promise<WorldDetail[]> {
  const all = await Promise.all(names.map((n) => getWorldDetail(n)));
  return all.filter((d): d is WorldDetail => !!d);
}

/** C2 预取：回合开始 await（首回合下载 manifest+分片 ~几百KB，之后内存缓存秒回）；超时不阻塞本回合（下回合再试）。 */
export async function ensureWorldDetailFor(raw: string, timeoutMs = 5000): Promise<void> {
  try {
    if (!raw || isHomeWorld(raw)) return;
    await Promise.race([
      getWorldDetail(raw).then(() => undefined),
      new Promise<void>((res) => setTimeout(res, timeoutMs)),
    ]);
  } catch { /* 静默 */ }
}

/** 同步读缓存（仅预取过才有）。 */
function getCachedDetail(raw: string): WorldDetail | null {
  const name = resolveCache.get((raw || '').trim());
  if (!name) return null;
  return detailCache.get(name) ?? null;
}

// 世界名→已见最高剧情阶段（会话内只进不退，防词法推断偶发回跳；reload 后由近期楼层重新推出，无需持久化）
const stageMemory = new Map<string, number>();

/** C2 正文注入块（分层引擎 worldDetailInject.ts）：①常驻核心＋③进度门控剧情线＋②按 ctxText 打分的相关节选；
 *  mode:'full'=规划层（细纲等）拿完整档案（含全部阶段+隐藏剧情）。切入点仍然不注。
 *  ctxText=最近楼层+本回合输入（相关性打分与阶段推断的证据源）；不传则退化为核心+第1阶段。
 *  与世界志(buildWorldviewInjection)并排放正文最深处；两者互补——世界志=AI 生成的本局动态世界观，详情=静态正典。 */
export function buildWorldDetailInjection(opts: { ctxText?: string; mode?: 'layered' | 'full' } = {}): { role: 'system'; content: string }[] {
  try {
    const worldName = useMisc.getState().worldName || '';
    if (!worldName || isHomeWorld(worldName)) return [];
    // 玩家设置（变量管理→世界详情注入）：off=不注入；full=正文也拿全量(旧行为)；outlineFull 关=细纲也退回分层
    const cfg = useSettings.getState().worldDetailInject || { mode: 'layered' as const, budget: 'standard' as const, outlineFull: true };
    if (cfg.mode === 'off') return [];
    const d = getCachedDetail(worldName);
    if (!d) return [];
    let mode: 'layered' | 'full' = opts.mode ?? 'layered';
    if (mode === 'full' && !cfg.outlineFull) mode = 'layered';
    if (mode === 'layered' && cfg.mode === 'full') mode = 'full';
    const r = assembleInjection(d.name, d.plot, opts.ctxText || '', {
      mode, minStage: stageMemory.get(d.name) || 0, scale: BUDGET_SCALE[cfg.budget] ?? 1,
    });
    if (r.stage > (stageMemory.get(d.name) || 0)) stageMemory.set(d.name, r.stage);
    return [{ role: 'system', content: r.content }];
  } catch { return []; }
}
