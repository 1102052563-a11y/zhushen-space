import { useMemo, useState } from 'react';
import { useNpc } from '../store/npcStore';
import { usePlayer } from '../store/playerStore';
import { useInterviews, type InterviewRecord } from '../store/interviewStore';
import { runInterview, interviewToHtml, interviewToText, type InterviewSetup } from '../systems/interview';

/* 🎤 大采访（借鉴V3.2）：选人 → 引档案/接续往期/额外要求 → 旁路生成 → 档案解密皮渲染 → 复制/下载HTML。
   产物只进本面板历史（drpg-interviews·随存档），绝不进正文上下文。 */

const inputCls = 'w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-god';

export default function InterviewPanel({ onClose }: { onClose: () => void }) {
  const npcs = useNpc((s) => s.npcs);
  const playerName = usePlayer((s) => s.profile.name) || '主角';
  const records = useInterviews((s) => s.records);
  const addRecord = useInterviews((s) => s.addRecord);
  const removeRecord = useInterviews((s) => s.removeRecord);

  const [interviewer, setInterviewer] = useState('乐园周刊·姬记者');
  const [picked, setPicked] = useState<string[]>([]);
  const [includePlayer, setIncludePlayer] = useState(false);
  const [readDossier, setReadDossier] = useState(true);
  const [continueId, setContinueId] = useState('');
  const [extra, setExtra] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [viewId, setViewId] = useState('');   // 正在阅读的记录 id（''=设置视图）

  // 候选：在场优先，其余按名搜索
  const candidates = useMemo(() => {
    const all = Object.values(npcs).filter((n: any) => n?.name && n.name !== n.id && !n.isDead && !n.archived);
    const q = search.trim();
    const list = q ? all.filter((n: any) => String(n.name).includes(q)) : all;
    return [...list].sort((a: any, b: any) => Number(!!b.onScene) - Number(!!a.onScene)).slice(0, 30);
  }, [npcs, search]);

  const togglePick = (id: string) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 2 ? p : [...p, id]));
  };

  async function onGenerate() {
    if (busy) return;
    setBusy(true); setMsg('🎙 撰稿中…（一次 AI 调用，产物不进正文）');
    try {
      const past = records.find((r) => r.id === continueId);
      const setup: InterviewSetup = {
        interviewers: interviewer.split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
        intervieweeIds: picked,
        includePlayer,
        readDossier,
        continueFrom: past ? { title: past.title, rawText: past.rawText } : undefined,
        extra,
      };
      const r = await runInterview(setup);
      const id = addRecord(r);
      setViewId(id);
      setMsg('');
    } catch (e: any) { setMsg('✗ ' + (e?.message || String(e))); }
    setBusy(false);
  }

  function downloadHtml(r: InterviewRecord) {
    const blob = new Blob([interviewToHtml(r)], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `大采访-${r.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 30) || '未命名'}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  async function copyText(r: InterviewRecord) {
    try { await navigator.clipboard.writeText(interviewToText(r)); setMsg('✓ 已复制全文'); setTimeout(() => setMsg(''), 2500); }
    catch { setMsg('✗ 复制失败（浏览器拦截）'); }
  }

  const viewing = records.find((r) => r.id === viewId) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={busy ? undefined : onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-2xl max-h-[88dvh] flex flex-col overflow-hidden shadow-[0_0_60px_rgba(0,0,0,0.8)]"
        onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between p-4 border-b border-edge shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🎤</span>
              <h2 className="text-base font-bold text-slate-100">大采访</h2>
              <span className="text-[12px] font-mono text-dim/50">乐园周刊 · 局外花絮栏目</span>
            </div>
            <p className="text-[12px] text-dim/60 mt-0.5">给角色做一期专访：不推进剧情、不进正文，可下载成网页分享。</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {viewing && <button onClick={() => setViewId('')} className="text-[12px] font-mono px-2 py-1 rounded border border-edge text-dim hover:text-slate-200">← 新采访</button>}
            <button onClick={onClose} disabled={busy} className="text-dim/50 hover:text-blood text-lg font-mono disabled:opacity-40">✕</button>
          </div>
        </header>

        {msg && <div className={`px-4 py-2 border-b border-edge/60 text-[13px] font-mono shrink-0 ${msg.startsWith('✓') ? 'text-emerald-300' : msg.startsWith('✗') ? 'text-blood' : 'text-god'}`}>{busy && <span className="inline-block animate-spin mr-1.5">⟳</span>}{msg}</div>}

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!viewing && (
            <>
              <div className="space-y-1.5">
                <div className="text-[12px] font-mono text-god/70">1 · 采访者（顿号分隔可多人）</div>
                <input value={interviewer} onChange={(e) => setInterviewer(e.target.value.slice(0, 60))} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <div className="text-[12px] font-mono text-god/70">2 · 被采访者（≤2 位 NPC，可加主角）</div>
                <div className="flex items-center gap-2">
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 搜姓名…" className={inputCls} />
                  <label className="shrink-0 flex items-center gap-1.5 text-[13px] text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={includePlayer} onChange={(e) => setIncludePlayer(e.target.checked)} />{playerName}（主角）
                  </label>
                </div>
                <div className="max-h-32 overflow-y-auto flex flex-wrap gap-1.5 rounded-lg border border-edge bg-panel/40 p-2">
                  {candidates.length === 0 && <span className="text-[12px] text-dim/40">没有可选角色</span>}
                  {candidates.map((n: any) => {
                    const on = picked.includes(n.id);
                    const name = String(n.name).split('|')[0].trim();
                    return (
                      <button key={n.id} onClick={() => togglePick(n.id)}
                        className={`text-[12px] px-2 py-0.5 rounded-full border transition-colors ${on ? 'border-god/60 bg-god/15 text-god' : 'border-edge text-slate-300 hover:border-god/40'}`}>
                        {on ? '✓ ' : ''}{name}{n.onScene ? ' ·在场' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <label className="flex items-center gap-1.5 text-[13px] text-slate-300 cursor-pointer" title="开=把被访者完整档案给撰稿AI（人设最稳）；关=只给名字，表现靠模型自由发挥">
                  <input type="checkbox" checked={readDossier} onChange={(e) => setReadDossier(e.target.checked)} />引用完整档案
                </label>
                <label className="flex items-center gap-1.5 text-[13px] text-slate-300">
                  接续往期
                  <select value={continueId} onChange={(e) => setContinueId(e.target.value)} className="bg-void border border-edge rounded px-1.5 py-0.5 text-[12px] text-slate-200">
                    <option value="">（不接续）</option>
                    {records.map((r) => <option key={r.id} value={r.id}>{r.title.slice(0, 18)}</option>)}
                  </select>
                </label>
              </div>
              <div className="space-y-1.5">
                <div className="text-[12px] font-mono text-god/70">3 · 额外要求（可选·仅本期）</div>
                <textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value.slice(0, 300))}
                  placeholder="例：围绕最近那场大战 / 犀利一点逼问感情线 / 古风措辞…" className={inputCls + ' resize-y'} />
              </div>
              <button onClick={() => { void onGenerate(); }} disabled={busy || (!picked.length && !includePlayer)}
                className="w-full py-2 rounded-lg text-sm font-bold border border-god/50 text-god hover:bg-god/10 disabled:opacity-40 transition-colors">
                {busy ? '🎙 撰稿中…' : '🎙 开始采访（1 次 AI 调用）'}
              </button>

              {records.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-edge/60">
                  <div className="text-[12px] font-mono text-dim/50">往期采访（{records.length}）</div>
                  {records.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-edge hover:border-god/30 transition-colors">
                      <button onClick={() => setViewId(r.id)} className="flex-1 text-left min-w-0">
                        <div className="text-[13px] text-slate-200 font-semibold truncate">{r.title}</div>
                        <div className="text-[11px] font-mono text-dim/50 truncate">{r.interviewees.join('、')}｜{r.worldTime || r.worldName}</div>
                      </button>
                      <button onClick={() => downloadHtml(r)} title="下载分享网页" className="shrink-0 text-[12px] text-dim/60 hover:text-god">⬇</button>
                      <button onClick={() => { if (window.confirm(`删除《${r.title}》？`)) { removeRecord(r.id); if (viewId === r.id) setViewId(''); } }}
                        className="shrink-0 text-[12px] text-dim/60 hover:text-blood">🗑</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {viewing && (
            <article className="rounded-xl border border-amber-700/30 bg-panel/60 p-4 space-y-3">
              <div className="inline-block border-2 border-amber-700/70 text-amber-400/90 px-2.5 py-0.5 text-[11px] tracking-[4px] -rotate-3">乐园周刊 · 大采访</div>
              <h3 className="text-lg font-bold text-slate-100">{viewing.title}</h3>
              <div className="text-[11px] font-mono text-dim/50 leading-relaxed">
                {viewing.worldName || '轮回乐园'}｜{viewing.worldTime}｜{viewing.location}<br />
                采访：{viewing.interviewers.join('、') || '乐园周刊'}　受访：{viewing.interviewees.join('、')}
              </div>
              {viewing.intro && <div className="text-[13px] italic text-dim/75 border-l-2 border-amber-700/50 pl-3 whitespace-pre-wrap">{viewing.intro}</div>}
              {viewing.segments.length > 0 ? viewing.segments.map((s, i) => (
                s.kind === 'nar'
                  ? <div key={i} className="text-[12px] italic text-dim/55 whitespace-pre-wrap">{s.text}</div>
                  : (
                    <div key={i} className="flex gap-2">
                      <span className={`shrink-0 h-fit mt-0.5 text-[11px] font-mono px-2 py-0.5 rounded-full border ${s.kind === 'q' ? 'border-amber-600/50 text-amber-300/90 bg-amber-500/10' : 'border-sky-600/50 text-sky-300/90 bg-sky-500/10'}`}>{s.speaker ?? (s.kind === 'q' ? '记者' : '受访')}</span>
                      <p className={`text-[13px] leading-relaxed whitespace-pre-wrap ${s.kind === 'q' ? 'text-amber-100/85' : 'text-slate-200'}`}>{s.text}</p>
                    </div>
                  )
              )) : <pre className="text-[13px] text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">{viewing.rawText}</pre>}
              {viewing.epilogue && (
                <div className="pt-3 border-t border-dashed border-edge text-[13px] text-dim/75 whitespace-pre-wrap">
                  <div className="text-[11px] tracking-[3px] text-amber-400/80 mb-1">✎ 采访手记</div>
                  {viewing.epilogue}
                </div>
              )}
              <div className="flex items-center gap-2 pt-2">
                <button onClick={() => { void copyText(viewing); }} className="px-3 py-1 text-[13px] font-mono border border-edge text-slate-300 rounded hover:text-god hover:border-god/40">📋 复制全文</button>
                <button onClick={() => downloadHtml(viewing)} className="px-3 py-1 text-[13px] font-mono border border-god/50 text-god rounded hover:bg-god/10">⬇ 下载分享网页</button>
              </div>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
