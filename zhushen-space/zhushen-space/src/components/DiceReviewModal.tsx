import { useState } from 'react';
import DiceCard from './DiceCard';
import type { AutoDiceOut } from '../systems/autoDice';

/* 检定审核窗（自动检定·发送即判定后弹出）：玩家可「重掷」（反复）或直接编辑要注入正文的 <检定结果> 块，
   确认后才进正文流程。取消 = 作废本回合。清空文本框确认 = 本回合不注入检定。
   与细纲弹窗同一路子（独立弹窗·依次弹）。 */

export default function DiceReviewModal({
  initial, onReroll, onConfirm, onCancel,
}: {
  initial: AutoDiceOut;
  onReroll: () => Promise<AutoDiceOut | null>;   // 重掷：重跑一次自动检定，返回新结果（null=没roll出，保留当前）
  onConfirm: (r: AutoDiceOut) => void;           // 确认：带上（可能编辑过的）检定块 + 当前骰子卡
  onCancel: () => void;                          // 取消：作废本回合
}) {
  const [cur, setCur] = useState<AutoDiceOut>(initial);
  const [block, setBlock] = useState(initial.block);
  const [rolling, setRolling] = useState(false);

  async function reroll() {
    if (rolling) return;
    setRolling(true);
    try {
      const r = await onReroll();
      if (r) { setCur(r); setBlock(r.block); }
    } catch { /* 重掷失败保留当前 */ } finally { setRolling(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-void border border-god/30 rounded-2xl p-4 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-100">🎲 本回合检定 · 确认</h3>
          <span className="text-[11px] font-mono text-dim/50">重掷 / 编辑后再写正文</span>
        </div>

        <DiceCard data={cur.card} />

        <div>
          <div className="text-[12px] font-mono text-dim/60 mb-1">注入正文的检定块（可直接编辑；清空则本回合不注入检定）</div>
          <textarea
            value={block}
            onChange={(e) => setBlock(e.target.value)}
            rows={Math.min(12, Math.max(4, block.split('\n').length + 1))}
            className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-[13px] text-slate-200 font-mono leading-relaxed outline-none focus:border-god/50 resize-y"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={reroll}
            disabled={rolling}
            className="px-3 py-1.5 rounded-lg border border-god/40 text-god bg-god/10 hover:bg-god/20 text-sm font-mono transition-colors disabled:opacity-50">
            {rolling ? '◌ 重掷中…' : '🎲 重掷'}
          </button>
          <div className="flex-1" />
          <button
            onClick={onCancel}
            disabled={rolling}
            className="px-3 py-1.5 rounded-lg border border-edge text-dim hover:text-slate-200 text-sm font-mono transition-colors disabled:opacity-50">
            取消（作废本回合）
          </button>
          <button
            onClick={() => onConfirm({ block: block.trim(), card: cur.card })}
            disabled={rolling}
            className="px-4 py-1.5 rounded-lg border border-god/50 text-god bg-god/15 hover:bg-god/25 text-sm font-mono transition-colors disabled:opacity-50">
            ✓ 确认并写正文
          </button>
        </div>
      </div>
    </div>
  );
}
