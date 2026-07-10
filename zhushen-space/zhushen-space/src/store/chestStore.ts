import { create } from 'zustand';
import { rollChestPlan, type ChestLootPlan } from '../systems/chestEngine';
import type { InventoryItem } from './itemStore';

/* ════════════════════════════════════════════
   开箱 store（瞬时会话，不持久化）
   - 一次开箱的会话：选中的宝箱 / 掷定的产出计划(plan) / AI 产物预览(pending) / 阶段(phase)。
   - 复用「装备强化所」的 API（App.runChestOpenPhase 内 resolveApiChain('enhance')），本 store 不存任何 API 配置。
   - 关键：pending 只是"预览"，确认前不入库、不消耗宝箱 → 天然支持"重新生成/撤销"零副作用。
   - 掷 plan 在"开启"时锁定一次；重新生成只重掷 AI 风味（同一批品级），撤销回列表后再开才重掷 plan。
     （对齐 craftStore 的 session 范式，但无配置/无持久化。）
════════════════════════════════════════════ */

/** AI 开出的一件产物（未入库，确认后由 App 转成 addItem）*/
export interface ChestProduct {
  name: string;
  category: string;
  gradeDesc: string;      // 品级锁死（= 该槽 plan.slots[i].gradeDesc）
  subType?: string;
  combatStat?: string;
  attrBonus?: string;
  score?: string;
  affix?: string;
  effect?: string;
  intro?: string;
  appearance?: string;
  killCount?: string;
}

export type ChestPhase = 'idle' | 'generating' | 'preview' | 'error';

export interface ChestSession {
  chestId: string;
  chestName: string;
  tendency: string;               // 开启者倾向提示（可空）
  plan: ChestLootPlan | null;     // 开启时掷定、锁住（重新生成沿用）
  pending: ChestProduct[] | null; // AI 产物预览（未入库）
  phase: ChestPhase;
  error?: string;
}

function freshSession(): ChestSession {
  return { chestId: '', chestName: '', tendency: '', plan: null, pending: null, phase: 'idle' };
}

interface ChestState {
  session: ChestSession;

  /** 选中一个宝箱（回到待开启态，清掉上一次的 plan/预览）*/
  selectChest: (chest: InventoryItem) => void;
  clearChest: () => void;         // 返回宝箱列表
  setTendency: (t: string) => void;

  /** 掷产出计划 + 进入 generating；成功返回 {ok:true,plan}，宝箱不存在返回失败。随后由 App 调 runChestOpenPhase。*/
  startOpen: (chest: InventoryItem) => { ok: boolean; why?: string };
  setGenerating: () => void;
  setPending: (products: ChestProduct[]) => void;
  setError: (msg: string) => void;
  resetResult: () => void;        // 重新生成前：清 pending（plan 保留，供重新生成沿用同批品级）
  endSession: () => void;         // 关面板/确认后：整会话清空
}

export const useChest = create<ChestState>((set, get) => ({
  session: freshSession(),

  selectChest: (chest) =>
    set({ session: { ...freshSession(), chestId: chest.id, chestName: chest.name } }),

  clearChest: () => set({ session: freshSession() }),

  setTendency: (t) => set((s) => ({ session: { ...s.session, tendency: t } })),

  startOpen: (chest) => {
    if (!chest) return { ok: false, why: '宝箱不在储存空间了' };
    const plan = rollChestPlan(chest);
    set((s) => ({ session: { ...s.session, chestId: chest.id, chestName: chest.name, plan, pending: null, phase: 'generating', error: undefined } }));
    return { ok: true };
  },

  setGenerating: () => set((s) => ({ session: { ...s.session, phase: 'generating', error: undefined } })),
  setPending: (products) => set((s) => ({ session: { ...s.session, pending: products, phase: 'preview', error: undefined } })),
  setError: (msg) => set((s) => ({ session: { ...s.session, phase: 'error', error: msg } })),
  resetResult: () => set((s) => ({ session: { ...s.session, pending: null, phase: 'generating', error: undefined } })),

  endSession: () => set({ session: freshSession() }),
}));
