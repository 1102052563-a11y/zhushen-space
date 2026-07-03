import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { InventoryItem } from './itemStore';

/* ════════════════════════════════════════════════════════════════════════
   账户仓库 · 跨存档保险箱（account vault）

   关键设计（照搬纪念丰碑范式，务必理解，否则"下个存档能取出"会失效）：
   本 store 用**独立** localStorage 键 `drpg-account-vault`，且**故意不**登记进
   systems/saveManager.ts 的 STORES 注册表 →
     · 不随存档快照保存/读取（loadSlot 只写 STORES 里的键）；
     · 不被「新游戏 / 开局建角」清空（clearProgress 只清 STORES 里带 clear 的）；
     · 仅靠自身 persist 落 localStorage，跨 reload / 跨存档 / 跨新局一直都在。
   → 存进账户仓库的物品是玩家**账号级**资产，任何后续存档里都能取回。

   每件物品存**完整快照**（InventoryItem，已剥 image 防 localStorage 膨胀）——词缀/强化/
   宝石/评分/耐久等全字段一并保留，取出时原样还原，杜绝「存进去再拿出来信息全没了」。
   Discord 登录后经 systems/accountVaultCloud.ts 备份到 R2（vault/<uid>.json），跨设备可取。
════════════════════════════════════════════════════════════════════════ */

export interface VaultEntry {
  id: string;
  item: InventoryItem;      // 完整物品快照（已剥 image）
  quantity: number;         // 存入数量（取出时按此还原）
  storedAt: number;
  updatedAt: number;        // 云同步并入「新者胜」判据
  fromSave?: string;        // 存入时的主角名（展示"来自哪个存档"）
}

interface VaultState {
  entries: Record<string, VaultEntry>;
  /** 存入一件物品（携带完整快照，自动剥 image）。返回新条目 id。 */
  deposit: (item: InventoryItem, quantity: number, fromSave?: string) => string;
  removeEntry: (id: string) => void;
  mergeEntries: (incoming: Record<string, VaultEntry>) => void;   // 云端并入本地（union by id，updatedAt 新者胜；只增/更不删本地独有）
  clearAll: () => void;     // 清空整仓（仅供面板手动调用——绝不挂进 clearProgress）
}

export const useAccountVault = create<VaultState>()(
  persist(
    (set): VaultState => ({
      entries: {},
      deposit: (item, quantity, fromSave) => {
        const id = `V${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
        const now = Date.now();
        const { image: _img, ...snap } = item;   // 剥图防 localStorage/云 blob 膨胀（取出后可重新生图）
        set((s) => ({
          entries: {
            ...s.entries,
            [id]: { id, item: snap as InventoryItem, quantity: Math.max(1, Math.round(quantity || 1)), storedAt: now, updatedAt: now, fromSave },
          },
        }));
        return id;
      },
      removeEntry: (id) =>
        set((s) => {
          if (!s.entries[id]) return s;
          const next = { ...s.entries };
          delete next[id];
          return { entries: next };
        }),
      mergeEntries: (incoming) =>
        set((s) => {
          if (!incoming || typeof incoming !== 'object') return s;
          const next = { ...s.entries };
          let changed = false;
          for (const [id, e] of Object.entries(incoming)) {
            if (!e || typeof e !== 'object' || !(e as VaultEntry).item || !(e as VaultEntry).item?.name) continue;  // 脏数据跳过
            const cur = next[id];
            const inAt = Number((e as VaultEntry).updatedAt || (e as VaultEntry).storedAt || 0);
            const curAt = cur ? Number(cur.updatedAt || cur.storedAt || 0) : -1;
            if (!cur || inAt > curAt) { next[id] = { ...(e as VaultEntry), id }; changed = true; }   // 不存在 or 云端更新 → 取云端
          }
          return changed ? { entries: next } : s;
        }),
      clearAll: () => set({ entries: {} }),
    }),
    { name: 'drpg-account-vault' },   // 独立键，**不**纳入 saveManager STORES → 跨存档/跨新局常驻
  ),
);
