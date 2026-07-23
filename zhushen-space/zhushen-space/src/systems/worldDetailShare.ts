/* 世界资料库·提交/审核 API（纯逻辑，无 React）。
 * 后端 = zhushen-multiplayer Worker 的 /api/worlddetail/*（Cloudflare D1，与创意工坊同 worker 同库）：
 *   - 玩家：wdSubmit 把本地修订提交审核；wdListMine 查自己的提交状态。
 *   - 站长：wdListPending 列待审（复用创意工坊管理员密钥 X-Admin-Key = env.WS_ADMIN_KEY，
 *           在 创意工坊→设置 里验证过的 adminKey 直接生效）；wdReview 通过/拒绝。
 *   - 所有玩家：已通过的修订由 systems/worldDetail.ts 的 loadOverrides 拉取并覆盖内置分片。
 * base URL 与工坊同源：workshopStore.apiBase 覆盖 || mpBase()。 */
import { useWorkshop } from '../store/workshopStore';
import { mpBase, myPlayerId, myMpName } from './mpConfig';

export interface WdSubmission {
  id: string;
  name: string;            // 世界名（库内正名）
  plot: string;            // 提交的 ·剧情 全文（「我的提交」列表不含全文，此字段为空串）
  cut?: string;            // 提交的 ·切入点 全文
  plotLen?: number;        // 全文字数（列表视图用，服务端 length() 算好）
  cutLen?: number;
  note?: string;           // 附言（改了什么/为什么）
  author?: string;
  owner?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  reviewedAt?: number;
}

export function wdApiBase(): string {
  return (useWorkshop.getState().apiBase || mpBase()).replace(/\/+$/, '');
}
async function errMsg(res: Response): Promise<string> {
  try { const d = await res.json(); return d.error || `HTTP ${res.status}`; } catch { return `HTTP ${res.status}`; }
}
function adminHeader(): Record<string, string> {
  const k = useWorkshop.getState().adminKey;
  return k ? { 'X-Admin-Key': k } : {};
}

/** 提交一份世界修订（署名 = 工坊昵称 || 联机名 || 匿名；owner = 本机联机 pid，用于「我的提交」过滤）。返回提交 id。 */
export async function wdSubmit(s: { name: string; plot: string; cut?: string; note?: string }): Promise<string> {
  const author = (useWorkshop.getState().nickname || myMpName() || '').trim() || '匿名';
  const res = await fetch(`${wdApiBase()}/api/worlddetail/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: s.name, plot: s.plot, cut: s.cut || undefined, note: (s.note || '').trim() || undefined, author, owner: myPlayerId() }),
  });
  if (!res.ok) throw new Error(await errMsg(res));
  return (await res.json()).id as string;
}

/** 我的提交（按本机 pid 过滤，不含全文，看状态用）。 */
export async function wdListMine(): Promise<WdSubmission[]> {
  const u = new URL(`${wdApiBase()}/api/worlddetail/submissions`);
  u.searchParams.set('owner', myPlayerId());
  const res = await fetch(u.toString(), { cache: 'no-cache' });
  if (!res.ok) throw new Error(await errMsg(res));
  return ((await res.json()).submissions ?? []) as WdSubmission[];
}

/** 【站长】待审列表（含全文；需管理员密钥）。 */
export async function wdListPending(): Promise<WdSubmission[]> {
  const u = new URL(`${wdApiBase()}/api/worlddetail/submissions`);
  u.searchParams.set('status', 'pending');
  const res = await fetch(u.toString(), { cache: 'no-cache', headers: adminHeader() });
  if (!res.ok) throw new Error(await errMsg(res));
  return ((await res.json()).submissions ?? []) as WdSubmission[];
}

/** 【站长】审核：approve = 写进全局 overrides 对所有玩家生效；reject = 仅标记。 */
export async function wdReview(id: string, action: 'approve' | 'reject'): Promise<void> {
  const res = await fetch(`${wdApiBase()}/api/worlddetail/review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...adminHeader() },
    body: JSON.stringify({ id, action }),
  });
  if (!res.ok) throw new Error(await errMsg(res));
}
