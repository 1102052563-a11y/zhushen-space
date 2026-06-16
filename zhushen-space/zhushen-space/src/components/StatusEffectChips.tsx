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
/* 仅「数字+单位」的短时长才进胶囊（3回合/5分钟…）；条件式解除（"重新接战后解除"等长文本）不塞进胶囊，
   否则会把小圆胶囊撑爆、文字挤成一团，改放到展开区显示。 */
function durShort(e: StatusEffect): string {
  if (e.durationTurns != null) return `${e.durationTurns}回合`;
  const d = (e.durationDesc ?? '').trim();
  return /^\d+\s*(回合|分钟|小时|天|秒|分|时)$/.test(d) ? d : '';
}

/* ── 超长/永久时效：纯显示层折叠（不改底层数据，到点照常过期）──
   AI 常把"很持久"写成几百回合（一局根本走不完），胶囊刷个 ⏳300回合 又丑又没意义；
   ≥LONG_TURNS 回合、或本就无任何时限的状态，统一显示成「♾ 长期/永久」。 */
const LONG_TURNS = 100;   // 超过这么多回合即视作"长期"（仅显示，可调）
const INDEFINITE_RE = /永久|永远|长期|永续|永恒|不限|无限|terminal|permanent/i;
function isLongPerm(e: StatusEffect): boolean {
  if (e.durationTurns != null && e.durationTurns >= LONG_TURNS) return true;   // 超长回合 → 长期
  if (e.durationTurns == null && e.expireAtMin == null) {
    const d = (e.durationDesc ?? '').trim();
    // 无任何回合/时间上限：只有"明确永久/长期"或"完全没写时长"才当长期；带条件文本(如"重新接战后解除")保持条件显示
    return d === '' || INDEFINITE_RE.test(d);
  }
  return false;
}
function permWord(e: StatusEffect): string {
  return /永久|永远|永续|永恒|permanent/i.test(e.durationDesc ?? '') ? '永久' : '长期';
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
        const ds = durShort(e);   // 进胶囊的短时长（无则不显示长条件，避免挤）
        const perm = isLongPerm(e);   // 超长/永久 → 显示「♾ 长期」而非倒计时大数字
        const expanded = open === e.id;
        return (
          <div key={e.id} className="inline-flex flex-col">
            <button onClick={() => setOpen(expanded ? null : e.id)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[12px] font-mono whitespace-nowrap ${cls} ${expanded ? 'ring-1 ring-god/40' : ''}`}>
              {e.emoji && <span>{e.emoji}</span>}
              <span>{e.name}</span>
              {perm
                ? <span className="opacity-70" title={d || undefined}>· ♾{permWord(e)}</span>
                : ds ? <span className="opacity-70">· ⏳{ds}</span> : (d && <span className="opacity-60" title={d}>· ⏳…</span>)}
            </button>
            {expanded && (
              <div className="mt-1 ml-1 text-[11px] text-dim/80 leading-relaxed border-l-2 border-edge pl-2 max-w-[16rem]">
                {e.type && <div className="text-dim/55">类型·{e.type}</div>}
                {e.effect && <div>效果·{e.effect}</div>}
                {e.desc && <div className="text-dim/70">描述·{e.desc}</div>}
                {e.source && <div className="text-dim/55">来源·{e.source}</div>}
                {e.tags && e.tags.length > 0 && <div className="text-dim/55">标签·{e.tags.join('/')}</div>}
                {perm
                  ? <div className="text-dim/55">时效·{permWord(e)}{e.durationTurns != null && e.durationTurns >= LONG_TURNS ? `（AI 原写 ${e.durationTurns} 回合，过长按长期显示）` : ''}</div>
                  : (d && <div className="text-dim/55">{ds ? '时效·' : '解除·'}{d}</div>)}
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
