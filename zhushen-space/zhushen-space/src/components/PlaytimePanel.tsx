import { useEffect, useState } from 'react';
import { chatReady, chatUid, chatName } from '../systems/chatIdentity';
import { playtimeMe, playtimeTop, type PlaytimeMe, type PlaytimeTopEntry } from '../systems/playtime';

/* 游玩时长 · 排行榜：凡登录者自动累计"活跃游玩"时长，看自己时长+名次 + 全服排行榜 + 全服累计在线时长。
   PlaytimeBoard = 纯内容（供聊天室「🏆 时长榜」view 内嵌复用）；PlaytimePanel = 独立 modal 外壳（⌘K 等直接打开时用）。 */
function fmtDur(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时 ${m} 分`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分钟`;
  return `${s} 秒`;
}
const RANK_MEDAL = ['🥇', '🥈', '🥉'];

/** 游玩时长内容（我的时长卡 + 全服排行榜 + 累计在线时长）——不含 modal 外壳，填满父容器。 */
export function PlaytimeBoard() {
  const [me, setMe] = useState<PlaytimeMe | null>(null);
  const [board, setBoard] = useState<{ items: PlaytimeTopEntry[]; players: number; total: number }>({ items: [], players: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const myUid = chatUid();
  const logged = chatReady();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [m, b] = await Promise.all([playtimeMe(), playtimeTop(100)]);
      if (cancelled) return;
      setMe(m); setBoard(b); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* 我的时长卡 */}
      {logged ? (
        <div className="rounded-xl border border-god/30 bg-god/5 p-4 text-center space-y-1">
          <div className="text-[12px] font-mono text-dim/60">你（{chatName() || '道友'}）已游玩</div>
          <div className="text-2xl font-bold text-god">{me ? fmtDur(me.seconds) : '…'}</div>
          {me && (
            <div className="text-[13px] font-mono text-slate-300">
              排名 <span className="text-amber-300 font-bold">第 {me.rank}</span> / 共 {me.players} 人
              {!me.recorded && <span className="text-dim/50 ml-1">（继续游玩即上榜）</span>}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-edge bg-panel p-4 text-center text-[13px] text-dim/70 leading-relaxed">
          登录后，你的游玩时长会自动记录并上榜。<br />
          <span className="text-[12px] text-dim/50">（在本聊天室的门禁页登录即可）</span>
        </div>
      )}

      {/* 排行榜 */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <span className="text-xs font-mono text-god/60 uppercase tracking-widest">游玩时长榜</span>
          <span className="text-[11px] font-mono text-dim/40">共 {board.players} 人 · 全服累计 {fmtDur(board.total)}</span>
          <div className="flex-1 h-px bg-edge/30" />
        </div>
        {loading ? (
          <div className="text-center text-dim/40 text-sm font-mono py-8">加载中…</div>
        ) : board.items.length === 0 ? (
          <div className="text-center text-dim/40 text-sm font-mono py-8">还没有人上榜，来当第一名！</div>
        ) : (
          <div className="space-y-1">
            {board.items.map((e, i) => {
              const mine = logged && e.uid === myUid;
              return (
                <div key={e.uid} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${mine ? 'border-god/50 bg-god/10' : 'border-edge/60 bg-panel/40'}`}>
                  <span className={`w-8 shrink-0 text-center font-mono font-bold ${i < 3 ? 'text-base' : 'text-[13px] text-dim/50'}`}>{RANK_MEDAL[i] ?? i + 1}</span>
                  <span className={`flex-1 min-w-0 truncate text-sm ${mine ? 'text-god font-bold' : 'text-slate-200'}`}>{e.name || '道友'}{mine && <span className="text-[11px] text-god/70 ml-1">(你)</span>}</span>
                  <span className="shrink-0 text-[13px] font-mono text-amber-300/90">{fmtDur(e.seconds)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="text-[11px] font-mono text-dim/40 text-center pt-1">时长按"页面可见的活跃游玩"每分钟累计 · 切后台挂机不计</div>
    </div>
  );
}

/** 独立 modal 外壳（保留：⌘K 等直接打开时用；主入口已并入聊天室「🏆 时长榜」）。 */
export default function PlaytimePanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-lg max-h-[88dvh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between p-4 border-b border-edge shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">⏱</span>
            <h2 className="text-base font-bold text-slate-100">游玩时长 · 排行榜</h2>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
        </header>
        <PlaytimeBoard />
      </div>
    </div>
  );
}
