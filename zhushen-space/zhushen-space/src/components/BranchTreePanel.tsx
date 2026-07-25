/* 🌿 楼层分支树 —— 参考 SillyTavern Timelines：聊天历史时间线 + 任意节点开分支。
   ┌ 主干（竖排）＝当前这条时间线的每一回合；末端 ◉ = 你现在在这里
   └ 支线（虚线挂出去）＝被丢弃的平行线：⟳重新生成 / ↩回退 时自动收下的弃稿，以及 🔖 主动埋的分岔点

   ⚠ 一条支线就是一个**普通存档槽**（前缀 branch_），故「恢复」= loadSlot = 整页 reload，
     和读档完全同一条链路——这也是唯一能把 gameStore（模块级初始化）一并还原的路径。
   ⚠ 整棵树只吃 saveDb.allMeta()（游标逐条剥掉 data）→ **画树零存档数据加载**，几十个大档也不卡。 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePinchPanZoom } from '../systems/usePinchPanZoom';
import {
  buildBranchTree, NODE_R, digest,
  type SlotLite, type MsgLite, type TreeNode, type BranchOrigin,
} from '../systems/branchTree';
import {
  listBranchPoints, listAutoSnaps, listSlots, setBranchPinned, deleteBranchPoint,
  clearBranchPoints, BRANCH_KEEP, type SlotMeta,
} from '../systems/saveManager';
import { useSettings } from '../store/settingsStore';

const ORIGIN: Record<BranchOrigin, { icon: string; label: string; cls: string }> = {
  regen: { icon: '⟳', label: '重新生成的弃稿', cls: 'text-fuchsia-300 border-fuchsia-400/40 bg-fuchsia-400/10' },
  rollback: { icon: '↩', label: '回退丢弃的一线', cls: 'text-sky-300 border-sky-400/40 bg-sky-400/10' },
  manual: { icon: '🔖', label: '主动埋的分岔点', cls: 'text-amber-300 border-amber-400/40 bg-amber-400/10' },
};

const fmt = (t?: number) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

export default function BranchTreePanel({ messages, onClose, onJump, onBookmark }: {
  messages: MsgLite[];
  onClose: () => void;
  onJump: (slotId: string) => void | Promise<void>;
  onBookmark: () => void | Promise<void>;
}) {
  const [branches, setBranches] = useState<SlotMeta[]>([]);
  const [jumpables, setJumpables] = useState<SlotMeta[]>([]);
  const [sel, setSel] = useState<TreeNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmJump, setConfirmJump] = useState<TreeNode | null>(null);
  const capture = useSettings((s) => s.branchCapture);
  const setCapture = useSettings((s) => s.setBranchCapture);
  const pz = usePinchPanZoom({ min: 0.4, max: 2 });

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [b, snaps, slots] = await Promise.all([listBranchPoints(), listAutoSnaps(), listSlots()]);
      setBranches(b);
      setJumpables([...snaps, ...slots]);
    } finally { setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const model = useMemo(
    () => buildBranchTree({ messages, branches: branches as SlotLite[], jumpables: jumpables as SlotLite[] }),
    [messages, branches, jumpables],
  );

  const act = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); await refresh(); } finally { setBusy(false); } };

  return (
    <div className="fixed inset-0 z-[65] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-6xl h-[88dvh] rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col">
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-edge bg-panel">
          <span className="text-lg">🌿</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-100">楼层分支树</div>
            <div className="text-[12px] font-mono text-dim/50">
              丢掉的那条线，其实还在 · 主干 {model.shown}/{model.turnCount} 回合 · 支线 {branches.length}
            </div>
          </div>
          <button onClick={() => void onBookmark()} disabled={busy}
            title="给当前进度埋一个可回收的分岔点（不改变任何现状，只多存一份）"
            className="px-2.5 py-1 rounded-lg border border-amber-400/40 bg-amber-400/10 text-amber-200 text-[12px] font-bold hover:bg-amber-400/20 transition-colors disabled:opacity-50">🔖 在此分岔</button>
          <button onClick={() => pz.zoomBy(-0.2)} className="w-7 h-7 rounded-lg border border-edge text-dim hover:text-slate-200">−</button>
          <button onClick={() => pz.reset()} className="px-2 h-7 rounded-lg border border-edge text-dim hover:text-slate-200 text-[11px] font-mono">{Math.round(pz.zoom * 100)}%</button>
          <button onClick={() => pz.zoomBy(0.2)} className="w-7 h-7 rounded-lg border border-edge text-dim hover:text-slate-200">＋</button>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg ml-1">✕</button>
        </header>

        <div className="flex-1 min-h-0 flex max-lg:flex-col">
          {/* ── 画布 ── */}
          <div
            ref={pz.scrollRef}
            {...pz.bind}
            className={`relative flex-1 min-w-0 overflow-auto onscene-scroll touch-none ${pz.grabbing ? 'cursor-grabbing' : 'cursor-grab'}`}
          >
            <svg
              width={model.width * pz.zoom}
              height={model.height * pz.zoom}
              viewBox={`0 0 ${model.width} ${model.height}`}
              style={{ display: 'block', minWidth: '100%' }}
              // 空白处点一下取消选中 → 侧栏回到图例（[data-node] 是节点，交给节点自己处理）
              onClick={(e) => { if (!(e.target as Element)?.closest?.('[data-node]')) setSel(null); }}
            >
              {model.edges.map((e) => (
                e.dashed
                  ? <path key={e.key} d={`M ${e.x1} ${e.y1} C ${e.x1 + 60} ${e.y1}, ${e.x2 - 60} ${e.y2}, ${e.x2} ${e.y2}`}
                      fill="none" stroke="rgb(217 70 239 / 0.35)" strokeWidth={1.6} strokeDasharray="5 4" />
                  : <line key={e.key} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="rgb(148 163 184 / 0.35)" strokeWidth={2} />
              ))}
              {model.nodes.map((n) => <Node key={n.key} n={n} selected={sel?.key === n.key} onPick={setSel} />)}
            </svg>
            {model.turnCount === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-dim/50 text-sm">还没有对话——先玩几个回合，时间线就会长出来</div>
              </div>
            )}
          </div>

          {/* ── 详情栏：上半随选中切换，底部那条「自动收下弃稿」**常驻**
                 （曾把开关放在图例里 → 点过任意节点后就再也点不到它，只能关面板重开）── */}
          <aside className="w-[320px] max-lg:w-full max-lg:max-h-[38dvh] shrink-0 border-l max-lg:border-l-0 max-lg:border-t border-edge bg-panel/50 flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto onscene-scroll">
              {sel ? (
                <Detail
                  n={sel} busy={busy}
                  onBack={() => setSel(null)}
                  onJump={() => setConfirmJump(sel)}
                  onPin={() => act(async () => { await setBranchPinned(sel.key, !sel.pinned); setSel({ ...sel, pinned: !sel.pinned }); })}
                  onDelete={() => act(async () => { await deleteBranchPoint(sel.key); setSel(null); })}
                />
              ) : (
                <Legend orphans={model.orphans.length}
                  onClearAll={() => act(async () => { await clearBranchPoints(); setSel(null); })} />
              )}
            </div>
            <CaptureToggle keep={BRANCH_KEEP} capture={capture !== false} onCapture={setCapture} />
          </aside>
        </div>

        {confirmJump && (
          <ConfirmJump n={confirmJump} onCancel={() => setConfirmJump(null)}
            onOk={() => { const id = confirmJump.slotId!; setConfirmJump(null); void onJump(id); }} />
        )}
      </div>
    </div>
  );
}

/* ══ 节点 ══════════════════════════════════════════════ */

function Node({ n, selected, onPick }: { n: TreeNode; selected: boolean; onPick: (n: TreeNode) => void }) {
  const isBranch = n.kind === 'branch';
  const o = n.origin ? ORIGIN[n.origin] : null;
  const stroke = isBranch ? 'rgb(217 70 239 / 0.8)' : n.current ? 'rgb(70 227 207)' : n.slotId ? 'rgb(125 211 252 / 0.85)' : 'rgb(148 163 184 / 0.5)';
  const fill = selected ? stroke : n.current || isBranch ? 'rgb(10 14 20)' : 'rgb(10 14 20)';
  return (
    <g data-node={n.key} onClick={() => onPick(n)} style={{ cursor: 'pointer' }}>
      {n.current && <circle cx={n.x} cy={n.y} r={NODE_R + 6} fill="none" stroke="rgb(70 227 207 / 0.28)" strokeWidth={2} />}
      <circle cx={n.x} cy={n.y} r={isBranch ? NODE_R - 1 : NODE_R} fill={fill} stroke={stroke} strokeWidth={selected ? 3 : 2} />
      {n.slotId && !isBranch && <circle cx={n.x} cy={n.y} r={3} fill={stroke} />}
      <text x={n.x + NODE_R + 8} y={n.y - 3} fontSize={12} fill={isBranch ? 'rgb(240 171 252)' : n.current ? 'rgb(70 227 207)' : 'rgb(203 213 225)'} fontWeight={600}>
        {isBranch ? `${o?.icon ?? '🌿'} ${n.pinned ? '📌 ' : ''}${digest(n.title, 18)}` : n.title}
        {!isBranch && n.slotId ? '  ⤺' : ''}
      </text>
      <text x={n.x + NODE_R + 8} y={n.y + 12} fontSize={10.5} fill="rgb(100 116 139)">{digest(n.text, isBranch ? 22 : 30)}</text>
    </g>
  );
}

/* ══ 详情 ══════════════════════════════════════════════ */

function Detail({ n, busy, onBack, onJump, onPin, onDelete }: {
  n: TreeNode; busy: boolean; onBack: () => void; onJump: () => void; onPin: () => void; onDelete: () => void;
}) {
  const isBranch = n.kind === 'branch';
  const o = n.origin ? ORIGIN[n.origin] : null;
  return (
    <div className="p-3 space-y-3">
      <button onClick={onBack} className="text-[11px] font-mono text-dim/50 hover:text-slate-300 transition-colors">← 图例说明</button>
      <div>
        <div className="flex items-center gap-2">
          {o && <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${o.cls}`}>{o.icon} {o.label}</span>}
          {n.current && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-god/40 bg-god/10 text-god">◉ 你在这里</span>}
          {n.pinned && <span className="text-[10px] font-mono text-amber-300">📌 已收藏</span>}
        </div>
        <div className="mt-1.5 text-sm font-bold text-slate-100 leading-snug">{n.title}</div>
        <div className="text-[11px] font-mono text-dim/50">
          {isBranch ? `存于 ${fmt(n.at)}` : `楼层 #${n.tipMsgId}`}
          {isBranch && n.turn ? ` · 第 ${n.turn} 回合` : ''}
        </div>
      </div>

      {n.text && <div className="text-[12px] text-slate-300/90 leading-relaxed border-l-2 border-edge pl-2.5">{n.text}</div>}

      {n.slotId ? (
        <button onClick={onJump} disabled={busy}
          className="w-full px-3 py-2 rounded-lg border border-god/50 bg-god/10 text-god text-[13px] font-bold hover:bg-god/20 transition-colors disabled:opacity-50">
          {isBranch ? '↦ 恢复这条支线' : '⤺ 回到这一回合'}
        </button>
      ) : (
        <div className="text-[11px] text-dim/45 leading-relaxed border border-edge/60 rounded-lg px-2.5 py-2">
          这一回合没有留下快照，跳不回来。<br />
          能跳的只有：🛟 滚动备份（最近 15 回合）、手动/自动存档、以及树上的支线节点。
        </div>
      )}

      {isBranch && (
        <div className="flex items-center gap-2">
          <button onClick={onPin} disabled={busy}
            title={n.pinned ? '取消收藏后可能被自动裁剪' : '收藏后不再被自动裁剪'}
            className="flex-1 px-2 py-1.5 rounded-lg border border-edge text-[12px] font-mono text-dim hover:text-amber-200 hover:border-amber-400/40 transition-colors disabled:opacity-50">
            {n.pinned ? '取消收藏' : '📌 收藏'}
          </button>
          <button onClick={onDelete} disabled={busy}
            className="px-2 py-1.5 rounded-lg border border-edge text-[12px] font-mono text-dim hover:text-blood hover:border-blood/40 transition-colors disabled:opacity-50">🗑 删除</button>
        </div>
      )}
    </div>
  );
}

/* ══ 无选中时的说明 ══════════════════════════════════════ */

function Legend({ orphans, onClearAll }: { orphans: number; onClearAll: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="p-3 space-y-3 text-[12px] leading-relaxed">
      <div className="text-dim/70">点树上任意节点看详情，点空白处返回这里。</div>
      <div className="space-y-1.5 text-dim/60">
        <div><span className="text-god">◉</span> 主干末端 = 你现在的位置</div>
        <div><span className="text-sky-300">◍ ⤺</span> 这一回合有快照，可以跳回去</div>
        <div><span className="text-dim/50">○</span> 只留下正文，跳不回去</div>
        <div><span className="text-fuchsia-300">⟳ ↩ 🔖</span> 支线：弃稿 / 回退丢的线 / 主动埋的点</div>
      </div>

      {orphans > 0 && (
        <div className="text-[11px] text-dim/50 border border-edge/60 rounded-lg px-2.5 py-2">
          另有 <b className="text-slate-300">{orphans}</b> 条游离支线：分叉点已不在当前对话里
          （多半来自读档前的另一条时间线，或分叉点太早被时间线截断），故没画上树。
        </div>
      )}

      <div className="border-t border-edge/60 pt-3">
        {confirm ? (
          <div className="flex items-center gap-2">
            <span className="text-blood/80 text-[11px] flex-1">删掉全部支线（收藏的也删）？</span>
            <button onClick={() => { setConfirm(false); onClearAll(); }} className="px-2 py-1 rounded border border-blood/50 text-blood text-[11px] font-mono">确定</button>
            <button onClick={() => setConfirm(false)} className="px-2 py-1 rounded border border-edge text-dim text-[11px] font-mono">取消</button>
          </div>
        ) : (
          <button onClick={() => setConfirm(true)} className="text-[11px] font-mono text-dim/45 hover:text-blood transition-colors">🗑 清空全部支线</button>
        )}
      </div>
    </div>
  );
}

/* ══ 常驻开关：这是本功能唯一的设置项，故不藏进图例（详情栏一切换就找不着了），
      也不塞进设置面板（跟这棵树在一起才看得懂它在说什么）。 ══════════ */

function CaptureToggle({ keep, capture, onCapture }: { keep: number; capture: boolean; onCapture: (v: boolean) => void }) {
  return (
    <label className="shrink-0 flex items-start gap-2 cursor-pointer select-none border-t border-edge px-3 py-2.5 bg-void/40 text-[12px] leading-relaxed">
      <input type="checkbox" checked={capture} onChange={(e) => onCapture(e.target.checked)} className="accent-god w-4 h-4 mt-0.5 shrink-0" />
      <span>
        <span className={capture ? 'text-god font-bold' : 'text-dim font-bold'}>自动收下弃稿</span>
        <span className="block text-dim/55 mt-0.5">
          {capture
            ? <>点 ⟳重新生成 / ↩回退 时，把即将被丢弃的那条时间线整存一份。未收藏的只留最近 {keep} 条；每份≈一个 🛟 滚动备份（不含图）。</>
            : <>已关闭：弃稿照旧直接丢掉，不再留后路（省存储）。</>}
        </span>
      </span>
    </label>
  );
}

/* ══ 跳转确认（会 reload，属破坏性操作） ══════════════════ */

function ConfirmJump({ n, onOk, onCancel }: { n: TreeNode; onOk: () => void; onCancel: () => void }) {
  return (
    <div className="absolute inset-0 z-10 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="w-full max-w-md rounded-xl border border-edge bg-void p-4 space-y-3">
        <div className="text-sm font-bold text-slate-100">
          {n.kind === 'branch' ? '恢复这条支线？' : '回到这一回合？'}
        </div>
        <div className="text-[12px] text-dim/70 leading-relaxed">
          会把<b className="text-slate-300">整局状态</b>（对话 / 角色 / NPC / 物品 / 世界）还原到
          <b className="text-slate-300">「{digest(n.title, 24)}」</b>，然后<b className="text-slate-300">刷新页面</b>——和读档是同一条路。
          <br /><br />
          当前这条线会先自动存成一条支线，不会丢。
        </div>
        <div className="flex items-center justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-edge text-dim text-[13px] font-mono hover:text-slate-200">取消</button>
          <button onClick={onOk} className="px-3 py-1.5 rounded-lg border border-god/50 bg-god/15 text-god text-[13px] font-bold hover:bg-god/25">确定，切过去</button>
        </div>
      </div>
    </div>
  );
}
