import { useState } from 'react';
import { useNpc } from '../store/npcStore';
import { useItems } from '../store/itemStore';
import { usePlayer } from '../store/playerStore';
import { generateLiveShow, LIVE_GIFTS, giftByKey, type LiveShow } from '../systems/liveRoom';
import { reportFacilityOutcome } from '../systems/facilityBridge';

/* 📺 乐园直播间（借鉴Abstract外置手机 live·代码全自写）：
   挑一名契约者/随从当主播 → 生成直播现场（主播言行/弹幕/积分榜/superchat/主播心声）。
   送礼=前端确定性扣乐园币 + 好感小幅棘轮 + facilityBridge 通报；AI 只演反应不碰钱。 */

const STREAMER_TAGS = /契约者|随从/;

export default function LivePanel({ onClose }: { onClose: () => void }) {
  const npcs = useNpc((s) => s.npcs);
  const coins = useItems((s) => s.currency.乐园币);
  const [streamerId, setStreamerId] = useState<string | null>(null);
  const [show, setShow] = useState<LiveShow | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [danmu, setDanmu] = useState('');
  const [anon, setAnon] = useState(false);
  const [giftPick, setGiftPick] = useState<string | null>(null);   // 待确认的礼物 key

  const streamers = Object.values(npcs)
    .filter((n) => !!(n.name || '').trim() && !n.isDead && !n.archived && STREAMER_TAGS.test(n.npcTag || ''))
    .sort((a, b) => (b.favor ?? 0) - (a.favor ?? 0));
  const streamer = streamerId ? npcs[streamerId] : undefined;
  const playerName = usePlayer.getState().profile.name || '主角';

  function run(action?: string) {
    if (!streamerId || busy) return;
    setBusy(true); setMsg('');
    generateLiveShow(streamerId, action)
      .then((r) => { setMsg(r.ok ? '' : r.msg); if (r.show) setShow(r.show); })
      .finally(() => setBusy(false));
  }

  function sendDanmu() {
    const t = danmu.trim();
    if (!t || busy) return;
    setDanmu('');
    run(`${anon ? '一位匿名观众' : `${playerName}（主角）`}发送弹幕：「${t}」`);
  }

  function sendGift(key: string) {
    const g = giftByKey(key);
    if (!g || !streamerId || busy) return;
    const items = useItems.getState();
    if ((items.currency.乐园币 ?? 0) < g.price) { setMsg(`乐园币不足（${g.emoji}${g.name} 需 ${g.price}）`); setGiftPick(null); return; }
    items.adjustCurrency('乐园币', -g.price, `直播间送礼·${g.name}`, true);
    const rec = useNpc.getState().npcs[streamerId];
    if (rec && g.favor > 0 && !anon) useNpc.getState().upsertNpc(streamerId, { favor: Math.min(100, (rec.favor ?? 0) + g.favor) });
    reportFacilityOutcome({
      source: '乐园直播间',
      summary: `主角在「${rec?.name || '主播'}」的直播间${anon ? '匿名' : ''}赠送了${g.emoji}${g.name}（${g.price} 乐园币）`,
      guard: '礼物费用已由前端扣除，正文与演化勿再重复计账或发放回礼数值',
    });
    setGiftPick(null);
    run(`${anon ? '一位匿名观众' : `${playerName}（主角）`}赠送了${g.emoji}${g.name}（价值 ${g.price} 乐园币）${anon ? '——主播不知道是谁送的' : ''}`);
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-stretch justify-center p-2 sm:p-4" onClick={() => { if (window.innerWidth < 1024) onClose(); }}>
      <div className="w-full max-w-3xl max-h-full flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_80px_rgba(0,0,0,0.85)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="shrink-0 flex items-center gap-2.5 px-5 py-3 border-b border-edge bg-gradient-to-b from-panel to-void">
          <span className="text-lg">📺</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">乐园直播间</div>
            <div className="text-[11px] font-mono text-dim/50">契约者娱乐频道——弹幕与礼物只是演出，钱是真的花</div>
          </div>
          <span className="text-[11px] font-mono text-amber-300/80">💰 {coins}</span>
          {show && <button onClick={() => { setShow(null); setStreamerId(null); setMsg(''); }} className="text-[12px] font-mono px-2 py-0.5 rounded border border-edge text-dim/60 hover:text-slate-200">← 换台</button>}
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!streamerId || !show ? (
            <>
              {streamers.length === 0 ? (
                <div className="py-16 text-center text-dim/40 text-sm font-mono border border-dashed border-edge rounded-xl">
                  还没有能开播的角色<br /><span className="text-[11px] text-dim/30">（契约者/随从标签的在册角色才会来直播频道消遣）</span>
                </div>
              ) : (
                <>
                  <div className="text-[12px] font-mono text-dim/50">正在消遣的主播（点进直播间）：</div>
                  <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-2">
                    {streamers.map((n) => (
                      <button key={n.id} disabled={busy}
                        onClick={() => { setStreamerId(n.id); setShow(null); setMsg(''); setBusy(true); generateLiveShow(n.id).then((r) => { setMsg(r.ok ? '' : r.msg); if (r.show) setShow(r.show); }).finally(() => setBusy(false)); }}
                        className="text-left rounded-xl border border-edge bg-panel/60 px-3 py-2.5 hover:border-god/40 disabled:opacity-50 transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="w-9 h-9 rounded-lg border border-edge flex items-center justify-center text-sm font-bold text-god/80 bg-void">{(n.name || '?').slice(0, 1)}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-semibold text-slate-100 truncate">{n.name} <span className="text-[10px] font-mono text-rose-300/70">● LIVE</span></div>
                            <div className="text-[11px] font-mono text-dim/50 truncate">{[n.npcTag, n.realm].filter(Boolean).join('·')}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {busy && <div className="py-6 text-center text-rose-300/70 text-sm font-mono"><span className="animate-spin inline-block mr-2">◌</span>正在接入直播信号…</div>}
              {msg && <div className="text-[12px] font-mono text-amber-300/70 text-center">{msg}</div>}
            </>
          ) : (
            <>
              {/* 直播间头 */}
              <div className="rounded-xl border border-rose-500/30 bg-panel/60 px-3.5 py-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-600/20 border border-rose-500/40 text-rose-300">● LIVE</span>
                  <span className="text-[14px] font-bold text-slate-100">{show.roomTitle}</span>
                  <span className="flex-1" />
                  <span className="text-[11px] font-mono text-dim/50">👤 {streamer?.name}　👀 {show.viewers}</span>
                </div>
                {show.roomDesc && <div className="text-[12px] text-dim/60 mt-0.5">{show.roomDesc}</div>}
                {show.ranking.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className="text-[10px] font-mono text-dim/45">贡献榜</span>
                    {show.ranking.map((r, i) => (
                      <span key={i} className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${i === 0 ? 'border-amber-500/50 text-amber-300' : 'border-edge text-dim/60'}`}>{['🥇', '🥈', '🥉'][i] ?? ''}{r.name} {r.score}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* 主播心声（幕后条·观众看不到） */}
              {show.thought && (
                <div className="px-3 py-1.5 rounded-lg border border-edge/60 bg-panel/40 text-[12px] text-slate-300/80 italic flex items-start gap-1.5" title="幕后视角：主播心里想的——观众（包括你）本不该知道">
                  <span>💭</span><span>{show.thought}</span>
                </div>
              )}

              {/* 主播言行 */}
              <div className="space-y-1.5">
                {show.contents.map((c, i) => (
                  <div key={i} className="rounded-lg bg-panel/50 border border-edge/60 px-3 py-2">
                    <div className="text-[13px] text-slate-200 leading-relaxed">{c.dialogue}</div>
                    {c.state && <div className="text-[11px] font-mono text-dim/45 mt-0.5">（{c.state}）</div>}
                  </div>
                ))}
              </div>

              {/* superchat + 弹幕 */}
              {show.superchat.map((s, i) => (
                <div key={i} className="rounded-lg border border-amber-500/40 bg-amber-900/10 px-3 py-1.5 text-[12px]">
                  <span className="font-mono text-amber-300">💬 {s.name}（¥{s.amount}）</span>
                  <span className="text-slate-200 ml-1.5">{s.c}</span>
                </div>
              ))}
              {show.barrage.length > 0 && (
                <div className="rounded-xl border border-edge bg-void/60 px-3 py-2 max-h-40 overflow-y-auto space-y-0.5">
                  {show.barrage.map((b, i) => (
                    <div key={i} className="text-[12px] leading-snug"><span className="font-mono text-cyan-300/60">{b.name}</span><span className="text-slate-300/85">：{b.c}</span></div>
                  ))}
                </div>
              )}
              {busy && <div className="py-3 text-center text-rose-300/70 text-sm font-mono"><span className="animate-spin inline-block mr-2">◌</span>直播进行中…</div>}
              {msg && <div className="text-[12px] font-mono text-amber-300/70 text-center">{msg}</div>}
            </>
          )}
        </div>

        {/* 互动栏（进了直播间才显示） */}
        {streamerId && show && (
          <footer className="shrink-0 border-t border-edge bg-panel/60 px-4 py-2.5 space-y-2">
            {/* 礼物栏（点选→确认；豪礼看清价格再点） */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {LIVE_GIFTS.map((g) => (
                <button key={g.key} disabled={busy} onClick={() => setGiftPick(giftPick === g.key ? null : g.key)}
                  title={`${g.name}：${g.price} 乐园币`}
                  className={`shrink-0 px-2 py-1 rounded-lg border text-[12px] font-mono transition-colors disabled:opacity-40 ${giftPick === g.key ? 'border-amber-500/60 text-amber-300 bg-amber-900/20' : 'border-edge text-dim/70 hover:text-slate-200'}`}>
                  {g.emoji}<span className="text-[10px] text-dim/50 ml-0.5">{g.price >= 10000 ? `${g.price / 10000}万` : g.price}</span>
                </button>
              ))}
            </div>
            {giftPick && (() => { const g = giftByKey(giftPick)!; return (
              <div className="flex items-center gap-2 text-[12px] font-mono">
                <span className="text-dim/60">送出 {g.emoji}{g.name}（{g.price} 乐园币{anon ? '·匿名' : ''}）？</span>
                <button onClick={() => sendGift(g.key)} disabled={busy} className="px-2 py-0.5 rounded border border-amber-600/50 text-amber-300 hover:bg-amber-900/20 disabled:opacity-40">确认赠送</button>
                <button onClick={() => setGiftPick(null)} className="px-2 py-0.5 rounded border border-edge text-dim/50 hover:text-slate-200">算了</button>
              </div>
            ); })()}
            <div className="flex items-center gap-2">
              <label className="shrink-0 flex items-center gap-1 text-[11px] font-mono text-dim/50 cursor-pointer" title="匿名：主播不知道弹幕/礼物是你发的（匿名送礼不涨好感）">
                <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} className="accent-cyan-500" />匿名
              </label>
              <input value={danmu} onChange={(e) => setDanmu(e.target.value)} disabled={busy}
                onKeyDown={(e) => { if (e.key === 'Enter') sendDanmu(); }}
                placeholder="发条弹幕…" className="flex-1 bg-void border border-edge rounded px-2.5 py-1.5 text-[13px] text-slate-200 focus:outline-none focus:border-rose-500/50" />
              <button onClick={sendDanmu} disabled={busy || !danmu.trim()}
                className="shrink-0 px-3 py-1.5 rounded border border-rose-600/50 text-rose-300 hover:bg-rose-900/20 disabled:opacity-40 text-[12px] font-mono transition-colors">发送</button>
              <button onClick={() => run()} disabled={busy} title="接着看：刷新最新一段直播"
                className="shrink-0 px-2.5 py-1.5 rounded border border-edge text-dim/60 hover:text-slate-200 disabled:opacity-40 text-[12px] font-mono transition-colors">⟳</button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
