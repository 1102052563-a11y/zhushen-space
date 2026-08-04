import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ImgService } from './imageGenStore';

/* ════════════════════════════════════════════
   漫画工坊（借鉴 comic-orb 工作流·全部自写）：楼层剧情 → 分镜 JSON → 并发绘画 → 漫画库。
   设置持久化在 drpg-comic；批次/页图在 IndexedDB drpg-comics（systems/comicDb.ts，不进 saveManager）。
   任务进度（useComicJob）纯运行时，不持久化。
════════════════════════════════════════════ */

export type ComicWorkflowMode = 'direct' | 'interpretive';
export type ComicSafetyLevel = 'off' | 'soft' | 'safe';

export interface ComicSettings {
  service: ImgService;       // 绘画服务（推荐 chatimg=多模态Chat；NAI/Comfy 走标签线每页一张关键画面）
  workflowMode: ComicWorkflowMode;   // direct=直接分镜（短剧情一次出全部页）；interpretive=演绎分镜（长剧情：先切段再错峰并发分镜）
  pageCount: number;         // 直接分镜页数 1~4
  pagesMin: number;          // 演绎模式总页数下限（2~20）
  pagesMax: number;          // 演绎模式总页数上限（2~20）
  workerPages: string;       // 演绎模式单个分镜调用页数规格（"2" 或 "1-2"）
  size: string;              // 页面尺寸（竖版 832x1216 默认；chatimg 线作为比例提示）
  language: string;          // 漫画文字语言（对白/旁白/拟声）
  sendCharRefs: boolean;     // 把出场角色立绘/头像发给绘画模型当参考图（仅 chatimg 多模态线生效）
  safetyLevel: ComicSafetyLevel;   // 安全档位：off=不适配（NAI/无审核线）；soft=少年漫软适配（表现力最大）；safe=安全适配（成功率优先）
  neutralize: boolean;       // 送审措辞中性化：只改发给分镜/演绎模型的请求副本，游戏正文原文不动
  insertToFloor: boolean;    // 全部页成功后把漫画追加进目标楼层正文
  negative: string;          // 负面提示词（NAI/ComfyUI 线用）
  staggerMs: number;         // 并发绘画错峰间隔（防服务商突发限流）
}

interface ComicState extends ComicSettings {
  set: (patch: Partial<ComicSettings>) => void;
}

export const useComic = create<ComicState>()(
  persist(
    (set): ComicState => ({
      service: 'chatimg',
      workflowMode: 'direct',
      pageCount: 2,
      pagesMin: 4,
      pagesMax: 8,
      workerPages: '1-2',
      size: '832x1216',
      language: 'zh-CN',
      sendCharRefs: true,
      safetyLevel: 'soft',
      neutralize: true,
      insertToFloor: true,
      negative: 'lowres, worst quality, bad quality, jpeg artifacts, watermark, signature, logo, bad anatomy, bad hands, extra fingers, deformed',
      staggerMs: 1500,
      set: (patch) => set((s) => ({ ...s, ...patch })),
    }),
    { name: 'drpg-comic' },
  ),
);

/* ── 任务进度（运行时·供 UI 订阅；漫画生成在后台跑，关掉设置面板不中断）── */
export type ComicPageStatus = 'pending' | 'drawing' | 'ok' | 'fail';
export interface ComicJobPage { page: number; status: ComicPageStatus; error?: string }

interface ComicJobState {
  running: boolean;
  phase: string;               // 当前阶段文案（'' = 空闲）
  pages: ComicJobPage[];
  batchId: string;             // 本次任务产出的批次（完成后 UI 跳转用）
  doneAt: number;              // 最近一次任务结束时间戳（UI 靠它刷新列表）
  start: (phase: string) => void;
  setPhase: (phase: string) => void;
  setPages: (pages: ComicJobPage[]) => void;
  patchPage: (page: number, patch: Partial<ComicJobPage>) => void;
  finish: (phase: string, batchId?: string) => void;
}

export const useComicJob = create<ComicJobState>()((set) => ({
  running: false, phase: '', pages: [], batchId: '', doneAt: 0,
  start: (phase) => set({ running: true, phase, pages: [], batchId: '' }),
  setPhase: (phase) => set({ phase }),
  setPages: (pages) => set({ pages }),
  patchPage: (page, patch) => set((s) => ({ pages: s.pages.map((p) => (p.page === page ? { ...p, ...patch } : p)) })),
  finish: (phase, batchId) => set((s) => ({ running: false, phase, batchId: batchId ?? s.batchId, doneAt: Date.now() })),
}));
