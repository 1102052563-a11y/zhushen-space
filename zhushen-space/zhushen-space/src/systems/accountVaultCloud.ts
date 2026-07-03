// 账户仓库·云同步客户端（与聊天室/助战/交易行/丰碑共用 Discord 身份 chatToken）。
// 模型 = 本地优先 + 云端备份/跨设备：本地 useAccountVault(drpg-account-vault) 仍是工作副本；
//   · 拉取(pull)：GET /api/vault → mergeEntries 并入本地（union·新者胜，绝不删本地独有）。
//   · 上传(push)：POST /api/vault ← 本地全量（覆盖云端单 blob）。登录态下订阅本地变化自动防抖上传。
//   · 同步(sync)：先 pull 并入、再 push 回传 = 双向并集，手动按钮用。
// 后端纯 R2（vault/<uid>.json），私有按 Discord 顺序 UID 寻址。照搬 monumentCloud.ts。
import { create } from 'zustand';
import { useAccountVault } from '../store/accountVaultStore';
import { mpBase } from './mpConfig';
import { chatToken, chatReady } from './chatIdentity';

export type VaultCloudStatus = 'idle' | 'syncing' | 'ok' | 'error' | 'offline';
interface VaultCloudState {
  status: VaultCloudStatus;
  msg: string;
  lastSync: number;
  _set: (p: Partial<VaultCloudState>) => void;
}
export const useVaultCloud = create<VaultCloudState>((set): VaultCloudState => ({
  status: 'idle', msg: '', lastSync: 0, _set: (p) => set(p),
}));
const set = (p: Partial<VaultCloudState>) => useVaultCloud.getState()._set(p);

export function vaultCloudReady(): boolean { return chatReady(); }

/** 拉取云端账户仓库并入本地（union·新者胜）。返回云端条目数；失败返回 -1。 */
export async function pullVaultCloud(): Promise<number> {
  if (!chatReady()) { set({ status: 'offline', msg: '未登录' }); return -1; }
  set({ status: 'syncing', msg: '从云端拉取…' });
  try {
    const r = await fetch(`${mpBase()}/api/vault`, { headers: { Authorization: `Bearer ${chatToken()}` } });
    if (!r.ok) throw new Error(r.status === 401 ? 'Discord 会话已过期，请重新登录' : '云端读取失败');
    const d = await r.json();
    const incoming = (d && d.entries) || {};
    useAccountVault.getState().mergeEntries(incoming);
    set({ status: 'ok', msg: `已并入云端 ${Object.keys(incoming).length} 件`, lastSync: Date.now() });
    return Object.keys(incoming).length;
  } catch (e: any) { set({ status: 'error', msg: e?.message || '同步失败' }); return -1; }
}

/** 上传本地全量账户仓库覆盖云端。成功返回 true。 */
export async function pushVaultCloud(): Promise<boolean> {
  if (!chatReady()) { set({ status: 'offline', msg: '未登录' }); return false; }
  set({ status: 'syncing', msg: '上传到云…' });
  try {
    const entries = useAccountVault.getState().entries;
    const body = JSON.stringify({ entries, updatedAt: Date.now() });
    const r = await fetch(`${mpBase()}/api/vault`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chatToken()}`, 'Content-Type': 'application/json' },
      body,
    });
    if (!r.ok) { let m = '上传失败'; try { const e = await r.json(); if (e?.error) m = e.error; } catch { /* */ } throw new Error(m); }
    set({ status: 'ok', msg: `已上传 ${Object.keys(entries).length} 件到云`, lastSync: Date.now() });
    return true;
  } catch (e: any) { set({ status: 'error', msg: e?.message || '上传失败' }); return false; }
}

/** 双向同步（先拉并入、再整体回传）= 云⇄本地并集，手动「同步」按钮用。 */
export async function syncVaultCloud(): Promise<void> {
  const n = await pullVaultCloud();
  if (n >= 0) await pushVaultCloud();
}

// 自动推送：登录态下订阅本地账户仓库变化 → 防抖上传。模块级只装一次。
let pushTimer: any = null;
let inited = false;
export function initVaultCloudSync(): void {
  if (inited) return;
  inited = true;
  useAccountVault.subscribe((s, prev) => {
    if (s.entries === prev.entries) return;   // 仅 entries 变化才同步
    if (!chatReady()) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; pushVaultCloud(); }, 1800);
  });
}
