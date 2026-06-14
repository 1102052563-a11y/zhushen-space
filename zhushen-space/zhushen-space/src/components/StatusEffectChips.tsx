import { useState } from 'react';
import type { StatusEffect } from '../store/playerStore';

/* 限时状态胶囊：展示 buff/debuff + 时效，点击展开效果/来源，✕ 手动移除。
   引擎会按回合/游戏时间自动过期，这里只负责展示与手动清除。 */

const TONE_CLS: Record<string, string> = {
  buff:    'border-emerald-600/50 text-emerald-300 bg-emerald-900/15',
  debuff:  'border-rose-600/50 text-rose-300 bg-rose-900/15',
  neutral: 'border-amber-600/50 text-amber-300 bg-amber-900/15',
};
/* 没给 tone 时按 类型/名称/效果 关键词猜 */
function toneOf(e: StatusEffect): string {
  if (e.tone) return e.tone;
  const t = (e.type ?? '') + e.name + (e.effect ?? '');
  if (/增益|buff/i.test(e.type ?? '')) return 'buff';
  if (/减益|debuff|控制|持续伤害|异常|负面/i.test(e.type ?? '')) return 'debuff';
  if (/毒|伤|虚弱|流血|眩晕|减|降|冻|灼|诅咒|恐惧|疲惫|衰弱/.test(t)) return 'debuff';
  if (/增|强化|加速|护盾|回复|提升|狂暴|祝福|再生/.test(t)) return 'buff';
  return 'neutral';
}
function durLabel(e: StatusEffect): string {
  if (e.durationDesc) return e.durationDesc;
  if (e.durationTurns != null) return `${e.durationTurns}回合`;
  return '';
}

export default function StatusEffectChips({ effects, onRemove }: { effects: StatusEffect[]; onRemove?: (name: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!effects || effects.length === 0) return <span className="text-[12px] text-dim/40">（无限时状态）</span>;
  // 最多显示约 4 个，超过则用滑窗（限高 + 纵向滚动）
  const scroll = effects.length > 4;
  return (
    <div className={`flex flex-wrap gap-1.5 ${scroll ? 'max-h-[4.75rem] overflow-y-auto onscene-scroll pr-1' : ''}`}>
      {effects.map((e) => {
        const cls = TONE_CLS[toneOf(e)] ?? TONE_CLS.neutral;
        const d = durLabel(e);
        const expanded = open === e.id;
        return (
          <div key={e.id} className="inline-flex flex-col">
            <button onClick={() => setOpen(expanded ? null : e.id)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[12px] font-mono ${cls}`}>
              {e.emoji && <span>{e.emoji}</span>}
              <span>{e.name}</span>
              {d && <span className="opacity-70">· ⏳{d}</span>}
            </button>
            {expanded && (
              <div className="mt-1 ml-1 text-[11px] text-dim/80 leading-relaxed border-l-2 border-edge pl-2 max-w-[16rem]">
                {e.type && <div className="text-dim/55">类型·{e.type}</div>}
                {e.effect && <div>效果·{e.effect}</div>}
                {e.desc && <div className="text-dim/70">描述·{e.desc}</div>}
                {e.source && <div className="text-dim/55">来源·{e.source}</div>}
                {e.tags && e.tags.length > 0 && <div className="text-dim/55">标签·{e.tags.join('/')}</div>}
                {d && <div className="text-dim/55">时效·{d}</div>}
                {onRemove && (
                  <button onClick={() => { onRemove(e.name); setOpen(null); }}
                    className="mt-0.5 text-[11px] text-blood/60 hover:text-blood transition-colors">移除</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
