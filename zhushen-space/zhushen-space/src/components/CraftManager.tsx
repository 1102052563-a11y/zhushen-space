import { useRef, useState } from 'react';
import { useCraft } from '../store/craftStore';
import { CRAFT_MODES } from '../systems/craftEngine';
import ApiRoutePicker from './ApiRoutePicker';

/* 合成工坊管理页（设置 → 变量管理 → 🛠合成工坊）：API 路由 + 门类开关 + 手工费 + 合成图鉴世界书。 */
const card = 'rounded-xl border border-edge bg-panel p-3';

export default function CraftManager() {
  const config = useCraft((s) => s.config);
  const worldBooks = useCraft((s) => s.worldBooks);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState<{ bookId: string; uid: number } | null>(null);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000); };

  return (
    <div className="space-y-4 text-slate-200">
      <div>
        <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">🛠 合成工坊</h3>
        <p className="text-[12px] text-dim/60 mt-1 leading-relaxed">全世界可用。玩家选门类 → 投料 + 倾向 → 前端掷品质档并锁品级上限 → AI 在护栏内生成产物（可重新生成/撤销，确认才消耗材料入库）。</p>
      </div>

      {/* API 路由 */}
      <div className={card}>
        <div className="text-[13px] font-semibold text-slate-100 mb-2">合成生成 · API 接口</div>
        <ApiRoutePicker routeKey="craft" />
        <div className="mt-2 text-[11px] text-dim/70 leading-relaxed">
          从「综合设置 → API 接口库」勾选接口走<b className="text-god/70">集成路由</b>（多选按优先级轮流、失败自动 fallback）。<b className="text-god/70">不配置则默认复用正文 API</b>。用于合成工坊产物生成（runCraftPhase）。
        </div>
      </div>

      {/* 门类开关 */}
      <div className={card}>
        <div className="text-[13px] font-semibold text-slate-100 mb-2">门类开关（关掉的门类不在面板显示）</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {CRAFT_MODES.map((m) => {
            const on = config.enabledModes[m.id] !== false;
            return (
              <button key={m.id} onClick={() => useCraft.getState().toggleMode(m.id)}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[12px] text-left transition-colors ${on ? 'border-god/50 bg-god/10 text-god' : 'border-edge text-dim/50'}`}>
                <span>{m.icon}</span><span className="truncate">{m.name}</span>
                <span className="ml-auto text-[10px]">{on ? '开' : '关'}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 调参 */}
      <div className={`${card} space-y-3`}>
        <div className="text-[13px] font-semibold text-slate-100">调参</div>
        <label className="flex items-center justify-between gap-3 text-[12px]">
          <span>手工费系数（0 = 免费；随投入品级指数上涨）</span>
          <input type="number" min={0} max={10} step={0.1} value={config.costMul}
            onChange={(e) => useCraft.getState().setConfig({ costMul: Math.max(0, Number(e.target.value) || 0) })}
            className="w-20 bg-panel2 border border-edge rounded px-2 py-1 text-right text-slate-200 outline-none focus:border-god/40" />
        </label>
        <label className="flex items-center justify-between gap-3 text-[12px]">
          <span>匠灵名（风味）</span>
          <input value={config.craftsmanName}
            onChange={(e) => useCraft.getState().setConfig({ craftsmanName: e.target.value })}
            className="w-40 bg-panel2 border border-edge rounded px-2 py-1 text-slate-200 outline-none focus:border-god/40" />
        </label>
      </div>

      {/* 合成图鉴世界书 */}
      <div className={`${card} space-y-2`}>
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-semibold text-slate-100">📖 合成图鉴（世界书）</div>
          <div className="flex gap-2 text-[11px]">
            <button onClick={() => fileRef.current?.click()} className="text-god/80 hover:text-god">＋导入</button>
            <button onClick={() => { useCraft.getState().resetCraftWorldBooks(); flash('已恢复内置合成图鉴'); }} className="text-dim/60 hover:text-slate-200">恢复内置</button>
          </div>
        </div>
        <div className="text-[11px] text-dim/60 leading-relaxed">蓝灯🔵常驻注入（守恒/格式/失败/命名）；绿灯🟢按门类关键词命中注入（各门类工艺）。注入在 CRAFT_RULE 之后。</div>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0]; if (!f) return;
          const rd = new FileReader();
          rd.onload = () => { const r = useCraft.getState().importCraftWorldBook(String(rd.result), f.name); flash(r.message); };
          rd.readAsText(f); e.target.value = '';
        }} />
        {worldBooks.map((b) => (
          <div key={b.id} className="rounded-lg border border-edge/70 bg-panel2/40 p-2 space-y-1">
            <div className="flex items-center gap-2">
              <button onClick={() => useCraft.getState().toggleCraftWorldBook(b.id)} className={`text-[11px] px-1.5 py-0.5 rounded border ${b.enabled ? 'border-emerald-500/40 text-emerald-300' : 'border-edge text-dim/50'}`}>{b.enabled ? '启用' : '停用'}</button>
              <span className="text-[13px] text-slate-100 truncate flex-1">{b.name}{b.builtin && <span className="text-[10px] text-dim/40 ml-1">内置</span>}</span>
              <button onClick={() => useCraft.getState().addCraftWbEntry(b.id)} className="text-[11px] text-god/70 hover:text-god">＋条目</button>
              {!b.builtin && <button onClick={() => useCraft.getState().removeCraftWorldBook(b.id)} className="text-[11px] text-dim/50 hover:text-blood">删本</button>}
            </div>
            <div className="space-y-1">
              {b.entries.map((e) => (
                <div key={e.uid} className="text-[12px]">
                  <div className="flex items-center gap-2">
                    <button onClick={() => useCraft.getState().toggleCraftWbEntry(b.id, e.uid)} title={e.constant ? '蓝灯·常驻' : '绿灯·关键词'} className="shrink-0">{e.enabled ? (e.constant ? '🔵' : '🟢') : '⚪'}</button>
                    <span className={`truncate flex-1 ${e.enabled ? 'text-slate-200' : 'text-dim/40'}`}>{e.comment || '(无标题)'}</span>
                    <button onClick={() => setEditing(editing?.uid === e.uid && editing.bookId === b.id ? null : { bookId: b.id, uid: e.uid })} className="text-[11px] text-dim/60 hover:text-god shrink-0">{editing?.uid === e.uid && editing.bookId === b.id ? '收起' : '编辑'}</button>
                    <button onClick={() => useCraft.getState().removeCraftWbEntry(b.id, e.uid)} className="text-[11px] text-dim/40 hover:text-blood shrink-0">✕</button>
                  </div>
                  {editing?.uid === e.uid && editing.bookId === b.id && (
                    <div className="mt-1 space-y-1 pl-5">
                      <input value={e.comment} onChange={(ev) => useCraft.getState().updateCraftWbEntry(b.id, e.uid, { comment: ev.target.value })}
                        placeholder="标题" className="w-full bg-panel2 border border-edge rounded px-2 py-1 text-[12px] outline-none focus:border-god/40" />
                      <input value={e.key.join(', ')} onChange={(ev) => { const key = ev.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean); useCraft.getState().updateCraftWbEntry(b.id, e.uid, { key, constant: key.length === 0, selective: key.length > 0 }); }}
                        placeholder="关键词（逗号分隔；留空=🔵常驻）" className="w-full bg-panel2 border border-edge rounded px-2 py-1 text-[12px] outline-none focus:border-god/40" />
                      <textarea value={e.content} onChange={(ev) => useCraft.getState().updateCraftWbEntry(b.id, e.uid, { content: ev.target.value })}
                        rows={3} placeholder="内容" className="w-full bg-panel2 border border-edge rounded px-2 py-1 text-[12px] outline-none focus:border-god/40 resize-none" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {msg && <div className="text-[12px] text-god/80">{msg}</div>}
    </div>
  );
}
