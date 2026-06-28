import { useState } from 'react';
import { useLedger } from '../systems/ledger/ledgerStore';
import { useSnapshots } from '../store/snapshotStore';
import { rollbackEvoDomains } from '../systems/saveManager';
import FieldTrend from './FieldTrend';

/* 变量审计 + 回滚（数据库引入②）：把演化账本(drpg-ledger)露成"本回合改了什么"，
   把整份快照(drpg-evosnap)露成"一键回滚整回合"。仿数据库的表视图 + checkpoint。 */

const ENTITY_EMOJI: Record<string, string> = { item: '📦', npc: '👤', char: '🎭', faction: '🏛', territory: '🏰', team: '⚔', misc: '📜' };
const OUTCOME_CLS: Record<string, string> = { applied: 'text-emerald-300/90', dup: 'text-slate-400', fail: 'text-amber-300/90', error: 'text-rose-300/90' };
const OUTCOME_CN: Record<string, string> = { applied: '应用', dup: '去重', fail: '退回', error: '异常' };

export default function AuditRollback() {
  const events = useLedger((s) => s.events);
  const snaps = useSnapshots((s) => s.snaps);
  const [onlyGuard, setOnlyGuard] = useState(false);
  const [msg, setMsg] = useState('');

  const shown = events.slice(-150).reverse().filter((e) =>
    !onlyGuard || e.source === 'drift-guard' || e.source === 'field-lock' || e.source === 'attr-clamp' || e.outcome === 'fail' || e.outcome === 'error');

  function doRollback(sn: { turn: number; ts: number; stores: Record<string, string> }) {
    if (!window.confirm(
      `回滚到「第 ${sn.turn} 回合演化前」？\n\n` +
      '会把 NPC / 背包 / 技能天赋 / 主角档案 / 势力 / 领地 / 冒险团 / 杂项 / 万族 还原到那一刻\n（HP·EP、配置、账本不动）。\n\n此操作不可撤销。',
    )) return;
    const restored = rollbackEvoDomains(sn);
    setMsg(`✅ 已回滚到第 ${sn.turn} 回合演化前，还原了 ${restored.length} 个变量域。`);
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-slate-400 leading-relaxed">每回合演化的每笔改动都记进<b className="text-slate-200">账本</b>；快照让你能<b className="text-amber-200/90">一键回滚整回合</b>。快照在<b className="text-slate-200">本次会话内存</b>里（刷新 / 读档后清空），所以"回滚"要在发现问题的当回合用。</p>

      {/* 回滚整回合 */}
      <section className="border border-slate-700/50 rounded p-2 space-y-1.5">
        <div className="text-teal-300 text-xs font-semibold">回滚整回合（只还原变量到某回合演化前）</div>
        <div className="text-[11px] text-slate-500 leading-snug">只把<b className="text-slate-300">变量数据</b>（NPC/背包/技能/六维/势力…）还原到那一刻——<b className="text-slate-300">正文不动、不重新生成、不重跑演化</b>，可退到最近几回合里任意一个。<br />※ 想连<b className="text-slate-400">正文一起撤</b> → 用对话框「↶回退上一回合」；想<b className="text-slate-400">保留正文、重跑一遍演化</b> → 用「重算变量」。</div>
        {snaps.length === 0 ? <div className="text-slate-500 text-xs">（暂无快照——发一条消息、跑一回合演化后才有）</div> : (
          <div className="space-y-1">
            {snaps.slice().reverse().map((sn, i) => (
              <div key={sn.ts} className="flex items-center justify-between gap-2">
                <span className="text-slate-300 text-xs">第 <b className="text-teal-200">{sn.turn}</b> 回合演化前 <span className="text-slate-500">· {new Date(sn.ts).toLocaleTimeString()}{i === 0 ? ' · 最近' : ''}</span></span>
                <button onClick={() => doRollback(sn)} className="px-2 py-0.5 rounded text-xs border border-amber-400/50 text-amber-200 hover:bg-amber-500/15 transition">↶ 回滚到此</button>
              </div>
            ))}
          </div>
        )}
        {msg && <div className="text-xs text-emerald-300">{msg}</div>}
      </section>

      {/* 字段历史趋势 */}
      <section className="border border-slate-700/50 rounded p-2 space-y-1.5">
        <div className="text-teal-300 text-xs font-semibold">字段历史趋势（竖看一个数值的演变）</div>
        <FieldTrend />
      </section>

      {/* 改动账本 */}
      <section className="border border-slate-700/50 rounded p-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="text-teal-300 text-xs font-semibold">改动账本（近 {shown.length} 条）</div>
          <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer select-none">
            <input type="checkbox" checked={onlyGuard} onChange={(e) => setOnlyGuard(e.target.checked)} className="accent-teal-500" /> 只看退回/锁定/夹回
          </label>
        </div>
        {shown.length === 0 ? <div className="text-slate-500 text-xs">（暂无记录）</div> : (
          <div className="max-h-72 overflow-y-auto space-y-0.5 pr-1 font-mono text-[11px]">
            {shown.map((e) => (
              <div key={e.seq} className="flex items-start gap-1.5 leading-snug">
                <span className="text-slate-500 shrink-0 w-7 text-right">T{e.turn}</span>
                <span className="shrink-0">{ENTITY_EMOJI[e.entity] || '•'}</span>
                <span className={`shrink-0 w-7 ${OUTCOME_CLS[e.outcome] || 'text-slate-300'}`}>{OUTCOME_CN[e.outcome] || e.outcome}</span>
                <span className="text-slate-300 truncate" title={`${e.op}${e.ref ? ' ' + e.ref : ''}${e.detail ? ' — ' + e.detail : ''}`}>
                  <span className="text-slate-400">{e.op}</span>{e.ref ? ` ${e.ref}` : ''}{e.detail ? <span className="text-slate-500"> — {e.detail}</span> : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
