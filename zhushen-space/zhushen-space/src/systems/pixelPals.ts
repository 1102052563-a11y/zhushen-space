// 8 只像素小动物：按 UID 确定性派生（pixelPalIndex = (uid-1) % 8，UID 9 起循环复用）。
// 作消息/名单的「默认头像」——纯 SVG 无素材，零传输（同一 UID 各端算出同一只）。
// data URI 供 <img> 渲染，与「自定义上传头像」统一走 <img>。

const WRAP = (inner: string) =>
  `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">${inner}</svg>`;

const PALS: string[] = [
  // 0 猫（橙）
  WRAP('<polygon points="2,2 6,2 4,6" fill="#F2A35E"/><polygon points="10,2 14,2 12,6" fill="#F2A35E"/><rect x="2" y="4" width="12" height="10" rx="3" fill="#F2A35E"/><rect x="5" y="7" width="2" height="2" fill="#2b2b2b"/><rect x="9" y="7" width="2" height="2" fill="#2b2b2b"/><rect x="7" y="10" width="2" height="1" fill="#E8736A"/>'),
  // 1 狗（棕·垂耳）
  WRAP('<rect x="1" y="4" width="3" height="7" rx="1.5" fill="#8A5A3B"/><rect x="12" y="4" width="3" height="7" rx="1.5" fill="#8A5A3B"/><rect x="3" y="3" width="10" height="11" rx="3" fill="#C8956A"/><rect x="5" y="7" width="2" height="2" fill="#2b2b2b"/><rect x="9" y="7" width="2" height="2" fill="#2b2b2b"/><rect x="7" y="10" width="2" height="2" rx="1" fill="#2b2b2b"/>'),
  // 2 狐（红·白吻）
  WRAP('<polygon points="2,1 6,2 3,6" fill="#E8642E"/><polygon points="10,2 14,1 13,6" fill="#E8642E"/><rect x="2" y="4" width="12" height="10" rx="3" fill="#E8642E"/><rect x="4" y="9" width="8" height="5" rx="2" fill="#fbe7d2"/><rect x="5" y="7" width="2" height="2" fill="#2b2b2b"/><rect x="9" y="7" width="2" height="2" fill="#2b2b2b"/><rect x="7" y="11" width="2" height="1" fill="#2b2b2b"/>'),
  // 3 蛙（绿·凸眼）
  WRAP('<rect x="2" y="5" width="12" height="9" rx="4" fill="#6FBF4E"/><circle cx="5" cy="4" r="2.6" fill="#fff"/><circle cx="11" cy="4" r="2.6" fill="#fff"/><circle cx="5" cy="4" r="1.1" fill="#2b2b2b"/><circle cx="11" cy="4" r="1.1" fill="#2b2b2b"/><rect x="5" y="10" width="6" height="1" fill="#3f8a2e"/>'),
  // 4 熊（褐·圆耳）
  WRAP('<circle cx="4" cy="3" r="2.5" fill="#9A6B4A"/><circle cx="12" cy="3" r="2.5" fill="#9A6B4A"/><rect x="2" y="3" width="12" height="11" rx="4" fill="#9A6B4A"/><rect x="5" y="6" width="2" height="2" fill="#2b2b2b"/><rect x="9" y="6" width="2" height="2" fill="#2b2b2b"/><rect x="5" y="9" width="6" height="4" rx="2" fill="#C9A07E"/><rect x="7" y="10" width="2" height="1.5" rx="0.7" fill="#2b2b2b"/>'),
  // 5 兔（浅·长耳）
  WRAP('<rect x="4" y="0" width="2.6" height="7" rx="1.2" fill="#E8E8EC"/><rect x="9.4" y="0" width="2.6" height="7" rx="1.2" fill="#E8E8EC"/><rect x="4.6" y="1" width="1.3" height="4" rx="0.6" fill="#F3B6C0"/><rect x="10" y="1" width="1.3" height="4" rx="0.6" fill="#F3B6C0"/><rect x="3" y="6" width="10" height="9" rx="4" fill="#E8E8EC"/><rect x="5" y="9" width="2" height="2" fill="#2b2b2b"/><rect x="9" y="9" width="2" height="2" fill="#2b2b2b"/><rect x="7" y="12" width="2" height="1" fill="#F3859A"/>'),
  // 6 熊猫（黑白）
  WRAP('<circle cx="4" cy="3" r="2.3" fill="#2b2b2b"/><circle cx="12" cy="3" r="2.3" fill="#2b2b2b"/><rect x="2" y="3" width="12" height="11" rx="4" fill="#fafafa"/><ellipse cx="5.5" cy="8" rx="1.8" ry="2.2" fill="#2b2b2b"/><ellipse cx="10.5" cy="8" rx="1.8" ry="2.2" fill="#2b2b2b"/><rect x="5" y="7.4" width="1.2" height="1.2" rx="0.6" fill="#fff"/><rect x="10" y="7.4" width="1.2" height="1.2" rx="0.6" fill="#fff"/><rect x="7" y="11" width="2" height="1.2" rx="0.6" fill="#2b2b2b"/>'),
  // 7 小鸡（黄·喙）
  WRAP('<rect x="3" y="3" width="10" height="11" rx="5" fill="#F6D44B"/><rect x="5" y="6" width="1.8" height="2" rx="0.9" fill="#2b2b2b"/><rect x="9.2" y="6" width="1.8" height="2" rx="0.9" fill="#2b2b2b"/><polygon points="7,9 9,9 8,11" fill="#EE9B3A"/><circle cx="3.6" cy="10" r="1" fill="#F2B84B"/><circle cx="12.4" cy="10" r="1" fill="#F2B84B"/>'),
];

export const PIXEL_PAL_COUNT = PALS.length;
export function pixelPalIndex(uid: number): number {
  const n = Math.max(1, Math.floor(uid) || 1);
  return (n - 1) % PALS.length;
}
export function pixelPalSvg(uid: number): string { return PALS[pixelPalIndex(uid)]; }
export function pixelPalDataUri(uid: number): string {
  return `data:image/svg+xml,${encodeURIComponent(pixelPalSvg(uid))}`;
}
