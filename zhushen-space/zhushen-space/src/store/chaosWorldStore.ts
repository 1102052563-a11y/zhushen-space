import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* 混沌世界 store（配置/偏好层，非游戏进度）。
 *
 * 混沌世界：主角每次离世时，额外生成一段「对该世界产生了什么影响 + 剧情偏移度」记录，opt-in 上传到公开看板（后端 = zhushen-multiplayer 的 /api/chaos/*，D1）。
 * 玩家可勾选多个世界，让 AI 读取这些世界的历史记录 + 额外提示词，生成一张「被前人影响过」的混沌世界卡。
 * 这里只存：后端地址覆盖(apiBase,空=用 mpBase) + 是否离世自动生成记录(enabled) + 是否联网检索(webSearch) + 我上传过的账本(myUploads)。
 * 抓取/上传/量化逻辑在 systems/chaosWorld.ts。**不进 saveManager**（配置层·同 workshopStore/settingsStore：跨存档保留，新游戏不清）。 */

export interface ChaosUploadRecord {
  id: string;             // 后端记录 id
  world: string;          // 归一后的世界名
  offset: number;         // 剧情偏移度 0-100
  title?: string;
  uploadedAt: number;
  worldRecordId?: string; // 关联的本地世界记录 id（便于回溯）
}

interface ChaosWorldState {
  apiBase: string;        // 覆盖后端地址；空字符串=用 mpBase()
  enabled: boolean;       // 离世时是否额外生成「混沌记录」（opt-in·会多调一次 AI）
  webSearch: boolean;     // 生成时是否用 Google 联网检索核对原著剧情（部分接口/路由才支持）
  myUploads: Record<string, ChaosUploadRecord>;

  setApiBase: (url: string) => void;
  setEnabled: (v: boolean) => void;
  setWebSearch: (v: boolean) => void;
  recordUpload: (rec: ChaosUploadRecord) => void;
  forgetUpload: (id: string) => void;
}

export const useChaosWorld = create<ChaosWorldState>()(
  persist(
    (set): ChaosWorldState => ({
      apiBase: '',
      enabled: true,
      webSearch: true,
      myUploads: {},

      setApiBase: (url) => set({ apiBase: url.trim().replace(/\/+$/, '') }),
      setEnabled: (v) => set({ enabled: v }),
      setWebSearch: (v) => set({ webSearch: v }),
      recordUpload: (rec) => set((s) => ({ myUploads: { ...s.myUploads, [rec.id]: rec } })),
      forgetUpload: (id) =>
        set((s) => {
          const myUploads = { ...s.myUploads };
          delete myUploads[id];
          return { myUploads };
        }),
    }),
    {
      name: 'drpg-chaos',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ChaosWorldState>;
        return {
          ...current, ...p,
          apiBase: p.apiBase ?? '',
          enabled: p.enabled ?? true,
          webSearch: p.webSearch ?? true,
          myUploads: p.myUploads ?? {},
        };
      },
    }
  )
);
