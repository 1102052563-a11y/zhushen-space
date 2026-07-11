/**
 * 浏览器内深度估计（Depth Anything V2 · transformers.js + ONNX Runtime Web）。
 * 零后端：按需从 CDN 懒加载库+模型（首次 ~30MB，之后浏览器缓存），WebGPU 优先、否则 WASM。
 * 只有玩家手动点「2.5D 化」时才触发，不进主包、不影响生图。
 */

import { useImageGen } from '../store/imageGenStore';

// 库与模型（如需换版本/模型改这里；latest 3.x）
const TF_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2';
const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';

export type DepthProgress = (info: { stage: string; pct?: number; file?: string }) => void;

let pipeP: Promise<any> | null = null;

async function getPipe(onProgress?: DepthProgress): Promise<any> {
  if (pipeP) return pipeP;
  pipeP = (async () => {
    onProgress?.({ stage: '加载库' });
    const TF: any = await import(/* @vite-ignore */ TF_CDN);
    try {
      TF.env.allowLocalModels = false;
      const mirror = useImageGen.getState().depthHfMirror;
      if (mirror) TF.env.remoteHost = mirror.replace(/\/+$/, '');   // 国内镜像，如 https://hf-mirror.com
    } catch { /* */ }
    const progress_callback = (p: any) => {
      if (!onProgress) return;
      if (p?.status === 'progress') onProgress({ stage: '下载模型', pct: Math.round(p.progress ?? 0), file: p.file });
      else if (p?.status === 'ready') onProgress({ stage: '就绪' });
      else onProgress({ stage: p?.status || '加载中', file: p?.file });
    };
    // ⚠ navigator.gpu 存在 ≠ 能拿到 GPU adapter（用户报错 "Failed to get GPU adapter"）。真去 requestAdapter 才算数。
    let device: 'webgpu' | 'wasm' = 'wasm';
    try {
      const gpu: any = (typeof navigator !== 'undefined') ? (navigator as any).gpu : null;
      if (gpu && (await gpu.requestAdapter())) device = 'webgpu';
    } catch { device = 'wasm'; }
    onProgress?.({ stage: device === 'webgpu' ? '初始化(GPU)' : '初始化(CPU/WASM)' });
    try {
      return await TF.pipeline('depth-estimation', DEPTH_MODEL, { device, progress_callback });
    } catch (e) {
      if (device === 'webgpu') {          // GPU 后端仍失败 → 退回 WASM(CPU)，几乎任何设备都能跑
        onProgress?.({ stage: '切 WASM 重试' });
        return await TF.pipeline('depth-estimation', DEPTH_MODEL, { device: 'wasm', progress_callback });
      }
      throw e;
    }
  })().catch((e) => { pipeP = null; throw e; });   // 失败重置，允许重试
  return pipeP;
}

/* transformers.js 的 RawImage(深度·多为单通道) → PNG dataURL(灰度) */
function rawToDataUrl(raw: any): string | null {
  const w = raw?.width, h = raw?.height, ch = raw?.channels ?? 1, data = raw?.data;
  if (!w || !h || !data) return null;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); if (!ctx) return null;
  const id = ctx.createImageData(w, h);
  for (let i = 0, j = 0; i < w * h; i++) {
    const v = ch === 1 ? data[i] : data[i * ch];
    id.data[j++] = v; id.data[j++] = v; id.data[j++] = v; id.data[j++] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return cv.toDataURL('image/png');
}

/** 本地生成深度图（dataURL）；失败返回 null。 */
export async function localDepth(imgSrc: string, onProgress?: DepthProgress): Promise<string | null> {
  try {
    const pipe = await getPipe(onProgress);
    onProgress?.({ stage: '生成中' });
    const out = await pipe(imgSrc);
    const depth = out?.depth ?? out;
    return rawToDataUrl(depth);
  } catch (e) {
    console.warn('[depthLocal] 失败', e);
    onProgress?.({ stage: '错误：' + String((e as any)?.message || e).slice(0, 140) });
    return null;
  }
}

/** 库是否已加载过（供 UI 判断"是否要下载"） */
export function localModelLoaded(): boolean { return pipeP != null; }
