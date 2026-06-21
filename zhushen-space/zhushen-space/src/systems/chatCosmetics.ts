// 聊天个性化：名牌颜色（他人可见·随 WS 连接广播）+ 气泡皮肤（本地视图偏好）。
// 名牌色板取自 Open Color (MIT · https://github.com/yeun/open-color) 的 shade-4 精选；
// 颜色值（hex）本身不受版权约束，此处仅借其精挑的、在深色背景上清晰的一组。

const NC_KEY = 'drpg-chat-nc';
const BUBBLE_KEY = 'drpg-chat-bubble';

export function chatNameColor(): string { try { return localStorage.getItem(NC_KEY) || ''; } catch { return ''; } }
export function setChatNameColor(c: string): void { try { if (c) localStorage.setItem(NC_KEY, c); else localStorage.removeItem(NC_KEY); } catch { /* */ } }
export function chatBubble(): string { try { return localStorage.getItem(BUBBLE_KEY) || 'none'; } catch { return 'none'; } }
export function setChatBubble(id: string): void { try { localStorage.setItem(BUBBLE_KEY, id); } catch { /* */ } }

// 名牌可选色（Open Color shade-4，深色聊天背景上清晰）。'' = 默认(按编号确定性配色)。
export const NAME_COLORS: string[] = [
  '#ff8787', // red
  '#faa2c1', // pink
  '#e599f7', // grape
  '#b197fc', // violet
  '#91a7ff', // indigo
  '#74c0fc', // blue
  '#66d9e8', // cyan
  '#63e6be', // teal
  '#8ce99a', // green
  '#c0eb75', // lime
  '#ffe066', // yellow
  '#ffc078', // orange
  '#ced4da', // gray
];

// 气泡皮肤（本地视图）：应用到自己看到的文本消息。
export interface BubbleSkin { id: string; label: string; cls: string }
export const BUBBLE_SKINS: BubbleSkin[] = [
  { id: 'none', label: '默认', cls: '' },
  { id: 'soft', label: '柔和', cls: 'inline-block bg-panel2/70 rounded-lg px-2 py-0.5' },
  { id: 'glass', label: '玻璃', cls: 'inline-block bg-white/5 backdrop-blur-sm rounded-xl px-2.5 py-0.5 border border-white/10' },
  { id: 'neon', label: '霓虹', cls: 'inline-block bg-god/10 rounded-lg px-2 py-0.5 border border-god/40 shadow-[0_0_8px_rgba(110,231,255,0.25)]' },
  { id: 'pixel', label: '像素', cls: 'inline-block bg-panel2 px-2 py-0.5 border-2 border-edge' },
  { id: 'ink', label: '水墨', cls: 'inline-block bg-void/80 rounded-lg px-2 py-0.5 border border-edge' },
];
export function bubbleCls(id: string): string { return (BUBBLE_SKINS.find((b) => b.id === id) || BUBBLE_SKINS[0]).cls; }
