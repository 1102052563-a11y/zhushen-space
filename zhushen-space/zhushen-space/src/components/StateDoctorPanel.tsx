import { useState } from 'react';
import ApiRoutePicker from './ApiRoutePicker';
import { DOCTOR_SCOPE_DEFS, runStateDoctor, applyDoctorPatches, undoDoctorPatches, type DoctorPatch, type DoctorScopes } from '../systems/stateDoctor';

/* 🩺 状态诊断 · 正文对账（借鉴 story-oracle 诊断模式思想·代码自写）——变量管理页底部条块。
   流程：勾范围 → 🩺 诊断（一次旁路调用）→ 补丁卡逐条勾选（白名单预检不过的置灰+说明）→ 应用（走 <state> 正规管道）→ 可撤销。
   ⚠ 撤销按「应用前旧值」回写、走同一条管道；只在本次面板会话内有效。 */
export default function StateDoctorPanel({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const [scopes, setScopes] = useState<DoctorScopes>({ player: true, npcs: true, resources: true, currency: true, vars: true });
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [patches, setPatches] = useState<DoctorPatch[] | null>(null);
  const [clean, setClean] = useState(false);
  const [rawReply, setRawReply] = useState('');
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [applied, setApplied] = useState(false);
  const [applyMsg, setApplyMsg] = useState('');
  const [undoLines, setUndoLines] = useState<string[] | null>(null);

  const toggleScope = (id: keyof DoctorScopes) => setScopes((s) => ({ ...s, [id]: !s[id] }));
  const togglePatch = (i: number) => setChecked((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const run = async () => {
    setBusy(true); setError(''); setPatches(null); setClean(false); setRawReply(''); setApplied(false); setApplyMsg(''); setUndoLines(null);
    try {
      const rep = await runStateDoctor(scopes, extra);
      setPatches(rep.patches); setClean(rep.clean); setRawReply(rep.raw);
      setChecked(new Set(rep.patches.map((p, i) => (p.ok ? i : -1)).filter((i) => i >= 0)));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const apply = () => {
    const sel = (patches ?? []).filter((_, i) => checked.has(i));
    if (!sel.length) return;
    const r = applyDoctorPatches(sel);
    setUndoLines(r.undoLines);
    setApplied(true);
    setApplyMsg(`已应用 ${r.applied} 条${r.failed.length ? `｜失败 ${r.failed.length} 条：${r.failed.join('；').slice(0, 120)}` : ''}`);
  };

  const undo = () => {
    if (!undoLines) return;
    const r = undoDoctorPatches(undoLines);
    setApplyMsg(`已撤销（按应用前旧值回写 ${r.applied} 条）`);
    setUndoLines(null);
  };

  const okCount = (patches ?? []).filter((_, i) => checked.has(i)).length;

  return (
    <details open={defaultOpen || undefined} className="mt-6 rounded-xl border border-edge/50 bg-black/20 p-4">
      <summary className="cursor-pointer select-none text-sm font-semibold text-slate-200 flex items-center gap-2 flex-wrap">
        🩺 状态诊断 · 正文对账
        <span className="text-[11px] text-dim/60 font-normal">AI 对照最近正文找「状态没跟上」的地方，出保守补丁：预览→勾选→应用，可撤销（借鉴 story-oracle）</span>
      </summary>
      <div className="mt-3 space-y-3">
        {/* 范围 + 附加要求 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          <span className="text-[12px] font-mono text-dim/60">诊断范围</span>
          {DOCTOR_SCOPE_DEFS.map((d) => (
            <label key={d.id} className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={scopes[d.id]} onChange={() => toggleScope(d.id)} disabled={busy} className="accent-god" />
              <span className={scopes[d.id] ? 'text-slate-200' : 'text-dim/60'}>{d.label}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={extra} onChange={(e) => setExtra(e.target.value)} disabled={busy}
            placeholder="附加要求（可空）：如「重点查刚才那场恶战的伤势」…"
            className="flex-1 min-w-[220px] bg-void border border-edge rounded px-2.5 py-1.5 text-[13px] text-slate-200 outline-none focus:border-god placeholder:text-dim/40" />
          <button onClick={run} disabled={busy}
            className="px-3 py-1.5 rounded-md text-[13px] font-semibold border border-god/50 text-god hover:bg-god/10 transition disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? '◌ 诊断中…' : '🩺 开始诊断'}
          </button>
        </div>
        <details>
          <summary className="cursor-pointer select-none text-[12px] font-mono text-dim/60 hover:text-dim">⚡ 本功能接口路由（可空=用正文 API）</summary>
          <div className="mt-2"><ApiRoutePicker routeKey="stateDoctor" /></div>
        </details>
        <div className="text-[11px] text-dim/50 leading-snug">
          白名单：主角/在场 NPC 的 HP·EP·SAN、自定义资源条、货币、自定义变量。物品/NPC 档案/六维各有演化与对账阶段，不归这里。
          铁则「只对账不发福利」：没有正文依据的补丁不会出。若演化正在后台跑，建议等它结束再诊断。
        </div>

        {/* 结果 */}
        {error && <div className="text-[12px] text-blood/85 leading-snug rounded-lg border border-blood/30 bg-blood/5 px-3 py-2">⚠ {error}</div>}
        {clean && <div className="text-[13px] text-emerald-300/90 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">✅ 军医看过了：状态与正文一致，无需修复。</div>}
        {patches != null && patches.length > 0 && (
          <div className="space-y-1.5">
            {patches.map((p, i) => (
              <div key={i} className={`rounded-lg border p-2 ${p.ok ? 'border-edge bg-void/40' : 'border-edge/40 bg-void/20 opacity-60'}`}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" disabled={!p.ok || applied} checked={checked.has(i)} onChange={() => togglePatch(i)} className="mt-0.5 accent-god" />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[13px] text-slate-200 break-all">
                      {p.line}
                      {p.ok && p.current != null && <span className="text-dim/60 ml-2 text-[11px]">当前 {p.current}{p.predicted != null ? ` → ${p.predicted}` : ''}</span>}
                      {p.scope && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-god/30 text-god/70">{p.scope}</span>}
                    </div>
                    {p.reason && <div className="text-[12px] text-dim/70 mt-0.5">依据：{p.reason}</div>}
                    {!p.ok && <div className="text-[11px] text-amber-400/80 mt-0.5">⚠ 不可应用：{p.rejectReason}</div>}
                  </div>
                </label>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {!applied && (
                <button onClick={apply} disabled={okCount === 0}
                  className="px-3 py-1.5 rounded-md text-[13px] font-semibold bg-violet-700/80 text-white hover:bg-violet-600 transition disabled:opacity-40 disabled:cursor-not-allowed">
                  ✅ 应用勾选（{okCount} 条）
                </button>
              )}
              {applied && undoLines != null && undoLines.length > 0 && (
                <button onClick={undo}
                  className="px-3 py-1.5 rounded-md text-[13px] border border-amber-500/50 text-amber-300 hover:bg-amber-500/10 transition">
                  ↩ 撤销本次应用
                </button>
              )}
              {applyMsg && <span className="text-[12px] font-mono text-dim/70">{applyMsg}</span>}
            </div>
          </div>
        )}
        {patches != null && patches.length === 0 && !clean && rawReply.trim() && (
          <details>
            <summary className="cursor-pointer select-none text-[12px] font-mono text-amber-400/80">⚠ 模型没按「补丁:/依据:」协议输出——点开看它的原话</summary>
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[12px] text-dim/70 bg-void/40 border border-edge/60 rounded-lg p-3">{rawReply}</pre>
          </details>
        )}
      </div>
    </details>
  );
}
