import { parseBioChips, bioFxClass, bioVarClass } from '../systems/bioStrength';

/* 生物强度徽章：把「资质T0·杂鱼 / 战力T1·兵卒」渲染成一档一色的小胶囊徽章（T0~T16 十七档色阶）。
   纯展示层——档位判定仍归 systems/bioStrength.ts，本组件只解析文本 + 套 CSS 挂钩（index.css `.bio-chip/.bio-b*`）。
   - text 吃 bioStrengthLabel 的输出，也吃旧存档 npc.bioStrength 的自由文本；认不出档位的原样回退纯文字（不猜档）
   - size: sm = 面板（主角侧栏 / NPC 详情） · xs = 列表行（临时队伍 / 分享卡）
   - fallback: text 为空时显示的占位文字（不传则整体不渲染） */
export default function BioBadge({ text, size = 'sm', title, className = '', fallback }: {
  text?: string; size?: 'sm' | 'xs'; title?: string; className?: string; fallback?: string;
}) {
  const chips = parseBioChips(text);
  const fbSize = size === 'xs' ? 'text-[10px]' : 'text-[12px]';
  if (!chips.length) return fallback ? <span className={`${fbSize} font-mono text-dim/40 ${className}`}>{fallback}</span> : null;
  const shell = size === 'xs' ? 'px-1.5 py-[1px] gap-1' : 'px-2 py-[2px] gap-1.5';
  const nameSize = size === 'xs' ? 'text-[11px]' : 'text-[12.5px]';
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`} title={title}>
      {chips.map((c, i) => c.num < 0
        ? <span key={i} className={`${nameSize} font-mono text-amber-300/70`}>{c.raw}</span>
        : (
          <span key={i} className={`bio-chip ${bioVarClass(c.num)} ${shell}`}>
            <i className="bio-pip" />
            {c.kind && <span className="bio-chip-k">{c.kind}</span>}
            <span className="bio-chip-t">{c.code}</span>
            <span className={`${bioFxClass(c.num)} ${nameSize} font-bold`}>{c.name}</span>
          </span>
        ))}
    </span>
  );
}
