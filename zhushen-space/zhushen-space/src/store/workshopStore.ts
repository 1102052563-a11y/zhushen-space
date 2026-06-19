import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* 创意工坊 store（配置/偏好层，非游戏进度）。
 *
 * 社区工坊：无审核直传 + 浏览 + 下载数，后端 = zhushen-multiplayer Worker 的 /api/workshop/*（D1）。
 * 这里只存：后端地址覆盖(apiBase,空=用 mpBase) + 已安装账本(installs，用于「已装/有更新」与忘记记录)。
 * 抓取/上传/安装逻辑在 systems/workshop.ts。不进 saveManager（同 settingsStore/imageGenStore）。
 */

export interface InstallRecord {
  id: string;             // 工坊条目 id
  type: string;           // WorkshopKindId
  name: string;
  version?: string;
  contentHash?: string;
  installedAt: number;
}

// 我上传过的条目（本地记录；权威列表靠后端按 owner 查）
export interface UploadRecord {
  id: string;
  type: string;
  name: string;
  version?: string;
  uploadedAt: number;
}

interface WorkshopState {
  apiBase: string;        // 覆盖后端地址；空字符串=用 mpBase()
  nickname: string;       // 工坊昵称（上传署名；改名会传播到已上传）
  adminKey: string;       // 管理员密钥（与 worker env.WS_ADMIN_KEY 匹配则可删任意条目）
  installs: Record<string, InstallRecord>;
  myUploads: Record<string, UploadRecord>;

  setApiBase: (url: string) => void;
  setNickname: (name: string) => void;
  setAdminKey: (key: string) => void;
  recordInstall: (rec: InstallRecord) => void;
  forgetInstall: (id: string) => void;
  recordUpload: (rec: UploadRecord) => void;
  forgetUpload: (id: string) => void;
}

export const useWorkshop = create<WorkshopState>()(
  persist(
    (set): WorkshopState => ({
      apiBase: '',
      nickname: '',
      adminKey: '',
      installs: {},
      myUploads: {},

      setApiBase: (url) => set({ apiBase: url.trim().replace(/\/+$/, '') }),
      setNickname: (name) => set({ nickname: name.trim().slice(0, 40) }),
      setAdminKey: (key) => set({ adminKey: key.trim() }),
      recordInstall: (rec) => set((s) => ({ installs: { ...s.installs, [rec.id]: rec } })),
      forgetInstall: (id) =>
        set((s) => {
          const installs = { ...s.installs };
          delete installs[id];
          return { installs };
        }),
      recordUpload: (rec) => set((s) => ({ myUploads: { ...s.myUploads, [rec.id]: rec } })),
      forgetUpload: (id) =>
        set((s) => {
          const myUploads = { ...s.myUploads };
          delete myUploads[id];
          return { myUploads };
        }),
    }),
    {
      name: 'drpg-workshop',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<WorkshopState>;
        return { ...current, ...p, apiBase: p.apiBase ?? '', nickname: p.nickname ?? '', adminKey: p.adminKey ?? '', installs: p.installs ?? {}, myUploads: p.myUploads ?? {} };
      },
    }
  )
);
