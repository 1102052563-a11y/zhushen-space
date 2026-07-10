import { create } from 'zustand';
import { rollChestPlan, type ChestLootPlan } from '../systems/chestEngine';
import type { InventoryItem } from './itemStore';

/* ════════════════════════════════════════════
   开箱 store（瞬时会话·不持久化）— 批量版
   - 选箱阶段：selection = { chestId: 要开的数量 }（每种数量 ≤ 该宝箱堆叠数）。
   - 开启阶段：把 selection 展开成 jobs——**每"一只"宝箱＝一个 job，各自掷 plan、各自独立调一次 AI**，
     所以批量里每只开出的物品互不相同（用户要求）。
   - loot 只是预览，确认前不入库、不消耗宝箱；确认才逐 job 入库 + 按 chestId 汇总消耗 → 撤销/重新生成零副作用。
   - 复用「装备强化所」API（App.runChestOpenPhase 内 resolveApiChain('enhance')），本 store 不存任何 API 配置。
════════════════════════════════════════════ */

/** AI 开出的一件产物（未入库，确认后由 App 转成 addItem）*/
export interface ChestProduct {
  name: string;
  category: string;
  gradeDesc: string;      // 品级锁死（= 该槽 plan.slots[i].gradeDesc）
  subType?: string;
  origin?: string;        // 产地/来历出处（物品演化固定格式字段·不遗漏）
  combatStat?: string;
  durability?: string;    // 耐久度（装备类）
  requirement?: string;   // 装备需求（装备类·六维门槛）
  attrBonus?: string;
  score?: string;
  affix?: string;
  effect?: string;
  intro?: string;
  appearance?: string;
  killCount?: string;
}

export type ChestJobStatus = 'pending' | 'done' | 'error';
/** 一只宝箱的开启作业（批量里每只一个·各自 plan+各自 loot）*/
export interface ChestJob {
  jobId: string;
  chestId: string;
  chestName: string;
  gradeDesc: string;
  plan: ChestLootPlan;
  loot: ChestProduct[] | null;
  status: ChestJobStatus;
  error?: string;
}

export type ChestPhase = 'select' | 'generating' | 'preview';

export interface ChestSession {
  selection: Record<string, number>;   // chestId → 本次要开启的数量
  tendency: string;                     // 开启者倾向提示（整批共用·可空）
  jobs: ChestJob[];                     // 展开后的逐只作业（每只一个 job）
  phase: ChestPhase;
  error?: string;                       // 批量级错误（如未配 API）
}

/** 单次批量开箱上限（防 API 轰炸 / 预览过长）。*/
export const CHEST_BATCH_MAX = 10;

function freshSession(): ChestSession {
  return { selection: {}, tendency: '', jobs: [], phase: 'select' };
}

interface ChestState {
  session: ChestSession;

  setSelectQty: (chestId: string, qty: number, maxQty: number) => void;
  clearSelection: () => void;
  setTendency: (t: string) => void;

  /** 展开 selection → jobs（每只掷一次 plan·计入开启者幸运）+ 进入 generating。chests=当前背包快照，luck=开启者有效幸运。 */
  startBatch: (chests: InventoryItem[], luck?: number) => { ok: boolean; why?: string };
  setJobLoot: (jobId: string, loot: ChestProduct[]) => void;
  setJobError: (jobId: string, msg: string) => void;
  toPreview: () => void;
  setError: (msg: string) => void;
  resetResults: () => void;     // 重新生成：清所有 job loot（plan 保留·同批品级）→ generating
  backToSelect: () => void;     // 放弃预览：清 jobs 回选箱台（保留 selection/tendency·未消耗任何东西）
  endSession: () => void;       // 关面板/确认后：整会话清空
}

export const useChest = create<ChestState>((set, get) => ({
  session: freshSession(),

  setSelectQty: (chestId, qty, maxQty) =>
    set((s) => {
      const n = Math.max(0, Math.min(Math.floor(qty) || 0, Math.max(1, Math.floor(maxQty) || 1)));
      const selection = { ...s.session.selection };
      if (n <= 0) delete selection[chestId]; else selection[chestId] = n;
      return { session: { ...s.session, selection } };
    }),

  clearSelection: () => set((s) => ({ session: { ...s.session, selection: {} } })),
  setTendency: (t) => set((s) => ({ session: { ...s.session, tendency: t } })),

  startBatch: (chests, luck = 0) => {
    const sel = get().session.selection;
    const total = Object.values(sel).reduce((a, b) => a + b, 0);
    if (total <= 0) return { ok: false, why: '请先勾选要开启的宝箱' };
    if (total > CHEST_BATCH_MAX) return { ok: false, why: `一次最多开启 ${CHEST_BATCH_MAX} 只宝箱（当前 ${total} 只）` };
    const jobs: ChestJob[] = [];
    const stamp = Date.now();
    for (const [chestId, count] of Object.entries(sel)) {
      const chest = chests.find((x) => x.id === chestId);
      if (!chest) continue;
      const n = Math.min(count, Math.max(1, Math.floor(chest.quantity) || 1));
      for (let i = 0; i < n; i++) {
        jobs.push({
          jobId: `${chestId}#${i}#${stamp}${Math.random().toString(36).slice(2, 6)}`,
          chestId, chestName: chest.name, gradeDesc: chest.gradeDesc,
          plan: rollChestPlan(chest, luck), loot: null, status: 'pending',
        });
      }
    }
    if (!jobs.length) return { ok: false, why: '所选宝箱已不在储存空间' };
    set((s) => ({ session: { ...s.session, jobs, phase: 'generating', error: undefined } }));
    return { ok: true };
  },

  setJobLoot: (jobId, loot) =>
    set((s) => ({ session: { ...s.session, jobs: s.session.jobs.map((j) => (j.jobId === jobId ? { ...j, loot, status: 'done', error: undefined } : j)) } })),
  setJobError: (jobId, msg) =>
    set((s) => ({ session: { ...s.session, jobs: s.session.jobs.map((j) => (j.jobId === jobId ? { ...j, status: 'error', error: msg } : j)) } })),

  toPreview: () => set((s) => ({ session: { ...s.session, phase: 'preview' } })),
  setError: (msg) => set((s) => ({ session: { ...s.session, error: msg, phase: s.session.phase === 'generating' ? 'select' : s.session.phase } })),
  resetResults: () => set((s) => ({ session: { ...s.session, phase: 'generating', error: undefined, jobs: s.session.jobs.map((j) => ({ ...j, loot: null, status: 'pending', error: undefined })) } })),
  backToSelect: () => set((s) => ({ session: { ...s.session, jobs: [], phase: 'select', error: undefined } })),

  endSession: () => set({ session: freshSession() }),
}));
