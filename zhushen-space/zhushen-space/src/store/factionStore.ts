import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Deed } from './characterStore';

/* 判断「状态」是否表示该势力【真的覆灭/解散】。
   只认明确的覆灭状态，**排除**只是提到"覆灭/解散"却没真覆灭的情况
   （誓要覆灭敌方/濒临覆灭/面临解散危机/拒绝解散/避免覆灭/重建复兴…），
   避免势力因状态文案里出现"覆灭/解散"字样被误标 isDestroyed 而从档案消失。 */
export function looksDestroyed(status?: string): boolean {
  const t = (status ?? '').replace(/\s+/g, '');
  if (!t) return false;
  // 只是"提到/威胁/濒临/拒绝/避免"覆灭解散，并未真覆灭
  if (/濒临覆灭|濒临解散|面临覆灭|面临解散|险些覆灭|几乎覆灭|意图覆灭|妄图覆灭|誓要?覆灭|立誓覆灭|发誓.{0,4}覆灭|拒绝解散|抵抗.{0,4}覆灭|覆灭危机|解散危机|覆灭边缘|免于覆灭|避免覆灭|防止覆灭|重建|复兴|重组/.test(t)) return false;
  // 真覆灭：已覆灭/被消灭/已解散/已灭亡…，或状态以覆灭词起头
  if (/(已|被|遭到?|彻底|宣告|正式|当场|全[军员])(覆灭|覆没|解散|消灭|灭亡|剿灭|歼灭|瓦解|铲除)/.test(t)) return true;
  const head = t.replace(/^[^一-鿿]+/, '');
  return /^(覆灭|覆没|解散|灭亡|消灭|剿灭|歼灭|瓦解|名存实亡|不复存在)/.test(head);
}

/* ════════════════════════════════════════════
   势力档案（组织/帮派/政府/企业/教会/军团/部落/星际势力…）
   当前世界 inCurrentWorld=true（类比 NPC 在场）/ 非当前世界=false（类比离场）
════════════════════════════════════════════ */
export interface FactionRecord {
  id: string;            // F1/F2…
  name: string;
  type: string;          // 帮派/政府/企业/教会/军团/部落/星际势力…
  inCurrentWorld: boolean;
  worldName: string;     // 所属世界
  scale: string;         // 规模：小型/中型/大型/巨型
  powerLevel: string;    // 实力等级
  territory: string;     // 地盘/活动区域
  leader: string;        // 首领（可写 NPC id 如 C1 或名字）
  members: string;       // 核心成员（可含 NPC id）
  relations: string;     // 与其他势力关系：F2:敌对;F3:同盟
  favorToPlayer: number; // 对主角态度 -100~100
  goal: string;          // 当前目标
  resources: string;     // 财力/兵力/影响力
  status: string;        // 兴盛/衰落/战争中/已覆灭…
  background: string;    // 历史/背景
  assets: string;        // 产业/资产
  isDestroyed?: boolean;  // 已覆灭
  isBond?: boolean;       // 羁绊/开局势力，长期保留
  keepForever?: boolean;  // 手动长期保留
  freqMode?: 'turn' | 'date';
  freqInterval?: number;
  lastEvolvedTurn?: number;
  lastSeenTurn?: number;
  deeds?: Deed[];        // 势力大事记
  extra: Record<string, string>;
  updatedAt: number;
}

/* 字段名 → 中文标签（applyColumns 用命名键） */
const FIELD_KEYS: (keyof FactionRecord)[] = [
  'name', 'type', 'worldName', 'scale', 'powerLevel', 'territory', 'leader', 'members',
  'relations', 'goal', 'resources', 'status', 'background', 'assets',
];

/* 防占位名覆盖真实名：当传入名是占位（空 / 等于 id / 形如 F\d+）而该势力已有真实名时，保留原真实名；
   否则采用传入名（去首尾空格）。修复「势力重入(reentry)时 AI 未复述全名，名字被重置回 F1/F2/F3…」的回归——
   upsertFaction({name:e.name??id}) 与 addFaction 增量更新都会经过它。 */
export function resolveFactionName(prevName: string | undefined, id: string, incoming: unknown): string {
  const inc = String(incoming ?? '').trim();
  const incPlaceholder = !inc || inc === id || /^F\d+$/i.test(inc);
  const hasRealPrev = !!prevName && prevName !== id && !/^F\d+$/i.test(prevName);
  if (incPlaceholder) return hasRealPrev ? (prevName as string) : (inc || id);
  return inc;
}

export function defaultFaction(id: string): FactionRecord {
  return {
    id, name: id, type: '', inCurrentWorld: true, worldName: '', scale: '', powerLevel: '',
    territory: '', leader: '', members: '', relations: '', favorToPlayer: 0, goal: '',
    resources: '', status: '正常运作', background: '', assets: '', extra: {}, updatedAt: Date.now(),
  };
}

interface FactionState {
  factions: Record<string, FactionRecord>;
  upsertFaction: (id: string, patch: Partial<FactionRecord>) => void;
  applyColumns: (id: string, cols: Record<string, unknown>) => void;     // 命名键覆盖式更新
  setWorld: (id: string, inCurrentWorld: boolean, turn?: number) => void; // 进入/离开当前世界
  setSchedule: (id: string, patch: { freqMode?: 'turn' | 'date'; freqInterval?: number }) => void;
  markEvolved: (id: string, turn: number) => void;
  appendDeed: (id: string, deed: string | Deed) => void;
  removeDeed: (id: string, index: number) => void;
  removeFaction: (id: string) => void;     // 软删除（移出当前世界归档）
  hardRemoveFaction: (id: string) => void; // 物理删除
  clearAll: () => void;
}

export const useFaction = create<FactionState>()(
  persist(
    (set) => ({
      factions: {},

      upsertFaction: (id, patch) =>
        set((s) => {
          const prev = s.factions[id] ?? defaultFaction(id);
          const merged: FactionRecord = { ...prev, ...patch, id, updatedAt: Date.now() };
          if ('name' in patch) merged.name = resolveFactionName(prev.name, id, patch.name);   // 防占位名冲掉真实名（reentry）
          return { factions: { ...s.factions, [id]: merged } };
        }),

      applyColumns: (id, cols) =>
        set((s) => {
          const prev = s.factions[id] ?? defaultFaction(id);
          const next: FactionRecord = { ...prev, id, updatedAt: Date.now() };
          for (const [k, v] of Object.entries(cols)) {
            if (v == null) continue;
            if (k === 'favorToPlayer' || k === 'favor') { next.favorToPlayer = Number(v) || 0; continue; }
            if (k === 'inCurrentWorld') { next.inCurrentWorld = v === true || v === 'true'; continue; }
            if ((FIELD_KEYS as string[]).includes(k)) {
              // 防改名：已有真名时不让 name 被占位（空 / =id / F\d+）覆盖
              if (k === 'name') { next.name = resolveFactionName(prev.name, id, v); continue; }
              (next as unknown as Record<string, unknown>)[k] = String(v);
            } else {
              next.extra = { ...next.extra, [k]: String(v) };
            }
          }
          if (looksDestroyed(next.status)) next.isDestroyed = true;   // 精确判定，避免"誓要覆灭/濒临覆灭"误标
          return { factions: { ...s.factions, [id]: next } };
        }),

      setWorld: (id, inCurrentWorld, turn) =>
        set((s) => {
          const prev = s.factions[id] ?? defaultFaction(id);
          return { factions: { ...s.factions, [id]: { ...prev, inCurrentWorld, lastSeenTurn: inCurrentWorld ? (turn ?? prev.lastSeenTurn) : prev.lastSeenTurn, updatedAt: Date.now() } } };
        }),

      setSchedule: (id, patch) =>
        set((s) => {
          const prev = s.factions[id]; if (!prev) return s;
          return { factions: { ...s.factions, [id]: { ...prev, ...patch, updatedAt: Date.now() } } };
        }),

      markEvolved: (id, turn) =>
        set((s) => {
          const prev = s.factions[id]; if (!prev) return s;
          return { factions: { ...s.factions, [id]: { ...prev, lastEvolvedTurn: turn } } };
        }),

      appendDeed: (id, deed) =>
        set((s) => {
          const prev = s.factions[id] ?? defaultFaction(id);
          const d: Deed = typeof deed === 'string' ? { time: '', location: '', description: deed, addedAt: Date.now() } : { ...deed, addedAt: deed.addedAt ?? Date.now() };
          return { factions: { ...s.factions, [id]: { ...prev, deeds: [...(prev.deeds ?? []), d].slice(-50), updatedAt: Date.now() } } };
        }),

      removeDeed: (id, index) =>
        set((s) => {
          const prev = s.factions[id]; if (!prev) return s;
          return { factions: { ...s.factions, [id]: { ...prev, deeds: (prev.deeds ?? []).filter((_, i) => i !== index) } } };
        }),

      removeFaction: (id) =>
        set((s) => {
          const prev = s.factions[id]; if (!prev) return s;
          return { factions: { ...s.factions, [id]: { ...prev, inCurrentWorld: false, updatedAt: Date.now() } } };  // 软删除=移出当前世界
        }),

      hardRemoveFaction: (id) =>
        set((s) => { const next = { ...s.factions }; delete next[id]; return { factions: next }; }),

      clearAll: () => set({ factions: {} }),
    }),
    {
      name: 'drpg-faction',
      // 一次性纠偏：历史上因状态文案含"覆灭/解散"被误标 isDestroyed 的势力，若状态并非真覆灭则恢复。
      merge: (persisted: any, current: any) => ({
        ...current,
        ...persisted,
        factions: Object.fromEntries(Object.entries(persisted?.factions ?? {}).map(([id, f]: [string, any]) =>
          [id, (f && f.isDestroyed && !looksDestroyed(f.status)) ? { ...f, isDestroyed: false } : f],
        )),
      }),
    }
  )
);
