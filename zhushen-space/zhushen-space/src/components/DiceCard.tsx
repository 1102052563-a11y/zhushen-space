import { useEffect, useState } from 'react';
import DiceRoller, { type RollOutcome } from './DiceRoller';
import { useDice } from '../store/diceStore';
import type { DiceCardData } from '../systems/autoDice';

/* 自动检定结果卡：挂在用户气泡下方。挂载即播一次摇骰动画定格到本次掷点，按成败着色。
   与「对读者隐藏、只喂 API」配套——`<检定结果>` 文本不进正文，玩家看这张卡即知判定。 */

const LEVEL_CLS: Record<string, string> = {
  大成功: 'text-amber-300 border-amber-400/40 bg-amber-400/[0.06]',
  碾压成功: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/[0.06]',
  极难成功: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/[0.06]',
  困难成功: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/[0.06]',
  成功: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/[0.06]',
  失败: 'text-slate-300 border-slate-500/40 bg-slate-500/[0.05]',
  大失败: 'text-red-400 border-red-500/40 bg-red-500/[0.06]',
};

export default function DiceCard({ data }: { data: DiceCardData }) {
  const animMs = useDice((s) => s.settings.animMs);
  const [token, setToken] = useState(0);
  useEffect(() => { setToken(1); }, []);   // 挂载即播一次

  const outcome: RollOutcome =
    data.level === '大成功' ? 'crit' : data.level === '大失败' ? 'fumble' : data.success ? 'success' : 'fail';
  const cls = LEVEL_CLS[data.level] ?? LEVEL_CLS['成功'];
  const calc = data.calcNote   // AI 全包：显示 AI 的数值推演摘要（无前端 DC/P）
    ? data.calcNote
    : data.mode === 'd20'
      ? `d20:${data.chosen}${data.modsTotal >= 0 ? '+' : ''}${data.modsTotal}=${data.chosen + data.modsTotal} / DC${data.dc}`
      : `d100:${data.chosen} / 成功率${data.P}%`;
  const mult = data.level === '大失败' ? '· 反噬' : data.multiplier !== 1 ? `· 后果×${data.multiplier}` : '';

  return (
    <div className={`mt-1 w-full max-w-sm rounded-xl border px-3 py-2 ${cls}`}>
      <div className="flex items-center gap-3">
        <div className="shrink-0 -my-1">
          <DiceRoller mode={data.mode} finalValue={data.chosen} outcome={outcome} rollToken={token} animMs={animMs} size={56} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold">🎲 {data.level}</span>
            <span className="text-[11px] font-mono opacity-70">{mult}</span>
            {data.usedAI && <span className="text-[10px] font-mono px-1 rounded bg-void/50 text-dim/70">AI 裁定</span>}
          </div>
          <div className="text-[11px] font-mono text-dim/70 mt-0.5 truncate">
            {data.actorName}（{data.attrLabel}）· {calc}
          </div>
          {data.reasoning && <div className="text-[12px] text-slate-300/90 mt-1 leading-snug">{data.reasoning}</div>}
          {data.consequences && data.consequences.length > 0 && (
            <div className="text-[11px] font-mono text-dim/60 mt-0.5">后果：{data.consequences.join('；')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
