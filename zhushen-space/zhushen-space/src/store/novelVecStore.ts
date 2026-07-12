import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* 向量资料库（原著当世界书）设置 + 玩家自建索引登记表。
   - settings：查询那一下用的 embedding 接口与检索参数（内置预建向量 public/novel-vectors/* 也用它查询）。
     注意：内置库查询模型须与建库模型一致（默认 Pro/BAAI/bge-m3，硅基流动）。
   - userIndexes：玩家在浏览器里自建的向量库【元数据登记表】。真正的向量/文本块存 IndexedDB(drpg-novelvec)，
     这里只留轻量元数据（供 UI 列表 + 运行时按登记表懒加载）。顶层字段：configExport 的 evoExtract 只导 settings，不会外泄本表。 */

export interface NovelVecSettings {
  enabled: boolean;
  apiBase: string;     // OpenAI 兼容 base，如 https://api.siliconflow.cn/v1
  apiKey: string;
  model: string;       // 内置库查询模型（须与建库一致）
  topK: number;        // 每回合最多注入几段
  threshold: number;   // cosine 阈值（归一化向量，0~1），低于此不注入
  maxChars: number;    // 注入总字数上限
}

export type UserIndexOrigin = 'local' | 'cloud' | 'community';   // 来源：本地自建 / 从私有云拉回 / 从社区下载
export type UserIndexKind = 'text' | 'worldbook';               // 语料类型：纯文本(小说/设定) / 世界书 JSON

/* 玩家自建索引元数据（不含向量本体，向量在 IndexedDB） */
export interface UserIndexMeta {
  id: string;              // 稳定本地 id：u_<slug>_<ts36>
  name: string;            // 玩家起的名字
  kind: UserIndexKind;
  model: string;           // 建库用的 embedding 模型（检索按模型分组，这决定用哪个模型 embed 查询）
  apiBase: string;         // 建库用的 base（同模型查询默认沿用它）
  dim: number;             // 向量维度
  count: number;           // 文本块数
  chunkSize: number;
  overlap: number;
  sizeBytes: number;       // 向量字节数（int8 → count*dim），提示体积
  builtAt: string;         // ISO
  enabled: boolean;        // 是否参与正文检索注入
  origin: UserIndexOrigin;
  note?: string;           // 可选备注
  remoteId?: string;       // 已上传私有云的 id
  publishedId?: string;    // 已发布社区的 id
}

interface NovelVecState {
  settings: NovelVecSettings;
  userIndexes: UserIndexMeta[];
  setSettings: (patch: Partial<NovelVecSettings>) => void;
  addUserIndex: (meta: UserIndexMeta) => void;
  updateUserIndex: (id: string, patch: Partial<UserIndexMeta>) => void;
  removeUserIndex: (id: string) => void;
  setUserIndexEnabled: (id: string, enabled: boolean) => void;
}

export const useNovelVec = create<NovelVecState>()(
  persist(
    (set) => ({
      settings: {
        enabled: false,
        apiBase: 'https://api.siliconflow.cn/v1',
        apiKey: '',
        model: 'Pro/BAAI/bge-m3',
        topK: 5,
        threshold: 0.35,
        maxChars: 2500,
      },
      userIndexes: [],
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      addUserIndex: (meta) => set((s) => ({
        // 同 id 覆盖（重建/重导入），否则追加
        userIndexes: [...s.userIndexes.filter((x) => x.id !== meta.id), meta],
      })),
      updateUserIndex: (id, patch) => set((s) => ({
        userIndexes: s.userIndexes.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      })),
      removeUserIndex: (id) => set((s) => ({ userIndexes: s.userIndexes.filter((x) => x.id !== id) })),
      setUserIndexEnabled: (id, enabled) => set((s) => ({
        userIndexes: s.userIndexes.map((x) => (x.id === id ? { ...x, enabled } : x)),
      })),
    }),
    { name: 'drpg-novelvec' },
  ),
);
