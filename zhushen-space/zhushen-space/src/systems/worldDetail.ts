// 世界详情库（世界详情工坊产物）前端点取层。
// 数据源：public/worlddetail/manifest.json + s<i>.json 哈希分桶（vite 插件 buildWorldDetailShards 构建时从
//   仓库根 世界书/世界详情库·主库.json / ·休闲.json 切出；每世界 { p: ·剧情全文, c: ·切入点全文 }）。
// 消费方：
//   C1 世界卡生成（WorldSelector.generate）→ fetchWorldDetailsFor(点名世界名)：注 剧情+切入点 两段。
//   C2 入世后正文（App.callApi）→ ensureWorldDetailFor(当前世界) 回合前预取 + buildWorldDetailInjection() 同步注入：
//      只注 ·剧情——切入点是「怎么进入世界」的选择期资料，入世后没用且会诱导 AI 复述开场。
// 无产物 / 404 / 网络失败 → 一律静默降级为空（功能可整体缺席，不影响主流程）。
import { useMisc } from '../store/miscStore';
import { isHomeWorld } from './playerVitals';

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

/** 按世界名取详情（含分片下载·进程内缓存）；查无此世界/无产物 → null。 */
export async function getWorldDetail(raw: string): Promise<WorldDetail | null> {
  const name = await resolveName(raw);
  if (!name) return null;
  const cached = detailCache.get(name);
  if (cached !== undefined) return cached;
  const m = await loadManifest();
  const meta = m?.worlds[name];
  if (!meta) return null;
  const shard = await loadShard(meta.s);
  if (!shard) { shardP.delete(meta.s); return null; }   // 分片网络失败：不定论、撤掉失败 promise 供下次重试
  const rec = shard[name];
  const detail: WorldDetail | null = rec?.p ? { name, plot: rec.p, cut: rec.c } : null;
  detailCache.set(name, detail);   // 拿到分片才定论（null=确认库里没有）
  return detail;
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

/** C2 正文注入块：当前在任务世界且详情库有此世界 → 注 ·剧情 全文（不注切入点）；否则空。
 *  与世界志(buildWorldviewInjection)并排放正文最深处；两者互补——世界志=AI 生成的本局世界观，详情=库预写常青档案。 */
export function buildWorldDetailInjection(): { role: 'system'; content: string }[] {
  try {
    const worldName = useMisc.getState().worldName || '';
    if (!worldName || isHomeWorld(worldName)) return [];
    const d = getCachedDetail(worldName);
    if (!d) return [];
    return [{
      role: 'system',
      content: `<本世界·世界详情（预写既定档案·主角当前所在世界「${d.name}」·据此演绎）>\n` +
        '以下是本世界的常青档案（剧情线/人物/力量体系/势力/贵重物品/隐藏剧情）。演绎本世界时以此为最高事实参考：' +
        '人物性格·立场·装备、势力关系、阶位映射、剧情走向都据此保持一致；它是骨架非剧本——主角的介入可以改变走向，' +
        '但改变前的世界既定状态必须符合此档案，不得与之矛盾。\n' + d.plot,
    }];
  } catch { return []; }
}
