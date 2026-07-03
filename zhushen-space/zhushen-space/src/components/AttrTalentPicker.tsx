import { useEffect, useRef, useState } from 'react';
import { useCharacters, RARITY_CLS, type Trait } from '../store/characterStore';
import { generateAttrTalents } from '../systems/attrTalent';

/* 真实属性里程碑·四选一逆天天赋（主角 B1 与 NPC Cx 共用）。
   挂载即调主角演化 API 生成 4 个该属性专属天赋 → 玩家选 1 个写进该角色天赋。
   背景点击不关闭（避免误触丢失里程碑奖励）；只能选 1 个或显式关闭/换一批。*/
export default function AttrTalentPicker({
  charId, charName, charTier, attrLabel, milestone, trueValue, isPlayer, moreCount = 0, onClose, onChosen,
}: {
  charId: string;
  charName: string;
  charTier: string;
  attrLabel: string;
  milestone: number;
  trueValue: number;
  isPlayer: boolean;
  moreCount?: number;   // 本批确认中，本次之后还排队等待的里程碑数（多项同时突破时 >0）
  onClose: () => void;
  onChosen?: (name: string) => void;
}) {
  const addTrait = useCharacters((s) => s.addTrait);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [cands, setCands] = useState<Omit<Trait, 'addedAt'>[]>([]);
  const [done, setDone] = useState(false);

  // 竞态保护：StrictMode(dev) 把挂载 effect 跑两遍 → 两次 generateAttrTalents 命中同一实例；其一常被中止
  // (signal is aborted)。不守卫的话，中止那次的报错会盖掉另一次的成功结果 → "返回有效却报错"。
  // 规则：①忽略中止错误 ②某批成功落定后，后续中止/失败不再覆盖；换一批时重置。
  const settledRef = useRef(false);
  const isAbortErr = (e: any) => !!e && (e.name === 'AbortError' || /\babort/i.test(String(e?.message || e)));

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const list = await generateAttrTalents({ attrLabel, milestone, trueValue, charName, charTier, isPlayer });
      if (!list.length) { if (!settledRef.current) setErr('AI 未返回有效天赋，请「换一批」重试'); return; }
      settledRef.current = true;
      setErr(''); setCands(list);
    } catch (e: any) {
      if (settledRef.current) return;                                        // 已有成功批次 → 忽略随后的中止/失败
      if (isAbortErr(e)) { setErr('AI 调用被中断，请「换一批」重试'); return; }   // 中止：友好提示，不再暴露 "signal is aborted without reason"
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };
  const reload = () => { settledRef.current = false; setCands([]); setEditIdx(null); setDraft(null); setEditedIdxs(new Set()); load(); };   // 换一批：重置落定标记+编辑态，重新生成
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const choose = (t: Omit<Trait, 'addedAt'>) => {
    if (done) return;
    setDone(true);
    addTrait(charId, t);
    onChosen?.(t.name);
    onClose();
  };

  // ── 生成内容编辑：把某张卡切到表单，改完保存回该卡（再点「选这个」纳入编辑后的版本）──
  type EditableKey = 'name' | 'level' | 'rarity' | 'category' | 'source' | 'effect' | 'attrBonus' | 'desc';
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<Omit<Trait, 'addedAt'> | null>(null);
  const [editedIdxs, setEditedIdxs] = useState<Set<number>>(new Set());
  const startEdit = (i: number) => { setEditIdx(i); setDraft({ ...cands[i] }); };
  const cancelEdit = () => { setEditIdx(null); setDraft(null); };
  const setField = (k: EditableKey, v: string) => setDraft((d) => (d ? ({ ...d, [k]: v } as Omit<Trait, 'addedAt'>) : d));
  const saveEdit = () => {
    if (editIdx == null || !draft) return;
    const name = (draft.name || '').trim();
    if (!name) return;                        // 名称必填
    const idx = editIdx;
    setCands((cs) => cs.map((c, j) => (j === idx ? { ...draft, name } : c)));
    setEditedIdxs((s) => new Set(s).add(idx));
    setEditIdx(null); setDraft(null);
  };
  // 表单字段（函数返回 JSX，非组件 → 不会每次渲染丢焦点）
  const inputCls = 'mt-0.5 w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-god/50';
  const fInput = (label: string, k: EditableKey, ph = '') => (
    <label className="block text-[11px] font-mono text-dim/55">{label}
      <input className={inputCls} value={draft?.[k] ?? ''} onChange={(e) => setField(k, e.target.value)} placeholder={ph} />
    </label>
  );
  const fArea = (label: string, k: EditableKey, rows: number, ph = '') => (
    <label className="block text-[11px] font-mono text-dim/55">{label}
      <textarea rows={rows} className={`${inputCls} leading-relaxed resize-y`} value={draft?.[k] ?? ''} onChange={(e) => setField(k, e.target.value)} placeholder={ph} />
    </label>
  );

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[88dvh] flex flex-col rounded-2xl border border-god/30 bg-void shadow-[0_0_70px_rgba(0,0,0,0.85)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-gradient-to-b from-panel to-void">
          <span className="text-xl">🌟</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-god flex items-center gap-2">
              真实{attrLabel}·里程碑 {milestone} —— 觉醒逆天天赋
              {moreCount > 0 && <span className="text-[11px] font-mono text-amber-300/80 px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-900/20">本批还剩 {moreCount} 项</span>}
            </div>
            <div className="text-[12px] font-mono text-dim/60 truncate">
              {isPlayer ? '主角' : charName || '该角色'}　真实{attrLabel} 突破至 {trueValue}，从 4 选 1 纳入天赋
            </div>
          </div>
          <button onClick={onClose} disabled={loading} className="shrink-0 text-dim/50 hover:text-blood text-lg disabled:opacity-40">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="py-16 text-center text-god/80 font-mono text-sm">
              <span className="inline-block animate-spin mr-2">⟳</span>正在铸造 4 个【{attrLabel}】逆天天赋…
              <div className="text-[12px] text-dim/40 mt-1">调用主角演化 API · 检索网游资料，可能需要十几秒</div>
            </div>
          )}
          {!loading && err && (
            <div className="py-12 text-center">
              <div className="text-blood text-sm font-mono whitespace-pre-line">{err}</div>
            </div>
          )}
          {!loading && !err && cands.map((t, i) => {
            const cls = RARITY_CLS[t.rarity] ?? 'border-edge text-slate-300';
            // 编辑态：该卡切换为表单
            if (editIdx === i) {
              return (
                <div key={i} className={`rounded-xl border p-3 space-y-2 bg-panel ${cls}`}>
                  <div className="text-[11px] font-mono text-god/70">✏️ 编辑天赋 · 改完点「保存修改」，再「选这个」纳入</div>
                  {fInput('名称', 'name')}
                  <div className="flex gap-2">
                    <div className="flex-1">{fInput('等级', 'level', '如 觉醒·初')}</div>
                    <div className="w-28 shrink-0">{fInput('品级', 'rarity', 'A/S/SS/SSS')}</div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">{fInput('类型', 'category', '属性类/特殊异能类…')}</div>
                    <div className="flex-1">{fInput('来源', 'source')}</div>
                  </div>
                  {fArea('效果', 'effect', 3)}
                  {fInput('属性加成', 'attrBonus', '如 力量+50%、无视30%防御')}
                  {fArea('描述', 'desc', 2)}
                  <div className="flex items-center gap-2 pt-0.5">
                    <button onClick={saveEdit} disabled={!draft?.name?.trim()}
                      className="text-[12px] font-mono px-3 py-1 rounded border border-god/50 text-god bg-god/10 hover:bg-god/20 transition-colors disabled:opacity-40">💾 保存修改</button>
                    <button onClick={cancelEdit}
                      className="text-[12px] font-mono px-3 py-1 rounded border border-edge text-dim/70 hover:text-slate-200 transition-colors">✕ 取消</button>
                  </div>
                </div>
              );
            }
            // 展示态：信息卡 + 底部「编辑 / 选这个」两个动作
            return (
              <div key={i} className={`rounded-xl border p-3 space-y-1.5 bg-panel transition-colors ${cls} ${done ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-semibold text-sm text-slate-100 truncate">{t.name}</span>
                  {editedIdxs.has(i) && <span className="text-[10px] font-mono text-emerald-400/80 shrink-0">✎已改</span>}
                  {t.level && <span className="text-[12px] font-mono text-dim/55 shrink-0">{t.level}</span>}
                  {t.rarity && <span className={`text-[12px] font-mono font-bold shrink-0 ${cls.split(' ').slice(1).join(' ')}`}>{t.rarity}</span>}
                </div>
                {(t.category || t.source) && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-mono text-dim/55">
                    {t.category && <span>类型：{t.category}</span>}
                    {t.source && <span>来源：{t.source}</span>}
                  </div>
                )}
                {t.effect && <div className="text-[13px] text-emerald-300/85 leading-relaxed"><span className="text-dim/40">效果·</span>{t.effect}</div>}
                {t.attrBonus && <div className="text-[13px] text-amber-300/90 leading-relaxed"><span className="text-dim/40">属性加成·</span>{t.attrBonus}</div>}
                {t.desc && <div className="text-[13px] text-dim/60 leading-relaxed italic border-l-2 border-edge/40 pl-2">{t.desc}</div>}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={() => startEdit(i)} disabled={done}
                    className="text-[12px] font-mono px-2.5 py-1 rounded border border-edge text-dim/70 hover:text-god hover:border-god/40 transition-colors disabled:opacity-40">✏️ 编辑</button>
                  <div className="flex-1" />
                  <button onClick={() => choose(t)} disabled={done}
                    className="text-[12px] font-mono px-3 py-1 rounded border border-god/50 text-god bg-god/10 hover:bg-god/20 transition-colors disabled:opacity-40">选这个 →</button>
                </div>
              </div>
            );
          })}
        </div>

        <footer className="shrink-0 flex items-center gap-2 px-5 py-3 border-t border-edge bg-panel">
          <span className="text-[12px] font-mono text-dim/45">里程碑奖励 · 选一个纳入天赋；不满意可换一批（再次计费）</span>
          <div className="flex-1" />
          <button onClick={reload} disabled={loading || done}
            className="text-sm font-mono px-3 py-1.5 rounded-lg border border-god/40 text-god hover:bg-god/10 transition-colors disabled:opacity-40">
            {loading ? '生成中…' : '🔄 换一批'}
          </button>
        </footer>
      </div>
    </div>
  );
}
