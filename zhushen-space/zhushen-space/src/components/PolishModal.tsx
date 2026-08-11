import { useEffect, useMemo, useState } from 'react';
import ApiRoutePicker from './ApiRoutePicker';
import { POLISH_GOALS, loadPolishPrefs, savePolishPrefs, splitProtectedBlocks, polishReceipt, proseCharCount, runPolish, type PolishStrength } from '../systems/polish';

/* ✨ 正文校正弹窗（借鉴 story-oracle 校正模式·楼层操作行入口）：
   五目标开关 + 轻/精两档 → 只送散文段（受保护块=检测收据，前端拆分权威准确）→ 流式预览 → 结果可手改 →
   「应用」由 App 侧完成（saveBranchPoint 存原稿🌿支线 + saveMessageEdit 替换 content）。
   模块级组件（勿内联进父组件），受控 textarea 才不会每键重挂断输入法。 */
export default function PolishModal({ text, onApply, onClose }: {
  text: string;
  onApply: (t: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const prefs = useMemo(loadPolishPrefs, []);
  const [goals, setGoals] = useState<string[]>(prefs.goals);
  const [strength, setStrength] = useState<PolishStrength>(prefs.strength);
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);

  const segs = useMemo(() => splitProtectedBlocks(text), [text]);
  const receipt = useMemo(() => polishReceipt(segs), [segs]);
  const proseChars = useMemo(() => proseCharCount(segs), [segs]);
  const hasImages = useMemo(() => segs.some((g) => g.kind === 'keep' && g.label === '配图'), [segs]);

  // Esc 关闭（校正中不关——避免误触丢流式进度；先停/等完再关）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy && !applying) { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, applying, onClose]);

  const toggleGoal = (id: string) => setGoals((prev) => {
    const next = prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id];
    savePolishPrefs({ goals: next, strength });
    return next;
  });
  const pickStrength = (s: PolishStrength) => { setStrength(s); savePolishPrefs({ goals, strength: s }); };

  const run = async () => {
    setBusy(true); setError(''); setResult(null); setStream('');
    try {
      const r = await runPolish({ text, goals, strength, extra, onDelta: setStream });
      setResult(r.polished);
      if (!r.changed) setError('模型没有做出任何改动——可加大力度或写点附加要求后重试');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    if (result == null || applying) return;
    setApplying(true);
    try { await onApply(result); }
    catch (e) { setError(`应用失败：${e instanceof Error ? e.message : String(e)}`); setApplying(false); }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-panel border border-edge rounded-xl shadow-2xl overflow-hidden">
        {/* 头 */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-edge shrink-0">
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-100">✨ 正文校正</div>
            <div className="text-xs text-dim mt-0.5">只改措辞不改事实：去八股 / 机械对白 / 数字播报…（结构块不进模型；应用前可手改；原稿自动存入 🌿 分支树）</div>
          </div>
          <button onClick={onClose} disabled={busy || applying} className="px-2 py-1 rounded-md text-xs border border-edge text-dim hover:text-slate-200 hover:border-slate-500 transition disabled:opacity-40">✕ 关闭</button>
        </div>

        {/* 身 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* 检测收据 */}
          <div className="text-[12px] font-mono text-dim/70 rounded-lg border border-edge/60 bg-void/40 px-3 py-2">
            🧾 检测收据：受保护块 <span className="text-god/80">{receipt.length ? receipt.join('、') : '无'}</span>
            ｜可校正散文 <span className="text-god/80">{proseChars}</span> 字（受保护块不送模型、按原位拼回）
            {hasImages && <div className="mt-1 text-amber-400/70">⚠ 本楼含配图：配图按段落锚点插入，若锚点句被改写，插入位置可能变化。</div>}
          </div>

          {/* 目标 + 力度 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
            {POLISH_GOALS.map((g) => (
              <label key={g.id} className="flex items-center gap-1.5 cursor-pointer select-none" title={g.directive}>
                <input type="checkbox" checked={goals.includes(g.id)} onChange={() => toggleGoal(g.id)} disabled={busy} className="accent-god" />
                <span className={goals.includes(g.id) ? 'text-slate-200' : 'text-dim/60'}>{g.label}</span>
              </label>
            ))}
            <span className="ml-auto flex items-center gap-1 text-[12px] font-mono">
              <button onClick={() => pickStrength('light')} disabled={busy}
                className={`px-2 py-0.5 rounded border transition ${strength === 'light' ? 'border-god/60 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-300'}`}
                title="只动明显命中目标的句子，保留原文结构与叙事声音">轻校</button>
              <button onClick={() => pickStrength('deep')} disabled={busy}
                className={`px-2 py-0.5 rounded border transition ${strength === 'deep' ? 'border-god/60 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-300'}`}
                title="可重排/合并/拆分句子，主动收紧节奏（改动更大）">精校</button>
            </span>
          </div>

          {/* 附加要求 + 接口路由 */}
          <input value={extra} onChange={(e) => setExtra(e.target.value)} disabled={busy}
            placeholder="附加要求（可空）：如「重点修中段打斗的重复描写」「保留她的口癖」…"
            className="w-full bg-void border border-edge rounded px-2.5 py-1.5 text-[13px] text-slate-200 outline-none focus:border-god placeholder:text-dim/40" />
          <details>
            <summary className="cursor-pointer select-none text-[12px] font-mono text-dim/60 hover:text-dim">⚡ 本功能接口路由（可空=用正文 API）</summary>
            <div className="mt-2"><ApiRoutePicker routeKey="polish" /></div>
          </details>

          {/* 原文（折叠）*/}
          <details>
            <summary className="cursor-pointer select-none text-[12px] font-mono text-dim/60 hover:text-dim">📄 原文对照（{text.length} 字）</summary>
            <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-dim/80 bg-void/40 border border-edge/60 rounded-lg p-3">{text}</pre>
          </details>

          {/* 流式 / 结果 */}
          {busy && (
            <div className="rounded-lg border border-god/30 bg-void/40 p-3">
              <div className="text-[12px] font-mono text-god/80 mb-1.5"><span className="animate-spin inline-block">◌</span> 校正中…（流式预览）</div>
              <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-dim/70">{stream || '等待首字…'}</pre>
            </div>
          )}
          {error && <div className="text-[12px] text-blood/85 leading-snug rounded-lg border border-blood/30 bg-blood/5 px-3 py-2">⚠ {error}</div>}
          {result != null && !busy && (
            <div>
              <div className="text-[12px] font-mono text-god/80 mb-1.5">✅ 校正稿（可直接手改，应用以此为准）：</div>
              <textarea value={result} onChange={(e) => setResult(e.target.value)} rows={12}
                className="w-full bg-void border border-god/40 rounded-lg px-3 py-2 text-[13px] leading-relaxed text-slate-200 outline-none focus:border-god resize-y" />
            </div>
          )}
        </div>

        {/* 脚 */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-edge shrink-0">
          <button onClick={run} disabled={busy || applying}
            className="px-3 py-1.5 rounded-md text-[13px] font-semibold border border-god/50 text-god hover:bg-god/10 transition disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? '◌ 校正中…' : result != null ? '✨ 重新校正' : '✨ 开始校正'}
          </button>
          <button onClick={apply} disabled={result == null || busy || applying}
            className="px-3 py-1.5 rounded-md text-[13px] font-semibold bg-violet-700/80 text-white hover:bg-violet-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
            title="原稿先存入 🌿 分支树（可回收），再替换本楼正文">
            {applying ? '应用中…' : '✅ 应用为本楼正文'}
          </button>
          <span className="text-[11px] font-mono text-dim/50 ml-auto">原稿自动存 🌿 分支树，可随时找回</span>
        </div>
      </div>
    </div>
  );
}
