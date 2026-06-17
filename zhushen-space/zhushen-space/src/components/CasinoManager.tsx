import { useEffect, useRef, useState } from 'react';
import { useCasino, ensureBattleWbDefaults } from '../store/casinoStore';
import type { WorldBook, WorldBookEntry } from '../store/settingsStore';
import ApiRoutePicker from './ApiRoutePicker';

/* ── 战斗写作指导世界书：导入 / 逐条开关·编辑 / 导出（注入角斗场战斗生成） ── */
function downloadWb(book: WorldBook) {
  const data = {
    name: book.name,
    entries: Object.fromEntries(book.entries.map((e, i) => [i, {
      uid: e.uid, key: e.key, keysecondary: e.keysecondary, comment: e.comment,
      content: e.content, constant: e.constant, selective: e.selective,
      disable: !e.enabled, order: e.order, position: e.position,
    }])),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${(book.name || '世界书').replace(/[\\/:*?"<>|]/g, '_')}.json`;
  a.click(); URL.revokeObjectURL(url);
}

function WbLamp({ entry }: { entry: WorldBookEntry }) {
  if (entry.constant) return <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0 shadow-[0_0_4px_#38bdf8]" title="蓝灯：常驻，每场战斗都注入" />;
  if (entry.selective) return <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_4px_#34d399]" title="绿灯：命中关键词才注入" />;
  return <span className="w-2 h-2 rounded-full bg-slate-600 shrink-0" title="未设触发（不会注入）" />;
}

function BattleWbEntryRow({ bookId, entry }: { bookId: string; entry: WorldBookEntry }) {
  const toggleEntry = useCasino((s) => s.toggleBattleWbEntry);
  const updateEntry = useCasino((s) => s.updateBattleWbEntry);
  const removeEntry = useCasino((s) => s.removeBattleWbEntry);
  const [open, setOpen] = useState(false);
  const inp = 'w-full px-2 py-1 rounded bg-void border border-edge text-[12px] text-slate-200';
  return (
    <div className="border-t border-edge/40">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <input type="checkbox" checked={entry.enabled} onChange={() => toggleEntry(bookId, entry.uid)} className="accent-amber-500" />
        <WbLamp entry={entry} />
        <button onClick={() => setOpen((v) => !v)} className={`flex-1 text-left text-[12px] truncate ${entry.enabled ? 'text-slate-200' : 'text-dim/50 line-through'}`}>{entry.comment || '(无标题)'}</button>
        <button onClick={() => setOpen((v) => !v)} className="text-[11px] text-dim hover:text-amber-200 px-1">{open ? '收起' : '编辑'}</button>
        <button onClick={() => { if (confirm('删除该条目？')) removeEntry(bookId, entry.uid); }} className="text-blood/55 hover:text-blood text-[12px] px-1">✕</button>
      </div>
      {open && (
        <div className="px-3 pb-2 space-y-1.5">
          <input value={entry.comment} onChange={(e) => updateEntry(bookId, entry.uid, { comment: e.target.value })} placeholder="标题" className={inp} />
          <textarea value={entry.content} onChange={(e) => updateEntry(bookId, entry.uid, { content: e.target.value })} rows={3} placeholder="内容（写作指导）" className={`${inp} leading-relaxed resize-y`} />
          <input value={entry.key.join(', ')} onChange={(e) => updateEntry(bookId, entry.uid, { key: e.target.value.split(/[,，]/).map((k) => k.trim()).filter(Boolean) })} placeholder="绿灯关键词（逗号分隔，留空=只靠蓝灯常驻）" className={inp} />
          <div className="flex gap-4 text-[11px] text-dim">
            <label className="flex items-center gap-1"><input type="checkbox" checked={entry.constant} onChange={() => updateEntry(bookId, entry.uid, { constant: !entry.constant })} className="accent-sky-500" />蓝灯·常驻</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={entry.selective} onChange={() => updateEntry(bookId, entry.uid, { selective: !entry.selective })} className="accent-emerald-500" />绿灯·关键词</label>
          </div>
        </div>
      )}
    </div>
  );
}

function BattleWbCard({ book }: { book: WorldBook }) {
  const toggleWb = useCasino((s) => s.toggleBattleWorldBook);
  const removeWb = useCasino((s) => s.removeBattleWorldBook);
  const addEntry = useCasino((s) => s.addBattleWbEntry);
  const [open, setOpen] = useState(false);
  const onCount = book.entries.filter((e) => e.enabled).length;
  return (
    <div className="rounded-lg border border-edge bg-void/40 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <input type="checkbox" checked={book.enabled} onChange={() => toggleWb(book.id)} className="accent-amber-500" />
        <button onClick={() => setOpen((v) => !v)} className="flex-1 text-left min-w-0">
          <span className={`text-[13px] font-semibold ${book.enabled ? 'text-amber-200' : 'text-dim/50'}`}>{book.name}</span>
          <span className="ml-2 text-[11px] text-dim">{onCount}/{book.entries.length} 条{book.builtin ? ' · 内置' : ''}</span>
        </button>
        <button onClick={() => addEntry(book.id)} className="text-[13px] text-dim hover:text-amber-200 px-1" title="新增条目">＋</button>
        <button onClick={() => downloadWb(book)} className="text-[12px] text-dim hover:text-amber-200 px-1.5" title="导出为 JSON（可再导入）">导出</button>
        <button onClick={() => { if (confirm(`删除世界书「${book.name}」？`)) removeWb(book.id); }} className="text-blood/55 hover:text-blood text-[12px] px-1">删除</button>
      </div>
      {open && (
        <div className="max-h-72 overflow-y-auto bg-panel/30">
          {book.entries.length === 0 && <div className="px-3 py-3 text-[12px] text-dim/50">空世界书</div>}
          {book.entries.map((e) => <BattleWbEntryRow key={e.uid} bookId={book.id} entry={e} />)}
        </div>
      )}
    </div>
  );
}

function BattleWorldBookSection() {
  const books = useCasino((s) => s.battleWorldBooks);
  const importWb = useCasino((s) => s.importBattleWorldBook);
  const resetWb = useCasino((s) => s.resetBattleWorldBooks);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { ensureBattleWbDefaults(); }, []);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 4000); };
  const doImport = async (file: File) => {
    try { flash(importWb(await file.text(), file.name.replace(/\.json$/i, '')).message); }
    catch { flash('读取文件失败'); }
  };
  return (
    <div className="rounded-lg border border-edge bg-panel/60 p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-bold text-slate-200">⚔️ 战斗写作指导（世界书 {books.length}）</span>
        <div className="flex-1" />
        <button onClick={() => fileRef.current?.click()} className="text-[12px] px-2 py-1 rounded bg-god/15 border border-god/30 text-god hover:bg-god/25">导入</button>
        <button onClick={() => { if (confirm('重置内置「战斗写作指导」？将重新挂载内置本（不影响你导入的其它本）。')) { resetWb(); flash('已重置内置本'); } }} className="text-[12px] px-2 py-1 rounded bg-void border border-edge text-dim hover:text-amber-200">重置内置</button>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.currentTarget.value = ''; }} />
      </div>
      <div className="text-[11px] text-dim/70 leading-relaxed">
        注入<b className="text-god/80">角斗场 / 灵魂决斗场</b>的「战斗过程生成」，让 AI 把战斗写得更精彩。<span className="text-sky-300/80">蓝灯</span>条目每场必注入；<span className="text-emerald-300/80">绿灯</span>条目按本场两名角斗士的种族/职业/风格/桥段命中关键词才注入。兼容 SillyTavern 世界书 JSON，可逐条编辑 / 开关 / 导出再分享。
      </div>
      {msg && <div className="text-[11px] text-amber-300">{msg}</div>}
      {books.length === 0
        ? <div className="text-[12px] text-dim/45 py-1">无世界书（点「重置内置」恢复内置战斗写作指导，或「导入」自己的）。</div>
        : <div className="space-y-2">{books.map((b) => <BattleWbCard key={b.id} book={b} />)}</div>}
    </div>
  );
}

/* 赌坊设置页（变量管理 → 🎰赌场）：API 路由（角斗场/福袋奖励/荷官吐槽/魂赌等需 AI 的环节）+ 调参（限红/抽水/胜率/福袋花费）。
   各玩法提示词为代码注入（promptRules.ts 的 GLADIATOR_* / GACHA_REWARD_RULE / CASINO_BANTER_RULE 等），改即生效，无需在此配置。 */
export default function CasinoManager() {
  const config = useCasino((s) => s.config);
  const setConfig = useCasino((s) => s.setConfig);
  const stats = useCasino((s) => s.stats);

  const card = 'rounded-lg border border-edge bg-panel/60 p-4';
  const num = (v: number) => (Number.isFinite(v) ? v : 0);
  const pctRow = (label: string, key: 'exchangeFeePct' | 'cashoutFeePct' | 'ladderWinChance', hint: string) => (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 text-dim">{label}</span>
      <input type="range" min={key === 'ladderWinChance' ? 0.3 : 0} max={key === 'ladderWinChance' ? 0.5 : 0.2} step={0.01}
        value={num((config as any)[key])} onChange={(e) => setConfig({ [key]: +e.target.value } as any)} className="flex-1" />
      <span className="w-12 text-right font-mono text-amber-300">{Math.round(num((config as any)[key]) * 100)}%</span>
      <span className="w-40 shrink-0 text-[11px] text-dim/60">{hint}</span>
    </label>
  );
  const intRow = (label: string, key: 'vipMinTier' | 'gachaCostSoul' | 'bankruptcyGrant', min: number, max: number, hint: string) => (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 text-dim">{label}</span>
      <input type="number" min={min} max={max} value={num((config as any)[key])}
        onChange={(e) => setConfig({ [key]: Math.max(min, Math.min(max, +e.target.value || 0)) } as any)}
        className="w-24 px-2 py-1 rounded-lg bg-void border border-edge text-amber-200 font-mono text-right" />
      <span className="flex-1 text-[11px] text-dim/60">{hint}</span>
    </label>
  );

  return (
    <div className="space-y-4 max-w-2xl mx-auto text-slate-300">
      <div className={card}>
        <div className="text-xs leading-relaxed">
          入口在右侧导航「🎰赌场」。<b className="text-god/80">仅主神空间（轮回乐园）内营业</b>。5 速战/策略玩法（猜大小·转盘·21点·翻倍梯子·角斗场）+ 命运福袋扭蛋；普通厅用乐园币、<b className="text-god/80">五阶起</b>开魂币贵宾厅。
          <br />赔率/摇率/保底全前端确定性；需 AI 的环节（角斗场两角斗士与战斗、福袋物品、荷官吐槽）走下方 API 路由。提示词为代码注入（<span className="font-mono text-dim">promptRules.ts</span>），改即生效。
        </div>
        <div className="mt-2 text-[11px] text-dim">总局数 {stats.hands} · 累计赢 {stats.won} / 输 {stats.lost} · 最大单局 {stats.biggestWin}</div>
      </div>

      {/* API 路由 */}
      <div className={card}>
        <div className="text-sm font-bold text-slate-200 mb-2">🎰 赌坊 AI 接口（集成路由）</div>
        <ApiRoutePicker routeKey="casino" />
        <div className="mt-2 text-[11px] text-dim/70 leading-relaxed">
          从「综合设置 → API 接口库」勾选接口走<b className="text-god/70">集成路由</b>（多选按优先级轮流、失败自动 fallback）。<b className="text-god/70">不配置则默认复用正文 API</b>。用于：角斗场角斗士/战斗生成、命运福袋物品生成、荷官吐槽（及后续魂赌剧情局）。
        </div>
      </div>

      {/* 战斗写作指导世界书 */}
      <BattleWorldBookSection />

      {/* 调参 */}
      <div className={`${card} space-y-3`}>
        <div className="text-sm font-bold text-slate-200">调参</div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={config.enabled} onChange={(e) => setConfig({ enabled: e.target.checked })} />
          <span>启用赌坊</span>
        </label>
        {pctRow('买筹码抽水', 'exchangeFeePct', '乐园币→筹码的损耗')}
        {pctRow('兑现抽水', 'cashoutFeePct', '筹码→乐园币的损耗')}
        {pctRow('翻倍梯子胜率', 'ladderWinChance', '<50% 即庄家优势')}
        {intRow('贵宾厅阶位', 'vipMinTier', 1, 13, '魂币贵宾厅解锁阶位（默认 5=五阶）')}
        {intRow('福袋单抽花费', 'gachaCostSoul', 1, 100, '命运福袋单抽魂币数（十连 ×10）')}
        {intRow('破产补发', 'bankruptcyGrant', 0, 10000, '筹码归零时补发的普通筹码')}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <label className="flex items-center gap-2 text-[12px]"><span className="w-20 text-dim shrink-0">普通厅限红</span>
            <input type="number" value={config.limits.normalMin} onChange={(e) => setConfig({ limits: { ...config.limits, normalMin: Math.max(1, +e.target.value || 1) } })} className="w-16 px-1 py-0.5 rounded bg-void border border-edge font-mono text-right text-amber-200" />
            <span className="text-dim">~</span>
            <input type="number" value={config.limits.normalMax} onChange={(e) => setConfig({ limits: { ...config.limits, normalMax: Math.max(10, +e.target.value || 10) } })} className="w-20 px-1 py-0.5 rounded bg-void border border-edge font-mono text-right text-amber-200" />
          </label>
          <label className="flex items-center gap-2 text-[12px]"><span className="w-20 text-dim shrink-0">贵宾厅限红</span>
            <input type="number" value={config.limits.soulMin} onChange={(e) => setConfig({ limits: { ...config.limits, soulMin: Math.max(1, +e.target.value || 1) } })} className="w-16 px-1 py-0.5 rounded bg-void border border-edge font-mono text-right text-amber-200" />
            <span className="text-dim">~</span>
            <input type="number" value={config.limits.soulMax} onChange={(e) => setConfig({ limits: { ...config.limits, soulMax: Math.max(10, +e.target.value || 10) } })} className="w-20 px-1 py-0.5 rounded bg-void border border-edge font-mono text-right text-amber-200" />
          </label>
        </div>
      </div>
    </div>
  );
}
