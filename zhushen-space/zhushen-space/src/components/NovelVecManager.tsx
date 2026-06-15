import { useState } from 'react';
import { useNovelVec } from '../store/novelVecStore';
import { loadNovelIndex, novelVecStatus, retrieveNovel, type NovelHit } from '../systems/novelVec';

/* 向量资料库（原著当世界书）设置面板：embedding 接口 + 检索参数 + 索引状态 + 测试检索 */
export default function NovelVecManager() {
  const settings = useNovelVec((s) => s.settings);
  const setSettings = useNovelVec((s) => s.setSettings);
  const [status, setStatus] = useState(novelVecStatus());
  const [loadingIdx, setLoadingIdx] = useState(false);
  const [testQuery, setTestQuery] = useState('');
  const [testing, setTesting] = useState(false);
  const [hits, setHits] = useState<NovelHit[] | null>(null);

  const inputCls = 'w-full bg-void border border-edge rounded px-2.5 py-1.5 text-[13px] text-slate-200 focus:outline-none focus:border-god/50';

  async function doLoad() {
    setLoadingIdx(true);
    await loadNovelIndex();
    setStatus(novelVecStatus());
    setLoadingIdx(false);
  }
  async function doTest() {
    if (!testQuery.trim() || testing) return;
    setTesting(true); setHits(null);
    try { setHits(await retrieveNovel(testQuery.trim())); } catch { setHits([]); }
    setStatus(novelVecStatus());
    setTesting(false);
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="text-[13px] text-dim/70 leading-relaxed bg-panel/60 border border-edge rounded-xl p-4">
        把<b>《轮回乐园》原著向量化</b>后当成"语义世界书"——每回合按当前剧情自动检索最相关的原著片段，注入正文（不用写关键词）。
        向量是<b>预先建好、内置在前端</b>的；这里只配置"查询那一下"用的 embedding 接口。
        <div className="mt-2 text-dim/50">
          建库（一次性，在 <code className="text-god/60">zhushen-space/zhushen-space</code> 目录）：
          <div className="mt-1 font-mono text-[12px] bg-void/60 rounded p-2 text-slate-300">$env:EMBED_KEY="你的硅基流动key"; npm run build-vectors</div>
          跑完产物在 <code className="text-god/60">public/novel-vectors/</code>，随前端一起部署。
        </div>
      </div>

      {/* 总开关 */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings({ enabled: e.target.checked })} className="accent-god w-4 h-4" />
        <span className="text-sm font-mono text-god/80 uppercase tracking-widest">启用向量资料库</span>
      </label>

      {/* Embedding 接口 */}
      <div className="space-y-2 p-4 bg-panel border border-edge rounded-xl">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">Embedding 接口（查询用）</div>
        <div className="text-[12px] text-amber-300/70">⚠ 必须与建库时同一个模型（默认 Pro/BAAI/bge-m3，1024 维），否则向量空间对不上、检索无效。</div>
        <div>
          <div className="text-[12px] font-mono text-dim/50 mb-0.5">Base URL</div>
          <input value={settings.apiBase} onChange={(e) => setSettings({ apiBase: e.target.value })} placeholder="https://api.siliconflow.cn/v1" className={`${inputCls} font-mono`} />
        </div>
        <div>
          <div className="text-[12px] font-mono text-dim/50 mb-0.5">API Key</div>
          <input type="password" value={settings.apiKey} onChange={(e) => setSettings({ apiKey: e.target.value })} placeholder="sk-…" className={`${inputCls} font-mono`} />
        </div>
        <div>
          <div className="text-[12px] font-mono text-dim/50 mb-0.5">模型</div>
          <input value={settings.model} onChange={(e) => setSettings({ model: e.target.value })} placeholder="Pro/BAAI/bge-m3" className={`${inputCls} font-mono`} />
        </div>
      </div>

      {/* 检索参数 */}
      <div className="space-y-2 p-4 bg-panel border border-edge rounded-xl">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">检索参数</div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-[12px] font-mono text-dim/50">topK（注入段数）</span>
            <input type="number" min={1} max={20} value={settings.topK} onChange={(e) => setSettings({ topK: Math.max(1, Math.min(20, Number(e.target.value) || 5)) })} className={`${inputCls} font-mono mt-0.5`} />
          </label>
          <label className="block">
            <span className="text-[12px] font-mono text-dim/50">相似度阈值(0~1)</span>
            <input type="number" step={0.05} min={0} max={1} value={settings.threshold} onChange={(e) => setSettings({ threshold: Math.max(0, Math.min(1, Number(e.target.value) || 0.35)) })} className={`${inputCls} font-mono mt-0.5`} />
          </label>
          <label className="block">
            <span className="text-[12px] font-mono text-dim/50">注入字数上限</span>
            <input type="number" min={200} step={100} value={settings.maxChars} onChange={(e) => setSettings({ maxChars: Math.max(200, Number(e.target.value) || 2500) })} className={`${inputCls} font-mono mt-0.5`} />
          </label>
        </div>
        <div className="text-[12px] text-dim/50">阈值越高越严（只注入很相关的）；topK / 字数上限控制注入量、防止撑爆上下文。</div>
      </div>

      {/* 索引状态 + 测试 */}
      <div className="space-y-2 p-4 bg-panel border border-edge rounded-xl">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-god/70 uppercase tracking-widest flex-1">索引状态</span>
          <button onClick={doLoad} disabled={loadingIdx} className="text-[12px] font-mono px-2.5 py-1 rounded border border-god/40 text-god hover:bg-god/10 disabled:opacity-40 transition-colors">{loadingIdx ? '加载中…' : '加载/检查索引'}</button>
        </div>
        <div className="text-[12px] font-mono text-dim/70">
          {status.ready ? <span className="text-emerald-300/80">✓ 已就绪：{status.count} 段，{status.dim} 维</span>
            : status.error ? <span className="text-blood/80">✗ {status.error}</span>
            : <span className="text-dim/50">未加载（点上方按钮加载，或开启后首次发消息时自动懒加载）</span>}
        </div>
        <div className="flex gap-2 pt-1">
          <input value={testQuery} onChange={(e) => setTestQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doTest(); }} placeholder="测试检索：输入一句剧情/设定问题…" className={`${inputCls} flex-1`} />
          <button onClick={doTest} disabled={testing || !testQuery.trim()} className="shrink-0 text-[12px] font-mono px-3 py-1.5 rounded border border-god/40 text-god hover:bg-god/10 disabled:opacity-40 transition-colors">{testing ? '检索中…' : '🔍 测试'}</button>
        </div>
        {hits && (
          <div className="space-y-1.5 pt-1">
            {hits.length === 0 ? <div className="text-[12px] text-dim/40">无命中（阈值过高 / 接口未配 / 索引未建）。</div>
              : hits.map((h, i) => (
                <div key={i} className="text-[12px] rounded border border-edge/60 bg-void/40 p-2">
                  <div className="font-mono text-dim/50 mb-0.5">{h.chap || h.vol || '原著'} · 相似度 {h.score.toFixed(3)}</div>
                  <div className="text-slate-300/80 leading-relaxed line-clamp-4">{h.text}</div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
