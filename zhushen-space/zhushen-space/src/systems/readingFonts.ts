// 正文阅读字体可选项（外观美化 · 设置→界面外观）。
// default = 沿用现有无衬线（不下载任何字体）；
// kai = 霞鹜文楷（已内置 public/fonts/·分块 woff2 + unicode-range 只下载用到的字形·懒加载，见 App.tsx 注入 LXGW_WENKAI_CSS）；
// song = 系统宋体栈（零下载，回退到系统已装的思源宋体/宋体）。
export type ReadingFontKey = 'default' | 'kai' | 'song';

export const READING_FONTS: Record<ReadingFontKey, { label: string; desc: string; stack: string }> = {
  default: { label: '默认',     desc: '无衬线·原版',     stack: '' },
  kai:     { label: '霞鹜文楷', desc: '楷体·阅读护眼',   stack: '"LXGW WenKai","Kaiti SC","KaiTi","STKaiti",serif' },
  song:    { label: '宋体',     desc: '思源宋体·古典感', stack: '"Noto Serif SC","Source Han Serif SC","Songti SC","STSong","SimSun",serif' },
};

// 霞鹜文楷 webfont：已内置打包（public/fonts/lxgw-wenkai/，97 个分块 woff2 + unicode-range，仅渲染到的字形才下载，离线可用）。由 tools/fetch-lxgw-wenkai.mjs 下载生成。
export const LXGW_WENKAI_CSS = '/fonts/lxgw-wenkai/lxgwwenkai-regular.css';

// 取字体栈；default / 未知 → undefined（即不设 font-family，沿用容器继承的无衬线）
export function readingFontStack(k: ReadingFontKey | undefined): string | undefined {
  return (k && READING_FONTS[k]?.stack) || undefined;
}
