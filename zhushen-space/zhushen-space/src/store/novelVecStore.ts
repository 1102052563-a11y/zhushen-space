import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* 向量资料库（原著当世界书）设置：embedding 接口 + 检索参数。
   预建的向量(public/novel-vectors/*)由 systems/novelVec.ts 懒加载；这里只存"查询时"用的接口与参数。
   注意：查询用的 embedding 模型必须与建库时一致（默认 Pro/BAAI/bge-m3，硅基流动）。 */
export interface NovelVecSettings {
  enabled: boolean;
  apiBase: string;     // OpenAI 兼容 base，如 https://api.siliconflow.cn/v1
  apiKey: string;
  model: string;       // 必须与建库模型一致
  topK: number;        // 每回合最多注入几段
  threshold: number;   // cosine 阈值（归一化向量，0~1），低于此不注入
  maxChars: number;    // 注入总字数上限
}

interface NovelVecState {
  settings: NovelVecSettings;
  setSettings: (patch: Partial<NovelVecSettings>) => void;
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
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
    }),
    { name: 'drpg-novelvec' },
  ),
);
