// 聊天 emoji：选择器精选集 + 工具。
// 「统一表情」：把文本里的 emoji 渲染成 Twemoji(CC-BY 4.0 · github.com/jdecked/twemoji) 的 SVG，
//   经 jsDelivr CDN 取（免费）；图加载失败时回退系统原生 emoji（onError），故 CDN 挂了也不影响阅读。

export const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  { label: '表情', emojis: ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😴', '😭', '😡', '😱', '🥰', '😅', '😉', '🙂', '🙃', '😏', '😬', '🤨', '😐', '🙄', '😮', '😢', '😤', '😈', '🤯', '🥳', '😇', '🤗', '🤓'] },
  { label: '手势', emojis: ['👍', '👎', '👌', '✌️', '🤞', '🤙', '👋', '🙏', '💪', '👏', '🙌', '🤝', '✋', '👊', '🫡', '🫶', '👀', '🫵'] },
  { label: '爱心', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💕', '💞', '💖', '💗', '✨', '💫', '⭐', '🔥', '💯'] },
  { label: '动物', emojis: ['🐱', '🐶', '🦊', '🐸', '🐻', '🐰', '🐼', '🐔', '🐲', '🦄', '🐉', '🐺', '🦁', '🐯', '🐹', '🐮'] },
  { label: '食物', emojis: ['🍎', '🍉', '🍔', '🍕', '🍜', '🍣', '🍰', '🍺', '🍵', '☕', '🍗', '🍙', '🍦', '🍫'] },
  { label: '玩梗', emojis: ['⚔️', '🛡️', '🏆', '🎯', '🎮', '🎲', '🎉', '🎁', '💎', '💰', '🗡️', '🏹', '🔮', '📜', '🧪', '💀'] },
  { label: '符号', emojis: ['✅', '❌', '❓', '❗', '💢', '💤', '🚫', '⚠️', '🆗', '☯️', '♻️', '🔔', '🩸', '☠️', '➕', '➖'] },
];
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'];   // 快捷回应条

// 匹配文本里的 emoji（基础象形符 + 可选 ZWJ 连接序列 + 可选变体选择符/keycap；或两位国旗区域指示符）。
// 每次新建，避免 g 标志的 lastIndex 状态污染。
export function emojiRegex(): RegExp {
  return new RegExp(
    '(\\p{Extended_Pictographic}(\\u200d\\p{Extended_Pictographic})*[\\ufe0f\\u20e3]?|[\\u{1f1e6}-\\u{1f1ff}]{2})',
    'gu',
  );
}

// emoji → Twemoji SVG 地址（codepoint 十六进制连字符；去掉单独的变体选择符 fe0f，保留 ZWJ 200d）。
export function twemojiUrl(emoji: string): string {
  const cps: string[] = [];
  for (const ch of emoji) cps.push(ch.codePointAt(0)!.toString(16));
  const parts = cps.length > 1 ? cps.filter((c) => c !== 'fe0f') : cps;
  return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${parts.join('-')}.svg`;
}
