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
  key: string;            // `${npcId}:${内容指纹}`——**同一角色·同一版本**重复入库会命中同 key → 覆盖而非堆叠（根治重复刷屏）；
                          //   内容变了（好感涨/经历多/人设改）指纹就变 → 各留一份（仍满足"有意义的多版本留底"）
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

/** 内容指纹：只取"能区分不同版本"的稳定字段（排除 updatedAt/lastSeenTurn/onScene 等易变噪音与体积巨大的 avatar）。
    同一角色·同一版本反复入库（如"找回→又被自动清理"的循环、反复被删的同一敌人）→ 指纹相同 → 同 key 覆盖，不再堆叠。
    好感/经历/人设真的变了 → 指纹变 → 各留一份。32位 FNV-1a 足够避免正常规模下的碰撞。 */
function contentFingerprint(rec: NpcRecord): string {
  const deeds = (rec.deedLog ?? []).map((d) => `${d?.time || ''}|${d?.location || ''}|${d?.description || ''}`).join('¶');
  const items = (rec.items ?? []).map((it) => `${it?.name || ''}#${it?.gradeDesc || ''}×${it?.quantity ?? 1}`).join(',');
  const parts = [
    rec.name, rec.realm, rec.gender, rec.npcTag, rec.profession, rec.title,
    rec.favor, rec.trust, rec.respect, rec.corruption, rec.lust,
    rec.personality, rec.background, rec.appearanceDetail, rec.relations,
    rec.selfNarration, rec.principles, deeds, items,
  ].map((v) => (v == null ? '' : String(v))).join('');
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < parts.length; i++) { h ^= parts.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 入库：拍一份快照进图书馆。**绝不抛错、绝不阻断**——归档失败不许拖累删除/合并主流程。
    ⚠ 调用方负责"只送有名有姓的真实 NPC"（幽灵空壳是 AI 手滑建的噪音，进库只会淹没真人）。*/
export function archiveNpc(record: NpcRecord, char?: NpcCharData, reason: ArchiveReason = 'manual', turn?: number): void {
  try {
    if (!record?.id || !idbAvailable()) return;
    const archivedAt = Date.now();
    const snap: NpcSnapshot = {
      // 内容指纹当 key：同一角色·同一版本重复入库 → 覆盖不堆叠（治"越删越多"）。archivedAt 仍随覆盖刷新为最近一次。
      key: `${record.id}:${contentFingerprint(record)}`,
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
