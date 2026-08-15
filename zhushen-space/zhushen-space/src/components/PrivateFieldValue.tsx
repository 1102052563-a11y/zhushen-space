import type { ReactNode } from 'react';

/* 私密词条·复合值渲染（NpcDetail 私密页 + 🔗调教档案 两处共用）：
   AI 常把一个词条写成「A ｜ B ；(部位:乳房) 经验:0/穿环:0次」这类长复合串，直接平铺会糊成一坨。
   本组件：① 按 ；;／被空格包围或全角的竖线｜／句号+空格／换行 拆成多段，每段独立成行；
   ② 段内把 【标签】、(部位:x) 括注、经验:N/穿环:N次/N次/百分比/N/M 这类数值高亮，一眼可扫。
   纯展示、无副作用；不动通用的 SegmentedText（那个别处也在用）。 */

// 段内高亮：【标签】金 / (括注) 蓝 / 数值 琥珀
const HL = /(【[^】]{1,14}】)|([(（][^)）]{1,20}[)）])|(经验[:：]?\s*\d+|穿环[:：]?\s*\d+\s*次?|\d+\s*次|\d+\s*[%％]|\d+\s*\/\s*\d+)/g;

function highlight(s: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  HL.lastIndex = 0;
  while ((m = HL.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1]) out.push(<span key={m.index} className="text-god/70 font-medium">{m[1]}</span>);
    else if (m[2]) out.push(<span key={m.index} className="text-sky-300/70">{m[2]}</span>);
    else out.push(<span key={m.index} className="text-amber-300/80 font-mono">{m[0]}</span>);
    last = m.index + m[0].length;
    if (m[0].length === 0) HL.lastIndex++;   // 防呆：零宽匹配不死循环
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function splitSegs(t: string): string[] {
  return String(t ?? '')
    .replace(/。[ \t　]+/g, '。\n')                        // 句号+空格 → 换行（保留句号）
    .split(/[；;]\s*|\s+\|\s+|\s*｜\s*|\n+/)               // 分号 / 空格包围的半角竖线 / 全角竖线 / 换行
    .map((s) => s.trim())
    .filter(Boolean);
}

export function PrivateFieldValue({ value, tone = 'text-slate-300/90' }: { value: string; tone?: string }) {
  const segs = splitSegs(value);
  if (segs.length <= 1) {
    return <div className={`text-[13px] leading-relaxed whitespace-pre-wrap break-words ${tone}`}>{highlight(String(value ?? ''))}</div>;
  }
  return (
    <ul className="space-y-1">
      {segs.map((s, i) => (
        <li key={i} className="flex gap-1.5 text-[13px] leading-relaxed">
          <span className="shrink-0 text-god/25 select-none mt-[1px]">·</span>
          <span className={`flex-1 break-words ${tone}`}>{highlight(s)}</span>
        </li>
      ))}
    </ul>
  );
}
