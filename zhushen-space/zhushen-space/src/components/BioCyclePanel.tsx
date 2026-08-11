import { useMemo, useState } from 'react';
import { useBioCycle, DEFAULT_BIO } from '../store/bioCycleStore';
import { useNpc } from '../store/npcStore';
import { useMisc } from '../store/miscStore';
import { worldDayIndex, cycleStateOf, pregnancyStateOf, dailyMood } from '../systems/bioCycle';

/* 🌸 生理周期管理（借鉴V3.2经期孕育·可选成人向模块·默认关）：
   全局开关 + 按角色启用/参数/受孕标记；一切状态前端按世界时间确定性推算，在场时注入一行「状态底色」。 */

const numCls = 'w-14 bg-void border border-edge rounded px-1.5 py-0.5 text-[13px] text-slate-200 outline-none focus:border-god text-center';

export default function BioCyclePanel({ onClose }: { onClose: () => void }) {
  const enabled = useBioCycle((s) => s.enabled);
  const setEnabled = useBioCycle((s) => s.setEnabled);
  const chars = useBioCycle((s) => s.chars);
  const upsertChar = useBioCycle((s) => s.upsertChar);
  const removeChar = useBioCycle((s) => s.removeChar);
  const setPregnant = useBioCycle((s) => s.setPregnant);
  const npcs = useNpc((s) => s.npcs);
  const worldTime = useMisc((s) => s.worldTime);
  const [search, setSearch] = useState('');

  const today = worldDayIndex(worldTime);
  const roster = useMemo(() => {
    const all = Object.values(npcs).filter((n: any) => n?.name && n.name !== n.id && !n.isDead && !n.archived);
    const q = search.trim();
    const list = q ? all.filter((n: any) => String(n.name).includes(q)) : all;
    // 已纳入的排前，其余按在场优先
    return [...list].sort((a: any, b: any) =>
      Number(!!chars[b.id]) - Number(!!chars[a.id]) || Number(!!b.onScene) - Number(!!a.onScene)).slice(0, 40);
  }, [npcs, search, chars]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[86vh] overflow-y-auto rounded-xl border border-edge bg-panel p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-slate-100">🌸 生理周期（可选模块）</div>
          <button onClick={onClose} className="text-dim hover:text-slate-200 text-sm">✕</button>
        </div>
        <div className="text-[12px] text-dim/60 leading-relaxed">
          按<b>世界时间</b>前端确定性推算经期/排卵/孕周/预产/产后（AI 不参与计算）；启用的角色<b>在场时</b>注入一行「状态底色」供正文轻描淡写。
          全局开关默认关；当前世界时间日序：<span className="font-mono text-god/80">{today ?? '解析不出（引擎休眠）'}</span>
        </div>
        <label className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border cursor-pointer transition-colors ${enabled ? 'border-pink-500/50 bg-pink-500/5' : 'border-edge'}`}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="text-[13px] text-slate-200 font-semibold">启用生理周期系统</span>
          <span className="text-[11px] text-dim/50">关＝所有推算与注入停摆（数据保留）</span>
        </label>

        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 搜角色名…"
          className="w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-god" />

        <div className="space-y-1.5">
          {roster.length === 0 && <div className="text-[12px] text-dim/40 text-center py-2">没有可管理的角色</div>}
          {roster.map((n: any) => {
            const prof = chars[n.id];
            const name = String(n.name).split('|')[0].trim();
            const preg = prof && today != null ? pregnancyStateOf(prof, today) : null;
            const cyc = prof && !preg && today != null ? cycleStateOf(prof, today) : null;
            const mood = cyc ? dailyMood(n.id, today!, cyc.phase) : null;
            return (
              <div key={n.id} className={`rounded-lg border px-2 py-1.5 space-y-1 ${prof ? 'border-pink-500/30' : 'border-edge'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] text-slate-200 font-semibold">{name}</span>
                  {n.onScene && <span className="text-[10px] font-mono px-1 rounded bg-emerald-500/10 text-emerald-300/80">在场</span>}
                  <span className="flex-1" />
                  {!prof && (
                    <button onClick={() => upsertChar(n.id, { ...DEFAULT_BIO, lastPeriodStartDay: Math.max(0, (today ?? 0) - 7) })}
                      className="text-[12px] font-mono px-2 py-0.5 rounded border border-pink-500/40 text-pink-300/90 hover:bg-pink-500/10">＋ 纳入</button>
                  )}
                  {prof && (
                    <button onClick={() => { if (window.confirm(`把「${name}」移出生理周期系统？（参数将清除）`)) removeChar(n.id); }}
                      className="text-[12px] font-mono px-2 py-0.5 rounded border border-edge text-dim/60 hover:text-blood">移出</button>
                  )}
                </div>
                {prof && (
                  <>
                    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[12px] text-dim/70">
                      <label className="flex items-center gap-1">周期
                        <input type="number" min={21} max={45} value={prof.cycleLen} onChange={(e) => upsertChar(n.id, { cycleLen: Number(e.target.value) })} className={numCls} />天
                      </label>
                      <label className="flex items-center gap-1">经期
                        <input type="number" min={2} max={10} value={prof.periodLen} onChange={(e) => upsertChar(n.id, { periodLen: Number(e.target.value) })} className={numCls} />天
                      </label>
                      <button disabled={today == null} onClick={() => upsertChar(n.id, { lastPeriodStartDay: today! })}
                        title="以当前世界时间为「末次经期开始日」" className="px-2 py-0.5 rounded border border-edge text-dim/70 hover:text-pink-200 disabled:opacity-40">今天来潮</button>
                      {!prof.pregnant && (
                        <button disabled={today == null} onClick={() => { if (window.confirm(`标记「${name}」于今日受孕？（孕程 280 天·确定性推进）`)) setPregnant(n.id, today!); }}
                          className="px-2 py-0.5 rounded border border-pink-500/40 text-pink-300/90 hover:bg-pink-500/10 disabled:opacity-40">受孕（今天）</button>
                      )}
                      {prof.pregnant && (
                        <button onClick={() => { if (window.confirm(`清除「${name}」的孕期状态？`)) setPregnant(n.id, null); }}
                          className="px-2 py-0.5 rounded border border-blood/40 text-blood/80 hover:bg-blood/10">清除孕期</button>
                      )}
                    </div>
                    <div className="text-[12px] font-mono text-pink-200/80">
                      {today == null ? '— 世界时间解析不出，推算休眠' :
                        preg ? (preg.postpartumDay != null ? `产后第 ${preg.postpartumDay} 天 · 恢复期` : `孕 ${preg.weeks} 周 · 距预产约 ${Math.max(0, preg.dueInDays)} 天`) :
                        cyc ? `${cyc.phase}${cyc.dayOfPeriod ? ` 第 ${cyc.dayOfPeriod} 天` : ''} · 周期第 ${cyc.daysIntoCycle}/${cyc.cycleLen} 天 · 距下次约 ${cyc.nextPeriodInDays} 天 · 今日基调「${mood?.base}${mood?.extra ? '·' + mood.extra : ''}」` : ''}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
