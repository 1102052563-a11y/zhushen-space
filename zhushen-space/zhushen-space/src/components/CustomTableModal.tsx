/* 新建「用户自定义 AI 维护表」弹层（挂进 TableManager）。
   表名 + 列 + 维护规则(note·固定) + 单行? → buildCustomSheet → useTables.upsertSheet。
   note = 固定维护规则（注入给填表AI·AI 只改行不改 note）；行 = 可变值，AI 每回合据 note 维护。青光主题。 */
import { useMemo, useState } from 'react';
import { useTables } from '../store/tableStore';
import { buildCustomSheet } from '../systems/acuTableSpec';

export default function CustomTableModal({ onClose, onCreated }: { onClose: () => void; onCreated?: (uid: string) => void }) {
  const [name, setName] = useState('');
  const [cols, setCols] = useState<string[]>(['', '']);
  const [note, setNote] = useState('');
  const [single, setSingle] = useState(false);
  const [err, setErr] = useState('');

  const setCol = (i: number, v: string) => setCols((p) => p.map((c, idx) => (idx === i ? v : c)));
  const addCol = () => setCols((p) => [...p, '']);
  const delCol = (i: number) => setCols((p) => (p.length <= 1 ? p : p.filter((_, idx) => idx !== i)));

  // 实时预览生成的表结构（uid/列）
  const preview = useMemo(() => {
    const headers = cols.map((c) => c.trim()).filter(Boolean);
    if (!name.trim() || !headers.length) return null;
    return buildCustomSheet({ name, headers, note, single });
  }, [name, cols, note, single]);

  const create = () => {
    const nm = name.trim();
    if (!nm) { setErr('请先填表名'); return; }
    const headers = cols.map((c) => c.trim()).filter(Boolean);
    if (!headers.length) { setErr('至少填一列'); return; }
    if (new Set(headers).size !== headers.length) { setErr('列名有重复'); return; }
    const sheet = buildCustomSheet({ name: nm, headers, note, single });
    if (useTables.getState().getSheet(sheet.uid)) { setErr('已存在同名表，换个表名'); return; }
    useTables.getState().upsertSheet(sheet);
    onCreated?.(sheet.uid);
    onClose();
  };

  const inputCls = 'bg-panel2 border border-edge rounded px-2 py-1 text-sm text-slate-200 outline-none focus:border-god/50';

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-panel border border-god/30 rounded-xl w-full max-w-2xl max-h-[88vh] overflow-y-auto p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className="text-god font-semibold">➕ 新建自定义 AI 维护表</span>
          <span className="text-dim/60 text-[11px] flex-1">维护规则固定、行随剧情变——AI 每回合据规则维护</span>
          <button onClick={onClose} className="text-dim hover:text-slate-200 px-1">✕</button>
        </div>

        <p className="text-[11px] text-dim/70 leading-relaxed">
          建一张让 <b>AI 每回合自动维护</b>的表（如「好感度表」「悬赏令表」「队伍粮草」）。<b>维护规则</b>是<span className="text-god/80">固定</span>的——只给 AI 看、AI 只能改表里的<b>行</b>、改不了规则本身（天然防篡改）。表数据随存档、可在预设里用 <span className="font-mono text-god/70">{'{{getvar}}'}</span>/条件模板引用。
        </p>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-dim">表名
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 好感度表" className={inputCls} />
          </label>
          <label className="flex items-end gap-2 text-[11px] text-dim pb-1">
            <input type="checkbox" checked={single} onChange={(e) => setSingle(e.target.checked)} className="accent-god" />
            单行表（只一行·如「主角心情」这类全局状态；多行=一条一行如「各角色好感」）
          </label>
        </div>

        {/* 列 */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-dim">列（字段）</span>
            <button onClick={addCol} className="text-[11px] px-2 py-0.5 rounded border border-god/40 text-god hover:bg-god/10">+ 加列</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cols.map((c, i) => (
              <div key={i} className="flex items-center gap-0.5">
                <input value={c} onChange={(e) => setCol(i, e.target.value)} placeholder={`列${i + 1}`} className={`${inputCls} w-28`} />
                <button onClick={() => delCol(i)} className="text-blood/60 hover:text-blood px-0.5" title="删列">✕</button>
              </div>
            ))}
          </div>
        </div>

        {/* 维护规则 note */}
        <label className="flex flex-col gap-1 text-[11px] text-dim">维护规则（固定·给 AI 看怎么维护这张表）
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
            placeholder="如：每个出场角色一行；好感值 0~100，友好互动 +5、冲突 -10，不主动清零；角色离场保留、再登场沿用。"
            className={`${inputCls} resize-y`} />
        </label>

        {preview && (
          <div className="text-[11px] text-dim/70 bg-panel2 border border-edge rounded p-2">
            将创建：<span className="text-god/80 font-mono">{preview.name}</span>（uid <span className="font-mono">{preview.uid}</span>·{single ? '单行' : '多行'}）· 列：{preview.content[0].slice(1).join(' / ')}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button onClick={create} className="text-sm px-3 py-1.5 rounded-lg border border-god/50 text-god hover:bg-god/10 font-semibold">创建</button>
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg border border-edge text-dim hover:text-slate-200">取消</button>
          {err && <span className="text-[12px] text-blood">{err}</span>}
        </div>
      </div>
    </div>
  );
}
