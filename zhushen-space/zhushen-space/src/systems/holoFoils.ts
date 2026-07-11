/**
 * 全息卡箔纸配置（仿 pokemon-cards-css，纯自写 CSS+SVG 规避 GPL/素材授权）。
 * 为「物品 15 品级」+「人物 14 阶位」各定义一套箔纸，含：色带 / 花纹 / 卡框 / 宝石 / 华丽度 / 名字艺术字风格。
 *
 * 铁则（见记忆 holo-card-feature）：**低阶亮、高阶暗**——每档由自己颜色主导整卡，越高阶越暗越鎏金越繁复。
 * 多维区分：色 · 箔纹(柔光/直纹/交织/星芒/星空) · 框华丽度 0-4 · 冠冕随阶 · 异形宝石(圆/六边/菱/星)。
 *
 * 组件 HoloCard 消费本文件：foilForGrade/foilForTier 取箔 → shineCss/cardBg/frameSvg/artClass 出样式。
 */
import { type ItemGrade } from '../store/itemStore';
import { TIERS, normalizeTier } from './derivedStats';

export type FoilPattern = 'sheen' | 'bars' | 'weave' | 'burst' | 'cosmos';
export type GemShape = 'none' | 'circle' | 'hex' | 'diamond' | 'star';
export type ArtStyle = 'silver' | 'jade' | 'teal' | 'ice' | 'indigo' | 'violet' | 'fuchsia' | 'gold' | 'crimson' | 'rainbow';

export interface HoloFoil {
  cols: string[];        // 箔纸色带（随指针平移产生流光）
  pattern: FoilPattern;  // 箔纸花纹
  accent: string;        // 主色（辉光 / 眼 / 冠 / 卡框外光）
  a1: string;            // 卡框亮色
  a2: string;            // 卡框暗色 / 描边 / 卡边框
  gem: string;           // 宝石色
  rich: 0 | 1 | 2 | 3 | 4; // 华丽度 → 框繁复度 + 背景暗度 + 光环 + 冠冕
  art: ArtStyle;         // 名字艺术字风格（对应 index.css .an-<art>）
}

/* ── 程序化纹理（一次生成，全卡共用；SVG feTurbulence 噪点 + 阈值化亮片） ── */
const grainSvg = "<svg xmlns='http://www.w3.org/2000/svg' width='150' height='210'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#g)'/></svg>";
const glitSvg = "<svg xmlns='http://www.w3.org/2000/svg' width='140' height='196'><filter id='s'><feTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='1' seed='9' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 1.5 0 0 0 -0.95'/></filter><rect width='100%' height='100%' filter='url(#s)'/></svg>";
export const GRAIN_URI = `url("data:image/svg+xml,${encodeURIComponent(grainSvg)}")`;
export const GLIT_URI = `url("data:image/svg+xml,${encodeURIComponent(glitSvg)}")`;

/* ══════════════ 物品 15 品级（白色 → 创世） ══════════════ */
export const GRADE_FOILS: Record<ItemGrade, HoloFoil> = {
  白色:   { cols: ['#f1f5f9', '#ffffff', '#cbd5e1'], pattern: 'sheen', accent: '#94a3b8', a1: '#eef2f7', a2: '#64748b', gem: '#94a3b8', rich: 0, art: 'silver' },
  绿色:   { cols: ['#6ee7b7', '#34d399', '#a7f3d0'], pattern: 'bars',  accent: '#10b981', a1: '#a7f3d0', a2: '#0f766e', gem: '#059669', rich: 0, art: 'jade' },
  蓝色:   { cols: ['#7dd3fc', '#38bdf8', '#e0f2fe'], pattern: 'bars',  accent: '#0284c7', a1: '#bae6fd', a2: '#075985', gem: '#0284c7', rich: 1, art: 'ice' },
  紫色:   { cols: ['#d8b4fe', '#c084fc', '#f3e8ff'], pattern: 'weave', accent: '#9333ea', a1: '#e9d5ff', a2: '#6b21a8', gem: '#9333ea', rich: 1, art: 'violet' },
  暗紫色: { cols: ['#a78bfa', '#8b5cf6', '#ddd6fe'], pattern: 'bars',  accent: '#6d28d9', a1: '#c4b5fd', a2: '#4c1d95', gem: '#6d28d9', rich: 1, art: 'violet' },
  淡金:   { cols: ['#fde68a', '#fcd34d', '#fffbeb'], pattern: 'sheen', accent: '#d97706', a1: '#fef08a', a2: '#b45309', gem: '#d97706', rich: 1, art: 'gold' },
  金色:   { cols: ['#fde047', '#facc15', '#fff7cc'], pattern: 'bars',  accent: '#ca8a04', a1: '#fde047', a2: '#a16207', gem: '#ca8a04', rich: 2, art: 'gold' },
  暗金:   { cols: ['#f59e0b', '#fbbf24', '#d97706', '#7c2d12'], pattern: 'weave', accent: '#b45309', a1: '#fcd34d', a2: '#7c2d12', gem: '#b45309', rich: 2, art: 'gold' },
  传说级: { cols: ['#fb923c', '#fdba74', '#f59e0b', '#9a3412'], pattern: 'burst', accent: '#c2410c', a1: '#fed7aa', a2: '#9a3412', gem: '#c2410c', rich: 2, art: 'crimson' },
  史诗级: { cols: ['#fb7185', '#f472b6', '#c084fc', '#9f1239'], pattern: 'weave', accent: '#e11d48', a1: '#fecdd3', a2: '#9f1239', gem: '#e11d48', rich: 2, art: 'crimson' },
  圣灵级: { cols: ['#5eead4', '#99f6e4', '#2dd4bf', '#0d9488'], pattern: 'burst', accent: '#0d9488', a1: '#99f6e4', a2: '#115e59', gem: '#0d9488', rich: 3, art: 'teal' },
  不朽级: { cols: ['#a5b4fc', '#818cf8', '#6366f1', '#312e81'], pattern: 'weave', accent: '#4f46e5', a1: '#c7d2fe', a2: '#3730a3', gem: '#4f46e5', rich: 3, art: 'indigo' },
  起源:   { cols: ['#f0abfc', '#e879f9', '#c026d3', '#701a75'], pattern: 'burst', accent: '#c026d3', a1: '#f5d0fe', a2: '#86198f', gem: '#c026d3', rich: 3, art: 'fuchsia' },
  永恒:   { cols: ['#67e8f9', '#22d3ee', '#06b6d4', '#155e75'], pattern: 'weave', accent: '#0891b2', a1: '#a5f3fc', a2: '#155e75', gem: '#0891b2', rich: 3, art: 'teal' },
  创世:   { cols: ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'], pattern: 'cosmos', accent: '#f59e0b', a1: '#fde68a', a2: '#b45309', gem: '#f472b6', rich: 4, art: 'rainbow' },
};

/* ══════════════ 人物 14 阶位（一阶 → 无上之境） ══════════════ */
type TierName = (typeof TIERS)[number];
export const TIER_FOILS: Record<TierName, HoloFoil> = {
  一阶:     { cols: ['#fffaf0', '#f5f3ea', '#e8e0c8'], pattern: 'sheen', accent: '#b8a878', a1: '#f5f3ea', a2: '#8a7f5c', gem: '#b8a878', rich: 0, art: 'silver' },
  二阶:     { cols: ['#e2e8f0', '#cbd5e1', '#94a3b8'], pattern: 'weave', accent: '#64748b', a1: '#cbd5e1', a2: '#475569', gem: '#64748b', rich: 0, art: 'silver' },
  三阶:     { cols: ['#6ee7b7', '#34d399', '#a7f3d0'], pattern: 'bars',  accent: '#059669', a1: '#a7f3d0', a2: '#047857', gem: '#059669', rich: 0, art: 'jade' },
  四阶:     { cols: ['#34d399', '#10b981', '#6ee7b7'], pattern: 'bars',  accent: '#047857', a1: '#6ee7b7', a2: '#065f46', gem: '#047857', rich: 1, art: 'jade' },
  五阶:     { cols: ['#5eead4', '#2dd4bf', '#99f6e4'], pattern: 'weave', accent: '#0d9488', a1: '#5eead4', a2: '#115e59', gem: '#0d9488', rich: 1, art: 'teal' },
  六阶:     { cols: ['#67e8f9', '#22d3ee', '#cffafe'], pattern: 'bars',  accent: '#0891b2', a1: '#67e8f9', a2: '#155e75', gem: '#0891b2', rich: 2, art: 'ice' },
  七阶:     { cols: ['#7dd3fc', '#38bdf8', '#e0f2fe'], pattern: 'weave', accent: '#0284c7', a1: '#7dd3fc', a2: '#075985', gem: '#0284c7', rich: 2, art: 'ice' },
  八阶:     { cols: ['#38bdf8', '#22d3ee', '#a5f3fc', '#0ea5e9'], pattern: 'burst', accent: '#0369a1', a1: '#7dd3fc', a2: '#0c4a6e', gem: '#0369a1', rich: 3, art: 'indigo' },
  九阶:     { cols: ['#0ea5e9', '#0284c7', '#38bdf8', '#0c4a6e'], pattern: 'weave', accent: '#075985', a1: '#7dd3fc', a2: '#0c4a6e', gem: '#075985', rich: 3, art: 'indigo' },
  绝强:     { cols: ['#fde68a', '#f59e0b', '#facc15', '#92400e'], pattern: 'burst', accent: '#b45309', a1: '#fde68a', a2: '#92400e', gem: '#b45309', rich: 3, art: 'gold' },
  巅峰绝强: { cols: ['#fcd34d', '#d97706', '#f59e0b', '#7c2d12'], pattern: 'weave', accent: '#92400e', a1: '#fcd34d', a2: '#7c2d12', gem: '#92400e', rich: 3, art: 'gold' },
  至强:     { cols: ['#c084fc', '#a855f7', '#7c3aed', '#581c87'], pattern: 'burst', accent: '#7e22ce', a1: '#d8b4fe', a2: '#581c87', gem: '#7e22ce', rich: 3, art: 'violet' },
  巅峰至强: { cols: ['#fb923c', '#f97316', '#ef4444', '#7c2d12'], pattern: 'cosmos', accent: '#dc2626', a1: '#fdba74', a2: '#7c2d12', gem: '#dc2626', rich: 3, art: 'crimson' },
  无上之境: { cols: ['#fef3c7', '#fbbf24', '#f472b6', '#a78bfa', '#60a5fa', '#34d399', '#fbbf24'], pattern: 'cosmos', accent: '#f59e0b', a1: '#fde68a', a2: '#b45309', gem: '#f472b6', rich: 4, art: 'rainbow' },
};

/* ── 解析器（品级按「更具体在前」，阶位走 normalizeTier；均含噪声容错） ── */
const GRADE_MATCH: [string, ItemGrade][] = [
  ['创世', '创世'], ['永恒', '永恒'], ['起源', '起源'], ['不朽', '不朽级'], ['圣灵', '圣灵级'],
  ['史诗', '史诗级'], ['传说', '传说级'], ['暗金', '暗金'], ['淡金', '淡金'], ['金', '金色'],
  ['暗紫', '暗紫色'], ['紫', '紫色'], ['蓝', '蓝色'], ['绿', '绿色'], ['白', '白色'],
];

export function foilForGrade(grade?: string): HoloFoil {
  const g = String(grade ?? '');
  for (const [kw, key] of GRADE_MATCH) if (g.includes(kw)) return GRADE_FOILS[key];
  return GRADE_FOILS['白色'];
}
export function foilForTier(tier?: string): HoloFoil {
  const t = normalizeTier(tier) as TierName;
  return TIER_FOILS[t] ?? TIER_FOILS['一阶'];
}
export function foilFor(opts: { grade?: string; tier?: string }): HoloFoil {
  if (opts.grade && GRADE_MATCH.some(([kw]) => String(opts.grade).includes(kw))) return foilForGrade(opts.grade);
  if (opts.tier) return foilForTier(opts.tier);
  return GRADE_FOILS['白色'];
}

/* ── 纯样式构造器（供 HoloCard 渲染） ── */

/** hex 向白(f>0)/黑(f<0)混色，返回 rgb()。 */
export function shade(hex: string, f: number): string {
  const h = hex.replace('#', '');
  let r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { const k = -f; r *= 1 - k; g *= 1 - k; b *= 1 - k; }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

/** 卡面底色渐变：低阶亮、高阶暗（每档由自己颜色主导）。 */
export function cardBg(f: HoloFoil): string {
  const top = shade(f.cols[0], f.rich <= 1 ? 0.3 : 0.08);
  const mid = shade(f.cols[0], -(0.12 + f.rich * 0.14));
  const bot = f.rich >= 3 ? '#0a0812' : shade(f.cols[0], -(0.34 + f.rich * 0.12));
  return `linear-gradient(165deg,${top} 0%,${mid} 46%,${bot} 100%)`;
}

/** 箔纸花纹 → background-image + size。 */
export function shineCss(f: HoloFoil): { backgroundImage: string; backgroundSize: string } {
  const cols = f.cols;
  const b = (w: number, an: number, al = '') => `repeating-linear-gradient(${an}deg,${cols.map((c, i) => `${c}${al} ${i * w}% ${(i + 1) * w}%`).join(',')})`;
  switch (f.pattern) {
    case 'sheen': return { backgroundImage: `linear-gradient(115deg,transparent 30%,${cols[0]}66 45%,#ffffffcc 50%,${cols[0]}66 55%,transparent 70%)`, backgroundSize: '300% 300%' };
    case 'weave': return { backgroundImage: `${b(6, 58)},${b(6, -58, '88')}`, backgroundSize: '200% 200%,200% 200%' };
    case 'burst': return { backgroundImage: `conic-gradient(from 0deg at 50% 42%,${cols.concat([cols[0]]).map((c, i, a) => `${c} ${Math.round(i * 360 / (a.length - 1))}deg`).join(',')})`, backgroundSize: '250% 250%' };
    case 'cosmos': return { backgroundImage: `${b(4, 74)},radial-gradient(circle at 50% 40%,#ffffff55,rgba(255,255,255,0) 45%)`, backgroundSize: '240% 240%,180% 180%' };
    default: return { backgroundImage: b(5, 78), backgroundSize: '220% 220%' };
  }
}

const GEM_OF: Record<FoilPattern, GemShape> = { sheen: 'none', bars: 'circle', weave: 'hex', burst: 'diamond', cosmos: 'star' };

function gemMark(shape: GemShape, cx: number, cy: number, r: number, gem: string, id: string): string {
  let body: string;
  if (shape === 'diamond') body = `<path d='M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z' fill='${gem}'/>`;
  else if (shape === 'hex') body = `<path d='M${cx - r} ${cy} L${(cx - r / 2).toFixed(1)} ${(cy - r * 0.87).toFixed(1)} L${(cx + r / 2).toFixed(1)} ${(cy - r * 0.87).toFixed(1)} L${cx + r} ${cy} L${(cx + r / 2).toFixed(1)} ${(cy + r * 0.87).toFixed(1)} L${(cx - r / 2).toFixed(1)} ${(cy + r * 0.87).toFixed(1)} Z' fill='${gem}'/>`;
  else if (shape === 'star') { let p = ''; for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r; p += `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)} `; } body = `<polygon points='${p}' fill='${gem}'/>`; }
  else body = `<circle cx='${cx}' cy='${cy}' r='${r}' fill='${gem}'/>`;
  return `${body}<circle cx='${cx}' cy='${cy}' r='${r}' fill='none' stroke='url(#${id})' stroke-width='1.4'/><circle cx='${(cx - r * 0.35).toFixed(1)}' cy='${(cy - r * 0.35).toFixed(1)}' r='1.3' fill='#fff' opacity='.85'/>`;
}

/** 卡框 SVG（viewBox 150×210；华丽度越高越繁复；uid 保证渐变 id 唯一）。 */
export function frameSvg(f: HoloFoil, uid: string): string {
  const id = `hf${uid}`, { a1, a2, gem, rich } = f;
  let s = `<svg viewBox='0 0 150 210' preserveAspectRatio='none' style='position:absolute;inset:0;width:100%;height:100%'>`;
  s += `<defs><linearGradient id='${id}' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='${a1}'/><stop offset='50%' stop-color='${a2}'/><stop offset='100%' stop-color='${a1}'/></linearGradient></defs>`;
  s += `<rect x='3' y='3' width='144' height='204' rx='11' fill='none' stroke='url(#${id})' stroke-width='${rich >= 1 ? 3.5 : 2.5}'/>`;
  if (rich >= 1) s += `<rect x='8.5' y='8.5' width='133' height='193' rx='8' fill='none' stroke='${a1}' stroke-width='0.9' opacity='.6'/>`;
  if (rich >= 2) ([[9, 9, 1, 1], [141, 9, -1, 1], [9, 201, 1, -1], [141, 201, -1, -1]] as const).forEach(([x, y, sx, sy]) => {
    s += `<path d='M${x} ${y + sy * 15} q0 ${-sy * 9} ${sx * 9} ${-sy * 9}' fill='none' stroke='${a1}' stroke-width='1.5'/>`;
    if (rich >= 3) s += `<circle cx='${x}' cy='${y}' r='1.7' fill='${a1}'/>`;
  });
  if (rich >= 2) s += gemMark(GEM_OF[f.pattern], 126, 23, 7, gem, id);
  if (rich >= 4) s += `<path d='M75 5 l4 6 l-4 6 l-4 -6 z' fill='${a1}'/>`;
  s += `</svg>`;
  return s;
}

/** 名字艺术字 class（对应 index.css）。 */
export function artClass(f: HoloFoil): string { return `an-${f.art}`; }
