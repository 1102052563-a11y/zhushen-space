/* 分阶段人设 · 生成器弹层（挂进 TableManager）。
   表单（选表/行/列 + 各阶段阈值→文案 + 兜底）→ 实时预览嵌套 <if cell> 串 → 复制去粘进正文预设/世界书。
   引擎：systems/tableTemplate.ts（运行时按当前表数值选中阶段）；生成器：systems/stagedPersona.ts。青光主题。 */
import { useMemo, useState } from 'react';
import { useTables } from '../store/tableStore';
import { buildStagedPersona, STAGED_PERSONA_EXAMPLE, type PersonaStage } from '../systems/stagedPersona';

export default function StagedPersonaModal({ onClose }: { onClose: () => void }) {
  const tables = useTables((s) => s.tables);
  const sheets = useMemo(() => Object.values(tables).sort((a, b) => a.orderNo - b.orderNo), [tables]);

  const [tableName, setTableName] = useState(sheets[0]?.name ?? '');
  const [row, setRow] = useState('');
  const [column, setColumn] = useState('');
  const [stages, setStages] = useState<PersonaStage[]>([{ min: 50, text: '' }, { min: 0, text: '' }]);
  const [fallback, setFallback] = useState('');
  const [copied, setCopied] = useState(false);

  const headers = useMemo(() => {
    const sh = sheets.find((s) => s.name === tableName);
    return (sh?.content[0]?.slice(1) ?? []) as string[];
  }, [sheets, tableName]);

  const preview = useMemo(
    () => buildStagedPersona({ table: tableName, row, column, stages, fallback }),
    [tableName, row, column, stages, fallback],
  );

  const setStage = (i: number, patch: Partial<PersonaStage>) =>
    setStages((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addStage = () => setStages((prev) => [...prev, { min: 0, text: '' }]);
  const delStage = (i: number) => setStages((prev) => prev.filter((_, idx) => idx !== i));

  const loadExample = () => {
    setTableName(STAGED_PERSONA_EXAMPLE.table);
    setRow(STAGED_PERSONA_EXAMPLE.row);
    setColumn(STAGED_PERSONA_EXAMPLE.column);
    setStages(STAGED_PERSONA_EXAMPLE.stages.map((s) => ({ ...s })));
    setFallback(STAGED_PERSONA_EXAMPLE.fallback ?? '');
  };
  const copy = () => {
    if (!preview) return;
    try { navigator.clipboard?.writeText(preview); } catch { /* */ }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  const inputCls = 'bg-panel2 border border-edge rounded px-2 py-1 text-sm text-slate-200 outline-none focus:border-god/50';

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div
        className="bg-panel border border-god/30 rounded-xl w-full max-w-3xl max-h-[88vh] overflow-y-auto p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="text-god font-semibold">🎭 分阶段人设生成器</span>
          <span className="text-dim/60 text-[11px] flex-1">属性值达到阈值 → 自动换一套人设/语气（无需手写条件标签）</span>
          <button onClick={loadExample} className="text-[11px] px-2 py-0.5 rounded border border-edge text-dim hover:text-god hover:border-god/40">载入示例</button>
          <button onClick={onClose} className="text-dim hover:text-slate-200 px-1">✕</button>
        </div>

        <p className="text-[11px] text-dim/70 leading-relaxed">
          在「设置→变量管理→表格数据库」里建一张属性表（如「好感度表」，一行一个角色、一列记数值），AI 每回合会填。
          下面选中它，配好各阶段文案，把生成的条件块复制进你的<b>正文预设或世界书</b>即可——运行时会按当前数值自动选段注入。
        </p>

        {/* 表 / 行 / 列 */}
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-dim">属性表
            <select value={tableName} onChange={(e) => { setTableName(e.target.value); setColumn(''); }} className={inputCls}>
              {sheets.map((s) => <option key={s.uid} value={s.name}>{s.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-dim">行名（角色名/{'{{char}}'}）
            <input value={row} onChange={(e) => setRow(e.target.value)} placeholder="如 苏晓 或 {{char}}" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-dim">列名（数值列）
            {headers.length > 0 ? (
              <select value={column} onChange={(e) => setColumn(e.target.value)} className={inputCls}>
                <option value="">— 选列 —</option>
                {headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            ) : (
              <input value={column} onChange={(e) => setColumn(e.target.value)} placeholder="如 好感度" className={inputCls} />
            )}
          </label>
        </div>

        {/* 各阶段 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-dim">各阶段（阈值 = 达到该值起用此文·会自动按高低排好）</span>
            <button onClick={addStage} className="text-[11px] px-2 py-0.5 rounded border border-god/40 text-god hover:bg-god/10">+ 加一阶</button>
          </div>
          {stages.map((s, i) => (
            <div key={i} className="flex gap-2 items-start">
              <div className="flex flex-col gap-0.5 shrink-0">
                <span className="text-[10px] text-dim/60">≥</span>
                <input
                  type="number" value={Number.isFinite(s.min) ? s.min : ''}
                  onChange={(e) => setStage(i, { min: parseFloat(e.target.value) })}
                  className={`${inputCls} w-20`}
                />
              </div>
              <textarea
                value={s.text} onChange={(e) => setStage(i, { text: e.target.value })}
                placeholder="该阶段的人设 / 语气 / 状态描述…"
                rows={2} className={`${inputCls} flex-1 resize-y`}
              />
              <button onClick={() => delStage(i)} className="text-blood/70 hover:text-blood px-1 pt-4 shrink-0" title="删除此阶段">✕</button>
            </div>
          ))}
          <label className="flex flex-col gap-1 text-[11px] text-dim">兜底文案（低于最低阈值时·可留空）
            <textarea value={fallback} onChange={(e) => setFallback(e.target.value)} rows={2} placeholder="都不满足时的默认人设…" className={`${inputCls} resize-y`} />
          </label>
        </div>

        {/* 预览 + 复制 */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-dim">生成的条件块（粘进正文预设 / 世界书）</span>
            <button
              onClick={copy} disabled={!preview}
              className="text-[11px] px-2 py-0.5 rounded border border-god/40 text-god hover:bg-god/10 disabled:opacity-40"
            >{copied ? '✓ 已复制' : '📋 复制'}</button>
          </div>
          <pre className="bg-panel2 border border-edge rounded p-2 text-[11px] text-emerald-200/90 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
            {preview || '（填好上面的表/行/列和至少一个阶段文案后，这里出现可复制的条件块）'}
          </pre>
        </div>
      </div>
    </div>
  );
}
