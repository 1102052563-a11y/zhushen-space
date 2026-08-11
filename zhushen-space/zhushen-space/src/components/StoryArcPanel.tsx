import { useState } from 'react';
import ApiRoutePicker from './ApiRoutePicker';
import { useArc, type ArcDifficulty } from '../store/arcStore';
import { useSettings } from '../store/settingsStore';
import { planArc, genBeatInstruction } from '../systems/storyArc';

/* 🧭 故事弧线 · 长线引导（借鉴 story-oracle 思想·代码自写）——变量管理页底部条块。
   流程：填贯穿线/路标/难度/红线 → 规划分拍（一次调用·可改每拍目标）→ 启动 → 每回合注入当前拍指令；
   过拍判定挂杂项演化（零新增 API），过拍自动现编下一拍；触红线自动退出；随时手动退出立刻复原。
   盲盒模式只遮 UI 上的指令预览，注入照常（玩家想保留惊喜又想引导生效）。 */

const DIFFS: ArcDifficulty[] = ['平和', '常规', '凛冽'];

export default function StoryArcPanel({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const arc = useArc();
  const plotGuidanceOn = useSettings((s) => s.plotGuidance);

  // 草稿（未启动时的表单 + 规划产物）
  const [throughline, setThroughline] = useState('');
  const [landmarks, setLandmarks] = useState('');
  const [difficulty, setDifficulty] = useState<ArcDifficulty>('常规');
  const [redlines, setRedlines] = useState('');
  const [blind, setBlind] = useState(false);
  const [planTitle, setPlanTitle] = useState('');
  const [planBeats, setPlanBeats] = useState<string[] | null>(null);   // 规划产物（可编辑），null=还没规划
  const [busy, setBusy] = useState(false);
  const [beatBusy, setBeatBusy] = useState(0);   // 正在重编指令的拍号（0=无）
  const [error, setError] = useState('');
  const [instrDraft, setInstrDraft] = useState<{ idx: number; text: string } | null>(null);   // 当前拍指令的手改草稿

  const hasArc = arc.beats.length > 0;
  const cur = arc.beats.find((b) => b.status === 'active');

  const doPlan = async () => {
    setBusy(true); setError('');
    try {
      const plan = await planArc({ title: '', throughline, landmarks, difficulty, redlines, blind });
      setPlanTitle(plan.title);
      setPlanBeats(plan.beats.map((b) => b.goal));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const doStart = () => {
    const beats = (planBeats ?? []).map((g) => g.trim()).filter(Boolean);
    if (beats.length < 2) { setError('至少要有 2 拍'); return; }
    arc.startArc({ title: planTitle, throughline, landmarks, difficulty, redlines, blind }, beats.map((g, i) => ({ idx: i + 1, goal: g })));
    setPlanBeats(null); setError('');
    // 第一拍指令后台现编（失败留日志，注入先按拍目标兜底）
    void genBeatInstruction(1).catch((e) => useArc.getState().pushLog(`⚠ 第 1 拍指令生成失败：${String((e as Error)?.message ?? e).slice(0, 60)}（可点「重编本拍指令」重试）`));
  };

  const regenInstr = async (idx: number) => {
    setBeatBusy(idx); setError('');
    try { await genBeatInstruction(idx); setInstrDraft(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBeatBusy(0); }
  };

  return (
    <details open={defaultOpen || undefined} className="mt-6 rounded-xl border border-edge/50 bg-black/20 p-4">
      <summary className="cursor-pointer select-none text-sm font-semibold text-slate-200 flex items-center gap-2 flex-wrap">
        🧭 故事弧线 · 长线引导
        {arc.active && cur
          ? <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-god/40 text-god/85">进行中 · 第 {cur.idx}/{arc.beats.length} 拍</span>
          : <span className="text-[11px] text-dim/60 font-normal">定贯穿线→分拍→每拍幕后指令逐步引导；过拍自动判定，随时退出（借鉴 story-oracle）</span>}
      </summary>
      <div className="mt-3 space-y-3">
        {/* ── 无弧线 / 已收官：新建表单 ── */}
        {!arc.active && (
          <>
            {hasArc && (
              <div className="rounded-lg border border-edge/60 bg-void/40 p-3 space-y-1.5">
                <div className="text-[13px] text-slate-300">{arc.endedReason || '弧线已结束'} —— 「{arc.title}」</div>
                <div className="text-[12px] text-dim/60 font-mono space-y-0.5">
                  {arc.beats.map((b) => <div key={b.idx}>{b.status === 'done' ? '✔' : '·'} 拍{b.idx}：{b.goal.slice(0, 60)}</div>)}
                </div>
                {arc.log.length > 0 && <div className="text-[11px] text-dim/45 font-mono">{arc.log.slice(-3).join(' ／ ')}</div>}
                <button onClick={() => arc.clearAll()} className="px-2.5 py-1 rounded border border-edge text-dim text-[12px] hover:text-slate-200 hover:border-slate-500 transition">🗑 清除 · 开新弧线</button>
              </div>
            )}
            <div className="space-y-2">
              <textarea value={throughline} onChange={(e) => setThroughline(e.target.value)} rows={2} disabled={busy}
                placeholder="贯穿线（这条弧到底讲什么）：如「揪出并扳倒潜伏在商会里的魔染内奸」"
                className="w-full bg-void border border-edge rounded px-2.5 py-1.5 text-[13px] text-slate-200 outline-none focus:border-god placeholder:text-dim/40 resize-y" />
              <textarea value={landmarks} onChange={(e) => setLandmarks(e.target.value)} rows={2} disabled={busy}
                placeholder="路标（可空·关键节点一行一个）：如「发现账本异常／内奸反咬一口／码头对峙」"
                className="w-full bg-void border border-edge rounded px-2.5 py-1.5 text-[13px] text-slate-200 outline-none focus:border-god placeholder:text-dim/40 resize-y" />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
                <span className="flex items-center gap-1 text-[12px] font-mono">
                  {DIFFS.map((d) => (
                    <button key={d} onClick={() => setDifficulty(d)} disabled={busy}
                      className={`px-2 py-0.5 rounded border transition ${difficulty === d ? 'border-god/60 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-300'}`}
                      title={d === '平和' ? '低赌注慢热，多给喘息' : d === '常规' ? '标准起伏' : '高赌注高压，处境严峻（但不写死局）'}>{d}</button>
                  ))}
                </span>
                <label className="flex items-center gap-1.5 cursor-pointer select-none" title="盲盒：面板上不看每拍幕后指令（注入照常生效），保留惊喜">
                  <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} disabled={busy} className="accent-god" />
                  <span className={blind ? 'text-slate-200' : 'text-dim/60'}>🎁 盲盒模式</span>
                </label>
              </div>
              <input value={redlines} onChange={(e) => setRedlines(e.target.value)} disabled={busy}
                placeholder="红线（可空·绝对禁区）：如「姬小满不能死；不能强拆主角与她的关系」"
                className="w-full bg-void border border-edge rounded px-2.5 py-1.5 text-[13px] text-slate-200 outline-none focus:border-god placeholder:text-dim/40" />
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={doPlan} disabled={busy || !throughline.trim()}
                  className="px-3 py-1.5 rounded-md text-[13px] font-semibold border border-god/50 text-god hover:bg-god/10 transition disabled:opacity-40 disabled:cursor-not-allowed">
                  {busy ? '◌ 规划中…' : planBeats ? '🧭 重新规划' : '🧭 规划分拍'}
                </button>
                {planBeats && (
                  <button onClick={doStart} disabled={busy}
                    className="px-3 py-1.5 rounded-md text-[13px] font-semibold bg-violet-700/80 text-white hover:bg-violet-600 transition disabled:opacity-40">🚀 启动弧线</button>
                )}
              </div>
              {planBeats && (
                <div className="rounded-lg border border-god/30 bg-void/40 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-mono text-god/80 shrink-0">弧名</span>
                    <input value={planTitle} onChange={(e) => setPlanTitle(e.target.value)}
                      className="flex-1 bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-god" />
                  </div>
                  {planBeats.map((g, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-[12px] font-mono text-dim/60 shrink-0 mt-1.5">拍{i + 1}</span>
                      <textarea value={g} rows={2}
                        onChange={(e) => setPlanBeats((prev) => prev!.map((x, xi) => (xi === i ? e.target.value : x)))}
                        className="flex-1 bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-god resize-y" />
                      <button onClick={() => setPlanBeats((prev) => prev!.filter((_, xi) => xi !== i))}
                        className="text-dim/40 hover:text-blood mt-1.5" title="删掉这拍">✕</button>
                    </div>
                  ))}
                  <button onClick={() => setPlanBeats((prev) => [...(prev ?? []), ''])}
                    className="px-2 py-0.5 rounded border border-edge text-dim text-[12px] hover:text-slate-200 transition">＋ 加一拍</button>
                  <div className="text-[11px] text-dim/50">每拍目标可随意改；「启动」后拍子锁定（指令仍可随时重编）。</div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── 进行中 ── */}
        {arc.active && cur && (
          <div className="space-y-2.5">
            <div className="text-[13px] text-slate-300">「{arc.title}」 · {arc.difficulty}{arc.blind ? ' · 🎁盲盒' : ''}</div>
            <div className="text-[12px] text-dim/70 leading-snug">贯穿线：{arc.throughline}</div>
            {plotGuidanceOn && <div className="text-[11px] text-amber-400/80">⚠ 「剧情指导」也开着——两套引导可能打架，弧线期间建议到 设置→剧情推进 关掉指导。</div>}
            <div className="space-y-1 text-[12px] font-mono">
              {arc.beats.map((b) => (
                <div key={b.idx} className={b.status === 'done' ? 'text-dim/40 line-through' : b.status === 'active' ? 'text-god/90' : 'text-dim/60'}>
                  {b.status === 'done' ? '✔' : b.status === 'active' ? '▶' : '·'} 拍{b.idx}：{b.goal}
                </div>
              ))}
            </div>
            {/* 当前拍指令：盲盒=剧透遮罩；透明=可看可改可重编 */}
            <div className="rounded-lg border border-god/30 bg-void/40 p-3 space-y-2">
              <div className="text-[12px] font-mono text-god/80">🎬 本拍导演指令（每回合注入正文·幕后）{beatBusy === cur.idx && <span className="ml-2 animate-spin inline-block">◌</span>}</div>
              {arc.blind ? (
                <details>
                  <summary className="cursor-pointer text-[12px] text-dim/60 select-none">🎁 盲盒已遮罩（注入照常生效）——点开剧透</summary>
                  <pre className="mt-2 whitespace-pre-wrap text-[12px] text-dim/70 leading-relaxed">{cur.instruction || '（现编中/未生成——注入按拍目标兜底）'}</pre>
                </details>
              ) : (
                <textarea
                  value={instrDraft?.idx === cur.idx ? instrDraft.text : (cur.instruction || '')}
                  onChange={(e) => setInstrDraft({ idx: cur.idx, text: e.target.value })}
                  rows={5} placeholder="（现编中/未生成——注入按拍目标兜底；也可手写后点保存）"
                  className="w-full bg-void border border-edge rounded px-2.5 py-1.5 text-[12px] leading-relaxed text-slate-200 outline-none focus:border-god resize-y" />
              )}
              <div className="flex flex-wrap items-center gap-2">
                {!arc.blind && instrDraft?.idx === cur.idx && instrDraft.text !== (cur.instruction || '') && (
                  <button onClick={() => { arc.setBeatInstruction(cur.idx, instrDraft.text); setInstrDraft(null); }}
                    className="px-2.5 py-1 rounded border border-god/50 text-god text-[12px] hover:bg-god/10 transition">💾 保存手改</button>
                )}
                <button onClick={() => void regenInstr(cur.idx)} disabled={beatBusy !== 0}
                  className="px-2.5 py-1 rounded border border-edge text-dim text-[12px] hover:text-slate-200 hover:border-slate-500 transition disabled:opacity-40">♻ 重编本拍指令</button>
                <button onClick={() => {
                    const next = arc.advanceBeat(`✔ 第 ${cur.idx} 拍手动跳过`, undefined);
                    if (next > 0) void genBeatInstruction(next).catch((e) => useArc.getState().pushLog(`⚠ 第 ${next} 拍指令生成失败：${String((e as Error)?.message ?? e).slice(0, 60)}`));
                  }}
                  className="px-2.5 py-1 rounded border border-edge text-dim text-[12px] hover:text-god hover:border-god/40 transition" title="不等自动判定，直接进下一拍">⏭ 手动过拍</button>
                <button onClick={() => { if (confirm('退出弧线？幕后指令立刻撤销，主线回到自由发挥（弧线记录保留，可清除后再开新弧线）。')) arc.exitArc('玩家手动退出'); }}
                  className="px-2.5 py-1 rounded border border-blood/40 text-blood/80 text-[12px] hover:bg-blood/10 transition ml-auto">🚪 退出弧线</button>
              </div>
            </div>
            {arc.log.length > 0 && (
              <div className="text-[11px] text-dim/50 font-mono space-y-0.5">{arc.log.slice(-5).map((l, i) => <div key={i}>{l}</div>)}</div>
            )}
          </div>
        )}

        {error && <div className="text-[12px] text-blood/85 leading-snug rounded-lg border border-blood/30 bg-blood/5 px-3 py-2">⚠ {error}</div>}
        <details>
          <summary className="cursor-pointer select-none text-[12px] font-mono text-dim/60 hover:text-dim">⚡ 本功能接口路由（可空=用正文 API）</summary>
          <div className="mt-2"><ApiRoutePicker routeKey="storyArc" /></div>
        </details>
        <div className="text-[11px] text-dim/50 leading-snug">
          过拍判定挂在「杂项演化」阶段（零新增调用）：正文实质达成本拍目标才过拍，触红线自动退出。判定随「回退/重算」一起回卷。
          引导纪律：玩家行动永远优先，AI 只给场景机会与 NPC 动向，不硬掰。
        </div>
      </div>
    </details>
  );
}
