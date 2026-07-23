import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { lzStorage } from '../systems/compressedStorage';

/* 世界资料库·本地修订 store（配置/内容层，非游戏进度——不进 saveManager，同 workshopStore）。
 * 玩家在「世界资料库」面板编辑某世界的 ·剧情/·切入点 后保存在这里：
 *   - 本机立即生效：systems/worldDetail.ts 读取顺序 = 本地修订 > 全局修订(服务端已审) > 内置分片；
 *   - 可另行「提交审核」：站长通过后进服务端 overrides，对所有玩家生效（见 systems/worldDetailShare.ts）。
 * 键 = 库内正名（manifest 的世界名）。文本体积大（每世界 ~1万字）→ persist 用 lz 压缩存储。 */

export interface WorldEditRec {
  plot: string;            // 编辑后 ·剧情 全文
  cut?: string;            // 编辑后 ·切入点 全文（空 = 没写）
  editedAt: number;
  submittedAt?: number;    // 最近一次提交审核时间（仅本地提示；权威状态靠服务端「我的提交」查询）
}

interface WorldEditState {
  edits: Record<string, WorldEditRec>;
  setEdit: (name: string, rec: { plot: string; cut?: string }) => void;
  removeEdit: (name: string) => void;
  markSubmitted: (name: string) => void;
}

export const useWorldEdit = create<WorldEditState>()(
  persist(
    (set): WorldEditState => ({
      edits: {},
      setEdit: (name, rec) => set((s) => ({
        edits: { ...s.edits, [name]: { plot: rec.plot, cut: rec.cut || undefined, editedAt: Date.now(), submittedAt: s.edits[name]?.submittedAt } },
      })),
      removeEdit: (name) => set((s) => { const edits = { ...s.edits }; delete edits[name]; return { edits }; }),
      markSubmitted: (name) => set((s) => (s.edits[name] ? { edits: { ...s.edits, [name]: { ...s.edits[name], submittedAt: Date.now() } } } : s)),
    }),
    { name: 'drpg-worldedit', storage: lzStorage() }
  )
);
