/* ════════════════════════════════════════════
   NPC 图书馆（drpg-npc-library）——**只进不出**的档案库。
   铁则：**基本只存不删**。任何会让 NPC 从 npcStore 消失的路径（手动删除 / 同名合并 / 别名合并 / 空壳清理），
   都必须在删之前往这里拍一份**全量快照**；库内条目永不自动清理，只有玩家显式清除。
   目的：根除「归档/合并/清理 → 角色连同感情线(好感·四轴态度·经历·关系)一起人间蒸发、再也找不回」。
     —— 此前的做法是逐条堵删除路径（打地鼠），只要还有一条没堵住就会漏；改为"删除=从书架挪进库房"。
   ⚠ 放 IndexedDB 而非 localStorage：快照含完整档案+技能+天赋+记忆+头像，体积大（localStorage 5MB 会爆）。
   ⚠ 头像**内联进快照**（不只存 imageDb 的 key）：NPC 记录一没，imageDb 里的头像就成孤儿、会被 pruneOrphanImages 清掉；
      内联后图书馆自包含，孤儿清理带不走它。
════════════════════════════════════════════ */
import type { NpcRecord } from '../store/npcStore';

const DB_NAME = 'drpg-npc-library';
const STORE = 'snapshots';
const VERSION = 1;

export type ArchiveReason = 'hardRemove' | 'dedupeMerge' | 'aliasMerge' | 'ghostPrune' | 'manual';
export const REASON_LABEL: Record<ArchiveReason, string> = {
  hardRemove: '手动删除',
  dedupeMerge: '同名合并',
  aliasMerge: '别名合并',
  ghostPrune: '空壳清理',
  manual: '手动封存',
};

/** 角色在 characterStore 的附属数据（技能/天赋/称号/副职业/记忆）——与档案一起快照，否则找回的是个失忆的空架子 */
export interface NpcCharData {
  skills?: unknown[];
  talents?: unknown[];
  titles?: unknown[];
  subProfessions?: unknown[];
  memory?: unknown;
}

export interface NpcSnapshot {
  key: string;            // `${npcId}:${archivedAt}`——同一 id 可多次入库，互不覆盖（只进不出）
  npcId: string;
  name: string;
  reason: ArchiveReason;
  archivedAt: number;
  turn?: number;          // 入库时的回合号（供玩家判断"哪个版本"）
  record: NpcRecord;      // 完整档案快照（含 avatar）
  char?: NpcCharData;     // 技能/天赋/称号/副职业/记忆
}

/** IndexedDB 是否可用（node/vitest/SSR 环境没有）——不可用时图书馆整体降级为 no-op，绝不炸主流程 */
const idbAvailable = (): boolean => typeof indexedDB !== 'undefined';

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        const os = req.result.createObjectStore(STORE, { keyPath: 'key' });
        os.createIndex('npcId', 'npcId', { unique: false });
        os.createIndex('archivedAt', 'archivedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

export async function putSnapshot(snap: NpcSnapshot): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(snap);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 入库：拍一份快照进图书馆。**绝不抛错、绝不阻断**——归档失败不许拖累删除/合并主流程。
    ⚠ 调用方负责"只送有名有姓的真实 NPC"（幽灵空壳是 AI 手滑建的噪音，进库只会淹没真人）。*/
export function archiveNpc(record: NpcRecord, char?: NpcCharData, reason: ArchiveReason = 'manual', turn?: number): void {
  try {
    if (!record?.id || !idbAvailable()) return;
    const archivedAt = Date.now();
    const snap: NpcSnapshot = {
      key: `${record.id}:${archivedAt}`,
      npcId: record.id,
      name: record.name || record.id,
      reason,
      archivedAt,
      turn,
      // 深拷贝：快照必须凝固在入库这一刻，绝不被后续 store 变动/引用共享污染
      record: JSON.parse(JSON.stringify(record)),
      char: char ? JSON.parse(JSON.stringify(char)) : undefined,
    };
    void putSnapshot(snap).catch((e) => console.warn('[NPC图书馆] 快照写入失败（忽略）:', e));
    console.log(`[NPC图书馆] 入库「${snap.name}」(${record.id}) · 原因=${REASON_LABEL[reason]}`);
  } catch (e) {
    console.warn('[NPC图书馆] 快照序列化失败（忽略）:', e);
  }
}

/** 全部快照，新→旧 */
export async function listSnapshots(): Promise<NpcSnapshot[]> {
  if (!idbAvailable()) return [];
  const d = await db();
  return new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    tx.oncomplete = () => resolve(((req.result as NpcSnapshot[]) ?? []).sort((a, b) => b.archivedAt - a.archivedAt));
    tx.onerror = () => resolve([]);
  });
}

export async function getSnapshot(key: string): Promise<NpcSnapshot | null> {
  if (!idbAvailable()) return null;
  const d = await db();
  return new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    tx.oncomplete = () => resolve((req.result as NpcSnapshot) ?? null);
    tx.onerror = () => resolve(null);
  });
}

/** 删除一条快照 —— **仅供玩家显式清理**。任何自动流程都不许调用（违背"只存不删"）。*/
export async function removeSnapshot(key: string): Promise<void> {
  const d = await db();
  return new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** 清空图书馆 —— **仅供玩家显式清理**（会二次确认；清了不可恢复）*/
export async function clearLibrary(): Promise<void> {
  const d = await db();
  return new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
