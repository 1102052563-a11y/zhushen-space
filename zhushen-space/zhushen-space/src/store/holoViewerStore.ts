import { create } from 'zustand';
import { holoItemProps, holoNpcProps, type HoloViewProps } from '../systems/holoProps';

/* 全局全息卡检视器（灯箱）——点击任意物品/NPC 缩略图放大成全息卡检视，不持久化。 */
interface HoloViewerState {
  open: boolean;
  props: HoloViewProps;
  show: (props: HoloViewProps) => void;   // 直接给 props
  showItem: (item: any) => void;          // 物品对象 → 自动构造 props
  showNpc: (npc: any) => void;            // NPC 对象 → 自动构造 props
  hide: () => void;
}

export const useHoloViewer = create<HoloViewerState>((set) => ({
  open: false,
  props: {},
  show: (props) => set({ open: true, props }),
  showItem: (item) => set({ open: true, props: holoItemProps(item) }),
  showNpc: (npc) => set({ open: true, props: holoNpcProps(npc) }),
  hide: () => set({ open: false }),
}));
