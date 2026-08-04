import { create } from 'zustand';

/* ════════════════════════════════════════════
   全局 toast（P4·UI 瞬时·不持久化）

   背景：全局浮层此前只有 App 内闭包的 npcManualToast（NPC/宠物手动更新专用），各面板另造了
   7 份局部 flash 轮子；而「面板没开着也会发生」的后台事件（交易行离线成交/托管归还、联机来宾
   离房奖励补发、派遣酬劳入库）此前完全无实时反馈——只能等下一回合正文提起。
   这里提供统一的 pushToast()；App 挂一个 <GlobalToasts/> 渲染。面板内已有的局部 flash 不强迁
   （能用就别动），新代码与后台事件一律走这里。
════════════════════════════════════════════ */

export type ToastKind = 'info' | 'ok' | 'err';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (kind: ToastKind, text: string, ttlMs?: number) => void;
  dismiss: (id: number) => void;
}

let seq = 1;

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (kind, text, ttlMs = 5000) => {
    const t = (text ?? '').trim();
    if (!t) return;
    if (get().toasts.some((x) => x.text === t)) return;   // 同文案去重（防连点/回显双发刷屏）
    const id = seq++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text: t }] }));   // 最多同屏 4 条
    setTimeout(() => get().dismiss(id), ttlMs);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

/** 便捷入口（非组件代码用）。 */
export function pushToast(kind: ToastKind, text: string, ttlMs?: number): void {
  try { useToasts.getState().push(kind, text, ttlMs); } catch { /* toast 失败不阻断业务 */ }
}
