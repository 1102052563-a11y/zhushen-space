import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { lzStorage } from '../systems/compressedStorage';

/* ══════════ ⭐ 坐标（收藏楼层）· drpg-bookmarks ══════════
   借鉴 ST-SevenDaysCal「构画」的「坐标」：把某一楼钉住，之后能找回来。

   ⚠ 核心设计＝**存快照，不存指针**：收藏时把当时的正文原文**整段拷进来**。
     楼层会被编辑、重生成、回退、被 historyLimit 挤出显示窗口、甚至随切世界清空对话——
     只存 msgId 的话这些情况一发生收藏就变成空指针。存了快照，原楼没了收藏照样读得到全文。
     msgId 只用来「尽量跳回原楼」，跳不到就退化成纯档案，不算坏。

   进度类 store：随存档快照走、新游戏清空（已进 saveManager STORES）。
   正文可能很长 → 走 lzStorage 压缩存（同 drpg-misc 口径）。 */

const CAP = 200;              // 收藏上限（新挤旧）
const SNAPSHOT_MAX = 6000;    // 单条快照字符上限：超长正文截断，别让收藏夹撑爆存档

export interface Bookmark {
  id: string;
  msgId: number;        // 原楼层 id（用于跳回；跳不到不影响阅读）
  text: string;         // ⭐正文快照（收藏那一刻的原文）
  note: string;         // 玩家备注
  tags: string[];       // 标签（自由填，面板可按标签筛）
  turn: number;         // 收藏时的回合数
  worldName: string;
  worldTime: string;
  ts: number;
}

interface BookmarkState {
  marks: Bookmark[];
  /** 收藏一楼（同 msgId 已收藏则不重复加）。返回是否真的新增。 */
  add: (b: Omit<Bookmark, 'id' | 'ts'>) => boolean;
  update: (id: string, patch: Partial<Pick<Bookmark, 'note' | 'tags'>>) => void;
  remove: (id: string) => void;
  /** 按楼层 id 取消收藏（楼层上的 ⭐ 再点一次）。 */
  removeByMsg: (msgId: number) => void;
  clear: () => void;
}

/** 标签归一：去空、去重、限 8 个（玩家手输容易打重，重复标签在卡上会显示两遍） */
function normTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw.map((t) => String(t ?? '').trim()).filter(Boolean) : [];
  return [...new Set(list)].slice(0, 8);
}

let seq = 0;

export const useBookmarks = create<BookmarkState>()(
  persist(
    (set, get): BookmarkState => ({
      marks: [],

      add: (b) => {
        if (get().marks.some((m) => m.msgId === b.msgId)) return false;   // 幂等：一楼只收藏一次
        const text = String(b.text ?? '').slice(0, SNAPSHOT_MAX);
        if (!text.trim()) return false;
        seq += 1;
        set((s) => ({
          marks: [...s.marks, {
            ...b,
            text,
            note: String(b.note ?? ''),
            tags: normTags(b.tags),
            id: `bm_${Date.now().toString(36)}_${seq.toString(36)}`,
            ts: Date.now(),
          }].slice(-CAP),
        }));
        return true;
      },

      update: (id, patch) => set((s) => ({
        marks: s.marks.map((m) => (m.id === id
          ? { ...m, ...patch, tags: patch.tags ? normTags(patch.tags) : m.tags }
          : m)),
      })),

      remove: (id) => set((s) => ({ marks: s.marks.filter((m) => m.id !== id) })),
      removeByMsg: (msgId) => set((s) => ({ marks: s.marks.filter((m) => m.msgId !== msgId) })),
      clear: () => set({ marks: [] }),
    }),
    { name: 'drpg-bookmarks', storage: lzStorage() },
  ),
);

export { CAP as BOOKMARK_CAP, SNAPSHOT_MAX };
