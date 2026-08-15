/* 🧪 模板变量试验台（借鉴 ACU「SQL 控制台」思想·面向预设作者）：
   对当前表数据实时解析 <if cell/seed/cond/db/sql>、{[db]}/{[sql]}、<random>/<calc> 等模板语法——
   写预设/世界书里的条件块前先在这里试，不用再盲写等实机。
   引擎复用正文同款：tableTemplate.resolveTableTemplates（含 sql.js 懒加载镜像，语法/数据口径与实战完全一致）。 */
import { useState } from 'react';
import { resolveTableTemplates } from '../systems/tableTemplate';
import { needsSqlite, ensureSqliteMirror } from '../systems/tableSqlite';

const EXAMPLE = `<if cell="主角信息表/1/HP > 50">状态尚可<else>命悬一线</if>
背包共 {[db.背包物品表.count()]} 种物品
<if seed="战斗">（检测到最近正文含"战斗"）</if>`;

export default function TemplateTester() {
  const [src, setSrc] = useState('');
  const [seed, setSeed] = useState('');
  const [out, setOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!src.trim()) { setOut('（先在上面输入要解析的模板文本）'); return; }
    setBusy(true);
    try {
      if (needsSqlite(src)) await ensureSqliteMirror();   // {[db]}/{[sql]}/<if db|sql> 才懒加载 sql.js 镜像
      setOut(resolveTableTemplates(src, { seedContent: seed }));
    } catch (e) {
      setOut('解析失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="rounded-lg border border-edge/60 bg-black/10 p-3">
      <summary className="cursor-pointer select-none text-[12px] font-semibold text-slate-200 flex items-center gap-2">
        🧪 模板变量试验台
        <span className="text-[11px] text-dim/60 font-normal">对当前表数据实时解析 &lt;if&gt; / {'{[db]}'} / &lt;calc&gt;——预设作者写条件块前先在这试（与正文解析同引擎同数据）</span>
      </summary>
      <div className="mt-3 space-y-2">
        <textarea
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          rows={4}
          placeholder={EXAMPLE}
          className="w-full bg-panel2 border border-edge rounded px-2 py-1.5 text-[12px] font-mono text-slate-200 outline-none focus:border-god/50 resize-y"
        />
        <div className="flex items-center gap-2">
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="模拟「最新正文」（给 <if seed> 关键词检测用·可留空）"
            className="flex-1 bg-panel2 border border-edge rounded px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-god/50"
          />
          <button onClick={run} disabled={busy}
            className="shrink-0 text-[12px] px-3 py-1 rounded-lg border border-god/50 text-god hover:bg-god/10 font-mono disabled:opacity-50">
            {busy ? '解析中…' : '▶ 解析'}
          </button>
        </div>
        {out !== null && (
          <pre className="whitespace-pre-wrap break-words text-[12px] text-emerald-200/90 bg-black/30 border border-edge/60 rounded p-2 max-h-64 overflow-y-auto">{out || '（解析结果为空——条件全部判否或输入被整块隐藏）'}</pre>
        )}
        <div className="text-[10px] text-dim/45 leading-relaxed">
          支持：<span className="font-mono">&lt;if cell="表/行/列 ≥ 值"&gt;…&lt;else&gt;…&lt;/if&gt;</span> · <span className="font-mono">&lt;if seed="关键词,或&与!非"&gt;</span> · <span className="font-mono">&lt;if cond="cell:…&seed:…"&gt;</span> · <span className="font-mono">{'{[db.表名.where(...).get(...)]}'}</span> · <span className="font-mono">{'{[sql "SELECT …"]}'}</span> · <span className="font-mono">&lt;random&gt;/&lt;calc&gt;/&lt;max&gt;/&lt;min&gt;</span>；db/sql 首次解析会懒加载 sql.js（约 700KB·仅此一次）。
        </div>
      </div>
    </details>
  );
}
