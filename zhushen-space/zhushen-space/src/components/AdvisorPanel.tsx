import { useState, useRef, useEffect } from 'react';
import { useAdvisor } from '../store/advisorStore';
import { useMisc } from '../store/miscStore';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { apiChatFallback } from '../systems/apiChat';
import { ADVISOR_SYSTEM_RULE } from '../promptRules';
import ApiRoutePicker from './ApiRoutePicker';
import {
  parseProposals, stripProposalsForApi, applyProposal, proposalLines, buildAdvisorContext,
  KIND_META, type Proposal,
} from '../systems/proposalCard';

/* ══════════ 🧭 参谋（局外顾问 + 提案卡）══════════
   借鉴 ST-SevenDaysCal「构画」的「间」+ 卡片落地：在剧情之外跟 AI 商量任务/伏笔/节日怎么设计，
   它给「提案卡」，**玩家点「应用」才写进存档**。

   ⚠ 与正文彻底隔离：本窗对话永不进正文上下文；正文也不知道这里聊过什么。
   ⚠ 历史消息喂回 AI 前一律 stripProposalsForApi——否则模型照抄自己上一轮的旧卡片
     （那些内容可能没被应用、或已被玩家改过）。现状以每次重新拼的 buildAdvisorContext 为准。
   ⚠ 唯一写库入口是 applyProposal（点击触发）；本组件不直接改任何业务 store。 */

const HISTORY_CAP = 12;   // 喂回 AI 的历史轮数（现状清单每次重拼，历史只用来接话）

export default function AdvisorPanel({ onClose }: { onClose: () => void }) {
  const msgs = useAdvisor((s) => s.msgs);
  const push = useAdvisor((s) => s.push);
  const markApplied = useAdvisor((s) => s.markApplied);
  const clear = useAdvisor((s) => s.clear);
  const miscApi = useMisc((s) => s.miscApi);
  const miscShared = useMisc((s) => s.miscUseSharedApi);
  const globalApi = useSettings((s) => s.api);

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [cfgOpen, setCfgOpen] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, busy]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setErr('');
    push('user', text);
    setBusy(true);
    try {
      // 路由：留空则回退杂项接口（未配置时不必新填一份 API）
      const legacy = miscShared ? globalApi : miscApi;
      const chain = resolveApiChain('advisor', legacy);
      const history = useAdvisor.getState().msgs.slice(-HISTORY_CAP).map((m) => ({
        role: m.role,
        content: m.role === 'assistant' ? stripProposalsForApi(m.content) : m.content,
      }));
      const { content } = await apiChatFallback(chain, [
        { role: 'system', content: `${ADVISOR_SYSTEM_RULE}\n\n【存档现状】\n${buildAdvisorContext()}` },
        ...history,
      ], { timeoutMs: 120000, label: '参谋' });
      push('assistant', String(content || '').trim() || '（没有内容）');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onApply = (msgId: number, idx: number, card: Proposal) => {
    const r = applyProposal(card);
    if (r.ok) markApplied(msgId, idx);
    setToast(`${r.ok ? '✓' : '✕'} ${r.msg}`);
    window.setTimeout(() => setToast(''), 2600);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[88dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">

        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/60 text-lg">🧭</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-100">参谋 · 局外商量</div>
            <div className="text-[12px] font-mono text-dim/60">不推进剧情 · 它给提案卡，你点「应用」才落库</div>
          </div>
          <button onClick={() => setCfgOpen((v) => !v)} title="接口路由" className="text-dim/50 hover:text-god text-sm transition-colors">⚙</button>
          {msgs.length > 0 && (
            <button onClick={() => { if (confirm('清空参谋对话记录？（已应用的任务/伏笔/历不受影响）')) clear(); }}
              title="清空对话" className="text-dim/50 hover:text-blood text-sm transition-colors">🗑</button>
          )}
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {cfgOpen && (
          <div className="shrink-0 border-b border-edge bg-panel/60 px-5 py-3 space-y-2">
            <div className="text-[12px] font-mono text-dim/60">参谋用哪个接口（留空 = 跟随「杂项演化」的接口）</div>
            <ApiRoutePicker routeKey="advisor" />
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {msgs.length === 0 && (
            <div className="text-[13px] text-dim/50 leading-relaxed border border-dashed border-edge rounded-xl p-4 space-y-2">
              <div className="text-slate-300">在这里跟 AI 商量剧情之外的事——它读得到你存档的现状（任务 / 伏笔 / 历 / 时间），但**不会**碰正文。</div>
              <div>试试：</div>
              <ul className="space-y-0.5 pl-4 list-disc marker:text-god/40">
                <li>「给我设计一条三环的支线，跟铁匠那条线有关」</li>
                <li>「埋一条关于黑袍人的伏笔，别太早回收」</li>
                <li>「把宁荣荣的生日记到历上，二月十八」</li>
                <li>「T_1 的奖励是不是太高了？改一下」</li>
              </ul>
              <div className="text-dim/40">它给的卡片<b className="text-dim/70">不会自动生效</b>，点「应用」才写进存档。</div>
            </div>
          )}

          {msgs.map((m) => {
            if (m.role === 'user') {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] px-3.5 py-2 rounded-xl bg-god/10 border border-god/20 text-[14px] text-god/90 whitespace-pre-wrap leading-relaxed">{m.content}</div>
                </div>
              );
            }
            const { text, cards } = parseProposals(m.content, String(m.id));
            return (
              <div key={m.id} className="space-y-2">
                {text && (
                  <div className="max-w-[92%] px-3.5 py-2 rounded-xl bg-panel/70 border border-edge text-[14px] text-slate-300 whitespace-pre-wrap leading-relaxed">{text}</div>
                )}
                {cards.map((c, i) => {
                  const done = m.applied?.includes(i);
                  const meta = KIND_META[c.kind];
                  return (
                    <div key={c.id} className={`rounded-xl border px-3.5 py-2.5 ${done ? 'border-god/25 bg-god/[0.04]' : 'border-god/40 bg-god/[0.07]'}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span>{meta.glyph}</span>
                        <span className="text-[13px] font-bold text-god/90">{c.ref ? `修改${meta.label}` : `新${meta.label}`}提案</span>
                        {c.ref && <span className="text-[11px] font-mono text-dim/50">→ {c.ref}</span>}
                        <span className="flex-1" />
                        {done ? (
                          <span className="text-[12px] font-mono text-god/70">✓ 已应用</span>
                        ) : (
                          <button onClick={() => onApply(m.id, i, c)}
                            className="px-2.5 py-1 rounded border border-god/45 text-god bg-god/10 hover:bg-god/20 text-[12px] font-mono transition-colors">应用</button>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        {proposalLines(c).map((l, li) => (
                          <div key={li} className="flex gap-2 text-[13px] leading-relaxed">
                            <span className="shrink-0 w-14 text-dim/50 font-mono text-[12px]">{l.label}</span>
                            <span className="text-slate-300 min-w-0">{l.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {busy && <div className="flex items-center gap-2 text-dim text-xs font-mono"><span className="animate-spin inline-block">◌</span><span>参谋思考中…</span></div>}
          {err && <div className="text-xs text-blood font-mono px-3 py-2 border border-blood/30 rounded-lg bg-blood/5">⚠ {err}</div>}
          <div ref={endRef} />
        </div>

        {toast && (
          <div className="shrink-0 px-4 py-1.5 border-t border-edge bg-panel text-[12px] font-mono text-god/85">{toast}</div>
        )}

        <div className="shrink-0 border-t border-edge bg-panel px-3 py-2.5 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
            rows={Math.min(5, Math.max(1, input.split('\n').length))}
            placeholder="想加个什么？（Enter 发送 · Shift+Enter 换行）"
            className="flex-1 bg-void border border-edge rounded-lg px-3 py-2 text-[14px] text-slate-200 leading-relaxed outline-none focus:border-god/50 resize-none"
          />
          <button onClick={() => void send()} disabled={busy || !input.trim()}
            className="shrink-0 px-3 py-2 rounded-lg border border-god/40 text-god bg-god/10 hover:bg-god/20 disabled:opacity-40 text-[13px] font-mono transition-colors">▶</button>
        </div>
      </div>
    </div>
  );
}
