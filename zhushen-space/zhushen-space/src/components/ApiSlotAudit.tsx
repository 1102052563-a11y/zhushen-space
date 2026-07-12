import { useReducer, useState } from 'react';
import { collectApiSlots, scanApiSlots, clearApiSlot, clearApiSlots, type ApiSlot } from '../systems/apiSlots';

/* 「一键排查 / 清除接口引用」。
   一个 AI 接口（如某 vertex 逆向网关）可能同时躺在 全局 / 正文 / 各功能独立接口 / 接口库 十几个槽位里，
   删掉一处后，别的功能路由删空时会回退到公共/独立槽继续调它 → 「删了还在调用」。
   此工具集中扫描全部槽位、按 地址/Key 关键词定位、一键清空。逻辑见 systems/apiSlots.ts。 */
export default function ApiSlotAudit() {
  const [open, setOpen] = useState(false);
  const [needle, setNeedle] = useState('gw/vertex');
  const [results, setResults] = useState<ApiSlot[] | null>(null);   // null = 尚未扫描
  const [showAll, setShowAll] = useState(false);

  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const runScan = (q = needle) => { setNeedle(q); setResults(scanApiSlots(q)); setShowAll(false); };
  // 清空后刷新：结果模式→按当前 needle 重扫；全部模式→强制重渲染让 allSlots 重新收集（本组件不订阅各 store，须手动触发）
  const afterClear = () => { setResults((r) => (r ? scanApiSlots(needle) : r)); forceUpdate(); };
  const allSlots = showAll ? collectApiSlots().filter((s) => s.baseUrl || s.apiKey) : [];
  const mask = (k: string) => (k ? (k.length > 8 ? k.slice(0, 4) + '…' + k.slice(-2) : '••') : '');

  const slotRow = (s: ApiSlot) => (
    <div key={`${s.storeName}:${s.field}:${s.libId ?? ''}`} className="flex items-center gap-2 px-2 py-1.5 border-b border-edge/40 last:border-b-0 text-[12px] font-mono">
      <div className="flex-1 min-w-0">
        <div className="text-god/85 truncate">{s.label}</div>
        <div className="text-dim/50 truncate">{s.baseUrl || '（空地址）'}{s.modelId ? ` · ${s.modelId}` : ''}{s.apiKey ? ` · key ${mask(s.apiKey)}` : ''}</div>
      </div>
      <button
        onClick={() => { clearApiSlot(s); afterClear(); }}
        title={s.isLibrary ? '从接口库整条删除' : '把该槽位的地址/Key/模型置空（其它参数保留）'}
        className="shrink-0 px-2 py-1 border border-blood/40 text-blood/90 rounded hover:bg-blood/10 transition-colors"
      >
        {s.isLibrary ? '删除' : '清空'}
      </button>
    </div>
  );

  return (
    <div className="border border-edge rounded-lg overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-mono text-god/80 hover:bg-god/5 transition-colors">
        🔍 排查 / 清除接口引用 <span className="text-dim/40 text-[11px]">删了某接口却还在调用？扫这里</span>
        <span className={`ml-auto text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="px-3 py-2.5 space-y-2 border-t border-edge/50">
          <div className="text-[11px] font-mono text-dim/50 leading-snug">
            扫描 全局 / 正文 / 各功能「独立接口」/ 接口库 的全部槽位，找出地址或 Key 含关键词的，一键清空。治「删了接口却还在调用」——多是某功能路由删空后回退到了公共 / 独立槽。
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={needle} onChange={(e) => setNeedle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runScan(); }}
              placeholder="接口地址 / Key 关键词，如 gw/vertex"
              className="flex-1 min-w-[160px] bg-void border border-edge rounded px-2 py-1 text-[13px] font-mono text-slate-200 outline-none focus:border-god"
            />
            <button onClick={() => runScan()} className="shrink-0 px-3 py-1.5 border border-god/50 text-god text-[13px] rounded hover:bg-god/10 font-mono transition-colors">扫描</button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono">
            <span className="text-dim/40">常用：</span>
            {['gw/vertex', 'gw/aistudio', 'api/gw/'].map((q) => (
              <button key={q} onClick={() => runScan(q)} className="px-2 py-0.5 rounded-full border border-edge text-dim/70 hover:text-god hover:border-god/40 transition-colors">{q}</button>
            ))}
            <button onClick={() => { setShowAll((v) => !v); setResults(null); }} className={`ml-auto px-2 py-0.5 rounded-full border transition-colors ${showAll ? 'border-god/50 text-god' : 'border-edge text-dim/60 hover:text-god'}`}>
              {showAll ? '✓ 全部槽位' : '列出全部槽位'}
            </button>
          </div>

          {/* 扫描结果 */}
          {results != null && !showAll && (
            results.length === 0
              ? <div className="text-[12px] font-mono text-emerald-300/70 px-1 py-2">✓ 没有任何槽位含「{needle}」——它已不会被任何功能调用了。</div>
              : (
                <div className="rounded border border-blood/25 overflow-hidden">
                  <div className="flex items-center justify-between px-2 py-1.5 bg-blood/5 text-[12px] font-mono">
                    <span className="text-blood/90">找到 {results.length} 个槽位仍指向「{needle}」</span>
                    <button onClick={() => { clearApiSlots(results); afterClear(); }} className="px-2 py-1 border border-blood/50 text-blood rounded hover:bg-blood/15 transition-colors">全部清空</button>
                  </div>
                  {results.map(slotRow)}
                </div>
              )
          )}

          {/* 全部槽位一览 */}
          {showAll && (
            <div className="rounded border border-edge overflow-hidden max-h-72 overflow-y-auto">
              <div className="px-2 py-1.5 bg-void/60 text-[12px] font-mono text-dim/60 sticky top-0">全部已填接口槽（{allSlots.length}）· 逐条可清</div>
              {allSlots.length ? allSlots.map(slotRow) : <div className="px-2 py-3 text-[12px] font-mono text-dim/40">没有已填地址的接口槽。</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
