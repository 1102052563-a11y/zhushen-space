import { useState } from 'react';
import { useWorldRecord, formatWorldviewForInjection, formatInheritAnchors, type WorldRecord, type WorldSummary } from '../store/worldRecordStore';

// 🗺️ 世界记录 / 世界志：主角经历过的世界。左列表 → 右详情（世界观骨架 + 离世总结）。
//  · draft=已生成世界观待进入 · active=当前所在（其世界观注入正文最深处）· left=已离开（有总结）。
//  · 同名再入的「继承 / 重置」选择（P3）后续接入。

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: '● 所在', cls: 'text-god border-god/50 bg-god/10' },
  left:   { label: '已离开', cls: 'text-dim border-edge' },
  draft:  { label: '待进入', cls: 'text-violet-300 border-violet-500/40 bg-violet-500/10' },
};

function rank(r: WorldRecord): number { return r.status === 'active' ? 0 : r.status === 'left' ? 1 : 2; }

export default function WorldRecordPanel({ onClose, onGenSummary, summaryBusyId, onRegenWorldview, worldviewBusyId }: {
  onClose: () => void;
  onGenSummary?: (recordId: string) => void;      // 📜 为该世界生成离世总结（逻辑在 App·需正文/记忆/API）
  summaryBusyId?: string | null;                  // 正在生成总结的记录 id
  onRegenWorldview?: (recordId: string) => void;  // 🌐 进世界后补/重生成世界观（用卡片快照+当前阶位）
  worldviewBusyId?: string | null;                // 正在生成世界观的记录 id
}) {
  const records = useWorldRecord((s) => s.records);
  const removeRecord = useWorldRecord((s) => s.removeRecord);
  const [selId, setSelId] = useState<string | null>(null);

  const sorted = [...records].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
  const sel = sorted.find((r) => r.id === selId) ?? sorted[0];

  return (
    <div className="fixed inset-0 z-40 bg-void/95 backdrop-blur-sm flex flex-col">
      {/* 头部 */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b border-edge">
        <span className="text-lg font-bold text-god god-glow">🗺️ 世界记录</span>
        <span className="text-xs font-mono text-dim/60">主角经历过的世界 · 世界观骨架进世界后注入正文最深处</span>
        <button onClick={onClose} className="ml-auto text-dim hover:text-blood text-sm font-mono transition-colors">✕ 关闭</button>
      </div>

      {records.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-dim/60 font-mono text-sm px-6 text-center">
          还没有世界记录。<br />在「选择世界」生成卡片后，点卡片上的「🌐 生成世界观」即可为该世界建立记录。
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* 左：列表 */}
          <div className="w-64 shrink-0 border-r border-edge overflow-y-auto py-2">
            {sorted.map((r) => {
              const st = STATUS[r.status] ?? STATUS.draft;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelId(r.id)}
                  className={`w-full text-left px-4 py-2.5 border-l-2 transition-colors ${sel?.id === r.id ? 'border-god bg-god/5' : 'border-transparent hover:bg-panel/60'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-200 font-medium truncate">{r.name || '（未命名世界）'}</span>
                    {r.instanceId > 1 && <span className="text-[10px] font-mono text-amber-400/70 shrink-0">#{r.instanceId}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${st.cls}`}>{st.label}</span>
                    {r.tier && <span className="text-[10px] font-mono text-sky-400/60">{r.tier}</span>}
                    {r.worldview ? <span className="text-[10px] font-mono text-violet-300/60">世界观✓</span> : <span className="text-[10px] font-mono text-dim/40">无世界观</span>}
                    {r.summary && <span className="text-[10px] font-mono text-gold/60">总结✓</span>}
                  </div>
                </button>
              );
            })}
          </div>

          {/* 右：详情 */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {!sel ? (
              <div className="text-dim/50 font-mono text-sm">选择左侧一个世界查看。</div>
            ) : (
              <div className="max-w-3xl space-y-5">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-xl font-bold text-slate-100">{sel.name}{sel.instanceId > 1 && <span className="text-amber-400/70 text-sm ml-2 font-mono">第 {sel.instanceId} 次</span>}</h2>
                  <span className={`text-[11px] font-mono px-2 py-0.5 rounded border ${(STATUS[sel.status] ?? STATUS.draft).cls}`}>{(STATUS[sel.status] ?? STATUS.draft).label}</span>
                  {sel.fromInstance && <span className="text-[11px] font-mono text-emerald-300/80 border border-emerald-500/30 rounded px-1.5 py-0.5">🔗 继承上一世</span>}
                  {sel.tier && <span className="text-xs font-mono text-sky-400/70">{sel.tier}</span>}
                  {sel.playerTierAtGen && <span className="text-[11px] font-mono text-dim/50">生成时主角：{sel.playerTierAtGen}·Lv.{sel.playerLevelAtGen ?? '?'}</span>}
                  {sel.status !== 'draft' && onGenSummary && (
                    <button
                      onClick={() => summaryBusyId !== sel.id && onGenSummary(sel.id)}
                      disabled={summaryBusyId === sel.id}
                      title="读取本世界经历（正文/任务/记忆）→ AI 总结这一趟的所作所为与收获。可反复重生成。"
                      className={`ml-auto text-[11px] font-mono rounded px-2 py-0.5 border transition-colors ${summaryBusyId === sel.id ? 'border-gold/30 text-gold/50 cursor-wait' : 'border-gold/40 text-gold/90 hover:bg-gold/10'}`}
                    >
                      {summaryBusyId === sel.id ? '◌ 总结中…' : sel.summary ? '🔄 重新总结' : '📜 生成离世总结'}
                    </button>
                  )}
                  <button
                    onClick={() => { if (confirm(`删除世界记录【${sel.name}】？（世界观 + 总结一并删除）`)) { removeRecord(sel.id); setSelId(null); } }}
                    className={`${sel.status === 'draft' || !onGenSummary ? 'ml-auto ' : ''}text-[11px] font-mono text-dim/50 hover:text-blood border border-edge hover:border-blood/40 rounded px-2 py-0.5 transition-colors`}
                  >删除</button>
                </div>

                {/* 世界观 */}
                <section>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-mono text-violet-300/80">🌐 世界观骨架 {sel.status === 'active' && <span className="text-god/70">· 正注入本世界正文</span>}</span>
                    {onRegenWorldview && (
                      <button
                        onClick={() => worldviewBusyId !== sel.id && onRegenWorldview(sel.id)}
                        disabled={worldviewBusyId === sel.id}
                        title="用本世界卡片快照 + 当前主角阶位/等级，重新生成世界观骨架（覆盖当前）。进世界后也可补生成。"
                        className={`ml-auto text-[11px] font-mono rounded px-2 py-0.5 border transition-colors ${worldviewBusyId === sel.id ? 'border-violet-400/30 text-violet-300/50 cursor-wait' : 'border-violet-500/40 text-violet-300 hover:bg-violet-500/10'}`}
                      >
                        {worldviewBusyId === sel.id ? '◌ 生成中…' : sel.worldview ? '🔄 重生成' : '🌐 生成世界观'}
                      </button>
                    )}
                  </div>
                  {sel.worldview ? (
                    <pre className="text-[13px] text-slate-300 leading-relaxed whitespace-pre-wrap font-sans border border-violet-500/15 bg-void/40 rounded-lg p-3">{formatWorldviewForInjection(sel.worldview)}</pre>
                  ) : (
                    <div className="text-dim/50 font-mono text-xs">尚未生成世界观（点右上「🌐 生成世界观」，或在选择世界的卡片上生成）。</div>
                  )}
                </section>

                {/* 继承的上次进度（同名再入·续写锚点） */}
                {sel.inheritAnchors && (
                  <section>
                    <div className="text-sm font-mono text-emerald-300/80 mb-1.5">🔗 继承·上次进度（注入正文·续写）</div>
                    <pre className="text-[13px] text-slate-300 leading-relaxed whitespace-pre-wrap font-sans border border-emerald-500/15 bg-void/40 rounded-lg p-3">{formatInheritAnchors(sel.inheritAnchors)}</pre>
                  </section>
                )}

                {/* 离世总结 */}
                {sel.summary && (
                  <section>
                    <div className="text-sm font-mono text-gold/80 mb-1.5">📜 离世总结</div>
                    <pre className="text-[13px] text-slate-300 leading-relaxed whitespace-pre-wrap font-sans border border-gold/15 bg-void/40 rounded-lg p-3">{formatSummary(sel.summary)}</pre>
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatSummary(s: WorldSummary): string {
  const L: string[] = [];
  if (s.状态 || s.综合评价) L.push(`状态：${s.状态 ?? '—'}${s.综合评价 ? `　综合评价：${s.综合评价}` : ''}`);
  if (s.停留时长) L.push(`停留：${s.停留时长.世界时间 ?? '?'}${s.停留时长.回合数 != null ? `（${s.停留时长.回合数} 回合）` : ''}`);
  if (s.经历概述?.length) L.push('经历：\n' + s.经历概述.map((x) => `  · ${x}`).join('\n'));
  if (s.关键事件?.length) L.push('关键事件：\n' + s.关键事件.map((e) => `  · ${e.事件}${e.结果 ? `→${e.结果}` : ''}${e.影响 ? `（${e.影响}）` : ''}`).join('\n'));
  if (s.世界线偏转) L.push(`世界线偏转：${s.世界线偏转}`);
  if (s.人物结局?.length) L.push('人物结局：\n' + s.人物结局.map((p) => `  · ${p.名称}：${p.结局 ?? ''}${p.关系 ? `（${p.关系}）` : ''}`).join('\n'));
  if (s.收获) {
    const g = s.收获; const parts: string[] = [];
    if (g.世界之源) parts.push(`世界之源:${g.世界之源}`);
    if (g.货币) parts.push(`货币:${g.货币}`);
    if (g.属性点 != null) parts.push(`属性点:${g.属性点}`);
    if (g.装备?.length) parts.push(`装备:${g.装备.join('、')}`);
    if (g.技能天赋变化?.length) parts.push(`技能天赋:${g.技能天赋变化.join('、')}`);
    if (g.宝箱?.length) parts.push(`宝箱:${g.宝箱.join('、')}`);
    if (g.重要物品?.length) parts.push(`重要物品:${g.重要物品.join('、')}`);
    if (parts.length) L.push('收获：' + parts.join('｜'));
  }
  if (s.代价?.length) L.push(`代价：${s.代价.join('；')}`);
  if (s.未了伏笔?.length) L.push(`未了伏笔：${s.未了伏笔.join('；')}`);
  if (s.继承要点) {
    const k = s.继承要点; const parts: string[] = [];
    if (k.主角在此世界身份) parts.push(`身份:${k.主角在此世界身份}`);
    if (k.主角名声) parts.push(`名声:${k.主角名声}`);
    if (k.已达世界之源) parts.push(`世界之源:${k.已达世界之源}`);
    if (k.已完成任务?.length) parts.push(`已完成:${k.已完成任务.join('、')}`);
    if (k.关键NPC现状) parts.push(`关键NPC:${k.关键NPC现状}`);
    if (k.遗留局势) parts.push(`遗留局势:${k.遗留局势}`);
    if (parts.length) L.push('⭐继承要点（再入可延续）：\n  ' + parts.join('\n  '));
  }
  return L.join('\n');
}
