// 聊天室·图片分享（公共图片区）前端：图片上传到 R2（内容寻址·worker /api/chat/image），
// 聊天里只发 {hash,w,h,caption} 引用（沿用「绝不广播大图」铁则），各端按 hash 取图（公开·长缓存）。
// 「图片分享」固定频道 IMAGE_CHANNEL；从图片库一键分享走 shareImageToChannel（自动连频道再发）。
import { mpBase } from './mpConfig';
import { chatToken, chatName } from './chatIdentity';
import { chatClient } from './chatClient';
import { shrinkDataUrl } from './imageGen';
import type { ChatImageRef } from './chatProtocol';

export const IMAGE_CHANNEL = 'images';   // 「图片分享」频道名（ChatDO cleanChannel 只留 a-z0-9_-）

/** 公开取图地址（hash 内容寻址·worker 端不可变长缓存）。 */
export function chatImageUrl(hash: string): string { return `${mpBase()}/api/chat/image/${hash}`; }

function dataUrlToBlob(dataUrl: string): Blob {
  const m = dataUrl.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!m) throw new Error('不是有效的图片数据');
  const bin = atob(m[2]);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: m[1] });
}
function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('读图失败'));
    r.readAsDataURL(b);
  });
}
function measure(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res({ w: im.naturalWidth || im.width || 0, h: im.naturalHeight || im.height || 0 });
    im.onerror = () => res({ w: 0, h: 0 });
    im.src = dataUrl;
  });
}

/** 上传一张图到公共区（自动缩到 ≤1600px 控体积；gif 不缩以保动图）。返回 {hash,w,h} 供发消息引用。 */
export async function uploadChatImage(dataUrl: string, name: string): Promise<{ hash: string; w: number; h: number }> {
  const tok = chatToken();
  if (!tok) throw new Error('请先在「交流室」登录并进入一次（上传需要聊天身份）');
  let url = dataUrl;
  if (/^https?:\/\//i.test(url)) {   // http(s) 图先取回本地字节（失败多半是跨域）
    const res = await fetch(url);
    if (!res.ok) throw new Error('远程图片下载失败');
    url = await blobToDataUrl(await res.blob());
  }
  if (!url.startsWith('data:image/')) throw new Error('不是图片数据');
  if (!url.startsWith('data:image/gif')) url = await shrinkDataUrl(url, 1600, 0.85);
  const blob = dataUrlToBlob(url);
  const { w, h } = await measure(url);
  const res = await fetch(`${mpBase()}/api/chat/image?name=${encodeURIComponent((name || '图片').slice(0, 60))}`, {
    method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg', Authorization: 'Bearer ' + tok }, body: blob,
  });
  const j = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(j.error || '上传失败');
  return { hash: j.hash, w, h };
}

/** 公共图池（所有人上传的·按 hash 去重·最近优先）。无需登录；后端未部署/离线返回空。 */
export async function listPublicChatImages(): Promise<{ hash: string; name?: string; at?: number }[]> {
  try {
    const res = await fetch(`${mpBase()}/api/chat/images?scope=public`);
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j.images) ? j.images : [];
  } catch { return []; }
}

/** 从「我的」删除一张（只删自己的索引；R2 对象留作他人共用）。 */
export async function deleteMyChatImage(hash: string): Promise<void> {
  const tok = chatToken();
  if (!tok) return;
  try { await fetch(`${mpBase()}/api/chat/image/${hash}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } }); } catch { /* */ }
}

function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (cond()) { clearInterval(timer); res(); }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(timer); rej(new Error('连接聊天室超时，请先打开交流室确认能进入')); }
    }, 200);
  });
}

/** 一键分享到「图片分享」频道（图片库/其它入口用）：上传 → 确保连上频道 → 发送引用。 */
export async function shareImageToChannel(dataUrl: string, caption: string): Promise<void> {
  const tok = chatToken();
  if (!tok) throw new Error('请先到右侧导航「交流室」登录并进入一次，再来分享');
  const cap = (caption || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const up = await uploadChatImage(dataUrl, cap || '分享图片');
  if (!chatClient.isOpen() || chatClient.channel() !== IMAGE_CHANNEL) {
    chatClient.connect(chatName() || '道友', tok, IMAGE_CHANNEL);
    await waitFor(() => chatClient.isOpen() && chatClient.channel() === IMAGE_CHANNEL, 8000);
  }
  const ref: ChatImageRef = { hash: up.hash, ...(up.w ? { w: up.w } : {}), ...(up.h ? { h: up.h } : {}), ...(cap ? { caption: cap } : {}) };
  if (!chatClient.image(ref)) throw new Error('发送失败：聊天连接不可用');
}
