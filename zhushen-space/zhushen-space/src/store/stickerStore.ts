import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* 😊 表情包库 —— drpg-stickers（借鉴 Abstract外置手机「按名点播」思想·代码全自写）
   - 玩家自建素材库：名称→图片URL（外链或 data:URI）；本项目不内置任何表情包图片（无素材=不硬造）
   - AI 侧只见名称清单（私聊/群聊注入），回复用「贴: 名称」发表情包；前端按名解析成图
   - 双保险：提示词约束「只能用列表内」+ 消费侧硬过滤（名称不在库→整条丢弃）
   - 配置类 store：不给 clear（新游戏保留——表情包是玩家资产不是进度）*/

export interface StickerItem { id: string; name: string; url: string }

interface StickerState {
  items: StickerItem[];
  addSticker: (name: string, url: string) => { ok: boolean; error?: string };
  removeSticker: (id: string) => void;
  renameSticker: (id: string, name: string) => void;
}

const CAP = 200;

export const useStickers = create<StickerState>()(
  persist(
    (set, get): StickerState => ({
      items: [],
      addSticker: (name, url) => {
        const nm = (name || '').trim().slice(0, 20);
        const u = (url || '').trim();
        if (!nm) return { ok: false, error: '名称不能为空' };
        if (!/^(https?:\/\/|data:image\/|\/)/i.test(u)) return { ok: false, error: 'URL 须是 http(s)/data:image/本站路径' };
        if (get().items.length >= CAP) return { ok: false, error: `表情包已达上限 ${CAP} 个` };
        if (get().items.some((x) => x.name === nm)) return { ok: false, error: `已有同名表情包「${nm}」` };
        set((s) => ({ items: [...s.items, { id: `st_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: nm, url: u }] }));
        return { ok: true };
      },
      removeSticker: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
      renameSticker: (id, name) => {
        const nm = (name || '').trim().slice(0, 20);
        if (!nm) return;
        set((s) => (s.items.some((x) => x.id !== id && x.name === nm) ? s : { items: s.items.map((x) => (x.id === id ? { ...x, name: nm } : x)) }));
      },
    }),
    { name: 'drpg-stickers', version: 1 },
  ),
);

/* 名称集合（消费侧硬过滤用）与注入清单（AI 侧）*/
export function stickerNameSet(): Set<string> {
  return new Set(useStickers.getState().items.map((x) => x.name));
}
export function stickerUrlOf(name: string): string | undefined {
  return useStickers.getState().items.find((x) => x.name === name)?.url;
}
/* 注入块：库空返回 ''（零 token）；名称清单夹到 cap 个 */
export function buildStickerInjection(cap = 60): string {
  const names = useStickers.getState().items.slice(0, cap).map((x) => x.name);
  if (!names.length) return '';
  return `\n【表情包库】可用表情包名称（想发表情包时用一行「贴: 名称」）：${names.join('、')}\n- 只能用上面列出的名称，禁止自创；尽量别连续重复用同一个。`;
}
